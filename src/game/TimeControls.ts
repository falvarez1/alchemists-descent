import type { Ctx, FxState, TimeControlApi, TimeControlStatus } from '@/core/types';
import { resetCombatTransients } from '@/core/runtimeState';

const HISTORY_LIMIT = 32;
const MAX_QUEUED_TICKS = 600;

type Bounds = { x0: number; x1: number; y0: number; y1: number };

interface FxSnapshot {
  bloomKick: number;
  screenShake: number;
  hitstop: number;
  deathSlowMo: number;
}

interface GridSnapshot {
  worldWidth: number;
  worldHeight: number;
  bounds: Bounds;
  types: Uint8Array;
  colors: Uint32Array;
  life: Int16Array;
  moved: Uint8Array;
  charge: Uint16Array;
  movedTick: number;
  colorOverrides: number[];
  frameCount: number;
  simulationAccumulator: number;
  fx: FxSnapshot;
}

export class TimeControls implements TimeControlApi {
  private manualMode = false;
  private tickQueue = 0;
  private readonly history: GridSnapshot[] = [];
  private lastActionText = 'AUTO';

  constructor(private readonly ctx: Ctx) {}

  get manual(): boolean {
    return this.manualMode;
  }

  get queuedTicks(): number {
    return this.tickQueue;
  }

  get rewindAvailable(): number {
    return this.history.length;
  }

  get historyLimit(): number {
    return HISTORY_LIMIT;
  }

  setManual(active: boolean): void {
    if (this.manualMode === active) return;
    this.manualMode = active;
    this.tickQueue = 0;
    if (active) {
      this.captureSnapshot();
      this.lastActionText = 'MANUAL';
      this.markDebugTainted();
    } else {
      this.lastActionText = 'AUTO';
    }
    this.notifyChanged();
  }

  queueTicks(count: number): number {
    const ticks = sanitizeCount(count);
    if (ticks <= 0) return 0;
    if (!this.manualMode) this.setManual(true);
    const accepted = Math.min(ticks, MAX_QUEUED_TICKS - this.tickQueue);
    if (accepted <= 0) return 0;
    this.tickQueue += accepted;
    this.lastActionText = `STEP +${accepted}`;
    this.markDebugTainted();
    this.notifyChanged();
    return accepted;
  }

  takeQueuedTicks(max: number): number {
    const ticks = Math.min(sanitizeCount(max), this.tickQueue);
    if (ticks <= 0) return 0;
    this.tickQueue -= ticks;
    return ticks;
  }

  beforeTick(): void {
    if (!this.manualMode) return;
    this.captureSnapshot();
  }

  afterManualTicks(count: number): void {
    const ticks = sanitizeCount(count);
    if (ticks <= 0) return;
    this.lastActionText = `STEPPED ${ticks}`;
    this.markDebugTainted();
    this.emitWorldEdit('time step', this.currentBounds(), this.snapshotCellCount(this.currentBounds()) * ticks);
    this.notifyChanged();
  }

  rewindTicks(count: number): number {
    const requested = sanitizeCount(count);
    if (requested <= 0) return 0;
    let restored = 0;
    let restoredBounds: Bounds | null = null;
    for (let i = 0; i < requested; i++) {
      const snapshot = this.history.pop();
      if (!snapshot) break;
      if (!this.restoreSnapshot(snapshot)) continue;
      restored++;
      restoredBounds = snapshot.bounds;
    }
    if (restored <= 0) {
      this.notifyChanged();
      return 0;
    }
    this.tickQueue = 0;
    this.manualMode = true;
    this.lastActionText = `BACK ${restored}`;
    this.markDebugTainted();
    resetCombatTransients(this.ctx, {
      projectiles: 'clear-all',
      shockwaves: true,
      particles: true,
      lightning: true,
      wands: false,
      heldInputs: false,
      digBeam: true,
      simulationAccumulator: false,
    });
    if (restoredBounds) this.emitWorldEdit('time rewind', restoredBounds, this.snapshotCellCount(restoredBounds) * restored);
    this.notifyChanged();
    return restored;
  }

  captureCheckpoint(): boolean {
    const captured = this.captureSnapshot();
    if (captured) {
      this.lastActionText = 'SNAP';
      this.notifyChanged();
    }
    return captured;
  }

  clearHistory(): void {
    if (this.history.length === 0 && this.tickQueue === 0) return;
    this.history.length = 0;
    this.tickQueue = 0;
    this.lastActionText = this.manualMode ? 'MANUAL' : 'AUTO';
    this.notifyChanged();
  }

  status(): TimeControlStatus {
    return {
      manual: this.manualMode,
      queuedTicks: this.tickQueue,
      rewindAvailable: this.history.length,
      historyLimit: HISTORY_LIMIT,
      frameCount: this.ctx.state.frameCount,
      lastAction: this.lastActionText,
    };
  }

  private captureSnapshot(): boolean {
    const world = this.ctx.world;
    const bounds = this.currentBounds();
    const width = bounds.x1 - bounds.x0;
    const height = bounds.y1 - bounds.y0;
    if (width <= 0 || height <= 0) return false;

    const size = width * height;
    const snapshot: GridSnapshot = {
      worldWidth: world.width,
      worldHeight: world.height,
      bounds,
      types: new Uint8Array(size),
      colors: new Uint32Array(size),
      life: new Int16Array(size),
      moved: new Uint8Array(size),
      charge: new Uint16Array(size),
      movedTick: world.movedTick,
      colorOverrides: [],
      frameCount: this.ctx.state.frameCount,
      simulationAccumulator: this.ctx.simulation.accumulator,
      fx: snapshotFx(this.ctx.fx),
    };

    for (let y = 0; y < height; y++) {
      const sourceStart = (bounds.y0 + y) * world.width + bounds.x0;
      const sourceEnd = sourceStart + width;
      const targetStart = y * width;
      snapshot.types.set(world.types.subarray(sourceStart, sourceEnd), targetStart);
      snapshot.colors.set(world.colors.subarray(sourceStart, sourceEnd), targetStart);
      snapshot.life.set(world.life.subarray(sourceStart, sourceEnd), targetStart);
      snapshot.moved.set(world.moved.subarray(sourceStart, sourceEnd), targetStart);
      snapshot.charge.set(world.charge.subarray(sourceStart, sourceEnd), targetStart);
    }

    for (const index of world.colorOverrides) {
      if (indexInBounds(index, world.width, bounds)) snapshot.colorOverrides.push(index);
    }

    this.history.push(snapshot);
    while (this.history.length > HISTORY_LIMIT) this.history.shift();
    return true;
  }

  private restoreSnapshot(snapshot: GridSnapshot): boolean {
    const world = this.ctx.world;
    if (world.width !== snapshot.worldWidth || world.height !== snapshot.worldHeight) return false;
    const width = snapshot.bounds.x1 - snapshot.bounds.x0;
    const height = snapshot.bounds.y1 - snapshot.bounds.y0;
    if (width <= 0 || height <= 0) return false;

    for (let y = 0; y < height; y++) {
      const targetStart = (snapshot.bounds.y0 + y) * world.width + snapshot.bounds.x0;
      const targetEnd = targetStart + width;
      const sourceStart = y * width;
      const sourceEnd = sourceStart + width;
      world.types.set(snapshot.types.subarray(sourceStart, sourceEnd), targetStart);
      world.colors.set(snapshot.colors.subarray(sourceStart, sourceEnd), targetStart);
      world.life.set(snapshot.life.subarray(sourceStart, sourceEnd), targetStart);
      world.moved.set(snapshot.moved.subarray(sourceStart, sourceEnd), targetStart);
      world.charge.set(snapshot.charge.subarray(sourceStart, sourceEnd), targetStart);
      for (let i = targetStart; i < targetEnd; i++) {
        if (world.charge[i] > 0) world.activeCharges.add(i);
        else world.activeCharges.delete(i);
      }
    }

    for (const index of [...world.colorOverrides]) {
      if (indexInBounds(index, world.width, snapshot.bounds)) world.colorOverrides.delete(index);
    }
    for (const index of snapshot.colorOverrides) world.colorOverrides.add(index);

    world.movedTick = snapshot.movedTick;
    this.ctx.state.frameCount = snapshot.frameCount;
    this.ctx.simulation.accumulator = snapshot.simulationAccumulator;
    restoreFx(this.ctx.fx, snapshot.fx);
    return true;
  }

  private currentBounds(): Bounds {
    const world = this.ctx.world;
    const b = world.simBounds;
    const x0 = clamp(Math.floor(b.x0), 0, world.width);
    const x1 = clamp(Math.ceil(b.x1), x0, world.width);
    const y0 = clamp(Math.floor(b.y0), 0, world.height);
    const y1 = clamp(Math.ceil(b.y1), y0, world.height);
    return { x0, x1, y0, y1 };
  }

  private snapshotCellCount(bounds: Bounds): number {
    return Math.max(0, bounds.x1 - bounds.x0) * Math.max(0, bounds.y1 - bounds.y0);
  }

  private notifyChanged(): void {
    this.ctx.events.emit('timeControlsChanged', this.status());
  }

  private markDebugTainted(): void {
    if (this.ctx.state.mode === 'play') this.ctx.state.debugTainted = true;
  }

  private emitWorldEdit(command: string, bounds: Bounds, cells: number): void {
    this.ctx.events.emit('worldEdited', {
      source: 'time-controls',
      command,
      target: this.ctx.state.mode === 'play' ? 'play-grid' : 'sandbox-grid',
      bounds,
      cells,
    });
  }
}

function sanitizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function indexInBounds(index: number, width: number, bounds: Bounds): boolean {
  const x = index % width;
  const y = Math.floor(index / width);
  return x >= bounds.x0 && x < bounds.x1 && y >= bounds.y0 && y < bounds.y1;
}

function snapshotFx(fx: FxState): FxSnapshot {
  return {
    bloomKick: fx.bloomKick,
    screenShake: fx.screenShake,
    hitstop: fx.hitstop,
    deathSlowMo: fx.deathSlowMo,
  };
}

function restoreFx(fx: FxState, snapshot: FxSnapshot): void {
  fx.bloomKick = snapshot.bloomKick;
  fx.screenShake = snapshot.screenShake;
  fx.hitstop = snapshot.hitstop;
  fx.deathSlowMo = snapshot.deathSlowMo;
}

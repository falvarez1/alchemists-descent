import type { AuthoredLight, Ctx, ExitPortal, HazardEmitter, Mechanism, Pickup, PrefabEnemy, RuneVault } from '@/core/types';
import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { AUTHORED_LIGHT_RUNTIME_CAP, applyWorldLayer } from '@/builder/document';
import type { EditorDocument, EditorWorldLayer } from '@/builder/document';
import { instantiateObjects, makeInstantiationSink } from '@/game/instantiate';
import { getStoredSprite } from '@/builder/assets/spritelib';
import type { CellSetter } from '@/builder/stamps';
import { buildMechanismTriggerIndex } from '@/core/mechanisms';
import { Cell, isGas, isLiquid } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import { World } from '@/sim/World';
import type {
  RuntimeEntityBounds,
  RuntimeEntityGroup,
  RuntimeEntityRow,
  RuntimeEntitySnapshot,
  RuntimeSnapshotOptions,
} from '@/game/runtimeSnapshot';

export interface PreviewRuntimeStatus {
  ready: boolean;
  frame: number;
  resetCount: number;
  nonEmptyCells: number;
  changedCells: number;
  mechanisms: number;
  runeVaults: number;
  emitters: number;
  enemies: number;
  lights: number;
  capped: boolean;
  message: string;
}

export interface PreviewRuntimeDrawContext {
  view: { x0: number; y0: number; x1: number; y1: number };
  cellW: number;
  cellH: number;
  toScreen(wx: number, wy: number): { x: number; y: number };
}

const MAX_MECHANISMS = 256;
const MAX_RUNE_VAULTS = 128;
const MAX_EMITTERS = 96;
const MAX_PICKUPS = 256;
const MAX_PREVIEW_ENEMIES = 256;
const MAX_CATCHUP_FRAMES = 4;

const PREVIEW_GROUP_LABELS: Record<RuntimeEntityGroup, string> = {
  player: 'Player',
  enemies: 'Enemies',
  projectiles: 'Projectiles',
  critters: 'Critters',
  pickups: 'Pickups',
  mechanisms: 'Mechanisms',
  portal: 'Portal',
  particles: 'Particles',
};

const PREVIEW_ROW_LIMITS: Record<RuntimeEntityGroup, number> = {
  player: 0,
  enemies: 160,
  projectiles: 0,
  critters: 0,
  pickups: 160,
  mechanisms: 200,
  portal: 1,
  particles: 0,
};

export class PreviewRuntime {
  readonly world = new World();
  private readonly ctx: Ctx;
  private readonly sourceTypes = new Uint8Array(WIDTH * HEIGHT);
  private readonly sourceColors = new Uint32Array(WIDTH * HEIGHT);
  private readonly diffMask = new Uint8Array(WIDTH * HEIGHT);
  private frame = 0;
  private frameBase: number | null = null;
  private resetCount = 0;
  private ready = false;
  private capped = false;
  private message = 'Preview not started';
  private nonEmptyCells = 0;
  private changedCells = 0;
  private pickups: Pickup[] = [];
  private mechanisms = makeInstantiationSink().mechanisms;
  private mechanismTriggers = new Map<number, Mechanism[]>();
  private emitters: HazardEmitter[] = [];
  private enemySpawns: PrefabEnemy[] = [];
  private runeVaults: RuneVault[] = [];
  private portal: ExitPortal | null = null;
  private lights = makeInstantiationSink().authoredLights;
  private lightIds: string[] = [];

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  reset(doc: EditorDocument, sourceLayer: EditorWorldLayer | null = doc.world): PreviewRuntimeStatus {
    this.world.clear();
    this.sourceTypes.fill(Cell.Empty);
    this.sourceColors.fill(EMPTY_COLOR);
    this.diffMask.fill(0);
    this.frame = 0;
    this.frameBase = null;
    this.resetCount++;
    this.ready = false;
    this.capped = false;
    this.message = 'Preview reset';
    this.mechanisms = [];
    this.mechanismTriggers = new Map();
    this.pickups = [];
    this.emitters = [];
    this.enemySpawns = [];
    this.runeVaults = [];
    this.portal = null;
    this.lights = [];
    this.lightIds = [];
    this.nonEmptyCells = 0;
    this.changedCells = 0;
    if (!sourceLayer) {
      this.message = 'Capture terrain before Logic Preview';
      return this.status();
    }

    const previewCtx = {
      ...this.ctx,
      world: this.world,
      state: { ...this.ctx.state, currentBiome: doc.biome },
      player: { ...this.ctx.player, x: -9999, y: -9999 },
      enemies: [],
    } as Ctx;
    applyWorldLayer(previewCtx, sourceLayer);
    this.sourceTypes.set(this.world.types);
    this.sourceColors.set(this.world.colors);
    const sink = makeInstantiationSink();
    const set: CellSetter = (x, y, t) => {
      if (!this.world.inBounds(x, y)) return;
      const i = this.world.idx(x, y);
      this.world.types[i] = t;
      const fn = COLOR_FN[t];
      this.world.colors[i] = fn ? fn() : EMPTY_COLOR;
      this.world.life[i] = 0;
      this.world.charge[i] = 0;
    };
    instantiateObjects(previewCtx, sink, doc.objects, doc.links, doc.lights, 0, 0, set, {
      docSprites: doc.assets?.sprites,
      spriteLookup: getStoredSprite,
    });
    this.pickups = sink.pickups.slice(0, MAX_PICKUPS);
    this.mechanisms = sink.mechanisms;
    this.mechanismTriggers = buildMechanismTriggerIndex(this.mechanisms);
    this.runeVaults = sink.runeVaults.slice(0, MAX_RUNE_VAULTS);
    this.emitters = sink.emitters.slice(0, MAX_EMITTERS);
    this.enemySpawns = sink.enemies.slice(0, MAX_PREVIEW_ENEMIES);
    this.portal = sink.portal ?? null;
    this.lights = sink.authoredLights.slice(0, AUTHORED_LIGHT_RUNTIME_CAP);
    this.lightIds = doc.lights.filter((light) => !light.hidden).slice(0, AUTHORED_LIGHT_RUNTIME_CAP).map((light) => light.id);
    this.nonEmptyCells = countNonEmpty(this.world);
    this.changedCells = rebuildChangedMask(this.world, this.sourceTypes, this.sourceColors, this.diffMask);
    const capReasons = previewCapReasons({
      mechanisms: this.mechanisms.length,
      pickups: sink.pickups.length,
      enemies: sink.enemies.length,
      runeVaults: sink.runeVaults.length,
      emitters: sink.emitters.length,
      lights: sink.authoredLights.length,
    });
    this.capped = capReasons.length > 0;
    this.ready = !this.capped;
    this.message = this.capped
      ? `Preview capped - reduce ${capReasons.join(', ')}`
      : 'Logic Preview running from disposable runtime';
    return this.status();
  }

  stop(): void {
    this.ready = false;
    this.message = 'Preview stopped';
  }

  step(targetFrame: number): void {
    if (!this.ready) return;
    const absoluteFrame = Math.floor(targetFrame);
    if (this.frameBase === null) {
      this.frameBase = absoluteFrame - 1;
    }
    const next = Math.max(this.frame, absoluteFrame - this.frameBase);
    const end = Math.min(next, this.frame + MAX_CATCHUP_FRAMES);
    if (end === this.frame) return;
    for (let frame = this.frame + 1; frame <= end; frame++) {
      this.stepEmitters(frame);
      this.stepMechanisms(frame);
    }
    this.frame = end;
  }

  authoredLights(options?: { mutedIds?: ReadonlySet<string>; soloId?: string | null }): AuthoredLight[] {
    if (!this.ready) return [];
    const mutedIds = options?.mutedIds;
    const soloId = options?.soloId ?? null;
    if (!mutedIds && soloId === null) return this.lights;
    return this.lights.filter((_, index) => {
      const id = this.lightIds[index] ?? '';
      return !mutedIds?.has(id) && (soloId === null || id === soloId);
    });
  }

  status(): PreviewRuntimeStatus {
    return {
      ready: this.ready,
      frame: this.frame,
      resetCount: this.resetCount,
      nonEmptyCells: this.nonEmptyCells,
      changedCells: this.changedCells,
      mechanisms: this.mechanisms.length,
      runeVaults: this.runeVaults.length,
      emitters: this.emitters.length,
      enemies: this.enemySpawns.length,
      lights: this.lights.length,
      capped: this.capped,
      message: this.message,
    };
  }

  snapshot(options: RuntimeSnapshotOptions = {}): RuntimeEntitySnapshot {
    const limits = { ...PREVIEW_ROW_LIMITS, ...options.maxRowsPerGroup };
    const selectedId = options.selectedId ?? null;
    const view = runtimeView(this.ctx);
    const rows: RuntimeEntityRow[] = [];
    const counts = new Map<RuntimeEntityGroup, { total: number; visible: number; sampled: number }>();
    let selectedRow: RuntimeEntityRow | null = null;

    const pushGroup = <T>(
      group: RuntimeEntityGroup,
      items: readonly T[],
      idOf: (item: T, index: number) => string,
      visibleOf: (item: T) => boolean,
      rowOf: (item: T, index: number) => RuntimeEntityRow,
    ): void => {
      const limit = limits[group];
      let visible = 0;
      let selectedItem: T | null = null;
      let selectedIndex = -1;
      const visibleItems: Array<{ item: T; index: number }> = [];
      const offscreenItems: Array<{ item: T; index: number }> = [];

      items.forEach((item, index) => {
        const isVisible = visibleOf(item);
        if (isVisible) visible++;
        if (selectedId !== null && idOf(item, index) === selectedId) {
          selectedItem = item;
          selectedIndex = index;
        }
        if (limit <= 0) return;
        const bucket = isVisible ? visibleItems : offscreenItems;
        if (bucket.length < limit) bucket.push({ item, index });
      });

      const groupRows: RuntimeEntityRow[] = [];
      const sampledIds = new Set<string>();
      for (const entry of visibleItems) {
        const id = idOf(entry.item, entry.index);
        sampledIds.add(id);
        groupRows.push(rowOf(entry.item, entry.index));
      }
      for (const entry of offscreenItems) {
        if (groupRows.length >= limit) break;
        const id = idOf(entry.item, entry.index);
        sampledIds.add(id);
        groupRows.push(rowOf(entry.item, entry.index));
      }
      if (selectedItem !== null) {
        const id = idOf(selectedItem, selectedIndex);
        const row = rowOf(selectedItem, selectedIndex);
        selectedRow = row;
        if (!sampledIds.has(id)) groupRows.push(row);
      }

      rows.push(...groupRows);
      counts.set(group, { total: items.length, visible, sampled: groupRows.length });
    };

    const active = this.ready;
    pushGroup(
      'enemies',
      active ? this.enemySpawns : [],
      (enemy, index) => previewEnemyId(enemy, index),
      (enemy) => boundsVisible(view, enemyBounds(this.ctx, enemy)),
      (enemy, index) => previewEnemyRow(this.ctx, enemy, index, view),
    );
    pushGroup(
      'pickups',
      active ? this.pickups : [],
      (pickup, index) => previewPickupId(pickup, index),
      (pickup) => inView(view, pickup.x, pickup.y),
      (pickup, index) => previewPickupRow(pickup, index, view),
    );
    pushGroup(
      'mechanisms',
      active ? this.mechanisms : [],
      (mechanism) => previewMechanismId(mechanism),
      (mechanism) => boundsVisible(view, mechanismBounds(mechanism)),
      (mechanism) => previewMechanismRow(mechanism, view),
    );
    pushGroup(
      'portal',
      active && this.portal ? [this.portal] : [],
      () => 'preview-portal',
      (portal) => inView(view, portal.x, portal.y),
      (portal) => previewPortalRow(portal, view),
    );

    const countRows = (Object.keys(PREVIEW_GROUP_LABELS) as RuntimeEntityGroup[]).map((group) => {
      const count = counts.get(group) ?? { total: 0, visible: 0, sampled: 0 };
      return {
        group,
        label: PREVIEW_GROUP_LABELS[group],
        total: count.total,
        visible: count.visible,
        sampled: count.sampled,
      };
    });

    return {
      frame: this.frame,
      mode: this.ctx.state.mode,
      source: options.source ?? {
        id: 'builder-live-preview',
        label: 'Builder Logic Preview',
        detail: this.message,
      },
      level: { id: 'builder-live-preview', name: 'Logic Preview', depth: 0 },
      rows,
      counts: countRows,
      particles: {
        total: 0,
        visible: 0,
        visual: 0,
        depositing: 0,
        homing: 0,
        hostile: 0,
        glowing: 0,
        byMaterial: [],
      },
      selectedId,
      selectedRow,
      selectedMissing: selectedId !== null && selectedRow === null,
      capped: this.capped || countRows.some((count) => count.group !== 'particles' && count.sampled < count.total),
    };
  }

  draw(g: CanvasRenderingContext2D, ctx: PreviewRuntimeDrawContext): void {
    if (!this.ready) return;
    const x0 = Math.max(0, Math.floor(ctx.view.x0));
    const y0 = Math.max(0, Math.floor(ctx.view.y0));
    const x1 = Math.min(WIDTH, Math.ceil(ctx.view.x1));
    const y1 = Math.min(HEIGHT, Math.ceil(ctx.view.y1));
    const step = Math.max(1, Math.floor(2 / Math.max(0.01, Math.min(ctx.cellW, ctx.cellH))));
    g.globalAlpha = 0.58;
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const i = x + y * WIDTH;
        const t = this.world.types[i];
        if (t === this.sourceTypes[i] && this.world.colors[i] === this.sourceColors[i]) continue;
        if (t === Cell.Empty) {
          g.fillStyle = 'rgba(5,12,22,0.62)';
          const a = ctx.toScreen(x, y);
          const b = ctx.toScreen(Math.min(x + step, x1), Math.min(y + step, y1));
          g.fillRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
          continue;
        }
        const a = ctx.toScreen(x, y);
        const b = ctx.toScreen(Math.min(x + step, x1), Math.min(y + step, y1));
        g.fillStyle = '#' + this.world.colors[i].toString(16).padStart(6, '0');
        g.fillRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
      }
    }
    g.globalAlpha = 1;
  }

  private stepEmitters(frame: number): void {
    for (const em of this.emitters) {
      if (em.rate <= 0 || (frame + em.phase) % em.rate !== 0) continue;
      const dx = em.dir === 90 ? -1 : em.dir === 270 ? 1 : 0;
      const dy = em.dir === 180 ? -1 : em.dir === 0 ? 1 : 0;
      for (let k = 1; k <= em.burst; k++) {
        const x = em.x + dx * k;
        const y = em.y + dy * k;
        if (!this.world.inBounds(x, y)) break;
        const i = this.world.idx(x, y);
        if (this.world.types[i] !== Cell.Empty) continue;
        const fn = COLOR_FN[em.cell];
        const life =
          em.cell === Cell.Fire
            ? 15 + Math.floor(Math.random() * 30)
            : em.cell === Cell.Smoke
              ? 30 + Math.floor(Math.random() * 40)
              : 0;
        this.writeCell(i, em.cell, fn ? fn() : EMPTY_COLOR, life);
      }
    }
  }

  private stepMechanisms(frame: number): void {
    for (const mechanism of this.mechanisms) {
      if (mechanism.kind === 'door' || mechanism.kind === 'valve' || mechanism.kind === 'relay') continue;
      if (mechanism.broken === 0) continue;
      if (mechanism.kind === 'plate') {
        const pressed = this.sensePlate(mechanism);
        mechanism.pressed = pressed;
        if (pressed) mechanism.state = 420;
        else if (mechanism.state > 0) mechanism.state--;
      } else if (mechanism.kind === 'scale' || mechanism.kind === 'buoy' || mechanism.kind === 'sensor') {
        const reading = this.senseZone(mechanism);
        mechanism.reading = reading;
        const enough = reading >= (mechanism.threshold ?? 1);
        if (enough) mechanism.state = mechanism.latch === 'permanent' ? 1 : mechanism.latchFrames ?? 420;
        else if (mechanism.latch !== 'permanent' && mechanism.state > 0) mechanism.state--;
      } else if (mechanism.kind === 'brazier') {
        if (mechanism.state !== 1 && this.senseBrazier(mechanism)) mechanism.state = 1;
        if (mechanism.state === 1 && frame % 6 === 0) this.seedBrazierFire(mechanism);
      } else if (mechanism.kind === 'chargelatch' && mechanism.zone) {
        if (mechanism.state === 0 && this.senseCharge(mechanism)) mechanism.state = 1;
      } else if (mechanism.kind === 'counterweight' && mechanism.zone) {
        if (mechanism.state === 0) {
          const reading = this.senseZone(mechanism);
          mechanism.reading = reading;
          if (reading >= (mechanism.threshold ?? 30)) mechanism.state = 1;
        }
      } else if (mechanism.kind === 'plug') {
        this.stepPlug(mechanism, false);
      }
    }

    for (const actuator of this.mechanisms) {
      if (actuator.kind === 'relay') {
        this.stepRelay(actuator);
        continue;
      }
      if (actuator.kind !== 'door' && actuator.kind !== 'valve') continue;
      this.dissolveGate(actuator, actuator.kind === 'valve' ? 4 : 6);
      const triggers = this.mechanismTriggers.get(actuator.id) ?? [];
      if (triggers.length === 0) continue;
      const want = this.aggregateWant(actuator, triggers);
      if (actuator.kind === 'valve') this.stepValve(actuator, want);
      else if ((actuator.state === 1) !== want) this.setGateCells(actuator, want);
    }
    this.stepRuneVaults();
  }

  private stepValve(valve: Mechanism, want: boolean): void {
    const rising = want && valve.prevWant !== true;
    valve.prevWant = want;
    if (valve.state === 1) {
      if (valve.oneShot === true) return;
      if (valve.closeT !== undefined) {
        valve.closeT--;
        if (valve.closeT <= 0) {
          valve.closeT = undefined;
          this.setGateCells(valve, false);
        }
        return;
      }
      if (!want) this.setGateCells(valve, false);
      return;
    }
    const timed = valve.autoCloseFrames !== undefined && valve.autoCloseFrames > 0;
    if (timed ? rising : want) {
      this.setGateCells(valve, true);
      if (timed) valve.closeT = Math.max(1, Math.floor(valve.autoCloseFrames ?? 1));
    }
  }

  private stepRelay(relay: Mechanism): void {
    if (relay.state === 1 || relay.broken !== undefined) return;
    if (relay.fuseT === undefined) {
      const triggers = this.mechanismTriggers.get(relay.id) ?? [];
      if (triggers.length === 0 || !this.aggregateWant(relay, triggers)) return;
      relay.fuseT = Math.max(0, Math.floor(relay.delayFrames ?? 0));
    }
    if (relay.fuseT > 0) {
      relay.fuseT--;
      return;
    }
    this.fireRelay(relay);
  }

  private fireRelay(relay: Mechanism): void {
    relay.state = 1;
    relay.fuseT = undefined;
    const target = this.mechanisms.find((mechanism) => mechanism.id === relay.targetId);
    if (!target) return;
    const tx = Math.floor(target.x + target.w / 2);
    const ty = Math.floor(target.y + target.h / 2);
    const action = relay.outputAction ?? 'activate';
    if (action === 'break' && target.kind === 'plug') {
      this.stepPlug(target, true);
    } else if (action === 'ignite') {
      this.seedFireDisc(tx, ty);
    } else if (action === 'strike') {
      this.previewStructureStrike(tx, ty, 8);
    }
  }

  private previewStructureStrike(x: number, y: number, radius: number): void {
    const leverRadius = radius + 6;
    for (const mechanism of this.mechanisms) {
      if (mechanism.kind !== 'lever') continue;
      const dx = mechanism.x - x;
      const dy = mechanism.y - y;
      if (dx * dx + dy * dy <= leverRadius * leverRadius) {
        mechanism.state = mechanism.state === 1 ? 0 : 1;
      }
    }
    for (const vault of this.runeVaults) {
      if (vault.active) continue;
      const dx = vault.rx - x;
      const dy = vault.ry - y;
      if (dx * dx + dy * dy <= radius * radius) vault.active = true;
    }
  }

  private stepRuneVaults(): void {
    for (const vault of this.runeVaults) {
      if (!vault.active || vault.door.length === 0) continue;
      for (let n = 0; n < 3 && vault.door.length > 0; n++) {
        const [x, y] = vault.door.pop()!;
        if (!this.world.inBounds(x, y)) continue;
        const i = this.world.idx(x, y);
        if (this.world.types[i] === Cell.Stone) this.writeCell(i, Cell.Empty, EMPTY_COLOR);
      }
    }
  }

  private aggregateWant(actuator: Mechanism, triggers: Mechanism[]): boolean {
    if (actuator.logic === 'or') return triggers.some((trigger) => this.satisfied(trigger));
    if (actuator.logic === 'sequence') {
      if (actuator.seqDone === true) return true;
      const chain = triggers.filter((trigger) => trigger.broken !== 0);
      const fired = (actuator.seqFired ??= {});
      let cursor = 0;
      while (cursor < chain.length && fired[chain[cursor].id] === true) cursor++;
      if (cursor >= chain.length) {
        actuator.seqDone = true;
        return true;
      }
      const prev = (actuator.seqPrev ??= {});
      const edges = chain.map((trigger) => {
        const sat = this.satisfied(trigger);
        const edge = sat && prev[trigger.id] !== true;
        prev[trigger.id] = sat;
        return edge;
      });
      if (edges[cursor]) {
        fired[chain[cursor].id] = true;
        cursor++;
        if (cursor >= chain.length) actuator.seqDone = true;
      } else if (edges.some((edge, n) => edge && n > cursor)) {
        for (const key of Object.keys(fired)) delete fired[Number(key)];
        cursor = 0;
        for (const trigger of chain) {
          if (trigger.kind === 'plate' || trigger.kind === 'scale' || trigger.kind === 'buoy' || trigger.kind === 'lever') {
            trigger.state = 0;
            if (trigger.kind === 'plate') trigger.pressed = false;
          }
        }
      }
      actuator.seq = cursor;
      return actuator.seqDone === true;
    }
    return triggers.every((trigger) => this.satisfied(trigger));
  }

  private satisfied(trigger: Mechanism): boolean {
    if (trigger.broken === 0) return true;
    if (trigger.broken !== undefined) return false;
    switch (trigger.kind) {
      case 'lever':
      case 'brazier':
      case 'chargelatch':
      case 'plug':
      case 'counterweight':
      case 'relay':
        return trigger.state === 1;
      case 'plate':
        return trigger.pressed === true || trigger.state > 0;
      case 'scale':
      case 'buoy':
      case 'sensor':
        return trigger.state > 0;
      default:
        return false;
    }
  }

  private setGateCells(gate: Mechanism, open: boolean): void {
    gate.state = open ? 1 : 0;
    if (open) {
      const cells: Array<[number, number]> = [];
      for (let dy = 0; dy < gate.h; dy++) {
        for (let dx = 0; dx < gate.w; dx++) cells.push([gate.x + dx, gate.y + dy]);
      }
      gate.dissolve = cells;
      return;
    }
    gate.dissolve = undefined;
    const material = gate.kind === 'valve' ? gate.material ?? Cell.Metal : Cell.Metal;
    const fn = COLOR_FN[material];
    for (let dy = 0; dy < gate.h; dy++) {
      for (let dx = 0; dx < gate.w; dx++) {
        const x = gate.x + dx;
        const y = gate.y + dy;
        if (!this.world.inBounds(x, y)) continue;
        const i = this.world.idx(x, y);
        this.writeCell(i, material, fn ? fn() : EMPTY_COLOR);
      }
    }
  }

  private dissolveGate(gate: Mechanism, cellsPerFrame: number): void {
    if (!gate.dissolve || gate.dissolve.length === 0) return;
    for (let n = 0; n < cellsPerFrame && gate.dissolve.length > 0; n++) {
      const [x, y] = gate.dissolve.pop()!;
      if (!this.world.inBounds(x, y)) continue;
      const i = this.world.idx(x, y);
      this.writeCell(i, Cell.Empty, EMPTY_COLOR);
    }
    if (gate.dissolve.length === 0) gate.dissolve = undefined;
  }

  private sensePlate(mechanism: Mechanism): boolean {
    let weight = 0;
    for (let dx = 0; dx < mechanism.w; dx++) {
      for (let dy = 1; dy <= 2; dy++) {
        const x = mechanism.x + dx;
        const y = mechanism.y - dy;
        if (!this.world.inBounds(x, y)) continue;
        const type = this.world.types[this.world.idx(x, y)];
        if (type !== Cell.Empty && !isGas(type) && type !== Cell.Fire) weight++;
      }
    }
    return weight >= 3;
  }

  private senseZone(mechanism: Mechanism): number {
    const zone = mechanism.zone;
    if (!zone) return 0;
    let count = 0;
    const sensorType = mechanism.sensorType ?? (mechanism.kind === 'buoy' ? 'liquid' : 'weight');
    for (let y = zone.y0; y <= zone.y1; y++) {
      for (let x = zone.x0; x <= zone.x1; x++) {
        if (!this.world.inBounds(x, y)) continue;
        const i = this.world.idx(x, y);
        const type = this.world.types[i];
        if (sensorType === 'heat') {
          if (type === Cell.Fire || type === Cell.Lava || type === Cell.Ember) count++;
        } else if (sensorType === 'liquid') {
          if (isLiquid(type) && (!mechanism.materialFilter || mechanism.materialFilter.includes(type))) count++;
        } else if (sensorType === 'charge') {
          if (this.world.charge[i] > 0) count++;
        } else if (sensorType === 'material') {
          // A material sensor with no filter is an invalid configuration the
          // validator hard-errors on ('material sensor needs a filter material');
          // sense nothing deterministically so preview and validation agree
          // instead of relying on optional-chain falsiness.
          if (mechanism.materialFilter && mechanism.materialFilter.includes(type)) count++;
        } else if (type !== Cell.Empty && !isGas(type) && type !== Cell.Fire) {
          count++;
        }
      }
    }
    return count;
  }

  private senseCharge(mechanism: Mechanism): boolean {
    const zone = mechanism.zone;
    if (!zone) return false;
    for (let y = zone.y0; y <= zone.y1; y++) {
      for (let x = zone.x0; x <= zone.x1; x++) {
        if (!this.world.inBounds(x, y)) continue;
        if (this.world.charge[this.world.idx(x, y)] > 0) return true;
      }
    }
    return false;
  }

  private stepPlug(plug: Mechanism, demolish: boolean): void {
    if (plug.state === 1) return;
    const material = plug.material ?? Cell.Stone;
    if (!demolish && plug.body && plug.body.length > 0) {
      let intact = 0;
      for (const [x, y] of plug.body) {
        if (this.world.inBounds(x, y) && this.world.types[this.world.idx(x, y)] === material) intact++;
      }
      plug.reading = intact;
      const breakFrac = plug.breakFrac ?? 0.5;
      if (intact > plug.body.length * (1 - breakFrac)) return;
    }
    plug.state = 1;
    if (!demolish || !plug.body) return;
    for (const [x, y] of plug.body) {
      if (!this.world.inBounds(x, y)) continue;
      const i = this.world.idx(x, y);
      if (this.world.types[i] !== material) continue;
      this.writeCell(i, Cell.Empty, EMPTY_COLOR);
    }
  }

  private senseBrazier(mechanism: Mechanism): boolean {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -3; dy <= 1; dy++) {
        const x = mechanism.x + dx;
        const y = mechanism.y + dy;
        if (!this.world.inBounds(x, y)) continue;
        const type = this.world.types[this.world.idx(x, y)];
        if (type === Cell.Fire || type === Cell.Lava || type === Cell.Ember) return true;
      }
    }
    return false;
  }

  private seedBrazierFire(mechanism: Mechanism): void {
    const x = mechanism.x;
    const y = mechanism.y - 1;
    if (!this.world.inBounds(x, y)) return;
    const i = this.world.idx(x, y);
    if (this.world.types[i] !== Cell.Empty) return;
    const fn = COLOR_FN[Cell.Fire];
    this.writeCell(i, Cell.Fire, fn ? fn() : EMPTY_COLOR, 24);
  }

  private seedFireDisc(cx: number, cy: number): void {
    const fn = COLOR_FN[Cell.Fire];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.world.inBounds(x, y)) continue;
        const i = this.world.idx(x, y);
        if (this.world.types[i] !== Cell.Empty) continue;
        this.writeCell(i, Cell.Fire, fn ? fn() : EMPTY_COLOR, 24);
      }
    }
  }

  private writeCell(i: number, type: number, color: number, life = 0, charge = 0): void {
    const previous = this.world.types[i];
    this.world.types[i] = type;
    this.world.colors[i] = color;
    this.world.life[i] = life;
    this.world.charge[i] = charge;
    if (previous === Cell.Empty && type !== Cell.Empty) this.nonEmptyCells++;
    else if (previous !== Cell.Empty && type === Cell.Empty) this.nonEmptyCells--;
    this.updateDiff(i);
  }

  private updateDiff(i: number): void {
    const changed = this.world.types[i] !== this.sourceTypes[i] || this.world.colors[i] !== this.sourceColors[i];
    const wasChanged = this.diffMask[i] === 1;
    if (changed && !wasChanged) {
      this.diffMask[i] = 1;
      this.changedCells++;
    } else if (!changed && wasChanged) {
      this.diffMask[i] = 0;
      this.changedCells--;
    }
  }
}

function countNonEmpty(world: World): number {
  let count = 0;
  for (let i = 0; i < world.types.length; i++) {
    if (world.types[i] !== Cell.Empty) count++;
  }
  return count;
}

interface PreviewCapCounts {
  mechanisms: number;
  pickups: number;
  enemies: number;
  runeVaults: number;
  emitters: number;
  lights: number;
}

function previewCapReasons(counts: PreviewCapCounts): string[] {
  const reasons: string[] = [];
  if (counts.mechanisms > MAX_MECHANISMS) reasons.push('mechanisms');
  if (counts.pickups > MAX_PICKUPS) reasons.push('pickups');
  if (counts.enemies > MAX_PREVIEW_ENEMIES) reasons.push('enemies');
  if (counts.runeVaults > MAX_RUNE_VAULTS) reasons.push('rune links');
  if (counts.emitters > MAX_EMITTERS) reasons.push('emitters');
  if (counts.lights > AUTHORED_LIGHT_RUNTIME_CAP) reasons.push('lights');
  return reasons;
}

interface RuntimeView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function runtimeView(ctx: Ctx): RuntimeView {
  const cam = ctx.camera;
  const zoom = Math.max(0.001, cam.zoom);
  return {
    x0: cam.renderX + VIEW_W * (0.5 - 0.5 / zoom),
    y0: cam.renderY + VIEW_H * (0.5 - 0.5 / zoom),
    x1: cam.renderX + VIEW_W * (0.5 + 0.5 / zoom),
    y1: cam.renderY + VIEW_H * (0.5 + 0.5 / zoom),
  };
}

function inView(view: RuntimeView, x: number, y: number): boolean {
  return x >= view.x0 && x <= view.x1 && y >= view.y0 && y <= view.y1;
}

function boundsVisible(view: RuntimeView, bounds: RuntimeEntityBounds): boolean {
  return bounds.x1 >= view.x0 && bounds.x0 <= view.x1 && bounds.y1 >= view.y0 && bounds.y0 <= view.y1;
}

function previewEnemyId(enemy: PrefabEnemy, index: number): string {
  return `preview-enemy:${enemy.sourceId ?? `${enemy.kind}:${Math.round(enemy.x)}:${Math.round(enemy.y)}:${index}`}`;
}

function previewEnemyRow(ctx: Ctx, enemy: PrefabEnemy, index: number, view: RuntimeView): RuntimeEntityRow {
  const bounds = enemyBounds(ctx, enemy);
  return runtimeRow({
    id: previewEnemyId(enemy, index),
    group: 'enemies',
    kind: enemy.kind,
    label: enemy.kind,
    sublabel: `${fmt(enemy.x)}, ${fmt(enemy.y)} - preview spawn`,
    x: enemy.x,
    y: enemy.y,
    bounds,
    visible: boundsVisible(view, bounds),
    badges: [enemy.sleeping ? 'sleeping' : '', enemy.patrol && enemy.patrol.length > 0 ? 'patrol' : '', 'preview'].filter(Boolean),
    fields: [
      field('kind', enemy.kind),
      field('position', `${fmt(enemy.x)}, ${fmt(enemy.y)}`),
      field('source', enemy.sourceId ?? '-'),
      field('patrol points', String(enemy.patrol?.length ?? 0)),
    ],
  });
}

function enemyBounds(ctx: Ctx, enemy: PrefabEnemy): RuntimeEntityBounds {
  const def = (ctx.enemyCtl as Ctx['enemyCtl'] | undefined)?.defs[enemy.kind];
  return bodyBounds(enemy.x, enemy.y, def?.halfW ?? 5, def?.h ?? 8);
}

function previewPickupId(pickup: Pickup, index: number): string {
  return `preview-pickup:${pickup.kind}:${Math.round(pickup.x)}:${Math.round(pickup.y)}:${index}`;
}

function previewPickupRow(pickup: Pickup, index: number, view: RuntimeView): RuntimeEntityRow {
  const data = pickup.data.card ?? pickup.data.potion ?? pickup.data.amount ?? '';
  const bounds = pointBounds(pickup.x, pickup.y, 3);
  return runtimeRow({
    id: previewPickupId(pickup, index),
    group: 'pickups',
    kind: pickup.kind,
    label: pickup.kind,
    sublabel: `${fmt(pickup.x)}, ${fmt(pickup.y)}${data !== '' ? ` - ${data}` : ''}`,
    x: pickup.x,
    y: pickup.y,
    vx: pickup.vx,
    vy: pickup.vy,
    bounds,
    visible: inView(view, pickup.x, pickup.y),
    badges: ['preview'],
    fields: [
      field('kind', pickup.kind),
      field('position', `${fmt(pickup.x)}, ${fmt(pickup.y)}`),
      field('data', data === '' ? '-' : String(data)),
    ],
  });
}

function previewMechanismId(mechanism: Mechanism): string {
  return `preview-mechanism:${mechanism.id}`;
}

function previewMechanismRow(mechanism: Mechanism, view: RuntimeView): RuntimeEntityRow {
  const bounds = mechanismBounds(mechanism);
  return runtimeRow({
    id: previewMechanismId(mechanism),
    group: 'mechanisms',
    kind: mechanism.kind,
    label: `${mechanism.kind} #${mechanism.id}`,
    sublabel: `${fmt(mechanism.x)}, ${fmt(mechanism.y)} - state ${fmt(mechanism.state)}`,
    x: mechanism.x,
    y: mechanism.y,
    state: mechanism.state,
    bounds,
    visible: boundsVisible(view, bounds),
    badges: [
      mechanism.logic ? `logic ${mechanism.logic}` : '',
      mechanism.pressed ? 'pressed' : '',
      mechanism.seqDone ? 'sequence done' : '',
      'preview',
    ].filter(Boolean),
    fields: [
      field('id', String(mechanism.id)),
      field('kind', mechanism.kind),
      field('position', `${fmt(mechanism.x)}, ${fmt(mechanism.y)}`),
      field('size', `${mechanism.w} x ${mechanism.h}`),
      field('state', fmt(mechanism.state)),
      field('target', mechanism.targetId === undefined ? '-' : String(mechanism.targetId)),
      field('logic', mechanism.logic ?? '-'),
    ],
  });
}

function previewPortalRow(portal: ExitPortal, view: RuntimeView): RuntimeEntityRow {
  const bounds = { x0: portal.x - 5, y0: portal.y - 14, x1: portal.x + 6, y1: portal.y + 1 };
  return runtimeRow({
    id: 'preview-portal',
    group: 'portal',
    kind: 'portal',
    label: 'Exit Portal',
    sublabel: `${fmt(portal.x)}, ${fmt(portal.y)} - ${portal.open ? 'open' : 'closed'}`,
    x: portal.x,
    y: portal.y,
    bounds,
    visible: inView(view, portal.x, portal.y),
    badges: [portal.open ? 'open' : 'closed', 'preview'],
    fields: [
      field('position', `${fmt(portal.x)}, ${fmt(portal.y)}`),
      field('open', portal.open ? 'yes' : 'no'),
    ],
  });
}

function mechanismBounds(mechanism: Mechanism): RuntimeEntityBounds {
  if (mechanism.body && mechanism.body.length > 0) {
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const [x, y] of mechanism.body) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
    return { x0, y0, x1, y1 };
  }
  if (mechanism.zone) {
    return {
      x0: mechanism.zone.x0,
      y0: mechanism.zone.y0,
      x1: mechanism.zone.x1 + 1,
      y1: mechanism.zone.y1 + 1,
    };
  }
  const x0 = Math.min(mechanism.x, mechanism.x + mechanism.w);
  const x1 = Math.max(mechanism.x, mechanism.x + mechanism.w);
  const y0 = Math.min(mechanism.y, mechanism.y + mechanism.h);
  const y1 = Math.max(mechanism.y, mechanism.y + mechanism.h);
  return { x0, y0, x1, y1 };
}

function bodyBounds(x: number, y: number, halfW: number, h: number): RuntimeEntityBounds {
  return {
    x0: x - halfW,
    y0: y - h + 1,
    x1: x + halfW + 1,
    y1: y + 1,
  };
}

function pointBounds(x: number, y: number, radius: number): RuntimeEntityBounds {
  return {
    x0: x - radius,
    y0: y - radius,
    x1: x + radius + 1,
    y1: y + radius + 1,
  };
}

function runtimeRow(input: Omit<RuntimeEntityRow, 'searchText'>): RuntimeEntityRow {
  const searchText = normalize([
    input.id,
    input.group,
    input.kind,
    input.label,
    input.sublabel,
    ...input.badges,
    ...input.fields.map((entry) => `${entry.label} ${entry.value}`),
  ].join(' '));
  return { ...input, searchText };
}

function field(label: string, value: string): { label: string; value: string } {
  return { label, value };
}

function fmt(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : String(n);
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function rebuildChangedMask(world: World, sourceTypes: Uint8Array, sourceColors: Uint32Array, diffMask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < world.types.length; i++) {
    if (world.types[i] !== sourceTypes[i] || world.colors[i] !== sourceColors[i]) {
      diffMask[i] = 1;
      count++;
    } else {
      diffMask[i] = 0;
    }
  }
  return count;
}

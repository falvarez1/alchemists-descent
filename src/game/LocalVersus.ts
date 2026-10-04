import type { Ctx } from '@/core/types';
import type { VersusApi, VersusDevice, VersusPhase, VersusSeat } from '@/core/versus';
import { FIGHTER_ORDER, type FighterId } from '@/content/fighters';
import { STOCK_STAGE } from '@/config/stockStage';
import { resetDuelStage } from '@/world/duelStage';
import { botDriverFor, rivalDriverFor } from '@/arena/ai/driver';
import { readVersusPad, VersusDevices } from '@/input/versusDevices';
import { applyStockPad } from '@/input/stockPad';
import { setExternalControl } from '@/input/externalControl';
import { clampAiLevel } from '@/config/aiTiers';

/** Composes disposable local matches. Expedition saves remain owned by Levels. */
export class LocalVersus implements VersusApi {
  phase: VersusPhase = 'idle';
  message = '';
  readonly seats: [VersusSeat, VersusSeat] = [
    { fighter: 'ilyra-voss', device: 'keyboard', ready: false, cpuLevel: 3 },
    { fighter: 'brann-rook', device: 'cpu', ready: true, cpuLevel: 3 },
  ];
  private readonly ownership = new VersusDevices();
  private readonly buttons = new Map<number, Uint8Array>();
  private readonly offs: Array<() => void> = [];
  private revision = 0;
  private connectedKey = '';
  private pausedBeforeDisconnect = false;
  private openedBefore = false;
  get active(): boolean { return this.phase !== 'idle'; }
  get devices() { return this.ownership.available; }
  get disconnected(): readonly number[] { return this.ownership.missing; }
  get canStart(): boolean { return this.phase === 'lobby' && this.seats.every(s => s.ready) && this.disconnected.length === 0; }

  constructor(private readonly ctx: Ctx, private readonly playReady: () => Promise<boolean>) {
    this.offs.push(ctx.events.on('modeChanged', ({ mode }) => { if (mode !== 'play' && this.phase !== 'lobby') this.close(); }));
    this.offs.push(ctx.events.on('levelChanged', () => { if (this.active && this.phase !== 'loading') this.close(); }));
  }
  private changed(): void { this.ctx.events.emit('versusChanged'); }
  private release(): void {
    this.ctx.input.releaseHeldInput?.();
    for (let slot = 0; slot < 2; slot++) {
      const b = this.ctx.arena?.bundle(slot);
      if (!b) continue;
      for (const key of Object.keys(b.input.keys) as Array<keyof typeof b.input.keys>) b.input.keys[key] = false;
      b.input.queuedJump = undefined; b.input.queuedDodge = false;
      b.input.shieldHeld = false;
      b.input.queuedRecovery = false;
      b.input.pourHeld = b.input.siphonHeld = b.input.drinkHeld = false;
      b.player.firing = b.player.firePressed = false;
      b.fighters.releaseInputs?.();
    }
  }
  open(): void {
    this.revision++; this.release(); this.phase = 'lobby'; this.message = '';
    if (!this.openedBefore) {
      const controller = this.ownership.available.find(d => d.device.startsWith('pad:'));
      if (controller && this.ownership.assign(0, controller.device)) this.seats[0].device = controller.device;
      this.openedBefore = true;
    }
    this.ctx.state.paused = true;
    for (const seat of this.seats) seat.ready = seat.device === 'cpu';
    this.changed();
  }
  close(): void {
    if (!this.active) return;
    this.revision++; this.release(); botDriverFor(this.ctx).off();
    this.ctx.arena?.removeRival(1); this.ctx.arena?.configureStocks(null);
    setExternalControl(this.ctx.input, false);
    this.phase = 'idle'; this.message = ''; this.changed();
  }
  chooseFighter(slot: number, fighter: FighterId): void {
    if (this.phase !== 'lobby' || !this.seats[slot] || !FIGHTER_ORDER.includes(fighter)) return;
    this.seats[slot].fighter = fighter; this.seats[slot].ready = this.seats[slot].device === 'cpu'; this.changed();
  }
  chooseDevice(slot: number, device: VersusDevice): boolean {
    if (this.phase !== 'lobby' || !this.ownership.assign(slot, device)) return false;
    this.seats[slot].device = device; this.seats[slot].ready = device === 'cpu'; this.changed(); return true;
  }
  ready(slot: number): void {
    const seat = this.seats[slot];
    if (this.phase !== 'lobby' || !seat || this.disconnected.includes(slot) || seat.device === 'cpu') return;
    seat.ready = !seat.ready; this.changed();
  }
  chooseDifficulty(slot: number, level: number): void {
    if (this.phase !== 'lobby' || !this.seats[slot]) return;
    this.seats[slot].cpuLevel = clampAiLevel(level); this.changed();
  }
  async start(): Promise<boolean> {
    const ctx = this.ctx, arena = ctx.arena;
    if (!this.canStart || !arena) return false;
    const revision = ++this.revision;
    this.phase = 'loading'; this.message = 'Opening the Foundry…'; this.changed();
    try {
      if (!(await this.playReady())) throw new Error('The game could not finish loading. Try again.');
      if (revision !== this.revision) return false;
      const result = ctx.levels.startRun(ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'fighter-duel', fighter: this.seats[0].fighter, loadout: 'advanced', difficulty: 3, presentation: 'versus' });
      ctx.state.paused = true;
      if (!result.ok) throw new Error(result.message);
      await ctx.fighters?.whenReady();
      if (revision !== this.revision) return false;
      arena.configureStocks(STOCK_STAGE.zone); resetDuelStage(ctx); arena.setSpawns(STOCK_STAGE.spawns);
      const spawn = STOCK_STAGE.spawns[1];
      const joined = await arena.addRival(this.seats[1].fighter, spawn.x, spawn.y);
      if (revision !== this.revision) return false;
      if (joined < 0) throw new Error('The rival could not join. Try the match again.');
      arena.reset();
      botDriverFor(ctx).off(); rivalDriverFor(ctx, 1)?.off();
      for (let slot = 0; slot < 2; slot++) if (this.seats[slot].device === 'cpu') {
        (slot === 0 ? botDriverFor(ctx) : rivalDriverFor(ctx, slot))?.install('basic', this.seats[slot].cpuLevel);
      }
      this.release(); setExternalControl(ctx.input, this.seats[0].device !== 'keyboard');
      this.phase = 'playing'; this.message = ''; ctx.state.paused = false; this.changed(); return true;
    } catch (error) {
      if (revision === this.revision) { this.phase = 'lobby'; this.message = error instanceof Error ? error.message : 'Could not open the match.'; ctx.state.paused = true; this.changed(); }
      return false;
    }
  }
  rematch(): void {
    if (this.phase !== 'playing' || !this.ctx.arena?.active) return;
    this.release(); resetDuelStage(this.ctx); this.ctx.arena.reset(); this.changed();
  }
  resume(): void {
    if (this.phase !== 'reconnect' || this.disconnected.length > 0) return;
    this.release(); this.phase = 'playing'; this.ctx.state.paused = this.pausedBeforeDisconnect; this.message = ''; this.changed();
  }
  poll(pads: readonly (Gamepad | null)[], blocked: boolean): boolean {
    this.ownership.update(pads);
    const key = this.devices.map(d => d.device).join('|');
    if (key !== this.connectedKey) { this.connectedKey = key; if (this.active) this.changed(); }
    if (!this.active) return false;
    if (this.phase === 'playing' && this.disconnected.length > 0) {
      this.pausedBeforeDisconnect = this.ctx.state.paused; this.ctx.state.paused = true; this.phase = 'reconnect'; this.release(); this.changed();
    }
    if (this.phase === 'reconnect') this.ctx.state.paused = true;
    for (const pad of pads) {
      if (!pad?.connected || pad.mapping !== 'standard') continue;
      let previous = this.buttons.get(pad.index);
      if (!previous) { previous = new Uint8Array(20); this.buttons.set(pad.index, previous); }
      const action = readVersusPad(pad, previous, this.ctx.state.padDeadzone ?? .2);
      let slot = this.seats.findIndex(s => s.device === `pad:${pad.index}`);
      if (this.phase === 'lobby') {
        if (slot < 0 && action.confirm) {
          slot = this.ownership.join(pad.index);
          if (slot >= 0) { this.seats[slot].device = `pad:${pad.index}`; this.seats[slot].ready = false; this.changed(); }
          continue;
        }
        if (slot < 0) continue;
        const seat = this.seats[slot];
        if ((action.previous || action.next) && !seat.ready) this.chooseFighter(slot, FIGHTER_ORDER[(FIGHTER_ORDER.indexOf(seat.fighter) + (action.next ? 1 : FIGHTER_ORDER.length - 1)) % FIGHTER_ORDER.length]);
        if (action.confirm) this.ready(slot);
        if (action.back && seat.ready) this.ready(slot);
        if (action.pause && this.canStart) void this.start();
      } else if (slot >= 0 && this.phase === 'reconnect' && action.pause) this.resume();
      else if (slot >= 0 && this.phase === 'playing') {
        if (action.pause) this.ctx.events.emit('versusPause');
        if (blocked || this.ctx.state.paused || this.ctx.arena?.stockMatch?.state === 'finished') {
          const menuAction = action.confirm ? 'confirm' : action.back ? 'back' : action.menuPrevious ? 'previous' : action.menuNext ? 'next' : null;
          if (menuAction) this.ctx.events.emit('versusMenu', { action: menuAction });
          this.release(); continue;
        }
        this.ctx.arena?.with(slot, () => applyStockPad(this.ctx, action));
      }
    }
    return true;
  }
  dispose(): void { this.close(); for (const off of this.offs) off(); }
}

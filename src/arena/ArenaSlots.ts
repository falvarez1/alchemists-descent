import { playerBlow } from '@/core/bossWard';
import type { ArenaApi, Bout, BundleFactory, RivalPhase, SlotBundle } from '@/core/arena';
import type { FighterId } from '@/content/fighters';
import type { Ctx, Enemy, EnemyDamageSource, EntityStatus, Projectile } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { FIGHTER_LOADOUTS, loadoutSave } from '@/content/fighterLoadouts';
import { ARENA_RULES } from '@/config/arenaRules';
import { STOCK_RULES, stockCountdownBeat, stockHitstopTicks } from '@/config/stockRules';
import type { BlastZone, StockLedgeInput, StockMatchView } from '@/core/arenaMatch';
import { MatchDirector, stockLaunch, influenceLaunch } from '@/arena/MatchDirector';
import { StockDodge } from '@/arena/StockDodge';
import { StockShield } from '@/arena/StockShield';
import { StockGrab } from '@/arena/StockGrab';
import { StockSpecial } from '@/arena/StockSpecial';
import { StockLedge } from '@/arena/StockLedge';
import { StockAttack, stockAttackOverlaps } from '@/arena/StockAttack';
import { stockMoveset } from '@/config/stockAttacks';
import type { StockAttackKind, StockAttackSpec } from '@/core/stockAttacks';
import { DEFAULT_STOCK_STAGE, STOCK_STAGES, type StockStageDef, type StockStageId } from '@/config/stockStage';
import { earthStockStage } from '@/arena/stockEarthing';

/**
 * ARENA SLOTS (docs/arena/ARCHITECTURE.md, D-001): two fighters in one world.
 *
 * A slot is one fighter's bundle (player, input, controller, wands, flask, fighter system, chill). Whichever slot is BOUND has its
 * bundle installed on the base `Ctx`, so every shared system reads the acting fighter as it reads the lone Alchemist. The other
 * fighter appears to the bound slot as one `Enemy` (the STAND-IN, kind 'fighter'): its position, velocity, health, grounding and
 * status are copied from the real body each time the binding changes, and what an attacker does to it (a blow, a shove, a velocity
 * written, a stun, a slow) is carried back to the real body. A blow aimed at the stand-in is handed to `Enemies.damage`'s redirect
 * (`hit`), which runs the victim's own `playerCtl.damage` under the victim's binding.
 *
 * Deviation from the design (recorded in ARCHITECTURE.md 10): ONE stand-in object serves both directions (it is rewritten to mirror
 * "the opponent of the bound slot" at each binding change) instead of one per slot toggled in and out of `ctx.enemies`. With two
 * fighters that is equivalent, and it never mutates `ctx.enemies` while a system is iterating it. More than two fighters need one
 * stand-in per slot and the toggling the design describes.
 *
 * The exactly-once rule holds because the bound slot never sees itself: the stand-in always mirrors the OTHER fighter, and a blow to a
 * stand-in whose slot is the bound slot is dropped.
 */

interface Slot {
  bundle: SlotBundle;
  /** Run when the slot's fighter is removed. */
  onRemoved: Array<() => void>;
  /** A scripted drive or a brain: called once a tick under this slot's binding, before its body phase. */
  driver: (() => void) | null;
  /** Gate: may this slot run its body this tick (a foe's slow is TIME, so a slowed fighter runs a fraction of its ticks). */
  runs: boolean;
}

const OPPONENT_WINDOW = 90; // a fall or a hazard within this many ticks of a blow still counts as the blow's doing
/** Stock: a victim standing when struck has this long to be launched before touching ground counts as landing. */
const LAUNCH_GRACE = 10;

function newStand(): Enemy {
  return {
    kind: 'fighter',
    fighter: 1,
    x: 0, y: 0, fx: 0, fy: 0, vx: 0, vy: 0,
    hp: 100, maxHp: 100, dmgK: 1, flash: 0,
    timer: 0, attackCd: 0, bobPhase: 0,
    grounded: false, stride: 0, splat: 0, prevG: false, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
    status: undefined as unknown as EntityStatus,
  };
}

export class ArenaSlots implements ArenaApi {
  private match: MatchDirector | null = null;
  private readonly launchTicks = [0, 0];
  private readonly specials = [new StockSpecial(), new StockSpecial()];
  private readonly dodges = [new StockDodge(), new StockDodge()];
  private readonly shields = [new StockShield(), new StockShield()];
  private readonly grabs = [new StockGrab(), new StockGrab()];
  private readonly ledges = [new StockLedge(), new StockLedge()];
  private readonly attacks = [new StockAttack(), new StockAttack()];
  private readonly recovery = [{ used: false, held: false, ticks: 0 }, { used: false, held: false, ticks: 0 }];
  get stockMatch(): StockMatchView | null { return this.match; }
  private stageId: StockStageId = DEFAULT_STOCK_STAGE;
  get stockStage(): StockStageDef { return STOCK_STAGES[this.stageId]; }
  selectStockStage(id: StockStageId): void { if (STOCK_STAGES[id]) this.stageId = id; }

  configureStocks(zone: BlastZone | null): void {
    this.match = zone ? new MatchDirector(STOCK_RULES, { ...zone }) : null;
    this.launchTicks.fill(0);
    for (const dodge of this.dodges) dodge.reset();
    for (const shield of this.shields) shield.reset();
    for (const grab of this.grabs) grab.reset();
    for (const special of this.specials) special.reset();
    for (const ledge of this.ledges) ledge.reset();
    for (const attack of this.attacks) attack.reset();
    if (this.active) this.reset();
  }

  isLaunching(slot: number): boolean { return this.active && this.match !== null && this.launchTicks[slot] > 0; }
  stockDodge(slot: number): StockDodge | null { return this.match ? this.dodges[slot] ?? null : null; }
  canRecover(slot: number): boolean { return this.match !== null && this.recovery[slot]?.used === false; }
  isRecovering(slot: number): boolean { return this.match !== null && (this.recovery[slot]?.ticks ?? 0) > 0; }
  isEvading(slot: number): boolean { return this.active && this.match !== null && (this.dodges[slot]?.evading === true || this.ledges[slot]?.protected === true); }
  isActionLocked(slot: number): boolean { return this.match !== null && (!this.runsBody(slot) || this.isLaunching(slot) || this.specials[slot]?.busy === true || this.dodges[slot]?.busy === true || this.shields[slot]?.busy === true || this.attacks[slot]?.busy === true || this.ledges[slot]?.busy === true || this.grabs[slot]?.busy === true || this.isGrabbed(slot)); }
  stockSpecial(slot: number): StockSpecial | null { return this.match ? this.specials[slot] ?? null : null; }
  canStockSpecial(cost: 1 | 2 = 1): boolean {
    return !this.match || (this.active && !this.isActionLocked(this.boundSlot) && !this.ctx.player.dead && this.ctx.player.stunT <= 0 && this.specials[this.boundSlot].canSpend(cost));
  }
  spendStockSpecial(cost: 1 | 2 = 1): boolean { return this.canStockSpecial(cost) && (!this.match || this.specials[this.boundSlot].spend(cost)); }
  refundStockSpecial(cost: 1 | 2 = 1): void { if (this.match) this.specials[this.boundSlot].refund(cost); }
  stockGrab(slot: number): StockGrab | null { return this.match ? this.grabs[slot] ?? null : null; }
  isGrabbed(slot: number): boolean { return this.match !== null && this.grabs.some(g => g.victim === slot); }
  requestStockGrab(): boolean {
    const slot = this.boundSlot, b = this.slots[slot]?.bundle;
    if (!b || !this.match || !this.runsBody(slot) || this.isLaunching(slot) || this.isGrabbed(slot) ||
      this.specials[slot].busy || this.attacks[slot].busy || this.dodges[slot].busy || this.ledges[slot].busy || !this.shields[slot].canDodge ||
      !b.player.grounded || b.player.dead || b.player.stunT > 0 || b.fighters.ownsMovement || b.player.climbing || b.player.recharge > 0 || b.player.pullT > 0 || (b.player.chill?.shell ?? 0) > 0) return false;
    const k = b.input.keys, facing = k.left !== k.right ? (k.left ? -1 : 1) : b.player.facing;
    if (!this.grabs[slot].start(facing)) return false;
    this.shields[slot].drop(); b.player.firing = b.player.firePressed = false; b.wands.clearTransientState?.(); return true;
  }
  stockShield(slot: number): StockShield | null { return this.match ? this.shields[slot] ?? null : null; }
  updateStockShield(held: boolean, canAct: boolean): StockShield | null {
    if (!this.active || !this.match) return null;
    const slot = this.boundSlot, b = this.slots[slot]!.bundle, shield = this.shields[slot];
    shield.step(held, canAct && this.runsBody(slot) && !this.isLaunching(slot) && !b.player.dead &&
      !b.player.climbing && !b.fighters.ownsMovement && !this.specials[slot].busy && !this.dodges[slot].busy && !this.attacks[slot].busy && !this.ledges[slot].busy && !this.grabs[slot].busy && !this.isGrabbed(slot), b.player.grounded);
    if (shield.busy) { b.player.firing = b.player.firePressed = false; b.wands.clearTransientState?.(); }
    return shield;
  }
  blockStockHit(amount: number): boolean {
    const slot = this.boundSlot;
    if (!this.active || !this.match || !this.blow || this.blow.by === slot || !this.shields[slot].block(amount)) return false;
    this.ctx.audio.sfx(this.shields[slot].phase === 'broken' ? 'arena.shield.break' : 'arena.shield.block');
    if (this.shields[slot].phase === 'broken') this.ctx.events.emit('stockShieldBreak', { slot });
    return true;
  }
  stockLedge(slot: number): StockLedge | null { return this.match ? this.ledges[slot] ?? null : null; }
  updateStockLedge(canAct: boolean, keys: StockLedgeInput = { dir: 0, up: false, down: false, jump: false }): boolean {
    if (!this.active || !this.match) return false;
    const slot = this.boundSlot, b = this.slots[slot]!.bundle, p = b.player;
    const next = this.ledges[slot].step(p, keys, canAct && this.runsBody(slot) && !this.isLaunching(slot) &&
      !p.dead && !p.climbing && !this.dodges[slot].busy && !this.attacks[slot].busy && !this.grabs[slot].busy && !this.isGrabbed(slot),
    (x, y) => this.ctx.physics.cellBlocks(x, y), (x, y) => this.ctx.physics.entityFree(x, y, PLAYER_HALF_W, PLAYER_H));
    if (!next) return false;
    Object.assign(p, next, { fx: 0, fy: 0, diveT: 0, stockFastFall: false, crawling: false, levitating: false });
    p.firing = p.firePressed = false; b.wands.clearTransientState?.();
    return true;
  }
  stockAttack(slot: number): StockAttack | null { return this.match ? this.attacks[slot] ?? null : null; }
  requestStockAttack(requestedKind?: StockAttackKind, requestedFacing?: number): boolean {
    const slot = this.boundSlot, b = this.slots[slot]?.bundle;
    if (!b || !this.match || this.isActionLocked(slot) || b.player.dead || b.player.stunT > 0 || b.fighters.ownsMovement ||
      b.player.climbing || b.player.recharge > 0 || b.player.pullT > 0 || (b.player.chill?.shell ?? 0) > 0) return false;
    const keys = b.input.keys;
    const kind: StockAttackKind = !b.player.grounded ? 'aerial' : requestedKind ?? (keys.up ? 'launcher' : keys.down ? 'finisher' : 'opener');
    const facing = requestedFacing || (keys.left !== keys.right ? (keys.left ? -1 : 1) : b.player.facing);
    const base = stockMoveset(b.fighters.id)[kind];
    const spec = requestedKind === 'launcher' && b.player.grounded
      ? { ...base, name: 'Up smash', startup: Math.round(base.startup * 1.8), recovery: Math.round(base.recovery * 1.5), damage: base.damage * 1.4, growth: base.growth * 1.8 }
      : base;
    if (!this.attacks[slot].start(kind, spec, facing)) return false;
    b.player.firing = b.player.firePressed = false; b.wands.clearTransientState?.();
    return true;
  }
  updateStockAttack(canAct: boolean): StockAttack | null {
    if (!this.active || !this.match) return null;
    const slot = this.boundSlot, attack = this.attacks[slot];
    attack.step(canAct && this.runsBody(slot) && !this.isLaunching(slot)); return attack;
  }

  updateStockDodge(requested: boolean, canAct: boolean): StockDodge | null {
    if (!this.active || !this.match) return null;
    const slot = this.boundSlot, b = this.slots[slot]!.bundle, d = this.dodges[slot];
    const k = b.input.keys;
    const wasBusy = d.busy;
    d.step(requested, canAct && this.runsBody(slot) && !this.isLaunching(slot) && !this.specials[slot].busy && !this.attacks[slot].busy && !this.ledges[slot].busy && !this.grabs[slot].busy && !this.isGrabbed(slot) && this.shields[slot].canDodge, b.player.grounded, Number(k.right) - Number(k.left), Number(k.down) - Number(k.up));
    if (!wasBusy && d.busy) { this.shields[slot].drop(); b.wands.clearTransientState?.(); }
    return d;
  }

  updateStockRecovery(requested: boolean): boolean {
    if (!this.active || !this.match) return false;
    const slot = this.boundSlot, r = this.recovery[slot], p = this.slots[slot]!.bundle.player;
    const input = this.slots[slot]!.bundle.input, queued = input.queuedRecovery === true;
    input.queuedRecovery = false;
    const fresh = requested && !r.held;
    r.held = requested;
    if (p.grounded && !this.isLaunching(slot)) { r.used = false; r.ticks = 0; }
    if (r.ticks > 0) r.ticks--;
    if ((fresh || queued) && (!p.grounded || queued) && !p.dead && p.stunT <= 0 && !r.used && !this.isActionLocked(slot)) {
      r.used = true; r.ticks = 18;
      p.vy = -7.5; p.diveT = 0; p.climbing = false; p.grounded = false;
      p.levit = Math.max(0, p.levit - 12);
      this.ctx.audio.sfx('player.jump');
    }
    return r.ticks > 0;
  }

  takeStockDamage(amount: number, kx: number, ky: number): boolean {
    if (!this.active || !this.match) return false;
    const slot = this.boundSlot, rec = this.slots[slot];
    if (this.isEvading(slot)) return true;
    if (!rec || !this.match.hurt(slot, amount)) return true;
    this.grabs[slot].reset();
    for (const grab of this.grabs) if (grab.victim === slot) grab.release();
    const p = rec.bundle.player;
    const blow = this.activeBlow;
    this.ctx.events.emit('fighterHit', { by: blow?.by ?? slot, victim: slot, damage: amount, tick: this.ctx.state.frameCount, attack: blow?.tag ?? 'world' });
    if (p.status.stoneskin <= 0 && !rec.bundle.fighters.staggerResist) {
      const launch = stockLaunch(kx, ky, amount, this.match.fighters[slot].volatility, rec.bundle.fighters.body.mass ?? 1, blow?.growth, blow?.stun);
      if (launch.stun > 0) {
        const k = rec.bundle.input.keys;
        const influenced = influenceLaunch(launch.x, launch.y, Number(k.right) - Number(k.left), Number(k.down) - Number(k.up));
        p.vx = influenced.x; p.vy = influenced.y; p.grounded = false;
        p.climbing = false; p.crawling = false; p.diveT = 0;
        p.stunT = Math.max(p.stunT, launch.stun);
        this.launchTicks[slot] = launch.stun;
        this.attacks[slot].reset();
        this.shields[slot].drop();
        this.ledges[slot].cancel();
      }
    }
    return true;
  }
  private readonly slots: Array<Slot | undefined> = [];
  private boundSlot = 0;
  private readonly stand: Enemy = newStand();
  private inEnemies = false;
  /** Which slot the stand-in mirrors right now, and the values it was last given (to see what an attacker changed). */
  private standFor = 1;
  private readonly sent = { x: 0, y: 0, vx: 0, vy: 0 };
  private spawns: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  /** The last blow on each slot, and whether the victim has landed (or caught a ledge) since: a stock ring-out credits the
   *  hitter for as long as the victim has not, however long the fall (the platform-fighter convention). */
  private readonly lastBlow: Array<{ by: number; at: number; landed: boolean }> = [{ by: -1, at: -1e9, landed: true }, { by: -1, at: -1e9, landed: true }];
  /** The last stockMatchBeat announced (state|count), so each beat is said once. */
  private lastBeat = '';
  private readonly focus = { x: 0, y: 0 };
  private ownerBound = false;
  readonly bout: Bout = { state: 'idle', winner: null, startedAt: -1, endedAt: -1, downs: [] };
  private blow: ArenaApi['activeBlow'] = null;
  /**
   * Each fighter carries ITS signature wands, cards and flasks (content/fighterLoadouts) instead of the run's: the primary attack is
   * where 80% of the damage comes from, so it is where a fighter's style has to live. Off: both fight with slot 0's.
   */
  signatureLoadouts = true;

  get activeBlow(): ArenaApi['activeBlow'] { return this.blow; }

  constructor(private readonly ctx: Ctx, private readonly factory: BundleFactory) {
    // A new floor is a new world: the rival stays behind with the old one.
    ctx.events.on('levelChanged', () => { if (this.active) this.removeRival(1); this.match = null; this.launchTicks.fill(0); });
  }

  // ================================================================================== the slots

  get active(): boolean { return this.slots.length > 1; }
  get bound(): number { return this.boundSlot; }
  get slotCount(): number { return this.slots.length; }

  bundle(slot: number): SlotBundle | undefined { return this.slots[slot]?.bundle; }

  fighterId(slot: number): FighterId | null { return this.slots[slot]?.bundle.fighters.id ?? null; }

  private ensureBase(): void {
    if (this.slots[0]) return;
    const c = this.ctx;
    this.slots[0] = {
      bundle: { player: c.player, input: c.input, playerCtl: c.playerCtl, wands: c.wands, flask: c.flask, fighters: c.fighters!, chill: c.chill },
      onRemoved: [],
      driver: null,
      runs: true,
    };
  }

  /** A rival is being built (its kit is loading): a second `addRival` in that window waits for it instead of tearing it down. */
  private adding: Promise<number> | null = null;
  private removalVersion = 0;

  async addRival(id: FighterId, x: number, y: number): Promise<number> {
    const version = this.removalVersion;
    while (this.adding !== null) {
      await this.adding.catch(() => -1);
      if (version !== this.removalVersion) return -1;
    }
    const job = this.build(id, x, y);
    this.adding = job;
    try { return await job; } finally { if (this.adding === job) this.adding = null; }
  }

  private async build(id: FighterId, x: number, y: number): Promise<number> {
    this.ensureBase();
    if (this.slots.length > 1) this.removeRival(1);
    const slot = this.slots.length;
    const bundle = this.factory(slot);
    this.slots[slot] = { bundle, onRemoved: [], driver: null, runs: true };
    this.matchLoadout(this.slots[0]!.bundle, bundle);
    const f = bundle.fighters;
    // The kit's chunk lands later: its creation (and every subscription it makes) must happen under this slot's binding.
    f.bindScope = (fn) => { this.with(slot, fn); };
    this.ctx.events.scoped = true;
    this.with(slot, () => { f.equip(id); });
    await f.whenReady();
    // Removal or a level change may have disposed this bundle while its kit loaded.
    if (this.slots[slot]?.bundle !== bundle) return -1;
    this.applySignature(this.slots[0]!.bundle);
    this.applySignature(bundle);
    this.spawns[slot] = { x, y };
    this.with(slot, () => { this.respawnBody(bundle, x, y); });
    this.attachStand();
    this.bout.state = 'fighting';
    this.bout.winner = null;
    this.bout.startedAt = this.ctx.state.frameCount;
    this.bout.endedAt = -1;
    this.bout.downs.length = 0;
    this.match?.start(this.slots.length);
    this.syncStand();
    return slot;
  }

  /**
   * The rival fights with what slot 0 carries: the same health and levitation BEFORE the fighter's body scales them, the same wands,
   * cards and flasks. A fight between two kits and two bodies, not between two armouries or two health pools. (A fresh player is 100 hp
   * and the run's test kit raised slot 0's: without this the rival was a third weaker, and slot 0 won nine fights in ten.)
   */
  private matchLoadout(from: SlotBundle, to: SlotBundle): void {
    const body = from.fighters.body;
    to.player.maxHp = Math.max(1, Math.round(from.player.maxHp / (body.maxHp || 1)));
    to.player.hp = to.player.maxHp;
    to.player.maxLevit = from.player.maxLevit / (body.jetFuel || 1);
    to.player.levit = to.player.maxLevit;
    to.wands.loadLoadout(from.wands.snapshotLoadout());
    to.flask.clearSlots();
    from.flask.slots.forEach((s, i) => { to.flask.setSlot(i, s.material, s.count); });
  }

  /** Install a fighter's own wands, cards and flask belt (when signature loadouts are on and it is one of the ten). */
  private applySignature(b: SlotBundle): void {
    const id = b.fighters.id;
    if (!this.signatureLoadouts || id === null) return;
    b.wands.loadLoadout(loadoutSave(id));
    b.flask.clearSlots();
    FIGHTER_LOADOUTS[id].flasks.forEach((f, i) => { b.flask.setSlot(i, f.material, f.count); });
  }

  removeRival(slot: number): void {
    const rec = this.slots[slot];
    if (!rec || slot === 0) return;
    this.removalVersion++;
    this.with(0, () => undefined);
    this.detachStand();
    for (const fn of rec.onRemoved.splice(0)) fn();
    const b = rec.bundle;
    b.fighters.bindScope = null;
    b.fighters.dispose();
    (b.playerCtl as { dispose?: () => void }).dispose?.();
    (b.wands as { dispose?: () => void }).dispose?.();
    (b.chill as { dispose?: () => void } | undefined)?.dispose?.();
    this.slots.length = slot;
    // Anything the rival cast goes with it.
    const ps = this.ctx.projectiles;
    for (let i = ps.length - 1; i >= 0; i--) if ((ps[i].owner ?? 0) === slot) ps.splice(i, 1);
    if (this.slots.length <= 1) {
      this.ctx.events.scoped = false;
      this.ctx.events.boundSlot = 0;
      this.ctx.camera.inspectionFocus = null;
      this.bout.state = 'idle';
      this.bout.winner = null;
      this.match?.stop();
      for (const dodge of this.dodges) dodge.reset();
      for (const ledge of this.ledges) ledge.reset();
      for (const attack of this.attacks) attack.reset();
    }
    this.ctx.projectileCtl?.invalidateEnemyIndex?.();
  }

  onSlotRemoved(slot: number, fn: () => void): void {
    this.slots[slot]?.onRemoved.push(fn);
  }

  setDriver(slot: number, drive: (() => void) | null): void {
    const rec = this.slots[slot];
    if (rec) rec.driver = drive;
  }

  setSpawns(spawns: ReadonlyArray<{ x: number; y: number }>): void {
    this.spawns = spawns.map((s) => ({ x: s.x, y: s.y }));
  }

  // ================================================================================== binding

  with<T>(slot: number, fn: () => T): T {
    this.ensureBase();
    if (slot === this.boundSlot || !this.slots[slot]) return fn();
    const prev = this.boundSlot;
    this.install(slot);
    try { return fn(); } finally { this.install(prev); }
  }

  private rawInstall(b: SlotBundle): void {
    const c = this.ctx;
    c.player = b.player;
    c.input = b.input;
    c.playerCtl = b.playerCtl;
    c.wands = b.wands;
    c.flask = b.flask;
    c.fighters = b.fighters;
    c.chill = b.chill;
  }

  private install(slot: number): void {
    const rec = this.slots[slot];
    if (!rec) return;
    if (this.active) this.bridgeBack();
    this.rawInstall(rec.bundle);
    this.boundSlot = slot;
    this.ctx.events.boundSlot = slot;
    if (this.active) {
      this.syncStand();
      this.ctx.projectileCtl?.invalidateEnemyIndex?.();
    }
  }

  bindOwner(owner: number | undefined): void {
    if (!this.active) return;
    const o = owner !== undefined && this.slots[owner] ? owner : 0;
    if (o === this.boundSlot) return;
    this.install(o);
    this.ownerBound = o !== 0;
  }

  releaseOwner(): void {
    if (!this.ownerBound) return;
    this.ownerBound = false;
    if (this.boundSlot !== 0) this.install(0);
  }

  get ownerForNew(): number | undefined {
    return this.active && this.boundSlot !== 0 ? this.boundSlot : undefined;
  }

  // ================================================================================== the stand-in

  isStandIn(e: Enemy): boolean { return e.fighter !== undefined; }

  private attachStand(): void {
    if (this.inEnemies) return;
    this.ctx.enemies.push(this.stand);
    this.inEnemies = true;
  }

  private detachStand(): void {
    if (!this.inEnemies) return;
    const es = this.ctx.enemies;
    const at = es.indexOf(this.stand);
    if (at >= 0) es.splice(at, 1);
    this.inEnemies = false;
  }

  /** Make the stand-in mirror the opponent of the bound slot. */
  private syncStand(): void {
    if (!this.active) return;
    const opp = this.boundSlot === 0 ? 1 : 0;
    const v = this.slots[opp]?.bundle.player;
    if (!v) return;
    const s = this.stand;
    s.fighter = opp;
    s.x = v.x; s.y = v.y; s.vx = v.vx; s.vy = v.vy;
    s.fx = 0; s.fy = 0;
    s.hp = v.hp > 0.5 ? v.hp : 0.5;
    s.maxHp = v.maxHp;
    s.grounded = v.grounded;
    s.status = v.status as EntityStatus;
    s.knockT = 0; s.knockVx = 0; s.knockVy = 0;
    s.flash = v.invuln > 0 ? 3 : 0;
    s.alerted = true;
    s.sleeping = false;
    this.sent.x = v.x; this.sent.y = v.y; this.sent.vx = v.vx; this.sent.vy = v.vy;
    this.standFor = opp;
  }

  /**
   * What an attacker did to the stand-in since it was last copied (a velocity written, a launch started, a pull) goes to the real
   * body, once, through its own impulse path (weight, stoneskin, stagger resistance all apply).
   */
  private bridgeBack(): void {
    const v = this.slots[this.standFor];
    if (!v || this.isEvading(this.standFor) || this.stockShield(this.standFor)?.guarding) return;
    const s = this.stand;
    const sent = this.sent;
    let dvx = s.vx - sent.vx, dvy = s.vy - sent.vy;
    if ((s.knockT ?? 0) > 0) {
      dvx += s.knockVx ?? 0;
      dvy += s.knockVy ?? 0;
      s.knockVx = 0; s.knockVy = 0; s.knockT = 0;
    }
    const moved = Math.abs(s.x - sent.x) > 0.5 || Math.abs(s.y - sent.y) > 0.5;
    if (dvx === 0 && dvy === 0 && !moved) return;
    sent.vx = s.vx; sent.vy = s.vy;
    const here = this.slots[this.boundSlot]!.bundle;
    this.rawInstall(v.bundle);
    try {
      if (moved) {
        // A pull or a teleport written onto the stand-in: move the body there if it fits.
        const p = v.bundle.player;
        if (this.ctx.physics.entityFree(Math.round(s.x), Math.round(s.y), PLAYER_HALF_W, PLAYER_H)) { p.x = s.x; p.y = s.y; }
        sent.x = s.x; sent.y = s.y;
      }
      if (dvx !== 0 || dvy !== 0) v.bundle.playerCtl.applyImpulse(dvx, dvy);
    } finally {
      this.rawInstall(here);
    }
  }

  // ================================================================================== blows

  hit(stand: Enemy, amount: number, kx: number, ky: number, source: EnemyDamageSource): void {
    const victim = stand.fighter;
    if (victim === undefined || victim === this.boundSlot) return;
    const rec = this.slots[victim];
    if (!rec || rec.bundle.player.dead || this.bout.state === 'won' || this.isEvading(victim)) return;
    const attacker = this.boundSlot;
    const dealt = playerBlow(source) ? this.slots[attacker]?.bundle.fighters.body.dealt ?? 1 : 1;
    // Equal health: scale damage with the victim's body health so a blow costs the same health fraction.
    // The victim's controller applies ARENA_RULES.blowScale to everything it takes, including fire.
    const hpFactor = this.slots[victim]?.bundle.fighters.body.maxHp ?? 1;
    const dmg = amount * dealt * Math.pow(hpFactor || 1, ARENA_RULES.healthEquality);
    if (dmg > 0 && !this.stockShield(victim)?.guarding) this.lastBlow[victim] = { by: attacker, at: this.ctx.state.frameCount, landed: false };
    const tag = source === 'direct' ? 'fighter' : String(source);
    // What the blow belongs to is the ATTACKER's to say (its kit knows which ability is acting): a fight recorder reads it inside the victim's damage().
    const was = this.blow;
    this.blow = { by: attacker, tag: this.slots[attacker]?.bundle.fighters.attribute?.(source) ?? (source === 'direct' ? 'spell' : 'world') };
    try {
      const hpBefore = rec.bundle.player.hp;
      this.with(victim, () => { rec.bundle.playerCtl.damage(dmg, kx, ky, tag); });
      const lost = hpBefore - rec.bundle.player.hp;
      if (lost > 0) this.ctx.events.emit('fighterHit', { by: attacker, victim, damage: lost, tick: this.ctx.state.frameCount, attack: this.blow.tag });
    } finally {
      this.blow = was;
    }
  }

  shove(stand: Enemy, dirX: number, dirY: number, strength: number): void {
    const victim = stand.fighter;
    if (victim === undefined || victim === this.boundSlot || strength <= 0) return;
    const rec = this.slots[victim];
    if (!rec || rec.bundle.player.dead || this.bout.state === 'won' || this.isEvading(victim) || this.stockShield(victim)?.guarding) return;
    const push = strength * 1.1;
    this.with(victim, () => { rec.bundle.playerCtl.applyImpulse(dirX * push, dirY * push - push * 0.18); });
  }

  intercept(stand: Enemy, p: Projectile): boolean {
    const victim = stand.fighter;
    if (victim === undefined || victim === this.boundSlot) return false;
    const rec = this.slots[victim];
    if (!rec || rec.bundle.player.dead) return false;
    const f = rec.bundle.fighters;
    if (f.id === null) return false;
    return this.with(victim, () => f.interceptProjectile(p));
  }

  /** Called by the controller's arena branch when a fighter is knocked out. */
  noteDown(slot: number, source: string): void {
    const p = this.slots[slot]?.bundle.player;
    if (!p || this.bout.state === 'won') return;
    // Resolve all stock losses together at endTick, including simultaneous final stocks.
    if (this.match) { p.dead = true; return; }
    const by = this.blame(slot);
    const ev = { slot, by, source, x: p.x, y: p.y };
    this.bout.downs.push(ev);
    this.bout.state = 'won';
    this.bout.winner = by === slot ? (slot === 0 ? 1 : 0) : by;
    this.bout.endedAt = this.ctx.state.frameCount;
    this.ctx.events.emit('fighterDown', ev);
  }

  // ================================================================================== the tick

  runRivals(phase: RivalPhase): void {
    if (!this.active) return;
    const ctx = this.ctx;
    for (let s = 1; s < this.slots.length; s++) {
      const rec = this.slots[s];
      if (!rec) continue;
      this.with(s, () => {
        const b = rec.bundle;
        if (this.match && !this.runsBody(s)) { b.player.firing = false; return; }
        if (phase === 'body') {
          const n0 = ctx.projectiles.length;
          rec.driver?.();
          if (!b.player.dead && rec.runs) {
            b.playerCtl.update(ctx);
            b.chill?.update(ctx);
            b.fighters.update(ctx);
          }
          this.stampOwners(n0, s);
        } else if (phase === 'flask') {
          const n0 = ctx.projectiles.length;
          b.flask.update(ctx);
          this.stampOwners(n0, s);
        } else {
          const n0 = ctx.projectiles.length;
          b.wands.update(ctx);
          this.stampOwners(n0, s);
        }
      });
    }
  }

  rivalsFirst(): boolean {
    const s = this.ctx.state;
    const h = Math.imul((s.frameCount | 0) ^ Math.imul((s.worldSeed | 0) + 0x632be5ab, 0x85ebca6b), 0x9e3779b1);
    return ((h ^ (h >>> 16)) & 1) === 1;
  }

  /** May slot 0 run its body this tick (a rival's slow is time)? */
  runsBody(slot: number): boolean {
    if (this.match) {
      const f = this.match.fighters[slot];
      if (this.match.state !== 'fighting' || !f || f.stocks <= 0 || f.respawn > 0) return false;
    }
    return this.slots[slot]?.runs ?? true;
  }

  private stampOwners(from: number, slot: number): void {
    const ps = this.ctx.projectiles;
    for (let i = from; i < ps.length; i++) if (ps[i].owner === undefined) ps[i].owner = slot;
  }

  endTick(): void {
    if (!this.active) return;
    if (this.boundSlot !== 0) this.install(0);
    this.bridgeBack();
    const ctx = this.ctx;
    if (this.match) {
      if (this.match.state === 'fighting') for (let slot = 0; slot < this.slots.length; slot++) {
        if (this.runsBody(slot)) this.specials[slot].step();
      }
      this.resolveStockAttacks(); this.resolveStockGrabs(); this.tickStockMatch();
      // The stage hull is earthed: no lightning cast electrifies the deck under both fighters.
      earthStockStage(ctx.world, this.stockStage);
    }
    // Each fighter's slow and stun, set by the other's effects on its stand-in, apply to the NEXT tick.
    for (let victim = 0; victim < this.slots.length; victim++) {
      const rec = this.slots[victim];
      if (!rec) continue;
      const attacker = this.slots[victim === 0 ? 1 : 0];
      if (!attacker) continue;
      // The attacker's effects are keyed by the one stand-in object, which mirrors the victim only while the attacker is bound.
      const af = attacker.bundle.fighters;
      rec.runs = af.id === null ? true : af.enemyRuns(this.stand);
      const stunned = af.id !== null && af.isStunned(this.stand);
      if (stunned) rec.bundle.player.stunT = Math.max(rec.bundle.player.stunT ?? 0, 2);
    }
    this.syncStand();
    // Health duels use the shared midpoint. StockCameraRig owns stock framing.
    const a = this.slots[0]!.bundle.player;
    const rivals = this.slots.slice(1).filter((r): r is Slot => r !== undefined).map((r) => r.bundle.player);
    let sx = a.x, sy = a.y - 9, n = 1;
    for (const r of rivals) { sx += r.x; sy += r.y - 9; n++; }
    this.focus.x = sx / n;
    this.focus.y = sy / n;
    ctx.camera.inspectionFocus = this.match ? null : this.focus;
    void VIEW_W; void VIEW_H;
  }

  extendSimBounds(bounds: { x0: number; y0: number; x1: number; y1: number }): void {
    const world = this.ctx.world;
    for (let s = 1; s < this.slots.length; s++) {
      const p = this.slots[s]?.bundle.player;
      if (!p) continue;
      bounds.x0 = Math.min(bounds.x0, Math.max(0, Math.floor(p.x - VIEW_W / 2 - 80)));
      bounds.x1 = Math.max(bounds.x1, Math.min(world.width, Math.ceil(p.x + VIEW_W / 2 + 80)));
      bounds.y0 = Math.min(bounds.y0, Math.max(0, Math.floor(p.y - VIEW_H / 2 - 80)));
      bounds.y1 = Math.max(bounds.y1, Math.min(world.height, Math.ceil(p.y + VIEW_H / 2 + 80)));
    }
  }

  // ================================================================================== a new bout

  private clearGrabContact(ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let i = 1; i < steps; i++) if (this.ctx.physics.cellBlocks(Math.round(ax + (bx - ax) * i / steps), Math.round(ay + (by - ay) * i / steps))) return false;
    return true;
  }

  private resolveStockGrabs(): void {
    if (this.match?.state !== 'fighting') return;
    const contacts: number[] = [];
    for (let slot = 0; slot < this.slots.length; slot++) {
      const grab = this.grabs[slot], b = this.slots[slot]!.bundle, p = b.player;
      grab.step(this.runsBody(slot) && !p.dead && !this.isLaunching(slot) && p.stunT <= 0 && p.grounded && !b.fighters.ownsMovement);
      if (grab.phase === 'active') {
        const victim = 1 - slot, target = this.slots[victim]?.bundle.player;
        if (!target || target.dead || target.invuln > 0 || this.isEvading(victim) || this.isLaunching(victim) || this.isGrabbed(victim) || (this.match.fighters[victim]?.protection ?? 0) > 0) continue;
        const dx = (target.x - p.x) * grab.facing;
        if (dx >= 3 && dx <= 22 && Math.abs(target.y - p.y) <= 12 && this.clearGrabContact(p.x, p.y - 10, target.x, target.y - 10) &&
          this.ctx.physics.entityFree(Math.round(p.x + grab.facing * 18), Math.round(p.y), PLAYER_HALF_W, PLAYER_H)) contacts.push(slot);
      }
      if (grab.phase !== 'hold' || grab.victim === null) continue;
      const victim = grab.victim, target = this.slots[victim]!.bundle.player;
      const x = p.x + grab.facing * 18, y = p.y;
      if (target.dead || !this.clearGrabContact(p.x, p.y - 10, x, y - 10) || !this.ctx.physics.entityFree(Math.round(x), Math.round(y), PLAYER_HALF_W, PLAYER_H)) { grab.release(); continue; }
      Object.assign(target, { x, y, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, firing: false });
      p.vx = p.vy = 0;
      const k = b.input.keys;
      if (grab.canThrow && (k.left || k.right || k.up || k.down)) {
        const direction = k.up ? 'up' : k.down ? 'down' : k.left ? 'left' : 'right';
        const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : grab.facing;
        const kx = direction === 'up' ? dx * .6 : direction === 'down' ? dx * 1.8 : dx * 5;
        const ky = direction === 'up' ? -5.8 : direction === 'down' ? -2.8 : -1.5;
        grab.release(dx, direction === 'up' || direction === 'down' ? -1 : 0); this.shields[victim].drop(); target.invuln = 0;
        const was = this.blow; this.blow = { by: slot, tag: `throw.${direction}`, growth: 1.2, stun: 1.1 };
        try {
          this.with(victim, () => this.slots[victim]!.bundle.playerCtl.damage(18 * (b.fighters.body.dealt ?? 1), kx, ky, 'fighter'));
          this.lastBlow[victim] = { by: slot, at: this.ctx.state.frameCount, landed: false }; this.ctx.audio.sfx('arena.throw');
        } finally { this.blow = was; }
      }
    }
    // Two simultaneous grabs clash instead of giving the first slot priority.
    if (contacts.length > 1) { for (const slot of contacts) this.grabs[slot].release(); return; }
    for (const slot of contacts) {
      const victim = 1 - slot, b = this.slots[victim]!.bundle;
      this.grabs[victim].reset(); this.attacks[victim].reset(); this.shields[victim].drop();
      b.player.firing = b.player.firePressed = false; b.wands.clearTransientState?.();
      this.grabs[slot].catch(victim);
      this.ctx.audio.sfx('arena.grab');
    }
  }

  private resolveStockAttacks(): void {
    if (this.match?.state !== 'fighting') return;
    const hits: Array<{ attacker: number; victim: number; kind: StockAttackKind; spec: StockAttackSpec; facing: number }> = [];
    // Collect before applying either hit: simultaneous active attacks can trade.
    for (let attacker = 0; attacker < this.slots.length; attacker++) {
      const attack = this.attacks[attacker], b = this.slots[attacker]?.bundle;
      if (!b || b.player.dead || attack.phase !== 'active' || !attack.spec || !attack.kind) continue;
      const victim = 1 - attacker, target = this.slots[victim]?.bundle.player;
      if (!target || target.dead || target.invuln > 0 || this.isEvading(victim) || (this.match.fighters[victim]?.protection ?? 0) > 0) continue;
      const p = b.player, spec = attack.spec;
      if (!stockAttackOverlaps(spec, attack.facing, p.x, p.y, target.x, target.y)) continue;
      const ox = p.x + attack.facing * 3, oy = p.y - 10;
      const tx = target.x, ty = target.y - PLAYER_H / 2;
      const steps = Math.max(1, Math.ceil(Math.hypot(tx - ox, ty - oy)));
      let blocked = false;
      for (let i = 1; i < steps; i++) if (this.ctx.physics.cellBlocks(Math.round(ox + (tx - ox) * i / steps), Math.round(oy + (ty - oy) * i / steps))) { blocked = true; break; }
      if (!blocked && attack.claim(victim)) hits.push({ attacker, victim, spec, kind: attack.kind, facing: attack.facing });
    }
    for (const hit of hits) {
      const b = this.slots[hit.victim]!.bundle;
      const before = this.match.fighters[hit.victim].volatility;
      const was = this.blow;
      this.blow = { by: hit.attacker, tag: `melee.${hit.kind}`, growth: hit.spec.growth, stun: hit.spec.stun };
      try {
        const dealt = this.slots[hit.attacker]!.bundle.fighters.body.dealt ?? 1;
        this.with(hit.victim, () => b.playerCtl.damage(hit.spec.damage * dealt, hit.spec.knockX * hit.facing, hit.spec.knockY, 'fighter'));
        if (this.match.fighters[hit.victim].volatility > before) {
          this.specials[hit.attacker].rewardMelee();
          this.lastBlow[hit.victim] = { by: hit.attacker, at: this.ctx.state.frameCount, landed: false };
          this.ctx.audio.sfx(hit.kind === 'finisher' || hit.spec.name === 'Up smash' ? 'arena.hit.heavy' : 'arena.hit.light');
          // The blow lands: the game holds for a beat that grows with the damage (render shakes the struck fighter).
          const fx = this.ctx.fx as Ctx['fx'] | undefined; // (headless arenas have no presentation state)
          if (fx) fx.hitstop = Math.max(fx.hitstop ?? 0, stockHitstopTicks(hit.spec.damage));
        }
      } finally { this.blow = was; }
    }
  }

  /** Who a knockout belongs to: the last hitter within the hazard window, or (stock) until the victim has landed since. */
  private blame(slot: number): number {
    const blow = this.lastBlow[slot];
    if (blow.by < 0) return slot;
    const recent = this.ctx.state.frameCount - blow.at <= OPPONENT_WINDOW;
    return recent || (this.match !== null && !blow.landed) ? blow.by : slot;
  }

  private tickStockMatch(): void {
    const match = this.match!;
    // Touching ground (or a ledge) after the launch grace ends a blow's claim on a later fall.
    for (let s = 0; s < this.slots.length; s++) {
      const blow = this.lastBlow[s], p = this.slots[s]?.bundle.player;
      if (!blow || blow.landed || !p) continue;
      if ((p.grounded || this.ledges[s]?.busy) && this.ctx.state.frameCount - blow.at > LAUNCH_GRACE) blow.landed = true;
    }
    const changes = match.step(this.slots.map(s => s!.bundle.player));
    for (let s = 0; s < this.launchTicks.length; s++) this.launchTicks[s] = Math.max(0, this.launchTicks[s] - 1);
    for (const slot of changes.downs) {
      const p = this.slots[slot]!.bundle.player;
      const by = this.blame(slot);
      const ev = { slot, by, source: 'ring-out', x: p.x, y: p.y };
      this.bout.downs.push(ev);
      p.dead = true; p.firing = false; p.vx = 0; p.vy = 0;
      this.launchTicks[slot] = 0;
      // A ring-out lands like a blast: the screen kicks (render draws the burst at the edge it left by).
      const fx = this.ctx.fx as Ctx['fx'] | undefined;
      if (fx) fx.screenShake = Math.max(fx.screenShake ?? 0, 0.075);
      this.ctx.events.emit('fighterDown', ev);
    }
    for (const slot of changes.respawns) {
      if (match.state === 'finished') break;
      const b = this.slots[slot]!.bundle;
      const at = this.spawns[slot] ?? this.spawns[0];
      this.with(slot, () => {
        this.respawnBody(b, at.x, at.y - 30);
        b.player.invuln = STOCK_RULES.protectionTicks;
        b.wands.clearTransientState?.();
      });
      this.lastBlow[slot] = { by: -1, at: -1e9, landed: true };
    }
    if (match.state !== 'fighting') for (const s of this.slots) if (s) s.bundle.player.firing = false;
    if (match.state === 'finished' && this.bout.state !== 'won') {
      this.bout.state = 'won'; this.bout.winner = match.winner; this.bout.endedAt = this.ctx.state.frameCount;
    }
    // The countdown's second, the fight's start or the match's end changed this tick (the announcer calls it).
    // The match's beat (each countdown call, the fight, the end) is announced once, the first tick it holds: the first
    // countdown tick says "three" even though reset() set the countdown outside this tick.
    const beat = `${match.state}|${stockCountdownBeat(match.countdown)}`;
    if (match.state !== 'idle' && beat !== this.lastBeat) this.ctx.events.emit('stockMatchBeat', { state: match.state, count: stockCountdownBeat(match.countdown), winner: match.winner, reason: match.reason });
    this.lastBeat = beat;
  }

  /** Stand the body at (x, y), whole, still and ready (a bout's start; under the slot's binding). */
  private respawnBody(b: SlotBundle, x: number, y: number): void {
    Object.assign(this.recovery[this.boundSlot], { used: false, held: false, ticks: 0 });
    this.dodges[this.boundSlot].reset();
    this.shields[this.boundSlot].reset();
    this.specials[this.boundSlot].reset();
    this.grabs[this.boundSlot].reset();
    for (const grab of this.grabs) if (grab.victim === this.boundSlot) grab.release();
    this.ledges[this.boundSlot].reset();
    this.attacks[this.boundSlot].reset();
    b.input.queuedDodge = false;
    b.input.shieldHeld = false;
    b.input.queuedRecovery = false;
    const p = b.player;
    p.dead = false;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
    p.crawling = false; p.climbing = false; p.grounded = false;
    p.stunT = 0;
    p.invuln = 60;
    p.hp = p.maxHp;
    p.mana = p.maxMana;
    p.levit = p.maxLevit;
    p.firing = false;
    for (const k of Object.keys(p.status) as Array<keyof typeof p.status>) {
      const cur = p.status[k];
      if (typeof cur === 'number') (p.status as unknown as Record<string, number>)[k as string] = 0;
    }
    for (const key of Object.keys(b.input.keys) as Array<keyof typeof b.input.keys>) b.input.keys[key] = false;
    b.playerCtl.resetTransientState(this.ctx);
    this.ctx.events.emit('playerRespawned');
    b.fighters.refill();
    b.chill?.reset();
  }

  reset(): void {
    this.lastBeat = '';
    if (!this.active) return;
    this.install(0);
    this.ctx.projectiles.length = 0;
    for (let s = 0; s < this.slots.length; s++) {
      const rec = this.slots[s];
      if (!rec) continue;
      const at = this.spawns[s] ?? this.spawns[0];
      this.with(s, () => {
        this.respawnBody(rec.bundle, at.x, at.y);
        rec.runs = true;
        rec.bundle.wands.clearTransientState?.();
        this.applySignature(rec.bundle);
        for (const w of rec.bundle.wands.wands) { w.mana = w.frame.manaMax; w.cooldown = 0; w.castIndex = 0; }
      });
    }
    this.lastBlow[0] = { by: -1, at: -1e9, landed: true };
    this.lastBlow[1] = { by: -1, at: -1e9, landed: true };
    this.bout.state = 'fighting';
    this.bout.winner = null;
    this.bout.startedAt = this.ctx.state.frameCount;
    this.bout.endedAt = -1;
    this.bout.downs.length = 0;
    this.match?.start(this.slots.length);
    this.launchTicks.fill(0);
    this.syncStand();
    this.ctx.projectileCtl?.invalidateEnemyIndex?.();
    this.ctx.events.emit('arenaReset');
  }
}

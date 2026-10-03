import type { ChillApi, Enemy, EnemyDamageSource, FlaskApi, InputState, PlayerControlApi, PlayerState, Projectile, WandsApi } from '@/core/types';
import type { FighterApi } from '@/core/fighters';
import type { FighterId } from '@/content/fighters';
import type { BlastZone, StockDodgeView, StockGrabView, StockLedgeInput, StockLedgeView, StockMatchView, StockShieldView, StockSpecialView } from '@/core/arenaMatch';
import type { StockAttackKind, StockAttackView } from '@/core/stockAttacks';

/**
 * THE ARENA CONTRACT (docs/arena/ARCHITECTURE.md, D-001): two fighters in one world.
 *
 * Each fighter owns a SLOT: its own player body, input, controller, wands, flask, fighter system and chill system. While a slot
 * acts, its bundle is INSTALLED on the base `Ctx` (`ctx.player`, `ctx.input`, `ctx.playerCtl`, `ctx.wands`, `ctx.flask`,
 * `ctx.fighters`, `ctx.chill`), so every shared system (spells, explosions, lightning, the foes) reads the acting fighter exactly
 * as it reads the lone Alchemist today. The OTHER fighter appears to the bound slot as one `Enemy` of kind `'fighter'` (the
 * stand-in, `Enemy.fighter` = the slot it stands for): everything a fighter does to enemies lands on the stand-in, and
 * `Enemies.damage` hands the blow to the real fighter (`ArenaApi.hit`) instead of an enemy.
 *
 * With no rival there is no `ctx.arena.active`, `bound` is always 0, and none of this runs: the single-fighter game is untouched.
 */

/** Everything one fighter owns. The base fighter's bundle is whatever the `Ctx` was built with. */
export interface SlotBundle {
  player: PlayerState;
  input: InputState;
  playerCtl: PlayerControlApi;
  wands: WandsApi;
  flask: FlaskApi;
  fighters: FighterApi;
  chill: ChillApi | undefined;
}

/** Builds a fresh bundle for slot `n` (Game, the composition root, owns this: it is the only place the concrete classes are named). */
export type BundleFactory = (slot: number) => SlotBundle;

/** Where a fighter stood when it went down, who did it, and how. */
export interface FighterDownEvent {
  slot: number;
  /** The slot that landed the last blow (the fighter itself for a fall or a hazard). */
  by: number;
  source: string;
  x: number;
  y: number;
}

/** The phases of one fighter's tick, run by the base game for slot 0 and by `ArenaApi.runRivals` for the others. */
export type RivalPhase = 'body' | 'flask' | 'wands';

export interface ArenaApi {
  readonly stockMatch: StockMatchView | null;
  /** Select stock rules for this stage, or return to the existing health duel. */
  configureStocks(zone: BlastZone | null): void;
  /** Consumes already-reduced damage in a stock match; true means health must not change. */
  takeStockDamage(amount: number, kx: number, ky: number): boolean;
  isLaunching(slot: number): boolean;
  isActionLocked(slot: number): boolean;
  stockSpecial(slot: number): StockSpecialView | null;
  canStockSpecial(cost?: 1 | 2): boolean;
  spendStockSpecial(cost?: 1 | 2): boolean;
  refundStockSpecial(cost?: 1 | 2): void;
  isEvading(slot: number): boolean;
  stockDodge(slot: number): StockDodgeView | null;
  stockShield(slot: number): StockShieldView | null;
  updateStockShield(held: boolean, canAct: boolean): StockShieldView | null;
  /** Consumes a direct opponent hit before hurt effects or health invulnerability. */
  blockStockHit(amount: number): boolean;
  stockGrab(slot: number): StockGrabView | null;
  isGrabbed(slot: number): boolean;
  requestStockGrab(): boolean;
  stockLedge(slot: number): StockLedgeView | null;
  /** Returns true when ledge motion owns this tick's body integration. */
  updateStockLedge(canAct: boolean, keys?: StockLedgeInput): boolean;
  stockAttack(slot: number): StockAttackView | null;
  requestStockAttack(kind?: StockAttackKind, facing?: number): boolean;
  updateStockAttack(canAct: boolean): StockAttackView | null;
  updateStockDodge(requested: boolean, canAct: boolean): StockDodgeView | null;
  canRecover(slot: number): boolean;
  isRecovering(slot: number): boolean;
  /** One upward recovery burst per airborne sequence, requested by up + a fresh jump. */
  updateStockRecovery(requested: boolean): boolean;
  /** True while a rival exists. Every arena branch in the engine is behind this. */
  readonly active: boolean;
  /** The slot whose bundle is on the `Ctx` right now. */
  readonly bound: number;
  readonly slotCount: number;

  /** The fighter in a slot (its bundle), or undefined. */
  bundle(slot: number): SlotBundle | undefined;
  /** The fighter's id in a slot, or null. */
  fighterId(slot: number): FighterId | null;
  /** Put a fighter in the next free slot; resolves to its slot, or -1 if removed while loading. */
  addRival(id: FighterId, x: number, y: number): Promise<number>;
  removeRival(slot: number): void;
  /** Run `fn` with `slot`'s bundle installed (nests; restores the previous binding). */
  with<T>(slot: number, fn: () => T): T;

  /** A drive for a slot: called once per tick under that slot's binding, before its body phase. */
  setDriver(slot: number, drive: (() => void) | null): void;
  /** Run `fn` once when this slot's fighter is removed (a driver unsubscribes its listeners). */
  onSlotRemoved(slot: number, fn: () => void): void;

  /** Is this enemy a fighter's stand-in? (the slot it stands for) */
  isStandIn(e: Enemy): boolean;
  /** A blow aimed at a stand-in: it lands on the real fighter. */
  hit(stand: Enemy, amount: number, kx: number, ky: number, source: EnemyDamageSource): void;
  /** A wind-gust shove aimed at a stand-in. */
  shove(stand: Enemy, dirX: number, dirY: number, strength: number): void;
  /** A shot about to land on a stand-in: does the real fighter's plate or prism take it first? (true = consumed) */
  intercept(stand: Enemy, p: Projectile): boolean;
  /** One slot's tick, after slot 0's own (the base game calls this at the three phase points). */
  runRivals(phase: RivalPhase): void;
  /** Does the rival resolve BEFORE slot 0 this tick? A seeded coin per tick (not parity: a bot's fire cadence is a multiple of two and would lock to it). */
  rivalsFirst(): boolean;
  /** May this slot run its body this tick? (A rival's slow is TIME: a slowed fighter runs a fraction of its ticks.) */
  runsBody(slot: number): boolean;
  /** The controller's arena branch: a fighter was knocked out. */
  noteDown(slot: number, source: string): void;
  /** Everything that follows the last phase of a tick: stand-ins re-synced, knock bridged, knockouts decided, the camera told. */
  endTick(): void;
  /** Projectiles: the pass for a projectile owned by `owner` runs bound to that slot; `undefined` = slot 0. */
  bindOwner(owner: number | undefined): void;
  /** The projectile loop is done: slot 0 is bound again. */
  releaseOwner(): void;
  /** The slot a freshly made projectile belongs to (the bound slot). */
  readonly ownerForNew: number | undefined;
  /** Widen the simulation window around every fighter. */
  extendSimBounds(bounds: { x0: number; y0: number; x1: number; y1: number }): void;
  /** Slot 0 respawns and a rival returns to its spawn: a new bout. */
  reset(): void;
  /** While a fighter's blow is being landed on the other (inside `hit`): who landed it and what it belongs to (spell, kick, ability.tactical ...). Null otherwise. */
  readonly activeBlow: { by: number; tag: string; growth?: number; stun?: number } | null;
  /** The result of the bout so far. */
  readonly bout: Readonly<Bout>;
  /** Set the clock and the stage the arena is on (a duel stage with a width the camera need not leash). */
  setSpawns(spawns: ReadonlyArray<{ x: number; y: number }>): void;
}

export interface Bout {
  /** 'fighting' until a knockout; then 'won' (winner set) and the arena waits for `reset`. */
  state: 'idle' | 'fighting' | 'won';
  winner: number | null;
  /** The tick the bout began, and the tick it ended (or -1). */
  startedAt: number;
  endedAt: number;
  /** Knockouts so far, in order. */
  downs: FighterDownEvent[];
}

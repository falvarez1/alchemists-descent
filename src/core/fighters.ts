import type { FighterId } from '@/content/fighters';
import type { Ctx, Enemy, EnemyDamageSource, Projectile } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';

/**
 * THE FIGHTER CONTRACT (docs/FIGHTERS.md). A fighter is who you descend as: a look, a passive, a
 * tactical ability on Z and an ultimate on T. `ctx.fighters` is absent in small test contexts and
 * `ctx.fighters.id` is null for the classic Alchemist, so every engine hook below is a no-op until a
 * fighter is equipped: the default hero is untouched.
 *
 * Types only: the game's systems reach fighters through this interface, never the concrete class
 * (CLAUDE.md "Ctx composition root"). `src/fighters/` implements it.
 */

export type AbilitySlot = 'tactical' | 'ultimate';

/** What the HUD reads for one ability chip. */
export interface AbilityView {
  slot: AbilitySlot;
  /** The ability's name (the design document's). */
  name: string;
  /** Usable right now: off cooldown (and, for the ultimate, fully charged) and the fighter is able to act. */
  ready: boolean;
  /** 1 just used .. 0 ready: the cooldown sweep. */
  cooldown: number;
  /** Whole seconds left on the cooldown (0 when ready). */
  cooldownSeconds: number;
  /** 1 .. 0 while the ability's own effect is running (an ultimate's duration, a held shield); 0 otherwise. */
  active: number;
  /** Ultimate only: 0..1 charge. The tactical reports 1. */
  charge: number;
  /** Frame numbers of the last use, the last refused press, and (ultimate) when the bar last filled: the chip's flourishes key off these. */
  usedAt: number;
  refusedAt: number;
  readyAt: number;
}

/** One extra readout a kit may show beside the chips (Brann's Pressure, an armor pool). */
export interface FighterMeter {
  label: string;
  value: number;
  max: number;
}

export interface FighterView {
  /** null = the classic Alchemist. */
  id: FighterId | null;
  tactical: AbilityView;
  ultimate: AbilityView;
  /** Absorbed-before-health pool (armor / overshield), 0 when the fighter has none. */
  armor: number;
  armorMax: number;
  meter: FighterMeter | null;
}

/**
 * Something a kit has put in the world that must be drawn: a bell, a prism, an echo, a reveal ring.
 * The kit owns it (and its lifetime); the renderer only walks the list, so the render layer never
 * imports a kit.
 */
export interface FighterDrawable {
  /** 'under' draws behind the fighter and the foes; 'over' on top of them (after the light). */
  layer: 'under' | 'over';
  draw(out: PixelSurface, field: LightField, ctx: Ctx): void;
}

/** The part of a fighter that is saved with the run (everything else is re-derived). */
export interface FighterSaveState {
  v: 1;
  id: FighterId;
  /** Ticks left on each cooldown. */
  tacticalCooldown: number;
  ultimateCooldown: number;
  /** 0..1 */
  charge: number;
  /** Armor pool, if the kit carries one across floors. */
  armor: number;
  /** A kit's own small numbers (Pressure, stored momentum): flat, finite, JSON-safe. */
  kit: Record<string, number>;
}

/**
 * The engine's questions of a fighter. Every method must be cheap and allocation-free: they sit in
 * the player's damage path, the enemy loop and the projectile sweep.
 */
export interface FighterApi {
  /** The equipped fighter, or null for the classic Alchemist. */
  readonly id: FighterId | null;
  readonly view: FighterView;
  /** Everything the kit has placed in the world right now, for the renderer to walk. */
  readonly drawables: readonly FighterDrawable[];

  /** Equip a fighter (null = the classic Alchemist). Resets kit state, cooldowns and charge. The kit loads on demand: `whenReady` resolves when it has. */
  equip(id: FighterId | null): void;
  whenReady(): Promise<void>;
  /** A tactical/ultimate press edge from the input layer (and the touch buttons). */
  press(slot: AbilitySlot): void;
  /** Fixed tick, after the player moves and before the enemies think (Game.tick). */
  update(ctx: Ctx): void;
  /** Wipe transient state (a respawn, a new floor, a run ending): placed gadgets, active effects. */
  reset(): void;
  dispose(): void;

  /** Charge the ultimate directly (0..1 of the bar). The console and the probes use it; kits do too. */
  addCharge(amount: number): void;
  /** Probes and the console: skip the cooldowns and fill the bar. */
  refill(): void;

  /** Saved with the run (null when no fighter is equipped). */
  snapshot(): FighterSaveState | null;
  restore(save: FighterSaveState | null | undefined): void;

  // ---- engine hooks (all no-ops for the classic Alchemist) ----

  /** Player damage path: armor, damage reduction, overshield. Returns the damage that reaches health. */
  reduceIncoming(amount: number, source: string | undefined): number;
  /** Multiplies the player's ground/air run speed (1 = unchanged). */
  moveScale(): number;
  /** Multiplies the climb and mantle rates (1 = unchanged). */
  climbScale(): number;
  /** True while a dash, blink, ram or tether owns the body: the player's own movement integration stands aside. */
  readonly ownsMovement: boolean;
  /** A blow neither shoves nor staggers the fighter (Pressure at full, Redline). */
  readonly staggerResist: boolean;
  /** Eyes: 0 (seen as normal) .. 1 (unseen): smoke, stillness in cover, an echo, the dark. Scales how far enemies notice. */
  concealment(): number;
  /** Where foe `e` believes the fighter is when a decoy draws its eye (Mirror Hunt), or null for the real body. */
  decoyFor(e: Enemy): { x: number; y: number; vx: number } | null;
  /** A speed factor for an enemy while a fighter effect slows it (1 = unchanged). */
  enemySlow(e: Enemy): number;
  /** A hostile projectile about to be tested against the player: true consumes it (a shield, a prism). */
  interceptProjectile(p: Projectile): boolean;
  /** An enemy took a blow from the player or the world on the player's behalf (Enemies.damage tells the system). */
  noteEnemyHurt(e: Enemy, amount: number, source: EnemyDamageSource, killed: boolean): void;
  /** The blows landing this tick are melee: a kick, a limb swing, a ram (Player.kick and the weaver limbs call this). */
  noteMelee(): void;
}

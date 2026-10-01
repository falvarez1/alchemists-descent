import type { FighterId } from '@/content/fighters';
import type { Enemy, EnemyDamageSource, Projectile } from '@/core/types';
import type { FighterMeter } from '@/core/fighters';
import type { FighterSystem } from '@/fighters/FighterSystem';

/**
 * A fighter's kit: what its passive, tactical and ultimate DO. One module per fighter
 * (`src/fighters/kits/<id>.ts`); the system owns the shared machinery (cooldowns, the charge bar, the
 * modifiers an effect sets, the enemy effects, a body-owning move, the drawables) and a kit is only
 * the rules. A kit instance is created on equip and thrown away on unequip, so it holds its own state
 * in plain fields; anything that must survive a save goes through `save()` / `load()`.
 */
export interface KitInstance {
  /** The passive and the kit's own timers: every tick the fighter is alive and in play. */
  tick?(): void;
  /** The tactical (Z). Return true when it fired (the cooldown is spent), false to refuse (no room, nothing to do). */
  tactical(): boolean;
  /**
   * Z pressed while the tactical is still cooling down (a raised plate that Z lowers early, a recall).
   * Return true to consume the press; false (or no hook) is the ordinary refusal. Never refunds the cooldown.
   */
  tacticalAgain?(): boolean;
  /** 0..1 how much of a held tactical (a raised plate) is left, for the chip's active state; 0 when none is running. */
  tacticalActive?(): number;
  /**
   * A blow is about to reach health (after the modifiers, before armor): return the amount that goes on.
   * `kx`/`ky` are the knock vector Player.damage was given (both 0 for a hazard tick).
   */
  reduceIncoming?(amount: number, source: string | undefined, kx: number, ky: number): number;
  /** The ultimate (T), the bar full. Return true when it began. The system runs `ultimateTick` for the duration. */
  ultimate(): boolean;
  /** Each tick while the ultimate runs; `remaining` counts down to 1. */
  ultimateTick?(remaining: number): void;
  /** The ultimate ended (ran out, the floor changed, the fighter died, a new fighter was chosen). */
  ultimateEnd?(): void;
  /** A foe took a blow from the fighter or from the world on its behalf. */
  onEnemyHurt?(e: Enemy, amount: number, source: EnemyDamageSource, killed: boolean): void;
  /** The fighter's health dropped by `lost` this tick (after armor), whatever the source. */
  onPlayerHurt?(lost: number, source: string | undefined): void;
  /** A hostile shot about to be tested against the body: true consumes it (a raised plate, a prism). */
  intercept?(p: Projectile): boolean;
  /** 0..1 how unseen the fighter is right now, beyond its modifiers (smoke around it, stillness in cover). */
  concealment?(): number;
  /** The cell at (x, y) is a hand-hold the kit has grown (a root): the player can climb it like a wall. Called by `Player.hasClimbFaceAt`, so keep it cheap. */
  climbHold?(x: number, y: number): boolean;
  /**
   * Where foe `e` believes the fighter is, when a decoy draws its eye (Mirror Hunt): the position and
   * horizontal velocity it should hunt instead of the real body, or null for the real one. Called once per
   * foe per tick, so keep it cheap; return null whenever no decoy is out.
   */
  decoyFor?(e: Enemy): { x: number; y: number; vx: number } | null;
  /** The kit is being thrown away (a new fighter, the system disposed): undo subscriptions and anything not covered by `reset`. */
  dispose?(): void;
  /** Wipe everything the kit has placed in the world and every running effect (respawn, a new floor, unequip). */
  reset?(): void;
  /** An extra readout for the HUD (Pressure). */
  meter?(): FighterMeter | null;
  /** Small flat numbers saved with the run. */
  save?(): Record<string, number>;
  load?(bag: Record<string, number>): void;
}

export interface FighterKitDef {
  readonly id: FighterId;
  /** Tactical cooldown, ticks. */
  readonly tacticalCooldown: number;
  /** Ultimate duration, ticks (0 = the ultimate is instantaneous). */
  readonly ultimateDuration: number;
  create(sys: FighterSystem): KitInstance;
}

/** What a modifier can change while it lasts. Several may be live at once; they combine (see `FighterSystem.setMod`). */
export interface FighterMod {
  /** x run speed. */
  moveScale?: number;
  /** x climb rate. */
  climbScale?: number;
  /** x incoming damage (0.5 = half). */
  damageTaken?: number;
  /** Blows neither shove nor stagger. */
  staggerResist?: boolean;
  /** Damage sources (the `src` tag of a player blow or a hazard: 'fire', 'burning', 'explosion', ...) that do nothing at all. */
  immuneTo?: readonly string[];
  /** 0..1, how unseen the fighter is. */
  concealment?: number;
}

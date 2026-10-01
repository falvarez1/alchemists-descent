import type { AiLevel } from '@/config/aiTiers';
import type { AbilitySlot, FighterApi } from '@/core/fighters';
import type { Ctx, InputState, PlayerState } from '@/core/types';

/**
 * THE BRAIN CONTRACT (docs/arena/AI-FIGHTERS.md 2-3). A brain is a computer fighter's mind: every fixed tick it is
 * asked to `think`, and it answers only by WRITING THE SAME INPUTS A PERSON'S HANDS WOULD (keys, the cursor's world
 * point, the trigger, and the press edges for Z / T / the kick / the flask). It never moves the body, never writes
 * `player.x` or `vx`, and perceives the world through `worldView` (what is on screen), not through hidden state.
 *
 * `BrainSelf` is the fighter the brain drives: today slot 0 (the player, `ctx.input`); in a duel (phase 3) the slot's
 * own bundle. Everything a brain touches is on it, so the same brain drives either without knowing which.
 */

export type BrainId = 'dummy' | 'basic';

export const BRAIN_IDS: readonly BrainId[] = ['dummy', 'basic'];

export function isBrainId(value: unknown): value is BrainId {
  return value === 'dummy' || value === 'basic';
}

/** The press edges that are not keys: what a hand does on the input layer's other paths (F, the right mouse button, Z, T). */
export interface Hands {
  /** Z / T through `FighterApi.press`: latched for the engine's `pressWindow`, consumed inside the tick. */
  press(slot: AbilitySlot): void;
  /** F: the kick (`PlayerControl.kick`). The engine enforces its own cooldown. */
  kick(): void;
  /** The right mouse button: throw the flask. */
  flask(): void;
  /** R on the death screen: get back up. */
  respawn(): void;
}

export interface BrainSelf {
  /** 0 is the player. */
  readonly slot: number;
  /** The body this brain drives. A brain writes only `firing` and `firePressed` on it (the trigger); it reads the rest. */
  readonly player: PlayerState;
  /** The slot's input object: keys, the cursor's world point, queued jump. */
  readonly input: InputState;
  readonly fighters: FighterApi | undefined;
  readonly hands: Hands;
}

/** What a brain is doing, for the Bots panel's one-line readout and the world overlay. */
export interface BrainStatus {
  /** The goal: `approach`, `retreat`, `zone`, `pressure`, `reposition`, `search`, or the dummy's `idle`. */
  intent: string;
  /** Who it is after (a foe's kind and distance), or `-`. */
  target: string;
  /** The rule that last fired, or why it did not press (`shoot`, `kick`, `Z: tip range`, `Z waits: cooling 3s`...). */
  rule: string;
  /** The world point it is aiming at, or null. */
  aim: { x: number; y: number } | null;
  /** The world x it is walking to, or null. */
  goalX: number | null;
  /** The preferred distance to its target (the overlay's ring), or 0. */
  range: number;
  /** Ticks in a row the hands have been empty (no key, no trigger, no press) right now. */
  idleTicks: number;
  /** What it has done since it was installed (the probes and the Bots panel read these): shots, kicks, Z, T, hops, lapses, stuck, idleMax (longest empty-handed run with a foe alive). */
  stats: Record<string, number>;
}

export interface BrainOptions {
  level: AiLevel;
  /** Seed for the brain's own `Rng` (`hashSeed(seed, 'bot:' + slot)`): never `entityRandom`. */
  seed: number;
  slot: number;
}

export interface Brain {
  readonly id: BrainId;
  level: AiLevel;
  /** Fixed tick: read the world, write this tick's inputs. */
  think(ctx: Ctx, self: BrainSelf, tick: number): void;
  readonly status: Readonly<BrainStatus>;
  /** Forget the plan (a respawn, a new floor); keeps the seed and the Rng stream. */
  reset(): void;
}

export function blankStatus(): BrainStatus {
  return {
    intent: 'idle', target: '-', rule: '', aim: null, goalX: null, range: 0, idleTicks: 0,
    stats: { shots: 0, kicks: 0, z: 0, t: 0, hops: 0, lapses: 0, stuck: 0, idleMax: 0, edges: 0 },
  };
}

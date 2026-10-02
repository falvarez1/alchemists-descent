import type { AbilitySlot } from '@/core/fighters';
import type { Enemy, EnemyDamageSource } from '@/core/types';

/**
 * THE FIGHT SINK (docs/arena/TELEMETRY-AND-BALANCE.md 3.2): the one seam through which a fight recorder
 * (src/fighters/telemetry, authoring builds only) hears the game. The instrumentation sites (the end of the
 * fixed tick, `Enemies.damage`, `Player.damage`, the fighter's ability presses) each read `fightSink` and call
 * it when it is set; nothing installs one in a player build, so every site costs a single null check and the
 * game plays exactly as before.
 *
 * Foundation level: types and one module variable, no systems, so the entity layer can import it.
 */
/**
 * What a blow on a foe belongs to, for a fight recorder: the wand ('spell'), the kick, the fighter's tactical or
 * ultimate, its passive, or the world's own harm done on its behalf (an explosion, fire, a flood).
 */
export type FightTag = 'spell' | 'kick' | 'ability.tactical' | 'ability.ultimate' | 'passive' | 'world';

export interface FightSink {
  /** One fixed tick has finished (Game.updateFixedTick, after every system ran): sample the fight. */
  tick(): void;
  /** A foe took a blow (`Enemies.damage`, hp already moved). `kx`/`ky` are the knock vector the blow carried. */
  hit(e: Enemy, amount: number, source: EnemyDamageSource, killed: boolean, kx: number, ky: number): void;
  /** The fighter took a blow (`Player.damage`): `raw` is what arrived, `taken` what reached health after armor and the rest. */
  hurt(raw: number, taken: number, source: string, kx: number, ky: number): void;
  /** An ability press resolved: it fired, it was refused, or it was answered while cooling (`tacticalAgain`). */
  ability(slot: AbilitySlot, result: 'fired' | 'refused' | 'again'): void;
}

/** The installed sink, or null (always null in a player build). Imported as a live binding. */
export let fightSink: FightSink | null = null;

export function setFightSink(sink: FightSink | null): void {
  fightSink = sink;
}

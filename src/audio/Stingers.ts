import type { EventBus } from '@/core/events';
import type { AudioApi } from '@/core/types';
import { listen } from '@/audio/failSafe';

/**
 * Run-event stingers. Events outward, calls inward: the combat, run and clip
 * systems announce facts on the bus and never know audio exists; this is
 * the one place that turns those facts into sound.
 *
 * - `alchemyKill` → a glass-and-brass chime climbing with the chain.
 * - `phialsChanged` → a glass crack when one is spent, a warm fill when one
 *   comes back (a refuge rest at full phials is silent — nothing was filled).
 * - `runEnded` → the victory fanfare or the fallen motif; an abandoned run
 *   (the player started another) gets neither.
 * - `clipSaved` → a camera shutter.
 *
 * Listeners are fail-safe (audio/failSafe): a sound never aborts the emit.
 * `arena` (audio/arenaAudio inArena): the phials and the run's verdict are the
 * descent's; in the Duel they stay quiet (the announcer calls the match).
 * Returns a disposer that unsubscribes everything.
 */
export function installAudioStingers(events: EventBus, audio: Pick<AudioApi, 'stinger'>, arena: () => boolean = () => false): () => void {
  let phials: number | null = null;
  const off = [
    listen(events, 'alchemyKill', ({ chain, cause, x, y }) => audio.stinger('alchemy', { chain, cause, x, y })),
    listen(events, 'phialsChanged', ({ phials: next, reason }) => {
      const previous = phials;
      phials = next;
      if (reason === 'start' || arena()) return;
      if (reason === 'death' || (previous !== null && next < previous)) audio.stinger('phialCrack');
      else if (previous === null || next > previous) audio.stinger('phialFill');
    }),
    listen(events, 'runEnded', ({ outcome }) => {
      if (arena()) return;
      if (outcome === 'victory') audio.stinger('victory');
      else if (outcome === 'fallen') audio.stinger('fallen');
    }),
    listen(events, 'clipSaved', () => audio.stinger('shutter')),
  ];
  return () => { for (const dispose of off) dispose(); };
}

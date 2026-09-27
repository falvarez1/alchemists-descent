import type { EventBus, EventMap } from '@/core/events';

/**
 * Audio may never abort gameplay.
 *
 * Sound is a side effect of the game, reached from inside its tick (an event
 * handler the tick emitted into, a direct `ctx.audio.sfx` call, the habitat
 * layer) and from timers. A Web Audio call can throw — an automation event
 * that overlaps another, a node from a context that was closed, a buffer that
 * never decoded — and an exception there used to unwind the tick that asked
 * for the sound (a `playerDied` listener threw, and the rest of that death's
 * tick never ran). Every audio entry point runs through `failSafe`: the error
 * is reported once, loudly, and the game goes on without that sound.
 */

const MAX_REPORTED = 32;
const reported = new Set<string>();
let faults = 0;

/** Report an audio error without rethrowing (once per distinct message, to the console). */
export function audioFault(where: string, error: unknown): void {
  faults++;
  const message = `${where}: ${error instanceof Error ? error.message : String(error)}`;
  if (reported.has(message) || reported.size >= MAX_REPORTED) return;
  reported.add(message);
  console.error(`[audio] ${message}`, error);
}

/** How many audio errors have been caught (probes and tests read it; gameplay never does). */
export function audioFaultCount(): number {
  return faults;
}

/** `fn`, but an exception inside it is reported and swallowed instead of reaching the caller. */
export function failSafe<A extends unknown[]>(where: string, fn: (...args: A) => void): (...args: A) => void {
  return (...args: A): void => {
    try {
      fn(...args);
    } catch (error) {
      audioFault(where, error);
    }
  };
}

/** Subscribe an audio listener that can never throw into the emitter (and so into the game tick). */
export function listen<K extends keyof EventMap>(events: EventBus, event: K, handler: (payload: EventMap[K]) => void): () => void {
  return events.on(event, failSafe(`on ${String(event)}`, handler));
}

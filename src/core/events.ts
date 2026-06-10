/**
 * Minimal synchronous typed event bus.
 *
 * Used to decouple gameplay systems from presentation: simulation code emits
 * facts ("an explosion of radius 38 happened"), and the audio engine / HUD /
 * score subscribe without the sim knowing they exist.
 */
export interface EventMap {
  /** Gold total changed — HUD score readouts re-render. */
  scoreChanged: { score: number };
  /** Player hit 0 HP — UI shows the game-over overlay. */
  playerDied: { wave: number; gold: number };
  /** Player came back — UI hides the game-over overlay. */
  playerRespawned: undefined;
  /** Build/play switch — UI swaps panels and HUD visibility. */
  modeChanged: { mode: 'build' | 'play' };
  /** A wave began — HUD updates the wave number readout. */
  waveStarted: { num: number };
  /** Show the big center-screen banner text for ~2.2s. */
  waveBanner: { big: string; small: string };
  /** Remaining hostile count changed — HUD readout. */
  enemiesLeft: { count: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof EventMap, Set<Handler<never>>>();

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof EventMap>(
    event: K,
    ...payload: EventMap[K] extends undefined ? [] : [EventMap[K]]
  ): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) (h as Handler<EventMap[K] | undefined>)(payload[0]);
  }
}

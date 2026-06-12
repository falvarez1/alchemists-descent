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
  /** The player arrived in a level — HUD shows depth + biome name. */
  levelChanged: { depth: number; name: string };
  /** A waystone brazier caught fire — checkpoint set. */
  waystoneLit: undefined;
  /** First-time brew of a recipe — Grimoire entry + gold bounty. */
  recipeDiscovered: { name: string; bounty: number };
  /** A spell card entered the collection — banner + bench refresh. */
  cardGranted: { id: string; name: string };
  /** Active wand or its loadout changed — HUD wand display refresh. */
  wandChanged: undefined;
  /** A concussive strike landed at (x, y) — mechanisms/rune vaults listen. */
  structureStrike: { x: number; y: number; radius: number };
  /** Short corner toast ("GOLDEN KEY ACQUIRED", "+20 MAX HP", ...). */
  toast: { text: string };
  /** The HUD objective line ("FIND THE GOLDEN KEY" -> "REACH THE PORTAL"). */
  objectiveChanged: { text: string };
  /** The Kiln Colossus is slain: the expedition is complete. */
  runComplete: { gold: number };
  /** Crawler wants to stand but the ceiling says no — HUD CRAMPED glyph. */
  crampedChanged: { cramped: boolean };
  /** A cast was refused for lack of mana (HUD flashes the mana bar). */
  dryFire: undefined;
  /** Flask verb refused (empty pour/throw, siphon into a full flask). */
  flaskDry: undefined;
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

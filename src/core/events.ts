import type { CardId, EnemyKind, TimeControlStatus } from '@/core/types';
import type { AlchemyKillInfo, RunSummary } from '@/core/run';

/** What an organism just did (the `organism` event). */
export type OrganismAction =
  | 'snap' | 'burst' | 'snare' | 'retract' | 'eat' | 'latch' | 'shed' | 'curl' | 'zap' | 'flare'
  | 'scatter' | 'scavenge' | 'die';

/**
 * Minimal synchronous typed event bus.
 *
 * Used to decouple gameplay systems from presentation: simulation code emits
 * facts ("an explosion of radius 38 happened"), and the audio engine / HUD /
 * score subscribe without the sim knowing they exist.
 */
export interface EventMap {
  contraptionView: {
    visible: boolean; title: string; detail: string; stage: number; stalled: boolean;
    /** A station that is waiting on the player: what to do, the verb, and the backup's progress 0..1. */
    fault: { verb: 'spark' | 'kick' | 'pour'; prompt: string; backup: number; backupLabel: string } | null;
  };
  habitatSound: { kind: 'weaver' | 'rillback'; x: number; y: number };
  creatureSignal: { x: number; y: number; radius: number; strength: number; kind: 'sound' | 'vibration' | 'lure' };
  /** Gold total changed — HUD score readouts re-render. */
  scoreChanged: { score: number };
  /** Player hit 0 HP — UI preps the game-over text (overlay deferred to the ragdoll settle). */
  playerDied: { depth: number; level: string; gold: number; cause: string };
  /** The death ragdoll has settled (or timed out) — UI reveals the game-over overlay. */
  playerCorpseSettled: undefined;
  /** Player came back — UI hides the game-over overlay. */
  playerRespawned: undefined;
  /** Death UI should clear without triggering gameplay respawn side effects. */
  playerDeathCleared: undefined;
  /** The directed death (game/DeathCinema): letterbox in, title card, and out. */
  deathCinema: { phase: 'begin' | 'title' | 'end' };
  /** Build/play switch — UI swaps panels and HUD visibility. */
  modeChanged: { mode: 'build' | 'play' };
  /** A global/material tuning param changed (a slider, the console `param`
   *  command, or a Builder reset). Panels that mirror params — the Sandbox
   *  Global Controls — re-sync their sliders from the live values. */
  paramsChanged: undefined;
  /** Manual stepping / rewind history changed; Sandbox, Builder, and debug panels re-sync. */
  timeControlsChanged: TimeControlStatus;
  /** Live hostile count changed (Levels emits; the wave-era HUD readout that listened is retired). */
  enemiesLeft: { count: number };
  /** The player arrived in a level — HUD shows depth + biome name. */
  levelChanged: { depth: number; name: string };
  /** Gameplay requests the level-transition curtain; Game owns DOM/timing. */
  levelCurtain: { visible: boolean; holdMs?: number; title?: string; detail?: string };
  /** A waystone brazier caught fire — checkpoint set. */
  waystoneLit: undefined;
  /**
   * Player walked up to an unlit waystone. UI shows a prompt: if `card` is set,
   * the player owns a fire spell that isn't on the active wand (offer to equip
   * it); if null, they own none (explain how to bring fire by hand). Exactly one
   * callback runs when the prompt closes.
   */
  waystonePrompt: {
    card: CardId | null;
    onEquip(): void;
    onDismiss(): void;
  };
  /** First-time brew of a recipe — Grimoire entry + gold bounty. */
  recipeDiscovered: { name: string; bounty: number };
  /** Any completed cauldron recipe, including recipes already known in the Grimoire. */
  recipeBrewed: { id: string; name: string; firstDiscovery: boolean };
  /** Any first-time Grimoire entry persisted by the unified knowledge store. */
  grimoireEntryDiscovered: { kind: 'recipe' | 'material' | 'interaction'; id: string; title: string };
  /** A real sim/material interaction was observed near the player and may be inscribed. */
  worldInteractionObserved: { id: string; title: string; x: number; y: number };
  /** A spell card entered the collection — banner + bench refresh. */
  cardGranted: { id: string; name: string };
  /** A compiled spell action actually fired from a wand or trigger payload. */
  cardCast: { id: CardId; origin: 'wand' | 'trigger'; x: number; y: number };
  /** Gameplay asks presentation to show an unskippable choice of spell cards. */
  cardOfferRequested: {
    source: 'tome' | 'sanctum';
    title: string;
    prompt?: string;
    cards: CardId[];
    handled?: boolean;
    onChoose(card: CardId): void;
  };
  /** Active wand or its loadout changed — HUD wand display refresh. */
  wandChanged: undefined;
  /** The wand bench overlay opened — first-run teaching and telemetry listen. */
  benchOpened: undefined;
  /** First time the player nears a given interactable — show a teach-once popover. */
  hintTeach: { key: string; title: string; body: string };
  /** A concussive strike landed at (x, y) — mechanisms/rune vaults listen. */
  structureStrike: { x: number; y: number; radius: number };
  /** A player body impact landed at (x, y) — enemy hearing listens without
   *  treating it as a mechanism/rune strike. */
  groundImpact: { x: number; y: number; radius: number; strength: number };
  /** Short corner toast ("GOLDEN KEY ACQUIRED", "+20 MAX HP", ...). */
  toast: { text: string };
  /** The HUD objective line ("FIND THE GOLDEN KEY" -> "REACH THE PORTAL"). */
  objectiveChanged: { text: string };
  /** The player needs the Refuge; map should briefly ping its bench marker. */
  refugePing: undefined;
  /** The Kiln Colossus is slain: the expedition is complete. */
  runComplete: { gold: number };
  /** Ambient life did something worth hearing (WS-N organisms/ecology): a snapjaw
   *  snapped, a puffer burst, a glow-worm snared or retracted, a predator ate. */
  organism: { kind: string; action: OrganismAction; x: number; y: number };
  /** A boss committed to (or telegraphed) a move — audio/callouts can cue it. */
  bossMove: { kind: EnemyKind; move: string; phase: number; x: number; y: number };
  /** A creature died (any cause), emitted from the one enemy death path before
   *  its aftermath — so a run-ending kill is counted before `runEnded`. */
  enemyKilled: { kind: EnemyKind; x: number; y: number };
  /** A creature died to a material/physical consequence (combat/AlchemyKills). */
  alchemyKill: AlchemyKillInfo;
  /** A world-anchored combat word (ui/Callouts): the Trickshot finisher's line, etc. */
  combatCallout: { x: number; y: number; text: string; tone?: 'brass' | 'finisher' };
  /** The run is over (victory, out of return phials, or replaced). Summary UI, meta profile and share text listen. */
  runEnded: RunSummary;
  /** The music director changed cue (audio/MusicDirector): the narrator and probes listen. */
  musicCue: { cue: string | null; previous: string | null };
  /** The narrator began a line. `captioned`: it has no on-screen text of its own, so the caption shows it. */
  narration: { text: string; seconds: number; captioned: boolean };
  /** Return phials changed (death spent one, a refuge/Sanctum restored one). */
  phialsChanged: { phials: number; max: number; reason: 'start' | 'death' | 'refuge' | 'sanctum' | 'restore' };
  /** Something asked for the last seconds of play to be saved as a clip. */
  clipRequested: { reason: 'hotkey' | 'death' | 'summary' | 'button' };
  /** A clip finished encoding; `url` is an object URL the UI may offer for download. */
  clipSaved: { url: string; filename: string; bytes: number; frames: number; durationMs: number };
  /** A clip request came to nothing (refused, or the encode spoiled); `message` is player-facing. */
  clipFailed: { message: string };
  /** The run ledger (ui/RunSummary) opened or closed; transient cards (a clip) bow out. */
  runLedger: { open: boolean };
  /** Crawler wants to stand but the ceiling says no — HUD CRAMPED glyph. */
  crampedChanged: { cramped: boolean };
  /** A cast was refused for lack of mana (HUD flashes the mana bar). */
  dryFire: undefined;
  /** Flask verb refused (empty pour/throw, siphon into a full flask). */
  flaskDry: undefined;
  /** A flask verb moved real material between inventory, world, or player. */
  flaskUsed: { verb: 'siphon' | 'pour' | 'throw' | 'drink'; material: number | null; amount: number };
  /**
   * Transitional bridge: raw live-world edits from dev tools can mark Builder
   * divergence without importing Builder into gameplay code.
   */
  worldEdited: {
    source: 'console' | 'time-controls' | 'authorlink';
    command: string;
    target: string;
    bounds: { x0: number; y0: number; x1: number; y1: number };
    cells: number;
  };
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
  ): boolean {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return false;
    for (const h of set) (h as Handler<EventMap[K] | undefined>)(payload[0]);
    return true;
  }

  clear(): void {
    this.handlers.clear();
  }
}

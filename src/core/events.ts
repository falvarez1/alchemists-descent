import type { CardId, EnemyKind, LockKind, TimeControlStatus } from '@/core/types';
import type { AlchemyKillInfo, RunSummary } from '@/core/run';
import type { BrewAttemptInfo, CauldronView } from '@/core/alchemy';
import type { StoryCinemaView, StoryDialogueView, StorySpeaker } from '@/core/story';

/** What an organism just did (the `organism` event). */
export type OrganismAction =
  | 'snap' | 'burst' | 'snare' | 'retract' | 'eat' | 'latch' | 'shed' | 'curl' | 'zap' | 'flare'
  | 'scatter' | 'scavenge' | 'die'
  /** A puffer's sac is ripe (tight enough to burst at a touch). */
  | 'swell'
  /** A glow-worm lets its lure back down after hiding. */
  | 'lower';

/** What a corpse just did as a physical object (creatures/corpseWorld). */
export type CorpseMomentKind =
  | 'thud' | 'bowl' | 'splash' | 'ignite' | 'douse' | 'consume' | 'dissolve' | 'freeze' | 'shatter' | 'twitch';

/**
 * A beat of the alchemist's chill (game/Chill). crackle = frost accreting on
 * the body; shell = frozen solid; crack = the shell takes a crack (a press, a
 * blow, heat); shatter = the shell bursts; thaw = the rime cracks off as the
 * body warms; breath = a shivering breath; skin = the wake skins over with ice.
 */
export type ChillMomentKind = 'crackle' | 'shell' | 'crack' | 'shatter' | 'thaw' | 'breath' | 'skin';

/** A phase of the wand's telekinetic grip (combat/Telekinesis). */
export type TelekinesisPhase = 'grab' | 'hold' | 'release' | 'hurl' | 'fizzle' | 'strain';

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
  /** ARENA: a fighter was knocked out (core/arena FighterDownEvent). */
  fighterDown: { slot: number; by: number; source: string; x: number; y: number };
  /** Confirmed, visible health loss in an Arena exchange. No queued inputs or hidden cooldowns. */
  fighterHit: { by: number; victim: number; damage: number; tick: number; attack?: string };
  arenaReset: undefined;
  versusChanged: undefined;
  versusPause: undefined;
  versusMenu: { action: 'previous' | 'next' | 'confirm' | 'back' };
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
  /** A waystone brazier caught fire — checkpoint set. `index` is its place in the floor's list; the altar's offer reads it. */
  waystoneLit: { index: number; depth: number; levelId: string };
  /** First-time brew of a recipe — Grimoire entry + gold bounty. */
  recipeDiscovered: { name: string; bounty: number };
  /** Any completed cauldron recipe, including recipes already known in the Grimoire. */
  recipeBrewed: { id: string; name: string; firstDiscovery: boolean };
  /** The cauldron's bowl as it stands (game/Brewing): contents, fire, progress, verdict. The bowl panel listens; `visible: false` once when the player leaves. */
  cauldronView: CauldronView;
  /** A mix was heated long enough to judge and answered no recipe: what the cauldron made of it (the experiment log, the sounds). */
  brewAttempt: BrewAttemptInfo;
  /** A marginal note was written into the Grimoire by play (game/alchemy/clues). */
  clueUnlocked: { id: string; recipe: string; text: string };
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
    source: 'tome' | 'sanctum' | 'altar' | 'depth';
    title: string;
    prompt?: string;
    cards: CardId[];
    /** One short kicker per card ("Host", "Synergy", "Wild"); absent for a plain tome. */
    labels?: string[];
    handled?: boolean;
    onChoose(card: CardId): void;
  };
  /** Gameplay asks presentation to show a found wand frame (swap wand I or II's frame, or leave it). */
  wandOfferRequested: {
    source: 'boss' | 'altar' | 'sanctum';
    title: string;
    prompt?: string;
    /** WandFrame ids on offer (1 for a find, up to 3 at the Wandwright). */
    frames: string[];
    handled?: boolean;
    /** The player refitted `wand` with `frameId`. */
    onChoose(frameId: string, wand: 0 | 1): void;
    /** The player left it. */
    onDecline?(): void;
  };
  /** A modifier you cast does nothing to the projectile it rode: the HUD says so, once per card per run. */
  deadCardCast: { card: CardId; host: CardId; text: string };
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
  /** FLORA: a stand of living wood lost its footing and began to fall (the
   *  crack). `dir` is the topple side (-1/1, 0 = a straight drop); `cause` is
   *  what cut it. Audio adds its proper cues here. */
  treeFelled: { x: number; y: number; height: number; dir: number; cause: 'dig' | 'fire' | 'blast' | 'kick' | 'acid' | 'unknown'; cells: number };
  /** FLORA: a falling stand struck the ground (strength 0..1; the first strike is the big one). */
  treeLanded: { x: number; y: number; strength: number; first: boolean };
  /** FLORA: a fallen stand came to rest and re-stamped as a log of `cells` Wood. */
  treeSettled: { x: number; y: number; cells: number };
  /** FLORA: a plant moment that wants its own sound (audio/EventCues plays it;
   *  the call sites stay silent).
   *  creak = a notched trunk strains; lean = the hold before the fall; crack =
   *  the cut goes through; snap = the hinge wood / a sapling breaks; whoosh =
   *  the crown rushing down; rustle = leaves shaken; shed = a falling crown
   *  strikes the ground and throws its leaves; podDrop = a pod lets go;
   *  soak = a thirsty seed starts drinking; sprout = it sprouts; rung = a
   *  ladder rung grows; bloom = the ladder's crown opens; settle = a log at rest.
   *  (audio/EventCues FLORA_CUES is the map.) */
  floraMoment: {
    kind: 'creak' | 'lean' | 'crack' | 'snap' | 'whoosh' | 'rustle' | 'shed' | 'podDrop' | 'soak' | 'sprout' | 'rung' | 'bloom' | 'settle';
    x: number;
    y: number;
    strength: number;
  };
  /** A creature died to a material/physical consequence (combat/AlchemyKills). */
  alchemyKill: AlchemyKillInfo;
  /**
   * TELEKINESIS: the wand's grip on a body (a corpse or a crate). grab = it
   * lifts; hold = every tick it is held (audio keeps its hum alive); release =
   * set down or let go; hurl = flung; fizzle = the grip failed (out of mana,
   * out of reach, out of sight) or was refused; strain = too heavy to lift (a nudge).
   */
  telekinesis: { phase: TelekinesisPhase; x: number; y: number; mass: number; target: 'corpse' | 'crate' };
  /** THE CHILL: the body did something with the cold (strength 0..1; `warm` = heat did it). Audio/EventCues plays it. */
  chillMoment: { kind: ChillMomentKind; x: number; y: number; strength: number; warm: boolean };
  /** CORPSES: remains did something physical worth hearing (strength 0..1; audio/EventCues). */
  corpseMoment: { kind: CorpseMomentKind; x: number; y: number; strength: number; mass: number; species: EnemyKind };
  /** A world-anchored combat word (ui/Callouts): the Trickshot finisher's line, etc. */
  combatCallout: { x: number; y: number; text: string; tone?: 'brass' | 'finisher' };
  /** The run is over (victory, out of return phials, or replaced). Summary UI, meta profile and share text listen. */
  runEnded: RunSummary;
  /** The music director changed cue (audio/MusicDirector): the narrator and probes listen. */
  musicCue: { cue: string | null; previous: string | null };
  /** The narrator began a line. `captioned`: it has no on-screen text of its own, so the caption shows it.
   *  `speaker`: a story line's voice (the caption wears its name plate); `silent`: no recording played. */
  narration: { text: string; seconds: number; captioned: boolean; speaker?: StorySpeaker; silent?: boolean };
  /** STORY: the dialogue box's state (game/story publishes, ui/story/DialogueBox shows). */
  storyDialogue: StoryDialogueView;
  /** STORY: a cinematic's plates (the opening, the ending; ui/story/StoryCinema paints them). */
  storyCinema: StoryCinemaView;
  /** STORY: a beat with weight (a boss prologue) draws the letterbox in, and out. */
  storyLetterbox: { on: boolean };
  /** The story's own fade to black and back (the Kiln escape's quick restart after a fall). */
  storyFade: { on: boolean };
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
  /** The alchemist hooded (true) or unhooded (false) his lantern — the light wave's stealth verb. */
  lanternHooded: { hooded: boolean; x: number; y: number; /** Housekeeping (a new floor, a death lifts the hood): no sound. */ quiet?: boolean };
  /** The alchemist stepped into a designed deep-dark zone (once per entry; `darkness` 0..1). */
  darkZoneEntered: { x: number; y: number; darkness: number };
  /** The wand's beam caught a creature's eyes in the dark (they flash back). Audio cue hook. */
  eyeshineCaught: { kind: EnemyKind; x: number; y: number };
  /** A light device answered: a photocell latched, a lumen bloom unfurled/furled. Audio/HUD cues. */
  lightDevice: { kind: 'photocell' | 'bloom-open' | 'bloom-furl'; x: number; y: number };
  /** A floor's LOCK (world/locks) changed: the alchemist came within sight of its machine ('seen', once a floor), the machine
   *  answered and the vault's seal cracked ('opened'), or the Works relented and cracked it themselves ('relented'). */
  lockChanged: { kind: LockKind; phase: 'seen' | 'opened' | 'relented'; x: number; y: number };
  /** Crouch / levitate / pour / siphon LATCHED by the player's Hold-or-toggle option (input/toggleLatches); `held` is what is latched now. */
  inputLatches: { held: Array<'down' | 'jump' | 'pour' | 'interact'> };
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
  /**
   * FIGHTER SLOTS (docs/arena/ARCHITECTURE.md 5). With two fighters in one world a per-fighter object (a kit, a wand system) that
   * listens for `cardCast` or `flaskUsed` must hear only ITS fighter's. A handler registered while `registeringSlot` is set is
   * tagged with that slot, and once the arena turns scoping on (`scoped`) it is called only while `boundSlot` is that slot.
   * Untagged handlers (every shared system) always hear everything. With no rival the flag is off and none of this costs anything.
   */
  /** The events that belong to ONE fighter: with the arena on, a tagged handler hears them only while its slot is bound. */
  private static readonly PER_FIGHTER: ReadonlySet<string> = new Set([
    'cardCast', 'flaskUsed', 'playerRespawned', 'playerDeathCleared', 'enemyKilled', 'wandChanged',
    'cardOfferRequested', 'wandOfferRequested',
  ]);
  registeringSlot: number | null = null;
  boundSlot = 0;
  scoped = false;
  private readonly slotOf = new WeakMap<object, number>();

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    if (this.registeringSlot !== null) this.slotOf.set(handler, this.registeringSlot);
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof EventMap>(
    event: K,
    ...payload: EventMap[K] extends undefined ? [] : [EventMap[K]]
  ): boolean {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return false;
    for (const h of set) {
      if (this.scoped && EventBus.PER_FIGHTER.has(event)) {
        const tag = this.slotOf.get(h);
        if (tag !== undefined && tag !== this.boundSlot) continue;
      }
      // One broken listener must not silence the others or abort the tick that
      // emitted (an audio scheduling error inside `playerDied` once skipped the
      // rest of a game tick). The error is re-thrown on a microtask, so it still
      // reaches the console, page-error probes and the test runner.
      try {
        (h as Handler<EventMap[K] | undefined>)(payload[0]);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
    return true;
  }

  /** How many handlers listen to `event` (a probe asserts a thrown-away fighter leaves none behind). */
  listenerCount(event: keyof EventMap): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /** Register everything `fn` subscribes as belonging to fighter slot `slot`. */
  asSlot<T>(slot: number, fn: () => T): T {
    const was = this.registeringSlot;
    this.registeringSlot = slot;
    try { return fn(); } finally { this.registeringSlot = was; }
  }

  clear(): void {
    this.handlers.clear();
  }
}

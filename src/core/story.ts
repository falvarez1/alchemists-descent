/**
 * Story contracts (Breathing Works wave 3, WS-S). Types only: the story
 * director (game/story), the world's story sites (world/storySites), the
 * narrator's speakers (audio/Narrator), the dialogue box and the Journal meet
 * here so none imports another's class. core/types re-exports what the Ctx
 * and LevelRuntime carry.
 */

/** Who is talking: the Docent (narrator "Daniel"), Pell the surveyor, Matron Ash of the Old Ones. */
export type StorySpeaker = 'docent' | 'pell' | 'ash';

export interface StorySpokenLine {
  speaker: StorySpeaker;
  text: string;
}

export interface StorySpeakOptions {
  /** 'high' interrupts low/normal narration; everything else waits its turn. */
  priority: 'low' | 'normal' | 'high';
  /** Tag for `cut(source)` (a closed dialogue, an echo walked away from). */
  source: string;
  /** Wall ms after which a line that has not started is dropped. */
  ttlMs?: number;
  /** Show the words as a caption (lines with no text of their own on screen). */
  captioned?: boolean;
  /** Skip the "never the same words twice a session" rule (the Journal's replays, repeat visits). */
  repeatable?: boolean;
}

/* ---------------- the world's story sites (static; regenerate with the pristine world) ---------------- */

/** A brass speaking-pipe: drawn on the back wall, its horn at head height above `floorY`. */
export interface StoryPipeSite {
  /** Stable per floor: a hand-placed site's name on floor 1 ('refuge'), else 'p0', 'p1'... */
  id: string;
  x: number;
  /** The floor under the horn (the feet row a player stands on). */
  floorY: number;
  /** Where the pipe comes down from (the first rock above, or the top of the drawn run). */
  top: number;
}

/** Pell's camp: a lit nook (the Warm Refuge's east end on floor 1). */
export interface StoryCampSite {
  x: number;
  /** Feet row Pell stands on. */
  floorY: number;
  facing: 1 | -1;
  /** The nook's interior (for props and the "off the path" audit). */
  x0: number;
  x1: number;
}

/** The resonant valve and the echo's stage beside it. */
export interface StoryValveSite {
  /** The valve wheel (on the back wall at chest height above `floorY`). */
  x: number;
  floorY: number;
  /** Stage centre and half-width (actors play at stageX + dx, fading past the half-width). */
  stageX: number;
  stageHalfW: number;
}

/** A rectangle of cells (inclusive). */
export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * THE KILN FLUE (floor 4): the old chimney beside the Kiln that the escape
 * climbs. Carved at generation behind a metal damper; the Heart's last heave
 * blows the damper, lava and steam rise through the Kiln and up the shaft,
 * and the hatch at the top is the way out.
 */
export interface KilnFlueSite {
  /** The shaft's interior (open cells). */
  shaft: CellRect;
  /** The damper between the Kiln and the shaft (metal until the heave). */
  damper: CellRect;
  /** The low passage from the damper to the shaft's foot (open air). */
  passage: CellRect;
  /** Ledges up the shaft (stone; re-asserted when the escape restarts). */
  ledges: CellRect[];
  /** Loose masonry in the shaft walls that comes down as the lava climbs (trigger: lava row). */
  slabs: Array<CellRect & { at: number }>;
  /** The Kiln's interior the lava also fills. */
  arena: CellRect;
  /** The floor row the lava starts from (the Kiln's floor surface). */
  lavaFrom: number;
  /** Where the apprentice returns after a death in the escape. */
  start: { x: number; y: number };
  /** The hatch landing at the top: reaching it ends the escape. */
  exit: { x: number; y: number };
  /** Which side of the Kiln the flue rises on. */
  side: 1 | -1;
}

export interface LevelStorySites {
  pipes: StoryPipeSite[];
  camp: StoryCampSite | null;
  valve: StoryValveSite | null;
  flue: KilnFlueSite | null;
}

/* ---------------- the run's story state (rides in the expedition save) ---------------- */

export type EscapePhase = 'none' | 'active' | 'done';

export interface StoryRunSave {
  v: 1;
  /** The meta's runs-begun count when this run began (1 = the player's first descent). */
  runIndex: number;
  /** Pipes spoken this run: `${levelId}:${pipeId}`. */
  pipes: string[];
  /** Beat ids spoken this run (again-lines included), so a floor never repeats itself. */
  spoken: string[];
  /** Pell, per level id: met this run, and the gift he gave. */
  pell: Record<string, { met: boolean; gift: string | null }>;
  /** Echo ids watched this run. */
  echoes: string[];
  /** Boss prologues played this run (kind). */
  prologues: string[];
  escape: EscapePhase;
  /**
   * What Pell has already said or offered this run, so he never says it twice:
   * `notice.<id>`, `bark.<id>`, `once.<id>`. Older saves have none (sanitized to empty).
   */
  told: string[];
  /** Pell's compass mark, live until the apprentice reaches it (level, the mark, and how many pickups near it were already taken). */
  pin: { level: string; x: number; y: number; taken: number } | null;
  /** Levels where Pell's mark led the apprentice to a pickup. */
  pinsPaid: string[];
}

/* ---------------- what the story layer draws (render/story reads it every frame) ---------------- */

/** A story figure (Pell, an echo's Guild worker): the rig's inputs, not its pose. */
export interface StoryFigureView {
  x: number;
  /** Feet row. */
  y: number;
  facing: 1 | -1;
  costume: 'surveyor' | 'worker' | 'foreman' | 'docent' | 'stoker' | 'clerk' | 'grinder';
  /** The rig's action ('stand', 'walk', 'sketch', 'warm', 'startle', ...: content/story/echoes FigureAct). */
  act: string;
  /** Seconds into the current action (its own clock: a crank's turn, a startle's jump). */
  actT: number;
  /** Stride phase while walking or running (radians). */
  stride: number;
  /** 0..1: an echo's ghost fades in and out; Pell is 1. */
  alpha: number;
  ghost: boolean;
  /** Where the head turns to (world), or null. */
  lookX: number | null;
  lookY: number | null;
  /** A stable per-figure number (idle breathing phase, flicker). */
  seed: number;
  /** Mouth opening 0..1 driven by the line being said (Pell's conversation); absent, the rig's own chatter. */
  mouth?: number;
  /** Which way the head faces, when it leads the body in a turn (Pell looks round before he turns); absent, with the body. */
  headFacing?: 1 | -1;
  /** Wears a bandage on the near hand (Pell from the third floor on). */
  bandaged?: boolean;
}

/** What has accrued at Pell's camp over the run (presentation only: render/story reads it). */
export interface StoryCampDress {
  /** 1-based floor. */
  floor: number;
  /** Map pages pinned to the wall beside the crate: one for each floor Pell was met on before this one. */
  pages: number;
  /** The tin cup left on the crate: the apprentice took his tea. */
  cup: boolean;
  /** Frost on the floor (the Cold Store). */
  frost: boolean;
  /** His tea tin on the cold camp (floor 4): empty when the tea was taken, still closed when not. */
  tin: 'none' | 'empty' | 'full';
}

export interface StoryRenderView {
  pipes: Array<{ x: number; top: number; floorY: number; speaking: number; spoken: boolean }>;
  camp: (StoryCampSite & { lit: boolean; abandoned: boolean; pageRead: boolean; dress?: StoryCampDress }) | null;
  pell: StoryFigureView | null;
  valve: (StoryValveSite & { turn: number; hum: number; used: boolean }) | null;
  echo: { alpha: number; actors: StoryFigureView[] } | null;
  flue: (KilnFlueSite & { open: boolean; heat: number; lava: number }) | null;
  /** The interact prompt over the thing in reach ("Talk", "Turn the valve", "Read"). */
  prompt: { x: number; y: number; verb: string } | null;
}

/** What the rest of the game asks of the story (game/story/StoryDirector). Absent in small test contexts. */
export interface StoryApi {
  /** A tracked (or test) run began: fresh per-run state; the meta counts it. */
  beginRun(opts: { tracked: boolean }): void;
  snapshotForSave(): StoryRunSave | null;
  restoreFromSave(save: StoryRunSave | undefined): void;
  /** Fixed tick (runs while the player is dead too: the escape restarts itself). */
  update(): void;
  /** E pressed: talk to Pell, turn a resonant valve, read a page. True when the story took the key. */
  interact(): boolean;
  /** The Colossus is down: the Heart heaves and the escape begins. False when there is no escape to run (the caller ends the run). */
  beginEscape(): boolean;
  /** While the escape runs, deaths return here without spending a phial. */
  respawnPoint(): { x: number; y: number } | null;
  readonly escapeActive: boolean;
  /** A story cinematic (the opening or the ending) is on screen. */
  readonly cinematic: 'opening' | 'ending' | null;
  /**
   * A scripted beat has the stage — Pell's dialogue, a boss prologue, a memory
   * echo playing, the Kiln escape, a cinematic, Matron Ash speaking. Teach cards
   * and contextual hint lines wait (ui/HintTeachOverlay, game/Hints).
   */
  readonly beatActive: boolean;
  /** Play the opening now (the title's "The opening"); resolves when it ends or is skipped. */
  playOpening(opts?: { replay?: boolean }): Promise<void>;
  /** The player has seen the opening (the title offers to replay it). */
  readonly openingSeen: boolean;
  /**
   * The Sanctum opened (Matron Ash greets). `nextBiome`: the floor below (its door line).
   * `facts`: what the old ones can read off the run (return phials in the glass before they top one up).
   */
  sanctumOpened(nextBiome: string | null, facts?: { phialsOnArrival: number }): void;
  /** A boon was struck or a provision bought in the Sanctum (Matron Ash answers it, once). */
  sanctumAct?(act: { kind: 'boon' | 'buy'; id: string }): void;
  /** A door in the Sanctum was pointed at or chosen (the Biomes workstream's door choice). */
  sanctumDoor(biome: string): void;
  /** The dialogue box: skip the typing / next line (E, click), pick a choice, or leave (Esc, walk away). */
  dialogueAdvance(): void;
  dialogueChoose(index: number): void;
  dialogueClose(): void;
  /** Any key or click during a cinematic. */
  skipCinematic(): void;
  /** What the story layer draws this frame (render/story). */
  readonly view: StoryRenderView;
  /** The Journal (a Grimoire tab): every page, with what this player has unlocked of it. */
  journal(): StoryJournalPage[];
  /** Read a Journal page aloud in its voices; false when nothing of it is unlocked. */
  readJournal(id: string): boolean;
  /** Stop a Journal reading (the book closed). */
  stopReading(): void;
  /** Read-only state for in-page probes. */
  debugSnapshot(): Record<string, unknown>;
}

/** The dialogue box's state, as the director publishes it (`storyDialogue`). */
export interface StoryDialogueView {
  open: boolean;
  speaker: StorySpeaker;
  /** Name plate. */
  name: string;
  /** The line being said (types on in the box). */
  text: string;
  /** Seconds the voice (or the reading pace) takes over it: the typing keeps pace. */
  seconds: number;
  /** Show the whole line at once (the player skipped the typing). */
  instant?: boolean;
  /** Choices once the greeting is said (1-3); empty while talking or at the farewell. */
  choices: string[];
  /** What each choice gives, beside its label ("Compass mark"); '' for a choice that only talks. Parallel to `choices`. */
  hints?: string[];
  /** Where on screen: the speaker's world position (the box leans toward it). */
  x: number;
  y: number;
}

/** A cinematic plate, as the director publishes it (`storyCinema`). */
export interface StoryCinemaView {
  phase: 'begin' | 'plate' | 'end';
  kind: 'opening' | 'ending';
  /** The painted plate ('town', 'lift', 'works', 'flue', 'window', 'pell', 'lantern', 'farewell'). */
  art?: string;
  title?: string;
  line?: StorySpokenLine | null;
  /** 0-based plate index and count, for the progress pips. */
  index?: number;
  count?: number;
}

/** One Journal page as the Grimoire shows it. */
export interface StoryJournalPage {
  id: string;
  kind: 'docent' | 'echo' | 'pell' | 'ash' | 'ending';
  /** The floor (or the Sanctum, the end) it is filed under. */
  group: string;
  title: string;
  unlocked: boolean;
  /** Only what this player has heard (a Docent's page fills in pipe by pipe). */
  lines: StorySpokenLine[];
  /** Lines of it not yet found (the page's gaps). */
  missing: number;
}

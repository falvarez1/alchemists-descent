import { DEATH_SLOWMO_FRAMES, DEATH_SLOWMO_MIN, VIEW_H, VIEW_W } from '@/config/constants';
import { createDefaultPostFxSettings, createDefaultRenderSettings, createDefaultWandLightSettings, createGameParams } from '@/config/params';
import { installTuningPersistence } from '@/config/tuningStore';
import { EventBus } from '@/core/events';
import { updateLivingExpedition } from '@/game/LivingExpedition';
import { updateHabitatMotion } from '@/game/HabitatMotion';
import { updateSurfaceFoliage } from '@/game/SurfaceFoliage';
import { FoliageCover } from '@/game/FoliageCover';
import { Flora } from '@/game/Flora';
import { advanceTrickshotClock } from '@/combat/Trickshot';
import { TeaMachine } from '@/game/TeaMachine';
import { updateLegSwing } from '@/combat/WeaverLimbs';
import { clearTelekinesis, updateTelekinesis } from '@/combat/Telekinesis';
import { createCorpsesApi } from '@/creatures/corpses';
import { ExpeditionEntry } from '@/ui/ExpeditionEntry';
import { randomSeed } from '@/core/rng';
import { Telemetry } from '@/core/telemetry';
import type { Ctx, FxState, GameStateData, InputState, RenderBackendMode, SanctumApi } from '@/core/types';
import { SfxAudioEngine } from '@/audio/SfxEngine';
import { installAudioDirector } from '@/audio/AudioDirector';
import { installUiSounds } from '@/audio/UiSounds';
import { HabitatAudio } from '@/audio/HabitatAudio';
import { installAudioStingers } from '@/audio/Stingers';
import { installEventCues } from '@/audio/EventCues';
import { Flask } from '@/combat/Flask';
import { AlchemyKills } from '@/combat/AlchemyKills';
import { Lightning } from '@/combat/Lightning';
import { WandSystem } from '@/combat/wands/WandSystem';
import { Projectiles } from '@/combat/Projectiles';
import { Spells } from '@/combat/Spells';
import { Enemies } from '@/entities/Enemies';
import { createPlayer, PlayerControl } from '@/entities/Player';
import { ChillSystem } from '@/game/Chill';
import { FighterSystem } from '@/fighters/FighterSystem';
import { ArenaSlots } from '@/arena/ArenaSlots';
import { LocalVersus } from '@/game/LocalVersus';
import { VersusLobby } from '@/ui/VersusLobby';
import { StockMatchHud } from '@/ui/StockMatchHud';
import { resetDuelStage } from '@/world/duelStage';
import { Physics } from '@/entities/physics';
import { RigidBodies } from '@/entities/RigidBodies';
import { VineStrands } from '@/entities/VineStrands';
import { Brewing } from '@/game/Brewing';
import { FixedStepClock, type FrameCadence } from '@/game/FixedStepClock';
import { createLazyConsoleApi } from '@/game/console/lazyConsole';
import type { PlaySystems } from '@/game/playSystems';
import { loadVirtualWorld } from '@/game/lazyVirtualWorld';
import { Critters } from '@/game/Critters';
import { DebugTool } from '@/game/DebugTool';
import { GrimoireInteractionObserver } from '@/game/GrimoireInteractions';
import { HintSystem } from '@/game/Hints';
import { Levels } from '@/game/Levels';
import { Mechanisms } from '@/game/Mechanisms';
import { Pickups } from '@/game/Pickups';
import { TimeControls } from '@/game/TimeControls';
import { createWaveState } from '@/game/WaveDirector';
import { InputManager } from '@/input/InputManager';
import { currentAppMode, readAppMode, saveAppMode } from '@/game/modePersist';
import { Particles } from '@/particles/Particles';
import { Sparks } from '@/particles/Sparks';
import { DepthScene } from '@/render/depth/DepthScene';
import { Camera } from '@/render/Camera';
import { FrameComposer } from '@/render/FrameComposer';
import { Lighting } from '@/render/Lighting';
import { LightQuery } from '@/render/LightQuery';
import { LightDevices } from '@/game/LightDevices';
import { Renderer } from '@/render/Renderer';
import type { RenderBackendStatus } from '@/render/pixels';
import { drawDecor } from '@/render/sprites/DecorSprites';
import { drawEnemySprite } from '@/render/sprites/EnemySprites';
import { drawPlayerSprite } from '@/render/sprites/PlayerSprite';
import { drawPeerGhosts } from '@/render/sprites/PeerGhostSprite';
import { PeerGhosts } from '@/entities/PeerGhosts';
import { Cell } from '@/sim/CellType';
import { Explosions } from '@/sim/explosion';
import { Simulation } from '@/sim/Simulation';
import { World } from '@/sim/World';
import { cancelChargingBlackHole, resetCombatTransients, setDetachedSandboxWorldSource } from '@/core/runtimeState';
import { fightSink } from '@/core/fightSink';
import { createDefaultStatus } from '@/entities/status';
import { ParallelSim } from '@/sim/parallel/ParallelSim';
import { createSharedWorld, sharedMemoryAvailable } from '@/sim/parallel/sharedWorld';
import { readSavedQuality } from '@/config/playerPrefs';
import { ControllerNotice } from '@/ui/ControllerNotice';
import { PauseOverlay } from '@/ui/PauseOverlay';
import { ConsoleOverlay } from '@/ui/ConsoleOverlay';
import { Hud } from '@/ui/Hud';
import { CellInspector } from '@/ui/CellInspector';
import { Inspector } from '@/ui/Inspector';
import { LevelStore } from '@/ui/LevelStore';
import { Minimap } from '@/ui/Minimap';
import { PerfHud } from '@/ui/PerfHud';
import { RunLauncher } from '@/ui/RunLauncher';
import { RuntimeInspector } from '@/ui/RuntimeInspector';
import { Toolbar } from '@/ui/Toolbar';
import { SandboxChrome } from '@/ui/SandboxChrome';
import { WandBench } from '@/ui/WandBench';
import { WorldGen } from '@/world/CaveGenerator';
import { SANDBOX_FOCUS, stampSandboxArena } from '@/world/sandboxArena';
import { reseedTickStreams } from '@/core/simRandom';
import { DeathCinema } from '@/game/DeathCinema';
import { Clips } from '@/app/Clips';
import { MutatorDirector } from '@/game/MutatorDirector';
import { RunDirector } from '@/game/RunDirector';
import { RunSummary } from '@/ui/RunSummary';
import { RunHud } from '@/ui/RunHud';
import { FighterChips } from '@/ui/FighterChips';
import { FighterArenaPanel } from '@/ui/FighterArenaPanel';
import { runBots } from '@/arena/ai/driver';
import { DialogueBox } from '@/ui/story/DialogueBox';
import { StoryCinemaOverlay } from '@/ui/story/StoryCinema';

/** What unlocks audio (the score's MusicDirector listens for the same three). */
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

function initialRenderBackendOverride(): RenderBackendMode | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('renderBackend');
  return value === 'webgl' || value === 'webgpu' || value === 'auto' ? value : null;
}

function initialWebGpuLiveComposeOverride(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('enableWebGpuLiveCompose') === '1';
}

/**
 * Sim worker threads for the Sandbox's parallel sweep (docs/SANDBOX-MT.md):
 * `?threads=N`, `?threads=0` for the serial sweep. Default: the core count
 * minus two (the main thread sweeps too, and the renderer needs a core),
 * capped at 6, and none on a touch-first device (a phone's cores are not for
 * a paint toy). Needs cross-origin isolation (COOP/COEP) for SharedArrayBuffer.
 * The workers themselves are spawned lazily, on the Sandbox's first frame.
 */
function sandboxSimThreads(): number {
  if (typeof window === 'undefined' || !sharedMemoryAvailable()) return 0;
  const raw = new URLSearchParams(window.location.search).get('threads');
  const touchFirst = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const auto = touchFirst ? 0 : Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 2));
  // The player's Quality: Low keeps the Sandbox on the serial sweep (the choice is made at boot, so it applies on the next load).
  if (raw === null && readSavedQuality(typeof localStorage === 'undefined' ? null : (key) => localStorage.getItem(key)) === 'low') return 0;
  if (raw === null || raw === 'auto') return auto;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.max(0, Math.min(15, n)) : auto;
}

/**
 * Composition root. Builds the shared Ctx once, owns the frame loop, and is
 * the single place that knows every concrete class.
 *
 * The per-frame ordering below is a CONTRACT inherited from the original game
 * (see ARCHITECTURE.md "Frame order is a contract") — do not reorder casually.
 */
/** The HUD's refresh interval: every other frame at 60 Hz, every frame at 30 Hz. */
const HUD_REFRESH_MS = 30;

export class Game {
  /** Public for dev tooling and verification scripts only — not a gameplay API. */
  readonly ctx: Ctx;
  /** Rolling clip capture (app/Clips.ts). Public for dev tooling and probes only. */
  readonly clips: Clips;
  private readonly renderer: Renderer;
  private readonly composer: FrameComposer;
  private readonly hud: Hud;
  private readonly entry: ExpeditionEntry;
  private readonly pollInput: () => void;
  private readonly minimap: Minimap;
  private readonly toolbar: Toolbar;
  private readonly inspector: Inspector;
  private readonly perfHud = new PerfHud();
  private readonly brewing = new Brewing();
  private readonly habitatAudio = new HabitatAudio();
  /** Light wave: lantern housekeeping, the dark-entry beat, lumen blooms. */
  private lightDevices: LightDevices | null = null;
  private deathCinema: DeathCinema | null = null;
  private readonly grimoireInteractions = new GrimoireInteractionObserver();
  private readonly restoreSavedMode: () => void;
  private modePersistDisposer: (() => void) | null = null;
  private visibilityDisposer: (() => void) | null = null;
  private levelCurtainDisposer: (() => void) | null = null;
  private tuningPersistenceDisposer: (() => void) | null = null;
  private levelCurtainTimer: number | null = null;
  private animationFrameId: number | null = null;
  private started = false;
  private disposed = false;
  /**
   * Batch mode (docs/arena/TELEMETRY-AND-BALANCE.md 3.3): while set, the real-time loop idles (no ticks, no
   * render, no clip capture, no input poll) and a harness steps the game with `advance`. Dev tooling only.
   */
  headless = false;
  private lastVisualFxDecayFrame = -1;
  private composeDirty = true;
  private lastComposeSignature = -1;
  /** Wall time of the last HUD refresh (the HUD runs at ~30 Hz of rendered frames). */
  private lastHudMs = -Infinity;
  /** Page-lifetime UI singletons whose global listeners/timers must be torn down on HMR dispose. */
  private readonly disposables: { dispose(): void }[] = [];
  /** The streamed layers' host (the play systems' score and narrator feed it). */
  private readonly audioEngine: SfxAudioEngine;
  /** The play systems chunk (game/playSystems), once asked for. */
  private playSystems: Promise<PlaySystems | null> | null = null;
  /** The Sanctum behind ctx.sanctum's stand-in, once the play systems land. */
  private sanctum: SanctumApi | null = null;
  /** A real gesture landed before the play systems did (the score unlocks on it, as it always has). */
  private gestured = false;

  constructor(holder: HTMLElement) {
    const state: GameStateData = {
      mode: 'build',
      score: 0,
      frameCount: 0,
      activeInputMode: 'element',
      currentElement: Cell.Sand,
      currentSpell: 'bolt',
      currentBiome: 'earthen',
      brushSize: 6,
      playerSpawned: false,
      worldSeed: randomSeed(),
      difficulty: 2, // shipped balance until a run picks otherwise
      paused: false,
      debugGodMode: false,
      debugTainted: false,
      postFx: createDefaultPostFxSettings(),
      render: createDefaultRenderSettings(),
      wandLight: createDefaultWandLightSettings(),
      editorLights: null,
      builderWandLightPreview: { enabled: false, x: 0, y: 0 },
      runtimeInspectionLight: null,
      playtestSource: null,
    };
    state.render.backend = initialRenderBackendOverride() ?? state.render.backend;
    state.render.compose = initialWebGpuLiveComposeOverride() || state.render.compose;
    const input: InputState = {
      keys: { left: false, right: false, up: false, jump: false, wallJump: false, down: false, grab: false },
      mouse: { x: 0, y: 0 },
      isDrawing: false,
      lastX: null,
      lastY: null,
      buildSpellHeld: false,
      bombCharge: -1,
      activeChargingBlackHole: null,
      siphonHeld: false,
      pourHeld: false,
      drinkHeld: false,
    };
    const fx: FxState = { bloomKick: 0, screenShake: 0, digBeam: null, hitstop: 0, deathSlowMo: 0 };

    // Assembled in two steps: data first, then services that close over ctx.
    // Services only USE ctx at runtime, after wiring completes.
    const audio = new SfxAudioEngine();
    this.audioEngine = audio;
    // The score's gesture unlock, watched from boot: its director arrives with
    // the play systems, and a click on the title before then still counts.
    const onGesture = (): void => {
      this.gestured = true;
      for (const type of GESTURES) window.removeEventListener(type, onGesture, { capture: true });
    };
    for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true });
    this.disposables.push({ dispose: () => { for (const type of GESTURES) window.removeEventListener(type, onGesture, { capture: true }); } });
    const simThreads = sandboxSimThreads();
    const ctx = {
      // The Sandbox world; on shared memory when its sweep runs on workers.
      world: simThreads > 0 ? createSharedWorld() : new World(),
      events: new EventBus(),
      audio,
      params: createGameParams(),
      state,
      input,
      fx,
      camera: new Camera(),
      player: createPlayer(),
      enemies: [],
      projectiles: [],
      shockwaves: [],
      waves: createWaveState(),
    } as unknown as Ctx;
    this.disposables.push(audio);
    // Run-event stingers (alchemy chime, phial crack/fill, run verdict, clip shutter).
    this.disposables.push({ dispose: installAudioStingers(ctx.events, audio) });
    // Announced moments: the light devices, organisms, boss moves and plants (audio/EventCues).
    this.disposables.push({ dispose: installEventCues(ctx.events, audio, { biome: () => ctx.levels?.current?.def.biome }) });
    // Sampled layer: per-floor packs and beds, and the interface's own sounds.
    this.disposables.push({ dispose: installAudioDirector(ctx, audio) }, { dispose: installUiSounds(ctx.events, audio) });
    ctx.events.on('paramsChanged', () => {
      this.composeDirty = true;
    });

    ctx.particles = new Particles();
    const sparks = new Sparks();
    ctx.sparks = sparks;
    this.disposables.push({ dispose: ctx.events.on('levelChanged', () => sparks.clear()) });
    ctx.explosions = new Explosions(ctx);
    ctx.lightning = new Lightning(ctx);
    ctx.projectileCtl = new Projectiles();
    ctx.physics = new Physics(ctx);
    const rigidBodies = new RigidBodies(ctx);
    ctx.rigidBodies = rigidBodies;
    this.disposables.push(rigidBodies);
    const vineStrands = new VineStrands(ctx);
    ctx.vineStrands = vineStrands;
    this.disposables.push(vineStrands);
    // Living plants that fall (subscribes to levelChanged AFTER the body pool,
    // so a tree still in flight lands as a log in the world it fell in).
    const flora = new Flora(ctx);
    ctx.flora = flora;
    this.disposables.push(flora);
    const foliageCover = new FoliageCover(ctx);
    ctx.foliageCover = foliageCover;
    this.disposables.push(foliageCover);
    ctx.playerCtl = new PlayerControl(ctx);
    // The graded body cold (brine, nitrogen, frost in; fire, lava, embers out).
    const chill = new ChillSystem(ctx);
    ctx.chill = chill;
    this.disposables.push(chill);
    // The fighter (src/fighters): inert until one is equipped, so the classic Alchemist is untouched.
    const fighters = new FighterSystem(ctx);
    ctx.fighters = fighters;
    this.disposables.push(fighters);
    ctx.peers = new PeerGhosts();
    const enemyCtl = new Enemies(ctx);
    ctx.enemyCtl = enemyCtl;
    this.disposables.push(enemyCtl);
    // Kill attribution + alchemical-kill payouts (emits `alchemyKill`).
    const alchemy = new AlchemyKills(ctx);
    ctx.alchemy = alchemy;
    this.disposables.push(alchemy);
    // The dead as mass (blasts, the boot, plates) and the wand's grip on them.
    ctx.corpses = createCorpsesApi(ctx);
    this.disposables.push({ dispose: ctx.events.on('levelChanged', () => clearTelekinesis()) });
    ctx.spells = new Spells(ctx);
    const simulation = new Simulation();
    ctx.simulation = simulation;
    if (simThreads > 0) {
      const sharedWorld = ctx.world;
      // Lazy: the shared buffers exist now, the workers wait for someone to be in the
      // Sandbox (settleSandboxPool), so a campaign-only visit never spawns them.
      const parallel = new ParallelSim(sharedWorld, { global: ctx.params.global, materials: ctx.params.materials }, simThreads, undefined, { lazy: true });
      simulation.parallel = parallel;
      this.sandboxPool = parallel;
      this.sandboxPoolWorld = sharedWorld;
      this.disposables.push(parallel);
      // A Sandbox detached from a level paints on a copy of it: make that copy
      // the shared world again, so the parallel sweep follows the Sandbox back.
      setDetachedSandboxWorldSource((width, height) => {
        if (width !== sharedWorld.width || height !== sharedWorld.height || ctx.world === sharedWorld) return new World(width, height);
        sharedWorld.clear();
        return sharedWorld;
      });
      this.disposables.push({ dispose: () => setDetachedSandboxWorldSource(null) });
      console.info(`[sandbox-mt] parallel sandbox sweep armed: ${simThreads} workers + main, started with the Sandbox`);
    }
    ctx.worldgen = new WorldGen();
    ctx.flask = new Flask();
    ctx.brewing = this.brewing;
    const telemetry = new Telemetry();
    ctx.telemetry = telemetry;
    this.disposables.push(telemetry);
    const levels = new Levels(ctx);
    ctx.levels = levels;
    this.disposables.push(levels);
    // The run lifecycle (phials, ledger, meta profile). Subscribes before the
    // HUD so its counts are settled when the death screen reads them.
    const run = new RunDirector(ctx);
    ctx.run = run;
    this.disposables.push(run);
    // The run's complications (content/mutators): in force from the run's start, dressing the floors, ticked by RunDirector.
    const mutators = new MutatorDirector(ctx);
    ctx.mutators = mutators;
    this.disposables.push(mutators);
    const wands = new WandSystem(ctx);
    ctx.wands = wands;
    this.disposables.push(wands);
    // ARENA (core/arena): a second fighter's bundle is built here, the one place that names the concrete classes. Its player and
    // input stand in on the Ctx while its systems are constructed (they read them), and every subscription they make is tagged with
    // the slot, so a rival's `cardCast` or `flaskUsed` never feeds this fighter's passive.
    // Local versus uses the same slot runtime in both player and authoring builds.
    ctx.arena = new ArenaSlots(ctx, (slot) => {
      const keepPlayer = ctx.player, keepInput = ctx.input;
      const player = createPlayer();
      const input: InputState = {
        keys: { left: false, right: false, up: false, jump: false, wallJump: false, down: false, grab: false },
        mouse: { x: 0, y: 0 },
        isDrawing: false, lastX: null, lastY: null, buildSpellHeld: false, bombCharge: -1, activeChargingBlackHole: null,
        siphonHeld: false, pourHeld: false, drinkHeld: false,
      };
      ctx.player = player;
      ctx.input = input;
      try {
        return ctx.events.asSlot(slot, () => {
          const playerCtl = new PlayerControl(ctx);
          const chill = new ChillSystem(ctx);
          const fighters = new FighterSystem(ctx);
          const slotWands = new WandSystem(ctx);
          const flask = new Flask();
          return { player, input, playerCtl, wands: slotWands, flask, fighters, chill };
        });
      } finally {
        ctx.player = keepPlayer;
        ctx.input = keepInput;
      }
    });
    const arena = ctx.arena;
    if (arena) this.disposables.push({ dispose: () => { arena.removeRival(1); } });
    ctx.pickups = new Pickups();
    const mechanisms = new Mechanisms(ctx);
    ctx.mechanisms = mechanisms;
    this.disposables.push(mechanisms);
    // The Sanctum's UI arrives with the play systems (game/playSystems); this
    // stand-in answers until then (no run can reach a Sanctum before it lands).
    ctx.sanctum = this.sanctumStandIn();
    const critters = new Critters(ctx);
    ctx.critters = critters;
    this.disposables.push(critters);
    const hints = new HintSystem(ctx);
    ctx.hints = hints;
    this.disposables.push(hints);
    ctx.debug = new DebugTool(ctx);
    ctx.time = new TimeControls(ctx);
    ctx.perf = this.perfHud;
    // The command set loads on first use; a command waits for the play systems,
    // so `run …` from the console (or a probe) never starts a run without them.
    ctx.console = createLazyConsoleApi(ctx, () => this.loadPlaySystems(), { eager: __AUTHORING__ });
    this.ctx = ctx;
    const contraption = new TeaMachine(ctx);
    ctx.contraption = contraption;
    this.disposables.push(contraption);
    const lightDevices = new LightDevices(ctx);
    this.lightDevices = lightDevices;
    this.disposables.push(lightDevices);
    // The score, the narrator and the story (ctx.music / ctx.narrator /
    // ctx.story) are PLAY SYSTEMS: their own chunk, fetched once the title
    // shows (loadPlaySystems). Every way into a run waits for them.

    // Rehydrate live tuning (Global Controls, player feel, worldgen look, material/
    // spell params) from localStorage BEFORE the UI seeds its sliders or the first
    // level generates, then persist on every paramsChanged. Survives HMR + refresh.
    this.tuningPersistenceDisposer = installTuningPersistence(ctx);

    ctx.events.on('playerDied', ({ depth, cause }) => {
      ctx.telemetry.count('death');
      ctx.telemetry.count(`death.cause.${cause}`);
      ctx.telemetry.count(`death.depth.${depth}`);
    });
    // Depth funnel: how far testers actually get (each entry counts, so
    // revisits inflate it — read it as traffic, not unique clears).
    ctx.events.on('levelChanged', ({ depth }) => ctx.telemetry.count(`depth.entered.${depth}`));
    ctx.events.on('benchOpened', () => ctx.telemetry.count('bench.opened'));
    this.levelCurtainDisposer = ctx.events.on('levelCurtain', ({ visible, holdMs = 0, title, detail }) => {
      if (this.levelCurtainTimer !== null) {
        window.clearTimeout(this.levelCurtainTimer);
        this.levelCurtainTimer = null;
      }
      const curtain = document.getElementById('level-curtain');
      const titleEl = document.getElementById('level-curtain-title');
      const detailEl = document.getElementById('level-curtain-detail');
      if (title && titleEl) titleEl.textContent = title;
      if (detail && detailEl) detailEl.textContent = detail;
      if (visible) {
        curtain?.classList.add('visible');
        // Said aloud through the always-exposed live region beside the (decorative) curtain.
        const live = document.getElementById('level-curtain-live');
        if (live) live.textContent = [titleEl?.textContent, detailEl?.textContent].filter(Boolean).join('. ');
        // Force reflow so the curtain class commits before synchronous generation.
        if (curtain) void curtain.offsetHeight;
        return;
      }
      const hide = (): void => {
        curtain?.classList.remove('visible');
        this.levelCurtainTimer = null;
        // Empty at rest, so the next arrival's words are a change and get announced.
        window.setTimeout(() => {
          const live = document.getElementById('level-curtain-live');
          if (live && !curtain?.classList.contains('visible')) live.textContent = '';
        }, 1500);
      };
      if (holdMs > 0) this.levelCurtainTimer = window.setTimeout(hide, holdMs);
      else hide();
    });

    // Layered scenery: per-biome depth kits behind the play layer and the
    // foreground occluders in front of it (render/depth, config/depthKits).
    const depth = new DepthScene();
    this.renderer = new Renderer(holder, state.render, depth.foreground);
    // Light as a gameplay fact (light wave): creatures, plants and devices
    // read the field the composer builds through ctx.lightQuery.
    const lighting = new Lighting();
    ctx.lightQuery = new LightQuery(ctx, lighting);
    this.composer = new FrameComposer(
      this.renderer,
      lighting,
      depth,
      drawPlayerSprite,
      drawPeerGhosts,
      drawEnemySprite,
      drawDecor,
    );

    this.hud = new Hud(ctx);
    this.disposables.push(this.hud);
    // The run ledger, and the return phials beside the vitals / on the death screen.
    const runSummary = new RunSummary(ctx);
    this.disposables.push(runSummary);
    this.disposables.push(new RunHud(ctx, () => runSummary.showLast()));
    // The fighter's tactical and ultimate chips under the flask belt (nothing for the classic Alchemist).
    this.disposables.push(new FighterChips(ctx));
    // The Proving Yard's card (steps through the fighters, ticks off their moves); it shows only in that level.
    if (__AUTHORING__) this.disposables.push(new FighterArenaPanel(ctx));
    const versus = new LocalVersus(ctx, () => this.loadPlaySystems().then(systems => systems !== null));
    ctx.versus = versus;
    this.disposables.push(versus, new VersusLobby(ctx), new StockMatchHud(ctx, () => {
      if (versus.active) versus.rematch();
      else { resetDuelStage(ctx); ctx.arena?.reset(); }
    }));
    // The story's dialogue box (Pell) with its interact prompt, and the opening/ending plates.
    // (Matron Ash's voice comes with the play systems.)
    this.disposables.push(new DialogueBox(ctx), new StoryCinemaOverlay(ctx));
    this.minimap = new Minimap(ctx);
    this.disposables.push(this.minimap);
    // (Callouts and the card-offer and teach overlays: play systems. The unlit
    // waystone teaches by a teach card now — game/waystoneHelp — not a modal.)
    this.disposables.push(new ControllerNotice(ctx));
    // Self-binds the B key; lives for the page lifetime.
    this.disposables.push(new WandBench(ctx));
    // Authoring/debug surface. Not constructed at all in a play build — the
    // console self-binds the backtick key and the inspector can pose gameplay
    // state, so stripping their header buttons would leave both reachable.
    if (__AUTHORING__) {
      // Transitional dev console: typed QA commands + automation adapter.
      this.disposables.push(new ConsoleOverlay(ctx));
      // Top-level runtime inspector for Play and Builder Playtest.
      this.disposables.push(new RuntimeInspector(ctx));
    }
    // Wires the Level Library buttons; lives for the page lifetime.
    this.disposables.push(new LevelStore(ctx));
    // Header PLAY opens the canonical run launcher; Builder playtests bypass it.
    // A player build never reaches it (the entry screen claims every request),
    // so it is authoring-only and absent from that build.
    if (__AUTHORING__) this.disposables.push(new RunLauncher(ctx));
    // ESC pause; the Handbook (H) comes with the play systems, so pause
    // registers FIRST and its keydown handler sees the help overlay still open
    // and yields ESC to it.
    this.disposables.push(new PauseOverlay(ctx));
    this.inspector = new Inspector(ctx);
    this.disposables.push(this.inspector);
    this.toolbar = new Toolbar(ctx, (id, mode) => this.inspector.generateContextInspector(id, mode));
    this.disposables.push(this.toolbar);
    // The authoring Sandbox's chrome behaviour (dock tabs, inspector sections, the Developer
    // menu). It binds nothing the owners above bind; a player build's Workshop has none of it.
    if (__AUTHORING__) this.disposables.push(new SandboxChrome(ctx));
    // Debug cell readout under the cursor (toggle with `I`). Self-managing; lives
    // for the page lifetime like the other DOM-wiring UI modules above.
    this.disposables.push(new CellInspector(ctx));
    // (The wizard's Grimoire book, `J`, comes with the play systems.)
    // Wires its DOM listeners in the constructor; lives for the page lifetime.
    const inputManager = new InputManager(this.renderer.domElement, ctx);
    this.disposables.push(inputManager);
    this.pollInput = () => inputManager.poll();
    // Its Begin / Continue / Today's descent wait for the play systems.
    this.entry = new ExpeditionEntry(ctx, () => this.loadPlaySystems().then((systems) => systems !== null));
    this.disposables.push(this.entry);
    // Keeps the last ~10 s of frames for GIF clips; captures in renderFrame.
    this.clips = new Clips(ctx, () => this.renderer.domElement);
    this.disposables.push(this.clips);
    this.restoreSavedMode = () => {
      if (!import.meta.env.DEV) return;
      const mode = readAppMode();
      if (mode === 'play') inputManager.setMode('play');
      // null -> nothing saved; boot stays in the default Sandbox.
    };
  }

  /**
   * Boot sequence (original lines 4106-4117), then kick off the rAF loop.
   * `deferWorkshop`: the player route opens on the entry screen, so the
   * Sandbox workshop (~30 ms of cell stamping, and a lit scene rendered
   * every frame behind an opaque overlay) waits until someone actually
   * leaves the entry for the Sandbox, the Builder or the run launcher.
   */
  start(options: { deferWorkshop?: boolean } = {}): void {
    if (this.started || this.disposed) return;
    this.started = true;

    // Authoring builds: the virtual-world prototype (run launcher, Builder
    // preview) is its own chunk; have it in before anyone can pick it.
    if (__AUTHORING__) void loadVirtualWorld();
    this.inspector.generateContextInspector(Cell.Sand, 'element');
    this.toolbar.injectToolbarIcons();
    this.hud.buildHotbar();
    this.ctx.events.emit('scoreChanged', { score: this.ctx.state.score });

    // Boot into the WORKSHOP, not campaign cave terrain. `generateCaves` builds
    // a level you never play, and since GEN_VERSION 30 it packs everything below
    // the caves solid to bedrock — so the app opened on a misleading picture of
    // itself with nowhere to actually drop sand. "Generate Caves" is still one
    // click away for anyone who wants the generator.
    this.bootWorld = this.ctx.world;
    if (options.deferWorkshop) this.workshopPending = true;
    else this.buildWorkshop();

    // A hidden tab is the most likely prelude to a closed one — checkpoint.
    const checkpointOnHidden = (): void => {
      if (
        document.hidden &&
        this.ctx.state.mode === 'play' &&
        this.ctx.state.playtestSource === null &&
        !this.ctx.debug.active &&
        !this.ctx.player.dead
      ) {
        this.ctx.levels.saveExpedition(this.ctx);
      }
    };
    document.addEventListener('visibilitychange', checkpointOnHidden);
    this.visibilityDisposer = () => document.removeEventListener('visibilitychange', checkpointOnHidden);

    // Dev-only: return to the mode we were in before a Vite full-reload,
    // instead of always falling back to the Sandbox.
    void (this.ctx.levels.ready ?? Promise.resolve()).then(async () => {
      if (this.disposed) return;
      // Dev: a reload restoring play, the dev console and the headless probes
      // drive runs the moment the title shows, so the play systems come first.
      if (import.meta.env.DEV) await this.loadPlaySystems();
      if (this.disposed) return;
      if (this.ctx.state.mode === 'build') this.restoreSavedMode();
      this.wireModePersistence();
      this.entry.show();
      this.entryDecided = true;
      // Player builds: fetched under the title, long before a click needs them.
      void this.loadPlaySystems();
    });

    this.animationFrameId = requestAnimationFrame(this.step);
  }

  /**
   * Fetch and install the play systems (game/playSystems) — once; every later
   * call returns the same promise. Resolves null if the chunk cannot arrive
   * (the entry then says so instead of starting a run without them).
   */
  loadPlaySystems(): Promise<PlaySystems | null> {
    this.playSystems ??= import('@/game/playSystems').then(
      ({ installPlaySystems }) => {
        if (this.disposed) return null;
        let systems: PlaySystems;
        try {
          systems = installPlaySystems(this.ctx, this.audioEngine, this.gestured);
        } catch (error) {
          console.error('[game] the play systems could not start', error);
          return null;
        }
        this.sanctum = systems.sanctum;
        this.disposables.push(...systems.disposables);
        this.entry.refreshStory();
        return systems;
      },
      (error: unknown) => {
        console.error('[game] the play systems could not load', error);
        return null;
      },
    );
    return this.playSystems;
  }

  /** ctx.sanctum until the play systems land: closed, and a request waits for them. */
  private sanctumStandIn(): SanctumApi {
    const real = (): SanctumApi | null => this.sanctum;
    const whenReady = (act: (sanctum: SanctumApi) => void): void => {
      const now = real();
      if (now) act(now);
      else void this.loadPlaySystems().then(() => { const late = real(); if (late) act(late); });
    };
    return {
      get isOpen(): boolean { return real()?.isOpen ?? false; },
      get chosenDoor(): string | null { return real()?.chosenDoor ?? null; },
      open: (ctx, onDescend) => whenReady((sanctum) => sanctum.open(ctx, onDescend)),
      openShop: (ctx) => whenReady((sanctum) => sanctum.openShop(ctx)),
      quickDescend: (door) => real()?.quickDescend?.(door) ?? false,
      dismiss: () => real()?.dismiss?.(),
      applyBoon: (ctx, id) => real()?.applyBoon?.(ctx, id) ?? false,
    };
  }

  private bootWorld: Ctx['world'] | null = null;
  private workshopPending = false;
  /**
   * The Sandbox's sim-worker pool (docs/SANDBOX-MT.md): built armed at boot with its
   * shared buffers, its workers spawned by `settleSandboxPool` once someone is actually in the
   * Sandbox. (Not on the Sandbox world's first tick: the boot world ticks ~24 frames behind the
   * title before the title pauses it, which would spawn the pool for every visitor.)
   */
  private sandboxPool: ParallelSim | null = null;
  private sandboxPoolWorld: Ctx['world'] | null = null;
  /** Set once boot has decided whether the entry screen shows (it waits on `levels.ready`). */
  private entryDecided = false;

  private buildWorkshop(): void {
    this.workshopPending = false;
    stampSandboxArena(this.ctx);
    this.ctx.camera.snapTo(SANDBOX_FOCUS.x, SANDBOX_FOCUS.y);
  }

  /**
   * The deferred workshop, resolved on the first presentation frame where the
   * boot world is actually on screen in the Sandbox: the entry screen is gone,
   * nothing replaced the world, and the Builder has not claimed it. A run
   * swapping in its level, or the Builder opening on the boot world, cancels
   * it — stamping later would overwrite what they put there. Runs before the
   * tick, like a toolbar click would.
   */
  private settleDeferredWorkshop(): void {
    const { ctx } = this;
    const body = document.body.classList;
    if (ctx.world !== this.bootWorld || body.contains('builder-open')) { this.workshopPending = false; return; }
    if (!this.entryDecided || ctx.state.mode !== 'build' || body.contains('entry-active')) return;
    this.buildWorkshop();
  }

  /**
   * Start the Sandbox's sim workers the first presentation frame someone is in the Sandbox: the
   * entry screen has decided and gone, the mode is the Workshop's, the world on screen is the
   * Sandbox's shared one, and the Builder has not claimed it. A campaign-only visit, the title
   * screen and a phone that never opens the Workshop spawn nothing.
   */
  private settleSandboxPool(): void {
    const pool = this.sandboxPool;
    if (pool === null || pool.isStarted) return;
    const { ctx } = this;
    const body = document.body.classList;
    if (!this.entryDecided || ctx.state.mode !== 'build' || ctx.world !== this.sandboxPoolWorld) return;
    if (body.contains('entry-active') || body.contains('builder-open')) return;
    pool.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.modePersistDisposer?.();
    this.modePersistDisposer = null;
    this.visibilityDisposer?.();
    this.visibilityDisposer = null;
    this.levelCurtainDisposer?.();
    this.levelCurtainDisposer = null;
    this.tuningPersistenceDisposer?.();
    this.tuningPersistenceDisposer = null;
    if (this.levelCurtainTimer !== null) {
      window.clearTimeout(this.levelCurtainTimer);
      this.levelCurtainTimer = null;
    }
    // Tear down the page-lifetime UI singletons (global listeners + timers).
    // Wrap each so one failing teardown doesn't strand the rest.
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch (error) {
        console.warn('UI singleton dispose failed', error);
      }
    }
    this.disposables.length = 0;
    this.ctx.events.clear();
    this.perfHud.dispose();
    this.renderer.dispose();
  }

  getRenderBackendStatus(): RenderBackendStatus {
    return this.renderer.getBackendStatus();
  }

  /**
   * Mirror the live app mode into sessionStorage on every change so the next
   * boot — a manual refresh OR Vite's own full-reload — returns to it (see
   * modePersist). Build<->Play fires `modeChanged`; the Builder only toggles a
   * body class, so we also watch that. Dev only; production keeps the canonical
   * Sandbox-first, launcher-gated boot.
   */
  private wireModePersistence(): void {
    if (!import.meta.env.DEV || this.modePersistDisposer) return;
    const save = (): void => saveAppMode(currentAppMode(this.ctx.state.mode));
    const unsubscribe = this.ctx.events.on('modeChanged', save);
    const observer = new MutationObserver(save);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.modePersistDisposer = () => {
      unsubscribe();
      observer.disconnect();
    };
    save(); // record whatever mode we booted/restored into
  }

  /** Fixed-timestep accumulator (the game is authored in 60Hz frames). */
  private readonly clock = new FixedStepClock();
  private cadence: FrameCadence = { interval: 0, ticks: 0, debt: 0, dropped: 0, alpha: 0 };
  private static readonly STEP_MS = 1000 / 60;

  /**
   * FRAME PACING: rAF fires at the monitor's refresh rate, but every timer,
   * probability, and velocity in this game is a per-60Hz-frame constant. With
   * no pacing, a 144Hz monitor ran the WORLD 2.4x faster (and burned 2.4x
   * the CPU). The accumulator runs ticks at 60Hz wall time wherever rAF
   * lands. Catch-up is bounded per render, with ordinary debt carried forward
   * and suspension loss exposed to the performance recorder.
   */
  private trickshotLastTime = 0;
  private step = (now: number): void => {
    if (this.disposed) return;
    this.animationFrameId = requestAnimationFrame(this.step);
    if (this.headless) return;
    if (this.workshopPending) this.settleDeferredWorkshop();
    if (this.sandboxPool !== null && !this.sandboxPool.isStarted) this.settleSandboxPool();
    // Poll on presentation frames so Start can also resume a paused simulation.
    this.pollInput();
    // Death slow-mo: stretch the wall-clock cost of a tick so the sim advances
    // in slow motion (the ramp eases back to real-time as the timer runs out).
    // Render still fires every rAF, so the ragdoll tumble is smooth, not choppy.
    const frameDt = this.trickshotLastTime ? now - this.trickshotLastTime : 0;
    const trickshotScale = advanceTrickshotClock(this.ctx, frameDt);
    this.trickshotLastTime = now;
    if (!this.deathCinema) { this.deathCinema = new DeathCinema(this.ctx); this.disposables.push(this.deathCinema); }
    this.deathCinema.update(frameDt / 1000);
    let stepBudget = Game.STEP_MS / trickshotScale;
    const slowMo = this.ctx.fx.deathSlowMo;
    if (slowMo > 0 && !this.ctx.state.paused) {
      const t = Math.min(1, slowMo / DEATH_SLOWMO_FRAMES); // 1 at death -> 0 at end
      const scale = DEATH_SLOWMO_MIN + (1 - DEATH_SLOWMO_MIN) * (1 - t); // MIN -> 1
      stepBudget = Game.STEP_MS / Math.min(scale, trickshotScale);
    }
    const frameWorkStart = performance.now();
    this.cadence = this.clock.advance(now, stepBudget, this.ctx.time.manual || this.ctx.state.paused);
    if (this.ctx.time.manual) {
      const ticks = this.ctx.time.takeQueuedTicks(60);
      for (let i = 0; i < ticks; i++) this.tick(false, { forcePaused: true });
      this.ctx.time.afterManualTicks(ticks);
      this.renderFrame(frameWorkStart, ticks);
      return;
    }
    let ticks = 0;
    for (let i = 0; i < this.cadence.ticks && !this.ctx.state.paused; i++) { this.tick(false); ticks++; }
    this.renderFrame(frameWorkStart, ticks);
  };

  private tick = (render = true, options: { forcePaused?: boolean } = {}): void => {
    const frameWorkStart = performance.now();
    this.ctx.time.beforeTick();
    this.updateFixedTick(options);
    if (render) this.renderFrame(frameWorkStart, 1);
  };

  /**
   * Step `ticks` fixed ticks of the game by hand, paused or not (a harness's loop: probes, the fight batch).
   * Nothing is rendered unless `render` is set: compose, lighting and GL live only in `renderFrame`, which is
   * most of a frame's cost. Dev tooling only, like the rest of this handle.
   */
  advance(ticks: number, options: { render?: boolean } = {}): void {
    const render = options.render === true;
    for (let i = 0; i < ticks; i++) this.tick(render, { forcePaused: true });
  }

  /**
   * Put the game back to a repeatable starting state for one fight (docs/arena/TELEMETRY-AND-BALANCE.md 3.3, the
   * recipe of scripts/verify-sim-determinism.mjs): the seed and the clocks, every transient store, the body's
   * vitals and the seeded streams. `rebuild` re-stamps the terrain afterwards (the Proving Yard passes its own
   * reset). The caller then equips the fighter, awaits its kit (`ctx.fighters.whenReady()`) and places the foes.
   * Bot decisions use their own seeded Rng, never `entityRandom`: anything that draws from the entity stream
   * outside a tick shifts it, and each tick reseeds it from (worldSeed, frameCount) alone.
   */
  resetForFight(seed: number, rebuild?: (ctx: Ctx) => void): void {
    const ctx = this.ctx;
    ctx.state.worldSeed = seed >>> 0;
    ctx.state.frameCount = 0;
    this.lastVisualFxDecayFrame = -1;
    ctx.enemies.length = 0;
    ctx.rigidBodies.clear();
    ctx.vineStrands.clear();
    ctx.critters.clear();
    ctx.sparks?.clear();
    resetCombatTransients(ctx, { projectiles: 'clear-all', simulationAccumulator: true });
    ctx.fx.hitstop = 0;
    ctx.fx.deathSlowMo = 0;
    ctx.fx.bloomKick = 0;
    ctx.fx.screenShake = 0;
    ctx.input.queuedJump = undefined;
    if (rebuild) rebuild(ctx);
    // `World.clear` zeroes the moved plane but not its epoch: the wrap point would land at a different substep each fight.
    ctx.world.movedTick = 1;
    ctx.simulation.accumulator = 0;
    // The body: whole, still, standing, with nothing left of the last fight on it.
    const p = ctx.player;
    ctx.playerCtl.resetTransientState(ctx);
    cancelChargingBlackHole(ctx);
    p.dead = false;
    p.hp = p.maxHp;
    p.mana = p.maxMana;
    p.levit = p.maxLevit;
    p.invuln = 0;
    p.cooldown = 0;
    p.firing = false;
    p.firePressed = false;
    p.lastDamageSource = null;
    p.tpCool = 0;
    p.vx = 0;
    p.vy = 0;
    p.fx = 0;
    p.fy = 0;
    p.recharge = 0;
    p.pullT = 0;
    p.inLiquid = false;
    p.staggerT = 0;
    p.recoilT = 0;
    p.kickT = 0;
    p.hat = { ox: 0, oy: 0, vx: 0, vy: 0, pvx: 0, pvy: 0 };
    p.status = createDefaultStatus();
    ctx.state.arrivalGraceUntil = 0;
    for (const wand of ctx.wands.wands) {
      wand.mana = wand.frame.manaMax;
      wand.cooldown = 0;
      wand.castIndex = 0;
    }
    // The sim window follows the camera: a camera left where the last fight parked it changes which cells are simulated at all.
    ctx.camera.snapTo(p.x, p.y - 70);
    ctx.camera.updateSimBounds(ctx.world);
    // Subsystems that listen for a cleared death (the clip recorder, the score, the fighter, the chill) start clean too.
    ctx.events.emit('playerDeathCleared');
    // Last: the foes spawned and the fighter equipped next draw from streams that start where they started last time.
    reseedTickStreams(ctx.state.worldSeed, 0);
  }

  private updateFixedTick(options: { forcePaused?: boolean } = {}): void {
    const ctx = this.ctx;
    if (ctx.state.paused && options.forcePaused !== true) return;
    const tickStart = performance.now();
    this.composer.capturePoses(ctx);
    ctx.state.frameCount++;

    // Seed this tick's entity and fx streams before ANY system runs, so every
    // draw inside the tick is a function of (worldSeed, tick) alone. The cell
    // sim reseeds itself per substep — see Simulation.processFrame.
    reseedTickStreams(ctx.state.worldSeed, ctx.state.frameCount);

    // Expedition autosave: every ~30s of play, a closed tab costs nothing.
    if (
      ctx.state.mode === 'play' &&
      ctx.state.playtestSource === null &&
      !ctx.state.paused &&
      !ctx.debug.active &&
      !ctx.state.debugTainted &&
      !ctx.state.debugGodMode &&
      !ctx.player.dead &&
      ctx.state.frameCount % 1800 === 0
    ) {
      ctx.levels.saveExpedition(ctx);
    }

    // Unpaused play time in minutes (60Hz fixed tick → 3600 frames/min): the
    // denominator for every playtest rate (deaths/hour, depth/hour).
    if (ctx.state.mode === 'play' && !ctx.state.paused && ctx.state.frameCount % 3600 === 0) {
      ctx.telemetry.count('play.minutes');
    }

    // Impact hitstop freezes gameplay for a beat; the Sanctum pauses it
    // outright. Rendering continues through both.
    const forcePaused = options.forcePaused === true;
    const frozen = (ctx.fx.hitstop > 0 || ctx.state.paused) && !forcePaused;
    if (ctx.fx.hitstop > 0 && (!ctx.state.paused || forcePaused)) ctx.fx.hitstop--;
    if (ctx.fx.deathSlowMo > 0 && (!ctx.state.paused || forcePaused) && !frozen) ctx.fx.deathSlowMo--;

    ctx.camera.update(ctx);
    ctx.camera.updateSimBounds(ctx.world);
    if (ctx.state.mode === 'play') {
      // Physical interest follows the body. Camera lead, zoom and inspectors
      // cannot change which creatures or rigid bodies are awake.
      const bounds = ctx.world.simBounds;
      bounds.x0 = Math.max(0, Math.floor(ctx.player.x - VIEW_W / 2 - 80));
      bounds.x1 = Math.min(ctx.world.width, Math.ceil(ctx.player.x + VIEW_W / 2 + 80));
      bounds.y0 = Math.max(0, Math.floor(ctx.player.y - VIEW_H / 2 - 80));
      bounds.y1 = Math.min(ctx.world.height, Math.ceil(ctx.player.y + VIEW_H / 2 + 80));
      ctx.arena?.extendSimBounds(bounds); // (a rival's surroundings are simulated too)
    }
    ctx.contraption?.includeSimulation();

    if (!frozen) {
      ctx.world.simulationTick = ctx.state.frameCount;
      // Debug freeze (Runtime panel): the material sim and the non-selected
      // entity systems hold still so the world can be inspected/posed; enemies,
      // critters, the player, and the drag tool stay gated per-entity by `live`.
      const dbg = ctx.debug;
      const debugActive = ctx.state.mode === 'play' && dbg.active;
      const tSim = performance.now();
      if (!debugActive) {
        // Read contact pairs before the sim consumes them into steam/ice/stone.
        this.grimoireInteractions.update(ctx);
        ctx.simulation.update(ctx);
      }
      const simMs = performance.now() - tSim;
      this.perfHud.mark('sim', simMs);

      const tEnt = performance.now();
      if (!dbg.frozenPlayer()) {
        // A computer fighter, if one is installed (src/arena/ai), writes this tick's inputs just before the body reads them.
        // (an arena: who resolves first is a seeded coin each tick, so neither fighter has the edge of landing its blow before the other moves)
        const rivalsFirst = ctx.arena !== undefined && ctx.arena.active && ctx.arena.rivalsFirst();
        if (rivalsFirst) ctx.arena?.runRivals('body');
        runBots(ctx);
        // (an arena: a rival's slow is TIME, so a slowed fighter runs only a fraction of its ticks)
        if (ctx.arena === undefined || ctx.arena.runsBody(0)) {
          ctx.playerCtl.update(ctx);
          // The body's temperature follows where it now stands (its moveK is read next tick).
          ctx.chill?.update(ctx);
          // The fighter's abilities act on the body that just moved, before the enemies think.
          ctx.fighters?.update(ctx);
        }
        if (!rivalsFirst) ctx.arena?.runRivals('body');
        if (!ctx.player.dead) updateLegSwing(ctx);
        updateTelekinesis(ctx);
      }
      if (!debugActive) {
        if (!ctx.arena?.stockMatch || ctx.arena.runsBody(0)) ctx.flask.update(ctx);
        ctx.arena?.runRivals('flask');
      }
      const enemyStart = performance.now();
      ctx.foliageCover?.update(ctx);
      ctx.enemyCtl.update(ctx); // self-gates per enemy via ctx.debug.frozenEnemy
      let creatureMs = performance.now() - enemyStart;
      // Rigid bodies integrate against THIS frame's settled terrain, after the
      // sim and the kinematic entities. Impulses from later systems this frame
      // (wands, lightning, and any explosions they trigger) land next frame —
      // a one-frame lag that's imperceptible for debris.
      // Flora first: a stand severed by this tick's sim becomes a hinged body
      // that steps in the same solver pass (and settled logs re-stamp).
      ctx.flora?.update(ctx);
      ctx.rigidBodies.update(ctx); // self-freezes when debug is active
      if (!debugActive) {
        ctx.vineStrands.update(ctx);
        // The descent replaced wave survival (Wave B): levels own population,
        // transitions, waystones, and the explored mask.
        ctx.levels.update(ctx);
        ctx.run?.update(ctx);
        if (!ctx.arena?.stockMatch) ctx.story?.update();
        ctx.pickups.update(ctx);
        ctx.mechanisms.update(ctx);
        this.lightDevices?.update(ctx);
        ctx.contraption?.update();
        updateLivingExpedition(ctx);
        updateHabitatMotion(ctx);
        updateSurfaceFoliage(ctx);
        this.habitatAudio.update(ctx);
      }
      const preyStart = performance.now();
      ctx.critters.update(ctx); // self-gates per critter
      creatureMs += performance.now() - preyStart;
      if (!debugActive) {
        this.brewing.update(ctx);
        ctx.hints.update(ctx);
        if (!ctx.arena?.stockMatch || ctx.arena.runsBody(0)) ctx.wands.update(ctx);
        ctx.arena?.runRivals('wands');
        ctx.particles.update(ctx);
        ctx.lightning.update();
        ctx.lightning.ambientDischarge();
      }
      this.updateBuildModeHeldSpells();
      ctx.arena?.endTick();
      if (debugActive) dbg.update(); // drag the grabbed entity to the cursor
      this.perfHud.mark('entities', performance.now() - tEnt);
      const totalMs = performance.now() - tickStart;
      this.perfHud.recordTick(simMs, creatureMs, Math.max(0, totalMs - simMs - creatureMs), totalMs);
      // A fight recorder samples after every system has run (dev only: null, and one check, otherwise).
      fightSink?.tick();
    }

  }

  private renderFrame(frameWorkStart = performance.now(), tickCount = 0): void {
    const ctx = this.ctx;
    this.perfHud.beginFrame(tickCount, this.cadence);
    const tRender = performance.now();
    const signature = this.composeSignature(ctx);
    const interpolating = ctx.state.mode === 'play' && !ctx.state.paused && !ctx.time.manual;
    const shouldCompose = tickCount > 0 || this.composeDirty || signature !== this.lastComposeSignature || (interpolating && this.composer.hasMovingPoses(ctx));
    if (shouldCompose) {
      this.composer.compose(ctx, interpolating ? this.cadence.alpha : 1);
      this.lastComposeSignature = signature;
      this.composeDirty = false;
    }
    const tCompose = performance.now();
    this.perfHud.mark('compose', shouldCompose ? tCompose - tRender : 0);
    // ~30 Hz by wall time, not by tick parity: a frame that ran two ticks (a
    // 30 Hz display, a busy frame) kept frameCount odd at every render and the
    // whole HUD froze (QA: the last floor's "The portal is open" stayed up ~2 s
    // after arrival).
    if (ctx.state.mode === 'play' && frameWorkStart - this.lastHudMs >= HUD_REFRESH_MS) {
      this.lastHudMs = frameWorkStart;
      this.hud.update(ctx);
    }
    this.minimap.update(ctx);
    const tGl = performance.now();
    this.renderer.render(ctx);
    this.perfHud.mark('gl', performance.now() - tGl);
    // Same task as the draw: without preserveDrawingBuffer this is the only
    // moment the canvas can be read. Read-only; the frame order is unchanged.
    this.clips.afterRender();
    this.perfHud.mark('render', performance.now() - tRender);

    // Dig beam fades on drawn frames, but physics lifetime is fixed-tick based.
    // High-refresh render frames must not expire the shove before the next tick.
    const digBeam = ctx.fx.digBeam;
    if (digBeam && digBeam.life > 0) {
      digBeam.physicsLife ??= digBeam.life;
      const minVisibleLife = digBeam.physicsLife > 0 ? 1 : 0;
      digBeam.life = Math.max(minVisibleLife, digBeam.life - 1);
    }
    this.decayVisualFxOncePerFrame(ctx);
    this.perfHud.mark('frame', performance.now() - frameWorkStart);
  }

  private composeSignature(ctx: Ctx): number {
    const input = ctx.input;
    const digBeam = ctx.fx.digBeam;
    const post = ctx.state.postFx;
    const render = ctx.state.render;
    let h = 2166136261;
    const mix = (value: number): void => {
      h = Math.imul(h ^ (value | 0), 16777619) >>> 0;
    };
    const mixFloat = (value: number): void => mix(Math.round(value * 1000));
    mix(Math.floor(ctx.camera.x));
    mix(Math.floor(ctx.camera.y));
    mix(ctx.state.mode === 'play' ? 1 : 0);
    mix(ctx.state.frameCount);
    mix(ctx.world.mutationVersion);
    mix(ctx.projectiles.length);
    mix(ctx.shockwaves.length);
    mix(input.mouse.x | 0);
    mix(input.mouse.y | 0);
    mix(input.siphonHeld ? 1 : 0);
    mix(input.pourHeld ? 1 : 0);
    mix(input.buildSpellHeld ? 1 : 0);
    if (digBeam) {
      mix(digBeam.life);
      mix(digBeam.x0 | 0);
      mix(digBeam.y0 | 0);
      mix(digBeam.x1 | 0);
      mix(digBeam.y1 | 0);
    } else {
      mix(0);
    }
    mix(post.gpuCompose ? 1 : 0);
    mix(post.gpuParticles ? 1 : 0);
    mix(post.gpuOverlay ? 1 : 0);
    mix(render.compose ? 1 : 0);
    mixFloat(ctx.params.global.ambient);
    mixFloat(ctx.params.global.maxBrightness);
    return h;
  }

  private decayVisualFxOncePerFrame(ctx: Ctx): void {
    if (this.lastVisualFxDecayFrame === ctx.state.frameCount) return;
    this.lastVisualFxDecayFrame = ctx.state.frameCount;
    if (ctx.fx.screenShake > 0.0005) ctx.fx.screenShake *= 0.88;
    else ctx.fx.screenShake = 0;
    if (ctx.fx.bloomKick > 0.001) ctx.fx.bloomKick *= 0.86;
    else ctx.fx.bloomKick = 0;
  }

  /** Build-mode dig/flame streams while the mouse is held (original lines 3250-3262). */
  private updateBuildModeHeldSpells(): void {
    const ctx = this.ctx;
    const held =
      ctx.state.mode === 'build' && ctx.input.buildSpellHeld && ctx.state.activeInputMode === 'spell';
    if (!held) return;

    if (ctx.state.currentSpell === 'dig') {
      const sx = ctx.camera.renderX + Math.floor(VIEW_W / 2);
      const sy = ctx.camera.renderY + VIEW_H - 14;
      const a = Math.atan2(ctx.input.mouse.y - sy, ctx.input.mouse.x - sx);
      const hit = ctx.spells.digRay(sx, sy, a, 420);
      const reach = hit ? Math.hypot(hit.x - sx, hit.y - sy) : 420;
      ctx.fx.digBeam = {
        x0: sx,
        y0: sy,
        x1: sx + Math.cos(a) * reach,
        y1: sy + Math.sin(a) * reach,
        life: 3,
      };
      ctx.audio.dig();
      if (hit) ctx.spells.erodeAt(hit.x, hit.y, 5);
    }
    if (ctx.state.currentSpell === 'flame') {
      ctx.spells.emitBuildFlame();
    }
    if (ctx.state.currentSpell === 'vitriol') {
      ctx.spells.castBuildSpell('vitriol', ctx.input.mouse.x, ctx.input.mouse.y);
    }
  }
}

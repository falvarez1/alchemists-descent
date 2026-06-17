import { VIEW_H, VIEW_W } from '@/config/constants';
import { createDefaultPostFxSettings, createDefaultRenderSettings, createDefaultWandLightSettings, createGameParams } from '@/config/params';
import { EventBus } from '@/core/events';
import { randomSeed } from '@/core/rng';
import { Telemetry } from '@/core/telemetry';
import type { Ctx, FxState, GameStateData, InputState, RenderBackendMode } from '@/core/types';
import { AudioEngine } from '@/audio/AudioEngine';
import type { Builder } from '@/builder/Builder';
import { Flask } from '@/combat/Flask';
import { Lightning } from '@/combat/Lightning';
import { WandSystem } from '@/combat/wands/WandSystem';
import { Projectiles } from '@/combat/Projectiles';
import { Spells } from '@/combat/Spells';
import { Enemies } from '@/entities/Enemies';
import { createPlayer, PlayerControl } from '@/entities/Player';
import { Physics } from '@/entities/physics';
import { RigidBodies } from '@/entities/RigidBodies';
import { VineStrands } from '@/entities/VineStrands';
import { Brewing } from '@/game/Brewing';
import { createConsoleApi } from '@/game/console/commands';
import { Critters } from '@/game/Critters';
import { Levels } from '@/game/Levels';
import { Mechanisms } from '@/game/Mechanisms';
import { Pickups } from '@/game/Pickups';
import { createWaveState, WaveDirector } from '@/game/WaveDirector';
import { InputManager } from '@/input/InputManager';
import { currentAppMode, readAppMode, saveAppMode } from '@/game/modePersist';
import { Particles } from '@/particles/Particles';
import { Background } from '@/render/Background';
import { Camera } from '@/render/Camera';
import { FrameComposer } from '@/render/FrameComposer';
import { Lighting } from '@/render/Lighting';
import { Renderer } from '@/render/Renderer';
import type { RenderBackendStatus } from '@/render/pixels';
import { drawDecor } from '@/render/sprites/DecorSprites';
import { drawEnemySprite } from '@/render/sprites/EnemySprites';
import { drawPlayerSprite } from '@/render/sprites/PlayerSprite';
import { Cell } from '@/sim/CellType';
import { Explosions } from '@/sim/explosion';
import { Simulation } from '@/sim/Simulation';
import { World } from '@/sim/World';
import { CardOfferOverlay } from '@/ui/CardOfferOverlay';
import { WaystonePromptOverlay } from '@/ui/WaystonePromptOverlay';
import { HelpOverlay } from '@/ui/HelpOverlay';
import { PauseOverlay } from '@/ui/PauseOverlay';
import { ConsoleOverlay } from '@/ui/ConsoleOverlay';
import { Hud } from '@/ui/Hud';
import { Inspector } from '@/ui/Inspector';
import { LevelStore } from '@/ui/LevelStore';
import { Minimap } from '@/ui/Minimap';
import { Sanctum } from '@/ui/Sanctum';
import { PerfHud } from '@/ui/PerfHud';
import { RunLauncher } from '@/ui/RunLauncher';
import { RuntimeInspector } from '@/ui/RuntimeInspector';
import { Toolbar } from '@/ui/Toolbar';
import { WandBench } from '@/ui/WandBench';
import { WorldGen } from '@/world/CaveGenerator';

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
 * Composition root. Builds the shared Ctx once, owns the frame loop, and is
 * the single place that knows every concrete class.
 *
 * The per-frame ordering below is a CONTRACT inherited from the original game
 * (see ARCHITECTURE.md "Frame order is a contract") — do not reorder casually.
 */
export class Game {
  /** Public for dev tooling and verification scripts only — not a gameplay API. */
  readonly ctx: Ctx;
  private readonly renderer: Renderer;
  private readonly composer: FrameComposer;
  private readonly hud: Hud;
  private readonly minimap: Minimap;
  private readonly toolbar: Toolbar;
  private readonly inspector: Inspector;
  private readonly perfHud = new PerfHud();
  private readonly brewing = new Brewing();
  private readonly restoreSavedMode: () => void;
  private modePersistDisposer: (() => void) | null = null;
  private visibilityDisposer: (() => void) | null = null;
  private levelCurtainDisposer: (() => void) | null = null;
  private levelCurtainTimer: number | null = null;
  private animationFrameId: number | null = null;
  private builderPromise: Promise<Builder> | null = null;
  private started = false;
  private disposed = false;

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
      paused: false,
      debugGodMode: false,
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
    const fx: FxState = { bloomKick: 0, screenShake: 0, digBeam: null, hitstop: 0 };

    // Assembled in two steps: data first, then services that close over ctx.
    // Services only USE ctx at runtime, after wiring completes.
    const ctx = {
      world: new World(),
      events: new EventBus(),
      audio: new AudioEngine(),
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

    ctx.particles = new Particles();
    ctx.explosions = new Explosions(ctx);
    ctx.lightning = new Lightning(ctx);
    ctx.projectileCtl = new Projectiles();
    ctx.physics = new Physics(ctx);
    ctx.rigidBodies = new RigidBodies(ctx);
    ctx.vineStrands = new VineStrands(ctx);
    ctx.playerCtl = new PlayerControl(ctx);
    ctx.enemyCtl = new Enemies(ctx);
    ctx.spells = new Spells(ctx);
    ctx.simulation = new Simulation();
    ctx.worldgen = new WorldGen();
    ctx.waveCtl = new WaveDirector(ctx);
    ctx.flask = new Flask();
    ctx.telemetry = new Telemetry();
    ctx.levels = new Levels(ctx);
    ctx.wands = new WandSystem(ctx);
    ctx.pickups = new Pickups();
    ctx.mechanisms = new Mechanisms(ctx);
    ctx.sanctum = new Sanctum(ctx);
    ctx.critters = new Critters(ctx);
    ctx.perf = this.perfHud;
    ctx.console = createConsoleApi(ctx);
    this.ctx = ctx;

    ctx.events.on('playerDied', () => ctx.telemetry.count('death'));
    ctx.events.on('waveStarted', ({ num }) => ctx.telemetry.count(`wave.reached.${num}`));
    this.levelCurtainDisposer = ctx.events.on('levelCurtain', ({ visible, holdMs = 0, onComplete }) => {
      if (this.levelCurtainTimer !== null) {
        window.clearTimeout(this.levelCurtainTimer);
        this.levelCurtainTimer = null;
      }
      const curtain = document.getElementById('level-curtain');
      if (visible) {
        curtain?.classList.add('visible');
        // Force reflow so the curtain class commits before synchronous generation.
        if (curtain) void curtain.offsetHeight;
        onComplete?.();
        return;
      }
      const hide = (): void => {
        curtain?.classList.remove('visible');
        this.levelCurtainTimer = null;
        onComplete?.();
      };
      if (holdMs > 0) this.levelCurtainTimer = window.setTimeout(hide, holdMs);
      else hide();
    });

    this.renderer = new Renderer(holder, state.render);
    this.composer = new FrameComposer(
      this.renderer,
      new Lighting(),
      new Background(),
      drawPlayerSprite,
      drawEnemySprite,
      drawDecor,
    );

    this.hud = new Hud(ctx);
    this.minimap = new Minimap(ctx);
    new CardOfferOverlay(ctx);
    new WaystonePromptOverlay(ctx);
    // Self-binds the B key; lives for the page lifetime.
    new WandBench(ctx);
    // Transitional dev console: typed QA commands + automation adapter.
    new ConsoleOverlay(ctx);
    // Top-level runtime inspector for Play and Builder Playtest.
    new RuntimeInspector(ctx);
    // Wires the Level Library buttons; lives for the page lifetime.
    new LevelStore(ctx);
    // Header PLAY opens the canonical run launcher; Builder playtests bypass it.
    new RunLauncher(ctx);
    // The authoring overlay (injects its own DOM + header button).
    this.builderPromise = this.mountBuilder(ctx);
    void this.builderPromise.catch(() => undefined);
    // ESC pause + the Handbook (H); pause registers FIRST so its keydown
    // handler sees the help overlay still open and yields ESC to it.
    new PauseOverlay(ctx);
    new HelpOverlay(ctx);
    this.inspector = new Inspector(ctx);
    this.toolbar = new Toolbar(ctx, (id, mode) => this.inspector.generateContextInspector(id, mode));
    // Wires its DOM listeners in the constructor; lives for the page lifetime.
    const inputManager = new InputManager(this.renderer.domElement, ctx);
    this.restoreSavedMode = () => {
      if (!import.meta.env.DEV) return;
      const mode = readAppMode();
      if (mode === 'play') inputManager.setMode('play');
      else if (mode === 'builder') this.openBuilderWhenReady();
      // null -> nothing saved; boot stays in the default Sandbox.
    };
  }

  private mountBuilder(ctx: Ctx): Promise<Builder> {
    return import('@/builder/Builder')
      .then(({ Builder: BuilderCtor }) => {
        const builder = new BuilderCtor(ctx);
        if (import.meta.env.DEV) {
          (ctx as Ctx & { builder?: Builder }).builder = builder;
        }
        return builder;
      })
      .catch((error) => {
        console.error('Builder failed to load', error);
        throw error;
      });
  }

  private openBuilderWhenReady(): void {
    void this.builderPromise
      ?.then((builder) => builder.open())
      .catch(() => undefined);
  }

  /** Boot sequence (original lines 4106-4117), then kick off the rAF loop. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;

    this.inspector.generateContextInspector(Cell.Sand, 'element');
    this.toolbar.injectToolbarIcons();
    this.hud.buildHotbar();
    this.ctx.events.emit('scoreChanged', { score: this.ctx.state.score });

    this.ctx.worldgen.generateCaves(this.ctx);
    const hint = this.ctx.worldgen.spawnHint;
    if (hint) this.ctx.camera.snapTo(hint.x, hint.y);

    // A hidden tab is the most likely prelude to a closed one — checkpoint.
    const checkpointOnHidden = (): void => {
      if (
        document.hidden &&
        this.ctx.state.mode === 'play' &&
        this.ctx.state.playtestSource === null &&
        !this.ctx.player.dead
      ) {
        this.ctx.levels.saveExpedition(this.ctx);
      }
    };
    document.addEventListener('visibilitychange', checkpointOnHidden);
    this.visibilityDisposer = () => document.removeEventListener('visibilitychange', checkpointOnHidden);

    // Dev-only: return to the mode we were in before a Vite full-reload,
    // instead of always falling back to the Sandbox.
    this.restoreSavedMode();
    this.wireModePersistence();

    this.animationFrameId = requestAnimationFrame(this.step);
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
    if (this.levelCurtainTimer !== null) {
      window.clearTimeout(this.levelCurtainTimer);
      this.levelCurtainTimer = null;
    }
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
  private lastStepTime = 0;
  private stepDebt = 0;
  private static readonly STEP_MS = 1000 / 60;

  /**
   * FRAME PACING: rAF fires at the monitor's refresh rate, but every timer,
   * probability, and velocity in this game is a per-60Hz-frame constant. With
   * no pacing, a 144Hz monitor ran the WORLD 2.4x faster (and burned 2.4x
   * the CPU). The accumulator runs ticks at 60Hz wall time wherever rAF
   * lands; at most 2 catch-up ticks so a long hitch slows time instead of
   * spiraling.
   */
  private step = (now: number): void => {
    if (this.disposed) return;
    this.animationFrameId = requestAnimationFrame(this.step);
    if (this.lastStepTime === 0) this.lastStepTime = now;
    this.stepDebt += Math.min(100, now - this.lastStepTime);
    this.lastStepTime = now;
    if (this.stepDebt < Game.STEP_MS) return; // high-refresh idle rAF: free
    let ticks = 0;
    while (this.stepDebt >= Game.STEP_MS && ticks < 2) {
      this.stepDebt -= Game.STEP_MS;
      ticks++;
      this.tick();
    }
    if (this.stepDebt >= Game.STEP_MS) this.stepDebt = 0; // drop unpayable debt
  };

  private tick = (): void => {
    const ctx = this.ctx;
    const tFrame = performance.now();
    ctx.state.frameCount++;

    // Expedition autosave: every ~30s of play, a closed tab costs nothing.
    if (
      ctx.state.mode === 'play' &&
      ctx.state.playtestSource === null &&
      !ctx.state.paused &&
      !ctx.player.dead &&
      ctx.state.frameCount % 1800 === 0
    ) {
      ctx.levels.saveExpedition(ctx);
    }

    // Impact hitstop freezes gameplay for a beat; the Sanctum pauses it
    // outright. Rendering continues through both.
    const frozen = ctx.fx.hitstop > 0 || ctx.state.paused;
    if (ctx.fx.hitstop > 0 && !ctx.state.paused) ctx.fx.hitstop--;

    ctx.camera.update(ctx);
    ctx.camera.updateSimBounds(ctx.world);

    if (!frozen) {
      const tSim = performance.now();
      ctx.simulation.update(ctx);
      this.perfHud.mark('sim', performance.now() - tSim);

      const tEnt = performance.now();
      ctx.playerCtl.update(ctx);
      ctx.flask.update(ctx);
      ctx.enemyCtl.update(ctx);
      // Rigid bodies integrate against THIS frame's settled terrain, after the
      // sim and the kinematic entities. Impulses from systems that run later this
      // frame (wands/projectiles → explosions) land on the bodies next frame —
      // a one-frame lag that's imperceptible for debris.
      ctx.rigidBodies.update(ctx);
      ctx.vineStrands.update(ctx);
      // The descent replaced wave survival (Wave B): levels own population,
      // transitions, waystones, and the explored mask.
      ctx.levels.update(ctx);
      ctx.pickups.update(ctx);
      ctx.mechanisms.update(ctx);
      ctx.critters.update(ctx);
      this.brewing.update(ctx);
      ctx.wands.update(ctx);
      ctx.particles.update(ctx);
      ctx.lightning.update();
      this.updateBuildModeHeldSpells();
      this.perfHud.mark('entities', performance.now() - tEnt);
    }

    // Compose the frame, sync the HUD on even frames, then present.
    const tRender = performance.now();
    this.composer.compose(ctx);
    const tCompose = performance.now();
    this.perfHud.mark('compose', tCompose - tRender);
    if (ctx.state.mode === 'play' && ctx.state.frameCount % 2 === 0) this.hud.update(ctx);
    this.minimap.update(ctx);
    const tGl = performance.now();
    this.renderer.render(ctx);
    this.perfHud.mark('gl', performance.now() - tGl);
    this.perfHud.mark('render', performance.now() - tRender);

    // Dig beam fades after 3 drawn frames (decay moved out of the renderer —
    // approved deviation 7; same cadence as the original).
    if (ctx.fx.digBeam && ctx.fx.digBeam.life > 0) ctx.fx.digBeam.life--;

    this.perfHud.mark('frame', performance.now() - tFrame);
  };

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

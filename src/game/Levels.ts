// ===================== Levels (the Descent) =====================
// Wave B: the arena becomes a vertical stack of persistent levels connected
// by sealed wells. Each visited level stays a LIVE World instance in RAM for
// the whole session — your scars stay exactly as you left them when you
// return (no snapshot codec yet; that arrives with persistence/autosave).
//
// v1 decisions encoded here:
// - The descent is linear d1->d5 (worldgraph.ts); going down = breaking the
//   floor well's plug and falling through. Re-ascending an open well is
//   allowed by levitation (both levels stay live).
// - Arrival placement: whether descending OR re-ascending, the player is
//   placed at the destination level's spawn chamber. Spawning inside the well
//   column is unsafe while plug debris settles; revisit when wells get
//   per-direction arrival points.
// - The bottom of the run (d5) has no exit: the player is clamped above the
//   world floor instead of falling out.

import { HEIGHT, MINIMAP_H, MINIMAP_W, WIDTH } from '@/config/constants';
import { GEN_VERSION } from '@/config/gen';
import { LEVELS, START_LEVEL, populationForLevel, vaultHostId } from '@/config/worldgraph';
import { Rng, hashSeed, randomSeed } from '@/core/rng';
import { base64ToBytes, bytesToBase64, rleDecode, rleEncode, sparsePairs } from '@/core/rle';
import type {
  Ctx,
  Enemy,
  EnemyKind,
  LevelDef,
  LevelRuntime,
  LevelsApi,
  Mechanism,
  Pickup,
  RunLoadoutPreset,
  RunStartConfig,
  RunStartResult,
  RunStatus,
  RuneVault,
  WandLoadoutSave,
  Waystone,
} from '@/core/types';
import { createPlayer, grantFullReviewKit } from '@/entities/Player';
import { createDefaultStatus } from '@/entities/status';
import { spawnPrefabEnemy } from '@/game/instantiate';
import { makePickup, POTION_KINDS } from '@/game/Pickups';
import { makeLevelRuntime } from '@/game/runtime';
import { validateFindability, wizardMask } from '@/world/validate';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, emberColor, EMPTY_COLOR, packRGB } from '@/sim/colors';
import { World } from '@/sim/World';
import { EXTRAS } from '@/world/biomeExtras';
import { extractRegionGraph } from '@/world/regions';

/** Frames the transition curtain stays down after the (synchronous) swap. */
const CURTAIN_HOLD_MS = 450;
/** Waystone bowl fire checks run every 4th frame; this many hot checks light it. */
const WAYSTONE_LIGHT_TICKS = 30;
/** Minimum placement distance (cells) between a placed enemy and the level spawn. */
const POPULATION_SPAWN_CLEARANCE = 220;
const POPULATION_CLEARANCE_STEPS = [POPULATION_SPAWN_CLEARANCE, 150, 80, 0] as const;
const POPULATION_ATTEMPTS_PER_PASS = 36;
const ROOST_ATTEMPTS_PER_PASS = 160;

interface PopulationSpotOptions {
  minY?: number;
  maxY?: number;
  xMargin?: number;
  attempts?: number;
  clearances?: readonly number[];
  preferMainPath?: boolean;
  extra?: (x: number, y: number) => boolean;
}

/* ---------------- expedition save format (localStorage) ---------------- */

const EXPEDITION_KEY = 'noita-expedition';
const LEGACY_REVIEW_PERKS = [
  'might',
  'vampirism',
  'featherweight',
  'manafont',
  'swiftfoot',
  'torchbearer',
  'ironhide',
  'flameward',
  'toxinward',
  'goldmagnet',
];
const LEGACY_REVIEW_WANDS = [
  { frameId: 'brass', cards: ['spark', 'double', 'speed', 'flame', 'lightning'] },
  { frameId: 'void', cards: ['dig', 'conjure', 'vitriol', 'blackhole', 'warp'] },
];

export interface SavedEnemyState {
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dmgK: number;
  timer?: number;
  attackCd?: number;
  bobPhase?: number;
  sleeping?: boolean;
  alerted?: boolean;
  patrol?: Array<[number, number]>;
  patrolIdx?: number;
  calmT?: number;
  recoil?: number;
  fusing?: number;
  punching?: number;
  windup?: number;
  swoop?: number;
  tumble?: number;
  submerged?: boolean;
}

interface SavedLevelBlob {
  id: string;
  /** RLE cell types; colors regenerate from the seed + a diff recolor pass. */
  rle: string;
  life: Array<[number, number]>;
  charge: Array<[number, number]>;
  explored: string;
  waystones: Waystone[];
  pickups: Pickup[];
  mechanisms: Mechanism[];
  runeVaults: RuneVault[];
  keyTaken: boolean;
  portalOpen: boolean;
  litOrder: number[];
  enemies: SavedEnemyState[];
}

interface ExpeditionSave {
  v: 1;
  /** GEN_VERSION at save time; resume retires saves from other generations
   *  (restoreLevel regenerates pristine worlds from seed — a stale save
   *  against new generation silently desyncs). Absent = pre-guard save. */
  genVersion?: number;
  expeditionSeed: number;
  currentId: string;
  score: number;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    levit: number;
    maxLevit: number;
    perks: Record<string, true>;
  };
  loadout: WandLoadoutSave;
  levels: SavedLevelBlob[];
}

function nonNegativeInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function finiteNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return value;
}

export function snapshotEnemyForSave(e: Enemy): SavedEnemyState {
  const saved: SavedEnemyState = {
    kind: e.kind,
    x: e.x,
    y: e.y,
    hp: e.hp,
    maxHp: e.maxHp,
    dmgK: e.dmgK ?? 1,
    timer: e.timer,
    attackCd: e.attackCd,
    bobPhase: e.bobPhase,
  };
  if (e.sleeping === true) saved.sleeping = true;
  if (e.alerted === true) saved.alerted = true;
  if (e.patrol && e.patrol.length > 0) {
    saved.patrol = e.patrol.map(([x, y]) => [x, y] as [number, number]);
  }
  if (e.patrolIdx !== undefined) saved.patrolIdx = e.patrolIdx;
  if (e.calmT !== undefined) saved.calmT = e.calmT;
  if (e.recoil !== undefined) saved.recoil = e.recoil;
  if (e.fusing !== undefined) saved.fusing = e.fusing;
  if (e.punching !== undefined) saved.punching = e.punching;
  if (e.windup !== undefined) saved.windup = e.windup;
  if (e.swoop !== undefined) saved.swoop = e.swoop;
  if (e.tumble !== undefined) saved.tumble = e.tumble;
  if (e.submerged === true) saved.submerged = true;
  return saved;
}

export function reviveSavedEnemy(se: SavedEnemyState): Enemy {
  const enemy: Enemy = {
    kind: se.kind,
    x: se.x,
    y: se.y,
    fx: 0,
    fy: 0,
    vx: 0,
    vy: 0,
    hp: se.hp,
    maxHp: se.maxHp,
    dmgK: finiteNumber(se.dmgK, 1),
    flash: 0,
    timer: nonNegativeInt(se.timer, 0),
    attackCd: nonNegativeInt(se.attackCd, 60),
    bobPhase: finiteNumber(se.bobPhase, 0),
    grounded: false,
    stride: 0,
    splat: 0,
    prevG: false,
    blink: 0,
    jetFuel: 0,
    jetCd: 0,
    stuckT: 0,
    status: createDefaultStatus(),
  };
  if (se.sleeping === true) enemy.sleeping = true;
  if (se.alerted === true) enemy.alerted = true;
  if (se.patrol && se.patrol.length > 0) {
    enemy.patrol = se.patrol.map(([x, y]) => [x, y] as [number, number]);
    enemy.patrolIdx = nonNegativeInt(se.patrolIdx, 0) % enemy.patrol.length;
  }
  if (se.calmT !== undefined) enemy.calmT = nonNegativeInt(se.calmT, 0);
  if (se.recoil !== undefined) enemy.recoil = nonNegativeInt(se.recoil, 0);
  if (se.fusing !== undefined) enemy.fusing = nonNegativeInt(se.fusing, 0);
  if (se.punching !== undefined) enemy.punching = nonNegativeInt(se.punching, 0);
  if (se.windup !== undefined) enemy.windup = nonNegativeInt(se.windup, 0);
  if (se.swoop !== undefined) enemy.swoop = nonNegativeInt(se.swoop, 0);
  if (se.tumble !== undefined) enemy.tumble = nonNegativeInt(se.tumble, 0);
  if (se.submerged === true) enemy.submerged = true;
  return enemy;
}

export class Levels implements LevelsApi {
  /** Every level visited this expedition, kept live (keyed by LevelDef.id). */
  private levels = new Map<string, LevelRuntime>();
  private currentId: string | null = null;
  /** Previous expedition pointer while a disposable custom playtest is current. */
  private preCustomCurrentId: string | null = null;
  private _transitioning = false;

  /**
   * worldSeed captured on the FIRST startDescent. Level seeds derive from
   * this, not the live state.worldSeed, so build-mode regenerations mid-
   * session cannot shift the seeds of levels not yet generated.
   */
  private expeditionSeed = 0;

  /** Per-waystone accumulated hot ticks for the CURRENT level (reset on enter). */
  private waystoneHeat: number[] = [];
  /** Waystone indices per level id, in the order they were lit (last = respawn anchor). */
  private litOrder = new Map<string, number[]>();
  /** Last hostile count emitted via enemiesLeft. */
  private lastEnemiesEmit = -1;
  /** Levels already topped up with the review potion belt this session. */
  private reviewKitSeeded = new Set<string>();

  constructor(private ctx: Ctx) {}

  get current(): LevelRuntime | null {
    return this.currentId ? (this.levels.get(this.currentId) ?? null) : null;
  }

  get transitioning(): boolean {
    return this._transitioning;
  }

  startRun(ctx: Ctx, config: RunStartConfig): RunStartResult {
    const mode = config.mode;
    const worldSource = config.worldSource;
    if (worldSource === 'virtual-world') {
      return {
        ok: false,
        message: 'Chunked virtual worlds are available in the Builder World Map preview, but are not materialized into Play mode yet.',
        mode,
        worldSource,
        levelId: null,
        seed: ctx.state.worldSeed >>> 0,
        reason: 'virtual-runtime-unavailable',
      };
    }

    const levelId = worldSource === 'campaign'
      ? START_LEVEL
      : (config.levelId ?? START_LEVEL).toLowerCase();
    if (!LEVELS[levelId]) {
      return {
        ok: false,
        message: `Unknown level "${config.levelId ?? ''}".`,
        mode,
        worldSource,
        levelId,
        seed: ctx.state.worldSeed >>> 0,
        reason: 'level-invalid',
      };
    }

    this.enterPlayMode(ctx);

    if (mode === 'normal' && worldSource === 'campaign' && config.continueSave !== false) {
      if (ctx.state.playtestSource !== null) {
        this.resetRunState(ctx, { clearSave: false });
      }
      ctx.state.playtestSource = null;
      this.startDescent(ctx);
      return {
        ok: true,
        message: this.current ? `Continuing ${this.current.def.name}.` : 'Continuing descent.',
        mode,
        worldSource,
        levelId: this.current?.def.id ?? null,
        seed: this.expeditionSeed >>> 0,
      };
    }

    const seed = config.seed !== undefined && Number.isFinite(config.seed)
      ? config.seed >>> 0
      : randomSeed();
    this.resetRunState(ctx, { clearSave: mode === 'normal' });
    ctx.state.worldSeed = seed;
    this.expeditionSeed = seed;
    ctx.state.playtestSource = mode === 'test' ? 'test' : null;

    const preset = config.loadout ?? 'fresh';
    if (mode === 'normal' && (worldSource !== 'campaign' || levelId !== START_LEVEL || preset !== 'fresh')) {
      ctx.state.debugGodMode = true;
    }
    this.applyLoadoutPreset(ctx, preset);
    this.enterLevel(ctx, levelId);

    const runtime = this.current;
    const label = runtime?.def.name ?? levelId.toUpperCase();
    const prefix = mode === 'test' ? 'Test run' : 'Fresh expedition';
    ctx.events.emit('toast', { text: `${prefix.toUpperCase()}: ${label}` });
    return {
      ok: true,
      message: `${prefix} started at ${label}.`,
      mode,
      worldSource,
      levelId: runtime?.def.id ?? levelId,
      seed,
    };
  }

  runStatus(ctx: Ctx): RunStatus {
    const rt = this.current;
    return {
      mode: ctx.state.mode,
      playtestSource: ctx.state.playtestSource,
      savedExpedition: this.hasSavedExpedition(),
      autosaveEnabled: ctx.state.mode === 'play' && ctx.state.playtestSource === null && !ctx.state.debugGodMode,
      debugGodMode: ctx.state.debugGodMode,
      worldSeed: (this.expeditionSeed || ctx.state.worldSeed) >>> 0,
      level: rt ? { id: rt.def.id, name: rt.def.name, depth: rt.def.depth } : null,
      player: {
        x: ctx.player.x,
        y: ctx.player.y,
        hp: ctx.player.hp,
        maxHp: ctx.player.maxHp,
        dead: ctx.player.dead,
      },
      score: ctx.state.score,
    };
  }

  /** Generate D1 (or resume the saved expedition) and swap it into ctx. Idempotent. */
  startDescent(ctx: Ctx): void {
    if (this.currentId) {
      // The Builder detaches ctx.world onto a scratch world to protect a
      // running expedition (Builder.open). Resuming play must re-attach the
      // current level — a full enterLevel so enemies and transients restore
      // with it (arrival-at-spawn is the established re-entry semantic).
      const rt = this.current;
      if (rt && ctx.world !== rt.world && rt.def.id !== 'custom') {
        this.enterLevel(ctx, rt.def.id);
      }
      return;
    }
    if (this.tryResumeExpedition(ctx)) return;
    this.expeditionSeed = ctx.state.worldSeed >>> 0;
    this.enterLevel(ctx, START_LEVEL);
  }

  /**
   * Per-frame (play mode): well-fall detection -> level transition, waystone
   * lighting checks, explored-mask stamping, hostile-count events.
   */
  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || this._transitioning || ctx.player.dead) return;
    const runtime = this.current;
    if (!runtime) return;
    const player = ctx.player;

    // WELL FALL: dropping past the world floor means the exit plug is broken
    if (player.y >= HEIGHT - 10) {
      if (runtime.def.nextLevelId) {
        this.leaveLevel();
        this.enterLevel(ctx, runtime.def.nextLevelId);
        return;
      }
      // Bottom of the run (v1): nothing below the Scorched Core
      player.y = HEIGHT - 12;
      player.vy = 0;
      player.fy = 0;
    }

    // EXIT PORTAL: the golden key opens it; touching the open gate descends.
    // Custom levels (Builder playtests) have no next depth — the portal still
    // awakens so authored key->portal flows can be playtested end to end.
    const portal = runtime.portal;
    if (portal) {
      const pdx = player.x - portal.x;
      const pdy = player.y - 6 - portal.y;
      const near = pdx * pdx + pdy * pdy < 100;
      if (near && runtime.keyTaken) {
        if (!portal.open) {
          portal.open = true;
          ctx.audio.portalWhoosh();
          ctx.events.emit('toast', { text: 'THE PORTAL AWAKENS' });
        }
        const next = runtime.def.nextLevelId;
        if (next) {
          // The Sanctum opens between depths: boon draft + shop, then descend.
          ctx.sanctum.open(ctx, () => {
            this.leaveLevel();
            this.enterLevel(ctx, next);
          });
        } else if (ctx.state.frameCount % 240 === 0) {
          ctx.events.emit('toast', { text: 'CUSTOM LEVEL CLEAR — THE PORTAL SHINES' });
        }
        return;
      }
      if (near && !runtime.keyTaken && ctx.state.frameCount % 90 === 0) {
        ctx.events.emit('toast', { text: 'SEALED — THE GOLDEN KEY IS MISSING' });
      }
    }

    // GILDED ARCH: the two-way branch gate. Stepping between the pillars
    // crosses over; the destination's own arch is the way back. Arrival uses
    // the arch's authored back-spot (outside the trigger circle), never the
    // level spawn — "returning to the same depth" must mean the same SPOT.
    const arch = runtime.vaultArch;
    if (arch) {
      const adx = player.x - arch.x;
      const ady = player.y - arch.y;
      if (adx * adx + ady * ady < 49) {
        const destId = runtime.def.branch ? vaultHostId(this.expeditionSeed) : 'vault';
        if (LEVELS[destId]) {
          ctx.audio.portalWhoosh();
          this.leaveLevel();
          this.enterLevel(ctx, destId);
          const dest = this.current;
          if (dest?.vaultArch) {
            player.x = dest.vaultArch.backX;
            player.y = dest.vaultArch.backY;
            player.vx = 0;
            player.vy = 0;
            player.fx = 0;
            player.fy = 0;
            ctx.camera.snapTo(player.x, player.y);
          }
          return;
        }
      }
      // the arch breathes: a slow shimmer of golden motes (in-view only)
      if (ctx.state.frameCount % 9 === 0 && Math.abs(player.x - arch.x) < 300) {
        ctx.particles.spawn(
          arch.x - 5 + Math.random() * 10,
          arch.y - 1 - Math.random() * 5,
          (Math.random() - 0.5) * 0.15,
          -0.2 - Math.random() * 0.25,
          null,
          packRGB(255, 210 + Math.floor(Math.random() * 40), 120),
          26 + Math.floor(Math.random() * 18),
          { glow: 1.0, grav: -0.002 },
        );
      }
    }

    if (ctx.state.frameCount % 4 === 0) this.updateWaystones(ctx, runtime);
    if (ctx.state.frameCount % 8 === 0) this.stampExplored(runtime, player.x, player.y);

    if (ctx.enemies.length !== this.lastEnemiesEmit) {
      this.lastEnemiesEmit = ctx.enemies.length;
      ctx.events.emit('enemiesLeft', { count: ctx.enemies.length });
    }
  }

  /**
   * Build-mode playtest: wrap the CURRENT world into a custom level runtime —
   * no generation, hand-placed enemies kept, no exit (the level IS the game).
   */
  playCurrentWorld(ctx: Ctx): void {
    if (this.expeditionSeed === 0) this.expeditionSeed = ctx.state.worldSeed >>> 0;
    if (this.currentId !== 'custom') this.preCustomCurrentId = this.currentId;
    const def: LevelDef = {
      id: 'custom',
      name: 'CUSTOM LEVEL',
      biome: ctx.state.currentBiome,
      depth: 1,
      nextLevelId: null,
    };
    const spawn = ctx.playerCtl.findSpawnPoint();
    const runtime: LevelRuntime = makeLevelRuntime({
      def,
      world: ctx.world,
      enemies: ctx.enemies.slice(),
      spawn,
      regions: extractRegionGraph(ctx.world, spawn, spawn),
    });
    this.levels.set('custom', runtime);
    this.currentId = 'custom';
    this.waystoneHeat = [];
    this.litOrder.set('custom', []);
    this.lastEnemiesEmit = ctx.enemies.length;
    const player = ctx.player;
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.fx = 0;
    player.fy = 0;
    ctx.camera.snapTo(player.x, player.y);
    if (ctx.state.debugGodMode) {
      grantFullReviewKit(player);
      this.seedRuntimeReviewKit(ctx, runtime);
    }
    ctx.events.emit('levelChanged', { depth: 1, name: def.name });
    ctx.events.emit('objectiveChanged', { text: 'YOUR LEVEL — YOUR RULES' });
  }

  exitCustomPlaytest(ctx: Ctx): void {
    if (this.currentId !== 'custom') {
      this.levels.delete('custom');
      this.preCustomCurrentId = null;
      return;
    }
    this.levels.delete('custom');
    this.currentId =
      this.preCustomCurrentId && this.levels.has(this.preCustomCurrentId)
        ? this.preCustomCurrentId
        : null;
    this.preCustomCurrentId = null;
    this.waystoneHeat = [];
    this.lastEnemiesEmit = ctx.enemies.length;
  }

  /* ---------------- expedition persistence ---------------- */

  /** Lazily-restorable blobs for levels saved but not yet revisited this session. */
  private savedBlobs = new Map<string, SavedLevelBlob>();
  /**
   * Serialized-blob cache for visited levels. A level only mutates while it
   * is CURRENT, so every autosave used to re-RLE all visited worlds for
   * nothing (~120ms hitch by depth 5). Now only the current level pays;
   * enterLevel invalidates the one that is about to start changing.
   */
  private blobCache = new Map<string, SavedLevelBlob>();

  saveExpedition(ctx: Ctx): void {
    if (!this.currentId || this.currentId === 'custom') return;
    if (ctx.state.playtestSource !== null) return;
    if (ctx.state.debugGodMode) return;
    // Sync the live hostile roster into the current runtime before reading it.
    this.leaveLevel();
    const blobs: SavedLevelBlob[] = [];
    for (const [id, rt] of this.levels) {
      if (id === 'custom') continue;
      if (id === this.currentId) {
        blobs.push(this.serializeLevel(id, rt));
        continue;
      }
      let blob = this.blobCache.get(id);
      if (!blob) {
        blob = this.serializeLevel(id, rt);
        this.blobCache.set(id, blob);
      }
      blobs.push(blob);
    }
    // Levels saved earlier but not visited this session keep their old blobs.
    for (const [id, blob] of this.savedBlobs) {
      if (!this.levels.has(id)) blobs.push(blob);
    }
    const save: ExpeditionSave = {
      v: 1,
      genVersion: GEN_VERSION,
      expeditionSeed: this.expeditionSeed,
      currentId: this.currentId,
      score: ctx.state.score,
      player: {
        x: ctx.player.x,
        y: ctx.player.y,
        hp: ctx.player.hp,
        maxHp: ctx.player.maxHp,
        levit: ctx.player.levit,
        maxLevit: ctx.player.maxLevit,
        perks: { ...ctx.player.perks } as Record<string, true>,
      },
      loadout: ctx.wands.snapshotLoadout(),
      levels: blobs,
    };
    try {
      localStorage.setItem(EXPEDITION_KEY, JSON.stringify(save));
    } catch {
      // quota — the expedition just lives and dies with the tab
    }
  }

  hasSavedExpedition(): boolean {
    try {
      return localStorage.getItem(EXPEDITION_KEY) !== null;
    } catch {
      return false;
    }
  }

  abandonExpedition(): void {
    try {
      localStorage.removeItem(EXPEDITION_KEY);
    } catch {
      /* nothing to drop */
    }
    this.savedBlobs.clear();
    this.blobCache.clear();
  }

  debugEnterLevel(ctx: Ctx, id: string): boolean {
    if (!LEVELS[id]) return false;
    if (ctx.state.mode !== 'play') return false;
    if (!this.currentId) this.startDescent(ctx);
    this.leaveLevel();
    this.enterLevel(ctx, id);
    return this.current?.def.id === id;
  }

  private enterPlayMode(ctx: Ctx): void {
    if (ctx.state.mode === 'play') return;
    ctx.state.mode = 'play';
    ctx.events.emit('modeChanged', { mode: 'play' });
  }

  private resetRunState(ctx: Ctx, options: { clearSave: boolean }): void {
    if (options.clearSave) this.abandonExpedition();
    this.levels.clear();
    this.currentId = null;
    this.preCustomCurrentId = null;
    this.savedBlobs.clear();
    this.blobCache.clear();
    this.litOrder.clear();
    this.reviewKitSeeded.clear();
    this.waystoneHeat = [];
    this.lastEnemiesEmit = -1;
    this._transitioning = false;
    this.expeditionSeed = 0;

    Object.assign(ctx.player, createPlayer());
    ctx.state.score = 0;
    ctx.state.playerSpawned = false;
    ctx.state.paused = false;
    ctx.state.debugGodMode = false;
    ctx.events.emit('scoreChanged', { score: ctx.state.score });
    ctx.events.emit('playerDeathCleared');

    ctx.enemies.length = 0;
    ctx.projectiles.length = 0;
    ctx.shockwaves.length = 0;
    ctx.particles.clear();
    ctx.lightning.clear();
    ctx.critters.list.length = 0;
    ctx.input.keys.left = false;
    ctx.input.keys.right = false;
    ctx.input.keys.up = false;
    ctx.input.keys.jump = false;
    ctx.input.keys.wallJump = false;
    ctx.input.keys.down = false;
    ctx.input.keys.grab = false;
    ctx.input.isDrawing = false;
    ctx.input.buildSpellHeld = false;
    ctx.input.bombCharge = -1;
    ctx.input.activeChargingBlackHole = null;
    ctx.input.siphonHeld = false;
    ctx.input.pourHeld = false;
    ctx.input.drinkHeld = false;
    ctx.fx.digBeam = null;
    ctx.fx.hitstop = 0;
    ctx.flask.state.material = null;
    ctx.flask.state.count = 0;
    ctx.waves.num = 1;
    ctx.waves.active = false;
    ctx.waves.intermission = 0;
    ctx.waves.kills = 0;
    ctx.wands.resetLoadout();
  }

  private applyLoadoutPreset(ctx: Ctx, preset: RunLoadoutPreset): void {
    ctx.wands.resetLoadout();
    if (preset === 'fresh') return;
    if (preset === 'advanced') {
      ctx.player.maxHp = 140;
      ctx.player.hp = ctx.player.maxHp;
      ctx.player.maxLevit = 125;
      ctx.player.levit = ctx.player.maxLevit;
      for (const card of ['lightning', 'bomb', 'speed', 'heavy', 'bounce', 'trigger'] as const) {
        ctx.wands.grantCard(ctx, card);
      }
      return;
    }
    ctx.state.debugGodMode = true;
    grantFullReviewKit(ctx.player);
    ctx.wands.grantReviewLoadout();
  }

  private serializeLevel(id: string, rt: LevelRuntime): SavedLevelBlob {
    // Life on transient cells (fire/ember/smoke/steam) is noise a second from
    // now — skipping it keeps multi-level saves well inside localStorage quota.
    const life: Array<[number, number]> = [];
    const types = rt.world.types;
    const lifeArr = rt.world.life;
    for (let i = 0; i < lifeArr.length && life.length < 20000; i++) {
      if (lifeArr[i] === 0) continue;
      const t = types[i];
      if (t === Cell.Fire || t === Cell.Ember || t === Cell.Smoke || t === Cell.Steam) continue;
      life.push([i, lifeArr[i]]);
    }
    return {
      id,
      rle: rleEncode(rt.world.types),
      life,
      charge: sparsePairs(rt.world.charge, 20000),
      explored: bytesToBase64(rt.explored),
      waystones: rt.waystones,
      pickups: rt.pickups,
      mechanisms: rt.mechanisms,
      runeVaults: rt.runeVaults,
      keyTaken: rt.keyTaken,
      portalOpen: rt.portal?.open ?? false,
      litOrder: this.litOrder.get(id) ?? [],
      enemies: rt.enemies.map(snapshotEnemyForSave),
    };
  }

  /** Resume a saved expedition: hero + loadout now, levels lazily on entry. */
  private tryResumeExpedition(ctx: Ctx): boolean {
    let save: ExpeditionSave | null = null;
    try {
      const raw = localStorage.getItem(EXPEDITION_KEY);
      if (raw) save = JSON.parse(raw) as ExpeditionSave;
    } catch {
      save = null;
    }
    if (!save || save.v !== 1 || !LEVELS[save.currentId]) return false;
    // Generation-version guard: a save from another generation would resume
    // against regenerated worlds that no longer match its blobs. Retire it
    // honestly instead of silently desyncing.
    if (save.genVersion !== GEN_VERSION) {
      this.abandonExpedition();
      ctx.events.emit('toast', { text: 'THE DEPTHS HAVE SHIFTED — EXPEDITION RETIRED' });
      return false;
    }
    if (this.isLegacyReviewSave(save)) return false;

    this.expeditionSeed = save.expeditionSeed >>> 0;
    for (const blob of save.levels) this.savedBlobs.set(blob.id, blob);

    ctx.state.score = save.score;
    ctx.events.emit('scoreChanged', { score: ctx.state.score });
    const p = ctx.player;
    p.maxHp = save.player.maxHp;
    p.hp = save.player.hp;
    p.maxLevit = save.player.maxLevit;
    p.levit = save.player.levit;
    p.perks = { ...save.player.perks } as typeof p.perks;
    ctx.wands.loadLoadout(save.loadout);

    this.enterLevel(ctx, save.currentId);
    // enterLevel parks the hero at the spawn; the save knows better.
    p.x = save.player.x;
    p.y = save.player.y;
    ctx.camera.snapTo(p.x, p.y);
    ctx.events.emit('toast', { text: 'EXPEDITION RESUMED' });
    return true;
  }

  private isLegacyReviewSave(save: ExpeditionSave): boolean {
    if (save.player.maxHp < 180 || save.player.maxLevit < 140) return false;
    if (!LEGACY_REVIEW_PERKS.every((perk) => save.player.perks[perk])) return false;
    for (let i = 0; i < LEGACY_REVIEW_WANDS.length; i++) {
      const expected = LEGACY_REVIEW_WANDS[i];
      const actual = save.loadout.wands[i];
      if (!actual || actual.frameId !== expected.frameId) return false;
      for (let s = 0; s < expected.cards.length; s++) {
        if (actual.cards[s] !== expected.cards[s]) return false;
      }
    }
    return save.loadout.collection.length >= 22;
  }

  /**
   * Rebuild a saved level: regenerate the pristine world from its seed (which
   * restores the rim-lit terrain colors exactly), then overlay the saved cell
   * types — only player-changed cells get generic per-material recolors.
   */
  private restoreLevel(ctx: Ctx, def: LevelDef, blob: SavedLevelBlob): LevelRuntime {
    const world = new World();
    ctx.world = world;
    ctx.enemies.length = 0;

    const seed = (this.expeditionSeed ^ this.hashString(def.id)) >>> 0;
    const pristine = ctx.worldgen.generateLevel(ctx, def, seed, {
      hostArch: def.id === vaultHostId(this.expeditionSeed),
    });

    const savedTypes = new Uint8Array(world.types.length);
    rleDecode(blob.rle, savedTypes);
    for (let i = 0; i < savedTypes.length; i++) {
      if (savedTypes[i] !== world.types[i]) {
        world.types[i] = savedTypes[i];
        const fn = COLOR_FN[savedTypes[i]];
        world.colors[i] = fn ? fn() : EMPTY_COLOR;
      }
    }
    world.life.fill(0);
    world.charge.fill(0);
    for (const [i, v] of blob.life) world.life[i] = v;
    for (const [i, v] of blob.charge) world.charge[i] = v;

    for (const se of blob.enemies) {
      ctx.enemies.push(reviveSavedEnemy(se));
    }

    const explored = new Uint8Array(MINIMAP_W * MINIMAP_H);
    base64ToBytes(blob.explored, explored);
    this.litOrder.set(def.id, [...blob.litOrder]);

    const portal = pristine.portal
      ? { x: pristine.portal.x, y: pristine.portal.y, open: blob.portalOpen }
      : null;

    return makeLevelRuntime({
      def,
      world,
      enemies: ctx.enemies.slice(),
      waystones: blob.waystones,
      exit: pristine.exit,
      explored,
      spawn: pristine.spawn,
      regions: extractRegionGraph(ctx.world, pristine.spawn, {
        x: pristine.exit.x,
        y: pristine.exit.sealY - 12,
      }),
      cauldron: pristine.cauldron,
      pickups: blob.pickups,
      portal,
      keyTaken: blob.keyTaken,
      mechanisms: blob.mechanisms,
      runeVaults: blob.runeVaults,
      // Alive-or-dead truth lives in blob.enemies; the arena marker is static.
      boss: pristine.boss,
      // Static authored data regenerates with the pristine world. The blob's
      // enemy roster is the truth — pristine.prefabEnemies is deliberately
      // IGNORED here (those hostiles were already saved, alive or dead).
      placedPrefabs: pristine.placedPrefabs,
      ...(pristine.authoredLights.length > 0
        ? { authoredLights: pristine.authoredLights }
        : {}),
      ...(pristine.emitters.length > 0 ? { emitters: pristine.emitters } : {}),
      ...(pristine.decors.length > 0 ? { decors: pristine.decors } : {}),
      ...(pristine.refuge ? { refuge: pristine.refuge } : {}),
      ...(pristine.vaultArch ? { vaultArch: pristine.vaultArch } : {}),
    });
  }

  /** Respawn anchor: last lit waystone in the current level, else level spawn. */
  respawnPoint(): { x: number; y: number } | null {
    const runtime = this.current;
    if (!runtime) return null;
    const order = this.litOrder.get(runtime.def.id);
    if (order && order.length > 0) {
      const ws = runtime.waystones[order[order.length - 1]];
      return { x: ws.x, y: ws.y - 2 };
    }
    return { x: runtime.spawn.x, y: runtime.spawn.y };
  }

  /* ---------------- transitions ---------------- */

  /** Park the live hostile roster back into the level being left. */
  private leaveLevel(): void {
    const runtime = this.current;
    if (!runtime) return;
    runtime.enemies.length = 0;
    runtime.enemies.push(...this.ctx.enemies);
  }

  /**
   * Swap a level into ctx behind the transition curtain: restore it live if
   * already visited, else generate-and-populate it. Synchronous; the curtain
   * covers the generation hitch and lifts CURTAIN_HOLD_MS later.
   */
  private enterLevel(ctx: Ctx, id: string): void {
    const def = LEVELS[id];
    if (!def) return;
    this._transitioning = true;

    // Curtain down (element owned by the UI layer — null-safe). Reading
    // offsetHeight forces a reflow so the class change is committed before
    // the synchronous generation below blocks the main thread.
    const curtain = document.getElementById('level-curtain');
    if (curtain) {
      curtain.classList.add('visible');
      void curtain.offsetHeight;
    }

    // This level is about to become CURRENT and mutate — its cached blob dies.
    this.blobCache.delete(id);

    let runtime = this.levels.get(id);
    if (runtime) {
      // RESTORE: the world object swaps back in untouched — scars and all
      ctx.world = runtime.world;
      ctx.enemies.length = 0;
      ctx.enemies.push(...runtime.enemies);
    } else {
      const blob = this.savedBlobs.get(id);
      if (blob) {
        // Saved by a previous session: regenerate-and-overlay (see restoreLevel)
        runtime = this.restoreLevel(ctx, def, blob);
        this.savedBlobs.delete(id);
      } else {
        runtime = this.createLevel(ctx, def);
      }
      this.levels.set(id, runtime);
    }

    // Transient combat state never crosses a well
    ctx.projectiles.length = 0;
    ctx.shockwaves.length = 0;
    ctx.particles.clear();
    ctx.lightning.clear();
    ctx.input.activeChargingBlackHole = null;
    ctx.fx.digBeam = null;

    // v1: arrival (descending or re-ascending) always places the player at
    // the destination level's spawn chamber — see file header
    const player = ctx.player;
    player.x = runtime.spawn.x;
    player.y = runtime.spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.fx = 0;
    player.fy = 0;
    player.invuln = 60;
    // Stance is transient: spawn chambers guarantee standing headroom
    player.crawling = false;
    player.crawlT = 0;
    player.wallGrabT = 0;
    ctx.camera.snapTo(player.x, player.y);

    this.currentId = id;
    this.waystoneHeat = new Array<number>(runtime.waystones.length).fill(0);
    this.lastEnemiesEmit = ctx.enemies.length;
    if (ctx.state.debugGodMode) {
      grantFullReviewKit(player);
      this.seedRuntimeReviewKit(ctx, runtime);
    }
    ctx.events.emit('levelChanged', { depth: def.depth, name: def.name });
    ctx.events.emit('enemiesLeft', { count: ctx.enemies.length });
    ctx.events.emit('objectiveChanged', {
      text: runtime.portal
        ? runtime.keyTaken
          ? 'REACH THE PORTAL'
          : 'FIND THE GOLDEN KEY'
        : runtime.boss
          ? 'SLAY THE KILN COLOSSUS'
          : def.branch
            ? 'PLUNDER THE HOARD — THE ARCH LEADS HOME'
            : 'THE DEPTHS END HERE — SURVIVE',
    });

    window.setTimeout(() => {
      curtain?.classList.remove('visible');
      this._transitioning = false;
    }, CURTAIN_HOLD_MS);

    // Crossing a threshold is a natural checkpoint.
    this.saveExpedition(ctx);
  }

  seedReviewKit(ctx: Ctx): void {
    const runtime = this.current;
    if (!runtime) return;
    this.seedRuntimeReviewKit(ctx, runtime);
  }

  private seedRuntimeReviewKit(ctx: Ctx, runtime: LevelRuntime): void {
    const key = runtime.def.id;
    if (this.reviewKitSeeded.has(key)) return;
    this.reviewKitSeeded.add(key);

    const present = new Set(
      runtime.pickups
        .filter((p) => !p.taken && p.kind === 'potion' && p.data.potion)
        .map((p) => p.data.potion!),
    );
    const missing = POTION_KINDS.filter((kind) => !present.has(kind));
    if (missing.length === 0) return;

    const spacing = 10;
    const width = (missing.length - 1) * spacing;
    const baseX = Math.max(18, Math.min(WIDTH - width - 18, runtime.spawn.x + 36));
    const y = Math.max(24, runtime.spawn.y - 30);
    missing.forEach((potion, i) => {
      const p = makePickup('potion', baseX + i * spacing, y, { potion });
      p.vx = (i - (missing.length - 1) / 2) * 0.04;
      p.vy = -0.35;
      runtime.pickups.push(p);
    });

    ctx.events.emit('toast', { text: 'REVIEW POTION BELT STOCKED' });
  }

  /** Generate a fresh level World into ctx and place its hostile population. */
  private createLevel(ctx: Ctx, def: LevelDef): LevelRuntime {
    // Ctx.world is a mutable field by design: every system dereferences ctx
    // each frame, so swapping between frames is safe.
    const world = new World();
    ctx.world = world;
    ctx.enemies.length = 0;

    const seed = (this.expeditionSeed ^ this.hashString(def.id)) >>> 0;
    const {
      exit,
      waystones,
      spawn,
      cauldron,
      pickups,
      portal,
      mechanisms,
      runeVaults,
      boss,
      prefabEnemies,
      placedPrefabs,
      authoredLights,
      emitters,
      decors,
      refuge,
      vaultArch,
      vaultHoard,
    } = ctx.worldgen.generateLevel(ctx, def, seed, {
      hostArch: def.id === vaultHostId(this.expeditionSeed),
    });
    // Placement brain (Wave C): one flood-fill analysis of the fresh cells,
    // anchored at the spawn chamber and the well mouth above the seal plug.
    const regions = extractRegionGraph(ctx.world, spawn, { x: exit.x, y: exit.sealY - 12 });
    const populationReach = wizardMask(makeLevelRuntime({ def, world, spawn, regions }));
    this.placePopulation(ctx, def, spawn, regions, populationReach, new Rng(hashSeed(seed, 'population')));
    // Boss arenas: the Kiln Colossus at the bottom of the run; the Sunken
    // Leviathan in d4's perched cistern (the marker carries the kind).
    if (boss) ctx.enemyCtl.spawn(boss.kind ?? 'colossus', boss.x, boss.y);
    // The Gilded Vault's hoard guards: a pair of elite golems, posted at the
    // chamber flanks (their boosted stats persist through saves — the blob
    // roster records hp/maxHp/dmgK).
    if (vaultHoard) {
      for (const side of [-10, 10]) {
        ctx.enemyCtl.spawn('golem', vaultHoard.x + side, vaultHoard.y);
        const g = ctx.enemies[ctx.enemies.length - 1];
        if (g && g.kind === 'golem') {
          g.maxHp = Math.round(g.maxHp * 2.6);
          g.hp = g.maxHp;
          g.dmgK = (g.dmgK ?? 1) * 1.6;
        }
      }
    }
    // Prefab-authored enemies (sleeping/patrol fixups applied at spawn).
    for (const rec of prefabEnemies) spawnPrefabEnemy(ctx, rec);
    this.litOrder.set(def.id, []);

    const runtime = makeLevelRuntime({
      def,
      world,
      // Detached snapshot array: synced from ctx.enemies on leave, copied
      // back into ctx.enemies on enter (the Enemy objects are shared).
      enemies: ctx.enemies.slice(),
      waystones,
      exit,
      spawn,
      regions,
      cauldron,
      pickups,
      portal,
      mechanisms,
      runeVaults,
      boss,
      placedPrefabs,
      ...(authoredLights.length > 0 ? { authoredLights } : {}),
      ...(emitters.length > 0 ? { emitters } : {}),
      ...(decors.length > 0 ? { decors } : {}),
      ...(refuge ? { refuge } : {}),
      ...(vaultArch ? { vaultArch } : {}),
    });

    // DEV tripwire: a freshly generated level with anything unreachable
    // is a generator regression — shout immediately, not at playtest.
    if (import.meta.env.DEV) {
      const issues = validateFindability(runtime);
      if (issues.length) {
        console.warn(
          `[findability] ${def.id}: ${issues.map((i) => `${i.what}@${i.x},${i.y}`).join(' ')}`,
        );
      }
    }

    return runtime;
  }

  /** Placed populations (finite, readable) — the descent's replacement for endless waves. */
  private placePopulation(
    ctx: Ctx,
    def: LevelDef,
    spawn: { x: number; y: number },
    regions: LevelRuntime['regions'],
    reachable: Uint8Array,
    rng: Rng,
  ): void {
    // Depth sets the headcount; the biome's foes table sets the mix.
    const foes = EXTRAS[def.biome].foes;
    const pop = populationForLevel(def, foes);
    for (const [kind, count] of Object.entries(pop) as Array<[EnemyKind, number]>) {
      const enemyDef = ctx.enemyCtl.defs[kind];
      for (let i = 0; i < count; i++) {
        const spot = this.findPopulationSpot(
          ctx,
          rng,
          spawn,
          regions,
          reachable,
          enemyDef.halfW,
          enemyDef.h,
        );
        if (spot) this.spawnSeededEnemy(ctx, kind, spot.x, spot.y, rng);
      }
    }

    // Wave F nests — life that implies more life.
    // Bat roosts: sleeping clusters hanging from cave ceilings.
    if (foes.bat) {
      const roosts = 1 + rng.int(2);
      for (let r = 0; r < roosts; r++) {
        const roost = this.findRoostSpot(ctx, rng, spawn, regions, reachable);
        if (!roost) continue;
        const brood = 3 + rng.int(2);
        for (let b = 0; b < brood; b++) {
          const bat = this.spawnSeededEnemy(ctx, 'bat', roost.x + (b - 1) * 5, roost.y + 4, rng);
          if (bat && bat.kind === 'bat') {
            bat.sleeping = true;
            bat.y = roost.y + 4; // hang just under the ceiling
            bat.x = roost.x + (b - 1) * 5;
          }
        }
      }
    }
    // Slime egg clutches: glistening on the cave floor, ticking quietly.
    if (foes.slime) {
      const clutches = 1 + rng.int(2);
      const eggsDef = ctx.enemyCtl.defs.eggs;
      for (let c = 0; c < clutches; c++) {
        const spot = this.findPopulationSpot(
          ctx,
          rng,
          spawn,
          regions,
          reachable,
          eggsDef.halfW,
          eggsDef.h,
          { clearances: [180, 100, 0] },
        );
        if (spot) this.spawnSeededEnemy(ctx, 'eggs', spot.x, spot.y, rng);
      }
    }
  }

  private findPopulationSpot(
    ctx: Ctx,
    rng: Rng,
    spawn: { x: number; y: number },
    regions: LevelRuntime['regions'],
    reachable: Uint8Array,
    halfW: number,
    h: number,
    opts: PopulationSpotOptions = {},
  ): { x: number; y: number } | null {
    const world = ctx.world;
    const xMargin = opts.xMargin ?? 40;
    const minX = Math.max(Math.ceil(halfW) + 2, xMargin);
    const maxX = Math.min(WIDTH - Math.ceil(halfW) - 3, WIDTH - xMargin - 1);
    const minY = Math.max(h, opts.minY ?? 60);
    const maxY = Math.min(HEIGHT - 3, opts.maxY ?? HEIGHT - 140);
    if (maxX < minX || maxY < minY) return null;
    const clearances = opts.clearances ?? POPULATION_CLEARANCE_STEPS;
    const attempts = opts.attempts ?? POPULATION_ATTEMPTS_PER_PASS;
    const regionPasses =
      opts.preferMainPath !== false && regions && regions.mainPath.length > 0
        ? [true, false]
        : [false];

    for (const mainPathOnly of regionPasses) {
      for (const clearance of clearances) {
        const clearanceSq = clearance * clearance;
        for (let attempt = 0; attempt < attempts; attempt++) {
          const x = minX + rng.int(maxX - minX + 1);
          const y = minY + rng.int(maxY - minY + 1);
          const dx = x - spawn.x;
          const dy = y - spawn.y;
          if (clearance > 0 && dx * dx + dy * dy < clearanceSq) continue;
          if (!world.inBounds(x, y) || reachable[world.idx(x, y)] === 0) continue;
          if (mainPathOnly && !this.inMainPathRegion(regions, x, y)) continue;
          if (opts.extra && !opts.extra(x, y)) continue;
          if (!ctx.physics.entityFree(x, y, halfW, h)) continue;
          return { x, y };
        }
      }
    }
    return null;
  }

  private findRoostSpot(
    ctx: Ctx,
    rng: Rng,
    spawn: { x: number; y: number },
    regions: LevelRuntime['regions'],
    reachable: Uint8Array,
  ): { x: number; y: number } | null {
    const world = ctx.world;
    const batDef = ctx.enemyCtl.defs.bat;
    const regionPasses = regions && regions.mainPath.length > 0 ? [true, false] : [false];
    for (const mainPathOnly of regionPasses) {
      for (const clearance of [200, 120, 0]) {
        const clearanceSq = clearance * clearance;
        for (let attempt = 0; attempt < ROOST_ATTEMPTS_PER_PASS; attempt++) {
          const x = 40 + rng.int(WIDTH - 80);
          const y = 50 + rng.int(Math.max(1, HEIGHT - 200));
          const footY = y + 4;
          const dx = x - spawn.x;
          const dy = footY - spawn.y;
          if (clearance > 0 && dx * dx + dy * dy < clearanceSq) continue;
          if (!world.inBounds(x, y - 1) || !world.inBounds(x, footY)) continue;
          if (reachable[world.idx(x, footY)] === 0) continue;
          if (mainPathOnly && !this.inMainPathRegion(regions, x, footY)) continue;
          // ceiling: solid above, open air below
          if (world.types[world.idx(x, y - 1)] === Cell.Empty || world.types[world.idx(x, y)] !== Cell.Empty)
            continue;
          if (world.types[world.idx(x, y + 1)] !== Cell.Empty || world.types[world.idx(x, footY)] !== Cell.Empty)
            continue;
          let broodFits = true;
          for (let b = 0; b < 4; b++) {
            const bx = x + (b - 1) * 5;
            if (!world.inBounds(bx, footY) || !ctx.physics.entityFree(bx, footY, batDef.halfW, batDef.h)) {
              broodFits = false;
              break;
            }
          }
          if (!broodFits) continue;
          return { x, y };
        }
      }
    }
    return null;
  }

  private inMainPathRegion(regions: LevelRuntime['regions'], x: number, y: number): boolean {
    if (!regions) return true;
    const rx = Math.floor(x / regions.scale);
    const ry = Math.floor(y / regions.scale);
    if (rx < 0 || ry < 0 || rx >= regions.w || ry >= regions.h) return false;
    const id = regions.labels[rx + ry * regions.w];
    if (id < 0) return false;
    return regions.regions[id]?.onMainPath === true;
  }

  private spawnSeededEnemy(ctx: Ctx, kind: EnemyKind, x: number, y: number, rng: Rng): Enemy | null {
    const before = ctx.enemies.length;
    ctx.enemyCtl.spawn(kind, x, y);
    const enemy = ctx.enemies[before] ?? null;
    if (!enemy) return null;
    enemy.timer = rng.int(80);
    enemy.bobPhase = rng.next() * Math.PI * 2;
    return enemy;
  }

  /* ---------------- waystones ---------------- */

  /**
   * Fire-lit checkpoints: you must BRING fire to the bowl. Runs every 4th
   * frame; sustained Cell.Fire in the bowl rect for WAYSTONE_LIGHT_TICKS hot
   * checks lights the brazier.
   */
  private updateWaystones(ctx: Ctx, runtime: LevelRuntime): void {
    const world = ctx.world;
    for (let i = 0; i < runtime.waystones.length; i++) {
      const ws = runtime.waystones[i];
      if (ws.lit) continue;
      let fire = 0;
      for (let dy = -3; dy <= -1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const X = ws.x + dx,
            Y = ws.y + dy;
          if (world.inBounds(X, Y) && world.types[world.idx(X, Y)] === Cell.Fire) fire++;
        }
      }
      this.waystoneHeat[i] = fire > 0 ? this.waystoneHeat[i] + 1 : 0;
      if (fire > 0 && ctx.state.frameCount % 16 === 0) {
        ctx.particles.spawn(
          ws.x + (Math.random() - 0.5) * 4,
          ws.y - 3,
          (Math.random() - 0.5) * 0.2,
          -0.45 - Math.random() * 0.35,
          null,
          emberColor(),
          24 + Math.floor(Math.random() * 16),
          { glow: 1.8, grav: -0.01 },
        );
      }
      if (this.waystoneHeat[i] >= WAYSTONE_LIGHT_TICKS) this.lightWaystone(ctx, runtime, i);
    }
  }

  private lightWaystone(ctx: Ctx, runtime: LevelRuntime, index: number): void {
    const ws = runtime.waystones[index];
    ws.lit = true;
    const order = this.litOrder.get(runtime.def.id);
    if (order) order.push(index);
    else this.litOrder.set(runtime.def.id, [index]);

    // The ignition is an EVENT: a bronze gong rolls through the caves and a
    // column of embers climbs off the bowl.
    ctx.audio.gong();
    for (let k = 0; k < 18; k++) {
      ctx.particles.spawn(
        ws.x + (Math.random() - 0.5) * 5,
        ws.y - 3 - Math.random() * 3,
        (Math.random() - 0.5) * 0.3,
        -1.0 - Math.random() * 1.6,
        null,
        packRGB(255, 140 + Math.floor(Math.random() * 90), 30),
        50 + Math.floor(Math.random() * 40),
        { glow: 2.2, grav: -0.012 },
      );
    }

    // Checkpoint reward: full vitals
    const player = ctx.player;
    player.hp = player.maxHp;
    player.mana = player.maxMana;
    player.levit = player.maxLevit;

    // Seed the bowl with long-lived embers: a lit brazier visibly glows and
    // keeps lighting itself (and the minimap) after the brought fire dies.
    const world = ctx.world;
    const bowl: Array<[number, number]> = [
      [-2, -1],
      [-1, -1],
      [0, -1],
      [1, -1],
      [2, -1],
      [0, -2],
    ];
    for (const [dx, dy] of bowl) {
      const X = ws.x + dx,
        Y = ws.y + dy;
      if (!world.inBounds(X, Y)) continue;
      const wi = world.idx(X, Y);
      world.types[wi] = Cell.Ember;
      world.colors[wi] = emberColor();
      world.life[wi] = 560 + Math.floor(Math.random() * 90);
    }

    // Celebration: gold motes rising, embers tumbling, a two-tone chime
    ctx.particles.burst(
      ws.x,
      ws.y - 3,
      26,
      null,
      () => packRGB(255, 196 + Math.floor(Math.random() * 40), 64),
      2.6,
      { glow: 2.4, grav: -0.012 },
    );
    ctx.particles.burst(ws.x, ws.y - 3, 14, null, emberColor, 1.7, { glow: 2.2, grav: 0.02 });
    ctx.audio.tone(660, 660, 0.22, 'sine', 0.18);
    setTimeout(() => ctx.audio.tone(990, 990, 0.3, 'sine', 0.16), 130);

    ctx.events.emit('waystoneLit');
  }

  /* ---------------- cartography ---------------- */

  /** Stamp a radius-6 disc around the player into the level's 1:8 fog-of-war mask. */
  private stampExplored(runtime: LevelRuntime, px: number, py: number): void {
    const cx = Math.floor(px / 8),
      cy = Math.floor(py / 8);
    for (let dy = -6; dy <= 6; dy++) {
      const Y = cy + dy;
      if (Y < 0 || Y >= MINIMAP_H) continue;
      for (let dx = -6; dx <= 6; dx++) {
        const X = cx + dx;
        if (X < 0 || X >= MINIMAP_W) continue;
        if (dx * dx + dy * dy <= 36) runtime.explored[X + Y * MINIMAP_W] = 1;
      }
    }
  }

  /** Tiny FNV-1a over the level id — folds it into the expedition seed. */
  private hashString(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
}

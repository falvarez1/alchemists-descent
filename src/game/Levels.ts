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
import { GEN_TUNE_DEFAULT_SIGNATURE, GEN_VERSION, genTuneSignature } from '@/config/gen';
import { difficultyMods } from '@/config/difficulty';
import { LEVELS, START_LEVEL, populationForLevel, vaultHostId } from '@/config/worldgraph';
import { Rng, hashSeed, randomSeed, fnv1aString } from '@/core/rng';
import { base64ToBytes, bytesToBase64, rleDecodeExact, rleEncode } from '@/core/rle';
import type {
  Ctx,
  Difficulty,
  Enemy,
  EnemyKind,
  GeneratedScenePlacement,
  AuthoredLight,
  ExitPortal,
  LevelDef,
  LevelRuntime,
  LevelsApi,
  Mechanism,
  Pickup,
  PickupKind,
  PrefabEnemy,
  CardId,
  RunLoadoutPreset,
  RunStartConfig,
  RunStartResult,
  RunStatus,
  RunTestKitConfig,
  RuneVault,
  FlaskBottleState,
  WandLoadoutSave,
  WandRuntimeSnapshot,
  WeaverLairWeb,
  Waystone,
} from '@/core/types';
import { createPlayer, grantFullReviewKit } from '@/entities/Player';
import { createDefaultStatus } from '@/entities/status';
import { spawnPrefabEnemy, toAuthoredLight } from '@/game/instantiate';
import { makePickup, POTION_KINDS } from '@/core/pickupDefs';
import { makeLevelRuntime } from '@/game/runtime';
import { resetCombatTransients } from '@/game/transients';
import { failOpenFindability, wizardMask } from '@/world/validate';
import { blocksEntity, Cell } from '@/sim/CellType';
import { COLOR_FN, emberColor, EMPTY_COLOR, packRGB } from '@/sim/colors';
import { World } from '@/sim/World';
import { EXTRAS } from '@/world/biomeExtras';
import { extractRegionGraph } from '@/world/regions';
import { buildPhysicsArena } from '@/world/physicsArena';
import { buildWeaverArena } from '@/world/weaverArena';
import {
  createDefaultVirtualWorldDef,
  cropMaterializedWindow,
  generateVirtualWindow,
  materializeChunks,
  type MaterializedScenePlacement,
  type VirtualSceneLight,
  type VirtualSceneObject,
  type VirtualWorldDef,
} from '@/world/virtual';

/** Frames the transition curtain stays down after the (synchronous) swap. */
const CURTAIN_HOLD_MS = 450;
/** Run after loose materials have begun settling, before the findability audit's 350 ms read. */
const SETTLED_FINDABILITY_REPAIR_MS = 300;
/** Authored test arenas REBUILD their terrain after generation (buildWeaverArena /
 *  buildPhysicsArena wipe the world and stamp a hand-designed layout). They must
 *  skip the procedural findability repair, which would otherwise "rescue" the now-
 *  wiped campaign features by carving Metal-sleeved tunnels straight through the
 *  authored level. They own their own reachability. */
const AUTHORED_TEST_ARENAS = new Set(['weaver-test', 'physics-test']);
/** Waystone bowl fire checks run every 4th frame; this many hot checks light it. */
const WAYSTONE_LIGHT_TICKS = 30;
/** Fire spells the waystone proximity prompt can offer to equip, best-first. */
const WAYSTONE_FIRE_CARDS: readonly CardId[] = ['flame', 'emberstorm', 'meteor'];
/** Cells: walking this close to an unlit waystone raises the help prompt once. */
const WAYSTONE_PROMPT_RADIUS = 26;
/** D1 starter water: enough for a first experiment, below a full flask. */
const FRESH_STARTER_WATER_CELLS = 300;
/** Minimum placement distance (cells) between a placed enemy and the level spawn. */
const POPULATION_SPAWN_CLEARANCE = 220;
const POPULATION_CLEARANCE_STEPS = [POPULATION_SPAWN_CLEARANCE, 150, 80, 0] as const;
const POPULATION_ATTEMPTS_PER_PASS = 36;
const ROOST_ATTEMPTS_PER_PASS = 160;
const VIRTUAL_PICKUP_KINDS = new Set<PickupKind>(['goldpile', 'heart', 'tome', 'chest', 'potion', 'key']);

interface TransitionCurtainCopy {
  title?: string;
  detail?: string;
}

function clearFrameStops(ctx: Ctx): void {
  const fx = (ctx as { fx?: Ctx['fx'] }).fx;
  if (!fx) return;
  fx.hitstop = 0;
  fx.deathSlowMo = 0;
}

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
  {
    frameId: 'brass',
    cards: ['spark', 'double', 'speed', 'flame', 'lightning'],
  },
  {
    frameId: 'void',
    cards: ['dig', 'conjure', 'vitriol', 'blackhole', 'warp'],
  },
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
  /** Sparse packed RGB cells whose type is unchanged but whose color is scarred. */
  colorOverrides?: Array<[number, number]>;
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
  weaverLairWebs?: WeaverLairWeb[];
}

interface ExpeditionSave {
  v: 1;
  /** GEN_VERSION at save time; resume retires saves from other generations
   *  (restoreLevel regenerates pristine worlds from seed — a stale save
   *  against new generation silently desyncs). Absent = pre-guard save. */
  genVersion?: number;
  /** Signature of live GEN_TUNE at save time. Absent = pre-tuning-guard save. */
  genTuneSignature?: string;
  expeditionSeed: number;
  /** Run difficulty 1–4; resume restores it so a continued run keeps its balance.
   *  Absent in saves from before difficulty levels — those resume at 3 (shipped). */
  difficulty?: Difficulty;
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
  /** Full wand runtime, including grant guards/cooldowns. Absent in v1 legacy saves. */
  wands?: WandRuntimeSnapshot;
  /** Material flask belt inventory. Absent in v1 legacy saves. */
  flasks?: FlaskInventorySave;
  levels: SavedLevelBlob[];
}

interface FlaskInventorySave {
  activeIndex: number;
  slots: Array<{ material: number | null; count: number; capacity?: number }>;
  bottle?: FlaskBottleState;
}

function snapshotPickupForSave(pickup: Pickup): Pickup {
  const data = { ...pickup.data };
  if (pickup.kind === 'tome') data.offerPending = false;
  return { ...pickup, data };
}

function sparseNonZeroPairs(arr: Int16Array | Uint8Array | Uint16Array): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== 0) out.push([i, arr[i]]);
  }
  return out;
}

function sanitizeWeaverLairWebs(value: readonly WeaverLairWeb[] | undefined): WeaverLairWeb[] {
  if (!value) return [];
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const out: WeaverLairWeb[] = [];
  for (const web of value) {
    if (
      !web ||
      !finite(web.x) ||
      !finite(web.y) ||
      !finite(web.radius) ||
      !finite(web.radials) ||
      !finite(web.rings) ||
      !finite(web.thickness) ||
      !finite(web.color) ||
      !finite(web.jitter)
    ) {
      continue;
    }
    out.push({ ...web, color: web.color >>> 0 });
  }
  return out;
}

/**
 * Project a runtime mechanism into a save-safe snapshot: drop the live/transient
 * fields the Mechanism type marks as not-persisted. The critical one is
 * `dispBodies`, which holds LIVE RigidBody references — JSON.stringify would
 * strip their functions and persist a detached snapshot, so on restore a
 * dispenser would come back with phantom bodies that throttle real emissions.
 * The in-progress retraction queue (`dissolve`) and the various recomputed
 * counters are likewise transient. All true gameplay state — `state`, `broken`,
 * `body`, `seqDone`/`seqFired`, valve `material`/`oneShot`, etc. — is preserved.
 */
function sanitizeMechanismForSave(m: Mechanism): Mechanism {
  const copy: Mechanism = { ...m };
  delete copy.dispBodies;
  delete copy.dissolve;
  delete copy.seqPrev;
  delete copy.pressed;
  delete copy.pullT;
  delete copy.seq;
  delete copy.reading;
  delete copy.closePending;
  delete copy.closeT;
  delete copy.prevWant;
  delete copy.fuseT;
  delete copy.dispCoolT;
  return copy;
}

function nonNegativeInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function finiteNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return value;
}

/**
 * Per-level-blob shape guard. The top-level save validator must reject a save
 * whose `levels` array carries a structurally-broken blob (missing rle, a
 * non-array life/charge/enemies list) at LOAD time, where retire-the-save
 * recovery exists — rather than letting it detonate later inside restoreLevel
 * mid-transition. Only the fields restoreLevel actually dereferences are
 * checked, so older valid saves keep passing.
 */
function isSavedLevelBlobShape(value: unknown): value is SavedLevelBlob {
  if (!value || typeof value !== 'object') return false;
  const b = value as Partial<SavedLevelBlob>;
  return (
    typeof b.id === 'string' &&
    typeof b.rle === 'string' &&
    typeof b.explored === 'string' &&
    Array.isArray(b.life) &&
    Array.isArray(b.charge) &&
    Array.isArray(b.enemies) &&
    Array.isArray(b.pickups) &&
    Array.isArray(b.mechanisms) &&
    Array.isArray(b.waystones) &&
    Array.isArray(b.runeVaults) &&
    Array.isArray(b.litOrder) &&
    (b.colorOverrides === undefined || Array.isArray(b.colorOverrides)) &&
    (b.weaverLairWebs === undefined || Array.isArray(b.weaverLairWebs))
  );
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
  // A corrupt/hand-edited save must not inject NaN/Infinity into positions or
  // health (it would poison physics, camera and every distance check). Guard
  // x/y/hp/maxHp the way the lesser fields below already are.
  const maxHp = Math.max(1, finiteNumber(se.maxHp, 1));
  const enemy: Enemy = {
    kind: se.kind,
    x: finiteNumber(se.x, 0),
    y: finiteNumber(se.y, 0),
    fx: 0,
    fy: 0,
    vx: 0,
    vy: 0,
    hp: Math.max(0, Math.min(maxHp, finiteNumber(se.hp, maxHp))),
    maxHp,
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
  private expeditionSeed: number | null = null;

  /** Per-waystone accumulated hot ticks for the CURRENT level (reset on enter). */
  private waystoneHeat: number[] = [];
  /** Waystone indices per level id, in the order they were lit (last = respawn anchor). */
  private litOrder = new Map<string, number[]>();
  /** Re-armed whenever the player is outside every unlit waystone's prompt radius. */
  private waystonePromptArmed = true;
  /** A waystone help prompt is open (paused) — suppresses re-triggering. */
  private waystonePromptOpen = false;
  /** Last hostile count emitted via enemiesLeft. */
  private lastEnemiesEmit = -1;
  /** Levels already topped up with the review potion belt this session. */
  private reviewKitSeeded = new Set<string>();
  /** Resume restores the hero position after enterLevel; suppress that transient checkpoint. */
  private checkpointSaveSuppression = 0;
  /** Guards delayed settled-findability repair against stale level transitions. */
  private findabilityRepairToken = 0;

  constructor(private ctx: Ctx) {}

  private showTransitionCurtain(ctx: Ctx, copy: TransitionCurtainCopy = {}): void {
    ctx.events.emit('levelCurtain', {
      visible: true,
      title: copy.title ?? 'Opening the descent',
      detail: copy.detail ?? 'Drawing the cave mouth open.',
    });
  }

  private finishTransitionWithCurtain(ctx: Ctx): void {
    const complete = (): void => {
      this._transitioning = false;
    };
    const handled = ctx.events.emit('levelCurtain', {
      visible: false,
      holdMs: CURTAIN_HOLD_MS,
      onComplete: complete,
    });
    if (!handled) complete();
  }

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
      if (mode !== 'test') {
        return {
          ok: false,
          message:
            'Chunked virtual worlds are playable as disposable test runs only until streaming persistence lands.',
          mode,
          worldSource,
          levelId: null,
          seed: ctx.state.worldSeed >>> 0,
          reason: 'virtual-runtime-unavailable',
        };
      }
      this.enterPlayMode(ctx);
      const seed = config.seed !== undefined && Number.isFinite(config.seed) ? config.seed >>> 0 : randomSeed();
      this.resetRunState(ctx, { clearSave: false });
      ctx.state.worldSeed = seed;
      this.expeditionSeed = seed;
      ctx.state.playtestSource = 'test';
      this.applyLoadoutPreset(ctx, config.loadout ?? 'advanced');
      if (config.kit) this.applyTestKit(ctx, config.kit);
      this.showTransitionCurtain(ctx, {
        title: 'Opening the descent',
        detail: 'Materializing a disposable test cavern.',
      });
      const runtime = this.createVirtualTestRuntime(ctx, seed);
      this.enterAdHocRuntime(ctx, runtime, 'EXPLORE THE CHUNKED WORLD PROTOTYPE');
      ctx.events.emit('toast', { text: 'TEST RUN: CHUNKED VIRTUAL WORLD' });
      return {
        ok: true,
        message: 'Test run started in the chunked virtual world prototype.',
        mode,
        worldSource,
        levelId: runtime.def.id,
        seed,
      };
    }

    const levelId = worldSource === 'campaign' ? START_LEVEL : (config.levelId ?? START_LEVEL).toLowerCase();
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
      if (ctx.state.playtestSource !== null || ctx.state.debugGodMode) {
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
        seed: this.activeExpeditionSeed(ctx),
      };
    }

    const seed = config.seed !== undefined && Number.isFinite(config.seed) ? config.seed >>> 0 : randomSeed();
    this.resetRunState(ctx, { clearSave: mode === 'normal' });
    ctx.state.worldSeed = seed;
    this.expeditionSeed = seed;
    ctx.state.playtestSource = mode === 'test' ? 'test' : null;

    if (config.difficulty !== undefined) ctx.state.difficulty = config.difficulty;

    const preset = config.loadout ?? 'fresh';
    if (
      mode === 'normal' &&
      (worldSource !== 'campaign' || levelId !== START_LEVEL || preset !== 'fresh' || config.kit)
    ) {
      ctx.state.debugGodMode = true;
    }
    this.applyLoadoutPreset(ctx, preset);
    // Difficulty cushion: scale the loadout's max HP, then top off (the kit can
    // still override below). Level 3 = ×1.0, so the shipped game is untouched.
    const hpScale = difficultyMods(ctx.state).playerHp;
    if (hpScale !== 1) {
      ctx.player.maxHp = Math.round(ctx.player.maxHp * hpScale);
      ctx.player.hp = ctx.player.maxHp;
    }
    if (config.kit) this.applyTestKit(ctx, config.kit);
    this.enterLevel(ctx, levelId);

    const runtime = this.current;
    const label = runtime?.def.name ?? levelId.toUpperCase();
    const prefix = mode === 'test' ? 'Test run' : 'Fresh expedition';
    const diff = difficultyMods(ctx.state);
    ctx.events.emit('toast', {
      text: `${prefix.toUpperCase()}: ${label} — ${diff.roman} ${diff.name.toUpperCase()}`,
    });
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
    const debugActive = ctx.debug?.active === true;
    const debugTainted = ctx.state.debugGodMode || debugActive;
    const autosaveBlockReason: RunStatus['autosaveBlockReason'] =
      ctx.state.mode !== 'play'
        ? 'not-play'
        : ctx.state.playtestSource !== null
          ? 'playtest'
          : debugTainted
            ? 'debug-tainted'
            : ctx.player.dead
              ? 'dead'
              : null;
    return {
      mode: ctx.state.mode,
      playtestSource: ctx.state.playtestSource,
      savedExpedition: this.hasSavedExpedition(),
      autosaveEnabled: autosaveBlockReason === null,
      autosaveBlockReason,
      debugGodMode: ctx.state.debugGodMode,
      debugActive,
      debugTainted,
      expeditionSeed: this.expeditionSeed,
      worldSeed: (this.expeditionSeed ?? ctx.state.worldSeed) >>> 0,
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
      if (!LEVELS[this.currentId]) {
        this.exitDisposableRuntime(ctx);
      } else if (rt && ctx.world !== rt.world && rt.def.id !== 'custom') {
        this.enterLevel(ctx, rt.def.id);
        return;
      } else {
        return;
      }
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
          ctx.events.emit('toast', {
            text: 'CUSTOM LEVEL CLEAR — THE PORTAL SHINES',
          });
        }
        return;
      }
      if (near && !runtime.keyTaken && ctx.state.frameCount % 90 === 0) {
        ctx.events.emit('toast', {
          text: 'SEALED — THE GOLDEN KEY IS MISSING',
        });
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
        const destId = runtime.def.branch ? vaultHostId(this.activeExpeditionSeed(ctx)) : 'vault';
        if (LEVELS[destId]) {
          ctx.audio.portalWhoosh();
          this.leaveLevel();
          this.checkpointSaveSuppression++;
          try {
            this.enterLevel(ctx, destId);
          } finally {
            this.checkpointSaveSuppression--;
          }
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
          this.saveExpedition(ctx);
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

    if (ctx.state.frameCount % 4 === 0) {
      this.updateWaystones(ctx, runtime);
      this.maybeWaystonePrompt(ctx, runtime);
    }
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
    this._transitioning = true;
    this.showTransitionCurtain(ctx, {
      title: 'Opening playtest',
      detail: 'Seating the authored world.',
    });
    if (this.expeditionSeed === null) this.expeditionSeed = ctx.state.worldSeed >>> 0;
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
    ctx.playerCtl?.resetTransientState?.(ctx);
    clearFrameStops(ctx);
    ctx.camera.snapTo(player.x, player.y);
    if (ctx.state.debugGodMode) {
      grantFullReviewKit(player);
      this.seedRuntimeReviewKit(ctx, runtime);
    }
    ctx.events.emit('levelChanged', { depth: 1, name: def.name });
    ctx.events.emit('objectiveChanged', { text: 'YOUR LEVEL — YOUR RULES' });
    this.finishTransitionWithCurtain(ctx);
  }

  playVirtualWindow(ctx: Ctx, def: VirtualWorldDef, center: { x: number; y: number }, previewRadius: number): void {
    this.enterPlayMode(ctx);
    this.resetRunState(ctx, { clearSave: false });
    ctx.state.worldSeed = def.seed >>> 0;
    this.expeditionSeed = ctx.state.worldSeed;
    ctx.state.playtestSource = 'test';
    this.applyLoadoutPreset(ctx, 'advanced');
    this.showTransitionCurtain(ctx, {
      title: 'Opening playtest',
      detail: 'Materializing the tuned virtual window.',
    });
    const runtime = this.createVirtualWindowRuntime(ctx, def, center, previewRadius);
    this.enterAdHocRuntime(ctx, runtime, 'EXPLORE THE TUNED CHUNKED WORLD');
    ctx.events.emit('toast', { text: 'TEST RUN: BUILDER VIRTUAL WORLD' });
  }

  exitCustomPlaytest(ctx: Ctx): void {
    ctx.state.playtestSource = null;
    if (this.currentId !== 'custom') {
      this.levels.delete('custom');
      this.preCustomCurrentId = null;
      resetCombatTransients(ctx);
      return;
    }
    this.levels.delete('custom');
    this.currentId =
      this.preCustomCurrentId && this.levels.has(this.preCustomCurrentId) ? this.preCustomCurrentId : null;
    this.preCustomCurrentId = null;
    ctx.enemies.length = 0;
    resetCombatTransients(ctx);
    this.waystoneHeat = [];
    this.lastEnemiesEmit = 0;
  }

  exitDisposableRuntime(ctx: Ctx): void {
    const id = this.currentId;
    if (!id || LEVELS[id]) return;
    this.levels.delete(id);
    this.currentId = null;
    this.preCustomCurrentId = null;
    ctx.state.playtestSource = null;
    ctx.enemies.length = 0;
    resetCombatTransients(ctx);
    this.waystoneHeat = [];
    this.lastEnemiesEmit = 0;
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
    if (ctx.player.dead) return;
    if (ctx.debug?.active === true) return;
    this.writeExpeditionSave(ctx, this.snapshotPlayerForSave(ctx));
  }

  saveDeathCheckpoint(ctx: Ctx): void {
    const respawn = this.respawnPoint();
    if (!respawn) return;
    this.writeExpeditionSave(
      ctx,
      this.snapshotPlayerForSave(ctx, {
        x: respawn.x,
        y: respawn.y,
        hp: ctx.player.maxHp,
        levit: ctx.player.maxLevit,
      }),
    );
  }

  private snapshotPlayerForSave(ctx: Ctx, override: Partial<ExpeditionSave['player']> = {}): ExpeditionSave['player'] {
    return {
      x: ctx.player.x,
      y: ctx.player.y,
      hp: ctx.player.hp,
      maxHp: ctx.player.maxHp,
      levit: ctx.player.levit,
      maxLevit: ctx.player.maxLevit,
      perks: { ...ctx.player.perks } as Record<string, true>,
      ...override,
    };
  }

  private writeExpeditionSave(ctx: Ctx, playerSave: ExpeditionSave['player']): void {
    if (!this.currentId || this.currentId === 'custom') return;
    if (!LEVELS[this.currentId]) return;
    if (ctx.state.playtestSource !== null) return;
    if (ctx.state.debugGodMode) return;
    if (ctx.debug?.active === true) return;
    const currentId = this.currentId;
    // Sync the live hostile roster into the current runtime before reading it.
    this.leaveLevel();
    const blobs: SavedLevelBlob[] = [];
    for (const [id, rt] of this.levels) {
      if (id === 'custom') continue;
      if (id === currentId) {
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
    const expeditionSeed = this.activeExpeditionSeed(ctx);
    const save: ExpeditionSave = {
      v: 1,
      genVersion: GEN_VERSION,
      genTuneSignature: genTuneSignature(),
      expeditionSeed,
      difficulty: ctx.state.difficulty,
      currentId,
      score: ctx.state.score,
      player: playerSave,
      loadout: ctx.wands.snapshotLoadout(),
      wands: ctx.wands.snapshotRuntimeState(),
      flasks: this.snapshotFlasks(ctx),
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

  private snapshotFlasks(ctx: Ctx): FlaskInventorySave {
    const slots = ctx.flask.slots.map((slot) => this.sanitizeFlaskSaveSlot(slot));
    const bottle = this.sanitizeFlaskBottle(ctx.flask.bottleView());
    return {
      activeIndex: ctx.flask.activeIndex,
      slots,
      ...(bottle ? { bottle } : {}),
    };
  }

  private restoreFlasks(ctx: Ctx, save: FlaskInventorySave | undefined): void {
    ctx.flask.clearSlots();
    if (!save || !Array.isArray(save.slots)) return;
    save.slots.forEach((slot, index) => {
      if (!slot) return;
      const sanitized = this.sanitizeFlaskSaveSlot(slot);
      ctx.flask.setSlot(index, sanitized.material, sanitized.count);
    });
    if (!ctx.flask.selectSlot(save.activeIndex)) ctx.flask.selectSlot(0);
    ctx.flask.restoreBottle(this.sanitizeFlaskBottle(save.bottle ?? null));
  }

  private sanitizeFlaskSaveSlot(slot: unknown): {
    material: number | null;
    count: number;
    capacity?: number;
  } {
    if (!slot || typeof slot !== 'object') return { material: null, count: 0, capacity: 600 };
    const source = slot as {
      material?: unknown;
      count?: unknown;
      capacity?: unknown;
    };
    const rawCapacity = Number(source.capacity ?? 600);
    const capacity = Number.isFinite(rawCapacity) ? Math.max(0, Math.floor(rawCapacity)) : 600;
    if (!this.validFlaskMaterial(source.material)) return { material: null, count: 0, capacity };
    const rawCount = Number(source.count);
    const count = Number.isFinite(rawCount) ? Math.min(capacity, Math.max(0, Math.floor(rawCount))) : 0;
    return count > 0 ? { material: source.material, count, capacity } : { material: null, count: 0, capacity };
  }

  private sanitizeFlaskBottle(bottle: unknown): FlaskBottleState | null {
    if (!bottle || typeof bottle !== 'object') return null;
    const source = bottle as {
      x?: unknown;
      y?: unknown;
      vx?: unknown;
      vy?: unknown;
      material?: unknown;
      count?: unknown;
    };
    if (!this.validFlaskMaterial(source.material)) return null;
    const count = Math.max(0, Math.min(600, Math.floor(Number(source.count))));
    if (!Number.isFinite(count) || count <= 0) return null;
    const x = Number(source.x);
    const y = Number(source.y);
    const vx = Number(source.vx);
    const vy = Number(source.vy);
    if (![x, y, vx, vy].every(Number.isFinite)) return null;
    return { x, y, vx, vy, material: source.material, count };
  }

  private validFlaskMaterial(material: unknown): material is number {
    return Number.isInteger(material) && COLOR_FN[material as number] !== undefined;
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

  private activeExpeditionSeed(ctx: Ctx): number {
    if (this.expeditionSeed === null) this.expeditionSeed = ctx.state.worldSeed >>> 0;
    return this.expeditionSeed >>> 0;
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
    this.expeditionSeed = null;

    Object.assign(ctx.player, createPlayer());
    ctx.playerCtl?.resetTransientState?.(ctx);
    ctx.state.score = 0;
    ctx.state.playerSpawned = false;
    ctx.state.paused = false;
    ctx.state.debugGodMode = false;
    ctx.events.emit('scoreChanged', { score: ctx.state.score });
    ctx.events.emit('playerDeathCleared');

    ctx.enemies.length = 0;
    resetCombatTransients(ctx);
    ctx.critters.clear();
    ctx.input.keys.left = false;
    ctx.input.keys.right = false;
    ctx.input.keys.up = false;
    ctx.input.keys.jump = false;
    ctx.input.keys.wallJump = false;
    ctx.input.keys.down = false;
    ctx.input.keys.grab = false;
    ctx.input.isDrawing = false;
    clearFrameStops(ctx);
    ctx.flask.clearSlots();
    ctx.waves.num = 1;
    ctx.waves.active = false;
    ctx.waves.intermission = 0;
    ctx.waves.kills = 0;
    ctx.wands.resetLoadout();
  }

  private applyLoadoutPreset(ctx: Ctx, preset: RunLoadoutPreset): void {
    ctx.wands.resetLoadout();
    if (preset === 'fresh') {
      ctx.flask.setSlot(0, Cell.Water, FRESH_STARTER_WATER_CELLS);
      ctx.flask.selectSlot(0);
      return;
    }
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

  private applyTestKit(ctx: Ctx, kit: RunTestKitConfig): void {
    if (kit.gold !== undefined) {
      ctx.state.score = Math.max(0, Math.floor(kit.gold));
      ctx.events.emit('scoreChanged', { score: ctx.state.score });
    }
    if (kit.maxHp !== undefined) {
      ctx.player.maxHp = Math.max(1, Math.floor(kit.maxHp));
      ctx.player.hp = Math.min(ctx.player.maxHp, Math.max(1, Math.floor(kit.hp ?? ctx.player.maxHp)));
    } else if (kit.hp !== undefined) {
      ctx.player.hp = Math.min(ctx.player.maxHp, Math.max(1, Math.floor(kit.hp)));
    }
    if (kit.maxLevit !== undefined) {
      ctx.player.maxLevit = Math.max(1, Math.floor(kit.maxLevit));
      ctx.player.levit = ctx.player.maxLevit;
    }
    if (kit.perks) {
      for (const perk of kit.perks) ctx.player.perks[perk] = true;
    }
    if (kit.cards) {
      for (const card of kit.cards) {
        if (!this.hasCard(ctx, card)) ctx.wands.grantCard(ctx, card);
      }
    }
    if (kit.flasks) {
      ctx.flask.clearSlots();
      kit.flasks.forEach((flask, index) => {
        if (!flask) return;
        ctx.flask.setSlot(index, flask.material, flask.count);
      });
      const firstFilled = kit.flasks.findIndex((flask) => flask && flask.material !== null && flask.count > 0);
      this.selectFlaskIndex(ctx, kit.activeFlaskIndex, firstFilled >= 0 ? firstFilled : 0);
    } else if (kit.flask) {
      ctx.flask.clearSlots();
      const target = this.validFlaskIndex(ctx, kit.activeFlaskIndex) ? kit.activeFlaskIndex : 0;
      ctx.flask.setSlot(target, kit.flask.material, kit.flask.count);
      ctx.flask.selectSlot(target);
    } else if (kit.activeFlaskIndex !== undefined) {
      this.selectFlaskIndex(ctx, kit.activeFlaskIndex, ctx.flask.activeIndex);
    }
  }

  private selectFlaskIndex(ctx: Ctx, preferred: number | undefined, fallback: number): void {
    const index = preferred !== undefined && Number.isInteger(preferred) ? preferred : fallback;
    if (!ctx.flask.selectSlot(index)) ctx.flask.selectSlot(0);
  }

  private validFlaskIndex(ctx: Ctx, index: number | undefined): index is number {
    return index !== undefined && Number.isInteger(index) && index >= 0 && index < ctx.flask.slots.length;
  }

  private hasCard(ctx: Ctx, card: CardId): boolean {
    if (ctx.wands.collection.includes(card)) return true;
    return ctx.wands.wands.some((wand) => wand.cards.includes(card));
  }

  private createVirtualTestRuntime(ctx: Ctx, seed: number): LevelRuntime {
    const def = createDefaultVirtualWorldDef(seed);
    const chunks = generateVirtualWindow(def, -3, -1, 3, 4);
    return this.createVirtualRuntimeFromChunks(
      ctx,
      def,
      chunks,
      {
        x: def.chunkSize / 2,
        y: def.chunkSize * 1.5,
      },
      'virtual-test',
      'CHUNKED VIRTUAL WORLD',
    );
  }

  private createVirtualWindowRuntime(
    ctx: Ctx,
    def: VirtualWorldDef,
    center: { x: number; y: number },
    previewRadius: number,
  ): LevelRuntime {
    const centerCx = Math.floor(center.x / def.chunkSize);
    const centerCy = Math.floor(center.y / def.chunkSize);
    const radiusX = Math.max(Math.floor(previewRadius), Math.ceil((WIDTH / def.chunkSize - 1) / 2));
    const radiusY = Math.max(Math.floor(previewRadius), Math.ceil((HEIGHT / def.chunkSize - 1) / 2));
    const chunks = generateVirtualWindow(
      def,
      centerCx - radiusX,
      centerCy - radiusY,
      centerCx + radiusX,
      centerCy + radiusY,
    );
    return this.createVirtualRuntimeFromChunks(
      ctx,
      def,
      chunks,
      center,
      'virtual-builder-test',
      'BUILDER VIRTUAL WORLD',
    );
  }

  private createVirtualRuntimeFromChunks(
    ctx: Ctx,
    def: VirtualWorldDef,
    chunks: ReturnType<typeof generateVirtualWindow>,
    center: { x: number; y: number },
    id: string,
    name: string,
  ): LevelRuntime {
    const materialized = materializeChunks(chunks);
    const maxSrcX = Math.max(0, materialized.world.width - WIDTH);
    const maxSrcY = Math.max(0, materialized.world.height - HEIGHT);
    const wantedSrcX = Math.floor(center.x - materialized.originX - WIDTH / 2);
    const wantedSrcY = Math.floor(center.y - materialized.originY - HEIGHT / 2);
    const crop = cropMaterializedWindow(
      materialized,
      Math.max(0, Math.min(maxSrcX, wantedSrcX)),
      Math.max(0, Math.min(maxSrcY, wantedSrcY)),
      WIDTH,
      HEIGHT,
    );
    const { world, srcX, srcY } = crop;
    ctx.world = world;
    ctx.worldgen.spawnHint = null;
    const spawn = this.findVirtualSpawn(world);
    this.carveVirtualSpawn(world, spawn.x, spawn.y);
    ctx.worldgen.spawnHint = spawn;
    this.warnVirtualMaterializationDrops(ctx, crop.stats);
    const sceneRuntime = this.virtualSceneRuntime(ctx, crop.sceneObjects, crop.sceneLights, 0, 0, world);
    const generatedScenes = this.virtualGeneratedScenes(crop.scenePlacements, world);
    ctx.enemies.length = 0;
    for (const rec of sceneRuntime.enemies) spawnPrefabEnemy(ctx, rec);
    const runtimeDef: LevelDef = {
      id,
      name,
      biome: 'earthen',
      depth: 0,
      nextLevelId: null,
    };
    return makeLevelRuntime({
      def: runtimeDef,
      world,
      enemies: ctx.enemies.slice(),
      spawn,
      regions: extractRegionGraph(world, spawn, spawn),
      waystones: sceneRuntime.waystones,
      pickups: sceneRuntime.pickups,
      ...(sceneRuntime.portal ? { portal: sceneRuntime.portal } : {}),
      ...(sceneRuntime.keyTaken ? { keyTaken: true } : {}),
      ...(sceneRuntime.authoredLights.length > 0 ? { authoredLights: sceneRuntime.authoredLights } : {}),
      ...(generatedScenes.length > 0 ? { generatedScenes } : {}),
      placedPrefabs: materialized.chunks.map((chunk) => {
        const x0 = chunk.cx * def.chunkSize - materialized.originX - srcX;
        const y0 = chunk.cy * def.chunkSize - materialized.originY - srcY;
        return {
          id: `virtual:${chunk.cx},${chunk.cy}:${chunk.hash}`,
          x0,
          y0,
          x1: x0 + def.chunkSize - 1,
          y1: y0 + def.chunkSize - 1,
        };
      }),
    });
  }

  private virtualGeneratedScenes(
    placements: readonly MaterializedScenePlacement[],
    world: World,
  ): GeneratedScenePlacement[] {
    const out: GeneratedScenePlacement[] = [];
    for (const placement of placements) {
      const x0 = Math.max(0, Math.floor(placement.x));
      const y0 = Math.max(0, Math.floor(placement.y));
      const x1 = Math.min(world.width - 1, Math.ceil(placement.x + placement.w) - 1);
      const y1 = Math.min(world.height - 1, Math.ceil(placement.y + placement.h) - 1);
      if (x1 < x0 || y1 < y0) continue;
      const parsed = this.parseVirtualScenePlacementId(placement.id);
      out.push({
        id: placement.id,
        source: 'virtual-world',
        sceneId: parsed.sceneId,
        slotId: parsed.slotId,
        label: this.virtualSceneLabel(parsed.sceneId),
        x0,
        y0,
        x1,
        y1,
        objectCount: placement.objectCount,
        linkCount: placement.linkCount,
        lightCount: placement.lightCount,
        objects: placement.objects.map((object) => ({
          id: object.id,
          kind: object.kind,
          x: Math.floor(object.x),
          y: Math.floor(object.y),
          params: { ...object.params },
        })),
        links: placement.links.map((link) => ({
          id: link.id,
          fromId: link.fromId,
          toId: link.toId,
          kind: link.kind,
        })),
        lights: placement.lights.map((light) => ({
          id: light.id,
          x: Math.floor(light.x),
          y: Math.floor(light.y),
          color: light.color,
          intensity: finiteNumber(light.intensity, 1),
          radius: finiteNumber(light.radius, 72),
          ...(light.bloom !== undefined ? { bloom: finiteNumber(light.bloom, 0.8) } : {}),
          ...(light.flicker !== undefined ? { flicker: finiteNumber(light.flicker, 0) } : {}),
          ...(light.falloff ? { falloff: light.falloff } : {}),
          ...(light.occluded !== undefined ? { occluded: light.occluded } : {}),
        })),
        ...(placement.sourceChunk ? { sourceChunk: { ...placement.sourceChunk } } : {}),
      });
    }
    return out;
  }

  private parseVirtualScenePlacementId(id: string): {
    slotId: string;
    sceneId: string;
  } {
    const parts = id.split(':');
    if (parts.length >= 3)
      return {
        slotId: parts[parts.length - 2] || 'scene',
        sceneId: parts[parts.length - 1] || id,
      };
    return { slotId: 'scene', sceneId: id };
  }

  private virtualSceneLabel(sceneId: string): string {
    const label = sceneId
      .replace(/^scene-/, '')
      .replaceAll('-', ' ')
      .trim();
    return label ? label.replace(/\b[a-z]/g, (match) => match.toUpperCase()) : 'Generated Scene';
  }

  private warnVirtualMaterializationDrops(
    ctx: Ctx,
    stats: {
      droppedSceneObjects: number;
      droppedSceneLights: number;
      sceneObjects: number;
      sceneLights: number;
    },
  ): void {
    if (stats.droppedSceneObjects <= 0 && stats.droppedSceneLights <= 0) return;
    ctx.events.emit('toast', {
      text: `VIRTUAL WINDOW CAPPED: ${stats.sceneObjects} OBJECTS/${stats.droppedSceneObjects} DROPPED, ${stats.sceneLights} LIGHTS/${stats.droppedSceneLights} DROPPED`,
    });
  }

  private virtualSceneRuntime(
    ctx: Ctx,
    objects: readonly VirtualSceneObject[],
    lights: readonly VirtualSceneLight[],
    srcX: number,
    srcY: number,
    world: World,
  ): {
    enemies: PrefabEnemy[];
    pickups: Pickup[];
    waystones: Waystone[];
    portal: ExitPortal | null;
    keyTaken: boolean;
    authoredLights: AuthoredLight[];
  } {
    const enemies: PrefabEnemy[] = [];
    const pickups: Pickup[] = [];
    const waystones: Waystone[] = [];
    let portal: ExitPortal | null = null;
    let keyTaken = false;
    for (const object of objects) {
      const x = Math.floor(object.x - srcX);
      const y = Math.floor(object.y - srcY);
      if (!world.inBounds(x, y)) continue;
      if (object.kind === 'enemy') {
        enemies.push({
          kind: this.virtualEnemyKind(ctx, object.params.kind, 'slime'),
          x,
          y,
          sourceId: object.id,
        });
      } else if (object.kind === 'bossMarker') {
        enemies.push({
          kind: this.virtualEnemyKind(ctx, object.params.kind, 'colossus'),
          x,
          y,
          sourceId: object.id,
        });
      } else if (object.kind === 'pickup') {
        pickups.push(
          makePickup(this.virtualPickupKind(object.params.kind), x, y, {
            amount: typeof object.params.amount === 'number' ? object.params.amount : undefined,
            card: typeof object.params.card === 'string' ? (object.params.card as Pickup['data']['card']) : undefined,
            potion: typeof object.params.potion === 'string' ? object.params.potion : undefined,
          }),
        );
      } else if (object.kind === 'waystone') {
        waystones.push({ x, y, lit: object.params.lit === true });
      } else if (object.kind === 'exitPortal') {
        portal = {
          x,
          y,
          open: object.params.open === true || object.params.alwaysOpen === true,
        };
        keyTaken = keyTaken || object.params.alwaysOpen === true;
      }
    }
    return {
      enemies,
      pickups,
      waystones,
      portal,
      keyTaken,
      authoredLights: this.virtualSceneLights(lights, srcX, srcY, world),
    };
  }

  private virtualSceneLights(
    lights: readonly VirtualSceneLight[],
    srcX: number,
    srcY: number,
    world: World,
  ): AuthoredLight[] {
    const authored: AuthoredLight[] = [];
    for (const light of lights) {
      const x = Math.floor(light.x - srcX);
      const y = Math.floor(light.y - srcY);
      if (!world.inBounds(x, y)) continue;
      authored.push(
        toAuthoredLight(
          {
            id: light.id,
            x,
            y,
            color: light.color,
            intensity: finiteNumber(light.intensity, 1),
            radius: finiteNumber(light.radius, 72),
            bloom: finiteNumber(light.bloom, 0.8),
            flicker: finiteNumber(light.flicker, 0),
            falloff: light.falloff ?? 'soft',
            occluded: light.occluded ?? true,
            locked: false,
            hidden: false,
          },
          authored.length,
        ),
      );
    }
    return authored;
  }

  private virtualEnemyKind(ctx: Ctx, value: unknown, fallback: EnemyKind): EnemyKind {
    return typeof value === 'string' && value in ctx.enemyCtl.defs ? (value as EnemyKind) : fallback;
  }

  private virtualPickupKind(value: unknown): PickupKind {
    return typeof value === 'string' && VIRTUAL_PICKUP_KINDS.has(value as PickupKind)
      ? (value as PickupKind)
      : 'goldpile';
  }

  private findVirtualSpawn(world: World): { x: number; y: number } {
    const candidates = [Math.floor(WIDTH / 2), Math.floor(WIDTH * 0.35), Math.floor(WIDTH * 0.65)];
    for (const cx of candidates) {
      for (let y = 60; y < HEIGHT - 40; y++) {
        if (this.virtualEntityFree(world, cx, y) && this.virtualFooting(world, cx, y + 1)) {
          return { x: cx, y };
        }
      }
    }
    return { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2) };
  }

  private virtualEntityFree(world: World, cx: number, cy: number): boolean {
    for (let y = cy - 17; y <= cy; y++) {
      for (let x = cx - 4; x <= cx + 4; x++) {
        if (!world.inBounds(x, y)) return false;
        if (blocksEntity(world.types[world.idx(x, y)])) return false;
      }
    }
    return true;
  }

  private virtualFooting(world: World, cx: number, y: number): boolean {
    for (let x = cx - 4; x <= cx + 4; x++) {
      if (world.inBounds(x, y) && blocksEntity(world.types[world.idx(x, y)])) return true;
    }
    return false;
  }

  private carveVirtualSpawn(world: World, cx: number, cy: number): void {
    for (let y = cy - 28; y <= cy + 6; y++) {
      for (let x = cx - 22; x <= cx + 22; x++) {
        if (!world.inBounds(x, y)) continue;
        const i = world.idx(x, y);
        if (y >= cy + 2 && y <= cy + 5) {
          world.types[i] = Cell.Stone;
          world.colors[i] = packRGB(82, 78, 86);
        } else {
          world.types[i] = Cell.Empty;
          world.colors[i] = EMPTY_COLOR;
        }
        world.life[i] = 0;
        world.charge[i] = 0;
      }
    }
  }

  private enterAdHocRuntime(ctx: Ctx, runtime: LevelRuntime, objective: string): void {
    this._transitioning = true;
    this.showTransitionCurtain(ctx, {
      title: 'Opening playtest',
      detail: `Preparing ${runtime.def.name}.`,
    });

    this.levels.set(runtime.def.id, runtime);
    this.currentId = runtime.def.id;
    ctx.world = runtime.world;
    ctx.enemies.length = 0;
    ctx.enemies.push(...runtime.enemies);
    resetCombatTransients(ctx);

    const player = ctx.player;
    player.x = runtime.spawn.x;
    player.y = runtime.spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.fx = 0;
    player.fy = 0;
    player.dead = false;
    player.invuln = 60;
    player.crawling = false;
    player.crawlT = 0;
    player.wallGrabT = 0;
    ctx.playerCtl?.resetTransientState?.(ctx);
    clearFrameStops(ctx);
    ctx.camera.snapTo(player.x, player.y);

    this.waystoneHeat = [];
    this.lastEnemiesEmit = ctx.enemies.length;
    ctx.events.emit('levelChanged', {
      depth: runtime.def.depth,
      name: runtime.def.name,
    });
    this.restoreWeaverLairWebs(ctx, runtime);
    ctx.events.emit('enemiesLeft', { count: ctx.enemies.length });
    ctx.events.emit('objectiveChanged', { text: objective });

    this.finishTransitionWithCurtain(ctx);
  }

  private serializeLevel(id: string, rt: LevelRuntime): SavedLevelBlob {
    // Life on transient cells (fire/ember/smoke/steam) is noise a second from
    // now — skipping it keeps multi-level saves well inside localStorage quota.
    const life: Array<[number, number]> = [];
    const types = rt.world.types;
    const lifeArr = rt.world.life;
    for (let i = 0; i < lifeArr.length; i++) {
      if (lifeArr[i] === 0) continue;
      const t = types[i];
      if (t === Cell.Fire || t === Cell.Ember || t === Cell.Smoke || t === Cell.Steam) continue;
      life.push([i, lifeArr[i]]);
    }
    return {
      id,
      rle: rleEncode(rt.world.types),
      colorOverrides: this.serializeColorOverrides(rt.world),
      life,
      charge: sparseNonZeroPairs(rt.world.charge),
      explored: bytesToBase64(rt.explored),
      waystones: rt.waystones,
      pickups: rt.pickups.map(snapshotPickupForSave),
      mechanisms: rt.mechanisms.map(sanitizeMechanismForSave),
      runeVaults: rt.runeVaults,
      keyTaken: rt.keyTaken,
      portalOpen: rt.portal?.open ?? false,
      litOrder: this.litOrder.get(id) ?? [],
      enemies: rt.enemies.map(snapshotEnemyForSave),
      ...(rt.weaverLairWebs.length > 0 ? { weaverLairWebs: rt.weaverLairWebs } : {}),
    };
  }

  private serializeColorOverrides(world: World): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const i of world.colorOverrides) {
      if (i < 0 || i >= world.colors.length || world.types[i] === Cell.Empty) continue;
      out.push([i, world.colors[i] >>> 0]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out;
  }

  private isExpeditionSaveShape(value: unknown): value is ExpeditionSave {
    if (!value || typeof value !== 'object') return false;
    const save = value as Partial<ExpeditionSave>;
    const player = save.player as Partial<ExpeditionSave['player']> | undefined;
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    return (
      save.v === 1 &&
      typeof save.currentId === 'string' &&
      finite(save.expeditionSeed) &&
      (save.genTuneSignature === undefined || typeof save.genTuneSignature === 'string') &&
      finite(save.score) &&
      Array.isArray(save.levels) &&
      save.levels.every(isSavedLevelBlobShape) &&
      !!save.loadout &&
      typeof save.loadout === 'object' &&
      !!player &&
      finite(player.x) &&
      finite(player.y) &&
      finite(player.hp) &&
      finite(player.maxHp) &&
      finite(player.levit) &&
      finite(player.maxLevit) &&
      !!player.perks &&
      typeof player.perks === 'object'
    );
  }

  private retireSavedExpedition(ctx: Ctx, text: string): void {
    this.abandonExpedition();
    ctx.events.emit('toast', { text });
  }

  /** Resume a saved expedition: hero + loadout now, levels lazily on entry. */
  private tryResumeExpedition(ctx: Ctx): boolean {
    let save: ExpeditionSave | null = null;
    try {
      const raw = localStorage.getItem(EXPEDITION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (!this.isExpeditionSaveShape(parsed)) {
          this.retireSavedExpedition(ctx, 'SAVED EXPEDITION CORRUPT - RETIRED');
          return false;
        }
        save = parsed;
      }
    } catch {
      this.retireSavedExpedition(ctx, 'SAVED EXPEDITION CORRUPT - RETIRED');
      return false;
    }
    if (!save || save.v !== 1 || !LEVELS[save.currentId]) return false;
    // Generation-version guard: a save from another generation would resume
    // against regenerated worlds that no longer match its blobs. Retire it
    // honestly instead of silently desyncing.
    if (save.genVersion !== GEN_VERSION) {
      this.retireSavedExpedition(ctx, 'THE DEPTHS HAVE SHIFTED - EXPEDITION RETIRED');
      return false;
    }
    const savedGenTuneSignature = save.genTuneSignature ?? GEN_TUNE_DEFAULT_SIGNATURE;
    if (savedGenTuneSignature !== genTuneSignature()) {
      this.retireSavedExpedition(ctx, 'WORLDGEN TUNING CHANGED - EXPEDITION RETIRED');
      return false;
    }
    // A legacy review/debug-kit save is intentionally non-resumable. Retire it
    // (like the genVersion path) so it doesn't linger in localStorage forever
    // making hasSavedExpedition() report a save that can never be resumed.
    if (this.isLegacyReviewSave(save)) {
      this.retireSavedExpedition(ctx, 'REVIEW EXPEDITION RETIRED');
      return false;
    }

    const suppressionBeforeResume = this.checkpointSaveSuppression;
    try {
      this.expeditionSeed = save.expeditionSeed >>> 0;
      this.savedBlobs.clear();
      this.blobCache.clear();
      for (const blob of save.levels) this.savedBlobs.set(blob.id, blob);

      ctx.state.score = save.score;
      ctx.state.difficulty = save.difficulty ?? 3; // pre-difficulty saves resume at the shipped balance
      ctx.events.emit('scoreChanged', { score: ctx.state.score });
      const p = ctx.player;
      p.maxHp = save.player.maxHp;
      p.hp = save.player.hp;
      p.maxLevit = save.player.maxLevit;
      p.levit = save.player.levit;
      p.perks = { ...save.player.perks } as typeof p.perks;
      if (save.wands) ctx.wands.restoreRuntimeState(save.wands);
      else {
        ctx.wands.loadLoadout(save.loadout);
        ctx.wands.markDepthGrantsThrough(LEVELS[save.currentId].depth);
      }
      this.restoreFlasks(ctx, save.flasks);

      this.checkpointSaveSuppression++;
      try {
        this.enterLevel(ctx, save.currentId);
      } finally {
        this.checkpointSaveSuppression--;
      }
      // enterLevel parks the hero at the spawn; the save knows better.
      p.x = save.player.x;
      p.y = save.player.y;
      ctx.camera.snapTo(p.x, p.y);
      this.saveExpedition(ctx);
    } catch (error) {
      console.warn('Saved expedition failed to resume', error);
      this.checkpointSaveSuppression = suppressionBeforeResume;
      this.retireSavedExpedition(ctx, 'SAVED EXPEDITION CORRUPT - RETIRED');
      return false;
    }
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

    const expeditionSeed = this.activeExpeditionSeed(ctx);
    const seed = (expeditionSeed ^ this.hashString(def.id)) >>> 0;
    const pristine = ctx.worldgen.generateLevel(ctx, def, seed, {
      hostArch: def.id === vaultHostId(expeditionSeed),
    });

    const savedTypes = new Uint8Array(world.types.length);
    if (!rleDecodeExact(blob.rle, savedTypes)) throw new Error(`Saved level "${def.id}" RLE length mismatch`);
    for (let i = 0; i < savedTypes.length; i++) {
      if (savedTypes[i] !== world.types[i]) {
        world.types[i] = savedTypes[i];
        const fn = COLOR_FN[savedTypes[i]];
        world.colors[i] = fn ? fn() : EMPTY_COLOR;
      }
    }
    world.life.fill(0);
    world.charge.fill(0);
    world.activeCharges.clear();
    // Guard the saved indices (same as the colorOverrides loop below): an
    // out-of-range index from a corrupt save must not write past the planes or
    // seed setChargeAt's activeCharges set with a bad entry.
    for (const [i, v] of blob.life) {
      if (i >= 0 && i < world.life.length) world.life[i] = v;
    }
    for (const [i, v] of blob.charge) {
      if (i >= 0 && i < world.charge.length) world.setChargeAt(i, v);
    }
    for (const [i, color] of blob.colorOverrides ?? []) {
      if (i < 0 || i >= world.colors.length || world.types[i] === Cell.Empty) continue;
      world.colors[i] = color >>> 0;
      world.colorOverrides.add(i);
    }

    for (const se of blob.enemies) {
      ctx.enemies.push(reviveSavedEnemy(se));
    }

    const explored = new Uint8Array(MINIMAP_W * MINIMAP_H);
    base64ToBytes(blob.explored, explored);
    this.litOrder.set(def.id, [...blob.litOrder]);

    const portal = pristine.portal ? { x: pristine.portal.x, y: pristine.portal.y, open: blob.portalOpen } : null;

    const runtime = makeLevelRuntime({
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
      pickups: blob.pickups.map(snapshotPickupForSave),
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
      ...(pristine.authoredLights.length > 0 ? { authoredLights: pristine.authoredLights } : {}),
      ...(pristine.emitters.length > 0 ? { emitters: pristine.emitters } : {}),
      ...(pristine.decors.length > 0 ? { decors: pristine.decors } : {}),
      ...(pristine.refuge ? { refuge: pristine.refuge } : {}),
      ...(pristine.spellLab ? { spellLab: pristine.spellLab } : {}),
      ...(pristine.vaultArch ? { vaultArch: pristine.vaultArch } : {}),
      weaverLairWebs: sanitizeWeaverLairWebs(blob.weaverLairWebs),
    });

    // A door/valve saved MID-retraction comes back with state=1 (open) but its
    // transient dissolve queue was dropped on save, so the partially-cleared
    // Metal in the restored RLE would stay stuck forever. Finish the retraction:
    // an open gate must have no Metal left in its footprint.
    for (const m of runtime.mechanisms) {
      if (m.state !== 1 || (m.kind !== 'door' && m.kind !== 'valve')) continue;
      for (let dy = 0; dy < m.h; dy++) {
        for (let dx = 0; dx < m.w; dx++) {
          const X = m.x + dx,
            Y = m.y + dy;
          if (!world.inBounds(X, Y)) continue;
          const i = world.idx(X, Y);
          if (world.types[i] === Cell.Metal) world.clearCellAt(i);
        }
      }
    }

    return runtime;
  }

  /** Respawn anchor: last lit waystone in the current level, else level spawn. */
  respawnPoint(): { x: number; y: number } | null {
    const runtime = this.current;
    if (!runtime) return null;
    const order = this.litOrder.get(runtime.def.id);
    if (order && order.length > 0) {
      // litOrder is restored verbatim from the save blob while waystones are
      // regenerated from seed; a stale/desynced index must fall through to the
      // level spawn instead of dereferencing undefined and crashing respawn.
      const ws = runtime.waystones[order[order.length - 1]];
      if (ws) return { x: ws.x, y: ws.y - 2 };
    }
    return { x: runtime.spawn.x, y: runtime.spawn.y };
  }

  private restoreWeaverLairWebs(ctx: Ctx, runtime: LevelRuntime): void {
    for (const web of runtime.weaverLairWebs) {
      ctx.vineStrands.addWebLattice(web.x, web.y, web.radius, {
        radials: web.radials,
        rings: web.rings,
        thickness: web.thickness,
        color: web.color,
        jitter: web.jitter,
      });
    }
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

    this.showTransitionCurtain(ctx, {
      title: 'Opening the descent',
      detail: `Preparing ${def.name}.`,
    });

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
        // Saved by a previous session: regenerate-and-overlay (see restoreLevel).
        // Fail-open: a corrupt blob (e.g. an unreadable RLE that throws out of
        // rleDecode) must NEVER strand the run mid-transition with the curtain
        // up. Fall back to a pristine regenerate from the level seed and drop
        // the bad blob; createLevel re-establishes ctx.world/enemies from
        // scratch, so the partial state left by a failed restore is overwritten.
        try {
          runtime = this.restoreLevel(ctx, def, blob);
        } catch (error) {
          console.warn(`Saved level "${id}" failed to restore; regenerating pristine`, error);
          runtime = this.createLevel(ctx, def);
          ctx.events.emit('toast', {
            text: 'A DEPTH WAS UNREADABLE — REFORGED',
          });
        }
        this.savedBlobs.delete(id);
      } else {
        runtime = this.createLevel(ctx, def);
      }
      this.levels.set(id, runtime);
    }

    // Transient combat state never crosses a well
    resetCombatTransients(ctx);
    ctx.flask.cancelBottle();

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
    ctx.playerCtl?.resetTransientState?.(ctx);
    clearFrameStops(ctx);
    ctx.camera.snapTo(player.x, player.y);

    this.currentId = id;
    this.scheduleSettledFindabilityRepair(ctx, runtime);
    this.waystoneHeat = new Array<number>(runtime.waystones.length).fill(0);
    this.waystonePromptArmed = true;
    this.waystonePromptOpen = false;
    this.lastEnemiesEmit = ctx.enemies.length;
    if (ctx.state.debugGodMode) {
      grantFullReviewKit(player);
      this.seedRuntimeReviewKit(ctx, runtime);
    }
    ctx.events.emit('levelChanged', { depth: def.depth, name: def.name });
    this.restoreWeaverLairWebs(ctx, runtime);
    // The physics test arena stamps its authored terrain + rigid bodies AFTER
    // levelChanged (which clears the body pool), so the bodies persist.
    if (id === 'physics-test') buildPhysicsArena(ctx);
    if (id === 'weaver-test') buildWeaverArena(ctx);
    ctx.events.emit('enemiesLeft', { count: ctx.enemies.length });
    ctx.events.emit('objectiveChanged', {
      text: id === 'weaver-test'
        ? 'STUDY THE WEAVER LAIR'
        : runtime.portal
        ? runtime.keyTaken
          ? 'RETURN TO THE PORTAL'
          : 'FIND THE GOLDEN KEY'
        : runtime.boss
          ? 'SLAY THE KILN COLOSSUS'
          : def.branch
            ? 'PLUNDER THE HOARD — THE ARCH LEADS HOME'
            : 'THE DEPTHS END HERE — SURVIVE',
    });

    this.finishTransitionWithCurtain(ctx);

    // Crossing a threshold is a natural checkpoint.
    if (this.checkpointSaveSuppression === 0) this.saveExpedition(ctx);
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
      runtime.pickups.filter((p) => !p.taken && p.kind === 'potion' && p.data.potion).map((p) => p.data.potion!),
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

  private repairFindability(ctx: Ctx, runtime: LevelRuntime, phase: 'initial' | 'settled'): boolean {
    const findability = failOpenFindability(runtime);
    if (import.meta.env.DEV) {
      if (findability.repaired.length) {
        console.warn(
          `[findability:${phase}:repaired] ${runtime.def.id}: ${findability.repaired
            .map((i) => `${i.what}@${i.x},${i.y}`)
            .join(' ')}`,
        );
      }
      const remainingErrors = findability.remaining.filter((i) => i.severity === 'error');
      if (remainingErrors.length) {
        console.warn(
          `[findability:${phase}:remaining] ${runtime.def.id}: ${remainingErrors
            .map((i) => `${i.what}@${i.x},${i.y}`)
            .join(' ')}`,
        );
      }
    }
    if (findability.repaired.length > 0) {
      this.blobCache.delete(runtime.def.id);
      ctx.events.emit('toast', { text: 'A SAFE ROUTE TEARS OPEN' });
    }
    return findability.repaired.length > 0;
  }

  private scheduleSettledFindabilityRepair(ctx: Ctx, runtime: LevelRuntime): void {
    const id = runtime.def.id;
    // Authored arenas own their layout; the procedural repair would carve
    // Metal-sleeved rescue tunnels through it (see AUTHORED_TEST_ARENAS).
    if (AUTHORED_TEST_ARENAS.has(id)) return;
    const token = ++this.findabilityRepairToken;
    globalThis.setTimeout(() => {
      if (token !== this.findabilityRepairToken || this.currentId !== id || this.current !== runtime) return;
      if (this.repairFindability(ctx, runtime, 'settled') && this.checkpointSaveSuppression === 0) {
        this.saveExpedition(ctx);
      }
    }, SETTLED_FINDABILITY_REPAIR_MS);
  }

  /** Generate a fresh level World into ctx and place its hostile population. */
  private createLevel(ctx: Ctx, def: LevelDef): LevelRuntime {
    // Ctx.world is a mutable field by design: every system dereferences ctx
    // each frame, so swapping between frames is safe.
    const world = new World();
    ctx.world = world;
    ctx.enemies.length = 0;

    const expeditionSeed = this.activeExpeditionSeed(ctx);
    const seed = (expeditionSeed ^ this.hashString(def.id)) >>> 0;
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
      spellLab,
      vaultArch,
      vaultHoard,
    } = ctx.worldgen.generateLevel(ctx, def, seed, {
      hostArch: def.id === vaultHostId(expeditionSeed),
    });
    // Placement brain (Wave C): one flood-fill analysis of the fresh cells,
    // anchored at the spawn chamber and the well mouth above the seal plug.
    const regions = extractRegionGraph(ctx.world, spawn, {
      x: exit.x,
      y: exit.sealY - 12,
    });
    const populationReach = wizardMask(makeLevelRuntime({ def, world, spawn, regions }));
    const weaverLairWebs: WeaverLairWeb[] = [];
    this.placePopulation(ctx, def, spawn, regions, populationReach, new Rng(hashSeed(seed, 'population')), weaverLairWebs);
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
      ...(spellLab ? { spellLab } : {}),
      ...(vaultArch ? { vaultArch } : {}),
      weaverLairWebs,
    });

    // Findability fail-open: validator-matched progression breaks carve an
    // explicit rescue route, then DEV still shouts because the generator regressed.
    // Authored arenas discard this generated world moments later (build*Arena), so
    // there's nothing to make reachable — and its Metal rescue sleeves would only
    // be wiped by the rebuild anyway.
    if (!AUTHORED_TEST_ARENAS.has(def.id)) this.repairFindability(ctx, runtime, 'initial');

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
    weaverLairWebs: WeaverLairWeb[],
  ): void {
    // Depth sets the headcount; the biome's foes table sets the mix; difficulty
    // scales the whole headcount (the "enemy rate is insane" knob). Level 3 = ×1.
    const foes = EXTRAS[def.biome].foes;
    const pop = populationForLevel(def, foes);
    const countScale = difficultyMods(ctx.state).enemyCount;
    for (const [kind, count] of Object.entries(pop) as Array<[EnemyKind, number]>) {
      const enemyDef = ctx.enemyCtl.defs[kind];
      const scaled = Math.round(count * countScale);
      for (let i = 0; i < scaled; i++) {
        const spot = this.findPopulationSpot(ctx, rng, spawn, regions, reachable, enemyDef.halfW, enemyDef.h);
        if (spot) {
          const enemy = this.spawnSeededEnemy(ctx, kind, spot.x, spot.y, rng);
          if (enemy?.kind === 'weaver') this.stampWeaverLair(ctx, spot.x, spot.y, rng, weaverLairWebs);
        }
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
        const spot = this.findPopulationSpot(ctx, rng, spawn, regions, reachable, eggsDef.halfW, eggsDef.h, {
          clearances: [180, 100, 0],
        });
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
      opts.preferMainPath !== false && regions && regions.mainPath.length > 0 ? [true, false] : [false];

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
          if (world.types[world.idx(x, y - 1)] === Cell.Empty || world.types[world.idx(x, y)] !== Cell.Empty) continue;
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

  private stampWeaverLair(ctx: Ctx, x: number, y: number, rng: Rng, weaverLairWebs: WeaverLairWeb[]): void {
    const world = ctx.world;
    const paint = (px: number, py: number, type: Cell): boolean => {
      if (!world.inBounds(px, py)) return false;
      const i = world.idx(px, py);
      if (world.types[i] !== Cell.Empty) return false;
      const fn = COLOR_FN[type];
      world.replaceCellAt(i, type, fn ? fn() : EMPTY_COLOR);
      return true;
    };
    const hasSupportBelow = (px: number, py: number): boolean => {
      if (!world.inBounds(px, py + 1)) return false;
      return blocksEntity(world.types[world.idx(px, py + 1)]);
    };

    // Hanging curtains: find nearby ceiling lips and pull short, burnable
    // vine strands down into the reachable chamber.
    weaverLairWebs.push({
      x,
      y: y - 48 - rng.int(18),
      radius: 42 + rng.int(24),
      radials: 8 + rng.int(5),
      rings: 4 + rng.int(3),
      thickness: 1,
      color: packRGB(66 + rng.int(24), 148 + rng.int(42), 58 + rng.int(24)),
      jitter: 0.06 + rng.next() * 0.08,
    });
    for (let n = 0; n < 10; n++) {
      const ax = Math.floor(x - 46 + rng.int(93));
      let anchorY = -1;
      for (let yy = Math.floor(y - 70); yy <= Math.floor(y - 12); yy++) {
        if (!world.inBounds(ax, yy) || !world.inBounds(ax, yy + 1)) continue;
        if (blocksEntity(world.types[world.idx(ax, yy)]) && world.types[world.idx(ax, yy + 1)] === Cell.Empty) {
          anchorY = yy + 1;
          break;
        }
      }
      if (anchorY < 0) continue;
      const len = 7 + rng.int(15);
      let misses = 0;
      for (let k = 0; k < len; k++) {
        const px = ax + Math.round(Math.sin((k + n) * 0.8) * 1.4);
        const py = anchorY + k;
        // Drape OVER pre-existing growth instead of truncating at it (fungal
        // ceilings already carry moss/fungus); only bail once the strand runs
        // into a sustained solid mass.
        if (!paint(px, py, Cell.Vines)) {
          if (k > 2 && ++misses > 3) break;
          continue;
        }
        misses = 0;
        if (rng.next() < 0.18) paint(px + (rng.next() < 0.5 ? -1 : 1), py, Cell.Vines);
      }
    }

    // Floor threads and growth: soft cells only, so no route is blocked.
    for (let n = 0; n < 150; n++) {
      const px = Math.floor(x - 54 + rng.int(109));
      const py = Math.floor(y - 16 + rng.int(29));
      if (!world.inBounds(px, py)) continue;
      if (rng.next() < 0.45) {
        paint(px, py, Cell.Vines);
      } else if (hasSupportBelow(px, py)) {
        const roll = rng.next();
        paint(px, py, roll < 0.45 ? Cell.Moss : roll < 0.82 ? Cell.Fungus : Cell.Glowshroom);
      }
    }
  }

  /* ---------------- waystones ---------------- */

  /**
   * Fire-lit checkpoints: you must BRING heat to the bowl. Runs every 4th frame;
   * a sustained hot cell in the bowl rect for WAYSTONE_LIGHT_TICKS hot checks
   * lights the brazier. "Hot" matches the brazier's render tell (isHotCell): a
   * cast flame stream, but also CARRIED heat that pools and persists — poured
   * lava or drifting embers — so a player with no fire spell can still light it.
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
          if (!world.inBounds(X, Y)) continue;
          const t = world.types[world.idx(X, Y)];
          if (t === Cell.Fire || t === Cell.Lava || t === Cell.Ember) fire++;
        }
      }
      // `?? 0` tolerates a waystone added after enterLevel sized the heat array
      // (the physics arena pushes its checkpoint during the post-enter build).
      this.waystoneHeat[i] = fire > 0 ? (this.waystoneHeat[i] ?? 0) + 1 : 0;
      // Expose ignition progress for the render's "almost lit" tell.
      ws.heat = Math.min(1, this.waystoneHeat[i] / WAYSTONE_LIGHT_TICKS);
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
    ctx.particles.burst(ws.x, ws.y - 3, 26, null, () => packRGB(255, 196 + Math.floor(Math.random() * 40), 64), 2.6, {
      glow: 2.4,
      grav: -0.012,
    });
    ctx.particles.burst(ws.x, ws.y - 3, 14, null, emberColor, 1.7, {
      glow: 2.2,
      grav: 0.02,
    });
    ctx.audio.tone(660, 660, 0.22, 'sine', 0.18);
    setTimeout(() => ctx.audio.tone(990, 990, 0.3, 'sine', 0.16), 130);

    ctx.events.emit('waystoneLit');
  }

  /**
   * Walking up to an unlit waystone raises a one-shot help prompt: if the player
   * owns a fire spell that isn't on the active wand, offer to seat it; if they
   * own none, explain how to bring fire by hand. Fires once per approach
   * (re-armed when they step away) and never when the wand can already make fire.
   */
  private maybeWaystonePrompt(ctx: Ctx, runtime: LevelRuntime): void {
    if (this.waystonePromptOpen || ctx.state.paused) return;
    const r2 = WAYSTONE_PROMPT_RADIUS * WAYSTONE_PROMPT_RADIUS;
    let near = false;
    for (const ws of runtime.waystones) {
      if (ws.lit) continue;
      const dx = ws.x - ctx.player.x,
        dy = ws.y - ctx.player.y;
      if (dx * dx + dy * dy <= r2) {
        near = true;
        break;
      }
    }
    if (!near) {
      this.waystonePromptArmed = true;
      return;
    }
    if (!this.waystonePromptArmed) return;
    const active = ctx.wands.wands[ctx.wands.active];
    // The wand can already make fire — no need to nag.
    if (WAYSTONE_FIRE_CARDS.some((c) => active.cards.includes(c))) return;
    this.waystonePromptArmed = false;
    const owned =
      WAYSTONE_FIRE_CARDS.find(
        (c) => ctx.wands.collection.includes(c) || ctx.wands.wands.some((w) => w.cards.includes(c)),
      ) ?? null;
    this.waystonePromptOpen = true;
    const shown = ctx.events.emit('waystonePrompt', {
      card: owned,
      onEquip: () => {
        if (owned) this.equipFireCard(ctx, owned);
        this.waystonePromptOpen = false;
      },
      onDismiss: () => {
        this.waystonePromptOpen = false;
      },
    });
    if (!shown) this.waystonePromptOpen = false; // no UI listening — don't wedge
  }

  /** Replace the active wand's loadout with a single fire card the player owns. */
  private equipFireCard(ctx: Ctx, card: CardId): void {
    const wi = ctx.wands.active;
    const wand = ctx.wands.wands[wi];
    // If the card is parked in the other wand, pull it back to the collection first.
    if (!ctx.wands.collection.includes(card)) {
      const other = wi === 0 ? 1 : 0;
      const os = ctx.wands.wands[other].cards.indexOf(card);
      if (os >= 0) ctx.wands.slotCard(other, os, null);
    }
    // Clear the active wand back to the collection, then seat the fire card.
    for (let s = 0; s < wand.cards.length; s++) {
      if (wand.cards[s] !== null) ctx.wands.slotCard(wi, s, null);
    }
    ctx.wands.slotCard(wi, 0, card);
    ctx.events.emit('toast', { text: 'FIRE SPELL EQUIPPED' });
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

  /** Tiny FNV-1a over the level id — folds it into the expedition seed.
   *  Shared with Builder's campaign playtest seed (core/rng.fnv1aString) so the
   *  two cannot silently diverge. */
  private hashString(s: string): number {
    return fnv1aString(s);
  }
}

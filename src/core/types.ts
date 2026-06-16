import type { World } from '@/sim/World';
import type { EventBus } from '@/core/events';
import type { Cell } from '@/sim/CellType';
import type { VirtualWorldDef } from '@/world/virtual/types';

/* ============================================================
 * Entity data
 * ============================================================ */

/**
 * Sim-sampled entity statuses: read from the cells touching a body each tick,
 * written back as cells where it matters (burning sheds fire). All values are
 * frames remaining. Potion timers live here too — a potion is just a timed
 * rewrite of entity-vs-cell rules (DESIGN.md pillar 5).
 */
export interface EntityStatus {
  wet: number;
  oiled: number;
  burning: number;
  frozen: number;
  electrified: number;
  /** Potion: heal-over-time. */
  regen: number;
  /** Potion: free levitation (no levit drain). */
  levity: number;
  /** Potion: damage taken halved, knockback immune. */
  stoneskin: number;
  /** Buff: movement speed x1.45 and stronger jump. */
  swift: number;
  /** Buff: brighter, steadier, longer wand light. */
  torch: number;
}

export interface Hat {
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  pvx: number;
  pvy: number;
}

/**
 * The alchemist. Position is an integer cell coordinate (x, y at the FEET);
 * fx/fy accumulate sub-cell motion until a whole cell is crossed.
 * Hitbox: halfW 4, height 17 (PLAYER_HALF_W / PLAYER_H).
 */
export interface PlayerState {
  x: number;
  y: number;
  fx: number;
  fy: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  levit: number;
  maxLevit: number;
  facing: number;
  aimAngle: number;
  grounded: boolean;
  inLiquid: boolean;
  dead: boolean;
  invuln: number;
  spell: SpellId;
  cooldown: number;
  firing: boolean;
  // procedural animation state
  stridePhase: number;
  landTimer: number;
  blinkTimer: number;
  prevGrounded: boolean;
  fallPeak: number;
  hat: Hat;
  // smoothed real-displacement trackers (updated by the animation pass)
  _px: number;
  _py: number;
  _svx: number;
  _svy: number;
  status: EntityStatus;
  /** One-time Sanctum boons. */
  perks: Partial<Record<PerkId, true>>;
  /** Teleportium contact cooldown (frames). */
  tpCool: number;
  /**
   * Heart communion (frames left): restoring vitality roots the alchemist —
   * movement and casting are locked while the charge runs.
   */
  recharge: number;
  /** Lever pull (frames left): gripping and driving the arm across. */
  pullT: number;
  /** Direction (+-1) toward the lever being pulled. */
  pullDir: number;
  // fluidity pass: squash/stretch, skid, draw, recoil, stagger, fidget, cloth
  /** Jump-launch stretch (frames left) — the opposite pole of landTimer. */
  stretchT: number;
  /** Turn-around skid (frames left); skidDir is the OLD travel direction. */
  skidT: number;
  skidDir: number;
  /** Wand draw arc after a swap (frames left). */
  swapT: number;
  /** Cast recoil kick on the wand arm (frames left). */
  recoilT: number;
  /** Melee kick pose (frames left) — drives the leg thrust toward kickDir. */
  kickT: number;
  /** Direction (±1) the last kick was aimed (for the pose). */
  kickDir: number;
  /** True while swinging on a vine (pendulum owns movement; body-resolve skips him). */
  swinging?: boolean;
  /** Hurt stagger lean (frames left) in staggerDir (+-1, away from the hit). */
  staggerT: number;
  staggerDir: number;
  /** Idle fidget routine (frames left: hat adjust, then a wand twirl). */
  fidgetT: number;
  /** Crouch & peek (frames held, capped at 10; eases pose + camera). */
  crouchT: number;
  /** Dive slam: >0 while committed to the fast-fall, cleared by the landing. */
  diveT: number;
  /**
   * CRAWL (docs/CRAWL.md): the second collision tier is active — the body is
   * the 9x9 box. The key expresses intent; geometry decides this flag, and it
   * may never desync from the world (release S under a low ceiling and you
   * stay crawling until the headroom probe lets you up).
   */
  crawling: boolean;
  /** Crawl pose ease (0-10 like crouchT); also drives the camera's forward lead. */
  crawlT: number;
  /** Smoothed travel slope (dy per dx, -1..1) — tilts the crawl SPRITE only. */
  crawlSlope: number;
  /**
   * Wall-grab pose hysteresis (0-10): grounded on nothing but the lip of a
   * cliff face. Pose state only — the pixel-catch physics is untouched.
   */
  wallGrabT: number;
  /** Side of the held wall face (+-1). */
  wallGrabDir: number;
  /** True while the grab key is holding the alchemist to a solid vertical face. */
  climbing: boolean;
  /** Side of the climbable wall face (+-1, relative to the body). */
  climbDir: number;
  /** Climb pose ease (0-10): catch/settle into the bouldering stance. */
  climbT: number;
  /** Procedural hand-over-hand phase, advanced only by climb movement. */
  climbPhase: number;
  /** Staged movement accumulator: slow, keyed one-cell climb steps. */
  climbMoveT: number;
  /** Last vertical climb intent (-1 up, 0 hold, +1 down), for animation. */
  climbIntentY: number;
  /** Robe hem cloth spring: lagged horizontal offset (same idea as the hat). */
  robe: { ox: number; vx: number };
}

export const PLAYER_HALF_W = 4;
export const PLAYER_H = 17;
export const PLAYER_STEP_UP = 5;
/** Crawl gauge (CRAWL.md rule zero): 9 in any direction — optional tier only. */
export const PLAYER_CRAWL_H = 9;
/**
 * Crawl step-up: PARITY with standing. If your boots can climb a lip, your
 * hands can climb it prone — natural cave floors are nothing but 3-5 cell
 * lips, and the original 2 wedged crawlers where runners strolled (the box
 * fit at y-s still gates every step, so tight ceilings keep their law).
 */
export const PLAYER_CRAWL_STEP_UP = 5;

export type EnemyKind =
  | 'slime'
  | 'imp'
  | 'golem'
  | 'acidslime'
  | 'wisp'
  | 'mage'
  | 'bat'
  | 'spitter'
  | 'bomber'
  | 'colossus'
  // Wave F: a glistening slime egg clutch — destroy it or it hatches
  | 'eggs'
  // The d4 mid-boss: water is its armor; drain the arena or electrify it
  | 'leviathan';

export interface EnemyDef {
  hp: number;
  halfW: number;
  h: number;
  bounty: number;
  gore: Cell;
  goreFn: () => number;
}

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  fx: number;
  fy: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  flash: number;
  timer: number;
  attackCd: number;
  bobPhase: number;
  grounded: boolean;
  stride: number;
  splat: number;
  prevG: boolean;
  blink: number;
  jetFuel: number;
  jetCd: number;
  stuckT: number;
  // lazily-added smoothed displacement trackers (sprite animation)
  _px?: number;
  _svx?: number;
  status: EntityStatus;
  /** Depth-scaled damage multiplier (1 at depth 1). */
  dmgK?: number;
  /** Spitter: frames of lob recoil (sprite squash). */
  recoil?: number;
  /** Bomber: fuse frames remaining; detonates at 0. */
  fusing?: number;
  /** Bat roosts (Wave F): hangs dormant from the ceiling until disturbed. */
  sleeping?: boolean;
  /** Golem: frames of wall-punch animation remaining. */
  punching?: number;
  /** Has noticed the alchemist at least once (alert blip fired). */
  alerted?: boolean;
  /** Anticipation frames: a slime gathering before its hop / a bat flaring before the dart. */
  windup?: number;
  /** Bat: frames of the committed high-speed dart after the flare. */
  swoop?: number;
  /** Wounded bat: frames of flutter-tumble (the wings failing). */
  tumble?: number;
  /** Builder-authored patrol waypoints: un-alerted walkers/hoppers loop
   *  these instead of free-wandering (generated levels never set this). */
  patrol?: Array<[number, number]>;
  patrolIdx?: number;
  /** Patrollers only: frames since losing the player; ~5s of calm de-alerts
   *  so the authored route survives a disengaged skirmish. */
  calmT?: number;
  /** Leviathan: the body is actually IN water right now (cell census, every
   *  4th frame) — its damage shield and swim physics read THIS, never a
   *  lingering wet meter. The grid is the armor. */
  submerged?: boolean;
  /** Environmental contact damage feedback throttle. */
  envDamageFeedbackCd?: number;
}

/* ---------------- Wave F: the critter layer ---------------- */

export type CritterKind = 'moth' | 'firefly' | 'fish' | 'beetle' | 'fly';

/** Ambient harmless life. Transient per level — respawned around the camera. */
export interface Critter {
  kind: CritterKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Per-critter animation/wander phase. */
  phase: number;
  /** Fish out of water / general distress countdown; <=0 from spawn = unused. */
  gasp: number;
  facing: number;
}

export interface CrittersApi {
  readonly list: readonly Critter[];
  update(ctx: Ctx): void;
  /** Concussion/heat kills the small things too (splat + remove). */
  killAt(ctx: Ctx, x: number, y: number, radius: number): void;
  /** O(1) owner-managed removal; critter draw order is intentionally unstable. */
  remove(critter: Critter): Critter | undefined;
  clear(): void;
}

export type SpellId =
  | 'bolt'
  | 'scatter'
  | 'bomb'
  | 'lightning'
  | 'flame'
  | 'emberstorm'
  | 'vitriol'
  | 'frostshard'
  | 'icelance'
  | 'wisp'
  | 'dig'
  | 'conjure'
  | 'warp'
  | 'meteor'
  | 'blackhole';

export type ProjectileType =
  | SpellId
  | 'fireball'
  | 'frostbolt'
  // Upgrade-port projectiles (noita-alchemists-descent.html)
  | 'pellet'
  | 'iceshard'
  | 'icelance'
  | 'wisp'
  | 'meteor'
  | 'acidglob';

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: ProjectileType;
  life: number;
  age: number;
  charging: boolean;
  hostile: boolean;
  /** Black hole only: current vortex radius. */
  vortexRad?: number;
  /** Damage/radius multiplier applied at impact (wand 'heavy', perks). Default 1. */
  mul?: number;
}

export interface FlyingParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Cell type re-deposited into the grid on landing; null = purely visual. */
  type: number | null;
  /** Packed 0xRRGGBB. */
  color: number;
  life: number;
  grav: number;
  glow: number;
  homing: boolean;
  value: number;
  hostileDmg: number;
}

export interface ParticleOpts {
  grav?: number;
  glow?: number;
  homing?: boolean;
  value?: number;
  hostileDmg?: number;
}

export interface Shockwave {
  cx: number;
  cy: number;
  currentRadius: number;
  maxRadius: number;
  speed: number;
  /** Negative strength = implosion (black hole collapse). */
  strength: number;
}

export interface LightningArc {
  pts: Array<{ x: number; y: number }>;
  life: number;
  intensity: number;
}

export interface DigBeam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
}

/* ============================================================
 * Tunable parameters (mutated live by the inspector UI)
 * ============================================================ */

export interface MaterialParams {
  name: string;
  friction?: number;
  densityWeight?: number;
  blastRadius?: number;
  flammability?: number;
  carbonSmokeGen?: number;
  climbRate?: number;
  hangRate?: number;
  flowRate?: number;
  poolingFactor?: number;
  burnDuration?: number;
  evaporationSpeed?: number;
  meltRange?: number;
  bloomWeight?: number;
  corrosiveSpeed?: number;
  particleLife?: number;
  upwardSpread?: number;
  floatSpeed?: number;
  dispersion?: number;
  insulationRating?: number;
  conductivity?: number;
  coagulation?: number;
  viscosity?: number;
  fallChance?: number;
  igniteChance?: number;
}

export interface SpellParams {
  name: string;
  manaCost: number;
  cooldown: number;
  velocityForce?: number;
  explosionRadius?: number;
  fuseTicks?: number;
  range?: number;
  branches?: number;
  pellets?: number;
  damage?: number;
  freezeRadius?: number;
  heat?: number;
  spread?: number;
  radius?: number;
  count?: number;
  baseRadius?: number;
  chargeRate?: number;
  collapseLimit?: number;
}

/**
 * Live-tunable player feel (levitation jet + wand recoil). Player physics was
 * historically hard-coded in Player.ts; these are the dials that now live in
 * config/params.ts so they can be tuned at runtime like the spell table.
 */
export interface PlayerTuning {
  /** Base levitation thrust per frame at spool start (air gravity is 0.28). */
  levitThrust0: number;
  /** Extra thrust added across the t³ spool to reach full power. */
  levitThrustGain: number;
  /** Frames to wind the levitation spool from a tap to full thrust. */
  levitRampFrames: number;
  /** Per-frame vy multiplier WHILE levitating — makes climb speed asymptote to
   *  a terminal value instead of accumulating into the hard cap, and damps fall-catch. */
  levitDrag: number;
  /** Hard upward (negative) vy clamp; safety net only. Must stay ≤ the -3.7 jump impulse. */
  vyCapUp: number;
  /** Horizontal accel/max-run multiplier WHILE levitating — flight has its own
   *  legs, deliberately decoupled from the ground-speed buffs (Swift potion /
   *  Swift Soles). The hook for future levitation enhancement cards. */
  levitHorizControl: number;
  /** Per-frame horizontal velocity retention while airborne/levitating (1 = no
   *  drag / frictionless glide, lower = quicker stop). Gives flight inertia:
   *  carried run momentum bleeds off gradually instead of snapping to a halt. */
  airDrag: number;
  /** Flat recoil momentum floor so hitscan/stream casts still nudge. */
  recoilBase: number;
  /** Muzzle-momentum → impulse (cells/frame) scale. */
  recoilPerMomentum: number;
  /** Hard cap on a single shot's recoil impulse (no screen-flings). */
  recoilMaxImpulse: number;
  /** Grounded recoil multiplier — friction braces you (airborne is full). */
  recoilGroundDamp: number;
  /** Kick: momentum imparted to a struck body (Δv = impulse/mass — light flies, heavy resists). */
  kickImpulse: number;
  /** Kick reach in cells from the shoulder along the aim. */
  kickRange: number;
  /** Kick cone half-angle (radians) around the aim direction. */
  kickArc: number;
  /** Frames between kicks. */
  kickCooldown: number;
  /** Self-recoil (cells/frame) when the kick lands on something solid — enables kick-jumps. */
  kickSelfRecoil: number;
  /** Contact damage a direct kick deals to an enemy. */
  kickDamage: number;
}

export interface GlobalParams {
  simSpeed: number;
  maxBrightness: number;
  /** Base ambient light level (original top-level `AMBIENT`). */
  ambient: number;
  /** Master multiplier on ALL gore/blood particle counts when an enemy is hit
   *  or killed (1 = shipped, 0 = bloodless, up to 10 = maximum gore). */
  bloodAmount: number;
  /** Per-material gore channels, multiplied on top of bloodAmount so each can be
   *  tuned discretely (the spray is a mix of an enemy's own body material plus a
   *  universal blood spray). Keyed by the spawned cell type; materials outside
   *  these channels (stone debris, ember, nitrogen) ride bloodAmount alone. */
  goreBlood: number; // Cell.Blood — the universal red spray
  goreSlime: number; // Cell.Slime — green viscera
  goreOoze: number; // Cell.Acid + Cell.Toxic — glowing caustic ooze
}

export interface PostFxSettings {
  /** Master post-processing bypass. Off renders the pixel buffer directly. */
  enabled: boolean;
  /**
   * GPU frame composition (perf ticket #8): the FrameComposer terrain loop
   * runs as a fragment shader; sprites draw into a CPU overlay texture.
   * Runtime-flippable for same-session A/B; silently falls back to the CPU
   * path when WebGL2 is unavailable.
   */
  gpuCompose: boolean;
  /** UnrealBloomPass layer: emissive cells, blasts, and hot materials. */
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  /** Multiplier for transient blast-wave bloom surges. */
  bloomKickScale: number;
  /** Final shader layer: lens split, grain, and low-health pulse. */
  lensEnabled: boolean;
  aberration: number;
  aberrationKick: number;
  shakeAberration: number;
  grain: number;
  hurtPulse: number;
  exposure: number;
}

export type RenderBackendMode = 'webgl' | 'webgpu' | 'auto';

export interface RenderSettings {
  /**
   * Requested renderer backend. Phase 2 keeps WebGL as the default; `webgpu`
   * and `auto` are selection/probe flags until the WebGPU backend lands.
   */
  backend: RenderBackendMode;
  /** Request the future WebGPU terrain compose path. Current WebGL compose is still `postFx.gpuCompose`. */
  compose: boolean;
  /** Request the future WebGPU lighting path. CPU lighting remains authoritative until measured. */
  lighting: boolean;
  /** Request the future visual-only GPU particle path. Material particles stay CPU-owned. */
  particles: boolean;
  /** Request the future WebGPU/TSL post-processing path. Current WebGL post stays under `postFx`. */
  post: boolean;
}

export interface WandLightSettings {
  /** Shadow-casting wand-tip strength before flicker is applied. */
  intensity: number;
  /** Normal wand-tip reach in world cells. */
  radius: number;
  /** Shadow-casting channel multipliers. */
  r: number;
  g: number;
  b: number;
  /** Random flicker amount around 1.0; 0 keeps the light steady. */
  flicker: number;
  /** Faint non-raycast player fill, kept separate to preserve the current look. */
  fillR: number;
  fillG: number;
  fillB: number;
  /** Torchbearer / torch tonic override values. */
  torchIntensity: number;
  torchRadius: number;
  torchMinFlicker: number;
}

export interface BuilderWandLightPreview {
  enabled: boolean;
  x: number;
  y: number;
}

export interface RuntimeInspectionLight {
  x: number;
  y: number;
}

export type BackdropLayerId = 'back' | 'second' | 'third' | 'fourth' | 'front';

export interface BackdropLayerSettings {
  /** Camera multiplier: lower = farther away, higher = closer to the playfield. */
  speed: number;
  /** Per-layer alpha multiplier for art-direction tweaks without re-exporting PNGs. */
  opacity: number;
  /** Source-pixel offset before wrapping. */
  offsetX: number;
  offsetY: number;
  /** Image scale in screen pixels per source pixel. */
  scale: number;
  visible: boolean;
}

export interface BackdropGradeSettings {
  /** Stops relative to exported PNG color; negative darkens, positive brightens. */
  exposure: number;
  /** Additive brightness in normalized RGB space. */
  brightness: number;
  contrast: number;
  /** Display gamma; 1 = authored PNG values. */
  gamma: number;
  saturation: number;
}

export interface BackdropProfile {
  layers: Record<BackdropLayerId, BackdropLayerSettings>;
  grade: BackdropGradeSettings;
}

export interface BackdropLevelProfile extends BackdropProfile {
  /** False or missing = inherit the global profile. */
  enabled: boolean;
}

export interface BackdropSettings extends BackdropProfile {
  levels: Partial<Record<string, BackdropLevelProfile>>;
}

export interface GameParams {
  global: GlobalParams;
  backdrop: BackdropSettings;
  materials: Record<number, MaterialParams>;
  spells: Record<SpellId, SpellParams>;
  player: PlayerTuning;
}

export type BiomeCrown = 'moss' | 'frost' | 'ember';

export interface BiomeDef {
  name: string;
  /** Four rock material color bands [r, g, b]. */
  bands: [number, number, number][];
  crown: BiomeCrown;
  flowerChance: number;
  pools: number;
  poolElement: () => Cell;
  seedsOilBias: number;
  beams: number;
  fires: number;
  /** Fraction of world height flooded with standing water (0 = none). */
  flood: number;
  iceClusters: number;
}

export type BiomeId =
  | 'earthen'
  | 'frozen'
  | 'flooded'
  | 'timber'
  | 'scorched'
  | 'fungal'
  | 'crystal'
  | 'volcanic'
  // the secret branch biome (the Gilded Vault) — never on the descent spine
  | 'gilded';

/* ============================================================
 * Shared mutable game state
 * ============================================================ */

export type GameMode = 'build' | 'play';
export type InputMode = 'element' | 'spell';
export type PlaytestSource = 'builder' | 'sandbox' | 'test';
export type RunMode = 'normal' | 'test';
export type RunWorldSource = 'campaign' | 'campaign-level' | 'virtual-world';
export type RunLoadoutPreset = 'fresh' | 'advanced' | 'review';
export const FLASK_SLOT_COUNT = 4;

export interface FlaskSlotConfig {
  material: number | null;
  count: number;
}

export interface RunTestKitConfig {
  gold?: number;
  maxHp?: number;
  hp?: number;
  maxLevit?: number;
  cards?: CardId[];
  perks?: PerkId[];
  /** Back-compat single-flask setup; maps to slot 0 unless `activeFlaskIndex` selects another slot. */
  flask?: FlaskSlotConfig;
  /** Noita-like potion inventory setup. Empty/null entries clear those slots. */
  flasks?: Array<FlaskSlotConfig | null | undefined>;
  activeFlaskIndex?: number;
}

export interface RunStartConfig {
  /** Normal progression persists; test mode is disposable and never autosaved. */
  mode: RunMode;
  /** Campaign starts/resumes the authored descent; campaign-level jumps to one authored level. */
  worldSource: RunWorldSource;
  /** Used by campaign-level starts and test runs. */
  levelId?: string;
  /** Optional deterministic seed for fresh generated worlds. */
  seed?: number;
  /** Fresh starter kit, an advanced mid-run kit, or the full review kit. */
  loadout?: RunLoadoutPreset;
  /** Optional granular test inventory/progression setup layered after the preset. */
  kit?: RunTestKitConfig;
  /** Normal campaign only: resume local expedition save when one exists. */
  continueSave?: boolean;
}

export interface RunStartResult {
  ok: boolean;
  message: string;
  mode: RunMode;
  worldSource: RunWorldSource;
  levelId?: string | null;
  seed?: number;
  reason?: 'level-invalid' | 'virtual-runtime-unavailable';
}

export interface RunStatus {
  mode: GameMode;
  playtestSource: PlaytestSource | null;
  savedExpedition: boolean;
  autosaveEnabled: boolean;
  autosaveBlockReason: 'not-play' | 'playtest' | 'debug-tainted' | 'dead' | null;
  debugGodMode: boolean;
  expeditionSeed: number | null;
  worldSeed: number;
  level: { id: string; name: string; depth: number } | null;
  player: { x: number; y: number; hp: number; maxHp: number; dead: boolean };
  score: number;
}

export interface GameStateData {
  mode: GameMode;
  score: number;
  frameCount: number;
  activeInputMode: InputMode;
  currentElement: Cell;
  currentSpell: SpellId;
  currentBiome: BiomeId;
  brushSize: number;
  playerSpawned: boolean;
  /** Seed for the current world generation (drives the seeded RNG). */
  worldSeed: number;
  /** Gameplay frozen behind a modal (Sanctum); rendering continues. */
  paused: boolean;
  /** Transient QA mode enabled by the debug console key; never autosaved. */
  debugGodMode: boolean;
  postFx: PostFxSettings;
  render: RenderSettings;
  /** Runtime-tunable wand light defaults shared by Play and Builder preview. */
  wandLight: WandLightSettings;
  /**
   * Builder light preview: authored lights seeded into the live light field
   * while the editor is open (null outside the Builder). Lighting.build
   * reads this in build mode so mood authoring doesn't need a playtest.
   */
  editorLights: AuthoredLight[] | null;
  /** Builder-only cursor light preview that uses the same raycast path as the player wand. */
  builderWandLightPreview: BuilderWandLightPreview;
  /** Runtime-inspector-only selected entity light. Transient, never persisted. */
  runtimeInspectionLight?: RuntimeInspectionLight | null;
  /** Transient source for disposable playtest runtimes. Null for normal Play/Sandbox. */
  playtestSource: PlaytestSource | null;
}

export interface Keys {
  left: boolean;
  right: boolean;
  up: boolean;
  jump: boolean;
  wallJump: boolean;
  down: boolean;
  grab: boolean;
}

export interface InputState {
  keys: Keys;
  /** Cursor position in world-grid coordinates (original mouseGridPosition). */
  mouse: { x: number; y: number };
  isDrawing: boolean;
  lastX: number | null;
  lastY: number | null;
  /** True while the mouse is held with a spell selected in build mode. */
  buildSpellHeld: boolean;
  /** -1 idle; 0..1 while charging a bomb throw. */
  bombCharge: number;
  /** The charging black-hole projectile (aliased into ctx.projectiles), or null. */
  activeChargingBlackHole: Projectile | null;
  /** Held while E is down (play mode): flask siphons cells at the cursor. */
  siphonHeld: boolean;
  /** Held while Q is down (play mode): flask pours its contents at the wand tip. */
  pourHeld: boolean;
  /** Held while X is down (play mode): drink the flask's contents. */
  drinkHeld: boolean;
  /** Release all held gameplay inputs through the owning input manager. */
  releaseHeldInput?: () => void;
}

export interface FxState {
  /** Transient bloom surge after detonations; decays *= 0.86 per frame. */
  bloomKick: number;
  /** Camera shake magnitude; decays *= 0.88 per frame. */
  screenShake: number;
  digBeam: DigBeam | null;
  /** Frames of gameplay freeze remaining (impact hitstop); rendering continues. */
  hitstop: number;
}

export interface WaveState {
  num: number;
  active: boolean;
  intermission: number;
  kills: number;
}

/* ============================================================
 * Service APIs (implemented by systems, wired by Game)
 * ============================================================ */

export interface AudioApi {
  readonly enabled: boolean;
  /** Create/resume the AudioContext. Must be called from a user gesture. */
  ensure(): void;
  /** Flip sound on/off; returns the new enabled state. */
  toggle(): boolean;
  tone(freq: number, endFreq: number, dur: number, type: OscillatorType, vol: number): void;
  noiseBurst(dur: number, filterFreq: number, vol: number, highpass?: boolean): void;
  boom(size: number): void;
  zap(): void;
  lightning(): void;
  /** Low resonant impact: a thin wall with open space behind it. */
  hollowKnock(): void;
  /** Cauldron simmer blub. */
  bubble(): void;
  /** Glass/ice breaking: bright crack + falling ring. */
  shatter(): void;
  /** Small treasure chime (gold piles, generic pickups). */
  pickup(): void;
  /** Chest-opening three-note arpeggio. */
  chest(): void;
  /** The golden key's bright jingle. */
  keyJingle(): void;
  /** Portal activation whoosh (dual rising sines). */
  portalWhoosh(): void;
  /** Four-note fanfare: a new spell tome is learned. */
  learn(): void;
  /** Potion gulp: three descending sweeps. */
  drinkPotion(): void;
  /** Lever clack (two square clicks). */
  lever(): void;
  /** Heavy metal door grinding open or shut. */
  doorGrind(): void;
  /** A brazier catching: whoosh + rising triangle. */
  brazier(): void;
  /** A broken mechanism groaning before its gate falls open. */
  groan(): void;
  /** Tiny cave-life chirp (crickets, moths near the lamp). */
  chirp(): void;
  /** A beetle's dry tick-tick skitter. */
  skitter(): void;
  /** A single water drop falling from the ceiling into a pool. */
  drip(): void;
  /** Hollow click: the wand asked for mana the tank doesn't have. */
  dryFire(): void;
  /** Quick whick of drawing the other wand. */
  wandSwap(): void;
  /** Levitation running on fumes: a coughing put-put. */
  sputter(): void;
  /** Two low thumps — the alchemist's own heart, near the end. */
  heartbeat(): void;
  /** Paper snick: a spell card picked up at the bench. */
  cardPick(): void;
  /** Firm clack: a card seated into a wand slot. */
  cardSlot(): void;
  /** Material-aware footfall (stride-driven, very quiet). */
  footstep(surface: 'stone' | 'soft' | 'wet' | 'wood'): void;
  /** Soft cloth shuffle of the crawl (stride-driven, quieter than footsteps). */
  crawlShuffle(): void;
  /** Hat bumping a low ceiling: muffled thud (the cramped "no" of the world). */
  crampedBump(): void;
  /** Landing thud scaled by fall hardness (0..1). */
  landThud(intensity: number): void;
  /** Breaking the surface of a pool (0..1 by entry speed). */
  splash(intensity: number): void;
  /** A foe notices you: one short rising blip. */
  alert(): void;
  /** Waystone ignition: a deep bronze gong with overtones. */
  gong(): void;
  coin(): void;
  hurt(): void;
  jump(): void;
  squelch(): void;
  flame(): void;
  dig(): void;
  waveHorn(): void;
  levitate(): void;
  implode(): void;
}

export interface ParticlesApi {
  readonly list: readonly FlyingParticle[];
  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    type: number | null,
    color: number,
    life: number,
    opts?: ParticleOpts,
  ): void;
  burst(
    cx: number,
    cy: number,
    count: number,
    type: number | null,
    colorFn: () => number,
    speed: number,
    opts?: ParticleOpts,
  ): void;
  update(ctx: Ctx): void;
  clear(): void;
}

export interface ExplosionApi {
  trigger(cx: number, cy: number, radius: number, options?: { enemyDamageMul?: number }): void;
}

export interface LightningApi {
  readonly arcs: LightningArc[];
  cast(ox: number, oy: number, angle: number): void;
  update(): void;
  clear(): void;
}

export interface ProjectilesApi {
  update(ctx: Ctx): void;
}

export interface PhysicsApi {
  /** True if the solid cell at (x, y) belongs to a 5+ connected cluster (metal always blocks). */
  cellBlocks(x: number, y: number): boolean;
  /** AABB clearance test: halfW cells each side, h cells tall, anchored at the feet. */
  entityFree(cx: number, cy: number, halfW: number, h: number): boolean;
  crushLooseDebris(ent: { x: number; y: number }, halfW: number, h: number): void;
  /** Move one cell horizontally (with optional stepUp ledge climb) or vertically. */
  tryMoveEntity(
    ent: { x: number; y: number },
    dx: number,
    dy: number,
    halfW: number,
    h: number,
    stepUp: number,
  ): boolean;
}

export type RigidBodyKind = 'dynamic' | 'kinematic';

/** Body geometry. Box uses half-extents; circle uses a radius (cells). */
export type RigidShape =
  | { kind: 'box'; halfW: number; halfH: number }
  | { kind: 'circle'; radius: number };

/** What a rigid body is made of — drives density (mass + float/sink), colour,
 *  flammability, and conductivity. Registry: entities/bodyMaterials.ts. */
export type BodyMaterial = 'wood' | 'metal' | 'stone';

/**
 * A rigid body in the physics layer (backed by Rapier2D). Boxes and circles
 * collide with the cave, each other, and receive impulses; the solver handles
 * rotation, rolling, tumbling, stacking, bounce and friction. Terrain is fed to
 * Rapier as small per-body colliders generated from the live cell grid, so no
 * whole-cave polygonisation is needed.
 *
 * The numeric fields are a READ-ONLY MIRROR of the Rapier body, refreshed each
 * tick for the renderer / console / debug. To move or push a body, go through
 * RigidBodiesApi (spawn opts / applyImpulse) — never by writing these directly.
 *
 * `x`/`y` are the CENTRE OF MASS in world cells; `angle` radians; `vx/vy`
 * cells/frame; `va` rad/frame.
 */
export interface RigidBody {
  readonly id: number;
  kind: RigidBodyKind;
  shape: RigidShape;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  va: number;
  /** Inverse mass / inverse rotational inertia used by the current local solver. */
  invMass?: number;
  invInertia?: number;
  /** Bounce on impact (0 = dead stop, 1 = elastic) — set at spawn. */
  restitution: number;
  /** Coulomb friction coefficient — set at spawn. */
  friction: number;
  /** Packed 0xRRGGBB fill colour for the default renderer. */
  color: number;
  /** What it's made of (drives mass/buoyancy/flammability/conduction). */
  material?: BodyMaterial;
  /** Density vs water (=1) — drives buoyancy (P5: <1 floats, >1 sinks). */
  density?: number;
  /** P5: true while the body's footprint overlaps water (splash-on-entry edge). */
  inWater?: boolean;
  grounded?: boolean;
  /** Mirror of Rapier's sleep state (settled bodies sleep). */
  sleeping: boolean;
  restT?: number;
  /** P2 reaction: frames left on fire (flammable bodies burn up to ash); 0/undefined = not burning. */
  burnT?: number;
  /** P2 reaction: frames left frozen (frost dampens its velocity); 0/undefined = not frozen. */
  frozenT?: number;
  tag?: string;
  data?: Record<string, unknown>;
  /** Fired on a hard terrain impact; `speed` is the pre-impact contact speed. */
  onTerrainHit?: (body: RigidBody, speed: number) => void;
}

export interface SpawnBodyOpts {
  kind?: RigidBodyKind;
  vx?: number;
  vy?: number;
  angle?: number;
  va?: number;
  /** What it's made of — sets density + default colour (explicit density/color win). */
  material?: BodyMaterial;
  /** Mass/inertia derive from shape area × density (default 1). */
  density?: number;
  restitution?: number;
  friction?: number;
  color?: number;
  tag?: string;
  data?: Record<string, unknown>;
  onTerrainHit?: (body: RigidBody, speed: number) => void;
}

export interface RigidBodiesApi {
  /** Live list — mutated in place, never reassigned (entity-array invariant). */
  readonly bodies: RigidBody[];
  spawn(shape: RigidShape, x: number, y: number, opts?: SpawnBodyOpts): RigidBody;
  remove(body: RigidBody): void;
  clear(): void;
  update(ctx: Ctx): void;
  /** Wake the body and add a VELOCITY kick (cells/frame) at the centre of mass —
   *  mass-independent by design (matches explosion/knockback tuning). NOTE for a
   *  future Rapier backend: these are velocity deltas, not force·mass⁻¹ impulses,
   *  so multiply by the body's mass before calling Rapier's applyImpulse. */
  applyImpulse(body: RigidBody, ix: number, iy: number): void;
  /** Velocity kick at a world point — adds the linear delta AND the spin its
   *  lever arm implies, so an off-centre shove also rotates the body. */
  applyImpulseAt(body: RigidBody, ix: number, iy: number, px: number, py: number): void;
  /** MASS-AWARE impulse at a world point: (mx,my) is a true impulse (momentum),
   *  so Δv = impulse/mass — a heavy crate resists, a light one flies. Use for
   *  bullet/kick hits where material weight should matter (cf. applyImpulseAt,
   *  a mass-independent velocity kick). Off-centre → also spins. */
  applyMomentumAt(body: RigidBody, mx: number, my: number, px: number, py: number): void;
  /** Push every body within `radius` away from (cx,cy), scaled by linear falloff. */
  applyRadialImpulse(cx: number, cy: number, radius: number, strength: number): void;
  /** The dynamic body whose shape contains world point (x,y) (small grace
   *  margin), or null. Used by projectiles to detect a body strike. */
  hitTest(x: number, y: number): RigidBody | null;
  /** Grab the nearest light body in front of the player (held = tracks the hand
   *  point each frame). No-op if already holding or nothing's in reach. */
  grab(ctx: Ctx): void;
  /** Throw the held body along the aim (carrying the player's momentum), or no-op. */
  release(ctx: Ctx): void;
}

export interface VineStrandNodeView {
  readonly x: number;
  readonly y: number;
}

export interface VineStrandSegmentView {
  readonly a: number;
  readonly b: number;
}

export interface VineStrandView {
  readonly nodes: readonly VineStrandNodeView[];
  readonly segments: readonly VineStrandSegmentView[];
  readonly color: number;
  /** Render width in cells (1 = a thin strand; >1 = a thick rope/vine). */
  readonly thickness?: number;
}

export interface VineStrandsApi {
  /** Detached + persistent vine strands; render-only mirror, mutated in place. */
  readonly strands: readonly VineStrandView[];
  /** Convert a disconnected vine component in the cell grid into a soft strand. */
  detachCluster(x: number, y: number): boolean;
  /** Add a PERSISTENT strand pinned at (x,y) hanging `length` cells down — a rope
   *  or thick vine that sways, collides, and reacts to the player (never settles). */
  addHanging(x: number, y: number, length: number, opts?: { thickness?: number; color?: number }): void;
  update(ctx: Ctx): void;
  clear(): void;
  applyRadialImpulse(cx: number, cy: number, radius: number, strength: number): void;
  /** Latch the nearest hanging vine near (px,py) for a swing — returns its pivot
   *  (anchor) + rope length, or null. Marks the strand taut to the grab point. */
  grabSwing(px: number, py: number, maxDist: number): { anchorX: number; anchorY: number; length: number } | null;
  /** Move the grabbed strand's hand point (drives the taut rope visual). */
  driveSwing(px: number, py: number): void;
  /** Let go of any grabbed strand (it returns to free Verlet sway). */
  releaseSwing(): void;
}

export interface PlayerControlApi {
  /** src tags ('explosion' | 'fire' | 'acid' | 'toxic' | 'impact') drive boon resistances. */
  damage(amount: number, kx: number, ky: number, src?: string): void;
  /** Add a velocity impulse (cells/frame) to the player. Stoneskin shrugs it off.
   *  The shared verb for explosions, knockback, and rigid-body pushes. */
  applyImpulse(vx: number, vy: number): void;
  /** Melee kick toward the aim: shoves bodies (mass-aware) + enemies in a short
   *  cone, with self-recoil off solid hits (kick-jump). Gated by a cooldown. */
  kick(ctx: Ctx): void;
  /** Latch onto the nearest hanging vine for a pendulum swing; true if latched. */
  grabVine(ctx: Ctx): boolean;
  /** Let go of a vine swing (keeps the launch velocity). */
  releaseVine(ctx: Ctx): void;
  kill(): void;
  respawn(): void;
  findSpawnPoint(): { x: number; y: number };
  update(ctx: Ctx): void;
}

export interface EnemyControlApi {
  readonly defs: Record<EnemyKind, EnemyDef>;
  spawn(kind: EnemyKind, x: number, y: number): void;
  damage(e: Enemy, amount: number, kx: number, ky: number): void;
  kill(e: Enemy, kx: number, ky: number): void;
  update(ctx: Ctx): void;
}

export interface SpellsApi {
  /** Wand muzzle: 9 cells along aimAngle from the shoulder (player.y - 9
   *  standing, player.y - 4 while crawling — the prone cast is a low muzzle). */
  wandTip(): { x: number; y: number };
  digRay(ox: number, oy: number, angle: number, range: number): { x: number; y: number } | null;
  erodeAt(cx: number, cy: number, rad: number): void;
  /** Teleport the player back along the warp bolt's path; returns success. */
  executeWarp(p: Projectile): boolean;
  /** Play-mode per-frame casting dispatch (called while player.firing). */
  firePlayerSpell(): void;
  /** Build-mode one-shot cast toward a world-grid target. */
  castBuildSpell(type: SpellId, targetX: number, targetY: number): void;
  emitBuildFlame(): void;
}

export interface CameraApi {
  x: number;
  y: number;
  tx: number;
  ty: number;
  zoom: number;
  /** Runtime inspector/debug focus target; when set in Play, camera follows this instead of the player. */
  inspectionFocus: { x: number; y: number } | null;
  /** Editor zoom override: when set, zoom lerps here instead of idle-zoom. */
  zoomLock: number | null;
  idleFrames: number;
  /** Integer camera snapshot used for the current frame's texture (set by the renderer). */
  renderX: number;
  renderY: number;
  update(ctx: Ctx): void;
  /** Derive world.simBounds from the camera position (+/- SIM_MARGIN). */
  updateSimBounds(world: World): void;
  /** Hold the Play camera on a runtime/debug inspection target. */
  setInspectionFocus(x: number, y: number, options?: { snap?: boolean }): void;
  /** Return Play camera targeting to normal player follow. */
  clearInspectionFocus(): void;
  /** Hard-snap camera + render snapshot to center on a world position. */
  snapTo(x: number, y: number): void;
}

export interface SimulationApi {
  accumulator: number;
  /** Fixed-step accumulator: runs 0-6 processFrame substeps per render frame. */
  update(ctx: Ctx): void;
  processFrame(ctx: Ctx): void;
}

export interface WorldGenApi {
  spawnHint: { x: number; y: number } | null;
  /** Last terrain paint seed consumed by generateCaves; Builder documents use it to restore biome colors. */
  paintSeed: number | null;
  generateCaves(ctx: Ctx): void;
  /** generateCaves + snap camera onto the spawn hint. */
  regenerate(ctx: Ctx): void;
  spawnFortress(ctx: Ctx): void;
  /**
   * Descent-mode generation into ctx.world (the caller swaps the level's World
   * in first): runs generateCaves for the level's biome with the given seed,
   * then dresses the level — bedrock floor, sealed exit well, waystone braziers.
   */
  generateLevel(
    ctx: Ctx,
    def: LevelDef,
    seed: number,
    opts?: {
      /** This level hosts the hidden gilded arch to the vault branch
       *  (decided by Levels from the expedition seed — deterministic, so
       *  save-resume's pristine regeneration reproduces it). */
      hostArch?: boolean;
    },
  ): {
    exit: LevelExitWell;
    waystones: Waystone[];
    spawn: { x: number; y: number };
    cauldron: { x: number; y: number } | null;
    pickups: Pickup[];
    portal: ExitPortal | null;
    mechanisms: Mechanism[];
    runeVaults: RuneVault[];
    boss: { x: number; y: number; kind?: EnemyKind } | null;
    /** The gilded arch (two-way branch gate) if this level carries one;
     *  back* is the safe arrival spot for travelers stepping OUT of it. */
    vaultArch: VaultArch | null;
    /** Branch-level hoard center — createLevel posts the elite guards here. */
    vaultHoard: { x: number; y: number } | null;
    /** D1 teaching alcove with real-cell stations and a checked reward. */
    spellLab: { x: number; y: number; rewardX: number; rewardY: number } | null;
    /** Deferred prefab enemies — createLevel spawns them; restoreLevel
     *  IGNORES them (the saved blob's roster is the truth). */
    prefabEnemies: PrefabEnemy[];
    /** Footprints of the authored prefabs stamped into this level. */
    placedPrefabs: PlacedPrefab[];
    /** Prefab-authored lights / hazard emitters for the runtime. */
    authoredLights: AuthoredLight[];
    emitters: HazardEmitter[];
    /** Prefab-authored animated decor (visual-only). */
    decors: RuntimeDecor[];
    /** The Refuge's offering shrine (E opens the Sanctum shop), if hewn. */
    refuge: { x: number; y: number } | null;
  };
}

/**
 * Builder/prefab hazard emitter spec: drips `burst` real cells of `cell`
 * every `rate` frames (staggered by `phase`), one step along `dir` from its
 * anchor. `dir` comes from the editor object's rotation: 0=down (default),
 * 90=left, 180=up, 270=right.
 */
export interface HazardEmitter {
  x: number;
  y: number;
  cell: number;
  rate: number;
  dir: 0 | 90 | 180 | 270;
  burst: number;
  phase: number;
}

export interface WaveDirectorApi {
  start(n: number): void;
  update(ctx: Ctx): void;
}

/* ============================================================
 * Wave A expansion systems
 * ============================================================ */

export interface FlaskState {
  /** Cell type currently stored, or null when empty. */
  material: number | null;
  /** Cells stored (0..capacity). */
  count: number;
  capacity: number;
}

export interface FlaskBottleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  material: number | null;
  count: number;
}

/**
 * The Material Flask: siphon real cells out of the world, carry them,
 * pour them back, or throw the bottle. Nothing is abstracted — stored
 * material keeps its identity (a flask of blood is a portable conductor).
 */
export interface FlaskApi {
  /** Active flask. Existing callers use this as "the held potion". */
  readonly state: FlaskState;
  /** Item-belt potion slots. Slot contents mutate in place. */
  readonly slots: readonly FlaskState[];
  readonly activeIndex: number;
  selectSlot(index: number): boolean;
  setSlot(index: number, material: number | null, count: number): void;
  clearSlots(): void;
  /** Per-frame: handles siphon/pour holds and any in-flight thrown bottle. */
  update(ctx: Ctx): void;
  /** Lob the bottle toward the cursor; shatters on impact, releasing the cells. */
  throwFlask(ctx: Ctx): void;
  /** Cancel any in-flight thrown bottle without changing inventory slots. */
  cancelBottle(): void;
  /** Save/load support for an in-flight thrown bottle. */
  restoreBottle(bottle: FlaskBottleState | null): void;
  /** Read-only visual position for the currently thrown bottle. */
  bottleView(): FlaskBottleState | null;
}

/** Local gameplay counters (deaths by cause, material usage, ...). */
export interface TelemetryApi {
  count(key: string, n?: number): void;
  all(): Record<string, number>;
}

/* ============================================================
 * Developer console command surface
 * ============================================================ */

export interface CommandResult {
  ok: boolean;
  /** Human-readable line for the overlay log. */
  text: string;
  /** Structured facts for probes and scripts. */
  data?: unknown;
}

export interface CommandInfo {
  id: string;
  label: string;
  category: 'console' | 'game' | 'builder' | 'workspace';
  usage: string;
  description: string;
  shortcut?: string;
  enabled: boolean;
}

export interface ConsoleApi {
  exec(line: string): Promise<CommandResult>;
  complete(partial: string): string[];
  list(): CommandInfo[];
}

export interface PerfApi {
  readonly visible: boolean;
  setVisible(visible: boolean): boolean;
  toggle(): boolean;
}

/* ============================================================
 * Upgrade port: mechanisms, pickups, portal progression, sanctum
 * ============================================================ */

export type MechanismKind =
  | 'door'
  | 'plate'
  | 'lever'
  | 'brazier'
  // Wave E sensors — each reads raw cells, so emergent solutions always count
  | 'scale' // PRESSURE: enough material weight in the pan zone
  | 'buoy' // BUOY: enough liquid cells pooled in the basin zone
  | 'chargelatch' // CHARGE-LATCH: any electrified cell in the zone latches it forever
  // Machine primitives (docs/MACHINE-PRIMITIVES-AND-STRUCTURES-PLAN.md).
  // valve/relay are ACTUATORS: they aggregate linked triggers exactly like
  // doors (logic 'and'/'or'/'sequence'); sensor/plug/counterweight are
  // triggers with one output (targetId) like plates and braziers.
  | 'valve' // a small material gate in a channel; a sluice is a wide valve
  | 'plug' // real cells that FIRE once when enough of them are destroyed
  | 'sensor' // generic bounded-zone reader: heat/liquid/weight/charge/material
  | 'counterweight' // weight pan that latches permanently at its threshold
  | 'relay' // one-shot event handoff: inputs satisfied -> delay -> fire
  | 'dispenser'; // ACTUATOR: while its triggers fire, emits rigid bodies (cooldown + max-active cap)

/**
 * A placed contraption. Doors are real Metal-cell spans that retract row by
 * row; plates/levers/braziers drive the door whose id matches targetId.
 * Plates read raw cell weight + entities; braziers read real Fire cells;
 * levers flip from concussion (structureStrike) or projectile hits.
 */
export interface Mechanism {
  id: number;
  kind: MechanismKind;
  x: number;
  y: number;
  /** Door/plate width in cells (doors also use h). */
  w: number;
  h: number;
  /**
   * door: open 0/1 · lever: on 0/1 · brazier/chargelatch: lit/latched 0/1 ·
   * plate/scale/buoy: latch frames left.
   */
  state: number;
  /**
   * Door trigger aggregation (Builder-authored; generated levels leave it
   * unset = 'and'). 'or': any trigger opens. 'sequence': triggers must fire
   * in link order — wrong order resets, completion latches the door open.
   */
  logic?: 'and' | 'or' | 'sequence';
  /** sequence doors: DERIVED cursor (first unfired chain step), for HUD/probes. */
  seq?: number;
  seqDone?: boolean;
  /** sequence doors: per-trigger edge memory (keyed by trigger id) so only
   *  NEW activations advance/reset the chain — lingering latches don't. */
  seqPrev?: Record<number, boolean>;
  /** sequence doors: completion BY IDENTITY (trigger id -> fired), so a
   *  wrecked already-fired trigger collapses its slot instead of stranding
   *  an index-based cursor past the end of the shortened chain. */
  seqFired?: Record<number, boolean>;
  /** Plate weight currently on the sill (transient, not persisted semantics). */
  pressed?: boolean;
  /** Lever: frames left of the hand-pull animation; flips when it hits 0. */
  pullT?: number;
  /** Door: remaining cells of the opening retraction (cleared a few per
   *  frame, bottom row first, like a gate sliding up into the frame). */
  dissolve?: Array<[number, number]>;
  /** door/valve: a safe close skipped occupied cells and must retry. */
  closePending?: boolean;
  /** Door id driven by this trigger; -1 for doors themselves / unlinked.
   *  A door with SEVERAL triggers opens only when ALL are satisfied. */
  targetId: number;
  /** scale/buoy trigger threshold (cells of weight / pooled liquid). */
  threshold?: number;
  /** Sensor read region (inclusive), world cells. */
  zone?: { x0: number; y0: number; x1: number; y1: number };
  /** Live sensor reading (weight / liquid count), for the HUD gauge. */
  reading?: number;
  /**
   * Fail-open rule: structural cells recorded at construction. When most are
   * destroyed the mechanism breaks, groans, and its gate falls open 30s later.
   * broken = frames left on the groan timer (0 = gate forced open forever).
   * Plugs are EXEMPT: their body being destroyed is their job (they fire).
   */
  body?: Array<[number, number]>;
  broken?: number;
  /* ---- machine primitives (all optional: old saves stay valid) ---- */
  /** valve: cell type stamped when closed (default Metal); plug: the
   *  recorded body material (default Stone). */
  material?: number;
  /** valve: stays open once fired. */
  oneShot?: boolean;
  /** valve: force-close N frames after opening; reopens only on a fresh
   *  rising edge of its trigger aggregate (ignored when oneShot). */
  autoCloseFrames?: number;
  /** valve: auto-close countdown while open (transient, serializable). */
  closeT?: number;
  /** valve: last frame's trigger aggregate (rising-edge memory). */
  prevWant?: boolean;
  /** plug: fraction of body cells gone/transformed that fires it (0.5). */
  breakFrac?: number;
  /** sensor: what the zone reads. */
  sensorType?: 'heat' | 'liquid' | 'weight' | 'charge' | 'material';
  /** sensor 'material': cell ids that count toward the reading. */
  materialFilter?: number[];
  /** sensor: how a satisfied reading latches (default 'timed'). */
  latch?: 'momentary' | 'timed' | 'permanent';
  /** sensor 'timed': frames held after the reading passes (default 420). */
  latchFrames?: number;
  /** relay: frames between inputs-satisfied and firing (default 0). */
  delayFrames?: number;
  /** relay: live fuse countdown once armed (undefined = not armed). */
  fuseT?: number;
  /** relay: world effect at its target on fire (default 'activate'). */
  outputAction?: 'activate' | 'ignite' | 'break' | 'strike';
  /** dispenser: frames between emissions while triggered. */
  dispCooldown?: number;
  /** dispenser: max bodies kept alive (oldest despawned past this). */
  dispMax?: number;
  /** dispenser: emission cooldown countdown (transient). */
  dispCoolT?: number;
  /** dispenser: the live bodies it has emitted, oldest first (transient, not persisted). */
  dispBodies?: RigidBody[];
}

/**
 * A sealed metal strongroom whose stone door dissolves when its distant rune
 * glyph is struck by any blast, projectile, or dig beam.
 */
export interface RuneVault {
  /** The floating rune glyph (strike target), world coords. */
  rx: number;
  ry: number;
  /** Remaining stone door cells, dissolved bottom-up a few per frame. */
  door: Array<[number, number]>;
  active: boolean;
}

export type PickupKind = 'goldpile' | 'heart' | 'tome' | 'chest' | 'potion' | 'key';

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  taken: boolean;
  /** tome: card seed/unique grant; potion: POTION_DEFS key; goldpile/chest: amount. */
  data: { card?: CardId; potion?: string; amount?: number; offerPending?: boolean };
}

/** The level's exit gate: opens when the golden key is brought to it. */
export interface ExitPortal {
  x: number;
  y: number;
  open: boolean;
}

/** One-time boons drafted in the Sanctum between depths. */
export type PerkId =
  | 'might'
  | 'vampirism'
  | 'featherweight'
  | 'manafont'
  | 'swiftfoot'
  | 'torchbearer'
  | 'ironhide'
  | 'flameward'
  | 'toxinward'
  | 'goldmagnet';

export interface MechanismsApi {
  /** Plate/brazier/door physics + rune-vault dissolution each frame (play mode). */
  update(ctx: Ctx): void;
  /** Concussive strike test against levers + rune glyphs. */
  strike(ctx: Ctx, x: number, y: number, radius: number): void;
  /** E-key interaction: flip the nearest lever within reach; true if one flipped. */
  interact(ctx: Ctx): boolean;
}

export interface PickupsApi {
  /** Bobbing, gravity, magnet-to-player, collection effects. */
  update(ctx: Ctx): void;
}

export interface SanctumApi {
  readonly isOpen: boolean;
  /** Open the between-depths pause: perk draft + shop. onDescend fires on close. */
  open(ctx: Ctx, onDescend: () => void): void;
  /** Open the SHOP alone (the Refuge shrine's trade) — closing just resumes. */
  openShop(ctx: Ctx): void;
}

/* ============================================================
 * Wave D: Wandsmith — frames, cards, and the cast compiler
 * ============================================================ */

export type CardId =
  // projectile cards (the legacy spells reborn)
  | 'spark'
  | 'bomb'
  | 'lightning'
  | 'flame'
  | 'dig'
  | 'warp'
  | 'blackhole'
  // upgrade-port payload cards
  | 'vitriol'
  | 'frostshard'
  | 'icelance'
  | 'wisp'
  | 'meteor'
  | 'conjure'
  | 'emberstorm'
  // the Gilded Vault's unique prize (never in a grant pool)
  | 'vitrify'
  // modifier / multicast cards
  | 'double'
  | 'triple'
  | 'speed'
  | 'heavy'
  | 'spread'
  | 'infuser'
  | 'watertrail'
  | 'oiltrail'
  | 'electriccharge'
  | 'critwet'
  | 'shorthoming'
  | 'trigger'
  | 'bounce';

export type CardKind = 'projectile' | 'modifier' | 'multicast';
export type CardTag = 'Damage' | 'Terrain' | 'Setup' | 'Trail' | 'Status' | 'Combo' | 'Movement' | 'Risk';

export interface CastAction {
  card: CardId;
  speedMul: number;
  dmgMul: number;
  /** Extra aim jitter amplitude in radians (added to the frame's spread). */
  spreadAdd: number;
  /** Trail the flask's stored material while flying. */
  infused: boolean;
  /** Fixed low-budget Water Trail cells remaining for review-only setup cards. */
  waterTrail: number;
  /** Fixed low-budget Oil Wick cells remaining for review-only setup cards. */
  oilTrail: number;
  /** Electrify struck targets and nearby conductor cells. */
  electricCharge: boolean;
  /** Conditional crit if the struck enemy is wet or touching water. */
  critWet: boolean;
  /** Short-range homing correction for normal projectile bodies. */
  shortHoming: boolean;
  /** Terrain bounces remaining before the projectile detonates. */
  bounces: number;
  /** Cast at the impact point (depth-1 trigger payload), or null. */
  triggered: CastAction[] | null;
}

export interface CastActionExecutionContext {
  origin: 'wand' | 'trigger';
  /** Cursor-target cards use this target instead of the live mouse position. */
  target?: { x: number; y: number };
  /** Trigger payloads inherit the carrier projectile's source wand spread. */
  sourceSpread?: number;
}

export interface CardDef {
  id: CardId;
  name: string;
  kind: CardKind;
  tags: CardTag[];
  /** Added to the frame's per-cast mana drain. */
  manaCost: number;
  /** One-line bench tooltip. */
  blurb: string;
}

export interface WandFrame {
  id: string;
  name: string;
  /** Card slots. */
  capacity: number;
  /** Frames between casts within a cycle. */
  castDelay: number;
  /** Frames after the full card cycle completes. */
  recharge: number;
  manaMax: number;
  manaRegen: number;
  /** Base aim jitter in radians. */
  spread: number;
}

export interface WandState {
  frame: WandFrame;
  /** Slotted cards, length === frame.capacity (null = empty slot). */
  cards: (CardId | null)[];
  mana: number;
  /** Frames until the next cast group may fire. */
  cooldown: number;
  /** Pointer into the compiled program (wraps + triggers recharge). */
  castIndex: number;
  /** What `cooldown` started from on the last cast (HUD recharge bar). */
  cooldownMax?: number;
}

/**
 * The wand system replaces the fixed 7-spell loadout in PLAY mode (build-mode
 * sandbox spells are untouched). Compiler rules: cards execute left-to-right;
 * modifiers attach to the next projectile card; multicasts group the following
 * N projectiles into one cast; total damage multiplier clamps at x4 and
 * projectiles-per-cast at 6; 'trigger' nests at most one level deep.
 */
export interface WandsApi {
  readonly wands: [WandState, WandState];
  active: 0 | 1;
  /** Owned cards not currently slotted in either wand. */
  readonly collection: CardId[];
  /** Per-frame while player.firing (play mode): advance + cast the program. */
  fire(ctx: Ctx): void;
  /** Per-frame always: cooldowns, recharge, wand mana regen. */
  update(ctx: Ctx): void;
  grantCard(ctx: Ctx, id: CardId): void;
  /** Move a card between collection and a wand slot (bench UI). */
  slotCard(wand: 0 | 1, slot: number, id: CardId | null): void;
  /** Drag/drop bench support: place a specific collection index into a slot. */
  slotCollectionCard(collectionIndex: number, wand: 0 | 1, slot: number): void;
  /** Drag/drop bench support: swap or move slotted cards without touching collection order. */
  swapSlots(sourceWand: 0 | 1, sourceSlot: number, targetWand: 0 | 1, targetSlot: number): void;
  /** Drag/drop bench support: return a slotted card to the collection. */
  moveSlotToCollection(wand: 0 | 1, slot: number, collectionIndex?: number): void;
  /** Invalidate cached spell programs after tooling restores wand state in place. */
  invalidatePrograms(): void;
  /** Save-game support: capture / restore the full wand loadout. */
  snapshotLoadout(): WandLoadoutSave;
  loadLoadout(data: WandLoadoutSave): void;
  /** Disposable playtest support: capture / restore full wand runtime state. */
  snapshotRuntimeState(): WandRuntimeSnapshot;
  restoreRuntimeState(data: WandRuntimeSnapshot): void;
  /** Legacy save migration: mark first-visit depth grants already represented by old loadouts. */
  markDepthGrantsThrough(depth: number): void;
  /** Execute one compiled action at an arbitrary impact point (trigger payloads, tools). */
  castActionAt(ctx: Ctx, action: CastAction, x: number, y: number, angle: number, options?: CastActionExecutionContext): void;
  /** Start-run support: restore the launch starter wands/collection in place. */
  resetLoadout(): void;
  /** QA/debug command: upgrade both wands and expose every card. */
  grantReviewLoadout(): void;
  /**
   * Wandwright progression (Sanctum shop): rebuild a wand around a better
   * frame. Slotted cards are kept, mana refills. False if the frame id is
   * unknown or already equipped on that wand.
   */
  upgradeFrame(ctx: Ctx, wand: 0 | 1, frameId: string): boolean;
  /**
   * Slot indices of the cards the NEXT click will cast (the cast cycle's
   * cursor) — the HUD highlights them so the cycle is visible.
   */
  nextCastSlots(): number[];
}

export interface WandLoadoutSave {
  active: 0 | 1;
  collection: CardId[];
  wands: Array<{ frameId: string; cards: (CardId | null)[]; mana: number }>;
}

export interface WandRuntimeSnapshot {
  active: 0 | 1;
  collection: CardId[];
  wands: Array<{
    frameId: string;
    cards: (CardId | null)[];
    mana: number;
    cooldown: number;
    cooldownMax?: number;
    castIndex: number;
  }>;
  lastDryFire: number;
  flameBurst: number;
  depthsGranted: number[];
  infuserGranted: boolean;
}

/* ============================================================
 * Wave C: region graph — the placement brain
 * ============================================================ */

export interface Region {
  id: number;
  /** Open area in downsampled cells (1:4). */
  area: number;
  /** Centroid in WORLD coordinates. */
  cx: number;
  cy: number;
  onMainPath: boolean;
  /** Small enclosed pocket not on the main path (natural secret candidate). */
  isPocket: boolean;
}

export interface RegionEdge {
  a: number;
  b: number;
  /** Minimum separating wall thickness in WORLD cells (breachability). */
  minWallThickness: number;
  /** Midpoint of the thinnest separating wall, world coords. */
  mx: number;
  my: number;
}

/** Flood-fill analysis of a generated level at 1:4 downsample. */
export interface RegionGraph {
  scale: 4;
  w: number;
  h: number;
  /** Region id per downsampled cell, -1 = solid. */
  labels: Int32Array;
  regions: Region[];
  edges: RegionEdge[];
  /** Region ids along the BFS path spawn -> exit well. */
  mainPath: number[];
  spawnRegion: number;
  exitRegion: number;
}

/* ============================================================
 * Wave B: the Descent — depth graph of persistent levels
 * ============================================================ */

export interface LevelDef {
  id: string;
  name: string;
  biome: BiomeId;
  /** 1-based descent depth; scales enemy population. */
  depth: number;
  /** Level reached by breaking this level's floor well, or null for the last floor. */
  nextLevelId: string | null;
  /**
   * A branch level hangs OFF the descent spine: it is entered through a
   * hidden gilded arch in its host level and its own arch returns to that
   * host at the same depth. Branch levels never roll the finale arena.
   */
  branch?: boolean;
}

/** A two-way gilded arch linking a host level and its branch level. */
export interface VaultArch {
  x: number;
  y: number;
  /** Arrival spot for travelers stepping out of this arch (kept clear of the
   *  trigger radius so a transition never bounces straight back). */
  backX: number;
  backY: number;
  /** Host-side reachable tell/gold-glint point used for secret discoverability. */
  discoverX?: number;
  discoverY?: number;
}

/** A fire-lit checkpoint brazier. Lights when Fire cells touch its bowl. */
export interface Waystone {
  x: number;
  y: number;
  lit: boolean;
}

export interface LevelExitWell {
  /** Center column of the well shaft. */
  x: number;
  /** Top row of the seal plug. */
  sealY: number;
  halfW: number;
}

/**
 * A designer-placed light compiled from a Builder document (Phase 7).
 * Seeded into the dynamic light field each rebuild alongside emissive
 * materials; `occluded` lights seed a point and let the directional sweeps
 * carve shadows, non-occluded lights paint their whole falloff disk.
 */
export interface AuthoredLight {
  x: number;
  y: number;
  /** Channel weights 0..1 (parsed from the authored hex color). */
  r: number;
  g: number;
  b: number;
  /** Overall strength multiplier (sane range 0..4). */
  intensity: number;
  /** Reach in world cells. */
  radius: number;
  /** Extra hot-spot boost at the core (feeds the bloom threshold). */
  bloom: number;
  /** 0..1 torch-like wobble depth. */
  flicker: number;
  /** Stable per-light phase so neighboring torches don't sync. */
  flickerPhase: number;
  falloff: 'soft' | 'linear' | 'sharp';
  occluded: boolean;
}

/**
 * A deferred enemy record produced by object instantiation (Builder compile
 * spawns these immediately; worldgen prefab placement returns them so the
 * levels manager spawns them alongside the placed population).
 */
export interface PrefabEnemy {
  kind: EnemyKind;
  x: number;
  y: number;
  /** Authored object id when this came from a Builder document object. */
  sourceId?: string;
  sleeping?: boolean;
  patrol?: Array<[number, number]>;
}

/** Footprint of one authored prefab stamped into a generated level. */
export interface PlacedPrefab {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface GeneratedSceneObjectPlacement {
  id: string;
  kind: string;
  x: number;
  y: number;
  params: Record<string, unknown>;
}

export interface GeneratedSceneLinkPlacement {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
}

export interface GeneratedSceneLightPlacement {
  id: string;
  x: number;
  y: number;
  color: string;
  intensity: number;
  radius: number;
  bloom?: number;
  flicker?: number;
  falloff?: 'soft' | 'linear' | 'sharp';
  occluded?: boolean;
}

/**
 * Read-only footprint for a generated virtual-world pixel scene materialized
 * into the current runtime window. These are not Builder document objects;
 * the editor can inspect/capture them, but editing still goes through authored
 * objects, lights, prefabs, or terrain cells.
 */
export interface GeneratedScenePlacement {
  id: string;
  source: 'virtual-world';
  sceneId: string;
  slotId: string;
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  objectCount: number;
  linkCount: number;
  lightCount: number;
  objects: GeneratedSceneObjectPlacement[];
  links: GeneratedSceneLinkPlacement[];
  lights: GeneratedSceneLightPlacement[];
  sourceChunk?: { cx: number; cy: number; hash: string };
}

/**
 * A decoded, render-ready animated sprite (Aseprite pipeline). Shared by
 * reference: every decor instance pointing at the same asset holds the SAME
 * RuntimeSprite — one decode per compile, thirty torches share buffers.
 */
export interface RuntimeSprite {
  w: number;
  h: number;
  /** Per-frame 60Hz tick duration + raw RGBA (alpha thresholded at 128 when drawn). */
  frames: Array<{ ticks: number; data: Uint8ClampedArray }>;
  /** Cumulative tick offset where frame i starts (starts[i] <= t < starts[i] + ticks). */
  starts: number[];
  totalTicks: number;
  /** Emissive sprites are their own light source: drawn raw, never light-multiplied. */
  emissive: boolean;
}

/**
 * One placed animated decor instance. VISUAL-ONLY by invariant: decor never
 * writes cells, never collides, never blocks, never gates progression — the
 * grid doesn't know it's there (same class as enemy sprites and critters).
 * Frame timing is STATELESS off ctx.state.frameCount (no tick hook): it
 * animates through pause/hitstop like fire flicker, correct for ambience.
 */
export interface RuntimeDecor {
  x: number;
  y: number;
  sprite: RuntimeSprite;
  /** Loop-tag frame range (inclusive) within the sprite's strip. */
  from: number;
  to: number;
  dir: 'forward' | 'reverse' | 'pingpong';
  flipX: boolean;
  /** Stable per-decor tick offset (object-id hash) so identical decors desync. */
  phase: number;
  /** 0 = authored frame durations at native speed; >0 = uniform stepping at
   *  tickScale frames-of-animation per game tick (the fps override / 60). */
  tickScale: number;
}

/**
 * Everything that persists for a visited level. Worlds are kept live in RAM
 * for the whole expedition (v1) — your scars stay exactly as you left them.
 */
export interface LevelRuntime {
  def: LevelDef;
  world: World;
  enemies: Enemy[];
  waystones: Waystone[];
  exit: LevelExitWell | null;
  /** Fog-of-war mask, 1:8 downsample of the world (MINIMAP_W x MINIMAP_H). */
  explored: Uint8Array;
  spawn: { x: number; y: number };
  /** Placement-brain analysis, extracted once after generation. */
  regions: RegionGraph | null;
  /** Cauldron basin center (stamped near the first waystone), if placed. */
  cauldron: { x: number; y: number } | null;
  /** World pickups (hearts/tomes/chests/potions/gold/key); taken ones persist as taken. */
  pickups: Pickup[];
  /** The level's exit gate; null on custom/bottom levels. */
  portal: ExitPortal | null;
  /** The golden key has been collected in this level. */
  keyTaken: boolean;
  /** Doors/plates/levers/braziers guarding this level's treasure. */
  mechanisms: Mechanism[];
  /** Transient actuator lookup: target mechanism id -> triggers in list order. */
  mechanismTriggers?: Map<number, Mechanism[]>;
  /** Sealed strongrooms with remote rune switches. */
  runeVaults: RuneVault[];
  /** Boss arena center; `kind` picks the resident (default 'colossus' —
   *  the d8 finale; d4's flooded arena seats the leviathan). */
  boss?: { x: number; y: number; kind?: EnemyKind } | null;
  /** Designer-placed lights from a compiled Builder document or worldgen prefabs. */
  authoredLights?: AuthoredLight[];
  /** Optional document-owned backdrop profile for custom/playtest runtimes. */
  backdrop?: BackdropSettings;
  /** Level profile used when resolving `backdrop.levels` for custom runtimes. */
  backdropLevelId?: string | null;
  /** Builder/prefab hazard emitters: drip real cells on their cadence. */
  emitters?: HazardEmitter[];
  /** Authored prefabs stamped into this level by worldgen (audit/debug). */
  placedPrefabs?: PlacedPrefab[];
  /** Generated virtual pixel-scene footprints (read-only audit/selection handles). */
  generatedScenes?: GeneratedScenePlacement[];
  /** Animated sprite decor (visual-only — see RuntimeDecor). */
  decors?: RuntimeDecor[];
  /** The Refuge's offering shrine point — E in reach opens the Sanctum shop. */
  refuge?: { x: number; y: number };
  /** D1 teaching alcove: real-cell stations plus its reward pedestal. */
  spellLab?: { x: number; y: number; rewardX: number; rewardY: number };
  /** The gilded arch: hidden branch entrance (host) / way home (branch). */
  vaultArch?: VaultArch;
}

export interface LevelsApi {
  /** Null until the descent starts (first play-mode entry). */
  readonly current: LevelRuntime | null;
  readonly transitioning: boolean;
  /** Canonical launcher/dev-console run entrypoint. */
  startRun(ctx: Ctx, config: RunStartConfig): RunStartResult;
  /** Canonical status for launcher/dev-console run workflows. */
  runStatus(ctx: Ctx): RunStatus;
  /** Generate D1 (or resume) and swap it into ctx. Idempotent. */
  startDescent(ctx: Ctx): void;
  /**
   * Per-frame (play mode): well-fall detection -> level transition,
   * waystone lighting checks, explored-mask stamping.
   */
  update(ctx: Ctx): void;
  /** Respawn anchor: last lit waystone in the current level, else level spawn. */
  respawnPoint(): { x: number; y: number } | null;
  /**
   * Build-mode playtest: wrap the CURRENT world (hand-built or loaded from
   * the level library) into a custom level runtime instead of generating —
   * enemies placed in build mode are kept.
   */
  playCurrentWorld(ctx: Ctx): void;
  /** Builder World Map test run: materialize the tuned virtual world around a global center. */
  playVirtualWindow(ctx: Ctx, def: VirtualWorldDef, center: { x: number; y: number }, previewRadius: number): void;
  /** Leave a disposable Builder/Sandbox custom runtime so header PLAY resumes the expedition path. */
  exitCustomPlaytest(ctx: Ctx): void;
  /** Leave any disposable non-campaign runtime, including virtual-world test windows. */
  exitDisposableRuntime(ctx: Ctx): void;
  /** QA/debug command: stock visible potion pickups in the current level. */
  seedReviewKit(ctx: Ctx): void;
  /** Persist the whole expedition (visited levels + hero) to localStorage. */
  saveExpedition(ctx: Ctx): void;
  /** Persist a post-death checkpoint: world penalty now, hero resumes at the respawn anchor. */
  saveDeathCheckpoint(ctx: Ctx): void;
  hasSavedExpedition(): boolean;
  /** Drop the save; the next play entry starts a fresh expedition. */
  abandonExpedition(): void;
  /** QA/dev console level jump. The Levels system owns the transition semantics. */
  debugEnterLevel(ctx: Ctx, id: string): boolean;
}

/* ============================================================
 * The game context — every shared dependency, wired once in Game.ts
 * ============================================================ */

export interface Ctx {
  world: World;
  events: EventBus;
  audio: AudioApi;
  params: GameParams;
  state: GameStateData;
  input: InputState;
  fx: FxState;
  camera: CameraApi;

  player: PlayerState;
  enemies: Enemy[];
  projectiles: Projectile[];
  shockwaves: Shockwave[];
  waves: WaveState;

  particles: ParticlesApi;
  explosions: ExplosionApi;
  lightning: LightningApi;
  projectileCtl: ProjectilesApi;
  physics: PhysicsApi;
  rigidBodies: RigidBodiesApi;
  vineStrands: VineStrandsApi;
  playerCtl: PlayerControlApi;
  enemyCtl: EnemyControlApi;
  spells: SpellsApi;
  simulation: SimulationApi;
  worldgen: WorldGenApi;
  waveCtl: WaveDirectorApi;
  flask: FlaskApi;
  telemetry: TelemetryApi;
  perf: PerfApi;
  console: ConsoleApi;
  levels: LevelsApi;
  wands: WandsApi;
  pickups: PickupsApi;
  mechanisms: MechanismsApi;
  sanctum: SanctumApi;
  critters: CrittersApi;
}

import type { World } from '@/sim/World';
import type { EventBus } from '@/core/events';
import type { Cell } from '@/sim/CellType';

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
}

export const PLAYER_HALF_W = 4;
export const PLAYER_H = 17;
export const PLAYER_STEP_UP = 5;

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
  | 'colossus';

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
}

export type SpellId = 'bolt' | 'bomb' | 'lightning' | 'flame' | 'dig' | 'warp' | 'blackhole';

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
  hostileDmg: number;
}

export interface ParticleOpts {
  grav?: number;
  glow?: number;
  homing?: boolean;
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
  damage?: number;
  heat?: number;
  spread?: number;
  baseRadius?: number;
  chargeRate?: number;
  collapseLimit?: number;
}

export interface GlobalParams {
  simSpeed: number;
  maxBrightness: number;
  /** Base ambient light level (original top-level `AMBIENT`). */
  ambient: number;
}

export interface GameParams {
  global: GlobalParams;
  materials: Record<number, MaterialParams>;
  spells: Record<SpellId, SpellParams>;
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
  | 'volcanic';

/* ============================================================
 * Shared mutable game state
 * ============================================================ */

export type GameMode = 'build' | 'play';
export type InputMode = 'element' | 'spell';

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
}

export interface Keys {
  left: boolean;
  right: boolean;
  jump: boolean;
  down: boolean;
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
  readonly list: FlyingParticle[];
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
  trigger(cx: number, cy: number, radius: number): void;
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

export interface PlayerControlApi {
  /** src tags ('explosion' | 'fire' | 'acid' | 'toxic' | 'impact') drive boon resistances. */
  damage(amount: number, kx: number, ky: number, src?: string): void;
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
  /** Wand muzzle: 9 cells along aimAngle from (player.x, player.y - 9). */
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
  idleFrames: number;
  /** Integer camera snapshot used for the current frame's texture (set by the renderer). */
  renderX: number;
  renderY: number;
  update(ctx: Ctx): void;
  /** Derive world.simBounds from the camera position (+/- SIM_MARGIN). */
  updateSimBounds(world: World): void;
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
  ): {
    exit: LevelExitWell;
    waystones: Waystone[];
    spawn: { x: number; y: number };
    cauldron: { x: number; y: number } | null;
    pickups: Pickup[];
    portal: ExitPortal | null;
    mechanisms: Mechanism[];
    runeVaults: RuneVault[];
    boss: { x: number; y: number } | null;
  };
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

/**
 * The Material Flask: siphon real cells out of the world, carry them,
 * pour them back, or throw the bottle. Nothing is abstracted — stored
 * material keeps its identity (a flask of blood is a portable conductor).
 */
export interface FlaskApi {
  readonly state: FlaskState;
  /** Per-frame: handles siphon/pour holds and any in-flight thrown bottle. */
  update(ctx: Ctx): void;
  /** Lob the bottle toward the cursor; shatters on impact, releasing the cells. */
  throwFlask(ctx: Ctx): void;
}

/** Local gameplay counters (deaths by cause, material usage, ...). */
export interface TelemetryApi {
  count(key: string, n?: number): void;
  all(): Record<string, number>;
}

/* ============================================================
 * Upgrade port: mechanisms, pickups, portal progression, sanctum
 * ============================================================ */

export type MechanismKind = 'door' | 'plate' | 'lever' | 'brazier';

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
  /** door: open 0/1 · lever: on 0/1 · brazier: lit 0/1 · plate: latch frames left. */
  state: number;
  /** Plate weight currently on the sill (transient, not persisted semantics). */
  pressed?: boolean;
  /** Door id driven by this trigger; -1 for doors themselves / unlinked. */
  targetId: number;
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
  /** tome: the card granted; potion: POTION_DEFS key; goldpile/chest: amount. */
  data: { card?: CardId; potion?: string; amount?: number };
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
  // modifier / multicast cards
  | 'double'
  | 'triple'
  | 'speed'
  | 'heavy'
  | 'spread'
  | 'infuser'
  | 'trigger'
  | 'bounce';

export type CardKind = 'projectile' | 'modifier' | 'multicast';

export interface CardDef {
  id: CardId;
  name: string;
  kind: CardKind;
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
  /** Save-game support: capture / restore the full wand loadout. */
  snapshotLoadout(): WandLoadoutSave;
  loadLoadout(data: WandLoadoutSave): void;
}

export interface WandLoadoutSave {
  active: 0 | 1;
  collection: CardId[];
  wands: Array<{ frameId: string; cards: (CardId | null)[]; mana: number }>;
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
  /** Sealed strongrooms with remote rune switches. */
  runeVaults: RuneVault[];
  /** Boss arena center (bottom level only); the colossus spawns here. */
  boss?: { x: number; y: number } | null;
}

export interface LevelsApi {
  /** Null until the descent starts (first play-mode entry). */
  readonly current: LevelRuntime | null;
  readonly transitioning: boolean;
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
  /** Persist the whole expedition (visited levels + hero) to localStorage. */
  saveExpedition(ctx: Ctx): void;
  hasSavedExpedition(): boolean;
  /** Drop the save; the next play entry starts a fresh expedition. */
  abandonExpedition(): void;
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
  playerCtl: PlayerControlApi;
  enemyCtl: EnemyControlApi;
  spells: SpellsApi;
  simulation: SimulationApi;
  worldgen: WorldGenApi;
  waveCtl: WaveDirectorApi;
  flask: FlaskApi;
  telemetry: TelemetryApi;
  levels: LevelsApi;
  wands: WandsApi;
  pickups: PickupsApi;
  mechanisms: MechanismsApi;
  sanctum: SanctumApi;
}

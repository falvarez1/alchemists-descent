import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import type { Ctx, Enemy, FloraApi, FloraFallView, GustFalloff, RigidBody } from '@/core/types';
import { ACTIVITY_SIZE } from '@/sim/ActivityGrid';
import { blocksEntity, Cell, isGas } from '@/sim/CellType';
import { fireColor, glassColor, packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';
import {
  holdsUp,
  isGlowseedLife,
  LEAF_LITTER,
  LEAF_REACH,
  SEED_GLOW_HELD,
  SEED_GLOW_LOOSE,
  SEED_THIRSTY_HELD,
  SEED_THIRSTY_LOOSE,
} from '@/sim/elements/flora';
import type { World } from '@/sim/World';
import { entityRandom } from '@/core/simRandom';
import {
  FELL_EMBER,
  FELL_GLOWSEED,
  FELL_LEAF,
  FELL_SEED,
  FELL_WOOD,
  type FellSprite,
  fitFellBody,
  floodStand,
  FloodScratch,
  liftStand,
  restampFell,
  type Stand,
  standSupport,
  spriteBounds,
  spriteSampleAt,
} from '@/game/floraFelling';

/* ============================================================
 * FLORA — living plants that fall.
 *
 * Standing trees are cells (Cell.Trunk + Cell.Leaf + held Cell.Seed). This
 * system watches the chunks that hold living wood; when a stand loses its last
 * contact with load-bearing ground it is FELLED:
 *
 *   crack — the cells lift out of the grid into a sprite on a Rapier body,
 *           hinged at the cut on the side it falls toward (away from the dig
 *           beam, the blast, the boot; else toward its own lean);
 *   lean  — the hinge makes the first degrees slow: the anticipation;
 *   fall  — leaves shed from the crown, the tip accelerates, whoosh;
 *   crush — whatever the moving wood strikes is struck (creatures 'flattened');
 *   thud  — dust along the contact, shake, the ground answers;
 *   log   — at rest it re-stamps as real Wood in its final pose (a bridge, a
 *           ramp, a dam, fuel), the crown as Leaf, the pods as loose Seed.
 *
 * Before the cut goes through, a trunk notched past half its width creaks and
 * sheds (the warning). Kicks snap saplings and shake trees (pods drop).
 * ============================================================ */

/** Density of living wood vs water (1): it floats. */
const WOOD_DENSITY = 0.7;
/** Largest stand the boot can snap (a sapling): cells, and height. */
const SAPLING_MAX_CELLS = 130;
const SAPLING_MAX_HEIGHT = 34;
/** Initial topple rate (rad/tick) — tiny: gravity makes the fall, the hinge the lean. */
const TOPPLE_START_SPIN = 0.0055;
/** Past this lean the hinge wood snaps and the trunk falls free (rad). */
const HINGE_RELEASE_ANGLE = 0.95;
/** The hinge's friction: angular damping while the fibres still hold (the
 *  controlled lean), and the free-fall damping once they snap. */
const HINGE_DAMPING = 1.1;
const FREE_DAMPING = 0.12;
/** The hold: for this many ticks after the crack the hinge fibres still hold
 *  (near-locked), the trunk groans and the crown sheds — then it goes. */
const HOLD_TICKS = 18;
const HOLD_DAMPING = 26;
/** Contact speed (cells/tick) below which moving wood only nudges, never hurts. */
const CRUSH_MIN_SPEED = 1.5;
/** A tick-to-tick velocity change beyond this is an impact (cells/tick). */
const IMPACT_DV = 1.1;
/** Settle: this slow for this many ticks and the log re-stamps. */
const SETTLE_SPEED = 0.08;
const SETTLE_SPIN = 0.006;
const SETTLE_TICKS = 10;
/** A fall that never settles (bobbing in a pool, wedged) re-stamps anyway. */
const FALL_TIMEOUT = 720;
/** Hints (the dig beam, a blast, a kick) older than this do not steer a fall. */
const HINT_TTL = 150;
/** Most dirty chunks examined per tick (the rest wait a tick). */
const CHUNKS_PER_TICK = 10;
/** Most dirty chunks fingerprinted per tick: the cheap check that lets gas,
 *  water and falling leaves churn a chunk without re-flooding its stands. */
const SIGNATURES_PER_TICK = 48;
/** Notch warning: a row this thin vs the trunk's typical row creaks (levels 1, 2). */
const WARN_RATIO_1 = 0.55;
const WARN_RATIO_2 = 0.3;
const WARN_COOLDOWN = 80;

type FellCause = 'dig' | 'fire' | 'blast' | 'kick' | 'acid' | 'unknown';

interface Hint {
  kind: 'dig' | 'blast' | 'kick';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  radius: number;
  dir: number;
  t: number;
}

interface FloraIndex {
  /** Chunk may hold living wood (refreshed as chunks change). */
  chunkTrunk: Uint8Array;
  /** Activity version last examined per chunk. */
  seen: Uint32Array;
  /** Round-robin cursor for the slow presence refresh. */
  cursor: number;
  /** Where the dirty-chunk scan resumes next tick (fairness). */
  scanFrom: number;
  /** Per chunk: the support fingerprint when its stands were last flooded. */
  sig: Uint32Array;
  /** Per chunk: sig holds a fingerprint (0 = flood on the next change). */
  sigSet: Uint8Array;
  /** Last notch warning tick by spatial bucket. */
  warned: Map<number, { t: number; level: number }>;
}

interface Falling extends FloraFallView {
  body: RigidBody;
  sprite: FellSprite;
  world: World;
  burning: number;
  dir: number;
  hinged: boolean;
  age: number;
  still: number;
  pvx: number;
  pvy: number;
  pva: number;
  landed: boolean;
  whooshed: boolean;
  lastX: number;
  lastY: number;
  lastA: number;
  /** Local-frame sample points on the wood (dust, contact, brittle smash). */
  samples: Array<[number, number]>;
  /** Leaf pixels still on the crown (sprite indices) — shed from here. */
  leaves: number[];
  hitEnemies: Set<Enemy>;
  hitPlayer: boolean;
  /** The compound colliders (local frame) — crush tests use the true shape. */
  boxes: Array<{ halfW: number; halfH: number; x: number; y: number }>;
  mass: number;
  length: number;
  cause: FellCause;
  /** Diagnostics for probes: how the stand was judged when it fell. */
  debug?: { standing: boolean; upright: boolean; angle: number; halfW: number; halfH: number; boxes: number; footX: number; footY: number };
}

let nextFallId = 1;

export class Flora implements FloraApi {
  readonly falling: Falling[] = [];
  private readonly scratch = new FloodScratch();
  private readonly index = new WeakMap<World, FloraIndex>();
  private readonly hints: Hint[] = [];
  private readonly disposers: Array<() => void> = [];
  private emittingImpact = false;
  private pouchToastT = 0;

  constructor(private readonly ctx: Ctx) {
    this.disposers.push(ctx.events.on('structureStrike', ({ x, y, radius }) => {
      if (this.emittingImpact) return;
      this.hints.push({ kind: 'blast', x0: x, y0: y, x1: x, y1: y, radius, dir: 0, t: ctx.state.frameCount });
      this.trimHints();
      this.shakeNear(ctx.world, x, y, radius * 1.8, 0);
    }));
    // Bodies are cleared on levelChanged (RigidBodies subscribed first): every
    // tree still in flight lands as a log in the world it fell in.
    this.disposers.push(ctx.events.on('levelChanged', () => {
      for (const f of this.falling) this.restamp(f, f.lastX, f.lastY, f.lastA, false);
      this.falling.length = 0;
      this.hints.length = 0;
    }));
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
  }

  /* ------------------------------ bookkeeping ------------------------------ */

  private indexFor(world: World): FloraIndex {
    let idx = this.index.get(world);
    if (idx) return idx;
    const cols = Math.ceil(world.width / ACTIVITY_SIZE), rows = Math.ceil(world.height / ACTIVITY_SIZE);
    idx = { chunkTrunk: new Uint8Array(cols * rows), seen: new Uint32Array(cols * rows), cursor: 0, scanFrom: 0,
      sig: new Uint32Array(cols * rows), sigSet: new Uint8Array(cols * rows), warned: new Map() };
    // One full sweep per world instance: which chunks hold living wood.
    const types = world.types, W = world.width;
    for (let i = 0; i < types.length; i++) {
      if (types[i] !== Cell.Trunk) continue;
      const y = (i / W) | 0, x = i - y * W;
      idx.chunkTrunk[(x >> 6) + (y >> 6) * cols] = 1;
    }
    // Version 0 = "never looked": every flagged chunk is examined once.
    this.index.set(world, idx);
    return idx;
  }

  noteGrowth(x: number, y: number, x1 = x, y1 = y): void {
    const world = this.ctx.world;
    const idx = this.indexFor(world);
    const cols = Math.ceil(world.width / ACTIVITY_SIZE);
    const ax = Math.min(x, x1), ay = Math.min(y, y1), bx = Math.max(x, x1), by = Math.max(y, y1);
    this.flagChunks(world, idx, ax, ay, bx, by);
    // New wood is flooded on its next change however its fingerprint reads.
    for (let r = Math.max(0, ay >> 6); r <= by >> 6; r++) for (let c = Math.max(0, ax >> 6); c <= bx >> 6 && c < cols; c++) {
      const key = c + r * cols;
      if (key < idx.sigSet.length) idx.sigSet[key] = 0;
    }
  }

  /** Mark every chunk a rect of living wood overlaps as worth watching. */
  private flagChunks(world: World, idx: FloraIndex, x0: number, y0: number, x1: number, y1: number): void {
    const cols = Math.ceil(world.width / ACTIVITY_SIZE), rows = Math.ceil(world.height / ACTIVITY_SIZE);
    const c0 = Math.max(0, x0 >> 6), c1 = Math.min(cols - 1, x1 >> 6);
    const r0 = Math.max(0, y0 >> 6), r1 = Math.min(rows - 1, y1 >> 6);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) idx.chunkTrunk[c + r * cols] = 1;
  }

  /**
   * What holds a chunk's living wood up, as one number: where its trunk cells
   * are and, on each face not against more trunk, whether that face rests on
   * anchored support. Equal fingerprints mean nothing that can sever or notch
   * a stand changed here (gas drifting past, water sloshing, leaves falling),
   * so the stand flood is skipped. Interior wood costs one read.
   */
  private chunkSignature(world: World, key: number, cols: number): number {
    const x0 = (key % cols) * ACTIVITY_SIZE, y0 = Math.floor(key / cols) * ACTIVITY_SIZE;
    const x1 = Math.min(world.width, x0 + ACTIVITY_SIZE), y1 = Math.min(world.height, y0 + ACTIVITY_SIZE);
    const types = world.types, W = world.width, H = world.height, TRUNK = Cell.Trunk;
    let h = 0x811c9dc5 | 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0, i = x0 + y * W; x < x1; x++, i++) {
        if (types[i] !== TRUNK) continue;
        let bits = 0;
        if (x === 0 || types[i - 1] !== TRUNK) bits |= holdsUp(world, x - 1, y, false) ? 1 : 2;
        if (x === W - 1 || types[i + 1] !== TRUNK) bits |= holdsUp(world, x + 1, y, false) ? 4 : 8;
        if (y === 0 || types[i - W] !== TRUNK) bits |= holdsUp(world, x, y - 1, false) ? 16 : 32;
        if (y === H - 1 || types[i + W] !== TRUNK) bits |= holdsUp(world, x, y + 1, true) ? 64 : 128;
        h = Math.imul(h ^ i, 16777619);
        h = Math.imul(h ^ bits, 16777619);
      }
    }
    return h >>> 0;
  }

  private trimHints(): void {
    const now = this.ctx.state.frameCount;
    while (this.hints.length > 0 && (now - this.hints[0].t > HINT_TTL || this.hints.length > 24)) this.hints.shift();
  }

  /* --------------------------------- tick --------------------------------- */

  update(ctx: Ctx): void {
    if (ctx.state.mode === 'play' && ctx.debug?.active) return;
    const world = ctx.world;
    const frame = ctx.state.frameCount;
    // The dig beam steers a fall away from the wizard holding it.
    const beam = ctx.fx.digBeam;
    if (beam && beam.life > 0 && (beam.physicsLife ?? beam.life) > 0) {
      const last = this.hints[this.hints.length - 1];
      if (!last || last.kind !== 'dig' || last.t !== frame) {
        const dx = beam.x1 - beam.x0;
        this.hints.push({ kind: 'dig', x0: beam.x0, y0: beam.y0, x1: beam.x1, y1: beam.y1, radius: 6, dir: Math.abs(dx) > 0.5 ? Math.sign(dx) : 0, t: frame });
      }
    }
    if ((frame & 15) === 0) this.trimHints();
    this.scanStands(ctx, world);
    this.updateFalls(ctx);
    if (ctx.state.mode === 'play') this.collectGlowseeds(ctx);
    if (this.pouchToastT > 0) this.pouchToastT--;
  }

  /** Examine the chunks near the action whose cells changed since last look. */
  private scanStands(ctx: Ctx, world: World): void {
    const idx = this.indexFor(world);
    const act = world.activity;
    const cols = Math.ceil(world.width / ACTIVITY_SIZE), rows = Math.ceil(world.height / ACTIVITY_SIZE);
    const b = world.simBounds;
    const cx0 = Math.max(0, (b.x0 >> 6) - 1), cy0 = Math.max(0, (b.y0 >> 6) - 1);
    const cx1 = Math.min(cols - 1, ((b.x1 - 1) >> 6) + 1), cy1 = Math.min(rows - 1, ((b.y1 - 1) >> 6) + 1);
    // Slow presence refresh: one chunk in view per few ticks is re-swept for
    // living wood that appeared without our noticing (a Sandbox brush).
    if ((ctx.state.frameCount & 3) === 0 && cx1 >= cx0 && cy1 >= cy0) {
      const spanX = cx1 - cx0 + 1, spanY = cy1 - cy0 + 1;
      const n = idx.cursor++ % (spanX * spanY);
      const key = cx0 + (n % spanX) + (cy0 + Math.floor(n / spanX)) * cols;
      if (!idx.chunkTrunk[key] && this.chunkHasTrunk(world, key, cols)) idx.chunkTrunk[key] = 1;
    }
    this.scratch.ensure(world.types.length);
    const epoch = this.scratch.next();
    // Round-robin from where the last tick stopped: a chunk that changes every
    // tick (leaves drifting, a stream) must never starve the rest of the view.
    const spanX = cx1 - cx0 + 1, spanY = cy1 - cy0 + 1, total = Math.max(0, spanX * spanY);
    let examined = 0, fingerprinted = 0;
    for (let n = 0; n < total; n++) {
      const k = (idx.scanFrom + n) % total;
      const key = cx0 + (k % spanX) + (cy0 + Math.floor(k / spanX)) * cols;
      if (!idx.chunkTrunk[key]) continue;
      const v = act.versions[key];
      if (idx.seen[key] === v && v !== 0) continue;
      idx.seen[key] = v;
      fingerprinted++;
      const sig = this.chunkSignature(world, key, cols);
      if (idx.sigSet[key] === 0 || idx.sig[key] !== sig) {
        examined++;
        const falls = this.falling.length;
        if (!this.examineChunk(ctx, world, idx, key, cols, epoch)) idx.chunkTrunk[key] = 0;
        // A stand that fell from here left different wood behind: fingerprint it afresh next time.
        idx.sig[key] = sig;
        idx.sigSet[key] = this.falling.length === falls ? 1 : 0;
      }
      if (examined >= CHUNKS_PER_TICK || fingerprinted >= SIGNATURES_PER_TICK) {
        idx.scanFrom = (idx.scanFrom + n + 1) % Math.max(1, total);
        break;
      }
    }
  }

  private chunkHasTrunk(world: World, key: number, cols: number): boolean {
    const x0 = (key % cols) * ACTIVITY_SIZE, y0 = Math.floor(key / cols) * ACTIVITY_SIZE;
    const x1 = Math.min(world.width, x0 + ACTIVITY_SIZE), y1 = Math.min(world.height, y0 + ACTIVITY_SIZE);
    const types = world.types, W = world.width;
    for (let y = y0; y < y1; y++) for (let x = x0, i = x0 + y * W; x < x1; x++, i++) if (types[i] === Cell.Trunk) return true;
    return false;
  }

  /** Flood every stand touching this chunk; fell the unsupported ones. Returns
   *  false if the chunk holds no living wood any more. */
  private examineChunk(ctx: Ctx, world: World, idx: FloraIndex, key: number, cols: number, epoch: number): boolean {
    const x0 = (key % cols) * ACTIVITY_SIZE, y0 = Math.floor(key / cols) * ACTIVITY_SIZE;
    const x1 = Math.min(world.width, x0 + ACTIVITY_SIZE), y1 = Math.min(world.height, y0 + ACTIVITY_SIZE);
    const types = world.types, W = world.width, visit = this.scratch.visit;
    let any = false;
    for (let y = y0; y < y1; y++) {
      for (let x = x0, i = x0 + y * W; x < x1; x++, i++) {
        if (types[i] !== Cell.Trunk) continue;
        any = true;
        if (visit[i] === epoch) continue;
        const stand = floodStand(world, x, y, this.scratch, epoch);
        // A stand is watched wherever it reaches: a cut in any of its chunks re-floods it.
        this.flagChunks(world, idx, stand.x0, stand.y0, stand.x1, stand.y1);
        if (!stand.supported) this.fell(ctx, world, stand);
        else this.checkNotch(ctx, world, idx, stand, epoch);
      }
    }
    return any;
  }

  /* ------------------------------ the warning ------------------------------ */

  /** A trunk notched past half its width creaks, sifts dust and drops leaves. */
  private checkNotch(ctx: Ctx, world: World, idx: FloraIndex, stand: Stand, epoch: number): void {
    const height = stand.y1 - stand.y0 + 1;
    if (height < 16 || stand.count < 40) return;
    const W = world.width, types = world.types, visit = this.scratch.visit;
    const rows: number[] = [];
    let thinRow = -1, thin = Infinity;
    const yTop = stand.y1 - Math.floor(height * 0.6);
    for (let y = stand.y1; y >= yTop; y--) {
      let n = 0, exposed = false;
      for (let x = stand.x0; x <= stand.x1; x++) {
        const i = x + y * W;
        if (visit[i] !== epoch || types[i] !== Cell.Trunk) continue;
        n++;
        if (!exposed && (!standSupport(types[i - 1]) || !standSupport(types[i + 1]))) exposed = true;
      }
      if (!exposed || n === 0) continue;
      rows.push(n);
      if (n < thin) { thin = n; thinRow = y; }
    }
    if (rows.length < 6 || thinRow < 0) return;
    const sorted = rows.slice().sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length * 0.6)];
    if (typical < 2) return;
    const ratio = thin / typical;
    const level = ratio <= WARN_RATIO_2 ? 2 : ratio <= WARN_RATIO_1 ? 1 : 0;
    if (level === 0) return;
    const bucket = ((stand.x0 + stand.x1) >> 3) + (stand.y1 >> 3) * 4096;
    const prev = idx.warned.get(bucket);
    const now = ctx.state.frameCount;
    if (prev && (now - prev.t < WARN_COOLDOWN) && prev.level >= level) return;
    idx.warned.set(bucket, { t: now, level });
    // The warning: a strained creak, dust sifting from the notch, the crown shivering leaves loose.
    let nx = 0, nc = 0;
    for (let x = stand.x0; x <= stand.x1; x++) {
      const i = x + thinRow * W;
      if (visit[i] === epoch && types[i] === Cell.Trunk) { nx += x; nc++; }
    }
    const notchX = nc ? nx / nc : (stand.x0 + stand.x1) / 2;
    ctx.audio.at(notchX, thinRow, () => ctx.audio.creak(level === 2 ? 1 : 0.6), 420);
    ctx.events.emit('floraMoment', { kind: 'creak', x: notchX, y: thinRow, strength: level === 2 ? 1 : 0.6 });
    ctx.particles.burst(notchX, thinRow, level === 2 ? 10 : 5, null, () => packRGB(140, 118, 88), 0.5, { grav: 0.05 });
    this.shakeLeaves(world, stand.x0 - LEAF_REACH, stand.y0 - LEAF_REACH, stand.x1 + LEAF_REACH, stand.y0 + Math.floor(height * 0.5), level === 2 ? 10 : 4);
    if (level === 2) ctx.fx.screenShake = Math.min(0.03, ctx.fx.screenShake + 0.004);
  }

  /* -------------------------------- felling -------------------------------- */

  private fell(ctx: Ctx, world: World, stand: Stand): void {
    const height = stand.y1 - stand.y0 + 1;
    const W = world.width;
    // What cut it: fire and acid leave their material at the wound.
    let fire = 0, acid = 0;
    for (let n = 0; n < stand.count; n++) {
      const i = stand.cells[n];
      if (world.life[i] > 0) fire++;
      const y = (i / W) | 0;
      if (y < stand.y1 - 3) continue;
      for (const d of [W, 1, -1, 2 * W]) {
        const t = world.types[i + d];
        if (t === Cell.Fire || t === Cell.Ember) fire++;
        else if (t === Cell.Acid) acid++;
      }
    }
    const sprite = liftStand(world, stand, this.scratch);
    if (!sprite) {
      // Too small to fall as a body: the scrap crumbles into splinters.
      for (let n = 0; n < Math.min(stand.count, 12); n++) {
        const i = stand.cells[n];
        const y = (i / W) | 0, x = i - y * W;
        ctx.particles.spawn(x + 0.5, y + 0.5, (entityRandom() - 0.5) * 0.8, -0.3 - entityRandom() * 0.4, Cell.Ash, packRGB(120, 96, 70), 50, { grav: 0.08, deposit: true });
      }
      for (let n = 0; n < stand.count; n++) if (world.types[stand.cells[n]] === Cell.Trunk) world.clearCellAt(stand.cells[n]);
      return;
    }
    const fit = fitFellBody(sprite, WOOD_DENSITY);
    // The foot of the wood: the bottom of its MAIN column (the trunk — a prop
    // root or a hanging leg tip is not where it stands), and its mean x there.
    const colCount = new Int32Array(sprite.w);
    let comX = 0, comN = 0, leafX = 0, leafN = 0;
    for (let y = 0; y < sprite.h; y++) for (let x = 0; x < sprite.w; x++) {
      const k = sprite.kind[x + y * sprite.w];
      if (k === FELL_WOOD || k === FELL_EMBER) { colCount[x]++; comX += x; comN++; }
      else if (k === FELL_LEAF) { leafX += x; leafN++; }
    }
    let mainCol = 0;
    for (let x = 1; x < sprite.w; x++) if (colCount[x] > colCount[mainCol]) mainCol = x;
    let bottom = -1;
    for (let y = sprite.h - 1; y >= 0 && bottom < 0; y--) {
      for (let x = Math.max(0, mainCol - 2); x <= Math.min(sprite.w - 1, mainCol + 2); x++) {
        const k = sprite.kind[x + y * sprite.w];
        if (k === FELL_WOOD || k === FELL_EMBER) { bottom = y; break; }
      }
    }
    let footX = 0, footN = 0;
    for (let x = Math.max(0, mainCol - 4); x <= Math.min(sprite.w - 1, mainCol + 4); x++) {
      for (let y = Math.max(0, bottom - 2); y <= bottom; y++) {
        const k = sprite.kind[x + y * sprite.w];
        if (k === FELL_WOOD || k === FELL_EMBER) { footX += x; footN++; }
      }
    }
    footX = sprite.x0 + (footN ? footX / footN : mainCol) + 0.5;
    const footY = sprite.y0 + bottom + 1;
    comX = sprite.x0 + (comN ? comX / comN : sprite.w / 2) + 0.5;
    const crownX = leafN ? sprite.x0 + leafX / leafN + 0.5 : comX;
    // Standing (a cut below it: stump or ground within reach) topples on a hinge;
    // hanging or sideways wood simply drops (a tall one still goes over).
    let standing = false;
    const upright = Math.abs(fit.angle) < 0.7 && sprite.h > sprite.w * 0.9 && sprite.h > 14;
    if (upright) {
      for (let d = 0; d <= 12 && !standing; d++) {
        const yy = footY + d;
        for (let dx = -3; dx <= 3; dx++) {
          const xx = Math.floor(footX) + dx;
          if (!world.inBounds(xx, yy)) continue;
          const t = world.types[world.idx(xx, yy)];
          if (t === Cell.Trunk || standSupport(t)) { standing = true; break; }
        }
      }
    }
    // Which way: away from what cut it; else its own lean.
    const now = ctx.state.frameCount;
    let cause: FellCause = fire > 2 ? 'fire' : acid > 1 ? 'acid' : 'unknown';
    let dir = 0;
    let blast: Hint | null = null;
    for (let h = this.hints.length - 1; h >= 0; h--) {
      const hint = this.hints[h];
      if (now - hint.t > HINT_TTL) break;
      if (hint.kind === 'dig') {
        const d = segmentDistance(footX, footY - 3, hint.x0, hint.y0, hint.x1, hint.y1);
        const dTop = segmentDistance(footX, sprite.y0 + 2, hint.x0, hint.y0, hint.x1, hint.y1);
        if (Math.min(d, dTop) > 16) continue;
        dir = hint.dir !== 0 ? hint.dir : Math.sign(footX - hint.x0) || 1;
        cause = 'dig';
        break;
      }
      if (hint.kind === 'kick') {
        if (Math.hypot(footX - hint.x0, footY - hint.y0) > 40) continue;
        dir = hint.dir || 1;
        cause = 'kick';
        break;
      }
      if (hint.kind === 'blast') {
        if (Math.hypot(footX - hint.x0, (footY - 4) - hint.y0) > hint.radius + 18) continue;
        dir = Math.abs(footX - hint.x0) > 1.5 ? Math.sign(footX - hint.x0) : 0;
        cause = 'blast';
        blast = hint;
        break;
      }
    }
    if (dir === 0) {
      const lean = comX - footX;
      const crownLean = crownX - footX;
      dir = Math.abs(lean) > 0.8 ? Math.sign(lean) : Math.abs(crownLean) > 1.5 ? Math.sign(crownLean) : entityRandom() < 0.5 ? -1 : 1;
    }
    // Hinge on the BACK edge of the cut face (in the fit's frame): the trunk's
    // weight sits ahead of it, toward `dir`, so gravity carries it the way it
    // was cut. (A hinge on the fall side puts the weight behind it, and a soft
    // stump props nothing up: the tree would drop the wrong way.) The hold's
    // friction keeps the first degrees slow — the lean.
    let pivot: { x: number; y: number } | undefined;
    if (standing) {
      let foot = fit.boxes[0];
      for (const bx of fit.boxes) if (bx.y + bx.halfH > foot.y + foot.halfH) foot = bx;
      const lx = foot.x - dir * foot.halfW * 0.85, ly = foot.y + foot.halfH;
      const c = Math.cos(fit.angle), s = Math.sin(fit.angle);
      pivot = { x: fit.cx + lx * c - ly * s, y: fit.cy + lx * s + ly * c };
      // ...and behind the wood's own centre of mass (a crown heavier on the far
      // side must not swing it back): never more than 6 cells behind the trunk.
      const behind = comX - dir * 1.5;
      pivot.x = dir > 0 ? Math.max(pivot.x - 6, Math.min(pivot.x, behind)) : Math.min(pivot.x + 6, Math.max(pivot.x, behind));
    }
    const body = ctx.rigidBodies.spawn({ kind: 'box', halfW: fit.halfW, halfH: fit.halfH }, fit.cx, fit.cy, {
      angle: fit.angle,
      colliders: fit.boxes,
      density: WOOD_DENSITY,
      friction: 0.85,
      restitution: 0.03,
      linearDamping: 0.02,
      angularDamping: pivot ? HOLD_DAMPING : FREE_DAMPING,
      // Hinged: a nudge (gravity does the rest). Dropping upright with nothing
      // under the cut: it still goes over as it falls, toward its lean.
      va: standing ? dir * TOPPLE_START_SPIN : upright ? dir * 0.032 : (entityRandom() - 0.5) * 0.008,
      pivot,
      tag: 'flora-fell',
    });
    if (blast) {
      // A blast shoves the wood outward — on a hinge, that becomes the topple.
      const dx = fit.cx - blast.x0, dy = fit.cy - blast.y0, d = Math.hypot(dx, dy) || 1;
      const k = Math.max(0, 1 - d / (blast.radius * 2.4)) * 2.2;
      ctx.rigidBodies.applyImpulseAt(body, (dx / d) * k, (dy / d) * k - k * 0.3, fit.cx, fit.cy - fit.halfH * 0.6);
    }
    // Sample points on the wood for dust/contact, and the crown's leaves for shedding.
    const samples: Array<[number, number]> = [];
    const leaves: number[] = [];
    const ca = Math.cos(fit.angle), sa = Math.sin(fit.angle);
    const stride = Math.max(1, Math.floor(sprite.woodCount / 40));
    let woodSeen = 0;
    for (let y = 0; y < sprite.h; y++) for (let x = 0; x < sprite.w; x++) {
      const si = x + y * sprite.w, k = sprite.kind[si];
      if (k === FELL_LEAF) { leaves.push(si); continue; }
      if (k !== FELL_WOOD && k !== FELL_EMBER) continue;
      if (woodSeen++ % stride !== 0) continue;
      const dx = sprite.x0 + x + 0.5 - fit.cx, dy = sprite.y0 + y + 0.5 - fit.cy;
      samples.push([dx * ca + dy * sa, -dx * sa + dy * ca]);
    }
    let burning = 0;
    for (let i = 0; i < sprite.kind.length; i++) if (sprite.kind[i] === FELL_EMBER) burning++;
    const fall: Falling = {
      id: nextFallId++, body, sprite, world, cx0: fit.cx, cy0: fit.cy, a0: fit.angle,
      burning: sprite.woodCount ? Math.min(1, burning / Math.max(8, sprite.woodCount * 0.15)) : 0,
      dir: standing ? dir : 0, hinged: !!pivot, age: 0, still: 0,
      pvx: body.vx, pvy: body.vy, pva: body.va, landed: false, whooshed: false,
      lastX: fit.cx, lastY: fit.cy, lastA: fit.angle, samples, leaves,
      hitEnemies: new Set(), hitPlayer: false, boxes: fit.boxes, mass: fit.mass,
      debug: { standing, upright, angle: fit.angle, halfW: fit.halfW, halfH: fit.halfH, boxes: fit.boxes.length, footX, footY }, length: Math.max(fit.halfH, fit.halfW) * 2, cause,
    };
    this.falling.push(fall);
    // The crack: a dry snap, splinters at the cut, a groan as it starts to go.
    ctx.audio.sfx('body.tear', footX, footY, { gain: 1.2, pitch: -3 });
    ctx.audio.sfx('body.smash.wood', footX, footY, { gain: 0.55, pitch: -5 });
    ctx.audio.at(footX, footY, () => ctx.audio.creak(1.2), 520);
    ctx.events.emit('floraMoment', { kind: 'crack', x: footX, y: footY, strength: Math.min(1, sprite.woodCount / 300) });
    const bark = sprite.bark;
    for (let k = 0; k < 10; k++) {
      ctx.particles.spawn(footX + (entityRandom() - 0.5) * 4, footY - 1 - entityRandom() * 2, (entityRandom() - 0.5) * 1.6 + dir * 0.4,
        -0.5 - entityRandom() * 1.1, null, shade(bark, 0.8 + entityRandom() * 0.5), 26 + Math.floor(entityRandom() * 20), { grav: 0.09 });
    }
    ctx.events.emit('treeFelled', { x: footX, y: footY, height, dir: fall.dir, cause, cells: sprite.woodCount });
  }

  /* ------------------------------- the fall ------------------------------- */

  private updateFalls(ctx: Ctx): void {
    if (this.falling.length === 0) return;
    const bodies = ctx.rigidBodies.bodies;
    for (let n = this.falling.length - 1; n >= 0; n--) {
      const f = this.falling[n];
      f.age++;
      if (f.world !== ctx.world || !bodies.includes(f.body)) {
        // The physics layer lost it (a solver reset): land it where it was.
        this.restamp(f, f.lastX, f.lastY, f.lastA, false);
        this.falling.splice(n, 1);
        continue;
      }
      const b = f.body;
      f.lastX = b.x; f.lastY = b.y; f.lastA = b.angle;
      const speed = Math.hypot(b.vx, b.vy);
      const spin = Math.abs(b.va);
      const tipSpeed = speed + spin * f.length * 0.5;
      // The hinge: holds through the lean, snaps once the trunk is well over
      // (or once it stops against something it cannot push through).
      if (f.hinged && f.age === HOLD_TICKS) {
        // The fibres give: the lean begins in earnest.
        ctx.rigidBodies.setDamping?.(b, undefined, HINGE_DAMPING);
        ctx.audio.at(b.x, b.y, () => ctx.audio.creak(1), 460);
        ctx.events.emit('floraMoment', { kind: 'lean', x: b.x, y: b.y, strength: 1 });
      }
      if (f.hinged && f.dir !== 0 && f.age >= HOLD_TICKS && f.age < HOLD_TICKS + 14) {
        // Steer the first degrees the way it was cut: a curved trunk's own lean
        // must not swing it back over the wizard who felled it.
        const lean = angleDelta(b.angle, f.a0) * f.dir;
        if (lean < 0.06 || b.va * f.dir < 0.004) {
          const c = Math.cos(b.angle), s = Math.sin(b.angle);
          const up = f.length * 0.35;
          ctx.rigidBodies.applyImpulseAt(b, f.dir * 0.045, 0, b.x + s * up, b.y - c * up);
        }
      }
      if (f.hinged && f.age < HOLD_TICKS) {
        // The hold: a groan and a shiver of leaves while the hinge still holds.
        if (f.age % 6 === 0) this.shedLeaves(ctx, f, 2, false);
      } else if (f.hinged) {
        const lean = Math.abs(angleDelta(b.angle, f.a0));
        if (lean > HINGE_RELEASE_ANGLE || (f.age > 90 && spin < 0.0015)) {
          ctx.rigidBodies.releasePivot?.(b, FREE_DAMPING);
          f.hinged = false;
          ctx.audio.sfx('body.rip', b.x, b.y, { gain: 1.4, pitch: -2 });
          ctx.events.emit('floraMoment', { kind: 'snap', x: b.x, y: b.y, strength: 0.8 });
        } else if (f.age % 26 === 13 && lean < 0.35) {
          ctx.audio.at(b.x, b.y, () => ctx.audio.creak(0.7 + lean), 420);
        }
      }
      if (!f.whooshed && tipSpeed > 3.2) {
        f.whooshed = true;
        ctx.audio.sfx('trick.whip', b.x, b.y, { gain: 0.7, pitch: -9, rate: 0.7 });
        ctx.events.emit('floraMoment', { kind: 'whoosh', x: b.x, y: b.y, strength: Math.min(1, tipSpeed / 6) });
      }
      this.shedLeaves(ctx, f, Math.min(4, Math.floor(spin * 26 + speed * 0.25)), false);
      if (f.burning > 0) this.burnTrail(ctx, f);
      this.crush(ctx, f, tipSpeed);
      // Impacts: an abrupt change of motion (the ground stopped it).
      const dv = Math.hypot(b.vx - f.pvx, b.vy - f.pvy) + Math.abs(b.va - f.pva) * f.length * 0.5;
      if (dv > IMPACT_DV && f.age > 3) this.impact(ctx, f, Math.min(1, (dv - IMPACT_DV) / 5 + 0.15));
      f.pvx = b.vx; f.pvy = b.vy; f.pva = b.va;
      // Settle → the log.
      // A log afloat never quite sleeps: slow and bobbing in a pool counts as at rest.
      const calm = b.inWater ? speed < 0.25 && spin < 0.02 : speed < SETTLE_SPEED && spin < SETTLE_SPIN;
      if (!f.hinged && calm) f.still++;
      else f.still = 0;
      if (f.still >= (b.inWater ? SETTLE_TICKS * 3 : SETTLE_TICKS) || b.sleeping && !f.hinged && f.age > 20 || f.age > FALL_TIMEOUT) {
        if (f.hinged) ctx.rigidBodies.releasePivot?.(b, FREE_DAMPING);
        this.restamp(f, b.x, b.y, b.angle, true);
        ctx.rigidBodies.remove(b);
        this.falling.splice(n, 1);
      }
    }
  }

  /** Leaves let go of a moving crown (conserved: each becomes a real Leaf where it lands). */
  private shedLeaves(ctx: Ctx, f: Falling, count: number, burst: boolean): void {
    if (count <= 0 || f.leaves.length === 0) return;
    const b = f.body;
    const d = b.angle - f.a0, c = Math.cos(d), s = Math.sin(d);
    for (let k = 0; k < count && f.leaves.length > 0; k++) {
      const pick = Math.floor(entityRandom() * f.leaves.length);
      const si = f.leaves[pick];
      f.leaves[pick] = f.leaves[f.leaves.length - 1];
      f.leaves.pop();
      if (f.sprite.kind[si] !== FELL_LEAF) continue;
      f.sprite.kind[si] = 0;
      const sx = si % f.sprite.w, sy = (si / f.sprite.w) | 0;
      const rx = f.sprite.x0 + sx + 0.5 - f.cx0, ry = f.sprite.y0 + sy + 0.5 - f.cy0;
      const wx = b.x + rx * c - ry * s, wy = b.y + rx * s + ry * c;
      // Velocity of that point on the spinning body, plus the air catching it.
      const lx = wx - b.x, ly = wy - b.y;
      const vx = b.vx - b.va * ly, vy = b.vy + b.va * lx;
      const air = burst ? 1.4 : 0.6;
      ctx.particles.spawn(wx, wy, vx * 0.55 + (entityRandom() - 0.5) * air, vy * 0.4 - entityRandom() * air * 0.6,
        Cell.Leaf, f.sprite.color[si], 60 + Math.floor(entityRandom() * 60), { grav: 0.035, deposit: true });
    }
  }

  /** A trunk that comes down burning trails sparks and drops real flame. */
  private burnTrail(ctx: Ctx, f: Falling): void {
    const b = f.body;
    if ((f.age & 1) !== 0 || f.samples.length === 0) return;
    const [lx, ly] = f.samples[Math.floor(entityRandom() * f.samples.length)];
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const wx = b.x + lx * c - ly * s, wy = b.y + lx * s + ly * c;
    ctx.particles.spawn(wx, wy, (entityRandom() - 0.5) * 0.6, -0.5 - entityRandom() * 0.5, null,
      packRGB(255, 130 + Math.floor(entityRandom() * 80), 30), 20, { grav: -0.02, glow: 2.4 });
    if (entityRandom() < 0.3 * f.burning) {
      const gx = Math.floor(wx), gy = Math.floor(wy - 1);
      if (f.world.inBounds(gx, gy)) {
        const i = f.world.idx(gx, gy);
        if (f.world.types[i] === Cell.Empty) { f.world.replaceCellAt(i, Cell.Fire, fireColor()); f.world.life[i] = 14; }
      }
    }
  }

  /** Moving wood strikes what it passes through: creatures and the wizard. */
  private crush(ctx: Ctx, f: Falling, tipSpeed: number): void {
    if (tipSpeed < CRUSH_MIN_SPEED || ctx.state.mode !== 'play') return;
    const b = f.body;
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const reach = Math.hypot(b.shape.kind === 'box' ? b.shape.halfW : 1, b.shape.kind === 'box' ? b.shape.halfH : 1) + 12;
    // Returns the contact speed if the box set (local frame) overlaps the given world AABB.
    const contact = (ex: number, eyTop: number, eyBot: number, halfW: number): number => {
      const ey = (eyTop + eyBot) / 2, halfH = (eyBot - eyTop) / 2;
      const dx = ex - b.x, dy = ey - b.y;
      if (Math.abs(dx) > reach + halfW || Math.abs(dy) > reach + halfH) return 0;
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      // entity half-extents projected on the body axes
      const ex2 = Math.abs(halfW * c) + Math.abs(halfH * s), ey2 = Math.abs(halfW * s) + Math.abs(halfH * c);
      for (const bx of f.boxes) {
        if (Math.abs(lx - bx.x) <= bx.halfW + ex2 && Math.abs(ly - bx.y) <= bx.halfH + ey2) {
          // speed of the body at the contact point
          const px = ex - b.x, py = ey - b.y;
          return Math.hypot(b.vx - b.va * py, b.vy + b.va * px);
        }
      }
      return 0;
    };
    const massF = Math.sqrt(Math.max(0.3, Math.min(3, f.mass / 150)));
    for (const e of ctx.enemies) {
      if (e.hp <= 0 || f.hitEnemies.has(e)) continue;
      const def = ctx.enemyCtl.defs[e.kind];
      if (!def) continue;
      const v = contact(e.x, e.y - def.h, e.y, def.halfW);
      if (v < CRUSH_MIN_SPEED) continue;
      f.hitEnemies.add(e);
      const dmg = Math.round(Math.min(160, 10 + v * 12 * massF));
      const side = Math.sign(e.x - b.x) || f.dir || 1;
      ctx.enemyCtl.damage(e, dmg, side * (1.2 + v * 0.3), 1.2, 'flattened');
      ctx.fx.hitstop = Math.max(ctx.fx.hitstop, 3);
      ctx.audio.at(e.x, e.y, () => { ctx.audio.landThud(0.8); ctx.audio.squelch(); }, 420);
      ctx.particles.burst(e.x, e.y - def.h * 0.5, 10, null, () => shade(f.sprite.bark, 0.9), 1.6, { grav: 0.08 });
    }
    const p = ctx.player;
    if (!f.hitPlayer && !p.dead && p.invuln <= 0) {
      const v = contact(p.x, p.y - PLAYER_H, p.y, PLAYER_HALF_W);
      if (v >= CRUSH_MIN_SPEED) {
        f.hitPlayer = true;
        const dmg = Math.round(Math.max(8, Math.min(30, 4 + v * 4.2 * Math.min(1.4, massF))));
        const side = Math.sign(p.x - b.x) || -f.dir || 1;
        ctx.playerCtl.damage(dmg, side * (2 + v * 0.35), -1.4, 'falling-tree');
        ctx.fx.screenShake = Math.min(0.05, ctx.fx.screenShake + 0.02);
      }
    }
  }

  /** The ground stops it: dust along the contact, a thud, the world answers. */
  private impact(ctx: Ctx, f: Falling, strength: number): void {
    const b = f.body;
    const first = !f.landed;
    f.landed = true;
    const world = f.world;
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    let dustN = 0, sx = 0, sy = 0, contacts = 0;
    const dustCap = first ? 26 : 8;
    for (const [lx, ly] of f.samples) {
      const wx = b.x + lx * c - ly * s, wy = b.y + lx * s + ly * c;
      const gx = Math.floor(wx), gy = Math.floor(wy);
      let touching = false;
      for (const [ox, oy] of [[0, 1], [0, 2], [1, 1], [-1, 1], [0, 0]]) {
        if (!world.inBounds(gx + ox, gy + oy)) continue;
        const t = world.types[world.idx(gx + ox, gy + oy)];
        if (blocksEntity(t)) { touching = true; break; }
      }
      if (!touching) continue;
      contacts++; sx += wx; sy += wy;
      if (dustN < dustCap && entityRandom() < 0.7) {
        dustN++;
        ctx.particles.spawn(wx + (entityRandom() - 0.5) * 2, wy, (entityRandom() - 0.5) * 1.8 * strength, -0.25 - entityRandom() * 0.7 * strength,
          null, packRGB(128 + Math.floor(entityRandom() * 20), 116, 98), 30 + Math.floor(entityRandom() * 30), { grav: 0.018 });
      }
      if (first && strength > 0.3) this.smashBrittle(ctx, world, gx, gy + 1);
    }
    const ix = contacts ? sx / contacts : b.x, iy = contacts ? sy / contacts : b.y;
    const size = Math.min(1, strength * (0.6 + f.mass / 500));
    if (first) {
      this.shedLeaves(ctx, f, Math.ceil(f.leaves.length * 0.28), true);
      ctx.audio.boom(4 + size * 8, ix, iy);
      ctx.audio.sfx('body.impact.wood', ix, iy, { gain: 1.3, pitch: -6 });
      ctx.audio.at(ix, iy, () => ctx.audio.landThud(Math.min(1, 0.4 + size)), 560);
      ctx.events.emit('floraMoment', { kind: 'rustle', x: ix, y: iy - 6, strength: size });
      const camDx = ix - (ctx.camera.x + 320), camDy = iy - (ctx.camera.y + 180);
      const near = Math.max(0, 1 - Math.hypot(camDx, camDy) / 460);
      ctx.fx.screenShake = Math.min(0.045, ctx.fx.screenShake + (0.01 + size * 0.025) * near);
      ctx.events.emit('groundImpact', { x: ix, y: iy, radius: 40 + size * 60, strength: Math.min(1, 0.4 + size) });
      this.emittingImpact = true;
      try {
        ctx.events.emit('structureStrike', { x: ix, y: iy, radius: Math.round(6 + size * 14) });
      } finally {
        this.emittingImpact = false;
      }
      this.shakeNear(world, ix, iy, 30 + size * 30, 0);
    } else if (strength > 0.25) {
      ctx.audio.at(ix, iy, () => ctx.audio.landThud(Math.min(0.7, strength * 0.6)), 420);
    }
    ctx.events.emit('treeLanded', { x: ix, y: iy, strength, first });
  }

  /** A hard landing breaks what is brittle under it: glass panes, ice, crust. */
  private smashBrittle(ctx: Ctx, world: World, gx: number, gy: number): void {
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx, y = gy + dy;
      if (!world.inBounds(x, y)) continue;
      const i = world.idx(x, y);
      const t = world.types[i];
      if (t === Cell.Glass || t === Cell.Ice || t === Cell.Snow) {
        const col = world.colors[i];
        world.clearCellAt(i);
        ctx.particles.spawn(x + 0.5, y + 0.5, (entityRandom() - 0.5) * 2, -0.8 - entityRandom() * 1.4,
          t === Cell.Glass ? null : Cell.Water, t === Cell.Glass ? glassColor() : col, 40, { grav: 0.1, glow: t === Cell.Glass ? 0.6 : 0 });
        if (t === Cell.Glass && entityRandom() < 0.2) ctx.audio.at(x, y, () => ctx.audio.shatter(x, y), 380);
      }
    }
  }

  /** At rest: write the log back into the grid, and keep bodies out of it. */
  private restamp(f: Falling, x: number, y: number, a: number, live: boolean): void {
    const ctx = this.ctx;
    const world = f.world;
    const res = restampFell(world, f.sprite, f.cx0, f.cy0, f.a0, x, y, a, {
      rand: entityRandom,
      fireColor,
    });
    if (!live || world !== ctx.world) return;
    // Nothing is left inside the new wood: the wizard and creatures step up onto it.
    const p = ctx.player;
    if (!p.dead && !ctx.physics.entityFree(p.x, p.y, PLAYER_HALF_W, PLAYER_H)) {
      for (let up = 1; up <= 40; up++) {
        if (ctx.physics.entityFree(p.x, p.y - up, PLAYER_HALF_W, PLAYER_H)) { p.y -= up; p.vy = Math.min(p.vy, 0); break; }
      }
    }
    for (const e of ctx.enemies) {
      const def = ctx.enemyCtl.defs[e.kind];
      if (!def || e.hp <= 0) continue;
      if (e.x < res.bounds.x0 - def.halfW || e.x > res.bounds.x1 + def.halfW || e.y < res.bounds.y0 || e.y - def.h > res.bounds.y1) continue;
      if (ctx.physics.entityFree(e.x, e.y, def.halfW, def.h)) continue;
      for (let up = 1; up <= 30; up++) {
        if (ctx.physics.entityFree(e.x, e.y - up, def.halfW, def.h)) { e.y -= up; break; }
      }
    }
    // Settling puff and a last groan of the wood.
    const cx = (res.bounds.x0 + res.bounds.x1) / 2, cy = res.bounds.y1;
    ctx.particles.burst(cx, cy, 6, null, () => packRGB(130, 118, 100), 0.6, { grav: 0.03 });
    ctx.audio.at(cx, cy, () => ctx.audio.creak(0.35), 380);
    ctx.events.emit('floraMoment', { kind: 'settle', x: cx, y: cy, strength: Math.min(1, res.wood / 250) });
    ctx.events.emit('treeSettled', { x: cx, y: cy, cells: res.wood });
  }

  /* --------------------------- shaking & the kick --------------------------- */

  /** Set up to `count` attached leaves in a box loose (they flutter down). */
  private shakeLeaves(world: World, x0: number, y0: number, x1: number, y1: number, count: number): void {
    if (count <= 0) return;
    x0 = Math.max(1, x0); y0 = Math.max(1, y0); x1 = Math.min(world.width - 2, x1); y1 = Math.min(world.height - 2, y1);
    if (x1 <= x0 || y1 <= y0) return;
    let freed = 0;
    for (let tries = 0; tries < count * 12 && freed < count; tries++) {
      const x = x0 + Math.floor(entityRandom() * (x1 - x0 + 1));
      const y = y0 + Math.floor(entityRandom() * (y1 - y0 + 1));
      const i = world.idx(x, y);
      if (world.types[i] !== Cell.Leaf) continue;
      const life = world.life[i];
      if (life >= 0 || life === LEAF_LITTER) continue;
      // Only leaves with air under them can visibly drop.
      if (world.types[i + world.width] !== Cell.Empty) continue;
      world.life[i] = 1 + Math.floor(entityRandom() * 7);
      world.activity.touchIndex(i);
      freed++;
    }
  }

  /** Shake the plants near a point: pods let go, a few leaves fall. */
  private shakeNear(world: World, x: number, y: number, radius: number, extraLeaves: number): void {
    const r = Math.min(60, Math.ceil(radius));
    const x0 = Math.max(1, Math.floor(x - r)), x1 = Math.min(world.width - 2, Math.ceil(x + r));
    const y0 = Math.max(1, Math.floor(y - r)), y1 = Math.min(world.height - 2, Math.ceil(y + r));
    let pods = 0;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0, i = x0 + yy * world.width; xx <= x1; xx++, i++) {
        if (world.types[i] !== Cell.Seed) continue;
        const life = world.life[i];
        if (life !== SEED_THIRSTY_HELD && life !== SEED_GLOW_HELD) continue;
        world.life[i] = life === SEED_GLOW_HELD ? SEED_GLOW_LOOSE : SEED_THIRSTY_LOOSE;
        world.activity.touchIndex(i);
        pods++;
      }
    }
    this.shakeLeaves(world, x0, y0, x1, y1, Math.min(14, 3 + extraLeaves + Math.floor(r / 10)));
    if (pods > 0) {
      const ctx = this.ctx;
      ctx.audio.sfx('mat.drip', x, y, { pitch: 4, gain: 0.8 });
      ctx.events.emit('floraMoment', { kind: 'podDrop', x, y, strength: Math.min(1, pods / 6) });
    }
  }

  gust(ctx: Ctx, gustAt: GustFalloff, dirX: number, dirY: number, ox: number, oy: number): void {
    const world = ctx.world;
    const dir = Math.abs(dirX) > 0.2 ? Math.sign(dirX) : 0;
    this.hints.push({ kind: 'kick', x0: ox, y0: oy, x1: ox, y1: oy, radius: 12, dir: dir || 1, t: ctx.state.frameCount });
    this.trimHints();
    // Find living wood the boot actually meets (nearest cells in the cone).
    const R = 16;
    const bx = Math.floor(ox), by = Math.floor(oy);
    let hitX = -1, hitY = -1, best = Infinity;
    for (let yy = by - R; yy <= by + R; yy++) {
      for (let xx = bx - R; xx <= bx + R; xx++) {
        if (!world.inBounds(xx, yy)) continue;
        const t = world.types[world.idx(xx, yy)];
        if (t !== Cell.Trunk) continue;
        if (gustAt(xx + 0.5, yy + 0.5) <= 0) continue;
        const d = Math.hypot(xx - ox, yy - oy);
        if (d < best) { best = d; hitX = xx; hitY = yy; }
      }
    }
    // Loose litter in the cone is blown along (it lands again as real leaves).
    let blown = 0;
    for (let yy = by - 22; yy <= by + 22 && blown < 40; yy++) {
      for (let xx = bx - 22; xx <= bx + 22 && blown < 40; xx++) {
        if (!world.inBounds(xx, yy)) continue;
        const i = world.idx(xx, yy);
        if (world.types[i] !== Cell.Leaf || world.life[i] !== LEAF_LITTER) continue;
        const g = gustAt(xx + 0.5, yy + 0.5);
        if (g <= 0) continue;
        const col = world.colors[i];
        world.clearCellAt(i);
        ctx.particles.spawn(xx + 0.5, yy + 0.5, dirX * (1.2 + g * 3) + (entityRandom() - 0.5), dirY * (1 + g * 2) - 0.8 - entityRandom(),
          Cell.Leaf, col, 50 + Math.floor(entityRandom() * 40), { grav: 0.03, deposit: true });
        blown++;
      }
    }
    if (hitX < 0) return;
    this.scratch.ensure(world.types.length);
    const stand = floodStand(world, hitX, hitY, this.scratch, this.scratch.next());
    const height = stand.y1 - stand.y0 + 1;
    const rustle = (): void => {
      ctx.audio.sfx('player.vine', hitX, hitY, { gain: 0.9 });
      ctx.events.emit('floraMoment', { kind: 'rustle', x: hitX, y: hitY, strength: 0.5 });
    };
    if (stand.supported && !stand.capped && stand.count <= SAPLING_MAX_CELLS && height <= SAPLING_MAX_HEIGHT) {
      // A sapling snaps at the boot: its footing rows break into splinters.
      let snapped = 0;
      for (let yy = stand.y1; yy >= stand.y0 && snapped < 3; yy--) {
        let row = 0;
        for (let xx = stand.x0; xx <= stand.x1; xx++) {
          const i = world.idx(xx, yy);
          if (world.types[i] !== Cell.Trunk) continue;
          // only the exposed part above ground snaps
          if (standSupport(world.types[i - 1]) && standSupport(world.types[i + 1])) continue;
          world.clearCellAt(i);
          row++;
          ctx.particles.spawn(xx + 0.5, yy + 0.5, dir * (0.6 + entityRandom()), -0.4 - entityRandom() * 0.5, null,
            shade(world.colors[i] || packRGB(140, 110, 80), 1), 24, { grav: 0.08 });
        }
        if (row > 0) snapped++;
      }
      ctx.audio.sfx('body.rip', hitX, hitY, { pitch: 3 });
      ctx.events.emit('floraMoment', { kind: 'snap', x: hitX, y: hitY, strength: 0.4 });
      rustle();
      return;
    }
    // A grown tree: the boot shakes it. Pods drop, the crown sheds.
    const cx = (stand.x0 + stand.x1) / 2;
    this.shakeNear(world, cx, stand.y0 + Math.min(height, 40) * 0.4, Math.max(16, (stand.x1 - stand.x0) / 2 + LEAF_REACH), 4);
    ctx.audio.at(hitX, hitY, () => ctx.audio.creak(0.35), 360);
    rustle();
  }

  /* ------------------------------- glowseeds ------------------------------- */

  /** Loose glowseeds are picked up by walking over them (the Bellows' lure seeds). */
  private collectGlowseeds(ctx: Ctx): void {
    const living = ctx.levels.current?.living;
    const p = ctx.player;
    if (!living || p.dead) return;
    const world = ctx.world;
    const x0 = Math.floor(p.x - 7), x1 = Math.floor(p.x + 7), y0 = Math.floor(p.y - PLAYER_H), y1 = Math.floor(p.y + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!world.inBounds(x, y)) continue;
        const i = world.idx(x, y);
        if (world.types[i] !== Cell.Seed || world.life[i] !== SEED_GLOW_LOOSE) continue;
        if (living.glowseeds >= 3) {
          if (this.pouchToastT <= 0) {
            ctx.events.emit('toast', { text: 'Your glowseed pouch is full.' });
            this.pouchToastT = 600;
          }
          return;
        }
        // The whole pod: every loose glowseed touching this one.
        const pod = [i];
        const seen = new Set<number>([i]);
        for (let h = 0; h < pod.length && pod.length < 16; h++) {
          const pi = pod[h], py = (pi / world.width) | 0, px = pi - py * world.width;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!world.inBounds(px + dx, py + dy)) continue;
            const ni = world.idx(px + dx, py + dy);
            if (seen.has(ni) || world.types[ni] !== Cell.Seed || !isGlowseedLife(world.life[ni])) continue;
            seen.add(ni);
            pod.push(ni);
          }
        }
        for (const ci of pod) world.clearCellAt(ci);
        living.glowseeds = Math.min(3, living.glowseeds + 1);
        ctx.particles.burst(x + 0.5, y, 10, null, () => packRGB(214, 244, 150), 1.2, { glow: 2, grav: -0.02 });
        ctx.audio.pickup();
        ctx.events.emit('toast', { text: `A glowseed pod. ${living.glowseeds} in the pouch.` });
        return;
      }
    }
  }

  /* ------------------------------ persistence ------------------------------ */

  writeSnapshotCells(world: World, types: Uint8Array, life: Int16Array): void {
    for (const f of this.falling) {
      if (f.world !== world) continue;
      const b = spriteBounds(f.sprite, f.cx0, f.cy0, f.a0, f.lastX, f.lastY, f.lastA);
      for (let y = Math.max(0, Math.floor(b.y0)); y <= Math.min(world.height - 1, Math.ceil(b.y1)); y++) {
        for (let x = Math.max(0, Math.floor(b.x0)); x <= Math.min(world.width - 1, Math.ceil(b.x1)); x++) {
          const si = spriteSampleAt(f.sprite, f.cx0, f.cy0, f.a0, f.lastX, f.lastY, f.lastA, x + 0.5, y + 0.5);
          if (si < 0) continue;
          const k = f.sprite.kind[si];
          const i = x + y * world.width;
          if (types[i] !== Cell.Empty && !isGas(types[i])) continue;
          if (k === FELL_WOOD || k === FELL_EMBER) { types[i] = Cell.Wood; life[i] = 0; }
          else if (k === FELL_LEAF) { types[i] = Cell.Leaf; life[i] = 0; }
          else if (k === FELL_SEED || k === FELL_GLOWSEED) { types[i] = Cell.Seed; life[i] = k === FELL_GLOWSEED ? SEED_GLOW_LOOSE : SEED_THIRSTY_LOOSE; }
        }
      }
    }
  }
}

/* --------------------------------- helpers --------------------------------- */

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function segmentDistance(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0;
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
}

function shade(color: number, k: number): number {
  return packRGB(Math.min(255, Math.round(unpackR(color) * k)), Math.min(255, Math.round(unpackG(color) * k)), Math.min(255, Math.round(unpackB(color) * k)));
}

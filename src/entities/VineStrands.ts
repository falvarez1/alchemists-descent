import type {
  Ctx,
  VineStrandNodeView,
  VineStrandSegmentView,
  VineStrandView,
  VineStrandsApi,
} from '@/core/types';
import { blocksEntity, Cell, isSoftGrowth, isSolid } from '@/sim/CellType';
import { ashColor, packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';
import type { World } from '@/sim/World';
import { VIEW_H, VIEW_W } from '@/config/constants';

const SUPPORT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

const SETTLE_LINE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, 1],
  [0, -1],
  [-1, 0],
  [1, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

const MAX_CLUSTER_CELLS = 192;
const MAX_ACTIVE_STRANDS = 48;
const GRAVITY = 0.18;
const DAMPING = 0.985;
const SOLVER_ITERATIONS = 4;
const SETTLE_FRAMES = 38;
const MAX_AGE_FRAMES = 720;
const PLAYER_PUSH_RADIUS = 20;
const PLAYER_PUSH_STRENGTH = 1.4;
// Hanging cell-vines come ALIVE near the camera: each is lifted into a soft Verlet
// strand (so it sways like the ropes), then settles back to its cells when far.
const LIFT_PER_PASS = 4; // most clusters lifted per scan (spreads the flood-fill cost)
const LIFT_SCAN_CADENCE = 8; // frames between on-screen scans for new tendrils
const TENDRIL_MIN_CELLS = 4; // shorter vine specks aren't worth a soft body
const TENDRIL_MAX_WIDTH = 4; // only THIN hanging tendrils sway; loops/drapes stay static cover
const TENDRIL_FAR_MARGIN = 120; // cells past the view before a lifted vine re-settles
const SHAKE_SWAY_MIN = 0.012; // screenShake below this doesn't stir the vines
const SHAKE_SWAY_GAIN = 12; // shake → per-node jitter amplitude
const WEB_MIN_NODES = 9;
const WEB_MAX_NODES = 30;
const WEB_DEFAULT_LIFETIME = 540;
const WEB_ASH_MAX_FLECKS = 9;
const WEB_ASH_LIFETIME = 180;

interface VineNode extends VineStrandNodeView {
  x: number;
  y: number;
  px: number;
  py: number;
  contact: boolean;
  pinX?: number;
  pinY?: number;
}

interface VineSegment extends VineStrandSegmentView {
  a: number;
  b: number;
  rest: number;
}

interface VineStrand extends VineStrandView {
  nodes: VineNode[];
  segments: VineSegment[];
  color: number;
  age: number;
  settleT: number;
  /** Persistent hanging strand: node 0 is pinned to (anchorX, anchorY) and it
   *  never settles back into cells (a rope / thick vine you can swing through). */
  persistent?: boolean;
  anchorX?: number;
  anchorY?: number;
  thickness?: number;
  /** Lifted-from-cells hanging vine: pinned at the top like a persistent rope, but
   *  it re-settles to its ORIGINAL cells when it drifts far off-screen (or is cut). */
  tendril?: boolean;
  originCells?: number[];
  originColor?: number;
  /** Player is swinging on this strand: it lays taut from anchor to (grabX,grabY). */
  grabbed?: boolean;
  grabX?: number;
  grabY?: number;
  /** Weaver web strand: pinned line/lattice or free launched spit. */
  web?: boolean;
  freeWeb?: boolean;
  tailX?: number;
  tailY?: number;
  maxAge?: number;
  denWeb?: boolean;
  ashOnExpire?: boolean;
}

export class VineStrands implements VineStrandsApi {
  readonly strands: VineStrand[] = [];
  private readonly eventDisposers: Array<() => void> = [];
  private readonly clusterQueueX = new Int16Array(MAX_CLUSTER_CELLS);
  private readonly clusterQueueY = new Int16Array(MAX_CLUSTER_CELLS);
  private readonly clusterCellIndexes = new Int32Array(MAX_CLUSTER_CELLS);
  private readonly clusterNodeByCell = new Map<number, number>();

  constructor(private readonly ctx: Ctx) {
    this.eventDisposers.push(ctx.events.on('levelChanged', () => this.clear()));
  }

  dispose(): void {
    for (const dispose of this.eventDisposers.splice(0).reverse()) dispose();
  }

  detachCluster(x: number, y: number): boolean {
    const world = this.ctx.world;
    if (!world.inBounds(x, y)) return false;
    const start = world.idx(x, y);
    if (world.types[start] !== Cell.Vines) return false;

    const queueX = this.clusterQueueX;
    const queueY = this.clusterQueueY;
    const cellIndexes = this.clusterCellIndexes;
    const nodeByCell = this.clusterNodeByCell;
    nodeByCell.clear();
    let head = 0;
    let count = 1;
    let anchored = false;
    let truncated = false;
    let colorR = 0;
    let colorG = 0;
    let colorB = 0;

    queueX[0] = x;
    queueY[0] = y;
    cellIndexes[0] = start;
    nodeByCell.set(start, 0);

    while (head < count) {
      const cx = queueX[head];
      const cy = queueY[head];
      const ci = cellIndexes[head];
      const color = world.colors[ci];
      colorR += unpackR(color);
      colorG += unpackG(color);
      colorB += unpackB(color);
      head++;

      for (const [dx, dy] of SUPPORT_OFFSETS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!world.inBounds(nx, ny)) continue;
        const ni = world.idx(nx, ny);
        const nt = world.types[ni];
        if (nt === Cell.Vines) {
          if (nodeByCell.has(ni)) continue;
          if (count >= MAX_CLUSTER_CELLS) {
            truncated = true;
            continue;
          }
          nodeByCell.set(ni, count);
          queueX[count] = nx;
          queueY[count] = ny;
          cellIndexes[count] = ni;
          count++;
        } else if (isLoadBearingAnchor(nt)) {
          anchored = true;
        }
      }
    }

    if (anchored || truncated) return false;
    if (!this.reserveDetachedStrandSlot(world)) return false;

    const nodes: VineNode[] = [];
    for (let i = 0; i < count; i++) {
      const sway = (Math.random() - 0.5) * 0.18 + (i % 2 === 0 ? 0.035 : -0.035);
      const fall = 0.05 + Math.random() * 0.08;
      nodes.push({
        x: queueX[i] + 0.5,
        y: queueY[i] + 0.5,
        px: queueX[i] + 0.5 - sway,
        py: queueY[i] + 0.5 - fall,
        contact: false,
      });
      world.clearCellAt(cellIndexes[i]);
    }

    const segments: VineSegment[] = [];
    for (let i = 0; i < count; i++) {
      const cx = queueX[i];
      const cy = queueY[i];
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (!world.inBounds(cx + dx, cy + dy)) continue;
        const ni = nodeByCell.get(world.idx(cx + dx, cy + dy));
        if (ni === undefined) continue;
        segments.push({ a: i, b: ni, rest: 1 });
      }
    }

    const inv = 1 / count;
    this.strands.push({
      nodes,
      segments,
      color: packRGB(Math.round(colorR * inv), Math.round(colorG * inv), Math.round(colorB * inv)),
      age: 0,
      settleT: 0,
    });
    return true;
  }

  addHanging(x: number, y: number, length: number, opts: { thickness?: number; color?: number } = {}): void {
    const n = Math.max(2, Math.floor(length));
    const ax = x + 0.5;
    const ay = y + 0.5;
    const nodes: VineNode[] = [];
    for (let i = 0; i < n; i++) {
      nodes.push({ x: ax, y: ay + i, px: ax, py: ay + i, contact: false });
    }
    const segments: VineSegment[] = [];
    for (let i = 0; i + 1 < n; i++) segments.push({ a: i, b: i + 1, rest: 1 });
    this.strands.push({
      nodes,
      segments,
      color: opts.color ?? packRGB(70, 118, 48),
      age: 0,
      settleT: 0,
      persistent: true,
      anchorX: ax,
      anchorY: ay,
      thickness: Math.max(1, Math.round(opts.thickness ?? 1)),
    });
  }

  addWebLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    opts: { thickness?: number; color?: number; slack?: number; lifetime?: number; kickX?: number; kickY?: number } = {},
  ): void {
    if (!this.reserveWebStrandSlot()) return;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const n = Math.max(WEB_MIN_NODES, Math.min(WEB_MAX_NODES, Math.ceil(len / 5)));
    const slack = opts.slack ?? 0.16;
    const kickX = opts.kickX ?? (dx / len) * 0.9;
    const kickY = opts.kickY ?? (dy / len) * 0.35 - 0.45;
    const nodes: VineNode[] = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const sag = Math.sin(t * Math.PI) * Math.min(28, len * slack);
      const flutter = Math.sin(t * Math.PI * 4.0) * 0.9;
      const x = x0 + dx * t + flutter;
      const y = y0 + dy * t + sag;
      const free = Math.sin(t * Math.PI);
      nodes.push({
        x,
        y,
        px: x - kickX * free,
        py: y - kickY * free,
        contact: false,
      });
    }
    const segments: VineSegment[] = [];
    for (let i = 0; i + 1 < n; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      segments.push({ a: i, b: i + 1, rest: Math.hypot(b.x - a.x, b.y - a.y) });
    }
    this.strands.push({
      nodes,
      segments,
      color: opts.color ?? packRGB(80, 190, 72),
      age: 0,
      settleT: 0,
      web: true,
      anchorX: x0,
      anchorY: y0,
      tailX: x1,
      tailY: y1,
      thickness: Math.max(1, Math.round(opts.thickness ?? 1)),
      maxAge: Math.max(90, Math.round(opts.lifetime ?? WEB_DEFAULT_LIFETIME)),
    });
  }

  addWebShot(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    opts: {
      length?: number;
      speed?: number;
      thickness?: number;
      color?: number;
      slack?: number;
      lifetime?: number;
      ashOnExpire?: boolean;
    } = {},
  ): void {
    if (!this.reserveWebStrandSlot()) return;

    const d = Math.hypot(dirX, dirY);
    if (d < 0.001) return;
    const nx = dirX / d;
    const ny = dirY / d;
    const px = -ny;
    const py = nx;
    const len = Math.max(24, Math.min(150, opts.length ?? 112));
    const n = Math.max(WEB_MIN_NODES, Math.min(WEB_MAX_NODES, Math.ceil(len / 5)));
    const speed = Math.max(0.2, Math.min(6, opts.speed ?? 3.4));
    const slack = Math.max(0, Math.min(0.22, opts.slack ?? 0.045));
    const nodes: VineNode[] = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const side = Math.sin(t * Math.PI * 3.0) * Math.min(4.5, len * slack);
      const sag = Math.sin(t * Math.PI) * Math.min(9, len * slack);
      const nodeX = x + nx * len * t + px * side;
      const nodeY = y + ny * len * t + py * side + sag;
      const lead = 0.42 + t * 0.72;
      const ripple = Math.sin(t * Math.PI * 2.0) * 0.18;
      const vx = nx * speed * lead + px * ripple;
      const vy = ny * speed * lead + py * ripple - 0.1 * (1 - t);
      nodes.push({
        x: nodeX,
        y: nodeY,
        px: nodeX - vx,
        py: nodeY - vy,
        contact: false,
      });
    }
    const segments: VineSegment[] = [];
    for (let i = 0; i + 1 < n; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      segments.push({ a: i, b: i + 1, rest: Math.hypot(b.x - a.x, b.y - a.y) });
    }
    this.strands.push({
      nodes,
      segments,
      color: opts.color ?? packRGB(80, 190, 72),
      age: 0,
      settleT: 0,
      web: true,
      freeWeb: true,
      thickness: Math.max(1, Math.round(opts.thickness ?? 1)),
      maxAge: Math.max(45, Math.round(opts.lifetime ?? WEB_DEFAULT_LIFETIME)),
      ashOnExpire: opts.ashOnExpire === true,
    });
  }

  addWebLattice(
    cx: number,
    cy: number,
    radius: number,
    opts: { radials?: number; rings?: number; color?: number; thickness?: number; jitter?: number } = {},
  ): void {
    if (!this.reserveWebStrandSlot()) return;

    const radials = Math.max(6, Math.min(14, Math.round(opts.radials ?? 10)));
    const rings = Math.max(3, Math.min(8, Math.round(opts.rings ?? 5)));
    const jitter = opts.jitter ?? 0.09;
    const nodes: VineNode[] = [];
    const center: VineNode = { x: cx, y: cy, px: cx, py: cy, contact: false };
    nodes.push(center);
    const nodeAt = (ring: number, spoke: number): number => 1 + (ring - 1) * radials + (spoke % radials);

    for (let ring = 1; ring <= rings; ring++) {
      const rt = ring / rings;
      const baseRadius = radius * rt;
      for (let spoke = 0; spoke < radials; spoke++) {
        const angle =
          (spoke / radials) * Math.PI * 2 +
          Math.sin(ring * 1.7 + spoke * 0.63) * jitter +
          rt * 0.22;
        const wobble = 1 + Math.sin(spoke * 2.1 + ring * 0.9) * 0.045;
        const x = cx + Math.cos(angle) * baseRadius * wobble;
        const y = cy + Math.sin(angle) * baseRadius * wobble * 0.72;
        const outer = ring === rings;
        nodes.push({
          x,
          y,
          px: x + Math.sin(spoke * 1.9) * 0.12,
          py: y - Math.cos(ring + spoke) * 0.12,
          contact: false,
          pinX: outer ? x : undefined,
          pinY: outer ? y : undefined,
        });
      }
    }

    const segments: VineSegment[] = [];
    const addSeg = (a: number, b: number, slack = 1): void => {
      const na = nodes[a];
      const nb = nodes[b];
      segments.push({ a, b, rest: Math.hypot(nb.x - na.x, nb.y - na.y) * slack });
    };
    for (let spoke = 0; spoke < radials; spoke++) {
      addSeg(0, nodeAt(1, spoke), 1.02);
      for (let ring = 1; ring < rings; ring++) addSeg(nodeAt(ring, spoke), nodeAt(ring + 1, spoke), 1.04);
    }
    for (let ring = 1; ring <= rings; ring++) {
      for (let spoke = 0; spoke < radials; spoke++) {
        addSeg(nodeAt(ring, spoke), nodeAt(ring, spoke + 1), ring % 2 === 0 ? 1.03 : 1.08);
        if (ring < rings && spoke % 2 === ring % 2) addSeg(nodeAt(ring, spoke), nodeAt(ring + 1, spoke + 1), 1.1);
      }
    }

    this.strands.push({
      nodes,
      segments,
      color: opts.color ?? packRGB(72, 164, 68),
      age: 0,
      settleT: 0,
      web: true,
      denWeb: true,
      thickness: Math.max(1, Math.round(opts.thickness ?? 1)),
    });
  }

  private reserveDetachedStrandSlot(world: World): boolean {
    if (this.strands.length < MAX_ACTIVE_STRANDS) return true;

    let victim = this.strands.findIndex((s) => !s.web && !s.persistent && !s.tendril);
    if (victim === -1) victim = this.strands.findIndex((s) => s.tendril);
    if (victim === -1) return false;

    const removed = this.strands.splice(victim, 1)[0];
    if (removed.tendril) this.settleTendril(world, removed);
    else this.settleStrand(world, removed);
    return true;
  }

  private reserveWebStrandSlot(): boolean {
    if (this.strands.length < MAX_ACTIVE_STRANDS) return true;

    const world = this.ctx.world;
    const selectors: Array<(s: VineStrand) => boolean> = [
      (s) => !s.web && !s.persistent && !s.tendril,
      (s) => s.tendril === true,
      (s) => s.web === true && s.denWeb !== true,
      (s) => s.persistent === true && s.grabbed !== true && s.web !== true,
    ];
    for (const select of selectors) {
      const victim = this.strands.findIndex(select);
      if (victim === -1) continue;
      const removed = this.strands.splice(victim, 1)[0];
      if (removed.tendril) this.settleTendril(world, removed);
      else if (!removed.web && !removed.persistent) this.settleStrand(world, removed);
      return true;
    }
    return false;
  }

  grabSwing(px: number, py: number, maxDist: number): { anchorX: number; anchorY: number; length: number } | null {
    let best: VineStrand | null = null;
    let bestD = maxDist * maxDist;
    for (const s of this.strands) {
      if (!s.persistent) continue;
      for (const n of s.nodes) {
        const dx = n.x - px;
        const dy = n.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          best = s;
        }
      }
    }
    if (!best) return null;
    best.grabbed = true;
    best.grabX = px;
    best.grabY = py;
    const ax = best.anchorX ?? best.nodes[0].x;
    const ay = best.anchorY ?? best.nodes[0].y;
    return { anchorX: ax, anchorY: ay, length: Math.hypot(px - ax, py - ay) };
  }

  driveSwing(px: number, py: number): void {
    for (const s of this.strands) {
      if (s.grabbed) {
        s.grabX = px;
        s.grabY = py;
      }
    }
  }

  releaseSwing(): void {
    for (const s of this.strands) {
      if (s.grabbed) {
        s.grabbed = false;
        s.grabX = undefined;
        s.grabY = undefined;
      }
    }
  }

  update(ctx: Ctx): void {
    this.manageHangingVines(ctx); // lift on-screen cell-vines; re-settle far ones
    this.shakeSway(ctx.fx?.screenShake ?? 0); // the world shakes → live vines quiver
    for (let i = this.strands.length - 1; i >= 0; i--) {
      const strand = this.strands[i];
      this.stepStrand(ctx, strand);
      if (strand.web && strand.maxAge !== undefined && strand.age >= strand.maxAge) {
        if (strand.ashOnExpire) this.shedStrandAsh(ctx.world, strand);
        this.strands.splice(i, 1);
        continue;
      }
      if (this.shouldSettle(strand)) {
        this.settleStrand(ctx.world, strand);
        this.strands.splice(i, 1);
      }
    }
  }

  /**
   * Hanging cell-vines become Verlet soft bodies near the camera (so they sway to
   * your approach, the kick gust, blasts, and the world shaking) and settle back
   * into their original cells when they drift far off-screen. The vine stays REAL
   * grid material — it's only "soft" while you're close enough to see it move.
   */
  private manageHangingVines(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || !ctx.camera) return;
    const world = ctx.world;
    const camX = Math.floor(ctx.camera.x);
    const camY = Math.floor(ctx.camera.y);
    // Re-settle tendrils that drifted well past the view back into cells.
    for (let i = this.strands.length - 1; i >= 0; i--) {
      const s = this.strands[i];
      if (!s.tendril) continue;
      const ax = s.anchorX ?? 0;
      const ay = s.anchorY ?? 0;
      if (
        ax < camX - TENDRIL_FAR_MARGIN || ax > camX + VIEW_W + TENDRIL_FAR_MARGIN ||
        ay < camY - TENDRIL_FAR_MARGIN || ay > camY + VIEW_H + TENDRIL_FAR_MARGIN
      ) {
        this.settleTendril(world, s);
        this.strands.splice(i, 1);
      }
    }
    // Scan the view (throttled) for ceiling-hung vine tops and lift them.
    if (ctx.state.frameCount % LIFT_SCAN_CADENCE !== 0 || this.strands.length >= MAX_ACTIVE_STRANDS) return;
    const x0 = Math.max(1, camX);
    const y0 = Math.max(1, camY);
    const x1 = Math.min(world.width - 2, camX + VIEW_W);
    const y1 = Math.min(world.height - 2, camY + VIEW_H);
    let lifted = 0;
    for (let y = y0; y <= y1 && lifted < LIFT_PER_PASS && this.strands.length < MAX_ACTIVE_STRANDS; y++) {
      const row = y * world.width;
      for (let x = x0; x <= x1 && lifted < LIFT_PER_PASS && this.strands.length < MAX_ACTIVE_STRANDS; x++) {
        if (world.types[row + x] !== Cell.Vines) continue;
        // a tendril TOP hangs from load-bearing solid directly above
        if (!isLoadBearingAnchor(world.types[row + x - world.width])) continue;
        if (this.liftHangingCluster(world, x, y)) lifted++;
      }
    }
  }

  /** Flood a ceiling-hung vine cluster from its top (sx,sy) and lift it into a soft
   *  tendril strand pinned at that top; clears the cells (the strand IS them now).
   *  Returns false if it isn't a danging tendril (no free bottom / too small). */
  private liftHangingCluster(world: World, sx: number, sy: number): boolean {
    const queueX = this.clusterQueueX;
    const queueY = this.clusterQueueY;
    const cellIndexes = this.clusterCellIndexes;
    const nodeByCell = this.clusterNodeByCell;
    nodeByCell.clear();
    let head = 0;
    let count = 1;
    let truncated = false;
    let hasFreeBottom = false;
    let minX = sx, maxX = sx;
    let colorR = 0;
    let colorG = 0;
    let colorB = 0;
    queueX[0] = sx;
    queueY[0] = sy;
    cellIndexes[0] = world.idx(sx, sy);
    nodeByCell.set(cellIndexes[0], 0);

    while (head < count) {
      const cx = queueX[head];
      const cy = queueY[head];
      const ci = cellIndexes[head];
      head++;
      const color = world.colors[ci];
      colorR += unpackR(color);
      colorG += unpackG(color);
      colorB += unpackB(color);
      if (world.inBounds(cx, cy + 1) && world.types[world.idx(cx, cy + 1)] === Cell.Empty) hasFreeBottom = true;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      for (const [dx, dy] of SUPPORT_OFFSETS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!world.inBounds(nx, ny)) continue;
        const ni = world.idx(nx, ny);
        if (world.types[ni] !== Cell.Vines || nodeByCell.has(ni)) continue;
        if (count >= MAX_CLUSTER_CELLS) {
          truncated = true;
          continue;
        }
        nodeByCell.set(ni, count);
        queueX[count] = nx;
        queueY[count] = ny;
        cellIndexes[count] = ni;
        count++;
      }
    }
    if (truncated || count < TENDRIL_MIN_CELLS || !hasFreeBottom) return false;
    if (maxX - minX > TENDRIL_MAX_WIDTH) return false; // a loop/drape/branchy clump — leave it as static cover

    const nodes: VineNode[] = [];
    for (let i = 0; i < count; i++) {
      nodes.push({ x: queueX[i] + 0.5, y: queueY[i] + 0.5, px: queueX[i] + 0.5, py: queueY[i] + 0.5, contact: false });
    }
    const segments: VineSegment[] = [];
    for (let i = 0; i < count; i++) {
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const ni = nodeByCell.get(world.idx(queueX[i] + dx, queueY[i] + dy));
        if (ni !== undefined) segments.push({ a: i, b: ni, rest: 1 });
      }
    }
    const inv = 1 / count;
    const color = packRGB(Math.round(colorR * inv), Math.round(colorG * inv), Math.round(colorB * inv));
    const origin: number[] = [];
    for (let i = 0; i < count; i++) {
      origin.push(cellIndexes[i]);
      world.clearCellAt(cellIndexes[i]); // the strand now holds these cells
    }
    this.strands.push({
      nodes,
      segments,
      color,
      age: 0,
      settleT: 0,
      tendril: true,
      anchorX: sx + 0.5, // node 0 is the top — pinned here
      anchorY: sy + 0.5,
      originCells: origin,
      originColor: color,
    });
    return true;
  }

  /** Re-paint a lifted tendril back to its ORIGINAL cells (snap to shape, no drift). */
  private settleTendril(world: World, strand: VineStrand): void {
    if (!strand.originCells) {
      this.settleStrand(world, strand);
      return;
    }
    const color = strand.originColor ?? strand.color;
    for (const i of strand.originCells) {
      if (world.types[i] !== Cell.Empty) continue;
      world.replaceCellAt(i, Cell.Vines, color);
      world.life[i] = -1;
      world.moved[i] = world.movedTick;
    }
  }

  /** The world shaking (explosions) stirs every live vine — a jitter that grows
   *  toward the free end so a dangling tendril visibly trembles and swings. */
  private shakeSway(shake: number): void {
    if (shake < SHAKE_SWAY_MIN) return;
    const amp = Math.min(0.7, shake * SHAKE_SWAY_GAIN);
    for (const strand of this.strands) {
      if (strand.grabbed) continue;
      const n = strand.nodes.length;
      for (let k = 1; k < n; k++) {
        const node = strand.nodes[k];
        node.px -= (Math.random() - 0.5) * amp * (k / n);
      }
    }
  }

  clear(): void {
    this.strands.length = 0;
  }

  applyRadialImpulse(cx: number, cy: number, radius: number, strength: number): void {
    if (radius <= 0 || strength === 0) return;
    for (const strand of this.strands) {
      for (const node of strand.nodes) {
        const dx = node.x - cx;
        const dy = node.y - cy;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const f = (1 - d / radius) * strength;
        const nx = dx / (d || 1);
        const ny = dy / (d || 1);
        node.px -= nx * f;
        node.py -= ny * f;
      }
    }
  }

  private stepStrand(ctx: Ctx, strand: VineStrand): void {
    strand.age++;
    // Player swinging on this vine: lay it taut from the anchor to the grabbed
    // hand point (the pendulum physics lives in PlayerControl).
    if (strand.grabbed && strand.grabX !== undefined && strand.grabY !== undefined) {
      const ax = strand.anchorX ?? strand.nodes[0].x;
      const ay = strand.anchorY ?? strand.nodes[0].y;
      const n = strand.nodes.length;
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0;
        const nd = strand.nodes[i];
        nd.x = ax + (strand.grabX - ax) * t;
        nd.y = ay + (strand.grabY - ay) * t;
        nd.px = nd.x;
        nd.py = nd.y;
      }
      return;
    }
    // A hanging rope/vine (or lifted tendril) that loses the solid it hangs from
    // (terrain dug/blasted away) stops being pinned and falls + settles like a cut
    // vine. Checked before integration so it releases the same frame.
    if ((strand.persistent || strand.tendril) && !this.anchorSupported(ctx.world, strand)) {
      strand.persistent = false;
      strand.tendril = false; // a cut tendril becomes a normal falling strand → settles where it lands
    }
    let contacts = 0;
    let speedSum = 0;
    const playerActive = ctx.state.mode === 'play' && !ctx.player.dead;
    const px = ctx.player.x;
    const py = ctx.player.y - 8;

    for (let i = 0; i < strand.nodes.length; i++) {
      const node = strand.nodes[i];
      const vx = (node.x - node.px) * DAMPING;
      const vy = (node.y - node.py) * DAMPING;
      node.px = node.x;
      node.py = node.y;
      node.x += vx + Math.sin((strand.age + i * 13) * 0.09) * 0.012;
      node.y += vy + GRAVITY;
      if (playerActive) this.pushFromPlayer(node, px, py);
      if (this.resolveTerrain(ctx.world, node)) contacts++;
    }

    for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
      for (const segment of strand.segments) this.solveSegment(strand.nodes, segment);
      // Pin the anchor through the solve so the rope hangs from a fixed point.
      if (strand.persistent || strand.tendril || strand.web) this.pinAnchors(strand);
      for (const node of strand.nodes) this.resolveTerrain(ctx.world, node);
    }
    if (strand.persistent || strand.tendril || strand.web) this.pinAnchors(strand);

    for (const node of strand.nodes) {
      speedSum += Math.hypot(node.x - node.px, node.y - node.py);
      if (node.contact) contacts++;
    }
    const avgSpeed = speedSum / Math.max(1, strand.nodes.length);
    if (contacts > 0 && avgSpeed < 0.035) strand.settleT++;
    else strand.settleT = Math.max(0, strand.settleT - 2);
  }

  private pushFromPlayer(node: VineNode, px: number, py: number): void {
    const dx = node.x - px;
    const dy = node.y - py;
    const d = Math.hypot(dx, dy);
    if (d <= 0.001 || d > PLAYER_PUSH_RADIUS) return;
    const push = ((PLAYER_PUSH_RADIUS - d) / PLAYER_PUSH_RADIUS) * PLAYER_PUSH_STRENGTH;
    const ix = (dx / d) * push;
    const iy = (dy / d) * push;
    node.x += ix;
    node.y += iy;
    // Bias px/py back HARDER than the position bump so the shove imparts real
    // velocity (x − px) — the rope keeps swaying after the player passes through,
    // instead of the solver snapping it straight the next frame.
    node.px -= ix * 0.55;
    node.py -= iy * 0.4;
  }

  private solveSegment(nodes: VineNode[], segment: VineSegment): void {
    const a = nodes[segment.a];
    const b = nodes[segment.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const pull = ((dist - segment.rest) / dist) * 0.5;
    const ox = dx * pull;
    const oy = dy * pull;
    a.x += ox;
    a.y += oy;
    b.x -= ox;
    b.y -= oy;
  }

  private resolveTerrain(world: World, node: VineNode): boolean {
    node.contact = false;
    node.x = Math.max(1.5, Math.min(world.width - 2.5, node.x));
    node.y = Math.max(1.5, Math.min(world.height - 2.5, node.y));
    if (!this.nodeBlocked(world, node.x, node.y)) return false;

    if (!this.nodeBlocked(world, node.px, node.y)) {
      node.x = node.px;
    } else if (!this.nodeBlocked(world, node.x, node.py)) {
      node.y = node.py;
    } else {
      const bx = Math.floor(node.x);
      const by = Math.floor(node.y);
      for (const [dx, dy] of SETTLE_LINE_OFFSETS) {
        const nx = bx + dx + 0.5;
        const ny = by + dy + 0.5;
        if (this.nodeBlocked(world, nx, ny)) continue;
        node.x = nx;
        node.y = ny;
        break;
      }
    }
    node.px = node.x;
    node.py = node.y;
    node.contact = true;
    return true;
  }

  private nodeBlocked(world: World, x: number, y: number): boolean {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (!world.inBounds(cx, cy)) return true;
    return blocksEntity(world.types[world.idx(cx, cy)]);
  }

  private pinAnchor(strand: VineStrand): void {
    const a = strand.nodes[0];
    a.x = strand.anchorX ?? a.x;
    a.y = strand.anchorY ?? a.y;
    a.px = a.x;
    a.py = a.y;
  }

  private pinAnchors(strand: VineStrand): void {
    if (!strand.denWeb && !strand.freeWeb) this.pinAnchor(strand);
    if (strand.web && strand.tailX !== undefined && strand.tailY !== undefined) {
      const b = strand.nodes[strand.nodes.length - 1];
      b.x = strand.tailX;
      b.y = strand.tailY;
      b.px = b.x;
      b.py = b.y;
    }
    for (const node of strand.nodes) {
      if (node.pinX === undefined || node.pinY === undefined) continue;
      node.x = node.pinX;
      node.y = node.pinY;
      node.px = node.x;
      node.py = node.y;
    }
  }

  /** A hanging strand is supported while there is load-bearing terrain at, or
   *  directly above, its top anchor point (what it's tied to). */
  private anchorSupported(world: World, strand: VineStrand): boolean {
    const cx = Math.floor(strand.anchorX ?? 0);
    const cy = Math.floor(strand.anchorY ?? 0);
    return this.isAnchorCell(world, cx, cy) || this.isAnchorCell(world, cx, cy - 1);
  }

  private isAnchorCell(world: World, cx: number, cy: number): boolean {
    if (!world.inBounds(cx, cy)) return false;
    return isLoadBearingAnchor(world.types[world.idx(cx, cy)]);
  }

  private shouldSettle(strand: VineStrand): boolean {
    if (strand.persistent) return false; // hanging ropes/vines never settle to cells
    if (strand.tendril) return false; // lifted vines re-settle via manageHangingVines (far/cut)
    if (strand.web) return false; // Weaver threads are live strands; they fade instead of freezing into lines
    if (strand.settleT >= SETTLE_FRAMES) return true;
    return strand.age >= MAX_AGE_FRAMES && strand.settleT > 0;
  }

  private settleStrand(world: World, strand: VineStrand): void {
    this.settleStrandAs(world, strand, Cell.Vines, () => strand.color, 1.6);
  }

  private shedStrandAsh(world: World, strand: VineStrand): void {
    const stride = Math.max(2, Math.ceil(strand.nodes.length / WEB_ASH_MAX_FLECKS));
    for (let i = 0; i < strand.nodes.length; i += stride) {
      this.paintLooseAshAt(world, strand.nodes[i].x, strand.nodes[i].y);
    }
  }

  private paintLooseAshAt(world: World, x: number, y: number): void {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (!world.inBounds(cx, cy)) return;
    const i = world.idx(cx, cy);
    if (world.types[i] !== Cell.Empty) return;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!world.inBounds(nx, ny)) continue;
        if (blocksEntity(world.types[world.idx(nx, ny)])) return;
      }
    }
    world.replaceCellAt(i, Cell.Ash, ashColor());
    world.life[i] = WEB_ASH_LIFETIME;
    world.moved[i] = world.movedTick;
  }

  private settleStrandAs(
    world: World,
    strand: VineStrand,
    cellType: Cell,
    colorFn: () => number,
    density: number,
  ): void {
    for (const segment of strand.segments) {
      const a = strand.nodes[segment.a];
      const b = strand.nodes[segment.b];
      this.paintLineAs(world, a.x, a.y, b.x, b.y, cellType, colorFn, density);
    }
    if (strand.segments.length === 0) {
      for (const node of strand.nodes) this.paintCellAt(world, node.x, node.y, cellType, colorFn());
    }
  }

  private paintLineAs(
    world: World,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    cellType: Cell,
    colorFn: () => number,
    density: number,
  ): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * density));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.paintCellAt(world, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, cellType, colorFn());
    }
  }

  private paintCellAt(world: World, x: number, y: number, cellType: Cell, color: number): void {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (!world.inBounds(cx, cy)) return;
    const i = world.idx(cx, cy);
    if (world.types[i] !== Cell.Empty) return;
    world.replaceCellAt(i, cellType, color);
    world.life[i] = -1;
    world.moved[i] = world.movedTick;
  }

}

function isLoadBearingAnchor(t: number): boolean {
  return isSolid(t) && !isSoftGrowth(t);
}

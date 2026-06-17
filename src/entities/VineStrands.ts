import type {
  Ctx,
  VineStrandNodeView,
  VineStrandSegmentView,
  VineStrandView,
  VineStrandsApi,
} from '@/core/types';
import { blocksEntity, Cell, isSoftGrowth, isSolid } from '@/sim/CellType';
import { packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';
import type { World } from '@/sim/World';

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

interface VineNode extends VineStrandNodeView {
  x: number;
  y: number;
  px: number;
  py: number;
  contact: boolean;
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
  /** Player is swinging on this strand: it lays taut from anchor to (grabX,grabY). */
  grabbed?: boolean;
  grabX?: number;
  grabY?: number;
}

export class VineStrands implements VineStrandsApi {
  readonly strands: VineStrand[] = [];

  constructor(private readonly ctx: Ctx) {
    ctx.events.on('levelChanged', () => this.clear());
  }

  detachCluster(x: number, y: number): boolean {
    const world = this.ctx.world;
    if (!world.inBounds(x, y)) return false;
    const start = world.idx(x, y);
    if (world.types[start] !== Cell.Vines) return false;

    const queueX = new Int16Array(MAX_CLUSTER_CELLS);
    const queueY = new Int16Array(MAX_CLUSTER_CELLS);
    const cellIndexes = new Int32Array(MAX_CLUSTER_CELLS);
    const nodeByCell = new Map<number, number>();
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
    if (this.strands.length >= MAX_ACTIVE_STRANDS) {
      // Evict the oldest NON-persistent strand (never settle a hanging rope/vine).
      const victim = this.strands.findIndex((s) => !s.persistent);
      if (victim === -1) return false;
      this.settleStrand(world, this.strands.splice(victim, 1)[0]);
    }

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
    for (let i = this.strands.length - 1; i >= 0; i--) {
      const strand = this.strands[i];
      this.stepStrand(ctx, strand);
      if (this.shouldSettle(strand)) {
        this.settleStrand(ctx.world, strand);
        this.strands.splice(i, 1);
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
    // A hanging rope/vine that loses the solid it hangs from (terrain or the
    // object dug/blasted away) stops being pinned and falls + settles like a cut
    // vine. Checked before integration so it releases the same frame.
    if (strand.persistent && !this.anchorSupported(ctx.world, strand)) {
      strand.persistent = false;
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
      if (strand.persistent) this.pinAnchor(strand);
      for (const node of strand.nodes) this.resolveTerrain(ctx.world, node);
    }
    if (strand.persistent) this.pinAnchor(strand);

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
    if (strand.settleT >= SETTLE_FRAMES) return true;
    return strand.age >= MAX_AGE_FRAMES && strand.settleT > 0;
  }

  private settleStrand(world: World, strand: VineStrand): void {
    for (const segment of strand.segments) {
      const a = strand.nodes[segment.a];
      const b = strand.nodes[segment.b];
      this.paintLine(world, a.x, a.y, b.x, b.y, strand.color);
    }
    if (strand.segments.length === 0) {
      for (const node of strand.nodes) this.paintVineAt(world, node.x, node.y, strand.color);
    }
  }

  private paintLine(world: World, x0: number, y0: number, x1: number, y1: number, color: number): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.6));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.paintVineAt(world, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, color);
    }
  }

  private paintVineAt(world: World, x: number, y: number, color: number): void {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (!world.inBounds(cx, cy)) return;
    const i = world.idx(cx, cy);
    if (world.types[i] !== Cell.Empty) return;
    world.replaceCellAt(i, Cell.Vines, color);
    world.life[i] = -1;
    world.moved[i] = world.movedTick;
  }

}

function isLoadBearingAnchor(t: number): boolean {
  return isSolid(t) && !isSoftGrowth(t);
}

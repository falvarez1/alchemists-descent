import { YARD } from '@/world/fighterArena';
import { DUEL } from '@/world/duelStage';

/**
 * STAGE NAV (docs/arena/AI-FIGHTERS.md 2.4): where a bot can stand on a stage and how it gets between those places.
 * For the Proving Yard it is hand-authored from the `YARD` constants: a few NODES (a standing surface: an x span at a
 * height) and EDGES between them with the move that crosses each (`jump`, `levitate`, `drop`, `walk`). The floor is ONE
 * node: the obstacles on it (the rim posts, the cover pillars, a lamp) are hopped by Control as it meets them, so the nav
 * only has to know the places a bot cannot simply walk to. A new stage needs its own `StageNav` until the automatic
 * standing-cell graph (phase 6) replaces this.
 *
 * Heights are FEET rows (the row a standing body occupies: one above the surface it stands on).
 */

export type NavEdgeKind = 'walk' | 'jump' | 'levitate' | 'drop';

export interface NavNode {
  id: string;
  name: string;
  x0: number;
  x1: number;
  /** The feet row of a body standing on it. */
  y: number;
}

export interface NavEdge {
  from: string;
  to: string;
  kind: NavEdgeKind;
  /** Stand here on `from` to begin (a rise starts beside the ledge's edge, never under it). */
  launchX: number;
  /** Aim to land here on `to`. */
  landX: number;
  /** The feet row to rise ABOVE before crossing sideways (the lip, plus whatever stands on it). */
  clearY: number;
  /** Which way the crossing goes (+1 right). */
  dir: 1 | -1;
  cost: number;
}

/** How far (cells) either side of a node's span, and how far (rows) off its height, still counts as standing on it. */
const SPAN_SLACK = 6;
const HEIGHT_SLACK = 10;

export class StageNav {
  private readonly byId = new Map<string, NavNode>();
  private readonly out = new Map<string, NavEdge[]>();

  constructor(
    readonly nodes: readonly NavNode[],
    readonly edges: readonly NavEdge[],
    /** Where a bot goes when it sees nothing: a place a fight is likely to be. */
    readonly patrolX: number,
  ) {
    for (const n of nodes) this.byId.set(n.id, n);
    for (const e of edges) {
      const list = this.out.get(e.from) ?? [];
      list.push(e);
      this.out.set(e.from, list);
    }
  }

  node(id: string): NavNode | undefined {
    return this.byId.get(id);
  }

  /** The node a body at (x, feet y) stands on, or null (in the air, or off the map). The closest in height wins. */
  nodeAt(x: number, y: number): NavNode | null {
    let best: NavNode | null = null;
    let bestDy = Infinity;
    for (const n of this.nodes) {
      if (x < n.x0 - SPAN_SLACK || x > n.x1 + SPAN_SLACK) continue;
      const dy = Math.abs(y - n.y);
      if (dy > HEIGHT_SLACK || dy >= bestDy) continue;
      best = n;
      bestDy = dy;
    }
    return best;
  }

  /**
   * The edges to take, in order, to get from one node to another (cheapest first), or null when there is no way.
   * `blocked` holds `from>to` keys the stuck detector has given up on for now.
   */
  route(fromId: string, toId: string, blocked?: ReadonlySet<string>): NavEdge[] | null {
    if (fromId === toId) return [];
    const dist = new Map<string, number>([[fromId, 0]]);
    const via = new Map<string, NavEdge>();
    const open = new Set<string>([fromId]);
    while (open.size > 0) {
      let cur = '';
      let curD = Infinity;
      for (const id of open) {
        const d = dist.get(id) ?? Infinity;
        if (d < curD) { cur = id; curD = d; }
      }
      open.delete(cur);
      if (cur === toId) break;
      for (const e of this.out.get(cur) ?? []) {
        if (blocked?.has(edgeKey(e))) continue;
        const nd = curD + e.cost;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          via.set(e.to, e);
          open.add(e.to);
        }
      }
    }
    if (!via.has(toId)) return null;
    const path: NavEdge[] = [];
    for (let at = toId; at !== fromId;) {
      const e = via.get(at);
      if (!e) return null;
      path.push(e);
      at = e.from;
    }
    return path.reverse();
  }
}

export function edgeKey(e: Pick<NavEdge, 'from' | 'to'>): string {
  return `${e.from}>${e.to}`;
}

/**
 * The Proving Yard (world/fighterArena). The hall's numbers: floor row 640 (feet 639), the ring's sand two cells thick
 * (feet 637), the Muster's dais six (feet 633): all one "floor" node, whose obstacles Control hops. Every ledge is
 * reached from beside its edge, never from under it, and every launch column is checked clear of the lamp posts (a
 * lamp is a stone post 2 wide and 12 tall) because a 9-wide body does not fit between a post and a block.
 */
export function yardNav(): StageNav {
  const F = YARD.floor;
  const g = YARD.gallery;
  const k = YARD.kiln;
  const b = YARD.bluff;
  const c = YARD.cell;
  const floorY = F - 1;
  const nodes: NavNode[] = [
    { id: 'floor', name: 'the floor', x0: YARD.x0 + 8, x1: YARD.x1 - 8, y: floorY },
    { id: 'gallery', name: 'the gallery', x0: g.x0, x1: g.x1 - 4, y: g.y - 1 },
    { id: 'kiln', name: 'the kiln lip', x0: k.slabX0 + 12, x1: k.barricadeX0 - 2, y: k.slabTop - 1 },
    { id: 'bluff', name: 'the bluff top', x0: b.x0, x1: b.x1, y: b.top - 1 },
    { id: 'tower', name: 'the bluff ledge', x0: b.ledge.x0, x1: b.ledge.x1 - 5, y: b.ledge.y - 1 },
    { id: 'cell', name: 'the cell lip', x0: c.lip + 8, x1: c.x0 - 1, y: c.slabTop - 1 },
  ];
  const edges: NavEdge[] = [
    // the gallery: a metal plank over the ring's right end, hung from the roof at its right; rise on its open left side
    { from: 'floor', to: 'gallery', kind: 'levitate', launchX: g.x0 - 9, landX: g.x0 + 14, clearY: g.y - 5, dir: 1, cost: 70 },
    { from: 'gallery', to: 'floor', kind: 'drop', launchX: g.x0 + 3, landX: g.x0 - 14, clearY: g.y - 1, dir: -1, cost: 20 },
    // the kiln lip: 30 up, a stone lamp post on its left (the floor lamp at 566, the lip's at 584)
    { from: 'floor', to: 'kiln', kind: 'levitate', launchX: k.slabX0 - 6, landX: k.slabX0 + 14, clearY: k.slabTop - 16, dir: 1, cost: 50 },
    { from: 'kiln', to: 'floor', kind: 'drop', launchX: k.slabX0 + 3, landX: k.slabX0 - 14, clearY: k.slabTop - 1, dir: -1, cost: 20 },
    // the bluff: 96 up. The floor lamp at 880 leaves no standing room under its face, so rise a body-and-a-bit from it
    { from: 'floor', to: 'bluff', kind: 'levitate', launchX: b.x0 - 20, landX: b.x0 + 14, clearY: b.top - 5, dir: 1, cost: 110 },
    { from: 'bluff', to: 'floor', kind: 'drop', launchX: b.x0 + 3, landX: b.x0 - 18, clearY: b.top - 1, dir: -1, cost: 25 },
    { from: 'bluff', to: 'floor', kind: 'drop', launchX: b.x1 - 3, landX: b.x1 + 18, clearY: b.top - 1, dir: 1, cost: 25 },
    // the ledge-tower beside it: 34 above the bluff's top, hung from the roof at its right end
    { from: 'bluff', to: 'tower', kind: 'levitate', launchX: b.x1 - 6, landX: b.ledge.x0 + 14, clearY: b.ledge.y - 5, dir: 1, cost: 45 },
    { from: 'tower', to: 'bluff', kind: 'drop', launchX: b.ledge.x0 + 3, landX: b.x1 - 10, clearY: b.ledge.y - 1, dir: -1, cost: 15 },
    // the cell's lip: 30 up, a lamp post on it (clear its top before crossing); the cell itself is sealed
    { from: 'floor', to: 'cell', kind: 'levitate', launchX: c.lip - 5, landX: c.lip + 11, clearY: c.slabTop - 16, dir: 1, cost: 50 },
    { from: 'cell', to: 'floor', kind: 'drop', launchX: c.lip + 2, landX: c.lip - 14, clearY: c.slabTop - 1, dir: -1, cost: 20 },
  ];
  return new StageNav(nodes, edges, YARD.ring.cx);
}

let yard: StageNav | null = null;
let duel: StageNav | null = null;

/** The Duel side platforms and centre perch need deliberate rises beside their lips. */
export function duelNav(): StageNav {
  const nodes: NavNode[] = [{ id: 'floor', name: 'floor', x0: DUEL.x0 + 8, x1: DUEL.x1 - 8, y: DUEL.floor - 1 }];
  const edges: NavEdge[] = [];
  for (const [i, p] of [...DUEL.platforms, DUEL.perch].entries()) {
    const id = `platform${i}`;
    nodes.push({ id, name: id, x0: p.x0 + 5, x1: p.x1 - 5, y: p.y - 1 });
    // The side platforms have a wall on the outer end. Enter and leave at the inner lip.
    const dir: 1 | -1 = i === 0 ? -1 : 1;
    const lip = dir === 1 ? p.x0 : p.x1;
    edges.push({ from: 'floor', to: id, kind: 'levitate', launchX: lip - dir * 12, landX: lip + dir * 14, clearY: p.y - 5, dir, cost: DUEL.floor - p.y + 30 });
    edges.push({ from: id, to: 'floor', kind: 'drop', launchX: lip + dir * 8, landX: lip - dir * 18, clearY: p.y - 1, dir: dir === 1 ? -1 : 1, cost: 30 });
  }
  return new StageNav(nodes, edges, DUEL.cx);
}

/** The nav for a level id, or null when the stage has none (the bot then only walks and hops). */
export function stageNavFor(levelId: string | undefined): StageNav | null {
  if (levelId === 'fighter-duel') return (duel ??= duelNav());
  if (levelId !== 'fighter-test') return null;
  return (yard ??= yardNav());
}

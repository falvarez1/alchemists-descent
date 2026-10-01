import { HEIGHT, WIDTH } from '@/config/constants';
import type { LevelStorySites } from '@/core/story';
import type { Mechanism, Pickup, RuneVault, Waystone } from '@/core/types';
import { blocksEntity, Cell, isLiquid } from '@/sim/CellType';
import { stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';
import type { CarveAvoid, PlacementLedger } from '@/world/connect';
import { wizardMask } from '@/world/validate';

/**
 * THE FIXTURE FOOTING CONTRACT. A placed fixture is its cells AND the ground
 * under them: a waystone is a stone bowl on a floor, a lever is a bracket on a
 * shelf. Generation carves for a long time after a fixture is stamped —
 * connectors, rescue tunnels, repairs — and every one of those carves eats
 * stone. The waystones' own connectors used to start AT the bowl and take it
 * and eight rows of floor with them (30/30 waystones floated, QA 2026-09-28).
 *
 * Two halves. While generating, each fixture's footing is reserved in the
 * ledger under FOOTING_LABEL, which world/connect treats as a sealed footprint:
 * every later tunnel walks around it (cost-based, fail-open). At the very end,
 * holdFixtureFootings re-asserts every stamp and puts ground back under
 * anything a carve still undercut — and never at the price of a route: a
 * fixture's fill that costs the alchemist standing room anywhere but on the
 * fill itself is taken back whole (fail-open).
 */

/** Label prefix of a reserved footing (world/connect SEALED_LABEL matches it). */
export const FOOTING_LABEL = 'footing-';
/** Rows of ground under a fixture that later tunnels leave alone. */
const FOOTING_DEPTH = 8;
/** The deepest undercut a plinth fills; a deeper one gets a lip instead. */
const PLINTH_MAX = 12;
/** The farthest the golden key is let fall to its floor (a longer drop is a shaft a body cannot follow). */
const KEY_DROP_MAX = 24;
/** How far along its own ground row a deep-undercut fixture looks for rock to hang a lip from. */
const BRIDGE_MAX = 10;
/** How far below a hand-trigger with nothing to hang from looks for ground to stand on... */
const RELOCATE_MAX = 160;
/** ...and how far to either side it looks for that ground. */
const RELOCATE_REACH = 60;

export function waystoneFooting(ws: { x: number; y: number }): CarveAvoid {
  return { x0: ws.x - 4, y0: ws.y - 1, x1: ws.x + 4, y1: ws.y + FOOTING_DEPTH };
}

export function cauldronFooting(c: { x: number; y: number }): CarveAvoid {
  return { x0: c.x - 5, y0: c.y - 1, x1: c.x + 5, y1: c.y + FOOTING_DEPTH };
}

/** A hand-trigger's bracket/bowl/sill and the shelf under it (null: no footing to keep). */
export function triggerFooting(m: Mechanism): CarveAvoid | null {
  if (m.kind === 'lever' && !m.look) return { x0: m.x - 2, y0: m.y + 1, x1: m.x + 2, y1: m.y + 1 + FOOTING_DEPTH };
  if (m.kind === 'brazier') return { x0: m.x - 3, y0: m.y - 1, x1: m.x + 3, y1: m.y + FOOTING_DEPTH };
  if (m.kind === 'plate' || m.kind === 'scale') return { x0: m.x - 1, y0: m.y, x1: m.x + m.w, y1: m.y + FOOTING_DEPTH };
  return null;
}

/** A rune glyph's metal pedestal (two rows under the glyph) and the rock under it. */
export function runeFooting(v: { rx: number; ry: number }): CarveAvoid {
  return { x0: v.rx - 3, y0: v.ry + 2, x1: v.rx + 3, y1: v.ry + 2 + FOOTING_DEPTH };
}

export function reserveFooting(ledger: PlacementLedger, r: CarveAvoid | null, what: string): void {
  if (r) ledger.reserve(r.x0, r.y0, r.x1, r.y1, FOOTING_LABEL + what);
}

/** Reserve the footing of every hand-trigger not yet reserved (prefab and set-piece ones included). */
export function reserveTriggerFootings(ledger: PlacementLedger, mechanisms: readonly Mechanism[], done: Set<Mechanism>): void {
  for (const m of mechanisms) {
    if (done.has(m)) continue;
    done.add(m);
    reserveFooting(ledger, triggerFooting(m), m.kind);
  }
}

export type Fill = [index: number, type: number, color: number];

/** Each mechanism body's cells as stamped: [index, type, color] of the blocking ones. */
export type BodyRecord = Map<Mechanism, Fill[]>;

/** Bodies whose loss is structural damage (a plug's is its job; a valve and a door re-stamp themselves). */
const restoresBody = (m: Mechanism): boolean => m.kind !== 'plug' && m.kind !== 'valve' && m.kind !== 'door';

/** Record the stamped body of every mechanism not recorded yet (call once all of a pass's mechanisms exist). */
export function recordBodies(world: World, mechanisms: readonly Mechanism[], into: BodyRecord): void {
  for (const m of mechanisms) {
    if (into.has(m) || !m.body?.length || !restoresBody(m)) continue;
    const cells: Fill[] = [];
    for (const [x, y] of m.body) {
      if (!world.inBounds(x, y)) continue;
      const i = world.idx(x, y);
      if (blocksEntity(world.types[i])) cells.push([i, world.types[i], world.colors[i]]);
    }
    into.set(m, cells);
  }
}

export interface FootingInput {
  /** The generated waystone bowls (a prefab's own waystone keeps its authored cells). */
  bowls: readonly Waystone[];
  cauldron: { x: number; y: number } | null;
  /** Every mechanism: bodies are restored and hand-triggers stood on ground. */
  mechanisms: readonly Mechanism[];
  /** The generator's own triggers (placeStructures): their headroom is theirs to clear too. */
  ownTriggers: readonly Mechanism[];
  /** The generator's own rune glyphs (a pedestal two rows under each). */
  runeVaults: readonly RuneVault[];
  pickups: readonly Pickup[];
  story: LevelStorySites | null;
  bodies: BodyRecord;
  spawn: { x: number; y: number };
  /** Cells that are open ON PURPOSE (a live circuit's one-cell port shaft): no footing fills them. */
  keepOpen?: ReadonlyArray<readonly [number, number]>;
}

export interface FootingReport {
  /** Stamp or body cells put back. */
  restamped: number;
  /** Cells of ground laid under undercut fixtures. */
  plinth: number;
  /** Fixtures with no ground within reach to stand them on (left as they are). */
  undercut: string[];
  /** Fixtures whose fill was taken back because it cost standing room elsewhere ("what@x,y"). */
  reverted: string[];
}

const isPowder = (t: number): boolean => t === Cell.Sand || t === Cell.Coal || t === Cell.Gunpowder || t === Cell.Snow;

/**
 * Re-assert every fixture's stamp and footing on the finished grid. Runs after
 * the last carve of generation. Deterministic (no rng; stone tint is paint).
 */
export function holdFixtureFootings(world: World, input: FootingInput): FootingReport {
  const report: FootingReport = { restamped: 0, plinth: 0, undercut: [], reverted: [] };
  // The live circuit's port shaft is one cell wide and sits between two levers' shelves: the
  // lever at its right found (394, 196) open and hung a lip across it, sealing the latch
  // (d4 seed 5, d3b seeds 5 and 7: 'chargelatch' unreachable at generation).
  const keep = new Set((input.keepOpen ?? []).map(([x, y]) => world.idx(x, y)));
  // Every cell this pass turns solid (or moves), with what it was, grouped per
  // fixture: a group whose fill severs a route is taken back whole. Opening a
  // cell can never cost reachability, so opens are not recorded.
  const groups: Group[] = [];
  let group: Fill[] = [];
  const begin = (what: string, trigger?: Mechanism): Group => {
    group = [];
    const g: Group = { what, fills: group, trigger };
    groups.push(g);
    return g;
  };
  /** Hand-triggers with nothing near to stand on: they come down to the ground instead. */
  const unstood: Mechanism[] = [];
  const blocks = (x: number, y: number): boolean => !world.inBounds(x, y) || blocksEntity(world.types[world.idx(x, y)]);
  /**
   * How far open air runs down column x from `row` (capped one past PLINTH_MAX), and whether a kept-open
   * cell lies in it: a plinth may not be poured down a shaft it would plug (d3b seed 7: a story pipe's
   * plinth filled the live circuit vault's whole port column).
   */
  const dropOf = (x: number, row: number): { gap: number; kept: boolean } => {
    let gap = 0;
    while (gap <= PLINTH_MAX && !blocks(x, row + gap)) {
      if (keep.has(world.idx(x, row + gap))) return { gap, kept: true };
      gap++;
    }
    return { gap, kept: false };
  };
  const fill = (x: number, y: number, t: number, color: number): boolean => {
    if (x < 2 || x >= WIDTH - 2 || y < 2 || y >= HEIGHT - 6) return false;
    const i = world.idx(x, y);
    if (blocksEntity(world.types[i]) || keep.has(i)) return false;
    group.push([i, world.types[i], world.colors[i]]);
    world.replaceCellAt(i, t, color);
    return true;
  };
  const open = (x: number, y: number, dry: boolean): void => {
    if (!world.inBounds(x, y)) return;
    const i = world.idx(x, y);
    const t = world.types[i];
    if (t === Cell.Metal || !(blocksEntity(t) || (dry && isLiquid(t)))) return;
    world.clearCellAt(i);
  };
  const stone = (x: number, y: number): void => {
    if (fill(x, y, Cell.Stone, stoneColor())) report.restamped++;
  };
  const ground = (x: number, y: number): void => {
    if (fill(x, y, Cell.Stone, stoneColor())) report.plinth++;
  };
  /** Write a cell whatever it holds (a moved stamp), recording what it was. */
  const put = (x: number, y: number, t: number, color: number): void => {
    if (x < 2 || x >= WIDTH - 2 || y < 2 || y >= HEIGHT - 6) return;
    const i = world.idx(x, y);
    if (world.types[i] === t || world.types[i] === Cell.Metal || keep.has(i)) return;
    group.push([i, world.types[i], world.colors[i]]);
    world.replaceCellAt(i, t, color);
  };
  const clearRect = (x0: number, y0: number, x1: number, y1: number, dry = false): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) open(x, y, dry);
  };
  /**
   * The air a fixture is DRAWN in (the stele over a waystone, the cauldron's
   * vessel): rock there is rock the sprite is painted over. Only natural rock
   * and loose powder are cleared (never a stamp: a secret's wood, a vault's
   * stone door, a shelf), never within two cells of liquid (a rim is left, so
   * no pool is let in), and powder left over the new room is fused so it
   * cannot pour into it.
   */
  const clearRoom = (x0: number, y0: number, x1: number, y1: number): void => {
    const wet = (x: number, y: number): boolean => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (world.inBounds(x + dx, y + dy) && isLiquid(world.types[world.idx(x + dx, y + dy)])) return true;
      }
      return false;
    };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!world.inBounds(x, y)) continue;
        const t = world.types[world.idx(x, y)];
        if ((t === Cell.Wall || isPowder(t)) && !wet(x, y)) open(x, y, false);
      }
    }
    fusePowderRim(world, x0 - 1, y0 - 1, x1 + 1, y1 + 1, input.mechanisms);
  };
  /**
   * Ground under columns x0..x1 from row `row` down: a plinth under every
   * undercut up to PLINTH_MAX deep; a deeper one gets a two-row lip in its
   * ground row, hung from the fixture's own supported columns or from rock at
   * most BRIDGE_MAX along that row (a vault shelf cut back, a slab cut short).
   * A trigger set FLUSH in a shelf (a plate is a sill in it, a lever's bracket
   * is three of its cells) stands where that shelf does: over a deep void it
   * only needs the shelf to go on at one end, or a bridge along it to rock.
   */
  const stand = (what: string, x0: number, x1: number, row: number, flushRow?: number, trigger?: Mechanism): void => {
    begin(`${what}@${x0},${row}`, trigger);
    const deep: number[] = [];
    for (let x = x0; x <= x1; x++) {
      const { gap, kept } = dropOf(x, row);
      if (gap > PLINTH_MAX || kept) deep.push(x);
      else for (let d = 0; d < gap; d++) ground(x, row + d);
    }
    if (deep.length === 0) return;
    if (flushRow !== undefined && (blocks(x0 - 1, flushRow) || blocks(x1 + 1, flushRow))) return;
    // A lip hung from rock: along a flush trigger's own shelf row first, else
    // along the ground row, where the fixture's own supported columns count.
    for (const lipRow of flushRow !== undefined ? [flushRow, row] : [row]) {
      const flush = lipRow === flushRow;
      let from = x0, to = x1;
      let anchored = !flush && deep.length < x1 - x0 + 1;
      for (let d = 1; d <= BRIDGE_MAX && !anchored; d++) {
        if (blocks(x0 - d, lipRow)) {
          from = x0 - d + 1;
          anchored = true;
        } else if (blocks(x1 + d, lipRow)) {
          to = x1 + d - 1;
          anchored = true;
        }
      }
      if (!anchored) continue;
      for (let x = from; x <= to; x++) {
        if (x >= x0 && x <= x1 && (flush || !deep.includes(x))) continue;
        ground(x, lipRow);
        ground(x, lipRow + 1);
      }
      return;
    }
    if (trigger) unstood.push(trigger);
    else report.undercut.push(`${what}@${x0},${row}`);
  };
  /**
   * A hand-trigger over a void with no rock near to hang it from comes down
   * to the ground under it: its old stamp leaves the air and it is set again
   * there (a lever's bracket and a plate's sill flush in that ground, a
   * brazier's bowl on it). The door it opens is linked by id, not by place.
   */
  const relocate = (m: Mechanism): boolean => {
    const cx = m.kind === 'plate' ? m.x + (m.w >> 1) : m.x;
    const from = m.kind === 'lever' ? m.y + 2 : m.y + 1;
    // The nearest dry ground with room over it, below or beside — on the
    // trigger's own side of its door, never in the room it locks.
    const door = input.mechanisms.find((d) => d.kind === 'door' && d.id === m.targetId);
    const doorX = door ? door.x + door.w / 2 : null;
    // (Its own stamp is not ground: it is what is moving.)
    const own = new Set((m.body ?? []).map(([x, y]) => world.idx(x, y)));
    const solid = (x: number, y: number): boolean => blocks(x, y) && !own.has(world.idx(x, y));
    // The span the stamp will cover: a landing whose ground row is solid (or a short plinth from solid)
    // across all of it is preferred over one that leaves columns hanging over a void (d2b expedition 42:
    // a bowl landed on a ledge's last cell with two of its five columns over air).
    const spanHalf = m.kind === 'lever' ? 1 : 2;
    const spanOf = (x: number): [number, number] => (m.kind === 'plate' ? [x - (m.w >> 1), x - (m.w >> 1) + m.w - 1] : [x - spanHalf, x + spanHalf]);
    const supported = (x: number, g: number): boolean => {
      const [a, b] = spanOf(x);
      for (let X = a; X <= b; X++) {
        if (solid(X, g)) continue;
        const d = dropOf(X, g);
        if (d.gap > PLINTH_MAX || d.kept) return false;
      }
      return true;
    };
    let land: { x: number; g: number } | null = null, cost = Infinity;
    for (let dx = -RELOCATE_REACH; dx <= RELOCATE_REACH; dx++) {
      const x = cx + dx;
      if (x < 8 || x >= WIDTH - 8) continue;
      if (doorX !== null && (Math.sign(x - doorX) !== Math.sign(cx - doorX) || Math.abs(x - doorX) < 8)) continue;
      for (let g = from - RELOCATE_REACH / 2; g < from + RELOCATE_MAX && g < HEIGHT - 9; g++) {
        if (!solid(x, g) || solid(x, g - 1)) continue;
        let room = true;
        for (let k = 1; k <= 8 && room; k++) room = !solid(x, g - k) && !isLiquid(world.types[world.idx(x, g - k)]);
        // (a hanging span is a last resort: it costs more than any reach)
        const here = Math.abs(dx) + Math.abs(g - from) / 2 + (room && !supported(x, g) ? 1000 : 0);
        if (room && here < cost) {
          cost = here;
          land = { x, g };
        }
        break;
      }
    }
    if (!land) return false;
    const g = land.g;
    const was = { x: m.x, y: m.y, body: m.body };
    begin(`${m.kind} moved@${m.x},${m.y}`, m).undo = (): void => {
      m.x = was.x;
      m.y = was.y;
      m.body = was.body;
    };
    const sill = m.body?.length ? world.colors[world.idx(m.body[0][0], m.body[0][1])] : stoneColor();
    for (const [x, y] of m.body ?? []) {
      const i = world.idx(x, y);
      const t = world.types[i];
      if (t !== Cell.Stone && !(m.kind === 'plate' && t === Cell.Metal)) continue;
      group.push([i, t, world.colors[i]]);
      world.clearCellAt(i);
    }
    m.x = m.kind === 'plate' ? land.x - (m.w >> 1) : land.x;
    const body: Array<[number, number]> = [];
    if (m.kind === 'lever') {
      m.y = g - 1;
      clearRect(m.x - 2, g - 6, m.x + 2, g - 1);
      for (let dx = -1; dx <= 1; dx++) {
        if (!blocks(m.x + dx, g)) put(m.x + dx, g, Cell.Stone, stoneColor());
        body.push([m.x + dx, g]);
      }
    } else if (m.kind === 'brazier') {
      m.y = g - 1;
      clearRect(m.x - 2, g - 6, m.x + 2, g - 1);
      for (let dx = -2; dx <= 2; dx++) {
        put(m.x + dx, g - 1, Cell.Stone, stoneColor());
        body.push([m.x + dx, g - 1]);
      }
      for (const dx of [-2, 2]) {
        put(m.x + dx, g - 2, Cell.Stone, stoneColor());
        body.push([m.x + dx, g - 2]);
      }
    } else {
      m.y = g;
      for (let dx = 0; dx < m.w; dx++) {
        put(m.x + dx, g, Cell.Metal, sill);
        body.push([m.x + dx, g]);
      }
    }
    m.body = body;
    // ...and short ground under the new stamp's own columns.
    const half = m.kind === 'lever' ? 1 : 2;
    const x0 = m.kind === 'plate' ? m.x : m.x - half;
    const x1 = m.kind === 'plate' ? m.x + m.w - 1 : m.x + half;
    const row = m.kind === 'lever' ? m.y + 2 : m.y + 1;
    for (let x = x0; x <= x1; x++) {
      const { gap, kept } = dropOf(x, row);
      if (gap <= PLINTH_MAX && !kept) for (let d = 0; d < gap; d++) ground(x, row + d);
    }
    return true;
  };

  // ---- the stamps (bowls, basins, bodies): put back what a carve took ----
  for (const ws of input.bowls) {
    const { x, y } = ws;
    begin(`waystone bowl@${x},${y}`);
    for (let dx = -3; dx <= 3; dx++) stone(x + dx, y + 1);
    for (const dx of [-3, 3]) for (const dy of [0, -1]) stone(x + dx, y + dy);
    clearRect(x - 2, y - 1, x + 2, y, true); // the bowl: fire, not water or rock
    clearRect(x - 3, y - 4, x + 3, y - 2); // room to pour
    clearRoom(x - 6, y - 32, x + 6, y - 5); // the stele
  }
  if (input.cauldron) {
    const { x, y } = input.cauldron;
    begin(`cauldron basin@${x},${y}`);
    for (let dx = -4; dx <= 4; dx++) stone(x + dx, y + 1);
    for (const dx of [-4, 4]) for (const dy of [0, -1]) stone(x + dx, y + dy);
    clearRect(x - 3, y - 1, x + 3, y); // the basin (a brew in it is the player's)
    clearRect(x - 4, y - 5, x + 4, y - 2);
    clearRoom(x - 12, y - 12, x + 12, y - 3); // the vessel
  }
  for (const m of input.mechanisms) {
    if (!m.body?.length || !restoresBody(m)) continue;
    // As recorded when stamped; a brazier's bowl and a lever's bracket are
    // stone by construction, so even one wrecked before the record comes back.
    const recorded = new Map((input.bodies.get(m) ?? []).map(([i, t, c]) => [i, [t, c] as const]));
    const byHand = m.kind === 'brazier' || m.kind === 'lever';
    begin(`${m.kind} body@${m.x},${m.y}`);
    for (const [x, y] of m.body) {
      if (!world.inBounds(x, y)) continue;
      const was = recorded.get(world.idx(x, y));
      if (was) {
        if (fill(x, y, was[0], was[1])) report.restamped++;
      } else if (byHand) stone(x, y);
    }
  }
  for (const m of input.ownTriggers) {
    if (m.kind === 'brazier') {
      clearRect(m.x - 1, m.y - 1, m.x + 1, m.y - 1, true);
      clearRect(m.x - 2, m.y - 5, m.x + 2, m.y - 2);
    } else if (m.kind === 'lever' && !m.look) {
      clearRect(m.x - 2, m.y - 5, m.x + 2, m.y);
    }
  }
  for (const v of input.runeVaults) clearRect(v.rx - 2, v.ry - 3, v.rx + 2, v.ry + 1); // the glyph floats in air, not rock

  // ---- the ground under them ----
  for (const ws of input.bowls) stand('waystone', ws.x - 3, ws.x + 3, ws.y + 2);
  if (input.cauldron) stand('cauldron', input.cauldron.x - 4, input.cauldron.x + 4, input.cauldron.y + 2);
  for (const m of input.mechanisms) {
    if (m.kind === 'lever' && !m.look) stand('lever', m.x - 1, m.x + 1, m.y + 2, m.y + 1, m);
    else if (m.kind === 'brazier') stand('brazier', m.x - 2, m.x + 2, m.y + 1, undefined, m);
    else if (m.kind === 'plate') stand('plate', m.x, m.x + m.w - 1, m.y + 1, m.y, m);
    else if (m.kind === 'scale') stand('scale', m.x, m.x + m.w - 1, m.y + 1);
  }
  for (const v of input.runeVaults) stand('rune', v.rx - 2, v.rx + 2, v.ry + 3);
  const story = input.story;
  if (story?.camp) stand('camp', story.camp.x0, story.camp.x1, story.camp.floorY + 1);
  if (story?.valve) {
    stand('valve', story.valve.x - 3, story.valve.x + 3, story.valve.floorY + 1);
    stand('stage', story.valve.stageX - story.valve.stageHalfW, story.valve.stageX + story.valve.stageHalfW, story.valve.floorY + 1);
  }
  for (const p of story?.pipes ?? []) stand('pipe', p.x - 4, p.x + 4, p.floorY + 1);

  // ---- the golden key: in open air, on a floor, under nothing that will fall ----
  for (const p of input.pickups) {
    if (p.kind !== 'key' || p.taken) continue;
    const kx = Math.floor(p.x);
    let ky = Math.floor(p.y);
    clearRect(kx - 2, ky - 4, kx + 2, ky);
    // It drops as the live pickup would, but never into a crack: a slot
    // narrower than the key is floor (d2 expedition 1: the key fell down a
    // one-cell crack and sat four rows inside the rock, QA F4).
    begin(`key floor@${kx},${ky}`);
    // ...and never down a shaft either: a key that fell 94 rows down a five-wide slot sat where no body
    // could follow (d2b seed 8). A drop of more than KEY_DROP_MAX is cut short by a shelf under the key's
    // own cell.
    const ky0 = ky;
    while (ky < HEIGHT - 9 && !blocks(kx, ky + 1)) {
      if (blocks(kx - 1, ky + 1) || blocks(kx + 1, ky + 1)) {
        for (let dx = -2; dx <= 2; dx++) ground(kx + dx, ky + 1);
        break;
      }
      if (ky - ky0 >= KEY_DROP_MAX) {
        ky = ky0;
        for (let dx = -2; dx <= 2; dx++) ground(kx + dx, ky + 1);
        break;
      }
      ky++;
    }
    p.y = ky;
    p.vy = 0;
    fusePowderRim(world, kx - 16, ky - 32, kx + 16, ky + 2, input.mechanisms);
  }

  // ---- fail-open: no fill may cost standing room away from its own fixture ----
  for (const g of holdRoutes(world, groups, input.spawn)) {
    report.reverted.push(g.what);
    // A trigger whose own ground was taken back is still over the void.
    if (g.trigger && !g.what.includes(' body@')) unstood.push(g.trigger);
  }
  // ...then the triggers left over a void come down to the ground, held to
  // the same rule (a move that cuts a route is taken back: the trigger stays).
  const moves: Group[] = [];
  for (const m of unstood) {
    const from = groups.length;
    if (relocate(m)) moves.push(...groups.slice(from));
    else report.undercut.push(`${m.kind}@${m.x},${m.y}`);
  }
  for (const g of holdRoutes(world, moves, input.spawn)) {
    g.undo?.();
    report.reverted.push(g.what);
    if (g.trigger) report.undercut.push(`${g.trigger.kind}@${g.trigger.x},${g.trigger.y}`);
  }
  return report;
}

export interface Group {
  what: string;
  fills: Fill[];
  /** The hand-trigger this group stands (or moves). */
  trigger?: Mechanism;
  /** Put back what a move changed besides cells. */
  undo?: () => void;
}

/**
 * Take back, culprit first, every group whose fills cost the alchemist standing
 * room anywhere but on those fills; returns the groups taken back. The culprit
 * is the fill standing on the edge of what it cut off: the group with the most
 * lost standing room right beside its own cells (the nearest if none borders it).
 */
export function holdRoutes(world: World, groups: readonly Group[], spawn: { x: number; y: number }): Group[] {
  const W = world.width;
  const live = groups.filter((g) => g.fills.length > 0);
  const taken: Group[] = [];
  if (live.length === 0) return taken;
  const all = (): Fill[] => live.flatMap((g) => g.fills);
  const before = reachWithout(world, all(), spawn);
  let lost = lostElsewhere(W, before, wizardMask({ world, spawn }), all());
  while (lost.length > 0 && live.length > 0) {
    const cut = new Set(lost);
    let worst = 0, bestScore = -1, bestD = Infinity;
    live.forEach((g, k) => {
      let score = 0, d = Infinity;
      for (const [i] of g.fills) {
        const x = i % W, y = (i - x) / W;
        for (let fy = y - 5; fy <= y + 22; fy++) for (let fx = x - 9; fx <= x + 9; fx++) if (cut.has(fx + fy * W)) score++;
        if (score === 0) for (let n = 0; n < lost.length; n += 97) d = Math.min(d, Math.abs(x - (lost[n] % W)) + Math.abs(y - Math.floor(lost[n] / W)));
      }
      if (score > bestScore || (score === 0 && bestScore === 0 && d < bestD)) {
        bestScore = score;
        bestD = d;
        worst = k;
      }
    });
    const [g] = live.splice(worst, 1);
    for (let k = g.fills.length - 1; k >= 0; k--) world.replaceCellAt(g.fills[k][0], g.fills[k][1], g.fills[k][2]);
    taken.push(g);
    lost = lostElsewhere(W, before, wizardMask({ world, spawn }), all());
  }
  return taken;
}

/** The wizard mask as it was before `filled` (swapped out, measured, swapped back). */
function reachWithout(world: World, filled: readonly Fill[], spawn: { x: number; y: number }): Uint8Array {
  const now = filled.map(([i]) => world.types[i]);
  for (let k = filled.length - 1; k >= 0; k--) world.types[filled[k][0]] = filled[k][1];
  const mask = wizardMask({ world, spawn });
  filled.forEach(([i], k) => (world.types[i] = now[k]));
  return mask;
}

/**
 * Standing room the alchemist lost anywhere a fill could not simply be standing
 * on. A filled cell takes the feet
 * positions whose 9x17 body box held it (columns +-4, feet rows 0..16 below),
 * and it can turn a loose-rubble stub it touches (sim/collision: fewer than
 * LOOSE_RUBBLE_BLOCKING_CLUSTER cells, reaching at most four further) into
 * wall; losing any position beyond that means a route was cut.
 */
function lostElsewhere(W: number, before: Uint8Array, after: Uint8Array, filled: readonly Fill[]): number[] {
  const local = new Set<number>();
  for (const [i] of filled) {
    const x = i % W, y = (i - x) / W;
    for (let fy = y - 4; fy <= y + 20; fy++) for (let fx = x - 8; fx <= x + 8; fx++) local.add(fx + fy * W);
  }
  const lost: number[] = [];
  for (let i = 0; i < before.length; i++) if (before[i] && !after[i] && !local.has(i)) lost.push(i);
  return lost;
}

/**
 * Fuse loose powder that borders open air inside a rect the key's vault owns
 * (world/encounterLairs hardenCorridorAgainstPowder, the same rim): the vault
 * pocket cut the support from under a powder mass, and the live sim poured it
 * onto the key a few seconds after arrival (d3b seed 1337: eleven rows of
 * gunpowder). Only this rect; a mechanism's own cells (a powder plug) never.
 */
function fusePowderRim(world: World, x0: number, y0: number, x1: number, y1: number, mechanisms: readonly Mechanism[]): void {
  const W = world.width;
  const owned = new Set<number>();
  for (const m of mechanisms) for (const [x, y] of m.body ?? []) if (world.inBounds(x, y)) owned.add(world.idx(x, y));
  for (let y = Math.max(1, y0); y <= Math.min(world.height - 2, y1); y++) {
    for (let x = Math.max(1, x0); x <= Math.min(W - 2, x1); x++) {
      if (world.types[x + y * W] !== Cell.Empty) continue;
      for (const n of [x + (y - 1) * W, x - 1 + y * W, x + 1 + y * W]) {
        if (!isPowder(world.types[n]) || owned.has(n)) continue;
        world.replaceCellAt(n, Cell.Stone, stoneColor());
      }
    }
  }
}

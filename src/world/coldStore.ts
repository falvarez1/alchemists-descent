import { HEIGHT, WIDTH } from '@/config/constants';
import type { Rng } from '@/core/rng';
import { blocksEntity, Cell } from '@/sim/CellType';
import { brineColor, packRGB, snowColor, stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';
import type { PlacementLedger } from '@/world/connect';

/* ============================================================
 * THE COLD STORE — the refrigeration wing's dressing (wave 3).
 *
 * Real cells only, written into open space the player never needs (every
 * stamp keeps a body's clearance), on the level's own forked stream:
 *
 *  - blue ice, recoloured by depth: pale rime at the surface, deep blue at
 *    the core (the generator's ice crusts, and everything this pass freezes);
 *  - ICICLES hanging from every generous ceiling, tapering to a clear tip;
 *  - FROZEN FALLS: sheets of ice down tall wall faces, flaring at the foot;
 *  - SNOW settled in drifts on the store rooms' floors;
 *  - the old plant's REFRIGERATION PIPES along the cold rooms, iron under
 *    frost, hung from the ceiling on hangers (metal: they carry a current);
 *  - BRINE GUTTERS cut into the rooms' floors, stone-lined so they hold:
 *    the coolant still runs, and it still chills whoever wades in it.
 *
 * Candidates are scanned once (every 3rd column) and walked in a shuffled
 * order, as the flora pass does — never blind random probes.
 * ============================================================ */

export interface ColdStoreSite {
  spawn: { x: number; y: number };
  wellX: number;
  /** Keep-clear discs (waystones, the portal, the boss arena, the cauldron). */
  avoid: ReadonlyArray<{ x: number; y: number; r: number }>;
}

interface Spot { x: number; y: number }

function t(world: World, x: number, y: number): number {
  return world.inBounds(x, y) ? world.types[x + y * WIDTH] : Cell.Wall;
}

function isRock(v: number): boolean {
  return v === Cell.Wall || v === Cell.Stone || v === Cell.Ice || v === Cell.RawOre || v === Cell.Coal;
}

function put(world: World, x: number, y: number, type: number, color: number): void {
  if (x < 2 || y < 2 || x >= WIDTH - 2 || y >= HEIGHT - 8) return;
  const i = x + y * WIDTH;
  if (world.types[i] === Cell.Metal) return;
  world.types[i] = type;
  world.colors[i] = color;
  world.life[i] = 0;
  world.charge[i] = 0;
}

function openRun(world: World, x: number, y: number, dx: number, dy: number, cap: number): number {
  let k = 0;
  while (k < cap && t(world, x + dx * (k + 1), y + dy * (k + 1)) === Cell.Empty) k++;
  return k;
}

function shuffle<T>(list: T[], rng: Rng): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
  }
  return list;
}

function clearOf(site: ColdStoreSite, ledger: PlacementLedger, x0: number, y0: number, x1: number, y1: number, pad = 6): boolean {
  if (ledger.intersects(x0 - pad, y0 - pad, x1 + pad, y1 + pad)) return false;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (Math.abs(cx - site.spawn.x) < 50 + (x1 - x0) / 2 && Math.abs(cy - site.spawn.y) < 50 + (y1 - y0) / 2) return false;
  if (Math.abs(cx - site.wellX) < 30 + (x1 - x0) / 2) return false;
  return !site.avoid.some((a) => Math.hypot(cx - a.x, cy - a.y) < a.r * 0.8 + Math.max(x1 - x0, y1 - y0) / 2);
}

/** Every 3rd column: ceilings (air under rock), floors (air over rock), wall faces. */
function scan(world: World): { ceilings: Spot[]; floors: Spot[]; faces: Array<Spot & { side: number }> } {
  const ceilings: Spot[] = [], floors: Spot[] = [], faces: Array<Spot & { side: number }> = [];
  for (let x = 16; x < WIDTH - 16; x += 3) {
    for (let y = 24; y < HEIGHT - 20; y++) {
      if (world.types[x + y * WIDTH] !== Cell.Empty) continue;
      if (isRock(world.types[x + (y - 1) * WIDTH])) ceilings.push({ x, y });
      if (isRock(world.types[x + (y + 1) * WIDTH])) floors.push({ x, y });
      if (y % 4 === 0) {
        if (isRock(world.types[x - 1 + y * WIDTH])) faces.push({ x, y, side: -1 });
        else if (isRock(world.types[x + 1 + y * WIDTH])) faces.push({ x, y, side: 1 });
      }
    }
  }
  return { ceilings, floors, faces };
}

/* ---------------- ice colour ---------------- */

/** Blue ice by depth from open air: rime, pale, blue, deep blue. */
export function iceShade(depth: number, n: number): number {
  const j = (n % 13) - 6;
  if (depth <= 0) return n % 9 === 0 ? packRGB(236, 246, 252) : packRGB(196 + j, 226 + (j >> 1), 246);
  if (depth === 1) return packRGB(148 + j, 196 + j, 234);
  if (depth === 2) return packRGB(96 + j, 160 + j, 218);
  return packRGB(56 + j, 116 + j, 184 + j);
}

/** Recolour every ice cell by its depth under the surface (4-connected BFS from air, capped). */
export function shadeIce(world: World, x0 = 0, y0 = 0, x1 = WIDTH - 1, y1 = HEIGHT - 1): void {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const depth = new Uint8Array(w * h).fill(255);
  let frontier: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (world.types[x + y * WIDTH] !== Cell.Ice) continue;
    const open = !blocksEntity(t(world, x + 1, y)) || !blocksEntity(t(world, x - 1, y)) || !blocksEntity(t(world, x, y + 1)) || !blocksEntity(t(world, x, y - 1));
    if (open) { depth[(x - x0) + (y - y0) * w] = 0; frontier.push(x + y * WIDTH); }
  }
  for (let d = 1; d <= 3 && frontier.length; d++) {
    const nf: number[] = [];
    for (const i of frontier) {
      const x = i % WIDTH, y = (i - x) / WIDTH;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const X = x + dx, Y = y + dy;
        if (X < x0 || X > x1 || Y < y0 || Y > y1) continue;
        const k = (X - x0) + (Y - y0) * w;
        if (depth[k] !== 255 || world.types[X + Y * WIDTH] !== Cell.Ice) continue;
        depth[k] = d;
        nf.push(X + Y * WIDTH);
      }
    }
    frontier = nf;
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = x + y * WIDTH;
    if (world.types[i] !== Cell.Ice) continue;
    const d = depth[(x - x0) + (y - y0) * w];
    world.colors[i] = iceShade(d === 255 ? 3 : d, (x * 7 + y * 13) & 0xffff);
  }
}

/* ---------------- icicles ---------------- */

function icicle(world: World, x: number, y: number, len: number, wide: boolean): void {
  for (let k = 0; k < len; k++) {
    const f = k / len;
    // A fat root tapering to a one-cell tip (wide ones are five across at the root).
    const half = wide ? (f < 0.2 ? 2 : f < 0.55 ? 1 : 0) : (f < 0.3 ? 1 : 0);
    const extra = 0;
    for (let dx = -half; dx <= half + extra; dx++) {
      if (t(world, x + dx, y + k) !== Cell.Empty) continue;
      const tip = f > 0.8;
      put(world, x + dx, y + k, Cell.Ice, tip ? packRGB(222, 240, 250) : iceShade(k < 2 ? 1 : 0, x * 5 + k * 11 + dx));
    }
  }
}

function hangIcicles(world: World, rng: Rng, site: ColdStoreSite, ledger: PlacementLedger, ceilings: Spot[], count: number): number {
  let placed = 0;
  let lastX = -99, lastY = -99;
  for (const { x, y } of ceilings) {
    if (placed >= count) break;
    if (t(world, x, y) !== Cell.Empty || !isRock(t(world, x, y - 1))) continue;
    if (Math.abs(x - lastX) < 4 && Math.abs(y - lastY) < 4) continue;
    const drop = openRun(world, x, y - 1, 0, 1, 120);
    const len = 4 + Math.floor(rng.next() * rng.next() * 26);
    if (drop < len + 26) continue; // a body always passes under
    if (!clearOf(site, ledger, x - 3, y, x + 3, y + len, 1)) continue;
    icicle(world, x, y, len, len > 10);
    lastX = x; lastY = y;
    placed++;
    // Icicles come in runs: smaller ones either side of the first.
    for (const side of [-1, 1]) {
      if (rng.next() < 0.35) continue;
      const nx = x + side * (2 + rng.int(3));
      if (t(world, nx, y) !== Cell.Empty || !isRock(t(world, nx, y - 1))) continue;
      const l2 = Math.max(2, Math.floor(len * (0.25 + rng.next() * 0.55)));
      if (openRun(world, nx, y - 1, 0, 1, 90) < l2 + 26) continue;
      icicle(world, nx, y, l2, false);
    }
  }
  return placed;
}

/* ---------------- hoarfrost crystals ---------------- */

/**
 * Rime crystals: little clusters of real Crystal on the ceilings and in the
 * ice, the cold rooms' only lamps — each one glows (render/Lighting seeds
 * crystal), so a store room reads by pools of cold cyan the grid explains.
 */
function frostCrystals(world: World, rng: Rng, site: ColdStoreSite, ledger: PlacementLedger, ceilings: Spot[], count: number): number {
  let placed = 0;
  const taken: Spot[] = [];
  for (const { x, y } of ceilings) {
    if (placed >= count) break;
    if (taken.some((p) => Math.abs(p.x - x) < 70 && Math.abs(p.y - y) < 50)) continue;
    if (t(world, x, y) !== Cell.Empty || !isRock(t(world, x, y - 1))) continue;
    if (openRun(world, x, y - 1, 0, 1, 60) < 34) continue;
    if (!clearOf(site, ledger, x - 5, y, x + 5, y + 6, 1)) continue;
    const spikes = 3 + rng.int(3);
    for (let s = 0; s < spikes; s++) {
      const sx = x + rng.int(7) - 3, len = 1 + rng.int(5);
      const lean = rng.next() < 0.5 ? 0 : rng.next() < 0.5 ? -1 : 1;
      for (let k = 0; k < len; k++) {
        const X = sx + (k > 1 ? lean : 0), Y = y + k;
        if (t(world, X, Y) !== Cell.Empty) break;
        put(world, X, Y, Cell.Crystal, k === len - 1 ? packRGB(226, 250, 255) : packRGB(128 + rng.int(40), 214 + rng.int(30), 240 + rng.int(15)));
      }
    }
    taken.push({ x, y });
    placed++;
  }
  return placed;
}

/* ---------------- frozen falls ---------------- */

function frozenFalls(world: World, rng: Rng, site: ColdStoreSite, ledger: PlacementLedger, faces: Array<Spot & { side: number }>, count: number): number {
  let placed = 0;
  const taken: Spot[] = [];
  for (const { x, y, side } of faces) {
    if (placed >= count) break;
    if (taken.some((p) => Math.abs(p.x - x) < 60 && Math.abs(p.y - y) < 120)) continue;
    // The top of a face: rock above this air cell or above the wall beside it.
    if (!isRock(t(world, x, y - 1)) && !isRock(t(world, x + side, y - 1))) continue;
    const fall = openRun(world, x, y - 1, 0, 1, 160);
    if (fall < 30) continue;
    let face = 0;
    for (let k = 0; k < fall; k += 3) if (isRock(t(world, x + side, y + k))) face++;
    if (face < (fall / 3) * 0.55) continue;
    if (openRun(world, x, y + Math.floor(fall / 2), -side, 0, 40) < 28) continue;
    if (!clearOf(site, ledger, x - 8, y, x + 8, y + fall, 2)) continue;
    const thick = 2 + rng.int(3);
    for (let k = 0; k <= fall; k++) {
      const wav = Math.round(Math.sin((y + k) * 0.21 + x) * 0.8 + Math.sin((y + k) * 0.067) * 0.8);
      const w = Math.max(1, thick + wav + (k > fall - 6 ? Math.floor((k - (fall - 6)) * 0.9) : 0));
      for (let d = 0; d < w; d++) {
        const X = x - side * d, Y = y + k;
        if (t(world, X, Y) !== Cell.Empty) continue;
        put(world, X, Y, Cell.Ice, iceShade(d === w - 1 ? 0 : d === 0 ? 2 : 1, X * 3 + Y));
      }
    }
    taken.push({ x, y });
    placed++;
  }
  return placed;
}

/* ---------------- snow ---------------- */

function settleSnow(world: World, rng: Rng, site: ColdStoreSite, ledger: PlacementLedger, floors: Spot[], count: number): number {
  let placed = 0;
  const taken: Spot[] = [];
  for (const { x, y } of floors) {
    if (placed >= count) break;
    if (taken.some((p) => Math.abs(p.x - x) < 26 && Math.abs(p.y - y) < 20)) continue;
    if (openRun(world, x, y + 1, 0, -1, 40) < 32) continue;
    const half = 6 + rng.int(14);
    if (!clearOf(site, ledger, x - half, y - 4, x + half, y + 1, 1)) continue;
    let laid = 0;
    for (let dx = -half; dx <= half; dx++) {
      // Follow the floor a step up or down.
      let gy = y;
      if (t(world, x + dx, gy) !== Cell.Empty) { if (t(world, x + dx, gy - 1) === Cell.Empty) gy--; else continue; }
      else if (t(world, x + dx, gy + 1) === Cell.Empty) { if (isRock(t(world, x + dx, gy + 2))) gy++; else continue; }
      if (!isRock(t(world, x + dx, gy + 1))) continue;
      if (openRun(world, x + dx, gy + 1, 0, -1, 30) < 26) continue;
      const hgt = Math.max(1, Math.round((1 - Math.abs(dx) / (half + 1)) * 2.4));
      for (let k = 0; k < hgt; k++) {
        if (t(world, x + dx, gy - k) !== Cell.Empty) break;
        put(world, x + dx, gy - k, Cell.Snow, snowColor());
        laid++;
      }
    }
    if (laid > 6) { placed++; taken.push({ x, y }); }
  }
  return placed;
}

/* ---------------- pipes ---------------- */

function lagPipes(world: World, rng: Rng, site: ColdStoreSite, ledger: PlacementLedger, ceilings: Spot[], count: number): number {
  let placed = 0;
  for (const c of ceilings) {
    if (placed >= count) break;
    const y = c.y + 5 + rng.int(4);
    const x = c.x;
    if (t(world, x, y) !== Cell.Empty) continue;
    if (openRun(world, x, y, 0, 1, 60) < 34) continue;
    const left = openRun(world, x, y, -1, 0, 260), right = openRun(world, x, y, 1, 0, 260);
    if (left + right < 80 || left >= 260 || right >= 260) continue;
    const x0 = x - left, x1 = x + right;
    // The run must sit under a ceiling most of the way (a room, not a chasm).
    let roofed = 0;
    for (let X = x0; X <= x1; X += 4) if (openRun(world, X, y, 0, -1, 16) < 14) roofed++;
    if (roofed < ((x1 - x0) / 4) * 0.6) continue;
    if (!clearOf(site, ledger, x0, y - 12, x1, y + 3, 2)) continue;
    // Two rows of iron with frost on top, a flange and a hanger every 24.
    for (let X = x0; X <= x1; X++) {
      put(world, X, y, Cell.Metal, (X * 7) % 5 === 0 ? packRGB(196, 212, 226) : packRGB(150, 168, 186));
      put(world, X, y + 1, Cell.Metal, packRGB(62, 70, 82));
      if ((X - x0) % 24 === 12) {
        for (const dy of [-1, 2]) put(world, X, y + dy, Cell.Metal, packRGB(84, 92, 106));
        for (let k = 1; k <= 16; k++) {
          if (t(world, X, y - k) !== Cell.Empty) break;
          put(world, X, y - k, Cell.Metal, packRGB(48, 54, 64));
        }
      }
    }
    // A frost beard hangs off the pipe here and there.
    for (let X = x0 + 3; X < x1 - 3; X += 5 + rng.int(9)) {
      const len = 1 + rng.int(4);
      for (let k = 0; k < len; k++) if (t(world, X, y + 2 + k) === Cell.Empty) put(world, X, y + 2 + k, Cell.Ice, iceShade(0, X + k));
    }
    ledger.reserve(x0, y - 2, x1, y + 2, 'cold-pipe');
    placed++;
  }
  return placed;
}

/* ---------------- brine gutters ---------------- */

function cutGutters(world: World, rng: Rng, site: ColdStoreSite, ledger: PlacementLedger, floors: Spot[], count: number): number {
  let placed = 0;
  for (const { x, y } of floors) {
    if (placed >= count) break;
    const half = 7 + rng.int(6);
    // A flat floor with rock under it, room above to walk.
    let flat = true;
    for (let dx = -half - 4; dx <= half + 4 && flat; dx++) {
      if (t(world, x + dx, y) !== Cell.Empty || !isRock(t(world, x + dx, y + 1))) flat = false;
      for (let k = 2; k <= 6 && flat; k++) if (!isRock(t(world, x + dx, y + k))) flat = false;
    }
    if (!flat || openRun(world, x, y, 0, -1, 40) < 30) continue;
    if (!clearOf(site, ledger, x - half - 4, y - 20, x + half + 4, y + 6, 4)) continue;
    // Cut the channel, line it with stone, fill it with brine.
    for (let dx = -half - 1; dx <= half + 1; dx++) {
      for (let k = 1; k <= 4; k++) {
        const wall = Math.abs(dx) === half + 1 || k === 4;
        put(world, x + dx, y + k, wall ? Cell.Stone : Cell.Brine, wall ? stoneColor() : brineColor());
      }
    }
    ledger.reserve(x - half - 2, y - 2, x + half + 2, y + 5, 'brine-gutter');
    placed++;
  }
  return placed;
}

export interface ColdStoreDressing {
  icicles: number;
  falls: number;
  snow: number;
  pipes: number;
  gutters: number;
  crystals: number;
}

/** The Cold Store's dressing, on the level's own forked stream. */
export function dressColdStore(world: World, rng: Rng, ledger: PlacementLedger, site: ColdStoreSite): ColdStoreDressing {
  const found = scan(world);
  shuffle(found.ceilings, rng);
  shuffle(found.floors, rng);
  shuffle(found.faces, rng);
  const out: ColdStoreDressing = {
    pipes: lagPipes(world, rng, site, ledger, found.ceilings, 6),
    gutters: cutGutters(world, rng, site, ledger, found.floors, 5),
    falls: frozenFalls(world, rng, site, ledger, found.faces, 9),
    crystals: frostCrystals(world, rng, site, ledger, found.ceilings, 34),
    icicles: hangIcicles(world, rng, site, ledger, found.ceilings, 240),
    snow: settleSnow(world, rng, site, ledger, found.floors, 70),
  };
  shadeIce(world);
  return out;
}

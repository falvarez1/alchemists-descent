import { HEIGHT, WIDTH } from '@/config/constants';
import { PHOTOCELL } from '@/config/darkness';
import type { Rng } from '@/core/rng';
import type { Ctx, DarkZone, LevelDef, LumenBloom, Mechanism, Pickup, PlacedPrefab, RegionGraph } from '@/core/types';
import { makePickup, POTION_KINDS } from '@/core/pickupDefs';
import { makeValve } from '@/core/mechanismFactories';
import { randomCard, TOME_REWARD_POOL } from '@/content/cardRewardPools';
import { Cell } from '@/sim/CellType';
import { acidColor, packRGB, stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';
import { type PlacementLedger, SEALED_LABEL, carvePocket, carveRect, connectToCaves, sealedFootprints, tunnelTo } from '@/world/connect';
import { wizardMask } from '@/world/validate';

/**
 * LIGHT PUZZLES (light wave, floors 2–4). Two archetypes, each a room of
 * designed black carved off the caves and joined to the main path:
 *
 * - THE LAMPLIGHTER'S LOCK: a metal strongroom whose gate is held by brass
 *   photocells set into the rock. Twin lenses on opposite walls, each latching
 *   for a few seconds once it has drunk ~1.5 s of light: light one, swing the
 *   beam across the dark to the other before it cools, and the gate unbolts
 *   for good. (A single, permanent lens on the gentler floor.) Fire counts as
 *   light; a wrecked lens groans its gate open (fail-open).
 * - THE BLOOM CROSSING: a chasm over an acid sump with a lumen bloom rooted on
 *   each lip. Light the near heart and its glass petals unfurl half-way; light
 *   the far heart and the bridge meets; both furl slowly in the dark behind you.
 *
 * Plus designed darkness over one or two big caves ON the main route. Every
 * pass runs on its own forked RNG stream and the shared ledger.
 */

export interface LightPuzzleOutput {
  mechanisms: Mechanism[];
  pickups: Pickup[];
  darkZones: DarkZone[];
  lumenBlooms: LumenBloom[];
  placed: PlacedPrefab[];
}

export interface RoomSpec { id: string; w: number; h: number; minSpawnDist: number }

/** Room sizes, largest first: placement degrades to a smaller room rather than skip. */
const VAULT_ROOMS: RoomSpec[] = [
  { id: 'light-lamplighters-lock', w: 124, h: 70, minSpawnDist: 170 },
  { id: 'light-lamplighters-lock', w: 104, h: 66, minSpawnDist: 140 },
];
const BLOOM_ROOMS: RoomSpec[] = [
  { id: 'light-bloom-crossing', w: 178, h: 104, minSpawnDist: 190 },
  { id: 'light-bloom-crossing', w: 150, h: 98, minSpawnDist: 160 },
  { id: 'light-bloom-crossing', w: 128, h: 92, minSpawnDist: 130 },
];
export const ROOM_MARGIN = 14;
/** The brass-stained stone a lens is set into (the sprite draws the brass). */
const LENS_STONE = packRGB(74, 62, 40);
const VAULT_METAL = packRGB(66, 60, 52);

function setCell(world: World, x: number, y: number, t: number, color: number): void {
  if (!world.inBounds(x, y)) return;
  const i = world.idx(x, y);
  world.types[i] = t;
  world.colors[i] = color;
  world.life[i] = 0;
  world.clearChargeAt(i);
}

function nextId(list: readonly Mechanism[]): number {
  let max = 0;
  for (const m of list) if (m.id > max) max = m.id;
  return max + 1;
}

/**
 * A photocell set into a rock face: the lens cell faces open air on side
 * `face` (+1 = air to the right), backed by a small stone housing that is its
 * fail-open body (blast it and the gate groans open ~30 s later).
 */
export function stampPhotocell(
  world: World, list: Mechanism[], x: number, y: number, face: 1 | -1,
  opts: { targetId: number; latch: 'permanent' | 'timed'; latchFrames?: number; id?: number; port?: { x: number; y: number } },
): Mechanism {
  const body: Array<[number, number]> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const X = x - face * dx, Y = y + dy;
      if (!world.inBounds(X, Y) || world.types[world.idx(X, Y)] === Cell.Metal) continue;
      setCell(world, X, Y, Cell.Stone, LENS_STONE);
      body.push([X, Y]);
    }
  }
  const m: Mechanism = {
    id: opts.id ?? nextId(list), kind: 'sensor', sensorType: 'light', x, y, w: 1, h: 1, state: 0,
    targetId: opts.targetId, threshold: PHOTOCELL.chargeTicks, zone: { x0: x, y0: y, x1: x, y1: y },
    latch: opts.latch, reading: 0, body,
  };
  if (opts.latch === 'timed') m.latchFrames = opts.latchFrames ?? 240;
  if (opts.port) m.lightPort = { x: opts.port.x, y: opts.port.y };
  list.push(m);
  return m;
}

/**
 * A lumen bloom whose heart sits at (hx, hy) on a ledge lip and whose petals
 * run `cols` columns from x0 in direction `dir`, two rows thick with their top
 * at `topY`, arching up to `arch` cells toward the tip. Petal cells are
 * carved open (they are only ever glass while the bloom is lit).
 */
export function makeLumenBloom(world: World, id: number, hx: number, hy: number, dir: 1 | -1, x0: number, topY: number, cols: number, arch = 2): LumenBloom {
  const petals: Array<[number, number]> = [];
  for (let c = 0; c < cols; c++) {
    const t = cols > 1 ? c / (cols - 1) : 0;
    const lift = Math.round(Math.sin(t * Math.PI * 0.5) * arch);
    const x = x0 + dir * c;
    for (let row = 0; row < 2; row++) {
      const y = topY - lift + row;
      if (world.inBounds(x, y)) setCell(world, x, y, Cell.Empty, 0x08080c);
      petals.push([x, y]);
    }
  }
  return { id, x: hx, y: hy, dir, petals, open: 0, hold: 0, shown: -1 };
}

function rockFraction(world: World, x0: number, y0: number, w: number, h: number): { rock: number; open: number; metal: boolean } {
  let cells = 0, rock = 0, open = 0;
  for (let y = y0 - 4; y <= y0 + h + 4; y += 3) {
    for (let x = x0 - 4; x <= x0 + w + 4; x += 3) {
      if (!world.inBounds(x, y)) return { rock: 0, open: 1, metal: true };
      const t = world.types[world.idx(x, y)];
      if (t === Cell.Metal) return { rock: 0, open: 0, metal: true };
      cells++;
      if (t === Cell.Wall || t === Cell.Stone || t === Cell.RawOre || t === Cell.Coal) rock++;
      else if (t === Cell.Empty || t === Cell.Water || t === Cell.Lava || t === Cell.Acid || t === Cell.Gold) open++;
    }
  }
  return { rock: cells ? rock / cells : 0, open: cells ? open / cells : 1, metal: false };
}

function distanceToMainPath(graph: RegionGraph, x: number, y: number): number {
  let best = Infinity;
  for (const reg of graph.regions) if (reg.onMainPath) best = Math.min(best, Math.hypot(reg.cx - x, reg.cy - y));
  if (!Number.isFinite(best)) for (const reg of graph.regions) if (reg.area >= 80) best = Math.min(best, Math.hypot(reg.cx - x, reg.cy - y));
  return best;
}

export interface Site { x0: number; y0: number }

export function findRoomSite(
  world: World, rng: Rng, graph: RegionGraph, ledger: PlacementLedger, spec: RoomSpec,
  site: { spawn: { x: number; y: number }; wellX: number; maxY: number; avoid: ReadonlyArray<{ x: number; y: number; r: number }> },
  placed: readonly PlacedPrefab[],
): Site | null {
  const xSpan = WIDTH - spec.w - 40;
  const ySpan = Math.min(site.maxY, HEIGHT - 70) - spec.h - 50;
  if (xSpan <= 0 || ySpan <= 0) return null;
  // Criteria degrade in stages, never silently: dense rock near the main path
  // first, then looser rock and a longer connector, then anything clear.
  for (let tries = 0; tries < 9000; tries++) {
    const stage = tries < 2500 ? 0 : tries < 5000 ? 1 : tries < 7500 ? 2 : 3;
    const x0 = 20 + rng.int(xSpan);
    const y0 = 50 + rng.int(ySpan);
    const cx = x0 + spec.w / 2, cy = y0 + spec.h / 2;
    if (Math.hypot(cx - site.spawn.x, cy - site.spawn.y) < spec.minSpawnDist * (stage === 2 ? 0.6 : 1)) continue;
    if (Math.abs(cx - site.wellX) < spec.w / 2 + 60) continue;
    if (site.avoid.some((a) => Math.hypot(cx - a.x, cy - a.y) < a.r + spec.w / 2)) continue;
    if (distanceToMainPath(graph, cx, cy) > (stage === 0 ? 300 : stage === 1 ? 420 : 560)) continue;
    if (ledger.intersects(x0 - ROOM_MARGIN, y0 - ROOM_MARGIN, x0 + spec.w + ROOM_MARGIN, y0 + spec.h + ROOM_MARGIN)) continue;
    if (placed.some((p) => Math.hypot(cx - (p.x0 + p.x1) / 2, cy - (p.y0 + p.y1) / 2) < 150)) continue;
    const f = rockFraction(world, x0, y0, spec.w, spec.h);
    if (f.metal) continue;
    // Stage 3 takes any clear, metal-free site: the carve makes it a room.
    if (stage < 3 && f.rock < (stage === 0 ? 0.6 : stage === 1 ? 0.45 : 0.3)) continue;
    if (stage < 3 && f.open > (stage === 0 ? 0.14 : stage === 1 ? 0.22 : 0.32)) continue;
    return { x0, y0 };
  }
  return null;
}

export function roomReachable(world: World, spawn: { x: number; y: number }, x0: number, y0: number, x1: number, y1: number): boolean {
  const mask = wizardMask({ world, spawn });
  let n = 0;
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) if (world.inBounds(x, y) && mask[world.idx(x, y)]) n++;
  return n >= 12;
}

export function snapshot(world: World): { types: Uint8Array; colors: Uint32Array; life: Int16Array; charge: Uint16Array } {
  return { types: world.types.slice(), colors: world.colors.slice(), life: world.life.slice(), charge: world.charge.slice() };
}
export function restore(world: World, s: ReturnType<typeof snapshot>): void {
  world.types.set(s.types); world.colors.set(s.colors); world.life.set(s.life); world.charge.set(s.charge);
}

/** Carve the room shell and join it to the main path; false (rolled back) if it cannot be joined. */
export function carveRoom(
  ctx: Ctx, rng: Rng, graph: RegionGraph, fits: Uint8Array | undefined, spawn: { x: number; y: number },
  floorY: number, mouth: { x: number; y: number },
  interior: { x0: number; y0: number; x1: number; y1: number },
  ledger: PlacementLedger,
): boolean {
  const world = ctx.world;
  carveRect(world, interior.x0, interior.y0, interior.x1, interior.y1);
  for (let y = floorY; y <= floorY + 4; y++) for (let x = interior.x0 - 2; x <= interior.x1 + 2; x++) setCell(world, x, y, Cell.Stone, stoneColor());
  carvePocket(world, mouth.x, mouth.y, 11, 12);
  // The connector walks AROUND sealed features (a lair's pool, the sump, the
  // other light room) instead of being rolled back for cutting one below.
  const avoid = sealedFootprints(ledger);
  let steps = connectToCaves(world, rng, graph, mouth.x, mouth.y, 12, fits, { halfW: 7, up: 21, down: 9 }, avoid);
  if (steps.length === 0) {
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (const reg of graph.regions) {
      if (!reg.onMainPath) continue;
      const d = Math.hypot(reg.cx - mouth.x, reg.cy - mouth.y);
      if (d < bd) { bd = d; best = { x: Math.floor(reg.cx), y: Math.floor(reg.cy) }; }
    }
    if (best) steps = tunnelTo(world, rng, mouth.x, mouth.y, best.x, best.y, 12, { halfW: 7, up: 21, down: 9 }, 26, avoid);
  }
  if (steps.length === 0) return false;
  return roomReachable(world, spawn, interior.x0, interior.y0, interior.x1, interior.y1);
}

/**
 * Did the carve cut into a SEALED feature — an encounter lair's pool, the
 * boss sump, another light room? Those hold liquid or a puzzle a tunnel would
 * drain or bypass (a connector through the d3 Rillback pool's seal emptied it).
 * The connector now routes around them (world/connect sealedFootprints); this
 * stays as the backstop for the fail-open case where the cheapest route still
 * had to cut one. Ordinary prefab footprints are joined by connectors
 * everywhere else in worldgen, so they are not guarded here.
 */
export function intrudes(world: World, before: Uint8Array, ledger: PlacementLedger): boolean {
  const rects = ledger.rects().filter((r) => SEALED_LABEL.test(r.label));
  if (rects.length === 0) return false;
  const W = world.width, types = world.types;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === before[i]) continue;
    const x = i % W, y = (i - x) / W;
    for (const r of rects) if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
  }
  return false;
}

function roomZone(at: Site, spec: RoomSpec): DarkZone {
  // The zone covers the walls too, so the room's own rock is black.
  return { x: at.x0 + spec.w / 2, y: at.y0 + spec.h / 2, rx: spec.w / 2 + 20, ry: spec.h / 2 + 20, shape: 'rect' };
}

function placeLamplightersLock(ctx: Ctx, rng: Rng, at: Site, spec: RoomSpec, twin: boolean, out: LightPuzzleOutput): void {
  const world = ctx.world;
  const x0 = at.x0, y0 = at.y0, x1 = at.x0 + spec.w - 1;
  const floorY = y0 + spec.h - 12;
  // The strongroom: a metal box against the east wall with a sliding gate.
  const vx0 = x1 - 34, vx1 = x1 - 14, vy0 = floorY - 24, vy1 = floorY - 1;
  for (let y = vy0 - 2; y <= floorY + 2; y++) {
    for (let x = vx0 - 2; x <= vx1 + 2; x++) {
      const inside = x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;
      setCell(world, x, y, inside ? Cell.Empty : Cell.Metal, inside ? 0x08080c : VAULT_METAL);
    }
  }
  const gate = makeValve(ctx, out.mechanisms, vx0 - 2, vy1 - 18, 2, 19, { material: Cell.Metal, oneShot: true });
  // The reward, on a small plinth.
  const rx = Math.floor((vx0 + vx1) / 2);
  out.pickups.push(makePickup('tome', rx, vy1 - 1, { card: randomCard(TOME_REWARD_POOL, () => rng.next()) }));
  out.pickups.push(makePickup('goldpile', rx + 6, vy1, { amount: 40 + rng.int(30) }));
  // The lenses: high on the west wall, and (twin) high on the east wall above
  // the strongroom — too far apart for one cone to hold both.
  const lensY = y0 + 18 + rng.int(6);
  stampPhotocell(world, out.mechanisms, x0 + 7, lensY, 1, { targetId: gate.id, latch: twin ? 'timed' : 'permanent', latchFrames: 260 });
  if (twin) stampPhotocell(world, out.mechanisms, x1 - 7, lensY + rng.int(5) - 2, -1, { targetId: gate.id, latch: 'timed', latchFrames: 260 });
}

function placeBloomCrossing(ctx: Ctx, rng: Rng, at: Site, spec: RoomSpec, out: LightPuzzleOutput): void {
  const world = ctx.world;
  const x0 = at.x0, y0 = at.y0, x1 = at.x0 + spec.w - 1;
  const floorY = y0 + 62;
  const nearEnd = x0 + 44, farStart = x1 - 44;
  // The chasm: open from the ledge line down to a metal-lined acid sump
  // (acid eats stone, never metal, so the sump holds forever).
  const pitBottom = y0 + spec.h - 8;
  carveRect(world, nearEnd + 1, floorY, farStart - 1, pitBottom - 1);
  for (let y = floorY; y <= pitBottom + 3; y++) {
    for (const x of [nearEnd - 1, nearEnd, farStart, farStart + 1]) {
      const sump = y >= pitBottom - 6;
      setCell(world, x, y, sump ? Cell.Metal : Cell.Stone, sump ? VAULT_METAL : stoneColor());
    }
  }
  for (let y = pitBottom; y <= pitBottom + 3; y++) for (let x = nearEnd - 1; x <= farStart + 1; x++) setCell(world, x, y, Cell.Metal, VAULT_METAL);
  for (let y = pitBottom - 4; y < pitBottom; y++) for (let x = nearEnd + 1; x <= farStart - 1; x++) setCell(world, x, y, Cell.Acid, acidColor());
  const gap = farStart - nearEnd - 1;
  const half = Math.ceil(gap / 2);
  const base = out.lumenBlooms.length + 1;
  out.lumenBlooms.push(makeLumenBloom(world, base, nearEnd - 1, floorY - 3, 1, nearEnd + 1, floorY, half, 2));
  out.lumenBlooms.push(makeLumenBloom(world, base + 1, farStart + 1, floorY - 3, -1, farStart - 1, floorY, gap - half, 2));
  // The far ledge keeps something worth the crossing.
  out.pickups.push(makePickup('potion', x1 - 22, floorY - 1, { potion: POTION_KINDS[rng.int(POTION_KINDS.length)] }));
  out.pickups.push(makePickup('goldpile', x1 - 30, floorY - 1, { amount: 35 + rng.int(35) }));
  if (rng.next() < 0.5) out.pickups.push(makePickup('heart', x1 - 14, floorY - 2));
}

/**
 * Designed darkness over the route: one or two big, walkable caves the player
 * crosses by lantern light, away from the spawn, the portal and the boss.
 * Sampled from wizard-fit ground (a sprawling cave network is often one
 * region, so region centroids cannot place it), degrading its criteria
 * rather than silently skipping.
 */
function darkenRouteCaves(
  world: World, fits: Uint8Array | undefined, count: number,
  site: { spawn: { x: number; y: number }; avoid: ReadonlyArray<{ x: number; y: number; r: number }> },
  out: LightPuzzleOutput, rng: Rng,
): void {
  const openFraction = (cx: number, cy: number, rx: number, ry: number): number => {
    let n = 0, open = 0;
    for (let y = cy - ry; y <= cy + ry; y += 6) for (let x = cx - rx; x <= cx + rx; x += 6) {
      if (!world.inBounds(x, y)) continue;
      n++;
      if (world.types[world.idx(x, y)] === Cell.Empty) open++;
    }
    return n ? open / n : 0;
  };
  let placed = 0;
  for (let tries = 0; tries < 900 && placed < count; tries++) {
    const stage = tries < 400 ? 0 : tries < 700 ? 1 : 2;
    const x = 60 + rng.int(WIDTH - 120), y = 60 + rng.int(HEIGHT - 140);
    if (fits && !fits[x + y * WIDTH]) continue;
    if (!fits && world.types[world.idx(x, y)] !== Cell.Empty) continue;
    if (Math.hypot(x - site.spawn.x, y - site.spawn.y) < (stage === 2 ? 180 : 240)) continue;
    if (site.avoid.some((a) => Math.hypot(x - a.x, y - a.y) < a.r + (stage === 0 ? 70 : 30))) continue;
    if (out.placed.some((p) => x > p.x0 - 60 && x < p.x1 + 60 && y > p.y0 - 60 && y < p.y1 + 60)) continue;
    if (out.darkZones.some((z) => Math.hypot(x - z.x, y - z.y) < z.rx + 150)) continue;
    const rx = 110 - stage * 15, ry = 76 - stage * 10;
    if (openFraction(x, y, rx, ry) < (stage === 0 ? 0.36 : stage === 1 ? 0.28 : 0.2)) continue;
    out.darkZones.push({ x, y, rx, ry });
    placed++;
  }
  if (placed < count) console.warn(`[light-puzzles] darkened ${placed}/${count} route caves`);
}

/** Floors 2–4: two light puzzles and darkness on the route. */
export function placeLightPuzzles(
  ctx: Ctx, rng: Rng, graph: RegionGraph, ledger: PlacementLedger, def: LevelDef,
  site: { spawn: { x: number; y: number }; wellX: number; avoid: ReadonlyArray<{ x: number; y: number; r: number }> },
  fits: Uint8Array | undefined, out: LightPuzzleOutput,
): void {
  if (def.branch || def.depth < 2) return;
  const flooded = def.biome === 'flooded';
  const maxY = flooded ? Math.floor(HEIGHT * 0.62) - 40 : HEIGHT - 60;
  const kinds: Array<{ sizes: RoomSpec[]; kind: 'vault' | 'bloom' }> = [
    { sizes: VAULT_ROOMS, kind: 'vault' },
    { sizes: BLOOM_ROOMS, kind: 'bloom' },
  ];
  // Sites tried and refused: later tries keep well clear of them.
  const refused: PlacedPrefab[] = [];
  for (const { sizes, kind } of kinds) {
    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      let at: Site | null = null, spec = sizes[0];
      for (const size of sizes) {
        at = findRoomSite(ctx.world, rng, graph, ledger, size, { ...site, maxY }, [...out.placed, ...refused]);
        spec = size;
        if (at) break;
      }
      if (!at) break;
      const before = snapshot(ctx.world);
      const mechCount = out.mechanisms.length, pickCount = out.pickups.length, bloomCount = out.lumenBlooms.length;
      const x1 = at.x0 + spec.w - 1;
      const floorY = kind === 'vault' ? at.y0 + spec.h - 12 : at.y0 + 62;
      const interior = { x0: at.x0 + 8, y0: at.y0 + 10, x1: x1 - 8, y1: floorY - 1 };
      const mouth = { x: at.x0 + 22, y: floorY - 10 };
      const rollback = (why: string): void => {
        restore(ctx.world, before);
        out.mechanisms.length = mechCount; out.pickups.length = pickCount; out.lumenBlooms.length = bloomCount;
        refused.push({ id: spec.id, x0: at.x0, y0: at.y0, x1, y1: at.y0 + spec.h - 1 });
        console.warn(`[light-puzzles] ${spec.id} on ${def.id}: ${why}; trying elsewhere`);
      };
      if (!carveRoom(ctx, rng, graph, fits, site.spawn, floorY, mouth, interior, ledger)) { rollback('could not be joined to the caves'); continue; }
      if (kind === 'vault') placeLamplightersLock(ctx, rng, at, spec, def.depth >= 3, out);
      else placeBloomCrossing(ctx, rng, at, spec, out);
      if (!roomReachable(ctx.world, site.spawn, interior.x0, interior.y0, x1 - 8, floorY - 1)) { rollback('lost its approach'); continue; }
      // Never cut into another placement's footprint (an encounter lair's
      // sealed pool, a prefab, the spawn or a waystone): the connector tunnel
      // wanders, so check what actually changed.
      if (intrudes(ctx.world, before.types, ledger)) { rollback('its carve cut into another placement'); continue; }
      ledger.reserve(at.x0 - ROOM_MARGIN, at.y0 - ROOM_MARGIN, x1 + ROOM_MARGIN, at.y0 + spec.h + ROOM_MARGIN, spec.id);
      out.darkZones.push(roomZone(at, spec));
      out.placed.push({ id: spec.id, x0: at.x0, y0: at.y0, x1, y1: at.y0 + spec.h - 1 });
      done = true;
    }
    if (!done) console.warn(`[light-puzzles] no site for ${sizes[0].id} on ${def.id}`);
  }
  darkenRouteCaves(ctx.world, fits, def.biome === 'flooded' ? 2 : 1, site, out, rng);
}

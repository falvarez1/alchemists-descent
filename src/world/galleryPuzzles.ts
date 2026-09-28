import { HEIGHT } from '@/config/constants';
import type { Rng } from '@/core/rng';
import type { Ctx, Mechanism, PlacedPrefab, Pickup, RegionGraph } from '@/core/types';
import { makeValve } from '@/core/mechanismFactories';
import { makePickup } from '@/core/pickupDefs';
import { randomCard, TOME_REWARD_POOL } from '@/content/cardRewardPools';
import { Cell } from '@/sim/CellType';
import { crystalColor, glassColor, goldColor, mirrorColor, packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';
import type { PlacementLedger } from '@/world/connect';
import type { ColdStoreSite } from '@/world/coldStore';
import { carveRoom, findRoomSite, intrudes, restore, ROOM_MARGIN, roomReachable, snapshot, stampPhotocell, type RoomSpec, type Site } from '@/world/lightPuzzles';

/* ============================================================
 * THE GLASS GALLERIES' PUZZLES (wave 3). Light that turns corners, on the
 * real renderer's raycast (render/Lighting + sim/beam): the wand's beam
 * reflects off Mirror cells and splits in Crystal, and a photocell reads the
 * turned light. Rooms carved off the caves and joined to the main path with
 * world/lightPuzzles' room helpers (a degrading site search, a connector
 * that must reach, a rollback that never half-builds).
 *
 *  THE PERISCOPE — the grinder's strongroom is held by a photocell sealed in
 *  the attic above the room, at the end of a lens tunnel. The only way light
 *  gets in is up a light well too narrow for a body, off the silvered mirror
 *  at its head and along the tunnel: stand on the brass ring under the well
 *  and shine straight up.
 *
 *  THE PRISM GATE — twin photocells that must BOTH drink light at once (each
 *  holds its latch for a heartbeat), recessed at the ends of two blinder
 *  tubes in a metal lens-house. The tubes both look back at one crystal
 *  prism behind a glass window: shine through the window into the prism and
 *  its two daughter beams run down both tubes together.
 *
 * Fail-open, as every light lock: the lenses' stone housings, blasted, groan
 * their gates open. Glass shatters to a blast.
 * ============================================================ */

export interface GalleryPuzzleOutput {
  mechanisms: Mechanism[];
  pickups: Pickup[];
  placed: PlacedPrefab[];
  /** Re-assert the rooms' optics after the rescue passes (idempotent). */
  repairs: Array<() => void>;
}

export const PERISCOPE_ROOMS: readonly RoomSpec[] = [
  { id: 'glass-periscope', w: 150, h: 86, minSpawnDist: 180 },
  { id: 'glass-periscope', w: 132, h: 84, minSpawnDist: 140 },
];
export const PRISM_ROOMS: readonly RoomSpec[] = [
  { id: 'glass-prism-gate', w: 170, h: 78, minSpawnDist: 190 },
  { id: 'glass-prism-gate', w: 150, h: 76, minSpawnDist: 150 },
];
const CASING = packRGB(92, 88, 80);
const BRASS = packRGB(176, 138, 62);
const AIR = 0x08080c;
/** A prism twin's latch: a heartbeat, so only light split in two lights both. */
export const PRISM_LATCH_FRAMES = 24;

function t(world: World, x: number, y: number): number {
  return world.inBounds(x, y) ? world.types[world.idx(x, y)] : Cell.Wall;
}

function put(world: World, x: number, y: number, type: number, color: number): void {
  if (!world.inBounds(x, y)) return;
  const i = world.idx(x, y);
  world.types[i] = type;
  world.colors[i] = color;
  world.life[i] = 0;
  world.clearChargeAt(i);
}

/** A small crystal lamp: light is information (the reward reads from afar). */
function glassLamp(world: World, x: number, y: number): void {
  for (let dx = -1; dx <= 1; dx++) put(world, x + dx, y, Cell.Crystal, crystalColor());
  put(world, x, y - 1, Cell.Crystal, crystalColor());
}

/** Put a lens's stone housing back where a carve took it (generation only: a blast in play is the fail-open). */
function restoreHousing(world: World, lens: Mechanism): void {
  for (const [x, y] of lens.body ?? []) if (t(world, x, y) !== Cell.Stone) put(world, x, y, Cell.Stone, packRGB(74, 62, 40));
}

/** The strongroom against the east wall (a metal box, a sliding gate on its west side, the reward inside). */
function strongroom(ctx: Ctx, rng: Rng, x1: number, floorY: number, out: GalleryPuzzleOutput): Mechanism {
  const world = ctx.world;
  const vx0 = x1 - 36, vx1 = x1 - 12, vy0 = floorY - 22, vy1 = floorY - 1;
  for (let y = vy0 - 2; y <= floorY + 2; y++) {
    for (let x = vx0 - 2; x <= vx1 + 2; x++) {
      const inside = x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;
      put(world, x, y, inside ? Cell.Empty : Cell.Metal, inside ? AIR : CASING);
    }
  }
  const gate = makeValve(ctx, out.mechanisms, vx0 - 2, vy1 - 18, 2, 19, { material: Cell.Metal, oneShot: true });
  glassLamp(world, vx1 - 2, vy1);
  const rx = Math.floor((vx0 + vx1) / 2);
  out.pickups.push(makePickup('tome', rx, vy1 - 1, { card: randomCard(TOME_REWARD_POOL, () => rng.next()) }));
  out.pickups.push(makePickup('goldpile', rx + 6, vy1, { amount: 45 + rng.int(35) }));
  return gate;
}

/** The periscope's geometry, for its builder and the probes. */
export function periscopeLayout(at: Site, spec: RoomSpec): {
  floorY: number; atticTop: number; atticBottom: number; wellX: number; wellHalf: number; tunnelY0: number; tunnelY1: number;
  lensX: number; lensY: number; mirror: Array<[number, number]>;
} {
  const floorY = at.y0 + spec.h - 12;
  const atticTop = at.y0 + 10, atticBottom = at.y0 + 34;
  const wellX = at.x0 + 46, wellHalf = 2;
  const tunnelY0 = at.y0 + 14, tunnelY1 = at.y0 + 21;
  // The well's head mirror: a two-cell "/" line across the well's top — a beam
  // coming straight up leaves it running east along the tunnel.
  const mirror: Array<[number, number]> = [];
  for (let k = 0; k <= 8; k++) {
    const X = wellX - 4 + k, Y = tunnelY1 + 1 - k;
    mirror.push([X, Y], [X - 1, Y]);
  }
  return { floorY, atticTop, atticBottom, wellX, wellHalf, tunnelY0, tunnelY1, lensX: wellX + 40, lensY: Math.floor((tunnelY0 + tunnelY1) / 2), mirror };
}

function periscope(ctx: Ctx, rng: Rng, at: Site, spec: RoomSpec, out: GalleryPuzzleOutput): void {
  const world = ctx.world;
  const x1 = at.x0 + spec.w - 1;
  const L = periscopeLayout(at, spec);
  const gate = strongroom(ctx, rng, x1, L.floorY, out);
  // The attic: a metal false ceiling over the whole room, sealed except the
  // light well and the lens tunnel inside it.
  const stampOptics = (): void => {
    for (let y = L.atticTop; y <= L.atticBottom; y++) {
      for (let x = at.x0 + 8; x <= x1 - 8; x++) {
        const well = Math.abs(x - L.wellX) <= L.wellHalf && y >= L.tunnelY0;
        const tunnel = y >= L.tunnelY0 && y <= L.tunnelY1 && x >= L.wellX - L.wellHalf && x < L.lensX;
        const lensHouse = x >= L.lensX && x <= L.lensX + 1 && Math.abs(y - L.lensY) <= 1;
        if (lensHouse) continue; // the photocell's own stone
        if (well || tunnel) { if (t(world, x, y) !== Cell.Empty && t(world, x, y) !== Cell.Mirror) put(world, x, y, Cell.Empty, AIR); }
        else if (t(world, x, y) !== Cell.Metal) put(world, x, y, Cell.Metal, CASING);
      }
    }
    for (const [x, y] of L.mirror) if (t(world, x, y) !== Cell.Mirror) put(world, x, y, Cell.Mirror, mirrorColor());
  };
  stampOptics();
  // (Findability judges this lens at the well's mouth: the light's only way in.)
  const lens = stampPhotocell(world, out.mechanisms, L.lensX, L.lensY, -1, { targetId: gate.id, latch: 'permanent', port: { x: L.wellX, y: L.atticBottom + 1 } });
  // A later carve that passes over the attic spares its metal but not the
  // lens's stone housing: the repair puts both back.
  out.repairs.push(() => { stampOptics(); restoreHousing(world, lens); });
  // The brass ring round the well's mouth and the brass inlay on the floor under it: stand here.
  for (const dx of [-L.wellHalf - 2, -L.wellHalf - 1, L.wellHalf + 1, L.wellHalf + 2]) put(world, L.wellX + dx, L.atticBottom, Cell.Gold, goldColor());
  for (let dx = -3; dx <= 3; dx++) put(world, L.wellX + dx, L.floorY, Cell.Gold, dx === 0 ? packRGB(250, 214, 120) : BRASS);
  glassLamp(world, at.x0 + 24, L.floorY - 1);
}

/** The prism gate's geometry, for its builder and the probes. */
export function prismLayout(at: Site, spec: RoomSpec): {
  floorY: number; hx0: number; hx1: number; hy0: number; px: number; py: number; lensX: number; lensDy: number; windowX: number;
} {
  const x1 = at.x0 + spec.w - 1;
  const floorY = at.y0 + spec.h - 12;
  // The prism sits at the height of a standing alchemist's wand (player.y - 9:
  // feet on floorY - 1), so a beam from anywhere on the floor comes in level.
  const py = floorY - 10;
  const hx1 = x1 - 44, hx0 = hx1 - 30;
  const px = hx0 + 8;
  const lensX = hx1 - 2;
  // Daughter beams leave the prism PRISM_SPLIT (0.36 rad) either side of level.
  const lensDy = Math.round((lensX - px) * Math.tan(0.36));
  return { floorY, hx0, hx1, hy0: py - lensDy - 5, px, py, lensX, lensDy, windowX: hx0 };
}

function prismGate(ctx: Ctx, rng: Rng, at: Site, spec: RoomSpec, out: GalleryPuzzleOutput): void {
  const world = ctx.world;
  const x1 = at.x0 + spec.w - 1;
  const P = prismLayout(at, spec);
  const gate = strongroom(ctx, rng, x1, P.floorY, out);
  gate.logic = undefined; // AND: both lenses at once
  // The lens-house: metal, a glass window on its west face at wand height, a
  // crystal prism just inside, and two blinder tubes from the prism to the
  // lenses on its east wall. Everything else inside is solid metal.
  const tubeAt = (x: number, y: number): boolean => {
    for (const s of [-1, 1]) {
      const u = (x - P.px) / (P.lensX - P.px);
      if (u < 0 || u > 1) continue;
      const cy = P.py + s * P.lensDy * u;
      if (Math.abs(y - cy) <= 2) return true;
    }
    return false;
  };
  const stampHouse = (): void => {
    for (let y = P.hy0; y <= P.floorY - 1; y++) {
      for (let x = P.hx0; x <= P.hx1; x++) {
        // Every ray the window lets in meets the prism (window, gap and prism
        // share one height), and the tubes are wide enough to survive the
        // renderer's half-resolution march.
        const windowCell = x <= P.hx0 + 1 && Math.abs(y - P.py) <= 3;
        const prism = Math.abs(x - P.px) <= 3 && Math.abs(y - P.py) <= 3;
        const lensHousing = x >= P.lensX && Math.abs(Math.abs(y - P.py) - P.lensDy) <= 1;
        if (lensHousing) continue; // the photocells' own stone
        if (windowCell) { if (t(world, x, y) !== Cell.Glass) put(world, x, y, Cell.Glass, glassColor()); }
        else if (prism) { if (t(world, x, y) !== Cell.Crystal) put(world, x, y, Cell.Crystal, packRGB(196, 170, 255)); }
        else if (x > P.hx0 + 1 && x < P.px - 3) { if (t(world, x, y) !== Cell.Empty && Math.abs(y - P.py) <= 3) put(world, x, y, Cell.Empty, AIR); else if (Math.abs(y - P.py) > 3 && t(world, x, y) !== Cell.Metal) put(world, x, y, Cell.Metal, CASING); }
        else if (tubeAt(x, y) && x < P.lensX) { if (t(world, x, y) !== Cell.Empty) put(world, x, y, Cell.Empty, AIR); }
        else if (t(world, x, y) !== Cell.Metal) put(world, x, y, Cell.Metal, CASING);
      }
    }
  };
  stampHouse();
  const lenses: Mechanism[] = [];
  for (const s of [-1, 1]) {
    // (Judged at the window: the light's only way in is through the prism.)
    lenses.push(stampPhotocell(world, out.mechanisms, P.lensX, P.py + s * P.lensDy, -1, {
      targetId: gate.id, latch: 'timed', latchFrames: PRISM_LATCH_FRAMES, port: { x: P.hx0 - 3, y: P.py },
    }));
  }
  out.repairs.push(() => { stampHouse(); for (const m of lenses) restoreHousing(world, m); });
  // The brass sill under the window (the tell) and a lamp by the door.
  for (let dx = -6; dx <= -1; dx++) put(world, P.hx0 + dx, P.floorY, Cell.Gold, dx === -3 ? packRGB(250, 214, 120) : BRASS);
  glassLamp(world, at.x0 + 24, P.floorY - 1);
}

/** The Galleries' two light rooms (own forked stream; the shared ledger). */
export function placeGalleryPuzzles(
  ctx: Ctx, rng: Rng, graph: RegionGraph, ledger: PlacementLedger,
  site: ColdStoreSite, fits: Uint8Array | undefined, out: GalleryPuzzleOutput,
): void {
  const kinds: Array<{ sizes: readonly RoomSpec[]; build: (at: Site, spec: RoomSpec) => void; interiorTop: (at: Site) => number }> = [
    { sizes: PERISCOPE_ROOMS, build: (at, spec) => periscope(ctx, rng, at, spec, out), interiorTop: (at) => at.y0 + 36 },
    { sizes: PRISM_ROOMS, build: (at, spec) => prismGate(ctx, rng, at, spec, out), interiorTop: (at) => at.y0 + 10 },
  ];
  const refused: PlacedPrefab[] = [];
  for (const { sizes, build, interiorTop } of kinds) {
    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      let at: Site | null = null, spec = sizes[0];
      for (const size of sizes) {
        at = findRoomSite(ctx.world, rng, graph, ledger, size, { ...site, maxY: HEIGHT - 70 }, [...out.placed, ...refused]);
        spec = size;
        if (at) break;
      }
      if (!at) break;
      const before = snapshot(ctx.world);
      const pickCount = out.pickups.length, repairCount = out.repairs.length, mechCount = out.mechanisms.length;
      const x1 = at.x0 + spec.w - 1;
      const floorY = at.y0 + spec.h - 12;
      const interior = { x0: at.x0 + 8, y0: at.y0 + 10, x1: x1 - 8, y1: floorY - 1 };
      const mouth = { x: at.x0 + 22, y: floorY - 10 };
      const site0 = at;
      const rollback = (why: string): void => {
        restore(ctx.world, before);
        out.pickups.length = pickCount; out.repairs.length = repairCount; out.mechanisms.length = mechCount;
        refused.push({ id: spec.id, x0: site0.x0, y0: site0.y0, x1, y1: site0.y0 + spec.h - 1 });
        console.warn(`[glass-galleries] ${spec.id}: ${why}; trying elsewhere`);
      };
      if (!carveRoom(ctx, rng, graph, fits, site.spawn, floorY, mouth, interior, ledger)) { rollback('could not be joined to the caves'); continue; }
      build(at, spec);
      if (!roomReachable(ctx.world, site.spawn, interior.x0, interiorTop(at), at.x0 + 40, floorY - 1)) { rollback('lost its approach'); continue; }
      if (intrudes(ctx.world, before.types, ledger)) { rollback('its carve cut into another placement'); continue; }
      ledger.reserve(at.x0 - ROOM_MARGIN, at.y0 - ROOM_MARGIN, x1 + ROOM_MARGIN, at.y0 + spec.h + ROOM_MARGIN, spec.id);
      out.placed.push({ id: spec.id, x0: at.x0, y0: at.y0, x1, y1: at.y0 + spec.h - 1 });
      done = true;
    }
    if (!done) console.warn(`[glass-galleries] no site for ${sizes[0].id}`);
  }
}

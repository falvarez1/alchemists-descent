import { HEIGHT, WIDTH } from '@/config/constants';
import type { Rng } from '@/core/rng';
import type { AuthoredLight, Ctx, HazardEmitter, LockKind, Mechanism, Pickup, PlacedPrefab, RegionGraph } from '@/core/types';
import { makePickup } from '@/core/pickupDefs';
import { makePlug } from '@/core/mechanismFactories';
import { blocksEntity, Cell } from '@/sim/CellType';
import { goldColor, packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';
import type { PlacementLedger } from '@/world/connect';
import { carveRoom, intrudes, restore, ROOM_MARGIN, roomReachable, snapshot, type RoomSpec, type Site } from '@/world/lightPuzzles';
import { clearLooseStock } from '@/world/looseStock';

/* ============================================================
 * THE LOCKS (the "more fun" round, GEN 64). Each campaign floor used to hide
 * its golden key in a far pocket of rock: the same hunt on every floor. Now the
 * key sits in a VAULT CHAMBER on the route, in plain sight, behind a seal the
 * floor's own puzzle breaks — and each floor asks a different question:
 *
 *   d2 THE GAS BELL     — a brass bell of marsh gas: light it (from far away).
 *   d3 THE WEIR         — water is the wire: flood the channel, then shock it.
 *   d4 THE CRUCIBLE     — quench the lava crucible to open the Colossus's gate.
 *
 * The shared pattern (it is D1's oil-soaked barricade, grown up):
 *   - the vault is a METAL box (a rescue tunnel eats stone and spares only metal;
 *     nothing here can be dug around) whose doorway is a thick METAL DOOR, a plug
 *     with `routeSeal: true`. Findability audits the grid with every intact route seal
 *     open (validate routeSealedInput), so the key behind it is "reachable" and
 *     nothing carves a way round; the gauge rescue judges the same view.
 *   - the machine: sensor/latch -> one-shot relay (outputAction 'break') -> plug.
 *   - brute force is NOT the way in, by measurement: a Stone plug 20 cells deep fell to
 *     three Spark Bolts (blasts clear stone) or five seconds of the Excavate Ray, so the first
 *     curious shot at the door skipped the whole puzzle. The door is Metal (blasts, ray, acid
 *     and fire all leave it alone); only the machine — or any other way of working it: a fuse of
 *     oil to the bell, a flame jet, a bomb in the bell's own gas — and the relent open it.
 *   - fail-open: a destroyed relay fires on its groan, and THE WORKS RELENT: LOCK_RELENT_FRAMES of play on
 *     the floor with the seal still shut and it cracks of its own accord.
 * All of it is real cells and Mechanism fields, so a save carries it for free.
 * ============================================================ */

/** Frames of play on the floor after which a still-shut lock relents (7.5 minutes at 60 Hz). */
export const LOCK_RELENT_FRAMES = 60 * 60 * 7.5;
/** Depth and height of the vault's door (its plug). */
export const PLUG_DEPTH = 20;
export const PLUG_HEIGHT = 20;
/** A Metal door never loses cells to a blast or the ray; the fraction only keeps the plug watch from misreading a stray flake. */
export const PLUG_BREAK_FRAC = 0.95;

export const LOCK_AIR = 0x08080c;
export const LOCK_METAL = packRGB(88, 92, 100);
export const LOCK_BRASS = packRGB(176, 138, 62);

export interface LockOutput {
  mechanisms: Mechanism[];
  pickups: Pickup[];
  placed: PlacedPrefab[];
  /** Re-assert the rooms after the rescue passes (idempotent). */
  repairs: Array<() => void>;
  emitters: HazardEmitter[];
  lights: AuthoredLight[];
}

export interface LockSite {
  spawn: { x: number; y: number };
  wellX: number;
  /** Where the floor's way down is (the portal), for choosing a vault on the route; null when there is none. */
  exit: { x: number; y: number } | null;
  avoid: ReadonlyArray<{ x: number; y: number; r: number }>;
}

export function lockCell(world: World, x: number, y: number): number {
  return world.inBounds(x, y) ? world.types[world.idx(x, y)] : Cell.Wall;
}

export function putCell(world: World, x: number, y: number, type: number, color: number): void {
  if (!world.inBounds(x, y)) return;
  const i = world.idx(x, y);
  world.types[i] = type;
  world.colors[i] = color;
  world.life[i] = 0;
  world.clearChargeAt(i);
}

/** Brass-tinted metal with a little hashed grain (deterministic: no stream draw). */
export function brass(x: number, y: number): number {
  const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  const j = (n % 17) - 8;
  return packRGB(176 + j, 138 + j, 62 + (j >> 1));
}

/** A small lit lamp in the dark: light is information (the lock reads from afar). */
export function lockLight(x: number, y: number, rgb: readonly [number, number, number], radius: number, intensity: number, flicker = 0.1): AuthoredLight {
  return { x, y, r: rgb[0], g: rgb[1], b: rgb[2], intensity, radius, bloom: 0.5, flicker, flickerPhase: ((x * 31 + y * 17) % 628) / 100, falloff: 'soft', occluded: true };
}

/** The key vault's geometry, shared by the rooms that put it at their east end. */
export interface VaultLayout {
  /** The vault's open interior. */
  vx0: number; vx1: number; vy0: number; vy1: number;
  /** The plug's rect (the doorway) and the metal box that holds it. */
  plug: { x: number; y: number; w: number; h: number };
  boxX0: number; boxX1: number; boxY0: number; boxY1: number;
  /** Where the relay stands (a niche in the lintel above the plug's face). */
  relay: { x: number; y: number };
  keyX: number;
}

/** Lay the vault out against a room's east edge `x1` and floor row `floorY`. */
export function vaultLayout(x1: number, floorY: number): VaultLayout {
  const vx1 = x1 - 12, vx0 = vx1 - 18;
  const plugX = vx0 - PLUG_DEPTH;
  return {
    vx0, vx1, vy0: floorY - 22, vy1: floorY - 1,
    plug: { x: plugX, y: floorY - PLUG_HEIGHT, w: PLUG_DEPTH, h: PLUG_HEIGHT },
    boxX0: plugX, boxX1: vx1 + 3, boxY0: floorY - 28, boxY1: floorY + 2,
    relay: { x: plugX + 1, y: floorY - 24 },
    keyX: vx0 + 6,
  };
}

/**
 * Stamp the vault: a brass-trimmed metal box against the room's east wall, its doorway a stone plug,
 * the golden key inside on the floor, a lamp that shows it once the seal gives. Idempotent in the box
 * (the repair re-asserts it); the plug and the pickups are created once, by `buildVault`.
 */
export function stampVaultBox(world: World, L: VaultLayout): void {
  for (let y = L.boxY0; y <= L.boxY1; y++) {
    for (let x = L.boxX0; x <= L.boxX1; x++) {
      const interior = x >= L.vx0 && x <= L.vx1 && y >= L.vy0 && y <= L.vy1;
      const doorway = x >= L.plug.x && x < L.plug.x + L.plug.w && y >= L.plug.y && y < L.plug.y + L.plug.h;
      const niche = x >= L.relay.x - 1 && x <= L.relay.x + 1 && y >= L.relay.y - 2 && y <= L.relay.y;
      if (interior) { if (lockCell(world, x, y) !== Cell.Empty) putCell(world, x, y, Cell.Empty, LOCK_AIR); continue; }
      if (doorway) continue;
      if (niche) { putCell(world, x, y, Cell.Empty, LOCK_AIR); continue; }
      if (lockCell(world, x, y) !== Cell.Metal) putCell(world, x, y, Cell.Metal, (x + y) % 9 === 0 ? brass(x, y) : LOCK_METAL);
    }
  }
  // brass studs along the lintel's face: it reads as a strongroom, not a block of rock
  for (let y = L.boxY0 + 1; y < L.plug.y; y += 3) putCell(world, L.boxX0, y, Cell.Metal, brass(L.boxX0, y));
}

/** The door's face, in colour only (every cell is Metal): iron bands, rivets, a brass wheel and a keyhole. */
export function paintVaultDoor(world: World, L: VaultLayout): void {
  const { x, y, w, h } = L.plug;
  const cx = x + 5, cy = y + (h >> 1);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const X = x + dx, Y = y + dy;
      if (lockCell(world, X, Y) !== Cell.Metal) continue;
      let c = packRGB(72 + ((X * 7 + Y * 3) % 7), 76 + ((X * 5 + Y) % 6), 86);
      if (dx < 8) {
        // the face: two vertical iron bands, rivets, and a brass wheel with a spoked hub
        const r = Math.hypot(X - cx, (Y - cy) * 1.0);
        if (dx % 8 === 0 || dx === 7) c = packRGB(54, 56, 64);
        if (dy % 5 === 2 && (dx === 1 || dx === 6)) c = packRGB(150, 128, 70);
        if (r <= 5.2 && r >= 4) c = brass(X, Y);
        else if (r < 4 && (Math.abs(X - cx) <= 0 || Math.abs(Y - cy) <= 0 || r < 1.6)) c = brass(X, Y);
        if (dx === 1 && dy === h >> 1) c = packRGB(24, 22, 26); // the keyhole
      }
      world.colors[world.idx(X, Y)] = c;
    }
  }
}

/**
 * Build the vault and its seal: box, plug (route seal, lock tag, relent clock), the relay that breaks
 * it (returned; the room hangs its sensor chain on it), the key and a little gold inside, and the
 * gilded tell round the doorway. `lock` names the puzzle.
 */
export function buildVault(
  world: World, rng: Rng, out: LockOutput, x1: number, floorY: number, lock: LockKind,
): { layout: VaultLayout; plug: Mechanism; relay: Mechanism } {
  const L = vaultLayout(x1, floorY);
  stampVaultBox(world, L);
  // The doorway: a METAL door, 20 deep (the header says why). Findability treats it as open ground (routeSeal).
  const plug = makePlug(world, out.mechanisms, L.plug.x, L.plug.y, L.plug.w, L.plug.h, Cell.Metal, null, PLUG_BREAK_FRAC);
  paintVaultDoor(world, L);
  plug.routeSeal = true;
  plug.lock = lock;
  plug.relentFrames = LOCK_RELENT_FRAMES;
  // The relay, in its niche in the lintel above the plug's face: a metal-footed node nothing can reach to
  // dig out from under (its body is the lintel), so the only way past the seal is the seal.
  const relayList = out.mechanisms;
  let maxId = 0;
  for (const m of relayList) if (m.id > maxId) maxId = m.id;
  const relay: Mechanism = {
    id: maxId + 1, kind: 'relay', x: L.relay.x, y: L.relay.y, w: 1, h: 1, state: 0, targetId: plug.id,
    body: [[L.relay.x - 1, L.relay.y + 1], [L.relay.x, L.relay.y + 1], [L.relay.x + 1, L.relay.y + 1]],
    outputAction: 'break', delayFrames: 72,
  };
  relayList.push(relay);
  // Inside: the key, a little gold, and a lamp that shows it once the seal gives.
  out.pickups.push(makePickup('key', L.keyX, floorY - 2));
  out.pickups.push(makePickup('goldpile', L.vx0 + 14, floorY - 1, { amount: 12 + rng.int(10) }));
  out.lights.push(lockLight(L.vx0 + 11, floorY - 12, [1, 0.82, 0.42], 38, 0.9));
  // The gilded tell: flecks of gold in the lintel's face and a gold sill under the plug.
  for (let k = 0; k < 9; k++) {
    const gx = L.boxX0 + 1 + rng.int(PLUG_DEPTH - 2), gy = L.boxY0 + 1 + rng.int(L.plug.y - L.boxY0 - 3);
    if (lockCell(world, gx, gy) === Cell.Metal) putCell(world, gx, gy, Cell.Gold, goldColor());
  }
  return { layout: L, plug, relay };
}

/**
 * Clear the loose stock (oil, gunpowder, sand, water pockets...) that touches open air in and round a lock
 * room. A pocket of oil or gunpowder the room's connector exposes would spill in and lie along the floor as
 * a fuse to the machine (the Gas Bell's first live run: one bolt, one dead alchemist). Masses inside any
 * OTHER reserved room (a prefab's own powder, a lair's pool) are theirs and stay.
 */
export function sweepLockStock(world: World, ledger: PlacementLedger, r: { x0: number; y0: number; x1: number; y1: number }, pad = 16): number {
  const others = ledger.rects().filter((q) => !/^(waystone|spawn|exit-well|footing-|lock-)/.test(q.label));
  const held = (x: number, y: number): boolean => others.some((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
  return clearLooseStock(world, [{ x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad }], held, 2500);
}

/**
 * KEEP FUEL OUT OF A FIRE LOCK. Everything open that the room connects to within `reach` steps is walked,
 * and every mass of oil or gunpowder that touches it is cleared (a pocket the room's connector exposed, a
 * pool in a cave above that drains down a shaft): fuel on the hall's floor is a fuse from the bell to the
 * alchemist's boots. Masses sealed in rock stay (they are bound by it), as does anything inside another
 * reserved room. Returns the cells cleared.
 */
export function clearFuelNear(world: World, ledger: PlacementLedger, from: { x: number; y: number }, reach = 320): number {
  const W = world.width, H = world.height, types = world.types;
  const others = ledger.rects().filter((q) => !/^(waystone|spawn|exit-well|footing-|lock-)/.test(q.label));
  const held = (x: number, y: number): boolean => others.some((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
  const dist = new Int16Array(W * H).fill(-1);
  const queue: number[] = [];
  const start = Math.floor(from.x) + Math.floor(from.y) * W;
  dist[start] = 0;
  queue.push(start);
  const fuel = (t: number): boolean => t === Cell.Oil || t === Cell.Gunpowder;
  const seen = new Uint8Array(W * H);
  let cleared = 0;
  const comp: number[] = [];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % W, y = (i / W) | 0;
    const d = dist[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const X = x + dx, Y = y + dy;
      if (X < 1 || X >= W - 1 || Y < 1 || Y >= H - 9) continue;
      const j = X + Y * W;
      if (dist[j] >= 0) continue;
      const t = types[j];
      if (fuel(t) && !seen[j]) {
        // a fuel mass touching the open network: walk it whole and clear it unless another room owns it
        comp.length = 0;
        comp.push(j);
        seen[j] = 1;
        let owned = false;
        for (let h = 0; h < comp.length; h++) {
          const c = comp[h];
          const cx = c % W, cy = (c / W) | 0;
          if (held(cx, cy)) owned = true;
          for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const k = cx + ex + (cy + ey) * W;
            if (cx + ex < 1 || cx + ex >= W - 1 || cy + ey < 1 || cy + ey >= H - 9) continue;
            if (fuel(types[k]) && !seen[k]) { seen[k] = 1; comp.push(k); }
          }
        }
        if (!owned && comp.length <= 6000) {
          for (const c of comp) {
            types[c] = Cell.Empty; world.colors[c] = 0x08080c; world.life[c] = 0; world.charge[c] = 0; world.activity.touchIndex(c);
          }
          cleared += comp.length;
        }
      }
      if (d + 1 > reach || blocksEntity(types[j])) continue;
      dist[j] = d + 1;
      queue.push(j);
    }
  }
  return cleared;
}

/** One lock room: its sizes (largest first), its floor offset, and the builders. */
export interface LockRoom {
  sizes: readonly RoomSpec[];
  /** The floor row sits `floorOff` above the room's bottom. */
  floorOff: number;
  build: (at: Site, spec: RoomSpec, floorY: number) => void;
  /** Re-assert the room after the rescue passes; registered when the build succeeds. */
  repair?: (at: Site, spec: RoomSpec, floorY: number) => (() => void);
  /** True for a room whose own machine holds loose stock (the Weir's water): its hall is not swept. */
  ownsStock?: boolean;
  /** True for a room whose machine is a fire (the Gas Bell): oil and gunpowder are cleared from the whole open network round it. */
  fuelFree?: boolean;
  /** The wizard-reach check for the room's approach: x range (from the room's west) and the row. */
  approach: (at: Site, spec: RoomSpec, floorY: number) => { x0: number; y0: number; x1: number; y1: number };
}

/**
 * A site for a lock room: findRoomSite's degrading search (lightPuzzles), plus the route. The vault
 * should be ON THE WAY (spawn -> room -> exit shorter than 1.35x the straight walk, once the exit is
 * known), near the main path, and far enough from the spawn to feel like a destination.
 */
/** Diagnostics: the stage and tries the last site search needed (probes and tests read it). */
export const lockSiteStats = { stage: -1, tries: 0, via: 0, candidates: 0 };

/**
 * A site for a lock room: findRoomSite's search (lightPuzzles), made to prefer the ROUTE. A floor is
 * crowded and a 176-cell room is big, so instead of demanding a perfect site it samples up to 36 sites
 * that are good enough (rock to carve, a short way from the main path, clear of everything reserved,
 * far enough from the spawn) and takes the one closest to the way down: spawn -> room -> exit as near as
 * can be to the straight walk. With none good enough it relaxes, never silently.
 */
export function findLockSite(
  world: World, rng: Rng, graph: RegionGraph, ledger: PlacementLedger, spec: RoomSpec,
  site: LockSite, placed: readonly PlacedPrefab[],
): Site | null {
  const xSpan = WIDTH - spec.w - 40;
  const ySpan = HEIGHT - 70 - spec.h - 50;
  if (xSpan <= 0 || ySpan <= 0) return null;
  const direct = site.exit ? Math.hypot(site.exit.x - site.spawn.x, site.exit.y - site.spawn.y) : 0;
  const mainDist = (cx: number, cy: number): number => {
    let best = Infinity;
    for (const reg of graph.regions) if (reg.onMainPath) best = Math.min(best, Math.hypot(reg.cx - cx, reg.cy - cy));
    if (!Number.isFinite(best)) for (const reg of graph.regions) if (reg.area >= 80) best = Math.min(best, Math.hypot(reg.cx - cx, reg.cy - cy));
    return best;
  };
  const rock = (x0: number, y0: number): { rock: number; open: number; metal: boolean } => {
    let cells = 0, rockN = 0, open = 0;
    for (let y = y0 - 4; y <= y0 + spec.h + 4; y += 3) {
      for (let x = x0 - 4; x <= x0 + spec.w + 4; x += 3) {
        if (!world.inBounds(x, y)) return { rock: 0, open: 1, metal: true };
        const t = world.types[world.idx(x, y)];
        if (t === Cell.Metal) return { rock: 0, open: 0, metal: true };
        cells++;
        if (t === Cell.Wall || t === Cell.Stone || t === Cell.RawOre || t === Cell.Coal) rockN++;
        else if (t === Cell.Empty || t === Cell.Water || t === Cell.Lava || t === Cell.Acid || t === Cell.Gold) open++;
      }
    }
    return { rock: cells ? rockN / cells : 0, open: cells ? open / cells : 1, metal: false };
  };
  const clear = (x0: number, y0: number, stage: number): { score: number; via: number } | null => {
    const cx = x0 + spec.w / 2, cy = y0 + spec.h / 2;
    const fromSpawn = Math.hypot(cx - site.spawn.x, cy - site.spawn.y);
    if (fromSpawn < spec.minSpawnDist * (stage >= 2 ? 0.6 : 1)) return null;
    if (Math.abs(cx - site.wellX) < spec.w / 2 + 60) return null;
    if (site.avoid.some((a) => Math.hypot(cx - a.x, cy - a.y) < a.r + spec.w / 2)) return null;
    const md = mainDist(cx, cy);
    if (md > (stage === 0 ? 340 : stage === 1 ? 460 : 600)) return null;
    if (ledger.intersects(x0 - ROOM_MARGIN, y0 - ROOM_MARGIN, x0 + spec.w + ROOM_MARGIN, y0 + spec.h + ROOM_MARGIN)) return null;
    if (placed.some((p) => Math.hypot(cx - (p.x0 + p.x1) / 2, cy - (p.y0 + p.y1) / 2) < 150)) return null;
    const f = rock(x0, y0);
    if (f.metal) return null;
    if (stage < 2 && (f.rock < (stage === 0 ? 0.4 : 0.3) || f.open > (stage === 0 ? 0.3 : 0.4))) return null;
    const via = site.exit && direct > 0 ? (fromSpawn + Math.hypot(site.exit.x - cx, site.exit.y - cy)) / direct : 1;
    return { score: via + md / 600, via };
  };
  // The sample: the best of up to 48 good-enough sites (stage 0), else the relaxed stages' first.
  let best: { x0: number; y0: number; score: number; via: number } | null = null;
  let found = 0;
  const bestTries = 24000;
  for (let tries = 0; tries < bestTries && found < 48; tries++) {
    const x0 = 20 + rng.int(xSpan), y0 = 50 + rng.int(ySpan);
    const c = clear(x0, y0, 0);
    if (!c) continue;
    found++;
    if (!best || c.score < best.score) best = { x0, y0, ...c };
  }
  lockSiteStats.candidates = found;
  if (best) { lockSiteStats.stage = 0; lockSiteStats.tries = found; lockSiteStats.via = best.via; return { x0: best.x0, y0: best.y0 }; }
  for (let tries = 0; tries < 5000; tries++) {
    const stage = tries < 2500 ? 1 : 2;
    const x0 = 20 + rng.int(xSpan), y0 = 50 + rng.int(ySpan);
    const c = clear(x0, y0, stage);
    if (!c) continue;
    lockSiteStats.stage = stage; lockSiteStats.tries = tries; lockSiteStats.via = c.via;
    return { x0, y0 };
  }
  return null;
}

/**
 * Place a lock room: find a site, carve and join it, build, check that its approach is walkable and
 * that nothing sealed was cut, reserve it. Any failure rolls the world back and tries elsewhere (five
 * attempts), and a floor that cannot take the room says so (the caller keeps its old vault behaviour).
 * Returns whether a room stands.
 */
export function placeLockRoom(
  ctx: Ctx, rng: Rng, graph: RegionGraph, ledger: PlacementLedger, site: LockSite,
  fits: Uint8Array | undefined, out: LockOutput, room: LockRoom, label: string,
): boolean {
  const refused: PlacedPrefab[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    let at: Site | null = null, spec = room.sizes[0];
    for (const size of room.sizes) {
      at = findLockSite(ctx.world, rng, graph, ledger, size, site, [...out.placed, ...refused]);
      spec = size;
      if (at) break;
    }
    if (!at) break;
    const before = snapshot(ctx.world);
    const pickCount = out.pickups.length, repairCount = out.repairs.length, mechCount = out.mechanisms.length;
    const emitCount = out.emitters.length, lightCount = out.lights.length;
    const x1 = at.x0 + spec.w - 1;
    const floorY = at.y0 + spec.h - room.floorOff;
    const interior = { x0: at.x0 + 8, y0: at.y0 + 10, x1: x1 - 8, y1: floorY - 1 };
    const mouth = { x: at.x0 + 22, y: floorY - 10 };
    const site0 = at;
    const rollback = (why: string): void => {
      restore(ctx.world, before);
      out.pickups.length = pickCount; out.repairs.length = repairCount; out.mechanisms.length = mechCount;
      out.emitters.length = emitCount; out.lights.length = lightCount;
      refused.push({ id: spec.id, x0: site0.x0, y0: site0.y0, x1, y1: site0.y0 + spec.h - 1 });
      console.warn(`[locks] ${label}: ${why}; trying elsewhere`);
    };
    if (!carveRoom(ctx, rng, graph, fits, site.spawn, floorY, mouth, interior, ledger)) { rollback('could not be joined to the caves'); continue; }
    // (the connector may have opened a pocket of oil or powder into the hall: clear it before anything is built)
    if (!room.ownsStock) sweepLockStock(ctx.world, ledger, { x0: at.x0, y0: at.y0, x1, y1: at.y0 + spec.h - 1 });
    if (room.fuelFree) clearFuelNear(ctx.world, ledger, { x: at.x0 + 24, y: floorY - 6 });
    room.build(at, spec, floorY);
    const a = room.approach(at, spec, floorY);
    if (!roomReachable(ctx.world, site.spawn, a.x0, a.y0, a.x1, a.y1)) { rollback('lost its approach'); continue; }
    if (intrudes(ctx.world, before.types, ledger)) { rollback('its carve cut into another placement'); continue; }
    ledger.reserve(at.x0 - ROOM_MARGIN, at.y0 - ROOM_MARGIN, x1 + ROOM_MARGIN, at.y0 + spec.h + ROOM_MARGIN, spec.id);
    out.placed.push({ id: spec.id, x0: at.x0, y0: at.y0, x1, y1: at.y0 + spec.h - 1 });
    if (room.repair) out.repairs.push(room.repair(at, spec, floorY));
    // ...and again after the last carve (a rescue tunnel can expose another pocket)
    if (!room.ownsStock) {
      const rect = { x0: at.x0, y0: at.y0, x1, y1: at.y0 + spec.h - 1 };
      out.repairs.push(() => { sweepLockStock(ctx.world, ledger, rect); if (room.fuelFree) clearFuelNear(ctx.world, ledger, { x: at.x0 + 24, y: floorY - 6 }); });
    }
    return true;
  }
  console.warn(`[locks] no site for ${label}`);
  return false;
}

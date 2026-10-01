import type { Rng } from '@/core/rng';
import type { AuthoredLight, Ctx, HazardEmitter, Mechanism, PlacedPrefab } from '@/core/types';
import { makeLever, makePlug, makeSensor, makeValve } from '@/core/mechanismFactories';
import { Cell } from '@/sim/CellType';
import { lavaColor, packRGB, stoneColor, waterColor } from '@/sim/colors';
import type { World } from '@/sim/World';

type MaskWorld = ReturnType<typeof routeSealedWorld>;
import type { PlacementLedger } from '@/world/connect';
import { blocksEntity } from '@/sim/CellType';
import { routeSealedWorld, wizardMask } from '@/world/validate';
import { brass, LOCK_AIR, LOCK_METAL, LOCK_RELENT_FRAMES, lockCell, lockLight, PLUG_BREAK_FRAC, putCell } from '@/world/locks';

/* ============================================================
 * D4 — THE CRUCIBLE (the Kiln Heart's lock).
 *
 * The Colossus's hall used to open straight onto the caves by a mid-wall mouth. Now its entrance flank
 * is a GATEHOUSE: a Metal-sleeved corridor with a great SLAG GATE across it (a route-seal plug), and
 * beyond the gate an iron GALLERY that holds the machine:
 *
 *   - a CRUCIBLE: a Metal-lined vat of lava sunk in the gallery floor, bridged by a gangway with a
 *     four-wide hatch in it;
 *   - a CISTERN hung over the hatch, its outlet shut by a sluice valve, and a LEVER at the gallery's
 *     far end, forty cells from the vat (water on lava is violent: it makes a crust of obsidian and a
 *     great deal of steam, and the steam scalds);
 *   - a gauge on the vat's wall that counts STONE in it: when enough of the lava has been quenched
 *     the gauge latches, the relay counts a moment and the gate lets go.
 *
 * Any water will do (the cistern, a flask poured through the hatch, a thrown flask) and so will frost.
 * The vat is bridged, so the lava never has to be crossed: the Works relent, and the gate opens for
 * a player who spoiled the machine, with the gangway to carry them over. Every conductor... is Metal.
 *
 * Geometry runs outward from the hall's flank (u = 0 is the first column outside the hall's rect;
 * `e` is the direction away from the hall, the side opposite the flue). The corridor's floor stands
 * where the old mouth stood, eleven rows above the hall's floor.
 * ============================================================ */

/** The Colossus hall's measures (structures.ts builds it; the gatehouse hangs off its flank). */
export interface KilnSite {
  cx: number; cy: number; FLOOR: number; HALF: number; RX: number; RY: number; e: 1 | -1;
  /** The gallery's length (u): the default, or a shorter one where the longer would run into a reserved room. */
  gallery?: number;
}

/** The gallery lengths tried, longest first (the lever stands 14 cells in from the gallery's far end). */
export const GALLERY_LENGTHS: readonly number[] = [84, 70];

export const GATE = {
  /** Corridor length (u), its open height, and the Metal sleeve round it. */
  corridor: 34, up: 24, sleeve: 6,
  /** Gallery's open height (its length is the site's: GALLERY_LENGTHS). */
  galleryUp: 38,
  /** The gate: its start (u) and thickness. */
  plugU: 4, plugW: 12,
  /** The vat's interior (u0..u1), depth, lava rows, the lining thickness; the hatch (u). */
  potU0: 45, potU1: 72, potDepth: 8, lavaRows: 5, lining: 3, hatchU0: 57, hatchU1: 60,
  /** The cistern: interior half-width round the hatch, interior rows, wall; its outer bottom stands this far above the floor. */
  tankHalf: 12, tankRows: 6, wall: 2, tankClear: 24,
  /** The lever stands this far (u) in from the gallery's far end. */
  leverIn: 14,
  /** Stone cells the gauge wants in the vat. */
  threshold: 24,
} as const;

export interface KilnGateLayout {
  site: KilnSite;
  /** The corridor floor row (the first solid row); a standing body is on Fr - 1. */
  Fr: number;
  /** World x of outward distance u (u = 0 is the first column outside the hall's rect). */
  ox: (u: number) => number;
  /** The whole gatehouse, as a rect (for the ledger and the carve). */
  rect: { x0: number; y0: number; x1: number; y1: number };
  plug: { x: number; y: number; w: number; h: number };
  relay: { x: number; y: number };
  sensor: { x: number; y: number };
  zone: { x0: number; y0: number; x1: number; y1: number };
  tank: { x0: number; x1: number; y0: number; y1: number };
  valve: { x: number; y: number; w: number; h: number };
  leverX: number;
  /** Where the gallery's far end meets the caves (standing height). */
  mouth: { x: number; y: number };
}

export function kilnGateLayout(site: KilnSite): KilnGateLayout {
  const { cx, HALF, e } = site;
  const Fr = site.cy + site.FLOOR - 11;
  const ox = (u: number): number => cx + e * (HALF + 1 + u);
  const span = (u0: number, u1: number): { x: number; w: number } => ({ x: Math.min(ox(u0), ox(u1)), w: u1 - u0 + 1 });
  const total = GATE.corridor + (site.gallery ?? GALLERY_LENGTHS[0]);
  const xa = ox(0), xb = ox(total - 1);
  const plugSpan = span(GATE.plugU, GATE.plugU + GATE.plugW - 1);
  const hatchMid = (GATE.hatchU0 + GATE.hatchU1) / 2;
  const tankU0 = Math.round(hatchMid - GATE.tankHalf - GATE.wall + 0.5), tankU1 = tankU0 + GATE.tankHalf * 2 + GATE.wall * 2 - 1;
  const tankSpan = span(tankU0, tankU1);
  const tankY1 = Fr - GATE.tankClear, tankY0 = tankY1 - (GATE.wall * 2 + GATE.tankRows - 1);
  const valveSpan = span(GATE.hatchU0, GATE.hatchU1);
  const potSpan = span(GATE.potU0, GATE.potU1);
  return {
    site, Fr, ox,
    rect: { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: Fr - GATE.galleryUp - 4, y1: Fr + GATE.potDepth + GATE.lining + 3 },
    plug: { x: plugSpan.x, y: Fr - GATE.up, w: GATE.plugW, h: GATE.up },
    relay: { x: ox(GATE.plugU + 5), y: Fr - GATE.up - 3 },
    // (the gauge hangs under the gangway's near end: the audit judges a sensor by the open air straight above it, which is the walkway)
    sensor: { x: ox(GATE.potU0 + 1), y: Fr + 1 },
    zone: { x0: potSpan.x, y0: Fr + 1, x1: potSpan.x + potSpan.w - 1, y1: Fr + GATE.potDepth },
    tank: { x0: tankSpan.x, x1: tankSpan.x + tankSpan.w - 1, y0: tankY0, y1: tankY1 },
    valve: { x: valveSpan.x, y: tankY1 - 1, w: GATE.hatchU1 - GATE.hatchU0 + 1, h: 2 },
    leverX: ox(total - GATE.leverIn),
    mouth: { x: ox(total - 5), y: Fr - 1 },
  };
}

const metalAt = (world: World, x: number, y: number, c: number): void => { if (lockCell(world, x, y) !== Cell.Metal) putCell(world, x, y, Cell.Metal, c); };
const ironColor = (x: number, y: number): number => ((x * 7 + y * 3) % 11 === 0 ? packRGB(112, 108, 96) : packRGB(66 + ((x + y) % 5), 68 + ((x * 3 + y) % 5), 76));

/** The u-extent of the vat's lining + gangway, the pot's wall columns included. */
const POT_OUT0 = GATE.potU0 - GATE.lining;
const POT_OUT1 = GATE.potU1 + GATE.lining;

/** Carve the corridor and the gallery (only ever opens cells), lay the floor. Run once, before anything is built. */
export function carveKilnGate(world: World, L: KilnGateLayout): void {
  const { Fr, ox } = L;
  const total = GATE.corridor + (L.site.gallery ?? GALLERY_LENGTHS[0]);
  for (let u = 0; u < total; u++) {
    const up = u < GATE.corridor ? GATE.up : GATE.galleryUp;
    for (let y = Fr - up; y <= Fr - 1; y++) if (lockCell(world, ox(u), y) !== Cell.Empty) putCell(world, ox(u), y, Cell.Empty, LOCK_AIR);
    for (let y = Fr; y <= Fr + 3; y++) if (lockCell(world, ox(u), y) !== Cell.Metal) putCell(world, ox(u), y, Cell.Stone, stoneColor());
  }
}

/** Stamp (or re-stamp) every Metal part: the sleeve, the gate's frame, the vat and its gangway, the cistern and its chains, the lever's pads. Idempotent. */
export function stampKilnGate(world: World, L: KilnGateLayout, fill: boolean): void {
  const { Fr, ox } = L;
  // ---- the sleeve: the corridor wrapped in six rows of iron above and below, so the gate cannot be dug round at its own height ----
  for (let u = 0; u < GATE.corridor; u++) {
    for (let k = 1; k <= GATE.sleeve; k++) metalAt(world, ox(u), Fr - GATE.up - k, ironColor(ox(u), Fr - GATE.up - k));
    for (let k = 0; k < GATE.sleeve; k++) metalAt(world, ox(u), Fr + k, ironColor(ox(u), Fr + k));
  }
  // ---- the vat: lining, gangway, hatch ----
  for (let u = POT_OUT0; u <= POT_OUT1; u++) {
    const wall = u < GATE.potU0 || u > GATE.potU1;
    const bottom = Fr + GATE.potDepth + GATE.lining;
    for (let y = Fr; y <= bottom; y++) {
      const x = ox(u);
      const gangway = y === Fr;
      const hatch = u >= GATE.hatchU0 && u <= GATE.hatchU1 && gangway;
      if (hatch) { if (fill && lockCell(world, x, y) !== Cell.Empty) putCell(world, x, y, Cell.Empty, LOCK_AIR); continue; }
      if (!wall && !gangway && y <= Fr + GATE.potDepth) { // the vat's interior: carved once, then left to the lava
        if (fill && lockCell(world, x, y) !== Cell.Empty) putCell(world, x, y, Cell.Empty, LOCK_AIR);
        continue;
      }
      const edge = y === Fr && u % 3 === 0;
      metalAt(world, x, y, edge ? brass(x, y) : ironColor(x, y));
    }
  }
  // ---- the cistern, hung from the ceiling by two chains ----
  const { tank } = L;
  const inner = { x0: tank.x0 + GATE.wall, x1: tank.x1 - GATE.wall, y0: tank.y0 + GATE.wall, y1: tank.y1 - GATE.wall };
  for (let y = tank.y0; y <= tank.y1; y++) {
    for (let x = tank.x0; x <= tank.x1; x++) {
      if (x >= inner.x0 && x <= inner.x1 && y >= inner.y0 && y <= inner.y1) continue;
      if (y >= L.valve.y && y < L.valve.y + L.valve.h && x >= L.valve.x && x < L.valve.x + L.valve.w) continue; // the sluice's own cells
      metalAt(world, x, y, (x + y) % 7 === 0 ? brass(x, y) : packRGB(98 + ((x * 3 + y) % 6), 100 + ((x + y * 5) % 6), 108));
    }
  }
  const ceilingY = Fr - GATE.galleryUp;
  for (const cx0 of [tank.x0 + 2, tank.x1 - 3]) {
    for (let y = ceilingY; y < tank.y0; y++) for (const dx of [0, 1]) metalAt(world, cx0 + dx, y, (y >> 1) % 2 === 0 ? brass(cx0 + dx, y) : LOCK_METAL);
  }
  // ---- the lever's iron footing pads ----
  for (let dx = -1; dx <= 1; dx++) metalAt(world, L.leverX + dx, Fr, LOCK_METAL);
}

/** The relay's niche in the lintel above the gate (three wide, three tall, open air) and its footing. */
function carveRelayNiche(world: World, L: KilnGateLayout): void {
  for (let dy = -2; dy <= 0; dy++) for (let dx = -1; dx <= 1; dx++) if (lockCell(world, L.relay.x + dx, L.relay.y + dy) !== Cell.Empty) putCell(world, L.relay.x + dx, L.relay.y + dy, Cell.Empty, LOCK_AIR);
  for (let dx = -1; dx <= 1; dx++) metalAt(world, L.relay.x + dx, L.relay.y + 1, LOCK_METAL);
}

/** Paint the gate's face (colour only: every cell is Metal): riveted plates, and a seam of slag-glow at its heart. */
export function paintSlagGate(world: World, L: KilnGateLayout): void {
  const { x, y, w, h } = L.plug;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const X = x + dx, Y = y + dy;
      if (lockCell(world, X, Y) !== Cell.Metal) continue;
      let c = packRGB(58 + ((X * 7 + Y * 3) % 7), 60 + ((X * 5 + Y) % 6), 70);
      if (dx % 4 === 0) c = packRGB(36, 36, 44); // the plate seams
      if (dy % 6 === 2 && dx % 4 === 2) c = packRGB(150, 128, 70); // rivets
      if (Math.abs(dy - (h >> 1)) <= 1) c = dx % 4 === 0 ? packRGB(120, 40, 10) : packRGB(230 - (dx % 3) * 18, 96 + (dx % 4) * 10, 24); // the slag-glow band
      world.colors[world.idx(X, Y)] = c;
    }
  }
}

/** The corridor's mouth where it meets the hall: the one opening the hall's film leaves (a few columns, the corridor's own rows). */
export function kilnGateMouth(site: KilnSite): { x0: number; y0: number; x1: number; y1: number } {
  const L = kilnGateLayout(site);
  return { x0: Math.min(L.ox(0), L.ox(3)), x1: Math.max(L.ox(0), L.ox(3)), y0: L.Fr - GATE.up, y1: L.Fr - 1 };
}

/** What the gatehouse built (the caller threads its parts through generation). */
export interface KilnGateBuild {
  site: KilnSite;
  placed: PlacedPrefab;
  repair: () => void;
  mouth: { x: number; y: number };
}

export interface KilnGateOutput {
  mechanisms: Mechanism[];
  lights: AuthoredLight[];
  emitters: HazardEmitter[];
}

/**
 * Build the gatehouse and its machine on the Colossus hall's entrance flank. Returns null (and touches nothing) when the
 * gatehouse's rect would run into a reserved room or off the world; the caller then keeps the old open mouth.
 */
export function buildKilnGate(ctx: Ctx, _rng: Rng, hall: KilnSite, ledger: PlacementLedger, out: KilnGateOutput): KilnGateBuild | null {
  const world = ctx.world;
  let site = hall, L = kilnGateLayout(hall);
  let fits = false;
  for (const gallery of GALLERY_LENGTHS) {
    site = { ...hall, gallery };
    L = kilnGateLayout(site);
    const rr = L.rect;
    if (rr.x0 < 12 || rr.x1 > world.width - 12 || rr.y0 < 20 || rr.y1 > world.height - 14) continue;
    // (the hall's own reservation covers its first four columns of this rect: look past them)
    const probe = site.e > 0 ? { x0: L.ox(6), x1: rr.x1 } : { x0: rr.x0, x1: L.ox(6) };
    if (ledger.intersects(probe.x0, rr.y0, probe.x1, rr.y1)) continue;
    fits = true;
    break;
  }
  if (!fits) return null;
  const r = L.rect;
  carveKilnGate(world, L);
  stampKilnGate(world, L, true);
  const { Fr, ox } = L;
  // ---- the gate: a Metal slab, a route-seal plug, relay in its lintel niche ----
  const plug = makePlug(world, out.mechanisms, L.plug.x, L.plug.y, L.plug.w, L.plug.h, Cell.Metal, null, PLUG_BREAK_FRAC);
  plug.routeSeal = true;
  plug.lock = 'crucible';
  plug.relentFrames = LOCK_RELENT_FRAMES;
  paintSlagGate(world, L);
  carveRelayNiche(world, L);
  let maxId = 0;
  for (const m of out.mechanisms) if (m.id > maxId) maxId = m.id;
  const relay: Mechanism = {
    id: maxId + 1, kind: 'relay', x: L.relay.x, y: L.relay.y, w: 1, h: 1, state: 0, targetId: plug.id,
    body: [[L.relay.x - 1, L.relay.y + 1], [L.relay.x, L.relay.y + 1], [L.relay.x + 1, L.relay.y + 1]],
    outputAction: 'break', delayFrames: 72,
  };
  out.mechanisms.push(relay);
  // ---- the gauge: it counts Stone in the vat (a quenched crust), and latches for good ----
  const gauge = makeSensor(world, out.mechanisms, L.sensor.x, L.sensor.y, {
    sensorType: 'material', threshold: GATE.threshold, zone: L.zone, latch: 'permanent', materialFilter: [Cell.Stone],
  }, relay);
  world.colors[world.idx(L.sensor.x, L.sensor.y)] = brass(L.sensor.x, L.sensor.y);
  gauge.cue = 'lock.bell'; // (the Gas Bell's brass: the slag gate's own cue is the vault door's)
  // ---- the vat exhales as it cools: while the gauge reads stone and the gate has not yet unsealed, steam comes up the hatch ----
  for (const u of [GATE.hatchU0 + 1, GATE.hatchU1 - 1]) {
    out.emitters.push({ x: ox(u), y: Fr + 1, cell: Cell.Steam, rate: 1, dir: 180, burst: 3, phase: 0, ventOn: gauge.id });
  }
  // ---- the lava: the vat's lower rows, placed cell by cell (never settled) ----
  for (let u = GATE.potU0; u <= GATE.potU1; u++) {
    for (let y = Fr + 1 + GATE.potDepth - GATE.lavaRows; y <= Fr + GATE.potDepth; y++) putCell(world, ox(u), y, Cell.Lava, lavaColor());
  }
  // ---- the sluice over the hatch, the lever at the gallery's far end, the cistern's water (the casing full) ----
  const valve = makeValve(ctx, out.mechanisms, L.valve.x, L.valve.y, L.valve.w, L.valve.h, { material: Cell.Metal, oneShot: true });
  makeLever(out.mechanisms, L.leverX, Fr - 1, valve);
  for (let y = L.tank.y0 + GATE.wall; y <= L.tank.y1 - GATE.wall; y++) {
    for (let x = L.tank.x0 + GATE.wall; x <= L.tank.x1 - GATE.wall; x++) putCell(world, x, y, Cell.Water, waterColor());
  }
  // ---- lamps: the vat's glow, the cistern's water lit through its casing, the gate's seam ----
  out.lights.push(lockLight(ox((GATE.potU0 + GATE.potU1) / 2), Fr - 6, [1, 0.5, 0.16], 56, 1.0, 0.25));
  out.lights.push(lockLight(ox((GATE.hatchU0 + GATE.hatchU1) / 2), L.tank.y0 + 5, [0.4, 0.75, 1], 28, 1.0, 0.12, false));
  out.lights.push(lockLight(L.plug.x + L.plug.w / 2, Fr - 12, [1, 0.55, 0.22], 30, 0.9, 0.3));
  ledger.reserve(r.x0, r.y0, r.x1, r.y1, 'lock-crucible');
  const placed: PlacedPrefab = { id: 'lock-crucible', x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
  const repair = (): void => {
    stampKilnGate(world, L, false);
    for (const [x, y] of plug.body ?? []) if (lockCell(world, x, y) !== Cell.Metal) putCell(world, x, y, Cell.Metal, LOCK_METAL);
    paintSlagGate(world, L);
    carveRelayNiche(world, L);
  };
  return { site, placed, repair, mouth: L.mouth };
}

/**
 * THE HALL KEEPS ITS WALLS (the gate is only a lock if it is the way in). The Colossus's hall is carved over whatever caves
 * were there, and on most seeds a cave runs straight into it: the gate would be an ornament. This lays a film of iron two
 * cells thick over every open cell OUTSIDE the hall that touches the hall's open air, except the gatehouse (the way in
 * is the gate). `strict` lays it whole: on most seeds the hall is a junction of caves, the film cuts some side caves from the
 * spawn, and anything the level REQUIRES there is re-joined by the generator's own rescue passes (the gate's gallery is a
 * rescue mouth). Without `strict` it gives way where it would cut the level, as the guardians' hall shells do (wardenArenas
 * reshellHall): by sector round the hall, three tries, then the whole film is taken back. Returns the cells laid.
 */
export function sealKilnHall(
  world: World, spawn: { x: number; y: number }, site: KilnSite, mechanisms: readonly Mechanism[],
  keep: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>,
  strict = false,
): number {
  const { cx, cy, FLOOR, HALF, RX, RY } = site;
  const inHall = (X: number, Y: number): boolean => ((X - cx) / RX) ** 2 + ((Y - cy) / RY) ** 2 <= 1 || (Math.abs(X - cx) <= HALF && Y >= cy && Y <= cy + FLOOR - 1);
  const inKeep = (X: number, Y: number): boolean => keep.some((r) => X >= r.x0 && X <= r.x1 && Y >= r.y0 && Y <= r.y1);
  const W = world.width;
  const open = (X: number, Y: number): boolean => world.inBounds(X, Y) && !blocksEntity(world.types[X + Y * W]);
  const first: number[] = [];
  for (let Y = cy - RY - 3; Y <= cy + FLOOR - 1; Y++) {
    for (let X = cx - RX - 3; X <= cx + RX + 3; X++) {
      if (!world.inBounds(X, Y) || inHall(X, Y) || inKeep(X, Y) || !open(X, Y)) continue;
      if ((inHall(X + 1, Y) && open(X + 1, Y)) || (inHall(X - 1, Y) && open(X - 1, Y)) || (inHall(X, Y + 1) && open(X, Y + 1)) || (inHall(X, Y - 1) && open(X, Y - 1))) first.push(X + Y * W);
    }
  }
  if (first.length === 0) return 0;
  // the second layer: the open cells outside the hall that touch the first
  const mark = new Set<number>(first);
  const film: number[] = first.slice();
  for (const i of first) {
    const X = i % W, Y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const j = X + dx + (Y + dy) * W;
      if (mark.has(j) || !world.inBounds(X + dx, Y + dy) || inHall(X + dx, Y + dy) || inKeep(X + dx, Y + dy) || !open(X + dx, Y + dy)) continue;
      mark.add(j); film.push(j);
    }
  }
  const SECTORS = 24;
  const sectorOf = (i: number): number => {
    const a = Math.atan2((((i / W) | 0) - cy) / RY, ((i % W) - cx) / RX);
    return Math.floor(((a + Math.PI) / (Math.PI * 2)) * SECTORS) % SECTORS;
  };
  if (strict) {
    for (const i of film) putCell(world, i % W, (i / W) | 0, Cell.Metal, ironColor(i % W, (i / W) | 0));
    return film.length;
  }
  const view = (): MaskWorld => routeSealedWorld(world, mechanisms);
  const before = wizardMask({ world: view(), spawn });
  const spared = new Set<number>();
  const saved = new Map<number, { t: number; c: number }>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const laid: number[] = [];
    for (const i of film) {
      if (spared.has(sectorOf(i)) || world.types[i] === Cell.Metal) continue;
      saved.set(i, { t: world.types[i], c: world.colors[i] });
      const X = i % W, Y = (i / W) | 0;
      putCell(world, X, Y, Cell.Metal, ironColor(X, Y));
      laid.push(i);
    }
    if (laid.length === 0) return 0;
    const after = wizardMask({ world: view(), spawn });
    const lostSectors = new Set<number>();
    let lost = 0;
    for (let i = 0; i < before.length; i++) {
      if (!before[i] || after[i]) continue;
      const X = i % W, Y = (i / W) | 0;
      if (inHall(X, Y) || inKeep(X, Y)) continue; // the hall's own air is the gate's to reach
      lost++;
      lostSectors.add(sectorOf(i));
    }
    if (lost === 0) return laid.length;
    for (const i of laid) { const s = saved.get(i)!; world.types[i] = s.t; world.colors[i] = s.c; world.activity.touchIndex(i); }
    for (const s of lostSectors) { spared.add(s); spared.add((s + 1) % SECTORS); spared.add((s + SECTORS - 1) % SECTORS); }
  }
  return 0;
}

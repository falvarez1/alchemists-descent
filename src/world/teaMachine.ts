import type { AuthoredLight, Mechanism, RigidShape, SpawnBodyOpts } from '@/core/types';
import type { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, packRGB } from '@/sim/colors';

/**
 * The first level's bell-making workshop, above the inspection catwalk.
 *
 * Every station sits in the lower half of the hall, directly over the
 * catwalk, so the alchemist walks beneath the chain reaction and sees each
 * handoff in one frame. Three stations are built to stop — a broken fuse
 * coupling, a stuck tollgate, a clogged downpipe — and each has a service
 * fixture hanging into the catwalk that a starting verb fixes (Spark Bolt,
 * kick, water flask). Each also has a slow physical backup, so the engine
 * never waits on the player forever.
 */
export const TEA = {
  lever: { x: 430, y: 305, id: 8201 },
  /** The machine hall. Maintenance recharges re-stamp only inside it. */
  bounds: { x0: 448, y0: 25, x1: 1555, y1: 264 },
  /** Hall + catwalk + the duck's bath: simulated while the engine runs. */
  simBounds: { x0: 436, y0: 25, x1: 1560, y1: 336 },
  /** The crank's striker lights the first fuse here. */
  striker: { x: 453, y: 255 },
  fuse: { x0: 452, x1: 577, y: 256 },
  /** A broken coupling: the first fuse always fizzles against it. */
  coupling: { x: 520, y: 253, w: 6, h: 7 },
  /** Priming pan hung under the hall floor. A spark here jumps the coupling. */
  pan: { x: 519, y: 264, w: 8, h: 3 },
  /** The hemp cord runs from the bob over a pulley and down to this cleat, IN the fuse. */
  cleat: { x: 570, y: 256, w: 8 },
  /** The Persuader: a kickable weight on a chain, hanging into the catwalk. */
  persuader: { x: 752, y: 264, length: 24 },
  gate: { x: 735, y: 140, w: 3, h: 22 },
  backstop: { x: 866, y: 152, w: 3, h: 20 },
  springLatch: { x: 881, y: 182, w: 8, h: 3 },
  tank: { x0: 986, x1: 1021, y0: 128, y1: 149 },
  tap: { x: 1001, y: 150, w: 6, h: 4 },
  pipe: { x0: 1001, x1: 1006, y0: 154, y1: 258 },
  nozzle: { x: 1003, y: 264 },
  /** The duck's bath, sunk under a grated stretch of the catwalk floor. */
  bath: { x0: 982, x1: 1017, y0: 316, y1: 327 },
  duckRest: 324,
  /** The duck's rod lifts this pin; the steel marble behind it runs the long rail to the flint. */
  pin: { x: 1042, y: 145, w: 2, h: 8 },
  rail: { x0: 1027, x1: 1290, y: 150, slope: .25 },
  flint: { x: 1282, y: 204 },
  fuse2: { x0: 1300, x1: 1499, y: 223 },
  charges: [1365, 1426, 1487],
  bellGate: { x: 1538, y: 244, w: 8, h: 3 },
  generatorTerminal: { x: 1524, y: 224 },
  magnetTerminal: { x: 1368, y: 97 },
  cup: { x: 1507, y: 242 },
  receiver: { x: 1541, y: 251 },
} as const;

/** Director stages. The order is the causal order of the chain. */
export const TEA_STAGE = {
  IDLE: 0, FUSE: 1, SPARK: 2, CORD: 3, SWING: 4, RAMP: 5, KICK: 6, DOMINOES: 7, SPRING: 8,
  POUR: 9, MARBLE: 10, FUSE2: 11, CHARGES: 12, GENERATOR: 13, MAGNET: 14, BELL: 15, DONE: 16,
} as const;
export const TEA_COMPLETE_STAGE = TEA_STAGE.DONE;

/** How long each fault waits for the player before its physical backup acts (ticks). */
export const TEA_BACKUP = {
  /** The slow match creeps along the catwalk ceiling from the striker to the pan. */
  spark: 540,
  /** The clockwork knocker winds up beside the Persuader, then swings. */
  kick: 600,
} as const;
/** Water standing in the duck's bath that floats it to its trip (the HUD's seep gauge). */
export const BATH_TRIP_WATER = 120;

export const TEA_VALVES = {
  gate: { plate: TEA.gate, dx: 0, dy: -1, max: 28 },
  spring: { plate: TEA.springLatch, dx: -1, dy: 0, max: 14 },
  tap: { plate: TEA.tap, dx: 0, dy: -1, max: 12 },
  pin: { plate: TEA.pin, dx: 0, dy: -1, max: 18 },
  bell: { plate: TEA.bellGate, dx: 0, dy: -1, max: 20 },
} as const;
export type TeaValve = keyof typeof TEA_VALVES;

const PENDULUM_PIVOT = { x: 653, y: 55 };
const BOB = { x: 602, y: 119 };
/** The cord's pulley. The rope joint holds the bob from here; the cord's
 * rendered run continues down to the cleat, where the fuse burns it. */
export const TEA_CORD_PULLEY = { x: 575, y: 80 };

export const TEA_BODIES: ReadonlyArray<{
  key: string; x: number; y: number; shape: RigidShape; opts: SpawnBodyOpts;
  rope?: { x: number; y: number; length: number; material?: 'rope' | 'chain' };
  tether?: { x: number; y: number; length: number };
}> = [
  { key: 'pendulum', x: BOB.x, y: BOB.y, shape: { kind: 'circle', radius: 10 },
    opts: { material: 'metal', density: 3.2, restitution: .12 },
    rope: { ...PENDULUM_PIVOT, length: Math.hypot(BOB.x - PENDULUM_PIVOT.x, BOB.y - PENDULUM_PIVOT.y), material: 'chain' },
    tether: { ...TEA_CORD_PULLEY, length: Math.hypot(BOB.x - TEA_CORD_PULLEY.x, BOB.y - TEA_CORD_PULLEY.y) } },
  { key: 'boulder', x: 682, y: 138, shape: { kind: 'circle', radius: 11 },
    opts: { material: 'stone', density: 1.5, friction: .32, restitution: .12 } },
  // Hangs with 2 cells of headroom over a walking alchemist: in kick reach
  // from anywhere under it, never in the way.
  { key: 'persuader', x: TEA.persuader.x, y: TEA.persuader.y + TEA.persuader.length, shape: { kind: 'circle', radius: 5 },
    opts: { material: 'metal', density: .55, restitution: .2, angularDamping: 1.5, color: packRGB(196, 150, 72) },
    rope: { x: TEA.persuader.x, y: TEA.persuader.y, length: TEA.persuader.length, material: 'chain' } },
  ...[772, 788, 804, 820, 836, 852].map((x, i) => ({
    key: `domino-${i}`, x, y: 161,
    shape: { kind: 'box' as const, halfW: 2, halfH: 11 },
    opts: { material: 'metal' as const, density: 1.8, friction: .45, restitution: .03,
      color: packRGB(i % 2 ? 198 : 224, i % 2 ? 156 : 214, i % 2 ? 83 : 180) },
  })),
  { key: 'rocker', x: 900, y: 184, shape: { kind: 'box', halfW: 18, halfH: 2 },
    opts: { material: 'metal', density: .6, angle: .25, angularDamping: 2,
      torsionSpring: { restAngle: -.35, stiffness: .0018, damping: .06 },
      hinge: { minAngle: -.35, maxAngle: .25 }, color: packRGB(188, 142, 65) } },
  { key: 'duck', x: 1000, y: TEA.duckRest, shape: { kind: 'box', halfW: 12, halfH: 4 },
    opts: { material: 'wood', density: .23, color: packRGB(228, 177, 54), guideAxis: 'vertical' } },
  { key: 'marble', x: 1034, y: TEA.rail.y - 4, shape: { kind: 'circle', radius: 5 },
    opts: { material: 'metal', density: 2.4, friction: .1, restitution: .05, color: packRGB(186, 196, 206) } },
  { key: 'armature', x: 1507, y: 217, shape: { kind: 'box', halfW: 5, halfH: 8 },
    opts: { material: 'metal', density: 4, guideAxis: 'vertical', color: packRGB(198, 115, 58) },
    rope: { x: 1475, y: 180, length: Math.hypot(32, 37) } },
  { key: 'magnet-latch', x: 1423, y: 96, shape: { kind: 'box', halfW: 15, halfH: 3 },
    opts: { material: 'metal', density: .8, guideAxis: 'horizontal', friction: 0 } },
  { key: 'counterweight', x: 1423, y: 81, shape: { kind: 'circle', radius: 12 },
    opts: { material: 'metal', density: 3, guideAxis: 'vertical', friction: 0, linearDamping: 25,
      color: packRGB(179, 161, 118) } },
];

/** Initial gunpowder in the stretch of fuse downstream of the coupling. */
export const TEA_FUSE_TAIL_CELLS = (TEA.fuse.x1 - (TEA.coupling.x + TEA.coupling.w) + 1) * 3;

export function teaRect(world: World, r: { x: number; y: number; w: number; h: number }, material: Cell): void {
  const color = COLOR_FN[material];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), material, color?.() ?? EMPTY_COLOR);
  }
}

/** Entirely finite material stocks: opening a valve never conjures its contents. */
export function stampTeaMachine(world: World, mechanisms: Mechanism[], repair = false): AuthoredLight[] {
  const clip = (x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } => {
    const b = TEA.bounds, x0 = Math.max(x, b.x0), y0 = Math.max(y, b.y0);
    return { x: x0, y: y0, w: Math.max(0, Math.min(x + w, b.x1) - x0), h: Math.max(0, Math.min(y + h, b.y1) - y0) };
  };
  const rect = (x: number, y: number, w: number, h: number, type = Cell.Metal as Cell): void =>
    teaRect(world, repair ? clip(x, y, w, h) : { x, y, w, h }, type);
  rect(448, 26, 1108, 236, Cell.Empty);
  rect(445, 24, 1114, 4); rect(445, 259, 1114, 5);
  rect(445, 25, 4, 155); rect(1555, 25, 4, 239);
  // Open inspection balcony, joined to the Intake's existing reachable space.
  rect(412, 270, 45, 45, Cell.Empty);
  rect(420, 312, 31, 4, Cell.Stone);
  rect(330, 315, 91, 5, Cell.Metal); // safe first approach across the return shaft

  // ---- I. IGNITION. The crank's connecting rod drives a short striker rod up
  // to the head of the first fuse, which runs along the hall floor on a stone
  // bed (stone does not conduct, so a spark can only reach it through the
  // coupling). The coupling is metal: the fire always dies against it.
  rect(441, 250, 3, 40); rect(441, 248, 12, 2);
  rect(450, TEA.fuse.y + 3, TEA.fuse.x1 - 450 + 5, 1, Cell.Stone);
  rect(TEA.fuse.x0, TEA.fuse.y, TEA.coupling.x - TEA.fuse.x0, 3, Cell.Gunpowder);
  rect(TEA.coupling.x + TEA.coupling.w, TEA.fuse.y, TEA.fuse.x1 - TEA.coupling.x - TEA.coupling.w + 1, 3, Cell.Gunpowder);
  teaRect(world, TEA.coupling, Cell.Metal);
  rect(TEA.fuse.x1 + 1, TEA.fuse.y, 3, 3, Cell.Stone); // end stop: the tail cannot slump off its bed
  rect(648, 49, 11, 5); // the pendulum chain's ceiling bracket

  // ---- II. MOMENTUM. The released bob strikes the boulder off its ledge; it
  // rolls down a ramp and fetches up against a tollgate that will not lift.
  // The gate's chain runs over two pulleys and down through the floor to the
  // Persuader: kick it and the swing hauls the ratcheted gate up.
  for (let x = 670; x <= 700; x++) rect(x, 150, 1, 4);
  for (let x = 701; x < 760; x++) rect(x, 150 + Math.floor((x - 700) * .37), 1, 4);
  teaRect(world, TEA.gate, Cell.Metal);
  rect(760, 172, 110, 3); // domino rail
  teaRect(world, TEA.backstop, Cell.Metal); // catches the last domino short of the crank
  // The last domino's cable draws the latch out from under the wound crank.
  teaRect(world, TEA.springLatch, Cell.Metal);
  rect(898, 190, 5, 6); // crank bearing foot

  // ---- III. WATER. The crank's cable lifts the header tank's plug. The tank
  // drains into its downpipe — and the downpipe is clogged: the duck's bath
  // below the catwalk fills one seeping drip at a time. Water poured through
  // the grate floats the duck sooner; its rod trips the second flint.
  const t = TEA.tank;
  rect(t.x0 - 4, t.y0 - 4, t.x1 - t.x0 + 9, 4); rect(t.x0 - 4, t.y0 - 4, 4, t.y1 - t.y0 + 9);
  rect(t.x1 + 1, t.y0 - 4, 4, t.y1 - t.y0 + 9); rect(t.x0 - 4, t.y1 + 1, t.x1 - t.x0 + 9, 4);
  rect(t.x0, t.y1 - 10, t.x1 - t.x0 + 1, 11, Cell.Water);
  teaRect(world, TEA.tap, Cell.Metal);
  const p = TEA.pipe;
  rect(p.x0 - 4, p.y0, 4, p.y1 - p.y0 + 1); rect(p.x1 + 1, p.y0, 4, p.y1 - p.y0 + 1);

  // The duck's rod lifts a pin; a steel marble runs the long rail and
  // strikes the flint at the head of the second fuse. A top rail keeps it
  // on the track; a bumper stops it under the flint.
  const r = TEA.rail;
  for (let x = r.x0; x <= r.x1; x++) {
    const y = r.y + Math.floor((x - r.x0) * r.slope);
    rect(x, y, 1, 3);
    if (x > TEA.pin.x + 6 && x < r.x1 - 12) rect(x, y - 16, 1, 1);
  }
  teaRect(world, TEA.pin, Cell.Metal);
  rect(r.x1 + 1, 180, 3, 37); // bumper

  // ---- IV. FIRE AND LIGHTNING. The second fuse runs the length of the hall
  // past three packed charges; the last blast burns the copper tea bag's
  // cord, and the falling bag is a generator.
  rect(TEA.fuse2.x0 - 4, TEA.fuse2.y + 3, 1520 - TEA.fuse2.x0 + 4, 4);
  rect(TEA.fuse2.x0, TEA.fuse2.y, TEA.fuse2.x1 - TEA.fuse2.x0 + 1, 3, Cell.Gunpowder);
  for (const x of TEA.charges) {
    rect(x - 1, 211, 9, 12, Cell.Wood);
    rect(x, 212, 7, 11, Cell.Gunpowder);
  }
  // The final kettle receives a copper tea bag. Its retaining cord crosses
  // the final charge's rising flame; burning it releases the generator weight.
  rect(1500, 226, 15, 10, Cell.Empty); // the generator's drop well through the fuse shelf
  rect(1496, 236, 23, 3); rect(1496, 236, 3, 17); rect(1516, 236, 3, 17); rect(1496, 252, 23, 3);
  rect(1519, 239, 7, 2); rect(1524, 239, 2, 10); rect(1519, 247, 7, 2);
  rect(1499, 236, 17, 3, Cell.Empty);
  rect(1472, 176, 7, 4);
  rect(1500, 245, 15, 7, Cell.Water);
  rect(1504, 240, 5, 3, Cell.Metal); // brass rim; repair must not mint harvestable gold

  // The inspection catwalk joins the Intake to the bell receiver, then drops
  // into the Feeding Gallery: this is the main route through the level.
  rect(449, 264, 1076, 48, Cell.Empty);
  rect(449, 312, 1076, 4, Cell.Metal);
  // The priming pan hangs under the floor, bonded to it: a Spark Bolt's
  // current runs through the floor into the coupling and lights the far
  // side. The clogged downpipe's nozzle hangs beside the duck's bath.
  // The cord's cleat is part of the fuse's stone bed: the powder around it is
  // the knot, so the cut never depends on a flame drifting up to a rope.
  rect(TEA.pan.x, TEA.pan.y, TEA.pan.w, TEA.pan.h);
  rect(TEA.nozzle.x - 2, 264, 6, 2); rect(TEA.nozzle.x - 2, 266, 2, 1); rect(TEA.nozzle.x + 2, 266, 2, 1);
  // The duck's bath: a riveted tub under a grated stretch of catwalk. The
  // grate's bars are five cells wide (solid underfoot) with one-cell drains.
  const b = TEA.bath;
  rect(b.x0 - 4, 312, 4, b.y1 - 312 + 5); rect(b.x1 + 1, 312, 4, b.y1 - 312 + 5);
  rect(b.x0 - 4, b.y1 + 1, b.x1 - b.x0 + 9, 4);
  rect(b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, Cell.Empty);
  for (let x = b.x0 + 5; x < b.x1; x += 6) rect(x, 312, 1, 4, Cell.Empty);
  rect(1500, 253, 28, 59, Cell.Empty);
  rect(1500, 253, 19, 2, Cell.Metal);
  rect(1525, 263, 30, 188, Cell.Empty);
  rect(1531, 233, 24, 82, Cell.Empty);
  // Staggered maintenance rungs frame a clear central drop for the finished
  // bell. Keep the short delivery drop itself clear; maintenance rungs begin
  // below the catwalk, where they cannot catch either the bell or a runner.
  for (let y = 342, n = 0; y < 443; y += 30, n++) rect(n % 2 ? 1526 : 1546, y, 9, 3);
  rect(1536, 331, 11, 3); // receiver tray, one short drop below the catwalk
  // The finale extends up into a second gallery. A falling copper tea bag is
  // a linear generator; its real metal wire feeds a solenoid release above.
  rect(1524, 40, 1, 185); rect(1368, 40, 157, 1); rect(1368, 40, 1, 58);
  rect(1364, 93, 5, 8); // fixed coil core, separated from the falling weight
  rect(1373, 94, 3, 5); // armature's mechanical end stop
  teaRect(world, TEA.bellGate, Cell.Metal);
  if (!mechanisms.some(m => m.id === TEA.lever.id)) mechanisms.push({ kind: 'lever', ...TEA.lever, w: 6, h: 10, state: 0, targetId: -1, look: 'crank' });
  // Warm work lamps over each station, plus a cooler lamp over each service
  // fixture in the catwalk so the three things a player can touch read first.
  const lamp = (x: number, y: number, i: number, cool = false, radius = 132, intensity = .95): AuthoredLight => ({
    x, y, r: cool ? .72 : 1, g: cool ? .86 : .72, b: cool ? 1 : .4, intensity, radius,
    bloom: .15, flicker: .03, flickerPhase: i * 79, falloff: 'soft' as const, occluded: true,
  });
  return [
    lamp(490, 222, 0), lamp(628, 118, 1), lamp(716, 206, 2), lamp(842, 150, 3), lamp(1003, 112, 4, false, 125),
    lamp(1130, 196, 5), lamp(1260, 190, 6), lamp(1395, 150, 7), lamp(1480, 196, 8), lamp(1250, 64, 9, false, 150, .45),
    lamp(523, 290, 10, true, 70, .75), lamp(752, 292, 11, true, 70, .75), lamp(1000, 296, 12, true, 74, .75),
  ];
}

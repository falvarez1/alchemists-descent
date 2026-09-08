import type { AuthoredLight, Mechanism, RigidShape, SpawnBodyOpts } from '@/core/types';
import type { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, packRGB } from '@/sim/colors';

/** The first level's bell-making workshop, above the traversable sluice. */
export const TEA = {
  lever: { x: 430, y: 305, id: 8201 },
  bounds: { x0: 448, y0: 25, x1: 1555, y1: 264 },
  fuse: { x0: 464, x1: 591, y: 92 },
  waterGate: { x: 889, y: 143, w: 4, h: 22 },
  springLatch: { x: 810, y: 182, w: 8, h: 3 },
  acidGate: { x: 1099, y: 113, w: 13, h: 4 },
  acidPin: { x: 1146, y: 184, w: 6, h: 6 },
  lavaGate: { x: 1217, y: 91, w: 10, h: 4 },
  oilGate: { x: 1320, y: 144, w: 9, h: 4 },
  bellGate: { x: 1538, y: 244, w: 8, h: 3 },
  generatorTerminal: { x: 1524, y: 224 },
  magnetTerminal: { x: 1368, y: 97 },
  cup: { x: 1507, y: 242 },
  receiver: { x: 1541, y: 251 },
} as const;
export const TEA_COMPLETE_STAGE = 12;

export const TEA_VALVES = {
  spring: { plate: TEA.springLatch, dx: 1, dy: 0, max: 18 },
  water: { plate: TEA.waterGate, dx: 1, dy: 0, max: 12 },
  acid: { plate: TEA.acidGate, dx: 0, dy: -1, max: 20 },
  lava: { plate: TEA.lavaGate, dx: 0, dy: -1, max: 20 },
  oil: { plate: TEA.oilGate, dx: 0, dy: -1, max: 20 },
  bell: { plate: TEA.bellGate, dx: 0, dy: -1, max: 20 },
} as const;
export type TeaValve = keyof typeof TEA_VALVES;

export const TEA_BODIES: ReadonlyArray<{
  key: string; x: number; y: number; shape: RigidShape; opts: SpawnBodyOpts;
  rope?: { x: number; y: number; length: number; material?: 'rope' | 'chain' };
  tether?: { x: number; y: number; length: number };
}> = [
  { key: 'pendulum', x: 602, y: 119, shape: { kind: 'circle', radius: 10 },
    opts: { material: 'metal', density: 3.2, restitution: .12 }, rope: { x: 653, y: 55, length: Math.hypot(51, 64), material: 'chain' },
    tether: { x: 575, y: 80, length: Math.hypot(27, 39) } },
  { key: 'boulder', x: 682, y: 138, shape: { kind: 'circle', radius: 11 },
    opts: { material: 'stone', density: 1.5, friction: .32, restitution: .12 } },
  { key: 'duck', x: 967, y: 231, shape: { kind: 'box', halfW: 13, halfH: 5 },
    opts: { material: 'wood', density: .23, color: packRGB(228, 177, 54), guideAxis: 'vertical' } },
  { key: 'sugar', x: 1149, y: 177, shape: { kind: 'circle', radius: 8 },
    opts: { material: 'stone', density: 1.8, color: packRGB(213, 205, 164), friction: .2 } },
  { key: 'piston', x: 1250, y: 191, shape: { kind: 'box', halfW: 10, halfH: 4 },
    opts: { material: 'metal', density: 3, steamPiston: true, guideAxis: 'vertical', angularDamping: 8, friction: 0 } },
  { key: 'rocker', x: 825, y: 184, shape: { kind: 'box', halfW: 18, halfH: 2 },
    opts: { material: 'metal', density: .6, angle: .25, angularDamping: 2,
      torsionSpring: { restAngle: -.35, stiffness: .0018, damping: .06 },
      hinge: { minAngle: -.35, maxAngle: .25 }, color: packRGB(188, 142, 65) } },
  ...[722, 738, 754, 770, 786, 802].map((x, i) => ({
    key: `domino-${i}`, x, y: 161,
    shape: { kind: 'box' as const, halfW: 2, halfH: 11 },
    opts: { material: 'metal' as const, density: 1.8, friction: .45, restitution: .03,
      color: packRGB(i % 2 ? 198 : 224, i % 2 ? 156 : 214, i % 2 ? 83 : 180) },
  })),
  { key: 'armature', x: 1507, y: 217, shape: { kind: 'box', halfW: 5, halfH: 8 },
    opts: { material: 'metal', density: 4, guideAxis: 'vertical', color: packRGB(198, 115, 58) },
    rope: { x: 1475, y: 180, length: Math.hypot(32, 37) } },
  { key: 'magnet-latch', x: 1423, y: 96, shape: { kind: 'box', halfW: 15, halfH: 3 },
    opts: { material: 'metal', density: .8, guideAxis: 'horizontal', friction: 0 } },
  { key: 'counterweight', x: 1423, y: 81, shape: { kind: 'circle', radius: 12 },
    opts: { material: 'metal', density: 3, guideAxis: 'vertical', friction: 0, linearDamping: 25,
      color: packRGB(179, 161, 118) } },
];

export function teaRect(world: World, r: { x: number; y: number; w: number; h: number }, material: Cell): void {
  const color = COLOR_FN[material];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), material, color?.() ?? EMPTY_COLOR);
  }
}

/** Entirely finite material stocks: opening a valve never conjures its contents. */
export function stampTeaMachine(world: World, mechanisms: Mechanism[], repair = false): AuthoredLight[] {
  const rect = (x: number, y: number, w: number, h: number, type = Cell.Metal as Cell): void =>
    teaRect(world, repair ? { x: Math.max(x, TEA.bounds.x0), y: Math.max(y, TEA.bounds.y0),
      w: Math.max(0, Math.min(x + w, TEA.bounds.x1) - Math.max(x, TEA.bounds.x0)),
      h: Math.max(0, Math.min(y + h, TEA.bounds.y1) - Math.max(y, TEA.bounds.y0)) } : { x, y, w, h }, type);
  rect(448, 26, 1108, 236, Cell.Empty);
  rect(445, 24, 1114, 4); rect(445, 259, 1114, 5);
  rect(445, 25, 4, 155); rect(1555, 25, 4, 239);
  // Open inspection balcony, joined to the Intake's existing reachable space.
  rect(412, 270, 45, 45, Cell.Empty);
  rect(420, 312, 31, 4, Cell.Stone);
  rect(330, 315, 91, 5, Cell.Metal); // safe first approach across the return shaft
  // The starting crank drives a copper striker rod up to the powder trough.
  rect(441, 97, 3, 193); rect(441, 95, 24, 3);
  rect(460, 91, 4, 6); rect(464, 94, 128, 3);
  rect(464, 91, 128, 3, Cell.Gunpowder);
  rect(571, 75, 9, 5); // the hemp retaining cord crosses the fuse at its far end
  rect(648, 49, 11, 5);
  // A heavy bob swings into the little boulder. A declining rail carries it
  // past three brass wickets to the reservoir's mechanical foot switch.
  for (let x = 675; x <= 716; x++) rect(x, 150 + Math.floor(Math.max(0, x - 700) * .3), 1, 4);
  rect(720, 172, 96, 3); rect(823, 189, 5, 6); rect(843, 170, 4, 27);
  // The last domino pulls out a sliding latch beneath the wound crank. The
  // crank itself is a hinged rigid body, driven by its stored spring torque.
  teaRect(world, TEA.springLatch, Cell.Metal);
  // Header tank -> waterfall -> duck elevator. The duck is a floating rigid
  // body on a vertical guide. Its lifting chain operates the solvent gate.
  rect(833, 64, 60, 4); rect(833, 64, 4, 102); rect(889, 64, 4, 103);
  rect(833, 165, 60, 4); rect(837, 70, 52, 94, Cell.Water);
  teaRect(world, TEA.waterGate, Cell.Metal);
  rect(894, 238, 174, 4); rect(894, 192, 4, 50); rect(1064, 191, 4, 51);
  rect(944, 181, 4, 7); rect(986, 181, 4, 7); // guide mounting feet, above the water
  // Acid is kept in metal. Its little staircase ends at a sacrificial stone
  // pin, holding a much too large lump of "sugar" on an inclined slide.
  rect(1092, 57, 32, 4); rect(1092, 58, 4, 59); rect(1120, 58, 4, 59);
  rect(1092, 113, 32, 4); rect(1096, 63, 24, 50, Cell.Acid);
  for (let x = 1096; x < 1150; x++) rect(x, 136 + Math.floor((x - 1096) * .45), 1, 3);
  rect(1134, 190, 4, 12);
  // This narrow stone pedestal directly carries the sugar's weight. There is
  // no hidden metal shelf to retract when some unrelated pin disappears.
  teaRect(world, TEA.acidPin, Cell.Stone);
  rect(1140, 229, 45, 4); rect(1183, 206, 4, 27);
  // The boiler is real water under a narrow piston shaft. Lava is released
  // into the side of the kettle; the resulting steam lifts its piston.
  rect(1199, 49, 43, 4); rect(1199, 49, 4, 45); rect(1238, 49, 4, 45);
  rect(1199, 91, 43, 4); rect(1203, 55, 35, 36, Cell.Lava);
  rect(1214, 94, 3, 141); rect(1227, 94, 3, 108);
  rect(1214, 232, 24, 3); // closed elbow: molten rock must spill into the kettle
  teaRect(world, TEA.lavaGate, Cell.Metal);
  rect(1227, 204, 13, 12, Cell.Empty);
  rect(1234, 105, 4, 133); rect(1262, 104, 4, 134); rect(1234, 235, 32, 4);
  rect(1227, 210, 11, 12, Cell.Empty);
  rect(1238, 215, 24, 19, Cell.Water);
  rect(1238, 196, 5, 3); rect(1257, 196, 5, 3);
  rect(1237, 104, 27, 3);
  rect(1238, 168, 24, 2); // the rising piston strikes the fuel-tap crossbar
  // The piston crosshead and its two moving rods are rendered from its real
  // displacement: one lifts the oil gate, one scrapes the hearth's flint.
  // Oil drips onto a lava-fed hearth. A long second powder fuse links three
  // packed charges; their real blasts reveal the very small cup at the end.
  rect(1309, 91, 34, 4); rect(1309, 91, 4, 56); rect(1339, 91, 4, 56);
  rect(1309, 144, 34, 4); rect(1313, 97, 26, 47, Cell.Oil);
  teaRect(world, TEA.oilGate, Cell.Metal);
  rect(1298, 227, 236, 4); rect(1298, 216, 4, 14); rect(1530, 218, 4, 12);
  rect(1302, 223, 225, 3, Cell.Gunpowder);
  for (const x of [1365, 1426, 1487]) {
    rect(x - 1, 211, 9, 14, Cell.Wood);
    rect(x, 212, 7, 11, Cell.Gunpowder);
  }
  // The final kettle receives a copper tea bag. Its retaining cord crosses
  // the final charge's rising flame; burning it releases the generator weight.
  rect(1500, 227, 15, 9, Cell.Empty); // the generator's drop well through the hearth
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
  // Secondary containment beneath the reactive bays. Acid can eventually eat
  // through the machine's ordinary belly and the boiler can crack it; a deep
  // riveted metal drip tray keeps that readable aftermath overhead instead of
  // turning the only post-puzzle catwalk into an unavoidable lethal pool.
  rect(1074, 270, 290, 5);
  rect(1074, 258, 4, 17); rect(1360, 258, 4, 17);
  rect(1500, 253, 28, 59, Cell.Empty);
  rect(1500, 253, 19, 2, Cell.Metal);
  rect(1525, 263, 30, 188, Cell.Empty);
  rect(1531, 233, 24, 82, Cell.Empty);
  // Staggered maintenance rungs frame a clear central drop for the finished
  // bell. The old upper-right rung caught the reward sixty cells above the
  // route while the objective told players to look along the catwalk.
  // Keep the short delivery drop itself clear; maintenance rungs begin below
  // the tray, where they cannot catch either the bell or a running player.
  for (let y = 342, n = 0; y < 443; y += 30, n++) rect(n % 2 ? 1526 : 1546, y, 9, 3);
  rect(1536, 331, 11, 3); // receiver tray, one short drop below the catwalk
  // The finale extends up into a second gallery. A falling copper tea bag is
  // a linear generator; its real metal wire feeds a solenoid release above.
  rect(1524, 40, 1, 185); rect(1368, 40, 157, 1); rect(1368, 40, 1, 58);
  rect(1364, 93, 5, 8); // fixed coil core, separated from the falling weight
  rect(1373, 94, 3, 5); // armature's mechanical end stop
  teaRect(world, TEA.bellGate, Cell.Metal);
  if (!mechanisms.some(m => m.id === TEA.lever.id)) mechanisms.push({ kind: 'lever', ...TEA.lever, w: 6, h: 10, state: 0, targetId: -1, look: 'crank' });
  return [505, 630, 790, 970, 1110, 1250, 1430, 1510].map((x, i) => ({
    x, y: i % 2 ? 54 : 248, r: 1, g: .72, b: .4, intensity: .72, radius: 125,
    bloom: .15, flicker: .03, flickerPhase: i * 79, falloff: 'soft' as const, occluded: true,
  }));
}

import type { AuthoredLight, Mechanism, RigidShape, SpawnBodyOpts } from '@/core/types';
import type { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, packRGB } from '@/sim/colors';

/** The first level's bell-making workshop, above the traversable sluice. */
export const TEA = {
  lever: { x: 430, y: 305, id: 8201 },
  bounds: { x0: 448, y0: 25, x1: 1555, y1: 264 },
  fuse: { x0: 464, x1: 594, y: 165 },
  cradle: { x: 589, y: 130, w: 27, h: 3 },
  cradleStop: { x: 615, y: 108, w: 4, h: 25 },
  waterGate: { x: 889, y: 143, w: 4, h: 22 },
  acidGate: { x: 1099, y: 113, w: 13, h: 4 },
  acidPin: { x: 1137, y: 184, w: 3, h: 3 },
  lavaGate: { x: 1217, y: 91, w: 10, h: 4 },
  oilGate: { x: 1320, y: 144, w: 9, h: 4 },
  cup: { x: 1507, y: 242 },
  receiver: { x: 1541, y: 251 },
} as const;

export const TEA_BODIES: ReadonlyArray<{
  key: string; x: number; y: number; shape: RigidShape; opts: SpawnBodyOpts;
  rope?: { x: number; y: number; length: number };
}> = [
  { key: 'pendulum', x: 602, y: 119, shape: { kind: 'circle', radius: 10 },
    opts: { material: 'metal', density: 3.2, restitution: .12 }, rope: { x: 653, y: 55, length: Math.hypot(51, 64) } },
  { key: 'boulder', x: 682, y: 138, shape: { kind: 'circle', radius: 11 },
    opts: { material: 'stone', density: 1.5, friction: .32, restitution: .12 } },
  { key: 'duck', x: 967, y: 231, shape: { kind: 'box', halfW: 13, halfH: 5 },
    opts: { material: 'wood', density: .23, color: packRGB(228, 177, 54), angularDamping: 3 } },
  { key: 'sugar', x: 1149, y: 177, shape: { kind: 'circle', radius: 8 },
    opts: { material: 'stone', density: 1.8, color: packRGB(213, 205, 164), friction: .2 } },
  { key: 'piston', x: 1250, y: 191, shape: { kind: 'box', halfW: 10, halfH: 4 },
    opts: { material: 'metal', density: 3, steamPiston: true, angularDamping: 8, friction: 0 } },
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
  rect(441, 172, 3, 118); rect(441, 170, 24, 3);
  rect(460, 164, 4, 6); rect(464, 167, 138, 3);
  rect(464, 164, 131, 3, Cell.Gunpowder);
  rect(594, 163, 5, 4, Cell.Wood);
  rect(599, 139, 2, 28); rect(599, 138, 17, 2);
  teaRect(world, TEA.cradle, Cell.Metal);
  teaRect(world, TEA.cradleStop, Cell.Metal);
  rect(648, 49, 11, 5);
  // A heavy bob swings into the little boulder. A declining rail carries it
  // past three brass wickets to the reservoir's mechanical foot switch.
  for (let x = 675; x <= 826; x++) rect(x, 150 + Math.floor(Math.max(0, x - 700) * .3), 1, 4);
  rect(814, 188, 24, 4); rect(835, 170, 4, 22);
  for (const x of [714, 752, 790]) rect(x, 153 + Math.floor((x - 675) * .25), 3, 26);
  // Header tank -> waterfall -> duck elevator. The duck is a floating rigid
  // body; lifting it to the overhead trip releases the solvent downstream.
  rect(833, 64, 60, 4); rect(833, 64, 4, 102); rect(889, 64, 4, 103);
  rect(833, 165, 60, 4); rect(837, 70, 52, 94, Cell.Water);
  teaRect(world, TEA.waterGate, Cell.Metal);
  rect(894, 238, 174, 4); rect(894, 192, 4, 50); rect(1064, 191, 4, 51);
  rect(924, 183, 87, 3); // overhead pull rail
  rect(966, 168, 3, 15); rect(966, 166, 130, 3);
  // Acid is kept in metal. Its little staircase ends at a sacrificial stone
  // pin, holding a much too large lump of "sugar" on an inclined slide.
  rect(1092, 57, 32, 4); rect(1092, 58, 4, 59); rect(1120, 58, 4, 59);
  rect(1092, 113, 32, 4); rect(1096, 63, 24, 50, Cell.Acid);
  for (let x = 1096; x < 1139; x++) rect(x, 136 + Math.floor((x - 1096) * 1.15), 1, 3);
  rect(1134, 184, 32, 4); rect(1134, 187, 4, 15);
  teaRect(world, TEA.acidPin, Cell.Stone);
  // A stop beneath the sugar retracts when the acid physically consumes its pin.
  rect(1140, 186, 21, 3);
  rect(1140, 229, 45, 4); rect(1183, 206, 4, 27);
  rect(1170, 221, 3, 9); rect(1170, 95, 2, 124); rect(1170, 94, 52, 2);
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
  rect(1266, 104, 56, 2); rect(1320, 105, 2, 38);
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
  // The final kettle: a handle, a gold-rimmed cup and one wooden biscuit lid.
  rect(1496, 236, 23, 3); rect(1496, 236, 3, 17); rect(1516, 236, 3, 17); rect(1496, 252, 23, 3);
  rect(1519, 239, 7, 2); rect(1524, 239, 2, 10); rect(1519, 247, 7, 2);
  rect(1499, 237, 17, 2, Cell.Metal);
  rect(1500, 245, 15, 7, Cell.Water);
  rect(1504, 240, 5, 3, Cell.Metal); // brass rim; repair must not mint harvestable gold
  // The inspection catwalk joins the Intake to the bell receiver, then drops
  // into the Feeding Gallery: this is the main route through the level.
  rect(449, 264, 1076, 48, Cell.Empty);
  rect(449, 312, 1076, 4, Cell.Metal);
  rect(1500, 253, 28, 59, Cell.Empty);
  rect(1500, 253, 19, 2, Cell.Metal);
  rect(1525, 263, 30, 188, Cell.Empty);
  rect(1531, 233, 24, 82, Cell.Empty);
  for (let y = 282, n = 0; y < 443; y += 30, n++) rect(n % 2 ? 1526 : 1540, y, 14, 3);
  if (!mechanisms.some(m => m.id === TEA.lever.id)) mechanisms.push({ kind: 'lever', ...TEA.lever, w: 6, h: 10, state: 0, targetId: -1 });
  return [505, 630, 790, 970, 1110, 1250, 1430, 1510].map((x, i) => ({
    x, y: i % 2 ? 54 : 248, r: 1, g: .72, b: .4, intensity: .72, radius: 125,
    bloom: .15, flicker: .03, flickerPhase: i * 79, falloff: 'soft' as const, occluded: true,
  }));
}

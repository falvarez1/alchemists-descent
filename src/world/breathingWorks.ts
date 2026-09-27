import { HEIGHT, WIDTH } from '@/config/constants';
import { reseedAllStreams } from '@/core/simRandom';
import type { AuthoredLight, Ctx, Mechanism, Pickup, WorldGenApi } from '@/core/types';
import { Cell, blocksEntity } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, packRGB } from '@/sim/colors';
import { dressWorksHabitat } from './worksHabitat';
import { stampTeaMachine, TEA } from './teaMachine';
import { carveSeedCellar, plantWorksFlora, WORKS_SEED_CELLAR } from '@/world/worksFlora';

/** Authored encounter geometry; every ledge, reservoir and pipe below is real material. */
export const WORKS_ROOMS = [
  { id: 'intake', name: 'The Intake', x: 45, y: 95, w: 470, h: 220, floor: 315 },
  { id: 'sluice', name: 'Rillback Sluice', x: 455, y: 165, w: 475, h: 280, floor: 445 },
  { id: 'gallery', name: 'The Feeding Gallery', x: 910, y: 165, w: 615, h: 285, floor: 450 },
  { id: 'pressure', name: 'The Breathing Chamber', x: 1060, y: 480, w: 465, h: 250, floor: 730 },
  { id: 'refuge', name: 'The Warm Refuge', x: 675, y: 540, w: 375, h: 220, floor: 760 },
  { id: 'silt', name: 'The Silt Garden', x: 160, y: 540, w: 485, h: 285, floor: 825 },
  { id: 'return', name: 'The Undertow', x: 310, y: 860, w: 620, h: 150, floor: 1010 },
  { id: 'descent', name: 'The Lower Bell', x: 925, y: 825, w: 610, h: 185, floor: 1010 },
] as const;

/** The oil-soaked barricade between the spawn and the engine crank: the
 * first thing a new alchemist sets on fire. A route-seal plug, so it is real
 * wood that really burns (or digs), and findability walks straight through. */
export const WORKS_BARRICADE = { id: 8401, x0: 399, x1: 412, y0: 284, y1: 314 } as const;

/** The Lower Bell gate: a riveted floor grate over the way down. Its two
 * leaves are real metal that slide into slots under the floor lip once the
 * brass bell is carried to it; the descent triggers from the open pit. */
export const WORKS_GATE = {
  x: 1400, floor: 1010, pit: { x0: 1388, x1: 1412, y1: 1022 },
  leaves: { y0: 1011, y1: 1013, left: { x0: 1388, x1: 1399 }, right: { x0: 1400, x1: 1412 } },
  slot: 14, arch: { x0: 1381, x1: 1419, top: 972, pillar: 5, beam: 5 },
} as const;

/** True once both grate leaves have fully withdrawn from over the pit. */
export function worksGateOpen(world: { type(x: number, y: number): number }): boolean {
  const { pit, leaves } = WORKS_GATE;
  for (let y = leaves.y0; y <= leaves.y1; y++) for (let x = pit.x0; x <= pit.x1; x++) {
    if (world.type(x, y) === Cell.Metal) return false;
  }
  return true;
}

/** The Breathing Chamber's sunken reservoir (water rows) under its grate. */
export const WORKS_RESERVOIR = { x0: 1185, y0: 732, x1: 1409, y1: 766 } as const;
/** The Silt Garden's sunken pool (water rows). */
export const WORKS_GARDEN_POOL = { x0: 418, y0: 826, x1: 550, y1: 849 } as const;

export function worksRoomAt(x: number, y: number): (typeof WORKS_ROOMS)[number] {
  let best: (typeof WORKS_ROOMS)[number] = WORKS_ROOMS[0];
  let distance = Infinity;
  for (const room of WORKS_ROOMS) {
    const dx = Math.max(room.x - x, 0, x - room.x - room.w);
    const dy = Math.max(room.y - y, 0, y - room.floor);
    const d = dx * dx + dy * dy;
    if (d < distance) { best = room; distance = d; }
  }
  return best;
}

/** What the HUD calls the place the player stands: the engine's workshop and
 * catwalk are their own place, not whichever room's outline they overlap. */
export function worksPlaceName(x: number, y: number): string {
  if (x > TEA.bounds.x0 - 4 && x < TEA.bounds.x1 && y < 318) return 'The Bell & Tea Engine';
  return worksRoomAt(x, y).name;
}

export function generateBreathingWorks(ctx: Ctx, seed: number): ReturnType<WorldGenApi['generateLevel']> {
  const world = ctx.world;
  world.clear();
  ctx.state.currentBiome = 'earthen';
  ctx.state.worldSeed = seed >>> 0;
  reseedAllStreams(seed >>> 0);
  const hash = (x: number, y: number): number => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const put = (x: number, y: number, type: Cell, color: number): void => {
    if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), type, color);
  };
  const rect = (x: number, y: number, w: number, h: number, type = Cell.Empty as Cell, color = EMPTY_COLOR): void => {
    for (let yy = Math.max(8, y | 0); yy < Math.min(HEIGHT - 8, y + h); yy++) {
      for (let xx = Math.max(8, x | 0); xx < Math.min(WIDTH - 8, x + w); xx++) put(xx, yy, type, color);
    }
  };
  // Matte, clustered rock. Color follows mineral beds, never independent per-cell static.
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = world.idx(x, y);
      const bed = hash(x >> 4, y >> 3) % 7;
      const seam = ((y + ((hash(x >> 6, 0) % 11) - 5)) % 47) < 2;
      world.types[i] = x < 8 || x >= WIDTH - 8 || y < 8 || y >= HEIGHT - 8 ? Cell.Metal : Cell.Stone;
      world.colors[i] = seam ? packRGB(64, 88, 89) : packRGB(48 + bed * 2, 66 + bed * 2, 70 + bed * 2);
    }
  }
  for (const room of WORKS_ROOMS) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const edge = Math.min(x - room.x, room.x + room.w - x);
      const shoulder = Math.max(0, 35 - edge);
      const roof = room.y + (shoulder * shoulder / 34 | 0) + (hash(x >> 4, room.y) % 5);
      rect(x, roof, 1, room.floor - roof);
    }
  }
  const tunnel = (ax: number, ay: number, bx: number, by: number, height = 48): void => {
    const length = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let i = 0; i <= length; i++) {
      const t = i / Math.max(1, length);
      rect(Math.round(ax + (bx - ax) * t) - 19, Math.round(ay + (by - ay) * t) - height, 38, height);
    }
  };
  // Beneath the crank balcony a service tunnel joins the return shaft to the
  // sluice. The shaft is a climb between the Silt Garden and the sluice now;
  // its Intake hatch is sealed so the walk to the crank has no pitfall.
  tunnel(400, 365, 545, 400);
  tunnel(880, 400, 975, 450);
  // Keep the gallery-to-pressure chute west of the third breathing stack.
  // Its old mouth crossed the stack's solid uprights, creating a visually
  // open route that pinched the player against an eight-cell pipe throat.
  tunnel(1432, 450, 1415, 590);
  tunnel(1105, 715, 990, 760);
  tunnel(700, 760, 575, 825);
  // The garden's way down to the Undertow opens at its far west end, past the
  // return shaft. Its old mouth sat under the garden pool, which drained the
  // pool (beaching its Rillback) and flooded the Undertow within seconds.
  tunnel(190, 815, 330, 1008);
  tunnel(875, 1008, 980, 1008);
  // A return climb joins the Silt Garden to the sluice tunnel; alternating
  // landings keep it traversable with the starting jump and levitation budget.
  rect(330, 285, 82, 320);
  // Carry the rungs all the way to the garden floor. The earlier half-height
  // version asked a fresh player to spend their entire levitation charge just
  // reaching the first foothold, which made the intended return read like an
  // exploit instead of a designed route.
  for (let y = 342, step = 0; y < 810; y += 35, step++) {
    rect(step % 2 ? 330 : 383, y, 29, 5, Cell.Metal, packRGB(90, 75, 53));
  }
  rect(330, 315, 82, 8, Cell.Wood, packRGB(116, 91, 58));
  const copper = packRGB(91, 73, 48);
  // Sluice reservoir, dry bypass, and a finite lower catch basin.
  rect(566, 371, 234, 71, Cell.Water, packRGB(68, 145, 151));
  rect(555, 367, 5, 78, Cell.Metal, copper);
  rect(800, 368, 5, 77, Cell.Metal, copper);
  rect(806, 438, 101, 60);
  rect(570, 341, 63, 7, Cell.Wood, packRGB(100, 84, 55));
  rect(677, 325, 66, 7, Cell.Wood, packRGB(100, 84, 55));
  rect(789, 349, 48, 7, Cell.Wood, packRGB(100, 84, 55));
  tunnel(515, 375, 565, 348, 35);
  rect(500, 382, 48, 8, Cell.Metal, copper);
  // Galley has a low, quiet crawl route and a high web approach.
  rect(1015, 390, 195, 7, Cell.Wood, packRGB(94, 78, 53));
  rect(1230, 390, 167, 7, Cell.Wood, packRGB(94, 78, 53));
  rect(1020, 425, 340, 12);
  rect(990, 410, 25, 7, Cell.Stone, packRGB(57, 69, 69));
  rect(1385, 415, 35, 7, Cell.Stone, packRGB(57, 69, 69));
  // Ventilation is physical: pipes lead into the room, shelters have real roofs.
  for (const x of [1180, 1315, 1450]) {
    rect(x - 5, 480, 5, 105, Cell.Metal, copper);
    rect(x + 8, 480, 5, 105, Cell.Metal, copper);
    rect(x, 480, 8, 90);
    rect(x - 38, 650, 60, 8, Cell.Metal, copper);
  }
  // The vents drink from a sunken reservoir under a riveted grate. Water
  // stamped loose on the chamber floor ran down the refuge tunnel as soon as
  // the simulation woke: the "warm, dry" refuge flooded (its crate and the
  // alchemist were swept west) and the vents soon ran dry. The grate's gaps
  // still let Frost Shard, a flask or a thrown bottle reach the water.
  rect(WORKS_RESERVOIR.x0, WORKS_RESERVOIR.y0 - 1, WORKS_RESERVOIR.x1 - WORKS_RESERVOIR.x0 + 1, WORKS_RESERVOIR.y1 - WORKS_RESERVOIR.y0 + 2);
  rect(WORKS_RESERVOIR.x0, WORKS_RESERVOIR.y0, WORKS_RESERVOIR.x1 - WORKS_RESERVOIR.x0 + 1, WORKS_RESERVOIR.y1 - WORKS_RESERVOIR.y0 + 1,
    Cell.Water, packRGB(40, 83, 90));
  for (let x = WORKS_RESERVOIR.x0; x <= WORKS_RESERVOIR.x1; x++) {
    if ((x - WORKS_RESERVOIR.x0) % 8 < 6) put(x, WORKS_RESERVOIR.y0 - 2, Cell.Metal, packRGB(78, 84, 80));
    else put(x, WORKS_RESERVOIR.y0 - 2, Cell.Empty, EMPTY_COLOR);
  }
  // The refuge is a deliberate patch of warm, dry, readable ground.
  rect(767, 744, 160, 16, Cell.Stone, packRGB(73, 70, 57));
  // Worn steps on each side turn the refuge plinth into an invitation: four
  // even 4-cell rises from the floor (760) to the plinth top (744). The old
  // pair ended with a 6-cell riser, one more than a walking body steps up, so
  // running in from either side stopped dead at the plinth edge.
  for (const [x, top, color] of [[757, 748, packRGB(70, 69, 58)], [747, 752, packRGB(69, 68, 57)], [737, 756, packRGB(66, 66, 56)],
    [927, 748, packRGB(70, 69, 58)], [937, 752, packRGB(69, 68, 57)], [947, 756, packRGB(66, 66, 56)]] as const) {
    rect(x, top, 10, 760 - top, Cell.Stone, color);
  }
  rect(807, 743, 9, 2, Cell.Wood, packRGB(117, 79, 41));
  // Pale, walk-through moss marks the refuge's Frost Shard tome (an optional
  // reward now) without putting a tiny collision curb in the main path.
  rect(885, 743, 15, 1, Cell.Moss, packRGB(124, 174, 183));
  // The garden pool is a sunken basin between the dry foot of the return shaft
  // and the refuge tunnel, so it keeps its water (and its Rillback). Standing
  // loose on the floor it spread across the room and poured into the old
  // Undertow chute beneath it.
  rect(WORKS_GARDEN_POOL.x0, WORKS_GARDEN_POOL.y0 - 1, WORKS_GARDEN_POOL.x1 - WORKS_GARDEN_POOL.x0 + 1, WORKS_GARDEN_POOL.y1 - WORKS_GARDEN_POOL.y0 + 2);
  rect(WORKS_GARDEN_POOL.x0, WORKS_GARDEN_POOL.y0, WORKS_GARDEN_POOL.x1 - WORKS_GARDEN_POOL.x0 + 1, WORKS_GARDEN_POOL.y1 - WORKS_GARDEN_POOL.y0 + 1,
    Cell.Water, packRGB(48, 98, 93));
  // A broad, dry dock at the shaft foot makes the start of the backtrack explicit.
  rect(330, 788, 29, 5, Cell.Metal, packRGB(90, 75, 53));
  rect(267, 780, 42, 7, Cell.Stone, packRGB(78, 89, 80));
  rect(1030, 983, 65, 27, Cell.Sand, packRGB(126, 110, 74));
  rect(1130, 996, 125, 14, Cell.Wood, packRGB(85, 64, 40));
  // Visible detours offer new spell verbs before the refuge's wand workbench.
  rect(244, 260, 42, 5, Cell.Wood, packRGB(100, 79, 50));
  rect(638, 950, 70, 6, Cell.Wood, packRGB(87, 72, 49));

  // TWO QUIET LESSONS IN THE INTAKE, beside the loud one (the barricade on
  // the forced route, stamped below). Neither does anything until the player
  // acts, and both answer a wand with the whole simulation at once.
  //
  // 1. The sealed store, left of the spawn: a wooden gate in a stone wall,
  //    a dark oil slick soaked into its foot, and warm light leaking over
  //    the top of the wood. The spark bolt's blast turns wood and oil into
  //    fire; the gate burns out of the wall and the store is open.
  const oilColor = COLOR_FN[Cell.Oil] ?? (() => packRGB(46, 38, 28));
  rect(14, 288, 31, 27);
  rect(45, 290, 5, 25, Cell.Wood, packRGB(112, 84, 52));
  // Oil-cored timber: two sealed channels of oil between three planks. Wood
  // alone catches too fitfully (flammability 0.1) to burn a whole gate from
  // one blast; once any plank opens, the oil inside burns long and hot,
  // pours out of the breach, and takes the rest of the gate with it.
  for (let y = 291; y < 315; y++) { put(46, y, Cell.Oil, oilColor()); put(48, y, Cell.Oil, oilColor()); }
  // The slick runs UNDER the gate's foot as well: a burning gate that left a
  // knee-high stump at the floor would still be a gate.
  rect(45, 315, 13, 1);
  for (let x = 45; x < 58; x++) put(x, 315, Cell.Oil, oilColor());
  rect(18, 311, 7, 3, Cell.Glowshroom, packRGB(105, 175, 140));
  // 2. The sand plug, over the walk from the spawn to the return shaft: a
  //    stone overhang whose belly is packed with sand around a gold pile,
  //    ore glinting on its underside (ore, not gold powder, which would pour
  //    out on its own). The excavation ray opens the glinting lip; the sand
  //    comes down in a curtain onto solid floor and the gold with it.
  const sandColor = COLOR_FN[Cell.Sand] ?? (() => packRGB(126, 110, 74));
  rect(288, 236, 40, 26, Cell.Stone, packRGB(52, 70, 74));
  for (let y = 240; y < 258; y++) for (let x = 293; x < 323; x++) put(x, y, Cell.Sand, sandColor());
  for (const [x, y] of [[303, 261], [304, 261], [305, 261], [311, 261], [312, 261], [308, 260], [317, 261]]) put(x, y, Cell.RawOre, packRGB(214, 176, 62));
  rect(305, 312, 6, 3, Cell.Glowshroom, packRGB(105, 175, 140));

  // FLORA: the Seed Cellar off the Undertow's west end (worksFlora).
  carveSeedCellar(world);

  // Chalk lips face walkable space. Sparse oxidation faces the walls.
  for (let y = 12; y < HEIGHT - 9; y++) {
    for (let x = 10; x < WIDTH - 10; x++) {
      const i = world.idx(x, y);
      if (world.types[i] !== Cell.Stone) continue;
      if (!blocksEntity(world.types[i - WIDTH])) {
        world.colors[i] = packRGB(105, 119, 111);
        if (world.types[i + WIDTH] === Cell.Stone) world.colors[i + WIDTH] = packRGB(61, 78, 75);
        if (hash(x, y) % 37 === 0 && world.types[i - WIDTH] === Cell.Empty) {
          put(x, y - 1, Cell.Moss, packRGB(63, 96, 80));
        }
      } else if (world.types[i + 1] === Cell.Empty || world.types[i - 1] === Cell.Empty) {
        world.colors[i] = packRGB(55, 71, 70);
      }
    }
  }
  // Glowshroom clumps grow ON something: each settles onto the first solid
  // surface under its spot (several authored heights had drifted 3-12 cells
  // above floors that later passes moved, leaving clumps hanging in the air).
  for (const [x, y] of [[275, 311], [505, 396], [992, 447], [1330, 386], [918, 741], [262, 820]]) {
    let floor = y - 3;
    while (floor < HEIGHT - 9 && !blocksEntity(world.type(x + 2, floor))) floor++;
    rect(x, floor - 3, 6, 3, Cell.Glowshroom, packRGB(105, 175, 140));
  }
  dressWorksHabitat(world, seed);
  const valveBody: Array<[number, number]> = [];
  for (let y = 412; y < 437; y++) for (let x = 800; x < 805; x++) valveBody.push([x, y]);
  const mechanisms: Mechanism[] = [
    { id: 8101, kind: 'lever', x: 524, y: 370, w: 8, h: 12, state: 0, targetId: 8102, look: 'handwheel' },
    { id: 8102, kind: 'valve', x: 800, y: 412, w: 5, h: 25, state: 0, targetId: 0, material: Cell.Metal, body: valveBody, oneShot: false },
  ];
  const pickup = (kind: Pickup['kind'], x: number, y: number, data: Pickup['data'] = {}): Pickup =>
    ({ kind, x, y, vx: 0, vy: 0, taken: false, data });
  const machineLights = stampTeaMachine(world, mechanisms);
  // THE BARRICADE. The forced route from the spawn to the engine crank runs
  // through an oil-soaked timber barricade under an iron lintel: the store
  // gate's lesson, moved to where nobody can miss it. Its seams are caulked
  // with dry moss, the tinder that takes a Spark Bolt's flash, and its oil is
  // sealed in small pockets down the timber's core, deeper than the blast
  // reaches from the face (a burst oil store throws burning debris back at
  // the shooter, and oil on the alchemist burns five times as long). The
  // flame runs the seams, the pockets flare, and the barricade goes up.
  // Mostly burned, it collapses (a route-seal plug), so no stump is left.
  // Excavate digs wood too, so it can never lock the level. The lintel meets
  // the striker rod: the only way into the balcony is through the timber.
  const B = WORKS_BARRICADE;
  rect(B.x0 - 4, 278, 443 - (B.x0 - 4), 6, Cell.Metal, packRGB(70, 66, 62));
  const barricadeBody: Array<[number, number]> = [];
  const channels = [B.x0 + 8, B.x0 + 9];
  for (let y: number = B.y0; y <= B.y1; y++) for (let x: number = B.x0; x <= B.x1; x++) {
    // Sealed pockets of oil down the core of the boards: each flares as the
    // fire reaches it, but together they are too little to pool into a puddle
    // that would keep a careless point-blank shooter alight.
    if (channels.includes(x) && y > B.y0 + 3 && y < B.y1 - 3 && (y - B.y0) % 5 === 2) { put(x, y, Cell.Oil, packRGB(38, 28, 19)); continue; }
    // Crosswise boards, five rows deep, each its own tone; the oil has
    // blackened the lower boards and two pale braces cross the whole face.
    const board = Math.floor((y - B.y0) / 5), row = (y - B.y0) % 5;
    const soak = Math.min(1, Math.max(0, (y - B.y0 - 6) / (B.y1 - B.y0 - 6)));
    const u = (x - B.x0) / (B.x1 - B.x0), v = (y - B.y0) / (B.y1 - B.y0);
    const brace = Math.abs(u - v) < .09 || Math.abs(u - (1 - v)) < .09;
    const tone = (hash(board, 17) % 3) * 6 + (hash(x, y) % 5) - 2;
    let r = 142 + tone, g = 101 + tone, b = 58 + tone * .6;
    if (brace) { r += 26; g += 22; b += 12; }
    // Every seam is caulked with dry moss: tinder that takes a Spark Bolt's
    // flash (wood alone catches too fitfully) and carries it across the boards.
    if (row === 4 && !brace && x > B.x0 && x < B.x1) { put(x, y, Cell.Moss, packRGB(96, 92, 58)); continue; }
    if ((x === B.x0 + 1 || x === B.x1 - 1) && row === 2) { r = 150; g = 140; b = 118; } // nail heads
    r -= soak * 44; g -= soak * 36; b -= soak * 20;
    put(x, y, Cell.Wood, packRGB(Math.round(r), Math.round(g), Math.round(b)));
    barricadeBody.push([x, y]);
  }
  // A riveted sill on the Intake side keeps the collapse's burning spill in
  // the doorway, where it pools and burns out instead of running back along
  // the bridge under the player.
  rect(B.x0 - 4, B.y1 - 1, 2, 2, Cell.Metal, packRGB(96, 84, 64));
  mechanisms.push({ id: B.id, kind: 'plug', x: B.x0, y: B.y0, w: B.x1 - B.x0 + 1, h: B.y1 - B.y0 + 1, state: 0,
    targetId: -1, material: Cell.Wood, body: barricadeBody, breakFrac: .55, routeSeal: true });

  // THE LOWER BELL GATE: a riveted floor grate over a short pit. Its iron
  // archway and lock bell are drawn behind the player (render/WorksFixtures):
  // in a side view, solid pillars would wall the grate in. The pit is the way down.
  const G = WORKS_GATE;
  rect(G.pit.x0, G.floor, G.pit.x1 - G.pit.x0 + 1, G.pit.y1 - G.floor + 1);
  rect(G.pit.x0 - G.slot, G.leaves.y0, G.slot, G.leaves.y1 - G.leaves.y0 + 1);
  rect(G.pit.x1 + 1, G.leaves.y0, G.slot, G.leaves.y1 - G.leaves.y0 + 1);
  for (let y: number = G.leaves.y0; y <= G.leaves.y1; y++) for (let x: number = G.pit.x0; x <= G.pit.x1; x++) {
    const bar = (x - G.pit.x0) % 4 === 3 || y === G.leaves.y0 || x === G.leaves.left.x1 || x === G.leaves.right.x0;
    put(x, y, Cell.Metal, bar ? packRGB(116, 104, 84) : packRGB(58, 58, 60));
  }

  // Failed electrical fixtures turn the Undertow into a deliberate tension
  // trough. Their glass and brackets occupy the grid; only the light's pulse
  // is authored. Each fixture is hung from the first real ceiling above it.
  const failingLights: AuthoredLight[] = [];
  const failingFixture = (x: number, flickerPhase: number, radius: number): void => {
    let ceiling = 858;
    while (ceiling < 930 && world.type(x, ceiling) !== Cell.Empty) ceiling++;
    if (ceiling >= 930) return;
    for (let d = 0; d < 5; d++) put(x, ceiling + d, Cell.Metal, packRGB(66 + d * 3, 78 + d * 2, 74));
    for (let dx = -3; dx <= 3; dx++) put(x + dx, ceiling + 5, Cell.Metal, packRGB(78, 89, 78));
    put(x - 1, ceiling + 6, Cell.Glass, packRGB(128, 152, 122));
    put(x, ceiling + 6, Cell.Glass, packRGB(190, 187, 122));
    put(x + 1, ceiling + 6, Cell.Glass, packRGB(102, 130, 109));
    failingLights.push({ x, y: ceiling + 7, r: .72, g: .66, b: .42, intensity: .36,
      radius, bloom: .08, flicker: .72, flickerPhase, falloff: 'soft', occluded: true });
  };
  failingFixture(388, hash(388, 860) % 600, 92);
  failingFixture(614, hash(614, 860) % 600, 76);
  failingFixture(854, hash(854, 860) % 600, 88);

  // FLORA: the floor's trees, ferns and the Seed Cellar's fittings, planted
  // last so they grow only into cells every fixture above left open.
  plantWorksFlora(world);

  const lamp = (x: number, y: number, warm = false, radius = 120, flicker = .04, intensity = .65): AuthoredLight => ({
    x, y, r: warm ? 1 : 0.46, g: warm ? 0.66 : 0.81, b: warm ? 0.30 : 0.75,
    intensity, radius, bloom: 0.12, flicker, flickerPhase: hash(x, y) % 600,
    falloff: 'soft', occluded: true,
  });
  return {
    spawn: { x: 170, y: 314 }, exit: { x: 1400, sealY: 1010, halfW: 14 },
    waystones: [{ x: 192, y: 314, lit: true }, { x: 857, y: 743, lit: true }],
    portal: { x: 1400, y: 1008, open: false }, cauldron: null,
    pickups: [pickup('key', TEA.receiver.x, TEA.receiver.y), pickup('tome', 892, 735, { card: 'frostshard' }),
      pickup('tome', 265, 252, { card: 'bounce' }), pickup('tome', 1402, 407, { card: 'heavy' }),
      pickup('tome', 672, 942, { card: 'double' }),
      pickup('heart', 820, 735), pickup('goldpile', 1470, 722, { amount: 60 }),
      pickup('goldpile', 1063, 978, { amount: 30 }),
      // The Intake lessons pay in gold: behind the wooden gate, and inside the sand plug.
      pickup('goldpile', 30, 313, { amount: 45 }), pickup('goldpile', 308, 256, { amount: 40 }),
      // The Seed Cellar's shelf: grow the root ladder to reach it.
      pickup('goldpile', WORKS_SEED_CELLAR.reward.x, WORKS_SEED_CELLAR.reward.y, { amount: 40 })],
    mechanisms, runeVaults: [], boss: null,
    prefabEnemies: [
      { kind: 'rillback', x: 707, y: 413, sourceId: 'works-rillback-sluice' },
      { kind: 'weaver', x: 1280, y: 386, sourceId: 'works-weaver-gallery' },
      { kind: 'weaver', x: 1170, y: 995, sourceId: 'works-weaver-undertow' },
      { kind: 'rillback', x: 484, y: 842, sourceId: 'works-rillback-garden' },
      { kind: 'rootloper', x: 610, y: 818, sourceId: 'works-rootloper-garden' },
      { kind: 'stonemaw', x: 755, y: 1008, sourceId: 'works-stonemaw-undertow' },
    ],
    placedPrefabs: [...WORKS_ROOMS.map(r => ({ id: `works-${r.id}`, x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.floor })),
      { id: 'works-bell-tea-engine', ...TEA.bounds }],
    authoredLights: [lamp(180, 279, true, 150), lamp(30, 300, true, 70), lamp(394, 276, true, 80, .06, .7),
      lamp(WORKS_GATE.x, WORKS_GATE.arch.top + 4, true, 90, .05, .6), lamp(675, 340), lamp(1235, 325), lamp(1450, 570, true),
      lamp(850, 702, true, 155), lamp(285, 740), lamp(1400, 948, true, 115, .1, .48), ...failingLights, ...machineLights],
    emitters: [], decors: [], refuge: { x: 857, y: 739 }, spellLab: null,
    vaultArch: null, vaultHoard: null, surfaceSpawn: null, surfaceSkyLine: null,
  };
}

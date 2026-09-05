import { HEIGHT, WIDTH } from '@/config/constants';
import { reseedAllStreams } from '@/core/simRandom';
import type { AuthoredLight, Ctx, Mechanism, Pickup, WorldGenApi } from '@/core/types';
import { Cell, blocksEntity } from '@/sim/CellType';
import { EMPTY_COLOR, packRGB } from '@/sim/colors';

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
  tunnel(440, 315, 545, 400);
  tunnel(880, 400, 975, 450);
  tunnel(1455, 450, 1420, 590);
  tunnel(1105, 715, 990, 760);
  tunnel(700, 760, 575, 825);
  tunnel(430, 815, 490, 1008);
  tunnel(875, 1008, 980, 1008);
  // A return climb reconnects the refuge to the intake; alternating landings
  // keep it traversable with the starting jump, climb and levitation budget.
  rect(330, 285, 82, 320);
  for (let y = 342, step = 0; y < 600; y += 35, step++) {
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
  rect(1185, 683, 225, 44, Cell.Water, packRGB(40, 83, 90));
  // The refuge is a deliberate patch of warm, dry, readable ground.
  rect(767, 744, 160, 16, Cell.Stone, packRGB(73, 70, 57));
  rect(807, 743, 9, 2, Cell.Wood, packRGB(117, 79, 41));
  rect(280, 794, 210, 30, Cell.Water, packRGB(48, 98, 93));
  rect(267, 780, 42, 7, Cell.Stone, packRGB(78, 89, 80));
  rect(1030, 983, 65, 27, Cell.Sand, packRGB(126, 110, 74));
  rect(1130, 996, 125, 14, Cell.Wood, packRGB(85, 64, 40));

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
  for (const [x, y] of [[275, 311], [505, 390], [992, 447], [1330, 386], [929, 738], [236, 820]]) {
    rect(x, y - 3, 6, 3, Cell.Glowshroom, packRGB(105, 175, 140));
  }
  const valveBody: Array<[number, number]> = [];
  for (let y = 412; y < 437; y++) for (let x = 800; x < 805; x++) valveBody.push([x, y]);
  const mechanisms: Mechanism[] = [
    { id: 8101, kind: 'lever', x: 524, y: 370, w: 8, h: 12, state: 0, targetId: 8102 },
    { id: 8102, kind: 'valve', x: 800, y: 412, w: 5, h: 25, state: 0, targetId: 0, material: Cell.Metal, body: valveBody, oneShot: false },
  ];
  const pickup = (kind: Pickup['kind'], x: number, y: number, data: Pickup['data'] = {}): Pickup =>
    ({ kind, x, y, vx: 0, vy: 0, taken: false, data });
  const lamp = (x: number, y: number, warm = false, radius = 120): AuthoredLight => ({
    x, y, r: warm ? 1 : 0.46, g: warm ? 0.66 : 0.81, b: warm ? 0.30 : 0.75,
    intensity: 0.65, radius, bloom: 0.12, flicker: 0.04, flickerPhase: hash(x, y) % 600,
    falloff: 'soft', occluded: true,
  });
  return {
    spawn: { x: 170, y: 314 }, exit: { x: 1400, sealY: 1010, halfW: 14 },
    waystones: [{ x: 192, y: 314, lit: true }, { x: 857, y: 743, lit: true }],
    portal: { x: 1400, y: 1008, open: false }, cauldron: null,
    pickups: [pickup('key', 285, 772), pickup('tome', 892, 735, { card: 'heavy' }),
      pickup('heart', 820, 735), pickup('goldpile', 1470, 722, { amount: 60 }),
      pickup('goldpile', 1063, 978, { amount: 30 })],
    mechanisms, runeVaults: [], boss: null,
    prefabEnemies: [
      { kind: 'rillback', x: 707, y: 413, sourceId: 'works-rillback-sluice' },
      { kind: 'weaver', x: 1280, y: 386, sourceId: 'works-weaver-gallery' },
      { kind: 'weaver', x: 1170, y: 995, sourceId: 'works-weaver-undertow' },
      { kind: 'rillback', x: 405, y: 810, sourceId: 'works-rillback-garden' },
    ],
    placedPrefabs: WORKS_ROOMS.map(r => ({ id: `works-${r.id}`, x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.floor })),
    authoredLights: [lamp(180, 279, true, 150), lamp(675, 340), lamp(1235, 325), lamp(1450, 570, true),
      lamp(850, 702, true, 155), lamp(285, 740), lamp(1400, 948, true)],
    emitters: [], decors: [], refuge: { x: 857, y: 739 }, spellLab: null,
    vaultArch: null, vaultHoard: null, surfaceSpawn: null, surfaceSkyLine: null,
  };
}

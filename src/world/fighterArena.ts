import { BACKDROP_LAYER_SPECS, createDefaultBackdropSettings } from '@/config/backdrop';
import { HEIGHT, WIDTH } from '@/config/constants';
import type { CardId, Ctx } from '@/core/types';
import { makePickup } from '@/core/pickupDefs';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';
import { YARD_STATIONS, type YardStation } from '@/content/fighterArena';

/**
 * THE PROVING YARD (worldgraph id 'fighter-test', docs/FIGHTERS.md): a foundry yard under a girder roof where
 * each of the ten fighters can be walked through every move they have. One hall, left to right, a station per
 * thing a fighter's kit needs something to act on:
 *
 *   The Muster         start; a dais, two potions (Edda's Stored Light)
 *   The Sparring Ring  open sand floor between two cover pillars; foes spawn here
 *   The Gallery        a metal ledge over the ring's right end: shooters stand here (Brann's plate, Mara's chime)
 *   The Kiln Wall      a raised bay: a wooden barricade over a powder keg; then an oil lane and a torch (Rusk, Ilyra, Nox)
 *   The Bluff          a 96-high block with a low tunnel through it, and a ledge-tower (Sable, Kest, Selene, Thorne)
 *   The Cistern        a pool 40 deep under a grating bridge, mossy banks (Thorne's camouflage)
 *   The Locked Cell    a raised, sealed stone cell with a wooden door and foes inside (reveals through walls)
 *
 * The corridor under everything is walkable end to end: the bay, the bluff and the cell are slabs 26-30 up (the
 * floor runs under them, and you climb or levitate onto their lips), the gallery hangs from the roof, the pool has
 * a bridge. Every interaction is optional. Same contract as the other dev arenas (docs/FEEL.md "authored arenas"): the generated level is wiped
 * and the hall stamped on entry, bright lighting and a black backdrop, a lamp at every station. Test-mode content:
 * never autosaved, never part of a run.
 */

export const YARD = {
  floor: 640,
  bot: 700,
  ceil: 370,
  x0: 52,
  x1: 1548,
  /** Where the fighter starts (on the dais), and the plain floor level. */
  spawn: { x: 110, y: 640 - 7 },
  /** The ring: foes spawn on its floor, between the two pillars and either side. */
  ring: { x0: 280, x1: 548, cx: 420, y: 640 - 2 },
  /** The gallery ledge (stand on top of it): it hangs from the roof on a pillar at its right end. */
  gallery: { x0: 506, x1: 556, y: 640 - 84 },
  /** The kiln bay: a slab 30 up (its top is the standing level), the barricade on it, the keg behind, then the oil lane and the torch. */
  kiln: { slabX0: 578, slabX1: 712, slabTop: 640 - 30, barricadeX0: 600, barricadeX1: 613, keg: { x: 655, base: 640 - 31 }, oil: { x0: 730, x1: 830 }, torchX: 858 },
  /** The bluff, and the ledge hung from the roof beside it. */
  bluff: { x0: 890, x1: 1010, top: 640 - 96, tunnelTop: 640 - 26, ledge: { x0: 1010, x1: 1042, y: 640 - 130 } },
  /** The cistern: pool and bridge. */
  cistern: { x0: 1090, x1: 1240, depth: 40 },
  /** The cell: a slab 30 up with a lip on its left, the box on it, a wooden door in its left wall. */
  cell: { lip: 1262, x0: 1280, x1: 1420, ix0: 1292, ix1: 1408, slabTop: 640 - 30, top: 640 - 120, itop: 640 - 108, cx: 1350, y: 640 - 32, doorTop: 640 - 64 },
} as const;

const FLOOR = YARD.floor;
const BOT = YARD.bot;
const CEIL = YARD.ceil;
const YARD_AMBIENT = 0.92; // a proving ground must be READABLE

/** Captured once on first entry so leaving restores the player's real ambient. */
let savedAmbient: number | null = null;

/** The cards a fighter needs something to act with: the arena grants them on entry. */
const YARD_CARDS: readonly CardId[] = ['flame', 'dig', 'lightning', 'bomb'];

interface Stamp {
  cell: (x: number, y: number, t: number) => void;
  fill: (x0: number, y0: number, x1: number, y1: number, t: number) => void;
  /** A stone post topped with a glowshroom lamp, standing on `base` (the floor by default). */
  lamp: (x: number, base?: number) => void;
  /** A torch pedestal: lava in an open-top metal cup. */
  torch: (x: number) => void;
  heap: (cx: number, r: number, t: number, base?: number) => void;
}

function stamp(ctx: Ctx): Stamp {
  const w = ctx.world;
  const cell = (x: number, y: number, t: number): void => {
    if (!w.inBounds(x, y)) return;
    const i = w.idx(x, y);
    if (t === Cell.Empty) w.clearCellAt(i);
    else w.replaceCellAt(i, t, COLOR_FN[t] ? COLOR_FN[t]() : packRGB(120, 120, 120));
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, t: number): void => {
    for (let y = Math.max(0, y0); y <= Math.min(HEIGHT - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(WIDTH - 1, x1); x++) cell(x, y, t);
    }
  };
  // a STONE post (lava embers burn wooden ones down) topped with a glowshroom
  const lamp = (x: number, base: number = FLOOR): void => {
    fill(x, base - 12, x + 1, base - 1, Cell.Stone);
    fill(x - 1, base - 14, x + 2, base - 13, Cell.Glowshroom);
  };
  const torch = (x: number): void => {
    fill(x - 5, FLOOR - 4, x + 5, FLOOR - 1, Cell.Stone);
    fill(x - 4, FLOOR - 6, x + 4, FLOOR - 5, Cell.Metal);
    fill(x - 4, FLOOR - 11, x - 3, FLOOR - 6, Cell.Metal);
    fill(x + 3, FLOOR - 11, x + 4, FLOOR - 6, Cell.Metal);
    fill(x - 2, FLOOR - 10, x + 2, FLOOR - 7, Cell.Lava);
  };
  const heap = (cx: number, r: number, t: number, base: number = FLOOR): void => {
    for (let dy = 0; dy < r; dy++) fill(cx - (r - dy), base - 1 - dy, cx + (r - dy), base - 1 - dy, t);
  };
  return { cell, fill, lamp, torch, heap };
}

function mark(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, station: YardStation): void {
  const info = YARD_STATIONS[station];
  ctx.levels.current?.inspectionMarkers?.push({ kind: 'prefab', label: info.name, x0, y0, x1, y1, detail: info.blurb });
}

/** Stamp the whole hall into the (cleared) world. Pure terrain: no player, no foes. */
function stampYard(ctx: Ctx): void {
  const s = stamp(ctx);
  const { cell, fill, lamp, torch, heap } = s;
  const { x0, x1 } = YARD;

  // ---- the shell: a stone floor 60 thick, walls, a flat roof with girders and hanging lamps ----
  fill(40, FLOOR, WIDTH - 40, BOT, Cell.Stone);
  fill(40, CEIL - 16, 52, BOT, Cell.Wall);
  fill(WIDTH - 52, CEIL - 16, WIDTH - 40, BOT, Cell.Wall);
  fill(x0, CEIL - 14, x1, CEIL, Cell.Stone);
  fill(x0, CEIL + 1, x1, CEIL + 3, Cell.Metal); // a girder along the whole roof
  for (let x = 130; x < x1 - 40; x += 150) {
    fill(x, CEIL + 4, x + 1, CEIL + 16, Cell.Metal); // a hanger
    fill(x - 2, CEIL + 17, x + 3, CEIL + 19, Cell.Glowshroom); // the lamp
  }
  // the yard's floor litter: a little coal and ash where the kiln works
  for (let x = 560; x < 880; x += 23) cell(x, FLOOR - 1, (x * 7) % 5 === 0 ? Cell.Coal : Cell.Ash);

  // ---- THE MUSTER (60-250): a low dais, two lamps ----
  fill(70, FLOOR - 6, 170, FLOOR - 1, Cell.Stone);
  fill(66, FLOOR - 3, 69, FLOOR - 1, Cell.Stone); // the steps
  fill(171, FLOOR - 3, 174, FLOOR - 1, Cell.Stone);
  lamp(84, FLOOR - 6);
  lamp(156, FLOOR - 6);
  mark(ctx, 62, FLOOR - 22, 250, BOT, 'muster');

  // ---- THE SPARRING RING (270-560): a sand floor between two rim posts, two cover pillars ----
  fill(YARD.ring.x0, FLOOR - 2, YARD.ring.x1, FLOOR - 1, Cell.Sand);
  fill(270, FLOOR - 14, 276, FLOOR - 1, Cell.Stone);
  fill(554, FLOOR - 14, 560, FLOOR - 1, Cell.Stone);
  fill(360, FLOOR - 26, 367, FLOOR - 1, Cell.Stone); // cover (low: a body-high wall, never a gate)
  fill(468, FLOOR - 26, 475, FLOOR - 1, Cell.Stone);
  lamp(290);
  lamp(534);
  mark(ctx, 268, FLOOR - 40, 562, BOT, 'ring');

  // ---- THE GALLERY: a metal ledge on a stone column over the ring's right end ----
  fill(YARD.gallery.x0, YARD.gallery.y, YARD.gallery.x1, YARD.gallery.y + 2, Cell.Metal);
  fill(YARD.gallery.x1 - 3, CEIL + 1, YARD.gallery.x1, YARD.gallery.y - 1, Cell.Stone); // it hangs from the roof: the floor beneath stays open
  fill(YARD.gallery.x0, YARD.gallery.y - 4, YARD.gallery.x0 + 1, YARD.gallery.y - 1, Cell.Metal); // a rail post
  mark(ctx, YARD.gallery.x0 - 2, YARD.gallery.y - 6, YARD.gallery.x1 + 2, YARD.gallery.y + 4, 'gallery');

  // ---- THE KILN WALL (580-860): barricade over a keg in a stone closet, an oil lane, a torch behind a baffle ----
  const k = YARD.kiln;
  fill(k.slabX0, k.slabTop, k.slabX1, k.slabTop + 3, Cell.Stone); // the bay's slab: the floor runs under it
  fill(k.barricadeX0, k.slabTop - 70, k.barricadeX1, k.slabTop - 1, Cell.Wood); // the barricade
  fill(k.barricadeX0, k.slabTop - 78, k.slabX1, k.slabTop - 71, Cell.Stone); // the bay's roof
  fill(700, k.slabTop - 77, k.slabX1, k.slabTop - 1, Cell.Stone); // and back wall
  heap(k.keg.x, 11, Cell.Gunpowder, k.slabTop); // the keg: a PACKED cone, so it detonates rather than deflagrates
  cell(655, k.slabTop - 72, Cell.Glowshroom);
  fill(YARD.kiln.oil.x0, FLOOR - 3, YARD.kiln.oil.x1, FLOOR - 1, Cell.Metal); // the oil lane: a shallow metal trough
  fill(YARD.kiln.oil.x0, FLOOR - 9, YARD.kiln.oil.x0 + 1, FLOOR - 4, Cell.Metal);
  fill(YARD.kiln.oil.x1 - 1, FLOOR - 9, YARD.kiln.oil.x1, FLOOR - 4, Cell.Metal);
  fill(YARD.kiln.oil.x0 + 2, FLOOR - 8, YARD.kiln.oil.x1 - 2, FLOOR - 4, Cell.Oil);
  fill(842, FLOOR - 16, 845, FLOOR - 1, Cell.Stone); // a baffle between the oil and the torch
  torch(k.torchX);
  lamp(584, k.slabTop);
  lamp(566);
  lamp(722);
  mark(ctx, 576, k.slabTop - 80, 872, BOT, 'kiln');

  // ---- THE BLUFF (880-1050): a block with a tunnel through it, a ledge-tower beside it ----
  const b = YARD.bluff;
  fill(b.x0, b.top, b.x1, b.tunnelTop, Cell.Stone); // the block above the tunnel
  fill(b.ledge.x0, b.ledge.y, b.ledge.x1, b.ledge.y + 2, Cell.Metal); // a ledge 34 above the bluff's top...
  fill(b.ledge.x1 - 4, CEIL + 1, b.ledge.x1, b.ledge.y - 1, Cell.Stone); // ...hung from the roof, so the floor beneath stays open
  lamp(950, b.top);
  lamp(880);
  lamp(1022);
  mark(ctx, b.x0 - 4, b.ledge.y - 8, b.ledge.x1 + 4, BOT, 'bluff');

  // ---- THE CISTERN (1080-1250): a pool 40 deep, a grating bridge, mossy banks ----
  const c = YARD.cistern;
  fill(c.x0 - 4, FLOOR, c.x0 - 1, FLOOR + c.depth + 4, Cell.Stone);
  fill(c.x1 + 1, FLOOR, c.x1 + 4, FLOOR + c.depth + 4, Cell.Stone);
  fill(c.x0, FLOOR, c.x1, FLOOR + c.depth, Cell.Empty);
  fill(c.x0, FLOOR + 3, c.x1, FLOOR + c.depth, Cell.Water);
  fill(c.x0, FLOOR, c.x1, FLOOR + 1, Cell.Metal); // the bridge, flush with the floor
  fill(1066, FLOOR - 3, 1089, FLOOR - 1, Cell.Moss); // mossy banks: natural cover for the camouflage
  fill(1241, FLOOR - 3, 1262, FLOOR - 1, Cell.Moss);
  lamp(1074);
  lamp(1250);
  mark(ctx, 1062, FLOOR - 16, 1266, FLOOR + c.depth + 4, 'cistern');

  // ---- THE LOCKED CELL (1280-1420): sealed stone, a wooden door on the left ----
  const e = YARD.cell;
  fill(e.lip, e.slabTop, e.x1, e.slabTop + 3, Cell.Stone); // the slab, with a lip in front of the door
  fill(e.x0, e.top, e.x1, e.slabTop - 1, Cell.Stone);
  fill(e.ix0, e.itop, e.ix1, e.slabTop - 1, Cell.Empty); // the interior
  fill(e.x0, e.doorTop, e.ix0 - 1, e.slabTop - 1, Cell.Wood); // the door
  fill(e.cx - 1, e.itop - 1, e.cx + 1, e.itop - 1, Cell.Glowshroom);
  lamp(1266, e.slabTop);
  mark(ctx, e.lip - 2, e.top - 4, e.x1 + 2, BOT, 'cell');

  // ---- the far nook (1430-1540): a stone bench, two lamps ----
  fill(1470, FLOOR - 5, 1512, FLOOR - 4, Cell.Stone);
  fill(1470, FLOOR - 3, 1472, FLOOR - 1, Cell.Stone);
  fill(1510, FLOOR - 3, 1512, FLOOR - 1, Cell.Stone);
  lamp(1446);
  lamp(1528);
}

/** Put two potions on the Muster floor, past the dais (Edda's Stored Light listens for a consumable used). */
function stagePotions(ctx: Ctx): void {
  const runtime = ctx.levels.current;
  if (!runtime) return;
  runtime.pickups.length = 0;
  runtime.pickups.push(makePickup('potion', 206, FLOOR - 3, { potion: 'vigor' }), makePickup('potion', 224, FLOOR - 3, { potion: 'swift' }));
}

function wipeTransients(ctx: Ctx): void {
  ctx.rigidBodies.clear();
  ctx.vineStrands.clear();
  ctx.critters.clear();
  ctx.enemies.length = 0;
  ctx.projectiles.length = 0;
}

/** Clear the hall and stamp it fresh, keeping the player and the fighter as they are: the panel's "Reset arena". */
export function resetFighterArena(ctx: Ctx): void {
  ctx.world.clear();
  wipeTransients(ctx);
  const runtime = ctx.levels.current;
  if (runtime) {
    runtime.inspectionMarkers = [];
    runtime.mechanisms.length = 0;
    runtime.emitters = [];
  }
  stampYard(ctx);
  stagePotions(ctx);
}

/** Entering the yard: wipe the generated level, light it, stamp the hall, grant the verbs, stand the fighter on the dais. */
export function buildFighterArena(ctx: Ctx): void {
  ctx.world.clear();
  if (savedAmbient === null) savedAmbient = ctx.params.global.ambient;
  ctx.params.global.ambient = YARD_AMBIENT;
  const runtime = ctx.levels.current;
  if (runtime) {
    // a black backdrop: the generated biome parallax bleeding through behind the stations is unreadable
    const black = createDefaultBackdropSettings();
    for (const spec of BACKDROP_LAYER_SPECS) {
      black.layers[spec.id].visible = false;
      black.layers[spec.id].opacity = 0;
    }
    runtime.backdrop = black;
    runtime.backdropLevelId = null;
    runtime.waystones.length = 0;
    runtime.mechanismTriggers = undefined;
  }
  const restore = ctx.events.on('levelChanged', () => {
    if (savedAmbient !== null) ctx.params.global.ambient = savedAmbient;
    savedAmbient = null;
    restore();
  });
  resetFighterArena(ctx);

  // the verbs: a fighter needs something to act with, and a flask to sip
  for (const card of YARD_CARDS) {
    const known = ctx.wands.collection.includes(card) || ctx.wands.wands.some((wand) => wand.cards.includes(card));
    if (!known) ctx.wands.grantCard(ctx, card);
  }
  ctx.flask.setSlot(0, Cell.Water, 300);
  ctx.flask.setSlot(1, Cell.Oil, 300);

  standFighterOnDais(ctx);
  ctx.events.emit('toast', { text: 'THE PROVING YARD: every move has somewhere to land. [ and ] change fighter.' });
}

/** Back to the start: the dais, standing, whole. */
export function standFighterOnDais(ctx: Ctx): void {
  const p = ctx.player;
  p.x = YARD.spawn.x;
  p.y = YARD.spawn.y;
  p.vx = 0;
  p.vy = 0;
  p.fx = 0;
  p.fy = 0;
  p.dead = false;
  const runtime = ctx.levels.current;
  if (runtime) runtime.spawn = { x: YARD.spawn.x, y: YARD.spawn.y }; // respawn INTO the yard, not the old void spawn
  ctx.camera.snapTo(p.x, p.y - 70);
}

/** Where "take me there" stands you: on the floor (or the ledge) at each station. */
export const YARD_SPOTS: Readonly<Record<YardStation, { x: number; y: number }>> = {
  muster: { x: YARD.spawn.x, y: YARD.spawn.y },
  ring: { x: YARD.ring.cx, y: YARD.ring.y },
  gallery: { x: YARD.gallery.x0 + 12, y: YARD.gallery.y - 1 },
  kiln: { x: 590, y: YARD.kiln.slabTop - 2 },
  bluff: { x: 868, y: FLOOR - 2 },
  cistern: { x: 1076, y: FLOOR - 4 },
  cell: { x: 1272, y: YARD.cell.slabTop - 2 },
};

/** Stand the fighter at a station, still and facing the yard. */
export function standFighterAt(ctx: Ctx, station: YardStation): void {
  const spot = YARD_SPOTS[station];
  const p = ctx.player;
  p.x = spot.x;
  p.y = spot.y;
  p.vx = 0;
  p.vy = 0;
  p.fx = 0;
  p.fy = 0;
  ctx.camera.snapTo(p.x, p.y - 70);
}

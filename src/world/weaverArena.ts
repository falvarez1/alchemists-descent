import { BACKDROP_LAYER_SPECS, createDefaultBackdropSettings } from '@/config/backdrop';
import { HEIGHT, WIDTH } from '@/config/constants';
import type { CardId, CritterKind, Ctx, Enemy } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';

/**
 * WEAVER TEST LAIR (worldgraph id 'weaver-test'): an authored enemy playground
 * for the spider-like Weaver. It exists to exercise the creature's contracts:
 * IK foot planting over uneven growth, sleeping/dwelling, prey feeding, thread
 * writing, and close/mid-range attacks. It is test-mode content, not campaign
 * progression.
 */

const LEFT = 58;
const RIGHT = 1488;
const TOP = 176;
const FLOOR = 742;
const BOT = 762;
const WEAVER_AMBIENT = 0.86;

let savedAmbient: number | null = null;

export function buildWeaverArena(ctx: Ctx): void {
  const w = ctx.world;

  const cell = (x: number, y: number, t: number): void => {
    if (!w.inBounds(x, y)) return;
    const i = w.idx(x, y);
    if (t === Cell.Empty) w.clearCellAt(i);
    else w.replaceCellAt(i, t, COLOR_FN[t] ? COLOR_FN[t]() : packRGB(120, 120, 120));
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, t: number): void => {
    const ax = Math.max(0, Math.min(x0, x1));
    const bx = Math.min(WIDTH - 1, Math.max(x0, x1));
    const ay = Math.max(0, Math.min(y0, y1));
    const by = Math.min(HEIGHT - 1, Math.max(y0, y1));
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) cell(x, y, t);
  };
  const shelf = (x0: number, x1: number, y: number, growth: number): void => {
    fill(x0, y, x1, BOT, Cell.Stone);
    for (let x = x0; x <= x1; x++) cell(x, y - 1, growth);
  };
  w.clear();
  ctx.rigidBodies.clear();
  ctx.vineStrands.clear();
  ctx.critters.clear();
  ctx.enemies.length = 0;

  if (savedAmbient === null) savedAmbient = ctx.params.global.ambient;
  ctx.params.global.ambient = WEAVER_AMBIENT;
  const runtime = ctx.levels.current;
  if (runtime) {
    const black = createDefaultBackdropSettings();
    for (const spec of BACKDROP_LAYER_SPECS) {
      black.layers[spec.id].visible = false;
      black.layers[spec.id].opacity = 0;
    }
    runtime.backdrop = black;
    runtime.backdropLevelId = null;
    runtime.pickups.length = 0;
    runtime.mechanisms.length = 0;
    runtime.waystones.length = 0;
    runtime.emitters = [];
    runtime.mechanismTriggers = undefined;
  }
  const restore = ctx.events.on('levelChanged', () => {
    if (savedAmbient !== null) ctx.params.global.ambient = savedAmbient;
    savedAmbient = null;
    restore();
  });

  fill(LEFT, FLOOR, RIGHT, BOT, Cell.Stone);
  for (let y = TOP; y <= BOT; y++) {
    for (let d = 0; d < 6; d++) {
      cell(LEFT + d, y, Cell.Stone);
      cell(RIGHT - d, y, Cell.Stone);
    }
  }

  // Dwelling/sleep alcove: ceiling anchors, hanging vines, and a low cocoon mound.
  shelf(210, 450, FLOOR - 5, Cell.Moss);
  fill(230, 586, 455, 590, Cell.Stone);
  for (let x = 252; x <= 430; x += 22) {
    ctx.vineStrands.addHanging(x, 591, 82 + ((x / 22) % 3) * 10, {
      thickness: x % 44 === 0 ? 3 : 2,
      color: packRGB(62, 138, 55),
    });
  }
  ctx.vineStrands.addWebLattice(350, FLOOR - 78, 88, {
    radials: 12,
    rings: 6,
    thickness: 1,
    color: packRGB(70, 172, 68),
    jitter: 0.08,
  });
  fill(310, FLOOR - 12, 386, FLOOR - 8, Cell.Fungus);
  fill(322, FLOOR - 16, 374, FLOOR - 13, Cell.Vines);
  for (let x = 260; x <= 430; x += 34) cell(x, FLOOR - 2, Cell.Glowshroom);
  // Kickable wake props: hit or shove these into the alcove to wake the sleeper
  // through real rigid-body impact noise instead of proximity.
  ctx.rigidBodies.spawn({ kind: 'box', halfW: 4, halfH: 4 }, 170, FLOOR - 10, {
    material: 'wood',
    friction: 0.65,
    restitution: 0.12,
  });
  ctx.rigidBodies.spawn({ kind: 'circle', radius: 5 }, 194, FLOOR - 10, {
    material: 'stone',
    friction: 0.8,
    restitution: 0.08,
  });

  // Gait lane: adjacent surfaces vary by <=4 cells so the body can traverse it
  // while the long legs visibly replant and search for growth.
  const gait: Array<[number, number, number, number]> = [
    [470, 536, FLOOR, Cell.Moss],
    [537, 600, FLOOR - 3, Cell.Vines],
    [601, 664, FLOOR - 7, Cell.Fungus],
    [665, 730, FLOOR - 4, Cell.Moss],
    [731, 794, FLOOR - 8, Cell.Vines],
    [795, 860, FLOOR - 5, Cell.Fungus],
    [861, 920, FLOOR - 1, Cell.Moss],
  ];
  for (const [x0, x1, y, growth] of gait) shelf(x0, x1, y, growth);
  fill(560, FLOOR, 586, BOT - 1, Cell.Empty);
  fill(560, FLOOR + 11, 586, BOT, Cell.Stone);
  fill(760, FLOOR - 5, 786, BOT - 1, Cell.Empty);
  fill(760, FLOOR + 8, 786, BOT, Cell.Stone);

  // Feeding pen: glowshroom light attracts prey; the feeder Weaver is hurt so a
  // successful gulp is measurable in runtime probes.
  shelf(946, 1115, FLOOR - 2, Cell.Fungus);
  for (let x = 966; x <= 1094; x += 16) {
    cell(x, FLOOR - 3, x % 32 === 0 ? Cell.Glowshroom : Cell.Moss);
    if (x % 48 === 0) cell(x, FLOOR - 4, Cell.Blood);
  }
  fill(935, FLOOR - 10, 940, FLOOR - 1, Cell.Stone);
  fill(1122, FLOOR - 10, 1127, FLOOR - 1, Cell.Stone);

  // Attack lane and counterplay bench: open space for thread spit / needle step,
  // with material patches the player can ignite, douse, or electrify.
  shelf(1160, 1390, FLOOR, Cell.Moss);
  fill(1210, FLOOR - 1, 1242, FLOOR - 1, Cell.Oil);
  fill(1278, FLOOR - 5, 1320, FLOOR - 1, Cell.Water);
  fill(1360, FLOOR - 2, 1384, FLOOR - 1, Cell.Ice);
  for (let x = 1188; x <= 1370; x += 36) cell(x, FLOOR - 2, Cell.Glowshroom);

  // Support-loss strip: bare stone with web anchors just outside the pad. Lure
  // the Weaver here after burning/cutting growth and it must recover footing
  // instead of keeping its normal confident attack cadence.
  fill(1408, FLOOR, 1468, BOT, Cell.Stone);
  fill(1408, FLOOR - 1, 1468, FLOOR - 1, Cell.Empty);
  fill(1396, FLOOR - 3, 1406, FLOOR - 1, Cell.Vines);
  fill(1470, FLOOR - 3, 1480, FLOOR - 1, Cell.Vines);

  const spawnWeaver = (x: number, y: number): Enemy | null => {
    const before = ctx.enemies.length;
    ctx.enemyCtl.spawn('weaver', x, y);
    const e = ctx.enemies[before];
    if (!e || e.kind !== 'weaver') return null;
    e.x = x;
    e.y = y;
    e.fx = e.fy = e.vx = e.vy = 0;
    e.grounded = true;
    e.weaverSupport = 1;
    return e;
  };

  const sleeper = spawnWeaver(350, FLOOR - 6);
  if (sleeper) {
    sleeper.sleeping = true;
    sleeper.alerted = false;
    sleeper.attackCd = 120;
  }
  const gaiter = spawnWeaver(512, FLOOR);
  if (gaiter) {
    gaiter.alerted = false;
    gaiter.attackCd = 220;
    gaiter.patrol = [
      [512, FLOOR],
      [900, FLOOR - 1],
    ];
    gaiter.patrolIdx = 1;
  }
  const feeder = spawnWeaver(1028, FLOOR - 3);
  if (feeder) {
    feeder.alerted = false;
    feeder.attackCd = 140;
    feeder.hp = Math.max(1, feeder.maxHp - 42);
  }
  const sentinel = spawnWeaver(1260, FLOOR - 1);
  if (sentinel) {
    sentinel.alerted = true;
    sentinel.attackCd = 35;
  }

  const prey: Array<[CritterKind, number, number]> = [
    ['moth', 982, FLOOR - 34],
    ['moth', 1012, FLOOR - 28],
    ['firefly', 1040, FLOOR - 42],
    ['firefly', 1080, FLOOR - 30],
    ['beetle', 990, FLOOR - 4],
    ['beetle', 1064, FLOOR - 4],
    ['fly', 1030, FLOOR - 18],
  ];
  for (const [kind, x, y] of prey) ctx.critters.spawn(kind, x, y);

  const player = ctx.player;
  player.x = 130;
  player.y = FLOOR - 1;
  player.vx = player.vy = player.fx = player.fy = 0;
  player.dead = false;
  player.crawling = false;
  player.climbing = false;
  player.swinging = false;
  player.diveT = 0;
  player.hp = player.maxHp;
  ctx.camera.snapTo(360, FLOOR - 125);

  const reviewCards: CardId[] = ['flame', 'frostshard', 'lightning'];
  for (const card of reviewCards) {
    const alreadyKnown =
      ctx.wands.collection.includes(card) ||
      ctx.wands.wands.some((wand) => wand.cards.includes(card));
    if (!alreadyKnown) ctx.wands.grantCard(ctx, card);
  }
}

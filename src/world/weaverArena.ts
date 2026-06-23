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
    runtime.inspectionMarkers = [];
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

  // ── VERTICAL CLIMBING RUIN: a layered field of mossy rock islands, tall spires,
  // wooden ladders and rope bridges with foliage draping off every underside — a
  // real Metroidvania-style climbing playground filling the airspace, not a stair
  // in a corner. Every exposed face is a foothold for the Weaver's IK legs, and
  // the whole thing sits ABOVE the floor-level test zones so the probes still run.
  {
    const MOSS_GREENS = [packRGB(56, 132, 50), packRGB(74, 156, 60), packRGB(48, 112, 44)];
    // The combat lane is probe-guarded to hold only LIVE web strands, so static
    // Vines cells are forbidden in this rectangle (decor uses Fungus/Verlet there).
    const inGuard = (x: number, y: number): boolean => x >= 470 && x <= 1390 && y >= 620 && y <= 730;
    const vineCell = (x: number, y: number): void => { if (!inGuard(x, y)) cell(x, y, Cell.Vines); };

    // Lush vegetation crowning a ledge: grass tufts, fern fronds, glow buds — the
    // difference between "a mossy shelf" and "an overgrown garden".
    const foliage = (x0: number, x1: number, topY: number): void => {
      for (let x = x0; x <= x1; x++) {
        const r = (x * 13 + topY * 7) % 100;
        if (r < 26) {
          for (let d = 1; d <= 1 + (r % 4); d++) cell(x, topY - 1 - d, Cell.Moss); // grass
        } else if (r < 35) {
          cell(x, topY - 2, Cell.Fungus); cell(x, topY - 3, Cell.Fungus);
          cell(x - 1, topY - 2, Cell.Fungus); cell(x + 1, topY - 3, Cell.Fungus); // fern frond
        } else if (r < 40) {
          cell(x, topY - 2, Cell.Glowshroom); // glow bud
        }
      }
    };
    // A little mushroom: soft-growth stem under a round mossy/ferny canopy.
    // It is authored dressing, not cover; using Fungus keeps it non-collidable.
    const tree = (x: number, baseY: number, trunk: number): void => {
      for (let d = 0; d < trunk; d++) cell(x, baseY - d, Cell.Fungus);
      const cy = baseY - trunk;
      for (let dy = -4; dy <= 1; dy++) for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy * 2.5 <= 14) cell(x + dx, cy + dy, (x + dx + dy) % 3 === 0 ? Cell.Fungus : Cell.Moss);
      }
      cell(x, cy - 3, Cell.Glowshroom);
      runtime?.inspectionMarkers?.push({
        kind: 'prefab',
        label: 'Mushroom',
        x0: x - 5,
        y0: cy - 5,
        x1: x + 5,
        y1: baseY + 1,
        detail: 'Weaver test map dressing',
      });
    };
    // A rounded mossy boulder resting on a ledge.
    const boulder = (x: number, baseY: number, r: number): void => {
      for (let dy = 0; dy <= r * 2; dy++) {
        const rr = r - Math.abs(dy - r) * 0.34;
        for (let dx = -r; dx <= r; dx++) if (dx * dx <= rr * rr) cell(x + dx, baseY - dy, Cell.Stone);
      }
      for (let dx = -r + 1; dx <= r - 1; dx += 2) cell(x + dx, baseY - r * 2, Cell.Moss);
    };
    // A warm glowing den/window recessed into a rock face — the lair's lights.
    const glowDen = (cx: number, cy: number): void => {
      for (let dy = -5; dy <= 5; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= 20) cell(cx + dx, cy + dy, Cell.Empty); // carve the alcove
        if (d2 <= 9) cell(cx + dx, cy + dy, Cell.Glowshroom); // fill it with light
      }
    };
    // A small still pool sunk into a wide ledge (reflective, lit from the moss).
    const pool = (x0: number, x1: number, topY: number): void => {
      fill(x0 - 1, topY, x1 + 1, topY + 5, Cell.Stone); // basin
      fill(x0, topY, x1, topY + 4, Cell.Empty);
      fill(x0, topY + 2, x1, topY + 4, Cell.Water);
      cell(x0 - 1, topY - 1, Cell.Moss); cell(x1 + 1, topY - 1, Cell.Moss);
    };
    // A static curtain of hanging roots under a ledge. FUNGUS (not Vines): the
    // vine-lift scan only lifts Cell.Vines into Verlet strands (which would fill
    // the 48-strand cap and starve the spider's web shots), and only Vines cells
    // trip the combat-lane probe — so fungus draping is free of both hazards.
    const vineCurtain = (x0: number, x1: number, y: number, maxLen: number): void => {
      for (let x = x0 + 1; x <= x1 - 1; x += 3 + (x % 4)) {
        const len = 5 + ((x * 7 + y) % maxLen);
        for (let d = 0; d < len; d++) cell(x, y + d, d >= len - 2 ? Cell.Moss : Cell.Fungus);
      }
    };
    // Live Verlet drapes are capped (MAX_ACTIVE_STRANDS=48) and shared with the
    // spider's web shots, so they're added sparingly from a curated list below.
    const drape = (x: number, anchorY: number, len: number): void => {
      ctx.vineStrands.addHanging(x, anchorY, len, { thickness: x % 3 === 0 ? 3 : 2, color: MOSS_GREENS[(x >> 3) % 3] });
    };
    // A floating rock island: an organic, bulging slab, grassy overgrown crown,
    // root curtain draping off the underside.
    const island = (x0: number, x1: number, y: number, h = 6): void => {
      for (let x = x0 - 3; x <= x1 + 3; x++) {
        const t = (x - (x0 - 3)) / Math.max(1, x1 + 3 - (x0 - 3));
        const bulge = Math.round(Math.sin(t * Math.PI) * 3); // deepest belly in the middle
        const drip = (x * 7 + y) % 5 === 0 ? 1 + ((x * 3) % 3) : 0;
        fill(x, y, x, y + h + bulge + drip, Cell.Stone);
        cell(x, y - 1, Cell.Moss);
      }
      foliage(x0 - 2, x1 + 2, y); // overgrown top
      vineCurtain(x0, x1, y + h + 1, h < 7 ? 24 : 40); // draping roots
    };
    // A vertical wooden ladder the player climbs and the legs grip rung by rung.
    const ladder = (x: number, top: number, bottom: number): void => {
      for (let y = top; y <= bottom; y++) {
        cell(x, y, Cell.Wood);
        cell(x + 1, y, Cell.Wood);
        if (y % 4 === 0) {
          cell(x - 1, y, Cell.Wood);
          cell(x + 2, y, Cell.Wood);
        }
      }
    };
    // A rope/plank bridge that sags across a gap between two islands.
    const bridge = (x0: number, x1: number, y: number): void => {
      const span = Math.max(1, x1 - x0);
      for (let x = x0; x <= x1; x++) {
        const sag = Math.round(Math.sin(((x - x0) / span) * Math.PI) * 4);
        cell(x, y + sag, Cell.Wood);
        cell(x, y + sag + 1, Cell.Wood);
        if ((x - x0) % 9 === 0) vineCell(x, y + sag - 1); // rope posts
      }
    };
    // A tall rock spire rooted to the floor: overgrown cap, glowing den-windows
    // recessed down the shaft, fern tufts and a long streamer of foliage.
    const spire = (cx: number, top: number, half = 8): void => {
      fill(cx - half, top, cx + half, BOT - 1, Cell.Stone);
      fill(cx - half - 4, top, cx + half + 4, top + 2, Cell.Stone); // overhanging cap
      for (let x = cx - half - 4; x <= cx + half + 4; x++) cell(x, top - 1, Cell.Moss);
      foliage(cx - half - 4, cx + half + 4, top); // lush crown
      drape(cx - half - 3, top + 4, 96);
      for (let y = top + 46; y < BOT - 34; y += 96) glowDen(cx, y); // warm windows
      for (let y = top + 16; y < BOT - 8; y += 20) {
        cell(cx - half, y, Cell.Moss);
        cell(cx + half, y, Cell.Fungus);
      }
    };

    // Two grand spires rooted in the dead floor-gaps between the test zones.
    spire(933, 232, 9); // central tower, nearly to the ceiling
    spire(1145, 372, 7); // right tower, mid height

    // Floating islands, low → high. [x0, x1, y]. All y ≤ 640 so they clear the
    // floor-level probe carves (cut-floor, support-loss, thread/needle) below.
    const isles: ReadonlyArray<readonly [number, number, number]> = [
      [104, 226, 632], [470, 612, 612], [690, 858, 592], [992, 1118, 626], [1240, 1366, 636],
      [296, 430, 500], [560, 704, 470], [840, 980, 486], [1118, 1262, 480], [1372, 1474, 514],
      [212, 338, 372], [520, 656, 350], [822, 958, 338], [1148, 1290, 360], [1392, 1480, 392],
      [420, 532, 244], [882, 1004, 228], [1240, 1352, 250],
    ];
    for (const [x0, x1, y] of isles) island(x0, x1, y, y > 560 ? 9 : y > 420 ? 6 : 5);

    // Curated overgrowth dressing the ledges — little trees, mossy boulders, and a
    // couple of still pools — so the ruin reads as reclaimed-by-the-jungle, not bare.
    tree(150, 631, 6); tree(205, 631, 4); tree(740, 591, 7); tree(1050, 625, 5);
    tree(340, 499, 6); tree(640, 469, 5); tree(1190, 479, 6); tree(900, 337, 5);
    tree(560, 349, 4); tree(1280, 359, 5);
    boulder(540, 611, 5); boulder(1310, 635, 4); boulder(910, 485, 4); boulder(1430, 513, 3); boulder(470, 371, 3);
    pool(115, 182, 632); pool(548, 624, 350);

    // A curated handful of long Verlet drapes off select undersides — the
    // jungle-ruin foliage, kept well under the 48-strand cap (spires take 2,
    // the alcove ~9, leaving headroom for the spider's live web shots).
    const drapes: ReadonlyArray<readonly [number, number, number]> = [
      [520, 616, 64], [760, 596, 78], [1040, 630, 70], [1300, 640, 58],
      [360, 504, 60], [620, 474, 86], [900, 490, 72], [1190, 484, 80],
      [560, 354, 64], [880, 342, 70], [1210, 364, 60],
    ];
    for (const [x, y, len] of drapes) drape(x, y, len);

    // Ladders stitch the tiers into a real climb (vertically-aligned islands).
    ladder(540, 470, 610); // gait-left stack
    ladder(600, 350, 470);
    ladder(900, 338, 486); // under the central spire shelf
    ladder(1200, 480, 626); // feeding/attack stack
    ladder(1210, 360, 480);
    ladder(360, 372, 500); // sleeper-side stack
    ladder(470, 244, 372);
    ladder(1420, 392, 514); // right stack

    // Rope bridges span the wide gaps at a couple of tiers.
    bridge(612, 690, 600); // low tier, left gulf
    bridge(858, 992, 600);
    bridge(656, 822, 344); // upper tier
    bridge(1290, 1392, 376);

    // A couple of very large wooden crates: one on the floor by the spire base to
    // clamber up onto, one parked on a low island.
    ctx.rigidBodies.spawn({ kind: 'box', halfW: 11, halfH: 11 }, 905, FLOOR - 13, { material: 'wood', friction: 0.74, restitution: 0.04 });
    ctx.rigidBodies.spawn({ kind: 'box', halfW: 9, halfH: 9 }, 1050, 614, { material: 'wood', friction: 0.74, restitution: 0.04 });

    // A ragged rock CEILING framing the cavern, with stalactites fanging down and
    // a few stalagmites pushing up from the floor — the cave-ruin depth from the
    // reference. All far above the floor-level test zones.
    for (let x = LEFT; x <= RIGHT; x++) {
      const lip = 4 + (((x * 11) >> 2) % 7); // an uneven rock lip
      fill(x, TOP, x, TOP + lip, Cell.Stone);
    }
    const stalactite = (x: number, len: number, w: number, from: number): void => {
      for (let d = 0; d < len; d++) {
        const ww = Math.max(0, Math.round(w * (1 - d / len)));
        for (let dx = -ww; dx <= ww; dx++) cell(x + dx, from + d, Cell.Stone);
      }
      cell(x, from + len, Cell.Glowshroom); // a glow bead on the tip
    };
    for (let x = 130; x < RIGHT - 80; x += 64 + ((x * 13) % 46)) {
      stalactite(x, 22 + ((x * 7) % 30), 2 + ((x >> 6) % 3), TOP + 8);
    }
    // stalagmites rising off a few wide low islands and the floor gaps
    const stalagmite = (x: number, base: number, len: number, w: number): void => {
      for (let d = 0; d < len; d++) {
        const ww = Math.max(0, Math.round(w * (1 - d / len)));
        for (let dx = -ww; dx <= ww; dx++) cell(x + dx, base - d, Cell.Stone);
      }
      cell(x, base - len, Cell.Moss);
    };
    stalagmite(160, 631, 16, 3);
    stalagmite(1300, 635, 14, 3);
    stalagmite(720, 591, 12, 2);
  }

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

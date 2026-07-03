import { BACKDROP_LAYER_SPECS, createDefaultBackdropSettings } from '@/config/backdrop';
import { HEIGHT, WIDTH } from '@/config/constants';
import type { CardId, Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';

/**
 * PHYSICS PROVING GROUNDS (console: `level alchemy-test` / `level gas-test`
 * / `level frost-test`): authored playgrounds for the Noita-physics wave —
 * the alchemy table + the run's secret reaction, marsh-gas pockets +
 * gunpowder seams, and flask-grenade / freeze-terraforming practice.
 * Test-mode content, not campaign progression (same contract as the
 * weaver/physics arenas: they wipe and stamp the world on entry).
 *
 * Construction rules (learned the hard way — three drafts of slab-shaped
 * garbage before this): every station is a PLAYER-SCALE sculpture standing
 * in negative space, the main floor is walkable end to end (interactions
 * are optional, never a mining chore blocking the path), every interaction
 * point gets a glowshroom lamp — light is information — and each ground is
 * a themed PLACE (mine / laboratory hall / glacial grotto), not a corridor
 * of test tubes.
 */

const FLOOR = 640;
const BOT = 664;
const TOP = FLOOR - 250; // side walls reach this high
const GROUNDS_AMBIENT = 0.92; // match the physics arena — a proving ground must be READABLE

/** Captured once on first entry so leaving restores the player's real ambient. */
let savedAmbient: number | null = null;

interface Stamp {
  cell: (x: number, y: number, t: number) => void;
  fill: (x0: number, y0: number, x1: number, y1: number, t: number) => void;
  tub: (x0: number, t: number) => void;
  heap: (cx: number, r: number, t: number) => void;
  lamp: (x: number) => void;
  torch: (x: number) => void;
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
  // a RAISED metal trough, 34 wide, walls visible above the floor so it reads
  // as a container from the side (sunken basins read as floor discoloration).
  // Metal because it is the one material acid cannot eat. Interior holds
  // 30x12 = 360 cells of liquid with a 2-cell freeboard under the lip.
  const tub = (x0: number, t: number): void => {
    fill(x0, FLOOR - 3, x0 + 33, FLOOR - 1, Cell.Metal); // bottom
    fill(x0, FLOOR - 17, x0 + 1, FLOOR - 4, Cell.Metal); // left wall
    fill(x0 + 32, FLOOR - 17, x0 + 33, FLOOR - 4, Cell.Metal); // right wall
    fill(x0 + 2, FLOOR - 15, x0 + 31, FLOOR - 4, t);
  };
  // a conical powder pile — a HEAP should look like one, not a rectangle
  const heap = (cx: number, r: number, t: number): void => {
    for (let dy = 0; dy < r; dy++) fill(cx - (r - dy), FLOOR - 1 - dy, cx + (r - dy), FLOOR - 1 - dy, t);
  };
  // a glowshroom lamp post marking an interaction point — STONE post, not
  // wood: the lava trough sputters embers and torched half the lighting
  const lamp = (x: number): void => {
    fill(x, FLOOR - 12, x + 1, FLOOR - 1, Cell.Stone);
    fill(x - 1, FLOOR - 14, x + 2, FLOOR - 13, Cell.Glowshroom);
  };
  // a torch pedestal: lava in an open-top metal cup (painted Fire cells have
  // life 0 and die instantly — permanent flame means contained lava)
  const torch = (x: number): void => {
    fill(x - 5, FLOOR - 4, x + 5, FLOOR - 1, Cell.Stone); // pedestal
    fill(x - 4, FLOOR - 6, x + 4, FLOOR - 5, Cell.Metal); // cup bottom
    fill(x - 4, FLOOR - 11, x - 3, FLOOR - 6, Cell.Metal); // cup walls
    fill(x + 3, FLOOR - 11, x + 4, FLOOR - 6, Cell.Metal);
    fill(x - 2, FLOOR - 10, x + 2, FLOOR - 7, Cell.Lava);
  };

  w.clear();
  if (savedAmbient === null) savedAmbient = ctx.params.global.ambient;
  ctx.params.global.ambient = GROUNDS_AMBIENT;
  const runtime = ctx.levels.current;
  if (runtime) {
    runtime.inspectionMarkers = [];
    // black backdrop, like the physics arena — the generated biome parallax
    // bleeding through behind the stations was half the unreadability
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
  ctx.rigidBodies.clear();
  ctx.vineStrands.clear();
  ctx.critters.clear();
  ctx.enemies.length = 0;

  // shell: flat main floor and thick side walls — each arena adds its own
  // themed ceiling, so structures read as silhouettes, not wallpaper
  fill(40, FLOOR, WIDTH - 40, BOT, Cell.Stone);
  fill(40, TOP, 52, BOT, Cell.Wall);
  fill(WIDTH - 52, TOP, WIDTH - 40, BOT, Cell.Wall);
  return { cell, fill, tub, heap, lamp, torch };
}

/** A ragged natural rock ceiling with hanging stalactites — the weaver-arena
 *  cavern framing. `icy` swaps the stalactites for ice with snowy roots. */
function cavernCeiling(s: Stamp, ceilY: number, icy: boolean): void {
  const { cell, fill } = s;
  for (let x = 52; x <= WIDTH - 52; x++) {
    const lip = 6 + (((x * 11) >> 2) % 9); // an uneven rock lip
    fill(x, ceilY - 14, x, ceilY + lip, Cell.Stone);
    if (icy && (x * 7) % 3 !== 0) cell(x, ceilY + lip + 1, Cell.Ice); // frost rime
  }
  for (let x = 130; x < WIDTH - 110; x += 58 + ((x * 13) % 44)) {
    const len = 14 + ((x * 7) % 20);
    const wid = 2 + ((x >> 6) % 3);
    const from = ceilY + 12;
    for (let d = 0; d < len; d++) {
      const ww = Math.max(0, Math.round(wid * (1 - d / len)));
      for (let dx = -ww; dx <= ww; dx++) cell(x + dx, from + d, icy ? Cell.Ice : Cell.Stone);
    }
    if ((x >> 4) % 2 === 0) cell(x, from + len, Cell.Glowshroom); // a glow bead on some tips
  }
}

function mark(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, label: string, detail: string): void {
  ctx.levels.current?.inspectionMarkers?.push({ kind: 'prefab', label, x0, y0, x1, y1, detail });
}

function grant(ctx: Ctx, card: CardId): void {
  const known =
    ctx.wands.collection.includes(card) || ctx.wands.wands.some((wand) => wand.cards.includes(card));
  if (!known) ctx.wands.grantCard(ctx, card);
}

function arrive(ctx: Ctx, x: number, objective: string, hint: string, y = FLOOR - 2): void {
  const p = ctx.player;
  p.x = x;
  p.y = y;
  const rt = ctx.levels.current;
  if (rt) rt.spawn = { x, y }; // respawn INTO the arena, not the old void spawn
  p.vx = 0;
  p.vy = 0;
  p.fx = 0;
  p.fy = 0;
  ctx.camera.snapTo(x, y - 70);
  ctx.events.emit('objectiveChanged', { text: objective });
  ctx.events.emit('toast', { text: hint });
}

/** ALCHEMY PROVING GROUNDS — a vaulted laboratory hall: one raised trough
 *  per reagent under glowshroom chandeliers, heaps in the next wing through
 *  an arched pylon, and the run's SECRET pair shrined at the far end in one
 *  long trough split by a stone dam the liquids actually touch. */
export function buildAlchemyArena(ctx: Ctx): void {
  const s = stamp(ctx);
  const { cell, fill, tub, heap, lamp } = s;
  const CEIL = FLOOR - 112; // the hall's flat vault
  fill(52, CEIL - 12, WIDTH - 52, CEIL, Cell.Stone);
  fill(52, CEIL + 1, WIDTH - 52, CEIL + 1, Cell.Wall); // a dark masonry trim line
  // glowshroom chandeliers on wooden stems — the laboratory's lighting
  for (const cx of [150, 260, 370, 480, 750, 890, 1140, 1320]) {
    fill(cx, CEIL + 2, cx, CEIL + 9, Cell.Wood);
    fill(cx - 2, CEIL + 10, cx + 2, CEIL + 12, Cell.Glowshroom);
  }
  // arched pylons divide the hall into three wings (troughs | heaps | shrine)
  const pylon = (x0: number): void => {
    fill(x0, CEIL + 1, x0 + 60, FLOOR - 1, Cell.Stone);
    fill(x0 + 8, FLOOR - 46, x0 + 52, FLOOR - 1, Cell.Empty); // the passage
    fill(x0 + 12, FLOOR - 50, x0 + 48, FLOOR - 47, Cell.Empty); // arched top
    cell(x0 + 6, FLOOR - 48, Cell.Glowshroom); // flanking glow
    cell(x0 + 54, FLOOR - 48, Cell.Glowshroom);
  };
  pylon(585);
  pylon(960);

  // WING 1 — reagent troughs, left to right, a lamp after each
  const troughs: Array<[number, number, string, string]> = [
    [120, Cell.Water, 'Water trough', 'Dilutes toxic; quenches lava; freezes under frost'],
    [200, Cell.Acid, 'Acid trough', 'Pour onto LAVA to vitrify it into glass'],
    [280, Cell.Lava, 'Lava trough', 'Acid vitrifies it; water quenches it'],
    [360, Cell.Slime, 'Slime trough', 'Acid digests slime into toxic sludge'],
    [440, Cell.Blood, 'Blood trough', 'Run it into the catalyst heap for healing mist'],
    [520, Cell.Toxic, 'Toxic trough', 'Flood it with water to cleanse it'],
  ];
  for (const [x0, t, label, detail] of troughs) {
    tub(x0, t);
    lamp(x0 + 40);
    mark(ctx, x0 - 2, FLOOR - 19, x0 + 35, BOT, label, detail);
  }

  // WING 2 — powder heaps as cones, with a lamp closing the row
  const heaps: Array<[number, number, string, string]> = [
    [690, Cell.Catalyst, 'Catalyst heap', 'Transmutes blood into healium; consumed grain by grain'],
    [760, Cell.Ash, 'Ash heap', 'Secret-reaction fodder'],
    [830, Cell.Snow, 'Snow bank', 'Secret-reaction fodder'],
    [900, Cell.Coal, 'Coal bed', 'Secret-reaction fodder'],
  ];
  for (const [cx, t, label, detail] of heaps) {
    heap(cx, 12, t);
    mark(ctx, cx - 13, FLOOR - 14, cx + 13, BOT, label, detail);
  }
  lamp(935);

  // WING 3 — THE RUN'S SECRET, pre-staged under its own shrine arch: one long
  // trough, both reagents inside, split by a 6-thick STONE dam the liquids
  // touch directly (the old draft wedged sand between the tubs' METAL walls —
  // breaching it merged nothing). Dig or bomb the dam and watch.
  const secret = ctx.state.secretReaction;
  if (secret) {
    fill(1100, FLOOR - 3, 1179, FLOOR - 1, Cell.Metal); // trough bottom
    fill(1100, FLOOR - 17, 1101, FLOOR - 4, Cell.Metal); // outer walls
    fill(1178, FLOOR - 17, 1179, FLOOR - 4, Cell.Metal);
    fill(1136, FLOOR - 17, 1141, FLOOR - 4, Cell.Stone); // THE DAM
    fill(1102, FLOOR - 15, 1135, FLOOR - 4, secret.a as Cell);
    fill(1142, FLOOR - 15, 1177, FLOOR - 4, secret.b as Cell);
    // a shrine arch frames it — this is the station worth walking to
    fill(1086, FLOOR - 40, 1090, FLOOR - 1, Cell.Stone);
    fill(1189, FLOOR - 40, 1193, FLOOR - 1, Cell.Stone);
    fill(1080, FLOOR - 48, 1199, FLOOR - 41, Cell.Stone);
    fill(1130, FLOOR - 50, 1149, FLOOR - 49, Cell.Glowshroom);
    lamp(1070);
    lamp(1198);
    ctx.events.emit('toast', { text: 'THE FAR SHRINE HOLDS THIS RUN’S SECRET PAIR — DIG OUT THE DAM' });
    mark(ctx, 1080, FLOOR - 52, 1199, BOT, 'THE RUN’S SECRET PAIR', 'Dig out the stone dam between the reagents and watch');
  }
  // the MIXING BASIN — an empty cauldron closing the hall: ferry reagents
  // here with the flask and brew your own disaster on neutral ground
  fill(1280, FLOOR - 3, 1359, FLOOR - 1, Cell.Metal);
  fill(1280, FLOOR - 21, 1281, FLOOR - 4, Cell.Metal);
  fill(1358, FLOOR - 21, 1359, FLOOR - 4, Cell.Metal);
  lamp(1264);
  lamp(1366);
  mark(ctx, 1278, FLOOR - 23, 1361, BOT, 'The mixing basin', 'Empty and metal-lined — ferry reagents here and experiment');
  grant(ctx, 'dig'); // the dam-breaching verb
  arrive(
    ctx,
    90,
    'COMBINE THE TROUGHS — EVERY REACTION IS REAL CELLS',
    'ALCHEMY HALL: siphon, pour, and throw the flask between troughs',
  );
}

/** THE GASWORKS — an abandoned mine under a ragged cavern roof: a gas bell
 *  to ignite, a powder fuse run into a barrel pit, a timbered tunnel through
 *  a laced ore mound, and a dolmen sheltering the big pocket. */
export function buildGasArena(ctx: Ctx): void {
  const s = stamp(ctx);
  const { cell, fill, heap, lamp, torch } = s;
  const w = ctx.world;
  cavernCeiling(s, FLOOR - 178, false);
  // the mine's litter: ash dust and stray coal on the floor (kept off the
  // fuse run so nothing pre-empts the powder line)
  for (let x = 60; x < WIDTH - 60; x++) {
    if (x > 360 && x < 605) continue;
    if ((x * 17) % 23 === 0) cell(x, FLOOR - 1, Cell.Ash);
    if ((x * 29) % 89 === 0) cell(x, FLOOR - 1, Cell.Coal);
  }

  // ── STATION 1: THE GAS BELL — a hollow stone arch on two pillars with the
  // pocket trapped up inside it, visible from below. Flick fire in: whoosh.
  torch(105); // carryable ignition, right at the spawn
  fill(165, FLOOR - 70, 175, FLOOR - 1, Cell.Stone); // left pillar
  fill(265, FLOOR - 70, 275, FLOOR - 1, Cell.Stone); // right pillar
  fill(157, FLOOR - 78, 283, FLOOR - 70, Cell.Stone); // vault, layered dome
  fill(165, FLOOR - 84, 275, FLOOR - 79, Cell.Stone);
  fill(177, FLOOR - 88, 263, FLOOR - 85, Cell.Stone);
  fill(177, FLOOR - 69, 263, FLOOR - 50, Cell.MarshGas); // the trapped pocket
  for (let x = 190; x <= 250; x += 20) cell(x, FLOOR - 89, Cell.Glowshroom);
  lamp(148);
  lamp(288);
  mark(ctx, 157, FLOOR - 90, 283, BOT, 'The gas bell', 'Gas trapped in the vault — carry fire in from the torch');

  // ── STATION 2: THE FUSE RUN — a raised wooden powder trestle (a line laid
  // flat on the floor is invisible; raised, it silhouettes) from an ignition
  // stake to a powder KEG CONE at the rim of a barrel pit. The sim's own
  // physics stages the payoff: a thin powder line deflagrates (fails the
  // packed-clump anisotropy test in igniteGunpowder), but the cone IS a
  // packed clump — the arriving burn front detonates it, and the blast
  // engulfs the barrels in the pit behind it. The line enters the cone's
  // flank at exactly line height, so every cell is stamped supported — no
  // settling lottery in the connection.
  lamp(358);
  fill(372, FLOOR - 12, 374, FLOOR - 1, Cell.Wood); // the ignition stake
  for (let x = 384; x <= 528; x += 22) fill(x, FLOOR - 3, x + 1, FLOOR - 1, Cell.Wood); // trestle posts
  fill(375, FLOOR - 5, 540, FLOOR - 4, Cell.Wood); // the plank rail
  fill(375, FLOOR - 7, 540, FLOOR - 6, Cell.Gunpowder); // the powder line on top
  fill(552, FLOOR, 596, FLOOR + 7, Cell.Empty); // the blast pit
  heap(544, 8, Cell.Gunpowder); // the keg cone at the rim (apex above the line)
  lamp(604);
  mark(ctx, 370, FLOOR - 12, 596, FLOOR + 8, 'The fuse run', 'Light the stake; the line races into the keg cone and the pit goes up');
  const barrel = (x: number, y: number): void => {
    ctx.rigidBodies.spawn(
      { kind: 'box', halfW: 3.5, halfH: 4.5 },
      x,
      y,
      { material: 'wood', payload: 'explosive', color: packRGB(176, 64, 48), friction: 0.6, restitution: 0.1 },
    );
  };
  barrel(564, FLOOR + 1);
  barrel(576, FLOOR + 1);
  barrel(588, FLOOR + 1);
  barrel(570, FLOOR - 9);

  // ── STATION 3: THE LACED VEIN — an ore mound with a timbered walk-through
  // tunnel; a gunpowder vein winds through the rock and daylights on three
  // faces. Mining it is optional (the tunnel is the path), and it is a trap
  // you spring yourself: dig along the vein or torch an exposed end.
  torch(630);
  const M0 = 660;
  const M1 = 880;
  const mh = (x: number): number =>
    Math.round(56 * Math.pow(Math.sin((Math.PI * (x - M0)) / (M1 - M0)), 1.2));
  for (let x = M0; x <= M1; x++) {
    const h = mh(x);
    if (h <= 0) continue;
    fill(x, FLOOR - h, x, FLOOR - 1, Cell.Stone);
    if ((x * 7) % 3 !== 0) cell(x, FLOOR - h - 1, Cell.Moss); // grassy crest
  }
  // ore pockets flecked with powder
  const oreBlob = (cx: number, cy: number, r: number): void => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (w.types[w.idx(x, y)] !== Cell.Stone) continue;
        cell(x, y, (x * 5 + y * 3) % 7 === 0 ? Cell.Gunpowder : Cell.RawOre);
      }
    }
  };
  oreBlob(712, FLOOR - 18, 7);
  oreBlob(826, FLOOR - 16, 6);
  oreBlob(765, FLOOR - 44, 5);
  // the tunnel: an arched walk-through at floor level. Shoulders stay ≥27
  // tall — the wizard is 17 cells and wedges under anything tighter.
  for (let dx = -17; dx <= 17; dx++) {
    const depth = Math.abs(dx) <= 12 ? 32 : 32 - (Math.abs(dx) - 12);
    fill(765 + dx, FLOOR - depth, 765 + dx, FLOOR - 1, Cell.Empty);
  }
  // mine timbering: support posts at the tunnel mouths, and a wooden
  // headframe straddling the summit — this was a working dig once
  fill(747, FLOOR - 27, 748, FLOOR - 1, Cell.Wood);
  fill(782, FLOOR - 27, 783, FLOOR - 1, Cell.Wood);
  fill(757, FLOOR - 80, 758, FLOOR - 52, Cell.Wood); // headframe legs
  fill(772, FLOOR - 80, 773, FLOOR - 52, Cell.Wood);
  fill(753, FLOOR - 84, 777, FLOOR - 81, Cell.Wood); // crossbeam
  fill(763, FLOOR - 86, 767, FLOOR - 85, Cell.Glowshroom); // the pit lamp
  // the vein: a 3-thick powder polyline stamped only into solid rock, so it
  // never floats in the tunnel air; both ends + the summit spur daylight
  const vein: Array<[number, number]> = [
    [693, FLOOR - 21],
    [726, FLOOR - 34],
    [765, FLOOR - 42],
    [804, FLOOR - 33],
    [847, FLOOR - 20],
  ];
  const powderIntoRock = (x: number, y: number): void => {
    const t = w.types[w.idx(x, y)];
    if (t === Cell.Stone || t === Cell.RawOre) cell(x, y, Cell.Gunpowder);
  };
  const veinSeg = (ax: number, ay: number, bx: number, by: number): void => {
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let step = 0; step <= steps; step++) {
      const x = Math.round(ax + ((bx - ax) * step) / steps);
      const y = Math.round(ay + ((by - ay) * step) / steps);
      powderIntoRock(x, y);
      powderIntoRock(x + 1, y);
      powderIntoRock(x, y + 1);
      powderIntoRock(x - 1, y);
      powderIntoRock(x, y - 1);
    }
  };
  for (let i = 0; i < vein.length - 1; i++) veinSeg(vein[i][0], vein[i][1], vein[i + 1][0], vein[i + 1][1]);
  veinSeg(765, FLOOR - 42, 765, FLOOR - 55); // summit spur, daylighting on top
  lamp(736);
  lamp(792);
  mark(ctx, M0, FLOOR - 58, M1, BOT, 'The laced vein', 'Powder threads the ore mound — the tunnel is safe, mining is not');

  // ── STATION 4: THE DOLMEN — two megaliths and a capstone sheltering the
  // big pocket. Detonate it from range, or let the bomber wander in.
  fill(980, FLOOR - 74, 1002, FLOOR - 1, Cell.Stone); // left megalith
  fill(1258, FLOOR - 74, 1280, FLOOR - 1, Cell.Stone); // right megalith
  fill(960, FLOOR - 94, 1300, FLOOR - 75, Cell.Stone); // capstone
  fill(1004, FLOOR - 74, 1256, FLOOR - 62, Cell.MarshGas); // the big pocket
  for (let x = 980; x <= 1280; x += 30) cell(x, FLOOR - 95, Cell.Glowshroom);
  lamp(948);
  lamp(1310);
  mark(ctx, 960, FLOOR - 96, 1300, BOT, 'The dolmen pocket', 'The big one — detonate from range, or mind the bomber');
  // the wandering fuse — spawned on OPEN floor, not under the capstone (a
  // bomber parked inside the pocket detonates it the moment you walk up)
  ctx.enemyCtl.spawn('bomber', 920, FLOOR - 2);

  grant(ctx, 'flame'); // the ignition verb
  grant(ctx, 'dig'); // the mining verb
  arrive(
    ctx,
    90,
    'THE GASWORKS — EVERY POCKET IS A FUSE',
    'GASWORKS: torch the bell, light the fuse run, mine the vein — carefully',
  );
}

/** FLASK & FROST RANGE — a glacial grotto: freeze a crossing over the sunken
 *  lake between iceberg spires, melt it back at the brazier, and practice
 *  flask grenades on live targets on the far shore. */
export function buildFrostArena(ctx: Ctx): void {
  const s = stamp(ctx);
  const { cell, fill } = s;
  cavernCeiling(s, FLOOR - 156, true);
  // RAISED SHORES with the lake sunk between them — the first draft piled a
  // 60-cell wall of water ABOVE the walking floor (an aquarium, not a lake;
  // the blueprint shot made that obvious). Shores are stone platforms; the
  // water surface sits just below their lips, so the crossing reads true.
  const SHORE = FLOOR - 40; // walkway level on both shores
  fill(57, SHORE, 358, FLOOR - 1, Cell.Stone); // near shore platform
  fill(1042, SHORE, WIDTH - 57, FLOOR - 1, Cell.Stone); // far shore platform
  fill(360, SHORE + 2, 1040, FLOOR - 1, Cell.Water); // the lake, below the lips
  // icebergs breaking the surface — landmarks mid-crossing, and proof the
  // lake is deep; snow-capped so they read white against the water
  const berg = (cx: number, half: number, topY: number): void => {
    for (let y = topY; y <= FLOOR - 1; y++) {
      const spread = half + Math.floor((y - topY) / 6); // widens with depth
      fill(cx - spread, y, cx + spread, y, Cell.Ice);
    }
    fill(cx - half + 1, topY - 1, cx + half - 1, topY - 1, Cell.Snow); // snow cap
  };
  berg(500, 5, SHORE - 6);
  berg(690, 7, SHORE - 12);
  berg(880, 4, SHORE - 3);
  // snow dusting and drifts on the walkways — a grotto, not a parking lot
  for (let x = 60; x <= 355; x++) if ((x * 13) % 4 !== 0) cell(x, SHORE - 1, Cell.Snow);
  for (let x = 1045; x <= WIDTH - 60; x++) if ((x * 13) % 4 !== 0) cell(x, SHORE - 1, Cell.Snow);
  const drift = (cx: number, r: number): void => {
    for (let dy = 0; dy < r; dy++) fill(cx - (r - dy), SHORE - 1 - dy, cx + (r - dy), SHORE - 1 - dy, Cell.Snow);
  };
  drift(195, 7);
  drift(338, 6);
  drift(1075, 8);
  drift(1345, 7);
  const shoreLamp = (x: number): void => {
    fill(x, SHORE - 12, x + 1, SHORE - 1, Cell.Stone);
    fill(x - 1, SHORE - 14, x + 2, SHORE - 13, Cell.Glowshroom);
  };
  // fire pit on the near shore: re-melt your bridge behind you
  fill(248, SHORE - 8, 292, SHORE - 1, Cell.Metal); // brazier
  fill(252, SHORE - 6, 288, SHORE - 2, Cell.Lava);
  // flask reagent tubs on the shores (raised metal, shore-relative)
  fill(118, SHORE - 14, 172, SHORE - 1, Cell.Metal);
  fill(121, SHORE - 12, 169, SHORE - 2, Cell.Water);
  fill(1148, SHORE - 12, 1202, SHORE - 1, Cell.Metal);
  fill(1151, SHORE - 10, 1199, SHORE - 2, Cell.Lava);
  fill(1258, SHORE - 14, 1312, SHORE - 1, Cell.Metal);
  fill(1261, SHORE - 12, 1309, SHORE - 2, Cell.Acid);
  shoreLamp(100);
  shoreLamp(228);
  shoreLamp(310);
  shoreLamp(1100);
  shoreLamp(1230);
  shoreLamp(1330);
  // live targets on the far shore
  ctx.enemyCtl.spawn('slime', 1120, SHORE - 2);
  ctx.enemyCtl.spawn('slime', 1230, SHORE - 2);
  ctx.enemyCtl.spawn('bat', 1180, SHORE - 80);
  mark(ctx, 360, SHORE, 1040, FLOOR, 'The lake', 'Icelance the surface into a bridge; the brazier melts it back');
  mark(ctx, 246, SHORE - 10, 294, SHORE, 'Lava brazier', 'Re-melt your bridge behind you');
  mark(ctx, 683, SHORE - 14, 697, FLOOR, 'Iceberg spire', 'Deep-water landmark; the crossing threads between the bergs');
  grant(ctx, 'icelance'); // the bridge verb
  grant(ctx, 'flame'); // the melt verb
  arrive(
    ctx,
    200,
    'FREEZE A CROSSING — THROW WHAT BURNS',
    'FROST GROTTO: icelance the lake to bridge it; fill the flask and throw it',
    SHORE - 2,
  );
}

import type { BodyMaterial, Ctx, Mechanism } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';
import { makeDispenser, makeLever, makePlate, makeRelay } from '@/game/Mechanisms';
import { BACKDROP_LAYER_SPECS, createDefaultBackdropSettings } from '@/config/backdrop';

/**
 * The "PHYSICS TEST ARENA" (worldgraph id 'physics-test'): a single bright,
 * self-contained playground — the generated cave is wiped and replaced — with a
 * station for every physics-joy feature, laid out left→right:
 *   crate yard (kick/grab/throw, sizes×materials) · vine-swing pit · dispenser +
 *   lever · water pool (buoyancy) · fill-and-float shaft · lava (fire + a ragdoll
 *   death pit) · large crates (shatter) · explosive barrels · metal + ice (cast
 *   lightning/frost at them).
 * Lit bright with a black backdrop so everything reads; ambient is restored on
 * leave. Stamped by Levels.enterLevel AFTER the level-change clear so bodies live.
 */

const FY = 700; // floor top
const BOT = 716; // floor bottom
const X0 = 60;
const X1 = 1594; // right wall (world is 1600 wide — must stay in-bounds)
const TOP = 184;
const PLAYGROUND_AMBIENT = 0.92;

/** Captured once on first entry so leaving restores the player's real ambient. */
let savedAmbient: number | null = null;

export function buildPhysicsArena(ctx: Ctx): void {
  const w = ctx.world;
  const stone = (x: number, y: number): void => {
    if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), Cell.Stone, COLOR_FN[Cell.Stone]());
  };
  const cell = (x: number, y: number, t: number): void => {
    if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), t, COLOR_FN[t] ? COLOR_FN[t]() : packRGB(120, 120, 120));
  };
  const box = (x0: number, y0: number, x1: number, y1: number, t: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cell(x, y, t);
  };

  // ---- wipe the generated level; this is a standalone playground ----
  w.clear();

  // ---- bright lighting + a black backdrop (set on this runtime only) ----
  if (savedAmbient === null) savedAmbient = ctx.params.global.ambient;
  ctx.params.global.ambient = PLAYGROUND_AMBIENT;
  const runtime = ctx.levels.current;
  if (runtime) {
    const black = createDefaultBackdropSettings();
    for (const spec of BACKDROP_LAYER_SPECS) {
      black.layers[spec.id].visible = false;
      black.layers[spec.id].opacity = 0;
    }
    runtime.backdrop = black;
    runtime.backdropLevelId = null;
    runtime.emitters = []; // fresh — the fill-and-float water source is the only one
  }
  // Restore the real ambient when the player leaves the playground (one-shot).
  const restore = ctx.events.on('levelChanged', () => {
    if (savedAmbient !== null) ctx.params.global.ambient = savedAmbient;
    savedAmbient = null;
    restore();
  });

  // ---- the room: floor, side walls, a low back wall (top stays open = black) ----
  box(X0, FY, X1, BOT, Cell.Stone); // floor
  for (let y = TOP; y <= BOT; y++) for (let d = 0; d < 6; d++) {
    stone(X0 + d, y);
    stone(X1 - d, y);
  }

  const rb = ctx.rigidBodies;
  rb.clear();
  const boulder = (x: number, y: number, material: BodyMaterial = 'stone'): void => {
    rb.spawn({ kind: 'circle', radius: 5 }, x, y, { material, friction: 0.9, restitution: 0.15 });
  };
  const crate = (x: number, y: number, material: BodyMaterial, half = 3.5): void => {
    rb.spawn({ kind: 'box', halfW: half, halfH: half }, x, y, { material, friction: 0.6, restitution: 0.15 });
  };
  const barrel = (x: number, y: number): void => {
    // a red explosive barrel (wood so it ignites; payload detonates on fire/blast)
    rb.spawn({ kind: 'box', halfW: 3.5, halfH: 4.5 }, x, y, { material: 'wood', payload: 'explosive', color: packRGB(176, 64, 48), friction: 0.6, restitution: 0.1 });
  };

  // ===== Z1 — CRATE YARD: kick (F) / grab+throw (G), sizes × materials =====
  crate(110, FY - 5, 'wood');
  crate(132, FY - 5, 'stone');
  crate(154, FY - 5, 'metal');
  boulder(190, FY - 8);
  crate(240, FY - 9, 'wood', 6); // large wood — shatters when bombed, too heavy to grab
  crate(290, FY - 9, 'metal', 6); // large metal — near-immovable to kick/blast

  // ===== Z2 — VINE SWING: a pit you swing across (grab a vine with G) =====
  // carve the pit out of the floor; a soft lower floor so a miss isn't death
  box(431, FY, 545, BOT, Cell.Empty);
  box(431, 782, 545, 792, Cell.Stone);
  for (let x = 405; x <= 565; x++) for (let y = 540; y <= 544; y++) stone(x, y); // swing beam
  const vines = ctx.vineStrands;
  vines.addHanging(440, 545, 150, { thickness: 2 });
  vines.addHanging(485, 545, 150, { thickness: 3 });
  vines.addHanging(525, 545, 150, { thickness: 2, color: packRGB(122, 88, 52) });

  // ===== Z3 — DISPENSER + LEVER (pull E) + a stack to topple =====
  for (let i = 0; i < 4; i++) crate(720, FY - 5 - i * 8, i % 2 ? 'metal' : 'wood'); // topple stack

  // ===== Z4 — WATER POOL: buoyancy (wood floats, metal/stone sink) =====
  const PX0 = 850;
  const PX1 = 1060;
  box(PX0, 624, PX1, BOT, Cell.Empty); // carve basin
  for (let y = 624; y <= BOT; y++) for (let d = 0; d < 4; d++) { stone(PX0 - 1 - d, y); stone(PX1 + 1 + d, y); }
  box(PX0, FY, PX1, BOT, Cell.Stone); // basin floor
  box(PX0 + 1, 640, PX1 - 1, FY - 1, Cell.Water);
  crate(900, 600, 'wood'); // floats
  crate(950, 600, 'stone'); // sinks
  crate(1000, 600, 'metal'); // sinks
  boulder(1035, 600); // sinks

  // ===== Z5 — FILL-AND-FLOAT: a water emitter floods a shaft, lifting a crate =====
  const SX0 = 1100;
  const SX1 = 1150;
  for (let y = 360; y <= BOT; y++) for (let d = 0; d < 4; d++) { stone(SX0 - 1 - d, y); stone(SX1 + 1 + d, y); }
  crate((SX0 + SX1) / 2, FY - 5, 'wood'); // rises as the shaft fills
  runtime?.emitters?.push({ x: Math.round((SX0 + SX1) / 2), y: 372, cell: Cell.Water, rate: 2, dir: 0, burst: 4, phase: 0 });

  // ===== Z6 — REACTIONS + SHATTER + BARRELS + RAGDOLL PIT =====
  // a lava pit: fire reaction (the wood crate beside it burns to ash) AND a death
  // hazard — jump in to watch the ragdoll + tombstone.
  box(1210, 686, 1290, FY - 1, Cell.Lava);
  crate(1198, FY - 5, 'wood'); // touches the lava → ignites → chars to ash
  // metal crates for cast lightning (conducts) + an ice patch for frost contact
  crate(1330, FY - 5, 'metal');
  crate(1352, FY - 5, 'metal');
  box(1380, FY - 2, 1410, FY - 1, Cell.Ice);
  crate(1395, FY - 5, 'stone'); // sits on ice → frost contact freezes it
  // large brittle crates to BOMB (shatter into rubble + smaller crates)
  crate(1300, FY - 9, 'stone', 6);
  // a cluster of EXPLOSIVE BARRELS — shoot or ignite one for a chain reaction
  barrel(1450, FY - 6);
  barrel(1462, FY - 6);
  barrel(1474, FY - 6);
  barrel(1456, FY - 16);

  // ---- spawn the player on clear floor at the left, calm arena ----
  const p = ctx.player;
  p.x = 120;
  p.y = FY - 1;
  p.vx = p.vy = p.fx = p.fy = 0;
  p.dead = false;
  p.crawling = false;
  p.climbing = false;
  p.swinging = false;
  p.diveT = 0;
  p.hp = p.maxHp;
  ctx.camera.snapTo(260, FY - 140);
  ctx.enemies.length = 0;

  // ---- dispenser + lever (Z3), wired ----
  if (runtime) {
    runtime.mechanisms.length = 0;
    const disp = makeDispenser(w, runtime.mechanisms, 690, 560, { cooldown: 18, maxActive: 10 });
    makeLever(runtime.mechanisms, 650, FY - 1, disp);
    buildAcidTrap(ctx, runtime.mechanisms);
    runtime.mechanismTriggers = undefined; // rebuild the cached trigger index
  }
}

/**
 * "THE ALCHEMIST'S FOLLY" — a quirky Rube Goldberg death trap (far-right zone).
 * Step on the plate and, after a beat, a relay fires: it lights its ignition coil,
 * which (a) sets a wood FUSE crawling along the floor into a nest of EXPLOSIVE
 * BARRELS and onward to an ICE dam, and (b) lights the barrels directly. The
 * crawling fire melts the ice, loosing a pent-up ACID reservoir toward the victim;
 * the barrels chain-detonate, flinging the flaming crate perched on them and
 * SHOVING whoever's on the plate sideways into the ACID VAT — death by ragdoll,
 * sinking. Uses plate → relay(ignite) → igniteArea, a burning fuse, fire-melts-ice,
 * the explosive-barrel chain, and the blast push.
 */
function buildAcidTrap(ctx: Ctx, mechs: Mechanism[]): void {
  const w = ctx.world;
  const rb = ctx.rigidBodies;
  const cell = (x: number, y: number, t: number): void => {
    if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), t, COLOR_FN[t] ? COLOR_FN[t]() : packRGB(120, 120, 120));
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, t: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cell(x, y, t);
  };

  // --- re-assert a solid floor under the whole contraption so the nest, relay
  //     footing, and plate always sit on bedrock (independent of carves) ---
  fill(1485, FY, X1 - 6, BOT, Cell.Stone);

  // --- the ACID VAT (the finale) right of the plate: a SEALED basin — stone
  //     floor + walls, acid surface a few cells below the lip — so it can't drain
  //     or corrode the contraption, but a shoved victim drops straight in ---
  fill(1545, FY, 1585, BOT - 1, Cell.Empty); // carve the pit (keep y=BOT as the basin floor)
  fill(1546, 703, 1584, BOT - 1, Cell.Acid); // acid pooled in the bottom (surface y703, below the lip)

  // --- the contraption's gantry: a left backstop wall + a metal canopy so the
  //     blast vents sideways toward the victim instead of straight up ---
  for (let y = FY - 44; y <= FY - 1; y++) { cell(1490, y, Cell.Stone); cell(1491, y, Cell.Stone); }
  for (let x = 1490; x <= 1528; x++) { cell(x, FY - 44, Cell.Metal); cell(x, FY - 43, Cell.Metal); }

  // --- the explosive barrel nest on the floor (left of the plate) ---
  const barrel = (x: number, y: number): void => {
    rb.spawn({ kind: 'box', halfW: 3.5, halfH: 4.5 }, x, y, { material: 'wood', payload: 'explosive', color: packRGB(176, 64, 48), friction: 0.6, restitution: 0.1 });
  };
  barrel(1502, FY - 5);
  barrel(1512, FY - 5);
  barrel(1522, FY - 5);
  barrel(1512, FY - 15);

  // --- a wood crate perched on the nest — the blast flings it (flaming) at the victim ---
  rb.spawn({ kind: 'box', halfW: 4, halfH: 4 }, 1512, FY - 24, { material: 'wood', friction: 0.6, restitution: 0.15 });

  // --- the wood FUSE the relay lights: fire crawls along it into the nest and on
  //     to the ice block (the fire literally dissolves the fuse to reach the nest) ---
  for (let x = 1494; x <= 1528; x++) cell(x, FY - 1, Cell.Wood);

  // --- an ICE block at the fuse's end: the crawling fire melts it to water — a
  //     visible "fire dissolves something" beat, harmlessly contained ---
  fill(1529, FY - 9, 1535, FY - 1, Cell.Ice);

  // --- the RELAY ignition coil buried in the nest: when the plate fires it, it
  //     lights the fuse AND (via igniteArea) the barrels it sits among ---
  const relay = makeRelay(mechs, 1508, FY - 1, { delayFrames: 10, outputAction: 'ignite' });

  // --- the TRIGGER PLATE (step here → it all kicks off) ---
  makePlate(w, mechs, 1537, FY - 1, 7, relay);
}

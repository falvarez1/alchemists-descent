import type { Ctx, Mechanism } from '@/core/types';
import { hash2 } from '@/core/math';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, packRGB, stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';

/**
 * Ids only need uniqueness within one level's mechanism list (targetId links
 * stay serializable). List-scoped allocation also survives module duplication
 * in dev tooling, unlike a module-level counter.
 */
function allocId(list: Mechanism[]): number {
  let max = 0;
  for (const m of list) if (m.id > max) max = m.id;
  return max + 1;
}

/* ---------------- factory helpers (used by world/structures.ts) ---------------- */

export function makeDoor(
  ctx: Ctx,
  list: Mechanism[],
  x: number,
  y: number,
  w: number,
  h: number,
): Mechanism {
  const door: Mechanism = { id: allocId(list), kind: 'door', x, y, w, h, state: 0, targetId: -1 };
  list.push(door);
  setDoorCells(ctx, door, false);
  return door;
}

export function setDoorCells(ctx: Ctx, door: Mechanism, open: boolean): void {
  const world = ctx.world;
  const wasOpen = door.state === 1;
  door.state = open ? 1 : 0;
  if (open) {
    door.closePending = false;
    // RETRACTION, not teleportation: queue the door's cells bottom-row-first
    // (a gate sliding up into its frame); Mechanisms.update clears a few per
    // frame with dust shaking off the rising edge.
    const cells: Array<[number, number]> = [];
    for (let dy = 0; dy < door.h; dy++) {
      for (let dx = 0; dx < door.w; dx++) {
        cells.push([door.x + dx, door.y + dy]);
      }
    }
    door.dissolve = cells; // pop() takes the bottom rows first
    return;
  }
  door.dissolve = undefined; // a closing door slams shut at once
  let skipped = false;
  for (let dx = 0; dx < door.w; dx++) {
    for (let dy = 0; dy < door.h; dy++) {
      const X = door.x + dx,
        Y = door.y + dy;
      if (!world.inBounds(X, Y)) continue;
      const i = world.idx(X, Y);
      {
        // Safe close: never crush a living body
        let occupied =
          Math.abs(X - ctx.player.x) <= 5 && Y <= ctx.player.y + 1 && Y >= ctx.player.y - 18;
        if (!occupied) {
          for (const e of ctx.enemies) {
            const def = ctx.enemyCtl.defs[e.kind];
            if (Math.abs(X - e.x) <= def.halfW + 1 && Y <= e.y + 1 && Y >= e.y - def.h - 1) {
              occupied = true;
              break;
            }
          }
        }
        if (occupied) {
          skipped = true;
          continue;
        }
        // rune-tinted metal so sealed doors read as mechanisms, not plain plate
        const rs = 0.85 + hash2(X, Y, 311) * 0.3;
        world.replaceCellAt(i, Cell.Metal, packRGB(Math.floor(96 * rs), Math.floor(108 * rs), Math.floor(142 * rs)));
      }
    }
  }
  door.closePending = skipped;
  if (wasOpen && ctx.state.mode === 'play') {
    for (let k = 0; k < 8; k++) {
      ctx.particles.spawn(
        door.x + Math.random() * door.w,
        door.y + Math.random() * door.h,
        (Math.random() - 0.5) * 0.35,
        -0.2 - Math.random() * 0.35,
        null,
        packRGB(130, 140, 155),
        18 + Math.floor(Math.random() * 12),
        { grav: 0.04, glow: 0.6 },
      );
    }
  }
}

export function makePlate(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  w: number,
  door: Mechanism,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'plate',
    x,
    y,
    w,
    h: 1,
    state: 0,
    pressed: false,
    targetId: door.id,
  };
  list.push(m);
  // visible plate: a thin brass sill flush with the floor
  const body: Array<[number, number]> = [];
  for (let dx = 0; dx < w; dx++) {
    if (world.inBounds(x + dx, y)) {
      const i = world.idx(x + dx, y);
      world.replaceCellAt(i, Cell.Metal, packRGB(148, 132, 70));
      body.push([x + dx, y]);
    }
  }
  m.body = body;
  return m;
}

export function makeLever(
  list: Mechanism[],
  x: number,
  y: number,
  door: Mechanism,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'lever',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: door.id,
    // the bracket's footing — blast it away and the gate fail-opens
    body: [
      [x - 1, y + 1],
      [x, y + 1],
      [x + 1, y + 1],
    ],
  };
  list.push(m);
  return m;
}

export function makeBrazier(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  door: Mechanism,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'brazier',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: door.id,
  };
  list.push(m);
  // bowl: a small stone cup waiting for flame
  const body: Array<[number, number]> = [];
  for (let dx = -2; dx <= 2; dx++) {
    if (world.inBounds(x + dx, y)) {
      const i = world.idx(x + dx, y);
      world.replaceCellAt(i, Cell.Stone, stoneColor());
      body.push([x + dx, y]);
    }
  }
  for (const dx of [-2, 2]) {
    if (world.inBounds(x + dx, y - 1)) {
      const i = world.idx(x + dx, y - 1);
      world.replaceCellAt(i, Cell.Stone, stoneColor());
      body.push([x + dx, y - 1]);
    }
  }
  m.body = body;
  return m;
}

/** SAND SCALE: a brass pan that wants real material weight poured onto it. */
export function makeScale(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  w: number,
  threshold: number,
  door: Mechanism,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'scale',
    x,
    y,
    w,
    h: 1,
    state: 0,
    targetId: door.id,
    threshold,
    zone: { x0: x, y0: y - 7, x1: x + w - 1, y1: y - 1 },
  };
  list.push(m);
  const body: Array<[number, number]> = [];
  // the pan: a brass sill with raised lips so the pour stays put
  for (let dx = 0; dx < w; dx++) {
    if (world.inBounds(x + dx, y)) {
      const i = world.idx(x + dx, y);
      world.replaceCellAt(i, Cell.Metal, packRGB(168, 142, 64));
      body.push([x + dx, y]);
    }
  }
  for (const dx of [-1, w]) {
    for (let dy = 0; dy <= 2; dy++) {
      if (world.inBounds(x + dx, y - dy)) {
        const i = world.idx(x + dx, y - dy);
        world.replaceCellAt(i, Cell.Metal, packRGB(148, 126, 58));
        body.push([x + dx, y - dy]);
      }
    }
  }
  m.body = body;
  return m;
}

/** SLUICE BUOY: a float that rises when its basin pools enough liquid. */
export function makeBuoy(
  list: Mechanism[],
  x: number,
  y: number,
  zone: { x0: number; y0: number; x1: number; y1: number },
  threshold: number,
  door: Mechanism,
  body: Array<[number, number]>,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'buoy',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: door.id,
    threshold,
    zone,
    body,
  };
  list.push(m);
  return m;
}

/** CHARGE-LATCH: a coil that latches forever on the first spark in its zone. */
export function makeChargeLatch(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  door: Mechanism,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'chargelatch',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: door.id,
    zone: { x0: x - 3, y0: y - 5, x1: x + 3, y1: y - 1 },
  };
  list.push(m);
  // a conductive pedestal: metal drinks lightning and wears charge visibly
  const body: Array<[number, number]> = [];
  for (let dx = -2; dx <= 2; dx++) {
    if (world.inBounds(x + dx, y)) {
      const i = world.idx(x + dx, y);
      world.replaceCellAt(i, Cell.Metal, packRGB(104, 116, 132));
      body.push([x + dx, y]);
    }
  }
  m.body = body;
  return m;
}

/* ---------------- machine primitives (docs/MACHINE-PRIMITIVES-AND-STRUCTURES-PLAN.md) ---------------- */

/**
 * VALVE: a small material gate in a channel, opened/closed by its linked
 * triggers exactly like a door (logic 'and'/'or'/'sequence' reused). A
 * sluice is just a wide valve. Fail-open is PHYSICAL: destroyed valve cells
 * are an open channel — no body-watch metadata needed.
 */
export function makeValve(
  ctx: Ctx,
  list: Mechanism[],
  x: number,
  y: number,
  w: number,
  h: number,
  opts?: {
    material?: number;
    oneShot?: boolean;
    autoCloseFrames?: number;
    logic?: 'and' | 'or' | 'sequence';
  },
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'valve',
    x,
    y,
    w,
    h,
    state: 0,
    targetId: -1,
    material: opts?.material ?? Cell.Metal,
  };
  if (opts?.oneShot === true) m.oneShot = true;
  if (opts?.autoCloseFrames !== undefined && opts.autoCloseFrames > 0) {
    m.autoCloseFrames = Math.floor(opts.autoCloseFrames);
  }
  if (opts?.logic === 'or' || opts?.logic === 'sequence') m.logic = opts.logic;
  list.push(m);
  setValveCells(ctx, m, false);
  return m;
}

/** Open/close a valve's real cells (setDoorCells with the valve's material). */
export function setValveCells(ctx: Ctx, valve: Mechanism, open: boolean): void {
  const world = ctx.world;
  const wasOpen = valve.state === 1;
  valve.state = open ? 1 : 0;
  const mat = valve.material ?? Cell.Metal;
  if (open) {
    valve.closePending = false;
    // retraction, bottom rows first, cleared a few per frame in update
    const cells: Array<[number, number]> = [];
    for (let dy = 0; dy < valve.h; dy++) {
      for (let dx = 0; dx < valve.w; dx++) cells.push([valve.x + dx, valve.y + dy]);
    }
    valve.dissolve = cells;
    if (valve.autoCloseFrames !== undefined && valve.autoCloseFrames > 0) {
      valve.closeT = valve.autoCloseFrames;
    }
    return;
  }
  valve.dissolve = undefined;
  const fn = COLOR_FN[mat];
  let skipped = false;
  for (let dx = 0; dx < valve.w; dx++) {
    for (let dy = 0; dy < valve.h; dy++) {
      const X = valve.x + dx,
        Y = valve.y + dy;
      if (!world.inBounds(X, Y)) continue;
      // Safe close: never crush a living body (the door rule)
      let occupied =
        Math.abs(X - ctx.player.x) <= 5 && Y <= ctx.player.y + 1 && Y >= ctx.player.y - 18;
      if (!occupied) {
        for (const e of ctx.enemies) {
          const def = ctx.enemyCtl.defs[e.kind];
          if (Math.abs(X - e.x) <= def.halfW + 1 && Y <= e.y + 1 && Y >= e.y - def.h - 1) {
            occupied = true;
            break;
          }
        }
      }
      if (occupied) {
        skipped = true;
        continue;
      }
      const i = world.idx(X, Y);
      let color: number;
      if (mat === Cell.Metal) {
        // mechanism-tinted metal, like doors — a gate, not plain plate
        const rs = 0.85 + hash2(X, Y, 173) * 0.3;
        color = packRGB(Math.floor(110 * rs), Math.floor(104 * rs), Math.floor(86 * rs));
      } else {
        color = fn ? fn() : EMPTY_COLOR;
      }
      world.replaceCellAt(i, mat, color);
    }
  }
  valve.closePending = skipped;
  // a slamming valve shakes dust off the channel (the door-close puff)
  if (wasOpen && ctx.state.mode === 'play') {
    for (let k = 0; k < 5; k++) {
      ctx.particles.spawn(
        valve.x + Math.random() * valve.w,
        valve.y + Math.random() * valve.h,
        (Math.random() - 0.5) * 0.3,
        -0.15 - Math.random() * 0.3,
        null,
        packRGB(140, 135, 118),
        16 + Math.floor(Math.random() * 10),
        { grav: 0.04, glow: 0.5 },
      );
    }
  }
}

/**
 * PLUG: real cells plus metadata that watches its own body. When breakFrac
 * of the recorded cells are gone or TRANSFORMED — burned, dissolved,
 * blasted, dug, by any cause — it fires its output exactly once. The
 * material IS the break profile; there is no cause filtering on purpose.
 */
export function makePlug(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  w: number,
  h: number,
  material: number,
  target?: Mechanism | null,
  breakFrac?: number,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'plug',
    x,
    y,
    w,
    h,
    state: 0,
    targetId: target ? target.id : -1,
    material,
  };
  if (breakFrac !== undefined && Number.isFinite(breakFrac)) {
    m.breakFrac = Math.min(0.95, Math.max(0.05, breakFrac));
  }
  list.push(m);
  const fn = COLOR_FN[material];
  const body: Array<[number, number]> = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const X = x + dx,
        Y = y + dy;
      if (!world.inBounds(X, Y)) continue;
      const i = world.idx(X, Y);
      world.replaceCellAt(i, material, fn ? fn() : EMPTY_COLOR);
      body.push([X, Y]);
    }
  }
  m.body = body;
  return m;
}

/** Hard cap on sensor/counterweight zone area (malformed prefabs must not
 *  buy themselves giant per-frame scans). */
export const SENSOR_ZONE_CAP = 1600; // 40x40
export const DEFAULT_TRIGGER_LATCH_FRAMES = 420;
export const BUOY_LATCH_FRAMES = 600;
export const SENSOR_SCAN_MOD = 4;
export const SENSOR_MOMENTARY_LATCH_FRAMES = 6;

function clampZone(zone: { x0: number; y0: number; x1: number; y1: number }): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const x0 = Math.min(zone.x0, zone.x1),
    y0 = Math.min(zone.y0, zone.y1);
  const side = Math.floor(Math.sqrt(SENSOR_ZONE_CAP)) - 1;
  return {
    x0,
    y0,
    x1: Math.min(Math.max(x0, zone.x1), x0 + side),
    y1: Math.min(Math.max(y0, zone.y1), y0 + side),
  };
}

/**
 * GENERIC SENSOR: a bounded zone read with a typed reading and a latch mode.
 * The visible Wave E sensors (plate/scale/buoy/brazier/chargelatch) stay
 * preferred for hand-placed puzzles; this one serves generated machines and
 * advanced authoring. Its anchor is a small physical node so destruction
 * triggers the same fail-open behavior as other machine triggers.
 */
export function makeSensor(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  opts: {
    sensorType: NonNullable<Mechanism['sensorType']>;
    threshold: number;
    zone: { x0: number; y0: number; x1: number; y1: number };
    latch?: NonNullable<Mechanism['latch']>;
    latchFrames?: number;
    materialFilter?: number[];
  },
  target?: Mechanism | null,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'sensor',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: target ? target.id : -1,
    sensorType: opts.sensorType,
    threshold: Math.max(1, Math.floor(opts.threshold)),
    zone: clampZone(opts.zone),
  };
  if (opts.latch !== undefined) m.latch = opts.latch;
  if (opts.latchFrames !== undefined && opts.latchFrames > 0) {
    m.latchFrames = Math.floor(opts.latchFrames);
  }
  if (opts.materialFilter && opts.materialFilter.length > 0) {
    m.materialFilter = opts.materialFilter.slice(0, 8);
  }
  list.push(m);
  if (world.inBounds(x, y)) {
    const i = world.idx(x, y);
    world.replaceCellAt(i, Cell.Metal, packRGB(72, 132, 128));
    m.body = [[x, y]];
  }
  return m;
}

/**
 * COUNTERWEIGHT: a weight pan that latches PERMANENTLY once enough material
 * mass has been poured into its zone — the readable bridge between material
 * motion and mechanism motion. Pure cell mass, like the scale: bodies don't
 * count, only what stays poured.
 */
export function makeCounterweight(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  w: number,
  threshold: number,
  target?: Mechanism | null,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'counterweight',
    x,
    y,
    w,
    h: 1,
    state: 0,
    targetId: target ? target.id : -1,
    threshold,
    zone: clampZone({ x0: x, y0: y - 7, x1: x + w - 1, y1: y - 1 }),
  };
  list.push(m);
  const body: Array<[number, number]> = [];
  // the bucket: a dark iron pan with raised lips (reads heavier than a scale)
  for (let dx = 0; dx < w; dx++) {
    if (world.inBounds(x + dx, y)) {
      const i = world.idx(x + dx, y);
      world.replaceCellAt(i, Cell.Metal, packRGB(96, 88, 74));
      body.push([x + dx, y]);
    }
  }
  for (const dx of [-1, w]) {
    for (let dy = 0; dy <= 3; dy++) {
      if (world.inBounds(x + dx, y - dy)) {
        const i = world.idx(x + dx, y - dy);
        world.replaceCellAt(i, Cell.Metal, packRGB(84, 78, 66));
        body.push([x + dx, y - dy]);
      }
    }
  }
  m.body = body;
  return m;
}

/**
 * ONE-SHOT RELAY: aggregates its inputs like a door, waits delayFrames, then
 * fires ONCE and latches — from then on it counts as a satisfied trigger for
 * its own single output (targetId). outputAction adds a world effect at the
 * target on fire. Its small footing follows the standard fail-open watch:
 * a destroyed relay eventually counts as fired.
 */
export function makeRelay(
  list: Mechanism[],
  x: number,
  y: number,
  opts?: {
    delayFrames?: number;
    outputAction?: NonNullable<Mechanism['outputAction']>;
    logic?: 'and' | 'or' | 'sequence';
  },
  target?: Mechanism | null,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'relay',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: target ? target.id : -1,
    body: [
      [x - 1, y + 1],
      [x, y + 1],
      [x + 1, y + 1],
    ],
  };
  if (opts?.delayFrames !== undefined && opts.delayFrames > 0) {
    m.delayFrames = Math.floor(opts.delayFrames);
  }
  if (opts?.outputAction !== undefined && opts.outputAction !== 'activate') {
    m.outputAction = opts.outputAction;
  }
  if (opts?.logic === 'or' || opts?.logic === 'sequence') m.logic = opts.logic;
  list.push(m);
  return m;
}

/**
 * DISPENSER: an ACTUATOR (linked triggers point at it, like a door). While its
 * triggers are satisfied it emits a rigid body of random size/material from its
 * mouth every `cooldown` frames, keeping at most `maxActive` alive (oldest
 * despawned) so it can never flood the sim. A reusable level primitive — the
 * seed for conveyors/crushers/fans later.
 */
export function makeDispenser(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  opts?: { cooldown?: number; maxActive?: number },
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'dispenser',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: -1,
    dispCooldown: Math.max(4, Math.floor(opts?.cooldown ?? 24)),
    dispMax: Math.max(1, Math.floor(opts?.maxActive ?? 8)),
  };
  list.push(m);
  // A metal hopper funnel converging to a mouth at (x, y); bodies drop from just
  // below it. The body doubles as the fail-open footprint (wreck it → it stops).
  const body: Array<[number, number]> = [];
  const place = (cx: number, cy: number): void => {
    if (!world.inBounds(cx, cy)) return;
    const i = world.idx(cx, cy);
    world.replaceCellAt(i, Cell.Metal, packRGB(120, 122, 138));
    body.push([cx, cy]);
  };
  for (let d = 0; d <= 4; d++) {
    place(x - 5 + d, y - 5 + d); // left funnel wall
    place(x + 5 - d, y - 5 + d); // right funnel wall
  }
  m.body = body;
  return m;
}

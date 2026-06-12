import type { Ctx, Mechanism, MechanismsApi } from '@/core/types';
import { hash2 } from '@/core/math';
import { blocksEntity, Cell, isGas, isLiquid } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, fireColor, packRGB, stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';

/**
 * Mechanisms (upgrade-port meta layer): metal doors driven by pressure plates,
 * levers, and fire braziers, plus rune vaults — sealed strongrooms whose stone
 * doors dissolve when a distant rune glyph is struck. Everything obeys the one
 * commandment: doors are real Metal cells, plates weigh real cells and bodies,
 * braziers want real fire, and rune strikes arrive via the structureStrike
 * event from real explosions / projectile impacts / dig hits.
 */

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
        if (occupied) continue;
        world.types[i] = Cell.Metal;
        // rune-tinted metal so sealed doors read as mechanisms, not plain plate
        const rs = 0.85 + hash2(X, Y, 311) * 0.3;
        world.colors[i] = packRGB(Math.floor(96 * rs), Math.floor(108 * rs), Math.floor(142 * rs));
      }
    }
  }
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
      world.types[i] = Cell.Metal;
      world.colors[i] = packRGB(148, 132, 70);
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
      world.types[i] = Cell.Stone;
      world.colors[i] = stoneColor();
      body.push([x + dx, y]);
    }
  }
  for (const dx of [-2, 2]) {
    if (world.inBounds(x + dx, y - 1)) {
      const i = world.idx(x + dx, y - 1);
      world.types[i] = Cell.Stone;
      world.colors[i] = stoneColor();
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
      world.types[i] = Cell.Metal;
      world.colors[i] = packRGB(168, 142, 64);
      body.push([x + dx, y]);
    }
  }
  for (const dx of [-1, w]) {
    for (let dy = 0; dy <= 2; dy++) {
      if (world.inBounds(x + dx, y - dy)) {
        const i = world.idx(x + dx, y - dy);
        world.types[i] = Cell.Metal;
        world.colors[i] = packRGB(148, 126, 58);
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
      world.types[i] = Cell.Metal;
      world.colors[i] = packRGB(104, 116, 132);
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
      if (occupied) continue;
      const i = world.idx(X, Y);
      world.types[i] = mat;
      if (mat === Cell.Metal) {
        // mechanism-tinted metal, like doors — a gate, not plain plate
        const rs = 0.85 + hash2(X, Y, 173) * 0.3;
        world.colors[i] = packRGB(Math.floor(110 * rs), Math.floor(104 * rs), Math.floor(86 * rs));
      } else {
        world.colors[i] = fn ? fn() : EMPTY_COLOR;
      }
      world.life[i] = 0;
      world.charge[i] = 0;
    }
  }
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
      world.types[i] = material;
      world.colors[i] = fn ? fn() : EMPTY_COLOR;
      world.life[i] = 0;
      world.charge[i] = 0;
      body.push([X, Y]);
    }
  }
  m.body = body;
  return m;
}

/** Hard cap on sensor/counterweight zone area (malformed prefabs must not
 *  buy themselves giant per-frame scans). */
export const SENSOR_ZONE_CAP = 1600; // 40x40

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
 * advanced authoring. Stamps no cells (no body — it cannot break).
 */
export function makeSensor(
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
      world.types[i] = Cell.Metal;
      world.colors[i] = packRGB(96, 88, 74);
      body.push([x + dx, y]);
    }
  }
  for (const dx of [-1, w]) {
    for (let dy = 0; dy <= 3; dy++) {
      if (world.inBounds(x + dx, y - dy)) {
        const i = world.idx(x + dx, y - dy);
        world.types[i] = Cell.Metal;
        world.colors[i] = packRGB(84, 78, 66);
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

/* ---------------- the runtime system ---------------- */

export class Mechanisms implements MechanismsApi {
  constructor(private ctx: Ctx) {
    // Explosions / projectile impacts / dig hits all announce themselves here.
    ctx.events.on('structureStrike', ({ x, y, radius }) => this.strike(this.ctx, x, y, radius));
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.state.paused) return;
    const runtime = ctx.levels.current;
    if (!runtime) return;
    const world = ctx.world;
    const list = runtime.mechanisms;

    // ---- 1) Each sensor reads the raw grid ----
    for (const m of list) {
      if (m.kind === 'door') continue;

      // Fail-open rule: a wrecked mechanism groans, then its gate falls open.
      // Physics can never hard-lock progression. Plugs are exempt: their
      // body being destroyed is their JOB — the plug branch below fires them.
      if (m.kind !== 'plug' && m.broken === undefined && m.body && ctx.state.frameCount % 30 === 0) {
        let intact = 0;
        for (const [bx, by] of m.body) {
          if (!world.inBounds(bx, by)) continue;
          const t = world.types[world.idx(bx, by)];
          if (t === Cell.Metal || t === Cell.Stone || blocksEntity(t)) intact++;
        }
        if (intact < m.body.length / 2) {
          m.broken = 1800; // 30 seconds of groaning
          ctx.audio.groan();
          ctx.events.emit('toast', { text: 'THE MECHANISM GROANS — SOMETHING GIVES WAY' });
        }
      }
      if (m.broken !== undefined && m.broken > 0) {
        m.broken--;
        if (m.broken % 360 === 0) {
          ctx.audio.groan();
          ctx.particles.burst(m.x, m.y - 3, 4, null, () => packRGB(130, 95, 80), 0.6, {
            grav: 0.06,
          });
        }
        if (m.broken === 0) {
          ctx.events.emit('toast', { text: 'THE BROKEN GATE FALLS OPEN' });
        }
        continue; // a dying mechanism no longer senses
      }
      if (m.broken === 0) continue;

      if (m.kind === 'lever') {
        // hand-pull in progress: the arm sweeps, then the flip lands
        if (m.pullT !== undefined && m.pullT > 0) {
          m.pullT--;
          if (m.pullT === 0) this.flipLever(ctx, m);
        }
      } else if (m.kind === 'plate') {
        const was = m.pressed === true;
        m.pressed = this.sensePlate(ctx, m);
        if (m.pressed) m.state = 420; // stays open ~7s after weight lifts
        else if (m.state > 0) m.state--;
        if (m.pressed && !was) {
          ctx.audio.tone(140, 90, 0.1, 'square', 0.14);
          ctx.particles.burst(m.x + m.w / 2, m.y - 1, 3, null, () => packRGB(190, 160, 80), 0.45, {
            grav: 0.04,
          });
        }
      } else if (m.kind === 'scale' && m.zone) {
        // SAND SCALE: pure material weight in the pan — bodies don't count,
        // only what you pour or drop stays poured
        let weight = 0;
        for (let X = m.zone.x0; X <= m.zone.x1; X++) {
          for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
            if (!world.inBounds(X, Y)) continue;
            const t = world.types[world.idx(X, Y)];
            if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
          }
        }
        m.reading = weight;
        const enough = weight >= (m.threshold ?? 24);
        if (enough && m.state === 0) {
          ctx.audio.tone(180, 120, 0.14, 'square', 0.15);
          ctx.particles.burst(m.x + m.w / 2, m.y - 2, 4, null, () => packRGB(220, 170, 65), 0.55, {
            grav: 0.05,
            glow: 0.8,
          });
        }
        if (enough) m.state = 420;
        else if (m.state > 0) m.state--;
      } else if (m.kind === 'buoy' && m.zone) {
        // SLUICE: pooled liquid lifts the float
        let liquid = 0;
        for (let X = m.zone.x0; X <= m.zone.x1; X++) {
          for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
            if (!world.inBounds(X, Y)) continue;
            if (isLiquid(world.types[world.idx(X, Y)])) liquid++;
          }
        }
        m.reading = liquid;
        const afloat = liquid >= (m.threshold ?? 28);
        if (afloat && m.state === 0) {
          ctx.audio.bubble();
          ctx.particles.burst(m.x, m.y - 3, 5, null, () => packRGB(130, 205, 255), 0.6, {
            grav: -0.02,
            glow: 0.8,
          });
        }
        if (afloat) m.state = 600; // generous latch: pools drain slowly anyway
        else if (m.state > 0) m.state--;
      } else if (m.kind === 'chargelatch' && m.zone) {
        // CHARGE-LATCH: one spark anywhere in the zone latches it forever —
        // lightning, electrified water, even a conducting enemy's blood
        if (m.state === 0) {
          let charged = false;
          for (let X = m.zone.x0; X <= m.zone.x1 && !charged; X++) {
            for (let Y = m.zone.y0; Y <= m.zone.y1 && !charged; Y++) {
              if (world.inBounds(X, Y) && world.charge[world.idx(X, Y)] > 0) charged = true;
            }
          }
          if (charged) {
            m.state = 1;
            ctx.audio.zap();
            ctx.particles.burst(m.x, m.y - 3, 12, null, () => packRGB(120, 200, 255), 2.0, {
              glow: 2.4,
              grav: -0.01,
            });
            ctx.events.emit('toast', { text: 'THE COIL DRINKS THE SPARK — LATCHED' });
          }
        }
      } else if (m.kind === 'plug') {
        // A plug WANTS its body destroyed: when breakFrac of its recorded
        // cells are gone or TRANSFORMED — burned, dissolved, blasted, dug,
        // by any cause — it fires once. The material is the break profile.
        if (m.state === 0 && m.body && m.body.length > 0 && (ctx.state.frameCount + m.id) % 8 === 0) {
          const mat = m.material ?? Cell.Stone;
          let intact = 0;
          for (const [bx, by] of m.body) {
            if (world.inBounds(bx, by) && world.types[world.idx(bx, by)] === mat) intact++;
          }
          m.reading = intact;
          const frac = m.breakFrac ?? 0.5;
          if (intact <= m.body.length * (1 - frac)) this.breakPlug(ctx, m, false);
        }
      } else if (m.kind === 'sensor' && m.zone) {
        // GENERIC SENSOR: bounded zone read on a 4-frame cadence (staggered
        // by id); the latch covers the scan latency.
        const latch = m.latch ?? 'timed';
        if (!(latch === 'permanent' && m.state === 1)) {
          if ((ctx.state.frameCount + m.id) % 4 === 0) {
            m.reading = this.senseZone(ctx, m);
          }
          const hot = (m.reading ?? 0) >= (m.threshold ?? 8);
          const was = this.satisfied(m);
          if (latch === 'permanent') {
            if (hot) m.state = 1;
          } else if (latch === 'momentary') {
            // hold just long enough to bridge the scan cadence
            if (hot) m.state = 6;
            else if (m.state > 0) m.state--;
          } else {
            if (hot) m.state = m.latchFrames ?? 420;
            else if (m.state > 0) m.state--;
          }
          if (!was && this.satisfied(m)) {
            ctx.audio.tone(220, 110, 0.1, 'triangle', 0.12);
            ctx.particles.burst(m.x, m.y - 2, 4, null, () => packRGB(140, 220, 190), 0.5, {
              grav: 0.02,
              glow: 0.9,
            });
          }
        }
      } else if (m.kind === 'counterweight' && m.zone) {
        // COUNTERWEIGHT: pure material mass in the bucket — bodies don't
        // count, only what stays poured. Latches PERMANENTLY at threshold.
        if (m.state === 0 && (ctx.state.frameCount + m.id) % 4 === 0) {
          let weight = 0;
          for (let X = m.zone.x0; X <= m.zone.x1; X++) {
            for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
              if (!world.inBounds(X, Y)) continue;
              const t = world.types[world.idx(X, Y)];
              if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
            }
          }
          m.reading = weight;
          if (weight >= (m.threshold ?? 30)) {
            m.state = 1;
            ctx.audio.tone(150, 200, 0.18, 'square', 0.16);
            ctx.particles.burst(m.x + m.w / 2, m.y - 2, 6, null, () => packRGB(200, 170, 90), 0.7, {
              grav: 0.05,
              glow: 0.9,
            });
            ctx.events.emit('toast', { text: 'THE COUNTERWEIGHT SETTLES — SOMETHING SHIFTS' });
          }
        }
      } else if (m.kind === 'brazier') {
        if (m.state === 0) {
          // any flame in the bowl zone latches it permanently
          let lit = false;
          for (let dx = -1; dx <= 1 && !lit; dx++) {
            for (let dy = 1; dy <= 3 && !lit; dy++) {
              const X = m.x + dx,
                Y = m.y - dy;
              if (!world.inBounds(X, Y)) continue;
              const t = world.types[world.idx(X, Y)];
              if (t === Cell.Fire || t === Cell.Lava || t === Cell.Ember) lit = true;
            }
          }
          if (lit) {
            m.state = 1;
            ctx.audio.brazier();
            ctx.particles.burst(m.x, m.y - 3, 12, Cell.Fire, fireColor, 1.6, {
              glow: 2.2,
              grav: -0.02,
            });
            ctx.events.emit('toast', { text: 'A BRAZIER ROARS TO LIFE' });
          }
        } else if (ctx.state.frameCount % 6 === 0) {
          // keep it burning: re-seed a flame in the bowl
          const X = m.x + Math.floor(Math.random() * 3) - 1,
            Y = m.y - 1 - Math.floor(Math.random() * 2);
          if (world.inBounds(X, Y) && world.types[world.idx(X, Y)] === Cell.Empty) {
            const i = world.idx(X, Y);
            world.types[i] = Cell.Fire;
            world.life[i] = 18 + Math.floor(Math.random() * 22);
            world.colors[i] = fireColor();
          }
        }
      }
    }

    // ---- 2) Actuators aggregate their triggers: doors, valves, and relays
    //         all read the things whose targetId points at them (default
    //         AND; Burning Seals wires three braziers to one gate). Broken
    //         triggers count as satisfied once their groan timer runs out.
    for (const door of list) {
      if (door.kind === 'valve') {
        this.updateValve(ctx, door, list);
        continue;
      }
      if (door.kind === 'relay') {
        this.updateRelay(ctx, door, list);
        continue;
      }
      if (door.kind !== 'door') continue;

      // Door retraction in progress: the gate slides up, 6 cells a frame,
      // dust shaking off the rising edge.
      if (door.dissolve && door.dissolve.length > 0) {
        for (let n = 0; n < 6 && door.dissolve.length; n++) {
          const [X, Y] = door.dissolve.pop()!;
          if (!world.inBounds(X, Y)) continue;
          const i = world.idx(X, Y);
          if (world.types[i] === Cell.Metal) {
            world.types[i] = Cell.Empty;
            world.colors[i] = EMPTY_COLOR;
            if (Math.random() < 0.25) {
              ctx.particles.spawn(
                X,
                Y,
                (Math.random() - 0.5) * 0.8,
                -0.3 - Math.random() * 0.5,
                null,
                packRGB(150, 160, 180),
                26,
                { glow: 1.0, grav: 0.05 },
              );
            }
          }
        }
        if (door.dissolve.length === 0) door.dissolve = undefined;
      }

      // Gather this door's triggers in LIST ORDER (sequence doors read it).
      const triggers: Mechanism[] = [];
      for (const t of list) {
        if (t.kind !== 'door' && t.targetId === door.id) triggers.push(t);
      }
      const hasTrigger = triggers.length > 0;
      const want = hasTrigger && this.aggregateWant(ctx, door, triggers);
      if (hasTrigger && (door.state === 1) !== want) {
        if (want) {
          // The circuit closes: a spark races from each satisfied trigger to
          // its gate — the wiring teaches itself.
          for (const t of list) {
            if (t.kind === 'door' || t.targetId !== door.id) continue;
            this.sparkLine(ctx, t.x, t.y - 2, door.x + door.w / 2, door.y + door.h / 2);
          }
        }
        setDoorCells(ctx, door, want);
        ctx.audio.doorGrind();
      }
    }

    // Rune vaults: dissolve struck doors bottom-up, a few cells per frame
    for (const v of runtime.runeVaults) {
      if (!v.active || v.door.length === 0) continue;
      for (let n = 0; n < 3 && v.door.length; n++) {
        const cell = v.door.pop()!;
        const [dx2, dy2] = cell;
        if (world.inBounds(dx2, dy2) && world.types[world.idx(dx2, dy2)] === Cell.Stone) {
          const i = world.idx(dx2, dy2);
          world.types[i] = Cell.Empty;
          world.colors[i] = EMPTY_COLOR;
          ctx.particles.spawn(
            dx2,
            dy2,
            (Math.random() - 0.5) * 1.4,
            -0.8 - Math.random(),
            null,
            packRGB(160, 255, 190),
            26,
            { glow: 1.8, grav: 0.02 },
          );
        }
      }
      if (v.door.length === 0) ctx.audio.tone(520, 300, 0.3, 'triangle', 0.12);
    }

    // Builder hazard emitters: drip `burst` real cells on their cadence —
    // the grid does the rest (lava pools, acid eats, water floods). The
    // drip lands one step along `dir` (the object's rotation: 0=down,
    // 90=left, 180=up, 270=right); `phase` staggers banks of emitters.
    if (runtime.emitters) {
      for (const em of runtime.emitters) {
        if ((ctx.state.frameCount + em.phase) % em.rate !== 0) continue;
        const dx = em.dir === 90 ? -1 : em.dir === 270 ? 1 : 0;
        const dy = em.dir === 180 ? -1 : em.dir === 0 ? 1 : 0;
        for (let k = 1; k <= em.burst; k++) {
          const X = em.x + dx * k,
            Y = em.y + dy * k;
          if (!world.inBounds(X, Y)) break;
          const i = world.idx(X, Y);
          if (world.types[i] !== Cell.Empty) continue;
          world.types[i] = em.cell;
          const fn = COLOR_FN[em.cell];
          world.colors[i] = fn ? fn() : EMPTY_COLOR;
          if (em.cell === Cell.Fire) world.life[i] = 15 + Math.floor(Math.random() * 30);
          else if (em.cell === Cell.Smoke) world.life[i] = 30 + Math.floor(Math.random() * 40);
        }
      }
    }
  }

  /**
   * One actuator's trigger aggregation (doors, valves, relays — extracted
   * verbatim from the door loop; sequence state lives on the actuator).
   */
  private aggregateWant(ctx: Ctx, actuator: Mechanism, triggers: Mechanism[]): boolean {
    let want = false;
    if (actuator.logic === 'or') {
      // ANY satisfied trigger opens (and it closes again when none are)
      want = triggers.some((t) => this.satisfied(t));
    } else if (actuator.logic === 'sequence') {
      // Triggers must FIRE IN ORDER, judged on RISING EDGES — a trigger
      // that merely STAYS satisfied (plate latch, lingering pour) never
      // re-fires the chain. Fail-open holds per step: a fully broken
      // trigger auto-completes its slot (all broken = the chain itself
      // fails open). Completion latches the door open forever.
      if (actuator.seqDone !== true) {
        const chain = triggers.filter((t) => t.broken !== 0);
        // Completion is tracked BY IDENTITY: the cursor is derived each
        // frame as the first chain member not yet fired, so a wrecked
        // trigger collapses its slot whether it sat ahead of the cursor
        // (auto-completes) or behind it (already fired, simply gone).
        const fired = (actuator.seqFired ??= {});
        let cursor = 0;
        while (cursor < chain.length && fired[chain[cursor].id] === true) cursor++;
        if (cursor >= chain.length) {
          actuator.seqDone = true; // includes the every-step-wrecked chain
        } else {
          const prev = (actuator.seqPrev ??= {});
          const edges: boolean[] = [];
          for (const t of chain) {
            const sat = this.satisfied(t);
            edges.push(sat && prev[t.id] !== true);
            prev[t.id] = sat;
          }
          if (edges[cursor]) {
            fired[chain[cursor].id] = true;
            cursor++;
            ctx.audio.tone(300 + cursor * 90, 110, 0.1, 'triangle', 0.12); // step chime
            if (cursor >= chain.length) actuator.seqDone = true;
          } else if (edges.some((e, n) => e && n > cursor)) {
            // The chain breaks: forget all progress and spit the
            // resettable mechanisms back out so the player can retry at
            // once. (Braziers/charge latches can never un-fire — the
            // Builder validator refuses to wire them into sequences.)
            for (const k of Object.keys(fired)) delete fired[Number(k)];
            cursor = 0;
            for (const t of chain) {
              if (t.kind === 'plate' || t.kind === 'scale' || t.kind === 'buoy' || t.kind === 'lever') {
                t.state = 0;
                if (t.kind === 'plate') t.pressed = false;
              }
            }
            ctx.audio.tone(120, 200, 0.14, 'sawtooth', 0.1); // sour break
          }
          actuator.seq = cursor; // derived, for HUD/probes
        }
      }
      want = actuator.seqDone === true;
    } else {
      // default AND: every trigger must be satisfied (generated levels)
      want = true;
      for (const t of triggers) {
        if (!this.satisfied(t)) {
          want = false;
          break;
        }
      }
    }
    return want;
  }

  /**
   * VALVE actuator update: tick its retraction, aggregate its triggers like
   * a door, honor oneShot / autoClose. A valve with no triggers is inert
   * (Builder validation flags it).
   */
  private updateValve(ctx: Ctx, m: Mechanism, list: Mechanism[]): void {
    // retraction in progress: the gate slides away, 4 cells a frame
    if (m.dissolve && m.dissolve.length > 0) {
      const world = ctx.world;
      const mat = m.material ?? Cell.Metal;
      for (let n = 0; n < 4 && m.dissolve.length; n++) {
        const [X, Y] = m.dissolve.pop()!;
        if (!world.inBounds(X, Y)) continue;
        const i = world.idx(X, Y);
        if (world.types[i] === mat) {
          world.types[i] = Cell.Empty;
          world.colors[i] = EMPTY_COLOR;
          if (Math.random() < 0.25) {
            ctx.particles.spawn(
              X,
              Y,
              (Math.random() - 0.5) * 0.7,
              -0.2 - Math.random() * 0.4,
              null,
              packRGB(150, 145, 125),
              22,
              { glow: 0.8, grav: 0.05 },
            );
          }
        }
      }
      if (m.dissolve.length === 0) m.dissolve = undefined;
    }

    const triggers: Mechanism[] = [];
    for (const t of list) {
      if (t !== m && t.kind !== 'door' && t.targetId === m.id) triggers.push(t);
    }
    if (triggers.length === 0) return;
    const want = this.aggregateWant(ctx, m, triggers);
    const rising = want && m.prevWant !== true;
    m.prevWant = want;

    if (m.state === 1) {
      if (m.oneShot === true) return; // stays open once fired
      if (m.closeT !== undefined) {
        // timed valve: force-close when the timer runs out; it reopens only
        // on a FRESH rising edge (a lingering latched trigger must not
        // bounce it straight open again)
        m.closeT--;
        if (m.closeT <= 0) {
          m.closeT = undefined;
          setValveCells(ctx, m, false);
          ctx.audio.doorGrind();
        }
        return;
      }
      if (!want) {
        setValveCells(ctx, m, false);
        ctx.audio.doorGrind();
      }
    } else {
      const timed = m.autoCloseFrames !== undefined && m.autoCloseFrames > 0;
      if (timed ? rising : want) {
        for (const t of triggers) {
          if (this.satisfied(t)) this.sparkLine(ctx, t.x, t.y - 2, m.x + m.w / 2, m.y + m.h / 2);
        }
        setValveCells(ctx, m, true);
        ctx.audio.doorGrind();
      }
    }
  }

  /**
   * RELAY actuator update: inputs satisfied -> arm the fuse -> fire ONCE.
   * A fired relay (state 1) counts as a satisfied trigger for its own
   * target; a destroyed relay reaches the same state through the generic
   * fail-open watch (broken 0 = satisfied).
   */
  private updateRelay(ctx: Ctx, m: Mechanism, list: Mechanism[]): void {
    if (m.state === 1) return; // fired forever
    if (m.broken !== undefined) return; // groaning/dead: the watch owns it
    if (m.fuseT === undefined) {
      const triggers: Mechanism[] = [];
      for (const t of list) {
        if (t !== m && t.kind !== 'door' && t.targetId === m.id) triggers.push(t);
      }
      if (triggers.length === 0) return;
      if (this.aggregateWant(ctx, m, triggers)) {
        m.fuseT = Math.max(0, Math.floor(m.delayFrames ?? 0));
        if (m.fuseT > 0) ctx.audio.tone(260, 90, 0.08, 'triangle', 0.1); // armed tick
      }
    }
    if (m.fuseT !== undefined) {
      if (m.fuseT > 0) {
        m.fuseT--;
        return;
      }
      this.fireRelay(ctx, m, list);
    }
  }

  /** The relay fires: latch, spark toward the target, run the output action. */
  private fireRelay(ctx: Ctx, m: Mechanism, list: Mechanism[]): void {
    m.state = 1;
    m.fuseT = undefined;
    ctx.audio.tone(420, 140, 0.12, 'triangle', 0.14);
    ctx.particles.burst(m.x, m.y - 2, 8, null, () => packRGB(255, 196, 90), 1.4, {
      glow: 1.8,
      grav: 0,
    });
    const target = list.find((t) => t.id === m.targetId);
    const tx = target ? Math.floor(target.x + target.w / 2) : m.x;
    const ty = target ? Math.floor(target.y + target.h / 2) : m.y;
    if (target) this.sparkLine(ctx, m.x, m.y - 2, tx, ty);
    const action = m.outputAction ?? 'activate';
    if (action === 'ignite') {
      // seed real Fire in a small disc at the target — the grid takes over
      const world = ctx.world;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue;
          const X = tx + dx,
            Y = ty + dy;
          if (!world.inBounds(X, Y)) continue;
          const i = world.idx(X, Y);
          if (world.types[i] !== Cell.Empty) continue;
          world.types[i] = Cell.Fire;
          world.life[i] = 18 + Math.floor(Math.random() * 24);
          world.colors[i] = fireColor();
        }
      }
    } else if (action === 'strike') {
      // a concussive pulse: flips levers, wakes rune glyphs (event round-trip)
      ctx.events.emit('structureStrike', { x: tx, y: ty, radius: 8 });
    } else if (action === 'break') {
      if (target && target.kind === 'plug') this.breakPlug(ctx, target, true);
    }
  }

  /**
   * The plug fires (once): latch and announce. `demolish` (relay 'break')
   * also clears its remaining cells into debris — a detonated seal; a plug
   * whose cells the WORLD destroyed keeps whatever survivors remain.
   */
  private breakPlug(ctx: Ctx, m: Mechanism, demolish: boolean): void {
    if (m.state === 1) return;
    m.state = 1;
    const world = ctx.world;
    const mat = m.material ?? Cell.Stone;
    const fn = COLOR_FN[mat];
    if (demolish && m.body) {
      for (const [bx, by] of m.body) {
        if (!world.inBounds(bx, by)) continue;
        const i = world.idx(bx, by);
        if (world.types[i] !== mat) continue;
        world.types[i] = Cell.Empty;
        world.colors[i] = EMPTY_COLOR;
        if (Math.random() < 0.3) {
          ctx.particles.spawn(
            bx,
            by,
            (Math.random() - 0.5) * 1.2,
            -0.4 - Math.random() * 0.8,
            null,
            fn ? fn() : packRGB(150, 150, 150),
            24,
            { grav: 0.06 },
          );
        }
      }
    }
    ctx.audio.tone(140, 220, 0.16, 'sawtooth', 0.14);
    ctx.particles.burst(m.x + m.w / 2, m.y + m.h / 2, 8, null, () => packRGB(180, 150, 110), 1.2, {
      grav: 0.05,
    });
    ctx.events.emit('toast', { text: 'A SEAL GIVES WAY' });
  }

  /** One bounded sensor-zone read (the sensorType decides what counts). */
  private senseZone(ctx: Ctx, m: Mechanism): number {
    const world = ctx.world;
    const z = m.zone!;
    const type = m.sensorType ?? 'weight';
    const filter = m.materialFilter;
    let n = 0;
    for (let Y = z.y0; Y <= z.y1; Y++) {
      for (let X = z.x0; X <= z.x1; X++) {
        if (!world.inBounds(X, Y)) continue;
        const i = world.idx(X, Y);
        const t = world.types[i];
        if (type === 'heat') {
          if (t === Cell.Fire || t === Cell.Lava || t === Cell.Ember) n++;
        } else if (type === 'liquid') {
          if (isLiquid(t) && (!filter || filter.length === 0 || filter.includes(t))) n++;
        } else if (type === 'weight') {
          if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) n++;
        } else if (type === 'charge') {
          if (world.charge[i] > 0) n++;
        } else if (filter && filter.includes(t)) {
          n++; // 'material': exact cell-id census
        }
      }
    }
    return n;
  }

  /** A line of staggered amber sparks from trigger to gate (one-shot). */
  private sparkLine(ctx: Ctx, x0: number, y0: number, x1: number, y1: number): void {
    const steps = 12;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      ctx.particles.spawn(
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t,
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2,
        null,
        packRGB(252, 211, 77),
        10 + k * 2, // staggered lifetimes: the spark visibly TRAVELS
        { glow: 2.0, grav: 0 },
      );
    }
  }

  /** One trigger's contribution to its door (fail-open: broken = satisfied). */
  private satisfied(t: Mechanism): boolean {
    if (t.broken === 0) return true;
    if (t.broken !== undefined) return false; // still groaning
    switch (t.kind) {
      case 'lever':
      case 'brazier':
      case 'chargelatch':
      // machine triggers that latch by firing once:
      case 'plug':
      case 'counterweight':
      case 'relay':
        return t.state === 1;
      case 'plate':
        return t.pressed === true || t.state > 0;
      case 'scale':
      case 'buoy':
      case 'sensor': // latch-mode countdown or permanent 1 — both are > 0
        return t.state > 0;
      default:
        return false;
    }
  }

  /** Weight on the rows just above the sill — terrain, liquids, bodies. */
  private sensePlate(ctx: Ctx, m: Mechanism): boolean {
    const world = ctx.world;
    let weight = 0;
    for (let dx = 0; dx < m.w; dx++) {
      for (let dyy = 1; dyy <= 2; dyy++) {
        const X = m.x + dx,
          Y = m.y - dyy;
        if (!world.inBounds(X, Y)) continue;
        const t = world.types[world.idx(X, Y)];
        if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
      }
    }
    const player = ctx.player;
    if (
      player.y >= m.y - 3 &&
      player.y <= m.y + 1 &&
      player.x + 4 >= m.x &&
      player.x - 4 <= m.x + m.w
    )
      weight += 4;
    for (const e of ctx.enemies) {
      const def = ctx.enemyCtl.defs[e.kind];
      if (e.y >= m.y - 3 && e.y <= m.y + 1 && e.x + def.halfW >= m.x && e.x - def.halfW <= m.x + m.w)
        weight += 4;
    }
    return weight >= 3;
  }

  strike(ctx: Ctx, x: number, y: number, radius: number): void {
    const runtime = ctx.levels.current;
    if (!runtime) return;
    // Concussion flips nearby levers — explosions are valid puzzle inputs
    for (const m of runtime.mechanisms) {
      if (m.kind !== 'lever') continue;
      if (m.pullT !== undefined && m.pullT > 0) continue; // a hand is on it
      const ddx = m.x - x,
        ddy = m.y - y;
      if (ddx * ddx + ddy * ddy <= (radius + 6) * (radius + 6)) this.flipLever(ctx, m);
    }
    // Rune glyphs answer to any strike
    for (const v of runtime.runeVaults) {
      if (v.active) continue;
      const dx = v.rx - x,
        dy = v.ry - y;
      if (dx * dx + dy * dy <= radius * radius) {
        v.active = true;
        ctx.events.emit('toast', { text: 'ANCIENT RUNE STRUCK — A VAULT RUMBLES OPEN' });
        ctx.audio.tone(220, 500, 0.5, 'sine', 0.18);
        setTimeout(() => ctx.audio.tone(330, 400, 0.4, 'sine', 0.14), 240);
        ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.012, 0.05);
        ctx.particles.burst(v.rx, v.ry, 18, null, () => packRGB(140, 255, 180), 2.6, {
          glow: 2.6,
          grav: -0.01,
        });
      }
    }
  }

  interact(ctx: Ctx): boolean {
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play' || ctx.player.dead) return false;
    if (ctx.player.pullT > 0) return true; // already mid-pull
    for (const m of runtime.mechanisms) {
      if (m.kind !== 'lever' || m.broken !== undefined) continue;
      const dx = m.x - ctx.player.x,
        dy = m.y - 3 - (ctx.player.y - 9);
      if (dx * dx + dy * dy < 22 * 22) {
        // An INTENTIONAL pull: the alchemist plants, grips, and drives the
        // arm across (~half a second). The flip lands when the pull completes
        // (see update); a hand on iron, not a tap on a button.
        m.pullT = 26;
        ctx.player.pullT = 26;
        ctx.player.pullDir = Math.sign(m.x - ctx.player.x) || 1;
        ctx.player.facing = ctx.player.pullDir;
        ctx.audio.tone(180, 140, 0.08, 'square', 0.08); // the grip
        return true;
      }
    }
    // The Refuge's offering shrine: kneel and trade. Shop only — boons are
    // bargained at the portal between depths.
    const shrine = runtime.refuge;
    if (shrine) {
      const dx = shrine.x - ctx.player.x,
        dy = shrine.y - (ctx.player.y - 4);
      if (dx * dx + dy * dy < 16 * 16) {
        ctx.audio.tone(660, 220, 0.18, 'triangle', 0.1);
        ctx.sanctum.openShop(ctx);
        return true;
      }
    }
    return false;
  }

  private flipLever(ctx: Ctx, m: Mechanism): void {
    m.state = m.state === 1 ? 0 : 1;
    ctx.audio.lever();
    ctx.particles.burst(m.x, m.y - 3, 6, null, () => packRGB(255, 210, 110), 1.2, {
      glow: 1.8,
      grav: 0.02,
    });
  }
}

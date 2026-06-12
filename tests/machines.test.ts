import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx, Mechanism } from '@/core/types';
import { EventBus } from '@/core/events';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import {
  Mechanisms,
  SENSOR_ZONE_CAP,
  makeCounterweight,
  makeDoor,
  makeLever,
  makePlug,
  makeRelay,
  makeSensor,
  makeValve,
} from '@/game/Mechanisms';

/**
 * Machine primitive contracts (docs/MACHINE-PRIMITIVES-AND-STRUCTURES-PLAN.md):
 * valves aggregate triggers like doors, plugs fire once when their body is
 * destroyed, sensors read bounded zones with latch modes, counterweights
 * latch permanently at threshold, relays hand off one-shot with delay.
 * Everything runs against a real World grid through Mechanisms.update —
 * no sim substeps, just the mechanism pass.
 */

function makeCtx(): { ctx: Ctx; list: Mechanism[]; world: World; toasts: string[] } {
  const world = new World();
  const events = new EventBus();
  const list: Mechanism[] = [];
  const toasts: string[] = [];
  events.on('toast', ({ text }) => toasts.push(text));
  const noop = (): void => undefined;
  const ctx = {
    world,
    events,
    enemies: [],
    player: { x: -500, y: -500, dead: false, pullT: 0, pullDir: 1, facing: 1 },
    state: { mode: 'play', paused: false, frameCount: 1, currentBiome: 'earthen' },
    audio: {
      tone: noop, groan: noop, zap: noop, bubble: noop, brazier: noop,
      lever: noop, doorGrind: noop, boom: noop,
    },
    particles: { spawn: noop, burst: noop, clear: noop },
    enemyCtl: { defs: {} },
    levels: { current: { mechanisms: list, runeVaults: [], emitters: [] } },
    fx: { screenShake: 0 },
  } as unknown as Ctx;
  return { ctx, list, world, toasts };
}

function step(ctx: Ctx, mech: Mechanisms, n: number): void {
  for (let i = 0; i < n; i++) {
    ctx.state.frameCount++;
    mech.update(ctx);
  }
}

/** Stamp stone footing under a point mechanism (levers/relays watch their
 *  body cells — placed in empty air they'd correctly groan and fail open). */
function foot(world: World, x: number, y: number): void {
  for (let dx = -1; dx <= 1; dx++) {
    const i = world.idx(x + dx, y + 1);
    world.types[i] = Cell.Stone;
  }
}

function placeLever(h2: { world: World; list: Mechanism[] }, x: number, y: number, target: Mechanism): Mechanism {
  foot(h2.world, x, y);
  return makeLever(h2.list, x, y, target);
}

function placeRelay(
  h2: { world: World; list: Mechanism[] },
  x: number,
  y: number,
  opts: Parameters<typeof makeRelay>[3],
  target: Mechanism | null,
): Mechanism {
  foot(h2.world, x, y);
  return makeRelay(h2.list, x, y, opts, target);
}

function countCells(world: World, x0: number, y0: number, x1: number, y1: number, t: number): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (world.inBounds(x, y) && world.types[world.idx(x, y)] === t) n++;
    }
  }
  return n;
}

let h: ReturnType<typeof makeCtx>;
let mech: Mechanisms;
beforeEach(() => {
  h = makeCtx();
  mech = new Mechanisms(h.ctx);
});

describe('valve', () => {
  it('closed valve stamps its material; an opened valve retracts it', () => {
    const valve = makeValve(h.ctx, h.list, 100, 100, 4, 3, { material: Cell.Stone });
    expect(countCells(h.world, 100, 100, 103, 102, Cell.Stone)).toBe(12);
    const lever = placeLever(h, 90, 110, valve);
    lever.state = 1;
    step(h.ctx, mech, 10); // open + retract (4 cells/frame)
    expect(valve.state).toBe(1);
    expect(countCells(h.world, 100, 100, 103, 102, Cell.Stone)).toBe(0);
    lever.state = 0;
    step(h.ctx, mech, 2);
    expect(valve.state).toBe(0);
    expect(countCells(h.world, 100, 100, 103, 102, Cell.Stone)).toBe(12);
  });

  it('oneShot valves stay open after the trigger releases', () => {
    const valve = makeValve(h.ctx, h.list, 100, 100, 4, 2, { oneShot: true });
    const lever = placeLever(h, 90, 110, valve);
    lever.state = 1;
    step(h.ctx, mech, 6);
    lever.state = 0;
    step(h.ctx, mech, 30);
    expect(valve.state).toBe(1);
    expect(countCells(h.world, 100, 100, 103, 101, Cell.Metal)).toBe(0);
  });

  it('timed valves close on their own and need a fresh rising edge to reopen', () => {
    const valve = makeValve(h.ctx, h.list, 100, 100, 3, 2, { autoCloseFrames: 20 });
    const lever = placeLever(h, 90, 110, valve);
    lever.state = 1;
    step(h.ctx, mech, 3);
    expect(valve.state).toBe(1);
    step(h.ctx, mech, 25); // timer expires -> force close
    expect(valve.state).toBe(0);
    // lever is STILL on — a lingering latch must not bounce it back open
    step(h.ctx, mech, 30);
    expect(valve.state).toBe(0);
    lever.state = 0;
    step(h.ctx, mech, 2);
    lever.state = 1; // fresh edge
    step(h.ctx, mech, 3);
    expect(valve.state).toBe(1);
  });

  it('auto-close refuses to crush a body standing in the gap', () => {
    const valve = makeValve(h.ctx, h.list, 100, 100, 3, 4, { autoCloseFrames: 10 });
    const lever = placeLever(h, 90, 110, valve);
    lever.state = 1;
    step(h.ctx, mech, 6); // open
    h.ctx.player.x = 101;
    h.ctx.player.y = 103; // standing inside the channel
    step(h.ctx, mech, 12); // timer expires, valve restamps around the player
    expect(valve.state).toBe(0);
    expect(countCells(h.world, 100, 100, 102, 103, Cell.Metal)).toBe(0); // all columns within |x-player| <= 5
  });
});

describe('plug', () => {
  it('fires once when breakFrac of its body is destroyed, opening its target', () => {
    const door = makeDoor(h.ctx, h.list, 200, 100, 3, 10);
    const plug = makePlug(h.world, h.list, 100, 100, 4, 4, Cell.Wood, door);
    step(h.ctx, mech, 16);
    expect(plug.state).toBe(0);
    expect(door.state).toBe(0);
    // burn away 5 of 16 cells: below the 50% default -> still holding
    for (let i = 0; i < 5; i++) h.world.types[h.world.idx(100 + i, 100)] = Cell.Empty;
    step(h.ctx, mech, 16);
    expect(plug.state).toBe(0);
    // cross the line
    for (let y = 100; y < 102; y++) {
      for (let x = 100; x < 104; x++) h.world.types[h.world.idx(x, y)] = Cell.Empty;
    }
    step(h.ctx, mech, 16);
    expect(plug.state).toBe(1);
    expect(door.state).toBe(1);
    expect(h.toasts.filter((t) => t.includes('SEAL')).length).toBe(1);
    step(h.ctx, mech, 30); // never re-fires, never un-fires
    expect(plug.state).toBe(1);
    expect(h.toasts.filter((t) => t.includes('SEAL')).length).toBe(1);
  });

  it('transformed cells count as destroyed (wood that became fire is gone)', () => {
    const plug = makePlug(h.world, h.list, 100, 100, 3, 3, Cell.Wood, null);
    for (let y = 100; y < 103; y++) {
      for (let x = 100; x < 102; x++) h.world.types[h.world.idx(x, y)] = Cell.Fire;
    }
    step(h.ctx, mech, 16);
    expect(plug.state).toBe(1);
  });

  it('respects a custom breakFrac', () => {
    const plug = makePlug(h.world, h.list, 100, 100, 4, 1, Cell.Stone, null, 0.9);
    h.world.types[h.world.idx(100, 100)] = Cell.Empty;
    h.world.types[h.world.idx(101, 100)] = Cell.Empty;
    h.world.types[h.world.idx(102, 100)] = Cell.Empty;
    step(h.ctx, mech, 16);
    expect(plug.state).toBe(0); // 1 of 4 intact > (1 - 0.9) * 4
    h.world.types[h.world.idx(103, 100)] = Cell.Empty;
    step(h.ctx, mech, 16);
    expect(plug.state).toBe(1);
  });

  it('is exempt from the groan/fail-open watch', () => {
    const plug = makePlug(h.world, h.list, 100, 100, 4, 4, Cell.Wood, null);
    for (const [x, y] of plug.body!) h.world.types[h.world.idx(x, y)] = Cell.Empty;
    step(h.ctx, mech, 60);
    expect(plug.state).toBe(1);
    expect(plug.broken).toBeUndefined();
  });
});

describe('sensor', () => {
  it('heat sensor reads its zone and holds through the timed latch', () => {
    const door = makeDoor(h.ctx, h.list, 200, 100, 3, 10);
    const sensor = makeSensor(
      h.list,
      100,
      100,
      {
        sensorType: 'heat',
        threshold: 4,
        zone: { x0: 96, y0: 92, x1: 104, y1: 99 },
        latchFrames: 30,
      },
      door,
    );
    step(h.ctx, mech, 10);
    expect(door.state).toBe(0);
    for (let i = 0; i < 5; i++) h.world.types[h.world.idx(97 + i, 95)] = Cell.Fire;
    step(h.ctx, mech, 10);
    expect(sensor.state).toBeGreaterThan(0);
    expect(door.state).toBe(1);
    for (let i = 0; i < 5; i++) h.world.types[h.world.idx(97 + i, 95)] = Cell.Empty;
    step(h.ctx, mech, 60); // latch expires after ~30 frames
    expect(sensor.state).toBe(0);
    expect(door.state).toBe(0);
  });

  it('permanent charge sensor latches forever', () => {
    const sensor = makeSensor(h.list, 100, 100, {
      sensorType: 'charge',
      threshold: 1,
      zone: { x0: 98, y0: 96, x1: 102, y1: 99 },
      latch: 'permanent',
    });
    h.world.types[h.world.idx(100, 98)] = Cell.Metal;
    h.world.charge[h.world.idx(100, 98)] = 3;
    step(h.ctx, mech, 10);
    expect(sensor.state).toBe(1);
    h.world.charge[h.world.idx(100, 98)] = 0;
    step(h.ctx, mech, 30);
    expect(sensor.state).toBe(1);
  });

  it('material sensor counts only the filtered cells', () => {
    const sensor = makeSensor(h.list, 100, 100, {
      sensorType: 'material',
      threshold: 3,
      zone: { x0: 98, y0: 96, x1: 102, y1: 99 },
      materialFilter: [Cell.Sand],
      latchFrames: 20,
    });
    h.world.types[h.world.idx(99, 98)] = Cell.Stone;
    h.world.types[h.world.idx(100, 98)] = Cell.Stone;
    h.world.types[h.world.idx(101, 98)] = Cell.Stone;
    step(h.ctx, mech, 10);
    expect(sensor.state).toBe(0); // stone is not sand
    h.world.types[h.world.idx(99, 99)] = Cell.Sand;
    h.world.types[h.world.idx(100, 99)] = Cell.Sand;
    h.world.types[h.world.idx(101, 99)] = Cell.Sand;
    step(h.ctx, mech, 10);
    expect(sensor.state).toBeGreaterThan(0);
  });

  it('clamps oversized zones to the scan cap', () => {
    const sensor = makeSensor(h.list, 100, 100, {
      sensorType: 'weight',
      threshold: 10,
      zone: { x0: 0, y0: 0, x1: 800, y1: 600 },
    });
    const z = sensor.zone!;
    expect((z.x1 - z.x0 + 1) * (z.y1 - z.y0 + 1)).toBeLessThanOrEqual(SENSOR_ZONE_CAP);
  });
});

describe('counterweight', () => {
  it('latches permanently once enough mass stays poured', () => {
    const door = makeDoor(h.ctx, h.list, 200, 100, 3, 10);
    const cw = makeCounterweight(h.world, h.list, 100, 100, 7, 12, door);
    // a little sand: below threshold
    for (let i = 0; i < 6; i++) h.world.types[h.world.idx(100 + i, 99)] = Cell.Sand;
    step(h.ctx, mech, 10);
    expect(cw.state).toBe(0);
    expect(door.state).toBe(0);
    for (let i = 0; i < 7; i++) h.world.types[h.world.idx(100 + i, 98)] = Cell.Sand;
    step(h.ctx, mech, 10);
    expect(cw.state).toBe(1);
    expect(door.state).toBe(1);
    // scoop the sand back out — the latch holds (it already tipped)
    for (let y = 93; y <= 99; y++) {
      for (let x = 100; x <= 106; x++) h.world.types[h.world.idx(x, y)] = Cell.Empty;
    }
    step(h.ctx, mech, 30);
    expect(cw.state).toBe(1);
    expect(door.state).toBe(1);
  });
});

describe('relay', () => {
  it('waits its delay, fires once, and latches as a satisfied trigger', () => {
    const door = makeDoor(h.ctx, h.list, 200, 100, 3, 10);
    const relay = placeRelay(h, 150, 100, { delayFrames: 30 }, door);
    const lever = placeLever(h, 100, 100, relay);
    lever.state = 1;
    step(h.ctx, mech, 10);
    expect(relay.state).toBe(0); // fuse burning
    expect(door.state).toBe(0);
    step(h.ctx, mech, 30);
    expect(relay.state).toBe(1);
    step(h.ctx, mech, 2);
    expect(door.state).toBe(1);
    lever.state = 0; // input released — the relay never un-fires
    step(h.ctx, mech, 10);
    expect(relay.state).toBe(1);
    expect(door.state).toBe(1);
  });

  it("'ignite' seeds real fire near its target", () => {
    const plug = makePlug(h.world, h.list, 200, 100, 3, 3, Cell.Wood, null);
    const relay = placeRelay(h, 150, 100, { outputAction: 'ignite' }, plug);
    const lever = placeLever(h, 100, 100, relay);
    lever.state = 1;
    step(h.ctx, mech, 4);
    expect(relay.state).toBe(1);
    expect(countCells(h.world, 196, 96, 206, 106, Cell.Fire)).toBeGreaterThan(0);
  });

  it("'break' demolishes a target plug, which fires its own output", () => {
    const door = makeDoor(h.ctx, h.list, 300, 100, 3, 10);
    const plug = makePlug(h.world, h.list, 200, 100, 3, 3, Cell.Stone, door);
    const relay = placeRelay(h, 150, 100, { outputAction: 'break' }, plug);
    const lever = placeLever(h, 100, 100, relay);
    lever.state = 1;
    step(h.ctx, mech, 4);
    expect(plug.state).toBe(1);
    expect(countCells(h.world, 200, 100, 202, 102, Cell.Stone)).toBe(0);
    step(h.ctx, mech, 2);
    expect(door.state).toBe(1);
  });

  it("'strike' delivers a concussive pulse that flips nearby levers", () => {
    const relay = placeRelay(h, 150, 100, { outputAction: 'strike' }, null);
    const input = placeLever(h, 100, 100, relay);
    const bystander = placeLever(h, 154, 102, { id: 999 } as Mechanism);
    input.state = 1;
    step(h.ctx, mech, 4);
    expect(relay.state).toBe(1);
    expect(bystander.state).toBe(1); // struck
  });

  it('relays chain: one fired relay satisfies the next', () => {
    const door = makeDoor(h.ctx, h.list, 300, 100, 3, 10);
    const relayB = placeRelay(h, 200, 100, {}, door);
    const relayA = placeRelay(h, 150, 100, {}, relayB);
    const lever = placeLever(h, 100, 100, relayA);
    lever.state = 1;
    step(h.ctx, mech, 6); // one frame per hop is fine — the signal travels
    expect(relayA.state).toBe(1);
    expect(relayB.state).toBe(1);
    expect(door.state).toBe(1);
  });
});

describe('regressions: old mechanisms unchanged', () => {
  it('a brazier still latches from fire and opens its AND door', () => {
    const door = makeDoor(h.ctx, h.list, 200, 100, 3, 10);
    const brazier = h.list[h.list.length - 1];
    expect(brazier.kind).toBe('door');
    const m = makeRelay(h.list, 0, 0, {}, null); // unrelated noise in the list
    expect(m.kind).toBe('relay');
    // a brazier wants flame in its bowl zone
    const b: Mechanism = {
      id: 77, kind: 'brazier', x: 100, y: 100, w: 1, h: 1, state: 0, targetId: door.id,
    };
    h.list.push(b);
    h.world.types[h.world.idx(100, 98)] = Cell.Fire;
    step(h.ctx, mech, 3);
    expect(b.state).toBe(1);
    expect(door.state).toBe(1);
  });

  it('sequence doors still reset on wrong order (with the shared aggregator)', () => {
    const door = makeDoor(h.ctx, h.list, 200, 100, 3, 10);
    door.logic = 'sequence';
    const a = placeLever(h, 100, 100, door);
    const b = placeLever(h, 120, 100, door);
    b.state = 1; // wrong first
    step(h.ctx, mech, 2);
    expect(door.seqDone).not.toBe(true);
    expect(b.state).toBe(0); // spat back out
    a.state = 1;
    step(h.ctx, mech, 2);
    b.state = 1;
    step(h.ctx, mech, 2);
    expect(door.seqDone).toBe(true);
    expect(door.state).toBe(1);
  });
});

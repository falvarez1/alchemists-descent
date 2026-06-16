import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx, Mechanism } from '@/core/types';
import { EventBus } from '@/core/events';
import { rleEncode } from '@/core/rle';
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
import { instantiateObjects, makeInstantiationSink } from '@/game/instantiate';
import { createEmptyDocument, freshId } from '@/builder/document';
import type { EditorDocument, EditorObject, EditorObjectKind } from '@/builder/document';
import { validateDocument } from '@/builder/validate';
import { capturePrefab, rotatePrefab } from '@/builder/prefablib';

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
    expect(valve.closePending).toBe(true);
    expect(countCells(h.world, 100, 100, 102, 103, Cell.Metal)).toBe(0); // all columns within |x-player| <= 5
    h.ctx.player.x = -500;
    h.ctx.player.y = -500;
    step(h.ctx, mech, 2);
    expect(valve.closePending).toBe(false);
    expect(countCells(h.world, 100, 100, 102, 103, Cell.Metal)).toBe(12);
  });

  it('safe-closing doors retry skipped cells after the body leaves', () => {
    const door = makeDoor(h.ctx, h.list, 100, 100, 3, 4);
    const lever = placeLever(h, 90, 110, door);
    lever.state = 1;
    step(h.ctx, mech, 4); // open + retract
    expect(door.state).toBe(1);
    expect(countCells(h.world, 100, 100, 102, 103, Cell.Metal)).toBe(0);

    h.ctx.player.x = 101;
    h.ctx.player.y = 103;
    lever.state = 0;
    step(h.ctx, mech, 2);
    expect(door.state).toBe(0);
    expect(door.closePending).toBe(true);
    expect(countCells(h.world, 100, 100, 102, 103, Cell.Metal)).toBe(0);

    h.ctx.player.x = -500;
    h.ctx.player.y = -500;
    step(h.ctx, mech, 2);
    expect(door.closePending).toBe(false);
    expect(countCells(h.world, 100, 100, 102, 103, Cell.Metal)).toBe(12);
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
    step(h.ctx, mech, 1830);
    expect(plug.state).toBe(1);
    expect(plug.broken).toBeUndefined();
  });
});

describe('sensor', () => {
  it('heat sensor reads its zone and holds through the timed latch', () => {
    const door = makeDoor(h.ctx, h.list, 200, 100, 3, 10);
    const sensor = makeSensor(
      h.world,
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
    const sensor = makeSensor(h.world, h.list, 100, 100, {
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
    const sensor = makeSensor(h.world, h.list, 100, 100, {
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
    const sensor = makeSensor(h.world, h.list, 100, 100, {
      sensorType: 'weight',
      threshold: 10,
      zone: { x0: 0, y0: 0, x1: 800, y1: 600 },
    });
    const z = sensor.zone!;
    expect((z.x1 - z.x0 + 1) * (z.y1 - z.y0 + 1)).toBeLessThanOrEqual(SENSOR_ZONE_CAP);
  });

  it('fails open when its physical node is destroyed', () => {
    const door = makeDoor(h.ctx, h.list, 200, 100, 3, 10);
    const sensor = makeSensor(h.world, h.list, 100, 100, {
      sensorType: 'heat',
      threshold: 20,
      zone: { x0: 96, y0: 92, x1: 104, y1: 99 },
    }, door);
    expect(sensor.body).toEqual([[100, 100]]);
    h.world.clearCellAt(h.world.idx(100, 100));

    step(h.ctx, mech, 1830);

    expect(sensor.broken).toBe(0);
    expect(door.state).toBe(1);
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

/* ---------------- authoring contracts: instantiate, validate, prefab ---------------- */

function obj(
  kind: EditorObjectKind,
  x: number,
  y: number,
  params: Record<string, unknown> = {},
): EditorObject {
  return { id: freshId(kind), kind, x, y, rotation: 0, locked: false, hidden: false, params };
}

type LinkSpec = { fromId: string; toId: string };
function structuralDoc(objects: EditorObject[], links: LinkSpec[]): EditorDocument {
  const d = createEmptyDocument('machines', 'earthen');
  d.objects = [obj('spawn', 100, 100), ...objects];
  d.links = links.map((l) => ({
    id: freshId('link'),
    fromId: l.fromId,
    toId: l.toId,
    kind: 'triggerDoor' as const,
    logic: 'and' as const,
  }));
  return d; // world stays null -> structural checks only
}
const errsOf = (d: EditorDocument): ReturnType<typeof validateDocument> =>
  validateDocument(d).filter((i) => i.severity === 'error');

describe('instantiateObjects wires machine kinds', () => {
  it('sensor -> valve, counterweight -> relay -> door, plate -> valve, plug standalone', () => {
    const sink = makeInstantiationSink();
    const valveO = obj('valve', 100, 100, { w: 4, h: 2, material: 'glass' });
    const doorO = obj('door', 200, 100, { w: 3, h: 13 });
    const sensorO = obj('sensor', 120, 140, { type: 'liquid', threshold: 10, zoneW: 11, zoneH: 5, filter: 'water' });
    const cwO = obj('counterweight', 140, 140, { w: 7, threshold: 25 });
    const relayO = obj('relay', 160, 140, { delay: 12, action: 'ignite' });
    const plugO = obj('plug', 180, 140, { w: 2, h: 2, material: 'glass' });
    const plateO = obj('plate', 150, 160, { w: 5 });
    const links = [
      { id: freshId('link'), fromId: sensorO.id, toId: valveO.id, kind: 'triggerDoor' as const },
      { id: freshId('link'), fromId: cwO.id, toId: relayO.id, kind: 'triggerDoor' as const },
      { id: freshId('link'), fromId: relayO.id, toId: doorO.id, kind: 'triggerDoor' as const },
      { id: freshId('link'), fromId: plateO.id, toId: valveO.id, kind: 'triggerDoor' as const },
    ];
    const set = (x: number, y: number, t: number): void => {
      if (h.world.inBounds(x, y)) h.world.types[h.world.idx(x, y)] = t;
    };
    instantiateObjects(
      h.ctx, sink,
      [valveO, doorO, sensorO, cwO, relayO, plugO, plateO],
      links, [], 0, 0, set,
    );
    const one = (k: string): Mechanism => sink.mechanisms.find((m) => m.kind === k)!;
    const valve = one('valve'), door = one('door'), sensor = one('sensor');
    const cw = one('counterweight'), relay = one('relay'), plug = one('plug'), plate = one('plate');
    expect(valve.material).toBe(Cell.Glass);
    expect(sensor.targetId).toBe(valve.id);
    expect(sensor.sensorType).toBe('liquid');
    expect(sensor.materialFilter).toEqual([Cell.Water]);
    expect(cw.targetId).toBe(relay.id);
    expect(relay.targetId).toBe(door.id);
    expect(relay.delayFrames).toBe(12);
    expect(relay.outputAction).toBe('ignite');
    expect(plate.targetId).toBe(valve.id);
    expect(plug.targetId).toBe(-1); // a pure breakable seal signals nothing
    expect(plug.material).toBe(Cell.Glass);
    expect(countCells(h.world, 100, 100, 103, 101, Cell.Glass)).toBe(8); // closed valve cells
    expect(plug.body!.length).toBe(4);
  });
});

describe('validateDocument machine rules (structural)', () => {
  it('sensors must link out; a plug may stand alone', () => {
    const s = obj('sensor', 120, 120, {});
    expect(errsOf(structuralDoc([s], [])).some((e) => e.what.includes('not linked'))).toBe(true);
    const p = obj('plug', 120, 120, {});
    expect(errsOf(structuralDoc([p], []))).toEqual([]);
  });

  it('relays need inputs, and relay cycles are errors', () => {
    const d1Door = obj('door', 200, 120, {});
    const r1 = obj('relay', 150, 120, {});
    const issues1 = errsOf(structuralDoc([d1Door, r1], [{ fromId: r1.id, toId: d1Door.id }]));
    expect(issues1.some((e) => e.what.includes('no inputs'))).toBe(true);

    const a = obj('relay', 150, 120, {});
    const b = obj('relay', 170, 120, {});
    const issues2 = errsOf(
      structuralDoc([a, b], [
        { fromId: a.id, toId: b.id },
        { fromId: b.id, toId: a.id },
      ]),
    );
    expect(issues2.some((e) => e.what.includes('relay cycle'))).toBe(true);
  });

  it('plugs receive only from relays', () => {
    const plate = obj('plate', 120, 120, {});
    const plug = obj('plug', 150, 120, {});
    const bad = errsOf(structuralDoc([plate, plug], [{ fromId: plate.id, toId: plug.id }]));
    expect(bad.some((e) => e.what.includes('triggers drive doors, valves, or relays'))).toBe(true);

    const lever = obj('lever', 110, 120, {});
    const relay = obj('relay', 130, 120, { action: 'break' });
    const ok = errsOf(
      structuralDoc([lever, relay, plug], [
        { fromId: lever.id, toId: relay.id },
        { fromId: relay.id, toId: plug.id },
      ]),
    );
    expect(ok.filter((e) => e.what.includes('linked'))).toEqual([]);
  });

  it('sequence chains refuse one-way machine triggers', () => {
    const cw = obj('counterweight', 120, 120, {});
    const valve = obj('valve', 180, 120, { logic: 'sequence' });
    const issues = errsOf(structuralDoc([cw, valve], [{ fromId: cw.id, toId: valve.id }]));
    expect(issues.some((e) => e.what.includes('never un-fire'))).toBe(true);
  });
});

describe('validateDocument machine fixpoint', () => {
  /** All-rock world with one open arena, captured into a document. */
  function arenaDoc(): EditorDocument {
    const w = new World();
    w.types.fill(Cell.Wall);
    for (let y = 100; y <= 159; y++) {
      for (let x = 100; x <= 300; x++) w.types[w.idx(x, y)] = Cell.Empty;
    }
    const d = createEmptyDocument('machines', 'earthen');
    d.world = { rle: rleEncode(w.types), life: [], charge: [] };
    return d;
  }

  it('a sensor-fed valve wall is earnable: the key behind it validates clean', () => {
    const d = arenaDoc();
    const spawn = obj('spawn', 120, 158);
    const sensor = obj('sensor', 140, 158, { type: 'heat', threshold: 4 });
    const valve = obj('valve', 180, 100, { w: 3, h: 60 });
    const key = obj('pickup', 280, 158, { kind: 'key' });
    d.objects.push(spawn, sensor, valve, key);
    d.links.push({
      id: freshId('link'), fromId: sensor.id, toId: valve.id, kind: 'triggerDoor', logic: 'and',
    });
    expect(errsOf(d)).toEqual([]);
  });

  it('a reachable plug wall is breakable by design: loot behind it is earnable', () => {
    const d = arenaDoc();
    const spawn = obj('spawn', 120, 158);
    const plug = obj('plug', 180, 100, { w: 3, h: 60, material: 'wood' });
    const key = obj('pickup', 280, 158, { kind: 'key' });
    d.objects.push(spawn, plug, key);
    expect(errsOf(d)).toEqual([]);
  });

  it('relays are logic, not positions: a buried relay chained from a lever still earns the door', () => {
    const d = arenaDoc();
    const spawn = obj('spawn', 120, 158);
    const lever = obj('lever', 140, 158, {});
    const relay = obj('relay', 180, 300, {}); // deep in solid rock
    const door = obj('door', 220, 100, { w: 3, h: 60 });
    const key = obj('pickup', 280, 158, { kind: 'key' });
    d.objects.push(spawn, lever, relay, door, key);
    d.links.push(
      { id: freshId('link'), fromId: lever.id, toId: relay.id, kind: 'triggerDoor', logic: 'and' },
      { id: freshId('link'), fromId: relay.id, toId: door.id, kind: 'triggerDoor', logic: 'and' },
    );
    expect(errsOf(d)).toEqual([]);
  });

  it('an unearnable sensor valve seals the key: flagged', () => {
    const d = arenaDoc();
    const spawn = obj('spawn', 120, 158);
    const sensor = obj('sensor', 180, 400, { type: 'heat', threshold: 4 }); // sealed in rock
    const valve = obj('valve', 220, 100, { w: 3, h: 60 });
    const key = obj('pickup', 280, 158, { kind: 'key' });
    d.objects.push(spawn, sensor, valve, key);
    d.links.push({
      id: freshId('link'), fromId: sensor.id, toId: valve.id, kind: 'triggerDoor', logic: 'and',
    });
    const issues = validateDocument(d);
    expect(issues.some((i) => i.severity === 'error' && i.what.includes('key unreachable'))).toBe(true);
    expect(issues.some((i) => i.severity === 'warning' && i.what.includes('sensor unreachable'))).toBe(true);
  });
});

describe('prefab capture of machine objects', () => {
  it('captures valve + sensor + their link; rotation swaps the valve slab', () => {
    const w = new World();
    const d = createEmptyDocument('machines', 'earthen');
    const valveO = obj('valve', 110, 120, { w: 6, h: 2 });
    const sensorO = obj('sensor', 120, 130, { type: 'heat', threshold: 4 });
    d.objects.push(valveO, sensorO);
    d.links.push({
      id: freshId('link'), fromId: sensorO.id, toId: valveO.id, kind: 'triggerDoor', logic: 'and',
    });
    const got = capturePrefab(w, { x0: 100, y0: 100, x1: 149, y1: 149 }, d, 'machine bit');
    expect(got).not.toBeNull();
    const p = got!.prefab;
    expect(p.objects.length).toBe(2);
    expect(p.links.length).toBe(1);
    const r = rotatePrefab(p);
    const valve2 = r.objects.find((o) => o.kind === 'valve')!;
    expect(valve2.params.w).toBe(2);
    expect(valve2.params.h).toBe(6);
  });
});

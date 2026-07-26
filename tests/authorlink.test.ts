import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  applyCellPatch,
  cellPatchBounds,
  createCellPatch,
  isValidCellPatch,
} from '@/authoring/cellPatch';
import { paintTerrainCmd, compositeCmd, CommandStack } from '@/builder/commands';
import type { Command } from '@/builder/commands';
import { PatchRecorder } from '@/builder/terrain';
import {
  AUTHORLINK_PATH,
  AUTHORLINK_PROTOCOL,
  MAX_MESSAGE_BYTES,
  describeWorld,
  isAuthorLinkMessage,
  isCommandPayload,
  isTuningPayload,
  isWorldIdentity,
  makeClientId,
  sameWorld,
} from '@/net/authorLinkProtocol';
import type { WorldIdentity } from '@/net/authorLinkProtocol';
import { applyWorldLayer, captureWorldLayer } from '@/authoring/worldLayer';
import { isAuthoredSet } from '@/app/authorLinkObjects';
import { BroadcastStorageOwner, createStorageOwner } from '@/core/storageOwner';
import type { OwnerChannel } from '@/core/storageOwner';
import {
  applyTuningChanges,
  captureTuningChanges,
  diffTuningChanges,
  isTunablePath,
  listTuningPaths,
  readTuningPath,
  writeTuningPath,
} from '@/net/tuningPatch';
import { AuthorLinkClient } from '@/net/AuthorLinkClient';
import { resolveAuthorLinkConfig } from '@/app/AuthorLink';
import { GLOBAL_PARAMS, GLOBAL_PARAM_DEFAULTS, MATERIAL_PARAMS } from '@/config/params';
import { CELL_COUNT, Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import type { EditorDocument } from '@/builder/document';

/* ===================== cell patch ===================== */

describe('CellPatch', () => {
  it('replays cells into a world and routes charge through setChargeAt', () => {
    const world = new World(32, 16);
    const patch = createCellPatch();
    const i = world.idx(4, 5);
    patch.idxs.push(i);
    patch.types.push(Cell.Metal);
    patch.colors.push(0x123456);
    patch.life.push(7);
    patch.charge.push(900);

    expect(applyCellPatch(world, patch)).toBe(1);
    expect(world.types[i]).toBe(Cell.Metal);
    expect(world.colors[i]).toBe(0x123456);
    expect(world.life[i]).toBe(7);
    expect(world.charge[i]).toBe(900);
    // setChargeAt keeps the sparse active-charge index in step; a raw array
    // write would leave the electrical pass blind to this cell.
    expect(world.activeCharges.has(i)).toBe(true);
  });

  it('skips out-of-range indices instead of throwing', () => {
    const world = new World(8, 8);
    const patch = createCellPatch();
    patch.idxs.push(-1, 5, 99999);
    patch.types.push(Cell.Stone, Cell.Stone, Cell.Stone);
    patch.colors.push(1, 2, 3);
    patch.life.push(0, 0, 0);
    patch.charge.push(0, 0, 0);
    expect(applyCellPatch(world, patch)).toBe(1);
    expect(world.types[5]).toBe(Cell.Stone);
  });

  it('reports the touched bounding box', () => {
    const patch = createCellPatch();
    for (const [x, y] of [
      [3, 2],
      [9, 7],
      [5, 4],
    ]) {
      patch.idxs.push(x + y * 100);
      patch.types.push(Cell.Sand);
      patch.colors.push(0);
      patch.life.push(0);
      patch.charge.push(0);
    }
    expect(cellPatchBounds(patch, 100)).toEqual({ x0: 3, y0: 2, x1: 9, y1: 7 });
    expect(cellPatchBounds(createCellPatch(), 100)).toBeNull();
  });

  it('rejects patches that name a cell id this build cannot simulate', () => {
    const limit = 64;
    const good = createCellPatch();
    good.idxs.push(1);
    good.types.push(Cell.Water);
    good.colors.push(0);
    good.life.push(0);
    good.charge.push(0);
    expect(isValidCellPatch(good, limit)).toBe(true);

    // Cell ids are an append-only ABI: a patch from a newer build can carry an
    // id with no behavior here, and stamping it would poison the grid.
    const future = structuredClone(good);
    future.types[0] = CELL_COUNT;
    expect(isValidCellPatch(future, limit)).toBe(false);

    const ragged = structuredClone(good);
    ragged.colors.push(0);
    expect(isValidCellPatch(ragged, limit)).toBe(false);

    expect(isValidCellPatch({ idxs: [] }, limit)).toBe(false);
    expect(isValidCellPatch(null, limit)).toBe(false);
  });
});

/* ===================== command tap ===================== */

function emptyDoc(): EditorDocument {
  return { objects: [], links: [], lights: [] } as unknown as EditorDocument;
}

describe('terrain commands expose their payload to observers', () => {
  it('carries before/after so an observer can forward the stroke', () => {
    const world = new World(32, 16);
    const rec = new PatchRecorder(world);
    const i = world.idx(2, 3);
    rec.touch(i);
    world.types[i] = Cell.Wood;
    const patch = rec.finish();
    expect(patch).not.toBeNull();

    const cmd = paintTerrainCmd(world, patch!.before, patch!.after);
    expect(cmd.terrain?.after.types).toEqual([Cell.Wood]);
    expect(cmd.terrain?.before.types).toEqual([Cell.Empty]);
  });

  it('tells the listener which direction ran, so undo can send `before`', () => {
    const world = new World(32, 16);
    const i = world.idx(1, 1);
    const before = createCellPatch();
    before.idxs.push(i);
    before.types.push(Cell.Empty);
    before.colors.push(0);
    before.life.push(0);
    before.charge.push(0);
    const after = structuredClone(before);
    after.types[0] = Cell.Stone;

    const seen: Array<{ label: string; direction: string; type: number }> = [];
    const doc = emptyDoc();
    const stack = new CommandStack(
      () => doc,
      (cmd?: Command, direction?: string) => {
        const patch = direction === 'undo' ? cmd?.terrain?.before : cmd?.terrain?.after;
        if (patch) seen.push({ label: cmd!.label, direction: direction!, type: patch.types[0] });
      },
    );

    stack.run(paintTerrainCmd(world, before, after));
    stack.undo();
    stack.redo();

    expect(seen).toEqual([
      { label: 'paint', direction: 'do', type: Cell.Stone },
      { label: 'paint', direction: 'undo', type: Cell.Empty },
      { label: 'paint', direction: 'do', type: Cell.Stone },
    ]);
  });

  it('merges composite terrain so a prefab paste travels as one stroke', () => {
    const world = new World(32, 16);
    const make = (idx: number, type: number): Command => {
      const before = createCellPatch();
      before.idxs.push(idx);
      before.types.push(Cell.Empty);
      before.colors.push(0);
      before.life.push(0);
      before.charge.push(0);
      const after = structuredClone(before);
      after.types[0] = type;
      return paintTerrainCmd(world, before, after);
    };
    const composite = compositeCmd('prefab paste', [make(1, Cell.Wood), make(2, Cell.Metal)]);
    expect(composite.terrain?.after.idxs).toEqual([1, 2]);
    expect(composite.terrain?.after.types).toEqual([Cell.Wood, Cell.Metal]);
  });

  it('leaves non-terrain commands without a payload', () => {
    expect(compositeCmd('nothing', []).terrain).toBeUndefined();
  });
});

/* ===================== tuning paths ===================== */

describe('tuning paths', () => {
  it('derives the allowlist from the shipped defaults', () => {
    const paths = listTuningPaths();
    expect(paths).toContain('global.ambient');
    expect(paths).toContain('gen.caveScale');
    expect(paths).toContain(`materials.${Cell.Oil}.burnDuration`);
    // `name` is a display label on material/spell records, never a dial.
    expect(paths.some((p) => p.endsWith('.name'))).toBe(false);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(isTunablePath(path)).toBe(true);
  });

  it('refuses unknown paths, prototype reaches, and type mismatches', () => {
    expect(isTunablePath('global.nopeNotADial')).toBe(false);
    expect(isTunablePath('nonsense.key')).toBe(false);
    expect(isTunablePath('global')).toBe(false);
    expect(isTunablePath('global.__proto__')).toBe(false);
    expect(isTunablePath('materials.999.friction')).toBe(false);
    expect(writeTuningPath('global.ambient', true)).toBe(false);
    expect(writeTuningPath('global.ambient', Number.NaN)).toBe(false);
    expect(writeTuningPath('global.nopeNotADial', 1)).toBe(false);
  });

  it('round-trips a live value', () => {
    const original = GLOBAL_PARAMS.ambient;
    try {
      expect(writeTuningPath('global.ambient', original + 0.05)).toBe(true);
      expect(readTuningPath('global.ambient')).toBeCloseTo(original + 0.05);
      // A no-op write reports "nothing changed" so the publisher stays quiet.
      expect(writeTuningPath('global.ambient', original + 0.05)).toBe(false);
    } finally {
      GLOBAL_PARAMS.ambient = original;
    }
  });

  it('captures only dials that differ from their shipped default', () => {
    const original = GLOBAL_PARAMS.maxBrightness;
    try {
      GLOBAL_PARAMS.maxBrightness = GLOBAL_PARAM_DEFAULTS.maxBrightness;
      expect(captureTuningChanges().some((c) => c.path === 'global.maxBrightness')).toBe(false);
      GLOBAL_PARAMS.maxBrightness = GLOBAL_PARAM_DEFAULTS.maxBrightness + 1;
      expect(captureTuningChanges()).toContainEqual({
        path: 'global.maxBrightness',
        value: GLOBAL_PARAM_DEFAULTS.maxBrightness + 1,
      });
    } finally {
      GLOBAL_PARAMS.maxBrightness = original;
    }
  });

  it('emits a revert-to-default when a dial drops out of the sparse snapshot', () => {
    const previous = [{ path: 'global.ambient', value: 0.44 }];
    const changes = diffTuningChanges(previous, []);
    // Without this the other window would stay stuck on 0.44 forever, because
    // a defaulted dial simply vanishes from the capture.
    expect(changes).toEqual([{ path: 'global.ambient', value: GLOBAL_PARAM_DEFAULTS.ambient }]);
  });

  it('applies a remote patch and reports unknown paths instead of throwing', () => {
    const original = MATERIAL_PARAMS[Cell.Oil].burnDuration;
    try {
      const result = applyTuningChanges([
        { path: `materials.${Cell.Oil}.burnDuration`, value: original + 13 },
        { path: 'materials.999.friction', value: 1 },
        { path: 'global.__proto__', value: 1 },
      ]);
      expect(result.applied).toBe(1);
      expect(result.rejected).toEqual(['materials.999.friction', 'global.__proto__']);
      expect(MATERIAL_PARAMS[Cell.Oil].burnDuration).toBe(original + 13);
    } finally {
      MATERIAL_PARAMS[Cell.Oil].burnDuration = original;
    }
  });
});

/* ===================== protocol ===================== */

function envelope(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: 'tuning',
    protocol: AUTHORLINK_PROTOCOL,
    room: 'local',
    clientId: 'a',
    revision: 0,
    sentAt: 1,
    payload: { changes: [] },
    ...overrides,
  };
}

describe('AuthorLink protocol', () => {
  it('accepts a well-formed envelope and rejects malformed ones', () => {
    expect(isAuthorLinkMessage(envelope())).toBe(true);
    expect(isAuthorLinkMessage(envelope({ protocol: 99 }))).toBe(false);
    expect(isAuthorLinkMessage(envelope({ type: 'evict-everyone' }))).toBe(false);
    expect(isAuthorLinkMessage(envelope({ payload: undefined }))).toBe(false);
    expect(isAuthorLinkMessage(envelope({ revision: 'soon' }))).toBe(false);
    expect(isAuthorLinkMessage('a string')).toBe(false);
  });

  it('validates channel payloads', () => {
    expect(isTuningPayload({ changes: [{ path: 'global.ambient', value: 1 }] })).toBe(true);
    expect(isTuningPayload({ changes: [{ path: 'global.ambient', value: Number.NaN }] })).toBe(false);
    expect(isTuningPayload({ changes: [{ path: 1, value: 1 }] })).toBe(false);
    expect(isTuningPayload({})).toBe(false);

    expect(isCommandPayload({ line: 'tp 10 10' })).toBe(true);
    expect(isCommandPayload({ line: '' })).toBe(false);
    expect(isCommandPayload({ line: 'x'.repeat(513) })).toBe(false);
  });

  it('makes ids that name their role and stay distinct', () => {
    expect(makeClientId('builder', () => 0.5)).toMatch(/^builder-/);
    expect(makeClientId('play', () => 0.5)).not.toBe(makeClientId('builder', () => 0.5));
  });

  it('keeps the relay in step with the client protocol', () => {
    // The relay hosts run under plain Node and Workers and cannot import the
    // TS module, so the shared constants are duplicated once — in the ONE
    // room module both hosts use. Drift there is a silent wire break.
    const room = readFileSync('servers/authorlink/room.mjs', 'utf8');
    expect(room).toContain(`export const AUTHORLINK_PROTOCOL = ${AUTHORLINK_PROTOCOL};`);
    expect(room).toContain(`export const AUTHORLINK_PATH = '${AUTHORLINK_PATH}';`);
    expect(room).toContain(`export const MAX_MESSAGE_BYTES = ${MAX_MESSAGE_BYTES / 1024} * 1024;`);
    // Every relayed message type the client can send must be one the room
    // agrees to relay; a missing entry silently drops that whole channel.
    for (const type of ['tuning', 'cells', 'cmd', 'objects', 'world.announce', 'world.request', 'world.snapshot']) {
      expect(room, `room.mjs does not relay ${type}`).toContain(`'${type}',`);
    }
  });

  it('runs the same room logic in both hosts', () => {
    // The Node server and the Cloudflare Worker must not grow their own
    // copies of "what a room does" — that is how a hosted room and `npm run
    // dev` start disagreeing about what is legal.
    const node = readFileSync('scripts/authorlink-server.mjs', 'utf8');
    const worker = readFileSync('servers/authorlink/worker.js', 'utf8');
    expect(node).toContain("from '../servers/authorlink/room.mjs'");
    expect(worker).toContain("from './room.mjs'");
    for (const host of [node, worker]) {
      expect(host).toContain('createRoom(');
      // Validation belongs to the room, not the host.
      expect(host).not.toContain('RATE_LIMIT');
    }
  });});

/* ===================== world identity ===================== */

function identity(over: Partial<WorldIdentity> = {}): WorldIdentity {
  return {
    kind: 'sandbox',
    levelId: '',
    biome: 'earthen',
    seed: 1234,
    genVersion: 36,
    width: 1600,
    height: 1064,
    ...over,
  };
}

describe('world identity', () => {
  it('treats identical descriptors as the same world', () => {
    expect(sameWorld(identity(), identity())).toBe(true);
  });

  it('separates worlds that differ in any load-bearing field', () => {
    expect(sameWorld(identity(), identity({ seed: 9 }))).toBe(false);
    expect(sameWorld(identity(), identity({ biome: 'frozen' }))).toBe(false);
    expect(sameWorld(identity(), identity({ kind: 'level', levelId: 'd1' }))).toBe(false);
    // Two builds that generate differently must never be treated as peers.
    expect(sameWorld(identity(), identity({ genVersion: 35 }))).toBe(false);
  });

  it('never calls an unknown world the same as anything', () => {
    expect(sameWorld(null, null)).toBe(false);
    expect(sameWorld(identity(), null)).toBe(false);
  });

  it('does NOT accept matching dimensions as evidence', () => {
    // The bug this whole mechanism exists to prevent: every world in the game
    // is 1600x1064, so a size check can never distinguish two levels.
    const sandbox = identity();
    const liveLevel = identity({ kind: 'level', levelId: 'd3', seed: 777 });
    expect(sandbox.width).toBe(liveLevel.width);
    expect(sandbox.height).toBe(liveLevel.height);
    expect(sameWorld(sandbox, liveLevel)).toBe(false);
  });

  it('validates descriptors off the wire', () => {
    expect(isWorldIdentity(identity())).toBe(true);
    expect(isWorldIdentity({ ...identity(), kind: 'elsewhere' })).toBe(false);
    expect(isWorldIdentity({ ...identity(), seed: 'abc' })).toBe(false);
    expect(isWorldIdentity({ ...identity(), genVersion: Number.NaN })).toBe(false);
    expect(isWorldIdentity(null)).toBe(false);
  });

  it('describes a world readably for the pill', () => {
    expect(describeWorld(identity({ kind: 'level', levelId: 'd1' }))).toBe('d1 · earthen #1234');
    expect(describeWorld(identity())).toBe('sandbox · earthen #1234');
    expect(describeWorld(null)).toBe('unknown');
  });
});

/* ===================== world layer transfer ===================== */

describe('world layer codec', () => {
  it('round-trips terrain, life, and charge through a snapshot', () => {
    const source = new World();
    // A few distinguishable cells, including charge (which must go through
    // setChargeAt on the way back in) and life.
    const wall = source.idx(100, 100);
    const metal = source.idx(101, 100);
    const fire = source.idx(102, 100);
    source.types[wall] = Cell.Wall;
    source.types[metal] = Cell.Metal;
    source.types[fire] = Cell.Fire;
    source.life[fire] = 42;
    source.setChargeAt(metal, 500);

    const layer = captureWorldLayer({ world: source, biome: 'earthen', seed: 4242, paintSeed: 77 });
    expect(typeof layer.rle).toBe('string');
    expect(layer.paintSeed).toBe(77);

    const target = new World();
    applyWorldLayer({ world: target, biome: 'earthen', seed: 4242 }, layer);
    expect(target.types[wall]).toBe(Cell.Wall);
    expect(target.types[metal]).toBe(Cell.Metal);
    expect(target.types[fire]).toBe(Cell.Fire);
    expect(target.life[fire]).toBe(42);
    expect(target.charge[metal]).toBe(500);
    expect(target.activeCharges.has(metal)).toBe(true);
  });

  it('reconstructs wall colors from the paint seed rather than shipping them', () => {
    // This is what keeps a cave world at ~75KB instead of ~6.6MB: the receiver
    // re-derives the biome banding, so identical paint costs nothing on the wire.
    const source = new World();
    for (let x = 40; x < 90; x++) {
      for (let y = 40; y < 90; y++) source.types[source.idx(x, y)] = Cell.Wall;
    }
    const layer = captureWorldLayer({ world: source, biome: 'earthen', seed: 5, paintSeed: 31337 });
    const target = new World();
    applyWorldLayer({ world: target, biome: 'earthen', seed: 5 }, layer);
    const probe = target.idx(60, 60);
    expect(target.types[probe]).toBe(Cell.Wall);
    // Repainted, not left at the empty default.
    expect(target.colors[probe]).not.toBe(0);
    expect(JSON.stringify(layer).length).toBeLessThan(200_000);
  });

  it('fails safe on a malformed rle instead of throwing at the caller', () => {
    const target = new World();
    target.types[5] = Cell.Stone;
    applyWorldLayer({ world: target, biome: 'earthen', seed: 1 }, { rle: 'not-an-rle!!' });
    // Cleared, not corrupted, and no exception escaped.
    expect(target.types[5]).toBe(Cell.Empty);
  });
});

/* ===================== authored set validation ===================== */

describe('authored set validation', () => {
  const good = {
    objects: [{ id: 'o1', kind: 'door', x: 10, y: 20 }],
    links: [],
    lights: [],
  };

  it('accepts a well-formed set', () => {
    expect(isAuthoredSet(good)).toBe(true);
    expect(isAuthoredSet({ objects: [], links: [], lights: [] })).toBe(true);
  });

  it('rejects sets whose records are not placeable', () => {
    expect(isAuthoredSet({ ...good, objects: [{ id: 'o1', kind: 'door', x: 'ten', y: 20 }] })).toBe(false);
    expect(isAuthoredSet({ ...good, objects: [{ kind: 'door', x: 1, y: 2 }] })).toBe(false);
    expect(isAuthoredSet({ ...good, objects: [null] })).toBe(false);
    expect(isAuthoredSet({ objects: [], links: [] })).toBe(false);
    expect(isAuthoredSet(null)).toBe(false);
  });
});

/* ===================== storage owner ===================== */

/** In-memory stand-in for BroadcastChannel, wired between test instances. */
function makeBus(): { connect: () => OwnerChannel } {
  const peers = new Set<(event: MessageEvent) => void>();
  return {
    connect() {
      const mine = new Set<(event: MessageEvent) => void>();
      return {
        postMessage(message: unknown) {
          for (const handler of [...peers]) {
            if (mine.has(handler)) continue; // a channel never hears itself
            handler({ data: message } as MessageEvent);
          }
        },
        addEventListener(_type, handler) {
          mine.add(handler);
          peers.add(handler);
        },
        removeEventListener(_type, handler) {
          mine.delete(handler);
          peers.delete(handler);
        },
        close() {
          for (const handler of mine) peers.delete(handler);
          mine.clear();
        },
      };
    },
  };
}

describe('storage owner election', () => {
  it('gives a window with no peers ownership', () => {
    const bus = makeBus();
    const only = new BroadcastStorageOwner(() => 1, bus.connect);
    expect(only.owns).toBe(true);
    only.dispose();
  });

  it('hands ownership to whichever window focused most recently', () => {
    const bus = makeBus();
    let clock = 1;
    const a = new BroadcastStorageOwner(() => clock, bus.connect);
    const b = new BroadcastStorageOwner(() => clock, bus.connect);

    clock = 2;
    a.focus();
    expect(a.owns).toBe(true);
    expect(b.owns).toBe(false);

    clock = 3;
    b.focus();
    expect(b.owns).toBe(true);
    expect(a.owns).toBe(false);

    a.dispose();
    b.dispose();
  });

  it('keeps the incumbent on a tie, so a simultaneous claim cannot silence both', () => {
    const bus = makeBus();
    const a = new BroadcastStorageOwner(() => 7, bus.connect);
    const b = new BroadcastStorageOwner(() => 7, bus.connect);
    a.focus();
    b.focus();
    // Exactly one writer must remain; both standing down means nobody saves.
    expect([a.owns, b.owns].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    a.dispose();
    b.dispose();
  });

  it('releases ownership on dispose so a closing window stops writing', () => {
    const bus = makeBus();
    const owner = new BroadcastStorageOwner(() => 1, bus.connect);
    owner.dispose();
    expect(owner.owns).toBe(false);
  });

  it('falls back to always-owns where BroadcastChannel is unavailable', () => {
    const owner = createStorageOwner(() => 1);
    expect(owner.owns).toBe(true);
    owner.dispose();
  });
});

/* ===================== config resolution ===================== */

describe('resolveAuthorLinkConfig', () => {
  const loc = { protocol: 'http:', host: 'localhost:5173' };

  it('links by default in dev and stays off in production', () => {
    expect(resolveAuthorLinkConfig('', true, loc).enabled).toBe(true);
    expect(resolveAuthorLinkConfig('', false, loc).enabled).toBe(false);
  });

  it('honours an explicit opt-in and opt-out', () => {
    expect(resolveAuthorLinkConfig('?link=off', true, loc).enabled).toBe(false);
    const prod = resolveAuthorLinkConfig('?link=moss', false, loc);
    expect(prod.enabled).toBe(true);
    expect(prod.room).toBe('moss');
    expect(prod.url).toBe(`ws://localhost:5173${AUTHORLINK_PATH}?room=moss`);
  });

  it('upgrades the scheme on https and accepts an external relay', () => {
    const secure = resolveAuthorLinkConfig('?link=on', false, { protocol: 'https:', host: 'x.dev' });
    expect(secure.url.startsWith('wss://x.dev')).toBe(true);
    expect(secure.room).toBe('local');
    const external = resolveAuthorLinkConfig('', true, loc, 'wss://relay.example.com/');
    expect(external.url).toBe(`wss://relay.example.com${AUTHORLINK_PATH}?room=local`);
  });
});

/* ===================== client ===================== */

class FakeSocket implements Partial<WebSocket> {
  static readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  addEventListener(type: string, handler: (e: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(handler);
  }

  removeEventListener(type: string, handler: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  close(): void {
    this.readyState = 3;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  fire(type: string, event: unknown): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
  }

  deliver(message: unknown): void {
    this.fire('message', { data: JSON.stringify(message) });
  }
}

function makeClient(): { client: AuthorLinkClient; socket: FakeSocket } {
  const socket = new FakeSocket();
  const client = new AuthorLinkClient({
    url: 'ws://test/link',
    room: 'local',
    role: 'builder',
    build: 'test',
    clientId: 'me',
    socketFactory: () => socket as unknown as WebSocket,
    now: () => 42,
  });
  client.connect();
  socket.fire('open', {});
  return { client, socket };
}

describe('AuthorLinkClient', () => {
  it('says hello on open with its role', () => {
    const { client, socket } = makeClient();
    const hello = JSON.parse(socket.sent[0]);
    expect(hello.type).toBe('hello');
    expect(hello.payload.role).toBe('builder');
    expect(hello.protocol).toBe(AUTHORLINK_PROTOCOL);
    client.dispose();
  });

  it('never delivers a client its own publish', () => {
    const { client, socket } = makeClient();
    const seen: string[] = [];
    client.on('tuning', (m) => seen.push(m.clientId));
    socket.deliver(envelope({ clientId: 'me' }));
    socket.deliver(envelope({ clientId: 'other' }));
    expect(seen).toEqual(['other']);
    client.dispose();
  });

  it('tracks the room revision and peer count', () => {
    const { client, socket } = makeClient();
    socket.deliver(
      envelope({ type: 'welcome', clientId: 'me', revision: 5, payload: { clientId: 'me', revision: 5, peers: 2, tuning: [] } }),
    );
    expect(client.getStatus().revision).toBe(5);
    expect(client.getStatus().peers).toBe(2);
    expect(client.getStatus().kind).toBe('connected');
    client.dispose();
  });

  it('answers a heartbeat ping without waking subscribers', () => {
    const { client, socket } = makeClient();
    let pings = 0;
    client.on('ping', () => pings++);
    socket.deliver(envelope({ type: 'ping', clientId: 'relay', payload: {} }));
    expect(pings).toBe(0);
    expect(JSON.parse(socket.sent[socket.sent.length - 1]).type).toBe('pong');
    client.dispose();
  });

  it('ignores junk on the wire', () => {
    const { client, socket } = makeClient();
    let hits = 0;
    client.on('tuning', () => hits++);
    socket.fire('message', { data: 'not json' });
    socket.fire('message', { data: JSON.stringify({ nope: true }) });
    socket.fire('message', { data: new ArrayBuffer(4) });
    expect(hits).toBe(0);
    client.dispose();
  });

  it('drops sends while disconnected rather than queueing a stale drag', () => {
    const { client, socket } = makeClient();
    socket.readyState = 3;
    expect(client.send('tuning', { changes: [{ path: 'global.ambient', value: 1 }] })).toBe(false);
    client.dispose();
  });

  it('notifies status on a revision bump, so subscribers must gate on kind', () => {
    // Regression guard for the second storm: `revision` moves with EVERY
    // relayed message, so a subscriber that sends on each status callback
    // sends once per message received — an unbounded loop between two peers.
    const { client, socket } = makeClient();
    const kinds: string[] = [];
    client.onStatus((s) => kinds.push(`${s.kind}:${s.revision}`));
    socket.deliver(envelope({ clientId: 'other', revision: 7 }));
    socket.deliver(envelope({ clientId: 'other', revision: 8 }));
    // Same kind throughout — a naive "if connected, send" handler would fire 3x.
    expect(kinds).toEqual(['connected:0', 'connected:7', 'connected:8']);
    expect(new Set(kinds.map((k) => k.split(':')[0])).size).toBe(1);
    client.dispose();
  });

  it('does not echo an announcement back at a peer it already knows', () => {
    // Regression: replying to EVERY world.announce is an infinite loop, because
    // the reply is itself an announcement. It pinned the relay at its rate
    // limit and silently starved the tuning and cell channels.
    const { client, socket } = makeClient();
    const seen = new Set<string>();
    client.on('world.announce', (m) => {
      const first = !seen.has(m.clientId);
      seen.add(m.clientId);
      if (first) client.send('world.announce', { world: identity() });
    });
    const announce = envelope({ type: 'world.announce', clientId: 'peer', payload: { world: identity() } });
    const before = socket.sent.length;
    socket.deliver(announce);
    socket.deliver(announce);
    socket.deliver(announce);
    expect(socket.sent.length - before).toBe(1);
    client.dispose();
  });

  it('stops reconnecting once disposed', () => {
    const { client, socket } = makeClient();
    client.dispose();
    socket.fire('close', {});
    expect(client.getStatus().kind).not.toBe('reconnecting');
  });
});

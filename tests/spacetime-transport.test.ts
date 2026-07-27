import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AuthorLinkClient } from '@/net/AuthorLinkClient';
import { MAX_MESSAGE_BYTES, type TuningChange } from '@/net/authorLinkProtocol';
import {
  SpacetimeDbTransport,
  type SpacetimeConnectOptions,
  type SpacetimeRoomHooks,
  type SpacetimeRoomState,
} from '@/net/SpacetimeDbTransport';
import type { TransportHandlers } from '@/net/SessionTransport';

/**
 * These cover the translation layer only. Whether SpacetimeDB itself behaves —
 * host migration, durability, real reducers — is proven against a live
 * database by `scripts/verify-spacetime-session.mjs`, because a mock asserting
 * my own assumptions about a database would prove nothing about the database.
 */

const BASE: SpacetimeConnectOptions = {
  uri: 'ws://127.0.0.1:3000',
  moduleName: 'alchemists-descent',
  room: 'test-room',
  clientId: 'peer-a',
  role: 'builder',
  build: 'test',
};

function fakeRoom(initial: SpacetimeRoomState = { peers: 0, roles: [], revision: 0 }) {
  const published: string[] = [];
  const tuned: { data: string; changes: TuningChange[] }[] = [];
  let hooks: SpacetimeRoomHooks | null = null;
  let closed = false;
  const transport = new SpacetimeDbTransport({
    ...BASE,
    now: () => 1000,
    connector: (_options, h) => {
      hooks = h;
      return {
        publish: (data) => {
          published.push(data);
          return true;
        },
        publishTuning: (data, changes) => {
          tuned.push({ data, changes });
          return true;
        },
        close: () => {
          closed = true;
        },
      };
    },
  });
  return {
    transport,
    published,
    tuned,
    isClosed: () => closed,
    hooks: () => hooks!,
    join: (state = initial, tuning?: TuningChange[]) => hooks!.onJoined(state, tuning),
  };
}

function collectHandlers(): TransportHandlers & { messages: string[]; opens: number; closes: number; errors: string[] } {
  const messages: string[] = [];
  const errors: string[] = [];
  let opens = 0;
  let closes = 0;
  return {
    messages,
    errors,
    get opens() {
      return opens;
    },
    get closes() {
      return closes;
    },
    onOpen: () => {
      opens++;
    },
    onMessage: (data) => {
      messages.push(data);
    },
    onClose: () => {
      closes++;
    },
    onError: (detail) => {
      errors.push(detail);
    },
  } as TransportHandlers & { messages: string[]; opens: number; closes: number; errors: string[] };
}

const envelope = (type: string, payload: unknown = {}) =>
  JSON.stringify({
    type,
    protocol: 1,
    room: 'test-room',
    clientId: 'peer-a',
    revision: 0,
    sentAt: 1,
    payload,
  });

describe('SpacetimeDbTransport', () => {
  it('is not open until the room reports it joined', () => {
    const room = fakeRoom();
    const handlers = collectHandlers();
    room.transport.open(handlers);
    // Connected-but-not-joined would race the first frame against membership.
    expect(room.transport.state).toBe('connecting');
    expect(handlers.opens).toBe(0);
    room.join();
    expect(room.transport.state).toBe('open');
    expect(handlers.opens).toBe(1);
  });

  it('refuses to send before the room is joined', () => {
    const room = fakeRoom();
    room.transport.open(collectHandlers());
    expect(room.transport.send(envelope('cells'))).toBe(false);
    expect(room.published).toEqual([]);
  });

  it('answers hello with a synthesized welcome instead of publishing it', () => {
    const room = fakeRoom();
    const handlers = collectHandlers();
    room.transport.open(handlers);
    room.join({ peers: 2, roles: ['play', 'builder'], revision: 7 });

    expect(room.transport.send(envelope('hello'))).toBe(true);
    expect(room.published).toEqual([]);

    const welcome = JSON.parse(handlers.messages[0]);
    expect(welcome.type).toBe('welcome');
    expect(welcome.payload.peers).toBe(2);
    expect(welcome.payload.clientId).toBe('peer-a');
    expect(welcome.revision).toBe(7);
  });

  it('never stamps synthesized envelopes with the receiving client id', () => {
    // AuthorLinkClient drops messages carrying its own clientId as self-echo.
    // Stamping 'peer-a' here would make every synthesized presence invisible
    // and freeze the peer count at zero forever.
    const room = fakeRoom();
    const handlers = collectHandlers();
    room.transport.open(handlers);
    room.join({ peers: 1, roles: ['play'], revision: 1 });
    room.transport.send(envelope('hello'));
    room.hooks().onState({ peers: 3, roles: ['play', 'play', 'builder'], revision: 9 });

    for (const raw of handlers.messages) {
      expect(JSON.parse(raw).clientId).not.toBe('peer-a');
    }
  });

  it('swallows heartbeats rather than spending a transaction on them', () => {
    const room = fakeRoom();
    room.transport.open(collectHandlers());
    room.join();
    expect(room.transport.send(envelope('ping'))).toBe(true);
    expect(room.transport.send(envelope('pong'))).toBe(true);
    expect(room.published).toEqual([]);
  });

  it('publishes every other message verbatim', () => {
    const room = fakeRoom();
    room.transport.open(collectHandlers());
    room.join();
    const cells = envelope('cells', { label: 'paint' });
    expect(room.transport.send(cells)).toBe(true);
    expect(room.published).toEqual([cells]);
  });

  it('delivers inbound frames byte-for-byte', () => {
    const room = fakeRoom();
    const handlers = collectHandlers();
    room.transport.open(handlers);
    room.join();
    const frame = envelope('objects', { objects: [] });
    room.hooks().onFrame(frame);
    expect(handlers.messages).toContain(frame);
  });

  it('turns a roster change into a presence message', () => {
    const room = fakeRoom();
    const handlers = collectHandlers();
    room.transport.open(handlers);
    room.join();
    room.hooks().onState({ peers: 2, roles: ['play', 'builder'], revision: 4 });
    const presence = JSON.parse(handlers.messages.at(-1)!);
    expect(presence.type).toBe('presence');
    expect(presence.payload).toEqual({ peers: 2, roles: ['play', 'builder'] });
  });

  it('routes tuning through the durable reducer, not the opaque frame path', () => {
    const room = fakeRoom();
    room.transport.open(collectHandlers());
    room.join();
    const changes: TuningChange[] = [{ path: 'global.ambient', value: 0.42 }];
    const data = envelope('tuning', { changes });
    expect(room.transport.send(data)).toBe(true);
    // Durable route, so a window joining later inherits it.
    expect(room.published).toEqual([]);
    expect(room.tuned).toHaveLength(1);
    expect(room.tuned[0].changes).toEqual(changes);
    // The envelope still travels verbatim, so receivers apply it normally.
    expect(room.tuned[0].data).toBe(data);
  });

  it('falls back to an ordinary frame when a tuning payload does not validate', () => {
    // The receiver's own allowlist is the real gate; a transport that started
    // refusing malformed protocol would be a second, divergent validator.
    const room = fakeRoom();
    room.transport.open(collectHandlers());
    room.join();
    const data = envelope('tuning', { changes: 'not-an-array' });
    expect(room.transport.send(data)).toBe(true);
    expect(room.tuned).toHaveLength(0);
    expect(room.published).toEqual([data]);
  });

  it('hands the accumulated room tuning to a late joiner in its welcome', () => {
    const room = fakeRoom();
    const handlers = collectHandlers();
    room.transport.open(handlers);
    const inherited: TuningChange[] = [
      { path: 'global.ambient', value: 0.42 },
      { path: 'global.simSpeed', value: 2 },
    ];
    room.join({ peers: 1, roles: ['play'], revision: 12 }, inherited);
    room.transport.send(envelope('hello'));
    const welcome = JSON.parse(handlers.messages[0]);
    expect(welcome.payload.tuning).toEqual(inherited);
  });

  it('reports a connector throw as a closed link, not an exception', () => {
    const handlers = collectHandlers();
    const transport = new SpacetimeDbTransport({
      ...BASE,
      connector: () => {
        throw new Error('no route to host');
      },
    });
    expect(() => transport.open(handlers)).not.toThrow();
    expect(handlers.errors[0]).toContain('no route to host');
    expect(handlers.closes).toBe(1);
    expect(transport.state).toBe('closed');
  });

  it('closes the underlying room and goes quiet', () => {
    const room = fakeRoom();
    const handlers = collectHandlers();
    room.transport.open(handlers);
    room.join();
    room.transport.close();
    expect(room.isClosed()).toBe(true);
    expect(room.transport.state).toBe('closed');

    const before = handlers.messages.length;
    room.hooks().onFrame(envelope('cells'));
    expect(handlers.messages.length).toBe(before);
    expect(room.transport.send(envelope('cells'))).toBe(false);
  });

  it('does not report a close twice when the room closes then is disposed', () => {
    const room = fakeRoom();
    const handlers = collectHandlers();
    room.transport.open(handlers);
    room.join();
    room.hooks().onClosed('server went away');
    expect(handlers.closes).toBe(1);
    room.hooks().onClosed('again');
    expect(handlers.closes).toBe(1);
  });
});

describe('AuthorLinkClient over SpacetimeDbTransport', () => {
  it('reaches connected state and counts peers without any relay', () => {
    let hooks: SpacetimeRoomHooks | null = null;
    const published: string[] = [];
    const client = new AuthorLinkClient({
      url: 'ws://unused',
      room: 'test-room',
      role: 'builder',
      build: 'test',
      clientId: 'peer-a',
      transportFactory: () =>
        new SpacetimeDbTransport({
          ...BASE,
          connector: (_o, h) => {
            hooks = h;
            return {
              publish: (d) => {
                published.push(d);
                return true;
              },
              publishTuning: (d) => {
                published.push(d);
                return true;
              },
              close: () => undefined,
            };
          },
        }),
    });

    client.connect();
    hooks!.onJoined({ peers: 1, roles: ['play'], revision: 5 });

    // The client sends `hello` on open; the transport answers it inline.
    expect(client.connected).toBe(true);
    expect(client.getStatus().kind).toBe('connected');
    expect(client.getStatus().peers).toBe(1);
    expect(client.getStatus().revision).toBe(5);

    client.send('tuning', { changes: [{ path: 'global.ambient', value: 0.5 }] });
    expect(published).toHaveLength(1);
    expect(JSON.parse(published[0]).payload.changes[0].path).toBe('global.ambient');

    hooks!.onState({ peers: 2, roles: ['play', 'sandbox'], revision: 6 });
    expect(client.getStatus().peers).toBe(2);

    client.dispose();
  });

  it('drops the client its own frames back without looping', () => {
    let hooks: SpacetimeRoomHooks | null = null;
    const seen: unknown[] = [];
    const client = new AuthorLinkClient({
      url: 'ws://unused',
      room: 'test-room',
      role: 'builder',
      build: 'test',
      clientId: 'peer-a',
      transportFactory: () =>
        new SpacetimeDbTransport({
          ...BASE,
          connector: (_o, h) => {
            hooks = h;
            return { publish: () => true, publishTuning: () => true, close: () => undefined };
          },
        }),
    });
    client.on('tuning', (m) => seen.push(m));
    client.connect();
    hooks!.onJoined({ peers: 1, roles: ['play'], revision: 1 });

    // SpacetimeDB delivers an event-table insert to the sender too.
    hooks!.onFrame(envelope('tuning', { changes: [] }));
    expect(seen).toHaveLength(0);

    const fromPeer = JSON.stringify({
      type: 'tuning',
      protocol: 1,
      room: 'test-room',
      clientId: 'peer-b',
      revision: 2,
      sentAt: 1,
      payload: { changes: [{ path: 'global.ambient', value: 1 }] },
    });
    hooks!.onFrame(fromPeer);
    expect(seen).toHaveLength(1);

    client.dispose();
  });
});

describe('module/client constant agreement', () => {
  it('keeps the module frame cap equal to MAX_MESSAGE_BYTES', () => {
    // The module cannot import the game's TypeScript, so the cap is copied.
    // A drifted copy means one side silently accepts what the other refuses.
    const source = readFileSync(
      resolve(__dirname, '..', 'servers', 'spacetime', 'spacetimedb', 'src', 'index.ts'),
      'utf8',
    );
    const match = /const MAX_FRAME_BYTES = (\d+) \* (\d+);/.exec(source);
    expect(match, 'MAX_FRAME_BYTES not found in the module').toBeTruthy();
    expect(Number(match![1]) * Number(match![2])).toBe(MAX_MESSAGE_BYTES);
  });
});

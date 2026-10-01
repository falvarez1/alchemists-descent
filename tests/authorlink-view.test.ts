import { describe, expect, it } from 'vitest';
import { resolveAuthorLinkConfig } from '@/app/authorLinkConfig';
import {
  builderUrl,
  deriveLinkView,
  gameUrl,
  isValidRoomName,
  makeRoomCode,
  parseLinkInput,
  type LinkViewInput,
} from '@/app/authorLinkView';
import type { AuthorLinkWorldState } from '@/app/AuthorLink';
import type { AuthorLinkStatus, WorldIdentity } from '@/net/authorLinkProtocol';

const world = (over: Partial<WorldIdentity> = {}): WorldIdentity => ({
  kind: 'level', levelId: 'd1', biome: 'earthen', seed: 48291, genVersion: 3, width: 1600, height: 1064, ...over,
});

const config = (over: Partial<LinkViewInput['config']> = {}): LinkViewInput['config'] => ({
  enabled: true, room: 'local', relay: 'dev-server', writable: true, ...over,
});

const connected = (peers: number): AuthorLinkStatus => ({ kind: 'connected', room: 'local', peers, revision: 4 });

const worldState = (over: Partial<AuthorLinkWorldState> = {}): AuthorLinkWorldState => ({
  mine: world(), peers: [], mismatch: false, canPull: true, mirror: 'off', ...over,
});

const view = (over: Partial<LinkViewInput>) =>
  deriveLinkView({ config: config(), status: connected(0), world: worldState(), isEditor: true, ...over });

describe('deriveLinkView', () => {
  it('explains why a window is not linking, per cause', () => {
    const off = view({ config: config({ enabled: false, disabledReason: 'off' }), status: null, world: null });
    expect(off.state).toBe('off');
    expect(off.summary).toMatch(/\?link=off/);

    const automated = view({ config: config({ enabled: false, disabledReason: 'automated' }), status: null, world: null });
    expect(automated.summary).toMatch(/automation/);
    // An automated page cannot be talked into linking by a button; it must ask by name.
    expect(automated.primary).toBeNull();

    const prod = view({ config: config({ enabled: false, disabledReason: 'production' }), status: null, world: null });
    expect(prod.primary?.id).toBe('start-linking');
  });

  it('walks the connection lifecycle', () => {
    expect(view({ status: null }).state).toBe('connecting');
    expect(view({ status: { kind: 'reconnecting', room: 'local', peers: 0, revision: 0, detail: 'socket error' } }).state).toBe('unreachable');
    expect(view({ status: { kind: 'error', room: 'local', peers: 0, revision: 0 } }).tone).toBe('danger');
  });

  it('offers the next step to an editor with nobody else in the room', () => {
    const v = view({ status: connected(0) });
    expect(v.state).toBe('waiting');
    expect(v.primary).toEqual({ id: 'open-game', label: 'Open game window' });
    // The game window is told to wait for an editor but is not handed a button that would open a second editor.
    expect(view({ isEditor: false, status: connected(0) }).primary).toBeNull();
  });

  it('says so when a hosted room will not take this window\'s writes', () => {
    const v = view({ config: config({ relay: 'hosted', writable: false }), status: connected(1) });
    expect(v.state).toBe('readonly');
    expect(v.tone).toBe('warn');
  });

  it('waits for a joining peer to announce its world before judging', () => {
    expect(view({ status: connected(1), world: worldState({ peers: [] }) }).state).toBe('handshake');
  });

  it('makes a different level the loudest thing, with pull as the one action', () => {
    const peers = [{ clientId: 'play-1', role: 'play' as const, world: world({ levelId: 'd2', seed: 7 }), sameWorld: false }];
    const v = view({ status: connected(1), world: worldState({ peers, mismatch: true }) });
    expect(v.state).toBe('different');
    expect(v.tone).toBe('warn');
    expect(v.primary).toMatchObject({ id: 'pull', label: "Use the game's level" });
    expect(v.primary?.disabledReason).toBeUndefined();
    expect(v.summary).toContain('d2 · earthen #7');
    expect(v.peers[0]).toMatchObject({ who: 'Game', sameWorld: false });
  });

  it('keeps pull unavailable, with the reason, in a window that is playing a live level', () => {
    const peers = [{ clientId: 'builder-1', role: 'builder' as const, world: world({ kind: 'sandbox', levelId: '' }), sameWorld: false }];
    const v = view({
      isEditor: false,
      status: connected(1),
      world: worldState({ peers, mismatch: true, canPull: false, pullBlockedReason: 'this window is playing d1' }),
    });
    expect(v.primary?.id).toBe('pull');
    expect(v.primary?.disabledReason).toMatch(/playing d1/);
  });

  it('lists what is kept in step when linked, and reports mirror direction', () => {
    const peers = [{ clientId: 'play-1', role: 'play' as const, world: world(), sameWorld: true }];
    const v = view({ status: connected(1), world: worldState({ peers, mirror: 'receiving' }) });
    expect(v.state).toBe('linked');
    expect(v.tone).toBe('ok');
    expect(v.label).toBe('Linked · Game');
    expect(v.summary).toMatch(/mirrored here live/);
    expect(v.synced).toContain('Terrain strokes');
    expect(v.primary).toBeNull();
  });
});

describe('rooms and addresses', () => {
  it('generates short, unambiguous, valid room codes', () => {
    for (let i = 0; i < 50; i++) {
      const code = makeRoomCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      expect(isValidRoomName(code)).toBe(true);
    }
    // Deterministic with an injected source.
    expect(makeRoomCode(() => 0)).toBe('AAAAAA');
  });

  it('takes ONLY a room name from pasted text', () => {
    expect(parseLinkInput('  K7P3QW ')).toBe('K7P3QW');
    expect(parseLinkInput('http://localhost:5173/?link=moss')).toBe('moss');
    expect(parseLinkInput('https://x.dev/builder.html?link=moss&linkServer=wss://evil.example')).toBe('moss');
    expect(parseLinkInput('')).toBeNull();
    expect(parseLinkInput('has space')).toBeNull();
    expect(parseLinkInput('../../etc')).toBeNull();
    expect(parseLinkInput('?link=off')).toBeNull();
    expect(parseLinkInput('http://x.dev/')).toBeNull();
  });

  it('builds explicit addresses for both windows', () => {
    expect(gameUrl('moss', 'http://localhost:5173')).toBe('http://localhost:5173/?link=moss');
    expect(builderUrl('moss', 'http://localhost:5173')).toBe('http://localhost:5173/builder.html?link=moss');
    expect(gameUrl('moss', 'https://x.dev', '/alchemists-descent/')).toBe('https://x.dev/alchemists-descent/?link=moss');
    expect(builderUrl('moss', 'https://x.dev', '/alchemists-descent/')).toBe('https://x.dev/alchemists-descent/builder.html?link=moss');
    // A bad room never reaches the address.
    expect(gameUrl('no spaces!', 'http://localhost:5173')).toBe('http://localhost:5173/?link=local');
  });
});

describe('resolveAuthorLinkConfig reports why it is off and whether it may write', () => {
  const loc = { protocol: 'http:', host: 'localhost:5173' };

  it('names the reason', () => {
    expect(resolveAuthorLinkConfig('?link=off', true, loc).disabledReason).toBe('off');
    expect(resolveAuthorLinkConfig('', true, loc, undefined, undefined, true).disabledReason).toBe('automated');
    expect(resolveAuthorLinkConfig('', false, loc).disabledReason).toBe('production');
    expect(resolveAuthorLinkConfig('', true, loc).disabledReason).toBeUndefined();
  });

  it('knows a tokenless hosted relay is read-only and the dev relay is not', () => {
    expect(resolveAuthorLinkConfig('', true, loc).writable).toBe(true);
    expect(resolveAuthorLinkConfig('?link=a', false, loc, 'wss://relay.example').writable).toBe(false);
    expect(resolveAuthorLinkConfig('?link=a', false, loc, 'wss://relay.example', 'secret').writable).toBe(true);
    expect(resolveAuthorLinkConfig('?link=a', false, loc, 'wss://relay.example').relay).toBe('hosted');
  });
});

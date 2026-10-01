import { AUTHORLINK_DEFAULT_ROOM, describeWorld, type AuthorLinkRole, type AuthorLinkStatus } from '@/net/authorLinkProtocol';
import type { AuthorLinkConfig } from '@/app/authorLinkConfig';
import type { AuthorLinkWorldState } from '@/app/AuthorLink';

/**
 * Everything the "Game Link" control shows, derived in one pure function.
 *
 * WHY A VIEW-MODEL. The link has a dozen ways to be not-quite-working (no peer
 * yet, wrong room, different level, read-only hosted room, relay down) and the
 * old header pill collapsed most of them into the same `LINK ·`. One function
 * that maps raw status + world state to a state, a sentence and at most ONE
 * primary action means the Builder toolbar, the game window's chip and the
 * tests all tell the same story — and the answer to "what do I click?" is
 * never a guess.
 *
 * This module is DOM-free and imports only types from the link, so it stays
 * out of the boot graph (`tests/bundle-layers.test.ts`).
 */

export type LinkStateId =
  /** This window is not linking at all. */
  | 'off'
  | 'connecting'
  /** The relay cannot be reached (or keeps dropping us). */
  | 'unreachable'
  /** Connected, but the room is read-only for us (hosted relay, no token). */
  | 'readonly'
  /** Connected, nobody else in the room. */
  | 'waiting'
  /** Somebody joined; they have not said which world they are on yet. */
  | 'handshake'
  /** At least one peer is on a different world: edits are being refused. */
  | 'different'
  /** Peers present and on our world: everything syncs. */
  | 'linked';

export type LinkTone = 'off' | 'busy' | 'ok' | 'warn' | 'danger';

export type LinkActionId =
  /** Open the game in a second window, in this room. */
  | 'open-game'
  /** Replace this window's world with the peer's. Destructive, explicit. */
  | 'pull'
  /** Reload this window with linking on. */
  | 'start-linking';

export interface LinkAction {
  id: LinkActionId;
  label: string;
  /** Why the action is unavailable right now, when it is. */
  disabledReason?: string;
}

export interface LinkPeerRow {
  clientId: string;
  /** "Game", "Sandbox", "Builder". */
  who: string;
  role: AuthorLinkRole;
  worldLabel: string;
  sameWorld: boolean;
}

export interface LinkView {
  state: LinkStateId;
  tone: LinkTone;
  /** Short text for the toolbar button. */
  label: string;
  /** One sentence: what is going on and why. */
  summary: string;
  /** What is being kept in step, for the linked state. */
  synced: string[];
  primary: LinkAction | null;
  peers: LinkPeerRow[];
  room: string;
  /** Live-simulation mirror direction, when the game is streaming to this window. */
  mirror: AuthorLinkWorldState['mirror'];
}

export interface LinkViewInput {
  config: Pick<AuthorLinkConfig, 'enabled' | 'room' | 'disabledReason' | 'relay' | 'writable'>;
  status: AuthorLinkStatus | null;
  world: AuthorLinkWorldState | null;
  /** True in the editor window: its primary action is to reach a game, not the reverse. */
  isEditor: boolean;
}

const ROLE_NAME: Record<AuthorLinkRole, string> = { play: 'Game', sandbox: 'Sandbox', builder: 'Builder' };

const OFF_SUMMARY = {
  off: 'Linking was switched off with ?link=off in the address.',
  automated: 'This page is under browser automation, which never links on its own.',
  production: 'Linking is off in this build. Add ?link=<room> to the address to turn it on.',
} as const;

/** What a healthy link keeps in step; shown as a checklist. */
export const LINK_SYNCED_THINGS = ['Terrain strokes', 'Placed objects and links', 'Lights', 'Live tuning', 'Console lines'] as const;

export function deriveLinkView(input: LinkViewInput): LinkView {
  const { config, status, world, isEditor } = input;
  const room = config.room;
  const peers: LinkPeerRow[] = (world?.peers ?? []).map((peer) => ({
    clientId: peer.clientId,
    who: ROLE_NAME[peer.role] ?? peer.role,
    role: peer.role,
    worldLabel: describeWorld(peer.world),
    sameWorld: peer.sameWorld,
  }));
  const mirror = world?.mirror ?? 'off';
  const base = { synced: [] as string[], peers, room, mirror };

  if (!config.enabled) {
    const reason = config.disabledReason ?? 'production';
    return {
      ...base,
      state: 'off',
      tone: 'off',
      label: 'Not linked',
      summary: OFF_SUMMARY[reason],
      primary: reason === 'production' || reason === 'off' ? { id: 'start-linking', label: 'Start linking' } : null,
    };
  }

  if (!status || status.kind === 'connecting' || status.kind === 'disabled') {
    return { ...base, state: 'connecting', tone: 'busy', label: 'Connecting…', summary: `Reaching the link relay for room "${room}".`, primary: null };
  }

  if (status.kind === 'reconnecting' || status.kind === 'error') {
    const why = status.detail ? ` (${status.detail})` : '';
    return {
      ...base,
      state: 'unreachable',
      tone: 'danger',
      label: 'No connection',
      summary:
        config.relay === 'hosted'
          ? `The hosted relay is not answering${why}. It retries on its own; check that this page's origin is allowed.`
          : `The dev server's link relay is not answering${why}. It retries on its own.`,
      primary: null,
    };
  }

  // Connected from here on.
  if (!config.writable) {
    return {
      ...base,
      state: 'readonly',
      tone: 'warn',
      label: 'Read-only',
      summary: 'This room is read-only for this window (no room token in this build), so your edits will not arrive.',
      primary: null,
    };
  }

  if (status.peers === 0) {
    return {
      ...base,
      state: 'waiting',
      tone: 'busy',
      label: isEditor ? 'Waiting for game…' : 'Waiting for editor…',
      summary: isEditor
        ? 'No other window is in this room yet. Open the game in a second window and they link up on their own.'
        : 'No editor is in this room yet. Open the Builder in another window and they link up on their own.',
      primary: isEditor ? { id: 'open-game', label: 'Open game window' } : null,
    };
  }

  if (!world || peers.length === 0) {
    return { ...base, state: 'handshake', tone: 'busy', label: 'Linking…', summary: 'A window joined. Waiting for it to say which level it is on.', primary: null };
  }

  if (world.mismatch) {
    const other = peers.find((p) => !p.sameWorld) ?? peers[0];
    const pullable = world.canPull;
    return {
      ...base,
      state: 'different',
      tone: 'warn',
      label: 'Different level',
      summary: isEditor
        ? `The ${other.who.toLowerCase()} window is on ${other.worldLabel}, not the level you are editing, so edits are being refused.`
        : `The editor is on another level (${other.worldLabel}), so its edits are being refused here.`,
      primary: {
        id: 'pull',
        label: isEditor ? "Use the game's level" : "Use the editor's level",
        ...(pullable ? {} : { disabledReason: world.pullBlockedReason ? `Not from here: ${world.pullBlockedReason}. Pull from the editor window.` : 'Pull from the editor window.' }),
      },
    };
  }

  const who = peers.length === 1 ? `the ${peers[0].who.toLowerCase()} window` : `${peers.length} windows`;
  return {
    ...base,
    state: 'linked',
    tone: 'ok',
    label: peers.length === 1 ? `Linked · ${peers[0].who}` : `Linked · ${peers.length} windows`,
    summary:
      mirror === 'receiving'
        ? `Linked to ${who}. Its simulation is mirrored here live.`
        : mirror === 'sending'
          ? `Linked to ${who}. This window's simulation streams there live.`
          : `Linked to ${who}. Changes show up in both.`,
    synced: [...LINK_SYNCED_THINGS],
    primary: null,
  };
}

/* ===================== rooms and addresses ===================== */

/** Room names are path-like identifiers; anything else is refused rather than escaped. */
const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export function isValidRoomName(room: string): boolean {
  return ROOM_PATTERN.test(room);
}

/** No 0/O/1/I/L: a code read aloud or retyped should not be ambiguous. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A fresh private room code, six characters. */
export function makeRoomCode(random: (n: number) => number = randomInt): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return out;
}

function randomInt(n: number): number {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    // Rejection-free is fine here: 2^32 mod 31 bias is negligible for a room name.
    c.getRandomValues(buf);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}

/**
 * Pull a room name out of whatever the user pasted: a bare code, or a whole
 * address carrying `?link=<room>`. ONLY the room is taken. The relay origin and
 * token are build-time settings and must never come from text a person pasted,
 * or a crafted link could point a window at someone else's relay.
 */
export function parseLinkInput(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  let candidate = raw;
  if (/[/?=]/.test(raw)) {
    try {
      const url = new URL(raw, 'http://placeholder.invalid');
      candidate = url.searchParams.get('link') ?? '';
    } catch {
      return null;
    }
  }
  return isValidRoomName(candidate) && candidate !== 'off' && candidate !== 'on' ? candidate : null;
}

/** Address of the game window for a room. Always explicit: automated and player builds never auto-link. */
export function gameUrl(room: string, origin: string, basePath = '/'): string {
  return withLink(origin, basePath, room);
}

/** Address of the standalone editor route for a room. */
export function builderUrl(room: string, origin: string, basePath = '/'): string {
  return withLink(origin, `${basePath.replace(/\/?$/, '/')}builder.html`, room);
}

function withLink(origin: string, path: string, room: string): string {
  const url = new URL(path, origin);
  url.searchParams.set('link', isValidRoomName(room) ? room : AUTHORLINK_DEFAULT_ROOM);
  return url.toString();
}

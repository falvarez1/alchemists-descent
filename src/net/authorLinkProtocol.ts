import type { CellPatch } from '@/authoring/cellPatch';
import type { EditorLight, EditorLink, EditorObject, EditorWorldLayer } from '@/authoring/document';

/**
 * AuthorLink wire protocol — the shared vocabulary between a browser client
 * and the relay (`scripts/authorlink-server.mjs`).
 *
 * Phase 1 scope (docs/REALTIME-TUNING-LAB-AND-MULTIPLAYER-SERVER-SPEC.md):
 * live tuning, terrain cell patches, and dev-console commands between two
 * windows of the same app — one with the Builder open, one playing.
 *
 * Design rules that outlive Phase 1:
 *
 * - Peers are SYMMETRIC. There is no editor/game authority; every client may
 *   publish and every client applies. `role` is presentation only. This keeps
 *   the relay dumb and means the same code works for N windows.
 * - Messages are DATA, never behavior. Nothing here names a function, a module
 *   path, or a script; the receiver decides what a message means. A tuning
 *   patch can only reach values the receiver's own allowlist admits.
 * - `clientId` echo suppression is the receiver's job, not the relay's, so a
 *   client reconnecting under a new id can never deadlock itself out of its
 *   own updates.
 *
 * This module is pure and dependency-free on purpose: the relay imports the
 * validators through a tiny JS mirror rather than the TypeScript build, so
 * keep everything here structural.
 */

export const AUTHORLINK_PROTOCOL = 1;

/** Default relay path, mounted on the Vite dev server in development. */
export const AUTHORLINK_PATH = '/__authorlink';

/** Room used when the URL does not name one. */
export const AUTHORLINK_DEFAULT_ROOM = 'local';

/** Presentation-only label for the presence list. */
export type AuthorLinkRole = 'sandbox' | 'play' | 'builder';

export type AuthorLinkStatusKind =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface AuthorLinkStatus {
  kind: AuthorLinkStatusKind;
  room: string;
  /** Peers in the room, excluding this client. */
  peers: number;
  /** Last room revision this client has seen. */
  revision: number;
  detail?: string;
}

/* ===================== tuning ===================== */

/**
 * A tuning value is addressed by a dotted path. Families:
 *
 *   global.<key>              GLOBAL_PARAMS
 *   player.<key>              PLAYER_PARAMS
 *   pacing.<key>              PROGRESSION_PACING
 *   gen.<key>                 GEN_TUNE
 *   materials.<cellId>.<key>  MATERIAL_PARAMS[cellId]
 *   spells.<spellId>.<key>    SPELL_PARAMS[spellId]
 *
 * Paths are validated against the SHIPPED DEFAULTS at apply time, not against
 * a hand-maintained list — see `tuningPatch.ts`. A hand-maintained list would
 * drift from `config/params.ts` the first time someone adds a dial.
 */
export type TuningScalar = number | boolean;

export interface TuningChange {
  path: string;
  value: TuningScalar;
}

export interface TuningPayload {
  changes: TuningChange[];
}

/* ===================== world identity ===================== */

/**
 * Which world a window is looking at.
 *
 * This exists because a `CellPatch` is just indices into `x + y * width`, and
 * EVERY world in this game is 1600x1064 — so "the dimensions match" is not
 * evidence of anything. Without an identity, a Builder stroke aimed at a
 * sandbox cave lands at the same array offsets inside a live D3 expedition,
 * silently, and the two windows look like they are cooperating when they are
 * corrupting each other.
 *
 * `genVersion` is part of the identity because two builds with different
 * generation semantics produce different worlds from the same seed; a stale
 * tab must not be treated as a peer on the same level.
 */
export interface WorldIdentity {
  /** `level` = a campaign level runtime, `sandbox` = the free-play grid, `custom` = a compiled document/playtest. */
  kind: 'level' | 'sandbox' | 'custom';
  /** Level id ('d1') for campaign levels, otherwise ''. */
  levelId: string;
  biome: string;
  seed: number;
  genVersion: number;
  width: number;
  height: number;
}

export function worldIdentityKey(id: WorldIdentity): string {
  return `${id.kind}:${id.levelId}:${id.biome}:${id.seed >>> 0}:${id.genVersion}:${id.width}x${id.height}`;
}

export function sameWorld(a: WorldIdentity | null, b: WorldIdentity | null): boolean {
  if (!a || !b) return false;
  return worldIdentityKey(a) === worldIdentityKey(b);
}

/** Short human label for the status pill and toasts. */
export function describeWorld(id: WorldIdentity | null): string {
  if (!id) return 'unknown';
  const where = id.kind === 'level' ? id.levelId || 'level' : id.kind;
  return `${where} · ${id.biome} #${id.seed >>> 0}`;
}

export function isWorldIdentity(value: unknown): value is WorldIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const id = value as Partial<WorldIdentity>;
  if (id.kind !== 'level' && id.kind !== 'sandbox' && id.kind !== 'custom') return false;
  if (typeof id.levelId !== 'string' || typeof id.biome !== 'string') return false;
  for (const n of [id.seed, id.genVersion, id.width, id.height]) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  }
  return true;
}

/* ===================== terrain ===================== */

export interface CellsPayload {
  /** The world these indices belong to. Refused outright when it is not ours. */
  world: WorldIdentity;
  /** Undo direction already resolved by the sender: this is what to stamp. */
  patch: CellPatch;
  /** Human label from the originating command ("paint", "prefab paste"). */
  label: string;
}

/* ===================== authored objects ===================== */

/**
 * The document's authored records, sent as a SET rather than per-record.
 *
 * Links wire doors to triggers across records and the shared instantiation
 * pass resolves that in one ordered sweep; a per-record protocol would need a
 * second wiring path that could drift from the playtest compiler. A set is a
 * few KB, so there is nothing to gain by being clever.
 */
export interface ObjectsPayload {
  world: WorldIdentity;
  objects: EditorObject[];
  links: EditorLink[];
  lights: EditorLight[];
}

/** Authored records above this in one message are refused. */
export const MAX_AUTHORED_OBJECTS = 4000;

/* ===================== world transfer ===================== */

/** Broadcast on join and whenever this window's world changes underneath it. */
export interface WorldAnnouncePayload {
  world: WorldIdentity;
}

/** "Send me your grid." Answered by exactly one peer — the one that owns `target`. */
export interface WorldRequestPayload {
  /** Client id being asked, so three open windows do not all answer at once. */
  target: string;
}

/**
 * A whole world on the wire.
 *
 * `EditorWorldLayer` is reused rather than inventing a second grid format: it
 * already solves the expensive part (colors are re-derived from the paint seed
 * instead of shipped, so a cave world is ~75 KB rather than ~6.6 MB).
 */
export interface WorldSnapshotPayload {
  world: WorldIdentity;
  layer: EditorWorldLayer;
}

/* ===================== peer presence ===================== */

/**
 * Where another window's wizard is, and roughly what it is doing.
 *
 * NON-AUTHORITATIVE, deliberately. This is the first slice of co-op
 * (docs/MULTIPLAYER-ARCHITECTURE.md stage 3): you see a peer move through your
 * world, but neither simulation yields authority to the other. That ordering
 * is the point — it answers "does streamed movement feel alive at 60 Hz"
 * without the 46-file refactor that a shared player roster needs, and the
 * refactor is far easier to justify once the feel is proven.
 *
 * WHY A POSE AND NOT THE PLAYER. `PlayerSprite` reads 40 distinct fields.
 * Streaming all of them would be both heavy and a lie — a peer's wizard is
 * rendered as a PHANTOM, visually distinct precisely because it is not
 * simulated here. So this carries only what a phantom needs to read as alive:
 * position, facing, motion, and enough gait state to move its legs.
 *
 * Sent ON CHANGE, never on a timer. A window whose player is standing still
 * publishes nothing at all, which keeps the room genuinely idle when it is
 * idle — an invariant the AuthorLink probe asserts.
 */
export interface PeerPosePayload {
  /** Refused on mismatch, exactly like a cell patch. */
  world: WorldIdentity;
  x: number;
  y: number;
  /** -1 or 1. */
  facing: number;
  /** Cells per frame, used to extrapolate through a dropped sample. */
  vx: number;
  vy: number;
  /** Gait phase, so the legs stride instead of sliding. */
  stride: number;
  /** Wand angle in radians. */
  aim: number;
  /** Bitfield — see PEER_FLAG_*. Cheaper and more extensible than 6 booleans. */
  flags: number;
}

export const PEER_FLAG_GROUNDED = 1 << 0;
export const PEER_FLAG_CRAWLING = 1 << 1;
export const PEER_FLAG_CLIMBING = 1 << 2;
export const PEER_FLAG_DEAD = 1 << 3;
export const PEER_FLAG_FIRING = 1 << 4;

export function isPeerPosePayload(value: unknown): value is PeerPosePayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<PeerPosePayload>;
  if (!isWorldIdentity(p.world)) return false;
  for (const n of [p.x, p.y, p.facing, p.vx, p.vy, p.stride, p.aim, p.flags]) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  }
  return true;
}

/* ===================== console ===================== */

export interface CommandPayload {
  /** A dev-console line, executed through `ctx.console.exec`. */
  line: string;
}

/* ===================== envelope ===================== */

interface Envelope<T extends string, P> {
  type: T;
  protocol: number;
  room: string;
  clientId: string;
  /** Room revision. Assigned by the relay on broadcast; 0 on client send. */
  revision: number;
  sentAt: number;
  payload: P;
}

export interface HelloPayload {
  role: AuthorLinkRole;
  /** Build stamp, so a stale window is visible instead of mysteriously wrong. */
  build: string;
  /**
   * Room token for a hosted room. Absent locally. A room that requires one and
   * does not get it still admits the client — read-only — so the failure shows
   * up in the status pill instead of as a mysterious disconnect.
   */
  token?: string;
}

export interface WelcomePayload {
  clientId: string;
  revision: number;
  peers: number;
  /** Accumulated room tuning, so a late window catches up on join. */
  tuning: TuningChange[];
}

export interface PresencePayload {
  peers: number;
  roles: AuthorLinkRole[];
}

export interface ErrorPayload {
  code: 'protocol' | 'rejected' | 'rate-limit' | 'too-large';
  detail: string;
}

export type AuthorLinkMessage =
  | Envelope<'hello', HelloPayload>
  | Envelope<'welcome', WelcomePayload>
  | Envelope<'presence', PresencePayload>
  | Envelope<'tuning', TuningPayload>
  | Envelope<'cells', CellsPayload>
  | Envelope<'cmd', CommandPayload>
  | Envelope<'objects', ObjectsPayload>
  | Envelope<'world.announce', WorldAnnouncePayload>
  | Envelope<'world.request', WorldRequestPayload>
  | Envelope<'world.snapshot', WorldSnapshotPayload>
  | Envelope<'peer', PeerPosePayload>
  | Envelope<'ping', Record<string, never>>
  | Envelope<'pong', Record<string, never>>
  | Envelope<'error', ErrorPayload>;

export type AuthorLinkMessageType = AuthorLinkMessage['type'];

/** Broadcast to the room rather than answered by the relay. */
export const RELAYED_TYPES: ReadonlySet<AuthorLinkMessageType> = new Set([
  'tuning',
  'cells',
  'cmd',
  'objects',
  'world.announce',
  'world.request',
  'world.snapshot',
  'peer',
]);

/**
 * Hard ceiling on a STREAMING message (tuning/cells/cmd), mirrored in the relay.
 *
 * A whole-world replace has no business on the incremental channel — that is
 * what `world.snapshot` is for. Capping here turns "someone flood-filled the
 * map" into a visible rejection instead of a stalled socket.
 */
export const MAX_MESSAGE_BYTES = 512 * 1024;

/**
 * Ceiling for `world.snapshot`, which is deliberately allowed to be large.
 *
 * A generated cave world is ~75 KB thanks to paint-seed color reconstruction,
 * but a heavily-scarred or hand-painted world falls back to shipping the whole
 * color plane, which is ~9 MB of base64. That is a rare, explicit, one-shot
 * user action, so it gets room rather than a mysterious failure.
 */
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

/** Cells above this in one patch are refused; the sender should resync instead. */
export const MAX_PATCH_CELLS = 40_000;

export function isAuthorLinkMessage(value: unknown): value is AuthorLinkMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Partial<AuthorLinkMessage>;
  if (typeof msg.type !== 'string') return false;
  if (msg.protocol !== AUTHORLINK_PROTOCOL) return false;
  if (typeof msg.room !== 'string' || typeof msg.clientId !== 'string') return false;
  if (typeof msg.revision !== 'number' || !Number.isFinite(msg.revision)) return false;
  if (typeof msg.sentAt !== 'number' || !Number.isFinite(msg.sentAt)) return false;
  if (typeof msg.payload !== 'object' || msg.payload === null) return false;
  return (
    msg.type === 'hello' ||
    msg.type === 'welcome' ||
    msg.type === 'presence' ||
    msg.type === 'tuning' ||
    msg.type === 'cells' ||
    msg.type === 'cmd' ||
    msg.type === 'objects' ||
    msg.type === 'world.announce' ||
    msg.type === 'world.request' ||
    msg.type === 'world.snapshot' ||
    msg.type === 'peer' ||
    msg.type === 'ping' ||
    msg.type === 'pong' ||
    msg.type === 'error'
  );
}

export function isTuningPayload(value: unknown): value is TuningPayload {
  if (typeof value !== 'object' || value === null) return false;
  const { changes } = value as Partial<TuningPayload>;
  if (!Array.isArray(changes)) return false;
  return changes.every(
    (c) =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as TuningChange).path === 'string' &&
      (typeof (c as TuningChange).value === 'number' || typeof (c as TuningChange).value === 'boolean') &&
      (typeof (c as TuningChange).value !== 'number' || Number.isFinite((c as TuningChange).value)),
  );
}

export function isCommandPayload(value: unknown): value is CommandPayload {
  if (typeof value !== 'object' || value === null) return false;
  const { line } = value as Partial<CommandPayload>;
  return typeof line === 'string' && line.length > 0 && line.length <= 512;
}

/** Short, readable client id. Not a security token — rooms are dev-local. */
export function makeClientId(role: AuthorLinkRole, random = Math.random): string {
  return `${role}-${random().toString(36).slice(2, 8)}`;
}

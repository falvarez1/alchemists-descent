import type { Ctx } from '@/core/types';
import type { CellPatch } from '@/authoring/cellPatch';
import { applyCellPatch, cellPatchBounds, isValidCellPatch } from '@/authoring/cellPatch';
import { applyWorldLayer, captureWorldLayer } from '@/authoring/worldLayer';
import { GEN_VERSION } from '@/config/gen';
import { HEIGHT, WIDTH } from '@/config/constants';
import { BIOMES } from '@/config/biomes';
import { AuthorLinkClient } from '@/net/AuthorLinkClient';
import {
  AUTHORLINK_DEFAULT_ROOM,
  AUTHORLINK_PATH,
  MAX_AUTHORED_OBJECTS,
  MAX_PATCH_CELLS,
  describeWorld,
  isCommandPayload,
  isTuningPayload,
  isWorldIdentity,
  makeClientId,
  sameWorld,
  type AuthorLinkRole,
  type AuthorLinkStatus,
  type TuningChange,
  type WorldIdentity,
} from '@/net/authorLinkProtocol';
import { AuthoredObjectSync, isAuthoredSet } from '@/app/authorLinkObjects';
import type { AuthoredSet } from '@/app/authorLinkObjects';
import {
  applyTuningChanges,
  captureTuningChanges,
  diffTuningChanges,
} from '@/net/tuningPatch';
import { currentAppMode } from '@/game/modePersist';

/**
 * AuthorLink runtime binding — Phase 1 of
 * docs/REALTIME-TUNING-LAB-AND-MULTIPLAYER-SERVER-SPEC.md.
 *
 * Opens one app window as a peer in a room and keeps three channels live:
 *
 *   tuning  every `paramsChanged` publishes a sparse diff; remote diffs land
 *           on the same mutable config singletons and re-emit `paramsChanged`
 *           so Inspector/Builder mirrors resync.
 *   cells   Builder terrain strokes publish their `CellPatch`; remote patches
 *           stamp straight into the live world.
 *   cmd     dev-console lines run through `ctx.console.exec` on every peer.
 *
 * This is shell glue, not gameplay: it lives in `src/app` beside the other
 * lifecycle owners so `Game` never learns the link exists, and the Builder
 * reaches it only through `BuilderHost`.
 *
 * ECHO CONTROL. Two guards, because the two directions fail differently:
 * the client drops messages carrying our own `clientId` (so a subscriber can
 * never see its own publish), and `applyingRemote` suppresses the outbound
 * tuning publisher while a remote patch is being applied (otherwise the
 * `paramsChanged` we emit to resync the UI would bounce straight back).
 */

export interface AuthorLinkPeerWorld {
  clientId: string;
  role: AuthorLinkRole;
  world: WorldIdentity;
}

export interface AuthorLinkWorldState {
  /** This window's world. */
  mine: WorldIdentity;
  /** Peers that have announced, newest announcement wins per client. */
  peers: AuthorLinkPeerWorld[];
  /** True when at least one peer is on a different world than us. */
  mismatch: boolean;
}

export interface AuthorLinkHandle {
  publishTerrainPatch(patch: CellPatch, label: string): void;
  /** Publish the whole authored set; the receiver replaces what it holds. */
  publishAuthoredSet(set: AuthoredSet): void;
  publishCommand(line: string): void;
  getStatus(): AuthorLinkStatus;
  onStatus(handler: (status: AuthorLinkStatus) => void): () => void;
  /** Traffic by message type; used to catch feedback loops in the probe. */
  getStats(): { sent: Record<string, number>; received: Record<string, number> };
  /** Current world identities, for the pill and the Builder's link panel. */
  getWorldState(): AuthorLinkWorldState;
  onWorldState(handler: (state: AuthorLinkWorldState) => void): () => void;
  /**
   * Replace this window's world with a peer's live grid. Resolves false when
   * there is no such peer or the transfer times out. Destructive by design —
   * only call it from an explicit user action.
   */
  pullWorldFrom(clientId?: string): Promise<boolean>;
  dispose(): void;
}

export interface AuthorLinkConfig {
  enabled: boolean;
  url: string;
  room: string;
  /** Hosted-room write token, from VITE_AUTHORLINK_TOKEN. Never from the URL. */
  token?: string;
}

/** Coalesces a slider drag into one publish per frame-ish instead of per input event. */
const PUBLISH_DEBOUNCE_MS = 60;

/**
 * Resolve whether this window links, and to where.
 *
 * Dev links by default — two windows syncing with no ceremony is the entire
 * feature. Production stays off unless the URL asks, because a shipped build
 * must never open a socket the player did not request.
 *
 *   ?link=off          force off (dev escape hatch)
 *   ?link=<room>       force on, named room
 *   VITE_AUTHORLINK_URL override the relay origin (two machines)
 *
 * AUTOMATED PAGES DO NOT AUTO-LINK. The repo drives a dozen headless probes
 * against one dev server, often several pages at once. With dev auto-linking,
 * every one of those pages would silently join room `local` and start applying
 * each other's tuning and terrain — turning independent probes into a shared
 * session and producing failures that look like real regressions in whatever
 * probe happened to run second. An automated page must ask for the link by
 * name; the AuthorLink probes do exactly that.
 */
export function resolveAuthorLinkConfig(
  search: string,
  isDev: boolean,
  location: { protocol: string; host: string },
  envUrl?: string,
  envToken?: string,
  isAutomated = false,
): AuthorLinkConfig {
  const params = new URLSearchParams(search);
  const link = params.get('link');
  const room = link && link !== 'off' && link !== 'on' ? link : AUTHORLINK_DEFAULT_ROOM;
  const autoLink = isDev && !isAutomated;
  const enabled = link === 'off' ? false : autoLink || Boolean(link);
  const base = envUrl && envUrl.length > 0 ? envUrl.replace(/\/$/, '') : null;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const origin = base ?? `${scheme}//${location.host}`;
  // The relay origin and token come from BUILD-TIME env only, never from the
  // query string. A `?linkServer=` parameter would let any link pointed at a
  // deployed build stream that session's tuning and terrain to an attacker's
  // socket; the room name is the only thing safe to take from the URL.
  return {
    enabled,
    url: `${origin}${AUTHORLINK_PATH}?room=${encodeURIComponent(room)}`,
    room,
    ...(envToken ? { token: envToken } : {}),
  };
}

function currentRole(ctx: Ctx): AuthorLinkRole {
  const mode = currentAppMode(ctx.state.mode);
  return mode === 'builder' ? 'builder' : mode === 'play' ? 'play' : 'sandbox';
}

/**
 * What world is this window showing right now?
 *
 * A campaign level is identified by its level id; a disposable Builder/Sandbox
 * playtest is `custom` (its cells are compiled from a document, so its seed
 * says nothing); everything else is the free sandbox grid. `genVersion` rides
 * along so two tabs on different builds are never mistaken for peers.
 */
export function currentWorldIdentity(ctx: Ctx): WorldIdentity {
  const level = ctx.levels.current;
  const custom = ctx.state.playtestSource !== null;
  return {
    kind: custom ? 'custom' : level ? 'level' : 'sandbox',
    levelId: !custom && level ? level.def.id : '',
    biome: ctx.state.currentBiome,
    seed: ctx.state.worldSeed >>> 0,
    genVersion: GEN_VERSION,
    width: ctx.world.width,
    height: ctx.world.height,
  };
}

export function installAuthorLink(ctx: Ctx, config: AuthorLinkConfig): AuthorLinkHandle | null {
  if (!config.enabled || typeof WebSocket === 'undefined') return null;

  const role = currentRole(ctx);
  const client = new AuthorLinkClient({
    url: config.url,
    room: config.room,
    role,
    build: typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'unknown',
    clientId: makeClientId(role),
    token: config.token,
  });

  let applyingRemote = false;
  let lastPublished: TuningChange[] = captureTuningChanges();
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  const disposers: Array<() => void> = [];

  /* -------------------- world identity -------------------- */

  /**
   * A pulled world keeps the SENDER's identity, not one derived from our ctx.
   *
   * After pulling a peer's live `d2`, this window holds d2's cells but has no
   * level runtime — so `currentWorldIdentity` would call it `sandbox` and the
   * next poll would revert the adoption, putting the two windows straight back
   * into "different worlds" and refusing every stroke. `base` is what our ctx
   * looked like at adoption time; the adoption is dropped the moment our own
   * world genuinely changes underneath it (regenerate, level transition).
   */
  let adopted: { identity: WorldIdentity; base: WorldIdentity } | null = null;

  const effectiveIdentity = (): WorldIdentity => {
    const base = currentWorldIdentity(ctx);
    if (adopted && sameWorld(base, adopted.base)) return adopted.identity;
    adopted = null;
    return base;
  };

  let myWorld = effectiveIdentity();
  const peerWorlds = new Map<string, AuthorLinkPeerWorld>();
  const worldStateHandlers = new Set<(state: AuthorLinkWorldState) => void>();
  /** Rate-limited toast so a held brush over a mismatched world says it once. */
  let lastMismatchWarnAt = 0;

  /**
   * Feedback for edits arriving from the other window.
   *
   * Without this the world just silently changes around you while you play,
   * which reads as a glitch rather than as your collaborator working. A brush
   * held down publishes many strokes a second, so the toast is coalesced into
   * a periodic summary; the bloom pulse is per-patch because it decays on its
   * own and reads as texture rather than noise.
   */
  let incomingCells = 0;
  let incomingEdits = 0;
  let lastIncomingToastAt = 0;

  const notifyIncomingEdit = (cells: number): void => {
    incomingCells += cells;
    incomingEdits++;
    // A soft pulse, well under a spell hit (0.5-1.6), so it never competes
    // with combat feedback.
    ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 0.22);
    const now = Date.now();
    if (now - lastIncomingToastAt < 900) return;
    lastIncomingToastAt = now;
    const label =
      incomingEdits === 1 ? `LINK: +${incomingCells} CELLS` : `LINK: ${incomingEdits} EDITS · ${incomingCells} CELLS`;
    ctx.events.emit('toast', { text: label });
    incomingCells = 0;
    incomingEdits = 0;
  };

  const warnCrossWorld = (peerWorld: unknown, what: string): void => {
    const now = Date.now();
    if (now - lastMismatchWarnAt <= 4000) return;
    lastMismatchWarnAt = now;
    const peer = isWorldIdentity(peerWorld) ? peerWorld : null;
    ctx.events.emit('toast', { text: `LINK: EDIT REFUSED — PEER IS ON ${describeWorld(peer).toUpperCase()}` });
    console.warn(`[authorlink] refused a ${what} from a different world`, { peer, mine: myWorld });
  };

  const worldState = (): AuthorLinkWorldState => {
    const peers = [...peerWorlds.values()];
    return { mine: myWorld, peers, mismatch: peers.some((p) => !sameWorld(p.world, myWorld)) };
  };

  const emitWorldState = (): void => {
    const state = worldState();
    for (const handler of [...worldStateHandlers]) handler(state);
  };

  const announceWorld = (): void => {
    client.send('world.announce', { world: myWorld });
  };

  /**
   * The world can change without the link being told — a level transition, a
   * Generate Caves click, a playtest start. Poll the identity rather than
   * threading a notification through every one of those paths: it is a cheap
   * struct compare, and a missed announcement means silently-refused patches,
   * which is exactly the failure this whole mechanism exists to prevent.
   */
  const refreshMyWorld = (): void => {
    const next = effectiveIdentity();
    if (sameWorld(next, myWorld)) return;
    myWorld = next;
    announceWorld();
    emitWorldState();
  };
  const worldPollTimer = globalThis.setInterval(refreshMyWorld, 500);
  disposers.push(() => globalThis.clearInterval(worldPollTimer));

  const publishTuningNow = (): void => {
    publishTimer = null;
    const next = captureTuningChanges();
    const changes = diffTuningChanges(lastPublished, next);
    if (changes.length === 0) return;
    if (!client.send('tuning', { changes })) return;
    lastPublished = next;
  };

  const schedulePublishTuning = (): void => {
    if (applyingRemote || publishTimer !== null) return;
    publishTimer = globalThis.setTimeout(publishTuningNow, PUBLISH_DEBOUNCE_MS);
  };

  disposers.push(ctx.events.on('paramsChanged', schedulePublishTuning));

  const applyRemoteTuning = (changes: readonly TuningChange[]): void => {
    applyingRemote = true;
    try {
      const result = applyTuningChanges(changes);
      if (result.applied > 0) ctx.events.emit('paramsChanged');
      if (result.rejected.length > 0) {
        console.warn('[authorlink] rejected unknown tuning paths', result.rejected);
      }
    } finally {
      applyingRemote = false;
      // Adopt the post-apply state as the publish baseline so the very next
      // local change diffs against what we actually hold, not what we last sent.
      lastPublished = captureTuningChanges();
    }
  };

  disposers.push(
    client.on('welcome', (message) => {
      if (message.payload.tuning.length > 0) applyRemoteTuning(message.payload.tuning);
    }),
  );

  disposers.push(
    client.on('tuning', (message) => {
      if (!isTuningPayload(message.payload)) return;
      applyRemoteTuning(message.payload.changes);
    }),
  );

  disposers.push(
    client.on('cells', (message) => {
      const { payload } = message;
      const world = ctx.world;
      // A CellPatch is only indices. Every world in this game is the same size,
      // so the identity — not the dimensions — is what makes a replay legitimate.
      // Refuse rather than stamp: landing a stroke in the wrong level looks like
      // the link working right up until you notice the level is ruined.
      if (!isWorldIdentity(payload.world) || !sameWorld(payload.world, myWorld)) {
        warnCrossWorld(payload.world, 'cell patch');
        return;
      }
      if (!isValidCellPatch(payload.patch, world.types.length)) {
        console.warn('[authorlink] ignoring malformed cell patch');
        return;
      }
      if (payload.patch.idxs.length > MAX_PATCH_CELLS) {
        console.warn('[authorlink] ignoring oversized cell patch');
        return;
      }
      const cells = applyCellPatch(world, payload.patch);
      if (cells === 0) return;
      const bounds = cellPatchBounds(payload.patch, world.width) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
      // The documented bridge for "raw live-world edits from a dev tool": it
      // marks Builder divergence and gives every surface one signal to react to.
      ctx.events.emit('worldEdited', {
        source: 'authorlink',
        command: payload.label,
        target: 'world',
        bounds,
        cells,
      });
      notifyIncomingEdit(cells);
    }),
  );

  const objectSync = new AuthoredObjectSync(ctx);
  disposers.push(() => objectSync.teardown());

  disposers.push(
    client.on('objects', (message) => {
      const { payload } = message;
      if (!isWorldIdentity(payload.world) || !sameWorld(payload.world, myWorld)) {
        warnCrossWorld(payload.world, 'authored objects');
        return;
      }
      if (!isAuthoredSet(payload)) {
        console.warn('[authorlink] ignoring malformed authored set');
        return;
      }
      if (payload.objects.length > MAX_AUTHORED_OBJECTS) {
        console.warn('[authorlink] ignoring oversized authored set');
        return;
      }
      const result = objectSync.apply({
        objects: payload.objects,
        links: payload.links,
        lights: payload.lights,
      });
      if (!result.ok) {
        ctx.events.emit('toast', { text: `LINK: OBJECTS NEED A LEVEL — ${(result.reason ?? '').toUpperCase()}` });
        return;
      }
      ctx.events.emit('toast', {
        text: `LINK: ${result.objects} OBJECT${result.objects === 1 ? '' : 'S'} · ${result.mechanisms} MECH`,
      });
    }),
  );

  disposers.push(
    client.on('cmd', (message) => {
      if (!isCommandPayload(message.payload)) return;
      void ctx.console.exec(message.payload.line).catch((error: unknown) => {
        console.warn('[authorlink] remote command failed', error);
      });
    }),
  );

  /* -------------------- world channel -------------------- */

  disposers.push(
    client.on('world.announce', (message) => {
      if (!isWorldIdentity(message.payload.world)) return;
      // Reply ONLY to a peer we have not met. Answering every announcement is
      // an infinite loop — each reply is itself an announcement — which pins
      // the relay at its rate limit and starves the tuning and cell channels.
      const firstContact = !peerWorlds.has(message.clientId);
      peerWorlds.set(message.clientId, {
        clientId: message.clientId,
        role: roleFromClientId(message.clientId),
        world: message.payload.world,
      });
      emitWorldState();
      // Whoever joined first would otherwise never learn the newcomer's world.
      if (firstContact) announceWorld();
    }),
  );

  disposers.push(
    client.on('presence', (message) => {
      // Presence carries a count, not ids, so a departure cannot be attributed.
      // When the room shrinks below what we are tracking, drop everything and
      // re-handshake: a stale entry for a closed window would otherwise show a
      // permanent phantom mismatch that no amount of syncing can clear.
      if (message.payload.peers >= peerWorlds.size) return;
      peerWorlds.clear();
      emitWorldState();
      if (message.payload.peers > 0) announceWorld();
    }),
  );

  disposers.push(
    client.on('world.request', (message) => {
      if (message.payload.target !== client.clientId) return;
      const paintSeed = ctx.worldgen?.paintSeed;
      const layer = captureWorldLayer({
        world: ctx.world,
        biome: ctx.state.currentBiome,
        seed: ctx.state.worldSeed >>> 0,
        paintSeed: typeof paintSeed === 'number' && Number.isFinite(paintSeed) ? paintSeed : null,
      });
      client.send('world.snapshot', { world: myWorld, layer });
    }),
  );

  let pendingPull: { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  disposers.push(
    client.on('world.snapshot', (message) => {
      if (!pendingPull) return; // unsolicited grids are never applied
      if (!isWorldIdentity(message.payload.world)) return;
      const layer = message.payload.layer;
      if (!layer || typeof layer.rle !== 'string') return;
      applyWorldLayer(
        { world: ctx.world, biome: ctx.state.currentBiome, seed: ctx.state.worldSeed >>> 0 },
        layer,
      );
      // Adopt the sender's identity wholesale: we are now looking at their
      // world, and claiming our own seed/level would put us right back into
      // "same pixels, different identity" and refuse every subsequent stroke.
      ctx.state.currentBiome = isKnownBiome(message.payload.world.biome)
        ? (message.payload.world.biome as Ctx['state']['currentBiome'])
        : ctx.state.currentBiome;
      ctx.state.worldSeed = message.payload.world.seed >>> 0;
      // Record the adoption AFTER the ctx writes above, so `base` is what the
      // poll will actually recompute; otherwise the very next tick drops it.
      adopted = {
        identity: { ...message.payload.world, width: ctx.world.width, height: ctx.world.height },
        base: currentWorldIdentity(ctx),
      };
      myWorld = adopted.identity;
      announceWorld();
      emitWorldState();
      ctx.events.emit('worldEdited', {
        source: 'authorlink',
        command: 'pull world',
        target: 'world',
        bounds: { x0: 0, y0: 0, x1: WIDTH - 1, y1: HEIGHT - 1 },
        cells: ctx.world.types.length,
      });
      ctx.events.emit('toast', { text: `LINK: PULLED ${describeWorld(myWorld).toUpperCase()}` });
      const pull = pendingPull;
      pendingPull = null;
      globalThis.clearTimeout(pull.timer);
      pull.resolve(true);
    }),
  );

  // A reconnect may have missed changes in both directions. Re-publishing our
  // full sparse snapshot is cheap and converges the room without a resync
  // protocol; the relay folds it into the room state for later joiners.
  // Status notifies on ANY field change, and `revision` moves with every single
  // relayed message — so this must react to a kind TRANSITION, never to the
  // event itself. Sending on every status callback means sending once per
  // message received, which is an unbounded storm between two peers.
  let lastKind: AuthorLinkStatus['kind'] | null = null;
  disposers.push(
    client.onStatus((status) => {
      const changed = status.kind !== lastKind;
      lastKind = status.kind;
      if (!changed) return;
      if (status.kind === 'reconnecting' || status.kind === 'error') {
        // Peer worlds are unknowable while we are offline; claiming otherwise
        // would leave a stale "same world" badge on a dead socket.
        peerWorlds.clear();
        emitWorldState();
        return;
      }
      if (status.kind !== 'connected') return;
      lastPublished = [];
      schedulePublishTuning();
      myWorld = effectiveIdentity();
      announceWorld();
      emitWorldState();
    }),
  );

  client.connect();

  return {
    publishTerrainPatch(patch: CellPatch, label: string): void {
      if (patch.idxs.length === 0 || patch.idxs.length > MAX_PATCH_CELLS) return;
      // `sendCells` packs the columns when the link can carry bytes (~2x) and
      // falls back to JSON when it cannot, so authoring behaves identically
      // either way.
      client.sendCells({ world: myWorld, patch, label });
    },
    publishAuthoredSet(set: AuthoredSet): void {
      if (set.objects.length > MAX_AUTHORED_OBJECTS) return;
      client.send('objects', { world: myWorld, objects: set.objects, links: set.links, lights: set.lights });
    },
    publishCommand(line: string): void {
      if (line.length === 0) return;
      client.send('cmd', { line });
    },
    getStatus: () => client.getStatus(),
    onStatus: (handler) => client.onStatus(handler),
    getStats: () => client.getStats(),
    getWorldState: () => worldState(),
    onWorldState(handler): () => void {
      worldStateHandlers.add(handler);
      handler(worldState());
      return () => worldStateHandlers.delete(handler);
    },
    pullWorldFrom(clientId?: string): Promise<boolean> {
      const target = clientId ?? [...peerWorlds.keys()][0];
      if (!target || !client.connected) return Promise.resolve(false);
      if (pendingPull) return Promise.resolve(false);
      if (!client.send('world.request', { target })) return Promise.resolve(false);
      ctx.events.emit('toast', { text: 'LINK: PULLING WORLD…' });
      return new Promise<boolean>((resolve) => {
        const timer = globalThis.setTimeout(() => {
          pendingPull = null;
          ctx.events.emit('toast', { text: 'LINK: WORLD PULL TIMED OUT' });
          resolve(false);
        }, 20_000);
        pendingPull = { resolve, timer };
      });
    },
    dispose(): void {
      if (publishTimer !== null) globalThis.clearTimeout(publishTimer);
      if (pendingPull) {
        globalThis.clearTimeout(pendingPull.timer);
        pendingPull.resolve(false);
        pendingPull = null;
      }
      worldStateHandlers.clear();
      for (const dispose of disposers.splice(0).reverse()) dispose();
      client.dispose();
    },
  };
}

/** Client ids are `${role}-${rand}`; the role prefix is display-only. */
function roleFromClientId(clientId: string): AuthorLinkRole {
  const prefix = clientId.split('-')[0];
  return prefix === 'builder' || prefix === 'play' ? prefix : 'sandbox';
}

const BIOME_IDS: ReadonlySet<string> = new Set(Object.keys(BIOMES));

function isKnownBiome(value: string): boolean {
  return BIOME_IDS.has(value);
}

# Realtime Tuning Lab and Multiplayer Server Spec

- Status: preliminary design and technology research
- Date: 2026-06-20
- Scope: static GitHub Pages client plus a separate realtime server for shared
  tuning now and multiplayer later.

## Executive Direction

Host the Vite static build on GitHub Pages and keep every realtime feature in a
separate service reached over `wss://`. GitHub Pages is static hosting for HTML,
CSS, and JavaScript, so it is a good fit for the game client but not for room
state, streaming, WebSocket fanout, authority, persistence, or matchmaking.

The first server feature should be a dedicated Tuning Lab, not multiplayer. It
should let one or more game clients and one or more lab clients join a named
room, change allowlisted tuning values, and see those changes applied live on
all connected machines. The protocol and validation should be designed so the
same room/session model can later grow into multiplayer without exposing raw
runtime state or accepting arbitrary client mutations.

Recommended first implementation path:

1. Define a provider-neutral realtime protocol in the client.
2. Add a local Node or Bun `ws` reference server for fast development and tests.
3. Spike Cloudflare Durable Objects as the first hosted Tuning Lab relay.
4. Spike SpacetimeDB and .NET SignalR/Orleans separately before choosing a
   future multiplayer authority stack.

## Current Game Integration Points

The game already has the right local seam for live tuning:

- `src/config/tuningStore.ts` captures sparse diffs for `global`, `player`,
  `gen`, `materials`, `spells`, and `brushSize`.
- `Game` installs tuning persistence once during boot with
  `installTuningPersistence(ctx)`.
- Sandbox and Builder controls emit the shared `paramsChanged` event after
  tuning mutations.
- Existing local persistence stores sparse diffs against shipped defaults, which
  is the correct shape for a network patch.

The remote tuning client should build on that seam:

- Listen for local `paramsChanged`.
- Capture a sparse diff.
- Send only changed allowlisted paths to the realtime server.
- Apply remote patches to the same mutable tuning singletons.
- Emit `paramsChanged` after applying remote patches so Inspector, Builder, and
  runtime mirrors resync.
- Suppress echo loops by tagging each outbound change with `clientId`,
  `mutationId`, and `baseRevision`.

Known tuning debt to resolve before the feature feels complete:

- Some wand/card modifier behavior still lives as constants in runtime code,
  especially in `src/combat/wands/compiler.ts`. Those values should move behind
  structured tuning objects before the lab claims full spell/card coverage.
- Network tuning must never mutate raw `Ctx`, `World`, entity arrays, DOM nodes,
  or arbitrary JavaScript. It only applies typed tuning documents.

## Goals

- Cross-computer live tuning for global params, player movement, worldgen,
  materials, spells, and eventually card/wand constants.
- A separate Tuning Lab browser surface that can run beside the game.
- Room-based sessions with explicit connect/disconnect state.
- Snapshot-on-join so a late client receives current room state.
- Patch fanout with revision ordering and conflict visibility.
- Validation, range checks, path allowlists, rate limits, and role checks.
- Static client deployable to GitHub Pages with no server dependency unless the
  user explicitly enables realtime tuning.
- Architecture that can later support multiplayer room lifecycle, presence,
  matchmaking, and server authority.

## Non-Goals For The First Slice

- No multiplayer gameplay implementation.
- No full world-grid streaming.
- No remote execution, script injection, or arbitrary config editing.
- No account system unless private room tokens are not enough.
- No persistence to save files or committed game data until the user explicitly
  chooses to commit a tuning preset.

## Client Architecture

Add a small realtime client layer that is optional at runtime.

Suggested files:

- `src/net/realtimeProtocol.ts`
  - shared message types, version constants, validation helpers.
- `src/net/TuningClient.ts`
  - WebSocket connection, reconnect, heartbeats, outgoing patch queue.
- `src/net/applyTuningPatch.ts`
  - allowlisted application of remote values to live tuning objects.
- `src/ui/TuningConnectionPanel.ts`
  - connect status, room id, role, last patch, errors, disconnect.
- `src/app/tuningLab.ts`
  - optional dedicated lab entrypoint if the Builder/game split wants separate
    bundles later.

Connection should be opt-in:

- Query string: `?tune=room-id`.
- Local dev env: `VITE_TUNING_SERVER_URL=ws://localhost:8787`.
- Production env: `VITE_TUNING_SERVER_URL=wss://tuning.example.com`.
- UI command: "Connect Tuning Lab" from diagnostics/developer surfaces.

The game should continue to run normally when the server is absent.

## Room Model

Each room has:

- `roomId`: short, human-shareable id.
- `protocolVersion`: client/server compatibility guard.
- `schemaVersion`: tuning schema revision.
- `revision`: monotonically increasing integer.
- `snapshot`: current sparse tuning document.
- `clients`: presence records for connected clients.
- `locks`: optional path locks for sliders being dragged.
- `history`: bounded recent patch log for reconnect and debugging.

Roles:

- `lab`: can propose tuning changes and manage presets.
- `game`: receives patches, can optionally publish local game-side changes.
- `spectator`: receives state only.
- `admin`: can reset room, kick clients, and commit presets.

## Protocol Draft

Use JSON first. Move hot paths to MessagePack only if the patches become large
or frequent enough to justify binary tooling.

Envelope:

```ts
type RealtimeMessage = {
  type: string;
  protocol: 1;
  roomId: string;
  clientId: string;
  mutationId?: string;
  revision?: number;
  sentAt: number;
  payload?: unknown;
};
```

Message types:

- `hello`
  - client sends desired room, role, schema version, app build hash.
- `welcome`
  - server assigns `clientId`, current `revision`, role, and capabilities.
- `snapshot.request`
  - client asks for the current room snapshot.
- `snapshot`
  - server sends the full sparse room document.
- `patch`
  - client proposes typed path/value changes against `baseRevision`.
- `patch.applied`
  - server broadcasts accepted patch with new `revision`.
- `patch.rejected`
  - server rejects invalid path, stale base, rate limit, or role violation.
- `presence`
  - server broadcasts join, leave, role, cursor/focus, and client metadata.
- `lock.acquire`
  - lab client claims a tuning path while dragging or editing.
- `lock.release`
  - lab client releases a path.
- `preset.commit`
  - admin asks server to persist/export a named tuning snapshot.
- `preset.revert`
  - admin asks room to revert to a known snapshot.
- `ping` / `pong`
  - heartbeat and latency measurement.
- `error`
  - non-patch protocol errors.

Patch payload:

```ts
type TuningPatch = {
  baseRevision: number;
  changes: Array<{
    path: string;
    value: number | boolean;
    previous?: number | boolean;
  }>;
};
```

Example:

```json
{
  "type": "patch",
  "protocol": 1,
  "roomId": "moss-lab",
  "clientId": "lab-7",
  "mutationId": "01j0-lab-7-42",
  "revision": 12,
  "sentAt": 1781985600000,
  "payload": {
    "baseRevision": 12,
    "changes": [
      { "path": "spells.spark.electricPower", "value": 42 },
      { "path": "player.maxSpeed", "value": 3.8 }
    ]
  }
}
```

## Tuning Schema

The server validates paths. The client may render more controls, but the server
is the final gate for shared rooms.

Initial path families:

- `global.<key>`
- `player.<key>`
- `gen.<key>`
- `materials.<cellId>.<key>`
- `spells.<spellId>.<key>`
- `brushSize`

Planned path families:

- `cards.<cardId>.<key>`
- `wands.<key>`
- `enemies.<enemyKind>.<key>`
- `biomes.<biomeId>.<key>`

Each path definition should include:

- `type`: `number` or `boolean`.
- `min`, `max`, and `step` for numbers.
- `defaultValue`.
- `label` and `group` for lab UI.
- `runtimeImpact`: `instant`, `nextCast`, `nextLevel`, or `restart`.
- `stability`: `safe`, `experimental`, or `dangerous`.
- `owner`: module or system responsible for the value.

This schema can be generated from the local defaults plus explicit metadata.
Do not infer ranges from sliders alone; server-side validation needs stable
limits independent of UI.

## Server Responsibilities

The Tuning Lab server owns:

- WebSocket accept/close lifecycle.
- Room creation and lookup.
- Snapshot storage for active rooms.
- Patch validation.
- Revision assignment.
- Fanout to clients in the room.
- Presence and optional path locks.
- Bounded room history.
- Rate limiting.
- Origin checks.
- Authentication or room-token checks.
- Optional preset export/import.

The server does not own:

- Local game rendering.
- Local world simulation for the first Tuning Lab slice.
- Builder document internals.
- Expedition saves.
- Arbitrary script execution.

Future multiplayer server authority owns:

- Room lifecycle and player admission.
- Input command validation.
- Server-side state progression for shared gameplay.
- Delta/snapshot strategy.
- Anti-cheat relevant rules.
- Match result reporting.
- Persistence of durable progression or account data.

## Security

Minimum controls:

- Require `wss://` in production.
- Validate WebSocket `Origin` against the GitHub Pages domain or custom domain.
- Require room tokens for writable roles.
- Use one-time or short-lived invite links for public builds.
- Apply per-client and per-room message rate limits.
- Reject unknown paths, wrong types, non-finite numbers, and out-of-range values.
- Cap patch size and batch size.
- Track `clientId`, `mutationId`, and revision for replay/idempotency.
- Never trust client-provided role or display name.
- Keep `spectator` as the default role for unauthenticated clients.
- Keep server logs free of secret room tokens.

## Persistence

Start with in-memory active room state plus explicit export.

Recommended phases:

1. Active room memory only.
2. Room snapshot persisted to server storage for reconnect after idle.
3. Named presets exported as JSON documents.
4. Presets imported into repo-side content after review.
5. Optional account/project model if this becomes a public service.

Preset JSON should be sparse and diffed against shipped defaults, matching the
existing local tuning persistence shape. That keeps presets resilient when
future defaults change.

## Multiplayer Implications

Falling-sand multiplayer is not just "sync every cell." A naive full-grid
stream will be expensive, hard to reconcile, and brittle under packet loss.

Design principles for later multiplayer:

- Clients send input intents, not direct state mutations.
- The authority sends snapshots, deltas, events, or region updates depending on
  gameplay mode.
- Keep simulation state partitionable by room and region.
- Add deterministic replay tests before trusting rollback or client prediction.
- Keep fixed-step simulation cadence explicit.
- Avoid using the Tuning Lab protocol for gameplay state. Reuse the transport
  and room lifecycle, but define separate gameplay message types.
- Prefer small co-op/arena experiments before attempting a shared full descent.

Likely multiplayer progression:

1. Shared Tuning Lab only.
2. Shared read-only spectators or ghost trails.
3. Small room co-op prototype with server-mediated inputs.
4. Authoritative arena or challenge room with bounded map size.
5. Full expedition multiplayer only after networked sim costs are measured.

## Technology Evaluation

### Recommendation Matrix

| Option | Near-term Tuning Lab | Future Multiplayer | Scale Model | Cost/Ops Shape | Main Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| Cloudflare Durable Objects | Excellent for room relay and presence | Limited for heavy authoritative sim | One room actor/object coordinates clients | Low ops, edge-hosted, hibernation can reduce idle cost | Runtime limits and single-object throughput | Best first hosted Tuning Lab spike |
| Local Node/Bun `ws` server | Excellent for dev and tests | Prototype only | Single process, can later shard by room | Very low complexity | Not the production architecture | Build as reference implementation |
| SpacetimeDB | Strong for authoritative shared data and subscriptions | High-potential if sim model fits tables/reducers | Database-backed realtime subscriptions and reducers | Newer operational model | Ecosystem maturity and sim fit | Research spike before commitment |
| .NET SignalR + Orleans | Good | Strong if we want custom authority | Hubs plus room grains/actors; Redis/Azure SignalR for scale-out | More code and infrastructure, strong control | More engineering ownership; TS/C# sim split | Best long-term custom-server candidate |
| Colyseus | Good | Strong for browser multiplayer prototypes | Room instances with state sync and matchmaking | Node ops or managed Colyseus Cloud | Heavy sim still custom | Best TypeScript game-server prototype |
| Nakama | Overbuilt for tuning alone | Strong if accounts, matchmaking, storage, and authoritative matches matter | Game backend plus match handlers | Larger platform and deployment footprint | More platform than needed now | Revisit if backend scope expands |
| Agones | Not useful for tuning alone | Strong for dedicated server fleets | Kubernetes game-server orchestration | High ops complexity | Premature without server binary | Future large-scale hosting only |
| Edgegap | Not useful for tuning alone | Strong for managed dedicated server hosting | Managed global deployment/orchestration | Vendor-managed | Requires a separate game server build | Future deployment option |
| PartyKit | Good for room relay | Limited for heavy authoritative sim | JavaScript room server on edge platform | Low code and low ops | Smaller ecosystem and unclear long-term fit | Viable alternative to Durable Objects |
| Supabase Realtime / Ably | Good for pub/sub prototypes | Weak for authority | Managed channels, broadcast, presence | Very low ops | Not a game authority | Use only if we want managed pub/sub, not multiplayer foundation |

### Cloudflare Durable Objects

Cloudflare Durable Objects are the cleanest match for the first hosted Tuning
Lab because each room can map to one Durable Object. That object can own
presence, the latest snapshot, revision numbers, and patch fanout. Durable
Objects support WebSockets, can coordinate multiple clients in one instance, and
the hibernation API lets idle objects sleep while keeping clients connected.

Fit:

- Best for a room-based tuning relay.
- Good for private dev tools and lightweight collaborative editing.
- Good bridge from GitHub Pages to realtime without running a VM.

Concerns:

- Not the best place to run CPU-heavy falling-sand authority.
- Batching is important if sliders emit many small changes.
- Hibernation resets in-memory state, so room snapshots must be restorable from
  Durable Object storage or connection attachments.

### SpacetimeDB

SpacetimeDB is interesting because it combines server-side logic, database
tables, client SDKs, and realtime subscriptions. Reducers mutate database state
transactionally, tables are automatically persisted while kept in memory for low
latency, and subscriptions replicate rows to clients in real time.

Fit:

- Strong research candidate for shared tuning rooms and future authoritative
  state.
- Generated client bindings could reduce protocol drift.
- Tables grouped by access/update pattern match the need to avoid streaming
  irrelevant state.

Concerns:

- It is a younger ecosystem than .NET, Nakama, or plain Node.
- We need a real spike to see whether reducers/tables fit this game's sim model.
- Do not assume full falling-sand simulation belongs in SpacetimeDB until a
  bounded arena benchmark proves it.
- Local standalone docs note no SSL support in standalone mode, so production
  deployment needs a proper hosted/reverse-proxied path.

Spike:

- Model `Room`, `ClientPresence`, `TuningPath`, `TuningValue`, and `PatchLog`.
- Implement reducers: `join_room`, `submit_patch`, `set_presence`,
  `commit_preset`.
- Subscribe clients to only their room.
- Measure patch fanout latency and dev friction from the browser client.

### Custom .NET Server

A custom ASP.NET Core server is the most controlled long-term architecture.
SignalR gives browser-friendly realtime messaging, JavaScript clients, groups,
transport fallback, and scale-out options. Raw WebSockets remain available if
the protocol needs lower-level control. Orleans adds a virtual actor model that
maps naturally to rooms, matches, and lab sessions.

Fit:

- Strong choice if we want to own the backend architecture.
- Good path to room actors: one Orleans grain per tuning room or match.
- SignalR groups map cleanly to room fanout.
- Mature auth, observability, OpenAPI, storage, health checks, and deployment.

Concerns:

- More code and operations than an edge relay.
- SignalR scale-out needs sticky sessions, Redis backplane, or Azure SignalR
  depending on hosting.
- If the authoritative sim runs in C#, we must port or share simulation logic
  carefully instead of letting TypeScript and C# behavior diverge.

Suggested shape:

- `Realtime.Api`
  - ASP.NET Core endpoints, SignalR hub, auth, health.
- `Realtime.Application`
  - room commands, validation, preset services.
- `Realtime.Domain`
  - room, snapshot, patch, presence, schema models.
- `Realtime.Infrastructure`
  - Redis/Postgres/blob storage, telemetry, deployments.
- Optional `Realtime.Orleans`
  - `ITuningRoomGrain`, later `IMatchRoomGrain`.

### Colyseus

Colyseus is a Node.js multiplayer game framework with authoritative room code,
state synchronization, matchmaking, and TypeScript-friendly client integration.
It is a good fit if we want to keep game-server prototypes in the same language
family as the current Vite client.

Fit:

- Strong for browser multiplayer prototypes.
- Rooms, reconnection, state sync, and matchmaker concepts are built in.
- Good candidate for bounded co-op/arena experiments.

Concerns:

- A real falling-sand authoritative server still requires careful custom state
  design.
- Production scale still needs process hosting, monitoring, and load testing.
- It may be more framework than the first Tuning Lab requires.

### Nakama

Nakama is a mature game backend with authentication, storage, chat, leaderboards,
matchmaking, and authoritative multiplayer. Its authoritative match model lets
server runtime code validate inputs, run fixed-tick match logic, and broadcast
state to peers.

Fit:

- Strong if Alchemist's Descent grows into accounts, progression, social
  systems, matchmaking, and authoritative rooms.
- Useful when backend product scope matters as much as realtime transport.

Concerns:

- Overbuilt for a private tuning relay.
- Requires adopting Nakama runtime patterns and deployment model.
- Authoritative match logic still has to be written; there is no generic game
  authority for free.

### Agones And Edgegap

Agones and Edgegap are not Tuning Lab technologies. They matter when there is a
dedicated game server process that must be deployed, allocated, health checked,
and scaled globally.

Fit:

- Use later for authoritative multiplayer servers that need dedicated processes.
- Agones is open-source Kubernetes orchestration.
- Edgegap is managed game server hosting/orchestration.

Concerns:

- Premature until we have a headless server binary and concrete match model.
- Higher operational overhead than a room relay.

### PartyKit

PartyKit is a room-oriented realtime JavaScript platform with WebSocket support,
storage, hibernation guidance, and collaborative app examples. It is close in
spirit to Durable Objects and may be faster to prototype.

Fit:

- Tuning Lab rooms.
- Collaborative lab UI, presence, cursors, and lightweight shared state.

Concerns:

- Less direct control than owning Durable Objects code/deployment.
- Not the preferred future home for CPU-heavy game authority.

### Supabase Realtime And Ably

Managed pub/sub systems can get a shared Tuning Lab working quickly: channels,
broadcast, presence, auth tokens, and persistence features are already there.

Fit:

- Fastest way to test cross-computer patch fanout.
- Useful if we only need collaborative tuning and never want to host a relay.

Concerns:

- These are not authoritative game servers.
- Multiplayer would still need a separate authority service.
- Channel/message pricing and limits need evaluation before high-frequency use.

## Implementation Plan

### Phase 0 - Schema Inventory

- Inventory current tuning values from `params.ts`, `gen.ts`, material params,
  spell params, wand constants, and card modifier constants.
- Add explicit metadata for range, step, runtime impact, and stability.
- Decide which values are safe for remote tuning.
- Move hardcoded wand/card modifier constants into typed tuning objects.

Deliverable:

- `src/config/tuningSchema.ts`
- Tests for path validation and defaults.

### Phase 1 - Provider-Neutral Client Protocol

- Add `realtimeProtocol.ts` message types.
- Add `captureTuningPatch` and `applyTuningPatch` helpers.
- Add `TuningClient` with reconnect, heartbeat, echo suppression, and room
  snapshot handling.
- Add UI status for disconnected, connecting, connected, stale, and rejected.
- Keep realtime disabled by default.

Deliverable:

- Game can connect to `ws://localhost:<port>` and sync patches across two local
  browser tabs.

### Phase 2 - Reference Local Server

- Add a small `servers/tuning-local` package or `scripts/tuning-server.mjs`.
- Implement room memory, revision assignment, validation, fanout, and history.
- Add Playwright probe with two browser contexts:
  - connect both clients to one room,
  - change a tuning value in client A,
  - assert client B updates and emits `paramsChanged`,
  - reconnect client B and assert snapshot catch-up.

Deliverable:

- Repeatable local verification before testing any hosted provider.

### Phase 3 - Hosted Tuning Relay Spike

Primary spike: Cloudflare Durable Objects.

- Implement one Durable Object per room.
- Persist current snapshot and revision.
- Batch slider updates during drags.
- Validate origin and token.
- Test from GitHub Pages preview or static build served from `dist`.

Alternative spike: PartyKit if Durable Object boilerplate slows the first pass.

Deliverable:

- Two computers can tune one room against the static client.

### Phase 4 - SpacetimeDB Spike

- Create a tiny SpacetimeDB module with room, presence, tuning values, and patch
  log tables.
- Implement reducers for join, patch, and preset commit.
- Generate browser bindings.
- Compare developer workflow, latency, schema evolution, and deployment story.

Deliverable:

- Recommendation: keep as candidate, adopt, or reject for this game.

### Phase 5 - .NET Server Spike

- Create a .NET realtime prototype with SignalR groups.
- Add typed DTOs, validation, auth token checks, health endpoints, and OpenAPI
  for non-WebSocket operations.
- Optional Orleans room grain prototype for room state ownership.
- Test Redis or Azure SignalR scale-out only if we need multi-instance hosting.

Deliverable:

- Recommendation against Cloudflare/SpacetimeDB/Colyseus for long-term server.

### Phase 6 - Multiplayer Research Prototype

- Choose one bounded gameplay scenario, not the full game:
  - tiny arena,
  - fixed seed,
  - two players,
  - no expedition persistence,
  - limited sand region,
  - input commands only.
- Measure bandwidth for:
  - input-only plus server events,
  - region deltas,
  - periodic snapshots,
  - client prediction with correction.

Deliverable:

- Data-backed multiplayer architecture decision.

## Acceptance Criteria For First Tuning Release

- Static GitHub Pages build can connect to an external `wss://` tuning server.
- Realtime connection is off unless explicitly enabled.
- Two clients in the same room receive accepted tuning patches.
- Late join receives the current room snapshot.
- Reconnect recovers without losing the latest room revision.
- Invalid paths, wrong types, and out-of-range values are rejected visibly.
- `paramsChanged` fires after remote patches so existing UI mirrors update.
- LocalStorage tuning persistence still works without the server.
- Server does not accept raw world/entity/runtime mutation commands.
- Browser probe covers two connected clients and reconnect.

## Open Questions

- Is the Tuning Lab private-dev only, or should public builds expose it behind a
  hidden developer command?
- Do writable rooms need accounts, or are room tokens sufficient?
- Should the first hosted relay live under Cloudflare, a small VM, or a .NET app
  host?
- Do presets become repo JSON files, downloadable artifacts, or server records?
- Which gameplay constants must move into the tuning schema before this is
  worth using daily?
- What is the first multiplayer target: ghost/spectator, co-op arena, or shared
  expedition?

## Source Notes

- GitHub Pages is static hosting for HTML/CSS/JavaScript:
  https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages
- SpacetimeDB docs: CLI, local standalone server, modules, tables, reducers, and
  subscriptions:
  https://spacetimedb.com/docs
  https://spacetimedb.com/docs/functions
  https://spacetimedb.com/docs/tables
  https://spacetimedb.com/docs/subscriptions
- ASP.NET Core SignalR, WebSockets, scaling, and Orleans:
  https://learn.microsoft.com/en-us/aspnet/core/signalr/introduction
  https://learn.microsoft.com/en-us/aspnet/core/fundamentals/websockets
  https://learn.microsoft.com/en-us/aspnet/core/signalr/scale
  https://learn.microsoft.com/en-us/dotnet/orleans/overview
- Cloudflare Durable Objects WebSockets and hibernation:
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Colyseus multiplayer framework:
  https://docs.colyseus.io/
- Nakama authoritative multiplayer:
  https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/
- Agones dedicated game server orchestration:
  https://agones.dev/site/docs/overview/
- Edgegap game server hosting/orchestration:
  https://docs.edgegap.com/
- PartyKit realtime multiplayer/collaboration platform:
  https://docs.partykit.io/
- Supabase Realtime and Ably pub/sub references:
  https://supabase.com/docs/guides/realtime
  https://ably.com/docs/channels

# Realtime Authoring Link and Multiplayer Server Spec

- Status: **Phases 1-4 shipped** (AuthorLink: tuning, terrain, authored
  objects, console, shared-world sync, a standalone `/builder.html` route, and
  a strict hosted relay with a Cloudflare Durable Object host). Phases 5+ are
  alternative-backend and multiplayer research.
- Created: 2026-06-20. Phases 1-4 landed 2026-07-26.
- Scope: a static GitHub Pages client plus a separate realtime service — live
  cross-window authoring now, shared tuning rooms next, multiplayer later.

## Executive Direction

Host the Vite static build on GitHub Pages and keep every realtime feature in a
separate service reached over `ws://` (dev) or `wss://` (hosted). GitHub Pages
is static hosting for HTML, CSS, and JavaScript, so it is a good fit for the
game client but not for room state, streaming, WebSocket fanout, authority,
persistence, or matchmaking.

The first server feature is **AuthorLink**, not multiplayer: a room that lets an
editor window and a game window run side by side and stay in step. It is
deliberately built so the same room/session model can grow into a hosted Tuning
Lab and then into multiplayer, without ever exposing raw runtime state or
accepting arbitrary client mutations.

Naming note: earlier drafts called this the "Tuning Lab" and assumed a
lab-client / game-client split. Implementation collapsed that distinction — see
[Symmetric peers](#decision-symmetric-peers-not-labgame-roles) — so the shipped
feature is named AuthorLink and "Tuning Lab" now refers only to the future
*hosted, multi-machine* form of the same room.

---

## Shipped: AuthorLink Phases 1-4

Two windows of the app join a named room and stay in sync across three
channels. Neither window is authoritative; both publish and both apply.

### Using it

```powershell
npm run dev
# game:   http://localhost:5173/
# editor: http://localhost:5173/builder.html      (boots straight into the Builder)
```

Both routes join the same room automatically in dev. `/` with the BUILDER
button still works — the standalone route just skips the Sandbox palette and
the click.

The header shows a `LINK n` pill: `n` is the number of other windows in the
room. Everything else is automatic.

| Situation | How |
| --- | --- |
| Separate rooms on one machine | `?link=roomname` on both windows |
| Turn it off in dev | `?link=off` |
| Turn it on in a production build | `?link=roomname` (off by default) |
| Two machines / standalone relay | `npm run authorlink:server -- --port 8787`, then `VITE_AUTHORLINK_URL=ws://host:8787` |

### Channels

| Channel | Source | Applied as |
| --- | --- | --- |
| `tuning` | any `paramsChanged` | sparse diff onto the live config singletons, then `paramsChanged` re-emitted so Inspector/Builder mirrors resync |
| `cells` | Builder `CommandStack` terrain commands | `applyCellPatch` into the live `World` **only when the patch's `WorldIdentity` matches ours**, then a `worldEdited` event |
| `cmd` | explicit publish | `ctx.console.exec(line)` on every peer |
| `objects` | any Builder document command (debounced 120 ms) | the peer tears down what it previously instantiated and re-runs the shared `instantiateObjects` for the whole set |
| `world.announce` | join, and any local world change (500 ms identity poll) | peer world table; drives the mismatch state |
| `world.request` / `world.snapshot` | the `LINK ≠` pill | `applyWorldLayer` replaces this window's grid with the peer's live one |

### Same level, or nothing happens

Two connected windows are not necessarily looking at the same world, and this is
the difference between the feature working and the feature quietly corrupting a
level. A `CellPatch` is *only indices* into `x + y * width`, and every world in
this game is 1600x1064 — so matching dimensions prove nothing. An untagged
stroke aimed at a sandbox cave lands at the same array offsets inside a live D3.

So every window publishes a `WorldIdentity`:

```ts
{ kind: 'level' | 'sandbox' | 'custom', levelId, biome, seed, genVersion, width, height }
```

- Patches carry it and are **refused** when it is not ours (amber pill + toast).
- `genVersion` is part of it, so two tabs on different builds are never peers.
- The `LINK ≠` pill pulls the peer's live grid over `world.snapshot`.

**A pulled world keeps the SENDER's identity.** After pulling a peer's live
`d2`, this window holds d2's cells but has no level runtime, so a ctx-derived
identity would call it `sandbox` and the next poll would revert the adoption —
straight back to "different worlds", refusing every stroke. The adoption is
held until this window's own world genuinely changes underneath it.

### Authored objects: whole-set, not per-record

A remote object edit replaces the **entire** authored set rather than diffing
one record. That is deliberate:

- Links wire doors to triggers across records, and `instantiateObjects`
  resolves that in one ordered pass (objects → doors → triggers → rune links).
  Per-record messages would need a second wiring path that could drift from
  the playtest compiler — the exact "playtest drift" risk the Builder
  decoupling plan calls out.
- An authored set is tens of records and a few KB. There is nothing to save.
- It is idempotent: no delete/upsert bookkeeping to get wrong.

**It can only touch what it made.** The sync records the exact entity
references it pushed into the runtime; anything the receiving window generated
for itself — worldgen mechanisms, campaign pickups, wandering enemies — is
never removed, because it was never recorded. An editor holding an empty
document cannot wipe a live level.

**Doors need explicit un-stamping.** A closed door's metal is written by the
runtime during `Mechanisms.update`, not by the instantiation `CellSetter`, so
the teardown cell-patch never captured it — and `setDoorCells(open)` only
queues a dissolve that `Mechanisms.update` drains, which will never run for a
mechanism being removed. Without special handling, deleting a door welds a
permanent metal slab across the level: precisely the physics-chaos softlock
the design rules forbid. Teardown therefore clears the door footprint
directly, and only cells that are *still* its metal.

Authored objects need a level runtime to live in. A Sandbox window that never
started a run reports that instead of dropping the set silently.

### Files

```text
src/authoring/cellPatch.ts        CellPatch contract + apply/bounds/validate (neutral layer)
src/net/authorLinkProtocol.ts     envelope, message union, payload validators, limits
src/net/AuthorLinkClient.ts       socket lifecycle, reconnect, heartbeat, echo drop, typed fan-out
src/net/tuningPatch.ts            tuning paths <-> live config singletons
src/app/AuthorLink.ts             Ctx binding: channel wiring, echo suppression, config resolution
src/app/AuthorLinkIndicator.ts    header status pill
src/app/BuilderHost.ts            +publishTerrainPatch / getLinkStatus / subscribeLinkStatus
scripts/authorlink-server.mjs     the relay (attachable + standalone)
scripts/vite-plugin-authorlink.mjs  mounts the relay on the dev server
tests/authorlink.test.ts          28 unit tests
scripts/verify-authorlink.mjs     two-browser-context probe (npm run verify:authorlink)
src/app/authorLinkObjects.ts      authored-set instantiation + teardown against a live runtime
src/core/storageOwner.ts          single-writer election for shared localStorage keys
src/app/builderEntry.ts           /builder.html entry: boots straight into the Builder
src/content/materialPalette.ts    the material catalog both the Sandbox and Builder read
builder.html                      the editor route (second Vite input)
src/config/tuningRanges.ts        derived per-path bounds for strict rooms
servers/authorlink/room.mjs       the ONE room implementation, host-agnostic
servers/authorlink/worker.js      Cloudflare Durable Object host
servers/authorlink/wrangler.toml  deploy config (nothing runs until deployed)
scripts/gen-tuning-ranges.mjs     emits the relay's plain-JS range table
scripts/verify-authorlink-hosted.mjs  production build + external strict relay
```

### Decisions worth keeping

#### Decision: the transport is a private WebSocket path, not Vite HMR

Vite's HMR channel would have been zero-dependency, but `import.meta.hot` is
stripped from production builds, so an HMR-based link could never graduate past
dev — and sharing the reload socket entangles authoring traffic with reload
semantics. A private path (`/__authorlink`) on the same port costs one `ws`
devDependency and makes the client code identical in dev and production. The
relay attaches via `noServer: true` + a manual `upgrade` handler so it claims
only its own path and leaves Vite's HMR socket alone.

#### Decision: symmetric peers, not lab/game roles

The original draft had `lab`, `game`, `spectator`, and `admin` roles with
different write permissions. Implementation dropped that: every peer publishes
and every peer applies, and `role` survives only as a presentation label in the
presence list. Reasons:

- The interesting workflow is bidirectional. You tune from the editor, but you
  also want to nudge a value from the game window while playing it.
- Role negotiation would have to re-run every time a window opens or closes the
  Builder, which is a mode toggle, not a session boundary.
- It keeps the relay dumb: validate the envelope, stamp a revision, fan out.

Authority becomes necessary for multiplayer. It is not necessary for authoring,
and adding it early would have bought nothing.

#### Decision: the tuning allowlist is derived, not authored

Phase 0 originally called for a hand-written `src/config/tuningSchema.ts` with
per-path metadata. That file was **not** built, on purpose. `tuningPatch.ts`
derives the allowlist from the shipped defaults instead: a path is valid iff the
defaults object has that key with a number or boolean value.

- `config/params.ts` is already the single source of truth for what a dial is.
  A parallel schema would go stale the first time someone added one, and a
  stale allowlist *silently drops* changes rather than failing loudly.
- The default's type is the accepted type, so a boolean can never land on a
  number dial — type checking for free.
- It matches what `config/tuningStore.ts` already does for localStorage, so
  persistence and the wire cannot disagree about what is tunable.

What is genuinely lost is per-path `min`/`max`/`step`/`runtimeImpact`/
`stability` metadata. That is real, and it is what a *hosted* room will need
(see Phase 4). A local dev link between two windows the same person owns does
not need range clamping to be safe.

#### Decision: terrain is forwarded, never accumulated

The relay keeps one piece of state — the room's accumulated tuning — because
that is the only thing a late-joining window cannot reconstruct for itself.
Terrain is deliberately not accumulated: replaying an hour of strokes onto a
freshly generated world would produce garbage. A late joiner starts from its own
world and syncs forward. Whole-document resync is Phase 2's job.

#### Decision: sends while disconnected are dropped, not queued

Queued tuning would replay a stale slider drag on reconnect, and queued cell
patches would stamp terrain into a world that has since regenerated. On
reconnect the client re-publishes a fresh sparse tuning snapshot instead, which
is both smaller and correct.

### Safety properties actually implemented

- `CellPatch` cell ids are validated against `CELL_COUNT` before they are
  stamped. Cell ids are an append-only save ABI, so a patch from a newer build
  can name a material this build has no behavior for; the whole patch is
  refused rather than putting an unsimulatable id in the grid.
- Cell indices are validated against the receiving world's length, and the
  patch is refused outright if the sending world's dimensions differ (indices
  are `x + y * width`, so a mismatch would smear the stroke diagonally).
- Charge is written through `World.setChargeAt`, never the raw array, so the
  sparse active-charge index stays in step with the electrical pass.
- Per-message cap (512 KB) and per-patch cap (40k cells), enforced on both
  ends; a whole-world replace is a document resync, not a socket message.
- Per-client rate limit (240 msg/s) in the relay.
- Echo control has two independent guards: the client drops messages carrying
  its own `clientId`, and the binding suppresses the outbound tuning publisher
  while a remote patch is being applied.
- The link is off by default in production builds. A shipped build never opens
  a socket the player did not ask for.

### Verified

```powershell
npx vitest run tests/authorlink.test.ts   # 46 passed
npm run verify:authorlink                 # 27 passed (two browser contexts)
```

The probe drives a real Builder brush drag with real mouse events in one
browser context and asserts every published cell appears in the other. It also
puts the two windows on deliberately different worlds, asserts the stroke is
**refused**, pulls the peer world, and asserts the same stroke then lands.

Phase 2, verified in the browser with real palette clicks: a door placed in
the Builder window appeared in a live D1 expedition's runtime (13 → 14
mechanisms, `door@1031,177`, trigger index rebuilt), and deleting it returned
the runtime to 13 with the metal cleared. A linked lever+door pair is covered
by the probe, which asserts the lever's `targetId` resolves to the door.

Phase 1, end-to-end check against the real scenario: a game window playing a live `d2`
expedition (player, enemies, an explosion crater), an editor window that pulled
that level through the pill, and a 5,095-cell arch painted in the Builder —
5,095 of 5,095 present in the game window, with the game still on `d2`.

### Two bugs this shook out, and what they cost

Recorded because both were invisible from the code and both would have come
back.

1. **Feedback loop via status notifications.** `AuthorLinkStatus` includes
   `revision`, which moves with *every* relayed message, and `onStatus` fires
   on any field change. A handler that announced "on connect" therefore
   announced once per message received — an unbounded storm between two peers
   that pinned the relay at its 240/s rate limit and silently starved the
   tuning and cell channels. Fixed by reacting to a kind *transition*. A second
   variant (replying to every `world.announce`) was fixed by replying only to a
   peer we have not met. Both have regression tests.
2. **An idleness assertion that could not fail.** The probe checked "revision
   stops climbing", but a client's revision only advances when it *receives*
   something, so a heartbeat pong makes it jump several counts with nobody
   talking — and conversely it looked stable while a storm was underway. The
   check now counts what each window *sends* while idle, which is the thing
   that actually matters, and it runs last, after every channel has fired.

The general lesson for this transport: **assert on what a peer emits, not on
what it observes.** Observed counters lag and lie; emitted counters do not.

### Known gaps (deliberate, not oversights)

- **Object sync replaces, it does not merge.** Each authored edit re-runs the
  whole set, so mechanism runtime state resets (a door you had opened closes).
  Acceptable for an authoring loop — you are recompiling authored intent — but
  it is not a live-object protocol.
- **An unlinked trigger does not instantiate.** A lever with no link has no
  target, so the shared instantiation pass skips it. That is existing game
  semantics, not a link limitation, but it surprises you the first time.
- **Pull is one-shot.** Either window can pull (both show the amber pill), so
  it is bidirectional in practice, but there is no continuous follow.
- **A pulled world is a grid, not a session.** The editor gets the peer's
  cells, not its enemies or pickups. Authored objects then sync on top.
- **Edits land in a *live* simulation.** Paint a crystal arch into a running
  D2 and the sim immediately acts on it — fire spreads, liquids drain, loose
  material falls. That is correct and is the point of editing the real game,
  but it means the receiving window is not a still canvas. For a stable
  comparison, stop its clock (`ctx.time.setManual(true)`); `state.paused`
  alone is honoured by the fixed tick but is easy to have reset out from under
  you by a level transition.
- **Shared `localStorage` has no owner rule.** Both windows write
  `ad:tuning:v1`, and a second window with the Builder open would also write
  `noita-builder-draft`. Same-value writes are benign; a real single-writer
  lock is Phase 2.
- **No range clamping on tuning values.** Fine for a local link, required for a
  hosted room. Phase 4.
- **No auth.** The dev relay accepts any connection to the port. Anything
  hosted needs origin checks and room tokens (see Security).

---

## Current Game Integration Points

The game already had the right local seam for live tuning, and AuthorLink was
built on it rather than beside it:

- `src/config/tuningStore.ts` captures sparse diffs for `global`, `player`,
  `pacing`, `gen`, `materials`, `spells`, and `brushSize`.
- `Game` installs tuning persistence once during boot with
  `installTuningPersistence(ctx)`.
- Sandbox and Builder controls emit the shared `paramsChanged` event after
  tuning mutations.
- Local persistence stores sparse diffs against shipped defaults, which is
  exactly the right shape for a network patch.
- `src/builder/commands.ts` `CellPatch` was already a serializable sparse cell
  diff built for undo; it is now the wire format too, and lives in
  `src/authoring/cellPatch.ts` so `src/net` can use it without crossing the
  Builder boundary.
- `EventMap.worldEdited` already existed as the "raw live-world edits from dev
  tools" bridge, carrying dirty bounds; remote patches emit it with
  `source: 'authorlink'`.

Known tuning debt still outstanding:

- Some wand/card modifier behavior still lives as constants in runtime code,
  especially in `src/combat/wands/compiler.ts`. Those values must move behind
  structured tuning objects before the link can claim full spell/card coverage.
- Network tuning must never mutate raw `Ctx`, `World`, entity arrays, DOM
  nodes, or arbitrary JavaScript. It only applies typed tuning documents.
  (Terrain is the one exception and it goes through its own validated,
  size-capped channel.)

## Goals

Met in Phase 1:

- Cross-window live tuning for global params, player movement, worldgen,
  materials, and spells.
- A separate authoring window that can run beside the game.
- Room-based sessions with explicit connect/disconnect state.
- Snapshot-on-join for tuning, so a late window receives current room state.
- Patch fanout with revision ordering.
- Path allowlists and type checks.
- Static client deployable to GitHub Pages with no server dependency unless the
  user explicitly enables the link.

Still open:

- Cross-*machine* tuning against a hosted relay.
- Card/wand constants in the tuning schema.
- Range checks, rate limits per path, role checks, and conflict visibility.
- Architecture that can later support multiplayer room lifecycle, presence,
  matchmaking, and server authority.

## Non-Goals For The Next Slice

- No multiplayer gameplay implementation.
- No full world-grid streaming.
- No remote execution, script injection, or arbitrary config editing.
- No account system unless private room tokens are not enough.
- No persistence to save files or committed game data until the user explicitly
  chooses to commit a tuning preset.

## Client Architecture

Shipped shape (see the file table above). The layering rule that matters:

```text
src/net/**        protocol + socket + pure patch appliers. No Ctx, no World, no DOM
                  beyond WebSocket. Boundary-enforced: may not import src/builder.
src/app/**        binds the net layer to a live Ctx; owns config resolution and UI.
src/builder/**    reaches the link ONLY through BuilderHost, never directly.
```

`BuilderHost` gaining `publishTerrainPatch` is not incidental — it is the
migration path the Builder/Game decoupling plan already wanted. Routing the
publish through the host kept the editor free of both a net-layer import and a
module-level singleton.

Connection is opt-in outside dev:

- Query string: `?link=<room>` (or `?link=off` to suppress in dev).
- Env override: `VITE_AUTHORLINK_URL=ws://host:8787`.
- Default: on in dev, off in production.

## Room Model

Each room holds:

- `id`: short, human-shareable.
- `revision`: monotonically increasing integer, stamped by the relay on every
  relayed message.
- `tuning`: accumulated sparse tuning document (the join snapshot).
- `clients`: connected sockets with a display role and a rate-limit window.

Roles (`sandbox` | `play` | `builder`) are presentation only. See
[Symmetric peers](#decision-symmetric-peers-not-labgame-roles).

## Protocol

JSON. Move hot paths to MessagePack only if patches become large or frequent
enough to justify the tooling — a 1000-cell stroke is ~20 KB of JSON, which is
nowhere near that threshold.

Envelope (`src/net/authorLinkProtocol.ts`):

```ts
interface Envelope<T extends string, P> {
  type: T;
  protocol: 1;
  room: string;
  clientId: string;
  /** Room revision. Assigned by the relay on broadcast; 0 on client send. */
  revision: number;
  sentAt: number;
  payload: P;
}
```

Message types:

| Type | Direction | Purpose |
| --- | --- | --- |
| `hello` | client → relay | announce room, role, build stamp |
| `welcome` | relay → client | assign revision, peer count, tuning snapshot |
| `presence` | relay → clients | peer count and roles changed |
| `tuning` | relayed | sparse `{ path, value }[]` |
| `cells` | relayed | `{ width, height, patch, label }` |
| `cmd` | relayed | `{ line }`, run through `ctx.console.exec` |
| `world.announce` | relayed | this window's `WorldIdentity` |
| `world.request` | directed | ask ONE peer for its grid (directed, so three windows do not all answer) |
| `world.snapshot` | relayed | `EditorWorldLayer` for the whole world |
| `ping` / `pong` | both | heartbeat |
| `error` | relay → client | `protocol` / `rejected` / `rate-limit` / `too-large` |

`tuning`, `cells`, `cmd`, and the three `world.*` types are relayed; the rest
are answered by the relay. Size caps are per-type: 512 KB for the incremental
channels, 16 MB for `world.snapshot`, which is a rare explicit user action and
falls back to shipping a whole color plane when the paint cannot be re-derived. The relay duplicates the protocol constants rather than importing the
TypeScript module (it must run under plain Node with no build step);
`tests/authorlink.test.ts` asserts the two copies agree, because drift there is
a silent wire break.

Tuning path families, validated against the shipped defaults at apply time:

```text
global.<key>              GLOBAL_PARAMS
player.<key>              PLAYER_PARAMS
pacing.<key>              PROGRESSION_PACING
gen.<key>                 GEN_TUNE
materials.<cellId>.<key>  MATERIAL_PARAMS[cellId]
spells.<spellId>.<key>    SPELL_PARAMS[spellId]
```

Planned families: `cards.<cardId>.<key>`, `wands.<key>`,
`enemies.<enemyKind>.<key>`, `biomes.<biomeId>.<key>`.

## Server Responsibilities

The relay owns:

- WebSocket accept/close lifecycle on its own path.
- Room creation, lookup, and teardown when the last client leaves.
- The accumulated tuning snapshot for active rooms.
- Envelope validation, revision assignment, fanout.
- Presence.
- Per-client rate limiting and message size caps.

A hosted relay must additionally own origin checks, room-token auth, bounded
room history, and optional preset export/import.

The relay does not own:

- Local game rendering or world simulation.
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

Shipped (local dev relay): envelope validation, unknown-path rejection,
type checks, non-finite rejection, message size cap, patch cell cap, per-client
rate limit, cell-id ABI validation, off-by-default in production.

Required before anything is hosted:

- Require `wss://` in production.
- Validate WebSocket `Origin` against the Pages domain or custom domain.
- Require room tokens for writable roles.
- Use one-time or short-lived invite links for public builds.
- Per-room (not just per-client) rate limits.
- Range checks against per-path `min`/`max`.
- Track `clientId`, `mutationId`, and revision for replay/idempotency.
- Never trust a client-provided role or display name.
- Keep server logs free of secret room tokens.

## Persistence

Start with in-memory active room state plus explicit export.

1. Active room memory only. **(shipped)**
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
- Do not use the AuthorLink protocol for gameplay state. Reuse the transport
  and room lifecycle, but define separate gameplay message types — AuthorLink
  is explicitly a trusted-peer dev tool with no authority model.
- Prefer small co-op/arena experiments before attempting a shared full descent.

Likely multiplayer progression:

1. Shared authoring link only. **(shipped, local)**
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

Phases 1–2 of the original plan are done and are recorded above under
[Shipped](#shipped-authorlink-phase-1). Phase 0 was deliberately skipped — see
[the derived-allowlist decision](#decision-the-tuning-allowlist-is-derived-not-authored).
The remaining phases are re-baselined below.

### Phase 1 - Local AuthorLink — SHIPPED 2026-07-26

Delivered: provider-neutral protocol, WebSocket client with reconnect and
heartbeat, echo suppression, room snapshot on join, tuning + cells + cmd
channels, header status pill, a reference relay that attaches to the Vite dev
server or runs standalone, 28 unit tests, and a two-browser-context probe.

Original Phase 1 and Phase 2 ("Reference Local Server") collapsed into one
slice, because mounting the relay on the dev server made the reference server a
prerequisite of the first demo rather than a follow-up.

### Phase 2 - Authored Objects And Resync — SHIPPED 2026-07-26

Delivered: the `objects` channel (whole authored set, world-tagged, debounced
120 ms from the Builder command stack), teardown that removes only what the
link created and restores the cells it stamped, explicit door un-stamping,
`mechanismTriggers` rebuild on every apply, a single-writer election for shared
`localStorage`, and incoming-edit feedback (coalesced toast + a soft bloom
pulse) so a remote edit reads as your collaborator working rather than a glitch.

Two design changes against the original plan:

- **Whole-set instead of per-record upsert/delete.** Per-record messages would
  have needed a second link-wiring path alongside `instantiateObjects`; see
  [Authored objects](#authored-objects-whole-set-not-per-record).
- **No `doc` / `resync.request` message.** `world.snapshot` (Phase 1) already
  carries the grid, and the authored set is republished on every edit, so a
  drifted window converges by pulling the world and receiving the next set.
  A third resync path would have been redundant.

Not done: the tier-3 `compileAndPlaytest` fallback for structural changes
(biome, document size, import). In practice a structural change alters the
world identity, which surfaces as a mismatch the pill can resolve — the
explicit recompile has not yet been needed.

### Phase 3 - Separate Builder Entry — PARTIALLY SHIPPED 2026-07-26

Delivered: `builder.html` + `src/app/builderEntry.ts` as a second Vite input,
booting straight into the Builder with AuthorLink live. The bundle-boundary
guard now checks BOTH routes explicitly — it had silently latched onto
whichever entry `find(isEntry)` returned first, which would have let the player
entry regress unnoticed the moment a second entry existed.

The prerequisite turned out to be real, and load-bearing in a way the plan
under-stated: `index.html` did not merely *duplicate* the material palette, the
**Builder cloned its own palette out of those DOM buttons**. The standalone
route shipped no Sandbox markup, so the editor came up with a single material.
`src/content/materialPalette.ts` is now the single source — the Sandbox toolbar
renders from it and the Builder reads it directly, so cell ids (an append-only
save ABI) are no longer re-typed into HTML.

One subtlety worth keeping: the generated buttons must be spliced in as DIRECT
children of `#left-toolbar`. The toolbar filter walks `bar.children` and toggles
each one, so wrapping the palette in a container makes it a single unfilterable
element — caught by `verify-builder-ux`, not by any unit test.

NOT delivered: the editor window still boots Rapier and the gameplay update
systems. Those come from the one composition root in `Game`, and forking it
into an authoring-only root is the "two fake games" outcome the Builder
decoupling plan rules out. Narrowing it needs `Game` to grow an explicit
authoring profile first; that is a `Game` change, not an entry-point change.

### Phase 4 - Hosted Relay — SHIPPED 2026-07-26 (deploy pending an account)

Delivered:

- **One room implementation, two hosts.** `servers/authorlink/room.mjs` is
  pure and host-agnostic; `handle()` returns DELIVERIES and the host performs
  them. The Node `ws` server and the Cloudflare Durable Object both run it
  verbatim, so a hosted room and `npm run dev` cannot disagree about what is
  legal. A test asserts neither host has grown its own copy.
- **Cloudflare Durable Object host** (`worker.js` + `wrangler.toml`), one DO
  per room via `idFromName`, hibernation-aware (`acceptWebSocket`) with the
  room snapshot persisted and restored — a relay that dropped its snapshot on
  hibernation would work perfectly until the room went quiet and then silently
  stop catching up late joiners. Storage writes are coalesced ~250 ms so a
  slider drag does not dominate latency and billing.
- **Strict mode**: origin allowlist refused at the HTTP upgrade, room token
  required for writes (an untokened client is welcomed read-only rather than
  disconnected, so the failure is legible), and per-path range validation.
- **Range schema, still derived not authored.** `src/config/tuningRanges.ts`
  reads `paramSliderSpec` and `WORLDGEN_LOOK_FIELDS`; only the three
  `global.*` sliders are hand-listed, and a test asserts they match
  `index.html`. `scripts/gen-tuning-ranges.mjs` emits the plain-JS table the
  relay hosts use, with `--check` for CI.
- **Drag batching** was already satisfied by the client's 60 ms coalescing
  publisher; a drag produces one diff, not one message per input event.

The Durable Object itself IS verified, without an account:
`npm run verify:authorlink-worker` runs `worker.js` in workerd via
`wrangler dev --local`, with a real DO binding and real `state.storage` — 14/14,
including a **full Worker restart mid-probe** proving the room's tuning
snapshot and revision counter survive losing the object. That was the risk
worth being nervous about; a relay that dropped its snapshot on eviction looks
healthy until a room goes quiet.

**It has now also been deployed and verified on the real edge** — 9/9 via
`npm run verify:authorlink-edge`, against a *temporary preview* account
(`wrangler deploy --temporary`, which needs no Cloudflare signup). That
confirmed TLS termination, the Durable Object serving a room from Cloudflare's
runtime, range validation, token gating, a 403 origin refusal at the handshake,
and snapshot catch-up from live DO storage. On a temporary account secrets are
unavailable, so the room token went in as a plaintext `--var` — fine for a
throwaway, not for a real deployment, which should use
`wrangler secret put ROOM_TOKEN`.

Two probe lessons, now encoded: a freshly deployed Worker needs a few seconds
to propagate (the first run, seconds after deploy, was refused outright), and
edge waits are not localhost waits (a 700 ms settle produced a false failure
that read as broken token handling).

**Still unverified:** Cloudflare's real hibernation *eviction* policy. The
local workerd restart proves `restore()` works and the live probe proves
storage round-trips, but neither forces the platform to evict an idle object.

A durable deployment still needs an account: `servers/authorlink/README.md` has
the steps, and `ALLOWED_ORIGINS` is already set for the project's Pages origin.

Two bugs this phase shook out:

1. **The origin check ran too late.** The Node host accepted the WebSocket
   upgrade and then called `socket.close()`. The client still saw a successful
   `onopen`, and anything it pushed in that window was already delivered — a
   disconnect, not a refusal. The check now refuses the HTTP upgrade with a
   403 before the handshake completes. Caught by the probe, which asserted
   "cannot open the room" rather than "gets closed eventually".
2. **Nine inspector sliders exclude their own shipped default** — for example
   `spells.bomb.explosionRadius` defaults to 52 behind a 1..20 slider, so
   touching it snaps the value down with no way back. Found by an invariant
   test written for the range schema, not by the UI. The schema widens to
   admit the default so a hosted room does not inherit the bug; the underlying
   UI defect is tracked in `KNOWN_SLIDER_CLAMPS` so the list cannot grow
   silently. Fixing `paramSliderSpec` is a separate, user-visible change.

Verified: `npm run verify:authorlink-worker` — 14/14 against the real Durable
Object under workerd, and `npm run verify:authorlink-hosted` — 13/13. It builds the static
client against an EXTERNAL relay origin, serves `dist` from a different port,
and drives a real Sandbox slider across a cross-origin socket, then uses raw
sockets for the protocol edges a slider physically cannot reach (out-of-range,
unboundable path, missing token, bad origin).

Alternative spike (PartyKit) not needed: the Durable Object host was not the
slow part.

### Phase 5 - SpacetimeDB Spike

- Model `Room`, `ClientPresence`, `TuningPath`, `TuningValue`, and `PatchLog`.
- Implement reducers: `join_room`, `submit_patch`, `set_presence`,
  `commit_preset`.
- Subscribe clients to only their room.
- Measure patch fanout latency and dev friction from the browser client.

Deliverable: recommendation — keep as candidate, adopt, or reject.

### Phase 6 - .NET Server Spike

- ASP.NET Core prototype with SignalR groups.
- Typed DTOs, validation, auth token checks, health endpoints, OpenAPI for
  non-WebSocket operations.
- Optional Orleans room-grain prototype.
- Redis or Azure SignalR scale-out only if multi-instance hosting is needed.

Deliverable: a recommendation for or against the edge-relay options.

### Phase 7 - Multiplayer Research Prototype

- One bounded scenario: tiny arena, fixed seed, two players, no expedition
  persistence, limited sand region, input commands only.
- Measure bandwidth for input-only plus server events, region deltas, periodic
  snapshots, and client prediction with correction.

Deliverable: a data-backed multiplayer architecture decision.

## Acceptance Criteria

### First release (met)

- Two windows in the same room receive accepted tuning patches. ✅
- Late join receives the current room tuning snapshot. ✅
- Reconnect recovers without losing the latest room revision. ✅
- Invalid paths, wrong types, and out-of-ABI cell ids are rejected. ✅
- `paramsChanged` fires after remote patches so existing UI mirrors update. ✅
- LocalStorage tuning persistence still works without the relay. ✅
- The relay does not accept raw world/entity/runtime mutation commands. ✅
- A browser probe covers two connected contexts. ✅
- Realtime is off in production unless explicitly enabled. ✅

### Hosted release (not yet met)

- A static GitHub Pages build can connect to an external `wss://` relay.
- Out-of-range values are rejected visibly.
- Origin and room-token checks pass a hostile-client review.
- The probe covers reconnect against a hosted relay, not just a local one.

## Open Questions

Resolved by Phase 1:

- ~~Is the lab private-dev only, or exposed behind a hidden command?~~ Dev-only
  by default; production requires an explicit `?link=` opt-in.
- ~~Should the first relay be Cloudflare, a VM, or a .NET app host?~~ For local
  authoring, none — it rides the Vite dev server. The hosted question is
  deferred to Phase 4 and unchanged.
- ~~Do we need a hand-authored tuning schema?~~ No; derive it from the shipped
  defaults. Revisit only when a hosted room needs range metadata.

Still open:

- Do writable hosted rooms need accounts, or are room tokens sufficient?
- Do presets become repo JSON files, downloadable artifacts, or server records?
- Which gameplay constants must move into the tuning schema before this is
  worth using daily? (`src/combat/wands/compiler.ts` is the known offender.)
- What is the first multiplayer target: ghost/spectator, co-op arena, or shared
  expedition?
- Should terrain patches move to a binary encoding? Not needed at current
  stroke sizes; revisit if whole-region tools start publishing.

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

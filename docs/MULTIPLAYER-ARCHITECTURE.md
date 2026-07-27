# Multiplayer Architecture — decisions and evidence

- Status: **decided**; **stage 1 shipped and verified against a live
  database**. Supersedes the multiplayer sections of
  `REALTIME-TUNING-LAB-AND-MULTIPLAYER-SERVER-SPEC.md`, which remains the
  record for AuthorLink itself.
- Date: 2026-07-27.
- Scope: how this game becomes multiplayer without forking the simulation,
  and where SpacetimeDB does and does not belong.

## The decision in one paragraph

**Two planes, not one.** Durable, queryable, consistency-critical state —
sessions, rosters, player identity, progression, inventory, authored-content
metadata, chat — goes in **SpacetimeDB**. High-frequency ephemeral state — the
cell grid and input frames — goes over a **binary stream plane** that no
database mediates. The editor/debugger link (AuthorLink) is not a side project:
it is the first consumer of the same session substrate, which is why the
transport was just extracted behind `SessionTransport`. Anything that cannot
tolerate being a database row does not become one.

---

## What SpacetimeDB actually is

Researched 2026-07-27 against the current docs, not from memory.

- **Modules** hold schema and logic and compile to WebAssembly or a JavaScript
  bundle. They can be written in **Rust, C#, C++, or TypeScript** — TypeScript
  server modules are real, which matters enormously here (see below).
- **Reducers** are the only way to write. Each runs as an **atomic
  transaction**: "If the reducer instead returns an error, or throws an
  exception, the database will instead reject the request and revert all those
  changes."
- **Subscriptions** replicate rows to clients. A transaction produces "a state
  delta, i.e. an unordered set of inserted and deleted rows", which is
  evaluated against each subscription to push **incremental updates**. Clients
  keep a local cache that is updated atomically per transaction.
- **Everything is in memory**: "SpacetimeDB holds all data in memory, so the
  practical limit is the available RAM on the host."
- **Benchmarks** (their transfer workload, serializable isolation, full ACID):
  ~**304k TPS** at p50 **7.4 ms** / p99 **11.7 ms** contended; ~279k TPS
  uncontended.
- **Licence**: BSL 1.1, converting to AGPLv3 **with a linking exception** — our
  game code does not become AGPL. Self-hostable (`spacetime start`, Docker) or
  Maincloud, which meters "energy" and scales to zero when idle.

That is a genuinely good fit for a game backend. The question is *which* of our
state it should hold.

## What our game actually does — measured, not assumed

Two numbers decide the architecture. Both were measured on this codebase, in
the browser, on a real generated descent.

### 1. Cell churn: ~5–10k changed cells/second

| Scenario | cells/s | avg/frame | peak/frame |
| --- | --- | --- | --- |
| Idle settled cave | 4,830 | 41 | 103 |
| Immediately after a radius-46 explosion | 4,968 | 41 | 103 |
| A pool of water poured in | 9,310 | 78 | 187 |

This is **much lower than the grid size suggests**. The world is 1600×1064 =
1,702,400 cells, but a settled cave changes only tens of cells per frame; the
sim's cost is in *scanning*, not in *changing*.

That single fact reframes everything: a full cell-state stream is roughly
**65–130 KB/s raw** at 13 bytes/cell (idx u32, type u8, colour u32, life i16,
charge u16), and materially less packed. That is a perfectly ordinary network
stream. It is *also* 5–10k row-writes/second, forever, per session.

### 2. Sim determinism: achieved for the cell sim (stage 4), not yet for a whole run

*Originally measured as 504 `Math.random()` call sites, and recorded here as a
blocker.* As of 2026-07-27, 724 sites across `sim/`, `entities/`, `combat/`,
`game/` and `particles/` draw from seeded, tick-indexed streams instead
(`src/core/simRandom.ts`), enforced by lint. The randomized per-row scan
direction is still there — it is now *seeded*, which was always the real point.

The **cell simulation replays byte-identically** from a seed, proven in a real
browser. A **whole run** does not yet: the entity layer still diverges
intermittently (see Staging item 4). So deterministic lockstep is closer than
this document originally recorded, but it is not available today.

---

## Decision 1 — the cell grid does NOT live in SpacetimeDB

Rejected. The arithmetic is not fatal, which is precisely why this needs
stating: at 5–10k row updates/second the grid *would fit* inside a 300k-TPS
budget. It is still wrong.

- **You would be paying for guarantees you actively do not want.** Cell deltas
  are ephemeral, loss-tolerant, and worthless once superseded. Serializable
  ACID transactions, durability, and history are pure cost against state whose
  correct recovery strategy is "send the current grid again" — which is
  exactly what AuthorLink's `world.snapshot` already does.
- **It bills per operation.** Maincloud meters energy. A permanent 5–10k
  ops/second floor *per active session*, for data that is stale in 16 ms, is
  the most expensive possible way to move a byte.
- **It puts a transaction boundary in the frame loop.** The sim runs fixed-step
  substeps inside a 60 Hz tick, and `ARCHITECTURE.md` makes frame order a
  contract. Introducing commit latency (p50 7.4 ms — half a frame) into that
  loop is not a tuning problem, it is a redesign.
- **The subscription engine is the wrong router.** Cell deltas need spatial
  filtering (send me my camera window), not SQL predicate matching over 10k
  row-deltas a second.

**Instead:** the stream plane carries region deltas as binary frames, using the
`CellPatch` shape already in `src/authoring/cellPatch.ts` and already proven
across processes by AuthorLink.

## Decision 2 — session and metagame state DOES live in SpacetimeDB

Accepted, for exactly the state whose failure mode is "a player loses
progress", not "a frame looks wrong":

| Table | Why it belongs in a database |
| --- | --- |
| `session` / `room` | authoritative membership, revision, lifecycle |
| `player` | identity, connection ids, which session, role |
| `hero` | HP, wands, cards, flasks, gold — must survive a disconnect |
| `expedition` | seed, depth, `GEN_VERSION`, per-level persistence markers |
| `progression` | Grimoire entries, discovered recipes, unlocked cards |
| `authored_doc` | Builder documents and prefabs as shared content |
| `presence` | who is here, where their camera is, what they are editing |
| `chat` | ordinary durable messaging |

All of it is low-frequency, queryable, and genuinely wants ACID. This is
SpacetimeDB used as designed.

## Decision 3 — the module is written in TypeScript

SpacetimeDB supporting TypeScript modules changes the calculus. The original
spec worried that a Rust or C# server would "port or share simulation logic
carefully instead of letting TypeScript and C# behavior diverge" — the exact
two-implementations risk this codebase already refuses elsewhere (one
`instantiateObjects`, one room implementation, one material palette).

With TypeScript modules, the shared contracts in `src/authoring/` and
`src/core/types.ts` can be imported by the server rather than transcribed.
Rust is ~1.5× faster on their own benchmark (150k vs 100k TPS for modules) —
irrelevant at our volumes, and not worth buying a second language and a second
copy of the rules.

## Decision 4 — host-authoritative grid first, deterministic lockstep later

Given Decision 1 and the measured nondeterminism:

**Now — host-authoritative.** One peer owns the sim and streams region deltas;
others render and send inputs. This works with today's nondeterministic sim,
reuses `CellPatch` and the world-identity guard verbatim, and is a small step
from what AuthorLink already does. Its ceiling is honest: the host's machine
sets the tick budget, and host migration is a real problem to solve.

**Later — determinism as an enabler, pursued for its own sake.** Routing those
504 `Math.random()` sites through a seeded, tick-indexed PRNG buys, in order of
immediate value:

1. **Reproducible bug reports** — a seed plus an input log replays a crash.
2. **Golden-frame tests** for the sim, which currently has none.
3. **Cheap multiplayer** — send inputs, not cells.
4. **Rollback/prediction**, the only route to a feel-good action game at
   distance.

Note the ordering: determinism pays for itself in *testing and debugging*
before multiplayer ever ships. That makes it the right next investment even if
multiplayer slipped indefinitely.

## Decision 5 — when the host leaves, the session migrates

Decided 2026-07-27. Host-authoritative has exactly one bad failure mode, and it
needed a rule before stage 3 rather than a discovery during it.

**The session migrates. It does not end.** A host crash-quitting, closing a
laptop, or losing wifi is an ordinary event over a long expedition; ending
everyone's run because one machine's tab closed throws away precisely the
durable progress this plane exists to protect.

The rule, implemented in `servers/spacetime/spacetimedb/src/index.ts` and
verified live:

- The successor is the **longest-connected surviving member**. Ties break on
  the connection id's bytes, not on iteration order — two connections dropping
  in the same instant must not be able to elect different hosts.
- A **deliberate leave and a dropped socket take the same path**, so a clean
  exit and a crash cannot diverge. One rule, exercised twice.
- When the last member leaves, the session row **survives with no host**. Hero
  state, expedition seed, and progression outlive an empty room; the next join
  resumes and takes the host role rather than starting over.
- The host may also hand off deliberately (`transferHost`), and **only** the
  current host may do so — simulation authority is the one privilege in this
  schema worth guarding.

What this does *not* yet solve is grid continuity: the successor becomes
authoritative, but stage 3 must decide whether it adopts the previous host's
last streamed state or resynchronises from a snapshot. `world.snapshot` already
does the latter for the editor, so the fallback exists.

## Decision 6 — the editor and the debugger ride the same substrate

This was the explicit requirement, and it is why `SessionTransport` was
extracted before any of the above is built.

AuthorLink and multiplayer are the same shape: peers join a named room,
announce presence, exchange patches against shared state. They differ in what
carries the bytes and how durable the state is. Left welded to a raw
`WebSocket`, multiplayer would grow a parallel stack — two reconnect policies,
two presence models, two sets of echo bugs — and the debugger would break the
moment the game moved backends.

So the split is now:

```
AuthorLinkClient        session semantics: reconnect, heartbeat, echo
                        suppression, revision tracking, typed fan-out
      │
      ▼
SessionTransport        opaque frames in and out
      ├── WebSocketTransport   the dev relay (today)
      └── SpacetimeDbTransport a row is a message, send() is a reducer (next)
```

`tests/authorlink.test.ts` drives the whole client over an in-memory transport
with no WebSocket anywhere, which is the check that keeps this split real
rather than cosmetic.

The consequence worth stating plainly: **the remote debugger becomes a
multiplayer spectator for free.** Presence, world identity, and patch
application are the same mechanisms. A developer watching a live session and a
player watching a teammate differ only in permissions.

---

## What this means for the existing AuthorLink work

Nothing built so far is throwaway, and several pieces become load-bearing:

| Built for AuthorLink | Role in multiplayer |
| --- | --- |
| `CellPatch` + `applyCellPatch` | the stream plane's frame format |
| `WorldIdentity` + refusal | prevents applying a patch to the wrong level — the same bug class, with a stranger's level |
| `world.snapshot` / pull | join-in-progress state transfer |
| room + presence + revision | maps directly onto session tables |
| the strict relay's origin/token/range checks | the shape of server-side validation |
| `SessionTransport` | the seam SpacetimeDB plugs into |

## Staging

Each stage is independently valuable; none is a prerequisite for shipping the
game single-player.

1. ~~**Session tables in SpacetimeDB**~~ — **done, 2026-07-27.** The module
   (`servers/spacetime/`) holds `session`, `player`, `presence`, `chat`, and an
   event-table `frame`; `SpacetimeDbTransport` + `createSpacetimeConnector`
   carry AuthorLink over it. An **unmodified `AuthorLinkClient`** now runs on
   either backend. 28 live checks against a real database
   (`npm run verify:spacetime`), 14 unit tests for the translation layer.

   What stage 1 actually taught us, none of which was in the plan:

   - `ctx.connectionId` is **nullable** — a scheduled reducer or an owner-side
     `spacetime call` has no connection, so per-window reducers must refuse it.
   - **Two browser windows share one Identity** (one localStorage token).
     Membership therefore keys on `ConnectionId`; keying on `Identity` would
     have silently collapsed the editor's two windows into one player and let
     a peer migrate the host onto its own other tab. This is the single most
     load-bearing correction the staging produced.
   - `spacetimedb` is a **devDependency only**. The connector takes the
     generated `DbConnection` as a parameter, so `src/net` imports neither the
     SDK nor the codegen output and the shipped bundle is unchanged.
   - **Closed same day:** durable tuning. `applyTuning` records and broadcasts
     in ONE transaction, so a room cannot disagree with itself about its own
     settings; late joiners inherit it through `welcome`. Strict rooms validate
     against the *same generated range table the relay enforces* — a second
     hosted backend with its own idea of which values are legal would only have
     moved the drift, not removed it. The backends are now behaviourally
     interchangeable, and on tuning SpacetimeDB is strictly better: the relay
     loses accumulated tuning on restart, a table does not.
   - Client codegen **PascalCases sum-type variants**, so a server variant
     named `num` must be sent as `Num`. The module names them PascalCase to
     match rather than carry the asymmetry.
2. ~~**Binary stream plane**~~ — **done, 2026-07-27.** `CellPatch` now packs to
   `src/authoring/cellPatchCodec.ts` and rides a binary frame
   (`src/net/binaryFrame.ts`) through the relay. Verified in two real browsers
   at **~13 bytes/cell**, against ~26 as JSON — the predicted 2×.

   - **Lossless by construction**: each column is written at the exact width of
     the `World` plane it mirrors (`types` u8, `colors` u32, `life` i16,
     `charge` u16). A test asserts those widths still agree rather than
     trusting the comment, so widening a plane fails loudly instead of
     truncating silently.
   - **Column-major, not interleaved**, so each column is a run of
     same-magnitude values a generic compressor can exploit. Interleaving would
     hand it 13-byte noise.
   - **The header stays JSON.** Routing fields are a few dozen bytes against a
     payload of kilobytes; packing them would buy nothing measurable and cost
     the ability to read a frame in a debugger.
   - **The relay never decodes the payload.** It checks the magic, the sender's
     write right, and the size cap, then forwards verbatim — a second copy of
     the frame format living on the server is exactly the drift to avoid.
   - **`supportsBinary` is a capability, not an assumption.** A backend that
     cannot carry bytes degrades to JSON rather than dropping terrain.

   Note what this means for SpacetimeDB: its transport deliberately does *not*
   advertise binary, so cells fall back to JSON there. That is not a gap — it
   is Decision 1 holding. The grid does not belong in the database, and the
   capability flag is what keeps that architectural line from needing a special
   case anywhere else.
3. **Host-authoritative co-op**, bounded: one level, two players, no expedition
   persistence. **Not started — and it is a project, not a slice.**

   Measured 2026-07-27, because "bounded" was doing a lot of unexamined work in
   the sentence above: `ctx.player` is a **2,492-line singleton referenced 226
   times across 46 files**. Camera, HUD, death and respawn, spell targeting,
   pickups, and the physics bridge all assume exactly one of them. Nothing
   about the *transport* is missing any more — host election, the session
   tables, and the binary cell plane are all done and verified. The gap is
   entirely in the game's own shape.

   Two honest routes, to be chosen deliberately rather than discovered
   halfway:

   - **Generalise the roster.** Turn `ctx.player` into an indexed set and fix
     226 call sites. Correct, and it is what real co-op eventually needs, but
     it touches nearly every gameplay system at once — the exact change this
     codebase's verification workflow is least able to check in one step.
   - **Ghost co-presence first.** Render the peer as a non-authoritative
     visitor driven by the `presence` table: you see their wizard move through
     your world, but neither sim yields authority. Small, verifiable, ships
     something real, and it exercises presence and interpolation — the parts
     most likely to feel wrong — before anything depends on them being right.

   Chosen: **ghost co-presence first** — and **shipped 2026-07-27**. A peer's
   wizard now appears in your world as a spectral phantom
   (`entities/PeerGhosts.ts`, `render/sprites/PeerGhostSprite.ts`), driven by a
   `peer` pose message. Neither simulation yields authority; `ctx.player` was
   not touched. 16 live checks in two real browsers
   (`npm run verify:peer-ghosts`), 11 unit tests on the interpolation.

   What it settled, and what the probe caught that reasoning did not:

   - **An 8-field pose, not a player.** `PlayerSprite` reads 40 fields.
     Streaming them all would be heavy and dishonest, because a peer is drawn
     as a phantom, not a second real wizard.
   - **Additive, never opaque.** A phantom cannot be collided with or shot, so
     it must not look like it can be. Translucency says so without a tutorial,
     and a mispredicted position can never occlude the level you are playing.
   - **Publish on change, never on a timer.** A window whose player stands
     still sends nothing at all, which keeps the AuthorLink probe's
     "idle room stays idle" invariant intact instead of quietly breaking it.
   - **Silence is not absence.** The first cut expired phantoms after 4 s of
     silence — which, with change-based publishing, made a *motionless
     teammate vanish*. The roster is the departure signal: `AuthorLink` clears
     phantoms when the peer count hits zero, and the timeout is only a safety
     net for a peer that disappears without the roster noticing.
   - **Extrapolation is short (80 ms).** Same root cause: a gap in samples
     usually means the peer stopped, not that a packet dropped, so coasting far
     would sail the phantom past where they are standing and snap it back.
   - **A gate on `state.playerSpawned` would have silenced the whole
     campaign.** That flag tracks the sandbox's click-to-place spawn and is
     reset to false on entering a level. Only the live probe could find that.

   The refactor route (generalising the 226 `ctx.player` references) is now a
   *choice made against evidence* rather than the only option, and the feel
   question it was gating is answered.
4. **Determinism** — **the cell simulation is done and proven, 2026-07-27; the
   entity layer is converted but not yet proven.** 724 `Math.random()` call
   sites moved onto seeded, tick-indexed streams (`src/core/simRandom.ts`).

   **Four streams, not one**, because sharing one couples unrelated subsystems:
   adding a single particle would shift every liquid's settling for the rest of
   the tick, and a golden-frame test could then only ever report "everything
   changed".

   | Stream | Owns | Why separate |
   | --- | --- | --- |
   | `sim` | `src/sim/**` | the cellular automata; reseeded per *substep*, since `Simulation.update` runs 0–6 per tick |
   | `entity` | `entities/`, `combat/`, `game/` | AI and combat rolls |
   | `particle` | `particles/` | **state, not cosmetics** — a typed `looseDebris` particle deposits itself back into the grid when it lands |
   | `fx` | tint, audio cues, null-typed sparks | the only draws nothing ever reads back |

   The `particle` split came from reading `Particles.ts` rather than assuming:
   particles were first put on the cosmetic stream, which would have let a
   palette tweak move where explosion debris settles.

   **Enforced, not documented.** ESLint bans `Math.random` in every converted
   directory *and* bans importing the seeded streams from `render/`, `ui/`,
   `builder/`, `audio/` — presentation runs at render rate, so a seeded draw
   there would make the stream depend on frame rate. Both directions are
   probe-tested. This is the answer to "partial determinism is worse than none":
   the boundary cannot quietly erode.

   **What is proven** (`npm run verify:determinism`, 7 live checks; plus
   `tests/sim-golden-frame.test.ts` and `tests/sim-random.test.ts`, 16 unit
   tests): the cell simulation replays **byte-identically** over 240 ticks on a
   real generated world in a real browser, with identical per-stream draw
   counts; different seeds and different inputs diverge. The sim now has the
   regression test it never had — `gen-golden` locked what the *generator*
   produces, nothing locked what the sim then *does* to it.

   **What is not.** Whole-tick replay does **not** hold yet. With the grid,
   camera, player and every clearable subsystem reset to a byte-identical start,
   the entity stream still takes a different number of draws from about tick 14
   onward, and the run diverges. It is *intermittent* rather than a clean
   repeatable difference, which points at a race with asynchronous start-up work
   rather than a missed seed. The probe **measures** this instead of asserting
   it, so the number is on the record either way. Until it closes, "replay the
   seed" is true of the falling-sand sim and not of a whole run.

   Two real bugs the live probe caught, neither findable by reading:

   - **`Camera.snapTo` did not clear its own smoothing state.** It documents
     itself as bypassing smoothing but left `aimLookaheadX` and `idleFrames`
     behind, so every level entry inherited the previous level's aim offset and
     idle-zoom counter. It matters beyond feel because **the sim window follows
     the camera** — a one-cell difference changes which cells are simulated at
     all. Fixed.
   - **`World.clear()` zeroes the moved plane but not its epoch**, so the
     `movedTick` wrap landed at a different substep depending on history.

5. **Rollback/prediction** — blocked on 4's entity layer, not just on 4.

## Risks, stated honestly

- **Two planes is two things to operate.** Mitigated by both being reachable
  from one `SessionTransport` seam and one relay codebase, but it is real.
- ~~**Host-authoritative has a bad failure mode**: the host leaving.~~
  Resolved by Decision 5 — the session migrates to the longest-connected
  survivor, implemented and verified. What remains for stage 3 is grid
  continuity across the handoff, not the handoff itself.
- **SpacetimeDB is a younger ecosystem** than Postgres or a hand-rolled
  service. The BSL-to-AGPL-with-linking-exception licence is acceptable, and
  self-hosting is a genuine escape hatch, but it is a dependency at the centre
  of the metagame. The `SessionTransport` seam is deliberately the *only*
  place it touches the client.
- **Nothing here is benchmarked at scale by us.** Their numbers are their
  workload, not ours. Stage 1 exists partly to produce our own.

## Sources

- SpacetimeDB docs — key architecture, modules, reducers, subscriptions,
  TypeScript quickstart, FAQ: https://spacetimedb.com/docs
- Benchmarks: https://spacetimedb.com/blog/benchmarking
- Pricing and energy model: https://spacetimedb.com/pricing
- Licence: https://github.com/clockworklabs/SpacetimeDB/blob/master/LICENSE.txt

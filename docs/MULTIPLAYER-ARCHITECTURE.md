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

### 2. Sim determinism: not currently possible

`Math.random()` appears at **504 call sites across 21 files** in `sim/`,
`entities/`, and `particles/`. On top of that, `ARCHITECTURE.md` records as a
deliberately preserved quirk: *"The material sweep randomizes scan direction
per row; the sim is nondeterministic."*

Deterministic lockstep — the cheapest multiplayer model by bandwidth, and the
one that would let a database carry only inputs — is therefore **not available
today**, and reaching it is a real project, not a flag.

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
   - Remaining gap before the backends are interchangeable: the relay's
     `welcome` carries accumulated room tuning for late joiners and the
     synthesized one does not. Needs a `(room, path) -> value` table — after
     which tuning survives a server restart, which the relay's in-memory
     accumulation does not.
2. **Binary stream plane**: replace JSON `CellPatch` frames with a packed
   binary encoding. At 13 bytes/cell measured, JSON's ~26 bytes/cell is the
   easiest 2× on the table, and it is needed either way.
3. **Host-authoritative co-op**, bounded: one level, two players, no expedition
   persistence. Measure before widening.
4. **Determinism**, pursued for replay and golden-frame tests first.
5. **Rollback/prediction** — only once 4 is real and measured.

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

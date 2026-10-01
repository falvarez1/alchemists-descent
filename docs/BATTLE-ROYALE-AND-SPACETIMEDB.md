# Battle Royale mode, online multiplayer, and whether we need SpacetimeDB now

- Status: **decision + roadmap** (2026-09-30). Nothing here is built. It answers one
  question — *do we have to start integrating SpacetimeDB now?* — and lays out what the
  Battle Royale idea actually needs first.
- Builds on `docs/MULTIPLAYER-ARCHITECTURE.md` (the July decisions, the SpacetimeDB stage-1
  prototype, and its 2026-09-26 archive). Read that for the evidence; this file does not
  repeat it.

## The answer

**No. Do not integrate SpacetimeDB now, and do not let it gate the Battle Royale work.**

A Battle Royale / Smash-style mode is a *game-design and game-architecture* project first. Its
blockers are inside the game (a single-player `ctx.player`, a non-deterministic entity layer, no
fighter rules, no arena content), and none of them is something a database removes. The one
thing a database does add — durable accounts, ranking, matchmaking history — is not needed to
ship the first playable version, and when it is needed there are two cheaper options than
SpacetimeDB sitting in the repo's own deploy target (Cloudflare).

Revisit the question when **all** of these are true: the mode is fun offline, two friends can
finish a match online through a room code, and the next feature on the list is something that must
survive a disconnect and be queried across rooms (ranked ladder, persistent cosmetics, a public
lobby browser). Not before.

## What is true today (measured in this checkout, not recalled)

| Fact | Consequence |
| --- | --- |
| SpacetimeDB was built and verified in July (session tables, host migration, 28 live checks), then **frozen and archived on 2026-09-26** (`git tag archive/spacetimedb`) when the product became a free single-player web game. | The integration cost was already paid once and is recoverable; the decision to freeze it was deliberate and is still correct for the game that ships today. |
| The grid never belonged in a database (`MULTIPLAYER-ARCHITECTURE.md` Decision 1): ~5–10k cell changes/s, 13 bytes/cell on the binary plane, loss-tolerant, worthless once superseded. | SpacetimeDB could only ever hold *lobby/account/progression* state for this game. It would not touch the hard part of an arena match. |
| `ctx.player` is referenced **701 times in 103 files** (it was 226 in 46 in July; the polish pass made it worse). `src/entities/Player.ts` is a 2,571-line singleton. | The real gate for any multiplayer mode is a **fighter roster**, not a backend. Every week the singleton grows, this gets dearer. |
| The cell simulation replays byte-identically from a seed (`npm run verify:determinism`); a whole tick does **not** (entity stream diverges from ~tick 14). Rapier is the non-deterministic `rapier2d-compat` / `-simd-compat` build. | Lockstep and rollback netcode are not available. Host-authoritative is the only honest first choice. |
| A relay already exists and already runs on Cloudflare: `servers/authorlink/room.mjs` (room logic, revisions, presence, strict origin/token/range checks) hosted by a Node server in dev and by a **Durable Object** in production (`worker.js`, hibernating, SQLite-backed). `SessionTransport` is the client seam. `PeerGhosts` already renders a remote wizard from an 8-field pose. | "Rooms, presence, relay" — the things SpacetimeDB was going to provide — already exist. Adding players means widening a message set, not adopting a platform. |
| The world is a fixed 1600×1064 grid and the sim window follows the camera (±60 cells). | An arena is a *region* of the existing grid, not a new world type. Multi-target camera framing is the new requirement, not a new simulation. |

## What Battle Royale needs, in the order it blocks you

1. **A fighter roster.** Turn the singleton into an indexed set (`ctx.fighters[]`), keep
   `ctx.player` as an alias for the local fighter so the 700 call sites keep compiling, and
   migrate systems (camera, HUD, spells, pickups, death/respawn) to take a fighter argument one
   module at a time. This is the long pole, and it is pure game work. Do it **offline first**.
2. **Fighter rules that make "Smash with real physics" true.** The alchemist already has
   knockback sources (explosions, telekinesis, liquids, rigid bodies). What is missing is the
   *rules*: a damage-accumulation value that scales knockback (a "volatility %" instead of HP),
   blast-zone ring-outs, stocks and respawn platforms, and a *collapse* that shrinks the playable
   area — rising lava/brine/acid is the falling-sand-native answer to the battle-royale circle.
3. **Arena content.** Stages are authored, not generated. The Builder is the right tool, which
   makes it the first place this project touches: see "Builder hooks" below.
4. **Multi-target camera + sim window.** Frame all live fighters (Smash-style dynamic zoom) and
   simulate the union of their windows; budget it (`docs/PERF-2026-09.md`).
5. **Netcode, host-authoritative, small.** One peer owns the sim and streams region deltas (the
   existing `CellPatch` + binary plane, proven at ~13 B/cell); others send inputs; each client
   predicts only its own fighter. Target 2–4 players first. Transport = the existing relay
   (Durable Object), message set widened with `input` / `fighter-state` frames.
6. **Only then**, if needed: accounts, ranked ladder, persistent unlocks, public lobbies.

## Staged plan

| Stage | Deliverable | Needs a backend? |
| --- | --- | --- |
| A | `ctx.fighters[]` roster + local 2–4 player on one screen (keyboard + gamepad) and bots; arena rules (volatility %, blast zones, stocks, collapse) on a hand-built stage. **Prove the feel offline.** | No |
| B | Builder can author **arena stages** (document `kind: 'arena'`, N fighter spawns, blast-zone bounds, item spawners, a collapse hazard) with arena-specific validation (spawn fairness, symmetry — the Builder already has mirror painting). | No |
| C | Online 2–4 players through a **room code**: host-authoritative over the existing relay (Cloudflare Durable Object), input frames up, cell patches + fighter snapshots down at ~30 Hz, local prediction for your own fighter. | Relay only (already built) |
| D | Matchmaking / public lobbies / ranking / persistent cosmetics. Evaluate **Durable Objects + D1** (same Cloudflare account, no new vendor) against **SpacetimeDB** (archived prototype, TypeScript module, host-migration logic already written) *at this point*, with a real list of queries the product needs. | Probably |
| E | Rollback for ≤4 fighters on a small stage — only if host-authoritative feels bad. Needs whole-tick determinism (finish the entity stream), a deterministic Rapier build, and a journaled grid (the sim already funnels every change through `world.swap`). Treat as research. | No |

## Why not "just do SpacetimeDB now" — the honest counter-arguments

- *"It is already built."* True, and that is an argument for **keeping the tag**, not for
  shipping it. A database in the critical path of a free web game adds an operated dependency
  (Maincloud energy metering, a BSL-licensed server) before a single match exists.
- *"It gives us host migration and presence."* The relay has presence and revisions today; host
  migration (Decision 5) is worth porting *when a session can outlive its host*, which is a
  stage-C problem, and the logic is small and already written in the archive.
- *"Durable state will be needed eventually."* Yes — stage D. Until a feature needs a query
  across rooms, a Durable Object's own storage is enough, and the `SessionTransport` seam means
  choosing later costs one new transport class, exactly as planned in July.
- *"Rooms of 100 players."* "Battle Royale" here means a *last-alchemist-standing arena match*,
  2–8 players, not a 100-player persistent island. The sim cannot host 100 casters anyway
  (`PERF-2026-09.md` tracks a boss-FX stress scene as the heaviest case it measures; several
  simultaneous casters is that load, continuously). If 8+ ever becomes a goal it
  changes the architecture (dedicated simulation servers), and that is a different, much larger
  decision than a database.

## Builder hooks this decision implies (small, do-able now)

These are the only parts worth doing before stage A, because they cost little and keep the door
open; none is part of the current Builder cleanup:

- Give `EditorDocument` an explicit **level kind** (`expedition` today, `arena` later) so stage
  authoring does not have to be retrofitted into an "expedition level" shape. Keep the save
  families separate (CLAUDE.md): this is a discriminator on the Builder document, not a merge of
  formats.
- Keep **symmetry painting** healthy — fair arenas are mirrored arenas.
- Keep the Builder ↔ game **link** (`AuthorLink`) honest about world identity; a live stage being
  edited while a match plays in another window is the natural workflow for arena tuning.

## Risks

- **The roster refactor is bigger than it looks.** Budget it as its own project with its own
  verification, not a slice. Do not start it inside a polish pass.
- **Destruction + knockback can degenerate** (a map that erodes into a flat hole has no
  verticality). Stage A exists to find that out cheaply; design collapse rules so the arena
  stays interesting as it is destroyed (indestructible anchors, regrowing flora/crystal).
- **Host-authoritative input latency** feels worst for the fighter you control; client
  prediction of one's own fighter is the mitigation and must be designed in from stage A's input
  model, not bolted on in stage C.
- **Scope drift.** The July architecture document names "co-op" as stage 3 and calls it a project,
  not a slice. Battle Royale is the same project with a different rule set; do not treat it as
  cheaper because it is "just a mode".

# Session substrate (SpacetimeDB)

The durable plane of `docs/MULTIPLAYER-ARCHITECTURE.md`: sessions, membership,
presence, chat, and host migration. **The cell grid is deliberately not here** —
see "What this must never become" below.

```
spacetimedb/src/index.ts   the module (tables + reducers), TypeScript on V8
bindings/                  generated client bindings, committed
```

## Running it

```bash
spacetime start                     # local instance on 127.0.0.1:3000
npm run spacetime:publish-local     # build + publish
npm run verify:spacetime            # 28 live checks
```

`spacetime start` is a foreground process; leave it in its own shell. Publishing
hot-swaps without disconnecting clients, but a schema change needs
`--delete-data=always` on the local instance.

Regenerate bindings after any table or reducer change:

```bash
npm run gen:spacetime-bindings
```

They are committed on purpose — the same convention as `gen:tuning-ranges` and
the builtin prefabs. A schema change should show up as a reviewable diff, and
committing them means `verify:spacetime` runs without the CLI installed.

## Verification

`scripts/verify-spacetime-session.mjs` runs against a **real** local database —
no mocks. It proves, in order of how much it would hurt to get wrong:

1. **Host migration.** The host disconnecting hands off to the
   longest-connected survivor. Checked twice, so it is a rule and not an
   accident.
2. **Durability.** The session, and its chat, outlive every member leaving.
3. **Frame relay.** An opaque AuthorLink envelope round-trips byte-for-byte.
4. **Guards.** Non-members cannot publish, oversized frames are refused, only
   the host may transfer the host role.
5. **The real client stack.** An unmodified `AuthorLinkClient`, over
   `SpacetimeDbTransport`, over `createSpacetimeConnector` — the code the game
   actually runs, not a reimplementation of it.

Unit tests for the translation layer live in `tests/spacetime-transport.test.ts`.
They cover the mapping only; whether the *database* behaves is the live probe's
job, because a mock asserting my own assumptions about SpacetimeDB would prove
nothing about SpacetimeDB.

## Things that bit me

- **`ctx.connectionId` is nullable.** Not every reducer call comes from a
  client — a scheduled reducer, or the owner running `spacetime call`, has no
  connection. Every table here is keyed per-window, so those callers are
  refused rather than allowed to act as an arbitrary member. This is why you
  cannot exercise membership from the CLI.
- **Two browser windows share one Identity.** They share a localStorage token,
  so `Identity` answers "who" and only `ConnectionId` answers "which window".
  The editor link is *explicitly* two windows, so every member key is a
  ConnectionId. Keying on identity collapses both windows into one player and
  would let a peer migrate the host onto its own other tab.
- **Event tables are not stored.** `frame` rows are broadcast and never enter
  the client cache: `count()` is 0 and `iter()` yields nothing. Only `onInsert`
  fires. That is exactly right for a relayed message and exactly wrong if you
  ever expect to read one back.
- **Generated bindings use extensionless imports.** Vite resolves them
  natively; Node's ESM loader will not. The probe bundles them with esbuild.
- **A reducer returns a promise** that rejects with the module's `SenderError`.
  Guard checks should read that reason rather than infer a refusal from an
  absent side effect.

## What this must never become

The sim changes ~5–10k cells/second (measured, see the ADR). That *fits* inside
SpacetimeDB's throughput budget, which is precisely why the exclusion is written
down rather than assumed:

- cell deltas are ephemeral and worthless once superseded, so ACID durability
  is pure cost against state whose recovery strategy is "send the grid again";
- a metered backend billing 5–10k ops/second per session, forever, for data
  stale in 16 ms is the most expensive possible way to move a byte;
- `p50` commit latency is half a frame, and frame order is a contract.

`session.revision` already serializes a room's writes on one row. That is fine
for editor traffic and would be wrong for gameplay cell traffic — which is on
the other plane by design, and must stay there.

## Not done yet

The relay's `welcome` carries accumulated room tuning so a late window catches
up; the synthesized one sends an empty list because there is no `tuning` table.
A window joining mid-session will not inherit tuning already applied. Closing
that gap means a `(room, path) -> value` table folded into the welcome — at
which point tuning also survives a server restart, which the relay's in-memory
accumulation does not. **This is the last thing standing between the two
backends being interchangeable.**

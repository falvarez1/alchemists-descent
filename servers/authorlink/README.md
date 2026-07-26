# AuthorLink relay

The room that two (or more) app windows join to stay in sync. Two hosts run the
**same** room logic (`room.mjs`); they differ only in sockets and persistence.

| Host | File | Used for |
| --- | --- | --- |
| Node `ws` | `../../scripts/authorlink-server.mjs` | rides the Vite dev server; also runs standalone |
| Cloudflare Durable Object | `worker.js` | hosted rooms, two machines, `wss://` |

## Local (the default)

Nothing to do. `npm run dev` mounts the relay on the dev server, and both app
routes join room `local` automatically. See the spec for the workflow.

Standalone, e.g. to serve a production build or share over a LAN:

```powershell
npm run authorlink:server -- --port 8787
```

## Strict mode

A local room is two windows the same person owns, so it is permissive. Anything
reachable by other people should run strict, which turns on three checks:

```powershell
node scripts/gen-tuning-ranges.mjs          # once, and after any tuning change
npm run authorlink:server -- --port 8787 --strict `
  --token "$(openssl rand -hex 16)" `
  --origin "https://you.github.io"
```

- **Origin allowlist** — refused at the HTTP upgrade, before the handshake
  completes. Accepting and then closing still gives the client a working
  `onopen`; that is a disconnect, not a refusal.
- **Room token** — required for writes. A client without one is still welcomed
  and can watch; it just cannot publish. A silent disconnect would be harder to
  diagnose than a visible read-only state.
- **Per-path ranges** — `tuningRanges.generated.mjs`, generated from the app's
  own schema. 173 of 198 tuning paths carry bounds; the rest (`pacing.*` and a
  few `gen.*`/`global.*` dials with no authored UI) are **refused** rather than
  guessed at. Closing that gap means giving those dials a declared range.

## Cloudflare deploy

Requires a Cloudflare account and `wrangler`. **Nothing here runs or bills
until you deploy it.**

```powershell
cd servers/authorlink
node ../../scripts/gen-tuning-ranges.mjs      # worker.js imports the generated table
npx wrangler secret put ROOM_TOKEN            # paste a long random string
# set ALLOWED_ORIGINS in wrangler.toml to your Pages origin first
npx wrangler deploy
```

Then build the client against it:

```powershell
$env:VITE_AUTHORLINK_URL   = "wss://alchemists-descent-authorlink.<you>.workers.dev"
$env:VITE_AUTHORLINK_TOKEN = "<the same token>"
npm run build
```

Open the deployed client with `?link=<room>`. Production never connects
without that parameter.

### Why a Durable Object

A room needs one authority for its revision counter and tuning snapshot, and
`idFromName(room)` gives exactly that: every client naming the same room lands
on the same object, worldwide. A stateless Worker cannot coordinate that.

`worker.js` uses the **hibernation** API (`acceptWebSocket`, not
`server.accept()`) so an idle room can be evicted from memory while sockets
stay open. The catch is that in-memory state does not survive, so the snapshot
is persisted (coalesced, ~250 ms) and restored on wake. A relay that dropped
its snapshot on hibernation would work perfectly until the room went quiet for
a minute and then silently stop catching up late joiners.

## Verify

```powershell
npm run verify:authorlink          # dev relay, two browser contexts
npm run verify:authorlink-hosted   # production build + EXTERNAL strict relay
npm run verify:authorlink-worker   # the REAL Durable Object under workerd
```

`verify:authorlink-worker` needs no Cloudflare account: `wrangler dev --local`
runs `worker.js` in workerd with a real Durable Object binding and real
`state.storage`. It restarts the Worker mid-probe and asserts the room's tuning
snapshot and revision come back — the failure that would otherwise look fine
until a room went quiet and then quietly stopped catching up late joiners.

`verify:authorlink-hosted` is the deployment rehearsal: it builds the static
client against an external relay origin, serves `dist` from a different port,
and checks cross-origin connect, token gating, range rejection, and origin
refusal through the real UI plus raw sockets.

`verify:authorlink-edge` runs against a DEPLOYED relay over real `wss://`:

```powershell
node scripts/verify-authorlink-edge.mjs <token-file> <host>
# AUTHORLINK_ORIGIN must match an ALLOWED_ORIGINS entry exactly
```

It has been run once, against a temporary preview deployment — 9/9. That
confirmed TLS termination at the edge, the Durable Object serving a room from
Cloudflare's runtime, range validation, token gating, origin refusal (403 at
the handshake), and snapshot catch-up from live DO storage.

Two things that probe taught us, both baked into it now:

- **Give a fresh deploy time to propagate.** The very first run, seconds after
  `wrangler deploy`, was refused outright; the identical run minutes later
  passed.
- **Edge waits are not localhost waits.** A 700 ms settle produced a false
  failure that read as broken token handling. It uses 1.5 s.

**Still unverified:** Cloudflare's real hibernation *eviction* policy. A local
workerd restart proves `restore()` works, and the live probe proves storage
round-trips, but neither forces the platform to actually evict an idle object.

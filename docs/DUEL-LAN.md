# LAN Duel

Two players use separate computers to fight a three-stock match on the Foundry
stage. Each player chooses a fighter and controls one seat. The host browser
runs the simulation; the other browser receives the resulting world and combat
state. The existing couch/CPU Duel remains available.

## Play on two computers

On the computer running this checkout:

```powershell
npm install
npm run dev:lan
```

1. Open `http://localhost:5180/`, choose **Duel → Play over LAN → Host a match**.
2. Open the LAN address displayed by the host on the other computer. It should
   look like `http://192.168.x.x:5180/`. Both players must use this same server;
   the second computer needs only a browser.
3. On the second computer choose **Duel → Play over LAN**, enter the room code,
   and join. Choose fighters, ready both seats, then the host starts the match.

Keep the host tab open and visible while playing. Allow Node through Windows
Firewall on your private network if Windows prompts. If the address cannot be
reached, check the host's Wi-Fi/Ethernet address and that the devices are not on
an isolated guest network. VPN and virtual-adapter addresses may also appear in
Vite's output; use the address reachable from the second computer.

Default controls on **both** computers: A/D move, Space jump, W + Space recover,
F melee, G grab, K shield, mouse click special, Z tactical, T ultimate, Esc pause.
Directional modifiers use W/A/S/D. Rebound keys are read from the normal bindings.
Standard controllers work where the browser permits the Gamepad API; browsers
can restrict it on plain HTTP LAN addresses. Keyboard and mouse work over HTTP.

Either player can pause. The host resumes, changes fighters, or starts a rematch.
Controller Start pauses/resumes; unplugging a controller pauses the match.
Socket loss pauses both players and attempts reconnection using an in-memory seat
lease. After reconnection the host resumes explicitly. Interrupted initial loads
return to fighter selection. Leaving ends the room for both players. Reloading
a tab loses its lease: create a new room. There is no host migration.

This server is for trusted LAN testing. The public static Pages site does not
host this WebSocket service, and this change does not deploy online multiplayer.

## Boundaries

| Layer | Responsibility |
| --- | --- |
| `DuelControls` | Local keyboard/pointer/controller to semantic buttons and aim |
| `DuelSession` | Room lifecycle, preparation, input sequencing, snapshots, reconnection |
| `DuelRuntime` | Adapt `Ctx` and existing arena combat to authority or presentation |
| `SessionTransport` | Ordered text/binary delivery, connection callbacks, queue depth |
| `servers/duel/Room` | Ready/start/pause rules, match epochs, seat ownership |
| `servers/duel/server` | WebSocket connections, origin checks, identity leases and limits |
| `servers/duel/plugin` | Attach the service to Vite's HTTP server |

Gameplay accesses `ctx.duel` through `DuelApi`. The composition root injects the
transport and runtime into the session. The UI observes session state and sends
commands; it never manipulates sockets, positions, or damage.
While a Duel is active, the editor's AuthorLink connection suspends application
traffic so editor tuning, commands, terrain, and ghost poses cannot change a match.

Both computers send the same input vocabulary. The host applies those inputs
through existing stock combat at the game's normal fixed tick. The guest never
runs simulation ticks, resolves damage, or writes expedition saves. No second
combat implementation exists. Shared `prepareDuel` builds disposable matches
for both LAN and local versus, with countdown/respawn protection owning immunity.

## Replication

Inputs are sequenced, bounded bitmasks plus an aim angle. Keyboard and pointer
button edges send immediately; frame polling maintains held input and controllers.
The host latches press
edges and their direction across ticks and releases stalled input after 500 ms.
Only the guest seat's inputs are forwarded to the host. Client positions, damage,
and outcomes are not accepted as control commands.

At most 30 times per second, the host publishes a versioned binary frame holding
JSON presentation state and a packed terrain delta. Each frame has a match epoch,
sequence, base sequence, and baseline marker. The terrain and presentation apply
atomically. Backpressure defers capture, preserving the last successfully sent
terrain as the comparison point; a failed send requires a fresh baseline. Guests
reject stale epochs, duplicates, and deltas with missing predecessors. Baselines
are sent on start/resume/resync. Reliable ordered delivery does not need recurring
full-world transfers during steady play.

Snapshots include both player poses and costumes, stock/attack/defense views,
fighter ability readouts, projectiles, particles, lights, camera and audio cues.
The guest's own fighter displays the latest confirmed position immediately. The
opponent interpolates one snapshot interval behind; respawns and large teleports
snap. The guest composes a new frame only when received state or interpolation
changes, instead of rebuilding an unchanged scene on every display frame.
Existing kit effects use closure-owned drawing code, so a
compatibility adapter captures bounded world-space pixel commands for those
effects only (24,000 pixels per fighter per snapshot). These commands are cosmetic;
they never affect collision. Semantic kit visual data would reduce this bandwidth.

The terrain tracker scans the grid on each publication, skipping shadow writes
for unchanged cells while preserving detection of raw simulation plane writes. Baselines,
busy terrain and complex kit effects can be expensive. This first LAN version has
no client prediction, rollback, lag compensation, Internet matchmaking, or dedicated
simulation server. Do not treat LAN latency or two local browser processes as proof
of Internet performance or competitive fairness.

The toolbar's **Ping** is the browser-to-LAN-server round trip, measured from
send time. The host usually connects through localhost, so its ping is expected
to be lower. This number does not include waiting for the host simulation and
the next visible snapshot. A persistent 160 ms guest ping still needs a real
two-computer check: compare idle versus fighting and wired versus Wi-Fi.

## Replacing the backend

Keep protocol DTOs and `DuelRuntime` independent of SDK bindings. Implement a new
`SessionTransport` adapter, inject it in `Game`, and run the session contract tests
against it. A Duel transport must preserve ordered delivery, binary frames and
queue feedback (or provide a compatible stream behind the adapter).

For SpacetimeDB, move room identities, roster/readiness and lifecycle authority
into tables/reducers. Map subscription updates and reducer results to the session
contract. Use an ordered binary stream for terrain and frequent presentation,
coordinated by room identity and epoch. Do not put each terrain cell into a row
merely to mimic the WebSocket stream. See `MULTIPLAYER-ARCHITECTURE.md` for the
existing separation between durable room data and ephemeral world streaming.

Replacing the transport does **not** make combat server-authoritative. To do that,
extract the host simulation from browser `Ctx` services into a headless runtime,
run it on a dedicated authority, and use replicas for both human clients. Keep the
same input/epoch/snapshot contracts, and add authentication, authorization,
deployment, latency handling and abuse controls before public Internet play.

## Verification

```powershell
npx vitest run tests/duel-input.test.ts tests/duel-room.test.ts tests/duel-session.test.ts tests/duel-terrain.test.ts tests/duel-server.test.ts tests/duel-snapshot.test.ts
npm run typecheck
npm test
npm run build
npm run dev:lan
# In another terminal; two independent browser processes:
npm run verify:duel-lan
# Optional: exercise the LAN HTTP origin and its browser restrictions:
node scripts/verify-duel-lan.mjs http://YOUR-LAN-IP:5180/
# Profile capture/receive costs and input-to-visible-movement in two browsers:
node scripts/verify-duel-latency.mjs
# Inject 80 ms each way (160 ms added round trip) at the guest transport:
node scripts/verify-duel-latency.mjs http://127.0.0.1:5180/ 80
```

The browser probe checks host/join, fighter ownership, remote movement and melee,
terrain creation/removal, shared pause, ring-outs/results, rematch, reconnect,
render-only guest behavior, and leaving the room. Screenshots/results go under
ignored `verify-out/duel-lan/`.

Verification on 2026-10-03: the full two-browser probe passed on localhost and
the host's LAN HTTP address, with no page errors. The existing local-versus
probe also passed controller ownership, rematch, disconnect, 390px layout,
saved-campaign isolation, and Continue. Typecheck, production build and lint
passed. The full suite passed 3,311 tests and timed out in one existing
parallel-simulation test; that file's five tests passed when rerun alone.
Additional regression checks cover creating a second room and suspending
editor traffic. Both browser processes ran on the same machine; a second
physical computer and Internet latency remain manual playtest checks.

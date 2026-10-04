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

At the end of every host tick (60 a second, counted in ticks: `DUEL_SNAPSHOT_TICKS`)
the host publishes a versioned binary frame holding JSON presentation state and a
packed terrain delta. Each frame has a match epoch, sequence, base sequence,
baseline marker, the host tick it ends, and `ack`: the newest guest input the host
had applied by then. The terrain and presentation apply atomically. Backpressure
(more than about six frames queued) skips a capture, preserving the last
successfully sent terrain as the comparison point; a failed send requires a fresh
baseline. Guests reject stale epochs, duplicates, and deltas with missing
predecessors. Baselines are sent on start/resume/resync. Reliable ordered delivery
does not need recurring full-world transfers during steady play.

Until 2026-10-04 the host published on a 33 ms wall-clock timer checked once per
tick. The timer beat against the 16.7 ms tick and landed on every second or third
tick, so the guest received 20-30 uneven frames a second (23 measured) while the
host drew 60 ticks smoothly. That beat, not the network, was most of the guest's
"lag".

Snapshots include both player poses and costumes, stock/attack/defense views,
fighter ability readouts, projectiles, particles, lights, camera and audio cues.
Existing kit effects use closure-owned drawing code, so a
compatibility adapter captures bounded world-space pixel commands for those
effects only (24,000 pixels per fighter per snapshot). These commands are cosmetic;
they never affect collision. Semantic kit visual data would reduce this bandwidth.

### Playback on the guest

The guest plays the host's ticks back on the host's clock, not as they arrive
(`net/duel/timeline.ts`). Arrivals bunch and gap with network jitter; the host's
ticks do not. `HostClock` keeps the best transit seen over the last two seconds
(`arrival - tick * 16.7 ms`, its minimum) and measures how late the other frames
run beyond it; a frame far later than that (a pause, a stall) restarts the
estimate. Two `PlaybackCursor` playheads read one buffer of frames, run at real
time, and steer toward their targets by up to 20% faster or slower (never backward,
never past the newest frame; a target far ahead is jumped to):

- **The world** (terrain, the opponent, camera, projectiles, particles, effects, the
  match and its moments) plays late enough that 98% of frames have arrived.
- **The controlled fighter** plays as early as 80% allows, so it responds first. Its
  slot's stock views (attack, shield, dodge...) and every sound follow this playhead.

Both interpolate positions (and the camera) between the two frames around their
playhead at display rate, as the host draws between its own last two ticks.
Respawns, large teleports and ring-outs snap. A presentation that passes more than
four frames at once (a hidden tab, a stall) applies every terrain delta in order but
plays only the last few frames' sounds; more than 240 buffered frames are applied
on receipt.

### Terrain capture

A capture compares only what can have changed, by the renderer's own contract
(`render/TerrainArt`): a type change, or a write to a steady cell (empty, wall,
stone, wood, metal), moves its 64x64 chunk's activity version; any other cell may
be rewritten in place by a simulation hot loop. So the capture diffs every chunk
whose version moved, every cell of a non-steady type, every charged or
colour-overridden cell, and a rolling sweep of six chunks per capture as the safety
net (the whole Foundry world in about 1.2 s). Before the activity grid is ready, or
after it is invalidated, it compares every cell. `tests/duel-terrain-tracked.test.ts`
replays a busy live simulation and asserts the replica is identical on every tick.
On the Foundry this compares about 38,000 cells per capture instead of 1.7 million
(0.35 ms instead of 6-7 ms), which is what makes a frame every tick affordable.

### Limits, and what comes next

There is no client prediction, rollback, lag compensation, Internet matchmaking, or
dedicated simulation server. The guest's own fighter still waits one full round
trip (its input to the host, the host's next tick, the snapshot back) before it
moves: about 20 ms more than the host on one machine, and the whole network round
trip on top over a real network (136 ms key-to-screen at an added 80 ms round
trip, against the host's 32 ms). That is acceptable on a LAN and not over the
Internet. The next step is **prediction of the controlled fighter** on the guest, built in the
CLASHFORGED repository after the split copy (`docs/arena/DECISIONS.md` D-023):
inputs stamped with the guest's own tick, the host acknowledging per tick (`ack`
is the start), the slot's complete simulation state restorable (`PlayerState`, the
controller's private timers, the stock modules, the kit's state), the guest
re-running its unacknowledged inputs through the real body code each frame, and
the replica's terrain protected from the predicted body's writes. The world
playback above stays as it is: the opponent and the world are always shown from
the authority. Do not treat LAN latency or two local browser processes as proof
of Internet performance or competitive fairness.

The toolbar shows the guest's **input round trip**: from sending an input to the
snapshot that includes it arriving (the host's tick included; display adds about
one more tick). The host shows its **ping** to the LAN server, measured from send
time; it usually connects through localhost.

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
npx vitest run tests/duel-input.test.ts tests/duel-room.test.ts tests/duel-session.test.ts tests/duel-terrain.test.ts tests/duel-terrain-tracked.test.ts tests/duel-timeline.test.ts tests/duel-presentation.test.ts tests/duel-server.test.ts tests/duel-snapshot.test.ts
npm run typecheck
npm test
npm run build
npm run dev:lan
# In another terminal; two independent browser processes:
npm run verify:duel-lan
# Optional: exercise the LAN HTTP origin and its browser restrictions:
node scripts/verify-duel-lan.mjs http://YOUR-LAN-IP:5180/
# The feel, in two browsers: publish rate and capture cost, arrival jitter, how evenly
# both fighters walk on the guest's screen, key-to-screen on guest AND host:
node scripts/verify-duel-latency.mjs
# Inject 40 ms each way at the guest transport (an ordered stream, like TCP):
node scripts/verify-duel-latency.mjs http://127.0.0.1:5180/ 40
# 15 ms each way plus 0-25 ms of jitter:
node scripts/verify-duel-latency.mjs http://127.0.0.1:5180/ 15 25
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

Verification on 2026-10-04 (the per-tick stream and guest playback), the latency
probe on one machine against an unmodified `main` server and the change:

| | main | per-tick + playback |
| --- | --- | --- |
| Host frames published per second | 23.1 | 60.2 |
| Host capture per frame | 6.7 ms | 0.35 ms |
| Guest arrival gap, median / p95 | 42.5 / 58 ms | 16.5 / 24.5 ms |
| Guest's own fighter: display frames held still while walking | 167 of 218 | 0 of 225 |
| Opponent on the guest: held frames while walking | 17 of 218 | 0 of 225 |
| Guest key-to-screen, median | 91 ms | 53 ms |
| Host key-to-screen, median | 30 ms | 33 ms |

With 40 ms injected each way the guest held 5 of 221 frames and answered keys in
136 ms; with 15 ms plus 0-25 ms of jitter, 4 of 224 and 119 ms; no baselines were
resent in steady play. The two-browser LAN probe passed (ownership, melee,
terrain, pause, ring-outs, rematch, reconnect, render-only guest), and the guest
heard exactly the host's sounds, announcer calls and match moments. Typecheck,
lint, the production build and the full suite (3,411 tests) passed. A second
physical computer remains a manual check: the guest's toolbar number is now the
whole input round trip, so it is the one to read.

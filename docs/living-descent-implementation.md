# Living Descent implementation and verification

Branch `feat/living-descent` is based on `db23199` in the isolated
`alchemists-descent-worktrees/living-descent` checkout. The existing `AGENTS.md`
and original checkout are preserved. This document records implementation and
acceptance separately; automated checks do not establish that the game is fun.

## What changed

The Breathing Works is an eight-room first expedition through an inhabited
alchemical refinery: intake, sluice, feeding gallery, ventilation chamber, refuge,
silt garden, undertow and lower gate. A brass bell opens the descent. Water,
nitrogen, oil, digging and casting are available immediately. The sluice offers
draining, freezing and ledge routes; physical glowseeds gather prey and distract
predators. A warm refuge restores health and lure stock after an uninterrupted
rest. The ventilation cycle consumes a finite water supply to produce real steam;
roofs, drainage and freezing change its consequences.

The entry offers Begin, Continue and Controls & comfort. Gameplay uses a corner
HUD, separate named flask slots, an object-local valve prompt, and direct Resume.
Comfort options include text scaling, key remapping, reduced flashes, camera
shake, high-readability lighting and creature-sound captions. Standard controller
mapping is implemented. Builder, Sandbox and the Developer Console remain in the
development build; production exposes no debug game handle.

## Implementation map

| Proposal item | Implemented | Acceptance boundary |
| --- | --- | --- |
| OVR-01 | Fixed 60 Hz clock, real presentation intervals, retained catch-up debt, reported exceptional drops; real durable-save probes | Hardware gates are measured separately below. |
| OVR-02 | Prefab generator checks normalize LF/CRLF without changing generated content | Covered by prefab tests in the full suite. |
| OVR-03 | Tick-owned poses, Verlet chains, contact constraints and pure sprite readers; interpolated body/camera translation | Rendering tests cover repeated draws; human motion review remains distinct. |
| OVR-04 | Faster coherent starting movement, queued short jump presses, input polling on every presentation frame | Browser keyboard/remapping/controller fixtures pass; physical controller and unfamiliar-player course still require people. |
| OVR-05 | Shared sight/hearing, last-known positions, needs, hysteresis, intent deadlines, bounded local navigation and committed attacks | Weaver/Rillback are the premium slice; Root Loper/Stone Maw use the new foundations. Legacy enemies remain compatible. |
| OVR-06 | Stable habitat residents, prey consumption/satiation, lures, finite populations and coarse distant decisions; ecology saved on departure | Save and recovery probes cover identity; no claim of an autonomous full-world ecology simulation. |
| OVR-07 | Original raster backgrounds, live-cell material atlas, valve/hearth/pipe assets, anatomical creature highlights and bounded spatial audio | Finish review and clips are recorded below; listening and three uncoached solutions remain human gates. |
| OVR-08 | Sparse 64-cell activity chunks, changed-cell frontiers, contact halos, mature flora, support caching and navigation invalidation | Mass/seam, wake, replay, support and Builder mutation regressions pass. |
| OVR-09 | Worker encoding and IndexedDB current/previous/manifest atomic commits, ordered requests, checksum recovery, legacy import/archive and visible errors | Frozen levels reuse encoded blobs; the active level still copies complete planes. This is not chunk-addressed incremental storage. |
| OVR-10 | Expedition-first entry, eight-room slice, refuge/upgrade/bell/gate handoff and integration with existing deeper generation | The normal-input route passes; unaided human completion, target expedition length and a fully reauthored campaign remain separate. |

## Engine policies and compatibility

The flat material grid remains authoritative. Cell IDs and marker palettes keep
their save contracts. Near-player materials run at 60 Hz; distant fluids and
growth run at a staggered 15 Hz, while heat, active reagents and electricity stay
urgent globally. Enclosed water and unlit oil leave the active frontier and wake
on contact changes; burning oil and neighboring charge remain active, including
across chunk seams. Generated established vegetation begins dormant; newly created growth
retains its vigor. Vine-body promotion follows the player rather than the camera.

`GEN_VERSION` is 38. The active frontier deliberately changes random-number draw
order; simulation goldens document that policy. Generation type goldens cover the
new first level. Saves preserve ecology and gameplay metadata; incompatible
expeditions are archived rather than silently discarded. Sandbox raw grids,
Builder documents and expedition checkpoints remain separate. Reachability
repairs route around protected gates instead of repeatedly trying to carve
through them. Their shell scan visits the repair boundary; it no longer examines
every neighborhood in the full world. Probes await actual repair completion.
Repair deadlines require completed material steps, so pausing or slow frames
cannot finish settlement early. Later checks account for distant powder falls;
counterweights are judged at their feed opening instead of inside a filled bowl.

WebGL samples terrain albedo from the atlas in its compositor. CPU fallback and
the experimental WebGPU path use a shared incremental color cache. Both preserve
excavated boundaries and saved color scars. A versioned dense scar mask avoids
rescanning every scar, and interpolated presentations reuse unchanged uploads.
GPU composition handles its own lower-world mask without filling a sprite strip.
Lighting uses cached material attenuation and bypasses emitter work for unlit
cells. Adjacent axial cell swaps mark their exact combined contact halo once.
Water reads only its immediate surface
neighbor, within the mutation halo. The viewport is 640×360 logical cells in a
1280×720 backing canvas. DOM layout scales with the window and text preference.

The clock distinguishes long suspension intervals from accumulated short stalls:
ordinary catch-up debt survives a burst of stalls, with a bounded one-second
overload queue and explicit loss reporting. Timing probes let final route-repair
debt drain before steady-state recording and retain starting/ending debt metrics.

## Reproducible verification

Use `npm run dev -- --host 127.0.0.1 --port 5182`, then run:

```powershell
npm run typecheck
npm test
npm run build
npm run lint
node scripts/verify-living-expedition.mjs http://127.0.0.1:5182/
node scripts/verify-living-controls.mjs http://127.0.0.1:5182/
node scripts/verify-living-recovery.mjs http://127.0.0.1:5182/
node scripts/verify-living-progression.mjs http://127.0.0.1:5182/
node scripts/verify-living-traversal.mjs http://127.0.0.1:5182/
node scripts/probe-compose-parity.mjs http://127.0.0.1:5182/
node scripts/verify-living-performance.mjs http://127.0.0.1:5182/ 60
node scripts/perf-scene.mjs living-descent http://127.0.0.1:5182/ 3 700
node scripts/verify-findability.mjs http://127.0.0.1:5182/
```

For the shipping UI, serve `npm run preview -- --host 127.0.0.1 --port 5183` and
run `node scripts/verify-living-production.mjs http://127.0.0.1:5183/`. It uses real
movement, autosave, reload and Continue without a debug handle. The motion probe
records actual canvas/audio output and inputs in explicitly positioned disposable
encounters. Technical evidence stays under ignored `verify-out/living-descent/`.
Browser probes archive screenshots into separate runs under the ignored root
`screenshots/living-descent/` folder, with a browsable `index.html` gallery. The
shared browser launcher preserves previous runs instead of overwriting them.
The traversal probe completes the first level from its actual spawn using normal
movement, jumping/levitation, a glowseed and the handwheel: sluice, gallery,
pressure shelters, refuge rest, garden bell, undertow, boon choice and arrival
in D2 alive. It makes no position, health, inventory or terrain changes. Its
authored steering is evidence of traversability, not an unfamiliar-player test.

The final full suite passes 97 files / 1,103 tests, including persistence,
simulation-owned settlement deadlines and filled counterweight reachability.
Production build/typecheck and lint pass. All eight CPU/GPU composition checks
pass, including material color, lenses, shockwaves, sprites, flicker, live tuning
and postprocessing. The shipping build passes movement, comfort controls,
autosave, reload and Continue with no debug handle. Corrupt-checkpoint recovery
and the full normal-input route also pass. The complete
campaign reachability audit passes four seeds × nine depths, with 154 prefabs
placed and no missing locks, machines or progression routes.

## Measurements and remaining gates

The final September 5 steady-state probe records two independent 60-second
windows after material settlement and route-repair debt have finished. It uses
headless Edge 153, WebGL2 through ANGLE/D3D11 on an RTX 3080 Ti, with a 1280×720
backing canvas. Build, test and other browser probes were not run concurrently.

| Measurement | D1 | D4 | Target |
| --- | ---: | ---: | ---: |
| Simulation ticks per second | 60.007 | 59.998 | ≥59, no accumulating debt |
| Discarded simulation time | 0 ms | 0 ms | 0 ms |
| Presentation interval p95 / p99 | 16.8 / 16.8 ms | 16.8 / 16.8 ms | ≤18 / ≤25 ms |
| Material work per tick p95 | 1.2 ms | 3.7 ms | ≤4 ms |
| Creature work per tick p95 | 0.1 ms | 0.4 ms | ≤2 ms |
| Other gameplay per tick p95 | 0.4 ms | 1.1 ms | ≤1.5 ms |
| Rendering preparation/submission p95 | 6.7 ms | 7.7 ms | ≤3 ms — unmet |
| UI work p95 | 0.3 ms | 0.3 ms | ≤0.5 ms |
| Total frame CPU work p95 | 7.9 ms | 12.1 ms | Reported separately from cadence |

The timing command therefore exits with a failed rendering-budget gate even
though both scenes meet cadence, simulation, material, creature, gameplay and UI
gates. CPU submission is not GPU execution time or a minimum-hardware guarantee.
The earlier baseline reported 87–109 ms foreground saves; the final three normal
checkpoints measured 2.1–2.3 ms foreground work and 11.5–19.6 ms through durable
completion. Raw measurements are in `verify-out/living-descent/performance-60s.json`.
Earlier short samples contaminated by external .NET builds are not acceptance
evidence, and the different logical viewport prevents an isolated engine-only
comparison with the old stress baseline.

The three-run chaos fixture records 2,110 presentations with repeated explosions,
interacting fluids and 38 initial enemies. Material work p95 is 2.3 ms, entity
work 1.2 ms, rendering 7.5 ms and total frame work 10.3 ms. Its existing 6 / 2.5 /
5 / 25 ms gates pass except rendering. All 15 normal-run checkpoints commit:
1.7–2.1 ms foreground and 9.0–12.9 ms durable. There are no runtime page errors.
The complete records, including each checkpoint revision, are retained in
`verify-out/perf-living-descent.json`; screenshots are in the shared gallery.

Campaign generation/restore and the first activity classification still perform
synchronous work. Incremental chunk storage, any beneficial simulation-worker
migration, cross-hardware acceptance, physical controller testing, audio listening,
five unfamiliar players and three uncoached approaches remain explicit gates.
Deeper legacy rooms have not received the first slice's full encounter/art pass.

## Visual direction and review

The user approved The Living Descent and delegated creative implementation.
Impeccable seed `19469569` and the original direction contract are preserved;
generated studies guide material/composition and were not personally selected by
the user or presented as shipped gameplay. Asset prompts, decoded audits and
conversion provenance are in [the asset manifest](living-descent-asset-manifest.md).

The first finish review requested a live-art rebuild. The next verdict was `fix`:
assets and Resume were present, with five remaining issues covering material
variation/water bands, bright hit frames, valve anchoring, flask overlap and
caption wrapping. The second batch resolves all five. The independent final
verdict is `ship` for those visual repairs, recorded in
`verify-out/living-descent/finish-review-round2.md`. It does not establish audio
listening, uninterrupted motion quality, human enjoyment or performance. Root
`DESIGN.md` records the implemented visual system separately from the gameplay
architecture in `docs/DESIGN.md`.

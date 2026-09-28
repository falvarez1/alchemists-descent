# Living Descent: fidelity and physical response

This second implementation pass continues on `feat/living-descent` in the isolated
`alchemists-descent-worktrees/living-descent` checkout. The first-pass evidence in
[living-descent-implementation.md](living-descent-implementation.md) remains dated
evidence, not a substitute for the results of this pass.

The optional [Trickshot combat experiment](trickshot-combat.md) adds configurable
combo slow motion, first-contact aiming and an owner-specific Weaver finish.
The same follow-up replaces the player's death rig and death screen.

## What changes in play

- The camera still covers 640 × 360 world cells. The default WebGL presentation
  draws at 1280 × 720: half-cell terrain bevels, grain, creature anatomy and foliage
  increase detail without shrinking the player or zooming out. Material IDs,
  collision dimensions and the authoritative 1600 × 1064 grid remain compatible.
- All 16 creatures have native anatomical art and tick-owned expression. Gaze,
  lids, jaws, breathing, damage and intent are distinct states. Rillbacks feed on
  existing fish; Root Lopers commit to a dodgable lash. Optional spell shelves
  give the intake and later detours an immediate reward.
- Weaver leg roots live inside the thorax and share one continuous joint chain
  between drawing and projectile contact. Fourteen accumulated limb damage severs
  a leg; remaining legs change gait and support. Walk over the dropped limb to
  collect it, then use **LMB** or the mapped melee key (default **F**) to swing. The gripped
  shank drives a loose thigh at its knee; both keep fixed lengths, respond to
  walking/jumping/braking, and sweep physical melee contact. A connected
  strike deals 24 damage, makes the Weaver recoil, and consumes one of six uses.
  Walls block the swing. Missing legs and carried durability survive saves.
  Projectile cover lookup now floors fractional coordinates before indexing the
  grid; otherwise clear air could incorrectly suppress visible leg contact.
- Grounded gravity velocity no longer drives camera look-ahead. Composed texture
  origin and displayed fractional offset use the same interpolated camera pose.
- Curved and diagonal vines form connected swaying strands, including roots just
  above the view. Thin chains use roughly one physical joint per three cells;
  leaves stay on those joints. Walking, kick gusts and blasts move them; shots and
  digging sever their actual geometry. Unsupported sections fall and remain where
  they land. Save copies include material held by strands without resetting their
  live animation or restoring a cut section to the ceiling.
- Bushes bend through a continuous contact force and a damped spring. Their
  crowns rotate and recover instead of stretching and flipping sides when crossed.
  The sluice handwheel turns clockwise to open and reverses to close.
- Water transmits pressure through connected liquid spans, has swept faster free
  fall, and produces a coarse current shared by blood, fish, Rillbacks and the
  submerged player. Blood moves through water and gradually disperses. Rillback
  segments sample their own immersion: an exposed tail falls under gravity while
  submerged segments swim, and ordinary pursuit turns back from the surface.

## Hydraulic model and boundaries

`FluidFlow` performs bounded scanline pressure relaxation. A submerged outlet
borrows one cell from a connected free surface and transfers it with `world.swap`.
The horizontal liquid path and vertical donor column must be connected; solid
dividers are not traversed. Cached column surfaces avoid repeatedly walking each
column, and an 8-cell flux field stores motion for suspended material and bodies.
The flux field does not replace terrain or create water. Tests check combined
water/blood conservation, sealed walls, drainage, transport and body response.

Airborne water now has a sparse, bounded momentum record (at most 4,096 cells).
It carries sideways motion off a ledge, accelerates under gravity and sweeps its
path against the existing grid, preserving color, life, charge and liquid mass.
Supported water receives the pool surface highlight; airborne cells receive short
fine strokes along their actual previous-to-current path. The strokes add no
water and disappear on the next step. Reactions, replacement, landing and world
changes retire flight records. Pools allocate no second per-cell velocity plane.
Flight momentum is transient and resets on a loaded world.

This is a game-oriented incompressible approximation. It does not solve the full
Navier–Stokes equations, continuous fractional liquid volume, or arbitrary siphons.
Pressure searches are bounded to 384 horizontal and 192 vertical cells. Solid
sills and closed outlets can still retain water or catch a creature.

In the same disposable D1 seed-777 scene, the old sluice drained **6.8%** in ten
seconds and a 21-cell submerged blood tracer remained at exactly `(717, 391)`.
The pressure revision drained approximately **84%**; the later momentum correction
retains **82.7%** drainage in the same probe. Blood moved toward the outlet
and dispersed. The probe positions the player, enables god mode and explicitly
injects only the blood tracer into existing water. Opening and closing use actual
**E** input. This evidence is not an unassisted playthrough.

The idle-camera probe measured about **0.20 cells** of oscillation before the fix,
despite zero player-position drift. After settling, both stone and timber fixtures
report **zero camera and target drift**, with one texture origin throughout.

## Performance method

`scripts/verify-fidelity-performance.mjs` runs seed-777 D1, D4, a positioned Weaver
gallery, and an opening-sluice workload. Compare `?pixelScale=1` with the default
fine presentation serially, on the same machine, with no source edits, GIF encoding
or competing probes during timing. Gallery and sluice fixtures use extra health;
console positioning also enables the debug safety state. Both are observation
fixtures, not survival benchmarks. The profiler runs after each timing
window so its overhead is excluded. Frame/compose times are CPU wall measurements;
they are not GPU execution timestamps.

The implementation removes redundant stationary-camera world packing, merges
dirty upload rows into a contiguous buffer, narrows oval rasterization to actual
scanlines, and simplifies the finite-positive lighting maximum operation without
changing the lighting result. The prior light microbenchmark found zero output
error; speedups varied by run. Full-scene measurements determine the useful gain.

Final serial measurements on 2026-09-05 use headless Edge 153 on Windows with an
NVIDIA RTX 3080 Ti through ANGLE/D3D11. Each main scene runs for 60 seconds after
warm-up. The source is unchanged between variants. Times below are milliseconds
at the 95th percentile; these single-machine windows are not cross-hardware guarantees.

| Scene | Classic frame | Fine frame | Fine composition | Fine simulation tick |
| --- | ---: | ---: | ---: | ---: |
| D1 Intake | 7.8 | 9.4 | 6.1 | 1.8 |
| D4 | 11.0 | 12.5 | 7.2 | 2.8 |
| Weaver gallery | 10.6 | 11.0 | 8.1 | 1.6 |

All six windows maintain approximately **60 simulation ticks/second**, with
**zero discarded simulation time**. Fine detail costs 0.4–1.6ms more per frame
than classic detail in these runs. Before the last waterfall/hinged-leg changes,
fine-frame p95 was 9.1/12.3/11.5ms: the current results are +0.3/+0.2/−0.5ms.
The main scenes do not equip a carried weapon; the native whip capture and
contact/constraint regressions establish its behavior separately.

The separate 30-second open-sluice workload records 10.2ms frame / 5.8ms compose /
2.6ms simulation p95 and 60.02Hz, with no discarded time. Its earlier frame p95
was 9.8ms. The later ballistic flow retains the fast drainage at this measured cost.

With Trickshot enabled for 60 seconds, Intake/gallery frame p95 is **9.3/11.9ms**
versus **9.4/11.0ms** with it off. Both maintain 60Hz with no discarded time;
composition is 6.1/8.5ms and simulation is 1.7/1.8ms. These measure the enabled
preview during ordinary live scenes, not an active slow-motion chain. The earlier
30-second Intake outlier of 22.6ms did not recur; this does not establish its cause
or prove a separate optimization. Actual chain slowdown/recovery is covered by
the real-shot probe, independently of this timing comparison.

The earlier aspirational 3ms rendering and 5ms stress budgets are **not met**.
These measurements demonstrate retained cadence on the tested machine, with a
measurable CPU cost for finer presentation. They do not establish GPU execution
time or a general hardware minimum. Raw current reports use the `shipped-*`
prefix under `verify-out/living-descent/`; `final-*` are the earlier comparison.

## GPU options considered

[WebGPU](https://developer.chrome.com/docs/web-platform/webgpu/overview) exposes
graphics and compute work to browsers. Native Vulkan is not a JavaScript browser
API; WebGPU implementations map to native backends such as Vulkan, D3D12 and Metal.
The experimental WebGPU composition path was attempted separately at classic
detail. On this machine it produced an invalid command-buffer error and reported
`webgpu.compose.bridge = "failed"`, despite an active presentation backend and no
JavaScript page errors. Its partly blank frames invalidate the timing comparison:
these are failed qualification results, not a WebGPU speedup. The benchmark now
rejects that state explicitly. WebGL2 remains the shipped default; WebGPU retains
CPU lighting and has not established production parity with fine presentation.

A full GPU material simulation needs deterministic conflict resolution, reactions,
collision queries, save snapshots and bounded readback, as well as dispatch speed.
The [GPU cellular-water experiment](https://github.com/luciopaiva/water) documents
the neighbor-write and scheduling problem; [the Columbia implementation report](https://www.cs.columbia.edu/~sedwards/classes/2019/4995-fall/reports/cellular-fluid.pdf)
explores parallel cellular fluid updates. These informed the investigation, not a
claim that GPU execution automatically improves this game's measured bottleneck.
The shipped hydraulic change operates on the existing CPU material contract.

## Validation of the combined source

- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass.
  Vitest reports **105 files / 1,145 tests**. The ten Weaver tests include
  fixed segment lengths, momentum recovery, jumping/reversal, teleport reset,
  harmless wind-up, cover, actual ceiling-body contact and owner-only finishing.
  `npm run verify:tuning-ranges` confirms both generated targets are current.
- The native carrying probe records 306 frames and a real landed whip strike,
  reducing durability from six to five and owner HP from 117.5 to 93.5. The
  separate final finisher records actual severing, collection and five connected
  swings, then removal of the original owner with **RETURNED WITH INTEREST**.
  It starts with console positioning and extra health, with god mode disabled.
  Its controller supports later contact positioning, but this successful run
  needed none. These are disclosed encounters, not discovery or traversal proof.
- Shipping UI verification passes Begin, movement, glowseed use, autosave,
  Continue and persisted Trickshot settings. It uses the production bundle with
  no development game handle. The gallery passes desktop, compact, offline,
  all 16 GIF links and video loading.
- CPU/WebGL2 composition parity at classic presentation passes **8/8** checks,
  including lensing, shockwaves, flicker, tuning and postprocessing. This does
  not qualify experimental WebGPU or establish cross-device performance.
- Reachability is clean for seeds **1, 5, 1337 and 42** across all nine depths.
  Seed 1's completed block predates the held-leg correction at the same generation
  version; the final remaining-seed audit places 116 prefabs with no missing
  locks, spell labs or machines. `GEN_VERSION` is 39, with updated generation
  expectations for the deliberate habitat additions.

## Captures and reproduction

Open `screenshots/index.html` in this worktree, or visit
`http://localhost:5182/screenshots/index.html`. The standalone gallery has latest
captures, all historical runs, 16 creature pose GIFs, gameplay clips, search,
filtering, ordering, keyboard navigation and a focused media viewer. It works from
disk without a server. `screenshots/` and raw `verify-out/` evidence are Git-ignored.

The GIF catalog lists included poses. Weaver has 17 poses, including lost limbs
and limping. These are native pose fixtures, distinct from encounter videos;
GIF palette quantization does not affect runtime art.

Key probes: `verify-weaver-salvage.mjs`, `verify-idle-camera.mjs`,
`verify-living-vines.mjs`, `verify-fluid-life.mjs`, `verify-frond-motion.mjs`,
`verify-waterfall.mjs`,
`verify-living-traversal.mjs`, `verify-living-production.mjs`,
`verify-screenshot-gallery.mjs`, and `verify-fidelity-performance.mjs`.

Automated behavior and visual checks do not establish fun, a numerical quality
rating, human listening quality or acceptance on untested hardware.

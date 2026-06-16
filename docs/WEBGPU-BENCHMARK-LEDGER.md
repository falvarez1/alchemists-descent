# WebGPU Benchmark Ledger

This ledger is the durable record for `docs/WEBGPU-TSL-COMPUTE-IMPLEMENTATION-PLAN.md`.
Raw benchmark JSON, screenshots, and clips may live under `verify-out/`, but
the decision record for each task belongs here.

Every task must produce a positive quantitative or qualitative result:

1. Record the baseline before changing behavior.
2. Declare the expected result before implementation.
3. Record after results with the same scene, seed, browser, resolution, and
   measurement method.
4. Attach qualitative evidence for visual tasks: screenshots, parity diffs,
   short clips, or probe images.
5. If after is worse, attempt one focused fix.
6. If the focused fix still misses the gate, roll the task back and record it
   as attempted but failed.

## Standard Result Block

```text
Task:
Commit:
Hardware/browser:
Requested backend:
Actual backend:
Scene / seed / resolution:
Command:
Baseline:
After:
Expected result:
Actual result:
Visual/quality evidence:
Decision: keep | fixed and kept | rolled back | attempted and failed
Notes:
```

## Phase 0 Baseline - GPU Compose Flag

Task: Establish same-session A/B baseline for the current WebGL2 frame
composition path with `postFx.gpuCompose` off and on.

Expected result: the harness reports `sim`, `entities`, `compose`, `gl`,
`render`, and `frame` means, p95s, and sample counts without changing normal
game behavior.

Command:

```powershell
npm run perf:ab -- postFx.gpuCompose false true http://127.0.0.1:5187/ 360 4 chaos
```

Result status: recorded 2026-06-15.

| Date | Commit | Browser | GPU / Driver | Requested Backend | Actual Backend | Scene | Control | Variant | Compose Mean | GL Mean | Render Mean | Frame Mean | Decision |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|
| 2026-06-15 | `aa2d5a4` | Headless Edge 150.0.0.0 | ANGLE / NVIDIA GeForce RTX 3080 Ti / D3D11 | current | WebGL2 | chaos / seed 777 / 1050x714 / 4x360 frames | `postFx.gpuCompose=false` | `postFx.gpuCompose=true` | 21.007 -> 3.261 ms (-84.5%) | 0.686 -> 0.746 ms (+8.7%) | 21.751 -> 4.060 ms (-81.3%) | 24.955 -> 7.265 ms (-70.9%) | Keep current GPU compose baseline |

Details:

- Raw artifact: `verify-out/perf-ab-postfx.gpucompose-chaos-1781502236136.json`
- Method: same browser session with per-measurement deterministic scene rebuild.
  Block order was `control -> variant`, `variant -> control`,
  `control -> variant`, `variant -> control`.
- Setup counts for every measured block: particles `84`, projectiles `0`,
  enemies `14`, authored lights `0`, shockwaves `0`.
- Benchmark scene setup explicitly rewrites `types`, `colors`, `life`, and
  `charge` for every placed terrain cell before each measured block.
- WebGPU capability probe: `navigator.gpu=true`, secure context `true`,
  adapter available `true`, optional features observed include
  `timestamp-query`, `shader-f16`, `bgra8unorm-storage`,
  `float32-filterable`, and `float32-blendable`.
- Timestamp status: adapter feature available `true`, benchmark device feature
  enabled `false`, GPU timestamp measurements `not-captured`; timings are
  CPU PerfHud bucket measurements.
- Key observed adapter limits: `maxTextureDimension2D=16384`,
  `maxBindGroups=4`, `maxBindingsPerBindGroup=1000`,
  `maxStorageBuffersPerShaderStage=16`, `maxStorageTexturesPerShaderStage=8`,
  `maxUniformBufferBindingSize=65536`,
  `maxStorageBufferBindingSize=2147483644`, `maxBufferSize=2147483648`,
  `maxComputeWorkgroupStorageSize=32768`,
  `maxComputeInvocationsPerWorkgroup=1024`,
  `maxComputeWorkgroupSizeX=1024`, `maxComputeWorkgroupSizeY=1024`,
  `maxComputeWorkgroupSizeZ=64`,
  `maxComputeWorkgroupsPerDimension=65535`.
- Sample counts: control `n=1451`, variant `n=1455`.
- P95 results: compose `29.300 -> 5.800 ms`, gl `1.100 -> 1.100 ms`,
  render `30.400 -> 7.000 ms`, frame `34.500 -> 10.600 ms`.
- Secondary buckets: sim `3.014 -> 3.040 ms` (+0.9%, not significant),
  entities `0.179 -> 0.151 ms` (-15.7%). Future compose work should keep
  tracking sim and entities so render optimizations do not hide simulation
  regressions.
- Visual/quality evidence: not captured for this baseline-only task.
  Subsequent visual tasks must add screenshots, diffs, or clips.
- Decision: keep. The harness produced the required buckets and the current
  WebGL2 GPU compose path remains the performance reference.

## Entries

Add new task entries below this line. Keep the raw `verify-out/` path in Notes
when a local JSON/screenshot artifact informed the decision.

## Phase 1 - Three r184 API Pin Audit And Spike

Task: prove the pinned `three` `0.184.0` / `@types/three` `0.184.1` WebGPU,
TSL, RenderPipeline, renderer-level storage-buffer readback, and WGSL helper
APIs before production renderer work.

Commit: `aa2d5a4`

Hardware/browser: Headless Edge 150.0.0.0. Adapter info was not exposed, but
WebGPU limits/features were recorded by the probe.

Requested backend: WebGPU through `WebGPURenderer` with `forceWebGL=false`.

Actual backend: `WebGPUBackend`, canvas marker `three.js r184 webgpu`,
compatibility mode `false`.

Scene / seed / resolution: isolated probe page, `96x64` WebGPU canvas rendered
as a `384x256` screenshot.

Command:

```powershell
npm run probe:webgpu-r184
```

Baseline: current dependency pins and current production WebGL2 renderer path.
The Phase 1 probe is isolated from the game runtime. The shared checkout also
contains unrelated dirty runtime files; raw artifacts record `git.dirty` and
`git.status` so this provenance is explicit.

After: static exports, actual WebGPU initialization, RenderPipeline/TSL output
with explicit `renderOutput(...)`, renderer-level storage-buffer readback, TSL
compute, and a WGSL-backed TSL helper all passed on the pinned r184
dependencies. `StorageTexture`, `storage`, and `pass` are export-verified only
and require their own runtime probes before production use.

Expected result: no dependency churn, no game visual change, nonblank
RenderPipeline output, and compute readback matching the expected values.

Actual result: screenshot pixel stats were `384x256`, `100%` nonblack pixels,
average RGB `183.318`, max channel `227`; compute expected `[1, 3, 5, 7]` and
read back `[1, 3, 5, 7]` through `renderer.getArrayBufferAsync`. The unchanged
WebGL2 compose path remained inside the Phase 0 performance shape: compose
`19.683 -> 3.744 ms` (-81.0%), render `20.384 -> 4.872 ms` (-76.1%), frame
`23.275 -> 8.520 ms` (-63.4%).

Visual/quality evidence:
`verify-out/webgpu-r184-spike/render-pipeline-1781504516218.png`.

Decision: keep.

Notes:

- Raw artifact: `verify-out/webgpu-r184-spike/probe-1781504516218.json`
- Perf artifact: `verify-out/perf-ab-postfx.gpucompose-chaos-1781504567412.json`
- Focused migration note: `docs/WEBGPU-THREE-R184-SPIKE.md`
- No Three dependency upgrade was needed.
- Phase 1 ran in a shared dirty worktree; the raw artifacts include `git.dirty`
  and full `git.status` metadata rather than pretending the commit SHA alone
  identifies the exact checkout.
- Browser-side `drawImage(webgpuCanvas)` returned black pixels in headless Edge;
  the automated nonblank check uses the saved PNG screenshot instead.
- Phase 1 failure blockers for future reruns: non-WebGPU actual backend, blank
  RenderPipeline screenshot, compute readback mismatch, missing raw artifact,
  or WebGL2 fallback/compose parity slowdown outside normal drift.
- Validation passed: `npm run probe:webgpu-r184`, `npm run typecheck`,
  `npm test`, `npm run lint`, `npm run build`, `node scripts/verify-game.mjs`,
  and `node scripts/probe-compose-parity.mjs`.

## Phase 2 - Renderer Backend Boundary

Task: add the renderer backend boundary, `render.*` feature flags, backend
selection/status reporting, and device-loss lifecycle plumbing while keeping the
shipping WebGL2 renderer behavior unchanged.

Commit: `aa2d5a4`

Hardware/browser: Headless Edge 150.0.0.0 on ANGLE / NVIDIA GeForce RTX 3080 Ti
/ D3D11.

Requested backend: default `render.backend=webgl`; probe also toggled
`render.backend=auto` and `render.backend=webgpu`.

Actual backend: `WebGLRenderBackend`, actual canvas backend `webgl2`.

Scene / seed / resolution: chaos / seed 777 / `1050x714` / 4x360 frames for
the performance gate; live game probe at the same canvas size for selection.

Command:

```powershell
npm run probe:render-backend
npm run perf:ab -- postFx.gpuCompose false true http://127.0.0.1:5173/ 360 4 chaos
```

Baseline: Phase 1 unchanged WebGL2 path, where GPU compose A/B measured
compose `19.683 -> 3.744 ms`, render `20.384 -> 4.872 ms`, and frame
`23.275 -> 8.520 ms`.

After: Phase 2 same-session A/B measured compose `19.135 -> 3.417 ms`
(-82.1%), render `19.769 -> 4.278 ms` (-78.4%), and frame `22.538 -> 7.728 ms`
(-65.7%). P95s were compose `22.400 -> 6.800 ms`, render `23.200 -> 8.100 ms`,
and frame `26.200 -> 12.800 ms`. `gl` rose `0.584 -> 0.807 ms`, but the total
render/frame win remained well inside the established GPU-compose performance
shape. A direct backend-flag A/B also compared `render.backend=webgl` to
`render.backend=auto` with the same scene and measured compose `3.105 -> 3.002`
ms (-3.3%, not significant), render `3.863 -> 3.679 ms` (-4.7%), and frame
`7.054 -> 6.726 ms` (-4.7%). P95s were compose `5.500 -> 5.200 ms`, render
`6.700 -> 6.100 ms`, and frame `10.200 -> 9.400 ms`.

Expected result: no visual change, deterministic backend status for tests and
A/B runs, WebGL fallback preserved, and no measurable renderer/frame regression
outside normal drift.

Actual result: keep after focused review fix. The backend-selection matrix covered `navigator.gpu`
absent, insecure context, no adapter, device init failure, explicit
`forceWebGL`, WebGPU disabled by user flag, WebGPU lost, WebGPU recovered,
backend missing, and WebGPU available. The live game probe verified
`render.backend=auto` and `render.backend=webgpu` both report actual WebGL2
fallback while the WebGPU backend is not implemented. The simulated WebGPU
device-loss probe called `device.destroy()`, observed the explicit lost state
with loss reason `destroyed`, and recovered through a fresh adapter with
generation `2` and `lostCount=1`. A reviewer found that the first recovery
helper could fall back to a cached adapter when fresh adapter recovery failed;
that path was fixed and covered by unit tests before Phase 2 was accepted.

Visual/quality evidence: existing WebGL2 compose parity passed 8/8 after the
boundary change. The live backend probe kept the same `Ctx`, `World`, renderer
canvas, direct `#canvas-holder` canvas count, and finite input mouse state while
toggling render flags.

Decision: keep.

Notes:

- Fixed backend artifact:
  `verify-out/render-backend-selection/probe-1781507095894.json`
- Original backend artifact before the reviewer recovery fix:
  `verify-out/render-backend-selection/probe-1781506084667.json`
- Raw perf artifact:
  `verify-out/perf-ab-postfx.gpucompose-chaos-1781506228534.json`
- Direct backend-flag perf artifact:
  `verify-out/perf-ab-render.backend-chaos-1781507172915.json`
- Validation passed: `node --check scripts/probe-render-backend-selection.mjs`,
  `node --check scripts/probe-render-backend-browser.js`,
  `node --check scripts/perf-ab-feature.mjs`, `npm run typecheck`,
  `npx vitest run tests/webgpu-device-lifecycle.test.ts tests/console.test.ts`,
  `npm run lint`,
  `npm run probe:render-backend`, `npm run perf:ab -- postFx.gpuCompose false
  true http://127.0.0.1:5173/ 360 4 chaos`, `npm run perf:ab -- render.backend
  webgl auto http://127.0.0.1:5173/ 360 4 chaos`, `npm test`, `npm run build`,
  `node scripts/probe-compose-parity.mjs http://127.0.0.1:5173/`, and
  `node scripts/verify-game.mjs http://127.0.0.1:5173/`.
- The first compose-parity attempt hit `window.__game` before the existing dev
  server finished exposing the debug handle; the immediate rerun passed all
  assertions.
- The raw artifacts disclose the shared dirty checkout through `git.dirty` and
  full `git.status` metadata.

## Phase 3 - WebGPU Presentation Shell

Task: add a boot-gated `WebGPURenderer` presentation backend with a TSL
`RenderPipeline` post chain while keeping the existing WebGL renderer as the
default fallback.

Commit: `f0859d8` plus working-tree fixes for WebGPU init fallback,
independent bloom/lens controls, and rollback of the failed widened-bloom
tuning.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for Phases 0-2.

Requested backend: probe boots both `renderBackend=webgl` and
`renderBackend=webgpu`.

Actual backend: WebGL variants report `WebGLRenderBackend` / WebGL2; WebGPU
variants report `WebGPURenderBackend` / actual WebGPU.

Scene / seed / resolution: deterministic Phase 3 fixed presentation scene,
`1050x714` renderer canvas, screenshots captured at `898x611` CSS pixels.

Command:

```powershell
npm run probe:webgpu-presentation
```

Baseline: Phase 2 default WebGL renderer. The Phase 3 probe compares WebGL and
WebGPU in the same script with the same deterministic scene and records post
off/on screenshots plus PerfHud `gl` samples.

After: WebGPU boot rendered nonblank pixels, reported actual WebGPU, preserved
one direct `#canvas-holder` canvas, kept finite mouse input state, and executed
the TSL post chain. The kept probe artifact is
`verify-out/webgpu-presentation/probe-1781510673320.json`.

Expected result: actual WebGPU presentation, expected canvas size, stable input
ownership, explicit output-transform contract, and no default post-on
presentation regression large enough to block a boot-gated shell.

Actual result: keep boot-gated with warnings. Post-off screenshot parity
improved after the UV-flip fix to mean channel delta `3.404` with `18.10%`
differing pixels. Post-on mean channel delta was `12.367`; the difference is
documented as the Phase 3 single-pass TSL bloom approximation. WebGPU post-on
`gl` measured `0.665 ms` versus WebGL `0.637 ms` (+4.3%). WebGPU post-off
measured `0.600 ms` versus WebGL `0.451 ms` (+33.0%), so the no-post path
remains a warning and the backend stays explicit/boot-gated rather than
default. The probe also verified `postFx.bloomEnabled=true` remains active when
`postFx.lensEnabled=false` and simulated WebGPU init failure falls back to
WebGL2 on the same canvas with finite input state.

Visual/quality evidence:

- `verify-out/webgpu-presentation/webgl-post-off-1781510673320.png`
- `verify-out/webgpu-presentation/webgpu-post-off-1781510673320.png`
- `verify-out/webgpu-presentation/webgl-post-on-1781510673320.png`
- `verify-out/webgpu-presentation/webgpu-post-on-1781510673320.png`
- `verify-out/webgpu-presentation/webgpu-bloom-on-lens-off-1781510673320.png`
- `verify-out/webgpu-presentation/webgpu-init-fallback-1781510673320.png`

Decision: keep boot-gated. Do not make WebGPU presentation default from this
phase alone. A wider TSL bloom kernel was attempted and rolled back because it
did not materially improve visual parity and worsened the `gl` bucket.

Notes:

- Output contract: `docs/WEBGPU-PRESENTATION-CONTRACT.md`.
- `renderBackend=auto` remains on WebGL during Phase 3; WebGPU is entered only
  through an explicit boot-time request.
- Validation passed: `node --check scripts/probe-webgpu-presentation.mjs`,
  `npm run typecheck`, `npm run lint`, and
  `npm run probe:webgpu-presentation`.
- The passing probe artifact records a dirty checkout because the external
  `f0859d8` checkpoint preceded the local post-review fixes.

## Phase 4.1 - WebGPU Compose ABI And Limit Contract

Task: add the WebGPU compose ABI/limit contract before porting the WebGL2
`GpuCompose` shader, and expose compose-relevant WebGPU feature/limit reporting
through the backend status payload.

Commit: `5a0f324` plus working-tree Phase 4.1 docs/status changes.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for prior WebGPU phases.

Requested backend: `renderBackend=webgpu` through the Phase 3 presentation
probe; `renderBackend=webgl` remains the fallback/reference path.

Actual backend: WebGPU variants report `WebGPURenderBackend` / actual WebGPU;
WebGL variants report `WebGLRenderBackend` / WebGL2.

Scene / seed / resolution: deterministic Phase 3 presentation scene, seed
`777`, `1050x714` renderer canvas. This task is contract/capability plumbing;
it intentionally does not enable WebGPU compose.

Command:

```powershell
npm run probe:webgpu-presentation
npm run probe:render-backend
node scripts/probe-compose-parity.mjs http://127.0.0.1:5204/
```

Baseline: Phase 3 status payload did not expose the device features or limits
needed to decide whether a WebGPU compose resource layout is valid. The WebGL2
compose reference was already green and remains the performance target.

After: `docs/WEBGPU-COMPOSE-ABI.md` records the world-window, light-field,
LUT, overlay, backdrop, logical bind-group, uniform, row-pitch/alignment,
endian, coordinate, packing, and fallback ABI. WebGPU backend status now
reports selected active-device features, selected active-device limits, and
`timestamp-query` availability. The presentation probe now hard-asserts the
Phase 4.1 compose capability gate in artifact
`verify-out/webgpu-presentation/probe-1781526289455.json`.

Expected result: no visual or performance behavior change yet; the positive
result is a concrete ABI/limit gate that prevents the Phase 4 shader port from
silently changing resource formats, coordinate orientation, overlay semantics,
or device requirements.

Actual result: keep. The probed WebGPU device reports `timestamp-query`
available and the capability gate passed with limits that satisfy the Phase 4.1
contract for the preferred `textureLoad` layout: `maxTextureDimension2D=8192`,
`maxSampledTexturesPerShaderStage=16`, `maxSamplersPerShaderStage=16`,
`maxUniformBufferBindingSize=65536`,
`maxStorageBufferBindingSize=134217728`, and `maxBufferSize=268435456`.
The hard gate now requires the current largest backdrop dimension
(`maxTextureDimension2D >= 2172`) and padded overlay staging size
(`maxBufferSize >= 1553664`). The existing CPU/WebGL2 compose parity probe
stayed green.

Performance result: no WebGPU speedup is claimed for this slice. The latest
passing presentation probe still leaves compose on the CPU path; WebGPU only
presents the already-composed frame. In that run the post-on `gl` bucket was
roughly comparable to WebGL2 (`0.478ms` WebGL2 vs `0.493ms` WebGPU, `+3.1%`),
while the no-post diagnostic bucket was slower (`0.363ms` WebGL2 vs `0.460ms`
WebGPU, `+27.0%`) and remains a warning. Real improvement is expected only
after a Phase 4 compose shader moves substantial frame work onto WebGPU.

Visual/quality evidence: no new visual path was enabled. Reference parity
evidence is the existing `npm run probe:compose-parity` result: static scene
`99.999%` exact, max delta `1`, postFx-on chain max delta `1`, and all 8
assertions green.

Decision: keep. Proceed to a WebGPU compose shader spike only after preserving
this ABI, keeping the capability gate green, and adding a CPU/WebGL2/WebGPU
parity variant.

Notes:

- ABI contract: `docs/WEBGPU-COMPOSE-ABI.md`.
- Presentation artifact with WebGPU limits and hard compose gate:
  `verify-out/webgpu-presentation/probe-1781526289455.json`.
- Backend artifact:
  `verify-out/render-backend-selection/probe-1781525980797.json`.
- Validation passed: `node --check scripts/probe-webgpu-presentation.mjs`,
  targeted ESLint for `src/render/Renderer.ts`,
  `src/render/WebGpuRenderBackend.ts`, `src/render/pixels.ts`, and
  `scripts/probe-webgpu-presentation.mjs`, `npm run typecheck`,
  `npm run lint`, `npm run build`, `npm run probe:render-backend`,
  `npm run probe:webgpu-presentation`, and a fresh
  `node scripts/probe-compose-parity.mjs http://127.0.0.1:5204/` run against a
  temporary Vite server.
- Current full-suite status: `npm test` is not green in the shared dirty
  worktree. It reports `39` passing test files, `508` passing tests, and one
  unrelated failure in `tests/virtual-world.test.ts`: `No herringbone tile for
  orientation 'vertical'`.
- At the time of the Phase 4.1 probe, the shared worktree also contained an
  unrelated `src/render/ComposeShader.ts` hunk that changed backdrop sample
  quantization. It was not part of the Phase 4.1 slice. Because
  `postFx.gpuCompose` is the WebGL2 reference path, Phase 4.2 rechecked and
  accepted the current compose reference before adding the WebGPU API canary.

## Phase 4.2 - WebGPU Compose API Canary

Task: prove the pinned Three/WebGPU stack can use the two API primitives needed
for the first WebGPU compose port before production renderer code changes:
TSL `textureLoad` into a WebGPU render target and raw WGSL compute on the active
Three `GPUDevice`.

Commit: `76e0a5e` plus working-tree Phase 4.2 canary/docs changes. The checkout
was dirty from unrelated gameplay and virtual-world files during the probe.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for prior WebGPU phases.

Requested backend: explicit `WebGPURenderer` canary page.

Actual backend: WebGPU, with `isWebGPUBackend=true` and `isWebGLBackend=false`.

Scene / seed / resolution: isolated API probe page. The TSL canary uploads a
`4x4` RGBA8 texture and renders it scaled into a `64x64` WebGPU render target;
the compute canary dispatches one raw WGSL workgroup over eight `u32` values.

Commands:

```powershell
node --check scripts/probe-webgpu-compose-canary-page.js
node --check scripts/probe-webgpu-compose-canary.mjs
node scripts/probe-compose-parity.mjs http://127.0.0.1:5205/
npm run probe:webgpu-compose-canary
```

Baseline: the current WebGL2 compose reference was reaccepted before the canary
was recorded. `node scripts/probe-compose-parity.mjs
http://127.0.0.1:5205/` passed all 8 assertions: static CPU/GPU parity was
`99.998%` exact with max delta `1`, max black-hole parity was `99.982%` exact
with `0.0016%` big pixels, shockwave/sprite parity was `99.997%` exact with
`0.0011%` big pixels, postFx-on parity max delta was `1`, and there were no
shader/WebGL console errors.

Expected result: no production visual or performance behavior change yet. The
positive result is a quantitative canary that proves exact WebGPU render-target
texture readback through TSL and exact raw WGSL compute readback before the
production compose shader port starts.

Actual result: keep. The canary passed on actual WebGPU. TSL `textureLoad`
rendered and read back the scaled texture with `maxDelta=0`, `mismatches=0`,
and normal orientation. Raw WGSL compute transformed `[1,2,3,4,5,6,7,8]` into
`[10,13,16,19,22,25,28,31]` exactly. The page reported no console errors, no
page errors, and no probe failures. The visible readback visualization reported
`4096/4096` nonblack pixels, average RGB `94.667`, and max channel `213`.

Performance result: no WebGPU speedup is claimed for this slice. The production
WebGL2 compose path is unchanged; this phase only reduces implementation risk
for the upcoming WebGPU compose port.

Visual/quality evidence: the canary screenshot visualizes the verified WebGPU
render-target readback buffer and was captured at
`verify-out/webgpu-compose-canary/canary-1781538012826.png`. The current compose
reference screenshots were refreshed at
`verify-out/compose-parity/cpu-shockwave.png` and
`verify-out/compose-parity/gpu-shockwave.png`.

Decision: keep the canary and proceed to the production WebGPU compose shader
port only after preserving the Phase 4.1 ABI and extending parity to compare
CPU, WebGL2 GPU compose, and WebGPU compose in the same harness.

Notes:

- Raw canary artifact:
  `verify-out/webgpu-compose-canary/probe-1781538012826.json`.
- Reference compose-parity log:
  `verify-out/compose-parity/phase4-2-compose-parity-5205.out.log`.
- Device limits in the canary matched the Phase 4.1 contract shape:
  `maxTextureDimension2D=8192`, `maxSampledTexturesPerShaderStage=16`,
  `maxSamplersPerShaderStage=16`, `maxStorageBuffersPerShaderStage=8`,
  `maxStorageBufferBindingSize=134217728`, and `maxBufferSize=268435456`.
- Validation passed: `node --check scripts/probe-webgpu-compose-canary-page.js`,
  `node --check scripts/probe-webgpu-compose-canary.mjs`,
  `npm run probe:webgpu-compose-canary`, `npm run typecheck`,
  `npm run lint`, `npm test`, and `npm run build`. The build retained the
  existing Vite large-chunk warning.

## Phase 4.3 - Raw WGSL Compose Fixture

Task: add a production-shaped WebGPU compose fixture that renders a subset of
the terrain-composition shader through raw WGSL on the active Three
`GPUDevice`, then compares readback to a CPU reference.

Commit: `76e0a5e` plus working-tree Phase 4.3 fixture/docs changes. The
checkout was dirty from unrelated gameplay, Builder, UI, and virtual-world
files during the probe.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for prior WebGPU phases.

Requested backend: explicit `WebGPURenderer` fixture page.

Actual backend: WebGPU, with `isWebGPUBackend=true` and `isWebGLBackend=false`.

Scene / seed / resolution: isolated compose fixture page at `525x357` output
resolution, using Phase 4.1 production ABI dimensions: `653x485` world window,
`263x179` light field, and `525x357` overlay/output.

Commands:

```powershell
node --check scripts/probe-webgpu-compose-fixture-page.js
node --check scripts/probe-webgpu-compose-fixture.mjs
npm run probe:webgpu-compose-fixture
```

Baseline: Phase 4.2 proved exact TSL `textureLoad` readback and exact raw WGSL
compute, but did not exercise production-sized compose resources, row padding,
packed type/charge bytes, half-float overlay data, light lookup, or LUT lookup
in a compose-shaped shader. The current WebGL2 compose path remains the
production performance reference.

Expected result: no production visual or performance behavior change yet. The
positive result is a quantitative CPU-vs-WebGPU parity fixture using the same
resource shapes and formats the live shader port will need.

After: the raw WGSL fixture rendered through the actual WebGPU backend with
`rgba8uint` world-window, `rgba32float` light-field, `r32float` bloom-LUT,
`rgba16float` overlay, and `rgba8unorm` output textures. Output readback used
`2100` byte rows padded to `2304` bytes.

Actual result: keep. The fixture passed with `maxDelta=1`, `bigPct=0`,
`meanDelta=0.0273`, and `89.425%` exact pixels against the CPU reference. This
passes the gate of `maxDelta <= 2` and `bigPct <= 0.01`.

Performance result: no WebGPU speedup is claimed for this slice. The measured
`gpuSubmitReadbackWallMs=101.8ms` includes explicit render-target readback and
is a validation cost, not a production frame-time estimate. The CPU reference
for the fixture measured `25.2ms`; the next production step must remove
readback from the frame path before judging WebGPU compose performance.

Visual/quality evidence:
`verify-out/webgpu-compose-fixture/fixture-1781540827915.png`.

Decision: keep the fixture and proceed to a live, boot-gated WebGPU compose
implementation only after extending the parity harness to compare CPU, WebGL2
GPU compose, and WebGPU compose in the same scenario.

Notes:

- Raw fixture artifact:
  `verify-out/webgpu-compose-fixture/probe-1781540827915.json`.
- Device limits in the fixture matched the Phase 4.1 contract shape:
  `maxTextureDimension2D=8192`, `maxSampledTexturesPerShaderStage=16`,
  `maxSamplersPerShaderStage=16`, `maxStorageBuffersPerShaderStage=8`,
  `maxStorageBufferBindingSize=134217728`, and `maxBufferSize=268435456`.
- The fixture covers coordinate orientation, row-pitch padding, type/charge
  packing, overlay replace/add semantics, light-field reads, and bloom-LUT
  reads. It intentionally remains isolated from production renderer state.
- Validation passed for this slice:
  `node --check scripts/probe-webgpu-compose-fixture-page.js`,
  `node --check scripts/probe-webgpu-compose-fixture.mjs`, and
  `npm run probe:webgpu-compose-fixture`. Follow-up full validation also
  passed: `npm run probe:webgpu-compose-canary`, `npm run typecheck`,
  `npm run lint`, `npm test`, `npm run build`, and `git diff --check`. The
  build retained the existing Vite large-chunk warning. `git diff --check`
  reported line-ending normalization warnings on dirty files but no whitespace
  errors.

## Phase 4.4 - TSL Storage Texture Presentation Bridge

Task: prove a GPU-resident bridge from WebGPU compute output to Three's TSL
presentation path before wiring live WebGPU compose. The probe writes a
`StorageTexture` with TSL compute, renders it through a TSL `RenderPipeline`,
and reads back only in the validation harness.

Commit: `76e0a5e` plus working-tree Phase 4.4 bridge/docs changes. The
checkout was dirty from unrelated gameplay, Builder, UI, wand, and
virtual-world files during the probe.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for prior WebGPU phases.

Requested backend: explicit `WebGPURenderer` bridge page.

Actual backend: WebGPU, with `isWebGPUBackend=true` and `isWebGLBackend=false`.

Scene / seed / resolution: isolated `128x96` storage-texture bridge page,
presented at `4x` scale.

Commands:

```powershell
node --check scripts/probe-webgpu-storage-bridge-page.js
node --check scripts/probe-webgpu-storage-bridge.mjs
node --check scripts/webgpu-storage-screenshot-validation.mjs
npm run probe:webgpu-storage-bridge
```

Baseline: Phase 4.3 proved raw WGSL can render a production-shaped compose
fixture into a WebGPU texture and compare it to CPU through validation readback.
It did not prove that a WebGPU-generated texture can stay resident and be
sampled by the Three/TSL presentation path that the live renderer already uses.

Expected result: no production visual or performance behavior change yet. The
positive result is a quantitative bridge proof: TSL compute writes texture
contents, TSL presentation samples the same texture, full-frame readback
validation matches a deterministic expected image within the declared tolerance,
and the presented canvas screenshot matches the same expected image at the
declared output dimensions.

After: the probe created a Three r184 `StorageTexture`, filled it through a TSL
`Fn` using `textureStore`, presented it through a `RenderPipeline` using
`textureLoad`, captured a validation readback outside any production frame loop,
unpacked Three/WebGPU's 256-byte padded readback rows, and decoded the Playwright
screenshot for separate presentation pixel validation.

Actual result: keep. The probe passed on actual WebGPU with full-frame
`maxDelta=1`, `mismatches=0`, `mismatchPct=0`, `exactPct=90.91%`,
`meanDelta=0.0234`, `99.9919%` nonblack pixels, average RGB `127.469`, and max
channel `255` for both offscreen readback and screenshot validation. The page
reported no console errors, no page errors, and no probe failures.

Performance result: no WebGPU speedup is claimed for this slice. The measured
`computeSubmitWallMs=25.0ms` is a one-shot probe cost that includes setup and
submit synchronization; it is not a production frame-time estimate. The
important performance-relevant result is qualitative: the bridge allows a
future live compose path to avoid copying WebGPU output back through CPU
`pixelData` before presentation.

Visual/quality evidence:
`verify-out/webgpu-storage-bridge/bridge-1781545375079.png`.

Decision: keep the bridge probe. The next live compose slice can target a
boot-gated WebGPU output texture because the presentation bridge no longer
requires a frame-loop readback.

Notes:

- Raw bridge artifact:
  `verify-out/webgpu-storage-bridge/probe-1781545375079.json`.
- Device limits in the bridge artifact satisfy the bridge needs:
  `maxStorageTexturesPerShaderStage=4`,
  `maxSampledTexturesPerShaderStage=16`, and `maxTextureDimension2D=8192`.
- This slice intentionally does not change `WebGpuRenderBackend` production
  behavior; `gpuComposeAvailable` must stay false until CPU/WebGL2/WebGPU
  same-scenario parity and A/B timing exist.
- A production-size bridge variant was attempted after the small bridge passed:
  `525x357` storage texture, `1050x714` output, full-frame comparison. The first
  attempt and one focused 2D-dispatch fix appeared to fail with high mismatch
  rates: `verify-out/webgpu-storage-bridge/probe-1781543232414.json` and
  `verify-out/webgpu-storage-bridge/probe-1781543325378.json`. Phase 4.5 traced
  that signature to validation code that treated Three/WebGPU's 256-byte padded
  readback rows as tightly packed rows. The failed artifacts are retained as
  validation-bug evidence, not as evidence that production-sized
  `StorageTexture` presentation fails.
- Validation passed for this slice:
  `node --check scripts/probe-webgpu-storage-bridge-page.js`,
  `node --check scripts/probe-webgpu-storage-bridge.mjs`,
  `node --check scripts/webgpu-storage-screenshot-validation.mjs`, and
  `npm run probe:webgpu-storage-bridge`. The final post-review fixture rerun
  records full-frame readback and screenshot comparison metrics, not
  sample-only parity.
- Same-session full validation before later unrelated wand reward-pool edits
  passed: `npm run probe:webgpu-compose-canary`,
  `npm run probe:webgpu-compose-fixture`,
  `npm run probe:webgpu-storage-bridge`, `npm run typecheck`,
  `npm run lint`, `npm test`, `npm run build`, and `git diff --check`. The
  build retained the existing Vite large-chunk warning. `git diff --check`
  reported line-ending normalization warnings on dirty files but no whitespace
  errors.
- Final post-review focused validation passed: all bridge scripts passed
  `node --check`, `npm run probe:webgpu-storage-bridge` passed, `npm run lint`
  passed, and targeted `git diff --check` found no whitespace errors.

## Phase 4.5 - Storage Bridge Size Sweep

Task: add a focused diagnostic sweep for the apparent Phase 4.4 production-size
failure before wiring live WebGPU compose. The probe reuses the TSL storage
bridge page with configurable logical size, storage size, and presentation
scale.

Commit: `76e0a5e` plus working-tree Phase 4.5 diagnostic/docs changes. The
checkout remained dirty from unrelated gameplay, Builder, UI, wand, and
virtual-world files during the probe.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for prior WebGPU phases.

Requested backend: explicit `WebGPURenderer` bridge page.

Actual backend: WebGPU, with `isWebGPUBackend=true` and `isWebGLBackend=false`
in every sweep case.

Scene / seed / resolution: isolated storage-texture bridge page. Cases covered
small baseline, production-width/small-height, small-width/production-height,
aligned `512x360`, production width with aligned height, aligned width with
production height, production `525x357`, and production `525x357` with `576`
storage-width padding.

Commands:

```powershell
node --check scripts/probe-webgpu-storage-bridge-page.js
node --check scripts/probe-webgpu-storage-size-sweep.mjs
node --check scripts/webgpu-storage-screenshot-validation.mjs
npm run probe:webgpu-storage-size-sweep
```

Baseline: Phase 4.4 proved that a small `128x96` TSL `StorageTexture` can be
written by compute, sampled by TSL presentation, and validated with full-frame
readback. A direct production-size attempt appeared to fail, but reviewer
feedback identified that the failure signature matched missing 256-byte
readback-row unpacking.

Expected result: no production visual or performance behavior change. The
positive result is qualitative and quantitative diagnostic coverage: the sweep
must preserve the known-good small case, fix the readback-row unpacking bug,
validate production-width cases, and separately validate the presented canvas
screenshot before a live compose attempt depends on this bridge.

After: the storage bridge page accepts `w`, `h`, `scale`, `storageW`, and
`storageH` query parameters, unpacks padded WebGPU readback rows, and records
raw/tight row layout. The sweep harness decodes each Playwright screenshot and
compares logical screenshot pixels against the same deterministic expected
image, then verifies screenshot dimensions against the declared scaled output
size.

Actual result: keep. The diagnostic gate passed in
`verify-out/webgpu-storage-size-sweep/probe-1781545386069.json` with no console
errors, no page errors, all eight declared expected statuses matched, and both
offscreen readback and screenshot comparison reported `mismatchPct=0`. All
screenshots also matched their expected scaled dimensions:

| Case | Size | Storage | Row padding | Readback `mismatchPct` | Screenshot `mismatchPct` |
| --- | --- | --- | --- | --- | --- |
| baseline-powerish | `128x96` | `128x96` | `0` | `0` | `0` |
| view-width-small-height | `525x96` | `525x96` | `204` | `0` | `0` |
| small-width-view-height | `128x357` | `128x357` | `0` | `0` | `0` |
| aligned-view-neighbor | `512x360` | `512x360` | `0` | `0` | `0` |
| view-width-aligned-height | `525x360` | `525x360` | `204` | `0` | `0` |
| aligned-width-view-height | `528x357` | `528x357` | `192` | `0` | `0` |
| production-view | `525x357` | `525x357` | `204` | `0` | `0` |
| production-view-padded-storage | `525x357` | `576x357` | `204` | `0` | `0` |

Performance result: no WebGPU speedup is claimed for this slice. The useful
result is reducing next-step risk: the production-size bridge failure was a
validation readback bug, not a demonstrated `StorageTexture`/TSL presentation
limit. Production-width cases now pass the readback and screenshot quality gates
without enabling production WebGPU compose.

Visual/quality evidence:
`verify-out/webgpu-storage-size-sweep/bridge-production-view-1781545386069.png`
and the per-case screenshots beside the artifact.

Decision: keep the sweep as a regression/diagnostic tool. Do not enable
production WebGPU compose from this state. The next attempt can use the
production-size storage bridge as a validated presentation path, but it still
needs live compose parity against CPU/WebGL2 and same-session timing before it
can become a renderer option.

Notes:

- Sweep artifact:
  `verify-out/webgpu-storage-size-sweep/probe-1781545386069.json`.
- The first sweep version recorded several middle cases as `expected:
  investigate`; reviewer feedback correctly noted that this made the diagnostic
  claim weaker than the benchmark discipline requires. The sweep now declares
  an explicit `expectedStatus` for every case and fails the probe if any case
  deviates from its declared pass status.
- A second reviewer correctly identified the production-width failures as
  missing row unpacking: Three r184 aligns WebGPU `readRenderTargetPixelsAsync`
  rows to 256 bytes, so non-aligned widths such as `525` and `528` must unpack
  padded rows before comparison. The fixed probe records `rowPaddingBytes` for
  every case.
- A temporary in-page attempt to validate the presented WebGPU canvas through
  `drawImage` captured black pixels in headless Edge even though the Playwright
  screenshot was correct. That approach was removed and replaced with Node-side
  PNG screenshot decoding in `scripts/webgpu-storage-screenshot-validation.mjs`.
- Validation passed for this slice:
  `node --check scripts/probe-webgpu-storage-bridge-page.js`,
  `node --check scripts/probe-webgpu-storage-size-sweep.mjs`,
  `node --check scripts/webgpu-storage-screenshot-validation.mjs`,
  `npm run probe:webgpu-storage-bridge`,
  `npm run probe:webgpu-storage-size-sweep`, `npm run typecheck`,
  `npm run lint`, and `npm run build`. The build retained the existing Vite
  large-chunk warning. A final full `npm test` run failed in unrelated dirty
  virtual-world work: `tests/virtual-world.test.ts` expected cropped scene caps
  to keep `lightCount=261` / `objectCount=261`, while the current dirty checkout
  returned `1` / `1`. That failure is outside the Phase 4.5 WebGPU slice.

## Phase 4.6 - Raw WGSL Compose to TSL Storage Presentation

Task: combine the raw WGSL compose fixture and the Three/TSL storage-texture
presentation bridge before any live renderer WebGPU compose path is enabled.
The probe uses production-sized compose resources, writes a Three-owned
`StorageTexture` from raw WGSL compute, then presents that same texture through
TSL `RenderPipeline` / `textureLoad`.

Commit: `9a93544` plus working-tree Phase 4.6 probe/docs changes. The checkout
remained dirty from unrelated gameplay, Builder, UI, wand, and virtual-world
files during the probe.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for prior WebGPU phases.

Requested backend: explicit `WebGPURenderer` fixture page.

Actual backend: WebGPU, with `isWebGPUBackend=true` and `isWebGLBackend=false`.

Scene / seed / resolution: deterministic production-sized compose fixture:
`525x357` logical view, `1050x714` presentation, `653x485 rgba8uint` world
window, `263x179 rgba32float` light field, `256x1 r32float` bloom LUT,
`525x357 rgba16float` overlay, and `525x357 rgba8unorm` output storage texture.

Commands:

```powershell
node --check scripts/probe-webgpu-compose-storage-fixture-page.js
node --check scripts/probe-webgpu-compose-storage-fixture.mjs
node --check scripts/webgpu-compose-storage-fixture-model.mjs
node --check scripts/webgpu-storage-screenshot-validation.mjs
npm run probe:webgpu-compose-storage-fixture
```

Baseline: Phase 4.3 proved a raw WGSL render-pass fixture could match a CPU
reference but did not present through a Three texture. Phase 4.4/4.5 proved a
Three `StorageTexture` could be written and presented at production size but did
not feed it from raw WGSL compose. The missing integration risk was whether raw
WGSL work could write a Three-owned texture that TSL presentation then samples.

Expected result: no production visual or performance behavior change. The
positive result is a quantitative integration proof: raw WGSL writes the
GPU-resident output texture, TSL presents it, readback parity matches CPU, and
the Playwright screenshot matches the same CPU reference at the declared output
dimensions.

After: added `scripts/probe-webgpu-compose-storage-fixture.*` plus shared
fixture/reference helpers in `scripts/webgpu-compose-storage-fixture-model.mjs`.
The page allocates a Three r184 `StorageTexture`, initializes it through TSL so
Three owns the resource, binds its base mip view to raw WGSL compute as
`texture_storage_2d<rgba8unorm, write>`, copies the texture back with 256-byte
row unpacking for validation, then presents the same texture through TSL.

Actual result: keep. The probe passed in
`verify-out/webgpu-compose-storage-fixture/probe-1781558198105.json` with no
console errors, no page errors, and no probe failures:

| Metric | Readback | Screenshot |
| --- | --- | --- |
| `maxDelta` | `1` | `1` |
| `mismatchPct` | `0` | `0` |
| `exactPct` | `89.425%` | `89.425%` |
| `meanDelta` | `0.0273` | `0.0273` |
| Dimensions | `525x357` | `1050x714` |

Performance result: no WebGPU speedup is claimed for this slice. The measured
`gpuSubmitReadbackWallMs=30.6ms` includes validation readback and is not a
production frame-time estimate. The useful result is architectural: the intended
raw-WGSL-to-TSL GPU-resident presentation path works without copying through
`pixelData`.

Visual/quality evidence:
`verify-out/webgpu-compose-storage-fixture/compose-storage-1781558198105.png`.

Decision: keep the probe. Do not enable production WebGPU compose from this
state. The next runtime slice can wire this path behind the existing
`postFx.gpuCompose` switch, but `WebGpuRenderBackend.gpuComposeAvailable` must
remain false until CPU/WebGL2/WebGPU parity and same-session timing are green.

Notes:

- Combined fixture artifact:
  `verify-out/webgpu-compose-storage-fixture/probe-1781558198105.json`.
- The first run failed because the raw storage binding used a default texture
  view spanning all mips while the bind-group layout required one mip. The fix
  binds `outputTexture.createView({ baseMipLevel: 0, mipLevelCount: 1 })` and
  sets `storageTexture.generateMipmaps=false`. The failed artifact is
  `verify-out/webgpu-compose-storage-fixture/probe-1781557822135.json`.
- The fixture intentionally exercises the subset already covered by Phase 4.3;
  the full live shader still needs backdrop, distortion, animated material, and
  post-on parity against CPU/WebGL2 before it can be treated as production
  compose.
- Raw access to the Three-owned `StorageTexture` currently relies on the pinned
  r184 backend detail `backend.get(storageTexture).texture`. Production wiring
  must keep that behind a guarded adapter and rerun this probe on any Three
  upgrade.
- Validation passed for this slice:
  `node --check scripts/probe-webgpu-compose-storage-fixture-page.js`,
  `node --check scripts/probe-webgpu-compose-storage-fixture.mjs`,
  `node --check scripts/webgpu-compose-storage-fixture-model.mjs`,
  `node --check scripts/webgpu-storage-screenshot-validation.mjs`, and
  `npm run probe:webgpu-compose-storage-fixture`.

## Phase 4.7 - Guarded Three StorageTexture Access Adapter

Task: box the private Three r184 `backend.get(storageTexture).texture` access
behind a guarded production-source adapter before live `WebGpuRenderBackend`
compose wiring starts.

Commit: `d8753ee` plus working-tree Phase 4.7 adapter/probe/docs changes. The
checkout remained dirty from unrelated Builder, physics, gameplay, and docs work
during this slice, including unrelated render-path edits outside the adapter
such as `src/render/FrameComposer.ts`.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for prior WebGPU phases.

Requested backend: explicit `WebGPURenderer` fixture page.

Actual backend: WebGPU, with `isWebGPUBackend=true` and `isWebGLBackend=false`.

Commands:

```powershell
node --check scripts/probe-webgpu-compose-storage-fixture-page.js
node --check scripts/probe-webgpu-compose-storage-fixture.mjs
npx vitest run tests/webgpu-storage-texture-access.test.ts
npm run typecheck
npm run probe:webgpu-compose-storage-fixture
```

Baseline: Phase 4.6 proved that raw WGSL can write a Three-owned
`StorageTexture` and TSL can present it, but the probe performed the private
Three backend lookup inline. Review accepted that only while pinned to Three
r184 and called for a guarded adapter before production wiring.

Expected result: no production visual or performance behavior change. The
positive result is a qualitative and quantitative safety gate: the private Three
lookup is isolated, format-checked, base-mip-view checked, unit-tested for drift,
and the WebGPU storage fixture still passes through that adapter.

After: added `src/render/WebGpuStorageTextureAccess.ts` and
`tests/webgpu-storage-texture-access.test.ts`, then updated the Phase 4.6 browser
probe to call `resolveThreeStorageTextureAccess(...)` instead of reading
`backend.get(storageTexture).texture` directly.

Actual result: keep. The adapter-backed probe passed in
`verify-out/webgpu-compose-storage-fixture/probe-1781592516747.json` with no
console errors, no page errors, no probe failures, and
`outputStorageAccess=three-r184-backend-get`:

| Metric | Readback | Screenshot |
| --- | --- | --- |
| `maxDelta` | `1` | `1` |
| `mismatchPct` | `0` | `0` |
| `exactPct` | `89.425%` | `89.425%` |
| `meanDelta` | `0.0273` | `0.0273` |
| Dimensions | `525x357` | `1050x714` |

Performance result: no WebGPU speedup is claimed for this slice. The measured
`gpuSubmitReadbackWallMs=36.6ms` includes validation readback and is not a
production frame-time estimate.

Visual/quality evidence:
`verify-out/webgpu-compose-storage-fixture/compose-storage-1781592516747.png`.

Decision: keep the adapter and the unit tests. Do not enable production WebGPU
compose from this state. The next runtime slice should wire through this adapter
and keep `WebGpuRenderBackend.gpuComposeAvailable` false until CPU/WebGL2/WebGPU
parity and same-session timing are green.

Notes:

- Adapter artifact:
  `verify-out/webgpu-compose-storage-fixture/probe-1781592516747.json`.
- The adapter creates `texture.createView({ baseMipLevel: 0, mipLevelCount: 1 })`
  centrally so the Phase 4.6 mip-view failure cannot reappear as an ad hoc
  production callsite.
- The final artifact records the Three descriptor as `format=rgba8unorm`,
  `width=525`, `height=357`, `mipLevelCount=1`, and `usage=31`; the adapter
  requires descriptor presence, storage-binding usage, expected dimensions, and
  the expected mip count to reject Three default-texture fallbacks before
  bind-group creation.
- `npx vitest run tests/webgpu-storage-texture-access.test.ts` passed `13`
  adapter tests covering success, metadata fallback, missing private API,
  missing backend data, missing backend texture, missing descriptor, missing
  format metadata, metadata mismatch, format drift, missing storage usage,
  dimension drift, mip-count drift, and failed base-mip view creation.
- Validation passed for this slice:
  `node --check scripts/probe-webgpu-compose-storage-fixture-page.js`,
  `node --check scripts/probe-webgpu-compose-storage-fixture.mjs`,
  `npx vitest run tests/webgpu-storage-texture-access.test.ts`,
  `npm run typecheck`, and `npm run probe:webgpu-compose-storage-fixture`.

## Phase 4.8 - Runtime WebGPU Compose Storage Bridge

Task: wire the guarded Three r184 StorageTexture access into the live
`WebGpuRenderBackend` as an opt-in runtime bridge diagnostic without enabling
production WebGPU compose.

Commit: `c64e0c5` plus working-tree Phase 4.8 bridge/probe/docs changes. The
checkout also contained unrelated dirty files during the probe; the artifact
records full `git.status` provenance.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for prior WebGPU phases.

Requested backend: `renderBackend=webgpu` with
`validateWebGpuComposeBridge=1`.

Actual backend: `WebGPURenderBackend` / actual WebGPU.

Commands:

```powershell
node --check scripts/probe-webgpu-runtime-compose-bridge.mjs
npm run typecheck
npm run probe:webgpu-runtime-compose-bridge
```

Baseline: Phase 4.7 proved the guarded adapter in an isolated fixture, but the
live WebGPU renderer still had no runtime-owned storage output bridge and no
status field that could distinguish "bridge validated" from "compose available".

Expected result: no production visual or performance behavior change. The
positive result is a live-renderer validation gate: the WebGPU backend can
allocate a production-sized Three `StorageTexture`, initialize it through TSL,
resolve the guarded GPU texture/view metadata, and still report production
compose as disabled.

After: added `src/render/WebGpuComposeBridge.ts`, extended
`RenderBackendStatus.webgpu.compose`, wired `WebGpuRenderBackend` to run the
bridge only when explicitly requested by query string, and added
`scripts/probe-webgpu-runtime-compose-bridge.mjs`.

Actual result: keep. The probe passed in
`verify-out/webgpu-runtime-compose-bridge/probe-1781594616958.json` with actual
WebGPU, `bridge=validated`, `productionAvailable=false`, no console errors, and
no page errors. The bridge descriptor was `format=rgba8unorm`, `width=525`,
`height=357`, `mipLevelCount=1`, `usage=31`, and
`source=three-r184-backend-get`. The probe also set `postFx.gpuCompose=true`
and verified the backend status stayed fail-closed.

Performance result: no WebGPU speedup is claimed for this slice. The bridge is
query-gated and exists to reduce integration risk before the raw WGSL live
compose port; it does not move frame composition work off the CPU yet.

Visual/quality evidence:
`verify-out/webgpu-runtime-compose-bridge/runtime-compose-bridge-1781594616958.png`.

Decision: keep. Production WebGPU compose remains disabled; do not change
`WebGpuRenderBackend.gpuComposeAvailable` until CPU/WebGL2/WebGPU parity and
same-session timing gates pass.

Notes:

- Runtime bridge artifact:
  `verify-out/webgpu-runtime-compose-bridge/probe-1781594616958.json`.
- Post-review hardening switched the one-shot init to the current
  `renderer.compute(...)` pattern and reports the bridge as unsupported if
  device loss invalidates GPU resources before fallback completes.
- Console warnings were recorded but were known startup/worldgen warnings, not
  bridge failures. Console errors and page errors remain fatal for this probe.
- Validation passed for this slice:
  `node --check scripts/probe-webgpu-runtime-compose-bridge.mjs`,
  `npm run typecheck`, and `npm run probe:webgpu-runtime-compose-bridge`.

## Phase 4.9 - Raw WGSL Write Into Runtime Compose Bridge

Task: prove raw WGSL can write the live `WebGpuRenderBackend` compose
`StorageTexture` validated in Phase 4.8, while keeping production WebGPU
compose disabled.

Commit: `c64e0c5` plus working-tree Phase 4.9 bridge/probe/docs changes. The
checkout also contained unrelated dirty files during the probe; the artifact
records full `git.status` provenance.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for prior WebGPU phases.

Requested backend: `renderBackend=webgpu` with
`validateWebGpuComposeBridge=1` and `validateWebGpuComposeRawWgsl=1`.

Actual backend: `WebGPURenderBackend` / actual WebGPU.

Commands:

```powershell
node --check scripts/probe-webgpu-runtime-compose-bridge.mjs
npm run typecheck
npm run probe:webgpu-runtime-compose-bridge
```

Baseline: Phase 4.8 proved that the live WebGPU renderer can allocate and
validate a production-sized Three `StorageTexture`, but raw WGSL had only
written Three-owned storage textures in standalone fixture pages.

Expected result: no production visual or performance behavior change. The
positive result is a live-renderer validation gate showing that raw WGSL can
write the same renderer-owned output texture that future production compose will
target.

After: extended `src/render/WebGpuComposeBridge.ts` with an opt-in raw WGSL
write validation pass. The pass writes a deterministic byte pattern to the live
`rgba8unorm` storage output, copies the texture to a readback buffer outside the
production frame loop, unpacks 256-byte padded rows, and records exact parity
metrics in `RenderBackendStatus.webgpu.compose.rawWgslWrite`.

Actual result: keep. The probe passed in
`verify-out/webgpu-runtime-compose-bridge/probe-1781596963586.json` with actual
WebGPU, `bridge=validated`, `productionAvailable=false`, and
`rawWgslWrite.status=validated`. The raw WGSL readback reported `maxDelta=0`,
`mismatchPct=0`, `exactPct=100`, and `meanDelta=0`. The probe also set
`postFx.gpuCompose=true` and verified the backend status stayed fail-closed.

Performance result: no WebGPU speedup is claimed for this slice. The recorded
`gpuSubmitReadbackWallMs=127.7ms` includes one-shot shader/pipeline setup and
validation readback; it is not a production frame-time estimate.

Visual/quality evidence:
`verify-out/webgpu-runtime-compose-bridge/runtime-compose-bridge-1781596963586.png`.

Decision: keep. Production WebGPU compose remains disabled; do not change
`WebGpuRenderBackend.gpuComposeAvailable` until CPU/WebGL2/WebGPU parity and
same-session timing gates pass.

Notes:

- Runtime raw WGSL bridge artifact:
  `verify-out/webgpu-runtime-compose-bridge/probe-1781596963586.json`.
- Post-review hardening made the deterministic raw WGSL validation exact-byte
  (`maxDelta=0`) and added an explicit `COPY_SRC` usage preflight before the
  diagnostic readback copy.
- Console warnings were recorded but were known startup/worldgen warnings, not
  bridge failures. Console errors and page errors remain fatal for this probe.
- Validation passed for this slice:
  `node --check scripts/probe-webgpu-runtime-compose-bridge.mjs`,
  `npm run typecheck`, and `npm run probe:webgpu-runtime-compose-bridge`.

## Phase 4.10 - Raw WGSL Compose Diagnostic Benchmark

Task: add and run a repeatable benchmark for the production-shaped raw WGSL
compose fixture so the WebGPU work has a real performance data point before the
live frame-composer port is promoted.

Commit: `861d4ca` plus working-tree Phase 4.10 benchmark/docs changes. The
checkout also contained unrelated dirty Builder, gameplay, particle, physics,
and UI files during the benchmark; artifacts record full `git.status`
provenance.

Hardware/browser: Headless Edge 150.0.0.0 on NVIDIA GeForce RTX 3080 Ti through
ANGLE / D3D11 for the live WebGL2 A/B. The WebGPU diagnostic ran on actual
WebGPU through Three r184 `WebGPURenderer`; WebGPU device features included
`timestamp-query`, but this benchmark did not capture GPU timestamp queries.

Requested backend: explicit `WebGPURenderer` for the raw WGSL diagnostic;
current live WebGL2 renderer for the production `postFx.gpuCompose` A/B.

Actual backend: WebGPU for `npm run bench:webgpu-compose`; WebGL2 for the live
production A/B.

Scene / seed / resolution: deterministic production-sized compose fixture for
WebGPU (`525x357` logical, `1050x714` presentation, `653x485` world window,
`263x179` light field). The live A/B used chaos / seed `777` /
`1050x714` / 2x180-frame blocks on the current dirty checkout.

Commands:

```powershell
node --check scripts/probe-webgpu-compose-benchmark-page.js
node --check scripts/probe-webgpu-compose-benchmark.mjs
npm run bench:webgpu-compose
npm run perf:ab -- postFx.gpuCompose false true http://127.0.0.1:5211/ 180 2 chaos
```

Baseline: Phase 4.9 had only one-shot raw WGSL bridge validation. Its
`gpuSubmitReadbackWallMs=127.7ms` included shader/pipeline setup and validation
readback, so it could not answer whether the WebGPU compose kernel has steady
performance headroom.

Expected result: benchmark evidence that excludes frame-loop readback, preserves
pixel parity, and distinguishes diagnostic WebGPU kernel timing from the live
production renderer path.

After: added `scripts/probe-webgpu-compose-benchmark.mjs`,
`scripts/probe-webgpu-compose-benchmark.html`, and
`scripts/probe-webgpu-compose-benchmark-page.js`, exposed as
`npm run bench:webgpu-compose`. The harness starts Vite, launches headless Edge,
runs CPU reference samples, dispatches the raw WGSL compose kernel against the
Three-owned storage texture, validates one final readback, captures a presented
TSL screenshot, and writes a JSON artifact.

Actual result: keep the benchmark harness. The WebGPU diagnostic passed in
`verify-out/webgpu-compose-benchmark/probe-1781602097966.json` with actual
WebGPU, no console errors, no page errors, readback `maxDelta=1`, `bigPct=0`,
and screenshot `mismatchPct=0`. Fixture CPU reference mean was `11.142ms`;
WebGPU individual submit/wait mean was `2.891ms`, a `3.85x` speedup for this
isolated raw WGSL compose subset. Batched one-submit throughput measured
`0.022ms` per dispatch, but that is treated as a throughput diagnostic rather
than a production frame-time estimate.

Performance result: diagnostic WebGPU kernel timing is positive, but no live
WebGPU frame-composition speedup is claimed yet. Production WebGPU compose
remains disabled. The live production WebGL2 A/B in
`verify-out/perf-ab-postfx.gpucompose-chaos-1781601403799.json` still provides
this dirty-checkout live WebGL2 reference: `postFx.gpuCompose=false -> true`
improved
`compose` `21.323 -> 4.618ms` (-78.3%), `render` `22.000 -> 5.556ms`
(-74.7%), and `frame` `28.793 -> 13.149ms` (-54.3%). In that dirty-checkout
run, `sim` and `entities` were slower in the variant, so the next live WebGPU
port must keep tracking full-frame buckets rather than only the compose kernel.

Visual/quality evidence:
`verify-out/webgpu-compose-benchmark/compose-benchmark-1781602097966.png`.

Decision: keep the benchmark harness and proceed to live WebGPU compose wiring
only behind the existing gates. Do not mark `WebGpuRenderBackend`
`gpuComposeAvailable` true until the live path passes CPU/WebGL2/WebGPU parity
and same-session frame-loop timing.

Notes:

- WebGPU benchmark artifact:
  `verify-out/webgpu-compose-benchmark/probe-1781602097966.json`.
- Live WebGL2 A/B artifact:
  `verify-out/perf-ab-postfx.gpucompose-chaos-1781601403799.json`.
- WebGPU timing method: `performance.now` around WebGPU command submission plus
  `GPUQueue.onSubmittedWorkDone()`. Validation readback is measured separately
  and excluded from steady-state samples. GPU timestamp queries remain a future
  improvement.
- Batched one-submit timing is recorded only as a throughput diagnostic and is
  not reported as a speedup.
- The CPU reference timing uses the parity fixture model and includes that
  model's output allocation, so it is not a production-optimized CPU composer.
- Validation passed for this slice:
  `node --check scripts/probe-webgpu-compose-benchmark-page.js`,
  `node --check scripts/probe-webgpu-compose-benchmark.mjs`,
  `npm run bench:webgpu-compose`, and
  `npm run perf:ab -- postFx.gpuCompose false true http://127.0.0.1:5211/ 180
  2 chaos`.

## Phase 4.11 - Live WebGPU Raw WGSL Compose Path

Task: wire the raw WGSL compose kernel into the live `WebGpuRenderBackend`
behind an explicit diagnostic query gate, prove same-frame visual quality, and
run a live frame-loop benchmark.

Commit: `861d4ca` plus working-tree Phase 4.11 live compose/probe/docs changes.
The checkout also contained unrelated dirty Builder, gameplay, particle,
physics, virtual-world, and UI files during the benchmark; artifacts record full
`git.status` provenance.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for Phase 4.10. The live run reported actual WebGPU through Three r184
`WebGPURenderer`; WebGPU device features included `timestamp-query`, but this
benchmark used CPU PerfHud bucket timing rather than GPU timestamp queries.

Requested backend: `renderBackend=webgpu&enableWebGpuLiveCompose=1`; the URL
seeds `ctx.state.render.compose=true`, and the header `WGSL` button can toggle
that diagnostic gate off/on at runtime. Clicking `WGSL` from the default WebGL
URL now reloads to the WebGPU diagnostic URL instead of staying unlit.

Actual backend: `WebGPURenderBackend` / actual WebGPU.

Scene / seed / resolution: deterministic sandbox parity scene for the visual
probe; chaos / seed `777` / `1050x714` / 4x360-frame interleaved blocks for the
performance A/B.

Commands:

```powershell
node --check scripts/probe-webgpu-live-compose.mjs
npm run probe:webgpu-live-compose -- http://127.0.0.1:5173/
npm run perf:ab -- postFx.gpuCompose false true "http://127.0.0.1:5173/?renderBackend=webgpu&enableWebGpuLiveCompose=1" 360 4 chaos
npm run typecheck
npm run lint
npm run build
```

Baseline: Phase 4.10 had a standalone raw WGSL diagnostic speedup but no live
frame-loop WebGPU compose path. Under actual WebGPU, `postFx.gpuCompose=false`
still used CPU terrain composition feeding the WebGPU presentation texture.

Expected result: the live WebGPU path must improve compose/render/frame buckets,
preserve the CPU visual reference within quantified tolerance, avoid console or
page errors, and remain diagnostic-gated with `productionAvailable=false`.

After: added `src/render/WebGpuLiveCompose.ts`, integrated it into
`src/render/WebGpuRenderBackend.ts`, and added
`scripts/probe-webgpu-live-compose.mjs` plus `npm run probe:webgpu-live-compose`.
The live path packs the world window, light field, LUT, overlay, backdrop
layers, shockwaves, and lens params, dispatches raw WGSL compute, and presents
the Three-owned storage texture through TSL. Post-review hardening added a
WebGPU `uncapturederror` handler so asynchronous validation errors mark the
live bridge failed/fail-closed, and the probe now validates the storage-texture
post-FX presentation path as well as raw compose output. Follow-up work added
the header `WGSL` button next to `GPU FX` and `PERF`; it toggles
`ctx.state.render.compose`, reloads from the default WebGL URL into
`?renderBackend=webgpu&enableWebGpuLiveCompose=1` on first enable, while the
existing `GPU FX` button continues to toggle `postFx.gpuCompose` for
CPU-vs-GPU A/B.

Actual result: fixed and kept. The first live implementation used an
`rgba8unorm` output storage texture and failed the quality gate because hot
materials were darker after HDR compose values were clamped before tone
mapping. The focused fix switched the output storage texture to `rgba16float`
and removed the upper clamp on WGSL output while keeping values non-negative.
The passing live probe artifact
`verify-out/webgpu-live-compose/probe-1781617327730.json` reports actual
WebGPU, `bridge=validated`, output storage `format=rgba16float`, `usage=31`,
`mipLevelCount=1`, no console/page errors, and `productionAvailable=false`.
It first clicked the `WGSL` button from the default WebGL URL and verified the
reload to `?renderBackend=webgpu&enableWebGpuLiveCompose=1`, then clicked the
button off/on and verified `render.compose` plus backend `features.compose`
followed the toggle.
The frozen same-frame CPU-vs-WebGPU comparison reports raw compose
`exactPct=97.223`, `maxd=1`, `meand=0.00935`, `bigPct=0`, and post-FX
`exactPct=97.048`, `maxd=1`, `meand=0.01`, `bigPct=0`; the lava brightness
sample matched CPU exactly at RGB mean `[255, 226, 160]`.

Performance result: the latest same-session live WebGPU A/B artifact
`verify-out/perf-ab-postfx.gpucompose-chaos-1781613600624.json` improved
`compose` `21.723 -> 5.505 ms` (-74.7%), `gl` `0.525 -> 0.242 ms` (-53.9%),
`render` `22.327 -> 5.839 ms` (-73.8%), and `frame`
`29.175 -> 12.921 ms` (-55.7%). `sim` moved `3.791 -> 3.876 ms` (+2.2%) and
`entities` moved `3.050 -> 3.196 ms` (+4.8%) in that run, so promotion work
must continue to judge full-frame effects and not only the compose bucket.

Visual/quality evidence:

- `verify-out/webgpu-live-compose/cpu-1781617327730.png`
- `verify-out/webgpu-live-compose/gpu-1781617327730.png`
- `verify-out/webgpu-live-compose/probe-1781617327730.json`

Decision: keep behind the explicit diagnostic `render.compose` gate. This is the first
measured live WebGPU frame-loop win for compose, but the WebGL2 GPU compose path
remains the production/default path until the wider CPU/WebGL2/WebGPU parity
matrix, Builder/Sandbox coverage, and rollout criteria are complete.

Notes:

- The earlier strict `probe-compose-parity` run against the live WebGPU path
  exposed the failed `rgba8unorm` attempt (`maxd=99`, `bigPct=7.6472%`, lava
  brightness visibly darker). After the half-float fix the same legacy probe was
  effectively green except for its WebGL-specific exact-pixel threshold:
  `maxd=1`, `meand=0.0089`, `bigPct=0`, and lava distribution matched CPU.
- The dedicated live probe intentionally accepts a one-channel presentation
  delta and requires `bigPct=0`, because `rgba16float` storage plus final canvas
  presentation can differ by one 8-bit channel while preserving the look.
- The same probe also validates the post-FX storage pipeline with
  `postFxMeanDelta <= 0.5` and `postFxBigPct <= 2`; the current artifact passes
  with `meand=0.01` and `bigPct=0`.
- Validation passed for this slice:
  `node --check scripts/probe-webgpu-live-compose.mjs`,
  `npm run probe:webgpu-live-compose`,
  `npm run perf:ab -- postFx.gpuCompose false true
  "http://127.0.0.1:5173/?renderBackend=webgpu&enableWebGpuLiveCompose=1" 360
  4 chaos`, `npm run typecheck`, `npm run lint`, and `npm run build`.

## Phase 4.12 - WebGL2 vs WebGPU Compose Promotion Gate

Task: compare the diagnostic WebGPU raw-WGSL live compose path against the
existing production WebGL2 GPU compose path, then attempt one focused fix if
WebGPU is slower.

Commit: `961b4eb` plus working-tree Phase 4.12 benchmark/script/docs changes.
The checkout also contained unrelated dirty gameplay, physics, virtual-world,
WASM, and verification files; artifacts record full `git.status` provenance.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for Phase 4.11. WebGPU ran through Three r184 `WebGPURenderer`; WebGL2 used the
existing `GpuCompose` GLSL path.

Requested backends:

- WebGL2 production reference: `http://127.0.0.1:5173/`
- WebGPU diagnostic: `http://127.0.0.1:5173/?renderBackend=webgpu&enableWebGpuLiveCompose=1`

Actual backends: WebGL2 for the production reference; actual WebGPU for the
diagnostic path.

Scene / seed / resolution: chaos / seed `777` / `1050x714` / 2x180-frame
interleaved blocks for each backend. This is a shorter promotion-gate run than
the 4x360 CPU-vs-WebGPU A/B, intended to catch directionality before spending
more time on a non-promotable path.

Commands:

```powershell
node --check scripts/perf-compose-backends.mjs
npm run perf:compose-backends -- http://127.0.0.1:5173/ 180 2 chaos
npm run typecheck
npm run probe:webgpu-live-compose
```

Baseline: Phase 4.11 proved WebGPU WGSL compose beats CPU terrain composition
inside the WebGPU renderer, but it had not compared WebGPU against the already
shipping WebGL2 GPU compose path. The promotion gate requires WebGPU compose to
be no slower than WebGL2 GPU compose, or to provide a documented visual-quality
gain that justifies any cost.

Expected result: WebGPU WGSL compose should match or beat WebGL2 GPU compose in
`compose + gl`, `render`, and `frame`, while preserving the visual gate.

After: added `scripts/perf-compose-backends.mjs` and package script
`npm run perf:compose-backends`. The script reuses `scripts/perf-ab-feature.mjs`
for both backends, then compares the `postFx.gpuCompose=true` variants so the
scenario setup and PerfHud buckets remain consistent.

Actual result: failed promotion gate; keep diagnostic only. The first
cross-backend artifact
`verify-out/perf-compose-backends-chaos-1781617832000.json` showed WebGPU WGSL
compose was slower than WebGL2 GPU compose:

- `compose`: `4.938 -> 7.559 ms` (+53.1%)
- `gl`: `0.927 -> 0.299 ms` (-67.7%)
- `render`: `5.950 -> 7.986 ms` (+34.2%)
- `frame`: `13.944 -> 16.554 ms` (+18.7%)

The lower WebGPU `gl` bucket did not offset the higher WebGPU compose cost.

Attempted fix and rollback: a focused optimization changed the WebGPU overlay
upload from full `rgba16float` texture upload to dirty-rectangle sub-upload.
That attempt failed the benchmark in
`verify-out/perf-compose-backends-chaos-1781618054569.json`, where WebGPU was
even slower versus WebGL2 GPU compose:

- `compose`: `5.293 -> 8.896 ms` (+68.1%)
- `gl`: `0.894 -> 0.510 ms` (-43.0%)
- `render`: `6.275 -> 9.566 ms` (+52.5%)
- `frame`: `13.918 -> 19.814 ms` (+42.4%)

The dirty-rectangle overlay upload attempt was rolled back. The kept live path
still passed visual/button validation in
`verify-out/webgpu-live-compose/probe-1781618193466.json`: actual WebGPU,
`bridge=validated`, no console/page errors, default-URL `WGSL` bootstrap reload,
runtime off/on toggle, raw `maxd=1`, raw `bigPct=0`, post-FX `maxd=1`, post-FX
`bigPct=0`, and lava RGB mean matched CPU at `[255, 226, 160]`.

Decision: keep WebGPU live compose behind the explicit `render.compose` /
`WGSL` diagnostic gate. Do not promote it over WebGL2 GPU compose yet. The next
performance work should target resident GPU world/upload architecture in Phase
5 rather than another small overlay-upload tweak.

Validation passed for this slice:

- `node --check scripts/perf-compose-backends.mjs`
- `node --check scripts/probe-webgpu-live-compose.mjs`
- `npm run typecheck`
- `npm run probe:webgpu-live-compose`
- `npm run perf:compose-backends -- http://127.0.0.1:5173/ 180 2 chaos`

## Phase 5.1 - Live Compose Upload Telemetry

Task: instrument the WebGPU live compose path so Phase 5 can measure CPU packing
time separately from texture/buffer upload cost before attempting a resident
world mirror or dirty upload strategy.

Commit: `39ce0a6` plus working-tree Phase 5.1 telemetry, probe, and docs
changes.

Hardware/browser: Headless Edge 150.0.0.0 on the same Windows workstation used
for Phase 4.12.

Requested backend: WebGPU diagnostic through
`?renderBackend=webgpu&enableWebGpuLiveCompose=1`; cross-backend benchmark also
used the default WebGL2 production reference.

Actual backend: actual WebGPU for the telemetry probe and diagnostic compose
path; WebGL2 for the production reference.

Scene / seed / resolution: live visual probe uses its frozen compose parity
scene at `1050x714`; benchmark uses chaos / seed `777` / `1050x714` /
2x180-frame interleaved blocks for each backend.

Commands:

```powershell
node --check scripts/probe-webgpu-live-compose.mjs
npm run typecheck
npm run probe:webgpu-live-compose
npm run perf:compose-backends -- http://127.0.0.1:5173/ 180 2 chaos
```

Baseline: Phase 4.12 proved the WebGPU live compose path still failed the
promotion gate against WebGL2 GPU compose, and the implementation could only be
judged by coarse PerfHud buckets. It did not expose the per-frame world-window
packing time, logical upload bytes, 256-byte-row-padded submitted bytes, overlay
upload cost, light upload cadence, LUT upload cost, params write cost, or
command encode/submit CPU time.

After: `RenderBackendWebGpuComposeStatus.liveMetrics` reports the last completed
WebGPU-composed frame. The live probe now asserts that those metrics are present
after a GPU-composed frame and that dimensions, workgroup counts, byte counts,
and timings are sane.

Expected result: produce a positive quantitative result without changing visual
output or promoting WebGPU compose. The result should identify which uploads
Phase 5 must reduce and confirm the instrumentation itself does not alter the
existing visual gate.

Actual result: keep instrumentation, no promotion. The live probe artifact
`verify-out/webgpu-live-compose/probe-1781618999550.json` passed with actual
WebGPU, `bridge=validated`, no console/page errors, raw compose
`exactPct=97.325`, `maxd=1`, `bigPct=0`, post-FX `exactPct=97.149`, `maxd=1`,
`bigPct=0`, and lava RGB means matching CPU at `[255, 226, 160]`.

Telemetry result from that artifact's frozen light-rebuild frame:

| Metric | Value |
| --- | ---: |
| `packWindowCpuMs` | `0.800 ms` |
| `worldWindowLogicalUploadBytes` | `1,266,820` |
| `worldWindowSubmittedUploadBytes` | `1,365,760` |
| `worldWindowUploadCpuMs` | `0.500 ms` |
| `lightLogicalUploadBytes` | `753,232` |
| `lightSubmittedUploadBytes` | `779,008` |
| `overlayLogicalUploadBytes` | `1,499,400` |
| `overlaySubmittedUploadBytes` | `1,553,664` |
| `overlayUploadCpuMs` | `0.400 ms` |
| `totalLogicalUploadBytes` | `3,521,116` |
| `totalSubmittedUploadBytes` | `3,700,096` |

Performance after instrumentation:
`verify-out/perf-compose-backends-chaos-1781619023517.json` kept the promotion
decision unchanged. WebGPU WGSL compose improved versus CPU compose inside the
WebGPU renderer (`compose 22.155 -> 6.121 ms`, -72.4%; `render 22.835 -> 6.506
ms`, -71.5%; `frame 30.209 -> 13.949 ms`, -53.8%), but remained slower than
WebGL2 GPU compose:

- `compose`: `4.617 -> 6.121 ms` (+32.6%)
- `gl`: `0.768 -> 0.273 ms` (-64.5%)
- `render`: `5.466 -> 6.506 ms` (+19.0%)
- `frame`: `12.535 -> 13.949 ms` (+11.3%)

Visual/quality evidence:

- `verify-out/webgpu-live-compose/cpu-1781618999550.png`
- `verify-out/webgpu-live-compose/gpu-1781618999550.png`
- `verify-out/webgpu-live-compose/probe-1781618999550.json`

Decision: keep. This slice gives Phase 5 the quantitative upload accounting it
needed and preserves the existing visual gate, but WebGPU live compose remains a
diagnostic `WGSL` path. The next implementation should reduce or avoid the
world-window and full-overlay uploads now measured here, then rerun the same
WebGL2-vs-WebGPU promotion gate.

## Virtual World Generation - Backend Baseline And Parity Rules

Task: establish the first virtual-world (chunked Noita-like) generation baseline
in this ledger and record the backend parity rules, so any future WebGPU/WASM
virtual-world accelerator has a fixed reference to beat and a fixed correctness
contract to honor. This is the Phase 6 entry called for by
`docs/NOITA-LIKE-RICH-WORLD-IMPLEMENTATION-PLAN.md`. Renderer WebGPU compose
(Phases 0-4.x above) is a separate subsystem from virtual-world generation.

Commit: `d8753ee` plus working-tree Phase 6 backend-honesty changes
(`BackendInfo.implemented`, UI gating, parity test, bench `implemented`
fallback). The shared checkout was dirty from a concurrent rich-world session.

Hardware/host: same Windows workstation used for prior ledger entries. This
benchmark runs under Node via Vite `ssrLoadModule`, not in a browser.

Requested backend: `auto` (resolves to `ts-worker`).

Actual backend: `sync` synchronous reference. The `ts-worker` backend reports
`available=false` under Node SSR (`typeof Worker === 'undefined'`), so the
harness falls back to the synchronous reference path. This is the authoritative
path: the worker's `worldgen.worker.ts` calls the same `generateVirtualChunk`,
so worker output is byte-identical to the sync reference; the worker only moves
that work off the main thread and streams chunks.

Scene / seed / resolution: `createDefaultVirtualWorldDef(1313162580)`, chunk
size `256`, window radius `2` (`5x5 = 25` chunks), `6` repeats, full authoritative
planes (`types`, `colors`, `life`, `charge`).

Command:

```powershell
npm run bench:virtual-world -- 1313162580 2 6
```

Baseline:

| Metric | Value |
| --- | ---: |
| Per-chunk generate mean | `40.05 ms` (p50 `39.68`, p95 `42.75`, max `43.07`) |
| 25-chunk window | mean `1020.87 ms`, p50 `968.84`, p95 `1165.85` |
| Per-chunk plane serialize mean | `3.52 ms` (p50 `3.37`, p95 `4.32`) |
| Generated bytes (25 chunks) | `13,107,200` (`512 KiB`/chunk = `8 B`/cell) |
| Transfer bytes (full planes) | `13,107,200` (no plane reduction in full mode) |

Determinism fixtures (chunk meta hashes; any backend claiming authoritative
output must reproduce these exactly): `0,0=95e538c8`, `1,0=db38f3ce`,
`-1,2=44575bc5`, `7,-3=19ee354f`. These were refreshed after the Phase 2/3
content-pack expansion (12 new biome-identity pixel scenes). The expansion
changed only the two fixtures whose chunks received new scenes (`0,0`, `1,0`)
and left per-chunk time (~`41 ms`), window time, and transfer size
(`13,107,200` bytes) within noise of the pre-content baseline, confirming the
new content is deterministic and bounded.

After: n/a. This entry is the baseline.

Expected result: a recorded, reproducible reference for per-chunk and per-window
generation time, payload size, and determinism hashes.

Actual result: keep. The synchronous reference produced the table above and the
four determinism fixtures matched across all `6` repeats.

Backend parity rules (the durable contract):

1. `BackendInfo.available` means the platform capability exists (`Worker`,
   `navigator.gpu`, `WebAssembly`). `BackendInfo.implemented` means we actually
   built the backend. They are independent: the WASM backend is `available` in
   every browser (`WebAssembly` exists) but `implemented=false`.
2. A backend may feed playtest/materialization only if
   `implemented && authoritativeCells`. Today that set is exactly `{ ts-worker }`.
   Enforced by `tests/virtual-world.test.ts > virtual world backends`.
3. A WASM authoritative backend must reproduce the determinism fixtures above
   byte-for-byte (cells, colors, life, charge, meta hash) before it may replace
   the worker. Otherwise it cannot claim `authoritativeCells`.
4. A WebGPU preview backend is visual-only (`authoritativeCells=false`) and must
   never be used for playtest materialization. The Builder playtest path already
   sidesteps this risk by regenerating through the synchronous authoritative
   generator (`Levels.createVirtual*Runtime` -> `generateVirtualWindow`), never
   through preview chunks.
5. Until a backend is `implemented`, the Builder World Map backend picker shows
   it as `planned` and disabled, and `generateWindow` refuses to run it.

Performance note: no accelerator speedup is claimed. The Backend Acceleration
Spike (plan Next Task 5) should compare any future WASM/WebGPU run against this
sync baseline at the same seed/radius/repeats and must match the determinism
fixtures (authoritative) or be explicitly labeled visual-only (preview).

Decision: keep as the virtual-world generation reference baseline.

Visual/quality evidence: not applicable to a generation-time/size baseline; a
visual preview accelerator entry must add screenshots and a CPU-vs-preview diff.

Notes:

- Raw artifact: `verify-out/virtual-world-bench-1781603196478.json`.
- A browser run (where `Worker` exists) would report `actualBackend=ts-worker`
  with the same determinism fixtures; rerun there to record worker streaming
  wall-clock and main-thread off-load before any accelerator comparison.
- Validation passed for this slice: `npm run typecheck`,
  `npx vitest run tests/virtual-world.test.ts` (`35` tests), and
  `npm run bench:virtual-world -- 1313162580 2 6`.

## Virtual World Generation - WASM Corner-Rounding Kernel

Task: implement the first real WASM virtual-generation accelerator. CPU profiling
(`--cpu-prof`, 160 chunks) showed the cellular corner-rounding morphology dominates
generation: `roundCaveCorners` self-time `14.8%` plus the `countSolidNeighbors`
(`16.8%`) and `isTerrainSolid` (`6.9%`) it drives = **~38% of per-chunk time in one
pass**. Its math is a value-noise threshold (`organicNoise -> smoothValueNoise`: floor +
smoothstep + lerp, NO transcendentals) over a pure-u32 `hash2i`, so a byte-identical
WASM port is feasible (AS f64 == JS number, AS u32 mul == `Math.imul`).

Commit: working-tree Phase-6 follow-up after `961b4eb`. Added the AssemblyScript
toolchain (`assemblyscript@0.28.19`, devDep, approved by the user).

Hardware/host: same Windows workstation; this benchmark runs under Node via Vite
`ssrLoadModule` (Node has `WebAssembly`, so the kernel is exercised here, not stubbed).

Requested/actual backend: `setRoundCornersBackend('ts')` vs `('wasm')`; default is
`'auto'` (WASM if it instantiates, else graceful TS fallback).

Scene / seed / resolution: `createDefaultVirtualWorldDef(0x4e4f4954)`, 60 chunks
(chunk size 256, scratch 320x320), 3 warm-up passes then timed.

Command: `npm run build:wasm` (asc -> `build/roundCorners.wasm` -> base64-embedded into
`src/world/virtual/wasm/roundCornersWasm.ts`), then a TS-vs-WASM generation A/B.

Baseline (TS path): per-chunk generate mean `45.54 ms`.

After (WASM path, `'wasm'` backend): per-chunk generate mean `32.89 ms`.

Expected result: byte-identical chunks and a measurable speedup, with the morphology
pass (~38% of time) substantially reduced.

Actual result: keep. **`1.38x` overall per-chunk speedup** (`45.54 -> 32.89 ms`) with
**byte-identical output** (`hashesMatch: true` in the A/B; and `tests/wasm-worldgen.test.ts`
proves 4 seeds x 6 coords = 24 full chunks match exactly via chunk hash, which cascades
through every downstream dressing pass that reads terrain shape). The full
`tests/virtual-world.test.ts` suite (41 tests) passes with WASM on by default, and the
`bench:virtual-world` determinism fixtures are unchanged.

Parity rule compliance: this is an authoritative accelerator, so byte-identity is
mandatory (per the Backend Baseline entry, rule 3). It is enforced by the cross-backend
chunk-hash test, not assumed. The kernel instantiates synchronously (small 1544-byte
module, base64-embedded) so it works in the worker, the main-thread sync path, and Node
identically; if instantiation ever fails, `roundCornersWasm` returns false and the TS
path runs unchanged.

Performance note: `1.38x` is consistent with Amdahl's law for a ~38% pass moved to a
~3x-faster kernel. Larger wins would require porting more passes (smoothing, recolor,
surface dressing) — candidates for follow-up, each gated by the same byte-parity test.

Decision: keep as the default authoritative accelerator (`'auto'`), TS retained as the
reference + fallback.

Notes:

- Source: `assembly/worldgen.ts`; build: `npm run build:wasm`; loader:
  `src/world/virtual/wasm/roundCornersKernel.ts`; wired in `ChunkGenerator.roundCaveCorners`.
- `build/` is gitignored; the committed runtime artifact is the base64 `.ts`.
- Validation passed: `npm run build:wasm`, `npm run typecheck`,
  `npx vitest run tests/wasm-worldgen.test.ts tests/virtual-world.test.ts`, `npm run build`.

## Virtual World Generation - Builder Playtest Render Audit (visual)

Task: Phase 5 render-parity audit. Unit tests already prove the data conversion boundary
(materializeChunks/cropMaterializedWindow keep cells/colors/life/charge exact and rebase
scene lights). This audit checks the OTHER end — that a real virtual playtest renders rich
(biome colors + scene lighting), disproving the plan's "Builder playtest looks dull while
play looks rich" concern for the virtual path.

Commit: working-tree, after `9539b8c`.

Hardware/browser: Headless Edge via playwright-core (`channel: 'msedge'`), Vite dev server
on `:5191`. `window.__game.ctx.levels.startRun(ctx, {mode:'test', worldSource:'virtual-world', seed})`.

Scene / seed / resolution: `createDefaultVirtualWorldDef(1313162580)` virtual test runtime,
`1050x714` renderer canvas. Reference = the sandbox build-mode view (this is a deliberately
dark cave game: even the proven-good sandbox view is only ~20% non-black, so richness is
judged RELATIVE to that reference, not by an absolute coverage threshold).

Command: `npm run verify:virtual-playtest -- http://localhost:5191/`

Expected result: the virtual playtest enters the `virtual-test` runtime, materializes
generated scenes + scene lights, and renders at least as rich as the sandbox reference with
the scene lights producing bright pixels.

Actual result: keep. Stable across 3 runs: `8` generated scenes and `7` scene lights
materialized into the runtime; canvas coverage `~21%` (reference `~20%`), average brightness
`~8.5` (reference `~8.0`), `brightPct ~0.24`, and `maxV 765` (a fully-lit pixel) — i.e. the
scene lights actually light the frame. The "dull playtest" failure mode is not present on
the virtual path.

Visual/quality evidence: `verify-out/virtual-playtest.png`.

Decision: keep `scripts/verify-virtual-playtest.mjs` as the runtime render-parity gate.
WebGL `drawImage` readback (no preserveDrawingBuffer) intermittently catches a cleared
frame, so the probe samples multiple frames and keeps the richest reading.

Notes:

- The remaining un-audited parity case is fixed-campaign Play Mode vs Builder Playtest of
  the SAME authored level; that is entangled with the campaign restore/regenerate path and
  the campaign-recipe-parity work, not the virtual materialization boundary covered here.

## Virtual World Generation - WebGPU Preview Kernel (research spike, visual-only)

Task: evaluate a WebGPU compute kernel for fast World Map preview generation, per the plan's
Phase 6 ("Implement WebGPU visual-only preview acceleration OR explicitly remove it from the
UI until it exists" + "if it shows visual mismatch, keep it as a research artifact").

Commit: working-tree, after `39ce0a6`.

Hardware/browser: Headless Edge via playwright-core (`channel: 'msedge'`), real GPU. Raw
`navigator.gpu` device + a WGSL compute shader (no Three dependency).

Scene / seed / resolution: a `256x256` preview chunk, seed `0x4e4f4954`, value-noise field
(WGSL ports of `hash2i` + `smoothValueNoise` in f32) thresholded to solid/empty and tinted
by a biome palette. `scripts/probe-webgpu-virtual-preview.{mjs,html,-page.js}`.

Command: `node scripts/probe-webgpu-virtual-preview.mjs`

Baseline: TS worker full chunk generation `~45 ms`; WASM-accelerated `~33 ms` (see entries
above). The preview kernel is NOT comparable to those — it computes only the base noise
field, not the carved + dressed authoritative chunk.

After: keep as research artifact. The kernel runs on the actual GPU and produces a varied,
non-blank biome preview: `65,536` cells, `100%` non-black, `48.3%` solid, steady-state
compute `~2.85 ms` per `256x256` preview (readback excluded, measured with
`onSubmittedWorkDone` over 20 dispatches after warm-up).

Expected result: prove WebGPU can generate a preview fast on the GPU, and decide whether it
is shippable.

Actual result: keep as a research artifact; do NOT wire it into the UI. `WebGpuPreviewBackend`
stays gated `planned` (per the Backend Baseline entry). Reasoning:

1. Visual mismatch. The kernel computes only the base value-noise field — it has NO herringbone
   carve, organic shaping, smoothing/corner-rounding, dressing, or pixel scenes. The materialized
   authoritative chunk looks substantially different, so this preview would mislead a designer
   panning the World Map (it shows a noise backdrop, not the caves/scenes they will play).
2. Non-authoritative by construction. WGSL `f32` != JS `f64`, so even a full GPU port could not
   be byte-identical; it could only ever be a `authoritativeCells:false` preview (Backend
   Baseline rule 4 forbids feeding playtest from it).
3. The worker already produces an authoritative `previewRgba` that matches what materializes.
   A fast-but-wrong GPU preview is worse than a correct worker preview for this tool.

Visual/quality evidence: `verify-out/webgpu-virtual-preview/preview-<ts>.png` (biome-tinted
value-noise field).

Decision: keep the probe as a feasibility/research artifact. A shippable WebGPU preview would
require porting the full carve+dressing pipeline to WGSL and accepting visual-only semantics
with an explicit UI label — out of scope here. The real, shippable generation accelerator is
the byte-identical WASM kernel (entry above).

Notes:

- The kernel reuses the exact `hash2i`/`smoothValueNoise` math the TS generator and the WASM
  kernel use, so the noise field itself is faithful; the gap is the missing carve/dressing
  passes, not the noise.
- Validation: `node scripts/probe-webgpu-virtual-preview.mjs` (status `passed`, adapter
  available, `~2.85 ms`/preview).

## Virtual World Generation - WASM Smoothing Kernel (second pass)

Task: extend the WASM accelerator to the next pass that profiling justifies, per the rule
"only port a pass once profiling justifies it."

Commit: working-tree, after `cc500ce`.

Hardware/host: same Windows workstation; Node via Vite `ssrLoadModule`.

Re-profile (with the corner-rounding kernel already on, `--cpu-prof`, 160 chunks): per-chunk
fell to `34.83 ms`. The new CPU hot spots were the cellular helpers — `countSolidNeighbors`
`21.5%`, `isTerrainSolid` `7.9%`, and `smoothTerrain` `6.1%` — because `roundCaveCorners`
(now WASM) was no longer the caller; `smoothTerrain` is now the dominant caller of
`countSolidNeighbors`. `recolorTerrain` was `8.2%`.

Decision on target: port `smoothTerrain`'s integer cellular loop (it drives
`countSolidNeighbors`). It splits cleanly into a pure-integer morphology loop (WASM-portable)
plus a TS color fix-up that needs biome/palette tables (kept in TS). `recolorTerrain` was
NOT ported: it is color-table + float-tint heavy, a much harder byte-identical port for a
smaller (~8%) and scattered gain — see "stop here" below.

Command: `npm run build:wasm`, then a TS-vs-WASM A/B over 60 chunks.

Baseline (corner-rounding kernel only): `40.05 ms`/chunk (`1.38x` vs pure TS).

After (corner-rounding + smoothing kernels): per-chunk `23.74 ms` vs TS `40.14 ms` =
**`1.69x`** (up from `1.38x`).

Actual result: keep. Byte-identical (`hashesMatch: true` in the A/B; `tests/wasm-worldgen.test.ts`
now exercises BOTH kernels through the same `setWorldgenWasmBackend('ts'|'wasm')` gate and the
cross-backend chunk hash; 43 virtual tests pass). The `bench:virtual-world` determinism
fixtures are UNCHANGED (`0,0=95e538c8`, `1,0=db38f3ce`, `-1,2=44575bc5`, `7,-3=19ee354f`),
confirming the smoothing kernel is byte-identical to the TS loop.

Stop here (for now): re-profiling after this pass would leave `recolorTerrain` (~8%, color
tables + float tinting + biome-palette lookups) and the residual `countSolidNeighbors` from
`hasSurfaceNear` (scattered across carve/dressing passes) as the next candidates. Both are
materially harder to port byte-identically for a smaller marginal gain than the two clean
integer cellular passes already ported. The rule "only port once profiling justifies it" now
argues against further porting until the cellular morphology is no longer the bottleneck.

Notes:

- The toggle was renamed `setRoundCornersBackend` -> `setWorldgenWasmBackend` (it now gates
  both kernels). Kernel source `assembly/worldgen.ts` (`roundCorners` + `smoothTypes`),
  loader `src/world/virtual/wasm/roundCornersKernel.ts`, wired in `ChunkGenerator`.
- Validation: `npm run build:wasm`, `npm run typecheck`,
  `npx vitest run tests/wasm-worldgen.test.ts tests/virtual-world.test.ts` (43), `npm run build`.

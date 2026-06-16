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

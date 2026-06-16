# WebGPU, TSL, and WGSL Compute Implementation Plan

Status: in progress. Phases 0-2 are implemented and benchmark-gated. Phase 3
is implemented as a boot-gated diagnostic shell with documented presentation
warnings; it is not promoted as the default renderer. Phase 4 has started with
the compose ABI/limit contract in `docs/WEBGPU-COMPOSE-ABI.md`, a standalone
WebGPU/TSL/raw-WGSL compose API canary, a production-shaped raw WGSL compose
fixture, a GPU-resident TSL storage-texture bridge probe, an opt-in runtime
StorageTexture bridge check inside the live WebGPU renderer, and an opt-in raw
WGSL write check against that live bridge. Phase 4.11 adds the first live
WebGPU raw-WGSL compose path inside `WebGpuRenderBackend`; it is query-seeded,
runtime-toggleable from the header `WGSL` button, passes the current
visual/timing gates, but remains diagnostic-only and `productionAvailable=false`
until the wider CPU/WebGL2/WebGPU parity matrix is complete.

This plan turns the current WebGL2 GPU frame-composition work into a staged
WebGPU platform migration. The goal is not to swap APIs for novelty; the goal is
to keep more render/effects data resident on the GPU so Alchemist's Descent can
keep its current look while supporting more lights, particles, projectiles,
weather, status effects, and biome-specific visual systems.

## Current Ground Truth

- `package.json` currently pins `three` exactly at `0.184.0` and
  `@types/three` exactly at `0.184.1`.
- `src/render/Renderer.ts` currently imports `three`, constructs
  `THREE.WebGLRenderer`, and uses WebGL-only `EffectComposer`,
  `UnrealBloomPass`, and `ShaderMaterial` paths.
- `src/render/ComposeShader.ts` is the implemented WebGL2 GPU terrain-composition
  path. It is valuable and should be treated as the visual reference for the
  first WebGPU compose port.
- `src/render/FrameComposer.ts` still owns CPU overlay drawing through
  `setPx` / `addPx`, and it still sets `camera.renderX` / `camera.renderY` as a
  cross-system contract.
- `src/render/Lighting.ts` still builds the half-resolution light field on the
  CPU and runs four directional sweeps.
- `src/particles/Particles.ts` mixes visual particles with particles that write
  real cells back into `World`, so it must be split before particle simulation
  can move broadly to GPU.
- `src/game/Game.ts` and `src/ui/PerfHud.ts` already expose the important timing
  buckets: `sim`, `entities`, `compose`, `gl`, `render`, and `frame`.

The existing WebGL2 GPU compose work remains the fallback and parity reference.
The WebGPU work must be additive, flag-gated, and reversible until every phase
beats its benchmark and visual-quality gate.

## Current Three.js WebGPU API Constraints

Verified against the current Three.js documentation during the 2026-06-15 plan
review:

- `WebGPURenderer` is the new renderer entry point, but it can target different
  backends and will fall back to WebGL2 when WebGPU is unavailable. Backend
  probes therefore must verify the actual backend, not just the requested
  renderer class.
- The existing `EffectComposer` addon is WebGLRenderer-only. WebGPU post work
  must use the WebGPU/TSL render pipeline path instead of trying to reuse the
  current WebGL pass chain.
- `ShaderMaterial` is WebGLRenderer-only. The GLSL terrain compose shader cannot
  be carried into the WebGPU backend as-is; it must be ported to TSL and/or
  WGSL-backed TSL.
- For Three r183+ terminology, prefer `RenderPipeline` over the deprecated
  `PostProcessing` wrapper when documenting or implementing WebGPU post work.
- TSL compute code must use node assignments (`assign`, property assignment,
  `toVar`, or `select`) rather than plain JavaScript variable reassignment
  inside shader control flow.
- WebGPU limits and optional features are device-specific. Any plan that needs
  large storage buffers, many storage bindings, f16, timestamp queries, or
  float32 texture behavior must query adapter limits/features and degrade
  gracefully before requesting them.

## Non-Negotiable Benchmark Rule

Every task in this plan must produce a positive quantitative or qualitative
result. That means every task gets a written before/after record.

For every task:

1. Record a baseline before changing behavior.
2. Declare the expected improvement before implementation.
3. Record the after result using the same scene, seed, browser, resolution, and
   measurement method.
4. Capture qualitative evidence for visual tasks: screenshots, parity diffs,
   short clips, or probe images.
5. If after is worse in performance or visual quality, attempt one focused fix.
6. If the focused fix still misses the gate, roll the task back and record it as
   attempted but failed to meet the quality/performance benchmark.

No phase is considered complete because it "works" in isolation. It must improve
the relevant budget, preserve or improve visual quality, and leave the game
responsive.

## Shared Measurement Protocol

Use the same protocol for all phases unless a phase explicitly adds a better
probe.

- Static validation: `npm run typecheck`, `npm test`, `npm run lint`,
  `npm run build`.
- Runtime smoke: `node scripts/verify-game.mjs`.
- Existing performance scenes: `node scripts/perf-scene.mjs <label>` and
  `scripts/perf-ab-compose.mjs` for same-session A/B where applicable.
- Raw timing source: `window.__perfRecord` / `window.__perfSamples` through
  `PerfHud`.
- Visual evidence: probe screenshots under `verify-out/`, canvas readbacks
  inside `requestAnimationFrame`, and parity diffs for deterministic output.
- Durable benchmark summaries live in `docs/`; `verify-out/` remains generated
  local evidence and must not become the committed ledger.
- Drift rule: prefer same-session A/B. If comparing separate sessions, only
  trust movement well outside normal 3-5% machine drift.

Each task should add a compact result block to its PR or commit note:

```text
Task:
Baseline:
After:
Expected result:
Actual result:
Visual/quality evidence:
Decision: keep | fixed and kept | rolled back | attempted and failed
```

## Architecture Principles

### Keep the Grid Authoritative

The CPU `World` remains gameplay-authoritative until a later phase proves a
GPU-authoritative chunk model. Status, brewing, collisions, mechanisms, saves,
and expedition persistence still read/write real cells.

GPU systems may mirror world data for rendering, lighting, particles, and other
derived fields. They must not become hidden gameplay state unless the plan for
CPU/GPU synchronization is explicit and measured.

### Use the Right Shader Layer

- Use TSL for WebGPU presentation, post-processing, node materials, simple
  shader composition, and maintainable visual effects.
- Use raw WGSL for dense compute kernels where storage buffers/textures,
  workgroup layout, atomics, or explicit memory access matter.
- Avoid GPU readback in the frame loop. A GPU task that requires per-frame
  readback is presumed invalid until measurement proves otherwise.

### Preserve Frame Order

Do not casually reorder `Game.step`. The existing order is a contract:
camera/sim-bounds before sim, sim before entities, compose before present, HUD
updates at their current cadence, and lighting rebuilt at the current point in
the frame. WebGPU work can add GPU passes inside the render/compose window, but
cannot change gameplay ordering without a separate design review.

### Keep WebGL Fallback

WebGPU support is not universal, and device loss must be handled. The WebGL2
path remains a permanent fallback until WebGPU is proven reliable enough across
target browsers and hardware.

## Phase 0 - Benchmark Harness and Result Ledger

Purpose: make every later phase hard to fool.

Tasks:

- Add a durable benchmark ledger under `docs/`
  that records before/after numbers, hardware/browser, commit SHA, scene, seed,
  and decision.
- Add or extend a script that runs repeatable A/B blocks for arbitrary feature
  flags, not just `postFx.gpuCompose`.
- Add worst-case scenes for many emitters, many visual-only particles, many
  projectiles, heavy authored lights, and current chaos benchmark coverage.
- Add screenshot/diff capture helpers that work for WebGL and WebGPU canvases.
- Add backend-capability logging to the ledger: requested backend, actual
  backend, adapter limits needed by the phase, optional features available,
  timestamp-query availability, browser, GPU/driver string when exposed, and
  whether WebGPU fell back to WebGL2.

Expected result:

- No performance work starts without a repeatable baseline path.
- A/B output reports `sim`, `entities`, `compose`, `gl`, `render`, and `frame`
  means, p95, and sample counts.

Acceptance gate:

- Benchmark script runs against the current WebGL2 path without changing game
  behavior.
- Result ledger has at least one baseline entry for current `postFx.gpuCompose`
  on and off.

Rollback rule:

- If the harness adds runtime overhead when not recording, revert the hook and
  record the failed attempt.

## Phase 1 - Three/WebGPU API Pin Audit and Spike

Purpose: prove the repo's pinned Three r184 WebGPU, TSL, compute, and WebGPU
post-processing APIs are current enough to build on before production renderer
work starts. The repo already pins `three` `0.184.0` and `@types/three`
`0.184.1`; do not churn dependencies unless a focused spike proves a required
API is missing or broken in the pinned version.

Tasks:

- Audit `three` and `@types/three` pins against the APIs used by the spike.
- Upgrade `three` and `@types/three` together only if the spike proves the
  pinned r184 APIs cannot satisfy a required WebGPU/TSL path.
- Resolve any compile/runtime API changes without changing game visuals.
- Verify imports for `three/webgpu`, `three/tsl`, WebGPU capability helpers,
  post-processing replacement APIs, storage buffers, and WGSL function support.
- Spike the current RenderPipeline/TSL post-processing API with a throwaway
  non-shipping node chain so later phases do not discover API drift while
  porting production visuals.
- Spike a tiny TSL compute kernel that writes a storage buffer and a tiny
  WGSL-backed helper used from TSL. Record the exact syntax that works in this
  repo's pinned Three version.
- Document any version-specific API choices in this file or a focused migration
  note.

Expected result:

- No feature work yet. The game should look and perform the same on the existing
  WebGL path after the API pin audit. If an upgrade is required, the upgrade PR
  must remain behavior-neutral.

Acceptance gate:

- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
- `node scripts/verify-game.mjs`.
- Current GPU compose parity probe still passes on the WebGL2 path.
- Perf deltas stay within normal drift, or improve.

Rollback rule:

- If the upgrade causes unresolved rendering regressions, TypeScript churn that
  obscures the real migration, or measurable WebGL fallback slowdown after one
  focused fix attempt, revert the dependency upgrade and record it as attempted.

## Phase 2 - Renderer Backend Boundary

Purpose: isolate the game from concrete renderer APIs before introducing a
WebGPU backend.

Tasks:

- Introduce a backend boundary around the existing `RenderTarget` /
  `OverlaySurface` contract instead of letting gameplay know about WebGL or
  WebGPU concrete classes.
- Keep the current `Renderer` behavior as `WebGLRenderBackend` or equivalent.
- Add capability detection for WebGPU, WebGPU disabled, WebGPU lost, WebGPU
  recovered, and WebGL fallback.
- Add feature flags: `render.backend = webgl | webgpu | auto` and granular
  flags for compose, lighting, particles, and post.
- Add device-loss handling that can recreate GPU resources while preserving the
  CPU game state.
- Register the `GPUDevice.lost` promise for every WebGPU device. All buffers,
  textures, bind groups, pipelines, and render targets created from a lost
  device must be treated as invalid and rebuilt from CPU-owned state.
- Add a dev/test-only simulated device-loss path using `device.destroy()` where
  available. The probe should verify recovery without page reload before any
  WebGPU backend becomes default.
- Add a backend-selection matrix that proves the actual backend in use. Cover:
  `navigator.gpu` absent, insecure context, no adapter, device init failure,
  explicit `forceWebGL`, WebGPU disabled by user flag, WebGPU lost, and WebGPU
  recovered. Three's WebGPU renderer may fall back to WebGL2; probes must report
  the verified backend, not only the requested backend.
- Device-loss recovery must preserve the existing `Ctx`, `World`, expedition
  state, input bindings, Builder overlays, and canvas-holder layout. If a canvas
  must be replaced, input and Builder measurement hooks must be explicitly
  rebound and verified.

Expected result:

- No visual change. The WebGL backend continues to run exactly as before.
- The game can select a backend deterministically for tests and A/B runs.

Acceptance gate:

- Existing WebGL2 GPU compose parity remains green.
- Backend selection does not regress `render` or `frame` beyond drift.
- Toggling flags cannot strand input, HUD, Sandbox, Builder, or expedition play.

Rollback rule:

- If the abstraction adds measurable overhead or cross-module complexity without
  enabling a working WebGPU shell, revert to the direct renderer path and record
  the attempt.

## Phase 3 - WebGPU Presentation Shell

Purpose: bring up `THREE.WebGPURenderer` with a no-op visual path before
porting real effects.

Tasks:

- Create a WebGPU backend that presents a full-screen pixel-art quad at
  `RENDER_W x RENDER_H`.
- Preserve camera overscan, sub-cell offset, zoom, shake, exposure controls,
  and input canvas ownership.
- Recreate the current post chain in WebGPU/TSL form: base scene pass,
  tonemapping, bloom equivalent, chromatic aberration, film grain, hurt pulse,
  and any enabled/disabled controls.
- Implement this through WebGPU `RenderPipeline`/TSL nodes, not the WebGL
  `EffectComposer` addon.
- Keep the WebGL renderer as the fallback path.

Expected result:

- WebGPU can present a frame and execute the post chain with no gameplay changes.
- Visual output matches the WebGL fallback within documented tolerance.

Acceptance gate:

- WebGPU smoke probe renders nonblank pixels and validates expected canvas size.
- PostFx on/off screenshots match current WebGL reference closely enough that
  differences are either imperceptible or documented.
- `gl`/presentation bucket is not worse than WebGL after one focused fix.
- Main-thread canvas ownership is preserved. OffscreenCanvas/worker
  presentation is a non-goal until a separate input, screenshot, Builder, and
  console-capture design exists. Workers may be used for compute/worldgen only.
- The post-processing/output-transform order is documented as a named contract:
  base pixel quad, bloom/emissive treatment, lens split/grain/hurt pulse,
  exposure/tone mapping, and final output color-space conversion exactly once.

Rollback rule:

- If WebGPU presentation is slower or visibly worse after tuning post settings,
  leave the shell behind a disabled flag or roll it back and record the failed
  result.

## Phase 4 - Port GPU Compose to WebGPU/TSL

Purpose: replace the WebGL2 `ComposeShader.ts` path with an equivalent WebGPU
compose path while preserving the CPU/WebGL parity reference.

Tasks:

- Port the terrain-composition fragment shader from GLSL to TSL or WGSL-backed
  TSL.
- Preserve formula-for-formula behavior from `FrameComposer.composeTerrainCpu`
  and the existing `ComposeShader.ts` implementation: lighting law, self glow,
  material animation, shockwave/lens distortion, bloom LUT, parallax, and
  overlay semantics.
- Use WebGPU textures/storage resources that avoid unnecessary CPU-side format
  conversion.
- Keep `postFx.gpuCompose` runtime-flippable for same-session A/B.
- Before porting, add a compose ABI table covering every current WebGL2 input:
  world window format (`RGBA8UI` equivalent), type/charge packing, light field
  (`RGBA32F` equivalent), LUT (`R32F` equivalent), overlay (`RGBA16F`
  equivalent), Y-flipped view rows, padded windows, row-major CPU arrays,
  alignment, bind groups, texture-vs-storage-buffer choices, endian assumptions,
  and update cadence.
- Include storage texture/buffer limit checks in the ABI table. If the preferred
  layout exceeds guaranteed limits on any target class, document the fallback
  layout before implementation.

Phase 4.1 result:

- ABI and limit contract: `docs/WEBGPU-COMPOSE-ABI.md`.
- WebGPU backend status now reports compose-relevant device features, selected
  limits, and `timestamp-query` availability for probes and benchmark artifacts.
- The WebGPU presentation probe now asserts the Phase 4.1 minimum device limits
  before future work may claim WebGPU compose support.
- This slice intentionally does not enable WebGPU compose yet; `GpuCompose` in
  `src/render/ComposeShader.ts` remains the WebGL2 performance and parity
  reference.

Phase 4.2 result:

- The current WebGL2 compose reference was rechecked before the WebGPU shader
  port work continues: `node scripts/probe-compose-parity.mjs
  http://127.0.0.1:5205/` passed all 8 assertions with static CPU/GPU
  `99.998%` exact, max delta `1`, shockwave/sprite `99.997%` exact, postFx-on
  max delta `1`, and no shader/WebGL console errors.
- Added a standalone browser canary under
  `scripts/probe-webgpu-compose-canary.*`, exposed as
  `npm run probe:webgpu-compose-canary`, that proves the pinned Three/WebGPU
  stack can render TSL `textureLoad` output into a WebGPU render target and can
  dispatch raw WGSL compute through the active Three `GPUDevice`.
- The canary artifact
  `verify-out/webgpu-compose-canary/probe-1781538012826.json` passed on actual
  WebGPU. TSL `textureLoad` read back a scaled `4x4` RGBA8 texture through a
  `64x64` render target with `maxDelta=0`, `mismatches=0`, and normal
  orientation. Raw WGSL compute transformed `[1,2,3,4,5,6,7,8]` into
  `[10,13,16,19,22,25,28,31]` exactly. The screenshot visualizes the verified
  render-target readback buffer and reported `4096/4096` nonblack pixels.
- This slice still does not enable WebGPU compose in production and does not
  claim a frame-rate win. Its positive result is that the required TSL texture
  readback and raw WGSL compute primitives are verified before the production
  shader port starts.

Phase 4.3 result:

- Added a standalone browser fixture under
  `scripts/probe-webgpu-compose-fixture.*`, exposed as
  `npm run probe:webgpu-compose-fixture`, that renders a production-shaped
  subset of the compose shader through raw WGSL on the active Three WebGPU
  `GPUDevice`.
- The fixture uses the Phase 4.1 ABI resource shapes and formats:
  `653x485 rgba8uint` world window, `263x179 rgba32float` light field,
  `256x1 r32float` bloom LUT, `525x357 rgba16float` overlay, and
  `525x357 rgba8unorm` output with 256-byte row-pitch readback.
- The artifact
  `verify-out/webgpu-compose-fixture/probe-1781540827915.json` passed on actual
  WebGPU with `maxDelta=1`, `bigPct=0`, `meanDelta=0.0273`, and `89.425%`
  exact pixels against the CPU reference. The screenshot
  `verify-out/webgpu-compose-fixture/fixture-1781540827915.png` visualizes the
  WebGPU readback buffer.
- This slice still does not enable WebGPU compose in production and does not
  claim a frame-rate win. Its positive result is a concrete CPU-vs-raw-WGSL
  parity gate for the coordinate orientation, row padding, packed type/charge
  bytes, overlay add/replace semantics, light field, and bloom LUT pieces that
  the live shader port must preserve.

Phase 4.4 result:

- Added a standalone browser bridge under
  `scripts/probe-webgpu-storage-bridge.*`, exposed as
  `npm run probe:webgpu-storage-bridge`, that proves a Three r184
  `StorageTexture` can be written by TSL compute and then sampled by a TSL
  `RenderPipeline` without requiring production-frame readback.
- The artifact
  `verify-out/webgpu-storage-bridge/probe-1781545375079.json` passed on actual
  WebGPU with full-frame offscreen readback and screenshot validation both at
  `maxDelta=1`, `mismatches=0`, `mismatchPct=0`, `exactPct=90.91%`,
  `meanDelta=0.0234`, `99.9919%` nonblack pixels, and no console or page
  errors. The screenshot
  `verify-out/webgpu-storage-bridge/bridge-1781545375079.png` visualizes the
  storage-texture presentation output.
- Earlier production-size attempts appeared to fail at `525x357`, but Phase 4.5
  traced that to validation code that read Three/WebGPU's 256-byte padded rows as
  tightly packed rows. Those failed artifacts remain recorded as validation-bug
  evidence: `verify-out/webgpu-storage-bridge/probe-1781543232414.json` and
  `verify-out/webgpu-storage-bridge/probe-1781543325378.json`.
- This slice still does not enable WebGPU compose in production and does not
  claim a frame-rate win. Its positive result is proving the GPU-resident output
  bridge that a future live compose path needs: compute or render work can
  write a WebGPU texture and the Three/TSL presentation layer can consume that
  texture without copying it back through `pixelData`.

Phase 4.5 result:

- Added a diagnostic size sweep under
  `scripts/probe-webgpu-storage-size-sweep.mjs`, exposed as
  `npm run probe:webgpu-storage-size-sweep`, that reuses the Phase 4.4 bridge
  page with query-string dimensions to isolate the apparent production-size
  failure.
- The artifact
  `verify-out/webgpu-storage-size-sweep/probe-1781545386069.json` passed as a
  diagnostic gate: every sweep case had a declared expected status, every case
  passed, offscreen readback and screenshot validation both reported
  `mismatchPct=0`, screenshot dimensions matched the declared scaled output
  size, and the probe reported no console or page errors.
- The positive qualitative result is resolving the apparent production-size
  blocker before any live production wiring. The old `525x357` failures were
  caused by missing 256-byte row unpacking in the validation readback. After
  unpacking padded rows and adding screenshot pixel validation, `128x96`,
  `525x96`, `128x357`, `512x360`, `525x360`, `528x357`, `525x357`, and
  `525x357` with `576` storage padding all pass.
- This slice still does not enable WebGPU compose in production and does not
  claim a frame-rate win. Per the benchmark rule, the initially worse result was
  fixed and kept rather than rolled back.

Phase 4.6 result:

- Added a combined production-sized fixture under
  `scripts/probe-webgpu-compose-storage-fixture.*`, exposed as
  `npm run probe:webgpu-compose-storage-fixture`, that joins the two previously
  separate proof points: raw WGSL compute writes a Three r184 `StorageTexture`
  and TSL presents that same GPU-resident texture.
- The artifact
  `verify-out/webgpu-compose-storage-fixture/probe-1781558198105.json` passed on
  actual WebGPU. The raw WGSL storage output and the TSL-presented screenshot
  both matched the CPU reference with `maxDelta=1`, `mismatchPct=0`,
  `exactPct=89.425%`, and `meanDelta=0.0273`; screenshot dimensions matched
  the declared `1050x714` output.
- The positive qualitative result is proving the live renderer's intended
  GPU-resident path shape before wiring it into `WebGpuRenderBackend`: production
  compose resources can feed raw WGSL, write a Three-owned storage texture, and
  be consumed by TSL presentation without a CPU `pixelData` copy.
- This slice still does not enable WebGPU compose in production and does not
  claim a frame-rate win. The next runtime slice must wire this path behind the
  existing `postFx.gpuCompose` flag and pass CPU/WebGL2/WebGPU parity plus
  same-session timing before `gpuComposeAvailable` may return true.
- Production wiring must isolate the pinned r184 private backend texture access
  (`backend.get(storageTexture).texture`) behind a guarded adapter and rerun the
  Phase 4.6 probe on any Three upgrade.

Phase 4.7 result:

- Added `src/render/WebGpuStorageTextureAccess.ts`, a guarded adapter around the
  pinned Three r184 private `backend.get(storageTexture).texture` lookup. It
  fails closed when `backend.get`, the backend texture, the format metadata, or
  the required base-mip view is unavailable.
- Updated `scripts/probe-webgpu-compose-storage-fixture-page.js` to use the
  adapter instead of reaching into Three internals inline. The new artifact
  `verify-out/webgpu-compose-storage-fixture/probe-1781592516747.json` passed on
  actual WebGPU and records `outputStorageAccess=three-r184-backend-get`,
  `outputStorageBackendFormat=rgba8unorm`, descriptor `usage=31`,
  `mipLevelCount=1`, `maxDelta=1`, `mismatchPct=0`, and `meanDelta=0.0273`.
- Added `tests/webgpu-storage-texture-access.test.ts` for adapter success,
  descriptor-format fallback, missing-private-API failure, missing backend data,
  missing backend texture, missing format metadata, format-drift failure, and
  failed base-mip view creation. The targeted test run passed `13` tests after
  review hardening.
- This slice still does not enable WebGPU compose in production and does not
  claim a frame-rate win. It reduces integration risk for the next runtime
  slice by boxing the private Three r184 access in one revalidatable module.

Phase 4.8 result:

- Added `src/render/WebGpuComposeBridge.ts`, a dev/probe-only runtime bridge
  owned by `WebGpuRenderBackend`. It allocates a production-sized Three r184
  `StorageTexture`, initializes it through TSL `textureStore`, then resolves
  the guarded raw `GPUTexture` access through `resolveThreeStorageTextureAccess`.
- Extended `RenderBackendStatus.webgpu.compose` so probes can distinguish
  `productionAvailable=false` from a validated runtime bridge. The bridge only
  runs when the page is booted with `?validateWebGpuComposeBridge=1`; normal
  WebGPU presentation does not pay the one-shot compute/setup cost.
- Added `scripts/probe-webgpu-runtime-compose-bridge.mjs`, exposed as
  `npm run probe:webgpu-runtime-compose-bridge`. The artifact
  `verify-out/webgpu-runtime-compose-bridge/probe-1781594616958.json` passed on
  actual WebGPU with `bridge=validated`, `productionAvailable=false`, descriptor
  `format=rgba8unorm`, `width=525`, `height=357`, `mipLevelCount=1`,
  `usage=31`, and `source=three-r184-backend-get`. The probe also flipped
  `postFx.gpuCompose=true` and confirmed the status stayed fail-closed with no
  console errors or page errors.
- This slice still does not enable WebGPU compose in production and does not
  claim a frame-rate win. Its positive result is narrowing the next shader-port
  risk: the live game renderer can allocate and validate the GPU-resident output
  bridge that the future raw WGSL compose pass will write, while runtime compose
  remains disabled until CPU/WebGL2/WebGPU parity and same-session timing gates
  pass.
- Post-review hardening switched the one-shot init to the current
  `renderer.compute(...)` pattern and reports the bridge as unsupported if
  device loss invalidates GPU resources before fallback completes.

Phase 4.9 result:

- Extended the runtime bridge with a second explicit probe gate,
  `?validateWebGpuComposeRawWgsl=1`, that dispatches raw WGSL against the same
  live `StorageTexture` validated in Phase 4.8. The WGSL kernel writes a
  deterministic byte pattern to the `rgba8unorm` storage output, then the probe
  copies that texture to a readback buffer outside the production frame loop.
- The artifact
  `verify-out/webgpu-runtime-compose-bridge/probe-1781596963586.json` passed on
  actual WebGPU with `rawWgslWrite.status=validated`, `maxDelta=0`,
  `mismatchPct=0`, `exactPct=100`, and `meanDelta=0`. The bridge still reports
  `productionAvailable=false`, and flipping `postFx.gpuCompose=true` remained
  fail-closed.
- This slice still does not enable WebGPU compose in production and does not
  claim a frame-rate win. The recorded `gpuSubmitReadbackWallMs=127.7ms`
  includes one-shot shader/pipeline setup plus validation readback and is not a
  production frame-time estimate. Its positive result is proving that raw WGSL
  can write the live renderer-owned compose output texture that the future
  production compose pass will target.
- Post-review hardening made the deterministic raw WGSL validation exact-byte
  (`maxDelta=0`) and added an explicit `COPY_SRC` usage preflight before the
  diagnostic readback copy.

Phase 4.10 result:

- Added a repeatable diagnostic benchmark under
  `scripts/probe-webgpu-compose-benchmark.*`, exposed as
  `npm run bench:webgpu-compose`. The benchmark reuses the production-shaped
  raw WGSL compose fixture, writes a Three-owned `StorageTexture`, presents it
  through TSL, and records CPU reference timing, WebGPU per-dispatch
  queue-completion timing, batched dispatch throughput, readback parity, and
  screenshot parity.
- The artifact
  `verify-out/webgpu-compose-benchmark/probe-1781602097966.json` passed on
  actual WebGPU. The raw WGSL output matched the CPU reference with
  `maxDelta=1`, `bigPct=0`, and screenshot `mismatchPct=0`; no console or page
  errors were recorded.
- Diagnostic submit/wait wall-clock timing for the fixture was CPU reference
  mean `11.142ms` versus
  WebGPU individual submit/wait mean `2.891ms`, a `3.85x` speedup for this
  isolated raw WGSL compose subset. The same run measured a batched
  one-submit throughput of `0.022ms` per dispatch, but that number is treated as
  a throughput diagnostic rather than a frame-time estimate.
- The same checkout also reran the live production WebGL2 same-session A/B:
  `postFx.gpuCompose=false` to `true` improved `compose` from `21.323ms` to
  `4.618ms` (-78.3%), `render` from `22.000ms` to `5.556ms` (-74.7%), and
  `frame` from `28.793ms` to `13.149ms` (-54.3%). That artifact is
  `verify-out/perf-ab-postfx.gpucompose-chaos-1781601403799.json`.
- This slice gives the first positive WebGPU performance evidence for the raw
  compose kernel, but it still does not prove a live game speedup. Production
  WebGPU compose remains `productionAvailable=false`; the next slice must move
  this kernel into `WebGpuRenderBackend` behind the existing flag and benchmark
  CPU/WebGL2/WebGPU in the same live frame loop.

Phase 4.11 result:

- Added `src/render/WebGpuLiveCompose.ts`, a live WebGPU compose
  backend that packs the visible world window, half-resolution light field,
  bloom LUT, backdrop layers, overlay texture, shockwaves, and lens parameters
  into WebGPU resources, dispatches raw WGSL compute, and presents the resulting
  Three `StorageTexture` through the existing TSL `RenderPipeline` path.
- Wired it into `src/render/WebGpuRenderBackend.ts` behind
  `ctx.state.render.compose`. The URL parameter `?enableWebGpuLiveCompose=1`
  seeds that flag for probes, and the new header `WGSL` button toggles it off/on
  during a WebGPU session. If clicked from the normal WebGL URL, the button now
  reloads to `?renderBackend=webgpu&enableWebGpuLiveCompose=1` instead of
  silently staying off. The regular WebGPU presentation path and WebGL2 path do
  not pay this setup cost until the flag is enabled. The live status still
  reports `productionAvailable=false` because this is a diagnostic gate, not
  default production enablement.
- Added `scripts/probe-webgpu-live-compose.mjs`, exposed as
  `npm run probe:webgpu-live-compose`, to validate actual WebGPU backend status,
  guarded Three r184 storage access, the `WGSL` default-URL bootstrap and
  runtime toggle, same-frame CPU-vs-WebGPU raw and post-FX visual quality, and
  HDR material brightness.
- The first live output attempt used `rgba8unorm` storage and failed the visual
  gate: deterministic parity showed hot materials were darker because the WGSL
  output clamped HDR compose values before ACES/post processing. The focused fix
  switched the live output to `rgba16float` and removed the upper clamp while
  preserving non-negative output.
- The latest passing live probe artifact
  `verify-out/webgpu-live-compose/probe-1781617327730.json` reports actual
  WebGPU, `bridge=validated`, output storage `format=rgba16float`, `usage=31`,
  `mipLevelCount=1`, no console/page errors, and
  `productionAvailable=false`. It clicked `WGSL` from a default WebGL URL and
  verified the app reloaded with `renderBackend=webgpu` and
  `enableWebGpuLiveCompose=1`, then clicked the same button off/on and verified
  `render.compose` plus backend status followed the toggle. Its frozen
  same-frame visual comparison reports raw compose `exactPct=97.223`, `maxd=1`,
  `meand=0.00935`, `bigPct=0`, and post-FX `exactPct=97.048`, `maxd=1`,
  `meand=0.01`, `bigPct=0`; the lava brightness sample matched CPU exactly at
  RGB mean `[255, 226, 160]`.
- The latest same-session live WebGPU A/B artifact
  `verify-out/perf-ab-postfx.gpucompose-chaos-1781613600624.json` compares
  `postFx.gpuCompose=false` to `true` under actual WebGPU with
  `?enableWebGpuLiveCompose=1`, chaos seed `777`, `1050x714`, and 4x360-frame
  interleaved blocks. It improved `compose` from `21.723ms` to `5.505ms`
  (-74.7%), `render` from `22.327ms` to `5.839ms` (-73.8%), and `frame` from
  `29.175ms` to `12.921ms` (-55.7%). The `sim` and `entities` buckets were
  slower in that run (`+2.2%` and `+4.8%`), so future promotion must
  continue tracking full-frame effects, not only compose time.
- Post-review hardening added a WebGPU `uncapturederror` handler so asynchronous
  validation errors mark the live compose bridge failed/fail-closed, and the
  live probe now covers the storage-texture post-FX presentation pipeline.
- Decision: keep behind the explicit diagnostic `render.compose` gate. This is
  the first measured live WebGPU frame-loop win, but WebGL2 GPU compose remains
  the production/default compose path until the broader parity matrix and
  rollout criteria are done.

Phase 4.12 result:

- Added `scripts/perf-compose-backends.mjs`, exposed as
  `npm run perf:compose-backends`, to run the existing `postFx.gpuCompose`
  A/B harness once on the production WebGL2 path and once on the WebGPU
  live-compose diagnostic path, then compare the GPU-compose-on variants.
- The first cross-backend artifact
  `verify-out/perf-compose-backends-chaos-1781617832000.json` shows the current
  WebGPU WGSL compose path does not pass the WebGL2 promotion gate yet. Against
  WebGL2 GPU compose, WebGPU WGSL compose was slower in `compose`
  (`4.938ms -> 7.559ms`, +53.1%), `render` (`5.950ms -> 7.986ms`, +34.2%),
  and `frame` (`13.944ms -> 16.554ms`, +18.7%), although WebGPU `gl` was lower
  (`0.927ms -> 0.299ms`, -67.7%).
- A focused optimization attempt changed WebGPU overlay upload from full
  texture upload to dirty-rectangle sub-upload. It failed the performance gate
  in `verify-out/perf-compose-backends-chaos-1781618054569.json`, worsening the
  cross-backend comparison to `compose +68.1%`, `render +52.5%`, and
  `frame +42.4%` versus WebGL2 GPU compose. That optimization was rolled back.
- The kept live path still passes the visual/button gate after rollback:
  `verify-out/webgpu-live-compose/probe-1781618193466.json` reports no
  console/page errors, actual WebGPU, bootstrap `WGSL` reload, runtime off/on
  toggle, and raw/post-FX visual deltas within tolerance.
- Decision: do not promote WebGPU compose. Keep the WebGPU live compose path as
  an explicit diagnostic toggle, keep WebGL2 GPU compose as production/default,
  and move the next performance work to Phase 5's resident GPU world mirror and
  upload-cost reduction rather than another small overlay upload tweak.

Remaining Phase 4 expected result:

- Same or better visual quality than WebGL2 GPU compose.
- Equal or better `compose + gl` cost than WebGL2 GPU compose on supported
  hardware.

Remaining Phase 4 acceptance gate:

- Existing compose parity scenarios pass against CPU reference and WebGL2 GPU
  compose reference.
- The parity matrix covers CPU, WebGL2 GPU compose, and WebGPU compose across
  post off/on, output transform, black-hole distortion, shockwaves, sprite
  overlay `setPx`/`addPx`, Sandbox, Builder Author, and Builder playtest.
- Same-session A/B shows WebGPU compose is not slower than WebGL2 GPU compose,
  or a documented visual-quality gain justifies a small cost.
- Builder and Sandbox both render through the WebGPU path without mode-specific
  assumptions.

Remaining Phase 4 rollback rule:

- If WebGPU compose cannot match the look or cannot beat WebGL2 compose after
  one focused tuning pass, keep the WebGL2 compose path as default and record the
  WebGPU compose attempt as failed for now.

## Phase 5 - GPU World Mirror and Dirty Uploads

Purpose: stop treating the GPU as a per-frame upload target and start treating
it as a resident mirror of visible/active world data.

Tasks:

- Add a `GpuWorldMirror` that tracks `types`, `colors`, `life`, `charge`, and
  optional derived planes needed by render/effects.
- Start with active-view or active-sim-window mirroring, then measure full-world
  mirroring.
- Use dirty rectangles/chunks where possible, but prove that dirty tracking
  costs less than simple uploads.
- Before any dirty-rect, row-span, or chunk upload path becomes default, add an
  authoritative mutation-invalidation contract. Either:
  - implement a mutation journal that covers `World.set`, `clearCell`, `swap`,
    direct typed-array writes, bulk writes, Builder imports/terrain edits,
    worldgen writes, mechanism writes, particle deposits, and simulation hot
    loops; or
  - keep full active-window uploads as the default until that journal exists.
- Add debug assertions comparing sampled CPU cells to GPU mirror contents via
  occasional non-frame-loop readback.
- Track dirty upload cost separately from CPU packing cost. Any dirty-rect,
  row-span, or chunk strategy must record touched-cell count, uploaded bytes,
  and CPU bookkeeping time so it can be compared against the simple upload path.
- Keep the first mirror one-way from CPU to GPU. Debug readback may sample cells
  outside the frame loop, but gameplay, saves, status checks, brewing,
  mechanisms, and collisions must continue to read the CPU `World`.

Expected result:

- Reduce CPU packing/upload cost for compose, lighting, and future effects.
- Keep CPU `World` authoritative.

Acceptance gate:

- `compose` bucket improves or remains flat while enabling later GPU lighting
  work.
- No frame-loop GPU readback.
- Random sampled cells match the CPU world in debug probes, and dirty upload
  validation includes adversarial changed-region checks rather than relying only
  on random sampling.

Rollback rule:

- If dirty tracking costs more than the upload it replaces, revert to simpler
  upload cadence and record the failed dirty-mirror attempt.

## Phase 6 - Lighting as Raw WGSL Compute

Purpose: move the half-resolution lighting rebuild into GPU compute and feed
the result directly to compose/post.

Tasks:

- Encode the current light attenuation and emissive seed rules from
  `Lighting.build` into GPU resources.
- Implement directional sweeps as WGSL compute passes over the half-res light
  field.
- Decompose compute into explicit passes before implementation: seed generation
  from materials/authored/entity lights, attenuation initialization, directional
  dependency sweeps, wand raycast lighting, flicker/random inputs, optional
  sprite-light bridge, and final field normalization for compose/post.
- Prefer raw WGSL for the directional sweep kernels if TSL control flow or
  storage access makes the dependency order hard to express. TSL wrappers are
  acceptable for binding and composition, but the sweep algorithm must remain
  readable and testable.
- Avoid per-frame CPU readback for timing or validation. Timestamp queries are
  optional; if unavailable, label measurements as CPU submit/wall-clock timing.
- Preserve authored lights, entity lights, material glow, charge glow, wand
  light behavior, and the current even-frame rebuild cadence unless a measured
  alternative wins.
- Keep a CPU-lighting fallback for WebGL and for sprite-lighting parity.
- Decide explicitly how CPU sprite lighting gets handled: temporary CPU mirror,
  CPU fallback for overlay lights, or moving more overlay drawing GPU-side.

Expected result:

- Lower CPU `compose`/render-side cost when lighting is heavy.
- More headroom for authored lights, glowing enemies, sparks, projectiles, and
  biome effects.

Acceptance gate:

- Lighting probe compares WebGPU light field against CPU field using tolerance
  bands and screenshot diffs.
- GPU timing is reported separately from CPU submit timing where supported
  through timestamp queries. Unsupported timing must be labeled clearly, and
  readbacks must stay out of frame-loop benchmarks.
- Heavy-light benchmark improves `compose` or `render` meaningfully without
  worsening `frame`.
- No visible loss in shadow readability, emissive self-glow, or bloom behavior.

Rollback rule:

- If GPU lighting is faster but visibly worse, attempt one quality fix. If it
  still fails, roll back. If it looks correct but is slower, roll back unless it
  unlocks a documented higher-light-count mode with clear qualitative benefit.

## Phase 7 - Visual-Only GPU Particles and Trails

Purpose: move high-volume cosmetic effects to GPU while keeping material
particles CPU-authoritative.

Tasks:

- Split particles into CPU material-depositing particles and GPU visual-only
  particles.
- Keep particles with `type !== null` on CPU until a later gameplay-authority
  plan exists.
- Implement GPU storage-buffer particle pools for sparks, embers, mist, portal
  motes, spell trails, rain/ash/snow, glow dust, and non-depositing debris.
- Render GPU particles via TSL point/sprite material or instanced quads.
- Add GPU particle light contribution either through the GPU light seed pass or
  through a separate emissive/bloom target.

Expected result:

- More simultaneous visual effects with lower CPU `entities`/`compose` cost and
  no additional world mutation complexity.

Acceptance gate:

- Stress scene supports a higher visual particle count at equal or lower frame
  time.
- Visual density improves or stays the same in screenshots/clips.
- Material-depositing particles still deposit real cells exactly as before.
- Regression tests prove `type === null` visual-only particles can move to the
  GPU path while material particles still deposit cells, homing coins still
  score, hostile/debris interactions still damage correctly, and CPU sprite
  lighting parity remains intact.

Rollback rule:

- If GPU particles reduce readability, break material deposits, or perform worse
  than optimized CPU particles after one tuning pass, keep the split design but
  disable the GPU renderer and record the failed attempt.

## Phase 8 - WebGPU Post-FX and High-End Visual Layer

Purpose: use WebGPU/TSL to add scalable effects that are expensive or awkward in
the current WebGL2 path.

Candidate effects:

- Selective emissive bloom using a dedicated emissive target.
- Heat haze driven by lava/fire/ember fields.
- Liquid shimmer and caustic hints from water/healium/teleportium.
- Volumetric-ish god rays/fog for biome identity, constrained to pixel-art
  readability.
- Screen-space lightning glow and shockwave distortion with lower CPU overhead.
- Optional temporal smoothing for noisy effects if it does not blur pixel art.

Expected result:

- Better visual richness at equal or lower frame time in effect-heavy scenes.

Acceptance gate:

- Each effect has an on/off A/B benchmark and screenshot/clip pair.
- Effects preserve gameplay readability: enemies, pickups, projectiles, exits,
  hazards, and dark-space silhouettes remain legible.
- Any effect that costs more must have a clear quality win and a tunable quality
  level.

Rollback rule:

- If an effect is pretty but hurts readability or performance and cannot be
  fixed quickly, remove it or leave it behind a debug-only flag with the failed
  benchmark recorded.

## Phase 9 - Compute-Assisted World Systems

Purpose: evaluate GPU compute for derived world fields before attempting any
GPU-authoritative sand simulation.

Candidate systems:

- Active-chunk and wake-mask generation.
- Heat/smoke/glow influence fields for rendering only.
- Electric field visualization and charge glow aggregation.
- Minimap/explored texture updates.
- Region/debug overlays for Builder and probes.

Expected result:

- Derived fields become cheaper or richer without creating CPU/GPU gameplay
  disagreement.

Acceptance gate:

- Each compute field avoids frame-loop readback.
- CPU game logic remains authoritative.
- Benchmark improves the targeted bucket or enables a documented visual/debug
  feature with negligible frame cost.

Rollback rule:

- If a derived field introduces sync bugs or readback stalls, remove it and
  record the failed attempt.

## Phase 10 - GPU Sand Simulation Research Only

Purpose: explore whether any slice of the cellular automata can move to compute
without breaking gameplay contracts.

This is intentionally last. The current sim has ordered swaps, moved epochs,
material-specific branching, projectile/world interactions, entity collision
queries, persistence, and nondeterministic row direction. A naive compute port
is likely to create correctness and synchronization problems.

Allowed experiments:

- GPU-only preview/sandbox sim that does not affect expedition saves.
- Isolated material family experiments, such as visual smoke/fog fields.
- Off-main-thread CPU/WASM active-chunk improvements as a comparison baseline.
- Hybrid chunk prototype where CPU owns gameplay chunks and GPU owns purely
  visual chunks.

Expected result:

- A clear yes/no answer for each sim slice, backed by benchmarks and correctness
  probes.

Acceptance gate:

- No gameplay feature depends on GPU sim until CPU/GPU authority, save format,
  determinism expectations, and rollback behavior are documented.
- Any accepted GPU sim slice must outperform CPU or enable materially better
  visuals without breaking cell authority.

Rollback rule:

- If a sim experiment is faster but changes gameplay semantics, roll it back.
  Record it as an attempted optimization that failed correctness/quality.

## File Map

Likely implementation surfaces:

| Area | Files |
|---|---|
| Dependency/API pin audit | `package.json`, `package-lock.json` if present |
| Backend boundary | `src/render/Renderer.ts`, `src/render/pixels.ts`, new backend files under `src/render/` |
| WebGPU compose | `src/render/ComposeShader.ts`, new WebGPU compose module, `src/render/FrameComposer.ts` |
| Post-FX | `src/render/PostFx.ts`, WebGPU render pipeline module, `src/ui/Inspector.ts` |
| Lighting compute | `src/render/Lighting.ts`, new WGSL/compute module |
| World mirror | `src/sim/World.ts`, `src/render/` GPU resource owner, debug probes |
| Particles | `src/particles/Particles.ts`, `src/render/sprites/FxSprites.ts`, new GPU particle module |
| Perf/probes | `src/ui/PerfHud.ts`, `scripts/perf-*.mjs`, `scripts/probe-*.mjs`, `verify-out/` |
| Config/types | `src/core/types.ts`, `src/config/params.ts`, console/inspector flag wiring |

## Recommended First PR Stack

1. Benchmark ledger and generic feature-flag A/B harness.
2. Three r184 API pin audit/spike, with a dependency upgrade only if required
   and no behavior change.
3. Renderer backend boundary with WebGL backend unchanged.
4. WebGPU presentation shell with nonblank canvas and post chain parity.
5. WebGPU compose parity against CPU and WebGL2 GPU compose.

Only after that stack is stable should GPU lighting and GPU particles start.
Those are the first phases that should materially expand the amount of visual
chaos the game can support.

## External API Notes

- Three's current WebGPU docs describe `WebGPURenderer` as the alternative to
  `WebGLRenderer`, with WebGPU first and WebGL2 fallback behavior:
  https://threejs.org/docs/pages/WebGPURenderer.html
- Three's current post-processing docs mark `EffectComposer` as WebGLRenderer
  only, so WebGPU post work should use the WebGPU/TSL render pipeline path, not
  the existing WebGL pass chain:
  https://threejs.org/docs/pages/EffectComposer.html
- Three's current ShaderMaterial docs mark `ShaderMaterial` as WebGLRenderer
  only, so current GLSL compose code must be ported to TSL/WGSL for WebGPU:
  https://threejs.org/docs/pages/ShaderMaterial.html
- MDN currently describes WebGPU as secure-context-only and not universally
  available, so fallback and device-loss handling are part of the plan, not
  optional cleanup:
  https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API

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

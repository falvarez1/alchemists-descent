# WebGPU, TSL, and WGSL Compute Implementation Plan

Status: in progress. Phases 0-2 are implemented and benchmark-gated. Phase 3
is implemented as a boot-gated diagnostic shell with documented presentation
warnings; it is not promoted as the default renderer. Phase 4 has started with
the compose ABI/limit contract in `docs/WEBGPU-COMPOSE-ABI.md`; the WebGPU
compose shader port remains pending.

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

Expected result:

- Same or better visual quality than WebGL2 GPU compose.
- Equal or better `compose + gl` cost than WebGL2 GPU compose on supported
  hardware.

Acceptance gate:

- Existing compose parity scenarios pass against CPU reference and WebGL2 GPU
  compose reference.
- The parity matrix covers CPU, WebGL2 GPU compose, and WebGPU compose across
  post off/on, output transform, black-hole distortion, shockwaves, sprite
  overlay `setPx`/`addPx`, Sandbox, Builder Author, and Builder playtest.
- Same-session A/B shows WebGPU compose is not slower than WebGL2 GPU compose,
  or a documented visual-quality gain justifies a small cost.
- Builder and Sandbox both render through the WebGPU path without mode-specific
  assumptions.

Rollback rule:

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

# Noita-Like Virtual Worldgen Prototype Plan

Date: 2026-06-14

This plan scopes a prototype for replacing the current fixed-size, per-depth
world generator with a Noita-like virtual world pipeline: chunked generation,
biome-map driven macro layout, herringbone/Wang tile topology, and pixel-scene
stamping. The goal is not to ship the full world rewrite in one pass; the goal
is to prove the hard architectural seams with a small, measurable slice that can
coexist with the current `WorldGen.generateLevel()` path.

## References

- Herringbone Wang Tiles: https://nothings.org/gamedev/herringbone/herringbone_tiles.html
- More Herringbone Wang Tiles: https://nothings.org/gamedev/herringbone/more_herringbone_tiles.html
- Noita World Maker README: https://gitlab.com/alter_ukko/noita-world-maker/-/blob/main/README.md
- NoitaMap reference viewer: https://noitamap.com/
- MDN WebGPU API: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- MDN GPUSupportedLimits: https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits
- W3C WGSL: https://www.w3.org/TR/WGSL/
- MDN WebAssembly: https://developer.mozilla.org/en-US/docs/WebAssembly
- Emscripten pthreads: https://emscripten.org/docs/porting/pthreads.html
- Emscripten SIMD: https://emscripten.org/docs/porting/simd.html
- web.dev Wasm threads: https://web.dev/articles/webassembly-threads
- MDN SharedArrayBuffer: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer

## Current Repo Baseline

The existing system is optimized around one fixed-size level at a time:

- `src/config/constants.ts` defines `WIDTH = 1600`, `HEIGHT = 1064`.
- `src/sim/World.ts` stores one whole world in flat typed arrays.
- `src/world/CaveGenerator.ts` writes directly into the active `World`.
- `src/game/Levels.ts` swaps entire `World` instances between depths.
- `src/builder/Builder.ts` now exposes generation controls, but still edits a
  single `EditorDocument` / live `World`.
- `src/world/prefabs/place.ts` already gives us the right direction for local
  authored content: reusable terrain + objects + links + lights stamped into
  generated terrain.

The prototype must respect that baseline. It should add a virtual-world layer
beside the current generator, not force every renderer, sim, and Builder path to
be chunk-aware immediately.

## Prototype Goals

1. Generate a deterministic virtual world from global coordinates.
2. Support random access chunk generation: any chunk can be generated without
   generating previous chunks.
3. Assemble cave topology from a small herringbone/Wang tile set.
4. Paint biome-driven materials and colors at chunk scale.
5. Stamp pixel scenes that can cross chunk boundaries.
6. Provide a Builder world preview where designers can pan, zoom, inspect
   chunks, and regenerate from a seed.
7. Benchmark CPU TypeScript worker generation, optional Wasm kernels, and
   optional WebGPU kernels with the same test fixtures.
8. Keep the current game playable while this work is gated behind prototype
   flags and Builder tools.

## Non-Goals For This Prototype

- Full replacement of `Levels` transitions.
- Persistent global expedition saves.
- Chunk-aware live falling-sand simulation.
- Infinite vertical world generation.
- Full Noita material parity.
- Production-quality herringbone tile art library.
- Shipping WebGPU/Wasm as mandatory dependencies.

## Success Criteria

The prototype is successful when:

- A `3x3` chunk window can be generated around an arbitrary global coordinate.
- Re-generating the same chunk with the same seed produces byte-identical cell
  types and colors.
- Adjacent chunk borders match with no visible seams in terrain topology.
- At least one pixel scene stamps across a chunk boundary and round-trips into
  the preview correctly.
- The Builder has a world preview panel that can pan smoothly and regenerate the
  active window without blocking the UI thread.
- Benchmarks report generation time per chunk, p95 preview latency, memory per
  cached chunk, and cost of each backend.
- TypeScript worker generation is the required baseline. WebGPU and Wasm are
  measured, optional accelerators.

## Technical Research Summary

### WebGPU

WebGPU gives browser code access to a logical GPU device through
`navigator.gpu` or `WorkerNavigator.gpu`, supports compute pipelines, and uses
WGSL shaders. MDN still marks WebGPU as not Baseline because support is not
universal, and it requires secure context usage. WebGPU can be used in Web
Workers where supported.

Relevant constraints for this prototype:

- Compute shaders are good for bulk, regular, parallel work.
- Storage buffers are the right primitive for generated typed-array data.
- Default minimum `maxStorageBufferBindingSize` is 128 MB and `maxBufferSize` is
  256 MB according to MDN's WebGPU limits table, but adapters can expose
  different tiered limits. Query limits at runtime.
- Reading GPU results back to JavaScript requires copying to a map-readable
  staging buffer and calling `mapAsync()`. While a buffer is mapped, it cannot be
  used in GPU commands.
- WebGPU validation is asynchronous, so prototype code needs explicit error
  scopes and fallback behavior.

Recommended use in this prototype:

- Good fit: world-map overview rendering, chunk preview texture generation,
  large batched analysis where results stay as textures, optional offline tile
  validation heatmaps.
- Risky fit: per-camera chunk generation when the CPU immediately needs the full
  cell arrays for simulation. GPU readback can become the bottleneck.
- Do not make WebGPU mandatory. Treat it as `BackendKind = 'webgpu'` in the
  benchmark harness and Builder preview.

### WebAssembly

WebAssembly is a compact low-level target that runs near native speed and
integrates with JavaScript. Emscripten supports WebAssembly SIMD with
`-msimd128`; its docs list support in Chrome 91+, Firefox 89+, Safari 16.4+,
and Node 16.4+. Emscripten pthreads use `SharedArrayBuffer` and Web Workers.

Important constraints:

- Threads require cross-origin isolation: COOP/COEP headers and secure context.
- Emscripten cannot produce one binary that transparently uses pthreads when
  available and falls back to non-threaded otherwise; it recommends separate
  builds.
- Shared memory requires `crossOriginIsolated`; otherwise the app must fall back
  to normal `ArrayBuffer` transfer/copy.
- Wasm is most valuable when kernels are large, tight loops over typed memory:
  noise fields, cellular automata, morphology, flood fill, border classification,
  and hash-heavy tile lookup.

Recommended use in this prototype:

- Start with TypeScript workers. Only add Wasm after the benchmark harness shows
  a real CPU bottleneck.
- If used, start with a single-threaded C or Rust Wasm module plus SIMD.
- Add pthreads only after the app can serve COOP/COEP headers in dev and deploy.
- Keep TypeScript reference implementations for determinism tests and fallback.

## Backend Decision Matrix

| Workload | TypeScript Worker | Wasm SIMD | Wasm Threads | WebGPU |
| --- | --- | --- | --- | --- |
| Chunk tile selection | Best first step | Possible but probably unnecessary | Not needed | Not worth readback |
| Value/fbm noise field | Good baseline | Good candidate | Maybe later | Good if output stays GPU-side |
| Cellular automata smoothing | Good baseline | Strong candidate | Maybe later | Good for batch, readback risk |
| Flood fill / connectivity | Good baseline | Strong candidate | Possible | Poor fit unless reformulated |
| Pixel-scene stamping | Good baseline | Possible | Not needed | Poor fit if CPU needs cells |
| Builder overview/minimap | Good enough initially | Not needed | Not needed | Strong candidate |
| Validation heatmaps | Good baseline | Possible | Possible | Strong if visual only |
| Runtime sim | Existing CPU path | Future work | Future work | Not prototype scope |

Prototype policy:

1. Implement TypeScript worker backend first.
2. Design backend interfaces so Wasm/WebGPU can be plugged in.
3. Add WebGPU only for preview/analysis after the CPU backend is correct.
4. Add Wasm only for measured hot kernels.

## Proposed Prototype Architecture

Add a new folder:

```text
src/world/virtual/
  VirtualWorld.ts
  VirtualChunk.ts
  VirtualWorldDef.ts
  ChunkCache.ts
  ChunkGenerator.ts
  BiomeMap.ts
  HerringboneTiles.ts
  PixelScene.ts
  PixelSceneStamper.ts
  WindowMaterializer.ts
  backends/
    BackendTypes.ts
    TsWorkerBackend.ts
    worldgen.worker.ts
    WebGpuBackend.ts
    WasmBackend.ts
  debug/
    hash.ts
    metrics.ts
```

Add Builder UI modules:

```text
src/builder/world/
  WorldPreviewPanel.ts
  WorldMapCanvas.ts
  ChunkInspectorPanel.ts
  HerringboneTilesPanel.ts
  PixelScenePanel.ts
```

Add tests:

```text
tests/virtual-world.test.ts
tests/herringbone-tiles.test.ts
tests/pixel-scenes.test.ts
tests/world-backends.test.ts
```

Add scripts:

```text
scripts/bench-virtual-world.mjs
scripts/verify-virtual-world.mjs
scripts/shot-virtual-world.mjs
```

## Core Data Model

### VirtualWorldDef

```ts
export interface VirtualWorldDef {
  v: 1;
  id: string;
  name: string;
  seed: number;
  chunkSize: 256;
  biomeChunkSize: 512;
  herringboneCellSize: 256;
  map: BiomeMapDef;
  tileset: HerringboneTilesetDef;
  pixelScenes: PixelScenePlacementDef[];
  materialProfile: VirtualMaterialProfile;
  generation: VirtualGenerationParams;
}
```

### VirtualChunk

```ts
export interface VirtualChunk {
  cx: number;
  cy: number;
  originX: number;
  originY: number;
  size: number;
  types: Uint8Array;
  colors: Uint32Array;
  life: Int16Array;
  charge: Uint8Array;
  meta: ChunkMeta;
}
```

`VirtualChunk` intentionally mirrors `World`'s cell planes so integration can
reuse existing cell logic and render composition later.

### BiomeMapDef

```ts
export interface BiomeMapDef {
  widthChunks: number;
  heightChunks: number;
  originChunkX: number;
  originChunkY: number;
  cells: Uint8Array; // biome id per 512x512 world block
}
```

Noita World Maker describes one biome-map pixel per `512x512` world chunk. Use
that as the prototype convention, even if runtime chunks are `256x256`. One
biome-map cell therefore covers four runtime chunks.

### HerringboneTilesetDef

```ts
export interface HerringboneTilesetDef {
  v: 1;
  tileSize: number;
  constraints: {
    edgeColors: string[];
    vertexColors: string[];
  };
  tiles: HerringboneTileDef[];
}

export interface HerringboneTileDef {
  id: string;
  orientation: 'horizontal' | 'vertical';
  biomeTags: string[];
  weight: number;
  edges: { n: string; e: string; s: string; w: string };
  vertices: { nw: string; ne: string; se: string; sw: string };
  carve: TileCarveInstruction[];
  sceneSlots: TileSceneSlot[];
}
```

The prototype should use procedural `carve` instructions, not art-heavy tile
bitmaps. This keeps the first tileset small and makes validation easier.

### PixelSceneDef

```ts
export interface PixelSceneDef {
  v: 1;
  id: string;
  name: string;
  w: number;
  h: number;
  material: Uint8Array;       // cell id per pixel, 0 = transparent/no-op
  colorOverrides?: Uint32Array;
  visual?: Uint8ClampedArray; // RGBA visual-only overlay, future renderer path
  background?: Uint8ClampedArray;
  objects: EditorObject[];
  links: EditorLink[];
  lights: EditorLight[];
}
```

The current prefab contract can be adapted, but pixel scenes should preserve
Noita's explicit layer split:

- Material layer changes the simulated world.
- Visual layer is non-sim foreground art.
- Background layer is non-sim background art.
- Objects compile into runtime/editor markers.

For the prototype, only the material layer and marker overlay need to work.

## Deterministic Coordinate Strategy

All virtual generation must be random-access. Do not carry one RNG stream across
the world.

Use stable coordinate hashes:

```ts
hashSeed(worldSeed, `chunk:${cx}:${cy}:terrain`)
hashSeed(worldSeed, `tile:${tx}:${ty}:constraint`)
hashSeed(worldSeed, `scene:${sceneId}:${placementX}:${placementY}`)
```

Rules:

- No `Math.random()`.
- No dependency on iteration order for final output.
- No chunk reads outside a bounded halo unless routed through deterministic
  neighbor generation.
- Every test seed must generate identical hashes across runs.

## Chunk Generation Pipeline

For a requested chunk `(cx, cy)`:

1. Resolve world bounds and biome-map cell.
2. Resolve herringbone macro tile coverage for the chunk plus one-tile halo.
3. Initialize chunk as solid rock or biome default material.
4. Apply tile carve instructions that overlap the chunk.
5. Apply fine noise displacement and erosion.
6. Run local smoothing / morphology within a halo buffer.
7. Paint material bands and colors.
8. Stamp pixel scenes overlapping the chunk.
9. Run seam-safe terrain polish.
10. Emit `VirtualChunk` plus metrics.

Important: generation should happen in a scratch buffer with halo margins:

```text
scratch = chunkSize + 2 * halo
halo    = max(tileCarveRadius, polishRadius, pixelSceneBorderNeed)
```

Then crop the center chunk. This avoids CA and polish differences at chunk
borders.

## Herringbone Prototype Scope

Use a deliberately tiny tileset:

- 8 horizontal tiles.
- 8 vertical tiles.
- 4 edge colors: `open`, `narrow`, `wall`, `drop`.
- 3 vertex colors: `solid`, `junction`, `void`.
- Biome tags: `earthen`, `fungal`, `frozen`.

Carve instruction examples:

```ts
{ kind: 'spline', from: 'w', to: 'e', radius: 12, jitter: 18 }
{ kind: 'spline', from: 'n', to: 's', radius: 10, jitter: 10 }
{ kind: 'chamber', x: 0.5, y: 0.5, rx: 46, ry: 28 }
{ kind: 'shaft', x: 0.65, radius: 9, roughness: 0.35 }
```

Validation:

- Every edge/vertex constraint used by coordinate hashing has at least one tile.
- Horizontal/vertical tile overlap rules are deterministic.
- Generated adjacent tile edges agree.
- No tile has entrances narrower than the player clearance requirement unless
  tagged as crawl-only.

## Pixel Scene Prototype Scope

Create three built-in test scenes:

1. `scene-spawn-pocket`: material layer + spawn marker.
2. `scene-wood-bridge`: material cells crossing a cave gap.
3. `scene-boundary-ruin`: intentionally placed across four chunks.

Placement rules:

- Scene coordinates are global world coordinates.
- Stamping uses intersection math per chunk.
- Transparent material pixels are no-ops.
- Scene material overrides win over procedural terrain except protected cells.
- Scene objects/lights are exposed in the preview inspector, but runtime compile
  can be deferred.

## Builder Prototype UX

Add a new Builder workspace panel: `WORLD MAP`.

Minimum UI:

- Seed field.
- Backend selector: `TS Worker`, `WebGPU Preview`, `Wasm` disabled until built.
- Coordinate readout.
- Chunk grid overlay toggle.
- Biome-map overlay toggle.
- Herringbone tile overlay toggle.
- Pixel-scene overlay toggle.
- `Generate Window` button.
- `Re-roll Seed` button.
- `Frame Origin` button.
- `Play From Here` disabled with tooltip/status until runtime integration.
- Chunk inspector: chunk id, biome, tile ids, generation time, hash.
- Scene inspector: placements overlapping selected chunk.

Canvas interactions:

- Middle mouse / space drag pans.
- Wheel zooms.
- Click selects chunk.
- Double click frames chunk.
- Shift-click sets prototype player start marker.

Professional-editor expectations:

- No modal tutorials.
- Dense controls, clear labels, stable dimensions.
- The panel must remain responsive while generation runs.
- Pending generation jobs are cancelable when the user pans away.

## Worker Backend Plan

The TypeScript worker backend is the reference implementation.

Message protocol:

```ts
type WorkerRequest =
  | { kind: 'generateChunk'; jobId: number; def: SerializedVirtualWorldDef; cx: number; cy: number }
  | { kind: 'generateWindow'; jobId: number; def: SerializedVirtualWorldDef; cx0: number; cy0: number; cx1: number; cy1: number }
  | { kind: 'cancel'; jobId: number };

type WorkerResponse =
  | { kind: 'chunk'; jobId: number; chunk: TransferableVirtualChunk; metrics: ChunkMetrics }
  | { kind: 'windowDone'; jobId: number; metrics: WindowMetrics }
  | { kind: 'error'; jobId: number; message: string; stack?: string };
```

Transfer ownership of `ArrayBuffer`s for chunk planes. Do not copy large arrays
through structured clone.

Scheduling:

- Maintain a job generation counter.
- Drop stale responses from older generations.
- Prioritize chunks nearest preview center.
- Cap in-flight jobs to `min(4, navigator.hardwareConcurrency - 1)`.
- Use one worker initially; add a pool only after metrics say it helps.

## WebGPU Prototype Plan

WebGPU should be an accelerator backend, not the correctness baseline.

Add:

```text
src/world/virtual/backends/WebGpuBackend.ts
src/world/virtual/backends/shaders/noise.wgsl
src/world/virtual/backends/shaders/preview.wgsl
```

Phase 1 WebGPU work:

- Detect `navigator.gpu`.
- Request adapter/device.
- Query limits and store them in `GpuBackendInfo`.
- Build a proof shader that writes a deterministic noise preview texture for a
  selected chunk.
- Render the preview texture directly in the Builder world map.

Phase 2 WebGPU work:

- Generate biome/noise/height masks for a whole preview window.
- Keep results GPU-resident for the map canvas.
- Only read back small debug statistics, not full chunks.

Avoid in prototype:

- GPU-only authoritative cell generation.
- Per-frame readbacks.
- GPU chunk generation feeding the current CPU simulation path.

If full GPU chunk generation is still desired later, require a benchmark that
shows:

- GPU generation + readback beats TS worker generation for `9` and `25` chunks.
- Readback does not cause visible UI or frame hitches.
- Results match the TypeScript reference hash or are explicitly accepted as a
  visual-only approximation.

## Wasm Prototype Plan

Use Wasm only after the TypeScript worker establishes correct behavior.

Candidate kernels:

- `fill_noise_u8`
- `smooth_ca_u8`
- `distance_to_air_u8`
- `flood_fill_labels_u8`
- `morph_close_u8`
- `paint_bands_u32`

Recommended first implementation:

- C or Rust single-threaded Wasm.
- Linear memory input/output over typed arrays.
- Build two artifacts only when threads become necessary:
  - `worldgen.wasm` single-thread fallback.
  - `worldgen-pthread.wasm` threaded build.

Tooling options:

- Emscripten C/C++ is practical for SIMD/pthreads and has clear browser docs.
- Rust + `wasm-pack` is ergonomic for TypeScript integration but pthreads are
  more involved.

Initial recommendation: do not introduce Rust/C toolchains until benchmark data
justifies it. The prototype can define `WasmBackend` as a stub interface first.

Cross-origin isolation requirements:

- Add dev-server headers only when threaded Wasm is enabled:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- Confirm `self.crossOriginIsolated`.
- Ensure workers and Wasm assets are served with compatible headers.
- Keep non-threaded fallback because embedded/hosted environments may not allow
  isolation headers.

## Integration With Existing World

Prototype integration should be preview-first:

1. Generate virtual chunks in Builder only.
2. Materialize selected windows into a temporary `World` for visual comparison.
3. Add `WindowMaterializer` to copy chunks into an existing `World`-shaped buffer.
4. Only after this is stable, add a playtest mode that treats the materialized
   window as a custom level.

`WindowMaterializer`:

```ts
export interface MaterializedWindow {
  world: World;
  originX: number;
  originY: number;
  chunks: Array<{ cx: number; cy: number; hash: string }>;
}
```

This lets current renderer/sim code remain mostly untouched during the
prototype. The downside is that player movement is bounded by the materialized
window; that is acceptable for prototype validation.

## Testing Plan

Unit tests:

- Same seed/chunk -> same hash.
- Different seed -> different hash.
- Adjacent chunks have identical overlapping halo-derived borders.
- Herringbone tile constraint resolver never returns no tile for valid inputs.
- Pixel scene crossing a chunk boundary produces identical cells independent of
  generation order.
- Biome map coordinate conversion is correct around negative world coordinates.

Golden tests:

- Lock hashes for a small set of chunks:
  - `(0, 0)`
  - `(1, 0)`
  - `(-1, 2)`
  - `(7, -3)`
- Golden image for a `3x3` preview window.

Performance tests:

- `scripts/bench-virtual-world.mjs --backend ts --chunks 9`
- `scripts/bench-virtual-world.mjs --backend ts --chunks 25`
- Future:
  - `--backend webgpu`
  - `--backend wasm`

Metrics:

- total ms
- ms per chunk
- p50/p95 chunk time
- memory per cached chunk
- transfer time from worker
- render preview upload time
- stale/canceled job count

Verification:

- `npm test -- virtual-world`
- `node scripts/verify-virtual-world.mjs`
- `node scripts/shot-virtual-world.mjs`

## Performance Budgets

Initial budgets on a typical desktop:

- Generate `1` chunk in TS worker: under `8 ms`.
- Generate `3x3` window: under `75 ms`.
- Pan preview with cached chunks: under `16 ms` frame impact.
- Worker response transfer per chunk: under `2 ms`.
- Chunk memory:
  - `types`: 65,536 bytes for `256x256`.
  - `colors`: 262,144 bytes.
  - `life`: 131,072 bytes.
  - `charge`: 65,536 bytes.
  - total raw: about 512 KB per chunk before metadata.
- Cache `9x9` chunks: about 41 MB raw. Use lower cache during prototype if
  browser memory pressure is visible.

Mobile/laptop budgets can be added after the desktop baseline works.

## Implementation Phases

### Phase 0 - Scaffold And Feature Flag

Deliverables:

- `VirtualWorldDef` and supporting types.
- `virtualWorld.enabled` feature flag.
- Empty Builder panel behind command/panel registry.
- Test stubs.

Acceptance:

- App boots unchanged with the flag off.
- Builder command opens an empty World Map panel with no side effects.

### Phase 1 - Deterministic Chunk Model

Deliverables:

- `VirtualChunk`.
- `ChunkCache`.
- Coordinate conversion utilities.
- Deterministic hash helpers.
- Synchronous TypeScript chunk generator that fills simple rock/air noise.

Acceptance:

- Unit tests prove determinism and negative-coordinate correctness.
- A script can print chunk hashes for a seed.

### Phase 2 - Worker Backend

Deliverables:

- `worldgen.worker.ts`.
- `TsWorkerBackend`.
- Transferable chunk responses.
- Job cancellation/drop-stale logic.

Acceptance:

- Builder can request a `3x3` window without blocking main thread.
- Benchmark script reports generation and transfer timings.

### Phase 3 - Herringbone Tile Topology

Deliverables:

- Minimal built-in herringbone tileset.
- Constraint resolver.
- Tile carve instruction executor.
- Tile overlay debug data.

Acceptance:

- Adjacent chunks match at borders.
- Builder chunk inspector lists tile ids and constraints.
- Tests cover missing/invalid constraint combinations.

### Phase 4 - Biome Map

Deliverables:

- `BiomeMapDef`.
- Built-in small biome map.
- Biome color/material mapping.
- Builder overlay and biome inspector.

Acceptance:

- Changing a biome map cell changes generated material palette for affected
  chunks.
- Biome map coordinates follow Noita-like 512-cell block semantics.

### Phase 5 - Pixel Scene Stamping

Deliverables:

- `PixelSceneDef`.
- Three built-in test scenes.
- Multi-chunk scene stamping.
- Scene overlay in Builder world map.

Acceptance:

- Boundary scene stamps identically regardless of chunk generation order.
- Chunk inspector lists overlapping scenes.

### Phase 6 - Window Materializer

Deliverables:

- `WindowMaterializer`.
- Copy generated chunks into a normal `World`.
- Preview mode that renders materialized terrain using existing renderer path
  where practical, or a Builder-owned canvas fallback.

Acceptance:

- Selected `3x3` virtual window can be rendered as current game terrain.
- Existing non-virtual gameplay remains unaffected.

### Phase 7 - Validation And Polish

Deliverables:

- Seam validator.
- Player clearance validator.
- Connected-region preview.
- Terrain polish adapted to chunk windows.

Acceptance:

- Validation panel reports border mismatches, too-tight corridors, and isolated
  regions.
- Reports link directly to world/chunk coordinates in the preview.

### Phase 8 - WebGPU Preview Backend

Deliverables:

- WebGPU feature detection.
- Adapter/device limit readout.
- Noise/preview WGSL proof.
- GPU-generated visual preview path.

Acceptance:

- If WebGPU is unavailable, UI falls back cleanly.
- If available, Builder can show a GPU preview and report adapter limits.
- No full chunk CPU readback is required in this phase.

### Phase 9 - Wasm Spike

Deliverables:

- Backend interface finalized for kernel replacement.
- One candidate kernel implemented in Wasm, likely CA smoothing or noise fill.
- Benchmarks compare TS worker vs Wasm.

Acceptance:

- Wasm output matches TypeScript reference for fixed seeds.
- Wasm is retained only if it shows meaningful speedup in measured workloads.

### Phase 10 - Prototype Playtest

Deliverables:

- `Play From Here` materializes a bounded virtual window as a custom runtime.
- Player start marker in Builder world map.
- Camera starts at global coordinate mapped to materialized window local coords.

Acceptance:

- Designer can preview, pick a global position, and play a bounded generated
  section.
- UI makes the temporary bounds clear.

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Chunk border seams | Breaks world illusion | Halo generation and seam tests from Phase 1 |
| WebGPU readback stalls | Performance regression | Keep WebGPU visual-first until benchmarks prove otherwise |
| Wasm toolchain churn | Build complexity | Delay Wasm until measured need; keep TS fallback |
| Cross-origin isolation breaks assets | Dev/deploy friction | Only require COOP/COEP for threaded Wasm, not baseline |
| Builder UI scope creep | Prototype stalls | Start with world preview + inspector, defer editing niceties |
| Current `World` assumptions | Runtime rewrite grows too large | Materialize windows into existing `World` first |
| Herringbone tile completeness | Resolver dead ends | Tileset validator and small complete built-in set |
| Pixel scene ordering conflicts | Non-deterministic output | Stable scene sort by priority/id/global coords |

## First Implementation Ticket Breakdown

1. Add `VirtualWorldDef`, `VirtualChunk`, coordinate utilities, and hash tests.
2. Add synchronous noise chunk generator and chunk hash script.
3. Add worker backend and `generateWindow`.
4. Add hidden Builder World Map panel with seed/backend controls.
5. Draw generated chunks in a Builder-owned canvas.
6. Add herringbone tile definitions and resolver tests.
7. Replace simple noise caves with tile-carved caves.
8. Add biome-map lookup and material palette pass.
9. Add one pixel scene crossing chunk boundaries.
10. Add benchmarks and golden hashes.

## Recommended Initial Defaults

```ts
chunkSize = 256;
biomeChunkSize = 512;
herringboneCellSize = 256;
windowRadiusChunks = 1; // 3x3
halo = 32;
cacheRadiusChunks = 3; // 7x7 during prototype
workerCount = 1;
seed = 0x4e4f4954; // "NOIT"
```

Keep these conservative until correctness and UI behavior are stable.

## Open Questions

- Should virtual worlds become `EditorDocument` assets, or a new document kind?
- Should pixel scenes reuse `PrefabDef` storage exactly, or migrate prefabs into
  the richer three-layer `PixelSceneDef`?
- Should the biome-map editor be part of Builder immediately, or read-only until
  generation correctness is proven?
- How large should authored world maps be for the actual game: Noita-scale, or a
  smaller handcrafted descent with optional infinite branches?
- When the runtime becomes chunk-aware, do we keep per-depth identity as named
  regions or remove depth ids entirely?

## Recommended Next Step

Start with Phases 0-2. Do not touch `Levels`, `Simulation`, or renderer
contracts yet. A deterministic, worker-generated `3x3` chunk preview will give
us the information needed to make the next architectural decisions without
destabilizing the current game.

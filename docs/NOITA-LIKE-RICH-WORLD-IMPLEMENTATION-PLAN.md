# Noita-Like Rich World Implementation Plan

## Objective

Build the chunked world prototype into a rich, Noita-like world-generation pipeline where each biome produces distinct terrain, materials, hazards, vegetation, lights, and authored-feeling setpieces. The Builder must make world generation a first-class workflow: designers can select a level/profile, tune generation and dressing parameters visually, preview chunks while panning, and launch a playtest from the same generated data.

## Design Principles

- Generate content deterministically from world seed and world coordinates.
- Keep dense decoration cell-native, baked into generated chunks, not runtime overlay sprites.
- Use sparse runtime lights/decors only for content that truly needs animation or authored behavior.
- Put all tunable configuration on `VirtualWorldDef` so Builder preview, worker generation, and playtest use one data path.
- Preserve chunk seams by using halo-aware coordinate-hash generation.
- Treat the campaign `CaveGenerator` path separately because changes affect saves, golden hashes, and restore parity.
- Prefer built-in content for campaign generation. Project-local Builder assets must not silently become campaign dependencies.

## Phases

### Phase 1: Virtual Biome Dressing Foundation

Targets:

- `src/world/virtual/types.ts`
- `src/world/virtual/defaults.ts`
- `src/world/virtual/ChunkGenerator.ts`
- `src/builder/virtualWorldPanel.ts`
- `tests/virtual-world.test.ts`

Tasks:

- Add a `VirtualDressingProfile` to `VirtualWorldDef`.
- Define global dressing controls for material richness, liquid richness, glow density, floor debris, hanging growth, and overall detail.
- Define per-biome recipes for ore/secondary materials, liquid pockets, glow accents, rubble, and hanging growth.
- Add chunk-time dressing passes after terrain shaping and surface caps.
- Keep the pass deterministic, bounded, halo-aware, and cell-native.
- Expose the new controls in the Builder World Map panel.
- Add tests for determinism, biome distinction, dressing controls, and generated material presence.

Review checkpoint:

- Senior tools review: Builder data flow and UX.
- Senior engine review: generation cost, determinism, chunk seams, and runtime cost.

### Phase 2: Pixel Scene Stamp Expansion

Targets:

- `src/world/virtual/PixelSceneStamper.ts`
- `src/world/virtual/defaults.ts`
- `src/world/virtual/WindowMaterializer.ts`
- `src/game/Levels.ts`
- `src/builder/virtualWorldPanel.ts`

Tasks:

- Add a built-in library of small pixel scenes: timber braces, ruined rooms, bridge fragments, shrines, fungal pockets, crystal clusters, lava vents, and collapsed shafts.
- Add scene placement budgets to `VirtualDressingProfile`.
- Stamp scenes by biome and herringbone tile slot.
- Preserve or explicitly reject scene `objects`, `lights`, `life`, and `charge` until runtime materialization supports them.
- Show scene markers and scene lists in the Builder inspector.

Review checkpoint:

- Tools review for scene discoverability and editability.
- Engine review for transfer size and preview cache pressure.

### Phase 3: Runtime Content Materialization

Targets:

- `src/world/virtual/types.ts`
- `src/world/virtual/WindowMaterializer.ts`
- `src/game/Levels.ts`
- `src/game/runtime.ts`
- `src/render/Lighting.ts`

Tasks:

- Extend virtual chunks with sparse metadata for authored lights and gameplay objects.
- Materialize only in-window metadata into `LevelRuntime`.
- Cap generated authored lights and animated decors per window.
- Add create-vs-playtest parity tests.
- Ensure Builder Play Window receives the same colors, cells, lights, and props visible in preview.

Review checkpoint:

- Performance review with dense-content stress tests.
- Gameplay review for readability and player path safety.

### Phase 4: Builder World Generation UX

Targets:

- `src/builder/virtualWorldPanel.ts`
- `src/styles/main.css`
- `src/builder/assetBrowserPanel.ts`
- `src/builder/assets/AssetDatabase.ts`

Tasks:

- Split controls into Skeleton, Surface, Dressing, Materials, Lighting, Scenes, and Playtest sections.
- Add profile comparison and reset controls.
- Add live stats for material counts, glow cell counts, liquid cells, scene count, and generation cost.
- Add presets as immutable built-in assets.
- Add export/import of world-generation profiles.

Review checkpoint:

- Product/editor UX review.
- Accessibility and keyboard workflow review.

### Phase 5: Campaign Integration

Targets:

- `src/world/CaveGenerator.ts`
- `src/world/biomeExtras.ts`
- `src/config/gen.ts`
- `src/game/Levels.ts`
- `tests/gen-golden.test.ts`
- `tests/levels-persistence.test.ts`

Tasks:

- Move campaign biome extras toward the same recipe vocabulary without changing stream order accidentally.
- Use forked RNG streams for optional dressing.
- Respect spawn, well, waystone, prefab, machine, and structure reservations.
- Bump `GEN_VERSION` only for deliberate campaign output changes.
- Add restore parity tests for generated lights/content.
- Run golden generation and findability verification.

Review checkpoint:

- Save/restore correctness review.
- Gameplay/findability review.

### Phase 6: Heavy-Compute Backends

Targets:

- `src/world/virtual/backends/WebGpuPreviewBackend.ts`
- `src/world/virtual/backends/WasmBackend.ts`
- `docs/WEBGPU-TSL-COMPUTE-IMPLEMENTATION-PLAN.md`
- `scripts/bench-virtual-world.mjs`

Tasks:

- Keep TypeScript worker as the authoritative reference path.
- Prototype WebGPU preview acceleration for visual-only chunk preview.
- Prototype WASM kernels for hot cellular and morphology passes.
- Compare cost against the TypeScript worker before adopting.
- Keep fallback behavior identical.

Review checkpoint:

- Engine performance review with benchmark ledger updates.
- Portability review for WebGPU availability and fallback behavior.

## Validation Matrix

- `npx vitest run tests/virtual-world.test.ts`
- `npm run typecheck`
- `node scripts/bench-virtual-world.mjs <seed> <radius> <repeats>`
- `npm run verify:findability` after campaign changes
- `npm run perf:scene` after adding runtime decors/lights
- Builder visual checks: pan/zoom preview, generate, reset, profile switching, Play Window

## First Implementation Slice

Phase 1 is the first slice. It intentionally avoids campaign `CaveGenerator` changes so the existing save/golden-generation contract stays stable while the chunked-world prototype gains richer biome-specific output.

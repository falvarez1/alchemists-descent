# Noita-Like Rich World Implementation Plan

Last updated: 2026-06-16

## Objective

Build the chunked world prototype into a rich, Noita-like world-generation pipeline where each biome produces distinct terrain, materials, hazards, vegetation, lights, and authored-feeling setpieces. The Builder must make world generation a first-class workflow: designers can select a level/profile, tune generation and dressing parameters visually, preview chunks while panning, select generated setpieces, and launch a playtest from the same generated data.

## Current Status Summary

This plan is no longer just a proposal. Phases 1-4 are substantially implemented. Phase 5 is partially implemented but still needs a deliberate campaign-parity pass. Phase 6 is still pending except for interface stubs and benchmark/probe groundwork.

| Phase | Status | Practical Meaning |
| --- | --- | --- |
| Phase 1: Virtual Biome Dressing Foundation | Mostly complete | `VirtualWorldDef` has dressing controls and biome recipes. Chunk generation applies deterministic cell-native dressing. Builder exposes major controls. Tests cover key behavior. |
| Phase 2: Pixel Scene Stamp Expansion | Mostly complete | Built-in pixel scene library, scene budgets, herringbone tile slots, scene stamping, scene markers, and scene metadata are implemented. |
| Phase 3: Runtime Content Materialization | Partially complete | Virtual chunks can materialize cells, colors, life, charge, scene objects, and scene lights into runtime windows. Playtest materialization exists. Remaining work is stronger parity validation and richer runtime object coverage. |
| Phase 4: Builder World Generation UX | Mostly complete | World Map panel has profile selection, generation presets, dressing controls, scene controls, stats, reset, import/export, playtest launch, and scene marker display. Generated scene selection on the main canvas exists. Remaining work is UX polish and capture/edit workflow depth. |
| Phase 5: Campaign Integration | Partial | Campaign generation has moved toward shared recipe vocabulary and richer biome extras, but fixed campaign levels and virtual worldgen still need a full parity/review pass. |
| Phase 6: Heavy-Compute Backends | Pending | TypeScript worker is authoritative. WebGPU and WASM backend classes are placeholders that throw "not implemented" errors. Existing WebGPU docs/probes are renderer-focused, not virtual-world-generation acceleration. |

## Terminology

Use these terms consistently in future work:

- **Fixed campaign generation**: the current `CaveGenerator` path used by normal campaign levels such as D1 Earthen Hollows, D2 Fungal Deep, etc. It generates a finite level, saves/restores through `LevelStore`, and is sensitive to `GEN_VERSION`, golden hashes, and findability.
- **Virtual chunked world generation**: the newer Noita-like prototype using herringbone tiles, `VirtualWorldDef`, chunks, worker generation, profile selection, pixel scenes, and runtime materialization. This is the path shown in the Builder World Map panel.
- **Pixel scenes**: small authored or generated stampable arrangements of cells plus optional metadata such as lights, objects, life, and charge.
- **Dressing**: deterministic post-skeleton passes that add biome-specific ores, secondary materials, liquids, glow cells, debris, vegetation, hanging growth, surface caps, and similar richness.
- **Scene placement**: a generated pixel scene instance placed into a chunk or materialized runtime window. These are not hand-authored Builder objects until captured or converted.

## Design Principles

- Generate content deterministically from world seed and world coordinates.
- Keep dense decoration cell-native, baked into generated chunks, not runtime overlay sprites.
- Use sparse runtime lights, props, and decors only for content that truly needs animation or authored behavior.
- Put tunable virtual-world configuration on `VirtualWorldDef` so Builder preview, worker generation, and playtest use one data path.
- Preserve chunk seams by using halo-aware coordinate-hash generation.
- Treat fixed campaign `CaveGenerator` changes carefully because they affect saves, golden hashes, and restore parity.
- Prefer built-in content for campaign generation. Project-local Builder assets must not silently become campaign dependencies.
- Keep the TypeScript worker as the correctness reference path until another backend proves identical output or explicitly declares visual-only preview semantics.

## Fresh Session Handoff

Start a fresh continuation by reading these files:

- `docs/NOITA-LIKE-RICH-WORLD-IMPLEMENTATION-PLAN.md` - this status and next-step document.
- `src/world/virtual/types.ts` - virtual world, dressing, scenes, transfer, and metadata types.
- `src/world/virtual/defaults.ts` - default virtual world definitions, biome recipes, scene budgets, and built-in pixel scene library.
- `src/world/virtual/ChunkGenerator.ts` - herringbone terrain generation, organic shaping, dressing passes, scene placement, normalization.
- `src/world/virtual/PixelSceneStamper.ts` - pixel scene stamping into chunk cell arrays.
- `src/world/virtual/WindowMaterializer.ts` - chunk-window assembly, crop, scene object/light caps, rebasing.
- `src/world/virtual/backends/TsWorkerBackend.ts` and `src/world/virtual/backends/worldgen.worker.ts` - authoritative asynchronous generation backend.
- `src/builder/virtualWorldPanel.ts` - Builder World Map UI, profile controls, stats, import/export, preview cache, backend selection.
- `src/builder/Builder.ts` - generated-scene adoption/selection, overlay rendering, Builder canvas interaction.
- `src/game/Levels.ts` - virtual playtest runtime creation and fixed campaign level lifecycle.
- `src/world/CaveGenerator.ts`, `src/world/biomeExtras.ts`, `src/config/gen.ts` - fixed campaign generation and biome dressing.
- `tests/virtual-world.test.ts` - best test map for virtual generation features.
- `tests/gen-golden.test.ts`, `tests/worldgen.test.ts`, `tests/levels-persistence.test.ts` - campaign generation, restore, and persistence safety nets.

Before making further changes:

1. Run `git status --short` and assume the worktree may contain unrelated user changes.
2. Inspect recent changes around `src/builder/virtualWorldPanel.ts`, `src/world/virtual/ChunkGenerator.ts`, `src/game/Levels.ts`, and `src/builder/Builder.ts`.
3. Run focused tests before broad changes:
   - `npx vitest run tests/virtual-world.test.ts`
   - `npx vitest run tests/gen-golden.test.ts tests/worldgen.test.ts tests/levels-persistence.test.ts`
4. Only run broader validation after the focused tests pass:
   - `npm run typecheck`
   - `npm run build`
   - `npm run verify:findability`
   - `npm run bench:virtual-world -- <seed> <radius> <repeats>`

## Phase 1: Virtual Biome Dressing Foundation

Status: mostly complete.

Targets:

- `src/world/virtual/types.ts`
- `src/world/virtual/defaults.ts`
- `src/world/virtual/ChunkGenerator.ts`
- `src/builder/virtualWorldPanel.ts`
- `tests/virtual-world.test.ts`

Completed:

- Added `VirtualDressingProfile` to `VirtualWorldDef`.
- Added global dressing controls for material richness, liquid richness, glow density, floor debris, hanging growth, and detail density.
- Added per-biome dressing recipes across campaign biome ids.
- Added chunk-time dressing passes after terrain shaping and surface treatments.
- Added deterministic biome-specific signatures: ores, secondary materials, liquids, glow, rubble/debris, vines/hanging growth, surface caps.
- Added normalization for stale or partial virtual world definitions so older profile data can be loaded without crashing.
- Added Builder controls for generation and dressing parameters in the World Map panel.
- Added tests covering recipe presence, dressing controls, material signatures, determinism-style behavior, and stale-data normalization.

Still Pending:

- Review generated material distributions visually across all profiles after later Phase 5 campaign changes.
- Add more quantitative tests for chunk seam continuity around dressing passes if future edits touch halo or coordinate hashing.
- Add designer-facing documentation for each dressing slider so values have predictable meaning.

Important implementation notes:

- Dressing must remain bounded per chunk. Do not add flood-fill or unbounded region searches in the worker path.
- Favor world-coordinate hash decisions over local random iteration order to preserve seam stability.
- When adding a new material to dressing, update both recipe defaults and material count/stat logic.

Review checkpoint:

- Senior tools review: mostly satisfied for data flow, but sliders still need final UX copy/tooltips.
- Senior engine review: partially satisfied. More benchmark coverage is needed after richer content is added.

## Phase 2: Pixel Scene Stamp Expansion

Status: mostly complete.

Targets:

- `src/world/virtual/PixelSceneStamper.ts`
- `src/world/virtual/defaults.ts`
- `src/world/virtual/WindowMaterializer.ts`
- `src/game/Levels.ts`
- `src/builder/virtualWorldPanel.ts`

Completed:

- Added built-in pixel scene kinds including timber braces, ruined rooms, bridge fragments, shrines, fungal pockets, crystal clusters, lava vents, and collapsed shafts.
- Added scene placement budgets to the virtual dressing profile.
- Added scene budget controls and scene mix controls to the Builder World Map panel.
- Added herringbone tile scene slots and biome/slot tag matching.
- Added deterministic scene selection and placement from tile slots.
- Added scene marker rendering in the World Map preview.
- Added scene lists in chunk inspector output.
- Added scene metadata transfer, including object/light counts.
- Added tests for default scene library coverage, scene budgets, scene stamping, masks, and boundary scene behavior.

Changed from original plan:

- The original plan said to preserve or reject scene `objects`, `lights`, `life`, and `charge` until runtime materialization supports them. That support now exists at least for materialized virtual playtest windows. Scene cell data, color overrides, life, charge, scene objects, and scene lights are carried through the virtual materialization path.

Still Pending:

- Expand the scene library substantially. Current scenes prove the system, but the game still needs many more authored-feeling setpieces per biome.
- Add a stronger visual grammar for each biome: mushroom forests, fungal labs, frozen crystal caves, timber mines, scorched ruins, volcanic vents, gilded vault rooms, etc.
- Add editor workflows to inspect a scene in detail, duplicate/capture it into editable Builder content, and tune scene budgets with immediate visual feedback.
- Add tests for scene placement density by biome, not just existence and budget plumbing.

Important implementation notes:

- Generated scenes are currently placement metadata, not normal hand-authored Builder objects.
- Scene ids encode tile/slot/source information. Preserve deterministic id construction because selection and overlays depend on it.
- Scene stamping must stay chunk-window aware; large scenes can overlap multiple chunks.

Review checkpoint:

- Tools review: scene discoverability is improved but not final. Selection exists; full capture/edit workflow needs another pass.
- Engine review: transfer size is controlled by metadata caps, but content expansion should rerun worker transfer benchmarks.

## Phase 3: Runtime Content Materialization

Status: partially complete.

Targets:

- `src/world/virtual/types.ts`
- `src/world/virtual/WindowMaterializer.ts`
- `src/game/Levels.ts`
- `src/game/runtime.ts`
- `src/render/Lighting.ts`

Completed:

- Extended virtual chunks with sparse scene placement metadata.
- Materialized chunk windows into normal `World` instances.
- Added exact crop handling for cell types, colors, life, and charge.
- Added scene object and scene light rebasing into cropped runtime windows.
- Added caps for materialized scene objects and lights.
- Added stats for materialized placements, objects, lights, and dropped metadata.
- Added virtual playtest runtime creation in `src/game/Levels.ts`.
- Added runtime authored-light integration path so materialized scene lights can affect playtest lighting.
- Added generated scene placement records to runtime data.
- Added generated-scene adoption into Builder after returning from virtual playtest.
- Added main-canvas generated-scene overlay rendering and selection by generated scene bounds.

Still Pending:

- Add explicit create-vs-playtest parity tests for Builder preview, virtual materialization, and Builder Play Window.
- Confirm that normal Play Mode and Builder Playtest render the same generated virtual window with the same material colors, grass/surface accents, lights, lava, gold, and props.
- Expand sparse runtime object support beyond the currently supported basic virtual scene object mapping.
- Add stronger warnings/UI for dropped scene metadata when caps are hit.
- Decide whether generated scenes should become editable Builder documents through "Capture Scene" or remain read-only generated overlays.
- Add tests for generated-scene selection from Builder canvas if not already covered by UI-level tests.

Important implementation notes:

- `materializeChunks` and `cropMaterializedWindow` are the key correctness boundary. Any mismatch here causes preview/playtest parity bugs.
- Runtime materialization currently crops to finite windows. It does not yet stream a persistent infinite world around the player.
- Scene caps are necessary for performance. Raise them only with `perf:scene` and worker-transfer benchmarks.

Review checkpoint:

- Performance review: partially complete. More dense-scene stress testing is needed after content expansion.
- Gameplay review: pending. Need playtest passes for readability, spawn safety, and path safety.

## Phase 4: Builder World Generation UX

Status: mostly complete.

Targets:

- `src/builder/virtualWorldPanel.ts`
- `src/styles/main.css`
- `src/builder/Builder.ts`
- `src/builder/assets/AssetDatabase.ts`
- Related editor panel tests

Completed:

- Added World Map panel as a first-class Builder workflow.
- Added profile selector with global prototype plus per-level profiles.
- Added per-profile seed handling.
- Added TypeScript Worker backend selection as the authoritative working backend.
- Added disabled/planned handling for non-authoritative or not-yet-implemented backends.
- Added preview window sizing and auto-fill while panning.
- Added chunk grid, biome labels, scene markers, and cost heatmap toggles.
- Split controls into practical groups such as generation/skeleton, surface, dressing, and scenes.
- Added generation style presets such as structured, natural, and wild.
- Added profile comparison/diff in inspector output.
- Added reset controls for generation, scenes, and full profile reset.
- Added live stats for materials, liquids, glow cells, scene count, cache, memory, generation time, and selected chunk data.
- Added import/export of virtual world-generation profiles as JSON.
- Added built-in profile defaults derived from campaign level biome identity.
- Added scene marker drawing in the World Map preview.
- Added generated scene overlays and selection in the main Builder canvas.

Still Pending:

- Make generated scene selection feel fully first-class:
  - Add a clear inspector section for selected generated scenes.
  - Add "Capture to editable prefab/scene" or "Open generated scene details" actions.
  - Make hover and click feedback consistent between World Map panel and main canvas.
- Improve profile comparison UX:
  - Show changed values grouped by Skeleton, Surface, Dressing, Scenes, Lighting.
  - Add one-click reset per changed field where practical.
- Add richer material/lighting controls:
  - Per-biome material palette controls.
  - Per-biome glow/light density controls.
  - Backdrop color correction controls already requested previously should remain part of the broader visual-tuning surface if not fully finished elsewhere.
- Add keyboard/focus accessibility pass for World Map panel controls.
- Add user-facing names/descriptions for generation controls without cluttering the tool.
- Add validation warnings when a profile produces unsafe spawn areas, too many hazards, too little traversable space, or excessive generation cost.

Important implementation notes:

- `src/builder/virtualWorldPanel.ts` is large and mixes rendering, profile state, import/export, generation requests, stats, and DOM event binding. Future large UX changes may benefit from extracting profile serialization and panel model helpers first.
- Preview cache eviction is per profile. Preserve this to avoid unbounded memory growth while panning.
- The Builder canvas selection path for generated scenes is in `src/builder/Builder.ts`; it must not interfere with normal object/light selection.

Review checkpoint:

- Product/editor UX review: partially complete. The workflow is usable but still lacks professional-level scene editing/capture polish.
- Accessibility and keyboard workflow review: pending.

## Phase 5: Campaign Integration

Status: partial and high risk.

Targets:

- `src/world/CaveGenerator.ts`
- `src/world/biomeExtras.ts`
- `src/config/gen.ts`
- `src/game/Levels.ts`
- `tests/gen-golden.test.ts`
- `tests/worldgen.test.ts`
- `tests/levels-persistence.test.ts`

Completed or Partially Completed:

- Campaign biome extras now expose a recipe vocabulary compatible with virtual dressing concepts.
- Campaign generation uses biome-specific extras for richer surfaces/materials.
- Gold pocket budget uses biome-specific scaling.
- Campaign generation has reservation awareness around important authored/required spaces.
- `GEN_VERSION` is present and currently guards save compatibility.
- Tests exist for campaign dressing recipe vocabulary, biome gold budgets, and restoring biome-rich wall colors.
- Restore logic regenerates pristine worlds and overlays saved cell state so generated paint metadata can survive resume.

Still Pending:

- Do a deliberate full campaign parity pass:
  - Normal Play Mode, Builder Playtest, and Builder view should use the same generated material colors, surface grass, lights, lava, gold, props, and biome accents for the same map where applicable.
  - The earlier observed bug was that Builder Playtest/Builder view could appear dull or missing grass/lights while normal Play Mode looked rich. Treat this as a top Phase 5 verification target.
- Audit stream order and RNG usage:
  - Optional dressing must use forked RNG streams.
  - Baseline campaign output should change only when intentional.
  - If output changes, update `GEN_VERSION` and golden expectations deliberately.
- Respect all required reservations:
  - Spawn
  - Exit well
  - Waystones
  - Portals
  - Cauldron
  - Prefabs
  - Machine rooms
  - Structure corridors
  - Findability rescue corridors
- Add restore parity tests for generated lights/content, not only cell colors.
- Add campaign tests for biome-specific hazards and props:
  - Frozen: ice/snow/nitrogen/crystals.
  - Fungal: fungus/toxic/glowshrooms.
  - Flooded: water pockets and wet surfaces.
  - Timber: wood/structures/vines.
  - Crystal: crystals/glow clusters.
  - Scorched/volcanic: lava/fire/charred dressing.
  - Gilded: gold-rich dressing without breaking economy.
- Run `npm run verify:findability` after every meaningful campaign generation change.
- Add before/after screenshots or benchmark artifacts for representative campaign levels.

Important implementation notes:

- Fixed campaign generation is not the same system as virtual chunked world generation. Avoid accidentally wiring Builder-only profile assets into campaign generation.
- `GEN_VERSION` must be bumped only for deliberate campaign output changes that invalidate old saves or golden assumptions.
- Existing save/restore flow depends on regenerating pristine deterministic worlds, then overlaying saved mutations. Generated visual metadata must survive that flow.

Review checkpoint:

- Save/restore correctness review: pending.
- Gameplay/findability review: pending.
- Visual parity review: pending and important.

## Phase 6: Heavy-Compute Backends

Status: pending.

Targets:

- `src/world/virtual/backends/WebGpuPreviewBackend.ts`
- `src/world/virtual/backends/WasmBackend.ts`
- `src/world/virtual/backends/BackendTypes.ts`
- `src/world/virtual/backends/TsWorkerBackend.ts`
- `scripts/bench-virtual-world.mjs`
- `docs/WEBGPU-TSL-COMPUTE-IMPLEMENTATION-PLAN.md`
- `docs/WEBGPU-BENCHMARK-LEDGER.md`

Completed:

- Backend interface exists.
- TypeScript worker backend exists and is the authoritative implementation.
- WebGPU preview backend class exists as a placeholder and reports availability from `navigator.gpu`.
- WASM backend class exists as a placeholder and reports WebAssembly availability.
- Bench/probe infrastructure exists broadly in the repo.
- WebGPU renderer/backend research exists in related docs, but it is not virtual-world-generation acceleration.

Still Pending:

- Implement WebGPU visual-only preview acceleration or explicitly remove it from the UI until it exists.
- Implement WASM kernels for hot virtual generation paths only after profiling proves they are worth it.
- Determine which passes are good candidates:
  - Cellular/morphology smoothing.
  - Organic edge rounding.
  - Material distribution scans.
  - Preview-only palette/composite generation.
- Keep TypeScript worker output as the correctness reference.
- Define backend parity rules:
  - WASM authoritative path must produce byte-identical chunk cells/colors/life/charge/metadata, or it cannot replace TypeScript worker output.
  - WebGPU preview path may be visual-only, but the UI must say so clearly and must not be used for playtest materialization unless it becomes authoritative.
- Add benchmark gates:
  - Baseline TypeScript worker time and transfer size.
  - WASM generation time and initialization cost.
  - WebGPU preview frame time and readback avoidance.
  - Memory pressure while panning.
- Update `docs/WEBGPU-BENCHMARK-LEDGER.md` with virtual-world-specific benchmark entries.

Important implementation notes:

- Avoid GPU readbacks in frame-loop benchmarks.
- Do not couple virtual world acceleration to renderer WebGPU support unless the capability/fallback boundary is explicit.
- If WebGPU preview cannot beat the worker path or introduces visual mismatch, keep it as a research artifact.

Review checkpoint:

- Engine performance review: pending.
- Portability review for WebGPU availability and fallback behavior: pending.

## Cross-Phase Known Issues And Opportunities

1. **Visual richness still needs content, not just algorithms.**
   The virtual generator now supports more richness, but Noita-like depth depends on many more biome-specific scenes, props, materials, hazards, and lighting motifs.

2. **Campaign and virtual paths can drift.**
   Fixed campaign generation and virtual chunked world generation share concepts but not one implementation. This is intentional for save safety, but it means parity must be tested explicitly.

3. **Builder Playtest parity is the highest user-visible risk.**
   If the same generated area looks rich in Play Mode but dull in Builder Playtest, the materialization/rendering path is not consistent enough.

4. **Generated scenes are selectable but not yet fully editable.**
   Selection is useful for inspection. A professional editor should let designers capture a generated scene into editable content or open a detailed read-only inspector with source, bounds, objects, lights, and cells.

5. **World Map panel is powerful but dense.**
   Future polish should group controls more cleanly, add reset per group/field, and expose values in language a level designer can reason about.

6. **Performance must stay bounded.**
   More richness should not mean unbounded flood fills, excessive metadata transfer, or too many runtime lights. Add caps and stats before adding content.

7. **No true streaming virtual world runtime yet.**
   Current virtual playtest materializes a finite cropped runtime window. A full Noita-like large world eventually needs streaming/chunk lifecycle around the player, persistence of mutated chunks, and cross-chunk simulation policy.

## Recommended Next Work Order

### Next Task 1: Phase 5 Visual Parity Audit

Goal:

- Prove that normal Play Mode, Builder Playtest, Builder preview, and virtual materialization show the same terrain colors, grass/surface accents, materials, lights, liquids, and scene content where they are meant to share data.

Steps:

1. Pick one representative seed and profile for Earthen, Frozen, Fungal, and Volcanic.
2. Capture screenshots from:
   - World Map preview
   - Builder main canvas after generation/materialization
   - Builder Playtest
   - Normal Play Mode if using a fixed campaign level
3. Identify which path loses colors, lights, grass, props, or material metadata.
4. Add focused tests around the responsible conversion path.
5. Fix the conversion/render path before adding more content.

Suggested files:

- `src/game/Levels.ts`
- `src/world/virtual/WindowMaterializer.ts`
- `src/builder/Builder.ts`
- `src/world/CaveGenerator.ts`
- `src/world/biomeExtras.ts`
- `tests/virtual-world.test.ts`
- `tests/worldgen.test.ts`
- `tests/levels-persistence.test.ts`

### Next Task 2: Generated Scene Inspector And Capture UX

Goal:

- Make generated scene selection feel like a real editor feature.

Steps:

1. Add inspector schema/model for selected generated scenes.
2. Display source, biome, scene id, slot id, bounds, object count, light count, and material footprint.
3. Add a "Capture" action if the existing Builder document model can support it safely.
4. If capture is too large for one pass, add a read-only details panel first.
5. Add UI tests for selection and inspector state.

Suggested files:

- `src/builder/Builder.ts`
- `src/builder/inspectorSchemas.ts`
- `src/builder/document.ts`
- `src/builder/prefabs.ts` or nearby prefab capture helpers if reused
- `tests/builder.test.ts`
- `tests/editor-ui.test.ts`

### Next Task 3: Content Pack Expansion

Goal:

- Add enough biome-specific scenes and dressing detail that generated worlds feel authored.

Steps:

1. Add 3-5 more small pixel scenes per major biome.
2. Add scene budget defaults per biome profile.
3. Add material and hazard motifs per biome.
4. Add runtime lights only where they change readability or mood.
5. Benchmark metadata transfer and runtime lighting after adding content.

Suggested files:

- `src/world/virtual/defaults.ts`
- `src/world/virtual/ChunkGenerator.ts`
- `tests/virtual-world.test.ts`
- `scripts/bench-virtual-world.mjs`
- `npm run perf:scene`

### Next Task 4: Campaign Recipe Parity

Goal:

- Bring campaign biome extras closer to virtual recipe concepts without accidentally breaking saves or golden assumptions.

Steps:

1. Compare `campaignDressingRecipeForBiome` to virtual `dressingRecipeForBiome`.
2. Decide which concepts should match and which should remain campaign-specific.
3. Use forked RNG streams for optional additions.
4. Preserve all required reservations.
5. Run golden/findability/persistence validation.

Suggested files:

- `src/world/biomeExtras.ts`
- `src/world/CaveGenerator.ts`
- `src/config/gen.ts`
- `tests/gen-golden.test.ts`
- `tests/worldgen.test.ts`
- `tests/levels-persistence.test.ts`

### Next Task 5: Backend Acceleration Spike

Goal:

- Decide whether WASM or WebGPU should be implemented for virtual world generation.

Steps:

1. Run worker benchmarks on representative windows and profiles.
2. Profile hot passes in `ChunkGenerator.ts`.
3. Prototype the smallest useful WASM kernel first if CPU hot loops dominate.
4. Prototype WebGPU only for visual preview if it avoids readback and improves pan/zoom preview smoothness.
5. Keep TypeScript worker as reference and compare outputs/perf.

Suggested files:

- `src/world/virtual/ChunkGenerator.ts`
- `src/world/virtual/backends/WasmBackend.ts`
- `src/world/virtual/backends/WebGpuPreviewBackend.ts`
- `scripts/bench-virtual-world.mjs`
- `docs/WEBGPU-BENCHMARK-LEDGER.md`

## Validation Matrix

Run these during normal development:

- `npx vitest run tests/virtual-world.test.ts`
- `npx vitest run tests/gen-golden.test.ts tests/worldgen.test.ts tests/levels-persistence.test.ts`
- `npm run typecheck`
- `npm run build`

Run these after campaign generation changes:

- `npm run verify:findability`
- `npx vitest run tests/gen-golden.test.ts`
- `npx vitest run tests/worldgen.test.ts tests/levels-persistence.test.ts`

Run these after virtual world performance or content expansion:

- `npm run bench:virtual-world -- <seed> <radius> <repeats>`
- `npm run perf:scene`

Run these for Builder UX work:

- `npm run verify:builder-ux`
- `npm run verify:builder-responsive`
- Manual Builder checks:
  - World Map open/close.
  - Profile switching.
  - Seed reroll.
  - Pan/zoom preview.
  - Scene marker toggle.
  - Scene selection on main canvas.
  - Reset generation.
  - Reset scene mix.
  - Export/import profile.
  - Launch Playtest from generated window.
  - Return to Builder with generated scene overlays preserved.

## Definition Of Done For The Larger Effort

The rich-world effort should be considered complete only when:

- Each campaign biome and virtual profile has a recognizable visual/material identity.
- The Builder World Map is the obvious place to generate, tune, inspect, and playtest worlds.
- Fixed campaign Play Mode and Builder Playtest no longer disagree on generated colors, grass, lights, props, and hazards.
- Generated scenes can be inspected and either captured for editing or clearly understood as read-only generated content.
- Findability and save/restore tests pass after campaign generation changes.
- Virtual world chunk generation remains deterministic and bounded.
- Performance budgets are documented with benchmarks, and any non-TypeScript backend has a clear fallback story.


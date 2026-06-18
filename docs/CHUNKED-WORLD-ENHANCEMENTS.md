# Chunked World — Enhancement & Pixel-Scene Tooling Plan

Status: living plan. Scope: the virtual/chunked world generator (the "World Map"
feature) — `src/world/virtual/*` + `src/builder/virtualWorldPanel.ts`. This doc
covers the biome/dressing/look-and-feel enhancement roadmap **and** the tooling
needed to author and evaluate pixel scenes (the chunked map's primary content
unit).

Read `ARCHITECTURE.md` for the frame-order contract and `docs/BUILDER.md` for the
Builder. The legacy↔chunked parity audit that motivated this lives in the session
history; the short version is in [Current state](#current-state).

---

## Current state

Done (shipped in the chunked gen):
- **Cave size** (`caveScale`) — global Look-tuning knob normalized into the chunk
  carves (`caveMultiplier`, `ChunkGenerator.ts`).
- **Surface-pit / notch fill** — reuses the locked `polishCaveTerrain` on a
  haloed-scratch adapter, driven by `GEN_TUNE.{fillSurfacePits,surfacePitWidth,
  surfacePitDepth,notchPasses}` (`fillSurfacePitsScratch`).
- **"Use global dressing" toggle** — overlays the global campaign dressing recipes
  onto a profile at generation time (`virtualWorldPanel.generateWindow`).

Parity gaps still open (the basis for this plan):
- **Hidden ore / mineral vugs** — no chunked equivalent of `fillMineralVugs`.  → Tier 1
- **Emissive read in the preview** — gameplay already lights glow cells (the live
  `Lighting` seeds emissive light by cell *type*: Glowshroom, Crystal, Fungus,
  Lava, Gold…), but the World Map **preview** is a flat `materialColor` canvas, so
  authors can't see where the glow is. → Tier 1
- **Localized liquids** — only small static basins; no controllable water per area.
  We will solve this with **pixel scenes**, not biome-wide flood tables (the map is
  huge; a flood table would drown whole regions). → Tier 2
- **Depth variation** — no Y-axis gradient (deeper ≠ hotter/richer). → Tier 2
- **Shape-varied biome extras** (crystal spikes, ice/ash/snow drifts, healing
  springs) — folded into generic veins. → Tier 3 (not detailed here)

---

## Foundational constraint: chunked determinism

Every chunked pass MUST satisfy three properties, or it breaks the World Map:

1. **World-coordinate determinism.** A cell's value depends only on its world
   coords + the seed, never on chunk index or scratch-local position. (Carves hash
   by world coord; this is why they're stable.)
2. **Chunk-size stability.** Generating the same world area at a different
   `chunkSize` must yield identical cells. Locked by
   `tests/virtual-world.test.ts > "is stable when the same world area is generated
   at a larger chunk size"`. **This is the test that catches most mistakes** — run
   it after any `ChunkGenerator` change.
3. **Seamlessness across chunk borders.** A feature straddling a chunk boundary
   must be filled identically by both chunks (each commits its own core cells; the
   shared halo gives both the full context).

Passes operate on a **haloed `Scratch`** (`chunkSize + 2·halo`, default halo 32).
Two recurring techniques make non-trivial passes safe:

- **Recolor by world coord** (not scratch-local). The surface-pit pass reuses the
  legacy polish but then recolors filled cells via `terrainColor(def, biome, wx,
  wy)` because the legacy shading hashes *local* coords. Any borrowed legacy pass
  needs this fix-up.
- **Halo-bounded connectivity** (the escape hatch if you ever *must* flood-fill).
  Act on a component only if it (a) does **not** touch the scratch edge and (b) has
  a bbox ≤ `halo` on each axis; then every chunk straddling it fully contains it and
  reaches the same decision (keyed by its min world coord). Bigger components skip
  consistently. **Prefer not to need this** — the mineral-vug pass was *planned* as a
  halo-bounded flood-fill but ended up as a coordinate-anchored *embed*
  (`dressMaterialPockets`-style), which is simpler and stable for free. Reach for a
  world-anchored grid before reaching for connectivity.

> Rule of thumb: if a pass can't be expressed as "decision = f(world coords, seed)
> over a region ≤ halo," it doesn't belong in the per-chunk path — promote it to a
> pixel scene (authored, placed deterministically by tile slot) instead.

---

## Tier 1 — Hidden ore + honest emissive preview (in progress)

### 1a. Mineral vugs (hidden ore) — SHIPPED
`fillMineralVugsScratch(def, scratch, biomeAt)`, run after `dressBiomeFeatures`,
before `sealOuterBorder`.

**Implementation note (changed from the original flood-fill plan):** the legacy
`fillMineralVugs` *fills enclosed AIR pockets*, but the chunked organic smoothing
(`relaxOrganicSilhouette`, `roundCaveCorners`, the notch fill) already cleans up
almost all enclosed air — a flood-fill found nothing to fill. So instead of filling
air, the chunked pass **embeds clusters of cave rock into the wall mass**:
`paintTerrainEllipse` (which only overwrites SOLID cells) stamps small ellipses on a
world-anchored grid (the exact pattern `dressMaterialPockets` already uses, so it's
cross-chunk-seamless and chunk-size-stable for free — no flood-fill / halo-bounding
needed). The ore stays buried in rock; you dig it out.

- ~45% of grid cells (spacing 70) host a buried cluster; material by world-grid hash:
  58% Stone, 22% Coal, **16% RawOre** (the dark, lit-by-light treasure), 4% Crystal.
- `materialColor` gained a `Cell.RawOre` case returning a **dark** gold-flecked base
  so it reads near-black until the player's light hits it (RawOre is intentionally
  not in the `Lighting` emissive set).
- Gated by `def.generation.mineralVugs` (default true).

Verified: `tests/virtual-vugs.test.ts` (RawOre appears with vugs on / absent off,
only-adds-solid) + the chunk-size-stability test.

### 1b. Honest emissive preview
The preview RGBA (`transfer.ts:makePreviewRgba`, worker-side) is flat cell color.
Boost emissive cell **types** there so the preview matches what the live lighting
will do — mirroring the `Lighting` seed set (Glowshroom, Crystal, Fungus, Lava,
Fire, Ember, Gold, Healium, Toxic, Catalyst, Teleportium, Acid). Per-cell additive
glow (no neighbor bleed → seamless). A true radius/bloom in the preview is a
follow-up (it needs a canvas post-process or a cross-chunk-aware blur).

> Note: this is preview-only. The chunk's stored colors and gameplay rendering are
> unchanged — glow already lights the cave when a window is materialized and played.

---

## Tier 2 — Localized liquids (pixel scenes) + depth gradient

### 2a. Localized liquids via pixel scenes (the pivot)
**Decision:** do NOT add a biome-wide flood/lava table. On a multi-chunk map that
floods whole regions and removes authorial control. Instead, water/lava/acid are
**pixel scenes** placed at tile slots, so each pool is a deliberate, local, authored
feature.

New scene kind `liquidPockets` (extends `VirtualSceneKind`):
- Authored scenes: `spring_pool` (water basin + drip + moss fringe), `still_cistern`
  (large calm water), `magma_pool` (lava + ember crown + light), `acid_sump`
  (acid + glow), `frozen_melt` (ice shelf over water).
- Each carries real liquid cells in its `material` plane. When materialized into a
  live World the liquid **flows** (the sim takes over) — so scenes should author a
  **basin** (solid lip around the liquid) or the pool drains immediately. Provide a
  `basin()` helper in the scene canvas builder that frames a liquid region with a
  one-cell solid rim.
- Per-biome budgets in `VirtualSceneBudget` (flooded: high `still_cistern`;
  volcanic: `magma_pool`; gilded: `acid_sump`; frozen: `frozen_melt`).
- Placement reuses the existing tile-slot system (deterministic, cross-chunk-safe by
  construction — scenes are placed by tile coord hash, no flood-fill needed).

Why scenes and not a pass: liquids need a **basin** to not drain, and basins are
shapes — exactly what pixel scenes are for. It also gives per-area control and rides
the determinism the scene system already guarantees.

Dependency: this leans hard on pixel-scene **tooling** (below) — we need to author
and tune these basins quickly and see them in context.

### 2b. Depth gradient
A pure `f(worldY)` modulation — trivially deterministic, no connectivity. Add a
`depthGradient` profile block (or derive from biome) read in the dressing passes:
- Bias dressing density and material by depth: ore/liquid richness ↑ with depth,
  vegetation ↓; volcanic lava-glow ↑ deep, frozen ice ↑ shallow.
- Implementation: a `depthFactor(def, worldY)` helper (normalize worldY over a
  configured span) multiplied into `dressMaterialVeins` / `dressLiquidBasins` /
  `dressGlowAccents` density rolls and used to pick "deep" vs "shallow" recipe
  variants. World-Y only → stable + seamless for free.
- Expose `depthSpan` + per-channel depth weights in the World Map generation panel.

---

## Pixel-scene management tooling

Pixel scenes started as **hand-coded TypeScript** (`defaults.ts` `createXScene()`).
**T1, T2 and T4 now ship** as the Pixel Scene Editor (Builder → View → "Pixel Scene
Editor").

### T1. Scene registry + JSON format — SHIPPED
- `serializePixelScene` / `parsePixelScene` in `src/world/virtual/pixelSceneJson.ts`
  (`PixelSceneJson`, portable base64 planes — round-trips every plane incl. negative
  `Int16` life). User scenes persist via `src/world/virtual/pixelSceneStore.ts`
  (localStorage, one key per scene, like `prefablib.ts`).
- Still TODO: a `scripts/gen-pixel-scenes.mjs` that bakes authored JSON → the
  built-in library so scenes live as data, not code (the editor's EXPORT emits the
  JSON today).

### T2. In-Builder scene editor — SHIPPED
- `src/builder/pixelSceneEditor.ts` — a modal editor: paint/erase cells (cell
  palette + brush), eyedropper, **place lights** (toggle), set kind/tags, resize,
  lit preview (emissive + light halos via the shared `emissive.ts`), live
  validation, and save/new/duplicate/import/export/delete against the user store.
- Still TODO: per-pixel colour shading (paints a representative colour per cell
  today), object placement UI (objects are preserved + previewed but not yet
  placeable), and a `basin` quick-tool for liquid scenes.

### T3. Per-scene preview & evaluation (partly in the editor)
The editor's lit preview covers the per-scene "what will the lighting do" case.
Still TODO on the World Map:
- **Isolated render:** render a single scene to a canvas with the **lighting model
  applied** (run the real `Lighting` over a one-off World built from the scene) so
  authors see its glow/objects/lights exactly as in game — closes the
  "preview ≠ gameplay" gap for scenes too.
- **Footprint overlay:** the World Map already draws scene markers
  (`drawSceneMarkers`); add hover-to-inspect (scene id, kind, tags, object/light
  counts, which tile slot placed it) and a heatmap of scene coverage/density.
- **Placement debug:** a mode that, for a hovered tile slot, lists the candidate
  scenes and the weights `chooseSceneForSlot` computed — so "why did/didn't this
  scene appear here" is answerable.

### T4. Validation — SHIPPED (live in the editor)
`validatePixelScene(def)` in `src/world/virtual/pixelSceneValidate.ts`: liquid-
without-basin (drains when played), per-scene light budget, out-of-bounds objects/
lights, missing kind/tags, empty scene. Unit-tested. Still TODO: a vitest gate over
the whole library + object-reachability/overlap checks.

### T5. Hot-reload & a scene-coverage test harness
- Dev-only: editing a scene (or its JSON) clears the World Map chunk cache and
  regenerates, so iteration is immediate (today it needs a rebuild).
- A `scripts/verify-scene-coverage.mjs` probe: generate a multi-seed window per
  biome and assert every biome's signature scene kinds actually appear at the
  expected density (a findability-style audit for scenes), so adding a biome scene
  can't silently fail to place.

### Build order
~~T1 (registry/JSON)~~ ✓ · ~~T2 (editor)~~ ✓ · ~~T4 (validation)~~ ✓ → T3 (World
Map placement debug) → T5 (gen-script + hot-reload + coverage audit). Tier 2's liquid
scenes can now be authored directly in the editor (the validator flags un-basined
pools); the **depth gradient** (Tier 2b) is independent and can land anytime.

---

## Roadmap summary

| Phase | Item | Determinism | Needs tooling |
|---|---|---|---|
| **Tier 1 (now)** | Mineral vugs (hidden ore) | halo-bounded flood-fill | no |
| **Tier 1 (now)** | Honest emissive preview | per-cell, trivial | no |
| **Tooling** | Scene registry/JSON (T1), editor (T2), validation (T4) | — | **SHIPPED** |
| Tier 2 | Localized liquids = pixel scenes | scene placement (already safe) | author liquid scenes in the editor |
| Tier 2 | Depth gradient | `f(worldY)`, trivial | no |
| Tier 3 | Shape-varied extras (spikes/drifts/springs) | per-cell or scenes | some |
| Tooling | World Map placement debug (T3), gen-script + coverage (T5) | — | next |

## Known gaps in scene tooling (baseline, for reference)
- No visual scene editor (hand-coded `Uint8Array` in TS).
- No per-scene preview or lighting-accurate render.
- No footprint/placement debug beyond the marker overlay.
- No validation (basin, light budget, reachability, overlap).
- No hot-reload; library is baked at startup.
- No scene-coverage audit.

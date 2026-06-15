# Builder Surface Painting & Local Dressing Override Plan

## Status & scope correction (read first)

This plan was originally drafted assuming surface vegetation was unbuilt. **It is not.** The
procedural foundation from `docs/NOITA-LIKE-RICH-WORLD-IMPLEMENTATION-PLAN.md` Phase 1 is already
implemented (uncommitted, in the modified `src/world/virtual/*` files, being worked on
concurrently). This plan is rewritten to be a **strict superset layer on top of that foundation** —
the authoring half (Builder painting + local override + pixel-scene authoring) that the rich-world
plan defers and never fully specifies.

**Do not duplicate the engine that already exists.** The contribution here is making the existing
global, deterministic dressing *locally aimable and overridable by hand* — Noita's pixel-scene
"budge" generalized — without forking the generation path.

## What already exists (verified in source, must stay compatible)

Generation pipeline order in `generateVirtualChunk` (`src/world/virtual/ChunkGenerator.ts:44-83`):

```
fillBaseTerrain → carveTiles → roughenCaveEdges → carveOrganicPockets → carveOrganicCracks →
relaxOrganicSilhouette → smoothTerrain → roundCaveCorners →
dressSurfaceTerrain → dressBiomeFeatures → sealOuterBorder → [crop to chunk] → stampPixelScenes
```

- **`dressSurfaceTerrain`** (`ChunkGenerator.ts:506`) already grows constrained surface
  vegetation/caps: it walks floor cells (solid with `Cell.Empty` above), requires `openAbove`
  exposure ≥ 2 (`:931`), gates on `generation.surfaceCover`, caps to `generation.surfaceDepth`, and
  picks material via **`surfaceCellForBiome`** (`:940`) — e.g. fungal→Fungus/Moss, frozen→Ice,
  timber→Wood/Moss, earthen→Moss — tinted with the **`palette.crown`** slot (`surfaceColor`,
  `:973`). The "specific-width brush that only paints where allowed" the user described is, at the
  engine level, *already the predicate of this pass*. Painting only needs to modulate it locally.
- **`dressBiomeFeatures`** (`ChunkGenerator.ts:539`) runs six scatter passes —
  `dressMaterialVeins`, `dressMaterialPockets`, `dressFloorDebris`, `dressHangingGrowth`,
  `dressLiquidBasins`, `dressGlowAccents` — each gated by global `def.dressing.controls`
  (`detailDensity`, `materialRichness`, `liquidRichness`, `glowDensity`, `floorDebris`,
  `hangingGrowth`) × per-biome `VirtualBiomeDressingRecipe` (ore/secondary/pocket/liquid/glow/
  rubble/hanging materials + densities). Defaults in `defaults.ts:106-179`.
- **`def.dressing` is a required field** on `VirtualWorldDef` (`types.ts:24`), not optional.
- **9 biomes**, not 3: `VirtualBiomeId = BiomeId` (`types.ts:7`) →
  `earthen, fungal, frozen, flooded, timber, crystal, scorched, volcanic, gilded`
  (`defaults.ts:123-144`). Any plan content must cover all nine or degrade gracefully.
- **Vegetation/material Cell ids already exist**: Moss, Fungus, Glowshroom, Vines, Ice, Snow,
  Crystal, Toxic, Nitrogen, Coal, Ash, Glass, Catalyst, Acid, Lava, Water, Gold, Stone, Wood
  (used in `defaults.ts:126-143`). The earlier draft's "Moss=34 is highest / CELL_COUNT=35 / crown
  unused" notes are **stale** — do not rely on them. New Cell ids are likely unnecessary for this
  plan; prototype and ship with existing ids.
- **`stampPixelScenes`** (`PixelSceneStamper.ts`) + `def.pixelScenes` already implement the literal
  authored-pixel budge as the final pass. Engine done; **authoring from the Builder is not**.
- Determinism primitives: world-coordinate `unitHash2i`/`signedUnitHash2i` (`hash.ts:56-62`); halo
  32 (`defaults.ts`); chunk hash FNV-1a over `[types, colors]` (`ChunkGenerator.ts:88`).

## The one idea, restated against the real code

Manual and procedural placement are the same operation with different input sources. The
procedural source (global controls + biome recipes + surface params) is built. This plan adds the
**hand source**: painted regions that locally modulate those same knobs, plus authored pixel
scenes. Both compile to `VirtualWorldDef`, both replay through the existing deterministic passes,
neither mutates a generated cell.

```
                 def.dressing.controls (global)  ─┐
                 def.generation.surface* (global) ─┤
                 per-biome recipes (global)        ├─► existing passes ─► baked chunk
   NEW: def.dressingOverrides[] (painted, local) ─┤
   NEW: authored def.pixelScenes[]  (literal)    ─┘   (stampPixelScenes, last word)
```

## Data model (additive, back-compatible)

`VirtualWorldDef` keeps `v: 1`. Add one optional array so existing worlds load unchanged (loader
defaults to `[]`). **No parallel rule engine** — overrides are spatial multipliers/setters over the
knobs that already drive generation.

```ts
// src/world/virtual/types.ts

export type DressingChannel =
  | 'surfaceCover' | 'surfaceDepth' | 'vegetationDensity'   // -> def.generation.*
  | 'detailDensity' | 'materialRichness' | 'liquidRichness' // -> def.dressing.controls.*
  | 'glowDensity'   | 'floorDebris'     | 'hangingGrowth';

export interface DressingOverride {
  id: string;
  /** World-space footprint of the painted region. */
  rect: WorldRect;                 // from coords.ts
  /** World cells per weight sample (e.g. 8) — keeps a painted room ~1KB. */
  cellSize: number;
  /** 0..255 weight field, length ceil(w/cellSize)*ceil(h/cellSize). 0 = no effect at 'scale'. */
  weights: Uint8Array;
  /** Which knobs this brush bends. */
  channels: DressingChannel[];
  /** 'scale' multiplies the channel by (weight/255 * amount); 'set' clamps toward amount;
   *  'block' forces the channel to 0 (growth-free / debris-free zones). */
  mode: 'scale' | 'set' | 'block';
  amount: number;                  // brush strength, e.g. 0..3 for boost, 0 for suppress
  /** Optional: restrict to biomes (empty = wherever the region falls). */
  biomes?: VirtualBiomeId[];
  /** Optional: swap a biome recipe material locally, e.g. force Vines as the hanging material. */
  materialSwap?: { channel: 'ore'|'secondary'|'pocket'|'liquid'|'glow'|'rubble'|'hanging'; cell: number };
}

export interface VirtualWorldDef {
  // ...existing fields incl. dressing, generation, pixelScenes...
  dressingOverrides?: DressingOverride[];
}
```

Authored pixel scenes reuse the existing `PixelScenePlacementDef` — no new type.

### Why this is the compatible shape

- It bends the **same** `generation.surfaceCover` / `vegetationDensity` / `dressing.controls`
  values the passes already read, so "paint more moss here" = locally raise `vegetationDensity`,
  and the existing `dressSurfaceTerrain` predicate still guarantees it only lands on valid floors.
  The brush is constrained by construction — no separate constraint engine.
- "Erase growth in this room" = `mode:'block'` on `surfaceCover` + `hangingGrowth`.
- It composes with whatever the concurrent rich-world work does to controls/recipes, because it
  multiplies their output rather than replacing it.

## Engine integration (surgical, threaded into existing passes)

New module `src/world/virtual/DressingOverrides.ts` exporting a sampler:

```ts
/** Deterministic, halo-safe. Returns the effective multiplier (or set/blocked value) for a
 *  channel at a world cell, folding every overlapping override. 1.0 when none apply. */
export function overrideFactor(def, channel, worldX, worldY): number;
```

Then replace the **global** reads inside the existing passes with override-aware reads — small,
local edits, no reordering (the frame/pass order is a contract):

- `dressSurfaceTerrain`: `cover`, `vegetation`, `depth` become
  `base * overrideFactor(def, 'surfaceCover'|'vegetationDensity'|'surfaceDepth', wx, wy)`.
- `dressBiomeFeatures` passes: each `dressingControl(def, key)` read multiplies by
  `overrideFactor(def, key, wx, wy)`; `materialSwap` substitutes the recipe material before stamp.

Because `overrideFactor` keys on world coordinates and overrides store world-space rects, results
are seamless across chunk borders and identical inside the halo — same guarantee the existing
hash-on-world-coords passes already rely on. Overrides feed the existing chunk hash automatically
(they change baked cells). Authored data lives in the world's `def`, so it travels with saves and
needs no `GEN_VERSION` bump; only a change to a *default/built-in* pass algorithm does.

## Builder painting UX

Extends `src/builder/virtualWorldPanel.ts` (today: read-only preview — pan/zoom/generate/validate;
"Materialize" disabled). Add a **Dressing** tool mode.

### Brushes (all constrained by the existing pass predicates, not new logic)

1. **Boost brush** — drag to paint a `DressingOverride` (`mode:'scale'`, `amount>1`) over chosen
   channels (e.g. `vegetationDensity`, `hangingGrowth`). Live-regenerate touched chunks. Painting
   onto a ceiling does nothing for `surfaceCover` because `dressSurfaceTerrain` only writes floors —
   the constraint is inherent.
2. **Suppress / eraser** — same gesture, `mode:'block'` — growth-free, debris-free zones.
3. **Material swap dab** — set `materialSwap` in the painted region (force Vines as the hanging
   material in this grove, Crystal as the glow here).
4. **Pixel-scene stamp** — drop an existing Builder prefab/scene as a `PixelScenePlacementDef` for
   literal authored pixels. Engine path already exists; this is wiring + an editable scene list
   (markers already render at `virtualWorldPanel.ts:675`).

Real clicks only in probes (boundingBox + `page.mouse.click`); the tool layer must set
`pointer-events: auto` (`#builder-root` is `pointer-events: none`).

### Panel additions

- **Dressing** section: per-channel global sliders already belong to the rich-world plan's Phase 4;
  this adds an **overrides list** (select/edit/clear, channel chips, mode, amount) and brush mode
  buttons.
- Live stats: override cell-delta count, blocking-cell count with a **findability warning badge**
  when an override could seal a path, and added generation cost (ms) via the existing metrics
  plumbing.

## Phased rollout (each shippable; ordered to land *after* the in-flight foundation)

> Coordination: the `src/world/virtual/*` files are being edited by the concurrent rich-world
> session. Per repo policy (concurrent sessions), land these phases behind that work and only
> commit files this session owns; rebase the small pass-edits onto their committed foundation.

### Phase A — Engine: `DressingOverride` sampler + pass integration
- Add the type + `DressingOverrides.ts`; thread `overrideFactor` into `dressSurfaceTerrain` and the
  six `dressBiomeFeatures` passes; loader defaults `dressingOverrides` to `[]`.
- Tests (`tests/virtual-world.test.ts`): determinism (seed→hash stable with overrides);
  seam parity for an override rect straddling a chunk border; `scale`/`block`/`set` math;
  override outside its biome filter is a no-op; **no override raises growth on a non-floor cell**
  (proves the inherent constraint).
- Gate: `npx tsc --noEmit` → `npx vitest run tests/virtual-world.test.ts` → `npm run build`.

### Phase B — Builder: overrides list + boost/suppress/swap brushes
- Dressing tool mode; brushes write overrides into the def; live regen of touched chunks;
  findability warning badge.
- Builder e2e probe (pattern: `scripts/verify-builder-*.mjs`): real-click paint a boost region →
  regen → assert vegetation cell count rose in-region and is unchanged out-of-region; paint a block
  region → assert growth removed there only.

### Phase C — Builder: pixel-scene authoring (the literal budge)
- Wire existing prefab/scene assets to write `PixelScenePlacementDef`s into the virtual def;
  editable scene list + markers. Reuses `stampPixelScenes` — minimal engine work.

### Phase D — Playtest parity + findability
- Ensure `WindowMaterializer` / `Levels` playtest consumes `dressingOverrides` + authored
  `pixelScenes` identically to preview (one data path — same requirement as rich-world Phase 3).
- `npm run verify:findability` for any override/scene that can place or seal blocking cells;
  confirm fail-open (an override may never hard-lock progression).

## Compatibility matrix vs `NOITA-LIKE-RICH-WORLD-IMPLEMENTATION-PLAN.md`

| Rich-world plan phase | Relationship to this plan |
|---|---|
| P1 Virtual Biome Dressing Foundation (**done/in-flight**) | **Dependency.** This plan modulates `dressing.controls`, the surface params, and recipes it created. No conflict — multiplies their output. |
| P2 Pixel Scene Stamp Expansion | **Shared surface.** Their built-in scene *library* + this plan's Phase C scene *authoring* are complementary: they add scenes, we let designers place/edit them. Align on the same `PixelScenePlacementDef` writer. |
| P3 Runtime Content Materialization | **Shared requirement.** Both need preview==playtest one-data-path. This plan's Phase D defers to their materializer; just add `dressingOverrides` to what gets consumed. |
| P4 Builder World Generation UX | **Direct overlap — coordinate.** They add global sliders/sections/presets; this plan adds the **painting/override/brush** interactions in the same panel. Land this plan's Phase B as the "Dressing" section's brush tools inside their section layout, not a separate panel. |
| P5 Campaign Integration | **Out of scope here.** Overrides are a virtual-world/Builder authoring feature; do not push them into `CaveGenerator`/campaign saves without a separate decision (would touch golden hashes + `GEN_VERSION`). |
| P6 Heavy-Compute Backends | **Neutral.** `overrideFactor` must be portable to any future backend, same as every other pass; keep TS worker authoritative. |

### Convergence rule
One namespace, one pass path. If the rich-world session later makes `dressing.controls`
spatially-varying itself, **fold this plan's `DressingOverride` into that mechanism** rather than
keeping two. Until then, `DressingOverride` is the thin, additive, multiply-on-top layer.

## Validation matrix
- `npx tsc --noEmit`
- `npx vitest run tests/virtual-world.test.ts`
- `npm run build`
- `npm run verify:findability` (any blocking override/scene, or any campaign touch)
- Builder e2e: paint boost → regen → in-region only; suppress → removes in-region only;
  pixel-scene stamp appears; preview matches Play Window.
- `node scripts/perf-scene.mjs` only if anything adds runtime cost (overrides are bake-time only).

## Open decisions
1. **Panel home:** confirm Phase B brushes live inside the rich-world Phase 4 "Dressing" section
   (recommended) vs a standalone tool — needs sync with the concurrent session.
2. **Override storage budget:** low-res `Uint8Array` weight fields (cellSize 8) ≈ 1KB per painted
   room; confirm acceptable for world save size before Phase B.
3. **Material-swap surface vs features:** `surfaceCellForBiome` (`ChunkGenerator.ts:940`) currently
   hardcodes per-biome surface materials. Decide whether `materialSwap` should also reach surface
   vegetation (would require surface material to read the recipe/override instead of the hardcode) —
   recommend deferring until after Phase A proves the feature passes.
```


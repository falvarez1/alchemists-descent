# Duel stages: art pipeline

Four stock stages (`src/config/stockStage.ts`, concepts/stages.png): the Foundry, the Kiln, the Cistern and the Gallery.
Each is real cells (a solid MAIN platform with ledge corners, one-way raised platforms) in front of a painted backdrop
plate. "If the grid can't explain it, it doesn't ship": a platform's look is baked INTO its cells, so a destroyed cell
takes its colour with it; thin hangings (chains, lantern housings) are presentation-only decor that disappears with the
hull cell it hangs from; lantern glass is real Glowshroom (light, soft growth: bodies pass through it).

Per stage, under `public/assets/arena/<stage>/`:
- `backdrop.webp` (16:9, 2048 px): the far wall. `DepthScene.useStockBackdrop` frames it like a distant plane (it
  magnifies by a fraction of the camera zoom and drifts with a fraction of the camera pan; see `stockPlateFraming`).
- `thumb.webp`: the lobby tile (cut from concepts/stages.png).
- `<slab>.png` + `<slab>-decor.png` + `<slab>.json` per baked platform (`main`, `side`, optional `top`), made by
  `scripts/arena-stages/bake-slab.mjs` from a magenta-keyed render. `node scripts/arena-stages/gen-stage-slabs.mjs` then
  regenerates `src/content/arena/stageSlabs.generated.ts` (collision masks as code: synchronous and deterministic).

In the stage definition a baked slab is `fromArt('<stage>/<slab>', x0, y[, mirror])`: x0/y place it, the art sizes it.
One side-platform render serves both sides (`mirror: true` on the right).

## Generating the art (gpt-image-2, ElevenLabs flow "Duel stages")

- Backdrop: edit of the stage's concept with every gameplay element removed (platforms, figures, UI), the architecture
  continued behind them, the lower third a dark depth below the stage. 16:9, 2K, high.
- Main platform: custom 3840 x 1280, the platform spanning 2%..98% of the width with finished end caps, a perfectly flat
  top at ~6%, a deck band, an undercarriage, hangings below, flat pure magenta (#FF00FF) everywhere else, symmetric.
- Side platform: custom 3072 x 1024, same rules, top at ~20%.
- The exact prompts used are in `STAGE-PROMPTS.md`; the chosen sources are kept in `stage-sources/` (lossy WebP).

## Baking

`node scripts/arena-stages/bake-slab.mjs <render.png> --stage <id> --slab <main|side|top> --width <cells>
[--glass <hex>|none] [--glass-tol 170] [--glass-lum 140] [--preview <png>]`

The baker keys out magenta, finds the walking line (first row that is >60% solid), maps the art onto `width` cells,
keeps the largest solid body (thin chains do not survive an opening; lanterns are found by their glass hue and kept out
of the hull), fills enclosed holes as dark recesses, forces a flat two-row deck, paints the top row the concept's lit
copper `#efac58`, caps every hull colour below the bloom threshold, and writes the decor at half-cell resolution.
Check the preview and a collision overlay before using a bake: no lantern or chain may be solid, the top must be flat.

Warm-glass stages (the Kiln's furnace lamps) must not let copper trim read as glass: pass `--glass none` or a tight
`--glass-tol`/`--glass-lum`.

## Geometry rules

- Main platform top at y 640..655, centred on x 800; width 420..480 cells ("wider, like the stage we had").
- Raised platforms: one-way, at most 80 cells above the main top (Brann's jump + levitation reach), each overlapping or
  abutting the main platform's x-range so the CPU nav can rise beside it.
- Spawns on the main top, ~110 cells either side of centre, never under a raised platform's lantern.
- Blast zone stays `left 240, right 1360, top 180, bottom 940`.

# Duel stages: art pipeline

Four stock stages (`src/config/stockStage.ts`, concepts/stages.png): the Foundry, the Kiln, the Cistern and the Gallery.
Each is real cells (a solid MAIN platform with ledge corners, one-way raised platforms) in front of a painted backdrop
plate. "If the grid can't explain it, it doesn't ship": a platform's look is baked INTO its cells, so a destroyed cell
takes its colour with it; thin hangings (chains, lantern housings) are presentation-only decor that disappears with the
hull cell it hangs from; lantern glass is real Glowshroom (light, soft growth: bodies pass through it) that lights in the
lantern's own colour only while the hull cell its lantern hangs from stands (see Lamps).

Per stage, under `public/assets/arena/<stage>/`:
- `backdrop.webp` (16:9, 2048 px): the far wall. `DepthScene.useStockBackdrop` frames it like a distant plane (it
  magnifies by a fraction of the camera zoom and drifts with a fraction of the camera pan; see `stockPlateFraming`).
- `thumb.webp`: the lobby tile (cut from concepts/stages.png).
- `<slab>.png` + `<slab>-fine.png` + `<slab>-decor.png` + `<slab>.json` per baked platform (`main`, `side`, optional
  `top`), made by `scripts/arena-stages/bake-slab.mjs` from a magenta-keyed render. `node
  scripts/arena-stages/gen-stage-slabs.mjs` then regenerates `src/content/arena/stageSlabs.generated.ts` (collision masks as
  code: synchronous and deterministic).
- `node scripts/arena-stages/bake-stages.mjs [stage ...] [--preview <dir>]` re-bakes every slab from its source in
  `stage-sources/` with the parameters recorded there, then runs the generator. Change a stage's proportions THERE.

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
[--depth <cells> --repeat <x0,x1;...>] [--glass <hex>|none] [--glass-tol 170] [--glass-lum 140] [--glass-below 0.3]
[--lamps <x0,y0,x1,y1;...>] [--edge <hex>] [--max-lum 0.72] [--decor-max 0.8] [--preview <png>]`

The baker keys out magenta, finds the walking line (first row that is >60% solid), maps the art onto `width` cells,
keeps the largest solid body (thin chains do not survive an opening; lanterns are found by their glass hue and kept out
of the hull), fills enclosed holes as dark recesses, forces a flat two-row deck, paints the top row the concept's lit
copper `#efac58`, caps every hull colour below the bloom threshold, and writes the decor at half-cell resolution.
Check the preview and a collision overlay before using a bake: no lantern or chain may be solid, the top must be flat.

**Scale: concept proportions, wider platforms.** Without `--depth` the art is scaled to fit `--width`, so a platform made
wider than the concept also comes out deeper (the first bakes were about twice the concept's depth against a fighter).
`--depth <cells>` fixes the scale instead: the hull (deck top to its lowest solid row, hangings excluded) comes out that
deep, and the baker widens the art to `--width` by tiling the `--repeat` column ranges (source px, inclusive) in place.
Pick ranges of plain mid-span (a riveted plate run, a corbel-and-arch module, a stretch of beam between bracket and end
cap) whose left and right edges match, so the tiles join without a seam; the end caps, the lanterns, the chains and the
centrepiece (gear medallion, ship's wheel, banner, truss) are never in a range, so they keep their native aspect and size.
Every range gets the same whole number of extra copies (list a range twice to weight it); the scale is then trimmed so the
width is exact, which lands the depth within a few percent of `--depth` (the bake prints `scale`: target, native width at
that depth, copies, trim). The depths are the concepts', measured against a 19-cell fighter (Brann about 20): the
Foundry's hull 2.0-2.3 fighters (foundry-match.png), the others from their stages.png quadrant.

| slab | width | depth (target -> baked) | repeated |
|---|---|---|---|
| foundry/main | 480 | 44 -> 43 | riveted plate runs either side of the lanterns |
| foundry/side | 160 | 13 -> 13 | the beam between the end caps and the truss |
| kiln/main | 420 | 38 -> 40 | the plain body band beyond the lamps, and a post-and-X-bay each side of the centre boss |
| kiln/side | 150 | native (19) | none (the concept's ledge is a thick band) |
| cistern/main | 460 | 38 -> 39 | the girder run between the end and the lantern |
| cistern/side | 160 | 18 -> 19 | the walkway beam between the end caps and the bracket |
| gallery/main | 440 | 40 -> 43 | one corbel-and-arch module each side (530 px: the steps are coarse) |
| gallery/side, top | 130, 120 | native (14, 13) | none |

**Lantern glass.** Teal glass (Foundry, Cistern) is found by hue (`--glass`), and only blobs that start at least
`--glass-below` of the art's depth under the deck count (a lit deck edge is never a lantern). Warm glass shares its hue
with lit copper and gilt, so the Kiln and the Gallery name their lanterns with `--lamps` boxes (source px; they follow the
columns when the art widens) and only glass-coloured pixels inside them count. The mean colour of the glass is recorded as
the slab's `glassColor`. Hangings (decor, glass included) are capped at `--decor-max` (0.8 of full, under the 0.85 bloom
threshold): decor is drawn as authored colour, unlit.

Warm-glass stages (the Kiln's furnace lamps) must not let copper trim read as glass: pass `--glass none` or a tight
`--glass-tol`/`--glass-lum`.

## Lamps

`stockLampCells(stage)` (config/stockStage) lists every lantern's glass cell, the hull cell its lantern hangs from (the
first solid cell straight above the glass) and the light's colour (the slab's `glassColor`, brightest channel 1): Foundry
and Cistern teal, the Kiln furnace orange, the Gallery's lanterns amber and its bell jar violet. `world/stockStage`
stamps the glass as Glowshroom in that hue, held to a brightest channel of 70 (Glowshroom is emissive: x1.6 plus a
self-glow, so it composes at ~2.4x its colour by its own lamp; 70 stays under the bloom threshold). `render/Lighting`
seeds each standing glass cell in its colour, and only while its anchor is still Metal: cut the lantern's hull and it
goes dark with its hangings. Over the stage's 0.92 ambient that is a local tint (about 0.2 six cells out at full flame,
measured), never a bloom.

The lamps are alive (the Duel's direction: fast, arcade): the glass of one lantern (panes within 4 cells) burns as one
flame, and `stockLampLevel` (0.4..1, deterministic per tick) sets it: the Foundry's teal glass PULSES (a quick swell and a
slower fall, ~1.1 per second, each lamp a beat behind the last), the Kiln's fire-lamps FLICKER (fast waves, a fresh
jitter every 3 ticks, an occasional gutter), the Cistern's SHIMMER, the Gallery's amber lanterns burn like CANDLES and
its bell jar BREATHES. The light (`STOCK_LAMP_LIGHT` 0.36 at full flame) and the glass pixels of the lantern art
(render/StockStageArt) both follow the same level, so the flame you see is the light you get; glass whose Glowshroom is
gone draws dark (0.3). The level never exceeds 1, so the glass stays under the bloom threshold it was baked to. The
light does not reach the backdrop plate (the stock backdrop takes no real light, `DepthScene` lit 0), so a lamp's glow
shows on the hull and on fighters near it, not on the far wall.

## Geometry rules

- Main platform top at y 640..655, centred on x 800; width 420..480 cells ("wider, like the stage we had"); the hull at the
  concept's depth (about two fighters: `tests/stock-stages.test.ts` holds it to 46 cells or less).
- Raised platforms: one-way, at most 80 cells above the main top (Brann's jump + levitation reach), each overlapping or
  abutting the main platform's x-range so the CPU nav can rise beside it. Heights follow the concepts: the Foundry 56 (the
  concept's ~2.4 fighters; below the old 80, verify-stock-stationary's CPU lands its finisher from the lip at 27-31 cells
  instead of walking in to 10-12, so the probe's 30-cell bar sits inside its spread), the Kiln 30, the Cistern 40, the
  Gallery's side ledges 42 and its centred perch 78. The Kiln's and the Cistern's concepts sit lower still (about 12 and
  22 cells against the quadrant's figure), but their ledges stand beyond the main's ends there; overlapping it, lower
  would put a fighter's head inside the ledge at the main's corners.
- Spawns on the main top, ~110 cells either side of centre, never under a raised platform's lantern.
- Blast zone stays `left 240, right 1360, top 180, bottom 940`.

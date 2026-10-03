# Foreground foliage and concealment

A few damp moss roots grow a whole cover plant in front of actors. Each one is a
real plant drawn from four grammars (`src/world/flora.ts`), seeded by its root:

- **Fern**: five to seven arching fronds with staggered pinnae. The outer fronds
  bow past their peak, and one or two fiddleheads are still unrolling.
- **Broadleaf**: heart-shaped leaves on long petioles at staggered heights and
  tilts. Two of them hang over the crown's centre. Young leaves stand rolled.
- **Sedge**: arching straps, some snapped and folded, with cattail seed heads.
- **Spore lily**: a strap rosette whose nodding stalks end in glowing bulbs that
  pulse and shed slow motes.

Frond counts, lengths, arcs, tilts and layers all come from the seed, so no
two clumps share a silhouette. Placement allows at most one plant per 84×40
patch. The plant grows from the first moss root in the patch's anchor window,
and only where the floor is wide (footing) and the air above is open for 27
cells. Floor 1 has about 19 cover plants, against 117 identical fans before.
Ground roots grow small grass, sprigs, clover and moss cushions behind actors.
Wall roots trail drapes.

The colours come from the biome's climate. Verdant, damp, fungal, crystal, frost
and arid each have a cover ramp and a ground ramp. The arid fern is a dried
bracken. Cover plants are near-silhouettes lit at the rim by the real light
field. Where the alchemist stands, the leaves thin to a see-through window so
he stays readable. The window closes as concealment settles. Shoving through a
cover plant rustles it (`floraMoment` rustle) and shakes loose a leaf or two.

Stand still inside enough of the dark canopy for half a second to hide.
The HUD changes from `Keep still to hide` through `Settling into cover` to
`Concealed in foliage`. Walking or jumping out of the canopy exposes the player.
Casting, kicking, pouring or throwing a flask, taking a stagger, and burning
reveal the player. An attack delays re-entry into concealment for 1.5 seconds,
followed by the normal half-second settling time.

Creature sight loses the player's position, including the lantern's exact
tracking fix and a boss's lair watch. Creatures retain their last sighting and
can investigate sounds. Close contact reveals the player; a creature separated
by solid terrain does not cancel concealment merely by being nearby. Stone Maws
retain their existing short-range vibration sense. Cover does not grant damage
immunity or stop an attack already in flight. Arena rivals do not use this
expedition hiding mechanic.

![The alchemist hidden behind a lantern-lit broadleaf, with the concealment readout](images/foreground-cover.png)

## Material and rendering contracts

- The roots remain existing `Cell.Moss` with their existing saved life values.
  A stable spatial hash selects foreground patches. No cell placement, save
  layout, or generation version changes.
- Cover plants are 25–41 cells tall. One geometry (`buildFlora`: every organ
  is a quadratic midrib plus a width profile) drives the painter, heat contact
  (`visitSurfaceFronds` midribs) and cover (`floraCoverMask`). Wind gusts
  and per-leaf flutter are drawn only, and stay under one cell.
  `tests/flora.test.ts` requires every cover species to hide a standing body.
- Nine torso samples measure canopy overlap. At least 55% coverage is required.
  Burning plants, plants charred by 30% or more, and unsupported roots provide
  no concealment. Removing roots cancels it on the next simulation tick.
- `FoliageCover` runs after player movement and before creature perception.
  It reads nearby roots independently of the camera. Grounded state and actual
  displacement handle the physics engine's sub-cell gravity accumulator.
- `render/FloraPainter` rasterises each plant into a scratch bitmap at
  presentation resolution and blits it once (`blitFine`). Layers draw back
  to front, and front leaves cast contact shadows on back ones. Light-facing
  edges take the climate's rim colour, scaled by the real light. A moss mat
  roots the plant over the floor's top row, but never paints deeper into rock.
  Pickups, controls and portals thin the leaves around them instead of cutting
  holes. Iterate the look with `node scripts/flora-studio.mjs` (every species
  and climate on a stage) and `node scripts/shot-foliage.mjs` (in-game).
  Cosmetic detail switches cannot turn functional cover invisible.
- Concealment is transient and resets on death or level changes. Material
  charring continues to use the saved life plane.

Tuning lives in `src/config/foliage.ts`. The cover API lives on `Ctx`; gameplay
does not manipulate the HUD DOM.

## Reproducing the playtest

Use a freshly started Vite server. `node scripts/verify-foliage-cover.mjs
http://127.0.0.1:5187/` walks into a naturally generated Intake cover plant (the first with a clear runway) with native
keyboard input, waits for the HUD state, exercises real creature perception,
fires the wand with native mouse input and removes the actual roots. Captures,
a recording and measured results go to `verify-out/foliage-cover/`.

Unit tests also cover charring, burning, support removal, camera independence,
grounded gravity accumulation, close contact through terrain, level/death/arena
resets, foreground occlusion and the lantern tracking path.

## Paint cost and caching

Each plant's finished bitmap is cached (`FloraCache` in `render/FloraPainter`)
and re-painted only when its key moves. The key covers:

- **Motion:** cover plants use 2-tick sway buckets, staggered per plant; ground
  tufts use their lean, quantised to a quarter cell.
- **Pose and burn:** lean angle, parting, burn and burning.
- **Environment:** the light at the plant (1/32 steps), terrain chunk versions
  under it, and the camera pixel phase.
- **Cover plants only:** the alchemist's see-through window and any glyphs
  overlapping the plant.

Ground tufts have no per-leaf flutter (it was a third of a pixel), so a still
tuft is a plain blit. Small plants take one light sample. Bitmaps idle for 240
ticks are freed.

`node scripts/perf-flora.mjs [--profile]` starts its own fresh server and
measures six Intake spots in the real compose path with the clock advancing.
Ground cover went from 2.32 to 0.35 ms per frame (97% cache hits). Cover plants
went from 0.73 to 0.56 ms, about 1 ms at the busiest spot. These are single
local runs on one machine, with run-to-run noise of about ±0.2 ms.

## Results

Typechecking, ESLint and the production build pass, as do all 3,175 tests in
249 files. `tests/surface-flora.test.ts` requires every cover species to hide a
standing body, plants to vary by seed, and sparse placement. The native cover
probe passes 8 checks, and the living-foliage probe passes 15. Run both against
a freshly started server: a server that has hot-reloaded `SurfaceFoliage.ts`
gives the probe's `import()` a second module instance whose poses never move.

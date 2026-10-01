# Father Thorne, the Briar Heretic (Controller)

Passive **Rooted Camouflage**, tactical **Ironvine** (Z), ultimate **Overgrowth** (T). Spec: `docs/FIGHTERS.md` "10".
Code: `src/fighters/kits/father-thorne.ts` (the rules), `father-thorne-grow.ts` (the pure planners, the passive's state
machine and the `TUNING` object), `father-thorne-crop.ts` (the cell ledger that withers what she grew) and
`father-thorne-fx.ts` (the drawn tells). Tests: `tests/fighters-thorne.test.ts` (52, node-only). Live probe:
`scripts/verify-fighter-thorne.mjs` (116 checks, real key presses, paused deterministic ticks; screenshots to
`verify-out/fighters/thorne-*.png`).

This is the one fighter whose abilities are REAL GROWTH, so the work was mostly learning what the flora and the sim
will and will not do with cells a kit writes. What I found, because every later decision follows from it:

- **Vines do not age.** `handleVines` keeps a growth-energy budget in `world.life` (0 = charge it on the first sweep,
  >0 = may sprout, -1 = dormant) that only throttles NEW growth. Nothing in the sim ever removes a Vines cell for being
  old, and a dormant one is never touched again. "They wither after ~25 s" is therefore the kit's job (the ledger
  below), and the cells are written dormant (`life -1`) so they never sprout past what was written.
- **Trunk, Moss, Leaf and Vines are all soft growth** (`isSoftGrowth`): a body walks through them (`blocksEntity` is
  false), so nothing she grows can seal a route, and the findability BFS over `!blocksEntity` cells is unchanged by
  construction. The flip side: soft growth is **not a hand-hold** for the player's climb (`Player.hasClimbFaceAt` asks
  `physics.cellBlocks`, which is `blocksEntity`), which is why the roots needed a seam (below).
- **Growth needs rock to hold on to.** The sim detaches a Vines cluster, and drops a Leaf, that touches no load-bearing
  solid (`isSolid && !isSoftGrowth`); loose powder (sand, snow, gold) does not count. Every planner therefore
  treats only anchored rock as a surface (`isAnchor`): Ironvine refuses a sand floor, the Overgrowth covers none.
- **An unsupported Trunk stand is felled** (`game/Flora`): lifted into a rigid body and re-stamped as SOLID Wood where it
  lands, unless it has fewer than 10 cells (then it just crumbles). So every root is only planned where it touches
  anchored rock (`holdsUp`), appears top-down and withers tip-first, and `settleSupport` then fixes the times for the
  whole plan (roots that overlap or cross can otherwise appear, or go, in an order that leaves a fragment cut off for a
  tick): a root cell appears only once a held neighbour has, and goes before it loses its last way back to the rock.
  The unit tests flood every stand at every tick of the growth and of the wither over ten different zones (they fail
  on the first seed without `settleSupport`). The same felling applies to what the player does: a root stand that
  burns until it loses its roof falls as a log like any tree (the probe saw it, and resets the arena for it).
- **A scratched foe bleeds the game's ordinary gore.** Each scratch is `Enemies.damage`, so a golem sheds Stone chips that
  settle on the carpet as real Stone and a long-scratched golem climbs its own pile; that is the game's, not the kit's,
  and is why the golem trials in the probe are short.
- **Hanging Vines are lifted into swaying strands.** `entities/VineStrands` lifts any ceiling-hung cluster of 4+ cells near
  the player into a Verlet strand and takes its cells OFF the grid; a cell added under a lifted one has nothing above it
  and is dropped as a loose end of its own. So each hanging vine is written in ONE tick, and the ledger can sever a
  strand (`vineStrands.cutAt`, lowest cell first, so no loose end falls and settles somewhere new).
- **A creature in the lantern's beam sees the lantern whatever her concealment** (`creatures/lightResponse`, "being lit is
  information": it sets `mind.visible` and confidence 0.75). Concealment shortens the sight line; it does not turn the
  lantern off. The probe looks away from the foe for that reason.

## Rooted Camouflage

State machine in `Camouflage` (pure): she is *still* when grounded, `|vx| < 0.2`, and not carried (a dash, a climb, a
swing). After 60 still ticks, near cover (>= 6 cells of Moss / Leaf / Trunk / Vines / Fungus / Glowshroom in the box
10 cells either side of her body centre, re-counted every 6 ticks), `KitInstance.concealment()` climbs linearly 0 ->
0.6 over 180 ticks. Moving zeroes it at once and starts the whole wait again; losing the cover while she stays still lets
the ramp fall 6 ticks a tick (a burnt leaf must not leave her hidden). Her own Ironvine counts as cover (Vines): casting
it and then keeping still is how she hides.

- *What a foe notices*, measured with the same slime at the same distance (50 ticks, `mind.visible`): unhidden 43-50/50
  at 100 and 150 cells, hunts; rooted (0.6) 0/50 at both, confidence 0, forages; at 60 cells it still sees her 50/50
  (a shorter sight line, not invisibility). `Enemies.update` scales the light the eyes see by `1 - concealment()`.
- *Tells*: a few leaf motes fall slowly past her and sway (`motePose`, a pure function of the frame, drawn additively;
  more of them the further the ramp has come, now and then an autumn one); the HUD shows a **Rooted** meter (the settling
  second is a quarter of it, the ramp the rest) that is there only while she is still in cover; a soft rustle when the
  ramp starts, a flurry of real leaves and a rustle when a step breaks cover.

## Ironvine (Z, 720 ticks)

`planIronvine`: `findSurfaceStart` takes the nearest anchored surface to her feet (within 12 cells, ties toward the aim),
`walkSurface` follows it along the aim: each step goes to the open neighbour that still touches rock and carries furthest
along the aim, keeping its heading, never revisiting a cell, ending at 60 cells of progress, at a dead end, or where the
aim cannot climb (a wall at the foot of the floor stops an aim along the floor; an aim up and to the side climbs it).
Each path cell becomes a column 2-3 deep along the surface normal (the outermost cell is sometimes a pale **thorn**).
Floors, slopes, walls and ceilings are one code path. The front crosses 3 path cells a tick (60 cells in 20 ticks).
Nothing is written into her own body, a foe's, a loose crate's, or above a column whose base was skipped.

- **Real cells**: `Cell.Vines`, dormant (`life -1`), in a dark iron-green with pale thorn cells. Measured 133-147 cells for
  a 60-cell carpet on flat ground (columns of depth 2 and 3 in equal numbers, 26-35 thorns), all within the three rows
  above the floor (it starts at the edge of her own body: 6 cells off). The sim leaves them exactly as written (300 ticks
  later: the same count). They burn (fire at three spots took 135-141 -> 12-54 cells and left Fire, Smoke and Ash) and can be cut (a notch erased as the dig beam would stays cut).
- **Foes in or on them** (checked every 6 ticks, any Vines cell of the ledger inside the foe's body box): `sys.slowEnemy`
  x0.5 for 14 ticks (so it lapses within a quarter second of leaving), and 1 damage per 12 ticks via `sys.hurt`
  (measured 2-3 hp per golem per 30 ticks inside, 0 outside). The first foe caught is **marked** (`markEnemy`, 480 ticks)
  and shown through walls (`revealEnemy`, green), with an ENTANGLED callout; only the first.
  What the engine's slow does to a body: it multiplies `vx` once every second tick (`Enemies.update`), so an accelerating
  walker is held to a fraction of its distance and a hopper loses most of every hop. Measured, three golems 30 ticks each
  (the probe prints the ratio): 1-17 cells in all in the vines against 7-37 free (it varies with each golem's own pauses and
  with its stone gore; the slow is reported on 80% of the 6-tick samples, 0% outside); three slimes 70 ticks: 23-43 cells in the
  vines against 56-136 free, and a lone slime 4-11 cells against 45-58. It is clearly a slow, but "x0.5" is the factor handed to `slowEnemy`, not a promised halving of distance.
- **Wither**: a ledger (`Crop`) remembers every cell written. Each cell browns over 90 ticks and crumbles between 24.0 s
  and 26.0 s after the cast (`lifeTicks 1440 + spread 120`), the far end first. Measured: all 140 cells stand at 21.7 s,
  they are brown at 23.7 s, 29-66 of 133-147 remain at 25.3 s, none at 27 s. Cells the world took (burnt, cut, a rock the
  player put there) are let go and never touched; a Vines cell lifted into a strand by the sim is owed (withered if it
  settles back within 60 s) and its strand is severed at its time.
- **Refusals** (no cooldown, a dry click and a line over her head): nothing within 12 cells to grow on ("NOTHING TO GROW
  ON": measured high in the air), the aim carries nowhere ("NO ROOM TO GROW": measured straight up from a bare floor).
  Z while cooling is the ordinary refusal.
- Tell / sound / end: spores and a flash of green at her hand and a burst of earth; `flora.whoosh`, `flora.seed.sprout`,
  `flora.creak` at the cast, a rustle along the front, `flora.brush.grass` on each scratch, `flora.crack` on the first
  catch; glints on the thorns while it stands; the chip's ring is up while any cell stands (`tacticalActive`); the browning
  and the crumbling, with a creak, are the end.

## Overgrowth (T, 720 ticks, bar full)

`planOvergrowth` surveys the disc of radius 70 about her body centre once, at the cast (about 9 ms, one frame hitch):
anchored floors, ceilings and wall faces.

- **Roots hung from ceilings** (Trunk): a tapering, swaying column 3 -> 2 -> 1 wide, 18-44 cells, with side limbs, and a third of them
  reaching all the way down (up to 64) to 4-10 cells above whatever is below, so some always hang low enough to jump to; each tip
  stays inside the disc.
  Only where `holdsUp` finds the ceiling anchored. **Roots clinging up the wall** (Trunk): `walkSurface` along a vertical
  face, 2 (sometimes 3) cells thick. **Hanging Vines**: 5-18 long, one wide (a quarter two wide), written in one tick.
  **Moss and Leaf over the floors and walls** in patches (smooth value noise), ferns of one to three leaves stacked on a leaf
  that rests on the rock (each held by the one under it), a little moss under ceilings. About 850-1000 cells (605 Trunk, 130 Moss, 94 Leaf, 16 Vines cells and 13 swaying strands at 132 ticks in one probe run), over a ~50-tick
  wave from her outward (each cell appears when the wave reaches it; a root lengthens downward as it appears, the longest
  finishing at about 90 ticks).
- **Concealment 0.7** in the zone (read from where she stands, from the first tick), and nothing outside it; a foe in the zone is
  slowed x0.6 (refreshed every 6 ticks while it stands within the radius of the cast point).
  Measured with a slime 30 cells off: sees her 50/50; 100 and 130 cells off, overgrown: 0/50, bare: 43-50/50 (100 is at the edge of
  the shortened sight line, ~80 cells at 0.7: a wandering slime that gets that close does see her). Golems in the zone walk
  0.1-0.35 as far as free ones over 42 ticks (the engine's slow bites an accelerating walker hard); a foe 100 cells outside the
  radius is never slowed.
- **The roots are hand-holds.** The new `climbHold` seam (below) lets `Player.hasClimbFaceAt` count a Trunk cell of the
  Overgrowth's roots as a grip, so the player climbs them like any wall. Probed with real keys: jumping for a root that hangs
  7-14 cells above the floor with Shift held she latches on within 1-13 ticks, W climbs 18 cells in 40 ticks, S brings her down; the same jump
  at the same spot with no Overgrowth: nothing to grab. Natural Trunk (a tree) is not a hold.
- **Fail-open.** Everything is soft growth written into open air (a body walks through all four materials; the engine's own
  `cellBlocks` says none of the ~900 cells blocks), so the findability BFS from her to the far wall and to all four corners of
  the arena reaches exactly the same cells before and after, and the census of solids and powders is unchanged. Nothing is
  written in her body, a foe's, or a crate's. Roots are supported at every tick of the growth and the wither (the flora would
  otherwise fell them into solid logs: checked by flooding every stand each tick in the unit tests, and by the census of
  solids at the end of the live run).
- **Fire still burns it**: fire lit against the cover, in 620-680 ticks: Moss 139-167 -> 90-109, Leaf 79-109 -> 50-66, Trunk 413-595 ->
  160-390 (Trunk smoulders on its own rule), leaving Ash, Embers and Smoke (and, as above, burnt root stands fall as logs).
- **The end**: the first cells begin to brown 90 ticks before the effect ends, the zone's concealment and slow stop at 720,
  and the roots, vines, moss and leaves crumble over the next 150 ticks, tips first (a flake of dust each, a creak and a
  settling). By 908 ticks after the cast no Trunk or Moss remains and at most a couple of stray cells (a Vines cell from
  a strand that fell, a loose leaf) rest on the floor; no swaying strand of hers is left hanging.
- Tell / sound: a flash and an expanding ring of green motes sweep out from her to the zone's edge, which then holds a faint
  dotted line (the slow and the cover end there) that flickers over the last second; spores drift up through the cover; a
  big sound (`flora.canopy`, `flora.crack` low, `flora.whoosh`, `flora.ladder.bloom`), screen punch, rustles while it grows.
  **No authored light**: an authored light changes the darkness at her feet, which `playerVisibility` reads (with the hood up a
  lit spot shows her, with it down the dark is a beacon), so a stealth fighter's glow is drawn and not lit. (Not measured: the
  first version had the lights and was removed on that reasoning; the failures that seemed to confirm it were the lantern beam.)
- **Refused** (bar kept, a dry click, "NOTHING WILL TAKE ROOT HERE"): fewer than 40 cells to plant (an open void).

## Engine seams added

1. `FighterApi.climbHold(x, y)` (`core/fighters.ts`), `KitInstance.climbHold?(x, y)` (`kit.ts`), `FighterSystem.climbHold`
   (one line: the kit's answer, false for every other fighter and for the classic Alchemist).
2. `Player.hasClimbFaceAt` (`entities/Player.ts`): the hold test is now
   `ctx.physics.cellBlocks(sx, sy) || ctx.fighters?.climbHold(sx, sy) === true` (one line).

Nothing else outside `src/fighters/` changed.

## Numbers (`TUNING`, live-tunable)

| | |
|---|---|
| Rooted Camouflage | still: grounded, `|vx| < 0.2`, 60 ticks; cover: >= 6 cells in a 21 x 21 box; ramp 180 ticks to 0.6; cover lost: ramp -6 a tick |
| Ironvine | Z cooldown 720; reach 60; 3 path cells a tick; depth 2-3; slow x0.5 (14 ticks, checked every 6); scratch 1 per 12 ticks; mark 480; crumbles 1440-1560 ticks after the cast, browning 90 first |
| Overgrowth | T, 720 ticks; radius 70; sweep 50 ticks; concealment 0.7; foes x0.6; wither 150 ticks after the end (browning 90 before); <= 2600 cells; roots <= 14 (14-44 long), wall roots <= 9, vines <= 18 |

## Deviations from the spec, and why

- **The vines' lifetime is the kit's, not the sim's** (Vines never age: see the top).
- **Roots are Trunk (soft, walk-through) with a climb seam**, not hard Wood: hard cells of 5+ in a cluster block a body, which
  could seal a corridor; soft cells cannot, and the seam keeps them climbable.
- **The slow's strength is the engine's** (`vx` multiplied every other tick), so "x0.5" is the factor handed to
  `slowEnemy`, and the distance a foe covers is measured, not asserted to be half.
- **No authored light for the Overgrowth or the Ironvine cast**: it would move the darkness `playerVisibility` reads at her feet and
  muddy her concealment's arithmetic; the flash is drawn.
- **Withers** (spec: Ironvine only): the Overgrowth's cells also wither after the effect, because a floor must not be left
  permanently overgrown by an ability whose rule is "a lifetime is always bounded".
- Sand, snow and gold are not a surface: Ironvine refuses them and the Overgrowth plants none on them (the sim would drop
  what grew there).

## Not verified / known limits

- Sound: existing cues only, and none can be heard here (the probe asserts the cue ids requested and that each exists):
  `flora.whoosh`, `flora.seed.sprout`, `flora.creak`, `flora.rustle`, `flora.brush.grass`, `flora.crack`, `flora.canopy`,
  `flora.ladder.bloom`, `flora.settle`, `wand.dry`.
- **A saved run** keeps the cells but not the ledger: a run saved and reloaded mid-effect leaves the vines as ordinary dormant
  Vines (burnable, cuttable), and the zone as ordinary flora.
- **A stray cell or two** can outlive a cast: when the sim has lifted a hanging vine into a strand and the strand budget (48)
  is full, `cutAt` settles the fragment where it lands. Seen: 0-2 Vines cells on the floor 3 s after the end.
- The roots hang and the vines sway in rock the probe built (a 49-cell-tall arena); on a real floor the ceilings are whatever
  the generator carved. Not tried on a campaign level with its own population, nor with a boss.
- Real-time (unpaused) play was looked at only through the harness' paused frames; the kit runs entirely inside the 60 Hz tick
  (the cast tick costs ~11 ms once, growth adds ~0.5-1 ms a tick while it grows).
- The roots are climbable by a jump only where one hangs within about a jump of the floor (the lowest of a zone came within
  6-17 cells of the floor in the probe's arena); higher roots are reachable from a ledge, the jet or a wall climb.

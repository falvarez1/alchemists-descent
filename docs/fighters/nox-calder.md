# Nox Calder, the Lampblack (Controller)

Passive **Soot Sight**, tactical **Blackglass** (Z), ultimate **Long Night** (T). Spec: `docs/FIGHTERS.md` "06".
Files: `src/fighters/kits/nox-calder.ts` (the kit: wiring and the grid), `nox-calder-math.ts` (the pure rules and the
whole `TUNING` object, node-tested), `nox-calder-art.ts` (the four drawables). Tests: `tests/fighters-nox.test.ts`
(41). Live probe: `scripts/verify-fighter-nox.mjs` (`node scripts/verify-fighter-nox.mjs http://localhost:<port>/`,
87 checks, repeated clean five times, real key presses, paused deterministic ticks; `NOX_ONLY=soot,glass,refuse,notice,fire,cost,night,bakes,cut`
runs a subset; screenshots land in `verify-out/fighters/nox-*.png`).

**Engine seams added: none.** The kit stands on the framework (`setMod`, `addDrawable`, `addLight`, `revealEnemy`,
`callout`, `concealment()`, `tacticalActive`) and on what the engine already reads (`Enemies.update` scaling the light on
her by `1 - concealment()`, `lightQuery.darkness`, `darkMapFor`'s array-identity cache, `authoredLights`). It does touch
one piece of shared *data* for the length of a night (see Long Night, "a lent profile").

## Findings that differ from the brief's hints (read these first)

1. **The sim does not burn smoke.** Fire only ever moves up into Empty cells and never swaps with or consumes a gas;
   measured: a 116-cell wooden stack burning inside a 900-cell Smoke disc left the cloud at 892 -> 896 cells until
   the cells' own lives ran out. So "lighting the cloud thins it" is a rule of the kit, inside its own clouds (below).
2. **A smoke cloud does not stay where it is put.** A packed block of Smoke rises as a mass at about 0.45 cells a tick
   (a radius-20 disc lifted off the floor in ~100 ticks and was under the ceiling 145 cells up at ~260), whatever life
   it has. A cloud with a life of 240-420 and no vent hides a floor-standing player for about 1.5 s. Hence the vent.
3. **An unknown level has a null dark map.** `darkMapFor` returns null for a level whose id has no `FLOOR_DARKNESS`
   profile, whatever zones it has (the physics arena, Builder playtests, custom runtimes). All six campaign floors
   have one. Long Night lends a profile to a level that has none, for the night only.
4. **An unhooded lantern in the dark is a beacon** (`playerVisibility`: +0.3 x darkness). Her Long Night concealment
   of 0.5 is therefore worth less than it sounds: measured below.

## Soot Sight (passive)

On when she stands in the dark (`lightQuery.darkness(chest) > 0.5`) or in smoke (6+ `Smoke` cells in the 9 x 9 box
around her chest). While on, every foe within 160 cells **that she has a clear sight line to** (a 1-cell march of the grid:
rock stops it, a gas does not, and a foe pressed to a wall is still seen) is shown as a faint pale silhouette:

- the shared reveal (`sys.revealEnemy`, a dim `[0.6, 0.68, 0.8] x k`, k falling from 1 at 64 cells to 0.4 at 160: the
  shared default is a bright `[1, 1, 1]`): a dotted ellipse and a chevron over the head, refreshed every 3 ticks with a
  7-tick hold, so it lapses within about a third of a second of the sense going out;
- a kit-owned veil: a dithered pale body-ellipse (additive, breathing) under it, so a foe that is a dark shape in a dark
  room is a shape;
- a **pulse** when the sense comes on: a faint ring goes out to 160 cells over 24 ticks and a foe is shown as the pulse
  passes it (near ones first), with `light.eyeshine`. A mist that flickers at the edge does not re-pulse (150-tick rest)
  and the sense only goes out after 14 ticks without the condition (smoke thins cell by cell).

She sees *through the dark*, not through rock: Mara's and Sable's reveals go through walls; this one deliberately does not.
Information only: it changes nothing a foe does.

Measured: lit arena, nothing shown; 11 x 11 patch of real Smoke cells, pulse reaches the foe at 70 cells at ~12 ticks and
the one at 130 at ~22, the one at 200 never, a foe behind a stone wall never; same with a real dark zone
(`darkness` 0 -> 1); lapses in ~20 ticks when she steps out. Reveal colours near `[0.59, 0.65, 0.76]`, far `[0.34, 0.37, 0.44]`.

## Blackglass (Z, 720 ticks)

A **canister** (kit-owned, a drawable: dark glass with a brass stopper, spinning; the stopper blinks as the fuse
runs down) thrown along the aim from the wand tip at the Flask's own speed 6.5 and gravity 0.18, sub-stepped like
`Flask.flyBottle`: `tests/fighters-nox.test.ts` holds it against an independent copy of that arithmetic, and the probe
against the real engine tick for tick (15 ticks of flight, the same burst cell). It bursts in the last free cell before the first
solid (a liquid also stops it, like the Flask), on a foe's body (so a thrown canister that meets a foe breaks on it), and
after a 45-tick fuse in open air. Refused with "NO ROOM TO THROW" (no cooldown spent, a dry click) when a solid is within 3
cells along the aim.

**The cloud is real Smoke cells.** At the burst the kit plans the cloud once: a 4-connected flood from the burst
cell through the open cells within 34 of it (so it fills the room it is in and does not leak through rock or a diagonal
crack), the nearest 1250 kept with a ragged rim: a disc of radius ~20 in open air, a run along a corridor, a
fill of a small room. It **blooms** over 10 ticks (most of it in the first 5), each cell written by
`world.replaceCellAt` with its own `world.life` of 240-420 ticks (without a life the sim deletes a Smoke cell at once) and a
charcoal colour darker than the sim's own smoke. A **vent** then keeps the nearest 760 cells fed (at most 10 cells a
tick, only into Empty cells) for 240 ticks, so the cloud at her feet stays dense while the rest of it rises, spreads under
the first ceiling and burns off by itself. Measured in the arena: 1138 cells 14 ticks after the burst, 2378 at ~140, a peak of 3390
at ~260 (the vent has just closed), 1911 at ~400, none left by ~750; no solid or powder changed (census).

**Her cover** is read off the cells: `smokeCover` of the Smoke cells in a 15 x 19 box around her chest over the
open cells in it (nothing below 12%, all of 0.85 at 50%), eased up fast and down slowly, and returned by `concealment()`.
`Enemies.update` scales the light on her by `1 - concealment()` and the foe's mind turns light into sight range, so:

| distance | no cloud | in the cloud (cover 0.85) |
|---|---|---|
| 40 | seen 50/50, hunts | seen 50/50, hunts |
| 100 | seen 44/50, hunts | seen 0/50, confidence 0, forages |
| 150 | seen 50/50, hunts | seen 0/50, confidence 0, forages |
| 170 | seen 50/50, hunts | seen 0/50, confidence 0, forages |

The same slime, the same distance, 50 ticks (the foe is spawned 60+ ticks after the throw so the throw's own sounds have
aged out of its hearing). Her sight line in the cloud is about 70 cells and a foe at 40 still sees her: a short sight
line, not invisibility. The chip glows (`tacticalActive` = cover / 0.85) while she is hidden. Cover held at 0.81-0.85 for
the first ~260 ticks standing 10 cells from the burst and was 0 by ~400 as the cloud thinned.

**The look.** The sim draws a gas as a stipple you can see through, so a cloud of it reads as a mist. A veil drawable
(`drawVeil`) lays a 50% alpha-over on every Smoke cell of the kit's own clouds (a ~0.2 ms, ~12k-write cost against a stub
surface with a full cloud up), so the cloud reads as dense and dark on lit rock and a foe standing in it is dimmed:
the smoke blocks her own view too, which is what Soot Sight is for. It is drawn before the Soot Sight veil, so the
silhouettes show through it.

**Fire in the cloud** (finding 1). Every 3 ticks the kit scans each live cloud's box (it follows the smoke up) for Fire,
Lava and Ember cells and removes Smoke within 2 cells of them (60% a pass, at most 500 a pass, a few embers of cosmetic
sparks). The first flame to touch a cloud also **shuts its vent for good** (what is left in the canister burns: a hiss).
Measured, two identical clouds, a real wooden stack lit in the middle of one: control 2706 cells at +140 ticks, lit
1187 (peak 58 Fire cells); the unlit one is untouched.

Real cells only, gas with a life: nothing here can seal a route.

## Long Night (T, 720 ticks)

At the press (`ultimate()`):

- `setMod('long-night', 722, { concealment: 0.5 })`; `light.lantern.hood` and a dusk ring (`drawDusk`: an alpha-over ring
  of near-black with a soft trailing gradient travelling out to 190 cells over 14 ticks, its edge wobbling like ink).
- The **lamps**: every `authoredLights` entry within 260 cells of her (not one the kit added itself) is remembered with
  its intensity and goes out in a wave, nearest first: `0.1 ticks per cell` later, over 10 ticks (a flicker while it
  goes), each with a curl of soot and a `light.bloom.furl`. Anything beyond 260, and the whole of the level's other lights, are
  untouched. Her own lantern is the wand light: nothing here touches it (measured `wandLight` beside her
  0.76 before, 0.76 during; the lantern is not hooded).
- At **14 ticks** the dark falls: `runtime.darkZones` is replaced by a NEW array holding the level's own zones plus an
  ellipse 210 x 130 around her (strength 1; the bake keys on the array's identity, and mutating the level's own array would
  never be noticed), and `darkMapFor` is called once, there, on that frame. `mat.hollow` and a nudge of shake. The dark follows the rock as
  the engine's bake does (open air from the core, a cave the ellipse merely overlaps stays lit).
- **A lent profile.** If the level id has no `FLOOR_DARKNESS` entry (finding 3) the kit sets `{ base: 0, deep: 1 }` for the
  night and deletes it at the end; a floor with its own profile (all six campaign floors) is never touched.

While it lasts, the lamps stay out and she is half-hidden (and Soot Sight is on: the zone reads darkness 1). In the **last 40 ticks** the lamps
come back nearest first over 12 ticks each (a stutter), so light returns before the dark lifts, with `light.lantern.unhood`.

At the end, on a death, a respawn, a new floor, an unequip and on leaving play for the editor (`modeChanged`):
every lamp is set to exactly the intensity it had (`===`), the zone array is put back **by identity** (or the property is
deleted if the level had none), the lent profile is removed, the modifier cleared, and, if that level is still the one on
screen, `darkMapFor` is called once more. The night holds the *runtime it darkened*, not `ctx.levels.current`, so a floor
change restores the old level and leaves the new one alone (unit-tested with a swapped `levels.current`).

Measured (the real engine): lit lamp-lit point 1.7 -> 0.15 during -> 1.7 after; open ground 0.93 -> 0.03 -> 0.93;
`darkness` at her 0 -> 1.0 -> 0; a point beyond the zone and a lamp 300 cells away unchanged; foes (a slime that sees her
to ~190 cells in this arena): before 100 and 170 both see her, during (cover 0.5 and the beacon) 100 still sees her and
170 does not, and **the control proves it is her cover**: the same night with the modifier cleared, a foe at 200 sees
her (the beacon pushes sight to ~265). Soot Sight shows the foes within 160 and not the one at 210.

**The bake.** Once at the fall and once at the end, never per tick (the map is the same object for the whole night; unit
test pins the zone array's identity across 200 ticks). Measured in the browser, on the six campaign floors: 14-25 ms at the fall
(d1 25, d2 15, d3 18, d4 21, d2b 14, d3b 14) and 6-20 ms at the end (it re-bakes the floor's own zones); in the arena 10-28 ms and 4-8 ms.
A one-off hitch of one to two frames, on the frame the dark falls, under the dusk ring. Weaker machines will see more. (An early
run in a cold page measured 55 ms for the first bake: the engine's scratch arrays are allocated on the first one.)

## Numbers (`TUNING`, live-tunable)

| | |
|---|---|
| Soot Sight | range 160, darkness > 0.5, smoke 6 in a 9 x 9, re-look 3 ticks, hold 7, off after 14, pulse 24 ticks, rest 150 |
| Blackglass | cooldown 720; speed 6.5, gravity 0.18, fuse 45, hand 9, min room 4; cloud 1250 cells, reach 34, life 240-420, bloom 10, vent 240 ticks x <= 10 cells over the nearest 760; cover max 0.85 (12%..50%), box 15 x 19, rise 0.2 / fall 0.045; burn every 3 ticks, radius 2, 60%, cap 500 |
| Long Night | duration 720; concealment 0.5; lamps within 260, wave 0.1 tick/cell, fade 10; windup 14; zone 210 x 130 strength 1; dawn 40 ticks (0.08 tick/cell, 12 each) |

## Cost

Measured with a full cloud up (2170 cells): the kit's own tick 30-70 us (`readCover`'s 285-cell box, the clouds, Soot Sight);
a whole game tick 1.12 ms with no cloud and 1.63 ms with it (the sim's own cost of the cells); her drawables 0.19 ms and ~12.5k pixel
writes against a stub surface. The dusk ring is up to ~40k fine-pixel writes a frame for 14 frames.

## Deviations from the spec, and why

- **A vent.** The spec's "radius ~20, life 240-420" cloud rises away from the floor in about 1.5 s (finding 2); the vent keeps it
  at her feet for 4 s. The burst is still a radius-20 disc of cells with those lives.
- **Fire burns the cloud by a kit rule** (finding 1), and a lit cloud's vent shuts.
- **The cloud fills the room** (a flood, 1250 cells) rather than stamping a disc, so it is as dense in a corridor as in a hall.
- **Soot Sight needs a clear line.** The spec says "through the dark"; she does not see through rock.
- **Long Night has a dusk and a dawn** (a 14-tick windup before the dark falls; the lamps return over the last 40 ticks) so the
  start and the end are felt and the one bake is under a tell. The zone is 210 x 130 around where she stands when it
  falls (static: a per-tick re-bake would be the cost the brief rules out).
- **Long Night lends a profile** where a level has none (finding 3).
- **Concealment in the dark is partial** (finding 4). The spec's 0.5 is kept; hooding her lantern (L) on top of the
  night makes her nearly unseen, which is the intended combination. Raising the number is one dial.

## Not verified / known limits

- The cloud is only as good as the room: in the open it is a column (the arena has a ceiling 145 cells up), under a low roof
  it pools and thickens. Not tried by hand in each of the six floors' caves; the floors were only run with Long Night.
- Sound: existing cues only, none heard (`flask.throw`, `flask.shatter`, `mat.steam`, `mat.hollow`, `mat.sizzle`,
  `mat.ignite`, `light.lantern.hood`, `light.lantern.unhood`, `light.bloom.furl`, `light.bloom.open`, `light.dark`,
  `light.eyeshine`, `wand.dry`); a unit test checks every id asked for is in `SFX_CUES`.
- Other artificial light is not snuffed: lit braziers (mechanism state), photocells, the set-piece tells and the
  fixtures' own sprites keep their glow. The spec says authored lights.
- Real-time (unpaused) play was only watched through paused frames.
- The shared reveal ring (`render/fighterReveal.ts`) is sized from `def.halfW` / `def.h`, so it rings a wide, many-limbed
  body (a Weaver, a Rillback) at its trunk, not its reach. It reads fine dim; it is not changed here.
- The physics arena puts its own lamps in different places each boot (5 of 11 were within 260 cells of her in one run, 3 of 8 in
  another), so the probe judges every lamp by its own distance rather than by a fixed list.
- The `physics-test` harness leaves the floor's title card and a pickup toast on the real clock: the probe lets the world run live for
  7 s once before it photographs anything.

# Mara Quell, the Bell Witch (Controller)

Files: `src/fighters/kits/mara-quell.ts` (the kit), `mara-quell-logic.ts` (the maths: pure, no engine imports, every
number in one `TUNING`), `mara-quell-draw.ts` (the drawables: ripples, bells, rings, the wave, the marks). Tests:
`tests/fighters-mara.test.ts`. Probe: `scripts/verify-fighter-mara.mjs` (`node scripts/verify-fighter-mara.mjs
http://localhost:<port>/`; screenshots land in `verify-out/fighters/mara-*.png`).

## Final numbers (`TUNING`)

| | |
|---|---|
| Keen Resonance | range 200 cells, a ripple every 14 ticks while a foe keeps moving, 54-tick life, brightness 1 at point blank falling to 0.16 at the edge of range, at most 40 alive |
| Resonance Bell | Z, cooldown 840 (14 s); two bells at most (a third retires the oldest); each lasts 1800 (30 s); placed within 70 cells of her; rings for a waking foe within 70 cells of it; reveals every foe within 100 cells for 240 (4 s); deaf for 360 (6 s) after ringing; listens 18 ticks after it is hung |
| Dead Chime | T, `ultimateDuration` 360 (the slow's own clock, so the chip shows the effect running); wave 150 cells in 20 ticks (r = 150 (1 - (1 - t/20)^1.7)); slow x0.45 for 360; stun 180 on mage, spitter, wisp, bomber; hostile shots inside the ring are removed |

## How each ability is made of grid, not flags

**Keen Resonance.** The kit walks `ctx.enemies` every tick and keeps a tiny memory per foe (`FootTrack`, in a
`WeakMap`): the smoothed cells it moves per tick, ticks in the air, a 14-tick cooldown. A foe within 200 cells that is
moving on a surface (the ground, or a wall for a crawler) makes a `step`; a touchdown after four or more airborne
ticks makes a `land` (a wider, brighter ripple); a foe that stands, hangs in the air (bats, imps, wisps: no
footfalls) or merely jumped into range (a stride over 12 cells in one tick is a jump of the record, not a stride)
makes nothing. The ripple is made only if `sightClear(world, her head, its chest)` says the grid hides it: a foe in
plain sight needs no ripple. A ripple is a point, a birth frame and a power (`ripplePower(distance)`: nearer is
brighter). `drawRipples` draws each as two fine-pixel elliptical rings on the 'over' layer (after the light, so it
reads through rock and through darkness), additive and violet, expanding and fading; no `Math.random` and no
`fxRandom`: only the frame and a hash of the angle, so a held frame is the same frame. The first ripple of a stranger
who has been quiet for 4 s plays one faint `pickup.bell` (gain 0.34 x its power, at most one per 2.5 s) so the ear
learns what the eye will see. Information only: nothing a foe does changes.

**Resonance Bell.** The bells are the kit's own: a `BellBook` of at most two, not saved, not written into the level,
cleared by `reset()` (a respawn, a floor change, unequip). Where it hangs is a search for the open spot nearest the
aim: the target is the aim ray's end (the cursor's distance, held to 70, stopped at the first solid by `castToSolid`),
or her own feet when the cursor is within 10 cells. `findBellSpot` scans a window around it for two kinds of spot,
each a footprint of cells that must all be open (not solid, not liquid):
- a **post**: foot cell open with solid under it, the post 14 cells tall, an arm of 5 reaching the side she faces, the
  bell (7 wide, 9 tall) hanging from its end (this is why `effects.findLanding` is not used: it wants a 17-tall
  body-sized room, and a bell needs a different shape of room);
- a **chain from the ceiling**: first open cell under rock, three links, the bell below.
The nearer the bell's middle to the aim the better (ties go to a post, then to the side she faces), the spot must be
within 70 cells of her chest and reachable by a straight line from the aim point that crosses no rock, so a bell can
never appear behind a wall she aimed at. No spot (a sealed crawl pocket) refuses: no cooldown is spent, the chip
flourishes its refusal and a dull `tk.fizzle` sounds. The bell is *supported by real terrain*: every 10 ticks it checks
the solid cell under its post or over its chain, and when the floor is dug or burned away it comes down (a clatter of
brass, `body.impact.metal`). Each tick it listens for the first waking foe (not asleep, not an egg clutch) whose
centre is within 70 cells of the bell's middle; on a ring `revealEnemy(e, 240, violet)` goes to every foe (a sleeper
too) within 100 cells, with `pickup.bell` and a quiet `world.gong` at the bell, a ring of light (`sys.addLight`, 34
ticks, removed when it lapses or the floor changes, so nothing of hers is ever left in a level that persists) and a
ring pulse drawn out to the reveal radius, so the player sees how far it listened. After it rings it is dull for 6 s,
and begins to listen again with a small bright note and a glint on the lip. It swings when struck (a decaying
pendulum), fades over its last second and over a retirement (a dithered dissolve), and a retired bell gives one low
`pickup.bell` and a puff of violet.

**Dead Chime.** `ultimate()` is the cast: a gong and a bell at her chest, a flash, a light, a burst of motes, a screen
punch. `ultimateTick()` steps the wave for 20 ticks: each tick the radius is `waveRadius(elapsed + 1)`, every foe
whose centre is inside it (and not yet reached) is slowed (`sys.slowEnemy`), and every hostile projectile inside it is
removed from `ctx.projectiles` in place (a swap-pop; the array is shared) with a violet puff and, for the first three,
a small high `pickup.bell`. Mage, spitter, wisp and bomber are also stunned (`sys.stunEnemy`, 180 ticks). The foes it
reached carry a mark for as long as the effect holds on them: a slow violet toll under the feet while slowed, three
violet stars circling a stunned caster's head. The wave itself is a bright leading ring with two fading echoes,
additive on the 'over' layer, drawn through rock for its 20 ticks of growth and a 12-tick fade. When the effect's 360
ticks run out one low note closes it. Bosses (colossus, leviathan, rime warden, lens wright) and the egg clutch are
neither slowed nor stunned (their phases and "destroy it or it hatches" are authored), and the kit touches no
mechanism, no door, no cell: it cannot block a route.

## Engine seams

One, in a shared file, additive and guarded:
- `src/entities/Enemies.ts` (the Weaver branch of the tick, `intent.speedScale`): multiplied by
  `ctx.fighters?.enemySlow(e) ?? 1`. The Weaver crawls on its own locomotion (`weaverLocomotion`), which the shared
  slow (`e.vx *= enemySlow`, Enemies.ts around line 2747) never reaches, so the chime would have rung a crawler's feet
  and slowed nothing. A no-op without a fighter. Any other kit's slow (Ironvine, Overgrowth) gets it too.

`FighterSystem.ts`, `kit.ts`, `core/fighters.ts` are untouched. The kit's drawables carry a `tag` and a `state` that
the probe reaches through `ctx.fighters.drawables` (the game only ever reads `layer` and `draw`).

## What was measured (real engine, `scripts/verify-fighter-mara.mjs`, 99 checks, repeated)

- A patrolling golem behind a wall: 5 ripples in 70 ticks, 14 ticks apart, all at its feet along its beat; the drawable
  (run against a recording surface) puts 200+ fine pixels there, violet (blue > red > green), the same twice for the
  same frame. A foe in plain sight: none. A foe at 165 cells is felt, one at 215 is not. Two golems dropped together
  behind rock land on the same tick and each leaves a wide ripple; the one at 125 has power 0.37 and a peak drawn pixel of
  1.33, the one at 195 has 0.16 and 0.59. A bat, a wisp and a motionless foe leave none.
- The bell: Z with the aim on the floor 40 cells off hangs one post bell at the aim's column, standing on stone, within
  70 of her; cooldown reads 14 s; a second Z while cooling is refused; 840 ticks after the press it is ready. The
  third bell retires the oldest (a low note) and the meter stays at two. A far cursor is held to 70. Aimed at a slab it
  hangs from it on a chain. A foe at 90 and one at 120 and a sleeper at 80 do not ring it; a waking foe at 60 does:
  the foes at 60, 90 and the sleeper at 80 are revealed, the one at 120 is not; the reveal is gone just after 240
  ticks; the ring of light is added and removed; the bell is deaf for 360 ticks (100 ticks later it has not rung
  again) and rings again 360 ticks after the first. Gone at 1800 ticks. Dig the floor from under it and it comes down
  within 10 ticks. A sealed 9-high crawl pocket refuses with nothing spent. The run save contains nothing of it; an
  emitted `levelChanged` clears it and puts the passive's drawable back.
- The chime: refused with the bar short. Cast: the bar is spent and the chip shows the effect (active 0.99). The ring
  is drawn at the wave's radius (68 cells at tick 5, 111 at tick 10), over the stone floor. Foes at 60 slowed by tick
  5, at 100 (and the bomber at 80) by tick 10, at 140 by the end; at 165 and 200 never. The four casters are held
  (knock state) until 180 ticks after they were reached; the golem and slime are slowed but not stunned. Hostile shots
  at 40, 105 and 145 cells are gone (the one at 175 and a friendly one stay); no mechanism's state changes. Slows lapse
  just after 360 ticks. A colossus and an egg clutch in the ring are untouched, a golem beside them is slowed. A
  fleeing weaver's crawl speed (`weaverLoco.speed`) falls from 2.0 to 0.9 cells a tick (0.45).
- Cost: the wave's `draw` is 0.5-0.9 ms for 10.8k fine pixels at its full size on a no-op surface.
- Looked at (real frames): the ripples through rock in the arena and in The Bellows (a chamber carved under the
  floor), a bell on the floor beside a waystone and one hung from a slab, a bell ringing with two slimes revealed, the
  chime's wave early, mid and fading with the tolls and the stars on the foes it reached.

## Deviations and notes

- `ultimateDuration` is 360, not 0: the spec's "instant, effect 360 ticks" is read as the cast being instant and the
  effect running 360, and the system only shows an `active` chip (and runs `ultimateTick`) for a duration. The bar does
  not charge while it runs (the system's rule for every ultimate).
- **The shared slow is much harder than its number for walkers.** `FighterSystem.enemySlow` is applied as
  `e.vx *= factor` on every second tick (Enemies.ts, the sampled-status block), so an accelerating walker is slowed
  far below x0.45. Measured with the chime on foes hunting her from 120 cells, over 40 ticks: a golem 24 -> 0 cells, a
  slime 48 -> 3, a bat 50 -> 23, an acid slime 15 -> 4; a patrolling golem covers 17% of the ground (53 -> 9 cells in
  120 ticks); the Weaver, through the new seam, is x0.45. If a true x0.45 is wanted for every kind, fold
  `enemySlow(e)` into `spd` at Enemies.ts (`const spd = difficultyMods(...).enemySpeed * enemyMovementPace(ctx)`) and
  drop the vx scaling: one change that moves every kit's slow together. Left as the framework has it.
- The ping when a stranger first starts to move behind rock is mine, not the spec's (quiet, rate-limited): drop the
  `ctx.audio.sfx` call in `listen()` if it is unwanted.
- A bell is rung only by a foe that can come: a sleeper and an egg clutch do not ring it (a sleeper is still revealed
  when something else does).
- The bell shows on the HUD through `meter()` (Bells 0..2). It needs the chip row to render a kit meter, as Brann's
  Pressure does; nothing else of the HUD was touched.

## Not verified

- Bells in a flooded or burning cave over many minutes (a bell is only checked against solid cells; a liquid that
  rises over it, or a fire, does nothing to it).
- Keen Resonance with a crowd (dozens of walkers out of sight at once): the per-tick cost is a distance check per foe
  and one `sightClear` per ripple born, capped at 40 ripples alive; not benchmarked in a full floor.
- `reduceFlashes` (calm) draws steadier rings; read in code, not screenshotted.
- Touch and gamepad aiming: the placement reads `ctx.input.mouse` for the cursor distance; with an aim guide the
  cursor may not be where the aim is (a far cursor still places at 70 along the aim).

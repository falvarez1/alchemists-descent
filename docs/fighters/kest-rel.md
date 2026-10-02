# Kest Rel, the Chimney Jack (Duelist)

Passive **Rooftop Runner**, tactical **Smoke Step** (Z), ultimate **Updraft** (T). Spec: `docs/FIGHTERS.md` "05".
Code: `src/fighters/kits/kest-rel.ts` (the rules and the `TUNING` object), `kest-rel-math.ts` (the pure maths),
`kest-rel-furnace.ts` (the furnace's pixels). Tests: `tests/fighters-kest.test.ts`. Live probe:
`scripts/verify-fighter-kest.mjs` (67 checks, real key presses, paused deterministic ticks; screenshots to
`verify-out/fighters/kest-*.png`).

**Engine seams added: none.** The kit stands entirely on the framework (`setMod`, `startMove`, `addDrawable`,
`addLight`, `callout`) and on the seams already in the engine (`climbScale()` in `Player`, `concealment()` in
`Enemies.update`). `FighterSystem.setMod` already copes with an infinite lifetime (`until = now + Infinity`,
and `now >= Infinity` is never true); a unit test pins it.

## Rooftop Runner

A modifier with no end: `setMod('rooftop-runner', Infinity, { climbScale: 1.5 })`. A floor change, a respawn
and an unequip clear every modifier, so the kit re-asserts it each tick (and in its constructor).

`climbScale()` is read in two places in `Player`: the climb accumulator (`climbMoveT += CLIMB_RATE * scale`, a
cell each time it passes 1) and the mantle reach (`CLIMB_MANTLE_MAX_UP + 4` while the scale is above 1).
Ladders and root ladders are climbed by the same code, so they are faster too.

Measured in the real engine (same wall, same keys: Shift + D + W, 30 cells up):

| | ticks | cells/s |
|---|---|---|
| classic Alchemist | 67 | 27 |
| Kest Rel | 45 | 40 (x1.49) |

Mantle (a wall topped by an overhanging slab with the wall top too cramped to stand on, so the body must top
out onto the slab `17 + t` cells above where the face runs out):

| ledge | classic | Kest |
|---|---|---|
| 20 cells up (t=3) | tops out | tops out |
| 22 cells up (t=5) | hangs on the wall | tops out |
| 24 cells up (t=7) | hangs | tops out |
| 25 cells up (t=8) | hangs | hangs (the bonus is bounded) |

Tells: a little soot off her hands while she climbs, and a soot-and-spark flourish when she tops out of a ledge
the classic mantle could not have reached (`TUNING.passive.bonusMantle`).

## Smoke Step (Z, 480 ticks)

`startMove` along the aim: 6 ticks x 6 cells = 36, i-frames (5 ticks, which also outlast the dash by 5),
`face: true`, hands back `vx = 3 cos(aim)` / `vy = 2.4 sin(aim)` of momentum on exit.

- **It skims.** Aimed into the floor, a ceiling or a wall beside her with a real component along the other
  axis, the whole speed goes along the surface instead of stopping dead (`slideAlong`); a dash aimed straight
  into the floor has no room and is refused. Floor lips up to `PLAYER_STEP_UP` are climbed like a run does.
- **Refusal.** A dry run of the same cell-by-cell movement (`simulateDash`) finds less than 8 cells of room:
  refused, no cooldown spent, no smoke written, a dry click and the line "NO ROOM TO STEP" over her head.
- **Grid.** At both ends a ragged disc of radius 7 of real `Smoke` cells, each with its own `world.life` in
  40..70 (so the cloud thins unevenly and burns off by itself, about 70 ticks later; measured 217 cells for the
  pair, 0 left after 90 ticks). Nothing else is written.
- **Concealment.** `setMod('smoke-step', 150, { concealment: 0.6 })`. `Enemies.update` scales
  `observedPlayer.light` by `1 - concealment()`, and `tickCreatureMind` turns light into sight range
  (`sightRangeScale`). Measured with the same slime at the same distance, 50 ticks, before and after
  (`mind.visible` ticks / confidence / alerted / intent):

  | distance | uncovered | covered |
  |---|---|---|
  | 60 | seen 50/50, hunts | seen 50/50, hunts |
  | 100 | seen 50/50, hunts | seen 0/50, conf 0, forages |
  | 150 | seen 50/50, hunts | seen 0/50, conf 0, forages |
  | 170 | seen 50/50, hunts | seen 0/50, conf 0, forages |

  In this arena the slime's sight reaches about 190 cells uncovered and about 100 covered: a shorter sight
  line, not invisibility (a foe at 60 still sees her). After the 150 ticks the same foe at 150 sees her
  again. The dash's own footfalls are a sound, a different sense (a foe within 115 cells hears them for 90
  ticks): the trial spawns the foe after that has aged out, in both runs.
- Tell / sound / end: soot streaks along the dash, `trick.whip` + `mat.steam` at the start, `mat.steam`
  (lower) at the end, an impact on a wall stop, a small screen punch; soot wisps drift off her while the cover
  holds and thin out over its last 30 ticks.

## Updraft (T, 360 ticks, bar full)

A furnace stands at her feet (on the first floor below her if she is in the air): a sooty iron box on short
legs with a chimney collar, a fire door that glows, a drawn flame, soot and rivets
(`kest-rel-furnace.ts`, an 'under' drawable so she is drawn in front of it) and a warm authored light that
fades with the flame. It drives a column 18 wide and up to 90 tall (clipped to the first ceiling above any
part of it).

- **Real cells.** Every 2 ticks 6 `Fire` cells (life 16-26) in the mouth, every 3 ticks 3 `Steam` cells
  (life 90-150) just above it, every 6 ticks 2 `Smoke` (60-110) higher: the sim does the rising. The column's
  sustained sound is `HabitatAudio`'s own fire/steam beds reading those cells. Measured at 33 ticks: 14-18
  Fire cells in the mouth (31-41 in the area, the rest being the burner's flames drifting up and whatever the
  arena's own decor was doing: a hanging vine strand beside the furnace visibly caught fire), 17-25 Steam cells more than 14 cells above the mouth, at most 2 Fire cells that high. The
  Fire burns what stands in it (a foe in the mouth is set alight) and catches what is flammable around it.
- **She rides it** (`riderVy`, run after the player's own tick): a buoyant draft, strongest at the mouth,
  balancing her weight at 75% of the column, with air drag so she settles instead of bobbing. Measured:
  81 cells above the floor after 33 ticks (the overshoot), then a steady hover 62-67 cells up (the whole run
  `62 66 67 67 66 65 65 65`). She steers freely in the air. Her own flame cannot hurt her: immune to
  `fire` / `burning` / `oiled-fire` for the duration and `status.burning` cleared each tick (measured:
  hp 100 and no burning the whole ride). Lift thins over the last 50 ticks, so the end is a glide down
  (landed unhurt, no fall damage in this game) and not a drop.
- **Foes** are hoisted by their knock state (`knockVy` and `knockT`, which `Enemies.tickKnock` integrates and
  which holds the AI off), scaled by body mass (a slime rises fast; by the model a golem gets about half as high, not probed live), capped at
  3.2 cells/tick so that a ceiling is a thud and never the engine's wall-smash gib (3.5). They are pulled
  gently to the axis, and when they leave through the top they are thrown sideways (`fling`) and land well
  clear of the draft (measured: 100-112 cells gained in 40-50 ticks, then 36-54 cells off the axis). A
  heavy foe that never reaches the top is thrown out after 90 ticks. A foe that has been thrown out is not
  caught again for 80 ticks. Bosses and rooted foes (colossus, leviathan, rime warden, lenswright, eggs,
  stonemaw) are left alone.
- **Rigid bodies** in the draft get a velocity kick each tick (`rigidBodies.applyImpulse`, 0.5 cells/tick,
  stopping above 3.2): a stone crate rose from y 686 to 585 while one 70 cells away did not move. (Real Steam
  in the footprint of a body already lifts it in `RigidBodies`; this is the draft itself.)
- **Refused** (the bar is kept, a dry click, and a line says why): no floor within 40 cells below her ("NO
  FLOOR FOR A FURNACE"), not enough room to stand it ("NO ROOM FOR A FURNACE"), more than 12 liquid cells in
  its mouth ("TOO WET TO LIGHT"), under 24 cells of open air above it ("NO ROOM TO RISE").
- **End.** The flame sputters and goes out, `body.burnout` and a soot puff, the iron stays and cools for 70
  ticks, then the drawable leaves. A floor change, a death or a new fighter wipes it at once (`reset()`).
- **A ledge she could not otherwise reach.** A 4-cell-thick ledge whose top is 56 cells above the floor, just
  outside the column. The classic Alchemist with the jet empty (`maxLevit = 0`) jumping at it reaches 26
  cells and never stands on it. (For the record: with the jet full the classic Alchemist rises 256 cells, so
  the jet is a different, fuel-limited road; the ledge test isolates the draft.) Kest lights the furnace,
  rises above the ledge top, walks off the draft and stands on it, and is still standing there, safe, after
  the flame has died.

## Nothing seals a route

Smoke Step writes only `Smoke`. Updraft writes only `Fire`, `Steam` and `Smoke`. The probe takes a census of
every solid and powder in the arena before and after each ability and requires it unchanged. Fire is the one
hazard: it burns what burns (vines, wood, oil, a foe), and a burnt-out door opens its gate, which is the
repo's rule.

## Numbers (`TUNING`, live-tunable)

| | |
|---|---|
| climbScale | 1.5 (mantle reach +4) |
| Smoke Step | cooldown 480, 6 x 6 cells, i-frames 5, min room 8, puff radius 7, smoke life 40-70, concealment 0.6 for 150 |
| Updraft | duration 360, column 18 x 90, fade 50, cool 70, min rise 24 |
| rider | gravity 0.28, k 0.9, balance 0.75, drag 0.93, cap 3.6, glide floor 0.25 |
| foe | lift 0.5, taper 0.85, mass ref 40 (x0.45-1.3), cap 3.2, hoist 90, recatch 80, fling 1.7 x 1.1 |

## Deviations from the spec, and why

- **The rider's lift is a draft with a balance point, not a constant `vy -= 0.35`.** Against the player's
  gravity (0.28 per tick) a constant 0.35 is a net 0.07 and overshoots the whole column by 20 cells; the
  balance point gives her something to ride (a steady hover she can walk off) and the glide at the end.
  Foes get the spec's constant-ish push, tapered, capped at 3.2 rather than 4.2.
- **Fire immunity during the ultimate.** The mouth is at her feet; without it her own furnace would set her
  alight every time. Same shape as Phoenix Draft's `immuneTo`.
- **The furnace refuses to light** in water, with no floor and with no room to rise; the spec is silent.
- **Foes are hoisted for a limited time and thrown out**, rather than held for the 6 s, so the ultimate lifts
  and displaces and does not become a stun.
- The Steam the sim makes condenses to Water on a solid ceiling (the engine's own rule), so a draft under a
  low roof drips a little.

## Not verified / notes

- Sound: only existing cues, and none of them can be heard here. `trick.whip`, `mat.steam`,
  `spell.flame.ignite`, `mat.ignite`, `body.impact.metal`, `body.burnout`, `flora.whoosh`, `wand.dry`.
- The classic Alchemist's jet makes any ledge reachable by fuel; the ledge proof is with the jet empty.
- The probe arena is the `physics-test` level; its own vine strands near the furnace catch fire when the
  furnace burns beside them.
- Real-time (unpaused) play was looked at only through the harness' paused frames; nothing here depends on
  frame rate (everything runs inside the 60 Hz tick).
- The Updraft has not been tried on a campaign level with its own population (the arena has no mechanisms).

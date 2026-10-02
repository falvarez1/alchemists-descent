# Selene Wraith, the Mercury Twin (Duelist)

Passive **Liquid Momentum**, tactical **Quicksilver Echo** (Z), ultimate **Mirror Hunt** (T). Spec: `docs/FIGHTERS.md` "08".
Code: `src/fighters/kits/selene-wraith.ts` (the rules), `selene-wraith-math.ts` (the pure maths and the `TUNING`
object: no engine imports), `selene-wraith-echo.ts` (the silver: how an echo is drawn). Tests:
`tests/fighters-selene.test.ts` (45, node-only). Live probe: `scripts/verify-fighter-selene.mjs` (84 checks, real key
presses, paused deterministic ticks; screenshots to `verify-out/fighters/selene-*.png`).

Nothing in the kit writes a cell. The slide and the blink move the body, the echoes are pixels plus a lure for the
foes' eyes: nothing she does can seal a route (the probe takes a census of every solid and powder around a slide, a
blink, a recall and a whole Mirror Hunt and requires it unchanged).

## Engine seams added (all additive; the classic Alchemist is byte-for-byte unchanged)

1. `FighterSystem.scaleTacticalCooldown(keep)` (a method on the system, not on `FighterApi`): a kit keeps `keep` of
   what is left of the tactical's cooldown. Never lengthens it. The recall uses it (x0.4).
   It rides on the already-existing `KitInstance.tacticalAgain()` (Z while cooling) and `tacticalActive()` (the chip).
2. `Enemies.ts`, one condition: `canAttackTarget` is false while `decoyFor(e)` answered with an echo. Every melee
   `playerCtl.damage(...)` in the enemy loop is gated on `canAttackTarget` and measured from the perceived target,
   so without this a foe standing at an echo bites the REAL player from 28 cells away (measured: a slime two cells
   from the echo took 6 hp off her at tick 56 of an early run, before the gate). A lured foe swings at, and shoots
   at, nothing.
3. `creatures/lightResponse.ts`, the "being lit is information" fix: a foe in her lantern beam used to have its target
   overwritten with the REAL player every sensing tick, which undid every lure the moment she faced the foe (the
   usual way to play). It now takes the echo's place when `decoyFor` has one for that foe. (Measured: slime 16 cells
   ahead, her beam on it: hunts x 508, the echo, not x 480, her; without the change it flipped to her at the first
   hop.)

## Liquid Momentum (the slide)

**What it is.** A body-owning move (`startMove`). The player's own stance clamps ground speed to 32% (a crawl) the
instant S goes down while she runs, which is why this cannot be a modifier. The kit notices the S key edge in
`tick()` (which runs after the player's own update, so that tick's speed has already been clamped: the speed that
counts is the larger of this tick's and the last tick's), and when she is grounded and at least 2.2 cells/tick
(a full run is 2.85) it starts a `SlideModel` and hands it to the system.

| | |
|---|---|
| start | S edge, grounded, not climbing / swinging / swimming / rooted, speed >= 2.2, 12 ticks since the last slide |
| speed | keeps 97% a tick (`decay` 0.97), at most 45 ticks; 2.85 cells/tick covers 71 cells |
| body | **crawl gauge** (`player.crawling = true`): 9 cells tall, the prone pose |
| end | stops (< 0.45), jump, a blow, S let go (after a 14-tick minimum, so a tap is a slide), the floor ends (a ledge), a wall |
| exit | 80% of her speed and her feet on the floor; after a blow she keeps what the blow gave her |
| floor | follows a floor that falls away by up to 5 cells a step (`groundDrop`), climbs lips with the system's own step-up (5) |

**Measured** (same wall, same keys: D for 30 ticks, then S held):

| | cells in 45 ticks |
|---|---|
| classic Alchemist (crouch clamps the run to 0.91 a tick) | 41 |
| Selene (slide) | 71 (x1.73) |

- Speed ratio tick to tick: 0.969 .. 0.970 (spec 0.97). She leaves with x0.776 of her last step (0.97 x 0.8).
- A wall: she stops against it edge to edge (face at x 520: she stops at 515), not in it, unhurt, vx 0.
- **A 9-cell gap** (a roof leaving exactly nine free rows from x 495): she goes in and keeps going, started at 473,
  slide over at 544, inside it (a 9-tall body fits where she is, a 17-tall one does not); S let go in the gap: she
  stays at crawl gauge (the player's own "cramped" rule) and nowhere near rock. An 8-cell gap stops her at its mouth.
- A ledge (floor ends at x 516): the slide ends at x 520 (her centre at most 4 cells past the edge, as any runner may
  be) with her feet still on the floor, and she drops off the way a runner does (a fall, never a hover: the longest
  stretch of airborne ticks with an unchanged y was 0).
- A 45-degree ramp down (8 cells): never airborne for one tick of the slide, all the way to the bottom. Up the same
  ramp: onto the platform. A 4-cell lip: climbed and gone over.
- A tap on S (3 ticks) holds the slide for 15 ticks. A jump ends it at once and she takes off at speed. A blow lands
  (no i-frames) and ends it. Z in the middle of it ends it (the blink takes her out).
- Not started: walking under 2.2, crouching before moving, a sprint with no S, S in the air (the dive), the classic.

**Why crawl gauge and not `crouchT`.** The spec says "low pose (`crouchT`)". `crouchT` is the standing crouch, which
(a) has a 17-cell hitbox, so a slide into a 9-cell gap would stop at the mouth, and (b) pulls the camera 48 cells
down (`Camera`: the crouch-peek), which would drag the view under her at 2.85 cells a tick. Setting the stance
the engine already has for a 9-cell body (`crawling`) gives the right box, the prone pose, the terrain-following tilt
and the "cramped" rule on the way out for free.

**Tell.** Quicksilver sparks at the heels and a spray of silver motes (`ctx.sparks`, cosmetic), `player.skid` at the
start, a scuff every 15 ticks, dust and a pop-up at the end. In the dark the silver glows.

## Quicksilver Echo (Z, 480 ticks)

**Blink.** Aim from the shoulder; the ray runs up to 40 cells and stops at the first solid, so she never goes through
rock (a gate, a wall, a secret). Along it, the farthest point first and backing off 4 cells at a time down to 8, the
nearest spot within 14 cells (`nearestSpot`: square rings, true distance inside a ring) where she can **stand**:
room for the 9x17 body, firm footing (at least 5 of the 9 columns under her boots on something: she is not set
down on a lip), and no Fire / Lava / Acid / Toxic in the body. At least 8 cells from where she stood. None: refused,
no cooldown, a dry click and the line "NOWHERE TO BLINK". Then: the body is set down (its small clocks and its cloth
go with it: `fallPeak` 0 so no thud, the animation's last position reset so a blink is not read as a sprint, the
cloth chains shifted), 8 ticks of `invuln`, the slide (if any) cancelled, a vine released.

**The echo** is a frozen silver copy of her at the moment she left (her skeleton as the pose code made it, her cloth
copied: the ponytail and scarf hang as they hung), standing on a ring of silver light on the ground, with mercury
drops lifting off it and a calm silver authored light that marks it in the dark. It thins and flickers over its last
40 of 180 ticks and comes apart in a burst. Both ends of the blink get a ring and a flash (a light for 12 ticks), a
streak of motes runs between them, `player.teleport` + `spell.warp.cast`.

**Z again** (`tacticalAgain`) inside the 180 ticks returns her to the echo (the nearest firm spot within 6 of where it
stands, in case the floor has changed), folds the echo into a burst, 8 more ticks of i-frames, and
**keeps 40% of what remains of the cooldown** (measured: Z again at tick 60: 420 left -> 168). The chip's
`tacticalActive` runs the 180-tick window down while the echo stands and pulses on the return. If the echo's place
has filled with rock the return is refused ("ECHO LOST") and the echo runs out its time.

**Measured.** Blink right at 40 cells: 40 cells to the floor; 8 i-frames (a probe blow at the first tick does nothing,
one after they lapse lands); recall at tick 60 puts her back on the echo (same cell) with the cooldown at 168; Z at tick
170 still returns her, at 186 it is a plain refusal and the echo has gone; rock 7 cells away: refused, free; rock 25
cells away: she stops short; aimed up at a ledge 40 across and 24 up: she lands standing on it; across a 20-cell pit:
crosses it; with a pit and nothing of her own platform to stand on: refused; lava where the blink would end: she
lands short of it, 0 lava cells in her body.

## Mirror Hunt (T, 540 ticks)

**The echoes.** Two live copies ride the ground 28 cells to her right and to her left (the same pair whichever way
she faces: she can turn round without them crossing). Each is her, drawn by the same body code as she is
(`drawFighterBody`, her look, her skeleton, her cloth, her spear and stride, posed live at the echo's place) through a
translucent silver material table (`selene-wraith-echo.ts`: every material of her look re-coloured to mercury by its
own brightness, four translucency steps for forming, thinning and flicker). They glide to their slots at
`max(2.6, |vx| + 1.2)` cells a tick, follow steps and slopes up and down (a floor 6 cells higher: the echo stands on
it), come in toward her in 4-cell steps when there is no firm ground out at 28 (a pit from x 496: the echo ahead
stands at 492, not over the pit), and are simply not out when there is none within 8. They flicker for the last
60 ticks and dissolve when it ends. Refused at the press (bar kept) when neither can stand anywhere (walled into a
closet).

**The foes.** `decoyFor(e)`: each foe makes up its mind every 20 ticks (re-rolled with `entityRandom`, once per
foe, three draws): each of the real body and the two echoes is judged by its distance times a guess (1 +- 12%),
the nearer wins, an echo beyond 230 cells is not seen. The foe's perceived player is then the echo's place
(`Enemies.update` hands `tickCreatureMind` the decoy), and it is lured only while an echo is out and alive. Bosses,
sleepers and egg clutches are not lured. A lured foe cannot attack (see seam 2) and a foe in her lantern beam
finds the lantern on the echo (seam 3).

A foe whose body is within 3 cells (plus its own half-width) of an echo has **reached** it: the echo pops (a burst of
silver sparks, a ring, a flash of light, `flask.shatter` + `mat.shatter`) and the foe is `stunEnemy`'d for 30 ticks.

**Measured, with real foes and the real AI** (slime at 16 cells ahead of her, echo at 28, her at 0):

| | what the foe hunts | which way it first moves |
|---|---|---|
| Mirror Hunt on, foe nearer the echo ahead | the echo's place (x 508) | toward the echo (away from her) |
| the same, no ultimate | her (x 480) | toward her |
| nearer the echo behind her | the echo behind (x 452) | away from her |
| beside her (7 cells) | her (x 480) | |
| 100 cells off, on the echo's side | the nearer echo (72) | |

A golem 16 cells ahead (it walks, where a slime hops over an echo's head and may land well past it, so the pop is proved
with the golem) hunts the echo's place for 14 ticks, walks to it, reaches it and the echo pops (its target goes back
to her); it is held where it stood for 30 ticks (the system pins its knock state), then walks to her and hunts her.
A slime 26 cells ahead of her, already on the echo, pops it on the first tick. A foe with its bite ready, 2 cells from an echo, swings at nothing: she (28
away) takes no damage and is not knocked. After 540 ticks no foe is told about any echo and the drawable leaves the
world. A floor change wipes the echoes and the echo she left.

## Numbers (`TUNING`, live-tunable)

| | |
|---|---|
| slide | min speed 2.2, decay 0.97, 45 ticks, exit x0.8, stop < 0.45, min hold 14, snap 5, re-arm 12 |
| Echo | cooldown 480, range 40, min 8, back-off 4, land reach 14, footing >= 5 of 9, i-frames 8, window 180, recall keeps 0.4 (recall reach 6), fade over the last 40 |
| Mirror Hunt | 540 ticks, offset 28 (min 8), glide max(2.6, |vx|+1.2), pop reach 3, stun 30, re-roll 20, lure range 230, noise 0.24, form 14, fade 18, flicker for the last 60 |

## Deviations from the spec, and why

- **Crawl gauge, not `crouchT`** for the slide's pose (above).
- **S let go ends the slide** (after a 14-tick minimum). The spec ends it on stop / jump / blocked only; without a
  release a tap would commit her to 70 uncontrollable cells. A tap is still a slide (14 ticks).
- **A blow ends it, and the floor ending ends it** (the spec asks only that she not "fall off a ledge badly"):
  `startMove` has no gravity, so a slide that simply carried on would have hung her in the air.
- **The echoes are the same pair whichever way she faces** (28 right and 28 left) rather than "ahead" and "behind":
  the two sets of positions are identical, and a pair that swapped sides when she turned would cross through her.
- **Blink never passes through rock.** The spec says "along the aim to the nearest standable spot"; the ray stops at the
  first solid so a blink cannot skip a gate or a secret wall. And never into fire, lava, acid or toxic, and not onto a lip
  (more than half a boot on something).
- **A lured foe cannot attack, and the lantern's fix moves to the echo** (seams 2 and 3): without them the decoy either
  hurt her from where it stood or did nothing whenever she looked at the foe.
- The recall pulses the chip (`usedAt`), which the spec does not mention.

## Not verified / notes

- The probe's slime checks judge the PREFIX of what a foe hunts (the run of the same place before the echo pops or a bite moves
  her): a slime's random hop timing, its long arcs and its eyes (a foe only sees what is in front of it unless it is near) made
  later samples noise. The probe tracks its own foe by reference, and turns the foe's eyes toward her as the other probes do.
- Sound: only existing cues, and none of them can be heard here. `player.skid`, `player.crawl`, `body.impact.stone`,
  `player.land.soft`, `player.teleport`, `spell.warp.cast`, `pickup.bell`, `flask.shatter`, `mat.shatter`, `wand.dry`.
- On a display above 60 Hz the presentation layer interpolates the body between ticks, and a 40-cell blink is under its
  80-cell teleport threshold, so her sprite eases across it over a frame or two while the echo and the rings appear at
  once (the paused probe frames show her at the old place on the first frame for this reason; a tick later she is there).
  A cosmetic glitch of one frame at 60 Hz; fixing it is a `RenderPoses` change, not this kit's.
- A slide begun while standing on a crate or a body rather than terrain finds no terrain floor under her and ends at the
  first step (she keeps 80% of her speed). Not probed.
- The decoys were probed with real slimes (the probe), and explored by hand with golems, imps, bats and spitters (all are
  lured and none attack a lured target); the long-range ones were not probed for what they do when the echo pops.
- Not tried on a campaign level with its own population and mechanisms: the probe arena is the `physics-test` level.
- The drawable follows the player's tick position, not the interpolated one (same as Brann's plate): on a display above
  60 Hz a living echo can shimmer by a fraction of a cell against her sprite.

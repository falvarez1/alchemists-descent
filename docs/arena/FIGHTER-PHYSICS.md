# Fighter physics: a body per fighter

**Status: designed; phase 1 of `docs/arena/MASTER-PLAN.md` (the first thing to build).** The code study behind it
(2026-10-01) found that every fighter shares the Alchemist's physics: the same run speed, jump, gravity, air control,
levitation, knockback and health. `ctx.params.player` (`PLAYER_PARAMS`) is a *shared, live-tunable, persisted* object, so
per-fighter values must never be written into it. They live in a `BodyProfile` that the fighter system hands to the player
controller.

## 1. The `BodyProfile`

A frozen object of multipliers on the Alchemist (1.00 = unchanged), cached on the fighter system, recomputed on equip and
whenever a modifier changes (`FighterSystem.setMod` / `recompute`, `FighterSystem.ts:360-386`). With no fighter equipped
(`id === null`) the profile is `NEUTRAL_BODY` (every field 1) and the classic hero is **byte-identical** to today.

```ts
export interface BodyProfile {
  mass: number;        // knockback taken = impulse / mass  (heavy = launched less)
  maxHp: number;       // x player.maxHp at equip (the hp ratio is kept)
  run: number;         // x run speed and its caps
  accel: number;       // x ground and air acceleration
  friction: number;    // x ground stop decay/snap (traction): low = slidey, high = planted
  airControl: number;  // x air acceleration and glide speed
  jump: number;        // x jump HEIGHT (the launch speed is scaled by sqrt(jump) so the number reads as height)
  jumpCut: number;     // x how hard releasing jump cuts the rise
  gravity: number;     // x air gravity (liquid gravity unchanged)
  fall: number;        // x maximum fall speed (and the dive caps)
  jet: { thrust: number; fuel: number; burn: number; regen: number };   // the levitation jet: the LEV tank and its use
  coyote: number;      // x coyote frames (ledge forgiveness)
  buffer: number;      // x jump-buffer frames
  crawl: number;       // x crawl and crouch speed
  stagger: number;     // x stagger frames after a hit
  invuln: number;      // x invulnerability frames after a hit
  dealt: number;       // x damage this fighter deals (a body-level power knob)
}
```

Smash-style names (the roster table in `docs/arena/ROSTER-IDENTITY.md` uses the short form):

| Short | Field | What a player feels |
|---|---|---|
| wt | `mass` | how far a hit sends you |
| run | `run` | top ground speed |
| trac | `accel`, `friction` | how fast you start and stop (low = momentum) |
| air | `airControl` | how well you steer in the air |
| jmp | `jump` | jump height |
| grv | `gravity` | how floaty |
| fall | `fall` | how fast you can drop |
| lev | `jet.*` | how long and how strongly you can hover and recover |
| clm | existing `climbScale` | wall speed |
| hp | `maxHp` | health |
| dmg | `dealt` | raw power |

## 2. Where it plugs into `Player.ts` (verified lines)

The profile is read **once at the top of `PlayerControl.update`** into a local, then multiplied in at the sites below. No
fork of `Player.ts`: about 35 edited lines.

| Field | Site (`src/entities/Player.ts`) | Today |
|---|---|---|
| `run`, `accel` | :1531-1543 (`speedK`, `pacedSpeedK`, `MOVE_ACCEL_CAP` :71, `maxRunCap` in params) | run 2.85, ground accel .65, air .575; capped. **Raise the caps with `run`**, or the cap makes `run` a no-op above 1.26 |
| `friction`, `airControl` | :1548-1581 (`groundStopDecay/Snap`, `airStopDecay`, `airDrag`, `airGlideSpeed`, `moveSoftStart`) | params |
| `jump`, `jumpCut` | :1883 (jump launch -3.7), :1957 (cut), :1754/:1888 (hold window); wall-jump :2063 (2.4, -3.85); dive :1742-43, :1978-84 | hard-coded / params |
| `gravity` | :1871-73 (air .28), swing :934; also the global `mutatorMods` dial | hard-coded |
| `fall` | :2004 (max fall 5.0, dive 6.4, up-cap `vyCapUp`) | hard-coded |
| `jet` | :1903-1911 (thrust, ramp, drag, horizontal control from params), :1964 (burn 1.15, regen 1.7 hard-coded); fuel 100 in `createPlayer` :156 | params + hard-coded |
| `coyote`, `buffer` | :1879 (6), :1709 (8) | hard-coded |
| `crawl` | :1533 (0.32 crawl, .38 crouch) | consts |
| `stagger`, `invuln` | :668 (stagger 12), :672 (invuln 30) | hard-coded |
| `mass` | `applyImpulse` :689-695 (unscaled today) | none |
| `maxHp` | `createPlayer` :152 (100); `Levels` scales it (:885, :1583-1613) | applied at equip |
| `dealt` | the player-sourced branch of `Enemies.damage` (`Enemies.ts:595`) | none |

**Not in the profile (phase 1): the hitbox.** `PLAYER_HALF_W = 4`, `PLAYER_H = 17` are read in 70+ places across 24 files
(constants derived from them in `Player.ts:30-39`; literals 4/9/17/18 in `Projectiles.ts:124,197,998-1001`, `explosion.ts:434`,
`Spells.ts:35-40`, `Player.ts:1320,1372,2363`, the contact shadow `FrameComposer.ts:1190`), and the rig skeleton is fixed
(`FighterLook.build` scales only limb and torso *thickness*, `fighterLook.ts:68`; ragdoll offsets `RigidBodies.ts:403-415`).
A different height is its own project (halfW first: the physics takes `halfW` and `h` as arguments) and is not promised.
Weight, speed, jump and levitation carry the identity in the meantime. (A *visual* build, a broader or leaner body, can
come from the look.)

## 3. Dynamic modifiers

`FighterMod` (`kit.ts`) already carries `moveScale`, `climbScale`, `damageTaken`, `staggerResist`, `immuneTo`,
`concealment`. Phase 1 extends it with the body fields a kit may need to bend *while an effect runs*: `gravity`, `fall`,
`jump`, `airControl`, `accel`, `friction`, `jet` (fuel/thrust/burn multipliers). The effective value is
`baseProfile x product(active mods)`. This is how the movement techniques are built without touching `Player.ts` again:

| Technique | Built from |
|---|---|
| Mara's **Glide** | a `gravity` x0.25 and `fall` x0.3 mod while jump is held in the air, `jet.burn` trickle |
| Edda's **Hover** | the same shape, a little higher thrust, a little slower horizontal |
| Kest's **Wall-run** | a body-owning move (`startMove`) along a wall while jump is held against it |
| Ilyra's **Cinder Dash** | a body-owning move (`startMove`, an air dash) on a double-tap |
| Brann's **Piston Stomp** | `fall` x2 and a `mass` surge on press down in the air; a landing shockwave through the kit |
| Selene's **Carry** | an `accel` x0.5 and `friction` x0.3 mod after a landing, preserving speed into the next jump |
| Rusk's **Skid** | `friction` down and a held charge that becomes a ram |
| Nox's **Shadow-step** | a `moveScale` x1.2 while concealed |
| Thorne's **Root-walk** | `moveScale` x1.5 and `climbScale` x1.5 while inside his own growth |
| Sable's **Wall-cling** | a `gravity` x0 mod while pressed to a wall, with a time budget |

## 4. The roster's bodies

The starting numbers (`docs/arena/ROSTER-IDENTITY.md` has the reasoning). Fields not listed are 1.00. `jet` is the
tank/thrust pair (`fuel`/`thrust`); `burn` follows the fuel.

| Fighter | mass | run | accel | friction | airControl | jump | gravity | fall | jet (fuel/thrust) | maxHp | dealt | climb |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Alchemist (control) | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00/1.00 | 1.00 | 1.00 | 1.00 |
| Ilyra Voss | 0.95 | 1.10 | 1.00 | 1.00 | 1.10 | 1.05 | 1.00 | 1.00 | 1.00/1.00 | 0.95 | 1.05 | 1.00 |
| Brann Rook | 1.45 | 0.80 | 0.85 | 1.20 | 0.75 | 0.85 | 1.25 | 1.25 | 0.55/0.75 | 1.35 | 1.10 | 0.80 |
| Sable Fen | 0.90 | 1.00 | 1.00 | 1.00 | 1.05 | 1.00 | 1.00 | 1.00 | 0.90/0.95 | 0.95 | 1.00 | 1.20 |
| Mara Quell | 0.80 | 0.90 | 0.95 | 0.90 | 1.20 | 1.00 | 0.80 | 0.75 | 1.50/1.10 | 0.85 | 0.95 | 0.90 |
| Kest Rel | 0.85 | 1.25 | 1.10 | 0.85 | 1.15 | 1.10 | 1.00 | 1.00 | 1.10/1.05 | 0.90 | 1.00 | 1.50 |
| Nox Calder | 1.00 | 0.95 | 1.00 | 1.10 | 0.95 | 0.95 | 1.00 | 1.00 | 1.00/1.00 | 1.00 | 1.00 | 1.00 |
| Edda Morrow | 0.75 | 0.95 | 1.00 | 1.00 | 1.15 | 1.00 | 0.85 | 0.85 | 1.30/1.05 | 0.75 | 1.00 | 0.90 |
| Selene Wraith | 0.90 | 1.15 | 0.85 | 0.55 | 1.20 | 1.10 | 1.00 | 1.00 | 1.00/1.00 | 0.90 | 1.00 | 1.00 |
| Rusk Emberjaw | 1.30 | 0.90 | 0.90 | 1.30 | 0.80 | 0.85 | 1.20 | 1.20 | 0.60/0.80 | 1.25 | 1.10 | 0.90 |
| Father Thorne | 1.15 | 0.80 | 0.85 | 1.40 | 0.80 | 0.90 | 1.00 | 1.00 | 0.80/0.90 | 1.10 | 1.00 | 1.00 |

Guard rails (a test, `tests/fighter-bodies.test.ts`): every value lies in its declared range (below); no fighter has both
`mass > 1.2` and `run > 1.1`; no two fighters share (`mass`, `run`, `friction`, `airControl`) within 10%; `NEUTRAL_BODY`
reproduces today's player in a physics probe (the same jump apex and run speed within one tick).

### Ranges (the telemetry tuner may move values only inside these)

| Field | min | max |
|---|---|---|
| `mass` | 0.60 | 1.60 |
| `maxHp` | 0.60 | 1.60 |
| `run` | 0.70 | 1.40 |
| `accel`, `friction` | 0.40 | 1.60 |
| `airControl` | 0.50 | 1.40 |
| `jump` | 0.70 | 1.30 |
| `gravity` | 0.60 | 1.40 |
| `fall` | 0.60 | 1.50 |
| `jet.fuel`, `jet.thrust` | 0.40 | 1.80 |
| `dealt` | 0.80 | 1.25 |

## 5. How a person (or the AI) will see it: the movement lab

The Proving Yard's panel (`ui/FighterArenaPanel.ts`) gets a **Body** card for the fighter in hand: the eleven stats as small
bars against the Alchemist's line, and a live **movement readout** (current speed, peak speed this run, jump apex of the
last jump in cells, time airborne, LEV left), so "Kest is faster" and "Brann falls harder" are numbers you can read, not
only a feeling. The hall gets a **height ruler** beside the Bluff (tick marks every 10 cells) and a **run lane** with
distance marks. Together with the body table these are the first thing the user can *see* of phase 1.

## 6. Phase 1 deliverables and the check that it worked

1. `BodyProfile` + `NEUTRAL_BODY` in `core/fighters.ts`; `FighterApi.body`; the ten profiles in `content/fighterBodies.ts`
   (pure data, with their ranges); `FighterMod` extended; the `Player.ts` reads (about 35 lines); `Enemies.damage` reads
   `dealt`; `applyImpulse` reads `mass`.
2. The panel's Body card and movement readout; the hall's ruler and run lane.
3. `tests/fighter-bodies.test.ts` (table, ranges, guard rails); `scripts/verify-fighter-bodies.mjs`: in the Yard, with real
   keys, each fighter runs for 90 ticks, jumps once, falls from a drop and is hit once by a standard blow; the measured
   speed, apex, fall speed and knockback distance **order the roster as the table says** (Kest fastest, Mara floatiest,
   Brann hardest to launch, Selene slowest to stop...) and the Alchemist control is unchanged from before the change.
4. `docs/arena/TASKS.md` P1.x ticked; the roster's checklist (`ROSTER-IDENTITY.md`) re-run: no two fighters share the
   quartet.

## 7. Built and measured (P1a, 2026-10-01)

Implemented: `core/fighterBody.ts` (the profile, `NEUTRAL_BODY`, `BODY_RANGES`, `composeBody`, `bodyBars`),
`content/fighterBodies.ts` (the ten bodies), the `FighterApi.body` getter (`FighterSystem`: a base profile composed with the
running `FighterMod`s, recomputed on equip and whenever a modifier changes), the reads in `entities/Player.ts` (one `body`
local per update, about 25 edited lines), `Player.applyImpulse` (mass), `Enemies.damage` (`dealt`), the health and tank scaling at
equip, the panel's Body card and movement readout, the height ruler and the run lane.

Measured in the Proving Yard (`node scripts/verify-fighter-bodies.mjs`: 73 checks, every fighter run, stopped, jumped, dropped,
pushed and flown on the grating bridge, paused world stepped tick by tick):

| | run (cells/tick) | coast after letting go (cells) | jump apex | hang (ticks) | terminal fall | push of 3.0 | jet burn (ticks) | health | tank |
|---|---|---|---|---|---|---|---|---|---|
| control (Alchemist) | 2.85 | 2 | 27 | 28 | 5.00 | 3.00 | 116 | 154 | 125 |
| Ilyra | 3.13 | 3 | 28 | 29 | 5.00 | 3.16 | 116 | 146 | 125 |
| Brann | 2.22 | 1 | 22 | 23 | 6.25 | 2.07 | 67 | 207 | 69 |
| Sable | 2.99 | 2 | 27 | 28 | 5.00 | 3.53 | 105 | 146 | 112 |
| Mara | 2.56 | 2 | 26 | 31 | 3.75 | 3.75 | 170 | 131 | 187 |
| Kest | 3.56 | 5 | 29 | 30 | 5.00 | 3.53 | 127 | 139 | 138 |
| Nox | 2.71 | 2 | 25 | 28 | 5.00 | 3.00 | 116 | 154 | 125 |
| Edda | 2.71 | 3 | 26 | 31 | 4.25 | 4.00 | 148 | 116 | 163 |
| Selene | 3.28 | **13** | 29 | 30 | 5.00 | 3.33 | 116 | 139 | 125 |
| Rusk | 2.56 | 1 | 22 | 24 | 6.00 | 2.31 | 72 | 193 | 75 |
| Thorne | 2.34 | 1 | 23 | 27 | 5.00 | 2.61 | 94 | 170 | 100 |

The control's measurements are **identical to the last digit** on a build without the body seam (the probe's
`--baseline-url` mode against a server on the commit before). What the numbers show: Selene coasts 13 cells (6x the control)
and Kest 5; Brann and Rusk stop dead; Mara hangs 3 ticks longer and falls at 3/4 the speed; Brann and Rusk have a jet that burns
out in under 75 ticks against Mara's 170. The weight is exactly `1 / mass` (a push of 3.0 leaves Brann 2.07).

### What changed from the design while building it, and why

- **A jump is a height.** The launch speed is scaled by `sqrt(jump x gravity)`, so a floaty body (Mara, Edda) keeps the
  control's apex and hangs longer (31 ticks against 28), rather than jumping higher. A heavy body (Brann, Rusk) both jumps lower
  and falls harder. The ranges' `jump` is therefore an *apex multiplier at equal gravity*.
- **The jet follows gravity.** Thrust is scaled by `body.gravity x jetThrust`, so the jet stays a hover instrument for a heavy
  body (the net climb is what differs, and the tank, and how hard the body falls without it).
- **The friction range widened** to 0.2-2.0: the stop decay is a per-tick factor (0.7 or so), so a *power* of it
  (`decay^friction`) is what gives Selene a 13-cell coast; 0.55 was too timid to feel.
- **Climb became a body field** (`climb`), composed with a kit's own `climbScale`; `FighterApi.climbScale()` returns
  `kitMods x body.climb`.
- Health and the levitation tank are scaled once per equip (the ratio is kept); the arena panel's equip is therefore the place
  those two numbers change, and `verify-fighter-framework` now compares against the health the fighter actually has.
- The probe's measured numbers are the evidence; the bodies in `ROSTER-IDENTITY.md` are starting points and will move with the
  telemetry (P7), always inside `BODY_RANGES`.

Not built yet: the ten movement techniques (P1b), a probe for the body under *effects* (a glide's lowered gravity), and the
`jumpCut`, `coyote`, `buffer`, `stagger` and `invuln` fields have unit-level coverage only (no probe measures them).

## 8. The ten techniques, built and measured (P1b, 2026-10-01)

`src/fighters/techniques.ts` (the rules; a registry `techniqueFor(id)`), `content/fighterTechniques.ts` (the copy and where in the
Yard to try each), a `technique` slot on the fighter system run once per tick after the kit (`FighterSystem.update`), and a
`view.technique` (`name`, `state`, `uses`, `usedAt`) the panel and the probes read. Each reads the keys a person presses
(`ctx.input.keys`), so a bot drives it identically; each bends the body through `setMod` (gravity, fall, jet burn, air control,
move scale, friction) or a body-owning `startMove`, and never writes a position. The panel's Body card shows the technique, how to
do it, a Go button, its live state and a count of uses.

Measured in the Yard (`node scripts/verify-fighter-moves.mjs`: 19 checks, a paused world stepped tick by tick, each technique
against the classic Alchemist doing the same thing):

| Fighter | Technique | Fighter | Control (the Alchemist) |
|---|---|---|---|
| Ilyra | Cinder Dash (tap a direction twice in the air) | dashes 27 cells, costs 15 LEV, 3 Ember cells left | drifts 2 cells |
| Brann | Piston Stomp (plunge with down) | the landing does 14.3 damage and stuns | the slam does 1 |
| Sable | Wall-cling (fall against a wall holding toward it) | slides 14 cells in 24 ticks at 0.55/tick; jump kicks off at (2.8, -3.6) | falls 79 cells at 5/tick |
| Mara | Glide (hold jump falling with the jet nearly dry) | falls at 1.13/tick, 35 cells in 50 ticks | 5/tick, 177 cells |
| Kest | Wall-run (run at a wall, hold jump toward it) | climbs 153 cells for 10 LEV | the jet climbs 124 cells for 61 LEV |
| Nox | Shadow-step (hidden: smoke, darkness) | runs 3.38 hidden against 2.71 in the open (1.25x) | none |
| Edda | Hover (hold jump; up + jump holds the height) | rises at 1.1/tick (3.5x gentler than 2.89), holds within 8 cells, burns 23 LEV vs 50 | the jet rockets up |
| Selene | Carry (jump right after landing) | relaunches at 3.67 after running at 3.28 (+12%) | relaunches at its run speed, 2.85 |
| Rusk | Skid (brake from speed) | leaves Ember cells where he brakes | none |
| Thorne | Root-walk (stand in moss, vines, leaves, roots) | 3.51 on a moss carpet vs 2.34 bare (1.5x) | none |

Findings while building it:
- **The jet is a free climb for everyone**, so a technique that only climbs (Kest's wall-run) is distinct by what it *saves* (the fuel)
  and by the vault, not by reaching new heights. The identity of Mara's and Edda's techniques is the same: they are what the jet
  becomes when the tank is dry (Glide) and when you want to *stay* (Hover).
- **The run cap bound a buff.** `maxRun` was capped at `maxRunCap * body.run`, which made Thorne's Root-walk (move x1.5 on a body of
  0.82) top out at 2.95. The cap is now `maxRunCap * max(1, body.run)`: a fast body raises it, a slow one keeps the shipped cap so a
  buff can still lift it. The classic Alchemist's cap is unchanged (`body.run` is 1).
- **The player's own stop eats speed before a technique sees it** (the `groundStopDecay` runs inside the player's update), so a
  brake (Skid) reads *last tick's* speed.
- **The Yard has lamp posts and a ruler on the floor of the walkways**: a probe must start where the body fits (`verify-fighter-moves`
  starts on the bridge at x=1098 and uses the hall's left wall and the Bluff's right face).

Not yet: a probe of the techniques under real keyboard input in the live loop (one real double-tap dash was checked by eye: a
screenshot with real `KeyD` presses showed the dash and the panel's use count), Brann's and Mara's techniques against a *moving*
rival (P3), and balance of any number here (P7).

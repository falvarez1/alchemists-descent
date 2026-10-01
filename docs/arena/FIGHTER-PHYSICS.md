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

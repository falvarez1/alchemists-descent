# 01 Ilyra Voss, the Cinder Alchemist (Duelist)

Duel now includes ten melee attacks, a double jump, 63 armed animation clips and eight effect clips. Volatile Mixture and Scorch now receive accepted Stock hits, including melee and projectiles. See [Duel integration, controls and verification](../arena/platform-fighter/sprite-library/animation-v2/DUO-COMPLETION.md).

Passive **Volatile Mixture**, tactical **Flash Crucible** (Z), ultimate **Phoenix Draft** (T). The contract is
`docs/FIGHTERS.md` ("01"); this file is what was built, the numbers it ended on, how each ability lives in the
grid, and what was measured in the real game.

Files: `src/fighters/kits/ilyra-voss.ts` (the kit), `src/fighters/kits/ilyra-voss-logic.ts` (`TUNING` and every
piece of arithmetic: the passive's state machine, what counts as a weapon, the vial's flight, the burst's push,
the trail's geometry), `tests/fighters-ilyra.test.ts` (49 tests, node-only), `scripts/verify-fighter-ilyra.mjs`
(76 live checks). The original kit uses the `FighterSystem` machinery
(`setMod`, `startMove`, `addLight`, `addDrawable`, `enemiesNear`, `hurt`, `noteEnemyHurt`) and public fields.

## Numbers (`TUNING`, ticks at 60 Hz, cells, cells per tick)

| | |
|---|---|
| Mixture window / prime lifetime | two weapons within **240** (4 s); a prime waits **300** (5 s) for its next hit |
| Smallest blow that counts as a hit | 0.5 (a burning tick or a flame-jet lick is not a hit) |
| A spell hit is credited to the last card cast | if cast within 600; a flask's harm is hers for 300 after a throw or a pour |
| Scorch | flare **6** damage + burning status >= **120** ticks (fire-proof foes: the flare only) |
| Crucible | cooldown **540** (9 s); vial speed **6.5**, gravity **0.18**, fuse **40** |
| Burst | radius **30**, **14** damage, knock 3.4 at the centre falling to 55% at the rim, 8 Fire + 3 Ember cells scattered within 9 (never within 13 of her) |
| Her own shove | within **22** of the burst: a 10-tick glide of speed 2.2 with a 1.7 lift and a 0.28 arc |
| Phoenix Draft | **480** ticks; run speed x**1.25**; wand cooldown decrement x**2**; immune to `fire`, `burning`, `oiled-fire`; a flame laid behind her every **3** ticks while moving faster than **1.5**, each living **34-52** ticks, up to three cells tall; at most **14** Embers per draught |

## Volatile Mixture: what is a "weapon"

A weapon is a **damage channel**, decided in `channelOf` from what the system's `noteEnemyHurt` hook can see:

- **A spell card**: `spell:<card id>` (`spark`, `frostshard`, ...). Two different cards are two weapons, the same card
  twice is one. The card is the last `cardCast` event (origin wand *or* trigger payload), valid for 10 s.
  **`ctx.player.spell` is not used**: it is the legacy sandbox spell; in play the wand casts cards through
  `WandSystem` and never writes it, so it would read "bolt" forever.
- **A kick** (and a limb swing, a ram): `melee`, when `sys.recentMelee` (`Player.kick` / `WeaverLimbs` call `noteMelee`).
- **A thrown body** (`bowled`), **her own crucible** (`crucible`, noted by the kit itself since `sys.hurt` never
  re-enters the kit's hooks), **a flask**: the world's harm (`rendered`, `dissolved`, `poisoned`, `steeped`,
  `detonated`) landing within 5 s of a `flaskUsed` throw or pour. Fire she did not light (`burned`) is deliberately
  *not* a flask weapon: it is the fire's, and it is her Scorch's own signature.
- A direct blow with no card cast in 10 s (a stomp) is `body`. Everything else (a fall, a trap, a foe's own fire) is
  nobody's weapon.

`Mixture` (pure, tested): a hit by channel `c` primes her when another channel hit within 240 ticks; the next hit
spends the prime on a Scorch and forgets the weapons (a fresh pair is needed to prime again). Choices the spec left
open: an unspent prime goes cold after 5 s (the chip would otherwise glow for ever); **the blow that primes her is
not "the next hit"**: a spark's impact and its blast land in the same tick, and counting the blast would make
kick-then-spark Scorch at once and never show the prime; a **killing blow** does not spend it (nothing left to burn);
a prime is saved with the run (`save()` / `load()`, ticks left).

**Scorch** is `sys.hurt(e, 6)` (so the ultimate bar and the boss ward see it as hers) plus
`ctx.enemyCtl.splashHazard(body, Cell.Fire, 'direct')`, which refuses a body fire cannot hurt: when it lands, the foe's
`status.burning` is raised to >= 120 and the engine's own status loop does the rest (burn damage, shedding Fire
cells, spreading to flammables, doused by water). Four real Fire cells are also licked onto the body. A fire-proof foe
(imp, colossus, ...) shows `FLARE` instead of `SCORCH` and never gets the status (a burning status on an imp would
hurt it: the engine's immunity only stops the roll, not the timer). A blast that is **primed** is one hit that
scorches every foe it caught.

Tells: an amber flicker at the wand hand and a soft strike when she primes, an amber star at the wand tip and a rising
ember while primed (guttering in the last second), the chip's `meter()` (`MIXTURE` while one weapon waits for a
partner, `SCORCH PRIMED` with the ticks left), a cold hiss when it lapses, a flash, the pyre cue and a `SCORCH` callout
over the foe when it lands.

## Flash Crucible: in the grid

The vial is private to the kit (`vial` state, a drawable on the `'over'` layer), flying like `Flask.ts`'s bottle:
gravity, then the move in sub-steps of at most a cell. It bursts in the open cell **before the first solid or liquid**
(so the flash starts in air), after 40 ticks, or **on a foe's body**. That last is an addition: a flat throw from the
hip passes through a foe at chest height otherwise, and a vial that flies through its target and bursts behind it
reads as a miss. The burst:

- `sys.enemiesNear(r 30)`, each foe `sys.hurt(14, knock)`: damage 14 flat, an outward knock (toward the foe from the
  burst, lifted off the floor). It is not `ctx.explosions.trigger`: nothing is carved and she is not hurt.
- Real cells: 8 Fire (life 18-29) and 3 Ember into open air within 9 cells, never within 13 of her, never into rock.
  Only air and gas are written, so nothing solid can change (probed). Fire can ignite what is flammable nearby: that
  is the grid, not carving.
- A warm flash light (`sys.addLight`, 22 ticks, removed with the floor), a white-hot core and a bold expanding ring
  (14 ticks), 220 GPU sparks, `punch()`, hit-stop 2 when it struck something, props and critters shoved.
- **Her own shove** is not a raw impulse: a velocity of 2.2 handed to the controller is gone in three ticks to ground
  friction (measured: 440 -> 438). It is a 10-tick `startMove` glide that bleeds off and arcs, which is the
  "way to leave" the spec wants: measured **13 cells back and 5 up** from a burst 19 cells away.
- The vial's range is the flask's: from the hip, a flat throw lands about **78** cells out, -10 degrees 126,
  -20 degrees 181, -30 degrees 227 (the longest, the fuse running out at 40 ticks).

The chip: ready / cooling (9 s sweep) is the system's. Refused (the chip flinches, no cooldown spent) only when the
cooldown is running, she is rooted, or the vial cannot leave her hand (the wand tip and her shoulder are both in rock).

## Phoenix Draft: in the grid

- **Faster hands.** What paces a cast is `wand.cooldown` (`castDelay` + `recharge` on a wrap), set when a group fires
  in `PlayerControl.update` and decremented once per tick in `WandSystem.update` (after the fighters' tick). The
  draught decrements it **once more per tick** on both wands from `ultimateTick`, so a cooldown of N is ready in
  ceil(N/2) ticks: no engine hook was needed. Mana is untouched (faster casting spends it faster).
- **Fire-proof.** `setMod('phoenix', ..., { immuneTo: ['fire', 'burning', 'oiled-fire'] })` (the sources the player's
  damage path tags flames and the burning status with) and `status.burning` cleared every tick. Lava, acid and
  explosions still hurt: only fire is her element.
- **The trail** is real cells, behind her (`trailSpan`): every column she covered since the last drop gets a Fire cell
  at her feet (an Ember on one drop in four, at most 14 a draught), a second above 65% of columns and a third above
  30%; 12% of columns are skipped for a ragged edge. Fire rises and spreads in the sim, so a column grows into a lick
  about ten cells tall; a foe in it takes the engine's own fire damage (0.7 a body row a tick) and rolls the engine's
  own ignition (3% per flame cell sampled). Flames last 34-52 ticks: **nothing it writes outlasts the draught by more
  than a second except the Embers**, which the engine never decays (it quenches in water and digs like any powder; 14
  at most per draught, and the sandbox's own Ember Storm card leaves the same).
- Look: a double gold rim around the body (a cell-thick inner ring and a soft halo, a slow chase of brightness), a
  crown of sparks, ember motes, flame licks at each drop and a golden light that follows her (it fades in its last
  third). `reduceFlashes` calms the pulse.
- It ends on its own clock; a reset (death, a new floor, a new fighter) ends it at once and removes the light, the
  drawable and the vial.

## Measured in the real game (`scripts/verify-fighter-ilyra.mjs`, 76 checks, 6 consecutive green runs on the final code)

- Crucible: 14 damage to exactly the foes inside 30 (a foe 48 cells out untouched), foes knocked outward (+3 to +6
  cells in 14 ticks), she takes 0 damage, no rock/metal/glass/crystal cell changed, 3+ Fire/Ember cells scattered,
  no flame ever touched her body, light added and removed, the fuse at **40** ticks, the cooldown ready **540** ticks
  after the press, a refused press while cooling.
- Mixture: spark then kick -> `SCORCH PRIMED`; the next spark -> a 6-damage flare, burning >= 118 the tick it lands
  (120 minus the engine's own sample), a `SCORCH` callout, Fire cells at the strike; same card twice, or two weapons
  more than 4 s apart: no prime; vial then kick primes; a primed vial scorches both foes it catches; an imp takes the
  flare and never burns.
- Phoenix: **9 -> 17 real spark casts over 300 ticks** with the wand held (x1.89; the 36-tick oak cycle becomes 18), 8
  ticks of standing waist-deep in flames costs her 0 hp and she is never alight (and it costs her hp again once the draught
  ends), top run speed **2.85 -> 3.56** cells per tick, 6+ Fire cells in the trail, all behind her, Embers among them,
  four slimes stepped into it all lost 10-25 of 400 hp to flames alone while a control lost none (about half also
  caught fire: the engine's roll), no Fire cell left 160 ticks after the draught, at most 14 coals.
- The classic Alchemist (no fighter) is untouched; `verify-fighter-framework.mjs` is still 22/22; full `vitest`
  green (202 files); `tsc`, `eslint --max-warnings=0` on the kit, tests and `src/fighters`, and `npm run build` clean.

## Not verified / known limits

- **No sound was heard**: the cues are existing ones (`flask.throw`, `flask.shatter`, `boom.small`,
  `spell.flame.ignite`, `spell.crit.pyre`, `spell.emberstorm`, `mat.ignite`, `mat.sizzle`), asserted to be *called*,
  not listened to.
- The chip's `meter()` is provided; whether the HUD track renders it (and pulses the passive's chip) was not checked.
- The vial arcs like the flask and has no aim guide: aiming at a far cursor with a flat hand lands it ~78 cells out.
- A foe that moves out from under a vial in flight is simply missed (the probe pins foes while it flies; in play a
  hopping slime can dodge).
- Spark blast fire can stop a following bolt (Fire cells are in its way): true of every fire in the game, noticed
  while staging the probe.
- A real-time probe on a shared desktop can lose focus to another window (the game then clears held keys and may
  un-pause): the probe re-sends held keys and re-asserts the pause every tick for that reason.
- Boss interactions (the ward, the Kiln's fire immunity) were not exercised; Scorch on a warded boss relies on
  `splashHazard` refusing a fire-proof body, which all four bosses are.

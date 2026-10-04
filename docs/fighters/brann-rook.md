# Brann Rook, the Iron Pilgrim (Bulwark)

Duel now adds four directional/neutral aerial attacks, up/down heavy attacks and a double jump to Brann's existing kit. See [Duel controls, animation coverage and verification](../arena/platform-fighter/sprite-library/animation-v2/DUO-COMPLETION.md). Both characters now have their armed animation sets integrated. Stock damage feeds Pressure, and accepted attacks feed charge.

Files: `src/fighters/kits/brann-rook.ts` (the kit), `brann-rook-logic.ts` (the maths: pure, no engine imports, all
the numbers in one `TUNING`), `brann-rook-plate.ts` (the two drawables). Tests: `tests/fighters-brann.test.ts`.
Probe: `scripts/verify-fighter-brann.mjs` (`node scripts/verify-fighter-brann.mjs http://localhost:<port>/`,
screenshots land in `verify-out/fighters/brann-*.png`).

## Final numbers (`TUNING`)

| | |
|---|---|
| Pressure | 0..100; a single blow that costs >= 6 health adds min(40, 2.5 x lost); bleeds 2/s; at 100 it vents, resets to 0 and holds `staggerResist` for 240 ticks, during which it does not fill |
| Boiler Guard | Z, cooldown 600, plate up 210 ticks, x0.75 walking speed, reach 14, +-65 degrees, leans with the aim by at most 30, frontal melee/blast x0.5, swings up over 8 ticks, flashes a warning for the last 40 |
| Redline | T, 480 ticks, `damageTaken` x0.5 + `staggerResist`; a Steam cloud every 6 ticks (radius 3.5 clouds scattered within 9 cells), a 3-point scald every 15 ticks to every foe within 16 cells; a red light follows her |

## How each ability is made of grid, not flags

**Pressure Vessel.** The kit's own state (`PressureVessel`, saved as `kit: { pressure, resist }` in the run save). It
is fed by `onPlayerHurt(lost)`, the health that actually reached the body after armor and modifiers, so a blow the
plate halved fills half as much. The vent writes real **Steam** cells: five compact clouds (radius 4, keep 0.65,
life 30) scattered within 9 cells of the chest through `stampDisc` (`life` written, or they vanish at once). They rise,
scald foes by the engine's own `STEAM_SCALD`, and condense to water under a ceiling. The held footing is a
`staggerResist` modifier (`pressure-vent`, 240 ticks) that is re-applied from the save. `meter()` returns one reused
object, label `Pressure`, 0..100. The plate's brass heats toward orange with the meter and carries a dial whose
needle climbs with it (the gauge is the passive's other tell).

**Boiler Guard.** Z raises a kit-owned plate: an arc of radius 14 about the chest, +-65 degrees about the aim side,
leaning with the aim by at most 30 degrees (so it always covers the level ahead). It is a drawable on the `over` layer
(black-iron curved plate, brass rim, two brass straps, rivets, a brass-ringed pressure dial).
- *Shots.* `intercept(p)` tests the shot's whole **path this tick** (`p - v -> p`, `segmentSectorEntry`: a disc
  clipped by two half-planes, exact) against the sector, so a shot that strides 60 cells across her in one tick is
  caught where a point test would miss it. The clang (sparks fanned back toward the shooter, a flash on the arc, the
  plate shoved in 2.5 cells, `body.impact.metal`, a one-frame hitstop, a short warm light) is placed on the arc at the
  entry point. A shot that falls short and detonates on the floor in front of her is a *blast*, not a shot, and takes
  the frontal reduction below.
- *Blows.* `reduceIncoming(amount, source, kx, ky)` (the new seam) halves a blow from the front. Where a foe stands
  within 24 cells it is taken to be the one that struck; with none near, the knock vector says (a blast pushes the
  body away from where it came from). A blow with no knock (a hazard tick) has no front. Measured on the real slime:
  bare bite 6.0, plate toward it 3.0, plate turned away 6.0.
- *Z again* lowers it at once (`tacticalAgain`), the cooldown keeps running (measured: not refunded, not restarted,
  not counted as a refusal). Left alone it drops at 210 with a hiss of steam and a latch. While it is up the chip shows
  `active` (`tacticalActive`).
- She walks at x0.75 (`moveScale` modifier; measured 121 cells free vs 91 guarded in 45 ticks of D) and may cast.

**Redline.** `damageTaken` x0.5 and `staggerResist` as modifiers (stacks with the plate: a frontal blast is x0.25).
`applyImpulse` is the engine's one knock verb and the modifier closes it, so a huge knock moves her not at all
(probed with `applyImpulse(9, -5)`, `damage(18, 8, -4)` and a real `explosions.trigger` beside her). Steam: an
ignition of four clouds at the press and one cloud every 6 ticks (measured 117 cells at the ignition). The scald is
`sys.hurt` (credited as her own, charges the bar through `noteEnemyHurt`; the system does not charge during an
ultimate) every 15 ticks on every foe within 16 cells: measured at ticks 14, 29, 44, 59 on a held foe, none on a foe
at 150 cells. Her tell: a red additive wash within 22 cells of her and a heat ring (a `drawable`), embers, a red
authored light that follows her (it can only colour dark ground: lights combine by their brightest channel, and her
lantern is already bright, which is why the wash is a drawable), the ignition's burst and a sigh of steam at the end.

## Engine seams added (all additive and guarded; the classic Alchemist is byte-for-byte unchanged)

1. `FighterApi.reduceIncoming(amount, source, kx?, ky?)` (`core/fighters.ts`): optional knock vector. `Player.ts`:
   `reduceIncomingDamage` takes `kx, ky` and `Player.damage` passes its own arguments (two lines). Hazard ticks pass none.
2. `KitInstance.reduceIncoming?(amount, source, kx, ky)` (`kit.ts`), called by `FighterSystem.reduceIncoming` after the
   modifiers and before the armor.
3. `KitInstance.tacticalAgain?()` (`kit.ts`, `FighterSystem.tryTactical`): Z while the tactical is cooling. True consumes
   the press (no refusal flash); no hook, or false, is the ordinary refusal. Selene's "Z again returns to the echo"
   needs the same hook.
4. `KitInstance.tacticalActive?()` -> `AbilityView.active` for a held tactical (the plate's chip state).

## Measured

- Pure logic: 23 tests (vessel, geometry including a 4000-path brute-force agreement run of the segment test, blow
  side, and the kit on the real `FighterSystem` over a fake world).
- Live probe, 58 checks, repeated clean: vessel (fills 30 for a 12-point blow, nothing for 4, bleeds ~4 in 2 s, vents
  at 100 with 128 Steam cells that all carry a life, resets, holds her against a knock for 4 s, no chained vents, saved
  and restored); plate (raise, x0.75, 20 -> 10 frontal vs 20 behind/above/hazard, the engine's inverted slime knock,
  a real bite halved, a fireball eaten at 12-17 cells out with a clang, a 45-cell/tick shot eaten, a path-strider
  caught that a point test misses, a rear shot not eaten, Z-again, refused while cooling, ready after 10 s, drops at 210);
  Redline (refused with the bar empty, halves damage, no knockback by `applyImpulse`/`damage`/an explosion, steam,
  scald cadence, ends at 480 and restores everything, light removed).

## Deviations and notes

- **Pressure does not fill during the 4 s held footing.** Without that, three heavy blows chain vents into permanent
  immunity. Spec says only "resets to 0".
- **Frontal side is read from the nearest foe within 24 cells, else the knock.** The engine's melee knock signs are
  not consistent (`slime-bite`, `bat-bite`, `golem-slam`, `rillback-flop` push the player *toward* the foe;
  `rillback-bite`, `stonemaw-bite`, `weaver-needle` away), so the knock alone mislabels the most common foes.
- **Steam is clouds, not a disc.** A uniform radius-9 disc of Steam is a white blob under the bloom that hides her; the
  same cells as compact clouds read as vents. The envelope is still radius 9.
- Redline's `staggerResist` also closes `applyImpulse` for the kick's own recoil (`Player.kick`), so she cannot
  kick-jump while it lasts. That is the framework's definition of "no knockback at all".
- The kit never writes a solid, so nothing it does can seal a route; its Steam is a gas with a life.

## Not verified / known limits

- The plate follows the player's *tick* position, not the interpolated one (`FighterDrawable.draw` gets no frame alpha),
  so on a display above 60 Hz it can shimmer a fraction of a cell against the interpolated sprite. A fix is an `alpha`
  argument on `drawFighterFx` (render side, not this kit's).
- Not played by hand on a real mage or a boss, only through the real AI of a slime and hand-pushed hostile
  projectiles; boss attacks that damage through `playerCtl.damage` get the frontal reduction by the same rule
  (nearest foe within 24 cells, else knock), which is untested against each boss.
- Audio is existing cues only (`mech.latch`, `body.impact.metal`, `mat.steam`, `mat.sizzle`, `boom.small`,
  `mech.vault`); we cannot listen, the probe asserts the cue ids that were requested.
- The probe sealed the arena and clears the test level's pickups because walking onto a spell tome opens the card-offer
  modal, which owns the keyboard (see "Probe notes"): the same flake exists in `verify-fighter-framework.mjs` (it
  failed once in 4 runs here, 22/22 on the other three).

## Probe notes

`scripts/verify-fighter-brann.mjs` builds a sealed stone box in the arena each time it resets (the level next door
drips lava and rolls crates into an open arena), clears `levels.current.pickups`, re-equips the kit for a clean state
and ticks twice so the system re-bases its health reading (a heal and a blow in one tick net out for it).
A fireball falls 0.02 per tick squared; the probe aims 3 cells high from 60 out so it arrives level, as a mage's lead would.

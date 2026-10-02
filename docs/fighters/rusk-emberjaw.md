# Rusk Emberjaw, the Furnace Hound (09, Bulwark)

Passive **Scrap Recovery**, tactical **Shoulder Ram** (Z), ultimate **Kiln Heart** (T). Code:
`src/fighters/kits/rusk-emberjaw.ts` (the kit, a lazy chunk) and `rusk-emberjaw-logic.ts` (the `TUNING` object and
the plain maths). Probes: `scripts/verify-fighter-rusk.mjs` (a carved arena, every ability and every refusal, real
key presses), `scripts/verify-fighter-rusk-works.mjs` (floor 1 played as Rusk: the real barricade). Tests:
`tests/fighters-rusk.test.ts` (37, node-only: the maths, and the kit against the real `FighterSystem` over a fake grid).

No engine file was touched: every seam the kit needs was already on `FighterSystem` / `ctx`.

## Final numbers (`TUNING`, live-tunable like `config/params`)

| | |
|---|---|
| Armor pool | 40, starts full; a melee elimination restores 14 |
| Ram | cooldown 540 ticks (9 s); 8 ticks x 5.5 cells = 44; i-frames (6 kept topped up, they linger 6 ticks); 16 damage; shove 4.5; stun 20 |
| Ram wood | every Wood cell in the next 7 columns, her height + 6 rows tall; 40% to Ember when nothing near can catch, the rest cleared |
| Kiln Heart | 600 ticks; armor ceiling 80 and filled; damage taken x0.8; vent: foe within 20, 6 Ember cells, foes within 16 take 6 and burn 300 ticks; one vent per 20 ticks |

## What each ability is in the grid

**Scrap Recovery.** The pool is the system's (`setArmorMax` / `addArmor`; it absorbs inside `Player.reduceIncomingDamage`).
`onEnemyHurt(killed)` restores it when `sys.recentMelee` (this tick or the last: `Player.kick`, the weaver limb swing
and her own ram all call `noteMelee`) or when the wall that finishes a foe her ram flung kills it (`'impaled'`, within
45 ticks of the blow: a bat rammed into a wall is her kill). A spell kill, a fire, or a kill the tick after the melee
window restores nothing. The armor is hers at once; seven bright fragments burst off the foe, steer to her chest, and
the first to land clinks (`body.impact.metal`) and says `+14 ARMOR` (a drawable, additive, so it reads over the gore).

**Shoulder Ram.** `startMove`: 8 ticks of 5.5 cells along her facing, i-frames, level over a gap (she falls the moment
it ends; a fall inside a charge trades a pit for a wall at the far lip). Before each step the kit breaks the Wood in
the columns she is about to enter, and after it the shoulder (her body plus 4 cells ahead) meets foes:

- **Foes.** Each takes `sys.hurt` 16 once per charge, preceded by `noteMelee`, flung with `gustShove`, then stunned 20
  ticks by `sys.stunEnemy`. A stun pins the foe's velocity to zero, so it waits for the shove to carry (3..24 ticks,
  until its knock state is spent). A warded boss is hurt but never stunned or shoved. A foe on the far side of rock
  is spared (the shoulder does not reach through a wall: a `castToSolid` check).
- **Wood.** Cells go through `replaceCellAt` / `clearCellAt` (Ember: `emberColor()`), with splinters of the very wood
  flung ahead. Ember is written only when no tinder (oil, powder, bog gas, moss, grass, leaf, vine, seed, coal, fire,
  lava) lies within 3 cells of the region: otherwise the wood is only cleared. A mostly-broken Wood plug fires on its
  own (`Mechanisms` counts the cells gone or transformed), so a barricade that is a mechanism's seal opens its gate.
- **Concussion.** `ctx.mechanisms.strike` once per charge: on the first break, or at the wall she hits (levers within
  radius + 6 flip, rune glyphs within radius answer). A lever she only runs past is not struck.
- **Walls.** Metal, stone and everything else solid stop the charge (`'blocked'`): a thump (`body.impact.metal` /
  `.stone`), `player.land.hard`, sparks, dust, a shake, 2 ticks of hitstop and a rebound. No cell is touched.
- **Refused** (no cooldown spent, a dull clink) when she is flush against unbreakable terrain with no foe in reach,
  swinging, or dead; allowed flush against Wood.

**Kiln Heart.** `setArmorMax(80, fill)`, `setMod('kiln-heart', {damageTaken: .8})`, and two lights from `sys.addLight`
(the core, riding her chest and cooling over its last third; a short flare at the ignition). A drawable paints the
core on her chest; in the last ~70 ticks it gutters (a deep fast flicker), then goes out with a hiss and `HEART COOLS`.
When a blow from a foe lands with another foe within 20 cells it vents: up to 6 real Ember cells in open air within
11 cells of her, and every foe within 16 takes 6 (`sys.hurt`) and catches fire (`rollCatchFire` far past the "hot
enough" line; fireproof foes take the 6 only). The blow is detected two ways, because armor swallows most of them:
`onPlayerHurt` (health lost) and an armor drop seen in `tick` (the pool fell). Statuses and hazards (`fire`, `lava`,
`acid`, `burning`, `status`, ...) never provoke it. `ultimateEnd` calls `setArmorMax(40, false)`: the pool clamps.

## Measured (real engine, paused deterministic ticks, real key presses)

- Ram: 42..46 cells in 8 ticks from any start; the foe took 16; flung 12..31 cells; stunned 20 ticks, from the 3rd to
  the 24th tick after the hit. A blow during the charge does nothing (invulnerable).
- Wood barricade (10 thick, 30 tall): every cell in her rows gone, 300 before, the rows above her doorway left;
  >= 20 real Ember cells. As a Wood plug wired to a 4x30 Metal door: the plug fires, the door opens, all 120 Metal cells
  retract (fail-open). A Metal wall (6 x 30): 180 cells before and after, she stops at the wall (x <= 466).
- A 3-cell ledge is stepped up mid-charge. A lever bolted beside the wall flips once; one she runs past, and one 45 cells
  beyond the wall, do not.
- Passive: kick kill 10 -> 24; clamp at 40; Spark Bolt kill 10 -> 10; a kill 6 ticks after the kick 10 -> 10; ram kill
  10 -> 24; bat slammed dead by the ram 10 -> 24.
- Kiln Heart: 80/80 armor, 10 damage -> 8, a vent writes 6 Ember cells, the foe 100 -> 94 and burning 300, an imp
  takes the 6 and does not burn; the 63 she carried clamps to 40 at the end; the two lights are gone again.
- **Floor 1, the real Intake barricade** (378 Wood, 48 Moss caulking, 8 Oil in its core): she rams through from the
  spawn, the plug (a route seal) latches, Wood 0 / Moss 0 / Fire 0 afterwards, hp 110/110 and armor 40/40, the
  objective moves on to "Pull the engine crank". The first version of the ram (40% Ember everywhere) killed her
  there: the Embers lit the moss and oil and she stood in the blaze with 598 ticks of oiled-burn. That is why Ember
  is now tinder-aware, why Kiln Heart banks its embers near oil, and why the probe plays the real barricade.

## Deviations from the spec, and why

1. **`Mechanisms.strike` does not break doors.** It flips levers and answers rune glyphs, nothing else; mechanism doors
   are Metal and open from their triggers (fail-open is already on the triggers). "Breaking doors" is therefore the Wood
   path (a barricade or Wood door is a Wood plug, which the existing plug logic fires and which opens its gate) plus
   the concussion on levers and runes. A Metal door is a wall, as the brief wanted.
2. **Ember is conditional.** Spec: Wood "burned to Ember". Here 40% Ember when safe, otherwise only cleared (see above).
3. **Kiln Heart's trigger** also fires on a blow the armor swallowed (spec: `onPlayerHurt`, which hears only health
   lost, and she has 80 armor). Statuses and hazards are excluded; one vent per 20 ticks.
4. **Ember banked near fuel.** With oil, powder or bog gas within 8 cells of her, or while she is oiled, the vent writes
   no Ember cells (the foes are still scorched). A pool fire at her own feet is not the answer to a blow.
5. **Scrap Recovery** also pays for the wall that kills a foe her ram flung (the spec names a ram elimination; the
   kill that follows the shove is the same one).
6. **Stun after the shove**, not at the blow (the system's stun pins velocity, which would cancel the shove).
7. **No stun on warded bosses**; the blow lands, the shove does nothing (the engine already refuses it).
8. **Level charge.** No gravity inside the 8 ticks (the framework's dashes do the same).

## Notes on the framework (not changed; for whoever owns it)

- `FighterSystem.equip` zeroes `armor` / `armorMax` after a cached kit has been adopted synchronously, so a kit that sets
  its pool in `create` is wiped (an uncached kit is not, because adoption comes later). Rusk therefore sets her pool on her
  first `tick` and again after a respawn (`playerRespawned` / `playerDeathCleared`: the system's `resetAll` zeroes it).
- A stunned, grounded foe gets one free AI tick in four: `tickKnock` "bumps the floor" as gravity accumulates, which
  zeroes `knockT`, and `keepStunned` re-pins it on the next tick. The stun still holds the foe in place for the full 20
  ticks (probed), but its AI timers run at a quarter speed under it.

## Not verified

- A weaver limb kill restoring armor: it relies on the existing `noteMelee` call in `WeaverLimbs`, not exercised here.
- Sound: cues are existing ones (`player.dive`, `creature.golem.step`, `body.bash`, `body.smash.wood`,
  `body.impact.metal` / `.stone`, `player.land.hard`, `player.skid`, `spell.emberstorm`, `mat.ignite`, `mat.sizzle`,
  `mat.steam`); the probe records that they were requested, nobody has listened.
- The look: every screenshot is the default alchemist sprite (the look track's `fighterLooks` own Rusk's art), so the
  glow and streak drawables were judged against that body. Reduced-flash mode softens them in code but was not
  photographed.
- Crates and other rigid bodies are not shoved by the ram (the spec names foes only).
- The 20-tick vent guard is unit-tested; in the real engine a player blow's own 30 i-frames make it unreachable.

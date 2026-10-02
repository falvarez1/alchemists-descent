# Movesets v2: spells, weapons and techniques that are *theirs*

**Status: design, first draft (2026-10-01); phase 6 of `docs/arena/MASTER-PLAN.md`** (the movement techniques are built
earlier, with the bodies, phase 1b). A Smash character is a *moveset*: a way to move, a basic attack, a handful of specials and
a finisher. Today a fighter is a body (phase 1) plus three abilities, and the basic attack is whatever wand the player
carries. This document defines what a complete moveset is and how each of the ten gets one, using what the engine has.

## 1. The verbs of a fighter

| Verb | Today | v2 |
|---|---|---|
| **Move** (run, jump, climb, levitate) | one body for all | a `BodyProfile` each (phase 1) |
| **Movement technique** | Selene's slide, Sable's tether, Kest's climb, Rusk's ram | one per fighter, none shared (phase 1b) |
| **Primary attack** (mouse, held) | the wand: the player's cards | a **signature wand**: a fixed card loadout chosen for the fighter (phase 6a) and, for the melee fighters, a signature melee (6b) |
| **Kick** (F) | one shared kick | per-body: damage and reach scale with `dealt`; Brann and Rusk's kicks are heavier (6b) |
| **Flask** (Q pour, X sip, throw) | the shared flask | a signature flask belt (fire for Ilyra, water and steam for Brann...) (6a) |
| **Tactical** (Z) | the kit | the kit, tuned for the role; optional *direction variants* (Z + up/down) later (6c) |
| **Ultimate** (T) | the kit | the kit, with a match-aware charge (6c) |
| **Passive** | the kit | the kit |
| **Defence** | Brann's plate, Edda's shard, Selene's echo; nothing universal | decision pending (a universal air-dodge, `ARENA-RULES.md` 5, D-006) |

## 2. The signature wand (phase 6a): uniqueness from cards the engine already has

The wand system compiles a list of cards into a program (`WandSystem`); `applyStarterLoadout(wands, collection)`
(`WandSystem.ts:980`) already installs two wands and a satchel. The arena gives each fighter a **signature loadout** from
the existing 39 card ids (`spark bomb lightning flame dig warp blackhole vitriol cryojet frostshard icelance wisp meteor
conjure emberstorm vitrify` as payloads; `double triple speed heavy spread infuser watertrail oiltrail electriccharge critwet
shorthoming frostcharge shattercrit pyrecrit aquajet trigger bounce overcharge loosecannon shortfuse millstone kickback` as
modifiers). Loadouts are **data** (`content/fighterLoadouts.ts`), granted when the fighter is equipped in an arena; no new
combat code, so it can be tuned by the telemetry tuner like any number. First draft:

| Fighter | Wand I | Wand II | Flask belt | The idea |
|---|---|---|---|---|
| Ilyra | `spark` + `double` + `speed` | `flame` + `pyrecrit` | oil, gunpowder | a fast two-weapon rushdown: a spark pistol and a flame jet, so Volatile Mixture fires every few seconds |
| Brann | `bomb` + `heavy` + `shortfuse` | `kickback` | water | point-blank heavy shots with recoil; steam from the water |
| Sable | `wisp` + `shorthoming` | `spark` + `spread` | slime | homing pokes that keep the wounds coming |
| Mara | `lightning` + `electriccharge` | `wisp` + `bounce` | water | wide, ringing arcs; the bells and the chime do the controlling |
| Kest | `spark` + `triple` + `speed` | `dig` | oil | darts on the move; dig for the shortcuts |
| Nox | `vitriol` + `trigger` | `blackhole` | nitrogen | shots that leave a mess; a black hole for denial |
| Edda | `icelance` + `shattercrit` | `frostshard` | healium | precise lances; the shard defence |
| Selene | `spark` + `bounce` + `spread` | `warp` | water | ricochets and the blink |
| Rusk | `flame` + `overcharge` | `bomb` + `loosecannon` | oil | close, burning, loud |
| Thorne | `conjure` + `bounce` | `spark` + `infuser` | water, slime | seeds and traps (the signature seed-sling needs a new card, 6b) |

The exact cards will change; what is fixed is that **no two loadouts are the same** and each reads as the fighter's style.

## 3. Signature melee and weapon techniques (phase 6b): new combat code, kept small

For the fighters whose fantasy is a weapon in the hand (Brann's piston fist, Rusk's gauntlet, Kest's hook-knife, Selene's
shuriken, Thorne's thorn-bow), a **signature primary** replaces or augments the wand's mouse button. It is a *move table*:
startup, active, recovery frames, a hit shape, damage, knockback (with the fighter's `dealt` and `mass` applied), an
effect, and a tell (a sprite pose or a spark). Implemented as a `Primary` object in the kit (`kit.primary?()`), reusing the
existing hit machinery: `FighterSystem.hurt` for damage, the foe effects (`slowEnemy`, `stunEnemy`) for status, `startMove`
for lunge, the arena's proxy redirect for fighter-vs-fighter. Phase 6b ships the two heaviest (Brann, Rusk) first; the rest
follow the telemetry, because a primary is the part of a moveset most likely to be wrong.

## 4. Direction variants (phase 6c, optional)

Smash has neutral/up/side/down specials. Z could read the held direction: a neutral Z is the tactical as designed; Z with
down held is a defensive or trap variant; Z with up held is a recovery variant. That doubles the tactical count for no new
button. It is only worth doing after the bodies, the bots and the telemetry exist, because a variant is a balance liability
until it can be measured.

## 5. Order of work

1. (1b) the ten movement techniques, built from `FighterMod` + `startMove` + the body profile.
2. (6a) the signature loadouts as data; the Yard's panel shows them; a bot uses its fighter's loadout.
3. (6b) Brann and Rusk's signature primaries, then the telemetry decides which of the rest need one.
4. (6c) direction variants and universal defence, once the match rules exist.

## 6. Built (2026-10-01): the signature loadouts (6a), and what the telemetry said about them

`content/fighterLoadouts.ts` (data: a frame and cards for two wands and a flask belt per fighter), applied by `ArenaSlots` to BOTH
fighters when a bout starts (`applySignature`; off with `ArenaSlots.signatureLoadouts = false`), `scripts/loadout-lab.mjs` (try candidate
loadouts against a standing or a fighting target: the way the cards below were chosen), `scripts/fight-dps.mjs` (the DPS rig). The
harness takes `loadouts` per fight, so a loadout is tuned like a number.

**Why it had to come first.** While every fighter carried the shared Spark Bolt, 80% of all damage in a duel was that bolt and the kick
(`spell` 40-88 a fight, tactical and ultimate near 0), so fights were decided by the body's health and power multipliers: Rusk 91%,
Brann 85%, Mara 17%, whatever their kits said. The signature primary is where a style lives.

**The loadouts (wand I is the weapon a bot holds; wand II is the second slot a person can swap to):**

| Fighter | Wand I | Shape | Idea |
|---|---|---|---|
| Ilyra | quill: double + spark + spark | pairs of fast sparks | rapid rushdown; the flame jet waits in wand II |
| Brann | mortar: heavy + spark | slow, hard, long recharge | the body walks the heavy shot in |
| Sable | oak: shorthoming + wisp | homing motes | pokes that keep the wounds coming |
| Mara | samovar: electriccharge + spark | electrified bolts, a big tank | the bells and the chime control; the arcs wait in wand II |
| Kest | pepperpot: triple + speed + spark + spark | a fan of fast darts | always moving |
| Nox | bone: trigger + spark + lightning | a spark that releases a chain where it lands | the trap shot; acid and a black hole in wand II |
| Edda | void: frostcharge + icelance + shattercrit + icelance | piercing, freezing, harder on the frozen | precision |
| Selene | oak: bounce + spread + spark | a fan of ricochets | the blink does the rest |
| Rusk | brass: kickback + bomb | a lobbed charge, twice as hard | close and loud; the flame jet waits in wand II |
| Thorne | oak: bounce + millstone + spark | a heavy rebounding bolt | a thorn that comes back; the stone disc waits in wand II |

**The DPS rig (a level-5 bot against a standing Nox, median of 5):** Brann 5.0 s, Sable 5.5, Selene 5.5, Thorne 5.5, Kest 6.0,
Edda 6.0, Ilyra 6.5, Mara 7.5 (9 s after the swap to electrified sparks), Rusk 25 s with the flame jet (a flame is a terrain tool: 0.7 a
contact). One band of 5-9 s with different shapes: that was the aim.

**Findings the lab turned up (they decide what a card is FOR, and are not obvious):**
- The **flame jet is not a weapon** (36 s to kill a standing foe): it lights things. It lives in wand II for the fire fighters.
- **Chain lightning is a poor bot weapon** (16-25 s): the arc only reaches what it touches. Mara and Nox keep it, behind another card.
- **A bomb ends a duel** (746 damage to a standing foe): the fix is not the loadout, it is the rule that a fighter takes a blast as a
  fighter always has (capped at 42, `sim/explosion`).
- `overcharge + spark` kills in 5 s and `millstone + bomb` in 4.5 s: the multiplier cards are the strongest and need the rarest slots.
- A **vitriol spray** does almost nothing to a fighter that steps out of the pool (0-18 damage in 60 s).

**Not built:** the signature melee primaries (6b: Brann's piston fist, Rusk's gauntlet, Kest's hook-knife, Selene's shuriken, Thorne's
thorn-bow), direction variants (6c), a panel readout of the loadout. A bot holds only wand I (it never swaps).

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

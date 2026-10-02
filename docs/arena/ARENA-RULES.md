# Arena rules: how a fight is won

**Status: design, first draft (2026-10-01).** The Proving Yard (`world/fighterArena.ts`) is a test arena with no rules: one
fighter, foes, nothing to win. This document defines the rules that turn it into a *fight*, in two stages so that the
first bot-vs-bot fights and the first telemetry can start long before the full Smash ruleset exists
(`docs/arena/MASTER-PLAN.md`, phases 3 and 5).

## 0. Principles

- **Rules are data, not code paths.** A match is a `MatchRules` object; the same engine runs a health duel, a stock match
  and a free-for-all.
- **Every rule has a stalemate answer.** Edda's heal window and a kiting Mara can stall forever; no fight is allowed to
  have no ending (a time cap, then sudden death, then a collapsing stage).
- **The grid explains it** (CLAUDE.md): a ring-out is a body leaving the arena's box; the collapse is rising lava; a
  respawn platform is real cells. Nothing is a number on an entity that the world cannot show.
- **Fail-open.** No ability or hazard may lock a fighter out of the fight (a trap may hold, never seal).

## 1. Stage A: the health duel (first playable, phase 3)

Needed for the first bot fights, the first telemetry and the first balance pass, and it needs no new damage model.

| Rule | Value |
|---|---|
| Fighters | 2 (a human and a bot, or two bots) |
| Win | the other fighter's health reaches 0 (the existing `Player.damage` / `reduceIncoming` path) |
| Time cap | 90 s; then sudden death |
| Sudden death | the stage's lava begins to rise (1 cell per 6 ticks) until someone is out of the box; the higher health wins a tie |
| Ring-out | none yet: the arena is a closed hall (the Yard's walls), so a fight is decided by health or the cap |
| Respawn | none: one life per fight |
| Spawn | opposite ends of the muster / far nook, facing each other, symmetric heights |
| Items | the two potions, once, mid-stage (a potion is a contested resource) |
| Result | `winner`, `reason` (`ko`, `timeout`, `suddendeath`), final health, time |

## 2. Stage B: the stock match (full Smash feel, phase 5)

### 2.1 Volatility instead of health

Health is replaced, in stock matches, by **volatility %**: a fighter starts at 0% and every point of damage it takes
raises it. Volatility does not kill; it makes every later hit send the fighter further. A fighter is "KO'd" when it leaves
the blast zone.

```
launch speed  =  (baseKnock + knockGrowth * damageOfThisHit * (1 + volatility / 100 * volK)) * hitScale / bodyWeight
volatility   +=  damageOfThisHit * volatilityRate(defender)         // volatilityRate = 1 / body.hp  (a low-health body fills faster)
hitstun ticks =  round(launch speed * stunK)                         // no control while tumbling
```

`bodyWeight` is the fighter's `wt` from the roster table (heavy = launched less); `hitScale` is per attack (a kick vs a
crucible). `baseKnock`, `knockGrowth`, `volK`, `stunK` are global match constants in `config/arenaRules.ts` and are tuned
by telemetry. The existing knockback arguments (`kx`, `ky` on `Player.damage`) become the *direction and base* of the hit;
the volatility scale multiplies them in one seam (`Player.applyImpulse`).

### 2.2 Directional influence and recovery

- **DI:** holding a direction while launched bends the trajectory by up to 12 degrees (a global constant, per-fighter
  scalable). It is the cheapest way to make a hit feel like a decision.
- **Recovery:** the LEV jet is the "double jump": a fighter that is launched out of the box regains control after hitstun
  and can fly back with its remaining LEV. Heavy bodies (low `lev`) recover badly; floaty ones (Mara, Edda) recover well.
  Tethers (Sable), blinks (Selene), updrafts (Kest) and dashes (Ilyra) are the specials-as-recovery of the roster.
- **Tech:** landing from a launch within a few ticks of the floor removes the tumble (a ground tech); optional (phase 6).

### 2.3 The blast zone, stocks and respawn

- The **blast zone** is a box around the stage (the Yard's hall plus a margin of 120 cells above the roof and 200 below the
  floor, the side walls opened or removed for the stock stage). Leaving it costs a **stock**.
- **3 stocks** by default; the match ends when one fighter (or team) has stocks left.
- **Respawn** on a **respawn platform** (real Metal cells, lowered from the roof by the stage) at the centre for 2 s of
  invulnerability, then it retracts; volatility resets to 0 on respawn (so a fight is a series of stocks, not one long
  snowball).
- **Time cap:** 6 minutes, then the one with more stocks wins; tie: lower volatility.
- **Sudden death:** both at 300% volatility, one stock.

### 2.4 The collapse (the battle-royale answer)

From minute 3 the stage shrinks: lava (or brine) rises from the floor at 1 cell per 4 ticks, the roof lowers, the walls
close in. A fighter in the liquid takes damage as the world's fire does today. By minute 5 the stage is a small island.
The collapse is a real-cell hazard (`Cell.Lava`) so the existing sim, light and fire behave; the findability audit does not
apply (an authored arena) but the **fail-open** rule does: the collapse never seals the respawn platform.

## 3. Match types

| Type | Fighters | Win | Notes |
|---|---|---|---|
| Duel (stage A) | 2 | health to 0 | first, for bots and telemetry |
| Stock duel | 2 | stocks | volatility, blast zones |
| Free-for-all | 3-4 | last with a stock | camera frames all; the bot brain needs target selection |
| Team | 2v2 | team stocks | Edda's shard and Mara's bells finally have allies (`allyTargets`) |
| Gauntlet (existing, solo) | 1 vs foes | clear the wave | the telemetry's pre-PvP scenario and the roster's PvE test |

## 4. Camera and the sim window

The camera must frame every live fighter (a dynamic zoom between a minimum and the full hall) and the sim window
(camera +-60 cells today, `Game.ts:834-842`) must cover the **union** of the fighters' windows, within a budget
(`docs/PERF-2026-09.md`). In a closed hall of 1500 cells the whole stage may be simulated at once; measure first
(`docs/arena/TASKS.md` A5.x).

## 5. Universal defensive options (phase 6, optional)

Smash has a shield, a roll and a spot dodge for everyone. This game has none for the Alchemist; the fighters' kits each carry
a defensive tool (Brann's plate, Edda's shard, Selene's echo) so a universal one risks making them redundant. Decision
pending (`docs/arena/DECISIONS.md`, D-006): prefer a single **air-dodge/roll with a stamina cost** so a fighter always has a
recovery option, tuned by telemetry.

## 6. Stages

The Proving Yard is stage 0 (the test arena). The first fight stages are authored in the Builder (`EditorDocument kind:
'arena'`, `docs/BATTLE-ROYALE-AND-SPACETIMEDB.md` stage B):

1. **The Foundry** (the Proving Yard, reduced to a fair, symmetric box: one slab each side, a central pool).
2. **The Kiln Floor** (a lava floor and three platforms: edge control and fire).
3. **The Cistern** (a flooded stage: water slows, electricity matters).
4. **The Gallery** (vertical: a tower with platforms, Kest and Mara's stage).

Every stage ships with: symmetric spawns, a blast zone, a respawn platform, a collapse hazard, a mirror test (a fight with
the sides swapped must not change the result beyond noise: a telemetry check, `docs/arena/TELEMETRY-AND-BALANCE.md`).

## 7. What changes in the engine

| Seam | Change | Phase |
|---|---|---|
| `Player.damage` / `applyImpulse` | volatility scaling, hitstun, DI | 5 |
| a `MatchDirector` (`src/arena/MatchDirector.ts`) | owns `MatchRules`, stocks, timers, the collapse, results; emits `match*` events the telemetry listens to | 3 (duel), 5 (stocks) |
| `config/arenaRules.ts` | the match constants, live-tunable and range-declared | 3 |
| the Yard's `fighterArena.ts` | symmetric duel stage, respawn platform, collapse emitters | 3, 5 |
| the camera | multi-target framing | 5 |

## Built (2026-10-02): Stage A, the health duel, as it plays today

`world/duelStage.ts`, level `fighter-duel` ("THE DUEL STAGE"): a walled, roofed room 560 cells wide (x 520-1080) and 230 tall, dry, lit
(ambient 0.92), symmetric about x = 800: a stone floor over an indestructible base (a blast can crater it, never open the stage), a
5-high plinth in the middle (a step, never cover: a 16-high block blocked shots at shoulder height and split the bots), two metal platforms
72 above the floor (x 580-650 and 950-1020) and a perch 120 up over the middle (a floating slab: nothing hangs between it and the floor).
Spawns are on the floor at x = 580 and 1020, facing in. The 640-wide view holds the whole room, so there is no camera to leash.
A *Rematch* clears and re-stamps it.

The rules in force: a bout is **fighting** until a knockout, then **won** (the winner named, the time shown); **there is no clock, no
sudden death, no stocks and no respawn yet** (a fight that nobody wins ends by a tick cap in the batch only: 90 s, won on health). A
fighter's blows reach the other at `ARENA_RULES.blowScale` (0.4), a blast at most 42, and **who resolves first each tick is a seeded coin**
(`ArenaSlots.rivalsFirst`). Hazards and the world's own drip (fire, acid, electricity) hurt a fighter at their normal rate. Each fighter
carries its own wands and flasks (`fighterLoadouts`).

Open in this document, by priority: the clock and sudden death (a rising lava floor), volatility and scaled knockback, blast zones and
stocks, the second stage (the Kiln Floor), the collapse. None changes the contract of the slots; each is a few lines in `ArenaSlots.hit`
/ `endTick` and a `MatchDirector` (`TASKS.md` R5.x).

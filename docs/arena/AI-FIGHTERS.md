# AI fighters: a computer opponent that plays like a person

**Status: design, first draft (2026-10-01).** Phase 4 of `docs/arena/MASTER-PLAN.md`. It builds on the second combatant
(`docs/arena/ARCHITECTURE.md`, phase 3), but its first two milestones (v0, v1) can be developed against today's
fighter-vs-foe Proving Yard, which is also where the telemetry gauntlets run
(`docs/arena/TELEMETRY-AND-BALANCE.md`).

## 1. Goals and non-goals

**Goals.**
1. **A bot can drive any of the ten fighters** through everything a person can: run, jump, levitate, climb, kick, cast the
   wand, use the flask, press Z and T, aim.
2. **No cheating.** The bot writes the same inputs a person's keyboard and mouse would, through the same input object, and
   it perceives the world through the same rules (an opponent hidden by smoke, darkness or Nox's Long Night is *hidden*
   from the bot too; it remembers a last-known position, as a person would).
3. **Each fighter plays in its own style.** Brann holds the centre, Kest circles and darts, Mara zones, Thorne plants the
   stage. The style comes from per-fighter *playbooks* (data), not from one brain with ten skins.
4. **Skill is a dial, not a different bot.** Reaction time, aim error, decision rate and mistake rate scale from level 1
   (clumsy) to level 5 (sharp), so the same brain produces a tutorial opponent and a balance-testing opponent.
5. **Deterministic and fast.** Seeded (its own `Rng`, never `entityRandom`), no wall-clock reads, no DOM; a fight with two
   bots runs inside the paused-step regime (`TELEMETRY-AND-BALANCE.md` 3.3).
6. **Explainable.** The Arena panel shows what a bot is thinking (its intent, target, why it did not press Z).

**Non-goals (for now).** Learned or neural policies; imitating a particular human; online adaptation to a human's habits.
(A telemetry-tuned *parameter* search for the brains is in scope: v4.)

## 2. Architecture: five layers

```
 WorldView  ->  Intent  ->  Tactics  ->  Control  ->  Execution   ->  InputState (keys, mouse, Z/T/kick/flask)
 (what I see)  (what I want)  (what I'll do)  (how I steer)  (how well I do it)
```

1. **WorldView** (`src/arena/ai/worldView.ts`). A read-only snapshot per decision tick: me (position, velocity, health or
   volatility, LEV, armor, ability readiness from `ctx.fighters.view`), each visible opponent (position, velocity, facing,
   last-seen tick; hidden opponents carry a decaying last-known estimate), hostile projectiles (position, velocity,
   predicted closest-approach), hazards (the grid: lava, fire, water, deep pit), stage geometry (blast zone, platforms),
   the clock. *Visibility* uses the game's own rules (`playerVisibility`, concealment, the light field where relevant).
2. **Intent** (`intent.ts`). A utility-scored choice of one goal from a small set: `approach`, `retreat`, `zone` (hold a
   preferred range), `pressure` (stay on top of a stunned or hurt opponent), `defend` (guard, dodge, shield), `bait`,
   `reposition` (take height, take a wall, take the centre), `recover` (get back to the stage), `edge-guard` (stocks), `item`
   (a potion). Each goal scores from the WorldView with the fighter's *archetype weights* (a brawler loves `approach`, a
   kiter loves `zone`). Goals are sticky (a minimum hold of 12-30 ticks) so the bot does not flicker.
3. **Tactics** (`playbooks/<id>.ts`). The per-fighter list of **rules**: `{ when: (view) => boolean, do: Action, priority,
   cooldownTicks }`. They pick *which move* serves the goal: Brann's rule "a hostile projectile closes within 60 on my
   facing side -> Z (plate)"; Ilyra's "opponent at range 38-46 and Z ready -> aim at their feet, Z, then dash"; Mara's "opponent
   in the lane I commonly use and < 2 bells placed -> Z at the lane"; Rusk's "opponent committed (in a cooldown, a hitstun, a
   recovery) and in ram range -> Z". Playbooks are where the roster's identity lives in the AI.
4. **Control** (`control.ts`). Turns a goal and a move into per-tick inputs: a horizontal direction toward a target x with
   arrival braking (the fighter's traction matters: Selene overshoots, Brann stops), a jump when a ledge needs it, climb
   input along a wall, levitation held for the right number of ticks, an aim point with lead (opponent velocity), a press of
   fire / kick / Z / T / the flask. A **navigator** (`nav.ts`) gives the next waypoint: for the Yard (a mostly flat hall
   with slabs) it is a hand-authored list of nodes and links per stage (`StageNav`), with jump and levitation edges;
   later stages add an automatic standing-cell graph.
5. **Execution** (`execution.ts`). Skill noise on top of Control: a **reaction delay** (the WorldView the decision uses is
   `delay` ticks old), an **aim error** (degrees, growing with the opponent's speed), a **decision interval** (how often Intent
   re-evaluates), a **mistake probability** (mispress, wrong ability, late guard). All draws come from the bot's `Rng`.

| Level | Reaction | Aim error | Decision | Mistakes | Used for |
|---|---|---|---|---|---|
| 1 | 28 ticks | 16 deg | 20 ticks | 12% | the first-run "training dummy that hits back" |
| 2 | 18 | 9 | 14 | 7% | a casual opponent |
| 3 | 11 | 5 | 10 | 4% | the default |
| 4 | 7 | 3 | 8 | 2% | a strong opponent |
| 5 | 4 | 1.5 | 6 | 1% | the balance tester |

All numbers are starting points and live in `config/aiTiers.ts` (live-tunable, range-declared).

## 3. The input seam

The bot never reaches into the player's body. It writes an `InputState` (the same shape `InputManager` fills:
`keys`, `mouse` world x/y, `firing`, plus the press edges for `tactical` and `ultimate`) and the fighter's controller reads it
exactly as it reads a person's input. For a second fighter this is the **slot's input object** (the context-swap bundle in
`ARCHITECTURE.md`); for the first bot milestones against foes it drives the single player slot in the Yard while the
keyboard is detached ("watch mode"). Presses are *edges* with the engine's `pressWindow` (8 ticks): the bot presses and
releases like a hand.

## 4. The playbooks (one rule list per fighter, first draft)

Each fighter's playbook has the three abilities, a movement rule, a defence rule and a "finisher" rule. Examples (the full
set is in `ROSTER-IDENTITY.md` under "AI playbook"):

| Fighter | Archetype | Z | T | Movement style |
|---|---|---|---|---|
| Ilyra | brawler-skirmish | crucible at range 38-46 then dash in | when behind in a trade and the opponent is in range | in and out, never stationary |
| Brann | wall | plate on an incoming shot in front | opponent within 25 | walk to the centre and hold |
| Sable | trapper-hunter | tether to a ledge above, or yank a stunned foe | opponent out of sight and wounded | poke, retreat to a wall |
| Mara | zoner | bell on the opponent's approach lane (max 2) | 3+ threats or a shooter in range | drift at range, glide away |
| Kest | skirmisher | dash through, or away from, a committed foe | launch near a blast edge, or to recover | circle, take height |
| Nox | stalker | canister early, fight from inside | opponent at mid range with no area denial | stay in the cloud |
| Edda | support | shard before a predicted trade | prism in a firing lane | hover at medium range |
| Selene | trickster | blink out of a trap, return when safe | 2+ foes or a hunter in range | slide through range, never stop |
| Rusk | charger | ram when the opponent is committed | embers: stand next to a foe | close the gap, hold armor |
| Thorne | trapper | vines on the surface the opponent must cross | growth zone: hold the centre | stay in his own growth |

## 5. Debugging and the Arena

- The Arena panel (`ui/FighterArenaPanel.ts`) gains a **Bots** section: per fighter slot, a brain (`off`, `dummy`, `v1`,
  `playbook`), a level 1-5, and a line `intent: zone -> Mara  rule: bell-lane (ready 3s)`.
- A debug overlay draws the navigator's path, the aim point, the predicted projectile line and the preferred range ring.
- A console command `ai <slot> <brain> [level]`, and a scenario runner `ai scenario <name>` that sets two fighters, a seed
  and a stage and runs to the end with the telemetry recorder on.
- A **Watch mode**: pick two fighters, press Fight; the camera frames both; the telemetry recorder streams; the fight ends
  with a result card and a "review" link (`TELEMETRY-AND-BALANCE.md` 3.8).

## 6. Test plan

1. **Unit** (Vitest, no DOM): intent scoring picks the expected goal for hand-made WorldViews (a brawler approaches, a
   kiter retreats from a closing foe); execution noise is seeded and reproducible; playbook rules fire in the expected
   order; the navigator finds the Yard's routes.
2. **Scenario probes** (Playwright, real loop, `scripts/verify-ai-*.mjs`): a bot approaches a stationary dummy and hits
   it; a bot blocked by a slab climbs it; a bot recovers from a ring-out; a bot raises Brann's plate against a shooter; every
   fighter's brain uses its tactical at least once in a 30 s fight; no bot stands idle (> 2 s without an input) unless its
   playbook says so.
3. **Soak:** 1,000 bot-vs-bot fights with no page error, no stuck bot (the stuck detector: the same position for 3 s while the
   goal says move), no fight past the time cap.
4. **Quality gates** (reported, not asserted at first): bot level 5 beats level 1 of the same fighter >= 85% of the time;
   an archetype-appropriate range distribution (`ROSTER-IDENTITY.md` fingerprints).

## 7. Milestones

| | What | Needs |
|---|---|---|
| v0 | the **dummy**: stands, presses Z/T on a timer, aims at the nearest foe | the input seam |
| v1 | **approach and attack**: walk to a preferred range, aim with lead, fire the wand, kick when adjacent, basic jump over a slab | WorldView, Control, a flat-hall navigator |
| v2 | **playbooks**: the ten rule lists, defence (guard on a shot), item use, skill tiers | Intent, Tactics, Execution |
| v3 | **stocks**: recovery, edge-guarding, respawn handling, free-for-all target selection | arena rules stage B |
| v4 | **tuned**: archetype weights and tier numbers fitted by telemetry sweeps (`fight-tune`), never by hand alone | the telemetry pipeline |

## 8. Risks

1. **The bot is the instrument.** Balance numbers are only as good as the brain; report every metric per brain and level,
   and compare against a *human* sample (a handful of recorded fights) before trusting the matrix.
2. **Aim-heavy and dash-heavy kits look weak under a poor brain** (Sable's tether, Kest's dash, Selene's blink); give those
   playbooks the most care and a hand-tuned "expert script" to compare against.
3. **Stuck bots** (a slab it cannot climb, a pit, a trap). The stuck detector and a `recover` goal are not optional.
4. **Nav on the Proving Yard is hand-authored.** A new stage needs a `StageNav`; the automatic graph (phase 6) removes the cost.
5. **Perception rules differ per fighter** (Nox's darkness, Thorne's camouflage, Kest's smoke): the WorldView must read the
   same concealment the enemies read (`Enemies.ts` `observedPlayer`), or the bot will see through the abilities it is meant
   to be fooled by.

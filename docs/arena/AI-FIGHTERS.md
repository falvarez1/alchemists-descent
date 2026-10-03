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

## 9. Built and measured: v0 and v1 (2026-10-01)

Built (a work package written by an agent that was stopped by a rate limit before it could verify anything; finished and verified
by the integrator): `src/arena/ai/` (`brain.ts` the contract and `Hands`; `driver.ts` installs a brain on a slot, hands the keyboard
back; `worldView.ts`; `control.ts` steering with traction awareness and aim with lead; `execution.ts` reaction delay, aim error,
decision interval and lapses from the brain's own seeded `Rng`; `intent.ts`; `nav.ts` the Yard's hand-authored nodes; `brains/dummy.ts`
and `brains/basic.ts`), `config/aiTiers.ts` (the five skill levels, live data with ranges), `input/externalControl.ts` (the
keyboard-detach switch, a `WeakSet` keyed by the input object), the `InputManager` guards (gameplay keys, mouse, wheel and pad do nothing
while a bot drives; Escape, the console and the panel's keys still work), `Game.updateFixedTick` (`runBots(ctx)` right before
`playerCtl.update`), the console `ai` command, and the panel's **At the controls** section (You / dummy / basic, skill 1-5, one line
of what the bot is thinking, and its counters).

Measured (`node scripts/verify-ai-basic.mjs`: a level-3 `basic` brain, the keyboard detached, a ring wave of two slimes and a golem,
a paused world stepped tick by tick; 3 seeds a fighter):

| Fighter | cleared | median | idle (longest empty-handed run, ticks) | Z used | T used |
|---|---|---|---|---|---|
| Ilyra | 3/3 | 3.7 s | 51 | 3/3 | 0/3 |
| Brann | 3/3 | 5.3 s | 39 | 3/3 | 3/3 |
| Sable | 3/3 | 4.0 s | 46 | 3/3 | 1/3 |
| Mara | 3/3 | 4.3 s | 54 | 3/3 | 3/3 |
| Kest | 3/3 | 1.6 s | 9 | 3/3 | 0/3 |
| Nox | 3/3 | 1.7 s | 5 | 3/3 | 3/3 |
| Edda | 3/3 | 2.5 s | 3 | 3/3 | 2/3 |
| Selene | 3/3 | 2.0 s | 7 | 3/3 | 3/3 |
| Rusk | 3/3 | 3.0 s | 0 | 3/3 | 3/3 |
| Thorne | 3/3 | 5.8 s | 1 | **0/3** (pressed 11 times, refused every time) | 0/3 |

- The real `D` key does nothing while a bot drives and works again after `ai off`; the keys and the trigger are released on hand-back.
- A level-5 bot beats a level-1 bot on a hard wave (two golems, two imps, a bat): clear time plus health lost, median over three
  fighters x two seeds. Level 1 is slower and takes more damage; the dial works.
- **The ring wave is easy.** The Yard grants lightning and bomb cards, so most fighters clear it with a chain-lightning on the wet
  floor in under 5 s. It measures that the bot plays, not how well. The hard wave is the discriminating one.
- **Father Thorne's tactical is refused every time.** Ironvine grows along a surface the aim crosses; the `basic` brain aims at the
  foe, not at the ground. This is exactly what a v2 *playbook* is for (AI-FIGHTERS.md 4: "vines on the surface the opponent must
  cross"). Known gap, not a bug in the kit.
- One run in about thirty showed a 286-tick (4.8 s) empty-handed stretch for Ilyra; it did not reproduce in three repeats or in a
  traced re-run. The probe now fails the run when any fight idles longer than 2 s, so it will surface if it recurs.

Not built yet: v2 playbooks (Intent weighted per archetype, the ten rule lists, defence), v3 stocks, perception parity for Nox's
and Thorne's concealment, a world overlay (the path, the aim line and the range ring: only the panel's line exists), a bot on a *second*
fighter (the duel, phase 3), and the 1,000-fight soak.

### 9b. In the duel (2026-10-02)

The same `basic` brain drives either fighter of a duel (`arena/ai/driver`: `botDriverFor` for slot 0, `rivalDriverFor` for a rival, run under
that slot's binding, each with its own seeded Rng, so a duel is reproducible from its seed). Measured over 270-540 fights a batch (every
ordered pair, level-3 bots):

- Fights end: 270 of 270 knockouts in the first signature-loadout runs; the median is **10-11 s** at `blowScale` 0.4 (6 s at 1.0). The
  earlier stalemates (a 29% timeout rate while every fighter shared one bolt and the stage had a wall through it) are gone.
- The bots approach, shoot, kick and hop (the plinth is a 5-high step); they use Z about once and T about half a time a fight (the cooldowns
  are 9-12 s and the fight is 11): the abilities are *available*, not *decisive*, in a duel this short. The `dead-ability` flag in the
  report is what to watch.
- A rival is always seen (the duel's camera holds both): `buildWorldView` skips the sight rectangle for a fighter stand-in.
- The playbook seam exists (`arena/ai/playbooks.ts`): Father Thorne's Ironvine is aimed at the floor under the foe (it was refused every
  time: now it fires in about one fight in three). Every other entry will be there because a measurement showed a tactical failing.

The combat revision below adds projectile defense and fighter-specific ability decisions. Tactical wind-up recognition and concealment parity remain future work.

## 10. Combat revision and tuning

See [AI-TUNING.md](AI-TUNING.md) for the current personality system, named difficulties, all setting ranges and score diagnostics.
This section records the underlying combat/navigation improvements; earlier sections are historical design notes.

Arena and Duel both use the revised `basic` brain, so existing CPU selections pick it up automatically. It still controls the ordinary keys,
cursor, trigger and ability buttons. Health, damage, mana costs, movement speed and cooldowns follow the same rules as the player's.

The bot chooses an opponent with a usable firing lane, keeps the equipped weapon's range, varies its footwork and pressures wounded targets
when it has the health advantage. Low mana starts a recovery interval with a separate resume threshold. It avoids closing into its own blast
radius. Rusk switches to his equipped flame wand for close combat and back to bombs at long range, with a cooldown and separate distance
thresholds to prevent constant switching.

Incoming shots use the same reaction delay as opponents. Rival-owned spells count as threats even when their `hostile` flag is false.
The bot predicts body crossings, checks for intervening cover, and jumps or steps away with a cooldown. Nearby fire, lava, acid and unsupported
ground affect movement; a short hazard can be jumped when a safe landing exists. The planner searches the bounded landing interval, checks
every descending body column and retains the selected landing. The controller brakes over that patch and releases the jet to descend.
Cornered bots can jump across an opponent to recover space.
The Duel platforms now have navigation routes, alongside the existing Proving Yard routes.

Weapon aim reads the next compiled cast's speed modifier, uses gravity compensation and bounds motion prediction. Opponent health and grounding
come from the delayed observation too. A newly installed bot must wait for its first observation. There is no immediate startup targeting.

Ability rules live in `src/arena/ai/playbooks.ts`. Brann guards a ranged exchange, Edda shields before trading and heals after taking damage,
Ilyra overcharges while she can attack, and Kest and Selene aim their mobility toward useful spacing. Selene waits for footing before an Echo
blink; Kest can still dash in midair. Other kits check their effective range,
target health or nearby combat. An unrelated ready-time timeout no longer spends an ability. A movement ability's escape aim does not also
fire the wand backward that tick.

### Tune a running bot

In a development or authoring build, open the game console:

```text
ai behavior
ai behavior aggression 1.15
ai behavior caution 0.9
ai behavior strafeDistance 24
ai behavior dodgeLookahead 22
ai behavior reset
ai tier 3 reaction 11
ai tiers
ai status
arena status
```

`ai behavior` lists every characteristic, value, accepted range and description. Changes affect all running `basic` bots in both modes.
They last for the page session. `ai behavior reset` restores combat defaults; `ai reset` restores only the skill tiers. To ship new defaults,
edit `src/config/aiBehavior.ts` and run the checks below. The existing difficulty levels still control reaction delay, aim error, decision
interval and mistakes in `src/config/aiTiers.ts`.

| Characteristics | Effect |
| --- | --- |
| `aggression`, `caution` | Scale approach and retreat preferences. |
| `finishHealth`, `retreatHealth` | Opponent and own health fractions that change risk-taking. |
| `manaReserve`, `manaResume` | Separate thresholds for starting and ending mana recovery. |
| `strafeDistance`, `strafeTicks` | Footwork distance in cells and average time between direction choices. |
| `dodgeLookahead`, `dodgeCooldown`, `dodgeHold` | Prediction horizon, jump frequency and jump duration, in ticks. |
| `aimLead`, `maxLeadTicks` | Velocity prediction weight and maximum prediction time. |
| `targetStickiness`, `pressureRange` | Target commitment and minimum finishing distance. |
| `blockedTicks`, `hazardLookahead` | How quickly blocked shots cause movement and how far footing is checked. |
| `cornerEscapeCooldown`, `weaponSwapTicks` | Minimum time between corner escapes and weapon changes. |

Times are fixed ticks at 60 Hz. The per-fighter preferred ranges and aggression weights remain in `FIGHTER_STYLES` in `src/arena/ai/intent.ts`.
The Bots panel reports the current decision and counters, including `dodges`, `hazardHops`, `flanks` and `swaps`. The `arena status` structured
result includes both fighters' brain status so probes can inspect the same brains that the game runs.

### Verification and limits

```text
npx vitest run tests/ai-execution.test.ts tests/ai-combat.test.ts
node scripts/verify-ai-combat.mjs http://127.0.0.1:5194/
node scripts/verify-ai-basic.mjs http://127.0.0.1:5194/ --seeds 1
```

The combat probe uses fresh Duel stages, exercises all ten fighters and checks actual input-driven dodging, mana recovery, tuning and input
release. Results and a screenshot go under ignored `verify-out/ai-combat/`. The Arena probe checks wave combat and the difficulty dial.
Run probes against an unchanged dev server: hot reload during a match changes the experiment.

This is a utility-based opponent, with bounded prediction and seeded hesitation. It does not learn across matches. Fighter smoke and echoes use
the existing kit perception API. Navigation is authored for the two shipped stages, and complex
terrain destruction can invalidate a route. A full matchup balance sweep and the proposed 1,000-fight soak remain separate work.

# Opponent personalities

Arena and Duel use the existing `basic` controller for both fighter slots. The controller writes ordinary movement keys, aim, trigger,
wand selection, kick and ability presses. It does not write position, velocity, damage, mana, cooldowns or invulnerability.

This is health-based combat. There are two local fighter slots, terrain, platforms, levitation, kicks, wand attacks and fighter-specific
abilities. There is no battle-royale player count, network match authority, stock/blast-zone recovery, universal shield/dodge button,
fighter grab, cancellable combo system or arena item objective. The AI's **defend** action means a normal jump/sidestep or a kit's actual
protective ability. **Recover** means replenishing mana while maintaining space; platform traversal uses the existing jump/levitation controller.
No settings for unsupported mechanics are exposed. Creature waves in the Proving Yard exercise multi-target decisions.

## Select a style independently of difficulty

Use the existing Bots section in the Arena/Duel developer panel: select `basic`, a named skill, and a personality. The console also accepts:

```text
arena bot 1 basic normal ranger
arena bot 0 basic expert berserker
ai personality duelist
ai level easy
ai status
arena status
ai off
```

`ai` addresses slot 0; `arena bot` addresses either slot. `ai level` retains personality. Selecting a personality resets that bot's current
plan and memory. Existing numeric levels 1–5 remain accepted (2 is an intermediate legacy level).

| Profile | Characteristic choices | Default fighters |
| --- | --- | --- |
| Berserker | Closer engagements, sustained pressure, accepts plausible trades | Ilyra, Rusk |
| Duelist | Patient spacing, counters, defense, target commitment | Father Thorne |
| Ranger | Greater firing distance, safe positions, ranged attacks | Mara |
| Assassin | Mobility, fast follow-ups, wounded and isolated targets | Sable, Kest |
| Guardian | Survival, protective abilities, conservative traversal reserves | Brann, Edda |
| Trickster | More footwork, evasions and variety among useful options | Nox, Selene |

Any profile works on any fighter. Weapon safety and range constrain its preferred spacing. A Ranger with a flame wand must still approach
within flame range; the profile cannot acquire a projectile or a guard the fighter does not possess. Rusk's equipped bomb/flame pair switches
with separate approach/withdraw thresholds and a minimum swap interval.

## Tune without changing the controller

Profiles are live data in `src/config/aiPersonalities.ts`. Difficulty is in `src/config/aiTiers.ts`; global mechanics tuning is in
`src/config/aiBehavior.ts`. Changes through the console last for the page session. Save desired defaults in these files to ship them.

```text
ai profile ranger
ai profile berserker pressure 0.9
ai profile duelist targetPersistence 0.85
ai profile reset
ai tiers
ai tier normal reaction 14
ai tier normal prediction 0.7
ai reset
ai behavior
ai behavior blockedTicks 24
ai behavior reset
```

Profile values are clamped to **0–1**. They are utility weights, not independent action-probability rolls. Zero preference never makes a legal
action impossible. `ai profile <id>` lists descriptions; the shipped defaults are in the profile table in source.

| Preference | Observable effect |
| --- | --- |
| aggression | Increases approach and initiating-attack utility. |
| defense | Increases protection and retreat utility without reducing aggression itself. |
| risk | Accepts closer spacing and greater exposure for an available attack. |
| pressure | Maintains advantage after a delayed, confirmed hit. |
| patience | Favors holding useful spacing and conserving a depleted weapon. |
| opportunism | Rewards observed openings and a plausible health-based finishing hit. |
| melee / ranged | Biases kicks versus wand attacks and shifts preferred weapon spacing. |
| aerial | Values jumping as a defensive option when grounded. Ordinary attacks remain legal in the air. |
| fastAttack / heavyAttack | Biases available kicks/weapon tempo versus observed damaging casts. |
| combo | Values a legal follow-up within 35 ticks of a perceived successful hit; never bypasses cooldown or stun. |
| counterattack | Increases attack value after observing projectile pressure when no crossing threat remains. |
| dodge / block | Evasion utility/cadence versus an equipped guard/protection ability. Block has no effect on a kit without one. |
| mobility | Larger footwork excursions and greater value for repositioning/mobility abilities. |
| strongPosition | A modest inward bias when firing near a stage wall; weapon spacing and reachable footing still matter. |
| platform | Increases traversal utility when the firing lane is obstructed and a route exists. |
| recoveryCaution | Requires additional levitation reserve before optional platform traversal. |
| hazardAvoidance | Extends local terrain checks; does not permit knowingly lethal steps at zero. |
| targetPersistence | Adds a current-target bonus. |
| vulnerableTarget / dangerousTarget | Rewards low observed health versus proximity/observed projectile threat. |
| isolatedTarget | Rewards targets away from other opponents. |
| grudge | Adds a modest, decaying bias toward an observed recent attacker. |
| variety | Penalizes repetitive equivalent actions and scales bounded decision variation. |

## Difficulty and fair perception

Time is simulation ticks at **60 Hz**, distance is world cells, aim error is degrees. These are game-design starting values, not measurements
of human reaction performance. The same personality remains active at every difficulty.

| Preset | Level | Observation age | Tactical interval | Aim error | Spacing error |
| --- | --- | --- | --- | --- | --- |
| Easy | 1 | 22 ± 4 ticks (300–433 ms) | 20 ticks | 16° | ±12 cells |
| Normal | 3 | 14 ± 3 ticks (183–283 ms) | 10 ticks | 5° | ±5 cells |
| Hard | 4 | 10 ± 2 ticks (133–200 ms) | 8 ticks | 3° | ±3 cells |
| Expert | 5 | 7 ± 1 ticks (100–133 ms) | 6 ticks | 1.5° | ±1 cell |

| Skill setting | Accepted range / units | Effect |
| --- | --- | --- |
| reaction | 1–60 ticks | Age of opponent and projectile snapshots; never zero-latency. |
| reactionVariance | 0–10 ticks | Seeded variation around that age; perception time never moves backward. |
| decision | 2–60 ticks | Tactical plan cadence, with ±15% seeded staggering; movement still runs every tick. |
| aimError | 0–45 degrees | Smooth aim drift, amplified by observed target motion. |
| mistake | 0–0.5 | One hesitation chance per tactical decision. Keeps a plausible plan instead of rolling arbitrary bad actions. Also reduces follow-up utility. |
| awareness | 240–800 cells | Maximum recognition distance, within the stage's existing visibility rules. |
| prediction | 0–1 | Motion lead and prediction horizon; does not inspect future inputs. |
| spacingError | 0–24 cells | Bounded spacing offset per tactical decision. |
| adaptation | 0–1 | Strength of modest defensive adaptation to observed projectile use. |
| decisionNoise | 0–0.1 utility units | Bounded seeded variation between eligible options. |
| overcommit | 0–0.5 | Additional action commitment as a fraction of the tactical interval. |

Reaction delay is applied **before** decisions. Position, velocity, health and grounding are delayed together. A newly observed opponent or
projectile threat can trigger evaluation immediately after its delayed observation becomes available; it does not wait for another whole
tactical interval. Ongoing nonurgent changes wait for the next evaluation. Own health/resources and static collision geometry are current.
Opponent inputs, mana and cooldowns are not inspected. Removing a dead/invalid entity can invalidate a plan immediately.
Fighter concealment reduces recognition distance; Selene's echoes use her existing decoy-perception API. These appearance changes and visible
stagger are captured in the delayed snapshots. This reuses kit behavior rather than granting perfect identification of the real body.

Basic navigation stays competent at every level. Follow-up recognition shares the observation delay and hesitation model rather than adding
separate random failure rolls. Motion prediction is bounded, and action timing is not slowed by skipping physics updates.

## How decisions are made

`worldView.ts` captures observable state; `execution.ts` maintains a 64-frame snapshot ring (at most 16 foes and 12 shots per frame).
`memory.ts` keeps at most 16 opponent records, 32 pending hit events and 64 recognized shots. Grudges, projectile tendencies, confidence and
caution decay with a 300-tick half-life; absent opponents are forgotten after 600 ticks. Hit events are not consumed before their delayed
observation time. Confidence/caution have small bounded utility contributions and reset between bouts/lives.

`intent.ts` selects approach, zone, pressure, retreat, mana recovery, reposition or search, with a minimum 14-tick hold and switching bonus.
`utility.ts` ranks eligible shoot/kick/tactical/ultimate/defend/wait options. `basic.ts` checks range, cover, own resources, cooldowns, stun,
kit readiness and safe ability destinations before scoring. A legal committed action remains selected unless an urgent threat or a clearly
better score justifies changing intent. All execution still goes through normal controls and the game's move restrictions.

Features use health fractions, distance divided by weapon range (target engagement cost uses 600 cells), bounded threat and crowding values.
Benefits and costs are added; personalities are not multiplied together. Utility is a heuristic, **not a calibrated probability**. The
finishing estimate compares remaining observed health with recent damage actually delivered by wand hits to that target, adjusted by an
explainable connection estimate. It does not invent a damage-percentage or launch model. This estimate is conservative about missing evidence
but can lag a changed weapon, temporary armor or changing spell modifiers. The global `finishHealth` setting only identifies a wounded target
worth pressuring; it never forces a heavy attack or declares a knockout.

The target utility includes normalized engagement cost, wounds, observed threats, isolation, grudges, crowd risk and current-target bonus.
It has no human-player discriminator. The same scoring handles creatures and fighters, although only two fighter slots exist.

## Inspect decisions and diagnose tuning

The Bots panel displays mode, target, action, leading scores and counters. Hover the scores for their additive terms. `ai status` prints the
leading score breakdown; `arena status` returns both bots' full structured diagnostics. Counters include casts/cards (`attacks`), trigger
pulls (`shots`), kicks, ability requests, defensive choices, repeated actions, target switches, stuck recoveries, platform landings, attributed
self-KOs and ticks in each mode. `distanceTotal / combatTicks` gives mean perceived engagement distance. Self-KO attribution follows the
game's recent-attacker rules; it is a diagnostic, not proof of avoidability.

| Symptom | First tuning changes |
| --- | --- |
| Too passive | Raise aggression/pressure; lower patience slightly. Check range, blocked-lane and mana diagnostics first. |
| Too reckless | Lower risk; raise defense, recoveryCaution and hazardAvoidance. |
| Too repetitive | Raise variety; check that alternatives are actually in range and ready. Do not force an unavailable move. |
| Too defensive | Lower defense/dodge/block slightly; increase pressure. Keep hazard checks enabled. |
| Changes targets too eagerly | Raise targetPersistence; reduce grudge or vulnerableTarget if small fluctuations dominate. |

## Reproduce validation

```text
npx vitest run tests/ai-personality.test.ts tests/ai-combat.test.ts tests/ai-execution.test.ts
node scripts/verify-ai-combat.mjs http://127.0.0.1:5194/
node scripts/verify-ai-personalities.mjs http://127.0.0.1:5194/
node scripts/verify-ai-basic.mjs http://127.0.0.1:5194/ --seeds 1
```

The combat probe exercises all ten fighters plus projectile response, mana recovery, tuning, input release, platform traversal and stage-shell
integrity. The personality probe uses the existing seeded `__fight.run` harness: six profiles × four difficulties × two seeds/sides, Mara
mirror matches against a Normal Duelist, with a 1,800-tick cap. It records samples, pressure, spacing, activity, self-KOs and timings, and repeats
a seed to check determinism. Results go to ignored `verify-out/ai-combat/` and `verify-out/ai-personalities/`. Do not edit live source during a
probe: Vite hot reload changes the experiment. `FightSide.personality` lets other harness batches choose profile and skill independently.

For manual play, face each profile on the same fighter and skill, repeat on both sides, try a platform camping opponent and a depleted wand,
then use Rusk/Thorne to stress destructible terrain. Rematch, remove/re-add the rival, and hand slot 0 back to the keyboard. Compare actual
responses with the score explanations. Automated seeded encounters do not establish enjoyable difficulty balance across the entire roster.

### Recorded implementation validation

- Full suite: 241 files / 3,069 tests passed. After the final input-release cleanup and additional regressions, the five relevant AI,
  fighter-system and arena-slot files passed all 82 tests. Typecheck, production build, full repository lint and whitespace checks passed.
  The build retains its existing large-chunk warning.
- Duel combat probe: five matchups covering all ten fighters, Hard difficulty, seeds 7301/7342/7383/7424/7465, each capped at 3,600 ticks.
  All five completed with both fighters attacking and using tactical abilities; all 25 gameplay/scenario checks passed. A subsequent focused
  run passed 11 checks including the visible personality/difficulty selectors and rematch cleanup.
- Personality probe: 48 Mara mirror encounters under the conditions above, plus one exact seeded replay. All ended in a health KO within
  the 1,800-tick cap. Both sides acted, no attributed self-KOs or stuck-detector activations occurred, and the longest inactive stretch was
  60 ticks. All 52 assertions passed. These are automated simulation observations, not a human playtest or a full roster balance sweep.
- Proving Yard: Ilyra, Brann and Rusk each cleared the three-creature ring wave at Normal with bot seed 1000. The existing difficulty audit
  also ran each against five creatures (two golems, two imps, one bat), at Easy and Expert with bot seeds 4242/9001. All 13 assertions passed,
  including the Expert advantage in median clear-time/health-cost and keyboard hand-back. This legacy wave probe reuses the Yard; the Duel
  personality harness is the independent reset-and-replay experiment. There is no supported crowded free-for-all fighter match to run.

| Profile (8 encounters each) | Mean perceived spacing, cells | Share of engagement ticks in pressure mode |
| --- | --- | --- |
| Berserker | 91.3 | 50.7% |
| Duelist | 124.2 | 24.7% |
| Ranger | 142.6 | 30.8% |
| Assassin | 113.8 | 50.7% |
| Guardian | 131.2 | 12.3% |
| Trickster | 116.1 | 48.8% |

Across this small mirror sample, Easy won 0/12, Normal 5/12, Hard 12/12 and Expert 12/12 against the Normal Duelist. This demonstrates a
difficulty effect in these conditions; it does not separate Hard from Expert reliably or establish roster-wide balance. Paused harness cost
averaged 0.46 ms per simulated tick, including setup (largest per-encounter average 1.60 ms). This is neither rendered frame time nor an isolated
AI performance measurement. Artifacts contain the individual seeds, health results, counters, score terms and batch timings.

Navigation is authored for the two shipped stages with local collision/hazard checks, not arbitrary-map pathfinding. The Duel shell has an
indestructible backing so explosives can reshape the interior without opening an escape from the test stage. Recognition uses world/kit
appearance data rather than rendered pixels; full visual-perception parity and detailed tactical wind-up recognition remain limitations.

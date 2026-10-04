# The CPU's close game in a stock match

What a computer fighter does in the Duel (3 stocks, ring-outs) between the moment it sees its opponent and the moment it
presses a button. `src/arena/ai/stockTactics.ts` is the decision (pure, unit-tested in `tests/ai-stock-tactics.test.ts`);
`src/arena/ai/brains/basic.ts` builds its view each tick and turns its order into the same inputs a person presses. The
health duel (the old Arena bout), offstage recovery and platform pursuit are unchanged and documented in `AI-TUNING.md` and
`ADAPTIVE-CPU.md`.

## Why it was rebuilt (2026-10-04)

With both Duel seats on CPU the two fighters jumped past each other over and over. A traced Foundry bout (Ilyra vs Brann,
Normal) measured **37.8 crossings a minute, 33.6 of them in the air, each fighter airborne half the fight, 7 melee hits in
57 seconds**. Three causes, all fixed:

1. **The approach walked through the opponent.** The goal was "10 cells short of where the foe was", with the foe's
   position 14 ticks old (the reaction delay) and fighters passing through each other. Both ran past, turned, and ran past
   again. Every goal is now `foe - toward * spacing`, the opponent's position is led to *now* by its observed motion, and
   `toward` (which side of it the bot keeps) is sticky while the bodies overlap.
2. **Fire on the deck made the bot hop 36-72 cells.** Spell fire leaves a few Ember cells on the stage; the hazard check
   treated them as lethal and the "hazard hop" landed 36-72 cells on, past an opponent 20-50 cells away. In a stock match
   fire and embers cost a few percent: footwork walks through them (it still refuses lava, acid and the stage's lip), never
   holds a spacing spot that burns, and steps out of a fire it would otherwise stand in.
3. **Down stayed held after a heavy attack**, so every later jump was a fast fall, and a finished 1.5 s wait set off the
   stuck detector's "shake loose" jump on the first step. Up and down are now taps; idle hands count as stuck only while the
   bot has wanted to move.

After the rebuild the same seeded bout (`diag-duel-cpu.mjs`, which counts every crossing, respawns included) measures
3.3 airborne crossings a minute (was 33.6), about 6 voluntary jumps a minute per fighter (was about 45), 29 melee hits in 55
seconds (was 7), and both fighters throw all four blows. Across the roster (`duel-batch`, 270 matches: every ordered pair
three times, the four stages round-robin, Normal, one personality for both sides):

| Check | Before (main, 5527cc4) | After |
| --- | --- | --- |
| Crossings through each other on one surface | 37.8 a minute (any surface, the traced bout) | 2.9 a minute |
| Airborne outside hitstun | about 50% (the traced bout) | 24% |
| Matches reaching the 6-minute clock | 27% (the first rebuild) | 0.7% (2 of 270) |
| Median match | - | 86 s |

Two more stalls were found and fixed on the way, both by tracing the batch's timeouts (the analyser lists every one with a
replay line): a single ember between the fighters became a wall (walking in touched it, stepping out of fire pushed the bot
back), and one Ice or Ash cell from Edda's frost beside the destination made the walk check call solid deck unsafe, so both
CPUs froze for minutes (`safeDrop` now allows the body's own step-up).

## The rules

| Rule | What it means in play |
| --- | --- |
| Keep your side | The bot never sets a goal beyond its opponent. Overlapping bodies (they pass through each other) keep the side they had. |
| Hold a band | In neutral the bot stands just outside the opponent's reach (`threatReach`: its longest grounded blow plus half a body), closer for a bold profile (aggression and risk), and drifts in and out of it (footsies: a cautious profile drifts in less). |
| Enter with a reason | A committed approach (rolled on decision beats; aggression, pressure and the opponent's percent raise it), a whiff to punish, a shield to grab, a hit to follow up. |
| Answer what you can see | A swing on the opponent's body is perceived `reaction` ticks late, aged to now, and answered once per swing: step out of reach if a step suffices, else shield, else spot-dodge. A four-tick jab is never answered (it is over before the bot sees it); a 23-tick finisher is, at every level above Easy. |
| Punish recoveries | A swing seen in its recovery is punished when the bot can walk into range and land a blow before it ends (the best blow that fits the window). |
| Guard the edge | An opponent offstage or on the ledge: stand at the lip (back from a ledge hang), strike what comes into reach, never follow it out. |
| Jump with a reason | A short-hop aerial approach, a juggle under a launched opponent, a jump out of a corner, platform pursuit, offstage recovery, a projectile dodge. Never a hop over the opponent. |
| Do not stand in fire | Walk through a few embers to clean ground beyond them; never choose a burning spacing spot; step out of fire you would stand in. |

Blows are chosen at the moment they would land: each candidate's hitbox (`stockAttackOverlaps`) must cover where the
opponent will be when the blow comes out (its startup, led by the opponent's motion and the bot's `prediction`) and where it
is now. Value: openers build damage early, finishers and launchers grow with the opponent's percent (the KO range), a
launcher prefers a body above, a shield punishes slow blows (grab it instead), and the match-local learning
(`AdaptiveMemory`) adds what has landed in this context.

The order also carries a **throw** (toward the nearer blast line; up at high percent) and a **survival influence** (when a
swing could not be answered at over 60%, the bot leans the coming launch toward the middle).

## Modes (what the Bots panel and `arena status` show as intent)

`neutral` (hold the band), `approach` (committed: opener, grab or hop), `punish`, `defend` (shield, step-out or dodge),
`pressure` (after the bot's own hit: juggle or step in), `edgeguard`, `escape` (out of a corner). Platform pursuit keeps
`reposition`, offstage recovery `recover`.

## Skill and personality

The difficulty level keeps its delay, cadence, aim and hesitation (`config/aiTiers.ts`); the close game adds a per-level
table, `STOCK_SKILL` in `stockTactics.ts`:

| Level | Answers a seen swing | Punishes a seen recovery | Approach rate | Slack at a blow's far edge |
| --- | --- | --- | --- | --- |
| 1 Gentle | 20% | 25% | 0.55x | 7 cells |
| 2 Easy | 35% | 40% | 0.70x | 5 cells |
| 3 Normal | 55% | 60% | 0.85x | 3 cells |
| 4 Hard | 72% | 80% | 0.95x | 2 cells |
| 5 Expert | 88% | 95% | 1.00x | 1 cell |

Rates are scaled by personality (block and defense for answers, counterattack and opportunism for punishes, risk lowers
both). The reaction delay is still the real limit: the bot only answers what was visible long enough ago.

Personality moves spacing and choices, never legality: aggression/risk (closer band, more approaches), pressure (longer
follow-ups), patience (fewer approaches, more giving ground), block vs dodge (shield or spot-dodge), counterattack
(counter-pokes an approaching opponent), aerial (hop approaches), mobility (wider footsies, corner escapes), heavyAttack /
fastAttack / combo (blow choice), variety (bounded noise between equal blows).

## Measuring it

```bash
node scripts/diag-duel-cpu.mjs <url> --a ilyra-voss --b brann-rook --level 3      # one bout, per-tick trace, crossings/air/jumps
node scripts/shot-duel-cpu.mjs <url> --p1 ilyra-voss --p2 brann-rook --frames 24   # rendered real time, one contact sheet
node scripts/duel-batch.mjs <url> --pairs all --seeds 2 --stage all --pages 3     # the whole roster (STOCK-TELEMETRY.md)
node scripts/duel-analyse.mjs verify-out/duels/<run>                               # report.md: balance AND behaviour checks
```

The analyser flags behaviour that is not a fight: more than 6 crossings a minute on one surface, more than 35% of the fight
airborne outside hitstun, more than 10% of matches reaching the clock.

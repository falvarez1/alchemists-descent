# Duel telemetry and balance (stock matches)

How to make the computer fight itself in the Duel (3 stocks, ring-outs, the shipped rules), record what happened, read the
roster's balance from it, and turn the numbers that change it. The health-duel tools (`fight-batch`, `fight-analyse`,
`fight-tune`, `TELEMETRY-AND-BALANCE.md`) measure the old Arena bout; these measure the mode players play. The CPU's close
game itself is `AI-STOCK-TACTICS.md`.

## The loop

```bash
# 1. a frozen server (editing src hot-reloads the pages mid-match): see WORKFLOW.md / the probe-runs-vs-HMR note
git worktree add --detach ../alchemists-descent-worktrees/duel-frozen HEAD && cd ../alchemists-descent-worktrees/duel-frozen
npm ci && npx vite --port 5240 --strictPort --force

# 2. measure: every ordered pair, both sides, two seeds, the four stages round-robin (180 matches, ~3 min on 3 pages)
node scripts/duel-batch.mjs http://localhost:5240/ --pairs all --seeds 2 --stage all --pages 3 --personality duelist
node scripts/duel-analyse.mjs verify-out/duels/<run>          # report.md + report.json

# 3. try a change without editing the source, and compare against the baseline
node scripts/duel-batch.mjs http://localhost:5240/ --pairs all --seeds 2 --stage all --pages 3 --personality duelist \
     --set stockBalance.rusk-emberjaw.dealt=0.85 --set stock.edda-morrow.finisher.startup=18 --out verify-out/duels/try
node scripts/duel-analyse.mjs verify-out/duels/try --compare verify-out/duels/<run>

# 4. or let the tuner search the balance levers round by round (resumable), then write its best round into config/stockBalance.ts
node scripts/duel-tune.mjs http://localhost:5240/ --rounds 5 --seeds 3 --stage all --pages 3 [--resume verify-out/duels/<tune>] [--apply]

# 5. confirm on seeds the tuner never saw before committing a balance change
node scripts/duel-batch.mjs http://localhost:5240/ --pairs all --seeds 3 --stage all --pages 3 --personality duelist --seed-base 20000
```

`--personality duelist` gives both sides one playstyle, so the numbers compare kits; the default (`fighter`) plays each
fighter with its own profile, as the Duel lobby does. Pairs always run both ways round (the cell sim is not mirror-symmetric,
and the left spawn is a side). Every match is deterministic for its seed.

## What is recorded

`window.__duel.run(spec)` (dev builds; `src/fighters/telemetry/stockHarness.ts`) stages one match through the same code the
lobby uses, steps it headless to the last stock (or the clock), and returns one JSON record. `duel-batch` writes one line per
match to `duels.ndjson`.

| Field | What it holds |
| --- | --- |
| `winner`, `reason`, `ticks` | the slot that won, `stocks` / `timeout` / `draw` / `cap`, fighting ticks (60 a second) |
| `kos[]` | every stock lost: when, who was credited (the victim's own slot is a self-destruct), which blast line, the percent, the last blow |
| `sides[].dealt` / `taken` | percent dealt by group (melee, throw, spell, ability, world) and taken |
| `sides[].hits` / `starts` | landed hits by attack tag; blows started by kind (the hit rate is hits / starts) |
| `sides[].shields`, `dodges`, `grabs`, `specials`, `ultimates`, `shieldBreaks` | defensive and resource use |
| `sides[].airTicks`, `stunTicks` | time airborne outside hitstun, and in hitstun |
| `sides[].tactics` | what the CPU's close game did: modes entered, approaches, punishes, shields, step-outs, edge-guards, strikes by kind |
| `behaviour` | crossings through each other on one surface per minute, airborne share, mean spacing, close and footsie-range shares |
| `trace` / `notes` | with `traceEvery: N` (and `traceStatus: true`): positions and each brain's mode every N ticks |

The spec: `{ a: { id, level?, personality? }, b: {...}, seed, stage?, overrides?, swapSpawns?, maxTicks?, traceEvery?, traceStatus?, render? }`.

## The levers

`__duel.knobs(prefix)` lists every number with its range; `--set path=value` overrides one for a whole batch.

| Path | What it turns |
| --- | --- |
| `stockBalance.<id>.dealt` | every percent this fighter deals in a stock match (`config/stockBalance.ts`). The main balance lever. |
| `stockBalance.<id>.launch` | how far this fighter flies when hit (KO resistance), without changing how its body moves |
| `stock.<id>.<kind>.<field>` | one blow's numbers (`config/stockAttacks.ts`): `startup`, `active`, `recovery`, `damage`, `reach`, `top`, `bottom`, `knockX`, `knockY`, `growth`, `stun`. Every fighter has its own copy (seven still start from the shared prototype). |
| `body.<id>.<attr>` | the body (`content/fighterBodies.ts`): `mass` (also KO resistance), `run`, `jump`, `gravity`, `jetFuel`... Its `dealt` is the health duel's lever and is NOT used in a stock match. |
| `kit.<id>.<group>.<name>` | a kit's numbers (cooldowns, damage, durations) |

## The tuner

Each fighter gets one strength `s`: `dealt = shipped x s` and `launch = shipped / s` (with `--knobs dealt,launch`, the
default). Win rate is steep and monotone in `s`: a fixed 20% move took Mara from 20% to 83% in one round, and fixed small
steps on noisy rates made Nox swing 36% -> 78% -> 33%. So the tuner keeps every (s, win rate) point per fighter and takes a
secant step toward 50%, staying strictly between two points that straddle it; with fewer than two points it takes a bounded
proportional step. Fighters inside `--tolerance` (default 10 points: three seeds of the 90 pairs is about +-10 points of noise
per fighter) are left alone. `balance-patch.json` holds every round and the BEST round (smallest spread), which `--apply`
writes. A fighter pinned at a range limit while still out of line needs a moveset or kit change, not a multiplier.

## Reading the report

`report.md` opens with **flags**: fighters outside the balance band (40-60% by default, `--band`) whose 95% interval
excludes 50%, fighters that lose more than a quarter of their stocks to themselves (recovery or edge play), matches reaching
the clock (stalling), and the behaviour checks (crossings, airtime, side bias). Then the fighter table (win rate with Wilson
interval, stock differential, KOs, self-KOs, percent dealt/taken, the percent they die at, specials, shields, grabs), the
matchup matrix, the blows table (how often each blow is thrown and lands, what share of damage is melee, which blows take
stocks), and how the CPUs fought (tactics per minute).

A fighter with a high win rate AND a low "dies at" percent is winning by damage output; a high "dies at" means it survives
long (mass, launch, recovery). Self-KOs above a few percent point at recovery, not balance. Two seeds over the 90 pairs give
each fighter 36 matches: an interval of roughly plus or minus 15 points. Use more seeds before believing a 5-point change.

## Measured (2026-10-04)

All at CPU level 3 (Normal), every ordered pair, the four stages round-robin. Behaviour (crossings, airtime, stalls) is in
`AI-STOCK-TACTICS.md`; balance below. RMS is the root-mean-square distance of the ten win rates from 50%.

| Run | Matches | Personality | Win rates (low - high) | Spread | RMS |
| --- | --- | --- | --- | --- | --- |
| Shipped levers: the health duel's `body.dealt` applied in stock matches | 180 | each fighter's own | Edda 6% - Rusk 100% | 94 pts | - |
| Duel levers decoupled, all 1.0 | 270 | duelist (both) | Mara 19% - Rusk 94% | 76 pts | 20.6 |
| After seven tuner rounds, confirmed on fresh seeds (base 20000) | 360 | duelist (both) | Sable 36% - Nox 61% | 25 pts | 8.0 |
| Shipped pass 1 (Sable +3%), confirmed on fresh seeds (base 30000) | 360 | duelist (both) | Ilyra/Sable/Thorne 44% - Mara 64% | 19 pts | 6.1 |

Shipped pass 1 (`config/stockBalance.ts`): Rusk 0.731 / 1.367 (dealt / launch), Mara 1.225 / 0.816, Sable 1.12 / 0.893, Edda
1.088 / 0.919, Selene 1.06 / 0.943, Nox 1.04 / 0.962, Kest 0.975 / 1.026, Ilyra 0.968 / 1.033, Brann 0.94 / 1.064, Thorne 0.996 / 1.004.

What the runs taught:

- **The health duel's `dealt` crippled the Duel.** Edda 0.375, Brann 0.467 and Thorne 0.522 were cuts for strong health-duel
  loadouts; in a stock match they scaled every blow, so those three lost almost everything and Rusk (1.475) won everything.
- **With equal levers, weight decided matches.** Heavy Rusk and Brann died around 130%, light floaty Mara around 64%. Rusk's
  finisher took 138 of the stocks he won in one round: he now hits a quarter softer and flies a third further.
- **Win rate is steep in these multipliers**: about 3 points per 1% of strength (Mara 20% -> 83% for +20%, Rusk 87% -> 39% for
  -16%), and Brann steeper still around 0.93 (a KO threshold). Hence the secant tuner and the noise band.
- **Seeds alone move a fighter about 10 points** at 72 matches each (Mara 46% and 64% on two fresh seed sets with identical
  values). Pass 1 sits at that noise floor; tightening it further needs more seeds per round, not more rounds.
- A personality is a playstyle, not a kit: these numbers are one profile on both sides. The Duel lobby plays each fighter with
  its own profile; re-run with `--personality fighter` to see that mix.

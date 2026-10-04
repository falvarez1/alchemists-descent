# The arena programme

Ten fighters, each with its own body, techniques, spells and effects, fighting on destructible stages with real physics,
controlled by people or by computer AI, every fight recorded and analysed so the roster can be balanced from data: a
Smash-style mode for this falling-sand world. Start with `MASTER-PLAN.md`.

## Where it stands (2026-10-01)

| Phase | State |
|---|---|
| P1a bodies (weight, speed, traction, jump, gravity, fall, jet, health, power) | **built and measured** (`verify-fighter-bodies`, 73 checks) |
| P1b ten movement techniques | **built and measured** (`verify-fighter-moves`, 19 checks) |
| P2 telemetry (recorder, harness, batch, analyser, parameter registry, tuner) | **built**; first baselines and a tuning run done |
| P3 two fighters in one world (the Duel Stage, a rival, every damage path exactly once) | **built** (`verify-arena-duel`, 15 checks) |
| P4 computer fighter (v0 dummy, v1 basic brain, five skill levels) | **built**; playbooks (v2) next |
| P6a signature loadouts | **built**, chosen with the loadout lab |
| P5 match rules (stocks, volatility, ring-outs, the collapse), P6b melee primaries, P7 balance passes | planned |

**See it:** `npm run dev`, the title's Arena door, the panel's *Other stage* button (the Duel Stage), *Add rival*, a brain for each fighter.
**Measure it:** `node scripts/fight-batch.mjs <url> --pairs all --seeds 3` then `node scripts/fight-analyse.mjs <dir>`; `fight-tune.mjs` turns the
stat knobs toward 50%; `loadout-lab.mjs` and `fight-dps.mjs` choose a primary attack.

| Read this | When |
|---|---|
| [`GUIDE.md`](GUIDE.md) | to use what exists: see it, play it, measure it, tune it, extend it |
| [`MASTER-PLAN.md`](MASTER-PLAN.md) | vision, phases, exit criteria, risks, how the work is organised |
| [`TASKS.md`](TASKS.md) | what to do next (ids, status) |
| [`DECISIONS.md`](DECISIONS.md) | why things are the way they are |
| [`FIGHTER-PHYSICS.md`](FIGHTER-PHYSICS.md) | building a fighter's *body* (phase 1) |
| [`ROSTER-IDENTITY.md`](ROSTER-IDENTITY.md) | what makes each fighter different; the fingerprints and the distinctness checklist |
| [`MOVESETS-V2.md`](MOVESETS-V2.md) | signature loadouts, weapons, techniques, direction variants |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | two fighters in one world (slots + proxy enemies) |
| [`AI-FIGHTERS.md`](AI-FIGHTERS.md) | the computer fighter |
| [`AI-STOCK-TACTICS.md`](AI-STOCK-TACTICS.md) | the CPU's close game in a stock match (the Duel): spacing, answers, punishes, edge-guards; why two CPUs used to leapfrog |
| [`STOCK-TELEMETRY.md`](STOCK-TELEMETRY.md) | CPU vs CPU stock matches recorded and analysed: `duel-batch`, `duel-analyse`, `duel-tune`, the Duel's balance levers |
| [`ARENA-RULES.md`](ARENA-RULES.md) | health duel, stock match, volatility, ring-outs, the collapse, stages |
| [`TELEMETRY-AND-BALANCE.md`](TELEMETRY-AND-BALANCE.md) | recording fights, batch runs, analysis, the tuner, the review overlay |
| [`TEST-PLAN.md`](TEST-PLAN.md) | what proves each phase; probe hygiene |
| [`WORKFLOW.md`](WORKFLOW.md) | worktrees, ports, the loop, the hard rules, the brief template |
| [`briefs/`](briefs/) | one self-contained brief per work package |

Related, outside this folder: `docs/FIGHTERS.md` (the ten fighters' kits and the Proving Yard), `docs/fighters/<id>.md` (per
fighter numbers and measurements), `docs/BATTLE-ROYALE-AND-SPACETIMEDB.md` (the earlier battle-royale analysis; the stage plan
there is the ancestor of this one), `docs/TITLE-MENU.md` (the Arena door), `docs/PERF-2026-09.md` (budgets).

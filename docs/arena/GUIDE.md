# The arena in practice: see it, play it, measure it, tune it, extend it

A short working guide to what exists today (2026-10-02). The plan is `MASTER-PLAN.md`; the reasons are `DECISIONS.md`; this page is the
commands.

## 1. See it

`npm run dev`, then the title:

| Door | What you get |
|---|---|
| **Arena** | the Proving Yard: one fighter, every move has somewhere to land (a panel steps through the ten, ticks off each ability, spawns foes, has the Body card and the movement readout) |
| **Duel** | the Duel Stage: two fighters in one room. Pick your fighter, then in the panel's **The duel** section: *Add rival* (the rival comes with a computer brain), *Watch* (a brain on **both**: a spectator), *Rematch*, *Remove*. *Your mind* and *The rival's mind* choose You / Still / dummy / basic and a skill 1-5 |

In the Yard, the *Own wands* button swaps to the fighter's signature wands and flasks (a duel hands them over by itself).
The console (backtick): `arena add brann-rook`, `arena bot 0 basic 4`, `arena bot 1 basic 4`, `arena status`, `arena reset`, `ai basic 3`, `ai tiers`;
`ftune set arena.blowScale 0.6` / `ftune set body.brann-rook.dealt 1.05` turn any number live while you watch (`ftune list body.brann`, `ftune diff`, `ftune reset`).

What makes the ten different, and where to see each:

| Layer | Where | Look at |
|---|---|---|
| Body: weight, speed, traction, jump, gravity, fall, jet, health, power | `content/fighterBodies.ts` | the panel's Body card (bars against the Alchemist), the movement readout, the ruler and the run lane in the Yard |
| Movement technique: one each | `fighters/techniques.ts`, copy in `content/fighterTechniques.ts` | the technique row in the Body card (how, why, a Go button, a use count) |
| Primary attack: their own wands | `content/fighterLoadouts.ts` | `Own wands`; a duel |
| Passive, Z, T | `fighters/kits/<id>.ts` | the three ability rows |

## 2. Play it

Slot 0 is you (WASD, mouse, Z, T, F kick); slot 1 is the rival. A knockout ends the bout (the result line names the winner); *Rematch*
starts another. The Duel Stage is one 560-cell room that fits the view: a floor, a low plinth in the middle, two platforms a jump
apart, a high perch. A fighter's blow reaches the other at 40% of its listed damage (`config/arenaRules.ts` `blowScale`, the duel's tempo),
a blast is capped at 42, and who resolves first each tick is a coin.

## 3. Measure it

Headless (nothing is rendered, about 3,700 ticks a second: a 270-fight matrix in one to five minutes). **Use a frozen worktree server
for anything long** (see `WORKFLOW.md`): editing `src` reloads the page under a running batch.

```bash
node scripts/fight-batch.mjs http://localhost:5190/ --pairs all --seeds 3            # every ordered pair, both sides
node scripts/fight-analyse.mjs verify-out/fights/<run>                               # report.md, report.json, report.html
node scripts/fight-batch.mjs <url> --pairs "ilyra-voss,brann-rook" --seeds 20        # one pair
node scripts/fight-batch.mjs <url> --pairs all --set body.brann-rook.dealt=0.9        # an override, any dotted path
node scripts/fight-dps.mjs <url>                                                    # how fast does each primary kill a standing target
node scripts/loadout-lab.mjs <url> --candidates file.json --target kest-rel --vs basic   # try card lists
```

`report.html` is the page to read: the strength table with 95% intervals, the matchup grid, where each fighter's damage comes from,
how each moves, the flags, and **a timeline of any fight** (both health curves, every blow and ability, how far apart they stood).
Read a pair over both sides (the batch runs both): the cell sim is not mirror-symmetric, so one side can lean.

In the page, `window.__fight` (dev only): `__fight.run({ a: {id, brain, level}, b: {...}, seed, overrides, loadouts })` runs and records one
duel and returns the JSONL; `__fight.knobs('body.brann')` lists every number it can turn (kit numbers, bodies, `arena.blowScale`) with its
range; `__fight.params.set(path, value)` turns one.

## 4. Tune it

```bash
node scripts/fight-tune.mjs http://localhost:5210/ --rounds 10 --seeds 6 --out verify-out/fights/tune     # stat knobs toward 50%
```

Each round is a full matrix; a fighter out of line has its `dealt` and `maxHp` nudged (at most 10% a round, only inside `BODY_RANGES`),
and the result is `balance-patch.json`: the overrides, the win rates of every round, and **which fighters are pinned at a limit** (a stat
cannot fix those: change a loadout or a kit number, with `loadout-lab` and `__fight.knobs`). Nothing edits the source: read the patch, then
write the numbers into `content/fighterBodies.ts` and commit them with the evidence.

## 5. Extend it

| To add | Do |
|---|---|
| a body number | `core/fighterBody.ts` (field, range, compose), read it once in `entities/Player.ts`, give each fighter a value, a probe in `verify-fighter-bodies` |
| a movement technique | a class in `fighters/techniques.ts` (reads `ctx.input.keys`, bends the body through `setMod` or `startMove`), its copy in `content/fighterTechniques.ts`, a check in `verify-fighter-moves` |
| a signature loadout | `content/fighterLoadouts.ts` (frame + cards fitting its slots), measure with `loadout-lab` and `fight-dps`, `tests/fighter-loadouts.test.ts` keeps the rules |
| a bot behaviour | `arena/ai/playbooks.ts` for a one-off, `arena/ai/brains/` for a new brain (a class and a line in the registry) |
| a stage | `world/duelStage.ts` is the pattern: a symmetric room, a spawn pair, registered in `config/worldgraph` and `game/Levels` |
| a rule | `config/arenaRules.ts` (live data, ranged, turned by the registry as `arena.<key>`) |
| a damage path | it must land exactly once on the right fighter: add it to `verify-arena-duel` |

## 6. What is not here yet

Match rules (stocks, volatility, ring-outs, the collapse), signature melee primaries, bot playbooks beyond Thorne's, the in-game fight
review, a third fighter, the hosted build (the arena is authoring-only: the player build drops it). See `MASTER-PLAN.md` phases 5-7.

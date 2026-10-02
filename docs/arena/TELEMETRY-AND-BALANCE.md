# Telemetry, batch fights and balance tuning

**Status: designed, not built.** Part of the arena programme (`docs/arena/MASTER-PLAN.md`, phase 2 and phase 7). Everything
below was checked against the code on 2026-10-01 (file:line references are to that tree); claims about speed are marked
*inferred* where nobody has measured them yet.

The goal: every fight, human or bot, leaves a record that can be reviewed afterwards and analysed in bulk, so that the
numbers that define a fighter (cooldowns, damage, durations, charge rates, body physics) can be tuned until the roster
is balanced *and* distinct. Telemetry is not a debugging afterthought; it is how this game gets balanced, because nobody
can play 18,000 fights by hand.

## 1. What we want to learn

| Question | Metric | Needs |
|---|---|---|
| Is a fighter too strong or too weak? | win rate vs the roster (Bradley-Terry rating, Wilson interval) | PvP fights (phase 3) |
| Which matchups are lopsided? | the 10x10 matchup matrix | PvP, many seeds |
| How fast do fights end? | time-to-kill, time-to-first-blood, fight length distribution | any fight |
| Where does the damage come from? | damage dealt by source (spell, kick, tactical, ultimate, hazard, world) | the hit event with a source tag |
| Do the abilities get used, and do they work? | uses, refusals, uptime (active/ready/cooling share), damage and effect per use, ultimate charge pace | ability events + the view counters |
| Does the fighter feel different? | distance travelled, airtime share, speed distribution, time-in-range bands, jump/dash counts | per-tick samples |
| Is there a stall or a snowball? | no-damage windows, lead changes, damage-rate autocorrelation | samples + events |
| Which number should I turn? | sensitivity of the metrics above to one parameter (A/B with Welch's t) | the parameter override API |

Balance targets (first draft, to be revised in the first balance pass): every fighter between 42% and 58% overall win rate
against the roster; no matchup outside 30-70%; median fight 25-60 s; the ultimate used once or twice per fight; no fighter
whose three abilities together account for less than 30% or more than 80% of its damage (identity without a one-trick).

## 2. What exists today (verified)

- **Events:** `core/events.ts` has `enemyKilled`, `cardCast`, `flaskUsed`, `playerDied`, `structureStrike` (every explosion)
  and a few others. There is **no** enemy-hurt, player-hurt, projectile or ability-use event.
- **Fighter hooks:** `FighterSystem.noteEnemyHurt(e, amount, source, killed)` (`FighterSystem.ts:339`, called from
  `Enemies.ts:645` with the final amount) and `noteHurt` (`:348`, polls the hp delta). `view.tactical/ultimate.usedAt`,
  `refusedAt`, `readyAt`, `cooldown`, `active`, `charge` are refreshed every tick (`:796-812`): polling them gives ability
  uptime for free.
- **Not observable:** who dealt a hit (`Player.damage(amount,kx,ky,src)` carries only a source string, `Player.ts:641`),
  which ability caused a damage tick (kit damage is `'direct'` plus an `inKit` boolean), knockback as a record, armor
  absorbed (`FighterSystem.reduceIncoming`, `:417-421`), hazard hp loss that bypasses `damage()` (`Player.ts:1397,1685`).
- **Storage:** `core/telemetry.ts` is localStorage counters only. There is no dev-server write path (`vite.config.ts` has
  only the AuthorLink WebSocket plugin, `scripts/vite-plugin-authorlink.mjs`); probes persist by pulling data with
  `page.evaluate` and writing from Node (`scripts/perf-harness.mjs:129 writeJson`).
- **Determinism:** the cell sim replays exactly from a seed (`scripts/verify-sim-determinism.mjs`). Whole-tick replay is
  **not** proven: the entity stream diverges intermittently from about tick 14 (imp and bat flyers named), Rapier is not the
  enhanced-determinism build (SIMD vs scalar chosen at runtime, `rapierInit.ts:36-44`), and a few gameplay paths read the
  wall clock (`MutatorDirector.ts:318`, `RunDirector.ts:439`, Levels findability timers; the Proving Yard is exempt,
  `Levels.ts:150`). **Treat batches as statistical; measure the replay-match rate before trusting any replay.**
- **Tuning knobs:** `FIGHTER_TUNING` (`fighters/tuning.ts`) and each kit's exported `TUNING` are plain mutable objects, but
  `def.tacticalCooldown` / `def.ultimateDuration` are numbers captured at module load, and a few module-level derived
  constants (`WAVE_SHOWN`, `mara-quell-draw.ts:207`) are too. Overrides must be applied **before** `equip` and must also
  write the `def` fields.
- **Speed:** cell sim 0.3-1.3 ms/tick, whole tick about 1.1-3 ms (`docs/PERF-2026-09.md`, `docs/fighters/nox-calder.md`);
  `window.__game.tick(false, {forcePaused: true})` (`Game.ts:786-795`) steps a tick **without rendering** (compose,
  lighting and GL live only in `renderFrame`, `:926-943`). *Inferred* 300-900 ticks/s, 5-15x real time: **measure first**
  (task T2.1).

## 3. Design

### 3.1 The recorder (`src/fighters/telemetry/fightLog.ts`)

A `FightRecorder` installed lazily under `__AUTHORING__` (never in a player build). One post-tick call at the end of the
fixed tick samples; four instrumentation sites emit events. `EventBus.emit` returns immediately with no listeners
(`events.ts:259-260`), so the cost with the recorder off is negligible.

**Record format** (schema `v: 1`, JSONL, one fight per file):

```jsonc
{"k":"h","v":1,"runId":"2026-10-01T18-00_ab12cd3_gauntlet","fight":123,"seed":777123,"yard":"fighter-test",
 "fighters":[{"slot":0,"id":"rusk-emberjaw","brain":"brawler:2","hp":100},{"slot":1,"id":"mara-quell","brain":"kiter:2","hp":100}],
 "overrides":{"kit.rusk-emberjaw.ram.damage":18},"git":"ab12cd3","dirty":false,"regime":"paused-step","tickHz":60}
{"k":"s","t":0,"f":[[x,y,vx,vy,hp,armor,charge,tCd,uCd,flags],[...]],"foes":[[kind,x,y,hp]...]}      // 10 Hz samples
{"k":"e","t":412,"e":"hit","src":0,"dst":1,"amount":14,"raw":14,"source":"ability.tactical","kx":3.1,"ky":-1.2,"hpAfter":86,"killed":false}
{"k":"e","t":420,"e":"ability","who":0,"slot":"tactical","res":"fired"|"refused"|"again","x":..,"y":..}
{"k":"e","t":900,"e":"end","winner":0,"reason":"ko"|"ringout"|"timeout"|"stalemate","hp":[..]}
```

Sample cadence: every 6th tick (10 Hz) by default, 60 Hz as an opt-in debug mode. One fight is about 110 KB at 10 Hz
(*inferred*), gzip roughly 10x better. `flags` packs grounded / climbing / sliding / stunned / invuln / concealed.

### 3.2 Instrumentation sites (3-4, all guarded)

1. After `Enemies.ts:645`: emit a **hit** with `{target, amount, source, killed, kx, ky}`, plus a `kit` flag from `inKit`.
2. After `Player.ts:666`: emit a **hurt** with `{raw, taken, src, kx, ky, hpAfter}` (raw vs taken gives armor absorbed).
3. In `tryTactical`, `tryUltimate`, `refuse`, `tacticalAgain`: emit **ability** (fired / refused / again) with position.
4. An optional `tag` argument on `FighterSystem.hurt(...)` so kit damage attributes to its ability (`ability.tactical`,
   `ability.ultimate`, `passive`, `spell`, `kick`, `hazard`, `world`).

PvP (phase 3) adds the attacker's slot to every hit and a `ko` / `ringout` event; the schema already has `src` and `dst`.

### 3.3 Where fights run

| Regime | How | Use |
|---|---|---|
| **Live** | the real-time loop in the dev server, a human or two bots, rendering on | watching, feel, review; the recorder streams to the dev endpoint |
| **Paused-step batch** | one Playwright page per worker, `__game.tick(false,{forcePaused:true})` in a loop inside one `page.evaluate`, no rendering | bulk fights, tuning sweeps |
| **Node `HeadlessGame`** | a headless composition root (no Renderer, Hud, audio) hosting `sim`, `entities`, `combat`, `fighters` in Node, worker threads for parallelism | optional, last; the cell sim and Rapier already run in Node (`scripts/bench-sim.mjs`, `tests/tea-machine.test.ts`) but there is no headless `Game` |

**Caveats of the paused-step regime** (these make its numbers differ from live play, so a validation sample of live fights
is part of every balance pass): critters, Mechanisms, LightDevices, Hints, BuildDirector and others early-out on
`state.paused` (`Critters.ts:210`, `Mechanisms.ts:110`); hitstop does not freeze ticks under `forcePaused` (`Game.ts:828`);
`LightQuery` reads the last render-built light field, so it is stale when compose is skipped (the Yard is bright, ambient
0.92, so the risk is low; Nox's darkness abilities need a render-on validation); the rAF loop still runs `renderFrame`
and `Clips.afterRender` unless a headless flag idles it (task T2.2).

**Per-fight reset recipe** (`verify-sim-determinism.mjs:120-155`): set `state.worldSeed`, `state.frameCount = 0`,
`world.movedTick = 1`, `simulation.accumulator = 0`, `camera.snapTo`, clear enemies, projectiles, rigid bodies,
particles and critters, zero `fx.hitstop`; then `resetFighterArena(ctx)` (it already rebuilds the hall and the potions),
equip, `await fighters.whenReady()`. Bot decisions use their own `new Rng(hashSeed(seed,'bot'))`, never `entityRandom`.
Anything that draws from the entity stream outside a tick shifts it (`fxOf` takes `entityRandom()` at
`FighterSystem.ts:474`).

### 3.3b Parallelism

One browser context per worker; use system Edge or full Chromium (the headless shell starves a second page's frames,
`browser-launch.mjs:66-72`). Each page carries a game, Rapier and a 1600x1064 grid (about 17 MB, *inferred*). Reuse a page
across fights and recycle it every N fights (global singletons: `FIGHTER_TUNING`, kit TUNING, `PLAYER_PARAMS`, `simRandom`,
`savedAmbient` in `fighterArena.ts`). Run batches against a **frozen worktree or `vite preview`** server: editing `src`
reloads a running page (`docs/PERF-2026-09.md`, `perf-fx-suite --ab`).

### 3.4 Storage

- **Batch:** accumulate in columnar in-memory arrays inside the page, pull once per fight with `page.evaluate`, and let Node
  write the files. No per-tick round trips; optionally `page.exposeFunction` streams events for crash resilience.
- **Human watching:** a dev-only Vite plugin (`scripts/vite-plugin-fight-telemetry.mjs`, `apply:'serve'`, registered next to
  `authorLinkPlugin()` at `vite.config.ts:84`) accepts `POST /__fights/:runId/:name` and appends JSONL, with a path
  whitelist; a console `fightlog start|stop` toggles it. Its output directory goes in `server.watch.ignored` (writes must
  not reload a running playtest). A download button is the fallback outside dev.
- **Layout** (`verify-out/` is already gitignored and Vite-watch-ignored):

```
verify-out/fights/<runId>/            runId = ISO-ts_gitsha_label
  run.json            git commit/dirty, schema, overrides, scenario matrix, seeds, rapier build, browser
  fights/fight-000123.jsonl(.gz)
  summary.json  matrix.csv            analyser output
docs/fighters/balance/baseline-<date>.json     curated summaries only, committed
```

### 3.5 Tuning parameters (`src/fighters/paramOverride.ts`, dev only)

```ts
interface ParamSpec { path: string; default: number | boolean; min: number; max: number; step?: number; integer?: boolean }
interface ParamOverrideApi {
  list(prefix?: string): ParamSpec[];
  get(path: string): number | boolean | undefined;
  set(path: string, v: number | boolean): boolean;               // false when out of range
  apply(o: Record<string, number | boolean>): () => void;        // returns a restore function
  reset(): void;                                                  // back to captured defaults
  snapshot(): Record<string, number | boolean>;                   // sparse diff, written into every fight header
}
```

Paths: `fighter.chargeDealt`, `kit.<id>.<group>.<name>`, `body.<id>.<attribute>` (phase 1), `player.<param>`. The registry walks
`FIGHTER_TUNING` plus each kit's `TUNING` (`import.meta.glob` over `kits/*-{logic,math,grow}.ts` and `kest-rel.ts`) and
captures defaults with `structuredClone` before the first override. It also patches the captured `def.tacticalCooldown` /
`def.ultimateDuration`. Plug-ins: `window.__paramOverride` in the `main.ts` dev block and a console `ftune` command.
Mid-fight changes are unsupported. Fighter paths need **their own declared range table** (modelled on
`tests/tuning-ranges.test.ts`, which asserts the default lies inside its range): the existing `paramSliderSpec` is keyed by
leaf name and a `cooldown` is capped at 180, which cannot bound a 540-tick kit cooldown. `net/tuningPatch.ts` has the
dotted-path get/set but resolves only 2-3 segments (kit paths have 4), and a parallel `resolveParamPath` in
`console/commands.ts:936-995` drifts independently; generalise one resolver and use it for both. Adding fighter paths to
`listTuningPaths` would break `verify:tuning-ranges --check` and the hosted relay table, so keep fighter paths out of that
list.

### 3.6 The analyser (`scripts/fight-analyse.mjs`, pure Node)

Reads a run directory, writes `summary.json` and `matrix.csv` and a Markdown report: per-fighter win rate with Wilson
intervals and a Bradley-Terry rating; the matchup matrix; time-to-kill and fight-length distributions; damage by source and
by ability; ability uptime, uses, refusals, damage per use; movement profile (distance, airtime share, speed percentiles,
range-band occupancy); stalemate and snowball flags. Continuous metrics (damage per second, time-to-kill) compare two runs
with Welch's t (`perf-harness.mjs:106 welchT`); win rates and the matrix use Wilson intervals and Bradley-Terry / Elo
(new). Run provenance reuses `currentGitCommit/State/CommandLine` (`perf-harness.mjs:134-157`) and the guardrail
evaluators (`parseThresholdEnv` / `evaluateSummaryThresholds`, `:172-212`).

### 3.7 The tuner (`scripts/fight-tune.mjs`)

A sweep driver modelled on `calibrate-audio-sfx.mjs`: a target table (the balance targets above), a list of tunable
paths with ranges, and an interleaved A,B,B,A block design (`perf-fx-suite.mjs --ab`) that cancels drift. It **emits a
`balance-patch.json`** (path -> value, with the evidence that justified each change); it never edits source. A human (or a
follow-up change) applies the patch to the TUNING objects. Guardrails: a change per round is limited to +-15% of the
current value, and a round that moves any matchup by more than 15 points is flagged for review.

### 3.8 Fight review in the Arena

A review overlay in the Proving Yard (phase 7): load a fight file and play the sampled tracks back as ghosts on the
stage with a timeline (hits, abilities, ko marked), per-fighter damage graph, and a heatmap of positions; the batch report
links each fight file so "the outlier fight" is one click away. The live recorder (dev endpoint) feeds the same viewer, so
a fight you just watched can be scrubbed.

## 4. Risks (carry into `docs/arena/MASTER-PLAN.md`)

1. **PvP is blocked** on the second combatant (phase 3): the singleton player, the foes' fixed hunting target and the
   single-player sim window. Track A (this document) builds against fighter-vs-foe **gauntlets** (`FOE_PRESETS`) and keeps
   the schema fighter-index-aware so PvP drops in.
2. **Replay is not exact.** Plan for statistics; measure the match rate before relying on replays.
3. **The regimes differ.** Pick one, validate against a live sample.
4. **Idle rendering** burns time and clip capture without a headless flag; background-page throttling is untested.
5. **Override traps:** captured `def` values, parallel resolvers, the tuning-range table.
6. **Bot quality dominates the results.** Report every number per brain; the dash-heavy and aim-heavy kits look weak under a
   poor brain.
7. **No stalemate rules** until phase 5 (stocks, ring-outs, collapse): Edda's heal window and kiting can stall forever, so
   batches need a time cap and a sudden-death or damage-race tie-break.
8. **Statistical power:** about 200 fights per pair for +-7%; 45 unordered pairs x both sides is about 18,000 fights, about
   50 hours on one page at 10 s a fight (*inferred*). Use shorter time caps, parallel pages and adaptive stopping.
9. **HMR reloads** (use a frozen server).
10. **Global singletons** persist across fights in a page: restore overrides in a `finally`, recycle pages.
11. **Data volume:** 60 Hz sampling stays opt-in.

## 5. Delivery (task ids in `docs/arena/TASKS.md`)

T2.1 measure ticks/s and the replay-match rate -> T2.2 `Game.advance` / headless flag / `resetForFight` -> T2.3 the recorder
+ the four instrumentation sites -> T2.4 `paramOverride` + `ftune` -> T2.5 `fight-batch.mjs` on gauntlets -> T2.6
`fight-analyse.mjs` -> T2.7 the dev endpoint + `fightlog` -> (phase 4) bots -> (phase 3) PvP schema fields -> T7.x the
tuner, the matchup matrix, the review overlay, an optional Node `HeadlessGame`.

## 9. Built and measured (2026-10-01)

**What exists.** `core/fightSink.ts` (the one seam), `fighters/telemetry/fightLog.ts` (schema v1: a header, 10 Hz samples of EVERY
fighter, `hit` / `hurt` / `ability` / `end` events; a `hurt` carries the attacker slot and the blow's tag from the arena),
`fighters/telemetry/fightHarness.ts` (`window.__fight.run(spec)`: stage, run and record a whole duel in the page, headless),
`fighters/paramOverride.ts` + `paramRanges.ts` (every kit number and every fighter body named by a dotted path, ranged, restorable),
`Game.advance / resetForFight / headless`, `scripts/fight-batch.mjs` (N pages, a job queue, every ordered pair x seeds, overrides),
`scripts/fight-analyse.mjs` (win rates with Wilson intervals, Bradley-Terry, matchup matrix, damage by tag, ability use, movement
profile, flags) and unit tests. The recorder and the override registry were first written by an agent that was then stopped by a rate
limit; the integrator reviewed them, ported them onto the duel core, made the recorder two-fighter, and wrote the harness, the batch
runner and the analyser.

**The numbers (T2.1).** A headless duel runs at about **3,700 ticks a second** on this laptop (a 25 s fight in 0.4 s; a 90 s one in
about 1.5 s). The full matrix (90 ordered pairs x 3 seeds = 270 fights) takes **3 minutes on one page**. Fights are deterministic:
the same seeds and the same build give the same outcome to the last digit (the mirror run, repeated, gave identical win counts).

**What the first runs found.** The pipeline earned its keep before a single balance number was moved:
1. A **huge slot bias** (the left fighter won 83-100%): the rival was built from a default player (100 hp, the base 100 levitation)
   while slot 0 carried the test run's kit (154 hp). Fixed: the rival is built from slot 0's UNSCALED health and levitation, its
   wands, cards and flasks, then its body scales them. (`ArenaSlots.matchLoadout`.)
2. A **second bias from the stage**: a 16-high pedestal in the middle blocked shots at shoulder height and sat next to one fighter in
   the scripted test. It is 8 high now. The scripted mirror (both fire at each other, no AI) went from 40-0 to **20-20**; the AI
   mirror matches from 12-0 to 8-6 / 8-6 / 9-5.
3. The fighters take turns **resolving first by tick parity** (`Game`): that alone did not remove the bias (the health did), but it is
   what makes the mirror even.
The side is read from the report's `left` / `right` columns on every run: a side-bias flag fires past 20 points.

**The first baseline (270 fights, level-3 `basic` bots, 2026-10-01):**

| fighter | win rate | 95% | note |
|---|---|---|---|
| Rusk | 91% | 80-96 | the second heaviest body, hp x1.25, power x1.1 |
| Brann | 85% | 73-92 | the heaviest, hp x1.35, power x1.1 |
| Ilyra | 70% | 57-81 | the only one whose tactical deals real damage (21 a fight) |
| Edda | 57% | 44-70 | |
| Kest | 56% | 43-69 | |
| Sable | 39% | 27-52 | |
| Nox | 29% | 18-42 | |
| Selene | 29% | 18-42 | |
| Thorne | 27% | 17-40 | |
| Mara | 17% | 9-29 | the floaty glass cannon |

Median fight 20 s; 256 knockouts, 14 timeouts. **The finding that matters:** 80% of the damage in every fight is the shared Spark Bolt
and the shared kick (`spell` 40-88 a fight, `kick` 12-24); the tactical and the ultimate deal almost nothing (0-0.3 a fight, Ilyra's
21 the exception). So the fights are decided by the BODY (health and power multipliers), not by the kits: this is the measurement
behind "all the fighters feel the same". The fix is not a stat nudge. It is (a) a signature primary attack per fighter
(MOVESETS-V2.md 6a, the data-only loadouts), (b) bots that use the abilities with intent (AI-FIGHTERS.md playbooks), then (c) the
tuner (V7). The report names it as a flag: ability uptime low and tactical damage near zero.

**Not built yet:** `fight-tune.mjs` (the A/B tuner and `balance-patch.json`), the dev endpoint and `fightlog` console toggle (T2.7), the
in-game review overlay (V7.3), the replay-match rate and live-vs-paused measurement (T2.1's other half), console `ftune`.

## 10. The tuner and the replay-match rate (2026-10-02)

**Replay-match rate (T2.1).** The same 30-fight batch (three pairs, five seeds, both sides) run in two separate page loads: **30 of 30
fights had the same winner, 27 of 30 the same duration and end health, and the first fight was byte-identical** (records, to the last
sample). So a batch is reproducible in outcome (a re-run answers "did the change do it, or noise?") and almost always bit-for-bit; the
three that differ are tick-level drift (a Rapier or wall-clock path), not a different result. D-010 in `DECISIONS.md` records it.

**The tuner (`scripts/fight-tune.mjs`).** One round is a full matrix (every ordered pair x seeds); each fighter's win rate is its distance
from 50%; its `dealt` and `maxHp` move by `gain` times that distance (at most `step` a round, and only inside `BODY_RANGES`); the next
round measures again. A fighter pinned at a range limit is reported. First pass (level-3 bots, 6 seeds, gain 0.4, step 0.10, ten rounds,
`verify-out/fights/tune3`): from [15%, 94%] to [39%, 62%] by round 5. What it cannot do: it moves two stat knobs per fighter, so it equalises
power, not style; and win rates are noisy (about 13 points either way at 54 fights per fighter, 7 at 144: use more seeds before trusting
a small move).

**What a balanced roster still is not.** Equal win rates say the ten are *equally strong*, not that they are *different*. The distinctness
checks are the other half: the style table (speed, airborne share, gap to the foe, ability use), the damage-by-source split, and the eye.
A fighter whose tactical never matters is a flag (dead-ability) however even its win rate.

## 11. Two tuning passes, and what they taught about the lever (2026-10-02)

| pass | knobs | result | cost |
|---|---|---|---|
| 1 (`tune3`, 7 rounds, 6 seeds) | `dealt` + `maxHp` | worst fighter 7 points from 50% (43-57%) | Brann hp x0.81 (the wall is frail), Kest x0.73, Edda x0.79, Nox x1.47 (a tank): balanced, and the fantasy inverted |
| 2 (`tune4`, 10 rounds, 6 seeds) | `dealt` alone (0.6-1.6) | stuck: worst 35 points; five fighters pinned at a limit (Ilyra, Brann too strong; Sable, Mara, Nox too weak) | none, and none of it fixed |

**Lesson.** A stat lever can balance anything, and will, by erasing the character: the tuner found that making Brann frail and Nox tough
evens the table. The balance lever has to be one that does not carry the fantasy. `dealt` is that lever, but it is weak against a body
that survives (Brann at x0.6 power still wins 85%: his health, armor and mass do the work), so the remainder belongs to the *loadout*
(the weapon's own power: `loadout-sweep`) and to the kit's defensive numbers. The order that works: (1) set each primary's raw power
into one band with the DPS rig and the lab, (2) sweep candidate loadouts for whoever is pinned, (3) let the tuner turn `dealt` for the last
few points, (4) check the style table so equal strength did not erase difference.

`scripts/loadout-sweep.mjs` is step 2: one fighter against the other nine, both sides, with each of several candidate loadouts.

## 12. The third pass: converged and validated (2026-10-02, `docs/fighters/balance/pass-01.md`)

With the designed health standing and `dealt` as the only lever over a wide range (0.3-2.5), the tuner converged in 12 rounds (`tune5`), and a
validation run of the tuned numbers (**1,080 fights**, every ordered pair x 12 seeds) put **every fighter between 43% and 56%, with no flag**.
Brann 0.47 and Edda 0.375 are the two that moved most: the wall hits softly, and Edda's loadout (the premium void frame with piercing
lances) is too strong by about a third (the pass document says so: a lighter frame is the next pass). `scripts/fight-apply-patch.mjs` writes a
patch into `content/fighterBodies.ts` (a dry run by default).

How the roster got here is the most useful result: the tuner found each of the things that decide a bot duel before any kit does
(`ARENA-RULES.md`: the primary's real damage per second, the bot's range, the post-hit window, the world's fire) by failing on them, and
the rules now in force (`blowScale`, `hazardScale`, `invulnTicks`, the blast cap) are what those failures turned into. A different rule
set, a better bot or a new loadout is a different pass: re-run the matrix, do not trust the old numbers.

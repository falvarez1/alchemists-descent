# Arena programme: the task list

Legend: `[x]` done, `[~]` in progress, `[ ]` not started, `[-]` cut (reason in `DECISIONS.md`). An id is stable: briefs, commits
and the decision log refer to it. Update the box in the same commit as the work. Phase order and dependencies:
`MASTER-PLAN.md` 3.

## P0: plan and documents

- [x] P0.1 `docs/arena/` written: master plan, architecture, physics, roster identity, movesets, AI, rules, telemetry
- [x] P0.2 `TEST-PLAN.md`, `WORKFLOW.md`, `DECISIONS.md`, `README.md`, `briefs/` (the briefs are written as packages start)
- [ ] P0.3 `docs/FIGHTERS.md` "Done and remaining" points at this folder; `CLAUDE.md` gets one arena bullet

## P1: bodies (fighters move differently)

- [x] P1.1 `BodyProfile`, `NEUTRAL_BODY`, ranges in `core/fighters.ts`; `FighterApi.body` (frozen, recomputed on equip and mod change)
- [x] P1.2 `content/fighterBodies.ts`: the ten bodies (`FIGHTER-PHYSICS.md` 4)
- [x] P1.3 `Player.ts`: read the body once per update and apply `run/accel/friction/airControl/jump/jumpCut/gravity/fall/jet/coyote/buffer/crawl/stagger/invuln` (raise `MOVE_ACCEL_CAP` and `maxRunCap` with `run`)
- [x] P1.4 `applyImpulse` reads `mass`; `Enemies.damage` reads `dealt`; equip applies `maxHp` (keeping the ratio)
- [x] P1.5 `FighterMod` extended (`gravity`, `fall`, `jump`, `airControl`, `accel`, `friction`, `jet`); effective = base x mods
- [x] P1.6 panel: the Body card (bars vs the Alchemist) and the live movement readout (speed, peak, jump apex, airtime, LEV)
- [x] P1.7 the hall: a height ruler beside the Bluff and a run lane with distance marks
- [x] P1.8 `tests/fighter-bodies.test.ts` (table, ranges, guard rails) and `scripts/verify-fighter-bodies.mjs` (the roster orders as the table says; the control is unchanged)
- [x] P1.9 the ten movement techniques (`src/fighters/techniques.ts`, copy in `content/fighterTechniques.ts`; `verify-fighter-moves.mjs`, 19 checks): Cinder Dash, Piston Stomp, Wall-cling, Glide, Wall-run, Shadow-step, Hover, Carry, Skid, Root-walk
- [ ] P1.10 the distinctness checklist (`ROSTER-IDENTITY.md`) passes on measured numbers

## P2: telemetry foundation

- [x] T2.1 measure: ticks/s of the paused-step regime, the replay-match rate, the live-vs-paused difference; write them in the report header
- [x] T2.2 `Game.advance(n, {render:false})`, a headless flag that idles `renderFrame`/clips, `resetForFight(seed)` (the reset recipe)
- [x] T2.3 `src/fighters/telemetry/fightLog.ts` (schema v1, columnar buffers, the recorder) + the four instrumentation sites (hit, hurt, ability, hurt tag)
- [x] T2.4 `src/fighters/paramOverride.ts` + `window.__paramOverride` + console `ftune` + the fighter range table + a generalised path resolver
- [x] T2.5 `scripts/fight-batch.mjs` (N pages, a job queue, scenario x fighter x seed x override, files under `verify-out/fights/<runId>/`)
- [x] T2.6 `scripts/fight-analyse.mjs` (win rates with Wilson intervals, Bradley-Terry, time-to-kill, damage by source, ability uptime, movement profile, stalemate flags)
- [ ] T2.7 the dev endpoint plugin and the `fightlog start|stop` console toggle
- [x] T2.8 tests: `fight-log`, `param-override`, `fight-analyse`; a probe that records one fight and re-reads it

## P3: combatants (D-001, `ARCHITECTURE.md`)

- [x] A3.1 contracts: `Enemy.fighter`, `Projectile.owner`, `'fighter'` enemy kind (+ defs, profiles), `Ctx.arena`
- [x] A3.2 `src/arena/ArenaSlots.ts`: slots, `bind/with`, proxy factory and sync, knock bridge, victim-side slow/stun
- [x] A3.3 the scoped event bus; every per-slot subscription registered through it; `adopt()` under bind
- [x] A3.4 `Game.ts`: the rival loop, sim-bounds union, camera targets
- [x] A3.5 `Enemies.ts`: the redirect in `damage/kill/gustShove/splashHazard`, the AI-loop skip, `noteEnemyHurt`
- [x] A3.6 `Projectiles.ts` + `markProjectile`: `owner` stamps, per-projectile bind, enemy-index invalidation, `interceptProjectile` for proxies
- [x] A3.7 `Player.ts`: arena `kill`/`respawn` branches, `stunT`, `STOMP_IMMUNE`
- [x] A3.8 render: the second fighter's sprite/shadow/pose/fx; proxies skipped in every enemy draw loop; camera multi-target + leash
- [~] A3.9 the duel stage (done: symmetric, `world/duelStage.ts`) and a second-input provider for a second HUMAN (not done: a rival is driven by a brain or nothing)
- [x] A3.10 the "every damage path exactly once" probe (spell, kick, explosion, flame, liquid, rigid body, each kit effect) and a regression run of all existing probes
- [ ] A3.11 audit of the ~60 files that scan `ctx.enemies` (music, hints, minimap, readouts, sprite switches) for proxy leaks

## P4: AI fighters (`AI-FIGHTERS.md`)

- [x] B4.1 the `Brain` interface and the input seam (writes an `InputState`; keyboard detachable for slot 0)
- [x] B4.2 v0 dummy brain + Bots section in the panel + console `ai`
- [x] B4.3 WorldView, Control (steering with traction awareness, aim with lead), Execution noise, skill tiers (`config/aiTiers.ts`)
- [x] B4.4 v1: approach, attack, kick, jump a slab; the Yard's `StageNav`
- [ ] B4.5 v2: Intent (utility goals), the ten playbooks, defence
- [ ] B4.6 perception parity: concealment, darkness, Nox/Thorne/Kest abilities fool the bot as they fool foes
- [~] B4.7 debug overlay (intent, path, aim, range ring: not done) and a Watch mode with a result card (done: the panel's Watch button and the bout line)
- [ ] B4.8 v3 stocks: recovery, edge-guard, free-for-all targeting (after P5)
- [~] B4.9 tests and probes: planner scoring, seeded noise, scenario probes (approach, climb, raise plate), 1,000-fight soak with a stuck detector

## P5: match rules (`ARENA-RULES.md`)

- [ ] R5.1 `MatchDirector` + `config/arenaRules.ts`; the health duel with a time cap and sudden death (lava rise)
- [ ] R5.2 volatility, scaled knockback, hitstun, DI in `damage`/`applyImpulse`
- [ ] R5.3 blast zones, stocks, respawn platforms
- [ ] R5.4 the collapse (rising lava, lowering roof)
- [ ] R5.5 multi-target camera with zoom budget and the sim-window union (measured against `PERF-2026-09.md`)
- [ ] R5.6 stage 2 (the Kiln Floor) authored in the Builder (`EditorDocument kind:'arena'`) and the mirror test

## P6: movesets v2 (`MOVESETS-V2.md`)

- [x] M6.1 `content/fighterLoadouts.ts` (signature wands and flask belts as data) + grant on equip in an arena
- [ ] M6.2 Brann and Rusk signature primaries (`kit.primary?()`)
- [ ] M6.3 the other signature primaries the telemetry asks for
- [ ] M6.4 direction variants of Z (optional)
- [ ] M6.5 universal defence (D-006), if decided

## P7: balance and review

- [~] V7.1 the first full matchup matrix (45 pairs x both sides, bots level 3 and 5) and `docs/fighters/balance/baseline-<date>.json`
- [ ] V7.2 `scripts/fight-tune.mjs` (interleaved A/B, a `balance-patch.json` with evidence, +-15% per round)
- [ ] V7.3 the fight-review overlay in the Yard (timeline, ghosts, damage graph, heatmap) (stock matches: BL5.2-5.3)
- [ ] V7.4 balance passes until the targets hold; every pass writes `docs/fighters/balance/pass-NN.md`
- [ ] V7.5 optional: a Node `HeadlessGame` for parallel bulk runs (BL7.1, after the split)

## P8: the Balance Lab (`BALANCE-LAB.md`, `BALANCE-LAB-PLAN.md`)

Milestones: M1 see and run (BL0, BL1), M2 edit safely (BL2, BL3, BL6.2), M3 new moves (BL4), M4 understand (BL5), M5 automate (BL6).

- [ ] BL0.1 every knob registered at boot (`fighters/tuningRoots.ts`)
- [ ] BL0.2 the analyser as a library (`tools/lab/analysis.mjs`; `duel-analyse` byte-identical)
- [ ] BL0.3 stock-match determinism probe (`verify-duel-determinism.mjs`)
- [ ] BL0.4 the balance store (`balance/`: contract, baseline, changelog, waivers)
- [ ] BL1.1 frozen lab builds (content-hashed, immune to editing `src`)
- [ ] BL1.2 the Lab server (Vite plugin: queue, runner pool, server-sent events, run store)
- [ ] BL1.3 `/lab.html` route and shell (dev and authoring builds only)
- [ ] BL1.4 Dashboard
- [ ] BL1.5 Runs (launcher, queue, live partial standings)
- [ ] BL1.6 Compare (A/B with significance)
- [ ] BL2.1 fighter sheets (JSON) with the equivalence batch
- [ ] BL2.2 kit numbers in the sheets (one kit per commit)
- [ ] BL2.3 drafts, Apply and the balance changelog
- [ ] BL2.4 the embedded game and its bridge
- [ ] BL2.5 the roster grid with measured mobility
- [ ] BL2.6 the sheet editor
- [ ] BL3.1 move metrics and the KO calculator
- [ ] BL3.2 cohorts, dominance and fighter indices
- [ ] BL3.3 the combo finder and loop guard
- [ ] BL3.4 the L0 and L1 gates (`tests/balance-static.test.ts`)
- [ ] BL3.5 the power budget screen
- [ ] BL4.1 `MoveSpec` v3, the v1 adapter and the schema
- [ ] BL4.2 hitbox windows and per-move multipliers
- [ ] BL4.3 directional inputs and slots (keyboard, pad, CPU hands)
- [ ] BL4.4 cancels, chains and interruptibility
- [ ] BL4.5 aerial landing lag and auto-cancel
- [ ] BL4.6 armor, intangibility, motion, turnaround
- [ ] BL4.7 charged smashes
- [ ] BL4.8 move projectiles and command grabs
- [ ] BL4.9 special skills as moves (`MoveScript`)
- [ ] BL4.10 the CPU uses any move (coverage gate)
- [ ] BL4.11 the Move Lab
- [ ] BL4.12 art for new moves (dependency: `platform-fighter/SPRITES.md`)
- [ ] BL5.1 run records v2
- [ ] BL5.2 replay and seek
- [ ] BL5.3 the fight timeline
- [ ] BL5.4 the matchup explorer
- [ ] BL6.1 sequential tests and Bradley-Terry
- [ ] BL6.2 the gate evaluator, `balance:smoke` and `balance:full`
- [ ] BL6.3 CI (pull-request smoke warning, nightly full matrix)
- [ ] BL6.4 sensitivity sweeps
- [ ] BL6.5 degenerate-strategy and loop detectors
- [ ] BL6.6 identity fingerprints
- [ ] BL6.7 promote to baseline
- [ ] BL7.1 the headless kernel runner (after the split)
- [ ] BL7.2 human match telemetry
- [ ] BL7.3 a hosted Lab

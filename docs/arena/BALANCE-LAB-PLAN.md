# The Balance Lab: implementation plan

**Status: plan (2026-10-04). The design is `BALANCE-LAB.md`; read it first.** This file is the order of work. Each work
package has:

- **Goal**
- **Files** it creates or changes
- **Tests and probes** that prove it
- **Exit criteria**
- **Size**: S is about a day, M two or three days, L four to six days, XL one and a half to two weeks of focused work.

Ids are stable (`BL<phase>.<n>`). `TASKS.md` P8 tracks them; update the box in the same commit as the work.

**The decisions are settled** (`BALANCE-LAB.md` section 12, `DECISIONS.md` D-014 to D-021). They shape this plan:

- the gates measure Hard and Expert with mirrored personality rotation;
- fighter data is JSON sheets with a generated schema;
- the full move vocabulary, with a required core;
- stale-move negation as a match rule, on by default;
- self-contained runs and local drafts;
- strict CI gates with waivers;
- **the Lab is built in the CLASHFORGED repository, from the day the split copies it out** (split phase 1).

## Before the Lab

### What the Lab needs from the split

The split (`docs/split/SPLIT-PLAN.md`) copies this repository in two: CLASHFORGED gets a copy with the full history and
keeps the arena, and Descent deletes it. The Lab's first package starts the day that copy lands (split phase 1). It
needs:

1. **The CLASHFORGED repository**, in this repository's layout: the fighters (`src/fighters/`, `src/content/fighters*`),
   where the sheets and the analyser will live; the arena code (`ArenaSlots`, the stock rules, the CPU, the harness),
   where the moveset engine work (Phase 4) happens; its Vite config, where the Lab adds `lab.html` beside `index.html`
   and `builder.html`; and the `__AUTHORING__` gate.
2. **Nothing else to start.** The campaign code is still there until split phase 3 deletes it. Lab code imports only the
   fighters, the arena, telemetry, config and the engine, so that deletion does not touch it.
3. **Ideally, a composition root that can run a match with no DOM, WebGL or audio.** Split phase 3 writes CLASHFORGED's
   own `Game` and should aim for it. It is not required; BL0.5 measures whether it exists and what it gives, and is
   re-run after phase 3 if it was blocked.

### Until then: the interim routine

New moves and attribute changes keep landing before the Lab exists. Guard each one with today's tools:

1. Run the pass-1 confirmation spec on the changed code:
   `node scripts/duel-batch.mjs <frozen url> --pairs all --seeds 4 --stage all --pages 3 --personality duelist --seed-base 30000`
2. Compare it with the pass-1 run: `node scripts/duel-analyse.mjs <new run> --compare <confirm-final>`. `confirm-final`
   is in the main checkout's `verify-out/duels/`; the same command on `0437216` re-creates it.
3. Read the flags and any fighter whose rate moved outside its interval. Re-tune with `duel-tune.mjs --resume` when a
   change moved the balance.

### Paths

The CLASHFORGED repository keeps this repository's layout, so the paths in this plan are the paths the Lab is built
at. Its new folders:

| What | Where |
|---|---|
| Fighter sheets and their schema | `src/content/fighters/sheets/` |
| The static analyser | `src/fighters/analysis/` |
| The Lab page (dev entry only) | `lab.html` at the root, `src/lab/` |
| The bridge's game side | `src/dev/` |
| The Lab server, runner, store, gates | `tools/lab/` |

## Milestones

| Milestone | Phases | What you can do when it lands | Rough size |
|---|---|---|---|
| **M1. See and run** | 0, 1 | Open `/lab.html`: the dashboard, matchups and flags; launch a smoke or an A/B run from the page and watch it fill in; compare two runs | about 2 weeks |
| **M2. Edit safely** | 2, 3, BL6.2 | Edit any attribute, Duel lever, blow or kit number as a draft; see it live in the embedded game; the power budget recomputes as you type; one click A/Bs the draft; *Apply* writes the sheet and the changelog; the static gate fails a build on an outlier | about 3 weeks |
| **M3. New moves** | 4 | Author character-specific moves, chains and specials in the Move Lab; frame-step them with hitboxes drawn; the KO calculator and combo finder answer at once; the CPU uses every new move | about 4 weeks |
| **M4. Understand** | 5 | Replay any match from any run with a timeline of blows, shields, KOs and what each CPU was thinking; drill from a matchup cell to its matches | about 1 week |
| **M5. Automate** | rest of 6 | The smoke matrix as a required check on pull requests that touch fighters, moves or the arena; the nightly full matrix blocking releases; baseline promotion; sensitivity sweeps; identity checks | about 1.5 weeks |
| Later | 7 | Human match telemetry, a hosted Lab | |

All milestones are built in the CLASHFORGED repository, from the day the split copies it out (split phase 1). M2 is the point where attribute work becomes safe. M3 is the point
where new moves become safe. If time is short, build M1 and M2 first, then BL3.3 (the combo finder) before any chained
moves.

## Order and dependencies

```
Phase 0 (prep) --> Phase 1 (Lab MVP) --+--> Phase 2 (sheets, drafts, roster) --+--> Phase 4 (moveset v3, Move Lab) --> Phase 5 (review)
                                       +--> Phase 3 (static safety net) -------+
                                       +--> BL6.2 (smoke gate) --------------------------------------------------> Phase 6 rest (automation)
```

- Phases 2 and 3 can run in parallel (two agents), as can BL6.2.
- Phase 4 needs both: the sheet schema (BL2.1) and the analyser (BL3.1-3.3), because new moves must be measurable the day
  they are written.
- At most three or four agents at once (D-008). Every long batch runs against a frozen build (BL1.1); until that exists,
  against a frozen worktree server.

---

## Phase 0. Preparation (about 2 days)

### BL0.1 Every knob registered at boot (S)

- **Goal:** the registry knows every root in any dev build, so `ftune`, the Lab and the tuner agree.
- **Files:**
  - `src/fighters/tuningRoots.ts`, new: registers `body`, `stock`, `stockBalance` and `arena`, plus `ai.personality.*`,
    `ai.tier.*` and `ai.behavior.*` as registry roots over `AI_PERSONALITIES`, `AI_TIERS` and `AI_BEHAVIOR`.
  - `fightHarness.ts` and `stockHarness.ts` call it instead of registering their own roots.
  - `main.ts` dev block.
- **Tests:** `tests/param-override.test.ts` extended: every root resolves, defaults are inside their ranges, double
  registration is a no-op.
- **Exit:** `ftune list stockBalance` works on a fresh page with no harness call.

### BL0.2 The analyser as a library (M)

- **Goal:** one implementation of aggregation, Wilson intervals, flags, compare and stall listing, used by the CLI, the
  Lab server and the gates.
- **Files:**
  - `tools/lab/analysis.mjs`, new: pure functions, no I/O.
  - `scripts/duel-analyse.mjs` becomes a thin CLI over it, with output unchanged.
  - `tools/lab/fixtures/` holds a few small real `duels.ndjson` files.
- **Tests:** `tests/lab-analysis.test.ts`: aggregates and flags on the fixtures; Wilson against known values;
  `compare` deltas.
- **Exit:** `duel-analyse` produces a byte-identical `report.md` on `verify-out/duels/confirm-final`.

### BL0.3 Stock-match determinism probe (S)

- **Goal:** prove what replays and A/B comparisons rely on (D-010, measured for the health duel only).
- **Files:** `scripts/verify-duel-determinism.mjs`. It runs the same `__duel.run` spec twice in a page and once after a
  reload, and compares record hashes.
- **Exit:**
  - Identical records within a page and across page loads.
  - Or a written list of the divergence and its cause, fixed before Phase 5.

### BL0.4 The balance store (S)

- **Goal:** the repository holds the contract, the accepted baseline and the history.
- **Files:**
  - `balance/contract.json`: section 3 of the design.
  - `balance/baseline.json`: the `confirm-final` report and its spec.
  - `balance/CHANGELOG.md`: pass 1 written up.
  - `balance/waivers.json`: empty.
  - `tests/balance-store.test.ts`: the files parse; every waiver names a real fighter or move and has a future expiry.
- **Note:** `confirm-final` was measured at Normal with Duelist on both sides. The official setup is Hard and Expert with
  mirrored rotation (D-014, D-015), so the first full run at that setup (BL6.2) replaces it. Until then it is the
  reference for direction only, not for the gates.
- **Exit:** the files are in the repo and validated.

### BL0.5 Can a match run without a browser? (M)

- **Goal:** decide, by measurement, whether the runner is built on the game running in Node worker threads (no DOM,
  WebGL or audio) or on headless browser pages (today's harness).
- **Files:** `tools/lab/kernel-spike.mjs`. It boots the engine and the arena code in a Node worker,
  plays the BL0.3 determinism spec, and compares the record with the browser's.
- **Measure:**
  - Identical records (the same seed gives the same match in Node as in the browser).
  - Matches per second per core.
  - The list of browser-only dependencies that had to be stubbed.
- **Exit, one of two:**
  - Records match and throughput is at least 3 times the pages: the runner (BL1.2) uses kernel workers, with pages kept
    for anything that renders.
  - Otherwise, a written list of what blocks it, filed against CLASHFORGED's composition root (split phase 3); the
    runner uses pages until it is cleared.

---

## Phase 1. The Lab MVP: see and run (about 1.5-2 weeks)

### BL1.1 Frozen lab builds (M)

- **Goal:** a run plays a snapshot that editing `src` cannot reload (D-L3).
- **Files:**
  - `vite.config.ts`: a `lab` mode that defines `__LAB__` and keeps the harness modules (`stockHarness`, `fightHarness`)
    in the bundle.
  - The harness install in `main.ts` keys on `import.meta.env.DEV || __LAB__`.
  - `tools/lab/builds.mjs`: build into `.lab-builds/<content hash>/` (ignored), reuse when the hash matches, serve
    statically on a free port, and prune old builds.
- **Tests:**
  - `verify:builder-bundle` (or a sibling check) proves a normal production build contains no harness and no Lab code.
  - A unit test of the content-hash key.
- **Exit:**
  - A lab build starts in under 2 minutes cold and under 5 seconds cached.
  - `__duel.run` works in it.
  - Editing a source file during a run changes nothing in that run.

### BL1.2 The Lab server (L)

- **Goal:** queue, run and store batches; stream progress (D-L2).
- **Files:**
  - `tools/lab/server.mjs`: a Vite plugin, `serve` only. Endpoints:
    - `GET /__lab/runs`, `GET /__lab/runs/:id` (report and records);
    - `POST /__lab/runs` (a spec);
    - `DELETE /__lab/runs/:id` (cancel);
    - `GET /__lab/events` (server-sent events: progress, partial standings, done);
    - `GET /__lab/contract`, `GET /__lab/baseline`.
  - `tools/lab/runner.mjs`: the worker pool, extracted from `duel-batch.mjs`, which becomes a CLI over it. Kernel
    workers or headless pages, as BL0.5 decided, behind one interface.
  - `tools/lab/store.mjs`: the run index over `verify-out/duels/`.
- **Specs it understands:**
  - CPU levels as a list (the official setup is `[4, 5]`, D-014).
  - Personality modes: `mirrored` (both sides the same profile, rotating through all six across seeds: the default,
    D-015), `fixed:<profile>`, and `lobby` (each fighter's own).
- **Rules:**
  - Localhost only.
  - Child processes spawned with argument arrays (no shell strings).
  - Writes only under `verify-out/` and `balance/`.
  - One queue, with N workers (default: physical cores minus one; at most 4 for pages).
  - Every record embeds the complete override set it played, the build hash and every sheet hash (D-019): a run never
    depends on a draft file.
- **Tests:** `tests/lab-server.test.ts` (spec validation, queue order, cancel, path guards) with the runner mocked.
- **Exit:** a smoke spec (180 matches, the official setup) posted with `curl` runs, streams progress and lands in the
  index. Concurrent posts queue.

### BL1.3 The `/lab.html` route and shell (M)

- **Goal:** the page itself (D-L1, D-L8).
- **Files:**
  - `lab.html`: a third Vite input, dev and authoring builds only, never in the player build.
  - `src/lab/main.ts`, `src/lab/shell.ts`: tabs, routing in the hash, the server-sent-events client.
  - `src/lab/ui/`: table, heatmap, bar-with-interval, sparkline, scatter. Inline SVG, Studio tokens.
  - `styles/lab.css`: no colour literals (as `studio-chrome.css`).
- **Tests:** `tests/lab-html.test.ts`: the input exists only in dev and authoring builds. Unit tests for the chart
  helpers (scales, bins).
- **Exit:** `/lab.html` opens with empty tabs and a live connection indicator.

### BL1.4 Dashboard (M)

- **Goal:** design 6.1.
- **Shows:**
  - win rates with intervals and the band;
  - the matchup heatmap (cells link to their matches);
  - flags from the contract;
  - trends over accepted runs;
  - the run list.
- **Probe:** `scripts/verify-lab.mjs`, with real clicks: open the Lab, the dashboard renders from a fixture store, a
  heatmap cell opens its matches.
- **Exit:** the dashboard reproduces `confirm-final`'s report numbers exactly.

### BL1.5 Runs (M)

- **Goal:** design 6.2.
- **Has:**
  - the launcher with presets (Smoke, A/B, Full), seed base, stages, levels, personality mode, draft (once Phase 2
    lands), label;
  - the queue with live partial standings, ETA and cancel.
- **Probe:** `verify-lab.mjs` launches a 10-match run with real clicks, sees progress events and the finished report.
- **Exit:** a smoke run from the page matches the same spec run from the command line, record for record.

### BL1.6 Compare (M)

- **Goal:** design 6.3.
- **Shows:** per-fighter deltas with a two-proportion test, the matchup delta heatmap, blow usage deltas, and the
  override diff.
- **Tests:** unit tests of the test statistic and the significance marking in `tools/lab/analysis.mjs`.
- **Exit:** `confirm-tuned` against `confirm-final` shows Sable's change as the only override and its delta with an
  interval.

---

## Phase 2. Sheets, drafts and the roster: edit safely (about 2 weeks)

### BL2.1 Fighter sheets (L)

- **Goal:** tunables become data (D-L4, D-016, design 5.1).
- **Files** (in `src/content/fighters/`):
  - `sheets/<id>.json` (ten), each with `"$schema": "../fighter-sheet.schema.json"` and a `notes` map (field path to
    help text) that carries today's explanatory comments.
  - `sheets/types.ts`: the `FighterSheet` TypeScript types, the single source of truth.
  - `sheets/schema.ts`: the runtime validator, with precise error messages and ranges taken from `BODY_RANGES`,
    `STOCK_ATTACK_RANGES` and `STOCK_BALANCE_RANGES`.
  - `fighter-sheet.schema.json`: the JSON Schema, generated from the types by `scripts/gen-sheet-schema.mjs`. A
    `--check` mode fails CI when it is stale, as `gen:tuning-ranges --check` does today.
  - `sheets/index.ts`: the loader.
- **The tables become views over the sheets, each keeping its export:** `FIGHTER_BODIES`, `STOCK_BALANCE`,
  `STOCK_ATTACKS`, `FIGHTER_LOADOUTS`, `FIGHTER_PERSONALITIES`.
- **Kit numbers:** BL2.2.
- **Tests:**
  - `tests/fighter-sheets.test.ts`: every sheet validates, and each view equals the old table's shipped values
    (snapshotted before the change).
  - Existing tests unchanged.
- **Equivalence check:** a 90-match batch on fixed seeds, before and after, with identical records (`duels.ndjson`
  minus timing fields).
- **Exit:** all of the above; the registry paths are unchanged (`stock.<id>...`, `body.<id>...`, `stockBalance.<id>...`).

### BL2.2 Kit numbers in the sheets (M, one kit at a time)

- **Goal:** each kit's `TUNING` reads from its sheet's `kit` section, so the Lab can apply kit changes as JSON.
- **Files:**
  - each `fighters/kits/<id>-logic.ts` (or `-math`, `-grow`): `export const TUNING = sheet('<id>').kit`, typed by the
    kit's own interface;
  - `paramOverride.ts` keeps the `kit.<id>.*` paths, with `DEF_LINKS` unchanged.
- **Tests:** each kit's tests pass unchanged; its fighter probe (`verify-fighter-<name>`) is green.
- **Exit:** ten kits migrated, one commit each.

### BL2.3 Drafts, Apply and the changelog (M)

- **Goal:** draft, evidence, apply (D-L6, D-019).
- **Files:**
  - `tools/lab/sheets.mjs`: read; validate; apply a draft to the sheets (a JSON write with stable key order and
    formatting); and a diff.
  - `tools/lab/drafts.mjs`: drafts as local working state in `.lab/drafts/<name>.json` (added to `.gitignore`), with
    export to and import from a file to share one.
  - Endpoints:
    - `GET` and `PUT /__lab/drafts/:name`; `POST /__lab/drafts/import`, `GET /__lab/drafts/:name/export`;
    - `POST /__lab/apply` with a draft, the evidence run ids and a note.
  - The changelog writer: an entry in `balance/CHANGELOG.md` with the diff table, evidence links, measured deltas,
    date and git commit.
- **Rules:** *Apply* refuses when the L0 or L1 gates fail for the result, unless a waiver is part of the request.
  Nothing is committed automatically: the diff is left for a person to review and commit.
- **Tests:** `tests/lab-sheets.test.ts`: round-trip formatting, a refused apply, changelog text.
- **Exit:** applying the pass 1 overrides to a pass-0 copy reproduces today's sheets byte for byte.

### BL2.4 The embedded game and its bridge (M)

- **Goal:** the Lab drives a game in an iframe.
- **Files:**
  - `src/lab/bridge.ts` (Lab side) and `src/app/labBridge.ts` (game side, dev only, active with `?lab=1`).
  - A `postMessage` protocol:
    - `setOverrides(draft)` and `clearOverrides()`;
    - `stage(spec)`: fighters, stage, dummy, percent;
    - `play()`, `pause()`, `step(n)`;
    - `replay(runSpec, tick)` (Phase 5);
    - `snapshot()` (positions, percents, the attack state).
  - Same-origin only; it ignores messages from other origins.
- **Probe:** `verify-lab.mjs`: setting `stockBalance.rusk-emberjaw.dealt` from the Lab changes the damage of Rusk's
  next blow in the iframe.
- **Exit:** a live override round-trips in under 100 ms. Clearing restores shipped values.

### BL2.5 The roster grid with measured mobility (M)

- **Goal:** design 6.4, top half.
- **Files:**
  - `tools/lab/mobility.mjs`: a short probe per fighter (run speed, jump height, fall speed, recovery reach), from the
    logic of `verify-fighter-bodies`, run in a lab build and cached by sheet hash.
  - `src/lab/roster.ts`: the grid with min, median and max envelope bars.
- **Exit:** the grid shows all ten with measured mobility. Changing a body value in a draft re-measures that fighter.

### BL2.6 The sheet editor (L)

- **Goal:** design 6.4, bottom half.
- **Tabs:** Body, Duel, Moves (the v1 fields until Phase 4), Kit, Loadout, CPU, Identity.
- **Every field shows:** a slider and a number, the shipped value, the draft value, its range, and a LIVE toggle.
- **Buttons:** A/B (queues draft against baseline on fresh seeds), *Apply*.
- **Probe:** `verify-lab.mjs`: edit, see the live change, start an A/B, apply to a scratch copy of the sheets.
- **Exit:** a designer can make and evidence a change without the console or a terminal.

---

## Phase 3. The static safety net (about 1 week, in parallel with Phase 2)

### BL3.1 Move metrics and the KO calculator (M)

- **Goal:** design section 7, L1 per move.
- **Files:** `src/fighters/analysis/moves.ts`. Pure functions computing:
  - frame advantage on shield (from `StockShield.block`'s stun);
  - reach and hitbox area;
  - damage after the fighter's levers;
  - **KO percent** against each roster weight from the stage centre and the ledge: launch from the real `stockLaunch`,
    a simple ballistic with the body's gravity, each stage's blast zone.
- **Tests:** `tests/balance-moves.test.ts`, against hand calculations. The KO calculator is checked against a measured
  in-game KO for three moves (a probe), with the tolerance written down.
- **Exit:** every current move has its metrics. The KO calculator is within 10 percentage points of measured KOs.

### BL3.2 Cohorts, dominance and fighter indices (M)

- **Goal:** z-scores within cohorts; the dominance rule; the offense and defense indices; the radar data.
- **Files:** `src/fighters/analysis/budget.ts`.
- **Tests:** synthetic rosters with one planted outlier (a fast, safe, strong smash), which must be flagged with the
  right explanation. Today's roster raises no fail.
- **Exit:** the report lists, per move and fighter, the numbers and any flag with its reasons.

### BL3.3 The combo finder and loop guard (M)

- **Goal:**
  - Link search: move A's hitstun against move B's startup, plus positions after the launch.
  - Cancel search, once Phase 4 adds cancels.
  - Up to depth 4, across 0-150%.
  - The longest true combo, and loop detection.
- **Files:** `src/fighters/analysis/combos.ts`.
- **Tests:** a planted infinite (a cancel cycle without cost) is caught at L0. A planted 0-to-death link chain is
  caught at L1. Known current links (the CPU's juggles) are found.
- **Exit:** it produces the link table the CPU will use in BL4.10.

### BL3.4 The L0 and L1 gates (S)

- **Goal:** a failing outlier fails the build.
- **Files:** `tests/balance-static.test.ts`. It reads the sheets, `balance/contract.json` and `balance/waivers.json`; it
  fails on schema errors, invariant breaks, z above 3, dominance and loops; and it prints the reasons.
- **Exit:** green on today's roster. Red, with a readable message, on each planted case in BL3.2 and BL3.3.

### BL3.5 The power budget screen (M)

- **Goal:** design 6.6, and the live POWER BUDGET in the sheet editor.
- **Shows:** the table, the scatter and the radar; "why flagged".
- **Exit:** editing a move's startup in a draft moves its dot on the scatter as you type.

---

## Phase 4. Moveset v3 and the Move Lab: new moves (about 4 weeks)

Engine changes are each behind data: a sheet that does not use a new field plays exactly as before. After each package,
three checks prove it:

- the BL2.1 equivalence batch (on v1 sheets);
- `verify-stock-attacks`;
- the stock probe set (footwork, recovery, pursuit, the Duel UI).

### BL4.1 `MoveSpec` v3, the adapter and the schema (M)

- **Goal:** design 5.2.
- **Files:**
  - `src/core/moves.ts`: types.
  - `src/fighters/moves/adapter.ts`: v1 kinds to v3 slots.
  - The sheet schema accepts v3.
  - `ArenaSlots` reads moves through one `moveFor(fighter, slot)` accessor. It resolves an unfilled optional slot
    through the fallback table (design 5.2, D-017), declared in the schema, never ad hoc in engine code.
  - The core set (16 slots) and the fallback table live in `src/moves/slots.ts`, shared by the engine, the schema, the
    analyser, the CPU and the Lab.
- **The completeness gate starts honest.** Today's fighters fill five of the sixteen core slots, through the adapter.
  - The L0 core-completeness check is a **fail** from day one.
  - Each fighter carries an explicit waiver in `balance/waivers.json` listing its missing core slots, with an expiry at
    the milestone its moveset is due.
  - The debt is visible in the Lab and shrinks as moves are authored; a waiver can only list slots that are actually
    missing.
- **Exit:** the equivalence batch is identical. Every v1 move round-trips through the adapter. The waivers list exactly
  the missing core slots.

### BL4.2 Hitbox windows and per-move multipliers (L)

- **Goal:**
  - Several hitboxes per move, each with its own window.
  - Hitlag, hitstun and shield-damage multipliers.
  - Priority, clank and trade rules.
- **Files:** `arena/StockAttack.ts` (the state per hitbox, claims per hitbox and victim), `ArenaSlots.resolveStockAttacks`.
- **Tests:** a multi-hit move hits once per box per victim; sweet and sour spots give different knockback; clanks
  resolve by priority.
- **Exit:** a test move with three windows plays correctly in a probe.

### BL4.3 Directional inputs and slots (L)

- **Goal:**
  - Tilts, smashes and aerials by direction.
  - Neutral, side, up and down specials.
  - One mapping table for the keyboard and pads, and the CPU's hands.
- **Files:** `input/stockPad.ts`, `input/InputManager.ts` (rebindable defaults), `arena/ai/control.ts` (`Hand`),
  `ui/` controls screen.
- **Tests:** an input matrix test: every slot is reachable from the keyboard and from a pad, and no slot is reachable
  two ways by accident.
- **Probe:** `verify-stock-controls` extended, with real key presses.
- **Exit:** every slot can be performed by a person and by the CPU.

### BL4.4 Cancels, chains and interruptibility (M)

- **Goal:** jab chains, tilt-to-special on hit, IASA (the first frame an action can interrupt recovery).
- **Tests:** a jab 1-2-3 chain; a cancel window honoured on hit and refused on whiff when it says so; a cancel cycle
  without cost refused by the L0 gate.
- **Exit:** a chain plays in the Move Lab and the combo finder lists it.

### BL4.5 Aerials: landing lag and auto-cancel (S)

- **Exit:** an aerial landed in its auto-cancel window costs no lag. Outside it, it costs `landingLag`.

### BL4.6 Armor, intangibility, motion and turnaround (M)

- **Exit:** an armored move absorbs a blow under its threshold (taking the damage, without the launch). Intangible
  frames ignore hits. A lunge moves the body. A turnaround move hits behind.

### BL4.7 Charged smashes (S)

- **Exit:** holding the smash scales damage and growth to `damageAt` and `growthAt` at `maxTicks`, and the charge is
  visible.

### BL4.8 Move projectiles and command grabs (M)

- **Goal:** a hitbox frame can spawn a projectile (an existing projectile def), and a move can be a grab with its own
  throw.
- **Exit:** both work in a probe. The projectile's damage is attributed to the move in telemetry.

### BL4.9 Special skills as moves: `MoveScript` (L)

- **Goal:** design 5.3. Kits implement special slots through a hook, with frames, cost and tags in the sheet.
  Non-hitbox specials declare an effect budget (duration, area, damage per second, cooldown) for the analyser.
- **Files:** `fighters/kit.ts` (`moveScript?(slot): MoveScriptInstance`), `FighterSystem`, one kit converted as the
  pattern (Rusk's ram: it already has frames, damage and a cooldown).
- **Exit:** the ram is a `sspecial` with the same behaviour and measured numbers, and the analyser and CPU read it like
  any move.

### BL4.10 The CPU uses any move (L)

- **Goal:** design section 9.
  - `stockTactics.pickStrike` and `goIn` choose from the fighter's move list by hitbox coverage at the moment each
    comes out, safety on shield, and role tags.
  - The link table from BL3.3 drives follow-ups and juggles.
  - Specials go through their scripts.
- **Files:** `arena/ai/stockTactics.ts`, `arena/ai/brains/basic.ts`.
- **Tests:** `tests/ai-stock-tactics.test.ts` extended. Given a custom move list, the CPU picks the move that covers
  the target and is safe when the personality asks for safety; it follows a listed link.
- **Batch checks:**
  - CPU coverage: every move at least 0.5 times a fight-minute.
  - The behaviour gate holds: under 6 crossings a minute, under 35% airborne.
- **Exit:** the coverage check passes on all ten sheets.

### BL4.11 The Move Lab (XL)

- **Goal:** design 6.5.
- **Files:**
  - `src/lab/moveLab.ts`.
  - A dev render layer drawing hitboxes, hurtboxes, armor and intangibility per frame. It extends the runtime
    diagnostics overlay (`ui/diagnostics/runtimeOverlay.ts`).
  - Training-stage staging through the bridge (`stage`), with frame stepping on `ctx.time`.
  - A dummy controller: stand, shield, jump, influence, or a recorded input track.
  - The KO calculator, with an in-game check button.
  - The combo finder UI.
  - Before/after recording.
- **Probe:** `verify-lab-movelab.mjs`: author a move in a draft; frame-step to its active frame and see its box drawn;
  run the KO check; find a planted link.
- **Exit:** a new move can be created, previewed, measured and A/B-tested without leaving the Lab.

### BL4.12 Art for new moves (dependency, not Lab work)

Each new move needs poses. The Move Lab plays any move on the nearest existing pose (or the current one) until its art
exists. `docs/arena/platform-fighter/SPRITES.md` owns the pipeline; a move's sheet entry can name its pose set so missing
art is listed, not silent.

### BL4.13 Stale-move negation (M)

- **Goal:** D-018, a match rule, on by default.
- **Files:**
  - `config/stockRules` (rule data: queue length, scale per position, refresh rule);
  - the stock blow resolution (damage and knockback scaled by the move's staleness);
  - the HUD (an optional, subtle cue);
  - telemetry (each hit records its staleness factor);
  - the analyser (always FRESH values).
- **Order:**
  1. Built with the rule off: the equivalence batch must be identical.
  2. Turned on in its own change, with a full official-setup run that becomes the new baseline in the same commit.
- **Tests:**
  - A repeated move decays and refreshes as specified.
  - Projectiles and throws follow the rule's scope.
  - The power budget and the KO calculator ignore staleness.
- **Measure, in the change that turns it on:**
  - Blow concentration (the dominant-blow gate) before and after.
  - Match length.
  - The win-rate spread.
  - Any fighter whose rate moves more than its interval is re-tuned before the change merges.

---

## Phase 5. Review and matchups: understand (about 1 week)

### BL5.1 Run records, version 2 (M)

- **Goal:** design 5.4: blow events, combos, KO details, provenance and checkpoints, behind `detail: 'full'`.
- **Tests:** a record round-trip; the old reader still reads v1.
- **Exit:** a full-detail run costs under 15% more time than a summary run.

### BL5.2 Replay and seek (M)

- **Goal:** the bridge's `replay(spec, tick)` re-runs the spec with rendering on. Seeking fast-forwards headless to the
  tick, then renders.
- **Depends on:** BL0.3, proved deterministic.
- **Exit:** a replayed match reaches the same KOs at the same ticks as its record.

### BL5.3 The fight timeline (M)

- **Goal:** design 6.7: percent curves, blows by move, shields, dodges, grabs, KOs, a CPU mode lane; click to seek;
  a hitbox toggle.
- **Probe:** `verify-lab.mjs`: open a match, click a KO, and the iframe shows that moment.

### BL5.4 The matchup explorer (S)

- **Goal:** design 6.8, with the "why X beats Y" summary (the three largest usage and hit-rate differences).

---

## Phase 6. Gates and automation (about 1.5 weeks; BL6.2 early)

### BL6.1 Sequential tests and Bradley-Terry (M)

- **Files:** `tools/lab/analysis.mjs`: a per-fighter sequential stop rule for the runner; a Bradley-Terry fit
  (minorisation-maximisation, converged in milliseconds for ten fighters); strength intervals by bootstrap over matches.
- **Tests:** synthetic tournaments with known strengths are recovered within tolerance. The stop rule stops early on a
  clear case and never on a borderline one.

### BL6.2 The gate evaluator and `balance:smoke` / `balance:full` (M, after Phase 1)

- **Files:**
  - `tools/lab/gates.mjs`: contract and baseline in, a pass/warn/fail list out, written as markdown.
  - `package.json` scripts:
    - `balance:smoke`: a lab build; 90 pairs at Hard and at Expert, mirrored personalities rotating (180 matches);
      early stopping; gates; about 5 minutes on pages;
    - `balance:full`: L3 (2,160 matches at the official setup), then the lobby personalities, reported.
- **Exit:** smoke on `main` passes. Smoke with a planted overpowered draft (`stockBalance.mara-quell.dealt=1.6`) fails
  and names Mara.

### BL6.3 CI (M)

- **Workflow (D-020: strict, with waivers):**
  - Every build: the L0 and L1 gates (`tests/balance-static.test.ts` and the sheet-schema `--check`) fail the build.
  - On pull requests touching the fighters (`src/fighters/`, `src/content/fighters*`) or the arena, move or stock-rule
    code:
    `balance:smoke` is a **required check**. Its summary is the job summary; a fail-level gate blocks the merge.
  - Nightly, scheduled: `balance:full`; artifacts uploaded. A fail-level gate opens an issue and **blocks releases**
    (the release workflow reads the last nightly result) until fixed or waived.
  - **The only escape hatch is a waiver:** an entry in `balance/waivers.json` naming the gate, the fighter or move, the
    reason and an expiry date, reviewed like code. An expired waiver fails the build.
- **Determinism makes it fair:** the smoke uses fixed seeds and a frozen build, so a required check cannot fail at
  random (BL0.3 proves this; a non-deterministic result is a bug, not a retry).
- **Note:** the CI browser step has been red for unrelated reasons (`docs/PROBE-HEALTH.md`). Fix or quarantine it
  first, so a balance warning is not lost among old failures.

### BL6.4 Sensitivity sweeps (M)

- **Goal:** design section 7, L4. Per lever and per move's main numbers, plus and minus 10% against a fixed reference
  panel. The elasticity table is in the Lab; cliffs are flagged.
- **Exit:** the table for all ten fighters' Duel levers and their kill moves.

### BL6.5 Degenerate-strategy and loop detectors (M)

- **Goal:** design section 7, L4: blow concentration, spam at range, ledge camping, stalling, and repetition chains
  from blow events.
- **Tests:** planted runs (synthetic records) trip each detector.

### BL6.6 Identity fingerprints (S)

- **Goal:** each sheet's `identity.fingerprint` from `ROSTER-IDENTITY.md`, checked on every full run.
- **Exit:** the report lists each fighter's fingerprint ranks. The gate warns on a miss.

### BL6.7 Promote to baseline (S)

- **Goal:** the Lab button and the server endpoint. A full run that passes the gates becomes `balance/baseline.json`,
  with a changelog line.

---

## Phase 7. Later

- **BL7.1 Unblock the headless kernel (XL, only if BL0.5 found blockers).** Remove the browser-only dependencies BL0.5
  listed from the engine's simulation path, so matches run in Node worker threads. Target: 5-10 times the throughput, so
  the full matrix can become a pre-merge check. If BL0.5 already succeeded, this package is done.
- **BL7.2 Human match telemetry (M).** The live Duel writes v2 records (dev builds, opt-in). The Lab shows human against
  CPU usage and matchup tables once there are enough matches.
- **BL7.3 A hosted Lab (L).** Runs and drafts shared through the AuthorLink relay, per the original Tuning Lab idea.

## Testing strategy

| Kind | Where | Covers |
|---|---|---|
| Unit | `tests/lab-*.test.ts`, `tests/balance-*.test.ts`, `tests/fighter-sheets.test.ts` | Analysis maths, the schema, gates, the store, sheet round-trips, the engine rules of Phase 4 |
| Equivalence | the BL2.1 batch, re-run after every Phase 2 and Phase 4 package | No behaviour change from refactors |
| Probes, real clicks | `verify-lab.mjs`, `verify-lab-movelab.mjs`; the stock probes; `verify-duel-determinism.mjs` | The Lab's flows; the game unchanged |
| Bundle | `verify:builder-bundle` plus the lab check | Nothing of the Lab in a player build |

Probes click with real mouse events (CLAUDE.md), run against a frozen build, and never run while `src` is being edited.

## Risks

| Risk | Mitigation |
|---|---|
| **The CPU is the instrument.** A CPU weakness reads as a fighter weakness. | The behaviour gate in every layer; coverage; skill-gap tracking; the baseline is re-run after any CPU change; L5 human data when it exists |
| **Noise is read as signal.** Seeds alone move a fighter about 10 points at 72 matches. | Intervals everywhere; significance on every delta; early stopping that needs evidence; enough seeds per decision; never tune on one run |
| **Scope.** Ten screens and a moveset engine is a lot. | The milestones are independently useful. M1 and M2 alone make attribute work safe. |
| **The copy slips, and balance tooling waits with it** (D-021). | The interim routine ("Before the Lab") after every fighter change; the copy is the split's first, short step and the Lab's only dependency; the Lab starts the day it lands |
| **JSON sheets lose TypeScript comments that document numbers.** | The `notes` map in each sheet (field path to help text) carries them; the generated JSON Schema carries the type documentation into editors; the Lab shows both as field help |
| **Batches are slow on pages** (the official setup doubles them: two CPU levels). | BL0.5 measures the kernel route first; early stopping; smoke before full; a cache of runs by spec hash, so an identical spec is never re-run |
| **Required CI checks feel heavy.** | Deterministic seeds and frozen builds (no flaky failures); the smoke runs only on fighter, move and arena changes; waivers are the explicit, reviewed escape hatch |
| **A frozen build drifts from the source being edited.** | Builds are keyed by content hash and recorded in every run; the Lab shows "this run played build X, your source is now Y" |

## First steps

**Now, before the copy:** the interim routine after every fighter change. Nothing of the Lab is built yet.

**The day the split copies CLASHFORGED out (split phase 1), in the new repository:**

1. BL0.1 and BL0.4: register every root at boot; write the balance store from `confirm-final` and pass 1.
2. BL0.3 and BL0.5: prove determinism, and measure whether a match runs without a browser. This decides the runner.
3. BL0.2: extract the analyser library; prove a byte-identical report.
4. BL1.1: frozen lab builds. Every later batch, and every agent working in parallel, depends on them.
5. BL1.2 and BL1.3, then BL1.4-1.6: the MVP.
6. The first official-setup full run (Hard and Expert, mirrored rotation) as the new baseline.

Briefs for parallel agents go in `docs/arena/briefs/` as each package starts (`WORKFLOW.md` has the template).

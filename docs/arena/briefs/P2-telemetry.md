# P2-telemetry: record fights, run them in bulk, analyse them

**Goal (visible result).** `node scripts/fight-batch.mjs --gauntlet --fights 200 --url <vite>` runs 200 fighter-vs-foe fights in
the Proving Yard (no rendering, paused-step), writes `verify-out/fights/<runId>/`, and `node scripts/fight-analyse.mjs
<runId dir>` prints a report: per fighter damage per second, time-to-kill, damage by source and by ability, ability
uptime/uses/refusals, a movement profile, and a header with the **measured** ticks/second and replay-match rate.

**Worktree.** `Y:\Projects\alchemists-descent-worktrees\arena-telemetry` (branch `bw/arena-telemetry`, from `bw/fighters`).
Dev server for your probes: `npx vite --port 5201 --strictPort` from your worktree. Do not touch other worktrees or kill
processes you did not start. Run probes sequentially and never while editing `src` (HMR reloads the page).

**Read first.** `docs/arena/TELEMETRY-AND-BALANCE.md` (this is your spec; every file:line in it was verified on
2026-10-01), `docs/arena/MASTER-PLAN.md` 3 (P2), `docs/arena/TASKS.md` (T2.1-T2.8), `docs/arena/WORKFLOW.md`,
`docs/arena/TEST-PLAN.md`, `CLAUDE.md`, `docs/FIGHTERS.md`, `scripts/fighter-probe.mjs`, `scripts/verify-fighter-arena.mjs`,
`scripts/perf-harness.mjs`, `src/world/fighterArena.ts`, `src/content/fighterArena.ts`.

## You own (create)

- `src/fighters/telemetry/fightLog.ts` (schema v1, `FightRecorder`, columnar buffers), `src/fighters/telemetry/index.ts`
- `src/fighters/paramOverride.ts` (the `ParamOverrideApi` of TELEMETRY 3.5), its range table (`src/fighters/paramRanges.ts`),
  `window.__paramOverride` in the `main.ts` dev block, a console `ftune` command in `src/game/console/fighters.ts`
- `scripts/fight-batch.mjs`, `scripts/fight-analyse.mjs`, `scripts/fight-lib.mjs` (shared helpers: run dir, stats, Wilson,
  Bradley-Terry), `scripts/vite-plugin-fight-telemetry.mjs` (+ register it in `vite.config.ts` next to `authorLinkPlugin()`
  and add its output dir to `server.watch.ignored`)
- `tests/fight-log.test.ts`, `tests/param-override.test.ts`, `tests/fight-analyse.test.ts`, `scripts/verify-fight-record.mjs`
- `docs/arena/TELEMETRY-AND-BALANCE.md` updates (measured numbers; what you changed from the design and why)

## You may touch (small, named seams only)

- `src/entities/Enemies.ts` right after line ~645 (the damage lands): emit a **hit** event through the recorder (only when
  a recorder is installed; zero cost otherwise)
- `src/entities/Player.ts` right after `damage()` resolves (~666): emit a **hurt** event
- `src/fighters/FighterSystem.ts`: ability events in `tryTactical`, `tryUltimate`, `refuse`, `tacticalAgain`; the optional
  `tag` argument on `hurt(...)`; no other changes
- `src/game/Game.ts`: `advance(n, {render:false})`, a headless flag that idles `renderFrame`/clip capture, `resetForFight(seed)`
  (the recipe in TELEMETRY 3.3)
- `src/main.ts` (dev block) and `src/game/console/fighters.ts` for the hooks above
- `src/fighters/kits/*`: only to make `def.tacticalCooldown`/`def.ultimateDuration` overridable (getters or a registry the
  override API patches). Do not change any kit's behaviour or numbers.

## Must not touch

`src/arena/**` (another package owns it), `src/entities/Player.ts` movement code, `src/ui/FighterArenaPanel.ts` (another
package edits it; if you need a button, put a tiny `ui/TelemetryPanel.ts` and tell the integrator), the title menu, the looks.

## Contract to keep

- With no recorder installed every instrumentation site is a single null check; the game plays exactly as before. The
  classic Alchemist, the campaign and every existing probe stay green.
- Authoring-only (`__AUTHORING__`): nothing of this ships in a player build (`npm run build` for a player bundle must not
  pull the recorder: check the chunk list).
- No `Math.random` in `src/fighters` (lint-enforced); a seeded `Rng` where you need randomness.
- The schema carries `src` and `dst` fighter slot indices and a `brain` field from day one (PvP and bots drop in later).
- `ParamOverride`: out-of-range sets return false and change nothing; `apply` returns a restore function; always restore in a
  `finally`; fighter paths stay **out of** `listTuningPaths` / `tuningRanges` (they would break `verify:tuning-ranges --check`
  and the hosted relay table).

## Steps

1. **Measure first (T2.1).** A script that boots a Yard gauntlet in the paused-step regime and reports ticks/second (median
   of 5 runs of 3,000 ticks) with a fighter and a few foes, and the **replay-match rate**: run the same seed and scripted
   inputs twice and compare a state hash every 30 ticks. Print both. Everything else adapts to what you measure.
2. T2.2 `Game` additions. 3. T2.3 recorder + the four sites. 4. T2.4 `paramOverride`. 5. T2.5 `fight-batch` with a built-in
   **gauntlet driver** (a scripted brain: walk toward the nearest foe, aim with lead, fire the wand, kick when adjacent, press
   Z/T whenever ready; its own seeded `Rng`; pluggable through `window.__fightBrain` so the AI package can replace it).
   Scenarios: each of the ten fighters against `FOE_PRESETS` mixes at 3 seeds, a per-fight tick cap (default 3,600), a result
   (`cleared` / `died` / `timeout`). Reuse one page across fights and recycle it every N fights; restore overrides in a `finally`;
   `--workers N` (default 2, max 3). 6. T2.6 `fight-analyse` (pure Node, unit-tested with synthetic files). 7. T2.8 tests and the
   `verify-fight-record` probe. 8. T2.7 (the dev endpoint) last, only if time remains.

## Done when

- `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` clean.
- `node scripts/verify-fight-record.mjs <url>` passes (records one gauntlet fight, re-reads it, the totals match the
  `ctx.fighters.view` counters and the foes' hp changes).
- A 100-fight batch (10 fighters x 10 fights) completes with no page error and the analyser prints a report you have looked at
  and sanity-checked (do the damage numbers add up? does time-to-kill look plausible?).
- The report states ticks/second and the replay-match rate **measured**, and which tuning knobs you confirmed are overridable.

## Report back

Files created/edited; the measured numbers; what differs from the design in TELEMETRY-AND-BALANCE.md and why; anything not
verified; the seams another package must know about (the recorder API, `window.__fightBrain`, the override API).

# Arena programme: test plan

What proves each phase, and how to run it. Probes drive the real game with Playwright against a Vite dev server
(`CLAUDE.md` "Verification workflow"): real keys and clicks, never synthetic events; a **frozen worktree server** for
batches (editing `src` reloads a running page and fakes failures).

## 0. The gates every change must keep green

```bash
npx tsc --noEmit
npm run lint                                    # CI lints src, tests, scripts and vite.config.ts
npx vitest run                                  # 232+ files; the arena adds its own
npm run build
node scripts/verify-fighter-arena.mjs <url>     # the Proving Yard
node scripts/verify-title-menu.mjs <url>        # the title (incl. the Arena door)
node scripts/verify-fighter-roster-play.mjs <url>   # all ten through a real run (the engine-level fighter path)
```

The single-player game must be unchanged at every merge: for P1 and P3 that means the Alchemist control row of the physics
probe, `verify-fighter-framework`, `verify-fighter-run`, and a normal campaign start (`verify-fighter-ledger`).

## 1. Per phase

| Phase | Unit (Vitest, no DOM) | Probe (Playwright, real input) | Quantitative check |
|---|---|---|---|
| P1 bodies | `fighter-bodies.test.ts`: every value in range; the guard rails (no heavy+fast, no shared quartet); `NEUTRAL_BODY` = today's player | `verify-fighter-bodies.mjs`: each fighter runs 90 ticks, jumps once, falls once, takes one standard hit; per-technique probes | the measured speed, apex, fall speed and knockback distance **order the roster as `FIGHTER-PHYSICS.md` says**; the control unchanged within one tick |
| P2 telemetry | `fight-log.test.ts` (record/replay of events, columnar buffers), `param-override.test.ts` (get/set/apply/restore, ranges, `def` patching), `fight-analyse.test.ts` (known inputs -> known win rates, Wilson intervals, Bradley-Terry) | `verify-fight-record.mjs`: record one fight, re-read it, totals match the HUD | ticks/s and the replay-match rate measured and printed; a 200-fight gauntlet batch completes with no page error |
| P3 combatants | `arena-slots.test.ts`: bind/unbind restores every field; proxy sync; scoped bus delivers only to the bound slot; visibility invariant | `verify-arena-duel.mjs`: **every damage path once** (spell, kick, explosion, flame, liquid, rigid body, each kit effect), no self-hit, no double-hit, knockback both ways, a knockout ends the fight | zero hits counted twice in 1,000 scripted exchanges; the full existing probe battery green |
| P4 AI | `ai-intent.test.ts` (hand-made WorldViews -> expected goals), `ai-execution.test.ts` (seeded noise reproducible), `ai-playbooks.test.ts` (rule order), `ai-nav.test.ts` (the Yard's routes) | `verify-ai-*.mjs`: approach and hit a dummy; climb a slab; Brann plates a shooter; every fighter's brain uses its tactical in a 30 s fight; no idle > 2 s | 1,000-fight soak: no page error, no stuck bot, no fight past the cap; level 5 beats level 1 >= 85% |
| P5 rules | `match-director.test.ts` (stocks, timers, sudden death), `knockback-scale.test.ts` (volatility x mass x DI) | `verify-arena-match.mjs`: a stock match plays to the end; ring-out costs a stock; respawn platform; collapse | mirror test: swapping sides moves win rate by < noise (Wilson interval) |
| P6 movesets | `fighter-loadouts.test.ts` (no two equal; all cards valid) | per-primary probes | the fingerprint metrics of the roster hold |
| P7 balance | `balance-patch.test.ts` | `verify-balance-smoke.mjs` (a 20-fight matrix) | the targets in `TELEMETRY-AND-BALANCE.md` 1 |

## 2. Probe hygiene (hard-won on this project)

- Boot into the Yard through the real title (`#expedition-entry [data-entry="arena"]`) or `run test --level fighter-test
  --world campaign-level`; clear loot and close the card-offer modal before pressing keys.
- Aim **is** the facing: set `ctx.input.mouse` and `player.aimAngle`, not `player.facing`.
- A panel button must not take focus (`mousedown` preventDefault), and the probe's click must `scrollIntoViewIfNeeded` (the
  panel scrolls; Playwright's "visible" ignores overflow clipping).
- Painted Fire cells die at once: give them `life` and `world.activity.touchIndex` to ignite gunpowder.
- Run probes **sequentially**; never while editing `src`; one Vite server per worktree on its own port; do not start a batch
  when the machine is low on memory.
- A fresh Edge profile per probe (`launchBrowser`); `localStorage.clear()` in an init script for a fresh profile.

## 3. What the telemetry adds to testing

Once P2 lands, every probe that plays a fight can also record it, and a failing balance assertion links the fight file. The
report header always carries: git commit, dirty flag, schema, overrides, ticks/s, regime, browser. A result without its
header is not evidence.

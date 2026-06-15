# Developer Console Run Workflow

The built-in Developer Console is the canonical way to inspect, reset, save,
and start play sessions. Do not ask users to clear `localStorage`, run browser
DevTools snippets, or mutate `window.__game.ctx` directly for normal run
workflow tasks. If a missing workflow requires browser DevTools, add or extend
a Developer Console command first.

## Canonical Commands

- `run status` reports the active mode, level, seed, save presence, autosave
  eligibility, player position, and whether the run is disposable or
  debug-tainted.
- `run continue` resumes the current expedition runtime or saved expedition.
- `run new [--seed n]` clears the saved expedition and live run state, then
  starts normal progression at D1 with a fresh starter kit. Do not use this for
  cards, perks, boosted vitals, or prefilled flasks.
- `run test [--level d3] [--seed n] [--loadout fresh|advanced|review]`
  starts a disposable test run. Test runs set `playtestSource: "test"` and
  never overwrite expedition saves. Add granular setup options such as
  `--gold 250`, `--hp 140`, `--max-hp 160`, `--levit 180`,
  `--cards spark,bomb`, `--perks torchbearer,swiftfoot`, and
  `--flask water:300`.
- `run test --world virtual-world` starts the chunked virtual-world prototype
  as a disposable materialized test window. It is intentionally not persisted
  until streaming and save support are implemented.
- Loadout and granular setup flags are Test Run-only. `run new --gold ...`,
  `run new --loadout ...`, `run new --cards ...`, and similar commands should
  fail rather than creating a normal expedition with hidden debug-taint.
- `run save` checkpoints the current normal, untainted expedition.
- `run abandon` removes the saved expedition. Use `run new` when the live
  runtime should also be reset.

The Play launcher uses the same `Levels.startRun` API as these commands. Normal
launcher runs expose only the progression-safe options; Test Run unlocks world,
level, profile, card, perk, vitals, flask, and virtual-world controls. Any
future launcher option must have an equivalent Developer Console command path,
and any future console command that affects run lifecycle must route through
the same API rather than reimplementing persistence behavior.

Fullscreen Play also routes through the launcher. If a run must be selected
first, the launcher starts the chosen run and then resumes the fullscreen
request path from the same user action.

## Agent Rule

When debugging reports about resume position, new-game behavior, test worlds,
world selection, save state, or progression setup, start with `run status` in
the in-game Developer Console. Use the browser developer tools only for
emergency inspection after the console surface has been ruled out or extended.

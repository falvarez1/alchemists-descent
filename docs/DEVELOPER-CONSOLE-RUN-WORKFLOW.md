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
  starts normal progression at D1 with a fresh starter kit.
- `run test [--level d3] [--seed n] [--loadout fresh|advanced|review]`
  starts a disposable test run. Test runs set `playtestSource: "test"` and
  never overwrite expedition saves.
- `run test --world virtual-world` is reserved for the chunked virtual-world
  runtime. The Builder World Map panel can preview this world today, but Play
  mode materialization still needs to land before this command can start it.
- `run save` checkpoints the current normal, untainted expedition.
- `run abandon` removes the saved expedition. Use `run new` when the live
  runtime should also be reset.

The Play launcher uses the same `Levels.startRun` API as these commands. Any
future launcher option must have an equivalent Developer Console command path,
and any future console command that affects run lifecycle must route through
the same API rather than reimplementing persistence behavior.

## Agent Rule

When debugging reports about resume position, new-game behavior, test worlds,
world selection, save state, or progression setup, start with `run status` in
the in-game Developer Console. Use the browser developer tools only for
emergency inspection after the console surface has been ruled out or extended.

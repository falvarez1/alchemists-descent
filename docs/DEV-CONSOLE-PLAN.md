# The Dev Console — implementation plan (QA ticket #9)

**Status: PROPOSAL — drafted June 2026, revised same day after the 3-VP panel
review** (1 Critical + 5 High findings, all code-verified, all folded in —
see Review Summary at the bottom). A Quake/Minecraft-style in-game
developer console: a slide-down command line over the game, backed by a typed
command registry that doubles as the **stable automation API for every
headless probe**. The probes today poke `ctx.world.types` and private fields
by hand; each new probe re-learns the same gotchas (cell ids, headroom,
sim-window freezing). Commands centralize that knowledge once, with structured
results.

## Why (in priority order)

1. **Test automation.** `ctx.console.exec('spawn golem 2 ~ ~')` returning
   `{ ok, text, data }` gives playwright probes a versioned, typed surface.
   Scenario scripts (lists of commands) become repeatable repro cases.
2. **QA velocity.** The debugging moves that every session reinvents —
   teleport, paint cells, spawn, level jump, params live-tune, region ASCII
   dump, perf record — become one keystroke away **inside the game**.
3. **Player-facing later, maybe.** Cheats/sandbox commands are a genre
   tradition; nothing here precludes shipping a curated subset.

## What exists today

- `src/ui/ConsoleOverlay.ts` — Backquote opens the Quake-style typed console;
  the old DebugConsole god-kit hook has been removed.
- `window.__game.ctx` — the raw probe handle (stays; console is sugar on it).
- `window.__perfRecord` / `__perfSamples` — perf sampling hook.
- `core/telemetry.ts` — local counters, `all()` dump.
- The probe-script gotcha lore in CLAUDE.md + the project skill.

## Architecture

**Registry and shell are separate modules.** The registry is pure logic that
systems and probes call; the overlay is one of its clients (events outward,
calls inward — the registry never touches the DOM).

```
src/game/console/registry.ts   ConsoleCommandRegistry: parse, dispatch, complete
src/game/console/commands.ts   Console command definitions (handlers close over ctx)
src/ui/ConsoleOverlay.ts       Quake shell: slide-down panel, log, input,
                               history, completion UI (replaces DebugConsole.ts)
```

The console registry is the headless command executor and automation adapter.
It must not become a second UI command framework beside the Builder workspace
command system in `docs/BUILDER-LIVE-UI-SPEC.md`. The long-term command
contract is shared and namespaced:

- `console.*` for overlay/history/completion commands.
- `game.*` for runtime QA commands such as spawn, level, teleport, perf.
- `builder.*` for document-authoring commands.
- `workspace.*` for panels, docks, overlays, focus, and layout.

Phase 1 may ship with a local console registry, but it should expose command
metadata in the same shape expected by the future editor `CommandRegistry`
(`id`, `label`, `category`, `shortcut`, `enabled`, `run`). When the Builder UI
framework lands, the console overlay and the Builder command palette should
consume one shared command catalog instead of maintaining parallel shortcut and
menu wiring.

- `ctx.console: ConsoleApi` (types.ts append) —
  `exec(line): Promise<CommandResult>` (ALWAYS a promise, even for sync
  handlers — one calling convention for the overlay and every probe),
  `complete(partial): string[]`, `list(): CommandInfo[]`.
- `CommandResult = { ok: boolean; text: string; data?: unknown }` — `text`
  for the overlay log, `data` for probes. **Handlers must populate `data`
  with the facts a probe would otherwise scrape** (spawned entity ids,
  resolved coords, dumped cells).
- Command handlers receive `(ctx, args)` and call existing Ctx APIs only
  (`ctx.enemyCtl.spawn`, `ctx.levels.enterLevel`, `ctx.params`...). No new
  gameplay capability lives in a handler; if a command needs new behavior,
  the behavior goes in the owning system first.
- **No `eval`.** A raw JS line is what the browser console is for. Cut.

### Argument grammar (Minecraft-flavored)

- `~` / `~±n` = relative to player (cursor in build mode); bare ints/floats.
- Typed parsers resolve names: `cellType` ("lava" → 11, accepts ids too),
  `enemyKind` (ENEMY_DEFS keys), `cardId`, `levelId` ("d4", "vault"),
  `paramPath` ("global.ambient", "materials.lava.bloomWeight").
- Parse errors return `ok: false` with the expected signature — same string
  the probe sees, same string the overlay prints.

### Keyboard claim (the landmine)

**`InputManager.onKeyDown` has NO text-entry guard** (verified): typing in
any input fires game keys. The overlay must therefore claim the keyboard the
way the Builder does — a capture-phase listener on `window` while open,
`stopPropagation` for everything except its own handling, plus
`stopPropagation` on the root element. The claim covers BOTH `keydown` AND
`keyup` (a swallowed keyup with a passed keydown sticks `ctx.input.keys.*`
true). On open, force-clear all held input flags exactly as
`InputManager.setMode` does (`keys.left/right/jump/down`, `siphonHeld`,
`pourHeld`, `drinkHeld`) — otherwise opening the console mid-keyhold leaves
the wizard running while you type. The Phase 1 probe includes the hold case:
hold W, press Backquote, release W, type — the player must not move.

The Backquote toggle keeps the console overlay's `isTextEntry` guard: it is inert
while focus is in any INPUT/TEXTAREA/SELECT/contentEditable other than the
console's own input (today's behavior — a backtick typed into a Builder name
field must not pop the console). Inside the console's own input, Backquote
closes. ESC closes WITHOUT touching `ctx.state.paused` (PauseOverlay owns
pause claims — the console must not fight it; it stays open across
pause/unpause). The console does **not** pause the game: QA wants to watch
commands land live. `pause` is just a command.

### Command set

**Phase 1 (core 10):** `help [cmd]`, `god` (today's kit + toast),
`tp <x> <y>`, `spawn <kind> [n] [x y]`, `give <gold|heart|tome|card> [arg]`,
`kill [all|radius n]`, `cell <material> [radius]` (paint at cursor/player),
`level <id>`, `set <paramPath> <value>` / `get <paramPath>`, `clear` (log).

**Phase 2:** `fill <x0> <y0> <x1> <y1> <material>`, `dump <x> <y> <w> <h>`
(the region ASCII dump that diagnosed the sumpgate bug — as a command, with
`data` = the raw type grid), `time <simSpeed>` (writes the existing
live-tunable `global.simSpeed` param only — the two-clock contract is
untouched; the accumulator already consumes that dial), `heal`, `gold <n>`,
`gpu <on|off|toggle>`, `perf <on|off>`, `perfrec <frames>` (returns the
bucket stats as `data`), `tele` (telemetry dump), `pos`
(player/camera/level readout), `find <pickup|mechanism|portal>` (nearest-of,
with coords — the "where is the key" QA question). **Gated out of Phase 2:**
`seed <n>` requires a reseed API on the owning system (`LevelsApi`/worldgen)
that does not exist, and its semantics need deciding (regenerate current
level vs. next expedition) — it ships only after that API lands, without
blocking Phase 3.

**Phase 3 (automation):** `exec <name>` — run a named script (newline
command lists in `localStorage` `noita-console-scripts`, importable via the
overlay); `assert <paramPath> <op> <value>` — returns ok/fail for script
gating; `count <material> [x y w h]` — a read-only material census helper for
probe setup/readback; structured-result contract documented in this file;
**migrate two real probes** (the probe-archetypes arena rig and probe-vault's
gold-counting setup are the candidates) to prove the API earns its keep, plus
`scripts/verify-console.mjs` (the console's own gate).

Phase 3 automation contract:

- `localStorage["noita-console-scripts"]` is JSON object storage:
  `{ "smoke": "set global.simSpeed 0.9\nassert global.simSpeed == 0.9" }`.
  Values may be a newline string or an array of command strings. Script names
  normalize to lowercase `a-z0-9._-` ids so probes and imported files use the
  same lookup.
- `exec <name>` loads that script, ignores blank/comment lines (`#` or `//`),
  runs each line through `ctx.console.exec(...)`, and stops on the first
  `ok:false`. Its `data` is `{ code, name, commands, results }`; failures add
  `{ lineNumber, line }` for the failed command.
- `assert <paramPath> <op> <value>` is read-only and supports `==`, `!=`, `>`,
  `>=`, `<`, `<=`, and `includes`. Its `data` is `{ code, path, op, expected,
  actual }`; failed assertions intentionally return `ok:false` so scripts can
  gate later commands.
- `count <material> [x y w h]` uses the same read-target policy as `dump`.
  It returns `{ target, material, requestedBounds, bounds, count }` and never
  exposes Builder Author terrain under a fake `sandbox` target while Builder
  is open.

**Phase 4 (polish, optional):** `watch <paramPath>` pins live values to a
HUD corner; `bind <key> <command...>`; toast/JS-error mirroring into the
log; `screenshot` (async, rAF readback — the parity-probe pattern).

Phase 4 polish contract:

- `watch <paramPath>|list|clear` stores canonical param paths in
  `localStorage["noita-console-watches"]`. The overlay renders a compact
  read-only watch HUD by polling `get <path>`; watches are editor preferences,
  not document or expedition state.
- `bind <F4-F10|F12> <command...>|clear|list` stores console-local shortcuts in
  `localStorage["noita-console-binds"]`. This is intentionally narrow and
  transitional: no movement/tool keys, no Builder command ownership, no final
  Keymap design. The future workspace `Keymap` should replace this listener.
- Toast and browser JS error mirroring append diagnostic lines to the console
  log but do not change gameplay state.
- `screenshot` waits one animation frame, copies the current game canvas into a
  temporary 2D canvas, and returns `{ width, height, type, dataUrl }` for
  probes. It does not write files or touch renderer internals.

### Overlay UX

Backquote slides a half-screen monospace panel from the top in Play and
Sandbox (over the map/game viewport, `pointer-events: auto`, viewport keeps
rendering). In Builder, the same console surface should first integrate as a
dockable bottom/floating workspace panel when the docking shell from
`docs/BUILDER-LIVE-UI-SPEC.md` exists; until then, the temporary slide-down
overlay is acceptable but must be treated as transitional UI. Log = scrollback
where the command ECHO is dim and the RESULT renders bright (the result is the
payload QA reads — `pos` coords must not be the dim part); errors red; text
selectable (`user-select: text`) for pasting into bug reports. Input line at
the bottom; ↑/↓ history (localStorage, 100 entries) that PRESERVES the
half-typed draft when you arrow away and back. Tab completion cycles in-place
through candidates (command names first, then the typed-arg candidates —
cell/enemy/level names); Shift+Tab cycles backward; the candidate list renders
as a one-line hint row above the input, never a popup. A header CONSOLE button
(the PERF/GPU FX family, lit while open) mirrors Backquote — discoverable, and
the layout-safe fallback for non-US keyboards where `Backquote` is a dead key.

Mode-agnostic: works in Sandbox, play, AND while the Builder is open.
Builder's capture-phase handler must yield when the console is open — one
guard line at the top of Builder.onKeyDown, same pattern as its existing
B/M/H shields. The guard checks console visibility the way PauseOverlay
checks `#help-overlay` (a DOM `classList.contains` probe), so Builder gains
no import. **This DOM guard is a transitional implementation detail.** The
Builder live workspace end-state is centralized focus ownership through the
shared `Keymap`/workspace focus manager: console input, modals, command
palette, text fields, help, and pause overlays all preempt Builder shortcuts
through one priority system. The guard is still mandatory until that exists:
Builder and the console both listen capture-phase on `window`, and
`stopPropagation` does NOT silence other listeners already attached to the
same node — without the guard, Builder's Tab/ESC/Q/E handlers still fire under
the console.

### Builder Live Workspace compatibility

The console must cooperate with `docs/BUILDER-LIVE-UI-SPEC.md`; it should not
define a parallel UX architecture.

- **One command model:** console commands and Builder/workspace commands share
  one command metadata shape and namespaces. `ctx.console.exec(line)` remains
  the string-command automation API, but parsed commands should map onto the
  shared command registry where possible.
- **One keymap/focus owner:** the Phase 1 DOM guard is acceptable only before
  the editor `Keymap` exists. Once the workspace shell lands, the console
  registers as a high-priority focus surface instead of asking Builder to check
  DOM visibility.
- **Presentation by mode/session:** Play and Sandbox use the slide-down
  overlay. Builder uses a dockable bottom panel by default, can float by user
  choice, and should not cover the map/game viewport as a persistent panel.
- **Explicit command target:** world-mutating commands must resolve a target
  before they run: `sandbox`, `expedition`, `builder-document`,
  `builder-live-preview`, or `builder-playtest`. Ambiguous commands return
  `ok:false` with the available target choices.
- **Builder document mutations go through Builder commands:** commands that
  intentionally edit `EditorDocument` must call Builder-owned commands so undo,
  validation, selection, layers, and dirty state stay coherent. Raw
  `ctx.world` writes are allowed for Sandbox/expedition/playtest QA, not as a
  back door into authored source data.
- **Builder playtest is not normal Play:** commands inside a Builder playtest
  target the disposable custom runtime unless the user explicitly targets the
  saved Builder document. They must not trigger expedition autosave or level
  progression assumptions.
- **Live preview is disposable:** console commands may inspect live-preview
  state; destructive commands require an explicit `builder-live-preview`
  target and never bake changes back to the document.
- **Workspace output:** command logs, watches, and pinned values should be
  routeable to the Builder bottom dock/status area once the dock system exists.

Session policy:

| Command family | Sandbox | Play/expedition | Builder Author | Builder Live Preview | Builder Playtest |
|---|---|---|---|---|---|
| Read-only (`pos`, `dump`, `get`, `tele`, `perf`) | allowed | allowed | allowed against selected target | allowed | allowed |
| Runtime mutation (`tp`, `spawn`, `kill`, `give`, `level`) | allowed when meaningful | allowed and taints | blocked unless explicit preview/playtest target | allowed only as preview mutation | allowed on disposable runtime |
| Cell mutation (`cell`, `fill`) | writes live sandbox world | writes expedition world and taints | document edit only through Builder command, else blocked | explicit preview mutation only | writes disposable playtest runtime |
| Param tuning (`set`, `get`, `time`, `gpu`) | allowed, untainted unless gameplay-mutating | allowed, untainted unless gameplay-mutating | allowed for editor/runtime params with command metadata | allowed | allowed |
| Builder authoring (`builder.*`) | blocked | blocked unless Builder document is open | allowed through Builder commands | allowed only for non-destructive view/session changes | allowed only for return/restart/bake/inspect commands |

### Safety rails

- **Taint disables expedition persistence**: `saveExpedition` early-returns
  for god-tainted runs (`Levels.ts:333`) — that IS today's god-kit policy
  and it stays. Because of that, the taint is TIERED: gameplay-mutating
  commands (`god`, `tp`, `spawn`, `give`, `kill`, `cell`, `fill`, `level`,
  `heal`, `gold`) set `ctx.state.debugGodMode`; params live-tuning
  (`set`/`get`) does NOT taint — it is the same mutation the PostFx dev
  panel already performs untainted. The first gameplay-mutating command in a
  clean run logs a "this run will no longer autosave" line. Read-only
  commands (`pos`, `dump`, `get`, `tele`, `perf`) never taint.
- Builder documents are NOT touched by raw console world commands. The Builder
  owns its document; any command that edits authored source data must execute a
  Builder command and be undo/validation/layer aware. `cell`/`fill` default to
  the active live runtime target, never the document. For legacy/transitional
  world-writing commands, emit a typed `worldEdited` EventBus event so Builder
  can mark any live-world divergence while open. Events outward; no Builder
  import.
- `spawn` count cap (32/command), `fill` area cap (the Builder's 150k-cell
  paint budget, reused) — a typo must not freeze the tab.

## Phases (each shippable, in order)

1. **Registry + shell.** `ConsoleApi` on Ctx, registry with typed parsers,
   the 10 core commands, the overlay (open/close/log/history), Backquote
   rebind (god kit becomes `god`), keyboard claim verified by a real-click
   probe (type `wasd` with console open → player must not move), command
   metadata shaped for the future shared Builder/workspace command catalog.
2. **Full command set + completion.** Tab completion, `dump`, params
   get/set, the QA readouts, explicit target resolution for world-mutating
   commands in Sandbox/Play/Builder Author/Live Preview/Playtest.
3. **Automation surface.** Scripts, `assert`, the probe migrations,
   `verify-console.mjs` joins the battery, contract docs.
4. **Polish.** `watch`, `bind`, error mirroring. Only if 1-3 prove out.

## Acceptance gate

- `npx tsc --noEmit`, `npx vitest run` (registry parse/dispatch/complete unit
  tests — the parsers are pure functions, test them hard), `npm run build`,
  `npm run lint`, `npm run verify:findability` (must be untouched).
- `scripts/verify-console.mjs`: real-click + typed-text probe — open/close,
  command round-trips with `data` asserts, **input isolation** (the wasd
  test), history, completion, Builder-open coexistence, target resolution
  matrix, god-kit parity with the old Backquote behavior.
- Builder compatibility probes: console open while Builder Author is active
  must preempt Builder shortcuts; header Play remains the normal game escape
  hatch; `cell`/`fill` in Builder Author must either route through a Builder
  document command with undo or fail with an explicit target-choice error;
  `cell`/`fill` in Builder Playtest may mutate only the disposable runtime.
- Existing battery unchanged: probe-anim, verify-builder, verify-sprites
  (the console must be inert while closed — zero per-frame cost).
- Frank eyeball: feel of the slide-down in Play/Sandbox, docked/floating
  behavior in Builder, font size, log readability.

## Risks / open questions

- **Backquote muscle memory**: today it god-modes instantly; after Phase 1 it
  opens the console (then `god⏎`). Toast on first open explains. If that
  grates, `god` can auto-run when the console opens dead — Frank's call.
- **Key binds vs game keys** (Phase 4): binds must consult InputManager's
  reserved set; deferred until needed.
- **Async commands** (`perfrec` in Phase 2, `screenshot` in Phase 4): exec
  always returns a Promise; the overlay prints "…" then replaces it with the
  result; the input line stays live while a command runs.
- **Parallel sessions**: Phase 1 can stay low-collision by keeping registry
  and commands new, with Game.ts/types.ts/Builder.ts as the only mandatory
  shared touches. Once the Builder workspace shell lands, console integration
  must deliberately touch the shared editor command/keymap layer instead of
  preserving a parallel registry forever.

## File map

| File | Change |
|---|---|
| `src/game/console/registry.ts` (new) | ConsoleCommandRegistry, parsers, completion, shared command metadata adapter |
| `src/game/console/commands.ts` (new) | console/game command definitions with explicit target policies |
| `src/ui/ConsoleOverlay.ts` (new) | the Quake shell (replaces DebugConsole.ts); transitional overlay until dockable workspace panel exists |
| `src/ui/DebugConsole.ts` | deleted (god logic moves into the `god` command) |
| `src/core/types.ts` | `ConsoleApi`, `CommandResult`, `ctx.console` |
| `src/core/events.ts` | `worldEdited` event (transitional live-world writes → Builder divergence/dirty handling) |
| `src/game/Game.ts` | wire registry + overlay |
| `src/builder/Builder.ts` | transitional yield-guard line in onKeyDown + `worldEdited` subscription |
| `src/ui/editor/CommandRegistry.ts` | future shared command catalog; console registers/adapts into it when Builder workspace lands |
| `src/ui/editor/Keymap.ts` | future shared focus/keymap owner; replaces DOM visibility guards when available |
| `index.html` | header CONSOLE button (PERF/GPU FX family) |
| `src/styles/main.css` | console panel styles; later workspace dock/floating panel styles |
| `tests/console.test.ts` (new) | parser/dispatch/completion units |
| `scripts/verify-console.mjs` (new) | headless gate |

## Pointers

- Keyboard-claim precedent: `Builder.ts` capture-phase onKeyDown + root
  stopPropagation; pause-claim etiquette: `PauseOverlay.ts` header comment.
- Probe gotchas the commands should encode in their `data` results: real cell
  ids, 17-cell player height/24-cell headroom on `tp`, sim-window freezing on
  far `spawn` (CLAUDE.md + project skill).
- House precedent for this doc: `docs/GPU-COMPOSE-PLAN.md` (ticket #8 shipped
  from it in one session).

## Review Summary

Reviewed 2026-06-12 by the 3-VP panel (Product / Engineering / Design via
plan-review-skill); every finding was code-verified before consolidation.
1 Critical + 5 High, all applied; 4 recommended Mediums applied.

### Changes applied

| # | Change |
|---|---|
| C1 | Autosave claim was FALSE (`saveExpedition` early-returns on `debugGodMode`, Levels.ts:333) → tiered taint: gameplay commands taint, params `set`/`get` don't |
| H1 | Keyboard claim now covers keyup + force-clears held input flags on open; probe gains the hold-W case |
| H2 | `paintDirty` claim was FALSE (Builder only sets it from its own actions) → `worldEdited` EventBus event, Builder subscribes |
| H3 | `seed` gated on a real reseed API; `time` scoped to the existing `global.simSpeed` dial; `screenshot` moved from risks into Phase 4 |
| H4 | Backquote toggle keeps ConsoleOverlay's `isTextEntry` guard (focus-steal regression) |
| H5 | Builder yield-guard mechanism specified (DOM visibility check); same-node capture-listener fact documented — the guard is mandatory, not defensive |
| M | `exec` always returns `Promise<CommandResult>`; Tab-completion + history-draft interaction spec'd; result lines bright / echo dim + selectable text; header CONSOLE button (also the non-US-layout fallback — the Shift+Backquote line was wrong and is gone) |

### Unresolved (deliberate)

- [ ] Backquote muscle memory (`god` autorun on dead-open?) — Frank decides at the Phase 1 eyeball
- [ ] Remaining Mediums/Lows (mock-Ctx test strategy, scrollback cap, watch-corner reservation, error-data hints) — implementer's discretion, listed in the panel transcript

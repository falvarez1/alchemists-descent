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
- `run test --flasks water:450,acid:200 --active-flask 2` configures the
  Noita-like potion belt. `--flask material:count` remains a slot-1 shortcut
  for older scripts.
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

## Opening the console, and what gates it

The console is an authoring tool, not a player feature.

- **Who has it.** `__AUTHORING__` (a compile-time constant, `vite.config.ts`) is true in
  `npm run dev` and in `npm run build:authoring`, false in `npm run build` (the public
  player build, the one Cloudflare Pages serves). Only when it is true does `Game` construct
  `ConsoleOverlay` (the backtick key, the header CONSOLE button) and the runtime inspector.
  `window.__game` is dev-only as well. The player build has no way to open the console.
- **The `ctx.console` API itself** exists in every build (the command set is a lazy chunk). In
  a player build its only caller is an AuthorLink `cmd` message from a peer that joined the
  same room (`?link=<room>`, with the relay's origin allowlist and write token).
- **The travel commands below are stricter than that:** they, `seq` and their help text are
  registered under `if (__AUTHORING__)`, so the player bundle does not contain them at all.
  `npm run build && npm run verify:console-bundle` scans every chunk for their text and fails
  if the play build carries any (and, on an authoring build, fails if they are missing, so the
  check cannot pass by looking at nothing).

## Help

`help` or `?` prints every command, grouped, one line each (name, arguments, what it does):
Run & levels, Player, World & cells, Story, Debug & perf, Console. A red **taints** badge marks
the commands that turn the run into a test run. The console says how to get it when it first
opens (`help (or ?) lists the commands; Tab completes them`).

- `help <command>` (or `? <command>`): the full usage, aliases, what it touches and examples.
- `help <group>`: one group (`runs`, `player`, `world`, `story`, `debug`, `console`).
- `help find <word>`: search names, summaries and usage.
- `help taint`: what a test run is.

The structured result keeps `data.commands` (the `CommandInfo` list, now with `group`,
`aliases`, `taints`) for probes; `data.rows` is what the overlay lays out. The facts live in
`src/game/console/help.ts` (and `travelHelp.ts` for the travel commands); a test fails if a
registered command has no group, summary or example.

## Travel and tester commands

Every one of these works inside the run that is already going (its kit, boons, phials, tier
and counters are kept), through the game's own code, and leaves the run **tainted**, except the
ones marked *reads*. They need a run in progress: from the title, the Sandbox or a Builder
playtest they answer with the command that starts one (`run new`, `run test --level d3`).

| Command | What it does |
| --- | --- |
| `levels` | *reads.* Every level: floor, biome, boss, which doors lead where; marks where you are and what is built this run. |
| `goto <level\|floor 1-4\|next\|prev> [--at spot] [--seed n] [--fresh]` | Travel through the real transition: curtain and arrival banner, arrival grace, level persistence, the findability repair, story hooks. A level not built yet is built from the run seed exactly as the descent would; a visited one keeps its world. `--seed n` / `--fresh` rebuild it (from `n`, or the run seed). `--at spawn\|portal\|boss\|camp\|waystone\|valve\|key` puts you there on arrival. A floor number, `next` and `prev` pick the door this run took on that floor, else the first; name the other door by id (`d2b`, `d3b`). Works with the Sanctum open and after a death (you get up at the new level's spawn). |
| `skip [--no-sanctum] [--door id]` | Take this floor's exit the way the portal does: the real Sanctum opens (boon draft, shop, door choice, the phial pour) and you descend when you close it. `--no-sanctum` has the Sanctum strike its first boon and take the door for you, through the same code, then waits for the arrival. On the Kiln Heart it ends the descent as a victory (like `win`). Alias `descend`. |
| `sanctum [floor 1-3]` | Open the Sanctum as if that floor had just been finished; with a floor number, goes there first. |
| `portal` · `camp` · `echo` | Teleport beside the exit portal, to Pell's camp, to the floor's resonant valve (the memory echo); on footing with headroom, never inside rock. |
| `boss [kill]` | Teleport to the floor's guardian; `boss kill` fells it through the real death path (drops, toast; the Colossus plays its death sequence and starts the Kiln escape). |
| `key` | Collect the floor's golden key through the code a walk-over uses, so the portal wakes (D1: the brass bell; its lower gate also wants the engine's bell rung, so use `skip` there). |
| `waystone [tp\|light] [n]` | Go to a waystone (default the nearest unlit), or light it through the real ignition (gong, embers, full vitals; the respawn anchor moves). |
| `phials [0-3]` · `boon [id]` · `kit [id]` · `tier [1-4]` | With no argument they *read* (phials; the boon list with what you hold; the kits; the tier). With one they set: phials through RunDirector; a boon through the Sanctum's own code (`boon vitality` is the +30 HP one); a kit resets wands, satchel and flasks to that kit's starting hand; the tier changes foes and penalties from now on (floors already built keep their foes). |
| `seed` | *reads.* The run seed and every level's seed. A run's seed is fixed when it starts: `run new --seed n` starts over on one, `goto <level> --seed n` rebuilds one floor. |
| `win` · `lose` | End the run through RunDirector. `win` raises the same `runComplete` the top of the flue does (no escape, no ending plates); `lose` empties the phials and dies through the real death path (god mode is turned off first). Both show the real death screen / ledger. |
| `respawn` | Get up after a death (the R key's action). |
| `seq <cmd; cmd; ...>` | Run commands in order, each after the one before it finished (a travel completes before the next line), stopping at the first failure. `seq goto d3; key; portal`. Quote a `;` you need inside an argument. |

Tab completes level ids, floor numbers, `next`/`prev`, `--at` spots, boon and kit ids, tiers and
`--door` ids; `seq` completes the command after the last semicolon.

### What skipping floors does to the run

- `goto` awards nothing: no boon, no phial pour, no shop visit, no gold. The ledger's route and
  deepest floor follow the arrival as usual (the first door reached on each floor), so a practice
  ledger may show floors you only visited by console. Phials change only when a death spends
  one or a Sanctum visit (`skip`, `sanctum`) pours one, exactly as in play.
- Deaths cost what they cost: `goto` after a death does not spend another phial.
- Combat state is cleared on every transition (`Levels.enterLevel`), and each arrival gets its
  grace period, so a probe that presses keys right after a `goto` still waits out the grace.
- Generation is synchronous: a first visit takes about 2.5 to 4 s behind the curtain (measured;
  see the probe), a revisit a few ms. The findability repair settles about 12 s after any
  arrival, and a probe that needs the settled floor waits for `ctx.levels.findabilityReady`.
  The floor is not still then: exposed powder seams drain for minutes, so later checks (18 s
  to 3 min of sim time, each carving only on an error) keep repairing. A probe that judges
  reachability steps a fixed sim window in manual time and counts only an error that holds for
  the whole window (`verify-findability.mjs`), never one sample at whatever step it reached.

### Test runs ("taint")

The first tester command marks the run as a test run, the same mechanism `god` and `tp` already
used (`ctx.state.debugTainted`, read by `Levels.runStatus().autosaveBlockReason`, `RunDirector`
and the story). While a run is tainted:

- **No autosave.** `Game.step`'s 30-second autosave and every checkpoint refuse
  (`autosaveBlockReason: 'debug-tainted'`), so a cheated expedition never overwrites the real
  saved one. `run save` refuses too.
- **No ledger credit.** A victory or a fall is shown as a practice descent ("A practice descent:
  debug tools were used, so the ledger keeps no record"; the share line ends `practice run
  (debug tools)`), and records no best, daily best, unlock, kit, tier or levels-seen.
- **No story memory.** The story director switches to a scratch copy of the player's memory
  (`StoryApi.untrack`): what Pell, the echoes, Matron Ash and the Docent say is not marked heard
  or journalled for the player. (`god` and the older QA commands do this too now.)
- **No card discovery.** A card granted in a tainted run is not added to the cross-run discovered
  set that feeds later runs' reward pools.
- **The older checkpoint stays.** Ending a tainted run (`win`, `lose`, the Colossus, the ending
  plates) does not delete the expedition save, because that save is not this run's: `run
  continue` resumes the last clean checkpoint, untainted. `run abandon` deletes it; `run new`
  replaces it.
- `goto` and the other travel commands deliberately do **not** turn on god mode (which refills
  the kit at every arrival); `god`, `tp`, `level`, `heal`, `gold`, `give`, `kill`, `spawn`, `cell`
  and `fill` still do.

A new run (`run new`, `run test`) starts clean. One thing a tester should know: the teach-once hint
cards (`Options > Reset tutorials` clears them) are not part of the profile and are still marked seen
by a tainted run.

### Console typing, fixed on the way

Two console bugs would have made these commands hard to type and are fixed: in play the letter
`m` (the map hotkey) was swallowed by the map, so `camp` typed as `cap`, and `~` (as in `tp ~5
~-3`) closed the console because it is the Backquote key with Shift. Both are text now; the probe
types every letter, digit and `~` into the overlay during play and compares.

## Verification

- `tests/console-help.test.ts`, `tests/console-travel.test.ts`: the help pages, target and flag
  parsing, every travel command against a mock context (taint, refusals, completion, `seq`).
- `node scripts/verify-console-travel.mjs [url]` (dev server running): the whole journey
  through the real overlay with real keys: `help`, `?`, `levels`, `goto d3`, `key`, `portal`,
  `skip` (the real Sanctum, a real click on a boon and the descend button), `boss`, `boss kill`,
  `goto d2b`, every campaign level and back (per-trip timing printed), `goto --seed`, `--at`,
  `win`, `run continue` after a reload, `lose`, `goto` after a death, and asserts that the meta
  profile, the story memory and the saved expedition are byte-for-byte untouched.
- `npm run verify:console-bundle` (after `npm run build`): the public build does not carry the
  travel commands.

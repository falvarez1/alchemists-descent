# The Balance Lab: a developer control panel for the roster

**Status: design (2026-10-04). Nothing in this document is built yet except what section 1 lists as existing.** The
implementation plan, phase by phase with files, tests and exit criteria, is `BALANCE-LAB-PLAN.md`. The open decisions
were settled on 2026-10-04 (section 12; `DECISIONS.md` D-014 to D-021). The main consequence: **the Lab is built in
the CLASHFORGED repository**, starting the day the split copies it out (split phase 1; D-021 as revised).

The roster is about to grow: character-specific moves, combinations, special skills and attribute changes. Each one can
make a fighter overpowered without anyone noticing until players do. The Balance Lab is the one place, in dev builds only,
where a designer can:

- see every fighter's numbers and how they compare with the roster;
- change any of them as a draft;
- watch the change in a live game;
- run CPU-vs-CPU evidence in minutes;
- compare it against the accepted baseline, and apply it to the source with a changelog entry.

Underneath sits a **balance safety net**: layered automatic checks, from a static "power budget" that answers in
milliseconds to a full nightly matrix. With it, a move that is too fast, too safe and too strong at once fails a test
before anyone has to notice it.

## 1. What exists today

| Need | What exists | Where | What is missing |
|---|---|---|---|
| See a fighter's attributes | The Proving Yard panel's Body card: bars against the Alchemist | `ui/FighterArenaPanel.ts` | One fighter at a time. Health-duel era: no Duel levers, no movesets, no roster comparison. |
| Turn numbers live | `ftune list/get/set/diff/reset` (bodies, kits, arena rules); `ai profile/tier/behavior` | `game/console/arena.ts`, `game/console/ai.ts` | Text only. The `stock.*` and `stockBalance.*` roots register only once `__duel` loads. No drafts, no persistence, no write-back. |
| Watch CPUs fight | The Duel lobby (two CPU seats); the Yard's Duel section (*Watch*); the Bots panel (mode, scores, counters) | `ui/VersusLobby.ts`, `ui/ArenaDuelPanel.ts`, `ui/ArenaBotsPanel.ts` | No live metrics, no "why did it win". |
| Run test batches | `duel-batch.mjs` (stock matches); `fight-batch.mjs` (health duel) | `scripts/` | Command line only. No queue. Runs reload if `src` is edited (frozen worktree by hand). |
| Analyse | `duel-analyse.mjs` (report.md/json: win rates, matchups, blows, behaviour flags, stalls); `fight-report-html.mjs` (health duel only, with fight timelines) | `scripts/` | No stock HTML report, no history or trends, no drill-down from a matchup cell to its matches. |
| Tune automatically | `duel-tune.mjs` (secant on `stockBalance`, resumable, `--apply`); `fight-tune.mjs` | `scripts/` | Command line only. Only the two multiplier levers. |
| Inspect one fight | `__duel.run({ traceEvery, traceStatus })`; `diag-duel-cpu.mjs` (per-tick trace); `shot-duel-cpu.mjs` (contact sheet) | `fighters/telemetry/stockHarness.ts`, `scripts/` | No replay viewer, no timeline. |
| Frame-step the game | `ctx.time` manual stepping (Sandbox, Builder, runtime surfaces) | `ui/TimeControlsPanel.ts` | No hitbox overlay, no frame-data readout, no training dummy controls. |
| Author moves | Hand edits to `config/stockAttacks.ts` | | Four kinds (opener, launcher, aerial, finisher), one hitbox each. Seven fighters share a prototype. No cancels, no per-direction moves, no specials as data. |
| Guard against overpowered | Registry ranges (stop typos); invariants (a finisher is slower than an opener) | `fighters/paramRanges.ts`, `tests/stock-attacks.test.ts`, `tests/stock-balance.test.ts` | No power-budget analysis. No regression gate. No combo or loop detection. |

The building blocks are sound: the CPU fights like a person (`AI-STOCK-TACTICS.md`), a match is reproducible from its
seed (D-010), the harness plays a match in about a second of wall time on three pages, and the parameter registry
reaches every number. What is missing is the surface that ties them together, the data model that new moves need,
and the automatic gates.

## 2. Goals and non-goals

**Goals**

- **G1. One place.** See, test, tweak, compare, apply, without the console or a terminal.
- **G2. Three speeds of feedback.**
  - Seconds: schema checks and the static power budget, live while editing.
  - Minutes: a smoke batch and an A/B.
  - An hour or a night: the full matrix that becomes the new baseline.
- **G3. Nothing overpowered ships unnoticed.** Every new move, combo and skill passes automatic gates. An exception is a
  written, expiring waiver.
- **G4. Balance without sameness.** Each fighter's identity (its archetype and telemetry fingerprint,
  `ROSTER-IDENTITY.md`) is a gate as well. A balance pass may not file the fighters down into copies.
- **G5. Traceable.**
  - Every number in a report comes from a run.
  - Every run is replayable.
  - Every applied change has a changelog entry with its evidence.

**Non-goals**

- A player-facing feature. The Lab never ships in a player build.
- Online services or shared rooms. A hosted Lab is a later option, section 11.
- Machine-learned bots. The CPU stays a hand-built brain whose choices can be explained.
- Replacing human playtests. The Lab tells you where to look; people tell you whether it is fun.

## 3. The balance contract

"Well balanced" needs a definition the gates can check. These numbers live in `balance/contract.json`, are editable in
the Lab, and are read by every gate.

| Metric | Target | Gate |
|---|---|---|
| Fighter win rate, official setup (section 9: Hard AND Expert, mirrored personality rotation) | 45-55% at each level | **Fail** outside 40-60% at either level when the 95% interval excludes 50% (at least 144 matches per fighter per level) |
| Worst matchup per fighter | 35% or better | Warn below 35%; **fail** below 25% (at least 24 matches in the cell) |
| Matchup spread (standard deviation of a fighter's matchup win rates) | 12 points or less | Warn above 15: a fighter that is 50% overall but 90/10 against half the roster |
| Skill gap: Normal CPU vs Expert CPU win rate | both inside the band, difference 15 points or less | Warn |
| Per stage | every fighter 40-60% on every stage | Warn |
| Dominant blow | No blow takes over 45% of a fighter's KOs unless it is tagged `kill-move`. No blow is over 40% of a fighter's attack starts. | Warn |
| True combos | Longest true combo 45% or less. No loop: the same link more than 3 times. | **Fail** on a loop over 5 (an infinite) |
| Stalling | 2% of matches or fewer reach the clock | **Fail** above 5% |
| Self-destructs | 5% of stocks or fewer | Warn (usually recovery, not balance) |
| Side bias | slot 0 wins 45-55% | Warn |
| CPU coverage | Every move used at least 0.5 times a fight-minute by its own fighter | Warn: an unused move is untested |
| Identity | Each fighter's fingerprint metrics hold their claimed rank | Warn |
| Static power budget | Every move inside its cohort envelope (z of 2.5 or less on value per frame of commitment), measured on FRESH values (stale-move negation never hides a move) | **Fail** above z 3 unless waived |
| Moveset completeness | Every fighter fills the core slots (section 5.2) | **Fail** |
| CPU behaviour | Under 6 crossings a minute on one surface; under 35% of the fight airborne outside hitstun | **Fail** (a CPU regression invalidates every other number) |

## 4. Architecture

```
 +------------------------- Lab page: /lab.html (dev only) --------------------------+
 |  Dashboard | Runs | Compare | Roster | Move Lab | Power | Review | Matchups | CPU | Gates |
 |                                                                                    |
 |  +-- embedded game (same-origin iframe: /?lab=1) ---+   lab client: fetch + SSE     |
 |  |  live preview, Move Lab training stage, replays  |   postMessage <-> lab bridge   |
 |  +--------------------------------------------------+                               |
 +---------------------------------------+--------------------------------------------+
                                         | HTTP + server-sent events (dev server only)
 +---------------------------------------v--------------------- Lab server -----------+
 |  run queue -> runner pool (headless pages driving __duel.run)                     |
 |  frozen lab builds: each run plays a built snapshot, immune to editing src        |
 |  run store: verify-out/duels/<run>/ + an index; the analyser as a library          |
 |  static analyser (power budget), gate evaluator (contract + baseline)             |
 |  sheet store: read, validate, write fighter sheets; drafts; balance changelog     |
 +------------------------------------------------------------------------------------+
```

### Decisions

**D-L1. A separate dev route, `/lab.html`, not another panel in the game window.**
- The Lab is a full-screen data tool. The game window stays the game.
- Anything visual (a preview, a replay, the Move Lab) runs in an embedded same-origin iframe of the game. The Lab talks
  to it through a small bridge.
- This follows the Builder's own route (`/builder.html`, a second Vite input).

**D-L2. Batches run in the Lab server, never in the Lab page.**
- A match is main-thread work. Parallel matches need processes.
- The server drives headless pages through the existing `__duel.run`, so the harness that produced pass 1 is the one
  the Lab uses.
- A later headless kernel (section 11) replaces the pages without changing the protocol.

**D-L3. Frozen lab builds.**
- Each run plays a built snapshot of the code (a dev-flavoured production build with the harness compiled in, cached by
  content hash), served statically.
- Editing `src` while a run is going cannot reload its pages. That trap has already cost probe runs and tuning rounds;
  today the workaround is a frozen worktree made by hand.
- The run records exactly what it played.

**D-L4. Tunables become data: fighter sheets (decided, D-016).**
- A JSON Schema generated from the TypeScript types (`fighter-sheet.schema.json`, referenced by each sheet's `$schema`)
  gives editors autocomplete and validation. A runtime validator gives precise errors. CI fails when the generated
  schema is stale.
- Comments that document numbers today move to a `notes` map in the sheet (keyed by field path), which the Lab shows
  as field help.
- One JSON sheet per fighter (`src/content/fighters/sheets/<id>.json`) holds:
  - its body;
  - its Duel levers;
  - its moves;
  - its kit numbers;
  - its signature loadout;
  - its CPU hints;
  - its identity fingerprint.
- TypeScript modules import the sheets, and a schema module validates them. Behaviour stays in code (kits, the
  engine).
- The Lab's *Apply* is then a JSON write that diffs cleanly. Rewriting numbers in TypeScript by regex (what
  `duel-tune --apply` does today) does not scale to movesets.

**D-L5. One registry for every knob.**
- The parameter registry (`fighters/paramOverride.ts`) is the only way anything turns a number: the Lab, `ftune`,
  `--set`, the tuner.
- All roots register at boot in dev builds (body, stock moves, Duel levers, kits, arena rules, CPU personalities,
  tiers and behaviour). Today some register only when the harness loads.

**D-L6. Draft, evidence, apply.**
- An edit lives in a named **draft** (a set of overrides).
- Drafts are local working state (decided, D-019): kept in `.lab/drafts/` (git-ignored), and exportable to a file to
  share.
- The draft is tried live, then A/B-tested in a batch against the baseline, then applied to the sheets.
- *Apply* writes a changelog entry that links the evidence runs.
- Nothing writes source without an explicit *Apply*, and *Apply* refuses a failing gate unless a waiver is written.
- The repository's durable record is what was applied: the sheets, the balance changelog, the baseline.

**D-L7. Reproducible by construction: every run is self-contained (decided, D-019).**
- A run records:
  - the git commit and a dirty flag;
  - the build hash, and a hash of every sheet;
  - the **complete override set** it played (not a reference to a draft that may change later);
  - the CPU levels and personalities, the stage and the seed.
- A replay re-runs that spec with rendering on (D-010).

**D-L8. Dev only.**
- The page, the bridge and the harness are behind `import.meta.env.DEV` and `__AUTHORING__`.
- The Lab server is a Vite plugin that exists only in `serve`.
- `verify:builder-bundle` gains a check that no Lab module reaches a player build.

### Where it lives: the CLASHFORGED repository (decided, D-021 as revised)

The split (`docs/split/SPLIT-PLAN.md`) copies this repository in two: CLASHFORGED gets a copy with the full history and
keeps the arena, and Descent deletes it. The CLASHFORGED repository keeps this repository's layout, so the Lab is built
there from the day of the copy (split phase 1), directly where it belongs, with no path churn:

| Part | Lives in | Imports |
|---|---|---|
| Fighter sheets, the schema | `src/content/fighters/sheets/` | nothing but types |
| The static analyser (power budget, KO calculator, combo finder) | `src/fighters/analysis/` | the fighters, the stock rules, the engine; no DOM |
| The page (`lab.html` beside `index.html` and `builder.html`, the screens, the bridge's Lab side) | `src/lab/` (dev entry only) | the fighters, the arena, telemetry, config, the engine, the foundry kit |
| The bridge's game side | `src/dev/` | the game |
| The Lab server, runner, store, gates | `tools/lab/` | anything (tools drive the game) |

The analyser lives beside the fighters so that the Lab, the CPU (which reads the link table) and the tests all use one
implementation. It must stay free of DOM and browser APIs.

**Consequence: the copy gates balance tooling.** It is the split's first, short step. Until it lands:
- New moves and attribute changes are guarded only by today's tests and the command-line tools.
- After each change, run `duel-batch` on the pass-1 confirmation spec (`--pairs all --seeds 4 --stage all
  --personality duelist --seed-base 30000`) and `duel-analyse --compare` against that run's report. `confirm-final` is
  in the main checkout's `verify-out/duels/`; the same command re-creates it.
- The copy decides the Lab's start date. `BALANCE-LAB-PLAN.md` "Before the Lab" lists what the Lab needs from the
  split.

## 5. Data model

### 5.1 The fighter sheet

```jsonc
// src/content/fighters/sheets/rusk-emberjaw.json
{
  "id": "rusk-emberjaw",
  "schema": 1,
  "identity": {                // (the fingerprint metrics here are examples)
    "archetype": "charging bruiser",
    "fingerprint": [ { "metric": "diesAt", "rank": "top3" }, { "metric": "abilityKoShare", "rank": "top3" } ]
  },
  "body": { "mass": 1.3, "run": 0.9, "accel": 0.9, "friction": 1.5, "...": "BodyProfile, ranges in core/fighterBody" },
  "duel": { "dealt": 0.731, "launch": 1.367 },
  "moves": { "jab1": { "...": "MoveSpec (5.2)" }, "ftilt": {}, "fsmash": {}, "nair": {}, "uspecial": {} },
  "kit": { "armorMax": 40, "ram": { "cooldown": 540, "damage": 16, "...": "the kit's TUNING" } },
  "loadout": { "...": "signature wands and flasks (content/fighterLoadouts today)" },
  "ai": { "personality": "berserker", "moveHints": { "fsmash": { "role": "kill-move" } } }
}
```

Each section replaces a table that exists today:

| Sheet section | Replaces |
|---|---|
| `body` | `content/fighterBodies.ts` |
| `duel` | `config/stockBalance.ts` |
| `moves` | `config/stockAttacks.ts` |
| `kit` | each kit's exported `TUNING` |
| `loadout` | `content/fighterLoadouts.ts` |
| `ai.personality` | `FIGHTER_PERSONALITIES` |

Migration keeps every number and every behaviour. The proof: a batch run on the same seeds produces identical match
records before and after.

### 5.2 Moves, version 3 (what character-specific movesets need)

Today a stock attack is one hitbox with a startup, an active window and a recovery. A fighting-game move needs more:

```ts
interface MoveSpec {
  id: string;                    // stable: telemetry, waivers and the changelog refer to it
  name: string;                  // 'Furnace thrust'
  slot: MoveSlot;                // the input that performs it (below)
  frames: {
    startup: number;             // ticks before the first hitbox
    total: number;               // the whole commitment on the ground
    landingLag?: number;         // aerials: ticks lost on landing during the move
    autoCancel?: [number, number][]; // aerials: windows where landing costs nothing
    iasa?: number;               // first tick another action may interrupt the recovery
  };
  hitboxes: HitboxSpec[];        // several, each with its own active window
  body?: {
    armor?: { frames: [number, number]; threshold: number };   // absorbs blows up to this damage
    intangible?: [number, number][];                           // cannot be hit at all
    motion?: { frames: [number, number]; vx: number; vy: number }[]; // lunges, hops
    turn?: boolean;              // may reverse facing at startup (a back-hit)
  };
  cancels?: { into: MoveSlot[]; window: [number, number]; on: 'hit' | 'block' | 'any' }[]; // chains and combos
  charge?: { maxTicks: number; damageAt: number; growthAt: number };  // smash attacks
  cost?: { specialCharges?: number; cooldown?: number; meter?: number };
  projectile?: string;           // a projectile def id spawned at a hitbox's first frame
  script?: string;               // a kit-provided behaviour for specials (5.3)
  tags: MoveTag[];               // 'kill-move' | 'combo-starter' | 'poke' | 'anti-air' | 'recovery' | 'command-grab' ...
  ai?: { band?: [number, number]; when?: 'neutral' | 'punish' | 'edgeguard' | 'juggle' | 'recovery' };
}

interface HitboxSpec {
  frames: [number, number];      // active window, ticks from the move's start
  box: { x: number; y: number; w: number; h: number }; // relative to the feet, mirrored by facing
  damage: number;
  angle: number;                 // launch angle in degrees (Sakurai-style special values allowed)
  base: number; growth: number;  // knockback: fixed part and per-percent part
  hitstun?: number;              // multiplier on the computed stun
  shieldDamage?: number;         // extra shield damage
  hitlag?: number;               // multiplier on the impact freeze
  priority?: number;             // clank and trade resolution
  element?: 'none' | 'fire' | 'ice' | 'shock' | 'mire';      // cell interactions stay grid-real
}

type MoveSlot =
  | 'jab1' | 'jab2' | 'jab3' | 'rapidJab' | 'dashAttack'
  | 'ftilt' | 'utilt' | 'dtilt' | 'fsmash' | 'usmash' | 'dsmash'
  | 'nair' | 'fair' | 'bair' | 'uair' | 'dair'
  | 'grab' | 'pummel' | 'fthrow' | 'bthrow' | 'uthrow' | 'dthrow'
  | 'nspecial' | 'sspecial' | 'uspecial' | 'dspecial'
  | 'ledgeAttack' | 'getupAttack';
```

The four kinds the engine has today map onto this with no change in play: opener -> `jab1`, launcher -> `utilt`,
aerial -> `nair`, finisher -> `fsmash`, the right-stick up smash -> `usmash`. The adapter is the first step of the
engine work, so nothing breaks while the engine grows.

**Scope: the full vocabulary, a required core (decided, D-017).** The engine, the inputs, the schema, the analyser and
the CPU support every slot above. Each fighter must fill the **core**, and fills optional slots where its identity calls
for them:

| | Slots |
|---|---|
| **Core (16, required)** | `jab1`, `ftilt`, `utilt`, `dtilt`, `fsmash`, `usmash`, `nair`, `fair`, `bair`, `grab`, `fthrow`, `bthrow`, `nspecial`, `sspecial`, `uspecial` (the recovery), `dspecial` |
| **Optional (12)** | `jab2`, `jab3`, `rapidJab`, `dashAttack`, `dsmash`, `uair`, `dair`, `pummel`, `uthrow`, `dthrow`, `ledgeAttack`, `getupAttack` |

An unfilled optional slot is never a dead input. It resolves through an **explicit fallback** declared in the sheet
schema and visible in the Lab:

| Optional slot | Falls back to |
|---|---|
| `jab2`, `jab3`, `rapidJab` | the jab chain simply ends (no fallback move) |
| `dashAttack` | `ftilt` |
| `dsmash` | `fsmash`, both directions |
| `uair` | `nair` |
| `dair` | `nair` |
| `uthrow`, `dthrow` | `fthrow` |
| `pummel` | none |
| `ledgeAttack`, `getupAttack` | a shared roster default |

The L0 gate fails a sheet with a core slot missing. The Lab lists every fallback in use, so a fighter that leans on
fallbacks is visible as unfinished, not hidden. Art follows the same rule: a slot's sheet entry names its pose set, so
missing animation is listed.

### 5.3 Special skills as moves

A kit's tactical and ultimate keep their behaviour in code (`fighters/kits/<id>.ts`). A special move adds a
`MoveScript` hook the kit implements (`script: 'ram'`), with its frames, hitboxes, cost and tags declared in the sheet.
Then the analyser, the CPU and the Lab read a special exactly as they read a jab. A special that cannot be described by
frames and hitboxes (a decoy, a terrain grower) declares an **effect budget** instead (duration, area, damage per second,
cooldown), so it is still measured and compared.

### 5.4 Run records, version 2

`__duel.run` gains a `detail` level. Today's records stay readable.

- **Blow events:** start, hit, blocked, whiffed, traded; the tick of contact; damage; the victim's percent; KO or not.
- **Combos:** sequences of hits where the victim never became actionable between them. The analyser computes these
  from hitstun and action-lock windows.
- **KOs:** the percent, the blast line, the blow, and the stage position of the launch.
- **Provenance:** sheet hashes, the draft id, the build hash, the CPU levels and personalities.
- **Replay checkpoints:** a tiny position track for seeking (the replay itself re-simulates).

### 5.5 The balance store (in the repository)

```
balance/
  contract.json         the targets and gates (section 3)
  baseline.json         the last accepted full-matrix report and its spec (git commit, sheets hash)
  CHANGELOG.md          generated patch notes: change, evidence runs, measured delta, who applied it
  waivers.json          justified exceptions to a gate: move or fighter, reason, expiry date
```

Drafts are not here: they are local working state in `.lab/drafts/` (git-ignored), exportable to share (D-019). Runs are
self-contained, so nothing in the repository depends on a draft file.

## 6. Screens

The Lab wears the Studio design language (`styles/studio.css` tokens, as the Builder does). Charts are inline SVG
(no chart library, as `fight-report-html` does). Every table cell that is a number links to the matches behind it.

### 6.1 Dashboard

```
+-----------------------------------------------------------------------------------------------+
| BASELINE 0437216 (360 matches, Normal, duelist)   LAST RUN smoke-1012 (90)   GATES: 1 warn      |
+-------------------------------+---------------------------------------------------------------+
| WIN RATE (95% interval)        | MATCHUPS (row beats column)                                   |
|  Mara    ######|####  64%      |        Mar Edd Rus Bra Kes Sel Nox Ily Sab Tho                |
|  Edda    #####|####   57%      |  Mara   .  55  61  70  58  66  62  64  70  71                |
|  Rusk    #####|###    53%      |  Edda  45   .  52  58  ...                                    |
|  ...                           |  (cells shade by distance from 50%; click opens the matches)  |
|  band 40-60 shaded             |                                                               |
+-------------------------------+---------------------------------------------------------------+
| FLAGS                          | TRENDS (win rate across the last 10 accepted runs)            |
| ! Mara 64% (52-74%) warn       |  Rusk  ~~~~___   Mara  __~~~~                                 |
| ! no move flagged              |                                                               |
+-------------------------------+---------------------------------------------------------------+
```

### 6.2 Runs

- A launcher, with presets: Smoke (90 pairs at Hard and Expert: 180 matches), A/B (two sides of the same fresh seeds),
  Full (2,160 matches, section 7).
  - Pairs: all, one fighter against the roster, or a hand-picked list.
  - Seeds and the seed base, stages, CPU levels, personality mode (mirrored rotation by default; one profile; the lobby
    personalities).
  - A draft to apply, and a label.
- A queue with live progress:
  - matches done, the ETA;
  - **partial standings** that tighten as results arrive;
  - early stopping when sequential tests (section 7, L2) have their answer;
  - cancel.
- The finished runs, filterable by label, draft, git commit and date. Each opens its report.

### 6.3 Compare (A/B)

- Pick two runs. The usual pair is baseline vs draft, on the same fresh seeds.
- Per fighter: the win-rate delta with a two-proportion test (significant or not, never just a number).
- A matchup delta heatmap. Blow usage and hit-rate deltas. KO-percent deltas.
- **What changed:** the override diff between the two specs.

### 6.4 Roster and the sheet editor

```
+---------------------------------------------------------------------------------------------------+
| ROSTER   body | duel levers | mobility (measured) | offense | defense             [draft: rusk-ram-2] |
|           mass  run  jump  fall  jet | dealt launch | run px/s  jump h  recov | KO@ctr | dies@  |
| Rusk      1.30  0.90 0.85  1.20 0.60 | 0.73  1.37   |  3.0      22      140   |  96    |  84    |
|  envelope [----|=====*====|------]  per column: roster min | median | max, this fighter's mark      |
+---------------------------------------------------------------------------------------------------+
| RUSK EMBERJAW   Body | Duel | Moves | Kit | Loadout | CPU | Identity                                  |
|  mass   [-----------*------]  1.30  (shipped 1.30, range 0.6-1.6)         LIVE [x]  POWER BUDGET ok |
|  launch [--------------*---]  1.37  draft 1.30                             A/B vs baseline  APPLY    |
+---------------------------------------------------------------------------------------------------+
```

- **Mobility is measured, not guessed.** Run speed, jump height, fall speed and recovery reach come from a short probe
  per fighter in the runner (the logic of `verify-fighter-bodies`), cached by sheet hash.
- **LIVE** pushes a draft value into the embedded game through the registry.
- **POWER BUDGET** recomputes the static analysis on every keystroke.
- **A/B** queues a draft-vs-baseline run on fresh seeds.
- **APPLY** writes the sheet, then the changelog entry.

### 6.5 Move Lab

```
+-------------------------+------------------------------------------------+-----------------------------+
| MOVES (Rusk)            |  [embedded game: training stage]               | FURNACE THRUST (fsmash)     |
|  jab1  Brass jab        |      dummy at [ 85 %]  behaviour [stand v]     | startup 18  total 50  [=]   |
|  ftilt ...              |      hitboxes drawn per frame, hurtboxes too   | hitbox 1: f18-21 x8 y-20    |
| >fsmash Furnace thrust  |                                                |   w30 h17 dmg 42 angle 30   |
|  nair  ...              |  frame 19/50  |<  <  >  >|  loop [x]  0.25x   |   base 5.2 growth 1.45      |
|  + new move             |  [startup ###|active ##|recovery ##########]   | armor -  cancels -          |
|                         |                                                | DERIVED                     |
|                         |  KO CALCULATOR: kills Mara from centre at 72%,  |  on shield  -24 (unsafe)    |
|                         |  Brann at 118% (ledge: 58% / 96%)               |  reach 34  area 510         |
|                         |  COMBOS: utilt -> fsmash true at 0-40%          |  z (fsmash cohort) +0.4     |
+-------------------------+------------------------------------------------+-----------------------------+
```

- **Frame-accurate preview.** It reuses `ctx.time` manual stepping, plus a dev render layer that draws hitboxes,
  hurtboxes, armor and intangibility frame by frame.
- **Training dummy.** It stands, shields, jumps, holds influence, or replays a recorded input track. Its percent is
  settable.
- **KO calculator.** For each roster weight, the percent at which the move KOs from the stage centre and from the
  ledge. It simulates the launch with the real `stockLaunch` and each stage's blast zone, and checks the number in the
  live game on demand.
- **Combo finder.** It searches cancel and link sequences up to depth 4 that are true combos (the next move's first
  active frame lands before the victim can act), across 0-150%, and lists damage and range. It flags loops.
- **Before/after.** It records the move on the shipped sheet and on the draft and plays the two side by side.

### 6.6 Power budget (static analysis)

- A table of every move with its derived numbers and its z-score within its **cohort**: jabs with jabs, smashes with
  smashes, specials by role.
- A scatter of speed (startup) against reward (damage and KO power), coloured by fighter. The envelope is shaded and
  outliers are labelled.
- A per-fighter radar on eight axes: speed, range, damage, KO power, safety, mobility, recovery, durability.
- **Why flagged:** for example, "fsmash is faster than 90% of smashes AND kills earlier than 95% of them AND is
  -4 on shield where the cohort is -18".

### 6.7 Fight Review

- Pick any match from a run. The embedded game re-runs its spec with rendering on.
- **Seeking** fast-forwards headless to the tick, then renders.
- **The timeline:**
  - both percent curves;
  - every blow, coloured by move;
  - shields, dodges, grabs and KOs;
  - a lane per CPU showing its tactics mode (neutral, approach, punish, defend, edgeguard...) and the rule that fired.
- Clicking any event seeks to it. A toggle overlays hitboxes.
- This is the review overlay `TELEMETRY-AND-BALANCE.md` 3.8 planned, for stock matches.

### 6.8 Matchups

- A heatmap cell opens: its matches, its KO-blow distribution, the stock lead over time, and the blow usage and hit
  rate of each side compared with their roster averages.
- **Why X beats Y:** the three largest differences, in words.

### 6.9 CPU

- Personality and tier editors (the data that exists today).
- Per-move CPU coverage.
- **Can we trust the CPU:**
  - the behaviour metrics;
  - the mirror sanity check (the same fighter both sides is about 50%);
  - the Normal-vs-Expert gap;
  - whether every move gets used.
- A move the CPU never uses makes every balance number about that fighter suspect.

### 6.10 Gates and history

- The contract editor.
- The last result of every gate layer.
- Waivers, with their expiry.
- The balance changelog.
- **Promote to baseline:** a full run that passes becomes the new reference.

## 7. The balance safety net

Five layers, cheapest first. Each runs where its cost allows. A change has to get through all of them before it
ships.

| Layer | What | Time | Runs |
|---|---|---|---|
| **L0 Schema and invariants** | Sheet validation, ranges, structural rules | milliseconds | in the editor, in `vitest` |
| **L1 Static power budget** | Per-move value against cost within its cohort; dominance; fighter offense/defense balance; combo and loop search | under a second | in the editor, in `vitest` (a gate) |
| **L2 Smoke simulation** | 90 pairs x 1 seed at Hard and at Expert, mirrored personalities rotating, stages rotating, with early stopping, compared with the baseline | about 5 minutes on pages (well under that on the headless kernel) | a **required check** on pull requests touching fighter, move or arena code (`npm run balance:smoke`) |
| **L3 Full matrix** | 90 pairs x 12 seeds (four stages and six mirrored personalities rotating) x Hard and Expert: 2,160 matches; then the lobby personalities, reported | about 45 minutes on pages (minutes on the headless kernel) | nightly and before release; a failure opens an issue and blocks releases; produces baseline candidates |
| **L4 Deep checks** | Sensitivity sweeps, degenerate-strategy and combo-loop detection over all runs, identity fingerprints, per-stage and skill-gap | on demand | the Lab, nightly |
| **L5 Human telemetry** | Real Duel matches recorded in the same format | as played | opt-in, dev builds |

**L0, invariants.** Every slot a fighter's inputs can reach has a move. Cancels name existing slots. A cancel cycle
without a cost is an error (an infinite at the data level). A smash is slower than its tilt. A recovery special exists.
An aerial with landing lag shorter than 4 ticks is tagged on purpose. Every value is inside its range.

**L1, the power budget.** For every move:
- **Speed:** startup, and the earliest action after it.
- **Reward:** damage and **KO percent**, computed by simulating the launch against each stage's blast zone for each
  roster weight. Its `stockLaunch` is pure, so this costs microseconds.
- **Safety:** frame advantage on shield. Shield stun comes from `StockShield.block`; the result is that minus the
  remaining active frames and the recovery.
- **Range:** forward reach and hitbox area.
- **Utility:** the true-combo links it starts, its armor or intangible frames, and its motion.

Value per frame of commitment is compared within the move's cohort as a z-score. A **dominant** move is better than
the cohort median on three or more axes and worse on none: it is flagged even under z 3. At the fighter level, an
offense index (expected blows to KO a median-weight foe from 0%) and a defense index (percent survived against the
roster's median KO move) put every fighter on one chart, and a fighter far from the diagonal is flagged.

L1 is deliberately a heuristic. Its job is to stop the obvious mistake before any match runs. The simulations
remain the verdict.

**L2 and L3, the simulations.**
- **Early stopping.** Batches stop early with a sequential test per fighter: stop when every fighter's interval sits
  clearly inside the band, or one clearly outside it.
- **Robust ratings.** Results are also fitted with a **Bradley-Terry model** (one strength per fighter from all
  pairwise outcomes). It ranks fighters independently of the opponent mix and gives a single number to track over
  time.
- **Regression gate.** A fighter whose Bradley-Terry strength moved significantly from the baseline is a regression
  to explain, even inside the band.

**L4, deep checks.**
- **Sensitivity:** each lever and each move's main numbers nudged by plus and minus 10%, measured against a fixed
  reference panel of opponents. The elasticity says which numbers are levers and which are cliffs. Pass 1 measured
  about 3 win-rate points per 1% of a lever for every fighter, against about 10 points of seed noise at 72 matches: a
  sweep needs enough matches per point to see a 10% nudge.
- **Degenerate strategies:**
  - one blow over 40% of a fighter's starts while winning;
  - projectile or special spam at range with no melee;
  - ledge camping (long stretches at the ledge while ahead);
  - stalling (the clock with a stock lead and little damage dealt).
- **Combos and loops:** from the blow events of every run; the longest true combo and any repetition chain.
- **Identity:** the fingerprint ranks from `ROSTER-IDENTITY.md`, encoded in the sheets.

**L5, people.** The live Duel already plays through the same arena code. A recorder in the live path writes the same
records, so CPU-measured balance can be checked against how people actually play (which moves they use, which
matchups they lose) once there are enough matches.

## 8. Metrics catalogue

| Metric | Definition |
|---|---|
| Win rate, interval | Wins over matches; Wilson 95% interval |
| Bradley-Terry strength | Maximum-likelihood strength per fighter from pairwise results; the win probability of A over B is s_A / (s_A + s_B) |
| Matchup win rate, spread | Per ordered pair, both sides pooled; the spread is the standard deviation over a fighter's nine matchups |
| Stock differential | Stocks left minus the opponent's, per match |
| Dies at | Mean percent when a stock was lost |
| KO percent, by move | The victim's percent at each KO, and the move that did it |
| Damage per fight-minute | Percent dealt, by group: melee, throw, special, ability, world |
| Blow usage, hit rate | Starts per fight-minute by move; landed over started |
| KO share | The share of a fighter's KOs taken by each move |
| True combo | A hit sequence with no actionable gap for the victim; its length, damage and starting percent |
| Frame advantage on shield | Shield stun minus the attacker's remaining frames (static) |
| Out-of-shield options | The fastest punish from shield (grab, or any move under a threshold) |
| Mobility | Measured run speed, jump height, air speed, fall speed, recovery reach (cells) |
| Self-destruct rate | KOs with no credited attacker, over stocks lost |
| Timeout rate | Matches that reached the clock |
| Side bias | Slot-0 win rate over decided matches |
| CPU coverage | Uses per fight-minute per move by its own fighter |
| Behaviour | Crossings per minute on one surface; airborne share outside hitstun; spacing distribution |
| Elasticity | The change in win rate per 1% change of a parameter, from a sensitivity sweep |

## 9. The CPU is the measuring instrument

Every balance number is the CPU's, so the CPU has to be good enough, and consistent enough, to trust.

- **The official setup (decided, D-014 and D-015).**
  - **Skill:** Hard (level 4) AND Expert (level 5). A fighter must be inside the band at both. One that is strong only
    at low skill, or only at high skill, fails.
  - **Playstyle: mirrored rotation.** Each match gives both sides the same personality, and the personality rotates
    through all six across the seeds. The gates read this: it measures the kits across every playstyle without either
    side having a style advantage.
  - Each fighter's own lobby personality is run and reported alongside, as the CPU-opponent experience, but does not
    gate.
- **Moves are data to the CPU as well.**
  - `stockTactics` already chooses blows by hitbox coverage at the moment they come out. Version 3 generalises it from
    the four kinds to any `MoveSpec`: frames, hitbox windows, safety on shield, cancels.
  - The CPU gets the link table from the L1 combo finder, so it can perform the true combos the data says exist.
  - A new move is then used by the CPU on the day it is written, and the coverage metric says so.
- **Skill levels are measured, not assumed.** The gap between Normal and Expert is tracked. A fighter that only wins at
  low CPU skill (or only at high) is a finding.
- **CPU regressions invalidate everything.** The behaviour gate (section 3) runs in every simulation layer. A change to
  the CPU reruns the baseline before any balance conclusion is drawn.
- **The limit is written down.** The CPU does not play like an expert human. L5 and human playtests remain the check
  on the instrument.

## 10. Engine work the movesets need

The Lab can edit and measure only what the engine can play. Version 3 movesets need these in the stock attack engine
(`arena/StockAttack.ts`, `ArenaSlots.resolveStockAttacks`, the inputs in `input/stockPad.ts` and `InputManager`):

1. Several hitboxes per move, each with its own active window (multi-hit moves, sweet and sour spots).
2. Directional inputs: tilts, smashes and aerials by direction; neutral, side, up and down specials. Keyboard and
   controller mappings stay one table.
3. Cancels and chains (jab 1-2-3, a tilt into a special on hit), with interruptibility windows.
4. Landing lag and auto-cancel windows for aerials.
5. Armor and intangibility windows; move motion (lunges, hops); turnaround at startup.
6. Charge for smash attacks.
7. Move-driven projectiles; command grabs.
8. Per-move hitlag, hitstun and shield damage multipliers; clank and priority for trades.
9. `MoveScript` hooks so kits implement special moves with declared frames and costs.
10. **Stale-move negation (decided, D-018): a match rule, on by default.**
    - A fighter's recent landed moves form a short queue. A move already in the queue deals less damage and knockback;
      variety refreshes it.
    - The queue length and scaling are rule data (`config/stockRules`), tuned with telemetry. The rule can be turned off
      per mode.
    - **It never hides an overpowered move.** The static power budget and the KO calculator measure fresh values.
      Telemetry records each hit's staleness. The dominant-blow gate reads usage, which staleness does not change.
    - Turning it on changes every match, so the baseline is re-measured in the same change.

Every step keeps today's play identical until a sheet uses the new field. The v1-to-v3 adapter and the batch
equivalence check prove it.

## 11. Later

- **The headless kernel: evaluated first, not later.** The runner is built on the game running without a browser (Node
  worker threads) if CLASHFORGED's composition root can run a match with no DOM, WebGL or audio. The split's phase 3
  writes that root (the Duel's own `Game`), and should aim for this. That is an expected 5-10 times the throughput: the L3 matrix becomes minutes and
  can become a pre-merge check. Headless pages stay as the fallback, and as the path for anything that renders
  (replays, the Move Lab). The plan's BL0.5 makes the call with a measurement.
- **A hosted Lab.** Share runs and exported drafts across machines through the AuthorLink relay (the original "Tuning
  Lab" idea in `docs/REALTIME-TUNING-LAB-AND-MULTIPLAYER-SERVER-SPEC.md`).
- **More than two fighters.** If an arena mode with more fighters arrives, the contract gains free-for-all metrics
  (placement, damage share).

## 12. Decisions (settled 2026-10-04)

Each was chosen for the best long-term architecture, not for the least work. The arena decision log (`DECISIONS.md`) holds
the reasoning, what was rejected and what would make us revisit each one.

| Id | Question | Decision |
|---|---|---|
| D-014 | Which CPU skill levels do the gates measure? | **Hard and Expert, both must pass** |
| D-015 | Which CPU personalities do the gates use? | **Mirrored rotation**: both sides the same personality, rotating through all six; the lobby personalities are reported, not gated |
| D-016 | How is fighter data stored? | **JSON sheets** per fighter, a JSON Schema generated from the TypeScript types, a runtime validator, a `notes` map for field help; behaviour stays in code |
| D-017 | How complete is a moveset? | **The full slot vocabulary in the engine; 16 core slots required per fighter**; optional slots resolve through explicit fallbacks |
| D-018 | Stale-move negation? | **A match rule, on by default**; the analyser and the gates measure fresh values, so it never hides a move |
| D-019 | Drafts and provenance? | **Runs are self-contained** (they embed their complete overrides); drafts are local and git-ignored, exportable to share |
| D-020 | How strict are the gates in CI? | **Strict, with waivers**: L0 and L1 fail every build; the L2 smoke is a required check on fighter, move and arena changes; the nightly L3 opens an issue and blocks releases; exceptions are written, expiring waivers |
| D-021 | When is the Lab built? | **In the CLASHFORGED repository, from the day the split copies it out** (split phase 1), directly in its final paths. Revised when the split became two repositories; it first said "after the monorepo's phase 6". |

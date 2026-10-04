# Splitting into two games, in two repositories

Status: **plan, revised 2026-10-04: two repositories, copy first.** Phase 0 is done on `feature/split-phase-0`
except the findability fix. This version replaces the monorepo plan (PR #20, `e81d94e`); section 8 says what that
plan was and why it was dropped.

The Duel has grown into its own game. The repository is copied in two, and each copy deletes the other game:

- **CLASHFORGED**: the Smash-style fighter (Duel, stock matches, LAN, ten fighters, announcer, Training), dressed in
  the foundry UI kit on every screen. It gets a new repository with this one's full history.
- **Alchemist's Descent / Breathing Works**: the campaign as it is today, without the arena (classic Alchemist only).
  It stays in this repository.

Both start from the same engine, then evolve separately. An engine fix reaches the other game only when someone
ports it.

## 1. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | One repository or two | **Two repositories, each with its own copy of the engine** | The games are very different (a falling-sand campaign and a platform fighter) and will diverge further. Sharing one engine would need neutral seams (actor contracts, a game kernel, registries, a split `Ctx`) that constrain both games and are most of the work. When both games want the same engine fix, it is ported by hand; `git cherry-pick` works while the two histories are close. |
| D2 | What CLASHFORGED keeps | Duel, LAN, lobby, **Training** (the Proving Yard, made player-facing), the **Builder** (dev-only, stage authoring), **AuthorLink** (dev-only live tuning). Not the Sandbox. | |
| D3 | Descent and the arena | **Descent deletes the arena entirely**: no Duel or Arena doors, no fighter picker, no fighters in runs, and no hooks kept for them | |
| D4 | The Builder and AuthorLink | **Each repository keeps its own copy** | No shared package has to stay neutral; each editor serves one game's content. |
| D5 | CLASHFORGED hosting | **Its own Cloudflare Worker with static assets** (Ajar Red account): one deployment holding the static game, the online Duel's room Durable Objects, and later the Containers for server-run matches. A custom domain, if any, keeps its DNS on Cloudflare. Descent stays on Pages (`alchemists-descent.pages.dev`) and GitHub Pages. | Workers serve static assets and `_headers` (COOP/COEP) natively at the same price as Pages, and add what an online game needs in the same deployment: Durable Objects and Containers, the Cloudflare Vite plugin (dev runs the real room code), gradual deployments, rate limiting, logs and queues. Descent is purely static, so Pages costs it nothing. Revised from a Pages project before anything deployed; detail in `docs/arena/DECISIONS.md` D-022. |
| D6 | Repositories | **Descent stays in `falvarez1/alchemists-descent`** (no rename; its URLs do not change). **CLASHFORGED is a new private repository, `falvarez1/clashforged`**, created from `main` with the full history. | The history keeps `git log` and blame working, lets a branch made before the copy be pushed to either repository, and lets early fixes cherry-pick cleanly. |
| D7 | Package manager | **npm in both**, as today | pnpm workspaces were for the monorepo. |
| D8 | Order of work | **Copy first, then each repository deletes the other game, in parallel** | Untangling before the copy only pays when the copies keep sharing code. Here each side's untangling is a deletion in its own repository. |

## 2. What each repository deletes

`node scripts/split/survey.mjs` resolves every import in `src/` (static, type-only, dynamic and `import.meta.glob`).
It classes each module by the pruning map in `scripts/split/ownership.mjs` and measures both deletions. Full detail,
including every import to cut, is in `verify-out/split/survey.json`, or `--cuts` prints it. Rerun it after each step.

Measured on `feature/split-phase-0` (main `5554d51` plus Phase 0):

| What the module is | Modules | Lines | Descent | CLASHFORGED |
|---|---:|---:|---|---|
| The campaign | 332 | 96,855 | keeps | deletes |
| The engine | 249 | 72,933 | keeps a copy | keeps a copy |
| The Builder and AuthorLink | 69 | 35,897 | keeps a copy | keeps a copy (dev-only) |
| The fighters (roster, kits, `FighterSystem`, looks) | 60 | 17,015 | deletes | keeps |
| The Duel (rules, stages, AI, LAN, lobby, HUD, announcer) and the foundry kit loader | 98 | 16,832 | deletes | keeps |
| `game/Game.ts`, the composition root | 1 | 1,230 | cuts the Duel's systems out | cuts the campaign's systems out |

### 2.1 Descent deletes the arena

- **158 modules (33,847 lines)**, plus:
  - assets: `public/audio/duel` (0.9 MB), `public/assets/arena` (3.2 MB) and `public/assets/fighters` (1.8 MB);
  - the LAN Duel server (`servers/duel`, the Vite `duelPlugin`);
  - 52 tests, 74 scripts, `docs/arena`, `docs/fighters`, `docs/FIGHTERS.md` and `docs/DUEL-LAN.md`;
  - the arena and foundry stylesheets.
- **68 imports of arena code, in 29 files Descent keeps.**
  - 17 are in `Game.ts`, which builds and ticks the Duel's systems.
  - 27 are in engine code: `Player`, physics, lighting, camera, `FrameComposer`, the player sprites, audio, input and
    `core/types.ts`.
  - 24 are in campaign code: `Levels` builds the Duel stages, the title has the Duel and Arena doors and the fighter
    row, the run and meta profile carry a fighter, the console has arena commands, and the pause menu knows stocks.
- **193 `ctx.arena` / `ctx.fighters` / `ctx.versus` / `ctx.duel` calls in 27 files.** `Player.ts` has 60,
  `PauseOverlay.ts` 19, `playerPose.ts` 17 and `Enemies.ts` 11. For the classic Alchemist every one of them is
  already a no-op (`ctx.fighters` is absent or its id is null), so they are deleted with their branch, not
  redesigned.
- **6 tests import both games** (`arena-slots`, `duel-audio`, `fighter-arena`, `fighter-run-reset`, `fighters-thorne`,
  `title-menu-model`). Each is trimmed to its Descent half or deleted.

### 2.2 CLASHFORGED deletes the campaign

The survey walks every import from what CLASHFORGED keeps (the arena, the engine, the Builder). It does not walk
from `Game.ts` or `main.ts`, because CLASHFORGED writes its own.

- **219 campaign modules (68,762 lines) are reached by nothing it keeps.** They go at once, with the campaign's
  assets: `public/audio/music` and `public/audio/voice` (58 MB) and `public/assets/living-descent` (2.4 MB). The 141
  Descent-only tests go too.
- **113 campaign modules (28,093 lines) are still imported by kept code.** They stay, as ordinary code in that
  repository, until the code that imports them is trimmed. The Builder alone accounts for 15 of them; the other 98
  are reached from the engine and the arena.
  - The creature roster: species, art, bosses and the Weaver (30 modules).
  - World modules the engine and the Builder read (22).
  - Campaign content and rules that `Player`, `Enemies` and the Builder read: enemy definitions, materials, recipes,
    boons, mutators, perks, difficulty, pacing, the run and the story (22 across `content`, `core` and `config`).
  - The campaign's render layers: the tea machine, flora, organisms and story figures (16).
  - Smaller game and UI helpers.
- **145 imports keep them alive**: 110 from the engine, 34 from the Builder and 1 from the arena. Trimming means
  cutting these imports, then deleting whatever the survey no longer reaches.
- **One coupling has no import.** The Proving Yard's foe buttons (`content/fighterArena.ts` `FOE_PRESETS`) spawn
  Descent's roster creatures by kind string. Training needs its own dummies before the roster can go.

## 3. Checks that every phase must pass

- **Behaviour oracles** (`scripts/split/oracles.mjs record|check <url>`, baseline in `scripts/split/oracles.json`):
  - `sim`: the golden multi-chunk scene stepped in Node (state `58fff223`);
  - `cellSim`: a real generated world, 240 cell-sim ticks in the real game (planes `7738daa3`, per-stream draws);
  - `genGolden`: the cave generator's hashes (`tests/gen-golden.test.ts`);
  - `duels`: 20 seeded stock matches, every fighter on both sides, all four stages.
    - Whole-tick replay is not exact yet, so `record` runs the batch twice.
    - The 19 matches that replay identically are held exactly (winner, ticks, stocks); the other is held to its
      winner only.
    - Both unstable matches seen so far were on the gallery stage.

  Descent keeps `sim`, `cellSim` and `genGolden`. CLASHFORGED keeps `sim` and `duels`, because the cave generator and
  the in-game cell-sim scene go with the campaign. A deliberate behaviour change re-records, and its commit says so.
- **Gate probes** (`node scripts/split/gate-probes.mjs descent|clashforged <url>`, run one at a time):
  - Descent: `verify-runtime-ui`, `verify-tea-machine`, `verify-living-progression`, `verify-run-lifecycle`,
    `verify:findability`, `verify-builder-expedition`, `verify:authorlink`, `verify-title-menu`.
  - CLASHFORGED: `verify-stock-match`, `verify-duel-ui`, `verify-local-versus`, `verify-duel-lan`,
    `verify-fighter-arena`, `verify-fighter-roster-play`, `verify-duel-audio`.
- **Both against a FROZEN worktree's dev server.** A `src` edit hot-reloads a probe's page mid-run, and the failure
  looks real.
- **Each repository's CI is green**: typecheck, lint, tests, production build and its browser checks.

## 4. Phases

Every phase is its own PR in its own repository and leaves that game playable. Phases 2 and 3 run in parallel.

### Phase 0: a clean baseline (this repository, before the copy)

Whatever is on `main` at the copy lands in both repositories, so its fixes and checks are made once, here.

- **CI green on main.**
  - Fixed: the AuthorLink world pull. It gave up 20 s after asking, while a 9.2 MB world was still arriving on a slow
    CI runner (`src/app/authorLinkPull.ts`). The 9 MB itself is a separate bug: the receiver's recolouring no longer
    matches the cave generator, so every cell's colour is sent.
  - Open: the findability audits (`verify:findability`, seed 5). They fail on some runs and not others, because they
    audit a running sim against the wall clock.
- **Oracles recorded**, and identical on a rerun.
- **Gate probes.** Five of the 15 were stale, not the game, and were repaired (`docs/PROBE-HEALTH.md`). All are
  green when run alone, except findability, which waits on its fix.
- **The pruning map and the survey**, above.
- **Exit:** CI green on main; oracles recorded; the 15 gate probes green.

### Phase 1: the copy

1. Land or re-target open arena work first (the Balance Lab, any fighter branch). Both repositories share the
   history, so a branch made before the copy can be pushed to either remote afterwards.
2. Create `falvarez1/clashforged` (private) and push `main` with its history and tags, but not the other branches.
3. Disable GitHub Actions on the new repository until Phase 4 gives it its own CI and deploy. Otherwise the first
   push runs Descent's probes and a GitHub Pages deploy.
4. Clone it to `Y:\Projects\clashforged`, with its worktrees in `Y:\Projects\clashforged-worktrees\`.
5. Move the untracked Duel sprite library (`Y:\Projects\alchemists-descent-worktrees\sprite-library`, 986 MB, never in
   git) to `docs/arena/platform-fighter/sprite-library` in that checkout, where it stays ignored.

- **Exit:** both repositories build, test and pass their gate probes, unchanged (each still holds the whole game).
- **Downstream: the Balance Lab starts in the new repository the day this phase lands** (`docs/arena/DECISIONS.md`
  D-021, revised for two repositories). Until then every fighter change follows the interim routine in
  `docs/arena/BALANCE-LAB-PLAN.md`.

### Phase 2: Descent deletes the arena (this repository)

1. **The composition root:**
   - `Game.ts` stops building and ticking the Duel's systems.
   - The title loses the Duel and Arena doors and the fighter row.
   - `Levels` loses the Duel stages and the Proving Yard.
   - The console loses its arena packs, and the pause menu its stocks.
2. **The engine hooks:**
   - Delete the 193 `ctx.arena` / `fighters` / `versus` / `duel` branches and the 27 engine imports of arena code.
   - `Ctx` and `core/types.ts` lose the arena's fields and types.
   - The event map loses the arena's events, and the SFX ids lose the Duel's cues.
3. **The modules, assets, server, tests, scripts and docs** listed in 2.1. CLAUDE.md loses the fighter, Duel and
   arena-probe sections; the indie-game-dev skill loses the fighters.
4. **Saves.** `RunSaveState` and the meta profile still read a fighter field and drop it (the classic Alchemist),
   never an error. A test loads a recorded pre-split save and profile.

- **Exit:**
  - the survey finds no arena modules and nothing to cut;
  - the Descent oracles are identical and its gate probes green;
  - the production bundle holds no fighter or Duel module (a check like `verify:builder-bundle`);
  - CI is green.

### Phase 3: CLASHFORGED deletes the campaign (the new repository)

1. **A composition root and entry of its own.**
   - It is `Game.ts` without the campaign's systems: the run director, story, Sanctum, waves, mutators, brewing, the
     tea machine and flora.
   - The Duel lobby is the front door until Phase 4 builds the shell.
   - Worth aiming for: a root that can play a match with no DOM, WebGL or audio. The Balance Lab's first measurement
     (BL0.5 in `docs/arena/BALANCE-LAB-PLAN.md`) decides whether its batch runner uses Node worker threads (an expected
     5-10 times the throughput of headless pages) or browser pages.
2. **Delete what nothing reaches:** the 219 modules, the campaign assets, the 141 Descent tests, and the Descent
   probes and docs.
3. **Trim the 113 kept modules** by cutting their 145 imports.
   - Engine code that reads campaign rules (boons, mutators, perks, difficulty, pacing) takes the campaign's default
     value in place.
   - The Builder gets the Duel's content (stages, platforms, its own placeables) instead of the campaign's palette,
     prefabs and levels.
   - Rerun the survey after each cut and delete what it no longer reaches.
4. **Training gets its own dummies**, registered by the Duel. Then the creature roster goes.
5. **Storage.** CLASHFORGED is its own origin (its Worker's domain, and another port in dev), so its
   `localStorage` is already separate. Its keys still get their own prefix in place of `alchemists-descent-*` and
   `noita-*`.

- **Exit:**
  - the CLASHFORGED oracles are identical and its gate probes green;
  - no Descent screen, string or asset is reachable;
  - the survey's campaign count is what the remaining imports justify.

### Phase 4: CLASHFORGED stands on its own

- **Its shell, from the foundry kit:** title, options, controls, dialogs, toasts, loading and credits (references in
  `Y:\Projects\alchemists-descent-worktrees\UI\V1`). Training becomes a player-facing mode.
- **Brand:** `config/brand.ts`, favicon and `package.json` name.
- **Its CI**: typecheck, lint, tests, build and its own browser checks.
- **Its deploy:**
  - its own Worker with static assets (D5): `_headers` (COOP/COEP) served natively, and the Duel room Durable Object
    in the same deployment;
  - in dev, the Cloudflare Vite plugin runs the room in Cloudflare's runtime inside the Vite server, so dev and
    production run the same room code. It replaces the Node `ws` plugin (`servers/duel/server.ts`); the room logic
    (`servers/duel/Room.ts`, already free of sockets and browser APIs) is hosted once;
  - a hosted probe like `verify-hosted-game`;
  - its own deploy skill;
  - its own `AUTHORLINK_URL` variable and Cloudflare credentials. No relay token ships in a public build.
- **Its docs:** `CLAUDE.md`, `ARCHITECTURE.md`, `PROBE-HEALTH.md`, the arena docs at the top level. Claude's memory
  is per checkout path, so it starts empty there; seed it with the arena notes.

- **Exit:** CLASHFORGED deploys to its own site, and no Descent screen or string is reachable from it.

## 5. Working across two repositories

- **Porting a fix.** While the histories are close, add the other repository as a remote and `git cherry-pick` the
  commit, noting `Ported from <repo>@<sha>` in the message. Nothing obliges a port: the engines are allowed to
  diverge.
- **Tooling** is copied once and then owned by each repository: the probe harness (`run-helpers`, `browser-launch`),
  the ElevenLabs client and the perf benches. The paid ElevenLabs cache on this machine stays shared.
- **The Balance Lab** (`docs/arena/BALANCE-LAB.md`) is CLASHFORGED tooling and is built in the CLASHFORGED
  repository, starting the day the copy lands (D-021 as revised). It keeps this repository's layout, so its planned
  paths are final: `src/content/fighters/sheets/`, `src/fighters/analysis/`, `lab.html` with `src/lab/`, `src/dev/`
  and `tools/lab/`.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Open branches during the copy | Land them first, or push them to the new repository afterwards (the histories are shared) |
| Behaviour drifts while code is deleted | Oracles and gate probes on every PR in both repositories; delete by reachability (the survey), not by judgement |
| Descent players lose a save or profile | Keys unchanged; the fighter field is read and dropped; a test loads a recorded pre-split save |
| The new repository's workflows fire on its first push | Actions disabled on it until Phase 4 |
| A secret or variable is missing in the new repository | Phase 4 adds `AUTHORLINK_URL` and the Cloudflare credentials; no relay token in a public build |
| A bug fixed in one repository lives on in the other | Accepted (D1); port it while the histories are close |
| The untracked sprite library is lost | It moves by hand in Phase 1 and stays ignored |
| The copy slips, and balance tooling waits with it (the Lab starts the day it lands, D-021) | The copy is short and comes first; the interim balance routine (`docs/arena/BALANCE-LAB-PLAN.md`) covers every fighter change until then |

## 7. Open questions (recommendation first)

- **The AuthorLink relay for CLASHFORGED:** a Durable Object in CLASHFORGED's own Worker, beside the Duel rooms
  (recommended: one deployment, as D5 argues, and the protocol and tuning ranges will diverge); or share Descent's
  relay, with both origins allowlisted.
- **CLASHFORGED's dev port:** 5175 (recommended), so both dev servers can run side by side.
- **CLASHFORGED's visibility:** private until it launches, then decide.

## 8. The superseded monorepo plan

The first version of this plan (PR #20) kept one repository: a pnpm monorepo with shared `engine`, `fighters`,
`ui-kit` and `authoring` packages.

- **It needed the engine to stop naming either game.** That meant neutral actor contracts in place of the 193 arena
  calls, a `GameKernel` with game modules in place of `Game.ts`, registries for levels, render layers, audio, input
  and enemies, and a `Ctx` split by declaration merging. Its boundary ratchet started at 204 forbidden imports.
- **It was dropped (D1)** once it was clear that the two engines will diverge. That work would have bought a shared
  engine neither game wants.
- **Carried over:** D2, D3 and D5 (with its revision to a Worker, D-022), and Phase 0's oracles, gate probes and
  import survey, now the pruning map. The ratchet test did not, because it enforced the monorepo's package layout.

The full text is in git at `e81d94e`, and with its D5 revision and the Balance Lab note at `0e800ec`.

## 9. Out of scope

- Online (non-LAN) Duel play: rooms, authentication, rate limiting and latency handling. D5 hosts it in the same Worker
  as the game (a Durable Object per room, Containers later for server-run matches); building it is its own project.
- New arena features: match modes, more fighters, bots beyond today's.
- The root port references (`noita-sandbox.html` and friends): Descent keeps them; CLASHFORGED may delete them.

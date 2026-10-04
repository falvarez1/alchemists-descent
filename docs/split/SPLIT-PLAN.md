# Splitting the repository into two games

Status: **plan, approved decisions, nothing moved yet** (2026-10-04, branch `feature/split-clashforged`, baseline main `0437216`).

The Duel has grown into its own game. This plan turns one repository that ships one game into one repository that ships
two, sharing a single engine:

- **CLASHFORGED**: the Smash-style fighter (Duel, stock matches, LAN, ten fighters, announcer, Training), dressed in
  the foundry UI kit on every screen.
- **Alchemist's Descent / Breathing Works**: the campaign as it is today, with the arena removed (classic
  Alchemist only).

## 1. Decisions

Each one was chosen for the long-term architecture, not for the least work.

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Fork or monorepo | **Monorepo with a shared engine package** | A fork duplicates the engine and drifts; an engine fix should land in both games in one commit. |
| D2 | What CLASHFORGED keeps | Duel, LAN, lobby, **Training** (the Proving Yard, player-facing), the **Builder** (dev-only, stage authoring), **AuthorLink** (dev-only live tuning). Not the Sandbox. | |
| D3 | Descent and the arena | **Descent drops the arena entirely**: no Duel/Arena doors, no fighter picker, no fighters in runs. It keeps only the engine's generic hooks. | |
| D4 | Where the Builder and AuthorLink live | **Shared `packages/authoring`**. Each game supplies its content through provider interfaces. | One editor, no copies. An app importing from another app would be a structural mistake. |
| D5 | CLASHFORGED hosting | **Its own Cloudflare Pages project** (`clashforged.pages.dev`, Ajar Red account). Descent keeps `alchemists-descent.pages.dev` and GitHub Pages. | Cloudflare Pages can send the COOP/COEP headers the threaded sim needs, and a future online-Duel server can run as a Durable Object beside the AuthorLink relay. GitHub Pages allows one site per repo and cannot send headers. |
| D6 | Repository name | **Rename to a studio name** (e.g. `purple-llama`) at the end of the split. | The repo will hold two games, so it should not be named after one. Descent's GitHub Pages URL changes and `alchemists-descent.pages.dev` becomes its main URL. |
| D7 | Package manager | **pnpm workspaces**. Turborepo is deferred until CI time warrants it. | pnpm's strict resolution refuses undeclared imports, so the package boundaries are enforced when a module resolves, not only by our own test. |
| D8 | Order of work | **Untangle in place first, move files last.** | Moving files while the graph is tangled breaks both games for weeks. Untangling first keeps every PR mergeable and both games green. |

## 2. What the survey measured

`node scripts/split/survey.mjs` resolves every import in `src/` (static, type-only, dynamic and `import.meta.glob`),
assigns each module to its target package by first-cut ownership rules, and lists every import that crosses a
boundary the target layout forbids. Full detail goes to `verify-out/split/survey.json`. Rerun it after every phase.

Baseline at `0437216`:

| Target | Modules | Lines |
|---|---:|---:|
| `apps/descent` | 313 | 91,141 |
| `packages/engine` | 282 | 81,133 |
| `packages/authoring` (Builder, AuthorLink) | 54 | 33,273 |
| `packages/fighters` | 60 | 17,015 |
| `apps/clashforged` | 97 | 16,798 |
| `game/Game.ts` (the composition root, splits in Phase 2) | 1 | 1,230 |

**248 forbidden edges:**

| From → to | Edges | Files | What it is |
|---|---:|---:|---|
| engine → descent | 92 | 50 | The renderer draws the tea machine, flora and organisms. `Player`, `Enemies` and the wands import campaign content (mutators, perks, enemy defs, reward pools). Audio imports the score, narration and lore. |
| authoring → descent | 84 | 23 | The Builder reads campaign content directly: palette, prefabs, enemy defs, levels, backdrops, asset database. |
| engine → clashforged | 19 | 12 | `Player` (arena rules, stock movement), physics, lighting, camera, `FrameComposer` (stage art, KO fx), `PlayerSprite`, audio, input (pads, versus devices), `core/types.ts`. |
| clashforged ↔ descent | 27 | 16 | `Levels` builds the Duel stages, `PauseOverlay` knows stocks, the title and run carry a fighter, the console has arena commands. |
| descent / engine → fighters | 17 | 14 | Runs, meta profile, title model, events, sprites. |
| other | 9 | | |

Beyond imports, shared code calls the arena **193 times** through `ctx.arena`, `ctx.fighters`, `ctx.versus` and
`ctx.duel`, in 27 files. `Player.ts` accounts for 60 of them, `Game.ts` for 29 and `PauseOverlay.ts` for 19.
`Game.ts` builds 17 Duel systems directly and threads them through the tick (`ctx.arena?.runRivals('body')`,
`ctx.duel?.beforeTick()`, replica gating).

Arena code itself leans on `ctx.enemies` / `ctx.enemyCtl` (kits target foes; the yard has dummies), wands, flask,
projectiles, spells, physics, rigid bodies and particles. The enemy **framework** and combat are therefore engine
code, even though the creature **roster** is Descent content.

**Tests** split cleanly: 143 Descent, 50 CLASHFORGED, 80 engine, 8 both (`ai-*`, `player-sprite-visibility`,
`title-menu-model`). **Scripts**: 74 of the 426 runnable scripts are arena probes and tools.

## 3. Target layout

```
packages/
  engine/       cell sim + World, worldgen primitives, render + lighting + bloom, physics (Rapier), entities (Player,
                Enemy framework, rigid bodies), combat (wands, spells, projectiles, flask), particles, audio engine,
                input, net transport, the WASM kernels, the game kernel (loop, fixed step, frame order), the
                actor-slot runtime, the registries in section 4
  fighters/     what a fighter IS: roster, bodies, techniques, loadouts, kits, FighterSystem, looks, fighter art
  ui-kit/       the foundry kit: foundry-ui.css (.fk-*), kit.json + art, foundryKit.ts preloader, the gallery page
  authoring/    the Builder + AuthorLink (client, relay room, Vite plugin, Cloudflare worker); dev-only in both apps
apps/
  descent/      the campaign: levels, worldgen biomes, creatures roster, run/meta/boons/mutators, story + narrator,
                title, HUD, Sandbox, campaign content and assets
  clashforged/  match rules (stocks, shields, grabs, ledges, specials), ArenaSlots rules, AI bots, Duel + LAN
                (client, room, server), lobby, HUD, stages, announcer, Training, its title/options/credits shell
tools/
  shared/       run-helpers, probe harness, art + audio pipelines (ElevenLabs client), perf benches, the split survey
  descent/      the campaign probes (verify-*, shot-*, studios)
  clashforged/  the Duel probes, fight-batch / fight-analyse / tuner, fighter-studio, sprite + stage pipelines
servers/        relay deploy configs that are not packages (moved under authoring/ or clashforged/ where they belong)
```

**Allowed dependencies** (a package may import only what is listed; type-only imports count):

```
engine        → (nothing)
ui-kit        → engine
fighters      → engine
authoring     → engine
descent       → engine, authoring
clashforged   → engine, fighters, ui-kit, authoring
tools/*       → anything (they drive the apps through the page)
```

`apps/*` never import each other. A package never imports an app.

## 4. The seams: how the engine stops naming either game

### 4.1 The game kernel and game modules (replaces `Game.ts`)

`Game.ts` today is three things: the loop (fixed-step accumulator, frame order), the construction of every system,
and the game rules threaded through the tick. The engine keeps the first; each app owns the other two.

- `packages/engine/kernel`: `GameKernel` owns the clock, the frame order, the sim bounds, the render pass and the
  core systems (World, Simulation, renderer, lighting, camera, physics, particles, audio engine, input, the
  player slot runtime).
- A **`GameModule`** interface with **named, ordered hooks**, one for each place a game acts on the tick today:
  `install(ctx)`, `beforeTick`, `extendSimBounds`, the actor phases (`body`, `flask`, `wands`), `afterTick`,
  `frame(now)`, `isReplica` (a LAN guest renders authoritative state and runs no sim), `dispose`.
- Each app has a **composition root**: `apps/descent/src/DescentGame.ts` and `apps/clashforged/src/ClashGame.ts`.
  Each builds the kernel and installs its modules.
- **The frame order stays a contract**, documented in the engine's ARCHITECTURE.md and pinned by a test that
  records the hook order. Hooks run in a fixed order; modules cannot reorder the kernel.

### 4.2 Several fighters in one world: the actor-slot runtime moves into the engine

`ArenaSlots` (898 lines) mixes two jobs. One is generic: N player bundles in one world, binding `ctx.player` to a
slot, a per-slot time scale (a slow is time), a seeded resolution order each tick. The other is the stock-match
rules. The generic half becomes the engine's `ActorSlots`; Descent uses one slot. The rules stay in CLASHFORGED.
This also keeps online play, peer ghosts and any future co-op on one runtime.

### 4.3 Neutral actor contracts instead of `ctx.arena` / `ctx.fighters` (the 193 calls)

The engine's `Player` asks neutral questions; a game answers them. The engine provides defaults that reproduce
today's campaign behaviour exactly.

| Engine contract | Replaces | What it answers |
|---|---|---|
| `ActorRules` | `ctx.arena` in `Player` and physics | damage scale by source, invulnerability window, evading/blocking a hit, redirecting damage (stock percent), what a knockout does (a death screen or the match decides), action locks |
| `MovementExtension` | the stock dodge/shield/grab/ledge/recovery/fast-fall calls | a pipeline the player controller runs: filter the keys, then claim the body before or after the engine's own move |
| `ActorAbilities` | the engine-facing part of `ctx.fighters` | body multipliers (`NEUTRAL_BODY` in the engine), move/climb scale, climb holds, owns-movement, stagger resistance, melee notes |

`ARENA_RULES`, `STOCK_FAST_FALL` and `STOCK_STAGES` leave the engine and become values the CLASHFORGED
implementations return.

### 4.4 `Ctx`: an engine core plus per-app extensions

`core/types.ts` (4,056 lines) splits along the same lines:

- `packages/engine` declares `Ctx` with only engine services.
- Each app adds its own fields by **declaration merging** in one file per app (`apps/descent/src/ctx.d.ts`:
  `run`, `story`, `mutators`, `brewing`...; `apps/clashforged/src/ctx.d.ts`: `match`, `versus`, `duel`,
  `fighters`).
- The engine is type-checked as its own program, so engine code that touches an app field fails to compile.
  That is the guarantee, not a convention.
- Event names and SFX ids (the 447-member union) extend the same way: the engine's union plus each app's.

### 4.5 Registries: the engine owns the slot, the game owns the content

These replace hard-coded ids and direct imports:

- **Levels.** `LevelHost` keeps World-per-level persistence, enter/leave and the curtain. Apps register level
  definitions with `build(ctx)`, objective and curtain text. This removes `if (id === 'fighter-duel')` from
  `Levels`; Descent registers floors and its test arenas, CLASHFORGED its stages and the Training yard.
- **Render.** `FrameComposer` layers (stage art, atmosphere, KO fx, fighter fx, the tea machine, flora, organisms,
  story figures), camera rigs (`StockCameraRig`), player appearance providers (`FighterArt`, Duel sprites),
  lighting stage profiles.
- **Audio.** The engine keeps `AudioEngine`, `SfxEngine`, mix, buses and streams, plus the sound bank its own
  systems emit (materials, explosions, spells, player foley). Apps register cue banks, scores, the narrator or the
  announcer. Music rules are per app.
- **Input.** Device providers (versus devices, stock pad) and binding sets per app.
- **Enemies.** The engine keeps the enemy framework and a kind registry. The creature roster, its defs and its art
  register from Descent; Training dummies register from CLASHFORGED.
- **Overlays.** Pause-menu sections, console command packs, HUD panels.

### 4.6 Builder content providers (the 84 Builder → Descent edges)

`packages/authoring` defines `AuthoringContent`: material palette, prefabs, placeable kinds, level/stage templates,
backdrops, the asset database and a compile target (the host app's runtime, through `BuilderHost`). Descent supplies
the campaign set. CLASHFORGED supplies stages, platforms and its own placeables, which makes stage authoring a real
feature rather than a side effect.

### 4.7 Saves and storage

- Every `localStorage` / IndexedDB key goes through one app-scoped namespace. In dev, both apps run on `localhost`
  and would otherwise overwrite each other's keys. There are 37 files that touch `localStorage` today.
- Descent saves keep their keys, so no player loses a run. A Descent save or meta profile that names a fighter
  loads as the classic Alchemist; the field is read and dropped, never an error.
- CLASHFORGED starts its own namespace and imports nothing from Descent saves.

## 5. Tooling, build, CI and deploy

- **Workspaces.** pnpm with a `pnpm-workspace.yaml`. Internal packages are consumed as **TypeScript source**
  (`"exports": { "./*": "./src/*.ts" }`), so there is no package build step and Vite compiles everything.
- **Imports.** Imports become package names (`@purple-llama/engine/sim/World`), including a package's
  self-references. The `@/` alias goes, because it cannot mean one thing in shared code compiled by two apps. Hard
  invariant 7 in CLAUDE.md changes accordingly. The rewrite is a codemod.
- **Type checking.** Each package and app has its own `tsconfig` (strict, as today), run per workspace. The engine
  checked alone is what proves 4.4.
- **Boundaries.** `tools/shared/split/survey.mjs` becomes a test: zero forbidden edges, using each
  `package.json`'s declared dependencies. pnpm enforces the same rule at resolve time.
- **Tests.** Vitest projects per package and app. The 8 mixed tests split with their subjects.
- **Vite.** One config per app on a shared preset. Each app keeps its `index.html`, its generated `builder.html`
  (authoring builds only), its world-layer chunk rule (the rule moves to package paths) and its
  `__AUTHORING__` gate. The AuthorLink relay plugin comes from `packages/authoring`; the LAN Duel plugin from
  `apps/clashforged`.
- **Dev ports.** Descent stays on `:5173`; CLASHFORGED moves to `:5175`. Probes take their URL from a per-app
  default.
- **Assets.**
  - `public/audio/music` and `public/audio/voice` (58 MB) go to Descent.
  - `public/audio/duel`, `public/assets/arena` and `public/assets/fighters` go to CLASHFORGED (or to fighters where
    they are roster art).
  - The kit art goes to ui-kit.
  - The engine's own SFX bank goes to the engine.
- **CI.** One workflow with a job per app: typecheck, lint, tests and production build per workspace, then each
  app's browser checks. The engine job runs when anything under `packages/` changes. The existing red "Runtime
  browser safety probes" step (see PROBE-HEALTH) is fixed or quarantined in Phase 0, so the split can be judged on
  a green baseline.
- **Deploy.**
  - Descent keeps both deploys.
  - CLASHFORGED gets its own Cloudflare Pages project with its own `_headers` (COOP/COEP) and a hosted-build probe
    like `verify-hosted-game`.
  - No relay token ships in either public build.
  - The repo rename (D6) is the last step, with the GitHub Pages base path and the AuthorLink origin allowlist
    updated in the same change.
- **Docs.**
  - A root CLAUDE.md (the monorepo, the boundaries, the commands).
  - One CLAUDE.md per app and per package, which Claude Code loads when working in that folder.
  - ARCHITECTURE.md per package; the campaign's frame-order contract moves to the engine's.

## 6. Phases

Every phase is its own PR (or a short series), merges to main on its own, and leaves **both games playable with
their checks green**. Phases 1–5 change no folder layout.

**Behaviour oracles** recorded in Phase 0 and re-checked after every phase:
- sim determinism hashes (`verify:determinism`, `bench-sim` behaviour hash);
- the cave generator golden test (`tests/gen-golden.test.ts`);
- seeded `fight-batch` results (winner and tick count per seed, against a frozen worktree server);
- the probe set from section 6.0.

### Phase 0: guard rails
- Check in the ownership map (generated by the survey, plus manual overrides for the cases the rules get wrong).
- A ratchet test fails if the forbidden-edge count rises above the recorded baseline.
- Record the oracles. Triage main's red CI step (PROBE-HEALTH.md) so the baseline is green.
- **Gate probes**:
  - Descent: `verify-runtime-ui`, `verify-tea-machine`, `verify-living-progression`, `verify-run-lifecycle`,
    `verify:findability`, `verify-builder-expedition`, `verify:authorlink`, `verify-title-menu`.
  - CLASHFORGED: `verify-stock-match`, `verify-duel-ui`, `verify-local-versus`, `verify-duel-lan`,
    `verify-fighter-arena`, `verify-fighter-roster-play`, `verify-duel-audio`.
- **Exit:** ratchet test in CI; oracles recorded; gate probes green on main.

### Phase 1: the actor-slot runtime and neutral actor contracts (4.2, 4.3)
- Extract `ActorSlots` from `ArenaSlots`.
- Introduce `ActorRules`, `MovementExtension` and `ActorAbilities` with campaign-exact defaults. Move `Player`,
  physics and sprites onto them.
- **Exit:**
  - no `ctx.arena` / `ctx.fighters` call left in engine-bound entities;
  - `engine → clashforged` and `engine → fighters` edges from `entities/` at zero;
  - oracles identical.

### Phase 2: the game kernel (4.1)
- Split `Game.ts` into `GameKernel` plus a Descent module and a CLASHFORGED module. One composition root still
  installs both, so it is still one app and one bundle.
- A test pins the hook order.
- **Exit:** `Game.ts` gone; no Duel system named outside the CLASHFORGED module; oracles identical.

### Phase 3: registries and the `Ctx` split (4.4, 4.5)
- Levels, render layers, camera rigs, audio banks, input devices, enemy kinds, pause sections and console packs
  become registries.
- `core/types.ts` divides into engine contracts plus per-app extensions.
- **Exit:** `engine → descent` and `engine → clashforged` edges at zero; the engine type-checks as its own program.

### Phase 4: Builder content providers (4.6)
- `AuthoringContent`; Descent's provider reproduces today's Builder exactly.
- **Exit:** `authoring → descent` at zero; every Builder probe green
  (`verify-builder-suite`, `-expedition`, `-pro`, `-prefabs`, `-power`, `verify:authorlink`).

### Phase 5: two entry points, Descent without the arena (D3, 4.7)
- Two composition roots and two HTML entries in the current tree: `index.html` (Descent) and `clashforged.html`.
- Descent's root installs no arena module. This removes the title's Duel and Arena doors, the fighter row, fighters
  in runs and the meta profile, the arena levels, the console's arena commands and the pause stocks.
- Storage namespaces go in. Old-save compatibility gets a test.
- **Exit:**
  - forbidden edges at **zero**;
  - Descent's production bundle contains no fighter or Duel module (a bundle check, like `verify:builder-bundle`);
  - both entries pass their gate probes.

### Phase 6: the physical move (D7, section 3, section 5)
- A **re-runnable script** that does the `git mv`s into packages, apps and tools, writes the `package.json` and
  `tsconfig` files, rewrites imports by codemod, switches to pnpm and splits the Vite configs.
- It is regenerated on top of the latest main, never rebased.
- It runs in a short **freeze window** with no other open branches, because it touches every file.
- History is kept (`git log --follow`).
- **Exit:** both apps build, test and pass their gate probes from their own folders; CI runs per app.

### Phase 7: the CLASHFORGED shell
- Its own title, options, controls, dialogs, toasts, loading and credits, all from the foundry kit (references in
  `alchemists-descent-worktrees/UI/V1`).
- Training mode (the Proving Yard, player-facing).
- Brand config, favicon, the Cloudflare Pages project and the hosted probe.
- **Exit:** CLASHFORGED deploys to its own site; no Descent screen or string is reachable from it.

### Phase 8: docs, cleanup, rename
- Per-app CLAUDE.md and ARCHITECTURE.md; the arena docs move under `apps/clashforged/docs`.
- PROBE-HEALTH split per app; stale worktrees removed.
- **Repo rename (D6)**, with the Pages base path, the relay allowlist and the deploy skill updated together.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Behaviour drift while untangling: the frame order, a stock-match rule or a campaign default changes silently | Oracles after every phase; contract defaults copied from today's code paths, never rewritten; the hook-order test |
| Phase 6 conflicts with every open branch | The move is a script, regenerated on the latest main; announce a freeze window; merge open work first |
| HMR reloads probe pages while files move | Probe batches run against a frozen worktree server (PROBE-HEALTH) |
| Descent players lose saves | Keys unchanged; fighter fields read and dropped; a test loads a recorded pre-split save |
| Both apps share `localStorage` in dev | App-scoped storage namespace (4.7) in Phase 5, before two entries exist |
| Bundle layering regresses (world chunk, lazy Builder) | `bundle-layers.test.ts` and `verify:builder-bundle` carried over per app |
| The repo rename breaks Descent's GitHub Pages links | Last step; `alchemists-descent.pages.dev` stays the main URL; README and links updated in the same change |
| Untracked local art (the 986 MB sprite library) | Kept outside every worktree at `Y:Projectslchemists-descent-worktreessprite-library` (moved there 2026-10-04), so no worktree removal or file move can touch it |

## 8. Out of scope

- Online (non-LAN) Duel hosting. D5 leaves room for it as a Durable Object; it is its own project.
- New arena features: match modes, more fighters, bots beyond today's.
- Turborepo or other build caching (D7), until CI time asks for it.
- Moving `noita-sandbox.html` and the other root reference files. They stay at the root as the port reference.

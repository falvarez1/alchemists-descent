# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Purple Llama Studio's "Alchemist's Descent" — a falling-sand action roguelite: a cellular-automata
material simulation, a Three.js pixel renderer with dynamic 2D lighting (designed darkness, eyeshine,
a hooded lantern) and bloom, ElevenLabs-generated audio (sampled SFX, a score, a narrator — generated
offline by `scripts/audio/*`, audition at `/audition.html`), and a platformer-wizard action game (a four-floor run with return phials, starting kits and a
daily seed — player-facing name "Breathing Works", `config/brand.ts`; wand/spell-card system,
brewing, mechanisms) layered on top. Originally a single 3,818-line HTML file (kept at the repo
root as `noita-sandbox.html` for reference — behavior fidelity to it matters); now a modular
TypeScript + Vite project.

## Commands

```bash
npm run dev                # Vite dev server at http://localhost:5173
npm run build              # tsc --noEmit (strict) + vite build to dist/
npm run typecheck          # tsc --noEmit only
npm test                   # vitest run (all tests, in tests/)
npx vitest run tests/wands.test.ts        # single test file
npx vitest run -t "name"                  # single test by name
npm run verify:findability # multi-seed BFS audit of generated content (gate for worldgen changes)
npm run verify:authorlink  # two-browser-context probe of the cross-window editor link
npm run verify:authorlink-hosted  # production build + EXTERNAL strict relay (origin/token/ranges)
npm run authorlink:server  # standalone AuthorLink relay (dev server hosts one already)
npm run gen:tuning-ranges  # regenerate the relay's range table (--check in verify:tuning-ranges)
npm run gen:builder-html   # regenerate builder.html from index.html (NEVER hand-edit builder.html;
                           # tests/builder-html.test.ts fails when it is stale)
npm run lint               # eslint src
node scripts/verify-game.mjs   # headless browser smoke test (needs dev server running + Edge)
node scripts/perf-scene.mjs    # repeatable perf benchmark (Welch t-test vs saved baseline)
# Performance / FX (docs/PERF-2026-09.md; dev server running): perf-fx-suite.mjs
# (7 stress scenes incl. boss FX, flood, 400-body pile; --ab URL_A,URL_B for an
# interleaved A/B against a frozen worktree's server, --profile, --init),
# probe-gpu-fx.mjs (GPU overlay/particles vs CPU parity; STRICT=1),
# probe-gpu-sparks.mjs, probe-physics-stress.mjs. Node benches: bench-sim.mjs
# (cell sim, behaviour-hashed), bench-light.mjs, bench-rapier-terrain.mjs.
# npm run build:wasm builds + embeds BOTH AssemblyScript kernels (worldgen, light).
# Sandbox MT prototype (docs/SANDBOX-MT.md; ?threads=N, ?subcell=0): probe-sandbox-mt.mjs
# (serial vs parallel timings + phase split), verify-sandbox-mt.mjs (every replayed
# side-effect path), shot-subcell.mjs (sub-cell look on/off), diag-sandbox-mt-frames.mjs.
# After any npm install/upgrade restart the dev server with --force: a running
# server keeps serving the old pre-bundled dependency.
# Builder end-to-end probes (dev server running): verify-builder.mjs,
# verify-builder-suite.mjs, verify-builder-expedition.mjs,
# verify-builder-pro.mjs, verify-builder-ux.mjs, verify-builder-prefabs.mjs,
# verify-builder-power.mjs, verify-sprites.mjs, verify-machines.mjs,
# verify-gallery.mjs
# Fighters (docs/FIGHTERS.md; dev server running): fighter-probe.mjs is the shared harness (a PAUSED world you
# step with the game's own tick, REAL key presses, a carved arena); verify-fighter-framework (the engine seams),
# verify-fighter-<name> per kit, verify-fighter-roster-play (all ten through a real run), fighter-studio.mjs
# (every fighter in every pose: THE way to iterate a look). Never edit src while a probe runs (HMR reloads it).
# Builder probes arm things through run-helpers (the shell groups tools, tabs the palette and
# hides the game header while it is open): clickBuilderTool(page,'rectFill'),
# clickBuilderKind(page,'door'), clickBuilderControl(page,'#b-save') (opens the menu/tab that
# holds it), openBuilderPaletteTab, toggleBuilderMode (header button, or #b-exit when hidden).
# Worldgen eyeball/diag: shot-biomes.mjs (overview PNGs), diag-biome.mjs,
# shot-blueprint.mjs <levelId...> (FULL-level HUD-free blueprint PNG with
# labeled inspection markers + spawn/player/enemy dots - THE way to judge
# any authored level's layout; camera crops cannot show the big picture)
# Creatures (dev server running; docs/CREATURES.md): creature-studio.mjs
# --kind <k> --scenes idle,walk,... (real rig + art in a staged mini-world,
# zoomed frame strips — THE way to iterate creature look/motion),
# shot-enemies.mjs (whole roster in-game), probe-corpses.mjs, probe-alive.mjs
# (footfalls/splashes/tracks/vines/critters), bench-creatures.mjs,
# perf-creatures-live.mjs. Player (docs/PLAYER-ART.md): player-studio.mjs
# (every action posed + costume-ticked, zoomed), probe-player-death.mjs
# Proving Yard (dev server running): verify-fighter-arena.mjs (the Arena door to the yard, the hall, the panel, every fighter's Z and T,
# the ram, the keg), shot-blueprint.mjs fighter-test (the whole hall).
# Title menu (dev server running): verify-title-menu.mjs (the menu at three sizes: keys, rows, lists, seed, pointer, a
# fake pad the game polls, Descend starts what the rows say), shot-title.mjs (every page, for the eye).
# Gameplay/runtime probes (dev server running): verify-tea-machine.mjs (floor 1 PLAYED with
# real input: barricade, crank, the three faults, bell, gate), verify-living-traversal.mjs /
# verify-living-progression.mjs / verify-run-lifecycle.mjs (route to the Sanctum, boon + door, all
# four floors, victory ledger), verify-progression-pacing.mjs, verify-hint-system.mjs,
# verify-first-run-hints.mjs, verify-death-causes.mjs, verify-overlay-hit.mjs (every menu's
# controls reachable across window sizes), verify-bat-slime.mjs, verify-god-mode-qa.mjs.
# A probe that presses keys after Begin must run-helpers' waitForOpeningEnd() (the opening's
# plates skip on any key), and one that descends must chooseBoonAndDoor() (the stair forks).
# Probes that hit `window.__game` in test arenas: the arena's #wave-banner never fades and holds
# every teach card; a level's first 2 s are an arrival grace (`arrivalGraceUntil`) too.
# Audio (dev server running): verify-audio-mix.mjs — buses/limiter/pan/attenuation,
# volume sliders + persistence, stingers, lazy Grimoire art (we cannot listen:
# ctx.audio.debugSnapshot() / debugRenderOffline() are the instruments)
node scripts/gen-builtin-prefabs.mjs   # regenerate src/world/prefabs/builtin/*.json
node scripts/gen-machine-prefabs.mjs   # regenerate the machine-*.json structure prefabs
```

Headless verification uses `playwright-core` driving system Edge (channel `'msedge'`) against the
dev server. `scripts/verify-*.mjs` show the pattern.

## Architecture (big picture)

`ARCHITECTURE.md` has the full module map; `src/core/types.ts` is **THE contract file**.

- **Ctx composition root.** Every shared dependency lives on one `Ctx` object built in
  `src/game/Game.ts`. Systems call each other only through the `Ctx` *interface*
  (`ctx.explosions.trigger`, `ctx.physics.cellBlocks`, `ctx.audio.boom`...). Never import another
  system's concrete class; concrete imports are allowed only for foundation modules (`config/`,
  `core/`, `sim/CellType`, `sim/colors`, `sim/World`, `sim/stains`, `sim/brush`, `render/pixels`).
- **Flat typed arrays.** The grid is five TypedArrays on `World` indexed `x + y * WIDTH`. Colors
  are packed `0xRRGGBB` numbers (`packRGB`/`unpack*` in `sim/colors`).
- **Events outward, calls inward.** Gameplay never touches the DOM — it emits typed `EventBus`
  events (`core/events.ts`) that UI modules subscribe to. Audio stays a direct API call.
- **Two clocks.** The cell sim runs fixed-step substeps (≤6/frame) inside a 60Hz fixed-timestep
  game tick (`Game.step` accumulator — game speed must not depend on monitor refresh rate);
  entity AI/render details run at tick rate. All tuning constants assume this split; don't unify.
- **Frame order is a contract** (documented in ARCHITECTURE.md). Sim bounds derive from the
  camera, spells aim with the *previous* frame's render snapshot, lighting rebuilds every
  other tick. Do not reorder `Game.tick` casually. Never gate render-side work on
  `frameCount` parity alone: a render can run two ticks, which parks the parity.
- **The Builder's shell is `src/builder/shellMarkup.ts` + `styles/studio-chrome.css`** (tokens in
  `styles/studio.css`, old rules in `builder.css`: no colour literals in any of them). Handlers bind by
  element id (`this.el('b-save')` throws on a miss) and ~20 probes click the same ids: a control may
  MOVE, it keeps its id (`tests/builder-shell-markup.test.ts`). The Builder owns the terrain while open:
  a document with none captures the live grid on save/validate/play, and opening over a changed Sandbox
  asks which copy to edit. See `docs/BUILDER-STUDIO.md`.
- **Fighters are for the ARENA mode, not the campaign** (`src/fighters/`, docs/FIGHTERS.md): ten, each a look, a passive,
  a tactical (Z) and an ultimate (T). The campaign is the classic Alchemist only; the title's Arena door (authoring
  builds) starts the Proving Yard (`world/fighterArena`, level `fighter-test`, `ui/FighterArenaPanel`), the test
  arena where each is walked through every move. The arena MODE itself (rules, several fighters, bots) is not built. `ctx.fighters` is absent in test contexts and `id` is null for the classic Alchemist,
  so every engine hook (`ctx.fighters?.…`) is a no-op by default; `FighterSystem` owns the shared machinery
  (cooldowns, ultimate charge, modifiers, a foe's slow/stun/reveal, a body-owning `startMove`, armor, drawables,
  lights) and a kit (`fighters/kits/<id>.ts`, lazy, found by filename: helper modules are `<id>-<what>.ts`) is
  only the rules. A foe's slow is TIME (`enemyRuns`), never a per-sample velocity scale. The look
  (`render/player/looks/<id>.ts`) is the alchemist's own rig and cloth dressed differently, never a sprite. A
  fighter still rides a run the way `kitId` does (config, `RunSaveState`, meta profile) so the arena can reuse it, but
  no campaign UI sets one and the daily is always the classic Alchemist.
- **The title is a game menu, not a page** (`src/ui/title/`, docs/TITLE-MENU.md): a short main list, each door a page
  (New descent is the loadout: case / fighter / difficulty / seed / Descend), a detail card beside the focused row.
  `titleMenuModel.ts` is the pure part (tested), `TitleMenu.ts` the engine, `ExpeditionEntry.ts` the pages. Items are
  buttons with `data-entry` ids the probes click; the focused row is the selection (styled on `:focus`), and the pad
  presses the same keys as the keyboard. Starting a run through the title is TWO clicks: `begin` then `descend`.
- **Three authoring/save families, kept separate:** Sandbox (live-sim painting, raw grid v1
  saves), the Builder authoring tool (`EditorDocument` v2 in `src/builder/`, compiles disposable
  playtest runtimes — see `docs/BUILDER.md`), and expedition runtime saves. Don't grow one
  format into another's job.
- **AuthorLink is the cross-window editor link** (`src/net/` + `src/app/AuthorLink.ts`). Two
  windows of the app join a room over a WebSocket the dev server hosts, and live tuning,
  Builder terrain strokes, and console lines sync between them. Peers are symmetric — no
  authority. `src/net` must not import `src/builder`; the Builder publishes only through
  `BuilderHost.publishTerrainPatch`.
  Authored objects/links/lights sync as a WHOLE SET through the same
  `instantiateObjects` the playtest compiler uses; the receiver removes only what
  the link created (deleting a door explicitly un-stamps its metal, which the
  runtime — not the instantiation setter — wrote).
  **Every cell patch is tagged with a `WorldIdentity` and refused on mismatch.** A `CellPatch`
  is only indices, and every world is 1600×1064, so size proves nothing — without the tag a
  Builder stroke lands at the same offsets inside an unrelated level. The Builder's **Game link**
  button (`src/app/LinkControl.ts`; ALL the judgement is the pure `src/app/authorLinkView.ts`) names
  the state and the one action — *Open game window*, or *Use the game's level* (pull) when a peer is
  on another world; the old header pill (`LINK ≠`, text and `data-state` kept for the probes)
  remains in the game window. The editor has its own route (`/builder.html`,
  a second Vite input, `body.editor-window`) — `verify:builder-bundle` checks BOTH entries.
  Relay behavior lives ONCE in `servers/authorlink/room.mjs`; the Node host and the
  Cloudflare Durable Object host only own sockets. Hosted rooms run strict (origin
  allowlist at the upgrade, room token for writes, per-path ranges from
  `src/config/tuningRanges.ts`). Relay origin/token are BUILD-TIME env only — never
  the URL. See `docs/REALTIME-TUNING-LAB-AND-MULTIPLAYER-SERVER-SPEC.md`.
- **The material palette is `src/content/materialPalette.ts`, not markup.** The Sandbox
  toolbar renders from it and the Builder reads it directly; never re-type cell ids into
  HTML. Toolbar renders one `.sb-group` (title + `.sb-grid` of tiles) per palette group
  into the dock's Materials panel; the filter finds groups by that class. The authoring
  Sandbox is the Studio design language (`styles/studio.css` tokens, `styles/sandbox.css`,
  behaviour in `ui/SandboxChrome.ts`): every rule in sandbox.css is under
  `body:not(.player-build)` because the player's Workshop is the same DOM in the game's house
  style (sandbox.css's last section flattens the dock's wrappers back to the flat list
  workshop.css expects — compare a Workshop screenshot before/after any index.html change).
  Never set `display` on `#left-toolbar`, `#right-inspector` or the header from sandbox.css:
  `body.play-active`/`body.builder-open` hide them with a selector of the same specificity.

## Hard invariants

1. **Cell IDs are append-only forever** (save-format ABI). `CELL_COUNT` in `sim/CellType.ts`
   must match (currently 44; Mirror=43 is the highest taken id — Leaf 39, Trunk 40, Seed 41 were
   appended by the flora wave, Brine 42 and Mirror 43 by the biomes wave). Never renumber or reuse.
   The marker palette in `sim/cellPalette.ts` is the same kind of ABI (it identifies
   materials in every exported terrain PNG): one appended color per new cell type,
   ≥12 Manhattan RGB from every existing entry, never edited (test-enforced).
2. Entity arrays (`ctx.enemies`, `ctx.projectiles`) are mutated in place — `length = 0` and
   `push(...)`, never reassigned; systems hold the references.
3. `world.swap` is the only safe cell-movement primitive (moves type/color/life/charge in
   lockstep and stamps the moved-epoch). The moved plane uses an epoch counter
   (`world.movedTick`), not per-substep clearing — "moved this substep" is
   `moved[i] === world.movedTick`.
4. Magic numbers are load-bearing (probabilities, asymmetric neighbor lists, cadence throttles
   like `frameCount % 4`). The port preserved them exactly; change deliberately, one at a time,
   and say so in the commit. Approved deviations are listed in `docs/PORTING.md` — don't "fix
   them back". The earthen cave generator is locked by `tests/gen-golden.test.ts` (FNV-1a
   hashes); a deliberate generation change re-records the hashes AND bumps `GEN_VERSION` in
   `config/gen.ts` (expedition saves record it; resume retires mismatched saves).
5. Levels persist as live `World` instances per expedition; anything on `LevelRuntime` survives
   leave-and-return. Transient combat state is cleared on transitions (`Levels.enterLevel`).
6. `config/params.ts` objects are intentionally mutable live-tuning data, not constants.
7. Use `@/` path aliases; `import type` for interfaces; TS strict must pass with zero errors —
   no `any`/`@ts-ignore` suppressions.

## Verification workflow (before any commit)

`npx tsc --noEmit` → `npx vitest run` → `npm run build`, then **runtime-verify in the real
game** — never trust static reads for gameplay. `window.__game.ctx` is the in-page debug handle
(teleport the player, paint cells into `ctx.world.types`, spawn via `ctx.enemyCtl.spawn`).
Hard-won probe gotchas:

- Use real Cell ids (Water=2, Wall=3, Wood=4, Fire=5, Oil=6, Lava=11, Stone=12, Metal=13,
  Gold=17, Moss=34) — don't guess.
- The player is 17 cells tall: teleport targets need ≥24 cells of interior headroom or he wedges
  into ceilings and all movement assertions silently fail.
- Enemies outside the sim window (camera±60) freeze; keep probe subjects in-camera.
  `camera.x` is the view top-left.
- Reading the WebGL canvas (`drawImage`) only works inside a rAF callback
  (`preserveDrawingBuffer` is false).
- Don't dynamic-`import()` game modules in the page (Vite creates a second module instance) —
  drive everything through `window.__game.ctx`.
- Probes must respect the sim: liquids flow, fire rises — contain test materials in metal cups
  and poll, don't single-sample.
- Click UI with REAL clicks (boundingBox + `page.mouse.click`), never synthetic
  `dispatchEvent(new MouseEvent(...))` — synthetic events bypass hit-testing and will happily
  "pass" on a panel that real clicks fall straight through (`#builder-root` is
  `pointer-events: none`; every Builder panel must opt back in with `pointer-events: auto`).

**Mechanism-correct is NOT player-findable.** Any generated/placed content must pass the
findability audit (`npm run verify:findability`): multi-seed BFS from spawn over `!blocksEntity`
cells. Carved structures must call `connectToCaves()` targeting a main-path region; placement
loops degrade criteria progressively, never silently skip.

## Design rules

- **If the grid can't explain it, it doesn't ship.** Every mechanic reads/writes real cells
  (a brew is the cells in the bowl; a secret wall is real wood that really burns).
- **Fail-open:** physics chaos may never hard-lock progression (destroyed mechanisms open their
  gates; the well plug is always a bypass).
- Feel beats features — every mechanic needs visible/audible feedback (this user prioritizes
  micro-interaction polish).

## Where to look

- `ARCHITECTURE.md` — module map, frame-order contract, design decisions
- `.claude/skills/indie-game-dev/SKILL.md` — step-by-step content checklists (new material /
  enemy / spell card / biome / pickup) and the full verification playbook
- `docs/DESIGN.md` — canonical game design; `docs/FEEL.md` — every mechanic/micro-animation
  with its tuning numbers; `docs/BUILDER.md` — Builder tool spec and phases;
  `docs/BOONS.md` — the Sanctum's boons: the pool, each hook, tuning, and what was measured;
  `docs/DIFFICULTY.md` — the four-tier ladder: who may pick which, where it lives, why it fits;
  `docs/PROBE-HEALTH.md` — which `scripts/verify-*` probes pass, which are stale and why (run before trusting a red one)
- `docs/TITLE-MENU.md` — the title as a game menu: the pages, the files, the rules (focus, pointer, key legend), the probes
- `docs/FIGHTERS.md` — the ten fighters and the Proving Yard: the engine seams, every ability's spec, how to write a kit, the probes;
  `docs/fighters/<id>.md` — each fighter's numbers, measurements and deviations; `docs/fighters/KIT-BRIEF.md`
  — the working brief a kit is built to
- `docs/BUILDER-STUDIO.md` — the Builder's shell, design system, Sandbox↔Builder↔game flow and what was cut;
  `docs/BATTLE-ROYALE-AND-SPACETIMEDB.md` — why SpacetimeDB is NOT integrated now and what an arena
  mode needs first (a fighter roster; `ctx.player` is 701 refs in 103 files)
- `docs/MULTIPLAYER-ARCHITECTURE.md` — **archived/frozen 2026-09-26** (the
  SpacetimeDB transport lives only in git tag `archive/spacetimedb`); still the
  reference for the determinism boundary, why the grid is NOT a database, and
  the `SessionTransport` seam AuthorLink runs on
- `docs/PORTING.md` — port conventions + approved deviations; `docs/INVENTORY.md` — system map
  of the original HTML; `docs/UPGRADE-DELTA.md` — what was mined from the prototype files

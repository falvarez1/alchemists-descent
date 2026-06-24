# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Purple Llama Studio's "Alchemist's Descent" — a falling-sand action roguelite: a cellular-automata
material simulation, a Three.js pixel renderer with dynamic 2D lighting and bloom, procedural
audio, and a platformer-wizard action game (8-level persistent descent, wand/spell-card system,
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
npm run lint               # eslint src
node scripts/verify-game.mjs   # headless browser smoke test (needs dev server running + Edge)
node scripts/perf-scene.mjs    # repeatable perf benchmark (Welch t-test vs saved baseline)
# Builder end-to-end probes (dev server running): verify-builder.mjs,
# verify-builder-suite.mjs, verify-builder-expedition.mjs,
# verify-builder-pro.mjs, verify-builder-ux.mjs, verify-builder-prefabs.mjs,
# verify-builder-power.mjs, verify-sprites.mjs, verify-machines.mjs,
# verify-gallery.mjs
# Worldgen eyeball/diag: shot-biomes.mjs (overview PNGs), diag-biome.mjs
# Gameplay/runtime probes (dev server running): verify-intro-progression.mjs
# (D1 surface intro → descent → onboarding spine), verify-descent-progression.mjs,
# verify-progression-pacing.mjs, verify-bat-slime.mjs, verify-death-causes.mjs,
# verify-god-mode-qa.mjs
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
  camera, spells aim with the *previous* frame's render snapshot, lighting rebuilds on even
  frames. Do not reorder `Game.tick` casually.
- **Three authoring/save families, kept separate:** Sandbox (live-sim painting, raw grid v1
  saves), the Builder authoring tool (`EditorDocument` v2 in `src/builder/`, compiles disposable
  playtest runtimes — see `docs/BUILDER.md`), and expedition runtime saves. Don't grow one
  format into another's job.

## Hard invariants

1. **Cell IDs are append-only forever** (save-format ABI). `CELL_COUNT` in `sim/CellType.ts`
   must match (currently 37; RawOre=36 is the highest taken id). Never renumber or reuse.
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
  with its tuning numbers; `docs/BUILDER.md` — Builder tool spec and phases
- `docs/PORTING.md` — port conventions + approved deviations; `docs/INVENTORY.md` — system map
  of the original HTML; `docs/UPGRADE-DELTA.md` — what was mined from the prototype files

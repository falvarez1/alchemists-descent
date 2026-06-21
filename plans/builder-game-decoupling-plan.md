# Builder/Game Decoupling Plan

Status: implementation in progress.
Created: 2026-06-20.
Scope: architecture, source ownership, build boundaries, playtest integration, persistence, and validation for separating the Builder tool surface from the player-facing game runtime without forking gameplay semantics.

Implementation update:

- Phase 0 boundary guardrails are implemented: `verify:builder-boundaries` is wired into `package.json` and CI.
- The first neutral authored-contract layer is implemented under `src/authoring` for document shapes, prefab contracts, sprite runtime contracts, and structural stamps.
- Runtime, worldgen, and player-facing UI no longer import Builder-owned modules; strict boundary verification passes with zero violations.
- Builder remains available through a lazy shell-owned launcher button.
- Runtime Inspector panel rendering moved under `src/ui/diagnostics` with Builder compatibility re-exports.
- Bundle guardrails are implemented: Vite emits a manifest, `verify:builder-bundle` checks that the player entry's static graph excludes `src/builder`, CI runs that check after the production build, and `verify:builder-prod-network` proves production preview does not request the Builder chunk before the launcher is clicked. CI also installs Chromium and runs the network probe against the GitHub Pages base path.
- The release-probe wrapper is implemented as `verify:builder-decoupling`: it runs strict boundaries, typecheck, production build, bundle scan, production-preview lazy-load verification, and the key dev-server browser probes under a managed server.
- `preview:dist` serves the built `dist` directory at an explicit base path, because Vite preview serves `dist` at `/` and is not a faithful local server for a GitHub Pages-base artifact.
- Probe reliability was hardened for lazy Builder loading, managed browser launch fallback, asset-row drag waits, and benign Vite HMR websocket noise.
- The first command/snapshot `BuilderHost` facade is implemented in `src/app/BuilderHost.ts`; the shell-owned launcher passes `{ ctx, host }` to Builder while migration is in progress. Builder event subscriptions, pause ownership, camera commands, parameter-change notifications, toast reporting, and transient visual-state writes now route through the host.
- Remaining planned work is to continue moving playtest/world lifecycle, runtime snapshot reads, and residual Builder-internal compatibility shim imports onto host or neutral `src/authoring` contracts until `new Builder(host)` is possible.

## Executive Summary

The Builder should be decoupled from the game, but not by creating a second fake game. The right split is:

- Keep one real simulation, one real cell/material vocabulary, one real mechanism compiler, one real prefab placement path, and one real playtest path.
- Move shared authored-content contracts out of `src/builder`.
- Make the game runtime stop importing Builder-owned modules.
- Make Builder consume runtime services through a narrow host interface instead of receiving the entire `Ctx`.
- Lazy-load or route-load Builder so player boot and player runtime do not construct editor systems.

The guiding rule is: runtime and Builder may both depend on shared content contracts, but runtime must not depend on Builder UI/tooling modules.

## Why Decouple

Current Builder integration has delivered useful production tools, but it also creates long-term drag:

- Runtime and worldgen import from `src/builder`, which makes editor internals part of gameplay dependency closure.
- `Game` constructs almost every page-lifetime service, including Builder, which makes the player boot path responsible for editor lifecycle.
- `Builder` receives the full `Ctx`, so authoring code can reach too much runtime state directly.
- Builder preview/playtest behavior is correct because it shares real systems, but those seams are not isolated clearly enough.
- Bundle size and boot cost become harder to control as Builder grows.
- Architecture reviews become harder because "shared authoring data" and "Builder UI" live under the same namespace.

The target state should make three facts obvious from imports alone:

1. Player runtime does not import Builder.
2. Builder can preview/playtest using real runtime services.
3. Authored content formats are neutral, versioned contracts.

## Non-Goals

- Do not split Builder into a separate repository in this milestone.
- Do not create a second material simulation for Builder.
- Do not create a separate mechanism, prefab, sprite, or playtest compiler with different behavior.
- Do not merge Sandbox raw-grid saves, Builder documents, and expedition saves.
- Do not let Builder edits mutate expedition worlds unless the user explicitly starts a disposable playtest or bakes scars into a document.
- Do not change cell IDs, `CELL_COUNT`, material predicates, frame order, or generation semantics as part of the decoupling.
- Do not rewrite the whole Builder UI while moving architecture seams.

## Current Coupling Map

### Composition Coupling

- `src/main.ts` always constructs `Game`.
- `src/game/Game.ts` is the composition root for runtime services, page-lifetime UI, overlays, and Builder.
- `Game.mountBuilder()` dynamically imports `@/builder/Builder`, but construction still happens during normal `Game` construction.
- Builder is stored on `ctx` in dev builds as `ctx.builder`.

This is better than a static import, but it still makes Builder a page-lifetime service of the game.

### Runtime Imports From Builder

These imports are the main architectural smell:

- `src/game/instantiate.ts` imports `EditorObject`, `EditorLink`, `EditorLight`, `paramNum`, authored-light constants, sprite helpers, and stamp helpers from `src/builder`.
- `src/world/prefabs/place.ts` imports prefab decoding, prefab types, sprite resolution types, and `CellSetter` from `src/builder`.
- `src/world/prefabs/registry.ts` imports prefab sanitization and types from `src/builder`.
- `src/ui/RuntimeInspector.ts` imports `renderRuntimePanel` from `src/builder/runtimePanel`.

Some of those modules are not editor UI in practice; they are shared authored-content contracts. The problem is their ownership and namespace.

### Builder Runtime Access

- `src/builder/Builder.ts` receives a full `Ctx`.
- Builder opens/closes by mutating `ctx.state`, `ctx.world`, `ctx.enemies`, `ctx.params`, `ctx.camera`, `ctx.levels`, and DOM body classes.
- `src/builder/compile.ts` compiles `EditorDocument` into a disposable `LevelRuntime`.
- `src/builder/PreviewRuntime.ts` creates disposable preview worlds using real instantiation and mechanism logic.

The compile/preview behavior is the right concept. The issue is that Builder reaches broad runtime state directly instead of using a host service with explicit capabilities.

## Target Architecture

### Dependency Direction

Desired dependency graph:

```text
src/core
src/config
src/sim
src/render/pixels
    ^
    |
src/authoring            neutral authored-content contracts
  or src/content/contracts
    ^        ^
    |        |
src/game    src/builder  game runtime and editor tool both depend on content
    ^        ^
    |        |
src/app     optional app shell / route owner
```

Forbidden direction:

```text
src/game -> src/builder
src/world -> src/builder
src/core -> src/builder
src/sim -> src/builder
```

Allowed direction:

```text
src/builder -> src/game through narrow host/playtest adapters only
src/builder -> src/authoring or src/content/contracts
src/game -> src/authoring or src/content/contracts
src/world -> src/authoring or src/content/contracts
```

### New Shared Content Layer

Create a neutral authored-content contract layer. Do not assume the current `src/content/` root is already neutral: existing content registry modules may import gameplay catalogs and runtime systems. Use either `src/authoring/` or a strict `src/content/contracts/` sublayer for pure authored data contracts.

Initial candidates:

```text
src/authoring/                  or src/content/contracts/
  document.ts              EditorDocument, EditorObject, EditorLink, EditorLight, world layer codecs
  objectFootprint.ts        object footprint and param helpers if separated from document.ts
  prefab.ts                PrefabDef, anchors, variants, decode/rotate/mirror/sanitize pure helpers
  sprites.ts               SpriteAsset schema, Aseprite parser, frame slicing, runtime sprite metadata
  spriteLibrary.ts          runtime sprite resolution helpers with no Builder UI dependency
  stamps.ts                pure structural cell stamps used by runtime instantiation
  assets/
    types.ts               AssetRecord, AssetKind, immutable/read-only metadata
    previewSummary.ts       non-DOM asset summary helpers
    importPipeline.ts       pure import validation where possible
```

The layer may import from `core`, `config`, `sim`, and pure world helpers. It must not import from `builder`, `ui`, `game`, `entities`, `combat`, browser-only app shell modules, DOM APIs, localStorage, or full `Ctx`.

Mixed modules must be split, not moved wholesale:

- Schemas, codecs, pure sanitizers, and pure geometry helpers can move to the neutral layer.
- LocalStorage-backed document libraries stay in Builder storage modules.
- Capture/paste commands, undoable document mutations, import reports, and UI helpers stay in Builder.
- Runtime object instantiation stays in `src/game` unless a smaller runtime-surface interface makes it truly neutral.
- Current built-in content catalog/adapters can stay under `src/content` if needed, but runtime hot paths should not depend on a registry that imports gameplay systems just to read authored contracts.

Naming note: keep `EditorDocument` if changing the name would create churn. The important improvement is ownership, not terminology.

### Runtime Layer

Runtime keeps responsibility for:

- `Ctx` composition.
- Game frame order.
- Expedition saves and level lifetimes.
- Player, enemies, projectiles, pickups, mechanisms, brewing, wands, hints, Grimoire, and combat.
- Runtime object instantiation semantics.
- Playtest entry/exit mechanics when those mechanics need real runtime state.

Runtime should depend only on the neutral authored-contract layer for authored object records, prefabs, sprite metadata, and pure stamps.

### Builder Layer

Builder keeps responsibility for:

- Editor UI.
- Workspace layout, docks, panels, menus, command palette, keymap, and focus routing.
- Document mutation commands and undo/redo.
- Asset browser UI.
- Canvas authoring tools.
- Validation UI and repair actions.
- Preview controls.
- Starting/stopping playtests through a host.

Builder should not own shared authored-content schemas that runtime or worldgen need.

### App Shell Layer

Add a small app shell only when the previous seams are ready. Its job is route/mode ownership, not gameplay behavior.

Possible files:

```text
src/app/AppShell.ts
src/app/gameEntry.ts
src/app/builderEntry.ts
```

The shell can decide:

- Start player runtime.
- Open Builder route.
- Load Builder only after the user asks for it.
- Preserve dev reload mode using existing `modePersist` behavior.

This should come after neutral authored-contract extraction so the route split is not cosmetic.

## BuilderHost Interface

Replace raw `Ctx` access in Builder gradually with a narrow host. The host must be command/snapshot based, not a renamed mutable `Ctx`.

First version:

```ts
export interface BuilderHost {
  getModeSnapshot(): BuilderModeSnapshot;
  getRuntimeSnapshot(options?: RuntimeSnapshotOptions): RuntimeEntitySnapshot;
  getTuningSnapshot(): BuilderTuningSnapshot;
  captureCurrentScene(): EditorDocument;

  enterAuthoringSession(doc: EditorDocument, intent: BuilderOpenIntent): BuilderAuthoringSession;
  closeAuthoringSession(session: BuilderAuthoringSession): void;

  startPlaytest(session: BuilderAuthoringSession, opts?: { spawnAt?: { x: number; y: number } }): PlaytestStartResult;
  returnFromPlaytest(session: BuilderAuthoringSession): PlaytestReturnResult;
  discardPlaytest(session: BuilderAuthoringSession): void;

  updateTuning(patch: BuilderTuningPatch): void;
  setBuilderVisualState(patch: BuilderVisualStatePatch): void;
  subscribe(type: BuilderHostEventType, handler: BuilderHostEventHandler): () => void;
  status(message: string, warn?: boolean): void;
}
```

The host should not expose a public `EventBus`, mutable `GameStateData`, raw `World` replacement, or direct access to runtime arrays. Host-owned operations should perform world parking, in-place entity clearing, transient resets, pause ownership, playtest flags, camera lock, and scar capture as named lifecycle operations.

This should begin as a facade over `Ctx`, implemented near `Game`, then become the only runtime object passed to `Builder`.

Migration rule:

- First PRs may pass both `ctx` and `host`.
- New code must use `host`.
- Existing direct `ctx` access should be removed by subsystem.
- Final acceptance requires `new Builder(host)` rather than `new Builder(ctx)`.

## Playtest Boundary

Playtest must remain integrated with the real game, but lifecycle should be owned by a named service.

Suggested extraction:

```text
src/game/AuthoringPlaytestHost.ts
src/game/compileAuthoredRuntime.ts
```

Responsibilities:

- Validate the document before playtest.
- Decode document terrain into a disposable world.
- Reset combat transients.
- Move player to authored spawn or cursor spawn.
- Instantiate objects, links, lights, pickups, mechanisms, waystones, enemies, emitters, portal, cauldron, and exit well through one shared path.
- Capture and restore pre-playtest player, wand, ambient, and camera state.
- Exit disposable runtime cleanly.
- Return playtest scars only when Builder explicitly asks to bake them.
- Preserve current bake-scar UX semantics: BAKE appears only after playtest return, region bake is undoable, whole-world bake requires danger confirmation and clears undo, and mechanism footprints are excluded from baked terrain.

The current `compileAndPlaytest()` is a good seed. The plan is not to delete it abruptly; move it behind the host, then relocate shared data imports. Keep `instantiateObjects()` as runtime semantics in `src/game` unless it can be narrowed to an explicit instantiation runtime surface without importing game systems into the neutral contract layer.

## Preview Runtime Boundary

`PreviewRuntime` is conceptually correct because it uses disposable worlds and shared instantiation. It should become more clearly neutral:

- Move pure preview status types to the neutral authored-contract layer or `src/game/preview`.
- Keep Builder UI controls in `src/builder`.
- Keep disposable-world simulation logic independent from Builder panels.
- Use a typed no-op runtime service set for preview-only needs, instead of partial `Ctx` stubs.

Acceptance criteria:

- Preview can run mechanisms and emitters without touching expedition state.
- Preview uses the same authored object instantiation semantics as playtest and worldgen prefabs.
- Preview reads unsaved paint through an explicit captured source layer.
- Preview exposes runtime rows and authored lights without letting preview state leak into live runtime state.
- Preview gates author-only commands correctly while running.
- Restart and discard controls continue to work after host/lazy-load changes.
- Preview shutdown is part of Builder close/dispose and HMR disposal.

## Persistence Boundaries

Preserve the existing three-save-model rule:

- Sandbox raw-grid saves: live cell grid snapshots for experimentation.
- Builder documents/assets: durable authored intent, object records, links, lights, embedded sprites, prefab records.
- Expedition saves: campaign runtime state and persistent level worlds.

Decoupling must not merge these systems.

Required persistence safeguards:

- Keep `EditorDocument.v` migrations backward-compatible.
- Keep share codes loadable after moving modules.
- Keep existing localStorage keys stable unless a migration is added.
- Keep `noita-builder-workspace-v1` as workspace preference state, not document state.
- Keep expedition saves from being opened as Builder documents.
- Keep Builder documents from overwriting expedition worlds.

Mandatory compatibility fixtures before moving schemas/codecs:

- A current saved Builder document.
- A legacy `noita-builder-docs` library blob.
- A `PLLD1.` share code.
- A prefab JSON file.
- A sprite JSON file.
- An asset bundle v1 file.
- A saved import report.
- A negative fixture proving an expedition save is rejected as a Builder document.

## Build And Bundle Strategy

Do this after content extraction.

### Stage 1: Better Lazy Loading In Current App

- Keep one Vite entry.
- Add a shell-owned `BuilderLauncher` button or header stub before removing eager Builder construction.
- The launcher dynamically imports Builder, creates the host, and calls `open()`.
- Change `Game` so Builder is imported only when the Builder is opened or dev reload asks for Builder.
- Move ownership of the header Builder button out of the Builder constructor before lazy loading lands.
- Ensure normal player boot does not construct Builder, panels, asset database, or gallery preview.
- Preserve the current Play intent modal flow: edit current scene versus continue Builder document.
- Keep a visible failure path if Builder import fails in dev.

### Stage 2: Builder Chunk Boundary

- Add a manual chunk rule for Builder-owned modules if Vite does not naturally split them.
- Enable `build.manifest` or add a Rollup stats output for deterministic bundle checks.
- Confirm the player boot chunk does not include `src/builder/Builder.ts` or large Builder panels.
- Add a bundle check script that scans built manifest/chunks for accidental Builder inclusion in the game entry.
- Add a production-preview network probe proving Builder JS is not requested before opening Builder.

Implementation note: Vite naturally emits `assets/Builder-*.js` as the dynamic Builder chunk after the lazy launcher change. A forced manual chunk was tested and rejected because Rollup placed shared symbols in that chunk, making the player entry import it statically. The accepted guard is manifest/sourcemap verification plus the production network probe.

### Stage 3: Optional Separate Entry

Only after Stage 1 and 2 are stable:

- Add `/builder` or `?tool=builder` entry.
- Consider `src/builder/main.ts` for direct editor boot.
- Keep playtest launch able to enter the game runtime from Builder.
- Keep production deployment simple; do not create a second repo or package yet.

## Implementation Phases

### Phase 0: Baseline Audit And Guardrails

Deliverables:

- Add `scripts/verify-builder-boundaries.mjs`.
- Add `verify:builder-boundaries` to `package.json`.
- Add a test or script that fails on forbidden imports:
  - `src/game/**` importing `@/builder/**`
  - `src/world/**` importing `@/builder/**`
  - `src/core/**` importing `@/builder/**`
  - `src/sim/**` importing `@/builder/**`
  - `src/render/**` importing `@/builder/**`, except explicitly approved debug/editor preview paths if any exist
  - player-facing `src/ui/**` importing `@/builder/**`
- Add a baseline allowlist for existing violations so the script can be introduced before the refactor.
- Include exact baseline entries for the current `Game` type import, `Game` dynamic import, and `RuntimeInspector` import.
- Use TypeScript AST/module resolution rather than regex so static imports, type-only imports, re-exports, and dynamic imports are classified deliberately.
- Distinguish type-only imports from runtime imports in reporting, but treat both as ownership violations once the relevant phase removes its allowlist.
- Update `.github/workflows/ci.yml` so PRs run `npm run verify:builder-boundaries`.
- Update CI to run `GH_PAGES=true npm run build` so production route and asset-base issues are caught.
- Document the target dependency graph in `ARCHITECTURE.md` after the plan is accepted.

Validation:

```powershell
node scripts/verify-builder-boundaries.mjs --baseline
npm run typecheck
npm test
GH_PAGES=true npm run build
```

Exit criteria:

- Current violations are listed explicitly.
- New violations fail CI or local validation.
- CI contains the new boundary and production build gates.
- No behavior changes.

### Phase 1: Extract Authored Content Contracts

Move pure authored-content contracts from `src/builder` to the neutral authored-contract layer.

Candidate moves:

- Pure schema pieces from `src/builder/document.ts` -> `src/authoring/document.ts` or `src/content/contracts/document.ts`
- Pure geometry/helpers such as `objectFootprint` and `paramNum` -> neutral contract layer
- Pure parts of `src/builder/prefablib.ts` -> neutral `prefab.ts`
- Pure sprite asset schema/codec parts from `src/builder/assets/sprites.ts` -> neutral `sprites.ts`
- Runtime-safe sprite resolver types/helpers from `src/builder/assets/spritelib.ts` -> neutral `spriteLibrary.ts`
- `CellSetter` and structural stamp helpers needed by runtime -> neutral `stamps.ts`

Implementation details:

- Split mixed files. Do not move localStorage-backed document libraries, prefab storage, capture/paste commands, import reports, or Builder UI helpers into the neutral layer.
- The neutral layer must have an import-boundary guard: no `@/builder`, `@/game`, `@/entities`, `@/combat`, `@/ui`, DOM APIs, localStorage, or full `Ctx`.
- Preserve exported names initially to reduce churn.
- Leave compatibility re-export shims in `src/builder/*` for one or two PRs if needed.
- Update `src/game/instantiate.ts`, `src/world/prefabs/place.ts`, and `src/world/prefabs/registry.ts` to import from the neutral contract layer.
- Keep Builder UI imports working through either direct neutral-contract imports or short-lived re-export shims.
- Do not change document JSON shape.
- Do not change prefab JSON shape.
- Do not change sprite asset JSON shape.
- Preserve the unified Asset Database behavior: import reports, delete plans, project-store mirrors, explicit document/template open actions, batch selection, drag placement, scroll restoration, and focus restoration.
- Preserve validation UX: issue badges refresh without stealing focus, scroll/filter state survives refresh, issue rows frame/select their targets, and repair/overlay actions stay available.

Validation:

```powershell
npm run typecheck
npx vitest run tests/builder*.test.ts tests/prefab*.test.ts tests/gen-level-golden.test.ts
npx vitest run tests/asset-database.test.ts
node scripts/verify-builder-assets.mjs
node scripts/verify-builder-boundaries.mjs
npm run build
```

Exit criteria:

- Runtime/worldgen no longer import Builder modules for document, prefab, sprite, or stamp contracts.
- Existing documents, prefabs, sprites, and built-in prefabs still load.
- Asset Browser workflows have no visible UX regression.
- Validation panel issue count, focus, filter, scroll, target framing, and repair behavior remain intact.
- No runtime behavior changes.

### Phase 2: Neutralize Authored Object Instantiation

Move the shared "authored records -> runtime entities/cells" compiler seam out of Builder ownership.

Recommended move:

- Keep `src/game/instantiate.ts` as the runtime semantics owner.
- Rename later only if it becomes cleanly neutral.

Implementation details:

- Keep one `InstantiationSink`.
- Keep one `instantiateObjects()` implementation.
- Narrow `instantiateObjects()` from full `Ctx` to an explicit instantiation runtime surface only if that can be done without duplicating gameplay services.
- Keep one `spawnPrefabEnemy()` implementation for live runtime.
- Ensure Builder playtest, PreviewRuntime, and worldgen prefab placement still call the same implementation.
- Ensure sprite decor resolution does not require Builder asset panels.

Validation:

```powershell
npx vitest run tests/gen-level-golden.test.ts tests/world-validate.test.ts
node scripts/verify-virtual-playtest.mjs
node scripts/verify-campaign-playtest.mjs
npm run verify:findability
```

Exit criteria:

- There is one semantics path for authored objects.
- Worldgen built-in prefabs still place and connect.
- Builder playtests still spawn authored mechanisms, pickups, enemies, lights, and decor.

### Phase 3: Introduce BuilderHost

Add a host/facade between Builder and the full runtime `Ctx`.

Deliverables:

- New `src/game/BuilderHost.ts` or `src/app/BuilderHost.ts`. Implemented as `src/app/BuilderHost.ts`.
- `createBuilderHost(ctx): BuilderHost`. Implemented as the shell-owned facade used by `BuilderLauncher`.
- `Builder` constructor accepts `{ host, contentServices }` or `BuilderHost`. Implemented as transitional `{ ctx, host }`; this is allowed by the migration rule but is not the final exit state.
- Builder direct `ctx` access starts shrinking by subsystem.
- Host API is command/snapshot based and does not expose public `EventBus`, mutable `GameStateData`, raw `World` replacement, or runtime entity arrays.

Initial host methods should cover:

- open/close authoring world
- capture current scene
- start playtest
- stop playtest
- pause ownership
- camera lock/snap
- parameter change notification
- narrow typed event subscription
- runtime status snapshots
- expedition parking and current-scene snapshot adoption
- playtest scar capture/discard/bake handoff

Migration order inside Builder:

1. Pause and mode changes. Started: mode/world edit subscriptions and pause ownership route through `BuilderHost`.
2. Playtest start/return.
3. World detach/scratch world adoption.
4. Camera lock/snap. Started: camera snap and zoom-lock commands route through `BuilderHost`.
5. Parameter updates. Started: `paramsChanged` notifications route through `BuilderHost`.
6. Runtime overlay snapshot reads.
7. Remaining direct `ctx` reads.

Validation:

```powershell
npm run typecheck
node scripts/verify-builder-ux.mjs
node scripts/verify-builder-dock-split.mjs
node scripts/verify-builder-expedition.mjs
node scripts/verify-virtual-playtest.mjs
node scripts/verify-campaign-playtest.mjs
node scripts/verify-couplings.mjs
```

Exit criteria:

- `Builder` no longer receives the raw `Ctx`.
- Builder playtest behavior remains unchanged.
- Expedition worlds are still parked before Builder edits.
- Opening Builder from gameplay still offers edit-current-scene versus continue-document intent.
- Returning from playtest restores player, wand, ambient, camera, mode, and parked expedition state.
- Builder close/dispose still tears down listeners, timers, preview runtime, and playtest banners.

### Phase 4: Lazy Builder Mount

Change Builder from a page-lifetime game service to an on-demand tool.

Deliverables:

- Add a shell-owned `BuilderLauncher` button or header stub before removing eager Builder construction.
- Preserve the existing Builder entry affordance even before the Builder chunk has loaded.
- `Game` no longer calls `mountBuilder()` during construction.
- Header Builder button or dev mode restore triggers dynamic import.
- If dev `modePersist` says Builder, import and open Builder after game boot.
- Ensure `ctx.builder` debug handle is set only after Builder loads.
- Ensure Builder import failure shows a visible dev error and does not break normal play.
- Preserve the Play intent modal and expedition parking behavior when opening Builder from gameplay.

Validation:

```powershell
npm run build
node scripts/verify-game.mjs
node scripts/verify-builder-ux.mjs
node scripts/verify-builder-expedition.mjs
node scripts/verify-runtime-ui.mjs
```

Exit criteria:

- Fresh player boot does not construct Builder.
- Player run launcher and level initialization still work without Builder loaded.
- Builder can still be opened from Sandbox, gameplay, and dev reload flow.
- Gameplay opening still protects live expedition worlds, supports detached current-scene editing, and reattaches/returns correctly.
- HMR dispose does not strand Builder listeners after dynamic load.

### Phase 5: Split Runtime Inspector From Builder Panels

`src/ui/RuntimeInspector.ts` currently imports Builder runtime panel rendering. That keeps a UI runtime surface dependent on Builder.

Deliverables:

- Move shared runtime snapshot panel rendering into `src/ui/runtimePanel.ts` or `src/ui/diagnostics/runtimePanel.ts`.
- Keep Builder-specific runtime overlay controls in `src/builder` if they are editor-only.
- Ensure both RuntimeInspector and Builder can use shared row/filter helpers without importing each other.

Validation:

```powershell
npm run typecheck
node scripts/verify-runtime-ui.mjs
node scripts/verify-builder-ux.mjs
node scripts/verify-builder-boundaries.mjs
```

Exit criteria:

- `src/ui/**` player/runtime overlays do not import Builder panels.
- Builder still has runtime overlay information while open.

### Phase 6: Bundle Boundary And Optional Route

Once imports are clean and Builder is on-demand, enforce bundle behavior.

Deliverables:

- Enable Vite `build.manifest` or add an equivalent Rollup stats output.
- Add `scripts/verify-builder-bundle-boundary.mjs`.
- Add `verify:builder-bundle` to `package.json`.
- Verify Builder-heavy modules are not in initial player chunk.
- Add optional manual chunk for Builder.
- Optionally add `?tool=builder` or `/builder` boot path.
- Update `.github/workflows/ci.yml` to run the bundle-boundary scan once this phase lands.
- Add a production-preview network probe that starts from the player route and proves Builder JS is not requested before the Builder launcher is clicked.

Validation:

```powershell
npm run build
node scripts/verify-builder-bundle-boundary.mjs
node scripts/verify-builder-prod-network.mjs
node scripts/verify-game.mjs
node scripts/verify-builder-ux.mjs
```

Exit criteria:

- Normal player boot does not download Builder chunk before requesting Builder.
- Builder route/import still works in dev and production build.
- No duplicated sim/runtime code is emitted because of bad split points.

### Phase 7: Remove Compatibility Shims

After downstream imports are clean:

- Delete temporary `src/builder/document.ts` re-export if it exists.
- Delete temporary `src/builder/prefablib.ts` re-export if it exists, or reduce it to Builder-only helpers.
- Delete temporary sprite/stamp re-exports.
- Update docs and import-boundary script to forbid the old paths.

Validation:

```powershell
node scripts/verify-builder-boundaries.mjs --strict
npm run lint
npm run typecheck
npm test
npm run build
```

Exit criteria:

- Runtime imports from the neutral authored-contract layer only.
- Builder-only modules contain Builder-only UI/tooling behavior.
- No compatibility shims are left unless explicitly documented.

## Concrete First PR

The first PR should be small and behavior-preserving:

1. Add `scripts/verify-builder-boundaries.mjs`.
2. Add `src/authoring/README.md` or `src/content/contracts/README.md` documenting intended ownership and forbidden imports.
3. Move only type-level or pure exports that are low-risk:
   - `EditorObject`, `EditorLink`, `EditorLight`
   - `EditorObjectKind`
   - `CellSetter`
   - `paramNum`
4. Leave re-export shims in current Builder files.
5. Update `src/game/instantiate.ts` and `src/world/prefabs/place.ts` for the moved imports.
6. Add mandatory compatibility fixtures before moving loader logic.
7. Run typecheck, focused tests, boundary verification, asset verification, and build.

This proves the direction without touching Builder open/close, playtest, or route behavior.

## Risk Register

### Risk: Fake Decoupling

Moving route code before dependency ownership can make the app look split while runtime still imports Builder.

Mitigation:

- Enforce import-boundary script before route work.
- Treat neutral authored-contract extraction as Phase 1.
- Keep existing content registries and gameplay catalog adapters separate from pure authored contracts.

### Risk: Playtest Drift

If playtest gets a separate compiler, Builder previews can stop matching actual gameplay.

Mitigation:

- Keep one `instantiateObjects()` semantics path.
- Add tests that compare playtest and worldgen prefab instantiation for representative authored objects.

### Risk: Save Or Share-Code Breakage

Moving modules can accidentally change JSON shape, default values, sanitization, or embedded sprite behavior.

Mitigation:

- Keep data shapes unchanged.
- Add mandatory fixtures for existing document, legacy document library, share code, prefab, sprite, asset bundle, import report, and rejected expedition save.
- Test old share code import before and after moving loader code.

### Risk: Expedition World Mutation

Builder opening from a live expedition could still edit a live persistent `World`.

Mitigation:

- Keep and test the "expedition parked" behavior.
- Host API should make scratch world entry explicit.
- Browser probe should start an expedition, open Builder, edit terrain, close, and confirm expedition world remains unchanged.

### Risk: HMR And Listener Leaks

Lazy-loading Builder increases lifecycle complexity.

Mitigation:

- Keep `Game` as owner of page-lifetime disposal.
- Add probe that opens/closes Builder repeatedly and checks no duplicate global listeners or modal leftovers.

### Risk: Asset Browser Regression

Moving asset contracts can break import reports, embedded sprites, delete plans, or project persistence.

Mitigation:

- Keep asset UI in Builder.
- Move pure asset contracts gradually.
- Run `node scripts/verify-builder-assets.mjs` and `npx vitest run tests/asset-database.test.ts` after each asset-contract move.

### Risk: Validation UX Regression

Moving document and validation contracts can preserve correct issue data while breaking the workflow.

Mitigation:

- Probe that issue badges refresh without stealing focus.
- Preserve filter, scroll, target framing, repair actions, and overlay actions.
- Include validation UX checks in Builder behavior phases.

### Risk: Bundle Duplication

Poor chunk boundaries can duplicate shared sim/content code.

Mitigation:

- Inspect build output after lazy split.
- Keep shared contracts in one neutral authored-contract layer.
- Avoid a second Vite app until module ownership is clean.
- Add manifest/stats-based checks and a production-preview network probe.

### Risk: Local Probes Are Not Release Gates

Browser probes can be listed in a plan but skipped in practice because they need a running server or local Edge.

Mitigation:

- Add a release-probe wrapper that starts Vite or preview on a free port.
- Pass the URL into probes.
- Support CI-compatible Chromium fallback.
- Run at least expedition, asset, Builder UX/suite, virtual playtest, and campaign playtest probes for host and lazy-load phases.

## Validation Matrix

Every phase should run at least:

```powershell
npm run typecheck
npm test
npm run build
git diff --check
```

Architecture phases should also run:

```powershell
node scripts/verify-builder-boundaries.mjs
node scripts/verify-couplings.mjs
```

Builder behavior phases should run:

```powershell
node scripts/verify-builder-ux.mjs
node scripts/verify-builder-pro.mjs
node scripts/verify-builder-assets.mjs
node scripts/verify-builder-expedition.mjs
node scripts/verify-builder-dock-split.mjs
node scripts/verify-builder-responsive.mjs
node scripts/verify-virtual-playtest.mjs
node scripts/verify-campaign-playtest.mjs
```

Runtime behavior phases should run:

```powershell
node scripts/verify-game.mjs
node scripts/verify-runtime-ui.mjs
npm run verify:findability
```

Bundle phases should run:

```powershell
npm run build
node scripts/verify-builder-bundle-boundary.mjs
node scripts/verify-builder-prod-network.mjs
GH_PAGES=true npm run build
```

Release-gate wrapper:

```powershell
node scripts/verify-builder-decoupling-suite.mjs
```

The wrapper should start a dev server or preview server on a free port, pass that URL to every browser probe, use Edge locally when available, and fall back to CI-compatible Chromium.

## Acceptance Criteria For The Full Milestone

- `src/game`, `src/world`, `src/core`, `src/sim`, and player-facing `src/ui` do not import Builder-owned modules.
- Shared authored-content contracts live under `src/authoring` or a strict neutral `src/content/contracts` namespace.
- Builder no longer receives raw `Ctx`; it uses a host interface.
- Builder is not constructed during normal player boot.
- Builder can still open from Sandbox and gameplay, edit, validate, preview, playtest, bake scars, and close.
- Opening Builder from gameplay preserves the edit-current-scene versus continue-document intent flow.
- Expedition saves, Sandbox saves, and Builder documents remain separate.
- Existing documents, prefabs, sprites, and asset bundles remain compatible.
- Built-in prefabs still place through worldgen and pass findability.
- Runtime probes pass for player boot, run launcher, level initialization, Builder open/close, Builder playtest, and campaign playtest.
- Production build does not eagerly include Builder-heavy code in the player path.

## Review Checklist

Reviewers should check:

- Does the plan avoid splitting gameplay semantics?
- Does it remove runtime imports from Builder before route/bundle changes?
- Does it preserve Builder productivity and existing asset workflows?
- Does it preserve expedition save safety?
- Does it keep `Game` as runtime composition root while narrowing Builder access?
- Are validation gates strong enough to catch browser-only lifecycle defects?
- Are phases small enough to ship one at a time?

## Expert Review Notes

Independent read-only reviews were run after drafting the plan.

- Runtime architecture review: accepted the direction, but required a command/snapshot `BuilderHost`, a stricter neutral contract layer, no wholesale movement of mixed Builder files, and a shell-owned Builder launcher before lazy mount.
- Builder/editor UX review: accepted the direction, but required explicit gates for opening Builder from gameplay, expedition parking, current-scene intent, Asset Browser workflows, validation UX, Logic Preview behavior, and bake-scar semantics.
- Testing and migration review: accepted the direction, but required CI integration for boundary/build checks, mandatory compatibility fixtures, AST/module-resolution import checks, a concrete Vite manifest/network bundle gate, and a browser-probe wrapper suitable for CI.

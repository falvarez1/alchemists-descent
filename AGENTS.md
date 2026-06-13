# Repository Guidelines

## Project Structure & Module Organization

Alchemist's Descent is a TypeScript + Vite falling-sand action roguelite. `src/main.ts` boots the app, `src/game/Game.ts` composes runtime systems, and `src/core/types.ts` is the shared contract surface. Main areas are `src/sim/` for cellular automata, `src/render/` for Three.js pixel rendering, `src/entities/` and `src/combat/` for gameplay, `src/world/` for generation/prefabs, `src/builder/` for authoring, and `src/ui/` for overlays. Tests are in `tests/`, probes/generators in `scripts/`, docs in `docs/`.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run dev`: start Vite at `http://localhost:5173`.
- `npm run build`: typecheck, then build `dist/`.
- `npm run typecheck`: run `tsc --noEmit` only.
- `npm test`: run Vitest.
- `npm run lint`: run ESLint over `src/`.
- `npm run verify:findability`: run the worldgen reachability audit.
- `node scripts/verify-game.mjs`: smoke test; needs dev server and Edge.
- `node scripts/perf-scene.mjs`: repeatable performance benchmark.

## Coding Style & Naming Conventions

Use strict TypeScript ES modules, 2-space indentation, and `@/` path aliases. Prefer `import type` for interfaces. Avoid `any`, `@ts-ignore`, and broad suppressions without a documented reason. Classes use `PascalCase`; functions, variables, and locals use `camelCase`. ESLint allows unused values only when prefixed with `_`.

## Testing Guidelines

Add or update Vitest files under `tests/` using the `feature.test.ts` naming pattern. For targeted runs, use `npx vitest run tests/wands.test.ts` or `npx vitest run -t "case name"`. Before commit, prefer `npm run typecheck`, `npm test`, `npm run build`, then runtime verification. Gameplay, renderer, Builder, and UI changes need a relevant `scripts/verify-*.mjs` probe when static tests are insufficient. Intentional worldgen changes must update golden expectations and bump `GEN_VERSION` in `src/config/gen.ts`.

## Commit & Pull Request Guidelines

Recent commits use concise subjects with visible scope, for example `GPU FRAME COMPOSITION: ...`, `CRAWL ships: ...`, or plan commits ending with `(proposal, not implemented)`. Keep commits focused and mention deliberate tuning or generation changes. PRs should summarize behavior, list validation, link issues/docs, and include screenshots or clips for visual changes.

## Architecture and Safety Notes

Cell IDs and marker palettes are append-only save-format contracts; never renumber or reuse them. Keep Sandbox raw-grid saves, Builder documents, and expedition runtime saves separate. Route collaboration through the `Ctx` interface; gameplay emits `EventBus` events instead of touching the DOM. Mutate shared entity arrays in place, use `world.swap` for cell movement, and treat frame order/tuning constants as intentional. Generate prefabs with their scripts. Do not commit `dist/`, `coverage/`, `verify-out/`, or `node_modules/`.

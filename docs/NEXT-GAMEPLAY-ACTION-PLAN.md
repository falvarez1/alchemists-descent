# Next Gameplay Action Plan

Status: action plan, not implemented.
Created: 2026-06-18.

## Purpose

This plan turns the current recommended direction into implementation-ready
workstreams. The theme is coherence before breadth: make the existing simulated
systems easier to understand, easier to test, and easier to author before adding
large new technology, many new cards, or more save-format surface.

The target sequence is:

1. D1 first-10-minutes playability pass.
2. Reactive World and art-independent Grimoire discovery.
3. Narrow Frost Charge plus Shatter Frozen spell-combo drop.
4. Campaign, Builder, and virtual-world visual parity audit.
5. Generated scene inspector and capture/edit workflow.

## Product Principles

- Every lesson must be made from real cells, pickups, enemies, mechanisms, or
  authored world structure. No tutorial-only fake state.
- Each slice must be shippable on its own and validated in the real game.
- Prefer one clear player-facing mechanic over several partial systems.
- Preserve fail-open progression rules. Physics chaos can cost time or reward,
  but it cannot hard-lock descent.
- Keep the TypeScript worker and fixed campaign generator as truth sources until
  a separate backend proves parity.

## Explicit Non-Goals

- Do not start WebGPU or WASM worldgen acceleration in this sequence.
- Do not add new cell ids unless a later implementation slice proves there is no
  good existing-cell version.
- Do not add a broad card dump. The next spell work is one frozen-combo family.
- Do not start a major boss pass until D1 onboarding and core combo readability
  are in better shape.
- Do not make generated scenes normal campaign dependencies through project-local
  Builder assets.

## Workstream 0: Baseline And Branch Prep

Goal: start implementation from a known, reviewable state.

Tasks:

1. Land or intentionally carry forward the current electrical review fix before
   starting gameplay feature work.
2. Run the static baseline:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
3. For any worldgen-affecting change, add:
   - `npm run verify:findability`
   - targeted golden or persistence tests as needed.
4. For any player-facing gameplay or editor slice, add a matching browser probe
   under `scripts/verify-*.mjs`.

Done when:

- The active branch has a clean, understood diff.
- The first feature slice has a focused validation command list.

## Workstream 1: D1 First-10-Minutes Playability Pass

Goal: make the opening level teach "materials are verbs" through authored,
repeatable moments rather than text.

Player outcome:

- In the first run, the player sees that fire opens wood, sand can hide reward,
  water and lava visibly react, flasks move real material, and charged wet/metal
  spaces are tactical.

Recommended slices:

1. **D1 audit and script**
   - Inspect current D1 generation, onboarding stations, waystone placement,
     first enemy pressure, and early reward timing.
   - Write a short D1 beats list in the implementation PR or a small companion
     doc if the slice grows.

2. **Four teaching stations**
   - Wooden seal with a brazier nearby.
   - Sand plug over visible treasure.
   - Free water-filled flask beside a small contained lava pool.
   - Simple wet/electric setup using existing water, metal, and charge behavior.

3. **Placement and reservation**
   - Place stations through the existing worldgen or prefab/structure pipeline.
   - Reserve spawn, waystone, cauldron, well, and machine-room corridors.
   - Ensure every required interaction is spawn-reachable before and after
     settled findability repairs.

4. **Presentation pass**
   - Add material tells where needed: glow, minimap dot, gold fleck, crack pixel,
     sound cue, or objective toast.
   - Keep text minimal. The player should learn by touching the grid.

Likely files:

- `src/world/CaveGenerator.ts`
- `src/world/structures.ts`
- `src/world/prefabs/`
- `src/config/gen.ts`
- `src/config/worldgraph.ts`
- `src/game/Pickups.ts`
- `src/combat/Flask.ts`
- `tests/worldgen.test.ts`
- `tests/prefabs-worldgen.test.ts`
- `scripts/verify-campaign-playtest.mjs`

Acceptance criteria:

- A fresh D1 seed exposes all four teaching stations near the early main path.
- The free flask contains real water and spends/receives real cells.
- Burning, digging, pouring, and charging all work without debug tools.
- Multi-seed findability passes for all required D1 objects and exits.
- A browser probe reaches each station and verifies the expected cell result.

Validation:

- `npx vitest run tests/worldgen.test.ts tests/prefabs-worldgen.test.ts`
- `npm run verify:findability`
- `node scripts/verify-campaign-playtest.mjs`
- `npm run typecheck`
- `npm run build`

## Workstream 2: Reactive World And Living Grimoire

Goal: make material knowledge persistent and player-visible without waiting on
book art.

Player outcome:

- The player can examine cells.
- First witnessed interactions create Grimoire entries.
- The game teaches "why that happened" through discovery, not a static tutorial.

Recommended slices:

1. **Grimoire store generalization**
   - Extend the current brewing recipe store into a versioned knowledge store:
     recipes, materials, and interactions.
   - Keep old `noita-grimoire` saves valid.
   - Centralize helpers so brewing and interaction discovery do not fork storage.

2. **Examine lens**
   - Promote `CellInspector` behavior into a play-mode examine action.
   - Read cell type, conductivity, bloom, charge, and a short material fact.
   - Use existing input budget carefully. No new permanent key if an existing
     inspect/aim affordance can carry it.

3. **Interaction catalog**
   - Add a small data table for first entries:
     - water quenches fire
     - lava flashes water to steam
     - nitrogen freezes water
     - charge conducts through water, lava, and metal
     - acid plus water-adjacent transmutation behavior
   - Each entry names the cells involved and the visible result.

4. **First-sighting detector**
   - Detect only near-camera or near-player interactions.
   - Throttle checks and dedupe by entry id.
   - Fire a toast/event once and persist the entry.

5. **Book UI later**
   - Defer the full Grimoire overlay until page art and safe-area coordinates
     are available.
   - The storage/event work must not depend on that UI.

Likely files:

- `src/game/Brewing.ts`
- new `src/game/Grimoire.ts` or nearby equivalent
- `src/core/events.ts`
- `src/ui/CellInspector.ts`
- `src/ui/Hud.ts`
- `src/input/InputManager.ts`
- `src/sim/elements/*`
- `tests/brewing.test.ts`
- new `tests/grimoire.test.ts`
- `scripts/verify-grimoire.mjs`

Acceptance criteria:

- Existing recipe discovery still works and old localStorage shape migrates.
- Examining a material shows useful player-facing information.
- Triggering an interaction in-camera records exactly one entry and fires one
  readable toast.
- Repeating the same interaction does not duplicate entries.
- Detection has bounded cost and does not scan the full world each frame.

Validation:

- `npx vitest run tests/brewing.test.ts tests/grimoire.test.ts`
- `node scripts/verify-grimoire.mjs`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Workstream 3: Frost Charge Plus Shatter Frozen

Goal: add one new spell-combo family that proves freeze setup can become combat
payoff without flooding the card pool.

Player outcome:

- The player can freeze a target or water pocket, then cash that setup in with a
  visible shatter hit.

Recommended slices:

1. **Runtime modifier fields**
   - Add only the fields needed for `frostcharge` and `shattercrit`.
   - Reuse `PROJECTILE_MODS` and the existing compiler patterns.
   - Keep trigger payload routing through `ctx.wands.castActionAt`.

2. **Frost Charge**
   - On enemy hit: apply `frozen` status through `EntityStatus`.
   - On terrain hit: add a small bounded freeze/rime effect using existing
     freezing behavior.
   - Avoid creating permanent free walls that can trap progression.

3. **Shatter Frozen**
   - On hit, crit only if the target is frozen or touching ice/nitrogen.
   - Add a distinct hit flash, shard particles, and short sound.
   - Keep damage inside an explicit cap.

4. **Review-only first, live pool second**
   - Add cards to review loadouts and tests first.
   - Only add to normal reward pools after probe and balance pass.

Likely files:

- `src/core/types.ts`
- `src/combat/wands/cards.ts`
- `src/combat/wands/compiler.ts`
- `src/combat/wands/projectileMarks.ts`
- `src/combat/wands/WandSystem.ts`
- `src/combat/Projectiles.ts`
- `src/ui/icons.ts`
- `src/render/FrameComposer.ts`
- `tests/wands.test.ts`
- `tests/projectiles.test.ts`
- `scripts/verify-modifier-cards.mjs`

Acceptance criteria:

- `Frost Charge + Spark` freezes a target without requiring a new projectile
  type.
- `Shatter Frozen + Spark` crits frozen targets and does not crit dry targets.
- Triggered payloads preserve the new modifier semantics.
- The cards are visible in review tooling with icons and useful blurbs.
- Normal drop pools remain unchanged until the combo is proven.

Validation:

- `npx vitest run tests/wands.test.ts tests/projectiles.test.ts`
- `node scripts/verify-modifier-cards.mjs`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Workstream 4: Campaign, Builder, And Virtual Visual Parity Audit

Goal: prove the same generated area does not lose colors, grass, lights, hazards,
or scene metadata as it moves between preview, Builder, playtest, and campaign.

Player/editor outcome:

- Designers can trust what they see while editing and playtesting.
- Richness work does not get wasted because one path silently drops metadata.

Recommended slices:

1. **Audit matrix**
   - Pick representative seeds/profiles for Earthen, Fungal, Frozen, and
     Volcanic.
   - Capture World Map preview, Builder main canvas, Builder Playtest, and fixed
     campaign Play Mode where paths overlap.

2. **Diff the data paths**
   - Compare cells, colors, life, charge, scene objects, scene lights, grass,
     lava, gold, and generated material accents.
   - Identify which conversion path drops data.

3. **Add parity tests**
   - Focus on `WindowMaterializer`, crop parity, scene metadata caps, and
     generated-light transfer.
   - Keep fixed campaign and virtual chunked generation distinct where they are
     intentionally separate.

4. **Fix the first real mismatch**
   - Do not expand content until the biggest parity gap is fixed.
   - If campaign output changes intentionally, update `GEN_VERSION` and golden
     expectations deliberately.

Likely files:

- `src/world/virtual/WindowMaterializer.ts`
- `src/world/virtual/ChunkGenerator.ts`
- `src/builder/virtualWorldPanel.ts`
- `src/builder/Builder.ts`
- `src/game/Levels.ts`
- `src/world/CaveGenerator.ts`
- `src/world/biomeExtras.ts`
- `tests/virtual-world.test.ts`
- `tests/gen-golden.test.ts`
- `tests/worldgen.test.ts`
- `tests/levels-persistence.test.ts`
- new or updated `scripts/verify-virtual-playtest.mjs`

Acceptance criteria:

- The audit produces before/after screenshots or probe artifacts for the
  representative seeds.
- Material colors, charge, life, and scene lights survive materialization and
  playtest where the paths are supposed to match.
- Any intentional campaign generation change is reflected in goldens,
  `GEN_VERSION`, and findability validation.
- The Builder UI reports dropped scene metadata if caps are exceeded.

Validation:

- `npx vitest run tests/virtual-world.test.ts`
- `npx vitest run tests/gen-golden.test.ts tests/worldgen.test.ts tests/levels-persistence.test.ts`
- `node scripts/verify-virtual-playtest.mjs`
- `npm run verify:findability` after campaign generation edits
- `npm run typecheck`
- `npm run build`

## Workstream 5: Generated Scene Inspector And Capture

Goal: make generated scenes a real Builder workflow instead of a useful overlay.

Designer outcome:

- A selected generated scene can be inspected, understood, and either captured
  into editable content or clearly treated as read-only generated output.

Recommended slices:

1. **Read-only generated scene inspector**
   - Show scene id, source, biome/tags, tile/slot id, bounds, object count,
     light count, and material footprint.
   - Show whether metadata was capped or dropped.
   - Keep selection separate from normal object/light selection.

2. **Capture feasibility pass**
   - Reuse existing prefab or pixel-scene capture helpers if the data shape
     matches.
   - If capture is risky, ship "Open details" first and document what is missing.

3. **Capture to editable content**
   - Convert selected generated scene cells plus supported objects/lights into a
     Builder asset or prefab document.
   - Preserve origin, bounds, and typed refs.
   - Validate captured content with the same Builder validation pipeline.

4. **UX polish**
   - Add hover/click feedback that matches World Map markers and main-canvas
     selection.
   - Add a clear empty state when no generated scene is selected.

Likely files:

- `src/builder/Builder.ts`
- `src/builder/virtualWorldPanel.ts`
- `src/builder/inspectorSchemas.ts`
- `src/builder/prefablib.ts`
- `src/builder/generatedSceneCapture.ts`
- `src/builder/assets/*`
- `tests/builder.test.ts`
- `tests/editor-ui.test.ts`
- `scripts/verify-generated-scene-selection.mjs`

Acceptance criteria:

- Clicking a generated scene opens a stable inspector without stealing normal
  object selection.
- The inspector reports source, bounds, counts, and dropped metadata accurately.
- Capture either produces editable content that validates or remains explicitly
  unavailable with a clear reason.
- Browser verification covers selection, inspector update, and capture/read-only
  behavior.

Validation:

- `npx vitest run tests/builder.test.ts tests/editor-ui.test.ts`
- `node scripts/verify-generated-scene-selection.mjs`
- `npm run verify:builder-ux`
- `npm run typecheck`
- `npm run build`

## Suggested Commit Order

1. `PLAN: next gameplay action sequence`
2. `D1 ONBOARDING: audit and teaching stations`
3. `D1 ONBOARDING: placement validation and probe`
4. `GRIMOIRE: knowledge store and examine lens`
5. `GRIMOIRE: interaction discovery probe`
6. `WANDS: frost charge and shatter frozen review cards`
7. `WANDS: modifier probe and reward-pool decision`
8. `WORLDGEN: visual parity audit harness`
9. `WORLDGEN: first parity fix`
10. `BUILDER: generated scene inspector`
11. `BUILDER: generated scene capture`

## Overall Definition Of Done

This whole sequence is complete when:

- A new player can understand the first four material verbs in D1 without debug
  tools or a written tutorial.
- Grimoire knowledge records recipes, examined materials, and at least five
  witnessed interactions.
- The frozen spell-combo family works in review loadouts and is either promoted
  to the live pool or deliberately deferred with evidence.
- Builder preview, Builder playtest, and relevant campaign runtime paths have
  parity tests and at least one browser-backed audit artifact.
- Generated scenes have a usable inspector and a clear capture/edit story.
- Static tests, build, relevant browser probes, and findability gates pass for
  the slices that touch their surfaces.

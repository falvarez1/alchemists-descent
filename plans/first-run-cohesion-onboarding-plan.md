# First-Run Cohesion And Onboarding Plan

Status: proposal, not implemented as a complete slice.
Created: 2026-06-20.
Scope: the first 10 minutes of a fresh expedition, including controls, component mechanics, wands, spell cards, the Grimoire, Refuge/bench use, and descent goals.

## Purpose

Alchemist's Descent already has strong systemic pieces: falling-sand materials, spell cards, wand sequencing, flask handling, world reactions, D1 Spell Lab generation, Refuge/bench progression, and Grimoire discovery plumbing. The weak point is that a fresh player can see those systems without understanding why they matter or how they connect.

This plan turns the existing first-run path into a playable intro mechanism. The goal is not a separate tutorial level or a wall of text. The intro should teach through real cells, real rewards, and real campaign progression, then quietly get out of the way.

## Current Baseline

- `plans/wand-progression-clarity-plan.md` already covers wand sentence clarity, modifier/projectile relationships, bench organization, card choice presentation, and Refuge/objective clarity.
- `src/game/Hints.ts` already has contextual teach-once hints using `hintTeach` events and persisted seen-hint state.
- `src/game/GrimoireStore.ts` already stores discovered recipes, materials, and interactions.
- `src/game/GrimoireInteractions.ts` already observes world reactions near the player, including water quenching fire, lava flashing water, nitrogen freezing water, conductor charging, and acid/water transmutation.
- `src/ui/CellInspector.ts` already records material lore when the player examines cells.
- `src/ui/CardOfferOverlay.ts` already presents spell/card choices.
- `src/combat/wands/sentenceView.ts` already explains wand sequences as readable card sentences.
- D1 Spell Lab generation is already under test in `tests/gen-level-golden.test.ts`, including Sand, Wood, Fire, Water, Lava, a `chargelatch`, and a tome reward.

The intro should reuse these systems instead of adding a parallel tutorial stack.

## Player Outcomes

A fresh player should learn these facts during a normal D1 run:

- Movement: move, jump, levitate, crouch/crawl, inspect, interact, flask use, wand use, bench use, and map use.
- World rules: materials are real cells, soft materials can be dug, wood burns, liquids flow, lava/water react, cold can freeze, metal/water can carry charge, and mechanisms can be powered.
- Flask rules: the flask can collect and pour materials, and poured materials are useful tools.
- Wand rules: spell cards are read from left to right, modifiers affect later projectile cards, and the bench is where the player edits a wand.
- Reward rules: tomes/card offers change what the player can cast, not just raw stats.
- Knowledge rules: the Grimoire records materials, recipes, and observed interactions.
- Run loop: find the Spell Lab, earn a card, reach Refuge, use the bench, light waystones, find the key/portal, and descend.

## Non-Goals

- Do not renumber or reuse cell IDs.
- Do not introduce a separate tutorial-only save format.
- Do not make the intro a detached training level that bypasses campaign systems.
- Do not replace the existing hint, Grimoire, card offer, wand compiler, or bench systems.
- Do not pause the game repeatedly for instructional popups.
- Do not make Builder authoring a requirement for a player to finish the intro.
- Do not solve full long-term card balance in this milestone.

## Implementation Slices

### Slice 1: First-Run Director And State

Add a small first-run progression layer that coordinates existing systems.

Suggested files:

- New `src/game/FirstRunDirector.ts`
- New `src/game/firstRunState.ts`
- Update `src/game/Game.ts` to construct/dispose the director.
- Update `src/core/events.ts` only if an existing event is insufficient.

Persist a versioned state key:

```ts
const FIRST_RUN_STORAGE_KEY = 'alchemists-descent-first-run-v1';
```

Track explicit booleans rather than vague tutorial progress:

```ts
type FirstRunState = {
  version: 1;
  moved: boolean;
  jumped: boolean;
  levitated: boolean;
  crouchedOrCrawled: boolean;
  firedWand: boolean;
  inspectedCell: boolean;
  siphonedFlask: boolean;
  pouredFlask: boolean;
  observedInteraction: boolean;
  collectedCard: boolean;
  openedBench: boolean;
  editedWand: boolean;
  enteredRefuge: boolean;
  litWaystone: boolean;
  openedGrimoire: boolean;
  descended: boolean;
};
```

Implementation details:

- Load/save through a tiny localStorage wrapper that fails closed when storage is unavailable.
- Keep an in-memory copy so events are not spammed if storage fails.
- Subscribe to existing events such as `hintTeach`, `worldInteractionObserved`, `cardGranted`, `objectiveChanged`, and any existing bench/wand changed events.
- Emit teach-once prompts through the existing hint system rather than direct DOM manipulation.
- Expose a dev-only reset helper for probes, either by clearing the key or a small `window.__adFirstRunReset?.()` hook in development builds.

Acceptance criteria:

- A fresh profile has all state false.
- Repeating the same action does not repeat the same first-run hint.
- Corrupt localStorage resets to defaults without crashing.
- The system can be reset by the browser probe.

### Slice 2: Control Ramp Near Spawn

Use the first stretch of D1 to teach controls only when the player needs them.

Suggested files:

- `src/game/Hints.ts`
- `src/game/hints/seenHints.ts`
- `src/game/FirstRunDirector.ts`
- `src/ui/Hud.ts` if the current hint placement needs a small visual polish pass.

Add first-run hint IDs:

- `move`
- `jump`
- `levitate`
- `crouch-crawl`
- `wand-cast`
- `inspect-cell`
- `flask-siphon`
- `flask-pour`
- `map-open`

Trigger rules:

- Show movement hint shortly after the level starts if no movement has been detected.
- Show jump/levitate after the player approaches the first vertical step or remains near spawn without progress.
- Show crouch/crawl only near a crawlspace, low tunnel, or starter side passage.
- Show wand-cast when a destructible plug, enemy, or practice target is near the player.
- Show inspect-cell near the Spell Lab stations, not at random noise cells.
- Show flask-siphon near a contained water cup or useful liquid source.
- Show flask-pour after the player has collected a material and is near a target station.
- Show map-open only after the player has reached either the Spell Lab or Refuge, so it is not part of the first 30 seconds.

Acceptance criteria:

- Hints are non-blocking and never stack more than one at a time.
- Object-specific hints such as portal/key/cauldron remain higher priority when the player is interacting with those objects.
- A player who already performs the action does not see the corresponding hint.

### Slice 3: D1 Spell Lab As The Main Intro Space

Use the existing D1 Spell Lab as the first concrete mechanics classroom. This keeps the intro tied to campaign progression and avoids tutorial-only content.

Suggested files:

- `src/world/CaveGenerator.ts` or the current Spell Lab generation module.
- `src/game/Levels.ts`
- `src/config/gen.ts`
- `tests/gen-level-golden.test.ts`
- `tests/world-validate.test.ts`
- New `scripts/verify-first-run-intro.mjs`

Required stations:

1. Sand plug station
   - Place a small reward, short route, or visible target behind Sand or soft material.
   - The starter wand or digging spell must solve it.
   - The station teaches that spells affect real cells.

2. Wood and fire station
   - Place a Wood gate or seal near a contained Fire source.
   - The player can burn it with a fire spell, carried fire, or an obvious environmental flame.
   - Include a bypass or fail-open path so the run cannot brick.

3. Flask and liquid station
   - Place a contained Water cup near a contained Lava cup.
   - Teach siphon and pour before requiring precision.
   - Trigger the existing `lava-flashes-water` Grimoire interaction when the player makes steam/stone.

4. Charge station
   - Place a `chargelatch` or similar mechanism near a visible conductor path.
   - Use water/metal/electricity in a readable arrangement.
   - Teach that charge travels through conductive cells.

5. Tome/card reward station
   - End the lab with a fixed safe tome or card offer.
   - The first reward should be easy to understand, such as a clear projectile modifier or a heavier projectile card.
   - Immediately connect the reward to the bench/refuge loop.

Generation rules:

- Every station must be built from normal cells and normal pickup entities.
- Every station must be reachable in the golden seeds used by tests.
- If station geometry changes, bump `GEN_VERSION` in `src/config/gen.ts`.
- Avoid single-cell precision requirements in the first-run path.

Acceptance criteria:

- D1 golden tests verify all required station cells and the tome/card reward.
- Findability verification confirms the Spell Lab and reward are reachable.
- Browser probe confirms the player can complete the intro path without debug movement.

### Slice 4: Wand, Spell Card, And Modifier Teaching

Tie the first card reward directly to wand sentence clarity.

Suggested files:

- `src/ui/CardOfferOverlay.ts`
- `src/ui/WandBench.ts`
- `src/combat/wands/sentenceView.ts`
- `src/ui/Hud.ts`
- `src/game/FirstRunDirector.ts`

Implementation details:

- After the first tome/card reward, emit a teach-once hint: cards are read left to right.
- When the player opens the bench after collecting a card, highlight the first modifier-to-projectile relationship using the existing sentence view structures.
- If the new card is a modifier, visually mark the projectile card it affects.
- If the new card is a projectile, visually mark the modifiers already affecting it.
- Keep the explanation in game terms: "Heavy makes the next projectile hit harder" rather than compiler terms.
- Mark `openedBench` when the bench opens after a card reward.
- Mark `editedWand` when the player moves, adds, removes, or reorders a card after the reward.

Acceptance criteria:

- The first card reward leads to an obvious bench action.
- The bench makes it clear which projectile a modifier affects.
- The HUD or wand preview reflects the changed sentence after the edit.
- Existing modifier/projectile highlight tests and probes still pass.

### Slice 5: Grimoire Intro

Make the Grimoire feel like the player's knowledge record, not a hidden data store.

Suggested files:

- `src/game/GrimoireStore.ts`
- `src/game/GrimoireInteractions.ts`
- `src/ui/CellInspector.ts`
- New `src/ui/GrimoireOverlay.ts` if there is no current player-facing Grimoire UI.
- `src/core/events.ts`
- New or updated `tests/grimoire.test.ts`

Implementation details:

- On first `worldInteractionObserved`, show a teach-once hint that the Grimoire recorded the reaction.
- On first material inspection through `CellInspector`, show a teach-once hint that inspected materials are saved.
- Add a lightweight Grimoire overlay if none exists:
  - Tabs: Materials, Reactions, Recipes.
  - Materials list reads from `GrimoireStore.materials`.
  - Reactions list reads from `GrimoireStore.interactions`.
  - Recipes list reads from `GrimoireStore.recipes`.
  - Empty states should point the player back to inspection, brewing, and observed reactions.
- If full art/book presentation is not ready, ship a clean functional overlay first.
- Mark `openedGrimoire` when the player opens the overlay after at least one discovery.

Acceptance criteria:

- Observing lava and water interact records one interaction and does not duplicate it.
- Inspecting a material records material lore.
- The overlay survives reload through localStorage.
- Storage failure does not block gameplay.

### Slice 6: Refuge, Waystone, Portal, And Descent Loop

Close the intro by connecting learned mechanics to the run objective.

Suggested files:

- `src/game/Hints.ts`
- `src/game/Levels.ts`
- `src/ui/Hud.ts`
- `src/ui/WaystonePromptOverlay.ts`
- `src/ui/Sanctum.ts`
- `src/render/Minimap.ts`

Objective sequence for a fresh D1 run:

1. Reach the Spell Lab.
2. Use materials to open the lab.
3. Claim the spell card.
4. Reach Refuge.
5. Open the bench and improve the wand.
6. Light a waystone with fire.
7. Find the key or portal route.
8. Descend.

Implementation details:

- Use existing `objectiveChanged` events where possible.
- Add first-run objective copy only while the corresponding first-run state flag is false.
- Teach waystones with a concrete prompt near an unlit waystone and Fire source.
- Teach Refuge as the place where wand changes are safe and intentional.
- Teach key/portal after the player has at least one spell reward, so the descent goal does not compete with mechanics onboarding too early.

Acceptance criteria:

- The player always has one clear next objective during the intro.
- Objective text does not hide or replace normal danger information.
- Existing portal/key/cauldron hints still work after the new objective sequence.

### Slice 7: Browser Probe And Regression Tests

Add a dedicated first-run verification probe.

Suggested file:

- New `scripts/verify-first-run-intro.mjs`

Probe steps:

1. Start from a fresh browser context.
2. Clear expedition saves, seen hints, Grimoire storage, and first-run state.
3. Start a fresh D1 run.
4. Verify no page errors during level initialization.
5. Confirm movement/jump/wand hints can appear and retire.
6. Confirm the Spell Lab exists and is reachable.
7. Visit each Spell Lab station and assert the required cells/entities are present.
8. Trigger at least one observed interaction and confirm the Grimoire records it.
9. Collect the first card reward.
10. Open the bench and confirm the card sentence or modifier/projectile relationship is visible.
11. Confirm a Refuge or waystone objective appears after the reward.

Recommended static tests:

- `tests/first-run-state.test.ts` for migration, corrupt storage, and dedupe behavior.
- `tests/hints.test.ts` for first-run hint priority.
- `tests/grimoire.test.ts` for interaction/material discovery dedupe.
- Existing `tests/gen-level-golden.test.ts` for D1 Spell Lab station guarantees.

Validation commands:

```powershell
npm run typecheck
npx vitest run tests/first-run-state.test.ts tests/hints.test.ts tests/grimoire.test.ts tests/gen-level-golden.test.ts
npm run verify:findability
node scripts/verify-first-run-intro.mjs
npm run build
```

## Delivery Order

1. Add this plan and confirm scope.
2. Implement first-run state and director with no worldgen changes.
3. Add control-ramp hints and unit coverage.
4. Add the first browser probe scaffold.
5. Harden D1 Spell Lab station guarantees and update golden tests.
6. Connect first card reward to bench/wand sentence teaching.
7. Add or polish the Grimoire overlay and first discovery hint.
8. Add Refuge, waystone, portal, and descent objective sequencing.
9. Run the full first-run browser probe and tune hint timing.

## Concrete First PR

The first implementation slice should be deliberately small:

- Add `FirstRunDirector`.
- Add `firstRunState` storage helpers.
- Wire the director in `Game`.
- Add first-run hints for movement, jump/levitate, wand cast, and inspect.
- Add `tests/first-run-state.test.ts`.
- Add a stubbed `scripts/verify-first-run-intro.mjs` that starts a fresh run, clears storage, and asserts no page errors.

This first PR should not change worldgen. It should prove the intro coordination layer works against the current D1 Spell Lab before station geometry is adjusted.

## Open Decisions

- Should first-run progress be resettable from the options menu, or only through save/profile reset?
- Should `I` inspection become a fully promoted player control, or stay a discoverable advanced command?
- Should the first card reward be fixed, or should it be a three-card choice from a safe beginner pool?
- Should the bench pause the world completely during first-run teaching?
- Should map teaching happen before the Spell Lab, after Refuge, or only after the player is lost for a short time?

## Completion Definition

This milestone is complete when a fresh player can start D1 and learn controls, material interactions, flask use, the first spell card, wand editing, Grimoire discovery, Refuge/waystone use, and the descent objective without reading external documentation or using debug tooling.

Every lesson must be taught by normal gameplay objects, normal cells, or normal UI systems. The intro should make the game clearer without making the first expedition feel like a separate mode.

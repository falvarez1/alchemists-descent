# Spell, Potion, and Modifier Expansion Plan - Builder Content Addendum

Status: partially implemented. Built-in content metadata is indexed through the shared Asset Database, typed card/potion pickup validation is live, and local assets now mirror through the browser project store when IndexedDB is available. Spell Lab, scenario authoring, and the remaining content-browser workflow phases are still proposed.

Parent plan: `docs/SPELL-POTION-MODIFIER-EXPANSION-PLAN.md`.

Related Builder docs:

- `docs/BUILDER.md`
- `docs/BUILDER-LIVE-UI-SPEC.md`
- `docs/BUILDER-ENHANCEMENT-IMPLEMENTATION-PLAN.md`

## Purpose

The spell, potion, and modifier expansion creates a much larger content surface:
cards, modifiers, wand frames, loadouts, potions, elixirs, cauldron recipes,
materials, projectiles, visual cues, probes, and authored test scenarios. The
Builder should manage that content like a production tool, not like a cheat
panel or a set of free-text fields.

This addendum defines how Builder should expose and validate that content.

The core recommendation:

**Builder should become a content catalog plus test lab. Gameplay code owns
behavior. Builder owns references, previews, scenarios, validation, and
playtest workflows.**

## Executive Summary

Extend the Builder Asset Database with a content-management layer:

1. A read-only built-in content registry generated from canonical game data.
2. A searchable Content Browser mode for cards, wands, potions, materials,
   enemies, prefabs, sprites, and encounter scenarios. This must be a filtered
   Asset Browser view backed by the Asset Database, not a separate browser,
   details panel, dependency graph, or storage model.
3. Typed pickers in inspectors so authored objects reference valid IDs instead
   of free-text strings.
4. A Spell Lab for testing wand/card/potion/flask combinations in contained
   chambers.
5. A validation and cook report that catches missing IDs, review-only content,
   missing icons, unsafe material economy, absent probes, and performance risks.
6. A clean separation between built-in game content, local Builder libraries,
   document-embedded assets, and disposable playtest/runtime state.

This mirrors the production-editor pattern used by mature teams: data assets
describe content, prefabs compose reusable authored chunks, visual scripting or
designer tools expose bounded composition, validation runs before content ships,
and the final build/cook report decides what is shippable.

## Production Tool Patterns To Borrow

The exact engine names differ, but mature game teams tend to converge on these
patterns:

- **Data assets, not hidden constants.** Designers browse data objects with
  stable IDs and metadata. Programmers keep runtime behavior in code.
- **Reusable authored chunks.** Prefabs, blueprints, archetypes, and variants
  let teams compose rooms, encounters, props, and logic from known parts.
- **Bounded designer composition.** Designers combine sanctioned verbs instead
  of writing arbitrary runtime code.
- **Content validation in-editor and in CI.** Missing references, invalid
  dependencies, budget overages, and naming problems are caught before shipping.
- **Asset dependency visibility.** Tools show what an item uses and what uses
  it, so content can be refactored safely.
- **Separation of authoring, preview, and runtime.** Source documents stay
  clean; live preview and playtest create disposable runtime state unless a
  designer explicitly bakes changes back.
- **Cook/export reports.** A build step reports what content ships, what is
  editor-only, what is review-only, and what is blocked.

Builder should adopt those patterns in a lightweight TypeScript-native way
instead of importing a whole external editor architecture. The shared
implementation point is the Asset Database from the Builder enhancement plan:
spell, potion, modifier, and scenario content becomes one set of indexed asset
entries among documents, prefabs, sprites, import reports, and templates.

## Non-Goals

- Do not make Builder a second gameplay runtime.
- Do not let Builder mutate canonical `CARD_DEFS`, `WAND_FRAMES`, material IDs,
  or enemy definitions directly.
- Do not serialize full spell behavior into `EditorDocument`.
- Do not turn sprites or future models into gameplay truth. If something should
  block, burn, conduct, flow, or trigger a gate, it must be represented by real
  cells or explicit runtime objects.
- Do not merge Sandbox raw-grid saves, Builder source documents, and expedition
  saves into one format.
- Do not require a new top-level game mode. Builder owns authoring, live
  preview, and Builder Playtest internally.

## Content Ownership Model

Builder needs four separate content layers.

### 1. Built-In Content

Canonical game content shipped with the repo:

- Cards and modifiers from `CARD_DEFS`.
- Wand frames and review loadouts from `WandSystem`.
- Potions from `POTION_DEFS`.
- Brewed elixir cells and cauldron recipes.
- Materials from `Cell`, material params, color factories, and material info.
- Enemy kinds and enemy definitions.
- Built-in prefabs under the world/prefab pipeline.
- Built-in sprites, icons, and procedural visual renderers.

Builder reads this content through a generated or manually maintained
`ContentRegistry` provider. The provider feeds read-only entries into the
Builder Asset Database. Builder does not edit canonical runtime definitions in
place.

`ContentRegistry` is only for canonical built-in/runtime content. Project,
library, imported, and document-embedded prefabs, sprites, scenarios, and visual
assets are `AssetStore` records indexed directly by `AssetDatabase`, not mutable
registry rows.

### 2. Local Builder Libraries

Designer-local assets:

- User prefabs.
- Imported sprite assets.
- Saved Spell Lab scenarios.
- Saved encounter test rooms.
- Saved view/layout presets.

These should use the Builder `AssetStore` abstraction. The first adapter may
mirror existing localStorage or exported JSON, but content tools should not add
new direct localStorage paths. Local libraries are not authoritative game
content until promoted into repo data.

### 3. Editor Documents

`EditorDocument` stores authored level intent:

- Terrain cells.
- Objects.
- Links.
- Lights.
- Procedural history.
- Validation snapshot.
- Embedded visual assets required by decor.
- References to built-in IDs, such as `{ kind: "card", id: "critwet" }` or
  `{ kind: "potion", id: "swift" }`.

The document should not copy full built-in definitions. It should reference
stable IDs.

### 4. Runtime and Preview State

Disposable state:

- Builder live preview.
- Spell Lab mini chambers.
- Builder Playtest `LevelRuntime`.
- Projectile traces, damage logs, validation runs, and playtest scars.

This state is discarded unless explicitly saved as a scenario or baked into the
document where appropriate.

## Content Registry

Add a read-only registry that normalizes all built-in content for Builder.

### Asset Database Integration Contract

`ContentRegistry` is not a second asset database. It is a read-only source
provider for built-in/runtime content in `AssetDatabase`.

Rules:

- Every built-in `ContentItem` can be projected into an Asset Database entry.
- Content Browser is a filtered Asset Browser mode.
- Content Details is the normal Asset Details panel with content-specific
  sections.
- Content dependency and used-by data goes through the Asset Database dependency
  graph.
- Local scenarios, encounter rooms, local prefabs, imported sprites/models, and
  review metadata are stored through `AssetStore`, not `ContentRegistry`.
- Canonical behavior remains in runtime code; Builder stores refs, previews,
  validation state, local scenarios, and reports.

Recommended file map:

- `src/content/registry.ts`
- `src/content/cards.ts` or generated card adapters.
- `src/content/wands.ts` or generated wand adapters.
- `src/content/potions.ts` or generated potion adapters.
- `src/content/materials.ts` or generated material adapters.
- `src/content/enemies.ts` or generated enemy adapters.
- `src/content/prefabs.ts` or adapters over built-in prefab definitions.
- `src/builder/assets/ContentAssetProvider.ts`
- `src/builder/content/ContentBrowser.ts` only as a thin Asset Browser mode, if
  the existing `builder-assets` panel cannot host the view directly.
- `src/builder/content/ContentDetails.ts` only as content-specific sections for
  the shared Asset Details panel.
- `src/builder/content/contentValidation.ts`

The registry should adapt existing runtime data rather than duplicate it.

### Registry Item Shape

```ts
export type ContentKind =
  | 'card'
  | 'modifier'
  | 'wandFrame'
  | 'wandLoadout'
  | 'potion'
  | 'elixir'
  | 'recipe'
  | 'material'
  | 'enemy'
  | 'prefab'
  | 'sprite'
  | 'encounterScenario'
  | 'spellLabScenario';

export type ContentStatus =
  | 'live'
  | 'review'
  | 'experimental'
  | 'deprecated'
  | 'editorOnly';

export interface ContentItem {
  id: string;
  kind: ContentKind;
  name: string;
  description: string;
  tags: string[];
  status: ContentStatus;
  source: string;
  icon?: string;
  stage?: 1 | 2 | 3 | 4 | 5;
  rarity?: 'common' | 'uncommon' | 'rare' | 'unique';
  biomeTags?: string[];
  dependencies: ContentDependency[];
  validation: ContentValidationSummary;
}

export interface ContentDependency {
  kind: ContentKind | 'code' | 'test' | 'probe' | 'cell' | 'status';
  id: string;
  reason: string;
}

export interface ContentValidationSummary {
  errors: number;
  warnings: number;
  infos: number;
  lastCheckedAt?: string;
}
```

The registry can start small. The important part is the stable interface and
the habit of exposing content through one Asset Database surface.

Scenario taxonomy:

- `spellLabScenario` means a contained spell/potion/flask test setup that can
  become a probe fixture.
- `encounterScenario` means an authored room or combat setup with terrain,
  enemies, rewards, and tutorial/review intent.
- Do not add a generic `scenario` kind unless it has an explicit subtype that
  maps back to one of these Asset Database categories.

Recommended reference shape:

```ts
export interface ContentRef {
  kind: ContentKind;
  id: string;
  origin: 'builtIn' | 'project' | 'documentEmbedded' | 'missing';
}

export const contentAssetKey = (ref: ContentRef): string =>
  `${ref.origin}:${ref.kind}:${ref.id}`;
```

Built-in content may still be displayed in compact form, such as
`card:critwet`, but durable Asset Database keys must include enough scope to
avoid collisions. Project/library/document-embedded content-like assets should
normally use `AssetRef`/`assetId`; use `ContentRef` only when a typed gameplay
content reference is required.

## Stable IDs and Deprecation

Gameplay content needs stable IDs just like cells do.

Rules:

- Never reuse a removed content ID for different behavior.
- Prefer deprecation over deletion.
- Store alias maps for renamed IDs.
- Validation should warn when a document references deprecated content.
- Export should preserve deprecated IDs so old documents still open.
- Cook/build should decide whether deprecated content is allowed in shipped
  levels.
- Asset Database keys should be kind-qualified. A card, potion, prefab, and
  sprite may have the same short ID without colliding if stored as typed refs.
- Non-built-in refs must include origin/scope or use the existing Asset Database
  `assetId` so a project asset cannot collide with a built-in content ID.

Recommended alias shape:

```ts
export const CONTENT_ID_ALIASES: Record<string, string> = {
  // oldId: newId
};
```

For cards, `CardId` remains the TypeScript contract. The registry adds metadata,
Asset Database indexing, dependency visibility, and validation around it.

## Builder UI Surfaces

### Content Browser

Add Content Browser as a Builder Asset Browser mode. It may have a dedicated
panel entry if that improves navigation, but it must reuse the Asset Database,
Asset Details, search/filter infrastructure, dependency graph, and storage
interfaces.

Tabs:

- Cards.
- Wands.
- Potions.
- Recipes.
- Materials.
- Enemies.
- Prefabs.
- Sprites.
- Encounters.
- Scenarios.

Shared controls:

- Search by id, name, tag, source file, status, biome, and dependency.
- Filters for live/review/experimental/deprecated/editor-only.
- Sort by kind, stage, rarity, status, validation severity, and recently used.
- Badges for missing icon, missing probe, review-only, deprecated, dangerous,
  biome-specific, and editor-only.
- A details drawer showing dependencies, used-by references, validation issues,
  and links to source paths.

Content cards should be compact, dense, and utilitarian. This is a production
tool, not a marketplace.

### Content Details

Every content item should have a details panel.

For cards:

- ID, name, kind, mana cost, stage, tags.
- Projectile/modifier/multicast classification.
- Compiler fields touched.
- Runtime dependencies, such as projectile type, status, cell, trail, homing,
  path, trigger, icon, audio, and probe.
- Drop-pool status.
- Review-loadout status.
- Spell Lab button.

For wands:

- Frame stats.
- Slot count.
- Cast delay.
- Recharge.
- Mana max.
- Mana regen.
- Spread.
- Default loadouts.
- Compatibility warnings.

For potions/elixirs:

- Pickup ID.
- Status field.
- Duration.
- Brewed cell if applicable.
- Cauldron recipe if applicable.
- Drink behavior.
- World material behavior.

For materials:

- Cell id.
- Predicate classification.
- Color factory.
- Material params.
- Status interactions.
- Build palette state.
- Save-format risk notes.

For enemies:

- Kind.
- HP, bounty, gore cell.
- Status immunities.
- Biome spawn weights.
- Projectile/spell interactions.
- Preview scenario button.

For prefabs:

- Dimensions.
- Objects, links, lights, anchors.
- Required materials.
- Required mechanisms.
- Findability status.
- Worldgen tags.

For sprites and future models:

- Visual-only or runtime-owned.
- Dimensions.
- Animation tags.
- Emissive status.
- Referenced by documents.
- Missing source warnings.

### Typed Pickers

Replace free-text fields in Builder inspectors with typed pickers.

Current targets:

- Tome card picker.
- Pickup potion picker.
- Enemy kind picker.
- Hazard emitter material picker.
- Sprite asset picker.
- Prefab picker.
- Wand frame picker for future authored loadout fixtures.

Picker behavior:

- Search by id/name/tag.
- Show icon and status badge.
- Disallow invalid references by default.
- Allow deprecated references only with an explicit warning.
- Allow review-only references only in review/test documents.

This avoids silent typos like `critWet` vs `critwet`.

### Placement Palette

Builder should let designers place content references directly:

- Tome with selected card.
- Potion pickup with selected potion.
- Chest with loot table override.
- Wand frame fixture.
- Wand loadout fixture.
- Enemy group with selected enemy kinds.
- Flask fill source.
- Cauldron recipe teaching setup.
- Spell Lab target dummy.

The placement palette should create `EditorObject`s that reference IDs in
`params`, not copy full definitions.

## Spell Lab

The Spell Lab is the most important new Builder surface for this expansion.

It should be a contained test chamber, not normal gameplay.

### Goals

- Compose wand/card/potion/flask setups quickly.
- Fire them in controlled material rooms.
- See real cells left behind.
- See damage, status, mana cost, cooldown, and warnings.
- Save interesting setups as reusable scenarios.
- Generate validation evidence for new cards.

### Inputs

Spell Lab controls:

- Wand frame.
- Wand slots.
- Active wand index.
- Card collection preset.
- Flask material and amount.
- Potion timers.
- Perk flags.
- Player position.
- Aim angle or cursor target.
- Test chamber preset.
- Target enemy kind.
- Target count.
- Terrain/material setup.
- Simulation duration.
- Slow motion and frame advance.

Chamber presets:

- Empty metal cup.
- Water basin.
- Oil trench.
- Gunpowder shelf.
- Blood floor.
- Frozen pocket.
- Metal conductor lane.
- Wood scaffold.
- Acid-safe stone cup.
- Narrow tunnel.
- Boss-size target room.

### Outputs

Spell Lab should show:

- Compiled wand program.
- Per-action mana cost.
- Total cycle cost.
- Cast delay and recharge.
- Projectile count.
- Damage dealt by target.
- Statuses applied.
- Cells written by type.
- Cells consumed from flask.
- Explosion count and max radius.
- Fire/acid/gunpowder risk count.
- CPU timing for projectile update window.
- Screenshot/thumbnail of final chamber.
- Replay scrubber for projectile path.

### Spell Lab Data

Saved scenarios should be small and reference-based:

```ts
export interface SpellLabScenario {
  v: 1;
  id: string;
  name: string;
  wandFrameId: string;
  cards: Array<CardId | null>;
  flask?: { material: number; count: number };
  statuses?: Record<string, number>;
  perks?: string[];
  chamberPreset: string;
  enemyKinds: string[];
  seed: number;
  durationFrames: number;
  notes?: string;
}
```

Scenarios are not gameplay content by default. They are tests, examples, and
design notes until promoted.

### Spell Lab Validation

A scenario can be promoted to a validation scenario if it asserts:

- Required cells were written.
- Required statuses were applied.
- Damage stayed under a cap.
- Damage exceeded a prepared-target floor.
- The projectile path stayed nonblank and collision-honest.
- Flask conservation held.
- No forbidden cells were minted.
- Runtime budget stayed below threshold.

This should feed `scripts/verify-modifier-cards.mjs` later.

## Wands and Loadouts

Builder needs two wand concepts.

### Wand Frame Definitions

Built-in wand frames:

- Read from runtime definitions.
- Browsable in the Asset Browser content mode.
- Not editable in Builder unless a future tuning mode is explicitly added.

### Wand Loadout Assets

A loadout is a reusable authored arrangement:

- Wand frame id.
- Slotted cards.
- Optional collection preset.
- Optional flask/potion/perk preset for testing.
- Tags and notes.

Use cases:

- Review loadouts.
- Boss test loadouts.
- Biome tutorial loadouts.
- Chest/tome reward previews.
- Spell Lab presets.

Recommended shape:

```ts
export interface WandLoadoutAsset {
  v: 1;
  id: string;
  name: string;
  frame: ContentRef; // kind: 'wandFrame'
  cards: Array<ContentRef | null>; // kind: 'card'
  collection?: ContentRef[];
  tags: string[];
  notes?: string;
  status: ContentStatus;
  usageTags?: Array<'example' | 'shipping' | 'bossTest' | 'tutorial'>;
}
```

Shipping loadouts should be validated against current `CardId` and frame slot
count.

## Potions, Elixirs, and Recipes

Builder should expose potions in three related ways:

1. **Potion pickups** as instant effects.
2. **Elixir cells** as real liquids in the world.
3. **Recipes** as cauldron-transmutation logic.

The Asset Browser content mode should make the relationship explicit.

For example:

- `swift` potion pickup has no brewed cell in v1.
- `Cell.ElixirLevity` is a world liquid.
- `levity` cauldron recipe outputs `Cell.ElixirLevity`.

Validation should warn if:

- A pickup potion references a missing status field.
- A brewed elixir cell is drinkable but lacks a `Player.drink` path.
- A recipe outputs a cell that is not liquid.
- A recipe cannot fit in the current cauldron basin.
- A recipe requires a material unavailable in the intended biome.

## Materials

Materials are the most sensitive content category because cell IDs are
save-format contracts.

Builder should manage materials with read-only authority:

- Material browser.
- Palette swatches.
- Predicate badges: solid, liquid, gas, conductor, blocking, powder.
- Material params.
- Reaction notes.
- Light/bloom notes.
- Save-format warning for appended IDs.

Builder should not add material IDs interactively. Adding a new material remains
a code change using the repository checklist.

Useful Builder actions:

- Paint material.
- Fill selected region.
- Replace material.
- Generate a contained material test chamber.
- Show all objects/prefabs/scenarios that depend on a material.

## Enemies and Encounters

Add an Encounter Browser and Encounter Lab after Spell Lab.

Encounter assets should compose:

- Terrain/prefab reference.
- Enemy kinds and spawn positions.
- Optional pickup rewards.
- Optional wand loadout suggestion.
- Optional material setup.
- Optional validation goals.

Recommended shape:

```ts
export interface EncounterScenario {
  v: 1;
  id: string;
  name: string;
  biomeTags: string[];
  terrainPrefabId?: string;
  enemies: Array<{ kind: string; x: number; y: number; params?: Record<string, unknown> }>;
  pickups: Array<{ kind: string; x: number; y: number; params?: Record<string, unknown> }>;
  recommendedLoadoutId?: string;
  validationGoals: string[];
}
```

This gives designers a way to test whether new spells solve real combat rooms,
not just target dummies.

## Sprites, Models, and Visual Assets

The current Builder already treats imported sprites as visual-only assets. Keep
that line hard.

Rules:

- Sprites and future models are presentation assets.
- Collision, flow, conductivity, burning, and blocking come from cells or
  explicit runtime objects.
- A missing visual asset must not break compile.
- A visual asset can be emissive only as a render property.
- A visual asset can be linked to an object, but the object owns gameplay.

If 3D models or richer 2D rigs are added later:

- Store them as AssetDatabase-backed visual asset kinds alongside sprites.
- Preview them in Builder.
- Reference them from decor or authored runtime objects.
- Do not infer gameplay bounds from mesh geometry.
- Keep hitboxes/footprints explicit and inspectable.

Builder details panel should label every visual asset as:

- `VISUAL ONLY`
- `RUNTIME OBJECT VISUAL`
- `EMISSIVE VISUAL`
- `MISSING SOURCE`

This prevents a common editor failure: a designer places a beautiful object
that appears to block or burn but has no grid explanation.

## Prefabs and Content Composition

Prefabs are already the right abstraction for authored structures. Built-in
prefabs may enter through `ContentRegistry`, but local/imported/document
prefabs are `AssetStore` records indexed by `AssetDatabase`.

Add metadata:

- Tags.
- Biome affinity.
- Required materials.
- Required mechanisms.
- Required anchors.
- Intended stage/depth.
- Validation status.
- Findability status.
- Known compatible spell verbs.

Useful prefab details:

- "Solved by" cards/materials.
- "Teaches" cards/materials.
- "Hazards" generated by the prefab.
- "Requires" mechanisms or cell IDs.

Example:

- A frozen bridge tutorial prefab might teach `frostcharge`, require Water and
  Ice cells, and validate that the path is reachable after freezing.

## Validation System

Content validation should run at three levels:

1. **Item validation:** one content item is internally complete.
2. **Document validation:** an authored level references valid and shippable
   content.
3. **Cook validation:** all shipping content passes registry and probe gates.

### Item Validation Examples

Card errors:

- Card ID is missing from `CARD_DEFS`.
- Card is in `MOD_POOL` but has no icon.
- Card is in `MOD_POOL` but lacks a review scenario.
- Card declares trail material that is forbidden for fixed trails.
- Card uses status field missing from `EntityStatus`.
- Card depends on projectile type missing from `ProjectileType`.

Potion errors:

- Potion definition references missing `EntityStatus` key.
- Brewed elixir has no `isLiquid` membership.
- Brewed elixir has no drink handler.
- Recipe output lacks color factory.

Material errors:

- `Cell` ID exceeds `CELL_COUNT`.
- Material has no color factory.
- Material is missing `MATERIAL_PARAMS`.
- Material is paintable but missing palette/icon info.

Prefab errors:

- Missing anchor where worldgen requires one.
- Link points to missing object.
- Hidden linked object breaks compile.
- Required content ID is missing.

Sprite/model errors:

- Missing referenced asset.
- Oversized asset.
- Bad animation tag.
- Visual asset marked as mechanical without an object/cell explanation.

### Document Validation Examples

Errors:

- Tome references unknown card.
- Potion pickup references unknown potion.
- Encounter references unknown enemy.
- Shipping document references review-only content.
- Deprecated content appears without migration.
- Required sprite asset is missing from document export.
- Shipping/share export references a local-only asset that cannot be embedded or
  resolved.
- Puzzle object uses a missing material or cell ID.

Warnings:

- Experimental card used in level.
- High-risk card reward appears before its tutorial.
- Potion recipe requires material not present in biome.
- Spell Lab scenario is missing for a new card used in the document.
- No reachable pickup for a staged tutorial reward.
- Document uses local-only assets that must be embedded, promoted, or replaced
  before sharing/cooking.

Infos:

- Content item is valid but has no thumbnail.
- Content item has no tags.

### Cook Report

The cook report should summarize:

- Total content items by kind and status.
- Shipping items.
- Review-only items.
- Experimental items.
- Deprecated references.
- Missing icons.
- Missing probes.
- Failing validation.
- Documents using each risky item.
- Content newly added since last report.

This report becomes the equivalent of an editor "submit gate".

## Dependency Graph

Builder should expose dependencies both ways through the Asset Database
dependency graph. Content-specific validators may compute extra facts, but they
should publish dependency and usage records into the shared graph so safe
delete, rename, details, validation, and cook reports agree.

For `critwet`:

- Depends on `EntityStatus.wet`.
- Depends on card compiler support.
- Depends on projectile damage helper.
- Depends on icon.
- Depends on Spell Lab scenario.
- Used by loadout `wet-crit-review`.
- Used by tutorial prefab `flooded-crit-room`.

For `Cell.Oil`:

- Used by `Oil Wick`.
- Used by `Oil Charge`.
- Used by material palette.
- Used by prefabs with oil trenches.
- Used by fire reaction code.

This helps answer practical production questions:

- Can we rename this?
- Can we remove this?
- What breaks if this card changes?
- Which test scenario covers this?
- Where is this taught to the player?

## Builder Document Schema Implications

Do not expand `EditorDocument` with full content definitions. Add only compact
reference fields where needed.

Recommended optional fields:

```ts
export interface EditorDocument {
  // existing fields...
  contentPolicy?: {
    allowReviewContent: boolean;
    allowExperimentalContent: boolean;
    targetStage?: number;
  };
  scenarioRefs?: Array<ContentRef | AssetRef>; // spellLabScenario or encounterScenario
}
```

Use `ContentRef` for built-in scenarios and `AssetRef`/`assetId` for local or
project scenario assets stored through `AssetStore`.

For object params, use stable IDs:

```ts
// tome pickup
{ kind: 'pickup', params: { kind: 'tome', card: { kind: 'card', id: 'critwet', origin: 'builtIn' } } }

// potion pickup
{ kind: 'pickup', params: { kind: 'potion', potion: { kind: 'potion', id: 'swift', origin: 'builtIn' } } }

// future wand fixture
{ kind: 'pickup', params: { kind: 'wand', loadout: { kind: 'wandLoadout', id: 'wet-crit-review', origin: 'builtIn' } } }
```

Legacy string refs should continue to load and should be normalized at the
Builder command boundary. Save migration can stay conservative until the typed
ref shape is accepted as an `EditorDocument` contract.

Validation owns whether the referenced IDs are valid and shippable.

## Authoring Workflow

### Adding a New Card

1. Programmer adds runtime card behavior and tests.
2. Card appears in registry as `review`.
3. Builder flags missing icon, missing scenario, and missing probe.
4. Designer creates a Spell Lab scenario.
5. Designer creates or tags tutorial/encounter content if needed.
6. Runtime probe passes.
7. Card moves from `review` to `live`.
8. Card is added to drop pool stage.

Builder should make every missing step visible.

### Adding a New Potion

1. Add potion definition or elixir cell path.
2. Registry shows potion as `review`.
3. Builder validates status field, icon, duration, drink behavior, and recipe.
4. Spell Lab or Encounter Lab scenario proves at least one meaningful use.
5. If brewed, cauldron recipe validation checks current basin capacity.
6. Potion can be placed in authored documents only after validation.

### Adding a New Wand Frame

1. Runtime frame definition is added.
2. Registry exposes frame stats.
3. Builder can preview slot count and compiled spell cycle.
4. At least one loadout scenario is created.
5. Validation warns if frame has no acquisition path or test loadout.

### Adding a New Prefab

1. Capture or generate prefab.
2. Tag biome and purpose.
3. Add anchors if worldgen can place it.
4. Validate links, mechanisms, reachability, and content references.
5. Add findability probe if generated.
6. Promote to built-in only after validation.

### Adding a New Sprite or Model

1. Import visual asset.
2. Validate dimensions, tags, and encoded size.
3. Mark visual-only or attach to a runtime object.
4. Add preview.
5. Embed only when referenced by a document.

## Phased Implementation

### Phase A - Read-Only Content Registry

Deliver:

- `ContentItem` types.
- Registry adapters for built-in cards, modifiers, potions, materials, enemies,
  prefabs, and sprites.
- Asset Database provider that projects registry items into read-only asset
  entries.
- Simple debug panel or console command to dump registry counts.

Acceptance:

- Registry reflects `CARD_DEFS`, `POTION_DEFS`, `Cell`, and built-in sprite/
  prefab definitions without duplicating definitions. Local sprite/prefab
  libraries remain AssetStore data.
- Missing or duplicate IDs are reported.
- Asset Database can query content entries by kind, status, tag, validation
  state, and dependency state.

### Phase B - Typed Pickers

Deliver:

- Card picker for tome pickups.
- Potion picker for potion pickups.
- Enemy picker for enemy objects.
- Material picker for emitters and future recipe helpers.
- Sprite picker reuse through the Asset Browser or Content Browser mode.

Acceptance:

- Free-text card/potion authoring is no longer the default path.
- Invalid IDs cannot be selected through normal UI.
- Existing documents with string IDs still load.
- Pickers emit typed refs or normalize legacy string refs through one adapter.

### Phase C - Content Browser

Dependency:

- Depends on Builder Phase 5B `ContentAssetProvider` and the filtered Asset
  Browser view work. Do not implement this as a standalone browser while those
  pieces are missing.

Deliver:

- Builder Asset Browser mode for browsing content.
- Search, filters, tags, validation badges.
- Shared Asset Details sections with dependencies and source paths.
- "Place", "Inspect", "Open in Spell Lab", and "Show uses" actions where
  applicable.

Acceptance:

- Designers can find all live and review cards without reading source files.
- Content status is visible.
- Review-only and experimental items are clearly marked.
- No separate content dependency graph, storage layer, or browser search model is
  introduced.

### Phase D - Spell Lab MVP

Deliver:

- Wand frame and card-slot editor.
- Flask fill selector.
- Potion/perk toggles.
- Chamber preset selector.
- Target dummy/enemy selector.
- Fire, reset, frame-step, and run-for-N-frames commands.
- Metrics summary.

Acceptance:

- `Water Trail + Critical on Wet + Spark` can be tested in one contained room.
- Results show cells written, damage dealt, status applied, mana cost, and
  warnings.
- Scenario can be saved locally.

### Phase E - Content Validation

Deliver:

- Item validation.
- Document validation integration.
- Validation issue list grouped by content kind.
- Cook report command.

Acceptance:

- Builder reports unknown card/potion/enemy references.
- Builder reports review-only content used in a shipping document.
- Builder reports new cards missing icon/scenario/probe.

### Phase F - Scenario and Encounter Library

Deliver:

- Saved Spell Lab scenarios.
- Encounter scenarios with terrain/enemies/rewards.
- Scenario smart collection in the Asset Browser / Content Browser mode.
- Scenario-to-probe export stub.

Acceptance:

- New card review can point at a concrete scenario.
- Designers can regression-test a spell against a real room.

### Phase G - Promotion Workflow

Deliver:

- Status transitions: experimental -> review -> live -> deprecated.
- Promotion checklist panel.
- Content report export.
- Optional repo-side JSON manifest for promoted scenario metadata.

Acceptance:

- A card cannot quietly enter live drop pools without its checklist being
  visible.
- Deprecated content remains loadable and searchable.

## Suggested File Map

New:

- `src/content/types.ts`
- `src/content/registry.ts`
- `src/content/validate.ts`
- `src/builder/assets/ContentAssetProvider.ts`
- `src/builder/content/ContentBrowser.ts` only if implemented as a thin view
  around `builder-assets`
- `src/builder/content/ContentDetails.ts` only for content-specific sections in
  the shared Asset Details panel
- `src/builder/content/TypedPicker.ts`
- `src/builder/spell-lab/SpellLab.ts`
- `src/builder/spell-lab/scenarios.ts`
- `src/builder/spell-lab/chambers.ts`
- `src/builder/spell-lab/metrics.ts`
- `tests/content-registry.test.ts`
- `tests/builder-content-validation.test.ts`
- `tests/spell-lab.test.ts`

Existing integration points:

- `src/builder/Builder.ts`
- `src/builder/document.ts`
- `src/builder/validate.ts`
- `src/builder/compile.ts`
- `src/ui/WandBench.ts`
- `src/combat/wands/cards.ts`
- `src/combat/wands/WandSystem.ts`
- `src/game/Pickups.ts`
- `src/game/Brewing.ts`
- `src/sim/CellType.ts`
- `src/ui/icons.ts`

## Verification Plan

Static:

- `npm run typecheck`
- `npx vitest run tests/content-registry.test.ts`
- `npx vitest run tests/builder-content-validation.test.ts`
- `npx vitest run tests/wands.test.ts`

Runtime/browser:

- Builder opens Content Browser.
- Content Browser uses Asset Database entries and shared Asset Details.
- Card search finds `spark`, `infuser`, and new review cards.
- Tome inspector uses card picker.
- Potion inspector uses potion picker.
- Spell Lab runs a saved scenario and resets cleanly.
- Builder Playtest still compiles `EditorDocument` without pulling Spell Lab
  state into the level.

Suggested probes:

- `scripts/verify-builder-content-browser.mjs`
- `scripts/verify-spell-lab.mjs`
- Extend `scripts/verify-modifier-cards.mjs` once modifier runtime exists.

## Open Decisions

1. Should built-in content registry metadata live beside runtime definitions, or
   in a separate generated manifest?
2. Which `AssetStore` adapters should save Spell Lab scenarios first: existing
   local browser storage only, exported JSON, or future project-folder storage?
3. Should review-only content be selectable in normal Builder documents with a
   warning, or hidden unless review mode is enabled?
4. Which content filters deserve first-class Asset Browser smart collections,
   versus simple saved filters?
5. Should the first Spell Lab simulate inside the main `World`, a disposable
   mini `World`, or a clipped region of the current document?
6. Should scenario assertions be authored in UI, or only generated from probes
   at first?
7. Should Builder support editing non-shipping local card prototypes, or should
   card behavior always require source code first?

## Recommended First Slice

Build the smallest useful version:

1. Add a read-only content registry for cards, potions, materials, enemies, and
   sprites.
2. Replace tome card and potion pickup free-text inspector fields with typed
   pickers.
3. Add validation for unknown card and potion IDs.
4. Add Cards and Potions smart collections in the Asset Browser, or a thin
   Content Browser mode backed by the same panel.
5. Add "Open in Spell Lab" as a disabled/placeholder action on card details.

This gives immediate value, reduces typo risk, and creates the foundation for
Spell Lab without touching runtime spell behavior.

## Success Criteria

This addendum is successful when:

- A designer can browse every card, wand frame, potion, material, enemy, prefab,
  sprite, and scenario from Builder through the shared Asset Browser/content
  mode.
- Authored documents store stable content references instead of copied runtime
  definitions.
- Builder catches invalid or unshippable content references before playtest.
- New spell cards have visible icons, details, dependencies, scenarios, and
  validation state.
- Spell Lab can prove a spell's grid effects before the card enters live drop
  pools.
- Visual assets remain clearly separated from gameplay mechanics.
- Sandbox remains a scratchpad, Builder remains source-of-truth authoring, and
  Play remains the actual game.

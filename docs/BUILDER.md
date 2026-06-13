# Builder Tool Design

This document is the source of truth for the real level-authoring tool. The
current in-game "Build" mode is a live simulation sandbox: it paints cells, casts
test spells, drops a few enemies, and saves raw grid data. That should become
Sandbox mode. Builder is a separate developer tool for authoring shippable levels,
rooms, encounters, puzzles, lighting, mood, and procedural dressing.

Companion spec: `docs/BUILDER-LIVE-UI-SPEC.md` covers the next Builder workspace
direction: WYSIWYG authoring, live preview, Builder-owned playtest UX, reusable
editor UI framework controls, docked panels, menus, commands, keymaps, overlays,
and workspace persistence.

## Product Intent

Builder is not a cheat panel and not just a material brush. It is a production
tool for shaping the game's look and feel, mechanics, puzzles, pacing, and
aesthetics.

The tool should let a designer:

- Author terrain at cell precision and at room scale.
- Place, select, move, rotate, duplicate, delete, lock, hide, and inspect every
  authored object.
- Compose physics puzzles from explicit linked mechanisms.
- Place exact enemy kinds with deterministic positions and behavior settings.
- Place pickups, potions, tomes, chests, keys, exits, waystones, cauldrons, boss
  markers, rune vaults, and puzzle sensors.
- Add authored lighting with intensity, hue, radius, bloom, flicker, falloff,
  and occlusion controls.
- Run procedural passes over the whole level or a selected region.
- Preview, apply, regenerate, or revert procedural results by seed.
- Validate reachability, links, puzzle wiring, spawn safety, softlocks, and
  visual readability before playtest.
- Compile the authored document into a playtestable `LevelRuntime`.

## Mode Split

### Play

The actual game. It consumes generated or compiled `LevelRuntime` data and owns
combat, simulation, progression, saves, and victory.

### Sandbox

The current Build mode, relabeled and eventually internally renamed. Sandbox
keeps immediate live-sim experimentation:

- Spray cells into the live world.
- Cast build-mode spells into the live world.
- Generate caves quickly.
- Spawn quick test enemies.
- Save/export raw grid experiments.

Sandbox saves are not authoritative level source files. They are scratchpads.

### Builder

A paused authoring environment. Builder edits an `EditorDocument`, not just the
live `World.types` array. Playtest compiles that document into a temporary custom
level runtime.

## Core Architecture

Builder needs a durable authoring layer above the simulation.

```ts
interface EditorDocument {
  v: 2;
  id: string;
  name: string;
  biome: string;
  size: { w: number; h: number };
  world: EditorWorldLayer;
  spawn: EditorSpawn;
  objects: EditorObject[];
  lights: EditorLight[];
  links: EditorLink[];
  proceduralHistory: ProceduralPass[];
  validation: ValidationSnapshot | null;
}
```

The document stores design intent. The compiled playtest stores runtime state.
Runtime mutations should not overwrite the source document unless the user
explicitly bakes them back in.

## Authoring Data

### World Layer

The base world remains a cell grid, but Builder treats it as an editable layer:

```ts
interface EditorWorldLayer {
  rle: string;
  life?: Array<[number, number]>;
  charge?: Array<[number, number]>;
  colorOverrides?: Array<[number, number]>;
}
```

Color overrides are optional and should be used only for authored visual accents.
Most cells should continue to use material color factories so generated worlds
remain cheap and readable.

### Objects

Every non-cell authored thing should be an object with an id.

```ts
interface EditorObject {
  id: string;
  kind: EditorObjectKind;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  locked: boolean;
  hidden: boolean;
  params: Record<string, unknown>;
}
```

Initial object kinds:

- `enemy`
- `pickup`
- `spawn`
- `exitPortal`
- `exitWell`
- `waystone`
- `cauldron`
- `door`
- `plate`
- `lever`
- `brazier`
- `scale`
- `buoy`
- `chargeLatch`
- `runeGlyph`
- `runeDoor`
- `bossMarker`
- `terrainStamp`
- `vegetationStamp`
- `hazardEmitter`
- `decor`

### Links

Links should not be hidden in object params. They need their own records so the
editor can draw, inspect, validate, and repair them.

```ts
interface EditorLink {
  id: string;
  fromId: string;
  toId: string;
  kind: 'triggerDoor' | 'runeDoor' | 'keyPortal' | 'bossGate' | 'logic';
  logic?: 'and' | 'or' | 'sequence';
}
```

For the current mechanism system, multiple trigger-to-door links compile to the
existing AND-gated `targetId` behavior.

### Lights

Manual lights are authored separately from emissive cells.

```ts
interface EditorLight {
  id: string;
  x: number;
  y: number;
  color: string;
  intensity: number;
  radius: number;
  bloom: number;
  flicker: number;
  falloff: 'soft' | 'linear' | 'sharp';
  occluded: boolean;
  locked: boolean;
  hidden: boolean;
}
```

Lighting is part of level feel, not decoration only. A designer should be able
to use it to guide the player, silhouette puzzle inputs, hide danger, and sell
biome identity.

## Tool Categories

### Select

Core operations:

- Click select.
- Shift-click multi-select.
- Drag marquee select.
- Move with mouse or arrow nudge.
- Rotate left/right.
- Duplicate.
- Delete.
- Lock/unlock.
- Hide/show.
- Snap to grid.
- Snap to surface.
- Align/distribute selected objects.
- Group/ungroup.

The right inspector always reflects the current selection. Multi-select should
show shared editable fields and mixed-value states.

### Terrain

For deterministic authored terrain:

- Pencil.
- Brush.
- Line.
- Rectangle.
- Filled rectangle.
- Ellipse.
- Filled ellipse.
- Polygon fill.
- Flood fill.
- Smooth.
- Roughen.
- Replace material.
- Clear material.

Terrain tools directly edit the base world layer and support undo.

### Spray

For live-material authoring:

- Spray material.
- Spray density.
- Spray scatter.
- Spray velocity/no velocity.
- Spray lifetime for fire, smoke, steam, and charged cells.
- Spray charge.
- Spray stains or color accents.

Sprayed materials are baked into cells. This is appropriate for sand piles,
liquid pools, gas pockets, fire starts, debris, and stains.

### Prefabs (stamps grown up)

Reusable authored chunks are **prefabs** (`PrefabDef` v1, `src/builder/prefablib.ts`):
a rectangular terrain block PLUS the objects, internal links, and lights inside
it, in local coordinates. CAPTURE REGION takes everything inside the region
(spawn excluded; links to outside objects dropped with a warning); paste lands
as ONE undoable composite (terrain patch + object/link/light adds with fresh
ids and remapped links). Q rotates / E mirrors the armed copy — door slabs stay
footprint-correct through transforms, patrol points and anchors travel.

The PREFABS panel (`src/builder/prefabPanel.ts`) shows generated thumbnails
(never stored), name/size/content badges, tag chips (`#tag` words in the
capture prompt), and search — your library first, then a **BUILT-INS**
section listing every prefab that ships with the game (the same ones
worldgen places), armable and exportable but not deletable. Hovering any
card raises a POPOVER (no native tooltips): a big rendered preview plus
name, dimensions, object/link/light/anchor counts, tags, and the arming
hint. Per-library-prefab actions: PNG export, JSON export, anchor editing
(worldgen connection points: edge midpoints n/s/e/w, open or sealed),
delete. Legacy terrain-only stamps migrate to prefabs tagged `terrain` on
first load (lossless; old key removed).

Three pipelines consume the same format:

1. **The library** (this panel; per-prefab localStorage keys).
2. **The asset pipeline**: terrain exports as a paintable PNG where each
   opaque color is a material marker (`src/sim/cellPalette.ts` — APPEND-ONLY
   ABI like cell ids; Empty round-trips as transparency; `.GPL` exports the
   named swatches for Aseprite/GIMP). Re-import maps exact colors back to
   cells; stray colors open the import report with nearest-material
   suggestions and SNAP ALL / CANCEL. `.prefab.json` carries the full record
   (kind:'prefab' discriminator); a PNG re-import into the armed prefab
   updates terrain ONLY, keeping objects/links/lights — the
   export → repaint in Aseprite → re-import loop.
3. **Worldgen** (`src/world/prefabs/`): built-in prefabs (repo JSON, built by
   `scripts/gen-builtin-prefabs.mjs`) are placed into generated descent
   levels — see ARCHITECTURE.md. Placement requires at least one anchor.

### Sprites (animated decor)

Pixel animations authored in a dedicated tool (Aseprite is the target) import
as `SpriteAsset` v1 (`src/builder/assets/sprites.ts`): the standard "Export
Sprite Sheet" pair (sheet PNG + JSON — hash or array layout, frame tags,
trimmed frames; rotation must be off) or any uniform-grid sheet PNG. Sprites
keep true RGBA art colors (NOT the cell marker palette); alpha is binary at
50% in the renderer. Arming a sprite places a `decor` object with
`{spriteId, loopTag, fps, flipX}`; the inspector previews the animation live.
EXPORT writes the sheet + Aseprite-array JSON back out (round-trip).

**Animated decor is visual-only** — the same class of thing as enemy sprites
and pickup glyphs. It never collides, blocks, emits, or gates progression:
"if the grid can't explain it, it doesn't ship" governs mechanics, and decor
has none. Anything that should burn, block, or flow must be real cells (use a
prefab instead). Documents embed exactly the sprites their decor references
(`EditorDocument.assets`), so exports and share codes stay self-contained.

### Power editing

- **Floating selection**: X lifts the selected region as a floating block
  (types, colors, life, charge all travel — hand-tints survive); drag or
  arrow keys move it (Shift = 8), Q/E rotate/mirror, Enter or X commits as
  one undoable command, ESC cancels. Capped at 250k cells. While a float is
  up, save/capture/playtest/settle/proc are gated — a world with a lifted
  hole never gets captured.
- **Symmetry**: SYM cycles off/x/y/quad; strokes, shapes, flood, and
  smooth/roughen mirror live across the axis (one gesture = one undo). The
  axis recenters on the active region. Prefab paste mirrors terrain only.
- **Lasso region**: freehand region select, complementing rect/polygon/magic.
- **Decoration passes**: `crowns` writes the armed material onto solid top
  surfaces (clump-biased, skips underwater); `crownTint` recolors surface
  rock with the biome crown palette (colors only, types untouched) via
  `src/world/crownPalette.ts`.

### Procedural

Procedural tools run as named passes. Each pass has a seed, bounds, parameters,
and a preview/apply lifecycle.

Initial passes:

- Full terrain.
- Caves.
- Cavern tunnels.
- Chambers.
- Terrain roughen.
- Material veins.
- Ore/gold pockets.
- Liquid pockets.
- Gas pockets.
- Lava pockets.
- Snow/ice dressing.
- Fungus dressing.
- Vegetation/vines.
- Timber structures.
- Ruins.
- Hazard pockets.
- Enemy population.
- Pickup distribution.
- Waystone placement.
- Puzzle room candidates.
- Boss arena shell.

Every pass can target:

- Whole level.
- Selected rectangle.
- Selected polygon.
- Current connected region.
- Around selected objects.

Every pass should expose:

- Seed.
- Density.
- Scale.
- Material palette.
- Clear existing before apply.
- Respect locked objects.
- Respect protected cells.
- Preview.
- Apply.
- Re-roll.
- Bake.

### Gameplay Objects

The placement palette should expose all shippable gameplay pieces:

- Player spawn.
- Exit portal.
- Exit well and seal.
- Golden key.
- Waystone.
- Cauldron.
- Chest.
- Gold pile with amount.
- Heart.
- Tome with selected card.
- Potion with selected potion kind.
- Boss marker.

The inspector should show gameplay-specific fields. Example: tome card, potion
kind, chest loot table, gold amount, portal key requirement, waystone initially
lit, boss kind.

### Enemies

Enemy placement must be exact, not random top dropping.

Fields:

- Enemy kind.
- Position.
- Facing.
- Initial state: idle, patrol, sleeping, ambush, guarding.
- Difficulty scalar.
- Aggro radius.
- Patrol points.
- Spawn group id.
- Respawn behavior for custom levels.
- Initial material/status overrides where useful.

The canvas should show enemy bounds, facing, aggro radius, and patrol path.

### Mechanisms And Puzzles

Builder must make puzzle authoring explicit.

Placeable mechanisms:

- Door.
- Pressure plate.
- Lever.
- Brazier.
- Sand scale.
- Sluice buoy.
- Charge latch.
- Rune glyph.
- Rune door.
- Sensor zone.

Required controls:

- Link trigger to door.
- Link rune glyph to rune door.
- Set sensor threshold.
- Resize sensor zone.
- Resize door.
- Choose initial state.
- Choose fail-open body cells or auto-capture body cells.
- Preview linked logic.
- Test trigger locally.

Puzzle validation:

- Door has at least one trigger.
- Trigger links to an existing door.
- Multi-trigger doors show AND/OR/sequence logic.
- Sensor zone is visible and sized.
- Fail-open body exists where required.
- Puzzle chamber has an accessible entrance unless intentionally hidden.
- Reward chamber is reachable after solving.
- Destruction fallback is present for progression-critical locks.

### Machine Primitives (chain reactions)

The machine vocabulary (docs/MACHINE-PRIMITIVES-AND-STRUCTURES-PLAN.md) makes
Rube-Goldberg authoring explicit. The model: **actuators** (door, VALVE,
RELAY) aggregate the triggers linked to them with the door's AND/OR/SEQUENCE
logic; everything else emits one output through the LINK tool.

- **Valve** — a small material gate (Metal/Stone/Wood/Glass slab, w×h) that
  opens like a door. A *sluice* is just a wide valve. Options: one-shot
  (stays open) and auto-close frames (force-closes, reopens only on a fresh
  trigger edge). Fail-open is physical: destroyed valve cells ARE the open
  channel.
- **Plug** — real cells that FIRE once when `breakFrac` (default 0.5) of
  their body is destroyed or transformed, by any cause. The material is the
  break profile: wood burns, glass shatters, ash collapses, stone resists
  fire, metal yields only to a relay 'break'. A plug with no out-link is a
  legitimate pure seal.
- **Sensor** — a bounded zone read (heat / liquid / weight / charge /
  material with a filter), threshold, and a latch mode: momentary / timed
  (the 420-frame plate convention) / permanent. Zones scan on a staggered
  4-frame cadence; keep them under ~200 cells (sense a drain channel, not
  the reservoir) — validation warns above that.
- **Counterweight** — a weight pan that latches PERMANENTLY once enough
  material mass stays poured (pure cells, bodies don't count).
- **Relay** — one-shot handoff: inputs satisfied → wait `delay` frames →
  fire once and latch. On fire it can simply activate its target, IGNITE
  real fire at it, BREAK a target plug into debris, or STRIKE (a concussive
  pulse that flips levers and wakes rune glyphs). Relays are the only
  things allowed to drive plugs.

Link rules (enforced): triggers drive doors/valves/relays; plugs receive
only from relays; one out-link per trigger; sequence chains refuse anything
that can never un-fire (brazier, charge latch, plug, counterweight, relay,
permanent sensors). Wire colors say what signal travels: relay violet,
sensor/counterweight teal, plug ember, rune green, plain triggers amber.

The validation fixpoint understands the whole vocabulary: valves stamp and
open like doors, plugs earn at their reachable face or by detonation,
relays chain as pure logic (a relay buried in rock is fine — its INPUTS
carry the reachability requirement). Relay cycles are flagged as errors.

### The Gallery (asset browser)

The GALLERY button (Builder bar) opens a Storybook-style browser for
everything the game can show — and nothing in it is a mockup:

- **MECHANISMS** (13 items) — each runs the REAL `Mechanisms` runtime on a
  scratch world. State chips drive real transitions: the lever pull sweeps
  on loop, the valve retracts its actual cells (TIMED valves slam back
  shut), the plug shows intact/damaged/broken crack stages, the relay's
  fuse visibly burns down and fires, the counterweight tips and raises its
  real toast into the caption strip.
- **PREFABS** (builtins + your library) — actual cells with factory colors,
  authored light halos, idling mechanism overlays, animated decor, and the
  room's inhabitants standing where generation would put them. The MARKERS
  chip overlays worldgen anchors (cyan open / ember sealed), mechanism
  footprints, and pickup spots.
- **ENTITIES** — the Alchemist (IDLE / RUN / CAST / JUMP / HURT / PULL; he
  faces your cursor, and CAST aims the wand straight at it) and every enemy
  kind with its full set of procedural animation states: CALM / ALERTED
  (the gaze locks onto YOUR CURSOR over the stage) plus the kind-specific
  loops — slime/bomber HOP, imp SWOOP, mage CHANNEL, bat SLEEPING/FLARE,
  spitter SPIT, bomber FUSING, golem WALK/POUND, colossus WALK/DOUSED. The
  rigs drive the same entity fields the game AI drives.
- **SPRITES** — animated decor assets playing per loop tag.

Keyboard: ↑↓ browse · ←→ states · `+`/`−` zoom (FIT default) · `/` search ·
ESC close. Previews share their drawing code with the renderer
(`render/sprites/MechanismSprites.ts` etc.), so the gallery can never drift
from what the game shows.

### Lighting

Manual lights should be a major Builder surface.

Controls:

- Hue/color.
- Intensity.
- Radius.
- Bloom contribution.
- Flicker amount.
- Flicker speed.
- Falloff curve.
- Occluded by terrain on/off.
- Preview in editor.
- Solo selected light.
- Toggle all authored lights.

Useful presets:

- Torch.
- Brazier.
- Crystal glow.
- Fungus glow.
- Portal.
- Boss furnace.
- Warning red.
- Cold moonlight.
- Treasure glint.
- Puzzle hint.

The lighting layer should compile into runtime data consumed by `Lighting.build`.
It should coexist with emissive material lights from fire, lava, crystals, and
projectiles.

### Aesthetics And Feel

Builder needs tools for the non-mechanical parts of level craft:

- Biome palette selection.
- Local palette override.
- Background/parallax mood.
- Fog/ambient settings.
- Music or ambience tag.
- Camera framing markers.
- Landmark markers.
- Safe zone markers.
- Danger zone markers.
- Readability overlays for contrast and material identity.

These should be saved as document metadata even if the first runtime pass only
uses a subset.

## Layers

Builder should support visibility, locking, and selection filters per layer:

- Terrain cells.
- Sprayed materials.
- Objects.
- Mechanisms.
- Links.
- Lights.
- Enemies.
- Pickups.
- Procedural previews.
- Validation overlays.

Layer control is mandatory once the editor has dense authored content.

## Undo And History

Undo must be command-based, not whole-world snapshots for every action.

Command examples:

- Paint cells.
- Replace cells.
- Add object.
- Move object.
- Rotate object.
- Delete object.
- Add link.
- Edit params.
- Add light.
- Run procedural pass.
- Bake procedural preview.

Large paint/procedural commands can store compressed before/after cell ranges.

## Save And Export

Builder saves `EditorDocument v2`. It must include:

- Base terrain cells.
- Cell life/charge where intentionally authored.
- All objects.
- All links.
- All lights.
- Spawn metadata.
- Biome and mood metadata.
- Procedural pass history.
- Validation state or last validation timestamp.

There should be three different save families:

- Sandbox raw grid save: quick experiments, current LevelStore v1 lineage.
- Builder document save: source of truth for authored levels.
- Expedition/runtime save: player progress and mutated game state.

These should not share one format.

## Playtest Compile

Builder playtest compiles the authoring document into a `LevelRuntime`:

1. Decode base world cells into `World`.
2. Apply baked terrain stamps.
3. Create runtime pickups from pickup objects.
4. Create runtime mechanisms from mechanism objects and links.
5. Create rune vaults from rune objects and links.
6. Create waystones, portal, exit well, cauldron, spawn, boss marker.
7. Spawn enemies from enemy objects.
8. Attach authored lights to runtime lighting data.
9. Reset transient simulation fields unless explicitly authored.
10. Enter play mode in a temporary custom runtime.

Playtest should not mutate the source document by default. A separate "Bake From
Playtest" action can intentionally copy selected world scars back into the
document.

## Validation

Validation should be visible, fast, and specific.

Minimum checks:

- Has spawn.
- Spawn is in empty/passable space.
- Has a win condition or explicit sandbox/custom flag.
- Portal has a key or is marked always open.
- Required doors have trigger links.
- Linked ids exist.
- No orphaned trigger objects.
- No duplicate ids.
- No object outside bounds.
- Enemies are not embedded in blocking cells.
- Pickups are not embedded in blocking cells.
- Exit/well path is reachable.
- Reward rooms behind puzzle doors are reachable after solving.
- Wave E-style puzzle chambers have an entrance path.
- Progression-critical locks have fail-open or alternate route.
- Manual lights have sane radius/intensity bounds.
- Procedural previews are either applied or discarded before export.

Validation should support severity:

- Error: cannot compile or playtest correctly.
- Warning: likely bad level design.
- Info: notable but intentional possibility.

## UX Requirements

Builder should feel like a developer tool:

- Dense, predictable panels.
- Searchable command palette.
- Keyboard shortcuts for common edit commands.
- Custom popovers on unfamiliar icons. Do not add native browser `title`
  tooltips to Tools, Place, or Mechanisms buttons; those palettes already show
  their own icon/name/description popover.
- Precise numeric fields in the inspector.
- Drag handles for position, bounds, radius, and sensor zones.
- Hover outlines and ids for linked objects.
- Breadcrumbs for selected grouped objects.
- Copy/paste object params.
- "Frame selection" camera command.
- "Find invalid object" command.

No marketing panels, no tutorial cards, and no decorative layout. This is a
production interface.

## Implementation Phases

Status legend: [x] shipped · [~] partially shipped (see notes) · [ ] not started.

- [x] Phase 1 — Sandbox rename
- [x] Phase 2 — Builder shell (overlay, pause claim, markers, inspector)
- [x] Phase 3 — Document, save/load/export/import, command undo/redo
- [x] Phase 4 — Terrain tools: paint, line, rect/filled, ellipse/filled,
      flood fill, replace-in-region, SMOOTH (majority rule) and ROUGHEN
      (boundary jitter) brushes, region select, plus a SETTLE preview
      (hold SETTLE to run real physics; release pauses the sim and offers
      KEEP — undoable when the diff is small enough — or REVERT). Editor
      LAYERS panel: per-family visibility/locking
      (gameplay/mech/links/lights; editor-side — a hidden layer still
      compiles). Deferred: dedicated spray-parameter tools (Sandbox spray
      remains available).
- [x] Phase 5 — Objects: spawn, enemy, pickup, portal, exit well, waystone,
      cauldron, boss marker, HAZARD EMITTER (drips a real cell on a
      cadence) and NOTE (designer annotation, never compiles), all
      persisted. Multi-select (shift-click + marquee), group drag, Ctrl+D
      duplicate (links between selected pairs come along), Ctrl+C/V param
      copy/paste, Ctrl+G group / Shift+G ungroup (clicking a member selects
      the group), ALIGN X/Y + SPREAD H/V, snap-to-grid (off/8/16), door
      ROTATE (swap w/h), enemy PATROL routes (waypoint loops for slimes/
      acid slimes/golems while un-alerted), drag-and-drop placement from
      the palette.
- [x] Phase 6 — Mechanisms & links: door, plate, lever, brazier, scale, buoy,
      charge latch, rune glyph/door; LINK tool with live wires; inspector
      wiring rows with unlink; compiles to runtime Mechanism[] and
      RuneVault[]. Door logic is authorable: AND (default), OR (any trigger),
      SEQUENCE (triggers in link order; wrong order resets; completion
      latches the door open).
- [x] Phase 7 — Lighting: placement, full inspector (color/intensity/radius/
      bloom/flicker/falloff/occluded) with six presets, editor rings, LIVE
      PREVIEW (authored lights feed the real light field while editing),
      SOLO (preview one light in isolation), toggle-all, runtime seeding in
      Lighting.build.
- [x] Phase 8 — Procedural: seeded passes (caves CA, veins, pockets,
      vegetation, scatter, enemy/pickup population) over the whole level, a
      RECTANGLE region, a POLYGON region (click vertices, Enter closes), or
      the CONNECTED CAVERN under a click (magic region) — masks narrow
      passes, replace, and bake. Preview/apply/discard, history persisted.
      Stamps: capture a region as a reusable chunk, rotate (Q) / mirror (E),
      paste through undo. BAKE-FROM-PLAYTEST: scars held on return; a
      region bake is a precise undoable patch, whole-world bake replaces
      the layer (RESTORE is the way back).
- [x] Phase 9 — Playtest compiler (document -> custom LevelRuntime; scars
      never flow back; custom portals award a "level clear" toast).
      Playtest-from-here: T compiles and spawns at the cursor for tight
      iteration loops (death respawns there too).
- [x] Phase 10 — Validation service: ids/links/wiring/bounds/embedding/
      capacity/footing checks plus FIXPOINT findability — BFS from spawn,
      open every door whose full visible trigger set became reachable
      (and rune doors whose glyphs did), repeat until stable; the final mask
      is everything a player can earn. Sequenced puzzles validate correctly
      and never-openable doors genuinely seal their rewards. Hidden objects
      mirror the compiler (they don't stamp, don't compile, kill their
      links). Regression tests in tests/builder.test.ts; end-to-end probes in
      scripts/verify-builder.mjs, scripts/verify-builder-suite.mjs, and
      scripts/verify-builder-expedition.mjs (mid-expedition the Builder
      detaches onto a scratch world; PLAY re-attaches the real level).
      Player-clearance pass: anything cell-reachable but not walkable by a
      5x9 eroded box warns "too tight for the alchemist". Plus: wheel zoom
      (1-4x) with a clickable true-color minimap, readability overlays
      (light coverage / danger / loot, O cycles), autosaved drafts every 30s
      with restore-on-open, shareable level codes (SHARE/CODE — deflate
      + base64, 'PLLD1.' prefix), a COMMAND PALETTE (Ctrl+K — every action
      searchable, incl. "find invalid object"), and document MOOD metadata
      (ambient override applied in playtests + ambience tag). The Builder
      owns the whole left edge: its own material swatches/brush/world-gen
      panel (the Sandbox toolbar yields while it's open). Material swatches
      reuse the same restored pixel icons as the Sandbox toolbar, including
      potions/elixirs and the remapped exotic materials. Probes:
      scripts/verify-builder-pro.mjs (34) and verify-builder-ux.mjs (28).

### Phase 1 - Rename Existing Build To Sandbox

- Relabel UI from Build to Sandbox.
- Update README controls.
- Keep existing behavior intact.
- Keep current raw grid save/export as Sandbox saves.

### Phase 2 - Builder Shell

- Add Builder mode button.
- Add paused editor state.
- Add camera pan/zoom independent of player.
- Add selection model.
- Add right-side object inspector shell.
- Add object/layer panels.

### Phase 3 - Builder Document

- Add `EditorDocument v2` types.
- Add save/load/export/import for Builder documents.
- Add migration/import path from Sandbox raw grid saves.
- Add command-based undo/redo.

### Phase 4 - Terrain And Spray Tools

- Port current brush behavior into Builder terrain/spray tools.
- Add shape tools.
- Add replace/fill/smooth tools.
- Add layer visibility for terrain and sprayed materials.

### Phase 5 - Objects

- Place/move/rotate/delete enemies.
- Place/move/delete pickups.
- Place spawn, portal, exit well, waystones, cauldron, boss marker.
- Persist all object params in document saves.

### Phase 6 - Mechanisms And Links

- Place doors, levers, plates, braziers, scale, buoy, charge latch.
- Add link tool and link overlays.
- Add sensor-zone resize handles.
- Compile mechanisms into runtime `Mechanism[]`.

### Phase 7 - Lighting

- Add authored light records.
- Add light placement and inspector controls.
- Draw editor light overlays.
- Feed authored lights into runtime lighting.

### Phase 8 - Procedural Authoring

- Add procedural pass panel.
- Support whole-level and selected-region passes.
- Add preview/apply/re-roll/bake.
- Persist procedural history.

### Phase 9 - Playtest Compiler

- Compile `EditorDocument` to custom `LevelRuntime`.
- Enter playtest without losing the source document.
- Add optional bake-back workflow.

### Phase 10 - Validation

- Add validation service.
- Add validation overlay and issue list.
- Block export only on hard compile errors.
- Add regression tests for serialization, links, compile, and validation.

## Non-Goals

- Builder should not replace Play progression saves.
- Builder should not automatically turn every playtest scar into source data.
- Builder should not hide authored intent inside raw cells when an object/link
  record is more appropriate.
- Builder should not depend on random runtime generation for shippable authored
  puzzles without storing the seed and pass params.

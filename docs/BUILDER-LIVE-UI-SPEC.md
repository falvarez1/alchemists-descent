# Builder Live Workspace And UI Framework Spec

Status: proposal for iteration.

This document extends `docs/BUILDER.md`. It defines the next Builder direction:
a WYSIWYG authoring workspace that shows real game visuals by default, plus a
small reusable editor UI framework so Builder growth follows one convention
instead of accumulating one-off panels and buttons.

## Goals

- Keep top-level modes clear: Sandbox, Play, Builder.
- Make Builder feel like a real level editor: live-looking, dense, predictable,
  and reusable.
- Show actual terrain, entities, pickups, doors, lights, mechanisms, and decor
  where possible.
- Keep editor overlays as overlays: selection outlines, handles, gizmos, link
  wires, validation markers, and debug/readability views.
- Keep Play and Builder Playtest separate in the user's mind.
- Build a reusable UI foundation for toolbars, docked panels, menus, command
  palettes, inspectors, lists, field controls, tabs, overlays, and workspace
  persistence.
- Keep `EditorDocument` as the source of truth. Live preview and playtest are
  views/sessions over document data, not alternate source formats.

## Non-Goals

- Do not add a fourth top-level "Live Builder" mode.
- Do not make header `PLAY` validate or compile Builder content.
- Do not let live preview silently mutate the source document.
- Do not treat generated expedition runtime state as a perfect authored
  document unless a real runtime-to-document importer is built.
- Do not introduce a broad UI framework dependency unless the local vanilla
  TypeScript approach becomes the limiting factor.

## External Editor Patterns

These are reference patterns, not features to copy wholesale.

- Unity's Scene view is the place where scenery, characters, cameras, lights,
  and other objects are selected and positioned. Its Gizmos menu controls
  component icons, selection outlines, selection wires, and other editor-only
  overlays in Scene/Game views.
  Source: https://docs.unity3d.com/6000.4/Documentation/Manual/GizmosMenu.html
- Unreal separates normal editor work from Play In Editor and Simulate In
  Editor. PIE tests player controls and level events from the editor; SIE runs
  gameplay logic while keeping editor tools available. Unreal also supports
  Play From Here, Eject/Possess, pause/stop, and explicit simulation-change
  retention.
  Source: https://dev.epicgames.com/documentation/unreal-engine/ineditor-testing-play-and-simulate-in-unreal-engine
- Godot exposes debug/editor overlays such as collision and navigation shapes,
  plus Remote/Local scene inspection while a game is running. The useful lesson
  is that debug visualizations are toggles/layers, not separate authoring modes.
  Sources:
  https://docs.godotengine.org/en/stable/tutorials/scripting/debug/overview_of_debugging_tools.html
  https://docs.godotengine.org/en/stable/tutorials/navigation/navigation_debug_tools.html

## Mode And Session Model

Top-level header modes stay:

- `SANDBOX`: live simulation scratchpad. Paint cells, cast test spells, spawn
  quick test enemies, tune live params, save raw grid experiments.
- `PLAY`: the actual game/descent. This is always an escape hatch from Builder
  and must not validate Builder documents.
- `BUILDER`: authored level/document workspace.

Builder owns three internal sessions:

- `AUTHOR`: default editing session. Paused, deterministic, document-owned.
- `LIVE PREVIEW`: Builder-owned animation/simulation preview without full
  player gameplay.
- `PLAYTEST`: Builder-owned compiled runtime for full player testing.

Header `PLAY` always exits Builder and resumes/starts the game. Builder
`PLAYTEST` is a Builder command. It may internally use the game runtime and
`state.mode = 'play'`, but the UI must label it as a Builder playtest and offer
an obvious return path.

## Workspace Layout

Builder should become a workspace shell with persistent layout.

Primary regions:

- Top bar: mode/session controls, document name, save status, validation state,
  playtest controls, workspace menu.
- Left dock: tools, material palette, placement palette, prefab/sprite browser
  tabs.
- Right dock: inspector, layers, validation issues, object list, properties.
- Bottom dock: timeline/log/status, command output, asset import reports,
  optional console integration.
- Map viewport: the game/map rectangle where terrain, live object visuals,
  overlays, handles, and the minimap render.
- Floating panels: short-lived focused tools such as command palette, import
  report, color picker, link editor, sprite preview, prefab detail.

Docking rules:

- Panels are draggable and dockable. Docking is a core Builder workspace
  requirement, not a later nice-to-have.
- Panels can be docked left/right/bottom or floating, and can be dragged
  between dock regions.
- Panels have stable ids and persisted sizes.
- Dock regions take their own space beside the map viewport. The map/game
  rectangle uses the remaining center area, so docked panels do not cover
  playable/editor content unless the user deliberately floats them over it.
- Layout persists in localStorage independently from document saves.
- Reset Workspace restores a known default layout.
- The viewport always keeps enough room to remain useful.
- No nested cards inside cards. Tool surfaces use panels, rows, tabs, and
  field groups.

Default Builder layout:

- `builder-palette` becomes a docked left panel beside the map viewport. It
  should no longer sit over the game/editor rectangle by default.
- `builder-inspector`, `builder-world`, and `builder-matparams` become docked
  right-side panels beside the map viewport. They should no longer sit over the
  game/editor rectangle by default.
- Canvas overlays are reserved for things that must be spatially aligned with
  the world: selection outlines, handles, gizmos, links, validation markers,
  region previews, and live visual content.
- Floating panels are for short-lived or user-detached workflows. The default
  production workspace should keep persistent tools off the canvas.

## Builder UI Framework

Keep the first version local and explicit. Suggested module split:

```text
src/ui/editor/
  Workspace.ts        shell, regions, persisted layout
  Dock.ts             dock areas, splitters, panel registration
  Panel.ts            panel chrome, header actions, tabs
  Menu.ts             menu bar and context menus
  Toolbar.ts          tool groups, icon buttons, segmented controls
  CommandRegistry.ts  commands, labels, enablement, search metadata
  Keymap.ts           shortcuts, conflict detection, focus handling
  Inspector.ts        field groups, mixed values, validation hints
  Fields.ts           number, slider, select, color, checkbox, vec2
  Popover.ts          shared popovers/tooltips
  Modal.ts            confirmation and choice dialogs
  Overlay.ts          canvas overlay layer registry
```

Builder-specific panels then live under:

```text
src/builder/panels/
  ToolsPanel.ts
  MaterialsPanel.ts
  PlacePanel.ts
  PrefabsPanel.ts
  SpritesPanel.ts
  InspectorPanel.ts
  LayersPanel.ts
  ValidationPanel.ts
  ObjectListPanel.ts
  PlaytestPanel.ts
```

The framework should not know Builder document internals. It exposes reusable
view primitives and a command system. Builder owns state and commands.

## Standard Controls

Use one consistent control vocabulary.

- Icon buttons: tool actions, view toggles, selection tools, save/load, undo,
  redo, zoom, frame selection. Use existing pixel icons where appropriate.
- Segmented controls: mode/session/view state, overlay mode, snap grid,
  transform mode.
- Menus: document, edit, view, selection, tools, playtest, help/debug.
- Tabs: panels that share one dock region.
- Toggles/checkboxes: binary settings, layer visibility, lock state.
- Sliders: continuous values with live preview.
- Number fields/steppers: exact numeric authoring.
- Selects/comboboxes: finite option sets such as enemy kind, pickup kind,
  logic kind, biome, preset.
- Swatches: materials, light colors, palette choices.
- Tree/list rows: objects, layers, prefabs, sprites, validation issues.
- Popovers: unfamiliar icon names, large previews, quick metadata.
- Modals: destructive choices, import conflicts, mode-intent decisions.

All controls must have:

- Stable id or command id.
- Disabled state with reason.
- Keyboard focus behavior.
- Short label plus optional detailed popover.
- Pointer-friendly hit target.
- No layout shift when values change.

## Command System

Every user action should be a command with:

- id: `builder.playtest`, `builder.view.gizmos`, `builder.object.duplicate`
- label.
- category.
- shortcut.
- enabled predicate.
- visible predicate.
- run handler.
- optional status/error text.

Surfaces using commands:

- Menus.
- Toolbar buttons.
- Command palette.
- Context menus.
- Keyboard shortcuts.
- Tests/probes.

This avoids drift where the toolbar, palette, and shortcuts each wire their own
version of the same behavior.

## Keymap And Focus Rules

Keyboard capture must be predictable.

- Text inputs own normal typing.
- Modals own Escape/Enter while open.
- Command palette owns its field and selection keys.
- Builder owns authoring shortcuts only while Builder is open and no higher
  priority surface has focus.
- Header mode buttons still work by pointer and should not require Builder
  shortcut ownership.
- Debug console, help, and pause overlays must preempt Builder shortcuts when
  visible.

Keymap conflicts should be logged in development. A command should be able to
declare its shortcut once; panels render the same shortcut text from the registry.

## Visual Builder Views

### Author View

Default Builder view.

Draw real-looking content:

- Terrain from the document world layer.
- Enemy sprites using the same procedural sprite renderers as the game.
- Pickup glyphs/sprites.
- Doors, plates, levers, valves, plugs, sensors, relays, braziers, cauldrons,
  portals, waystones, emitters, and decor using their runtime/preview renderers.
- Authored lights in the actual light field where possible.

Draw editor overlays on top:

- Selection outlines.
- Transform handles.
- Resize handles for zones, doors, valves, plugs, lights.
- Object anchors.
- Link wires.
- Patrol paths.
- Sensor zones.
- Aggro/radius rings.
- Layer lock/hidden states.
- Validation issue badges.
- Object labels when zoomed in or toggled.

Author View must not run full AI, player input, or destructive simulation.

### Live Preview

Builder-owned preview that animates selected systems without entering gameplay.

Allowed:

- Sprite animation.
- Light flicker.
- Decor animation.
- Mechanism idle states.
- Hazard emitter ghost cadence.
- Particle preview with strict caps.
- Optional local mechanism interaction tests.

Not allowed by default:

- Permanent terrain destruction.
- Enemy AI pursuing the player.
- Pickups being consumed.
- Player death/progression.
- Expedition autosave.

Live Preview can operate on a preview runtime/proxy, but the document remains
authoritative. Any "keep changes" behavior must be explicit and scoped.

### Playtest

Builder-owned full runtime test.

Required behavior:

- Compile `EditorDocument` into disposable `LevelRuntime`.
- Label the session as `BUILDER PLAYTEST`.
- Provide `RETURN TO BUILDER`.
- Provide `RESTART PLAYTEST`.
- Support `PLAYTEST HERE` from cursor/camera.
- Preserve the Builder document and UI layout.
- Hold runtime scars for optional bake-back on return.
- Never autosave as an expedition.

Validation policy:

- Warnings do not block playtest.
- Missing optional design affordances do not block playtest.
- Compile-breaking errors can block playtest, but the error must be specific
  and should offer a temporary-spawn or repair action where sensible.
- Header `PLAY` ignores Builder validation and exits to the normal game.

## Gizmos, Overlays, And Debug Views

Gizmos are not substitutes for real visuals. They are editable metadata.

Recommended overlay toggles:

- Gizmos.
- Selection outlines.
- Object labels.
- Links.
- Mechanism footprints.
- Sensor/trigger zones.
- Patrol paths.
- Collision/player clearance.
- Light coverage.
- Danger.
- Loot/reward.
- Reachability/findability.
- Hidden objects.
- Locked objects.
- Grid/snap.
- Bounds/safe areas.

Overlays should be registered with an `OverlayRegistry`:

```ts
interface EditorOverlay {
  id: string;
  label: string;
  defaultVisible: boolean;
  draw(ctx: BuilderDrawContext): void;
}
```

Overlay visibility belongs to workspace preferences, not document saves, unless
an overlay encodes authored data such as hidden/locked state.

## Selection And Hit Testing

WYSIWYG rendering makes selection harder unless the editor gives clear rules.

- Hit testing uses authored object bounds/handles, not only visible sprite
  pixels.
- Tiny sprites get enlarged selectable anchors.
- Alt or a modifier can cycle through overlapping hits.
- Object List always provides deterministic selection fallback.
- Locked objects render normally but cannot be selected from the canvas unless
  "select locked" is enabled.
- Hidden objects are omitted from normal canvas hit testing unless hidden
  overlay/select hidden is enabled.
- Multi-select shows shared properties and mixed-value fields.
- Selection must survive switching Author/Live Preview/Playtest-return when
  object ids still exist.

## Inspector Conventions

Inspector fields must be predictable and dense.

Field groups:

- Identity: kind, id, name/label, group.
- Transform: x, y, rotation, size/radius.
- Gameplay: kind-specific data.
- Visual: color, sprite, light, decor, preview state.
- Links: inbound/outbound wiring rows.
- Validation: local issues and quick fixes.

Conventions:

- Every numeric field supports direct text entry.
- Drag handles and inspector values stay synced.
- Mixed values are shown explicitly in multi-select.
- Invalid values show inline reason and do not silently clamp unless the command
  is a deliberate "fix" command.
- Object ids are visible but visually secondary.
- Copy/paste params uses field groups, not ad hoc object cloning.

## Menus

Recommended menu bar:

- Document: New, Open, Save, Save As, Import, Export, Share, Settings.
- Edit: Undo, Redo, Cut, Copy, Paste, Duplicate, Delete.
- View: Frame Selection, Zoom, overlays, panels, Reset Workspace.
- Select: Select All, Invert, Same Kind, Same Group, Locked/Hidden options.
- Tools: tool selection, snap, symmetry, settle, procedural passes.
- Playtest: Playtest, Playtest Here, Restart, Return, Bake Scars.
- Help: controls, command palette, diagnostics.

Menus should be command-driven. Context menus should use the same command ids.

## Docked Panels

Minimum panel set:

- Tools: select, paint, shapes, region, link, light, object placement.
- Materials: swatches, brush controls, material popovers.
- Place: gameplay objects, mechanisms, enemies, pickups, decor.
- Inspector: current selection fields.
- Layers: visibility, lock, selectability.
- Object List: searchable hierarchy/list by layer/kind/group.
- Validation: issue list, severity filters, quick frame/fix actions.
- Prefabs: library, built-ins, preview, tags, capture/import/export.
- Sprites: imported assets, loop tags, preview, placement.
- Procedural: pass list, seed, params, preview/apply/discard.
- World/Mood: biome, ambience, ambient light, background/local palette.
- Playtest: status, return/restart, spawn mode, bake options.

Panels should have consistent chrome:

- Title.
- Optional tab.
- Header actions.
- Collapse.
- Drag handle.
- Dock target affordance.
- Floating/docked state indicator.
- Close/hide where applicable.
- Body scroll that never steals global shortcuts unless an input is focused.

## Workspace Persistence

Persist only editor preferences:

- Dock layout and panel sizes.
- Open/closed panel ids.
- Overlay visibility.
- Snap/grid settings.
- Last selected tool.
- Last search/filter text only when useful.

Do not persist:

- Document content in workspace settings.
- Runtime playtest state.
- Expedition state.
- Temporary validation or import errors except as document validation snapshots.

Document autosave remains separate from workspace layout.

## Rendering Architecture

Avoid making the Builder canvas a second renderer that drifts from the game.

Recommended direction:

- Extract reusable preview draw functions for objects/mechanisms/entities.
- Keep editor overlay drawing separate from runtime sprite drawing.
- Prefer document/proxy render data in Author View.
- Use a disposable preview runtime only for systems that require runtime shapes.
- Keep frame budgets explicit; the editor should remain responsive with dense
  levels.

Possible module split:

```text
src/builder/render/
  BuilderRenderer.ts       terrain + world snapshot + draw orchestration
  ObjectPreview.ts         object-to-preview dispatch
  GizmoLayer.ts            selection, handles, labels
  OverlayRegistry.ts       registered overlays
  HitTest.ts               object/handle hit testing
  PreviewRuntime.ts        optional live preview proxy runtime
```

## State Ownership

Ownership table:

| Data | Owner | Notes |
|---|---|---|
| `EditorDocument` | Builder | Authoritative source. |
| Workspace layout | Editor UI framework | Local preference only. |
| Sandbox raw grid | Sandbox | Scratch data. |
| Expedition runtime/save | Play/Levels | Never mutated by Builder editing. |
| Builder playtest runtime | Builder | Disposable custom runtime. |
| Live preview state | Builder | Disposable/proxy; explicit bake only. |
| Validation snapshot | Builder document | Last checked state, not a lock. |

## Edge Cases

Invalid document:

- Author View still opens.
- Live Preview still renders partial content where possible.
- Header Play still exits to the game.
- Playtest blocks only on compile-breaking errors and must explain the exact
  blocker.

No spawn:

- Author View and Live Preview are allowed.
- Playtest offers "use camera/cursor as temporary spawn" or a quick Add Spawn
  action.

Multiple spawns:

- Prefer one primary spawn.
- If multiple are allowed later, the active one must be explicit.

Opening Builder from Play:

- Ask intent: edit current scene snapshot or continue Builder document.
- Snapshot path captures terrain and current player spot as a spawn.
- Do not claim generated enemies/pickups/mechanisms as clean authored objects
  until a deliberate importer exists.

Leaving Builder:

- Header Play exits to game regardless of validation.
- Builder Exit returns to Sandbox/build surface.
- Unsaved document changes are protected by draft/save prompts.

Live Preview mutation:

- No permanent document mutation without a command.
- Any bake/keep action must be undoable when scoped and honest when too large.

Selection:

- Overlapping objects require hit cycling or object-list fallback.
- Locked/hidden selection behavior must be explicit.

Keyboard:

- Modal, command palette, text input, help, and debug console focus preempt
  Builder shortcuts.

Performance:

- Dense overlays can be toggled.
- Live Preview uses caps and throttles.
- Hit testing should use spatial indexes or coarse buckets once object counts
  grow.

Persistence:

- Workspace layout corruption should fall back to default.
- localStorage quota failures should degrade to export prompts.

Browser/platform:

- Pointer capture must release on modal open/close and mode switches.
- Resize and high-DPI changes must not desync hit testing.
- Fullscreen/keyboard-lock play must not strand the user in Builder playtest.

## Implementation Plan

### Phase A - Guardrails And Naming

- Keep header `PLAY` as the normal game escape hatch.
- Label Builder playtest clearly as `BUILDER PLAYTEST`.
- Add `RETURN TO BUILDER` and `RESTART` controls during playtest.
- Keep `PLAYTEST` and `PLAYTEST HERE` as Builder commands.
- Add tests for invalid-doc header Play behavior.

### Phase B - Command Registry

- Introduce `CommandRegistry` and `Keymap`.
- Move Builder bar actions onto command ids.
- Wire toolbar, command palette, and shortcuts through the same commands.
- Add enabled/disabled reason strings.

### Phase C - Workspace Shell

- Add dock regions and panel registration.
- Migrate existing Builder bar/palette/inspector/status into registered panels
  without changing behavior.
- Move `builder-palette` into the default left dock.
- Move `builder-inspector`, `builder-world`, and `builder-matparams` into the
  default right dock.
- Add draggable panel chrome and visible dock targets for left/right/bottom and
  floating states.
- Persist panel open state and sizes.
- Add Reset Workspace.

### Phase D - Standard Controls

- Add shared field controls for number, slider, checkbox, select, color, swatch,
  text, and vector fields.
- Migrate inspector rows to shared controls.
- Standardize popovers and modals.
- Add focus/keymap tests.

### Phase E - WYSIWYG Author View

- Replace generic object icons with real preview drawing where renderers exist.
- Keep icons only as anchors/overlays for small or abstract authoring data.
- Add selection outlines, handles, labels, link wires, and layer filters over
  the real visuals.
- Add hit testing that uses object bounds/handles.

### Phase F - Overlay Registry

- Move existing readability overlays into registered overlays.
- Add collision/player-clearance, links, triggers, patrols, hidden/locked, and
  validation badges as independent toggles.
- Persist overlay visibility in workspace settings.

### Phase G - Live Preview

- Add Author/Live segmented control.
- Animate decor, entities, lights, and selected mechanism idle states.
- Add strict mutation boundaries and preview caps.
- Add local mechanism test actions.

### Phase H - Builder Playtest Shell

- Add Builder Playtest badge and return/restart controls.
- Add playtest source flag separate from normal Play.
- Add Playtest Here spawn mode.
- Keep scars for scoped bake-back.
- Verify no expedition autosave or level transition logic treats Builder
  playtests as normal runs.

### Phase I - Docking Polish

- Add advanced docking polish after the required draggable dock shell exists:
  tab reordering, detachable floating windows, snap-back targets, and workspace
  presets.
- Add workspace presets: Compact, Wide, Validation, Lighting, Prefab.
- Add panel search and commandable panel focus.

## Verification Plan

Automated:

- Unit tests for command registry enablement and keymap conflicts.
- Unit tests for workspace layout serialization and reset fallback.
- Unit tests for inspector field controls and mixed values.
- Browser probe: header Play exits Builder with invalid doc.
- Browser probe: Playtest button compiles valid doc and returns to Builder.
- Browser probe: live preview does not mutate document terrain or objects.
- Browser probe: overlay toggles persist and do not affect document saves.
- Browser probe: object hit testing selects visible sprites and tiny anchors.

Manual:

- Open Builder from Play, choose both intent paths.
- Author invalid content, verify Play still starts/resumes game.
- Playtest from spawn and from cursor.
- Return from playtest, bake selected scars, undo scoped bake.
- Resize browser, verify canvas hit testing stays aligned.
- Reset workspace after corrupting/clearing localStorage layout data.

## Open Decisions

- Should Builder use a local vanilla TypeScript UI framework long-term, or move
  to a small declarative renderer if panel complexity keeps growing?
- Should Live Preview animate all visible entities or only selected/nearby
  entities by default?
- How much of a generated expedition scene should the current-scene snapshot
  import beyond terrain and player spawn?
- Should Playtest Here default to cursor, camera center, or last explicit test
  spawn?
- Which overlays are global workspace preferences and which should be saved per
  document?
- Do workspace presets need to be user-editable, or are fixed presets enough?

## Acceptance Criteria

The Builder UI framework is successful when:

- New panels are registered rather than hand-positioned.
- Persistent Builder panels are docked beside the map/game viewport by default,
  not layered over it.
- Panels can be dragged between left, right, bottom, and floating regions.
- New toolbar/menu/palette entries use command ids.
- Keyboard shortcuts, command palette entries, and buttons cannot drift.
- The same field controls are reused across inspector panels.
- Layout and overlay preferences persist without touching document saves.
- WYSIWYG Author View shows the level as the player will perceive it, with
  editor overlays layered on top.
- Play, Sandbox, Builder Author, Builder Live Preview, and Builder Playtest are
  distinguishable by behavior and UI, even if they share internal runtime code.

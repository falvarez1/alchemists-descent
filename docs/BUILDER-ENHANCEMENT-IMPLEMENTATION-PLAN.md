# Builder Enhancement Implementation Plan

Date: 2026-06-13

## Purpose

This plan turns the Builder enhancement audit into a prioritized implementation
roadmap. It complements `docs/BUILDER.md`,
`docs/BUILDER-LIVE-UI-SPEC.md`, and `docs/DEV-CONSOLE-PLAN.md`.

The immediate goal is not to add more isolated controls. The goal is to finish
the reusable editor framework underneath Builder so future panels, previews,
commands, popovers, validation actions, and console integration do not keep
creating cross-cutting defects.

## Current State Summary

Builder has strong authored-level foundations already:

- `EditorDocument v2` owns terrain, objects, links, lights, mood, assets, and
  procedural history.
- `src/builder/validate.ts` already performs deep structural and reachability
  validation.
- `src/builder/prefablib.ts` already supports room-scale prefabs with terrain,
  objects, links, lights, import/export, and sanitization.
- Browser probes already cover a large part of the authoring workflow:
  `scripts/verify-builder-ux.mjs`, `scripts/verify-builder-pro.mjs`,
  `scripts/verify-builder-suite.mjs`, `scripts/verify-builder-prefabs.mjs`,
  `scripts/verify-builder-power.mjs`, and `scripts/verify-console.mjs`.

The main weakness is framework maturity:

- `src/builder/Builder.ts` is still the owner of too many framework concerns:
  dock layout, panel dragging, panel rendering, keyboard routing, popovers,
  command dispatch, inspector rendering, issue rendering, canvas tools, and
  playtest state.
- `src/ui/editor/Workspace.ts`, `CommandRegistry.ts`, `Keymap.ts`, and
  `Fields.ts` exist, but they are still lightweight primitives rather than the
  central source of truth.
- Dev Console is now dockable, but it still has transitional keyboard and
  command ownership that should be merged into the shared framework at the
  correct time.
- Several UI surfaces still build HTML strings and then rebind events with
  `querySelector`, which makes focus, accessibility, popover ownership, and
  command drift harder to control.

## Audit Evidence

The plan is based on the current checkout, not only the desired end state:

- `src/builder/Builder.ts` remains the main coordination point for too many
  responsibilities. It constructs the workspace DOM, wires panel dragging,
  registers commands, handles playtest, renders the command palette, renders
  the inspector, renders issues, syncs markers, and owns keyboard handling.
- `src/ui/editor/Workspace.ts` already persists panel layout, overlay
  visibility, collapsed sections, snap step, and last tool, but the panel set
  is still hardcoded data. There is no panel registry, lifecycle model, tab
  model, panel z-order, active panel, or declarative panel contract yet.
- `src/ui/editor/CommandRegistry.ts` has the right seed shape, but `run`
  currently fires async commands without awaiting, always returns immediately
  on started commands, and does not provide typed status/error output.
- `src/ui/editor/Keymap.ts` normalizes shortcuts and detects conflicts, but it
  only guards raw text-entry elements. It does not know Builder sessions,
  modal priority, command palette ownership, console focus, help overlays, or
  game/Sandbox input priority.
- `src/ui/editor/Fields.ts` centralizes escaping and simple field HTML, but it
  is still string-based control rendering. It has no inspector schema layer,
  mixed-value model, validation decoration model, command binding, or undo
  ownership.
- `src/builder/render/OverlayRegistry.ts` proves the right direction with
  registered overlays, but the overlay set is still shallow and not yet tied to
  validation repair, spatial gizmos, hit testing, or commandable visibility.
- `src/builder/validate.ts` already emits severity-based issues and performs
  reachability checks, but issues do not yet have stable codes, grouped repair
  metadata, overlay metadata, or first-class quick-fix commands.
- Builder document storage and drafts are still localStorage/share-code
  oriented. That is good enough for iteration, but asset-heavy production work
  needs quota handling, export recovery, duplicate detection, and stronger
  import diagnostics.

## Implementation Boundaries

- Do not replace the Builder document model with live `World` edits. Document
  mutations must go through Builder commands and remain undoable.
- Do not let Builder Live Preview or Builder Playtest masquerade as normal
  expedition Play. Preview state is disposable; playtest state is a temporary
  runtime derived from the document.
- Do not turn the transitional console registry into the final editor command
  framework. Preserve the future shared namespaces: `console.*`, `game.*`,
  `builder.*`, and `workspace.*`.
- Do not build framework features only for the current Builder panels. Docking,
  focus, command metadata, keymap, popovers, menus, fields, overlays, and panel
  chrome should be reusable by Console and future editor tools.
- Do not add permanent canvas-covering panels as default UI. Persistent tools
  belong in docks; canvas overlays are reserved for spatial data.
- Do not save workspace preferences into `EditorDocument`, and do not save
  authored document state into workspace preferences.
- Do not hide runtime/gameplay semantics inside purely visual Builder widgets.
  If a mechanic matters to gameplay, the authored cells, objects, links, or
  runtime compiler must explain it.

## Guiding Rules

1. Keep `EditorDocument` as the only durable Builder source of truth.
2. Keep Sandbox raw-grid saves, Builder documents, and expedition runtime saves
   separate.
3. Do not let Live Preview or Playtest silently mutate Builder documents.
4. Every user action that changes Builder state should be a command, or a
   deliberate preview action with explicit apply/discard semantics.
5. Modal, help, command palette, console input, text fields, and panel chrome
   must have explicit focus priority.
6. Editor UI may preview gameplay systems, but gameplay rules still come from
   real cells and existing runtime systems.
7. Each implementation phase must end with runtime probes, not only unit tests.
8. After each implementation phase, run both review passes:
   - Expert review: game/editor-engine architecture, runtime safety, and
     source-of-truth boundaries.
   - Critic review: defects, regressions, focus leaks, UX ambiguity, missing
     tests, and naive implementations.

## Priority Model

Priority meanings:

- P0: Framework stability. Required before more feature work.
- P1: Core authoring productivity. High value and blocks larger levels.
- P2: Preview correctness and WYSIWYG confidence.
- P3: Advanced composition and polish.
- P4: Nice-to-have, performance, documentation, and long-tail refinement.

## Implementation Progress

- Phase 0 baseline: complete. Active probes and dirty-worktree boundaries were
  preserved; unrelated in-flight files remain unstaged and untouched.
- Phase 1 DockHost/PanelRegistry/PanelChrome: complete. Builder and Dev Console
  panels use shared registry-derived layout sanitization, floating z-order,
  dock reordering, maximize/restore, and live drag feedback.
- Phase 2 FocusRouter/Keymap: complete. Builder simple shortcuts route through
  command metadata, modal/help/palette/console/text focus priority is explicit,
  console input release uses the owning `InputManager`, and Builder-open console
  targets remain explicit.
- Phase 3 PopoverHost/MenuHost: complete. Sandbox/Builder material popovers and
  prefab previews use shared portal placement, Builder panel chrome context menus
  use command ids, menu/popover focus surfaces are represented in `FocusRouter`,
  and modal priority closes command menus before dialogs take focus.
- Phase 4 InspectorSchema/typed fields: complete. Builder document, object,
  light, and multi-select inspector rows render from schema metadata with
  explicit ownership/target tags. Document mood edits now use undoable Builder
  metadata commands, multi-select shared flags use composite commands, issue
  rows escape imported validation text, sprite emissive remains an asset-library
  edit instead of mutating embedded document assets, and numeric handlers enforce
  schema validation at the command boundary.

Latest validation for the Phase 4 checkpoint:

- `npm run typecheck`
- `npx vitest run tests/editor-ui.test.ts tests/builder.test.ts tests/sprites.test.ts`
- `node scripts/verify-builder-ux.mjs http://127.0.0.1:5180/` (78 checks)
- `node scripts/verify-console.mjs http://127.0.0.1:5180/` (63 checks)
- `node scripts/verify-matpop.mjs http://127.0.0.1:5180/`
- `node scripts/verify-app-dialogs.mjs http://127.0.0.1:5180/`
- `npm run lint`
- `npm test` (16 files, 288 tests)
- `npm run build`

## Phase 0 - Baseline And Worktree Safety

Priority: P0

### Goal

Create a clean baseline for framework refactors without losing existing
Builder/console coverage or accidentally mixing unrelated dirty work.

### Work

- Record current Builder UI contracts from:
  - `docs/BUILDER.md`
  - `docs/BUILDER-LIVE-UI-SPEC.md`
  - `docs/DEV-CONSOLE-PLAN.md`
- Add a short implementation checklist to this file as phases are completed.
- Snapshot current probe coverage and identify which probes must keep passing
  after every phase.
- Keep all changes selectively staged if a commit is requested. This repo often
  has unrelated Builder, console, render, or docs edits in flight.

### Source Targets

- `scripts/verify-builder-ux.mjs`
- `scripts/verify-console.mjs`
- `tests/editor-ui.test.ts`
- `docs/BUILDER-ENHANCEMENT-IMPLEMENTATION-PLAN.md`

### Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run tests/editor-ui.test.ts`
- `node scripts/verify-builder-ux.mjs http://localhost:5173`
- `node scripts/verify-console.mjs`

### Review Gate

Expert and critic agents confirm the plan does not blur Sandbox, Builder, and
Playtest state ownership.

## Phase 1 - DockHost, PanelRegistry, And Panel Chrome

Priority: P0

### Goal

Move docking and panel lifecycle out of `Builder.ts` into reusable editor
framework code.

### Why First

Most recent defects came from panel behavior: overlapping floating panels,
hidden dock targets, drag handles, double scrollbars, close/maximize conflicts,
right-dock popovers, and Dev Console integration. These are framework defects,
not individual panel defects.

### Work

- Add `src/ui/editor/PanelRegistry.ts`.
  - Registers panel id, title, default dock, min/max size, icon, close policy,
    allowed docks, command ids, and render/mount hooks.
  - Supports non-Builder panels such as `dev-console`.
- Add `src/ui/editor/DockHost.ts`.
  - Owns left, right, bottom, and floating regions.
  - Applies `WorkspaceLayout`.
  - Computes dock sizes.
  - Handles drag start, drag preview, drop targets, reordering, floating
    coordinates, z-order, and bounds clamping.
  - Exposes `focusPanel`, `openPanel`, `closePanel`, `movePanel`, and
    `raisePanel`.
- Add `src/ui/editor/PanelChrome.ts`.
  - Standard heading, drag handle, close, maximize/restore, dock state, tab
    affordance, and actions slot.
  - Applies a consistent panel boundary and section spacing.
- Expand `WorkspaceLayout`.
  - Persist active panel id.
  - Persist z-order for floating panels.
  - Persist dock region order independently from panel defaults.
  - Add optional `width`, `height`, and `tabGroupId`.
- Keep `Workspace.ts` as pure data operations. Move DOM work elsewhere.
- Replace Builder-local panel movement in `Builder.ts` with `DockHost` calls.
- Register these panels:
  - `builder-palette`
  - `builder-inspector`
  - `builder-world`
  - `builder-matparams`
  - `builder-proc`
  - `builder-issues`
  - `dev-console`
  - later: `builder-outliner`, `builder-link-graph`, `builder-validation`

### Source Targets

- New: `src/ui/editor/DockHost.ts`
- New: `src/ui/editor/PanelRegistry.ts`
- New: `src/ui/editor/PanelChrome.ts`
- Update: `src/ui/editor/Workspace.ts`
- Update: `src/builder/Builder.ts`
- Update: `src/ui/ConsoleOverlay.ts`
- Update: `src/styles/main.css`
- Update: `tests/editor-ui.test.ts`
- Update: `scripts/verify-builder-ux.mjs`
- Update: `scripts/verify-console.mjs`

### Acceptance Criteria

- Docked panels take layout space and never cover the stage unless explicitly
  floating.
- Empty docks remain valid drop targets while dragging.
- Floating panels land at the pointer release position.
- Floating panels can be raised, moved, maximized, restored, and closed.
- Panel drag starts only from chrome.
- Two panels in the same dock can be reordered.
- Scrollbars are visually consistent across all Builder panels.
- Dev Console uses the same panel lifecycle as Builder panels.

### Verification

- Unit tests for `WorkspaceLayout` migration and panel order.
- Browser probe for left/right/bottom/floating moves.
- Browser probe for empty dock drop targets.
- Browser probe for Dev Console close/maximize/restore while floating.
- Browser probe for z-order and overlap behavior.

### Review Gate

Expert review checks that the dock framework is not Builder-specific. Critic
review attempts to reproduce every previous dock defect.

## Phase 2 - Shared Focus Router And Complete Keymap Ownership

Priority: P0

### Goal

Replace ad hoc capture-phase keyboard handling with a predictable editor focus
and command routing stack.

### Work

- Add `src/ui/editor/FocusRouter.ts`.
  - Tracks priority surfaces:
    1. App dialog / Builder intent modal
    2. Builder Help
    3. Command palette
    4. Dev Console focused input
    5. Other text inputs and select controls
    6. Dev Console open but unfocused
    7. Builder workspace
    8. Game/Sandbox input
  - Offers `claimKeyDown`, `claimKeyUp`, and `isTextEntryTarget`.
- Expand `Keymap`.
  - Scope commands by mode: global, Builder Author, Builder Live Preview,
    Builder Playtest, Sandbox, Play, Console.
  - Support per-command priority and chord normalization.
  - Return explicit block reasons.
  - Log conflicts in development.
- Move Builder shortcut dispatch through `Keymap`.
  - Remove the manual command chain in `Builder.ts` after parity is proven.
  - Keep escape/floating-selection special cases as scoped commands.
- Coordinate with ConsoleOverlay.
  - Console binds stay transitional until this phase lands.
  - Once FocusRouter exists, console should ask it before consuming `H`,
    Backquote, Escape, Tab, Enter, and printable keys.
- Make every toolbar, menu, palette, context-menu, and keyboard action point to
  the same command id.

### Source Targets

- New: `src/ui/editor/FocusRouter.ts`
- Update: `src/ui/editor/Keymap.ts`
- Update: `src/ui/editor/CommandRegistry.ts`
- Update: `src/builder/Builder.ts`
- Update: `src/ui/ConsoleOverlay.ts`
- Update: `src/ui/HelpOverlay.ts`
- Update: `src/input/InputManager.ts` if global input gating needs one hook
- Update: `tests/editor-ui.test.ts`
- Update: `scripts/verify-console.mjs`
- Update: `scripts/verify-input-capture.mjs`

### Acceptance Criteria

- Pressing `H` opens Builder Help when Builder owns focus.
- Pressing `H` types into a focused console input or text input.
- Console open but unfocused does not steal Builder Help.
- Builder Help blocks Backquote from opening console beneath it.
- Builder intent modal blocks console, global help, gameplay keys, and Builder
  shortcuts.
- Command palette owns its field and selection keys.
- Keyboard shortcuts, toolbar buttons, and command palette entries cannot drift.

### Verification

- Unit tests for focus priority and keymap conflicts.
- Browser probes for Builder Help, console, modal, command palette, text inputs,
  and gameplay input leakage.

### Review Gate

Expert review checks focus ownership against the mode model. Critic review tries
to type normal text, hold keys, repeat shortcuts, and open overlapping surfaces.

## Phase 3 - Shared Popover, Tooltip, Menu, And Modal Infrastructure

Priority: P0

### Goal

Stop implementing popover and modal behavior separately per surface.

### Work

- Add `src/ui/editor/PopoverHost.ts`.
  - Renders into a top-level portal.
  - Supports anchor element, anchor rect, cursor position, preferred side,
    collision resolution, viewport margins, dock clipping avoidance, hover
    delay, and keyboard dismissal.
  - Supports interactive and non-interactive popovers.
- Add `src/ui/editor/MenuHost.ts`.
  - Uses the command registry for menu items.
  - Supports context menus on stage, markers, outliner rows, panels, and
    toolbar buttons.
- Consolidate Builder Help and AppDialog focus behavior with `FocusRouter`.
- Move material, object, prefab, sprite, import report, and toolbar popovers to
  `PopoverHost`.
- Preserve the existing `AppDialog` path for confirmations/prompts. Do not add
  native `window.alert`, `window.confirm`, or `window.prompt`.

### Source Targets

- New: `src/ui/editor/PopoverHost.ts`
- New: `src/ui/editor/MenuHost.ts`
- Update: `src/builder/Builder.ts`
- Update: `src/builder/prefabPanel.ts`
- Update: `src/builder/spritePanel.ts`
- Update: `src/ui/Toolbar.ts`
- Update: `src/ui/AppDialog.ts`
- Update: `src/styles/main.css`
- Update: `scripts/verify-matpop.mjs`
- Update: `scripts/verify-builder-ux.mjs`

### Acceptance Criteria

- Popovers never render offscreen after panels are moved or docked.
- Popovers are not clipped by scroll containers.
- Popovers close on Escape, scroll, mode switch, and panel close.
- Context menus use command ids and show disabled reasons.
- Existing material/object/prefab/sprite information remains visible.

### Verification

- Browser probe for popovers in left dock, right dock, bottom dock, floating
  panel, and near all viewport edges.
- Browser probe for context menu command execution and disabled reasons.

### Review Gate

Expert review checks portal layering and command ownership. Critic review checks
edge collisions, scroll containers, z-index, and focus traps.

## Phase 4 - InspectorSchema And Typed Field System

Priority: P1

### Goal

Replace object-specific inspector string assembly with declarative schemas that
support validation, mixed values, undoable commands, and reusable controls.

### Work

- Add `src/ui/editor/InspectorSchema.ts`.
  - Field types: number, slider, select, checkbox, color, text, vec2, swatch,
    command button, separator, readout, custom preview.
  - Field metadata: label, hint, disabled reason, min/max/step, default,
    validation, command id, value getter, value setter.
  - Mixed-value behavior for multi-select.
- Add `src/builder/inspectorSchemas.ts`.
  - Schema per `EditorObjectKind`.
  - Schema for `EditorLight`.
  - Schema for document mood/world settings.
- Move object parameter editing to command-backed setters.
- Show inline validation hints before commit where possible.
- Make sprite-level library edits explicitly separate from document undo.
- Add field-level repair actions where validation already knows the issue.

### Source Targets

- New: `src/ui/editor/InspectorSchema.ts`
- New: `src/builder/inspectorSchemas.ts`
- Update: `src/ui/editor/Fields.ts`
- Update: `src/builder/Builder.ts`
- Update: `src/builder/commands.ts`
- Update: `src/builder/document.ts`
- Update: `tests/editor-ui.test.ts`
- Update: `tests/builder.test.ts`
- Update: `scripts/verify-builder-ux.mjs`

### Acceptance Criteria

- Inspector rows are generated from schemas, not per-kind HTML strings.
- Multi-select shows shared properties and mixed values.
- Editing a shared field applies one composite command.
- Invalid values explain the reason and do not silently clamp unless the command
  is explicitly a fix command.
- Object kind changes rebuild only the affected inspector schema.
- Undo/redo works for all document-backed inspector edits.

### Verification

- Unit tests for schema rendering, mixed values, disabled reasons, and command
  execution.
- Browser probe for editing at least one field per object family:
  gameplay object, mechanism, machine primitive, light, decor sprite, document
  mood, and material/world parameter panel.

### Review Gate

Expert review checks command and document ownership. Critic review checks
multi-select edge cases, invalid input, undo/redo, and schema drift.

## Phase 5 - Object Outliner, Layer Manager, And Link Graph

Priority: P1

### Goal

Give authors a scalable way to inspect dense levels without relying only on
canvas markers.

### Work

- Add `builder-outliner` panel.
  - Rows for objects, lights, groups, prefabs, links, and hidden/locked state.
  - Search by id, kind, label, params, sprite name, group, and validation text.
  - Filter chips: gameplay, mechanisms, machines, lights, decor, hidden,
    locked, invalid, selected.
  - Visibility and lock toggles.
  - Click selects, double-click frames, context menu uses commands.
- Add `builder-link-graph` panel.
  - Trigger-to-actuator graph.
  - Door/valve/rune-door inputs.
  - Relay chains.
  - Sequence order.
  - Dead links and hidden endpoint warnings.
- Make the existing layer controls command-driven and persist visibility in
  workspace settings where appropriate.

### Source Targets

- New: `src/builder/outlinerPanel.ts`
- New: `src/builder/linkGraphPanel.ts`
- Update: `src/ui/editor/PanelRegistry.ts`
- Update: `src/builder/Builder.ts`
- Update: `src/builder/selection.ts`
- Update: `src/builder/validate.ts` if issue metadata needs richer codes
- Update: `scripts/verify-builder-ux.mjs`

### Acceptance Criteria

- Authors can find and select any object without seeing it on the canvas.
- Hidden and locked states are obvious and commandable.
- Link chains are inspectable without selecting every object manually.
- Validation issues are visible beside related outliner rows.
- Outliner selection stays in sync with canvas selection.

### Verification

- Browser probe for search, selection, frame, visibility, lock, and graph row
  navigation.
- Unit tests for outliner row model and graph model.

### Review Gate

Expert review checks graph semantics against compiler/runtime links. Critic
review checks dense-level usability and selection synchronization.

## Phase 6 - Validation Workbench And Guided Repair Actions

Priority: P1

### Goal

Turn validation from a report into an authoring workflow.

### Work

- Extend `DocIssue`.
  - Add stable issue code.
  - Add severity.
  - Add object ids.
  - Add world location.
  - Add optional repair actions.
  - Add optional overlay kind.
- Split validation presentation from validation computation.
  - `validateDocument` remains pure and fast.
  - `ValidationPanel` renders issue groups, filters, and actions.
- Add repair commands:
  - Add spawn at camera.
  - Move spawn to cursor/camera.
  - Mark portal always-open.
  - Create missing golden key near reachable area.
  - Select broken link endpoint.
  - Remove dead link.
  - Open/add validation overlay.
  - Preview carve corridor, then apply as terrain command.
  - Ignore issue with document annotation where appropriate.
- Add reachability overlay.
  - Spawn-reachable cells.
  - Earned-after-open cells.
  - Too-tight-for-alchemist cells.
  - Unreachable object badges.
- Add Playtest blocker dialog with repair options.
  - No spawn should offer temporary camera/cursor spawn or quick Add Spawn.

### Source Targets

- New: `src/builder/validationPanel.ts`
- New: `src/builder/validationActions.ts`
- Update: `src/builder/validate.ts`
- Update: `src/builder/render/OverlayRegistry.ts`
- Update: `src/builder/Builder.ts`
- Update: `src/builder/commands.ts`
- Update: `tests/builder.test.ts`
- Update: `scripts/verify-builder-suite.mjs`
- Update: `scripts/verify-builder-ux.mjs`

### Acceptance Criteria

- Validation issues have stable codes suitable for tests and documentation.
- Issue rows can frame/select affected objects.
- Common compile blockers have repair actions.
- Playtest blocks only on compile-breaking errors and explains exact blockers.
- Header Play still exits Builder regardless of Builder validation.
- Repair actions are undoable when they mutate the document.

### Verification

- Unit tests for issue codes and repair commands.
- Browser probes for no-spawn playtest repair, broken link repair, unreachable
  key framing, and reachability overlay.

### Review Gate

Expert review checks validation against compiler/runtime behavior. Critic review
checks that repairs do not silently mutate more than advertised.

## Phase 7 - PreviewRuntime And Live Preview Session

Priority: P2

### Goal

Make Live Preview a real Builder-owned session instead of scattered previews.

### Work

- Add `src/builder/PreviewRuntime.ts`.
  - Disposable world/entity/mechanism sandbox derived from `EditorDocument`.
  - Supports selected-region or selected-object simulation.
  - Has strict caps for cells, particles, enemies, lights, and frame budget.
  - Can reset from document at any time.
  - Never writes back except through explicit bake/keep commands.
- Move settle preview, light preview, mechanism idle preview, patrol preview,
  and selected-system simulation behind the preview runtime where possible.
- Add session controls.
  - Author.
  - Live Preview.
  - Playtest.
  - Restart Preview.
  - Apply scoped bake.
  - Discard preview changes.
- Add visual status.
  - Preview running/paused.
  - Mutation boundary.
  - Scope: whole visible view, selected object, selected region.

### Source Targets

- New: `src/builder/PreviewRuntime.ts`
- Update: `src/builder/compile.ts`
- Update: `src/builder/Builder.ts`
- Update: `src/builder/render/ObjectPreview.ts`
- Update: `src/builder/render/OverlayRegistry.ts`
- Update: `src/game/instantiate.ts` only if a shared pure compile helper is
  needed
- Update: `scripts/verify-builder-pro.mjs`
- Update: `scripts/verify-builder-ux.mjs`

### Acceptance Criteria

- Live Preview animates selected mechanisms, lights, emitters, doors, patrols,
  liquids, and simple enemy idle/movement without entering full Play mode.
- Preview state is disposable.
- Document terrain and objects remain unchanged until explicit apply.
- Preview caps prevent major frame-time spikes.
- Playtest remains the only full player/gameplay run.

### Verification

- Browser probe proves Live Preview does not mutate document terrain or objects.
- Browser probe proves preview reset returns to authored state.
- Browser probe proves a mechanism can be previewed without full Play mode.
- Performance probe records budget for a dense preview scene.

### Review Gate

Expert review checks sim/runtime boundaries and frame-order safety. Critic
review checks silent mutation, stale preview state, and performance cliffs.

## Phase 8 - Spatial Authoring Gizmos And Measurement Tools

Priority: P2

### Goal

Make canvas editing feel like a real level editor instead of marker clicking.

### Work

- Add transform gizmos.
  - Move handles.
  - Resize handles for slab/zone objects.
  - Rotate handles for directional objects.
  - Waypoint handles.
  - Light radius and falloff handles.
  - Link endpoint handles.
- Add spatial guides.
  - Rulers.
  - Cell-coordinate readout.
  - Measurement line.
  - Alignment guides.
  - Snap grid overlay.
  - Object footprint preview.
- Expand snap.
  - Snap off, 4, 8, 16, object anchors, prefab anchors, surface snap.
  - Temporary modifier for snap override.
- Add commandable view controls.
  - Fit document.
  - Frame selection.
  - Zoom in/out/reset.
  - Center on spawn.
  - Center on validation issue.

### Source Targets

- New: `src/builder/gizmos.ts`
- New: `src/builder/spatialGuides.ts`
- Update: `src/builder/Builder.ts`
- Update: `src/builder/selection.ts`
- Update: `src/builder/render/OverlayRegistry.ts`
- Update: `src/ui/editor/CommandRegistry.ts`
- Update: `scripts/verify-builder-ux.mjs`

### Acceptance Criteria

- Objects can be resized and rotated on canvas where their type supports it.
- Guides appear only when useful and do not obscure the authored scene.
- Snap behavior is visible and predictable.
- Every gizmo edit is undoable as one command.
- Canvas hit testing remains aligned after resize, zoom, docking, and panels.

### Verification

- Browser probe for resize/rotate/move handles.
- Browser probe for snap modes and viewport resize alignment.
- Unit tests for gizmo hit testing where practical.

### Review Gate

Expert review checks authored footprint consistency. Critic review checks
mis-clicks, tiny handles, zoom scaling, and undo grouping.

## Phase 9 - Prefab Composition, Anchors, And Asset Manager

Priority: P2

### Goal

Turn prefabs and sprites from lists into a composition workflow.

### Work

- Add prefab details panel.
  - Large preview.
  - Objects/links/lights summary.
  - Tags.
  - Anchors.
  - Validation summary.
  - Export/import actions.
- Add prefab variants.
  - Rotation and mirror variants.
  - Material substitution where safe.
  - Optional object inclusion toggles.
- Add anchor snapping.
  - North/south/east/west connection points.
  - Surface alignment.
  - Preview connection validity.
- Add prefab dependency checks.
  - Missing sprite assets.
  - Broken local links.
  - Spawn objects rejected from prefabs.
  - Oversized room warnings.
- Add asset manager panel.
  - Sprites, prefabs, documents, imports.
  - Storage quota status.
  - Duplicate content detection.
  - Re-id collision report.
  - Per-asset export/delete/rename/tag.

### Source Targets

- New: `src/builder/assetManagerPanel.ts`
- New: `src/builder/prefabDetailPanel.ts`
- Update: `src/builder/prefablib.ts`
- Update: `src/builder/prefabPanel.ts`
- Update: `src/builder/assets/spritelib.ts`
- Update: `src/builder/assets/sprites.ts`
- Update: `tests/prefabs.test.ts`
- Update: `tests/assets.test.ts`
- Update: `scripts/verify-builder-prefabs.mjs`

### Acceptance Criteria

- Prefab anchors can snap to compatible world or prefab anchors.
- Prefab variants preview before placement.
- Missing assets are reported before playtest.
- Asset storage problems are isolated per asset and shown clearly.
- Built-in prefabs remain immutable but exportable.

### Verification

- Unit tests for anchor transforms and variant transforms.
- Browser probe for anchor snapping, detail preview, and asset manager actions.

### Review Gate

Expert review checks prefab transform math and compiler compatibility. Critic
review checks storage failure behavior, corrupted assets, and import UX.

## Phase 10 - Menus, Toolbar Binding, And Panel Search

Priority: P3

### Goal

Make commands discoverable without adding more permanent toolbar clutter.

### Work

- Add command-driven menu bar:
  - Document
  - Edit
  - View
  - Selection
  - Tools
  - Panels
  - Playtest
  - Help
  - Debug
- Add context menus:
  - Stage.
  - Selection.
  - Object marker.
  - Light marker.
  - Outliner row.
  - Validation row.
  - Panel heading.
  - Prefab card.
- Add panel search/focus command.
  - `workspace.focusPanel`
  - `workspace.openPanel`
  - `workspace.closePanel`
  - `workspace.reset`
- Render command shortcuts and disabled reasons from registry metadata.
- Add command aliases for console use, but do not allow console-only command
  semantics to drift from Builder command semantics.

### Source Targets

- New: `src/ui/editor/MenuHost.ts`
- New: `src/ui/editor/ToolbarBinding.ts`
- Update: `src/ui/editor/CommandRegistry.ts`
- Update: `src/builder/Builder.ts`
- Update: `src/ui/ConsoleOverlay.ts`
- Update: `scripts/verify-builder-ux.mjs`
- Update: `scripts/verify-console.mjs`

### Acceptance Criteria

- Every visible Builder action has a command id.
- Toolbar, menu, command palette, context menu, and shortcut all run the same
  command.
- Disabled commands show the same reason everywhere.
- Panel search can focus/open any registered panel.

### Verification

- Unit tests for command metadata and duplicates.
- Browser probe for menu/context menu execution.
- Browser probe for command palette and panel focus.

### Review Gate

Expert review checks command namespace design. Critic review checks drift,
disabled states, and keyboard-only operation.

## Phase 11 - Advanced Overlays And Authoring Diagnostics

Priority: P3

### Goal

Give authors high-signal visual diagnostics without replacing real visuals.

### Work

- Add overlays:
  - Reachability heatmap.
  - Alchemist clearance heatmap.
  - Trigger dependency graph.
  - Lighting contribution.
  - Hazard map.
  - Enemy notice cones.
  - Patrol timing.
  - Liquid flow hints.
  - Compile diff.
- Make overlays registered and commandable.
- Persist overlay preferences in workspace layout, not document saves, unless
  an overlay encodes authored data.
- Add overlay legend popovers through `PopoverHost`.

### Source Targets

- Update: `src/builder/render/OverlayRegistry.ts`
- New or update: `src/builder/render/*.ts`
- Update: `src/builder/validate.ts`
- Update: `src/builder/Builder.ts`
- Update: `scripts/verify-builder-ux.mjs`

### Acceptance Criteria

- Overlays are readable at multiple zoom levels.
- Dense overlays can be toggled individually.
- Overlay state does not dirty the Builder document.
- Validation overlays match validation results.

### Verification

- Browser probe samples overlay pixels and state persistence.
- Unit tests for overlay preference sanitization.

### Review Gate

Expert review checks that overlays encode truthful runtime/compiler data.
Critic review checks visual clutter and stale overlay state.

## Phase 12 - Performance, Accessibility, And Polish Pass

Priority: P4

### Goal

Make the finished framework feel stable under repeated use.

### Work

- Add accessibility pass:
  - Focus rings.
  - ARIA labels for icon-only controls.
  - Dialog roles.
  - Panel headings.
  - Keyboard traversal.
  - Reduced-motion handling for nonessential animations.
- Add performance pass:
  - Avoid full DOM rebuilds for large panels.
  - Virtualize outliner and asset lists if needed.
  - Throttle expensive overlay and minimap work.
  - Cache stable preview canvases.
  - Add performance markers for Builder frame costs.
- Add visual polish:
  - Consistent panel boundaries.
  - Consistent scrollbars.
  - Consistent close/maximize icons.
  - Clear selected, hover, disabled, active, and warning states.
  - No nested cards.
  - No canvas-overlapping persistent tools unless floating by choice.
- Add documentation:
  - Update `docs/BUILDER-LIVE-UI-SPEC.md` with final architecture.
  - Update `docs/BUILDER.md` with user-facing workflows.
  - Add troubleshooting notes for workspace reset and import recovery.

### Source Targets

- `src/styles/main.css`
- `src/ui/editor/*`
- `src/builder/*`
- `docs/BUILDER.md`
- `docs/BUILDER-LIVE-UI-SPEC.md`
- `scripts/perf-scene.mjs` or a new Builder-focused perf probe

### Acceptance Criteria

- Builder remains usable at desktop and small-width viewports.
- Text does not overflow controls.
- Keyboard-only use covers core authoring workflows.
- Large documents do not make the UI unusable.
- Docs match implemented behavior.

### Verification

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `node scripts/verify-builder-ux.mjs http://localhost:5173`
- `node scripts/verify-console.mjs`
- `node scripts/verify-builder-suite.mjs http://localhost:5173`
- `node scripts/verify-builder-pro.mjs http://localhost:5173`
- `node scripts/verify-builder-prefabs.mjs http://localhost:5173`
- `node scripts/verify-builder-power.mjs http://localhost:5173`
- Builder perf probe once added.

### Review Gate

Expert review checks final architecture and runtime boundaries. Critic review
checks polish, accessibility, text overflow, stale state, and repeated open/close
cycles.

## Cross-Phase Requirements

### Command Requirements

- All mutating Builder actions must have a command id.
- Commands must expose label, category, shortcut, enabled predicate, disabled
  reason, visibility, and optional search keywords.
- Commands that mutate documents must use `CommandStack` or explicit preview
  apply/discard semantics.
- Commands that mutate workspace layout must never dirty the Builder document.
- Console command aliases must not bypass Builder command validation.

### Workspace Requirements

- Workspace preferences include panel layout, panel open state, z-order,
  collapsed palette sections, snap/grid settings, overlay visibility, and last
  selected tool where appropriate.
- Workspace preferences exclude document data, playtest state, runtime state,
  import errors, and expedition state.
- Workspace reset restores a usable default layout even after corrupt storage.
- Docked panels must keep the stage useful at smaller viewports.

### Validation Requirements

- Validation remains pure and independent from UI.
- Validation issue codes are stable.
- Validation repair actions are commands.
- Validation overlays derive from validation data, not duplicated logic.
- Playtest blockers must be specific and repairable where practical.

### Live Preview Requirements

- Live Preview is disposable.
- Live Preview must be capped.
- Live Preview must not write document terrain, objects, links, lights, assets,
  or mood without an explicit command.
- Scoped bake-back must be honest about what it changes and whether undo is
  available.

### Dev Console Requirements

- Dev Console is a workspace panel in Builder.
- Dev Console remains compatible with Builder Author, Builder Live Preview, and
  Builder Playtest.
- Console input owns typing only when focused.
- Console open but unfocused must yield to higher-priority Builder help and
  modal surfaces.
- Console command aliases should reuse command registry entries after the
  shared command architecture is ready.

## Test Matrix

Every phase should update at least one static/unit test and one browser probe
when behavior is visible.

| Area | Unit Tests | Browser Probes |
| --- | --- | --- |
| Docking | `tests/editor-ui.test.ts` | `verify-builder-ux`, `verify-console` |
| Keymap/focus | `tests/editor-ui.test.ts` | `verify-console`, `verify-input-capture` |
| Popovers/menus | `tests/editor-ui.test.ts` | `verify-matpop`, `verify-builder-ux` |
| Inspector schema | `tests/editor-ui.test.ts`, `tests/builder.test.ts` | `verify-builder-ux` |
| Validation repair | `tests/builder.test.ts` | `verify-builder-suite`, `verify-builder-ux` |
| Live Preview | targeted unit tests | `verify-builder-pro`, new preview probe |
| Prefabs/assets | `tests/prefabs.test.ts`, `tests/assets.test.ts` | `verify-builder-prefabs` |
| Console integration | `tests/console.test.ts` if needed | `verify-console` |

## Recommended PR Slices

Use small, shippable slices instead of one large rewrite:

1. Panel registry data model plus tests.
2. DockHost behind existing DOM with no visual behavior change.
3. Move Dev Console into DockHost.
4. FocusRouter introduced in parallel, then Builder keyboard moved to it.
5. PopoverHost migration for material/object popovers.
6. PopoverHost migration for prefab/sprite/import surfaces.
7. InspectorSchema for lights first.
8. InspectorSchema for one object family, then the rest.
9. Outliner read-only, then commandable.
10. Validation issue codes, then repair actions.
11. PreviewRuntime skeleton, then one preview system at a time.
12. Spatial gizmos one object family at a time.

## Defect Classes This Plan Should Eliminate

- Panel bodies accidentally start drags.
- Empty docks disappear as drop targets.
- Floating panels choose surprising positions.
- Floating panels overlap without z-order control.
- Panel close/maximize controls fight drag handlers.
- Right-docked popovers render offscreen.
- Multiple scroll containers produce inconsistent scrollbars.
- Toolbar/menu/shortcut/command-palette actions drift.
- Console open but unfocused steals Builder help or shortcut behavior.
- Modals leak gameplay or console keys.
- Inspector fields silently clamp or mutate outside undo.
- Validation explains problems but does not help fix them.
- Live preview mutates document or runtime state implicitly.

## Completion Definition

This roadmap is complete when:

- Persistent Builder panels are registered, dockable, searchable, reorderable,
  and commandable through shared framework code.
- Builder, Console, Help, AppDialog, command palette, menus, and text inputs
  use one focus priority model.
- Inspector controls are schema-driven and support mixed values.
- Validation issues can be filtered, framed, overlaid, and repaired.
- Live Preview is a disposable capped runtime with explicit apply/discard.
- Prefab and sprite libraries have detail/composition workflows.
- Browser probes cover the previous docking, popover, console, and focus
  defects plus the new workflows.
- Expert and critic review gates pass after each implementation phase.

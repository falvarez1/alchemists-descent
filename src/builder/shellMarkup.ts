import { HEIGHT, WIDTH } from '@/config/constants';
import type { EditorObjectKind } from '@/builder/document';
import { PASSES } from '@/builder/procedural';
import { builderPanelHeader } from '@/ui/editor/PanelChrome';
import { builderPanelTitle } from '@/ui/editor/PanelRegistry';
import { editorIcon, type EditorIconName } from '@/ui/editor/icons';
import { escapeAttr, escapeHtml } from '@/ui/editor/Fields';

/**
 * The Builder's shell markup: title bar, viewport toolbar, palette tabs, docks,
 * status bar. Kept out of `Builder.ts` so the 13k-line class stops owning 300
 * lines of template, and so the layout can be read (and re-skinned) in one place.
 *
 * ELEMENT IDS ARE CONTRACT. Builder.ts binds handlers by id (`this.el('b-save')`),
 * and ~20 headless probes click them. A control can MOVE (a menu item becomes a
 * toolbar button) but keeps its id.
 */

export interface ToolDef {
  tool: string;
  icon: EditorIconName;
  name: string;
  key?: string;
}

export interface ToolGroupDef {
  id: string;
  tools: readonly ToolDef[];
}

/**
 * Terrain/authoring tools as a designer thinks of them: ~8 groups, not 17
 * buttons. A group's head arms its last-used variant; a second click (or a
 * right-click) opens the variants. Every variant keeps its `data-tool` id.
 */
export const TOOL_GROUPS: readonly ToolGroupDef[] = [
  { id: 'select', tools: [{ tool: 'select', icon: 'select', name: 'Select / move', key: 'V' }] },
  {
    id: 'brush',
    tools: [
      { tool: 'paint', icon: 'paint', name: 'Brush', key: 'B' },
      { tool: 'line', icon: 'line', name: 'Line', key: 'L' },
    ],
  },
  {
    id: 'shape',
    tools: [
      { tool: 'rect', icon: 'rect', name: 'Rectangle outline' },
      { tool: 'rectFill', icon: 'rectFill', name: 'Filled rectangle' },
      { tool: 'ellipse', icon: 'ellipse', name: 'Ellipse outline' },
      { tool: 'ellipseFill', icon: 'ellipseFill', name: 'Filled ellipse' },
    ],
  },
  {
    id: 'fill',
    tools: [
      { tool: 'fill', icon: 'fill', name: 'Flood fill', key: 'G' },
      { tool: 'replace', icon: 'replace', name: 'Replace material' },
    ],
  },
  {
    id: 'smooth',
    tools: [
      { tool: 'smooth', icon: 'smooth', name: 'Smooth' },
      { tool: 'roughen', icon: 'roughen', name: 'Roughen' },
    ],
  },
  {
    id: 'region',
    tools: [
      { tool: 'region', icon: 'region', name: 'Rectangle region', key: 'R' },
      { tool: 'polyRegion', icon: 'polyRegion', name: 'Polygon region' },
      { tool: 'lassoRegion', icon: 'lassoRegion', name: 'Lasso region' },
      { tool: 'regionMagic', icon: 'regionMagic', name: 'Magic region (whole cavern)' },
    ],
  },
  { id: 'link', tools: [{ tool: 'link', icon: 'link', name: 'Link trigger to target', key: 'K' }] },
  { id: 'light', tools: [{ tool: 'light', icon: 'light', name: 'Place light' }] },
];

export interface ObjectCardDef {
  kind: EditorObjectKind;
  label: string;
}

export const LEVEL_OBJECTS: readonly ObjectCardDef[] = [
  { kind: 'spawn', label: 'Spawn' },
  { kind: 'enemy', label: 'Enemy' },
  { kind: 'pickup', label: 'Pickup' },
  { kind: 'exitPortal', label: 'Portal' },
  { kind: 'exitWell', label: 'Exit well' },
  { kind: 'waystone', label: 'Waystone' },
  { kind: 'cauldron', label: 'Cauldron' },
  { kind: 'bossMarker', label: 'Boss' },
];

export const PUZZLE_OBJECTS: readonly ObjectCardDef[] = [
  { kind: 'door', label: 'Door' },
  { kind: 'plate', label: 'Plate' },
  { kind: 'lever', label: 'Lever' },
  { kind: 'brazier', label: 'Brazier' },
  { kind: 'scale', label: 'Scale' },
  { kind: 'buoy', label: 'Buoy' },
  { kind: 'runeGlyph', label: 'Rune' },
  { kind: 'runeDoor', label: 'Rune door' },
];

export const ADVANCED_OBJECTS: readonly ObjectCardDef[] = [
  { kind: 'valve', label: 'Valve' },
  { kind: 'plug', label: 'Plug' },
  { kind: 'sensor', label: 'Sensor' },
  { kind: 'relay', label: 'Relay' },
  { kind: 'counterweight', label: 'Weight' },
  { kind: 'chargeLatch', label: 'Latch' },
  { kind: 'hazardEmitter', label: 'Emitter' },
];

export const NOTE_OBJECTS: readonly ObjectCardDef[] = [{ kind: 'decor', label: 'Note' }];

export interface ShellMarkupOptions {
  /** One `.bp-layer` row per editor layer family (visibility + lock). */
  layerRows: string;
}

const card = (c: ObjectCardDef): string =>
  `<button type="button" class="bp-tool bp-card" data-kind="${c.kind}" aria-label="${escapeAttr(c.label)}"><span class="bp-card-label">${escapeHtml(c.label)}</span></button>`;

const toolButton = (t: ToolDef): string =>
  `<button type="button" class="bp-tool bt-tool" data-tool="${t.tool}" aria-label="${escapeAttr(t.name)}${t.key ? ` (${t.key})` : ''}">${editorIcon(t.icon, 16)}</button>`;

const flyoutItem = (t: ToolDef): string =>
  `<button type="button" class="bp-tool" data-tool="${t.tool}" aria-label="${escapeAttr(t.name)}${t.key ? ` (${t.key})` : ''}">${editorIcon(t.icon, 16)}<span class="bt-name">${escapeHtml(t.name)}</span>${t.key ? `<kbd class="st-kbd">${t.key}</kbd>` : ''}</button>`;

function toolGroup(g: ToolGroupDef): string {
  if (g.tools.length === 1) return toolButton(g.tools[0]);
  const first = g.tools[0];
  return (
    `<span class="bt-group bt-variants" data-group="${g.id}">` +
    `<button type="button" class="bt-head has-flyout" data-group-head="${g.id}" data-last="${first.tool}" aria-haspopup="menu" aria-expanded="false">${editorIcon(first.icon, 16)}</button>` +
    `<div class="bt-flyout" role="menu" hidden>${g.tools.map(flyoutItem).join('')}</div>` +
    '</span>'
  );
}

const menuItem = (id: string, label: string, opts: { key?: string; title?: string } = {}): string =>
  `<button id="${id}"${opts.title ? ` title="${escapeAttr(opts.title)}"` : ''}>${escapeHtml(label)}${opts.key ? `<span class="builder-menu-key">${escapeHtml(opts.key)}</span>` : ''}</button>`;

const sep = '<div class="builder-menu-sep"></div>';

export function buildShellMarkup(options: ShellMarkupOptions): string {
  const { layerRows } = options;
  return `
      <div id="builder-workspace">
      <div id="builder-bar" class="st-bar">
        <span class="b-title">${editorIcon('layers', 16)}<span>Builder</span></span>
        <nav class="builder-menubar" role="menubar" aria-label="Builder menu">
          <button type="button" class="builder-menu-btn" data-menu="document" aria-haspopup="true" aria-expanded="false">File</button>
          <button type="button" class="builder-menu-btn" data-menu="edit" aria-haspopup="true" aria-expanded="false">Edit</button>
          <button type="button" class="builder-menu-btn" data-menu="view" aria-haspopup="true" aria-expanded="false">View</button>
          <button type="button" class="builder-menu-btn" data-menu="level" aria-haspopup="true" aria-expanded="false">Level</button>
          <button type="button" class="builder-menu-btn" data-menu="help" aria-haspopup="true" aria-expanded="false">Help</button>
        </nav>
        <span class="st-sep"></span>
        <div class="st-bar-group b-doc">
          <input id="b-doc-name" value="untitled" spellcheck="false" aria-label="Document name">
          <select id="b-doc-select" aria-label="Saved documents"></select>
          <label class="b-field"><span class="st-label">Biome</span><select id="b-biome" aria-label="Document biome"></select></label>
        </div>
        <span class="b-bar-mid"></span>
        <div class="st-bar-group b-transport" role="group" aria-label="Playtest">
          <button id="b-playtest" type="button" class="st-btn st-btn--play" aria-label="Play the level from its spawn">${editorIcon('play', 14)}<span>Play</span></button>
          <button id="b-playtest-here" type="button" class="st-btn st-btn--icon" aria-label="Play from the cursor (T)">${editorIcon('playHere', 14)}</button>
          <button id="b-validate-chip" type="button" class="st-btn b-validate" data-state="idle" aria-label="Validate the level">${editorIcon('check', 14)}<span class="b-validate-text">Validate</span><span class="b-validate-n"></span></button>
          <button id="b-bake" type="button" class="st-btn" style="display:none" aria-label="Keep the playtest's changes in the document terrain">Keep changes</button>
        </div>
        <span class="b-bar-mid"></span>
        <div class="st-bar-group b-right">
          <span id="b-gamelink-slot" class="b-gamelink-slot"></span>
          <button id="b-reset-workspace" type="button" class="st-btn st-btn--ghost st-btn--icon" aria-label="Reset the panel layout">${editorIcon('layout', 14)}</button>
          <button id="b-exit" type="button" class="st-btn" aria-label="Back to the Sandbox">${editorIcon('sandbox', 14)}<span>Sandbox</span></button>
        </div>
        <div class="builder-menu-dropdown" data-menu-panel="document" role="menu" aria-label="File" hidden>
          ${menuItem('b-new', 'New level')}
          ${menuItem('b-load', 'Open saved…')}
          ${menuItem('b-save', 'Save', { key: 'Ctrl+S' })}
          ${sep}
          ${menuItem('b-export', 'Export JSON')}
          <label for="b-import" class="b-filebtn" role="menuitem">Import JSON…</label>
          <input type="file" id="b-import" accept=".json" hidden>
          ${sep}
          ${menuItem('b-share', 'Copy share code', { title: 'Compress the level into a pasteable share code' })}
          ${menuItem('b-code', 'Import share code…', { title: 'Import a level from a share code' })}
        </div>
        <div class="builder-menu-dropdown" data-menu-panel="edit" role="menu" aria-label="Edit" hidden>
          ${menuItem('b-undo', 'Undo', { key: 'Ctrl+Z' })}
          ${menuItem('b-redo', 'Redo', { key: 'Ctrl+Y' })}
          ${sep}
          ${menuItem('b-validate', 'Validate level')}
        </div>
        <div class="builder-menu-dropdown" data-menu-panel="view" role="menu" aria-label="View" hidden>
          ${menuItem('b-inspector', 'Inspector')}
          ${menuItem('bp-outliner-btn', 'Outliner', { title: 'Find, select, hide, and lock authored records' })}
          ${menuItem('bp-link-graph-btn', 'Link graph', { title: 'Inspect trigger, relay, rune, and actuator links' })}
          ${menuItem('b-assets', 'Asset browser', { title: 'Documents, prefabs, sprites, imports and dependencies' })}
          ${sep}
          ${menuItem('b-validation-layout', 'Review layout', { title: 'Dock Validation Issues, Outliner and Link Graph for a review pass' })}
          ${menuItem('b-zen', 'Hide panels', { title: 'Hide all side panels for a clear view of the canvas' })}
        </div>
        <div class="builder-menu-dropdown" data-menu-panel="level" role="menu" aria-label="Level" hidden>
          <button id="bp-world-btn" title="Generate a base level: biome, seed, caves, look">Generate terrain…</button>
          <button id="bp-proc-btn" title="Seeded procedural passes: veins, pockets, vegetation, population">Procedural passes…</button>
          <button id="b-backdrop" title="Preview and tune the parallax backdrop">Backdrop…</button>
          <button id="bp-mat-btn" title="Tuning sliders for the armed material">Material tuning…</button>
          ${sep}
          <button id="b-capture" title="Snapshot the live cells into the document">Capture terrain</button>
          <button id="b-restore" title="Re-decode the document's captured terrain into the live world (clears undo)">Restore saved terrain</button>
        </div>
        <div class="builder-menu-dropdown" data-menu-panel="help" role="menu" aria-label="Help" hidden>
          ${menuItem('b-menu-palette', 'Command palette', { key: 'Ctrl+K' })}
          ${menuItem('b-menu-help', 'Builder help', { key: 'H' })}
          ${sep}
          ${menuItem('b-gallery', 'Reference gallery', { title: 'Browse and preview every prefab, mechanism, entity and sprite — live and animated' })}
        </div>
      </div>
      <div id="builder-workspace-body">
      <div id="builder-dock-left" class="builder-dock" data-dock="left">
      <div id="builder-palette" class="bp-tabbed">
        <div class="builder-panel-title" data-panel-handle>Palette</div>
        <div class="bp-tabs" role="tablist" aria-label="Palette">
          <button type="button" class="bp-tab" role="tab" id="bp-tab-materials" data-pane="materials" aria-selected="true" aria-controls="bp-pane-materials">Terrain</button>
          <button type="button" class="bp-tab" role="tab" id="bp-tab-objects" data-pane="objects" aria-selected="false" aria-controls="bp-pane-objects" tabindex="-1">Objects</button>
          <button type="button" class="bp-tab" role="tab" id="bp-tab-library" data-pane="library" aria-selected="false" aria-controls="bp-pane-library" tabindex="-1">Library</button>
        </div>
        <div class="bp-panes">
          <div class="bp-pane" role="tabpanel" id="bp-pane-materials" aria-labelledby="bp-tab-materials" data-pane="materials">
            <div class="bp-armed" id="bp-armed"><span class="bp-armed-dot"></span><div><b id="bp-armed-name">Sand</b><span>Armed material</span></div></div>
            <div><div class="bp-group-title"><span class="st-label">Materials</span><span class="bp-count" id="bp-mat-count"></span></div><input type="search" id="bp-mat-search" class="st-input bp-search" placeholder="Filter materials" aria-label="Filter materials" spellcheck="false"><div id="bp-materials" class="bp-grid bp-grid6"></div><p id="bp-mat-empty" class="bp-hint" hidden>No material matches that.</p></div>
          </div>
          <div class="bp-pane" role="tabpanel" id="bp-pane-objects" aria-labelledby="bp-tab-objects" data-pane="objects" hidden>
            <input type="search" id="bp-obj-search" class="st-input bp-search" placeholder="Filter objects" aria-label="Filter objects" spellcheck="false">
            <div class="bp-obj-group" data-group="level"><div class="bp-group-title"><span class="st-label">Level</span></div><div class="bp-cards">${LEVEL_OBJECTS.map(card).join('')}</div></div>
            <div class="bp-obj-group" data-group="puzzles"><div class="bp-group-title"><span class="st-label">Puzzles</span></div><div class="bp-cards">${PUZZLE_OBJECTS.map(card).join('')}<button type="button" class="bp-tool bp-card" data-tool="link" aria-label="Link trigger to target (K)"><span class="bp-card-icon">${editorIcon('link', 22)}</span><span class="bp-card-label">Link</span></button></div></div>
            <details class="bp-adv bp-obj-group" data-group="advanced"><summary>${editorIcon('chevronRight', 12)}<span class="st-label">Advanced machines</span></summary><div class="bp-cards">${ADVANCED_OBJECTS.map(card).join('')}</div></details>
            <div class="bp-obj-group" data-group="notes"><div class="bp-group-title"><span class="st-label">Annotate</span></div><div class="bp-cards">${NOTE_OBJECTS.map(card).join('')}<button type="button" class="bp-tool bp-card" data-tool="light" aria-label="Place an authored light"><span class="bp-card-icon">${editorIcon('light', 22)}</span><span class="bp-card-label">Light</span></button></div></div>
            <div class="bp-toggles">
              <button id="bp-light-toggle" type="button" class="st-btn" aria-pressed="true" title="Feed authored lights into the live light field while editing">Preview lights: on</button>
              <button id="bp-wand-light-toggle" type="button" class="st-btn" aria-pressed="false" title="Use the mouse cursor as the live player wand light">Cursor wand light: off</button>
            </div>
          </div>
          <div class="bp-pane" role="tabpanel" id="bp-pane-library" aria-labelledby="bp-tab-library" data-pane="library" hidden>
            <div><div class="bp-group-title"><span class="st-label">Prefabs</span></div><div id="bp-prefab-host"></div></div>
            <div><div class="bp-group-title"><span class="st-label">Sprites</span></div><div id="bp-sprite-host"></div></div>
            <button id="bp-assets-btn" type="button" class="st-btn" title="Open the Project Asset Browser">${editorIcon('folder', 14)}<span>Browse all assets…</span></button>
          </div>
        </div>
      </div>
      </div>
      <div id="builder-stage" data-dock="floating">
      <div id="builder-toolbar" class="st-toolbar" role="toolbar" aria-label="Level tools">
        <div class="bt-group bt-tools">${TOOL_GROUPS.map(toolGroup).join('')}</div>
        <span class="bt-sep"></span>
        <div class="bt-brush"><span class="st-label">Brush</span><input type="range" id="bp-brush" min="1" max="24" value="6" aria-label="Brush radius"><b id="bp-brush-val">6</b></div>
        <button id="bt-material" type="button" class="bt-material" aria-label="Armed material: open the material list"><span class="bt-material-dot"></span><span id="bt-material-name">Sand</span></button>
        <span class="bt-spacer"></span>
        <button id="bp-snap-btn" type="button" class="bt-toggle" data-on="false" title="Snap placements and drags to a grid">${editorIcon('magnet', 14)}<span class="bt-label">Snap</span></button>
        <button id="bp-sym-btn" type="button" class="bt-toggle" data-on="false" title="Mirror terrain painting across the axis (world center; a region recenters it)">${editorIcon('symmetry', 14)}<span class="bt-label">Mirror</span></button>
        <button id="bp-overlay-btn" type="button" class="bt-toggle" data-on="false" title="Readability overlays (O)">${editorIcon('eye', 14)}<span class="bt-label">Overlay</span></button>
        <button id="bt-minimap-btn" type="button" class="bt-toggle" data-on="true" aria-pressed="true" title="Show or hide the minimap">${editorIcon('map', 14)}<span class="bt-label">Map</span></button>
        <span class="bt-group bt-layers"><button id="bt-layers-btn" type="button" class="bt-toggle" aria-haspopup="true" aria-expanded="false" title="Show, hide and lock layers in the editor">${editorIcon('layers', 14)}<span class="bt-label">Layers</span></button><div id="bp-layers" class="bt-flyout bt-layers-pop" hidden>${layerRows}</div></span>
        <span class="bt-sep"></span>
        <span class="bt-group bt-simulate" role="group" aria-label="Settle">
          <button id="bp-settle" type="button" class="bt-toggle" aria-label="Hold to run physics; release to keep or revert" title="Hold to run physics on the terrain; release to keep or revert">${editorIcon('simulate', 14)}<span class="bt-label">Settle</span></button>
          <button id="bp-settle-keep" type="button" class="bt-toggle" style="display:none">Keep</button>
          <button id="bp-settle-revert" type="button" class="bt-toggle" style="display:none">Revert</button>
        </span>
        <span class="bt-sep"></span>
        <span class="bt-group bt-zoom" role="group" aria-label="Zoom">
          <button id="bt-zoom-out" type="button" class="bt-tool" aria-label="Zoom out">${editorIcon('minus', 14)}</button>
          <span id="bt-zoom-val" class="bt-zoom-val">100%</span>
          <button id="bt-zoom-in" type="button" class="bt-tool" aria-label="Zoom in">${editorIcon('plus', 14)}</button>
          <button id="bt-zoom-fit" type="button" class="bt-tool" aria-label="Fit the level">${editorIcon('target', 14)}</button>
        </span>
      </div>
      <div id="builder-contextbar" class="st-contextbar" role="toolbar" aria-label="Actions for the region" hidden></div>
      <div id="builder-center-slot"></div>
      <div id="builder-overlay"><canvas id="builder-canvas"></canvas><div id="builder-markers"></div></div>
      <div id="bp-matpop" style="display:none"></div>
      <canvas id="builder-minimap" width="${WIDTH >> 3}" height="${Math.ceil(HEIGHT / 8)}"
        title="Click to jump the camera"></canvas>
      <div id="builder-cmdk" role="dialog" aria-modal="true" aria-labelledby="bp-cmdk-label" style="display:none">
        <label id="bp-cmdk-label" class="sr-only" for="bp-cmdk-input">Command palette</label>
        <input id="bp-cmdk-input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bp-cmdk-list" placeholder="Type a command… (Esc closes)" spellcheck="false">
        <div id="bp-cmdk-list" role="listbox"></div>
      </div>
      <div id="builder-import-host" style="display:none"></div>
      <div id="builder-status-alert" class="sr-only" role="alert" aria-live="assertive"></div>
      <div id="builder-help" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="builder-help-title" style="display:none">
        <div class="builder-help-card">
          <div class="builder-help-titlebar">
            <div>
              <div class="builder-help-kicker">Builder help</div>
              <div id="builder-help-title" class="builder-help-title">Authoring controls</div>
            </div>
            <button id="builder-help-close" type="button" aria-label="Close Builder help">&times;</button>
          </div>
          <div class="builder-help-grid">
            <div>
              <div class="builder-help-section">Tools</div>
              <p><b>V</b> select · <b>B</b> brush · <b>L</b> line · <b>G</b> fill.</p>
              <p><b>R</b> region · <b>K</b> link triggers.</p>
              <p>Click an armed tool again, right-click it, or hold it to pick a variant.</p>
              <p><b>Ctrl+K</b> opens the command palette.</p>
            </div>
            <div>
              <div class="builder-help-section">Canvas</div>
              <p><b>RMB</b> eyedrops the material under the cursor.</p>
              <p><b>Mouse wheel</b> zooms the map.</p>
              <p><b>Drag empty canvas</b> draws a selection box; <b>Shift-click</b> adds to it.</p>
              <p><b>Alt</b> bypasses snapping while you drag.</p>
            </div>
            <div>
              <div class="builder-help-section">Editing</div>
              <p><b>Ctrl+Z / Ctrl+Y</b> undo and redo.</p>
              <p><b>Ctrl+D</b> duplicates the selection.</p>
              <p><b>Ctrl+C / Ctrl+V</b> copies and pastes parameters.</p>
              <p><b>Delete</b> removes the selection; <b>Esc</b> steps back.</p>
            </div>
            <div>
              <div class="builder-help-section">Testing</div>
              <p><b>T</b> plays from the cursor.</p>
              <p><b>Q</b> rotates and <b>E</b> flips an armed prefab.</p>
              <p><b>X</b> floats a region; <b>Enter</b> lands it.</p>
              <p><b>Settle</b> runs real physics on the terrain, then keep or revert.</p>
            </div>
          </div>
          <div class="builder-help-close-hint">Press H or Esc to close.</div>
        </div>
      </div>
      </div>
      <div id="builder-dock-right" class="builder-dock" data-dock="right">
      <div id="builder-inspector"></div>
      <div id="builder-outliner" style="display:none"></div>
      <div id="builder-asset-details" style="display:none"></div>
      <div id="builder-prefab-details" style="display:none"></div>
      <div id="builder-world" style="display:none">
        ${builderPanelHeader({ title: builderPanelTitle('builder-world'), closeId: 'bw-close', closeLabel: 'Close world generation' })}
        <div id="bw-controls"></div>
      </div>
      <div id="builder-matparams" style="display:none">
        ${builderPanelHeader({ title: builderPanelTitle('builder-matparams'), closeId: 'bm-close', closeLabel: 'Close material parameters' })}
        <div id="bm-controls"></div>
      </div>
      <div id="builder-proc" style="display:none">
        ${builderPanelHeader({ title: builderPanelTitle('builder-proc'), closeId: 'bp-proc-close', closeLabel: 'Close procedural pass' })}
        <div id="bp-controls" class="bi-panel-body">
          <div class="bi-row"><span>pass</span><select id="bp-pass">${PASSES.map(
            (p) => `<option value="${p.id}">${p.label}</option>`,
          ).join('')}</select></div>
          <div class="bi-row"><span>seed</span><input id="bp-seed" type="number" value="1337" min="0" step="1"><button id="bp-dice" class="b-icon" title="Re-roll seed" aria-label="Re-roll seed">${editorIcon('restart', 14)}</button></div>
          <div class="bi-row"><span>density</span><input id="bp-density" type="range" min="5" max="100" value="50" aria-label="Procedural density"><b id="bp-density-val">50</b></div>
          <div class="bi-row"><span>target</span><b id="bp-target">whole level</b></div>
          <div class="bi-row"><span>material</span><b id="bp-material">&mdash;</b></div>
          <div class="bp-actions">
            <button id="bp-preview">PREVIEW</button>
            <button id="bp-apply" class="b-primary">APPLY</button>
            <button id="bp-discard">DISCARD</button>
          </div>
          <div class="bp-hint" id="bp-status">Cell passes preview before<br>committing; population passes<br>apply directly (undoable).</div>
        </div>
      </div>
      <div id="builder-issues" style="display:none"></div>
      </div>
      <div id="builder-dock-guides" aria-hidden="true">
        <div id="builder-dock-guide-left" class="builder-dock-guide bdg-left" data-dock="left"><span>LEFT</span></div>
        <div id="builder-dock-guide-right" class="builder-dock-guide bdg-right" data-dock="right"><span>RIGHT</span></div>
        <div id="builder-dock-guide-bottom" class="builder-dock-guide bdg-bottom" data-dock="bottom"><span>BOTTOM</span></div>
      </div>
      <div id="builder-dock-bottom" class="builder-dock" data-dock="bottom"></div>
      </div>
      <div id="builder-statusbar" class="st-status" role="contentinfo">
        <div class="sb-left">
          <span id="builder-status" role="status" aria-live="polite"></span>
          <span id="b-tool-hint" class="sb-hint">Select and move things. Drag empty space to box-select.</span>
        </div>
        <div class="sb-right">
          <span class="sb-item" id="bp-mat-row" title="Armed material, brush radius and zoom"></span>
          <span class="sb-item" id="b-cursor" aria-label="Cursor position">—</span>
          <button id="b-issues-chip" type="button" class="sb-item sb-issues" aria-label="Open the validation issues">${editorIcon('check', 12)}<span class="sb-issues-text">No issues checked</span></button>
        </div>
      </div>
      <div id="builder-link-graph" style="display:none"></div>
      <div id="builder-assets" style="display:none"></div>
      </div>`;
}

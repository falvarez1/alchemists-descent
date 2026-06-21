import type {
  RuntimeEntityGroup,
  RuntimeEntityRow,
  RuntimeEntitySnapshot,
} from '@/game/runtimeSnapshot';
import { DEFAULT_RUNTIME_OVERLAYS, RUNTIME_OVERLAY_OPTIONS } from '@/ui/diagnostics/runtimeOverlay';
import type { RuntimeOverlayState } from '@/ui/diagnostics/runtimeOverlay';
import { filterRuntimeRows } from '@/game/runtimeSnapshot';
import {
  escapeAttr as escAttr,
  escapeHtml as esc,
  runtimePanelHeader,
  runtimeSectionHtml,
} from '@/ui/diagnostics/runtimeChrome';

export interface RuntimePanelModel {
  snapshot: RuntimeEntitySnapshot;
  query: string;
  filters: ReadonlySet<RuntimeEntityGroup>;
  overlays?: RuntimeOverlayState;
  showOverlayControls?: boolean;
  showFocusActions?: boolean;
  showCameraControls?: boolean;
  cameraFollowEnabled?: boolean;
  /** Debug freeze/drag tool: whether it's active, and which row ids are kept live. */
  debugActive?: boolean;
  liveIds?: ReadonlySet<string>;
  collapsedSections?: Readonly<Record<string, boolean>>;
}

const GROUPS: RuntimeEntityGroup[] = [
  'player',
  'enemies',
  'projectiles',
  'critters',
  'pickups',
  'mechanisms',
  'portal',
  'particles',
];

export function renderRuntimePanel(model: RuntimePanelModel): string {
  const snapshot = model.snapshot;
  const overlays = model.overlays ?? DEFAULT_RUNTIME_OVERLAYS;
  const showOverlayControls = model.showOverlayControls ?? true;
  const showFocusActions = model.showFocusActions ?? true;
  const showCameraControls = model.showCameraControls ?? false;
  const rows = filterRuntimeRows(snapshot.rows, model.query, model.filters);
  const header = runtimePanelHeader({
    title: 'Runtime',
    closeId: 'brt-close',
    closeLabel: 'Close runtime panel',
  });
  const chips = GROUPS.map((group) => {
    const count = snapshot.counts.find((entry) => entry.group === group);
    const active = model.filters.has(group);
    return `<button type="button" class="bo-chip${active ? ' active' : ''}" data-runtime-filter="${group}" aria-pressed="${active ? 'true' : 'false'}">${esc(count?.label ?? group)} <b>${count?.total ?? 0}</b></button>`;
  }).join('');
  const countCards = snapshot.counts.map((count) => `<div class="brt-count">
    <span>${esc(count.label)}</span>
    <b>${count.total}</b>
    <em>${count.visible} visible${count.sampled < count.total ? ` · ${count.sampled} rows` : ''}</em>
  </div>`).join('');
  const emptyRows = runtimeEmptyRows(snapshot);
  const sourceNote = runtimeSourceNote(snapshot);
  const debugActive = model.debugActive === true;
  const liveIds = model.liveIds;
  const rowHtml = rows.length > 0
    ? rows.map((row) => renderRuntimeRow(row, snapshot.selectedId === row.id, showFocusActions, debugActive, liveIds?.has(row.id) === true)).join('')
    : `<div class="bo-empty b-empty">${esc(emptyRows)}</div>`;
  const selected = snapshot.selectedRow;
  return `
    ${header}
    <div class="brt-source">
      <div>
        <b>${esc(snapshot.source.label)}</b>
        <span>${esc(snapshot.source.detail)}</span>
      </div>
      <em>frame ${snapshot.frame}${snapshot.level ? ` · ${esc(snapshot.level.name)} d${snapshot.level.depth}` : ''}</em>
    </div>
    ${sourceNote ? `<div class="bo-empty b-empty brt-source-note">${esc(sourceNote)}</div>` : ''}
    ${showCameraControls ? renderRuntimeCameraControls(model, model.cameraFollowEnabled === true) : ''}
    ${showCameraControls ? renderRuntimeDebugControls(model, debugActive) : ''}
    <div class="brt-counts">${countCards}</div>
    ${section(model, 'runtime.particles', 'Particle Aggregate', `
      ${renderParticleAggregate(snapshot)}
    `, 'brt-particles')}
    ${showOverlayControls ? section(model, 'runtime.overlays', 'Viewport Overlays', `
      ${renderRuntimeOverlayControls(overlays)}
    `, 'brt-overlays') : ''}
    <div class="bo-search"><input id="brt-search" type="search" class="editor-search" spellcheck="false" placeholder="search runtime rows" value="${escAttr(model.query)}"></div>
    <div class="bo-chips">${chips}</div>
    ${section(model, 'runtime.rows', `Runtime Rows${snapshot.capped ? ' · sampled' : ''}`, `
      <div class="bo-rows brt-rows" role="listbox">${rowHtml}</div>
    `)}
    ${section(model, 'runtime.selection', 'Selection', `
      ${selected ? renderRuntimeDetail(selected, showFocusActions) : snapshot.selectedMissing ? '<div class="bo-empty b-empty">Selected runtime row was removed</div>' : '<div class="bo-empty b-empty">Select a runtime row</div>'}
    `, 'brt-detail')}`;
}

function renderRuntimeCameraControls(model: RuntimePanelModel, cameraFollowEnabled: boolean): string {
  return section(
    model,
    'runtime.camera',
    'Camera',
    `
    <label class="brt-toggle">
      <input id="brt-follow-selected" type="checkbox"${cameraFollowEnabled ? ' checked' : ''}>
      <span>Follow Entity</span>
    </label>`,
    'brt-camera',
  );
}

function renderRuntimeDebugControls(model: RuntimePanelModel, active: boolean): string {
  const hint = active
    ? 'Frozen. Drag entities on the canvas. Tick player, visible enemy, or critter rows to keep them simulating.'
    : 'Freeze every entity; drag any of them around the map with the mouse to test placement.';
  return section(
    model,
    'runtime.debug',
    'Debug',
    `
    <label class="brt-toggle">
      <input id="brt-debug" type="checkbox"${active ? ' checked' : ''}>
      <span>Debug Freeze + Drag</span>
    </label>
    <div class="bo-row-sub brt-debug-hint">${hint}</div>`,
    'brt-debug',
  );
}

function section(model: Pick<RuntimePanelModel, 'collapsedSections'>, id: string, title: string, body: string, extraClass = ''): string {
  return runtimeSectionHtml({
    id,
    title,
    body,
    className: ['bo-section', extraClass].filter(Boolean).join(' '),
    titleClassName: 'bo-section-title',
    bodyClassName: 'bo-section-body',
    collapsed: model.collapsedSections?.[id] === true,
  });
}

function runtimeEmptyRows(snapshot: RuntimeEntitySnapshot): string {
  if (snapshot.source.id === 'build') return 'Switch to LOGIC PREVIEW to inspect authored preview rows';
  if (snapshot.source.id === 'builder-live-preview') return 'No authored preview runtime rows';
  return 'No runtime rows';
}

function runtimeSourceNote(snapshot: RuntimeEntitySnapshot): string {
  if (snapshot.source.id !== 'builder-live-preview') return '';
  if (snapshot.rows.length > 0) return 'Logic Preview is showing authored preview rows only; full player and material simulation appears during Builder Playtest.';
  return 'Logic Preview is running, but this document has no authored preview entities. Full player and material simulation appears during Builder Playtest.';
}

function renderRuntimeOverlayControls(overlays: RuntimeOverlayState): string {
  return `<div class="brt-overlay-grid">${RUNTIME_OVERLAY_OPTIONS.map((option) => {
    const active = overlays[option.id];
    return `<button type="button" class="bo-chip${active ? ' active' : ''}" data-runtime-overlay="${option.id}" aria-pressed="${active ? 'true' : 'false'}" title="${escAttr(option.title)}">${esc(option.label)}</button>`;
  }).join('')}</div>`;
}

function renderParticleAggregate(snapshot: RuntimeEntitySnapshot): string {
  const p = snapshot.particles;
  const mats = p.byMaterial.length > 0
    ? `<div class="brt-materials">${p.byMaterial.map((entry) => `<span>${esc(entry.label)} <b>${entry.count}</b></span>`).join('')}</div>`
    : '<div class="bo-empty b-empty">No depositing particles</div>';
  return `<div class="brt-particle-grid">
    <span>total <b>${p.total}</b></span>
    <span>visible <b>${p.visible}</b></span>
    <span>visual <b>${p.visual}</b></span>
    <span>depositing <b>${p.depositing}</b></span>
    <span>homing <b>${p.homing}</b></span>
    <span>hostile <b>${p.hostile}</b></span>
    <span>glowing <b>${p.glowing}</b></span>
  </div>${mats}`;
}

function renderRuntimeRow(row: RuntimeEntityRow, selected: boolean, showFocusActions: boolean, debugActive = false, live = false): string {
  const badges = row.badges.map((badge) => `<span class="bo-badge">${esc(badge)}</span>`).join('');
  const canLive = canDebugLive(row);
  const liveToggle = debugActive && canLive
    ? `<label class="brt-live-wrap" title="Keep this entity simulating while frozen">
      <input type="checkbox" class="brt-live" data-runtime-live="${escAttr(row.id)}"${live ? ' checked' : ''}>
      <span>live</span>
    </label>`
    : '';
  const focus = showFocusActions
    ? `<button type="button" data-runtime-focus="${escAttr(row.id)}">Focus</button>`
    : '';
  const actions = liveToggle || focus ? `<div class="bo-row-actions">${liveToggle}${focus}</div>` : '';
  return `<div class="bo-row brt-row ${selected ? ' selected' : ''}${row.visible ? '' : ' hidden-row'}${debugActive && live && canLive ? ' brt-live-row' : ''}" role="option" tabindex="0" aria-selected="${selected ? 'true' : 'false'}" data-runtime-id="${escAttr(row.id)}">
    <div class="bo-row-main">
      <div class="bo-row-title">${esc(row.label)}</div>
      <div class="bo-row-sub">${esc(row.sublabel)}</div>
      <div class="bo-badges">${badges}</div>
    </div>
    ${actions}
  </div>`;
}

function canDebugLive(row: RuntimeEntityRow): boolean {
  if (row.group === 'player' || row.group === 'critters') return true;
  // Hidden enemy rows may already be outside the active sim bounds, where enemy
  // update culls them before the debug-live gate.
  return row.group === 'enemies' && row.visible;
}

function renderRuntimeDetail(row: RuntimeEntityRow, showFocusActions: boolean): string {
  const fields = row.fields.map((field) => `<div class="brt-field"><span>${esc(field.label)}</span><b>${esc(field.value)}</b></div>`).join('');
  const focus = showFocusActions
    ? `<button type="button" data-runtime-focus="${escAttr(row.id)}">Focus</button>`
    : '';
  return `<div class="brt-detail-card">
    <div class="brt-detail-title">
      <b>${esc(row.label)}</b>
      ${focus}
    </div>
    <div class="bo-row-sub">${esc(row.id)}</div>
    <div class="brt-fields">${fields}</div>
  </div>`;
}


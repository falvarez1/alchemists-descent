import type {
  RuntimeEntityGroup,
  RuntimeEntityRow,
  RuntimeEntitySnapshot,
} from '@/game/runtimeSnapshot';
import { DEFAULT_RUNTIME_OVERLAYS, RUNTIME_OVERLAY_OPTIONS } from '@/builder/runtimeOverlay';
import type { RuntimeOverlayState } from '@/builder/runtimeOverlay';
import { filterRuntimeRows } from '@/game/runtimeSnapshot';
import { builderPanelHeader } from '@/ui/editor/PanelChrome';
import { builderPanelTitle } from '@/ui/editor/PanelRegistry';

export interface RuntimePanelModel {
  snapshot: RuntimeEntitySnapshot;
  query: string;
  filters: ReadonlySet<RuntimeEntityGroup>;
  overlays?: RuntimeOverlayState;
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
  const rows = filterRuntimeRows(snapshot.rows, model.query, model.filters);
  const header = builderPanelHeader({
    title: builderPanelTitle('builder-runtime'),
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
  const emptyRows = snapshot.source.id === 'build'
    ? 'Switch to LIVE PREVIEW to inspect Builder runtime rows'
    : 'No runtime rows';
  const rowHtml = rows.length > 0
    ? rows.map((row) => renderRuntimeRow(row, snapshot.selectedId === row.id)).join('')
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
    <div class="brt-counts">${countCards}</div>
    <section class="bo-section brt-particles">
      <div class="bo-section-title">Particle Aggregate</div>
      ${renderParticleAggregate(snapshot)}
    </section>
    <section class="bo-section brt-overlays">
      <div class="bo-section-title">Viewport Overlays</div>
      ${renderRuntimeOverlayControls(overlays)}
    </section>
    <div class="bo-search"><input id="brt-search" type="search" class="editor-search" spellcheck="false" placeholder="search runtime rows" value="${escAttr(model.query)}"></div>
    <div class="bo-chips">${chips}</div>
    <section class="bo-section">
      <div class="bo-section-title">Runtime Rows${snapshot.capped ? ' · sampled' : ''}</div>
      <div class="bo-rows brt-rows" role="listbox">${rowHtml}</div>
    </section>
    <section class="bo-section brt-detail">
      <div class="bo-section-title">Selection</div>
      ${selected ? renderRuntimeDetail(selected) : snapshot.selectedMissing ? '<div class="bo-empty b-empty">Selected runtime row was removed</div>' : '<div class="bo-empty b-empty">Select a runtime row</div>'}
    </section>`;
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

function renderRuntimeRow(row: RuntimeEntityRow, selected: boolean): string {
  const badges = row.badges.map((badge) => `<span class="bo-badge">${esc(badge)}</span>`).join('');
  return `<div class="bo-row brt-row ${selected ? ' selected' : ''}${row.visible ? '' : ' hidden-row'}" role="option" tabindex="-1" aria-selected="${selected ? 'true' : 'false'}" data-runtime-id="${escAttr(row.id)}">
    <div class="bo-row-main">
      <div class="bo-row-title">${esc(row.label)}</div>
      <div class="bo-row-sub">${esc(row.sublabel)}</div>
      <div class="bo-badges">${badges}</div>
    </div>
    <div class="bo-row-actions">
      <button type="button" data-runtime-focus="${escAttr(row.id)}">Focus</button>
    </div>
  </div>`;
}

function renderRuntimeDetail(row: RuntimeEntityRow): string {
  const fields = row.fields.map((field) => `<div class="brt-field"><span>${esc(field.label)}</span><b>${esc(field.value)}</b></div>`).join('');
  return `<div class="brt-detail-card">
    <div class="brt-detail-title">
      <b>${esc(row.label)}</b>
      <button type="button" data-runtime-focus="${escAttr(row.id)}">Focus</button>
    </div>
    <div class="bo-row-sub">${esc(row.id)}</div>
    <div class="brt-fields">${fields}</div>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escAttr(s: string): string {
  return esc(s);
}

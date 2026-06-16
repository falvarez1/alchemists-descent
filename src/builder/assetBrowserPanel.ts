import { renderAssetPreviewMarkup } from '@/builder/assets/AssetPreview';
import type {
  AssetKind,
  AssetOrigin,
  AssetRecord,
  AssetSmartCollection,
  AssetSortMode,
} from '@/builder/assets/AssetTypes';
import type { AssetDatabaseStats } from '@/builder/assets/AssetDatabase';
import { builderPanelHeader } from '@/ui/editor/PanelChrome';
import { builderPanelTitle } from '@/ui/editor/PanelRegistry';

export type AssetBrowserView = 'grid' | 'list';

export interface AssetPlacementAction {
  id: string;
  label: string;
  title: string;
  elementId?: string;
}

export interface AssetPlacementPanelModel {
  title: string;
  query: string;
  searchPlaceholder: string;
  emptyMessage: string;
  records: readonly AssetRecord[];
  selectedId: string | null;
  armedId: string | null;
  actions: readonly AssetPlacementAction[];
}

export interface AssetBrowserModel {
  query: string;
  view: AssetBrowserView;
  sort: AssetSortMode;
  collection: AssetSmartCollection;
  kindFilters: ReadonlySet<AssetKind>;
  originFilters: ReadonlySet<AssetOrigin>;
  records: readonly AssetRecord[];
  selectedId: string | null;
  selectedIds: ReadonlySet<string>;
  hiddenSelectedCount: number;
  batchDeleteBlockedReason?: string;
  sourceNote?: string;
  stats: AssetDatabaseStats;
  collapsedSections?: Readonly<Record<string, boolean>>;
}

const COLLECTIONS: Array<{ id: AssetSmartCollection; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'recent', label: 'Recent' },
  { id: 'usedByCurrentDocument', label: 'Current Doc' },
  { id: 'missing', label: 'Missing' },
  { id: 'unused', label: 'Unused' },
  { id: 'builtins', label: 'Built-ins' },
  { id: 'imported', label: 'Imports' },
  { id: 'warnings', label: 'Warnings' },
  { id: 'broken', label: 'Broken' },
];

const KIND_FILTERS: Array<{ id: AssetKind; label: string }> = [
  { id: 'document', label: 'Docs' },
  { id: 'prefab', label: 'Prefabs' },
  { id: 'sprite', label: 'Sprites' },
  { id: 'template', label: 'Templates' },
  { id: 'materialProfile', label: 'Materials' },
  { id: 'lightPreset', label: 'Lights' },
  { id: 'backdrop', label: 'Backdrops' },
  { id: 'procPreset', label: 'Proc' },
  { id: 'importReport', label: 'Reports' },
  { id: 'card', label: 'Cards' },
  { id: 'modifier', label: 'Modifiers' },
  { id: 'wandFrame', label: 'Wand Frames' },
  { id: 'wandLoadout', label: 'Loadouts' },
  { id: 'potion', label: 'Potions' },
  { id: 'elixir', label: 'Elixirs' },
  { id: 'recipe', label: 'Recipes' },
  { id: 'material', label: 'Runtime Materials' },
  { id: 'enemy', label: 'Enemies' },
  { id: 'encounterScenario', label: 'Encounters' },
  { id: 'spellLabScenario', label: 'Spell Labs' },
  { id: 'cookReport', label: 'Cook Reports' },
];

const ORIGIN_FILTERS: Array<{ id: AssetOrigin; label: string }> = [
  { id: 'built-in', label: 'Built-in' },
  { id: 'project', label: 'Project' },
  { id: 'library', label: 'Library' },
  { id: 'document-embedded', label: 'Embedded' },
  { id: 'imported', label: 'Imported' },
  { id: 'missing', label: 'Missing' },
  { id: 'broken', label: 'Broken' },
];

export function renderAssetPlacementPanel(model: AssetPlacementPanelModel): string {
  const rows = model.records.length > 0
    ? model.records.map((record) => renderAssetPlacementRow(record, model.selectedId, model.armedId)).join('')
    : `<div class="ba-placement-empty b-empty">${esc(model.emptyMessage)}</div>`;
  return `
    <div class="ba-placement-browser">
      <div class="ba-placement-actions" aria-label="${escAttr(model.title)} actions">
        ${model.actions.map((action) => `<button type="button"${action.elementId ? ` id="${escAttr(action.elementId)}"` : ''} data-asset-placement-action="${escAttr(action.id)}" title="${escAttr(action.title)}">${esc(action.label)}</button>`).join('')}
      </div>
      <div class="ba-placement-toolbar">
        <input type="search" data-asset-placement-search value="${escAttr(model.query)}" placeholder="${escAttr(model.searchPlaceholder)}" spellcheck="false">
        <span>${model.records.length} shown</span>
      </div>
      <div class="ba-placement-list" role="listbox" aria-label="${escAttr(model.title)}">
        ${rows}
      </div>
    </div>`;
}

export function renderAssetBrowserPanel(model: AssetBrowserModel): string {
  const collectionLabel = collectionLabelFor(model.collection);
  const activeFilters = [
    ...[...model.kindFilters].map(kindLabelFor),
    ...[...model.originFilters].map(originLabelFor),
  ];
  const pathSegments = ['Project', collectionLabel, ...activeFilters];
  const selectedCount = model.selectedIds.size;
  const visibleSelected = model.records.filter((record) => model.selectedIds.has(record.assetId)).length;
  const allVisibleSelected = model.records.length > 0 && visibleSelected === model.records.length;
  const deleteTitle = model.batchDeleteBlockedReason ?? 'Delete selected local assets';
  const cards = model.records.length > 0
    ? model.records.map((record) => model.view === 'grid' ? renderAssetCard(record, model.selectedId, model.selectedIds) : renderAssetListRow(record, model.selectedId, model.selectedIds)).join('')
    : '<div class="ba-empty b-empty">No matching assets</div>';
  return `
    <div class="ba-browser">
      ${builderPanelHeader({ title: builderPanelTitle('builder-assets'), closeId: 'ba-close', closeLabel: 'Close asset browser' })}
      <div class="ba-shell">
        <aside class="ba-sources" aria-label="Asset sources and filters">
          <div class="ba-summary">${model.stats.total} assets - ${model.stats.missing} missing - ${model.stats.errors} errors</div>
          <div class="ba-quota" id="ba-quota" role="status"></div>
          ${model.sourceNote ? `<div class="ba-source-note">${esc(model.sourceNote)}</div>` : ''}
          <nav class="ba-tree" role="tree" aria-label="Asset source tree">
            ${treeGroup(model, 'assetBrowser.quickAccess', 'Assets', [
              treeCollection(model, 'all', 'All Assets', model.stats.total),
              treeCollection(model, 'recent', 'Recent'),
              treeCollection(model, 'usedByCurrentDocument', 'Current Document'),
              treeCollection(model, 'unused', 'Unused'),
            ])}
            ${treeGroup(model, 'assetBrowser.types', 'Project', [
              treeKind(model, 'document', 'Documents'),
              treeKind(model, 'prefab', 'Prefabs'),
              treeKind(model, 'sprite', 'Sprites'),
              treeCollection(model, 'imported', 'Imports'),
            ])}
            ${treeGroup(model, 'assetBrowser.library', 'Built-ins', [
              treeCollection(model, 'builtins', 'All Built-ins'),
              treeKind(model, 'materialProfile', 'Materials'),
              treeKind(model, 'lightPreset', 'Lights'),
              treeKind(model, 'template', 'Templates'),
              treeKind(model, 'backdrop', 'Backdrops'),
              treeKind(model, 'procPreset', 'Procedural Presets'),
              treeKind(model, 'importReport', 'Import Reports'),
            ])}
            ${treeGroup(model, 'assetBrowser.content', 'Gameplay Content', [
              treeKind(model, 'card', 'Spell Cards'),
              treeKind(model, 'modifier', 'Modifiers'),
              treeKind(model, 'wandFrame', 'Wand Frames'),
              treeKind(model, 'wandLoadout', 'Wand Loadouts'),
              treeKind(model, 'potion', 'Potions'),
              treeKind(model, 'elixir', 'Elixirs'),
              treeKind(model, 'recipe', 'Recipes'),
              treeKind(model, 'material', 'Runtime Materials'),
              treeKind(model, 'enemy', 'Enemies'),
              treeKind(model, 'encounterScenario', 'Encounters'),
              treeKind(model, 'spellLabScenario', 'Spell Lab'),
              treeKind(model, 'cookReport', 'Cook Reports'),
            ])}
            ${treeGroup(model, 'assetBrowser.origins', 'Sources', ORIGIN_FILTERS
              .map((item) => treeOrigin(model, item.id, item.label)))}
            ${treeGroup(model, 'assetBrowser.health', 'Diagnostics', [
              treeCollection(model, 'missing', 'Missing', model.stats.missing),
              treeCollection(model, 'warnings', 'Warnings'),
              treeCollection(model, 'broken', 'Broken', model.stats.errors),
            ])}
          </nav>
        </aside>
        <section class="ba-content" aria-label="Assets">
          <div class="ba-toolbar">
            <button type="button" id="ba-import" class="ba-tool">Import</button>
            <input id="ba-search" type="search" class="editor-search" spellcheck="false" placeholder="search assets" value="${escAttr(model.query)}">
            <select id="ba-sort" title="Sort assets">
              ${sortOption(model.sort, 'name', 'Name')}
              ${sortOption(model.sort, 'kind', 'Kind')}
              ${sortOption(model.sort, 'modified', 'Modified')}
              ${sortOption(model.sort, 'usage', 'Usage')}
              ${sortOption(model.sort, 'validation', 'Validation')}
              ${sortOption(model.sort, 'size', 'Size')}
            </select>
            <button type="button" id="ba-view" class="ba-icon-btn" title="Toggle grid/list view" aria-label="Toggle grid/list view">${model.view === 'grid' ? '&#9776;' : '&#9638;'}</button>
          </div>
          <div class="ba-batchbar" aria-label="Batch asset operations">
            <label class="ba-select-visible" title="Select all visible assets">
              <input id="ba-select-visible" type="checkbox" ${allVisibleSelected ? 'checked' : ''} ${model.records.length === 0 ? 'disabled' : ''}>
              <span>${visibleSelected}/${model.records.length} visible</span>
            </label>
            <span class="ba-selected-count">${selectedCount === 1 ? '1 selected' : `${selectedCount} selected`}${model.hiddenSelectedCount > 0 ? ` (${model.hiddenSelectedCount} hidden)` : ''}</span>
            <button type="button" id="ba-batch-export" class="ba-tool" ${selectedCount === 0 ? 'disabled' : ''}>Export</button>
            <button type="button" id="ba-batch-delete" class="ba-tool b-danger" title="${escAttr(deleteTitle)}" ${selectedCount === 0 || model.batchDeleteBlockedReason ? 'disabled' : ''}>Delete</button>
            <button type="button" id="ba-batch-clear" class="ba-icon-btn" title="Clear selection" aria-label="Clear selection" ${selectedCount === 0 ? 'disabled' : ''}>&times;</button>
          </div>
          <div class="ba-path-row">
            <div class="ba-path" aria-label="Asset browser path">
              ${pathSegments.map((segment) => `<span>${esc(segment)}</span>`).join('<b>/</b>')}
            </div>
            <div class="ba-count">${model.records.length} shown</div>
          </div>
          <div id="ba-list" class="ba-list ${model.view}" role="listbox" aria-multiselectable="true" aria-label="Asset results">
            ${cards}
          </div>
        </section>
      </div>
    </div>`;
}

function renderAssetCard(record: AssetRecord, selectedId: string | null, selectedIds: ReadonlySet<string>): string {
  return `<div class="ba-card${record.assetId === selectedId ? ' selected' : ''}${selectedIds.has(record.assetId) ? ' multi-selected' : ''}${record.validation.state !== 'valid' ? ` ${record.validation.state}` : ''}"
    data-asset-id="${escAttr(record.assetId)}" draggable="${isPlaceable(record) ? 'true' : 'false'}" role="option" aria-selected="${selectedIds.has(record.assetId) ? 'true' : 'false'}" tabindex="0">
    ${assetSelectBox(record, selectedIds)}
    ${renderAssetPreviewMarkup(record)}
    <div class="ba-card-body">
      <div class="ba-name">${esc(record.name)}</div>
      <div class="ba-meta">${esc(record.kind)} - ${esc(record.origin)} - ${record.usages.length} use(s)</div>
      <div class="ba-tags">${record.tags.slice(0, 4).map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>
    </div>
  </div>`;
}

function renderAssetListRow(record: AssetRecord, selectedId: string | null, selectedIds: ReadonlySet<string>): string {
  return `<div class="ba-row${record.assetId === selectedId ? ' selected' : ''}${selectedIds.has(record.assetId) ? ' multi-selected' : ''}${record.validation.state !== 'valid' ? ` ${record.validation.state}` : ''}"
    data-asset-id="${escAttr(record.assetId)}" draggable="${isPlaceable(record) ? 'true' : 'false'}" role="option" aria-selected="${selectedIds.has(record.assetId) ? 'true' : 'false'}" tabindex="0">
    ${assetSelectBox(record, selectedIds)}
    ${renderAssetPreviewMarkup(record)}
    <div class="ba-row-main">
      <div class="ba-name">${esc(record.name)}</div>
      <div class="ba-meta">${esc(record.assetId)} - ${record.folder} - ${record.usages.length} use(s)</div>
    </div>
    <span class="ba-pill">${esc(record.kind)}</span>
    <span class="ba-pill">${esc(record.origin)}</span>
  </div>`;
}

function assetSelectBox(record: AssetRecord, selectedIds: ReadonlySet<string>): string {
  return `<label class="ba-select-box" title="Select ${escAttr(record.name)}">
    <input type="checkbox" data-asset-select="${escAttr(record.assetId)}" aria-label="Select ${escAttr(record.name)}" ${selectedIds.has(record.assetId) ? 'checked' : ''}>
  </label>`;
}

function isPlaceable(record: AssetRecord): boolean {
  return (
    record.kind === 'prefab' ||
    record.kind === 'sprite' ||
    record.kind === 'materialProfile' ||
    record.kind === 'lightPreset' ||
    record.kind === 'procPreset'
  ) && record.payload !== null;
}

function sortOption(current: string, value: string, label: string): string {
  return `<option value="${escAttr(value)}" ${current === value ? 'selected' : ''}>${esc(label)}</option>`;
}

function treeGroup(model: AssetBrowserModel, id: string, label: string, rows: readonly string[]): string {
  const collapsed = model.collapsedSections?.[id] === true;
  const bodyId = `ba-tree-body-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  return `<section class="ba-tree-group bp-section${collapsed ? ' collapsed' : ''}" data-section="${escAttr(id)}">
    <div class="ba-tree-row ba-tree-folder bp-head bp-section-head" data-section-toggle="${escAttr(id)}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-controls="${escAttr(bodyId)}" role="treeitem" aria-level="1" tabindex="0">
      <span class="bp-chevron" aria-hidden="true"></span><span class="ba-tree-icon folder" aria-hidden="true"></span><span class="ba-tree-label">${esc(label)}</span>
    </div>
    <div id="${escAttr(bodyId)}" class="bp-section-body ba-tree-children" role="group">${rows.join('')}</div>
  </section>`;
}

function treeCollection(model: AssetBrowserModel, id: AssetSmartCollection, label: string, count?: number): string {
  return treeRow({
    dataName: 'asset-collection',
    id,
    label,
    count,
    active: model.collection === id,
    icon: id === 'missing' || id === 'broken' || id === 'warnings' ? 'warning' : 'folder',
  });
}

function treeKind(model: AssetBrowserModel, id: AssetKind, label: string): string {
  return treeRow({
    dataName: 'asset-kind-filter',
    id,
    label,
    active: model.kindFilters.has(id),
    icon: id === 'prefab' || id === 'document' ? 'file' : 'asset',
  });
}

function treeOrigin(model: AssetBrowserModel, id: AssetOrigin, label: string): string {
  return treeRow({
    dataName: 'asset-origin-filter',
    id,
    label,
    active: model.originFilters.has(id),
    icon: 'source',
  });
}

function treeRow(options: {
  dataName: string;
  id: string;
  label: string;
  active: boolean;
  icon: 'folder' | 'file' | 'asset' | 'source' | 'warning';
  count?: number;
}): string {
  return `<div class="ba-tree-row ba-tree-leaf${options.active ? ' active' : ''}" data-${options.dataName}="${escAttr(options.id)}" aria-selected="${options.active ? 'true' : 'false'}" role="treeitem" aria-level="2" tabindex="0" style="--tree-depth:1">
    <span class="ba-tree-spacer" aria-hidden="true"></span><span class="ba-tree-icon ${options.icon}" aria-hidden="true"></span><span class="ba-tree-label">${esc(options.label)}</span>${options.count === undefined ? '' : `<span class="ba-tree-count">${options.count}</span>`}
  </div>`;
}

function collectionLabelFor(collection: AssetSmartCollection): string {
  return COLLECTIONS.find((item) => item.id === collection)?.label ?? 'Assets';
}

function renderAssetPlacementRow(record: AssetRecord, selectedId: string | null, armedId: string | null): string {
  const selected = record.assetId === selectedId;
  const armed = record.assetId === armedId;
  return `<div class="ba-placement-row${selected ? ' selected' : ''}${armed ? ' armed' : ''}${record.validation.state !== 'valid' ? ` ${record.validation.state}` : ''}"
    data-asset-id="${escAttr(record.assetId)}" draggable="${isPlaceable(record) ? 'true' : 'false'}" role="option" aria-selected="${selected || armed ? 'true' : 'false'}" tabindex="0">
    ${renderAssetPreviewMarkup(record)}
    <div class="ba-placement-main">
      <div class="ba-name">${esc(record.name)}</div>
      <div class="ba-meta">${esc(compactAssetMeta(record))}</div>
    </div>
    <button type="button" class="ba-placement-detail" data-asset-placement-details="${escAttr(record.assetId)}" aria-label="Inspect ${escAttr(record.name)}">&#8942;</button>
  </div>`;
}

function compactAssetMeta(record: AssetRecord): string {
  const parts: string[] = [record.origin];
  if (record.kind === 'prefab' && record.payload && typeof record.payload === 'object') {
    const prefab = record.payload as {
      w?: unknown;
      h?: unknown;
      objects?: unknown[];
      lights?: unknown[];
      anchors?: unknown[];
    };
    if (typeof prefab.w === 'number' && typeof prefab.h === 'number') parts.push(`${prefab.w}x${prefab.h}`);
    if (Array.isArray(prefab.objects) && prefab.objects.length > 0) parts.push(`${prefab.objects.length} obj`);
    if (Array.isArray(prefab.lights) && prefab.lights.length > 0) parts.push(`${prefab.lights.length} light`);
    if (Array.isArray(prefab.anchors) && prefab.anchors.length > 0) parts.push(`${prefab.anchors.length} anchor`);
  } else if (record.kind === 'sprite' && record.payload && typeof record.payload === 'object') {
    const sprite = record.payload as { w?: unknown; h?: unknown; frames?: unknown[] };
    if (typeof sprite.w === 'number' && typeof sprite.h === 'number' && Array.isArray(sprite.frames)) {
      parts.push(`${sprite.w}x${sprite.h}x${sprite.frames.length}`);
    }
  } else {
    parts.push(record.folder);
  }
  if (record.tags.length > 0) parts.push(record.tags.slice(0, 3).map((tag) => `#${tag}`).join(' '));
  if (record.usages.length > 0) parts.push(`${record.usages.length} use(s)`);
  if (record.validation.state !== 'valid') parts.push(record.validation.state);
  return parts.join(' - ');
}

function kindLabelFor(kind: AssetKind): string {
  return KIND_FILTERS.find((item) => item.id === kind)?.label ?? kind;
}

function originLabelFor(origin: AssetOrigin): string {
  return ORIGIN_FILTERS.find((item) => item.id === origin)?.label ?? origin;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(value: string): string {
  return esc(value);
}

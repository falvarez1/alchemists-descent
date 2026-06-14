import { renderAssetPreviewMarkup } from '@/builder/assets/AssetPreview';
import type {
  AssetKind,
  AssetOrigin,
  AssetRecord,
  AssetSmartCollection,
  AssetSortMode,
} from '@/builder/assets/AssetTypes';
import type { AssetDatabaseStats } from '@/builder/assets/AssetDatabase';

export type AssetBrowserView = 'grid' | 'list';
type AssetBrowserTab = 'assets' | 'current' | 'imports';

export interface AssetBrowserModel {
  query: string;
  view: AssetBrowserView;
  sort: AssetSortMode;
  collection: AssetSmartCollection;
  kindFilters: ReadonlySet<AssetKind>;
  originFilters: ReadonlySet<AssetOrigin>;
  records: readonly AssetRecord[];
  selectedId: string | null;
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
  { id: 'materialProfile', label: 'Materials' },
  { id: 'lightPreset', label: 'Lights' },
  { id: 'backdrop', label: 'Backdrops' },
  { id: 'procPreset', label: 'Proc' },
  { id: 'importReport', label: 'Reports' },
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

export function renderAssetBrowserPanel(model: AssetBrowserModel): string {
  const activeTab = assetBrowserTab(model.collection);
  const collectionLabel = collectionLabelFor(model.collection);
  const activeFilters = [
    ...[...model.kindFilters].map(kindLabelFor),
    ...[...model.originFilters].map(originLabelFor),
  ];
  const pathSegments = ['Project', collectionLabel, ...activeFilters];
  const cards = model.records.length > 0
    ? model.records.map((record) => model.view === 'grid' ? renderAssetCard(record, model.selectedId) : renderAssetListRow(record, model.selectedId)).join('')
    : '<div class="ba-empty">No matching assets</div>';
  return `
    <div class="ba-browser">
      <div class="bi-head ba-head" data-panel-handle>
        <div class="ba-tabs" role="tablist" aria-label="Asset browser views">
          ${tabButton('assets', 'Assets Browser', activeTab)}
          ${tabButton('current', 'Current Doc', activeTab)}
          ${tabButton('imports', 'Imports', activeTab)}
        </div>
        <button id="ba-close" type="button" aria-label="Close asset browser">&times;</button>
      </div>
      <div class="ba-shell">
        <aside class="ba-sources" aria-label="Asset sources and filters">
          <div class="ba-summary">${model.stats.total} assets - ${model.stats.missing} missing - ${model.stats.errors} errors</div>
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
              treeKind(model, 'backdrop', 'Backdrops'),
              treeKind(model, 'procPreset', 'Procedural Presets'),
              treeKind(model, 'importReport', 'Import Reports'),
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
            <input id="ba-search" type="search" spellcheck="false" placeholder="Search assets" value="${escAttr(model.query)}">
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
          <div class="ba-path-row">
            <div class="ba-path" aria-label="Asset browser path">
              ${pathSegments.map((segment) => `<span>${esc(segment)}</span>`).join('<b>/</b>')}
            </div>
            <div class="ba-count">${model.records.length} shown</div>
          </div>
          <div id="ba-list" class="ba-list ${model.view}">
            ${cards}
          </div>
        </section>
      </div>
    </div>`;
}

function renderAssetCard(record: AssetRecord, selectedId: string | null): string {
  return `<div class="ba-card${record.assetId === selectedId ? ' selected' : ''}${record.validation.state !== 'valid' ? ` ${record.validation.state}` : ''}"
    data-asset-id="${escAttr(record.assetId)}" draggable="${isPlaceable(record) ? 'true' : 'false'}">
    ${renderAssetPreviewMarkup(record)}
    <div class="ba-card-body">
      <div class="ba-name">${esc(record.name)}</div>
      <div class="ba-meta">${esc(record.kind)} - ${esc(record.origin)} - ${record.usages.length} use(s)</div>
      <div class="ba-tags">${record.tags.slice(0, 4).map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>
    </div>
  </div>`;
}

function renderAssetListRow(record: AssetRecord, selectedId: string | null): string {
  return `<div class="ba-row${record.assetId === selectedId ? ' selected' : ''}${record.validation.state !== 'valid' ? ` ${record.validation.state}` : ''}"
    data-asset-id="${escAttr(record.assetId)}" draggable="${isPlaceable(record) ? 'true' : 'false'}">
    ${renderAssetPreviewMarkup(record)}
    <div class="ba-row-main">
      <div class="ba-name">${esc(record.name)}</div>
      <div class="ba-meta">${esc(record.assetId)} - ${record.folder} - ${record.usages.length} use(s)</div>
    </div>
    <span class="ba-pill">${esc(record.kind)}</span>
    <span class="ba-pill">${esc(record.origin)}</span>
  </div>`;
}

function isPlaceable(record: AssetRecord): boolean {
  return (record.kind === 'prefab' || record.kind === 'sprite') && record.payload !== null;
}

function sortOption(current: string, value: string, label: string): string {
  return `<option value="${escAttr(value)}" ${current === value ? 'selected' : ''}>${esc(label)}</option>`;
}

function tabButton(tab: AssetBrowserTab, label: string, active: AssetBrowserTab): string {
  return `<button type="button" class="ba-tab${tab === active ? ' active' : ''}" data-asset-tab="${tab}" role="tab" aria-selected="${tab === active ? 'true' : 'false'}">${esc(label)}</button>`;
}

function treeGroup(model: AssetBrowserModel, id: string, label: string, rows: readonly string[]): string {
  const collapsed = model.collapsedSections?.[id] === true;
  return `<section class="ba-tree-group bp-section${collapsed ? ' collapsed' : ''}" data-section="${escAttr(id)}">
    <div class="ba-tree-row ba-tree-folder bp-head bp-section-head" data-section-toggle="${escAttr(id)}" aria-expanded="${collapsed ? 'false' : 'true'}" role="treeitem" aria-level="1" tabindex="0">
      <span class="bp-chevron" aria-hidden="true"></span><span class="ba-tree-icon folder" aria-hidden="true"></span><span class="ba-tree-label">${esc(label)}</span>
    </div>
    <div class="bp-section-body ba-tree-children" role="group">${rows.join('')}</div>
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

function assetBrowserTab(collection: AssetSmartCollection): AssetBrowserTab {
  if (collection === 'imported') return 'imports';
  if (collection === 'usedByCurrentDocument') return 'current';
  return 'assets';
}

function collectionLabelFor(collection: AssetSmartCollection): string {
  return COLLECTIONS.find((item) => item.id === collection)?.label ?? 'Assets';
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

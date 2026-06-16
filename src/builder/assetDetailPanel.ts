import { renderAssetPreviewMarkup } from '@/builder/assets/AssetPreview';
import type { AssetDeletePlan, AssetRecord } from '@/builder/assets/AssetTypes';
import type { ContentItem } from '@/content/types';
import { builderPanelHeader } from '@/ui/editor/PanelChrome';
import { builderPanelTitle } from '@/ui/editor/PanelRegistry';
import { editorSectionHtml } from '@/ui/editor/Section';

export interface AssetDetailModel {
  asset: AssetRecord | null;
  deletePlan?: AssetDeletePlan;
  collapsedSections?: Readonly<Record<string, boolean>>;
}

export function renderAssetDetailPanel(model: AssetDetailModel): string {
  if (!model.asset) {
    return `
      ${builderPanelHeader({ title: builderPanelTitle('builder-asset-details'), closeId: 'bad-close', closeLabel: 'Close asset details' })}
      <div class="ba-empty b-empty">Select an asset to inspect metadata, dependencies, usages, and operations.</div>`;
  }
  const asset = model.asset;
  const validation = asset.validation.messages.length > 0
    ? asset.validation.messages.map((message) => `<div class="bad-message">${esc(message)}</div>`).join('')
    : '<div class="bad-message ok">No validation messages</div>';
  const dependencies = asset.dependencies.refs.length > 0
    ? asset.dependencies.refs.map((ref) => `<div class="bad-row${asset.dependencies.missing.includes(ref) ? ' missing' : ''}">
        <span>${esc(ref.kind)}</span><b>${esc(ref.sourceId)}</b>
      </div>`).join('')
    : '<div class="bad-message ok">No dependencies</div>';
  const usages = asset.usages.length > 0
    ? asset.usages.map((usage) => `<button type="button" class="bad-usage" data-reveal-usage="${escAttr(usage.assetId)}" title="${escAttr(usage.path)}">
        <span>${esc(usage.kind)}</span><b>${esc(usage.label)}</b>
      </button>`).join('')
    : '<div class="bad-message ok">No usages</div>';
  const deleteReasons = model.deletePlan && !model.deletePlan.allowed
    ? `<div class="bad-delete-block">${model.deletePlan.reasons.map((reason) => `<div>${esc(reason)}</div>`).join('')}</div>`
    : '';
  const documentOwned = asset.source.storage === 'document';
  const renameDisabled = asset.immutable || documentOwned;
  const content = isContentItem(asset.payload) ? asset.payload : null;
  const duplicateDisabled = !canDuplicate(asset);
  const reimportDisabled = !canReimport(asset);
  const exportLabel = asset.source.storage === 'content-registry' ? 'Export Metadata' : 'Export';
  const openAvailable = asset.kind === 'document' || asset.kind === 'template';
  const placeAvailable = canPlace(asset);
  return `
    ${builderPanelHeader({ title: builderPanelTitle('builder-asset-details'), closeId: 'bad-close', closeLabel: 'Close asset details' })}
    <div class="bad-hero">
      ${renderAssetPreviewMarkup(asset)}
      <div class="bad-title">
        <div>${esc(asset.name)}</div>
        <small>${esc(asset.assetId)}</small>
      </div>
    </div>
    <div class="bad-actions">
      ${openAvailable ? `<button type="button" data-asset-action="open" data-asset-id="${escAttr(asset.assetId)}" ${documentOwned ? 'disabled' : ''}>Open</button>` : ''}
      ${placeAvailable ? `<button type="button" data-asset-action="place" data-asset-id="${escAttr(asset.assetId)}">Place</button>` : ''}
      <button type="button" data-asset-action="rename" data-asset-id="${escAttr(asset.assetId)}" ${renameDisabled ? 'disabled' : ''}>Rename</button>
      <button type="button" data-asset-action="duplicate" data-asset-id="${escAttr(asset.assetId)}" ${duplicateDisabled ? 'disabled' : ''}>Duplicate</button>
      <button type="button" data-asset-action="reimport" data-asset-id="${escAttr(asset.assetId)}" ${reimportDisabled ? 'disabled' : ''}>Reimport</button>
      <button type="button" data-asset-action="export" data-asset-id="${escAttr(asset.assetId)}">${exportLabel}</button>
      <button type="button" class="b-danger" data-asset-action="delete" data-asset-id="${escAttr(asset.assetId)}" ${model.deletePlan?.allowed === false ? 'disabled' : ''}>Delete</button>
    </div>
    ${deleteReasons}
    ${section(model, 'assetDetails.metadata', 'Metadata', `
      ${metaRow('Kind', asset.kind)}
      ${metaRow('Origin', asset.origin)}
      ${metaRow('Folder', asset.folder)}
      ${metaRow('Portable', asset.portable ? 'yes' : 'no')}
      ${metaRow('Immutable', asset.immutable ? 'yes' : 'no')}
      ${metaRow('Size', `${asset.sizeBytes} bytes`)}
      ${metaRow('Signature', asset.contentSignature)}
      <div class="bad-tags">${asset.tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>
    `)}
    ${content ? renderContentSection(model, content) : ''}
    ${section(model, 'assetDetails.validation', 'Validation', `
      <div class="bad-state ${asset.validation.state}">${esc(asset.validation.state.toUpperCase())}</div>
      ${validation}
    `)}
    ${section(model, 'assetDetails.dependencies', 'Dependencies', `
      ${dependencies}
    `)}
    ${section(model, 'assetDetails.usages', 'Usages', `
      ${usages}
    `)}`;
}

function renderContentSection(model: AssetDetailModel, content: ContentItem): string {
  const deps = content.dependencies.length > 0
    ? content.dependencies.map((dep) => `<div class="bad-row">
        <span>${esc(dep.kind)}:${esc(dep.id)}</span><b>${esc(dep.reason)}</b>
      </div>`).join('')
    : '<div class="bad-message ok">No content dependencies</div>';
  return section(model, 'assetDetails.content', 'Content', `
    ${metaRow('Status', content.status)}
    ${metaRow('Source', content.source)}
    <div class="bad-message">${esc(content.description)}</div>
    ${deps}
  `);
}

function metaRow(label: string, value: string): string {
  return `<div class="bad-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function section(model: AssetDetailModel, id: string, title: string, body: string): string {
  return editorSectionHtml({
    id,
    title,
    body,
    className: 'bad-section',
    titleClassName: 'bad-section-title',
    bodyClassName: 'bad-section-body',
    collapsed: model.collapsedSections?.[id] === true,
  });
}

function canPlace(asset: AssetRecord): boolean {
  return asset.kind === 'prefab' ||
    asset.kind === 'sprite' ||
    asset.kind === 'materialProfile' ||
    asset.kind === 'lightPreset' ||
    asset.kind === 'procPreset';
}

function canDuplicate(asset: AssetRecord): boolean {
  if (asset.source.storage === 'document' || asset.source.storage === 'content-registry') return false;
  return asset.kind === 'document' || asset.kind === 'prefab' || asset.kind === 'sprite';
}

function isContentItem(value: unknown): value is ContentItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ContentItem>;
  return typeof item.id === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.status === 'string' &&
    typeof item.source === 'string' &&
    Array.isArray(item.dependencies);
}

function canReimport(asset: AssetRecord): boolean {
  return !asset.immutable &&
    asset.source.storage === 'localStorage' &&
    (asset.kind === 'document' || asset.kind === 'prefab' || asset.kind === 'sprite');
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(value: string): string {
  return esc(value);
}

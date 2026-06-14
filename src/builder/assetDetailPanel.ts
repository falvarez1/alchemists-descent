import { renderAssetPreviewMarkup } from '@/builder/assets/AssetPreview';
import type { AssetDeletePlan, AssetRecord } from '@/builder/assets/AssetTypes';
import type { ContentItem } from '@/content/types';

export interface AssetDetailModel {
  asset: AssetRecord | null;
  deletePlan?: AssetDeletePlan;
}

export function renderAssetDetailPanel(model: AssetDetailModel): string {
  if (!model.asset) {
    return `
      <div class="bi-head" data-panel-handle>ASSET DETAILS <button id="bad-close" type="button">&times;</button></div>
      <div class="ba-empty">Select an asset to inspect metadata, dependencies, usages, and operations.</div>`;
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
  return `
    <div class="bi-head" data-panel-handle>ASSET DETAILS <button id="bad-close" type="button">&times;</button></div>
    <div class="bad-hero">
      ${renderAssetPreviewMarkup(asset)}
      <div class="bad-title">
        <div>${esc(asset.name)}</div>
        <small>${esc(asset.assetId)}</small>
      </div>
    </div>
    <div class="bad-actions">
      ${openAvailable ? `<button type="button" data-asset-action="open" data-asset-id="${escAttr(asset.assetId)}" ${documentOwned ? 'disabled' : ''}>Open</button>` : ''}
      <button type="button" data-asset-action="rename" data-asset-id="${escAttr(asset.assetId)}" ${renameDisabled ? 'disabled' : ''}>Rename</button>
      <button type="button" data-asset-action="duplicate" data-asset-id="${escAttr(asset.assetId)}" ${duplicateDisabled ? 'disabled' : ''}>Duplicate</button>
      <button type="button" data-asset-action="reimport" data-asset-id="${escAttr(asset.assetId)}" ${reimportDisabled ? 'disabled' : ''}>Reimport</button>
      <button type="button" data-asset-action="export" data-asset-id="${escAttr(asset.assetId)}">${exportLabel}</button>
      <button type="button" data-asset-action="delete" data-asset-id="${escAttr(asset.assetId)}" ${model.deletePlan?.allowed === false ? 'disabled' : ''}>Delete</button>
    </div>
    ${deleteReasons}
    <section class="bad-section">
      <div class="bad-section-title">Metadata</div>
      ${metaRow('Kind', asset.kind)}
      ${metaRow('Origin', asset.origin)}
      ${metaRow('Folder', asset.folder)}
      ${metaRow('Portable', asset.portable ? 'yes' : 'no')}
      ${metaRow('Immutable', asset.immutable ? 'yes' : 'no')}
      ${metaRow('Size', `${asset.sizeBytes} bytes`)}
      ${metaRow('Signature', asset.contentSignature)}
      <div class="bad-tags">${asset.tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>
    </section>
    ${content ? renderContentSection(content) : ''}
    <section class="bad-section">
      <div class="bad-section-title">Validation</div>
      <div class="bad-state ${asset.validation.state}">${esc(asset.validation.state.toUpperCase())}</div>
      ${validation}
    </section>
    <section class="bad-section">
      <div class="bad-section-title">Dependencies</div>
      ${dependencies}
    </section>
    <section class="bad-section">
      <div class="bad-section-title">Usages</div>
      ${usages}
    </section>`;
}

function renderContentSection(content: ContentItem): string {
  const deps = content.dependencies.length > 0
    ? content.dependencies.map((dep) => `<div class="bad-row">
        <span>${esc(dep.kind)}:${esc(dep.id)}</span><b>${esc(dep.reason)}</b>
      </div>`).join('')
    : '<div class="bad-message ok">No content dependencies</div>';
  return `<section class="bad-section">
    <div class="bad-section-title">Content</div>
    ${metaRow('Status', content.status)}
    ${metaRow('Source', content.source)}
    <div class="bad-message">${esc(content.description)}</div>
    ${deps}
  </section>`;
}

function metaRow(label: string, value: string): string {
  return `<div class="bad-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
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

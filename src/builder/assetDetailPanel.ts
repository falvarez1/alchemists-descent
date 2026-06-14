import { renderAssetPreviewMarkup } from '@/builder/assets/AssetPreview';
import type { AssetDeletePlan, AssetRecord } from '@/builder/assets/AssetTypes';

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
  const duplicateDisabled = documentOwned;
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
      <button type="button" data-asset-action="rename" data-asset-id="${escAttr(asset.assetId)}" ${renameDisabled ? 'disabled' : ''}>Rename</button>
      <button type="button" data-asset-action="duplicate" data-asset-id="${escAttr(asset.assetId)}" ${duplicateDisabled ? 'disabled' : ''}>Duplicate</button>
      <button type="button" data-asset-action="export" data-asset-id="${escAttr(asset.assetId)}">Export</button>
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

function metaRow(label: string, value: string): string {
  return `<div class="bad-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(value: string): string {
  return esc(value);
}

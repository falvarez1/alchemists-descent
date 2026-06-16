import { escapeHtml as esc, escapeAttr as escAttr } from '@/ui/editor/Fields';
import type { AssetRecord } from '@/builder/assets/AssetTypes';
import { PREFAB_VARIANTS } from '@/builder/prefablib';
import type { PrefabAnchor, PrefabDef, PrefabVariantId } from '@/builder/prefablib';
import { builderPanelHeader } from '@/ui/editor/PanelChrome';
import { builderPanelTitle } from '@/ui/editor/PanelRegistry';
import { editorSectionHtml } from '@/ui/editor/Section';

export interface PrefabDetailModel {
  prefab: PrefabDef | null;
  asset: AssetRecord | null;
  activeVariant: PrefabVariantId;
  selectedAnchorId: string | null;
  collapsedSections?: Readonly<Record<string, boolean>>;
}

export function renderPrefabDetailPanel(model: PrefabDetailModel): string {
  if (!model.prefab) {
    return `
      ${builderPanelHeader({ title: builderPanelTitle('builder-prefab-details'), closeId: 'bpd-close', closeLabel: 'Close prefab details' })}
      <div class="bpd-empty b-empty">Select a prefab from the prefab palette or Asset Browser.</div>`;
  }
  const prefab = model.prefab;
  const validation = model.asset?.validation;
  const dependencies = model.asset?.dependencies;
  const missing = dependencies?.missing ?? [];
  const broken = dependencies?.broken ?? [];
  const anchors = prefab.anchors ?? [];
  const anchorDots = anchors.map((anchor) => ({ anchor, position: anchorPreviewPosition(anchor, prefab, 220, 140) }));
  return `
    ${builderPanelHeader({ title: builderPanelTitle('builder-prefab-details'), closeId: 'bpd-close', closeLabel: 'Close prefab details' })}
    <div class="bpd-panel">
      <div class="bpd-hero">
        <div class="bpd-preview-shell">
          <canvas class="bpd-large" data-prefab-preview="${escAttr(prefab.id)}" width="220" height="140" aria-label="${escAttr(prefab.name)} preview"></canvas>
          <div class="bpd-anchor-overlay" aria-label="Prefab anchor positions">
            ${anchorDots.map(({ anchor, position }) => `
              <button
                type="button"
                class="bpd-anchor-dot ${anchor.dir}${anchor.id === model.selectedAnchorId ? ' active' : ''}"
                data-prefab-anchor="${escAttr(anchor.id)}"
                data-preview-x="${position.x}"
                data-preview-y="${position.y}"
                data-preview-scale="${position.scale}"
                style="left:${position.left};top:${position.top}"
                title="${escAttr(`${anchor.id}: ${anchor.dir.toUpperCase()} ${anchor.kind}`)}"
                aria-label="${escAttr(`${anchor.id} ${anchor.dir.toUpperCase()} ${anchor.kind} anchor`)}">
                ${esc(anchor.dir.toUpperCase())}
              </button>`).join('')}
          </div>
        </div>
        <div class="bpd-title">
          <div>${esc(prefab.name)}</div>
          <small>${esc(prefab.id)}</small>
        </div>
      </div>
      <div class="bpd-actions">
        <button type="button" data-prefab-action="arm" data-variant="${escAttr(model.activeVariant)}">Arm Variant</button>
        <button type="button" data-prefab-action="asset">Asset Details</button>
        <button type="button" data-prefab-action="export-json">Export JSON</button>
        <button type="button" data-prefab-action="export-png">Export PNG</button>
        <button type="button" data-prefab-action="anchors">Edit Anchors</button>
      </div>
      ${section(model, 'prefabDetails.summary', 'Summary', `
        ${row('Size', `${prefab.w} x ${prefab.h}`)}
        ${row('Objects', String(prefab.objects.length))}
        ${row('Links', String(prefab.links.length))}
        ${row('Lights', String(prefab.lights.length))}
        ${row('Origin', model.asset?.origin ?? 'library')}
        <div class="bpd-tags">${prefab.tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>
      `)}
      ${section(model, 'prefabDetails.variants', 'Variants', `
        <div class="bpd-variants" role="radiogroup" aria-label="Prefab variants">
          ${PREFAB_VARIANTS.map((variant) => `
            <button type="button" role="radio" aria-checked="${variant.id === model.activeVariant ? 'true' : 'false'}" aria-pressed="${variant.id === model.activeVariant ? 'true' : 'false'}" class="bpd-variant${variant.id === model.activeVariant ? ' active' : ''}" data-prefab-variant="${variant.id}">
              <canvas data-prefab-variant-preview="${variant.id}" width="54" height="38" aria-label="${escAttr(variant.label)} preview"></canvas>
              <span>${esc(variant.label)}</span>
            </button>`).join('')}
        </div>
      `)}
      ${section(model, 'prefabDetails.anchors', 'Anchors', `
        ${anchors.length > 0
          ? `<div class="bpd-anchor-list">${anchors.map((anchor) => `
              <button type="button" class="bpd-anchor${anchor.id === model.selectedAnchorId ? ' active' : ''}" data-prefab-anchor="${escAttr(anchor.id)}">
                <b>${esc(anchor.id)}</b><span>${anchor.dir.toUpperCase()} ${anchor.kind} snaps to ${oppositeDir(anchor.dir).toUpperCase()} @ ${anchor.x},${anchor.y}</span>
              </button>`).join('')}</div>`
          : '<div class="bpd-message">No anchors. Add n/s/e/w anchors before composition snapping.</div>'}
      `)}
      ${section(model, 'prefabDetails.dependencies', 'Dependencies', `
        ${dependencies
          ? dependencies.refs.length > 0
            ? dependencies.refs.map((ref) => `<div class="bpd-row${missing.includes(ref) || broken.includes(ref) ? ' bad' : ''}"><span>${esc(ref.kind)}</span><b>${esc(ref.sourceId)}</b></div>`).join('')
            : '<div class="bpd-message ok">No dependencies</div>'
          : '<div class="bpd-message">Asset Database metadata unavailable</div>'}
      `)}
      ${section(model, 'prefabDetails.validation', 'Validation', `
        <div class="bpd-state ${validation?.state ?? 'unknown'}">${esc((validation?.state ?? 'unknown').toUpperCase())}</div>
        ${(validation?.messages.length ?? 0) > 0
          ? validation!.messages.map((message) => `<div class="bpd-message">${esc(message)}</div>`).join('')
          : '<div class="bpd-message ok">No validation messages</div>'}
      `)}
    </div>`;
}

function row(label: string, value: string): string {
  return `<div class="bpd-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function section(model: PrefabDetailModel, id: string, title: string, body: string): string {
  return editorSectionHtml({
    id,
    title,
    body,
    className: 'bpd-section',
    titleClassName: 'bpd-section-title',
    bodyClassName: 'bpd-section-body',
    collapsed: model.collapsedSections?.[id] === true,
  });
}

function anchorPreviewPosition(
  anchor: PrefabAnchor,
  prefab: PrefabDef,
  previewW: number,
  previewH: number,
): { left: string; top: string; x: string; y: string; scale: string } {
  const scale = Math.max(1, Math.floor(Math.min(previewW / prefab.w, previewH / prefab.h)));
  const drawnW = Math.min(previewW, prefab.w * scale);
  const drawnH = Math.min(previewH, prefab.h * scale);
  const ox = Math.floor((previewW - drawnW) / 2);
  const oy = Math.floor((previewH - drawnH) / 2);
  const ax = Math.max(0, Math.min(Math.max(0, prefab.w - 1), anchor.x));
  const ay = Math.max(0, Math.min(Math.max(0, prefab.h - 1), anchor.y));
  const x = Math.max(0, Math.min(previewW, ox + (ax + 0.5) * scale));
  const y = Math.max(0, Math.min(previewH, oy + (ay + 0.5) * scale));
  return {
    left: `${(x / previewW) * 100}%`,
    top: `${(y / previewH) * 100}%`,
    x: x.toFixed(3),
    y: y.toFixed(3),
    scale: String(scale),
  };
}

function oppositeDir(dir: 'n' | 's' | 'e' | 'w'): 'n' | 's' | 'e' | 'w' {
  if (dir === 'n') return 's';
  if (dir === 's') return 'n';
  if (dir === 'e') return 'w';
  return 'e';
}


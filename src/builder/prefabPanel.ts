import type { PrefabDef } from '@/builder/prefablib';
import { decodePrefabCells } from '@/builder/prefablib';
import { CELL_PALETTE, paletteColor } from '@/sim/cellPalette';
import { unpackB, unpackG, unpackR } from '@/sim/colors';
import type { RgbaDecodeResult } from '@/builder/assets/pixmap';
import { cellDisplayName, colorHex } from '@/builder/assets/pixmap';
import { PopoverHost } from '@/ui/editor/PopoverHost';

/**
 * The PREFABS palette section (replaces the terrain-only STAMPS list):
 * browseable cards with generated thumbnails, name/size/content badges, tag
 * chips and a search box. Pure presentation — every action delegates to the
 * Builder through the hooks so this module stays free of editor state.
 */

export interface PrefabPanelHooks {
  onArm(p: PrefabDef | null): void;
  onCapture(): void;
  onRegionPng(): void;
  onImport(): void;
  onPalette(): void;
  onExportPng(p: PrefabDef): void;
  onExportJson(p: PrefabDef): void;
  onEditAnchors(p: PrefabDef): void;
  onDelete(p: PrefabDef): void;
}

export class PrefabPanel {
  private list: PrefabDef[] = [];
  private builtins: PrefabDef[] = [];
  private armedId: string | null = null;
  private search = '';
  private tagFilter = new Set<string>();
  /** Thumbnails are generated, never stored; key carries enough of the
   *  terrain identity to invalidate on PNG re-import. */
  private thumbs = new Map<string, HTMLCanvasElement>();

  private searchEl: HTMLInputElement;
  private tagsEl: HTMLDivElement;
  private listEl: HTMLDivElement;
  private readonly popovers = new PopoverHost();

  constructor(
    host: HTMLElement,
    private hooks: PrefabPanelHooks,
  ) {
    host.innerHTML = `
      <button id="bp-prefab-capture" aria-label="Save the selected region — cells, objects, links, lights — as a reusable prefab">CAPTURE REGION</button>
      <div class="bp-grid bp-grid3">
        <button id="bp-prefab-import" aria-label="Import .prefab.json or terrain .png files">IMPORT</button>
        <button id="bp-prefab-png" aria-label="Export the selected region's cells as a paintable PNG">PNG&#8599;</button>
        <button id="bp-prefab-gpl" aria-label="Export the material palette as a .gpl swatch file (Aseprite/GIMP)">.GPL</button>
      </div>
      <input id="bp-prefab-search" placeholder="search prefabs&hellip;" spellcheck="false">
      <div id="bp-prefab-tags"></div>
      <div id="bp-prefab-list"></div>`;
    this.searchEl = host.querySelector('#bp-prefab-search') as HTMLInputElement;
    this.tagsEl = host.querySelector('#bp-prefab-tags') as HTMLDivElement;
    this.listEl = host.querySelector('#bp-prefab-list') as HTMLDivElement;

    host.querySelector('#bp-prefab-capture')!.addEventListener('click', () => hooks.onCapture());
    host.querySelector('#bp-prefab-import')!.addEventListener('click', () => hooks.onImport());
    host.querySelector('#bp-prefab-png')!.addEventListener('click', () => hooks.onRegionPng());
    host.querySelector('#bp-prefab-gpl')!.addEventListener('click', () => hooks.onPalette());
    this.searchEl.addEventListener('input', () => {
      this.search = this.searchEl.value.trim().toLowerCase();
      this.renderList();
    });
  }

  refresh(list: PrefabDef[], armedId: string | null, builtins: PrefabDef[] = []): void {
    this.list = list;
    this.builtins = builtins;
    this.armedId = armedId;
    this.popovers.hide('bp-prefab-pop');
    for (const t of [...this.tagFilter]) {
      if (!list.some((p) => p.tags.includes(t)) && !builtins.some((p) => p.tags.includes(t))) {
        this.tagFilter.delete(t);
      }
    }
    this.renderTags();
    this.renderList();
  }

  private renderTags(): void {
    const all = [...new Set([...this.list, ...this.builtins].flatMap((p) => p.tags))].sort();
    this.tagsEl.innerHTML = '';
    for (const tag of all) {
      const chip = document.createElement('button');
      chip.className = 'bp-prefab-tag' + (this.tagFilter.has(tag) ? ' active' : '');
      chip.textContent = '#' + tag;
      chip.addEventListener('click', () => {
        if (this.tagFilter.has(tag)) this.tagFilter.delete(tag);
        else this.tagFilter.add(tag);
        this.renderTags();
        this.renderList();
      });
      this.tagsEl.appendChild(chip);
    }
  }

  private matches(p: PrefabDef): boolean {
    if (this.search && !p.name.toLowerCase().includes(this.search)) return false;
    if (this.tagFilter.size > 0 && !p.tags.some((t) => this.tagFilter.has(t))) return false;
    return true;
  }

  private renderList(): void {
    this.listEl.innerHTML = '';
    const mine = this.list.filter((p) => this.matches(p));
    const stock = this.builtins.filter((p) => this.matches(p));
    if (mine.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bp-hint';
      empty.textContent =
        this.list.length === 0
          ? 'Select a region, then CAPTURE — objects, links and lights inside come along.'
          : 'No library prefabs match the filter.';
      this.listEl.appendChild(empty);
    }
    for (const p of mine) this.listEl.appendChild(this.card(p, false));
    // the built-in set ships with the game (worldgen places these): armable
    // and exportable here, but not deletable
    if (stock.length > 0) {
      const head = document.createElement('div');
      head.className = 'bp-prefab-subhead';
      head.textContent = 'BUILT-INS';
      this.listEl.appendChild(head);
      for (const p of stock) this.listEl.appendChild(this.card(p, true));
    }
  }

  private card(p: PrefabDef, builtin: boolean): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'bp-prefab-card' + (this.armedId === p.id ? ' armed' : '');
    card.appendChild(this.thumb(p));

    const body = document.createElement('div');
    body.className = 'bp-prefab-body';
    const meta: string[] = [`${p.w}×${p.h}`];
    if (p.objects.length > 0) meta.push(`${p.objects.length} obj`);
    if (p.lights.length > 0) meta.push(`${p.lights.length} light`);
    if (p.anchors && p.anchors.length > 0) meta.push(`${p.anchors.length}⚓`);
    body.innerHTML =
      `<span class="bp-prefab-name">${escapeHtml(p.name)}</span>` +
      `<span class="bp-prefab-meta">${meta.join(' · ')}</span>` +
      (p.tags.length > 0
        ? `<span class="bp-prefab-tagline">${p.tags.map((t) => '#' + escapeHtml(t)).join(' ')}</span>`
        : '');
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'bp-prefab-actions';
    const act = (label: string, title: string, fn: () => void): void => {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      actions.appendChild(b);
    };
    act('PNG', 'Export terrain as paintable PNG', () => this.hooks.onExportPng(p));
    act('JSON', 'Export full prefab (.prefab.json)', () => this.hooks.onExportJson(p));
    if (!builtin) {
      act('⚓', 'Edit worldgen anchors', () => this.hooks.onEditAnchors(p));
      act('×', 'Delete prefab', () => this.hooks.onDelete(p));
    }
    card.appendChild(actions);

    card.addEventListener('click', () => {
      this.hooks.onArm(this.armedId === p.id ? null : p);
    });
    card.addEventListener('mouseenter', () => this.showPopover(card, p, builtin));
    card.addEventListener('mouseleave', () => {
      this.popovers.hide('bp-prefab-pop');
    });
    return card;
  }

  /** Big hover preview: rendered terrain + name/details (no native tooltips). */
  private showPopover(card: HTMLElement, p: PrefabDef, builtin: boolean): void {
    this.popovers.show({
      id: 'bp-prefab-pop',
      anchor: card,
      offsetY: -20,
      render: (pop) => {
        const big = this.bigThumb(p);
        pop.appendChild(big);
        const body = document.createElement('div');
        body.className = 'bp-pop-body';
        const meta: string[] = [`${p.w}×${p.h} cells`];
        if (p.objects.length > 0) meta.push(`${p.objects.length} objects`);
        if (p.links.length > 0) meta.push(`${p.links.length} links`);
        if (p.lights.length > 0) meta.push(`${p.lights.length} lights`);
        if (p.anchors && p.anchors.length > 0) meta.push(`${p.anchors.length} anchors`);
        body.innerHTML =
          `<div class="bp-pop-name">${escapeHtml(p.name)}${builtin ? ' <span class="bp-pop-badge">BUILT-IN</span>' : ''}</div>` +
          `<div class="bp-pop-meta">${meta.join(' · ')}</div>` +
          (p.tags.length > 0
            ? `<div class="bp-pop-tags">${p.tags.map((t) => '#' + escapeHtml(t)).join(' ')}</div>`
            : '') +
          `<div class="bp-pop-hint">click arms it — then click the canvas to stamp · Q rotates · E flips</div>`;
        pop.appendChild(body);
      },
    });
  }

  /** Popover preview: palette-marked terrain at up to 192px wide. */
  private bigThumb(p: PrefabDef): HTMLCanvasElement {
    const cells = decodePrefabCells(p);
    const src = document.createElement('canvas');
    src.width = p.w;
    src.height = p.h;
    const sg = src.getContext('2d')!;
    const img = sg.createImageData(p.w, p.h);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i] === 0 ? paletteColor(0) : CELL_PALETTE[cells[i]];
      const o = i * 4;
      img.data[o] = unpackR(c);
      img.data[o + 1] = unpackG(c);
      img.data[o + 2] = unpackB(c);
      img.data[o + 3] = 255;
    }
    sg.putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.className = 'bp-pop-thumb';
    const scale = Math.max(1, Math.min(192 / p.w, 140 / p.h));
    out.width = Math.max(1, Math.round(p.w * scale));
    out.height = Math.max(1, Math.round(p.h * scale));
    const og = out.getContext('2d')!;
    og.imageSmoothingEnabled = false;
    og.drawImage(src, 0, 0, out.width, out.height);
    return out;
  }

  private thumb(p: PrefabDef): HTMLCanvasElement {
    const key = `${p.id}:${p.w}x${p.h}:${p.rle.length}`;
    const cached = this.thumbs.get(key);
    if (cached) return cached.cloneNode(true) as HTMLCanvasElement;

    const cells = decodePrefabCells(p);
    const src = document.createElement('canvas');
    src.width = p.w;
    src.height = p.h;
    const sg = src.getContext('2d')!;
    const img = sg.createImageData(p.w, p.h);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i] === 0 ? paletteColor(0) : CELL_PALETTE[cells[i]];
      const o = i * 4;
      img.data[o] = unpackR(c);
      img.data[o + 1] = unpackG(c);
      img.data[o + 2] = unpackB(c);
      img.data[o + 3] = 255;
    }
    sg.putImageData(img, 0, 0);

    const thumb = document.createElement('canvas');
    thumb.className = 'bp-prefab-thumb';
    thumb.width = 48;
    thumb.height = 36;
    const tg = thumb.getContext('2d')!;
    tg.imageSmoothingEnabled = false;
    tg.fillStyle = '#0a0c11';
    tg.fillRect(0, 0, 48, 36);
    const scale = Math.min(48 / p.w, 36 / p.h);
    const dw = Math.max(1, Math.round(p.w * scale));
    const dh = Math.max(1, Math.round(p.h * scale));
    tg.drawImage(src, (48 - dw) / 2, (36 - dh) / 2, dw, dh);
    this.thumbs.set(key, thumb);
    if (this.thumbs.size > 128) {
      // drop the oldest cached thumbnail (insertion order)
      const first = this.thumbs.keys().next().value;
      if (first) this.thumbs.delete(first);
    }
    return thumb.cloneNode(true) as HTMLCanvasElement;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The PNG import report: stray colors with swatch, count, first position
 * and the nearest-material suggestion. SNAP ALL maps everything to its
 * suggestion; CANCEL keeps the import out entirely (validate-then-accept).
 */
export function showImportReport(
  host: HTMLElement,
  filename: string,
  result: RgbaDecodeResult,
  opts: { onSnapAll: () => void; onCancel: () => void },
): void {
  host.innerHTML = '';
  host.style.display = '';
  const panel = document.createElement('div');
  panel.id = 'builder-import-report';
  const rows = result.unknown
    .map(
      (u) =>
        `<div class="b-imp-row"><span class="b-imp-swatch" style="background:${colorHex(u.rgb)}"></span>` +
        `<code>${colorHex(u.rgb)}</code><span>×${u.count}</span>` +
        `<span>at ${u.firstAt.x},${u.firstAt.y}</span>` +
        `<span>→ ${cellDisplayName(u.suggestion)} (Δ${u.dist})</span></div>`,
    )
    .join('');
  panel.innerHTML =
    `<div class="bi-head">IMPORT — ${escapeHtml(filename)}</div>` +
    `<div class="bp-hint">${result.unknown.length} unknown color(s) — not in the material palette.` +
    (result.semiTransparent > 0
      ? `<br>${result.semiTransparent} semi-transparent pixel(s) thresholded at 50%.`
      : '') +
    `</div>${rows}` +
    `<div class="bp-actions"><button id="b-imp-snap" class="b-accent">SNAP ALL TO NEAREST</button>` +
    `<button id="b-imp-cancel">CANCEL</button></div>`;
  host.appendChild(panel);
  const close = (): void => {
    host.style.display = 'none';
    host.innerHTML = '';
  };
  panel.querySelector('#b-imp-snap')!.addEventListener('click', () => {
    close();
    opts.onSnapAll();
  });
  panel.querySelector('#b-imp-cancel')!.addEventListener('click', () => {
    close();
    opts.onCancel();
  });
}

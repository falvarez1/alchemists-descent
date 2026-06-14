import { decodeFramePx } from '@/builder/assets/sprites';
import type { SpriteAsset } from '@/builder/assets/sprites';

/**
 * The SPRITES palette section (sibling of PrefabPanel): animated sprite
 * assets imported from Aseprite, browseable rows with a first-frame
 * thumbnail, size/frame-count/weight badges, EXPORT and DELETE per row.
 * Clicking a row arms it — the Builder places decor objects referencing it.
 * Pure presentation: every action delegates through the hooks.
 */

export interface SpritePanelHooks {
  onArm(s: SpriteAsset | null): void;
  onImport(): void;
  onExport(s: SpriteAsset): void;
  onDelete(s: SpriteAsset): void;
}

export class SpritePanel {
  private list: SpriteAsset[] = [];
  private armedId: string | null = null;
  /** Frame-0 thumbnails are generated, never stored. */
  private thumbs = new Map<string, HTMLCanvasElement>();
  private listEl: HTMLDivElement;

  constructor(
    host: HTMLElement,
    private hooks: SpritePanelHooks,
  ) {
    host.innerHTML = `
      <button id="bp-sprite-import" aria-label="Import animated sprites: Aseprite sheet JSON + PNG paired by basename; a lone PNG asks for a frame grid">Import Sprite</button>
      <div id="bp-sprite-list" role="listbox"></div>`;
    this.listEl = host.querySelector('#bp-sprite-list') as HTMLDivElement;
    host.querySelector('#bp-sprite-import')!.addEventListener('click', () => hooks.onImport());
  }

  refresh(list: SpriteAsset[], armedId: string | null): void {
    this.list = list;
    this.armedId = armedId;
    this.renderList();
  }

  private renderList(): void {
    this.listEl.innerHTML = '';
    if (this.list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bp-hint b-empty';
      empty.textContent =
        'Aseprite: Export Sprite Sheet with JSON Data, import both files. Arming places animated decor — visual only.';
      this.listEl.appendChild(empty);
      return;
    }
    for (const s of this.list) this.listEl.appendChild(this.row(s));
  }

  private row(s: SpriteAsset): HTMLDivElement {
    const row = document.createElement('div');
    const armed = this.armedId === s.id;
    row.className = 'bp-prefab-card bp-sprite-row' + (armed ? ' armed' : '');
    row.setAttribute('role', 'option');
    row.setAttribute('tabindex', '-1');
    row.setAttribute('aria-selected', armed ? 'true' : 'false');
    row.dataset.spriteId = s.id;
    row.appendChild(this.thumb(s));

    const body = document.createElement('div');
    body.className = 'bp-prefab-body';
    const kb = Math.max(1, Math.round(JSON.stringify(s).length / 1024));
    body.innerHTML =
      `<span class="bp-prefab-name">${escapeHtml(s.name)}</span>` +
      `<span class="bp-prefab-meta">${s.w}×${s.h}×${s.frames.length} · ${kb} KB${
        s.emissive ? ' · ☀' : ''
      }</span>` +
      (s.tags.length > 0
        ? `<span class="bp-prefab-tagline">${s.tags.map((t) => '#' + escapeHtml(t.name)).join(' ')}</span>`
        : '');
    row.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'bp-prefab-actions';
    const act = (label: string, title: string, fn: () => void, cls?: string): void => {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-label', title);
      if (cls) b.classList.add(cls);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      actions.appendChild(b);
    };
    act('Export', 'Export name.sheet.png + name.sprite.json (Aseprite-readable)', () =>
      this.hooks.onExport(s),
    );
    act('×', 'Delete sprite', () => this.hooks.onDelete(s), 'b-danger');
    row.appendChild(actions);

    row.addEventListener('click', () => {
      this.hooks.onArm(this.armedId === s.id ? null : s);
    });
    return row;
  }

  private thumb(s: SpriteAsset): HTMLCanvasElement {
    const key = `${s.id}:${s.w}x${s.h}:${s.frames.length}:${s.frames[0]?.px.length ?? 0}`;
    const cached = this.thumbs.get(key);
    if (cached) return cached.cloneNode(true) as HTMLCanvasElement;

    const src = document.createElement('canvas');
    src.width = s.w;
    src.height = s.h;
    const sg = src.getContext('2d')!;
    const img = sg.createImageData(s.w, s.h);
    img.data.set(decodeFramePx(s.frames[0].px, s.w, s.h));
    sg.putImageData(img, 0, 0);

    const thumb = document.createElement('canvas');
    thumb.className = 'bp-prefab-thumb';
    thumb.width = 48;
    thumb.height = 36;
    const tg = thumb.getContext('2d')!;
    tg.imageSmoothingEnabled = false;
    tg.fillStyle = '#0a0c11';
    tg.fillRect(0, 0, 48, 36);
    const scale = Math.min(48 / s.w, 36 / s.h, 4);
    const dw = Math.max(1, Math.round(s.w * scale));
    const dh = Math.max(1, Math.round(s.h * scale));
    tg.drawImage(src, (48 - dw) / 2, (36 - dh) / 2, dw, dh);
    this.thumbs.set(key, thumb);
    if (this.thumbs.size > 64) {
      const first = this.thumbs.keys().next().value;
      if (first) this.thumbs.delete(first);
    }
    return thumb.cloneNode(true) as HTMLCanvasElement;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

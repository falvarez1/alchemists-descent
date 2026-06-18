import { Cell, isConductor } from '@/sim/CellType';
import { escapeHtml } from '@/core/strings';
import { unpackR, unpackG, unpackB } from '@/sim/colors';
import { MATERIAL_PARAMS } from '@/config/params';
import { BIOMES } from '@/config/biomes';
import { getDefaultPixelSceneLibrary, createDefaultVirtualWorldDef, biomeIndexFromId } from '@/world/virtual/defaults';
import { generateVirtualChunk, terrainColor } from '@/world/virtual/ChunkGenerator';
import { stampPixelScenes } from '@/world/virtual/PixelSceneStamper';
import { emissiveGlowRgb } from '@/world/virtual/emissive';
import { serializePixelScene, parsePixelScene, type PixelSceneJson } from '@/world/virtual/pixelSceneJson';
import { validatePixelScene } from '@/world/virtual/pixelSceneValidate';
import { listUserScenes, saveUserScene, deleteUserScene, userSceneExists } from '@/world/virtual/pixelSceneStore';
import { VIRTUAL_SCENE_KINDS } from '@/world/virtual/defaults';
import { PIXEL_SCENE_BIOME_FILL, type PixelSceneDef, type VirtualChunk, type VirtualScenePlacementInstance, type VirtualSceneKind } from '@/world/virtual/types';
import type { BiomeId } from '@/core/types';

interface Swatch { cell: number; name: string; color: number }

// Paintable cells + a representative editor color. The author paints cell TYPES;
// per-pixel colour shading is a follow-up (scenes loaded from code keep their own).
const PALETTE: Swatch[] = [
  { cell: PIXEL_SCENE_BIOME_FILL, name: 'Biome Fill', color: 0x3a352c },
  { cell: Cell.Wall, name: 'Wall', color: 0x4a4a52 },
  { cell: Cell.Stone, name: 'Stone', color: 0x52505a },
  { cell: Cell.Wood, name: 'Wood', color: 0x5e3e22 },
  { cell: Cell.Moss, name: 'Moss', color: 0x34702f },
  { cell: Cell.Vines, name: 'Vines', color: 0x2a8a3a },
  { cell: Cell.Water, name: 'Water', color: 0x286eb8 },
  { cell: Cell.Lava, name: 'Lava', color: 0xee420c },
  { cell: Cell.Ice, name: 'Ice', color: 0x84b8de },
  { cell: Cell.Snow, name: 'Snow', color: 0xd6e0e8 },
  { cell: Cell.Crystal, name: 'Crystal', color: 0x5fcee8 },
  { cell: Cell.Glowshroom, name: 'Glowshrm', color: 0x74da8a },
  { cell: Cell.Fungus, name: 'Fungus', color: 0x309c76 },
  { cell: Cell.Gold, name: 'Gold', color: 0xe2b02a },
  { cell: Cell.Coal, name: 'Coal', color: 0x24242c },
  { cell: Cell.Sand, name: 'Sand', color: 0xd9c089 },
  { cell: Cell.Glass, name: 'Glass', color: 0xa0c0d4 },
  { cell: Cell.Acid, name: 'Acid', color: 0x44d22a },
  { cell: Cell.Empty, name: 'Erase', color: 0x000000 },
];
const SWATCH_BY_CELL = new Map(PALETTE.map((s) => [s.cell, s]));
const fallbackColor = (cell: number): number => SWATCH_BY_CELL.get(cell)?.color ?? 0x6a6a72;

type Tool = 'paint' | 'erase' | 'eyedrop' | 'light';

/**
 * Pixel Scene Editor — a Builder authoring tool for the chunked world's pixel
 * scenes (T2 of docs/CHUNKED-WORLD-ENHANCEMENTS.md). Paint cells, set kind/tags,
 * place lights, preview the way the live lighting renders it, validate, and
 * save/export. Self-contained modal mounted into the Builder root.
 */
export class PixelSceneEditor {
  private root: HTMLElement;
  private overlay: HTMLElement;
  private canvas: HTMLCanvasElement;
  private scene: PixelSceneDef = blankScene('user-scene-1', 'New Scene', 48, 32);
  private selectedCell: number = Cell.Wall;
  private tool: Tool = 'paint';
  private brush = 1;
  private lit = false;
  private zoom = 8;
  private painting = false;
  private dirty = false;
  /** 'edit' = paint the scene; 'tile' = preview the scene generated into a chunk. */
  private mode: 'edit' | 'tile' = 'edit';
  private tile: VirtualChunk | null = null;
  private tileRect: { x: number; y: number; w: number; h: number } | null = null;
  private tilePlacements: VirtualScenePlacementInstance[] = [];
  private tileBiome: BiomeId = 'earthen';
  private tileSeed = 0x51a17e;
  private hoverEl: HTMLElement | null = null;
  private keyHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen()) { e.stopPropagation(); this.close(); }
  };
  private upHandler = (): void => { this.painting = false; };

  constructor(root: HTMLElement) {
    this.root = root;
    injectStyle();
    this.overlay = document.createElement('div');
    this.overlay.id = 'pse-overlay';
    this.overlay.className = 'pse-overlay';
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <div class="pse-shell">
        <div class="pse-header">
          <span class="pse-title">PIXEL SCENE EDITOR</span>
          <input id="pse-name" class="pse-name" type="text" aria-label="Scene name" maxlength="40">
          <span class="pse-spacer"></span>
          <button id="pse-new" title="Blank scene">NEW</button>
          <button id="pse-dup" title="Duplicate this scene">DUPLICATE</button>
          <button id="pse-import" title="Import a .pixel-scene.json">IMPORT</button>
          <button id="pse-export" title="Download this scene as JSON">EXPORT</button>
          <button id="pse-save" class="pse-primary" title="Save to the user library">SAVE</button>
          <button id="pse-lit" title="Toggle lit preview (emissive + light halos)">LIT</button>
          <button id="pse-tile" title="Generate a chunk with this scene placed — preview the final product">GEN TILE</button>
          <button id="pse-close" class="pse-close" title="Close (Esc)" aria-label="Close">✕</button>
          <input id="pse-file" type="file" accept=".json" hidden>
        </div>
        <div class="pse-body">
          <div class="pse-col pse-scenes">
            <div class="pse-sub">Library</div>
            <div id="pse-builtin" class="pse-list"></div>
            <div class="pse-sub">Your scenes</div>
            <div id="pse-user" class="pse-list"></div>
          </div>
          <div class="pse-canvas-wrap"><canvas id="pse-canvas" class="pse-canvas"></canvas></div>
          <div class="pse-col pse-tools">
            <div class="pse-sub">Cell</div>
            <div id="pse-palette" class="pse-palette"></div>
            <div class="pse-sub">Tool</div>
            <div id="pse-toolrow" class="pse-toolrow">
              <button data-tool="paint">Paint</button><button data-tool="erase">Erase</button>
              <button data-tool="eyedrop">Pick</button><button data-tool="light">Light</button>
            </div>
            <label class="pse-field">Brush <input id="pse-brush" type="range" min="0" max="4" step="1" value="0"><b id="pse-brush-v">1</b></label>
            <div class="pse-sub">Properties</div>
            <label class="pse-field">Kind <select id="pse-kind"></select></label>
            <label class="pse-field">Tags <input id="pse-tags" type="text" placeholder="earthen, light, shrine"></label>
            <label class="pse-field">Size
              <input id="pse-w" type="number" min="4" max="256" class="pse-num"> ×
              <input id="pse-h" type="number" min="4" max="256" class="pse-num">
              <button id="pse-resize">Resize</button>
            </label>
            <div class="pse-sub">Tile preview</div>
            <label class="pse-field">Biome <select id="pse-tile-biome"></select></label>
            <div class="pse-toolrow">
              <button id="pse-tile-gen">Generate</button><button id="pse-tile-reseed">New seed</button>
            </div>
            <div class="pse-sub">Validation</div>
            <ul id="pse-warns" class="pse-warns"></ul>
            <button id="pse-delete" class="pse-danger" title="Delete this scene from the user library">DELETE</button>
          </div>
        </div>
      </div>`;
    this.root.appendChild(this.overlay);
    this.canvas = this.overlay.querySelector('#pse-canvas')!;
    this.hoverEl = this.overlay.querySelector('.pse-canvas-wrap')!.appendChild(this.makeHover());
    this.wire();
    this.buildPalette();
    this.buildKindSelect();
    this.buildBiomeSelect();
  }

  private makeHover(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'pse-hover';
    el.className = 'pse-hover';
    el.hidden = true;
    return el;
  }

  isOpen(): boolean { return !this.overlay.hidden; }

  open(): void {
    if (this.isOpen()) return;
    this.overlay.hidden = false;
    window.addEventListener('keydown', this.keyHandler, true);
    window.addEventListener('mouseup', this.upHandler);
    this.refreshSceneLists();
    this.loadScene(this.scene);
  }

  close(): void {
    if (!this.isOpen()) return;
    this.overlay.hidden = true;
    window.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('mouseup', this.upHandler);
  }

  // ---- wiring -------------------------------------------------------------
  private el<T extends HTMLElement>(sel: string): T { return this.overlay.querySelector(sel) as T; }

  private wire(): void {
    this.el('#pse-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('mousedown', (e) => { if (e.target === this.overlay) this.close(); });
    this.el('#pse-new').addEventListener('click', () => this.newScene());
    this.el('#pse-dup').addEventListener('click', () => this.duplicate());
    this.el('#pse-save').addEventListener('click', () => this.save());
    this.el('#pse-export').addEventListener('click', () => this.exportScene());
    this.el('#pse-delete').addEventListener('click', () => this.deleteScene());
    this.el('#pse-import').addEventListener('click', () => this.el<HTMLInputElement>('#pse-file').click());
    this.el<HTMLInputElement>('#pse-file').addEventListener('change', (e) => this.importFile(e));
    this.el('#pse-lit').addEventListener('click', () => { this.lit = !this.lit; this.el('#pse-lit').classList.toggle('active', this.lit); this.draw(); });
    this.el<HTMLInputElement>('#pse-name').addEventListener('input', (e) => { this.scene.name = (e.target as HTMLInputElement).value; this.dirty = true; this.renderWarns(); });
    this.el<HTMLInputElement>('#pse-tags').addEventListener('input', (e) => {
      this.scene.tags = (e.target as HTMLInputElement).value.split(',').map((t) => t.trim()).filter(Boolean);
      this.dirty = true; this.renderWarns();
    });
    this.el<HTMLSelectElement>('#pse-kind').addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.scene.kind = v ? (v as VirtualSceneKind) : undefined;
      this.dirty = true; this.renderWarns();
    });
    const brush = this.el<HTMLInputElement>('#pse-brush');
    brush.addEventListener('input', () => { this.brush = Number(brush.value); this.el('#pse-brush-v').textContent = String(this.brush * 2 + 1); });
    this.el('#pse-resize').addEventListener('click', () => this.resize());
    for (const b of Array.from(this.el('#pse-toolrow').children) as HTMLElement[]) {
      b.addEventListener('click', () => this.setTool(b.dataset.tool as Tool));
    }
    this.el('#pse-tile').addEventListener('click', () => this.toggleTile());
    this.el('#pse-tile-gen').addEventListener('click', () => this.generateTile());
    this.el('#pse-tile-reseed').addEventListener('click', () => { this.tileSeed = (this.tileSeed * 1103515245 + 12345) >>> 0; this.generateTile(); });
    this.el<HTMLSelectElement>('#pse-tile-biome').addEventListener('change', (e) => { this.tileBiome = (e.target as HTMLSelectElement).value as BiomeId; if (this.mode === 'tile') this.generateTile(); });
    this.canvas.addEventListener('mousedown', (e) => { if (this.mode === 'edit') { this.painting = true; this.paintAt(e); } });
    this.canvas.addEventListener('mousemove', (e) => { if (this.painting) this.paintAt(e); this.updateHover(e); });
    this.canvas.addEventListener('mouseleave', () => { this.painting = false; if (this.hoverEl) this.hoverEl.hidden = true; });
  }

  private buildBiomeSelect(): void {
    const sel = this.el<HTMLSelectElement>('#pse-tile-biome');
    sel.innerHTML = (Object.keys(BIOMES) as BiomeId[]).map((id) => `<option value="${id}">${BIOMES[id].name}</option>`).join('');
    sel.value = this.tileBiome;
  }

  private buildPalette(): void {
    const host = this.el('#pse-palette');
    host.innerHTML = '';
    for (const sw of PALETTE) {
      const b = document.createElement('button');
      b.className = 'pse-swatch';
      b.dataset.cell = String(sw.cell);
      b.title = sw.name;
      b.innerHTML = `<span class="pse-dot" style="background:${hex(sw.color)}"></span>${escapeHtml(sw.name)}`;
      b.addEventListener('click', () => { this.selectedCell = sw.cell; this.tool = sw.cell === Cell.Empty ? 'erase' : 'paint'; this.syncPalette(); this.syncTool(); });
      host.appendChild(b);
    }
    this.syncPalette();
  }

  private buildKindSelect(): void {
    const sel = this.el<HTMLSelectElement>('#pse-kind');
    sel.innerHTML = '<option value="">(none)</option>' + VIRTUAL_SCENE_KINDS.map((k) => `<option value="${k}">${k}</option>`).join('');
  }

  private syncPalette(): void {
    for (const b of Array.from(this.el('#pse-palette').children) as HTMLElement[]) {
      b.classList.toggle('active', Number(b.dataset.cell) === this.selectedCell);
    }
  }
  private syncTool(): void {
    for (const b of Array.from(this.el('#pse-toolrow').children) as HTMLElement[]) {
      b.classList.toggle('active', b.dataset.tool === this.tool);
    }
  }
  private setTool(t: Tool): void { this.tool = t; this.syncTool(); }

  // ---- scene lifecycle ----------------------------------------------------
  private refreshSceneLists(): void {
    const builtin = this.el('#pse-builtin');
    builtin.innerHTML = '';
    for (const s of getDefaultPixelSceneLibrary()) builtin.appendChild(this.sceneRow(s, false));
    const user = this.el('#pse-user');
    user.innerHTML = '';
    const users = listUserScenes();
    if (users.length === 0) user.innerHTML = '<div class="pse-empty">none yet — NEW or DUPLICATE</div>';
    for (const s of users) user.appendChild(this.sceneRow(s, true));
  }

  private sceneRow(scene: PixelSceneDef, user: boolean): HTMLElement {
    const row = document.createElement('button');
    row.className = 'pse-scene-row';
    row.dataset.id = scene.id;
    row.innerHTML = `<span class="pse-scene-name">${escapeHtml(scene.name)}</span><span class="pse-scene-kind">${escapeHtml(scene.kind ?? '—')}</span>`;
    row.classList.toggle('user', user);
    row.addEventListener('click', () => this.loadScene(cloneForEdit(scene)));
    return row;
  }

  private loadScene(scene: PixelSceneDef): void {
    this.scene = cloneForEdit(scene);
    this.dirty = false;
    this.mode = 'edit';
    this.tile = null;
    this.el('#pse-tile').classList.remove('active');
    this.canvas.classList.remove('pse-tile-mode');
    this.el<HTMLInputElement>('#pse-name').value = this.scene.name;
    this.el<HTMLInputElement>('#pse-tags').value = (this.scene.tags ?? []).join(', ');
    this.el<HTMLSelectElement>('#pse-kind').value = this.scene.kind ?? '';
    this.el<HTMLInputElement>('#pse-w').value = String(this.scene.w);
    this.el<HTMLInputElement>('#pse-h').value = String(this.scene.h);
    for (const row of Array.from(this.overlay.querySelectorAll('.pse-scene-row')) as HTMLElement[]) {
      row.classList.toggle('selected', row.dataset.id === this.scene.id);
    }
    this.fitZoom();
    this.draw();
    this.renderWarns();
  }

  private newScene(): void { this.loadScene(blankScene(this.uniqueId('New Scene'), 'New Scene', 48, 32)); }

  private duplicate(): void {
    const copy = cloneForEdit(this.scene);
    copy.name = `${this.scene.name} copy`;
    copy.id = this.uniqueId(copy.name);
    this.loadScene(copy);
  }

  private uniqueId(name: string): string {
    const base = 'user-' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene');
    let id = base;
    let n = 2;
    while (userSceneExists(id) || id === this.scene.id) id = `${base}-${n++}`;
    return id;
  }

  private save(): void {
    if (!this.scene.id.startsWith('user-')) this.scene.id = this.uniqueId(this.scene.name);
    const ok = saveUserScene(this.scene);
    this.dirty = false;
    this.refreshSceneLists();
    this.loadScene(this.scene);
    this.flash(ok ? `Saved “${this.scene.name}”` : 'Save failed (storage unavailable)', !ok);
  }

  private deleteScene(): void {
    if (!userSceneExists(this.scene.id)) { this.flash('Only saved user scenes can be deleted', true); return; }
    deleteUserScene(this.scene.id);
    this.refreshSceneLists();
    this.newScene();
    this.flash('Deleted', false);
  }

  private exportScene(): void {
    const json = JSON.stringify(serializePixelScene(this.scene), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.scene.id}.pixel-scene.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  private importFile(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const scene = parsePixelScene(JSON.parse(String(reader.result)) as PixelSceneJson);
        scene.id = this.uniqueId(scene.name);
        this.loadScene(cloneForEdit(scene));
        this.flash(`Imported “${scene.name}”`, false);
      } catch (err) {
        this.flash(`Import failed: ${(err as Error).message}`, true);
      }
    };
    reader.readAsText(file);
    (e.target as HTMLInputElement).value = '';
  }

  private resize(): void {
    const nw = clampInt(Number(this.el<HTMLInputElement>('#pse-w').value), 4, 256);
    const nh = clampInt(Number(this.el<HTMLInputElement>('#pse-h').value), 4, 256);
    if (nw === this.scene.w && nh === this.scene.h) return;
    this.scene = resizeScene(this.scene, nw, nh);
    this.dirty = true;
    this.fitZoom();
    this.draw();
    this.renderWarns();
  }

  // ---- painting -----------------------------------------------------------
  private cellAt(e: MouseEvent): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / this.zoom);
    const y = Math.floor((e.clientY - rect.top) / this.zoom);
    if (x < 0 || y < 0 || x >= this.scene.w || y >= this.scene.h) return null;
    return { x, y };
  }

  private paintAt(e: MouseEvent): void {
    const c = this.cellAt(e);
    if (!c) return;
    if (this.tool === 'eyedrop') {
      const i = c.x + c.y * this.scene.w;
      this.selectedCell = this.scene.material[i] || Cell.Wall;
      this.tool = 'paint';
      this.syncPalette();
      this.syncTool();
      return;
    }
    if (this.tool === 'light') {
      this.toggleLight(c.x, c.y);
      this.painting = false;
      return;
    }
    const erase = this.tool === 'erase' || this.selectedCell === Cell.Empty;
    const { w, h, material, mask, colorOverrides } = this.scene;
    const r = this.brush;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = x + y * w;
        if (erase) {
          material[i] = Cell.Empty;
          if (mask) mask[i] = 0;
          if (colorOverrides) colorOverrides[i] = 0;
        } else {
          material[i] = this.selectedCell;
          if (mask) mask[i] = 1;
          if (colorOverrides) colorOverrides[i] = fallbackColor(this.selectedCell);
        }
      }
    }
    this.dirty = true;
    this.draw();
    this.renderWarns();
  }

  private toggleLight(x: number, y: number): void {
    const lights = this.scene.lights ?? (this.scene.lights = []);
    const hit = lights.findIndex((l) => Math.abs(l.x - x) <= 1 && Math.abs(l.y - y) <= 1);
    if (hit >= 0) lights.splice(hit, 1);
    else lights.push({ id: `light-${lights.length + 1}`, x, y, color: '#9fe8ff', intensity: 0.8, radius: Math.round(Math.max(this.scene.w, this.scene.h) * 0.7), bloom: 1, flicker: 0.06, falloff: 'soft', occluded: true });
    this.dirty = true;
    this.draw();
    this.renderWarns();
  }

  // ---- rendering ----------------------------------------------------------
  /** Active grid dimensions — the scene in edit mode, the generated chunk in tile mode. */
  private gridDims(): { w: number; h: number } {
    if (this.mode === 'tile' && this.tile) return { w: this.tile.size, h: this.tile.size };
    return { w: this.scene.w, h: this.scene.h };
  }

  private fitZoom(): void {
    const wrap = this.el('.pse-canvas-wrap');
    const maxW = Math.max(120, wrap.clientWidth - 16);
    const maxH = Math.max(120, wrap.clientHeight - 16);
    const { w, h } = this.gridDims();
    this.zoom = Math.max(1, Math.min(24, Math.floor(Math.min(maxW / w, maxH / h))));
    this.canvas.width = w * this.zoom;
    this.canvas.height = h * this.zoom;
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    if (this.mode === 'tile') { this.drawTile(ctx); return; }
    const { w, h, material, mask, colorOverrides } = this.scene;
    const z = this.zoom;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#0b0b0f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const painted = (i: number): boolean => (mask ? mask[i] !== 0 : material[i] !== Cell.Empty);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = x + y * w;
        const t = material[i];
        if (!painted(i) || t === Cell.Empty) continue;
        const base = colorOverrides && colorOverrides[i] ? colorOverrides[i] : fallbackColor(t);
        const glow = this.lit ? emissiveGlowRgb(t) : null;
        const r = Math.min(255, ((base >> 16) & 0xff) + (glow ? glow[0] : 0));
        const g = Math.min(255, ((base >> 8) & 0xff) + (glow ? glow[1] : 0));
        const b = Math.min(255, (base & 0xff) + (glow ? glow[2] : 0));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x * z, y * z, z, z);
      }
    }
    if (this.lit) {
      ctx.globalCompositeOperation = 'lighter';
      for (const light of this.scene.lights ?? []) {
        const [lr, lg, lb] = hexToRgb(light.color);
        const lx = light.x * z + z / 2;
        const ly = light.y * z + z / 2;
        const radius = Math.max(8, light.radius * z * 0.5);
        const a = Math.max(0.1, Math.min(0.85, light.intensity * 0.6));
        const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius);
        grad.addColorStop(0, `rgba(${lr},${lg},${lb},${a})`);
        grad.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(lx, ly, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    } else {
      if (z >= 6) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= w; x++) { ctx.moveTo(x * z + 0.5, 0); ctx.lineTo(x * z + 0.5, h * z); }
        for (let y = 0; y <= h; y++) { ctx.moveTo(0, y * z + 0.5); ctx.lineTo(w * z, y * z + 0.5); }
        ctx.stroke();
      }
      for (const light of this.scene.lights ?? []) {
        ctx.strokeStyle = 'rgba(160,230,255,0.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(light.x * z + z / 2, light.y * z + z / 2, Math.max(4, z * 1.4), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const obj of this.scene.objects ?? []) {
        ctx.strokeStyle = 'rgba(250,220,120,0.95)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(obj.x * z, obj.y * z, Math.max(4, z * 1.6), Math.max(4, z * 1.6));
      }
    }
  }

  // ---- tile preview -------------------------------------------------------
  private toggleTile(): void {
    if (this.mode === 'tile') { this.setMode('edit'); return; }
    this.setMode('tile');
    this.generateTile();
  }

  private setMode(mode: 'edit' | 'tile'): void {
    this.mode = mode;
    this.el('#pse-tile').classList.toggle('active', mode === 'tile');
    this.canvas.classList.toggle('pse-tile-mode', mode === 'tile');
    if (mode === 'edit') { this.tile = null; this.fitZoom(); this.draw(); }
  }

  /** Generate a plain single-biome cave chunk, find a floor, and stamp THIS scene
   *  onto it (resolving biome-fill to the cave rock) so the preview shows the scene
   *  embedded in terrain the way it materializes in the World Map — not floating. */
  private generateTile(): void {
    if (this.mode !== 'tile') this.setMode('tile');
    const def = createDefaultVirtualWorldDef(this.tileSeed);
    def.map.cells.fill(biomeIndexFromId(this.tileBiome)); // uniform biome across the preview
    def.dressing.scenes.controls.density = 0; // suppress the auto tile-slot scenes — show just this one
    def.pixelScenes = [];
    let chunk: VirtualChunk;
    try {
      chunk = generateVirtualChunk(def, 0, 0);
    } catch (err) {
      this.flash(`Tile gen failed: ${(err as Error).message}`, true);
      this.setMode('edit');
      return;
    }
    const pos = findScenePlacement(chunk, this.scene.w, this.scene.h);
    const stamped = stampPixelScenes(
      { originX: chunk.originX, originY: chunk.originY, size: chunk.size, types: chunk.types, colors: chunk.colors, life: chunk.life, charge: chunk.charge },
      [{ id: 'editor-preview', scene: this.scene, x: chunk.originX + pos.x, y: chunk.originY + pos.y, priority: 1000 }],
      (wx, wy) => ({ type: Cell.Wall, color: terrainColor(def, this.tileBiome, wx, wy, 0.5) }),
    );
    this.tile = chunk;
    this.tilePlacements = stamped.placements;
    this.tileRect = { x: pos.x, y: pos.y, w: this.scene.w, h: this.scene.h };
    this.fitZoom();
    this.draw();
  }

  private drawTile(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#0b0b0f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const tile = this.tile;
    if (!tile) return;
    const size = tile.size;
    const z = this.zoom;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = x + y * size;
        const t = tile.types[i];
        if (t === Cell.Empty) continue;
        const base = tile.colors[i];
        const glow = this.lit ? emissiveGlowRgb(t) : null;
        const r = Math.min(255, ((base >> 16) & 0xff) + (glow ? glow[0] : 0));
        const g = Math.min(255, ((base >> 8) & 0xff) + (glow ? glow[1] : 0));
        const b = Math.min(255, (base & 0xff) + (glow ? glow[2] : 0));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x * z, y * z, z, z);
      }
    }
    if (this.lit) {
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.tilePlacements) {
        for (const light of p.lights ?? []) {
          const [lr, lg, lb] = hexToRgb(light.color);
          const lx = (light.x - tile.originX) * z + z / 2;
          const ly = (light.y - tile.originY) * z + z / 2;
          const radius = Math.max(8, light.radius * z * 0.5);
          const a = Math.max(0.1, Math.min(0.85, light.intensity * 0.6));
          const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius);
          grad.addColorStop(0, `rgba(${lr},${lg},${lb},${a})`);
          grad.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(lx, ly, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // Outline where the scene was stamped.
    if (this.tileRect) {
      ctx.strokeStyle = 'rgba(250,210,90,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(this.tileRect.x * z + 0.5, this.tileRect.y * z + 0.5, this.tileRect.w * z, this.tileRect.h * z);
    }
  }

  // ---- material hover readout (the in-game "I" inspector, for the editor) --
  private cellInfoAt(gx: number, gy: number): { id: number; color: number } | null {
    if (this.mode === 'tile') {
      const tile = this.tile;
      if (!tile) return null;
      const i = gx + gy * tile.size;
      return { id: tile.types[i], color: tile.colors[i] };
    }
    const i = gx + gy * this.scene.w;
    const id = this.scene.material[i];
    const color = this.scene.colorOverrides && this.scene.colorOverrides[i] ? this.scene.colorOverrides[i] : (id !== Cell.Empty ? fallbackColor(id) : 0);
    return { id, color };
  }

  private updateHover(e: MouseEvent): void {
    const hover = this.hoverEl;
    if (!hover) return;
    const { w, h } = this.gridDims();
    const rect = this.canvas.getBoundingClientRect();
    const gx = Math.floor((e.clientX - rect.left) / this.zoom);
    const gy = Math.floor((e.clientY - rect.top) / this.zoom);
    if (gx < 0 || gy < 0 || gx >= w || gy >= h) { hover.hidden = true; return; }
    const info = this.cellInfoAt(gx, gy);
    if (!info) { hover.hidden = true; return; }
    const mat = MATERIAL_PARAMS[info.id];
    const name = info.id === PIXEL_SCENE_BIOME_FILL ? 'Biome Fill (rock)'
      : info.id === Cell.Empty ? 'Empty'
      : mat?.name ?? `cell #${info.id}`;
    const c = info.color;
    hover.innerHTML = `<b>${escapeHtml(name)}</b> <span class="pse-hover-id">#${info.id}</span><br>`
      + `(${gx}, ${gy}) · rgb ${unpackR(c)},${unpackG(c)},${unpackB(c)}<br>`
      + `bloom ${mat?.bloomWeight ?? 0} · ${isConductor(info.id) ? 'conductor' : 'insulator'}`;
    // Position near the cursor, inside the wrap.
    const wrap = this.el('.pse-canvas-wrap').getBoundingClientRect();
    hover.style.left = `${Math.min(e.clientX - wrap.left + 12, wrap.width - 150)}px`;
    hover.style.top = `${Math.max(4, e.clientY - wrap.top - 8)}px`;
    hover.hidden = false;
  }

  private renderWarns(): void {
    this.el('#pse-save').classList.toggle('pse-dirty', this.dirty); // unsaved-changes cue
    const ul = this.el('#pse-warns');
    const warns = validatePixelScene(this.scene);
    ul.innerHTML = warns.length
      ? warns.map((w) => `<li class="pse-warn pse-warn-${w.severity}">${escapeHtml(w.message)}</li>`).join('')
      : '<li class="pse-warn pse-warn-ok">No issues</li>';
  }

  private flash(msg: string, isError: boolean): void {
    const ul = this.el('#pse-warns');
    const li = document.createElement('li');
    li.className = `pse-warn ${isError ? 'pse-warn-error' : 'pse-warn-ok'}`;
    li.textContent = msg;
    ul.prepend(li);
  }
}

// ---- pure helpers ---------------------------------------------------------
/** Find a cave floor near the chunk centre to sit the scene on, so the preview
 *  shows it grounded in terrain instead of floating. Returns local chunk coords for
 *  the scene's top-left (its bottom row lands on the floor surface). */
function findScenePlacement(chunk: VirtualChunk, w: number, h: number): { x: number; y: number } {
  const size = chunk.size;
  const cx = Math.floor(size / 2);
  for (const col of [cx, cx - 12, cx + 12, cx - 24, cx + 24, cx - 40, cx + 40]) {
    if (col < 2 || col >= size - 2) continue;
    for (let y = Math.floor(size * 0.3); y < size - 4; y++) {
      const here = chunk.types[col + y * size];
      const below = chunk.types[col + (y + 1) * size];
      const above = chunk.types[col + (y - 1) * size];
      if (here === Cell.Empty && below !== Cell.Empty && above === Cell.Empty) {
        const x = Math.max(1, Math.min(size - w - 1, col - Math.floor(w / 2)));
        const yy = Math.max(1, Math.min(size - h - 1, y - h + 1)); // bottom row at the floor
        return { x, y: yy };
      }
    }
  }
  return { x: Math.max(1, Math.floor(size / 2 - w / 2)), y: Math.max(1, Math.floor(size / 2 - h / 2)) };
}

function blankScene(id: string, name: string, w: number, h: number): PixelSceneDef {
  return {
    v: 1, id, name, w, h,
    material: new Uint8Array(w * h),
    mask: new Uint8Array(w * h),
    colorOverrides: new Uint32Array(w * h),
    objects: [], links: [], lights: [],
  };
}

/** Deep-clone a scene into an editable form: always has mask + colorOverrides so
 *  painting is uniform (built-in scenes may omit them). */
function cloneForEdit(src: PixelSceneDef): PixelSceneDef {
  const n = src.w * src.h;
  const material = Uint8Array.from(src.material.subarray(0, n));
  const mask = src.mask ? Uint8Array.from(src.mask.subarray(0, n)) : material.map((t) => (t !== Cell.Empty ? 1 : 0));
  const colorOverrides = new Uint32Array(n);
  for (let i = 0; i < n; i++) colorOverrides[i] = src.colorOverrides?.[i] ?? (material[i] !== Cell.Empty ? fallbackColor(material[i]) : 0);
  return {
    v: 1, id: src.id, name: src.name, kind: src.kind, tags: src.tags ? [...src.tags] : undefined,
    w: src.w, h: src.h, material, mask, colorOverrides,
    life: src.life ? Int16Array.from(src.life.subarray(0, n)) : undefined,
    charge: src.charge ? Uint8Array.from(src.charge.subarray(0, n)) : undefined,
    objects: (src.objects ?? []).map((o) => ({ ...o, params: { ...o.params } })),
    links: (src.links ?? []).map((l) => ({ ...l })),
    lights: (src.lights ?? []).map((l) => ({ ...l })),
  };
}

function resizeScene(src: PixelSceneDef, w: number, h: number): PixelSceneDef {
  const out = blankScene(src.id, src.name, w, h);
  out.kind = src.kind;
  out.tags = src.tags ? [...src.tags] : undefined;
  out.objects = (src.objects ?? []).filter((o) => o.x < w && o.y < h).map((o) => ({ ...o, params: { ...o.params } }));
  out.lights = (src.lights ?? []).filter((l) => l.x < w && l.y < h).map((l) => ({ ...l }));
  const cw = Math.min(w, src.w);
  const ch = Math.min(h, src.h);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = x + y * src.w;
      const di = x + y * w;
      out.material[di] = src.material[si];
      out.mask![di] = src.mask ? src.mask[si] : (src.material[si] !== Cell.Empty ? 1 : 0);
      out.colorOverrides![di] = src.colorOverrides?.[si] ?? (src.material[si] !== Cell.Empty ? fallbackColor(src.material[si]) : 0);
    }
  }
  return out;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));
}
function hex(c: number): string { return '#' + (c & 0xffffff).toString(16).padStart(6, '0'); }
function hexToRgb(s: string): [number, number, number] {
  let h = s.replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const style = document.createElement('style');
  style.id = 'pse-style';
  style.textContent = `
.pse-overlay{position:fixed;inset:0;z-index:5900;display:flex;align-items:center;justify-content:center;background:rgba(4,5,9,.78);font-family:inherit}
.pse-overlay[hidden]{display:none}
.pse-shell{width:min(96vw,1240px);height:min(92vh,820px);display:flex;flex-direction:column;background:#14151b;
  border:1px solid #2a2c36;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.6);color:#cdd0d8;overflow:hidden}
.pse-header{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#1b1d25;border-bottom:1px solid #2a2c36}
.pse-title{font-weight:700;letter-spacing:.06em;font-size:12px;color:#9fa3b0}
.pse-spacer{flex:1}
.pse-name{background:#0e0f14;border:1px solid #2f323d;color:#e7e9f0;border-radius:4px;padding:3px 7px;font-size:13px;width:200px}
.pse-header button{background:#262932;border:1px solid #353846;color:#cdd0d8;border-radius:4px;padding:3px 9px;cursor:pointer;font-size:11px;letter-spacing:.03em}
.pse-header button:hover{background:#323645}
.pse-header .pse-primary{background:#2d6a3f;border-color:#3a8a52}
.pse-header .pse-primary:hover{background:#357a49}
.pse-header .pse-primary.pse-dirty{box-shadow:0 0 0 2px #5ad07a;background:#357a49}
.pse-header .active{background:#3a4a7a;border-color:#4a5aa0}
.pse-close{font-size:13px}
.pse-body{flex:1;display:flex;min-height:0}
.pse-col{display:flex;flex-direction:column;background:#16171e;overflow-y:auto}
.pse-scenes{width:180px;border-right:1px solid #2a2c36;padding:6px}
.pse-tools{width:248px;border-left:1px solid #2a2c36;padding:8px}
.pse-sub{font-size:10px;letter-spacing:.08em;color:#6d7180;text-transform:uppercase;margin:8px 2px 4px}
.pse-sub:first-child{margin-top:0}
.pse-list{display:flex;flex-direction:column;gap:1px}
.pse-empty{font-size:10px;color:#5a5e6b;padding:4px}
.pse-scene-row{display:flex;justify-content:space-between;gap:4px;background:transparent;border:0;color:#bcbfc8;text-align:left;
  padding:3px 5px;border-radius:3px;cursor:pointer;font-size:11px}
.pse-scene-row:hover{background:#21232c}
.pse-scene-row.selected{background:#2e2350;box-shadow:inset 2px 0 0 #7a5ad0}
.pse-scene-row.user .pse-scene-name{color:#cfe6cf}
.pse-scene-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pse-scene-kind{opacity:.5;font-size:.85em}
.pse-canvas-wrap{position:relative;flex:1;display:flex;align-items:center;justify-content:center;background:#0c0d12;min-width:0;overflow:auto}
.pse-canvas{image-rendering:pixelated;cursor:crosshair;background:#0b0b0f;box-shadow:0 0 0 1px #2a2c36}
.pse-canvas.pse-tile-mode{cursor:default}
.pse-hover{position:absolute;z-index:3;pointer-events:none;font:11px ui-monospace,monospace;color:#cfe6ff;
  background:rgba(8,10,16,.9);border:1px solid #2a3550;border-radius:4px;padding:4px 7px;line-height:1.45;white-space:nowrap}
.pse-hover[hidden]{display:none}
.pse-hover .pse-hover-id{opacity:.55}
.pse-palette{display:grid;grid-template-columns:1fr 1fr;gap:2px}
.pse-swatch{display:flex;align-items:center;gap:4px;background:#1d1f27;border:1px solid #2a2c36;color:#cdd0d8;border-radius:3px;
  padding:2px 4px;cursor:pointer;font-size:10px}
.pse-swatch:hover{background:#262933}
.pse-swatch.active{border-color:#7a5ad0;background:#2a2350}
.pse-dot{width:10px;height:10px;border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
.pse-toolrow{display:grid;grid-template-columns:1fr 1fr;gap:2px}
.pse-toolrow button{background:#1d1f27;border:1px solid #2a2c36;color:#cdd0d8;border-radius:3px;padding:3px;cursor:pointer;font-size:11px}
.pse-toolrow button:hover{background:#262933}
.pse-toolrow button.active{border-color:#4a5aa0;background:#2a3155}
.pse-field{display:flex;align-items:center;gap:5px;font-size:11px;color:#9fa3b0;margin:4px 0}
.pse-field b{color:#cdd0d8;min-width:14px;text-align:center}
.pse-field select,.pse-field input[type=text]{flex:1;background:#0e0f14;border:1px solid #2f323d;color:#e7e9f0;border-radius:3px;padding:2px 5px;font-size:11px}
.pse-field input[type=range]{flex:1}
.pse-num{width:48px;background:#0e0f14;border:1px solid #2f323d;color:#e7e9f0;border-radius:3px;padding:2px 4px;font-size:11px}
.pse-field button{background:#262932;border:1px solid #353846;color:#cdd0d8;border-radius:3px;padding:2px 7px;cursor:pointer;font-size:11px}
.pse-warns{list-style:none;margin:2px 0;padding:0;display:flex;flex-direction:column;gap:2px}
.pse-warn{padding:3px 6px;border-radius:3px;font-size:10.5px;line-height:1.3}
.pse-warn-ok{background:rgba(40,120,40,.16);color:#8fce8f}
.pse-warn-warn{background:rgba(190,140,20,.16);color:#d8b56a}
.pse-warn-error{background:rgba(180,40,40,.18);color:#e89090}
.pse-danger{margin-top:10px;background:#3a1f24;border:1px solid #5a2a30;color:#e8a0a0;border-radius:4px;padding:4px;cursor:pointer;font-size:11px}
.pse-danger:hover{background:#4a262c}
`;
  document.head.appendChild(style);
}

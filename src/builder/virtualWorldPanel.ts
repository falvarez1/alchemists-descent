import { LEVELS } from '@/config/worldgraph';
import { randomSeed } from '@/core/rng';
import type { LevelDef } from '@/core/types';
import { builderPanelTitle } from '@/ui/editor/PanelRegistry';
import {
  createDefaultVirtualWorldDef,
  TsWorkerBackend,
  WasmBackend,
  WebGpuPreviewBackend,
} from '@/world/virtual';
import type {
  BackendInfo,
  GenerateWindowResult,
  TransferableVirtualChunk,
  VirtualWorldDef,
} from '@/world/virtual';

type VirtualWorldProfileId = 'global' | string;
type VirtualWorldStatus = 'idle' | 'generating' | 'ready' | 'stale' | 'canceled' | 'error';

interface CachedPreviewChunk {
  chunk: TransferableVirtualChunk;
  canvas: HTMLCanvasElement;
  bytes: number;
  lastUsed: number;
}

export interface VirtualWorldPanelHooks {
  getBaseSeed(): number;
  onClose(): void;
}

const ZOOM_MIN = 0.08;
const ZOOM_MAX = 2.5;
const MAX_PREVIEW_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_PREVIEW_CHUNKS_PER_PROFILE = 128;

export class VirtualWorldPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly profiles = levelEntries();
  private readonly defs = new Map<VirtualWorldProfileId, VirtualWorldDef>();
  private readonly chunks = new Map<string, CachedPreviewChunk>();
  private readonly backend = new TsWorkerBackend();
  private readonly backendInfos: BackendInfo[];
  private backendInitialized = false;
  private selectedProfile: VirtualWorldProfileId = 'global';
  private selectedBackend = 'ts-worker';
  private status: VirtualWorldStatus = 'idle';
  private statusText = 'Ready';
  private activeJobId = 0;
  private jobSeq = 0;
  private radius = 1;
  private zoom = 0.45;
  private camX = 0;
  private camY = 260;
  private autoFill = true;
  private showGrid = true;
  private showBiomes = true;
  private showScenes = true;
  private showCost = false;
  private raf = 0;
  private lastAutoCenter = '';
  private hoverWorld: { x: number; y: number } | null = null;
  private drag: { pointerId: number; x: number; y: number } | null = null;
  private lastMetrics: GenerateWindowResult['metrics'] | null = null;
  private cacheTick = 0;

  constructor(private readonly host: HTMLElement, private readonly hooks: VirtualWorldPanelHooks) {
    this.backendInfos = [
      this.backend.info,
      new WebGpuPreviewBackend().info,
      new WasmBackend().info,
    ];
    this.host.innerHTML = this.renderShell();
    this.canvas = this.must<HTMLCanvasElement>('#vw-canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('missing virtual world preview canvas context');
    this.ctx = ctx;
    this.wire();
    this.renderControls();
    this.requestDraw();
  }

  refresh(): void {
    this.renderControls();
    this.requestDraw();
  }

  cancel(): void {
    if (this.activeJobId > 0) {
      this.backend.cancel(this.activeJobId);
      this.activeJobId = 0;
    }
    if (this.status === 'generating') {
      this.status = 'canceled';
      this.statusText = 'Canceled';
      this.renderControls();
    }
  }

  dispose(): void {
    this.cancel();
    this.backend.dispose();
    cancelAnimationFrame(this.raf);
  }

  private renderShell(): string {
    return `
      <div class="bi-head vw-head" data-panel-handle>
        <span>${builderPanelTitle('builder-virtual-world').toUpperCase()}</span>
        <button id="vw-close" type="button" class="b-close" aria-label="Close world map">&times;</button>
      </div>
      <div class="vw-body">
        <aside class="vw-controls" id="vw-controls"></aside>
        <div class="vw-stage" id="vw-stage" tabindex="0" aria-label="Virtual world map preview">
          <canvas id="vw-canvas"></canvas>
          <div class="vw-caption" id="vw-caption">READY</div>
        </div>
        <aside class="vw-inspector" id="vw-inspector"></aside>
      </div>`;
  }

  private renderControls(): void {
    const def = this.currentDef();
    const controls = this.must<HTMLElement>('#vw-controls');
    controls.innerHTML = `
      <section class="vw-section">
        <div class="vw-title">World</div>
        <label class="vw-field"><span>profile</span><select id="vw-profile">
          <option value="global">Global prototype</option>
          ${this.profiles.map((level) => `<option value="${level.id}">${profileLabel(level)}</option>`).join('')}
        </select></label>
        <label class="vw-field vw-seed"><span>seed</span><input id="vw-seed" type="number" min="0" max="4294967295" step="1"><button id="vw-reroll" type="button">ROLL</button></label>
        <label class="vw-field"><span>backend</span><select id="vw-backend">
          ${this.backendInfos.map((info) => `<option value="${info.kind}"${info.kind !== 'ts-worker' ? ' disabled' : ''}>${info.label}${info.available ? '' : ' unavailable'}${info.authoritativeCells ? '' : ' preview'}</option>`).join('')}
        </select></label>
      </section>
      <section class="vw-section">
        <div class="vw-title">Preview</div>
        <label class="vw-field"><span>window</span><select id="vw-radius">
          <option value="1">3 x 3 chunks</option>
          <option value="2">5 x 5 chunks</option>
          <option value="3">7 x 7 chunks</option>
        </select></label>
        <label class="vw-check"><input id="vw-auto" type="checkbox"> Auto-fill while panning</label>
        <label class="vw-check"><input id="vw-grid" type="checkbox"> Chunk grid</label>
        <label class="vw-check"><input id="vw-biomes" type="checkbox"> Biome labels</label>
        <label class="vw-check"><input id="vw-scenes" type="checkbox"> Scene markers</label>
        <label class="vw-check"><input id="vw-cost" type="checkbox"> Cost heatmap</label>
      </section>
      <section class="vw-section">
        <div class="vw-title">Generation</div>
        ${this.sliderHtml('halo', 'halo', def.generation.halo, 0, 64, 1)}
        ${this.sliderHtml('smooth', 'smooth', def.generation.smoothingPasses, 0, 3, 1)}
        ${this.sliderHtml('edge-roughness', 'edge roughness', def.generation.edgeRoughness, 0, 1, 0.01)}
        ${this.sliderHtml('pocket-density', 'pockets', def.generation.pocketDensity, 0, 1, 0.01)}
        ${this.sliderHtml('crack-density', 'cracks', def.generation.crackDensity, 0, 1, 0.01)}
        ${this.sliderHtml('noise-scale', 'noise scale', def.generation.noiseScale, 0.008, 0.08, 0.001)}
        ${this.sliderHtml('noise-threshold', 'threshold', def.generation.noiseThreshold, 0.38, 0.72, 0.005)}
        ${this.sliderHtml('border-seal', 'border seal', def.generation.borderSeal, 0, 8, 1)}
      </section>
      <section class="vw-section">
        <div class="vw-title">Actions</div>
        <div class="vw-actions">
          <button id="vw-generate" type="button">GENERATE</button>
          <button id="vw-frame" type="button">FRAME</button>
          <button id="vw-cancel" type="button" title="Cancel is only available while a window is generating"${this.status === 'generating' ? '' : ' disabled'}>CANCEL</button>
          <button id="vw-clear" type="button">CLEAR CACHE</button>
          <button id="vw-validate" type="button">VALIDATE</button>
          <button id="vw-materialize" type="button" title="Materialize is not available yet — disabled until fixed-world crop mapping is implemented" disabled>MATERIALIZE</button>
        </div>
      </section>`;
    this.must<HTMLSelectElement>('#vw-profile').value = this.selectedProfile;
    this.must<HTMLInputElement>('#vw-seed').value = String(def.seed >>> 0);
    this.must<HTMLSelectElement>('#vw-backend').value = this.selectedBackend;
    this.must<HTMLSelectElement>('#vw-radius').value = String(this.radius);
    this.must<HTMLInputElement>('#vw-auto').checked = this.autoFill;
    this.must<HTMLInputElement>('#vw-grid').checked = this.showGrid;
    this.must<HTMLInputElement>('#vw-biomes').checked = this.showBiomes;
    this.must<HTMLInputElement>('#vw-scenes').checked = this.showScenes;
    this.must<HTMLInputElement>('#vw-cost').checked = this.showCost;
    this.syncSliderValues(def);
    this.wireControls();
    this.renderInspector();
  }

  private sliderHtml(id: string, label: string, value: number, min: number, max: number, step: number): string {
    return `<div class="vw-slider" data-vw-slider="${id}">
      <div class="vw-slider-label"><span>${label}</span><b>${this.formatNumber(value)}</b></div>
      <div class="vw-slider-inputs">
        <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-vw-range="${id}">
        <input type="number" min="${min}" max="${max}" step="${step}" value="${value}" data-vw-number="${id}">
      </div>
    </div>`;
  }

  private wire(): void {
    this.must<HTMLButtonElement>('#vw-close').addEventListener('click', () => this.hooks.onClose());
    const stage = this.must<HTMLElement>('#vw-stage');
    stage.addEventListener('pointerdown', (event) => this.beginDrag(event));
    stage.addEventListener('pointermove', (event) => this.movePointer(event));
    stage.addEventListener('pointerup', (event) => this.endDrag(event));
    stage.addEventListener('pointercancel', (event) => this.endDrag(event));
    stage.addEventListener('wheel', (event) => this.zoomWheel(event), { passive: false });
    stage.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  private wireControls(): void {
    this.must<HTMLSelectElement>('#vw-profile').addEventListener('change', (event) => {
      this.cancel();
      this.selectedProfile = (event.currentTarget as HTMLSelectElement).value;
      this.renderControls();
      this.requestDraw();
      if (this.autoFill) void this.generateWindow();
    });
    this.must<HTMLInputElement>('#vw-seed').addEventListener('change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const next = Number(input.value);
      if (Number.isFinite(next)) this.mutateDef((def) => { def.seed = next >>> 0; });
      input.value = String(this.currentDef().seed >>> 0);
    });
    this.must<HTMLButtonElement>('#vw-reroll').addEventListener('click', () => {
      this.mutateDef((def) => { def.seed = randomSeed(); });
      this.renderControls();
    });
    this.must<HTMLSelectElement>('#vw-backend').addEventListener('change', (event) => {
      this.selectedBackend = (event.currentTarget as HTMLSelectElement).value;
      if (this.selectedBackend !== 'ts-worker') this.statusText = 'Only TypeScript Worker is implemented for authoritative chunks';
      this.renderControls();
    });
    this.must<HTMLSelectElement>('#vw-radius').addEventListener('change', (event) => {
      this.radius = Number((event.currentTarget as HTMLSelectElement).value) || 1;
      this.lastAutoCenter = '';
      this.requestDraw();
      if (this.autoFill) void this.generateWindow();
    });
    this.must<HTMLInputElement>('#vw-auto').addEventListener('change', (event) => {
      this.autoFill = (event.currentTarget as HTMLInputElement).checked;
      if (this.autoFill) void this.generateWindow();
    });
    this.must<HTMLInputElement>('#vw-grid').addEventListener('change', (event) => {
      this.showGrid = (event.currentTarget as HTMLInputElement).checked;
      this.requestDraw();
    });
    this.must<HTMLInputElement>('#vw-biomes').addEventListener('change', (event) => {
      this.showBiomes = (event.currentTarget as HTMLInputElement).checked;
      this.requestDraw();
    });
    this.must<HTMLInputElement>('#vw-scenes').addEventListener('change', (event) => {
      this.showScenes = (event.currentTarget as HTMLInputElement).checked;
      this.requestDraw();
    });
    this.must<HTMLInputElement>('#vw-cost').addEventListener('change', (event) => {
      this.showCost = (event.currentTarget as HTMLInputElement).checked;
      this.requestDraw();
    });
    this.must<HTMLButtonElement>('#vw-generate').addEventListener('click', () => void this.generateWindow());
    this.must<HTMLButtonElement>('#vw-frame').addEventListener('click', () => this.frameCachedChunks());
    this.must<HTMLButtonElement>('#vw-cancel').addEventListener('click', () => this.cancel());
    this.must<HTMLButtonElement>('#vw-clear').addEventListener('click', () => {
      this.chunks.clear();
      this.lastMetrics = null;
      this.status = 'idle';
      this.statusText = 'Cache cleared';
      this.lastAutoCenter = '';
      this.renderControls();
      this.requestDraw();
    });
    this.must<HTMLButtonElement>('#vw-validate').addEventListener('click', () => this.validateCachedWindow());
    for (const input of this.host.querySelectorAll<HTMLInputElement>('[data-vw-range], [data-vw-number]')) {
      input.addEventListener(input.type === 'range' ? 'input' : 'change', () => this.applySlider(input));
    }
  }

  private syncSliderValues(def: VirtualWorldDef): void {
    const values: Record<string, number> = {
      halo: def.generation.halo,
      smooth: def.generation.smoothingPasses,
      'edge-roughness': def.generation.edgeRoughness,
      'pocket-density': def.generation.pocketDensity,
      'crack-density': def.generation.crackDensity,
      'noise-scale': def.generation.noiseScale,
      'noise-threshold': def.generation.noiseThreshold,
      'border-seal': def.generation.borderSeal,
    };
    for (const [id, value] of Object.entries(values)) {
      const range = this.host.querySelector<HTMLInputElement>(`[data-vw-range="${id}"]`);
      const number = this.host.querySelector<HTMLInputElement>(`[data-vw-number="${id}"]`);
      const label = this.host.querySelector<HTMLElement>(`[data-vw-slider="${id}"] b`);
      if (range) range.value = String(value);
      if (number) number.value = String(value);
      if (label) label.textContent = this.formatNumber(value);
    }
  }

  private applySlider(input: HTMLInputElement): void {
    const id = input.dataset.vwRange ?? input.dataset.vwNumber;
    if (!id) return;
    const next = Number(input.value);
    if (!Number.isFinite(next)) return;
    this.mutateDef((def) => {
      if (id === 'halo') def.generation.halo = Math.round(next);
      else if (id === 'smooth') def.generation.smoothingPasses = Math.round(next);
      else if (id === 'edge-roughness') def.generation.edgeRoughness = next;
      else if (id === 'pocket-density') def.generation.pocketDensity = next;
      else if (id === 'crack-density') def.generation.crackDensity = next;
      else if (id === 'noise-scale') def.generation.noiseScale = next;
      else if (id === 'noise-threshold') def.generation.noiseThreshold = next;
      else if (id === 'border-seal') def.generation.borderSeal = Math.round(next);
    });
    this.syncSliderValues(this.currentDef());
  }

  private mutateDef(mutator: (def: VirtualWorldDef) => void): void {
    this.cancel();
    mutator(this.currentDef());
    this.chunks.clear();
    this.status = 'stale';
    this.statusText = 'Settings changed - regenerate';
    this.lastMetrics = null;
    this.lastAutoCenter = '';
    this.requestDraw();
    this.renderInspector();
  }

  private async generateWindow(): Promise<void> {
    if (this.selectedBackend !== 'ts-worker') {
      this.status = 'error';
      this.statusText = 'Selected backend is not implemented yet';
      this.renderControls();
      return;
    }
    if (!this.backend.info.available) {
      this.status = 'error';
      this.statusText = 'Web Workers are unavailable in this browser';
      this.renderControls();
      return;
    }
    const def = this.currentDef();
    const profile = this.selectedProfile;
    const centerCx = Math.floor(this.camX / def.chunkSize);
    const centerCy = Math.floor(this.camY / def.chunkSize);
    const jobId = ++this.jobSeq;
    this.activeJobId = jobId;
    this.status = 'generating';
    this.statusText = `Generating ${this.windowChunkCount()} chunks around ${centerCx},${centerCy}`;
    this.renderControls();
    try {
      if (this.backendInitialized) await this.backend.updateDef(def);
      else {
        await this.backend.init(def);
        this.backendInitialized = true;
      }
      const started = performance.now();
      const result = await this.backend.generateWindow({
        jobId,
        cx0: centerCx - this.radius,
        cy0: centerCy - this.radius,
        cx1: centerCx + this.radius,
        cy1: centerCy + this.radius,
        centerCx,
        centerCy,
        requestedPlanes: ['previewRgba'],
      });
      if (this.activeJobId !== jobId || this.selectedProfile !== profile) return;
      for (const chunk of result.chunks) this.cacheChunk(profile, chunk);
      this.lastMetrics = {
        ...result.metrics,
        generatedMs: performance.now() - started,
      };
      this.status = 'ready';
      this.statusText = `Generated ${result.chunks.length} chunks`;
      this.activeJobId = 0;
      this.lastAutoCenter = this.autoCenterKey();
      this.renderControls();
      this.requestDraw();
    } catch (error) {
      if (this.activeJobId !== jobId) return;
      this.activeJobId = 0;
      this.status = 'error';
      this.statusText = error instanceof Error ? error.message : String(error);
      this.renderControls();
      this.requestDraw();
    }
  }

  private cacheChunk(profile: VirtualWorldProfileId, chunk: TransferableVirtualChunk): void {
    if (!chunk.previewRgba) return;
    const canvas = document.createElement('canvas');
    canvas.width = chunk.size;
    canvas.height = chunk.size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rgba = new Uint8ClampedArray(chunk.previewRgba.byteLength);
    rgba.set(new Uint8ClampedArray(chunk.previewRgba));
    ctx.putImageData(new ImageData(rgba, chunk.size, chunk.size), 0, 0);
    this.chunks.set(this.chunkKeyFor(profile, chunk.cx, chunk.cy), {
      chunk,
      canvas,
      bytes: chunk.previewRgba.byteLength,
      lastUsed: ++this.cacheTick,
    });
    this.evictPreviewCache(profile);
  }

  private frameCachedChunks(): void {
    const active = this.activeChunks();
    if (active.length === 0) {
      this.camX = 0;
      this.camY = this.currentDef().chunkSize;
      this.zoom = 0.45;
      this.requestDraw();
      return;
    }
    const minX = Math.min(...active.map((entry) => entry.chunk.originX));
    const minY = Math.min(...active.map((entry) => entry.chunk.originY));
    const maxX = Math.max(...active.map((entry) => entry.chunk.originX + entry.chunk.size));
    const maxY = Math.max(...active.map((entry) => entry.chunk.originY + entry.chunk.size));
    this.camX = (minX + maxX) / 2;
    this.camY = (minY + maxY) / 2;
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.height);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(width / (maxX - minX), height / (maxY - minY)) * 0.88));
    this.requestDraw();
  }

  private validateCachedWindow(): void {
    const active = this.activeChunks();
    if (active.length === 0) {
      this.status = 'error';
      this.statusText = 'Generate a window before validation';
    } else {
      const missingPreview = active.filter((entry) => !entry.chunk.previewRgba).length;
      this.status = missingPreview === 0 ? 'ready' : 'error';
      this.statusText = missingPreview === 0 ? `Validated ${active.length} cached preview chunks` : `${missingPreview} chunks missing preview buffers`;
    }
    this.renderControls();
  }

  private beginDrag(event: PointerEvent): void {
    const stage = this.must<HTMLElement>('#vw-stage');
    stage.focus();
    stage.setPointerCapture(event.pointerId);
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  private movePointer(event: PointerEvent): void {
    this.hoverWorld = this.screenToWorld(event.offsetX, event.offsetY);
    if (this.drag?.pointerId === event.pointerId) {
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      this.camX -= dx / this.zoom;
      this.camY -= dy / this.zoom;
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.afterPan();
    } else {
      this.renderInspector();
      this.requestDraw();
    }
  }

  private endDrag(event: PointerEvent): void {
    if (this.drag?.pointerId !== event.pointerId) return;
    this.drag = null;
    this.maybeAutoGenerate();
  }

  private zoomWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const before = this.screenToWorld(sx, sy);
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.camX += before.x - after.x;
    this.camY += before.y - after.y;
    this.afterPan();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const step = (event.shiftKey ? 160 : 64) / this.zoom;
    if (event.key === 'a' || event.key === 'A') this.camX -= step;
    else if (event.key === 'd' || event.key === 'D') this.camX += step;
    else if (event.key === 'w' || event.key === 'W') this.camY -= step;
    else if (event.key === 's' || event.key === 'S') this.camY += step;
    else return;
    event.preventDefault();
    this.afterPan();
    this.maybeAutoGenerate();
  }

  private afterPan(): void {
    this.renderInspector();
    this.requestDraw();
    this.maybeAutoGenerate();
  }

  private maybeAutoGenerate(): void {
    if (!this.autoFill || this.status === 'generating') return;
    const key = this.autoCenterKey();
    if (key === this.lastAutoCenter) return;
    if (this.windowFullyCached()) {
      this.lastAutoCenter = key;
      return;
    }
    this.lastAutoCenter = key;
    window.setTimeout(() => {
      if (this.autoFill && this.autoCenterKey() === key && this.status !== 'generating' && !this.windowFullyCached()) {
        void this.generateWindow();
      }
    }, 90);
  }

  private requestDraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private draw(): void {
    this.resizeCanvas();
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.fillStyle = '#05070b';
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.imageSmoothingEnabled = false;
    const viewLeft = this.camX - w / (2 * this.zoom);
    const viewTop = this.camY - h / (2 * this.zoom);
    for (const entry of this.visibleChunks(viewLeft, viewTop, w, h)) {
      const chunk = entry.chunk;
      const sx = (chunk.originX - viewLeft) * this.zoom;
      const sy = (chunk.originY - viewTop) * this.zoom;
      const size = chunk.size * this.zoom;
      this.ctx.drawImage(entry.canvas, sx, sy, size, size);
      if (this.showCost) this.drawCostOverlay(entry, sx, sy, size);
      if (this.showScenes && chunk.meta.scenes.length > 0) this.drawSceneMarker(chunk, sx, sy, size);
      if (this.showBiomes && size > 44) this.drawChunkLabel(chunk, sx, sy);
    }
    if (this.showGrid) this.drawGrid(viewLeft, viewTop, w, h);
    this.drawCenterCross(w, h);
    this.drawHover(w, h);
    this.updateCaption();
  }

  private drawGrid(viewLeft: number, viewTop: number, w: number, h: number): void {
    const size = this.currentDef().chunkSize;
    const x0 = Math.floor(viewLeft / size) * size;
    const y0 = Math.floor(viewTop / size) * size;
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(125, 211, 252, 0.25)';
    this.ctx.lineWidth = 1;
    for (let x = x0; x < viewLeft + w / this.zoom; x += size) {
      const sx = Math.round((x - viewLeft) * this.zoom) + 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(sx, 0);
      this.ctx.lineTo(sx, h);
      this.ctx.stroke();
    }
    for (let y = y0; y < viewTop + h / this.zoom; y += size) {
      const sy = Math.round((y - viewTop) * this.zoom) + 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(0, sy);
      this.ctx.lineTo(w, sy);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawCostOverlay(entry: CachedPreviewChunk, sx: number, sy: number, size: number): void {
    const alpha = Math.max(0.04, Math.min(0.32, entry.chunk.metrics.generatedMs / 24));
    this.ctx.fillStyle = `rgba(248, 113, 113, ${alpha})`;
    this.ctx.fillRect(sx, sy, size, size);
  }

  private drawSceneMarker(_chunk: TransferableVirtualChunk, sx: number, sy: number, size: number): void {
    this.ctx.fillStyle = 'rgba(250, 204, 21, 0.78)';
    this.ctx.strokeStyle = 'rgba(30, 20, 0, 0.85)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.arc(sx + size - 12, sy + 12, 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
  }

  private drawChunkLabel(chunk: TransferableVirtualChunk, sx: number, sy: number): void {
    this.ctx.fillStyle = 'rgba(3, 6, 10, 0.72)';
    this.ctx.fillRect(sx + 5, sy + 5, 86, 28);
    this.ctx.fillStyle = '#b7c9dc';
    this.ctx.font = '10px monospace';
    this.ctx.fillText(`${chunk.cx},${chunk.cy}`, sx + 10, sy + 17);
    this.ctx.fillStyle = biomeColor(chunk.meta.biome);
    this.ctx.fillText(chunk.meta.biome.toUpperCase(), sx + 10, sy + 28);
  }

  private drawCenterCross(w: number, h: number): void {
    this.ctx.strokeStyle = 'rgba(74, 222, 128, 0.75)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(w / 2 - 8, h / 2);
    this.ctx.lineTo(w / 2 + 8, h / 2);
    this.ctx.moveTo(w / 2, h / 2 - 8);
    this.ctx.lineTo(w / 2, h / 2 + 8);
    this.ctx.stroke();
  }

  private drawHover(w: number, h: number): void {
    if (!this.hoverWorld) return;
    const chunk = this.chunkAt(this.hoverWorld.x, this.hoverWorld.y);
    if (!chunk) return;
    const viewLeft = this.camX - w / (2 * this.zoom);
    const viewTop = this.camY - h / (2 * this.zoom);
    this.ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(
      (chunk.originX - viewLeft) * this.zoom + 0.5,
      (chunk.originY - viewTop) * this.zoom + 0.5,
      chunk.size * this.zoom,
      chunk.size * this.zoom,
    );
  }

  private renderInspector(): void {
    const inspector = this.host.querySelector<HTMLElement>('#vw-inspector');
    if (!inspector) return;
    const hover = this.hoverWorld ? this.chunkAt(this.hoverWorld.x, this.hoverWorld.y) : null;
    const mem = this.previewBytes();
    inspector.innerHTML = `
      <section class="vw-section">
        <div class="vw-title">Status</div>
        <div class="vw-stat"><span>state</span><b class="vw-${this.status}">${this.status.toUpperCase()}</b></div>
        <div class="vw-message">${escapeHtml(this.statusText)}</div>
        <div class="vw-stat"><span>cache</span><b>${this.activeChunks().length} chunks</b></div>
        <div class="vw-stat"><span>memory</span><b>${formatBytes(mem)}</b></div>
        <div class="vw-stat"><span>zoom</span><b>${this.zoom.toFixed(2)}x</b></div>
        <div class="vw-stat"><span>center</span><b>${Math.floor(this.camX)}, ${Math.floor(this.camY)}</b></div>
      </section>
      <section class="vw-section">
        <div class="vw-title">Metrics</div>
        <div class="vw-stat"><span>window</span><b>${this.lastMetrics ? `${this.lastMetrics.chunks} chunks` : '-'}</b></div>
        <div class="vw-stat"><span>time</span><b>${this.lastMetrics ? `${this.lastMetrics.generatedMs.toFixed(1)} ms` : '-'}</b></div>
        <div class="vw-stat"><span>generated</span><b>${this.lastMetrics ? formatBytes(this.lastMetrics.generatedBytes) : '-'}</b></div>
        <div class="vw-stat"><span>transfer</span><b>${this.lastMetrics ? formatBytes(this.lastMetrics.transferBytes) : '-'}</b></div>
      </section>
      <section class="vw-section">
        <div class="vw-title">Chunk</div>
        ${
          hover
            ? `<div class="vw-stat"><span>coord</span><b>${hover.cx}, ${hover.cy}</b></div>
              <div class="vw-stat"><span>biome</span><b>${hover.meta.biome}</b></div>
              <div class="vw-stat"><span>time</span><b>${hover.metrics.generatedMs.toFixed(2)} ms</b></div>
              <div class="vw-stat"><span>hash</span><b>${hover.meta.hash}</b></div>
              <div class="vw-list"><span>tiles</span><p>${hover.meta.tileIds.map(escapeHtml).join(', ') || '-'}</p></div>
              <div class="vw-list"><span>scenes</span><p>${hover.meta.scenes.map(escapeHtml).join(', ') || '-'}</p></div>`
            : '<div class="vw-message">Move over a generated chunk.</div>'
        }
      </section>
      <section class="vw-section">
        <div class="vw-title">Next</div>
        <div class="vw-message">Materialize and Play From Here are disabled until fixed-world crop mapping is implemented.</div>
      </section>`;
  }

  private updateCaption(): void {
    const caption = this.must<HTMLElement>('#vw-caption');
    caption.textContent = `${this.status.toUpperCase()} | ${this.activeChunks().length} CACHED | WASD / DRAG TO PAN | WHEEL TO ZOOM`;
    this.renderInspector();
  }

  private resizeCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || this.canvas.clientWidth || 640));
    const height = Math.max(220, Math.floor(rect.height || this.canvas.clientHeight || 360));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const w = this.canvas.width || this.canvas.clientWidth || 1;
    const h = this.canvas.height || this.canvas.clientHeight || 1;
    return {
      x: this.camX + (sx - w / 2) / this.zoom,
      y: this.camY + (sy - h / 2) / this.zoom,
    };
  }

  private currentDef(): VirtualWorldDef {
    const existing = this.defs.get(this.selectedProfile);
    if (existing) return existing;
    const def = createDefaultVirtualWorldDef(this.profileSeed(this.selectedProfile));
    def.id = `virtual-${this.selectedProfile}`;
    def.name = this.selectedProfile === 'global' ? 'Global Virtual World' : `${LEVELS[this.selectedProfile]?.name ?? this.selectedProfile} Virtual World`;
    this.defs.set(this.selectedProfile, def);
    return def;
  }

  private profileSeed(profile: VirtualWorldProfileId): number {
    const base = this.hooks.getBaseSeed() >>> 0;
    if (profile === 'global') return base || 0x4e4f4954;
    let h = base ^ 0x9e3779b9;
    for (let i = 0; i < profile.length; i++) h = Math.imul(h ^ profile.charCodeAt(i), 0x85ebca6b);
    return h >>> 0;
  }

  private activeChunks(): CachedPreviewChunk[] {
    const prefix = `${this.selectedProfile}:`;
    return [...this.chunks.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value);
  }

  private visibleChunks(viewLeft: number, viewTop: number, w: number, h: number): CachedPreviewChunk[] {
    const viewRight = viewLeft + w / this.zoom;
    const viewBottom = viewTop + h / this.zoom;
    const visible: CachedPreviewChunk[] = [];
    for (const entry of this.activeChunks()) {
      const chunk = entry.chunk;
      if (
        chunk.originX > viewRight ||
        chunk.originY > viewBottom ||
        chunk.originX + chunk.size < viewLeft ||
        chunk.originY + chunk.size < viewTop
      ) {
        continue;
      }
      entry.lastUsed = ++this.cacheTick;
      visible.push(entry);
    }
    return visible;
  }

  private chunkAt(x: number, y: number): TransferableVirtualChunk | null {
    const size = this.currentDef().chunkSize;
    const cx = Math.floor(x / size);
    const cy = Math.floor(y / size);
    const entry = this.chunks.get(this.chunkKey(cx, cy));
    if (!entry) return null;
    entry.lastUsed = ++this.cacheTick;
    return entry.chunk;
  }

  private windowFullyCached(): boolean {
    const def = this.currentDef();
    const centerCx = Math.floor(this.camX / def.chunkSize);
    const centerCy = Math.floor(this.camY / def.chunkSize);
    for (let cy = centerCy - this.radius; cy <= centerCy + this.radius; cy++) {
      for (let cx = centerCx - this.radius; cx <= centerCx + this.radius; cx++) {
        if (!this.chunks.has(this.chunkKey(cx, cy))) return false;
      }
    }
    return true;
  }

  private windowChunkCount(): number {
    const side = this.radius * 2 + 1;
    return side * side;
  }

  private autoCenterKey(): string {
    const def = this.currentDef();
    return `${this.selectedProfile}:${Math.floor(this.camX / def.chunkSize)},${Math.floor(this.camY / def.chunkSize)}:${this.radius}:${def.seed}`;
  }

  private chunkKey(cx: number, cy: number): string {
    return this.chunkKeyFor(this.selectedProfile, cx, cy);
  }

  private chunkKeyFor(profile: VirtualWorldProfileId, cx: number, cy: number): string {
    return `${profile}:${cx},${cy}`;
  }

  private previewBytes(): number {
    let bytes = 0;
    for (const entry of this.activeChunks()) bytes += entry.bytes;
    return bytes;
  }

  private evictPreviewCache(profile: VirtualWorldProfileId): void {
    const profileEntries = [...this.chunks.entries()].filter(([key]) => key.startsWith(`${profile}:`));
    let profileBytes = profileEntries.reduce((sum, [, entry]) => sum + entry.bytes, 0);
    while (profileEntries.length > MAX_PREVIEW_CHUNKS_PER_PROFILE || profileBytes > MAX_PREVIEW_CACHE_BYTES) {
      profileEntries.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      const [key, entry] = profileEntries.shift()!;
      this.chunks.delete(key);
      profileBytes -= entry.bytes;
    }
  }

  private must<T extends Element>(selector: string): T {
    const el = this.host.querySelector<T>(selector);
    if (!el) throw new Error(`missing virtual world panel element ${selector}`);
    return el;
  }

  private formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }
}

function levelEntries(): LevelDef[] {
  return Object.values(LEVELS).sort((a, b) => {
    if (a.branch !== b.branch) return a.branch ? 1 : -1;
    return a.depth - b.depth;
  });
}

function profileLabel(level: LevelDef): string {
  return `${level.branch ? 'BR' : `D${level.depth}`} ${level.name}`;
}

function biomeColor(biome: string): string {
  if (biome === 'fungal') return '#86efac';
  if (biome === 'frozen') return '#93c5fd';
  return '#f7c076';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

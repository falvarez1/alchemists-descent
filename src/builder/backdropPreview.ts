import {
  BACKDROP_LAYER_SPECS,
  clampBackdropBrightness,
  clampBackdropContrast,
  clampBackdropExposure,
  clampBackdropGamma,
  clampBackdropOffset,
  clampBackdropOpacity,
  clampBackdropScale,
  clampBackdropSaturation,
  clampBackdropSpeed,
  cloneBackdropProfile,
  createDefaultBackdropProfile,
  resolveBackdropLayers,
  saveBackdropSettings,
  sanitizeBackdropSettings,
  setBackdropLevelOverride,
} from '@/config/backdrop';
import { VIEW_H, VIEW_W, WIDTH, HEIGHT } from '@/config/constants';
import { LEVELS } from '@/config/worldgraph';
import type {
  BackdropLayerId,
  BackdropLayerSettings,
  BackdropSettings,
  BackdropGradeSettings,
  Ctx,
  LevelDef,
} from '@/core/types';
import { Cell } from '@/sim/CellType';
import { unpackB, unpackG, unpackR } from '@/sim/colors';

type BackdropProfileId = 'global' | string;
type BackdropImageMap = Partial<Record<BackdropLayerId, HTMLImageElement>>;

export interface BackdropPreviewHooks {
  getSettings(): BackdropSettings;
  commitSettings(settings: BackdropSettings, playtestProfileId: string | null): void;
  getPlaytestProfileId?(): string | null;
}

function wrapOffset(value: number, size: number): number {
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

/** Narkowicz ACES filmic tonemap — matches THREE.ACESFilmicToneMapping (which
 *  pre-scales by 0.6 after the exposure multiply). Input/output in 0..1. */
function acesTonemap(x: number): number {
  const v = x * 0.6;
  const y = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
  return y <= 0 ? 0 : y >= 1 ? 1 : y;
}

/** Cheap deterministic per-pixel noise in 0..1 for the film-grain approximation. */
function hashNoise(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function levelEntries(): LevelDef[] {
  return Object.values(LEVELS).sort((a, b) => {
    if (a.branch !== b.branch) return a.branch ? 1 : -1;
    return a.depth - b.depth;
  });
}

function profileLabel(profileId: BackdropProfileId): string {
  if (profileId === 'global') return 'GLOBAL DEFAULT';
  return LEVELS[profileId]?.name ?? profileId.toUpperCase();
}

export class BackdropPreview {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly stage: CanvasRenderingContext2D;
  private readonly caption: HTMLDivElement;
  private readonly viewToggle: HTMLButtonElement;
  private readonly images: BackdropImageMap = {};
  private readonly keys = new Set<string>();
  private readonly terrainOverlay: ImageData;
  private readonly terrainCanvas: HTMLCanvasElement;
  private readonly terrainCtx: CanvasRenderingContext2D;
  private readonly backdropCanvas: HTMLCanvasElement;
  private readonly backdropCtx: CanvasRenderingContext2D;
  private readonly profiles = levelEntries();
  private raf = 0;
  private openState = false;
  private maximized = false;
  private camX = 0;
  private camY = 0;
  private dragging: { id: number; x: number; y: number } | null = null;
  private selectedProfile: BackdropProfileId = 'global';
  private levelOverrideEnabled = false;
  private appliedLevelOverrideEnabled = false;
  private draft = createDefaultBackdropProfile();
  private applied = createDefaultBackdropProfile();
  private dirty = false;
  private copyAllPending = false;
  private soloLayer: BackdropLayerId | null = null;
  private showTerrain = true;
  // Approximate the in-game color pipeline so the preview reads like gameplay:
  // TONEMAP = the always-on ACES rolloff + vignette; POST FX = exposure + grain.
  // (Dynamic per-cell lighting and bloom are NOT simulated — the live light field
  // isn't available in the Builder; see the note in applyInGameLook.)
  private showTonemap = true;
  private showPost = true;
  private followCamera = false;
  private zoom = 1;

  constructor(
    host: HTMLElement,
    private readonly ctx: Ctx,
    private readonly hooks?: BackdropPreviewHooks,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'builder-backdrop';
    this.root.tabIndex = -1;
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div class="bb-head">
        <div class="bb-title">BACKDROP</div>
        <div class="bb-active" id="bb-active-profile"></div>
        <div class="bb-coords" id="bb-coords"></div>
        <div class="bb-actions">
          <button id="bb-apply" type="button">APPLY</button>
          <button id="bb-revert" type="button">REVERT</button>
          <button id="bb-sync" type="button" title="Move preview to the live camera">CAMERA</button>
          <button id="bb-view-toggle" type="button" aria-label="Maximize backdrop preview" title="Maximize backdrop preview"></button>
          <button id="bb-close" type="button" aria-label="Close backdrop preview">&times;</button>
        </div>
      </div>
      <div class="bb-body">
        <div class="bb-profile-list" role="listbox" aria-label="Backdrop profiles">
          <div class="bb-section-title">PROFILES</div>
          <button class="bb-profile" data-profile="global" type="button" role="option" tabindex="-1" aria-selected="false">GLOBAL DEFAULT</button>
          ${this.profiles.map((level) => this.profileButton(level)).join('')}
        </div>
        <div class="bb-controls">
          <div class="bb-profile-tools">
            <label class="bb-override"><input id="bb-override" type="checkbox"> <span id="bb-override-label">LEVEL OVERRIDE</span></label>
            <div class="bb-tool-row">
              <button id="bb-reset-profile" type="button">RESET PROFILE</button>
              <button id="bb-copy-all" type="button">COPY TO ALL LEVELS</button>
            </div>
            <div class="bb-toggle-row">
              <button id="bb-follow" type="button">FOLLOW CAMERA</button>
              <button id="bb-terrain" type="button">TERRAIN</button>
              <button id="bb-fit" type="button">FIT</button>
              <button id="bb-tonemap" type="button" title="Approximate the in-game ACES tonemap + vignette">TONEMAP</button>
              <button id="bb-postfx" type="button" title="Approximate post FX (exposure + film grain)">POST FX</button>
            </div>
          </div>
          <section class="bb-grade">
            <div class="bb-section-title">COLOR</div>
            ${this.numberControl('exposure', '-3', '2', '0.01', 'data-bb-exposure', 'data-bb-exposure-num')}
            ${this.numberControl('brightness', '-0.5', '0.5', '0.005', 'data-bb-brightness', 'data-bb-brightness-num')}
            ${this.numberControl('contrast', '0.25', '2.5', '0.01', 'data-bb-contrast', 'data-bb-contrast-num')}
            ${this.numberControl('gamma', '0.35', '3', '0.01', 'data-bb-gamma', 'data-bb-gamma-num')}
            ${this.numberControl('saturation', '0', '2.5', '0.01', 'data-bb-saturation', 'data-bb-saturation-num')}
          </section>
          <div class="bb-layer-list">
            ${BACKDROP_LAYER_SPECS.map((spec) => this.layerRow(spec.id)).join('')}
          </div>
        </div>
        <div class="bb-stagewrap">
          <canvas id="bb-stage" width="${VIEW_W}" height="${VIEW_H}"></canvas>
          <div id="bb-caption">READY</div>
        </div>
      </div>`;
    host.appendChild(this.root);

    this.canvas = this.root.querySelector('#bb-stage') as HTMLCanvasElement;
    const stage = this.canvas.getContext('2d');
    if (!stage) throw new Error('missing backdrop preview canvas context');
    this.stage = stage;
    this.caption = this.root.querySelector('#bb-caption') as HTMLDivElement;
    this.viewToggle = this.root.querySelector('#bb-view-toggle') as HTMLButtonElement;
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = VIEW_W;
    this.terrainCanvas.height = VIEW_H;
    const terrainCtx = this.terrainCanvas.getContext('2d', { willReadFrequently: true });
    if (!terrainCtx) throw new Error('missing backdrop terrain canvas context');
    this.terrainCtx = terrainCtx;
    this.terrainOverlay = terrainCtx.createImageData(VIEW_W, VIEW_H);
    this.backdropCanvas = document.createElement('canvas');
    this.backdropCanvas.width = VIEW_W;
    this.backdropCanvas.height = VIEW_H;
    const backdropCtx = this.backdropCanvas.getContext('2d', { willReadFrequently: true });
    if (!backdropCtx) throw new Error('missing backdrop canvas context');
    this.backdropCtx = backdropCtx;

    this.loadImages();
    this.wire();
  }

  open(): void {
    this.camX = this.ctx.camera.x;
    this.camY = this.ctx.camera.y;
    const preferred =
      this.hooks?.getPlaytestProfileId?.() ??
      this.ctx.levels.current?.backdropLevelId ??
      this.ctx.levels.current?.def.id ??
      'global';
    this.selectedProfile = preferred === 'global' || LEVELS[preferred] ? preferred : 'global';
    this.loadSelectedProfile();
    this.root.style.display = 'flex';
    this.root.focus();
    this.openState = true;
    this.loop();
  }

  close(): void {
    this.openState = false;
    this.root.style.display = 'none';
    this.keys.clear();
    if (this.dragging !== null && this.canvas.hasPointerCapture(this.dragging.id)) {
      this.canvas.releasePointerCapture(this.dragging.id);
    }
    this.dragging = null;
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private profileButton(level: LevelDef): string {
    const label = level.branch ? level.name : `D${level.depth} ${level.name}`;
    return `<button class="bb-profile" data-profile="${level.id}" type="button" role="option" tabindex="-1" aria-selected="false">
      <span>${label}</span><small>${level.biome}</small>
    </button>`;
  }

  private layerRow(id: BackdropLayerId): string {
    const spec = BACKDROP_LAYER_SPECS.find((s) => s.id === id)!;
    return `
      <section class="bb-layer" data-layer="${id}">
        <div class="bb-layer-head">
          <img class="bb-layer-thumb" src="${spec.src}" alt="">
          <label><input type="checkbox" data-bb-visible> ${spec.label}</label>
          <button type="button" data-bb-solo aria-label="Solo this layer">SOLO</button>
          <button type="button" data-bb-layer-reset aria-label="Reset this layer">RESET</button>
        </div>
        <div class="bb-layer-file">${spec.file}</div>
        ${this.numberControl('speed', '0', '1.5', '0.01', 'data-bb-speed', 'data-bb-speed-num')}
        ${this.numberControl('opacity', '0', '1', '0.01', 'data-bb-opacity', 'data-bb-opacity-num')}
        ${this.numberControl('scale', '0.25', '4', '0.01', 'data-bb-scale', 'data-bb-scale-num')}
        <label class="bb-control bb-offset">
          <span>offset</span>
          <input type="number" min="-8192" max="8192" step="1" data-bb-offset-x>
          <input type="number" min="-8192" max="8192" step="1" data-bb-offset-y>
        </label>
      </section>`;
  }

  private numberControl(
    label: string,
    min: string,
    max: string,
    step: string,
    rangeAttr: string,
    numberAttr: string,
  ): string {
    return `<label class="bb-control">
      <span>${label}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" ${rangeAttr}>
      <input type="number" min="${min}" max="${max}" step="${step}" ${numberAttr}>
    </label>`;
  }

  private activeSettings(): BackdropSettings {
    return this.hooks?.getSettings() ?? this.ctx.params.backdrop;
  }

  private commitSettings(settings: BackdropSettings, playtestProfileId: string | null): void {
    const clean = sanitizeBackdropSettings(settings);
    if (this.hooks) {
      this.hooks.commitSettings(clean, playtestProfileId);
      return;
    }
    this.ctx.params.backdrop = clean;
    saveBackdropSettings(clean);
  }

  private loadImages(): void {
    for (const spec of BACKDROP_LAYER_SPECS) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        this.caption.textContent = this.allImagesReady() ? 'READY' : 'LOADING LAYERS';
      };
      img.onerror = () => {
        this.caption.textContent = `FAILED: ${spec.file}`;
      };
      img.src = spec.src;
      this.images[spec.id] = img;
    }
  }

  private wire(): void {
    (this.root.querySelector('#bb-close') as HTMLButtonElement).addEventListener('click', () => this.close());
    (this.root.querySelector('#bb-apply') as HTMLButtonElement).addEventListener('click', () => this.applyDraft());
    (this.root.querySelector('#bb-revert') as HTMLButtonElement).addEventListener('click', () => this.revertDraft());
    (this.root.querySelector('#bb-sync') as HTMLButtonElement).addEventListener('click', () => {
      this.camX = this.ctx.camera.x;
      this.camY = this.ctx.camera.y;
      this.caption.textContent = 'VIEW TO CAMERA';
    });
    (this.root.querySelector('#bb-reset-profile') as HTMLButtonElement).addEventListener('click', () => {
      this.draft = createDefaultBackdropProfile();
      this.markDirty('PROFILE RESET');
    });
    (this.root.querySelector('#bb-copy-all') as HTMLButtonElement).addEventListener('click', () => {
      this.copyAllPending = true;
      this.markDirty('COPY TO ALL LEVELS QUEUED');
    });
    (this.root.querySelector('#bb-follow') as HTMLButtonElement).addEventListener('click', () => {
      this.followCamera = !this.followCamera;
      this.syncToggles();
    });
    (this.root.querySelector('#bb-terrain') as HTMLButtonElement).addEventListener('click', () => {
      this.showTerrain = !this.showTerrain;
      this.syncToggles();
    });
    (this.root.querySelector('#bb-tonemap') as HTMLButtonElement).addEventListener('click', () => {
      this.showTonemap = !this.showTonemap;
      this.syncToggles();
    });
    (this.root.querySelector('#bb-postfx') as HTMLButtonElement).addEventListener('click', () => {
      this.showPost = !this.showPost;
      this.syncToggles();
    });
    (this.root.querySelector('#bb-fit') as HTMLButtonElement).addEventListener('click', () => {
      this.zoom = 1;
      this.camX = this.ctx.camera.x;
      this.camY = this.ctx.camera.y;
      this.caption.textContent = 'FIT';
    });
    this.viewToggle.addEventListener('click', () => this.setMaximized(!this.maximized));

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onControlInput(e));
    this.root.addEventListener('change', (e) => this.onControlInput(e));
    this.root.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.root.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
    this.root.addEventListener('focusout', (e) => {
      if (!this.root.contains(e.relatedTarget as Node | null)) this.keys.clear();
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const next = e.deltaY < 0 ? this.zoom * 1.12 : this.zoom / 1.12;
      this.zoom = Math.max(0.5, Math.min(3, next));
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.root.focus();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging === null || this.dragging.id !== e.pointerId) return;
      const rect = this.canvas.getBoundingClientRect();
      const sx = (this.canvas.width / Math.max(1, rect.width)) / this.zoom;
      const sy = (this.canvas.height / Math.max(1, rect.height)) / this.zoom;
      this.camX -= (e.clientX - this.dragging.x) * sx;
      this.camY -= (e.clientY - this.dragging.y) * sy;
      this.dragging.x = e.clientX;
      this.dragging.y = e.clientY;
    });
    const release = (e: PointerEvent): void => {
      if (this.dragging?.id === e.pointerId) this.dragging = null;
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
    this.canvas.addEventListener('lostpointercapture', () => {
      this.dragging = null;
    });
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const profileButton = target.closest<HTMLButtonElement>('[data-profile]');
    if (profileButton) {
      this.selectedProfile = profileButton.dataset.profile as BackdropProfileId;
      this.loadSelectedProfile();
      return;
    }
    const row = target.closest<HTMLElement>('.bb-layer');
    if (!row) return;
    const id = row.dataset.layer as BackdropLayerId;
    if (target.closest('[data-bb-solo]')) {
      this.soloLayer = this.soloLayer === id ? null : id;
      this.syncControls();
    } else if (target.closest('[data-bb-layer-reset]')) {
      const fresh = createDefaultBackdropProfile().layers[id];
      this.draft.layers[id] = { ...fresh };
      this.markDirty('LAYER RESET');
    }
  }

  private loadSelectedProfile(): void {
    const settings = this.activeSettings();
    this.copyAllPending = false;
    if (this.selectedProfile === 'global') {
      this.levelOverrideEnabled = true;
      this.draft = cloneBackdropProfile({ layers: settings.layers, grade: settings.grade });
    } else {
      const level = settings.levels[this.selectedProfile];
      this.levelOverrideEnabled = level?.enabled === true;
      this.draft = cloneBackdropProfile({
        layers: this.levelOverrideEnabled && level ? level.layers : resolveBackdropLayers(settings, this.selectedProfile),
        grade: this.levelOverrideEnabled && level ? level.grade : settings.grade,
      });
    }
    this.applied = cloneBackdropProfile(this.draft);
    this.appliedLevelOverrideEnabled = this.levelOverrideEnabled;
    this.dirty = false;
    this.soloLayer = null;
    this.syncControls();
  }

  private applyDraft(): void {
    const settings = sanitizeBackdropSettings(this.activeSettings());
    const profile = cloneBackdropProfile(this.draft);
    if (this.selectedProfile === 'global') {
      settings.layers = profile.layers;
      settings.grade = profile.grade;
    } else if (this.levelOverrideEnabled) {
      settings.levels[this.selectedProfile] = { ...profile, enabled: true };
    } else {
      setBackdropLevelOverride(settings, this.selectedProfile, false);
    }
    if (this.copyAllPending) {
      for (const level of this.profiles) {
        settings.levels[level.id] = { ...cloneBackdropProfile(profile), enabled: true };
      }
    }
    this.commitSettings(settings, this.selectedProfile === 'global' ? null : this.selectedProfile);
    this.applied = cloneBackdropProfile(this.draft);
    this.appliedLevelOverrideEnabled = this.levelOverrideEnabled;
    this.dirty = false;
    this.copyAllPending = false;
    this.syncControls();
    this.caption.textContent = 'APPLIED';
  }

  private revertDraft(): void {
    this.draft = cloneBackdropProfile(this.applied);
    this.levelOverrideEnabled = this.appliedLevelOverrideEnabled;
    this.dirty = false;
    this.copyAllPending = false;
    this.syncControls();
    this.caption.textContent = 'REVERTED';
  }

  private markDirty(caption: string): void {
    this.dirty = true;
    this.syncControls();
    this.caption.textContent = caption;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.matches('input, select, textarea')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'shift') {
      this.keys.add(key);
      return;
    }
    if (key === 'f' || key === 'home') {
      e.preventDefault();
      this.zoom = 1;
      this.camX = this.ctx.camera.x;
      this.camY = this.ctx.camera.y;
      return;
    }
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key)) return;
    e.preventDefault();
    e.stopPropagation();
    this.keys.add(key);
  }

  private onControlInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.id === 'bb-override') {
      this.levelOverrideEnabled = target.checked;
      if (!this.levelOverrideEnabled && this.selectedProfile !== 'global') {
        const settings = this.activeSettings();
        this.draft = cloneBackdropProfile({ layers: settings.layers, grade: settings.grade });
      }
      this.markDirty(this.levelOverrideEnabled ? 'OVERRIDE ENABLED' : 'INHERITING GLOBAL');
      return;
    }
    if (this.applyGradeInput(target)) {
      this.markDirty('COLOR GRADE');
      return;
    }
    const row = target.closest<HTMLElement>('.bb-layer');
    if (!row) return;
    const id = row.dataset.layer as BackdropLayerId;
    const setting = this.draft.layers[id];
    if (target.matches('[data-bb-visible]')) setting.visible = target.checked;
    else if (target.matches('[data-bb-speed], [data-bb-speed-num]')) setting.speed = clampBackdropSpeed(target.valueAsNumber);
    else if (target.matches('[data-bb-opacity], [data-bb-opacity-num]')) setting.opacity = clampBackdropOpacity(target.valueAsNumber);
    else if (target.matches('[data-bb-scale], [data-bb-scale-num]')) setting.scale = clampBackdropScale(target.valueAsNumber);
    else if (target.matches('[data-bb-offset-x]')) setting.offsetX = clampBackdropOffset(target.valueAsNumber);
    else if (target.matches('[data-bb-offset-y]')) setting.offsetY = clampBackdropOffset(target.valueAsNumber);
    this.markDirty('DRAFT');
  }

  private applyGradeInput(target: HTMLInputElement): boolean {
    const grade = this.draft.grade;
    if (target.matches('[data-bb-exposure], [data-bb-exposure-num]')) grade.exposure = clampBackdropExposure(target.valueAsNumber);
    else if (target.matches('[data-bb-brightness], [data-bb-brightness-num]')) {
      grade.brightness = clampBackdropBrightness(target.valueAsNumber);
    } else if (target.matches('[data-bb-contrast], [data-bb-contrast-num]')) {
      grade.contrast = clampBackdropContrast(target.valueAsNumber);
    } else if (target.matches('[data-bb-gamma], [data-bb-gamma-num]')) grade.gamma = clampBackdropGamma(target.valueAsNumber);
    else if (target.matches('[data-bb-saturation], [data-bb-saturation-num]')) {
      grade.saturation = clampBackdropSaturation(target.valueAsNumber);
    } else return false;
    return true;
  }

  private syncControls(): void {
    (this.root.querySelector('#bb-active-profile') as HTMLElement).textContent =
      `${profileLabel(this.selectedProfile)}${this.dirty ? ' *' : ''}`;
    const override = this.root.querySelector<HTMLInputElement>('#bb-override');
    if (override) {
      override.checked = this.levelOverrideEnabled;
      override.disabled = this.selectedProfile === 'global';
    }
    const overrideLabel = this.root.querySelector<HTMLElement>('#bb-override-label');
    if (overrideLabel) overrideLabel.textContent = this.selectedProfile === 'global' ? 'GLOBAL PROFILE' : 'LEVEL OVERRIDE';
    const controlsDisabled = this.selectedProfile !== 'global' && !this.levelOverrideEnabled;
    this.syncGradeControls(controlsDisabled);
    for (const spec of BACKDROP_LAYER_SPECS) {
      const row = this.root.querySelector<HTMLElement>(`.bb-layer[data-layer="${spec.id}"]`);
      if (row) this.syncRow(row, spec.id, controlsDisabled);
    }
    this.syncProfileButtons();
    this.syncToggles();
  }

  private syncGradeControls(disabled: boolean): void {
    const grade = this.draft.grade;
    const host = this.root.querySelector<HTMLElement>('.bb-grade');
    if (!host) return;
    for (const input of host.querySelectorAll<HTMLInputElement>('input')) input.disabled = disabled;
    this.setInput(host.querySelector<HTMLInputElement>('[data-bb-exposure]'), grade.exposure);
    this.setInput(host.querySelector<HTMLInputElement>('[data-bb-exposure-num]'), grade.exposure);
    this.setInput(host.querySelector<HTMLInputElement>('[data-bb-brightness]'), grade.brightness, 3);
    this.setInput(host.querySelector<HTMLInputElement>('[data-bb-brightness-num]'), grade.brightness, 3);
    this.setInput(host.querySelector<HTMLInputElement>('[data-bb-contrast]'), grade.contrast);
    this.setInput(host.querySelector<HTMLInputElement>('[data-bb-contrast-num]'), grade.contrast);
    this.setInput(host.querySelector<HTMLInputElement>('[data-bb-gamma]'), grade.gamma);
    this.setInput(host.querySelector<HTMLInputElement>('[data-bb-gamma-num]'), grade.gamma);
    this.setInput(host.querySelector<HTMLInputElement>('[data-bb-saturation]'), grade.saturation);
    this.setInput(host.querySelector<HTMLInputElement>('[data-bb-saturation-num]'), grade.saturation);
  }

  private syncProfileButtons(): void {
    const settings = this.activeSettings();
    const playtestProfile = this.hooks?.getPlaytestProfileId?.() ?? null;
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-profile]')) {
      const id = btn.dataset.profile as BackdropProfileId;
      const selected = id === this.selectedProfile;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
      btn.classList.toggle('overridden', id !== 'global' && settings.levels[id]?.enabled === true);
      btn.classList.toggle('playtest', id !== 'global' && id === playtestProfile);
    }
  }

  private syncToggles(): void {
    this.setTogglePressed('#bb-follow', this.followCamera);
    this.setTogglePressed('#bb-terrain', this.showTerrain);
    this.setTogglePressed('#bb-tonemap', this.showTonemap);
    this.setTogglePressed('#bb-postfx', this.showPost);
    this.setTogglePressed('#bb-copy-all', this.copyAllPending);
    this.root.querySelector('#bb-apply')?.toggleAttribute('disabled', !this.dirty);
    this.root.querySelector('#bb-revert')?.toggleAttribute('disabled', !this.dirty);
  }

  private setTogglePressed(selector: string, on: boolean): void {
    const btn = this.root.querySelector(selector);
    if (!btn) return;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  private syncRow(row: HTMLElement, id: BackdropLayerId, disabled: boolean): void {
    const setting = this.draft.layers[id];
    row.classList.toggle('solo', this.soloLayer === id);
    row.classList.toggle('muted', this.soloLayer !== null && this.soloLayer !== id);
    for (const input of row.querySelectorAll<HTMLInputElement>('input')) input.disabled = disabled;
    for (const btn of row.querySelectorAll<HTMLButtonElement>('button')) {
      btn.disabled = disabled;
      if (disabled) btn.title = 'Enable the level override to edit this layer';
      else btn.removeAttribute('title');
    }
    const visible = row.querySelector<HTMLInputElement>('[data-bb-visible]');
    const speed = row.querySelector<HTMLInputElement>('[data-bb-speed]');
    const speedNum = row.querySelector<HTMLInputElement>('[data-bb-speed-num]');
    const opacity = row.querySelector<HTMLInputElement>('[data-bb-opacity]');
    const opacityNum = row.querySelector<HTMLInputElement>('[data-bb-opacity-num]');
    const scale = row.querySelector<HTMLInputElement>('[data-bb-scale]');
    const scaleNum = row.querySelector<HTMLInputElement>('[data-bb-scale-num]');
    const offsetX = row.querySelector<HTMLInputElement>('[data-bb-offset-x]');
    const offsetY = row.querySelector<HTMLInputElement>('[data-bb-offset-y]');
    if (visible) visible.checked = setting.visible;
    this.setInput(speed, setting.speed);
    this.setInput(speedNum, setting.speed);
    this.setInput(opacity, setting.opacity);
    this.setInput(opacityNum, setting.opacity);
    this.setInput(scale, setting.scale);
    this.setInput(scaleNum, setting.scale);
    this.setInput(offsetX, setting.offsetX, 0);
    this.setInput(offsetY, setting.offsetY, 0);
  }

  private setInput(input: HTMLInputElement | null, value: number, fixed = 2): void {
    if (!input || document.activeElement === input) return;
    input.value = fixed === 0 ? Math.round(value).toString() : value.toFixed(fixed);
  }

  private setMaximized(maximized: boolean): void {
    this.maximized = maximized;
    this.root.classList.toggle('maximized', maximized);
    this.viewToggle.classList.toggle('restore-icon', maximized);
    this.viewToggle.title = maximized ? 'Restore backdrop preview' : 'Maximize backdrop preview';
  }

  private loop = (): void => {
    if (!this.openState) return;
    if (this.followCamera) {
      this.camX = this.ctx.camera.x;
      this.camY = this.ctx.camera.y;
    } else {
      this.panFromKeys();
    }
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private panFromKeys(): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx--;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx++;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy--;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy++;
    if (dx === 0 && dy === 0) return;
    const speed = (this.keys.has('shift') ? 16 : 8) / this.zoom;
    this.camX += dx * speed;
    this.camY += dy * speed;
  }

  private draw(): void {
    const ctx = this.stage;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.drawGradedBackdrop();
    ctx.drawImage(this.backdropCanvas, 0, 0);
    if (this.showTerrain) {
      ctx.save();
      ctx.translate(VIEW_W / 2, VIEW_H / 2);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-VIEW_W / 2, -VIEW_H / 2);
      this.drawTerrainOverlay(ctx);
      ctx.restore();
    }
    if (this.showTonemap || this.showPost) this.applyInGameLook(ctx);

    const coords = this.root.querySelector('#bb-coords');
    if (coords) coords.textContent = `x ${Math.round(this.camX)}  y ${Math.round(this.camY)}  ${this.zoom.toFixed(2)}x`;
  }

  private drawGradedBackdrop(): void {
    const ctx = this.backdropCtx;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#040509';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-VIEW_W / 2, -VIEW_H / 2);
    this.drawBackdropLayers(ctx);
    ctx.restore();
    this.applyGrade(ctx, this.draft.grade);
  }

  private drawBackdropLayers(ctx: CanvasRenderingContext2D): void {
    for (const spec of BACKDROP_LAYER_SPECS) {
      if (this.soloLayer !== null && this.soloLayer !== spec.id) continue;
      const setting = this.draft.layers[spec.id];
      const img = this.images[spec.id];
      if (!this.layerDraws(setting, img)) continue;
      const w = img.naturalWidth * setting.scale;
      const h = img.naturalHeight * setting.scale;
      const ox = -wrapOffset(Math.floor(this.camX * setting.speed + setting.offsetX * setting.scale), w);
      const oy = -wrapOffset(Math.floor(this.camY * setting.speed + setting.offsetY * setting.scale), h);
      ctx.globalAlpha = setting.opacity;
      for (let y = oy; y < VIEW_H; y += h) {
        for (let x = ox; x < VIEW_W; x += w) ctx.drawImage(img, x, y, w, h);
      }
    }
    ctx.globalAlpha = 1;
  }

  private applyGrade(ctx: CanvasRenderingContext2D, grade: BackdropGradeSettings): void {
    const image = ctx.getImageData(0, 0, VIEW_W, VIEW_H);
    const data = image.data;
    const exposure = 2 ** grade.exposure;
    const brightness = grade.brightness;
    const contrast = grade.contrast;
    const invGamma = 1 / grade.gamma;
    const saturation = grade.saturation;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;
      r = (r * exposure + brightness - 0.5) * contrast + 0.5;
      g = (g * exposure + brightness - 0.5) * contrast + 0.5;
      b = (b * exposure + brightness - 0.5) * contrast + 0.5;
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      r = luma + (r - luma) * saturation;
      g = luma + (g - luma) * saturation;
      b = luma + (b - luma) * saturation;
      data[i] = Math.round((r <= 0 ? 0 : r >= 1 ? 1 : r ** invGamma) * 255);
      data[i + 1] = Math.round((g <= 0 ? 0 : g >= 1 ? 1 : g ** invGamma) * 255);
      data[i + 2] = Math.round((b <= 0 ? 0 : b >= 1 ? 1 : b ** invGamma) * 255);
    }
    ctx.putImageData(image, 0, 0);
  }

  /**
   * APPROXIMATE the live render's color pipeline on the composited preview so it
   * reads like gameplay instead of raw fullbright cells. Mirrors what the game
   * always does after the per-cell lighting law: a screen VIGNETTE, the ACES
   * filmic TONEMAP (the big saturation/highlight rolloff), and — when POST FX is
   * on — the tonemap exposure (postFx.exposure) and film grain.
   *
   * NOT simulated: the dynamic per-cell lighting field (the live light buffer
   * isn't built for the Builder's free-pan camera) and bloom. So lit/shadow
   * contrast won't match exactly — but the color grade that made the editor look
   * "richer/more saturated" than the game (no tonemap) is now reproduced.
   */
  private applyInGameLook(ctx: CanvasRenderingContext2D): void {
    const post = this.ctx.state.postFx;
    const tonemap = this.showTonemap;
    const doPost = this.showPost;
    const expo = doPost && post.enabled ? post.exposure : 1; // exposure feeds the tonemapper
    const vigStrength = tonemap ? post.vignette : 0;
    const grain = doPost && post.lensEnabled ? post.grain : 0;
    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    const maxR2 = cx * cx + cy * cy;
    const image = ctx.getImageData(0, 0, VIEW_W, VIEW_H);
    const data = image.data;
    let o = 0;
    for (let y = 0; y < VIEW_H; y++) {
      const dy = y - cy;
      for (let x = 0; x < VIEW_W; x++, o += 4) {
        let r = data[o] / 255;
        let g = data[o + 1] / 255;
        let b = data[o + 2] / 255;
        if (vigStrength > 0) {
          const dx = x - cx;
          const vg = 1 - vigStrength * ((dx * dx + dy * dy) / maxR2);
          r *= vg; g *= vg; b *= vg;
        }
        if (tonemap) {
          r = acesTonemap(r * expo);
          g = acesTonemap(g * expo);
          b = acesTonemap(b * expo);
        } else if (expo !== 1) {
          r *= expo; g *= expo; b *= expo;
        }
        if (grain > 0) {
          const n = (hashNoise(x, y) - 0.5) * grain;
          r += n; g += n; b += n;
        }
        data[o] = r <= 0 ? 0 : r >= 1 ? 255 : Math.round(r * 255);
        data[o + 1] = g <= 0 ? 0 : g >= 1 ? 255 : Math.round(g * 255);
        data[o + 2] = b <= 0 ? 0 : b >= 1 ? 255 : Math.round(b * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  private layerDraws(setting: BackdropLayerSettings, img: HTMLImageElement | undefined): img is HTMLImageElement {
    return setting.visible && setting.opacity > 0 && img?.complete === true && img.naturalWidth > 0;
  }

  private drawTerrainOverlay(ctx: CanvasRenderingContext2D): void {
    const world = this.ctx.world;
    const types = world.types;
    const colors = world.colors;
    const data = this.terrainOverlay.data;
    let o = 0;
    const camX = Math.floor(this.camX);
    const camY = Math.floor(this.camY);
    for (let vy = 0; vy < VIEW_H; vy++) {
      const wy = camY + vy;
      for (let vx = 0; vx < VIEW_W; vx++, o += 4) {
        const wx = camX + vx;
        if (wx < 0 || wx >= WIDTH || wy < 0 || wy >= HEIGHT) {
          data[o + 3] = 0;
          continue;
        }
        const ci = wy * WIDTH + wx;
        if (types[ci] === Cell.Empty) {
          data[o + 3] = 0;
          continue;
        }
        const c = colors[ci];
        data[o] = Math.floor(unpackR(c) * 0.92);
        data[o + 1] = Math.floor(unpackG(c) * 0.92);
        data[o + 2] = Math.floor(unpackB(c) * 0.96);
        data[o + 3] = 232;
      }
    }
    this.terrainCtx.putImageData(this.terrainOverlay, 0, 0);
    ctx.drawImage(this.terrainCanvas, 0, 0);
  }

  private allImagesReady(): boolean {
    return BACKDROP_LAYER_SPECS.every((spec) => {
      const img = this.images[spec.id];
      return img?.complete === true && img.naturalWidth > 0;
    });
  }
}

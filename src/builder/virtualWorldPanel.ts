import { LEVELS } from '@/config/worldgraph';
import { BIOMES } from '@/config/biomes';
import { GEN_TUNE } from '@/config/gen';
import { randomSeed } from '@/core/rng';
import { escapeHtml } from '@/core/strings';
import type { BiomeId, LevelDef } from '@/core/types';
import { builderPanelTitle } from '@/ui/editor/PanelRegistry';
import { builderPanelHeader } from '@/ui/editor/PanelChrome';
import { editorSectionHtml } from '@/ui/editor/Section';
import {
  biomeIndexFromId,
  biomeIdFromIndex,
  createDefaultVirtualWorldDef,
  createDefaultDressingProfile,
  createDefaultVirtualGenerationParams,
  TsWorkerBackend,
  WasmBackend,
  WebGpuPreviewBackend,
  VIRTUAL_SCENE_KINDS,
} from '@/world/virtual';
import type {
  BackendInfo,
  GenerateWindowResult,
  TransferableVirtualChunk,
  VirtualBiomeId,
  VirtualSceneBudget,
  VirtualSceneKind,
  VirtualWorldDef,
} from '@/world/virtual';

type VirtualWorldProfileId = 'global' | string;
type VirtualWorldStatus = 'idle' | 'generating' | 'ready' | 'stale' | 'canceled' | 'error';
type CaveStylePresetId = 'structured' | 'natural' | 'wild' | 'custom';
type GenerationParams = VirtualWorldDef['generation'];
type DressingControls = VirtualWorldDef['dressing']['controls'];
type SceneControls = VirtualWorldDef['dressing']['scenes']['controls'];

interface VirtualProfileStats {
  materialCells: number;
  liquidCells: number;
  glowCells: number;
  sceneCount: number;
}

interface CachedPreviewChunk {
  chunk: TransferableVirtualChunk;
  canvas: HTMLCanvasElement;
  bytes: number;
  lastUsed: number;
}

export interface VirtualWorldPanelHooks {
  getBaseSeed(): number;
  onPlayWindow(def: VirtualWorldDef, center: { x: number; y: number }, previewRadius: number): void;
  onClose(): void;
  isSectionCollapsed?(id: string): boolean;
  onSectionCollapsed?(id: string, collapsed: boolean): void;
}

const ZOOM_MIN = 0.08;
const ZOOM_MAX = 2.5;
const MAX_PREVIEW_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_PREVIEW_CHUNKS_PER_PROFILE = 128;
const GENERATION_DEFAULTS: GenerationParams = createDefaultVirtualGenerationParams();
const CAVE_STYLE_PRESETS: Record<Exclude<CaveStylePresetId, 'custom'>, Partial<GenerationParams>> = {
  structured: {
    baseCellSize: 4,
    organicSmoothingPasses: 0,
    shapeWarp: 0.12,
    cornerRounding: 0.18,
    surfaceCover: 0.34,
    surfaceDepth: 1,
    vegetationDensity: 0.12,
    edgeRoughness: 0.22,
    pocketDensity: 0.16,
    crackDensity: 0.08,
  },
  natural: {
    baseCellSize: 3,
    organicSmoothingPasses: 0,
    shapeWarp: 0.32,
    cornerRounding: 0.56,
    surfaceCover: 0.64,
    surfaceDepth: 2,
    vegetationDensity: 0.38,
    edgeRoughness: 0.38,
    pocketDensity: 0.3,
    crackDensity: 0.2,
  },
  wild: {
    baseCellSize: 2,
    organicSmoothingPasses: 2,
    shapeWarp: 0.78,
    cornerRounding: 0.84,
    surfaceCover: 0.82,
    surfaceDepth: 3,
    vegetationDensity: 0.68,
    edgeRoughness: 0.58,
    pocketDensity: 0.48,
    crackDensity: 0.34,
  },
};
const PROFILE_GENERATION_PRESETS: Record<BiomeId, Partial<GenerationParams>> = {
  earthen: {
    ...CAVE_STYLE_PRESETS.natural,
    noiseThreshold: 0.54,
  },
  fungal: {
    baseCellSize: 2,
    organicSmoothingPasses: 2,
    shapeWarp: 0.66,
    cornerRounding: 0.76,
    surfaceCover: 0.86,
    surfaceDepth: 3,
    vegetationDensity: 0.78,
    edgeRoughness: 0.48,
    pocketDensity: 0.48,
    crackDensity: 0.22,
    noiseThreshold: 0.52,
  },
  frozen: {
    baseCellSize: 3,
    organicSmoothingPasses: 1,
    shapeWarp: 0.3,
    cornerRounding: 0.62,
    surfaceCover: 0.58,
    surfaceDepth: 2,
    vegetationDensity: 0.22,
    edgeRoughness: 0.32,
    pocketDensity: 0.28,
    crackDensity: 0.28,
    noiseThreshold: 0.56,
  },
  flooded: {
    baseCellSize: 2,
    organicSmoothingPasses: 2,
    shapeWarp: 0.72,
    cornerRounding: 0.82,
    surfaceCover: 0.78,
    surfaceDepth: 3,
    vegetationDensity: 0.58,
    edgeRoughness: 0.42,
    pocketDensity: 0.56,
    crackDensity: 0.16,
    noiseThreshold: 0.5,
  },
  timber: {
    baseCellSize: 3,
    organicSmoothingPasses: 1,
    shapeWarp: 0.46,
    cornerRounding: 0.58,
    surfaceCover: 0.72,
    surfaceDepth: 2,
    vegetationDensity: 0.62,
    edgeRoughness: 0.42,
    pocketDensity: 0.34,
    crackDensity: 0.18,
    noiseThreshold: 0.54,
  },
  crystal: {
    baseCellSize: 3,
    organicSmoothingPasses: 0,
    shapeWarp: 0.24,
    cornerRounding: 0.52,
    surfaceCover: 0.5,
    surfaceDepth: 2,
    vegetationDensity: 0.18,
    edgeRoughness: 0.3,
    pocketDensity: 0.28,
    crackDensity: 0.5,
    noiseThreshold: 0.56,
  },
  scorched: {
    baseCellSize: 2,
    organicSmoothingPasses: 1,
    shapeWarp: 0.58,
    cornerRounding: 0.64,
    surfaceCover: 0.26,
    surfaceDepth: 1,
    vegetationDensity: 0.04,
    edgeRoughness: 0.62,
    pocketDensity: 0.36,
    crackDensity: 0.46,
    noiseThreshold: 0.55,
  },
  volcanic: {
    baseCellSize: 2,
    organicSmoothingPasses: 1,
    shapeWarp: 0.7,
    cornerRounding: 0.7,
    surfaceCover: 0.2,
    surfaceDepth: 1,
    vegetationDensity: 0,
    edgeRoughness: 0.72,
    pocketDensity: 0.44,
    crackDensity: 0.62,
    noiseThreshold: 0.57,
  },
  gilded: {
    baseCellSize: 3,
    organicSmoothingPasses: 0,
    shapeWarp: 0.28,
    cornerRounding: 0.44,
    surfaceCover: 0.36,
    surfaceDepth: 1,
    vegetationDensity: 0.08,
    edgeRoughness: 0.28,
    pocketDensity: 0.22,
    crackDensity: 0.26,
    noiseThreshold: 0.53,
  },
};
const DRESSING_DEFAULTS: DressingControls = {
  detailDensity: 1,
  materialRichness: 1,
  liquidRichness: 1,
  glowDensity: 1,
  floorDebris: 1,
  hangingGrowth: 1,
};
const PROFILE_DRESSING_PRESETS: Record<BiomeId, Partial<DressingControls>> = {
  earthen: {
    materialRichness: 1,
    liquidRichness: 0.75,
    glowDensity: 0.78,
    floorDebris: 1.05,
    hangingGrowth: 0.85,
  },
  fungal: {
    materialRichness: 0.82,
    liquidRichness: 1.05,
    glowDensity: 1.45,
    floorDebris: 1.2,
    hangingGrowth: 1.5,
  },
  frozen: {
    materialRichness: 1.05,
    liquidRichness: 0.45,
    glowDensity: 1.1,
    floorDebris: 1,
    hangingGrowth: 0.52,
  },
  flooded: {
    materialRichness: 0.72,
    liquidRichness: 1.65,
    glowDensity: 0.95,
    floorDebris: 1.25,
    hangingGrowth: 1.55,
  },
  timber: {
    materialRichness: 0.9,
    liquidRichness: 0.55,
    glowDensity: 0.75,
    floorDebris: 1.45,
    hangingGrowth: 1.35,
  },
  crystal: {
    materialRichness: 1.35,
    liquidRichness: 0.45,
    glowDensity: 1.55,
    floorDebris: 0.8,
    hangingGrowth: 1.12,
  },
  scorched: {
    materialRichness: 1.12,
    liquidRichness: 0.7,
    glowDensity: 0.72,
    floorDebris: 1.28,
    hangingGrowth: 0.18,
  },
  volcanic: {
    materialRichness: 1.05,
    liquidRichness: 1.45,
    glowDensity: 1.15,
    floorDebris: 0.9,
    hangingGrowth: 0.18,
  },
  gilded: {
    materialRichness: 1.75,
    liquidRichness: 0.78,
    glowDensity: 1.15,
    floorDebris: 0.82,
    hangingGrowth: 0.42,
  },
};
const SCENE_CONTROL_DEFAULTS: SceneControls = {
  density: 1,
  maxPerTile: 2,
};
const PROFILE_SCENE_CONTROL_PRESETS: Record<BiomeId, Partial<SceneControls>> = {
  earthen: { density: 0.95, maxPerTile: 2 },
  fungal: { density: 1.35, maxPerTile: 3 },
  frozen: { density: 0.85, maxPerTile: 2 },
  flooded: { density: 1.12, maxPerTile: 3 },
  timber: { density: 1.28, maxPerTile: 3 },
  crystal: { density: 1.12, maxPerTile: 2 },
  scorched: { density: 0.9, maxPerTile: 2 },
  volcanic: { density: 1.05, maxPerTile: 2 },
  gilded: { density: 0.92, maxPerTile: 2 },
};

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
      ${builderPanelHeader({ title: builderPanelTitle('builder-virtual-world'), closeId: 'vw-close', closeLabel: 'Close world map', className: 'vw-head' })}
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
    const style = generationStyle(def);
    const sceneBiome = this.activeSceneBiome(def);
    const sceneBudget = def.dressing.scenes.biomes[sceneBiome] ?? def.dressing.scenes.biomes.earthen;
    const controls = this.must<HTMLElement>('#vw-controls');
    // Preserve the native <details> "Advanced" disclosure across rebuilds (a
    // preset/reset click rebuilds the controls and would otherwise slam it shut).
    const prevAdvanced = controls.querySelector<HTMLDetailsElement>('.vw-advanced');
    const advancedOpen = prevAdvanced ? prevAdvanced.open : null;
    controls.innerHTML = `
      ${this.sectionHtml('controls.world', 'World', `
        <label class="vw-field"><span>profile</span><select id="vw-profile">
          <option value="global">Global prototype</option>
          ${this.profiles.map((level) => `<option value="${level.id}">${profileLabel(level)}</option>`).join('')}
        </select></label>
        <label class="vw-field vw-seed"><span>seed</span><input id="vw-seed" type="number" min="0" max="4294967295" step="1"><button id="vw-reroll" type="button">ROLL</button></label>
        <label class="vw-field"><span>backend</span><select id="vw-backend">
          ${this.backendInfos.map((info) => {
            const disabled = !info.implemented || !info.available;
            const hint = !info.implemented ? ' — planned' : !info.available ? ' — unavailable' : info.authoritativeCells ? '' : ' — preview';
            return `<option value="${info.kind}"${disabled ? ' disabled' : ''}>${info.label}${hint}</option>`;
          }).join('')}
        </select></label>
      `)}
      ${this.sectionHtml('controls.preview', 'Preview', `
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
      `)}
      ${this.sectionHtml('controls.generation', 'Generation', `
        <div class="vw-title-row"><button id="vw-reset-generation" type="button">RESET</button></div>
        <div class="vw-segment" role="group" aria-label="Cave style">
          ${this.styleButtonHtml('structured', 'Structured', style)}
          ${this.styleButtonHtml('natural', 'Natural', style)}
          ${this.styleButtonHtml('wild', 'Wild', style)}
          ${this.styleButtonHtml('custom', 'Custom', style)}
        </div>
        ${this.sliderHtml('shape-warp', 'organic warp', def.generation.shapeWarp, 0, 1, 0.01)}
        ${this.sliderHtml('corner-rounding', 'rounded edges', def.generation.cornerRounding, 0, 1, 0.01)}
        ${this.sliderHtml('organic-smooth', 'soften', def.generation.organicSmoothingPasses, 0, 4, 1)}
        ${this.sliderHtml('edge-roughness', 'rough walls', def.generation.edgeRoughness, 0, 1, 0.01)}
        ${this.sliderHtml('pocket-density', 'side pockets', def.generation.pocketDensity, 0, 1, 0.01)}
        ${this.sliderHtml('crack-density', 'fissures', def.generation.crackDensity, 0, 1, 0.01)}
        <div class="vw-subtitle">Surface</div>
        ${this.sliderHtml('surface-cover', 'surface cover', def.generation.surfaceCover, 0, 1, 0.01)}
        ${this.sliderHtml('surface-depth', 'cap depth', def.generation.surfaceDepth, 0, 6, 1)}
        ${this.sliderHtml('vegetation-density', 'vegetation', def.generation.vegetationDensity, 0, 1, 0.01)}
        <div class="vw-subtitle">Dressing</div>
        ${this.sliderHtml('detail-density', 'detail density', def.dressing.controls.detailDensity, 0, 2, 0.01)}
        ${this.sliderHtml('material-richness', 'ore + veins', def.dressing.controls.materialRichness, 0, 2, 0.01)}
        ${this.sliderHtml('liquid-richness', 'liquid pockets', def.dressing.controls.liquidRichness, 0, 2, 0.01)}
        ${this.sliderHtml('glow-density', 'glow accents', def.dressing.controls.glowDensity, 0, 2, 0.01)}
        ${this.sliderHtml('floor-debris', 'floor debris', def.dressing.controls.floorDebris, 0, 2, 0.01)}
        ${this.sliderHtml('hanging-growth', 'hanging growth', def.dressing.controls.hangingGrowth, 0, 2, 0.01)}
        <div class="vw-subtitle">Scenes</div>
        ${this.sliderHtml('scene-density', 'scene density', def.dressing.scenes.controls.density, 0, 2, 0.01)}
        ${this.sliderHtml('scene-budget', 'scenes per tile', def.dressing.scenes.controls.maxPerTile, 0, 6, 1)}
        <div class="vw-title-row"><div class="vw-subtitle">Scene mix - ${escapeHtml(BIOMES[sceneBiome].name)}</div><button id="vw-reset-scenes" type="button">RESET MIX</button></div>
        ${this.sceneBudgetSlidersHtml(sceneBudget)}
        <details class="vw-advanced">
          <summary>Advanced</summary>
          ${this.sliderHtml('base-cell-size', 'cell grain', def.generation.baseCellSize, 1, 4, 1)}
          ${this.sliderHtml('smooth', 'cell smooth', def.generation.smoothingPasses, 0, 3, 1)}
          ${this.sliderHtml('noise-scale', 'noise scale', def.generation.noiseScale, 0.008, 0.08, 0.001)}
          ${this.sliderHtml('noise-threshold', 'density', def.generation.noiseThreshold, 0.38, 0.72, 0.005)}
          ${this.sliderHtml('halo', 'halo', def.generation.halo, 0, 64, 1)}
          ${this.sliderHtml('border-seal', 'border seal', def.generation.borderSeal, 0, 8, 1)}
        </details>
      `)}
      ${this.sectionHtml('controls.actions', 'Actions', `
        <div class="vw-actions">
          <button id="vw-generate" type="button">GENERATE</button>
          <button id="vw-frame" type="button">FRAME</button>
          <button id="vw-cancel" type="button" title="Cancel is only available while a window is generating"${this.status === 'generating' ? '' : ' disabled'}>CANCEL</button>
          <button id="vw-clear" type="button">CLEAR CACHE</button>
          <button id="vw-reset-profile" type="button" title="Reset this profile to its built-in preset">RESET ALL</button>
          <button id="vw-export-profile" type="button" title="Download this world-generation profile as JSON">EXPORT</button>
          <button id="vw-import-profile" type="button" title="Import a world-generation profile JSON file">IMPORT</button>
          <button id="vw-validate" type="button">VALIDATE</button>
          <button id="vw-play-window" type="button" title="Play a disposable fixed-size test crop centered on this map view">PLAY WINDOW</button>
        </div>
      `)}`;
    if (advancedOpen !== null) {
      const adv = controls.querySelector<HTMLDetailsElement>('.vw-advanced');
      if (adv) adv.open = advancedOpen;
    }
    this.wireSections(controls);
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

  private sectionHtml(id: string, title: string, body: string): string {
    const key = `virtualWorld.${id}`;
    return editorSectionHtml({
      id: key,
      title,
      body,
      className: 'vw-section',
      titleClassName: 'vw-title',
      bodyClassName: 'vw-section-body',
      collapsed: this.hooks.isSectionCollapsed?.(key) === true,
    });
  }

  private wireSections(root: ParentNode): void {
    for (const button of root.querySelectorAll<HTMLElement>('[data-section-toggle]')) {
      if (button.dataset.sectionToggleWired === 'true') continue;
      button.dataset.sectionToggleWired = 'true';
      const toggle = (): void => {
        const id = button.dataset.sectionToggle;
        const section = button.closest<HTMLElement>('.editor-section');
        if (!id || !section) return;
        const collapsed = !section.classList.contains('collapsed');
        section.classList.toggle('collapsed', collapsed);
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        this.hooks.onSectionCollapsed?.(id, collapsed);
      };
      button.addEventListener('click', toggle);
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle();
      });
    }
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

  private styleButtonHtml(id: CaveStylePresetId, label: string, active: CaveStylePresetId): string {
    const preset = id === 'custom' ? '' : ` data-vw-style="${id}"`;
    return `<button type="button" class="${id === active ? 'active' : ''}" data-vw-style-button="${id}"${preset} aria-pressed="${id === active ? 'true' : 'false'}">${label}</button>`;
  }

  private sceneBudgetSlidersHtml(budget: VirtualSceneBudget): string {
    return VIRTUAL_SCENE_KINDS
      .map((kind) => this.sliderHtml(`scene-kind-${kind}`, sceneKindLabel(kind), budget[kind], 0, 2, 0.01))
      .join('');
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
      this.status = 'idle';
      this.statusText = profileStatusText(this.selectedProfile);
      this.lastMetrics = null;
      this.lastAutoCenter = '';
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
      const info = this.selectedBackendInfo();
      if (!info.implemented) this.statusText = `${info.label} is planned; only the TypeScript Worker produces authoritative chunks`;
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
    for (const button of this.host.querySelectorAll<HTMLButtonElement>('[data-vw-style]')) {
      button.addEventListener('click', () => {
        const preset = button.dataset.vwStyle as Exclude<CaveStylePresetId, 'custom'>;
        this.mutateDef((def) => applyGenerationPreset(def, preset));
        this.renderControls();
      });
    }
    this.must<HTMLButtonElement>('#vw-reset-generation').addEventListener('click', () => {
      this.mutateDef((def) => resetProfileTuning(def, this.selectedProfile));
      this.renderControls();
    });
    this.must<HTMLButtonElement>('#vw-reset-scenes').addEventListener('click', () => {
      this.mutateDef((def) => resetSceneBudgetForProfile(def, this.selectedProfile));
      this.renderControls();
    });
    this.must<HTMLButtonElement>('#vw-reset-profile').addEventListener('click', () => {
      this.cancel();
      this.defs.set(this.selectedProfile, defaultDefForProfile(this.selectedProfile, this.profileSeed(this.selectedProfile)));
      this.chunks.clear();
      this.lastMetrics = null;
      this.status = 'idle';
      this.statusText = 'Profile reset to built-in preset';
      this.lastAutoCenter = '';
      this.renderControls();
      this.requestDraw();
    });
    this.must<HTMLButtonElement>('#vw-export-profile').addEventListener('click', () => this.exportProfile());
    this.must<HTMLButtonElement>('#vw-import-profile').addEventListener('click', () => void this.importProfile());
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
    this.must<HTMLButtonElement>('#vw-play-window').addEventListener('click', () => this.playWindow());
    for (const input of this.host.querySelectorAll<HTMLInputElement>('[data-vw-range], [data-vw-number]')) {
      input.addEventListener(input.type === 'range' ? 'input' : 'change', () => this.applySlider(input));
    }
  }

  private syncSliderValues(def: VirtualWorldDef): void {
    const sceneBudget = def.dressing.scenes.biomes[this.activeSceneBiome(def)] ?? def.dressing.scenes.biomes.earthen;
    const values: Record<string, number> = {
      halo: def.generation.halo,
      'base-cell-size': def.generation.baseCellSize,
      smooth: def.generation.smoothingPasses,
      'organic-smooth': def.generation.organicSmoothingPasses,
      'shape-warp': def.generation.shapeWarp,
      'corner-rounding': def.generation.cornerRounding,
      'surface-cover': def.generation.surfaceCover,
      'surface-depth': def.generation.surfaceDepth,
      'vegetation-density': def.generation.vegetationDensity,
      'detail-density': def.dressing.controls.detailDensity,
      'material-richness': def.dressing.controls.materialRichness,
      'liquid-richness': def.dressing.controls.liquidRichness,
      'glow-density': def.dressing.controls.glowDensity,
      'floor-debris': def.dressing.controls.floorDebris,
      'hanging-growth': def.dressing.controls.hangingGrowth,
      'scene-density': def.dressing.scenes.controls.density,
      'scene-budget': def.dressing.scenes.controls.maxPerTile,
      'edge-roughness': def.generation.edgeRoughness,
      'pocket-density': def.generation.pocketDensity,
      'crack-density': def.generation.crackDensity,
      'noise-scale': def.generation.noiseScale,
      'noise-threshold': def.generation.noiseThreshold,
      'border-seal': def.generation.borderSeal,
    };
    for (const kind of VIRTUAL_SCENE_KINDS) values[`scene-kind-${kind}`] = sceneBudget[kind];
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
      else if (id === 'base-cell-size') def.generation.baseCellSize = Math.round(next);
      else if (id === 'smooth') def.generation.smoothingPasses = Math.round(next);
      else if (id === 'organic-smooth') def.generation.organicSmoothingPasses = Math.round(next);
      else if (id === 'shape-warp') def.generation.shapeWarp = next;
      else if (id === 'corner-rounding') def.generation.cornerRounding = next;
      else if (id === 'surface-cover') def.generation.surfaceCover = next;
      else if (id === 'surface-depth') def.generation.surfaceDepth = Math.round(next);
      else if (id === 'vegetation-density') def.generation.vegetationDensity = next;
      else if (id === 'detail-density') def.dressing.controls.detailDensity = next;
      else if (id === 'material-richness') def.dressing.controls.materialRichness = next;
      else if (id === 'liquid-richness') def.dressing.controls.liquidRichness = next;
      else if (id === 'glow-density') def.dressing.controls.glowDensity = next;
      else if (id === 'floor-debris') def.dressing.controls.floorDebris = next;
      else if (id === 'hanging-growth') def.dressing.controls.hangingGrowth = next;
      else if (id === 'scene-density') def.dressing.scenes.controls.density = next;
      else if (id === 'scene-budget') def.dressing.scenes.controls.maxPerTile = Math.round(next);
      else if (id.startsWith('scene-kind-')) {
        const kind = id.slice('scene-kind-'.length);
        if (isVirtualSceneKind(kind)) {
          const biome = this.activeSceneBiome(def);
          def.dressing.scenes.biomes[biome][kind] = next;
        }
      }
      else if (id === 'edge-roughness') def.generation.edgeRoughness = next;
      else if (id === 'pocket-density') def.generation.pocketDensity = next;
      else if (id === 'crack-density') def.generation.crackDensity = next;
      else if (id === 'noise-scale') def.generation.noiseScale = next;
      else if (id === 'noise-threshold') def.generation.noiseThreshold = next;
      else if (id === 'border-seal') def.generation.borderSeal = Math.round(next);
    });
    this.syncSliderValues(this.currentDef());
    this.syncStyleButtons(this.currentDef());
  }

  private syncStyleButtons(def: VirtualWorldDef): void {
    const style = generationStyle(def);
    for (const button of this.host.querySelectorAll<HTMLButtonElement>('[data-vw-style-button]')) {
      const active = button.dataset.vwStyleButton === style;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
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

  private activeSceneBiome(def: VirtualWorldDef): VirtualBiomeId {
    const level = LEVELS[this.selectedProfile];
    if (level) return level.biome as VirtualBiomeId;
    return biomeIdFromIndex(def.map.cells[0] ?? 0);
  }

  private selectedBackendInfo(): BackendInfo {
    return this.backendInfos.find((info) => info.kind === this.selectedBackend) ?? this.backend.info;
  }

  private async generateWindow(): Promise<void> {
    const selectedInfo = this.selectedBackendInfo();
    if (!selectedInfo.implemented) {
      this.status = 'error';
      this.statusText = `${selectedInfo.label} is planned and not implemented yet`;
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
    // Mirror the live GEN_TUNE cave-size knob (the Sandbox/Builder "Cave size"
    // slider) into the def so it crosses the worker boundary; when it changes,
    // drop the cached chunks so the window actually re-carves at the new scale.
    if (def.generation.caveScale !== GEN_TUNE.caveScale) {
      def.generation.caveScale = GEN_TUNE.caveScale;
      this.chunks.clear();
    }
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

  private playWindow(): void {
    this.cancel();
    const def = structuredClone(this.currentDef());
    const center = { x: Math.floor(this.camX), y: Math.floor(this.camY) };
    this.status = 'ready';
    this.statusText = `Launching play window at ${center.x},${center.y}`;
    this.renderControls();
    this.hooks.onPlayWindow(def, center, this.radius);
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
    if (event.key === 'a' || event.key === 'A' || event.key === 'ArrowLeft') this.camX -= step;
    else if (event.key === 'd' || event.key === 'D' || event.key === 'ArrowRight') this.camX += step;
    else if (event.key === 'w' || event.key === 'W' || event.key === 'ArrowUp') this.camY -= step;
    else if (event.key === 's' || event.key === 'S' || event.key === 'ArrowDown') this.camY += step;
    else if (event.key === '+' || event.key === '=') {
      this.zoomAtCenter(1.15);
      event.preventDefault();
      return;
    } else if (event.key === '-' || event.key === '_') {
      this.zoomAtCenter(1 / 1.15);
      event.preventDefault();
      return;
    } else if (event.key === 'Home') {
      this.frameCachedChunks();
      event.preventDefault();
      return;
    } else if (event.key === 'Enter') {
      void this.generateWindow();
      event.preventDefault();
      return;
    } else return;
    event.preventDefault();
    this.afterPan();
    this.maybeAutoGenerate();
  }

  private zoomAtCenter(scale: number): void {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * scale));
    if (next === this.zoom) return;
    this.zoom = next;
    this.requestDraw();
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
      if (this.showScenes && chunk.meta.scenePlacements.length > 0) this.drawSceneMarkers(chunk, sx, sy, size);
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

  private drawSceneMarkers(chunk: TransferableVirtualChunk, sx: number, sy: number, size: number): void {
    const scale = size / chunk.size;
    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.font = '9px monospace';
    for (const placement of chunk.meta.scenePlacements) {
      const x = sx + (placement.x - chunk.originX) * scale;
      const y = sy + (placement.y - chunk.originY) * scale;
      const w = Math.max(3, placement.w * scale);
      const h = Math.max(3, placement.h * scale);
      this.ctx.strokeStyle = 'rgba(250, 204, 21, 0.72)';
      this.ctx.fillStyle = 'rgba(250, 204, 21, 0.1)';
      this.ctx.fillRect(x, y, w, h);
      this.ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      if (scale > 0.22) {
        this.ctx.fillStyle = 'rgba(4, 6, 10, 0.78)';
        this.ctx.fillRect(x + 2, y + 2, Math.min(w - 4, 72), 14);
        this.ctx.fillStyle = '#facc15';
        this.ctx.fillText(placement.id.replace(/^tile:/, ''), x + 5, y + 12);
      }
    }
    this.ctx.restore();
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

  private lastInspectorHtml = '';

  private renderInspector(): void {
    const inspector = this.host.querySelector<HTMLElement>('#vw-inspector');
    if (!inspector) return;
    const profile = profileInfo(this.selectedProfile);
    const hover = this.hoverWorld ? this.chunkAt(this.hoverWorld.x, this.hoverWorld.y) : null;
    const mem = this.previewBytes();
    const profileDiff = this.profileDiff();
    const stats = this.cachedProfileStats();
    const html = `
      ${this.sectionHtml('inspector.status', 'Status', `
        <div class="vw-stat"><span>state</span><b class="vw-${this.status}">${this.status.toUpperCase()}</b></div>
        <div class="vw-message" aria-live="polite">${escapeHtml(this.statusText)}</div>
        <div class="vw-stat"><span>profile</span><b>${escapeHtml(profile.label)}</b></div>
        <div class="vw-stat"><span>biome</span><b>${escapeHtml(profile.biome)}</b></div>
        <div class="vw-stat"><span>cache</span><b>${this.activeChunks().length} chunks</b></div>
        <div class="vw-stat"><span>memory</span><b>${formatBytes(mem)}</b></div>
        <div class="vw-stat"><span>zoom</span><b>${this.zoom.toFixed(2)}x</b></div>
        <div class="vw-stat"><span>center</span><b>${Math.floor(this.camX)}, ${Math.floor(this.camY)}</b></div>
      `)}
      ${this.sectionHtml('inspector.profile', 'Profile Diff', `
        <div class="vw-stat"><span>changed</span><b>${profileDiff.length}</b></div>
        <div class="vw-message">${profileDiff.length > 0 ? escapeHtml(profileDiff.slice(0, 8).join(', ')) : 'Matches built-in preset'}</div>
      `)}
      ${this.sectionHtml('inspector.metrics', 'Metrics', `
        <div class="vw-stat"><span>window</span><b>${this.lastMetrics ? `${this.lastMetrics.chunks} chunks` : '-'}</b></div>
        <div class="vw-stat"><span>time</span><b>${this.lastMetrics ? `${this.lastMetrics.generatedMs.toFixed(1)} ms` : '-'}</b></div>
        <div class="vw-stat"><span>generated</span><b>${this.lastMetrics ? formatBytes(this.lastMetrics.generatedBytes) : '-'}</b></div>
        <div class="vw-stat"><span>transfer</span><b>${this.lastMetrics ? formatBytes(this.lastMetrics.transferBytes) : '-'}</b></div>
        <div class="vw-stat"><span>materials</span><b>${formatCount(stats.materialCells)}</b></div>
        <div class="vw-stat"><span>liquids</span><b>${formatCount(stats.liquidCells)}</b></div>
        <div class="vw-stat"><span>glow cells</span><b>${formatCount(stats.glowCells)}</b></div>
        <div class="vw-stat"><span>scenes</span><b>${stats.sceneCount}</b></div>
      `)}
      ${this.sectionHtml('inspector.chunk', 'Chunk', `
        ${
          hover
            ? `<div class="vw-stat"><span>coord</span><b>${hover.cx}, ${hover.cy}</b></div>
              <div class="vw-stat"><span>biome</span><b>${hover.meta.biome}</b></div>
              <div class="vw-stat"><span>time</span><b>${hover.metrics.generatedMs.toFixed(2)} ms</b></div>
              <div class="vw-stat"><span>hash</span><b>${hover.meta.hash}</b></div>
              <div class="vw-list"><span>tiles</span><p>${hover.meta.tileIds.map(escapeHtml).join(', ') || '-'}</p></div>
              <div class="vw-list"><span>scenes</span><p>${this.sceneSummaryHtml(hover)}</p></div>`
            : '<div class="vw-message">Move over a generated chunk.</div>'
        }
      `)}
      ${this.sectionHtml('inspector.next', 'Next', `
        <div class="vw-message">PLAY WINDOW launches a disposable fixed-size crop around the current map center using these generation settings.</div>
      `)}`;
    // movePointer/updateCaption call this on every pointermove over the stage;
    // skipping the innerHTML rebuild when nothing changed preserves keyboard
    // focus and any in-progress text selection (e.g. copying a chunk hash).
    if (html === this.lastInspectorHtml && inspector.childElementCount > 0) return;
    this.lastInspectorHtml = html;
    inspector.innerHTML = html;
    this.wireSections(inspector);
  }

  private updateCaption(): void {
    const caption = this.must<HTMLElement>('#vw-caption');
    caption.textContent = `${this.status.toUpperCase()} | ${this.activeChunks().length} CACHED | WASD / DRAG TO PAN | WHEEL TO ZOOM`;
    this.renderInspector();
  }

  private sceneSummaryHtml(chunk: TransferableVirtualChunk): string {
    if (chunk.meta.scenePlacements.length === 0) return '-';
    return chunk.meta.scenePlacements
      .map((placement) => {
        const objectCount = placement.objects.length;
        const lightCount = placement.lights.length;
        return `${escapeHtml(placement.id)} <em>${placement.w}x${placement.h}</em> <b>${objectCount} obj</b> <b>${lightCount} light</b>`;
      })
      .join('<br>');
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
    if (existing) {
      normalizeVirtualDef(existing);
      return existing;
    }
    const def = defaultDefForProfile(this.selectedProfile, this.profileSeed(this.selectedProfile));
    normalizeVirtualDef(def);
    this.defs.set(this.selectedProfile, def);
    return def;
  }

  private profileDiff(): string[] {
    const current = this.currentDef();
    const baseline = defaultDefForProfile(this.selectedProfile, this.profileSeed(this.selectedProfile));
    const changed: string[] = [];
    for (const key of Object.keys(GENERATION_DEFAULTS) as Array<keyof GenerationParams>) {
      if (current.generation[key] !== baseline.generation[key]) changed.push(`generation.${key}`);
    }
    for (const key of Object.keys(DRESSING_DEFAULTS) as Array<keyof DressingControls>) {
      if (current.dressing.controls[key] !== baseline.dressing.controls[key]) changed.push(`dressing.${key}`);
    }
    for (const key of Object.keys(current.dressing.scenes.controls) as Array<keyof SceneControls>) {
      if (current.dressing.scenes.controls[key] !== baseline.dressing.scenes.controls[key]) changed.push(`scenes.${key}`);
    }
    for (const kind of VIRTUAL_SCENE_KINDS) {
      if (current.dressing.scenes.biomes[profileBiome(this.selectedProfile)]?.[kind] !== baseline.dressing.scenes.biomes[profileBiome(this.selectedProfile)]?.[kind]) {
        changed.push(`scenes.${kind}`);
      }
    }
    return changed;
  }

  private cachedProfileStats(): VirtualProfileStats {
    const stats: VirtualProfileStats = {
      materialCells: 0,
      liquidCells: 0,
      glowCells: 0,
      sceneCount: 0,
    };
    const seenScenes = new Set<string>();
    for (const cached of this.activeChunks()) {
      const chunk = cached.chunk as TransferableVirtualChunk & { meta?: { scenePlacements?: Array<{ id?: string }> } };
      for (const placement of chunk.meta?.scenePlacements ?? []) {
        const id = placement.id ?? '';
        if (id && !seenScenes.has(id)) {
          seenScenes.add(id);
          stats.sceneCount += 1;
        }
      }
      stats.materialCells += chunk.metrics.materialCells;
      stats.liquidCells += chunk.metrics.liquidCells;
      stats.glowCells += chunk.metrics.glowCells;
    }
    return stats;
  }

  private exportProfile(): void {
    const profile = exportableVirtualProfile(this.currentDef());
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = typeof profile.name === 'string' ? profile.name : this.selectedProfile;
    a.download = `${safeFileName(name)}.virtual-world-profile.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    this.statusText = 'Exported world-generation profile';
    this.renderInspector();
  }

  private async importProfile(): Promise<void> {
    this.cancel();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    const file = await new Promise<File | null>((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.click();
    });
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as Partial<VirtualWorldDef>;
      const def = mergeImportedProfile(raw, this.selectedProfile, this.profileSeed(this.selectedProfile));
      this.defs.set(this.selectedProfile, def);
      this.chunks.clear();
      this.lastMetrics = null;
      this.status = 'idle';
      this.statusText = `Imported ${def.name}`;
      this.lastAutoCenter = '';
      this.renderControls();
      this.requestDraw();
    } catch (error) {
      this.status = 'error';
      this.statusText = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
      this.renderControls();
    }
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

function normalizeVirtualDef(def: VirtualWorldDef): void {
  normalizeGeneration(def);
  normalizeDressing(def);
}

function normalizeGeneration(def: VirtualWorldDef): void {
  const raw = (def as VirtualWorldDef & { generation?: Partial<GenerationParams> }).generation ?? {};
  def.generation = {
    ...GENERATION_DEFAULTS,
    ...raw,
  };
  const generation = def.generation as GenerationParams & Partial<Record<keyof GenerationParams, number>>;
  for (const [key, fallback] of Object.entries(GENERATION_DEFAULTS) as Array<[keyof GenerationParams, number]>) {
    if (!Number.isFinite(generation[key])) generation[key] = fallback;
  }
}

function normalizeDressing(def: VirtualWorldDef): void {
  if (!def.dressing) def.dressing = createDefaultDressingProfile();
  const fallback = createDefaultDressingProfile();
  const rawScenes = def.dressing.scenes ?? fallback.scenes;
  const rawSceneControls = normalizeSceneControlAliases(rawScenes.controls ?? {});
  const rawBiomes = def.dressing.biomes ?? {};
  def.dressing.biomes = { ...fallback.biomes };
  for (const [biome, fallbackRecipe] of Object.entries(fallback.biomes) as Array<
    [VirtualBiomeId, VirtualWorldDef['dressing']['biomes'][VirtualBiomeId]]
  >) {
    const recipe = {
      ...fallbackRecipe,
      ...(rawBiomes[biome] ?? {}),
    };
    for (const [key, fallbackValue] of Object.entries(fallbackRecipe) as Array<
      [keyof typeof fallbackRecipe, number]
    >) {
      if (!Number.isFinite(recipe[key])) recipe[key] = fallbackValue;
    }
    def.dressing.biomes[biome] = recipe;
  }
  def.dressing.controls = {
    ...DRESSING_DEFAULTS,
    ...(def.dressing.controls ?? {}),
  };
  for (const [key, fallbackValue] of Object.entries(DRESSING_DEFAULTS) as Array<[keyof DressingControls, number]>) {
    const value = def.dressing.controls[key];
    def.dressing.controls[key] = Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : fallbackValue;
  }
  def.dressing.scenes = {
    controls: {
      ...SCENE_CONTROL_DEFAULTS,
      ...rawSceneControls,
    },
    biomes: { ...fallback.scenes.biomes },
  };
  const sceneControls = def.dressing.scenes.controls;
  sceneControls.density = Number.isFinite(sceneControls.density)
    ? Math.max(0, Math.min(2, sceneControls.density))
    : SCENE_CONTROL_DEFAULTS.density;
  sceneControls.maxPerTile = Number.isFinite(sceneControls.maxPerTile)
    ? Math.max(0, Math.min(6, Math.round(sceneControls.maxPerTile)))
    : SCENE_CONTROL_DEFAULTS.maxPerTile;
  const rawSceneBiomes = rawScenes.biomes ?? {};
  for (const [biome, fallbackBudget] of Object.entries(fallback.scenes.biomes) as Array<
    [VirtualBiomeId, VirtualSceneBudget]
  >) {
    const budget = {
      ...fallbackBudget,
      ...(rawSceneBiomes[biome] ?? {}),
    };
    for (const kind of VIRTUAL_SCENE_KINDS) {
      const value = budget[kind];
      budget[kind] = Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : fallbackBudget[kind];
    }
    def.dressing.scenes.biomes[biome] = budget;
  }
}

function normalizeSceneControlAliases(
  controls: Partial<SceneControls> & { maxPerChunk?: number },
): Partial<SceneControls> {
  if (!Number.isFinite(controls.maxPerTile) && Number.isFinite(controls.maxPerChunk)) {
    return { ...controls, maxPerTile: controls.maxPerChunk };
  }
  return controls;
}

function applyGenerationPreset(def: VirtualWorldDef, preset: Exclude<CaveStylePresetId, 'custom'>): void {
  Object.assign(def.generation, CAVE_STYLE_PRESETS[preset]);
}

function applyVirtualLevelProfile(def: VirtualWorldDef, level: LevelDef): void {
  const biome = level.biome as VirtualBiomeId;
  def.name = `${level.name} Virtual World`;
  def.map.cells.fill(biomeIndexFromId(biome));
  resetProfileTuning(def, level.id);
}

function resetProfileTuning(def: VirtualWorldDef, profile: VirtualWorldProfileId): void {
  Object.assign(def.generation, generationDefaultsForProfile(profile));
  Object.assign(def.dressing.controls, dressingDefaultsForProfile(profile));
  Object.assign(def.dressing.scenes.controls, sceneControlDefaultsForProfile(profile));
  resetSceneBudgetForProfile(def, profile);
}

function defaultDefForProfile(profile: VirtualWorldProfileId, seed: number): VirtualWorldDef {
  const def = createDefaultVirtualWorldDef(seed);
  def.id = `virtual-${profile}`;
  def.name = profile === 'global' ? 'Global Virtual World' : `${LEVELS[profile]?.name ?? profile} Virtual World`;
  const level = LEVELS[profile];
  if (level) applyVirtualLevelProfile(def, level);
  normalizeVirtualDef(def);
  return def;
}

function profileBiome(profile: VirtualWorldProfileId): VirtualBiomeId {
  return (LEVELS[profile]?.biome as VirtualBiomeId | undefined) ?? 'earthen';
}

function exportableVirtualProfile(def: VirtualWorldDef): Record<string, unknown> {
  return {
    v: 1,
    kind: 'alchemists-descent.virtual-world-profile',
    id: def.id,
    name: def.name,
    seed: def.seed >>> 0,
    generation: { ...def.generation },
    dressing: {
      controls: { ...def.dressing.controls },
      scenes: {
        controls: { ...def.dressing.scenes.controls },
        biomes: Object.fromEntries(
          Object.entries(def.dressing.scenes.biomes).map(([biome, budget]) => [biome, { ...budget }]),
        ),
      },
    },
  };
}

function mergeImportedProfile(raw: Partial<VirtualWorldDef>, profile: VirtualWorldProfileId, seed: number): VirtualWorldDef {
  const def = defaultDefForProfile(profile, seed);
  if (typeof raw.name === 'string' && raw.name.trim()) def.name = raw.name.trim();
  if (Number.isFinite(raw.seed)) def.seed = Number(raw.seed) >>> 0;
  if (raw.generation) Object.assign(def.generation, raw.generation);
  if (raw.dressing?.controls) Object.assign(def.dressing.controls, raw.dressing.controls);
  if (raw.dressing?.scenes?.controls) Object.assign(def.dressing.scenes.controls, raw.dressing.scenes.controls);
  if (raw.dressing?.scenes?.biomes) {
    for (const [biome, budget] of Object.entries(raw.dressing.scenes.biomes)) {
      const target = def.dressing.scenes.biomes[biome as VirtualBiomeId];
      if (!target || !budget) continue;
      for (const kind of VIRTUAL_SCENE_KINDS) {
        const value = (budget as Partial<VirtualSceneBudget>)[kind];
        if (Number.isFinite(value)) target[kind] = Number(value);
      }
    }
  }
  normalizeVirtualDef(def);
  return def;
}

function safeFileName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'virtual-world-profile';
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function generationDefaultsForProfile(profile: VirtualWorldProfileId): GenerationParams {
  const level = LEVELS[profile];
  return {
    ...GENERATION_DEFAULTS,
    ...(level ? PROFILE_GENERATION_PRESETS[level.biome] : {}),
  };
}

function dressingDefaultsForProfile(profile: VirtualWorldProfileId): DressingControls {
  const level = LEVELS[profile];
  return {
    ...DRESSING_DEFAULTS,
    ...(level ? PROFILE_DRESSING_PRESETS[level.biome] : {}),
  };
}

function sceneControlDefaultsForProfile(profile: VirtualWorldProfileId): SceneControls {
  const level = LEVELS[profile];
  return {
    ...SCENE_CONTROL_DEFAULTS,
    ...(level ? PROFILE_SCENE_CONTROL_PRESETS[level.biome] : {}),
  };
}

function resetSceneBudgetForProfile(def: VirtualWorldDef, profile: VirtualWorldProfileId): void {
  const fallback = createDefaultDressingProfile();
  const biome = sceneBudgetBiomeForProfile(def, profile);
  def.dressing.scenes.biomes[biome] = { ...fallback.scenes.biomes[biome] };
}

function sceneBudgetBiomeForProfile(def: VirtualWorldDef, profile: VirtualWorldProfileId): VirtualBiomeId {
  const level = LEVELS[profile];
  if (level) return level.biome as VirtualBiomeId;
  return biomeIdFromIndex(def.map.cells[0] ?? 0);
}

function sceneKindLabel(kind: VirtualSceneKind): string {
  return kind.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`);
}

function isVirtualSceneKind(value: string): value is VirtualSceneKind {
  return (VIRTUAL_SCENE_KINDS as readonly string[]).includes(value);
}

function generationStyle(def: VirtualWorldDef): CaveStylePresetId {
  for (const preset of ['structured', 'natural', 'wild'] as const) {
    if (matchesGenerationPreset(def.generation, CAVE_STYLE_PRESETS[preset])) return preset;
  }
  return 'custom';
}

function matchesGenerationPreset(generation: GenerationParams, preset: Partial<GenerationParams>): boolean {
  return (Object.entries(preset) as Array<[keyof GenerationParams, number]>).every(
    ([key, value]) => Math.abs((generation[key] ?? Number.NaN) - value) < 0.0001,
  );
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

function profileInfo(profile: VirtualWorldProfileId): { label: string; biome: string } {
  const level = LEVELS[profile];
  if (!level) return { label: 'Global prototype', biome: 'mixed prototype' };
  return { label: profileLabel(level), biome: BIOMES[level.biome].name };
}

function profileStatusText(profile: VirtualWorldProfileId): string {
  const level = LEVELS[profile];
  if (!level) return 'Global prototype profile';
  return `${level.name} profile uses ${BIOMES[level.biome].name}`;
}

function biomeColor(biome: string): string {
  if (biome === 'earthen') return '#f7c076';
  if (biome === 'fungal') return '#86efac';
  if (biome === 'frozen') return '#93c5fd';
  if (biome === 'flooded') return '#67e8f9';
  if (biome === 'timber') return '#a3e635';
  if (biome === 'crystal') return '#c4b5fd';
  if (biome === 'scorched') return '#fb923c';
  if (biome === 'volcanic') return '#f97316';
  if (biome === 'gilded') return '#facc15';
  return '#b7c9dc';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


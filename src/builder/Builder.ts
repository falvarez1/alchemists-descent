import type { BiomeId, Ctx, EnemyKind, PickupKind } from '@/core/types';
import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import {
  applyWorldLayer,
  captureWorldLayer,
  createEmptyDocument,
  freshId,
  loadDocLibrary,
  objectFootprint,
  paramNum,
  saveDocLibrary,
} from '@/builder/document';
import type {
  EditorDocument,
  EditorLight,
  EditorLink,
  EditorObject,
  EditorObjectKind,
} from '@/builder/document';
import {
  addLightCmd,
  addLinkCmd,
  addObjectCmd,
  CommandStack,
  compositeCmd,
  deleteLightCmd,
  deleteLinkCmd,
  deleteObjectCmd,
  editLightCmd,
  editParamCmd,
  moveLightCmd,
  moveObjectCmd,
  paintTerrainCmd,
} from '@/builder/commands';
import type { CellPatch, Command } from '@/builder/commands';
import { drawLine, spawnCircle } from '@/sim/brush';
import { compileAndPlaytest } from '@/builder/compile';
import { TRIGGER_KINDS, validateDocument } from '@/builder/validate';
import type { DocIssue } from '@/builder/validate';
import {
  floodFill,
  PatchRecorder,
  replaceMaterial,
  stampEllipse,
  stampLine,
  stampRect,
} from '@/builder/terrain';
import type { Region } from '@/builder/terrain';
import { PASSES, runPass } from '@/builder/procedural';

/**
 * The Builder (docs/BUILDER.md Phases 2-10): an authoring overlay on top of
 * the paused sandbox. It edits an EditorDocument — the document is the
 * source of truth; the live world is the terrain layer's editing surface.
 * PLAYTEST compiles a disposable runtime; scars never flow back.
 *
 * Tool surfaces: select/move · terrain (paint, line, rect, ellipse, flood
 * fill, replace, region) · gameplay objects · mechanisms with a LINK tool
 * (several triggers on one door = the runtime's AND gate) · authored lights ·
 * seeded procedural passes with preview/apply/discard.
 *
 * Session model: mode stays 'build', ctx.state.paused freezes the sim while
 * the overlay is up (rendering continues — WASD still pans the camera via
 * the build-mode Camera branch). All Builder DOM is injected here so the
 * tool owns its markup end to end.
 */

const PLACE_GAMEPLAY: Array<{ kind: EditorObjectKind; label: string; glyph: string }> = [
  { kind: 'spawn', label: 'Spawn', glyph: 'S' },
  { kind: 'enemy', label: 'Enemy', glyph: 'E' },
  { kind: 'pickup', label: 'Pickup', glyph: 'P' },
  { kind: 'exitPortal', label: 'Portal', glyph: 'X' },
  { kind: 'exitWell', label: 'Exit Well', glyph: 'O' },
  { kind: 'waystone', label: 'Waystone', glyph: 'W' },
  { kind: 'cauldron', label: 'Cauldron', glyph: 'U' },
  { kind: 'bossMarker', label: 'Boss', glyph: 'B' },
];

const PLACE_MECH: Array<{ kind: EditorObjectKind; label: string; glyph: string }> = [
  { kind: 'door', label: 'Door', glyph: 'D' },
  { kind: 'plate', label: 'Plate', glyph: '=' },
  { kind: 'lever', label: 'Lever', glyph: '/' },
  { kind: 'brazier', label: 'Brazier', glyph: '^' },
  { kind: 'scale', label: 'Scale', glyph: '#' },
  { kind: 'buoy', label: 'Buoy', glyph: '~' },
  { kind: 'chargeLatch', label: 'Latch', glyph: 'Z' },
  { kind: 'runeGlyph', label: 'Rune', glyph: 'R' },
  { kind: 'runeDoor', label: 'RuneDoor', glyph: 'G' },
];

const GLYPH: Partial<Record<EditorObjectKind, string>> = Object.fromEntries(
  [...PLACE_GAMEPLAY, ...PLACE_MECH].map((p) => [p.kind, p.glyph]),
);

const DEFAULT_PARAMS: Partial<Record<EditorObjectKind, () => Record<string, unknown>>> = {
  spawn: () => ({}),
  enemy: () => ({ kind: 'slime' }),
  pickup: () => ({ kind: 'goldpile', amount: 30 }),
  exitPortal: () => ({ alwaysOpen: false }),
  waystone: () => ({ lit: false }),
  exitWell: () => ({ halfW: 14 }),
  cauldron: () => ({}),
  bossMarker: () => ({}),
  door: () => ({ w: 3, h: 13, initialOpen: false }),
  plate: () => ({ w: 5 }),
  lever: () => ({}),
  brazier: () => ({}),
  scale: () => ({ w: 7, threshold: 24 }),
  buoy: () => ({ w: 13, depth: 4, threshold: 26 }),
  chargeLatch: () => ({}),
  runeGlyph: () => ({}),
  runeDoor: () => ({ w: 2, h: 11 }),
};

const ENEMY_KINDS: EnemyKind[] = [
  'slime', 'imp', 'golem', 'acidslime', 'wisp', 'mage', 'bat', 'spitter', 'bomber', 'eggs', 'colossus',
];
const PICKUP_KINDS: PickupKind[] = ['goldpile', 'heart', 'tome', 'chest', 'potion', 'key'];
const BIOMES: BiomeId[] = [
  'earthen', 'frozen', 'flooded', 'timber', 'scorched', 'fungal', 'crystal', 'volcanic',
];

/** How close (in cells) an overlay click must be to count as selecting. */
const PICK_RADIUS = 7;
/** Beyond this many touched cells a stroke still paints, but won't undo. */
const STROKE_UNDO_CAP = 150000;
const FLOOD_CAP = 200000;
const REPLACE_CAP = 400000;

const SHAPE_TOOLS = new Set(['line', 'rect', 'rectFill', 'ellipse', 'ellipseFill']);
type BuilderTool =
  | 'select'
  | 'paint'
  | 'line'
  | 'rect'
  | 'rectFill'
  | 'ellipse'
  | 'ellipseFill'
  | 'fill'
  | 'replace'
  | 'region'
  | 'link'
  | 'light'
  | EditorObjectKind;

interface PendingPreview {
  before: CellPatch;
  after: CellPatch;
  passId: string;
  seed: number;
  density: number;
  material: number;
  region: Region;
  summary: string;
}

export class Builder {
  private doc: EditorDocument;
  private readonly cmds = new CommandStack(() => this.doc);
  private isOpen = false;
  private ownsPause = false;
  private returningFromPlaytest = false;
  /** Live world has terrain edits the document hasn't captured yet. */
  private paintDirty = false;

  private selectedId: string | null = null;
  private tool: BuilderTool = 'select';
  private drag: {
    target: EditorObject | EditorLight;
    isLight: boolean;
    origX: number;
    origY: number;
    grabX: number;
    grabY: number;
  } | null = null;
  private stroke: { seen: Set<number>; before: CellPatch; lastX: number; lastY: number } | null = null;
  private shapeDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private region: Region | null = null;
  private linkFrom: string | null = null;
  private pendingPreview: PendingPreview | null = null;
  private lastMouse = { x: 0, y: 0 };

  private root!: HTMLDivElement;
  private overlay!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private cctx!: CanvasRenderingContext2D;
  private markerLayer!: HTMLDivElement;
  private markers = new Map<string, HTMLDivElement>();
  private modeBtn!: HTMLButtonElement;
  private rafId = 0;
  private statusTimer = 0;

  constructor(private ctx: Ctx) {
    this.doc = createEmptyDocument('untitled', ctx.state.currentBiome);
    this.buildDom();
    this.wireBar();
    this.wireProcPanel();
    this.wirePointer();
    window.addEventListener('keydown', this.onKeyDown, true);
    // Entering play (PLAY button) while authoring closes the overlay; the
    // document survives for the next open.
    ctx.events.on('modeChanged', ({ mode }) => {
      if (mode === 'play' && this.isOpen) this.close();
    });
    // Sandbox world-shaping buttons also edit terrain — the document must
    // re-capture before the next validate/playtest/save.
    for (const id of ['btn-caves', 'btn-fortress', 'clear-btn']) {
      document.getElementById(id)?.addEventListener('click', () => {
        if (this.isOpen) this.paintDirty = true;
      });
    }
  }

  /* ===================== open / close ===================== */

  open(): void {
    if (this.isOpen) return;
    // The Builder rides on build mode; leave the descent first if needed.
    if (this.ctx.state.mode === 'play') {
      (document.getElementById('mode-build-btn') as HTMLButtonElement | null)?.click();
    }
    this.isOpen = true;
    if (!this.ctx.state.paused) {
      this.ctx.state.paused = true;
      this.ownsPause = true;
    }
    if (this.returningFromPlaytest && this.doc.world) {
      // The compiled playtest scarred a COPY; re-decode the authored layer.
      applyWorldLayer(this.ctx, this.doc.world);
      this.ctx.enemies.length = 0;
      this.ctx.projectiles.length = 0;
      this.ctx.particles.clear();
      this.status('PLAYTEST DISCARDED — DOCUMENT TERRAIN RESTORED');
    }
    this.returningFromPlaytest = false;
    this.root.style.display = '';
    this.modeBtn.classList.add('active');
    document.body.classList.add('builder-open');
    this.refreshDocSelect();
    this.syncAll();
    this.rafId = requestAnimationFrame(this.loop);
  }

  close(): void {
    if (!this.isOpen) return;
    this.discardPreview(true);
    this.isOpen = false;
    cancelAnimationFrame(this.rafId);
    if (this.ownsPause) {
      this.ctx.state.paused = false;
      this.ownsPause = false;
    }
    this.tool = 'select';
    this.drag = null;
    this.stroke = null;
    this.shapeDrag = null;
    this.linkFrom = null;
    this.root.style.display = 'none';
    this.modeBtn.classList.remove('active');
    document.body.classList.remove('builder-open');
  }

  /* ===================== DOM scaffold ===================== */

  private buildDom(): void {
    // Header toggle, third seat in the existing mode switch.
    this.modeBtn = document.createElement('button');
    this.modeBtn.id = 'mode-builder-btn';
    this.modeBtn.textContent = 'BUILDER';
    this.modeBtn.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    document.querySelector('.mode-switch')?.appendChild(this.modeBtn);

    const holder = document.getElementById('canvas-holder');
    this.root = document.createElement('div');
    this.root.id = 'builder-root';
    this.root.style.display = 'none';
    const toolBtn = (tool: string, glyph: string, title: string): string =>
      `<button class="bp-tool bp-icon" data-tool="${tool}" title="${title}"><span class="bp-glyph k-${tool}">${glyph}</span></button>`;
    const placeBtn = (p: { kind: EditorObjectKind; label: string; glyph: string }): string =>
      `<button class="bp-tool bp-mini" data-kind="${p.kind}" title="${p.label}"><span class="bp-glyph k-${p.kind}">${p.glyph}</span>${p.label}</button>`;
    this.root.innerHTML = `
      <div id="builder-bar">
        <span class="b-title">BUILDER</span>
        <input id="b-doc-name" value="untitled" spellcheck="false" title="Document name">
        <select id="b-biome" title="Document biome"></select>
        <button id="b-new" title="New document">NEW</button>
        <select id="b-doc-select" title="Saved documents"></select>
        <button id="b-load">LOAD</button>
        <button id="b-save">SAVE</button>
        <button id="b-export">EXPORT</button>
        <label for="b-import" class="b-filebtn">IMPORT</label>
        <input type="file" id="b-import" accept=".json" hidden>
        <span class="b-sep"></span>
        <button id="b-undo" title="Ctrl+Z">&#8617;</button>
        <button id="b-redo" title="Ctrl+Y">&#8618;</button>
        <span class="b-sep"></span>
        <button id="b-capture" title="Snapshot the live sandbox cells into the document">CAPTURE TERRAIN</button>
        <button id="b-validate">VALIDATE</button>
        <button id="b-playtest" class="b-accent">PLAYTEST</button>
        <button id="b-exit">EXIT</button>
      </div>
      <div id="builder-overlay"><canvas id="builder-canvas"></canvas><div id="builder-markers"></div></div>
      <div id="builder-palette">
        <div class="bp-head">TOOLS</div>
        <div class="bp-grid bp-grid5">
          ${toolBtn('select', 'V', 'Select / Move (V)')}
          ${toolBtn('paint', 'B', 'Paint cells — Sandbox material & brush (B)')}
          ${toolBtn('line', '\\', 'Line (L)')}
          ${toolBtn('rect', '▭', 'Rectangle outline')}
          ${toolBtn('rectFill', '▬', 'Filled rectangle')}
          ${toolBtn('ellipse', '○', 'Ellipse outline')}
          ${toolBtn('ellipseFill', '●', 'Filled ellipse')}
          ${toolBtn('fill', 'G', 'Flood fill the clicked area (G)')}
          ${toolBtn('replace', '⇄', 'Replace clicked material everywhere (respects region)')}
          ${toolBtn('region', '▦', 'Select a region for passes & replace (R)')}
        </div>
        <div class="bp-head">PLACE</div>
        <div class="bp-grid bp-grid2">${PLACE_GAMEPLAY.map(placeBtn).join('')}</div>
        <div class="bp-head">MECHANISMS</div>
        <div class="bp-grid bp-grid2">${PLACE_MECH.map(placeBtn).join('')}</div>
        <button class="bp-tool" data-tool="link"><span class="bp-glyph k-link">K</span>Link trigger &rarr; door (K)</button>
        <div class="bp-head">LIGHTING</div>
        <button class="bp-tool" data-tool="light"><span class="bp-glyph k-light">*</span>Authored Light</button>
        <div class="bp-head">PROCEDURAL</div>
        <button id="bp-proc-btn">SEEDED PASSES&hellip;</button>
        <div class="bp-hint">RMB eyedrops. Shapes use<br>the Sandbox material; paint<br>uses brush radius too.<br>Several triggers on ONE<br>door = AND gate.<br>ESC steps back &middot; DEL removes.</div>
      </div>
      <div id="builder-inspector"></div>
      <div id="builder-proc" style="display:none">
        <div class="bi-head">PROCEDURAL PASS <button id="bp-proc-close">&times;</button></div>
        <div class="bi-row"><span>pass</span><select id="bp-pass">${PASSES.map(
          (p) => `<option value="${p.id}">${p.label}</option>`,
        ).join('')}</select></div>
        <div class="bi-row"><span>seed</span><input id="bp-seed" type="number" value="1337"><button id="bp-dice" title="Re-roll seed">&#9860;</button></div>
        <div class="bi-row"><span>density</span><input id="bp-density" type="range" min="5" max="100" value="50"></div>
        <div class="bi-row"><span>target</span><b id="bp-target">whole level</b></div>
        <div class="bi-row"><span>material</span><b id="bp-material">&mdash;</b></div>
        <div class="bp-actions">
          <button id="bp-preview">PREVIEW</button>
          <button id="bp-apply" class="b-accent">APPLY</button>
          <button id="bp-discard">DISCARD</button>
        </div>
        <div class="bp-hint" id="bp-status">Cell passes preview before<br>committing; population passes<br>apply directly (undoable).</div>
      </div>
      <div id="builder-issues" style="display:none"></div>
      <div id="builder-status"></div>`;
    holder?.appendChild(this.root);

    this.overlay = this.root.querySelector('#builder-overlay') as HTMLDivElement;
    this.canvas = this.root.querySelector('#builder-canvas') as HTMLCanvasElement;
    this.cctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.markerLayer = this.root.querySelector('#builder-markers') as HTMLDivElement;

    const biome = this.el<HTMLSelectElement>('b-biome');
    for (const b of BIOMES) {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = b;
      biome.appendChild(opt);
    }

    // Keystrokes inside Builder fields are the Builder's: stop them before
    // they bubble to InputManager (else typing a name pans the camera).
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.addEventListener('keyup', (e) => e.stopPropagation());

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.bp-tool')) {
      btn.addEventListener('click', () => {
        const t = (btn.dataset.tool ?? btn.dataset.kind) as BuilderTool;
        this.setTool(this.tool === t && t !== 'select' ? 'select' : t);
      });
    }
  }

  private el<T extends HTMLElement>(id: string): T {
    return this.root.querySelector('#' + id) as T;
  }

  private setTool(t: BuilderTool): void {
    this.tool = t;
    if (t !== 'link') this.linkFrom = null;
    this.syncPalette();
    if (t === 'link') this.status('LINK: CLICK A TRIGGER OR RUNE GLYPH, THEN ITS DOOR');
  }

  /* ===================== top bar actions ===================== */

  /** True (and complains) while a procedural preview awaits a decision. */
  private previewBlocks(): boolean {
    if (!this.pendingPreview) return false;
    this.status('APPLY OR DISCARD THE PROCEDURAL PREVIEW FIRST', true);
    return true;
  }

  private wireBar(): void {
    this.el<HTMLInputElement>('b-doc-name').addEventListener('change', (e) => {
      this.doc.name = (e.target as HTMLInputElement).value.trim() || 'untitled';
    });
    this.el<HTMLSelectElement>('b-biome').addEventListener('change', (e) => {
      this.doc.biome = (e.target as HTMLSelectElement).value as BiomeId;
    });

    this.el('b-new').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      if (this.doc.objects.length > 0 && !window.confirm('Discard the current document?')) return;
      this.doc = createEmptyDocument('untitled', this.ctx.state.currentBiome);
      this.cmds.clear();
      this.selectedId = null;
      this.paintDirty = false;
      this.region = null;
      this.syncAll();
      this.status('NEW DOCUMENT');
    });

    this.el('b-save').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      this.ensureCaptured();
      const lib = loadDocLibrary();
      lib[this.doc.id] = this.doc;
      if (saveDocLibrary(lib)) this.status(`SAVED "${this.doc.name.toUpperCase()}"`);
      else this.status('STORAGE FULL — USE EXPORT', true);
      this.refreshDocSelect();
    });

    this.el('b-load').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      const id = this.el<HTMLSelectElement>('b-doc-select').value;
      const saved = loadDocLibrary()[id];
      if (!saved) return;
      // Clone so edits never mutate the library copy until the next SAVE.
      this.doc = JSON.parse(JSON.stringify(saved)) as EditorDocument;
      this.cmds.clear();
      this.selectedId = null;
      this.paintDirty = false;
      this.region = null;
      this.applyDocTerrain();
      this.syncAll();
      this.status(`LOADED "${this.doc.name.toUpperCase()}"`);
    });

    this.el('b-export').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      this.ensureCaptured();
      const blob = new Blob([JSON.stringify(this.doc)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this.doc.name || 'level'}.builder.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    this.el<HTMLInputElement>('b-import').addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as EditorDocument;
          if (parsed.v !== 2 || !Array.isArray(parsed.objects)) throw new Error('bad');
          parsed.links = parsed.links ?? [];
          parsed.lights = parsed.lights ?? [];
          parsed.proceduralHistory = parsed.proceduralHistory ?? [];
          this.doc = parsed;
          this.cmds.clear();
          this.selectedId = null;
          this.paintDirty = false;
          this.applyDocTerrain();
          this.syncAll();
          this.status(`IMPORTED "${this.doc.name.toUpperCase()}"`);
        } catch {
          this.status('NOT A BUILDER DOCUMENT', true);
        }
        input.value = '';
      });
    });

    this.el('b-undo').addEventListener('click', () => this.undo());
    this.el('b-redo').addEventListener('click', () => this.redo());

    this.el('b-capture').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      this.doc.world = captureWorldLayer(this.ctx);
      this.paintDirty = false;
      this.status('TERRAIN CAPTURED INTO DOCUMENT');
    });

    this.el('b-validate').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      this.ensureCaptured();
      const issues = validateDocument(this.doc);
      this.doc.validation = {
        at: new Date().toISOString(),
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
      };
      this.renderIssues(issues);
      this.status(issues.length === 0 ? 'VALID — NO ISSUES' : `${issues.length} ISSUE(S)`);
    });

    this.el('b-playtest').addEventListener('click', () => this.playtest());
    this.el('b-exit').addEventListener('click', () => this.close());
  }

  /**
   * Lazy terrain sync: in-builder paint edits the LIVE world; the document
   * re-captures right before anything reads doc.world as the truth.
   */
  private ensureCaptured(): void {
    if (!this.paintDirty) return;
    this.doc.world = captureWorldLayer(this.ctx);
    this.paintDirty = false;
  }

  private playtest(): void {
    if (this.previewBlocks()) return;
    this.ensureCaptured();
    const issues = validateDocument(this.doc);
    this.renderIssues(issues);
    if (issues.some((i) => i.severity === 'error')) {
      this.status('FIX ERRORS BEFORE PLAYTEST', true);
      return;
    }
    this.returningFromPlaytest = true;
    this.close();
    compileAndPlaytest(this.ctx, this.doc);
    (document.getElementById('mode-play-btn') as HTMLButtonElement | null)?.click();
  }

  /** Re-decode the authored terrain into the live world (fresh combat state). */
  private applyDocTerrain(): void {
    if (!this.doc.world) return;
    applyWorldLayer(this.ctx, this.doc.world);
    this.ctx.enemies.length = 0;
    this.ctx.projectiles.length = 0;
    this.ctx.particles.clear();
  }

  private undo(): void {
    if (this.previewBlocks()) return;
    const label = this.cmds.undo();
    if (label === 'paint') this.paintDirty = true;
    this.status(label ? 'UNDID ' + label.toUpperCase() : 'NOTHING TO UNDO');
    this.syncAll();
  }

  private redo(): void {
    if (this.previewBlocks()) return;
    const label = this.cmds.redo();
    if (label === 'paint') this.paintDirty = true;
    this.status(label ? 'REDID ' + label.toUpperCase() : 'NOTHING TO REDO');
    this.syncAll();
  }

  /* ===================== pointer: tools ===================== */

  /** Screen -> world cells; the inverse of InputManager.getMouseGridCoords. */
  private mouseToWorld(e: MouseEvent): { x: number; y: number } {
    const rect = this.overlay.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    const zx = 0.5 + (u - 0.5) / this.ctx.camera.zoom;
    const zy = 0.5 + (v - 0.5) / this.ctx.camera.zoom;
    return {
      x: Math.floor(zx * VIEW_W) + this.ctx.camera.renderX,
      y: Math.floor(zy * VIEW_H) + this.ctx.camera.renderY,
    };
  }

  /** World cells -> overlay pixels (forward transform; used by the canvas). */
  private worldToScreen(wx: number, wy: number, rect: DOMRect): { x: number; y: number } {
    const cam = this.ctx.camera;
    const ux = ((wx - cam.renderX) / VIEW_W - 0.5) * cam.zoom + 0.5;
    const uy = ((wy - cam.renderY) / VIEW_H - 0.5) * cam.zoom + 0.5;
    return { x: ux * rect.width, y: uy * rect.height };
  }

  private wirePointer(): void {
    // RMB is the eyedropper, never the browser menu (Sandbox parity).
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    this.overlay.addEventListener('mousedown', (e) => {
      const pos = this.mouseToWorld(e);
      if (e.button === 2) {
        this.eyedrop(pos.x, pos.y);
        return;
      }
      if (e.button !== 0) return;
      if (this.tool === 'paint') {
        this.beginStroke(pos.x, pos.y);
        return;
      }
      if (SHAPE_TOOLS.has(this.tool) || this.tool === 'region') {
        this.shapeDrag = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
        return;
      }
      if (this.tool === 'fill') {
        this.commitFlood(pos.x, pos.y);
        return;
      }
      if (this.tool === 'replace') {
        this.commitReplace(pos.x, pos.y);
        return;
      }
      if (this.tool === 'link') {
        this.linkClick(pos.x, pos.y);
        return;
      }
      if (this.tool === 'light') {
        this.placeLight(pos.x, pos.y);
        return;
      }
      if (this.tool !== 'select') {
        // every non-object tool was handled above; what's left is a placement
        this.place(this.tool as EditorObjectKind, pos.x, pos.y);
        this.setTool('select');
        return;
      }
      const hit = this.hitTest(pos.x, pos.y);
      this.select(hit?.id ?? null);
      if (hit && !hit.target.locked) {
        this.drag = {
          target: hit.target,
          isLight: hit.isLight,
          origX: hit.target.x,
          origY: hit.target.y,
          grabX: pos.x - hit.target.x,
          grabY: pos.y - hit.target.y,
        };
      }
    });
    window.addEventListener('mousemove', (e) => {
      const pos = this.mouseToWorld(e);
      this.lastMouse = pos;
      if (this.stroke) {
        this.strokeMove(pos.x, pos.y);
        return;
      }
      if (this.shapeDrag) {
        this.shapeDrag.x1 = pos.x;
        this.shapeDrag.y1 = pos.y;
        return;
      }
      if (!this.drag) return;
      this.drag.target.x = pos.x - this.drag.grabX;
      this.drag.target.y = pos.y - this.drag.grabY;
    });
    window.addEventListener('mouseup', () => {
      if (this.stroke) {
        this.endStroke();
        return;
      }
      if (this.shapeDrag) {
        const s = this.shapeDrag;
        this.shapeDrag = null;
        if (this.tool === 'region') this.commitRegion(s);
        else this.commitShape(s);
        return;
      }
      if (!this.drag) return;
      const { target, isLight, origX, origY } = this.drag;
      const toX = target.x;
      const toY = target.y;
      this.drag = null;
      if (toX === origX && toY === origY) return;
      // Rewind the live preview, then land the move as one undoable command.
      target.x = origX;
      target.y = origY;
      this.cmds.run(
        isLight
          ? moveLightCmd(target as EditorLight, toX, toY)
          : moveObjectCmd(target as EditorObject, toX, toY),
      );
      this.renderInspector();
    });
  }

  /* ---------- terrain painting (brush stroke; live world is the layer) ---------- */

  /** Guard: terrain tools need a material, not a build-mode spell. */
  private materialOrComplain(): number | null {
    const state = this.ctx.state;
    if (state.activeInputMode === 'spell') {
      this.status('SPELLS NEED THE LIVE SANDBOX — PICK A MATERIAL FIRST', true);
      return null;
    }
    return state.currentElement;
  }

  private beginStroke(x: number, y: number): void {
    if (this.materialOrComplain() === null) return;
    this.stroke = {
      seen: new Set(),
      before: { idxs: [], types: [], colors: [], life: [], charge: [] },
      lastX: x,
      lastY: y,
    };
    this.recordAround(x, y, x, y);
    spawnCircle(this.ctx, x, y, this.ctx.state.currentElement);
  }

  private strokeMove(x: number, y: number): void {
    const s = this.stroke;
    if (!s) return;
    this.recordAround(s.lastX, s.lastY, x, y);
    drawLine(this.ctx, s.lastX, s.lastY, x, y, this.ctx.state.currentElement);
    s.lastX = x;
    s.lastY = y;
  }

  /** Snapshot pre-stroke cell state around a segment (once per cell per stroke). */
  private recordAround(x0: number, y0: number, x1: number, y1: number): void {
    const s = this.stroke;
    if (!s || s.seen.size > STROKE_UNDO_CAP) return;
    const w = this.ctx.world;
    const r = this.ctx.state.brushSize + 2;
    const minX = Math.max(0, Math.min(x0, x1) - r);
    const maxX = Math.min(w.width - 1, Math.max(x0, x1) + r);
    const minY = Math.max(0, Math.min(y0, y1) - r);
    const maxY = Math.min(w.height - 1, Math.max(y0, y1) + r);
    const b = s.before;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = w.idx(x, y);
        if (s.seen.has(i)) continue;
        s.seen.add(i);
        b.idxs.push(i);
        b.types.push(w.types[i]);
        b.colors.push(w.colors[i]);
        b.life.push(w.life[i]);
        b.charge.push(w.charge[i]);
      }
    }
  }

  private endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    this.paintDirty = true;
    if (s.seen.size > STROKE_UNDO_CAP) {
      this.status('HUGE STROKE — PAINTED WITHOUT UNDO', true);
      return;
    }
    // Keep only the cells the stroke actually changed.
    const w = this.ctx.world;
    const before: CellPatch = { idxs: [], types: [], colors: [], life: [], charge: [] };
    const after: CellPatch = { idxs: [], types: [], colors: [], life: [], charge: [] };
    for (let n = 0; n < s.before.idxs.length; n++) {
      const i = s.before.idxs[n];
      if (
        w.types[i] === s.before.types[n] &&
        w.colors[i] === s.before.colors[n] &&
        w.life[i] === s.before.life[n] &&
        w.charge[i] === s.before.charge[n]
      )
        continue;
      before.idxs.push(i);
      before.types.push(s.before.types[n]);
      before.colors.push(s.before.colors[n]);
      before.life.push(s.before.life[n]);
      before.charge.push(s.before.charge[n]);
      after.idxs.push(i);
      after.types.push(w.types[i]);
      after.colors.push(w.colors[i]);
      after.life.push(w.life[i]);
      after.charge.push(w.charge[i]);
    }
    if (before.idxs.length === 0) return;
    this.cmds.run(paintTerrainCmd(w, before, after));
    this.renderInspector(); // undo-depth row
  }

  /* ---------- terrain shape tools (Phase 4) ---------- */

  private commitShape(s: { x0: number; y0: number; x1: number; y1: number }): void {
    const type = this.materialOrComplain();
    if (type === null) return;
    const w = this.ctx.world;
    const rec = new PatchRecorder(w);
    if (this.tool === 'line') {
      stampLine(w, rec, s.x0, s.y0, s.x1, s.y1, this.ctx.state.brushSize, type);
    } else if (this.tool === 'rect' || this.tool === 'rectFill') {
      stampRect(w, rec, s.x0, s.y0, s.x1, s.y1, type, this.tool === 'rectFill');
    } else if (this.tool === 'ellipse' || this.tool === 'ellipseFill') {
      stampEllipse(w, rec, s.x0, s.y0, s.x1, s.y1, type, this.tool === 'ellipseFill');
    }
    const patch = rec.finish();
    if (!patch) return;
    this.cmds.run(paintTerrainCmd(w, patch.before, patch.after));
    this.paintDirty = true;
    this.status(`${this.tool.toUpperCase()}: ${patch.before.idxs.length} CELLS`);
    this.renderInspector();
  }

  private commitRegion(s: { x0: number; y0: number; x1: number; y1: number }): void {
    const x0 = Math.min(s.x0, s.x1),
      x1 = Math.max(s.x0, s.x1);
    const y0 = Math.min(s.y0, s.y1),
      y1 = Math.max(s.y0, s.y1);
    if (x1 - x0 < 3 || y1 - y0 < 3) {
      this.region = null;
      this.status('REGION CLEARED');
    } else {
      this.region = { x0, y0, x1, y1 };
      this.status(`REGION SET: ${x1 - x0 + 1}×${y1 - y0 + 1} — PASSES & REPLACE USE IT`);
    }
    this.syncProcPanel();
  }

  private commitFlood(x: number, y: number): void {
    const type = this.materialOrComplain();
    if (type === null) return;
    const w = this.ctx.world;
    const rec = new PatchRecorder(w);
    const n = floodFill(w, rec, x, y, type, FLOOD_CAP);
    if (n === -1) {
      this.status('AREA TOO LARGE TO FLOOD FILL', true);
      return;
    }
    const patch = rec.finish();
    if (!patch) return;
    this.cmds.run(paintTerrainCmd(w, patch.before, patch.after));
    this.paintDirty = true;
    this.status(`FLOOD FILLED ${n} CELLS`);
  }

  private commitReplace(x: number, y: number): void {
    const type = this.materialOrComplain();
    if (type === null) return;
    const w = this.ctx.world;
    if (!w.inBounds(x, y)) return;
    const from = w.types[w.idx(x, y)];
    const rec = new PatchRecorder(w);
    const n = replaceMaterial(w, rec, x, y, type, this.region, REPLACE_CAP);
    if (n === -1) {
      this.status('TOO MANY CELLS — SET A REGION FIRST (R)', true);
      return;
    }
    const patch = rec.finish();
    if (!patch) {
      this.status('NOTHING TO REPLACE');
      return;
    }
    this.cmds.run(paintTerrainCmd(w, patch.before, patch.after));
    this.paintDirty = true;
    const name = this.ctx.params.materials[from]?.name ?? 'material ' + from;
    this.status(`REPLACED ${n} ${name.toUpperCase()} CELLS${this.region ? ' IN REGION' : ''}`);
  }

  /** Sandbox-parity RMB: pick the material under the cursor, arm the brush. */
  private eyedrop(x: number, y: number): void {
    const ctx = this.ctx;
    if (!ctx.world.inBounds(x, y)) return;
    const t = ctx.world.types[ctx.world.idx(x, y)];
    const btn = document.querySelector<HTMLButtonElement>(
      `.tool-btn[data-mode="element"][data-id="${t}"]`,
    );
    if (btn) btn.click();
    else {
      ctx.state.currentElement = t as never;
      ctx.state.activeInputMode = 'element';
    }
    if (this.tool !== 'paint' && !SHAPE_TOOLS.has(this.tool) && this.tool !== 'fill' && this.tool !== 'replace') {
      this.setTool('paint');
    }
    const name = ctx.params.materials[t]?.name ?? 'Material ' + t;
    this.status('PICKED: ' + name.toUpperCase());
    this.syncProcPanel();
  }

  /* ---------- objects, links, lights ---------- */

  private place(kind: EditorObjectKind, x: number, y: number): void {
    // A document has exactly one spawn: placing again moves the existing one.
    if (kind === 'spawn') {
      const existing = this.doc.objects.find((o) => o.kind === 'spawn');
      if (existing) {
        this.cmds.run(moveObjectCmd(existing, x, y));
        this.select(existing.id);
        this.status('SPAWN MOVED');
        return;
      }
    }
    const params = DEFAULT_PARAMS[kind]?.() ?? {};
    // Door slabs anchor top-left; center them on the click for placement.
    let px = x,
      py = y;
    if (kind === 'door' || kind === 'runeDoor') {
      px = x - Math.floor(((params.w as number) ?? 3) / 2);
      py = y - Math.floor(((params.h as number) ?? 13) / 2);
    }
    const obj: EditorObject = {
      id: freshId(kind),
      kind,
      x: px,
      y: py,
      rotation: 0,
      locked: false,
      hidden: false,
      params,
    };
    this.cmds.run(addObjectCmd(obj));
    this.select(obj.id);
    this.status('PLACED ' + kind.toUpperCase());
    if (TRIGGER_KINDS.has(kind) || kind === 'runeGlyph') {
      this.status('PLACED ' + kind.toUpperCase() + ' — LINK IT TO A DOOR (K)');
    }
  }

  private placeLight(x: number, y: number): void {
    const light: EditorLight = {
      id: freshId('light'),
      x,
      y,
      color: '#ffb45a',
      intensity: 1.2,
      radius: 48,
      bloom: 0.4,
      flicker: 0.35,
      falloff: 'soft',
      occluded: true,
      locked: false,
      hidden: false,
    };
    this.cmds.run(addLightCmd(light));
    this.select(light.id);
    this.setTool('select');
    this.status('PLACED LIGHT');
  }

  private linkClick(x: number, y: number): void {
    const hit = this.hitTest(x, y);
    if (!hit || hit.isLight) {
      this.status('LINK: CLICK A TRIGGER OR RUNE GLYPH', true);
      return;
    }
    const obj = hit.target as EditorObject;
    const isSource = TRIGGER_KINDS.has(obj.kind) || obj.kind === 'runeGlyph';
    if (!this.linkFrom) {
      if (!isSource) {
        this.status('LINK STARTS AT A TRIGGER (PLATE/LEVER/BRAZIER/SCALE/BUOY/LATCH) OR RUNE GLYPH', true);
        return;
      }
      this.linkFrom = obj.id;
      this.select(obj.id);
      this.status('NOW CLICK THE TARGET ' + (obj.kind === 'runeGlyph' ? 'RUNE DOOR' : 'DOOR'));
      return;
    }
    const from = this.doc.objects.find((o) => o.id === this.linkFrom);
    if (!from) {
      this.linkFrom = null;
      return;
    }
    // Clicking another valid source restarts the link from it.
    if (isSource && obj.id !== from.id) {
      this.linkFrom = obj.id;
      this.select(obj.id);
      this.status('LINK SOURCE CHANGED — NOW CLICK ITS DOOR');
      return;
    }
    const wantKind = from.kind === 'runeGlyph' ? 'runeDoor' : 'door';
    if (obj.kind !== wantKind) {
      this.status(`${from.kind.toUpperCase()} LINKS TO A ${wantKind.toUpperCase()}`, true);
      return;
    }
    if (this.doc.links.some((l) => l.fromId === from.id && l.toId === obj.id)) {
      this.status('ALREADY LINKED', true);
      this.linkFrom = null;
      return;
    }
    const link: EditorLink = {
      id: freshId('link'),
      fromId: from.id,
      toId: obj.id,
      kind: from.kind === 'runeGlyph' ? 'runeDoor' : 'triggerDoor',
      logic: 'and',
    };
    this.cmds.run(addLinkCmd(link));
    this.linkFrom = null;
    this.select(obj.id);
    this.status('LINKED ' + from.kind.toUpperCase() + ' → ' + obj.kind.toUpperCase());
  }

  private hitTest(
    x: number,
    y: number,
  ): { id: string; target: EditorObject | EditorLight; isLight: boolean } | null {
    let best: { id: string; target: EditorObject | EditorLight; isLight: boolean } | null = null;
    let bestD = PICK_RADIUS * PICK_RADIUS;
    for (const o of this.doc.objects) {
      const d = (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y);
      if (d <= bestD) {
        bestD = d;
        best = { id: o.id, target: o, isLight: false };
      }
    }
    for (const l of this.doc.lights) {
      const d = (l.x - x) * (l.x - x) + (l.y - y) * (l.y - y);
      if (d <= bestD) {
        bestD = d;
        best = { id: l.id, target: l, isLight: true };
      }
    }
    if (best) return best;
    // No marker nearby — fall back to footprint containment (door slabs etc.)
    for (const o of this.doc.objects) {
      const f = objectFootprint(o);
      if (f && x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1) {
        return { id: o.id, target: o, isLight: false };
      }
    }
    return null;
  }

  private select(id: string | null): void {
    this.selectedId = id;
    this.syncMarkers();
    this.renderInspector();
  }

  private selected(): EditorObject | null {
    return this.doc.objects.find((o) => o.id === this.selectedId) ?? null;
  }

  private selectedLight(): EditorLight | null {
    return this.doc.lights.find((l) => l.id === this.selectedId) ?? null;
  }

  private deleteSelection(): void {
    const obj = this.selected();
    if (obj) {
      this.cmds.run(deleteObjectCmd(obj));
      this.select(null);
      this.status('DELETED ' + obj.kind.toUpperCase());
      return;
    }
    const light = this.selectedLight();
    if (light) {
      this.cmds.run(deleteLightCmd(light));
      this.select(null);
      this.status('DELETED LIGHT');
    }
  }

  /* ===================== procedural panel (Phase 8) ===================== */

  private wireProcPanel(): void {
    this.el('bp-proc-btn').addEventListener('click', () => {
      const panel = this.el<HTMLDivElement>('builder-proc');
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
      this.syncProcPanel();
    });
    this.el('bp-proc-close').addEventListener('click', () => {
      this.el<HTMLDivElement>('builder-proc').style.display = 'none';
    });
    this.el('bp-dice').addEventListener('click', () => {
      this.el<HTMLInputElement>('bp-seed').value = String(1 + Math.floor(Math.random() * 999999));
    });
    this.el('bp-pass').addEventListener('change', () => this.syncProcPanel());
    this.el('bp-preview').addEventListener('click', () => this.procRun(true));
    this.el('bp-apply').addEventListener('click', () => {
      // A pending preview commits exactly as shown; otherwise run fresh.
      if (this.pendingPreview) this.applyPreview();
      else this.procRun(false);
    });
    this.el('bp-discard').addEventListener('click', () => {
      if (!this.pendingPreview) {
        this.procStatus('NO PREVIEW PENDING');
        return;
      }
      this.discardPreview();
      this.procStatus('PREVIEW DISCARDED');
    });
  }

  private procDef() {
    const id = this.el<HTMLSelectElement>('bp-pass').value;
    return PASSES.find((p) => p.id === id) ?? PASSES[0];
  }

  private procRegion(): Region {
    return this.region ?? { x0: 4, y0: 4, x1: WIDTH - 5, y1: HEIGHT - 5 };
  }

  private procStatus(text: string): void {
    this.el<HTMLDivElement>('bp-status').innerHTML = text;
  }

  private syncProcPanel(): void {
    const def = this.procDef();
    this.el<HTMLElement>('bp-target').textContent = this.region
      ? `region ${this.region.x1 - this.region.x0 + 1}×${this.region.y1 - this.region.y0 + 1}`
      : 'whole level';
    const mat = this.ctx.params.materials[this.ctx.state.currentElement]?.name ?? '—';
    this.el<HTMLElement>('bp-material').textContent = def.usesMaterial ? mat : 'n/a';
  }

  private procRun(previewOnly: boolean): void {
    const def = this.procDef();
    const seed = Number(this.el<HTMLInputElement>('bp-seed').value) || 1;
    const density = Number(this.el<HTMLInputElement>('bp-density').value) / 100;
    const material = this.ctx.state.currentElement;
    const region = this.procRegion();
    if (def.usesMaterial && this.ctx.state.activeInputMode === 'spell') {
      this.procStatus('PICK A MATERIAL IN THE SANDBOX PALETTE FIRST');
      return;
    }

    if (!def.cells) {
      // Population passes: land as one undoable composite, no cell preview.
      if (previewOnly) {
        this.procStatus('POPULATION PASSES APPLY DIRECTLY (UNDOABLE)');
        return;
      }
      const w = this.ctx.world;
      const rec = new PatchRecorder(w);
      const result = runPass(def, w, rec, seed, region, density, material);
      const adds: Command[] = (result.objects ?? []).map((spec) =>
        addObjectCmd({
          id: freshId(spec.kind),
          kind: spec.kind,
          x: spec.x,
          y: spec.y,
          rotation: 0,
          locked: false,
          hidden: false,
          params: spec.params,
        }),
      );
      if (adds.length === 0) {
        this.procStatus('PASS PLACED NOTHING (NO VALID FLOOR SPOTS?)');
        return;
      }
      this.cmds.run(compositeCmd('pass:' + def.id, adds));
      this.recordPassHistory(def.id, seed, density, material, region);
      this.syncMarkers();
      this.renderInspector();
      this.procStatus(result.summary.toUpperCase());
      this.status('PASS APPLIED: ' + result.summary.toUpperCase());
      return;
    }

    // Cell passes: run once into a held patch (preview), commit on APPLY.
    this.discardPreview();
    const w = this.ctx.world;
    const rec = new PatchRecorder(w);
    const result = runPass(def, w, rec, seed, region, density, material);
    const patch = rec.finish();
    if (!patch) {
      this.procStatus('PASS CHANGED NOTHING');
      return;
    }
    if (previewOnly) {
      this.pendingPreview = {
        before: patch.before,
        after: patch.after,
        passId: def.id,
        seed,
        density,
        material,
        region,
        summary: result.summary,
      };
      this.procStatus(result.summary.toUpperCase() + '<br>PREVIEW — APPLY OR DISCARD');
    } else {
      this.cmds.run(paintTerrainCmd(w, patch.before, patch.after));
      this.paintDirty = true;
      this.recordPassHistory(def.id, seed, density, material, region);
      this.procStatus(result.summary.toUpperCase() + ' — APPLIED');
      this.status('PASS APPLIED: ' + result.summary.toUpperCase());
    }
  }

  /** Commit a pending preview through the undo stack. */
  private applyPreview(): void {
    const p = this.pendingPreview;
    if (!p) return;
    this.pendingPreview = null;
    this.cmds.run(paintTerrainCmd(this.ctx.world, p.before, p.after));
    this.paintDirty = true;
    this.recordPassHistory(p.passId, p.seed, p.density, p.material, p.region);
    this.procStatus(p.summary.toUpperCase() + ' — APPLIED');
    this.status('PASS APPLIED: ' + p.summary.toUpperCase());
  }

  /** Revert a pending preview's cells (silent on close). */
  private discardPreview(silent = false): void {
    const p = this.pendingPreview;
    if (!p) return;
    this.pendingPreview = null;
    const w = this.ctx.world;
    for (let n = 0; n < p.before.idxs.length; n++) {
      const i = p.before.idxs[n];
      w.types[i] = p.before.types[n];
      w.colors[i] = p.before.colors[n];
      w.life[i] = p.before.life[n];
      w.charge[i] = p.before.charge[n];
    }
    if (!silent) this.syncProcPanel();
  }

  private recordPassHistory(
    pass: string,
    seed: number,
    density: number,
    material: number,
    region: Region,
  ): void {
    this.doc.proceduralHistory.push({
      id: freshId('pass'),
      pass,
      seed,
      params: {
        density,
        material,
        region: this.region ? { ...region } : null,
      },
      appliedAt: new Date().toISOString(),
    });
  }

  /* ===================== keyboard (capture phase) ===================== */

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
      if (e.code === 'Escape') (t as HTMLInputElement).blur();
      return; // let the field receive the key; root handlers shield InputManager
    }
    if (e.code === 'Tab') {
      // The Builder owns Tab — no silent mode flip mid-edit.
      e.preventDefault();
      e.stopPropagation();
    } else if (e.code === 'Escape') {
      e.stopPropagation();
      if (this.linkFrom) {
        this.linkFrom = null;
        this.status('LINK CANCELLED');
      } else if (this.shapeDrag) {
        this.shapeDrag = null;
      } else if (this.tool !== 'select') {
        this.setTool('select');
      } else if (this.region) {
        this.region = null;
        this.status('REGION CLEARED');
        this.syncProcPanel();
      } else this.select(null);
    } else if (e.code === 'KeyV' || e.code === 'KeyB') {
      e.stopPropagation();
      this.setTool(e.code === 'KeyV' ? 'select' : 'paint');
    } else if (e.code === 'KeyL') {
      e.stopPropagation();
      this.setTool('line');
    } else if (e.code === 'KeyK') {
      e.stopPropagation();
      this.setTool('link');
    } else if (e.code === 'KeyG') {
      e.stopPropagation();
      this.setTool('fill');
    } else if (e.code === 'KeyR') {
      e.stopPropagation();
      this.setTool('region');
    } else if (e.code === 'Delete') {
      e.stopPropagation();
      this.deleteSelection();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      e.stopPropagation();
      this.redo();
    } else if (e.code === 'KeyM' || e.code === 'KeyH') {
      // Keep play-mode overlays (map/handbook) out of authoring.
      e.stopPropagation();
    }
  };

  /* ===================== per-frame: markers + canvas ===================== */

  private loop = (): void => {
    if (!this.isOpen) return;
    this.rafId = requestAnimationFrame(this.loop);
    const rect = this.overlay.getBoundingClientRect();
    if (rect.width === 0) return;

    // markers glue to world positions (sized kinds anchor at footprint center)
    for (const [id, el] of this.markers) {
      const obj = this.doc.objects.find((o) => o.id === id);
      const light = obj ? null : this.doc.lights.find((l) => l.id === id);
      const rec = obj ?? light;
      if (!rec) continue;
      let ax = rec.x,
        ay = rec.y;
      if (obj) {
        const f = objectFootprint(obj);
        if (f) {
          ax = (f.x0 + f.x1) / 2;
          ay = (f.y0 + f.y1) / 2;
        }
      }
      const p = this.worldToScreen(ax, ay, rect);
      el.style.left = p.x.toFixed(1) + 'px';
      el.style.top = p.y.toFixed(1) + 'px';
      el.style.display =
        p.x < -10 || p.x > rect.width + 10 || p.y < -10 || p.y > rect.height + 10 ? 'none' : '';
    }

    this.drawCanvas(rect);
  };

  /** Region, shape previews, link wires, footprint boxes, light rings. */
  private drawCanvas(rect: DOMRect): void {
    const cw = Math.round(rect.width),
      ch = Math.round(rect.height);
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;
    const g = this.cctx;
    g.clearRect(0, 0, cw, ch);
    const cellW = (rect.width / VIEW_W) * this.ctx.camera.zoom;
    const cellH = (rect.height / VIEW_H) * this.ctx.camera.zoom;
    const toS = (wx: number, wy: number): { x: number; y: number } =>
      this.worldToScreen(wx, wy, rect);

    // selection region (dashed cyan)
    if (this.region) {
      const a = toS(this.region.x0, this.region.y0);
      const b = toS(this.region.x1 + 1, this.region.y1 + 1);
      g.setLineDash([6, 4]);
      g.strokeStyle = 'rgba(125,211,252,0.85)';
      g.lineWidth = 1;
      g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      g.setLineDash([]);
    }

    // footprint boxes for sized objects
    for (const o of this.doc.objects) {
      const f = objectFootprint(o);
      if (!f) continue;
      const a = toS(f.x0, f.y0);
      const b = toS(f.x1 + 1, f.y1 + 1);
      const sel = o.id === this.selectedId;
      g.strokeStyle =
        o.kind === 'door'
          ? sel ? 'rgba(147,197,253,0.95)' : 'rgba(147,197,253,0.45)'
          : o.kind === 'runeDoor'
            ? sel ? 'rgba(134,239,172,0.95)' : 'rgba(134,239,172,0.45)'
            : sel ? 'rgba(251,191,36,0.9)' : 'rgba(251,191,36,0.35)';
      g.lineWidth = sel ? 2 : 1;
      g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      // sensor zones read as faint inner boxes
      if (o.kind === 'scale' || o.kind === 'buoy' || o.kind === 'chargeLatch') {
        g.setLineDash([3, 3]);
        g.strokeStyle = 'rgba(125,211,252,0.4)';
        g.lineWidth = 1;
        g.strokeRect(a.x + 2, a.y + 2, b.x - a.x - 4, Math.max(4, (b.y - a.y) * 0.6));
        g.setLineDash([]);
      }
    }

    // link wires: trigger -> door amber, glyph -> runeDoor green
    for (const l of this.doc.links) {
      const from = this.doc.objects.find((o) => o.id === l.fromId);
      const to = this.doc.objects.find((o) => o.id === l.toId);
      if (!from || !to) continue;
      const tf = objectFootprint(to);
      const a = toS(from.x, from.y - 2);
      const b = tf ? toS((tf.x0 + tf.x1) / 2, (tf.y0 + tf.y1) / 2) : toS(to.x, to.y);
      const sel = from.id === this.selectedId || to.id === this.selectedId;
      g.strokeStyle =
        l.kind === 'runeDoor'
          ? sel ? 'rgba(134,239,172,0.95)' : 'rgba(134,239,172,0.45)'
          : sel ? 'rgba(252,211,77,0.95)' : 'rgba(252,211,77,0.45)';
      g.lineWidth = sel ? 2 : 1;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.fillStyle = g.strokeStyle;
      g.fillRect(b.x - 2, b.y - 2, 4, 4);
    }

    // link in progress: wire follows the mouse
    if (this.linkFrom) {
      const from = this.doc.objects.find((o) => o.id === this.linkFrom);
      if (from) {
        const a = toS(from.x, from.y - 2);
        const b = toS(this.lastMouse.x, this.lastMouse.y);
        g.setLineDash([4, 4]);
        g.strokeStyle = 'rgba(252,211,77,0.9)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
        g.setLineDash([]);
      }
    }

    // authored light rings
    for (const l of this.doc.lights) {
      const c = toS(l.x, l.y);
      const sel = l.id === this.selectedId;
      g.strokeStyle = sel ? l.color : l.color + '55';
      g.lineWidth = sel ? 2 : 1;
      g.beginPath();
      g.ellipse(c.x, c.y, l.radius * cellW, l.radius * cellH, 0, 0, Math.PI * 2);
      g.stroke();
    }

    // shape drag preview
    if (this.shapeDrag) {
      const s = this.shapeDrag;
      const a = toS(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1));
      const b = toS(Math.max(s.x0, s.x1) + 1, Math.max(s.y0, s.y1) + 1);
      g.strokeStyle = this.tool === 'region' ? 'rgba(125,211,252,0.9)' : 'rgba(74,222,128,0.9)';
      g.lineWidth = 1.5;
      if (this.tool === 'region') g.setLineDash([6, 4]);
      if (this.tool === 'line') {
        const p0 = toS(s.x0, s.y0);
        const p1 = toS(s.x1, s.y1);
        g.beginPath();
        g.moveTo(p0.x, p0.y);
        g.lineTo(p1.x, p1.y);
        g.stroke();
      } else if (this.tool === 'ellipse' || this.tool === 'ellipseFill') {
        g.beginPath();
        g.ellipse(
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
          Math.max(1, (b.x - a.x) / 2),
          Math.max(1, (b.y - a.y) / 2),
          0,
          0,
          Math.PI * 2,
        );
        g.stroke();
      } else {
        g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      g.setLineDash([]);
    }

    // pending procedural preview badge
    if (this.pendingPreview) {
      g.fillStyle = 'rgba(251,191,36,0.95)';
      g.font = '700 11px monospace';
      g.fillText('PROCEDURAL PREVIEW — APPLY OR DISCARD', 12, ch - 12);
    }
  }

  /** Rebuild the marker DOM from the document (object/light set changed). */
  private syncMarkers(): void {
    this.markerLayer.innerHTML = '';
    this.markers.clear();
    for (const o of this.doc.objects) {
      const m = document.createElement('div');
      m.className = `b-marker k-${o.kind}`
        + (o.id === this.selectedId ? ' sel' : '')
        + (o.hidden ? ' ghost' : '');
      m.textContent = GLYPH[o.kind] ?? '?';
      m.title = o.kind;
      this.markers.set(o.id, m);
      this.markerLayer.appendChild(m);
    }
    for (const l of this.doc.lights) {
      const m = document.createElement('div');
      m.className = 'b-marker k-light' + (l.id === this.selectedId ? ' sel' : '') + (l.hidden ? ' ghost' : '');
      m.textContent = '*';
      m.title = 'light';
      this.markers.set(l.id, m);
      this.markerLayer.appendChild(m);
    }
  }

  /* ===================== inspector ===================== */

  private renderInspector(): void {
    const panel = this.el<HTMLDivElement>('builder-inspector');
    const light = this.selectedLight();
    if (light) {
      this.renderLightInspector(panel, light);
      return;
    }
    const obj = this.selected();
    if (!obj) {
      panel.innerHTML = `<div class="bi-head">INSPECTOR</div>
        <div class="bi-empty">Nothing selected.<br>Click a marker, or pick a<br>tool and click the canvas.</div>
        <div class="bi-row"><span>objects</span><b>${this.doc.objects.length}</b></div>
        <div class="bi-row"><span>links</span><b>${this.doc.links.length}</b></div>
        <div class="bi-row"><span>lights</span><b>${this.doc.lights.length}</b></div>
        <div class="bi-row"><span>passes</span><b>${this.doc.proceduralHistory.length}</b></div>
        <div class="bi-row"><span>terrain</span><b>${this.doc.world ? 'captured' : '—'}</b></div>
        <div class="bi-row"><span>undo depth</span><b>${this.cmds.depth}</b></div>`;
      return;
    }

    let rows = `<div class="bi-head">${obj.kind.toUpperCase()}</div>
      <div class="bi-id">${obj.id}</div>
      <div class="bi-row"><span>x</span><input type="number" data-f="x" value="${Math.round(obj.x)}"></div>
      <div class="bi-row"><span>y</span><input type="number" data-f="y" value="${Math.round(obj.y)}"></div>`;

    if (obj.kind === 'enemy') {
      rows += `<div class="bi-row"><span>kind</span><select data-p="kind">${ENEMY_KINDS.map(
        (k) => `<option value="${k}"${obj.params.kind === k ? ' selected' : ''}>${k}</option>`,
      ).join('')}</select></div>`;
      if (obj.params.kind === 'bat') {
        rows += this.checkRow(obj, 'sleeping', 'roosting');
      }
    } else if (obj.kind === 'pickup') {
      rows += `<div class="bi-row"><span>kind</span><select data-p="kind">${PICKUP_KINDS.map(
        (k) => `<option value="${k}"${obj.params.kind === k ? ' selected' : ''}>${k}</option>`,
      ).join('')}</select></div>`;
      const pk = obj.params.kind;
      if (pk === 'goldpile' || pk === 'chest') {
        rows += this.numRow(obj, 'amount', 'amount', 30);
      }
      if (pk === 'tome') {
        rows += `<div class="bi-row"><span>card</span><input type="text" data-p="card" placeholder="random" value="${
          typeof obj.params.card === 'string' ? obj.params.card : ''
        }"></div>`;
      }
      if (pk === 'potion') {
        rows += `<div class="bi-row"><span>potion</span><input type="text" data-p="potion" placeholder="random" value="${
          typeof obj.params.potion === 'string' ? obj.params.potion : ''
        }"></div>`;
      }
    } else if (obj.kind === 'exitPortal') {
      rows += this.checkRow(obj, 'alwaysOpen', 'always open');
    } else if (obj.kind === 'waystone') {
      rows += this.checkRow(obj, 'lit', 'pre-lit');
    } else if (obj.kind === 'exitWell') {
      rows += this.numRow(obj, 'halfW', 'half width', 14);
    } else if (obj.kind === 'door') {
      rows += this.numRow(obj, 'w', 'width', 3) + this.numRow(obj, 'h', 'height', 13);
      rows += this.checkRow(obj, 'initialOpen', 'starts open');
      rows += this.linkRows(obj, 'in');
    } else if (obj.kind === 'runeDoor') {
      rows += this.numRow(obj, 'w', 'width', 2) + this.numRow(obj, 'h', 'height', 11);
      rows += this.linkRows(obj, 'in');
    } else if (obj.kind === 'plate') {
      rows += this.numRow(obj, 'w', 'width', 5) + this.linkRows(obj, 'out');
    } else if (obj.kind === 'scale') {
      rows += this.numRow(obj, 'w', 'pan width', 7) + this.numRow(obj, 'threshold', 'threshold', 24);
      rows += this.linkRows(obj, 'out');
    } else if (obj.kind === 'buoy') {
      rows +=
        this.numRow(obj, 'w', 'basin width', 13) +
        this.numRow(obj, 'depth', 'basin depth', 4) +
        this.numRow(obj, 'threshold', 'threshold', 26);
      rows += this.linkRows(obj, 'out');
    } else if (obj.kind === 'lever' || obj.kind === 'brazier' || obj.kind === 'chargeLatch') {
      rows += this.linkRows(obj, 'out');
    } else if (obj.kind === 'runeGlyph') {
      rows += this.linkRows(obj, 'out');
    }

    rows += `<div class="bi-flags">
        <label><input type="checkbox" data-f="locked"${obj.locked ? ' checked' : ''}>locked</label>
        <label><input type="checkbox" data-f="hidden"${obj.hidden ? ' checked' : ''}>hidden</label>
      </div>
      <button id="bi-delete">DELETE (DEL)</button>`;
    panel.innerHTML = rows;

    // x/y commit as move commands; params as edit-param commands.
    for (const input of panel.querySelectorAll<HTMLInputElement>('input[data-f="x"],input[data-f="y"]')) {
      input.addEventListener('change', () => {
        const nx = input.dataset.f === 'x' ? Number(input.value) : obj.x;
        const ny = input.dataset.f === 'y' ? Number(input.value) : obj.y;
        if (Number.isFinite(nx) && Number.isFinite(ny)) this.cmds.run(moveObjectCmd(obj, nx, ny));
        this.syncMarkers();
      });
    }
    for (const field of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-p]')) {
      field.addEventListener('change', () => {
        const key = field.dataset.p as string;
        let value: unknown =
          field instanceof HTMLInputElement && field.type === 'checkbox' ? field.checked : field.value;
        if (field.dataset.num) value = Number(field.value);
        if (value === '') value = undefined;
        this.cmds.run(editParamCmd(obj, key, value));
        this.renderInspector(); // kind switches change which param rows exist
      });
    }
    for (const flag of panel.querySelectorAll<HTMLInputElement>('input[data-f="locked"],input[data-f="hidden"]')) {
      flag.addEventListener('change', () => {
        if (flag.dataset.f === 'locked') obj.locked = flag.checked;
        else obj.hidden = flag.checked;
        this.syncMarkers();
      });
    }
    for (const unlink of panel.querySelectorAll<HTMLButtonElement>('button[data-unlink]')) {
      unlink.addEventListener('click', () => {
        const link = this.doc.links.find((l) => l.id === unlink.dataset.unlink);
        if (link) {
          this.cmds.run(deleteLinkCmd(link));
          this.status('UNLINKED');
          this.renderInspector();
        }
      });
    }
    panel.querySelector('#bi-delete')?.addEventListener('click', () => this.deleteSelection());
  }

  /** Wiring summary rows: who drives me / what do I drive, with unlink buttons. */
  private linkRows(obj: EditorObject, dir: 'in' | 'out'): string {
    const links = this.doc.links.filter((l) =>
      dir === 'in' ? l.toId === obj.id : l.fromId === obj.id,
    );
    if (links.length === 0) {
      return `<div class="bi-row"><span>${dir === 'in' ? 'triggers' : 'drives'}</span><b class="bi-warn">unlinked (K)</b></div>`;
    }
    return links
      .map((l) => {
        const otherId = dir === 'in' ? l.fromId : l.toId;
        const other = this.doc.objects.find((o) => o.id === otherId);
        return `<div class="bi-row"><span>${dir === 'in' ? '←' : '→'} ${
          other?.kind ?? '?'
        }</span><button data-unlink="${l.id}" title="Remove link">&times;</button></div>`;
      })
      .join('');
  }

  private renderLightInspector(panel: HTMLDivElement, light: EditorLight): void {
    panel.innerHTML = `<div class="bi-head">AUTHORED LIGHT</div>
      <div class="bi-id">${light.id}</div>
      <div class="bi-row"><span>x</span><input type="number" data-lf="x" value="${Math.round(light.x)}"></div>
      <div class="bi-row"><span>y</span><input type="number" data-lf="y" value="${Math.round(light.y)}"></div>
      <div class="bi-row"><span>color</span><input type="color" data-lf="color" value="${light.color}"></div>
      <div class="bi-row"><span>intensity</span><input type="number" step="0.1" min="0.1" max="4" data-lf="intensity" value="${light.intensity}"></div>
      <div class="bi-row"><span>radius</span><input type="number" min="4" max="160" data-lf="radius" value="${light.radius}"></div>
      <div class="bi-row"><span>bloom</span><input type="number" step="0.05" min="0" max="1" data-lf="bloom" value="${light.bloom}"></div>
      <div class="bi-row"><span>flicker</span><input type="number" step="0.05" min="0" max="1" data-lf="flicker" value="${light.flicker}"></div>
      <div class="bi-row"><span>falloff</span><select data-lf="falloff">${(['soft', 'linear', 'sharp'] as const)
        .map((f) => `<option value="${f}"${light.falloff === f ? ' selected' : ''}>${f}</option>`)
        .join('')}</select></div>
      <div class="bi-row"><span>occluded</span><input type="checkbox" data-lf="occluded"${light.occluded ? ' checked' : ''}></div>
      <div class="bi-flags">
        <label><input type="checkbox" data-lf="locked"${light.locked ? ' checked' : ''}>locked</label>
        <label><input type="checkbox" data-lf="hidden"${light.hidden ? ' checked' : ''}>hidden</label>
      </div>
      <div class="bi-empty">Occluded lights cast real<br>shadows via the sweeps;<br>non-occluded paint their<br>whole falloff disk.</div>
      <button id="bi-delete">DELETE (DEL)</button>`;

    for (const field of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-lf]')) {
      field.addEventListener('change', () => {
        const key = field.dataset.lf as keyof EditorLight;
        if (key === 'x' || key === 'y') {
          const nx = key === 'x' ? Number(field.value) : light.x;
          const ny = key === 'y' ? Number(field.value) : light.y;
          if (Number.isFinite(nx) && Number.isFinite(ny)) this.cmds.run(moveLightCmd(light, nx, ny));
          return;
        }
        let value: unknown =
          field instanceof HTMLInputElement && field.type === 'checkbox' ? field.checked : field.value;
        if (key === 'intensity' || key === 'radius' || key === 'bloom' || key === 'flicker') {
          value = Number(field.value);
          if (!Number.isFinite(value as number)) return;
        }
        this.cmds.run(editLightCmd(light, { [key]: value } as Partial<EditorLight>));
        if (key === 'hidden' || key === 'locked') this.syncMarkers();
      });
    }
    panel.querySelector('#bi-delete')?.addEventListener('click', () => this.deleteSelection());
  }

  private checkRow(obj: EditorObject, key: string, label: string): string {
    return `<div class="bi-row"><span>${label}</span><input type="checkbox" data-p="${key}"${
      obj.params[key] === true ? ' checked' : ''
    }></div>`;
  }

  private numRow(obj: EditorObject, key: string, label: string, fallback: number): string {
    return `<div class="bi-row"><span>${label}</span><input type="number" data-p="${key}" data-num="1" value="${paramNum(
      obj,
      key,
      fallback,
    )}"></div>`;
  }

  /* ===================== issues / status / sync ===================== */

  private renderIssues(issues: DocIssue[]): void {
    const panel = this.el<HTMLDivElement>('builder-issues');
    if (issues.length === 0) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    panel.innerHTML =
      `<div class="bi-head">ISSUES <button id="b-issues-close">&times;</button></div>` +
      issues
        .map(
          (i, n) =>
            `<div class="b-issue ${i.severity}" data-n="${n}">[${i.severity.slice(0, 4).toUpperCase()}] ${i.what}</div>`,
        )
        .join('');
    panel.querySelector('#b-issues-close')?.addEventListener('click', () => {
      panel.style.display = 'none';
    });
    for (const row of panel.querySelectorAll<HTMLDivElement>('.b-issue')) {
      row.addEventListener('click', () => {
        const issue = issues[Number(row.dataset.n)];
        if (issue?.objId) this.select(issue.objId);
      });
    }
  }

  private status(text: string, warn = false): void {
    const line = this.el<HTMLDivElement>('builder-status');
    line.textContent = text;
    line.classList.toggle('warn', warn);
    line.classList.add('show');
    clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => line.classList.remove('show'), 4000);
  }

  private syncPalette(): void {
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.bp-tool')) {
      btn.classList.toggle('active', (btn.dataset.tool ?? btn.dataset.kind) === this.tool);
    }
  }

  private refreshDocSelect(): void {
    const select = this.el<HTMLSelectElement>('b-doc-select');
    const lib = loadDocLibrary();
    select.innerHTML = '';
    for (const [id, d] of Object.entries(lib)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = d.name;
      select.appendChild(opt);
    }
    select.disabled = select.options.length === 0;
  }

  private syncAll(): void {
    this.el<HTMLInputElement>('b-doc-name').value = this.doc.name;
    this.el<HTMLSelectElement>('b-biome').value = this.doc.biome;
    this.syncMarkers();
    this.syncPalette();
    this.renderInspector();
    this.syncProcPanel();
  }
}

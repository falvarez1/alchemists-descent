import type { BiomeId, Ctx, EnemyKind, PickupKind } from '@/core/types';
import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import {
  applyWorldLayer,
  captureWorldLayer,
  createEmptyDocument,
  docToShareCode,
  freshId,
  loadDocLibrary,
  objectFootprint,
  paramNum,
  sanitizeImportedDoc,
  saveDocToLibrary,
  shareCodeToDoc,
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
  setObjectFlagCmd,
  setObjectGroupCmd,
} from '@/builder/commands';
import type { CellPatch, Command } from '@/builder/commands';
import { drawLine, spawnCircle } from '@/sim/brush';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import { blocksEntity } from '@/sim/CellType';
import { World } from '@/sim/World';
import { compileAndPlaytest, toAuthoredLight } from '@/builder/compile';
import {
  captureStamp,
  loadStamps,
  mirrorStamp,
  pasteStamp,
  rotateStamp,
  saveStamps,
} from '@/builder/stamplib';
import type { StampDef } from '@/builder/stamplib';
import { TRIGGER_KINDS, validateDocument } from '@/builder/validate';
import type { DocIssue } from '@/builder/validate';
import {
  floodFill,
  magicRegion,
  PatchRecorder,
  rasterizePolygon,
  replaceMaterial,
  roughenDisc,
  smoothDisc,
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
  { kind: 'hazardEmitter', label: 'Emitter', glyph: '!' },
  { kind: 'decor', label: 'Note', glyph: 'N' },
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
  hazardEmitter: () => ({ cell: 'water', rate: 30 }),
  decor: () => ({ text: 'note' }),
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
  | 'smooth'
  | 'roughen'
  | 'region'
  | 'polyRegion'
  | 'regionMagic'
  | 'link'
  | 'light'
  | 'stamp'
  | EditorObjectKind;

/** Editor layer families (visibility/locking are EDITOR-side only:
 *  a hidden layer still compiles — that's what object `hidden` is for). */
type LayerFamily = 'gameplay' | 'mech' | 'links' | 'lights';
const MECH_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'door', 'plate', 'lever', 'brazier', 'scale', 'buoy', 'chargeLatch', 'runeGlyph', 'runeDoor',
] as EditorObjectKind[]);
const familyOf = (o: EditorObject): LayerFamily => (MECH_KINDS.has(o.kind) ? 'mech' : 'gameplay');

const OVERLAY_MODES = ['none', 'light', 'danger', 'loot'] as const;
type OverlayMode = (typeof OVERLAY_MODES)[number];

const DRAFT_KEY = 'noita-builder-draft';
/** Settle previews bigger than this commit without undo (memory honesty). */
const SETTLE_UNDO_CAP = 400000;

/** Light presets: one click of mood (applied through the undo stack). */
const LIGHT_PRESETS: Record<string, Partial<EditorLight>> = {
  torch: { color: '#ffb45a', intensity: 1.3, radius: 48, bloom: 0.4, flicker: 0.4, falloff: 'soft', occluded: true },
  brazier: { color: '#ff8a3c', intensity: 1.8, radius: 64, bloom: 0.6, flicker: 0.3, falloff: 'soft', occluded: true },
  crystal: { color: '#7fd4ff', intensity: 1.0, radius: 40, bloom: 0.5, flicker: 0.05, falloff: 'sharp', occluded: true },
  moonlight: { color: '#9db8e8', intensity: 0.7, radius: 120, bloom: 0.1, flicker: 0, falloff: 'linear', occluded: false },
  treasure: { color: '#ffd75e', intensity: 0.9, radius: 28, bloom: 0.7, flicker: 0.15, falloff: 'sharp', occluded: true },
  warning: { color: '#ff4444', intensity: 1.2, radius: 56, bloom: 0.5, flicker: 0.55, falloff: 'soft', occluded: false },
};

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

  /** Primary selection (drives the inspector); selectedIds is the full set. */
  private selectedId: string | null = null;
  private selectedIds = new Set<string>();
  private tool: BuilderTool = 'select';
  /** Group drag: every unlocked member of the selection moves together. */
  private drag: {
    targets: Array<{ t: EditorObject | EditorLight; isLight: boolean; ox: number; oy: number }>;
    grabX: number;
    grabY: number;
  } | null = null;
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private clipboard: { kind: EditorObjectKind; params: Record<string, unknown> } | null = null;
  private stroke: { seen: Set<number>; before: CellPatch; lastX: number; lastY: number } | null = null;
  /** Smooth/roughen strokes: one PatchRecorder for the whole drag. */
  private terraStroke: { rec: PatchRecorder; tool: 'smooth' | 'roughen' } | null = null;
  private shapeDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private region: Region | null = null;
  /** Region narrowing: polygon/magic masks (bbox-relative). */
  private regionMask: Uint8Array | null = null;
  /** Polygon-region tool: vertices collected so far. */
  private polyPoints: Array<[number, number]> = [];
  /** Editor layer toggles. */
  private layerHidden = new Set<LayerFamily>();
  private layerLocked = new Set<LayerFamily>();
  /** Scarred planes captured on playtest return, for BAKE. */
  private playtestScars: { types: Uint8Array; life: Int16Array; charge: Uint8Array } | null = null;
  /** Ambient as it stood before a mood-overridden playtest. */
  private prevAmbient: number | null = null;
  /** Light preview solo (null = all). */
  private soloLightId: string | null = null;
  /** Enemy whose patrol waypoints are being clicked in. */
  private patrolEditId: string | null = null;
  private linkFrom: string | null = null;
  private pendingPreview: PendingPreview | null = null;
  private lastMouse = { x: 0, y: 0 };
  private zoomTarget = 1;
  private lightPreviewOn = true;
  /** Placement/drag snap step in cells (0 = off). */
  private snapStep: 0 | 8 | 16 = 0;
  /** Palette drag-to-place: armed on button mousedown, live once a ghost exists. */
  private palDrag: {
    kind: EditorObjectKind | 'light';
    startX: number;
    startY: number;
    ghost: HTMLDivElement | null;
  } | null = null;
  private overlayMode: OverlayMode = 'none';
  private stampsList: StampDef[] = [];
  private armedStamp: StampDef | null = null;
  /** Settle preview: full-plane snapshot while physics runs, then keep/revert. */
  private settleSnap: {
    types: Uint8Array;
    colors: Uint32Array;
    life: Int16Array;
    charge: Uint8Array;
  } | null = null;
  private settling = false;
  private settleEndFrame = 0;
  /** paintDirty as it stood when the settle began — a zero-diff KEEP must
   *  not launder away dirt earned by earlier uncaptured painting. */
  private settleWasDirty = false;
  private autosaveTimer = 0;
  private draftOffered = false;

  private root!: HTMLDivElement;
  private overlay!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private cctx!: CanvasRenderingContext2D;
  private minimap!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;
  private minimapImage: ImageData | null = null;
  private markerLayer!: HTMLDivElement;
  private markers = new Map<string, HTMLDivElement>();
  private modeBtn!: HTMLButtonElement;
  private rafId = 0;
  private statusTimer = 0;

  constructor(private ctx: Ctx) {
    this.doc = createEmptyDocument('untitled', ctx.state.currentBiome);
    this.stampsList = loadStamps();
    this.buildDom();
    this.wireBar();
    this.wireProcPanel();
    this.wirePointer();
    this.wireExtras();
    this.wireCmdk();
    this.wireLayers();
    window.addEventListener('keydown', this.onKeyDown, true);
    // Entering play (PLAY button) while authoring closes the overlay; the
    // document survives for the next open.
    ctx.events.on('modeChanged', ({ mode }) => {
      if (mode === 'play' && this.isOpen) this.close();
    });
    // Sandbox world-shaping buttons reshape the WHOLE world under the open
    // document with no undo. While the Builder is open they must confirm
    // first (capture phase beats the Sandbox handler), and a confirmed
    // reshape marks the terrain dirty for re-capture.
    for (const id of ['btn-caves', 'btn-fortress', 'clear-btn']) {
      document.getElementById(id)?.addEventListener(
        'click',
        (e) => {
          if (!this.isOpen) return;
          const hasWork = this.doc.world !== null || this.cmds.depth > 0 || this.paintDirty;
          if (
            this.pendingPreview ||
            (hasWork &&
              !window.confirm(
                'This reshapes the ENTIRE world under the open document and cannot be undone. ' +
                  '(RESTORE re-decodes the last captured terrain.) Continue?',
              ))
          ) {
            if (this.pendingPreview) this.status('APPLY OR DISCARD THE PROCEDURAL PREVIEW FIRST', true);
            e.stopImmediatePropagation();
            e.preventDefault();
            return;
          }
          this.paintDirty = true;
        },
        true,
      );
    }
    // Unsaved authoring work guards the tab close.
    window.addEventListener('beforeunload', (e) => {
      if (this.isOpen && (this.cmds.depth > 0 || this.paintDirty || this.pendingPreview)) {
        e.preventDefault();
      }
    });
  }

  /* ===================== open / close ===================== */

  open(): void {
    if (this.isOpen) return;
    // The Builder rides on build mode; leave the descent first if needed.
    if (this.ctx.state.mode === 'play') {
      (document.getElementById('mode-build-btn') as HTMLButtonElement | null)?.click();
    }
    // EXPEDITION PROTECTION: levels persist as live World instances. If the
    // canvas still shows an expedition level, the Builder must NOT edit it
    // in place (LOAD/IMPORT would wipe a depth and autosave would keep it).
    // Detach onto a scratch world; PLAY re-attaches the expedition's own.
    let detached = false;
    const rt = this.ctx.levels.current;
    if (rt && rt.def.id !== 'custom' && this.ctx.world === rt.world) {
      this.ctx.world = new World();
      this.ctx.enemies.length = 0;
      this.ctx.projectiles.length = 0;
      this.ctx.particles.clear();
      if (this.doc.world) applyWorldLayer(this.ctx, this.doc.world);
      detached = true;
    }
    this.isOpen = true;
    if (!this.ctx.state.paused) {
      this.ctx.state.paused = true;
      this.ownsPause = true;
    }
    if (detached) {
      this.root.style.display = '';
      this.status('EXPEDITION PARKED — THE BUILDER WORKS ON ITS OWN WORLD');
    }
    if (this.returningFromPlaytest && this.doc.world) {
      // Hold the scarred planes for BAKE, then re-decode the authored layer.
      this.playtestScars = {
        types: this.ctx.world.types.slice(),
        life: this.ctx.world.life.slice(),
        charge: this.ctx.world.charge.slice(),
      };
      applyWorldLayer(this.ctx, this.doc.world);
      this.ctx.enemies.length = 0;
      this.ctx.projectiles.length = 0;
      this.ctx.particles.clear();
      this.status('PLAYTEST DISCARDED — "BAKE PLAYTEST SCARS" (CTRL+K) CAN KEEP THEM');
    }
    if (this.returningFromPlaytest && this.prevAmbient !== null) {
      // a mood-overridden playtest restores the global ambient on return
      this.ctx.params.global.ambient = this.prevAmbient;
      this.prevAmbient = null;
    }
    this.returningFromPlaytest = false;
    this.root.style.display = '';
    this.modeBtn.classList.add('active');
    document.body.classList.add('builder-open');
    this.ctx.camera.zoomLock = this.zoomTarget;
    this.refreshDocSelect();
    this.syncAll();
    this.syncStamps();
    this.syncSettleButtons();
    this.autosaveTimer = window.setInterval(() => this.autosaveDraft(), 30000);
    this.offerDraft();
    this.rafId = requestAnimationFrame(this.loop);
  }

  close(): void {
    if (!this.isOpen) return;
    if (this.settling || this.settleSnap) this.finishSettle(false);
    this.discardPreview(true);
    this.isOpen = false;
    cancelAnimationFrame(this.rafId);
    window.clearInterval(this.autosaveTimer);
    this.ctx.camera.zoomLock = null;
    this.ctx.state.editorLights = null;
    if (this.ownsPause) {
      this.ctx.state.paused = false;
      this.ownsPause = false;
    }
    this.tool = 'select';
    this.drag = null;
    this.stroke = null;
    this.shapeDrag = null;
    this.marquee = null;
    this.armedStamp = null;
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
        <button id="b-share" title="Compress the document into a pasteable share code">SHARE</button>
        <button id="b-code" title="Import a level from a share code">CODE</button>
        <span class="b-sep"></span>
        <button id="b-undo" title="Ctrl+Z">&#8617;</button>
        <button id="b-redo" title="Ctrl+Y">&#8618;</button>
        <span class="b-sep"></span>
        <button id="b-capture" title="Snapshot the live sandbox cells into the document">CAPTURE TERRAIN</button>
        <button id="b-restore" title="Re-decode the document's captured terrain into the live world (clears undo)">RESTORE</button>
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
          ${toolBtn('smooth', '∿', 'Smooth terrain (majority rule under the brush)')}
          ${toolBtn('roughen', '≈', 'Roughen terrain (jitter the rock/air boundary)')}
          ${toolBtn('region', '▦', 'Rectangle region for passes & replace (R)')}
          ${toolBtn('polyRegion', '⬠', 'Polygon region: click vertices, Enter/near-first closes')}
          ${toolBtn('regionMagic', '✦', 'Magic region: click an open area to select the whole cavern')}
        </div>
        <div id="bp-mat-row" class="bp-hint" title="Active material, brush radius and zoom"></div>
        <div class="bp-head">MATERIALS</div>
        <div id="bp-materials" class="bp-grid bp-grid6"></div>
        <div class="bp-brushrow"><span>brush</span><input type="range" id="bp-brush" min="1" max="24" value="6"><b id="bp-brush-val">6</b></div>
        <div class="bp-head">WORLD GEN</div>
        <div class="bp-grid bp-grid3">
          <button id="bp-gen-caves" title="Regenerate caves in the document's biome (whole world)">CAVES</button>
          <button id="bp-gen-fort" title="Stamp a fortress into the world">FORT</button>
          <button id="bp-gen-clear" title="Clear the whole world">CLEAR</button>
        </div>
        <div class="bp-head">PLACE</div>
        <div class="bp-grid bp-grid2">${PLACE_GAMEPLAY.map(placeBtn).join('')}</div>
        <div class="bp-head">MECHANISMS</div>
        <div class="bp-grid bp-grid2">${PLACE_MECH.map(placeBtn).join('')}</div>
        <button class="bp-tool" data-tool="link"><span class="bp-glyph k-link">K</span>Link trigger &rarr; door (K)</button>
        <div class="bp-head">LIGHTING</div>
        <button class="bp-tool" data-tool="light"><span class="bp-glyph k-light">*</span>Authored Light</button>
        <button id="bp-light-toggle" title="Feed authored lights into the live light field while editing">PREVIEW LIGHTS: ON</button>
        <div class="bp-head">STAMPS</div>
        <button id="bp-stamp-capture" title="Save the selected region's cells as a reusable stamp">CAPTURE REGION</button>
        <div id="bp-stamp-list"></div>
        <div class="bp-head">SIMULATE</div>
        <div class="bp-grid bp-grid3">
          <button id="bp-settle" title="Run physics on the visible area for 2s, then keep or revert">SETTLE</button>
          <button id="bp-settle-keep" style="display:none">KEEP</button>
          <button id="bp-settle-revert" style="display:none">REVERT</button>
        </div>
        <div class="bp-head">LAYERS</div>
        <div id="bp-layers">
          ${(['gameplay', 'mech', 'links', 'lights'] as const)
            .map(
              (f) =>
                `<div class="bp-layer" data-layer="${f}"><span>${f}</span><button data-vis title="Show/hide in the editor (still compiles)">&#128065;</button><button data-lock title="Lock against selection">&#128275;</button></div>`,
            )
            .join('')}
        </div>
        <div class="bp-head">VIEW</div>
        <button id="bp-overlay-btn" title="Readability overlays (O)">OVERLAY: NONE</button>
        <button id="bp-snap-btn" title="Snap placements and drags to a grid">SNAP: OFF</button>
        <div class="bp-head">PROCEDURAL</div>
        <button id="bp-proc-btn">SEEDED PASSES&hellip;</button>
        <div class="bp-hint">RMB eyedrops &middot; wheel zooms.<br>Shift-click multi-selects,<br>drag empty = marquee.<br>Ctrl+D duplicate &middot; Ctrl+C/V<br>copy/paste params.<br>T playtests at the cursor.<br>Stamp armed: Q rotate, E flip.<br>ESC steps back &middot; DEL removes.</div>
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
      <canvas id="builder-minimap" width="${WIDTH >> 3}" height="${Math.ceil(HEIGHT / 8)}"
        title="Click to jump the camera"></canvas>
      <div id="builder-cmdk" style="display:none">
        <input id="bp-cmdk-input" placeholder="type a command&hellip; (Esc closes)" spellcheck="false">
        <div id="bp-cmdk-list"></div>
      </div>
      <div id="builder-status"></div>`;
    holder?.appendChild(this.root);

    this.overlay = this.root.querySelector('#builder-overlay') as HTMLDivElement;
    this.canvas = this.root.querySelector('#builder-canvas') as HTMLCanvasElement;
    this.cctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.minimap = this.root.querySelector('#builder-minimap') as HTMLCanvasElement;
    this.minimapCtx = this.minimap.getContext('2d') as CanvasRenderingContext2D;
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

    // MATERIALS: cloned from the Sandbox toolbar's buttons (one source of
    // truth in index.html) — the Builder owns the whole left edge now.
    const matGrid = this.el<HTMLDivElement>('bp-materials');
    for (const src of document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-mode="element"]')) {
      const id = Number(src.dataset.id);
      const name = (src.textContent ?? '').trim();
      const dot = src.querySelector<HTMLElement>('.color-indicator');
      const swatch = document.createElement('button');
      swatch.className = 'bp-swatch';
      swatch.dataset.el = String(id);
      swatch.title = name;
      const d = document.createElement('span');
      d.className = 'dot';
      d.style.background = dot?.style.background ?? '#888';
      swatch.appendChild(d);
      swatch.addEventListener('click', () => this.selectMaterial(id));
      matGrid.appendChild(swatch);
    }
  }

  private snap(v: number): number {
    return this.snapStep === 0 ? v : Math.round(v / this.snapStep) * this.snapStep;
  }

  /** Arm a material for every terrain tool (and mirror it to the Sandbox UI). */
  private selectMaterial(id: number): void {
    const ctx = this.ctx;
    ctx.state.currentElement = id as never;
    ctx.state.activeInputMode = 'element';
    for (const sw of this.root.querySelectorAll<HTMLButtonElement>('.bp-swatch')) {
      sw.classList.toggle('active', Number(sw.dataset.el) === id);
    }
    // keep the (hidden) Sandbox toolbar consistent for when the Builder closes
    for (const b of document.querySelectorAll<HTMLButtonElement>('.tool-btn')) {
      b.classList.toggle('active', b.dataset.mode === 'element' && Number(b.dataset.id) === id);
    }
    const isTerrainTool =
      this.tool === 'paint' || SHAPE_TOOLS.has(this.tool) || this.tool === 'fill' || this.tool === 'replace';
    if (!isTerrainTool) this.setTool('paint');
    const name = ctx.params.materials[id]?.name ?? 'Material ' + id;
    this.status('ARMED: ' + name.toUpperCase());
  }

  private el<T extends HTMLElement>(id: string): T {
    return this.root.querySelector('#' + id) as T;
  }

  private setTool(t: BuilderTool): void {
    this.tool = t;
    if (t !== 'link') this.linkFrom = null;
    if (t !== 'stamp' && this.armedStamp) {
      this.armedStamp = null;
      this.syncStamps();
    }
    this.syncPalette();
    if (t === 'link') this.status('LINK: CLICK A TRIGGER OR RUNE GLYPH, THEN ITS DOOR');
  }

  /* ===================== top bar actions ===================== */

  /** True (and complains) while a settle run/decision is pending. The
   *  procedural panel gates on THIS (it owns its own pendingPreview). */
  private settleBlocks(): boolean {
    if (this.settling || this.settleSnap) {
      this.status('FINISH THE SETTLE PREVIEW FIRST (KEEP / REVERT)', true);
      return true;
    }
    return false;
  }

  /** True (and complains) while a preview — procedural or settle — awaits a decision. */
  private previewBlocks(): boolean {
    if (this.settleBlocks()) return true;
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
      // anything worth keeping guards the discard — not just objects
      const hasWork =
        this.doc.objects.length > 0 ||
        this.doc.lights.length > 0 ||
        this.doc.world !== null ||
        this.cmds.depth > 0 ||
        this.paintDirty;
      if (hasWork && !window.confirm('Discard the current document?')) return;
      this.doc = createEmptyDocument('untitled', this.ctx.state.currentBiome);
      this.cmds.clear();
      this.select(null);
      this.paintDirty = false;
      this.region = null;
      this.syncAll();
      this.status('NEW DOCUMENT');
    });

    this.el('b-save').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      this.ensureCaptured();
      if (saveDocToLibrary(this.doc)) {
        this.status(`SAVED "${this.doc.name.toUpperCase()}"`);
        localStorage.removeItem(DRAFT_KEY); // an explicit save retires the draft
      } else this.status('STORAGE FULL — USE EXPORT', true);
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
      this.select(null);
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
      if (this.previewBlocks()) {
        input.value = '';
        return;
      }
      file.text().then((text) => {
        // Validate-then-swap: the previous document survives any garbage.
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        const doc = parsed === null ? null : sanitizeImportedDoc(parsed);
        if (!doc) {
          this.status('NOT A BUILDER DOCUMENT', true);
        } else {
          this.doc = doc;
          this.cmds.clear();
          this.select(null);
          this.paintDirty = false;
          this.applyDocTerrain();
          this.syncAll();
          this.status(`IMPORTED "${this.doc.name.toUpperCase()}"`);
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

    // The recovery path for "I just wiped the world": re-decode the layer
    // the document already holds. Undo clears — cell patches recorded
    // against the wiped world would lie against the restored one.
    this.el('b-restore').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      if (!this.doc.world) {
        this.status('NOTHING CAPTURED YET — THE DOCUMENT HAS NO TERRAIN', true);
        return;
      }
      this.applyDocTerrain();
      this.cmds.clear();
      this.paintDirty = false;
      this.syncAll();
      this.status('DOCUMENT TERRAIN RESTORED (UNDO HISTORY CLEARED)');
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
    this.prevAmbient = this.ctx.params.global.ambient;
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
      // patrol authoring eats clicks until ESC ends it
      if (this.patrolEditId) {
        this.addPatrolPoint(pos.x, pos.y);
        return;
      }
      if (this.tool === 'paint') {
        if (this.previewBlocks()) return;
        this.beginStroke(pos.x, pos.y);
        return;
      }
      if (this.tool === 'smooth' || this.tool === 'roughen') {
        if (this.previewBlocks()) return;
        this.terraStroke = { rec: new PatchRecorder(this.ctx.world), tool: this.tool };
        this.applyTerraStroke(pos.x, pos.y);
        return;
      }
      if (this.tool === 'polyRegion') {
        this.polyClick(pos.x, pos.y);
        return;
      }
      if (this.tool === 'regionMagic') {
        const found = magicRegion(this.ctx.world, pos.x, pos.y, 600000);
        if (!found) {
          this.status('CLICK AN OPEN AREA (CAVERN) — SOLID OR TOO-HUGE AREAS REFUSE', true);
          return;
        }
        this.region = found.region;
        this.regionMask = found.mask;
        this.syncProcPanel();
        this.status(`MAGIC REGION: ${found.cells} CONNECTED OPEN CELLS`);
        return;
      }
      if (SHAPE_TOOLS.has(this.tool) || this.tool === 'region') {
        // shapes write cells on mouseup; the region tool is read-only
        if (this.tool !== 'region' && this.previewBlocks()) return;
        this.shapeDrag = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
        return;
      }
      if (this.tool === 'fill') {
        if (this.previewBlocks()) return;
        this.commitFlood(pos.x, pos.y);
        return;
      }
      if (this.tool === 'replace') {
        if (this.previewBlocks()) return;
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
      if (this.tool === 'stamp') {
        if (this.previewBlocks() || !this.armedStamp) return;
        const rec = new PatchRecorder(this.ctx.world);
        pasteStamp(this.ctx.world, rec, this.armedStamp, pos.x, pos.y);
        const patch = rec.finish();
        if (patch) {
          this.cmds.run(paintTerrainCmd(this.ctx.world, patch.before, patch.after));
          this.paintDirty = true;
          this.status(`STAMPED "${this.armedStamp.name.toUpperCase()}"`);
        }
        return; // stays armed: stamping comes in runs; ESC is done
      }
      if (this.tool !== 'select') {
        // every non-object tool was handled above; what's left is a placement.
        // Population kinds stay armed (placing ten slimes shouldn't be twenty
        // palette round-trips); ESC steps back to select.
        const kind = this.tool as EditorObjectKind;
        this.place(kind, pos.x, pos.y);
        if (kind !== 'enemy' && kind !== 'pickup') this.setTool('select');
        return;
      }
      const hit = this.hitTest(pos.x, pos.y);
      if (!hit) {
        // empty space: drag a marquee (mouseup with a tiny one just deselects)
        this.marquee = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
        return;
      }
      if (e.shiftKey) {
        // toggle membership; primary follows the latest addition
        if (this.selectedIds.has(hit.id)) {
          this.selectedIds.delete(hit.id);
          if (this.selectedId === hit.id) this.selectedId = [...this.selectedIds][0] ?? null;
        } else {
          this.selectedIds.add(hit.id);
          this.selectedId = hit.id;
        }
        this.syncMarkers();
        this.renderInspector();
        return;
      }
      if (!this.selectedIds.has(hit.id)) {
        // grouped objects select as one unit
        const obj = hit.isLight ? null : (hit.target as EditorObject);
        if (obj?.group) {
          this.selectedIds = new Set(
            this.doc.objects.filter((o) => o.group === obj.group).map((o) => o.id),
          );
          this.selectedId = hit.id;
          this.syncMarkers();
          this.renderInspector();
        } else this.select(hit.id);
      } else {
        this.selectedId = hit.id;
        this.renderInspector();
      }
      // group drag: every unlocked member of the selection moves together
      const targets: Array<{ t: EditorObject | EditorLight; isLight: boolean; ox: number; oy: number }> = [];
      for (const o of this.doc.objects) {
        if (this.selectedIds.has(o.id) && !o.locked) targets.push({ t: o, isLight: false, ox: o.x, oy: o.y });
      }
      for (const l of this.doc.lights) {
        if (this.selectedIds.has(l.id) && !l.locked) targets.push({ t: l, isLight: true, ox: l.x, oy: l.y });
      }
      if (targets.length > 0) this.drag = { targets, grabX: pos.x, grabY: pos.y };
    });
    window.addEventListener('mousemove', (e) => {
      const pos = this.mouseToWorld(e);
      this.lastMouse = pos;
      if (this.stroke) {
        this.strokeMove(pos.x, pos.y);
        return;
      }
      if (this.terraStroke) {
        this.applyTerraStroke(pos.x, pos.y);
        return;
      }
      if (this.shapeDrag) {
        this.shapeDrag.x1 = pos.x;
        this.shapeDrag.y1 = pos.y;
        return;
      }
      if (this.marquee) {
        this.marquee.x1 = pos.x;
        this.marquee.y1 = pos.y;
        return;
      }
      if (!this.drag) return;
      const dx = pos.x - this.drag.grabX;
      const dy = pos.y - this.drag.grabY;
      for (const m of this.drag.targets) {
        m.t.x = this.snap(m.ox + dx);
        m.t.y = this.snap(m.oy + dy);
      }
    });
    window.addEventListener('mouseup', () => {
      if (this.stroke) {
        this.endStroke();
        return;
      }
      if (this.terraStroke) {
        const t = this.terraStroke;
        this.terraStroke = null;
        const patch = t.rec.finish();
        if (patch) {
          this.cmds.run(paintTerrainCmd(this.ctx.world, patch.before, patch.after));
          this.paintDirty = true;
          this.status(`${t.tool.toUpperCase()}: ${patch.before.idxs.length} CELLS`);
        }
        return;
      }
      if (this.shapeDrag) {
        const s = this.shapeDrag;
        this.shapeDrag = null;
        if (this.tool === 'region') this.commitRegion(s);
        else this.commitShape(s);
        return;
      }
      if (this.marquee) {
        const m = this.marquee;
        this.marquee = null;
        this.commitMarquee(m);
        return;
      }
      if (!this.drag) return;
      const { targets } = this.drag;
      this.drag = null;
      const moved = targets.filter((m) => m.t.x !== m.ox || m.t.y !== m.oy);
      if (moved.length === 0) return;
      // Rewind the live preview, then land the group move as ONE command.
      const cmds: Command[] = moved.map((m) => {
        const nx = m.t.x,
          ny = m.t.y;
        m.t.x = m.ox;
        m.t.y = m.oy;
        return m.isLight
          ? moveLightCmd(m.t as EditorLight, nx, ny)
          : moveObjectCmd(m.t as EditorObject, nx, ny);
      });
      this.cmds.run(cmds.length === 1 ? cmds[0] : compositeCmd('move ' + cmds.length + ' things', cmds));
      this.renderInspector();
    });
  }

  /** Marquee select: everything whose anchor falls in the box (tiny box = deselect). */
  private commitMarquee(m: { x0: number; y0: number; x1: number; y1: number }): void {
    const x0 = Math.min(m.x0, m.x1),
      x1 = Math.max(m.x0, m.x1);
    const y0 = Math.min(m.y0, m.y1),
      y1 = Math.max(m.y0, m.y1);
    if (x1 - x0 < 3 && y1 - y0 < 3) {
      this.select(null);
      return;
    }
    const ids: string[] = [];
    for (const o of this.doc.objects) {
      if (!this.layerSelectableObj(o)) continue;
      const f = objectFootprint(o);
      const inside = f
        ? f.x1 >= x0 && f.x0 <= x1 && f.y1 >= y0 && f.y0 <= y1
        : o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1;
      if (inside) ids.push(o.id);
    }
    if (!this.layerHidden.has('lights') && !this.layerLocked.has('lights')) {
      for (const l of this.doc.lights) {
        if (l.x >= x0 && l.x <= x1 && l.y >= y0 && l.y <= y1) ids.push(l.id);
      }
    }
    this.selectedIds = new Set(ids);
    this.selectedId = ids[0] ?? null;
    this.syncMarkers();
    this.renderInspector();
    if (ids.length > 0) this.status(`${ids.length} SELECTED — DRAG MOVES, CTRL+D DUPLICATES`);
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
    if (this.previewBlocks()) return;
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
    this.regionMask = null;
    if (x1 - x0 < 3 || y1 - y0 < 3) {
      this.region = null;
      this.status('REGION CLEARED');
    } else {
      this.region = { x0, y0, x1, y1 };
      this.status(`REGION SET: ${x1 - x0 + 1}×${y1 - y0 + 1} — PASSES & REPLACE USE IT`);
    }
    this.syncProcPanel();
  }

  /** Polygon region: collect vertices; closing happens near the first vertex
   *  (or with Enter). The rasterized mask narrows passes/replace/bake. */
  private polyClick(x: number, y: number): void {
    const first = this.polyPoints[0];
    if (this.polyPoints.length >= 3 && first && Math.abs(first[0] - x) + Math.abs(first[1] - y) < 8) {
      this.closePolyRegion();
      return;
    }
    this.polyPoints.push([x, y]);
    this.status(`POLYGON: ${this.polyPoints.length} VERTICES — CLICK NEAR THE FIRST (OR ENTER) TO CLOSE`);
  }

  private closePolyRegion(): void {
    const result = rasterizePolygon(this.polyPoints);
    this.polyPoints = [];
    if (!result) {
      this.status('POLYGON TOO SMALL — NEEDS 3+ SPREAD-OUT VERTICES', true);
      return;
    }
    this.region = result.region;
    this.regionMask = result.mask;
    this.setTool('select');
    this.syncProcPanel();
    let cells = 0;
    for (const v of result.mask) cells += v;
    this.status(`POLYGON REGION SET: ${cells} CELLS — PASSES & REPLACE USE IT`);
  }

  /** One smoothing/roughening application per pointer sample. */
  private applyTerraStroke(x: number, y: number): void {
    const t = this.terraStroke;
    if (!t) return;
    const r = Math.max(3, this.ctx.state.brushSize);
    if (t.tool === 'smooth') smoothDisc(this.ctx.world, t.rec, x, y, r);
    else roughenDisc(this.ctx.world, t.rec, x, y, r);
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
    const n = replaceMaterial(w, rec, x, y, type, this.region, REPLACE_CAP, this.regionMask);
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

  /** RMB eyedropper: pick the material under the cursor, arm the brush. */
  private eyedrop(x: number, y: number): void {
    const ctx = this.ctx;
    if (!ctx.world.inBounds(x, y)) return;
    const t = ctx.world.types[ctx.world.idx(x, y)];
    this.selectMaterial(t);
    const name = ctx.params.materials[t]?.name ?? 'Material ' + t;
    this.status('PICKED: ' + name.toUpperCase());
    this.syncProcPanel();
  }

  /** Whole-world reshapes from inside the Builder (confirm when work exists). */
  private guardedWorldGen(action: 'caves' | 'fortress' | 'clear'): void {
    if (this.previewBlocks()) return;
    const hasWork = this.doc.world !== null || this.cmds.depth > 0 || this.paintDirty;
    if (
      hasWork &&
      !window.confirm(
        'This reshapes the ENTIRE world under the open document and cannot be undone. ' +
          '(RESTORE re-decodes the last captured terrain.) Continue?',
      )
    )
      return;
    if (action === 'caves') {
      this.ctx.state.currentBiome = this.doc.biome; // the document drives the look
      this.ctx.worldgen.regenerate(this.ctx);
    } else if (action === 'fortress') {
      this.ctx.worldgen.spawnFortress(this.ctx);
    } else {
      this.ctx.world.clear();
    }
    this.paintDirty = true;
    this.status(action.toUpperCase() + ' DONE — CAPTURE TERRAIN OR SAVE WHEN HAPPY');
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
    let px = this.snap(x),
      py = this.snap(y);
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
      x: this.snap(x),
      y: this.snap(y),
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
    // stays armed: light rigs come in clusters; ESC steps back to select
    this.status('PLACED LIGHT — ESC WHEN DONE');
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
    const lightsSelectable = !this.layerHidden.has('lights') && !this.layerLocked.has('lights');
    for (const o of this.doc.objects) {
      if (!this.layerSelectableObj(o)) continue;
      const d = (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y);
      if (d <= bestD) {
        bestD = d;
        best = { id: o.id, target: o, isLight: false };
      }
    }
    if (lightsSelectable) {
      for (const l of this.doc.lights) {
        const d = (l.x - x) * (l.x - x) + (l.y - y) * (l.y - y);
        if (d <= bestD) {
          bestD = d;
          best = { id: l.id, target: l, isLight: true };
        }
      }
    }
    if (best) return best;
    // No marker nearby — fall back to footprint containment (door slabs etc.)
    for (const o of this.doc.objects) {
      if (!this.layerSelectableObj(o)) continue;
      const f = objectFootprint(o);
      if (f && x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1) {
        return { id: o.id, target: o, isLight: false };
      }
    }
    return null;
  }

  private select(id: string | null): void {
    this.selectedId = id;
    this.selectedIds = id ? new Set([id]) : new Set();
    this.syncMarkers();
    this.renderInspector();
  }

  /** Duplicate the selection (Ctrl+D): fresh ids, +8/+8 offset; links whose
   *  BOTH endpoints are selected come along with remapped ids. Spawn stays
   *  unique and is skipped. */
  private duplicateSelection(): void {
    const idMap = new Map<string, string>();
    const adds: Command[] = [];
    const newIds: string[] = [];
    for (const o of this.doc.objects) {
      if (!this.selectedIds.has(o.id) || o.kind === 'spawn') continue;
      const clone: EditorObject = {
        ...o,
        id: freshId(o.kind),
        x: o.x + 8,
        y: o.y + 8,
        params: JSON.parse(JSON.stringify(o.params)) as Record<string, unknown>,
      };
      idMap.set(o.id, clone.id);
      newIds.push(clone.id);
      adds.push(addObjectCmd(clone));
    }
    for (const l of this.doc.lights) {
      if (!this.selectedIds.has(l.id)) continue;
      const clone: EditorLight = { ...l, id: freshId('light'), x: l.x + 8, y: l.y + 8 };
      newIds.push(clone.id);
      adds.push(addLightCmd(clone));
    }
    for (const link of this.doc.links) {
      const nf = idMap.get(link.fromId);
      const nt = idMap.get(link.toId);
      if (nf && nt) {
        adds.push(addLinkCmd({ ...link, id: freshId('link'), fromId: nf, toId: nt }));
      }
    }
    if (adds.length === 0) {
      this.status('NOTHING TO DUPLICATE');
      return;
    }
    this.cmds.run(compositeCmd('duplicate ' + newIds.length, adds));
    this.selectedIds = new Set(newIds);
    this.selectedId = newIds[0] ?? null;
    this.syncMarkers();
    this.renderInspector();
    this.status(`DUPLICATED ${newIds.length} — DRAG TO PLACE`);
  }

  /** Ctrl+G: bind the selected objects into a group; Ctrl+Shift+G dissolves. */
  private groupSelection(ungroup: boolean): void {
    const members = this.doc.objects.filter((o) => this.selectedIds.has(o.id));
    if (ungroup) {
      const cmds = members.filter((o) => o.group).map((o) => setObjectGroupCmd(o, undefined));
      if (cmds.length === 0) {
        this.status('NOTHING GROUPED HERE');
        return;
      }
      this.cmds.run(compositeCmd('ungroup ' + cmds.length, cmds));
      this.status('UNGROUPED');
      return;
    }
    if (members.length < 2) {
      this.status('SELECT 2+ OBJECTS TO GROUP (MARQUEE OR SHIFT-CLICK)', true);
      return;
    }
    const gid = freshId('grp');
    this.cmds.run(compositeCmd('group ' + members.length, members.map((o) => setObjectGroupCmd(o, gid))));
    this.status(`GROUPED ${members.length} — CLICK ANY MEMBER TO SELECT THEM ALL`);
  }

  /** Align the selection to the primary; spread distributes evenly between ends. */
  private alignSelection(mode: 'x' | 'y' | 'spreadX' | 'spreadY'): void {
    const targets: Array<{ t: EditorObject | EditorLight; isLight: boolean }> = [];
    for (const o of this.doc.objects) {
      if (this.selectedIds.has(o.id) && !o.locked) targets.push({ t: o, isLight: false });
    }
    for (const l of this.doc.lights) {
      if (this.selectedIds.has(l.id) && !l.locked) targets.push({ t: l, isLight: true });
    }
    const moves: Command[] = [];
    if (mode === 'x' || mode === 'y') {
      const primary = (this.selected() ?? this.selectedLight()) as EditorObject | EditorLight | null;
      if (!primary) return;
      for (const m of targets) {
        if (m.t.id === primary.id) continue;
        const nx = mode === 'x' ? primary.x : m.t.x;
        const ny = mode === 'y' ? primary.y : m.t.y;
        if (nx === m.t.x && ny === m.t.y) continue;
        moves.push(
          m.isLight
            ? moveLightCmd(m.t as EditorLight, nx, ny)
            : moveObjectCmd(m.t as EditorObject, nx, ny),
        );
      }
    } else {
      if (targets.length < 3) {
        this.status('DISTRIBUTE NEEDS 3+ UNLOCKED THINGS', true);
        return;
      }
      const horizontal = mode === 'spreadX';
      const sorted = [...targets].sort((a, b) => (horizontal ? a.t.x - b.t.x : a.t.y - b.t.y));
      const first = horizontal ? sorted[0].t.x : sorted[0].t.y;
      const last = horizontal ? sorted[sorted.length - 1].t.x : sorted[sorted.length - 1].t.y;
      const step = (last - first) / (sorted.length - 1);
      sorted.forEach((m, n) => {
        const v = Math.round(first + step * n);
        const nx = horizontal ? v : m.t.x;
        const ny = horizontal ? m.t.y : v;
        if (nx === m.t.x && ny === m.t.y) return;
        moves.push(
          m.isLight
            ? moveLightCmd(m.t as EditorLight, nx, ny)
            : moveObjectCmd(m.t as EditorObject, nx, ny),
        );
      });
    }
    if (moves.length === 0) {
      this.status('ALREADY ALIGNED');
      return;
    }
    this.cmds.run(moves.length === 1 ? moves[0] : compositeCmd(mode + ' ' + moves.length, moves));
    this.syncMarkers();
    this.status(mode.toUpperCase() + ': ' + moves.length + ' MOVED');
  }

  /** Ctrl+C: copy the primary object's params; Ctrl+V pastes onto same-kind selection. */
  private copyParams(): void {
    const obj = this.selected();
    if (!obj) {
      this.status('SELECT AN OBJECT TO COPY ITS PARAMS');
      return;
    }
    this.clipboard = {
      kind: obj.kind,
      params: JSON.parse(JSON.stringify(obj.params)) as Record<string, unknown>,
    };
    this.status('COPIED ' + obj.kind.toUpperCase() + ' PARAMS — CTRL+V ON SAME-KIND OBJECTS');
  }

  private pasteParams(): void {
    const clip = this.clipboard;
    if (!clip) {
      this.status('NOTHING COPIED YET (CTRL+C)');
      return;
    }
    const edits: Command[] = [];
    let count = 0;
    for (const o of this.doc.objects) {
      if (!this.selectedIds.has(o.id) || o.kind !== clip.kind || o.locked) continue;
      for (const [key, value] of Object.entries(clip.params)) {
        edits.push(editParamCmd(o, key, value));
      }
      count++;
    }
    if (edits.length === 0) {
      this.status(`NO UNLOCKED ${clip.kind.toUpperCase()} IN THE SELECTION`, true);
      return;
    }
    this.cmds.run(compositeCmd('paste params ×' + count, edits));
    this.renderInspector();
    this.status(`PASTED ${clip.kind.toUpperCase()} PARAMS ONTO ${count}`);
  }

  private selected(): EditorObject | null {
    return this.doc.objects.find((o) => o.id === this.selectedId) ?? null;
  }

  /** Center the camera on the selection (F, and validation issue clicks). */
  private frameSelection(): void {
    const obj = this.selected();
    const light = this.selectedLight();
    const rec = obj ?? light;
    if (!rec) return;
    let cx = rec.x,
      cy = rec.y;
    if (obj) {
      const f = objectFootprint(obj);
      if (f) {
        cx = (f.x0 + f.x1) / 2;
        cy = (f.y0 + f.y1) / 2;
      }
    }
    this.ctx.camera.snapTo(cx, cy);
  }

  private selectedLight(): EditorLight | null {
    return this.doc.lights.find((l) => l.id === this.selectedId) ?? null;
  }

  private deleteSelection(): void {
    const dels: Command[] = [];
    let lockedSkipped = 0;
    for (const o of this.doc.objects) {
      if (!this.selectedIds.has(o.id)) continue;
      if (o.locked) lockedSkipped++;
      else dels.push(deleteObjectCmd(o));
    }
    for (const l of this.doc.lights) {
      if (!this.selectedIds.has(l.id)) continue;
      if (l.locked) lockedSkipped++;
      else {
        if (this.soloLightId === l.id) this.soloLightId = null;
        dels.push(deleteLightCmd(l));
      }
    }
    if (dels.length === 0) {
      if (lockedSkipped > 0) this.status('LOCKED — UNLOCK TO DELETE', true);
      return;
    }
    this.cmds.run(dels.length === 1 ? dels[0] : compositeCmd('delete ' + dels.length + ' things', dels));
    this.select(null);
    this.status(
      `DELETED ${dels.length}` + (lockedSkipped > 0 ? ` (${lockedSkipped} LOCKED SKIPPED)` : ''),
    );
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
      if (this.settleBlocks()) return;
      // A pending preview commits exactly as shown; otherwise run fresh.
      if (this.pendingPreview) this.applyPreview();
      else this.procRun(false);
    });
    this.el('bp-discard').addEventListener('click', () => {
      if (this.settleBlocks()) return;
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
    if (this.settleBlocks()) return;
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
      const result = runPass(def, w, rec, seed, region, density, material, this.region ? this.regionMask : null);
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
      adds.push(this.passHistoryCmd(def.id, seed, density, material, region));
      this.cmds.run(compositeCmd('pass:' + def.id, adds));
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
    const result = runPass(def, w, rec, seed, region, density, material, this.region ? this.regionMask : null);
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
      this.cmds.run(
        compositeCmd('pass:' + def.id, [
          paintTerrainCmd(w, patch.before, patch.after),
          this.passHistoryCmd(def.id, seed, density, material, region),
        ]),
      );
      this.paintDirty = true;
      this.procStatus(result.summary.toUpperCase() + ' — APPLIED');
      this.status('PASS APPLIED: ' + result.summary.toUpperCase());
    }
  }

  /** Commit a pending preview through the undo stack. */
  private applyPreview(): void {
    const p = this.pendingPreview;
    if (!p) return;
    this.pendingPreview = null;
    this.cmds.run(
      compositeCmd('pass:' + p.passId, [
        paintTerrainCmd(this.ctx.world, p.before, p.after),
        this.passHistoryCmd(p.passId, p.seed, p.density, p.material, p.region),
      ]),
    );
    this.paintDirty = true;
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

  /**
   * History entry as a command, so undoing a pass also retracts its claim
   * from proceduralHistory (a history line must mean "this is in the doc").
   */
  private passHistoryCmd(
    pass: string,
    seed: number,
    density: number,
    material: number,
    region: Region,
  ): Command {
    const entry = {
      id: freshId('pass'),
      pass,
      seed,
      params: {
        density,
        material,
        region: this.region ? { ...region } : null,
      },
      appliedAt: new Date().toISOString(),
    };
    return {
      label: 'history',
      do: (doc) => {
        doc.proceduralHistory.push(entry);
      },
      undo: (doc) => {
        const i = doc.proceduralHistory.indexOf(entry);
        if (i >= 0) doc.proceduralHistory.splice(i, 1);
      },
    };
  }

  /* ============= zoom, minimap, stamps, settle, share, overlays ============= */

  private wireExtras(): void {
    // Wheel = editor zoom (1x-4x); the minimap is the wide view.
    this.overlay.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.zoomTarget = Math.min(4, Math.max(1, this.zoomTarget * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        this.ctx.camera.zoomLock = this.zoomTarget;
      },
      { passive: false },
    );

    // Minimap: click (or drag) jumps the camera.
    let mmDown = false;
    const mmJump = (e: MouseEvent): void => {
      const r = this.minimap.getBoundingClientRect();
      const wx = ((e.clientX - r.left) / r.width) * WIDTH;
      const wy = ((e.clientY - r.top) / r.height) * HEIGHT;
      this.ctx.camera.snapTo(wx, wy);
    };
    this.minimap.addEventListener('mousedown', (e) => {
      mmDown = true;
      mmJump(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (mmDown) mmJump(e);
    });
    window.addEventListener('mouseup', () => {
      mmDown = false;
    });

    this.el('bp-light-toggle').addEventListener('click', () => {
      this.lightPreviewOn = !this.lightPreviewOn;
      this.el('bp-light-toggle').textContent = `PREVIEW LIGHTS: ${this.lightPreviewOn ? 'ON' : 'OFF'}`;
    });

    this.el<HTMLInputElement>('bp-brush').addEventListener('input', () => {
      const v = Number(this.el<HTMLInputElement>('bp-brush').value);
      if (Number.isFinite(v)) this.ctx.state.brushSize = v;
      this.el('bp-brush-val').textContent = String(this.ctx.state.brushSize);
    });
    this.el('bp-gen-caves').addEventListener('click', () => this.guardedWorldGen('caves'));
    this.el('bp-gen-fort').addEventListener('click', () => this.guardedWorldGen('fortress'));
    this.el('bp-gen-clear').addEventListener('click', () => this.guardedWorldGen('clear'));

    // DRAG-TO-PLACE: object/light buttons can be dragged straight onto the
    // canvas (the intuitive gesture); a plain click still arms the tool.
    const dragSources = [
      ...this.root.querySelectorAll<HTMLButtonElement>('.bp-tool[data-kind]'),
      this.root.querySelector<HTMLButtonElement>('.bp-tool[data-tool="light"]')!,
    ];
    for (const btn of dragSources) {
      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const kind = (btn.dataset.kind ?? 'light') as EditorObjectKind | 'light';
        this.palDrag = { kind, startX: e.clientX, startY: e.clientY, ghost: null };
        e.preventDefault(); // no text selection while dragging
      });
    }
    window.addEventListener('mousemove', (e) => {
      const d = this.palDrag;
      if (!d) return;
      if (!d.ghost) {
        if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 6) return;
        const ghost = document.createElement('div');
        ghost.className = 'b-dnd-ghost';
        ghost.textContent = d.kind === 'light' ? '*' : (GLYPH[d.kind] ?? '?');
        document.body.appendChild(ghost);
        d.ghost = ghost;
      }
      d.ghost.style.left = e.clientX + 'px';
      d.ghost.style.top = e.clientY + 'px';
    });
    window.addEventListener('mouseup', (e) => {
      const d = this.palDrag;
      if (!d) return;
      this.palDrag = null;
      if (!d.ghost) return; // plain click: the button's click handler arms the tool
      d.ghost.remove();
      const r = this.overlay.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        this.status('DROPPED OUTSIDE THE CANVAS');
        return;
      }
      const pos = this.mouseToWorld(e);
      if (d.kind === 'light') this.placeLight(pos.x, pos.y);
      else this.place(d.kind, pos.x, pos.y);
    });

    this.el('bp-stamp-capture').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      if (!this.region) {
        this.status('SELECT A REGION FIRST (R), THEN CAPTURE IT', true);
        return;
      }
      const name = window.prompt('Stamp name:', 'stamp ' + (this.stampsList.length + 1));
      if (name === null) return;
      const stamp = captureStamp(this.ctx.world, this.region, name.trim());
      if (!stamp) {
        this.status('REGION TOO LARGE FOR A STAMP (MAX ~40K CELLS)', true);
        return;
      }
      this.stampsList.push(stamp);
      if (!saveStamps(this.stampsList)) this.status('STAMP STORAGE FULL', true);
      this.syncStamps();
      this.status(`STAMP "${stamp.name.toUpperCase()}" CAPTURED (${stamp.w}×${stamp.h})`);
    });

    this.el('bp-settle').addEventListener('click', () => this.startSettle());
    this.el('bp-settle-keep').addEventListener('click', () => this.finishSettle(true));
    this.el('bp-settle-revert').addEventListener('click', () => this.finishSettle(false));

    this.el('bp-overlay-btn').addEventListener('click', () => this.cycleOverlay());
    this.el('bp-snap-btn').addEventListener('click', () => {
      this.snapStep = this.snapStep === 0 ? 8 : this.snapStep === 8 ? 16 : 0;
      this.el('bp-snap-btn').textContent = 'SNAP: ' + (this.snapStep === 0 ? 'OFF' : this.snapStep);
      this.status(this.snapStep === 0 ? 'SNAP OFF' : `SNAP TO ${this.snapStep}-CELL GRID`);
    });

    this.el('b-share').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      this.ensureCaptured();
      void docToShareCode(this.doc).then(async (code) => {
        let copied = false;
        try {
          await navigator.clipboard.writeText(code);
          copied = true;
        } catch {
          copied = false;
        }
        window.prompt(
          copied ? 'Share code (already on the clipboard):' : 'Share code (Ctrl+C to copy):',
          code,
        );
        this.status(`SHARE CODE READY — ${Math.max(1, Math.round(code.length / 1024))} KB`);
      });
    });

    this.el('b-code').addEventListener('click', () => {
      if (this.previewBlocks()) return;
      const code = window.prompt('Paste a share code:');
      if (!code) return;
      void shareCodeToDoc(code).then((doc) => {
        if (!doc) {
          this.status('NOT A VALID SHARE CODE', true);
          return;
        }
        this.doc = doc;
        this.cmds.clear();
        this.select(null);
        this.paintDirty = false;
        this.applyDocTerrain();
        this.syncAll();
        this.status(`IMPORTED "${this.doc.name.toUpperCase()}" FROM CODE`);
      });
    });
  }

  /** Rebuild the stamp list UI (armed stamp highlighted; × deletes). */
  private syncStamps(): void {
    const list = this.el<HTMLDivElement>('bp-stamp-list');
    list.innerHTML = '';
    for (const s of this.stampsList) {
      const row = document.createElement('div');
      row.className = 'bp-stamp' + (this.armedStamp?.id === s.id ? ' armed' : '');
      row.innerHTML = `<span class="bp-stamp-name">${s.name}</span><span class="bp-stamp-size">${s.w}×${s.h}</span><button title="Delete stamp">&times;</button>`;
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') {
          this.stampsList = this.stampsList.filter((x) => x.id !== s.id);
          if (this.armedStamp?.id === s.id) this.armedStamp = null;
          saveStamps(this.stampsList);
          this.syncStamps();
          return;
        }
        this.armedStamp = s;
        this.setTool('stamp');
        this.syncStamps();
        this.status(`STAMP ARMED: "${s.name.toUpperCase()}" — Q ROTATES, E FLIPS, ESC DONE`);
      });
      list.appendChild(row);
    }
  }

  /* ---------- editor layers (visibility/locking, editor-side only) ---------- */

  private wireLayers(): void {
    for (const row of this.root.querySelectorAll<HTMLDivElement>('.bp-layer')) {
      const family = row.dataset.layer as LayerFamily;
      row.querySelector('[data-vis]')?.addEventListener('click', () => {
        if (this.layerHidden.has(family)) this.layerHidden.delete(family);
        else this.layerHidden.add(family);
        this.syncLayers();
        this.syncMarkers();
      });
      row.querySelector('[data-lock]')?.addEventListener('click', () => {
        if (this.layerLocked.has(family)) this.layerLocked.delete(family);
        else this.layerLocked.add(family);
        this.syncLayers();
      });
    }
  }

  private syncLayers(): void {
    for (const row of this.root.querySelectorAll<HTMLDivElement>('.bp-layer')) {
      const family = row.dataset.layer as LayerFamily;
      row.classList.toggle('off', this.layerHidden.has(family));
      row.classList.toggle('locked', this.layerLocked.has(family));
    }
  }

  private layerVisibleObj(o: EditorObject): boolean {
    return !this.layerHidden.has(familyOf(o));
  }

  private layerSelectableObj(o: EditorObject): boolean {
    const f = familyOf(o);
    return !this.layerHidden.has(f) && !this.layerLocked.has(f);
  }

  /* ---------- bake from playtest ---------- */

  /**
   * Re-apply the scars the last playtest left, on top of the document
   * terrain. With a region set this is a precise, UNDOABLE patch ("keep
   * that lava burn"); without one it replaces the whole world (no undo —
   * RESTORE remains the way back). Mind that scars include compiled
   * mechanism cells (doors, basins) — region bakes are the intended tool.
   */
  private bakePlaytestScars(): void {
    if (this.previewBlocks()) return;
    const scars = this.playtestScars;
    if (!scars) {
      this.status('NO PLAYTEST SCARS HELD — PLAYTEST FIRST, THEN BAKE ON RETURN', true);
      return;
    }
    const w = this.ctx.world;
    if (this.region) {
      const rec = new PatchRecorder(w);
      const r = this.region;
      const rw = r.x1 - r.x0 + 1;
      let n = 0;
      for (let y = Math.max(0, r.y0); y <= Math.min(w.height - 1, r.y1); y++) {
        for (let x = Math.max(0, r.x0); x <= Math.min(w.width - 1, r.x1); x++) {
          if (this.regionMask && this.regionMask[x - r.x0 + (y - r.y0) * rw] !== 1) continue;
          const i = w.idx(x, y);
          if (w.types[i] === scars.types[i] && w.life[i] === scars.life[i] && w.charge[i] === scars.charge[i])
            continue;
          rec.touch(i);
          w.types[i] = scars.types[i];
          const fn = COLOR_FN[scars.types[i]];
          w.colors[i] = fn ? fn() : EMPTY_COLOR;
          w.life[i] = scars.life[i];
          w.charge[i] = scars.charge[i];
          n++;
        }
      }
      const patch = rec.finish();
      if (!patch) {
        this.status('NO SCAR DIFFERENCES INSIDE THE REGION');
        return;
      }
      this.cmds.run(paintTerrainCmd(w, patch.before, patch.after));
      this.paintDirty = true;
      this.status(`BAKED ${n} SCARRED CELLS FROM THE PLAYTEST (UNDOABLE)`);
      return;
    }
    if (
      !window.confirm(
        'Bake the ENTIRE playtest world over the document terrain? This includes compiled mechanism cells and cannot be undone (RESTORE returns to the captured layer). Set a region first for a precise, undoable bake.',
      )
    )
      return;
    w.types.set(scars.types);
    for (let i = 0; i < w.types.length; i++) {
      const fn = COLOR_FN[w.types[i]];
      w.colors[i] = fn ? fn() : EMPTY_COLOR;
    }
    w.life.set(scars.life);
    w.charge.set(scars.charge);
    this.cmds.clear();
    this.paintDirty = true;
    this.status('PLAYTEST WORLD BAKED (UNDO CLEARED — RESTORE IS THE WAY BACK)');
  }

  /* ---------- patrol authoring ---------- */

  private addPatrolPoint(x: number, y: number): void {
    const obj = this.doc.objects.find((o) => o.id === this.patrolEditId);
    if (!obj) {
      this.patrolEditId = null;
      return;
    }
    const points = Array.isArray(obj.params.patrol)
      ? ([...(obj.params.patrol as Array<[number, number]>)] as Array<[number, number]>)
      : [];
    points.push([Math.floor(x), Math.floor(y)]);
    this.cmds.run(editParamCmd(obj, 'patrol', points));
    this.status(`PATROL POINT ${points.length} — ESC WHEN DONE`);
  }

  /* ---------- settle preview: run real physics, then keep or revert ---------- */

  private startSettle(): void {
    if (this.previewBlocks()) return;
    const w = this.ctx.world;
    this.settleWasDirty = this.paintDirty;
    this.settleSnap = {
      types: w.types.slice(),
      colors: w.colors.slice(),
      life: w.life.slice(),
      charge: w.charge.slice(),
    };
    this.settling = true;
    this.settleEndFrame = this.ctx.state.frameCount + 120;
    this.ctx.state.paused = false; // the sim runs for real — that IS the preview
    this.status('SETTLING THE VISIBLE AREA (2s)…');
    this.syncSettleButtons();
  }

  private finishSettle(keep: boolean): void {
    const snap = this.settleSnap;
    if (!snap) return;
    if (this.settling) {
      // mid-run decision: stop the clock first
      this.settling = false;
      this.ctx.state.paused = true;
    }
    this.settleSnap = null;
    const w = this.ctx.world;
    if (!keep) {
      w.types.set(snap.types);
      w.colors.set(snap.colors);
      w.life.set(snap.life);
      w.charge.set(snap.charge);
      this.status('SETTLE REVERTED');
      this.syncSettleButtons();
      return;
    }
    // diff into an undoable patch when it's small enough to retain
    const before: CellPatch = { idxs: [], types: [], colors: [], life: [], charge: [] };
    const after: CellPatch = { idxs: [], types: [], colors: [], life: [], charge: [] };
    let overCap = false;
    for (let i = 0; i < w.types.length; i++) {
      if (
        w.types[i] === snap.types[i] &&
        w.colors[i] === snap.colors[i] &&
        w.life[i] === snap.life[i] &&
        w.charge[i] === snap.charge[i]
      )
        continue;
      if (before.idxs.length >= SETTLE_UNDO_CAP) {
        overCap = true;
        break;
      }
      before.idxs.push(i);
      before.types.push(snap.types[i]);
      before.colors.push(snap.colors[i]);
      before.life.push(snap.life[i]);
      before.charge.push(snap.charge[i]);
      after.idxs.push(i);
      after.types.push(w.types[i]);
      after.colors.push(w.colors[i]);
      after.life.push(w.life[i]);
      after.charge.push(w.charge[i]);
    }
    this.paintDirty = true;
    if (overCap) {
      this.status('SETTLED — TOO LARGE TO UNDO, CAPTURED ON NEXT SAVE');
    } else if (before.idxs.length > 0) {
      this.cmds.run(paintTerrainCmd(w, before, after));
      this.status(`SETTLED ${before.idxs.length} CELLS (UNDOABLE)`);
    } else {
      this.status('NOTHING MOVED');
      // restore, don't clear: earlier uncaptured paint keeps its dirty flag
      this.paintDirty = this.settleWasDirty;
    }
    this.syncSettleButtons();
    this.renderInspector();
  }

  private syncSettleButtons(): void {
    const deciding = this.settleSnap !== null && !this.settling;
    this.el('bp-settle').style.display = this.settleSnap === null ? '' : 'none';
    this.el('bp-settle-keep').style.display = deciding ? '' : 'none';
    this.el('bp-settle-revert').style.display = deciding ? '' : 'none';
  }

  /* ---------- readability overlays ---------- */

  private cycleOverlay(): void {
    const next = OVERLAY_MODES[(OVERLAY_MODES.indexOf(this.overlayMode) + 1) % OVERLAY_MODES.length];
    this.overlayMode = next;
    this.el('bp-overlay-btn').textContent = 'OVERLAY: ' + next.toUpperCase();
  }

  /* ---------- autosave drafts ---------- */

  private autosaveDraft(): void {
    if (!this.isOpen || this.settling || this.settleSnap || this.pendingPreview) return;
    if (this.cmds.depth === 0 && !this.paintDirty) return;
    try {
      this.ensureCaptured();
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), doc: this.doc }));
      this.status('DRAFT AUTOSAVED');
    } catch {
      // quota — the explicit SAVE path reports storage problems loudly
    }
  }

  private offerDraft(): void {
    if (this.draftOffered) return;
    this.draftOffered = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { at: number; doc: unknown };
      const restored = sanitizeImportedDoc(draft.doc);
      if (!restored) return;
      const when = new Date(draft.at).toLocaleTimeString();
      if (!window.confirm(`Restore the autosaved draft "${restored.name}" from ${when}?`)) return;
      this.doc = restored;
      this.cmds.clear();
      this.select(null);
      this.paintDirty = false;
      this.applyDocTerrain();
      this.syncAll();
      this.status('DRAFT RESTORED');
    } catch {
      // a corrupt draft is just gone
    }
  }

  /* ---------- command palette (Ctrl+K) ---------- */

  /** Every action the bar/palette exposes, searchable in one place. */
  private cmdkActions(): Array<{ label: string; run: () => void }> {
    const click = (id: string) => () => this.el<HTMLButtonElement>(id).click();
    const tool = (t: BuilderTool, label: string) => ({ label, run: () => this.setTool(t) });
    return [
      { label: 'Find invalid object', run: () => this.findInvalid() },
      { label: 'Frame selection (F)', run: () => this.frameSelection() },
      { label: 'Validate document', run: click('b-validate') },
      { label: 'Playtest (compile & play)', run: click('b-playtest') },
      { label: 'Playtest from cursor (T)', run: () => this.playtestHere() },
      { label: 'Save document', run: click('b-save') },
      { label: 'Export document (.json)', run: click('b-export') },
      { label: 'Share code (copy)', run: click('b-share') },
      { label: 'Import from share code', run: click('b-code') },
      { label: 'Capture terrain into document', run: click('b-capture') },
      { label: 'Restore document terrain', run: click('b-restore') },
      { label: 'New document', run: click('b-new') },
      { label: 'Settle preview (2s of physics)', run: () => this.startSettle() },
      { label: 'Bake playtest scars', run: () => this.bakePlaytestScars() },
      { label: 'Toggle light preview', run: click('bp-light-toggle') },
      { label: 'Cycle readability overlay (O)', run: () => this.cycleOverlay() },
      { label: 'Cycle snap grid', run: click('bp-snap-btn') },
      { label: 'Generate caves (whole world)', run: () => this.guardedWorldGen('caves') },
      { label: 'Spawn fortress', run: () => this.guardedWorldGen('fortress') },
      { label: 'Clear world', run: () => this.guardedWorldGen('clear') },
      { label: 'Group selection (Ctrl+G)', run: () => this.groupSelection(false) },
      { label: 'Ungroup selection (Ctrl+Shift+G)', run: () => this.groupSelection(true) },
      { label: 'Duplicate selection (Ctrl+D)', run: () => this.duplicateSelection() },
      tool('select', 'Tool: Select (V)'),
      tool('paint', 'Tool: Paint (B)'),
      tool('line', 'Tool: Line (L)'),
      tool('rect', 'Tool: Rectangle'),
      tool('rectFill', 'Tool: Filled rectangle'),
      tool('ellipse', 'Tool: Ellipse'),
      tool('ellipseFill', 'Tool: Filled ellipse'),
      tool('fill', 'Tool: Flood fill (G)'),
      tool('replace', 'Tool: Replace material'),
      tool('region', 'Tool: Region select (R)'),
      tool('smooth', 'Tool: Smooth terrain'),
      tool('roughen', 'Tool: Roughen terrain'),
      tool('link', 'Tool: Link trigger to door (K)'),
      tool('light', 'Tool: Place light'),
    ];
  }

  private openCmdk(): void {
    const box = this.el<HTMLDivElement>('builder-cmdk');
    box.style.display = '';
    const input = this.el<HTMLInputElement>('bp-cmdk-input');
    input.value = '';
    this.renderCmdk('');
    input.focus();
  }

  private closeCmdk(): void {
    this.el<HTMLDivElement>('builder-cmdk').style.display = 'none';
  }

  private renderCmdk(query: string): void {
    const list = this.el<HTMLDivElement>('bp-cmdk-list');
    const q = query.trim().toLowerCase();
    const hits = this.cmdkActions().filter((a) => a.label.toLowerCase().includes(q)).slice(0, 12);
    list.innerHTML = '';
    hits.forEach((a, n) => {
      const row = document.createElement('div');
      row.className = 'bp-cmdk-row' + (n === 0 ? ' first' : '');
      row.textContent = a.label;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault(); // beat the input blur
        this.closeCmdk();
        a.run();
      });
      list.appendChild(row);
    });
    if (hits.length === 0) {
      list.innerHTML = '<div class="bp-cmdk-row none">no matching command</div>';
    }
  }

  private wireCmdk(): void {
    const input = this.el<HTMLInputElement>('bp-cmdk-input');
    input.addEventListener('input', () => this.renderCmdk(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        this.closeCmdk();
        e.stopPropagation();
      } else if (e.code === 'Enter') {
        const q = input.value.trim().toLowerCase();
        const first = this.cmdkActions().find((a) => a.label.toLowerCase().includes(q));
        this.closeCmdk();
        first?.run();
      }
    });
    input.addEventListener('blur', () => this.closeCmdk());
  }

  /** Run validation and jump straight to the first issue with a location. */
  private findInvalid(): void {
    if (this.previewBlocks()) return;
    this.ensureCaptured();
    const issues = validateDocument(this.doc);
    this.renderIssues(issues);
    const target = issues.find((i) => i.objId);
    if (!target) {
      this.status(issues.length === 0 ? 'NOTHING INVALID — ALL CLEAN' : `${issues.length} ISSUE(S), NONE LOCATABLE`);
      return;
    }
    this.select(target.objId!);
    this.frameSelection();
    this.status(`[${target.severity.toUpperCase()}] ${target.what}`.slice(0, 90), target.severity === 'error');
  }

  /* ---------- playtest from here ---------- */

  private playtestHere(): void {
    if (this.previewBlocks()) return;
    // the wizard is 9x17 — refuse to spawn him inside terrain
    const w = this.ctx.world;
    const m = this.lastMouse;
    for (let dy = 0; dy < 17; dy += 4) {
      for (let dx = -4; dx <= 4; dx += 4) {
        const X = Math.floor(m.x) + dx,
          Y = Math.floor(m.y) - dy;
        if (w.inBounds(X, Y) && blocksEntity(w.types[w.idx(X, Y)])) {
          this.status('T NEEDS OPEN SPACE — THE CURSOR IS INSIDE TERRAIN', true);
          return;
        }
      }
    }
    this.ensureCaptured();
    const issues = validateDocument(this.doc);
    this.renderIssues(issues);
    if (issues.some((i) => i.severity === 'error')) {
      this.status('FIX ERRORS BEFORE PLAYTEST', true);
      return;
    }
    const at = { x: this.lastMouse.x, y: this.lastMouse.y };
    this.returningFromPlaytest = true;
    this.prevAmbient = this.ctx.params.global.ambient;
    this.close();
    compileAndPlaytest(this.ctx, this.doc, { spawnAt: at });
    (document.getElementById('mode-play-btn') as HTMLButtonElement | null)?.click();
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
      if (this.settling || this.settleSnap) {
        this.finishSettle(false);
        this.status('SETTLE CANCELLED');
      } else if (this.patrolEditId) {
        this.patrolEditId = null;
        this.renderInspector();
        this.status('PATROL EDITING DONE');
      } else if (this.polyPoints.length > 0) {
        this.polyPoints = [];
        this.status('POLYGON CANCELLED');
      } else if (this.linkFrom) {
        this.linkFrom = null;
        this.status('LINK CANCELLED');
      } else if (this.shapeDrag) {
        this.shapeDrag = null;
      } else if (this.marquee) {
        this.marquee = null;
      } else if (this.tool !== 'select') {
        this.setTool('select');
      } else if (this.region) {
        this.region = null;
        this.regionMask = null;
        this.status('REGION CLEARED');
        this.syncProcPanel();
      } else this.select(null);
    } else if (e.code === 'Enter' && this.polyPoints.length >= 3) {
      e.stopPropagation();
      this.closePolyRegion();
    } else if (e.code === 'KeyQ' && this.armedStamp) {
      e.stopPropagation();
      this.armedStamp = rotateStamp(this.armedStamp);
      this.status(`ROTATED — NOW ${this.armedStamp.w}×${this.armedStamp.h}`);
    } else if (e.code === 'KeyE' && this.armedStamp) {
      e.stopPropagation();
      this.armedStamp = mirrorStamp(this.armedStamp);
      this.status('MIRRORED');
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
      e.preventDefault();
      e.stopPropagation();
      this.duplicateSelection();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyG') {
      e.preventDefault();
      e.stopPropagation();
      this.groupSelection(e.shiftKey);
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
      e.preventDefault();
      e.stopPropagation();
      this.openCmdk();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
      e.stopPropagation();
      this.copyParams();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
      e.stopPropagation();
      this.pasteParams();
    } else if (e.code === 'KeyO') {
      e.stopPropagation();
      this.cycleOverlay();
    } else if (e.code === 'KeyT') {
      e.stopPropagation();
      this.playtestHere();
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
    } else if (e.code === 'KeyF') {
      e.stopPropagation();
      this.frameSelection();
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

  private matRowText = '';

  private loop = (): void => {
    if (!this.isOpen) return;
    this.rafId = requestAnimationFrame(this.loop);
    const rect = this.overlay.getBoundingClientRect();
    if (rect.width === 0) return;

    // active material + brush readout (the tools depend on Sandbox state)
    const state = this.ctx.state;
    const matName =
      state.activeInputMode === 'spell'
        ? 'SPELL (pick a material!)'
        : (this.ctx.params.materials[state.currentElement]?.name ?? 'material ' + state.currentElement);
    const text = `MAT ${matName.toUpperCase()} · BRUSH ${state.brushSize} · ZOOM ${this.ctx.camera.zoom.toFixed(1)}x`;
    if (text !== this.matRowText) {
      this.matRowText = text;
      this.el<HTMLDivElement>('bp-mat-row').textContent = text;
      // brush size can also change via [ ] in the sandbox layer — mirror it
      this.el<HTMLInputElement>('bp-brush').value = String(state.brushSize);
      this.el('bp-brush-val').textContent = String(state.brushSize);
      // material may have changed via eyedrop/sandbox — mirror the swatch
      for (const sw of this.root.querySelectorAll<HTMLButtonElement>('.bp-swatch')) {
        sw.classList.toggle(
          'active',
          state.activeInputMode === 'element' && Number(sw.dataset.el) === state.currentElement,
        );
      }
    }

    // settle preview clock: re-freeze the world when the run completes
    if (this.settling && state.frameCount >= this.settleEndFrame) {
      this.settling = false;
      state.paused = true;
      this.status('SETTLED — KEEP OR REVERT');
      this.syncSettleButtons();
    }

    // live light preview: authored lights feed the real light field
    // (solo narrows the feed to one light for isolation work)
    state.editorLights =
      this.lightPreviewOn && this.doc.lights.length > 0
        ? this.doc.lights
            .filter((l) => !l.hidden && (this.soloLightId === null || l.id === this.soloLightId))
            .map((l, n) => toAuthoredLight(l, n))
        : null;

    if (state.frameCount % 12 === 0) this.drawMinimap();

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

    // readability overlays (under everything else)
    if (this.overlayMode !== 'none') {
      const blob = (wx: number, wy: number, r: number, color: string): void => {
        const c = toS(wx, wy);
        const grad = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(4, r * cellW));
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(c.x, c.y, Math.max(4, r * cellW), 0, Math.PI * 2);
        g.fill();
      };
      if (this.overlayMode === 'light') {
        for (const l of this.doc.lights) {
          if (!l.hidden) blob(l.x, l.y, l.radius, l.color + '40');
        }
      } else if (this.overlayMode === 'danger') {
        for (const o of this.doc.objects) {
          if (o.kind === 'enemy' && !o.hidden) blob(o.x, o.y, 60, 'rgba(248,113,113,0.22)');
          if (o.kind === 'bossMarker' && !o.hidden) blob(o.x, o.y, 90, 'rgba(248,113,113,0.3)');
        }
      } else if (this.overlayMode === 'loot') {
        for (const o of this.doc.objects) {
          if (o.kind === 'pickup' && !o.hidden) blob(o.x, o.y, 26, 'rgba(251,191,36,0.28)');
        }
      }
      g.fillStyle = 'rgba(125,211,252,0.9)';
      g.font = '700 10px monospace';
      g.fillText('OVERLAY: ' + this.overlayMode.toUpperCase() + ' (O CYCLES)', 12, 16);
    }

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
      if (!this.layerVisibleObj(o)) continue;
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
    if (this.layerHidden.has('links')) {
      // links layer hidden: skip the wires entirely
    } else
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
    if (!this.layerHidden.has('lights')) {
      for (const l of this.doc.lights) {
        const c = toS(l.x, l.y);
        const sel = l.id === this.selectedId;
        const solo = this.soloLightId === l.id;
        g.strokeStyle = sel || solo ? l.color : l.color + '55';
        g.lineWidth = sel || solo ? 2 : 1;
        g.beginPath();
        g.ellipse(c.x, c.y, l.radius * cellW, l.radius * cellH, 0, 0, Math.PI * 2);
        g.stroke();
        if (solo) {
          g.fillStyle = l.color;
          g.font = '700 9px monospace';
          g.fillText('SOLO', c.x + 6, c.y - 6);
        }
      }
    }

    // patrol paths (enemy waypoint loops) + designer notes
    for (const o of this.doc.objects) {
      if (!this.layerVisibleObj(o)) continue;
      if (o.kind === 'enemy' && Array.isArray(o.params.patrol) && (o.params.patrol as unknown[]).length > 0) {
        const pts = o.params.patrol as Array<[number, number]>;
        g.strokeStyle = this.patrolEditId === o.id ? 'rgba(248,113,113,0.95)' : 'rgba(248,113,113,0.45)';
        g.lineWidth = 1;
        g.setLineDash([3, 3]);
        g.beginPath();
        const start = toS(o.x, o.y);
        g.moveTo(start.x, start.y);
        for (const [px, py] of pts) {
          const p = toS(px, py);
          g.lineTo(p.x, p.y);
        }
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(248,113,113,0.85)';
        pts.forEach(([px, py], n) => {
          const p = toS(px, py);
          g.fillRect(p.x - 2, p.y - 2, 4, 4);
          g.font = '700 8px monospace';
          g.fillText(String(n + 1), p.x + 4, p.y - 3);
        });
      } else if (o.kind === 'decor') {
        const p = toS(o.x, o.y);
        g.fillStyle = 'rgba(214,230,245,0.85)';
        g.font = '600 9px monospace';
        g.fillText(String(o.params.text ?? 'note').slice(0, 40), p.x + 10, p.y + 3);
      }
    }

    // polygon region in progress
    if (this.polyPoints.length > 0) {
      g.strokeStyle = 'rgba(125,211,252,0.9)';
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      g.beginPath();
      const p0 = toS(this.polyPoints[0][0], this.polyPoints[0][1]);
      g.moveTo(p0.x, p0.y);
      for (const [px, py] of this.polyPoints.slice(1)) {
        const p = toS(px, py);
        g.lineTo(p.x, p.y);
      }
      const m = toS(this.lastMouse.x, this.lastMouse.y);
      g.lineTo(m.x, m.y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(125,211,252,0.95)';
      g.fillRect(p0.x - 3, p0.y - 3, 6, 6); // close target
    }
    if (this.region && this.regionMask) {
      const a = toS(this.region.x0, this.region.y0);
      g.fillStyle = 'rgba(125,211,252,0.9)';
      g.font = '700 9px monospace';
      g.fillText('MASKED REGION', a.x + 2, a.y - 4);
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

    // marquee select box
    if (this.marquee) {
      const a = toS(Math.min(this.marquee.x0, this.marquee.x1), Math.min(this.marquee.y0, this.marquee.y1));
      const b = toS(Math.max(this.marquee.x0, this.marquee.x1) + 1, Math.max(this.marquee.y0, this.marquee.y1) + 1);
      g.setLineDash([4, 3]);
      g.strokeStyle = 'rgba(214,230,245,0.9)';
      g.lineWidth = 1;
      g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      g.setLineDash([]);
    }

    // armed stamp ghost at the cursor
    if (this.tool === 'stamp' && this.armedStamp) {
      const s = this.armedStamp;
      const a = toS(this.lastMouse.x - Math.floor(s.w / 2), this.lastMouse.y - Math.floor(s.h / 2));
      g.setLineDash([5, 3]);
      g.strokeStyle = 'rgba(240,171,252,0.9)';
      g.lineWidth = 1.5;
      g.strokeRect(a.x, a.y, s.w * cellW, s.h * cellH);
      g.setLineDash([]);
      g.fillStyle = 'rgba(240,171,252,0.8)';
      g.font = '700 10px monospace';
      g.fillText(s.name + ' (Q/E)', a.x + 2, a.y - 4);
    }

    // pending procedural preview badge
    if (this.pendingPreview) {
      g.fillStyle = 'rgba(251,191,36,0.95)';
      g.font = '700 11px monospace';
      g.fillText('PROCEDURAL PREVIEW — APPLY OR DISCARD', 12, ch - 12);
    }
    if (this.settling) {
      g.fillStyle = 'rgba(125,211,252,0.95)';
      g.font = '700 11px monospace';
      g.fillText('SETTLING… (ESC CANCELS)', 12, ch - 12);
    }
  }

  /** True-color world overview + camera box + object dots; click jumps. */
  private drawMinimap(): void {
    const mmW = this.minimap.width,
      mmH = this.minimap.height;
    const mm = this.minimapCtx;
    const w = this.ctx.world;
    if (!this.minimapImage) this.minimapImage = mm.createImageData(mmW, mmH);
    const data = this.minimapImage.data;
    for (let y = 0; y < mmH; y++) {
      const wy = Math.min(HEIGHT - 1, y * 8 + 4);
      for (let x = 0; x < mmW; x++) {
        const wi = x * 8 + 4 + wy * WIDTH;
        const o = (x + y * mmW) * 4;
        if (w.types[wi] === 0) {
          data[o] = 10;
          data[o + 1] = 12;
          data[o + 2] = 17;
        } else {
          const c = w.colors[wi];
          data[o] = (c >> 16) & 255;
          data[o + 1] = (c >> 8) & 255;
          data[o + 2] = c & 255;
        }
        data[o + 3] = 255;
      }
    }
    mm.putImageData(this.minimapImage, 0, 0);
    // object + light dots
    for (const o of this.doc.objects) {
      mm.fillStyle = o.kind === 'spawn' ? '#4ade80' : '#fcd34d';
      mm.fillRect(o.x / 8 - 1, o.y / 8 - 1, 2, 2);
    }
    for (const l of this.doc.lights) {
      mm.fillStyle = l.color;
      mm.fillRect(l.x / 8 - 1, l.y / 8 - 1, 2, 2);
    }
    // camera box (zoom crops around the view center)
    const cam = this.ctx.camera;
    const vw = VIEW_W / cam.zoom,
      vh = VIEW_H / cam.zoom;
    const vx = cam.renderX + (VIEW_W - vw) / 2,
      vy = cam.renderY + (VIEW_H - vh) / 2;
    mm.strokeStyle = 'rgba(74,222,128,0.95)';
    mm.lineWidth = 1;
    mm.strokeRect(vx / 8, vy / 8, vw / 8, vh / 8);
  }

  /** Rebuild the marker DOM from the document (object/light set changed). */
  private syncMarkers(): void {
    this.markerLayer.innerHTML = '';
    this.markers.clear();
    for (const o of this.doc.objects) {
      if (!this.layerVisibleObj(o)) continue;
      const m = document.createElement('div');
      m.className = `b-marker k-${o.kind}`
        + (this.selectedIds.has(o.id) ? ' sel' : '')
        + (o.hidden ? ' ghost' : '');
      m.textContent = GLYPH[o.kind] ?? '?';
      m.title = o.kind === 'decor' ? String(o.params.text ?? 'note') : o.kind;
      this.markers.set(o.id, m);
      this.markerLayer.appendChild(m);
    }
    if (!this.layerHidden.has('lights')) {
      for (const l of this.doc.lights) {
        const m = document.createElement('div');
        m.className = 'b-marker k-light' + (this.selectedIds.has(l.id) ? ' sel' : '') + (l.hidden ? ' ghost' : '');
        m.textContent = '*';
        m.title = 'light';
        this.markers.set(l.id, m);
        this.markerLayer.appendChild(m);
      }
    }
  }

  /* ===================== inspector ===================== */

  private renderInspector(): void {
    const panel = this.el<HTMLDivElement>('builder-inspector');
    if (this.selectedIds.size > 1) {
      const byKind = new Map<string, number>();
      for (const o of this.doc.objects) {
        if (this.selectedIds.has(o.id)) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
      }
      let lightCount = 0;
      for (const l of this.doc.lights) if (this.selectedIds.has(l.id)) lightCount++;
      if (lightCount > 0) byKind.set('light', lightCount);
      panel.innerHTML = `<div class="bi-head">${this.selectedIds.size} SELECTED</div>
        ${[...byKind.entries()]
          .map(([k, n]) => `<div class="bi-row"><span>${k}</span><b>${n}</b></div>`)
          .join('')}
        <div class="bp-grid bp-grid2" style="margin-top:4px">
          <button data-align="x" title="Align to the primary's column">ALIGN X</button>
          <button data-align="y" title="Align to the primary's row">ALIGN Y</button>
          <button data-align="spreadX" title="Distribute evenly between the leftmost and rightmost">SPREAD H</button>
          <button data-align="spreadY" title="Distribute evenly between the topmost and bottommost">SPREAD V</button>
        </div>
        <div class="bi-empty">Drag moves the group.<br>Ctrl+D duplicates &middot; Ctrl+G<br>groups (Shift+G dissolves).<br>Ctrl+C/V copies/pastes the<br>primary's params.</div>
        <button id="bi-delete">DELETE ALL (DEL)</button>`;
      for (const b of panel.querySelectorAll<HTMLButtonElement>('button[data-align]')) {
        b.addEventListener('click', () => this.alignSelection(b.dataset.align as 'x' | 'y' | 'spreadX' | 'spreadY'));
      }
      panel.querySelector('#bi-delete')?.addEventListener('click', () => this.deleteSelection());
      return;
    }
    const light = this.selectedLight();
    if (light) {
      this.renderLightInspector(panel, light);
      return;
    }
    const obj = this.selected();
    if (!obj) {
      const mood = (this.doc.mood ??= { ambient: null, ambience: '' });
      panel.innerHTML = `<div class="bi-head">INSPECTOR</div>
        <div class="bi-empty">Nothing selected.<br>Click a marker, or pick a<br>tool and click the canvas.<br>Ctrl+K = command palette.</div>
        <div class="bi-row"><span>objects</span><b>${this.doc.objects.length}</b></div>
        <div class="bi-row"><span>links</span><b>${this.doc.links.length}</b></div>
        <div class="bi-row"><span>lights</span><b>${this.doc.lights.length}</b></div>
        <div class="bi-row"><span>passes</span><b>${this.doc.proceduralHistory.length}</b></div>
        <div class="bi-row"><span>terrain</span><b>${this.doc.world ? 'captured' : '—'}</b></div>
        <div class="bi-row"><span>undo depth</span><b>${this.cmds.depth}</b></div>
        <div class="bi-head" style="margin-top:6px">DOCUMENT MOOD</div>
        <div class="bi-row"><span>ambient</span><input type="number" step="0.02" min="0.02" max="0.6" id="bi-mood-ambient" placeholder="default" value="${
          mood.ambient ?? ''
        }"></div>
        <div class="bi-row"><span>ambience</span><input type="text" id="bi-mood-ambience" placeholder="tag (e.g. drips)" value="${mood.ambience ?? ''}"></div>
        <div class="bi-empty">Ambient overrides the global<br>light level in playtests<br>(restored on return).</div>`;
      panel.querySelector<HTMLInputElement>('#bi-mood-ambient')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        mood.ambient = v === '' ? null : Number(v);
        if (mood.ambient !== null && !Number.isFinite(mood.ambient)) mood.ambient = null;
        this.status(mood.ambient === null ? 'MOOD AMBIENT: GAME DEFAULT' : `MOOD AMBIENT: ${mood.ambient}`);
      });
      panel.querySelector<HTMLInputElement>('#bi-mood-ambience')?.addEventListener('change', (e) => {
        mood.ambience = (e.target as HTMLInputElement).value;
      });
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
      if (obj.params.kind === 'slime' || obj.params.kind === 'acidslime' || obj.params.kind === 'golem') {
        const n = Array.isArray(obj.params.patrol) ? (obj.params.patrol as unknown[]).length : 0;
        rows +=
          this.patrolEditId === obj.id
            ? `<button id="bi-patrol" class="bi-armed">PATROL: CLICK POINTS — ESC ENDS</button>`
            : `<button id="bi-patrol">${n > 0 ? `EDIT PATROL (${n} PTS)` : 'ADD PATROL ROUTE'}</button>`;
        if (n > 0) rows += `<button id="bi-patrol-clear">CLEAR PATROL</button>`;
      }
    } else if (obj.kind === 'hazardEmitter') {
      const cells = ['water', 'oil', 'acid', 'lava', 'fire', 'ember', 'sand', 'snow', 'smoke'];
      rows += `<div class="bi-row"><span>material</span><select data-p="cell">${cells
        .map((c) => `<option value="${c}"${obj.params.cell === c ? ' selected' : ''}>${c}</option>`)
        .join('')}</select></div>`;
      rows += this.numRow(obj, 'rate', 'rate (frames)', 30);
      rows += `<div class="bi-empty">Drips one real cell every<br>"rate" frames — the grid<br>does the rest.</div>`;
    } else if (obj.kind === 'decor') {
      rows += `<div class="bi-row"><span>note</span><input type="text" data-p="text" value="${String(
        obj.params.text ?? '',
      ).replace(/"/g, '&quot;')}"></div>`;
      rows += `<div class="bi-empty">Designer annotation only —<br>never compiles into the level.</div>`;
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
      const lg = typeof obj.params.logic === 'string' ? obj.params.logic : 'and';
      rows += `<div class="bi-row"><span>logic</span><select data-p="logic">${(
        ['and', 'or', 'sequence'] as const
      )
        .map((v) => `<option value="${v}"${lg === v ? ' selected' : ''}>${v.toUpperCase()}</option>`)
        .join('')}</select></div>`;
      rows += `<button id="bi-rotate" title="Swap width and height">ROTATE 90&deg;</button>`;
      rows += this.linkRows(obj, 'in');
    } else if (obj.kind === 'runeDoor') {
      rows += this.numRow(obj, 'w', 'width', 2) + this.numRow(obj, 'h', 'height', 11);
      rows += `<button id="bi-rotate" title="Swap width and height">ROTATE 90&deg;</button>`;
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
        this.syncMarkers(); // glyphs/tooltips can depend on params (kind, note text)
      });
    }
    for (const flag of panel.querySelectorAll<HTMLInputElement>('input[data-f="locked"],input[data-f="hidden"]')) {
      flag.addEventListener('change', () => {
        this.cmds.run(setObjectFlagCmd(obj, flag.dataset.f as 'locked' | 'hidden', flag.checked));
        this.syncMarkers();
      });
    }
    panel.querySelector('#bi-patrol')?.addEventListener('click', () => {
      if (this.patrolEditId === obj.id) {
        this.patrolEditId = null;
        this.status('PATROL EDITING DONE');
      } else {
        this.patrolEditId = obj.id;
        this.status('PATROL: CLICK WAYPOINTS ON THE CANVAS — ESC ENDS');
      }
      this.renderInspector();
    });
    panel.querySelector('#bi-patrol-clear')?.addEventListener('click', () => {
      this.cmds.run(editParamCmd(obj, 'patrol', undefined));
      this.patrolEditId = null;
      this.renderInspector();
      this.status('PATROL CLEARED');
    });
    panel.querySelector('#bi-rotate')?.addEventListener('click', () => {
      const dw = obj.kind === 'door' ? 3 : 2;
      const dh = obj.kind === 'door' ? 13 : 11;
      const w = paramNum(obj, 'w', dw);
      const h = paramNum(obj, 'h', dh);
      this.cmds.run(
        compositeCmd('rotate ' + obj.kind, [editParamCmd(obj, 'w', h), editParamCmd(obj, 'h', w)]),
      );
      this.renderInspector();
      this.status('ROTATED — NOW ' + h + '×' + w);
    });
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

  /** Wiring summary rows: who drives me / what do I drive, with unlink
   *  buttons. Sequence doors number their steps in firing (link) order. */
  private linkRows(obj: EditorObject, dir: 'in' | 'out'): string {
    const links = this.doc.links.filter((l) =>
      dir === 'in' ? l.toId === obj.id : l.fromId === obj.id,
    );
    if (links.length === 0) {
      return `<div class="bi-row"><span>${dir === 'in' ? 'triggers' : 'drives'}</span><b class="bi-warn">unlinked (K)</b></div>`;
    }
    const numbered = dir === 'in' && obj.kind === 'door' && obj.params.logic === 'sequence';
    return links
      .map((l, n) => {
        const otherId = dir === 'in' ? l.fromId : l.toId;
        const other = this.doc.objects.find((o) => o.id === otherId);
        const prefix = numbered ? `${n + 1}. ` : dir === 'in' ? '← ' : '→ ';
        return `<div class="bi-row"><span>${prefix}${
          other?.kind ?? '?'
        }</span><button data-unlink="${l.id}" title="Remove link">&times;</button></div>`;
      })
      .join('');
  }

  private renderLightInspector(panel: HTMLDivElement, light: EditorLight): void {
    panel.innerHTML = `<div class="bi-head">AUTHORED LIGHT</div>
      <div class="bi-id">${light.id}</div>
      <div class="bi-row"><span>preset</span><select data-preset>
        <option value="">&mdash;</option>
        ${Object.keys(LIGHT_PRESETS)
          .map((p) => `<option value="${p}">${p}</option>`)
          .join('')}
      </select></div>
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
      <button id="bi-solo"${this.soloLightId === light.id ? ' class="bi-armed"' : ''}>${
        this.soloLightId === light.id ? 'SOLO ON — CLICK TO HEAR ALL' : 'SOLO THIS LIGHT'
      }</button>
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
    panel.querySelector('#bi-solo')?.addEventListener('click', () => {
      this.soloLightId = this.soloLightId === light.id ? null : light.id;
      this.renderLightInspector(panel, light);
      this.status(this.soloLightId ? 'PREVIEWING ONLY THIS LIGHT' : 'PREVIEWING ALL LIGHTS');
    });
    panel.querySelector<HTMLSelectElement>('[data-preset]')?.addEventListener('change', (e) => {
      const preset = LIGHT_PRESETS[(e.target as HTMLSelectElement).value];
      if (!preset) return;
      this.cmds.run(editLightCmd(light, preset));
      this.renderLightInspector(panel, light); // reflect the new values
    });
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
        if (issue?.objId) {
          this.select(issue.objId);
          this.frameSelection(); // the world is ~9 screens; jump, don't hunt
        }
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

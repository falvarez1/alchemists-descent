import type { BiomeId, CardId, Ctx, LevelDef, PlayerState, WandFrame } from '@/core/types';
import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { BIOMES as BIOME_DEFS } from '@/config/biomes';
import { GEN, defaultSkeletonSpec } from '@/config/gen';
import type { SkeletonSpec } from '@/config/gen';
import { createDefaultPostFxSettings, createDefaultWandLightSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import { randomSeed } from '@/core/rng';
import {
  applyWorldLayer,
  bakeExclusionMask,
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
  editDocumentMoodCmd,
  editLightCmd,
  editParamCmd,
  moveLightCmd,
  moveObjectCmd,
  paintTerrainCmd,
  setObjectFlagCmd,
  setObjectGroupCmd,
  setObjectRotationCmd,
} from '@/builder/commands';
import type { CellPatch, Command } from '@/builder/commands';
import { rleEncode } from '@/core/rle';
import { drawLine, spawnCircle } from '@/sim/brush';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import { blocksEntity, Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { compileAndPlaytest, toAuthoredLight } from '@/builder/compile';
import { PreviewRuntime } from '@/builder/PreviewRuntime';
import {
  capturePrefab,
  decodePrefabCells,
  alignPrefabAnchorToWorldPoint,
  loadPrefabs,
  mirrorPrefab,
  pastePrefab,
  prefabAnchorsCompatible,
  prefabAnchorWorldPoint,
  prefabVariant,
  rotatePrefab,
  savePrefab,
} from '@/builder/prefablib';
import type { PrefabAnchor, PrefabDef, PrefabVariantId } from '@/builder/prefablib';
import { showImportReport } from '@/builder/prefabPanel';
import {
  clampBackdropBrightness,
  clampBackdropContrast,
  clampBackdropExposure,
  clampBackdropGamma,
  clampBackdropSaturation,
  sanitizeBackdropSettings,
} from '@/config/backdrop';
import { BackdropPreview } from '@/builder/backdropPreview';
import { Gallery } from '@/builder/gallery';
import { builtinPrefabs } from '@/world/prefabs/registry';
import { downloadJson, downloadText, download, pickFiles } from '@/builder/assets/io';
import { cellsToRgba, rgbaToCells, snapUnknown } from '@/builder/assets/pixmap';
import { pngBlobToRgba, rgbaToPngBlob } from '@/builder/assets/png';
import { buildAssetDatabase } from '@/builder/assets/AssetDatabase';
import type { AssetDatabase } from '@/builder/assets/AssetDatabase';
import { createBuiltInContentAssetRecords } from '@/builder/assets/ContentAssetProvider';
import { importJsonAsset, previewReimport } from '@/builder/assets/AssetImportPipeline';
import { LocalStorageAssetStore } from '@/builder/assets/AssetStore';
import type { AssetStoreExport } from '@/builder/assets/AssetStore';
import { paintAssetPreview, paintPrefabPreviewCanvas } from '@/builder/assets/AssetPreview';
import { stableAssetId } from '@/builder/assets/AssetTypes';
import type { AssetKind, AssetOrigin, AssetRecord, AssetSmartCollection, AssetSortMode } from '@/builder/assets/AssetTypes';
import { appDialog } from '@/ui/AppDialog';
import {
  decodeFramePx,
  parseAsepriteJson,
  resolveLoopTag,
  sliceSheet,
  sliceUniformGrid,
  spriteToSheet,
} from '@/builder/assets/sprites';
import type { SpriteAsset } from '@/builder/assets/sprites';
import {
  embedSprites,
  loadSprites,
  mergeEmbeddedSprites,
  saveSprite,
} from '@/builder/assets/spritelib';
import { paletteAsGpl } from '@/sim/cellPalette';
import { drawObjectPreview } from '@/builder/render/ObjectPreview';
import {
  BUILDER_OVERLAY_IDS,
  drawBuilderOverlays,
  overlayLabel,
  sanitizeOverlayVisibility,
} from '@/builder/render/OverlayRegistry';
import type { BuilderOverlayId } from '@/builder/render/OverlayRegistry';
import {
  buildValidationOverlayDiagnostics,
  playtestBlockingIssues,
  TRIGGER_KINDS,
  validateDocument,
} from '@/builder/validate';
import type { DocIssue, ValidationOverlayDiagnostics } from '@/builder/validate';
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
import {
  cancelFloating,
  commitFloating,
  floatPreview,
  liftSelection,
  mirrorFloating,
  rotateFloating,
} from '@/builder/selection';
import type { FloatingSelection } from '@/builder/selection';
import { mirrorPairs, mirrorPoints, symAxes, SYM_MODES } from '@/builder/symmetry';
import type { SymmetryMode } from '@/builder/symmetry';
import { PASSES, runPass } from '@/builder/procedural';
import { ELEMENT_ICON, makeIconCanvas } from '@/ui/icons';
import { paramSliderSpec } from '@/ui/Inspector';
import { fillMaterialPopover } from '@/ui/materialInfo';
import { CommandRegistry } from '@/ui/editor/CommandRegistry';
import { DockHost } from '@/ui/editor/DockHost';
import { FocusRouter } from '@/ui/editor/FocusRouter';
import { Keymap } from '@/ui/editor/Keymap';
import { MenuHost } from '@/ui/editor/MenuHost';
import { PopoverHost } from '@/ui/editor/PopoverHost';
import { renderInspectorItems } from '@/ui/editor/InspectorSchema';
import { builderPanelHeader, normalizePanelChromeHandles } from '@/ui/editor/PanelChrome';
import { builderPanelTitle, createBuilderPanelRegistry } from '@/ui/editor/PanelRegistry';
import type { CommandSpec } from '@/ui/editor/CommandRegistry';
import {
  documentInspectorSchema,
  EMITTER_DIR,
  LIGHT_PRESETS,
  lightInspectorSchema,
  multiSelectionInspectorSchema,
  objectInspectorSchema,
} from '@/builder/inspectorSchemas';
import {
  hitProjectedGizmoHandle,
  lightGizmoHandles,
  lightRadiusFromDrag,
  objectGizmoHandles,
  projectGizmoHandles,
  resizeObjectPatchFromDrag,
} from '@/builder/gizmos';
import type { GizmoHandle, ProjectedGizmoHandle } from '@/builder/gizmos';
import {
  drawCoordinateReadout,
  drawSnapGrid,
  measurementBetween,
  nextSnapStep,
  sanitizeSnapStep,
  snapValue,
} from '@/builder/spatialGuides';
import type { SnapStep } from '@/builder/spatialGuides';
import { renderValidationPanel } from '@/builder/validationPanel';
import {
  buildOutlinerModel,
  renderOutlinerPanel,
} from '@/builder/outlinerPanel';
import type { OutlinerFilter, OutlinerLayerState } from '@/builder/outlinerPanel';
import {
  buildLinkGraphModel,
  renderLinkGraphPanel,
} from '@/builder/linkGraphPanel';
import { VirtualWorldPanel } from '@/builder/virtualWorldPanel';
import { renderAssetBrowserPanel, renderAssetPlacementPanel } from '@/builder/assetBrowserPanel';
import type { AssetBrowserView } from '@/builder/assetBrowserPanel';
import { renderAssetDetailPanel } from '@/builder/assetDetailPanel';
import { renderPrefabDetailPanel } from '@/builder/prefabDetailPanel';
import {
  loadWorkspaceLayout,
  saveWorkspaceLayout,
  workspacePresetLayout,
} from '@/ui/editor/Workspace';
import type { DockRegion, WorkspaceLayout, WorkspacePreset } from '@/ui/editor/Workspace';

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

const DEV_CONSOLE_PANEL_ID = 'dev-console';
const DEV_CONSOLE_COMMAND_EVENT = 'dev-console-command';
const DEV_CONSOLE_STATE_EVENT = 'dev-console-state';
const CRAMPED_DOCK_RAIL_WIDTH = 42;
const MIN_BUILDER_CENTER_WIDTH = 260;
const PREFERRED_BUILDER_CENTER_WIDTH = 320;
const BUILDER_VIEWPORT_PAD = 20;
const BIOME_IDS = Object.keys(BIOME_DEFS) as BiomeId[];
const PLAYTEST_CURSOR_ALWAYS_STAMPED_BLOCKERS: ReadonlySet<EditorObjectKind> = new Set([
  'cauldron',
  'counterweight',
  'door',
  'exitWell',
  'plug',
  'valve',
] as EditorObjectKind[]);
const PLAYTEST_CURSOR_LINK_STAMPED_TRIGGERS: ReadonlySet<EditorObjectKind> = new Set([
  'brazier',
  'buoy',
  'chargeLatch',
  'plate',
  'scale',
] as EditorObjectKind[]);
const PLAYTEST_CURSOR_MECHANISM_TARGETS: ReadonlySet<EditorObjectKind> = new Set([
  'door',
  'valve',
  'relay',
  'sensor',
  'counterweight',
  'plug',
] as EditorObjectKind[]);
type BuilderWorkspacePanelId =
  | 'builder-outliner'
  | 'builder-link-graph'
  | 'builder-assets'
  | 'builder-asset-details'
  | 'builder-prefab-details'
  | 'builder-virtual-world';
type BuilderSidePanel = 'proc' | 'world' | 'mat' | 'post' | 'global';
const SKELETON_KINDS: Array<SkeletonSpec['kind']> = [
  'baseline',
  'fungalPockets',
  'frozenCrevasses',
  'floodedGalleries',
  'timberScaffold',
  'crystalVaults',
  'volcanicTubes',
];

interface PanelDropPoint {
  clientX: number;
  clientY: number;
}

interface PanelPointerDrag {
  id: string;
  pointerId: number;
  el: HTMLElement;
  startX: number;
  startY: number;
  active: boolean;
}

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
  // machine primitives (docs/MACHINE-PRIMITIVES-AND-STRUCTURES-PLAN.md)
  { kind: 'valve', label: 'Valve', glyph: 'V' },
  { kind: 'plug', label: 'Plug', glyph: '%' },
  { kind: 'sensor', label: 'Sensor', glyph: '?' },
  { kind: 'counterweight', label: 'Cweight', glyph: 'C' },
  { kind: 'relay', label: 'Relay', glyph: '&' },
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
  hazardEmitter: () => ({ cell: 'water', rate: 30, burst: 1, phase: 0 }),
  decor: () => ({ text: 'note', color: '#d6e6f5' }),
  valve: () => ({ w: 5, h: 2, material: 'metal', oneShot: false, autoClose: 0, logic: 'and' }),
  plug: () => ({ w: 3, h: 3, material: 'wood', breakFrac: 0.5 }),
  sensor: () => ({ type: 'heat', threshold: 6, zoneW: 9, zoneH: 7, latch: 'timed', latchFrames: 420, filter: '' }),
  counterweight: () => ({ w: 7, threshold: 30 }),
  relay: () => ({ delay: 0, action: 'activate', logic: 'and' }),
};

const BIOMES: BiomeId[] = [
  'earthen', 'frozen', 'flooded', 'timber', 'scorched', 'fungal', 'crystal', 'volcanic', 'gilded',
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
  | 'lassoRegion'
  | 'link'
  | 'light'
  | 'stamp'
  | EditorObjectKind;
type BuilderOpenIntent = 'continue-document' | 'current-scene';
interface BuilderWandSnapshot {
  active: 0 | 1;
  collection: CardId[];
  wands: Array<{
    frame: WandFrame;
    cards: (CardId | null)[];
    mana: number;
    cooldown: number;
    cooldownMax?: number;
    castIndex: number;
  }>;
}

/** Editor layer families (visibility/locking are EDITOR-side only:
 *  a hidden layer still compiles — that's what object `hidden` is for). */
type LayerFamily = 'gameplay' | 'mech' | 'links' | 'lights';
const LAYER_FAMILIES = ['gameplay', 'mech', 'links', 'lights'] as const satisfies readonly LayerFamily[];
const layerLabel = (family: LayerFamily): string =>
  family === 'mech' ? 'Mechanisms' : family[0].toUpperCase() + family.slice(1);
const MECH_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'door', 'plate', 'lever', 'brazier', 'scale', 'buoy', 'chargeLatch', 'runeGlyph', 'runeDoor',
  'valve', 'plug', 'sensor', 'counterweight', 'relay',
] as EditorObjectKind[]);
const familyOf = (o: EditorObject): LayerFamily => (MECH_KINDS.has(o.kind) ? 'mech' : 'gameplay');

const DRAFT_KEY = 'noita-builder-draft';
/** Settle previews bigger than this commit without undo (memory honesty). */
const SETTLE_UNDO_CAP = 400000;

/** Tiny procedural pixel previews for the palette popovers (28x28). */
type PreviewDraw = (g: CanvasRenderingContext2D) => void;
function previewCanvas(draw: PreviewDraw): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 28;
  c.height = 28;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0d12';
  g.fillRect(0, 0, 28, 28);
  draw(g);
  return c;
}
const px = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string): void => {
  g.fillStyle = col;
  g.fillRect(x, y, w, h);
};

/** What each placeable IS — a picture and the one rule that matters. */
const OBJECT_INFO: Partial<Record<EditorObjectKind | 'light', { desc: string; draw: PreviewDraw }>> = {
  spawn: {
    desc: 'Where the alchemist enters. Exactly one per level; needs 9×17 of open space.',
    draw: (g) => {
      px(g, 11, 3, 6, 3, '#6d28d9'); px(g, 9, 6, 10, 2, '#7c3aed'); // hat
      px(g, 11, 8, 6, 5, '#e8d5b5'); px(g, 12, 9, 1, 1, '#1a1a24'); px(g, 15, 9, 1, 1, '#1a1a24'); // face
      px(g, 10, 13, 8, 9, '#2741a3'); px(g, 10, 22, 3, 3, '#16161e'); px(g, 15, 22, 3, 3, '#16161e'); // robe+boots
    },
  },
  enemy: {
    desc: 'Exact foes at exact spots. Bats can roost; slimes/golems can walk patrol routes.',
    draw: (g) => {
      px(g, 7, 14, 14, 9, '#3f9e3f'); px(g, 9, 12, 10, 3, '#4ab54a');
      px(g, 10, 16, 2, 3, '#10240f'); px(g, 16, 16, 2, 3, '#10240f');
    },
  },
  pickup: {
    desc: 'Gold, hearts, tomes, chests, potions — and the golden key that opens the portal.',
    draw: (g) => {
      px(g, 8, 18, 12, 4, '#b8860b'); px(g, 10, 15, 8, 3, '#fbbf24'); px(g, 12, 12, 4, 3, '#ffe066');
    },
  },
  exitPortal: {
    desc: 'The win gate. Opens when the golden key arrives ("CUSTOM LEVEL CLEAR").',
    draw: (g) => {
      px(g, 9, 4, 10, 2, '#7c3aed'); px(g, 7, 6, 2, 16, '#7c3aed'); px(g, 19, 6, 2, 16, '#7c3aed');
      px(g, 9, 22, 10, 2, '#7c3aed'); px(g, 12, 10, 4, 8, '#c084fc');
    },
  },
  exitWell: {
    desc: 'A cased shaft sealed by 14 rows of stone. Digging or blasting the plug IS the lock.',
    draw: (g) => {
      px(g, 4, 4, 4, 20, '#5a6470'); px(g, 20, 4, 4, 20, '#5a6470'); // casing
      px(g, 8, 10, 12, 6, '#8a8a92'); // the plug
      px(g, 8, 16, 12, 8, '#05060a'); // the dark drop below
    },
  },
  waystone: {
    desc: 'Respawn anchor. Lights with REAL fire — bring a flame, get a checkpoint.',
    draw: (g) => {
      px(g, 10, 8, 8, 16, '#6b7280'); px(g, 8, 22, 12, 3, '#4b5563');
      px(g, 12, 4, 4, 4, '#ff9a3c'); px(g, 13, 2, 2, 2, '#ffd27a');
    },
  },
  cauldron: {
    desc: 'Brewing basin: real reagents in the bowl + real fire against it = an elixir.',
    draw: (g) => {
      px(g, 6, 20, 16, 3, '#6b7280'); px(g, 5, 13, 3, 8, '#6b7280'); px(g, 20, 13, 3, 8, '#6b7280');
      px(g, 8, 16, 12, 4, '#3cc86e');
    },
  },
  bossMarker: {
    desc: 'The Kiln Colossus spawns here. Water is the strategy.',
    draw: (g) => {
      px(g, 8, 6, 12, 12, '#b91c1c'); px(g, 10, 10, 3, 4, '#1a0505'); px(g, 15, 10, 3, 4, '#1a0505');
      px(g, 10, 18, 8, 4, '#7f1d1d');
    },
  },
  hazardEmitter: {
    desc: 'Drips ONE real cell every `rate` frames — lava pools, acid eats, water floods.',
    draw: (g) => {
      px(g, 10, 3, 8, 5, '#374151'); px(g, 12, 8, 4, 2, '#4b5563');
      px(g, 13, 13, 2, 3, '#3a7bd5'); px(g, 13, 19, 2, 3, '#3a7bd5');
    },
  },
  decor: {
    desc: 'A designer note pinned to the world. Never compiles — annotation only.',
    draw: (g) => {
      px(g, 7, 5, 14, 18, '#d6cfa8'); px(g, 9, 9, 10, 1, '#6b6450'); px(g, 9, 13, 10, 1, '#6b6450');
      px(g, 9, 17, 6, 1, '#6b6450');
    },
  },
  door: {
    desc: 'A real metal gate. Opens when its linked triggers say so — logic AND / OR / SEQUENCE.',
    draw: (g) => {
      px(g, 11, 2, 6, 24, '#606c8e'); px(g, 12, 5, 1, 1, '#9aa8d0'); px(g, 14, 9, 1, 1, '#9aa8d0');
      px(g, 13, 14, 1, 1, '#9aa8d0'); px(g, 12, 19, 1, 1, '#9aa8d0');
    },
  },
  plate: {
    desc: 'A brass pressure sill — weighs real cells AND bodies. Link it to a door (K).',
    draw: (g) => {
      px(g, 6, 18, 16, 3, '#948446'); px(g, 10, 12, 8, 5, '#3f3f46');
    },
  },
  lever: {
    desc: 'Hand-pulled (E) or flipped by concussion. Needs footing or it shakes loose.',
    draw: (g) => {
      px(g, 8, 21, 12, 3, '#374151'); px(g, 13, 17, 2, 4, '#4b5563');
      px(g, 14, 9, 2, 2, '#fcd34d'); px(g, 14, 11, 2, 2, '#d9a93c'); px(g, 13, 13, 2, 2, '#b8862b'); px(g, 13, 15, 2, 2, '#96691f');
    },
  },
  brazier: {
    desc: 'Latches forever when REAL fire reaches the bowl. The flame keeps itself lit.',
    draw: (g) => {
      px(g, 8, 18, 12, 3, '#6b7280'); px(g, 7, 15, 2, 3, '#6b7280'); px(g, 19, 15, 2, 3, '#6b7280');
      px(g, 11, 10, 6, 6, '#e65c00'); px(g, 13, 6, 3, 5, '#ffb347'); px(g, 14, 4, 1, 2, '#ffe066');
    },
  },
  scale: {
    desc: 'A sand scale: wants poured material WEIGHT in its pan (bodies do not count).',
    draw: (g) => {
      px(g, 6, 18, 16, 2, '#a88e40'); px(g, 4, 12, 2, 8, '#948446'); px(g, 22, 12, 2, 8, '#948446');
      px(g, 9, 13, 10, 5, '#d4af37');
    },
  },
  buoy: {
    desc: 'A sluice float: rises when enough liquid pools in its basin.',
    draw: (g) => {
      px(g, 5, 20, 18, 3, '#6b7280'); px(g, 4, 12, 2, 9, '#6b7280'); px(g, 22, 12, 2, 9, '#6b7280');
      px(g, 6, 15, 16, 5, '#2d6fc4'); px(g, 12, 12, 4, 3, '#e8d5b5');
    },
  },
  chargeLatch: {
    desc: 'A coil that latches FOREVER on the first spark — lightning, charged water, anything.',
    draw: (g) => {
      px(g, 8, 20, 12, 3, '#68748a'); px(g, 13, 16, 2, 4, '#4b5563');
      px(g, 15, 4, 2, 4, '#7dd3fc'); px(g, 12, 8, 3, 3, '#7dd3fc'); px(g, 15, 11, 2, 4, '#38bdf8');
    },
  },
  runeGlyph: {
    desc: 'Strike it — blast, bolt, dig beam — and its linked rune door dissolves.',
    draw: (g) => {
      px(g, 12, 6, 4, 4, '#86efac'); px(g, 9, 10, 10, 6, '#22c55e'); px(g, 12, 16, 4, 4, '#86efac');
      px(g, 13, 11, 2, 3, '#dcfce7');
    },
  },
  runeDoor: {
    desc: 'A stone slab keyed to a distant glyph. Dissolves bottom-up when the rune is struck.',
    draw: (g) => {
      px(g, 10, 2, 8, 24, '#6e7d6e'); px(g, 12, 6, 4, 2, '#86efac'); px(g, 13, 13, 2, 2, '#86efac');
      px(g, 11, 20, 3, 2, '#86efac');
    },
  },
  valve: {
    desc: 'A small material gate in a channel (a sluice is a wide valve). Opens like a door; one-shot and timed auto-close are options.',
    draw: (g) => {
      px(g, 4, 12, 20, 4, '#5eead4'); px(g, 11, 8, 6, 12, '#374151'); px(g, 13, 4, 2, 6, '#9ca3af');
    },
  },
  plug: {
    desc: 'Real cells that FIRE a signal once destroyed — by anything. The material is the break profile (wood burns, glass shatters...).',
    draw: (g) => {
      px(g, 8, 8, 12, 12, '#8a5a2b'); px(g, 10, 10, 3, 3, '#a9743c'); px(g, 15, 14, 3, 3, '#6e4517');
      px(g, 18, 6, 3, 3, '#ff7b3c');
    },
  },
  sensor: {
    desc: 'Reads a bounded zone: heat, liquid, weight, charge, or an exact material. Latch: momentary / timed / permanent.',
    draw: (g) => {
      px(g, 6, 6, 16, 10, 'rgba(94,234,212,0.25)'); px(g, 12, 18, 4, 4, '#0f766e');
      px(g, 13, 19, 2, 2, '#5eead4');
    },
  },
  counterweight: {
    desc: 'An iron pan that latches PERMANENTLY once enough material mass stays poured into it.',
    draw: (g) => {
      px(g, 6, 16, 16, 3, '#605848'); px(g, 4, 8, 2, 11, '#4a4438'); px(g, 22, 8, 2, 11, '#4a4438');
      px(g, 9, 11, 10, 5, '#caa64a');
    },
  },
  relay: {
    desc: 'One-shot handoff: inputs satisfied, wait, FIRE once. On fire: activate its target, ignite, break a plug, or strike.',
    draw: (g) => {
      px(g, 11, 11, 6, 6, '#7c6df2'); px(g, 13, 7, 2, 4, '#a78bfa'); px(g, 13, 17, 2, 4, '#a78bfa');
      px(g, 7, 13, 4, 2, '#a78bfa'); px(g, 17, 13, 4, 2, '#a78bfa'); px(g, 13, 13, 2, 2, '#ddd6fe');
    },
  },
  light: {
    desc: 'A designer light: color, radius, flicker, falloff; occluded lights cast real shadows.',
    draw: (g) => {
      px(g, 10, 10, 8, 8, '#ffdf9e'); px(g, 7, 7, 14, 14, 'rgba(255,200,110,0.25)');
      px(g, 4, 4, 20, 20, 'rgba(255,200,110,0.12)'); px(g, 13, 13, 2, 2, '#fff7df');
    },
  },
};

/** One line per tool — what it does and how to drive it. */
const TOOL_INFO: Partial<Record<string, { name: string; desc: string }>> = {
  select: { name: 'Select / Move (V)', desc: 'Click selects (grouped objects select together), shift-click adds, dragging empty space marquees, dragging a selection moves it.' },
  paint: { name: 'Paint (B)', desc: 'Freehand brush with the armed material at the brush radius. RMB anywhere eyedrops.' },
  line: { name: 'Line (L)', desc: 'Drag a straight stroke at the brush radius.' },
  rect: { name: 'Rectangle', desc: 'Drag a 1-cell rectangle outline.' },
  rectFill: { name: 'Filled Rectangle', desc: 'Drag a solid rectangle of the armed material.' },
  ellipse: { name: 'Ellipse', desc: 'Drag an ellipse outline inscribed in the box.' },
  ellipseFill: { name: 'Filled Ellipse', desc: 'Drag a solid ellipse of the armed material.' },
  fill: { name: 'Flood Fill (G)', desc: 'Fill the connected same-material area under the click. Refuses oversized areas atomically.' },
  replace: { name: 'Replace Material', desc: 'Swap EVERY cell of the clicked material for the armed one (bounded by the region when one is set).' },
  smooth: { name: 'Smooth', desc: 'Majority-rule smoothing under the brush — lone spurs erode, pits and notches fill.' },
  roughen: { name: 'Roughen', desc: 'Jitters the rock/air boundary so hand-carved walls stop looking like CAD.' },
  region: { name: 'Region (R)', desc: 'Drag a rectangle: passes, replace, and bake operate inside it. ESC clears.' },
  polyRegion: { name: 'Polygon Region', desc: 'Click vertices; Enter (or clicking near the first vertex) closes the polygon.' },
  regionMagic: { name: 'Magic Region', desc: 'Click an open area to select that whole connected cavern as the region.' },
  lassoRegion: { name: 'Lasso Region', desc: 'Drag a freehand loop; releasing closes it into a masked region. X then lifts it as a floating selection.' },
  link: { name: 'Link (K)', desc: 'Click a trigger (or rune glyph), then its target — door, valve, or relay (relays can also detonate plugs). Several triggers on ONE target = AND gate.' },
};

interface PendingPassPreview {
  kind: 'pass';
  before: CellPatch;
  after: CellPatch;
  passId: string;
  seed: number;
  density: number;
  material: number;
  region: Region;
  summary: string;
}

interface PendingRepairPreview {
  kind: 'repair';
  before: CellPatch;
  after: CellPatch;
  label: string;
  summary: string;
}

type PendingPreview = PendingPassPreview | PendingRepairPreview;

interface GizmoDragState {
  handle: GizmoHandle;
  target: EditorObject | EditorLight;
  isLight: boolean;
  origX: number;
  origY: number;
  origRotation?: EditorObject['rotation'];
  origParams?: Record<string, unknown>;
  origLight?: Pick<EditorLight, 'radius' | 'falloff'>;
  moved: boolean;
}

interface PlacedPrefabAnchor {
  id: string;
  prefabId: string;
  anchor: PrefabAnchor;
  x: number;
  y: number;
  region: Region;
  terrainHash: number;
}

type PrefabDetailFocusTarget =
  | { kind: 'close' }
  | { kind: 'variant'; id: string }
  | { kind: 'anchor'; id: string }
  | { kind: 'action'; id: string };

type AssetBrowserFocusTarget =
  | { kind: 'row'; assetId: string }
  | { kind: 'checkbox'; assetId: string }
  | { kind: 'select-visible' }
  | { kind: 'batch-export' }
  | { kind: 'batch-delete' }
  | { kind: 'batch-clear' };
type PlacementPaletteFocusTarget = { palette: 'prefab' | 'sprite'; assetId: string };

export class Builder {
  private doc: EditorDocument;
  private readonly cmds = new CommandStack(() => this.doc, (cmd) => this.markDocumentChanged(cmd));
  private readonly uiCommands = new CommandRegistry();
  private readonly keymap = new Keymap(this.uiCommands);
  private readonly focusRouter = new FocusRouter();
  private readonly menus = new MenuHost();
  private readonly popovers = new PopoverHost();
  private readonly panelRegistry = createBuilderPanelRegistry();
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
  /** Lasso-region tool: freehand points collected while the button is down. */
  private lassoPoints: Array<[number, number]> | null = null;
  /** Masked-region cell count (cached for the proc panel's target label). */
  private regionMaskCells = 0;
  /** Floating cell selection (modal: gates every world/document mutation). */
  private floating: FloatingSelection | null = null;
  /** Scaled-canvas cache of the float preview (rebuilt on transform). */
  private floatCanvas: HTMLCanvasElement | null = null;
  private floatDrag: { grabX: number; grabY: number; origX: number; origY: number } | null = null;
  /** Symmetry painting mode (axis = world center, recentered by region). */
  private symmetry: SymmetryMode = 'off';
  /** Patrol waypoint being dragged in the select tool (live preview;
   *  rewound and landed as one editParamCmd on mouseup). */
  private waypointDrag: {
    obj: EditorObject;
    index: number;
    orig: Array<[number, number]>;
  } | null = null;
  /** Editor-side light mutes: excluded from the live preview feed, still
   *  compile (SOLO's quieter sibling). */
  private mutedLightIds = new Set<string>();
  /** Editor layer toggles. */
  private layerHidden = new Set<LayerFamily>();
  private layerLocked = new Set<LayerFamily>();
  private outlinerQuery = '';
  private outlinerFilters = new Set<OutlinerFilter>();
  private linkGraphQuery = '';
  private contextLinkId: string | null = null;
  private readonly assetStore = new LocalStorageAssetStore();
  private assetQuery = '';
  private assetView: AssetBrowserView = 'grid';
  private assetSort: AssetSortMode = 'name';
  private assetCollection: AssetSmartCollection = 'all';
  private assetKindFilters = new Set<AssetKind>();
  private assetOriginFilters = new Set<AssetOrigin>();
  private assetSelectedId: string | null = null;
  private assetSelectedIds = new Set<string>();
  private assetRangeAnchorId: string | null = null;
  private assetBrowserFocusTarget: AssetBrowserFocusTarget | null = null;
  private pendingAssetBrowserSourceScroll: number | null = null;
  private pendingAssetBrowserListScroll: number | null = null;
  private prefabAssetQuery = '';
  private spriteAssetQuery = '';
  private prefabPaletteScrollTop = 0;
  private spritePaletteScrollTop = 0;
  private placementPaletteFocusTarget: PlacementPaletteFocusTarget | null = null;
  private prefabSelectedAssetId: string | null = null;
  private prefabActiveVariant: PrefabVariantId = 'base';
  private prefabSelectedAnchorId: string | null = null;
  private placedPrefabAnchors: PlacedPrefabAnchor[] = [];
  /** Scarred planes captured on playtest return, for BAKE. */
  private playtestScars: { types: Uint8Array; life: Int16Array; charge: Uint8Array } | null = null;
  /** True while the disposable custom runtime came from Builder, not header PLAY. */
  private builderPlaytestActive = false;
  /** Header BUILDER / banner return path; header SANDBOX deliberately abandons instead. */
  private builderReturnRequested = false;
  /** Last explicit test spawn for RESTART PLAYTEST. Null = authored spawn. */
  private lastPlaytestSpawn: { x: number; y: number } | null = null;
  /** Player state before the disposable playtest mutates ctx.player. */
  private prePlaytestPlayer: PlayerState | null = null;
  /** Wand runtime state before the disposable playtest mutates ctx.wands. */
  private prePlaytestWands: BuilderWandSnapshot | null = null;
  /** Ambient as it stood before a mood-overridden playtest. */
  private prevAmbient: number | null = null;
  /** Light preview solo (null = all). */
  private soloLightId: string | null = null;
  /** Enemy whose patrol waypoints are being clicked in. */
  private patrolEditId: string | null = null;
  private linkFrom: string | null = null;
  private pendingPreview: PendingPreview | null = null;
  private readonly previewRuntime: PreviewRuntime;
  private previewRuntimeDirty = true;
  private lastMouse = { x: 0, y: 0 };
  private lastMouseClient: { x: number; y: number } | null = null;
  private zoomTarget = 1;
  private lightPreviewOn = true;
  private wandLightPreviewOn = false;
  private sessionMode: 'author' | 'live' = 'author';
  /** Placement/drag snap step in cells (0 = off). */
  private snapStep: SnapStep = 0;
  private gizmoDrag: GizmoDragState | null = null;
  private hoverGizmoId: string | null = null;
  /** Palette drag-to-place: armed on button mousedown, live once a ghost exists. */
  private palDrag: {
    kind: EditorObjectKind | 'light';
    startX: number;
    startY: number;
    ghost: HTMLDivElement | null;
  } | null = null;
  private overlayMode: BuilderOverlayId | 'none' = 'none';
  private lastIssues: DocIssue[] = [];
  private lastValidationOverlay: ValidationOverlayDiagnostics | null = null;
  private validationDirty = true;
  private validationFilter: 'all' | DocIssue['severity'] = 'all';
  private validationScrollTop = 0;
  private activeValidationIssueIndex: number | null = null;
  private validationRefreshFrame: number | null = null;
  private prefabs: PrefabDef[] = [];
  private gallery: Gallery | null = null;
  private backdropPreview: BackdropPreview | null = null;
  private virtualWorldPanel: VirtualWorldPanel | null = null;
  private backdropDirty = false;
  private worldgenLevelId: string | null = null;
  /** A transformed (Q/E) copy of a library prefab while the stamp tool is
   *  armed — never the library record itself. */
  private armedPrefab: PrefabDef | null = null;
  /** Animated sprite library (Aseprite pipeline). Armed sprite makes the
   *  decor tool place sprite decor instead of designer notes. */
  private sprites: SpriteAsset[] = [];
  private armedSprite: SpriteAsset | null = null;
  /** Frame-0 canvases for the editor overlay (id -> canvas; null = unresolvable). */
  private spriteFrameCache = new Map<string, HTMLCanvasElement | null>();
  /** The decor inspector's animated preview (setTimeout chain, torn down on
   *  every inspector rebuild / close). */
  private decorPreviewTimer = 0;
  /** Settle preview: full-plane snapshot while physics runs, then keep/revert. */
  private settleSnap: {
    types: Uint8Array;
    colors: Uint32Array;
    life: Int16Array;
    charge: Uint8Array;
  } | null = null;
  private settling = false;
  /** paintDirty as it stood when the settle began — a zero-diff KEEP must
   *  not launder away dirt earned by earlier uncaptured painting. */
  private settleWasDirty = false;
  private autosaveTimer = 0;
  private draftOffered = false;
  private allowingSandboxWorldShape = false;
  private shareBusy = false;
  private codeBusy = false;
  private builderHelpOpen = false;
  private builderHelpReturnFocus: HTMLElement | null = null;
  private workspaceLayout: WorkspaceLayout = loadWorkspaceLayout();
  private dockHost!: DockHost;
  private draggingPanelId: string | null = null;
  private panelPointerDrag: PanelPointerDrag | null = null;
  private panelDragOffset = { x: 18, y: 12 };
  private lastWorkspaceSize = { w: 0, h: 0 };

  private root!: HTMLDivElement;
  private centerSlot!: HTMLDivElement;
  private originalHolderParent: HTMLElement | null = null;
  private originalHolderNext: ChildNode | null = null;
  private overlay!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private cctx!: CanvasRenderingContext2D;
  private playtestBanner!: HTMLDivElement;
  private minimap!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;
  private minimapImage: ImageData | null = null;
  private markerLayer!: HTMLDivElement;
  private markers = new Map<string, HTMLDivElement>();
  private modeBtn!: HTMLButtonElement;
  private intentModal: HTMLDivElement | null = null;
  private intentModalPaused = false;
  private intentModalKeydown: ((e: KeyboardEvent) => void) | null = null;
  private rafId = 0;
  private statusTimer = 0;

  constructor(private ctx: Ctx) {
    this.previewRuntime = new PreviewRuntime(ctx);
    this.doc = createEmptyDocument('untitled', ctx.state.currentBiome);
    this.worldgenLevelId = this.levelIdForBiome(this.doc.biome);
    this.prefabs = loadPrefabs();
    this.sprites = loadSprites();
    this.workspaceLayout.overlayVisibility = sanitizeOverlayVisibility(this.workspaceLayout.overlayVisibility);
    this.dockHost = new DockHost(this.panelRegistry, this.workspaceLayout);
    this.workspaceLayout = this.dockHost.snapshot().layout;
    this.restoreLayerStateFromWorkspace();
    this.snapStep = sanitizeSnapStep(this.workspaceLayout.snapStep);
    this.overlayMode = BUILDER_OVERLAY_IDS.find((id) => this.workspaceLayout.overlayVisibility[id]) ?? 'none';
    this.buildDom();
    this.wireCollapsibleSections();
    this.wireBuilderHelp();
    this.el('bp-snap-btn').textContent = 'SNAP: ' + (this.snapStep === 0 ? 'OFF' : this.snapStep);
    this.syncOverlayButton();
    this.wireWorkspace();
    this.applyWorkspaceLayout();
    this.registerCommands();
    this.wirePrefabPanel();
    this.wireSpritePanel();
    this.wireBar();
    this.wireProcPanel();
    this.wirePointer();
    this.wireExtras();
    this.wireCmdk();
    this.wireLayers();
    this.syncLayers();
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener(DEV_CONSOLE_STATE_EVENT, this.onDevConsoleState as EventListener);
    // Entering play (PLAY button) while authoring closes the overlay; the
    // document survives for the next open.
    ctx.events.on('modeChanged', ({ mode }) => {
      if (mode === 'play' && this.isOpen) this.close();
      if (mode === 'build' && this.builderPlaytestActive && !this.isOpen && !this.builderReturnRequested) {
        this.abandonBuilderPlaytest();
        return;
      }
      // a mood-overridden playtest must not leak its ambient into the
      // sandbox if the user abandons it without reopening the Builder
      if (mode === 'build' && this.prevAmbient !== null && !this.isOpen) {
        ctx.params.global.ambient = this.prevAmbient;
        this.prevAmbient = null;
      }
    });
    ctx.events.on('worldEdited', (edit) => {
      if (!this.isOpen) return;
      this.markTerrainDirty();
      this.status(`${edit.command.toUpperCase()} EDITED ${edit.cells} LIVE CELLS`, true);
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
          if (this.allowingSandboxWorldShape) {
            this.allowingSandboxWorldShape = false;
            this.markTerrainDirty();
            return;
          }
          const hasWork = this.doc.world !== null || this.cmds.depth > 0 || this.paintDirty;
          if (this.previewBlocks()) {
            e.stopImmediatePropagation();
            e.preventDefault();
            return;
          }
          if (hasWork) {
            e.stopImmediatePropagation();
            e.preventDefault();
            const target = e.currentTarget as HTMLElement | null;
            void appDialog
              .confirm(
                'This reshapes the ENTIRE world under the open document and cannot be undone. ' +
                  '(RESTORE re-decodes the last captured terrain.) Continue?',
                { title: 'Reshape World', confirmText: 'Continue', tone: 'danger' },
              )
              .then((ok) => {
                if (!ok) return;
                this.allowingSandboxWorldShape = true;
                target?.click();
              });
            return;
          }
          this.markTerrainDirty();
        },
        true,
      );
    }
    // Unsaved authoring work guards the tab close.
    window.addEventListener('beforeunload', (e) => {
      if (this.isOpen && (this.cmds.depth > 0 || this.paintDirty || this.backdropDirty || this.pendingPreview || this.gizmoDrag)) {
        e.preventDefault();
      }
    });
  }

  /* ===================== open / close ===================== */

  open(): void {
    if (this.isOpen) return;
    if (this.builderPlaytestActive && this.ctx.state.mode === 'play') this.builderReturnRequested = true;
    if (this.ctx.state.mode === 'play' && !this.returningFromPlaytest) {
      this.showOpenIntentModal();
      return;
    }
    this.openWithIntent('continue-document', false);
  }

  private openWithIntent(intent: BuilderOpenIntent, inheritPause = false): void {
    if (this.isOpen) return;
    this.hideOpenIntentModal(false);
    // The Builder rides on build mode; leave the descent first if needed.
    if (this.ctx.state.mode === 'play') {
      (document.getElementById('mode-build-btn') as HTMLButtonElement | null)?.click();
    }
    if (!this.returningFromPlaytest && this.ctx.state.playtestSource === 'test') {
      this.ctx.state.playtestSource = null;
    }
    if (intent === 'current-scene') this.adoptCurrentSceneAsDocument();
    this.syncDocBackdropToLive();
    // EXPEDITION PROTECTION: levels persist as live World instances. If the
    // canvas still shows an expedition level, the Builder must NOT edit it
    // in place (LOAD/IMPORT would wipe a depth and autosave would keep it).
    // Detach onto a scratch world; PLAY re-attaches the expedition's own.
    let detached = false;
    let openStatus: { text: string; warn?: boolean } | null = null;
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
    this.attachWorkspace();
    this.sessionMode = 'author';
    this.previewRuntime.stop();
    this.previewRuntimeDirty = true;
    this.ctx.state.editorLights = null;
    this.syncWandLightPreview();
    this.syncSessionButtons();
    if (!this.ctx.state.paused || inheritPause) {
      this.ctx.state.paused = true;
      this.ownsPause = true;
    }
    if (detached) {
      this.root.style.display = '';
      openStatus = { text: 'EXPEDITION PARKED - THE BUILDER WORKS ON ITS OWN WORLD' };
    }
    if (intent === 'current-scene') {
      openStatus = { text: 'CURRENT PLAY SCENE SNAPSHOTTED - PLAYTEST RETURNS TO THIS SPAWN' };
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
      this.ctx.levels.exitCustomPlaytest(this.ctx);
      openStatus = { text: 'PLAYTEST DISCARDED - "BAKE PLAYTEST SCARS" (CTRL+K) CAN KEEP THEM' };
    } else if (this.returningFromPlaytest) {
      this.ctx.levels.exitCustomPlaytest(this.ctx);
    }
    if (this.returningFromPlaytest && this.prevAmbient !== null) {
      // a mood-overridden playtest restores the global ambient on return
      this.ctx.params.global.ambient = this.prevAmbient;
      this.prevAmbient = null;
    }
    if (this.returningFromPlaytest) {
      this.restorePrePlaytestPlayer();
      this.restorePrePlaytestWands();
      this.builderPlaytestActive = false;
      this.builderReturnRequested = false;
      this.lastPlaytestSpawn = null;
      this.ctx.state.playtestSource = null;
      this.setPlaytestBanner(false);
    }
    this.returningFromPlaytest = false;
    this.root.style.display = '';
    this.modeBtn.classList.add('active');
    document.body.classList.add('builder-open');
    this.syncConsoleForBuilderOpen();
    this.applyWorkspaceLayout();
    this.ctx.camera.zoomLock = this.zoomTarget;
    this.refreshDocSelect();
    this.syncAll();
    this.refreshPrefabs();
    this.refreshSprites();
    this.syncSettleButtons();
    this.autosaveTimer = window.setInterval(() => this.autosaveDraft(), 30000);
    if (intent !== 'current-scene') void this.offerDraft();
    if (openStatus) this.status(openStatus.text, openStatus.warn);
    this.rafId = requestAnimationFrame(this.loop);
  }

  close(): void {
    if (!this.isOpen) return;
    if (this.settling || this.settleSnap) this.finishSettle(false);
    if (this.floating) this.cancelFloat(true);
    this.discardPreview(true);
    this.isOpen = false;
    cancelAnimationFrame(this.rafId);
    window.clearInterval(this.autosaveTimer);
    this.ctx.camera.zoomLock = null;
    this.previewRuntime.stop();
    this.previewRuntimeDirty = true;
    this.ctx.state.editorLights = null;
    this.ctx.state.builderWandLightPreview.enabled = false;
    if (this.ownsPause) {
      this.ctx.state.paused = false;
      this.ownsPause = false;
    }
    this.tool = 'select';
    this.setBuilderHelp(false);
    this.backdropPreview?.close();
    this.virtualWorldPanel?.cancel();
    this.cancelGizmoDrag(true);
    this.drag = null;
    this.stroke = null;
    this.shapeDrag = null;
    this.marquee = null;
    this.cancelPanelPointerDrag();
    this.lassoPoints = null;
    this.floatDrag = null;
    this.waypointDrag = null;
    this.armedPrefab = null;
    this.armedSprite = null;
    window.clearTimeout(this.decorPreviewTimer);
    this.patrolEditId = null;
    this.linkFrom = null;
    this.clearViewportFrame();
    this.restoreExternalPanels();
    this.root.style.display = 'none';
    this.detachWorkspace();
    if (!this.builderPlaytestActive) this.setPlaytestBanner(false);
    this.modeBtn.classList.remove('active');
    document.body.classList.remove('builder-open');
  }

  private attachWorkspace(): void {
    const holder = document.getElementById('canvas-holder');
    if (!holder || holder.parentElement === this.centerSlot) return;
    this.originalHolderParent = holder.parentElement;
    this.originalHolderNext = holder.nextSibling;
    this.centerSlot.appendChild(holder);
  }

  private detachWorkspace(): void {
    const holder = document.getElementById('canvas-holder');
    if (!holder || !this.originalHolderParent) return;
    if (this.originalHolderNext && this.originalHolderNext.parentNode === this.originalHolderParent) {
      this.originalHolderParent.insertBefore(holder, this.originalHolderNext);
    } else {
      this.originalHolderParent.appendChild(holder);
    }
    this.originalHolderParent = null;
    this.originalHolderNext = null;
  }

  private wireWorkspace(): void {
    for (const panel of this.workspaceLayout.panels) {
      const el = this.panelEl(panel.id);
      if (!el) continue;
      el.classList.add('builder-panel');
      el.draggable = false;
      el.dataset.panelId = panel.id;
      this.refreshPanelDragHandles(el);
      el.addEventListener('pointerdown', (e) => this.onPanelPointerDown(e, panel.id, el));
    }
    for (const dock of this.workspaceDropTargets()) {
      dock.addEventListener('dragover', (e) => {
        if (!this.draggingPanelId) return;
        e.preventDefault();
        this.clearDropTargetHighlights(dock);
        dock.classList.add('drop-target');
        const region = dock.dataset.dock as DockRegion | undefined;
        if (region) this.markDockInsertion(dock, region, e);
      });
      dock.addEventListener('dragleave', () => dock.classList.remove('drop-target'));
      dock.addEventListener('drop', (e) => {
        if (!this.draggingPanelId) return;
        e.preventDefault();
        dock.classList.remove('drop-target');
        const id = this.draggingPanelId;
        const region = dock.dataset.dock as DockRegion | undefined;
        this.draggingPanelId = null;
        this.clearWorkspaceDropState();
        if (!id || !region) return;
        this.moveWorkspacePanel(id, region, {
          beforeId: region === 'floating' ? null : this.dropInsertBeforeId(region, dock, id, e),
          floating: region === 'floating' ? this.floatingDropPosition(id, e) : undefined,
        });
        this.applyWorkspaceLayout();
        this.saveWorkspacePrefs();
        requestAnimationFrame(() => this.panelEl(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
        this.status(`PANEL DOCKED ${region.toUpperCase()}`);
      });
    }
  }

  private wireCollapsibleSections(root: ParentNode = this.root): void {
    for (const button of root.querySelectorAll<HTMLElement>('[data-section-toggle]')) {
      if (button.dataset.sectionToggleWired === 'true') continue;
      button.dataset.sectionToggleWired = 'true';
      const toggle = (): void => {
        const id = button.dataset.sectionToggle;
        const section = button.closest<HTMLElement>('.bp-section');
        if (!id || !section) return;
        const collapsed = !section.classList.contains('collapsed');
        section.classList.toggle('collapsed', collapsed);
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        this.workspaceLayout.collapsedSections[id] = collapsed;
        this.saveWorkspacePrefs();
      };
      button.addEventListener('click', toggle);
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle();
      });
    }
  }

  private syncCollapsedSections(): void {
    for (const section of this.root.querySelectorAll<HTMLElement>('.bp-section[data-section]')) {
      const id = section.dataset.section;
      if (!id) continue;
      const collapsed = this.workspaceLayout.collapsedSections[id] === true;
      section.classList.toggle('collapsed', collapsed);
      section.querySelector<HTMLElement>('[data-section-toggle]')?.setAttribute(
        'aria-expanded',
        collapsed ? 'false' : 'true',
      );
    }
  }

  private wireBuilderHelp(): void {
    const help = this.el<HTMLDivElement>('builder-help');
    this.el<HTMLButtonElement>('builder-help-close').addEventListener('click', () => this.setBuilderHelp(false));
    help.addEventListener('pointerdown', (e) => {
      if (e.target === help) this.setBuilderHelp(false);
    });
  }

  private setBuilderHelp(open: boolean): void {
    const wasOpen = this.builderHelpOpen;
    this.builderHelpOpen = open;
    const help = this.el<HTMLDivElement>('builder-help');
    help.style.display = open ? 'flex' : 'none';
    help.classList.toggle('open', open);
    help.setAttribute('aria-hidden', open ? 'false' : 'true');
    this.root.classList.toggle('b-help-open', open);
    if (open && !wasOpen) {
      this.builderHelpReturnFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.el<HTMLButtonElement>('builder-help-close').focus({ preventScroll: true });
    } else if (!open && wasOpen) {
      const returnFocus = this.builderHelpReturnFocus;
      this.builderHelpReturnFocus = null;
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    }
  }

  private cycleBuilderHelpFocus(backward: boolean): void {
    const help = this.el<HTMLDivElement>('builder-help');
    const focusable = [...help.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')]
      .filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled') && getComputedStyle(el).display !== 'none');
    if (focusable.length === 0) {
      help.focus({ preventScroll: true });
      return;
    }
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const next = backward
      ? (index <= 0 ? focusable.length : index) - 1
      : (index + 1) % focusable.length;
    focusable[next].focus({ preventScroll: true });
  }

  private refreshPanelDragHandles(panel: HTMLElement): void {
    const spec = this.panelRegistry.get(panel.dataset.panelId ?? panel.id);
    const handles = normalizePanelChromeHandles(panel, { fallbackHandleSelectors: spec?.handleSelectors });
    for (const handle of handles) {
      if (handle.dataset.menuWired === 'true') continue;
      handle.dataset.menuWired = 'true';
      handle.addEventListener('contextmenu', (event) => this.openPanelContextMenu(event, panel));
    }
  }

  private openPanelContextMenu(event: MouseEvent, panel: HTMLElement): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, label, [contenteditable="true"]')) return;
    const panelId = panel.dataset.panelId ?? panel.id;
    const commandIds = this.panelContextCommands(panelId);
    if (commandIds.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.menus.showCommandMenu({
      id: `panel:${panelId}`,
      registry: this.uiCommands,
      commandIds,
      cursor: { x: event.clientX, y: event.clientY },
      onStatus: (message, error) => this.status(message, error),
    });
  }

  private panelContextCommands(panelId: string): readonly string[] {
    const common = ['builder.commandPalette', 'builder.help', 'builder.resetWorkspace', 'builder.togglePanels'];
    if (panelId === 'builder-palette') {
      return [...common, 'builder.delete', 'builder.duplicate'];
    }
    if (panelId === 'builder-inspector') {
      return ['builder.frameSelection', 'builder.validate', ...common, 'builder.delete', 'builder.duplicate'];
    }
    if (panelId === 'builder-world') return ['builder.worldPanel', ...common];
    if (panelId === 'builder-virtual-world') return ['builder.virtualWorldPanel', ...common];
    if (panelId === 'builder-global') return ['builder.globalControlsPanel', 'builder.wandLightPreviewToggle', ...common];
    if (panelId === 'builder-postfx') return ['builder.postProcessingPanel', ...common];
    if (panelId === 'builder-matparams') return ['builder.materialPanel', ...common];
    if (panelId === 'builder-proc') return ['builder.proceduralPanel', ...common];
    if (panelId === 'builder-issues') return ['builder.findInvalid', 'builder.validate', ...common];
    if (panelId === 'builder-assets') return ['builder.assetsPanel', 'builder.assetDetailsPanel', 'builder.prefabDetailsPanel', 'builder.assetImport', ...common];
    if (panelId === 'builder-asset-details') return ['builder.assetDetailsPanel', 'builder.assetsPanel', ...common];
    if (panelId === 'builder-prefab-details') return ['builder.prefabDetailsPanel', 'builder.assetsPanel', 'builder.assetDetailsPanel', ...common];
    if (panelId === 'builder-outliner') return ['builder.outlinerPanel', 'builder.linkGraphPanel', ...common];
    if (panelId === 'builder-link-graph') return ['builder.linkGraphPanel', 'builder.outlinerPanel', 'builder.validate', ...common];
    return [];
  }

  private onPanelPointerDown(e: PointerEvent, id: string, panel: HTMLElement): void {
    if (!this.isOpen || e.button !== 0) return;
    if (panel.classList.contains('maximized')) return;
    const target = e.target as HTMLElement | null;
    if (panel.classList.contains('floating')) this.raiseFloatingPanel(id);
    if (!target?.closest('[data-panel-handle]')) return;
    if (target.closest('button, input, textarea, select, label, [contenteditable="true"]')) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = panel.getBoundingClientRect();
    this.panelDragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.panelPointerDrag = { id, pointerId: e.pointerId, el: panel, startX: e.clientX, startY: e.clientY, active: false };
    window.addEventListener('pointermove', this.onPanelPointerMove, true);
    window.addEventListener('pointerup', this.onPanelPointerUp, true);
    window.addEventListener('pointercancel', this.onPanelPointerCancel, true);
  }

  private onPanelPointerMove = (e: PointerEvent): void => {
    const drag = this.panelPointerDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    if (!drag.active) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (dx * dx + dy * dy < 16) return;
      this.startPanelLiveDrag(drag, e);
    }
    this.moveFloatingPanelPreview(drag.id, e);
    this.updatePanelDropTarget(e);
  };

  private onPanelPointerUp = (e: PointerEvent): void => {
    const drag = this.panelPointerDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    if (!drag.active) {
      this.cancelPanelPointerDrag();
      return;
    }
    this.finishPanelPointerDrag(e);
  };

  private onPanelPointerCancel = (e: PointerEvent): void => {
    const drag = this.panelPointerDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      this.cancelPanelPointerDrag();
      return;
    }
    this.finishPanelPointerDrag(e);
  };

  private startPanelLiveDrag(drag: PanelPointerDrag, point: PanelDropPoint): void {
    drag.active = true;
    this.draggingPanelId = drag.id;
    this.root.classList.add('b-dragging-panel');
    const floating = this.floatingPointFromClient(drag.id, point);
    this.moveWorkspacePanel(drag.id, 'floating', { floating });
    this.applyWorkspaceLayout();
    drag.el = this.panelEl(drag.id) ?? drag.el;
    drag.el.classList.add('dragging-live');
  }

  private finishPanelPointerDrag(e: PanelDropPoint): void {
    const drag = this.panelPointerDrag;
    if (!drag) return;
    drag.el.classList.remove('dragging-live');
    const target = this.panelDropTargetAt(e);
    const region = target?.dataset.dock as DockRegion | undefined;
    if (target && region) {
      this.moveWorkspacePanel(drag.id, region, {
        beforeId: region === 'floating' ? null : this.dropInsertBeforeId(region, target, drag.id, e),
        floating: region === 'floating' ? this.floatingPointFromClient(drag.id, e) : undefined,
      });
      this.status(`PANEL DOCKED ${region.toUpperCase()}`);
    }
    this.panelPointerDrag = null;
    this.draggingPanelId = null;
    this.clearWorkspaceDropState();
    window.removeEventListener('pointermove', this.onPanelPointerMove, true);
    window.removeEventListener('pointerup', this.onPanelPointerUp, true);
    window.removeEventListener('pointercancel', this.onPanelPointerCancel, true);
    this.applyWorkspaceLayout();
    this.saveWorkspacePrefs();
  }

  private cancelPanelPointerDrag(): void {
    this.panelPointerDrag?.el.classList.remove('dragging-live');
    this.panelPointerDrag = null;
    this.draggingPanelId = null;
    this.clearWorkspaceDropState();
    window.removeEventListener('pointermove', this.onPanelPointerMove, true);
    window.removeEventListener('pointerup', this.onPanelPointerUp, true);
    window.removeEventListener('pointercancel', this.onPanelPointerCancel, true);
  }

  private moveFloatingPanelPreview(id: string, point: PanelDropPoint): void {
    const pos = this.floatingPointFromClient(id, point);
    const panel = this.workspaceLayout.panels.find((p) => p.id === id);
    if (panel) panel.floating = pos;
    const el = this.panelEl(id);
    el?.style.setProperty('--builder-floating-left', `${pos.x}px`);
    el?.style.setProperty('--builder-floating-top', `${pos.y}px`);
  }

  private updatePanelDropTarget(point: PanelDropPoint): void {
    const target = this.panelDropTargetAt(point);
    this.clearDropTargetHighlights(target ?? undefined);
    if (!target) return;
    target.classList.add('drop-target');
    const region = target.dataset.dock as DockRegion | undefined;
    if (region) this.markDockInsertion(target, region, point);
  }

  private panelDropTargetAt(point: PanelDropPoint): HTMLElement | null {
    const targets = new Set(this.workspaceDropTargets());
    for (const el of document.elementsFromPoint(point.clientX, point.clientY)) {
      if (el instanceof HTMLElement && targets.has(el)) return el;
    }
    return null;
  }

  private applyWorkspaceLayout(): void {
    const left = this.el<HTMLDivElement>('builder-dock-left');
    const right = this.el<HTMLDivElement>('builder-dock-right');
    const bottom = this.el<HTMLDivElement>('builder-dock-bottom');
    const floating = this.el<HTMLDivElement>('builder-stage');
    const dockFor = (dock: DockRegion): HTMLElement =>
      dock === 'left' ? left : dock === 'right' ? right : dock === 'bottom' ? bottom : floating;
    const floatingPanels: Array<{ panel: WorkspaceLayout['panels'][number]; el: HTMLElement }> = [];
    for (const panel of this.workspaceLayout.panels) {
      if (panel.id === DEV_CONSOLE_PANEL_ID && !this.isOpen) continue;
      const el = this.panelEl(panel.id);
      if (!el) continue;
      const consoleMaximized = panel.id === DEV_CONSOLE_PANEL_ID && el.classList.contains('maximized');
      (consoleMaximized ? floating : dockFor(panel.dock)).appendChild(el);
      el.classList.add('builder-panel');
      el.classList.toggle('floating', panel.dock === 'floating' && !consoleMaximized);
      el.draggable = false;
      el.dataset.panelId = panel.id;
      this.refreshPanelDragHandles(el);
      el.style.display = panel.open ? '' : 'none';
      if (panel.dock === 'floating' && !consoleMaximized) {
        const z = Math.max(0, Math.min(1_000_000, panel.z ?? 0));
        el.style.zIndex = String((panel.id === DEV_CONSOLE_PANEL_ID ? 20 : 10) + z);
        floatingPanels.push({ panel, el });
      } else {
        el.style.removeProperty('--builder-floating-left');
        el.style.removeProperty('--builder-floating-top');
        el.style.removeProperty('z-index');
      }
    }
    let leftSize = this.openDockSize('left');
    let rightSize = this.openDockSize('right');
    const rootWidth = this.root.getBoundingClientRect().width || window.innerWidth;
    const cramped = rootWidth < 520;
    this.root.classList.toggle('b-cramped', cramped);
    if (cramped) {
      leftSize = leftSize > 0 ? CRAMPED_DOCK_RAIL_WIDTH : 0;
      rightSize = rightSize > 0 ? CRAMPED_DOCK_RAIL_WIDTH : 0;
    }
    const centerMin = rootWidth < 760 ? MIN_BUILDER_CENTER_WIDTH : PREFERRED_BUILDER_CENTER_WIDTH;
    const sideBudget = Math.max(0, rootWidth - centerMin);
    const sideTotal = leftSize + rightSize;
    if (sideTotal > sideBudget && sideTotal > 0) {
      const scale = sideBudget / sideTotal;
      leftSize = Math.floor(leftSize * scale);
      rightSize = Math.floor(rightSize * scale);
    }
    const zen = this.root.classList.contains('b-zen');
    this.el<HTMLDivElement>('builder-workspace-body').style.gridTemplateColumns =
      zen ? '0 minmax(0, 1fr) 0' : `${leftSize}px minmax(0, 1fr) ${rightSize}px`;
    const devConsoleMaximized = document.getElementById(DEV_CONSOLE_PANEL_ID)?.classList.contains('maximized') === true;
    const bottomOpen = !zen && this.workspaceLayout.panels.some((p) => p.dock === 'bottom' && p.open && !(p.id === DEV_CONSOLE_PANEL_ID && devConsoleMaximized));
    const bottomSize = this.openBottomDockSize();
    bottom.style.display = bottomOpen ? 'flex' : 'none';
    // The bottom dock lives in the body grid's center column (row 2), so the
    // side docks keep their full height; size only the body's stage/bottom rows.
    this.el<HTMLDivElement>('builder-workspace-body').style.gridTemplateRows =
      bottomOpen ? `minmax(0, 1fr) ${bottomSize}px` : 'minmax(0, 1fr) 0';
    this.lastWorkspaceSize = { w: Math.round(rootWidth), h: Math.round(this.root.getBoundingClientRect().height || window.innerHeight) };
    let floatingIndex = 0;
    const canClampFloating = this.isOpen && floating.clientWidth > 0 && floating.clientHeight > 0;
    for (const { panel, el } of floatingPanels) {
      const rawPos = panel.floating ?? this.defaultFloatingPosition(floatingIndex);
      const pos = canClampFloating ? this.clampedFloatingPosition(rawPos, el) : rawPos;
      el.style.setProperty('--builder-floating-left', `${pos.x}px`);
      el.style.setProperty('--builder-floating-top', `${pos.y}px`);
      floatingIndex += 1;
    }
    this.syncViewportFrame();
  }

  private syncWorkspaceFrame(): void {
    const rect = this.root.getBoundingClientRect();
    const size = { w: Math.round(rect.width || window.innerWidth), h: Math.round(rect.height || window.innerHeight) };
    if (size.w !== this.lastWorkspaceSize.w || size.h !== this.lastWorkspaceSize.h) {
      this.applyWorkspaceLayout();
      return;
    }
    this.syncViewportFrame();
  }

  private workspaceDropTargets(): HTMLElement[] {
    return [
      ...this.root.querySelectorAll<HTMLElement>('.builder-dock'),
      ...this.root.querySelectorAll<HTMLElement>('.builder-dock-guide'),
      this.el<HTMLDivElement>('builder-stage'),
    ];
  }

  private clearWorkspaceDropState(): void {
    this.root.classList.remove('b-dragging-panel');
    this.clearDropTargetHighlights();
  }

  private clearDropTargetHighlights(active?: HTMLElement): void {
    for (const dock of this.workspaceDropTargets()) {
      if (dock !== active) dock.classList.remove('drop-target');
      dock.classList.remove('drop-at-end');
    }
    for (const panel of this.root.querySelectorAll<HTMLElement>('.builder-panel.drop-before')) {
      panel.classList.remove('drop-before');
    }
  }

  private markDockInsertion(dock: HTMLElement, region: DockRegion, e: PanelDropPoint): void {
    if (region === 'floating' || dock.classList.contains('builder-dock-guide')) return;
    const beforeId = this.dropInsertBeforeId(region, dock, this.draggingPanelId, e);
    if (beforeId) this.panelEl(beforeId)?.classList.add('drop-before');
    else dock.classList.add('drop-at-end');
  }

  private dropInsertBeforeId(region: DockRegion, dock: HTMLElement, draggedId: string | null, e: PanelDropPoint): string | null {
    if (region === 'floating') return null;
    const horizontal = region === 'bottom';
    const cursor = horizontal ? e.clientX : e.clientY;
    const panels = this.workspaceLayout.panels
      .filter((panel) => panel.dock === region && panel.open && panel.id !== draggedId)
      .map((panel) => this.panelEl(panel.id))
      .filter((panel): panel is HTMLElement => panel !== null && panel.parentElement === dock && panel.style.display !== 'none');
    const dockRect = dock.getBoundingClientRect();
    if (panels.length > 0 && horizontal && cursor < dockRect.left + 48) return panels[0].dataset.panelId ?? panels[0].id;
    if (panels.length > 0 && !horizontal && cursor < dockRect.top + 48) return panels[0].dataset.panelId ?? panels[0].id;
    for (const panel of panels) {
      const rect = panel.getBoundingClientRect();
      const midpoint = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      if (cursor < midpoint) return panel.dataset.panelId ?? panel.id;
    }
    return null;
  }

  private floatingDropPosition(id: string, e: PanelDropPoint): { x: number; y: number } {
    return this.floatingPointFromClient(id, e);
  }

  private floatingPointFromClient(id: string, e: PanelDropPoint): { x: number; y: number } {
    const panel = this.panelEl(id);
    const rect = this.el<HTMLDivElement>('builder-stage').getBoundingClientRect();
    const shiftedRect = this.predictedStageRectAfterFloating(id, rect);
    const panelRect = panel?.getBoundingClientRect();
    const width = panelRect?.width ?? 280;
    const height = Math.min(panelRect?.height ?? 260, 380, Math.max(180, shiftedRect.height - 28));
    return this.clampFloatingPoint(
      {
        x: e.clientX - shiftedRect.left - Math.min(this.panelDragOffset.x, Math.max(16, width - 16)),
        y: e.clientY - shiftedRect.top - Math.min(this.panelDragOffset.y, Math.max(16, height - 16)),
      },
      width,
      height,
    );
  }

  private predictedStageRectAfterFloating(id: string, current: DOMRect): { left: number; top: number; width: number; height: number } {
    const panel = this.workspaceLayout.panels.find((p) => p.id === id);
    if (!panel || panel.dock !== 'left') {
      return { left: current.left, top: current.top, width: current.width, height: current.height };
    }
    const dockWillEmpty = !this.workspaceLayout.panels.some((p) => p.id !== id && p.dock === 'left' && p.open);
    if (!dockWillEmpty) return { left: current.left, top: current.top, width: current.width, height: current.height };
    const leftWidth = this.el<HTMLDivElement>('builder-dock-left').getBoundingClientRect().width;
    return {
      left: current.left - leftWidth,
      top: current.top,
      width: current.width + leftWidth,
      height: current.height,
    };
  }

  private defaultFloatingPosition(index: number): { x: number; y: number } {
    return { x: 24 + index * 34, y: 54 + index * 34 };
  }

  private clampedFloatingPosition(pos: { x: number; y: number }, panel: HTMLElement): { x: number; y: number } {
    const rect = panel.getBoundingClientRect();
    const stage = this.el<HTMLDivElement>('builder-stage');
    return this.clampFloatingPoint(pos, rect.width || 280, Math.min(rect.height || 260, 380, Math.max(180, stage.clientHeight - 28)));
  }

  private clampFloatingPoint(pos: { x: number; y: number }, width: number, height: number): { x: number; y: number } {
    const stage = this.el<HTMLDivElement>('builder-stage');
    const maxX = Math.max(8, stage.clientWidth - Math.min(width, stage.clientWidth - 16) - 8);
    const maxY = Math.max(8, stage.clientHeight - Math.min(height, stage.clientHeight - 16) - 8);
    return {
      x: Math.max(8, Math.min(maxX, Math.round(pos.x))),
      y: Math.max(8, Math.min(maxY, Math.round(pos.y))),
    };
  }

  private panelEl(id: string): HTMLElement | null {
    return (this.root.querySelector(`[id="${cssString(id)}"]`) as HTMLElement | null) ?? document.getElementById(id);
  }

  private raiseFloatingPanel(id: string): void {
    if (!this.workspaceLayout.panels.some((panel) => panel.id === id && panel.dock === 'floating')) return;
    this.dockHost.replaceLayout(this.workspaceLayout);
    this.workspaceLayout = this.dockHost.raisePanel(id);
    this.applyWorkspaceLayout();
    this.saveWorkspacePrefs();
  }

  private openDockSize(dock: 'left' | 'right'): number {
    const sizes = this.workspaceLayout.panels
      .filter((panel) => panel.dock === dock && panel.open)
      .map((panel) => panel.size);
    return sizes.length === 0 ? 0 : Math.max(...sizes);
  }

  private openBottomDockSize(): number {
    const sizes = this.workspaceLayout.panels
      .filter((panel) => panel.dock === 'bottom' && panel.open)
      .map((panel) => panel.size);
    if (sizes.length === 0) return 0;
    const rootHeight = this.root.getBoundingClientRect().height || window.innerHeight;
    const maxBottom = Math.max(180, Math.min(520, Math.floor(rootHeight * 0.5)));
    return Math.max(140, Math.min(maxBottom, Math.max(...sizes)));
  }

  private syncConsolePanelOpen(open = document.getElementById(DEV_CONSOLE_PANEL_ID)?.classList.contains('open') === true): void {
    const panel = this.workspaceLayout.panels.find((p) => p.id === DEV_CONSOLE_PANEL_ID);
    if (panel) this.setWorkspacePanelOpen(DEV_CONSOLE_PANEL_ID, open);
  }

  private setDevConsoleOpen(open: boolean): void {
    window.dispatchEvent(new CustomEvent(DEV_CONSOLE_COMMAND_EVENT, { detail: { open } }));
    this.syncConsolePanelOpen(open);
  }

  private syncConsoleForBuilderOpen(): void {
    const panel = this.workspaceLayout.panels.find((p) => p.id === DEV_CONSOLE_PANEL_ID);
    const open = panel?.open === true || document.getElementById(DEV_CONSOLE_PANEL_ID)?.classList.contains('open') === true;
    this.setDevConsoleOpen(open);
  }

  private onDevConsoleState = (event: Event): void => {
    if (!this.isOpen) return;
    const open = (event as CustomEvent<{ open?: unknown }>).detail?.open === true;
    this.syncConsolePanelOpen(open);
    this.applyWorkspaceLayout();
    this.saveWorkspacePrefs();
  };

  private restoreExternalPanels(): void {
    const holder = document.getElementById('canvas-holder');
    const devConsole = document.getElementById(DEV_CONSOLE_PANEL_ID);
    if (!holder || !devConsole) return;
    devConsole.classList.remove('builder-panel', 'floating', 'drop-target');
    devConsole.style.display = '';
    devConsole.style.removeProperty('--builder-floating-left');
    devConsole.style.removeProperty('--builder-floating-top');
    devConsole.style.removeProperty('z-index');
    devConsole.draggable = false;
    delete devConsole.dataset.panelId;
    if (devConsole.parentElement !== holder) holder.appendChild(devConsole);
  }

  private clearViewportFrame(): void {
    const holder = document.getElementById('canvas-holder');
    if (holder) holder.style.width = '';
    this.overlay.style.left = '';
    this.overlay.style.top = '';
    this.overlay.style.width = '';
    this.overlay.style.height = '';
    this.overlay.style.transform = '';
  }

  private syncViewportFrame(): void {
    if (!this.isOpen || !this.centerSlot || !this.overlay) return;
    const holder = document.getElementById('canvas-holder');
    if (!holder) return;
    const centerRect = this.centerSlot.getBoundingClientRect();
    if (centerRect.width <= 0 || centerRect.height <= 0) return;
    this.root.classList.toggle('b-small-stage', centerRect.width < 520 || centerRect.height < 420);
    const ratio = WIDTH / HEIGHT;
    const maxW = Math.max(80, centerRect.width - BUILDER_VIEWPORT_PAD);
    const maxH = Math.max(60, centerRect.height - BUILDER_VIEWPORT_PAD);
    const width = Math.max(80, Math.min(maxW, maxH * ratio));
    holder.style.width = `${Math.floor(width)}px`;

    const stageRect = this.el<HTMLDivElement>('builder-stage').getBoundingClientRect();
    const renderRect =
      [...holder.querySelectorAll('canvas')]
        .map((canvas) => canvas.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? holder.getBoundingClientRect();
    this.overlay.style.transform = 'none';
    this.overlay.style.left = `${Math.round(renderRect.left - stageRect.left)}px`;
    this.overlay.style.top = `${Math.round(renderRect.top - stageRect.top)}px`;
    this.overlay.style.width = `${Math.round(renderRect.width)}px`;
    this.overlay.style.height = `${Math.round(renderRect.height)}px`;
  }

  private saveWorkspacePrefs(): void {
    this.workspaceLayout.overlayVisibility = sanitizeOverlayVisibility(this.workspaceLayout.overlayVisibility);
    this.workspaceLayout = this.dockHost.replaceLayout(this.workspaceLayout);
    saveWorkspaceLayout(this.workspaceLayout);
  }

  private replaceWorkspaceLayout(layout: WorkspaceLayout): void {
    this.workspaceLayout = this.dockHost.replaceLayout(layout);
  }

  private moveWorkspacePanel(
    id: string,
    dock: DockRegion,
    options: { beforeId?: string | null; floating?: { x: number; y: number } } = {},
  ): void {
    this.dockHost.replaceLayout(this.workspaceLayout);
    this.workspaceLayout = this.dockHost.movePanel(id, dock, options);
  }

  private setWorkspacePanelOpen(id: string, open: boolean): void {
    this.dockHost.replaceLayout(this.workspaceLayout);
    this.workspaceLayout = open ? this.dockHost.openPanel(id) : this.dockHost.closePanel(id);
  }

  private resetWorkspace(): void {
    this.root.classList.remove('b-zen');
    this.replaceWorkspaceLayout(this.panelRegistry.sanitizeLayout(null));
    this.restoreLayerStateFromWorkspace();
    this.syncCollapsedSections();
    this.setDevConsoleOpen(false);
    this.workspaceLayout.overlayVisibility = sanitizeOverlayVisibility(this.workspaceLayout.overlayVisibility);
    this.snapStep = 0;
    this.el('bp-snap-btn').textContent = 'SNAP: OFF';
    this.syncOverlayButton();
    this.syncLayers();
    this.setTool('select');
    this.applyWorkspaceLayout();
    this.saveWorkspacePrefs();
    this.status('WORKSPACE RESET');
  }

  private applyWorkspacePreset(preset: WorkspacePreset): void {
    this.root.classList.remove('b-zen');
    this.replaceWorkspaceLayout(workspacePresetLayout(preset));
    this.restoreLayerStateFromWorkspace();
    this.syncCollapsedSections();
    this.setDevConsoleOpen(false);
    this.workspaceLayout.overlayVisibility = sanitizeOverlayVisibility(this.workspaceLayout.overlayVisibility);
    this.snapStep = sanitizeSnapStep(this.workspaceLayout.snapStep);
    this.el('bp-snap-btn').textContent = 'SNAP: ' + (this.snapStep === 0 ? 'OFF' : this.snapStep);
    this.syncOverlayButton();
    this.syncLayers();
    this.applyWorkspaceLayout();
    this.saveWorkspacePrefs();
    this.status(`WORKSPACE PRESET: ${preset.toUpperCase()}`);
  }

  private showOpenIntentModal(): void {
    if (this.intentModal) return;
    if (!this.ctx.levels.current) {
      this.openWithIntent('continue-document', false);
      return;
    }

    this.intentModalPaused = false;
    if (!this.ctx.state.paused) {
      this.ctx.state.paused = true;
      this.intentModalPaused = true;
    }

    const rt = this.ctx.levels.current;
    const hasWork = this.hasAuthoringWork();
    const modal = document.createElement('div');
    modal.id = 'builder-intent-modal';
    modal.className = 'app-dialog-root';
    modal.innerHTML = `
      <div class="bi-modal" role="dialog" aria-modal="true" aria-labelledby="builder-intent-title">
        <div class="bi-kicker">OPEN BUILDER</div>
        <div id="builder-intent-title" class="bi-title">What do you want to build?</div>
        <div class="bi-copy">
          You are currently playing ${escHtml(rt.def.name)}. Choose whether Builder should snapshot this scene or reopen the existing Builder document.
        </div>
        ${hasWork ? '<div class="bi-warn">Editing the current scene replaces the in-memory Builder document. A draft is kept before the swap.</div>' : ''}
        <div class="bi-actions">
          <button type="button" class="bi-primary" data-intent="current-scene">EDIT CURRENT SCENE</button>
          <button type="button" data-intent="continue-document">CONTINUE BUILDER DOC</button>
          <button type="button" data-intent="cancel">CANCEL</button>
        </div>
      </div>`;

    const choose = (intent: BuilderOpenIntent | 'cancel') => {
      if (intent === 'cancel') {
        this.hideOpenIntentModal(true);
        return;
      }
      const inheritPause = this.intentModalPaused;
      this.hideOpenIntentModal(false);
      this.openWithIntent(intent, inheritPause);
    };

    modal
      .querySelector<HTMLButtonElement>('[data-intent="current-scene"]')
      ?.addEventListener('click', () => choose('current-scene'));
    modal
      .querySelector<HTMLButtonElement>('[data-intent="continue-document"]')
      ?.addEventListener('click', () => choose('continue-document'));
    modal.querySelector<HTMLButtonElement>('[data-intent="cancel"]')?.addEventListener('click', () => choose('cancel'));
    modal.addEventListener('mousedown', (e) => {
      if (e.target === modal) choose('cancel');
    });
    const focusIntentButton = (backward: boolean) => {
      const buttons = [...modal.querySelectorAll<HTMLButtonElement>('button')].filter(
        (button) => !button.disabled && getComputedStyle(button).display !== 'none',
      );
      if (buttons.length === 0) {
        modal.focus({ preventScroll: true });
        return;
      }
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = backward
        ? (index <= 0 ? buttons.length : index) - 1
        : (index + 1) % buttons.length;
      buttons[next].focus({ preventScroll: true });
    };
    this.intentModalKeydown = (e: KeyboardEvent) => {
      if (!this.intentModal) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        choose('cancel');
        return;
      }
      if (e.code === 'KeyH') {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        focusIntentButton(e.shiftKey);
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement && modal.contains(active)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          active.click();
        }
      }
    };
    window.addEventListener('keydown', this.intentModalKeydown, true);

    document.body.appendChild(modal);
    this.intentModal = modal;
    modal.querySelector<HTMLButtonElement>('[data-intent="current-scene"]')?.focus();
  }

  private hideOpenIntentModal(restorePause: boolean): void {
    if (!this.intentModal) return;
    if (this.intentModalKeydown) {
      window.removeEventListener('keydown', this.intentModalKeydown, true);
      this.intentModalKeydown = null;
    }
    this.intentModal.remove();
    this.intentModal = null;
    if (restorePause && this.intentModalPaused) this.ctx.state.paused = false;
    this.intentModalPaused = false;
  }

  private hasAuthoringWork(): boolean {
    return (
      this.doc.objects.length > 0 ||
      this.doc.lights.length > 0 ||
      this.doc.world !== null ||
      this.cmds.depth > 0 ||
      this.paintDirty ||
      this.backdropDirty
    );
  }

  private adoptCurrentSceneAsDocument(): void {
    this.keepCurrentDocDraft();
    const rt = this.ctx.levels.current;
    const name = rt ? `${rt.def.name} scene edit` : 'play scene edit';
    const doc = createEmptyDocument(name, (rt?.def.biome ?? this.ctx.state.currentBiome) as BiomeId);
    doc.backdrop = sanitizeBackdropSettings(rt?.backdrop ?? this.ctx.params.backdrop);
    doc.backdropProfileId = rt?.backdropLevelId ?? rt?.def.id ?? null;
    doc.world = captureWorldLayer(this.ctx);
    doc.objects.push({
      id: freshId('spawn'),
      kind: 'spawn',
      x: Math.floor(this.ctx.player.x),
      y: Math.floor(this.ctx.player.y),
      rotation: 0,
      locked: false,
      hidden: false,
      params: {},
    });
    this.doc = doc;
    this.backdropDirty = false;
    this.playtestScars = null;
    this.mutedLightIds.clear();
    this.clearPlacedPrefabAnchors();
    this.cmds.clear();
    this.select(null);
    this.paintDirty = false;
    this.region = null;
    this.regionMask = null;
    this.regionMaskCells = 0;
    this.syncDocBackdropToLive();
  }

  private keepCurrentDocDraft(): void {
    if (!this.hasAuthoringWork()) return;
    if (this.floating || this.settling || this.settleSnap || this.pendingPreview) return;
    this.ensureCaptured();
    this.ensureDocBackdrop();
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), doc: this.doc }));
    } catch {
      // quota: the explicit SAVE/EXPORT paths remain the reliable archive
    }
  }

  private async confirmDiscardCurrentDocument(title: string): Promise<boolean> {
    if (!this.hasAuthoringWork()) return true;
    return appDialog.confirm('Discard the current document?', {
      title,
      confirmText: 'Discard',
      tone: 'danger',
    });
  }

  private replaceDocument(doc: EditorDocument, statusText: string): void {
    this.doc = doc;
    this.worldgenLevelId = this.levelIdForBiome(doc.biome);
    this.adoptDocSprites();
    this.playtestScars = null;
    this.mutedLightIds.clear();
    this.clearPlacedPrefabAnchors();
    this.cmds.clear();
    this.select(null);
    this.paintDirty = false;
    this.backdropDirty = false;
    this.region = null;
    this.regionMask = null;
    this.regionMaskCells = 0;
    this.syncDocBackdropToLive();
    this.applyDocTerrain();
    this.refreshDocSelect();
    this.syncAll();
    this.status(statusText);
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
    const viewport = document.getElementById('viewport-container');
    this.root = document.createElement('div');
    this.root.id = 'builder-root';
    this.root.style.display = 'none';
    const toolBtn = (tool: string, glyph: string, label: string): string =>
      `<button class="bp-tool bp-icon" data-tool="${tool}" aria-label="${label}"><span class="bp-glyph k-${tool}">${glyph}</span></button>`;
    const placeBtn = (p: { kind: EditorObjectKind; label: string; glyph: string }): string =>
      `<button class="bp-tool bp-mini" data-kind="${p.kind}" aria-label="${p.label}"><span class="bp-glyph k-${p.kind}">${p.glyph}</span>${p.label}</button>`;
    const paletteSection = (id: string, label: string, body: string): string => {
      const collapsed = this.workspaceLayout.collapsedSections[id] === true;
      return `<section class="bp-section${collapsed ? ' collapsed' : ''}" data-section="${id}">
        <button type="button" class="bp-head bp-section-head" data-section-toggle="${id}" aria-expanded="${collapsed ? 'false' : 'true'}">
          <span class="bp-chevron" aria-hidden="true"></span><span>${label}</span>
        </button>
        <div class="bp-section-body">${body}</div>
      </section>`;
    };
    const layerRows = LAYER_FAMILIES
      .map(
        (f) =>
          `<div class="bp-layer" data-layer="${f}"><span>${layerLabel(f)}</span><button data-vis title="Show/hide in the editor (still compiles)">&#128065;</button><button data-lock title="Lock against selection">&#128275;</button></div>`,
      )
      .join('');
    this.root.innerHTML = `
      <div id="builder-workspace">
      <div id="builder-bar">
        <span class="b-title">BUILDER</span>
        <div id="b-session-tabs" class="b-segment" aria-label="Builder session">
          <button id="b-session-author" class="active" title="Static authoring view">AUTHOR</button>
          <button id="b-session-live" title="Preview animation without gameplay mutation">LIVE PREVIEW</button>
          <button id="b-session-restart" title="Reset the disposable Live Preview runtime from the document">RESTART</button>
          <button id="b-session-discard" title="Discard Live Preview and return to Author">DISCARD</button>
        </div>
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
        <button id="b-undo" title="Ctrl+Z" aria-label="Undo">&#8617;</button>
        <button id="b-redo" title="Ctrl+Y" aria-label="Redo">&#8618;</button>
        <span class="b-sep"></span>
        <button id="b-capture" title="Snapshot the live sandbox cells into the document">CAPTURE TERRAIN</button>
        <button id="b-restore" title="Re-decode the document's captured terrain into the live world (clears undo)">RESTORE</button>
        <button id="b-validate">VALIDATE</button>
        <button id="b-bake" style="display:none" title="Re-apply the held playtest scars onto the document terrain (region = precise, undoable)">BAKE</button>
        <button id="b-playtest" class="b-accent">BUILDER PLAYTEST</button>
        <button id="b-playtest-here" class="b-accent" title="Compile this document and spawn at the cursor">PLAYTEST HERE</button>
        <button id="b-worldgen" title="Generate and tune procedural worlds">WORLDGEN</button>
        <button id="b-world-map" title="Preview and tune the virtual chunk world map">WORLD MAP</button>
        <button id="b-global" title="Global simulation and wand light controls">GLOBAL</button>
        <button id="b-postfx" title="Post processing controls">POST FX</button>
        <button id="b-gallery" title="Browse and preview every prefab, mechanism, entity and sprite — live and animated">GALLERY</button>
        <button id="b-assets" title="Project Asset Browser: documents, prefabs, sprites, imports and dependencies">ASSETS</button>
        <button id="b-backdrop" title="Preview and tune parallax backdrop layers">BACKDROP</button>
        <button id="b-reset-workspace" title="Reset dock layout, open panels, and workspace preferences">RESET WORKSPACE</button>
        <button id="b-zen" title="Hide all side panels for a clear view of the canvas">PANELS</button>
        <button id="b-exit">EXIT</button>
      </div>
      <div id="builder-workspace-body">
      <div id="builder-dock-left" class="builder-dock" data-dock="left">
      <div id="builder-palette">
        <div class="builder-panel-title" data-panel-handle>PALETTE</div>
        ${paletteSection(
          'palette.tools',
          'TOOLS',
          `<div class="bp-grid bp-grid5">
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
          ${toolBtn('lassoRegion', '➰', 'Lasso region: drag a freehand loop; release closes it')}
        </div>`,
        )}
        <div id="bp-mat-row" class="bp-hint" title="Active material, brush radius and zoom"></div>
        ${paletteSection(
          'palette.materials',
          'MATERIALS',
          `<div id="bp-materials" class="bp-grid bp-grid6"></div>
        <div class="bp-brushrow"><span>brush</span><input type="range" id="bp-brush" min="1" max="24" value="6"><b id="bp-brush-val">6</b></div>`,
        )}
        ${paletteSection(
          'palette.worldgen',
          'WORLD GEN',
          `<div class="bp-grid bp-grid3">
          <button id="bp-gen-caves" title="Regenerate caves in the document's biome (whole world)">CAVES</button>
          <button id="bp-gen-fort" title="Stamp a fortress into the world">FORT</button>
          <button id="bp-gen-clear" class="b-danger" title="Clear the whole world">CLEAR</button>
          <button id="bp-world-map-btn" title="Open the Noita-like virtual chunk world map">MAP</button>
        </div>`,
        )}
        ${paletteSection('palette.place', 'PLACE', `<div class="bp-grid bp-grid2">${PLACE_GAMEPLAY.map(placeBtn).join('')}</div>`)}
        ${paletteSection(
          'palette.mechanisms',
          'MECHANISMS',
          `<div class="bp-grid bp-grid2">${PLACE_MECH.map(placeBtn).join('')}</div>
        <button class="bp-tool" data-tool="link"><span class="bp-glyph k-link">K</span>Link trigger &rarr; door (K)</button>`,
        )}
        ${paletteSection(
          'palette.lighting',
          'LIGHTING',
          `<button class="bp-tool" data-tool="light"><span class="bp-glyph k-light">*</span>Authored Light</button>
        <button id="bp-light-toggle" aria-pressed="true" title="Feed authored lights into the live light field while editing">PREVIEW LIGHTS: ON</button>
        <button id="bp-wand-light-toggle" aria-pressed="false" title="Use the mouse cursor as the live player wand light">WAND LIGHT: OFF</button>
        <button id="bp-wand-params-btn" title="Open wand light tuning in Global Controls">WAND PARAMS&hellip;</button>`,
        )}
        ${paletteSection('palette.prefabs', 'PREFABS', '<div id="bp-prefab-host"></div>')}
        ${paletteSection('palette.sprites', 'SPRITES', '<div id="bp-sprite-host"></div>')}
        ${paletteSection(
          'palette.simulate',
          'SIMULATE',
          `<div class="bp-grid bp-grid3">
          <button id="bp-settle" aria-label="Hold to run physics; release to keep or revert">SETTLE</button>
          <button id="bp-settle-keep" style="display:none">KEEP</button>
          <button id="bp-settle-revert" style="display:none">REVERT</button>
        </div>`,
        )}
        ${paletteSection('palette.layers', 'LAYERS', `<div id="bp-layers">${layerRows}</div>`)}
        ${paletteSection(
          'palette.view',
          'VIEW',
          `<button id="bp-overlay-btn" title="Readability overlays (O)">OVERLAY: NONE</button>
        <button id="bp-snap-btn" title="Snap placements and drags to a grid">SNAP: OFF</button>
        <button id="bp-sym-btn" title="Mirror terrain painting across the axis (world center; a region recenters it)">SYM: OFF</button>
        <button id="bp-assets-btn" title="Open the Project Asset Browser">ASSETS&hellip;</button>
        <button id="bp-outliner-btn" title="Find, select, hide, and lock authored records">OUTLINER&hellip;</button>
        <button id="bp-link-graph-btn" title="Inspect trigger, relay, rune, and actuator links">LINK GRAPH&hellip;</button>`,
        )}
        ${paletteSection(
          'palette.parameters',
          'PARAMETERS',
          `<button id="bp-world-btn" title="World generation, biome, seed, and live params">WORLDGEN&hellip;</button>
        <button id="bp-global-btn" title="Simulation, brush, and wand light settings">GLOBAL&hellip;</button>
        <button id="bp-postfx-btn" title="Exposure, bloom, lens, and GPU composition settings">POST FX&hellip;</button>
        <button id="bp-mat-btn" title="Tuning sliders for the armed material">MATERIAL&hellip;</button>`,
        )}
        ${paletteSection('palette.procedural', 'PROCEDURAL', '<button id="bp-proc-btn">SEEDED PASSES&hellip;</button>')}
      </div>
      </div>
      <div id="builder-stage" data-dock="floating">
      <div id="builder-center-slot"></div>
      <div id="builder-overlay"><canvas id="builder-canvas"></canvas><div id="builder-markers"></div></div>
      <div id="bp-matpop" style="display:none"></div>
      <canvas id="builder-minimap" width="${WIDTH >> 3}" height="${Math.ceil(HEIGHT / 8)}"
        title="Click to jump the camera"></canvas>
      <div id="builder-cmdk" style="display:none">
        <input id="bp-cmdk-input" placeholder="type a command&hellip; (Esc closes)" spellcheck="false">
        <div id="bp-cmdk-list"></div>
      </div>
      <div id="builder-import-host" style="display:none"></div>
      <div id="builder-status"></div>
      <div id="builder-help" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="builder-help-title" style="display:none">
        <div class="builder-help-card">
          <div class="builder-help-titlebar">
            <div>
              <div class="builder-help-kicker">BUILDER HELP</div>
              <div id="builder-help-title" class="builder-help-title">Authoring controls</div>
            </div>
            <button id="builder-help-close" type="button" aria-label="Close Builder help">&times;</button>
          </div>
          <div class="builder-help-grid">
            <div>
              <div class="builder-help-section">Canvas</div>
              <p><b>RMB</b> eyedrops material under the cursor.</p>
              <p><b>Mouse wheel</b> zooms the Builder camera.</p>
              <p><b>Drag empty canvas</b> creates a selection marquee.</p>
              <p><b>Shift-click</b> adds to the current selection.</p>
            </div>
            <div>
              <div class="builder-help-section">Editing</div>
              <p><b>Ctrl+D</b> duplicates selection.</p>
              <p><b>Ctrl+C / Ctrl+V</b> copies and pastes parameters.</p>
              <p><b>Delete</b> removes the selected object or light.</p>
              <p><b>Esc</b> steps back or closes transient Builder UI.</p>
            </div>
            <div>
              <div class="builder-help-section">Testing</div>
              <p><b>T</b> playtests at the cursor.</p>
              <p><b>Q</b> rotates an armed prefab.</p>
              <p><b>E</b> flips an armed prefab.</p>
              <p><b>X</b> floats a region; <b>Enter</b> lands it.</p>
            </div>
          </div>
          <div class="builder-help-close-hint">Press H or Esc to close.</div>
        </div>
      </div>
      </div>
      <div id="builder-dock-right" class="builder-dock" data-dock="right">
      <div id="builder-inspector"></div>
      <div id="builder-outliner" style="display:none"></div>
      <div id="builder-asset-details" style="display:none"></div>
      <div id="builder-prefab-details" style="display:none"></div>
      <div id="builder-world" style="display:none">
        ${builderPanelHeader({ title: builderPanelTitle('builder-world'), closeId: 'bw-close', closeLabel: 'Close world generation' })}
        <div id="bw-controls"></div>
      </div>
      <div id="builder-matparams" style="display:none">
        ${builderPanelHeader({ title: builderPanelTitle('builder-matparams'), closeId: 'bm-close', closeLabel: 'Close material parameters' })}
        <div id="bm-controls"></div>
      </div>
      <div id="builder-global" style="display:none">
        ${builderPanelHeader({ title: builderPanelTitle('builder-global'), closeId: 'bgl-close', closeLabel: 'Close global controls' })}
        <div id="bg-controls"></div>
      </div>
      <div id="builder-postfx" style="display:none">
        ${builderPanelHeader({ title: builderPanelTitle('builder-postfx'), closeId: 'bf-close', closeLabel: 'Close post processing' })}
        <div id="bf-controls"></div>
      </div>
      <div id="builder-proc" style="display:none">
        ${builderPanelHeader({ title: builderPanelTitle('builder-proc'), closeId: 'bp-proc-close', closeLabel: 'Close procedural pass' })}
        <div class="bi-row"><span>pass</span><select id="bp-pass">${PASSES.map(
          (p) => `<option value="${p.id}">${p.label}</option>`,
        ).join('')}</select></div>
        <div class="bi-row"><span>seed</span><input id="bp-seed" type="number" value="1337" min="0" step="1"><button id="bp-dice" class="b-icon" title="Re-roll seed" aria-label="Re-roll seed">&#9860;</button></div>
        <div class="bi-row"><span>density</span><input id="bp-density" type="range" min="5" max="100" value="50" aria-label="Procedural density"><b id="bp-density-val">50</b></div>
        <div class="bi-row"><span>target</span><b id="bp-target">whole level</b></div>
        <div class="bi-row"><span>material</span><b id="bp-material">&mdash;</b></div>
        <div class="bp-actions">
          <button id="bp-preview">PREVIEW</button>
          <button id="bp-apply" class="b-primary">APPLY</button>
          <button id="bp-discard">DISCARD</button>
        </div>
        <div class="bp-hint" id="bp-status">Cell passes preview before<br>committing; population passes<br>apply directly (undoable).</div>
      </div>
      <div id="builder-issues" style="display:none"></div>
      </div>
      <div id="builder-dock-guides" aria-hidden="true">
        <div id="builder-dock-guide-left" class="builder-dock-guide bdg-left" data-dock="left"><span>LEFT</span></div>
        <div id="builder-dock-guide-right" class="builder-dock-guide bdg-right" data-dock="right"><span>RIGHT</span></div>
        <div id="builder-dock-guide-bottom" class="builder-dock-guide bdg-bottom" data-dock="bottom"><span>BOTTOM</span></div>
      </div>
      <div id="builder-dock-bottom" class="builder-dock" data-dock="bottom"></div>
      </div>
      <div id="builder-link-graph" style="display:none"></div>
      <div id="builder-assets" style="display:none"></div>
      <div id="builder-virtual-world" style="display:none"></div>
      </div>`;
    viewport?.appendChild(this.root);
    this.playtestBanner = document.createElement('div');
    this.playtestBanner.id = 'builder-playtest-banner';
    this.playtestBanner.style.display = 'none';
    this.playtestBanner.innerHTML = `
      <div class="bpt-title">BUILDER PLAYTEST</div>
      <div class="bpt-sub">DISPOSABLE CUSTOM RUNTIME</div>
      <button id="bpt-return" type="button">RETURN TO BUILDER</button>
      <button id="bpt-restart" type="button">RESTART</button>`;
    holder?.appendChild(this.playtestBanner);
    this.playtestBanner
      .querySelector<HTMLButtonElement>('#bpt-return')
      ?.addEventListener('click', () => {
        this.builderReturnRequested = true;
        this.open();
      });
    this.playtestBanner
      .querySelector<HTMLButtonElement>('#bpt-restart')
      ?.addEventListener('click', () => this.restartBuilderPlaytest());

    this.centerSlot = this.root.querySelector('#builder-center-slot') as HTMLDivElement;
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

    // every palette button explains itself on hover: placeables get a
    // pixel preview + the one rule that matters; tools get their drive line
    const kindLabel = new Map<string, string>(
      [...PLACE_GAMEPLAY, ...PLACE_MECH].map((p) => [p.kind, p.label] as const),
    );
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.bp-tool')) {
      if (btn.title) {
        btn.setAttribute('aria-label', btn.title);
        btn.removeAttribute('title');
      }
      const kind = btn.dataset.kind as EditorObjectKind | undefined;
      const tool = btn.dataset.tool;
      const objInfo = kind ? OBJECT_INFO[kind] : tool === 'light' ? OBJECT_INFO.light : undefined;
      if (objInfo) {
        const name = kind ? (kindLabel.get(kind) ?? kind) : 'Authored Light';
        this.attachPopover(btn, (pop) => {
          this.popHead(pop, previewCanvas(objInfo.draw), name);
          this.popDesc(pop, objInfo.desc);
        });
      } else if (tool && TOOL_INFO[tool]) {
        const info = TOOL_INFO[tool]!;
        this.attachPopover(btn, (pop) => {
          this.popHead(pop, null, info.name);
          this.popDesc(pop, info.desc);
        });
      }
    }

    // MATERIALS: cloned from the Sandbox toolbar's buttons (one source of
    // truth in index.html) — the Builder owns the whole left edge now —
    // plus authoring-only extras the Sandbox doesn't paint (Stone: well
    // plugs, basins, and rune doors are made of it).
    const matGrid = this.el<HTMLDivElement>('bp-materials');
    const materialIds = new Set<number>();
    for (const src of document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-mode="element"]')) {
      const id = Number(src.dataset.id);
      if (materialIds.has(id)) continue;
      materialIds.add(id);
      this.addMaterialSwatch(
        matGrid,
        id,
        (src.textContent ?? '').trim(),
        src.querySelector<HTMLElement>('.color-indicator')?.style.background ?? '#888',
      );
    }
    if (!materialIds.has(12)) this.addMaterialSwatch(matGrid, 12, 'Stone', '#8a8a92');
  }

  /* ---------- the instant popover (every palette button gets one) ---------- */

  private attachPopover(el: HTMLElement, fill: (pop: HTMLDivElement) => void): void {
    if (el.title) {
      el.setAttribute('aria-label', el.title);
      el.removeAttribute('title');
    }
    this.popovers.attachHover(el, {
      id: 'bp-matpop',
      offsetY: -6,
      shouldShow: () => !this.palDrag?.ghost,
      render: fill,
    });
  }

  /** Head row: picture + name. */
  private popHead(pop: HTMLDivElement, visual: HTMLElement | null, name: string): void {
    const head = document.createElement('div');
    head.className = 'bp-pop-head';
    if (visual) head.appendChild(visual);
    const label = document.createElement('span');
    label.textContent = name;
    head.appendChild(label);
    pop.appendChild(head);
  }

  private popDesc(pop: HTMLDivElement, text: string): void {
    const d = document.createElement('div');
    d.className = 'bp-pop-desc';
    d.textContent = text;
    pop.appendChild(d);
  }

  /**
   * One material swatch: real pixel icon when one exists (color dot
   * otherwise); the popover shows the full icon, name, classification,
   * and the live tunable properties. Click to arm.
   */
  private addMaterialSwatch(grid: HTMLDivElement, id: number, name: string, color: string): void {
    const swatch = document.createElement('button');
    swatch.className = 'bp-swatch';
    swatch.dataset.el = String(id);
    swatch.dataset.name = name;
    swatch.dataset.color = color;
    const icon = makeIconCanvas(ELEMENT_ICON[id] ?? '', 2);
    if (icon) {
      icon.className = 'bp-swatch-icon';
      swatch.appendChild(icon);
    } else {
      const d = document.createElement('span');
      d.className = 'dot';
      d.style.background = color;
      swatch.appendChild(d);
    }
    swatch.addEventListener('click', () => this.selectMaterial(id));
    this.attachPopover(swatch, (pop) =>
      fillMaterialPopover(pop, id, name, color, this.ctx.params.materials[id]),
    );
    grid.appendChild(swatch);
  }

  private snap(v: number, override = false): number {
    return snapValue(v, this.snapStep, override);
  }

  /** Arm a material for every terrain tool (and mirror it to the Sandbox UI). */
  private selectMaterial(id: number): void {
    this.armMaterial(id);
    const isTerrainTool =
      this.tool === 'paint' || SHAPE_TOOLS.has(this.tool) || this.tool === 'fill' || this.tool === 'replace';
    if (!isTerrainTool) this.setTool('paint');
    // arming from the palette brings up its tuning window (it follows reselection)
    this.openSidePanel('mat');
    const name = this.ctx.params.materials[id]?.name ?? 'Material ' + id;
    this.status('ARMED: ' + name.toUpperCase());
  }

  private armMaterial(id: number): void {
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
    if (this.isWorkspacePanelOpen('builder-matparams')) this.buildMatPanel();
    this.syncProcPanel();
  }

  private el<T extends HTMLElement>(id: string): T {
    return this.root.querySelector(`[id="${cssString(id)}"]`) as T;
  }

  private setTool(t: BuilderTool): void {
    this.tool = t;
    if (t !== 'link') this.linkFrom = null;
    if (t !== 'stamp' && this.armedPrefab) {
      this.armedPrefab = null;
      this.refreshPrefabs();
    }
    if (t !== 'decor' && this.armedSprite) {
      this.armedSprite = null;
      this.refreshSprites();
    }
    this.syncPalette();
    if (t === 'link') this.status('LINK: CLICK A TRIGGER OR RUNE GLYPH, THEN ITS DOOR');
  }

  private registerCommands(): void {
    const blocked = () => this.previewBlockReason() !== null;
    const blockReason = () => this.previewBlockReason() ?? 'Command unavailable';
    const add = (spec: CommandSpec) => this.uiCommands.register(spec);
    const tool = (id: string, t: BuilderTool, label: string, shortcut?: string) =>
      add({
        id,
        label,
        category: 'Tools',
        shortcut,
        run: () => this.setTool(t),
      });

    add({ id: 'builder.findInvalid', label: 'Find Invalid Object', category: 'Validation', run: () => this.findInvalid() });
    add({ id: 'builder.frameSelection', label: 'Frame Selection', category: 'View', shortcut: 'F', run: () => this.frameSelection() });
    add({ id: 'builder.view.fitDocument', label: 'Fit Authored Bounds', category: 'View', run: () => this.fitAuthoredBounds() });
    add({ id: 'builder.view.centerSpawn', label: 'Center On Spawn', category: 'View', run: () => this.centerOnSpawn() });
    add({ id: 'builder.view.centerValidationIssue', label: 'Center Active Validation Issue', category: 'View', run: () => this.centerActiveValidationIssue() });
    add({ id: 'builder.view.zoomIn', label: 'Zoom In', category: 'View', run: () => this.setBuilderZoom(this.zoomTarget * 1.2) });
    add({ id: 'builder.view.zoomOut', label: 'Zoom Out', category: 'View', run: () => this.setBuilderZoom(this.zoomTarget / 1.2) });
    add({ id: 'builder.view.zoomReset', label: 'Reset Zoom', category: 'View', run: () => this.setBuilderZoom(1) });
    add({ id: 'builder.help', label: 'Builder Help', category: 'Help', shortcut: 'H', run: () => this.setBuilderHelp(true) });
    add({
      id: 'builder.validate',
      label: 'Validate Document',
      category: 'Validation',
      enabled: () => !blocked(),
      disabledReason: blockReason,
      run: () => this.validateCurrentDocument(),
    });
    add({
      id: 'builder.playtest',
      label: 'Builder Playtest',
      category: 'Playtest',
      enabled: () => !blocked(),
      disabledReason: blockReason,
      run: () => this.playtest(),
    });
    add({
      id: 'builder.playtestHere',
      label: 'Playtest Here',
      category: 'Playtest',
      shortcut: 'T',
      enabled: () => !blocked(),
      disabledReason: blockReason,
      run: () => this.playtestHere(),
    });
    add({ id: 'builder.save', label: 'Save Document', category: 'Document', enabled: () => !blocked(), disabledReason: blockReason, run: () => this.saveDocument() });
    add({ id: 'builder.load', label: 'Load Selected Document', category: 'Document', enabled: () => !blocked(), disabledReason: blockReason, run: () => void this.loadSelectedDocument() });
    add({ id: 'builder.export', label: 'Export Document (.json)', category: 'Document', enabled: () => !blocked(), disabledReason: blockReason, run: () => this.exportDocument() });
    add({ id: 'builder.share', label: 'Share Code', category: 'Document', enabled: () => !blocked(), disabledReason: blockReason, run: () => void this.shareDocument() });
    add({ id: 'builder.importCode', label: 'Import From Share Code', category: 'Document', enabled: () => !blocked(), disabledReason: blockReason, run: () => void this.importShareCode() });
    add({ id: 'builder.captureTerrain', label: 'Capture Terrain Into Document', category: 'Document', enabled: () => !blocked(), disabledReason: blockReason, run: () => this.captureTerrain() });
    add({ id: 'builder.restoreTerrain', label: 'Restore Document Terrain', category: 'Document', enabled: () => !blocked(), disabledReason: blockReason, run: () => this.restoreTerrain() });
    add({ id: 'builder.newDocument', label: 'New Document', category: 'Document', enabled: () => !blocked(), disabledReason: blockReason, run: () => void this.newDocument() });
    add({ id: 'builder.undo', label: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z', enabled: () => !blocked(), disabledReason: blockReason, run: () => this.undo() });
    add({ id: 'builder.redo', label: 'Redo', category: 'Edit', shortcut: 'Ctrl+Y', enabled: () => !blocked(), disabledReason: blockReason, run: () => this.redo() });
    add({ id: 'builder.redoAlt', label: 'Redo', category: 'Edit', shortcut: 'Ctrl+Shift+Z', enabled: () => !blocked(), disabledReason: blockReason, visible: () => false, run: () => this.redo() });
    add({ id: 'builder.commandPalette', label: 'Command Palette', category: 'View', shortcut: 'Ctrl+K', run: () => this.openCmdk() });
    add({ id: 'builder.session.author', label: 'Author View', category: 'Session', run: () => this.setBuilderSession('author') });
    add({ id: 'builder.session.live', label: 'Live Preview', category: 'Session', run: () => this.setBuilderSession('live') });
    add({ id: 'builder.session.restartPreview', label: 'Restart Live Preview', category: 'Session', run: () => this.resetPreviewRuntime('PREVIEW RESTARTED') });
    add({ id: 'builder.session.discardPreview', label: 'Discard Live Preview', category: 'Session', run: () => this.discardPreviewRuntime() });
    add({ id: 'builder.copyParams', label: 'Copy Parameters', category: 'Edit', shortcut: 'Ctrl+C', enabled: () => this.selected() !== null, disabledReason: () => 'Select an object first', run: () => this.copyParams() });
    add({ id: 'builder.pasteParams', label: 'Paste Parameters', category: 'Edit', shortcut: 'Ctrl+V', enabled: () => this.selected() !== null && this.clipboard !== null, disabledReason: () => (this.selected() === null ? 'Select an object first' : 'Copy parameters first'), run: () => this.pasteParams() });
    add({ id: 'builder.duplicate', label: 'Duplicate Selection', category: 'Edit', shortcut: 'Ctrl+D', enabled: () => !blocked() && this.selectedIds.size > 0, disabledReason: () => blockReasonOr(this.selectedIds.size === 0 ? 'Select one or more objects first' : null), run: () => this.duplicateSelection() });
    add({ id: 'builder.group', label: 'Group Selection', category: 'Edit', shortcut: 'Ctrl+G', enabled: () => this.selectedIds.size > 1, disabledReason: () => 'Select at least two objects first', run: () => this.groupSelection(false) });
    add({ id: 'builder.ungroup', label: 'Ungroup Selection', category: 'Edit', shortcut: 'Ctrl+Shift+G', enabled: () => this.selectedIds.size > 0, disabledReason: () => 'Select a grouped object first', run: () => this.groupSelection(true) });
    add({ id: 'builder.delete', label: 'Delete Selection', category: 'Edit', shortcut: 'Delete', enabled: () => !blocked() && this.selectedIds.size > 0, disabledReason: () => blockReasonOr(this.selectedIds.size === 0 ? 'Select one or more objects first' : null), run: () => void this.deleteSelection() });
    add({
      id: 'builder.toggleSelectedHidden',
      label: 'Toggle Selected Hidden',
      category: 'Edit',
      enabled: () => this.selectedRecordKind() !== null,
      disabledReason: () => 'Select an object or light first',
      run: () => this.toggleSelectedRecordFlag('hidden'),
    });
    add({
      id: 'builder.toggleSelectedLocked',
      label: 'Toggle Selected Locked',
      category: 'Edit',
      enabled: () => this.selectedRecordKind() !== null,
      disabledReason: () => 'Select an object or light first',
      run: () => this.toggleSelectedRecordFlag('locked'),
    });
    add({
      id: 'builder.unlinkContextLink',
      label: 'Unlink',
      category: 'Links',
      enabled: () => this.contextLinkId !== null && this.doc.links.some((link) => link.id === this.contextLinkId),
      disabledReason: () => 'Choose a link row first',
      run: () => this.unlinkContextLink(),
    });
    add({
      id: 'builder.bakeScars',
      label: 'Bake Playtest Scars',
      category: 'Playtest',
      enabled: () => !blocked() && this.playtestScars !== null,
      disabledReason: () => blockReasonOr(this.playtestScars === null ? 'No returned playtest scars to bake' : null),
      run: () => void this.bakePlaytestScars(),
    });
    add({
      id: 'builder.liftRegion',
      label: 'Lift Region As Floating Selection',
      category: 'Edit',
      shortcut: 'X',
      enabled: () => !blocked() && this.region !== null,
      disabledReason: () => blockReasonOr(this.region === null ? 'Select a region first' : null),
      run: () => this.liftFloat(),
    });
    add({ id: 'builder.symmetryCycle', label: 'Cycle Symmetry Painting', category: 'View', run: () => this.cycleSymmetry() });
    add({
      id: 'builder.capturePrefab',
      label: 'Capture Region As Prefab',
      category: 'Prefabs',
      enabled: () => !blocked() && this.region !== null,
      disabledReason: () => blockReasonOr(this.region === null ? 'Select a region first' : null),
      run: () => void this.capturePrefabFromRegion(),
    });
    add({ id: 'builder.importPrefab', label: 'Import Prefab (.json / .png)', category: 'Prefabs', enabled: () => !blocked(), disabledReason: blockReason, run: () => void this.importPrefabFiles() });
    add({
      id: 'builder.exportRegionPng',
      label: 'Export Region As PNG',
      category: 'Prefabs',
      enabled: () => !blocked() && this.region !== null,
      disabledReason: () => blockReasonOr(this.region === null ? 'Select a region first' : null),
      run: () => void this.exportRegionPng(),
    });
    add({ id: 'builder.exportPalette', label: 'Export Material Palette (.gpl)', category: 'Prefabs', run: () => this.exportMaterialPalette() });
    add({ id: 'builder.lightPreviewToggle', label: 'Toggle Light Preview', category: 'View', run: () => this.toggleLightPreview() });
    add({ id: 'builder.wandLightPreviewToggle', label: 'Toggle Wand Cursor Light', category: 'View', run: () => this.toggleWandLightPreview() });
    add({ id: 'builder.worldPanel', label: 'World Generation', category: 'Panels', run: () => this.toggleSidePanel('world') });
    add({ id: 'builder.virtualWorldPanel', label: 'World Map', category: 'Panels', run: () => this.toggleWorkspacePanel('builder-virtual-world') });
    add({ id: 'builder.globalControlsPanel', label: 'Global Controls', category: 'Panels', run: () => this.toggleSidePanel('global') });
    add({ id: 'builder.postProcessingPanel', label: 'Post Processing', category: 'Panels', run: () => this.toggleSidePanel('post') });
    add({ id: 'builder.materialPanel', label: 'Material Parameters', category: 'Panels', run: () => this.toggleSidePanel('mat') });
    add({ id: 'builder.proceduralPanel', label: 'Seeded Procedural Passes', category: 'Panels', run: () => this.toggleSidePanel('proc') });
    add({ id: 'builder.assetsPanel', label: 'Project Asset Browser', category: 'Panels', run: () => this.toggleWorkspacePanel('builder-assets') });
    add({ id: 'builder.assetDetailsPanel', label: 'Asset Details', category: 'Panels', run: () => this.toggleWorkspacePanel('builder-asset-details') });
    add({ id: 'builder.prefabDetailsPanel', label: 'Prefab Details', category: 'Panels', run: () => this.toggleWorkspacePanel('builder-prefab-details') });
    add({ id: 'builder.assetImport', label: 'Import Asset JSON', category: 'Assets', run: () => void this.importAssetJsonFiles() });
    add({ id: 'builder.outlinerPanel', label: 'Object Outliner', category: 'Panels', run: () => this.toggleWorkspacePanel('builder-outliner') });
    add({ id: 'builder.linkGraphPanel', label: 'Link Graph', category: 'Panels', run: () => this.toggleWorkspacePanel('builder-link-graph') });
    for (const layer of LAYER_FAMILIES) {
      const label = layerLabel(layer);
      add({
        id: `builder.layer.${layer}.visibility`,
        label: `Toggle ${label} Layer Visibility`,
        category: 'Layers',
        run: () => this.toggleLayerVisibility(layer),
      });
      add({
        id: `builder.layer.${layer}.lock`,
        label: `Toggle ${label} Layer Lock`,
        category: 'Layers',
        run: () => this.toggleLayerLock(layer),
      });
    }
    add({ id: 'builder.resetWorkspace', label: 'Reset Workspace', category: 'Panels', run: () => this.resetWorkspace() });
    for (const preset of ['compact', 'wide', 'validation', 'lighting', 'prefab'] as const) {
      add({
        id: `builder.workspace.${preset}`,
        label: `Workspace Preset: ${preset.toUpperCase()}`,
        category: 'Panels',
        run: () => this.applyWorkspacePreset(preset),
      });
    }
    add({ id: 'builder.togglePanels', label: 'Toggle Panels / Zen', category: 'View', run: () => this.toggleZen() });
    add({ id: 'builder.overlayCycle', label: 'Cycle Readability Overlay', category: 'Overlays', shortcut: 'O', run: () => this.cycleOverlay() });
    for (const id of BUILDER_OVERLAY_IDS) {
      add({
        id: `builder.overlay.${id}`,
        label: `Toggle ${overlayLabel(id)}`,
        category: 'Overlays',
        run: () => this.toggleOverlay(id),
      });
    }
    add({ id: 'builder.snapCycle', label: 'Cycle Snap Grid', category: 'View', run: () => this.cycleSnapGrid() });
    add({ id: 'builder.generateCaves', label: 'Generate Caves', category: 'World', enabled: () => !blocked(), disabledReason: blockReason, run: () => void this.guardedWorldGen('caves') });
    add({ id: 'builder.spawnFortress', label: 'Spawn Fortress', category: 'World', enabled: () => !blocked(), disabledReason: blockReason, run: () => void this.guardedWorldGen('fortress') });
    add({ id: 'builder.clearWorld', label: 'Clear World', category: 'World', enabled: () => !blocked(), disabledReason: blockReason, run: () => void this.guardedWorldGen('clear') });
    tool('builder.tool.select', 'select', 'Tool: Select', 'V');
    tool('builder.tool.paint', 'paint', 'Tool: Paint', 'B');
    tool('builder.tool.line', 'line', 'Tool: Line', 'L');
    tool('builder.tool.rect', 'rect', 'Tool: Rectangle');
    tool('builder.tool.rectFill', 'rectFill', 'Tool: Filled Rectangle');
    tool('builder.tool.ellipse', 'ellipse', 'Tool: Ellipse');
    tool('builder.tool.ellipseFill', 'ellipseFill', 'Tool: Filled Ellipse');
    tool('builder.tool.fill', 'fill', 'Tool: Flood Fill', 'G');
    tool('builder.tool.replace', 'replace', 'Tool: Replace Material');
    tool('builder.tool.region', 'region', 'Tool: Region Select', 'R');
    tool('builder.tool.lassoRegion', 'lassoRegion', 'Tool: Lasso Region');
    tool('builder.tool.smooth', 'smooth', 'Tool: Smooth Terrain');
    tool('builder.tool.roughen', 'roughen', 'Tool: Roughen Terrain');
    tool('builder.tool.link', 'link', 'Tool: Link Trigger To Door', 'K');
    tool('builder.tool.light', 'light', 'Tool: Place Light');

    const conflicts = this.keymap.conflicts();
    if (conflicts.length > 0) {
      console.warn(
        '[builder keymap] shortcut conflicts: ' +
          conflicts.map((c) => `${c.shortcut} = ${c.commandIds.join(', ')}`).join('; '),
      );
    }

    function blockReasonOr(reason: string | null): string {
      return reason ?? blockReason();
    }
  }

  private runUiCommand(id: string): void {
    const result = this.uiCommands.run(id);
    if (!result.ok) this.status(result.reason ?? 'COMMAND UNAVAILABLE', true);
  }

  private setBuilderSession(mode: 'author' | 'live'): void {
    if (this.sessionMode === mode) return;
    if (this.previewBlocks()) return;
    this.sessionMode = mode;
    this.syncSessionButtons();
    if (mode === 'author') {
      // Live Preview is visual-only; returning to Author clears transient preview feeds.
      this.previewRuntime.stop();
      this.ctx.state.editorLights = null;
      this.status('AUTHOR VIEW');
    } else {
      this.resetPreviewRuntime('LIVE PREVIEW');
    }
  }

  private syncSessionButtons(): void {
    this.el('b-session-author').classList.toggle('active', this.sessionMode === 'author');
    this.el('b-session-live').classList.toggle('active', this.sessionMode === 'live');
    this.el<HTMLButtonElement>('b-session-restart').disabled = this.sessionMode !== 'live';
    this.el<HTMLButtonElement>('b-session-discard').disabled = this.sessionMode !== 'live';
  }

  private resetPreviewRuntime(prefix = 'PREVIEW RESET'): void {
    if (this.sessionMode !== 'live') {
      this.status('LIVE PREVIEW IS NOT ACTIVE', true);
      return;
    }
    if (this.previewBlocks()) return;
    const status = this.previewRuntime.reset(this.doc, this.previewRuntimeSourceLayer());
    this.previewRuntimeDirty = false;
    this.status(`${prefix}: ${status.message.toUpperCase()}`, status.capped || !status.ready);
  }

  private previewRuntimeSourceLayer(): EditorDocument['world'] {
    if (this.paintDirty || !this.doc.world) return captureWorldLayer(this.ctx);
    return this.doc.world;
  }

  private discardPreviewRuntime(): void {
    if (this.sessionMode !== 'live') {
      this.status('LIVE PREVIEW IS NOT ACTIVE', true);
      return;
    }
    this.previewRuntime.stop();
    this.previewRuntimeDirty = true;
    this.setBuilderSession('author');
  }

  /* ===================== top bar actions ===================== */

  private previewBlockReason(): string | null {
    if (this.settling || this.settleSnap) return 'Finish the settle preview first';
    if (this.floating) return 'Land or cancel the floating selection first';
    if (this.gizmoDrag) return 'Release the canvas gizmo first';
    if (this.pendingPreview) return 'Apply or discard the procedural preview first';
    return null;
  }

  /** True (and complains) while a settle run/decision is pending. The
   *  procedural panel gates on THIS (it owns its own pendingPreview). */
  private settleBlocks(): boolean {
    if (this.settling || this.settleSnap) {
      this.status('FINISH THE SETTLE PREVIEW FIRST (KEEP / REVERT)', true);
      return true;
    }
    return false;
  }

  /** True (and complains) while a floating selection is held. The world has
   *  a lifted hole and NO command on the stack — capture/save/undo/paint
   *  must all wait for ENTER (commit) or ESC (cancel). */
  private floatingBlocks(): boolean {
    if (!this.floating) return false;
    this.status('LAND OR CANCEL THE FLOATING SELECTION FIRST (ENTER / ESC)', true);
    return true;
  }

  /** True (and complains) while a preview — settle, floating selection, or
   *  procedural — awaits a decision. Every modal gate funnels through here. */
  private previewBlocks(): boolean {
    if (this.settleBlocks()) return true;
    if (this.floatingBlocks()) return true;
    if (this.gizmoDrag) {
      this.status('RELEASE THE CANVAS GIZMO FIRST', true);
      return true;
    }
    if (!this.pendingPreview) return false;
    this.status('APPLY OR DISCARD THE PROCEDURAL PREVIEW FIRST', true);
    return true;
  }

  private livePreviewActionBlocks(action: string): boolean {
    if (this.sessionMode !== 'live') return false;
    this.status(`${action.toUpperCase()} IS AUTHOR-ONLY — RETURN TO AUTHOR VIEW FIRST`, true);
    return true;
  }

  private async newDocument(): Promise<void> {
    if (this.previewBlocks()) return;
    if (!(await this.confirmDiscardCurrentDocument('New Document'))) return;
    this.doc = createEmptyDocument('untitled', this.ctx.state.currentBiome);
    this.worldgenLevelId = this.levelIdForBiome(this.doc.biome);
    this.playtestScars = null;
    this.mutedLightIds.clear();
    this.clearPlacedPrefabAnchors();
    this.cmds.clear();
    this.select(null);
    this.paintDirty = false;
    this.backdropDirty = false;
    this.region = null;
    this.regionMask = null;
    this.regionMaskCells = 0;
    this.syncDocBackdropToLive();
    this.applyDocTerrain();
    this.refreshDocSelect();
    this.syncAll();
    this.status('NEW DOCUMENT');
  }

  private saveDocument(): void {
    if (this.previewBlocks()) return;
    this.ensureCaptured();
    this.ensureDocBackdrop();
    embedSprites(this.doc, this.sprites);
    if (saveDocToLibrary(this.doc)) {
      this.backdropDirty = false;
      this.status(`SAVED "${this.doc.name.toUpperCase()}"`);
      localStorage.removeItem(DRAFT_KEY);
    } else this.status('STORAGE FULL — USE EXPORT', true);
    this.refreshDocSelect();
  }

  private async loadSelectedDocument(): Promise<void> {
    if (this.previewBlocks()) return;
    const id = this.el<HTMLSelectElement>('b-doc-select').value;
    const saved = loadDocLibrary()[id];
    if (!saved) {
      this.refreshDocSelect();
      return;
    }
    const doc = JSON.parse(JSON.stringify(saved)) as EditorDocument;
    if (!(await this.confirmDiscardCurrentDocument('Load Document'))) {
      this.refreshDocSelect();
      return;
    }
    this.replaceDocument(doc, `LOADED "${doc.name.toUpperCase()}"`);
  }

  private exportDocument(): void {
    if (this.previewBlocks()) return;
    this.ensureCaptured();
    this.ensureDocBackdrop();
    embedSprites(this.doc, this.sprites);
    const blob = new Blob([JSON.stringify(this.doc)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.doc.name || 'level'}.builder.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private captureTerrain(): void {
    if (this.previewBlocks()) return;
    this.doc.world = captureWorldLayer(this.ctx);
    this.paintDirty = false;
    this.markDocumentChanged();
    this.status('TERRAIN CAPTURED INTO DOCUMENT');
  }

  private restoreTerrain(): void {
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
  }

  private validateCurrentDocument(): void {
    if (this.previewBlocks()) return;
    this.ensureCaptured();
    const issues = validateDocument(this.doc);
    this.lastValidationOverlay = buildValidationOverlayDiagnostics(this.doc);
    this.doc.validation = {
      at: new Date().toISOString(),
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    };
    this.renderIssues(issues);
    this.status(issues.length === 0 ? 'VALID — NO ISSUES' : `${issues.length} ISSUE(S)`);
  }

  private markDocumentChanged(cmd?: Command): void {
    this.validationDirty = true;
    this.previewRuntimeDirty = true;
    if ((cmd?.cells ?? 0) > 0) this.markTerrainDirty();
    this.scheduleValidationPanelRefresh();
  }

  private markTerrainDirty(): void {
    this.paintDirty = true;
    this.validationDirty = true;
    this.previewRuntimeDirty = true;
    this.scheduleValidationPanelRefresh();
  }

  private currentValidationIssues(): DocIssue[] {
    if (this.ensureCaptured()) this.validationDirty = true;
    if (this.validationDirty) {
      this.lastIssues = validateDocument(this.doc);
      this.lastValidationOverlay = buildValidationOverlayDiagnostics(this.doc);
      this.validationDirty = false;
    }
    return this.lastIssues;
  }

  private scheduleValidationPanelRefresh(): void {
    if (!this.isOpen || !this.isWorkspacePanelOpen('builder-issues')) return;
    if (this.validationRefreshFrame !== null) return;
    this.validationRefreshFrame = window.requestAnimationFrame(() => {
      this.validationRefreshFrame = null;
      if (!this.isOpen || !this.isWorkspacePanelOpen('builder-issues')) return;
      this.ensureCaptured();
      this.renderIssues(this.currentValidationIssues());
    });
  }

  private async shareDocument(): Promise<void> {
    if (this.previewBlocks()) return;
    if (this.shareBusy) return;
    this.shareBusy = true;
    try {
      this.ensureCaptured();
      this.ensureDocBackdrop();
      embedSprites(this.doc, this.sprites);
      const code = await docToShareCode(this.doc);
      let copied = false;
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
      } catch {
        copied = false;
      }
      await appDialog.prompt(
        copied ? 'Share code (already on the clipboard):' : 'Share code (Ctrl+C to copy):',
        code,
        {
          title: 'Share Code',
          confirmText: 'Done',
          cancelText: 'Close',
          multiline: true,
          readOnly: true,
        },
      );
      this.status(`SHARE CODE READY — ${Math.max(1, Math.round(code.length / 1024))} KB`);
    } catch {
      this.status('SHARE CODE FAILED', true);
    } finally {
      this.shareBusy = false;
    }
  }

  private async importShareCode(): Promise<void> {
    if (this.previewBlocks()) return;
    if (this.codeBusy) return;
    this.codeBusy = true;
    try {
      const code = await appDialog.prompt('Paste a share code:', '', {
        title: 'Import Code',
        confirmText: 'Import',
        multiline: true,
      });
      if (!code) return;
      const doc = await shareCodeToDoc(code);
      if (!doc) {
        this.status('NOT A VALID SHARE CODE', true);
        return;
      }
      if (!(await this.confirmDiscardCurrentDocument('Import Code'))) return;
      this.replaceDocument(doc, `IMPORTED "${doc.name.toUpperCase()}" FROM CODE`);
    } catch {
      this.status('CODE IMPORT FAILED', true);
    } finally {
      this.codeBusy = false;
    }
  }

  private async importDocumentFile(file: File): Promise<void> {
    if (this.previewBlocks()) return;
    let parsed: unknown = null;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const doc = parsed === null ? null : sanitizeImportedDoc(parsed);
    if (!doc) {
      this.status('NOT A BUILDER DOCUMENT', true);
      return;
    }
    if (!(await this.confirmDiscardCurrentDocument('Import Document'))) return;
    this.replaceDocument(doc, `IMPORTED "${doc.name.toUpperCase()}"`);
  }

  private wireBar(): void {
    this.el<HTMLInputElement>('b-doc-name').addEventListener('change', (e) => {
      this.doc.name = (e.target as HTMLInputElement).value.trim() || 'untitled';
      this.refreshDocSelect();
    });
    this.el<HTMLSelectElement>('b-biome').addEventListener('change', (e) => {
      const biome = (e.target as HTMLSelectElement).value as BiomeId;
      this.doc.biome = biome;
      this.ctx.state.currentBiome = biome;
      this.worldgenLevelId = this.levelIdForBiome(biome);
      this.syncWorkspacePanelContent();
    });

    this.el('b-session-author').addEventListener('click', () => this.runUiCommand('builder.session.author'));
    this.el('b-session-live').addEventListener('click', () => this.runUiCommand('builder.session.live'));
    this.el('b-session-restart').addEventListener('click', () => this.runUiCommand('builder.session.restartPreview'));
    this.el('b-session-discard').addEventListener('click', () => this.runUiCommand('builder.session.discardPreview'));
    this.el('b-new').addEventListener('click', () => this.runUiCommand('builder.newDocument'));
    this.el('b-save').addEventListener('click', () => this.runUiCommand('builder.save'));
    this.el('b-load').addEventListener('click', () => this.runUiCommand('builder.load'));
    this.el<HTMLSelectElement>('b-doc-select').addEventListener('change', () => {
      void this.loadSelectedDocument();
    });
    this.el('b-export').addEventListener('click', () => this.runUiCommand('builder.export'));

    this.el<HTMLInputElement>('b-import').addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      if (this.previewBlocks()) {
        input.value = '';
        return;
      }
      void (async () => {
        await this.importDocumentFile(file);
        input.value = '';
      })();
    });

    this.el('b-undo').addEventListener('click', () => this.runUiCommand('builder.undo'));
    this.el('b-redo').addEventListener('click', () => this.runUiCommand('builder.redo'));

    this.el('b-capture').addEventListener('click', () => this.runUiCommand('builder.captureTerrain'));

    // The recovery path for "I just wiped the world": re-decode the layer
    // the document already holds. Undo clears — cell patches recorded
    // against the wiped world would lie against the restored one.
    this.el('b-restore').addEventListener('click', () => this.runUiCommand('builder.restoreTerrain'));
    this.el('b-validate').addEventListener('click', () => this.runUiCommand('builder.validate'));

    this.el('b-bake').addEventListener('click', () => this.runUiCommand('builder.bakeScars'));
    this.el('b-playtest').addEventListener('click', () => this.runUiCommand('builder.playtest'));
    this.el('b-playtest-here').addEventListener('click', () => this.runUiCommand('builder.playtestHere'));
    this.el('b-worldgen').addEventListener('click', () => this.runUiCommand('builder.worldPanel'));
    this.el('b-world-map').addEventListener('click', () => this.runUiCommand('builder.virtualWorldPanel'));
    this.el('b-global').addEventListener('click', () => this.runUiCommand('builder.globalControlsPanel'));
    this.el('b-postfx').addEventListener('click', () => this.runUiCommand('builder.postProcessingPanel'));
    this.el('b-gallery').addEventListener('click', () => this.openGallery());
    this.el('b-assets').addEventListener('click', () => this.runUiCommand('builder.assetsPanel'));
    this.el('b-backdrop').addEventListener('click', () => this.openBackdropPreview());
    this.el('b-reset-workspace').addEventListener('click', () => this.runUiCommand('builder.resetWorkspace'));
    this.el('b-zen').addEventListener('click', () => this.runUiCommand('builder.togglePanels'));
    this.el('b-exit').addEventListener('click', () => this.close());
  }

  /** The asset gallery: browse and preview everything, live and animated. */
  private openGallery(): void {
    this.gallery ??= new Gallery(this.root, {
      ctx: this.ctx,
      userPrefabs: () => this.prefabs,
      builtinPrefabs: () => builtinPrefabs(),
      sprites: () => this.sprites,
      docSprites: () => this.doc.assets?.sprites,
    });
    this.gallery.open();
    this.status('GALLERY — ↑↓ BROWSE · ←→ STATES · ESC CLOSES');
  }

  /** Live preview for the image-backed parallax cave backdrop. */
  private openBackdropPreview(): void {
    this.syncDocBackdropToLive();
    this.backdropPreview ??= new BackdropPreview(this.root, this.ctx, {
      getSettings: () => this.ensureDocBackdrop(),
      commitSettings: (settings, playtestProfileId) => {
        this.doc.backdrop = sanitizeBackdropSettings(settings);
        this.doc.backdropProfileId = playtestProfileId;
        this.ctx.params.backdrop = this.doc.backdrop;
        this.backdropDirty = true;
        this.status(
          playtestProfileId
            ? `BACKDROP APPLIED TO DOCUMENT - PLAYTEST USES ${playtestProfileId.toUpperCase()}`
            : 'BACKDROP APPLIED TO DOCUMENT',
        );
      },
      getPlaytestProfileId: () => this.doc.backdropProfileId ?? null,
    });
    this.backdropPreview.open();
    this.status('BACKDROP — DRAG OR WASD TO PAN · ESC CLOSES');
  }

  private ensureDocBackdrop(): NonNullable<EditorDocument['backdrop']> {
    this.doc.backdrop = sanitizeBackdropSettings(this.doc.backdrop ?? this.ctx.params.backdrop);
    this.doc.backdropProfileId =
      typeof this.doc.backdropProfileId === 'string' && this.doc.backdropProfileId ? this.doc.backdropProfileId : null;
    return this.doc.backdrop;
  }

  private syncDocBackdropToLive(): void {
    this.ctx.params.backdrop = this.ensureDocBackdrop();
  }

  /** Focus mode: every floating panel out of the way; the canvas breathes. */
  private toggleZen(): void {
    const zen = this.root.classList.toggle('b-zen');
    if (zen) this.setDevConsoleOpen(false);
    this.applyWorkspaceLayout();
    this.status(zen ? 'PANELS HIDDEN — ` OR THE PANELS BUTTON BRINGS THEM BACK' : 'PANELS BACK');
  }

  /**
   * Lazy terrain sync: in-builder paint edits the LIVE world; the document
   * re-captures right before anything reads doc.world as the truth.
   */
  private ensureCaptured(): boolean {
    // A world with a lifted hole must never be captured (every caller is
    // already previewBlocks-gated; this is the defense-in-depth backstop).
    if (this.floating || this.pendingPreview || this.settling || this.settleSnap) return false;
    if (!this.paintDirty) return false;
    this.doc.world = captureWorldLayer(this.ctx);
    this.paintDirty = false;
    this.validationDirty = true;
    return true;
  }

  private playtest(): void {
    if (this.previewBlocks()) return;
    this.ensureCaptured();
    const issues = validateDocument(this.doc);
    this.lastValidationOverlay = buildValidationOverlayDiagnostics(this.doc);
    const blockers = playtestBlockingIssues(issues, 'authored-spawn');
    this.renderIssues(issues, { playtestBlockers: blockers });
    if (blockers.length > 0) {
      this.selectIssueTarget(blockers[0]);
      this.status(`PLAYTEST BLOCKED: ${blockers.length} COMPILE BLOCKER(S)`, true);
      return;
    }
    this.startBuilderPlaytest(null);
  }

  private startBuilderPlaytest(spawnAt: { x: number; y: number } | null): void {
    this.returningFromPlaytest = true;
    this.builderPlaytestActive = true;
    this.lastPlaytestSpawn = spawnAt ? { ...spawnAt } : null;
    this.playtestScars = null;
    this.ctx.state.playtestSource = 'builder';
    this.prePlaytestPlayer = structuredClone(this.ctx.player);
    this.prePlaytestWands = this.snapshotWands();
    if (this.prevAmbient === null) this.prevAmbient = this.ctx.params.global.ambient;
    this.close();
    compileAndPlaytest(this.ctx, this.doc, spawnAt ? { spawnAt } : undefined);
    this.setPlaytestBanner(true);
    (document.getElementById('mode-play-btn') as HTMLButtonElement | null)?.click();
  }

  private restartBuilderPlaytest(): void {
    if (!this.builderPlaytestActive) return;
    if (this.prevAmbient !== null) this.ctx.params.global.ambient = this.prevAmbient;
    this.ctx.state.playtestSource = 'builder';
    compileAndPlaytest(
      this.ctx,
      this.doc,
      this.lastPlaytestSpawn ? { spawnAt: this.lastPlaytestSpawn } : undefined,
    );
    this.setPlaytestBanner(true);
    (document.getElementById('mode-play-btn') as HTMLButtonElement | null)?.click();
  }

  private abandonBuilderPlaytest(): void {
    if (!this.builderPlaytestActive) return;
    if (this.prevAmbient !== null) {
      this.ctx.params.global.ambient = this.prevAmbient;
      this.prevAmbient = null;
    }
    this.ctx.levels.exitCustomPlaytest(this.ctx);
    this.builderPlaytestActive = false;
    this.builderReturnRequested = false;
    this.returningFromPlaytest = false;
    this.lastPlaytestSpawn = null;
    this.playtestScars = null;
    this.ctx.state.playtestSource = null;
    this.setPlaytestBanner(false);
    this.ctx.state.editorLights = null;
    this.ctx.state.builderWandLightPreview.enabled = false;
    this.ctx.enemies.length = 0;
    this.ctx.projectiles.length = 0;
    this.ctx.particles.clear();
    if (this.doc.world) applyWorldLayer(this.ctx, this.doc.world);
    else this.ctx.world = new World();
    this.restorePrePlaytestPlayer();
    this.restorePrePlaytestWands();
  }

  private restorePrePlaytestPlayer(): void {
    if (!this.prePlaytestPlayer) return;
    const snapshot = structuredClone(this.prePlaytestPlayer);
    Object.assign(this.ctx.player, snapshot);
    this.prePlaytestPlayer = null;
    if (!snapshot.dead) this.ctx.events.emit('playerDeathCleared');
  }

  private snapshotWands(): BuilderWandSnapshot {
    return {
      active: this.ctx.wands.active,
      collection: [...this.ctx.wands.collection],
      wands: this.ctx.wands.wands.map((w) => ({
        frame: w.frame,
        cards: [...w.cards],
        mana: w.mana,
        cooldown: w.cooldown,
        cooldownMax: w.cooldownMax,
        castIndex: w.castIndex,
      })),
    };
  }

  private restorePrePlaytestWands(): void {
    const snapshot = this.prePlaytestWands;
    if (!snapshot) return;
    this.ctx.wands.active = snapshot.active;
    this.ctx.wands.collection.length = 0;
    this.ctx.wands.collection.push(...snapshot.collection);
    snapshot.wands.forEach((saved, index) => {
      const wand = this.ctx.wands.wands[index as 0 | 1];
      if (!wand) return;
      wand.frame = saved.frame;
      wand.cards.length = 0;
      wand.cards.push(...saved.cards);
      wand.mana = saved.mana;
      wand.cooldown = saved.cooldown;
      wand.castIndex = saved.castIndex;
      if (saved.cooldownMax === undefined) delete wand.cooldownMax;
      else wand.cooldownMax = saved.cooldownMax;
    });
    this.prePlaytestWands = null;
    this.ctx.wands.invalidatePrograms();
  }

  private setPlaytestBanner(show: boolean): void {
    if (!this.playtestBanner) return;
    this.playtestBanner.style.display = show ? '' : 'none';
    document.body.classList.toggle('builder-playtest-active', show);
  }

  /** Re-decode the authored terrain into the live world (fresh combat state). */
  private applyDocTerrain(): void {
    if (this.doc.world) applyWorldLayer(this.ctx, this.doc.world);
    else this.ctx.world.clear();
    this.ctx.enemies.length = 0;
    this.ctx.projectiles.length = 0;
    this.ctx.particles.clear();
  }

  private undo(): void {
    if (this.previewBlocks()) return;
    const label = this.cmds.undo();
    if (label === 'paint') this.markTerrainDirty();
    this.status(label ? 'UNDID ' + label.toUpperCase() : 'NOTHING TO UNDO');
    this.syncAll();
  }

  private redo(): void {
    if (this.previewBlocks()) return;
    const label = this.cmds.redo();
    if (label === 'paint') this.markTerrainDirty();
    this.status(label ? 'REDID ' + label.toUpperCase() : 'NOTHING TO REDO');
    this.syncAll();
  }

  /* ===================== pointer: tools ===================== */

  private clientToWorld(clientX: number, clientY: number, clampToOverlay = false): { x: number; y: number } {
    const rect = this.overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return this.lastMouse;
    const rawU = (clientX - rect.left) / rect.width;
    const rawV = (clientY - rect.top) / rect.height;
    const u = clampToOverlay ? Math.max(0, Math.min(1, rawU)) : rawU;
    const v = clampToOverlay ? Math.max(0, Math.min(1, rawV)) : rawV;
    const zx = 0.5 + (u - 0.5) / this.ctx.camera.zoom;
    const zy = 0.5 + (v - 0.5) / this.ctx.camera.zoom;
    return {
      x: Math.floor(zx * VIEW_W) + this.ctx.camera.renderX,
      y: Math.floor(zy * VIEW_H) + this.ctx.camera.renderY,
    };
  }

  /** Screen -> world cells; the inverse of InputManager.getMouseGridCoords. */
  private mouseToWorld(e: MouseEvent): { x: number; y: number } {
    return this.clientToWorld(e.clientX, e.clientY);
  }

  /** World cells -> overlay pixels (forward transform; used by the canvas). */
  private worldToScreen(wx: number, wy: number, rect: DOMRect): { x: number; y: number } {
    const cam = this.ctx.camera;
    const ux = ((wx - cam.renderX) / VIEW_W - 0.5) * cam.zoom + 0.5;
    const uy = ((wy - cam.renderY) / VIEW_H - 0.5) * cam.zoom + 0.5;
    return { x: ux * rect.width, y: uy * rect.height };
  }

  private projectedGizmoHandles(rect: DOMRect): ProjectedGizmoHandle[] {
    if (this.tool !== 'select') return [];
    const handles: GizmoHandle[] = [];
    const obj = this.selected();
    if (obj && this.layerSelectableObj(obj)) handles.push(...objectGizmoHandles(obj));
    const light = this.selectedLight();
    if (light && this.lightSelectable(light)) handles.push(...lightGizmoHandles(light));
    return projectGizmoHandles(handles, (x, y) => this.worldToScreen(x, y, rect));
  }

  private hitGizmoAt(e: MouseEvent): ProjectedGizmoHandle | null {
    const rect = this.overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) return null;
    return hitProjectedGizmoHandle(
      this.projectedGizmoHandles(rect),
      sx,
      sy,
    );
  }

  private canvasCursor(hoverGizmo: ProjectedGizmoHandle | null): string {
    if (this.gizmoDrag) return this.gizmoDrag.handle.cursor;
    if (hoverGizmo) return hoverGizmo.cursor;
    if (this.drag || this.floatDrag || this.waypointDrag) return 'move';
    if (this.marquee || this.shapeDrag || this.lassoPoints || this.polyPoints.length > 0) return 'crosshair';
    if (this.tool === 'select') return 'default';
    if (this.tool === 'paint' || this.tool === 'smooth' || this.tool === 'roughen') return 'cell';
    if (this.tool === 'link') return 'alias';
    return 'crosshair';
  }

  private snapGuideVisible(): boolean {
    if (this.snapStep === 0) return false;
    return (
      this.tool !== 'select' ||
      this.drag !== null ||
      this.gizmoDrag !== null ||
      this.floatDrag !== null ||
      this.waypointDrag !== null ||
      this.shapeDrag !== null ||
      this.marquee !== null ||
      this.armedPrefab !== null ||
      this.palDrag?.ghost !== null
    );
  }

  private spatialReadoutVisible(): boolean {
    return (
      this.snapGuideVisible() ||
      this.gizmoDrag !== null ||
      this.hoverGizmoId !== null ||
      this.drag !== null ||
      this.floatDrag !== null ||
      this.waypointDrag !== null ||
      this.shapeDrag !== null ||
      this.marquee !== null ||
      this.tool !== 'select'
    );
  }

  private startGizmoInteraction(handle: ProjectedGizmoHandle): boolean {
    if (handle.ownerKind === 'object') {
      const obj = this.doc.objects.find((o) => o.id === handle.ownerId);
      if (!obj || !this.layerSelectableObj(obj)) return false;
      if (handle.kind === 'waypoint' && typeof handle.index === 'number' && Array.isArray(obj.params.patrol)) {
        const pts = obj.params.patrol as Array<[number, number]>;
        this.waypointDrag = {
          obj,
          index: handle.index,
          orig: pts.map(([px, py]) => [px, py] as [number, number]),
        };
        return true;
      }
      if (handle.kind === 'rotate') {
        const cmd = this.rotateObjectCommand(obj);
        if (!cmd) return false;
        this.cmds.run(cmd);
        this.renderInspector();
        this.syncMarkers();
        this.status(`ROTATED ${obj.kind.toUpperCase()} 90 DEGREES`);
        return true;
      }
      if (handle.kind === 'resize-e' || handle.kind === 'resize-se') {
        this.gizmoDrag = {
          handle,
          target: obj,
          isLight: false,
          origX: obj.x,
          origY: obj.y,
          origRotation: obj.rotation,
          origParams: { ...obj.params },
          moved: false,
        };
        this.status(`${handle.label.toUpperCase()} - DRAG, RELEASE TO COMMIT`);
        return true;
      }
    } else {
      const light = this.doc.lights.find((l) => l.id === handle.ownerId);
      if (!light || !this.lightSelectable(light)) return false;
      if (handle.kind === 'light-falloff') {
        const order: EditorLight['falloff'][] = ['soft', 'linear', 'sharp'];
        const next = order[(order.indexOf(light.falloff) + 1) % order.length] ?? 'soft';
        this.cmds.run(editLightCmd(light, { falloff: next }));
        this.renderInspector();
        this.status(`LIGHT FALLOFF ${next.toUpperCase()}`);
        return true;
      }
      if (handle.kind === 'light-radius') {
        this.gizmoDrag = {
          handle,
          target: light,
          isLight: true,
          origX: light.x,
          origY: light.y,
          origLight: { radius: light.radius, falloff: light.falloff },
          moved: false,
        };
        this.status('LIGHT RADIUS - DRAG, RELEASE TO COMMIT');
        return true;
      }
    }
    return false;
  }

  private updateGizmoDrag(pos: { x: number; y: number }, snapOverride: boolean): void {
    const drag = this.gizmoDrag;
    if (!drag) return;
    if (drag.isLight) {
      const light = drag.target as EditorLight;
      const sx = this.snap(pos.x, snapOverride);
      const sy = this.snap(pos.y, snapOverride);
      const radius = lightRadiusFromDrag(light, sx, sy);
      if (radius !== light.radius) {
        light.radius = radius;
        drag.moved = true;
      }
      return;
    }
    const obj = drag.target as EditorObject;
    const patch = resizeObjectPatchFromDrag(
      obj,
      drag.handle.kind,
      this.snap(pos.x, snapOverride),
      this.snap(pos.y, snapOverride),
    );
    if (!patch) return;
    for (const [key, value] of Object.entries(patch.params)) {
      if (obj.params[key] !== value) {
        obj.params[key] = value;
        drag.moved = true;
      }
    }
  }

  private restoreGizmoDrag(drag: GizmoDragState): void {
    if (drag.isLight) {
      const light = drag.target as EditorLight;
      if (drag.origLight) {
        light.radius = drag.origLight.radius;
        light.falloff = drag.origLight.falloff;
      }
      return;
    }
    const obj = drag.target as EditorObject;
    obj.x = drag.origX;
    obj.y = drag.origY;
    if (drag.origRotation !== undefined) obj.rotation = drag.origRotation;
    if (drag.origParams) obj.params = { ...drag.origParams };
  }

  private cancelGizmoDrag(silent = false): void {
    const drag = this.gizmoDrag;
    this.gizmoDrag = null;
    if (!drag) return;
    this.restoreGizmoDrag(drag);
    this.renderInspector();
    this.syncMarkers();
    if (!silent) this.status('GIZMO DRAG CANCELLED');
  }

  private commitGizmoDrag(): void {
    const drag = this.gizmoDrag;
    this.gizmoDrag = null;
    if (!drag || !drag.moved) return;
    if (drag.isLight) {
      const light = drag.target as EditorLight;
      const nextRadius = light.radius;
      this.restoreGizmoDrag(drag);
      if (nextRadius !== light.radius) {
        this.cmds.run(editLightCmd(light, { radius: nextRadius }));
        this.renderInspector();
        this.status(`LIGHT RADIUS ${nextRadius}`);
      }
      return;
    }

    const obj = drag.target as EditorObject;
    const nextX = obj.x;
    const nextY = obj.y;
    const nextParams = { ...obj.params };
    this.restoreGizmoDrag(drag);

    const cmds: Command[] = [];
    if (nextX !== drag.origX || nextY !== drag.origY) cmds.push(moveObjectCmd(obj, nextX, nextY));
    const keys = new Set([...Object.keys(drag.origParams ?? {}), ...Object.keys(nextParams)]);
    for (const key of keys) {
      if ((drag.origParams ?? {})[key] !== nextParams[key]) cmds.push(editParamCmd(obj, key, nextParams[key]));
    }
    if (cmds.length === 0) return;
    this.cmds.run(cmds.length === 1 ? cmds[0] : compositeCmd(`${drag.handle.label.toLowerCase()} ${obj.kind}`, cmds));
    this.renderInspector();
    this.syncMarkers();
    this.status(`${drag.handle.label.toUpperCase()} COMMITTED`);
  }

  private wirePointer(): void {
    // RMB is the eyedropper, never the browser menu (Sandbox parity).
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    this.overlay.addEventListener('dragover', (e) => {
      if (!this.draggedAssetId(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    this.overlay.addEventListener('drop', (e) => {
      const assetId = this.draggedAssetId(e);
      if (!assetId) return;
      e.preventDefault();
      this.placeAssetDrop(assetId, e);
    });
    this.overlay.addEventListener('mousedown', (e) => {
      const pos = this.mouseToWorld(e);
      if (e.button === 2) {
        // patrol-edit mode: RMB on a waypoint removes it; elsewhere eyedrops
        if (this.patrolEditId && this.deletePatrolPointAt(pos.x, pos.y)) return;
        this.eyedrop(pos.x, pos.y);
        return;
      }
      if (e.button !== 0) return;
      // FLOATING SELECTION is modal on the canvas: inside the block starts
      // a drag; anywhere else just reminds (Enter lands, ESC cancels).
      if (this.floating) {
        const f = this.floating;
        if (pos.x >= f.x && pos.x < f.x + f.w && pos.y >= f.y && pos.y < f.y + f.h) {
          this.floatDrag = { grabX: pos.x, grabY: pos.y, origX: f.x, origY: f.y };
        } else {
          this.status('FLOATING SELECTION — DRAG IT, ENTER LANDS, ESC CANCELS');
        }
        return;
      }
      // patrol authoring eats clicks until ESC ends it
      if (this.patrolEditId) {
        this.addPatrolPoint(pos.x, pos.y);
        return;
      }
      const gizmo = this.hitGizmoAt(e);
      if (gizmo) {
        if (this.previewBlocks()) return;
        if (this.startGizmoInteraction(gizmo)) return;
      }
      if (this.tool === 'lassoRegion') {
        this.lassoPoints = [[pos.x, pos.y]];
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
        this.regionMaskCells = found.cells;
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
        if (this.previewBlocks() || !this.armedPrefab) return;
        this.pastePrefabAt(this.armedPrefab, pos.x, pos.y);
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
      // a selected enemy's patrol waypoints drag directly in the select tool
      const sel = this.selected();
      if (sel && sel.kind === 'enemy' && !sel.locked && Array.isArray(sel.params.patrol)) {
        const idx = this.hitPatrolPoint(sel, pos.x, pos.y);
        if (idx !== null) {
          const pts = sel.params.patrol as Array<[number, number]>;
          this.waypointDrag = {
            obj: sel,
            index: idx,
            orig: pts.map(([px, py]) => [px, py] as [number, number]),
          };
          return;
        }
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
        if (this.selectedIds.has(o.id) && !o.locked && this.layerSelectableObj(o))
          targets.push({ t: o, isLight: false, ox: o.x, oy: o.y });
      }
      for (const l of this.doc.lights) {
        if (this.selectedIds.has(l.id) && this.lightSelectable(l))
          targets.push({ t: l, isLight: true, ox: l.x, oy: l.y });
      }
      if (targets.length > 0) this.drag = { targets, grabX: pos.x, grabY: pos.y };
    });
    window.addEventListener('mousemove', (e) => {
      const pos = this.mouseToWorld(e);
      this.lastMouseClient = { x: e.clientX, y: e.clientY };
      this.lastMouse = pos;
      this.syncWandLightPreview();
      const hoverGizmo = this.gizmoDrag ? null : this.hitGizmoAt(e);
      this.hoverGizmoId = hoverGizmo?.id ?? null;
      this.overlay.style.cursor = this.canvasCursor(hoverGizmo);
      if (this.gizmoDrag) {
        this.updateGizmoDrag(this.clientToWorld(e.clientX, e.clientY, true), e.altKey);
        return;
      }
      if (this.floatDrag && this.floating) {
        const d = this.floatDrag;
        this.floating.x = this.snap(d.origX + pos.x - d.grabX, e.altKey);
        this.floating.y = this.snap(d.origY + pos.y - d.grabY, e.altKey);
        return;
      }
      if (this.lassoPoints) {
        // decimate: keep a point only once it strays >= 2 cells from the last
        const last = this.lassoPoints[this.lassoPoints.length - 1];
        if (Math.abs(pos.x - last[0]) >= 2 || Math.abs(pos.y - last[1]) >= 2) {
          this.lassoPoints.push([pos.x, pos.y]);
        }
        return;
      }
      if (this.waypointDrag) {
        const d = this.waypointDrag;
        const pts = d.obj.params.patrol as Array<[number, number]>;
        pts[d.index] = [this.snap(Math.floor(pos.x), e.altKey), this.snap(Math.floor(pos.y), e.altKey)];
        return;
      }
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
        m.t.x = this.snap(m.ox + dx, e.altKey);
        m.t.y = this.snap(m.oy + dy, e.altKey);
      }
    });
    window.addEventListener('mouseup', () => {
      if (this.gizmoDrag) {
        this.commitGizmoDrag();
        return;
      }
      if (this.floatDrag) {
        this.floatDrag = null;
        return;
      }
      if (this.lassoPoints) {
        const pts = this.lassoPoints;
        this.lassoPoints = null;
        this.commitLasso(pts);
        return;
      }
      if (this.waypointDrag) {
        const d = this.waypointDrag;
        this.waypointDrag = null;
        const pts = d.obj.params.patrol as Array<[number, number]>;
        const moved = pts[d.index];
        const orig = d.orig[d.index];
        if (moved[0] === orig[0] && moved[1] === orig[1]) return;
        // Rewind the live preview, then land the move as ONE command.
        const next = pts.map(([px, py]) => [px, py] as [number, number]);
        d.obj.params.patrol = d.orig;
        this.cmds.run(editParamCmd(d.obj, 'patrol', next));
        this.status(`WAYPOINT ${d.index + 1} MOVED`);
        return;
      }
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
          this.markTerrainDirty();
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
    this.syncStructurePanels();
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
    // symmetry: every mirrored image dabs into the SAME stroke record,
    // so the whole symmetric gesture stays one undo
    for (const [px, py] of this.symPoints(x, y)) {
      this.recordAround(px, py, px, py);
      spawnCircle(this.ctx, px, py, this.ctx.state.currentElement);
    }
  }

  private strokeMove(x: number, y: number): void {
    const s = this.stroke;
    if (!s) return;
    const ax = this.symAxis();
    for (const [x0, y0, x1, y1] of mirrorPairs(s.lastX, s.lastY, x, y, this.symmetry, ax.x, ax.y)) {
      this.recordAround(x0, y0, x1, y1);
      drawLine(this.ctx, x0, y0, x1, y1, this.ctx.state.currentElement);
    }
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
    this.markTerrainDirty();
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
    // symmetry: stamp every mirrored copy into the SAME recorder (one undo)
    const ax = this.symAxis();
    const isBox = this.tool !== 'line'; // boxes dedupe by bbox; lines keep their diagonal
    for (const [x0, y0, x1, y1] of mirrorPairs(
      s.x0, s.y0, s.x1, s.y1, this.symmetry, ax.x, ax.y, isBox,
    )) {
      if (this.tool === 'line') {
        stampLine(w, rec, x0, y0, x1, y1, this.ctx.state.brushSize, type);
      } else if (this.tool === 'rect' || this.tool === 'rectFill') {
        stampRect(w, rec, x0, y0, x1, y1, type, this.tool === 'rectFill');
      } else if (this.tool === 'ellipse' || this.tool === 'ellipseFill') {
        stampEllipse(w, rec, x0, y0, x1, y1, type, this.tool === 'ellipseFill');
      }
    }
    const patch = rec.finish();
    if (!patch) return;
    this.cmds.run(paintTerrainCmd(w, patch.before, patch.after));
    this.markTerrainDirty();
    this.status(`${this.tool.toUpperCase()}: ${patch.before.idxs.length} CELLS`);
    this.renderInspector();
  }

  private commitRegion(s: { x0: number; y0: number; x1: number; y1: number }): void {
    const x0 = Math.min(s.x0, s.x1),
      x1 = Math.max(s.x0, s.x1);
    const y0 = Math.min(s.y0, s.y1),
      y1 = Math.max(s.y0, s.y1);
    this.regionMask = null;
    this.regionMaskCells = 0;
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
    let cells = 0;
    for (const v of result.mask) cells += v;
    this.regionMaskCells = cells;
    this.syncProcPanel();
    this.status(`POLYGON REGION SET: ${cells} CELLS — PASSES & REPLACE USE IT`);
  }

  /** Lasso region: the freehand loop closes on release and rasterizes into
   *  a masked region — the same machinery as the polygon tool, one gesture. */
  private commitLasso(points: Array<[number, number]>): void {
    const result = points.length >= 3 ? rasterizePolygon(points) : null;
    if (!result) {
      this.status('LASSO TOO SMALL — DRAG A WIDER LOOP', true);
      return;
    }
    this.region = result.region;
    this.regionMask = result.mask;
    this.setTool('select');
    let cells = 0;
    for (const v of result.mask) cells += v;
    this.regionMaskCells = cells;
    this.syncProcPanel();
    this.status(`LASSO REGION SET: ${cells} CELLS — X LIFTS IT, PASSES USE IT`);
  }

  /** One smoothing/roughening application per pointer sample (mirrored). */
  private applyTerraStroke(x: number, y: number): void {
    const t = this.terraStroke;
    if (!t) return;
    const r = Math.max(3, this.ctx.state.brushSize);
    for (const [px, py] of this.symPoints(x, y)) {
      if (t.tool === 'smooth') smoothDisc(this.ctx.world, t.rec, px, py, r);
      else roughenDisc(this.ctx.world, t.rec, px, py, r);
    }
  }

  private commitFlood(x: number, y: number): void {
    const type = this.materialOrComplain();
    if (type === null) return;
    const w = this.ctx.world;
    const rec = new PatchRecorder(w);
    // symmetry: flood from every mirrored seed into the SAME recorder; a
    // seed whose area is over-cap (or already filled) skips, never partials
    let total = 0;
    let refused = 0;
    for (const [sx, sy] of this.symPoints(x, y)) {
      const n = floodFill(w, rec, sx, sy, type, FLOOD_CAP);
      if (n === -1) refused++;
      else total += n;
    }
    if (total === 0) {
      this.status(refused > 0 ? 'AREA TOO LARGE TO FLOOD FILL' : 'NOTHING TO FILL', refused > 0);
      return;
    }
    const patch = rec.finish();
    if (!patch) return;
    this.cmds.run(paintTerrainCmd(w, patch.before, patch.after));
    this.markTerrainDirty();
    this.status(
      `FLOOD FILLED ${total} CELLS` + (refused > 0 ? ` (${refused} MIRRORED SEED(S) OVER CAP)` : ''),
    );
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
    this.markTerrainDirty();
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
  private async confirmWholeWorldReshape(title: string): Promise<boolean> {
    const hasWork = this.doc.world !== null || this.cmds.depth > 0 || this.paintDirty;
    if (!hasWork) return true;
    return appDialog.confirm(
      'This reshapes the ENTIRE world under the open document and cannot be undone. ' +
        '(RESTORE re-decodes the last captured terrain.) Continue?',
      { title, confirmText: 'Continue', tone: 'danger' },
    );
  }

  private async generateConfiguredWorld(reroll: boolean): Promise<void> {
    if (this.previewBlocks()) return;
    const previousSeed = this.ctx.state.worldSeed;
    if (reroll) this.ctx.state.worldSeed = randomSeed();
    if (!(await this.confirmWholeWorldReshape('Generate World'))) {
      this.ctx.state.worldSeed = previousSeed;
      this.buildWorldPanel();
      return;
    }
    this.ctx.state.currentBiome = this.doc.biome;
    this.ctx.worldgen.generateCaves(this.ctx);
    if (this.ctx.worldgen.spawnHint) this.ctx.camera.snapTo(this.ctx.worldgen.spawnHint.x, this.ctx.worldgen.spawnHint.y);
    this.markTerrainDirty();
    this.syncAll();
    this.status(`GENERATED ${BIOME_DEFS[this.doc.biome].name.toUpperCase()} — SEED ${this.ctx.state.worldSeed >>> 0}`);
  }

  private async guardedWorldGen(action: 'caves' | 'fortress' | 'clear'): Promise<void> {
    if (this.previewBlocks()) return;
    if (!(await this.confirmWholeWorldReshape('Reshape World'))) return;
    if (action === 'caves') {
      this.ctx.state.currentBiome = this.doc.biome; // the document drives the look
      this.ctx.worldgen.regenerate(this.ctx);
    } else if (action === 'fortress') {
      this.ctx.worldgen.spawnFortress(this.ctx);
    } else {
      this.ctx.world.clear();
    }
    this.markTerrainDirty();
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
    let params = DEFAULT_PARAMS[kind]?.() ?? {};
    // An armed sprite turns the decor tool into animated-decor placement
    // (no sprite armed = the legacy designer note, annotation only).
    if (kind === 'decor' && this.armedSprite) {
      params = {
        spriteId: this.armedSprite.id,
        loopTag: this.armedSprite.tags[0]?.name ?? '',
        fps: 0,
        flipX: false,
      };
    }
    // Slab kinds anchor top-left; center them on the click for placement.
    let px = this.snap(x),
      py = this.snap(y);
    if (kind === 'door' || kind === 'runeDoor' || kind === 'valve' || kind === 'plug') {
      px = this.snap(x) - Math.floor(((params.w as number) ?? 3) / 2);
      py = this.snap(y) - Math.floor(((params.h as number) ?? 13) / 2);
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
    if (kind === 'relay') {
      this.status('PLACED RELAY — LINK ITS INPUTS TO IT, THEN LINK IT TO ITS TARGET (K)');
    } else if (kind === 'plug') {
      this.status('PLACED PLUG — A BREAKABLE SEAL; OPTIONALLY LINK IT TO A DOOR/VALVE/RELAY (K)');
    } else if (TRIGGER_KINDS.has(kind) || kind === 'runeGlyph') {
      this.status('PLACED ' + kind.toUpperCase() + ' — LINK IT TO A DOOR/VALVE/RELAY (K)');
    }
    if (kind === 'decor' && typeof obj.params.spriteId === 'string') {
      this.status('PLACED ANIMATED DECOR — VISUAL ONLY, THE GRID DOESN\'T KNOW IT\'S THERE');
    }
    this.syncAssetPanels();
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
    /** What a given source may drive (mirrors validate.ts link rules). */
    const targetOk = (src: EditorObject, dst: EditorObject): boolean =>
      src.kind === 'runeGlyph'
        ? dst.kind === 'runeDoor'
        : dst.kind === 'door' ||
          dst.kind === 'valve' ||
          dst.kind === 'relay' ||
          (dst.kind === 'plug' && src.kind === 'relay');
    if (!this.linkFrom) {
      if (!isSource) {
        this.status('LINK STARTS AT A TRIGGER (PLATE/LEVER/BRAZIER/SCALE/BUOY/LATCH/SENSOR/CWEIGHT/PLUG/RELAY) OR RUNE GLYPH', true);
        return;
      }
      this.linkFrom = obj.id;
      this.select(obj.id);
      this.status(
        'NOW CLICK THE TARGET ' +
          (obj.kind === 'runeGlyph'
            ? 'RUNE DOOR'
            : obj.kind === 'relay'
              ? 'DOOR/VALVE/RELAY/PLUG'
              : 'DOOR/VALVE/RELAY'),
      );
      return;
    }
    const from = this.doc.objects.find((o) => o.id === this.linkFrom);
    if (!from) {
      this.linkFrom = null;
      return;
    }
    // A valid target COMPLETES the link (a relay is both source and target —
    // completion wins); clicking another pure source restarts from it.
    if (obj.id !== from.id && !targetOk(from, obj) && isSource) {
      this.linkFrom = obj.id;
      this.select(obj.id);
      this.status('LINK SOURCE CHANGED — NOW CLICK ITS TARGET');
      return;
    }
    if (obj.id === from.id || !targetOk(from, obj)) {
      this.status(
        `${from.kind.toUpperCase()} LINKS TO A ${from.kind === 'runeGlyph' ? 'RUNE DOOR' : 'DOOR/VALVE/RELAY'}`,
        true,
      );
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
    let bestD = Number.POSITIVE_INFINITY;
    for (const o of this.doc.objects) {
      if (!this.layerSelectableObj(o)) continue;
      const radius = this.previewPickRadius(o);
      const d = (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y);
      if (d <= radius * radius && d <= bestD) {
        bestD = d;
        best = { id: o.id, target: o, isLight: false };
      }
    }
    for (const l of this.doc.lights) {
      if (!this.lightSelectable(l)) continue;
      const d = (l.x - x) * (l.x - x) + (l.y - y) * (l.y - y);
      if (d <= PICK_RADIUS * PICK_RADIUS && d <= bestD) {
        bestD = d;
        best = { id: l.id, target: l, isLight: true };
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
    this.syncStructurePanels();
  }

  private selectMany(ids: readonly string[]): void {
    const clean = ids.filter(
      (id) =>
        this.doc.objects.some((object) => object.id === id && this.layerSelectableObj(object)) ||
        this.doc.lights.some((light) => light.id === id && this.lightSelectable(light)),
    );
    this.selectedIds = new Set(clean);
    this.selectedId = clean[0] ?? null;
    this.syncMarkers();
    this.renderInspector();
    this.syncStructurePanels();
    if (clean.length > 1) this.status(`${clean.length} SELECTED`);
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
      if (Array.isArray(clone.params.patrol)) {
        clone.params.patrol = (clone.params.patrol as Array<[number, number]>).map(
          ([wx, wy]) => [wx + 8, wy + 8],
        );
      }
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
      if (this.selectedIds.has(o.id) && !o.locked && this.layerSelectableObj(o))
        targets.push({ t: o, isLight: false });
    }
    for (const l of this.doc.lights) {
      if (this.selectedIds.has(l.id) && this.lightSelectable(l)) targets.push({ t: l, isLight: true });
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
        // deep-clone per target so pasted arrays (patrol routes) never alias
        const own = value !== null && typeof value === 'object' ? (JSON.parse(JSON.stringify(value)) as unknown) : value;
        edits.push(editParamCmd(o, key, own));
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

  private setBuilderZoom(value: number, silent = false): void {
    this.zoomTarget = Math.max(0.5, Math.min(4, value));
    this.ctx.camera.zoomLock = this.zoomTarget;
    if (!silent) this.status(`ZOOM ${this.zoomTarget.toFixed(2)}x`);
  }

  private fitAuthoredBounds(): void {
    const bounds = this.authoredBounds();
    if (!bounds) {
      this.ctx.camera.snapTo(WIDTH / 2, HEIGHT / 2);
      this.setBuilderZoom(1, true);
      this.status('FIT WORLD CENTER');
      return;
    }
    const pad = 48;
    const w = Math.max(1, bounds.x1 - bounds.x0 + pad * 2);
    const h = Math.max(1, bounds.y1 - bounds.y0 + pad * 2);
    const zoom = Math.max(0.5, Math.min(4, Math.min(VIEW_W / w, VIEW_H / h)));
    this.ctx.camera.snapTo((bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2);
    this.setBuilderZoom(zoom, true);
    this.status(`FITTED AUTHORED BOUNDS (${Math.round(bounds.x1 - bounds.x0)} x ${Math.round(bounds.y1 - bounds.y0)})`);
  }

  private centerOnSpawn(): void {
    const spawn = this.doc.objects.find((o) => o.kind === 'spawn' && !o.hidden);
    if (!spawn) {
      this.status('NO AUTHORED SPAWN TO CENTER', true);
      return;
    }
    this.select(spawn.id);
    this.ctx.camera.snapTo(spawn.x, spawn.y);
    this.status('CENTERED ON SPAWN');
  }

  private centerActiveValidationIssue(): void {
    const issue =
      (this.activeValidationIssueIndex !== null ? this.lastIssues[this.activeValidationIssueIndex] : null) ??
      this.lastIssues.find((item) => item.severity === 'error') ??
      this.lastIssues[0];
    if (!issue) {
      this.status('NO VALIDATION ISSUE TO CENTER', true);
      return;
    }
    if (issue.objId) {
      this.select(issue.objId);
      this.frameSelection();
      return;
    }
    if (issue.location) {
      this.ctx.camera.snapTo(issue.location.x, issue.location.y);
      this.status('CENTERED VALIDATION ISSUE');
      return;
    }
    this.status('VALIDATION ISSUE HAS NO LOCATION', true);
  }

  private authoredBounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    let bounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
    const addPoint = (x: number, y: number): void => {
      if (!bounds) bounds = { x0: x, y0: y, x1: x, y1: y };
      else {
        bounds.x0 = Math.min(bounds.x0, x);
        bounds.y0 = Math.min(bounds.y0, y);
        bounds.x1 = Math.max(bounds.x1, x);
        bounds.y1 = Math.max(bounds.y1, y);
      }
    };
    const addBox = (x0: number, y0: number, x1: number, y1: number): void => {
      addPoint(x0, y0);
      addPoint(x1, y1);
    };
    for (const object of this.doc.objects) {
      if (object.hidden) continue;
      const footprint = objectFootprint(object);
      if (footprint) addBox(footprint.x0, footprint.y0, footprint.x1, footprint.y1);
      else addPoint(object.x, object.y);
    }
    for (const light of this.doc.lights) {
      if (light.hidden) continue;
      addBox(light.x - light.radius, light.y - light.radius, light.x + light.radius, light.y + light.radius);
    }
    if (this.region) addBox(this.region.x0, this.region.y0, this.region.x1, this.region.y1);
    return bounds;
  }

  private selectedLight(): EditorLight | null {
    return this.doc.lights.find((l) => l.id === this.selectedId) ?? null;
  }

  private async deleteSelection(): Promise<void> {
    const dels: Command[] = [];
    let lockedSkipped = 0;
    let deletesSpawn = false;
    for (const o of this.doc.objects) {
      if (!this.selectedIds.has(o.id)) continue;
      if (o.locked) lockedSkipped++;
      else {
        if (o.kind === 'spawn') deletesSpawn = true;
        dels.push(deleteObjectCmd(o));
      }
    }
    for (const l of this.doc.lights) {
      if (!this.selectedIds.has(l.id)) continue;
      if (l.locked) lockedSkipped++;
      else {
        if (this.soloLightId === l.id) this.soloLightId = null;
        this.mutedLightIds.delete(l.id);
        dels.push(deleteLightCmd(l));
      }
    }
    if (dels.length === 0) {
      if (lockedSkipped > 0) this.status('LOCKED — UNLOCK TO DELETE', true);
      return;
    }
    if (
      (dels.length > 1 || deletesSpawn) &&
      !(await appDialog.confirm(
        deletesSpawn
          ? `Delete the spawn${dels.length > 1 ? ` and ${dels.length - 1} other item(s)` : ''}?`
          : `Delete ${dels.length} selected items?`,
        {
          title: 'Delete Selection',
          confirmText: 'Delete',
          tone: 'danger',
        },
      ))
    ) {
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
    this.el('bp-proc-btn').addEventListener('click', () => this.runUiCommand('builder.proceduralPanel'));
    this.el('bp-proc-close').addEventListener('click', () => this.closeSidePanel('proc'));
    this.el('bp-world-btn').addEventListener('click', () => this.runUiCommand('builder.worldPanel'));
    this.el('bp-world-map-btn').addEventListener('click', () => this.runUiCommand('builder.virtualWorldPanel'));
    this.el('bw-close').addEventListener('click', () => this.closeSidePanel('world'));
    this.el('bp-global-btn').addEventListener('click', () => this.runUiCommand('builder.globalControlsPanel'));
    this.el('bgl-close').addEventListener('click', () => this.closeSidePanel('global'));
    this.el('bp-postfx-btn').addEventListener('click', () => this.runUiCommand('builder.postProcessingPanel'));
    this.el('bf-close').addEventListener('click', () => this.closeSidePanel('post'));
    this.el('bp-mat-btn').addEventListener('click', () => this.runUiCommand('builder.materialPanel'));
    this.el('bm-close').addEventListener('click', () => this.closeSidePanel('mat'));
    this.el('bp-dice').addEventListener('click', () => {
      this.el<HTMLInputElement>('bp-seed').value = String(1 + Math.floor(Math.random() * 999999));
    });
    this.el('bp-density').addEventListener('input', () => {
      this.el('bp-density-val').textContent = this.el<HTMLInputElement>('bp-density').value;
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

  /* ---------- dockable parameter panels (proc / world / material) ---------- */

  private static readonly SIDE_PANELS = {
    proc: 'builder-proc',
    world: 'builder-world',
    mat: 'builder-matparams',
    global: 'builder-global',
    post: 'builder-postfx',
  } as const;

  private openSidePanel(which: BuilderSidePanel | null): void {
    if (which === null) {
      for (const id of Object.values(Builder.SIDE_PANELS)) {
        this.el<HTMLDivElement>(id).style.display = 'none';
        this.setWorkspacePanelOpen(id, false);
      }
      this.root.classList.remove('b-params-open');
      this.applyWorkspaceLayout();
      this.saveWorkspacePrefs();
      return;
    }
    const id = Builder.SIDE_PANELS[which];
    this.el<HTMLDivElement>(id).style.display = '';
    this.setWorkspacePanelOpen(id, true);
    this.root.classList.toggle(
      'b-params-open',
      Object.values(Builder.SIDE_PANELS).some((panelId) => this.workspaceLayout.panels.some((panel) => panel.id === panelId && panel.open)),
    );
    if (which === 'proc') this.syncProcPanel();
    else if (which === 'world') this.buildWorldPanel();
    else if (which === 'mat') this.buildMatPanel();
    else if (which === 'global') this.buildGlobalPanel();
    else if (which === 'post') this.buildPostProcessingPanel();
    this.applyWorkspaceLayout();
    this.saveWorkspacePrefs();
  }

  private toggleSidePanel(which: BuilderSidePanel): void {
    const id = Builder.SIDE_PANELS[which];
    const open = this.workspaceLayout.panels.some((panel) => panel.id === id && panel.open);
    if (open) return this.closeSidePanel(which);
    this.openSidePanel(which);
  }

  private closeSidePanel(which: BuilderSidePanel): void {
    const id = Builder.SIDE_PANELS[which];
    this.el<HTMLDivElement>(id).style.display = 'none';
    this.setWorkspacePanelOpen(id, false);
    this.root.classList.toggle(
      'b-params-open',
      Object.values(Builder.SIDE_PANELS).some((panelId) =>
        this.workspaceLayout.panels.some((panel) => panel.id === panelId && panel.open),
      ),
    );
    this.applyWorkspaceLayout();
    this.saveWorkspacePrefs();
  }

  private toggleWorkspacePanel(id: BuilderWorkspacePanelId): void {
    const open = this.workspaceLayout.panels.some((panel) => panel.id === id && panel.open);
    if (open) this.closeWorkspacePanel(id);
    else this.openWorkspacePanel(id);
  }

  private openWorkspacePanel(id: BuilderWorkspacePanelId): void {
    this.el<HTMLDivElement>(id).style.display = '';
    this.setWorkspacePanelOpen(id, true);
    this.applyWorkspaceLayout();
    this.renderWorkspacePanelContent(id);
    this.saveWorkspacePrefs();
  }

  private closeWorkspacePanel(id: BuilderWorkspacePanelId): void {
    if (id === 'builder-virtual-world') this.virtualWorldPanel?.cancel();
    this.el<HTMLDivElement>(id).style.display = 'none';
    this.setWorkspacePanelOpen(id, false);
    this.applyWorkspaceLayout();
    this.saveWorkspacePrefs();
  }

  private renderWorkspacePanelContent(id: BuilderWorkspacePanelId): void {
    if (id === 'builder-outliner') this.renderOutliner();
    else if (id === 'builder-link-graph') this.renderLinkGraph();
    else if (id === 'builder-assets') this.renderAssetBrowser();
    else if (id === 'builder-asset-details') this.renderAssetDetails();
    else if (id === 'builder-prefab-details') this.renderPrefabDetails();
    else this.renderVirtualWorldPanel();
  }

  private renderVirtualWorldPanel(): void {
    const panel = this.el<HTMLDivElement>('builder-virtual-world');
    this.virtualWorldPanel ??= new VirtualWorldPanel(panel, {
      getBaseSeed: () => this.ctx.state.worldSeed >>> 0,
      onClose: () => this.closeWorkspacePanel('builder-virtual-world'),
    });
    this.refreshPanelDragHandles(panel);
    this.virtualWorldPanel.refresh();
  }

  /** One live-param slider row (writes straight into the shared object). */
  private sliderRow(
    host: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string,
    onInput: (v: number) => void,
  ): void {
    const row = document.createElement('div');
    row.className = 'bw-row';
    row.innerHTML = `<div class="bw-label"><span>${label}</span><b>${fmt(value)}</b></div>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
    const input = row.querySelector('input')!;
    const out = row.querySelector('b')!;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      onInput(v);
      out.textContent = fmt(v);
    });
    host.appendChild(row);
  }

  private worldSection(host: HTMLElement, title: string): HTMLElement {
    const section = document.createElement('section');
    section.className = 'bw-section';
    const heading = document.createElement('div');
    heading.className = 'bw-title';
    heading.textContent = title;
    section.appendChild(heading);
    host.appendChild(section);
    return section;
  }

  private worldActionRow(host: HTMLElement, actions: Array<{ label: string; title?: string; run: () => void }>): void {
    const row = document.createElement('div');
    row.className = 'bw-actions';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      if (action.title) btn.title = action.title;
      btn.addEventListener('click', action.run);
      row.appendChild(btn);
    }
    host.appendChild(row);
  }

  private selectRow<T extends string>(
    host: HTMLElement,
    label: string,
    value: T,
    options: Array<{ value: T; label: string }>,
    onChange: (value: T) => void,
  ): void {
    const row = document.createElement('label');
    row.className = 'bw-field';
    const span = document.createElement('span');
    span.textContent = label;
    const select = document.createElement('select');
    for (const opt of options) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      select.appendChild(el);
    }
    select.value = value;
    select.addEventListener('change', () => onChange(select.value as T));
    row.append(span, select);
    host.appendChild(row);
  }

  private textRow(host: HTMLElement, label: string, value: string, onInput: (value: string) => void): void {
    const row = document.createElement('label');
    row.className = 'bw-field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.addEventListener('change', () => onInput(input.value));
    row.append(span, input);
    host.appendChild(row);
  }

  private checkboxRow(host: HTMLElement, label: string, value: boolean, onInput: (value: boolean) => void): void {
    const row = document.createElement('label');
    row.className = 'bw-field bw-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => onInput(input.checked));
    const span = document.createElement('span');
    span.textContent = label;
    row.append(input, span);
    host.appendChild(row);
  }

  private numberRow(
    host: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string,
    onInput: (v: number) => void,
  ): void {
    const row = document.createElement('div');
    row.className = 'bw-row bw-numrow';
    const lo = Math.min(min, value);
    const hi = Math.max(max, value);
    row.innerHTML = `<div class="bw-label"><span>${escHtml(label)}</span><b>${escHtml(fmt(value))}</b></div>
      <div class="bw-numline"><input type="range" min="${lo}" max="${hi}" step="${step}" value="${value}">
      <input type="number" min="${lo}" max="${hi}" step="${step}" value="${value}"></div>`;
    const range = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    const number = row.querySelector<HTMLInputElement>('input[type="number"]')!;
    const out = row.querySelector('b')!;
    const integral = step >= 1 && Number.isInteger(value);
    const apply = (raw: number, source: HTMLInputElement): void => {
      if (!Number.isFinite(raw)) return;
      const next = integral ? Math.round(raw) : raw;
      onInput(next);
      out.textContent = fmt(next);
      if (source !== range) range.value = String(next);
      if (source !== number) number.value = String(next);
    };
    range.addEventListener('input', () => apply(Number(range.value), range));
    number.addEventListener('change', () => apply(Number(number.value), number));
    host.appendChild(row);
  }

  private worldSeedRow(host: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'bw-field bw-seed';
    row.innerHTML = `<span>seed</span><input type="number" min="0" max="4294967295" step="1"><button type="button">REROLL</button>`;
    const input = row.querySelector<HTMLInputElement>('input')!;
    const reroll = row.querySelector<HTMLButtonElement>('button')!;
    input.value = String(this.ctx.state.worldSeed >>> 0);
    input.addEventListener('change', () => {
      const next = Number(input.value);
      if (Number.isFinite(next)) this.ctx.state.worldSeed = next >>> 0;
      input.value = String(this.ctx.state.worldSeed >>> 0);
    });
    reroll.addEventListener('click', () => {
      this.ctx.state.worldSeed = randomSeed();
      input.value = String(this.ctx.state.worldSeed >>> 0);
    });
    host.appendChild(row);
  }

  private buildWorldPanel(): void {
    const host = this.el<HTMLDivElement>('bw-controls');
    host.innerHTML = '';
    const levels = this.levelEntries();
    if (!this.worldgenLevelId) this.worldgenLevelId = this.levelIdForBiome(this.doc.biome);
    const levelSection = this.worldSection(host, 'TARGET');
    this.selectRow(
      levelSection,
      'level',
      this.worldgenLevelId ?? 'custom',
      [
        ...levels.map((level) => ({
          value: level.id,
          label: `${level.branch ? 'BR' : `D${level.depth}`} ${level.name}`,
        })),
        { value: 'custom', label: 'CUSTOM DOCUMENT' },
      ],
      (levelId) => {
        this.worldgenLevelId = levelId === 'custom' ? null : levelId;
        const level = levelId === 'custom' ? null : LEVELS[levelId];
        if (level) {
          this.doc.biome = level.biome;
          this.ctx.state.currentBiome = level.biome;
          this.el<HTMLSelectElement>('b-biome').value = level.biome;
        }
        this.buildWorldPanel();
      },
    );
    this.selectRow(
      levelSection,
      'biome',
      this.doc.biome,
      BIOME_IDS.map((id) => ({ value: id, label: BIOME_DEFS[id].name })),
      (biome) => {
        this.doc.biome = biome;
        this.ctx.state.currentBiome = biome;
        this.worldgenLevelId = this.levelIdForBiome(biome);
        this.el<HTMLSelectElement>('b-biome').value = biome;
        this.buildWorldPanel();
      },
    );
    this.worldSeedRow(levelSection);
    this.worldActionRow(levelSection, [
      { label: 'GENERATE', title: 'Regenerate with the current seed', run: () => void this.generateConfiguredWorld(false) },
      { label: 'ROLL + GENERATE', title: 'Reroll seed, then regenerate', run: () => void this.generateConfiguredWorld(true) },
      { label: 'CAPTURE', title: 'Capture live terrain into this Builder document', run: () => this.captureTerrain() },
      { label: 'CLEAR', title: 'Clear the live terrain', run: () => void this.guardedWorldGen('clear') },
    ]);

    const gen = GEN[this.doc.biome] ?? GEN.earthen;
    const skeletonSection = this.worldSection(host, 'SKELETON');
    this.selectRow(
      skeletonSection,
      'kind',
      gen.skeleton.kind,
      SKELETON_KINDS.map((kind) => ({ value: kind, label: this.humanizeParamKey(kind) })),
      (kind) => {
        gen.skeleton = defaultSkeletonSpec(kind);
        this.buildWorldPanel();
      },
    );
    this.editableTree(skeletonSection, gen.skeleton.params, 'params', (next) => {
      gen.skeleton.params = next as SkeletonSpec['params'];
    });

    const decoration = this.worldSection(host, 'DECORATION');
    this.editableTree(decoration, gen.goldPockets, 'goldPockets', (next) => {
      gen.goldPockets = Number(next);
    });
    this.editableTree(decoration, gen.goldTriesCap, 'goldTriesCap', (next) => {
      gen.goldTriesCap = Number(next);
    });
    this.editableTree(decoration, gen.seedPockets, 'seedPockets', (next) => {
      gen.seedPockets = Number(next);
    });
    this.editableTree(decoration, gen.prefabs, 'prefabs', (next) => {
      gen.prefabs = next as typeof gen.prefabs;
    });
    this.editableTree(decoration, gen.machines, 'machines', (next) => {
      gen.machines = next as typeof gen.machines;
    });

    const biomeSection = this.worldSection(host, 'BIOME SURFACE');
    this.editBiomeControls(biomeSection, this.doc.biome);

    const backdropSection = this.worldSection(host, 'BACKDROP GRADE');
    this.editBackdropGradeControls(backdropSection);
    this.worldActionRow(backdropSection, [
      { label: 'OPEN BACKDROP', title: 'Open the visual parallax editor', run: () => this.openBackdropPreview() },
    ]);

    const simSection = this.worldSection(host, 'LIVE SIM');
    const g = this.ctx.params.global;
    this.sliderRow(simSection, 'Simulation Speed', g.simSpeed, 0, 2, 0.1, (v) => v.toFixed(1) + 'x', (v) => {
      g.simSpeed = v;
    });
    this.sliderRow(simSection, 'Max Brightness', g.maxBrightness, 1, 10, 0.5, (v) => v.toFixed(1), (v) => {
      g.maxBrightness = v;
    });
    this.sliderRow(simSection, 'Ambient Light', g.ambient, 0.02, 0.5, 0.02, (v) => v.toFixed(2), (v) => {
      g.ambient = v;
    });
    this.sliderRow(simSection, 'Brush Radius', this.ctx.state.brushSize, 1, 24, 1, (v) => v + 'px', (v) => {
      this.ctx.state.brushSize = v;
    });
  }

  private buildGlobalPanel(): void {
    const host = this.el<HTMLDivElement>('bg-controls');
    host.innerHTML = '';
    const g = this.ctx.params.global;
    const simSection = this.worldSection(host, 'SIMULATION');
    this.sliderRow(simSection, 'Simulation Speed', g.simSpeed, 0, 2, 0.1, (v) => v.toFixed(1) + 'x', (v) => {
      g.simSpeed = v;
    });
    this.sliderRow(simSection, 'Max Brightness', g.maxBrightness, 1, 10, 0.5, (v) => v.toFixed(1), (v) => {
      g.maxBrightness = v;
    });
    this.sliderRow(simSection, 'Ambient Light', g.ambient, 0.02, 0.5, 0.02, (v) => v.toFixed(2), (v) => {
      g.ambient = v;
    });
    this.sliderRow(simSection, 'Brush Radius', this.ctx.state.brushSize, 1, 24, 1, (v) => v + 'px', (v) => {
      this.ctx.state.brushSize = v;
      this.el<HTMLInputElement>('bp-brush').value = String(v);
      this.el('bp-brush-val').textContent = String(v);
    });

    const previewSection = this.worldSection(host, 'WAND PREVIEW');
    this.checkboxRow(previewSection, 'Cursor Wand Light', this.wandLightPreviewOn, (value) => {
      this.wandLightPreviewOn = value;
      this.syncWandLightPreview();
      this.syncWandLightPreviewButton();
    });
    const wand = this.ctx.state.wandLight;
    const wandSection = this.worldSection(host, 'WAND LIGHT');
    this.numberRow(wandSection, 'Intensity', wand.intensity, 0, 10, 0.05, (v) => v.toFixed(2), (v) => {
      wand.intensity = v;
    });
    this.numberRow(wandSection, 'Radius', wand.radius, 16, 240, 1, (v) => Math.round(v) + 'px', (v) => {
      wand.radius = Math.max(1, v);
    });
    this.numberRow(wandSection, 'Red', wand.r, 0, 1.5, 0.01, (v) => v.toFixed(2), (v) => {
      wand.r = v;
    });
    this.numberRow(wandSection, 'Green', wand.g, 0, 1.5, 0.01, (v) => v.toFixed(2), (v) => {
      wand.g = v;
    });
    this.numberRow(wandSection, 'Blue', wand.b, 0, 1.5, 0.01, (v) => v.toFixed(2), (v) => {
      wand.b = v;
    });
    this.numberRow(wandSection, 'Flicker', wand.flicker, 0, 0.6, 0.01, (v) => v.toFixed(2), (v) => {
      wand.flicker = v;
    });
    this.numberRow(wandSection, 'Player Fill R', wand.fillR, 0, 1.5, 0.01, (v) => v.toFixed(2), (v) => {
      wand.fillR = v;
    });
    this.numberRow(wandSection, 'Player Fill G', wand.fillG, 0, 1.5, 0.01, (v) => v.toFixed(2), (v) => {
      wand.fillG = v;
    });
    this.numberRow(wandSection, 'Player Fill B', wand.fillB, 0, 1.5, 0.01, (v) => v.toFixed(2), (v) => {
      wand.fillB = v;
    });

    const torchSection = this.worldSection(host, 'TORCH WAND');
    this.numberRow(torchSection, 'Intensity', wand.torchIntensity, 0, 14, 0.05, (v) => v.toFixed(2), (v) => {
      wand.torchIntensity = v;
    });
    this.numberRow(torchSection, 'Radius', wand.torchRadius, 16, 320, 1, (v) => Math.round(v) + 'px', (v) => {
      wand.torchRadius = Math.max(1, v);
    });
    this.numberRow(torchSection, 'Min Flicker', wand.torchMinFlicker, 0.5, 1.5, 0.01, (v) => v.toFixed(2), (v) => {
      wand.torchMinFlicker = v;
    });
    this.worldActionRow(torchSection, [
      {
        label: 'RESET WAND',
        title: 'Restore the current shipped wand-light values',
        run: () => {
          Object.assign(this.ctx.state.wandLight, createDefaultWandLightSettings());
          this.buildGlobalPanel();
          this.status('WAND LIGHT RESET');
        },
      },
    ]);
  }

  private buildPostProcessingPanel(): void {
    const host = this.el<HTMLDivElement>('bf-controls');
    host.innerHTML = '';
    const post = this.ctx.state.postFx;
    const section = this.worldSection(host, 'COMPOSITION');
    this.checkboxRow(section, 'Post FX', post.enabled, (value) => {
      post.enabled = value;
    });
    this.checkboxRow(section, 'GPU Compose', post.gpuCompose, (value) => {
      post.gpuCompose = value;
      this.syncGpuComposeButton();
    });
    this.numberRow(section, 'Exposure', post.exposure, 0.5, 1.8, 0.05, (v) => v.toFixed(2), (v) => {
      post.exposure = v;
    });

    const bloom = this.worldSection(host, 'BLOOM');
    this.checkboxRow(bloom, 'Bloom', post.bloomEnabled, (value) => {
      post.bloomEnabled = value;
    });
    this.numberRow(bloom, 'Strength', post.bloomStrength, 0, 3, 0.05, (v) => v.toFixed(2), (v) => {
      post.bloomStrength = v;
    });
    this.numberRow(bloom, 'Radius', post.bloomRadius, 0, 1, 0.01, (v) => v.toFixed(2), (v) => {
      post.bloomRadius = v;
    });
    this.numberRow(bloom, 'Threshold', post.bloomThreshold, 0, 2, 0.05, (v) => v.toFixed(2), (v) => {
      post.bloomThreshold = v;
    });
    this.numberRow(bloom, 'Bloom Kick', post.bloomKickScale, 0, 3, 0.05, (v) => v.toFixed(2) + 'x', (v) => {
      post.bloomKickScale = v;
    });

    const lens = this.worldSection(host, 'LENS');
    this.checkboxRow(lens, 'Lens Layer', post.lensEnabled, (value) => {
      post.lensEnabled = value;
    });
    this.numberRow(lens, 'Base Split', post.aberration, 0, 0.004, 0.0001, (v) => v.toFixed(4), (v) => {
      post.aberration = v;
    });
    this.numberRow(lens, 'Blast Split', post.aberrationKick, 0, 0.02, 0.0005, (v) => v.toFixed(4), (v) => {
      post.aberrationKick = v;
    });
    this.numberRow(lens, 'Shake Split', post.shakeAberration, 0, 0.15, 0.005, (v) => v.toFixed(3), (v) => {
      post.shakeAberration = v;
    });
    this.numberRow(lens, 'Film Grain', post.grain, 0, 0.12, 0.002, (v) => v.toFixed(3), (v) => {
      post.grain = v;
    });
    this.numberRow(lens, 'Hurt Pulse', post.hurtPulse, 0, 2, 0.05, (v) => v.toFixed(2) + 'x', (v) => {
      post.hurtPulse = v;
    });
    this.worldActionRow(lens, [
      {
        label: 'RESET POST FX',
        title: 'Restore default post-processing settings',
        run: () => {
          Object.assign(post, createDefaultPostFxSettings());
          this.syncGpuComposeButton();
          this.buildPostProcessingPanel();
          this.status('POST FX RESET');
        },
      },
    ]);
  }

  private editBiomeControls(host: HTMLElement, biomeId: BiomeId): void {
    const biome = BIOME_DEFS[biomeId];
    this.textRow(host, 'name', biome.name, (value) => {
      biome.name = value.trim() || biome.name;
      this.buildWorldPanel();
    });
    this.selectRow(
      host,
      'crown',
      biome.crown,
      [
        { value: 'moss', label: 'moss' },
        { value: 'frost', label: 'frost' },
        { value: 'ember', label: 'ember' },
      ],
      (value) => {
        biome.crown = value;
      },
    );
    this.editableTree(host, biome.bands, 'bands', (next) => {
      biome.bands = next as typeof biome.bands;
    });
    for (const key of ['flowerChance', 'pools', 'seedsOilBias', 'beams', 'fires', 'flood', 'iceClusters'] as const) {
      this.editableTree(host, biome[key], key, (next) => {
        biome[key] = Number(next);
      });
    }
  }

  private editBackdropGradeControls(host: HTMLElement): void {
    const settings = this.ensureDocBackdrop();
    const grade = settings.grade;
    const update = (mutate: (grade: typeof settings.grade) => void): void => {
      const backdrop = this.ensureDocBackdrop();
      mutate(backdrop.grade);
      this.ctx.params.backdrop = backdrop;
      this.backdropDirty = true;
    };
    this.numberRow(host, 'Exposure', grade.exposure, -3, 2, 0.01, (v) => v.toFixed(2), (v) => {
      update((live) => {
        live.exposure = clampBackdropExposure(v);
      });
    });
    this.numberRow(host, 'Brightness', grade.brightness, -0.5, 0.5, 0.005, (v) => v.toFixed(3), (v) => {
      update((live) => {
        live.brightness = clampBackdropBrightness(v);
      });
    });
    this.numberRow(host, 'Contrast', grade.contrast, 0.25, 2.5, 0.01, (v) => v.toFixed(2), (v) => {
      update((live) => {
        live.contrast = clampBackdropContrast(v);
      });
    });
    this.numberRow(host, 'Gamma', grade.gamma, 0.35, 3, 0.01, (v) => v.toFixed(2), (v) => {
      update((live) => {
        live.gamma = clampBackdropGamma(v);
      });
    });
    this.numberRow(host, 'Saturation', grade.saturation, 0, 2.5, 0.01, (v) => v.toFixed(2), (v) => {
      update((live) => {
        live.saturation = clampBackdropSaturation(v);
      });
    });
  }

  private editableTree(host: HTMLElement, value: unknown, label: string, onSet: (next: unknown) => void, depth = 0): void {
    if (typeof value === 'number') {
      const spec = this.inferNumberSpec(label, value);
      this.numberRow(host, this.humanizeParamKey(label), value, spec.min, spec.max, spec.step, spec.fmt, onSet);
      return;
    }
    if (typeof value === 'string') {
      if (label === 'kind') {
        this.selectRow(
          host,
          this.humanizeParamKey(label),
          value,
          [
            { value: 'abs', label: 'abs' },
            { value: 'hfrac', label: 'hfrac' },
            { value: 'floorOff', label: 'floorOff' },
          ],
          onSet,
        );
      } else {
        this.textRow(host, this.humanizeParamKey(label), value, onSet);
      }
      return;
    }
    if (typeof value === 'boolean') {
      this.checkboxRow(host, this.humanizeParamKey(label), value, onSet);
      return;
    }
    if (Array.isArray(value)) {
      if (value.every((item) => typeof item === 'number')) {
        value.forEach((item, index) => {
          this.editableTree(host, item, `${label} ${index + 1}`, (next) => {
            value[index] = Number(next);
            onSet(value);
          }, depth);
        });
        return;
      }
      if (value.every((item) => typeof item === 'string')) {
        this.textRow(host, this.humanizeParamKey(label), value.join(', '), (next) => {
          onSet(next.split(',').map((item) => item.trim()).filter(Boolean));
        });
        return;
      }
      value.forEach((item, index) => {
        this.editableGroup(host, `${label} ${index + 1}`, item, (next) => {
          value[index] = next;
          onSet(value);
        }, depth);
      });
      return;
    }
    if (value && typeof value === 'object') {
      this.editableGroup(host, label, value, onSet, depth);
    }
  }

  private editableGroup(host: HTMLElement, label: string, value: unknown, onSet: (next: unknown) => void, depth: number): void {
    const details = document.createElement('details');
    details.className = 'bw-group';
    details.open = depth < 2;
    const summary = document.createElement('summary');
    summary.textContent = this.humanizeParamKey(label);
    details.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'bw-group-body';
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === 'function') continue;
      this.editableTree(body, child, key, (next) => {
        record[key] = next;
        onSet(record);
      }, depth + 1);
    }
    details.appendChild(body);
    host.appendChild(details);
  }

  private inferNumberSpec(
    key: string,
    value: number,
  ): { min: number; max: number; step: number; fmt: (v: number) => string } {
    const lower = key.toLowerCase();
    if (lower.includes('chance') || lower.includes('density') || lower.includes('frac') || lower === 'flood' || lower === 'threshold') {
      return { min: 0, max: 1, step: 0.01, fmt: (v) => v.toFixed(2) };
    }
    if (lower.includes('freq') || lower === 'scalex' || lower === 'scaley') {
      return { min: 0, max: Math.max(0.1, value * 3), step: 0.0005, fmt: (v) => v.toFixed(4) };
    }
    if (lower.includes('triescap')) return { min: 0, max: 60000, step: 100, fmt: (v) => String(Math.round(v)) };
    if (Number.isInteger(value)) {
      const max = Math.max(10, value * 2 + 20);
      return { min: 0, max, step: 1, fmt: (v) => String(Math.round(v)) };
    }
    const span = Math.max(1, Math.abs(value) * 2);
    return { min: Math.min(0, value - span), max: value + span, step: 0.05, fmt: (v) => v.toFixed(2) };
  }

  private humanizeParamKey(key: string): string {
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** MATERIAL window: tuning sliders for the armed material (same live
   *  params and ranges as the Sandbox inspector — paramSliderSpec). */
  private buildMatPanel(): void {
    const host = this.el<HTMLDivElement>('bm-controls');
    host.innerHTML = '';
    const state = this.ctx.state;
    if (state.activeInputMode !== 'element') {
      host.innerHTML = '<div class="bp-hint">Pick a material swatch first.</div>';
      return;
    }
    const profile = this.ctx.params.materials[state.currentElement];
    if (!profile) {
      host.innerHTML = '<div class="bp-hint">This material has no tunable<br>parameters.</div>';
      return;
    }
    const title = document.createElement('div');
    title.className = 'bw-title';
    title.textContent = profile.name + ' Config';
    host.appendChild(title);
    const fields = profile as unknown as Record<string, number>;
    let rows = 0;
    for (const key of Object.keys(profile)) {
      if (key === 'name') continue;
      const spec = paramSliderSpec(key);
      const pct = key === 'bloomWeight';
      this.sliderRow(
        host,
        spec.label.replace(/([A-Z])/g, ' $1'),
        fields[key],
        spec.min,
        spec.max,
        spec.step,
        (v) => (pct ? (v * 100).toFixed(0) + '%' : String(v)),
        (v) => {
          fields[key] = v;
        },
      );
      rows++;
    }
    if (rows === 0) {
      const hint = document.createElement('div');
      hint.className = 'bp-hint';
      hint.innerHTML = 'Nothing tunable on this<br>material — it just is.';
      host.appendChild(hint);
    }
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
      ? this.regionMask
        ? `masked region (~${this.regionMaskCells} cells)`
        : `region ${this.region.x1 - this.region.x0 + 1}×${this.region.y1 - this.region.y0 + 1}`
      : 'whole level';
    const mat = this.ctx.params.materials[this.ctx.state.currentElement]?.name ?? '—';
    this.el<HTMLElement>('bp-material').textContent = def.usesMaterial ? mat : 'n/a';
  }

  private procRun(previewOnly: boolean): void {
    if (previewOnly && this.livePreviewActionBlocks('Preview')) return;
    if (this.settleBlocks() || this.floatingBlocks()) return;
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
      const result = runPass(
        def, w, rec, seed, region, density, material,
        this.region ? this.regionMask : null, this.doc.biome,
      );
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
    this.ensureCaptured();
    const w = this.ctx.world;
    const rec = new PatchRecorder(w);
    const result = runPass(
      def, w, rec, seed, region, density, material,
      this.region ? this.regionMask : null, this.doc.biome,
    );
    const patch = rec.finish();
    if (!patch) {
      this.procStatus('PASS CHANGED NOTHING');
      return;
    }
    if (previewOnly) {
      this.pendingPreview = {
        kind: 'pass',
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
      this.markTerrainDirty();
      this.procStatus(result.summary.toUpperCase() + ' — APPLIED');
      this.status('PASS APPLIED: ' + result.summary.toUpperCase());
    }
  }

  /** Commit a pending preview through the undo stack. */
  private applyPreview(): void {
    const p = this.pendingPreview;
    if (!p) return;
    this.pendingPreview = null;
    if (p.kind === 'pass') {
      this.cmds.run(
        compositeCmd('pass:' + p.passId, [
          paintTerrainCmd(this.ctx.world, p.before, p.after),
          this.passHistoryCmd(p.passId, p.seed, p.density, p.material, p.region),
        ]),
      );
      this.procStatus(p.summary.toUpperCase() + ' — APPLIED');
      this.status('PASS APPLIED: ' + p.summary.toUpperCase());
    } else {
      this.cmds.run(paintTerrainCmd(this.ctx.world, p.before, p.after));
      this.procStatus(p.summary.toUpperCase() + ' — APPLIED');
      this.status('REPAIR APPLIED: ' + p.summary.toUpperCase());
    }
    this.markTerrainDirty();
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
        this.setBuilderZoom(Math.min(4, Math.max(1, this.zoomTarget * (e.deltaY < 0 ? 1.2 : 1 / 1.2))), true);
      },
      { passive: false },
    );

    // Minimap: click (or drag) jumps the camera. Pointer capture keeps the
    // drag stream attached to the minimap instead of relying on window mousemove.
    let mmPointerId: number | null = null;
    const mmJump = (e: PointerEvent): void => {
      const r = this.minimap.getBoundingClientRect();
      const wx = ((e.clientX - r.left) / r.width) * WIDTH;
      const wy = ((e.clientY - r.top) / r.height) * HEIGHT;
      this.ctx.camera.snapTo(wx, wy);
      this.drawMinimap();
    };
    this.minimap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      mmPointerId = e.pointerId;
      this.minimap.setPointerCapture(e.pointerId);
      mmJump(e);
    });
    this.minimap.addEventListener('pointermove', (e) => {
      if (mmPointerId === e.pointerId) mmJump(e);
    });
    const releaseMinimapPointer = (e: PointerEvent): void => {
      if (mmPointerId !== e.pointerId) return;
      mmPointerId = null;
      if (this.minimap.hasPointerCapture(e.pointerId)) this.minimap.releasePointerCapture(e.pointerId);
    };
    this.minimap.addEventListener('pointerup', releaseMinimapPointer);
    this.minimap.addEventListener('pointercancel', releaseMinimapPointer);
    this.minimap.addEventListener('lostpointercapture', () => {
      mmPointerId = null;
    });

    this.el('bp-light-toggle').addEventListener('click', () => this.runUiCommand('builder.lightPreviewToggle'));
    this.el('bp-wand-light-toggle').addEventListener('click', () => this.runUiCommand('builder.wandLightPreviewToggle'));
    this.el('bp-wand-params-btn').addEventListener('click', () => this.runUiCommand('builder.globalControlsPanel'));

    this.el<HTMLInputElement>('bp-brush').addEventListener('input', () => {
      const v = Number(this.el<HTMLInputElement>('bp-brush').value);
      if (Number.isFinite(v)) this.ctx.state.brushSize = v;
      this.el('bp-brush-val').textContent = String(this.ctx.state.brushSize);
    });
    this.el('bp-gen-caves').addEventListener('click', () => this.runUiCommand('builder.generateCaves'));
    this.el('bp-gen-fort').addEventListener('click', () => this.runUiCommand('builder.spawnFortress'));
    this.el('bp-gen-clear').addEventListener('click', () => this.runUiCommand('builder.clearWorld'));

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

    const settle = this.el<HTMLButtonElement>('bp-settle');
    settle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      settle.setPointerCapture(e.pointerId);
      this.startSettle();
    });
    const releaseSettle = (e: PointerEvent): void => {
      this.stopSettleRun();
      if (settle.hasPointerCapture(e.pointerId)) settle.releasePointerCapture(e.pointerId);
    };
    settle.addEventListener('pointerup', releaseSettle);
    settle.addEventListener('pointercancel', releaseSettle);
    settle.addEventListener('lostpointercapture', () => this.stopSettleRun());
    settle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.startSettle();
    });
    window.addEventListener('mouseup', () => this.stopSettleRun());
    this.el('bp-settle-keep').addEventListener('click', () => this.finishSettle(true));
    this.el('bp-settle-revert').addEventListener('click', () => this.finishSettle(false));

    this.el('bp-overlay-btn').addEventListener('click', () => this.runUiCommand('builder.overlayCycle'));
    this.el('bp-snap-btn').addEventListener('click', () => this.runUiCommand('builder.snapCycle'));
    this.el('bp-sym-btn').addEventListener('click', () => this.runUiCommand('builder.symmetryCycle'));
    this.el('bp-assets-btn').addEventListener('click', () => this.runUiCommand('builder.assetsPanel'));
    this.el('bp-outliner-btn').addEventListener('click', () => this.runUiCommand('builder.outlinerPanel'));
    this.el('bp-link-graph-btn').addEventListener('click', () => this.runUiCommand('builder.linkGraphPanel'));

    this.el('b-share').addEventListener('click', () => this.runUiCommand('builder.share'));
    this.el('b-code').addEventListener('click', () => this.runUiCommand('builder.importCode'));
  }

  /* ===================== prefab library ===================== */

  private wirePrefabPanel(): void {
    this.renderPrefabPalette();
  }

  private refreshPrefabs(): void {
    this.renderPrefabPalette();
    this.syncAssetPanels();
    this.renderPrefabDetailsIfOpen();
  }

  private renderPrefabPalette(focusSearch = false): void {
    const host = this.el<HTMLDivElement>('bp-prefab-host');
    const previousScroll = host.querySelector<HTMLElement>('.ba-placement-list')?.scrollTop ?? this.prefabPaletteScrollTop;
    const database = this.createAssetDatabase();
    const records = database.query({
      text: this.prefabAssetQuery,
      kinds: ['prefab'],
      origins: ['library', 'built-in'],
      sort: 'name',
    });
    host.innerHTML = renderAssetPlacementPanel({
      title: 'Prefab Assets',
      query: this.prefabAssetQuery,
      searchPlaceholder: 'Search prefabs',
      emptyMessage: this.prefabs.length === 0
        ? 'Select a region, then capture it as a reusable prefab.'
        : 'No prefabs match the current search.',
      records,
      selectedId: this.prefabSelectedAssetId,
      armedId: this.armedPrefab ? this.prefabSelectedAssetId : null,
      actions: [
        { id: 'capture', elementId: 'bp-prefab-capture', label: 'Capture', title: 'Save the selected region as a prefab' },
        { id: 'import', elementId: 'bp-prefab-import', label: 'Import', title: 'Import .prefab.json or terrain .png files' },
        { id: 'region-png', elementId: 'bp-prefab-png', label: 'PNG', title: "Export the selected region's cells as a paintable PNG" },
        { id: 'palette', elementId: 'bp-prefab-gpl', label: '.GPL', title: 'Export the material palette as a .gpl swatch file' },
      ],
    });
    this.paintAssetPreviews(host, database);
    this.wireAssetPlacementPalette(host, records, {
      onSearch: (query) => {
        this.prefabAssetQuery = query;
        this.renderPrefabPalette(true);
      },
      onAction: (action) => this.runPrefabPaletteAction(action),
      onActivate: (record) => this.armPrefabAssetRecord(record),
      onDetails: (record) => this.openPaletteAssetDetails(record),
    });
    this.restorePlacementPaletteScroll(host, previousScroll, (scrollTop) => {
      this.prefabPaletteScrollTop = scrollTop;
    });
    this.restorePlacementPaletteFocus(host, 'prefab');
    if (focusSearch) this.focusPlacementPaletteSearch(host);
  }

  private runPrefabPaletteAction(action: string): void {
    if (action === 'capture') void this.capturePrefabFromRegion();
    else if (action === 'import') void this.importPrefabFiles();
    else if (action === 'region-png') void this.exportRegionPng();
    else if (action === 'palette') this.runUiCommand('builder.exportPalette');
  }

  private armPrefabAssetRecord(record: AssetRecord): void {
    if (record.kind !== 'prefab' || !isPrefabAsset(record.payload)) {
      this.status('PREFAB ASSET IS UNAVAILABLE', true);
      return;
    }
    if (this.armedPrefab?.id === record.payload.id && this.prefabSelectedAssetId === record.assetId) {
      this.armedPrefab = null;
      if (this.tool === 'stamp') this.setTool('select');
      this.refreshPrefabs();
      this.renderPrefabDetailsIfOpen();
      return;
    }
    const sameSelected = record.assetId === this.prefabSelectedAssetId;
    const prefab = sameSelected
      ? record.payload
      : this.selectPrefabAssetRecord(record, true);
    if (sameSelected) {
      if (this.isWorkspacePanelOpen('builder-prefab-details')) this.renderPrefabDetails();
      else this.openWorkspacePanel('builder-prefab-details');
    }
    const blocker = this.prefabPlacementBlocker(record);
    if (!prefab || blocker) {
      this.armedPrefab = null;
      if (this.tool === 'stamp') this.setTool('select');
      this.refreshPrefabs();
      this.status(blocker ?? 'PREFAB ASSET IS UNAVAILABLE', true);
      return;
    }
    this.armedPrefab = prefabVariant(prefab, this.prefabActiveVariant);
    this.setTool('stamp');
    this.refreshPrefabs();
    this.status(this.prefabPlacementWarning(record) ?? `PREFAB ARMED: "${prefab.name.toUpperCase()}" — Q ROTATES, E FLIPS, ESC DONE`);
  }

  private wireAssetPlacementPalette(
    host: HTMLElement,
    records: readonly AssetRecord[],
    hooks: {
      onSearch(query: string): void;
      onAction(action: string): void;
      onActivate(record: AssetRecord): void;
      onDetails(record: AssetRecord): void;
    },
  ): void {
    const recordsById = new Map(records.map((record) => [record.assetId, record]));
    host.querySelector<HTMLInputElement>('[data-asset-placement-search]')?.addEventListener('input', (event) => {
      hooks.onSearch((event.target as HTMLInputElement).value);
    });
    for (const button of host.querySelectorAll<HTMLButtonElement>('button[data-asset-placement-action]')) {
      button.addEventListener('click', () => hooks.onAction(button.dataset.assetPlacementAction ?? ''));
    }
    for (const button of host.querySelectorAll<HTMLButtonElement>('button[data-asset-placement-details]')) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const record = recordsById.get(button.dataset.assetPlacementDetails ?? '');
        if (record) hooks.onDetails(record);
      });
    }
    const rows = [...host.querySelectorAll<HTMLElement>('.ba-placement-row[data-asset-id]')];
    const palette = host.id === 'bp-sprite-host' ? 'sprite' : 'prefab';
    for (const row of rows) {
      const activate = (): void => {
        const record = recordsById.get(row.dataset.assetId ?? '');
        if (record) hooks.onActivate(record);
      };
      row.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, textarea, select, label, [contenteditable="true"]')) return;
        activate();
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const assetId = row.dataset.assetId;
          if (assetId) this.placementPaletteFocusTarget = { palette, assetId };
          activate();
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const index = rows.indexOf(row);
        rows[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus({ preventScroll: true });
      });
      row.addEventListener('dragstart', (event) => {
        const assetId = row.dataset.assetId;
        if (!assetId || !event.dataTransfer) return;
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-noita-asset-id', assetId);
      });
    }
  }

  private focusPlacementPaletteSearch(host: HTMLElement): void {
    const input = host.querySelector<HTMLInputElement>('[data-asset-placement-search]');
    if (!input) return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  private restorePlacementPaletteScroll(
    host: HTMLElement,
    scrollTop: number,
    onScroll: (scrollTop: number) => void,
  ): void {
    const list = host.querySelector<HTMLElement>('.ba-placement-list');
    if (!list) return;
    const restore = (): void => {
      list.scrollTop = Math.min(scrollTop, Math.max(0, list.scrollHeight - list.clientHeight));
    };
    restore();
    queueMicrotask(restore);
    requestAnimationFrame(restore);
    list.addEventListener('scroll', () => onScroll(list.scrollTop), { passive: true });
  }

  private restorePlacementPaletteFocus(host: HTMLElement, palette: 'prefab' | 'sprite'): void {
    const target = this.placementPaletteFocusTarget;
    if (!target || target.palette !== palette) return;
    this.placementPaletteFocusTarget = null;
    const focus = (): void => {
      host
        .querySelector<HTMLElement>(`.ba-placement-row[data-asset-id="${cssString(target.assetId)}"]`)
        ?.focus({ preventScroll: true });
    };
    queueMicrotask(focus);
    requestAnimationFrame(focus);
  }

  private openPaletteAssetDetails(record: AssetRecord): void {
    this.assetSelectedId = record.assetId;
    if (record.kind === 'prefab') {
      if (record.assetId !== this.prefabSelectedAssetId) this.selectPrefabAssetRecord(record, true);
      else if (this.isWorkspacePanelOpen('builder-prefab-details')) this.renderPrefabDetails();
      else this.openWorkspacePanel('builder-prefab-details');
      this.renderPrefabPalette();
    } else if (record.kind === 'sprite') {
      this.renderSpritePalette();
    }
    this.openWorkspacePanel('builder-asset-details');
    this.status(`ASSET DETAILS: ${record.name.toUpperCase()}`);
  }

  private async capturePrefabFromRegion(): Promise<void> {
    if (this.previewBlocks()) return;
    if (!this.region) {
      this.status('SELECT A REGION FIRST (R), THEN CAPTURE IT', true);
      return;
    }
    const raw = await appDialog.prompt(
      'Prefab name (#tags after the name):',
      'prefab ' + (this.prefabs.length + 1),
      { title: 'Capture Prefab', confirmText: 'Capture' },
    );
    if (raw === null) return;
    // "gate room #vault #mech" — words after # become tags
    const tags = [...raw.matchAll(/#([\w-]+)/g)].map((m) => m[1].toLowerCase());
    const name = raw.replace(/#[\w-]+/g, '').trim();
    const got = capturePrefab(this.ctx.world, this.region, this.doc, name, tags);
    if (!got) {
      this.status('REGION TOO LARGE FOR A PREFAB (MAX ~40K CELLS)', true);
      return;
    }
    if (!savePrefab(got.prefab)) this.status('PREFAB STORAGE FULL — USE EXPORT', true);
    this.prefabs.push(got.prefab);
    this.prefabs.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    this.selectPrefabAsset(got.prefab, 'library', this.isWorkspacePanelOpen('builder-prefab-details'));
    this.refreshPrefabs();
    const extras =
      got.prefab.objects.length > 0 || got.prefab.lights.length > 0
        ? ` +${got.prefab.objects.length} OBJ +${got.prefab.lights.length} LIGHT`
        : '';
    const dropped = got.droppedLinks > 0 ? ` — ${got.droppedLinks} OUTSIDE LINK(S) DROPPED` : '';
    this.status(
      `PREFAB "${got.prefab.name.toUpperCase()}" CAPTURED (${got.prefab.w}×${got.prefab.h}${extras})${dropped}`,
      got.droppedLinks > 0,
    );
  }

  /** Paste = ONE composite command: terrain patch (already live — the
   *  idempotent-do convention) plus object/link/light adds (NOT pre-applied;
   *  their do() does the push). Under symmetry the mirrored copies stamp
   *  TERRAIN ONLY into the same recorder — gameplay objects never duplicate
   *  silently. */
  private pastePrefabAt(p: PrefabDef, x: number, y: number): void {
    const rec = new PatchRecorder(this.ctx.world);
    const desiredX = this.snap(x);
    const desiredY = this.snap(y);
    const snap = this.snapPrefabPlacement(p, desiredX, desiredY);
    const cx = snap.x;
    const cy = snap.y;
    const out = pastePrefab(this.ctx.world, rec, p, cx, cy);
    let mirrored = 0;
    if (this.symmetry !== 'off') {
      const ax = this.symAxis();
      for (const [mx, my] of mirrorPoints(cx, cy, this.symmetry, ax.x, ax.y)) {
        if (mx === cx && my === cy) continue;
        // pick the prefab image matching the reflection (fx = horizontal
        // mirror; fy = vertical = mirrorH∘rot180; both = rot180)
        const fx = mx !== cx,
          fy = my !== cy;
        const image = fx && fy
          ? rotatePrefab(rotatePrefab(p))
          : fx
            ? mirrorPrefab(p)
            : mirrorPrefab(rotatePrefab(rotatePrefab(p)));
        pastePrefab(this.ctx.world, rec, image, mx, my); // records ignored
        mirrored++;
      }
    }
    const patch = rec.finish();
    const cmds: Command[] = [];
    if (patch) cmds.push(paintTerrainCmd(this.ctx.world, patch.before, patch.after));
    for (const o of out.objects) cmds.push(addObjectCmd(o));
    for (const l of out.links) cmds.push(addLinkCmd(l));
    for (const lt of out.lights) cmds.push(addLightCmd(lt));
    if (cmds.length === 0) return;
    this.cmds.run(compositeCmd(`paste "${p.name}"`, cmds));
    this.recordPlacedPrefabAnchors(p, cx, cy, out.region);
    if (patch) this.markTerrainDirty();
    if (out.objects.length > 0) {
      this.selectedIds = new Set(out.objects.map((o) => o.id));
      this.selectedId = out.objects[0].id;
      this.syncMarkers();
      this.renderInspector();
    }
    this.status(
      `PASTED "${p.name.toUpperCase()}"` +
        (snap.target ? ' — ANCHOR SNAP' : '') +
        (mirrored > 0 ? ` +${mirrored} MIRRORED (TERRAIN ONLY — OBJECTS NOT DUPLICATED)` : ''),
    );
    this.syncAssetPanels();
  }

  private snapPrefabPlacement(
    prefab: PrefabDef,
    desiredX: number,
    desiredY: number,
  ): { x: number; y: number; target: PlacedPrefabAnchor | null } {
    const anchors = prefab.anchors ?? [];
    if (anchors.length === 0) return { x: desiredX, y: desiredY, target: null };
    this.prunePlacedPrefabAnchors();
    if (this.placedPrefabAnchors.length === 0) return { x: desiredX, y: desiredY, target: null };

    const preferred = this.prefabSelectedAnchorId
      ? anchors.filter((anchor) => anchor.id === this.prefabSelectedAnchorId)
      : [];
    const candidates = preferred.length > 0 ? preferred : anchors;
    let best: { x: number; y: number; target: PlacedPrefabAnchor; dist: number } | null = null;
    const threshold = Math.max(16, this.snapStep > 0 ? this.snapStep * 2 : 16);
    for (const source of candidates) {
      const current = prefabAnchorWorldPoint(prefab, desiredX, desiredY, source);
      for (const target of this.placedPrefabAnchors) {
        if (!prefabAnchorsCompatible(source, target.anchor)) continue;
        const dx = target.x - current.x;
        const dy = target.y - current.y;
        const dist = Math.hypot(dx, dy);
        if (dist > threshold || (best && dist >= best.dist)) continue;
        const center = alignPrefabAnchorToWorldPoint(prefab, source, target);
        best = { x: center.x, y: center.y, target, dist };
      }
    }
    return best ? { x: best.x, y: best.y, target: best.target } : { x: desiredX, y: desiredY, target: null };
  }

  private recordPlacedPrefabAnchors(prefab: PrefabDef, centerX: number, centerY: number, region: Region): void {
    const anchors = prefab.anchors ?? [];
    if (anchors.length === 0) return;
    const terrainHash = this.prefabPlacementTerrainHash(region);
    for (const anchor of anchors) {
      const pos = prefabAnchorWorldPoint(prefab, centerX, centerY, anchor);
      this.placedPrefabAnchors.push({
        id: `${prefab.id}:${anchor.id}:${centerX}:${centerY}`,
        prefabId: prefab.id,
        anchor: { ...anchor },
        x: pos.x,
        y: pos.y,
        region: { ...region },
        terrainHash,
      });
    }
    if (this.placedPrefabAnchors.length > 256) {
      this.placedPrefabAnchors.splice(0, this.placedPrefabAnchors.length - 256);
    }
  }

  private prunePlacedPrefabAnchors(): void {
    this.placedPrefabAnchors = this.placedPrefabAnchors.filter((entry) =>
      this.prefabPlacementTerrainHash(entry.region) === entry.terrainHash,
    );
  }

  private clearPlacedPrefabAnchors(): void {
    this.placedPrefabAnchors = [];
  }

  private prefabPlacementTerrainHash(region: Region): number {
    const world = this.ctx.world;
    let hash = 2166136261 >>> 0;
    for (let y = region.y0; y <= region.y1; y++) {
      for (let x = region.x0; x <= region.x1; x++) {
        const value = world.inBounds(x, y) ? world.types[world.idx(x, y)] : 255;
        hash ^= value + 0x9e3779b9 + ((x & 0xffff) << 6) + ((y & 0xffff) << 1);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
    return hash >>> 0;
  }

  /* ---------------- PNG / JSON interchange ---------------- */

  private async exportPrefabPng(p: PrefabDef): Promise<void> {
    const blob = await rgbaToPngBlob(cellsToRgba(decodePrefabCells(p), p.w, p.h), p.w, p.h);
    download(blob, `${p.name || 'prefab'}.terrain.png`);
    this.status('TERRAIN PNG EXPORTED — EACH COLOR IS A MATERIAL (.GPL HAS THE SWATCHES)');
  }

  private async exportRegionPng(): Promise<void> {
    if (!this.region) {
      this.status('SELECT A REGION FIRST (R), THEN EXPORT IT', true);
      return;
    }
    const r = this.region;
    const w = r.x1 - r.x0 + 1,
      h = r.y1 - r.y0 + 1;
    const world = this.ctx.world;
    const cells = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (world.inBounds(r.x0 + x, r.y0 + y)) {
          cells[x + y * w] = world.types[world.idx(r.x0 + x, r.y0 + y)];
        }
      }
    }
    const blob = await rgbaToPngBlob(cellsToRgba(cells, w, h), w, h);
    download(blob, `region-${w}x${h}.terrain.png`);
    this.status('REGION PNG EXPORTED');
  }

  private async importPrefabFiles(): Promise<void> {
    const files = await pickFiles('.json,.png', true);
    for (const file of files) {
      if (/\.png$/i.test(file.name)) await this.importTerrainPng(file);
      else await this.importPrefabJson(file);
    }
  }

  private async importPrefabJson(file: File): Promise<void> {
    const result = importJsonAsset(
      { fileName: file.name, text: await file.text() },
      this.assetStore,
      this.createAssetDatabase(),
    );
    this.status(result.message, !result.ok || result.report.warnings.length > 0);
    this.prefabs = loadPrefabs();
    this.sprites = loadSprites();
    if (result.ok && result.report.decision !== 'duplicate') this.setAssetCollection('recent');
    this.refreshPrefabs();
    this.refreshSprites();
  }

  /**
   * Terrain PNG import. Clean colors land directly; stray colors open the
   * import report (SNAP ALL / CANCEL). If the ARMED prefab matches the PNG's
   * size, the pixels can update its terrain in place (objects/lights kept) —
   * the round-trip for "export PNG, repaint in Aseprite, re-import".
   */
  private async importTerrainPng(file: File): Promise<void> {
    let decoded: { rgba: Uint8ClampedArray; w: number; h: number };
    try {
      decoded = await pngBlobToRgba(file);
    } catch (err) {
      this.status(`"${file.name}": ${err instanceof Error ? err.message : 'NOT A PNG'}`, true);
      return;
    }
    if (decoded.w * decoded.h > 40000) {
      this.status(`"${file.name}" EXCEEDS THE 40K-CELL PREFAB CAP`, true);
      return;
    }
    const result = rgbaToCells(decoded.rgba, decoded.w, decoded.h);
    const accept = (cells: Uint8Array): void => {
      void this.acceptTerrainPng(file.name, cells, decoded.w, decoded.h);
    };
    if (result.unknown.length === 0) {
      if (result.semiTransparent > 0) {
        this.status(`${result.semiTransparent} SEMI-TRANSPARENT PIXEL(S) THRESHOLDED`, true);
      }
      await this.acceptTerrainPng(file.name, result.cells, decoded.w, decoded.h);
      return;
    }
    showImportReport(this.el<HTMLDivElement>('builder-import-host'), file.name, result, {
      onSnapAll: () => accept(snapUnknown(decoded.rgba, decoded.w, decoded.h)),
      onCancel: () => this.status('PNG IMPORT CANCELLED'),
    });
  }

  private async acceptTerrainPng(filename: string, cells: Uint8Array, w: number, h: number): Promise<void> {
    const armedLib = this.armedPrefab
      ? this.prefabs.find((x) => x.id === this.armedPrefab!.id)
      : undefined;
    if (
      armedLib &&
      armedLib.w === w &&
      armedLib.h === h &&
      (await appDialog.confirm(`Update the terrain of armed prefab "${armedLib.name}" from this PNG?`, {
        title: 'Update Prefab Terrain',
        confirmText: 'Update',
      }))
    ) {
      armedLib.rle = rleEncode(cells);
      savePrefab(armedLib);
      this.armedPrefab = structuredClone(armedLib);
      this.refreshPrefabs();
      this.status(`PREFAB "${armedLib.name.toUpperCase()}" TERRAIN UPDATED FROM PNG`);
      return;
    }
    const name = filename.replace(/\.(terrain\.)?png$/i, '') || 'imported';
    const prefab: PrefabDef = {
      v: 1,
      kind: 'prefab',
      id: freshId('prefab'),
      name,
      tags: ['terrain'],
      w,
      h,
      rle: rleEncode(cells),
      objects: [],
      links: [],
      lights: [],
      createdAt: new Date().toISOString(),
    };
    savePrefab(prefab);
    this.prefabs.push(prefab);
    this.prefabs.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    this.refreshPrefabs();
    this.status(`PNG IMPORTED AS PREFAB "${name.toUpperCase()}" (${w}×${h})`);
  }

  /** Minimal anchor authoring: edge-midpoint anchors from a dir list. */
  private async editPrefabAnchors(p: PrefabDef): Promise<void> {
    const current = (p.anchors ?? []).map((a) => a.dir).join(',');
    const raw = await appDialog.prompt(
      'Worldgen anchors as edge directions (n/s/e/w, comma-separated; empty clears).\n' +
        'Each becomes an opening at that edge midpoint for the cave tunneler:',
      current,
      { title: 'Prefab Anchors', confirmText: 'Apply' },
    );
    if (raw === null) return;
    const trimmed = raw.trim();
    const tokens = trimmed.length === 0 ? [] : trimmed.split(',').map((s) => s.trim().toLowerCase());
    const invalid = tokens.filter((s) => s !== 'n' && s !== 's' && s !== 'e' && s !== 'w');
    if (invalid.length > 0) {
      await appDialog.alert(`Unknown anchor direction: ${invalid.join(', ')}.\nUse n, s, e, or w.`, 'Invalid Anchors');
      return;
    }
    const dirs = tokens.filter(
      (s): s is PrefabAnchor['dir'] => s === 'n' || s === 's' || s === 'e' || s === 'w',
    );
    const at: Record<PrefabAnchor['dir'], { x: number; y: number }> = {
      n: { x: Math.floor(p.w / 2), y: 0 },
      s: { x: Math.floor(p.w / 2), y: p.h - 1 },
      w: { x: 0, y: Math.floor(p.h / 2) },
      e: { x: p.w - 1, y: Math.floor(p.h / 2) },
    };
    if (dirs.length === 0) delete p.anchors;
    else p.anchors = dirs.map((dir, n) => ({ id: 'a' + n, ...at[dir], dir, kind: 'open' }));
    savePrefab(p);
    if (this.armedPrefab?.id === p.id) this.armedPrefab = structuredClone(p);
    this.refreshPrefabs();
    this.status(dirs.length === 0 ? 'ANCHORS CLEARED' : `ANCHORS: ${dirs.join(', ').toUpperCase()}`);
  }

  /* ===================== sprite library (Aseprite pipeline) ===================== */

  private wireSpritePanel(): void {
    this.refreshSprites();
  }

  private refreshSprites(): void {
    this.renderSpritePalette();
    this.syncAssetPanels();
  }

  private renderSpritePalette(focusSearch = false): void {
    const host = this.el<HTMLDivElement>('bp-sprite-host');
    const previousScroll = host.querySelector<HTMLElement>('.ba-placement-list')?.scrollTop ?? this.spritePaletteScrollTop;
    const database = this.createAssetDatabase();
    const records = database.query({
      text: this.spriteAssetQuery,
      kinds: ['sprite'],
      origins: ['library', 'document-embedded'],
      sort: 'name',
    });
    const armedId = this.armedSprite
      ? records.find((record) => isSpriteAsset(record.payload) && record.payload.id === this.armedSprite?.id)?.assetId ?? null
      : null;
    host.innerHTML = renderAssetPlacementPanel({
      title: 'Sprite Assets',
      query: this.spriteAssetQuery,
      searchPlaceholder: 'Search sprites',
      emptyMessage: this.sprites.length === 0
        ? 'Import an Aseprite sheet JSON and PNG pair, or a lone PNG sprite sheet.'
        : 'No sprites match the current search.',
      records,
      selectedId: this.assetSelectedId,
      armedId,
      actions: [
        { id: 'import', elementId: 'bp-sprite-import', label: 'Import Sprite', title: 'Import animated sprites from Aseprite JSON and PNG, or slice a lone PNG' },
      ],
    });
    this.paintAssetPreviews(host, database);
    this.wireAssetPlacementPalette(host, records, {
      onSearch: (query) => {
        this.spriteAssetQuery = query;
        this.renderSpritePalette(true);
      },
      onAction: (action) => {
        if (action === 'import') void this.importSpriteFiles();
      },
      onActivate: (record) => this.armSpriteAssetRecord(record),
      onDetails: (record) => this.openPaletteAssetDetails(record),
    });
    this.restorePlacementPaletteScroll(host, previousScroll, (scrollTop) => {
      this.spritePaletteScrollTop = scrollTop;
    });
    this.restorePlacementPaletteFocus(host, 'sprite');
    if (focusSearch) this.focusPlacementPaletteSearch(host);
  }

  private armSpriteAssetRecord(record: AssetRecord): void {
    if (record.kind !== 'sprite' || !isSpriteAsset(record.payload)) {
      this.status('SPRITE ASSET IS UNAVAILABLE', true);
      return;
    }
    if (this.armedSprite?.id === record.payload.id) {
      this.armedSprite = null;
      if (this.tool === 'decor') this.setTool('select');
      this.refreshSprites();
      return;
    }
    this.assetSelectedId = record.assetId;
    this.armedSprite = record.payload;
    this.setTool('decor');
    this.refreshSprites();
    this.status(
      `SPRITE ARMED: "${record.payload.name.toUpperCase()}" — CLICK PLACES ANIMATED DECOR (VISUAL ONLY), ESC DONE`,
    );
  }

  private registerSprite(asset: SpriteAsset): void {
    if (!saveSprite(asset)) this.status('SPRITE STORAGE FULL — USE EXPORT', true);
    this.sprites = this.sprites.filter((x) => x.id !== asset.id);
    this.sprites.push(asset);
    this.sprites.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    this.spriteFrameCache.delete(asset.id);
    this.refreshSprites();
  }

  /**
   * IMPORT SPRITE: multi-select .json + .png. Pairs by basename (Aseprite's
   * `torch.json` + `torch.png`, and our own `torch.sprite.json` +
   * `torch.sheet.png` both reduce to "torch"); a lone PNG falls back to the
   * uniform-grid prompt.
   */
  private async importSpriteFiles(): Promise<void> {
    const files = await pickFiles('.json,.png', true);
    if (files.length === 0) return;
    const base = (n: string): string =>
      n.replace(/\.(png|json)$/i, '').replace(/\.(sheet|sprite)$/i, '');
    const jsons = new Map<string, File>();
    const pngs = new Map<string, File>();
    for (const f of files) {
      if (/\.png$/i.test(f.name)) pngs.set(base(f.name), f);
      else if (/\.json$/i.test(f.name)) jsons.set(base(f.name), f);
    }
    for (const [key, jf] of jsons) {
      const pf = pngs.get(key);
      if (!pf) {
        this.status(`"${jf.name}" HAS NO MATCHING SHEET PNG (PAIR BY BASENAME)`, true);
        continue;
      }
      pngs.delete(key);
      await this.importAsepritePair(key, jf, pf);
    }
    for (const pf of pngs.values()) await this.importLonePng(base(pf.name), pf);
  }

  private async importAsepritePair(name: string, jsonFile: File, pngFile: File): Promise<void> {
    try {
      const parsed = parseAsepriteJson(JSON.parse(await jsonFile.text()));
      const decoded = await pngBlobToRgba(pngFile);
      const asset = sliceSheet(decoded.rgba, decoded.w, decoded.h, parsed, name);
      this.registerSprite(asset);
      this.status(
        `SPRITE "${asset.name.toUpperCase()}" IMPORTED — ${asset.frames.length} FRAME(S)` +
          (asset.tags.length > 0 ? `, TAGS: ${asset.tags.map((t) => t.name).join(', ')}` : ''),
      );
    } catch (err) {
      this.status(
        `"${jsonFile.name}": ${err instanceof Error ? err.message : 'NOT AN ASEPRITE SHEET'}`,
        true,
      );
    }
  }

  /** A sheet PNG without JSON: ask for the uniform frame grid + fps. */
  private async importLonePng(name: string, pngFile: File): Promise<void> {
    try {
      const decoded = await pngBlobToRgba(pngFile);
      const guess = Math.min(decoded.h, decoded.w);
      const raw = await appDialog.prompt(
        `"${pngFile.name}" has no sheet JSON — slice a uniform grid.\n` +
          `Frame size and speed as WxH@FPS (sheet is ${decoded.w}x${decoded.h}):`,
        `${guess}x${decoded.h}@8`,
        { title: 'Slice Sprite Sheet', confirmText: 'Import' },
      );
      if (raw === null) return;
      const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*(?:@\s*(\d+))?\s*$/i.exec(raw);
      if (!m) {
        this.status('FRAME GRID NOT UNDERSTOOD — USE WxH@FPS, E.G. 16x16@8', true);
        return;
      }
      const asset = sliceUniformGrid(
        decoded.rgba,
        decoded.w,
        decoded.h,
        Number(m[1]),
        Number(m[2]),
        m[3] ? Number(m[3]) : 8,
        name,
      );
      this.registerSprite(asset);
      this.status(`SPRITE "${asset.name.toUpperCase()}" SLICED — ${asset.frames.length} FRAME(S)`);
    } catch (err) {
      this.status(
        `"${pngFile.name}": ${err instanceof Error ? err.message : 'NOT A PNG'}`,
        true,
      );
    }
  }

  /** EXPORT: name.sheet.png + name.sprite.json (Aseprite array form — both
   *  Aseprite and our own importer read it; the round-trip is closed). */
  private async exportSprite(s: SpriteAsset): Promise<void> {
    const sheet = spriteToSheet(s);
    const blob = await rgbaToPngBlob(sheet.rgba, sheet.w, sheet.h);
    download(blob, `${s.name || 'sprite'}.sheet.png`);
    downloadJson(sheet.json, `${s.name || 'sprite'}.sprite.json`);
    this.status('SPRITE EXPORTED — THE PNG OPENS IN ASEPRITE, THE JSON CARRIES TIMING/TAGS');
  }

  /** Merge a freshly imported/loaded document's embedded sprites into the
   *  local library (content mismatch re-ids; references remapped). */
  private adoptDocSprites(): void {
    const got = mergeEmbeddedSprites(this.doc);
    if (got.added > 0) {
      this.sprites = loadSprites();
      this.spriteFrameCache.clear();
      this.refreshSprites();
      this.status(
        `${got.added} EMBEDDED SPRITE(S) MERGED INTO THE LIBRARY` +
          (got.reIded > 0 ? ` (${got.reIded} RE-IDENTIFIED — CONTENT DIFFERED)` : ''),
      );
    }
  }

  private decorSpritePreviewCanvas(obj: EditorObject, frame: number): HTMLCanvasElement | null {
    const spriteId = typeof obj.params.spriteId === 'string' ? obj.params.spriteId : '';
    if (!spriteId) return null;
    const asset =
      this.sprites.find((s) => s.id === spriteId) ??
      this.doc.assets?.sprites.find((s) => s.id === spriteId) ??
      null;
    if (!asset) return null;
    const loop = resolveLoopTag(asset, typeof obj.params.loopTag === 'string' ? obj.params.loopTag : '');
    const n = loop.to - loop.from + 1;
    const steps = loop.dir === 'pingpong' && n > 1 ? 2 * n - 2 : n;
    const fps = paramNum(obj, 'fps', 0);
    const cadence = fps > 0 ? Math.max(1, Math.round(60 / Math.min(60, fps))) : 8;
    const k = this.sessionMode === 'live' ? Math.floor(frame / cadence) % Math.max(1, steps) : 0;
    const frameIndex =
      loop.dir === 'reverse'
        ? loop.to - k
        : loop.dir === 'pingpong' && k >= n
          ? loop.to - (k - n + 1)
          : loop.from + k;
    return this.spriteFrameCanvas(spriteId, frameIndex, obj.params.flipX === true);
  }

  /** Sprite-frame canvas for the build-mode overlay (cached; null = unresolvable). */
  private spriteFrameCanvas(spriteId: string, frameIndex = 0, flipX = false): HTMLCanvasElement | null {
    const key = `${spriteId}:${frameIndex}:${flipX ? 'flip' : 'normal'}`;
    const hit = this.spriteFrameCache.get(key);
    if (hit !== undefined) return hit;
    const asset =
      this.sprites.find((s) => s.id === spriteId) ??
      this.doc.assets?.sprites.find((s) => s.id === spriteId) ??
      null;
    let canvas: HTMLCanvasElement | null = null;
    if (asset) {
      canvas = document.createElement('canvas');
      canvas.width = asset.w;
      canvas.height = asset.h;
      const g = canvas.getContext('2d')!;
      const img = g.createImageData(asset.w, asset.h);
      const safeFrame = Math.max(0, Math.min(asset.frames.length - 1, frameIndex));
      img.data.set(decodeFramePx(asset.frames[safeFrame].px, asset.w, asset.h));
      if (flipX) {
        const src = document.createElement('canvas');
        src.width = asset.w;
        src.height = asset.h;
        src.getContext('2d')!.putImageData(img, 0, 0);
        g.translate(asset.w, 0);
        g.scale(-1, 1);
        g.drawImage(src, 0, 0);
      } else {
        g.putImageData(img, 0, 0);
      }
    }
    this.spriteFrameCache.set(key, canvas);
    return canvas;
  }

  /* ---------- editor layers (visibility/locking, editor-side only) ---------- */

  private wireLayers(): void {
    for (const row of this.root.querySelectorAll<HTMLDivElement>('.bp-layer')) {
      const family = row.dataset.layer as LayerFamily;
      row.querySelector('[data-vis]')?.addEventListener('click', () => {
        this.runUiCommand(`builder.layer.${family}.visibility`);
      });
      row.querySelector('[data-lock]')?.addEventListener('click', () => {
        this.runUiCommand(`builder.layer.${family}.lock`);
      });
    }
  }

  private toggleLayerVisibility(family: LayerFamily): void {
    if (this.layerHidden.has(family)) this.layerHidden.delete(family);
    else this.layerHidden.add(family);
    this.afterLayerStateChanged(`${layerLabel(family).toUpperCase()} LAYER ${this.layerHidden.has(family) ? 'HIDDEN' : 'VISIBLE'}`);
  }

  private toggleLayerLock(family: LayerFamily): void {
    if (this.layerLocked.has(family)) this.layerLocked.delete(family);
    else this.layerLocked.add(family);
    this.afterLayerStateChanged(`${layerLabel(family).toUpperCase()} LAYER ${this.layerLocked.has(family) ? 'LOCKED' : 'UNLOCKED'}`);
  }

  private afterLayerStateChanged(message: string): void {
    this.persistLayerStateToWorkspace();
    this.syncLayers();
    this.pruneSelection();
    this.syncMarkers();
    this.renderInspector();
    this.syncStructurePanels();
    this.saveWorkspacePrefs();
    this.status(message);
  }

  private syncLayers(): void {
    for (const row of this.root.querySelectorAll<HTMLDivElement>('.bp-layer')) {
      const family = row.dataset.layer as LayerFamily;
      row.classList.toggle('off', this.layerHidden.has(family));
      row.classList.toggle('locked', this.layerLocked.has(family));
    }
  }

  private restoreLayerStateFromWorkspace(): void {
    this.layerHidden.clear();
    this.layerLocked.clear();
    for (const family of LAYER_FAMILIES) {
      const state = this.workspaceLayout.layerState[family];
      if (state?.hidden) this.layerHidden.add(family);
      if (state?.locked) this.layerLocked.add(family);
    }
  }

  private persistLayerStateToWorkspace(): void {
    const layerState: WorkspaceLayout['layerState'] = {};
    for (const family of LAYER_FAMILIES) {
      layerState[family] = {
        hidden: this.layerHidden.has(family),
        locked: this.layerLocked.has(family),
      };
    }
    this.workspaceLayout.layerState = layerState;
  }

  /** Drop selection members that just became unselectable (layer hide/lock). */
  private pruneSelection(): void {
    const keep = new Set<string>();
    for (const o of this.doc.objects) {
      if (this.selectedIds.has(o.id) && this.layerSelectableObj(o)) keep.add(o.id);
    }
    for (const l of this.doc.lights) if (this.selectedIds.has(l.id) && this.lightSelectable(l)) keep.add(l.id);
    this.selectedIds = keep;
    if (this.selectedId && !keep.has(this.selectedId)) this.selectedId = [...keep][0] ?? null;
  }

  private layerVisibleObj(o: EditorObject): boolean {
    return !this.layerHidden.has(familyOf(o));
  }

  private layerSelectableObj(o: EditorObject): boolean {
    const f = familyOf(o);
    return !this.layerHidden.has(f) && !this.layerLocked.has(f) && !o.hidden && !o.locked;
  }

  private lightSelectable(light: EditorLight): boolean {
    return !this.layerHidden.has('lights') && !this.layerLocked.has('lights') && !light.hidden && !light.locked;
  }

  private previewPickRadius(o: EditorObject): number {
    if (o.kind === 'exitPortal' || o.kind === 'bossMarker') return 14;
    if (o.kind === 'enemy' || o.kind === 'pickup' || o.kind === 'waystone' || o.kind === 'cauldron') return 10;
    if (o.kind === 'spawn' || o.kind === 'hazardEmitter' || o.kind === 'relay' || o.kind === 'sensor') return 8;
    return PICK_RADIUS;
  }

  /* ---------- bake from playtest ---------- */

  /**
   * Re-apply the scars the last playtest left, on top of the document
   * terrain. With a region set this is a precise, UNDOABLE patch ("keep
   * that lava burn"); without one it replaces the whole world (no undo —
   * RESTORE remains the way back). Mind that scars include compiled
   * mechanism cells (doors, basins) — region bakes are the intended tool.
   */
  private async bakePlaytestScars(): Promise<void> {
    if (this.previewBlocks()) return;
    const scars = this.playtestScars;
    if (!scars) {
      this.status('NO PLAYTEST SCARS HELD — PLAYTEST FIRST, THEN BAKE ON RETURN', true);
      return;
    }
    const w = this.ctx.world;
    // Compiled mechanism cells must NOT fossilize into terrain: footprints,
    // the exit well's full cased shaft, and the footprint-less fixture
    // bodies (lever/brazier/latch/pedestal) are all excluded — the compiler
    // re-stamps them anyway; a deleted door must not leave a slab.
    const skip = bakeExclusionMask(this.doc.objects, w.width, w.height);
    if (this.region) {
      const rec = new PatchRecorder(w);
      const r = this.region;
      const rw = r.x1 - r.x0 + 1;
      let n = 0;
      for (let y = Math.max(0, r.y0); y <= Math.min(w.height - 1, r.y1); y++) {
        for (let x = Math.max(0, r.x0); x <= Math.min(w.width - 1, r.x1); x++) {
          if (this.regionMask && this.regionMask[x - r.x0 + (y - r.y0) * rw] !== 1) continue;
          const i = w.idx(x, y);
          if (skip[i]) continue;
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
      this.markTerrainDirty();
      this.status(`BAKED ${n} SCARRED CELLS (MECHANISM FOOTPRINTS SKIPPED, UNDOABLE)`);
      return;
    }
    if (
      !(await appDialog.confirm(
        'Bake the ENTIRE playtest world over the document terrain? Mechanism footprints are skipped, but this cannot be undone (RESTORE returns to the captured layer). Set a region first for a precise, undoable bake.',
        { title: 'Bake Playtest World', confirmText: 'Bake World', tone: 'danger' },
      ))
    )
      return;
    for (let i = 0; i < w.types.length; i++) {
      if (skip[i]) continue;
      w.types[i] = scars.types[i];
      const fn = COLOR_FN[w.types[i]];
      w.colors[i] = fn ? fn() : EMPTY_COLOR;
      w.life[i] = scars.life[i];
      w.charge[i] = scars.charge[i];
    }
    this.cmds.clear();
    this.markTerrainDirty();
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

  /** Index of the selected enemy's patrol waypoint under (x, y), if any. */
  private hitPatrolPoint(obj: EditorObject, x: number, y: number): number | null {
    if (!Array.isArray(obj.params.patrol)) return null;
    const pts = obj.params.patrol as Array<[number, number]>;
    let best: number | null = null;
    let bestD = PICK_RADIUS * PICK_RADIUS;
    pts.forEach(([px, py], n) => {
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d <= bestD) {
        bestD = d;
        best = n;
      }
    });
    return best;
  }

  /** RMB in patrol-edit mode: remove the waypoint under the cursor. */
  private deletePatrolPointAt(x: number, y: number): boolean {
    const obj = this.doc.objects.find((o) => o.id === this.patrolEditId);
    if (!obj) return false;
    const idx = this.hitPatrolPoint(obj, x, y);
    if (idx === null) return false;
    const pts = obj.params.patrol as Array<[number, number]>;
    const next = pts.filter((_, n) => n !== idx).map(([px, py]) => [px, py] as [number, number]);
    this.cmds.run(editParamCmd(obj, 'patrol', next.length > 0 ? next : undefined));
    this.status(`WAYPOINT ${idx + 1} REMOVED${next.length === 0 ? ' — PATROL CLEARED' : ''}`);
    return true;
  }

  /* ---------- floating cell selection (X lifts, Enter lands) ---------- */

  /** X with a region set: lift its cells off the world (consumes the region). */
  private liftFloat(): void {
    if (this.previewBlocks()) return;
    if (!this.region) {
      this.status('SELECT A REGION FIRST (R / POLYGON / LASSO), THEN X LIFTS IT', true);
      return;
    }
    const f = liftSelection(this.ctx.world, this.region, this.regionMask);
    if (!f) {
      this.status('REGION TOO LARGE TO FLOAT (MAX 250K CELLS) — NOTHING TOUCHED', true);
      return;
    }
    this.floating = f;
    this.floatCanvas = null;
    this.region = null;
    this.regionMask = null;
    this.regionMaskCells = 0;
    this.syncProcPanel();
    this.status(
      `FLOATING ${f.w}×${f.h} — DRAG/ARROWS MOVE · Q/E ROTATE/FLIP · ENTER LANDS · ESC CANCELS`,
    );
  }

  /** Land the float as ONE composite command (lift patch + paste patch). */
  private commitFloat(): void {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    this.floatCanvas = null;
    this.floatDrag = null;
    if (!f.transformed && f.x === f.origX && f.y === f.origY) {
      // untouched: landing where it lifted is a cancel, not an undo entry
      cancelFloating(this.ctx.world, f);
      this.status('NOTHING MOVED — SELECTION PUT BACK');
      return;
    }
    const cmd = commitFloating(this.ctx.world, f);
    if (cmd) {
      this.cmds.run(cmd);
      this.markTerrainDirty();
    }
    this.status(`LANDED ${f.w}×${f.h} CELLS (ONE UNDO REVERTS THE WHOLE MOVE)`);
    this.renderInspector();
  }

  /** ESC: put the lifted cells back exactly; no command. */
  private cancelFloat(silent = false): void {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    this.floatCanvas = null;
    this.floatDrag = null;
    cancelFloating(this.ctx.world, f);
    if (!silent) this.status('FLOAT CANCELLED — CELLS RESTORED');
  }

  /** Q on a plain selection: spin every unlocked member 90° as ONE command.
   *  Door slabs swap w/h (footprint-true) AND advance their rotation. */
  private rotateObjectCommand(o: EditorObject): Command | null {
    const next = ((o.rotation + 90) % 360) as EditorObject['rotation'];
    if (o.kind === 'door' || o.kind === 'runeDoor' || o.kind === 'valve' || o.kind === 'plug') {
      const dw = o.kind === 'door' ? 3 : o.kind === 'valve' ? 5 : o.kind === 'plug' ? 3 : 2;
      const dh = o.kind === 'door' ? 13 : o.kind === 'valve' ? 2 : o.kind === 'plug' ? 3 : 11;
      const w = paramNum(o, 'w', dw);
      const h = paramNum(o, 'h', dh);
      return compositeCmd('rotate ' + o.kind, [
        editParamCmd(o, 'w', h),
        editParamCmd(o, 'h', w),
        setObjectRotationCmd(o, next),
      ]);
    }
    return setObjectRotationCmd(o, next);
  }

  private rotateSelectedObjects(): boolean {
    const targets = this.doc.objects.filter(
      (o) => this.selectedIds.has(o.id) && !o.locked && this.layerSelectableObj(o),
    );
    if (targets.length === 0) return false;
    const cmds: Command[] = [];
    for (const o of targets) {
      const cmd = this.rotateObjectCommand(o);
      if (cmd) cmds.push(cmd);
    }
    this.cmds.run(
      cmds.length === 1 ? cmds[0] : compositeCmd('rotate ' + targets.length, cmds),
    );
    this.renderInspector();
    this.syncMarkers();
    this.status(`ROTATED ${targets.length} OBJECT(S) 90°`);
    return true;
  }

  /* ---------- symmetry painting ---------- */

  /** Axis center: world center, recentered by the active region. */
  private symAxis(): { x: number; y: number } {
    return symAxes(this.region, WIDTH, HEIGHT);
  }

  /** Mirrored images of a point under the current mode (original first). */
  private symPoints(x: number, y: number): Array<[number, number]> {
    const ax = this.symAxis();
    return mirrorPoints(x, y, this.symmetry, ax.x, ax.y);
  }

  private cycleSymmetry(): void {
    this.symmetry = SYM_MODES[(SYM_MODES.indexOf(this.symmetry) + 1) % SYM_MODES.length];
    this.el('bp-sym-btn').textContent = 'SYM: ' + this.symmetry.toUpperCase();
    this.status(
      this.symmetry === 'off'
        ? 'SYMMETRY OFF'
        : `SYMMETRY ${this.symmetry.toUpperCase()} — TERRAIN TOOLS MIRROR ACROSS THE AXIS`,
    );
  }

  /* ---------- settle preview: run real physics, then keep or revert ---------- */

  private startSettle(): void {
    if (this.settling || this.settleSnap) return;
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
    this.ctx.state.paused = false; // the sim runs for real — that IS the preview
    this.status('SETTLING — HOLD TO CONTINUE, RELEASE TO DECIDE');
    this.syncSettleButtons();
  }

  private stopSettleRun(): void {
    if (!this.settling || !this.settleSnap) return;
    this.settling = false;
    this.ctx.state.paused = true;
    this.status('SETTLED — KEEP OR REVERT');
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
    this.markTerrainDirty();
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
    const settle = this.el<HTMLButtonElement>('bp-settle');
    settle.style.display = deciding ? 'none' : '';
    settle.textContent = this.settling ? 'SETTLING...' : 'SETTLE';
    settle.classList.toggle('active', this.settling);
    this.el('bp-settle-keep').style.display = deciding ? '' : 'none';
    this.el('bp-settle-revert').style.display = deciding ? '' : 'none';
  }

  /* ---------- readability overlays ---------- */

  private exportMaterialPalette(): void {
    downloadText(paletteAsGpl(), 'alchemists-descent-cells.gpl');
    this.status('PALETTE EXPORTED - LOAD THE .GPL IN ASEPRITE/GIMP');
  }

  private toggleLightPreview(): void {
    this.lightPreviewOn = !this.lightPreviewOn;
    this.el('bp-light-toggle').textContent = `PREVIEW LIGHTS: ${this.lightPreviewOn ? 'ON' : 'OFF'}`;
    this.status(`LIGHT PREVIEW ${this.lightPreviewOn ? 'ON' : 'OFF'}`);
  }

  private toggleWandLightPreview(): void {
    this.wandLightPreviewOn = !this.wandLightPreviewOn;
    this.syncWandLightPreview();
    this.syncWandLightPreviewButton();
    this.status(`WAND CURSOR LIGHT ${this.wandLightPreviewOn ? 'ON' : 'OFF'}`);
  }

  private syncWandLightPreview(): void {
    const preview = this.ctx.state.builderWandLightPreview;
    preview.enabled = this.isOpen && this.wandLightPreviewOn;
    if (!preview.enabled) return;
    if (this.lastMouseClient) this.lastMouse = this.clientToWorld(this.lastMouseClient.x, this.lastMouseClient.y);
    preview.x = this.lastMouse.x;
    preview.y = this.lastMouse.y;
  }

  private syncWandLightPreviewButton(): void {
    const btn = this.el<HTMLButtonElement>('bp-wand-light-toggle');
    btn.textContent = `WAND LIGHT: ${this.wandLightPreviewOn ? 'ON' : 'OFF'}`;
    btn.classList.toggle('active', this.wandLightPreviewOn);
  }

  private syncGpuComposeButton(): void {
    document.getElementById('gpu-compose-toggle')?.classList.toggle('lit', this.ctx.state.postFx.gpuCompose);
  }

  private cycleOverlay(): void {
    const modes: Array<BuilderOverlayId | 'none'> = ['none', ...BUILDER_OVERLAY_IDS];
    const next = modes[(modes.indexOf(this.overlayMode) + 1) % modes.length];
    this.overlayMode = next;
    this.workspaceLayout.overlayVisibility = sanitizeOverlayVisibility({});
    if (next !== 'none') this.workspaceLayout.overlayVisibility[next] = true;
    this.syncOverlayButton();
    this.saveWorkspacePrefs();
    this.status(next === 'none' ? 'OVERLAYS OFF' : `OVERLAY: ${overlayLabel(next).toUpperCase()}`);
  }

  private toggleOverlay(id: BuilderOverlayId): void {
    this.workspaceLayout.overlayVisibility = sanitizeOverlayVisibility(this.workspaceLayout.overlayVisibility);
    this.workspaceLayout.overlayVisibility[id] = !this.workspaceLayout.overlayVisibility[id];
    this.overlayMode = this.workspaceLayout.overlayVisibility[id] ? id : 'none';
    this.syncOverlayButton();
    this.saveWorkspacePrefs();
    this.status(
      `${overlayLabel(id).toUpperCase()} OVERLAY ${this.workspaceLayout.overlayVisibility[id] ? 'ON' : 'OFF'}`,
    );
  }

  private syncOverlayButton(): void {
    const active = BUILDER_OVERLAY_IDS.filter((id) => this.workspaceLayout.overlayVisibility[id]);
    this.overlayMode = active[0] ?? 'none';
    const label =
      active.length === 0 ? 'NONE' : active.length === 1 ? overlayLabel(active[0]).toUpperCase() : `${active.length} ON`;
    this.el('bp-overlay-btn').textContent = 'OVERLAY: ' + label;
  }

  private cycleSnapGrid(): void {
    this.snapStep = nextSnapStep(this.snapStep);
    this.workspaceLayout.snapStep = this.snapStep;
    this.el('bp-snap-btn').textContent = 'SNAP: ' + (this.snapStep === 0 ? 'OFF' : this.snapStep);
    this.saveWorkspacePrefs();
    this.status(this.snapStep === 0 ? 'SNAP OFF' : `SNAP TO ${this.snapStep}-CELL GRID (ALT TEMPORARILY BYPASSES)`);
  }

  /* ---------- autosave drafts ---------- */

  private autosaveDraft(): void {
    if (
      !this.isOpen ||
      this.settling ||
      this.settleSnap ||
      this.pendingPreview ||
      this.floating ||
      this.gizmoDrag ||
      this.drag ||
      this.floatDrag ||
      this.waypointDrag ||
      this.shapeDrag ||
      this.marquee ||
      this.stroke ||
      this.terraStroke
    )
      return;
    if (this.cmds.depth === 0 && !this.paintDirty) return;
    try {
      this.ensureCaptured();
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), doc: this.doc }));
      this.status('DRAFT AUTOSAVED');
    } catch {
      // quota — the explicit SAVE path reports storage problems loudly
    }
  }

  private async offerDraft(): Promise<void> {
    if (this.draftOffered) return;
    this.draftOffered = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { at: number; doc: unknown };
      const restored = sanitizeImportedDoc(draft.doc);
      if (!restored) return;
      const when = new Date(draft.at).toLocaleTimeString();
      if (
        !(await appDialog.confirm(`Restore the autosaved draft "${restored.name}" from ${when}?`, {
          title: 'Restore Draft',
          confirmText: 'Restore',
        }))
      )
        return;
      this.doc = restored;
      this.mutedLightIds.clear();
      this.clearPlacedPrefabAnchors();
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

  /** Every action the bar/palette exposes, searchable in one registry. */
  private cmdkActions(): CommandSpec[] {
    return this.uiCommands.list();
  }

  private openCmdk(): void {
    if (this.gizmoDrag) {
      this.status('RELEASE OR ESCAPE THE CANVAS GIZMO FIRST', true);
      return;
    }
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

  private isCommandPaletteOpen(): boolean {
    return this.el<HTMLDivElement>('builder-cmdk').style.display !== 'none';
  }

  private renderCmdk(query: string): void {
    const list = this.el<HTMLDivElement>('bp-cmdk-list');
    const q = query.trim().toLowerCase();
    const hits = this.cmdkActions().filter((a) => a.label.toLowerCase().includes(q)).slice(0, 12);
    list.innerHTML = '';
    hits.forEach((a, n) => {
      const enabled = this.uiCommands.isEnabled(a.id);
      const reason = enabled ? null : this.uiCommands.disabledReason(a.id);
      const row = document.createElement('div');
      row.className = 'bp-cmdk-row' + (n === 0 ? ' first' : '') + (enabled ? '' : ' disabled');
      const label = document.createElement('span');
      label.className = 'bp-cmdk-label';
      label.textContent = a.label;
      row.appendChild(label);
      const meta = document.createElement('span');
      meta.className = 'bp-cmdk-meta';
      meta.textContent = reason ?? (a.shortcut ? a.shortcut : a.category);
      row.appendChild(meta);
      if (reason) row.title = reason;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault(); // beat the input blur
        if (!enabled) {
          this.status(reason ?? 'COMMAND UNAVAILABLE', true);
          return;
        }
        this.closeCmdk();
        this.runUiCommand(a.id);
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
        e.preventDefault();
        this.closeCmdk();
        e.stopPropagation();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        input.focus({ preventScroll: true });
      } else if (e.code === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const q = input.value.trim().toLowerCase();
        if (!q) {
          return;
        }
        const first = this.cmdkActions().find((a) => a.label.toLowerCase().includes(q) && this.uiCommands.isEnabled(a.id));
        this.closeCmdk();
        if (first) this.runUiCommand(first.id);
      }
    });
    input.addEventListener('blur', () => this.closeCmdk());
  }

  /** Run validation and jump straight to the first issue with a location. */
  private findInvalid(): void {
    if (this.previewBlocks()) return;
    this.ensureCaptured();
    const issues = validateDocument(this.doc);
    this.lastValidationOverlay = buildValidationOverlayDiagnostics(this.doc);
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
    this.ensureCaptured();
    // the wizard is 9x17 — refuse to spawn him inside terrain
    const w = this.ctx.world;
    const m = this.lastMouse;
    const blocker = this.authoredCursorSpawnBlocker(m.x, m.y);
    if (blocker) {
      this.select(blocker.id);
      this.frameSelection();
      this.status(`T NEEDS OPEN SPACE — CURSOR OVERLAPS ${blocker.kind.toUpperCase()} FOOTPRINT`, true);
      return;
    }
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
    const issues = validateDocument(this.doc);
    this.lastValidationOverlay = buildValidationOverlayDiagnostics(this.doc);
    const blockers = playtestBlockingIssues(issues, 'cursor-spawn');
    this.renderIssues(issues, { playtestBlockers: blockers });
    if (blockers.length > 0) {
      this.selectIssueTarget(blockers[0]);
      this.status(`PLAYTEST HERE BLOCKED: ${blockers.length} COMPILE BLOCKER(S)`, true);
      return;
    }
    const at = { x: this.lastMouse.x, y: this.lastMouse.y };
    this.startBuilderPlaytest(at);
  }

  private authoredCursorSpawnBlocker(x: number, y: number): EditorObject | null {
    const body = {
      x0: Math.floor(x - 4),
      x1: Math.floor(x + 4),
      y0: Math.floor(y - 16),
      y1: Math.floor(y),
    };
    for (const object of this.doc.objects) {
      if (object.hidden || !this.cursorSpawnObjectStamps(object)) continue;
      if (object.kind === 'exitWell') {
        const halfW = paramNum(object, 'halfW', 14);
        const ox = Math.floor(object.x);
        const oy = Math.floor(object.y);
        const plug = { x0: ox - halfW, y0: oy, x1: ox + halfW, y1: Math.min(HEIGHT - 1, oy + 13) };
        const leftCasing = { x0: ox - halfW - 3, y0: oy, x1: ox - halfW - 1, y1: HEIGHT - 1 };
        const rightCasing = { x0: ox + halfW + 1, y0: oy, x1: ox + halfW + 3, y1: HEIGHT - 1 };
        if (
          this.rectsOverlap(body, plug) ||
          this.rectsOverlap(body, leftCasing) ||
          this.rectsOverlap(body, rightCasing)
        ) {
          return object;
        }
        continue;
      }
      const stampedRects = this.authoredStampRects(object);
      if (stampedRects.length > 0) {
        if (stampedRects.some((rect) => this.rectsOverlap(body, rect))) return object;
        continue;
      }
      const footprint = objectFootprint(object);
      if (!footprint) continue;
      if (this.rectsOverlap(body, footprint)) {
        return object;
      }
    }
    return null;
  }

  private cursorSpawnObjectStamps(object: EditorObject): boolean {
    if (PLAYTEST_CURSOR_ALWAYS_STAMPED_BLOCKERS.has(object.kind)) return true;
    if (PLAYTEST_CURSOR_LINK_STAMPED_TRIGGERS.has(object.kind)) {
      return this.doc.links.some((link) => {
        if (link.kind !== 'triggerDoor' || link.fromId !== object.id) return false;
        const target = this.doc.objects.find((item) => item.id === link.toId);
        return Boolean(target && !target.hidden && PLAYTEST_CURSOR_MECHANISM_TARGETS.has(target.kind));
      });
    }
    if (object.kind === 'runeGlyph') {
      return this.doc.links.some((link) => {
        if (link.kind !== 'runeDoor' || link.fromId !== object.id) return false;
        const target = this.doc.objects.find((item) => item.id === link.toId);
        return Boolean(target && !target.hidden && target.kind === 'runeDoor');
      });
    }
    if (object.kind === 'runeDoor') {
      return this.doc.links.some((link) => {
        if (link.kind !== 'runeDoor' || link.toId !== object.id) return false;
        const source = this.doc.objects.find((item) => item.id === link.fromId);
        return Boolean(source && !source.hidden && source.kind === 'runeGlyph');
      });
    }
    return false;
  }

  private authoredStampRects(object: EditorObject): Array<{ x0: number; y0: number; x1: number; y1: number }> {
    const x = Math.floor(object.x);
    const y = Math.floor(object.y);
    if (object.kind === 'brazier') {
      return [
        { x0: x - 2, y0: y, x1: x + 2, y1: y },
        { x0: x - 2, y0: y - 1, x1: x - 2, y1: y - 1 },
        { x0: x + 2, y0: y - 1, x1: x + 2, y1: y - 1 },
      ];
    }
    if (object.kind === 'chargeLatch') {
      return [{ x0: x - 2, y0: y, x1: x + 2, y1: y }];
    }
    if (object.kind === 'runeGlyph') {
      return [{ x0: x - 2, y0: y, x1: x + 2, y1: y }];
    }
    return [];
  }

  private rectsOverlap(
    a: { x0: number; y0: number; x1: number; y1: number },
    b: { x0: number; y0: number; x1: number; y1: number },
  ): boolean {
    return a.x1 >= b.x0 && a.x0 <= b.x1 && a.y1 >= b.y0 && a.y0 <= b.y1;
  }

  /* ===================== keyboard (capture phase) ===================== */

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (this.gizmoDrag) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') this.cancelGizmoDrag();
      else this.status('RELEASE OR ESCAPE THE CANVAS GIZMO FIRST', true);
      return;
    }
    const appDialogOpen = document.querySelector('.app-dialog-root') !== null;
    const consoleOpen = document.getElementById('dev-console')?.classList.contains('open') === true;
    const focusClaim = this.focusRouter.claimKeyDown(e, {
      appDialogOpen,
      builderHelpOpen: this.builderHelpOpen,
      commandPaletteOpen: this.isCommandPaletteOpen(),
      menuOpen: document.querySelector('.editor-command-menu.open') !== null,
      interactivePopoverOpen: document.querySelector('.editor-popover.interactive') !== null,
      consoleOpen,
      consoleInputFocused: document.activeElement?.id === 'dev-console-input',
      builderOpen: true,
      target: e.target,
    });
    if (focusClaim.surface === 'app-dialog') return;
    if (this.builderHelpOpen) {
      if (e.code === 'Escape' || e.code === 'KeyH') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code !== 'KeyH' || !e.repeat) this.setBuilderHelp(false);
      } else if (e.code === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.cycleBuilderHelpFocus(e.shiftKey);
      } else {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
    if (consoleOpen && e.code === 'KeyH' && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.runUiCommand('builder.help');
      return;
    }
    if (consoleOpen) return;
    if (focusClaim.surface === 'command-palette' || focusClaim.surface === 'menu' || focusClaim.surface === 'interactive-popover') return;
    if (this.focusRouter.isTextEntryTarget(e.target)) {
      if (e.code === 'Escape' && e.target instanceof HTMLElement) e.target.blur();
      return;
    }
    if (e.code === 'Tab') {
      // The Builder owns Tab — no silent mode flip mid-edit.
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (e.code === 'Escape') {
      e.stopPropagation();
      if (this.gizmoDrag) {
        this.cancelGizmoDrag();
      } else if (this.settling || this.settleSnap) {
        this.finishSettle(false);
        this.status('SETTLE CANCELLED');
      } else if (this.floating) {
        this.cancelFloat();
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
      } else if (this.lassoPoints) {
        this.lassoPoints = null;
        this.status('LASSO CANCELLED');
      } else if (this.shapeDrag) {
        this.shapeDrag = null;
      } else if (this.marquee) {
        this.marquee = null;
      } else if (this.tool !== 'select') {
        this.setTool('select');
      } else if (this.region) {
        this.region = null;
        this.regionMask = null;
        this.regionMaskCells = 0;
        this.status('REGION CLEARED');
        this.syncProcPanel();
      } else this.select(null);
    } else if (e.code === 'Enter' && this.floating) {
      e.stopPropagation();
      this.commitFloat();
    } else if (e.code === 'Enter' && this.polyPoints.length >= 3) {
      e.stopPropagation();
      this.closePolyRegion();
    } else if (e.code === 'KeyX' && !e.ctrlKey && !e.metaKey) {
      e.stopPropagation();
      // X is the float toggle: lifts the region, or lands a held float
      if (this.floating) this.commitFloat();
      else this.liftFloat();
    } else if (e.code.startsWith('Arrow') && this.floating) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 8 : 1;
      if (e.code === 'ArrowLeft') this.floating.x -= step;
      else if (e.code === 'ArrowRight') this.floating.x += step;
      else if (e.code === 'ArrowUp') this.floating.y -= step;
      else if (e.code === 'ArrowDown') this.floating.y += step;
    } else if (e.code === 'KeyQ' || e.code === 'KeyE') {
      // precedence: floating selection > armed prefab > selected objects
      if (this.floating) {
        e.stopPropagation();
        this.floating =
          e.code === 'KeyQ' ? rotateFloating(this.floating) : mirrorFloating(this.floating);
        this.floatCanvas = null;
        this.status(
          e.code === 'KeyQ'
            ? `ROTATED — NOW ${this.floating.w}×${this.floating.h}`
            : 'MIRRORED',
        );
      } else if (this.armedPrefab) {
        e.stopPropagation();
        if (e.code === 'KeyQ') {
          this.armedPrefab = rotatePrefab(this.armedPrefab);
          this.status(`ROTATED — NOW ${this.armedPrefab.w}×${this.armedPrefab.h}`);
        } else {
          this.armedPrefab = mirrorPrefab(this.armedPrefab);
          this.status('MIRRORED');
        }
      } else if (e.code === 'KeyQ' && this.rotateSelectedObjects()) {
        e.stopPropagation();
      }
    } else if (e.code === 'KeyM') {
      // Keep play-mode overlays out of authoring.
      e.stopPropagation();
    } else {
      const result = this.keymap.handleKeyDown(e, { scope: this.sessionMode === 'live' ? 'builder.livePreview' : 'builder.author' });
      if (result.handled && result.ok === false && result.reason) this.status(result.reason, true);
    }
  };

  /* ===================== per-frame: markers + canvas ===================== */

  private matRowText = '';

  private loop = (): void => {
    if (!this.isOpen) return;
    this.rafId = requestAnimationFrame(this.loop);
    this.syncWorkspaceFrame();
    const rect = this.overlay.getBoundingClientRect();
    if (rect.width === 0) return;
    this.syncWandLightPreview();

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

    if (this.sessionMode === 'live') {
      if (this.previewRuntimeDirty) this.resetPreviewRuntime('LIVE PREVIEW');
      this.previewRuntime.step(state.frameCount);
    }

    // live light preview: authored lights feed the real light field
    // (solo narrows the feed to one light; MUTE drops a light from the
    // preview only — muted lights still compile)
    if (!this.lightPreviewOn) {
      state.editorLights = null;
    } else if (this.sessionMode === 'live') {
      const previewLights = this.previewRuntime.authoredLights({
        mutedIds: this.mutedLightIds,
        soloId: this.soloLightId,
      });
      state.editorLights = previewLights.length > 0 ? previewLights : null;
    } else {
      state.editorLights =
        this.doc.lights.length > 0
          ? this.doc.lights
              .filter(
                (l) =>
                  !l.hidden &&
                  !this.mutedLightIds.has(l.id) &&
                  (this.soloLightId === null || l.id === this.soloLightId),
              )
              .map((l, n) => ({ ...toAuthoredLight(l, n), flicker: 0 }))
          : null;
    }

    if (!this.minimapImage || state.frameCount % 12 === 0) this.refreshMinimapTerrain();
    this.drawMinimap();

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
    const cam = this.ctx.camera;
    const view = {
      x0: cam.renderX + VIEW_W * (0.5 - 0.5 / cam.zoom),
      y0: cam.renderY + VIEW_H * (0.5 - 0.5 / cam.zoom),
      x1: cam.renderX + VIEW_W * (0.5 + 0.5 / cam.zoom),
      y1: cam.renderY + VIEW_H * (0.5 + 0.5 / cam.zoom),
    };

    if (this.snapGuideVisible()) {
      drawSnapGrid(g, {
        snapStep: this.snapStep,
        view,
        cellW,
        cellH,
        width: cw,
        height: ch,
        toScreen: toS,
      });
    }

    // registered overlays (under object previews and editor gizmos)
    const activeOverlays = new Set(BUILDER_OVERLAY_IDS.filter((id) => this.workspaceLayout.overlayVisibility[id]));
    if (activeOverlays.size > 0) {
      drawBuilderOverlays(
        g,
        {
          doc: this.doc,
          issues: this.lastIssues,
          diagnostics: this.lastValidationOverlay,
          cellW,
          cellH,
          view,
          toScreen: toS,
        },
        activeOverlays,
      );
      g.fillStyle = 'rgba(125,211,252,0.9)';
      g.font = '700 10px monospace';
      g.fillText(
        `OVERLAY: ${[...activeOverlays].map((id) => overlayLabel(id as BuilderOverlayId).toUpperCase()).join(', ')} (O CYCLES)`,
        12,
        16,
      );
    }
    if (this.sessionMode === 'live') {
      this.previewRuntime.draw(g, { view, cellW, cellH, toScreen: toS });
    }

    for (const o of this.doc.objects) {
      if (!this.layerVisibleObj(o)) continue;
      drawObjectPreview(g, o, {
        cellW,
        cellH,
        frame: this.sessionMode === 'live' ? this.ctx.state.frameCount : 0,
        selected: this.selectedIds.has(o.id),
        toScreen: toS,
        spriteFrame: (obj, frame) => this.decorSpritePreviewCanvas(obj, frame),
      });
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
      // sensor read zones are virtual (no stamped footprint): dashed box
      if (o.kind === 'sensor') {
        const zw = Math.max(1, paramNum(o, 'zoneW', 9));
        const zh = Math.max(1, paramNum(o, 'zoneH', 7));
        const za = toS(o.x - Math.floor(zw / 2), o.y - zh);
        const zb = toS(o.x - Math.floor(zw / 2) + zw, o.y);
        g.setLineDash([3, 3]);
        g.strokeStyle =
          o.id === this.selectedId ? 'rgba(94,234,212,0.9)' : 'rgba(94,234,212,0.35)';
        g.lineWidth = 1;
        g.strokeRect(za.x, za.y, zb.x - za.x, zb.y - za.y);
        g.setLineDash([]);
        continue;
      }
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
            : o.kind === 'valve'
              ? sel ? 'rgba(94,234,212,0.95)' : 'rgba(94,234,212,0.45)'
              : o.kind === 'plug'
                ? sel ? 'rgba(251,146,60,0.95)' : 'rgba(251,146,60,0.45)'
                : sel ? 'rgba(251,191,36,0.9)' : 'rgba(251,191,36,0.35)';
      g.lineWidth = sel ? 2 : 1;
      g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      // sensor zones read as faint inner boxes
      if (o.kind === 'scale' || o.kind === 'buoy' || o.kind === 'chargeLatch' || o.kind === 'counterweight') {
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
      // wire color says what KIND of signal travels: rune green, relay
      // violet, sensor/counterweight teal, plug ember, plain triggers amber
      const tint =
        l.kind === 'runeDoor'
          ? 'rgba(134,239,172,'
          : from.kind === 'relay'
            ? 'rgba(196,181,253,'
            : from.kind === 'sensor' || from.kind === 'counterweight'
              ? 'rgba(94,234,212,'
              : from.kind === 'plug'
                ? 'rgba(251,146,60,'
                : 'rgba(252,211,77,';
      g.strokeStyle = tint + (sel ? '0.95)' : '0.45)');
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

    // authored light rings (muted: dimmed ring + "M" tag)
    if (!this.layerHidden.has('lights')) {
      for (const l of this.doc.lights) {
        const c = toS(l.x, l.y);
        const sel = l.id === this.selectedId;
        const solo = this.soloLightId === l.id;
        const muted = this.mutedLightIds.has(l.id);
        g.strokeStyle = muted ? l.color + '22' : sel || solo ? l.color : l.color + '55';
        g.lineWidth = sel || solo ? 2 : 1;
        g.beginPath();
        g.ellipse(c.x, c.y, l.radius * cellW, l.radius * cellH, 0, 0, Math.PI * 2);
        g.stroke();
        g.font = '700 9px monospace';
        if (solo) {
          g.fillStyle = l.color;
          g.fillText('SOLO', c.x + 6, c.y - 6);
        } else if (muted) {
          g.fillStyle = l.color + '88';
          g.fillText('M', c.x + 6, c.y - 6);
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
      }
    }

    this.drawGizmoHandles(g, this.projectedGizmoHandles(rect));

    // lasso loop in progress
    if (this.lassoPoints && this.lassoPoints.length > 1) {
      g.strokeStyle = 'rgba(125,211,252,0.9)';
      g.lineWidth = 1.5;
      g.setLineDash([4, 3]);
      g.beginPath();
      const l0 = toS(this.lassoPoints[0][0], this.lassoPoints[0][1]);
      g.moveTo(l0.x, l0.y);
      for (const [px, py] of this.lassoPoints.slice(1)) {
        const p = toS(px, py);
        g.lineTo(p.x, p.y);
      }
      g.lineTo(l0.x, l0.y); // releasing closes the loop — show it closed
      g.stroke();
      g.setLineDash([]);
    }

    // symmetry axis (dashed) while a terrain tool could mirror
    if (this.symmetry !== 'off') {
      const terrainTool =
        this.tool === 'paint' || SHAPE_TOOLS.has(this.tool) || this.tool === 'fill' ||
        this.tool === 'smooth' || this.tool === 'roughen' || this.tool === 'stamp';
      if (terrainTool) {
        const ax = this.symAxis();
        g.strokeStyle = 'rgba(240,171,252,0.55)';
        g.lineWidth = 1;
        g.setLineDash([8, 6]);
        if (this.symmetry === 'x' || this.symmetry === 'quad') {
          const v = toS(ax.x + 0.5, 0);
          g.beginPath();
          g.moveTo(v.x, 0);
          g.lineTo(v.x, ch);
          g.stroke();
        }
        if (this.symmetry === 'y' || this.symmetry === 'quad') {
          const hz = toS(0, ax.y + 0.5);
          g.beginPath();
          g.moveTo(0, hz.y);
          g.lineTo(cw, hz.y);
          g.stroke();
        }
        g.setLineDash([]);
        g.fillStyle = 'rgba(240,171,252,0.8)';
        g.font = '700 9px monospace';
        g.fillText('SYM:' + this.symmetry.toUpperCase(), 12, 28);
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
      const measurement = measurementBetween({ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 });
      this.drawCanvasCallout(g, measurement.label, Math.max(8, Math.min(cw - 190, b.x + 6)), Math.max(18, a.y - 18), cw);
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
      const measurement = measurementBetween(
        { x: this.marquee.x0, y: this.marquee.y0 },
        { x: this.marquee.x1, y: this.marquee.y1 },
      );
      this.drawCanvasCallout(g, measurement.label, Math.max(8, Math.min(cw - 190, b.x + 6)), Math.max(18, a.y - 18), cw);
    }

    // armed prefab ghost at the cursor (+ object glyphs, lights, anchors)
    if (this.tool === 'stamp' && this.armedPrefab) {
      const s = this.armedPrefab;
      const gx = this.snap(this.lastMouse.x),
        gy = this.snap(this.lastMouse.y);
      const a = toS(gx - Math.floor(s.w / 2), gy - Math.floor(s.h / 2));
      g.setLineDash([5, 3]);
      g.strokeStyle = 'rgba(240,171,252,0.9)';
      g.lineWidth = 1.5;
      g.strokeRect(a.x, a.y, s.w * cellW, s.h * cellH);
      g.setLineDash([]);
      g.fillStyle = 'rgba(240,171,252,0.8)';
      g.font = '700 10px monospace';
      g.fillText(s.name + ' (Q/E)', a.x + 2, a.y - 4);
      for (const o of s.objects) {
        g.fillStyle = 'rgba(252,211,77,0.9)';
        g.fillText(GLYPH[o.kind] ?? '?', a.x + o.x * cellW - 3, a.y + o.y * cellH + 4);
      }
      for (const lt of s.lights) {
        g.fillStyle = 'rgba(125,211,252,0.9)';
        g.fillText('*', a.x + lt.x * cellW - 3, a.y + lt.y * cellH + 4);
      }
      for (const an of s.anchors ?? []) {
        g.fillStyle = 'rgba(74,222,128,0.95)';
        g.fillText('⚓', a.x + an.x * cellW - 4, a.y + an.y * cellH + 4);
      }
    }

    // floating selection: the carried cells ride the cursor at full color
    if (this.floating) {
      const f = this.floating;
      if (!this.floatCanvas) {
        // cache the preview pixels on a canvas so each frame is one drawImage
        const c = document.createElement('canvas');
        c.width = f.w;
        c.height = f.h;
        c.getContext('2d')!.putImageData(floatPreview(f), 0, 0);
        this.floatCanvas = c;
      }
      const a = toS(f.x, f.y);
      const prevSmooth = g.imageSmoothingEnabled;
      g.imageSmoothingEnabled = false;
      g.drawImage(this.floatCanvas, a.x, a.y, f.w * cellW, f.h * cellH);
      g.imageSmoothingEnabled = prevSmooth;
      g.setLineDash([5, 3]);
      g.strokeStyle = 'rgba(125,211,252,0.95)';
      g.lineWidth = 1.5;
      g.strokeRect(a.x, a.y, f.w * cellW, f.h * cellH);
      g.setLineDash([]);
      g.fillStyle = 'rgba(125,211,252,0.95)';
      g.font = '700 10px monospace';
      g.fillText(
        `FLOATING ${f.w}×${f.h} — ENTER LANDS · Q/E SPIN · ESC CANCELS`,
        a.x + 2,
        a.y - 4,
      );
    }

    // pending procedural preview badge
    if (this.pendingPreview) {
      g.fillStyle = 'rgba(251,191,36,0.95)';
      g.font = '700 11px monospace';
      const label = this.pendingPreview.kind === 'pass' ? 'PROCEDURAL PREVIEW' : 'VALIDATION REPAIR PREVIEW';
      g.fillText(`${label} — APPLY OR DISCARD`, 12, ch - 12);
    } else if (this.sessionMode === 'live') {
      g.fillStyle = 'rgba(74,222,128,0.92)';
      g.font = '700 11px monospace';
      const preview = this.previewRuntime.status();
      g.fillText(
        `LIVE PREVIEW - ${preview.mechanisms} mech / ${preview.emitters} emit / ${preview.lights} lights`,
        12,
        ch - 12,
      );
    }
    if (this.settling) {
      g.fillStyle = 'rgba(125,211,252,0.95)';
      g.font = '700 11px monospace';
      g.fillText('SETTLING… (ESC CANCELS)', 12, ch - 12);
    }

    if (this.spatialReadoutVisible()) {
      drawCoordinateReadout(g, {
        mouse: this.lastMouse,
        snapStep: this.snapStep,
        width: cw,
        height: ch,
        extra: this.gizmoDrag ? this.gizmoDrag.handle.label.toUpperCase() : undefined,
      });
    }
  }

  private drawCanvasCallout(g: CanvasRenderingContext2D, text: string, x: number, y: number, width: number): void {
    g.save();
    g.font = '700 10px monospace';
    const padX = 6;
    const textW = g.measureText(text).width;
    const boxW = Math.min(width - 16, textW + padX * 2);
    const bx = Math.max(8, Math.min(width - boxW - 8, x));
    g.fillStyle = 'rgba(5,10,18,0.86)';
    g.strokeStyle = 'rgba(125,211,252,0.32)';
    g.lineWidth = 1;
    g.fillRect(bx, y, boxW, 17);
    g.strokeRect(bx, y, boxW, 17);
    g.fillStyle = 'rgba(214,230,245,0.92)';
    g.fillText(text, bx + padX, y + 12);
    g.restore();
  }

  private drawGizmoHandles(g: CanvasRenderingContext2D, handles: readonly ProjectedGizmoHandle[]): void {
    if (handles.length === 0) return;
    g.save();
    g.font = '700 9px monospace';
    for (const handle of handles) {
      const hover = this.hoverGizmoId === handle.id;
      const active = this.gizmoDrag?.handle.id === handle.id;
      const radius = handle.radiusPx + (hover || active ? 2 : 0);
      const color =
        handle.kind === 'rotate'
          ? 'rgba(252,211,77,0.96)'
          : handle.kind === 'waypoint'
            ? 'rgba(248,113,113,0.96)'
            : handle.kind === 'light-radius'
              ? 'rgba(125,211,252,0.96)'
              : handle.kind === 'light-falloff'
                ? 'rgba(196,181,253,0.96)'
                : 'rgba(94,234,212,0.96)';
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(5,10,18,0.95)';
      g.fillStyle = color;
      if (hover || active) {
        g.beginPath();
        g.arc(handle.sx, handle.sy, radius + 4, 0, Math.PI * 2);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fill();
        g.fillStyle = color;
      }
      if (handle.kind === 'rotate') {
        g.strokeStyle = 'rgba(252,211,77,0.42)';
        g.beginPath();
        g.moveTo(handle.sx, handle.sy + radius + 2);
        g.lineTo(handle.sx, handle.sy + radius + 14);
        g.stroke();
        g.strokeStyle = 'rgba(5,10,18,0.95)';
        g.beginPath();
        g.arc(handle.sx, handle.sy, radius + 1, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = 'rgba(5,10,18,0.92)';
        g.fillText('R', handle.sx - 3, handle.sy + 3);
      } else if (handle.kind === 'light-falloff') {
        g.beginPath();
        g.moveTo(handle.sx, handle.sy - radius - 1);
        g.lineTo(handle.sx + radius + 1, handle.sy + radius);
        g.lineTo(handle.sx - radius - 1, handle.sy + radius);
        g.closePath();
        g.fill();
        g.stroke();
      } else {
        g.fillRect(handle.sx - radius, handle.sy - radius, radius * 2, radius * 2);
        g.strokeRect(handle.sx - radius, handle.sy - radius, radius * 2, radius * 2);
      }
      if (hover || active) {
        this.drawCanvasCallout(g, handle.label, handle.sx + 10, handle.sy - 23, this.canvas.width);
      }
    }
    g.restore();
  }

  /** Refresh the cached true-color world overview; camera/dots redraw every RAF. */
  private refreshMinimapTerrain(): void {
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
  }

  /** True-color world overview + camera box + object dots; click jumps. */
  private drawMinimap(): void {
    if (!this.minimapImage) this.refreshMinimapTerrain();
    if (!this.minimapImage) return;
    const mm = this.minimapCtx;
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
    const vx = cam.x + (VIEW_W - vw) / 2,
      vy = cam.y + (VIEW_H - vh) / 2;
    mm.strokeStyle = 'rgba(74,222,128,0.95)';
    mm.lineWidth = 1;
    mm.strokeRect(vx / 8 + 0.5, vy / 8 + 0.5, Math.max(1, vw / 8), Math.max(1, vh / 8));
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
      m.title =
        o.kind === 'decor'
          ? typeof o.params.spriteId === 'string' && o.params.spriteId !== ''
            ? 'sprite decor (visual only)'
            : String(o.params.text ?? 'note')
          : o.kind;
      if (o.kind === 'decor' && typeof o.params.color === 'string') {
        m.style.color = o.params.color; // the note wears its authored tint
      }
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
    // any decor preview animation dies with the inspector DOM it drew into
    window.clearTimeout(this.decorPreviewTimer);
    const panel = this.el<HTMLDivElement>('builder-inspector');
    if (this.selectedIds.size > 1) {
      panel.innerHTML = renderInspectorItems(
        multiSelectionInspectorSchema(
          this.doc.objects.filter((obj) => this.selectedIds.has(obj.id)),
          this.doc.lights.filter((light) => this.selectedIds.has(light.id)),
        ),
      );
      this.refreshPanelDragHandles(panel);
      this.applyInspectorMixedState(panel);
      for (const b of panel.querySelectorAll<HTMLButtonElement>('button[data-align]')) {
        b.addEventListener('click', () => this.alignSelection(b.dataset.align as 'x' | 'y' | 'spreadX' | 'spreadY'));
      }
      this.wireMultiSelectionInspector(panel);
      panel.querySelector('#bi-delete')?.addEventListener('click', () => void this.deleteSelection());
      this.syncNavigationPanels();
      return;
    }
    const light = this.selectedLight();
    if (light) {
      this.renderLightInspector(panel, light);
      this.syncNavigationPanels();
      return;
    }
    const obj = this.selected();
    if (!obj) {
      panel.innerHTML = renderInspectorItems(documentInspectorSchema(this.doc, this.cmds.depth));
      this.refreshPanelDragHandles(panel);
      this.wireDocumentInspector(panel);
      this.syncNavigationPanels();
      return;
    }

    panel.innerHTML = renderInspectorItems(
      objectInspectorSchema(obj, {
        objects: this.doc.objects,
        links: this.doc.links,
        sprites: this.sprites,
        documentSprites: this.doc.assets?.sprites ?? [],
        patrolEditId: this.patrolEditId,
      }),
    );
    this.refreshPanelDragHandles(panel);

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
        if (field instanceof HTMLInputElement && (field.dataset.num || field.type === 'number')) {
          const parsed = this.parseInspectorNumber(field, key, true);
          if (!parsed.ok) return;
          value = parsed.value;
        } else if (value === '') value = undefined;
        this.cmds.run(editParamCmd(obj, key, value));
        this.renderInspector(); // kind switches change which param rows exist
        this.syncMarkers(); // glyphs/tooltips can depend on params (kind, note text)
      });
    }
    for (const flag of panel.querySelectorAll<HTMLInputElement>('input[data-f="locked"],input[data-f="hidden"]')) {
      flag.addEventListener('change', () => {
        this.cmds.run(setObjectFlagCmd(obj, flag.dataset.f as 'locked' | 'hidden', flag.checked));
        this.syncMarkers();
        this.syncNavigationPanels();
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
      // slabs swap w/h (footprint-true) AND advance rotation in one composite
      const dims =
        obj.kind === 'door'
          ? [3, 13]
          : obj.kind === 'valve'
            ? [5, 2]
            : obj.kind === 'plug'
              ? [3, 3]
              : [2, 11];
      const dw = dims[0];
      const dh = dims[1];
      const w = paramNum(obj, 'w', dw);
      const h = paramNum(obj, 'h', dh);
      this.cmds.run(
        compositeCmd('rotate ' + obj.kind, [
          editParamCmd(obj, 'w', h),
          editParamCmd(obj, 'h', w),
          setObjectRotationCmd(obj, ((obj.rotation + 90) % 360) as EditorObject['rotation']),
        ]),
      );
      this.renderInspector();
      this.status('ROTATED — NOW ' + h + '×' + w);
    });
    panel.querySelector('#bi-rotate-pt')?.addEventListener('click', () => {
      const next = ((obj.rotation + 90) % 360) as EditorObject['rotation'];
      this.cmds.run(setObjectRotationCmd(obj, next));
      this.renderInspector();
      this.status(
        `ROTATION ${next}°` +
          (obj.kind === 'hazardEmitter' ? ` — DRIPS ${(EMITTER_DIR[next] ?? 'down').toUpperCase()}` : ''),
      );
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
    if (obj.kind === 'decor') this.wireDecorSpriteExtras(panel, obj);
    panel.querySelector('#bi-delete')?.addEventListener('click', () => void this.deleteSelection());
    this.syncNavigationPanels();
  }

  private wireDocumentInspector(panel: HTMLDivElement): void {
    panel.querySelector<HTMLInputElement>('#bi-mood-ambient')?.addEventListener('change', (e) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      const ambient = raw === '' ? null : Number(raw);
      if (ambient !== null && (!Number.isFinite(ambient) || ambient < 0.02 || ambient > 0.6)) {
        this.status('MOOD AMBIENT MUST BE BLANK OR 0.02-0.60', true);
        this.renderInspector();
        return;
      }
      const prev = this.doc.mood?.ambient ?? null;
      if (ambient === prev) return;
      this.cmds.run(editDocumentMoodCmd({ ambient }));
      this.renderInspector();
      this.status(ambient === null ? 'MOOD AMBIENT: GAME DEFAULT' : `MOOD AMBIENT: ${ambient}`);
    });
    panel.querySelector<HTMLInputElement>('#bi-mood-ambience')?.addEventListener('change', (e) => {
      const ambience = (e.target as HTMLInputElement).value;
      if (ambience === (this.doc.mood?.ambience ?? '')) return;
      this.cmds.run(editDocumentMoodCmd({ ambience }));
      this.renderInspector();
      this.status(ambience.trim() ? `MOOD AMBIENCE: ${ambience}` : 'MOOD AMBIENCE CLEARED');
    });
  }

  private wireMultiSelectionInspector(panel: HTMLDivElement): void {
    for (const flag of panel.querySelectorAll<HTMLInputElement>('input[data-mf]')) {
      flag.addEventListener('change', () => {
        const key = flag.dataset.mf as 'locked' | 'hidden';
        const value = flag.checked;
        const cmds: Command[] = [];
        for (const obj of this.doc.objects) {
          if (!this.selectedIds.has(obj.id) || obj[key] === value) continue;
          cmds.push(setObjectFlagCmd(obj, key, value));
        }
        for (const light of this.doc.lights) {
          if (!this.selectedIds.has(light.id) || light[key] === value) continue;
          cmds.push(editLightCmd(light, { [key]: value } as Partial<EditorLight>));
        }
        if (cmds.length === 0) return;
        this.cmds.run(cmds.length === 1 ? cmds[0] : compositeCmd(`${key} selection ${cmds.length}`, cmds));
        this.syncMarkers();
        this.renderInspector();
        this.status(`${key.toUpperCase()}: ${cmds.length} UPDATED`);
      });
    }
  }

  private applyInspectorMixedState(panel: HTMLDivElement): void {
    for (const input of panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-mixed="true"]')) {
      input.indeterminate = true;
    }
  }

  private parseInspectorNumber(
    input: HTMLInputElement,
    label: string,
    allowBlank: boolean,
  ): { ok: true; value: number | undefined } | { ok: false } {
    const raw = input.value.trim();
    if (raw === '') {
      if (allowBlank) return { ok: true, value: undefined };
      this.status(`${label.toUpperCase()} REQUIRES A NUMBER`, true);
      this.renderInspector();
      return { ok: false };
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      this.status(`${label.toUpperCase()} MUST BE A NUMBER`, true);
      this.renderInspector();
      return { ok: false };
    }
    const minAttr = input.getAttribute('min');
    const maxAttr = input.getAttribute('max');
    const min = minAttr === null || minAttr === '' ? null : Number(minAttr);
    const max = maxAttr === null || maxAttr === '' ? null : Number(maxAttr);
    if (min !== null && Number.isFinite(min) && value < min) {
      this.status(`${label.toUpperCase()} MUST BE >= ${min}`, true);
      this.renderInspector();
      return { ok: false };
    }
    if (max !== null && Number.isFinite(max) && value > max) {
      this.status(`${label.toUpperCase()} MUST BE <= ${max}`, true);
      this.renderInspector();
      return { ok: false };
    }
    return { ok: true, value };
  }

  /** Decor sprite extras: the asset-level emissive toggle (library edit,
   *  deliberately NOT on the undo stack — it edits the sprite, not the
   *  document) and the small animated preview honoring frame durations. */
  private wireDecorSpriteExtras(panel: HTMLDivElement, obj: EditorObject): void {
    const sid = typeof obj.params.spriteId === 'string' ? obj.params.spriteId : '';
    if (!sid) return;
    const asset =
      this.sprites.find((s) => s.id === sid) ??
      this.doc.assets?.sprites.find((s) => s.id === sid);
    if (!asset) return;

    panel.querySelector<HTMLInputElement>('#bi-sprite-emissive')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      let lib = this.sprites.find((s) => s.id === sid);
      if (!lib) {
        // Asset-library edit: import/embedded fallback is cloned into the local
        // library, but the document's embedded asset is not mutated here.
        lib = { ...asset, frames: [...asset.frames], tags: [...asset.tags] };
        this.sprites.push(lib);
        this.sprites.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      }
      lib.emissive = on;
      saveSprite(lib);
      this.refreshSprites();
      this.status(
        (on ? 'SPRITE NOW EMISSIVE (DRAWN RAW)' : 'SPRITE NO LONGER EMISSIVE') +
          ' — LIBRARY EDIT, NOT UNDOABLE',
      );
    });

    const canvas = panel.querySelector<HTMLCanvasElement>('#bi-sprite-prev');
    if (!canvas) return;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const frames = asset.frames.map((f) => {
      const img = new ImageData(asset.w, asset.h);
      img.data.set(decodeFramePx(f.px, asset.w, asset.h));
      return img;
    });
    const stage = document.createElement('canvas');
    stage.width = asset.w;
    stage.height = asset.h;
    const sg = stage.getContext('2d')!;
    const loop = resolveLoopTag(asset, typeof obj.params.loopTag === 'string' ? obj.params.loopTag : '');
    const n = loop.to - loop.from + 1;
    const steps = loop.dir === 'pingpong' && n > 1 ? 2 * n - 2 : n;
    const fps = paramNum(obj, 'fps', 0);
    const flip = obj.params.flipX === true;
    let k = 0;
    const tick = (): void => {
      const f =
        loop.dir === 'reverse'
          ? loop.to - k
          : loop.dir === 'pingpong' && k >= n
            ? loop.to - (k - n + 1)
            : loop.from + k;
      sg.putImageData(frames[f], 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (flip) {
        g.save();
        g.translate(canvas.width, 0);
        g.scale(-1, 1);
        g.drawImage(stage, 0, 0, canvas.width, canvas.height);
        g.restore();
      } else {
        g.drawImage(stage, 0, 0, canvas.width, canvas.height);
      }
      k = (k + 1) % Math.max(1, steps);
      const delay = fps > 0 ? 1000 / Math.min(60, fps) : asset.frames[f].durationMs;
      this.decorPreviewTimer = window.setTimeout(tick, Math.max(16, delay));
    };
    tick();
  }

  private renderLightInspector(panel: HTMLDivElement, light: EditorLight): void {
    panel.innerHTML = renderInspectorItems(
      lightInspectorSchema(light, {
        presetIds: Object.keys(LIGHT_PRESETS),
        solo: this.soloLightId === light.id,
        muted: this.mutedLightIds.has(light.id),
      }),
    );
    this.refreshPanelDragHandles(panel);

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
          if (!(field instanceof HTMLInputElement)) return;
          const parsed = this.parseInspectorNumber(field, String(key), false);
          if (!parsed.ok) return;
          value = parsed.value;
        }
        this.cmds.run(editLightCmd(light, { [key]: value } as Partial<EditorLight>));
        if (key === 'hidden' || key === 'locked') {
          this.pruneSelection();
          this.syncMarkers();
          this.syncNavigationPanels();
          this.renderInspector();
        }
      });
    }
    panel.querySelector('#bi-solo')?.addEventListener('click', () => {
      this.soloLightId = this.soloLightId === light.id ? null : light.id;
      this.renderLightInspector(panel, light);
      this.status(this.soloLightId ? 'PREVIEWING ONLY THIS LIGHT' : 'PREVIEWING ALL LIGHTS');
    });
    panel.querySelector('#bi-mute')?.addEventListener('click', () => {
      if (this.mutedLightIds.has(light.id)) this.mutedLightIds.delete(light.id);
      else this.mutedLightIds.add(light.id);
      this.renderLightInspector(panel, light);
      this.status(
        this.mutedLightIds.has(light.id)
          ? 'LIGHT MUTED IN THE PREVIEW (STILL COMPILES)'
          : 'LIGHT UNMUTED',
      );
    });
    panel.querySelector<HTMLSelectElement>('[data-preset]')?.addEventListener('change', (e) => {
      const preset = LIGHT_PRESETS[(e.target as HTMLSelectElement).value];
      if (!preset) return;
      this.cmds.run(editLightCmd(light, preset));
      this.renderLightInspector(panel, light); // reflect the new values
    });
    panel.querySelector('#bi-delete')?.addEventListener('click', () => void this.deleteSelection());
  }

  private renderOutliner(): void {
    const panel = this.el<HTMLDivElement>('builder-outliner');
    const panelScroll = panel.scrollTop;
    const rowsScroll = panel.querySelector<HTMLElement>('.bo-rows')?.scrollTop ?? 0;
    const model = buildOutlinerModel({
      doc: this.doc,
      issues: this.currentValidationIssues(),
      selectedIds: this.selectedIds,
      sprites: this.sprites,
      documentSprites: this.doc.assets?.sprites ?? [],
      prefabs: this.prefabs,
      query: this.outlinerQuery,
      filters: this.outlinerFilters,
      layers: this.outlinerLayerStates(),
    });
    panel.innerHTML = renderOutlinerPanel(model);
    this.restoreStructurePanelScroll(panel, panelScroll, [['.bo-rows', rowsScroll]]);
    this.refreshPanelDragHandles(panel);
    panel.querySelector('#bo-close')?.addEventListener('click', () => this.closeWorkspacePanel('builder-outliner'));
    panel.querySelector<HTMLInputElement>('#bo-search')?.addEventListener('input', (event) => {
      this.outlinerQuery = (event.target as HTMLInputElement).value;
      this.renderOutliner();
      this.el<HTMLInputElement>('bo-search')?.focus({ preventScroll: true });
    });
    for (const chip of panel.querySelectorAll<HTMLButtonElement>('button[data-outliner-filter]')) {
      chip.addEventListener('click', () => {
        const filter = chip.dataset.outlinerFilter as OutlinerFilter;
        if (this.outlinerFilters.has(filter)) this.outlinerFilters.delete(filter);
        else this.outlinerFilters.add(filter);
        this.renderOutliner();
      });
    }
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-layer-vis]')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.runUiCommand(`builder.layer.${button.dataset.layerVis}.visibility`);
      });
    }
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-layer-lock]')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.runUiCommand(`builder.layer.${button.dataset.layerLock}.lock`);
      });
    }
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-row-toggle]')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = button.dataset.rowId ?? '';
        if (id) this.select(id);
        const commandId = button.dataset.commandId;
        if (commandId) this.runUiCommand(commandId);
      });
    }
    this.wireSelectAndFrameRows(panel);
  }

  private renderLinkGraph(): void {
    const panel = this.el<HTMLDivElement>('builder-link-graph');
    const panelScroll = panel.scrollTop;
    const linkScrolls = [...panel.querySelectorAll<HTMLElement>('.blg-links, .blg-actuators')].map((el) => el.scrollTop);
    const model = buildLinkGraphModel({
      doc: this.doc,
      issues: this.currentValidationIssues(),
      selectedIds: this.selectedIds,
      query: this.linkGraphQuery,
    });
    panel.innerHTML = renderLinkGraphPanel(model);
    this.restoreStructurePanelScroll(
      panel,
      panelScroll,
      [...panel.querySelectorAll<HTMLElement>('.blg-actuators, .blg-links')].map((el, index) => [el, linkScrolls[index] ?? 0]),
    );
    this.refreshPanelDragHandles(panel);
    panel.querySelector('#blg-close')?.addEventListener('click', () => this.closeWorkspacePanel('builder-link-graph'));
    panel.querySelector<HTMLInputElement>('#blg-search')?.addEventListener('input', (event) => {
      this.linkGraphQuery = (event.target as HTMLInputElement).value;
      this.renderLinkGraph();
      this.el<HTMLInputElement>('blg-search')?.focus({ preventScroll: true });
    });
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-unlink]')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.contextLinkId = button.dataset.unlink ?? null;
        this.runUiCommand('builder.unlinkContextLink');
      });
    }
    this.wireSelectAndFrameRows(panel);
  }

  private restoreStructurePanelScroll(
    panel: HTMLElement,
    panelScroll: number,
    childScrolls: Array<[string | HTMLElement, number]>,
  ): void {
    const restore = (): void => {
      panel.scrollTop = panelScroll;
      for (const [target, scrollTop] of childScrolls) {
        const el = typeof target === 'string' ? panel.querySelector<HTMLElement>(target) : target;
        if (el) el.scrollTop = scrollTop;
      }
    };
    restore();
    requestAnimationFrame(restore);
  }

  private createAssetDatabase(): AssetDatabase {
    return buildAssetDatabase({
      currentDocument: this.doc,
      documents: loadDocLibrary(),
      templates: builderDocumentTemplates(),
      prefabs: this.prefabs,
      builtinPrefabs: builtinPrefabs(),
      sprites: this.sprites,
      embeddedSprites: this.doc.assets?.sprites ?? [],
      importReports: this.assetStore.listImportReports(),
      contentAssets: createBuiltInContentAssetRecords({ materials: this.ctx.params.materials }),
      materials: this.ctx.params.materials,
      procPresets: PASSES.map((pass) => ({ id: pass.id, label: pass.label, usesMaterial: pass.usesMaterial })),
      lightPresets: Object.entries(LIGHT_PRESETS).map(([id, preset]) => ({
        id,
        label: id.replace(/-/g, ' '),
        color: preset.color,
        radius: preset.radius,
      })),
      backdropProfiles: [
        { id: 'global', label: 'Global Backdrop', builtIn: true },
        ...Object.values(LEVELS).map((level) => ({ id: level.id, label: level.name, builtIn: true })),
      ],
    });
  }

  private renderAssetBrowser(): void {
    const panel = this.el<HTMLDivElement>('builder-assets');
    const previousSourceScroll = this.pendingAssetBrowserSourceScroll ?? panel.querySelector<HTMLElement>('.ba-sources')?.scrollTop ?? 0;
    const previousListScroll = this.pendingAssetBrowserListScroll ?? panel.querySelector<HTMLElement>('#ba-list')?.scrollTop ?? 0;
    this.pendingAssetBrowserSourceScroll = null;
    this.pendingAssetBrowserListScroll = null;
    const database = this.createAssetDatabase();
    const records = this.currentAssetBrowserRecords(database);
    if (this.assetSelectedId && !database.get(this.assetSelectedId)) this.assetSelectedId = null;
    this.sanitizeAssetBatchSelection(database);
    const hiddenSelectedCount = this.selectedAssetRecords(database).filter((record) => !records.some((visible) => visible.assetId === record.assetId)).length;
    const batchDeleteBlockedReason = this.assetBatchDeleteBlockedReason(database);
    panel.innerHTML = renderAssetBrowserPanel({
      query: this.assetQuery,
      view: this.assetView,
      sort: this.assetSort,
      collection: this.assetCollection,
      kindFilters: this.assetKindFilters,
      originFilters: this.assetOriginFilters,
      records,
      selectedId: this.assetSelectedId,
      selectedIds: this.assetSelectedIds,
      hiddenSelectedCount,
      batchDeleteBlockedReason,
      stats: database.stats(),
      collapsedSections: this.workspaceLayout.collapsedSections,
    });
    this.refreshPanelDragHandles(panel);
    this.wireCollapsibleSections(panel);
    this.paintAssetPreviews(panel, database);
    this.restoreAssetBrowserScroll(panel, previousSourceScroll, previousListScroll);
    this.restoreAssetBrowserFocus(panel);
    panel.querySelector('#ba-close')?.addEventListener('click', () => this.closeWorkspacePanel('builder-assets'));
    panel.querySelector('#ba-import')?.addEventListener('click', () => this.runUiCommand('builder.assetImport'));
    panel.querySelector('#ba-view')?.addEventListener('click', () => {
      this.assetView = this.assetView === 'grid' ? 'list' : 'grid';
      this.renderAssetBrowser();
    });
    const selectVisible = panel.querySelector<HTMLInputElement>('#ba-select-visible');
    if (selectVisible) {
      const visibleSelected = records.filter((record) => this.assetSelectedIds.has(record.assetId)).length;
      selectVisible.indeterminate = visibleSelected > 0 && visibleSelected < records.length;
      selectVisible.addEventListener('change', () => {
        this.assetBrowserFocusTarget = { kind: 'select-visible' };
        if (selectVisible.checked) {
          for (const record of records) this.assetSelectedIds.add(record.assetId);
          this.assetRangeAnchorId = records.length > 0 ? records[records.length - 1].assetId : this.assetRangeAnchorId;
        } else {
          for (const record of records) this.assetSelectedIds.delete(record.assetId);
          if (this.assetRangeAnchorId && !this.assetSelectedIds.has(this.assetRangeAnchorId)) {
            this.assetRangeAnchorId = this.assetSelectedIds.values().next().value ?? null;
          }
        }
        this.renderAssetBrowser();
      });
    }
    panel.querySelector('#ba-batch-export')?.addEventListener('click', () => void this.runAssetBatchAction('export'));
    panel.querySelector('#ba-batch-delete')?.addEventListener('click', () => void this.runAssetBatchAction('delete'));
    panel.querySelector('#ba-batch-clear')?.addEventListener('click', () => {
      this.assetSelectedIds.clear();
      this.assetRangeAnchorId = null;
      this.assetBrowserFocusTarget = { kind: 'batch-clear' };
      this.renderAssetBrowser();
    });
    panel.querySelector<HTMLSelectElement>('#ba-sort')?.addEventListener('change', (event) => {
      this.assetSort = (event.target as HTMLSelectElement).value as AssetSortMode;
      this.renderAssetBrowser();
    });
    panel.querySelector<HTMLInputElement>('#ba-search')?.addEventListener('input', (event) => {
      this.assetQuery = (event.target as HTMLInputElement).value;
      this.renderAssetBrowser();
      this.el<HTMLInputElement>('ba-search')?.focus({ preventScroll: true });
    });
    for (const tab of panel.querySelectorAll<HTMLButtonElement>('button[data-asset-tab]')) {
      tab.addEventListener('click', () => {
        const next = tab.dataset.assetTab;
        if (next === 'imports') this.setAssetCollection('imported');
        else if (next === 'current') this.setAssetCollection('usedByCurrentDocument');
        else this.setAssetCollection('all');
        this.renderAssetBrowser();
      });
    }
    for (const chip of panel.querySelectorAll<HTMLElement>('[data-asset-collection]')) {
      const activate = (): void => {
        this.setAssetCollection(chip.dataset.assetCollection as AssetSmartCollection);
        this.renderAssetBrowser();
      };
      chip.addEventListener('click', activate);
      chip.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });
    }
    for (const chip of panel.querySelectorAll<HTMLElement>('[data-asset-kind-filter]')) {
      const activate = (): void => {
        const kind = chip.dataset.assetKindFilter as AssetKind;
        if (this.assetKindFilters.has(kind)) this.assetKindFilters.delete(kind);
        else this.assetKindFilters.add(kind);
        this.renderAssetBrowser();
      };
      chip.addEventListener('click', activate);
      chip.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });
    }
    for (const chip of panel.querySelectorAll<HTMLElement>('[data-asset-origin-filter]')) {
      const activate = (): void => {
        const origin = chip.dataset.assetOriginFilter as AssetOrigin;
        if (this.assetOriginFilters.has(origin)) this.assetOriginFilters.delete(origin);
        else this.assetOriginFilters.add(origin);
        this.renderAssetBrowser();
      };
      chip.addEventListener('click', activate);
      chip.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });
    }
    for (const row of panel.querySelectorAll<HTMLElement>('.ba-card[data-asset-id], .ba-row[data-asset-id]')) {
      row.querySelector<HTMLInputElement>('input[data-asset-select]')?.addEventListener('click', (event) => {
        event.stopPropagation();
        const assetId = row.dataset.assetId;
        if (!assetId || !event.shiftKey) return;
        event.preventDefault();
        this.selectAssetBatchRange(records, assetId);
        this.assetSelectedId = assetId;
        this.assetBrowserFocusTarget = { kind: 'checkbox', assetId };
        this.renderAssetBrowser();
      });
      row.querySelector<HTMLInputElement>('input[data-asset-select]')?.addEventListener('change', (event) => {
        event.stopPropagation();
        const assetId = row.dataset.assetId;
        if (!assetId) return;
        const checked = (event.target as HTMLInputElement).checked;
        if (checked) this.assetSelectedIds.add(assetId);
        else this.assetSelectedIds.delete(assetId);
        this.assetRangeAnchorId = assetId;
        this.assetSelectedId = assetId;
        this.assetBrowserFocusTarget = { kind: 'checkbox', assetId };
        this.renderAssetBrowser();
      });
      row.addEventListener('click', (event) => {
        const assetId = row.dataset.assetId;
        if (!assetId) return;
        if ((event.target as HTMLElement | null)?.closest('.ba-select-box')) return;
        if (event.shiftKey) {
          this.selectAssetBatchRange(records, assetId);
          this.assetSelectedId = assetId;
          this.assetBrowserFocusTarget = { kind: 'row', assetId };
          this.renderAssetBrowser();
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          if (this.assetSelectedIds.has(assetId)) this.assetSelectedIds.delete(assetId);
          else this.assetSelectedIds.add(assetId);
          this.assetRangeAnchorId = assetId;
          this.assetSelectedId = assetId;
          this.assetBrowserFocusTarget = { kind: 'row', assetId };
          this.renderAssetBrowser();
          return;
        }
        this.assetSelectedIds.clear();
        this.assetRangeAnchorId = null;
        this.capturePendingAssetBrowserScroll(panel);
        const sourceScroll = this.pendingAssetBrowserSourceScroll ?? 0;
        const listScroll = this.pendingAssetBrowserListScroll ?? 0;
        this.assetSelectedId = assetId;
        const record = database.get(assetId);
        if (record) this.selectPrefabAssetRecord(record, true);
        this.setWorkspacePanelOpen('builder-asset-details', true);
        this.el<HTMLDivElement>('builder-asset-details').style.display = '';
        this.applyWorkspaceLayout();
        this.updateAssetBrowserSelection(panel);
        this.renderAssetDetails();
        this.restoreAssetBrowserScroll(panel, sourceScroll, listScroll);
        this.saveWorkspacePrefs();
      });
      row.addEventListener('keydown', (event) => {
        const assetId = row.dataset.assetId;
        if (!assetId) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          row.click();
          return;
        }
        if (event.key === ' ') {
          event.preventDefault();
          if (event.shiftKey) this.selectAssetBatchRange(records, assetId);
          else if (this.assetSelectedIds.has(assetId)) this.assetSelectedIds.delete(assetId);
          else this.assetSelectedIds.add(assetId);
          if (!event.shiftKey) this.assetRangeAnchorId = assetId;
          this.assetSelectedId = assetId;
          this.assetBrowserFocusTarget = { kind: 'row', assetId };
          this.renderAssetBrowser();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          for (const record of records) this.assetSelectedIds.add(record.assetId);
          this.assetRangeAnchorId = records.length > 0 ? records[0].assetId : null;
          this.assetBrowserFocusTarget = { kind: 'row', assetId };
          this.renderAssetBrowser();
          return;
        }
        if (event.key === 'Escape' && this.assetSelectedIds.size > 0) {
          event.preventDefault();
          this.assetSelectedIds.clear();
          this.assetRangeAnchorId = null;
          this.assetBrowserFocusTarget = { kind: 'row', assetId };
          this.renderAssetBrowser();
          return;
        }
        if (event.key === 'Delete' && this.assetSelectedIds.size > 0 && !this.assetBatchDeleteBlockedReason(database)) {
          event.preventDefault();
          void this.runAssetBatchAction('delete');
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const rows = [...panel.querySelectorAll<HTMLElement>('.ba-card[data-asset-id], .ba-row[data-asset-id]')];
        const index = rows.indexOf(row);
        const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
        if (!next) return;
        next.focus({ preventScroll: true });
        if (event.shiftKey) {
          const nextId = next.dataset.assetId;
          if (nextId) {
            this.selectAssetBatchRange(records, nextId);
            this.assetSelectedId = nextId;
            this.assetBrowserFocusTarget = { kind: 'row', assetId: nextId };
            this.renderAssetBrowser();
          }
        }
      });
      row.addEventListener('dragstart', (event) => {
        const assetId = row.dataset.assetId;
        if (!assetId || !event.dataTransfer) return;
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-noita-asset-id', assetId);
      });
    }
  }

  private capturePendingAssetBrowserScroll(panel = this.el<HTMLDivElement>('builder-assets')): void {
    this.pendingAssetBrowserSourceScroll = panel.querySelector<HTMLElement>('.ba-sources')?.scrollTop ?? 0;
    this.pendingAssetBrowserListScroll = panel.querySelector<HTMLElement>('#ba-list')?.scrollTop ?? 0;
  }

  private restoreAssetBrowserScroll(panel: HTMLElement, sourceScroll: number, listScroll: number): void {
    const restoreScroll = (): void => {
      panel.querySelector<HTMLElement>('.ba-sources')?.scrollTo({ top: sourceScroll });
      panel.querySelector<HTMLElement>('#ba-list')?.scrollTo({ top: listScroll });
    };
    restoreScroll();
    queueMicrotask(restoreScroll);
    requestAnimationFrame(() => {
      restoreScroll();
      requestAnimationFrame(restoreScroll);
    });
    window.setTimeout(restoreScroll, 0);
    window.setTimeout(restoreScroll, 80);
  }

  private setAssetCollection(collection: AssetSmartCollection): void {
    this.assetCollection = collection;
    if (collection === 'recent') this.assetSort = 'modified';
  }

  private updateAssetBrowserSelection(panel = this.el<HTMLDivElement>('builder-assets')): void {
    const rows = [...panel.querySelectorAll<HTMLElement>('.ba-card[data-asset-id], .ba-row[data-asset-id]')];
    let visibleSelected = 0;
    for (const row of rows) {
      const assetId = row.dataset.assetId ?? '';
      const multiSelected = this.assetSelectedIds.has(assetId);
      if (multiSelected) visibleSelected++;
      row.classList.toggle('selected', assetId === this.assetSelectedId);
      row.classList.toggle('multi-selected', multiSelected);
      row.setAttribute('aria-selected', multiSelected ? 'true' : 'false');
      const input = row.querySelector<HTMLInputElement>('input[data-asset-select]');
      if (input) input.checked = multiSelected;
    }
    const database = this.createAssetDatabase();
    const hiddenSelectedCount = this.selectedAssetRecords(database).filter((record) =>
      !rows.some((row) => row.dataset.assetId === record.assetId),
    ).length;
    const deleteBlockedReason = this.assetBatchDeleteBlockedReason(database);
    const selectedCount = this.assetSelectedIds.size;
    const count = panel.querySelector<HTMLElement>('.ba-selected-count');
    if (count) {
      count.textContent = `${selectedCount === 1 ? '1 selected' : `${selectedCount} selected`}${hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} hidden)` : ''}`;
    }
    const exportButton = panel.querySelector<HTMLButtonElement>('#ba-batch-export');
    if (exportButton) exportButton.disabled = selectedCount === 0;
    const clearButton = panel.querySelector<HTMLButtonElement>('#ba-batch-clear');
    if (clearButton) clearButton.disabled = selectedCount === 0;
    const deleteButton = panel.querySelector<HTMLButtonElement>('#ba-batch-delete');
    if (deleteButton) {
      deleteButton.disabled = selectedCount === 0 || deleteBlockedReason !== undefined;
      deleteButton.title = deleteBlockedReason ?? 'Delete selected local assets';
    }
    const selectVisible = panel.querySelector<HTMLInputElement>('#ba-select-visible');
    if (selectVisible) {
      selectVisible.checked = rows.length > 0 && visibleSelected === rows.length;
      selectVisible.indeterminate = visibleSelected > 0 && visibleSelected < rows.length;
      selectVisible.disabled = rows.length === 0;
    }
  }

  private sanitizeAssetBatchSelection(database: AssetDatabase): void {
    for (const assetId of [...this.assetSelectedIds]) {
      if (!database.get(assetId)) this.assetSelectedIds.delete(assetId);
    }
    if (this.assetRangeAnchorId && !database.get(this.assetRangeAnchorId)) {
      this.assetRangeAnchorId = this.assetSelectedIds.values().next().value ?? null;
    }
  }

  private selectAssetBatchRange(records: readonly AssetRecord[], assetId: string): void {
    const ids = records.map((record) => record.assetId);
    const to = ids.indexOf(assetId);
    if (to < 0) return;
    const from = this.assetRangeAnchorId ? ids.indexOf(this.assetRangeAnchorId) : -1;
    const start = from >= 0 ? Math.min(from, to) : to;
    const end = from >= 0 ? Math.max(from, to) : to;
    for (let i = start; i <= end; i++) this.assetSelectedIds.add(ids[i]);
    if (!this.assetRangeAnchorId) this.assetRangeAnchorId = assetId;
  }

  private selectedAssetRecords(database: AssetDatabase): AssetRecord[] {
    this.sanitizeAssetBatchSelection(database);
    return database.list().filter((record) => this.assetSelectedIds.has(record.assetId));
  }

  private currentAssetBrowserRecords(database: AssetDatabase): AssetRecord[] {
    return database.query({
      text: this.assetQuery,
      kinds: this.assetKindFilters.size > 0 ? [...this.assetKindFilters] : undefined,
      origins: this.assetOriginFilters.size > 0 ? [...this.assetOriginFilters] : undefined,
      collection: this.assetCollection,
      sort: this.assetSort,
    });
  }

  private assetBatchDeleteBlockedReason(database: AssetDatabase): string | undefined {
    const records = this.selectedAssetRecords(database);
    if (records.length === 0) return undefined;
    const blocked = records
      .map((record) => ({ record, plan: database.deletePlan(record.assetId) }))
      .filter(({ plan }) => !plan.allowed);
    if (blocked.length === 0) return undefined;
    const first = blocked[0];
    return `${blocked.length} selected asset${blocked.length === 1 ? '' : 's'} cannot be deleted: ${first.record.name} - ${first.plan.reasons[0] ?? 'blocked'}`;
  }

  private restoreAssetBrowserFocus(panel: HTMLElement): void {
    const target = this.assetBrowserFocusTarget;
    if (!target) return;
    this.assetBrowserFocusTarget = null;
    const focus = (): void => {
      const el = this.assetBrowserFocusElement(panel, target);
      el?.focus({ preventScroll: true });
    };
    queueMicrotask(focus);
    requestAnimationFrame(focus);
  }

  private assetBrowserFocusElement(panel: HTMLElement, target: AssetBrowserFocusTarget): HTMLElement | null {
    if (target.kind === 'select-visible') return panel.querySelector<HTMLElement>('#ba-select-visible');
    if (target.kind === 'batch-export') return panel.querySelector<HTMLElement>('#ba-batch-export');
    if (target.kind === 'batch-delete') return panel.querySelector<HTMLElement>('#ba-batch-delete');
    if (target.kind === 'batch-clear') return panel.querySelector<HTMLElement>('#ba-batch-clear');
    for (const row of panel.querySelectorAll<HTMLElement>('.ba-card[data-asset-id], .ba-row[data-asset-id]')) {
      if (row.dataset.assetId !== target.assetId) continue;
      if (target.kind === 'checkbox') return row.querySelector<HTMLElement>('input[data-asset-select]') ?? row;
      return row;
    }
    return null;
  }

  private selectPrefabAsset(prefab: PrefabDef, origin: 'built-in' | 'library', openDetails: boolean): void {
    this.prefabSelectedAssetId = stableAssetId('prefab', origin, prefab.id);
    this.prefabActiveVariant = 'base';
    this.prefabSelectedAnchorId = prefab.anchors?.[0]?.id ?? null;
    if (openDetails) {
      this.setWorkspacePanelOpen('builder-prefab-details', true);
      this.el<HTMLDivElement>('builder-prefab-details').style.display = '';
      this.applyWorkspaceLayout();
      this.saveWorkspacePrefs();
    }
    this.renderPrefabDetailsIfOpen();
  }

  private selectPrefabAssetRecord(record: AssetRecord, openDetails: boolean): PrefabDef | null {
    if (record.kind !== 'prefab' || !isPrefabAsset(record.payload)) return null;
    if (record.origin !== 'built-in' && record.origin !== 'library') return null;
    this.selectPrefabAsset(record.payload, record.origin, openDetails);
    return record.payload;
  }

  private renderAssetDetails(): void {
    const panel = this.el<HTMLDivElement>('builder-asset-details');
    const database = this.createAssetDatabase();
    const asset = this.assetSelectedId ? database.get(this.assetSelectedId) : null;
    panel.innerHTML = renderAssetDetailPanel({
      asset,
      deletePlan: asset ? database.deletePlan(asset.assetId) : undefined,
    });
    this.refreshPanelDragHandles(panel);
    this.paintAssetPreviews(panel, database);
    panel.querySelector('#bad-close')?.addEventListener('click', () => this.closeWorkspacePanel('builder-asset-details'));
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-asset-action]')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const assetId = button.dataset.assetId;
        if (!assetId) return;
        void this.runAssetAction(button.dataset.assetAction ?? '', assetId);
      });
    }
    for (const usage of panel.querySelectorAll<HTMLButtonElement>('button[data-reveal-usage]')) {
      usage.addEventListener('click', () => {
        const sourceId = usage.dataset.revealUsage;
        const source = sourceId ? database.get(sourceId) : null;
        if (!source) return;
        this.assetSelectedId = source.assetId;
        this.renderAssetDetails();
        this.status(`USAGE: ${source.name.toUpperCase()}`);
      });
    }
  }

  private renderPrefabDetails(): void {
    const panel = this.el<HTMLDivElement>('builder-prefab-details');
    const previousScroll = panel.scrollTop;
    const focusTarget = this.prefabDetailFocusTarget(panel);
    const database = this.createAssetDatabase();
    const record = this.prefabSelectedAssetId ? database.get(this.prefabSelectedAssetId) : null;
    const base = record && record.kind === 'prefab' && isPrefabAsset(record.payload) ? record.payload : null;
    const activeVariant = base ? prefabVariant(base, this.prefabActiveVariant) : null;
    if (activeVariant && this.prefabSelectedAnchorId && !activeVariant.anchors?.some((anchor) => anchor.id === this.prefabSelectedAnchorId)) {
      this.prefabSelectedAnchorId = activeVariant.anchors?.[0]?.id ?? null;
    }
    panel.innerHTML = renderPrefabDetailPanel({
      prefab: activeVariant,
      asset: record,
      activeVariant: this.prefabActiveVariant,
      selectedAnchorId: this.prefabSelectedAnchorId,
    });
    this.refreshPanelDragHandles(panel);
    panel.querySelector('#bpd-close')?.addEventListener('click', () => this.closeWorkspacePanel('builder-prefab-details'));
    this.restorePrefabDetailsView(panel, previousScroll, focusTarget);
    if (!base || !record) return;
    this.paintPrefabDetailPreviews(panel, base, activeVariant);
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-prefab-variant]')) {
      button.addEventListener('click', () => {
        const variant = button.dataset.prefabVariant as PrefabVariantId | undefined;
        if (!variant) return;
        this.prefabActiveVariant = variant;
        this.prefabSelectedAnchorId = prefabVariant(base, variant).anchors?.[0]?.id ?? null;
        if (this.armedPrefab?.id === base.id) {
          this.armedPrefab = prefabVariant(base, this.prefabActiveVariant);
          this.refreshPrefabs();
        } else {
          this.renderPrefabDetails();
        }
      });
    }
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-prefab-anchor]')) {
      button.addEventListener('click', () => {
        const anchorId = button.dataset.prefabAnchor;
        if (!anchorId) return;
        this.prefabSelectedAnchorId = this.prefabSelectedAnchorId === anchorId ? null : anchorId;
        if (this.armedPrefab?.id === base.id) this.armedPrefab = prefabVariant(base, this.prefabActiveVariant);
        this.renderPrefabDetails();
      });
    }
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-prefab-action]')) {
      button.addEventListener('click', () => {
        const action = button.dataset.prefabAction;
        void this.runPrefabDetailAction(action ?? '', record, base);
      });
    }
  }

  private prefabDetailFocusTarget(panel: HTMLElement): PrefabDetailFocusTarget | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !panel.contains(active)) return null;
    if (active.id === 'bpd-close') return { kind: 'close' };
    const variant = active.closest<HTMLElement>('[data-prefab-variant]');
    if (variant?.dataset.prefabVariant) return { kind: 'variant', id: variant.dataset.prefabVariant };
    const anchor = active.closest<HTMLElement>('[data-prefab-anchor]');
    if (anchor?.dataset.prefabAnchor) return { kind: 'anchor', id: anchor.dataset.prefabAnchor };
    const action = active.closest<HTMLElement>('[data-prefab-action]');
    if (action?.dataset.prefabAction) return { kind: 'action', id: action.dataset.prefabAction };
    return null;
  }

  private restorePrefabDetailsView(
    panel: HTMLElement,
    scrollTop: number,
    focusTarget: PrefabDetailFocusTarget | null,
  ): void {
    const restore = (): void => {
      panel.scrollTop = scrollTop;
      const target = focusTarget ? this.prefabDetailFocusElement(panel, focusTarget) : null;
      target?.focus({ preventScroll: true });
    };
    restore();
    queueMicrotask(restore);
    requestAnimationFrame(restore);
  }

  private prefabDetailFocusElement(panel: HTMLElement, target: PrefabDetailFocusTarget): HTMLElement | null {
    if (target.kind === 'close') return panel.querySelector<HTMLElement>('#bpd-close');
    if (target.kind === 'variant') {
      return [...panel.querySelectorAll<HTMLElement>('[data-prefab-variant]')]
        .find((element) => element.dataset.prefabVariant === target.id) ?? null;
    }
    if (target.kind === 'anchor') {
      return [...panel.querySelectorAll<HTMLElement>('[data-prefab-anchor]')]
        .find((element) => element.dataset.prefabAnchor === target.id) ?? null;
    }
    return [...panel.querySelectorAll<HTMLElement>('[data-prefab-action]')]
      .find((element) => element.dataset.prefabAction === target.id) ?? null;
  }

  private paintPrefabDetailPreviews(panel: HTMLElement, base: PrefabDef, activeVariant: PrefabDef | null): void {
    const large = panel.querySelector<HTMLCanvasElement>('canvas[data-prefab-preview]');
    if (large && activeVariant) paintPrefabPreviewCanvas(large, activeVariant);
    for (const canvas of panel.querySelectorAll<HTMLCanvasElement>('canvas[data-prefab-variant-preview]')) {
      const variant = canvas.dataset.prefabVariantPreview as PrefabVariantId | undefined;
      if (variant) paintPrefabPreviewCanvas(canvas, prefabVariant(base, variant));
    }
  }

  private async runPrefabDetailAction(action: string, record: AssetRecord, base: PrefabDef): Promise<void> {
    const variant = prefabVariant(base, this.prefabActiveVariant);
    if (action === 'arm') {
      const blocker = this.prefabPlacementBlocker(record);
      if (blocker) {
        this.status(blocker, true);
        return;
      }
      this.armedPrefab = variant;
      this.setTool('stamp');
      this.refreshPrefabs();
      this.status(this.prefabPlacementWarning(record) ?? `PREFAB VARIANT ARMED: "${base.name.toUpperCase()}" — CLICK TO STAMP`);
      return;
    }
    if (action === 'asset') {
      this.assetSelectedId = record.assetId;
      this.openWorkspacePanel('builder-asset-details');
      this.status(`ASSET DETAILS: ${record.name.toUpperCase()}`);
      return;
    }
    if (action === 'export-json') {
      const exported = this.prefabVariantExport(base, variant);
      downloadJson(exported, `${exported.name || 'prefab'}.prefab.json`);
      this.status(`EXPORTED "${base.name.toUpperCase()}" ${this.prefabActiveVariant.toUpperCase()} AS JSON`);
      return;
    }
    if (action === 'export-png') {
      await this.exportPrefabPng(variant);
      return;
    }
    if (action === 'anchors') {
      if (record.immutable) {
        this.status('BUILT-IN PREFABS ARE IMMUTABLE — DUPLICATE OR EXPORT BEFORE EDITING ANCHORS', true);
        return;
      }
      await this.editPrefabAnchors(base);
      this.prefabSelectedAnchorId = base.anchors?.[0]?.id ?? null;
      this.renderPrefabDetails();
    }
  }

  private prefabVariantExport(base: PrefabDef, variant: PrefabDef): PrefabDef {
    const suffix = this.prefabActiveVariant === 'base' ? 'detail export' : this.prefabActiveVariant;
    return {
      ...structuredClone(variant),
      id: freshId('prefab'),
      name: this.prefabActiveVariant === 'base' ? `${base.name} copy` : `${base.name} ${suffix}`,
      tags: [...new Set([...variant.tags, 'variant', this.prefabActiveVariant])],
      createdAt: new Date().toISOString(),
    };
  }

  private prefabPlacementBlocker(record: AssetRecord | null): string | null {
    if (!record) return null;
    if (record.origin === 'missing' || record.origin === 'broken') return 'PREFAB ASSET IS MISSING OR BROKEN';
    if (record.dependencies.missing.length > 0) {
      return `PREFAB HAS MISSING DEPENDENCIES: ${record.dependencies.missing.map((ref) => ref.sourceId).join(', ').toUpperCase()}`;
    }
    if (record.dependencies.broken.length > 0 || record.dependencies.state === 'broken') {
      return `PREFAB HAS BROKEN DEPENDENCIES: ${record.dependencies.broken.map((ref) => ref.sourceId).join(', ').toUpperCase()}`;
    }
    if (record.validation.state === 'error') {
      return `PREFAB VALIDATION ERROR: ${record.validation.messages[0]?.toUpperCase() ?? record.name.toUpperCase()}`;
    }
    return null;
  }

  private prefabPlacementWarning(record: AssetRecord | null): string | null {
    if (!record) return null;
    if (record.validation.state === 'warning') {
      return `PREFAB WARNING: ${record.validation.messages[0]?.toUpperCase() ?? record.name.toUpperCase()} — PLACEMENT ALLOWED`;
    }
    if (record.dependencies.state === 'unknown') return 'PREFAB DEPENDENCIES UNKNOWN — PLACEMENT ALLOWED';
    return null;
  }

  private selectDuplicatedPrefabRecord(original: AssetRecord): void {
    if (original.kind !== 'prefab') return;
    const database = this.createAssetDatabase();
    const expectedName = `${original.name} copy`;
    const candidates = database.query({ kinds: ['prefab'], origins: ['library'], sort: 'modified' })
      .filter((record) =>
        record.sourceId !== original.sourceId &&
        record.name === expectedName &&
        isPrefabAsset(record.payload),
      );
    const copy = candidates[0];
    if (!copy || !isPrefabAsset(copy.payload)) return;
    this.assetSelectedId = copy.assetId;
    this.selectPrefabAsset(copy.payload, 'library', this.isWorkspacePanelOpen('builder-prefab-details'));
    if (this.isWorkspacePanelOpen('builder-asset-details')) this.renderAssetDetails();
    this.status(`DUPLICATED PREFAB: ${copy.name.toUpperCase()} — EDITABLE PROJECT COPY`);
  }

  private paintAssetPreviews(panel: HTMLElement, database: AssetDatabase): void {
    for (const canvas of panel.querySelectorAll<HTMLCanvasElement>('canvas[data-asset-id]')) {
      const asset = database.get(canvas.dataset.assetId ?? '');
      if (asset) paintAssetPreview(canvas, asset);
    }
  }

  private syncAssetPanels(): void {
    if (this.isWorkspacePanelOpen('builder-assets')) this.renderAssetBrowser();
    if (this.isWorkspacePanelOpen('builder-asset-details')) this.renderAssetDetails();
    if (this.isWorkspacePanelOpen('builder-prefab-details')) this.renderPrefabDetails();
  }

  private renderPrefabDetailsIfOpen(): void {
    if (this.isWorkspacePanelOpen('builder-prefab-details')) this.renderPrefabDetails();
  }

  private syncStructurePanels(): void {
    if (this.isWorkspacePanelOpen('builder-issues')) {
      this.renderIssues(this.currentValidationIssues());
      return;
    }
    if (this.isWorkspacePanelOpen('builder-outliner')) this.renderOutliner();
    if (this.isWorkspacePanelOpen('builder-link-graph')) this.renderLinkGraph();
  }

  private refreshAssetLibraries(): void {
    this.prefabs = loadPrefabs();
    this.sprites = loadSprites();
    this.sanitizeArmedAssetsAfterLibraryRefresh();
    this.spriteFrameCache.clear();
    this.refreshPrefabs();
    this.refreshSprites();
    this.refreshDocSelect();
    this.syncMarkers();
    this.renderInspector();
    this.syncAssetPanels();
  }

  private sanitizeArmedAssetsAfterLibraryRefresh(): void {
    const database = this.createAssetDatabase();
    if (this.prefabSelectedAssetId && !database.get(this.prefabSelectedAssetId)) {
      this.prefabSelectedAssetId = null;
      this.prefabSelectedAnchorId = null;
      this.prefabActiveVariant = 'base';
    }
    if (this.armedPrefab) {
      const record = this.prefabSelectedAssetId ? database.get(this.prefabSelectedAssetId) : null;
      const valid =
        record?.kind === 'prefab' &&
        isPrefabAsset(record.payload) &&
        record.payload.id === this.armedPrefab.id;
      if (!valid) {
        this.armedPrefab = null;
        if (this.tool === 'stamp') this.setTool('select');
      }
    }
    if (this.armedSprite) {
      const valid = database.list().some((record) =>
        record.kind === 'sprite' &&
        (record.origin === 'library' || record.origin === 'document-embedded') &&
        isSpriteAsset(record.payload) &&
        record.payload.id === this.armedSprite?.id,
      );
      if (!valid) {
        this.armedSprite = null;
        if (this.tool === 'decor') this.setTool('select');
      }
    }
  }

  private async importAssetJsonFiles(): Promise<void> {
    const files = await pickFiles('.json', true);
    if (files.length === 0) return;
    let imported = 0;
    for (const file of files) {
      const result = importJsonAsset(
        { fileName: file.name, text: await file.text() },
        this.assetStore,
        this.createAssetDatabase(),
      );
      if (result.ok && result.report.decision !== 'duplicate') imported++;
      this.status(result.message, !result.ok || result.report.warnings.length > 0);
      this.prefabs = loadPrefabs();
      this.sprites = loadSprites();
    }
    if (imported > 0) this.setAssetCollection('recent');
    this.refreshAssetLibraries();
  }

  private async runAssetBatchAction(action: 'export' | 'delete'): Promise<void> {
    const database = this.createAssetDatabase();
    const records = this.selectedAssetRecords(database);
    const visibleIds = new Set(this.currentAssetBrowserRecords(database).map((record) => record.assetId));
    const hiddenCount = records.filter((record) => !visibleIds.has(record.assetId)).length;
    if (records.length === 0) {
      this.status('SELECT ASSETS FIRST', true);
      return;
    }
    if (action === 'export') {
      const exported = records
        .map((record) => ({ record, exported: this.exportAssetRecord(record) }))
        .filter((entry): entry is { record: AssetRecord; exported: AssetStoreExport } => entry.exported !== null);
      if (exported.length === 0) {
        this.status('NO SELECTED ASSETS CAN BE EXPORTED', true);
        return;
      }
      const skipped = records.length - exported.length;
      const bundle = {
        v: 1,
        kind: 'assetExportBundle',
        exportedAt: new Date().toISOString(),
        assets: exported.map(({ record, exported }) => ({
          assetId: record.assetId,
          kind: record.kind,
          origin: record.origin,
          sourceId: record.sourceId,
          filename: exported.filename,
          mime: exported.mime,
          text: exported.text,
        })),
      };
      downloadText(
        JSON.stringify(bundle, null, 2),
        `alchemists-descent-${exported.length}-assets.bundle.json`,
        'application/json',
      );
      this.status(
        `EXPORTED ${exported.length} ASSET${exported.length === 1 ? '' : 'S'}` +
          (hiddenCount > 0 ? ` (${hiddenCount} HIDDEN SELECTED)` : '') +
          (skipped > 0 ? ` (${skipped} SKIPPED)` : ''),
      );
      return;
    }

    const blocked = records
      .map((record) => ({ record, plan: database.deletePlan(record.assetId) }))
      .filter(({ plan }) => !plan.allowed);
    if (blocked.length > 0) {
      const lines = blocked.slice(0, 8).map(({ record, plan }) => `- ${record.name}: ${plan.reasons.join('; ')}`);
      const more = blocked.length > lines.length ? `- +${blocked.length - lines.length} more blocked asset(s)` : '';
      await appDialog.alert(
        [`Batch delete is blocked for ${blocked.length} selected asset(s).`, ...lines, more].filter(Boolean).join('\n'),
        'Batch Delete Blocked',
      );
      this.status(`BATCH DELETE BLOCKED: ${blocked.length} ASSET${blocked.length === 1 ? '' : 'S'}`, true);
      this.renderAssetDetails();
      return;
    }
    const previewLines = records.slice(0, 10).map((record) => `- ${record.name} (${record.kind})`);
    const more = records.length > previewLines.length ? `- +${records.length - previewLines.length} more asset(s)` : '';
    if (
      !(await appDialog.confirm(
        [
          `Delete ${records.length} selected asset${records.length === 1 ? '' : 's'}?`,
          hiddenCount > 0 ? `${hiddenCount} selected asset${hiddenCount === 1 ? ' is' : 's are'} hidden by the current filter/search.` : '',
          ...previewLines,
          more,
        ].filter(Boolean).join('\n'),
        {
          title: 'Delete Selected Assets',
          confirmText: 'Delete',
          tone: 'danger',
        },
      ))
    )
      return;
    let deleted = 0;
    const failures: string[] = [];
    for (const record of records) {
      const result = this.assetStore.delete(record);
      if (result.ok) {
        deleted++;
        this.assetSelectedIds.delete(record.assetId);
        if (this.assetSelectedId === record.assetId) this.assetSelectedId = null;
      } else {
        failures.push(`${record.name}: ${result.message}`);
      }
    }
    if (failures.length > 0) {
      await appDialog.alert(failures.slice(0, 8).join('\n'), 'Batch Delete Incomplete');
    }
    this.status(
      `DELETED ${deleted}/${records.length} SELECTED ASSET${records.length === 1 ? '' : 'S'}` +
        (failures.length > 0 ? ` - ${failures.length} FAILED` : ''),
      failures.length > 0,
    );
    this.refreshAssetLibraries();
  }

  private exportAssetRecord(record: AssetRecord): AssetStoreExport | null {
    if (record.kind === 'document' && isDocumentAsset(record.payload)) {
      const sourceDoc = record.source.storage === 'document' ? this.doc : record.payload;
      const doc = structuredClone(sourceDoc);
      embedSprites(doc, this.sprites);
      return {
        filename: `${doc.name || 'level'}.builder.json`,
        mime: 'application/json',
        text: JSON.stringify(doc, null, 2),
      };
    }
    return this.assetStore.export(record);
  }

  private async runAssetAction(action: string, assetId: string): Promise<void> {
    const database = this.createAssetDatabase();
    const record = database.get(assetId);
    if (!record) {
      this.status('ASSET NOT FOUND', true);
      return;
    }
    if (action === 'open') {
      await this.openDocumentAsset(record);
      return;
    }
    if (record.source.storage === 'document' && action !== 'export') {
      this.status('CURRENT DOCUMENT ASSET ACTIONS USE BUILDER DOCUMENT COMMANDS', true);
      this.renderAssetDetails();
      return;
    }
    if (action === 'rename') {
      const name = await appDialog.prompt(`Rename "${record.name}" without changing its stable id:`, record.name, {
        title: 'Rename Asset',
        confirmText: 'Rename',
      });
      if (name === null) return;
      const result = this.assetStore.rename(record, name);
      this.status(result.message, !result.ok);
      if (result.ok) this.refreshAssetLibraries();
      return;
    }
    if (action === 'duplicate') {
      const result = this.assetStore.duplicate(record);
      this.status(result.message, !result.ok);
      if (result.ok) {
        this.refreshAssetLibraries();
        this.selectDuplicatedPrefabRecord(record);
      }
      return;
    }
    if (action === 'reimport') {
      await this.reimportAssetRecord(record);
      return;
    }
    if (action === 'export') {
      if (record.kind === 'sprite' && isSpriteAsset(record.payload)) {
        await this.exportSprite(record.payload);
        return;
      }
      const exported = this.exportAssetRecord(record);
      if (!exported) {
        this.status(`${record.kind.toUpperCase()} EXPORT IS NOT AVAILABLE`, true);
        return;
      }
      downloadText(exported.text, exported.filename, exported.mime);
      this.status(
        record.kind === 'document'
          ? 'EXPORTED DOCUMENT WITH REFERENCED PORTABLE ASSETS'
          : `EXPORTED ${record.name.toUpperCase()}${record.source.storage === 'content-registry' ? ' METADATA' : ''}`,
      );
      return;
    }
    if (action === 'delete') {
      const plan = database.deletePlan(record.assetId);
      if (!plan.allowed) {
        this.status(plan.reasons.join(' | ').toUpperCase(), true);
        this.renderAssetDetails();
        return;
      }
      if (
        !(await appDialog.confirm(`Delete "${record.name}"?`, {
          title: 'Delete Asset',
          confirmText: 'Delete',
          tone: 'danger',
        }))
      )
        return;
      const result = this.assetStore.delete(record);
      this.status(result.message, !result.ok);
      if (result.ok) {
        this.assetSelectedId = null;
        this.refreshAssetLibraries();
      }
    }
  }

  private async reimportAssetRecord(record: AssetRecord): Promise<void> {
    if (!this.canReimportAsset(record)) {
      this.status(`${record.kind.toUpperCase()} REIMPORT IS NOT AVAILABLE`, true);
      this.renderAssetDetails();
      return;
    }
    const files = await pickFiles('.json', false);
    const file = files[0];
    if (!file) return;
    const input = { fileName: file.name, text: await file.text() };
    const preview = previewReimport(record, input);
    if (!preview.ok) {
      await appDialog.alert(
        [
          `Reimport blocked for "${record.name}".`,
          ...preview.errors,
          ...preview.warnings,
        ].filter(Boolean).join('\n'),
        'Reimport Blocked',
      );
      const result = this.assetStore.reimportJson(record, input);
      this.status(result.message, true);
      this.refreshAssetLibraries();
      return;
    }
    if (!preview.sameContent) {
      const usageLines = record.usages.slice(0, 8).map((usage) => `- ${usage.label} (${usage.path})`);
      const more = record.usages.length > usageLines.length ? `- +${record.usages.length - usageLines.length} more usage(s)` : '';
      const ok = await appDialog.confirm(
        [
          `Replace "${record.name}" while preserving stable id "${record.assetId}"?`,
          ...preview.changes,
          preview.warnings.length > 0 ? `Warnings: ${preview.warnings.join('; ')}` : '',
          record.usages.length > 0 ? `Usages affected:\n${[...usageLines, more].filter(Boolean).join('\n')}` : 'No indexed usages.',
        ].filter(Boolean).join('\n\n'),
        {
          title: 'Reimport Asset',
          confirmText: 'Replace',
          tone: record.usages.length > 0 ? 'danger' : 'normal',
        },
      );
      if (!ok) return;
    }
    const result = this.assetStore.reimportJson(record, input);
    this.status(result.message, !result.ok || result.report.warnings.length > 0);
    this.assetSelectedId = record.assetId;
    if (result.ok && result.report.decision === 'collision-replace') this.setAssetCollection('recent');
    this.refreshAssetLibraries();
  }

  private canReimportAsset(record: AssetRecord): boolean {
    return !record.immutable &&
      record.source.storage === 'localStorage' &&
      (record.kind === 'document' || record.kind === 'prefab' || record.kind === 'sprite');
  }

  private placeAssetDrop(assetId: string, event: DragEvent): void {
    if (this.previewBlocks() || this.livePreviewActionBlocks('Place asset')) return;
    const record = this.createAssetDatabase().get(assetId);
    if (!record) return;
    const pos = this.mouseToWorld(event);
    if (record.kind === 'prefab' && isPrefabAsset(record.payload)) {
      const blocker = this.prefabPlacementBlocker(record);
      if (blocker) {
        this.status(blocker, true);
        return;
      }
      if (record.assetId !== this.prefabSelectedAssetId) {
        this.selectPrefabAssetRecord(record, this.isWorkspacePanelOpen('builder-prefab-details'));
      }
      const prefab = record.assetId === this.prefabSelectedAssetId
        ? prefabVariant(record.payload, this.prefabActiveVariant)
        : structuredClone(record.payload);
      this.pastePrefabAt(prefab, pos.x, pos.y);
      const warning = this.prefabPlacementWarning(record);
      if (warning) this.status(warning, true);
      return;
    }
    if (record.kind === 'sprite' && isSpriteAsset(record.payload)) {
      this.placeSpriteAsset(record.payload, pos.x, pos.y);
      return;
    }
    if (record.kind === 'materialProfile') {
      this.applyMaterialProfileAsset(record, pos.x, pos.y);
      return;
    }
    if (record.kind === 'lightPreset') {
      this.placeOrApplyLightPresetAsset(record, pos.x, pos.y);
      return;
    }
    if (record.kind === 'procPreset') {
      this.seedProceduralPresetAsset(record);
      return;
    }
    this.status(`ASSET DROP NOT SUPPORTED: ${record.kind.toUpperCase()}`, true);
  }

  private draggedAssetId(event: DragEvent): string | null {
    const transfer = event.dataTransfer;
    if (!transfer) return null;
    const types = [...transfer.types];
    if (!types.includes('application/x-noita-asset-id')) return null;
    return transfer.getData('application/x-noita-asset-id') || (event.type === 'dragover' ? 'pending' : null);
  }

  private placeSpriteAsset(sprite: SpriteAsset, x: number, y: number): void {
    const obj: EditorObject = {
      id: freshId('decor'),
      kind: 'decor',
      x: this.snap(x),
      y: this.snap(y),
      rotation: 0,
      locked: false,
      hidden: false,
      params: {
        spriteId: sprite.id,
        loopTag: sprite.tags[0]?.name ?? '',
        fps: 0,
        flipX: false,
      },
    };
    this.cmds.run(addObjectCmd(obj));
    this.select(obj.id);
    this.status('PLACED ANIMATED DECOR FROM ASSET BROWSER');
    this.syncAssetPanels();
  }

  private applyMaterialProfileAsset(record: AssetRecord, x: number, y: number): void {
    const materialId = materialProfileCellId(record);
    if (materialId === null || !this.ctx.params.materials[materialId]) {
      this.status(`MATERIAL PROFILE UNAVAILABLE: ${record.sourceId.toUpperCase()}`, true);
      return;
    }
    const materialName = this.ctx.params.materials[materialId]?.name ?? `Material ${materialId}`;
    this.armMaterial(materialId);
    const materialKey = materialKeyForCellId(materialId);
    if (!materialKey) return;
    const target = this.hitTest(x, y);
    const targetIds = target && !target.isLight
      ? this.selectedIds.has(target.id)
        ? this.selectedIds
        : new Set([target.id])
      : new Set<string>();
    const commands = this.materialProfileSelectionCommands(materialKey, targetIds);
    if (commands.length === 0) {
      const suffix = target?.isLight
        ? ' - DROP ON A COMPATIBLE OBJECT TO APPLY PARAMS'
        : target
          ? ' - TARGET HAS NO COMPATIBLE MATERIAL PARAMETER'
          : ' - DROP ON A COMPATIBLE OBJECT TO APPLY PARAMS';
      this.status(`${materialName.toUpperCase()} ARMED${suffix}`, target !== null);
      return;
    }
    this.cmds.run(commands.length === 1 ? commands[0] : compositeCmd(`apply material ${materialKey}`, commands));
    if (target && !target.isLight && !this.selectedIds.has(target.id)) this.select(target.id);
    this.renderInspector();
    this.syncMarkers();
    this.syncStructurePanels();
    this.status(`APPLIED ${materialName.toUpperCase()} TO ${commands.length} TARGET PARAMETER(S)`);
  }

  private materialProfileSelectionCommands(materialKey: string, targetIds: ReadonlySet<string>): Command[] {
    const commands: Command[] = [];
    for (const obj of this.doc.objects) {
      if (!targetIds.has(obj.id) || obj.locked) continue;
      if (obj.kind === 'hazardEmitter' && EMITTER_DROP_MATERIALS.has(materialKey) && obj.params.cell !== materialKey) {
        commands.push(editParamCmd(obj, 'cell', materialKey));
      } else if (obj.kind === 'valve' && VALVE_DROP_MATERIALS.has(materialKey) && obj.params.material !== materialKey) {
        commands.push(editParamCmd(obj, 'material', materialKey));
      } else if (obj.kind === 'plug' && PLUG_DROP_MATERIALS.has(materialKey) && obj.params.material !== materialKey) {
        commands.push(editParamCmd(obj, 'material', materialKey));
      } else if (obj.kind === 'sensor' && SENSOR_DROP_MATERIALS.has(materialKey)) {
        if (obj.params.type !== 'material') commands.push(editParamCmd(obj, 'type', 'material'));
        if (obj.params.filter !== materialKey) commands.push(editParamCmd(obj, 'filter', materialKey));
      }
    }
    return commands;
  }

  private placeOrApplyLightPresetAsset(record: AssetRecord, x: number, y: number): void {
    const preset = LIGHT_PRESETS[record.sourceId];
    if (!preset) {
      this.status(`LIGHT PRESET UNAVAILABLE: ${record.sourceId.toUpperCase()}`, true);
      return;
    }
    const target = this.hitTest(x, y);
    const targetLight = target?.isLight ? target.target as EditorLight : null;
    const targetIds = targetLight && this.selectedIds.has(targetLight.id)
      ? this.selectedIds
      : new Set(targetLight ? [targetLight.id] : []);
    const selectedLights = this.doc.lights.filter((light) => targetIds.has(light.id));
    const editableLights = selectedLights.filter((light) => !light.locked);
    if (selectedLights.length > 0) {
      if (editableLights.length === 0) {
        this.status('TARGET LIGHT IS LOCKED - UNLOCK TO APPLY PRESET', true);
        return;
      }
      const commands = editableLights.map((light) => editLightCmd(light, preset));
      this.cmds.run(commands.length === 1 ? commands[0] : compositeCmd(`apply light preset ${record.sourceId}`, commands));
      if (targetLight && !this.selectedIds.has(targetLight.id)) this.select(targetLight.id);
      this.renderInspector();
      this.syncMarkers();
      this.syncStructurePanels();
      this.status(`APPLIED ${record.name.toUpperCase()} TO ${editableLights.length} LIGHT(S)`);
      return;
    }
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
      ...preset,
    };
    this.cmds.run(addLightCmd(light));
    this.select(light.id);
    this.status(`PLACED ${record.name.toUpperCase()} LIGHT FROM ASSET BROWSER`);
    this.syncAssetPanels();
  }

  private seedProceduralPresetAsset(record: AssetRecord): void {
    const pass = PASSES.find((candidate) => candidate.id === record.sourceId);
    if (!pass) {
      this.status(`PROCEDURAL PRESET UNAVAILABLE: ${record.sourceId.toUpperCase()}`, true);
      return;
    }
    this.openSidePanel('proc');
    const select = this.el<HTMLSelectElement>('bp-pass');
    select.value = pass.id;
    this.syncProcPanel();
    this.status(`SEEDED PROCEDURAL PRESET: ${pass.label.toUpperCase()}`);
  }

  private async openDocumentAsset(record: AssetRecord): Promise<void> {
    if (this.previewBlocks() || this.livePreviewActionBlocks('Open document')) return;
    if (record.source.storage === 'document') {
      this.status('CURRENT DOCUMENT IS ALREADY OPEN');
      return;
    }
    if (!isDocumentAsset(record.payload)) {
      this.status(`DOCUMENT ASSET UNAVAILABLE: ${record.sourceId.toUpperCase()}`, true);
      return;
    }
    const requestedAssetId = record.assetId;
    const requestedSignature = record.contentSignature;
    if (!(await this.confirmDiscardCurrentDocument(record.kind === 'template' ? 'Create From Template' : 'Open Document'))) return;
    if (!this.isOpen || this.previewBlocks() || this.livePreviewActionBlocks('Open document')) return;
    const latest = this.createAssetDatabase().get(requestedAssetId);
    if (!latest || latest.kind !== record.kind || latest.contentSignature !== requestedSignature || !isDocumentAsset(latest.payload)) {
      this.status('DOCUMENT ASSET CHANGED - RESELECT AND OPEN AGAIN', true);
      this.renderAssetDetails();
      return;
    }
    const doc = JSON.parse(JSON.stringify(latest.payload)) as EditorDocument;
    if (latest.kind === 'template') {
      doc.id = freshId('doc');
      doc.name = doc.name ? `${doc.name} copy` : 'untitled';
      doc.validation = null;
    }
    this.replaceDocument(doc, `${record.kind === 'template' ? 'CREATED' : 'OPENED'} "${doc.name.toUpperCase()}" FROM ASSET BROWSER`);
  }

  private wireSelectAndFrameRows(panel: HTMLElement): void {
    for (const row of panel.querySelectorAll<HTMLElement>('[data-select-id]')) {
      if (row.tagName === 'BUTTON') continue;
      row.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, textarea, select, label, [contenteditable="true"]')) return;
        const ids = this.rowSelectionIds(row);
        if (ids.length > 1) this.selectMany(ids);
        else if (ids[0]) this.select(ids[0]);
      });
      row.addEventListener('dblclick', (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, textarea, select, label, [contenteditable="true"]')) return;
        const id = row.dataset.frameId || row.dataset.selectId;
        if (id) {
          const ids = this.rowSelectionIds(row);
          if (ids.length > 1) this.selectMany(ids);
          else this.select(id);
          this.frameSelection();
        }
      });
      row.addEventListener('contextmenu', (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea, select, label, [contenteditable="true"]')) return;
        this.openStructureRowContextMenu(event, row);
      });
    }
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-select-id]')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = button.dataset.selectId;
        if (id) this.select(id);
      });
    }
  }

  private rowSelectionIds(row: HTMLElement): string[] {
    const ids = (row.dataset.selectIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length > 0) return ids;
    return row.dataset.selectId ? [row.dataset.selectId] : [];
  }

  private openStructureRowContextMenu(event: MouseEvent, row: HTMLElement): void {
    const panel = row.closest<HTMLElement>('[data-panel-id], #builder-outliner, #builder-link-graph');
    const panelId = panel?.dataset.panelId ?? panel?.id ?? '';
    const ids = this.rowSelectionIds(row);
    const selectId = ids[0] ?? row.dataset.selectId;
    const linkId = row.dataset.linkId;
    if (ids.length > 1) this.selectMany(ids);
    else if (selectId) this.select(selectId);
    this.contextLinkId = linkId || null;
    const commandIds = this.structureRowContextCommands(panelId, row.dataset.rowType ?? '', linkId ?? '');
    if (commandIds.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.menus.showCommandMenu({
      id: `row:${row.dataset.rowType ?? 'record'}:${selectId ?? linkId ?? ''}`,
      registry: this.uiCommands,
      commandIds,
      cursor: { x: event.clientX, y: event.clientY },
      onStatus: (message, error) => this.status(message, error),
    });
  }

  private structureRowContextCommands(panelId: string, rowType: string, linkId: string): readonly string[] {
    const common = ['builder.frameSelection', 'builder.validate', 'builder.commandPalette'];
    if (panelId === 'builder-link-graph' || rowType === 'link' || linkId) {
      return linkId
        ? ['builder.unlinkContextLink', 'builder.linkGraphPanel', 'builder.outlinerPanel', ...common]
        : ['builder.linkGraphPanel', 'builder.outlinerPanel', ...common];
    }
    if (rowType === 'object' || rowType === 'light') {
      return [
        'builder.toggleSelectedHidden',
        'builder.toggleSelectedLocked',
        'builder.duplicate',
        'builder.delete',
        'builder.linkGraphPanel',
        ...common,
      ];
    }
    return ['builder.outlinerPanel', 'builder.linkGraphPanel', ...common];
  }

  private selectedRecordKind(): 'object' | 'light' | null {
    if (!this.selectedId) return null;
    if (this.doc.objects.some((item) => item.id === this.selectedId)) return 'object';
    if (this.doc.lights.some((item) => item.id === this.selectedId)) return 'light';
    return null;
  }

  private toggleSelectedRecordFlag(flag: 'hidden' | 'locked'): void {
    const kind = this.selectedRecordKind();
    if (!kind || !this.selectedId) {
      this.status('SELECT AN OBJECT OR LIGHT FIRST', true);
      return;
    }
    this.toggleOutlinerRecordFlag(kind, this.selectedId, flag);
  }

  private toggleOutlinerRecordFlag(kind: 'object' | 'light', id: string, flag: 'hidden' | 'locked'): void {
    if (kind === 'object') {
      const object = this.doc.objects.find((item) => item.id === id);
      if (!object) return;
      this.cmds.run(setObjectFlagCmd(object, flag, !object[flag]));
      this.status(`${flag.toUpperCase()} ${object.kind.toUpperCase()}: ${object[flag] ? 'ON' : 'OFF'}`);
    } else {
      const light = this.doc.lights.find((item) => item.id === id);
      if (!light) return;
      this.cmds.run(editLightCmd(light, { [flag]: !light[flag] } as Partial<EditorLight>));
      this.status(`${flag.toUpperCase()} LIGHT: ${light[flag] ? 'ON' : 'OFF'}`);
    }
    this.syncMarkers();
    this.renderInspector();
    this.syncStructurePanels();
  }

  private unlinkContextLink(): void {
    const link = this.doc.links.find((item) => item.id === this.contextLinkId);
    if (!link) return;
    this.cmds.run(deleteLinkCmd(link));
    this.contextLinkId = null;
    this.status('UNLINKED');
    this.renderInspector();
    this.syncMarkers();
    this.syncStructurePanels();
  }

  private outlinerLayerStates(): OutlinerLayerState[] {
    const objects = this.doc.objects;
    return [
      {
        id: 'gameplay',
        label: 'Gameplay',
        hidden: this.layerHidden.has('gameplay'),
        locked: this.layerLocked.has('gameplay'),
        count: objects.filter((object) => familyOf(object) === 'gameplay').length,
      },
      {
        id: 'mech',
        label: 'Mechanisms',
        hidden: this.layerHidden.has('mech'),
        locked: this.layerLocked.has('mech'),
        count: objects.filter((object) => familyOf(object) === 'mech').length,
      },
      {
        id: 'links',
        label: 'Links',
        hidden: this.layerHidden.has('links'),
        locked: this.layerLocked.has('links'),
        count: this.doc.links.length,
      },
      {
        id: 'lights',
        label: 'Lights',
        hidden: this.layerHidden.has('lights'),
        locked: this.layerLocked.has('lights'),
        count: this.doc.lights.length,
      },
    ];
  }

  private syncNavigationPanels(): void {
    if (this.isWorkspacePanelOpen('builder-outliner')) this.renderOutliner();
    if (this.isWorkspacePanelOpen('builder-link-graph')) this.renderLinkGraph();
    if (this.isWorkspacePanelOpen('builder-assets')) this.renderAssetBrowser();
    if (this.isWorkspacePanelOpen('builder-asset-details')) this.renderAssetDetails();
  }

  private isWorkspacePanelOpen(id: string): boolean {
    return this.workspaceLayout.panels.some((panel) => panel.id === id && panel.open);
  }

  /* ===================== issues / status / sync ===================== */

  private renderIssues(
    issues: DocIssue[],
    options: { playtestBlockers?: readonly DocIssue[] } = {},
  ): void {
    this.lastIssues = [...issues];
    this.lastValidationOverlay = buildValidationOverlayDiagnostics(this.doc);
    this.validationDirty = false;
    this.syncNavigationPanels();
    const panel = this.el<HTMLDivElement>('builder-issues');
    this.validationScrollTop = panel.scrollTop || this.validationScrollTop;
    if (issues.length === 0) {
      panel.style.display = 'none';
      this.setWorkspacePanelOpen('builder-issues', false);
      this.applyWorkspaceLayout();
      this.saveWorkspacePrefs();
      return;
    }
    panel.style.display = '';
    this.setWorkspacePanelOpen('builder-issues', true);
    this.applyWorkspaceLayout();
    this.saveWorkspacePrefs();
    panel.innerHTML = renderValidationPanel(issues, options);
    this.refreshPanelDragHandles(panel);
    panel.querySelector('#b-issues-close')?.addEventListener('click', () => {
      panel.style.display = 'none';
      this.setWorkspacePanelOpen('builder-issues', false);
      this.applyWorkspaceLayout();
      this.saveWorkspacePrefs();
    });
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-validation-filter]')) {
      button.addEventListener('click', () => this.applyValidationFilter(panel, button.dataset.validationFilter ?? 'all'));
    }
    this.applyValidationFilter(panel, this.validationFilter);
    this.markActiveValidationIssue(panel);
    panel.onscroll = () => {
      this.validationScrollTop = panel.scrollTop;
    };
    requestAnimationFrame(() => {
      panel.scrollTop = Math.min(this.validationScrollTop, Math.max(0, panel.scrollHeight - panel.clientHeight));
    });
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-validation-action]')) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const row = button.closest<HTMLElement>('.b-issue');
        const issue = row ? issues[Number(row.dataset.n)] : null;
        if (issue) this.runValidationAction(button.dataset.validationAction ?? '', issue);
      });
    }
    for (const row of panel.querySelectorAll<HTMLDivElement>('.b-issue')) {
      const activate = () => {
        const issue = issues[Number(row.dataset.n)];
        if (!issue) return;
        this.activeValidationIssueIndex = Number(row.dataset.n);
        this.markActiveValidationIssue(panel);
        this.selectIssueTarget(issue);
      };
      row.addEventListener('click', activate);
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });
    }
  }

  private applyValidationFilter(panel: HTMLElement, filter: string): void {
    const active = filter === 'error' || filter === 'warning' || filter === 'info' ? filter : 'all';
    this.validationFilter = active;
    panel.dataset.validationFilter = active;
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-validation-filter]')) {
      button.setAttribute('aria-pressed', button.dataset.validationFilter === active ? 'true' : 'false');
    }
    for (const row of panel.querySelectorAll<HTMLElement>('.bv-issue')) {
      row.hidden = active !== 'all' && !row.classList.contains(active);
    }
    for (const group of panel.querySelectorAll<HTMLElement>('.bv-group')) {
      group.hidden = [...group.querySelectorAll<HTMLElement>('.bv-issue')].every((row) => row.hidden);
    }
  }

  private markActiveValidationIssue(panel: HTMLElement): void {
    for (const row of panel.querySelectorAll<HTMLElement>('.bv-issue')) {
      const active = Number(row.dataset.n) === this.activeValidationIssueIndex;
      row.classList.toggle('active', active);
      if (active) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
  }

  private selectIssueTarget(issue: DocIssue): boolean {
    const ids = issue.objIds ?? (issue.objId ? [issue.objId] : []);
    if (ids.length > 1) {
      this.selectMany(ids);
      this.frameSelection();
      return true;
    }
    if (ids.length === 1) {
      this.select(ids[0]);
      this.frameSelection();
      return true;
    }
    if (issue.linkId) {
      const link = this.doc.links.find((item) => item.id === issue.linkId);
      if (link) {
        this.selectMany([link.fromId, link.toId]);
        this.frameSelection();
        return true;
      }
    }
    if (issue.location) {
      this.ctx.camera.snapTo(issue.location.x, issue.location.y);
      return true;
    }
    return false;
  }

  private runValidationAction(action: string, issue: DocIssue): void {
    if (action === 'addSpawnAtCamera') {
      const at = this.cameraCenter();
      const spawn: EditorObject = {
        id: freshId('spawn'),
        kind: 'spawn',
        x: this.snap(at.x),
        y: this.snap(at.y),
        rotation: 0,
        locked: false,
        hidden: false,
        params: {},
      };
      this.cmds.run(addObjectCmd(spawn));
      this.select(spawn.id);
      this.renderIssues(this.currentValidationIssues());
      this.status('ADDED SPAWN AT CAMERA');
      return;
    }
    if (action === 'moveSpawnToCamera') {
      const spawn = issue.objId ? this.doc.objects.find((object) => object.id === issue.objId && object.kind === 'spawn') : null;
      if (!spawn) {
        this.status('NO SPAWN TARGET TO MOVE', true);
        return;
      }
      const at = this.cameraCenter();
      this.cmds.run(moveObjectCmd(spawn, this.snap(at.x), this.snap(at.y)));
      this.select(spawn.id);
      this.renderIssues(this.currentValidationIssues());
      this.status('MOVED SPAWN TO CAMERA');
      return;
    }
    if (action === 'markPortalAlwaysOpen') {
      const portal = issue.objId ? this.doc.objects.find((object) => object.id === issue.objId && object.kind === 'exitPortal') : null;
      if (!portal) {
        this.status('NO PORTAL TARGET', true);
        return;
      }
      this.cmds.run(editParamCmd(portal, 'alwaysOpen', true));
      this.select(portal.id);
      this.renderIssues(this.currentValidationIssues());
      this.status('PORTAL MARKED ALWAYS-OPEN');
      return;
    }
    if (action === 'createGoldenKeyNearCamera') {
      const at = this.cameraCenter();
      const key: EditorObject = {
        id: freshId('pickup'),
        kind: 'pickup',
        x: this.snap(at.x + 24),
        y: this.snap(at.y),
        rotation: 0,
        locked: false,
        hidden: false,
        params: { kind: 'key' },
      };
      this.cmds.run(addObjectCmd(key));
      this.select(key.id);
      this.renderIssues(this.currentValidationIssues());
      this.status('ADDED GOLDEN KEY NEAR CAMERA');
      return;
    }
    if (action === 'removeDeadLink') {
      const link = issue.linkId ? this.doc.links.find((item) => item.id === issue.linkId) : null;
      if (!link) {
        this.status('NO LINK TARGET', true);
        return;
      }
      this.cmds.run(deleteLinkCmd(link));
      this.renderIssues(this.currentValidationIssues());
      this.status('REMOVED DEAD LINK');
      return;
    }
    if (action === 'showValidationOverlay') {
      this.showOverlay(issue.overlayKind === 'reachability' ? 'reachability' : 'validation');
      this.selectIssueTarget(issue);
      return;
    }
    if (action === 'showClearanceOverlay') {
      this.showOverlay('clearance');
      this.selectIssueTarget(issue);
      return;
    }
    if (action === 'previewCarveCorridor') {
      this.previewValidationCorridor(issue);
      return;
    }
    if (action === 'selectIssueTarget') {
      if (!this.selectIssueTarget(issue)) {
        this.status('ISSUE HAS NO SELECTABLE TARGET', true);
      }
    }
  }

  private previewValidationCorridor(issue: DocIssue): void {
    if (this.livePreviewActionBlocks('Validation repair preview')) return;
    if (this.previewBlocks()) return;
    this.ensureCaptured();
    const spawn = this.doc.objects.find((object) => object.kind === 'spawn' && !object.hidden);
    const target = issue.location ??
      (issue.objId
        ? this.doc.objects.find((object) => object.id === issue.objId) ?? this.doc.lights.find((light) => light.id === issue.objId)
        : null);
    if (!spawn || !target) {
      this.status('NO SPAWN OR ISSUE TARGET FOR CORRIDOR PREVIEW', true);
      return;
    }
    this.discardPreview(true);
    const rec = new PatchRecorder(this.ctx.world);
    const x0 = Math.floor(spawn.x);
    const y0 = Math.floor(spawn.y - 8);
    const x1 = Math.floor(target.x);
    const y1 = Math.floor(target.y - 3);
    stampLine(this.ctx.world, rec, x0, y0, x1, y1, 3, Cell.Empty);
    const patch = rec.finish();
    if (!patch) {
      this.status('CORRIDOR PREVIEW CHANGED NOTHING', true);
      return;
    }
    const label = issue.code ? issue.code.replace(/^builder\./, '') : 'validation corridor';
    this.pendingPreview = {
      kind: 'repair',
      before: patch.before,
      after: patch.after,
      label,
      summary: 'corridor preview to ' + label,
    };
    this.showOverlay('reachability');
    this.openSidePanel('proc');
    this.procStatus('CORRIDOR PREVIEW — APPLY OR DISCARD');
    this.status('CORRIDOR PREVIEW — APPLY OR DISCARD');
  }

  private cameraCenter(): { x: number; y: number } {
    return {
      x: this.ctx.camera.x + VIEW_W / 2,
      y: this.ctx.camera.y + VIEW_H / 2,
    };
  }

  private showOverlay(id: BuilderOverlayId): void {
    this.workspaceLayout.overlayVisibility = sanitizeOverlayVisibility(this.workspaceLayout.overlayVisibility);
    if (this.workspaceLayout.overlayVisibility[id] !== true) this.toggleOverlay(id);
    else this.status(`OVERLAY: ${overlayLabel(id).toUpperCase()}`);
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
    const entries = Object.entries(lib).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const currentSaved = lib[this.doc.id];
    const addOption = (id: string, label: string): void => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = label;
      select.appendChild(opt);
    };
    if (!currentSaved) addOption(this.doc.id, `${this.doc.name || 'untitled'} *`);
    for (const [id, d] of entries) addOption(id, id === this.doc.id ? this.doc.name || d.name : d.name);
    select.value = this.doc.id;
    select.disabled = false;
  }

  private levelEntries(): LevelDef[] {
    return Object.values(LEVELS).sort((a, b) => {
      if (a.branch !== b.branch) return a.branch ? 1 : -1;
      return a.depth - b.depth;
    });
  }

  private levelIdForBiome(biome: BiomeId): string | null {
    return this.levelEntries().find((level) => level.biome === biome)?.id ?? null;
  }

  private syncAll(): void {
    this.el<HTMLInputElement>('b-doc-name').value = this.doc.name;
    this.el<HTMLSelectElement>('b-biome').value = this.doc.biome;
    // BAKE only shows while playtest scars are actually held
    this.el('b-bake').style.display = this.playtestScars ? '' : 'none';
    this.syncMarkers();
    this.syncPalette();
    this.syncWandLightPreviewButton();
    this.syncGpuComposeButton();
    this.renderInspector();
    this.syncWorkspacePanelContent();
  }

  private syncWorkspacePanelContent(): void {
    const open = (id: string): boolean => this.workspaceLayout.panels.some((panel) => panel.id === id && panel.open);
    if (open('builder-world')) this.buildWorldPanel();
    if (open('builder-global')) this.buildGlobalPanel();
    if (open('builder-postfx')) this.buildPostProcessingPanel();
    if (open('builder-matparams')) this.buildMatPanel();
    if (open('builder-outliner')) this.renderOutliner();
    if (open('builder-link-graph')) this.renderLinkGraph();
    if (open('builder-assets')) this.renderAssetBrowser();
    if (open('builder-asset-details')) this.renderAssetDetails();
    if (open('builder-prefab-details')) this.renderPrefabDetails();
    if (open('builder-virtual-world')) this.renderVirtualWorldPanel();
    this.syncProcPanel();
  }
}

/** Minimal HTML escape for text interpolated into Builder-owned markup. */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cssString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}

function builderDocumentTemplates(): Record<string, EditorDocument> {
  return Object.fromEntries(BIOMES.map((biome) => {
    const name = `${BIOME_DEFS[biome]?.name ?? biome} Starter`;
    const doc: EditorDocument = {
      v: 2,
      id: `template-${biome}`,
      name,
      biome,
      size: { w: WIDTH, h: HEIGHT },
      world: null,
      objects: [
        {
          id: `template-${biome}-spawn`,
          kind: 'spawn',
          x: 96,
          y: 128,
          rotation: 0,
          locked: false,
          hidden: false,
          params: {},
        },
        {
          id: `template-${biome}-portal`,
          kind: 'exitPortal',
          x: 192,
          y: 128,
          rotation: 0,
          locked: false,
          hidden: false,
          params: { alwaysOpen: true },
        },
      ],
      links: [],
      lights: [],
      proceduralHistory: [],
      validation: null,
    };
    return [doc.id, doc];
  }));
}

const EMITTER_DROP_MATERIALS = new Set(['water', 'oil', 'acid', 'lava', 'fire', 'ember', 'sand', 'snow', 'smoke']);
const VALVE_DROP_MATERIALS = new Set(['metal', 'stone', 'wood', 'glass']);
const PLUG_DROP_MATERIALS = new Set(['wood', 'ash', 'glass', 'coal', 'stone', 'sand', 'metal']);
const SENSOR_DROP_MATERIALS = new Set([
  'water',
  'oil',
  'acid',
  'lava',
  'sand',
  'snow',
  'gold',
  'gunpowder',
  'coal',
  'ash',
  'slime',
  'healium',
  'teleportium',
]);

function materialProfileCellId(record: AssetRecord): number | null {
  const match = /^cell-(\d+)$/.exec(record.sourceId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

function materialKeyForCellId(cellId: number): string | null {
  for (const [name, value] of Object.entries(Cell)) {
    if (value === cellId) return name.toLowerCase();
  }
  return null;
}

function isPrefabAsset(value: unknown): value is PrefabDef {
  return !!value && typeof value === 'object' && (value as PrefabDef).kind === 'prefab';
}

function isSpriteAsset(value: unknown): value is SpriteAsset {
  return !!value && typeof value === 'object' && (value as SpriteAsset).kind === 'sprite';
}

function isDocumentAsset(value: unknown): value is EditorDocument {
  return !!value && typeof value === 'object' && (value as EditorDocument).v === 2;
}

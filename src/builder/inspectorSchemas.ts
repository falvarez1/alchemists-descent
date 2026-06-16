import type { EnemyKind, PickupKind } from '@/core/types';
import { paramNum } from '@/builder/document';
import type { EditorDocument, EditorLight, EditorLink, EditorObject, EditorObjectKind } from '@/builder/document';
import type { SpriteAsset } from '@/builder/assets/sprites';
import type { EditorField, FieldOption } from '@/ui/editor/Fields';
import {
  isMixedValue,
  MIXED_VALUE,
  sharedValue,
} from '@/ui/editor/InspectorSchema';
import type {
  InspectorCommandRef,
  InspectorSchemaItem,
} from '@/ui/editor/InspectorSchema';
import { POTION_KINDS } from '@/core/pickupDefs';
import { TOME_REWARD_POOL } from '@/combat/wands/rewardPools';

export const POINT_ROTATE_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'enemy',
  'hazardEmitter',
  'decor',
  'pickup',
] as EditorObjectKind[]);

export const PATROL_KINDS = new Set(['slime', 'acidslime', 'golem', 'bomber']);
export const EMITTER_DIR: Record<number, string> = { 0: 'down', 90: 'left', 180: 'up', 270: 'right' };

export const ENEMY_KINDS: EnemyKind[] = [
  'slime',
  'imp',
  'golem',
  'acidslime',
  'wisp',
  'mage',
  'bat',
  'spitter',
  'bomber',
  'eggs',
  'colossus',
  'leviathan',
];

export const PICKUP_KINDS: PickupKind[] = ['goldpile', 'heart', 'tome', 'chest', 'potion', 'key'];
const CARD_PICKUP_OPTIONS: FieldOption[] = [
  { value: '', label: 'random' },
  ...[...TOME_REWARD_POOL, 'vitrify'].map((id) => ({ value: id, label: id })),
];
const POTION_PICKUP_OPTIONS: FieldOption[] = [
  { value: '', label: 'random' },
  ...POTION_KINDS.map((id) => ({ value: id, label: id })),
];

/** Light presets: one click of mood, applied through the undo stack. */
export const LIGHT_PRESETS: Record<string, Partial<EditorLight>> = {
  torch: { color: '#ffb45a', intensity: 1.3, radius: 48, bloom: 0.4, flicker: 0.4, falloff: 'soft', occluded: true },
  brazier: { color: '#ff8a3c', intensity: 1.8, radius: 64, bloom: 0.6, flicker: 0.3, falloff: 'soft', occluded: true },
  crystal: { color: '#7fd4ff', intensity: 1.0, radius: 40, bloom: 0.5, flicker: 0.05, falloff: 'sharp', occluded: true },
  moonlight: { color: '#9db8e8', intensity: 0.7, radius: 120, bloom: 0.1, flicker: 0, falloff: 'linear', occluded: false },
  treasure: { color: '#ffd75e', intensity: 0.9, radius: 28, bloom: 0.7, flicker: 0.15, falloff: 'sharp', occluded: true },
  warning: { color: '#ff4444', intensity: 1.2, radius: 56, bloom: 0.5, flicker: 0.55, falloff: 'soft', occluded: false },
};

export interface InspectorObjectIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface ObjectInspectorSchemaContext {
  objects: EditorObject[];
  links: EditorLink[];
  sprites: SpriteAsset[];
  documentSprites: SpriteAsset[];
  patrolEditId: string | null;
  /** Validation issues for THIS object, surfaced inline so the field that
   *  caused a problem is visible without opening the validation panel. */
  issues?: InspectorObjectIssue[];
}

export interface LightInspectorSchemaContext {
  presetIds: string[];
  solo: boolean;
  muted: boolean;
}

export function documentInspectorSchema(doc: EditorDocument, undoDepth: number): InspectorSchemaItem[] {
  const mood = doc.mood ?? { ambient: null, ambience: '' };
  return [
    section('INSPECTOR'),
    help([
      'Nothing selected.',
      'Click a marker, or pick a',
      'tool and click the canvas.',
      'Ctrl+K = command palette.',
    ]),
    readout('document.objects', 'objects', doc.objects.length),
    readout('document.links', 'links', doc.links.length),
    readout('document.lights', 'lights', doc.lights.length),
    readout('document.passes', 'passes', doc.proceduralHistory.length),
    readout('document.terrain', 'terrain', doc.world ? 'captured' : '-'),
    readout('document.undoDepth', 'undo depth', undoDepth),
    section('DOCUMENT MOOD', 'document.mood'),
    field(
      {
        kind: 'number',
        id: 'document.mood.ambient',
        label: 'ambient',
        value: mood.ambient ?? '',
        min: 0.02,
        max: 0.6,
        step: 0.02,
        controlId: 'bi-mood-ambient',
        placeholder: 'default',
        dataset: { docField: 'mood.ambient' },
      },
      docMetaCommand('builder.inspector.document.mood.ambient', { key: 'mood.ambient' }),
    ),
    field(
      {
        kind: 'text',
        id: 'document.mood.ambience',
        label: 'ambience',
        value: mood.ambience ?? '',
        controlId: 'bi-mood-ambience',
        placeholder: 'tag (e.g. drips)',
        dataset: { docField: 'mood.ambience' },
      },
      docMetaCommand('builder.inspector.document.mood.ambience', { key: 'mood.ambience' }),
    ),
    help(['Ambient overrides the global', 'light level in playtests', '(restored on return).']),
  ];
}

export function multiSelectionInspectorSchema(
  objects: EditorObject[],
  lights: EditorLight[],
  context?: ObjectInspectorSchemaContext,
): InspectorSchemaItem[] {
  const count = objects.length + lights.length;
  const byKind = new Map<string, number>();
  for (const obj of objects) byKind.set(obj.kind, (byKind.get(obj.kind) ?? 0) + 1);
  if (lights.length > 0) byKind.set('light', lights.length);
  const locked = sharedValue([...objects.map((obj) => obj.locked), ...lights.map((light) => light.locked)]);
  const hidden = sharedValue([...objects.map((obj) => obj.hidden), ...lights.map((light) => light.hidden)]);
  // Shared parameter editing applies only to a homogeneous, light-free
  // selection: one kind => one well-defined set of param rows to edit at once.
  const sharedParams = context && lights.length === 0 ? sharedParamItems(objects, context) : [];
  return [
    section(`${count} SELECTED`),
    ...[...byKind.entries()].map(([kind, n]) => readout(`selection.kind.${kind}`, kind, n)),
    ...sharedParams,
    actionGroup('selection.align', [
      action('align.x', 'ALIGN X', 'Align to the primary column', { align: 'x' }, docCommand('builder.inspector.selection.align.x')),
      action('align.y', 'ALIGN Y', 'Align to the primary row', { align: 'y' }, docCommand('builder.inspector.selection.align.y')),
      action(
        'align.spreadX',
        'SPREAD H',
        'Distribute evenly between leftmost and rightmost',
        { align: 'spreadX' },
        docCommand('builder.inspector.selection.align.spreadX'),
      ),
      action(
        'align.spreadY',
        'SPREAD V',
        'Distribute evenly between topmost and bottommost',
        { align: 'spreadY' },
        docCommand('builder.inspector.selection.align.spreadY'),
      ),
    ]),
    section('SHARED FLAGS', 'selection.flags'),
    field(mixedCheckbox('selection.locked', 'locked', locked, { mf: 'locked' }), docCommand('builder.inspector.selection.locked')),
    field(mixedCheckbox('selection.hidden', 'hidden', hidden, { mf: 'hidden' }), docCommand('builder.inspector.selection.hidden')),
    help(['Drag moves the group.', 'Ctrl+D duplicates / Ctrl+G groups.', 'Ctrl+Shift+G dissolves groups.']),
    action('selection.delete', 'DELETE ALL (DEL)', undefined, {}, docCommand('builder.delete'), 'bi-delete'),
  ];
}

/** Re-emit a homogeneous selection's editable PARAM fields with cross-selection
 *  mixed state, so a designer can set width/material/threshold etc. on every
 *  selected object at once. Links, actions, help and the per-object identity
 *  rows are intentionally dropped — only the value fields multi-edit cleanly. */
function sharedParamItems(objects: EditorObject[], context: ObjectInspectorSchemaContext): InspectorSchemaItem[] {
  if (objects.length < 2) return [];
  const rep = objects[0];
  const kind = rep.kind;
  // Same EditorObjectKind AND same sub-kind discriminator (enemy/pickup carry
  // their type in params.kind, which decides which conditional rows exist) — a
  // slime+bat selection must NOT re-emit the bat-only 'sleeping' row and write
  // it onto the slime.
  if (!objects.every((obj) => obj.kind === kind && obj.params.kind === rep.params.kind)) return [];
  const out: InspectorSchemaItem[] = [];
  for (const item of objectKindItems(rep, context)) {
    if (item.kind !== 'field') continue;
    const f = item.field;
    const key = typeof f.dataset?.p === 'string' ? f.dataset.p : null;
    if (!key) continue; // skip library-owned fields (e.g. sprite emissive) with no param key
    if (f.kind === 'vec2') continue;
    const mixed = isMixedValue(sharedValue(objects.map((obj) => obj.params[key])));
    out.push(field({ ...f, mixed }, paramCommand(rep, key)));
  }
  if (out.length === 0) return [];
  return [section(`SHARED ${kind.toUpperCase()}`, 'selection.params'), ...out];
}

export function lightInspectorSchema(light: EditorLight, context: LightInspectorSchemaContext): InspectorSchemaItem[] {
  return [
    section('AUTHORED LIGHT'),
    identity(light.id),
    field(
      {
        kind: 'select',
        id: 'light.preset',
        label: 'preset',
        value: '',
        options: ['', ...context.presetIds],
        dataset: { preset: 1 },
      },
      docCommand('builder.inspector.light.preset', { lightId: light.id }),
    ),
    field(
      {
        kind: 'vec2',
        id: 'light.position',
        label: 'position',
        x: Math.round(light.x),
        y: Math.round(light.y),
        xDataset: { lf: 'x' },
        yDataset: { lf: 'y' },
      },
      docCommand('builder.inspector.light.move', { lightId: light.id }),
    ),
    field({ kind: 'color', id: 'light.color', label: 'color', value: light.color, dataset: { lf: 'color' } }, docCommand('builder.inspector.light.color', { lightId: light.id })),
    field(numericLightField('light.intensity', 'intensity', light.intensity, { lf: 'intensity' }, 0.1, 4, 0.1), docCommand('builder.inspector.light.intensity', { lightId: light.id })),
    field(numericLightField('light.radius', 'radius', light.radius, { lf: 'radius' }, 4, 160), docCommand('builder.inspector.light.radius', { lightId: light.id })),
    field(numericLightField('light.bloom', 'bloom', light.bloom, { lf: 'bloom' }, 0, 1, 0.05), docCommand('builder.inspector.light.bloom', { lightId: light.id })),
    field(numericLightField('light.flicker', 'flicker', light.flicker, { lf: 'flicker' }, 0, 1, 0.05), docCommand('builder.inspector.light.flicker', { lightId: light.id })),
    field(
      {
        kind: 'select',
        id: 'light.falloff',
        label: 'falloff',
        value: light.falloff,
        options: ['soft', 'linear', 'sharp'],
        dataset: { lf: 'falloff' },
      },
      docCommand('builder.inspector.light.falloff', { lightId: light.id }),
    ),
    field({ kind: 'checkbox', id: 'light.occluded', label: 'occluded', checked: light.occluded, dataset: { lf: 'occluded' } }, docCommand('builder.inspector.light.occluded', { lightId: light.id })),
    field({ kind: 'checkbox', id: 'light.locked', label: 'locked', checked: light.locked, dataset: { lf: 'locked' } }, docCommand('builder.inspector.light.locked', { lightId: light.id })),
    field({ kind: 'checkbox', id: 'light.hidden', label: 'hidden', checked: light.hidden, dataset: { lf: 'hidden' } }, docCommand('builder.inspector.light.hidden', { lightId: light.id })),
    help(['Occluded lights cast real', 'shadows via the sweeps;', 'non-occluded paint their', 'whole falloff disk.']),
    action(
      'light.solo',
      context.solo ? 'SOLO ON - CLICK TO HEAR ALL' : 'SOLO THIS LIGHT',
      undefined,
      {},
      viewCommand('builder.inspector.light.solo', { lightId: light.id }),
      'bi-solo',
      context.solo ? 'bi-armed' : undefined,
    ),
    action(
      'light.mute',
      context.muted ? 'MUTED - CLICK TO UNMUTE' : 'MUTE THIS LIGHT',
      'Drop this light from Logic Preview only; it still compiles',
      {},
      viewCommand('builder.inspector.light.mute', { lightId: light.id }),
      'bi-mute',
      context.muted ? 'bi-armed' : undefined,
    ),
    action('light.delete', 'DELETE (DEL)', undefined, {}, docCommand('builder.delete'), 'bi-delete'),
  ];
}

export function objectInspectorSchema(obj: EditorObject, context: ObjectInspectorSchemaContext): InspectorSchemaItem[] {
  const items: InspectorSchemaItem[] = [
    section(obj.kind.toUpperCase()),
    identity(obj.id),
    field(
      {
        kind: 'vec2',
        id: 'object.position',
        label: 'position',
        x: Math.round(obj.x),
        y: Math.round(obj.y),
        xDataset: { f: 'x' },
        yDataset: { f: 'y' },
      },
      docCommand('builder.inspector.object.move', { objectId: obj.id }),
    ),
  ];

  const issues = context.issues ?? [];
  if (issues.length > 0) {
    items.push(section(`ISSUES (${issues.length})`, 'object.issues'));
    issues.forEach((issue, i) => {
      items.push(
        readout(`object.issue.${i}`, issue.severity, issue.message, issue.severity === 'info' ? 'muted' : 'warn'),
      );
    });
  }

  items.push(...objectKindItems(obj, context));
  if (POINT_ROTATE_KINDS.has(obj.kind)) {
    const dir = obj.kind === 'hazardEmitter' ? ` (${EMITTER_DIR[obj.rotation] ?? 'down'})` : '';
    items.push(readout('object.rotation', 'rotation', `${obj.rotation} deg${dir}`));
    items.push(action('object.rotatePoint', 'ROTATE 90', 'Q also rotates the selection', {}, docCommand('builder.inspector.object.rotatePoint', { objectId: obj.id }), 'bi-rotate-pt'));
  }
  items.push(section('FLAGS', 'object.flags'));
  items.push(field({ kind: 'checkbox', id: 'object.locked', label: 'locked', checked: obj.locked, dataset: { f: 'locked' } }, docCommand('builder.inspector.object.locked', { objectId: obj.id })));
  items.push(field({ kind: 'checkbox', id: 'object.hidden', label: 'hidden', checked: obj.hidden, dataset: { f: 'hidden' } }, docCommand('builder.inspector.object.hidden', { objectId: obj.id })));
  items.push(action('object.delete', 'DELETE (DEL)', undefined, {}, docCommand('builder.delete'), 'bi-delete'));
  return items;
}

function objectKindItems(obj: EditorObject, context: ObjectInspectorSchemaContext): InspectorSchemaItem[] {
  if (obj.kind === 'enemy') return enemyItems(obj, context);
  if (obj.kind === 'hazardEmitter') return hazardEmitterItems(obj);
  if (obj.kind === 'decor') return decorItems(obj, context);
  if (obj.kind === 'pickup') return pickupItems(obj);
  if (obj.kind === 'exitPortal') return [paramCheckbox(obj, 'alwaysOpen', 'always open')];
  if (obj.kind === 'waystone') return [paramCheckbox(obj, 'lit', 'pre-lit')];
  if (obj.kind === 'exitWell') return [paramNumber(obj, 'halfW', 'half width (cells)', 14, { min: 1 })];
  if (obj.kind === 'door') {
    return [
      paramNumber(obj, 'w', 'width (cells)', 3, { min: 1 }),
      paramNumber(obj, 'h', 'height (cells)', 13, { min: 1 }),
      paramCheckbox(obj, 'initialOpen', 'starts open'),
      paramSelect(obj, 'logic', 'logic', ['and', 'or', 'sequence'], 'and', true),
      action('object.rotateSlab', 'ROTATE 90', 'Swap width and height', {}, docCommand('builder.inspector.object.rotateSlab', { objectId: obj.id }), 'bi-rotate'),
      ...linkItems(obj, 'in', context),
    ];
  }
  if (obj.kind === 'runeDoor') {
    return [
      paramNumber(obj, 'w', 'width (cells)', 2, { min: 1 }),
      paramNumber(obj, 'h', 'height (cells)', 11, { min: 1 }),
      action('object.rotateSlab', 'ROTATE 90', 'Swap width and height', {}, docCommand('builder.inspector.object.rotateSlab', { objectId: obj.id }), 'bi-rotate'),
      ...linkItems(obj, 'in', context),
    ];
  }
  if (obj.kind === 'plate') return [paramNumber(obj, 'w', 'width (cells)', 5, { min: 1 }), ...linkItems(obj, 'out', context)];
  if (obj.kind === 'scale') return [paramNumber(obj, 'w', 'pan width (cells)', 7, { min: 1 }), paramNumber(obj, 'threshold', 'threshold', 24, { min: 0 }), ...linkItems(obj, 'out', context)];
  if (obj.kind === 'buoy') {
    return [
      paramNumber(obj, 'w', 'basin width (cells)', 13, { min: 1 }),
      paramNumber(obj, 'depth', 'basin depth (cells)', 4, { min: 1 }),
      paramNumber(obj, 'threshold', 'threshold', 26, { min: 0 }),
      ...linkItems(obj, 'out', context),
    ];
  }
  if (obj.kind === 'lever' || obj.kind === 'brazier' || obj.kind === 'chargeLatch') return linkItems(obj, 'out', context);
  if (obj.kind === 'runeGlyph') return linkItems(obj, 'out', context);
  if (obj.kind === 'valve') {
    return [
      paramNumber(obj, 'w', 'width (cells)', 5, { min: 1 }),
      paramNumber(obj, 'h', 'height (cells)', 2, { min: 1 }),
      paramSelect(obj, 'material', 'material', ['metal', 'stone', 'wood', 'glass'], 'metal', true),
      paramCheckbox(obj, 'oneShot', 'one-shot (stays open)'),
      paramNumber(obj, 'autoClose', 'auto-close frames', 0, { min: 0 }),
      paramSelect(obj, 'logic', 'logic', ['and', 'or', 'sequence'], 'and', true),
      action('object.rotateSlab', 'ROTATE 90', 'Swap width and height', {}, docCommand('builder.inspector.object.rotateSlab', { objectId: obj.id }), 'bi-rotate'),
      ...linkItems(obj, 'in', context),
    ];
  }
  if (obj.kind === 'plug') {
    return [
      paramNumber(obj, 'w', 'width (cells)', 3, { min: 1 }),
      paramNumber(obj, 'h', 'height (cells)', 3, { min: 1 }),
      paramSelect(obj, 'material', 'material', ['wood', 'ash', 'glass', 'coal', 'stone', 'sand', 'metal'], 'wood', true),
      paramNumber(obj, 'breakFrac', 'break fraction', 0.5, { min: 0, max: 1, step: 0.05 }),
      help(['The material IS the break profile:', 'wood burns, glass shatters,', 'stone resists fire, metal needs', "a relay 'break'."]),
      action('object.rotateSlab', 'ROTATE 90', 'Swap width and height', {}, docCommand('builder.inspector.object.rotateSlab', { objectId: obj.id }), 'bi-rotate'),
      ...linkItems(obj, 'in', context),
      ...linkItems(obj, 'out', context),
    ];
  }
  if (obj.kind === 'sensor') {
    return [
      paramSelect(obj, 'type', 'reads', ['heat', 'liquid', 'weight', 'charge', 'material'], 'heat'),
      paramSelect(obj, 'filter', 'filter', ['', 'water', 'oil', 'acid', 'lava', 'sand', 'snow', 'gold', 'gunpowder', 'coal', 'ash', 'slime', 'healium', 'teleportium'], ''),
      paramNumber(obj, 'threshold', 'threshold', 6, { min: 1 }),
      paramNumber(obj, 'zoneW', 'zone width (cells)', 9, { min: 1 }),
      paramNumber(obj, 'zoneH', 'zone height (cells)', 7, { min: 1 }),
      paramSelect(obj, 'latch', 'latch', ['momentary', 'timed', 'permanent'], 'timed'),
      ...(obj.params.latch === 'timed'
        ? [paramNumber(obj, 'latchFrames', 'latch frames', 420, { min: 0 })]
        : []),
      ...linkItems(obj, 'out', context),
    ];
  }
  if (obj.kind === 'counterweight') {
    return [
      paramNumber(obj, 'w', 'pan width (cells)', 7, { min: 1 }),
      paramNumber(obj, 'threshold', 'threshold', 30, { min: 1 }),
      help(['Latches PERMANENTLY once enough', 'material mass stays poured.']),
      ...linkItems(obj, 'out', context),
    ];
  }
  if (obj.kind === 'relay') {
    return [
      paramNumber(obj, 'delay', 'delay frames', 0, { min: 0 }),
      paramSelect(obj, 'action', 'on fire', ['activate', 'ignite', 'break', 'strike'], 'activate', true),
      paramSelect(obj, 'logic', 'input logic', ['and', 'or', 'sequence'], 'and', true),
      help(['One-shot: inputs satisfied -> wait', '-> fire once -> latched forever.']),
      ...linkItems(obj, 'in', context),
      ...linkItems(obj, 'out', context),
    ];
  }
  return [];
}

function enemyItems(obj: EditorObject, context: ObjectInspectorSchemaContext): InspectorSchemaItem[] {
  const items: InspectorSchemaItem[] = [paramSelect(obj, 'kind', 'kind', ENEMY_KINDS, 'slime')];
  if (obj.params.kind === 'bat') items.push(paramCheckbox(obj, 'sleeping', 'roosting'));
  if (PATROL_KINDS.has(String(obj.params.kind))) {
    const n = Array.isArray(obj.params.patrol) ? (obj.params.patrol as unknown[]).length : 0;
    items.push(
      action(
        'object.patrol',
        context.patrolEditId === obj.id
          ? 'PATROL: CLICK POINTS - ESC ENDS'
          : n > 0
            ? `EDIT PATROL (${n} PTS)`
            : 'ADD PATROL ROUTE',
        undefined,
        {},
        docCommand('builder.inspector.object.patrol', { objectId: obj.id }),
        'bi-patrol',
        context.patrolEditId === obj.id ? 'bi-armed' : undefined,
      ),
    );
    if (n > 0) {
      items.push(action('object.patrolClear', 'CLEAR PATROL', undefined, {}, docCommand('builder.inspector.object.patrol.clear', { objectId: obj.id }), 'bi-patrol-clear'));
    }
    if (n > 0 && context.patrolEditId !== obj.id) {
      items.push(help(['Drag waypoints in the select', 'tool; in patrol edit, RMB', 'deletes one.']));
    }
  }
  return items;
}

function hazardEmitterItems(obj: EditorObject): InspectorSchemaItem[] {
  const cells = ['water', 'oil', 'acid', 'lava', 'fire', 'ember', 'sand', 'snow', 'smoke'];
  return [
    paramSelect(obj, 'cell', 'material', cells, 'water'),
    paramNumber(obj, 'rate', 'rate (frames)', 30, { min: 2 }),
    paramNumber(obj, 'burst', 'burst (cells)', 1, { min: 1, max: 8 }),
    paramNumber(obj, 'phase', 'phase (frames)', 0, { min: 0 }),
    help(['Drips "burst" real cells every', '"rate" frames (offset by phase),', 'aimed by rotation; the grid', 'does the rest.']),
  ];
}

function decorItems(obj: EditorObject, context: ObjectInspectorSchemaContext): InspectorSchemaItem[] {
  const spriteAssets = mergedSprites(context.sprites, context.documentSprites);
  const sid = typeof obj.params.spriteId === 'string' ? obj.params.spriteId : '';
  const asset = sid ? (spriteAssets.find((sprite) => sprite.id === sid) ?? null) : null;
  const items: InspectorSchemaItem[] = [
    paramText(obj, 'text', 'note'),
    field(
      {
        kind: 'color',
        id: 'param.color',
        label: 'color',
        value: typeof obj.params.color === 'string' ? obj.params.color : '#d6e6f5',
        dataset: { p: 'color' },
      },
      paramCommand(obj, 'color'),
    ),
    paramSelect(
      obj,
      'spriteId',
      'sprite',
      [
        { value: '', label: '- none (note) -' },
        ...spriteAssets.map((sprite) => ({ value: sprite.id, label: sprite.name })),
      ],
      '',
    ),
  ];
  if (sid && !asset) items.push(readout('decor.asset', 'asset', 'missing - skipped at compile', 'warn'));
  if (asset) {
    const loopTag = typeof obj.params.loopTag === 'string' ? obj.params.loopTag : '';
    items.push(
      paramSelect(
        obj,
        'loopTag',
        'loop tag',
        [
          { value: '', label: 'all frames' },
          ...asset.tags.map((tag) => ({
            value: tag.name,
            label: `${tag.name} (${tag.from}-${tag.to} ${tag.dir})`,
          })),
        ],
        loopTag,
      ),
      paramNumber(obj, 'fps', 'fps (0 = authored)', 0, { min: 0, max: 60 }),
      paramCheckbox(obj, 'flipX', 'flip X'),
      field(
        {
          kind: 'checkbox',
          id: 'asset.sprite.emissive',
          label: 'emissive',
          checked: asset.emissive,
          controlId: 'bi-sprite-emissive',
          hint: 'Sprite-level library edit, not document undo',
        },
        {
          id: 'builder.inspector.sprite.emissive',
          target: 'asset-library',
          ownership: 'asset-library',
          undoable: false,
          payload: { spriteId: asset.id },
        },
      ),
      {
        kind: 'custom',
        id: 'decor.sprite.preview',
        html: spritePreviewCanvas(asset),
      },
    );
  }
  items.push(help([asset ? "Visual only; the grid doesn't" : 'Designer annotation only;', asset ? "know it's there." : 'never compiles into the level.']));
  return items;
}

function pickupItems(obj: EditorObject): InspectorSchemaItem[] {
  const items: InspectorSchemaItem[] = [paramSelect(obj, 'kind', 'kind', PICKUP_KINDS, 'goldpile')];
  const kind = obj.params.kind;
  if (kind === 'goldpile' || kind === 'chest') items.push(paramNumber(obj, 'amount', 'amount (gold)', 30, { min: 0 }));
  if (kind === 'tome') items.push(paramSelect(obj, 'card', 'card', CARD_PICKUP_OPTIONS, ''));
  if (kind === 'potion') items.push(paramSelect(obj, 'potion', 'potion', POTION_PICKUP_OPTIONS, ''));
  return items;
}

function linkItems(obj: EditorObject, dir: 'in' | 'out', context: ObjectInspectorSchemaContext): InspectorSchemaItem[] {
  const links = context.links.filter((link) => (dir === 'in' ? link.toId === obj.id : link.fromId === obj.id));
  if (links.length === 0) {
    return [readout(`links.${dir}.empty`, dir === 'in' ? 'triggers' : 'drives', 'unlinked (K)', 'warn')];
  }
  const numbered = dir === 'in' && obj.kind === 'door' && obj.params.logic === 'sequence';
  return links.map((link, index) => {
    const otherId = dir === 'in' ? link.fromId : link.toId;
    const other = context.objects.find((candidate) => candidate.id === otherId);
    const prefix = numbered ? `${index + 1}. ` : dir === 'in' ? '<- ' : '-> ';
    return {
      kind: 'rowAction',
      id: `link.${link.id}`,
      label: `${prefix}${other?.kind ?? '?'}`,
      actionLabel: 'x',
      title: 'Remove link',
      dataset: { unlink: link.id },
      command: docCommand('builder.inspector.object.unlink', { linkId: link.id }),
    };
  });
}

interface NumberBounds {
  min?: number;
  max?: number;
  step?: number;
}

function paramNumber(
  obj: EditorObject,
  key: string,
  label: string,
  fallback: number,
  bounds?: NumberBounds,
): InspectorSchemaItem {
  return field(
    {
      kind: 'number',
      id: `param.${key}`,
      label,
      value: paramNum(obj, key, fallback),
      min: bounds?.min,
      max: bounds?.max,
      step: bounds?.step,
      dataset: { p: key, num: 1 },
    },
    paramCommand(obj, key),
  );
}

function paramCheckbox(obj: EditorObject, key: string, label: string): InspectorSchemaItem {
  return field(
    {
      kind: 'checkbox',
      id: `param.${key}`,
      label,
      checked: obj.params[key] === true,
      dataset: { p: key },
    },
    paramCommand(obj, key),
  );
}

function paramText(obj: EditorObject, key: string, label: string, placeholder?: string): InspectorSchemaItem {
  return field(
    {
      kind: 'text',
      id: `param.${key}`,
      label,
      value: typeof obj.params[key] === 'string' ? (obj.params[key] as string) : '',
      placeholder,
      dataset: { p: key },
    },
    paramCommand(obj, key),
  );
}

function paramSelect(
  obj: EditorObject,
  key: string,
  label: string,
  options: Array<string | FieldOption>,
  fallback: string,
  uppercase = false,
): InspectorSchemaItem {
  const cur = typeof obj.params[key] === 'string' ? (obj.params[key] as string) : fallback;
  return field(
    {
      kind: 'select',
      id: `param.${key}`,
      label,
      value: cur,
      options: options.map((option) => {
        if (typeof option !== 'string') return option;
        return { value: option, label: option === '' ? '' : uppercase ? option.toUpperCase() : option };
      }),
      dataset: { p: key },
    },
    paramCommand(obj, key),
  );
}

function numericLightField(
  id: string,
  label: string,
  value: number,
  dataset: Record<string, string | number | boolean>,
  min: number,
  max: number,
  step?: number,
): EditorField {
  return { kind: 'number', id, label, value, min, max, step, dataset };
}

function mixedCheckbox(
  id: string,
  label: string,
  value: boolean | typeof MIXED_VALUE | undefined,
  dataset: Record<string, string | number | boolean>,
): EditorField {
  return {
    kind: 'checkbox',
    id,
    label,
    checked: value === true,
    mixed: isMixedValue(value),
    dataset,
  };
}

function field(fieldDef: EditorField, command: InspectorCommandRef): InspectorSchemaItem {
  return { kind: 'field', field: fieldDef, command };
}

function section(label: string, id?: string): InspectorSchemaItem {
  return { kind: 'section', label, id };
}

function identity(value: string): InspectorSchemaItem {
  return { kind: 'identity', value };
}

function readout(id: string, label: string, value: string | number | boolean, tone?: 'normal' | 'warn' | 'muted'): InspectorSchemaItem {
  return { kind: 'readout', id, label, value, tone };
}

function help(lines: string[]): InspectorSchemaItem {
  return { kind: 'help', lines };
}

function actionGroup(id: string, actions: Extract<InspectorSchemaItem, { kind: 'action' }>[]): InspectorSchemaItem {
  return { kind: 'actionGroup', id, className: 'bp-grid bp-grid2', actions };
}

function action(
  id: string,
  label: string,
  title: string | undefined,
  dataset: Record<string, string | number | boolean>,
  command: InspectorCommandRef,
  elementId?: string,
  className?: string,
): Extract<InspectorSchemaItem, { kind: 'action' }> {
  return { kind: 'action', id, label, title, dataset, command, elementId, className };
}

function paramCommand(obj: EditorObject, key: string): InspectorCommandRef {
  return docCommand(`builder.inspector.object.param.${key}`, { objectId: obj.id, key });
}

function docCommand(id: string, payload?: Record<string, string | number | boolean>): InspectorCommandRef {
  return { id, target: 'builder-document', ownership: 'document-command', undoable: true, payload };
}

function docMetaCommand(id: string, payload?: Record<string, string | number | boolean>): InspectorCommandRef {
  return { id, target: 'builder-document', ownership: 'document-metadata-command', undoable: true, payload };
}

function viewCommand(id: string, payload?: Record<string, string | number | boolean>): InspectorCommandRef {
  return { id, target: 'view-session', ownership: 'view-session', undoable: false, payload };
}

function mergedSprites(library: SpriteAsset[], embedded: SpriteAsset[]): SpriteAsset[] {
  const out = [...library];
  for (const sprite of embedded) {
    if (!out.some((candidate) => candidate.id === sprite.id)) out.push(sprite);
  }
  return out;
}

function spritePreviewCanvas(asset: SpriteAsset): string {
  const scale = Math.max(1, Math.min(4, Math.floor(96 / Math.max(1, asset.w, asset.h))));
  const width = Math.max(1, Math.floor(asset.w * scale));
  const height = Math.max(1, Math.floor(asset.h * scale));
  return `<canvas id="bi-sprite-prev" width="${width}" height="${height}" style="display:block;margin:4px auto;image-rendering:pixelated;background:#0a0c11"></canvas>`;
}

import { objectFootprint, paramNum } from '@/builder/document';
import type { EditorLight, EditorObject, EditorObjectKind } from '@/builder/document';
import { AUTHORED_LIGHT_RADIUS_MAX, AUTHORED_LIGHT_RADIUS_MIN } from '@/builder/document';

export type GizmoOwnerKind = 'object' | 'light';
export type GizmoHandleKind =
  | 'resize-e'
  | 'resize-se'
  | 'rotate'
  | 'light-radius'
  | 'light-falloff'
  | 'waypoint';

export interface GizmoHandle {
  id: string;
  ownerId: string;
  ownerKind: GizmoOwnerKind;
  kind: GizmoHandleKind;
  worldX: number;
  worldY: number;
  cursor: string;
  label: string;
  index?: number;
}

export interface ProjectedGizmoHandle extends GizmoHandle {
  sx: number;
  sy: number;
  radiusPx: number;
}

export interface ObjectResizePatch {
  x?: number;
  y?: number;
  params: Record<string, number>;
}

export const GIZMO_HANDLE_RADIUS_PX = 6;
export const GIZMO_HIT_RADIUS_PX = 13;

const POINT_ROTATE_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'enemy',
  'hazardEmitter',
  'decor',
  'pickup',
]);

const SLAB_RESIZE_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'door',
  'runeDoor',
  'valve',
  'plug',
]);

const WIDTH_ONLY_RESIZE_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'plate',
  'scale',
  'counterweight',
  'exitWell',
]);

const BASIN_RESIZE_KINDS: ReadonlySet<EditorObjectKind> = new Set(['buoy', 'sensor']);

export function objectGizmoBounds(
  object: EditorObject,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (object.kind === 'sensor') {
    const w = Math.max(1, paramNum(object, 'zoneW', 9));
    const h = Math.max(1, paramNum(object, 'zoneH', 7));
    const x0 = object.x - Math.floor(w / 2);
    return { x0, y0: object.y - h, x1: x0 + w - 1, y1: object.y };
  }
  return objectFootprint(object);
}

export function canResizeObject(object: EditorObject): boolean {
  return (
    SLAB_RESIZE_KINDS.has(object.kind) ||
    WIDTH_ONLY_RESIZE_KINDS.has(object.kind) ||
    BASIN_RESIZE_KINDS.has(object.kind)
  );
}

export function canRotateObject(object: EditorObject): boolean {
  return POINT_ROTATE_KINDS.has(object.kind) || SLAB_RESIZE_KINDS.has(object.kind);
}

export function objectGizmoHandles(object: EditorObject): GizmoHandle[] {
  const handles: GizmoHandle[] = [];
  const bounds = objectGizmoBounds(object);

  if (canResizeObject(object) && bounds) {
    if (WIDTH_ONLY_RESIZE_KINDS.has(object.kind)) {
      handles.push({
        id: `${object.id}:resize-e`,
        ownerId: object.id,
        ownerKind: 'object',
        kind: 'resize-e',
        worldX: widthOnlyHandleX(object, bounds.x1 + 1),
        worldY: (bounds.y0 + bounds.y1 + 1) / 2,
        cursor: 'ew-resize',
        label: 'Resize width',
      });
    } else if (BASIN_RESIZE_KINDS.has(object.kind)) {
      handles.push({
        id: `${object.id}:resize-se`,
        ownerId: object.id,
        ownerKind: 'object',
        kind: 'resize-se',
        worldX: bounds.x1 + 1,
        worldY: bounds.y0,
        cursor: 'nesw-resize',
        label: object.kind === 'sensor' ? 'Resize sensor zone' : 'Resize basin',
      });
    } else {
      handles.push({
        id: `${object.id}:resize-se`,
        ownerId: object.id,
        ownerKind: 'object',
        kind: 'resize-se',
        worldX: bounds.x1 + 1,
        worldY: bounds.y1 + 1,
        cursor: 'nwse-resize',
        label: BASIN_RESIZE_KINDS.has(object.kind) ? 'Resize zone' : 'Resize footprint',
      });
    }
  }

  if (canRotateObject(object)) {
    const x = bounds ? (bounds.x0 + bounds.x1 + 1) / 2 : object.x;
    const y = bounds ? bounds.y0 : object.y;
    handles.push({
      id: `${object.id}:rotate`,
      ownerId: object.id,
      ownerKind: 'object',
      kind: 'rotate',
      worldX: x,
      worldY: y,
      cursor: 'crosshair',
      label: 'Rotate 90 degrees',
    });
  }

  if (object.kind === 'enemy' && Array.isArray(object.params.patrol)) {
    const pts = object.params.patrol as Array<[number, number]>;
    pts.forEach(([worldX, worldY], index) => {
      handles.push({
        id: `${object.id}:waypoint:${index}`,
        ownerId: object.id,
        ownerKind: 'object',
        kind: 'waypoint',
        worldX,
        worldY,
        cursor: 'move',
        label: `Waypoint ${index + 1}`,
        index,
      });
    });
  }

  return handles;
}

export function lightGizmoHandles(light: EditorLight): GizmoHandle[] {
  const radius = Math.max(1, light.radius);
  return [
    {
      id: `${light.id}:light-radius`,
      ownerId: light.id,
      ownerKind: 'light',
      kind: 'light-radius',
      worldX: light.x + radius,
      worldY: light.y,
      cursor: 'ew-resize',
      label: 'Light radius',
    },
    {
      id: `${light.id}:light-falloff`,
      ownerId: light.id,
      ownerKind: 'light',
      kind: 'light-falloff',
      worldX: light.x + radius * 0.707,
      worldY: light.y - radius * 0.707,
      cursor: 'pointer',
      label: 'Cycle light falloff',
    },
  ];
}

export function projectGizmoHandles(
  handles: readonly GizmoHandle[],
  toScreen: (wx: number, wy: number) => { x: number; y: number },
): ProjectedGizmoHandle[] {
  return handles.map((handle) => {
    const p = toScreen(handle.worldX, handle.worldY);
    return {
      ...handle,
      sx: p.x,
      sy: handle.kind === 'rotate' ? p.y - 18 : p.y,
      radiusPx: GIZMO_HANDLE_RADIUS_PX,
    };
  });
}

export function hitProjectedGizmoHandle(
  handles: readonly ProjectedGizmoHandle[],
  sx: number,
  sy: number,
  hitRadiusPx = GIZMO_HIT_RADIUS_PX,
): ProjectedGizmoHandle | null {
  let best: ProjectedGizmoHandle | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const handle of handles) {
    const dx = handle.sx - sx;
    const dy = handle.sy - sy;
    const d = dx * dx + dy * dy;
    if (d <= hitRadiusPx * hitRadiusPx && d <= bestD) {
      best = handle;
      bestD = d;
    }
  }
  return best;
}

export function resizeObjectPatchFromDrag(
  object: EditorObject,
  handle: GizmoHandleKind,
  worldX: number,
  worldY: number,
): ObjectResizePatch | null {
  if (handle !== 'resize-e' && handle !== 'resize-se') return null;
  if (SLAB_RESIZE_KINDS.has(object.kind)) {
    return {
      params: {
        w: clampInt(Math.round(worldX - object.x), 1, 240),
        h: clampInt(Math.round(worldY - object.y), 1, 240),
      },
    };
  }
  if (object.kind === 'sensor') {
    return {
      params: {
        zoneW: clampOdd(Math.round(Math.abs(worldX - object.x) * 2 - 1), 1, 161),
        zoneH: clampInt(Math.round(object.y - worldY), 1, 160),
      },
    };
  }
  if (object.kind === 'buoy') {
    return {
      params: {
        w: clampOdd(Math.round(Math.abs(worldX - object.x) * 2 - 1), 3, 161),
        depth: clampInt(Math.round(object.y - worldY), 1, 80),
      },
    };
  }
  if (object.kind === 'exitWell') {
    return {
      params: {
        halfW: clampInt(Math.round(Math.abs(worldX - object.x) - 4), 3, 120),
      },
    };
  }
  if (WIDTH_ONLY_RESIZE_KINDS.has(object.kind)) {
    return {
      params: {
        w: clampOdd(Math.round(Math.abs(worldX - object.x) * 2 - 1), 1, 161),
      },
    };
  }
  return null;
}

export function lightRadiusFromDrag(
  light: EditorLight,
  worldX: number,
  worldY: number,
): number {
  return clampInt(Math.round(Math.hypot(worldX - light.x, worldY - light.y)), AUTHORED_LIGHT_RADIUS_MIN, AUTHORED_LIGHT_RADIUS_MAX);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampOdd(value: number, min: number, max: number): number {
  const clamped = clampInt(value, min, max);
  return clamped % 2 === 1 ? clamped : Math.max(min, clamped - 1);
}

function widthOnlyHandleX(object: EditorObject, footprintRightOutside: number): number {
  if (object.kind === 'scale' || object.kind === 'counterweight') {
    return object.x + Math.ceil(paramNum(object, 'w', 7) / 2);
  }
  return footprintRightOutside;
}

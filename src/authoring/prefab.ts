import { rleDecode } from '@/core/rle';
import { CELL_COUNT } from '@/sim/CellType';
import {
  AUTHORED_LIGHT_BLOOM_MAX,
  AUTHORED_LIGHT_FLICKER_MAX,
  AUTHORED_LIGHT_INTENSITY_MAX,
  AUTHORED_LIGHT_RADIUS_MAX,
  AUTHORED_LIGHT_RADIUS_MIN,
  EDITOR_LINK_KINDS,
  EDITOR_OBJECT_KINDS,
  freshId,
} from '@/authoring/document';
import type {
  EditorLight,
  EditorLink,
  EditorObject,
  EditorObjectKind,
} from '@/authoring/document';

export interface PrefabAnchor {
  id: string;
  /** Prefab-local, on/near the footprint edge. */
  x: number;
  y: number;
  /** Outward approach direction for the worldgen tunneler. */
  dir: 'n' | 's' | 'e' | 'w';
  /** 'sealed' = tunnel resealed with the biome breach skin (secrets-style). */
  kind: 'open' | 'sealed';
  /** Opening half-width in cells (default 4). */
  halfW?: number;
}

export interface PrefabDef {
  v: 1;
  kind: 'prefab';
  id: string;
  name: string;
  tags: string[];
  w: number;
  h: number;
  /** Terrain RLE over w*h local cells. */
  rle: string;
  /** Sparse [localIdx, value] pairs. */
  life?: Array<[number, number]>;
  charge?: Array<[number, number]>;
  colorOverrides?: Array<[number, number]>;
  /** Local coords, prefab-local ids ("p0", "p1"...), remapped on paste. */
  objects: EditorObject[];
  /** Only links whose both endpoints are in `objects`. */
  links: EditorLink[];
  lights: EditorLight[];
  /** Worldgen connection points. */
  anchors?: PrefabAnchor[];
  createdAt?: string;
}

/** Capture cap: prefabs are rooms, not whole levels. */
export const PREFAB_CELL_CAP = 40000;

export function decodePrefabCells(p: PrefabDef): Uint8Array {
  const out = new Uint8Array(p.w * p.h);
  rleDecode(p.rle, out);
  return out;
}

const PREFAB_EXCLUDED_OBJECT_KINDS: ReadonlySet<EditorObjectKind> = new Set(['spawn']);
const OBJECT_KINDS = new Set<EditorObjectKind>(
  EDITOR_OBJECT_KINDS.filter((kind) => !PREFAB_EXCLUDED_OBJECT_KINDS.has(kind)),
);

const LINK_KINDS = new Set<EditorLink['kind']>(EDITOR_LINK_KINDS);

function rleLength(rle: string): number {
  const bin = atob(rle);
  let total = 0;
  for (let i = 0; i + 2 < bin.length; i += 3) {
    total += bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8);
  }
  return total;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.floor(v)));

export function sanitizePrefab(
  parsed: unknown,
): { prefab: PrefabDef; warnings: string[] } | null {
  const p = parsed as PrefabDef;
  if (!p || typeof p !== 'object' || p.v !== 1 || p.kind !== 'prefab') return null;
  if (!num(p.w) || !num(p.h) || p.w < 1 || p.h < 1) return null;
  const w = Math.floor(p.w);
  const h = Math.floor(p.h);
  if (w * h > PREFAB_CELL_CAP) return null;
  if (typeof p.rle !== 'string') return null;
  try {
    if (rleLength(p.rle) !== w * h) return null;
    const cells = new Uint8Array(w * h);
    rleDecode(p.rle, cells);
    for (const cell of cells) {
      if (cell >= CELL_COUNT) return null;
    }
  } catch {
    return null;
  }

  const warnings: string[] = [];
  const objects: EditorObject[] = [];
  const ids = new Set<string>();
  for (const raw of Array.isArray(p.objects) ? p.objects : []) {
    const o = raw as EditorObject;
    if (!o || typeof o !== 'object' || !num(o.x) || !num(o.y)) {
      warnings.push('dropped a malformed object record');
      continue;
    }
    if (o.kind === ('spawn' as EditorObjectKind)) {
      warnings.push('dropped a spawn object (prefabs are rooms, not levels)');
      continue;
    }
    if (!OBJECT_KINDS.has(o.kind)) {
      warnings.push(`dropped object of unknown kind "${String(o.kind)}"`);
      continue;
    }
    let id = typeof o.id === 'string' && o.id ? o.id : 'p' + objects.length;
    while (ids.has(id)) id = id + '+';
    ids.add(id);
    objects.push({
      id,
      kind: o.kind,
      x: clampInt(o.x, 0, w - 1),
      y: clampInt(o.y, 0, h - 1),
      rotation: o.rotation === 90 || o.rotation === 180 || o.rotation === 270 ? o.rotation : 0,
      locked: o.locked === true,
      hidden: o.hidden === true,
      params: o.params && typeof o.params === 'object' ? o.params : {},
    });
  }

  const links: EditorLink[] = [];
  for (const raw of Array.isArray(p.links) ? p.links : []) {
    const l = raw as EditorLink;
    if (
      !l ||
      typeof l !== 'object' ||
      !LINK_KINDS.has(l.kind) ||
      !ids.has(l.fromId) ||
      !ids.has(l.toId)
    ) {
      warnings.push('dropped a link with a missing endpoint');
      continue;
    }
    links.push({
      id: typeof l.id === 'string' && l.id ? l.id : 'k' + links.length,
      fromId: l.fromId,
      toId: l.toId,
      kind: l.kind,
      ...(l.logic === 'and' || l.logic === 'or' || l.logic === 'sequence'
        ? { logic: l.logic }
        : {}),
    });
  }

  const lights: EditorLight[] = [];
  for (const raw of Array.isArray(p.lights) ? p.lights : []) {
    const l = raw as EditorLight;
    if (!l || typeof l !== 'object' || !num(l.x) || !num(l.y)) {
      warnings.push('dropped a malformed light record');
      continue;
    }
    lights.push({
      id: typeof l.id === 'string' && l.id ? l.id : 'L' + lights.length,
      x: clampInt(l.x, 0, w - 1),
      y: clampInt(l.y, 0, h - 1),
      color: typeof l.color === 'string' ? l.color : '#ffb060',
      intensity: num(l.intensity) ? Math.max(0, Math.min(AUTHORED_LIGHT_INTENSITY_MAX, l.intensity)) : 1,
      radius: num(l.radius) ? Math.max(AUTHORED_LIGHT_RADIUS_MIN, Math.min(AUTHORED_LIGHT_RADIUS_MAX, l.radius)) : 60,
      bloom: num(l.bloom) ? Math.max(0, Math.min(AUTHORED_LIGHT_BLOOM_MAX, l.bloom)) : 0,
      flicker: num(l.flicker) ? Math.max(0, Math.min(AUTHORED_LIGHT_FLICKER_MAX, l.flicker)) : 0,
      falloff: l.falloff === 'linear' || l.falloff === 'sharp' ? l.falloff : 'soft',
      occluded: l.occluded !== false,
      locked: l.locked === true,
      hidden: l.hidden === true,
    });
  }

  const sparse = (
    pairs: Array<[number, number]> | undefined,
    minVal: number,
    maxVal: number,
  ): Array<[number, number]> | undefined => {
    if (!Array.isArray(pairs)) return undefined;
    const out: Array<[number, number]> = [];
    for (const pair of pairs) {
      if (!Array.isArray(pair) || !num(pair[0]) || !num(pair[1])) continue;
      const i = Math.floor(pair[0]);
      if (i < 0 || i >= w * h) continue;
      out.push([i, clampInt(pair[1], minVal, maxVal)]);
    }
    return out.length > 0 ? out : undefined;
  };

  const anchors: PrefabAnchor[] = [];
  for (const raw of Array.isArray(p.anchors) ? p.anchors : []) {
    const a = raw as PrefabAnchor;
    if (!a || typeof a !== 'object' || !num(a.x) || !num(a.y)) continue;
    anchors.push({
      id: typeof a.id === 'string' && a.id ? a.id : 'a' + anchors.length,
      x: clampInt(a.x, 0, w - 1),
      y: clampInt(a.y, 0, h - 1),
      dir: a.dir === 'n' || a.dir === 's' || a.dir === 'e' || a.dir === 'w' ? a.dir : 'w',
      kind: a.kind === 'sealed' ? 'sealed' : 'open',
      ...(num(a.halfW) ? { halfW: clampInt(a.halfW, 2, 12) } : {}),
    });
  }

  return {
    prefab: {
      v: 1,
      kind: 'prefab',
      id: typeof p.id === 'string' && p.id ? p.id : freshId('prefab'),
      name: typeof p.name === 'string' && p.name.trim() ? p.name : 'imported',
      tags: Array.isArray(p.tags)
        ? p.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : [],
      w,
      h,
      rle: p.rle,
      life: sparse(p.life, -32768, 32767),
      charge: sparse(p.charge, 0, 65535),
      colorOverrides: sparse(p.colorOverrides, 0, 0xffffff),
      objects,
      links,
      lights,
      ...(anchors.length > 0 ? { anchors } : {}),
      ...(typeof p.createdAt === 'string' ? { createdAt: p.createdAt } : {}),
    },
    warnings,
  };
}

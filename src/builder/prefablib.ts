import { rleEncode } from '@/core/rle';
import type { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { writeCell } from '@/builder/terrain';
import type { PatchRecorder, Region } from '@/builder/terrain';
import { decodePrefabCells, PREFAB_CELL_CAP, sanitizePrefab } from '@/authoring/prefab';
import type { PrefabAnchor, PrefabDef } from '@/authoring/prefab';
import { freshId } from '@/builder/document';
import type {
  EditorDocument,
  EditorLight,
  EditorLink,
  EditorObject,
  EditorObjectKind,
} from '@/builder/document';
export { decodePrefabCells, PREFAB_CELL_CAP, sanitizePrefab } from '@/authoring/prefab';
export type { PrefabAnchor, PrefabDef } from '@/authoring/prefab';

/**
 * PrefabDef v1 — the shared authored-chunk contract consumed by three
 * pipelines:
 *   1. the Builder prefab library (capture / browse / paste),
 *   2. the asset exporter (palette-indexed terrain PNG + .prefab.json),
 *   3. worldgen placement (seeded stamping into generated levels, tunneled
 *      to the cave network through `anchors`).
 *
 * A prefab is a stamp grown up: the rectangular terrain block (colors still
 * regenerate from material factories — hand-tints are NOT captured) plus the
 * objects, internal links, and lights inside it, all in LOCAL cell
 * coordinates (origin top-left, idx = x + y * w).
 *
 * Evolution rule: additive optional fields only; structural changes bump `v`.
 * The `kind: 'prefab'` discriminator keeps .prefab.json files from colliding
 * with Sandbox raw saves (which are also `{v: 1}`).
 */

const PREFAB_PREFIX = 'noita-builder-prefab:';
const LEGACY_STAMPS_KEY = 'noita-builder-stamps';

/* ---------------- capture ---------------- */

/** Transient life on fire-family cells is noise; everything else is intent
 *  (same rule as captureWorldLayer in document.ts). */
function isTransientLife(t: number): boolean {
  return t === Cell.Fire || t === Cell.Ember || t === Cell.Smoke || t === Cell.Steam;
}

function localPatrol(
  params: Record<string, unknown>,
  dx: number,
  dy: number,
): void {
  if (!Array.isArray(params.patrol)) return;
  params.patrol = (params.patrol as Array<[number, number]>).map(([px, py]) => [
    px + dx,
    py + dy,
  ]);
}

/**
 * Capture the region's cells plus the objects / internal links / lights
 * inside it, all re-based to local coordinates. `spawn` objects are skipped
 * (a prefab is a room, not a level); links with an endpoint outside the
 * region are dropped and counted so the UI can warn.
 */
export function capturePrefab(
  world: World,
  region: Region,
  doc: EditorDocument,
  name: string,
  tags: string[] = [],
): { prefab: PrefabDef; droppedLinks: number } | null {
  const w = region.x1 - region.x0 + 1;
  const h = region.y1 - region.y0 + 1;
  if (w <= 0 || h <= 0 || w * h > PREFAB_CELL_CAP) return null;

  const cells = new Uint8Array(w * h);
  const life: Array<[number, number]> = [];
  const charge: Array<[number, number]> = [];
  const colorOverrides: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = region.x0 + x,
        Y = region.y0 + y;
      if (!world.inBounds(X, Y)) continue;
      const wi = world.idx(X, Y);
      const li = x + y * w;
      cells[li] = world.types[wi];
      if (world.life[wi] !== 0 && !isTransientLife(world.types[wi])) {
        life.push([li, world.life[wi]]);
      }
      if (world.charge[wi] !== 0) charge.push([li, world.charge[wi]]);
      // Capture override status so a hand-tinted cell round-trips through the
      // prefab (paste re-registers these via world.colorOverrides.add).
      if (world.colorOverrides.has(wi)) colorOverrides.push([li, world.colors[wi]]);
    }
  }

  const inRegion = (x: number, y: number): boolean =>
    x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;

  const idMap = new Map<string, string>();
  const objects: EditorObject[] = [];
  for (const o of doc.objects) {
    if (o.kind === 'spawn' || !inRegion(o.x, o.y)) continue;
    const localId = 'p' + objects.length;
    idMap.set(o.id, localId);
    const clone = structuredClone(o);
    clone.id = localId;
    clone.x = o.x - region.x0;
    clone.y = o.y - region.y0;
    delete clone.group; // group membership is document-scoped
    localPatrol(clone.params, -region.x0, -region.y0);
    objects.push(clone);
  }

  let droppedLinks = 0;
  const links: EditorLink[] = [];
  for (const l of doc.links) {
    const from = idMap.get(l.fromId);
    const to = idMap.get(l.toId);
    if (!idMap.has(l.fromId) && !idMap.has(l.toId)) continue; // fully outside — not ours
    if (!from || !to) {
      droppedLinks++;
      continue;
    }
    links.push({ ...l, id: 'k' + links.length, fromId: from, toId: to });
  }

  const lights: EditorLight[] = [];
  for (const l of doc.lights) {
    if (!inRegion(l.x, l.y)) continue;
    lights.push({ ...l, id: 'L' + lights.length, x: l.x - region.x0, y: l.y - region.y0 });
  }

  return {
    prefab: {
      v: 1,
      kind: 'prefab',
      id: freshId('prefab'),
      name: name || 'prefab',
      tags,
      w,
      h,
      rle: rleEncode(cells),
      ...(life.length > 0 ? { life } : {}),
      ...(charge.length > 0 ? { charge } : {}),
      ...(colorOverrides.length > 0 ? { colorOverrides } : {}),
      objects,
      links,
      lights,
      createdAt: new Date().toISOString(),
    },
    droppedLinks,
  };
}

/* ---------------- transforms ---------------- */

/** Kinds whose params.w/params.h describe an axis-aligned slab that must
 *  swap dimensions under 90-degree rotation (with footprint-aware origin). */
const SLAB_DEFAULTS: Partial<Record<EditorObjectKind, { w: number; h: number }>> = {
  door: { w: 3, h: 13 },
  runeDoor: { w: 2, h: 11 },
  valve: { w: 5, h: 2 },
  plug: { w: 3, h: 3 },
};

function slabDims(o: EditorObject): { w: number; h: number } | null {
  const d = SLAB_DEFAULTS[o.kind];
  if (!d) return null;
  const pw = o.params.w,
    ph = o.params.h;
  return {
    w: typeof pw === 'number' && Number.isFinite(pw) ? pw : d.w,
    h: typeof ph === 'number' && Number.isFinite(ph) ? ph : d.h,
  };
}

function mapSparse(
  pairs: Array<[number, number]> | undefined,
  srcW: number,
  map: (x: number, y: number) => [number, number],
  dstW: number,
): Array<[number, number]> | undefined {
  if (!pairs || pairs.length === 0) return undefined;
  return pairs.map(([i, v]) => {
    const [nx, ny] = map(i % srcW, Math.floor(i / srcW));
    return [nx + ny * dstW, v] as [number, number];
  });
}

const ROT_DIR: Record<PrefabAnchor['dir'], PrefabAnchor['dir']> = {
  n: 'e',
  e: 's',
  s: 'w',
  w: 'n',
};
const MIRROR_DIR: Record<PrefabAnchor['dir'], PrefabAnchor['dir']> = {
  n: 'n',
  s: 's',
  e: 'w',
  w: 'e',
};

function mirrorRotation(rotation: EditorObject['rotation']): EditorObject['rotation'] {
  return (((360 - rotation) % 360) as EditorObject['rotation']);
}

/** 90 degrees clockwise: src(x, y) -> dst(h-1-y, x); w/h swap. */
export function rotatePrefab(p: PrefabDef): PrefabDef {
  const src = decodePrefabCells(p);
  const dw = p.h,
    dh = p.w;
  const dst = new Uint8Array(dw * dh);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      dst[p.h - 1 - y + x * dw] = src[x + y * p.w];
    }
  }
  const point = (x: number, y: number): [number, number] => [p.h - 1 - y, x];

  const objects = p.objects.map((o) => {
    const clone = structuredClone(o);
    const slab = slabDims(o);
    if (slab) {
      // the slab covers [x, x+w-1] x [y, y+h-1]; keep it covering the same
      // rotated cells: new top-left is (H - y - slabH, x), dims swap
      clone.x = p.h - o.y - slab.h;
      clone.y = o.x;
      clone.params = { ...clone.params, w: slab.h, h: slab.w };
    } else {
      [clone.x, clone.y] = point(o.x, o.y);
      if (Array.isArray(clone.params.patrol)) {
        clone.params.patrol = (clone.params.patrol as Array<[number, number]>).map(
          ([px, py]) => point(px, py),
        );
      }
    }
    clone.rotation = (((o.rotation + 90) % 360) as EditorObject['rotation']);
    return clone;
  });

  return {
    ...p,
    w: dw,
    h: dh,
    rle: rleEncode(dst),
    life: mapSparse(p.life, p.w, point, dw),
    charge: mapSparse(p.charge, p.w, point, dw),
    colorOverrides: mapSparse(p.colorOverrides, p.w, point, dw),
    objects,
    links: p.links.map((l) => ({ ...l })),
    lights: p.lights.map((l) => {
      const [x, y] = point(l.x, l.y);
      return { ...l, x, y };
    }),
    anchors: p.anchors?.map((a) => {
      const [x, y] = point(a.x, a.y);
      return { ...a, x, y, dir: ROT_DIR[a.dir] };
    }),
  };
}

/** Horizontal mirror: src(x, y) -> dst(w-1-x, y). */
export function mirrorPrefab(p: PrefabDef): PrefabDef {
  const src = decodePrefabCells(p);
  const dst = new Uint8Array(p.w * p.h);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      dst[p.w - 1 - x + y * p.w] = src[x + y * p.w];
    }
  }
  const point = (x: number, y: number): [number, number] => [p.w - 1 - x, y];

  const objects = p.objects.map((o) => {
    const clone = structuredClone(o);
    const slab = slabDims(o);
    if (slab) {
      clone.x = p.w - o.x - slab.w;
    } else {
      clone.x = p.w - 1 - o.x;
      if (Array.isArray(clone.params.patrol)) {
        clone.params.patrol = (clone.params.patrol as Array<[number, number]>).map(
          ([px, py]) => point(px, py),
        );
      }
    }
    clone.rotation = mirrorRotation(o.rotation);
    return clone;
  });

  return {
    ...p,
    rle: rleEncode(dst),
    life: mapSparse(p.life, p.w, point, p.w),
    charge: mapSparse(p.charge, p.w, point, p.w),
    colorOverrides: mapSparse(p.colorOverrides, p.w, point, p.w),
    objects,
    links: p.links.map((l) => ({ ...l })),
    lights: p.lights.map((l) => ({ ...l, x: p.w - 1 - l.x })),
    anchors: p.anchors?.map((a) => ({ ...a, x: p.w - 1 - a.x, dir: MIRROR_DIR[a.dir] })),
  };
}

/* ---------------- paste ---------------- */

export interface PrefabPasteResult {
  /** World-cell region the terrain block covered (pre-clamp intent). */
  region: Region;
  /** Prefab-local id -> fresh document id. */
  idMap: Map<string, string>;
  /** Cloned records at world coordinates with fresh ids; the caller turns
   *  these into add commands — the document is NOT touched here. */
  objects: EditorObject[];
  links: EditorLink[];
  lights: EditorLight[];
}

export type PrefabVariantId =
  | 'base'
  | 'rot90'
  | 'rot180'
  | 'rot270'
  | 'mirror'
  | 'mirrorRot90'
  | 'mirrorRot180'
  | 'mirrorRot270';

export const PREFAB_VARIANTS: ReadonlyArray<{ id: PrefabVariantId; label: string }> = [
  { id: 'base', label: 'Original' },
  { id: 'rot90', label: 'Rotate 90' },
  { id: 'rot180', label: 'Rotate 180' },
  { id: 'rot270', label: 'Rotate 270' },
  { id: 'mirror', label: 'Mirror' },
  { id: 'mirrorRot90', label: 'Mirror + 90' },
  { id: 'mirrorRot180', label: 'Mirror + 180' },
  { id: 'mirrorRot270', label: 'Mirror + 270' },
];

export function prefabVariant(prefab: PrefabDef, variant: PrefabVariantId): PrefabDef {
  const rotate = (p: PrefabDef, turns: number): PrefabDef => {
    let out = p;
    for (let n = 0; n < turns; n++) out = rotatePrefab(out);
    return out;
  };
  if (variant === 'base') return structuredClone(prefab);
  if (variant === 'rot90') return rotate(structuredClone(prefab), 1);
  if (variant === 'rot180') return rotate(structuredClone(prefab), 2);
  if (variant === 'rot270') return rotate(structuredClone(prefab), 3);
  if (variant === 'mirror') return mirrorPrefab(structuredClone(prefab));
  if (variant === 'mirrorRot90') return rotate(mirrorPrefab(structuredClone(prefab)), 1);
  if (variant === 'mirrorRot180') return rotate(mirrorPrefab(structuredClone(prefab)), 2);
  return rotate(mirrorPrefab(structuredClone(prefab)), 3);
}

export function oppositeAnchorDir(dir: PrefabAnchor['dir']): PrefabAnchor['dir'] {
  if (dir === 'n') return 's';
  if (dir === 's') return 'n';
  if (dir === 'e') return 'w';
  return 'e';
}

export function prefabAnchorsCompatible(a: PrefabAnchor, b: PrefabAnchor): boolean {
  return a.kind === b.kind && oppositeAnchorDir(a.dir) === b.dir;
}

export function prefabAnchorWorldPoint(
  prefab: Pick<PrefabDef, 'w' | 'h'>,
  centerX: number,
  centerY: number,
  anchor: Pick<PrefabAnchor, 'x' | 'y'>,
): { x: number; y: number } {
  return {
    x: centerX - Math.floor(prefab.w / 2) + anchor.x,
    y: centerY - Math.floor(prefab.h / 2) + anchor.y,
  };
}

export function alignPrefabAnchorToWorldPoint(
  prefab: Pick<PrefabDef, 'w' | 'h'>,
  anchor: Pick<PrefabAnchor, 'x' | 'y'>,
  target: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: target.x - anchor.x + Math.floor(prefab.w / 2),
    y: target.y - anchor.y + Math.floor(prefab.h / 2),
  };
}

/**
 * Paste centered on (cx, cy): terrain through the recorder (full block,
 * authored emptiness included), then authored life/charge/colorOverrides
 * overlaid directly — safe because writeCell already snapshotted those
 * indices, so the recorder's finish() patch captures them.
 */
export function pastePrefab(
  world: World,
  rec: PatchRecorder,
  p: PrefabDef,
  cx: number,
  cy: number,
): PrefabPasteResult {
  const cells = decodePrefabCells(p);
  const x0 = cx - Math.floor(p.w / 2);
  const y0 = cy - Math.floor(p.h / 2);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!world.inBounds(x0 + x, y0 + y)) continue;
      writeCell(world, rec, x0 + x, y0 + y, cells[x + y * p.w]);
    }
  }
  const overlay = (
    pairs: Array<[number, number]> | undefined,
    apply: (wi: number, v: number) => void,
  ): void => {
    for (const [li, v] of pairs ?? []) {
      const X = x0 + (li % p.w),
        Y = y0 + Math.floor(li / p.w);
      if (world.inBounds(X, Y)) apply(world.idx(X, Y), v);
    }
  };
  overlay(p.life, (i, v) => {
    world.life[i] = v;
  });
  overlay(p.charge, (i, v) => {
    // Route through setChargeAt so pasted charge enters the sparse active-charge
    // index and actually propagates/decays (a raw charge[i]=v never would).
    world.setChargeAt(i, v);
  });
  overlay(p.colorOverrides, (i, v) => {
    world.colors[i] = v;
    // Register the scar so the pasted tint survives the cell's first swap.
    world.colorOverrides.add(i);
  });

  const idMap = new Map<string, string>();
  const objects = p.objects.map((o) => {
    const clone = structuredClone(o);
    clone.id = freshId(o.kind);
    idMap.set(o.id, clone.id);
    clone.x = o.x + x0;
    clone.y = o.y + y0;
    localPatrol(clone.params, x0, y0);
    return clone;
  });
  const links = p.links.map((l) => ({
    ...l,
    id: freshId('link'),
    fromId: idMap.get(l.fromId) ?? l.fromId,
    toId: idMap.get(l.toId) ?? l.toId,
  }));
  const lights = p.lights.map((l) => ({
    ...l,
    id: freshId('light'),
    x: l.x + x0,
    y: l.y + y0,
  }));

  return {
    region: { x0, y0, x1: x0 + p.w - 1, y1: y0 + p.h - 1 },
    idMap,
    objects,
    links,
    lights,
  };
}

/* ---------------- library (localStorage, one key per prefab) ---------------- */

/** Legacy terrain-only stamps become prefabs tagged 'terrain' (lossless). */
function migrateStamps(): void {
  try {
    const raw = localStorage.getItem(LEGACY_STAMPS_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as Array<{
      id: string;
      name: string;
      w: number;
      h: number;
      rle: string;
    }>;
    if (Array.isArray(list)) {
      for (const s of list) {
        if (!s || !(s.w > 0) || !(s.h > 0) || typeof s.rle !== 'string') continue;
        if (localStorage.getItem(PREFAB_PREFIX + s.id)) continue;
        const prefab: PrefabDef = {
          v: 1,
          kind: 'prefab',
          id: s.id,
          name: s.name || 'stamp',
          tags: ['terrain'],
          w: s.w,
          h: s.h,
          rle: s.rle,
          objects: [],
          links: [],
          lights: [],
        };
        localStorage.setItem(PREFAB_PREFIX + s.id, JSON.stringify(prefab));
      }
    }
    localStorage.removeItem(LEGACY_STAMPS_KEY);
  } catch {
    // a corrupt legacy blob stays where it is; per-prefab keys still work
  }
}

export function loadPrefabs(): PrefabDef[] {
  migrateStamps();
  const out: PrefabDef[] = [];
  try {
    for (let n = 0; n < localStorage.length; n++) {
      const key = localStorage.key(n);
      if (!key || !key.startsWith(PREFAB_PREFIX)) continue;
      try {
        const got = sanitizePrefab(JSON.parse(localStorage.getItem(key)!));
        if (got) out.push(got.prefab);
      } catch {
        // one corrupt prefab must not take the library down
      }
    }
  } catch {
    return out;
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return out;
}

export function savePrefab(p: PrefabDef): boolean {
  try {
    localStorage.setItem(PREFAB_PREFIX + p.id, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export function deletePrefab(id: string): void {
  try {
    localStorage.removeItem(PREFAB_PREFIX + id);
  } catch {
    // nothing to do — absent key and quota errors end the same way
  }
}

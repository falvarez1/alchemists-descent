import { decodePrefabCells } from '@/builder/prefablib';
import type { PrefabDef } from '@/builder/prefablib';
import { decodeFramePx, spriteContentSig } from '@/builder/assets/sprites';
import type { SpriteAsset } from '@/builder/assets/sprites';
import type { AssetPreviewSummary, AssetRecord } from '@/builder/assets/AssetTypes';

export function stableContentSignature(value: unknown): string {
  return fnv1a(stableStringify(value)).toString(16).padStart(8, '0');
}

export function estimatedJsonBytes(value: unknown): number {
  return new TextEncoder().encode(stableStringify(value)).length;
}

export function assetPreviewSummary(record: {
  kind: AssetRecord['kind'];
  name: string;
  payload: AssetRecord['payload'];
  contentSignature: string;
  updatedAt?: string;
}): AssetPreviewSummary {
  if (record.kind === 'prefab' && isPrefab(record.payload)) {
    return {
      kind: 'cells',
      label: `${record.payload.w}x${record.payload.h}`,
      width: record.payload.w,
      height: record.payload.h,
      contentSignature: record.contentSignature,
      updatedAt: record.updatedAt,
    };
  }
  if (record.kind === 'sprite' && isSprite(record.payload)) {
    return {
      kind: 'sprite',
      label: `${record.payload.w}x${record.payload.h} / ${record.payload.frames.length}f`,
      width: record.payload.w,
      height: record.payload.h,
      frames: record.payload.frames.length,
      contentSignature: record.contentSignature,
      updatedAt: record.updatedAt,
    };
  }
  if (record.kind === 'document') {
    return {
      kind: 'document',
      label: 'Builder document',
      glyph: 'D',
      contentSignature: record.contentSignature,
      updatedAt: record.updatedAt,
    };
  }
  if (record.kind === 'importReport') {
    return {
      kind: 'report',
      label: 'Import report',
      glyph: '!',
      contentSignature: record.contentSignature,
      updatedAt: record.updatedAt,
    };
  }
  const glyph = record.kind === 'materialProfile'
    ? 'M'
    : record.kind === 'materialPalette'
      ? 'P'
      : record.kind === 'lightPreset'
        ? 'L'
        : record.kind === 'backdrop'
          ? 'B'
          : record.kind === 'procPreset'
            ? 'R'
            : record.kind === 'template'
              ? 'T'
              : '?';
  return {
    kind: 'glyph',
    label: record.name,
    glyph,
    contentSignature: record.contentSignature,
    updatedAt: record.updatedAt,
  };
}

export function renderAssetPreviewMarkup(record: AssetRecord): string {
  const label = esc(record.preview.label);
  if (record.preview.kind === 'swatch' && record.preview.swatch) {
    return `<span class="ba-swatch" style="background:${escAttr(record.preview.swatch)}" title="${label}"></span>`;
  }
  if (record.preview.kind === 'cells' && isPrefab(record.payload)) {
    return `<canvas class="ba-thumb" data-preview-kind="prefab" data-asset-id="${escAttr(record.assetId)}" width="44" height="32" aria-label="${label}"></canvas>`;
  }
  if (record.preview.kind === 'sprite' && isSprite(record.payload)) {
    return `<canvas class="ba-thumb" data-preview-kind="sprite" data-asset-id="${escAttr(record.assetId)}" width="44" height="32" aria-label="${label}"></canvas>`;
  }
  return `<span class="ba-glyph" title="${label}">${esc(record.preview.glyph ?? record.kind.slice(0, 1).toUpperCase())}</span>`;
}

export function paintAssetPreview(canvas: HTMLCanvasElement, record: AssetRecord): boolean {
  const g = canvas.getContext('2d');
  if (!g) return false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = false;
  if (record.kind === 'prefab' && isPrefab(record.payload)) {
    paintPrefabPreview(g, canvas, record.payload);
    return true;
  }
  if (record.kind === 'sprite' && isSprite(record.payload)) {
    paintSpritePreview(g, canvas, record.payload);
    return true;
  }
  return false;
}

export function prefabContentSignature(prefab: PrefabDef): string {
  return stableContentSignature({
    v: prefab.v,
    kind: prefab.kind,
    id: prefab.id,
    name: prefab.name,
    tags: prefab.tags,
    w: prefab.w,
    h: prefab.h,
    rle: prefab.rle,
    life: prefab.life,
    charge: prefab.charge,
    colorOverrides: prefab.colorOverrides,
    objects: prefab.objects,
    links: prefab.links,
    lights: prefab.lights,
    anchors: prefab.anchors,
  });
}

export function spriteAssetContentSignature(sprite: SpriteAsset): string {
  return spriteContentSig(sprite).toString(16).padStart(8, '0');
}

function paintPrefabPreview(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, prefab: PrefabDef): void {
  const cells = decodePrefabCells(prefab);
  const scale = Math.max(1, Math.floor(Math.min(canvas.width / prefab.w, canvas.height / prefab.h)));
  const w = Math.min(canvas.width, prefab.w * scale);
  const h = Math.min(canvas.height, prefab.h * scale);
  const ox = Math.floor((canvas.width - w) / 2);
  const oy = Math.floor((canvas.height - h) / 2);
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < prefab.h; y++) {
    for (let x = 0; x < prefab.w; x++) {
      const cell = cells[x + y * prefab.w];
      if (cell === 0) continue;
      g.fillStyle = cellColor(cell);
      g.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
  if (prefab.objects.length > 0) {
    g.fillStyle = '#7dd3fc';
    for (const object of prefab.objects) {
      g.fillRect(ox + Math.round(object.x) * scale, oy + Math.round(object.y) * scale, Math.max(1, scale), Math.max(1, scale));
    }
  }
}

function paintSpritePreview(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, sprite: SpriteAsset): void {
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  if (sprite.frames.length === 0) return;
  const px = decodeFramePx(sprite.frames[0].px, sprite.w, sprite.h);
  const image = new ImageData(new Uint8ClampedArray(px), sprite.w, sprite.h);
  const tmp = document.createElement('canvas');
  tmp.width = sprite.w;
  tmp.height = sprite.h;
  tmp.getContext('2d')?.putImageData(image, 0, 0);
  const scale = Math.max(1, Math.floor(Math.min(canvas.width / sprite.w, canvas.height / sprite.h)));
  const w = Math.min(canvas.width, sprite.w * scale);
  const h = Math.min(canvas.height, sprite.h * scale);
  g.drawImage(tmp, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
}

function cellColor(cell: number): string {
  if (cell === 1) return '#c7a767';
  if (cell === 2) return '#2f7ed8';
  if (cell === 3) return '#65606a';
  if (cell === 4) return '#d2b48c';
  if (cell === 5) return '#ff7a1a';
  if (cell === 12) return '#8a8a92';
  if (cell === 13) return '#9aa7b2';
  if (cell === 34) return '#3f8f3f';
  return '#9fb6cc';
}

function isPrefab(value: unknown): value is PrefabDef {
  return !!value && typeof value === 'object' && (value as PrefabDef).kind === 'prefab' && (value as PrefabDef).v === 1;
}

function isSprite(value: unknown): value is SpriteAsset {
  return !!value && typeof value === 'object' && (value as SpriteAsset).kind === 'sprite';
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .filter((key) => object[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(value: string): string {
  return esc(value);
}

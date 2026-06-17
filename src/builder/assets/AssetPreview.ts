import { decodePrefabCells } from '@/builder/prefablib';
import type { PrefabDef } from '@/builder/prefablib';
import { decodeFramePx, spriteContentSig } from '@/builder/assets/sprites';
import type { SpriteAsset } from '@/builder/assets/sprites';
import type { AssetPreviewSummary, AssetRecord } from '@/builder/assets/AssetTypes';
import { paletteColor } from '@/sim/cellPalette';
import { unpackB, unpackG, unpackR } from '@/sim/colors';
import { fnv1aString } from '@/core/rng';
import { escapeHtml as esc, escapeAttr as escAttr } from '@/core/strings';

export function stableContentSignature(value: unknown): string {
  return fnv1aString(stableStringify(value)).toString(16).padStart(8, '0');
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
  const glyph = glyphForKind(record.kind);
  return {
    kind: 'glyph',
    label: record.name,
    glyph,
    contentSignature: record.contentSignature,
    updatedAt: record.updatedAt,
  };
}

function glyphForKind(kind: AssetRecord['kind']): string {
  if (kind === 'materialProfile' || kind === 'material') return 'M';
  if (kind === 'materialPalette') return 'P';
  if (kind === 'lightPreset' || kind === 'wandLoadout') return 'L';
  if (kind === 'backdrop') return 'B';
  if (kind === 'procPreset' || kind === 'recipe') return 'R';
  if (kind === 'template' || kind === 'spellLabScenario') return 'T';
  if (kind === 'card') return 'C';
  if (kind === 'modifier') return '+';
  if (kind === 'wandFrame') return 'W';
  if (kind === 'potion') return 'P';
  if (kind === 'elixir') return 'E';
  if (kind === 'enemy') return 'N';
  if (kind === 'encounterScenario') return 'S';
  if (kind === 'cookReport') return '!';
  return '?';
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

export function paintPrefabPreviewCanvas(canvas: HTMLCanvasElement, prefab: PrefabDef): boolean {
  const g = canvas.getContext('2d');
  if (!g) return false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = false;
  paintPrefabPreview(g, canvas, prefab);
  return true;
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
  const packed = paletteColor(cell);
  return `rgb(${unpackR(packed)},${unpackG(packed)},${unpackB(packed)})`;
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


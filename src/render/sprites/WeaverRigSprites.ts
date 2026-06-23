import type { PixelSurface } from '@/render/pixels';

import weaverRigManifestRaw from '../../../assets/enemies/weaver-crystal-silk-assassin-rig.json?raw';
import weaverRigUrl from '../../../assets/enemies/weaver-crystal-silk-assassin-rig-parts-transparent.png?url';

const WEAVER_RIG_PART_NAMES = [
  'head',
  'mandibleA',
  'mandibleB',
  'thorax',
  'abdomen',
  'spinnerets',
  'crystalSpine',
  'jointCap',
  'legUpperA',
  'legUpperB',
  'legUpperC',
  'legLowerA',
  'legLowerB',
  'legLowerC',
  'footA',
  'footB',
  'footC',
  'silk',
] as const;

type WeaverRigPartName = (typeof WEAVER_RIG_PART_NAMES)[number];

interface PartSpec {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  w: number;
  h: number;
  pivotX: number;
  pivotY: number;
}

interface RasterPart extends PartSpec {
  pixels: Float32Array;
  flippedPixels: Float32Array;
  segmentPixels: Float32Array;
  flippedSegmentPixels: Float32Array;
}

interface RigLight {
  r: number;
  g: number;
  b: number;
}

interface RigDrawOptions {
  light: RigLight;
  flash: boolean;
  boost: number;
  flipX?: boolean;
  alpha?: number;
}

interface WeaverRigManifest {
  parts: Record<WeaverRigPartName, PartSpec>;
  legParts: {
    upper: readonly WeaverRigPartName[];
    lower: readonly WeaverRigPartName[];
    foot: readonly WeaverRigPartName[];
  };
}

const PIXEL_STRIDE = 7;
const PIXEL_X = 0;
const PIXEL_Y = 1;
const PIXEL_R = 2;
const PIXEL_G = 3;
const PIXEL_B = 4;
const PIXEL_ALPHA = 5;
const PIXEL_EMISSIVE = 6;

const SEGMENT_T = 0;
const SEGMENT_SIDE = 1;
const SEGMENT_R = 2;
const SEGMENT_G = 3;
const SEGMENT_B = 4;
const SEGMENT_ALPHA = 5;
const SEGMENT_EMISSIVE = 6;

const EMISSIVE_ON = 1;

const MANIFEST = parseRigManifest(weaverRigManifestRaw);
const PART_SPECS = MANIFEST.parts;
const UPPER_PARTS = MANIFEST.legParts.upper;
const LOWER_PARTS = MANIFEST.legParts.lower;
const FOOT_PARTS = MANIFEST.legParts.foot;

let loadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
const rasterParts = new Map<WeaverRigPartName, RasterPart>();

export function weaverRigReady(): boolean {
  ensureWeaverRigLoaded();
  return loadState === 'ready';
}

export function weaverUpperLegPart(index: number): WeaverRigPartName {
  return UPPER_PARTS[index % UPPER_PARTS.length] ?? 'legUpperA';
}

export function weaverLowerLegPart(index: number): WeaverRigPartName {
  return LOWER_PARTS[index % LOWER_PARTS.length] ?? 'legLowerA';
}

export function weaverFootPart(index: number): WeaverRigPartName {
  return FOOT_PARTS[index % FOOT_PARTS.length] ?? 'footA';
}

export function drawWeaverRigPart(
  surface: PixelSurface,
  name: WeaverRigPartName,
  cx: number,
  cy: number,
  angle: number,
  options: RigDrawOptions,
): boolean {
  const part = getPart(name);
  if (!part) return false;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const alphaMul = options.alpha ?? 1;
  const pixels = options.flipX ? part.flippedPixels : part.pixels;
  const light = options.light;
  const glow = 0.72 + options.boost * 0.16;
  const flash = options.flash;
  for (let i = 0; i < pixels.length; i += PIXEL_STRIDE) {
    const alpha = pixels[i + PIXEL_ALPHA] * alphaMul;
    if (alpha <= 0.08) continue;
    const px = pixels[i + PIXEL_X];
    const py = pixels[i + PIXEL_Y];
    const wx = cx + px * cos - py * sin;
    const wy = cy + px * sin + py * cos;
    if (flash) {
      surface.setPx(wx, wy, 2.2, 2.2, 2.2);
      continue;
    }
    const r = pixels[i + PIXEL_R] * alpha;
    const g = pixels[i + PIXEL_G] * alpha;
    const b = pixels[i + PIXEL_B] * alpha;
    if (pixels[i + PIXEL_EMISSIVE] === EMISSIVE_ON) {
      surface.setPx(wx, wy, Math.min(2.2, r * glow), Math.min(2.2, g * glow), Math.min(2.2, b * glow));
      if (alpha > 0.45) surface.addPx(wx, wy, r * 0.18, g * 0.22, b * 0.26);
    } else {
      surface.setPx(wx, wy, r * light.r, g * light.g, b * light.b);
    }
  }
  return true;
}

export function drawWeaverRigSegment(
  surface: PixelSurface,
  name: WeaverRigPartName,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  options: RigDrawOptions,
): boolean {
  const part = getPart(name);
  if (!part) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return false;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const alphaMul = options.alpha ?? 1;
  const pixels = options.flipX ? part.flippedSegmentPixels : part.segmentPixels;
  const light = options.light;
  const glow = 0.72 + options.boost * 0.16;
  const flash = options.flash;
  for (let i = 0; i < pixels.length; i += PIXEL_STRIDE) {
    const alpha = pixels[i + SEGMENT_ALPHA] * alphaMul;
    if (alpha <= 0.08) continue;
    const along = pixels[i + SEGMENT_T] * len;
    const side = pixels[i + SEGMENT_SIDE];
    const wx = x0 + ux * along + nx * side;
    const wy = y0 + uy * along + ny * side;
    if (flash) {
      surface.setPx(wx, wy, 2.2, 2.2, 2.2);
      continue;
    }
    const r = pixels[i + SEGMENT_R] * alpha;
    const g = pixels[i + SEGMENT_G] * alpha;
    const b = pixels[i + SEGMENT_B] * alpha;
    if (pixels[i + SEGMENT_EMISSIVE] === EMISSIVE_ON) {
      surface.setPx(wx, wy, Math.min(2.2, r * glow), Math.min(2.2, g * glow), Math.min(2.2, b * glow));
      if (alpha > 0.45) surface.addPx(wx, wy, r * 0.18, g * 0.22, b * 0.26);
    } else {
      surface.setPx(wx, wy, r * light.r, g * light.g, b * light.b);
    }
  }
  return true;
}

function getPart(name: WeaverRigPartName): RasterPart | null {
  ensureWeaverRigLoaded();
  return rasterParts.get(name) ?? null;
}

function ensureWeaverRigLoaded(): void {
  if (loadState !== 'idle') return;
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    loadState = 'failed';
    return;
  }
  loadState = 'loading';
  const img = new Image();
  img.onload = () => {
    try {
      const source = document.createElement('canvas');
      source.width = img.naturalWidth || img.width;
      source.height = img.naturalHeight || img.height;
      const sourceCtx = source.getContext('2d');
      if (!sourceCtx) throw new Error('2d context unavailable');
      sourceCtx.drawImage(img, 0, 0);
      for (const [name, spec] of Object.entries(PART_SPECS) as Array<[WeaverRigPartName, PartSpec]>) {
        rasterParts.set(name, rasterizePart(source, spec));
      }
      loadState = 'ready';
    } catch {
      rasterParts.clear();
      loadState = 'failed';
    }
  };
  img.onerror = () => {
    rasterParts.clear();
    loadState = 'failed';
  };
  img.src = weaverRigUrl;
}

function rasterizePart(source: HTMLCanvasElement, spec: PartSpec): RasterPart {
  const canvas = document.createElement('canvas');
  canvas.width = spec.w;
  canvas.height = spec.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.clearRect(0, 0, spec.w, spec.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, spec.sx, spec.sy, spec.sw, spec.sh, 0, 0, spec.w, spec.h);
  const imageData = ctx.getImageData(0, 0, spec.w, spec.h).data;
  const pixels: number[] = [];
  const flippedPixels: number[] = [];
  const segmentPixels: number[] = [];
  const flippedSegmentPixels: number[] = [];
  for (let py = 0; py < spec.h; py++) {
    const t = spec.h <= 1 ? 0 : py / (spec.h - 1);
    for (let px = 0; px < spec.w; px++) {
      const src = (py * spec.w + px) * 4;
      const alpha = (imageData[src + 3] ?? 0) / 255;
      if (alpha <= 0.08) continue;
      const r = (imageData[src] ?? 0) / 255;
      const g = (imageData[src + 1] ?? 0) / 255;
      const b = (imageData[src + 2] ?? 0) / 255;
      const emissive = isRigPixelEmissive(imageData[src] ?? 0, imageData[src + 1] ?? 0, imageData[src + 2] ?? 0);
      const x = px - spec.pivotX;
      const y = py - spec.pivotY;
      const flippedX = spec.w - 1 - px - spec.pivotX;
      const side = px - spec.pivotX;
      const flippedSide = spec.w - 1 - px - spec.pivotX;
      const emissiveValue = emissive ? EMISSIVE_ON : 0;
      pixels.push(x, y, r, g, b, alpha, emissiveValue);
      flippedPixels.push(flippedX, y, r, g, b, alpha, emissiveValue);
      segmentPixels.push(t, side, r, g, b, alpha, emissiveValue);
      flippedSegmentPixels.push(t, flippedSide, r, g, b, alpha, emissiveValue);
    }
  }
  return {
    ...spec,
    pixels: new Float32Array(pixels),
    flippedPixels: new Float32Array(flippedPixels),
    segmentPixels: new Float32Array(segmentPixels),
    flippedSegmentPixels: new Float32Array(flippedSegmentPixels),
  };
}

function isRigPixelEmissive(r: number, g: number, b: number): boolean {
  return (g > 125 && b > 110 && r < 135) || (b > 165 && g > 75 && r < 155);
}

function parseRigManifest(raw: string): WeaverRigManifest {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('Invalid Weaver rig manifest: root must be an object.');
  const partsRaw = parsed.parts;
  if (!isRecord(partsRaw)) throw new Error('Invalid Weaver rig manifest: parts must be an object.');
  const legPartsRaw = parsed.legParts;
  if (!isRecord(legPartsRaw)) throw new Error('Invalid Weaver rig manifest: legParts must be an object.');

  const parts = {} as Record<WeaverRigPartName, PartSpec>;
  for (const name of WEAVER_RIG_PART_NAMES) {
    parts[name] = readPartSpec(partsRaw[name], `parts.${name}`);
  }

  return {
    parts,
    legParts: {
      upper: readPartNameList(legPartsRaw.upper, 'legParts.upper'),
      lower: readPartNameList(legPartsRaw.lower, 'legParts.lower'),
      foot: readPartNameList(legPartsRaw.foot, 'legParts.foot'),
    },
  };
}

function readPartSpec(value: unknown, path: string): PartSpec {
  if (!isRecord(value)) throw new Error(`Invalid Weaver rig manifest: ${path} must be an object.`);
  return {
    sx: readNumber(value.sx, `${path}.sx`),
    sy: readNumber(value.sy, `${path}.sy`),
    sw: readPositiveNumber(value.sw, `${path}.sw`),
    sh: readPositiveNumber(value.sh, `${path}.sh`),
    w: readPositiveNumber(value.w, `${path}.w`),
    h: readPositiveNumber(value.h, `${path}.h`),
    pivotX: readNumber(value.pivotX, `${path}.pivotX`),
    pivotY: readNumber(value.pivotY, `${path}.pivotY`),
  };
}

function readPartNameList(value: unknown, path: string): readonly WeaverRigPartName[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid Weaver rig manifest: ${path} must be a non-empty array.`);
  }
  return value.map((item, index) => {
    if (!isWeaverRigPartName(item)) {
      throw new Error(`Invalid Weaver rig manifest: ${path}[${index}] is not a known rig part.`);
    }
    return item;
  });
}

function readPositiveNumber(value: unknown, path: string): number {
  const n = readNumber(value, path);
  if (n <= 0) throw new Error(`Invalid Weaver rig manifest: ${path} must be positive.`);
  return n;
}

function readNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid Weaver rig manifest: ${path} must be a finite number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWeaverRigPartName(value: unknown): value is WeaverRigPartName {
  return typeof value === 'string' && (WEAVER_RIG_PART_NAMES as readonly string[]).includes(value);
}

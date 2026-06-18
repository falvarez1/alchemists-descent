import type {
  PixelSceneDef,
  VirtualSceneKind,
  VirtualSceneLight,
  VirtualSceneLink,
  VirtualSceneObject,
} from '@/world/virtual/types';

/**
 * Serializable pixel-scene format (T1 of docs/CHUNKED-WORLD-ENHANCEMENTS.md). Scenes
 * are otherwise hand-coded TypeScript; this lets them live as data — exported,
 * hand-edited, round-tripped, and authored in the scene editor. The grid planes are
 * base64-encoded with a self-contained codec (portable across the worker, the
 * Builder, and node tests — no Buffer/btoa dependency).
 *
 * Planes are stored little-endian; serialize + parse round-trip exactly (this codec
 * is the only consumer).
 */
export interface PixelSceneJson {
  v: 1;
  id: string;
  name: string;
  kind?: VirtualSceneKind;
  tags?: string[];
  w: number;
  h: number;
  material: string; // base64 Uint8Array (w*h)
  mask?: string; // base64 Uint8Array
  colorOverrides?: string; // base64 Uint32Array bytes
  life?: string; // base64 Int16Array bytes
  charge?: string; // base64 Uint8Array
  objects?: VirtualSceneObject[];
  links?: VirtualSceneLink[];
  lights?: VirtualSceneLight[];
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

function encodeBytes(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

function decodeBytes(str: string): Uint8Array {
  let len = str.length;
  while (len > 0 && str[len - 1] === '=') len--;
  const outLen = (len * 3) >> 2;
  const out = new Uint8Array(outLen);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const v = B64_LOOKUP[str.charCodeAt(i) & 127];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return o === outLen ? out : out.subarray(0, o);
}

const viewBytes = (a: Uint32Array | Int16Array): Uint8Array =>
  new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

export function serializePixelScene(def: PixelSceneDef): PixelSceneJson {
  const json: PixelSceneJson = {
    v: 1,
    id: def.id,
    name: def.name,
    w: def.w,
    h: def.h,
    material: encodeBytes(def.material),
    objects: def.objects ?? [],
    links: def.links ?? [],
    lights: def.lights ?? [],
  };
  if (def.kind) json.kind = def.kind;
  if (def.tags && def.tags.length) json.tags = [...def.tags];
  if (def.mask) json.mask = encodeBytes(def.mask);
  if (def.colorOverrides) json.colorOverrides = encodeBytes(viewBytes(def.colorOverrides));
  if (def.life) json.life = encodeBytes(viewBytes(def.life));
  if (def.charge) json.charge = encodeBytes(def.charge);
  return json;
}

/** Parse a (possibly hand-edited) scene JSON into a PixelSceneDef, throwing a clear
 *  error on structural problems. Plane lengths are clamped/padded to w*h so a
 *  truncated paste can't desync the grid. */
export function parsePixelScene(json: PixelSceneJson): PixelSceneDef {
  if (!json || typeof json !== 'object') throw new Error('pixel scene: not an object');
  const w = json.w | 0;
  const h = json.h | 0;
  if (w <= 0 || h <= 0 || w * h > 1 << 22) throw new Error(`pixel scene: bad dimensions ${w}x${h}`);
  if (typeof json.material !== 'string') throw new Error('pixel scene: missing material plane');
  const n = w * h;
  const def: PixelSceneDef = {
    v: 1,
    id: String(json.id ?? 'scene'),
    name: String(json.name ?? json.id ?? 'Scene'),
    w,
    h,
    material: fitU8(decodeBytes(json.material), n),
    objects: Array.isArray(json.objects) ? json.objects : [],
    links: Array.isArray(json.links) ? json.links : [],
    lights: Array.isArray(json.lights) ? json.lights : [],
  };
  if (json.kind) def.kind = json.kind;
  if (Array.isArray(json.tags)) def.tags = json.tags.map(String);
  if (typeof json.mask === 'string') def.mask = fitU8(decodeBytes(json.mask), n);
  if (typeof json.colorOverrides === 'string') def.colorOverrides = fitU32(decodeBytes(json.colorOverrides), n);
  if (typeof json.life === 'string') def.life = fitI16(decodeBytes(json.life), n);
  if (typeof json.charge === 'string') def.charge = fitU8(decodeBytes(json.charge), n);
  return def;
}

function fitU8(src: Uint8Array, n: number): Uint8Array {
  if (src.length === n) return src;
  const out = new Uint8Array(n);
  out.set(src.subarray(0, n));
  return out;
}
function fitU32(srcBytes: Uint8Array, n: number): Uint32Array {
  const out = new Uint32Array(n);
  const src = new Uint32Array(srcBytes.buffer, srcBytes.byteOffset, srcBytes.byteLength >> 2);
  out.set(src.subarray(0, n));
  return out;
}
function fitI16(srcBytes: Uint8Array, n: number): Int16Array {
  const out = new Int16Array(n);
  const src = new Int16Array(srcBytes.buffer, srcBytes.byteOffset, srcBytes.byteLength >> 1);
  out.set(src.subarray(0, n));
  return out;
}

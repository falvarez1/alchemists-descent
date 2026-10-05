/**
 * Byte-array codecs for save data: run-length encoding for cell-type planes
 * (cave worlds compress ~10-20x) and plain base64 for small masks.
 * Runs are 16-bit so a fully-empty world still encodes safely.
 */

export function rleEncode(types: Uint8Array): string {
  const out: number[] = [];
  let run = 1;
  for (let i = 1; i <= types.length; i++) {
    if (i < types.length && types[i] === types[i - 1] && run < 0xffff) {
      run++;
      continue;
    }
    out.push(run & 0xff, (run >> 8) & 0xff, types[i - 1]);
    run = 1;
  }
  return bytesToBase64(new Uint8Array(out));
}

/**
 * Decode an RLE string into `into`, returning the number of cells the stream
 * CLAIMS to cover (which may differ from `into.length` for corrupt/foreign
 * data). Writes are clamped to the buffer, so an over-long run can never
 * scribble out of bounds. Callers handling untrusted save/share input should
 * (a) wrap this in try/catch — `atob` throws on non-base64 — and (b) verify the
 * returned length equals the expected cell count before trusting the result.
 */
export function rleDecode(rle: string, into: Uint8Array): number {
  const bin = atob(rle);
  const len = into.length;
  let pos = 0;
  for (let i = 0; i + 2 < bin.length; i += 3) {
    const run = bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8);
    const t = bin.charCodeAt(i + 2);
    if (pos < len) into.fill(t, pos, Math.min(pos + run, len));
    pos += run;
  }
  return pos;
}

/** Decode only when the stream is valid base64 and covers exactly `into`. */
export function rleDecodeExact(rle: string, into: Uint8Array): boolean {
  try {
    return rleDecode(rle, into) === into.length;
  } catch {
    return false;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string, into: Uint8Array): void {
  const bin = atob(b64);
  const n = Math.min(bin.length, into.length);
  for (let i = 0; i < n; i++) into[i] = bin.charCodeAt(i);
}

/** Sparse non-zero [index, value] pairs from a numeric typed array. */
export function sparsePairs(arr: Int16Array | Uint8Array | Uint16Array, cap: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < arr.length && out.length < cap; i++) {
    if (arr[i] !== 0) out.push([i, arr[i]]);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Packed sparse runs: a plane's differences from a baseline, as bytes.     */
/* ------------------------------------------------------------------------ */

/** A growable byte buffer for the packers below. */
class ByteSink {
  bytes = new Uint8Array(1024);
  length = 0;

  private room(n: number): void {
    if (this.length + n <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
  }

  varint(v: number): void {
    this.room(5);
    while (v >= 0x80) {
      this.bytes[this.length++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.bytes[this.length++] = v;
  }

  rgb(c: number): void {
    this.room(3);
    this.bytes[this.length++] = (c >>> 16) & 0xff;
    this.bytes[this.length++] = (c >>> 8) & 0xff;
    this.bytes[this.length++] = c & 0xff;
  }

  base64(): string {
    return bytesToBase64(this.bytes.subarray(0, this.length));
  }
}

/** Reads what ByteSink wrote; every read is bounds-checked (untrusted input). */
class ByteSource {
  pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  varint(): number | null {
    let v = 0;
    let scale = 1;
    for (let k = 0; k < 5; k++) {
      if (this.pos >= this.bytes.length) return null;
      const b = this.bytes[this.pos++];
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 128;
    }
    return null;
  }

  rgb(): number | null {
    if (this.pos + 3 > this.bytes.length) return null;
    const c = (this.bytes[this.pos] << 16) | (this.bytes[this.pos + 1] << 8) | this.bytes[this.pos + 2];
    this.pos += 3;
    return c;
  }
}

function decodeBase64Bytes(encoded: string): Uint8Array | null {
  try {
    const bin = atob(encoded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Identical colours in a row worth a run of their own (a run costs ~2 bytes + 3 for its colour). */
const FLAT_RUN_MIN = 3;

/**
 * Every cell whose colour differs from `base`, packed: runs of
 * `varint(gap) varint((len - 1) << 1 | literal)` then one RGB (a flat run of
 * `len` cells in one colour) or `len` RGBs (a literal run). `gap` counts the
 * cells since the previous run ended. An authored slab in one colour costs a
 * few bytes a row; a noisy scatter about 3 bytes a cell. '' when nothing
 * differs.
 */
export function packColorDiffs(colors: Uint32Array, base: Uint32Array): string {
  const n = Math.min(colors.length, base.length);
  const out = new ByteSink();
  let end = 0; // where the previous run ended
  let i = 0;
  while (i < n) {
    if ((colors[i] & 0xffffff) === (base[i] & 0xffffff)) {
      i++;
      continue;
    }
    // A segment of consecutive differing cells, emitted as flat and literal runs.
    let j = i;
    while (j < n && (colors[j] & 0xffffff) !== (base[j] & 0xffffff)) j++;
    let litStart = i;
    let k = i;
    while (k < j) {
      const c = colors[k] & 0xffffff;
      let m = k + 1;
      while (m < j && (colors[m] & 0xffffff) === c) m++;
      if (m - k >= FLAT_RUN_MIN) {
        if (litStart < k) {
          out.varint(litStart - end);
          out.varint(((k - litStart - 1) * 2) + 1);
          for (let q = litStart; q < k; q++) out.rgb(colors[q]);
          end = k;
        }
        out.varint(k - end);
        out.varint((m - k - 1) * 2);
        out.rgb(c);
        end = m;
        litStart = m;
      }
      k = m;
    }
    if (litStart < j) {
      out.varint(litStart - end);
      out.varint(((j - litStart - 1) * 2) + 1);
      for (let q = litStart; q < j; q++) out.rgb(colors[q]);
      end = j;
    }
    i = j;
  }
  return out.length === 0 ? '' : out.base64();
}

/**
 * Write packed colour differences into `colors`. False on malformed input
 * (bad base64, a run past the plane, a truncated payload): everything before
 * the fault is written, nothing after it, and nothing out of bounds.
 * `onCell`, when given, sees each written index.
 */
export function unpackColorDiffs(encoded: string, colors: Uint32Array, onCell?: (i: number) => void): boolean {
  const bytes = decodeBase64Bytes(encoded);
  if (!bytes) return false;
  const src = new ByteSource(bytes);
  const n = colors.length;
  let end = 0;
  while (!src.done) {
    const gap = src.varint();
    const header = src.varint();
    if (gap === null || header === null) return false;
    const start = end + gap;
    const len = Math.floor(header / 2) + 1;
    if (start + len > n) return false;
    if (header & 1) {
      for (let q = start; q < start + len; q++) {
        const c = src.rgb();
        if (c === null) return false;
        colors[q] = c;
        onCell?.(q);
      }
    } else {
      const c = src.rgb();
      if (c === null) return false;
      for (let q = start; q < start + len; q++) {
        colors[q] = c;
        onCell?.(q);
      }
    }
    end = start + len;
  }
  return true;
}

/** The set cells of a 0/1 mask, packed as runs: `varint(gap) varint(len - 1)`. '' when none. */
export function packIndexRuns(mask: Uint8Array): string {
  const out = new ByteSink();
  let end = 0;
  let i = 0;
  const n = mask.length;
  while (i < n) {
    if (!mask[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && mask[j]) j++;
    out.varint(i - end);
    out.varint(j - i - 1);
    end = j;
    i = j;
  }
  return out.length === 0 ? '' : out.base64();
}

/** Call `onIndex` for every index packIndexRuns packed, below `limit`. False on malformed input. */
export function unpackIndexRuns(encoded: string, limit: number, onIndex: (i: number) => void): boolean {
  const bytes = decodeBase64Bytes(encoded);
  if (!bytes) return false;
  const src = new ByteSource(bytes);
  let end = 0;
  while (!src.done) {
    const gap = src.varint();
    const lenMinus = src.varint();
    if (gap === null || lenMinus === null) return false;
    const start = end + gap;
    const stop = start + lenMinus + 1;
    if (stop > limit) return false;
    for (let q = start; q < stop; q++) onIndex(q);
    end = stop;
  }
  return true;
}

const zigzag = (v: number): number => (v >= 0 ? v * 2 : -v * 2 - 1);
const unzigzag = (u: number): number => (u % 2 === 0 ? u / 2 : -(u + 1) / 2);

/**
 * The non-zero cells of an integer plane (life, charge), packed like
 * packColorDiffs: runs of `varint(gap) varint((len - 1) << 1 | literal)`, then
 * one zigzag varint (a flat run) or `len` of them. `keep(i)` false drops a cell
 * (transient life). A settled lawn's -1s cost a few bytes a ledge; JSON pairs
 * cost ~12 a cell. '' when nothing is kept.
 */
export function packValueRuns(values: ArrayLike<number>, keep: (i: number) => boolean = () => true): string {
  const n = values.length;
  const at = (i: number): number => (values[i] !== 0 && keep(i) ? values[i] : 0);
  const out = new ByteSink();
  let end = 0;
  let i = 0;
  while (i < n) {
    if (at(i) === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && at(j) !== 0) j++;
    let litStart = i;
    let k = i;
    while (k < j) {
      const v = at(k);
      let m = k + 1;
      while (m < j && at(m) === v) m++;
      if (m - k >= FLAT_RUN_MIN) {
        if (litStart < k) {
          out.varint(litStart - end);
          out.varint((k - litStart - 1) * 2 + 1);
          for (let q = litStart; q < k; q++) out.varint(zigzag(at(q)));
          end = k;
        }
        out.varint(k - end);
        out.varint((m - k - 1) * 2);
        out.varint(zigzag(v));
        end = m;
        litStart = m;
      }
      k = m;
    }
    if (litStart < j) {
      out.varint(litStart - end);
      out.varint((j - litStart - 1) * 2 + 1);
      for (let q = litStart; q < j; q++) out.varint(zigzag(at(q)));
      end = j;
    }
    i = j;
  }
  return out.length === 0 ? '' : out.base64();
}

/** Call `onValue` for every cell packValueRuns packed, below `limit`. False on malformed input. */
export function unpackValueRuns(encoded: string, limit: number, onValue: (i: number, v: number) => void): boolean {
  const bytes = decodeBase64Bytes(encoded);
  if (!bytes) return false;
  const src = new ByteSource(bytes);
  let end = 0;
  while (!src.done) {
    const gap = src.varint();
    const header = src.varint();
    if (gap === null || header === null) return false;
    const start = end + gap;
    const len = Math.floor(header / 2) + 1;
    if (start + len > limit) return false;
    if (header & 1) {
      for (let q = start; q < start + len; q++) {
        const u = src.varint();
        if (u === null) return false;
        onValue(q, unzigzag(u));
      }
    } else {
      const u = src.varint();
      if (u === null) return false;
      const v = unzigzag(u);
      for (let q = start; q < start + len; q++) onValue(q, v);
    }
    end = start + len;
  }
  return true;
}

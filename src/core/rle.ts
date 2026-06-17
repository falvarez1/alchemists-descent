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
export function sparsePairs(arr: Int16Array | Uint8Array, cap: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < arr.length && out.length < cap; i++) {
    if (arr[i] !== 0) out.push([i, arr[i]]);
  }
  return out;
}

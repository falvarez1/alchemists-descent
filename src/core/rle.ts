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

export function rleDecode(rle: string, into: Uint8Array): void {
  const bin = atob(rle);
  let pos = 0;
  for (let i = 0; i + 2 < bin.length; i += 3) {
    const run = bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8);
    const t = bin.charCodeAt(i + 2);
    into.fill(t, pos, pos + run);
    pos += run;
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
export function sparsePairs(arr: Int16Array | Uint8Array, cap: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < arr.length && out.length < cap; i++) {
    if (arr[i] !== 0) out.push([i, arr[i]]);
  }
  return out;
}

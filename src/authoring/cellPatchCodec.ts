import { CELL_COUNT } from '@/sim/CellType';
import type { CellPatch } from '@/authoring/cellPatch';

/**
 * Packed binary encoding for {@link CellPatch} — the stream plane's frame
 * format (docs/MULTIPLAYER-ARCHITECTURE.md, stage 2).
 *
 * WHY. A patch as JSON costs ~26 bytes per cell, almost all of it decimal
 * digits and commas. Packed, a cell is 13 bytes, and that number is not a
 * guess: it is the width of the five `World` planes the patch mirrors. At the
 * measured 5–10k changed cells/second, that is the difference between ~250 KB/s
 * and ~130 KB/s on the wire, before any transport compression.
 *
 * LOSSLESS BY CONSTRUCTION. Each column is written at the exact width of the
 * `World` array it came from — `types` u8, `colors` u32, `life` i16, `charge`
 * u16 — so a round trip cannot quietly truncate. If a `World` plane is ever
 * widened, this must change with it; `tests/cell-patch-codec.test.ts` asserts
 * the widths still agree rather than trusting the comment.
 *
 * COLUMN-MAJOR, not interleaved: every index, then every type, and so on. Each
 * column is then a run of same-width, similar-magnitude values, which is what
 * a generic compressor (permessage-deflate, or SpacetimeDB's gzip/brotli) can
 * actually exploit. Interleaving would hand it 13-byte noise.
 *
 * LITTLE-ENDIAN, always, written through a `DataView`. Explicit rather than
 * platform-native because these bytes cross machines; a big-endian peer
 * decoding native-order output would read plausible garbage rather than fail.
 *
 * DECODE NEVER THROWS. A frame can arrive from another process, a newer build,
 * or a corrupted socket. Bad input returns `null` so the caller can refuse the
 * frame — the same contract `applyCellPatch` already keeps by skipping
 * out-of-range indices instead of taking the frame loop down with it.
 */

/** 'ADCP' — Alchemist's Descent Cell Patch. */
const MAGIC = 0x41444350;
const VERSION = 1;
/** magic u32 + version u8 + flags u8 + reserved u16 + count u32 */
const HEADER_BYTES = 12;
/** idx u32 + type u8 + color u32 + life i16 + charge u16 */
export const BYTES_PER_CELL = 13;

export function encodedCellPatchBytes(cells: number): number {
  return HEADER_BYTES + cells * BYTES_PER_CELL;
}

/**
 * Pack a patch. Assumes the patch is internally consistent — callers hold
 * `isValidCellPatch` for anything that crossed a boundary.
 */
export function encodeCellPatch(patch: CellPatch): Uint8Array {
  const n = patch.idxs.length;
  const buffer = new ArrayBuffer(encodedCellPatchBytes(n));
  const view = new DataView(buffer);

  view.setUint32(0, MAGIC, true);
  view.setUint8(4, VERSION);
  view.setUint8(5, 0); // flags, reserved
  view.setUint16(6, 0, true); // reserved
  view.setUint32(8, n, true);

  let at = HEADER_BYTES;
  for (let k = 0; k < n; k++, at += 4) view.setUint32(at, patch.idxs[k] >>> 0, true);
  for (let k = 0; k < n; k++, at += 1) view.setUint8(at, patch.types[k] & 0xff);
  for (let k = 0; k < n; k++, at += 4) view.setUint32(at, patch.colors[k] >>> 0, true);
  for (let k = 0; k < n; k++, at += 2) view.setInt16(at, patch.life[k] | 0, true);
  for (let k = 0; k < n; k++, at += 2) view.setUint16(at, patch.charge[k] & 0xffff, true);

  return new Uint8Array(buffer);
}

/**
 * Unpack and validate. Returns null for anything this build must not stamp.
 *
 * `cellLimit` is the receiving world's cell count: a patch is only indices, so
 * the sender's word for them is worth nothing. The cell-id ceiling is checked
 * against `CELL_COUNT` for the same reason `isValidCellPatch` does — ids are an
 * append-only save ABI, so a patch from a NEWER build can name a material this
 * build cannot simulate, and stamping it would put an unsimulatable value in
 * the grid.
 */
export function decodeCellPatch(bytes: Uint8Array, cellLimit: number): CellPatch | null {
  if (bytes.byteLength < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) return null;
  if (view.getUint8(4) !== VERSION) return null;

  const n = view.getUint32(8, true);
  // Guard before allocating: a corrupted count must not ask for a gigabyte.
  if (!Number.isSafeInteger(n) || encodedCellPatchBytes(n) !== bytes.byteLength) return null;

  const idxs = new Array<number>(n);
  const types = new Array<number>(n);
  const colors = new Array<number>(n);
  const life = new Array<number>(n);
  const charge = new Array<number>(n);

  let at = HEADER_BYTES;
  for (let k = 0; k < n; k++, at += 4) {
    const i = view.getUint32(at, true);
    if (i >= cellLimit) return null;
    idxs[k] = i;
  }
  for (let k = 0; k < n; k++, at += 1) {
    const t = view.getUint8(at);
    if (t >= CELL_COUNT) return null;
    types[k] = t;
  }
  for (let k = 0; k < n; k++, at += 4) colors[k] = view.getUint32(at, true);
  for (let k = 0; k < n; k++, at += 2) life[k] = view.getInt16(at, true);
  for (let k = 0; k < n; k++, at += 2) charge[k] = view.getUint16(at, true);

  return { idxs, types, colors, life, charge };
}

/** Is this buffer plausibly one of ours? Cheap enough to call per frame. */
export function looksLikeCellPatch(bytes: Uint8Array): boolean {
  if (bytes.byteLength < HEADER_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === MAGIC && view.getUint8(4) === VERSION;
}

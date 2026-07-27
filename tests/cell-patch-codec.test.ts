import { describe, expect, it } from 'vitest';

import { createCellPatch, isValidCellPatch, type CellPatch } from '@/authoring/cellPatch';
import {
  BYTES_PER_CELL,
  decodeCellPatch,
  encodeCellPatch,
  encodedCellPatchBytes,
  looksLikeCellPatch,
} from '@/authoring/cellPatchCodec';
import { CELL_COUNT } from '@/sim/CellType';
import { World } from '@/sim/World';

const LIMIT = 1600 * 1064;

function samplePatch(n: number): CellPatch {
  const patch = createCellPatch();
  for (let k = 0; k < n; k++) {
    patch.idxs.push((k * 7919) % LIMIT);
    patch.types.push(k % CELL_COUNT);
    patch.colors.push((k * 0x9e3779b1) >>> 0);
    // Deliberately span the signed range: life is Int16Array on World.
    patch.life.push(k % 2 === 0 ? -32768 + (k % 100) : 32767 - (k % 100));
    patch.charge.push((k * 997) % 65536);
  }
  return patch;
}

describe('cell patch binary codec', () => {
  it('round-trips every column exactly', () => {
    const patch = samplePatch(500);
    const decoded = decodeCellPatch(encodeCellPatch(patch), LIMIT);
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(patch);
  });

  it('round-trips an empty patch', () => {
    const decoded = decodeCellPatch(encodeCellPatch(createCellPatch()), LIMIT);
    expect(decoded).toEqual(createCellPatch());
  });

  it('preserves the extremes of each column width', () => {
    // The whole claim of this codec is that it is lossless because the widths
    // mirror World's planes. Saturating each one is the check that matters.
    const patch: CellPatch = {
      idxs: [0, LIMIT - 1],
      types: [0, CELL_COUNT - 1],
      colors: [0, 0xffffffff],
      life: [-32768, 32767],
      charge: [0, 65535],
    };
    expect(decodeCellPatch(encodeCellPatch(patch), LIMIT)).toEqual(patch);
  });

  it('keeps the column widths in step with World', () => {
    // If a World plane is ever widened, the codec silently truncates unless
    // this fails first.
    const world = new World(4, 4);
    expect(world.types.BYTES_PER_ELEMENT).toBe(1);
    expect(world.colors.BYTES_PER_ELEMENT).toBe(4);
    expect(world.life.BYTES_PER_ELEMENT).toBe(2);
    expect(world.charge.BYTES_PER_ELEMENT).toBe(2);
    const perCell =
      4 + // u32 index
      world.types.BYTES_PER_ELEMENT +
      world.colors.BYTES_PER_ELEMENT +
      world.life.BYTES_PER_ELEMENT +
      world.charge.BYTES_PER_ELEMENT;
    expect(perCell).toBe(BYTES_PER_CELL);
  });

  it('is materially smaller than JSON', () => {
    const patch = samplePatch(2000);
    const json = JSON.stringify(patch).length;
    const packed = encodeCellPatch(patch).byteLength;
    expect(packed).toBe(encodedCellPatchBytes(2000));
    // The ADR claims ~2x. Hold the claim honestly rather than loosely.
    expect(packed).toBeLessThan(json / 1.8);
  });

  it('refuses a foreign or corrupted buffer instead of throwing', () => {
    expect(decodeCellPatch(new Uint8Array(0), LIMIT)).toBeNull();
    expect(decodeCellPatch(new Uint8Array(32), LIMIT)).toBeNull();
    const good = encodeCellPatch(samplePatch(10));
    // Wrong magic.
    const wrongMagic = good.slice();
    wrongMagic[0] ^= 0xff;
    expect(decodeCellPatch(wrongMagic, LIMIT)).toBeNull();
    // Wrong version.
    const wrongVersion = good.slice();
    wrongVersion[4] = 99;
    expect(decodeCellPatch(wrongVersion, LIMIT)).toBeNull();
    // Truncated body.
    expect(decodeCellPatch(good.slice(0, good.length - 3), LIMIT)).toBeNull();
  });

  it('refuses a count that does not match the buffer', () => {
    // A corrupted length must not make the decoder allocate on the sender's say-so.
    const bytes = encodeCellPatch(samplePatch(4));
    new DataView(bytes.buffer).setUint32(8, 100000, true);
    expect(decodeCellPatch(bytes, LIMIT)).toBeNull();
  });

  it('refuses indices outside the RECEIVING world', () => {
    // A patch is only indices; the sender's word for them is worth nothing.
    const patch = samplePatch(4);
    patch.idxs[2] = LIMIT + 5;
    expect(decodeCellPatch(encodeCellPatch(patch), LIMIT)).toBeNull();
  });

  it('refuses a cell id this build cannot simulate', () => {
    // Cell ids are an append-only save ABI: a newer build can name a material
    // this one has no behaviour for, and stamping it would poison the grid.
    const patch = samplePatch(3);
    const bytes = encodeCellPatch(patch);
    const typesAt = 12 + 3 * 4;
    bytes[typesAt + 1] = CELL_COUNT;
    expect(decodeCellPatch(bytes, LIMIT)).toBeNull();
  });

  it('recognises its own frames and not others', () => {
    expect(looksLikeCellPatch(encodeCellPatch(samplePatch(2)))).toBe(true);
    expect(looksLikeCellPatch(new TextEncoder().encode('{"type":"cells"}'))).toBe(false);
    expect(looksLikeCellPatch(new Uint8Array(4))).toBe(false);
  });

  it('produces patches the existing validator accepts', () => {
    // The binary path must not become a way to smuggle in a patch the JSON
    // path would have refused.
    const decoded = decodeCellPatch(encodeCellPatch(samplePatch(64)), LIMIT);
    expect(isValidCellPatch(decoded, LIMIT)).toBe(true);
  });

  it('survives a non-zero byteOffset view', () => {
    // Socket reads routinely hand back a view into a larger pooled buffer.
    const packed = encodeCellPatch(samplePatch(12));
    const padded = new Uint8Array(packed.byteLength + 7);
    padded.set(packed, 7);
    const view = padded.subarray(7);
    expect(decodeCellPatch(view, LIMIT)).not.toBeNull();
    expect(looksLikeCellPatch(view)).toBe(true);
  });
});

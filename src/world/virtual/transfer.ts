import { Cell, isLiquid } from '@/sim/CellType';
import type {
  TransferableVirtualChunk,
  VirtualChunk,
  VirtualChunkPlane,
} from '@/world/virtual/types';

export function chunkBytes(chunk: VirtualChunk): number {
  return chunk.types.byteLength + chunk.colors.byteLength + chunk.life.byteLength + chunk.charge.byteLength;
}

/**
 * Returns the ArrayBuffer to transfer for a plane. Today every plane is a standalone full-buffer
 * Uint8Array/etc, so the fast path transfers the backing buffer untouched (zero-copy). If a plane is
 * ever a subarray/view (sliced cache region, pooled buffer), `.buffer` would be the wrong/oversized
 * store and the receiver (which reads from offset 0) would corrupt cells — so slice out exactly this
 * view's bytes instead. The slice also leaves the source buffer attached, so a chunk can be transferred
 * more than once without yielding zero-length planes on the second send.
 */
function planeBuffer(view: ArrayBufferView): ArrayBuffer {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function planeBytes(chunk: VirtualChunk, plane: VirtualChunkPlane): number {
  switch (plane) {
    case 'types':
      return chunk.types.byteLength;
    case 'colors':
      return chunk.colors.byteLength;
    case 'life':
      return chunk.life.byteLength;
    case 'charge':
      return chunk.charge.byteLength;
    case 'previewRgba':
      return chunk.size * chunk.size * 4;
  }
}

export function toTransferableChunk(
  chunk: VirtualChunk,
  requestedPlanes: readonly VirtualChunkPlane[],
): { chunk: TransferableVirtualChunk; transfer: Transferable[] } {
  const wants = new Set(requestedPlanes);
  const transfer: Transferable[] = [];
  let transferBytes = 0;
  const summary = chunkCellSummary(chunk);
  const out: TransferableVirtualChunk = {
    cx: chunk.cx,
    cy: chunk.cy,
    originX: chunk.originX,
    originY: chunk.originY,
    size: chunk.size,
    meta: chunk.meta,
    metrics: {
      cx: chunk.cx,
      cy: chunk.cy,
      generatedMs: chunk.meta.generatedMs,
      generatedBytes: chunkBytes(chunk),
      transferBytes: 0,
      materialCells: summary.materialCells,
      liquidCells: summary.liquidCells,
      glowCells: summary.glowCells,
      sceneCount: chunk.meta.scenePlacements.length,
      bytes: chunkBytes(chunk),
    },
  };
  if (wants.has('types')) {
    const buffer = planeBuffer(chunk.types);
    out.types = buffer;
    transfer.push(buffer);
    transferBytes += planeBytes(chunk, 'types');
  }
  if (wants.has('colors')) {
    const buffer = planeBuffer(chunk.colors);
    out.colors = buffer;
    transfer.push(buffer);
    transferBytes += planeBytes(chunk, 'colors');
  }
  if (wants.has('life')) {
    const buffer = planeBuffer(chunk.life);
    out.life = buffer;
    transfer.push(buffer);
    transferBytes += planeBytes(chunk, 'life');
  }
  if (wants.has('charge')) {
    const buffer = planeBuffer(chunk.charge);
    out.charge = buffer;
    transfer.push(buffer);
    transferBytes += planeBytes(chunk, 'charge');
  }
  if (wants.has('previewRgba')) {
    const preview = makePreviewRgba(chunk);
    const buffer = planeBuffer(preview);
    out.previewRgba = buffer;
    transfer.push(buffer);
    transferBytes += planeBytes(chunk, 'previewRgba');
  }
  out.metrics.transferBytes = transferBytes;
  return { chunk: out, transfer };
}

function chunkCellSummary(chunk: VirtualChunk): { materialCells: number; liquidCells: number; glowCells: number } {
  let materialCells = 0;
  let liquidCells = 0;
  let glowCells = 0;
  for (let i = 0; i < chunk.types.length; i++) {
    const t = chunk.types[i] as Cell;
    if (t !== Cell.Empty) materialCells++;
    if (isLiquid(t)) liquidCells++;
    if (t === Cell.Fire || t === Cell.Lava || t === Cell.Glowshroom || t === Cell.Crystal) glowCells++;
  }
  return { materialCells, liquidCells, glowCells };
}

export function fromTransferableChunk(input: TransferableVirtualChunk): VirtualChunk {
  const n = input.size * input.size;
  return {
    cx: input.cx,
    cy: input.cy,
    originX: input.originX,
    originY: input.originY,
    size: input.size,
    types: input.types ? new Uint8Array(input.types) : new Uint8Array(n),
    colors: input.colors ? new Uint32Array(input.colors) : new Uint32Array(n),
    life: input.life ? new Int16Array(input.life) : new Int16Array(n),
    charge: input.charge ? new Uint8Array(input.charge) : new Uint8Array(n),
    meta: input.meta,
  };
}

export function makePreviewRgba(chunk: VirtualChunk): Uint8ClampedArray {
  const out = new Uint8ClampedArray(chunk.size * chunk.size * 4);
  for (let i = 0; i < chunk.types.length; i++) {
    const color = chunk.colors[i];
    const oi = i * 4;
    out[oi] = (color >> 16) & 0xff;
    out[oi + 1] = (color >> 8) & 0xff;
    out[oi + 2] = color & 0xff;
    out[oi + 3] = chunk.types[i] === Cell.Empty ? 16 : 255;
  }
  return out;
}

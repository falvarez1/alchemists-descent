import type { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { EMPTY_COLOR } from '@/sim/colors';
import { compositeCmd, paintTerrainCmd } from '@/builder/commands';
import type { CellPatch, Command } from '@/builder/commands';
import { PatchRecorder } from '@/builder/terrain';
import type { Region } from '@/builder/terrain';

/**
 * Floating cell selection (Builder power editing): lift a region of REAL
 * cells off the world, carry it around (move / rotate / mirror), then land
 * it as ONE undoable command. The colors plane travels with the block so
 * hand-tints survive the trip — this is the one terrain path that does NOT
 * regenerate factory colors.
 *
 * Lifecycle contract (the Builder enforces it as a modal state):
 *   liftSelection  — clears the source through a PatchRecorder and holds the
 *                    lift patch; the world now has a hole and NO command is
 *                    on the stack yet, so capture/save/undo must be gated.
 *   commitFloating — stamps the block at its current position and returns a
 *                    composite of two paintTerrainCmds (lift + paste), both
 *                    already applied live (the idempotent-do convention).
 *   cancelFloating — replays the lift patch's `before` directly; no command.
 */

/** Lift cap: a float is a room-scale move, not a whole-world cut. */
export const FLOAT_CELL_CAP = 250_000;

export interface FloatingSelection {
  w: number;
  h: number;
  /** Local planes, idx = x + y * w. Colors are the REAL world colors. */
  cells: Uint8Array;
  colors: Uint32Array;
  life: Int16Array;
  charge: Uint8Array;
  /** 1 = cell belongs to the float (poly/magic masks narrow a rect lift). */
  mask: Uint8Array;
  /** 1 = the lifted cell's color was a registered scar (hand-tint), so commit
   *  must re-register it in world.colorOverrides or the tint dies on first swap. */
  overrides: Uint8Array;
  /** Current world top-left. */
  x: number;
  y: number;
  /** Where it was lifted from (an untouched commit shortcuts to cancel). */
  origX: number;
  origY: number;
  /** True once rotated/mirrored — commit can no longer be a no-op. */
  transformed: boolean;
  /** The source clear; null when the lifted region was already all-empty. */
  liftPatch: { before: CellPatch; after: CellPatch } | null;
  /** Cached canvas preview pixels (built lazily, browser-side only). */
  preview: ImageData | null;
}

/**
 * Lift the region's cells (mask-narrowed when given) into a float and clear
 * the source. Returns null over the cap — the world is left untouched.
 */
export function liftSelection(
  world: World,
  region: Region,
  mask: Uint8Array | null,
): FloatingSelection | null {
  const w = region.x1 - region.x0 + 1;
  const h = region.y1 - region.y0 + 1;
  if (w <= 0 || h <= 0 || w * h > FLOAT_CELL_CAP) return null;

  const f: FloatingSelection = {
    w,
    h,
    cells: new Uint8Array(w * h),
    colors: new Uint32Array(w * h),
    life: new Int16Array(w * h),
    charge: new Uint8Array(w * h),
    mask: new Uint8Array(w * h),
    overrides: new Uint8Array(w * h),
    x: region.x0,
    y: region.y0,
    origX: region.x0,
    origY: region.y0,
    transformed: false,
    liftPatch: null,
    preview: null,
  };

  const rec = new PatchRecorder(world);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const li = x + y * w;
      if (mask && mask[li] !== 1) continue;
      const X = region.x0 + x,
        Y = region.y0 + y;
      if (!world.inBounds(X, Y)) continue;
      const wi = world.idx(X, Y);
      f.mask[li] = 1;
      f.cells[li] = world.types[wi];
      f.colors[li] = world.colors[wi];
      f.life[li] = world.life[wi];
      f.charge[li] = world.charge[wi];
      f.overrides[li] = world.colorOverrides.has(wi) ? 1 : 0;
      // clear the source — the hole IS the feedback that the block lifted
      rec.touch(wi);
      world.types[wi] = Cell.Empty;
      world.colors[wi] = EMPTY_COLOR;
      world.life[wi] = 0;
      world.clearChargeAt(wi); // drop any charge from the sparse active index too
    }
  }
  f.liftPatch = rec.finish();
  return f;
}

/** 90 degrees clockwise: src(x, y) -> dst(h-1-y, x); position keeps center. */
export function rotateFloating(f: FloatingSelection): FloatingSelection {
  const dw = f.h,
    dh = f.w;
  const map = <T extends Uint8Array | Uint32Array | Int16Array>(src: T, dst: T): T => {
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        dst[f.h - 1 - y + x * dw] = src[x + y * f.w];
      }
    }
    return dst;
  };
  return {
    ...f,
    w: dw,
    h: dh,
    cells: map(f.cells, new Uint8Array(dw * dh)),
    colors: map(f.colors, new Uint32Array(dw * dh)),
    life: map(f.life, new Int16Array(dw * dh)),
    charge: map(f.charge, new Uint8Array(dw * dh)),
    mask: map(f.mask, new Uint8Array(dw * dh)),
    overrides: map(f.overrides, new Uint8Array(dw * dh)),
    x: f.x + Math.floor((f.w - dw) / 2),
    y: f.y + Math.floor((f.h - dh) / 2),
    transformed: true,
    preview: null,
  };
}

/** Horizontal mirror: src(x, y) -> dst(w-1-x, y). */
export function mirrorFloating(f: FloatingSelection): FloatingSelection {
  const map = <T extends Uint8Array | Uint32Array | Int16Array>(src: T, dst: T): T => {
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        dst[f.w - 1 - x + y * f.w] = src[x + y * f.w];
      }
    }
    return dst;
  };
  return {
    ...f,
    cells: map(f.cells, new Uint8Array(f.w * f.h)),
    colors: map(f.colors, new Uint32Array(f.w * f.h)),
    life: map(f.life, new Int16Array(f.w * f.h)),
    charge: map(f.charge, new Uint8Array(f.w * f.h)),
    mask: map(f.mask, new Uint8Array(f.w * f.h)),
    overrides: map(f.overrides, new Uint8Array(f.w * f.h)),
    transformed: true,
    preview: null,
  };
}

/**
 * Stamp the float at its current position and bundle lift + paste into ONE
 * composite command. Both patches are already applied live when the caller
 * runs the command — paintTerrainCmd's do() just replays `after`, so the
 * run is idempotent. Undo replays paste.before then lift.before, which is
 * byte-identical even when the destination overlaps the source.
 */
export function commitFloating(world: World, f: FloatingSelection): Command | null {
  const rec = new PatchRecorder(world);
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const li = x + y * f.w;
      if (f.mask[li] !== 1) continue;
      const X = f.x + x,
        Y = f.y + y;
      if (!world.inBounds(X, Y)) continue;
      const wi = world.idx(X, Y);
      rec.touch(wi);
      world.types[wi] = f.cells[li];
      world.colors[wi] = f.colors[li]; // hand-tints travel with the block
      world.life[wi] = f.life[li];
      world.setChargeAt(wi, f.charge[li]); // keep the sparse charge index in step
      // Re-register (or clear) the color scar so the carried tint survives the
      // destination cell's first swap instead of regenerating a factory color.
      if (f.overrides[li]) world.colorOverrides.add(wi);
      else world.colorOverrides.delete(wi);
    }
  }
  const paste = rec.finish();
  const cmds: Command[] = [];
  if (f.liftPatch) cmds.push(paintTerrainCmd(world, f.liftPatch.before, f.liftPatch.after));
  if (paste) cmds.push(paintTerrainCmd(world, paste.before, paste.after));
  if (cmds.length === 0) return null;
  return cmds.length === 1 ? cmds[0] : compositeCmd('move cells', cmds);
}

/** Abandon the float: restore the lifted cells in place. No command. */
export function cancelFloating(world: World, f: FloatingSelection): void {
  const p = f.liftPatch?.before;
  if (!p) return;
  for (let n = 0; n < p.idxs.length; n++) {
    const i = p.idxs[n];
    world.types[i] = p.types[n];
    world.colors[i] = p.colors[n];
    world.life[i] = p.life[n];
    world.setChargeAt(i, p.charge[n]); // restore charge through the sparse index
  }
}

/**
 * Canvas preview pixels for the float (cached on the record): real colors
 * for carried cells, a faint dark wash for carried emptiness (it stamps
 * Empty — the full extent must read), transparent outside the mask.
 * Browser-only (ImageData); pure callers simply never call it.
 */
export function floatPreview(f: FloatingSelection): ImageData {
  if (f.preview) return f.preview;
  const img = new ImageData(f.w, f.h);
  for (let i = 0; i < f.w * f.h; i++) {
    const o = i * 4;
    if (f.mask[i] !== 1) continue;
    if (f.cells[i] === Cell.Empty) {
      img.data[o + 3] = 70; // dark wash: "this will stamp emptiness"
      continue;
    }
    const c = f.colors[i];
    img.data[o] = (c >> 16) & 255;
    img.data[o + 1] = (c >> 8) & 255;
    img.data[o + 2] = c & 255;
    img.data[o + 3] = 235;
  }
  f.preview = img;
  return img;
}

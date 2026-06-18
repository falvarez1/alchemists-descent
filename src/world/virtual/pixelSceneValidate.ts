import { Cell, isLiquid } from '@/sim/CellType';
import type { PixelSceneDef } from '@/world/virtual/types';

/**
 * Author-time validation for pixel scenes (T4 of docs/CHUNKED-WORLD-ENHANCEMENTS.md).
 * Pure function — surfaced live in the scene editor and usable as a vitest gate. Catches
 * the mistakes the placement/materialization pipeline would otherwise swallow silently.
 */
export interface SceneWarning {
  severity: 'error' | 'warn';
  code: string;
  message: string;
}

/** Soft per-scene light budget; the window materialization cap is 128 across ALL scenes. */
export const MAX_SCENE_LIGHTS = 24;

export function validatePixelScene(def: PixelSceneDef): SceneWarning[] {
  const out: SceneWarning[] = [];
  const { w, h, material, mask } = def;
  const n = w * h;
  if (!w || !h || !material || material.length < n) {
    out.push({ severity: 'error', code: 'dims', message: `material plane too short for ${w}×${h}` });
    return out;
  }
  const painted = (i: number): boolean => (mask ? mask[i] !== 0 : material[i] !== Cell.Empty);
  const openAt = (j: number | null): boolean => j === null || !painted(j); // out-of-bounds or unpainted = open

  // 1) Liquid without a basin: a liquid cell with an open floor or open side will
  //    drain the instant the scene is materialized into the live sim (it flows).
  let leaks = 0;
  let liquidCells = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (!painted(i) || !isLiquid(material[i])) continue;
      liquidCells++;
      const below = y + 1 >= h ? null : x + (y + 1) * w;
      const left = x - 1 < 0 ? null : x - 1 + y * w;
      const right = x + 1 >= w ? null : x + 1 + y * w;
      if (openAt(below) || openAt(left) || openAt(right)) leaks++;
    }
  }
  if (liquidCells > 0 && leaks > 0) {
    out.push({
      severity: 'warn',
      code: 'liquid-basin',
      message: `${leaks} liquid cell(s) lack a solid basin and will drain when played — frame the pool with a one-cell rim`,
    });
  }

  // 2) Light budget.
  const lights = def.lights ?? [];
  if (lights.length > MAX_SCENE_LIGHTS) {
    out.push({
      severity: 'warn',
      code: 'light-budget',
      message: `${lights.length} lights in one scene — the window cap is 128 across all scenes; trim it`,
    });
  }

  // 3) Out-of-bounds objects/lights (they'd be silently dropped at materialization).
  const checkBounds = (arr: ReadonlyArray<{ x: number; y: number }>, kind: string): void => {
    for (const o of arr) {
      if (o.x < 0 || o.y < 0 || o.x >= w || o.y >= h) {
        out.push({ severity: 'error', code: 'oob', message: `a ${kind} at (${o.x},${o.y}) is outside the ${w}×${h} footprint` });
        return;
      }
    }
  };
  checkBounds(def.objects ?? [], 'object');
  checkBounds(lights, 'light');

  // 4) Placement/authoring hints.
  if (!def.kind) out.push({ severity: 'warn', code: 'no-kind', message: 'no scene kind — only a slot that lists its tags can place it' });
  if (!def.tags || def.tags.length === 0) out.push({ severity: 'warn', code: 'no-tags', message: 'no tags — chooseSceneForSlot will rarely match it to a biome/slot' });
  let paintedCount = 0;
  for (let i = 0; i < n; i++) if (painted(i)) paintedCount++;
  if (paintedCount === 0) out.push({ severity: 'warn', code: 'empty', message: 'no painted cells — the scene stamps nothing' });

  return out;
}

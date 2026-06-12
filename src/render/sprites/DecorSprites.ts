import type { Ctx, RuntimeDecor } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { VIEW_H, VIEW_W } from '@/config/constants';

/**
 * Animated decor renderer — sibling of drawEnemySprite.
 *
 * VISUAL-ONLY INVARIANT: decor is presentation, the same class as enemy
 * sprites, critters and pickup glyphs. It never writes cells, never
 * collides, never blocks, never gates progression — the grid doesn't know
 * it's there. This module reads the world ONLY through the light field.
 *
 * Frame timing is STATELESS off ctx.state.frameCount (no Game.tick hook):
 * decor animates through pause and hitstop exactly like fire flicker does —
 * correct for ambient visuals. Per-decor `phase` (object-id hash) keeps a
 * row of identical torches from pulsing in sync.
 */

/** Steps in one loop pass (pingpong folds the return leg, endpoints once). */
export function decorSteps(d: RuntimeDecor): number {
  const n = d.to - d.from + 1;
  if (n <= 1) return 1;
  return d.dir === 'pingpong' ? 2 * n - 2 : n;
}

/** Map a step index in the (possibly folded) sequence to a real frame index. */
export function stepFrame(d: RuntimeDecor, k: number): number {
  const n = d.to - d.from + 1;
  if (n <= 1) return d.from;
  if (d.dir === 'forward') return d.from + k;
  if (d.dir === 'reverse') return d.to - k;
  return k < n ? d.from + k : d.to - (k - n + 1); // pingpong fold
}

/** Total loop length in ticks under authored frame durations. */
export function decorLoopTicks(d: RuntimeDecor): number {
  const steps = decorSteps(d);
  let total = 0;
  for (let k = 0; k < steps; k++) total += d.sprite.frames[stepFrame(d, k)].ticks;
  return Math.max(1, total);
}

/**
 * Stateless frame lookup: t = (frameCount [* tickScale] + phase) % loop.
 * tickScale 0 walks the authored durations at native speed; tickScale > 0
 * is the fps override — uniform stepping at tickScale steps per tick.
 */
export function decorFrame(d: RuntimeDecor, frameCount: number): number {
  const steps = decorSteps(d);
  if (steps <= 1) return d.from;
  if (d.tickScale > 0) {
    const k = (Math.floor(frameCount * d.tickScale) + d.phase) % steps;
    return stepFrame(d, k);
  }
  let t = (frameCount + d.phase) % decorLoopTicks(d);
  for (let k = 0; k < steps; k++) {
    const f = stepFrame(d, k);
    const ticks = d.sprite.frames[f].ticks;
    if (t < ticks) return f;
    t -= ticks;
  }
  return d.from;
}

/**
 * Draw one decor instance, center-anchored on (x, y). Off-camera decor is
 * culled before any pixel work. Light is sampled ONCE at the body center
 * (the EnemySprites convention); emissive sprites draw their raw colors.
 * Alpha is binary at 128 — matching the terrain-PNG importer's threshold.
 */
export function drawDecor(s: PixelSurface, light: LightField, ctx: Ctx, d: RuntimeDecor): void {
  const sp = d.sprite;
  const camX = ctx.camera.renderX,
    camY = ctx.camera.renderY;
  const x0 = d.x - (sp.w >> 1),
    y0 = d.y - (sp.h >> 1);
  if (x0 >= camX + VIEW_W || y0 >= camY + VIEW_H || x0 + sp.w <= camX || y0 + sp.h <= camY) {
    return;
  }

  const frame = sp.frames[decorFrame(d, ctx.state.frameCount)];
  let lr = 1,
    lg = 1,
    lb = 1;
  if (!sp.emissive) {
    const lt = light.sample(d.x, d.y);
    lr = Math.max(0.05, lt.r);
    lg = Math.max(0.05, lt.g);
    lb = Math.max(0.05, lt.b);
  }
  const data = frame.data;
  for (let py = 0; py < sp.h; py++) {
    const row = py * sp.w;
    for (let px = 0; px < sp.w; px++) {
      const o = (row + (d.flipX ? sp.w - 1 - px : px)) * 4;
      if (data[o + 3] < 128) continue;
      s.setPx(
        x0 + px,
        y0 + py,
        (data[o] / 255) * lr,
        (data[o + 1] / 255) * lg,
        (data[o + 2] / 255) * lb,
      );
    }
  }
}

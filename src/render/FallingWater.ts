import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { Cell } from '@/sim/CellType';

/** A short exposure of each cell's actual last swept path, under actors.
 * No pool outlines on droplets, no persistent trails, and no simulated mass. */
export function drawFallingWater(out: PixelSurface, light: LightField, ctx: Ctx): void {
  const { world, camera } = ctx, step = out.pixelStep ?? 1;
  for (const [index, flight] of world.flow.falling) {
    if (world.types[index] !== Cell.Water || flight.y < camera.renderY - 6 || flight.y > camera.renderY + VIEW_H + 6
      || flight.x < camera.renderX - 6 || flight.x > camera.renderX + VIEW_W + 6) continue;
    const dx = flight.x - flight.previousX, dy = flight.y - flight.previousY;
    if (dy < .7) continue;
    const length = Math.hypot(dx, dy), samples = Math.ceil(length / step);
    const sample = light.sample(flight.x, flight.y);
    const r = Math.min(1.4, Math.max(.55, sample.r)), g = Math.min(1.4, Math.max(.55, sample.g)), b = Math.min(1.4, Math.max(.55, sample.b));
    for (let i = 0; i <= samples; i++) {
      const t = i / samples, x = flight.previousX + dx * t, y = flight.previousY + dy * t;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (!world.inBounds(ix, iy)) continue;
      const type = world.type(ix, iy);
      if (type !== Cell.Empty && type !== Cell.Water) continue;
      // Fine, downward strokes catch a little light; the material cell remains
      // the opaque core. The fading tail stops at the previous tick's position.
      const strength = (.45 + t * .55) / Math.max(1, length * .6);
      (out.addFinePx ?? out.addPx).call(out, x, y, .04 * r * strength, .085 * g * strength, .095 * b * strength);
    }
  }
}

import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { interpolateBody } from '@/render/RenderPoses';
import { spriteBounds, spriteSampleAt, FELL_EMBER, FELL_GLOWSEED, FELL_LEAF, FELL_SEED, FELL_WOOD } from '@/game/floraFelling';
import { VIEW_H, VIEW_W } from '@/config/constants';

/**
 * FLORA: draw the stands that are falling. Each is the exact set of cells
 * that stood a moment ago (bark, crown, pods), carried at its Rapier pose and
 * rasterised at the surface's fine pixel step — so the tree you cut is the
 * tree that falls, pixel for pixel, and the log it lands as is the same bark.
 */
export function drawFallingFlora(out: PixelSurface, light: LightField, ctx: Ctx, alpha: number): void {
  const falling = ctx.flora?.falling;
  if (!falling || falling.length === 0) return;
  const step = out.pixelStep ?? 1;
  const put = out.setFinePx ?? out.setPx;
  const camX = ctx.camera.renderX, camY = ctx.camera.renderY;
  const frame = ctx.state.frameCount;
  for (const f of falling) {
    const pose = interpolateBody(f.body, alpha);
    const b = spriteBounds(f.sprite, f.cx0, f.cy0, f.a0, pose.x, pose.y, pose.angle);
    if (b.x1 < camX - 2 || b.x0 > camX + VIEW_W + 2 || b.y1 < camY - 2 || b.y0 > camY + VIEW_H + 2) continue;
    const x0 = Math.max(camX - 1, Math.floor(b.x0 / step) * step), x1 = Math.min(camX + VIEW_W + 1, b.x1);
    const y0 = Math.max(camY - 1, Math.floor(b.y0 / step) * step), y1 = Math.min(camY + VIEW_H + 1, b.y1);
    const sprite = f.sprite;
    const kinds = sprite.kind, colors = sprite.color;
    const half = step * 0.5;
    for (let qy = y0; qy <= y1; qy += step) {
      for (let qx = x0; qx <= x1; qx += step) {
        const si = spriteSampleAt(sprite, f.cx0, f.cy0, f.a0, pose.x, pose.y, pose.angle, qx + half, qy + half);
        if (si < 0) continue;
        const k = kinds[si];
        if (k === 0) continue;
        const c = colors[si];
        let r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, bl = (c & 255) / 255;
        const lt = light.sample(qx, qy);
        let lr = lt.r * 0.86, lg = lt.g * 0.86, lb = lt.b * 0.86;
        if (k === FELL_EMBER) {
          // It comes down burning: the embers keep their own light.
          const flick = 0.6 + 0.4 * Math.sin(frame * 0.5 + si * 1.7);
          r = Math.min(1, r * 0.5 + 0.75 * flick); g = Math.min(1, g * 0.35 + 0.28 * flick); bl *= 0.3;
          lr = Math.max(lr, 1.1); lg = Math.max(lg, 0.8); lb = Math.max(lb, 0.5);
        } else if (k === FELL_GLOWSEED) {
          lr = Math.max(lr, 1.2); lg = Math.max(lg, 1.2); lb = Math.max(lb, 1);
        } else if (k === FELL_LEAF) {
          // leaves rush through the air: the crown flutters as it goes
          const rustle = 0.9 + Math.sin(frame * 0.3 + si * 0.37) * 0.1;
          r *= rustle; g *= rustle; bl *= rustle;
        } else if (k !== FELL_WOOD && k !== FELL_SEED) continue;
        put.call(out, qx, qy, r * lr, g * lg, bl * lb);
      }
    }
  }
}

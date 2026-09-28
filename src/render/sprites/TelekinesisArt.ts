import type { Ctx } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';
import { tetherView } from '@/combat/Telekinesis';

/**
 * The wand's thread (combat/Telekinesis): a hairline of brass from the wand
 * tip to the grip. It sags under the body's weight and draws taut as the
 * spring pulls; it wavers along its length like heat over a lamp; three beads
 * of light run down it into the body; the grip glints. A fresh grip flares for
 * a few ticks (the tug). Restrained on purpose — a filament and a few beads,
 * not a beam — and quieter still under reduced flashes (no flare, no beads'
 * bloom).
 */
export function drawTelekinesis(out: PixelSurface, ctx: Ctx): void {
  const v = tetherView(ctx);
  if (!v) return;
  const t = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  const dx = v.x1 - v.x0, dy = v.y1 - v.y0, len = Math.hypot(dx, dy);
  if (len < 2) return;
  const add = (out.addFinePx ?? out.addPx).bind(out);
  const step = Math.min(1, out.pixelStep ?? 1);
  // The normal that points down (the thread sags toward the ground).
  let nx = -dy / len, ny = dx / len;
  if (ny < 0) { nx = -nx; ny = -ny; }
  const slack = 1 - v.strain * 0.8;
  const sag = Math.min(9, len * 0.09) * slack * (0.6 + 0.25 * Math.min(4, v.mass));
  const flare = calm ? 0 : Math.max(0, 1 - v.heldT / 10);
  const glow = (calm ? 0.16 : 0.24) + v.strain * (calm ? 0.08 : 0.16) + flare * 0.6;
  const R = 1.0 * glow, G = 0.76 * glow, B = 0.4 * glow;
  const pos = (u: number): [number, number] => {
    const bow = 4 * u * (1 - u);
    const waver = Math.sin(u * 13 + t * 0.33) * 0.45 * slack * bow + Math.sin(u * 29 - t * 0.21) * 0.18 * bow;
    return [v.x0 + dx * u + nx * (sag * bow + waver), v.y0 + dy * u + ny * (sag * bow + waver)];
  };
  const n = Math.max(4, Math.ceil(len / (step * 0.8)));
  for (let i = 0; i <= n; i++) {
    const u = i / n, [x, y] = pos(u);
    // Brightest at the wand, thinning toward the body; a slow shimmer rides along it.
    const k = (1 - u * 0.35) * (0.8 + 0.2 * Math.sin(u * 22 - t * 0.5));
    add(x, y, R * k, G * k, B * k);
  }
  // Beads of light running down into the body.
  for (let b = 0; b < 3; b++) {
    const u = (t * 0.028 + b / 3) % 1, [x, y] = pos(u);
    const k = (calm ? 0.35 : 0.7) * Math.sin(u * Math.PI);
    add(x, y, 1.0 * k, 0.86 * k, 0.55 * k);
    if (!calm) { add(x + step, y, 0.5 * k, 0.4 * k, 0.2 * k); add(x - step, y, 0.5 * k, 0.4 * k, 0.2 * k); }
  }
  // The grip glints; the tip sparks.
  const pulse = 0.55 + 0.25 * Math.sin(t * 0.3) + flare * 0.8;
  const gk = calm ? 0.35 : pulse;
  add(v.x1, v.y1, 1.0 * gk, 0.84 * gk, 0.5 * gk);
  for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) add(v.x1 + ox * step * 1.5, v.y1 + oy * step * 1.5, 0.45 * gk, 0.36 * gk, 0.18 * gk);
  add(v.x0, v.y0, 0.9 * gk, 0.75 * gk, 0.45 * gk);
}

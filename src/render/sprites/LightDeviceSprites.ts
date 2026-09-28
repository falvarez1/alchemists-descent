import type { Ctx, LumenBloom } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { INK, Pen, cameraView, type RGB } from './FineArt';

/**
 * Lumen blooms (light wave): the heart is drawn here; the petals are real
 * Glass cells in the grid (game/lumenBlooms). Closed, the bud is a pale
 * furled teardrop breathing a faint light of its own, so the beam can find
 * it in the dark; opening, five ivory petals fan back from a burning heart;
 * when the hold runs out and it begins to furl, the petals shiver.
 */

const STEM: RGB = [0.16, 0.3, 0.2];
const STEM_D: RGB = [0.08, 0.16, 0.11];
const PETAL: RGB = [0.78, 0.94, 0.8];
const PETAL_D: RGB = [0.46, 0.66, 0.52];
const HEART: RGB = [0.85, 1.25, 0.95];

function drawBloom(p: Pen, b: LumenBloom, frame: number): void {
  const d = b.dir >= 0 ? 1 : -1;
  const x = b.x, y = b.y;
  const open = b.open;
  const furling = b.hold <= 0 && open > 0.02;
  const shiver = furling ? Math.sin(frame * 0.9 + b.id) * 0.35 : 0;
  // The stem curls out of the rock behind the heart and down to the root.
  p.curve(x - d * 4, y + 4, x - d * 3.5, y + 0.5, x, y, STEM_D, 0.9);
  p.curve(x - d * 3, y + 3.5, x - d * 2.4, y + 1, x - d * 0.2, y + 0.2, STEM, 0.4);
  if (open < 0.08) {
    // Furled: a tight teardrop pointing up and out along the bridge line.
    const breathe = 0.28 + Math.sin(frame * 0.045 + b.id * 1.7) * 0.1;
    p.oval(x + d * 0.4, y - 1.6, 1.35, 2.5, PETAL_D, d * 0.35, INK);
    p.line(x + d * 0.4, y - 3.2, x + d * 0.3, y - 0.4, STEM_D, 0);
    p.raw(x + d * 0.5, y - 1.8, HEART, breathe);
    p.glow(x + d * 0.4, y - 1.6, [0.3, 0.7, 0.45], breathe * 0.5);
    return;
  }
  // Opening: five petals fan back from the heart, wider as it opens.
  for (let k = 0; k < 5; k++) {
    const u = k / 4 - 0.5;
    const a = -Math.PI / 2 + d * (0.35 + u * 2.4 * open) + shiver * (k % 2 ? 1 : -1) * 0.2;
    const len = 1.6 + open * 2.2;
    const px = x + Math.cos(a) * len * 0.9, py = y - 1 + Math.sin(a) * len * 0.9;
    p.oval(px, py, 0.95, len * 0.75, k % 2 ? PETAL : PETAL_D, a + Math.PI / 2, INK);
  }
  const burn = 0.55 + open * 0.75 + Math.sin(frame * 0.12 + b.id) * 0.08;
  p.disc(x, y - 1, 1.15, HEART, INK, p.step, true);
  p.raw(x, y - 1, [1.1, 1.3, 1.1], burn);
  p.glow(x, y - 1, [0.4, 0.9, 0.6], 0.35 + open * 0.45);
}

export function drawLumenBlooms(out: PixelSurface, light: LightField, ctx: Ctx): void {
  const rt = ctx.levels.current;
  if (!rt?.lumenBlooms || ctx.state.mode !== 'play') return;
  const view = cameraView(ctx.camera, 16);
  const frame = ctx.state.frameCount;
  for (const b of rt.lumenBlooms) {
    if (b.x < view.x0 - 8 || b.x > view.x1 + 8 || b.y < view.y0 - 8 || b.y > view.y1 + 8) continue;
    const s = light.sample(b.x, b.y - 1);
    const floor = 0.5 * Math.max(0.25, s.open ?? 1);
    drawBloom(new Pen(out, view, [Math.min(1.1, Math.max(floor, s.r)), Math.min(1.1, Math.max(floor, s.g)), Math.min(1.1, Math.max(floor, s.b))]), b, frame);
  }
}

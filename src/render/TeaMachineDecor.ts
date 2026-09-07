import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { drawTeaLinkages } from '@/render/TeaMachineLinkages';
import { interpolateBody } from '@/render/RenderPoses';
import { INK, Pen, cameraView, type RGB } from '@/render/sprites/FineArt';

const DUCK: RGB = [0.88, 0.67, 0.16];
const DUCK_D: RGB = [0.58, 0.4, 0.08];
const BEAK: RGB = [0.85, 0.38, 0.09];

/** Wheels, rods and cables follow the solver; the duck rides its carriage. */
export function drawTeaMachineDecor(out: PixelSurface, light: LightField, ctx: Ctx, alpha = 1): void {
  if (!ctx.levels.current?.living?.tea) return;
  drawTeaLinkages(out, light, ctx, alpha);
  const duck = ctx.rigidBodies.bodies.find(b => b.tag === 'tea-duck');
  if (!duck) return;
  const pose = interpolateBody(duck, alpha), c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  const sample = light.sample(pose.x, pose.y - 6);
  const p = new Pen(out, cameraView(ctx.camera, 24), [Math.max(0.55, sample.r), Math.max(0.55, sample.g), Math.max(0.55, sample.b)]);
  if (!p.inView(pose.x - 16, pose.y - 22, pose.x + 16, pose.y + 6)) return;
  const at = (x: number, y: number): readonly [number, number] => [pose.x + x * c - y * s, pose.y + x * s + y * c];
  // A rubber duck in profile: body, tail, head, beak and one bright eye —
  // built from rotated ovals so the float's real tilt reads.
  const oval = (cx: number, cy: number, rx: number, ry: number, color: RGB, rim = true): void => {
    for (let dy = -ry; dy <= ry; dy += p.step) for (let dx = -rx; dx <= rx; dx += p.step) {
      const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (d > 1) continue;
      const [x, y] = at(cx + dx, cy + dy);
      if (rim && d > 0.82) { p.px(x, y, INK); continue; }
      p.px(x, y, color, 0.78 + Math.sqrt(1 - d) * 0.3 - (dx + dy) / (rx + ry) * 0.16);
    }
  };
  oval(-1, -6, 10, 5.2, DUCK);
  p.polygon([at(-10, -8), at(-13, -13), at(-7.5, -8.5)], DUCK_D, 1, 0.2); // tail flick
  oval(-2, -6, 5.5, 2.4, DUCK_D, false); // folded wing
  oval(6, -12.5, 4.6, 4.2, DUCK); // head
  p.polygon([at(9.5, -12), at(15, -11), at(9.5, -10)], BEAK, 1, 0.3);
  p.line(...at(10, -11), ...at(14.4, -11), INK);
  const [ex, ey] = at(7.5, -13.5);
  p.px(ex, ey, INK); p.px(ex - p.step, ey - p.step, [1, 1, 1], 1.1);
}

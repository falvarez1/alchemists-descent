import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { drawTeaLinkages } from '@/render/TeaMachineLinkages';
import { drawWorksFixtures } from '@/render/WorksFixtures';
import { interpolateBody } from '@/render/RenderPoses';
import { INK, Pen, cameraView, type RGB } from '@/render/sprites/FineArt';

const DUCK: RGB = [0.88, 0.67, 0.16];
const DUCK_D: RGB = [0.58, 0.4, 0.08];
const BEAK: RGB = [0.85, 0.38, 0.09];
const EYE_WHITE: RGB = [1.3, 1.3, 1.3];
const BRASS: RGB = [0.86, 0.62, 0.2];
const BRASS_D: RGB = [0.56, 0.38, 0.1];

/**
 * THE DUCK'S ATTENTION (presentation only): its pupil follows the alchemist within EYE_REACH cells,
 * it blinks slowly (every BLINK_EVERY s, shut for BLINK_S), and once the engine has served it wears
 * the brass bell on its head. `look` is the pupil's eased offset (local frame, -1..1).
 */
const EYE_REACH = 80;
const BLINK_EVERY = 7.3;
const BLINK_S = 0.2;
const look = { x: 0.45, y: 0.1, at: 0 };

/** Wheels, rods and cables follow the solver; the duck rides its carriage. */
export function drawTeaMachineDecor(out: PixelSurface, light: LightField, ctx: Ctx, alpha = 1): void {
  if (!ctx.levels.current?.living?.tea) return;
  drawWorksFixtures(out, light, ctx);
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
  // The eye: a white, a pupil that turns toward the alchemist while he is near, a slow blink.
  const eye = at(7.3, -13.4);
  const player = ctx.player;
  const wx = player.x - eye[0], wy = player.y - 8 - eye[1], dist = Math.hypot(wx, wy);
  const near = !player.dead && dist <= EYE_REACH && dist > 0.5;
  // The direction to him, turned into the duck's own (tilted) frame; at rest the pupil looks ahead and a little down.
  const tx = near ? (wx / dist) * c + (wy / dist) * s : 0.45;
  const ty = near ? -(wx / dist) * s + (wy / dist) * c : 0.1;
  const now = performance.now();
  const k = 1 - Math.exp(-Math.min(0.1, (now - look.at) / 1000) / 0.14);
  look.at = now;
  look.x += (tx - look.x) * k;
  look.y += (ty - look.y) * k;
  const seconds = ctx.state.frameCount / 60;
  if (seconds % BLINK_EVERY < BLINK_S) {
    p.line(...at(5.9, -13.3), ...at(8.7, -13.3), INK);
  } else {
    oval(7.3, -13.4, 1.5, 1.5, EYE_WHITE, false);
    oval(7.3 + look.x * 0.7, -13.4 + look.y * 0.6, 0.8, 0.8, INK, false);
  }
  // Served: the brass bell from the gate sits on its head.
  if (ctx.levels.current?.living?.tea?.completed) {
    const sway = Math.sin(seconds * 2.4) * 0.5;
    p.polygon([at(2.4, -16.4), at(8.8, -16.4), at(8.2, -17.6), at(3.0, -17.6)], BRASS_D, 1, 0.2);
    oval(5.6 + sway, -19.1, 2.7, 2.2, BRASS);
    p.px(...at(4.6 + sway, -19.9), [1, 0.95, 0.75], 1.1);
    p.px(...at(5.6 + sway * 0.4, -16.1), BRASS_D);
  }
}

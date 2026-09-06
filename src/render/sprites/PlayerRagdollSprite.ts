import type { Ctx, RagdollPart, RigidBody } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { PLAYER_PALETTE as C } from './playerPalette';

type Point = { x: number; y: number };
type Color = readonly [number, number, number];
const INK: Color = [.045, .065, .066];

export function ragdollPoint(body: RigidBody, x: number, y: number, alpha = 1): Point {
  const px = body.previousX ?? body.x, py = body.previousY ?? body.y, pa = body.previousAngle ?? body.angle;
  const angle = pa + Math.atan2(Math.sin(body.angle - pa), Math.cos(body.angle - pa)) * alpha;
  return { x: px + (body.x - px) * alpha + x * Math.cos(angle) - y * Math.sin(angle),
    y: py + (body.y - py) * alpha + x * Math.sin(angle) + y * Math.cos(angle) };
}

/** Read-only render of solved joints. No procedural flailing or frame-owned
 * springs: cuffs, hands and boots follow their own physical segments. */
export function drawPlayerRagdollSprite(out: PixelSurface, field: LightField, ctx: Ctx, alpha: number): void {
  const rig = ctx.rigidBodies.playerRagdoll;
  if (!rig || ctx.state.mode !== 'play') return;
  const parts = rig.parts, step = out.pixelStep ?? 1;
  const light = field.sample(parts.torso.x, parts.torso.y);
  const shade = [light.r, light.g, light.b].map(value => Math.max(.8, Math.min(1, value)));
  const pixel = (x: number, y: number, color: Color, k = 1) =>
    (out.setFinePx ?? out.setPx).call(out, x, y, color[0] * shade[0] * k, color[1] * shade[1] * k, color[2] * shade[2] * k);
  const poly = (points: Point[], color: Color) => {
    const top = Math.floor(Math.min(...points.map(p => p.y)) / step) * step, bottom = Math.max(...points.map(p => p.y));
    for (let y = top; y <= bottom; y += step) {
      const cuts: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a.y > y) !== (b.y > y)) cuts.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i += 2) for (let x = Math.ceil(cuts[i] / step) * step; x <= cuts[i + 1]; x += step) pixel(x, y, color);
    }
  };
  const pt = (part: RagdollPart, x: number, y: number) => ragdollPoint(parts[part], x, y, alpha);
  const box = (part: RagdollPart, x0: number, y0: number, x1: number, y1: number, color: Color) =>
    poly([pt(part, x0, y0), pt(part, x1, y0), pt(part, x1, y1), pt(part, x0, y1)], color);
  const dot = (part: RagdollPart, x: number, y: number, color: Color) => { const p = pt(part, x, y); pixel(p.x, p.y, color); };
  const limb = (part: RagdollPart, length: number, color: Color, width = 1) => {
    box(part, -width - .4, -length - .3, width + .4, length + .3, INK);
    box(part, -width, -length, width, length, color);
    box(part, -width, -length + .3, -width + .5, length - .3, C.TRIM);
  };
  for (const side of ['left', 'right'] as const) {
    limb(`${side}Thigh`, 1.7, C.ROBE_D, .95);
    limb(`${side}Shin`, 1.1, C.BOOT, .85);
    box(`${side}Shin`, -1, .35, rig.facing > 0 ? 1.9 : 1, 1.6, C.BOOT);
    box(`${side}Shin`, -1, .35, 1, .8, C.BOOT_L);
    limb(`${side}Arm`, 1.7, side === 'left' ? C.ROBE_D : C.ROBE, .9);
    limb(`${side}Forearm`, 1.4, C.ROBE, .8);
    box(`${side}Forearm`, -.85, .65, .85, 1.2, C.BAND);
    box(`${side}Forearm`, -.75, 1.2, .75, 2, C.SKIN);
  }
  // Split coat tails drape over the thighs instead of becoming a stiff slab.
  poly([pt('torso', -2.5, .4), pt('torso', .2, .7), pt('leftThigh', 1.3, 1.9), pt('leftThigh', -1.8, 2.2)], C.ROBE_D);
  poly([pt('torso', -.2, .7), pt('torso', 2.5, .4), pt('rightThigh', 1.8, 2.2), pt('rightThigh', -1.3, 1.9)], C.ROBE);
  box('torso', -2.7, -3.9, 2.7, 3.2, INK);
  box('torso', -2.2, -3.5, 2.2, 3, C.ROBE);
  box('torso', -2.2, -3.2, -1.3, 3, C.ROBE_D);
  box('torso', -.2, -3.2, .35, 3, C.TRIM);
  box('torso', -2.3, .3, 2.3, 1.15, C.BAND);
  box('torso', -.7, .2, .7, 1.3, C.TRIM);
  dot('torso', .65, -2, C.BAND); dot('torso', .65, -.8, C.BAND);
  box('torso', -1.6, -3.9, 1.6, -2.9, C.TRIM);
  const head = pt('head', 0, 0);
  for (let y = -2.7; y <= 2.7; y += step) for (let x = -2.7; x <= 2.7; x += step) {
    if (x * x + y * y > 7) continue;
    pixel(head.x + x, head.y + y, x * x + y * y > 5.2 ? INK : x * rig.facing > .5 ? C.SKIN : C.SKIN_D);
  }
  box('head', -.8, -.3, 1.45, .25, C.HAT_D); // closed eyelid beneath the brow
  dot('head', rig.facing * 1.8, .5, C.SKIN); dot('head', rig.facing * .7, 1.4, C.BAND);
  box('hat', -4.3, -.1, 4.3, 1, INK);
  box('hat', -4, -.3, 4, .4, C.HAT);
  poly([pt('hat', -2.8, -.4), pt('hat', -1.6, -3.5), pt('hat', 1.5, -3.2), pt('hat', 2.8, -.4)], C.HAT);
  box('hat', -2.6, -1.2, 2.6, -.4, C.BAND);
  box('hat', -1.4, -3, -.9, -1.4, C.HAT_D);
}

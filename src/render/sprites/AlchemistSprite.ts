import { clamp } from '@/core/math';
import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { Pen, type RGB } from './FineArt';

type Point = readonly [number, number];
type Local = (side: number, up: number) => Point;

const P = {
  ink: [0.025, 0.045, 0.05] as RGB,
  coat: [0.12, 0.31, 0.31] as RGB,
  coatLight: [0.24, 0.45, 0.4] as RGB,
  coatDark: [0.065, 0.16, 0.18] as RGB,
  mantle: [0.75, 0.69, 0.54] as RGB,
  mantleLight: [0.91, 0.84, 0.66] as RGB,
  mantleDark: [0.39, 0.38, 0.31] as RGB,
  leather: [0.18, 0.105, 0.16] as RGB,
  leatherLight: [0.42, 0.25, 0.22] as RGB,
  copper: [0.82, 0.43, 0.16] as RGB,
  copperLight: [1, 0.69, 0.29] as RGB,
  skin: [0.84, 0.57, 0.4] as RGB,
  skinLight: [0.98, 0.73, 0.52] as RGB,
  beard: [0.075, 0.105, 0.105] as RGB,
  boot: [0.095, 0.065, 0.105] as RGB,
  bootLight: [0.29, 0.19, 0.24] as RGB,
  cyan: [0.38, 0.9, 0.94] as RGB,
  blood: [0.43, 0.045, 0.065] as RGB,
} as const;

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Production half-cell alchemist. The costume is assembled from the same
 * authored pieces in every pose: broad mantle, fitted coat, split tails,
 * bandolier, gloves, buckled boots, bearded profile and battered hooked hat.
 * Pose state is read-only; collision and spell contracts remain authoritative.
 */
export function drawAlchemistSprite(out: PixelSurface, field: LightField, ctx: Ctx): boolean {
  if (!out.setFinePx) return false;
  const a = ctx.player, frame = ctx.state.frameCount, facing = a.facing < 0 ? -1 : 1;
  // Builder/test surfaces may intentionally provide no lighting sampler. The
  // production composer always does, while a neutral fallback keeps this art
  // usable anywhere the shared sprite signature is exercised.
  const sampled = typeof field.sample === 'function' ? field.sample(a.x, a.y - 9) : { r: 1, g: 1, b: 1 };
  const pen = new Pen(out, null, [
    Math.min(1.04, Math.max(.72, sampled.r)),
    Math.min(1.04, Math.max(.72, sampled.g)),
    Math.min(1.04, Math.max(.72, sampled.b)),
  ]);
  const stain = clamp(a.bloodStain / 1000, 0, 1);
  const cloth = (base: RGB, worldY: number): RGB => mix(base, P.blood,
    stain * clamp((worldY - (a.y - 8)) / 8, 0, 1) * .72);

  const shape = (points: readonly Point[], color: RGB, inner?: RGB): void => {
    pen.polygon(points, P.ink);
    if (inner) {
      const cx = points.reduce((sum, point) => sum + point[0], 0) / points.length;
      const cy = points.reduce((sum, point) => sum + point[1], 0) / points.length;
      pen.polygon(points.map(([x, y]) => [cx + (x - cx) * .88, cy + (y - cy) * .88]), inner, 1, .08);
    } else pen.polygon(points, color, 1, .08);
  };
  const stroke = (from: Point, to: Point, color: RGB, width: number): void => {
    pen.line(...from, ...to, P.ink, width + 1.05);
    pen.line(...from, ...to, color, width);
    pen.line(from[0] - .2, from[1] - .25, to[0] - .2, to[1] - .25, color, 0, 1.22);
  };
  const joint = (point: Point, rx: number, ry: number, color: RGB, angle = 0): void =>
    pen.oval(...point, rx, ry, color, angle, P.ink, .55);
  const boot = (ankle: Point, direction: number, lift = 0): void => {
    const angle = direction * .06;
    pen.oval(ankle[0] + direction * .55, ankle[1] - lift, 2.15, 1.05, P.boot, angle, P.ink, .55);
    pen.line(ankle[0] - direction * .6, ankle[1] - .65 - lift,
      ankle[0] + direction * 1.65, ankle[1] - .65 - lift, P.bootLight, .55);
    pen.box(ankle[0] + direction * .15, ankle[1] - 1.15 - lift, .55, .45, 0, P.copper, P.ink);
  };

  const drawHatAndFace = (at: Local, bodyAngle: number, compressed = false): void => {
    const head = at(.45, 13.85);
    joint(head, 2.45, 2.75, P.skin, bodyAngle * .25);
    // Ear, profile nose and brow make facing readable at gameplay size.
    joint(at(-1.3, 13.9), .65, .8, P.skin, bodyAngle);
    shape([at(1.25, 14.45), at(3.15, 13.85), at(1.25, 13.25)], P.skin, P.skinLight);
    pen.line(...at(.55, 15.1), ...at(2.0, 14.9), P.beard, .75);
    if (a.blinkTimer === 0) {
      pen.raw(...at(1.55, 14.55), [0.88, 0.89, 0.75]);
      pen.raw(...at(1.9, 14.55), P.ink);
    } else pen.line(...at(1.1, 14.55), ...at(2.0, 14.55), P.ink);
    // Short beard and moustache keep the lower face from becoming a blank orb.
    shape([at(-.5, 12.15), at(1.65, 12.55), at(2.15, 13.55), at(.55, 13.3), at(-1.25, 13.0)], P.beard);
    pen.line(...at(.4, 13.4), ...at(2.2, 13.15), P.beard, .65);
    pen.raw(...at(1.65, 13.0), P.skinLight, .8);

    const brimLeft = at(-5.65, 16.05), brimRight = at(5.9, 16.0);
    pen.curve(...brimLeft, ...at(-.2, 15.35), ...brimRight, P.ink, 2.35);
    pen.curve(...brimLeft, ...at(-.2, 15.42), ...brimRight, P.mantle, 1.25);
    pen.curve(...at(-5.0, 16.05), ...at(0, 16.7), ...at(5.2, 16.05), P.mantleLight, .5);
    pen.curve(...at(-4.6, 15.9), ...at(0, 15.35), ...at(5.0, 15.85), P.mantleDark, .5);

    const springX = clamp(a.hat.ox * .42, -2.5, 2.5), springY = clamp(a.hat.oy * .3, -1.5, 1.5);
    const tip = compressed ? at(-5.1, 16.6) : [at(-3.3, 21.0)[0] + springX, at(-3.3, 21.0)[1] + springY] as Point;
    const crown: Point[] = [at(-2.75, 16.2), at(-2.0, compressed ? 17.2 : 19.4), tip,
      [tip[0] + facing * 1.25, tip[1] + .8], at(1.1, compressed ? 17.2 : 20.1), at(2.8, 16.15)];
    shape(crown, P.mantle, P.mantle);
    pen.curve(...at(-2.25, 16.35), ...at(-2.15, compressed ? 16.8 : 19.4), ...tip, P.mantleDark, .8);
    pen.curve(...at(-2.6, 16.45), ...at(0, 17.05), ...at(2.6, 16.35), P.leather, 1.05);
    pen.box(...at(1.2, 16.65), .7, .6, bodyAngle, P.copper, P.ink);
    joint(tip, .65, .65, P.copperLight);
  };

  const drawCoat = (at: Local, motion: number, compressed = 0): void => {
    const hemUp = 2.25 + compressed * 1.6;
    const lag = clamp(a.robe.ox * .34, -2.25, 2.25);
    const mantle: Point[] = [at(-4.6, 11.9), at(-3.1, 13.05), at(.1, 12.7), at(3.9, 12.15),
      at(4.75, 10.25), at(2.7, 9.55), at(-.4, 10.25), at(-4.6, 9.8), at(-5.35, 10.7)];
    shape(mantle, P.mantle, P.mantle);
    pen.curve(...at(-4.3, 11.6), ...at(-.6, 10.25), ...at(4.15, 11.75), P.mantleLight, .65);
    pen.curve(...at(-4.5, 9.95), ...at(-1, 10.5), ...at(3.7, 9.9), P.mantleDark, .6);

    const coat: Point[] = [at(-3.6, 10.25), at(-3.75, 6.2),
      [at(-4.8, hemUp)[0] + lag, at(-4.8, hemUp)[1]], [at(-1.3, hemUp + .9)[0] + lag * .55, at(-1.3, hemUp + .9)[1]],
      at(0, 4.1), at(1.55, hemUp + .45), at(5.05 + motion * .25, hemUp + .2), at(3.55, 6.1), at(3.5, 10.35)];
    shape(coat, cloth(P.coat, coat[2][1]), cloth(P.coat, coat[2][1]));
    shape([coat[0], coat[1], coat[2], coat[3], at(-.35, 5.0), at(-.45, 10.1)], P.coatDark,
      cloth(P.coatDark, coat[2][1]));
    pen.curve(...at(-3.2, 6.4), ...at(0, 5.2), ...at(3.8, 6.25), P.leather, 1.2);
    pen.box(...at(.25, 6.0), .7, .65, 0, P.copper, P.ink);
    pen.curve(...at(-2.6, 11.2), ...at(-.6, 8.8), ...at(2.9, 6.4), P.leatherLight, 1.0);
    pen.curve(...at(-2.45, 11.1), ...at(-.45, 8.7), ...at(3.0, 6.25), P.copper, .4);
    // Reagent pouches and cyan vial are silhouette-bearing equipment, not noise.
    pen.box(...at(-3.65, 5.45), 1.15, 1.25, -.08 * facing, P.leatherLight, P.ink);
    pen.line(...at(-4.55, 4.65), ...at(-2.75, 4.8), P.copper, .5);
    pen.box(...at(3.35, 5.25), 1.0, 1.15, .08 * facing, P.leather, P.ink);
    pen.oval(...at(2.25, 8.0), .75, 1.1, P.cyan, 0, P.copper, .4, true);
    pen.raw(...at(2.05, 7.6), [0.72, 1, 1], .85);
  };

  const drawWand = (grip: Point): void => {
    if (a.legClub || a.pullT > 0) return;
    const muzzle = ctx.spells.wandTip();
    const angle = Math.atan2(muzzle.y - grip[1], muzzle.x - grip[0]);
    const recoil = a.recoilT > 0 ? (a.recoilT > 3 ? 1.2 : .6) : 0;
    const gx = grip[0] - Math.cos(angle) * recoil, gy = grip[1] - Math.sin(angle) * recoil;
    const reach = Math.max(5, Math.min(13, Math.hypot(muzzle.x - grip[0], muzzle.y - grip[1])));
    const tip: Point = [gx + Math.cos(angle) * reach, gy + Math.sin(angle) * reach];
    const butt: Point = [gx - Math.cos(angle) * 3.4, gy - Math.sin(angle) * 3.4];
    pen.line(...butt, ...tip, P.ink, 1.35);
    pen.line(...butt, ...tip, P.leatherLight, .55);
    pen.line(tip[0] - Math.cos(angle) * 1.3, tip[1] - Math.sin(angle) * 1.3, ...tip, P.copper, .75);
    if (a.swapT <= 6) {
      const glow = a.firing ? 1 : .58 + Math.sin(frame * .2) * .07;
      pen.raw(...tip, P.cyan, glow);
      if (a.firing) pen.glow(...tip, [0.15, .55, .7], .32);
    }
    joint([gx, gy], 1.15, .9, P.leather);
  };

  const standard = (): void => {
    const crouch = clamp(a.crouchT / 10, 0, 1), landing = clamp(a.landTimer / 10, 0, 1);
    const air = a.grounded ? 0 : 1, skid = clamp(a.skidT / 10, 0, 1), hurt = clamp(a.staggerT / 10, 0, 1);
    const pulling = a.pullT > 0 ? 1 : 0;
    const speed = Math.min(1, Math.abs(a._svx || a.vx) / 2.1);
    const dive = a.diveT > 0 ? 1 : 0;
    const angle = facing * (speed * .055 + skid * .17 + dive * .32 - pulling * .14) - a.staggerDir * hurt * .17;
    const squash = crouch * 3.1 + landing * 1.8;
    const stretch = clamp(a.stretchT / 10, 0, 1) * 1.3;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const at: Local = (side, up) => {
      const scaledUp = up - squash * clamp(up / 16, 0, 1) + stretch * clamp(up / 16, 0, 1);
      const dx = facing * side, dy = -scaledUp;
      return [a.x + dx * cos - dy * sin, a.y + dx * sin + dy * cos];
    };
    let stride = a.grounded ? Math.sin(a.stridePhase) * (1.15 + speed * 1.75) : 0;
    if (skid) stride = -2.1;
    let backFoot = at(-2.0 - stride, .15), frontFoot = at(2.0 + stride, .1);
    let backKnee = at(-1.25 - stride * .25, 3.45), frontKnee = at(1.25 + stride * .25, 3.6);
    if (air) {
      const falling = a.vy > .2;
      backFoot = at(-2.7, falling ? 1.8 : .7); frontFoot = at(2.25, falling ? .6 : 2.1);
      backKnee = at(-.8, falling ? 4.25 : 3); frontKnee = at(1.55, falling ? 3.2 : 4.4);
    }
    if (pulling) {
      backFoot = at(-3.15, .1); frontFoot = at(3.0, .1);
      backKnee = at(-1.7, 3.35); frontKnee = at(1.5, 3.55);
    }
    if (dive) { backFoot = at(-4.1, 5.4); frontFoot = at(-2.0, 2.8); backKnee = at(-1.5, 4.7); frontKnee = at(.2, 4.0); }
    if (a.kickT > 0) { frontKnee = at(3.2, 4.8); frontFoot = at(8.5, 4.7); }
    const hip = at(0, 6.2), shoulder = at(0, 11.25);
    stroke(hip, backKnee, cloth(P.coatDark, backKnee[1]), 1.75); stroke(backKnee, backFoot, P.boot, 1.45); boot(backFoot, facing);
    const rearElbow = at(-3.1 - stride * .22, 9.1), rearHand = at(-3.35 - stride * .3, 6.5);
    stroke(shoulder, rearElbow, P.coatDark, 1.65); stroke(rearElbow, rearHand, P.leather, 1.2); joint(rearHand, 1.15, .95, P.leather);
    drawCoat(at, stride, crouch);
    stroke(hip, frontKnee, cloth(P.coat, frontKnee[1]), 1.8); stroke(frontKnee, frontFoot, P.bootLight, 1.5); boot(frontFoot, facing);
    drawHatAndFace(at, angle);
    let elbow = at(3.2 - stride * .18, 9.2), hand = at(3.65 - stride * .12, 6.95);
    if (air) { elbow = at(3.5, 9.7); hand = at(4.15, 8.0); }
    if (a.pullT > 0) {
      const t = 1 - clamp(a.pullT / 26, 0, 1), dir = a.pullDir || facing;
      elbow = [a.x + dir * (3.7 - t), a.y - 9.3 + t * 1.3];
      hand = [a.x + dir * (6.0 - t * 2.4), a.y - 8.4 + t * 2.3];
    } else if (a.firing || a.recoilT > 0) {
      // Casting owns a strong, straight action line from shoulder to muzzle;
      // the elbow remains offset so the arm never collapses into one rod.
      const shoulderAim = at(1.35, 10.65), aim = a.aimAngle;
      const recoil = a.recoilT > 0 ? .75 : 0;
      hand = [shoulderAim[0] + Math.cos(aim) * (5.0 - recoil), shoulderAim[1] + Math.sin(aim) * (5.0 - recoil)];
      elbow = [shoulderAim[0] + Math.cos(aim) * 2.2 - Math.sin(aim) * .8,
        shoulderAim[1] + Math.sin(aim) * 2.2 + Math.cos(aim) * .8];
    }
    drawWand(hand);
    stroke(shoulder, elbow, P.coatLight, 1.7); stroke(elbow, hand, P.leatherLight, 1.2); joint(hand, 1.15, .95, P.leather);
  };

  const crawl = (): void => {
    const angle = Math.atan(clamp(a.crawlSlope, -1, 1)) * facing;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const at: Local = (along, up) => {
      const dx = facing * along, dy = -up;
      return [a.x + dx * cos - dy * sin, a.y + dx * sin + dy * cos];
    };
    const cramped = !ctx.physics.entityFree(a.x, a.y, 4, 10), stride = Math.sin(a.stridePhase);
    const toe = at(-8.1 + Math.max(0, -stride), .2), knee = at(-4.8, 1.2 + Math.max(0, stride));
    stroke(toe, knee, P.boot, 1.6); boot(toe, -facing);
    shape([at(-6.2, .4), at(-5.1, 3.0), at(-1.4, 4.35), at(3.6, 4.05), at(4.35, 1.25), at(.8, .35)],
      P.coat, cloth(P.coat, a.y - 1));
    shape([at(-6.2, .5), at(-4.7, 2.9), at(-.4, 4.2), at(1.8, 3.7), at(-1.2, 2.2)], P.coatDark);
    pen.curve(...at(-4.0, 2.8), ...at(-.4, 2.0), ...at(3.2, 3.1), P.mantle, 1.2);
    pen.curve(...at(-2.8, 3.45), ...at(.2, 2.8), ...at(2.8, 2.8), P.leatherLight, .7);
    const shoulder = at(1.0, 3.5), elbow = at(3.0, 1.4), hand = at(6.0 + Math.max(0, stride), .35);
    drawHatAndFace((side, up) => at(side + 5.0, up - 11.15), angle, cramped);
    drawWand(hand);
    stroke(shoulder, elbow, P.coatLight, 1.6); stroke(elbow, hand, P.leatherLight, 1.15); joint(hand, 1.0, .8, P.leather);
  };

  const climb = (): void => {
    const wall = a.climbing ? (a.climbDir || facing) : (a.wallGrabDir || facing);
    const phase = a.climbing ? a.climbPhase : frame * .025, reach = Math.sin(phase) * 1.8;
    const at: Local = (side, up) => [a.x + wall * side + clamp(a.climbLean, -.3, .3) * up, a.y - up];
    const hip = at(-2.0, 6.4), shoulder = at(-1.35, 11.25);
    // Both boots seek the wall while the knees and hips hang back. This
    // profile reads as a climb even when the diagnostic sheet omits terrain.
    const rearKnee = at(-3.45, 3.8), rearFoot = at(.8, 1.6 + Math.max(0, -reach));
    const frontKnee = at(-3.0, 4.5), frontFoot = at(1.35, 1.0 + Math.max(0, reach));
    stroke(hip, rearKnee, P.coatDark, 1.75); stroke(rearKnee, rearFoot, P.boot, 1.45); boot(rearFoot, wall);
    const rearElbow = at(-2.7, 11.7), rearHand = at(2.2, 14.2 + Math.max(0, -reach));
    stroke(shoulder, rearElbow, P.coatDark, 1.65); stroke(rearElbow, rearHand, P.leather, 1.15); joint(rearHand, 1.1, .9, P.leather);
    drawCoat(at, reach, 0);
    stroke(hip, frontKnee, P.coat, 1.8); stroke(frontKnee, frontFoot, P.bootLight, 1.5); boot(frontFoot, wall);
    drawHatAndFace(at, 0);
    const elbow = at(3.0, 11.4), hand = at(2.6, 15.8 + Math.max(0, reach));
    drawWand(hand);
    stroke(shoulder, elbow, P.coatLight, 1.7); stroke(elbow, hand, P.leatherLight, 1.2); joint(hand, 1.15, .95, P.leather);
  };

  if (a.crawling) crawl();
  else if (a.climbing || a.wallGrabT > 0) climb();
  else standard();

  if (a.status.frozen > 0) for (let i = 0; i < 5; i++) {
    pen.raw(a.x - 3.5 + i * 1.7, a.y - 2.5 - (i % 2) * 3.8, [0.63, .88, .94], .7);
  }
  if (a.status.burning > 0) for (let i = 0; i < 4; i++) {
    const x = a.x - 2.4 + i * 1.6, y = a.y - 4 - Math.sin(frame * .22 + i) * 2;
    pen.glow(x, y, [1, .35, .08], .55); pen.raw(x, y + .5, [1, .68, .14], .8);
  }
  if (a.status.electrified > 0 && frame % 4 !== 0) {
    pen.line(a.x - 4.5, a.y - 11, a.x - 1, a.y - 14.5, [0.42, .86, 1]);
    pen.line(a.x - 1, a.y - 14.5, a.x + 3.5, a.y - 10.5, [0.42, .86, 1]);
  }
  return true;
}

import type { Ctx, Enemy } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { looseLegGeometry, weaverLegGeometry } from '@/creatures/weaverAnatomy';
import type { LimbPoint } from '@/creatures/weaverAnatomy';
import { createChain } from '@/creatures/body';
import type { CreatureExpression } from '@/creatures/expression';

type Color = readonly [number, number, number];
const INK: Color = [.055, .09, .10], SHELL: Color = [.71, .78, .68];
const TEAL: Color = [.26, .49, .46], SILK: Color = [.70, .84, .77], GOLD: Color = [.85, .62, .32];
const QUIET: Readonly<CreatureExpression> = { gazeX: .5, gazeY: 0, alert: 0, fear: 0, hurt: 0, jaw: 0, lid: 0 };

/** Lit volumes in world cells. Motion samples simulation-owned poses or their
 * frozen clock; rescaled bitmap pieces and renderer-owned integration are absent. */
class CreaturePen {
  readonly step: number;
  private readonly light: Color;
  private readonly hit: number;
  constructor(private readonly out: PixelSurface, field: LightField, ctx: Ctx, e: Readonly<Pick<Enemy, 'x' | 'y' | 'flash'>>, maxLight = Infinity) {
    this.step = out.pixelStep ?? 1;
    const sample = field.sample(e.x, e.y - 8);
    this.light = [Math.min(maxLight, Math.max(.6, sample.r)), Math.min(maxLight, Math.max(.6, sample.g)), Math.min(maxLight, Math.max(.6, sample.b))];
    this.hit = !ctx.state.reduceFlashes && e.flash > 0 ? Math.min(.2, e.flash / 30) : 0;
  }
  pixel(x: number, y: number, c: Color, shade = 1, emissive = false): void {
    const k = emissive ? 1 : shade;
    (this.out.setFinePx ?? this.out.setPx).call(this.out, x, y,
      c[0] * k * (emissive ? 1 : this.light[0]) * (1 - this.hit) + this.hit * .85,
      c[1] * k * (emissive ? 1 : this.light[1]) * (1 - this.hit) + this.hit * .7,
      c[2] * k * (emissive ? 1 : this.light[2]) * (1 - this.hit) + this.hit * .5);
  }
  line(ax: number, ay: number, bx: number, by: number, c: Color, width = 1): void {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / this.step));
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n;
      this.pixel(x, y, c);
      for (let dy = this.step; dy < width; dy += this.step) this.pixel(x, y + dy, c, .65);
    }
  }
  curve(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, c: Color, width = 1): void {
    let px = ax, py = ay;
    const n = Math.max(4, Math.ceil((Math.hypot(cx - ax, cy - ay) + Math.hypot(bx - cx, by - cy)) / 3));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * ax + 2 * u * t * cx + t * t * bx, y = u * u * ay + 2 * u * t * cy + t * t * by;
      this.line(px, py, x, y, c, width); px = x; py = y;
    }
  }
  polygon(points: ReadonlyArray<readonly [number, number]>, color: Color): void {
    const low = Math.floor(Math.min(...points.map(p => p[1]))), high = Math.ceil(Math.max(...points.map(p => p[1])));
    const cuts: number[] = [];
    for (let y = low; y <= high; y += this.step) {
      cuts.length = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) cuts.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i += 2) for (let x = cuts[i]; x <= cuts[i + 1]; x += this.step) {
        this.pixel(x, y, color, .93 - (y - low) / Math.max(1, high - low) * .3);
      }
    }
  }
  oval(x: number, y: number, rx: number, ry: number, c: Color, angle = 0, _pattern = 0): void {
    const cos = Math.cos(angle), sin = Math.sin(angle), boundY = Math.ceil(Math.hypot(rx * sin, ry * cos));
    // Solve the ellipse's scanline intersections. Thin fins and plates no
    // longer scan a square as wide as their longest axis, at either fidelity.
    const irx = 1 / (rx * rx), iry = 1 / (ry * ry), a = cos * cos * irx + sin * sin * iry;
    for (let dy = -boundY; dy <= boundY; dy += this.step) {
      const b = 2 * dy * cos * sin * (irx - iry), c0 = dy * dy * (sin * sin * irx + cos * cos * iry) - 1;
      const disc = b * b - 4 * a * c0;
      if (disc < 0) continue;
      const root = Math.sqrt(disc), left = Math.ceil((-b - root) / (2 * a * this.step)) * this.step, right = (-b + root) / (2 * a);
      for (let dx = left; dx <= right; dx += this.step) {
      const u = (dx * cos + dy * sin) / rx, v = (-dx * sin + dy * cos) / ry, d = u * u + v * v;
      if (d > 1) continue;
      if (d > .94) { this.pixel(x + dx, y + dy, INK); continue; }
      const shade = .5 + Math.sqrt(1 - d) * .36 - v * .14 - u * .045;
      this.pixel(x + dx, y + dy, c, shade);
      }
    }
  }
  eye(x: number, y: number, rx: number, ry: number, iris: Color, rig: Readonly<CreatureExpression>, angle = 0): void {
    const open = Math.max(.12, 1 - rig.lid), cos = Math.cos(angle), sin = Math.sin(angle);
    if (open < .22) { this.line(x - cos * rx, y - sin * rx, x + cos * rx, y + sin * rx, INK); return; }
    this.oval(x, y, rx + .5, ry * open + .5, INK, angle);
    this.oval(x, y, rx, ry * open, SILK, angle);
    const gx = rig.gazeX * rx * .25, gy = rig.gazeY * ry * open * .25;
    this.oval(x + gx, y + gy, rx * .64, ry * open * .8, iris, angle);
    this.oval(x + gx, y + gy, Math.max(.35, rx * .23), Math.max(.4, ry * open * (.5 + rig.fear * .25)), INK, angle);
    this.pixel(x + gx - .5, y + gy - .5, SILK, 1, true);
    // Brow compresses toward the leading corner when the animal commits.
    if (rig.alert > .3 || rig.hurt > .25) this.line(x - cos * rx, y - sin * rx - ry * open,
      x + cos * rx, y + sin * rx - ry * open + rig.alert * .8, TEAL);
  }
}

function drawLimb(p: CreaturePen, joints: readonly LimbPoint[], color: Color): void {
  for (let j = 1; j < joints.length; j++) {
    const a = joints[j - 1], b = joints[j], width = j < 3 ? 2 : 1;
    p.line(a.x, a.y + .5, b.x, b.y + .5, INK, width + .5);
    p.line(a.x, a.y, b.x, b.y, color, width);
    if (j < joints.length - 1) p.oval(b.x, b.y, j === 2 ? 1.6 : 1, 1, SHELL);
  }
}

export function drawLegFragment(out: PixelSurface, light: LightField, ctx: Ctx, x: number, y: number,
  length: number, angle: number, age = 300): void {
  const pen = new CreaturePen(out, light, ctx, { x, y, flash: 0 });
  const curl = Math.sin(age * .7) * Math.max(0, 1 - age / 180) * .06;
  drawLimb(pen, looseLegGeometry(x, y, length, angle, curl), SHELL);
}

export function drawHeldLeg(out: PixelSurface, light: LightField, ctx: Ctx, alpha = 1): void {
  const p = ctx.player, club = p.legClub;
  if (!club || p.dead) return;
  const rig = club.rig;
  if (!rig) return;
  const blend = (a: LimbPoint, b: LimbPoint) => ({ x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha });
  const hand = blend(rig.previousHand, rig.hand), knee = blend(rig.previousKnee, rig.knee), hip = blend(rig.previousHip, rig.hip);
  const pen = new CreaturePen(out, light, ctx, { x: knee.x, y: knee.y, flash: 0 }, 1.1);
  pen.line(hand.x, hand.y, knee.x, knee.y, INK, 1.8); pen.line(hand.x, hand.y, knee.x, knee.y, SHELL, .9);
  pen.line(knee.x, knee.y, hip.x, hip.y, INK, 2.8); pen.line(knee.x, knee.y, hip.x, hip.y, SHELL, 1.6);
  pen.oval(knee.x, knee.y, 1.8, 1.6, TEAL); pen.oval(knee.x, knee.y, 1, .8, SHELL);
  pen.oval(hip.x, hip.y, 1.5, 1, TEAL);
  for (let i = 1; i < 5; i++) {
    const t = i / 5, x = knee.x + (hip.x - knee.x) * t, y = knee.y + (hip.y - knee.y) * t;
    const dx = (hip.x - knee.x) / (club.length * .45), dy = (hip.y - knee.y) / (club.length * .45);
    pen.line(x, y, x - dy * 2, y + dx * 2, SHELL, .5);
  }
  out.setPx(hand.x, hand.y, .95, .8, .62);
}

function drawWeaver(p: CreaturePen, ctx: Ctx, e: Readonly<Enemy>): void {
  const loco = e.weaverLoco, tick = ctx.state.frameCount;
  const rig = e.expression ?? QUIET;
  const nx = loco?.nx ?? 0, ny = loco?.ny ?? -1, tx = -ny, ty = nx, face = loco?.face ?? e.mind?.facing ?? 1;
  const bx = loco?.px ?? e.x, by = loco?.py ?? e.y - 10, breath = Math.sin(tick * (.047 + rig.fear * .04) + e.bobPhase) * (.45 + rig.hurt * .25);
  const winding = (e.windup ?? 0) > 0, feeding = (e.weaverFeedT ?? 0) > 0, angle = Math.atan2(ty * face, tx * face);
  const point = (along: number, outward: number) => ({ x: bx + tx * along * face + nx * outward, y: by + ty * along * face + ny * outward });
  const line = (a: number, b: number, c: number, d: number, color: Color, width = .5) => {
    const start = point(a, b), end = point(c, d); p.line(start.x, start.y, end.x, end.y, color, width);
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let i = pass; i < 8; i += 2) {
      const side = i < 4 ? -1 : 1;
      const joints = weaverLegGeometry(e, i), hip = joints[0], foot = joints[4], knee = joints[2];
      if ((e.weaverMissingLegs ?? 0) & (1 << i)) {
        const stump = { x: hip.x + tx * side * face * 2, y: hip.y + ty * side * face * 2 };
        p.line(hip.x, hip.y, stump.x, stump.y, TEAL, 2);
        p.oval(stump.x, stump.y, 1.2, 1.2, [.44, .3, .16]);
        continue;
      }
      const color: Color = pass === 0 ? [.28, .40, .39] : [.62, .71, .64];
      drawLimb(p, joints, color);
      // Coxae overlap the thorax instead of floating around its silhouette.
      p.oval(hip.x, hip.y, 1.9, 1.35, color, angle);
      p.line(knee.x - tx, knee.y - ty, knee.x + tx, knee.y + ty, SILK, .5);
      // Short setae break the limb silhouette without replacing its anchors.
      if (pass === 1) for (let h = 1; h <= 3; h++) {
        const q = h / 5, sx = knee.x + (foot.x - knee.x) * q, sy = knee.y + (foot.y - knee.y) * q;
        p.line(sx, sy, sx + nx * 1.8 + tx * side, sy + ny * 1.8 + ty * side, TEAL, .5);
      }
      if (loco?.legs[i]?.planted) p.line(foot.x - tx, foot.y - ty, foot.x + tx, foot.y + ty, SILK);
    }
    if (pass === 0) {
      const abdomen = point(-8 - (winding ? 2 : 0), breath + 2);
      p.oval(abdomen.x, abdomen.y, 12.5, 8 + breath, SHELL, angle - face * .1, 3);
      for (let i = 0; i < 5; i++) {
        const along = -18 + i * 3.8, height = Math.sin((i + .7) / 6 * Math.PI) * 6;
        const a = point(along, height + 2 + breath), b = point(along + 1.8, -3 + breath), ridge = point(along + 3, 3 + breath);
        p.curve(a.x, a.y, ridge.x, ridge.y, b.x, b.y, INK, .5);
        p.curve(a.x + nx * .5, a.y + ny * .5, ridge.x + nx, ridge.y + ny, b.x + nx, b.y + ny, SILK, .5);
        line(along + 2, -3 + breath, along + 4, -3.5 + breath, TEAL);
      }
      const thorax = point(2, breath); p.oval(thorax.x, thorax.y, 7.5, 5.7, TEAL, angle, 5);
      for (let i = 0; i < 3; i++) { line(-2 + i * 3, 4, i * 3, 1, SHELL); line(i * 3, -2, 2 + i * 3, -3, INK); }
      const spinner = point(-20, -1); p.oval(spinner.x, spinner.y, 2, 1.5, TEAL, angle);
      // Wear is a stable crack in one plate, not changing pixel noise.
      if (rig.hurt > .25) { line(-11, 6, -8, 3, INK); line(-8, 3, -10, 1, INK); line(-8, 3, -5, 2, INK); }
    }
  }
  const head = point(10 + rig.alert * 2 - rig.fear * 3 + (e.weaverHeadX ?? 0) * .4,
    1 + (e.weaverHeadY ?? 0) * .55 - (feeding ? 2 : 0) - rig.hurt);
  p.oval(head.x, head.y, 5.5, 4.6, [.66, .76, .68], angle);
  const hp = (along: number, outward: number): [number, number] => [head.x + tx * along * face + nx * outward, head.y + ty * along * face + ny * outward];
  p.curve(...hp(-2, 3.5), ...hp(1, 2.5), ...hp(3, 0), SILK, .5);
  for (const side of [-1, 1]) {
    const flare = 3 + rig.alert * 3 + rig.fear * 4, tremble = Math.sin(tick * .075 + side) * (1 - rig.alert) + (feeding ? Math.sin(tick * .48) : 0);
    p.curve(...hp(1, side * 2), ...hp(8 - rig.fear * 5, side * flare), ...hp(10 - rig.fear * 7 + tremble, side * (flare + 1)), TEAL);
    const eye = hp(2, side * 1.8);
    p.eye(...eye, 1.5, 1.2 + rig.fear * .4, GOLD, rig, angle);
    const satellite = hp(-.5, side * 3); p.oval(...satellite, .65, .6, INK); p.pixel(satellite[0], satellite[1], SILK, .7);
    const gape = 1.2 + rig.jaw * 3;
    const jawRoot = hp(4, side * 1.5), jawJoint = hp(7, side * gape), fang = hp(9, side * (gape - 1.5));
    p.polygon([jawRoot, hp(6, side * (gape + .8)), jawJoint, fang], [.57, .66, .53]);
    p.curve(...jawRoot, ...jawJoint, ...fang, SHELL, 1);
    p.pixel(fang[0], fang[1], SILK);
  }
  if (feeding || e.blink > 0) { const end = point(17, -7); p.line(head.x, head.y, end.x, end.y, SILK); }
}

function drawRibbon(p: CreaturePen, ctx: Ctx, e: Readonly<Enemy>, maw = false): void {
  const rig = e.expression ?? QUIET;
  // Builder can render a freshly placed, paused resident before its first
  // simulation tick. A temporary resting silhouette never mutates that actor.
  const nodes = e.body?.nodes?.length ? e.body.nodes : createChain(e.x, e.y - 4, e.mind?.facing ?? 1).nodes;
  const tick = ctx.state.frameCount, charged = (e.rillChargeWindup ?? 0) > 0 || e.blink > 0;
  const shell: Color = maw ? [.68, .56, .42] : [.41, .65, .61];
  // Skin follows every physical segment, including a continuous thin tail.
  for (let i = nodes.length - 1; i > 0; i--) {
    const a = nodes[i], b = nodes[i - 1], dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length, steps = Math.max(1, Math.ceil(length / p.step));
    for (let j = 0; j <= steps; j++) {
      const t = j / steps, x = a.x + dx * t, y = a.y + dy * t, radius = a.radius + (b.radius - a.radius) * t + (maw ? 1.3 : .35);
      for (let cross = -Math.ceil(radius); cross <= radius; cross += p.step) {
        const edge = Math.abs(cross) / radius;
        p.pixel(x + nx * cross, y + ny * cross, edge > .9 ? INK : cross > radius * .3 ? SHELL : shell, edge > .9 ? 1 : .55 + .4 * Math.sqrt(Math.max(0, 1 - edge * edge)));
      }
    }
    const ridge = (maw ? 3 : 1.6) + rig.alert * 2 - rig.fear * .6 + (charged ? Math.sin(tick * .3 - i) * 1.5 : 0);
    p.line(b.x - nx * b.radius, b.y - ny * b.radius, b.x - nx * (b.radius + ridge), b.y - ny * (b.radius + ridge), maw ? GOLD : SILK);
    if (charged) p.pixel(b.x, b.y, [.32, .91, .96], 1, true);
    if (maw) p.oval(b.x, b.y - .8, b.radius + .5, 2, [.72, .63, .49], Math.atan2(dy, dx), i);
    const tx = dx / length, ty = dy / length;
    // Overlapping scutes stop at the lateral line; the belly has finer folds.
    p.curve(b.x - nx * b.radius * .65 - tx, b.y - ny * b.radius * .65 - ty,
      b.x - tx * 2.5, b.y - ty * 2.5, b.x + nx * b.radius * .4, b.y + ny * b.radius * .4, TEAL, .5);
    p.line(b.x + nx * b.radius * .65, b.y + ny * b.radius * .65,
      b.x + nx * b.radius * .65 - tx * 2, b.y + ny * b.radius * .65 - ty * 2, [.56, .68, .55], .5);
    if (!maw && (i === 2 || i === 5)) {
      const lift = 3 + rig.alert * 4 + Math.sin(tick * .06 - i) * .5;
      const fin: [number, number][] = [[b.x - nx * b.radius, b.y - ny * b.radius],
        [b.x - nx * (b.radius + lift) - tx * 2, b.y - ny * (b.radius + lift) - ty * 2],
        [a.x - nx * a.radius, a.y - ny * a.radius]];
      p.polygon(fin, [.27, .5, .48]);
      for (let rib = 0; rib < 3; rib++) p.line(b.x - tx * rib, b.y - ty * rib,
        fin[1][0] - tx * rib, fin[1][1] - ty * rib, SILK, .5);
    }
  }
  const head = nodes[0], neck = nodes[1] ?? head, angle = Math.atan2(head.y - neck.y, head.x - neck.x)
    + (maw && (e.mawStun ?? 0) > 0 ? Math.sin(tick * .3) * .12 : 0);
  const tx = Math.cos(angle), ty = Math.sin(angle), nx = -ty, ny = tx;
  const hp = (along: number, cross: number): [number, number] => [head.x + tx * along + nx * cross, head.y + ty * along + ny * cross];
  p.oval(...hp(1.5, 0), maw ? 7.5 : 5.5, maw ? 5 : 3.5, maw ? [.76, .66, .48] : SHELL, angle, 5);
  p.polygon([hp(0, -3), hp(5, -3.2), hp(9, -1), hp(6, .5), hp(1, 1)], maw ? [.65, .56, .40] : [.46, .65, .56]);
  const gape = .7 + rig.jaw * (maw ? 4.5 : 3);
  p.polygon([hp(3, 0), hp(9, -gape), hp(8, gape)], INK);
  for (const side of [-1, 1]) {
    p.curve(...hp(1, side * 2), ...hp(5, side * (gape + 1)), ...hp(9, side * gape), SHELL, 1.5);
    for (let tooth = 0; tooth < 3; tooth++) {
      const along = 5 + tooth * 1.3;
      p.polygon([hp(along, side * gape), hp(along + .8, side * gape), hp(along + .6, side * (gape - (maw ? 1.7 : 1)))], SILK);
    }
    if (!maw) {
      p.eye(...hp(2.5, side * 2), 1.6, 1.2, charged ? [.3, .95, 1] : GOLD, rig, angle);
      const flare = 5 + rig.alert * 4 + Math.sin(tick * .075) * .6 - rig.fear * 2;
      p.polygon([hp(-2, side * 2), hp(-4, side * flare), hp(-7, side * 3)], [.27, .5, .46]);
      for (let gill = 0; gill < 3; gill++) p.curve(...hp(-1 - gill, side * 1.5),
        ...hp(-3 - gill, side * (flare - gill)), ...hp(-6 - gill, side * (3 + gill * .2)), gill === 0 ? SILK : TEAL, .5);
    } else {
      // The blind burrower has vibration pits and a fractured shovel mask.
      p.oval(...hp(0, side * 3), 1.2, .65, INK, angle);
      p.curve(...hp(-1, side * 2), ...hp(-5, side * (6 + rig.alert * 2)), ...hp(-8, side * 4), GOLD);
      p.line(...hp(-1, -3), ...hp(2, -1), INK, .5); p.line(...hp(2, -1), ...hp(1, 1), INK, .5);
    }
  }
}

function drawRootLoper(p: CreaturePen, ctx: Ctx, e: Readonly<Enemy>): void {
  const rig = e.expression ?? QUIET;
  const tick = ctx.state.frameCount, face = e.mind?.facing ?? 1, bx = e.x, by = e.y - 9 + Math.sin(tick * .055 + e.bobPhase) * .5 + rig.fear * 2 + rig.hurt;
  const shell: Color = (e.rootPanic ?? 0) > 0 ? [.65, .43, .27] : [.54, .68, .39];
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1, foot = e.feet?.[i], hx = bx + side * 4, hy = by + (i % 3) * 2;
    const fx = foot?.x ?? bx + side * (13 + i % 3 * 4), fy = foot?.y ?? e.y, kx = (hx + fx) * .5 + side * 2, ky = Math.min(hy, fy) - 5;
    p.curve(hx, hy, kx, ky, fx, fy, TEAL, 2); p.line(kx, ky, fx, fy, shell); p.pixel(fx, fy, SILK);
    p.curve(kx, ky, fx - side * 2, fy - 4, fx + side * 2, fy, [.48, .58, .34], .5);
    if (foot?.planted) for (let root = -1; root <= 1; root++) p.line(fx, fy - 1, fx + root * 2, fy + Math.abs(root), TEAL, .5);
  }
  p.oval(bx - face * 3, by, 10, 6.5, shell, e.vx * .1, 4);
  for (let i = 0; i < 5; i++) p.curve(bx - 10 + i * 3, by - 4,
    bx - 8 + i * 3, by - 1, bx - 9 + i * 3, by + 4, i % 2 ? TEAL : [.62, .7, .4], .5);
  for (let i = 0; i < 6; i++) {
    const x = bx - 7 + i * 2.5, y = by - 4 - Math.sin(i * .8) * 2;
    const lean = (i - 2.5) * (2 + rig.fear * 2) + Math.sin(tick * .025 + i) * (1.5 - rig.alert), tipY = y - (5 + i % 3 * 2) * (1 - rig.fear * .7) + rig.hurt * 2;
    p.curve(x, y + 2, x + lean * .2, tipY - 1, x + lean, tipY, TEAL, 1.5);
    const lx = x + lean, ly = tipY;
    p.polygon([[lx - 4, ly + 2], [lx - 2, ly - 1], [lx + 1, ly - 2], [lx + 5, ly - 1], [lx + 2, ly + 2]], [.57 + i % 2 * .08, .72, .43]);
    p.line(lx - 4, ly + 2, lx + 5, ly - 1, [.72, .79, .47], .5);
    for (let rib = 0; rib < 3; rib++) p.line(lx - 2 + rib * 2, ly + 1 - rib * .5, lx - 2 + rib * 2, ly - 1.5, TEAL, .5);
  }
  const hx = bx + face * (7 + rig.alert * 2 - rig.fear * 5), hy = by - 1 + rig.fear * 2 + rig.gazeY;
  p.oval(hx, hy, 4, 4.5, SHELL, -.2 * face);
  p.eye(hx + face * 1.5, hy - 1, 1.8, 2, [.55, .66, .25], rig);
  p.curve(hx + face, hy + 2, hx + face * 4, hy + 2 + rig.jaw * 2, hx + face * 5, hy + 1, TEAL, .5);
  p.curve(hx, hy - 3, hx + face * 3, hy - 8 - rig.alert * 3, hx + face * 5, hy - 5, TEAL, .5);
  const lash = e.rootLashT ?? 0;
  if (lash > 0 && e.rootLashX !== undefined && e.rootLashY !== undefined) {
    const t = Math.sin(Math.PI * (1 - lash / 10)), ex = hx + (e.rootLashX - hx) * t, ey = hy + (e.rootLashY - hy) * t;
    p.curve(hx, hy, (hx + ex) / 2, hy - 12 * (1 - t), ex, ey, SILK, 2);
  } else if ((e.windup ?? 0) > 0) p.curve(hx, hy, hx - face * 16, hy - 12, hx - face * 8, hy + 2, SILK, 2);
}

function drawInhabitant(p: CreaturePen, ctx: Ctx, e: Readonly<Enemy>): void {
  const rig = e.expression ?? QUIET;
  const def = ctx.enemyCtl.defs[e.kind], tick = ctx.state.frameCount, x = e.x, y = e.y;
  const face = e.mind?.facing ?? Math.sign(e.vx || 1), breath = Math.sin(tick * .06 + e.bobPhase), winding = (e.windup ?? 0) > 0;
  if (e.kind === 'slime' || e.kind === 'acidslime' || e.kind === 'bomber' || e.kind === 'eggs') {
    const acid = e.kind === 'acidslime', bomber = e.kind === 'bomber';
    const color: Color = bomber ? [.77, .5, .24] : acid ? [.63, .74, .29] : [.44, .65, .56];
    if (e.kind === 'eggs') {
      for (let i = 0; i < 4; i++) {
        const sx = x + (i - 1.5) * 4, sy = y - 3 - i % 2 * 2, pulse = Math.sin(tick * .04 + i) * .25;
        p.oval(sx, sy, 3.5 + pulse, 5, SHELL, (i - 1.5) * .15);
        p.oval(sx, sy - 1, 1.5, 2.5, TEAL);
        p.curve(sx - 2, sy - 3, sx + .5, sy - 4, sx + 2, sy, SILK, .5);
        p.curve(sx, sy, sx - 2, sy + 1, sx, sy + 3, [.28, .48, .43], .5);
        if (rig.hurt > .3) p.line(sx - 1, sy - 4, sx + 1, sy - 1, INK, .5);
      }
      return;
    }
    const squash = (e.grounded ? 1 + Math.min(.4, e.splat * .035) + breath * .025 : 1 / (1 + Math.min(.35, Math.abs(e.vy) * .1))) + rig.fear * .14 + (winding ? .15 : 0);
    const radius = def.halfW * squash, h = def.h / squash;
    p.oval(x, y - h / 2, radius + 1, h / 2 + 1, color, 0, 7);
    for (let i = 0; i < 3; i++) p.oval(x - radius + 2 + i * (radius - 2), y - 1, 3, 2, TEAL);
    for (let i = 0; i < 3; i++) p.oval(x - face * (radius * .35 + i % 2), y - h * (.3 + i * .17), .7 + i % 2 * .3, .8, i % 2 ? TEAL : SHELL);
    p.curve(x - radius * .6, y - h * .65, x - radius * .4, y - h, x, y - h * .9, SILK, .5);
    p.eye(x + face * (radius * .4 + rig.alert * .6), y - h * .65 - rig.alert * .5, 2.3, 2.4 + rig.fear * .5, bomber ? GOLD : acid ? [.51, .58, .2] : TEAL, rig);
    p.curve(x + face * radius * .35, y - h * .3, x + face * (radius - 1), y - h * .3 + 1 + rig.jaw * 2, x + face * radius * .85, y - h * .4, INK, .5);
    if (bomber) {
      p.oval(x - face * 2, y - h * .5, 1.4 + rig.alert * .8 + breath * .15, 2 + rig.alert, GOLD);
      for (let i = 0; i < 3; i++) p.curve(x - face * 2, y - h * .5, x - radius + i * 2, y - h * .4, x - radius + i * 3, y - h * .2, [.42, .31, .21], .5);
    }
  } else if (e.kind === 'wisp') {
    const drift = Math.sin(tick * .05 + e.bobPhase);
    for (let i = 0; i < 5; i++) p.curve(x - 4 + i * 2, y - 3, x + Math.sin(tick * .07 + i) * 6, y + 5, x - e.vx * 3 + Math.sin(tick * .06 + i) * 4, y + 7 + i % 3 * 3, [.25, .57, .59]);
    const bellY = y - 5 + rig.fear * 2;
    p.oval(x, bellY, 6 + drift * .5 + rig.alert, 4 - rig.fear, [.44, .78, .76]);
    for (let i = -1; i <= 1; i++) p.curve(x + i, bellY - 3, x + i * 4, bellY - 2, x + i * 4, bellY + 2, SILK, .5);
    p.eye(x + rig.gazeX, bellY - .5, 1.8, 1.8 + rig.alert * .4, [.45, .8, .84], rig);
    for (let i = -2; i <= 2; i++) p.oval(x + i * 2, bellY + 2, .65, .7, SILK);
  } else if (e.kind === 'bat' || e.kind === 'imp') {
    const folded = e.sleeping || (e.slimed ?? 0) > 0, flame = e.kind === 'imp', flap = Math.sin(tick * .31 + e.bobPhase);
    const tumble = (e.tumble ?? 0) > 0 ? Math.sin(tick * .24) : 0;
    const span = folded ? 4 : 13 + Math.abs(e.vx) * 2 - rig.fear * 3, lift = folded ? -8 : flap * (10 - rig.hurt * 3) - rig.alert * 3;
    for (const side of [-1, 1]) {
      const tipX = x + side * span, tipY = y - 5 + lift + side * tumble * 9;
      p.polygon([[x, y - 6], [x + side * span * .55, tipY - 5], [tipX, tipY], [tipX - side * 4, tipY + 2], [x + side * 6, y + 3], [x, y - 1]], flame ? [.56, .35, .26] : [.24, .41, .40]);
      for (let rib = 0; rib < 3; rib++) p.curve(x, y - 5, x + side * (span * .5 + rib), tipY - 4 + rib * 2, tipX - side * rib * 3, tipY + rib * 2, flame ? [.68, .5, .32] : [.53, .64, .57]);
      for (let vein = 0; vein < 3; vein++) {
        const rootX = x + side * (5 + vein * 2), rootY = y - 5 + lift * .55 + vein;
        p.curve(rootX, rootY, rootX + side * 2, rootY + 2, tipX - side * (2 + vein * 2), tipY + 1 + vein, flame ? [.4, .25, .22] : [.18, .32, .32], .5);
      }
      p.line(x, y - 6, tipX, tipY, flame ? GOLD : SHELL);
      p.oval(x + side * span * .55, tipY - 4, 1.2, 1, flame ? GOLD : SHELL);
      if (rig.hurt > .3 && side === -1) p.polygon([[tipX - side * 2, tipY + 1], [tipX - side * 4, tipY - 2], [tipX - side * 5, tipY + 3]], INK);
    }
    p.oval(x, y - 4, 3.5, 5, flame ? [.65, .42, .25] : SHELL, e.vx * .08 + tumble * .6); p.oval(x + face, y - 7, 2.5, 2.2, flame ? [.73, .54, .35] : TEAL);
    for (const side of [-1, 1]) {
      p.polygon([[x + side, y - 8], [x + side * (3.3 + rig.fear * 2), y - (flame ? 14 : 12) + rig.fear * 3], [x + side * 3, y - 7]], flame ? GOLD : SHELL);
      p.line(x + side * 2, y - 8, x + side * (2.8 + rig.fear), y - 11 + rig.fear * 2, TEAL, .5);
      p.line(x + side * 1.5, y - 1, x + side * 2.5, y + 2, TEAL); p.pixel(x + side * 3, y + 2, SHELL);
    }
    p.eye(x + face * 1.8, y - 7, 1.3, 1.4 + rig.fear * .3, flame ? GOLD : [.61, .69, .4], rig);
    p.curve(x + face, y - 5, x + face * 3, y - 4 + rig.jaw, x + face * 3.5, y - 6, INK, .5);
    if (flame) { const tail = x - face * 9 + Math.sin(tick * .07) * 3; p.curve(x, y, tail, y + 8, tail - face * 4, y + 1, TEAL); p.oval(tail - face * 4, y + 1, 1.5, 3, GOLD, -.3 * face); }
  } else if (e.kind === 'spitter') {
    const recoil = Math.min(1, (e.recoil ?? 0) / 10), step = Math.sin(tick * .22) * Math.min(1, Math.abs(e.vx));
    p.oval(x - face * (2 + recoil), y - 5 + breath * .2, 9 + recoil, 6 - recoil, TEAL, -.1 * face, 5);
    for (const side of [-1, 1]) {
      const lift = Math.max(0, side * step) * 2, footX = x + side * 9 + step * 2;
      p.oval(x + side * 7, y - 3 - lift, 4, 3.5, SHELL, side * .4);
      p.line(x + side * 8, y - 2 - lift, footX, y - lift, TEAL, 2);
      for (let toe = 0; toe < 3; toe++) p.line(footX, y - lift, footX + face * (1 + toe), y - lift - toe % 2, SHELL, .5);
    }
    const hx = x + face * (6 - rig.fear * 2 - recoil * 3), hy = y - 8 + rig.fear;
    p.oval(hx, hy, 5, 4, SHELL, -.15 * face);
    p.oval(x + face * 9, y - 6, 2.5 + rig.jaw * 2, 2 + rig.jaw * 2, [.68, .62, .37]);
    for (let fold = 0; fold < 3; fold++) p.curve(x + face * (7 + fold), y - 7, x + face * (8 + fold), y - 4 + rig.jaw, x + face * (9 + fold), y - 6, [.45, .46, .25], .5);
    p.eye(hx + face * 1.5, hy - 2, 2, 1.8, GOLD, rig);
    p.curve(x - face * 6, y - 7, x - face * 2, y - 10, x + face * 3, y - 7, SHELL, .5);
  } else if (e.kind === 'mage') {
    const sway = Math.sin(tick * .04 + e.bobPhase) * 2;
    p.polygon([[x - 4, y - 17], [x + 4, y - 17], [x + 8 + sway, y - 1], [x + 2, y - 3], [x - 2, y - 1], [x - 8 + sway, y - 2]], [.34, .48, .46]);
    p.curve(x - 2, y - 16, x - 2 + sway, y - 8, x - 4 + sway, y - 2, SILK);
    p.oval(x + face, y - 17, 4.8, 5.2, SHELL); p.oval(x + face * 2, y - 17, 2.8, 3, INK);
    p.eye(x + face * 2.5, y - 17, 1.1, 1.4, GOLD, rig);
    for (let fold = -1; fold <= 1; fold++) p.curve(x + fold * 2, y - 12, x + fold * 3 + sway, y - 6, x + fold * 5 + sway, y - 2, fold < 0 ? TEAL : [.45, .6, .53], .5);
    p.line(x, y - 11, x + face, y - 8, GOLD, .5);
    for (const side of [-1, 1]) {
      const handY = y - 9 + Math.sin(tick * .055 + side) * 2 - rig.alert * 5 + rig.hurt * 2;
      p.curve(x + side * 3, y - 13, x + side * 8, y - 6, x + side * (10 - rig.fear * 3), handY, TEAL, 1.5);
      p.oval(x + side * (10 - rig.fear * 3), handY, 2, 1.5, SHELL);
      for (let finger = 0; finger < 3; finger++) p.line(x + side * (9 + finger - rig.fear * 3), handY, x + side * (9 + finger - rig.fear * 3), handY - 2 - rig.alert, SILK, .5);
      p.pixel(x + side * (10 - rig.fear * 3), handY - 3, [.64, .79, .93], 1, true);
    }
  } else if (e.kind === 'leviathan') {
    const wave = Math.sin(tick * .045 + e.bobPhase);
    const section = (i: number): [number, number, number] => [x - face * i * 4, y - 10 + Math.sin(i * .4 - tick * .08) * i * .4, Math.max(1.5, 9 - i * .65)];
    for (let i = 11; i > 0; i--) {
      const a = section(i), b = section(i - 1);
      for (let along = 0; along <= 4; along += p.step) {
        const t = along / 4, sx = a[0] + (b[0] - a[0]) * t, sy = a[1] + (b[1] - a[1]) * t, radius = a[2] + (b[2] - a[2]) * t;
        for (let cross = -Math.ceil(radius); cross <= radius; cross += p.step) {
          const q = Math.abs(cross) / radius;
          if (q > 1) continue;
          p.pixel(sx, sy + cross, q > .94 ? INK : cross > radius * .45 ? SHELL : TEAL, .55 + Math.sqrt(1 - q * q) * .3);
        }
      }
      p.curve(b[0], b[1] - b[2] * .75, b[0] - face * 3, b[1], b[0] - face, b[1] + b[2] * .5, [.15, .36, .35], .5);
      p.line(b[0] - face, b[1] + b[2] * .55, b[0] - face * 3, b[1] + b[2] * .65, [.54, .65, .54], .5);
      if (i < 8) p.polygon([[b[0], b[1] - b[2]], [b[0] - face * 3, b[1] - b[2] - 4 - rig.alert * 2], [b[0] - face * 5, b[1] - b[2] + 1]], SHELL);
      if (i % 3 === 0) for (let s = 0; s < 3; s++) p.line(b[0] - face * s, b[1] - 2 + s, b[0] - face * (s + 1), b[1] - 1 + s, [.36, .55, .48], .5);
    }
    p.oval(x + face * 5, y - 12, 9, 7, SHELL, wave * .05);
    p.polygon([[x + face * 8, y - 17], [x + face * 18, y - 10], [x + face * 8, y - 9]], [.57, .68, .58]);
    p.polygon([[x + face * 7, y - 10], [x + face * 17, y - 10], [x + face * 13, y - 7 + rig.jaw * 4]], INK);
    p.curve(x + face * 5, y - 7, x + face * 12, y - 5 + rig.jaw * 4, x + face * 17, y - 9, SHELL, 2);
    for (let tooth = 0; tooth < 5; tooth++) p.polygon([[x + face * (8 + tooth * 1.5), y - 10], [x + face * (9 + tooth * 1.5), y - 10], [x + face * (8.5 + tooth * 1.5), y - 8 + tooth % 2]], SILK);
    p.eye(x + face * 8, y - 15, 2.4, 2.2, GOLD, rig);
    for (let gill = 0; gill < 3; gill++) p.curve(x - face * gill * 2, y - 17, x - face * (gill * 2 + 2), y - 10, x - face * gill * 2, y - 5 + rig.alert, [.35, .5, .42], .5);
    const lureX = x + face * 11 + wave * 2, lureY = y - 29;
    p.curve(x + face * 3, y - 18, x + face * 2, y - 36, lureX, lureY, TEAL);
    p.oval(lureX, lureY, 2, 2.5, SILK); p.pixel(lureX, lureY, [.5, .9, 1], 1, true);
  } else {
    const heavy = e.kind === 'golem' || e.kind === 'colossus', scale = e.kind === 'colossus' ? 1.9 : 1, body: Color = heavy ? [.59, .60, .49] : [.42, .53, .48];
    const stride = Math.sin(e.stride ?? 0), height = def.h, shoulder = y - height * .7 + rig.hurt * 1.5;
    for (const side of [-1, 1]) {
      const footX = x + side * (4 + stride * 3) * scale;
      p.line(x + side * 3 * scale, y - height * .35, footX, y - Math.max(0, side * stride * 2), TEAL, 2); p.oval(footX + face, y - 1, 3 * scale, 2 * scale, body);
      const punch = side === face ? Math.min(1, (e.punching ?? 0) / 6) : 0;
      const handX = x + side * (10 + punch * 6 - rig.fear * 2) * scale, handY = y - height * .3 + side * stride * 2 - punch * 5;
      p.line(x + side * 6 * scale, shoulder, handX, handY, TEAL, 2 * scale);
      p.polygon([[handX - 2 * scale, handY - 2 * scale], [handX + 2 * scale, handY - 3 * scale], [handX + 3 * scale, handY], [handX + 1 * scale, handY + 3 * scale], [handX - 3 * scale, handY + scale]], body);
      p.line(handX - 2 * scale, handY - 2 * scale, handX + 2 * scale, handY - 3 * scale, SHELL, .5);
      for (let finger = -1; finger <= 1; finger++) p.line(handX + finger * scale, handY + scale, handX + finger * scale, handY + 2.5 * scale, INK, .5);
    }
    p.polygon([[x - 6 * scale, shoulder - 2 * scale], [x + 3 * scale, shoulder - 4 * scale], [x + 7 * scale, shoulder], [x + 6 * scale, y - height * .25], [x + 2 * scale, y - height * .19], [x - 5 * scale, y - height * .28], [x - 7 * scale, shoulder + 3 * scale]], body);
    p.line(x - 6 * scale, shoulder - 2 * scale, x + 3 * scale, shoulder - 4 * scale, SHELL, .5);
    for (const side of [-1, 1]) {
      p.line(x + side * 5 * scale, shoulder, x + side * 4 * scale, shoulder + 5 * scale, INK, .5);
      p.line(x + side * 4 * scale, shoulder + 5 * scale, x + side * 6 * scale, shoulder + 7 * scale, INK, .5);
      p.line(x + side * 4.5 * scale, shoulder + scale, x + side * 3.5 * scale, shoulder + 4 * scale, SHELL, .5);
      if (rig.hurt > .3) p.line(x + side * 4 * scale, shoulder + 5 * scale, x + side * 2 * scale, shoulder + 8 * scale, GOLD, .5);
    }
    // A small embedded head and a ribbed furnace distinguish mineral hulks
    // from the robed, floating mage. The kiln's visible heat follows wetness.
    p.oval(x + face * 1.5, y - height * .83, 3.5 * scale, 3 * scale, [.5, .58, .51]);
    p.line(x - 2 * scale, y - height * .86, x + 3 * scale, y - height * .86, INK, 2);
    p.eye(x + face * 2 * scale, y - height * .86, .9 * scale, (.6 + rig.alert * .4) * scale, GOLD, rig);
    p.oval(x, y - height * .55, 3.4 * scale, 4.5 * scale, INK);
    for (let i = -1; i <= 1; i++) p.line(x + i * 2 * scale, y - height * .55 - 3 * scale, x + i * 2 * scale, y - height * .55 + 3 * scale, e.status.wet > 0 ? TEAL : GOLD, scale);
    for (const side of [-1, 1]) for (let i = 0; i < (e.kind === 'colossus' ? 3 : 1); i++) {
      const sx = x + side * (6 + i) * scale, sy = shoulder + i * scale * 2;
      p.polygon([[sx - 3 * scale, sy], [sx - 2 * scale, sy - 2 * scale], [sx + 2 * scale, sy - 2.5 * scale], [sx + 3.5 * scale, sy + scale], [sx, sy + 2 * scale]], [.64, .54, .39]);
      p.line(sx - 2 * scale, sy - 2 * scale, sx + 2 * scale, sy - 2.5 * scale, SHELL, .5);
      p.line(sx, sy - 2 * scale, sx + scale, sy, INK, .5);
    }
  }
}

export function drawCreatureSprite(out: PixelSurface, light: LightField, ctx: Ctx, e: Readonly<Enemy>): void {
  const pen = new CreaturePen(out, light, ctx, e);
  if (e.kind === 'weaver') drawWeaver(pen, ctx, e);
  else if (e.kind === 'rillback' || e.kind === 'stonemaw') drawRibbon(pen, ctx, e, e.kind === 'stonemaw');
  else if (e.kind === 'rootloper') drawRootLoper(pen, ctx, e);
  else drawInhabitant(pen, ctx, e);
}

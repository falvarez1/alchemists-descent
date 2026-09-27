import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { IMP, IMP_BODY, IMP_HEAD } from '@/creatures/species/imp';
import { chainTube } from './anatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import type { SpeciesArt } from './types';

/**
 * Imp: charcoal chitin split by magma seams, a blur of amber wings, ember
 * tentacles, and a fireball swelling between its claws before each throw.
 */
const CHAR = 1, HOT = 2, WING = 3, HORN = 4, EYE = 5, FIRE = 6, CLAW = 7;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x070404, 0x150b08, 0x2c1810, 0x4a2a1a, 0x74482c], gloss: 0.3, shine: 14, rim: 0.8, outline: 0x040202 }),
  material({ keys: [0x4a0e00, 0xb03a06, 0xff8a1e, 0xffd27a, 0xfff4d0], emissive: 1, glow: 0x6a2004, glowK: 0.8 }),
  material({ keys: [0x3a1606, 0x8a4a14, 0xd08a30, 0xffd890], translucent: 0.84, emissive: 0.55, glow: 0x1a0a02, glowK: 0.4, rim: 0.2 }),
  material({ keys: [0x100a08, 0x2a1c14, 0x524034, 0x8a7460], rim: 0.6, gloss: 0.4, outline: 0x060403 }),
  material({ keys: [0x6a3a00, 0xffb020, 0xfff2a0, 0xffffff], emissive: 1, glow: 0x7a4a08, glowK: 1 }),
  material({ keys: [0x7a1e00, 0xff7a10, 0xffd060, 0xffffe8], emissive: 1, glow: 0xb05010, glowK: 1.4 }),
  material({ keys: [0x1a1210, 0x3a2e28, 0x6a5a4a], outline: 0x060403 }),
];

export const impArt: SpeciesArt = {
  selfLit: true,
  materials: () => MATS,
  bounds(e, rig) {
    let x0 = e.x - 12, x1 = e.x + 12, y0 = e.y - 22, y1 = e.y + 4;
    for (const p of rig.pts) { x0 = Math.min(x0, p.x - 10); x1 = Math.max(x1, p.x + 10); y0 = Math.min(y0, p.y - 10); }
    for (const c of rig.chains) for (const p of c.pts) { x0 = Math.min(x0, p.x - 3); x1 = Math.max(x1, p.x + 3); y0 = Math.min(y0, p.y - 3); y1 = Math.max(y1, p.y + 3); }
    return [x0, y0, x1, y1];
  },
  lightProbe: (_e, rig) => [rig.pts[IMP_BODY].x, rig.pts[IMP_BODY].y, 9],
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, tick = ctx.state.frameCount;
    const body = rig.pts[IMP_BODY], head = rig.pts[IMP_HEAD];
    const fs = F[IMP.face] >= 0 ? 1 : -1, tilt = F[IMP.tilt];
    // Ember tentacles (behind): charcoal cords whose tips are live coals.
    for (let i = 0; i < 3; i++) {
      const c = rig.chains[i];
      chainTube(r, c, -3, CHAR, { group: 2 }, 0.7 - i * 0.08, 0.18);
      const tip = c.pts[c.pts.length - 1], mid = c.pts[3];
      r.glowStamp(tip.x, tip.y, 1.0, 1.0, 0, HOT, 2.6 + Math.sin(tick * 0.3 + i) * 0.6, 0.6, 2);
      r.glowStamp(mid.x, mid.y, 0.6, 0.6, 0, HOT, 1.5, 0.2, 2);
    }
    // Wings: two pairs buzzing too fast to see — each is a glowing blur fan.
    const buzz = F[IMP.buzz];
    // A dead imp's wings are burnt off: no blur.
    for (const pair of e.hp > 0 ? [0, 1] : []) {
      for (const side of [-1, 1]) {
        const a = -Math.PI / 2 + side * (0.85 + pair * 0.6) + Math.sin(buzz + pair * 1.7) * 0.12 + tilt * 0.4;
        const L = 7.8 - pair * 2.2, W = 2.3 - pair * 0.5;
        const rx0 = body.x + side * 0.6, ry0 = body.y - 1.8;
        const cx = rx0 + Math.cos(a) * L * 0.5, cy = ry0 + Math.sin(a) * L * 0.5;
        r.ellipse(cx, cy, L * 0.52, W, a, -2 + pair, WING, { group: 3, noOutline: true, depth: 0.25 });
        // A crisp leading-edge vein is the only hard line in the blur.
        r.stroke(rx0, ry0, rx0 + Math.cos(a - side * 0.12) * L * 0.95, ry0 + Math.sin(a - side * 0.12) * L * 0.95, WING, 3, true);
      }
    }
    // Abdomen hangs below the thorax, banded, with magma seams.
    const abx = body.x - fs * 0.6 - tilt * 1.2, aby = body.y + 2.6;
    const abAng = Math.PI / 2 + tilt * 0.6 - fs * 0.15;
    r.ellipse(abx, aby, 3.2, 2.1, abAng, 0, CHAR, { group: 1 });
    for (let s = 0; s < 3; s++) {
      const t = -0.8 + s * 1.1;
      r.glowStamp(abx + Math.cos(abAng) * t, aby + Math.sin(abAng) * t, 1.7, 0.32, abAng + Math.PI / 2, HOT, 1.6 + Math.sin(tick * 0.12 + s) * 0.4, 0.4, 1);
    }
    r.ellipse(body.x, body.y, 2.5, 2.8, tilt * 0.5, 1, CHAR, { group: 1 });
    r.glowStamp(body.x + fs * 0.4, body.y + 0.3, 0.9, 1.4, tilt, HOT, 1.4 + F[IMP.charge] * 1.4, 0, 1);
    // Clawed arms.
    for (let i = 0; i < 2; i++) {
      const c = rig.chains[3 + i];
      chainTube(r, c, 2, CHAR, { group: 4 + i }, 0.6, 0.38);
      const tip = c.pts[c.pts.length - 1], prev = c.pts[c.pts.length - 2];
      const dx = tip.x - prev.x, dy = tip.y - prev.y, d = Math.hypot(dx, dy) || 1;
      for (const s of [-1, 1]) r.capsule(tip.x, tip.y, 0.35, tip.x + dx / d * 1.1 - dy / d * s * 0.6, tip.y + dy / d * 1.1 + dx / d * s * 0.6, 0.18, 2.5, 2.5, CLAW, { group: 4 + i });
    }
    // Head with swept horns and slit eyes.
    const hAng = tilt * 0.6 + fs * 0.1;
    r.ellipse(head.x, head.y, 2.1, 1.9, hAng, 3, CHAR, { group: 1 });
    r.ellipse(head.x + fs * 1.2, head.y + 0.5, 1.3, 1.0, hAng, 3, CHAR, { group: 1 });
    for (const s of [-1, 1]) {
      const bx = head.x + s * 0.9 - fs * 0.2, by = head.y - 1.3;
      const mx = bx + s * 1.6 - fs * 1.4, my = by - 1.9, tx = mx - fs * 1.8 + s * 0.4, ty = my - 0.6;
      r.capsule(bx, by, 0.6, mx, my, 0.42, 3.5 + (s === fs ? 1 : -1), 3.5, HORN, { group: 6, far: s !== fs });
      r.capsule(mx, my, 0.42, tx, ty, 0.14, 3.5, 3.5, HORN, { group: 6, far: s !== fs });
    }
    const ex = head.x + fs * 0.9, ey = head.y - 0.2;
    r.stamp(ex, ey, 0.7, 0.38, fs * 0.35, EYE, 2, true);
    r.stamp(ex - fs * 1.1, ey - 0.1, 0.5, 0.3, fs * 0.35, EYE, 1, true);
    // Mouth glows as the fire rises in it.
    const charge = F[IMP.charge];
    if (charge > 0.1 || F[IMP.throwT] > 0) r.glowStamp(head.x + fs * 1.6, head.y + 0.9, 0.7, 0.4, 0, HOT, 1 + charge * 2, 0.5, 1);
    // The fireball swelling between the claws.
    if (charge > 0.05) {
      const a = rig.chains[3].pts[2], b = rig.chains[4].pts[2];
      const fx = (a.x + b.x) * 0.5 + fs * 0.6, fy = (a.y + b.y) * 0.5;
      const rad = 0.6 + charge * 2.1 + Math.sin(tick * 0.6) * 0.15 * charge;
      r.ellipse(fx, fy, rad, rad, 0, 8, FIRE, { group: 7, noOutline: true });
      r.glowStamp(fx, fy, rad, rad, 0, FIRE, 3, 1.2, 7);
    }
  },
};

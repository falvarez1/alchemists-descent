import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { MG, MG_CHEST, MG_FAR_ARM, MG_HEAD, MG_NEAR_ARM, MG_PELVIS } from '@/creatures/species/mage';
import { markEye, POLY } from './anatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import type { SpeciesArt } from './types';

/**
 * Mage: a gaunt masked shaman. Bone mask with a painted glyph that burns
 * violet when it reaches for the level, a tattered cape, a charm-hung staff,
 * rubble orbiting its raised hands mid-cast.
 */
const SKIN = 1, CLOTH = 2, MASK = 3, GLYPH = 4, WOOD = 5, EYE = 6, DUST = 7, WRAP = 8;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x0a080e, 0x1a1624, 0x2e2840, 0x4c4462, 0x786e92], rim: 0.85, gloss: 0.2, outline: 0x050408 }),
  material({ keys: [0x0a0c0b, 0x18201c, 0x2a3830, 0x44564a, 0x6a7e6c], rim: 0.5, outline: 0x040505 }),
  material({ keys: [0x2a241a, 0x6a604a, 0xb4a888, 0xe4dcc2, 0xfffaf0], rim: 0.6, gloss: 0.25, shine: 12, outline: 0x100c08 }),
  material({ keys: [0x2a0a52, 0x7a2ae0, 0xc084ff, 0xf0dcff], emissive: 1, glow: 0x3a1080, glowK: 0.9 }),
  material({ keys: [0x100a06, 0x2a1c10, 0x4a3420, 0x70563a], rim: 0.5, outline: 0x060403 }),
  material({ keys: [0x3a1470, 0xb070ff, 0xffffff], emissive: 1, glow: 0x2a0a60, glowK: 0.8 }),
  material({ keys: [0x1a1814, 0x3a3630, 0x5e5850, 0x8a8278], rim: 0.5, outline: 0x080706 }),
  material({ keys: [0x1a1008, 0x3a2410, 0x6a4420, 0x9a6a38], rim: 0.4, outline: 0x080503 }),
];

export const mageArt: SpeciesArt = {
  selfLit: true,
  materials: () => MATS,
  bounds(e, rig) {
    let x0 = e.x - 12, x1 = e.x + 12, y0 = e.y - 26, y1 = e.y + 3;
    for (const p of rig.pts) { x0 = Math.min(x0, p.x - 8); x1 = Math.max(x1, p.x + 8); y0 = Math.min(y0, p.y - 9); }
    for (const l of rig.legs) { x0 = Math.min(x0, l.x - 5); x1 = Math.max(x1, l.x + 5); y0 = Math.min(y0, l.y - 6); }
    for (const c of rig.chains) for (const p of c.pts) { x0 = Math.min(x0, p.x - 2); x1 = Math.max(x1, p.x + 2); y1 = Math.max(y1, p.y + 2); }
    x0 = Math.min(x0, rig.f[MG.staffX] - 3); x1 = Math.max(x1, rig.f[MG.staffX] + 3); y0 = Math.min(y0, rig.f[MG.staffY] - 16);
    return [x0, y0, x1, y1];
  },
  lightProbe: (_e, rig) => [rig.pts[MG_CHEST].x, rig.pts[MG_CHEST].y, 10],
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, tick = ctx.state.frameCount;
    const pelvis = rig.pts[MG_PELVIS], chest = rig.pts[MG_CHEST], head = rig.pts[MG_HEAD];
    const fs = F[MG.face] >= 0 ? 1 : -1;
    const cast = F[MG.cast];
    // Far leg.
    const leg = (i: number, z: number, far: boolean): void => {
      const l = rig.legs[i];
      const hx = pelvis.x + (i === 0 ? fs * 0.5 : -fs * 0.5), hy = pelvis.y + 0.4;
      const o = { group: 10 + i, far };
      r.capsule(hx, hy, 1.15, l.kx, l.ky, 0.8, z, z, SKIN, o);
      r.capsule(l.kx, l.ky, 0.8, l.x, l.y - 0.7, 0.55, z, z, SKIN, o);
      r.capsule(l.x - fs * 0.4, l.y - 0.5, 0.55, l.x + fs * 1.5, l.y - 0.35, 0.35, z, z, SKIN, o);
    };
    leg(1, -6, true);
    // Staff behind the body, gripped by the far hand.
    const sx = F[MG.staffX], sy = F[MG.staffY], topX = sx + fs * 0.7, topY = sy - 14;
    const far = rig.legs[MG_FAR_ARM];
    const staffTopX = cast > 0.5 ? far.x + fs * 0.4 : topX, staffTopY = cast > 0.5 ? far.y - 6.5 : topY;
    const staffBotX = cast > 0.5 ? far.x - fs * 0.2 : sx, staffBotY = cast > 0.5 ? far.y + 7 : sy - 0.5;
    r.capsule(staffBotX, staffBotY, 0.45, staffTopX, staffTopY, 0.6, -4, -4, WOOD, { group: 20, far: true });
    r.capsule(staffTopX, staffTopY, 0.6, staffTopX - fs * 1.4, staffTopY - 1.2, 0.4, -4, -4, WOOD, { group: 20, far: true });
    r.ellipse(staffTopX - fs * 0.5, staffTopY + 0.6, 0.9, 1.1, 0, -3, GLYPH, { group: 21 });
    r.glowStamp(staffTopX - fs * 0.5, staffTopY + 0.6, 0.9, 1.1, 0, GLYPH, 1 + cast * 2, 0.4, 21);
    for (let k = 0; k < 2; k++) r.capsule(staffTopX - fs * (0.6 + k), staffTopY - 0.5, 0.25, staffTopX - fs * (0.8 + k) + Math.sin(tick * 0.05 + k) * 0.4, staffTopY + 2.6 + k, 0.2, -3.5, -3.5, WRAP, { group: 22 });
    // Far arm.
    const arm = (i: number, z: number, farArm: boolean): void => {
      const a = rig.legs[i];
      const near = i === MG_NEAR_ARM;
      const shx = chest.x + (near ? fs * 0.6 : -fs * 0.4), shy = chest.y + 0.8;
      const o = { group: 12 + i, far: farArm };
      r.capsule(shx, shy, 0.85, a.kx, a.ky, 0.6, z, z, SKIN, o);
      r.capsule(a.kx, a.ky, 0.6, a.x, a.y, 0.5, z, z, SKIN, o);
      r.ellipse(a.x, a.y, 0.75, 0.65, 0, z + 0.3, SKIN, o);
      for (let f = -1; f <= 1; f++) {
        const dx = a.x - a.kx, dy = a.y - a.ky, d = Math.hypot(dx, dy) || 1;
        r.capsule(a.x, a.y, 0.3, a.x + dx / d * 1.3 - dy / d * f * 0.6, a.y + dy / d * 1.3 + dx / d * f * 0.6, 0.18, z + 0.3, z + 0.3, SKIN, o);
      }
      if (cast > 0.2) r.glowStamp(a.x, a.y, 0.9, 0.9, 0, GLYPH, cast * 3, 0.6, 12 + i);
      // Cloth wraps on the forearm.
      r.stamp((a.kx + a.x) / 2, (a.ky + a.y) / 2, 0.7, 0.5, Math.atan2(a.y - a.ky, a.x - a.kx), WRAP, 1, false, 12 + i);
    };
    arm(MG_FAR_ARM, -3, true);
    // Cape: a tattered sheet hung between the three cloth chains.
    const c0 = rig.chains[0].pts, c2 = rig.chains[2].pts, c1 = rig.chains[1].pts;
    let k = 0;
    for (let i = 0; i < c0.length; i++) { POLY[k++] = c0[i].x; POLY[k++] = c0[i].y; }
    // Ragged hem: tip of each chain, notches between.
    POLY[k++] = (c0[c0.length - 1].x + c1[c1.length - 1].x) / 2; POLY[k++] = (c0[c0.length - 1].y + c1[c1.length - 1].y) / 2 - 1.4;
    POLY[k++] = c1[c1.length - 1].x; POLY[k++] = c1[c1.length - 1].y + 0.6;
    POLY[k++] = (c1[c1.length - 1].x + c2[c2.length - 1].x) / 2; POLY[k++] = (c1[c1.length - 1].y + c2[c2.length - 1].y) / 2 - 1.1;
    for (let i = c2.length - 1; i >= 0; i--) { POLY[k++] = c2[i].x; POLY[k++] = c2[i].y; }
    r.poly(POLY, k / 2, -1, CLOTH, 0.9, { group: 2 });
    for (let i = 1; i < c1.length; i++) r.shade(c1[i].x, c1[i].y, 0.5, 1.0, 0, -0.9, 2, 0.4);
    // Torso: gaunt, wrapped at the waist.
    r.capsule(pelvis.x, pelvis.y, 1.7, chest.x, chest.y, 2.2, 0, 0.5, SKIN, { group: 1 });
    r.stamp((pelvis.x * 2 + chest.x) / 3, (pelvis.y * 2 + chest.y) / 3, 2.0, 1.0, Math.atan2(chest.y - pelvis.y, chest.x - pelvis.x) + Math.PI / 2, WRAP, 1, false, 1);
    // Shawl over the shoulders.
    r.ellipse(chest.x - fs * 0.5, chest.y + 0.2, 2.8, 1.6, fs * 0.25, 1.2, CLOTH, { group: 3 });
    leg(0, 3, false);
    // Neck and masked head.
    r.capsule(chest.x + fs * 0.4, chest.y - 0.8, 0.8, head.x, head.y + 1.2, 0.7, 1.5, 2, SKIN, { group: 1 });
    r.ellipse(head.x - fs * 0.3, head.y, 2.0, 2.2, 0, 3, SKIN, { group: 4 });
    // Plumes: two quills rising from behind the mask.
    for (let q = 0; q < 2; q++) {
      const bx = head.x - fs * (0.8 + q * 0.6), by = head.y - 1.6;
      const sway = Math.sin(tick * 0.06 + q * 1.4 + e.bobPhase) * 0.5;
      r.capsule(bx, by, 0.4, bx - fs * (2.2 + q) + sway, by - 4.2 + q * 0.8, 0.12, 2.5, 2.5, MASK, { group: 5, tone: -1 });
    }
    const mx = head.x + fs * 0.7 + F[MG.lookX] * 0.3, my = head.y + 0.2 + F[MG.lookY] * 0.3;
    const tilt = fs * 0.12 + F[MG.lookY] * 0.2 * fs;
    r.ellipse(mx, my, 1.7, 2.4, tilt, 4.5, MASK, { group: 6 });
    // Carved eye holes with a violet shine in the dark behind them.
    const gx = (e.expression?.gazeX ?? 0) * 0.2;
    for (const s of [-1, 1]) {
      const ex = mx + s * 0.75 + fs * 0.35 + gx, ey = my - 0.3;
      r.stamp(ex, ey, 0.5, 0.62, tilt, SKIN, 0, true);
      r.dot(ex, ey + 0.1, EYE, cast > 0.3 ? 2 : 1, 60);
      markEye(ex, ey + 0.1, 0.5);
    }
    // The glyph: a painted rune that burns when it casts.
    const gT = 0.4 + cast * 2.6;
    r.stroke(mx + fs * 0.35, my - 2.1, mx + fs * 0.35, my - 0.9, GLYPH, gT, true);
    r.stroke(mx + fs * 0.35 - 0.7, my - 1.5, mx + fs * 0.35 + 0.7, my - 1.5, GLYPH, gT, true);
    r.stroke(mx + fs * 0.2 - 0.5, my + 0.9, mx + fs * 0.35 + 0.6, my + 1.6, GLYPH, gT * 0.8, true);
    r.stroke(mx + fs * 0.35, my + 0.4, mx + fs * 0.35, my + 1.8, SKIN, 0, true);
    arm(MG_NEAR_ARM, 4, false);
    // Mid-cast: rubble lifts and circles the raised hands.
    if (cast > 0.3) {
      const na = rig.legs[MG_NEAR_ARM], fa = rig.legs[MG_FAR_ARM];
      const cx = (na.x + fa.x) / 2 + fs * 1.5, cy = (na.y + fa.y) / 2 - 2;
      for (let d = 0; d < 5; d++) {
        const a = tick * 0.12 + d * 1.2566;
        const rr = 4.5 + Math.sin(tick * 0.05 + d) * 0.8;
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.45;
        r.ellipse(px, py, 0.7 + (d % 2) * 0.3, 0.6, a, Math.sin(a) > 0 ? 8 : -8, DUST, { group: 30 + d });
      }
    }
    if (F[MG.blinkFx] > 0.1) r.glowStamp(chest.x, chest.y, 3, 5, 0, GLYPH, F[MG.blinkFx] * 3, 0, 1);
  },
};

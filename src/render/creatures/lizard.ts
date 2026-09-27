import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { LZ, LZ_CHEST, LZ_HEAD, LZ_HIPS } from '@/creatures/species/lizard';
import type { CreatureRaster } from './raster';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { SpeciesArt } from './types';

/**
 * Spitter lizard art. Rain World's read: a charcoal body you only half see in
 * the gloom, and a head in one loud colour you always see. The acid sac under
 * the jaw is the tell — it swells and glows before every spit.
 */

// Material slots (1-based in the raster).
const BODY = 1, BELLY = 2, HEAD = 3, SAC = 4, MOUTH = 5, TOOTH = 6, EYE = 7, GLINT = 8, SPOT = 9, CLAW = 10;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x07090a, 0x121b1c, 0x223131, 0x3a5046, 0x6c8866], gloss: 0.45, shine: 16, rim: 0.85, outline: 0x030404 }),
  material({ keys: [0x14170f, 0x2b3220, 0x4a5533, 0x6f7d4a], gloss: 0.2, rim: 0.3, outline: 0x040506 }),
  material({ keys: [0x1d2b05, 0x46690b, 0x7fb316, 0xbbe83c, 0xeaff9c], gloss: 0.55, shine: 22, rim: 0.7, emissive: 0.18, outline: 0x0a1202 }),
  material({ keys: [0x2f4a00, 0x72b400, 0xc4f53a, 0xf3ffb0], emissive: 0.75, glow: 0x3a6a06, glowK: 0.55, gloss: 0.6, translucent: 0.15, outline: 0x122000 }),
  material({ keys: [0x0b0203, 0x2a0a0c, 0x4c1a17], outline: 0x050101 }),
  material({ keys: [0x8f8a73, 0xd9d2b6, 0xfffbe8], rim: 0.1, outline: 0x1a1810 }),
  material({ keys: [0x010101, 0x07100a, 0x10200c], gloss: 1, shine: 40, outline: 0x010101 }),
  material({ keys: [0xc8ff6a, 0xf4ffd0], emissive: 1, glow: 0x2c4a0a, glowK: 0.8 }),
  material({ keys: [0x223208, 0x41601a, 0x6f9a24, 0xa8d24a], gloss: 0.35, emissive: 0.08, rim: 0.5, outline: 0x040506 }),
  material({ keys: [0x3a3528, 0x7f765c, 0xc9bf9c], outline: 0x0b0a07 }),
];

const TX = new Float64Array(16), TY = new Float64Array(16), TR = new Float64Array(16);

function drawLeg(r: CreatureRaster, rig: CreatureRig, i: number, far: boolean, z: number, fs: number): void {
  const leg = rig.legs[i];
  const anchor = rig.pts[i < 2 ? LZ_CHEST : LZ_HIPS];
  const hipOff = [fs * 1.2, fs * 2.2, -fs * 0.2, fs * 0.8][i];
  const hx = anchor.x + hipOff, hy = anchor.y + 0.6;
  const o = { group: 2 + i, far, tone: far ? 0 : 0.35 };
  // Upper arm/thigh is thick where it roots in the body; the shin tapers to a wrist.
  r.capsule(hx, hy, 1.55, leg.kx, leg.ky, 1.05, z, z + 0.5, BODY, o);
  const footX = leg.x, footY = leg.y - 0.55;
  r.capsule(leg.kx, leg.ky, 1.05, footX, footY, 0.75, z + 0.5, z + 1, BODY, o);
  // Splayed toes along the gripped surface (Rain World hands).
  const tx = -leg.gny, ty = leg.gnx; // surface tangent
  const spread = leg.planted ? 1 : 0.5;
  for (let t = -1; t <= 1; t++) {
    const lx = footX + tx * (t * 1.3 * spread + fs * 0.9) - leg.gnx * 0.2;
    const ly = footY + ty * (t * 1.3 * spread + fs * 0.9) + (leg.planted ? 0.45 : 0.9);
    r.capsule(footX, footY, 0.6, lx, ly, 0.35, z + 1, z + 1, t === 0 ? BODY : CLAW, o);
  }
}

export const lizardArt: SpeciesArt = {
  selfLit: true,
  materials: () => MATS,
  bounds(e, rig) {
    let x0 = e.x - 10, x1 = e.x + 10, y0 = e.y - 16, y1 = e.y + 2;
    for (const p of rig.pts) { x0 = Math.min(x0, p.x - 7); x1 = Math.max(x1, p.x + 7); y0 = Math.min(y0, p.y - 7); y1 = Math.max(y1, p.y + 4); }
    for (const p of rig.chains[0].pts) { x0 = Math.min(x0, p.x - 4); x1 = Math.max(x1, p.x + 4); y0 = Math.min(y0, p.y - 4); y1 = Math.max(y1, p.y + 4); }
    for (const l of rig.legs) { x0 = Math.min(x0, l.x - 4); x1 = Math.max(x1, l.x + 4); y1 = Math.max(y1, l.y + 2); }
    return [x0, y0, x1, y1];
  },
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, fs = F[LZ.face] >= 0 ? 1 : -1;
    const head = rig.pts[LZ_HEAD], chest = rig.pts[LZ_CHEST], hips = rig.pts[LZ_HIPS];
    const tail = rig.chains[0];
    const tick = ctx.state.frameCount;

    // Far legs first (behind), dark.
    drawLeg(r, rig, 1, true, -6, fs);
    drawLeg(r, rig, 3, true, -6, fs);

    // Tail + spine as one continuous tube: tail tip → hips → chest → neck.
    const n = tail.pts.length;
    let k = 0;
    for (let i = n - 1; i >= 1; i--) { TX[k] = tail.pts[i].x; TY[k] = tail.pts[i].y; TR[k] = tail.radius[i]; k++; }
    TX[k] = hips.x; TY[k] = hips.y; TR[k] = 3.0; k++;
    const midX = (hips.x + chest.x) * 0.5, midY = (hips.y + chest.y) * 0.5 - 0.5 - F[LZ.breath] * 0.3;
    TX[k] = midX; TY[k] = midY; TR[k] = 3.35 + F[LZ.breath] * 0.15; k++;
    TX[k] = chest.x; TY[k] = chest.y; TR[k] = 3.05; k++;
    const nx = chest.x + (head.x - chest.x) * 0.55, ny = chest.y + (head.y - chest.y) * 0.55;
    TX[k] = nx; TY[k] = ny; TR[k] = 2.2; k++;
    r.tube(TX, TY, TR, k, 0, BODY, { group: 1 });

    // Pale belly band along the underside of the torso.
    const bdx = chest.x - hips.x, bdy = chest.y - hips.y, bl = Math.hypot(bdx, bdy) || 1;
    const ux = bdx / bl, uy = bdy / bl;
    for (let t = 0; t <= 1.001; t += 0.2) {
      r.stamp(hips.x + bdx * t, hips.y + bdy * t + 2.3, 2.4, 1.05, Math.atan2(uy, ux), BELLY, 0, false, 1);
    }
    // Spine pattern: paired flecks of the head colour, shrinking down the tail.
    for (let i = 0; i < 9; i++) {
      let sx: number, sy: number, rad: number;
      if (i < 4) {
        const t = 0.15 + i * 0.25;
        sx = hips.x + bdx * t; sy = hips.y + bdy * t - 2.55 - (i === 1 || i === 2 ? 0.3 : 0); rad = 0.8;
      } else {
        const p = tail.pts[Math.min(n - 1, (i - 4) * 2 + 1)];
        sx = p.x; sy = p.y - tail.radius[Math.min(n - 1, (i - 4) * 2 + 1)] * 0.6; rad = 0.75 - (i - 4) * 0.1;
      }
      if (rad > 0.3) r.stamp(sx, sy, rad * 1.3, rad * 0.75, Math.atan2(uy, ux), SPOT, -0.4, false, 1);
    }

    // Near legs over the body.
    drawLeg(r, rig, 2, false, 5, fs);
    drawLeg(r, rig, 0, false, 5, fs);

    // --- Head: a broad wedge on a hinged jaw ---
    const ha = F[LZ.headAng];
    const hx = Math.cos(ha), hy = Math.sin(ha);
    const side = hx >= 0 ? 1 : -1; // which way the snout points on screen
    // Perpendicular toward the jaw side.
    const dnx = -hy * side, dny = hx * side;
    const gape = F[LZ.jaw] * 0.95;
    const hp = (along: number, down: number): [number, number] => [head.x + hx * along + dnx * down, head.y + hy * along + dny * down];
    // Throat: a dewlap hanging under the jaw hinge; it swells and glows before a spit.
    const sac = F[LZ.throat];
    const [thx, thy] = hp(-1.6, 1.8);
    r.ellipse(thx, thy + sac * 0.8, 1.7 + sac * 1.9, 1.3 + sac * 1.5, 0, 4.5, sac > 0.12 ? SAC : BELLY, { group: 9 });
    // Lower jaw: hinged at the back of the skull, rotating down with the gape.
    const jawAng = ha + side * gape;
    const jx = Math.cos(jawAng), jy = Math.sin(jawAng);
    const jdx = -jy * side, jdy = jx * side;
    const [hingeX, hingeY] = hp(-2.0, 1.1);
    const jp = (along: number, down: number): [number, number] => [hingeX + jx * along + jdx * down, hingeY + jy * along + jdy * down];
    {
      const [ax, ay] = jp(0.5, 0.2), [bx, by] = jp(6.9, -0.1);
      r.capsule(ax, ay, 1.7, bx, by, 0.85, 6, 6.4, HEAD, { group: 10 });
    }
    // Mouth interior shows when the jaw drops: dark gums, a row of teeth each side.
    if (gape > 0.1) {
      const [ax, ay] = hp(-1.6, 0.9), [bx, by] = hp(6.0, 0.7), [cx, cy] = jp(6.4, -0.8), [dx, dy] = jp(0.4, -0.6);
      r.poly([ax, ay, bx, by, cx, cy, dx, dy], 4, 6.2, MOUTH, 0, { group: 11, noOutline: true });
      for (let t = 0; t < 5; t++) {
        const [tx1, ty1] = hp(0.4 + t * 1.25, 1.05);
        r.dot(tx1, ty1, TOOTH, 2, 7.2);
        const [tx2, ty2] = jp(1.4 + t * 1.1, -0.95);
        r.dot(tx2, ty2, TOOTH, 1, 7.2);
      }
    }
    // Skull: a cranium, a flatter snout, a brow ridge.
    {
      const [cx, cy] = hp(-0.6, -0.1);
      r.ellipse(cx, cy, 3.7, 2.9, ha, 7, HEAD, { group: 10 });
      const [sx2, sy2] = hp(3.1, 0.25);
      r.ellipse(sx2, sy2, 3.1, 1.85, ha, 7, HEAD, { group: 10 });
      const [bx2, by2] = hp(0.6, -1.9);
      r.stamp(bx2, by2, 1.9, 0.7, ha, HEAD, 0.8, false, 10);
      // Mouth line when closed.
      if (gape <= 0.1) {
        const [m0x, m0y] = hp(-1.4, 1.2), [m1x, m1y] = hp(5.8, 0.85);
        r.stroke(m0x, m0y, m1x, m1y, MOUTH, 1, true);
      }
      const [nsx, nsy] = hp(5.4, -0.3);
      r.stamp(nsx, nsy, 0.45, 0.35, ha, MOUTH, 0, true);
    }
    // Eye: small and dark with a wet glint; it narrows as the lizard commits.
    const [ex, ey] = hp(0.9, -0.85);
    const lid = e.expression?.lid ?? 0;
    const open = Math.max(0.25, 1 - lid);
    r.stamp(ex, ey, 1.0, 0.8 * open, ha, EYE, 0, false);
    if (open > 0.4) r.dot(ex - 0.3, ey - 0.35, GLINT, 1, 30);
    // A drip of acid at the lip when the sac is full.
    if (sac > 0.45) {
      const [dx, dy] = hp(4.8, 1.6);
      r.dot(dx, dy + (tick % 24) * 0.06, SAC, 3, 25);
    }
  },
};

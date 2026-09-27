import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { RL, RL_BODY, RL_WHIP } from '@/creatures/species/rootloper';
import { chainTube } from './anatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import type { SpeciesArt } from './types';

/**
 * Root Loper: a gnarled seed-bulb of bark and moss hung between root
 * tentacles, crowned with fronds, watching through one amber eye in a knot.
 */
const BARK = 1, MOSS = 2, LEAF = 3, EYE = 4, PUPIL = 5, SPORE = 6, THORN = 7, LID = 8;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x090705, 0x1a140e, 0x302518, 0x4e3e28, 0x7a6444], gloss: 0.1, rim: 0.8, outline: 0x040302 }),
  material({ keys: [0x0c1606, 0x203a12, 0x3a6a22, 0x6a9c3e, 0xa8d070], rim: 0.5, outline: 0x040602 }),
  material({ keys: [0x0e2208, 0x245216, 0x46902c, 0x86cc56, 0xd4f4a4], translucent: 0.22, rim: 0.7, gloss: 0.35, outline: 0x061004 }),
  material({ keys: [0x5a2e00, 0xd08a14, 0xffd050, 0xfff6c0], emissive: 0.85, glow: 0x3a2004, glowK: 0.6 }),
  material({ keys: [0x020100, 0x0a0602, 0x140c04] }),
  material({ keys: [0x3a6a10, 0xb4f040, 0xf4ffc0], emissive: 1, glow: 0x1e3a06, glowK: 0.7 }),
  material({ keys: [0x2a2012, 0x6a5634, 0xb49a68], rim: 0.5, outline: 0x080603 }),
  material({ keys: [0x140e08, 0x2a2014, 0x4a3a24, 0x6e5a3c], rim: 0.6, outline: 0x040302 }),
];

const RING = new Float64Array(64);

export const rootloperArt: SpeciesArt = {
  materials: () => MATS,
  bounds(e, rig) {
    let x0 = e.x - 20, x1 = e.x + 20, y0 = e.y - 30, y1 = e.y + 4;
    for (const c of rig.chains) for (const p of c.pts) { x0 = Math.min(x0, p.x - 3); x1 = Math.max(x1, p.x + 3); y0 = Math.min(y0, p.y - 3); y1 = Math.max(y1, p.y + 3); }
    const b = rig.pts[RL_BODY]; y0 = Math.min(y0, b.y - 18);
    return [x0, y0, x1, y1];
  },
  lightProbe: (_e, rig) => [rig.pts[RL_BODY].x, rig.pts[RL_BODY].y, 10],
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, tick = ctx.state.frameCount;
    const body = rig.pts[RL_BODY];
    const fs = F[RL.face] >= 0 ? 1 : -1;
    const panic = F[RL.panic], alert = e.expression?.alert ?? 0;
    // Root tentacles: far roots (even) behind, near roots (odd) in front.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = pass; i < 6; i += 2) {
        const c = rig.chains[i], far = pass === 0;
        chainTube(r, c, far ? -5 : 4, BARK, { group: 10 + i, far, tone: far ? -0.2 : 0.2 }, 1.35, 0.3);
        // Root hairs where the tip grips.
        const tip = c.pts[c.pts.length - 1], pre = c.pts[c.pts.length - 2];
        const dx = tip.x - pre.x, dy = tip.y - pre.y, d = Math.hypot(dx, dy) || 1;
        for (const s of [-1, 1]) r.capsule(tip.x, tip.y, 0.25, tip.x + dx / d * 0.9 - dy / d * s * 1.1, tip.y + dy / d * 0.9 + dx / d * s * 1.1, 0.12, far ? -5 : 4, far ? -5 : 4, BARK, { group: 10 + i, far });
        // Moss sleeves on the upper root.
        if (!far) r.stamp(c.pts[1].x, c.pts[1].y, 1.4, 1.0, 0, MOSS, 1, false, 10 + i);
      }
      if (pass === 0) {
        // Fronds rising from the crown (behind the bulb).
        for (let l = 0; l < 5; l++) {
          const base = -0.9 + l * 0.45;
          const sway = Math.sin(F[RL.frond] + l * 1.3) * 0.18 + (panic > 0.2 ? Math.sin(tick * 0.9 + l) * 0.2 : 0);
          const droop = (1 - alert * 0.5) * 0.35 + panic * 0.6;
          const a = -Math.PI / 2 + base + sway + Math.sign(base) * droop;
          const L = 7.5 + (l % 2) * 2.2 - Math.abs(base) * 1.5;
          const bx = body.x + Math.cos(a) * 3.5, by = body.y - 3.2 + Math.sin(a) * 1.5;
          const tx = bx + Math.cos(a) * L, ty = by + Math.sin(a) * L;
          const nx = -Math.sin(a), ny = Math.cos(a), W = 1.8 + (l % 2) * 0.3;
          r.poly([bx, by, bx + (tx - bx) * 0.4 + nx * W, by + (ty - by) * 0.4 + ny * W, tx, ty,
            bx + (tx - bx) * 0.55 - nx * W * 0.8, by + (ty - by) * 0.55 - ny * W * 0.8], 4, -2 + l * 0.1, LEAF, 0.4, { group: 30 + l });
          r.stroke(bx, by, tx, ty, LEAF, 4, false);
        }
      }
    }
    // The whip: a thorned root coiled over the back.
    chainTube(r, rig.chains[RL_WHIP], -1, BARK, { group: 7 }, 1.1, 0.3);
    for (let i = 2; i < rig.chains[RL_WHIP].pts.length; i += 2) {
      const p = rig.chains[RL_WHIP].pts[i];
      r.dot(p.x, p.y - 0.9, THORN, 2, 3);
    }
    // Bulb: a lumpy seed-pod with bark ridges and moss on top.
    let k = 0;
    const lobes = 11;
    for (let i = 0; i < lobes * 2; i++) {
      const a = (i / (lobes * 2)) * Math.PI * 2;
      const bump = 1 + Math.sin(a * 3 + e.bobPhase) * 0.07 + Math.sin(a * 5 + 1) * 0.05;
      RING[k++] = body.x + Math.cos(a) * 6.2 * bump;
      RING[k++] = body.y + Math.sin(a) * 5.3 * bump;
    }
    r.poly(RING, k / 2, 0, BARK, 4.4, { group: 1 });
    for (let s = 0; s < 4; s++) {
      const x = body.x - 4 + s * 2.6;
      r.shade(x, body.y + 1, 0.45, 4, 0.1 * (s - 1.5), -1.0, 1, 0.4);
    }
    r.stamp(body.x - fs * 1.2, body.y - 4.1, 4.6, 1.8, 0, MOSS, 1.2, false, 1);
    r.stamp(body.x + fs * 2.6, body.y - 3.4, 2.2, 1.2, 0.4, MOSS, 0.6, false, 1);
    // Bioluminescent spores drifting off the crown.
    for (let s = 0; s < 4; s++) {
      const ph = (tick * 0.01 + s * 0.25 + e.bobPhase) % 1;
      r.dot(body.x - 4 + s * 2.5 + Math.sin(tick * 0.03 + s) * 1.2, body.y - 5 - ph * 9, SPORE, 2 * (1 - ph), 2);
    }
    // The eye in its knot: amber, slit-pupilled, lidded in bark.
    const ex = body.x + fs * 2.4, ey = body.y - 0.2;
    r.ellipse(ex, ey, 2.4, 2.1, 0, 4.6, LID, { group: 2 });
    const lid = Math.max(e.expression?.lid ?? 0, (e.windup ?? 0) > 0 ? 0 : 0);
    const open = Math.max(0, 1 - lid) * (1 + panic * 0.2);
    if (open > 0.2) {
      r.stamp(ex + fs * 0.2, ey, 1.7, 1.45 * Math.min(1, open), 0, EYE, 2 + alert * 0.8, true, 2);
      const gx = (e.expression?.gazeX ?? fs * 0.5) * 0.5, gy = (e.expression?.gazeY ?? 0) * 0.4;
      r.stamp(ex + fs * 0.2 + gx, ey + gy, 0.28 + panic * 0.4, 1.2 * Math.min(1, open), 0, PUPIL, 0, true, 2);
    } else {
      r.stroke(ex - 1.6, ey, ex + 1.6, ey, PUPIL, 0, true);
    }
  },
};

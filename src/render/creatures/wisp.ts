import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { bellRim, WSP, WSP_BELL, WSP_TENTACLES } from '@/creatures/species/wisp';
import { chainTube, markEye, POLY } from './anatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import type { SpeciesArt } from './types';

/**
 * Wisp: a frost jellyfish. A glassy bell you can see the cave through, a cold
 * glowing heart, rime on the rim, and a veil of tentacles that trails every
 * swim beat.
 */
const BELL = 1, CORE = 2, TENT = 3, FRILL = 4, RIME = 5, OCELLUS = 6;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x082a3c, 0x16648a, 0x34aad6, 0x92e4ff, 0xf0ffff], translucent: 0.52, emissive: 0.6, glow: 0x08263a, glowK: 0.45, gloss: 1, shine: 26, rim: 1, outline: 0x0a3448 }),
  material({ keys: [0x0a4a6a, 0x3ab0dc, 0x9aeaff, 0xf0ffff], emissive: 1, glow: 0x0c3a54, glowK: 0.8 }),
  material({ keys: [0x0e4458, 0x2482a4, 0x68cceb, 0xc8f6ff], translucent: 0.4, emissive: 0.75, glow: 0x061c28, glowK: 0.5, rim: 0.3 }),
  material({ keys: [0x10465e, 0x2c88aa, 0x80d4ee, 0xe0fbff], translucent: 0.55, emissive: 0.6, glow: 0x04141c, glowK: 0.4, rim: 0.4, gloss: 0.6 }),
  material({ keys: [0xbfe8ff, 0xffffff], emissive: 1, glow: 0x183848, glowK: 0.6 }),
  material({ keys: [0x02070a, 0x06141a, 0x0c2028] }),
];

export const wispArt: SpeciesArt = {
  selfLit: true,
  materials: () => MATS,
  bounds(e, rig) {
    let x0 = e.x - 10, x1 = e.x + 10, y0 = e.y - 16, y1 = e.y + 6;
    for (const c of rig.chains) for (const p of c.pts) { x0 = Math.min(x0, p.x - 2); x1 = Math.max(x1, p.x + 2); y0 = Math.min(y0, p.y - 2); y1 = Math.max(y1, p.y + 2); }
    const b = rig.pts[WSP_BELL];
    x0 = Math.min(x0, b.x - 9); x1 = Math.max(x1, b.x + 9); y0 = Math.min(y0, b.y - 9);
    return [x0, y0, x1, y1];
  },
  lightProbe: (_e, rig) => [rig.pts[WSP_BELL].x, rig.pts[WSP_BELL].y, 9],
  style: { outline: 2 },
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, tick = ctx.state.frameCount;
    const bell = rig.pts[WSP_BELL];
    const { rx, ry } = bellRim(F);
    // Tentacles and oral arms trail beneath.
    for (let i = 0; i < WSP_TENTACLES; i++) chainTube(r, rig.chains[i], -3, TENT, { group: 2, noOutline: true }, 0.42, 0.14);
    for (let k = 0; k < 2; k++) {
      const c = rig.chains[WSP_TENTACLES + k];
      chainTube(r, c, -1, FRILL, { group: 3, noOutline: true }, 0.7, 0.22);
      // Frills: little lobes along the arm.
      for (let j = 1; j < c.pts.length; j++) {
        const p = c.pts[j], w = Math.sin(tick * 0.15 + j * 1.7 + k) * 0.6;
        r.ellipse(p.x + w, p.y, 0.75 - j * 0.08, 0.45, 0, -0.5, FRILL, { group: 3, noOutline: true });
      }
    }
    // The bell: a dome with a scalloped, flaring skirt.
    const tiltA = Math.max(-0.35, Math.min(0.35, F[WSP.vx] * 0.25));
    const ca = Math.cos(tiltA), sa = Math.sin(tiltA);
    let k = 0;
    const put = (lx: number, ly: number): void => { POLY[k++] = bell.x + lx * ca - ly * sa; POLY[k++] = bell.y + lx * sa + ly * ca; };
    const segs = 14;
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI + (i / segs) * Math.PI; // left → over the top → right
      put(Math.cos(a) * rx, Math.sin(a) * ry + 0.6);
    }
    const lobes = 7, skirt = 1.3 + F[WSP.squeeze] * 0.4;
    for (let i = 0; i <= lobes * 2; i++) {
      const t = i / (lobes * 2);
      const lx = rx * (1 - t * 2) * (1 + 0.08 * (1 - F[WSP.squeeze]));
      const ly = 0.6 + skirt + (i % 2 === 0 ? 0 : 0.7);
      put(lx * 0.98, ly);
    }
    r.poly(POLY, k / 2, 0, BELL, Math.min(rx, ry) * 0.75, { group: 1 });
    // A cold heart, radial canals and the rim's rime.
    const glow = F[WSP.glow];
    r.glowStamp(bell.x, bell.y + 0.2, rx * 0.36, ry * 0.3, tiltA, CORE, 1.4 + glow * 1.6, 0.2, 1);
    for (let c = 0; c < 4; c++) {
      const a = Math.PI + (c + 0.5) / 4 * Math.PI;
      r.shade(bell.x + Math.cos(a) * rx * 0.55, bell.y + Math.sin(a) * ry * 0.5 + 0.5, rx * 0.28, 0.35, a, 1.2, 1, 0.5);
    }
    for (let c = 0; c < 6; c++) {
      const a = Math.PI + (c + 0.5) / 6 * Math.PI + Math.sin(tick * 0.01 + c) * 0.05;
      r.dot(bell.x + Math.cos(a) * rx * 0.9, bell.y + Math.sin(a) * ry * 0.9 + 0.5, RIME, (c + tick / 20) % 3 < 1 ? 1 : 0, 40);
    }
    // Ocelli on the skirt — the only thing on it that looks back.
    for (const s of [-0.55, -0.2, 0.2, 0.55]) {
      r.dot(bell.x + s * rx * 2 * ca, bell.y + 1.9 + s * rx * 2 * sa, OCELLUS, 0, 45);
      markEye(bell.x + s * rx * 2 * ca, bell.y + 1.9 + s * rx * 2 * sa, 0.35);
    }
    // Charging a frost bolt: the heart flares toward the target.
    if (F[WSP.charge] > 0.1) {
      const tx = (e.mind?.targetX ?? bell.x) - bell.x, ty = (e.mind?.targetY ?? bell.y) - 9 - bell.y, d = Math.hypot(tx, ty) || 1;
      r.glowStamp(bell.x + tx / d * rx * 0.4, bell.y + ty / d * ry * 0.3, 1 + F[WSP.charge], 1 + F[WSP.charge], 0, CORE, 3, 1, 1);
    }
  },
};

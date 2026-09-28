import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { smoothRing } from '@/creatures/rig/softbody';
import { EGG, GEL } from '@/creatures/species/gel';
import { chainTube, eye, POLY } from './anatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import type { SpeciesArt } from './types';

/**
 * Gel creatures: a translucent membrane you can see the cave through, a
 * nucleus sloshing inside, bubbles rising, two small eyes that follow you.
 */

// Slots.
// Slots 2, 3 and 8 (nucleus, bubble, vein) stay in the table for palette variants.
const GELM = 1, EYE = 4, GLINT = 5, MOUTH = 6, HOT = 7, WICK = 9, EMBER = 10;

function gelSet(keys: number[], nuc: number[], opts: { emissive?: number; glow?: number; translucent?: number; hot?: number[] }): CreatureMaterial[] {
  return [
    material({ keys, translucent: opts.translucent ?? 0.34, gloss: 0.95, shine: 26, rim: 0.95, emissive: opts.emissive ?? 0.1, glow: opts.glow, glowK: 0.35 }),
    material({ keys: nuc, translucent: 0.12, gloss: 0.3, rim: 0.2 }),
    material({ keys: [keys[2], keys[3], keys[4]], translucent: 0.2, gloss: 0.6, emissive: 0.4 }),
    material({ keys: [0x010202, 0x061012, 0x0d1c1e], gloss: 1, shine: 40 }),
    material({ keys: [0xf2fff8, 0xffffff], emissive: 1 }),
    material({ keys: [0x040808, 0x0a1414, 0x122222], translucent: 0.05 }),
    material({ keys: opts.hot ?? [0x6a1c00, 0xd85a08, 0xffb030, 0xfff0a0], emissive: 0.9, glow: 0x6a2804, glowK: 0.9 }),
    material({ keys: [0x1a0402, 0x3a0a04, 0x5a1a0a], translucent: 0.1 }),
    material({ keys: [0x0e0a06, 0x2a2014, 0x4a3a22], rim: 0.3 }),
    material({ keys: [0xff7a10, 0xffd060, 0xffffe0], emissive: 1, glow: 0xa05010, glowK: 1.2 }),
  ];
}

const SLIME = gelSet([0x061f22, 0x0d4a47, 0x1f8574, 0x5cc9a8, 0xcffff0], [0x04161a, 0x0a2f33, 0x145050], { emissive: 0.12, glow: 0x06201a });
const ACID = gelSet([0x151f02, 0x3a5506, 0x76a10e, 0xc4ea46, 0xf8ffc4], [0x0e1402, 0x243406, 0x3c540c], { emissive: 0.24, glow: 0x16280a });
const BOMBER = gelSet([0x220802, 0x5a1806, 0x9c3a0c, 0xe07a24, 0xffcc82], [0x2a0604, 0x5a1004, 0x8a2008], { emissive: 0.12, translucent: 0.18 });

const RING = new Float64Array(160);

export const gelArt: SpeciesArt = {
  selfLit: true,
  materials: e => (e.kind === 'acidslime' ? ACID : e.kind === 'bomber' ? BOMBER : SLIME),
  bounds(e, rig) {
    let x0 = e.x - 12, x1 = e.x + 12, y0 = e.y - 16, y1 = e.y + 3;
    if (rig.soft) for (const p of rig.soft.pts) { x0 = Math.min(x0, p.x - 3); x1 = Math.max(x1, p.x + 3); y0 = Math.min(y0, p.y - 3); y1 = Math.max(y1, p.y + 3); }
    for (const c of rig.chains) for (const p of c.pts) { y0 = Math.min(y0, p.y - 3); x0 = Math.min(x0, p.x - 3); x1 = Math.max(x1, p.x + 3); }
    return [x0, y0, x1, y1];
  },
  lightProbe: (e, rig) => [rig.soft?.cx ?? e.x, rig.soft?.cy ?? e.y - 4, 9],
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const sb = rig.soft;
    if (!sb) return;
    const F = rig.f, tick = ctx.state.frameCount;
    const n = smoothRing(sb.pts, 3, RING);
    // Current extents of the (deformed) body.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = RING[i * 2], y = RING[i * 2 + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const w = maxX - minX, h = maxY - minY;
    const face = F[GEL.face] >= 0 ? 1 : -1;
    // Bomber wick behind the body.
    if (rig.chains[0]) {
      chainTube(r, rig.chains[0], -1, WICK, { group: 3 }, 0.55, 0.4);
      const tip = rig.chains[0].pts[rig.chains[0].pts.length - 1];
      const fusing = (e.fusing ?? 0) > 0;
      const flick = fusing ? (tick % 4 < 2 ? 1 : 0.6) : 0.5 + Math.sin(tick * 0.3) * 0.2;
      r.ellipse(tip.x, tip.y, 0.8 + flick * 0.5, 0.8 + flick * 0.5, 0, 2, EMBER, { group: 4, noOutline: true });
    }
    r.poly(RING, n, 0, GELM, Math.min(w, h) * 0.42, { group: 1 });
    // Internal life: a dark nucleus seen through the gel, rising bubbles.
    const nx = F[GEL.nucX], ny = F[GEL.nucY];
    r.shade(sb.cx, maxY - h * 0.25, w * 0.46, h * 0.3, 0, -0.9, 1);
    r.shade(nx, ny, w * 0.24, h * 0.22, (nx - sb.cx) * 0.2, -1.6, 1, 0.55);
    for (let b = 0; b < 2; b++) {
      const ph = (F[GEL.bubble] + b * 0.5) % 1;
      const bx = sb.cx + Math.sin(b * 2.4 + tick * 0.02) * w * 0.2 - face * w * 0.1;
      const by = maxY - h * 0.2 - ph * h * 0.6;
      if (r.covered(bx, by - 0.8)) r.shade(bx, by, 0.7, 0.7, 0, 2.2, 1, 0.6);
    }
    if (e.kind === 'bomber') {
      // A hot ember core glowing through the bladder, brighter as the fuse burns.
      const heat = F[GEL.heat];
      r.glowStamp(sb.cx - face * w * 0.06, sb.cy + h * 0.08, w * (0.2 + heat * 0.14), h * (0.2 + heat * 0.14), 0, HOT, 1.2 + heat * 1.8, 0, 1);
      for (let v = 0; v < 4; v++) {
        const a = v * 1.57 + 0.7;
        r.shade(sb.cx + Math.cos(a) * w * 0.3, sb.cy + Math.sin(a) * h * 0.28, w * 0.18, 0.5, a, -1.1, 1, 0.5);
      }
    }
    // Face: eyes riding the upper front of the membrane, gaze on the target.
    const rigExpr = e.expression;
    const gx = rigExpr?.gazeX ?? face * 0.5, gy = rigExpr?.gazeY ?? 0;
    const eyeY = minY + h * 0.36, ex0 = sb.cx + face * w * 0.18;
    const eyeR = e.kind === 'bomber' ? 0.95 : 1.05;
    const angry = e.kind === 'bomber' || (e.windup ?? 0) > 0 || (e.fusing ?? 0) > 0;
    for (const s of [-1, 1]) {
      const ex = ex0 + s * w * 0.13 + gx * 0.5, ey = eyeY + gy * 0.4 + (s === face ? 0 : 0.2);
      eye(r, ex, ey, eyeR, eyeR * 1.15, 0, { eye: EYE, glint: GLINT }, gx, gy, rigExpr?.lid ?? 0);
      if (angry) r.stroke(ex - s * 1.1, ey - 1.6 + (s === 1 ? 0 : 0.2), ex + s * 0.9, ey - 1.0, MOUTH, 0, true);
    }
    // Mouth: a small slot that yawns open before a lunge or on the fuse.
    const jaw = Math.max(rigExpr?.jaw ?? 0, (e.windup ?? 0) > 0 ? 0.5 : 0, F[GEL.fuse]);
    const mx = ex0 + gx * 0.3, my = eyeY + h * 0.22;
    if (jaw > 0.2) r.stamp(mx, my, 1.4, 0.35 + jaw * 0.9, 0, MOUTH, 0, true, 1);
    else r.stroke(mx - 1.1, my, mx + 1.1, my + 0.15, MOUTH, 0, true);
  },
};

/* ---------------- Egg clutch ---------------- */

const EGGM = 1, EMBRYO = 2, EEYE = 3, GOO = 4, EGLINT = 6;
const EGG_MATS: CreatureMaterial[] = [
  material({ keys: [0x0c2622, 0x1f5a4e, 0x44a088, 0x9ae6c6, 0xeafff4], translucent: 0.38, gloss: 1, shine: 30, rim: 1, emissive: 0.14, glow: 0x061a14, glowK: 0.3 }),
  material({ keys: [0x0a2a1a, 0x2a8a50, 0x7af0a0, 0xe0ffe8], emissive: 0.8, glow: 0x0a3a1e, glowK: 0.6 }),
  material({ keys: [0x000000, 0x050808, 0x0a1010] }),
  material({ keys: [0x0a2a24, 0x185a4c, 0x3a9a80, 0x80d8b8], translucent: 0.3, gloss: 0.8, shine: 20, rim: 0.6 }),
  material({ keys: [0x0e3a30, 0x1a5a48, 0x2a7a60], translucent: 0.3 }),
  material({ keys: [0xeafff6, 0xffffff], emissive: 1 }),
];

export const eggsArt: SpeciesArt = {
  materials: () => EGG_MATS,
  bounds: e => [e.x - 12, e.y - 12, e.x + 12, e.y + 3],
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, tick = ctx.state.frameCount;
    const ground = e.y + 1;
    const ripe = Math.min(1, e.timer / (1400 + e.bobPhase * 220));
    // A glistening bed of goo holds the clutch to the floor.
    const bed = POLY; let k = 0;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, x = e.x - 8 + t * 16;
      bed[k++] = x; bed[k++] = ground - 1.2 - Math.sin(t * Math.PI) * 1.4;
    }
    bed[k++] = e.x + 8.5; bed[k++] = ground; bed[k++] = e.x - 8.5; bed[k++] = ground;
    r.poly(bed, k / 2, 0, GOO, 1.2, { group: 1 });
    const spots = [[-5.4, 2.3, 2.9], [5.2, 2.2, 2.8], [-1.8, 2.7, 3.5], [1.8, 2.6, 3.3]];
    for (let i = 0; i < 4; i++) {
      const [ox, rx, ry] = spots[i];
      const wob = F[EGG.wob + i * 2];
      const pulse = Math.sin(tick * (0.05 + ripe * 0.05) + i * 1.3) * 0.12 * (0.5 + ripe);
      const erx = rx * (1 + pulse * 0.4), ery = ry * (1 - pulse * 0.2);
      const cx = e.x + ox, cy = ground - ery - 0.4;
      const ang = wob * 0.35;
      r.ellipse(cx, cy, erx, ery, ang, i >= 2 ? 0 : 1, EGGM, { group: 2 + i });
      // A curled embryo glows faintly inside; it twitches as it ripens.
      const tw = F[EGG.twitch + i];
      const bx = cx + Math.sin(ang) * 0.6 + (i % 2 ? 0.3 : -0.3), by = cy + ery * 0.12;
      r.shade(bx, by, erx * 0.62, ery * 0.55, ang + tw * 0.3, -1.3, 2 + i, 0.4);
      r.glowStamp(bx, by + 0.3, erx * (0.26 + ripe * 0.12) + tw * 0.15, ery * (0.2 + ripe * 0.1), ang + tw * 0.4, EMBRYO, 1.4 + ripe * 1.4, 0.2, 2 + i);
      if (ripe > 0.3) r.dot(bx + (i % 2 ? 0.6 : -0.6), by - ery * 0.2, EEYE, 0, 50);
      r.dot(cx - erx * 0.45, cy - ery * 0.5, EGLINT, 1, 60);
    }
  },
};

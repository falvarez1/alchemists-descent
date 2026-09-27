import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { BAT, BAT_BODY, BAT_HEAD, batTip, batWingTargets } from '@/creatures/species/bat';
import { chainTube, eye } from './anatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import type { SpeciesArt } from './types';
import { idleEnvelope } from '@/creatures/idle';

/**
 * Bat: a soot-dark furred body, thin wing membranes the light glows through,
 * finger bones you can count on the downstroke, ember eyes that find you in
 * the dark.
 */
const FUR = 1, SKIN = 2, BONE = 3, EAR = 4, EYE = 5, GLINT = 6, FANG = 7, NOSE = 8;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x08060a, 0x17111a, 0x2c2230, 0x4a3a46, 0x74606a], rim: 0.9, gloss: 0.1, outline: 0x040305 }),
  material({ keys: [0x1a0a12, 0x3a1622, 0x62283a, 0x96485a, 0xc87a80], translucent: 0.32, rim: 0.4, gloss: 0.25, outline: 0x0a0408 }),
  material({ keys: [0x0e080c, 0x241a20, 0x3e3036, 0x5e4a50], rim: 0.5, outline: 0x040305 }),
  material({ keys: [0x1a0c12, 0x40202a, 0x6c3a46, 0xa06470], rim: 0.6, translucent: 0.15, outline: 0x060305 }),
  material({ keys: [0x3a0600, 0xb02808, 0xff6a1e, 0xffd08a], emissive: 1, glow: 0x5a1404, glowK: 0.9 }),
  material({ keys: [0xffe8c0, 0xffffff], emissive: 1 }),
  material({ keys: [0xa89c88, 0xe8e0cc, 0xffffff] }),
  material({ keys: [0x1a0e10, 0x3a2226, 0x5a3a3a] }),
];

const WT = new Float64Array(12);
const MEM = new Float64Array(40);

export const batArt: SpeciesArt = {
  materials: () => MATS,
  bounds(e, rig) {
    let x0 = e.x - 8, x1 = e.x + 8, y0 = e.y - 12, y1 = e.y + 6;
    for (const p of rig.pts) { x0 = Math.min(x0, p.x - 3); x1 = Math.max(x1, p.x + 3); y0 = Math.min(y0, p.y - 4); y1 = Math.max(y1, p.y + 3); }
    for (const c of rig.chains) for (const p of c.pts) { y1 = Math.max(y1, p.y + 2); y0 = Math.min(y0, p.y - 2); }
    return [x0, y0, x1, y1];
  },
  lightProbe: (_e, rig) => [rig.pts[BAT_BODY].x, rig.pts[BAT_BODY].y, 8],
  draw(r: CreatureRaster, _ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f;
    const body = rig.pts[BAT_BODY], head = rig.pts[BAT_HEAD];
    let ux = head.x - body.x, uy = head.y - body.y;
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul; // body "up"
    const rx = -uy, ry = ux; // body "right"
    const baseFold = F[BAT.fold], baseSpread = F[BAT.spread];
    // A roosting bat stretching one wing (creatures/idle): that side unfolds.
    const stretch = e.sleeping === true && e.idle?.act === 'stretch' ? idleEnvelope(e.idle) : 0;
    // --- Wings (behind the body) ---
    for (const side of [-1, 1]) {
      const opening = stretch > 0 && side === e.idle?.side;
      const fold = opening ? baseFold * (1 - stretch * 0.85) : baseFold;
      if (opening) { F[BAT.fold] = fold; F[BAT.spread] = baseSpread + stretch * 0.95; }
      batWingTargets(F, side, body.x, body.y, WT);
      F[BAT.fold] = baseFold; F[BAT.spread] = baseSpread;
      const shX = body.x + rx * side * 1.2 + ux * 1.0, shY = body.y + ry * side * 1.2 + uy * 1.0;
      const el = rig.pts[batTip(side, 3)];
      const wx = WT[4] + (el.x - WT[2]), wy = WT[5] + (el.y - WT[3]);
      const t0 = rig.pts[batTip(side, 0)], t1 = rig.pts[batTip(side, 1)], t2 = rig.pts[batTip(side, 2)];
      const hipX = body.x - ux * 1.8 + rx * side * 1.0, hipY = body.y - uy * 1.8 + ry * side * 1.0;
      if (fold < 0.85) {
        // Membrane with scalloped trailing edges between the fingers.
        let k = 0;
        const push = (x: number, y: number): void => { MEM[k++] = x; MEM[k++] = y; };
        push(shX, shY); push(el.x, el.y); push(wx, wy); push(t0.x, t0.y);
        const scallop = (a: { x: number; y: number }, b: { x: number; y: number }, depth: number): void => {
          const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5;
          push(mx + (wx - mx) * depth, my + (wy - my) * depth);
        };
        scallop(t0, t1, 0.22); push(t1.x, t1.y); scallop(t1, t2, 0.2); push(t2.x, t2.y);
        const hx = { x: hipX, y: hipY };
        scallop(t2, hx, 0.18); push(hipX, hipY);
        const tilt = side * (0.25 + (1 - (opening ? baseSpread + stretch * 0.95 : baseSpread)) * 0.3);
        r.poly(MEM, k / 2, -2, SKIN, 0, { group: 3 + (side > 0 ? 1 : 0) }, tilt, -0.2);
        // Arm and finger bones over the membrane.
        const o = { group: 5 + (side > 0 ? 1 : 0) };
        r.capsule(shX, shY, 0.75, el.x, el.y, 0.55, -1, -1, BONE, o);
        r.capsule(el.x, el.y, 0.55, wx, wy, 0.42, -1, -1, BONE, o);
        for (const tp of [t0, t1, t2]) r.capsule(wx, wy, 0.38, tp.x, tp.y, 0.22, -1, -1, BONE, o);
        r.ellipse(wx, wy, 0.6, 0.6, 0, -0.5, BONE, o);
      } else {
        // Folded: the wing wraps the body like a cloak.
        const cx = body.x + rx * side * 1.8 - ux * 0.3, cy = body.y + ry * side * 1.8 - uy * 0.3;
        r.ellipse(cx, cy, 1.7, 4.0, Math.atan2(uy, ux) - Math.PI / 2 + side * 0.15, 1.5, SKIN, { group: 3 });
        r.capsule(cx + ux * 3.3, cy + uy * 3.3, 0.5, cx - ux * 3.2, cy - uy * 3.2, 0.35, 2.4, 2.4, BONE, { group: 5 });
      }
    }
    // --- Hind legs ---
    for (const c of rig.chains) chainTube(r, c, 0.5, FUR, { group: 1 }, 0.55, 0.35);
    // --- Body and head ---
    const ang = Math.atan2(uy, ux) - Math.PI / 2;
    r.ellipse(body.x, body.y, 2.3, 3.0, ang + F[BAT.bank] * 0.3, 1, FUR, { group: 1 });
    r.ellipse(head.x, head.y, 2.1, 1.9, ang, 2.5, FUR, { group: 1 });
    // Belly fur is a touch lighter.
    r.shade(body.x - ux * 0.4, body.y - uy * 0.4, 1.4, 2.0, ang, 0.7, 1);
    // Ears: tall, swivelling up when alert.
    const earUp = 2.4 + F[BAT.ear] * 1.2;
    for (const s of [-1, 1]) {
      const bx = head.x + rx * s * 1.1 + ux * 0.9, by = head.y + ry * s * 1.1 + uy * 0.9;
      const tx = bx + ux * earUp + rx * s * (0.8 + (1 - F[BAT.ear]) * 0.8), ty = by + uy * earUp + ry * s * (0.8 + (1 - F[BAT.ear]) * 0.8);
      r.poly([bx - rx * s * 0.9, by - ry * s * 0.9, tx, ty, bx + rx * s * 0.9, by + ry * s * 0.9], 3, 3, EAR, 0.8, { group: 1 });
      r.shade((bx + tx) / 2, (by + ty) / 2, 0.4, 1.0, ang, -1.2, 1);
    }
    // Face: two ember eyes, a pug nose, fangs when it bites.
    const gx = e.expression?.gazeX ?? 0, gy = e.expression?.gazeY ?? 0;
    const asleep = e.sleeping === true;
    for (const s of [-1, 1]) {
      const ex = head.x + rx * s * 0.85 - ux * 0.1 + gx * 0.3, ey = head.y + ry * s * 0.85 - uy * 0.1 + gy * 0.3;
      if (asleep) r.stroke(ex - 0.4, ey, ex + 0.4, ey, FUR, 0, true);
      else eye(r, ex, ey, 0.6, 0.62, ang, { eye: EYE, glint: GLINT }, 0, 0, 0);
    }
    const nx = head.x - ux * 0.9, ny = head.y - uy * 0.9;
    r.stamp(nx, ny, 0.7, 0.45, ang, NOSE, 0, false);
    const bite = (e.swoop ?? 0) > 0 || (e.expression?.jaw ?? 0) > 0.4;
    if (bite) for (const s of [-1, 1]) r.dot(nx + rx * s * 0.5 - ux * 0.7, ny + ry * s * 0.5 - uy * 0.7, FANG, 2, 90);
  },
};

import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { LNS, LNS_BODY, LNS_DROPS } from '@/creatures/species/lens';
import { markEye } from './anatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import type { SpeciesArt } from './types';

/**
 * THE LENSWRIGHT: a great grinding-lens in a riveted brass rim, hung in the
 * air of its gallery. Pale glass with a moving highlight; an iris of dark
 * brass leaves that opens on the lance's tell (the eye behind it a white-gold
 * burn); rivets round the rim that light one by one as the lance LOCKS; a
 * finial above, brass fins at the sides; five crystal drops swinging beneath
 * on their chains. Dazzled, the glass goes dark and cracked.
 */
const BRASS = 1, GLASS = 2, LEAF = 3, EYE = 4, CRYSTAL = 5, DARK = 6, LAMP = 7;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x1c1206, 0x4a3212, 0x8a6424, 0xc89a44, 0xf2d68a], gloss: 0.55, shine: 16, rim: 0.9, outline: 0x0c0804 }),
  material({ keys: [0x10202c, 0x2c5066, 0x5c8ea6, 0xa4d0e2, 0xecfaff], gloss: 0.85, shine: 26, rim: 1.4, translucent: 0.4, outline: 0x08121a }),
  material({ keys: [0x0e0a06, 0x241a0e, 0x4a3818, 0x6e5426], gloss: 0.4, rim: 0.6, outline: 0x060403 }),
  material({ keys: [0x5a3a08, 0xe0a030, 0xffe6a0, 0xffffff], emissive: 1, glow: 0x6a4a10, glowK: 1 }),
  material({ keys: [0x2a1e48, 0x6a58b4, 0xb4a6f2, 0xf0eaff], gloss: 0.7, shine: 22, rim: 1.3, translucent: 0.3, outline: 0x140e24 }),
  material({ keys: [0x030303, 0x0a0908, 0x14110e], outline: 0x020202 }),
  material({ keys: [0x4a2a06, 0xc88020, 0xffd070, 0xfff4d0], emissive: 1, glow: 0x5a3808, glowK: 0.8 }),
];

export const lensArt: SpeciesArt = {
  selfLit: true,
  materials: () => MATS,
  bounds(e, rig) {
    const y0 = e.y - 30;
    let x0 = e.x - 16, x1 = e.x + 16, y1 = e.y + 10;
    for (const c of rig.chains) for (const p of c.pts) { x0 = Math.min(x0, p.x - 3); x1 = Math.max(x1, p.x + 3); y1 = Math.max(y1, p.y + 3); }
    return [x0, y0, x1, y1];
  },
  lightProbe: (_e, rig) => [rig.pts[LNS_BODY].x, rig.pts[LNS_BODY].y, 12],
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, tick = ctx.state.frameCount;
    const c = rig.pts[LNS_BODY];
    const cx = c.x, cy = c.y;
    const face = F[LNS.face];
    const iris = F[LNS.iris], lock = F[LNS.lock], fire = F[LNS.fire], daz = F[LNS.dazzle];
    const R = 8.4, RX = R * (0.82 + Math.abs(face) * 0.18); // it turns a little toward its mark
    // Drops first (behind the rim): chains of crystal, a prism at the tip.
    for (let i = 0; i < LNS_DROPS; i++) {
      const pts = rig.chains[i].pts;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        const tip = k === pts.length - 1;
        r.capsule(a.x, a.y, 0.45, b.x, b.y, tip ? 1.1 : 0.55, -2 + k * 0.1, -2 + k * 0.1, tip ? CRYSTAL : BRASS, { group: 20 + i, tone: tip ? 0.3 : -0.2 });
      }
      const tipP = pts[pts.length - 1];
      if ((tick + i * 11) % 40 < 5) r.dot(tipP.x, tipP.y, CRYSTAL, 2.2);
    }
    // Fins and finial.
    for (const s of [-1, 1]) {
      r.capsule(cx + s * RX * 0.9, cy - 1, 1.3, cx + s * (RX + 3.2), cy - 3.5, 0.6, 0.5, 0.5, BRASS, { group: 2 });
    }
    r.capsule(cx, cy - R * 0.95, 1.2, cx, cy - R - 3.5, 0.7, 0.6, 0.6, BRASS, { group: 3 });
    r.ellipse(cx, cy - R - 4, 1.2, 1.2, 0, 0.7, BRASS, { group: 3 });
    // The rim.
    // (Flat volumes: the rim is a ring round a shallow glass dome, not a ball.)
    r.ellipse(cx, cy, RX + 1.9, R + 1.9, 0, 1, BRASS, { group: 1, depth: 0.12 });
    r.shade(cx - RX * 0.3, cy - R * 0.6, RX, R * 0.5, 0, 0.8, 1);
    // The glass.
    r.ellipse(cx, cy, RX, R, 0, 3, daz > 0.5 ? DARK : GLASS, { group: 4, depth: 0.22 });
    // A highlight crescent that drifts with its turn.
    r.shade(cx - RX * 0.35 + face * 1.5, cy - R * 0.45, RX * 0.45, R * 0.28, -0.5, 1.6, 4);
    // The iris: dark brass leaves from the rim in to the aperture.
    const ap = 1.2 + iris * (R - 2.2);
    const spin = F[LNS.spin];
    for (let k = 0; k < 7; k++) {
      const a = spin + (k / 7) * Math.PI * 2;
      const ox = cx + Math.cos(a) * (RX - 0.6), oy = cy + Math.sin(a) * (R - 0.6);
      const ix = cx + Math.cos(a + 0.5) * ap, iy = cy + Math.sin(a + 0.5) * ap * (R / RX);
      if (ap < R - 1.2) r.capsule(ox, oy, 1.8, ix, iy, 0.9, 5.5, 5.5, LEAF, { group: 5, depth: 0.2 });
    }
    // The eye behind the aperture: a white-gold burn when it opens, blinding when it fires.
    const burn = (0.6 + iris * 1.8 + fire * 2.4) * (1 - daz);
    r.glowStamp(cx, cy, Math.max(0.8, ap * 0.9), Math.max(0.8, ap * 0.9), 0, EYE, burn, 0.3, 4);
    markEye(cx + face * 0.6, cy, 1.2);
    // Rim rivets: they light round the ring as the lance locks.
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
      const X = cx + Math.cos(a) * (RX + 1.1), Y = cy + Math.sin(a) * (R + 1.1);
      const on = lock > 0.2 && k / 12 < lock;
      if (on) r.stamp(X, Y, 0.55, 0.55, 0, LAMP, 1.8 + fire * 1.4, true);
      else r.dot(X, Y, BRASS, 1.2, 3);
    }
    if (daz > 0.2) {
      // Dazzled: cracks across the dark glass.
      r.stroke(cx - RX * 0.6, cy - R * 0.2, cx + RX * 0.1, cy + R * 0.3, CRYSTAL, 1.5, true);
      r.stroke(cx + RX * 0.1, cy + R * 0.3, cx + RX * 0.5, cy - R * 0.4, CRYSTAL, 1.5, true);
    }
    if (e.hp < e.maxHp * 0.5) r.stroke(cx + RX * 0.2, cy - R * 0.8, cx + RX * 0.55, cy - R * 0.15, CRYSTAL, 1.2, true);
  },
};

import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { weaverLegGeometry } from '@/creatures/weaverAnatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import { markEye } from './anatomy';
import type { SpeciesArt } from './types';

/**
 * Weaver: lacquered black-violet chitin that only shows its shape where the
 * light slides over it, bone-pale bands on long jointed legs, a silk-green
 * sigil on the abdomen that flares when it weaves or strikes, and a cluster
 * of eyes that catches your lamp before anything else does.
 */
const CHITIN = 1, LEG = 2, BAND = 3, MARK = 4, EYE = 5, FANG = 6, ICHOR = 7, GLINT = 8, SILK = 9;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x040308, 0x0d0a14, 0x1b1629, 0x322a4a, 0x5c4f84], gloss: 0.85, shine: 24, rim: 1, outline: 0x020104 }),
  material({ keys: [0x040308, 0x0f0c17, 0x1f1a2e, 0x362e50, 0x5c5080], gloss: 0.55, shine: 18, rim: 0.9, outline: 0x020104 }),
  material({ keys: [0x1e1a24, 0x4a4454, 0x8a8494, 0xcfcad8], gloss: 0.4, rim: 0.6, outline: 0x060508 }),
  material({ keys: [0x0a3016, 0x229044, 0x6af094, 0xd8ffe4], emissive: 1, glow: 0x0a3a16, glowK: 0.8 }),
  material({ keys: [0x0c3a1c, 0x50e888, 0xeaffee], emissive: 1, glow: 0x0c4a20, glowK: 0.9 }),
  material({ keys: [0x1a1612, 0x6a6258, 0xc8c0b0, 0xfffaee], gloss: 0.8, shine: 30, rim: 0.7, outline: 0x040303 }),
  material({ keys: [0x2a2006, 0x7a6a18, 0xc8b43a], emissive: 0.4, outline: 0x0a0802 }),
  material({ keys: [0xeaffee, 0xffffff], emissive: 1 }),
  material({ keys: [0x8ab0a0, 0xd8f0e4, 0xffffff], emissive: 0.6, translucent: 0.3 }),
];

function drawLeg(r: CreatureRaster, e: Enemy, i: number, far: boolean): void {
  const j = weaverLegGeometry(e, i);
  const [hip, coxa, knee, ankle, foot] = j;
  const o = { group: 10 + i, far, tone: far ? -0.2 : 0.2 };
  const z = far ? -8 : 7;
  r.capsule(hip.x, hip.y, 1.35, coxa.x, coxa.y, 1.15, z, z, LEG, o);
  r.capsule(coxa.x, coxa.y, 1.1, knee.x, knee.y, 0.8, z, z + 0.5, LEG, o);
  r.capsule(knee.x, knee.y, 0.78, ankle.x, ankle.y, 0.5, z + 0.5, z + 0.8, LEG, o);
  r.capsule(ankle.x, ankle.y, 0.48, foot.x, foot.y, 0.26, z + 0.8, z + 1, LEG, o);
  // Pale bands at the joints, tarantula-style.
  r.stamp(knee.x, knee.y, 0.95, 0.95, 0, BAND, far ? 0 : 1, false, 10 + i);
  r.stamp(ankle.x, ankle.y, 0.62, 0.62, 0, BAND, far ? 0 : 1, false, 10 + i);
  const mx = coxa.x + (knee.x - coxa.x) * 0.55, my = coxa.y + (knee.y - coxa.y) * 0.55;
  r.stamp(mx, my, 0.7, 0.7, 0, BAND, 0, false, 10 + i);
}

export const weaverArt: SpeciesArt = {
  materials: () => MATS,
  bounds(e) {
    const loco = e.weaverLoco;
    const bx = loco?.px ?? e.x, by = loco?.py ?? e.y - 10;
    let x0 = bx - 28, x1 = bx + 28, y0 = by - 28, y1 = by + 28;
    if (loco) for (const l of loco.legs) { x0 = Math.min(x0, l.x - 3); x1 = Math.max(x1, l.x + 3); y0 = Math.min(y0, l.y - 3); y1 = Math.max(y1, l.y + 3); }
    return [x0, y0, x1, y1];
  },
  lightProbe: e => [e.weaverLoco?.px ?? e.x, e.weaverLoco?.py ?? e.y - 10, 14],
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, _rig: CreatureRig) {
    const loco = e.weaverLoco, tick = ctx.state.frameCount;
    const rig = e.expression;
    const nx = loco?.nx ?? 0, ny = loco?.ny ?? -1, tx = -ny, ty = nx, face = loco?.face ?? e.mind?.facing ?? 1;
    const bx = loco?.px ?? e.x, by = loco?.py ?? e.y - 10;
    const fear = rig?.fear ?? 0, hurt = rig?.hurt ?? 0, alert = rig?.alert ?? 0;
    const breath = Math.sin(tick * (0.047 + fear * 0.04) + e.bobPhase) * (0.45 + hurt * 0.25);
    const winding = (e.windup ?? 0) > 0, feeding = (e.weaverFeedT ?? 0) > 0, weaving = e.blink > 0;
    const angle = Math.atan2(ty * face, tx * face);
    const P = (along: number, out: number): [number, number] => [bx + tx * along * face + nx * out, by + ty * along * face + ny * out];
    const missing = e.weaverMissingLegs ?? 0;
    // Far legs (even sockets) behind everything.
    for (let i = 0; i < 8; i += 2) if (!(missing & (1 << i))) drawLeg(r, e, i, true);
    // Abdomen: a big glossy bulb, lifted and coiled back when it winds up.
    const [ax, ay] = P(-8.6 - (winding ? 1.6 : 0), 2.4 + breath * 0.6 + (winding ? 1 : 0));
    r.ellipse(ax, ay, 8.6, 6.6 + breath * 0.3, angle - face * 0.12, 0, CHITIN, { group: 1 });
    // Fine setae catch a sliver of light along the top of the abdomen.
    r.shade(...P(-9, 6.2), 6.5, 1.2, angle, 0.7, 1, 0.3);
    // The sigil: stacked chevrons down the dorsal line.
    const flare = 1 + (weaving ? 1.6 : 0) + (winding ? 1.1 : 0) + Math.min(1.2, (e.webPulse ?? 0) * 0.08) + alert * 0.4;
    for (let c = 0; c < 4; c++) {
      const along = -4.5 - c * 2.8, out = 5.1 - c * 0.25 + breath * 0.3;
      const w = 1.4 - c * 0.18;
      const [cx, cy] = P(along, out), [lx, ly] = P(along - 1.1, out - w), [rx2, ry2] = P(along - 1.1, out + w * 0.2);
      r.stroke(lx, ly, cx, cy, MARK, Math.min(3, 0.6 + flare * (1 - c * 0.18)), true, 0.42);
      r.stroke(cx, cy, rx2, ry2, MARK, Math.min(3, 0.4 + flare * (1 - c * 0.18)), true, 0.38);
    }
    // Spinnerets and the silk they pay out.
    const [sx, sy] = P(-17.2, 1.6);
    r.ellipse(sx, sy, 1.4, 1.1, angle, 1.5, CHITIN, { group: 1, tone: 0.4 });
    if (weaving || feeding) {
      const [ex, ey] = P(-21, -3 + Math.sin(tick * 0.2) * 1.5);
      r.capsule(sx, sy, 0.25, ex, ey, 0.15, 2, 2, SILK, { group: 2, noOutline: true });
    }
    // Pedicel + cephalothorax.
    r.capsule(...P(-1.5, 1), 1.6, ...P(1, 0.6), 1.9, 1, 1, CHITIN, { group: 3 });
    const [cx0, cy0] = P(2.6, 0.8 + breath * 0.25);
    r.ellipse(cx0, cy0, 6.2, 4.6, angle, 1.5, CHITIN, { group: 3, tone: 0.25 });
    // A groove down the carapace.
    r.stroke(...P(0, 3.4), ...P(5.5, 3.2), CHITIN, 0.2, false);
    // Near legs (odd sockets) over the body.
    for (let i = 1; i < 8; i += 2) if (!(missing & (1 << i))) drawLeg(r, e, i, false);
    // Stumps where legs were torn off.
    for (let i = 0; i < 8; i++) {
      if (!(missing & (1 << i))) continue;
      const j = weaverLegGeometry(e, i), hip = j[0];
      const sd = Math.sign(i < 4 ? -1 : 1) * face;
      const stx = hip.x + tx * sd * 2, sty = hip.y + ty * sd * 2;
      r.capsule(hip.x, hip.y, 1.3, stx, sty, 1.0, 4, 4, LEG, { group: 20 + i });
      r.ellipse(stx, sty, 0.9, 0.9, 0, 5, ICHOR, { group: 20 + i });
    }
    // Head: turns and rises on its own spring (weaverHeadX/Y).
    const [hx, hy] = P(9.2 + alert * 1.5 - fear * 2.5 + (e.weaverHeadX ?? 0) * 0.4, 1.2 + (e.weaverHeadY ?? 0) * 0.5 - (feeding ? 2 : 0) - hurt);
    r.ellipse(hx, hy, 3.8, 3.3, angle, 3, CHITIN, { group: 4, tone: 0.1 });
    const hp = (along: number, out: number): [number, number] => [hx + tx * along * face + nx * out, hy + ty * along * face + ny * out];
    // Pedipalps: little feelers that tap the air in front.
    for (const s of [-1, 1]) {
      const tap = Math.sin(tick * 0.09 + s * 1.7 + e.bobPhase) * (1 - alert * 0.6);
      r.capsule(...hp(2.5, -1.2 + s * 0.5), 0.5, ...hp(5.2 + tap * 0.6, -2.4 + s * 0.8 + tap * 0.5), 0.32, s > 0 ? 5 : 2, s > 0 ? 5 : 2, LEG, { group: 5, far: s < 0 });
    }
    // Chelicerae with hooked fangs that part when it bites or feeds.
    const gape = Math.max(rig?.jaw ?? 0, winding ? 0.8 : 0, feeding ? 0.4 + Math.sin(tick * 0.48) * 0.3 : 0);
    for (const s of [-1, 1]) {
      const spread = s * (0.4 + gape * 1.2);
      const [bxx, byy] = hp(3.0, -1.6 + s * 0.3), [kx, ky] = hp(4.6, -3.2 + spread * 0.5);
      r.capsule(bxx, byy, 1.1, kx, ky, 0.8, s > 0 ? 6 : 3.5, s > 0 ? 6 : 3.5, CHITIN, { group: 6, far: s < 0 });
      const [fx, fy] = hp(4.2 + gape * 0.4, -4.8 + spread * 0.4);
      r.capsule(kx, ky, 0.5, fx, fy, 0.14, 6.5, 6.5, FANG, { group: 6, far: s < 0 });
    }
    // Eyes: two big forward lenses and a crown of small ones.
    const lit = 1 + alert * 1.2 + (winding ? 0.8 : 0);
    const eyes: Array<[number, number, number]> = [[2.2, 1.1, 0.72], [2.4, -0.2, 0.62], [1.2, 2.0, 0.42], [0.4, 2.4, 0.38], [1.6, -1.1, 0.4], [-0.2, 1.6, 0.34]];
    for (const [al, ou, rad] of eyes) {
      const [ex, ey] = hp(al, ou);
      r.stamp(ex, ey, rad, rad, 0, EYE, Math.min(2, lit * (0.7 + rad)), true);
      markEye(ex, ey, rad);
      if (rad > 0.5) r.dot(ex - 0.2, ey - 0.25, GLINT, 1, 80);
    }
    // Hurt: a split in the carapace oozing ichor.
    if (hurt > 0.3) {
      r.stroke(...P(-11, 6), ...P(-8, 3.5), ICHOR, 1, true);
      r.stroke(...P(-8, 3.5), ...P(-9.5, 1.5), ICHOR, 1, true);
    }
  },
};

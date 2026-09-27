import type { Ctx, Enemy } from '@/core/types';
import { createChain } from '@/creatures/body';
import type { BodyNode } from '@/creatures/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { LEV_LINKS, SRP } from '@/creatures/species/serpents';
import { POLY } from './anatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import type { SpeciesArt } from './types';

const XS = new Float64Array(32), YS = new Float64Array(32), RS = new Float64Array(32);

function nodesOf(e: Enemy, count: number): BodyNode[] {
  return e.body?.nodes?.length ? e.body.nodes : createChain(e.x, e.y - 4, e.mind?.facing ?? 1, count).nodes;
}

/** Unit direction toward the head at node i, and the "up" (dorsal) normal. */
function frame(nodes: ReadonlyArray<{ x: number; y: number }>, i: number): [number, number, number, number] {
  const a = nodes[Math.max(0, i - 1)], b = nodes[Math.min(nodes.length - 1, i === 0 ? 1 : i)];
  let dx = a.x - b.x, dy = a.y - b.y;
  if (i === 0) { dx = nodes[0].x - nodes[1].x; dy = nodes[0].y - nodes[1].y; }
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  let ux = dy, uy = -dx;
  if (uy > 0 || (uy === 0 && ux > 0)) { ux = -ux; uy = -uy; }
  return [dx, dy, ux, uy];
}

/* ======================= Rillback: salamander-eel ======================= */

const R_SKIN = 1, R_BELLY = 2, R_FIN = 3, R_GILL = 4, R_LINE = 5, R_MOUTH = 6, R_TOOTH = 7, R_EYE = 8, R_GLINT = 9;
const RILL_MATS: CreatureMaterial[] = [
  material({ keys: [0x050908, 0x0e1a19, 0x1b3230, 0x2f5750, 0x588a7a], gloss: 0.8, shine: 22, rim: 0.9, outline: 0x020404 }),
  material({ keys: [0x1a1e18, 0x3a4436, 0x6a7a60, 0xa0b08e], gloss: 0.5, rim: 0.4, outline: 0x040504 }),
  material({ keys: [0x163a36, 0x2e6a60, 0x5aa89a, 0xb0f0e0], translucent: 0.45, emissive: 0.3, rim: 0.6, gloss: 0.4, outline: 0x0a1c1a }),
  material({ keys: [0x3a0a16, 0x8a2438, 0xd05a6e, 0xffa8b4], rim: 0.6, gloss: 0.4, emissive: 0.15, outline: 0x1a0408 }),
  material({ keys: [0x0a3a4a, 0x2ab0d8, 0xa0f4ff, 0xffffff], emissive: 1, glow: 0x0a4a60, glowK: 0.8 }),
  material({ keys: [0x0a0204, 0x2a080c, 0x4a1418] }),
  material({ keys: [0x9a9480, 0xe4dec8, 0xffffff] }),
  material({ keys: [0x010202, 0x061010, 0x0c1c1c], gloss: 1, shine: 40 }),
  material({ keys: [0xe8fff8, 0xffffff], emissive: 1 }),
];

export const rillbackArt: SpeciesArt = {
  materials: () => RILL_MATS,
  bounds(e) {
    const nodes = nodesOf(e, 9);
    let x0 = e.x - 12, x1 = e.x + 12, y0 = e.y - 16, y1 = e.y + 4;
    for (const n of nodes) { x0 = Math.min(x0, n.x - 8); x1 = Math.max(x1, n.x + 8); y0 = Math.min(y0, n.y - 8); y1 = Math.max(y1, n.y + 8); }
    return [x0, y0, x1, y1];
  },
  lightProbe: e => { const n = nodesOf(e, 9)[2]; return [n.x, n.y, 10]; },
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, tick = ctx.state.frameCount;
    const nodes = nodesOf(e, 9), n = nodes.length;
    const charge = F[SRP.charge];
    // Caudal fin fan at the tail tip.
    {
      const t = nodes[n - 1], [dx, dy, ux, uy] = frame(nodes, n - 1);
      const flick = Math.sin(F[SRP.swim] * 1.3) * 1.2;
      r.poly([t.x + dx * 1, t.y + dy * 1, t.x - dx * 4 + ux * (2.6 + flick), t.y - dy * 4 + uy * (2.6 + flick),
        t.x - dx * 5, t.y - dy * 5, t.x - dx * 4 - ux * (2.2 - flick), t.y - dy * 4 - uy * (2.2 - flick)], 4, -1, R_FIN, 0.4, { group: 2 });
    }
    // Continuous dorsal fin rippling down the back.
    let k = 0;
    for (let i = 1; i < n - 1; i++) {
      const p = nodes[i], [, , ux, uy] = frame(nodes, i), rad = Math.max(0.5, p.radius * 0.85);
      POLY[k++] = p.x + ux * rad * 0.5; POLY[k++] = p.y + uy * rad * 0.5;
    }
    for (let i = n - 2; i >= 1; i--) {
      const p = nodes[i], [, , ux, uy] = frame(nodes, i), rad = Math.max(0.5, p.radius * 0.85);
      const h = (2.4 - i * 0.18) * (1 + 0.35 * Math.sin(F[SRP.swim] * 2 - i * 0.9)) + (e.expression?.alert ?? 0) * 0.8;
      POLY[k++] = p.x + ux * (rad + h); POLY[k++] = p.y + uy * (rad + h);
    }
    r.poly(POLY, k / 2, -1, R_FIN, 0.35, { group: 2 });
    for (let i = 2; i < n - 1; i += 1) {
      const p = nodes[i], [, , ux, uy] = frame(nodes, i), rad = Math.max(0.5, p.radius * 0.85);
      r.stroke(p.x + ux * rad, p.y + uy * rad, p.x + ux * (rad + 1.6), p.y + uy * (rad + 1.6), R_FIN, 0.5, false);
    }
    // Body.
    let m = 0;
    for (let i = n - 1; i >= 0; i--) {
      XS[m] = nodes[i].x; YS[m] = nodes[i].y; RS[m] = Math.max(0.45, nodes[i].radius * (i === 0 ? 0.95 : 0.85) + (i === 1 ? 0.3 : 0)); m++;
    }
    r.tube(XS, YS, RS, m, 0, R_SKIN, { group: 1 });
    // Pale belly and the electric lateral line.
    for (let i = 1; i < n; i++) {
      const p = nodes[i], [dx, dy, ux, uy] = frame(nodes, i), rad = Math.max(0.5, p.radius * 0.85);
      r.stamp(p.x - ux * rad * 0.55, p.y - uy * rad * 0.55, 2.2, rad * 0.45, Math.atan2(dy, dx), R_BELLY, 1, false, 1);
      if (i < n - 1) {
        const flick = charge > 0.1 ? (((tick >> 1) + i) % 3 === 0 ? 3 : 2) : 0.7;
        r.dot(p.x + ux * rad * 0.05, p.y + uy * rad * 0.05, R_LINE, flick * (0.4 + charge * 0.6), 30);
      }
    }
    // Head: a flat salamander skull on a hinged jaw.
    const head = nodes[0], [hx, hy, ux, uy] = frame(nodes, 0);
    const P = (along: number, up: number): [number, number] => [head.x + hx * along + ux * up, head.y + hy * along + uy * up];
    const jaw = F[SRP.jaw], ang = Math.atan2(hy, hx);
    // External gills: coral fronds that flare when it is roused.
    const flare = F[SRP.gill];
    for (let g = 0; g < 3; g++) {
      const [bx, by] = P(-1.6 - g * 0.5, 1.3);
      // Back along the body, raised to three elevations like an axolotl's fronds.
      const back = Math.atan2(-hy, -hx), lift = (0.35 + g * 0.42 + flare * 0.25);
      const a = back + (Math.atan2(uy, ux) - back > 0 ? 1 : -1) * 0 + lift * ((Math.cos(back) * uy - Math.sin(back) * ux) > 0 ? -1 : 1);
      const L = 3.4 + flare * 1.4 - g * 0.3;
      const tx = bx + Math.cos(a) * L, ty = by + Math.sin(a) * L;
      r.capsule(bx, by, 0.55, tx, ty, 0.35, 4.5, 4.5, R_GILL, { group: 5 });
      for (let f = 1; f <= 3; f++) {
        const q = f / 3.5, fx = bx + (tx - bx) * q, fy = by + (ty - by) * q;
        r.ellipse(fx, fy, 0.7, 0.4, a + Math.PI / 2, 4.6, R_GILL, { group: 5 });
      }
    }
    // Lower jaw.
    const side = hx >= 0 ? 1 : -1;
    const ja = ang + side * jaw * 0.7;
    const [jhx, jhy] = P(-1.4, -0.6);
    const jx = Math.cos(ja), jy = Math.sin(ja);
    r.capsule(jhx, jhy, 1.3, jhx + jx * 4.6, jhy + jy * 4.6, 0.6, 3, 3, R_SKIN, { group: 6 });
    if (jaw > 0.12) {
      const [a1, a2] = P(-1, -0.3), [b1, b2] = P(3.8, -0.4);
      r.poly([a1, a2, b1, b2, jhx + jx * 4.2, jhy + jy * 4.2], 3, 3.2, R_MOUTH, 0, { group: 7, noOutline: true });
      for (let t = 0; t < 3; t++) {
        const [tx, ty] = P(0.6 + t * 1.1, -0.6);
        r.dot(tx, ty, R_TOOTH, 1, 9);
        r.dot(jhx + jx * (1.6 + t * 1.0) + ux * 0.4, jhy + jy * (1.6 + t * 1.0) + uy * 0.4, R_TOOTH, 1, 9);
      }
    }
    r.ellipse(...P(0.6, 0.3), 3.2, 2.3, ang, 4, R_SKIN, { group: 6 });
    r.ellipse(...P(2.8, 0.1), 2.2, 1.5, ang, 4, R_SKIN, { group: 6 });
    const [ex, ey] = P(1.2, 1.1);
    r.stamp(ex, ey, 0.6, 0.55, 0, R_EYE, 0, false);
    r.dot(ex - 0.2, ey - 0.2, R_GLINT, 1, 50);
    if (charge > 0.2) r.glowStamp(...P(0, 0), 1.2, 1.2, 0, R_LINE, 1 + charge * 2, 0.3, 6);
  },
};

/* ======================= Stone Maw: burrowing centipede ======================= */

const S_PLATE = 1, S_JOINT = 2, S_LEG = 3, S_MANDIBLE = 4, S_PIT = 5, S_FEELER = 6;
const MAW_MATS: CreatureMaterial[] = [
  material({ keys: [0x090807, 0x1a1714, 0x302b24, 0x524a3c, 0x867a62], gloss: 0.5, shine: 16, rim: 0.9, outline: 0x040303 }),
  material({ keys: [0x3a1400, 0x9a4a0a, 0xf09a2c, 0xffe0a0], emissive: 1, glow: 0x4a1c02, glowK: 0.6 }),
  material({ keys: [0x1a140c, 0x3e3220, 0x6a583a, 0xa08a60], rim: 0.7, gloss: 0.3, outline: 0x060403 }),
  material({ keys: [0x2a2418, 0x6e6450, 0xb4a888, 0xefe6cc], gloss: 0.7, shine: 24, rim: 0.7, outline: 0x080604 }),
  material({ keys: [0x020201, 0x080706, 0x100e0c] }),
  material({ keys: [0x1a160f, 0x3e3526, 0x6a5c44, 0x9a8a6a], rim: 0.5, outline: 0x060504 }),
  material({ keys: [0x14110d, 0x2c261e, 0x4a4234], rim: 0.3, outline: 0x040303 }),
];

export const stonemawArt: SpeciesArt = {
  materials: () => MAW_MATS,
  bounds(e) {
    const nodes = nodesOf(e, 7);
    let x0 = e.x - 14, x1 = e.x + 14, y0 = e.y - 16, y1 = e.y + 3;
    for (const n of nodes) { x0 = Math.min(x0, n.x - 9); x1 = Math.max(x1, n.x + 9); y0 = Math.min(y0, n.y - 12); y1 = Math.max(y1, n.y + 6); }
    return [x0, y0, x1, y1];
  },
  lightProbe: e => { const n = nodesOf(e, 7)[1]; return [n.x, n.y, 10]; },
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, tick = ctx.state.frameCount;
    const nodes = nodesOf(e, 7), n = nodes.length;
    const ground = e.y + 1;
    const stun = (e.mawStun ?? 0) > 0;
    // Legs: a pair per segment, rippling in a metachronal wave.
    const legPass = (far: boolean): void => {
      for (let i = 1; i < n; i++) {
        const p = nodes[i], [dx] = frame(nodes, i);
        const ph = F[SRP.walk] * 1.6 - i * 0.85 + (far ? Math.PI : 0) + (stun ? Math.sin(tick * 0.8 + i) * 2 : 0);
        const reach = Math.sin(ph) * 1.4, lift = Math.max(0, Math.cos(ph)) * 0.9;
        const bx = p.x + (far ? -dx * 0.4 : dx * 0.3), by = p.y + 0.4;
        const fx = bx + dx * (reach + (far ? -1.2 : 1.2)), fy = ground - 0.3 - lift;
        const kx = bx + dx * (reach * 0.5 + (far ? -2 : 2)), ky = by - 1.4;
        const z = far ? -5 : 5, o = { group: 20 + i + (far ? 10 : 0), far };
        r.capsule(bx, by, 0.55, kx, ky, 0.42, z, z, S_LEG, o);
        r.capsule(kx, ky, 0.42, fx, fy, 0.22, z, z, S_LEG, o);
      }
    };
    legPass(true);
    // Tail cerci.
    {
      const t = nodes[n - 1], [dx, dy, ux, uy] = frame(nodes, n - 1);
      for (const s of [-1, 1]) r.capsule(t.x, t.y, 0.6, t.x - dx * 3.4 + ux * s * 1.3, t.y - dy * 3.4 + uy * s * 1.3, 0.2, -1, -1, S_MANDIBLE, { group: 3 });
    }
    // A hot core runs the length of the animal; short armour plates ride it,
    // so the amber shows in every gap between them.
    let m2 = 0;
    for (let i = n - 1; i >= 1; i--) { XS[m2] = nodes[i].x; YS[m2] = nodes[i].y - 0.6; RS[m2] = Math.max(0.8, nodes[i].radius * 0.6); m2++; }
    XS[m2] = nodes[0].x; YS[m2] = nodes[0].y - 0.6; RS[m2] = 2; m2++;
    r.tube(XS, YS, RS, m2, -0.5, S_JOINT, { group: 3, noOutline: true });
    for (let i = n - 1; i >= 1; i--) {
      const p = nodes[i], [dx, dy, ux, uy] = frame(nodes, i);
      const rad = Math.max(1, p.radius * 0.95), ang = Math.atan2(dy, dx);
      const cx = p.x + ux * 0.9, cy = p.y + uy * 0.9;
      r.ellipse(cx, cy, 1.75, rad, ang, 0.5 + i * 0.05, S_PLATE, { group: 4 + (i % 2) });
      // A raised keel catching the light, a darker trailing lip.
      r.shade(cx + ux * rad * 0.55, cy + uy * rad * 0.55, 1.3, 0.55, ang, 1.1, 4 + (i % 2), 0.4);
      r.shade(cx - dx * 1.2, cy - dy * 1.2, 0.5, rad, ang, -0.9, 4 + (i % 2), 0.3);
    }
    // The core breathes.
    for (let i = 1; i < n; i++) r.dot(nodes[i].x + (nodes[i - 1].x - nodes[i].x) * 0.5, nodes[i].y - 0.6 + (nodes[i - 1].y - nodes[i].y) * 0.5, S_JOINT, 2 + Math.sin(tick * 0.1 + i) * 0.8, 3);
    legPass(false);
    // Head: a blunt digging shield with a four-way maw.
    const head = nodes[0], [hx, hy, ux, uy] = frame(nodes, 0);
    const P = (along: number, up: number): [number, number] => [head.x + hx * along + ux * up, head.y + hy * along + uy * up];
    const ang = Math.atan2(hy, hx);
    const jaw = F[SRP.jaw] + (stun ? Math.sin(tick * 0.5) * 0.2 : 0);
    // Mandibles open like a flower when it chews or bites.
    for (const [up, far] of [[1, true], [-1, true], [1, false], [-1, false]] as Array<[number, boolean]>) {
      const spread = (0.25 + jaw * 0.85) * up * (far ? 0.6 : 1);
      const [bx, by] = P(2.8, up * 1.0);
      const a = ang + spread;
      const tx = bx + Math.cos(a) * 3.8, ty = by + Math.sin(a) * 3.8;
      const hook = ang - up * 0.9;
      r.capsule(bx, by, 0.75, tx, ty, 0.45, far ? 2 : 6, far ? 2 : 6, S_MANDIBLE, { group: 8, far });
      r.capsule(tx, ty, 0.45, tx + Math.cos(hook) * 1.4, ty + Math.sin(hook) * 1.4, 0.12, far ? 2 : 6, far ? 2 : 6, S_MANDIBLE, { group: 8, far });
    }
    if (jaw > 0.3) r.ellipse(...P(3, 0), 1.2 + jaw * 0.6, 0.9 + jaw * 0.6, ang, 3, S_PIT, { group: 7, noOutline: true });
    r.ellipse(...P(0.4, 0.2), 3.8, 3.1, ang, 4, S_PLATE, { group: 6, tone: 0.3 });
    r.ellipse(...P(-1.6, 0.6), 2.4, 2.6, ang, 4, S_PLATE, { group: 6 });
    // Sensory pits instead of eyes.
    for (let s = 0; s < 3; s++) r.stamp(...P(1.2 + s * 0.7, 1.6 - s * 0.3), 0.32, 0.32, 0, S_PIT, 0, true);
    // Feelers: long, twitching, turning toward vibration.
    for (const [ant, off] of [[F[SRP.antA], 0.6], [F[SRP.antB], -0.2]] as Array<[number, number]>) {
      let px = P(1.6, 2.2 + off)[0], py = P(1.6, 2.2 + off)[1];
      let a = ang + (hx >= 0 ? -1 : 1) * (0.5 + ant * 0.6);
      for (let s = 0; s < 5; s++) {
        const L = 2.2 - s * 0.2;
        const nx2 = px + Math.cos(a) * L, ny2 = py + Math.sin(a) * L;
        r.capsule(px, py, 0.32 - s * 0.04, nx2, ny2, 0.28 - s * 0.04, 7, 7, S_FEELER, { group: 9 + (off > 0 ? 1 : 0) });
        px = nx2; py = ny2; a += (hx >= 0 ? 1 : -1) * (0.18 + ant * 0.12);
      }
    }
  },
};

/* ======================= Leviathan ======================= */

const L_SKIN = 1, L_BELLY = 2, L_SPINE = 3, L_SPOT = 4, L_MOUTH = 5, L_TOOTH = 6, L_EYE = 7, L_LURE = 8, L_FIN = 9, L_STALK = 10;
const LEV_MATS: CreatureMaterial[] = [
  material({ keys: [0x02050a, 0x07121e, 0x102438, 0x1c3e5a, 0x38688a], gloss: 0.85, shine: 20, rim: 1, outline: 0x010204 }),
  material({ keys: [0x141c1e, 0x34443f, 0x607266, 0x98a894], gloss: 0.4, rim: 0.4, outline: 0x020304 }),
  material({ keys: [0x06080a, 0x141a20, 0x283640, 0x4a6070], gloss: 0.6, rim: 0.7, outline: 0x010204 }),
  material({ keys: [0x0a3a4a, 0x28b0d0, 0x9af0ff, 0xffffff], emissive: 1, glow: 0x08364a, glowK: 0.7 }),
  material({ keys: [0x0a0204, 0x2a060c, 0x501018, 0x6a1a22] }),
  material({ keys: [0x8a8474, 0xd8d2c0, 0xffffff], gloss: 0.6, rim: 0.4, outline: 0x141210 }),
  material({ keys: [0x1a4a2a, 0x80ffb0, 0xf0fff4], emissive: 1, glow: 0x0a3a1a, glowK: 0.8 }),
  material({ keys: [0x1a7aa0, 0x7ae8ff, 0xf0ffff, 0xffffff], emissive: 1, glow: 0x1a6a90, glowK: 1.5 }),
  material({ keys: [0x061626, 0x103050, 0x205a80, 0x4a90b8], translucent: 0.35, rim: 0.6, gloss: 0.5, outline: 0x02060a }),
  material({ keys: [0x04080e, 0x0c1a28, 0x183248], rim: 0.5, outline: 0x010204 }),
];

export const leviathanArt: SpeciesArt = {
  selfLit: true,
  materials: () => LEV_MATS,
  bounds(e, rig) {
    let x0 = e.x - 30, x1 = e.x + 30, y0 = e.y - 40, y1 = e.y + 6;
    for (const c of rig.chains) for (const p of c.pts) { x0 = Math.min(x0, p.x - 12); x1 = Math.max(x1, p.x + 12); y0 = Math.min(y0, p.y - 12); y1 = Math.max(y1, p.y + 12); }
    return [x0, y0, x1, y1];
  },
  lightProbe: (_e, rig) => [rig.pts[0].x, rig.pts[0].y, 16],
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, tick = ctx.state.frameCount;
    const head = rig.pts[0], body = rig.chains[0], lure = rig.chains[1];
    const pts = body.pts, n = pts.length;
    const fs = F[SRP.face] >= 0 ? 1 : -1;
    const beached = F[SRP.beach];
    // Dorsal spines, raked back.
    for (let i = 1; i < Math.min(n - 1, 10); i++) {
      const p = pts[i], [dx, dy, ux, uy] = frame(pts, i), rad = body.radius[i];
      const h = (4.6 - i * 0.32) * (1 + (e.expression?.alert ?? 0) * 0.3);
      r.poly([p.x + ux * rad * 0.7 + dx * 1.4, p.y + uy * rad * 0.7 + dy * 1.4, p.x + ux * (rad + h) - dx * 2.2, p.y + uy * (rad + h) - dy * 2.2,
        p.x + ux * rad * 0.7 - dx * 1.8, p.y + uy * rad * 0.7 - dy * 1.8], 3, -2, L_SPINE, 0.5, { group: 2 });
    }
    // Tail fin.
    {
      const t = pts[n - 1], [dx, dy, ux, uy] = frame(pts, n - 1);
      const flick = Math.sin(F[SRP.swim] * 1.2) * 2;
      r.poly([t.x + dx, t.y + dy, t.x - dx * 6 + ux * (4 + flick), t.y - dy * 6 + uy * (4 + flick), t.x - dx * 7, t.y - dy * 7,
        t.x - dx * 6 - ux * (3 - flick), t.y - dy * 6 - uy * (3 - flick)], 4, -1, L_FIN, 0.6, { group: 3 });
    }
    // Body.
    let m = 0;
    for (let i = n - 1; i >= 0; i--) { XS[m] = pts[i].x; YS[m] = pts[i].y; RS[m] = body.radius[i]; m++; }
    XS[m] = head.x - fs * 1; YS[m] = head.y; RS[m] = 7.4; m++;
    r.tube(XS, YS, RS, m, 0, L_SKIN, { group: 1 });
    // Pale belly and a line of cold lights down the flank.
    const pulse = F[SRP.lure] * (1 - beached * 0.6);
    for (let i = 0; i < n; i++) {
      const p = pts[i], [dx, dy, ux, uy] = frame(pts, i), rad = body.radius[i];
      r.stamp(p.x - ux * rad * 0.55, p.y - uy * rad * 0.55, 3.2, rad * 0.45, Math.atan2(dy, dx), L_BELLY, 1, false, 1);
      if (i < n - 2) {
        const on = ((tick >> 3) + i) % 5 !== 0;
        r.stamp(p.x + ux * rad * 0.1, p.y + uy * rad * 0.1, 0.55, 0.55, 0, L_SPOT, on ? 1 + pulse * 1.6 : 0.4, true, 1);
        if (i % 2 === 0) r.stamp(p.x + ux * rad * 0.45 - dx, p.y + uy * rad * 0.45 - dy, 0.4, 0.4, 0, L_SPOT, on ? 0.6 + pulse : 0.2, true, 1);
      }
    }
    // Pectoral fin behind the head, sculling.
    {
      const [dx, dy] = frame(pts, 1);
      const scull = Math.sin(F[SRP.swim] * 1.6) * 0.5;
      const bx = pts[1].x + dx * 1, by = pts[1].y + 3;
      r.poly([bx, by, bx - dx * 3 + (-dy) * 0, by + 6 + scull * 3, bx - dx * 8, by + 3.5 + scull * 2], 3, 6, L_FIN, 0.5, { group: 4 });
    }
    // Head: a huge skull on a hinged jaw.
    const hx = head.x, hy = head.y;
    const jaw = Math.min(1.05, F[SRP.jaw] + (beached > 0.5 ? Math.max(0, Math.sin(tick * 0.05)) * 0.4 : 0));
    const ja = jaw * 0.75 * fs;
    const hingeX = hx - fs * 3.5, hingeY = hy + 1.8;
    const jx = Math.cos(ja) * fs, jy = Math.sin(ja) * fs * fs;
    const jawTipX = hingeX + jx * 14, jawTipY = hingeY + Math.abs(jy) * 14 + 0.8;
    if (jaw > 0.1) {
      r.poly([hingeX, hingeY - 1, hx + fs * 9.5, hy + 1.6, jawTipX, jawTipY - 1.2, hingeX + jx * 3, hingeY + Math.abs(jy) * 3], 4, 6, L_MOUTH, 0, { group: 5, noOutline: true });
      // Teeth: needles along both jaws.
      for (let t = 0; t < 6; t++) {
        const ux2 = hx - fs * 1.5 + fs * t * 1.8, uy2 = hy + 1.8;
        r.poly([ux2 - 0.5, uy2, ux2 + 0.5, uy2, ux2 + fs * 0.2, uy2 + 1.8], 3, 7, L_TOOTH, 0, { group: 6 });
        const q = 0.25 + t * 0.12, lx = hingeX + (jawTipX - hingeX) * q, ly = hingeY + (jawTipY - hingeY) * q - 0.4;
        r.poly([lx - 0.45, ly, lx + 0.45, ly, lx, ly - 1.6], 3, 7, L_TOOTH, 0, { group: 6 });
      }
    }
    r.capsule(hingeX, hingeY + 0.4, 2.8, jawTipX, jawTipY, 1.1, 5, 5.5, L_SKIN, { group: 7 });
    r.stamp((hingeX + jawTipX) / 2, (hingeY + jawTipY) / 2 + 1.2, 5, 1.1, Math.atan2(jawTipY - hingeY, jawTipX - hingeX), L_BELLY, 1, false, 7);
    r.ellipse(hx - fs * 1.2, hy - 1.6, 8.2, 6.0, fs * -0.1, 6, L_SKIN, { group: 8 });
    r.ellipse(hx + fs * 5.4, hy + 0.4, 5.2, 3.2, fs * 0.08, 6, L_SKIN, { group: 8 });
    // Gill slits.
    for (let g = 0; g < 3; g++) r.stroke(hx - fs * (6 + g * 1.3), hy - 2.5 + g * 0.3, hx - fs * (6.6 + g * 1.3), hy + 2.2, L_MOUTH, 1, true);
    // Eye: small, high and cold.
    r.stamp(hx + fs * 2.4, hy - 3.6, 0.9, 0.8, 0, L_EYE, 2, true);
    r.dot(hx + fs * 2.2, hy - 3.9, L_LURE, 3, 90);
    // The angler's lure.
    for (let i = 1; i < lure.pts.length; i++) {
      const a = lure.pts[i - 1], b = lure.pts[i];
      r.capsule(a.x, a.y, 0.55 - i * 0.05, b.x, b.y, 0.5 - i * 0.05, 4, 4, L_STALK, { group: 9 });
    }
    const tip = lure.pts[lure.pts.length - 1];
    const lr = 1.5 + F[SRP.lure] * 0.5;
    r.ellipse(tip.x, tip.y + 0.8, lr, lr * 1.1, 0, 5, L_LURE, { group: 10, noOutline: true });
    r.glowStamp(tip.x, tip.y + 0.8, lr, lr * 1.1, 0, L_LURE, 1.5 + F[SRP.lure] * 1.5, 0.8, 10);
  },
};

export const LEVIATHAN_LINKS = LEV_LINKS;

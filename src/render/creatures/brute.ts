import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { BR, BR_CHEST, BR_HEAD, BR_HIPS, bruteSpec } from '@/creatures/species/brute';
import { markEye } from './anatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import type { SpeciesArt } from './types';

/**
 * Brutes: layered stone with lichen in the seams, a furnace heart glowing
 * through the cracks (dimming to grey when doused), a small sunk head with
 * one hot slit of an eye, forearms bigger than the head.
 */
const STONE = 1, PLATE = 2, MOSS = 3, HOT = 4, EYE = 5, IRON = 6, DARK = 7;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x0b0b0a, 0x1d1d1a, 0x363530, 0x57554b, 0x86826e], gloss: 0.08, rim: 0.8, outline: 0x050504 }),
  material({ keys: [0x100f0d, 0x282620, 0x4a463a, 0x7a7460, 0xb4ac90], gloss: 0.15, shine: 10, rim: 0.9, outline: 0x050504 }),
  material({ keys: [0x0e1608, 0x223612, 0x3c5a1e, 0x668634, 0x9ab85a], rim: 0.4, outline: 0x070706 }),
  material({ keys: [0x3a0c02, 0xa03206, 0xf07a18, 0xffc860, 0xfff4c8], emissive: 1, glow: 0x6a2406, glowK: 0.9 }),
  material({ keys: [0x6a3000, 0xffa020, 0xffe8a0, 0xffffff], emissive: 1, glow: 0x6a3a08, glowK: 1 }),
  material({ keys: [0x080606, 0x1a1614, 0x302824, 0x4a3e36], gloss: 0.3, rim: 0.5, outline: 0x040303 }),
  material({ keys: [0x040403, 0x0c0b0a, 0x161512], outline: 0x020202 }),
];

function limb(r: CreatureRaster, rig: CreatureRig, i: number, hx: number, hy: number, z: number, far: boolean, S: number, arm: boolean): void {
  const leg = rig.legs[i];
  const o = { group: 10 + i, far, tone: far ? 0 : 0.3 };
  if (arm) {
    r.capsule(hx, hy, 2.2 * S, leg.kx, leg.ky, 1.7 * S, z, z + 1, STONE, o);
    r.capsule(leg.kx, leg.ky, 1.8 * S, leg.x, leg.y - 2.2 * S, 2.5 * S, z + 1, z + 2, PLATE, o);
    // A fist like a boulder, knuckles down.
    const fx = leg.x, fy = leg.y - 2.1 * S;
    r.ellipse(fx, fy, 2.9 * S, 2.3 * S, 0.2, z + 2.5, PLATE, o);
    for (let k = -1; k <= 1; k++) r.shade(fx + k * 1.3 * S, fy + 1.2 * S, 0.7 * S, 0.5 * S, 0, -1.2, 10 + i, 0.5);
  } else {
    r.capsule(hx, hy, 2.6 * S, leg.kx, leg.ky, 2.1 * S, z, z + 0.5, STONE, o);
    r.capsule(leg.kx, leg.ky, 2.1 * S, leg.x, leg.y - 1.2 * S, 1.7 * S, z + 0.5, z + 1, STONE, o);
    r.ellipse(leg.x + 0.5 * S, leg.y - 1.0 * S, 2.4 * S, 1.2 * S, 0, z + 1.2, PLATE, o);
  }
}

export const bruteArt: SpeciesArt = {
  selfLit: true,
  materials: () => MATS,
  bounds(e, rig) {
    const S = bruteSpec(e).scale;
    let x0 = e.x - 16 * S, x1 = e.x + 16 * S, y0 = e.y - 30 * S, y1 = e.y + 3;
    for (const p of rig.pts) { x0 = Math.min(x0, p.x - 9 * S); x1 = Math.max(x1, p.x + 9 * S); y0 = Math.min(y0, p.y - 10 * S); }
    for (const l of rig.legs) { x0 = Math.min(x0, l.x - 4 * S); x1 = Math.max(x1, l.x + 4 * S); y0 = Math.min(y0, l.y - 5 * S); y1 = Math.max(y1, l.y + 2); }
    return [x0, y0, x1, y1];
  },
  lightProbe: (e, rig) => [rig.pts[BR_CHEST].x, rig.pts[BR_CHEST].y, 12 * bruteSpec(e).scale],
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig) {
    const F = rig.f, spec = bruteSpec(e), S = spec.scale, tick = ctx.state.frameCount;
    const colossus = e.kind === 'colossus';
    const hips = rig.pts[BR_HIPS], chest = rig.pts[BR_CHEST], head = rig.pts[BR_HEAD];
    const fs = F[BR.face] >= 0 ? 1 : -1;
    const heat = F[BR.heat];
    const hipAt = (i: number): [number, number] => {
      const arm = i >= 2, far = i % 2 === 1, a = arm ? chest : hips;
      return [a.x + (far ? fs * 1.2 * S : -fs * 0.4 * S), a.y + (arm ? 0.5 * S : 0.8 * S)];
    };
    // Far limbs.
    { const [x, y] = hipAt(1); limb(r, rig, 1, x, y, -8 * S, true, S, false); }
    { const [x, y] = hipAt(3); limb(r, rig, 3, x, y, -8 * S, true, S, true); }
    // Torso: a hunched barrel, humped over the shoulders.
    const dx = chest.x - hips.x, dy = chest.y - hips.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    // "Up" off the spine, toward the back.
    let upx = uy, upy = -ux;
    if (upy > 0) { upx = -upx; upy = -upy; }
    const midX = hips.x + dx * 0.55 + upx * 1.2 * S, midY = hips.y + dy * 0.55 + upy * 1.2 * S;
    r.capsule(hips.x, hips.y, 4.0 * S, midX, midY, 5.0 * S, 0, 0.5, STONE, { group: 1 });
    r.capsule(midX, midY, 5.0 * S, chest.x, chest.y, 4.6 * S, 0.5, 1, STONE, { group: 1 });
    // The furnace heart: seen through a split in the chest, cracks radiating.
    const coreX = chest.x + ux * 1.6 * S + upx * 0.4 * S, coreY = chest.y + uy * 1.6 * S + upy * 0.4 * S;
    // Boss reads (the Kiln Colossus): venting lifts the plates and whitens the
    // seams; a dying kiln's core overloads; without its plates the furnace is bare.
    const vent = colossus ? F[BR.vent] : 0, over = colossus ? F[BR.overload] : 0;
    const bare = colossus && (e.boss?.plates ?? 6) <= 0;
    const flicker = over > 0 ? 0.7 + Math.sin(tick * 0.9) * 0.3 : 1;
    const pulse = (heat * (0.85 + Math.sin(tick * 0.12 + e.bobPhase) * 0.15) + vent * 0.7) * (1 + over * 2.6) * flicker;
    r.glowStamp(coreX, coreY, (colossus ? 3.8 : 2.6) * S * 0.8, (colossus ? 3.2 : 2.3) * S * 0.8, Math.atan2(dy, dx), HOT, 0.8 + pulse * 2.8, 0.2, 1);
    for (let c = 0; c < (colossus ? 7 : 5); c++) {
      const a = c * 1.1 + 0.6 + e.bobPhase;
      const L = (2.4 + (c % 3) * 1.2) * S;
      const ex = coreX + Math.cos(a) * L, ey = coreY + Math.sin(a) * L * 0.8;
      r.stroke(coreX + Math.cos(a) * 1.5 * S, coreY + Math.sin(a) * 1.2 * S, ex, ey, HOT, Math.max(0, pulse * 2.4 - (c % 2) * 0.6), true);
    }
    if (colossus) {
      // Kiln grate over the heart.
      for (let b = -2; b <= 2; b++) {
        const gx = coreX + b * 1.2 * S;
        r.stroke(gx, coreY - 2.4 * S, gx, coreY + 2.4 * S, IRON, 1, true);
      }
    }
    if (bare) {
      // The plates are gone: the furnace runs molten down its whole back.
      for (let k = 0; k <= 6; k++) {
        const t = 0.08 + k / 6 * 0.9;
        const bx = hips.x + dx * t + upx * (3.2 + Math.sin(t * Math.PI) * 1.4) * S, by = hips.y + dy * t + upy * (3.2 + Math.sin(t * Math.PI) * 1.4) * S;
        r.glowStamp(bx, by, (1.6 + Math.sin(t * Math.PI)) * S, 1.1 * S, Math.atan2(dy, dx), HOT, 0.6 + pulse * 2.2, 0.35, 1);
      }
    }
    // Back plates: overlapping slabs down the spine, lichen in the seams.
    const plates = bare ? 0 : colossus ? 6 : 4;
    const lift = vent * 1.4 * S;
    for (let p = 0; p < plates; p++) {
      const t = 0.05 + p / (plates - 1) * 0.95;
      const bx = hips.x + dx * t + upx * ((3.6 + Math.sin(t * Math.PI) * 1.6) * S + lift);
      const by = hips.y + dy * t + upy * ((3.6 + Math.sin(t * Math.PI) * 1.6) * S + lift);
      const rw = (2.8 + Math.sin(t * Math.PI) * 1.4) * S, rh = (1.9 + Math.sin(t * Math.PI) * 0.6) * S;
      r.ellipse(bx, by, rw, rh, Math.atan2(dy, dx) + (p % 2 ? 0.18 : -0.12), 3 * S + p * 0.3, PLATE, { group: 2 + p });
      r.shade(bx - upx * rh * 0.5, by - upy * rh * 0.5, rw * 0.8, rh * 0.45, Math.atan2(dy, dx), -0.8, 2 + p);
      // Molten seam where the slab meets the body.
      if (p > 0 && p < plates - 1 + (colossus ? 1 : 0)) {
        const sx0 = bx - upx * rh * 0.85 - ux * rw * 0.7, sy0 = by - upy * rh * 0.85 - uy * rw * 0.7;
        const sx1 = bx - upx * rh * 0.85 + ux * rw * 0.5, sy1 = by - upy * rh * 0.85 + uy * rw * 0.5;
        r.stroke(sx0, sy0, sx1, sy1, HOT, Math.max(0, pulse * 2.2 - 0.3), true);
        if (vent > 0.2) r.glowStamp((sx0 + sx1) / 2 + upx * lift * 0.5, (sy0 + sy1) / 2 + upy * lift * 0.5, rw * 0.6, 0.6 * S, Math.atan2(dy, dx), EYE, vent * 2.4, 0.4, 2 + p);
      }
      if ((p + (colossus ? 1 : 0)) % 2 === 0) r.stamp(bx + upx * rh * 0.55 - ux * rw * 0.3, by + upy * rh * 0.55, rw * 0.55, rh * 0.35, Math.atan2(dy, dx), MOSS, 1, false, 2 + p);
    }
    if (colossus) {
      // Chimney stacks breathing embers from the kiln.
      for (const s of [-1, 1]) {
        const bx = chest.x - dx * 0.35 + upx * 3.5 * S + s * ux * 2.2 * S, by = chest.y - dy * 0.35 + upy * 3.5 * S;
        const tx = bx + upx * 5.5 * S - fs * 1.2 * S * s, ty = by + upy * 5.5 * S;
        r.capsule(bx, by, 1.4 * S, tx, ty, 1.1 * S, 8 * S, 9 * S, IRON, { group: 20 + (s > 0 ? 1 : 0) });
        r.ellipse(tx, ty, 1.0 * S, 0.5 * S, 0, 9.5 * S, DARK, { group: 20 + (s > 0 ? 1 : 0) });
        r.glowStamp(tx, ty, 0.9 * S, 0.4 * S, 0, HOT, pulse * 3, 0.5, 20 + (s > 0 ? 1 : 0));
      }
    }
    // Jet vents on the golem's back: live when the thrusters burn.
    if (!colossus && F[BR.jet] > 0.05) {
      const vx = hips.x + dx * 0.4 + upx * 4.4, vy = hips.y + dy * 0.4 + upy * 4.4;
      r.glowStamp(vx, vy, 1.2, 1.2, 0, HOT, 1 + F[BR.jet] * 2.4, 0.3, 2);
    }
    // Near hind leg over the body.
    { const [x, y] = hipAt(0); limb(r, rig, 0, x, y, 6 * S, false, S, false); }
    // Head: small, sunk forward between the shoulders.
    const hx = head.x, hy = head.y;
    const look = F[BR.lookY] * 0.3;
    r.ellipse(hx, hy, 2.4 * S, 2.1 * S, fs * 0.2 + look, 5 * S, PLATE, { group: 30 });
    r.ellipse(hx + fs * 1.4 * S, hy + 0.9 * S, 1.6 * S, 1.3 * S, fs * 0.3, 5 * S, STONE, { group: 30 });
    // Brow ridge and a hot slit of an eye under it.
    r.shade(hx + fs * 0.4 * S, hy - 1.2 * S, 2.0 * S, 0.7 * S, fs * 0.15, 0.9, 30);
    const ex = hx + fs * 1.1 * S, ey = hy - 0.3 * S;
    const eyeHeat = e.status.wet > 0 ? 1 : 2.6 + (e.expression?.alert ?? 0) * 0.6;
    r.stamp(ex, ey, 1.0 * S, 0.33 * S, fs * 0.12, EYE, eyeHeat, true);
    markEye(ex, ey, 0.8 * S);
    if (colossus) r.stamp(hx + fs * 1.8 * S, hy + 1.2 * S, 1.2 * S, 0.35 * S, fs * 0.1, HOT, pulse * 3, true);
    else r.stroke(hx + fs * 0.6 * S, hy + 1.1 * S, hx + fs * 2.4 * S, hy + 1.3 * S, DARK, 0, true);
    // Near arm last: it swings in front of everything.
    { const [x, y] = hipAt(2); limb(r, rig, 2, x, y, 12 * S, false, S, true); }
    if (colossus && (F[BR.reach] > 0.25 || F[BR.throwT] > 0)) {
      // The molten gob in its fist, dripping, brightest just before the throw.
      const fist = rig.legs[2], k = Math.max(F[BR.reach], F[BR.throwT] / 26);
      const gr = 1.7 * S * (0.55 + k * 0.45);
      r.ellipse(fist.x + fs * 0.6 * S, fist.y - 3.4 * S, gr, gr * 0.9, 0, 14 * S, HOT, { group: 41 });
      r.glowStamp(fist.x + fs * 0.6 * S, fist.y - 3.4 * S, gr, gr * 0.9, 0, HOT, 1.6 + k * 2.4, 0.3, 41);
    }
    if (e.hp < e.maxHp * 0.5) {
      // Wounds: fresh fractures across the shoulder plate.
      r.stroke(chest.x - 1 * S, chest.y - 2 * S, chest.x + 1.5 * S, chest.y + 0.5 * S, DARK, 0, true);
      r.stroke(chest.x + 1.5 * S, chest.y + 0.5 * S, chest.x + 0.5 * S, chest.y + 2 * S, DARK, 0, true);
    }
    if (colossus && (e.boss?.exposed ?? 0) > 0) {
      // Quenched: the chest has split — the opening every blow should aim for.
      r.glowStamp(coreX, coreY, 2.6 * S, 2.1 * S, Math.atan2(dy, dx), EYE, 1.2 + Math.sin(tick * 0.3) * 0.4, 0.3, 1);
    }
  },
};

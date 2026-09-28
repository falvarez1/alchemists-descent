import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { BR, BR_CHEST, BR_HEAD, BR_HIPS, bruteSpec } from '@/creatures/species/brute';
import { markEye } from './anatomy';
import { material } from './palette';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';
import type { SpeciesArt } from './types';

/**
 * THE RIME WARDEN: the Cold Store's old night-watchman — a riveted iron
 * boiler-frame on the brute's knuckle-walking plan, frozen to its post so long
 * that it wears six thick plates of ice down its back and a block of ice round
 * each fist. The plates ARE the fight's health bar: every one that thaws or
 * shatters leaves bare, rusted iron where it hung. A single cold lamp for an
 * eye; a pilot light behind the chest grille that flares when it kneels
 * (the opening); icicles hanging off its forearms and jaw. Thawing warms its
 * lower seams orange; a frozen (brittle) Warden glitters.
 */
const IRON = 1, ICE = 2, FROST = 3, LAMP = 4, WARM = 5, RUST = 6, DARK = 7;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x06080b, 0x121820, 0x222c36, 0x3c4854, 0x66747e], gloss: 0.35, shine: 12, rim: 0.8, outline: 0x030406 }),
  material({ keys: [0x082a4c, 0x1a5c92, 0x3490d0, 0x78c8f2, 0xd6f4ff], gloss: 0.8, shine: 24, rim: 1.4, translucent: 0.3, outline: 0x04142a }),
  material({ keys: [0x32424e, 0x7e96a8, 0xbcd0de, 0xf2faff], gloss: 0.2, rim: 0.7, outline: 0x141c24 }),
  material({ keys: [0x082440, 0x2a86cc, 0x98dcff, 0xffffff], emissive: 1, glow: 0x1a4a78, glowK: 1 }),
  material({ keys: [0x3a1402, 0xa04a10, 0xf09a3a, 0xffdc9a], emissive: 1, glow: 0x5a2208, glowK: 0.8 }),
  material({ keys: [0x140a06, 0x301a10, 0x56301c, 0x84502c], gloss: 0.1, rim: 0.5, outline: 0x080403 }),
  material({ keys: [0x020304, 0x07090c, 0x0e1216], outline: 0x010102 }),
];

function limb(r: CreatureRaster, rig: CreatureRig, i: number, hx: number, hy: number, z: number, far: boolean, S: number, arm: boolean): void {
  const leg = rig.legs[i];
  const o = { group: 10 + i, far, tone: far ? 0 : 0.3 };
  if (arm) {
    r.capsule(hx, hy, 1.9 * S, leg.kx, leg.ky, 1.5 * S, z, z + 1, IRON, o);
    r.capsule(leg.kx, leg.ky, 1.6 * S, leg.x, leg.y - 2.2 * S, 1.8 * S, z + 1, z + 2, IRON, o);
    // Rivets down the forearm.
    for (let k = 1; k <= 2; k++) {
      const t = k / 3;
      r.dot(leg.kx + (leg.x - leg.kx) * t, leg.ky + (leg.y - 2.2 * S - leg.ky) * t, FROST, 0.4, z + 3);
    }
    // A fist frozen into a block of ice, knuckles down.
    const fx = leg.x, fy = leg.y - 2.2 * S;
    r.ellipse(fx, fy, 3.1 * S, 2.5 * S, 0.15, z + 2.5, ICE, o);
    r.shade(fx - 0.8 * S, fy - 1.1 * S, 1.6 * S, 0.8 * S, 0.3, 1.1, 10 + i);
    // Icicles hanging off the forearm (not while the fist is raised overhead).
    if (!far && leg.y > hy) {
      for (let k = 0; k < 3; k++) {
        const t = 0.35 + k * 0.2, ix = leg.kx + (leg.x - leg.kx) * t, iy = leg.ky + (leg.y - leg.ky) * t + 1.2 * S;
        r.stroke(ix, iy, ix + 0.2 * S, iy + (1.2 + (k % 2) * 0.9) * S, ICE, 0.6, true);
      }
    }
  } else {
    r.capsule(hx, hy, 2.3 * S, leg.kx, leg.ky, 1.9 * S, z, z + 0.5, IRON, o);
    r.capsule(leg.kx, leg.ky, 1.9 * S, leg.x, leg.y - 1.2 * S, 1.6 * S, z + 0.5, z + 1, IRON, o);
    // A frost-caked boot.
    r.ellipse(leg.x + 0.5 * S, leg.y - 1.0 * S, 2.5 * S, 1.3 * S, 0, z + 1.2, FROST, o);
  }
}

export const rimeArt: SpeciesArt = {
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
    const F = rig.f, S = bruteSpec(e).scale, tick = ctx.state.frameCount;
    const hips = rig.pts[BR_HIPS], chest = rig.pts[BR_CHEST], head = rig.pts[BR_HEAD];
    const fs = F[BR.face] >= 0 ? 1 : -1;
    const plates = Math.max(0, Math.min(6, e.boss?.plates ?? 6));
    // (Only a boss brain's thaw clock warms the rime: an unbraind preview stays cold.)
    const thaw = e.boss ? Math.max(0, Math.min(1, F[BR.heat])) : 0;
    const brittle = e.status.frozen > 0 && plates > 0;
    const exposed = (e.boss?.exposed ?? 0) > 0;
    const hipAt = (i: number): [number, number] => {
      const arm = i >= 2, far = i % 2 === 1, a = arm ? chest : hips;
      return [a.x + (far ? fs * 1.2 * S : -fs * 0.4 * S), a.y + (arm ? 0.5 * S : 0.8 * S)];
    };
    { const [x, y] = hipAt(1); limb(r, rig, 1, x, y, -8 * S, true, S, false); }
    { const [x, y] = hipAt(3); limb(r, rig, 3, x, y, -8 * S, true, S, true); }
    // Torso: a riveted iron boiler, hunched over the shoulders.
    const dx = chest.x - hips.x, dy = chest.y - hips.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    let upx = uy, upy = -ux;
    if (upy > 0) { upx = -upx; upy = -upy; }
    const ang = Math.atan2(dy, dx);
    const midX = hips.x + dx * 0.55 + upx * 1.2 * S, midY = hips.y + dy * 0.55 + upy * 1.2 * S;
    r.capsule(hips.x, hips.y, 3.8 * S, midX, midY, 4.8 * S, 0, 0.5, IRON, { group: 1 });
    r.capsule(midX, midY, 4.8 * S, chest.x, chest.y, 4.4 * S, 0.5, 1, IRON, { group: 1 });
    // Boiler bands: dark hoops round the barrel.
    for (let k = 1; k <= 3; k++) {
      const t = k / 4, bx = hips.x + dx * t, by = hips.y + dy * t;
      r.stroke(bx + upx * 4.2 * S, by + upy * 4.2 * S, bx - upx * 3.6 * S, by - upy * 3.6 * S, DARK, 0, true);
    }
    // The pilot light behind the chest grille: a cold blue flame, flaring when it kneels.
    const coreX = chest.x + ux * 1.4 * S - upx * 0.6 * S, coreY = chest.y + uy * 1.4 * S - upy * 0.6 * S;
    const pilot = 0.9 + Math.sin(tick * 0.11 + e.bobPhase) * 0.2 + (exposed ? 1.6 + Math.sin(tick * 0.35) * 0.5 : 0);
    r.glowStamp(coreX, coreY, 2.2 * S, 1.9 * S, ang, LAMP, 0.6 + pilot * 1.6, 0.2, 1);
    for (let b = -2; b <= 2; b++) {
      const gx = coreX + b * 0.9 * S;
      r.stroke(gx, coreY - 1.8 * S, gx, coreY + 1.8 * S, DARK, 0, true);
    }
    // THE RIME: six plates of ice down the back — the ones still on are the fight left.
    for (let p = 0; p < 6; p++) {
      const t = 0.05 + p / 5 * 0.95;
      const bx = hips.x + dx * t + upx * (3.5 + Math.sin(t * Math.PI) * 1.6) * S;
      const by = hips.y + dy * t + upy * (3.5 + Math.sin(t * Math.PI) * 1.6) * S;
      const rw = (2.9 + Math.sin(t * Math.PI) * 1.4) * S, rh = (2.0 + Math.sin(t * Math.PI) * 0.7) * S;
      if (p < plates) {
        r.ellipse(bx, by, rw, rh, ang + (p % 2 ? 0.18 : -0.12), 3 * S + p * 0.3, ICE, { group: 2 + p });
        // A bright frosted crest, a glassy glint and a deep blue heart in each slab.
        r.shade(bx + upx * rh * 0.45, by + upy * rh * 0.45, rw * 0.75, rh * 0.35, ang, 1.3, 2 + p);
        r.shade(bx - upx * rh * 0.3, by - upy * rh * 0.3, rw * 0.5, rh * 0.3, ang, -1.0, 2 + p);
        r.stroke(bx + upx * rh * 0.55 - ux * rw * 0.45, by + upy * rh * 0.55 - uy * rw * 0.45,
          bx + upx * rh * 0.7 + ux * rw * 0.1, by + upy * rh * 0.7 + uy * rw * 0.1, FROST, 1.6, true);
        // Thaw: the plate's underside runs warm and wet.
        if (thaw > 0.05) r.glowStamp(bx - upx * rh * 0.8, by - upy * rh * 0.8, rw * 0.7, 0.5 * S, ang, WARM, thaw * 2.2, 0.3, 2 + p);
        // Brittle: frost glitter across the rime.
        if (brittle && (tick + p * 7) % 18 < 6) r.dot(bx + upx * rh * 0.3 + ux * ((p * 5) % 3 - 1) * S, by + upy * rh * 0.3, FROST, 1.5);
      } else {
        // Where a plate hung: bare rusted iron and a ring of rivets.
        r.ellipse(bx - upx * 0.8 * S, by - upy * 0.8 * S, rw * 0.8, rh * 0.6, ang, 2 * S + p * 0.3, RUST, { group: 2 + p });
        r.dot(bx - upx * 0.4 * S - ux * rw * 0.4, by - upy * 0.4 * S - uy * rw * 0.4, DARK, 0, 3 * S + p);
        r.dot(bx - upx * 0.4 * S + ux * rw * 0.4, by - upy * 0.4 * S + uy * rw * 0.4, DARK, 0, 3 * S + p);
      }
    }
    // Rime icicles fringing the belly while the plates hold (fewer as they go).
    for (let k = 0; k < plates; k++) {
      const t = 0.12 + k / 6 * 0.8;
      const bx = hips.x + dx * t - upx * 3.4 * S, by = hips.y + dy * t - upy * 3.4 * S;
      const len = (1.1 + ((k * 7 + 3) % 4) * 0.45) * S;
      r.stroke(bx, by, bx + 0.15 * S, by + len, ICE, 0.9, true);
    }
    // Near hind leg over the body.
    { const [x, y] = hipAt(0); limb(r, rig, 0, x, y, 6 * S, false, S, false); }
    // Head: a watchman's lantern-helm, sunk forward between the shoulders.
    const hx = head.x, hy = head.y;
    const look = F[BR.lookY] * 0.3;
    r.ellipse(hx, hy - 0.2 * S, 2.3 * S, 2.2 * S, fs * 0.2 + look, 5 * S, IRON, { group: 30 });
    r.ellipse(hx - fs * 0.2 * S, hy - 1.6 * S, 2.0 * S, 1.0 * S, fs * 0.1, 5.5 * S, plates > 0 ? FROST : RUST, { group: 30 });
    // The lamp: one cold eye behind a grille.
    const ex = hx + fs * 1.1 * S, ey = hy - 0.1 * S;
    const breath = F[BR.vent];
    const eyeT = 2.4 + (e.expression?.alert ?? 0) * 0.6 + breath * 1.4;
    r.stamp(ex, ey, 1.05 * S, 0.5 * S, fs * 0.12, LAMP, eyeT, true);
    r.stroke(ex - 0.6 * S, ey, ex + 0.6 * S, ey, DARK, 0, true);
    markEye(ex, ey, 0.8 * S);
    // The jaw: a grate that frosts over; the breath's inhale lights it from within.
    const jx = hx + fs * 1.3 * S, jy = hy + 1.3 * S;
    r.stamp(jx, jy, 1.2 * S, 0.45 * S, fs * 0.1, breath > 0.1 ? LAMP : DARK, breath * 3, true);
    // An icicle beard under the jaw.
    for (let k = 0; k < 4; k++) {
      const bx = jx - fs * (k * 0.55 - 0.4) * S, len = (1.2 + ((k * 5 + 1) % 3) * 0.6) * S;
      r.stroke(bx, jy + 0.4 * S, bx, jy + 0.4 * S + len, ICE, 0.8, true);
    }
    // Near arm last: it swings in front of everything.
    { const [x, y] = hipAt(2); limb(r, rig, 2, x, y, 12 * S, false, S, true); }
    if (F[BR.reach] > 0.25 || F[BR.throwT] > 0) {
      // Hail: a jagged fistful of ice torn off its shoulder, brightest before the throw.
      const fist = rig.legs[2], k = Math.max(F[BR.reach], F[BR.throwT] / 26);
      const gr = 1.5 * S * (0.55 + k * 0.45);
      r.ellipse(fist.x + fs * 0.6 * S, fist.y - 3.6 * S, gr, gr * 0.85, 0.5, 14 * S, ICE, { group: 41 });
      r.glowStamp(fist.x + fs * 0.6 * S, fist.y - 3.6 * S, gr, gr * 0.85, 0, LAMP, 0.6 + k * 1.4, 0.3, 41);
    }
    if (e.hp < e.maxHp * 0.5) {
      // Fractures across the shoulder iron.
      r.stroke(chest.x - 1 * S, chest.y - 2 * S, chest.x + 1.5 * S, chest.y + 0.5 * S, DARK, 0, true);
      r.stroke(chest.x + 1.5 * S, chest.y + 0.5 * S, chest.x + 0.5 * S, chest.y + 2 * S, DARK, 0, true);
    }
  },
};

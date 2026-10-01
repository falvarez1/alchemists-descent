import { hash2 } from '@/core/math';
import { boot, hand, limb } from '@/render/player/AlchemistArt';
import { EXTRA0, SLOT, matsFor, rgbOf } from '@/render/player/fighterLook';
import type { FighterLook, LookCtx } from '@/render/player/fighterLook';

/**
 * Selene Wraith, the Mercury Twin (Duelist): a tight charcoal suit with orange fittings, a mask over the
 * lower face, a long silver ponytail and a blue scarf that stream behind her, and a spear whose blade burns
 * mercury-blue. When she is fast a few ghosts of her follow, faint and blue: the echo of the Twin.
 * The ponytail takes the crown chain's shape and the scarf the shoulder chain's, both lengthened past their tips.
 */
const GLINT = 10;
const SUIT_D = SLOT.coatD, ORANGE = SLOT.trim, BRACER = SLOT.mantle, HAIR = SLOT.hair, SHAFT = SLOT.wood;
const SCARF = EXTRA0, BLADE = EXTRA0 + 1, EYE_ICE = EXTRA0 + 2, GHOST = EXTRA0 + 3; // GHOST, GHOST + 1: near to far

const G_PONY = 33, G_SCARF = 36, G_GHOST = 255, G_PAD = 37;

const XS = new Float64Array(24), YS = new Float64Array(24), RS = new Float64Array(24);

/**
 * Draw a chain's shape moved to a new root and lengthened `extra` links past its tip, as a tapering ribbon: a
 * short verlet chain becomes a long ponytail or scarf that follows the same wind. Deterministic from `frame`;
 * the flutter grows with speed. `rot` swings the whole shape about its root (a ponytail stands off the head).
 */
function streamer(c: LookCtx, chain: ReadonlyArray<{ x: number; y: number }>, root: readonly [number, number], extraLinks: number, seg: number,
  droop: number, flutter: number, phase: number, rotation: number, r0: number, r1: number, z: number, mat: number, group: number, far = false): void {
  // The fallen keep only the chain's own (terrain-collided) shape: no lengthening, no swing off the body.
  const extra = c.dead ? 0 : extraLinks, rot = c.dead ? 0 : rotation;
  const ox = chain[0].x, oy = chain[0].y, n = chain.length;
  const rc = Math.cos(rot), rs = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    XS[i] = root[0] + (chain[i].x - ox) * rc - (chain[i].y - oy) * rs;
    YS[i] = root[1] + (chain[i].x - ox) * rs + (chain[i].y - oy) * rc;
  }
  let hx = XS[n - 1] - XS[n - 2], hy = YS[n - 1] - YS[n - 2];
  let l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l;
  const speed = Math.min(1, Math.abs(c.a._svx || c.a.vx || 0) / 2.1);
  const total = n + extra;
  for (let k = 1; k <= extra; k++) {
    hy += droop;
    l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l;
    const wob = Math.sin(c.frame * 0.2 + k * 1.1 + phase) * flutter * (0.3 + 0.7 * speed);
    const cs = Math.cos(wob), sn = Math.sin(wob);
    XS[n + k - 1] = XS[n + k - 2] + (hx * cs - hy * sn) * seg;
    YS[n + k - 1] = YS[n + k - 2] + (hx * sn + hy * cs) * seg;
  }
  for (let i = 0; i < total; i++) RS[i] = r0 + (r1 - r0) * (i / (total - 1));
  c.r.tube(XS, YS, RS, total, z, mat, { group, far });
}

/** The mercury echo: when she is fast, two ghosts of her pose trail behind and quicksilver streaks run off her body. */
function ghosts(c: LookCtx): void {
  const { r, s, a } = c;
  const v = a._svx || a.vx || 0;
  const sp = Math.abs(v);
  if (c.dead || sp < 1.5) return;
  const dir = v > 0 ? 1 : -1;
  const k = Math.min(1, (sp - 1.5) / 0.9);
  const o = { group: G_GHOST, noOutline: true };
  for (let i = 2; i >= 1; i--) {
    const off = -dir * i * (3.2 + sp * 1.1);
    const lift = Math.sin(c.frame * 0.3 + i * 1.7) * 0.3;
    const X = (p: { x: number }): number => p.x + off;
    const Y = (p: { y: number }): number => p.y + lift;
    const z = -9 - i * 0.2, GM = GHOST + i - 1;
    r.capsule(X(s.hip), Y(s.hip), 1.6, X(s.chest), Y(s.chest), 1.9, z, z, GM, o);
    r.ellipse(X(s.head), Y(s.head), 1.8, 1.9, 0, z, GM, o);
    r.capsule(X(s.hip), Y(s.hip), 0.9, X(s.backKnee), Y(s.backKnee), 0.7, z, z, GM, o);
    r.capsule(X(s.backKnee), Y(s.backKnee), 0.7, X(s.backFoot), Y(s.backFoot), 0.5, z, z, GM, o);
    r.capsule(X(s.hip), Y(s.hip), 0.9, X(s.frontKnee), Y(s.frontKnee), 0.7, z, z, GM, o);
    r.capsule(X(s.frontKnee), Y(s.frontKnee), 0.7, X(s.frontFoot), Y(s.frontFoot), 0.5, z, z, GM, o);
  }
  // Streaks: bright thin lines running back from the body at five heights.
  const feet = Math.max(s.backFoot.y, s.frontFoot.y);
  for (let j = 0; j < 5; j++) {
    const t = [0.1, 0.32, 0.52, 0.74, 0.93][j];
    const y = feet + (s.head.y - feet) * t, x = s.hip.x - dir * 2.4;
    const L = (3.5 + 6 * hash2(j, c.frame >> 2, 77)) * k;
    r.capsule(x, y, 0.3, x - dir * L, y + 0.2, 0.08, -8, -8, BLADE, o);
  }
}

/** Far arm and leg; the ponytail and the scarf streaming behind her. */
function back(c: LookCtx): void {
  const { r, s, costume, f } = c;
  ghosts(c);
  limb(r, s.chest, s.backElbow, 0.8, 0.68, -6, SUIT_D, 2, true);
  limb(r, s.backElbow, s.backHand, 0.7, 0.55, -6, SUIT_D, 2, true);
  hand(r, s.backHand, s.backElbow, -6, 2, true);
  limb(r, s.hip, s.backKnee, 1.05, 0.82, -5, SUIT_D, 3, true);
  limb(r, s.backKnee, s.backFoot, 0.82, 0.7, -5, SLOT.boot, 3, true);
  boot(r, s.backFoot, s.backKnee, f, -5, 3, true);
  if (!costume) return;
  // The ponytail: tied high at the back of the head, it takes the shoulder chain's wind and stands out from the back.
  const speed = Math.min(1, Math.abs(c.a._svx || c.a.vx || 0) / 2.1);
  const tie = c.H(-1.9, 1.1);
  const lift = 0.6 + 0.5 * speed, dr = 0.16 * (1 - 0.7 * speed);
  streamer(c, costume.mantle.pts, tie, 5, 1.4, dr, 0.14, 0, f * lift, 1.25, 0.25, -3.2, HAIR, G_PONY);
  streamer(c, costume.mantle.pts, [tie[0] + f * 0.1, tie[1] + 0.35], 5, 1.35, dr * 1.15, 0.16, 1.3, f * (lift - 0.07), 0.95, 0.2, -3.3, HAIR, G_PONY);
  streamer(c, costume.mantle.pts, [tie[0], tie[1] - 0.3], 5, 1.4, dr * 0.85, 0.15, 2.6, f * (lift + 0.07), 0.85, 0.2, -3.1, HAIR, G_PONY);
  r.ellipse(tie[0], tie[1], 0.95, 0.95, 0, -2.8, HAIR, { group: G_PONY });
  // The scarf: two tails stream from the knot at the nape on the coat-tail chains, lengthened.
  const knot = c.H(-1.4, -1.5);
  streamer(c, costume.tails[0].pts, knot, 4, 1.5, 0.05 * (1 - speed), 0.22, 1.6, f * (0.3 + 0.75 * speed), 1.2, 0.5, -3.4, SCARF, G_SCARF);
  streamer(c, costume.tails[1].pts, [knot[0] + f * 0.4, knot[1] + 0.8], 3, 1.4, 0.07 * (1 - speed), 0.28, 3.1, f * (0.55 + 0.6 * speed), 0.9, 0.35, -3.6, SCARF, G_SCARF, true);
}

/** The suit's fittings: a chest strap with a buckle, an orange belt band. */
function torso(c: LookCtx): void {
  const { r, s, f } = c;
  const sx = s.chest.x - f * 1.6, sy = s.chest.y + 0.2;
  const hx = s.hip.x + f * 1.7, hy = s.hip.y - 0.3;
  r.stroke(sx, sy, hx, hy, ORANGE, 2, true);
  const bx = s.chest.x + (hx - s.chest.x) * 0.2 + f * 0.3, by = s.chest.y + (hy - s.chest.y) * 0.2;
  r.dot(bx, by, ORANGE, 4, 5);
  // The belt band and a thigh pouch.
  r.stamp(s.hip.x + c.ux * 0.12, s.hip.y + c.uy * 0.12, 2.3, 0.35, Math.atan2(c.uy, c.ux) + Math.PI / 2, ORANGE, 1.5, false, 1);
  r.stamp(s.hip.x - f * 2.1, s.hip.y + c.uy * 0.12 + 0.8, 0.65, 0.75, 0, BRACER, 1, false, 6);
  r.stamp(s.hip.x + f * 1.9, s.hip.y + c.uy * 0.12 + 0.6, 0.55, 0.7, 0, BRACER, 1, false, 6);
}

/** Knee guard and boot cuff on the near leg. */
function shoulders(c: LookCtx): void {
  const { r, s, f } = c;
  r.ellipse(s.frontKnee.x + f * 0.55, s.frontKnee.y, 0.7, 0.75, 0, 3.7, ORANGE, { group: G_PAD });
  const ft = s.frontFoot, kn = s.frontKnee;
  r.stamp(ft.x + (kn.x - ft.x) * 0.3, ft.y + (kn.y - ft.y) * 0.3, 1.15, 0.4, 0, ORANGE, 2, false, 8);
}

/** Her head: a pale brow and an ice-blue eye over a black mask, silver hair scraped back from the brow, the scarf wound at the neck. */
function head(c: LookCtx): void {
  const { r, s, f, H } = c;
  const ht = s.headTilt, hk = 0.94;
  limb(r, s.neck, s.head, 0.75, 0.85, 3, SLOT.skin, 11);
  r.ellipse(s.head.x, s.head.y, 2.3 * hk, 2.45 * hk, ht, 4, SLOT.skin, { group: 11 });
  r.ellipse(...H(2.1 * hk, 0.1), 0.7, 0.6, ht + f * 0.2, 4.6, SLOT.skin, { group: 11 });
  r.stamp(...H(-1.25, 0.2), 0.5, 0.7, ht, SLOT.skin, 0.5, false, 11);
  // The scarf's wrap at the neck, under the mask.
  r.ellipse(...H(-0.1, -1.95), 2.0, 1.0, ht, 3.9, SCARF, { group: G_SCARF });
  r.shade(...H(0.4, -1.6), 1.4, 0.4, ht, 0.9, G_SCARF);
  // Hair swept back and up into the tie; a short fringe over the brow.
  r.ellipse(...H(-1.1, 0.7), 1.8, 1.8, ht, 4.5, HAIR, { group: 11 });
  r.ellipse(...H(-1.7, -0.4), 1.1, 1.5, ht, 4.4, HAIR, { group: 11 });
  r.ellipse(...H(0.2, 1.75), 1.9, 0.62, ht, 4.7, HAIR, { group: 11 });
  r.stamp(...H(1.6, 1.45), 0.55, 0.3, ht, HAIR, 1, false, 11);
  r.shade(...H(-0.5, 2.1), 1.6, 0.5, ht, 0.9, 11);
  r.stamp(...H(-1.9, 1.1), 0.45, 0.45, 0, ORANGE, 3, true, 33);
  // The mask over nose and mouth.
  r.ellipse(...H(1.25, -1.1), 2.0 * hk, 1.3, ht, 4.9, SUIT_D, { group: 12 });
  r.shade(...H(1.6, -0.3), 1.2, 0.35, ht, 0.9, 12);
  const [ex, ey] = H(1.35, 0.55);
  if (s.eyesShut) r.stroke(ex - 0.55, ey, ex + 0.5, ey + 0.1, SLOT.eye, 0, true);
  else {
    r.stamp(ex, ey, 0.55, 0.5, 0, SLOT.eye, 0, false, 11);
    if (!c.dead) r.stamp(ex + 0.05, ey + 0.1, 0.5, 0.42, 0, EYE_ICE, 2, true, 11);
    r.dot(ex - 0.15, ey - 0.3, GLINT, 1, 30);
  }
  r.stroke(...H(0.6, 1.2), ...H(1.9, 1.1), SLOT.eye, 0, true);
}

/** Orange elbow guard and a glove. */
function front(c: LookCtx): void {
  const { r, s } = c;
  r.ellipse(s.frontElbow.x, s.frontElbow.y, 0.6, 0.55, 0, 8.9, ORANGE, { group: G_PAD });
}

/** The spear: a black shaft with an orange collar and a leaf of mercury light for a blade. */
function spear(c: LookCtx): void {
  const { r, s, frame, a } = c;
  const w = s.wand, ang = w.angle + w.spin, cc = Math.cos(ang), sn = Math.sin(ang);
  const glow = w.glow * (0.9 + Math.sin(frame * 0.3) * 0.1);
  const px = -sn, py = cc;
  r.capsule(w.x - cc * 4.2, w.y - sn * 4.2, 0.48, w.x + cc * 9.0, w.y + sn * 9.0, 0.4, 8.2, 8.2, SHAFT, { group: 14 });
  r.capsule(w.x + cc * 7.6, w.y + sn * 7.6, 0.6, w.x + cc * 9.2, w.y + sn * 9.2, 0.6, 8.3, 8.3, ORANGE, { group: 14 });
  r.capsule(w.x - cc * 4.4, w.y - sn * 4.4, 0.6, w.x - cc * 3.6, w.y - sn * 3.6, 0.55, 8.3, 8.3, ORANGE, { group: 14 });
  // The blade: a long leaf, widest a third of the way up.
  const L = (u: number, v: number): [number, number] => [w.x + cc * u + px * v, w.y + sn * u + py * v];
  const pts: number[] = [];
  for (const [u, v] of [[9.0, 0], [10.4, 0.95 + glow * 0.25], [12.2, 0.7], [14.6, 0], [12.2, -0.7], [10.4, -0.95 - glow * 0.25]] as const) pts.push(...L(u, v));
  r.poly(pts, 6, 8.6, BLADE, 0.8, { group: 14, noOutline: true });
  r.glowStamp(...L(11.8, 0), 3.0, 0.42, ang, BLADE, 3.4 + glow, 1.4, 14);
  if (a.firing) r.dot(...L(14.9, 0), BLADE, 5, 30);
}

export const look: FighterLook = {
  id: 'selene-wraith',
  mats: matsFor({
    // The suit: near-black blue, sleek, with a cold rim.
    coat: { keys: [0x06080e, 0x0f1520, 0x1b2638, 0x2c3f58, 0x4c6684], gloss: 0.4, shine: 20, rim: 1.0, outline: 0x02040a },
    coatD: { keys: [0x04060a, 0x0a0f18, 0x131b28, 0x1f2c3e, 0x34475e], gloss: 0.3, shine: 18, rim: 0.8, outline: 0x02040a },
    // Bracers and pouches: burnt orange leather.
    mantle: { keys: [0x20100a, 0x4a2410, 0x8a4a1c, 0xc07430, 0xe8a460], gloss: 0.3, rim: 0.7, outline: 0x120802 },
    leather: { keys: [0x080a10, 0x151a26, 0x232c3c, 0x384860, 0x58708c], gloss: 0.35, rim: 0.8, outline: 0x03050a },
    trim: { keys: [0x2a1004, 0x6a2c08, 0xb8581a, 0xe8883a, 0xffc078], gloss: 0.7, shine: 20, rim: 0.8, outline: 0x180800 },
    skin: { keys: [0x3a3040, 0x806e7c, 0xc4b0b8, 0xe8d8d8, 0xfff2f0], gloss: 0.15, rim: 0.7, outline: 0x140e14 },
    hair: { keys: [0x161c2c, 0x384560, 0x6a7a98, 0x98a8c4, 0xd0dcf0], gloss: 0.5, shine: 16, rim: 0.9, outline: 0x10162a },
    boot: { keys: [0x04060a, 0x0c1018, 0x182030, 0x2a3850], gloss: 0.5, shine: 16, rim: 0.7, outline: 0x020306 },
    wood: { keys: [0x0a0c12, 0x1a2230, 0x2e3c52, 0x4a607e], gloss: 0.6, shine: 22, rim: 0.7, outline: 0x040508 },
    glow: { keys: [0x103a6a, 0x3a90e0, 0x9ad0ff, 0xf0faff], emissive: 1, glow: 0x1a4a8a, glowK: 1 },
    rune: { keys: [0x103a6a, 0x3a90e0, 0x9ad0ff, 0xf0faff], emissive: 1, glow: 0x1a4a8a, glowK: 1 },
  }, [
    // The scarf: deep to bright blue.
    { keys: [0x08163a, 0x143a80, 0x2c70c8, 0x6cb0f0, 0xb8e0ff], gloss: 0.3, rim: 1.0, emissive: 0.12, outline: 0x040c20 },
    // The blade.
    { keys: [0x2a70c0, 0x7ac0ff, 0xd0f0ff, 0xffffff], emissive: 1, glow: 0x2a6aaa, glowK: 1.1 },
    // The eye.
    { keys: [0x2a70c0, 0x7ac0ff, 0xd0f0ff, 0xffffff], emissive: 1 },
    // The ghosts, near to far: translucent mercury that thins out.
    { keys: [0x5aa0e8, 0x90ccff, 0xd0f0ff], emissive: 0.3, translucent: 0.68, glow: 0x0c2a4a, glowK: 0.25 },
    { keys: [0x5aa0e8, 0x90ccff, 0xd0f0ff], emissive: 0.3, translucent: 0.82, glow: 0x0c2a4a, glowK: 0.2 },
  ]),
  accent: rgbOf(0x7ab8ff),
  outfit: 'suit',
  headgear: 'none',
  hair: 'none',
  face: 'masked',
  wand: 'spear',
  mantle: false,
  pouches: true,
  build: { limb: 0.8, torso: 0.82, head: 0.94 },
  replace: ['back', 'head'],
  extras: { back, torso, shoulders, head, front },
  drawWand: spear,
};

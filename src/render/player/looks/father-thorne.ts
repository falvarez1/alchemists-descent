import { chainTube } from '@/render/creatures/anatomy';
import { boot, hand, limb } from '@/render/player/AlchemistArt';
import { EXTRA0, SLOT, matsFor, rgbOf } from '@/render/player/fighterLook';
import type { FighterLook, LookCtx } from '@/render/player/fighterLook';

/**
 * Father Thorne, the Briar Heretic (Controller): a moss-green hooded cleric's robe, ragged at the hem, with a
 * brass cross hanging on his chest and leaves and vines growing out of the cloth; a crooked staff wound with
 * briar and a bud of green light at its head. Hunched under a big cowl whose peak droops on the crown chain.
 * The robe is forest green (the `coat` slot), the cloak over it moss (an extra), the cuffs and belt leather.
 */
const ROBE = SLOT.coat, ROBE_D = SLOT.coatD, BRASS = SLOT.trim, SKIN = SLOT.skin, WOOD = SLOT.wood, LEATHER = SLOT.leather, BOOT = SLOT.boot;
const MOSS = EXTRA0, LEAF = EXTRA0 + 1, VINE = EXTRA0 + 2, ORB = EXTRA0 + 3, BONE = EXTRA0 + 4, VOID = EXTRA0 + 5;

// Groups: 16 (the hat's) frosts like a hat and 10 like a mantle; 8/9/13 are the near leg, its tail and the near arm.
const G_HOOD = 16, G_CAPE = 10, G_LEAF = 36;

/** The hunch: his head rides forward and low of the shared skeleton's, under the cowl. */
const HUNCH_SIDE = 1.1, HUNCH_UP = -0.85;
function hh(c: LookCtx, side: number, up: number): [number, number] { return c.H(side + HUNCH_SIDE, up + HUNCH_UP); }

/** A leaf: a small pointed ellipse. */
function leaf(c: LookCtx, x: number, y: number, ang: number, size: number, z: number, group = G_LEAF): void {
  c.r.ellipse(x, y, 0.95 * size, 0.5 * size, ang, z, LEAF, { group });
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number): [number, number] { return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]; }

/** Far arm and leg, the torn cloak behind him with leaves riding its tail. */
function back(c: LookCtx): void {
  const { r, s, costume, f } = c;
  limb(r, s.chest, s.backElbow, 1.0, 0.85, -6, ROBE_D, 2, true);
  limb(r, s.backElbow, s.backHand, 0.85, 0.65, -6, ROBE_D, 2, true);
  hand(r, s.backHand, s.backElbow, -6, 2, true);
  limb(r, s.hip, s.backKnee, 1.25, 1.0, -5, ROBE_D, 3, true);
  limb(r, s.backKnee, s.backFoot, 1.0, 0.85, -5, BOOT, 3, true);
  boot(r, s.backFoot, s.backKnee, f, -5, 3, true);
  if (!costume) return;
  // The cloak: a wide tail from the hip that ends in torn strips, a panel from the shoulders.
  const t0 = costume.tails[0];
  chainTube(r, t0, -4, ROBE_D, { group: 4 }, 2.2, 1.6);
  const e = t0.pts[t0.pts.length - 1], p = t0.pts[t0.pts.length - 2];
  const dx = e.x - p.x, dy = e.y - p.y;
  for (const [k, w] of [[-1, 0.7], [0, 0.9], [1, 0.6]] as const) {
    r.capsule(e.x + k * 0.7, e.y - 0.2, w, e.x + dx * 0.8 + k * 1.1, e.y + dy * 0.8 + 1.2 + (k === 0 ? 0.5 : 0), 0.1, -4, -4, ROBE_D, { group: 4 });
  }
  chainTube(r, costume.mantle, -3.4, MOSS, { group: 5, far: true }, 1.8, 1.1);
  const t = t0.pts;
  leaf(c, t[2].x, t[2].y + 0.2, 0.9 * f, 1.0, -3.6);
  leaf(c, t[4].x - f * 0.4, t[4].y + 0.3, -0.6 * f, 1.2, -3.6);
  const m = costume.mantle.pts;
  leaf(c, m[2].x, m[2].y, 0.5 * f, 0.9, -3.0);
}

/** The torso: robe with a torn hem, belt and pouch, the brass cross on its chain, a briar across the cloth. */
function torso(c: LookCtx): void {
  const { r, s, f, mid, frame } = c;
  r.capsule(s.hip.x, s.hip.y, 2.0 + s.crouch * 0.4, mid.x, mid.y, 2.2, 0, 0, ROBE, { group: 1 });
  r.capsule(mid.x, mid.y, 2.2, s.chest.x, s.chest.y, 2.5, 0, 0.5, ROBE, { group: 1 });
  r.shade(s.hip.x - f * 1.2 + (s.chest.x - s.hip.x) * 0.5, mid.y, 1.2, 3.2, s.lean, -0.8, 1);
  // The robe: down to the boots, the hem torn into points that sway with the stride.
  const hemY = Math.max(s.backFoot.y, s.frontFoot.y) - 1.4 + s.crouch * 1.4;
  const sway = (s.frontFoot.x - s.backFoot.x) * 0.25;
  const pts: number[] = [s.hip.x - 2.3, s.hip.y - 0.4, s.hip.x + 2.3, s.hip.y - 0.4];
  const NT = 9;
  for (let i = 0; i <= NT; i++) {
    const u = 1 - i / NT; // front (1) to back (0)
    const x = s.hip.x + (u * 2 - 1) * 4.1 + sway + (u - 0.5) * f * 1.6;
    const ragged = i % 2 === 0 ? 0 : -1.3 - ((i * 5) % 3) * 0.5;
    pts.push(x, hemY + ragged);
  }
  r.poly(pts, 2 + NT + 1, 1.2, ROBE, 0.15, { group: 1 });
  // Torn strips hanging below the hem, darker, and a darker band above it.
  for (let i = 1; i < NT; i += 2) {
    const u = 1 - i / NT;
    const x = s.hip.x + (u * 2 - 1) * 4.1 + sway + (u - 0.5) * f * 1.6;
    r.capsule(x, hemY - 1.5, 0.75, x + f * 0.2, hemY + 0.5 - ((i * 3) % 2) * 0.4, 0.15, 1.3, 1.3, ROBE_D, { group: 1 });
  }
  r.stroke(s.hip.x - 3.6 + sway - f * 0.8, hemY - 2.0, s.hip.x + 3.6 + sway + f * 0.8, hemY - 2.0, ROBE_D, 1, true);
  r.stroke(s.hip.x - 0.4 + sway * 0.6, s.hip.y + 1.6, s.hip.x - 0.9 + sway, hemY - 2.2, ROBE_D, 1, true);
  r.stroke(s.hip.x + 1.5 * f + sway * 0.6, s.hip.y + 1.6, s.hip.x + 1.9 * f + sway, hemY - 2.2, ROBE_D, 1, true);
  // Belt, buckle and a leather pouch.
  const belt = { x: s.hip.x + c.ux * 0.13, y: s.hip.y + c.uy * 0.13 };
  r.stamp(belt.x, belt.y, 2.3, 0.6, Math.atan2(c.uy, c.ux) + Math.PI / 2, LEATHER, 1.2, false, 1);
  r.dot(belt.x + f * 0.5, belt.y, BRASS, 3, 5);
  r.ellipse(belt.x + f * 1.9, belt.y + 1.0, 1.05, 1.25, 0, 2.6, LEATHER, { group: 6 });
  r.stroke(belt.x + f * 1.3, belt.y + 0.3, belt.x + f * 2.5, belt.y + 0.4, BRASS, 2, true);
  // The cross on its chain: it falls from the neck and hangs on the breastbone.
  const nx = s.chest.x + f * 1.1, ny = s.chest.y - 0.2;
  const cx = s.chest.x + (s.hip.x - s.chest.x) * 0.42 + f * 1.7, cy = s.chest.y + (s.hip.y - s.chest.y) * 0.42;
  r.stroke(nx, ny, cx, cy - 1.0, BRASS, 2, true);
  r.stamp(cx, cy, 0.38, 1.35, 0, BRASS, 4, true, 1); r.stamp(cx, cy - 0.4, 1.0, 0.36, 0, BRASS, 4, true, 1);
  // A briar crossing the robe from shoulder to hip, with a few leaves.
  const v0 = { x: s.chest.x - f * 1.6, y: s.chest.y + 0.5 }, v1 = { x: s.hip.x + f * 1.2, y: s.hip.y + 2.0 };
  for (let k = 0; k <= 10; k++) {
    const [px, py] = lerp(v0, v1, k / 10);
    r.dot(px + Math.sin(k * 1.3) * 0.55, py, VINE, 3 + (k % 2), 3);
  }
  for (const k of [2, 5, 8]) {
    const [px, py] = lerp(v0, v1, k / 10);
    leaf(c, px + f * 0.5, py - 0.3, -0.5 * f, 0.85, 3.0);
  }
  // A leaf or two stirring off the cloth.
  for (let i = 0; i < 2; i++) {
    const ph = frame * 0.021 + i * 3.7, fall = ph - Math.floor(ph);
    r.dot(s.hip.x - f * 3.0 + Math.sin(ph * 6.3) * 1.6, s.hip.y - 5.0 + fall * 9.0, LEAF, 3, 10);
  }
}

/** The cloak's yoke: a hump of moss cloth over the shoulders, torn along its lower edge, leaves growing on it. */
function shoulders(c: LookCtx): void {
  const { r, s, f } = c;
  r.ellipse(s.chest.x - f * 0.8, s.chest.y - 0.3, 3.7, 2.4, s.lean * 0.8 + f * 0.1, 2.6, MOSS, { group: G_CAPE });
  r.ellipse(s.chest.x - f * 2.0, s.chest.y - 1.3, 2.5, 2.1, s.lean * 0.8, 2.8, MOSS, { group: G_CAPE });
  r.shade(s.chest.x - f * 0.7, s.chest.y + 1.0, 3.3, 0.7, s.lean, -1.0, G_CAPE);
  // The torn lower edge: points hanging off the yoke.
  for (let i = 0; i < 5; i++) {
    const x = s.chest.x - f * (3.2 - i * 1.4), y = s.chest.y + 1.5 + (i % 2) * 0.6;
    r.capsule(x, y - 0.6, 0.75, x - f * 0.2, y + 1.0 + (i % 3) * 0.3, 0.12, 2.9, 2.9, MOSS, { group: G_CAPE });
  }
  leaf(c, s.chest.x - f * 2.6, s.chest.y - 1.9, -0.9 * f, 1.2, 3.2);
  leaf(c, s.chest.x - f * 1.0, s.chest.y - 2.2, 0.5 * f, 0.95, 3.2);
  leaf(c, s.chest.x + f * 0.9, s.chest.y + 1.5, 0.7 * f, 0.8, 3.2);
}

/** His face: the dark inside the cowl, two small green lights, a pale jaw below. */
function head(c: LookCtx): void {
  const { r, s } = c;
  const ht = s.headTilt;
  const [hx, hy] = hh(c, 0, 0);
  limb(r, s.neck, { x: hx, y: hy }, 0.95, 1.0, 3, SKIN, 11);
  r.ellipse(hx, hy, 2.3, 2.45, ht, 4, SKIN, { group: 11 });
  r.ellipse(...hh(c, 2.0, -1.0), 0.9, 0.85, ht, 4.5, SKIN, { group: 11 });
  r.ellipse(...hh(c, 1.1, 0.5), 2.3, 2.3, ht, 4.9, VOID, { group: 11 });
  if (!s.eyesShut && !c.dead) {
    r.dot(...hh(c, 1.7, 0.7), SLOT.glow, 3, 40);
    r.dot(...hh(c, 0.7, 0.72), SLOT.glow, 2, 40);
  }
  r.stamp(...hh(c, 1.5, -1.6), 1.2, 0.55, ht, SKIN, 1, false, 11);
}

/** The cowl: a deep hood round the face, its peak drooping on the crown chain, a small bone cross at the brow. */
function hood(c: LookCtx): void {
  const { r, s, costume, f } = c;
  const ht = s.headTilt;
  // The shell over the back of the head and the shoulders' nape.
  r.ellipse(...hh(c, -1.5, 0.6), 2.6, 3.5, ht, 6.0, MOSS, { group: G_HOOD });
  r.ellipse(...hh(c, -2.0, -1.1), 2.4, 2.4, ht, 5.8, ROBE_D, { group: G_HOOD });
  // The rim round the face, hooded forward over the brow.
  const rim: Array<[number, number]> = [hh(c, -0.2, 3.4), hh(c, 1.6, 3.2), hh(c, 3.0, 1.7), hh(c, 3.2, -0.2), hh(c, 2.7, -1.9)];
  const xs = rim.map((p) => p[0]), ys = rim.map((p) => p[1]);
  r.tube(xs, ys, [1.2, 1.25, 1.15, 0.95, 0.75], rim.length, 6.4, MOSS, { group: G_HOOD });
  r.shade(...hh(c, 1.3, 3.7), 1.8, 0.6, ht, 0.9, G_HOOD);
  r.shade(...hh(c, -1.9, 0.0), 1.2, 2.4, ht, -0.9, G_HOOD);
  // The peak, drooping on the crown chain.
  if (costume) {
    const ch = costume.crown;
    r.capsule(...hh(c, -0.3, 3.0), 1.8, ch.pts[0].x, ch.pts[0].y, 1.4, 6.3, 6.4, MOSS, { group: G_HOOD });
    chainTube(r, ch, 6.4, MOSS, { group: G_HOOD }, 1.4, 0.3);
    r.shade(ch.pts[1].x, ch.pts[1].y, 1.2, 0.5, 0, -0.9, G_HOOD);
  }
  // The bone cross at the brow, and a leaf at the temple.
  const [bx, by] = hh(c, 2.1, 2.5);
  r.stamp(bx, by, 0.28, 0.9, 0, BONE, 3, true, G_HOOD); r.stamp(bx, by - 0.1, 0.8, 0.26, 0, BONE, 3, true, G_HOOD);
  leaf(c, ...hh(c, -1.6, 3.1), 0.6 * f, 1.0, 6.6, G_LEAF);
}

/** The staff: crooked briar-wood wound with a vine, leaves along it, a bud of green light cradled at the head. */
function staff(c: LookCtx): void {
  const { r, s, frame, a } = c;
  const w = s.wand, ang = w.angle + w.spin, cc = Math.cos(ang), sn = Math.sin(ang);
  const glow = w.glow * (0.9 + Math.sin(frame * 0.3) * 0.1);
  const px = -sn, py = cc;
  const P = (u: number, v: number): [number, number] => [w.x + cc * u + px * v, w.y + sn * u + py * v];
  // The shaft: crooked sections.
  const U = [-4.0, 0.0, 4.0, 8.0, 10.2], V = [0, 0.3, -0.25, 0.35, 0];
  for (let i = 1; i < U.length; i++) {
    const [ax, ay] = P(U[i - 1], V[i - 1]), [bx, by] = P(U[i], V[i]);
    r.capsule(ax, ay, 0.55, bx, by, 0.48, 8.2, 8.2, WOOD, { group: 14 });
  }
  // The vine wound round it, and leaves in pairs.
  for (let u = -3.5; u <= 10.0; u += 0.5) {
    const s1 = Math.sin(u * 1.9);
    const [x, y] = P(u, s1 * 0.6 + (u < 0 ? 0 : 0.2));
    r.dot(x, y, VINE, 3 + (s1 > 0 ? 1 : 0), 8.5);
  }
  for (const u of [2.6, 6.2, 9.0]) {
    leaf(c, ...P(u + 0.4, 1.2), ang - 0.9, 1.0, 8.6, 14);
    leaf(c, ...P(u - 0.2, -1.1), ang + 0.8, 0.9, 8.6, 14);
  }
  // The head: a fork of twigs cradling a bud that glows.
  for (const sgn of [-1, 1]) {
    const [ax, ay] = P(9.8, 0), [bx, by] = P(11.4, sgn * 1.1), [ex, ey] = P(12.9, sgn * 0.6);
    r.capsule(ax, ay, 0.4, bx, by, 0.3, 8.4, 8.4, WOOD, { group: 14 });
    r.capsule(bx, by, 0.3, ex, ey, 0.22, 8.4, 8.4, WOOD, { group: 14 });
  }
  const [gx, gy] = P(11.7, 0), gs = 0.75 + glow * 0.35;
  r.ellipse(gx, gy, gs, gs * 0.9, ang, 9, ORB, { group: 14, noOutline: true });
  r.glowStamp(gx, gy, gs * 1.1, gs, ang, ORB, 3.0 + glow * 0.6, 1.0, 14);
  if (a.firing) for (let k = 0; k < 3; k++) {
    const t = frame * 0.3 + k * 2.1;
    leaf(c, gx + Math.cos(t) * 2.0, gy + Math.sin(t) * 2.0, t, 0.8, 20, 14);
  }
}

export const look: FighterLook = {
  id: 'father-thorne',
  mats: matsFor({
    // The robe: forest green with a blue-green shadow. Cloak and hood (MOSS) are the olive over it.
    coat: { keys: [0x060f0a, 0x0e2216, 0x183a24, 0x28553a, 0x437a54], gloss: 0.05, rim: 0.65, outline: 0x040a06 },
    coatD: { keys: [0x040a06, 0x09160d, 0x112a1a, 0x1c4028, 0x2e5c3c], gloss: 0.05, rim: 0.5, outline: 0x020604 },
    mantle: { keys: [0x2a1c0e, 0x5c4126, 0x8a6a3c, 0xb89458, 0xe0c488], gloss: 0.2, rim: 0.6, outline: 0x120a04 },
    leather: { keys: [0x120a06, 0x2a1a10, 0x4a3020, 0x6e4c32, 0x96704c], gloss: 0.25, rim: 0.6, outline: 0x060403 },
    trim: { keys: [0x2a2008, 0x6a5214, 0xa88a2a, 0xd8bc50, 0xfff0a0], gloss: 0.7, shine: 20, rim: 0.7, outline: 0x120c02 },
    skin: { keys: [0x2a2418, 0x6a5a40, 0xa89068, 0xd0b88c, 0xeed8b0], gloss: 0.1, rim: 0.5, outline: 0x120e08 },
    boot: { keys: [0x0e0804, 0x24160c, 0x40281a, 0x65432a], gloss: 0.3, shine: 12, rim: 0.6, outline: 0x060402 },
    wood: { keys: [0x120a06, 0x2e1c10, 0x52341e, 0x7a5430, 0xa07a48], gloss: 0.15, rim: 0.6, outline: 0x080402 },
    glow: { keys: [0x1a4a08, 0x5ab818, 0xb0f050, 0xf0ffc0], emissive: 1, glow: 0x1a4a0c, glowK: 1 },
    rune: { keys: [0x1a4a08, 0x5ab818, 0xb0f050, 0xf0ffc0], emissive: 1, glow: 0x1a4a0c, glowK: 1 },
  }, [
    // Moss cloth (cloak and hood), leaf, vine, the bud's light, the bone cross, the hood's inner dark.
    { keys: [0x08120a, 0x142a10, 0x26441a, 0x3e6226, 0x658c40], gloss: 0.05, rim: 0.7, outline: 0x050a04 },
    { keys: [0x10300c, 0x2a6a1c, 0x58a830, 0x9ad850, 0xd0f890], gloss: 0.25, rim: 0.8, outline: 0x061406 },
    { keys: [0x0c1408, 0x1e2c10, 0x38481c, 0x58702c, 0x80a040], gloss: 0.1, rim: 0.5, outline: 0x060a04 },
    { keys: [0x3a8a10, 0x90e030, 0xd8ff80, 0xffffff], emissive: 1, glow: 0x2a6a0c, glowK: 1.2 },
    { keys: [0x6a6450, 0xb8b090, 0xe8e0c0, 0xfffff0], gloss: 0.2, rim: 0.5, outline: 0x1a1810 },
    { keys: [0x010201, 0x040704, 0x080d08, 0x121a12], rim: 0.15, outline: 0x010201 },
  ]),
  accent: rgbOf(0x8ee040),
  outfit: 'robe',
  headgear: 'hood',
  hair: 'none',
  face: 'shadow',
  wand: 'staff',
  mantle: false,
  pouches: false,
  eyeGlow: [0.55, 1, 0.3],
  build: { limb: 1.0, torso: 1.05, head: 1.0 },
  replace: ['back', 'torso', 'head', 'headgear'],
  extras: { back, torso, shoulders, head, headgear: hood },
  drawWand: staff,
};

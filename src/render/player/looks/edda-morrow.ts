import { chainTube } from '@/render/creatures/anatomy';
import { boot, hand, limb } from '@/render/player/AlchemistArt';
import { EXTRA0, SLOT, matsFor, rgbOf } from '@/render/player/fighterLook';
import type { FighterLook, LookCtx } from '@/render/player/fighterLook';

/**
 * Edda Morrow, the Glass Saint (Support): a long white coat with gold trim over navy, a gold halo behind
 * her head, blonde hair, a tall stained-glass shield on her off arm and a gold staff whose gem glows warm.
 * Everything gold is the `trim`/`mantle` slots; the halo, the gem and the shield's glass are her extras.
 */
const WHITE = SLOT.coat, NAVY = SLOT.coatD, GOLD = SLOT.trim, CUFF = SLOT.mantle, HAIR = SLOT.hair, WOOD = SLOT.wood;
const GLASS_BLUE = EXTRA0, GLASS_PALE = EXTRA0 + 1, GLASS_DEEP = EXTRA0 + 2, HALO = EXTRA0 + 3, GEM = EXTRA0 + 4;

// Group ids: 12/13/14 belong to the flask, the near arm and the wand (the chill's bias table keys on them);
// the shield and the halo take their own (>= 32 frosts at the base bias, 40 is bare).
const G_SHIELD = 34, G_PLATE = 35;
const EXTRA_GLINT = 10;

/** A point `side` cells forward of the spine and `up` cells up it from the hip, following the torso's lean. */
function spine(c: LookCtx, side: number, up: number): [number, number] {
  const l = Math.hypot(c.ux, c.uy) || 1, vx = c.ux / l, vy = c.uy / l;
  return [c.s.hip.x + vx * up + c.f * -vy * side, c.s.hip.y + vy * up + c.f * vx * side];
}

/** Far arm and leg, rear coat and the hair that falls behind the shoulder; then the halo behind the head. */
function back(c: LookCtx): void {
  const { r, s, costume } = c;
  limb(r, s.chest, s.backElbow, 0.95, 0.8, -6, WHITE, 2, true);
  limb(r, s.backElbow, s.backHand, 0.82, 0.62, -6, WHITE, 2, true);
  r.stamp(s.backElbow.x + (s.backHand.x - s.backElbow.x) * 0.7, s.backElbow.y + (s.backHand.y - s.backElbow.y) * 0.7, 0.8, 0.8, 0, CUFF, 1, false, 2);
  hand(r, s.backHand, s.backElbow, -6, 2, true);
  limb(r, s.hip, s.backKnee, 1.2, 0.95, -5, NAVY, 3, true);
  limb(r, s.backKnee, s.backFoot, 0.95, 0.8, -5, SLOT.boot, 3, true);
  boot(r, s.backFoot, s.backKnee, c.f, -5, 3, true);
  if (costume) {
    chainTube(r, costume.tails[0], -4, WHITE, { group: 4, far: true }, 1.5, 1.8);
    // Long blonde hair over the shoulder blades, hung on the shoulder chain.
    const nape = c.H(-1.9, -0.6), root = costume.mantle.pts[0];
    r.capsule(nape[0], nape[1], 1.0, root.x, root.y, 1.2, -2.8, -3.0, HAIR, { group: 33 });
    chainTube(r, costume.mantle, -3.1, HAIR, { group: 33 }, 1.2, 0.6);
  }
  halo(c);
}

/** The halo: a thin ring of gold light standing behind the head, with a cross of rays above it. */
function halo(c: LookCtx): void {
  const { r, s, frame } = c;
  const [cx, cy] = c.H(-0.5, 0.8);
  const ht = s.headTilt, cs = Math.cos(ht), sn = Math.sin(ht);
  const P = (x: number, y: number): [number, number] => [cx + x * cs - y * sn, cy + x * sn + y * cs];
  const Z = -2, rx = 3.7, ry = 4.1;
  const N = 76;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const [x, y] = P(Math.cos(a) * rx, Math.sin(a) * ry);
    r.dot(x, y, HALO, Math.sin(a + 2.3) > 0.2 ? 3 : 2, Z);
  }
  // Rays: a long one straight up, four short ones on the diagonals.
  const ray = (ang: number, from: number, to: number, tone: number): void => {
    const ax = Math.sin(ang), ay = -Math.cos(ang);
    const [x0, y0] = P(ax * rx * from, ay * ry * from), [x1, y1] = P(ax * rx * to, ay * ry * to);
    r.stroke(x0, y0, x1, y1, HALO, tone, true);
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / r.step));
    for (let k = 0; k <= n; k++) r.dot(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, HALO, tone, Z);
  };
  const tw = 0.5 + 0.5 * Math.sin(frame * 0.07);
  ray(0, 1.0, 1.55 + tw * 0.15, 3);
  for (const a of [-0.78, 0.78, -2.36, 2.36]) ray(a, 1.0, 1.28, 2);
  ray(-1.57, 1.0, 1.22, 2); ray(1.57, 1.0, 1.22, 2);
}

/** The torso: coat to the shins, a gold hem and sash, a gilded pauldron and a sun at the heart. */
function torso(c: LookCtx): void {
  const { r, s, f, mid } = c;
  r.capsule(s.hip.x, s.hip.y, 2.0 + s.crouch * 0.4, mid.x, mid.y, 2.2, 0, 0, WHITE, { group: 1 });
  r.capsule(mid.x, mid.y, 2.2, s.chest.x, s.chest.y, 2.5, 0, 0.5, WHITE, { group: 1 });
  r.shade(s.hip.x - f * 1.2 + (s.chest.x - s.hip.x) * 0.5, mid.y, 1.2, 3.2, s.lean, -0.8, 1);
  // The coat skirt, hem just below the knee so the navy legs and boots show under it.
  const hemY = Math.max(s.backFoot.y, s.frontFoot.y) - 1.7 + s.crouch * 1.2;
  const sway = (s.frontFoot.x - s.backFoot.x) * 0.25;
  r.poly([
    s.hip.x - 2.3, s.hip.y - 0.4, s.hip.x + 2.3, s.hip.y - 0.4,
    s.hip.x + 3.4 + sway + f * 0.8, hemY, s.hip.x - 3.4 + sway - f * 0.8, hemY,
  ], 4, 1.2, WHITE, 0.15, { group: 1 });
  r.stroke(s.hip.x - 3.2 + sway - f * 0.8, hemY - 0.1, s.hip.x + 3.2 + sway + f * 0.8, hemY - 0.1, GOLD, 2.4, true);
  r.stroke(s.hip.x - 3.2 + sway - f * 0.8, hemY - 0.6, s.hip.x + 3.2 + sway + f * 0.8, hemY - 0.6, GOLD, 3.2, true);
  // The sash: a gold band at the waist with a clasp.
  const belt = { x: s.hip.x + c.ux * 0.14, y: s.hip.y + c.uy * 0.14 };
  r.stamp(belt.x, belt.y, 2.35, 0.65, Math.atan2(c.uy, c.ux) + Math.PI / 2, GOLD, 2, false, 1);
  r.dot(belt.x + f * 0.5, belt.y, GOLD, 5, 5);
  // A navy panel down the front of the coat, and two folds in the skirt.
  const [tx, ty] = spine(c, 1.7, 4.0), [bx, by] = spine(c, 2.0, 0.6);
  r.stroke(tx, ty, bx, by, NAVY, 2, true, 0.35);
  r.stroke(s.hip.x - 0.9 + sway * 0.6, s.hip.y + 1.8, s.hip.x - 1.2 + sway, hemY - 0.8, WHITE, 1, true);
  r.stroke(s.hip.x + 1.4 + sway * 0.6, s.hip.y + 1.8, s.hip.x + 1.9 * f + sway + f * 0.3, hemY - 0.8, WHITE, 1, true);
}

/** Her face: a fine profile (a small nose, a lashed eye, a rose mouth) under blonde hair swept back from the brow. */
function head(c: LookCtx): void {
  const { r, s, f, H } = c;
  const ht = s.headTilt;
  limb(r, s.neck, s.head, 0.8, 0.9, 3, SLOT.skin, 11);
  r.ellipse(s.head.x, s.head.y, 2.25, 2.45, ht, 4, SLOT.skin, { group: 11 });
  r.ellipse(...H(1.25, -1.55), 1.0, 0.85, ht, 4.1, SLOT.skin, { group: 11 });
  r.ellipse(...H(2.15, 0.0), 0.62, 0.52, ht + f * 0.2, 4.6, SLOT.skin, { group: 11 });
  r.stamp(...H(-1.25, 0.2), 0.5, 0.65, ht, SLOT.skin, 0.5, false, 11);
  // Hair: the back mass, the crown, a fringe that falls forward at the brow.
  r.ellipse(...H(-1.3, 0.0), 1.7, 2.7, ht, 4.5, HAIR, { group: 11 });
  r.ellipse(...H(-0.2, 1.35), 2.55, 1.45, ht, 4.6, HAIR, { group: 11 });
  r.ellipse(...H(1.1, 1.5), 1.35, 0.8, ht, 4.7, HAIR, { group: 11 });
  r.shade(...H(-0.6, 1.9), 1.7, 0.5, ht, 0.9, 11);
  r.shade(...H(-1.6, -0.6), 1.0, 1.6, ht, -0.7, 11);
  const [ex, ey] = H(1.25, 0.45);
  if (s.eyesShut) r.stroke(ex - 0.55, ey, ex + 0.5, ey + 0.1, SLOT.eye, 0, true);
  else {
    r.stamp(ex, ey, 0.32, 0.55, 0, SLOT.eye, 0, false, 11);
    r.dot(ex + 0.15 + s.gazeX * 0.2 * f, ey - 0.25 + s.gazeY * 0.15, EXTRA_GLINT, 1, 30);
    r.stroke(...H(0.85, 1.0), ...H(1.7, 0.95), SLOT.eye, 0, true);
  }
  r.stroke(...H(0.5, 1.4), ...H(1.9, 1.3), HAIR, 1, true);
  if (s.mouth > 0.3) r.stamp(...H(1.65, -0.95), 0.4, 0.15 + s.mouth * 0.3, ht, SLOT.eye, 0, true, 11);
  else r.stamp(...H(1.8, -0.9), 0.35, 0.15, ht, SLOT.blood, 1, false, 11);
  r.shade(...H(1.0, -0.2), 0.9, 0.7, ht, 0.35, 11);
}

/** Gilded pauldron and the gold on the near leg. */
function shoulders(c: LookCtx): void {
  const { r, s, f } = c;
  r.ellipse(s.chest.x - f * 0.1, s.chest.y - 0.5, 2.7, 1.8, s.lean * 0.8, 2.8, GOLD, { group: G_PLATE });
  r.shade(s.chest.x - f * 0.1, s.chest.y + 0.5, 2.4, 0.6, s.lean, -0.9, G_PLATE);
  r.stamp(s.chest.x + f * 0.3, s.chest.y - 1.2, 1.0, 0.45, s.lean, GOLD, 4, false, G_PLATE);
  // Greave: gold on the near boot's top.
  const k = { x: s.frontFoot.x + (s.frontKnee.x - s.frontFoot.x) * 0.3, y: s.frontFoot.y + (s.frontKnee.y - s.frontFoot.y) * 0.3 };
  r.stamp(k.x, k.y, 1.15, 0.5, 0, GOLD, 2, false, 8);
  shield(c);
}

/** The stained-glass shield: a gold-rimmed rose window carried before the body (slung on the back when she climbs or crawls). */
function shield(c: LookCtx): void {
  const { r, s, f, dead } = c;
  const slung = s.kind === 'climb' || s.kind === 'crawl';
  let cx: number, cy: number, ang: number, k = 1;
  if (dead) {
    // Fallen: the shield lies where the off hand let it go.
    cx = s.backHand.x + f * 1.0; cy = s.backHand.y - 0.5; ang = 0.3 * f; k = 0.95;
  } else if (slung) {
    [cx, cy] = spine(c, -2.5, 3.2); ang = s.lean; k = 0.95;
  } else {
    [cx, cy] = spine(c, 4.3, 3.2);
    // The off arm holds it: it follows the back hand a little.
    cx += (s.backHand.x - (s.hip.x - f * 2.2)) * 0.14; cy += (s.backHand.y - (s.hip.y + 0.2)) * 0.1;
    ang = s.lean;
  }
  const z = slung ? -2 : 5;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const P = (x: number, y: number): [number, number] => [cx + (x * f) * ca - y * sa, cy + (x * f) * sa + y * ca];
  const rx = 2.5 * k, ry = 3.1 * k;
  r.ellipse(cx, cy, rx, ry, ang, z, GOLD, { group: G_SHIELD, depth: 0.9 });
  const pane = (x: number, y: number, px: number, py: number, mat: number, tone: number): void => {
    const [qx, qy] = P(x * k, y * k);
    r.stamp(qx, qy, px * k, py * k, ang, mat, tone, false, G_SHIELD);
  };
  pane(0, 0, 1.85, 2.4, GLASS_BLUE, 1);
  // Four petals around a boss, each its own colour of glass.
  pane(-1.0, -1.2, 0.85, 1.0, GLASS_PALE, 2);
  pane(1.0, -1.2, 0.85, 1.0, GLASS_DEEP, 1);
  pane(-1.0, 1.2, 0.85, 1.0, GLASS_DEEP, 0);
  pane(1.0, 1.2, 0.85, 1.0, GLASS_PALE, 1);
  // Lead lines: a cross and a saltire in gold.
  const line = (x0: number, y0: number, x1: number, y1: number): void => { const [ax, ay] = P(x0 * k, y0 * k), [bx, by] = P(x1 * k, y1 * k); r.stroke(ax, ay, bx, by, GOLD, 3, true); };
  line(0, -2.6, 0, 2.6); line(-2.1, 0, 2.1, 0);
  line(-1.6, -2.0, 1.6, 2.0); line(1.6, -2.0, -1.6, 2.0);
  r.ellipse(cx, cy, 0.5 * k, 0.55 * k, 0, z + 3, HALO, { group: G_SHIELD, noOutline: true });
}

/** The staff: a gold shaft with a caged gem at its head, lit warm. The head sits where the spell leaves. */
function staff(c: LookCtx): void {
  const { r, s, frame, a } = c;
  const w = s.wand, ang = w.angle + w.spin, cc = Math.cos(ang), sn = Math.sin(ang);
  const glow = w.glow * (0.9 + Math.sin(frame * 0.3) * 0.1);
  const px = -sn, py = cc;
  r.capsule(w.x - cc * 3.4, w.y - sn * 3.4, 0.52, w.x + cc * 9.2, w.y + sn * 9.2, 0.42, 8.2, 8.2, WOOD, { group: 14 });
  // Gold rings on the shaft and a ferrule at the butt.
  for (const t of [-1.2, 3.2]) r.capsule(w.x + cc * t, w.y + sn * t, 0.62, w.x + cc * (t + 0.8), w.y + sn * (t + 0.8), 0.62, 8.3, 8.3, GOLD, { group: 14 });
  r.capsule(w.x - cc * 3.7, w.y - sn * 3.7, 0.62, w.x - cc * 2.9, w.y - sn * 2.9, 0.55, 8.3, 8.3, GOLD, { group: 14 });
  // The head: a collar, a cage of two prongs and the gem.
  const hx = w.x + cc * 9.4, hy = w.y + sn * 9.4;
  r.capsule(hx - cc * 0.6, hy - sn * 0.6, 0.62, hx + cc * 0.5, hy + sn * 0.5, 0.8, 8.4, 8.4, GOLD, { group: 14 });
  for (const sgn of [-1, 1]) {
    r.capsule(hx + cc * 0.5 + px * sgn * 0.5, hy + sn * 0.5 + py * sgn * 0.5, 0.3, hx + cc * 2.0 + px * sgn * 0.95, hy + sn * 2.0 + py * sgn * 0.95, 0.3, 8.5, 8.5, GOLD, { group: 14 });
    r.capsule(hx + cc * 2.0 + px * sgn * 0.95, hy + sn * 2.0 + py * sgn * 0.95, 0.28, hx + cc * 3.2 + px * sgn * 0.3, hy + sn * 3.2 + py * sgn * 0.3, 0.26, 8.5, 8.5, GOLD, { group: 14 });
  }
  const gx = hx + cc * 1.9, gy = hy + sn * 1.9, gs = 0.7 + glow * 0.35;
  r.ellipse(gx, gy, gs * 1.2, gs * 0.9, ang, 9, GEM, { group: 14, noOutline: true });
  r.glowStamp(gx, gy, gs * 1.15, gs * 0.85, ang, GEM, 3.0 + glow * 0.5, 1.2, 14);
  // A twinkle that wheels around the gem while she casts.
  if (a.firing) {
    const t = frame * 0.35;
    r.dot(gx + Math.cos(t) * 1.8, gy + Math.sin(t) * 1.8, GEM, 3, 20);
    r.dot(gx - Math.cos(t) * 1.8, gy - Math.sin(t) * 1.8, GEM, 3, 20);
  }
}

export const look: FighterLook = {
  id: 'edda-morrow',
  mats: matsFor({
    // The white coat, shadowed blue-grey.
    coat: { keys: [0x232b3e, 0x66728c, 0xb0bace, 0xeceae6, 0xffffff], gloss: 0.12, rim: 0.85, outline: 0x151b2c },
    // Navy: trousers.
    coatD: { keys: [0x050b16, 0x0b1b30, 0x16304e, 0x244c72, 0x3c78a0], gloss: 0.12, rim: 0.7, outline: 0x040810 },
    // Gold cuffs (the sleeve cuff stamp uses this slot).
    mantle: { keys: [0x3a2606, 0x8a5c10, 0xd49a2a, 0xffd46a, 0xfff0b0], gloss: 0.8, shine: 22, rim: 0.7, outline: 0x140a02 },
    leather: { keys: [0x2a1c10, 0x5c4024, 0x8e6a3c, 0xc09a58, 0xe8c888], gloss: 0.3, rim: 0.6, outline: 0x120a04 },
    trim: { keys: [0x3a2606, 0x8a5c10, 0xd49a2a, 0xffd46a, 0xfff0b0], gloss: 0.8, shine: 22, rim: 0.7, outline: 0x140a02 },
    skin: { keys: [0x3a2218, 0x80523e, 0xc89478, 0xefc4a4, 0xffe6d0], gloss: 0.15, rim: 0.6, outline: 0x160a06 },
    hair: { keys: [0x3a2a10, 0x8a6420, 0xc8a040, 0xf0d070, 0xfff0b0], gloss: 0.35, shine: 14, rim: 0.75, outline: 0x1a1206 },
    boot: { keys: [0x05080e, 0x0d1622, 0x18283c, 0x2a4260], gloss: 0.4, shine: 14, rim: 0.6, outline: 0x020406 },
    // The staff's shaft: gold.
    wood: { keys: [0x2a1a06, 0x6a4410, 0xb08020, 0xe8c050, 0xfff0b0], gloss: 0.6, shine: 18, rim: 0.6, outline: 0x120a02 },
    glow: { keys: [0x6a4a08, 0xe0a820, 0xffe070, 0xfffbe0], emissive: 1, glow: 0x6a4a10, glowK: 1 },
    rune: { keys: [0x6a4a08, 0xe0a820, 0xffe070, 0xfffbe0], emissive: 1, glow: 0x6a4a10, glowK: 1 },
  }, [
    // Shield glass: light, deep and pale panes. A little self-light so it glints in the dark.
    { keys: [0x16304c, 0x2c6494, 0x6cb4dc, 0xbce6fa, 0xffffff], gloss: 0.9, shine: 26, rim: 0.9, emissive: 0.22, outline: 0x0a1626 },
    { keys: [0x3a4a5a, 0x8aa4ba, 0xd0e4f0, 0xf4fbff, 0xffffff], gloss: 0.9, shine: 26, rim: 0.9, emissive: 0.3, outline: 0x0a1626 },
    { keys: [0x0a1a30, 0x16406e, 0x2a70a8, 0x58a8d8, 0xa8dcf4], gloss: 0.9, shine: 26, rim: 0.9, emissive: 0.15, outline: 0x061020 },
    // The halo's gold light and the gem.
    { keys: [0x7a4a06, 0xc88418, 0xf0b840, 0xffe8a0, 0xfffbe0], emissive: 1, glow: 0x5a3a0c, glowK: 1 },
    { keys: [0x70a8d8, 0xc8f0ff, 0xfffbe8, 0xffffff], emissive: 1, glow: 0x6a5a20, glowK: 1.2 },
  ]),
  accent: rgbOf(0xf0c860),
  outfit: 'robe',
  headgear: 'none',
  hair: 'none',
  face: 'open',
  wand: 'staff',
  mantle: false,
  pouches: false,
  replace: ['back', 'torso', 'head'],
  extras: { back, torso, shoulders, head },
  drawWand: staff,
};


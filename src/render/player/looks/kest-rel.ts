import { GLINT } from '@/render/player/AlchemistArt';
import { EXTRA0, SLOT, matsFor, rgbOf } from '@/render/player/fighterLook';
import type { FighterLook, LookCtx } from '@/render/player/fighterLook';
import type { V } from '@/entities/playerPose';
import type { CreatureRaster } from '@/render/creatures/raster';

/**
 * Kest Rel, the Chimney Jack: a rooftop rogue in dark leathers. A red scarf that streams behind him, a red
 * headband with two tails, red knee and elbow pads and boot cuffs, a tattered vest-apron, glowing amber eyes in
 * a masked face, and a grappling hook on a chain where the wand would be. Slimmer than the roster's bulwarks
 * (build below 1); the scarf rides the mantle chain, the apron and the rear flap the two coat chains, and the
 * headband tails the crown chain.
 */

const PAD = EXTRA0;        // the red-orange knee and elbow pads (lacquered)
const STEEL = EXTRA0 + 1;  // the hook and chain
const VEST = EXTRA0 + 2;   // the tan vest-apron

const RED = SLOT.mantle;   // scarf, headband, wraps
const LEATHER = SLOT.leather;
const COAT = SLOT.coat;
const GLOW = SLOT.glow;
const G = { pad: 34, scarf: 35, band: 36, apron: 37, flap: 38, hook: 14, cuff: 39, strap: 40, mask: 41 };

function band(r: CreatureRaster, a: V, b: V, t: number, w: number, across: number, mat: number, tone: number, group: number): void {
  const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
  r.stamp(x, y, w, across, Math.atan2(b.y - a.y, b.x - a.x), mat, tone, false, group);
}

/** A flat cloth ribbon through a list of points, `w0` wide at the first and `w1` at the last. */
function ribbon(r: CreatureRaster, pts: ReadonlyArray<readonly [number, number]>, w0: number, w1: number, z: number, mat: number, group: number, dome = 0.6): void {
  const n = pts.length;
  const left: number[] = [], right: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = w0 + (w1 - w0) * (i / Math.max(1, n - 1));
    left.push(p[0] - dy * w, p[1] + dx * w);
    right.push(p[0] + dy * w, p[1] - dx * w);
  }
  const poly: number[] = [];
  for (let i = 0; i < n; i++) poly.push(left[i * 2], left[i * 2 + 1]);
  for (let i = n - 1; i >= 0; i--) poly.push(right[i * 2], right[i * 2 + 1]);
  r.poly(poly, n * 2, z, mat, dome, { group });
}

const chainPts = (ch: { pts: ReadonlyArray<V> }, from: number, to: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let i = from; i < Math.min(to, ch.pts.length); i++) out.push([ch.pts[i].x, ch.pts[i].y]);
  return out;
};

/** The scarf: wrapped round the neck, with a long end that streams on the mantle chain and flutters past it. */
function scarfTrail(c: LookCtx): void {
  const { r, s, f, frame, costume, a } = c;
  const calm = c.ctx.state.reduceFlashes === true;
  const neck = c.H(-1.6, -1.5);
  const pts: Array<[number, number]> = [[neck[0], neck[1]]];
  if (costume) pts.push(...chainPts(costume.mantle, 1, 4).map((p, i): [number, number] => [p[0] + (calm ? 0 : Math.sin(frame * 0.18 + i * 1.7) * 0.25 * (i + 1) * 0.5), p[1]]));
  else pts.push([neck[0] - f * 1.5, neck[1] + 1.6], [neck[0] - f * 2.6, neck[1] + 3.0]);
  // Past the chain's end the cloth keeps going the way it was heading, rippling.
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  let dx = last[0] - prev[0], dy = last[1] - prev[1];
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const speed = Math.min(1, Math.abs(a._svx) / 2.4);
  for (let i = 1; i <= 3; i++) {
    const wave = calm ? 0 : Math.sin(frame * 0.3 + i * 1.3) * (0.35 + speed * 0.6);
    // The tail is drawn out along the stream in a run, and falls straighter down at rest.
    const len = 1.5 + speed * 0.9;
    const px = last[0] + dx * len * i - dy * wave * i * 0.5 - f * (0.15 + speed * 0.8) * i;
    const py = last[1] + dy * len * i + dx * wave * i * 0.5 + (1 - speed) * 0.5 * i;
    pts.push([px, py]);
  }
  ribbon(r, pts, 1.15, 0.45, -1.4, RED, G.scarf, 0.5);
  void s;
}

/** The headband's knot and two tails, hung from the crown chain turned upside down so they trail down and back. */
function headband(c: LookCtx): void {
  const { r, s, f, costume } = c;
  const ht = s.headTilt;
  // The band round the head, on the head's own volume (it only repaints head pixels).
  r.stamp(...c.H(0.2, 1.5), 2.7, 0.7, ht, RED, 1.0, false, 11);
  // The knot at the back of the head.
  const [kx, ky] = c.H(-2.4, 1.6);
  r.ellipse(kx, ky, 0.9, 0.85, 0, 6.8, RED, { group: G.band });
  const tail = (sx: number, sy: number, k: number): Array<[number, number]> => {
    if (!costume) return [[kx, ky], [kx - f * 1.2, ky + 1.0 + k * 0.4], [kx - f * 2.0, ky + 2.4 + k * 0.6]];
    const ch = costume.crown.pts, root = ch[0];
    const out: Array<[number, number]> = [[kx, ky]];
    for (let i = 1; i < ch.length; i++) out.push([kx + (ch[i].x - root.x) * sx * 0.95, ky - (ch[i].y - root.y) * sy * 0.9 + 0.2 * i * k]);
    return out;
  };
  ribbon(r, tail(1, 1, 0), 0.6, 0.25, 6.4, RED, G.band + 20, 0.4);
  ribbon(r, tail(0.7, 0.8, 1), 0.5, 0.2, 6.2, RED, G.band + 21, 0.4);
}

/** The scarf over the nose and mouth and wound round the neck; two glowing eyes above it. */
function face(c: LookCtx): void {
  const { r, s, f, H, dead } = c;
  const ht = s.headTilt;
  // Neck wrap.
  r.ellipse(s.neck.x + f * 0.1, s.neck.y + 0.2, 2.35, 1.2, s.lean * 0.5, 4.4, RED, { group: G.scarf + 20 });
  // Cloth over the lower face.
  r.ellipse(...H(1.0, -1.65), 1.85, 1.0, ht, 5.0, RED, { group: G.mask });
  r.shade(...H(0.4, -1.2), 1.6, 0.5, ht, 0.7, G.mask);
  // Eyes: two amber points above the cloth, one dimmer (the far one).
  if (!s.eyesShut && !dead) {
    r.dot(...H(1.55, 0.55), GLOW, 3.6, 50);
    r.dot(...H(0.5, 0.55), GLOW, 2.4, 50);
  }
  headband(c);
}

function legPads(c: LookCtx, hip: V, knee: V, foot: V, z: number, far: boolean): void {
  const { r, f } = c;
  // Knee pad: a round red lacquered cap, a lit rim.
  r.ellipse(knee.x + f * 0.5, knee.y, 1.55, 1.5, 0, z + 1.0, PAD, { group: G.pad, far });
  r.stamp(knee.x + f * 0.2, knee.y - 0.4, 0.65, 0.4, 0, PAD, 4.4, true, G.pad);
  // Boot cuff: a red band just above the ankle, a strap across the boot.
  band(r, knee, foot, 0.8, 0.55, 1.25, RED, 1.6, far ? 3 : 8);
  band(r, knee, foot, 0.5, 0.35, 1.1, LEATHER, 1.4, far ? 3 : 8);
  void hip;
}

function back(c: LookCtx): void {
  const { r, s, costume } = c;
  scarfTrail(c);
  // The rear flap of the jacket, short and ragged, on the first coat chain.
  if (costume) ribbon(r, chainPts(costume.tails[0], 0, 4), 1.0, 1.15, -2.6, COAT, G.flap, 0.5);
  legPads(c, s.hip, s.backKnee, s.backFoot, -5.2, true);
  // Far arm: red elbow pad and wrist wrap.
  r.ellipse(s.backElbow.x, s.backElbow.y, 1.1, 1.05, 0, -5.0, PAD, { group: G.pad + 20, far: true });
  band(r, s.backElbow, s.backHand, 0.6, 0.6, 0.95, RED, 1.2, 2);
}

function torso(c: LookCtx): void {
  const { r, s, f, mid, costume } = c;
  // Harness: a leather strap across the chest to the belt, a small steel buckle where it crosses.
  r.stroke(s.chest.x - f * 1.9, s.chest.y - 0.8, s.hip.x + f * 1.7, s.hip.y - 0.2, LEATHER, 1.4, false, 0.65);
  r.dot(mid.x + f * 0.2, mid.y + 0.1, SLOT.trim, 4, 30);
  // High collar.
  r.ellipse(s.chest.x - f * 0.6, s.chest.y - 0.9, 2.2, 1.1, s.lean * 0.6, 3.4, COAT, { group: 1 });
  // The vest-apron: tan cloth hung off the belt on the second coat chain, with an ochre stitched edge.
  if (costume) {
    const pts = chainPts(costume.tails[1], 0, 4);
    ribbon(r, pts, 1.4, 1.2, 4.6, VEST, G.apron, 0.6);
    for (let i = 1; i < pts.length; i++) r.dot(pts[i][0] + f * 0.9, pts[i][1], SLOT.leather, 4, 30);
  }
  // A big square belt buckle.
  const bx = s.hip.x + c.ux * 0.12 + f * 0.9, by = s.hip.y + c.uy * 0.12;
  r.ellipse(bx, by, 0.95, 0.85, 0, 3.6, SLOT.trim, { group: G.strap });
}

/** Near arm and leg: the elbow pad, the red wrist wrap's twin on the hand, the knee pad and boot cuff. */
function front(c: LookCtx): void {
  const { r, s } = c;
  legPads(c, s.hip, s.frontKnee, s.frontFoot, 3.0, false);
  r.ellipse(s.frontElbow.x, s.frontElbow.y, 1.2, 1.15, 0, 9.0, PAD, { group: G.pad + 20 });
  r.stamp(s.frontElbow.x - 0.2, s.frontElbow.y - 0.4, 0.5, 0.35, 0, PAD, 4.4, true, G.pad + 20);
}

/**
 * The grappling hook: a wrapped grip, a chain of steel links that sags when he is not aiming and runs straight
 * along the aim when he fires, and a steel crescent hook at the end whose tip curls back toward the hand.
 */
function drawWand(c: LookCtx): void {
  const { r, s, f, a, frame } = c;
  const w = s.wand, ang = w.angle + w.spin;
  const cc = Math.cos(ang), sn = Math.sin(ang);
  // Grip: a wrapped haft with a steel pommel ring.
  r.capsule(w.x - cc * 1.6, w.y - sn * 1.6, 0.55, w.x + cc * 1.0, w.y + sn * 1.0, 0.5, 8.3, 8.3, STEEL, { group: G.hook });
  for (const k of [-0.9, 0.0]) r.stamp(w.x + cc * k, w.y + sn * k, 0.5, 0.65, ang, RED, 2.2, false, G.hook);
  r.ellipse(w.x - cc * 1.9, w.y - sn * 1.9, 0.6, 0.6, 0, 8.5, STEEL, { group: G.hook });
  // Chain: links along a sagging path, straight when firing.
  const firing = a.firing ? 1 : 0;
  const sag = (1 - firing) * (0.9 + Math.sin(frame * 0.07) * 0.1);
  const N = 6, LEN = 7.2;
  let px = w.x + cc * 1.0, py = w.y + sn * 1.0;
  const pts: Array<[number, number]> = [[px, py]];
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const th = ang + f * sag * t * t * 1.25;
    px += Math.cos(th) * (LEN / N); py += Math.sin(th) * (LEN / N);
    pts.push([px, py]);
  }
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i], [x0, y0] = pts[i - 1];
    r.capsule(x0, y0, 0.28, x, y, 0.28, 8.3, 8.3, STEEL, { group: G.hook });
    if (i % 2 === 0) r.stamp((x + x0) / 2, (y + y0) / 2, 0.5, 0.35, Math.atan2(y - y0, x - x0), STEEL, 4.4, true, G.hook);
  }
  // The hook: a thick-to-thin crescent, opening back toward the hand, with a glint on the tip.
  const [ex, ey] = pts[pts.length - 1], [bx, by] = pts[pts.length - 2];
  const dx = ex - bx, dy = ey - by, dl = Math.hypot(dx, dy) || 1;
  const ux = dx / dl, uy = dy / dl;
  const nx = f * uy, ny = -f * ux; // the side the crescent curls toward (up for a hook that points right)
  const R = 1.9;
  const cx = ex + nx * R, cy = ey + ny * R;
  let lx = ex, ly = ey;
  for (let i = 1; i <= 8; i++) {
    const th = (i / 8) * 4.1;
    const hx = cx + R * (-nx * Math.cos(th) + ux * Math.sin(th)), hy = cy + R * (-ny * Math.cos(th) + uy * Math.sin(th));
    r.capsule(lx, ly, 0.55 - (i - 1) * 0.055, hx, hy, 0.55 - i * 0.055, 8.4, 8.4, STEEL, { group: G.hook });
    lx = hx; ly = hy;
  }
  r.ellipse(ex, ey, 0.6, 0.6, 0, 8.6, STEEL, { group: G.hook });
  r.dot(lx, ly, GLINT, 1, 60);
}

export const look: FighterLook = {
  id: 'kest-rel',
  mats: matsFor({
    // Dark leathers, warm in the highs.
    coat: { keys: [0x070606, 0x120f0e, 0x201a17, 0x352c26, 0x5e4f42], gloss: 0.25, rim: 0.9, outline: 0x040303 },
    coatD: { keys: [0x050404, 0x0e0b0a, 0x191412, 0x2a221d, 0x483c32], gloss: 0.2, rim: 0.8, outline: 0x030202 },
    // The red cloth: scarf, headband, wrist wraps (the slot the near forearm's cuff stamp reads).
    mantle: { keys: [0x240606, 0x560e0e, 0x921e18, 0xc43422, 0xea6244], gloss: 0.12, rim: 0.7, outline: 0x120202 },
    leather: { keys: [0x120a05, 0x2e1c0e, 0x4e3318, 0x72492a, 0x9c6e3e], gloss: 0.3, rim: 0.6, outline: 0x080402 },
    trim: { keys: [0x1c1a1a, 0x403c3c, 0x6e6a68, 0xaaa6a0, 0xe0dcd4], gloss: 0.8, shine: 22, rim: 0.7, outline: 0x080808 },
    skin: { keys: [0x120a08, 0x2a1a16, 0x4a322a, 0x6e4e40], gloss: 0.1, rim: 0.5, outline: 0x060303 },
    boot: { keys: [0x0e0805, 0x28180e, 0x44281a, 0x60402a, 0x86603e], gloss: 0.3, shine: 12, rim: 0.6, outline: 0x060302 },
    glow: { keys: [0x6a2800, 0xff8a1a, 0xffc040, 0xfff0b0], emissive: 1, glow: 0x7a3a06, glowK: 1 },
    rune: { keys: [0x6a2800, 0xff8a1a, 0xffc040, 0xfff0b0], emissive: 1, glow: 0x7a3a06, glowK: 1 },
    flame: { keys: [0x6a1a00, 0xe05a08, 0xffb030, 0xfff2b0], emissive: 1, glow: 0x7a2a04, glowK: 1.1, translucent: 0.2 },
  }, [
    { keys: [0x240808, 0x5c1410, 0x9c2618, 0xcc4026, 0xf07a50], gloss: 0.45, shine: 14, rim: 0.8, outline: 0x120202 },
    { keys: [0x14151a, 0x3a3e48, 0x7c8494, 0xc4ccd8, 0xf6faff], gloss: 0.9, shine: 30, rim: 0.9, outline: 0x08090c },
    { keys: [0x100d0a, 0x221c14, 0x372e21, 0x4e422f, 0x6e5e44], gloss: 0.1, rim: 0.6, outline: 0x0a0806 },
  ]),
  accent: rgbOf(0xe38b6c),
  outfit: 'suit',
  headgear: 'none',
  hair: 'none',
  face: 'shadow',
  wand: 'spear',
  build: { limb: 0.95, torso: 0.95, head: 1.0 },
  mantle: false,
  pouches: true,
  extras: { back, torso, head: face, front },
  drawWand,
};

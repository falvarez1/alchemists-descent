import { EXTRA0, SLOT, matsFor, rgbOf } from '@/render/player/fighterLook';
import type { FighterLook, LookCtx } from '@/render/player/fighterLook';
import type { V } from '@/entities/playerPose';
import type { CreatureRaster } from '@/render/creatures/raster';
import type { Chain } from '@/creatures/rig/chain';

/**
 * Rusk Emberjaw, the Furnace Hound: a pit fighter rebuilt around an illegal furnace heart. A hulking brawler
 * (bulk from the build multipliers and plates, not the hitbox): scorched skin, rust-iron pauldrons and an
 * iron skull mask with a barred glowing mouth, a furnace core in the chest, a red tabard on the cloth rig,
 * knee plates and boots, and two fists wrapped in flame. Everything that burns is emissive, so it keeps its
 * light in the dark and gutters out when he falls.
 */

const IRON = EXTRA0;        // rust-iron plates
const CLOTH = EXTRA0 + 1;   // the red tabard
const EMBER = EXTRA0 + 2;   // the furnace's white-orange (emissive)
const CRUST = EXTRA0 + 3;   // cooled crust / hot cracks (half emissive)
const SOOT = EXTRA0 + 4;    // scorched, near-black iron: pauldrons, vambraces, greaves

const SKIN_B = SLOT.coat;   // the body's scorched skin
const COPPER = SLOT.trim;
const EYE = SLOT.eye;

/** Group numbers: same group melts, different groups get a seam; 33+ take rime evenly. */
const G = { pauld: 34, lame: 35, core: 36, belt: 37, mask: 38, jaw: 39, knee: 40, shin: 41, boot: 42, cuff: 43, fist: 44, pipe: 45, strap: 46, tab: 47, flame: 48 };

function band(r: CreatureRaster, a: V, b: V, t: number, w: number, across: number, mat: number, tone: number, group: number): void {
  const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
  r.stamp(x, y, w, across, Math.atan2(b.y - a.y, b.x - a.x), mat, tone, false, group);
}

/** The heat-cracked crust (half emissive); a dead body's is plain soot. */
const crust = (c: LookCtx): number => (c.dead ? SOOT : CRUST);

/** A fallen furnace goes out: every ember tone falls to dying coals, and the flames are not drawn at all. */
const T = (c: LookCtx, t: number): number => (c.dead ? Math.min(t, 0.3) : t);

/** 0..1 how hot he runs: the Kiln Heart at full, otherwise a smoulder that follows his armour. */
function heat(c: LookCtx): number {
  const v = c.ctx.fighters?.view;
  if (!v) return 0.25;
  const arm = v.armorMax > 0 ? v.armor / v.armorMax : 0;
  return Math.max(0.25 + arm * 0.2, v.ultimate.active > 0 ? 1 : 0);
}

/** A flame tongue: a bright teardrop with a hot core, leaning with the way it is blown. */
function tongue(c: LookCtx, x: number, y: number, w: number, h: number, lean: number, z: number): void {
  const { r } = c;
  r.ellipse(x + lean * h * 0.22, y - h * 0.5, w, h * 0.55, lean * 0.5, z, EMBER, { group: G.flame, noOutline: true });
  r.glowStamp(x + lean * h * 0.1, y - h * 0.3, w * 0.8, h * 0.45, lean * 0.5, EMBER, 4.0, 1.2, G.flame);
}

/** Fire wrapped round a fist: three tongues that sway on their own phases and lean from his motion, plus a rising ember. */
function fistFire(c: LookCtx, hand: V, z: number, seed: number, scale: number): void {
  if (c.dead) return;
  const { r, frame, a } = c;
  const calm = c.ctx.state.reduceFlashes === true;
  const k = (0.8 + heat(c) * 0.5) * scale;
  const wind = Math.max(-0.7, Math.min(0.7, -a._svx * 0.18));
  for (let i = 0; i < 3; i++) {
    const ph = frame * (calm ? 0.12 : 0.34) + seed * 2.1 + i * 2.3;
    const h = (1.7 + Math.sin(ph) * 0.5 + (i === 1 ? 0.8 : 0)) * k;
    tongue(c, hand.x + (i - 1) * 1.1 + c.f * 0.4, hand.y - 1.0 + Math.cos(ph * 0.7) * 0.25, 0.8 * k, h, c.f * 0.25 + wind + Math.sin(ph * 0.8) * 0.28, z);
  }
  if (!calm) {
    const t = ((frame * 0.07 + seed * 0.37) % 1);
    r.dot(hand.x + Math.sin(frame * 0.3 + seed) * 1.6, hand.y - 3.5 - t * 4.5, EMBER, 4 - t * 2.5, 60);
  }
}

/** The fist: a molten mass under a heavy iron knuckle plate, the knuckles white-hot. */
function fist(c: LookCtx, hand: V, elbow: V, z: number, far: boolean, group: number): void {
  const { r, f } = c;
  const fx = hand.x + f * 0.5, fy = hand.y + 0.5;
  r.ellipse(fx, fy, 2.55, 2.3, 0, z, c.dead ? SLOT.leather : CRUST, { group, far });
  r.glowStamp(fx + f * 0.9, fy + 0.2, 1.5, 1.5, 0, EMBER, T(c, 3.4 + heat(c) * 0.8), 1.2, group);
  // The knuckle plate: iron across the back of the fist, split into four hot-seamed knuckles.
  r.stamp(fx - f * 0.4, fy - 0.9, 1.9, 0.85, 0, IRON, 1.6, false, group);
  for (const dx of [0.6, 1.4]) r.stroke(fx + f * dx - f * 0.4, fy - 1.5, fx + f * dx - f * 0.4, fy - 0.4, EMBER, T(c, 3), true);
  void elbow;
}

/** A flat ribbon down a cloth chain, widening and fraying toward the hem. */
function ribbon(r: CreatureRaster, ch: Chain, upto: number, w0: number, w1: number, z: number, mat: number, group: number, tone = 0): void {
  const n = Math.min(upto, ch.pts.length);
  const poly: number[] = [];
  const left: number[] = [], right: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = ch.pts[i], a = ch.pts[Math.max(0, i - 1)], b = ch.pts[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = w0 + (w1 - w0) * (i / Math.max(1, n - 1));
    left.push(p.x - dy * w, p.y + dx * w);
    right.push(p.x + dy * w, p.y - dx * w);
  }
  for (let i = 0; i < left.length; i += 2) poly.push(left[i], left[i + 1]);
  for (let i = right.length - 2; i >= 0; i -= 2) poly.push(right[i], right[i + 1]);
  r.poly(poly, poly.length / 2, z, mat, 0.6, { group }, 0, 0);
  void tone;
}

/** Armour over one leg: knee plate with a rusted rim, a shin guard, a heavy boot with a hot seam. */
function legArmor(c: LookCtx, hip: V, knee: V, foot: V, z: number, far: boolean): void {
  const { r, f } = c;
  r.ellipse(knee.x + f * 0.6, knee.y, 2.1, 2.0, 0, z + 1.4, COPPER, { group: G.knee, far });
  r.ellipse(knee.x + f * 0.6, knee.y, 1.6, 1.5, 0, z + 2.0, IRON, { group: G.knee, far });
  r.dot(knee.x + f * 0.6, knee.y, EMBER, T(c, 2.5), 40);
  r.capsule(knee.x, knee.y + 0.8, 1.9, foot.x, foot.y - 0.9, 1.65, z + 0.6, z + 0.6, SOOT, { group: G.shin, far });
  band(r, knee, foot, 0.62, 0.45, 1.9, crust(c), 1.5, G.shin);
  r.ellipse(foot.x + f * 1.1, foot.y - 0.9, 3.0, 1.45, 0, z + 1.1, SLOT.boot, { group: G.boot, far });
  r.stamp(foot.x + f * 1.2, foot.y - 1.4, 1.9, 0.35, 0, EMBER, T(c, 2.4), true, G.boot);
  void hip;
}

function back(c: LookCtx): void {
  const { r, s, f, costume } = c;
  // The furnace stack: a pipe off the back rising past the head, a hot nozzle at its tip.
  const bx = s.chest.x - f * 2.8, by = s.chest.y - 1.2;
  const tx = s.head.x - f * 3.6, ty = s.head.y - 4.8;
  r.capsule(bx, by, 1.1, bx - f * 0.6, by - 3.5, 1.0, -1.5, -1.5, IRON, { group: G.pipe });
  r.capsule(bx - f * 0.6, by - 3.5, 1.0, tx, ty + 1.4, 0.95, -1.5, -1.5, IRON, { group: G.pipe });
  r.ellipse(tx, ty + 0.6, 1.5, 0.95, 0, -0.8, COPPER, { group: G.pipe + 20 });
  const calm = c.ctx.state.reduceFlashes === true;
  r.glowStamp(tx, ty + 0.3, 1.0, 0.55, 0, EMBER, T(c, 3.0 + heat(c) * 1.4 + (calm ? 0 : Math.sin(c.frame * 0.3) * 0.5)), 1.2, G.pipe + 20);
  band(r, { x: bx, y: by }, { x: tx, y: ty }, 0.45, 0.4, 1.3, COPPER, 1.2, G.pipe);
  // Rear flap of the loincloth on the first tail.
  if (costume) ribbon(r, costume.tails[0], 4, 1.1, 1.3, -2.2, CLOTH, G.tab + 20);
  // Far leg and far arm.
  legArmor(c, s.hip, s.backKnee, s.backFoot, -5.2, true);
  band(r, s.backElbow, s.backHand, 0.5, 0.9, 1.7, SOOT, 1.5, 2);
  fist(c, s.backHand, s.backElbow, -5.4, true, G.fist);
  fistFire(c, s.backHand, -4.4, 1, 0.8);
  // The far pauldron behind the torso widens the silhouette.
  r.ellipse(s.chest.x - f * 2.3, s.chest.y - 0.2, 3.7, 2.8, s.lean * 0.8, -2.0, SOOT, { group: G.pauld, far: true });
}

function torso(c: LookCtx): void {
  const { r, s, f, mid, costume } = c;
  const calm = c.ctx.state.reduceFlashes === true;
  const cx = s.chest.x - f * 0.9, cy = s.chest.y + 3.0;
  // Harness: a broad strap from the far shoulder to the belt, and a second across the chest.
  r.stroke(s.chest.x - f * 2.4, s.chest.y - 0.8, s.hip.x + f * 2.0, s.hip.y - 0.2, SLOT.leather, 1.2, false, 0.9);
  r.stroke(s.chest.x + f * 2.6, s.chest.y - 0.6, s.hip.x - f * 1.8, s.hip.y - 0.4, SLOT.leather, 1.0, false, 0.8);
  // Muscle: pecs and a ridge down the belly.
  r.shade(cx - f * 0.8, cy - 0.6, 2.0, 1.1, s.lean, 0.9, 1);
  r.stroke(mid.x + f * 0.4, mid.y - 0.2, mid.x + f * 0.3, mid.y + 1.8, SKIN_B, 0, true);
  for (const dy of [0.2, 1.3]) r.stroke(mid.x - f * 0.9, mid.y + dy, mid.x + f * 1.6, mid.y + dy + 0.05, SKIN_B, 0, true);
  // The furnace core: a rusted iron ring round a throbbing white-orange heart.
  const beat = calm ? 0 : Math.sin(c.frame * 0.12) * 0.4;
  r.ellipse(cx + f * 0.6, cy, 2.05, 2.05, 0, 3.6, IRON, { group: G.core });
  r.ellipse(cx + f * 0.6, cy, 1.55, 1.55, 0, 4.2, crust(c), { group: G.core });
  r.glowStamp(cx + f * 0.6, cy, 1.25, 1.25, 0, EMBER, T(c, 3.9 + heat(c) * 0.9 + beat), 1.4, G.core);
  // Belt: an iron slab with a square buckle.
  const bx = s.hip.x + c.ux * 0.12, by = s.hip.y + c.uy * 0.12;
  r.stamp(bx, by, 3.2, 0.9, Math.atan2(c.uy, c.ux) + Math.PI / 2, IRON, 1.0, false, 1);
  r.ellipse(bx + f * 0.6, by, 1.3, 1.1, 0, 3.8, IRON, { group: G.belt });
  r.stamp(bx + f * 0.6, by, 0.8, 0.6, 0, COPPER, 2.4, false, G.belt);
  // The tabard: a red cloth hanging from the belt on the second chain.
  if (costume) {
    ribbon(r, costume.tails[1], 4, 1.5, 1.3, 5.2, CLOTH, G.tab);
    r.shade(costume.tails[1].pts[1].x, costume.tails[1].pts[1].y, 1.0, 1.2, 0, -0.9, G.tab);
  }
}

function shoulders(c: LookCtx): void {
  const { r, s, f } = c;
  const x = s.chest.x - f * 1.4, y = s.chest.y - 0.2;
  // The big near pauldron: layered rust plates, scorched at the rim, riveted.
  r.ellipse(x, y, 3.6, 2.3, s.lean * 0.8, 7.0, COPPER, { group: G.pauld + 10 });
  r.ellipse(x, y - 0.2, 3.3, 2.0, s.lean * 0.8, 7.6, SOOT, { group: G.pauld });
  r.ellipse(x - f * 0.2, y + 1.5, 3.1, 0.95, s.lean * 0.8, 7.1, SOOT, { group: G.lame, depth: 0.6 });
  r.shade(x - f * 0.9, y + 0.9, 3.0, 0.8, s.lean, -0.9, G.pauld);
  r.stamp(x + f * 1.3, y - 0.6, 1.0, 0.5, 0.3, crust(c), 1.8, false, G.pauld);
  r.dot(x + f * 2.3, y - 0.1, EMBER, T(c, 2.4), 30);
  r.dot(x - f * 2.2, y - 0.3, COPPER, 4, 30);
}

/** The head: a thuggish iron skull mask on a bare neck: a hot eye, a barred glowing mouth, rivets. */
function head(c: LookCtx): void {
  const { r, s, H, dead } = c;
  const ht = s.headTilt;
  const calm = c.ctx.state.reduceFlashes === true;
  const hot = heat(c);
  // The dome sits proud of the head, clear of the pauldron.
  r.ellipse(...H(-0.3, 0.7), 2.7, 2.7, ht, 10.0, IRON, { group: G.mask, depth: 0.9 });
  // The face plate: a darker, jutting skull front with the eye slot and the barred mouth.
  r.ellipse(...H(1.0, -0.1), 1.9, 2.35, ht, 10.6, IRON, { group: G.jaw, depth: 0.8 });
  r.shade(...H(1.2, -0.1), 1.6, 2.1, ht, -0.9, G.jaw);
  r.stamp(...H(1.75, 0.75), 1.15, 0.55, ht, EYE, 0, true, G.jaw);
  if (!s.eyesShut && !dead) r.dot(...H(2.05, 0.75), EMBER, 4.4 + (calm ? 0 : Math.sin(c.frame * 0.2) * 0.4), 50);
  r.stamp(...H(1.25, -1.25), 1.55, 0.95, ht, EYE, 0, true, G.jaw);
  for (const dx of [0.35, 1.25, 2.15]) r.stroke(...H(dx, -1.85), ...H(dx, -0.65), EMBER, T(c, 3.4 + hot * 1.2), true);
  // A rust-orange brow plate, rivets, a hot vent wire on top.
  r.dot(...H(-0.4, 2.9), COPPER, 4, 30);
  r.dot(...H(-1.9, 0.2), COPPER, 4, 30);
  r.shade(...H(-0.5, 2.2), 2.0, 0.7, ht, 0.9, G.mask);
  r.capsule(...H(-0.9, 3.0), 0.45, ...H(-1.6, 4.4), 0.35, 12, 12, IRON, { group: G.pipe });
  r.dot(...H(-1.6, 4.5), EMBER, T(c, 4), 60);
}

function front(c: LookCtx): void {
  const { r, s } = c;
  legArmor(c, s.hip, s.frontKnee, s.frontFoot, 3.0, false);
  // The near arm: an iron forearm cuff, then the burning fist.
  r.capsule(s.frontElbow.x, s.frontElbow.y, 1.95, s.frontHand.x, s.frontHand.y, 1.7, 8.9, 8.9, SOOT, { group: G.cuff, depth: 0.9 });
  band(r, s.frontElbow, s.frontHand, 0.18, 0.5, 1.9, crust(c), 1.4, G.cuff);
  band(r, s.frontElbow, s.frontHand, 0.7, 0.5, 1.8, crust(c), 1.4, G.cuff);
  fist(c, s.frontHand, s.frontElbow, 9.4, false, G.fist);
  fistFire(c, s.frontHand, 9.9, 0, 1);
}

/** Aim shows as a lick of flame off the near fist along the line of fire. */
function drawWand(c: LookCtx): void {
  if (c.dead) return;
  const { r, s, a, frame } = c;
  const w = s.wand, ang = w.angle + w.spin, cc = Math.cos(ang), sn = Math.sin(ang);
  const calm = c.ctx.state.reduceFlashes === true;
  const flick = calm ? 0 : Math.sin(frame * 0.5) * 0.35;
  const k = a.firing ? 1.5 : 1;
  for (let i = 0; i < 3; i++) {
    const d = 1.3 + i * 1.5 * k, rad = (0.95 - i * 0.2) * (1 + flick * 0.3);
    r.ellipse(w.x + cc * d, w.y + sn * d - 0.2, rad, rad * 0.8, ang, 11.5, EMBER, { group: G.flame, noOutline: true });
    r.glowStamp(w.x + cc * d, w.y + sn * d - 0.2, rad * 0.8, rad * 0.65, ang, EMBER, 5 - i * 1.1, 1.8, G.flame);
  }
}

export const look: FighterLook = {
  id: 'rusk-emberjaw',
  mats: matsFor({
    // Scorched skin: ember-lit in the highs, a deep burnt umber in the shadows.
    coat: { keys: [0x2e1008, 0x7a3c1e, 0xbe7038, 0xee9c60, 0xffd4a0], gloss: 0.2, rim: 0.9, outline: 0x0c0403 },
    coatD: { keys: [0x240a05, 0x5c2a16, 0x9a5a30, 0xcc8850, 0xf4b880], gloss: 0.15, rim: 0.8, outline: 0x0a0403 },
    mantle: { keys: [0x120d0c, 0x2c2523, 0x4d4440, 0x78695f, 0xaa9886], gloss: 0.4, shine: 14, rim: 0.8, outline: 0x080404 },
    leather: { keys: [0x120806, 0x32170f, 0x56281a, 0x823f26, 0xb36a42], gloss: 0.2, rim: 0.6, outline: 0x070302 },
    trim: { keys: [0x2a1004, 0x6a3010, 0xb0561c, 0xe88a38, 0xffc878], gloss: 0.5, shine: 16, rim: 0.7, outline: 0x120602 },
    skin: { keys: [0x2e1008, 0x7a3c1e, 0xbe7038, 0xee9c60, 0xffd4a0], gloss: 0.2, rim: 0.7, outline: 0x0c0403 },
    boot: { keys: [0x0a0707, 0x1c1614, 0x342c28, 0x524840, 0x827466], gloss: 0.45, shine: 14, rim: 0.7, outline: 0x050303 },
    glow: { keys: [0x6a1a00, 0xe04a08, 0xff9a24, 0xffe6a0], emissive: 1, glow: 0x7a2a04, glowK: 1 },
    rune: { keys: [0x6a1a00, 0xe04a08, 0xff9a24, 0xffe6a0], emissive: 1, glow: 0x7a2a04, glowK: 1 },
    flame: { keys: [0x6a1a00, 0xe05a08, 0xffb030, 0xfff2b0], emissive: 1, glow: 0x7a2a04, glowK: 1.1, translucent: 0.2 },
  }, [
    { keys: [0x0c0a0a, 0x201b1a, 0x383231, 0x5a5250, 0x9c948e], gloss: 0.5, shine: 16, rim: 0.95, outline: 0x060303 },
    { keys: [0x1a0406, 0x4a0c10, 0x82161a, 0xb42a24, 0xe05a3c], gloss: 0.1, rim: 0.6, outline: 0x0a0102 },
    { keys: [0x7a1800, 0xd83c08, 0xff7a1c, 0xffb43c, 0xffe9a8], emissive: 1, glow: 0x8a3008, glowK: 1.2 },
    { keys: [0x2a0804, 0x6a1a08, 0xb8400e, 0xff7a1c], emissive: 0.45, glow: 0x3a1204, glowK: 0.7, gloss: 0.2 },
    { keys: [0x050404, 0x0d0b0a, 0x181412, 0x2a2420, 0x52463e], gloss: 0.45, shine: 14, rim: 1.0, outline: 0x040202 },
  ]),
  accent: rgbOf(0xf09961),
  outfit: 'suit',
  headgear: 'none',
  hair: 'none',
  face: 'shadow',
  wand: 'fist',
  build: { limb: 1.55, torso: 1.45, head: 0.95 },
  mantle: false,
  pouches: false,
  extras: { back, torso, shoulders, head, front },
  drawWand,
};

import { EXTRA0, SLOT, matsFor, rgbOf } from '@/render/player/fighterLook';
import type { FighterLook, LookCtx } from '@/render/player/fighterLook';
import type { V } from '@/entities/playerPose';
import type { CreatureRaster } from '@/render/creatures/raster';

/**
 * Brann Rook, the Iron Pilgrim: a foundry survivor sealed in a pressure-assisted mining harness. Black iron and
 * brass, a round helm with an amber barred visor, a shoulder lantern, a tower shield. He is bulky by build
 * multipliers and plates (never a bigger hitbox): the shared skeleton is wrapped in armour pieces drawn over
 * it, and the shield and the lantern ride the body frame (held in front standing, slung on the back when
 * crawling or climbing, left beside him when he falls).
 */

// The look's own materials (ids EXTRA0 and up).
const PLATE = EXTRA0;      // the harness plates: lighter, bluer iron than the body under them
const SHIELD = EXTRA0 + 1; // the tower shield's face: weathered iron
const LAMP = EXTRA0 + 2;   // the lantern's amber glass and the visor's slits (emissive)

const BRASS = SLOT.trim;
const IRON = SLOT.coat;
const IRON_D = SLOT.coatD;
const GLOW = SLOT.glow;

/** Group numbers: parts in the same group melt together, different groups get a contact seam; 33+ take rime evenly. */
const G = { breast: 34, belly: 35, gorget: 36, spaulder: 37, helm: 16, visor: 17, shield: 40, lamp: 41, greave: 42, cuisse: 43, knee: 44, fist: 45, sabaton: 46, boss: 47 };

/** The body frame: `up` along the spine (hip to chest), `fwd` the way he faces, both unit. */
function frame(c: LookCtx): { ux: number; uy: number; px: number; py: number } {
  const len = Math.hypot(c.ux, c.uy) || 1;
  const ux = c.ux / len, uy = c.uy / len;
  return { ux, uy, px: -uy * c.f, py: ux * c.f };
}

/** A band of paint across a limb: `t` along a to b, `w` cells long, spanning the limb's width. */
function band(r: CreatureRaster, a: V, b: V, t: number, w: number, across: number, mat: number, tone: number, group: number): void {
  const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
  r.stamp(x, y, w, across, Math.atan2(b.y - a.y, b.x - a.x), mat, tone, false, group);
}

/** Armour over one leg: cuisse, knee cop with a brass rim, greave and a heavy sabaton. */
function legArmor(c: LookCtx, hip: V, knee: V, foot: V, z: number, far: boolean, groupBias: number): void {
  const { r, f } = c;
  const g = (n: number): number => n + groupBias;
  r.capsule(hip.x, hip.y + 0.3, 1.85, knee.x, knee.y, 1.65, z + 0.5, z + 0.5, PLATE, { group: g(G.cuisse), far });
  r.capsule(knee.x, knee.y, 1.6, foot.x, foot.y - 0.5, 1.45, z + 0.5, z + 0.5, PLATE, { group: g(G.greave), far });
  r.ellipse(knee.x + f * 0.5, knee.y, 1.85, 1.75, 0, z + 1.2, BRASS, { group: g(G.knee), far });
  r.ellipse(knee.x + f * 0.5, knee.y, 1.45, 1.4, 0, z + 1.9, PLATE, { group: g(G.knee), far });
  band(r, knee, foot, 0.8, 0.35, 1.9, BRASS, 1.2, g(G.greave));
  r.ellipse(foot.x + f * 1.1, foot.y - 0.8, 3.0, 1.35, 0, z + 1.2, PLATE, { group: g(G.sabaton), far });
  r.stamp(foot.x + f * 2.7, foot.y - 0.7, 0.35, 0.9, 0, BRASS, 1.5, false, g(G.sabaton));
}

/** The lantern on the shoulder: a brass-capped amber glass on a bracket that sways with the cloth rig. */
function lantern(c: LookCtx): void {
  const { r, s, f, costume } = c;
  const fr = frame(c);
  // Hung off the back of the shoulder; the mantle chain's links give it its sway.
  let lx = s.chest.x - f * 4.3 - fr.ux * 0.2, ly = s.chest.y - 1.6;
  if (costume) {
    const p = costume.mantle.pts[2], root = costume.mantle.pts[0];
    lx += (p.x - root.x - (-f * 0.6)) * 0.55; ly += (p.y - root.y - 1.4) * 0.3;
  }
  const z = -1.2;
  // Bracket back to the shoulder and the carry ring above.
  r.capsule(s.chest.x - f * 2.2, s.chest.y - 1.2, 0.5, lx, ly - 1.7, 0.45, -0.6, -0.8, BRASS, { group: G.lamp });
  r.capsule(lx - 0.7, ly - 2.0, 0.25, lx, ly - 2.9, 0.25, z + 1, z + 1, BRASS, { group: G.lamp });
  r.capsule(lx, ly - 2.9, 0.25, lx + 0.7, ly - 2.0, 0.25, z + 1, z + 1, BRASS, { group: G.lamp });
  // Cap, glass, base.
  r.ellipse(lx, ly - 1.45, 1.55, 0.7, 0, z + 1.4, BRASS, { group: G.lamp });
  r.ellipse(lx, ly, 1.2, 1.45, 0, z + 1.0, LAMP, { group: G.lamp, noOutline: false });
  r.glowStamp(lx, ly + 0.1, 0.8, 1.0, 0, LAMP, 3.0 + heat(c) * 1.8, 1.6, G.lamp);
  r.ellipse(lx, ly + 1.55, 1.5, 0.6, 0, z + 1.4, BRASS, { group: G.lamp });
  // Brass ribs over the glass.
  r.stroke(lx - 0.75, ly - 1.0, lx - 0.75, ly + 1.0, BRASS, 1, true);
  r.stroke(lx + 0.75, ly - 1.0, lx + 0.75, ly + 1.0, BRASS, 1, true);
}

/** Far arm and leg armour, the lantern. */
function back(c: LookCtx): void {
  const { r, s, f } = c;
  lantern(c);
  // Far leg.
  legArmor(c, s.hip, s.backKnee, s.backFoot, -5.5, true, 0);
  // Far arm: vambrace bands and an iron mitt.
  band(r, s.backElbow, s.backHand, 0.55, 0.7, 1.7, BRASS, 1.3, 2);
  band(r, s.chest, s.backElbow, 0.55, 0.6, 1.6, BRASS, 1.0, 2);
  r.ellipse(s.backHand.x + f * 0.2, s.backHand.y + 0.3, 1.6, 1.5, 0, -5.2, IRON_D, { group: G.fist, far: true });
  // A pauldron behind the torso, so the far shoulder widens the silhouette too.
  r.ellipse(s.chest.x - f * 1.0, s.chest.y - 0.4, 3.3, 2.5, c.s.lean * 0.8, -2.2, PLATE, { group: G.spaulder, far: true });
}

/** The harness over the torso: breastplate, a gauge, belly lames, a buckle and tassets. */
function torso(c: LookCtx): void {
  const { r, s, f, mid } = c;
  const fr = frame(c);
  const cx = s.chest.x + f * 0.5, cy = s.chest.y + 1.0;
  // Breastplate: a broad dome with a brass gorget ring above it.
  r.ellipse(cx, cy, 3.8, 3.4, s.lean * 0.6, 2.2, PLATE, { group: G.breast, depth: 0.6 });
  r.ellipse(s.chest.x + f * 0.4, s.chest.y - 1.6, 2.9, 0.9, s.lean * 0.8, 3.0, BRASS, { group: G.gorget, depth: 0.7 });
  r.shade(cx - f * 0.6, cy + 1.6, 3.2, 0.9, s.lean, -0.8, G.breast);
  // The pressure gauge in the plate: a brass rim, a dark face, one amber dot that is the vessel's heat.
  r.ellipse(cx + f * 0.8, cy + 0.2, 1.35, 1.35, 0, 4.0, BRASS, { group: G.breast });
  r.stamp(cx + f * 0.8, cy + 0.2, 0.9, 0.9, 0, SLOT.eye, 0, true, G.breast);
  r.dot(cx + f * 0.8, cy + 0.2, GLOW, 2.4 + heat(c) * 2.6, 40);
  // Belly lames.
  const b0 = { x: mid.x + f * 0.3, y: mid.y + 1.4 };
  r.ellipse(b0.x, b0.y, 3.1, 1.4, s.lean * 0.6, 1.6, PLATE, { group: G.belly, depth: 0.6 });
  r.ellipse(b0.x + fr.ux * -1.0, b0.y + 1.7, 3.0, 1.1, s.lean * 0.6, 1.4, IRON, { group: G.belly + 20, depth: 0.6 });
  // Buckle and tassets.
  const bx = s.hip.x + c.ux * 0.12 + f * 0.5, by = s.hip.y + c.uy * 0.12;
  r.ellipse(bx, by, 1.3, 1.0, 0, 3.8, BRASS, { group: G.belly + 1 });
  r.ellipse(s.hip.x + f * 2.6, s.hip.y + 1.3, 1.5, 2.0, 0.2 * f, 2.9, PLATE, { group: G.belly + 2, depth: 0.6 });
  // Rivets along the breastplate's lower edge.
  for (const dx of [-2.6, 2.7]) r.dot(cx + dx * f, cy + 1.5, BRASS, 4, 20);
}

const SWING = new WeakMap<object, { t: number; frame: number }>();

/** The ability view's reading of Boiler Guard, eased so the shield swings away to the back as the kit's plate goes up. */
function guardBlend(c: LookCtx): number {
  const target = (c.ctx.fighters?.view.tactical.active ?? 0) > 0 ? 1 : 0;
  let st = SWING.get(c.a);
  if (!st) { st = { t: target, frame: c.frame }; SWING.set(c.a, st); }
  if (st.frame !== c.frame) {
    const n = Math.min(8, Math.abs(c.frame - st.frame));
    st.t = Math.max(0, Math.min(1, st.t + Math.max(-0.14 * n, Math.min(0.14 * n, target - st.t))));
    st.frame = c.frame;
  }
  return st.t;
}

/** 0..1 how hot the vessel runs: the Pressure meter, and a Redline at full. */
function heat(c: LookCtx): number {
  if (c.dead) return -1;
  const v = c.ctx.fighters?.view;
  if (!v) return 0;
  const m = v.meter ? v.meter.value / Math.max(1, v.meter.max) : 0;
  return Math.max(m * 0.8, v.ultimate.active > 0 ? 1 : 0);
}

/** The shield rides the body frame: held in front on his feet, slung on the back otherwise, laid by the body when dead. */
function shield(c: LookCtx): void {
  const { r, s, f } = c;
  const fr = frame(c);
  const dead = s.kind === 'dead';
  // 0 held in front .. 1 slung on the back (crawling, climbing, and while Boiler Guard's own plate is up).
  // A body that is not upright (a dive, a swim) carries it on the back too.
  const tilt = Math.max(0, Math.min(1, (Math.abs(fr.ux) - 0.4) / 0.3));
  const sling = s.kind === 'stand' ? Math.max(guardBlend(c), tilt) : dead ? 0 : 1;
  const mix = (a: number, b: number): number => a + (b - a) * sling;
  const a0 = dead ? -4.5 : mix(-6.6, -3.0), a1 = dead ? 8.6 : mix(9.4, 8.5);
  const bC = dead ? 0 : mix(4.7, -3.7);
  const w = mix(1.85, 1.8);
  const z = dead ? -3.0 : sling < 0.5 ? 7.0 : -2.6;
  const lean = dead ? 0 : mix(0.06, 0);
  // Fallen, it is still in the near hand: it lies along the forearm, where the arm dropped it, under the body.
  let ox = s.hip.x, oy = s.hip.y, ux = fr.ux, uy = fr.uy, px = fr.px, py = fr.py;
  if (!dead && c.ctx.arena?.stockAttack(c.ctx.arena.bound)?.busy) {
    // The attacking shield follows the authored off-hand, including the upward launcher.
    ox = s.backHand.x - px * bC - ux * 2; oy = s.backHand.y - py * bC - uy * 2;
  }
  if (dead) {
    const dx = s.frontHand.x - s.frontElbow.x, dy = s.frontHand.y - s.frontElbow.y, dl = Math.hypot(dx, dy) || 1;
    ux = dx / dl; uy = dy / dl; px = -uy; py = ux; ox = s.frontHand.x; oy = s.frontHand.y;
  }
  // A fallen shield never sinks into the floor: the lowest of the body's points is the ground, and it stands on it.
  let lift = 0;
  if (dead) {
    const ground = Math.max(s.hip.y, s.chest.y, s.head.y, s.backFoot.y, s.frontFoot.y, s.backHand.y, s.frontHand.y, s.backKnee.y, s.frontKnee.y) + 0.6;
    const low = Math.max(oy + uy * a0 + Math.abs(px) * w, oy + uy * a1 + Math.abs(px) * w) + 0.6;
    lift = Math.min(0, ground - low);
  }
  const P = (a: number, b: number): [number, number] => {
    const bb = bC + b + (a - a0) * lean;
    return [ox + ux * a + px * bb, oy + uy * a + py * bb + lift];
  };
  const pts = (grow: number, notch: number): number[] => {
    const q: number[] = [];
    const A0 = a0 - grow, A1 = a1 + grow, W = w + grow;
    for (const [a, b] of [[A0, -W], [A0, W], [A1 - 1.6 - notch, W], [A1 - 0.5 - notch, W * 0.6], [A1 - 0.5 - notch, -W * 0.6], [A1 - 1.6 - notch, -W]] as const) q.push(...P(a, b));
    return q;
  };
  // Brass rim first (slightly larger, a touch lower), then the face; the rim shows around the face as the edging.
  r.poly(pts(0.55, 0), 6, z - 0.4, BRASS, 0.7, { group: G.shield + 1 });
  r.poly(pts(-0.1, 0.1), 6, z, SHIELD, 1.1, { group: G.shield });
  // Hammered grain: a few darker plates and a bright edge on the lit side.
  r.shade(...P(2.0, -0.6), 1.2, 4.2, 0, -0.9, G.shield);
  r.shade(...P(-3.0, 0.7), 1.0, 3.0, 0, 0.8, G.shield);
  // The boss and its rivets.
  r.ellipse(...P(3.6, 0), 1.25, 1.25, 0, z + 1.0, BRASS, { group: G.boss });
  r.stamp(...P(3.6, 0), 0.6, 0.6, 0, SLOT.eye, 0, true, G.boss);
  r.dot(...P(3.6, 0), BRASS, 4, 30);
  for (const [a, b] of [[8.0, -1.0], [8.0, 1.0], [-5.4, -1.0], [-5.4, 1.0], [0.5, 1.4]] as const) r.dot(...P(a, b), BRASS, 4, 30);
  void f;
}

/** Shoulders: a heavy layered spaulder with a brass lip. */
function shoulders(c: LookCtx): void {
  const { r, s, f } = c;
  const x = s.chest.x - f * 0.7, y = s.chest.y + 0.6;
  r.ellipse(x, y, 4.3, 2.5, s.lean * 0.8, 9.0, BRASS, { group: G.spaulder + 10 });
  r.ellipse(x, y - 0.2, 4.0, 2.15, s.lean * 0.8, 9.6, PLATE, { group: G.spaulder });
  r.ellipse(x - f * 0.2, y + 1.6, 3.8, 1.0, s.lean * 0.8, 9.1, IRON, { group: G.spaulder + 11, depth: 0.6 });
  r.shade(x - f * 0.8, y + 0.7, 2.8, 0.7, s.lean, -0.9, G.spaulder);
  r.dot(x + f * 1.9, y - 0.2, BRASS, 4, 30);
  r.dot(x - f * 1.5, y - 0.4, BRASS, 4, 30);
}

/** The helm: a round iron dome, a brass-ringed visor with three amber slits, a neck ring. */
function helm(c: LookCtx): void {
  const { r, s, H, dead } = c;
  const ht = s.headTilt;
  void dead;
  // The dome sits a little proud of the head so the pauldron never swallows the visor.
  r.ellipse(...H(-0.1, 1.2), 2.95, 2.95, ht, 6.2, PLATE, { group: G.helm, depth: 0.9 });
  // The bevor: a chin plate closing the dome over the jaw, and the brass neck ring under it.
  r.ellipse(...H(0.5, -0.9), 2.5, 1.5, ht, 6.3, PLATE, { group: G.helm + 30, depth: 0.7 });
  r.ellipse(...H(0.2, -2.0), 2.6, 0.75, ht, 6.4, BRASS, { group: G.visor + 20 });
  // Brass crown cap.
  r.ellipse(...H(-0.3, 4.0), 1.1, 0.5, ht, 6.8, BRASS, { group: G.visor + 21 });
  // Visor: a thin brass frame, a black window, three amber slits (one fine pixel wide, a cell apart).
  const vx = 1.9, vy = 1.0;
  r.stamp(...H(vx, vy), 1.55, 1.7, ht, BRASS, 1.6, false, G.helm);
  r.stamp(...H(vx + 0.05, vy), 1.2, 1.35, ht, SLOT.eye, 0, true, G.helm);
  for (const dx of [-0.45, 0.55]) r.stroke(...H(vx + dx, vy - 0.9), ...H(vx + dx, vy + 0.9), LAMP, 2.6 + heat(c) * 2.4, true);
  // Ear boss and a shine along the dome.
  r.ellipse(...H(-1.0, 1.0), 0.8, 0.8, ht, 7.2, BRASS, { group: G.visor + 22 });
  r.shade(...H(-0.8, 3.0), 2.0, 0.7, ht, 0.9, G.helm);
  r.shade(...H(0.4, -0.3), 2.4, 0.9, ht, -0.8, G.helm);
}

/** The near fist and forearm armour, and the near leg's plates (the shared near arm and leg cannot be replaced). */
function front(c: LookCtx): void {
  const { r, s, f } = c;
  legArmor(c, s.hip, s.frontKnee, s.frontFoot, 3.0, false, 0);
  // Vambrace: brass cuffs on the forearm, a broad iron gauntlet over the hand.
  r.capsule(s.frontElbow.x, s.frontElbow.y, 1.75, s.frontHand.x, s.frontHand.y, 1.55, 8.9, 8.9, PLATE, { group: G.fist + 20 });
  band(r, s.frontElbow, s.frontHand, 0.2, 0.6, 1.8, BRASS, 1.2, G.fist + 20);
  band(r, s.frontElbow, s.frontHand, 0.72, 0.5, 1.7, BRASS, 1.2, G.fist + 20);
  r.ellipse(s.frontHand.x + f * 0.3, s.frontHand.y + 0.4, 1.85, 1.65, 0, 9.8, PLATE, { group: G.fist });
  r.stroke(s.frontHand.x + f * 0.5, s.frontHand.y - 0.7, s.frontHand.x + f * 1.4, s.frontHand.y + 0.4, IRON_D, 0, true);
}

/** A heavy pressure rod: iron barrel, brass collars, a vented muzzle with an amber light. */
function drawWand(c: LookCtx): void {
  const { r, s, a, frame: t } = c;
  const w = s.wand, ang = w.angle + w.spin, cc = Math.cos(ang), sn = Math.sin(ang);
  const glow = w.glow * (0.9 + Math.sin(t * 0.3) * 0.1);
  // A brass barrel (bright against the dark iron it is drawn over), iron collars, a flared muzzle.
  r.capsule(w.x - cc * 1.8, w.y - sn * 1.8, 0.82, w.x + cc * 6.4, w.y + sn * 6.4, 0.66, 8.3, 8.3, BRASS, { group: 14, tone: 1.3 });
  for (const k of [0.3, 2.8, 4.9]) r.stamp(w.x + cc * k, w.y + sn * k, 0.38, 1.1, ang, PLATE, 1.4, false, 14);
  r.capsule(w.x + cc * 6.3, w.y + sn * 6.3, 0.62, w.x + cc * 7.0, w.y + sn * 7.0, 0.85, 8.5, 8.5, PLATE, { group: 14 });
  const mx = w.x + cc * 7.4, my = w.y + sn * 7.4;
  const k = a.firing ? 1.4 : 1;
  r.ellipse(mx, my, 0.55 + glow * 0.3 * k, 0.55 + glow * 0.3 * k, 0, 9, GLOW, { group: 14, noOutline: true });
  r.glowStamp(mx, my, 0.6 + glow * 0.4 * k, 0.6 + glow * 0.4 * k, 0, GLOW, 1.5 + glow * 1.5 * k, 0.8, 14);
}

export const look: FighterLook = {
  id: 'brann-rook',
  mats: matsFor({
    // Black iron: cold blue-grey highs, near-black lows.
    coat: { keys: [0x040405, 0x0b0c0e, 0x17181b, 0x2b2e33, 0x6a7078], gloss: 0.6, shine: 22, rim: 1.0, outline: 0x020203 },
    coatD: { keys: [0x030304, 0x090a0b, 0x141517, 0x232528, 0x41454b], gloss: 0.3, shine: 14, rim: 0.8, outline: 0x010102 },
    mantle: { keys: [0x241504, 0x5a3a0c, 0xa57420, 0xd9a03a, 0xf2cf78], gloss: 0.6, shine: 18, rim: 0.7, outline: 0x120a02 },
    leather: { keys: [0x0e0905, 0x241810, 0x3e2a18, 0x5b3f26, 0x80583a], gloss: 0.25, rim: 0.6, outline: 0x060403 },
    trim: { keys: [0x241504, 0x5a3a0c, 0xa57420, 0xd9a03a, 0xf2cf78], gloss: 0.6, shine: 18, rim: 0.7, outline: 0x120a02 },
    skin: { keys: [0x120c0a, 0x2a1c16, 0x4a342a, 0x6a4c3c], gloss: 0.1, rim: 0.5, outline: 0x060403 },
    boot: { keys: [0x040405, 0x0b0c0d, 0x17191b, 0x282b2f, 0x494d54], gloss: 0.5, shine: 16, rim: 0.8, outline: 0x010102 },
    // The glow slot is the amber of the vessel's heat: gauge, visor slits, the rod's muzzle.
    glow: { keys: [0x5a2200, 0xe0780a, 0xffbe3a, 0xfff1b0], emissive: 1, glow: 0x6a3004, glowK: 1 },
    rune: { keys: [0x5a2a00, 0xf09a1c, 0xffd060, 0xfff6c8], emissive: 1, glow: 0x6a3a04, glowK: 1 },
    flame: { keys: [0x6a1a00, 0xe05a08, 0xffb030, 0xfff2b0], emissive: 1, glow: 0x7a2a04, glowK: 1.1, translucent: 0.2 },
  }, [
    { keys: [0x050507, 0x0e0f11, 0x1b1d20, 0x32353a, 0x7c838c], gloss: 0.7, shine: 24, rim: 1.1, outline: 0x020203 },
    { keys: [0x040406, 0x0b0c0e, 0x16181a, 0x272a2e, 0x585d64], gloss: 0.5, shine: 18, rim: 0.95, outline: 0x020203 },
    { keys: [0x5a2200, 0xe0780a, 0xffbe3a, 0xfff1b0], emissive: 1, glow: 0x6a3004, glowK: 1 },
  ]),
  accent: rgbOf(0xc5b493),
  outfit: 'suit',
  headgear: 'helm',
  hair: 'none',
  face: 'shadow',
  wand: 'staff',
  build: { limb: 1.22, torso: 1.3, head: 1.0 },
  mantle: false,
  pouches: false,
  replace: ['headgear'],
  extras: { back, torso, shoulders, headgear: helm, held: shield, front },
  drawWand,
};

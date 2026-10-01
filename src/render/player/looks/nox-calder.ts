import { chainTube } from '@/render/creatures/anatomy';
import { limb } from '@/render/player/AlchemistArt';
import { EXTRA0, SLOT, matsFor, rgbOf } from '@/render/player/fighterLook';
import type { FighterLook, LookCtx } from '@/render/player/fighterLook';
import { bands, cuff, fract, rail, sheet, tailDir, tornHem, wisp } from '@/render/player/looks/cloakKit';
import type { P } from '@/render/player/looks/cloakKit';

/**
 * Nox Calder, the Lampblack: a charcoal-grey hooded long coat, a heavy scarf, brass fittings and a black iron
 * lantern whose amber glow is the one warm thing on him. Smoke clings to him: wisps ride the coat's cloth
 * chains, so they stream when he runs. Silhouette: a broad rounded hood and shoulders (cowl + scarf), a coat
 * that dissolves into smoke at the hem, and the lantern hung low at his side.
 */
const COAT_L = EXTRA0, COAT_DK = EXTRA0 + 1, VOID = EXTRA0 + 2, SCARF = EXTRA0 + 3, IRON = EXTRA0 + 4, SMOKE = EXTRA0 + 5, HALO = EXTRA0 + 6;
const GLOW = SLOT.glow, BRASS = SLOT.trim, LEATHER = SLOT.leather;

const HEM = [1.3, 0.4, 2.0, 0.7, 1.6, 0.5] as const;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The rear of the coat: a cape off the shoulders and rear skirt, ragged at the hem, with smoke wisps coming off it. */
function back(c: LookCtx): void {
  const { r, s, f, costume, frame } = c;
  // Far boot: tall, strapped.
  cuff(r, s.backKnee, s.backFoot, 0.3, 0.95, 1.05, 0.95, -5, SLOT.boot, 3);
  bands(r, s.backKnee, s.backFoot, 0.4, 0.8, 2, 1.1, 0.26, LEATHER, 1, 3);
  if (!costume) return;
  const t0 = costume.tails[0], t1 = costume.tails[1];
  const top: P = { x: s.chest.x - f * 1.4, y: s.chest.y - 1.5 };
  const M = rail(costume.mantle, 1.2 * f), R = rail(t0, 1.8 * f), Q = rail(t1, 0.1 * f);
  const hem = tornHem(R[R.length - 1], Q[Q.length - 1], tailDir(t0), HEM, 0.2, frame, 0.3);
  sheet(r, [top, ...M, ...R, ...hem, ...Q.reverse()], -8, COAT_DK, 4, 1.3);
  // Smoke sheds off the hem and the cape's tail and streams with the cloth.
  const e0 = t0.pts[t0.pts.length - 1], e1 = t1.pts[t1.pts.length - 1];
  const d = tailDir(t0);
  wisp(r, e0.x, e0.y, frame, SMOKE, 40, -9, -f * 5 + d.x * 3, 7, 0.0, 5, 1.2);
  wisp(r, e1.x, e1.y, frame, SMOKE, 44, -9, -f * 4, 6, 0.33, 4, 1.0);
}

/** The long coat's front: a split skirt to the shins, a brass-buttoned edge, the belt's brass buckle. */
function torso(c: LookCtx): void {
  const { r, s, f, costume, frame } = c;
  const bx = s.hip.x + c.ux * 0.12, by = s.hip.y + c.uy * 0.12;
  r.stamp(bx + f * 0.45, by, 0.95, 0.75, 0, BRASS, 2, false, 1);
  r.stamp(bx + f * 0.45, by, 0.4, 0.3, 0, SLOT.leather, 1, true, 1);
  // The coat's front edge: buttons running down the placket.
  for (let k = 0; k < 4; k++) {
    const t = k / 3;
    r.dot(s.chest.x + f * 1.3 + (s.hip.x - s.chest.x) * t * 0.7, s.chest.y - 0.2 + (s.hip.y - s.chest.y) * t, BRASS, 2, 6);
  }
  if (!costume) return;
  // The skirt: two wide flaps that open on the leg (the coat is split), torn at the hem.
  const A = rail(costume.tails[1], 1.0 * f, 0, 3), B = rail(costume.tails[1], -1.5 * f, 0, 3);
  const hem = tornHem(A[A.length - 1], B[B.length - 1], tailDir(costume.tails[1]), [0.9, 0.2, 1.4, 0.4], 0.1, frame + 31, 0.3);
  sheet(r, [...A, ...hem, ...B.reverse()], 3.6, COAT_L, 9, 1.2);
}

/** Near boot and knee: a tall strapped boot; the heavy cowl and scarf over the shoulders. */
function shoulders(c: LookCtx): void {
  const { r, s, f, costume } = c;
  cuff(r, s.frontKnee, s.frontFoot, 0.34, 0.95, 1.25, 1.07, 3, SLOT.boot, 8);
  bands(r, s.frontKnee, s.frontFoot, 0.42, 0.82, 2, 1.3, 0.26, LEATHER, 1, 8);
  r.dot(s.frontKnee.x + f * 0.7, s.frontKnee.y + 0.3, BRASS, 2, 6);
  // The cowl: a heavy grey mass round the neck and over the shoulders.
  r.ellipse(s.chest.x - f * 0.3, s.chest.y - 0.2, 3.5, 2.0, s.lean * 0.8 + f * 0.1, 2.5, SCARF, { group: 10 });
  r.shade(s.chest.x - f * 0.2, s.chest.y + 0.9, 3.2, 0.7, s.lean, -0.9, 10);
  // The scarf's long tail streams off the shoulder on the cloth chain.
  if (costume) chainTube(r, costume.mantle, 2.8, SCARF, { group: 10 }, 1.1, 0.7);
  // The pauldron stud.
  r.dot(s.chest.x + f * 1.4, s.chest.y - 1.0, BRASS, 3, 6);
}

function head(c: LookCtx): void {
  const { r, s } = c;
  limb(r, s.neck, s.head, 0.85, 0.9, 3, VOID, 11);
  r.ellipse(s.head.x, s.head.y, 2.3, 2.45, s.headTilt, 4, VOID, { group: 11 });
}

/** A broad, rounded hood with a short slumped peak, two amber points of light, a scarf over the jaw. */
function hood(c: LookCtx): void {
  const { r, s, costume, H } = c;
  const ht = s.headTilt;
  r.ellipse(...H(-0.6, 0.55), 3.3, 3.45, ht, 5.0, COAT_L, { group: 18 });
  r.ellipse(...H(-1.8, -1.0), 2.5, 2.8, ht, 4.4, COAT_DK, { group: 18 });
  if (costume) {
    const ch = costume.crown, root = ch.pts[0];
    r.capsule(...H(-0.4, 2.1), 2.0, root.x, root.y, 1.7, 5.2, 5.4, COAT_L, { group: 18 });
    chainTube(r, ch, 5.4, COAT_L, { group: 18 }, 1.6, 0.9);
  }
  r.stamp(...H(1.5, 0.15), 1.55, 2.05, ht, VOID, 0, true, 18);
  r.stroke(...H(0.2, 2.5), ...H(1.7, 2.1), COAT_L, 4, true);
  r.stroke(...H(1.7, 2.1), ...H(2.45, 1.0), COAT_L, 3, true);
  if (!s.eyesShut && !c.dead) {
    r.dot(...H(1.2, 0.8), GLOW, 2, 40);
    r.dot(...H(2.0, 0.75), GLOW, 3, 40);
  }
  // The scarf: wound over the jaw and mouth.
  r.ellipse(...H(1.1, -1.55), 2.5, 1.35, ht, 6.4, SCARF, { group: 19 });
  r.shade(...H(0.8, -2.2), 2.2, 0.5, ht, -0.8, 19);
}

/** Near arm: a grey bracer on the forearm. */
function front(c: LookCtx): void {
  const { r, s } = c;
  cuff(r, s.frontElbow, s.frontHand, 0.38, 0.8, 1.05, 0.95, 8.7, SCARF, 13);
  bands(r, s.frontElbow, s.frontHand, 0.45, 0.75, 2, 1.0, 0.22, IRON, 1, 13);
}

/** The black lantern: iron cage, amber glass, a flame that flickers; it hangs from his hand and swings out as he casts. */
function lantern(c: LookCtx): void {
  const { r, s, a, f, frame, ctx } = c;
  const w = s.wand, ang = w.angle + w.spin, cc = Math.cos(ang), sn = Math.sin(ang);
  const hooded = ctx.state.lanternHooded === true && !a.firing;
  const swing = a.firing ? 1 : clamp(a.recoilT / 6, 0, 1);
  const reach = 1.8 + 3.2 * swing;
  const px = w.x + cc * reach, py = w.y + sn * reach;
  const sway = clamp(-(a._svx || 0) * f * 0.6, -1.4, 1.4) * f + Math.sin(frame * 0.09) * 0.3 * (1 - swing);
  const cx = px + sway, cy = py + 4.0 * (1 - 0.55 * swing);
  // The glow the lantern throws, behind everything else (it only shows where nothing is drawn).
  if (!hooded && a.staggerT <= 7) {
    r.ellipse(cx, cy, 6.0, 6.0, 0, -12, HALO, { group: 58, noOutline: true });
    r.glowStamp(cx, cy, 6.0, 6.0, 0, HALO, 3.0 + Math.sin(frame * 0.37) * 0.25, 0, 58);
  }
  // Handle and chain.
  r.capsule(w.x + cc * 0.6, w.y + sn * 0.6, 0.38, px, py, 0.34, 8.3, 8.3, IRON, { group: 14 });
  r.capsule(px, py, 0.26, cx, cy - 2.6, 0.26, 8.3, 8.3, IRON, { group: 14 });
  // The cage: an iron cap and base around a tall pane of amber, posts at its corners.
  r.ellipse(cx, cy - 2.4, 1.6, 0.85, 0, 9.0, IRON, { group: 14 });
  r.ellipse(cx, cy - 3.1, 0.55, 0.55, 0, 9.0, IRON, { group: 14 });
  r.ellipse(cx, cy, 1.6, 2.0, 0, 8.8, IRON, { group: 14 });
  r.ellipse(cx, cy, 1.2, 1.65, 0, 9.4, GLOW, { group: 14, noOutline: true });
  const flick = 2.3 + Math.sin(frame * 0.37) * 0.35 + Math.sin(frame * 0.91) * 0.2;
  r.glowStamp(cx, cy + 0.1, 1.1, 1.5, 0, GLOW, hooded ? 0.9 : flick, hooded ? 0.2 : 0.9, 14);
  r.ellipse(cx, cy + 2.0, 1.65, 0.75, 0, 9.6, IRON, { group: 14 });
  r.stroke(cx, cy - 1.5, cx, cy + 1.6, IRON, 1, true);
  if (hooded) r.ellipse(cx, cy - 0.2, 1.5, 1.2, 0, 9.6, IRON, { group: 14 });
  else {
    // Embers lift off the flame, and a thread of smoke.
    for (let k = 0; k < 3; k++) {
      const p = fract(frame / 38 + k / 3);
      if (p > 0.85) continue;
      r.dot(cx + Math.sin(k * 2.7 + frame * 0.05) * 1.5, cy - 2.4 - p * 4.5, GLOW, p < 0.5 ? 3 : 2, 50);
    }
    wisp(r, cx, cy - 2.8, frame, SMOKE, 56, 9.5, 1.2, 5, 0.5, 3, 0.9, 80);
  }
}

export const look: FighterLook = {
  id: 'nox-calder',
  mats: matsFor({
    coat: { keys: [0x07080b, 0x101217, 0x1b1e25, 0x2a2e37, 0x464c59], gloss: 0.1, rim: 0.85, outline: 0x040405 },
    coatD: { keys: [0x050608, 0x0b0d10, 0x13161b, 0x1f232a, 0x32373f], gloss: 0.08, rim: 0.7, outline: 0x030304 },
    // The bracer on the forearm (the alchemist's mantle slot): cool steel-grey.
    mantle: { keys: [0x101115, 0x23252b, 0x3c3f49, 0x5a5e6b, 0x80848f], gloss: 0.2, rim: 0.8, outline: 0x08090b },
    leather: { keys: [0x0c0806, 0x1c120d, 0x33221a, 0x4e382a, 0x6a4c3a], gloss: 0.25, rim: 0.6, outline: 0x050302 },
    trim: { keys: [0x1e1204, 0x5a380a, 0xa6701a, 0xe0a840, 0xffe09a], gloss: 0.7, shine: 18, rim: 0.7, outline: 0x0e0802 },
    boot: { keys: [0x050405, 0x120e0d, 0x241c1a, 0x3c302a], gloss: 0.35, shine: 14, rim: 0.6, outline: 0x020202 },
    // The lantern's amber: the flame, the eyes, the levitation ring.
    glow: { keys: [0x5a2a00, 0xe08a14, 0xffc850, 0xfff0b8], emissive: 1, glow: 0x7a4408, glowK: 1.15 },
    rune: { keys: [0x5a2a00, 0xe08a14, 0xffc850, 0xfff0b8], emissive: 1, glow: 0x7a4408, glowK: 1 },
  }, [
    // COAT_L
    { keys: [0x08090c, 0x121419, 0x1f222a, 0x30343e, 0x4c5260], gloss: 0.08, rim: 0.85, outline: 0x040405 },
    // COAT_DK: the rear of the coat.
    { keys: [0x050608, 0x0a0c0f, 0x111317, 0x1b1e24, 0x2b2f37], gloss: 0.05, rim: 0.7, outline: 0x030304 },
    // VOID
    { keys: [0x010101, 0x040405, 0x0a0a0c, 0x14141a], rim: 0.15, outline: 0x010101 },
    // SCARF: mid-grey wool.
    { keys: [0x101115, 0x212329, 0x383b44, 0x545865, 0x7a7e8b], gloss: 0.04, rim: 0.8, outline: 0x08090b },
    // IRON: the lantern's black frame.
    { keys: [0x040405, 0x0e0f12, 0x1c1e24, 0x30333b], gloss: 0.5, shine: 16, rim: 0.6, outline: 0x020203 },
    // SMOKE: translucent grey.
    { keys: [0x1c1d22, 0x34363d, 0x52555f, 0x777b87], translucent: 0.55, rim: 0.3, outline: 0x1c1d22 },
    // HALO: a faint warm light thrown behind the lantern (emissive and mostly clear, so it only adds light).
    { keys: [0x070301, 0x180b03, 0x34190a, 0x58300e], emissive: 1, translucent: 0.95, outline: 0x070301 },
  ]),
  accent: rgbOf(0xf2a830),
  outfit: 'suit',
  headgear: 'none',
  hair: 'none',
  face: 'shadow',
  wand: 'lantern',
  mantle: false,
  pouches: true,
  eyeGlow: [1, 0.78, 0.3],
  build: { torso: 1.06 },
  extras: { back, torso, shoulders, head, headgear: hood, front },
  replace: ['head'],
  drawWand: lantern,
};

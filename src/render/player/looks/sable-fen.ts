import { chainTube } from '@/render/creatures/anatomy';
import { limb } from '@/render/player/AlchemistArt';
import { EXTRA0, SLOT, matsFor, rgbOf } from '@/render/player/fighterLook';
import type { FighterLook, LookCtx } from '@/render/player/fighterLook';
import { bands, cuff, fract, mixP, rail, sheet, tailDir, tornHem, wisp } from '@/render/player/looks/cloakKit';
import type { P } from '@/render/player/looks/cloakKit';

/**
 * Sable Fen, the Mire Stalker: a lean hunter in a tattered moss-green hooded cloak, a bandaged forearm and
 * wrapped boots, a leather harness with a toxic-green gem, and a long scythe-spear that drips mire-green.
 * Silhouette: narrow and tall, a long drooping hood peak, a torn cape streaming behind on the cloth rig,
 * and the weapon far longer than she is.
 */
const CLOAK = EXTRA0, CLOAK_D = EXTRA0 + 1, VOID = EXTRA0 + 2, LINEN = EXTRA0 + 3, STEEL = EXTRA0 + 4, MIST = EXTRA0 + 5;
const GLOW = SLOT.glow, WOOD = SLOT.wood, BRASS = SLOT.trim, LEATHER = SLOT.leather;

/** Tongue lengths of the torn hems (cells); each tail gets its own so the two never march in step. */
const CAPE_TONGUES = [1.5, 0.5, 2.5, 0.9, 2.0, 0.7] as const;
const FLAP_TONGUES = [1.1, 0.4, 1.8, 0.7] as const;

/** The torn cape: from the shoulders down the rear cloth chains, a ragged hem hanging off the end. */
function cape(c: LookCtx): void {
  const { r, s, f, costume, frame } = c;
  if (!costume) return;
  const t0 = costume.tails[0], t1 = costume.tails[1];
  const top: P = { x: s.chest.x - f * 1.4, y: s.chest.y - 1.4 };
  const M = rail(costume.mantle, 1.9 * f);
  const R = rail(t0, 2.7 * f).map((p, i) => (i > 0 && i % 2 === 1 ? { x: p.x + f * -0.7, y: p.y } : p));
  const Q = rail(t1, 0.3 * f);
  const down = tailDir(t0);
  const hem = tornHem(R[R.length - 1], Q[Q.length - 1], down, CAPE_TONGUES, 0.15, frame);
  const pts: P[] = [top, ...M, ...R, ...hem, ...Q.reverse()];
  sheet(r, pts, -8, CLOAK, 4, 1.3, { far: true });
  // Folds: two dark creases down the cloth.
  const a = mixP(R[1], Q[1], 0.45), b = mixP(R[R.length - 1], Q[Q.length - 1], 0.3);
  r.stroke(a.x, a.y, b.x, b.y, CLOAK_D, 0, true);
  // Mire mist clings to the hem and drifts off it.
  const tip = t0.pts[t0.pts.length - 1];
  wisp(r, tip.x, tip.y, frame, MIST, 28, -9, -f * 3, 4.5, 0.2, 4, 0.9, 110);
  // Spores lift off the damp cloth, glinting in turn.
  for (let k = 0; k < 3; k++) {
    const p = fract(frame / 70 + k / 3);
    if (p > 0.75) continue;
    const e = R[1 + k];
    r.dot(e.x - f * (0.6 + p * 1.2) + Math.sin(frame * 0.06 + k * 2) * 0.8, e.y - 1.5 - p * 5, GLOW, p < 0.4 ? 2 : 1, 50);
  }
}

/** Wrapped far boot and bandaged far forearm. */
function backWraps(c: LookCtx): void {
  const { r, s } = c;
  cuff(r, s.backKnee, s.backFoot, 0.55, 0.95, 1.0, 0.92, -5, LINEN, 3);
  bands(r, s.backKnee, s.backFoot, 0.6, 0.92, 2, 1.1, 0.28, LEATHER, 1, 3);
  bands(r, s.backElbow, s.backHand, 0.15, 0.8, 3, 0.9, 0.2, LINEN, 2, 2);
}

/** The cloak's collar over the shoulders, the torn front flap over the near thigh, wrapped near boot, knee guard. */
function shoulders(c: LookCtx): void {
  const { r, s, f, costume, frame } = c;
  // Near boot: layers of linen wrap and a leather strap, a knee guard.
  cuff(r, s.frontKnee, s.frontFoot, 0.5, 0.95, 1.2, 1.05, 3, LINEN, 8);
  bands(r, s.frontKnee, s.frontFoot, 0.56, 0.92, 3, 1.25, 0.26, LEATHER, 1, 8);
  r.ellipse(s.frontKnee.x + f * 0.6, s.frontKnee.y - 0.2, 1.35, 1.45, 0, 3.8, LEATHER, { group: 31 });
  if (costume) {
    // The front flap: a narrow torn strip over the thigh.
    const A = rail(costume.tails[1], 0.85 * f), B = rail(costume.tails[1], -0.85 * f);
    const hem = tornHem(A[A.length - 1], B[B.length - 1], tailDir(costume.tails[1]), FLAP_TONGUES, 0.1, frame + 17);
    sheet(r, [...A, ...hem, ...B.reverse()], 3.6, CLOAK, 9, 1.1);
  }
  // Collar: the cloak gathers on the shoulders and hangs open at the chest.
  r.ellipse(s.chest.x - f * 0.5, s.chest.y - 0.2, 3.25, 1.75, s.lean * 0.8 + f * 0.1, 2.4, CLOAK, { group: 10 });
  r.shade(s.chest.x - f * 0.3, s.chest.y + 0.7, 2.9, 0.6, s.lean, -0.9, 10);
}

/** A hooded head: no face, two green points of light under a deep cowl. */
function head(c: LookCtx): void {
  const { r, s } = c;
  const ht = s.headTilt;
  limb(r, s.neck, s.head, 0.85, 0.9, 3, VOID, 11);
  r.ellipse(s.head.x, s.head.y, 2.3, 2.45, ht, 4, VOID, { group: 11 });
}

function hood(c: LookCtx): void {
  const { r, s, costume, H } = c;
  const ht = s.headTilt;
  // The cowl: a shell over the crown and back of the head, the face left deep inside.
  r.ellipse(...H(-0.8, 0.55), 3.0, 3.4, ht, 5.0, CLOAK, { group: 16 });
  r.ellipse(...H(-1.9, -0.9), 2.3, 2.7, ht, 4.4, CLOAK_D, { group: 16 });
  if (costume) {
    // The peak droops back on the crown chain, drawn out into a point.
    const ch = costume.crown, root = ch.pts[0];
    r.capsule(...H(-0.5, 2.3), 1.9, root.x, root.y, 1.5, 5.2, 5.4, CLOAK, { group: 16 });
    chainTube(r, ch, 5.4, CLOAK, { group: 16 }, 1.5, 0.25);
    const n = ch.pts.length, tip = ch.pts[n - 1], prev = ch.pts[n - 2];
    const dx = tip.x - prev.x, dy = tip.y - prev.y, l = Math.hypot(dx, dy) || 1;
    r.capsule(tip.x, tip.y, 0.3, tip.x + dx / l * 1.5, tip.y + dy / l * 1.5, 0.05, 5.4, 5.4, CLOAK, { group: 16 });
  }
  // The opening: a dark mouth in the cowl and the lit lip of the cloth around it.
  r.stamp(...H(1.45, 0.1), 1.65, 2.25, ht, VOID, 0, true, 16);
  r.stroke(...H(0.1, 2.4), ...H(1.9, 1.9), CLOAK, 4, true);
  r.stroke(...H(1.9, 1.9), ...H(2.65, 0.6), CLOAK, 3, true);
  r.shade(...H(-0.4, 2.2), 2.4, 0.7, ht, 0.8, 16);
  if (!s.eyesShut && !c.dead) {
    r.dot(...H(1.15, 0.55), GLOW, 3, 40);
    r.dot(...H(2.3, 0.5), GLOW, 3, 40);
  }
}

/** Bandaged near forearm. */
function front(c: LookCtx): void {
  const { r, s } = c;
  bands(r, s.frontElbow, s.frontHand, 0.14, 0.8, 4, 1.0, 0.2, LINEN, 2, 13);
  r.stamp(s.frontHand.x, s.frontHand.y, 1.0, 0.9, 0, LEATHER, 2, false, 13);
}

/** The scythe-spear: a long gnarled shaft, a steel sickle, brass rings and mire dripping off them. */
function scythe(c: LookCtx): void {
  const { r, s, f, frame } = c;
  const w = s.wand, ang = w.angle + w.spin, cc = Math.cos(ang), sn = Math.sin(ang);
  // The side the blade curls toward: down, whichever way she faces.
  const nx = -sn * f, ny = cc * f;
  const at = (u: number, v = 0): [number, number] => [w.x + cc * u + nx * v, w.y + sn * u + ny * v];
  r.capsule(...at(-7.5), 0.5, ...at(14.5), 0.42, 8.2, 8.2, WOOD, { group: 14 });
  // The butt is a spike: it is a spear as well.
  r.capsule(...at(-7.4), 0.5, ...at(-10.2), 0.06, 8.3, 8.3, STEEL, { group: 14, tone: -1.6 });
  // The sickle: a crescent swept off the head of the shaft, its cutting edge on the inside of the curve.
  const Rc = 6, PHI = 1.55, SEG = 9;
  const inner: P[] = [], outer: P[] = [];
  for (let k = 0; k <= SEG; k++) {
    const phi = PHI * k / SEG, wid = 0.15 + 1.5 * Math.pow(1 - k / SEG, 0.9);
    const [ix, iy] = at(14.2 + Rc * Math.sin(phi), Rc - Rc * Math.cos(phi));
    const [ox, oy] = at(14.2 + (Rc + wid) * Math.sin(phi), Rc - (Rc + wid) * Math.cos(phi));
    inner.push({ x: ix, y: iy }); outer.push({ x: ox, y: oy });
  }
  sheet(r, [...inner, ...outer.reverse()], 8.5, STEEL, 14, 0.8);
  // Mire on the cutting edge: a thin green line along the inside of the curve.
  for (let k = 1; k < SEG - 1; k++) r.stroke(inner[k].x, inner[k].y, inner[k + 1].x, inner[k + 1].y, GLOW, 1, true);
  // Brass rings, and the mire running off them.
  for (const u of [5.5, 10.2]) {
    const [x, y] = at(u);
    r.stamp(x, y, 0.38, 0.9, ang, BRASS, 2, false, 14);
  }
  const sources: Array<[number, number, number]> = [[5.5, 0, 0.0], [10.2, 0, 0.37], [19.6, 6.1, 0.71]];
  for (const [u, v, ph] of sources) {
    const [x, y] = at(u, v);
    const L = 0.7 + 2.6 * fract(frame / 64 + ph);
    r.capsule(x, y + 0.4, 0.2, x, y + L, 0.28, 8.8, 8.8, GLOW, { group: 14, noOutline: true });
    r.ellipse(x, y + L, 0.34, 0.42, 0, 9, GLOW, { group: 14, noOutline: true });
    r.glowStamp(x, y + L, 0.45, 0.5, 0, GLOW, 2.2, 1.0, 14);
  }
}

export const look: FighterLook = {
  id: 'sable-fen',
  mats: matsFor({
    // The tunic and sleeves under the cloak.
    coat: { keys: [0x070e09, 0x0f1c12, 0x1a3220, 0x2a4c2f, 0x46703f], gloss: 0.1, rim: 0.8, outline: 0x030704 },
    // Dark swamp leather trousers and the far limbs.
    coatD: { keys: [0x050706, 0x0c130e, 0x16211a, 0x25342b, 0x3c5040], gloss: 0.1, rim: 0.6, outline: 0x020403 },
    leather: { keys: [0x120a06, 0x2c1a10, 0x4e301c, 0x7a4e2c, 0xa8703e], gloss: 0.25, rim: 0.6, outline: 0x060403 },
    // Tarnished brass: the buckle, the rings on the shaft.
    trim: { keys: [0x241606, 0x54390f, 0x8a6620, 0xb89440, 0xe0c878], gloss: 0.5, shine: 18, rim: 0.7, outline: 0x120a02 },
    boot: { keys: [0x080504, 0x180f0a, 0x2a1c13, 0x41301f], gloss: 0.3, shine: 12, rim: 0.6, outline: 0x040302 },
    wood: { keys: [0x0c0a06, 0x241a10, 0x45321e, 0x6c5030], gloss: 0.3, rim: 0.6, outline: 0x060403 },
    // Mire-green: the harness gem, the eyes, the scythe's drip, the levitation ring.
    glow: { keys: [0x07381a, 0x1fb446, 0x8aff7a, 0xeaffd0], emissive: 1, glow: 0x0c5a24, glowK: 1.1 },
    rune: { keys: [0x07381a, 0x1fb446, 0x8aff7a, 0xeaffd0], emissive: 1, glow: 0x0c5a24, glowK: 1 },
  }, [
    // CLOAK: moss green, lit from above.
    { keys: [0x08150b, 0x14301a, 0x234d27, 0x3a7234, 0x65a350], gloss: 0.08, rim: 0.85, outline: 0x040a05 },
    // CLOAK_D: the cloak's inside and the rear cape.
    { keys: [0x050c07, 0x0b1c0f, 0x143018, 0x20482a, 0x36683a], gloss: 0.05, rim: 0.7, outline: 0x030704 },
    // VOID: the dark under the hood.
    { keys: [0x010201, 0x030705, 0x07100b, 0x0f1c14], rim: 0.15, outline: 0x010201 },
    // LINEN: the bandage.
    { keys: [0x1a1810, 0x3c3826, 0x69613f, 0x958b5c, 0xbab07c], gloss: 0.05, rim: 0.7, outline: 0x0e0c08 },
    // STEEL: the sickle, pitted and green-tinged.
    { keys: [0x141a1a, 0x3c4a48, 0x8aa09a, 0xd4e6e0, 0xffffff], gloss: 0.9, shine: 30, rim: 0.9, outline: 0x070a0a },
    // MIST: the swamp's breath clinging to the hem (translucent, a faint self-light).
    { keys: [0x0a2412, 0x174a26, 0x2a7a3c, 0x4fae5c], emissive: 0.5, translucent: 0.68, rim: 0.3, outline: 0x0a2412 },
  ]),
  accent: rgbOf(0x4ee86a),
  outfit: 'suit',
  headgear: 'none',
  hair: 'none',
  face: 'shadow',
  wand: 'scythe',
  mantle: false,
  bandolier: true,
  pouches: true,
  eyeGlow: [0.5, 1, 0.5],
  build: { limb: 0.92, torso: 0.92 },
  extras: { back: (c) => { backWraps(c); cape(c); }, shoulders, head, headgear: hood, front },
  replace: ['head'],
  drawWand: scythe,
};


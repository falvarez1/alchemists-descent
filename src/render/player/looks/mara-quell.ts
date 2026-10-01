import { chainTube } from '@/render/creatures/anatomy';
import { hand, limb } from '@/render/player/AlchemistArt';
import { EXTRA0, SLOT, matsFor, rgbOf } from '@/render/player/fighterLook';
import type { FighterLook, LookCtx } from '@/render/player/fighterLook';
import { cuff, fract, mixP, rail, railP, sheet, tailDir, tornHem } from '@/render/player/looks/cloakKit';
import type { P } from '@/render/player/looks/cloakKit';

/**
 * Mara Quell, the Bell Witch: a long deep-purple hooded robe with gold trim and gold sigils, bell sleeves,
 * a brass handbell that rings purple resonance. Silhouette: upright, a tall pointed cowl edged in gold, a robe
 * that sweeps to the boots in an A-line and swings on the cloth rig, wide cuffs, and the bell held out front.
 */
const ROBE = EXTRA0, ROBE_D = EXTRA0 + 1, VOID = EXTRA0 + 2, GILD = EXTRA0 + 3;
const GOLD = SLOT.trim, GLOW = SLOT.glow, RUNE = SLOT.rune;

const HEM = [0.5, 1.5, 0.4, 1.9, 0.6, 1.3] as const;

/** The robe's train: the sweep behind her, on the rear cloth chains; and the far arm's bell sleeve. */
function train(c: LookCtx): void {
  const { r, s, f, costume, frame } = c;
  cuff(r, s.backElbow, s.backHand, 0.1, 0.8, 1.0, 1.5, -5.8, ROBE_D, 2);
  const ang = Math.atan2(s.backHand.y - s.backElbow.y, s.backHand.x - s.backElbow.x), q = mixP(s.backElbow, s.backHand, 0.78);
  r.stamp(q.x, q.y, 0.3, 1.5, ang, GILD, 1, false, 2);
  if (!costume) return;
  const R = rail(costume.tails[0], 3.0 * f), Q = rail(costume.tails[1], 0.2 * f);
  const hem = tornHem(R[R.length - 1], Q[Q.length - 1], tailDir(costume.tails[0]), HEM, 0.1, frame + 5, 0.25);
  sheet(r, [...R, ...hem, ...Q.reverse()], -4, ROBE_D, 4, 1.4);
  // Gold along the sweeping edge.
  const E = rail(costume.tails[0], 3.0 * f, 1);
  for (let i = 1; i < E.length; i++) r.stroke(E[i - 1].x, E[i - 1].y, E[i].x, E[i].y, GOLD, 2, true);
}

/** The skirt: an A-line over both legs, hem just above the boots, trimmed in gold, with a panel of sigils down the front. */
function skirt(c: LookCtx): void {
  const { r, s, f, costume, frame } = c;
  if (!costume) return;
  const R = rail(costume.tails[0], 1.8 * f), Q = rail(costume.tails[1], -2.3 * f);
  const down = tailDir(costume.tails[1]);
  const hem = tornHem(R[R.length - 1], Q[Q.length - 1], down, HEM, 0.1, frame, 0.3);
  sheet(r, [...R, ...hem, ...Q.slice().reverse()], 5, ROBE, 1, 1.5, {});
  // The hem's gold line, and two gold edges bounding the sigil panel.
  for (let i = 1; i < hem.length; i++) r.stroke(hem[i - 1].x, hem[i - 1].y, hem[i].x, hem[i].y, GOLD, 3, true);
  const M: P[] = [];
  for (let i = 0; i < R.length; i++) M.push(mixP(R[i], Q[i], 0.55));
  for (const side of [-0.85, 0.85]) {
    const E = railP(M, side);
    for (let i = 1; i < E.length; i++) r.stroke(E[i - 1].x, E[i - 1].y, E[i].x, E[i].y, GOLD, 2, true);
  }
  // Sigils: a ring with a dark eye, riding the cloth.
  for (const [i, k] of [[2, 0.5], [3, 0.5]] as const) {
    const p = mixP(M[i], M[Math.min(M.length - 1, i + 1)], k);
    r.stamp(p.x, p.y, 0.8, 0.8, 0, GOLD, 3, true, 1);
    r.stamp(p.x, p.y, 0.32, 0.32, 0, ROBE, 1, true, 1);
  }
  void s;
}

/** The belt: a gold sash, a clasp, and a small bell on the vial's spring. */
function belt(c: LookCtx): void {
  const { r, s, f, costume } = c;
  const bx = s.hip.x + c.ux * 0.12, by = s.hip.y + c.uy * 0.12;
  r.stamp(bx, by, 2.35, 0.75, Math.atan2(c.uy, c.ux) + Math.PI / 2, GILD, 1, false, 1);
  r.dot(bx + f * 0.5, by, GOLD, 3, 6);
  const sw = costume?.vial ?? 0;
  r.ellipse(bx + f * 1.6 + sw * 0.3, by + 1.8, 0.62, 0.74, 0, 3.4, GOLD, { group: 7 });
  r.stamp(bx + f * 1.6 + sw * 0.3, by + 2.2, 0.4, 0.16, 0, GOLD, 0, true, 7);
}

/** Shoulder cowl in robe cloth, gold-edged, with a clasp at the throat. */
function shoulders(c: LookCtx): void {
  const { r, s, f } = c;
  r.ellipse(s.chest.x - f * 0.4, s.chest.y - 0.15, 3.2, 1.7, s.lean * 0.8 + f * 0.1, 2.4, ROBE, { group: 10 });
  r.shade(s.chest.x - f * 0.3, s.chest.y + 0.7, 2.9, 0.6, s.lean, -0.9, 10);
  r.stroke(s.chest.x - f * 2.6, s.chest.y + 0.9, s.chest.x + f * 2.0, s.chest.y + 1.3, GOLD, 3, true);
  r.dot(s.chest.x + f * 1.4, s.chest.y - 1.1, GOLD, 4, 6);
}

function head(c: LookCtx): void {
  const { r, s } = c;
  limb(r, s.neck, s.head, 0.85, 0.9, 3, VOID, 11);
  r.ellipse(s.head.x, s.head.y, 2.3, 2.45, s.headTilt, 4, VOID, { group: 11 });
}

/** The cowl: a tall pointed hood, its opening edged in gold, two violet points of light inside. */
function hood(c: LookCtx): void {
  const { r, s, costume, H } = c;
  const ht = s.headTilt;
  r.ellipse(...H(-0.7, 0.5), 3.0, 3.35, ht, 5.0, ROBE, { group: 16 });
  r.ellipse(...H(-1.8, -0.9), 2.3, 2.7, ht, 4.4, ROBE_D, { group: 16 });
  if (costume) {
    const ch = costume.crown, root = ch.pts[0];
    r.capsule(...H(-0.4, 2.3), 1.8, root.x, root.y, 1.3, 5.2, 5.4, ROBE, { group: 16 });
    chainTube(r, ch, 5.4, ROBE, { group: 16 }, 1.3, 0.2);
  }
  r.stamp(...H(1.5, 0.05), 1.6, 2.2, ht, VOID, 0, true, 16);
  // The gold rim around the opening.
  const rim = [H(0.0, 2.55), H(0.9, 2.5), H(1.8, 2.0), H(2.5, 1.0), H(2.75, -0.1), H(2.5, -1.2)] as const;
  for (let i = 1; i < rim.length; i++) r.stroke(rim[i - 1][0], rim[i - 1][1], rim[i][0], rim[i][1], GOLD, 3, true);
  if (!s.eyesShut && !c.dead) {
    r.dot(...H(1.1, 0.5), GLOW, 3, 40);
    r.dot(...H(2.15, 0.45), GLOW, 3, 40);
  }
}

/** The bell sleeve: a wide flared cuff on the near arm, banded in gold, the hand coming out of it. */
function sleeve(c: LookCtx): void {
  const { r, s, f } = c;
  const e = s.frontElbow, h = s.frontHand;
  cuff(r, e, h, 0.05, 0.8, 1.15, 1.75, 8.7, ROBE, 13);
  const ang = Math.atan2(h.y - e.y, h.x - e.x), p = mixP(e, h, 0.78);
  r.stamp(p.x, p.y, 0.32, 1.7, ang, GOLD, 2, false, 13);
  hand(r, h, e, 10.0, 13, false);
  void f;
}

/**
 * The handbell. The handle follows the aim (so the wand still shows where she is aiming); the bell hangs from
 * its end, sagging toward the ground while she is idle and swinging up to point along the aim, mouth first,
 * as she casts, ringing violet arcs ahead of it.
 */
function bell(c: LookCtx): void {
  const { r, s, a, f, frame } = c;
  const w = s.wand, ang = w.angle + w.spin, cc = Math.cos(ang), sn = Math.sin(ang);
  const glow = w.glow * (0.9 + Math.sin(frame * 0.3) * 0.1);
  const ring = a.firing ? 1 : Math.min(1, Math.max(0, a.recoilT / 6));
  // Idle, the bell hangs from her hand, mouth down, swinging a little with her stride; casting, it swings out
  // along the aim (the handle grows with it) and rings.
  const hang = Math.PI / 2 + Math.sin(frame * 0.11) * 0.07 + Math.max(-0.5, Math.min(0.5, (a._svx || 0) * 0.12));
  const axis = hang + Math.atan2(Math.sin(ang - hang), Math.cos(ang - hang)) * ring;
  const ac = Math.cos(axis), as = Math.sin(axis);
  const reach = 0.5 + 2.6 * ring;
  const hx = w.x + cc * reach, hy = w.y + sn * reach;
  r.capsule(w.x, w.y, 0.4, hx, hy, 0.4, 8.3, 8.3, GOLD, { group: 14 });
  r.ellipse(hx, hy, 0.62, 0.62, 0, 8.6, GOLD, { group: 14 });
  const nx = -as * f, ny = ac * f;
  const at = (u: number, v = 0): P => ({ x: hx + ac * u + nx * v, y: hy + as * u + ny * v });
  // Half-widths along the axis: a crown, round shoulders, a body that flares into a lip.
  const prof: ReadonlyArray<readonly [number, number]> = [[0.0, 0.55], [0.5, 1.3], [1.1, 1.85], [1.9, 2.15], [2.8, 2.3], [3.5, 2.6], [3.95, 3.1], [4.15, 3.15]];
  const body: P[] = [];
  for (const [u, hw] of prof) body.push(at(u, -hw));
  for (let i = prof.length - 1; i >= 0; i--) body.push(at(prof[i][0], prof[i][1]));
  sheet(r, body, 8.5, GOLD, 14, 1.6);
  const lip = at(4.15);
  r.ellipse(lip.x, lip.y, 0.55, 3.15, axis, 9.0, GOLD, { group: 14 });
  const mouth = at(4.3);
  r.ellipse(mouth.x, mouth.y, 0.3, 2.3, axis, 9.4, GOLD, { group: 14, tone: -2.6 });
  const swing = Math.sin(frame * 0.2) * (0.3 + ring * 0.6);
  const cl = at(4.7, swing);
  r.ellipse(cl.x, cl.y, 0.42, 0.42, 0, 9.6, GOLD, { group: 14 });
  r.glowStamp(lip.x, lip.y, 0.5, 3.0, axis, RUNE, 0.6 + glow * 0.5 + ring * 0.8, 0.3, 14);
  // Resonance: arcs of violet leaving the mouth along the aim, widening and thinning as they go.
  if (a.firing) {
    for (let k = 0; k < 3; k++) {
      const t = fract(frame / 22 + k / 3), rad = 2.0 + t * 7.5, half = 0.62, width = 0.42 * (1 - t) + 0.12;
      let px = 0, py = 0;
      for (let j = 0; j <= 6; j++) {
        const th = -half + (2 * half * j) / 6;
        const x = lip.x + (ac * Math.cos(th) - nx * Math.sin(th)) * rad, y = lip.y + (as * Math.cos(th) - ny * Math.sin(th)) * rad;
        if (j > 0) r.capsule(px, py, width, x, y, width, 9.8, 9.8, RUNE, { group: 14, noOutline: true });
        px = x; py = y;
      }
    }
  }
}

/** Resonance: a few violet motes drifting around the bell, glinting in turn. */
function motes(c: LookCtx): void {
  const { r, s, frame, dead } = c;
  if (dead) return;
  const w = s.wand;
  for (let k = 0; k < 4; k++) {
    const a = frame * 0.035 + k * 1.57, rad = 3.2 + k * 0.9 + Math.sin(frame * 0.05 + k) * 0.6;
    const lit = fract(frame / 50 + k * 0.27);
    if (lit > 0.7) continue;
    r.dot(w.x + 3.5 + Math.cos(a) * rad, w.y + 2.5 + Math.sin(a) * rad * 0.7, GLOW, lit < 0.35 ? 3 : 2, 50);
  }
}

export const look: FighterLook = {
  id: 'mara-quell',
  mats: matsFor({
    coat: { keys: [0x07040f, 0x130a24, 0x221340, 0x382060, 0x5c3da0], gloss: 0.12, rim: 0.85, outline: 0x040208 },
    coatD: { keys: [0x05030a, 0x0d061a, 0x170c2e, 0x261648, 0x3c2866], gloss: 0.1, rim: 0.7, outline: 0x030106 },
    leather: { keys: [0x0e0814, 0x20142c, 0x38243e, 0x56384e, 0x7c5668], gloss: 0.25, rim: 0.6, outline: 0x050309 },
    // Brass and gold: the trim, the belt, the bell.
    trim: { keys: [0x3a2204, 0x946410, 0xe0a42a, 0xffd860, 0xfff0b8], gloss: 0.5, shine: 24, rim: 0.75, outline: 0x180c02 },
    boot: { keys: [0x060309, 0x150d1c, 0x2a1c34, 0x46304e], gloss: 0.4, shine: 14, rim: 0.6, outline: 0x030105 },
    // Resonance: violet.
    glow: { keys: [0x2a0a5a, 0x7a2ae0, 0xc88cff, 0xf6e8ff], emissive: 1, glow: 0x3a0a7a, glowK: 1.1 },
    rune: { keys: [0x2a0a5a, 0x7a2ae0, 0xc88cff, 0xf6e8ff], emissive: 1, glow: 0x3a0a7a, glowK: 1 },
  }, [
    // ROBE
    { keys: [0x08050f, 0x150b28, 0x261546, 0x3d2470, 0x6646ae], gloss: 0.1, rim: 0.85, outline: 0x040208 },
    // ROBE_D: the train and the inside of the cloth.
    { keys: [0x05030a, 0x0c0618, 0x160c2c, 0x241544, 0x3a2762], gloss: 0.08, rim: 0.7, outline: 0x030106 },
    // VOID
    { keys: [0x010002, 0x040208, 0x0a0614, 0x150c24], rim: 0.15, outline: 0x010002 },
    // GILD: gold cloth and braid (no lacquer, so it never blows out to white).
    { keys: [0x3a2204, 0x8a5c0e, 0xc8941e, 0xe8bc48, 0xf6d878], gloss: 0, rim: 0.5, outline: 0x180c02 },
  ]),
  accent: rgbOf(0xb06cff),
  outfit: 'suit',
  headgear: 'none',
  hair: 'none',
  face: 'shadow',
  wand: 'bell',
  mantle: false,
  pouches: false,
  eyeGlow: [0.75, 0.5, 1],
  build: { limb: 0.95 },
  extras: { back: train, torso: (c) => { skirt(c); belt(c); }, shoulders, head, headgear: hood, front: sleeve, effects: motes },
  replace: ['head'],
  drawWand: bell,
};

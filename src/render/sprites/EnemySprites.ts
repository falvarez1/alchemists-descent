import type { Ctx, Enemy } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { clamp, lerp, traceLine } from '@/core/math';
import { solveConstrainedLegIk } from '@/render/animation/ConstrainedLegIk';
// Pure pose data/math from the Weaver's tick-rate locomotion — the renderer
// reads the rig it owns (no gameplay coupling; nothing here is called back).
import { WEAVER_LEG_REACH_LOCO, WEAVER_LOCO_REST, weaverHipWorld } from '@/entities/weaverLocomotion';
import {
  drawWeaverRigPart,
  drawWeaverRigSegment,
  weaverFootPart,
  weaverLowerLegPart,
  weaverRigReady,
  weaverUpperLegPart,
} from '@/render/sprites/WeaverRigSprites';

type RGB = readonly [number, number, number];

/** Deterministic per-frame flicker noise in [0,1): keyed to the SIM clock
 *  (frameCount freezes while paused; rAF keeps drawing) so paused frames hold
 *  perfectly still instead of vibrating with per-draw Math.random(). */
function flickerNoise(frameCount: number, seed: number): number {
  const h = Math.sin(frameCount * 12.9898 + seed * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Procedural enemy sprites (original drawEnemySprite): slime squash & stretch
 * (shared by the acid slime, in acid greens with drip pixels), imp
 * hover/flap/flicker, wisp self-lit guttering diamond, mage hooded robe with
 * channel-flare hands, golem heavy stride with pulsing core.
 *
 * NOTE: this function intentionally MUTATES animation state on the enemy
 * (e.splat / e.prevG / e.blink for slimes; e._px / e._svx / e.stride for
 * golems) exactly like the original did from inside the renderer. The mage
 * only READS e.blink — there it is the telekinesis telegraph countdown set
 * by the AI (Enemies.ts), and the hands flare while it runs.
 */
export function drawEnemySprite(s: PixelSurface, light: LightField, ctx: Ctx, e: Enemy): void {
  const frameCount = ctx.state.frameCount;
  const def = ctx.enemyCtl.defs[e.kind];
  const flash = e.flash > 0;
  const boost = ctx.params.global.maxBrightness;
  // Creatures obey the light: a body in shadow is a silhouette, a body near
  // glowing material is revealed. Emissive parts (eyes, cores, flames) stay lit.
  const selfLit = e.kind === 'imp' || e.kind === 'wisp';
  const lt = light.sample(e.x, e.y - def.h * 0.5);
  const bR = selfLit ? 1 : Math.max(0.05, lt.r);
  const bG = selfLit ? 1 : Math.max(0.05, lt.g);
  const bB = selfLit ? 1 : Math.max(0.05, lt.b);
  // Electrocuted bodies convulse: a violent per-frame render jitter (visual only —
  // the sim pins them to the live conductor, see Enemies.ts). Every pixel draws
  // off this shaken origin, so the whole creature vibrates while current crawls it.
  const conv = e.status.electrified > 0;
  const bx = conv ? e.x + ((flickerNoise(frameCount, e.bobPhase * 7.1) * 5) | 0) - 2 : e.x;
  const by = conv ? e.y + ((flickerNoise(frameCount, e.bobPhase * 3.7 + 11) * 3) | 0) - 1 : e.y;
  // Impact-squash (Rain World body weight): a landing thump compresses the body
  // vertically, anchored at the feet (dy = 0), then springs back through a slight
  // stretch overshoot. The spring lives on the entity (Enemies.tickImpactSquash).
  // Blob kinds (slime/acidslime/bomber) run their own volume-preserving splat, so
  // they stay neutral here. At rest (squash 0 → syq 1) sq() is identity: every
  // pixel is exactly where it was, so unlanded enemies render byte-for-byte as before.
  const blobKind = e.kind === 'slime' || e.kind === 'acidslime' || e.kind === 'bomber';
  const bodySquash = blobKind ? 0 : (e.squash ?? 0);
  const syq = bodySquash !== 0 ? clamp(1 - bodySquash * 0.55, 0.68, 1.03) : 1;
  const sq = (dy: number): number => (syq === 1 ? dy : Math.round(dy * syq));
  const P = (dx: number, dy: number, r: number, g: number, b: number): void => {
    if (flash) s.setPx(bx + dx, by - sq(dy), 2.2, 2.2, 2.2);
    else s.setPx(bx + dx, by - sq(dy), r * bR, g * bG, b * bB);
  };
  const PE = (dx: number, dy: number, r: number, g: number, b: number): void => {
    if (flash) s.setPx(bx + dx, by - sq(dy), 2.2, 2.2, 2.2);
    else s.setPx(bx + dx, by - sq(dy), r, g, b);
  };
  // Eyes are honest (Rain World): an unaware creature scans the room on a
  // slow wander; only an ALERTED one locks its gaze onto the alchemist.
  const look = e.alerted
    ? ctx.player.x > e.x
      ? 1
      : -1
    : Math.sin(frameCount * 0.02 + e.bobPhase * 3.7) > 0
      ? 1
      : -1;

  // --- Threat telegraph (shared, kind-agnostic): a brief startle mark above the
  //     crown the instant a creature COMMITS a reflex — so the threat-aware AI
  //     (fear/dodge/flee in Enemies.ts) reads on screen. Derived from the reflex
  //     timers at their peak (dodgeT max 12, fleeT max 26), so it carries no new
  //     state and fades over a few frames. Drawn emissive so it shows in shadow,
  //     kicked toward the escape direction for a touch of intent.
  const startleD = (e.dodgeT ?? 0) >= 10 ? (e.dodgeT ?? 0) - 9 : 0; // 1..3 on commit
  const startleF = (e.fleeT ?? 0) >= 23 ? Math.min(3, (e.fleeT ?? 0) - 22) : 0; // 1..3
  const startle = Math.max(startleD, startleF);
  if (startle > 0 && !flash) {
    const ty = def.h + 3; // just clear of the tallest crown
    const lean = (startleD > 0 ? (e.dodgeVX ?? 0) : (e.fleeDir ?? 0)) >= 0 ? 1 : -1;
    const a = 0.5 + startle * 0.2; // brightest on the commit frame, ~0.7..1.1
    PE(lean, ty + 1, a, a * 0.9, a * 0.5); // stroke top (slanted toward escape)
    PE(0, ty, a, a * 0.9, a * 0.5); // stroke
    PE(0, ty - 2, a * 0.9, a * 0.85, a * 0.45); // the dot — a tiny "!"
  }

  if (e.kind === 'slime' || e.kind === 'acidslime') {
    // --- Squash & stretch: tall in flight, splat on landing, wobble at rest ---
    if (e.grounded && !e.prevG && Math.abs(e.vy) < 0.1) e.splat = 8;
    e.prevG = e.grounded;
    if (e.splat > 0) e.splat--;
    if (e.blink > 0) e.blink--; else if (flickerNoise(frameCount, e.bobPhase * 5.3) < 0.008) e.blink = 6;

    let sy = 1, sx = 1;
    if (!e.grounded) { sy = 1 + Math.min(0.45, Math.abs(e.vy) * 0.13); sx = 1 / sy; }
    else if ((e.windup ?? 0) > 0) { sx = 1 + (e.windup ?? 0) * 0.045; sy = 1 / sx; } // gathering to leap
    else if (e.splat > 0) { sx = 1 + e.splat * 0.05; sy = 1 / sx; }
    else { const w = Math.sin(frameCount * 0.085 + e.bobPhase) * 0.07; sx = 1 + w; sy = 1 - w; }
    // wounded droop: the membrane sags wide and low
    if (e.hp / e.maxHp < 0.4 && e.grounded) { sx *= 1.12; sy *= 0.86; }

    const acid = e.kind === 'acidslime';
    const G: RGB = acid ? [0.28, 0.92, 0.12] : [0.20, 0.78, 0.35];
    const GD: RGB = acid ? [0.12, 0.52, 0.05] : [0.10, 0.45, 0.20];
    const GL: RGB = acid ? [0.72, 1.0, 0.32] : [0.55, 1.0, 0.65];
    const H = Math.max(4, Math.round(def.h * sy));
    const baseHW = def.halfW;
    for (let dy = 0; dy < H; dy++) {
      const t = dy / H;
      const hw = Math.max(1, Math.round(baseHW * sx * Math.sqrt(Math.max(0, 1 - t * t * 0.92))));
      for (let dx = -hw; dx <= hw; dx++) {
        const edge = Math.abs(dx) === hw || dy === 0;
        P(dx, dy, ...(edge ? GD : G));
      }
    }
    P(-Math.round(baseHW * sx * 0.5), H - 2, ...GL); // sheen
    if (acid) {
      // two darker drips sweating down the membrane
      const drip = (frameCount >> 2) % H;
      P(-2, H - 1 - drip, ...GD);
      P(3, H - 1 - ((drip + (H >> 1)) % H), ...GD);
    }
    if (e.blink === 0) {
      // alerted eyes also pitch toward the alchemist's altitude
      const vlook = e.alerted ? (e.y - ctx.player.y > 14 ? 1 : ctx.player.y - e.y > 14 ? -1 : 0) : 0;
      const eyeY = Math.max(1, Math.round(H * 0.4) + vlook);
      P(look - 2, eyeY, 0.95, 1.0, 0.95); P(look + 2, eyeY, 0.95, 1.0, 0.95);
      P(look - 2 + (look > 0 ? 1 : 0), eyeY, 0.02, 0.10, 0.02);
      P(look + 2 + (look > 0 ? 1 : 0), eyeY, 0.02, 0.10, 0.02);
    }
  } else if (e.kind === 'imp') {
    // --- Hover bob (visual), 3-pose wing flap, wagging tail ---
    const hover = Math.round(Math.sin(e.bobPhase) * 1.6);
    const Q = (dx: number, dy: number, r: number, g: number, b: number): void => P(dx, dy + hover, r, g, b);
    const flick = 0.85 + flickerNoise(frameCount, e.bobPhase * 9.2) * 0.45;
    const O: RGB = [1.0 * flick * 1.5, 0.42 * flick * 1.5, 0.05], OD: RGB = [0.55, 0.18, 0.03];
    const leanI = clamp(Math.round(e.vx * 2.2), -2, 2);
    const ph = frameCount % 18;
    const pose = ph < 6 ? 0 : (ph < 12 ? 1 : 2); // wings up / mid / down

    // horns
    Q(-3 + leanI, 12, ...OD); Q(3 + leanI, 12, ...OD);
    Q(-3 + leanI, 11, ...O); Q(3 + leanI, 11, ...O);
    Q(-2 + leanI, 11, ...OD); Q(2 + leanI, 11, ...OD);
    // head
    for (let dx = -2; dx <= 2; dx++) Q(dx + leanI, 10, ...O);
    for (let dx = -3; dx <= 3; dx++) Q(dx + leanI, 9, ...(Math.abs(dx) === 3 ? OD : O));
    // burning eyes flicker
    const eb = 1.3 + flickerNoise(frameCount, e.bobPhase * 4.4 + 3) * 0.5;
    Q(look - 1 + leanI, 9, eb * boost * 0.35, eb * boost * 0.30, 0.12);
    Q(look + 1 + leanI, 9, eb * boost * 0.35, eb * boost * 0.30, 0.12);
    // body
    for (let dy = 5; dy <= 8; dy++) {
      const hw = dy >= 7 ? 3 : (dy === 6 ? 3 : 2);
      for (let dx = -hw; dx <= hw; dx++) Q(dx + (dy > 7 ? leanI : Math.round(leanI * 0.5)), dy, ...(Math.abs(dx) === hw ? OD : O));
    }
    for (let dx = -1; dx <= 1; dx++) Q(dx, 4, ...OD);
    // wings: three poses, membranes trailing
    const wingY = pose === 0 ? 10 : (pose === 1 ? 8 : 6);
    for (let wseg = 0; wseg < 3; wseg++) {
      const wy = wingY + (pose === 0 ? wseg : (pose === 2 ? -wseg : 0));
      Q(-4 - wseg, wy, ...(wseg === 2 ? ([0.35, 0.10, 0.02] as const) : OD));
      Q(4 + wseg, wy, ...(wseg === 2 ? ([0.35, 0.10, 0.02] as const) : OD));
    }
    // tail wags
    const wag = Math.round(Math.sin(e.bobPhase * 1.6) * 2);
    Q(-look, 3, ...OD);
    Q(-look * 2 + Math.round(wag * 0.5), 2, ...OD);
    Q(-look * 3 + wag, 1, ...O);
  } else if (e.kind === 'wisp') {
    // --- Frost wisp: a self-lit 5x7 diamond of cold light, guttering ---
    const hover = Math.round(Math.sin(e.bobPhase) * 1.5);
    const flick = 0.8 + flickerNoise(frameCount, e.bobPhase * 6.6) * 0.35 + Math.sin(frameCount * 0.23 + e.bobPhase) * 0.12;
    const W7 = [0, 1, 2, 2, 2, 1, 0] as const;
    for (let dy = 0; dy < 7; dy++) {
      const hw = W7[dy];
      for (let dx = -hw; dx <= hw; dx++) {
        const heart = dx === 0 && dy === 3;
        const edge = Math.abs(dx) === hw;
        const f = (heart ? 1.5 : edge ? 0.5 : 1.0) * flick * boost * 0.55;
        P(dx, dy + 1 + hover, 0.5 * f, 0.92 * f, 1.1 * f);
      }
    }
    // two trailing motes drift behind its motion
    const tl = Math.abs(e.vx) + Math.abs(e.vy) + 0.001;
    const mxn = -e.vx / tl,
      myn = -e.vy / tl;
    const m1 = 0.55 * flick, m2 = 0.3 * flick;
    PE(Math.round(mxn * 3), 4 - Math.round(myn * 3) + hover, 0.18 * m1, 0.4 * m1, 0.5 * m1);
    PE(Math.round(mxn * 5), 4 - Math.round(myn * 5) + hover, 0.18 * m2, 0.4 * m2, 0.5 * m2);
  } else if (e.kind === 'mage') {
    // --- Powder Mage: hooded robe, purple-lit hands, eyes that never leave you ---
    // (e.blink is the telekinesis telegraph countdown set by the AI; while it
    //  runs, the hands flare bright)
    const R: RGB = [0.17, 0.13, 0.25], RD: RGB = [0.08, 0.06, 0.13], RT: RGB = [0.33, 0.22, 0.50];
    const sway = Math.round(Math.sin(frameCount * 0.045 + e.bobPhase));
    // robe: widens to a frayed hem
    for (let dy = 0; dy <= 7; dy++) {
      const hw = Math.max(3, 5 - (dy >> 1));
      for (let dx = -hw; dx <= hw; dx++) {
        P(dx, dy, ...(Math.abs(dx) === hw || dy === 0 ? RD : R));
      }
    }
    // belted waist
    for (let dx = -3; dx <= 3; dx++) P(dx, 8, ...(Math.abs(dx) === 3 ? RD : RT));
    // chest
    for (let dx = -3; dx <= 3; dx++) P(dx + sway, 9, ...(Math.abs(dx) === 3 ? RD : R));
    // hood
    for (let dy = 10; dy <= 13; dy++) {
      const hw = dy === 13 ? 1 : dy === 12 ? 2 : 3;
      for (let dx = -hw; dx <= hw; dx++) P(dx + sway, dy, ...(Math.abs(dx) === hw ? RD : R));
    }
    // hood shadow + white eyes tracking the player
    for (let dx = -1; dx <= 1; dx++) P(dx + sway, 11, 0.03, 0.02, 0.05);
    PE(look - 1 + sway, 11, 0.95, 0.95, 1.0);
    PE(look + 1 + sway, 11, 0.95, 0.95, 1.0);
    // hands: a purple glow that flares while the telegraph runs
    const channeling = e.blink > 0;
    const hg =
      (channeling ? 1.6 + flickerNoise(frameCount, e.bobPhase * 8.5) * 0.6 : 0.55 + Math.sin(frameCount * 0.09 + e.bobPhase) * 0.18) *
      boost * 0.5;
    PE(-6, 5, hg * 0.8, hg * 0.32, hg);
    PE(6, 5, hg * 0.8, hg * 0.32, hg);
    PE(-6, 4, hg * 0.5, hg * 0.2, hg * 0.65);
    PE(6, 4, hg * 0.5, hg * 0.2, hg * 0.65);
  } else if (e.kind === 'eggs') {
    // --- Slime egg clutch: glistening blobs, embryos pulsing inside ---
    const G: RGB = [0.25, 0.5, 0.22],
      GD: RGB = [0.14, 0.3, 0.13];
    for (const [bx, by, rr] of [
      [-2, 1, 2],
      [2, 1, 2],
      [0, 3, 2],
    ] as Array<[number, number, number]>) {
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          if (dx * dx + dy * dy > rr * rr) continue;
          P(bx + dx, by + dy, ...(dx * dx + dy * dy >= rr * rr - 1 ? GD : G));
        }
      }
      // the embryo stirs: a brighter pulse deep in each egg
      const stir = 0.4 + Math.sin(frameCount * 0.06 + e.bobPhase + bx) * 0.25;
      PE(bx, by, 0.25 * stir, 0.8 * stir * boost * 0.4, 0.2 * stir);
    }
    // wet glints
    P(-3, 2, 0.5, 0.75, 0.5);
    P(1, 4, 0.5, 0.75, 0.5);
  } else if (e.kind === 'bat' && e.sleeping) {
    // --- Roosting bat: folded teardrop hanging from the ceiling.
    //     It STIRS when you get close — the shiver is your last warning. ---
    const pdx2 = ctx.player.x - e.x,
      pdy2 = ctx.player.y - e.y;
    const near = !ctx.player.dead && pdx2 * pdx2 + pdy2 * pdy2 < 110 * 110;
    const tr = near && frameCount % 7 < 2 ? (frameCount % 14 < 7 ? 1 : -1) : 0;
    const V2: RGB = [0.3, 0.18, 0.38],
      VD2: RGB = [0.17, 0.1, 0.23];
    P(tr, 4, ...VD2); // ceiling grip
    P(-1 + tr, 3, ...V2); P(tr, 3, ...V2); P(1 + tr, 3, ...V2);
    P(-1 + tr, 2, ...V2); P(tr, 2, ...VD2); P(1 + tr, 2, ...V2);
    P(-1 + tr, 1, ...VD2); P(tr, 1, ...V2); P(1 + tr, 1, ...VD2);
    P(tr, 0, ...VD2);
    // breathing shimmer; one red eye cracks open at your approach
    if (frameCount % 90 < 6) PE(0, 2, 0.12, 0.03, 0.03);
    if (near && frameCount % 30 < 18) PE(tr, 2, 0.5, 0.06, 0.06);
  } else if (e.kind === 'bat') {
    // --- Cave bat: 2-pose wing snap, glinting red eyes. Anticipation and
    // injury read through the wings: a full-spread FLARE holds before the
    // dart, a swoop sweeps them tight, and a tumble scrambles the beat. ---
    const flaring = (e.windup ?? 0) > 0;
    const swooping = (e.swoop ?? 0) > 0;
    const slimed = (e.slimed ?? 0) > 0;
    const tumbling = (e.tumble ?? 0) > 0 || slimed;
    const hover =
      (slimed ? 0 : Math.round(Math.sin(e.bobPhase) * 1.2)) +
      (tumbling ? Math.round((flickerNoise(frameCount, e.bobPhase * 5.9) - 0.5) * 2) : 0);
    const Q = (dx: number, dy: number, r: number, g: number, b: number): void =>
      P(dx, dy + hover, r, g, b);
    const V: RGB = [0.36, 0.22, 0.46],
      VD: RGB = [0.2, 0.11, 0.27],
      SL: RGB = [0.16, 0.52, 0.18],
      SLD: RGB = [0.08, 0.34, 0.12];
    const wingUp = tumbling
      ? frameCount % 4 < 2 // panicked double-time flutter
      : flaring
        ? true
        : swooping
          ? false
          : frameCount % 10 < 5;
    // body nub
    Q(-1, 2, ...V); Q(0, 2, ...V); Q(1, 2, ...V);
    Q(-1, 1, ...VD); Q(0, 1, ...V); Q(1, 1, ...VD);
    Q(0, 0, ...VD);
    // ears
    Q(-1, 3, ...VD); Q(1, 3, ...VD);
    // eyes glint red (emissive — they pierce the dark)
    const ef = 0.8 + flickerNoise(frameCount, e.bobPhase * 3.3 + 7) * 0.5;
    PE(look === 1 ? 0 : -1, 2 + hover, ef * boost * 0.4, 0.04, 0.04);
    PE(look === 1 ? 1 : 0, 2 + hover, ef * boost * 0.4, 0.04, 0.04);
    // wings: snap between raised and swept
    if (wingUp) {
      Q(-2, 3, ...V); Q(-3, 4, ...VD); Q(-4, 4, ...VD);
      Q(2, 3, ...V); Q(3, 4, ...VD); Q(4, 4, ...VD);
      if (flaring) {
        // the full spread: wingtips out one more reach before the dart
        Q(-5, 5, ...VD); Q(5, 5, ...VD);
      }
    } else {
      Q(-2, 1, ...V); Q(-3, 1, ...VD); Q(-4, 0, ...VD);
      Q(2, 1, ...V); Q(3, 1, ...VD); Q(4, 0, ...VD);
    }
    if (slimed) {
      Q(-3, wingUp ? 4 : 1, ...SLD); Q(3, wingUp ? 4 : 1, ...SLD);
      Q(-2, 2, ...SL); Q(2, 2, ...SL);
      Q(0, 1, ...SLD);
    }
  } else if (e.kind === 'spitter') {
    // --- Rooted toxic bulb: swaying stalk, maw recoils after each lob ---
    const sway = Math.round(Math.sin(frameCount * 0.04 + e.bobPhase) * 1.2);
    const rec = (e.recoil ?? 0) > 0 ? Math.round((e.recoil ?? 0) * 0.18) : 0;
    const T: RGB = [0.3, 0.55, 0.18],
      TD: RGB = [0.16, 0.32, 0.1],
      TB: RGB = [0.55, 0.85, 0.25];
    // root claws
    for (let dx = -4; dx <= 4; dx += 2) P(dx, 0, ...TD);
    for (let dx = -3; dx <= 3; dx++) P(dx, 1, ...TD);
    // stalk
    for (let dy = 2; dy <= 5; dy++) {
      const sx2 = Math.round((sway * (dy - 1)) / 5);
      P(sx2 - 1, dy, ...TD); P(sx2, dy, ...T); P(sx2 + 1, dy, ...TD);
    }
    // bulb head (recoils down when it spits)
    const hy = 8 - rec;
    for (let dy = -2; dy <= 2; dy++) {
      const hw = Math.abs(dy) === 2 ? 2 : 3;
      for (let dx = -hw; dx <= hw; dx++) {
        const c = Math.abs(dx) === hw ? TD : T;
        P(dx + sway, hy + dy, ...c);
      }
    }
    // glowing maw, brighter as the next shot charges
    const charge = e.attackCd < 40 ? 1 - e.attackCd / 40 : 0;
    const mawG = (0.5 + charge * 0.9) * boost * 0.5;
    PE(sway + look, hy, mawG * 0.6, mawG, mawG * 0.2);
    PE(sway + look * 2, hy, mawG * 0.5, mawG * 0.85, mawG * 0.15);
    // venom sacs
    P(sway - 2, hy + 1, ...TB);
    P(sway + 2, hy - 1, ...TB);
  } else if (e.kind === 'bomber') {
    // --- Volatile orange slime: jiggles, then strobes white as the fuse burns ---
    if (e.grounded && !e.prevG && Math.abs(e.vy) < 0.1) e.splat = 8;
    e.prevG = e.grounded;
    if (e.splat > 0) e.splat--;
    let sy = 1,
      sx = 1;
    if (!e.grounded) {
      sy = 1 + Math.min(0.45, Math.abs(e.vy) * 0.13);
      sx = 1 / sy;
    } else if (e.splat > 0) {
      sx = 1 + e.splat * 0.05;
      sy = 1 / sx;
    } else {
      const w = Math.sin(frameCount * 0.12 + e.bobPhase) * 0.09;
      sx = 1 + w;
      sy = 1 - w;
    }
    // fuse strobe: flashes white faster as detonation nears
    const fusing = (e.fusing ?? 0) > 0;
    const strobe =
      fusing && Math.floor(frameCount / Math.max(1, Math.floor((e.fusing ?? 0) / 6))) % 2 === 0;
    const O: RGB = strobe ? [2.0, 2.0, 1.6] : [0.95, 0.45, 0.08];
    const OD: RGB = strobe ? [1.4, 1.4, 1.1] : [0.55, 0.22, 0.03];
    const PB = strobe ? PE : P; // a strobing bomber lights itself
    const H = Math.max(4, Math.round(def.h * sy));
    for (let dy = 0; dy < H; dy++) {
      const t = dy / H;
      const hw = Math.max(1, Math.round(def.halfW * sx * Math.sqrt(Math.max(0, 1 - t * t * 0.92))));
      for (let dx = -hw; dx <= hw; dx++) {
        const c = Math.abs(dx) === hw || dy === 0 ? OD : O;
        PB(dx, dy, ...c);
      }
    }
    // stubby fuse on top, spark when lit
    PB(0, H, ...OD);
    PB(0, H + 1, ...OD);
    if (fusing) {
      const sp = 1.4 + Math.random() * 0.8;
      PE(0, H + 2, sp * boost * 0.5, sp * boost * 0.4, 0.1);
    } else {
      const eyeY = Math.max(1, Math.round(H * 0.4));
      P(look - 1, eyeY, 0.05, 0.02, 0.02);
      P(look + 1, eyeY, 0.05, 0.02, 0.02);
    }
  } else if (e.kind === 'rootloper') {
    // --- Tanglewrist Root Loper: tendrils plant, body stretches, anchors panic ---
    const support = e.rootSupport ?? 0;
    const panic = (e.rootPanic ?? 0) > 0;
    const pull = Math.sin(frameCount * (panic ? 0.22 : 0.08) + e.bobPhase);
    const lean = clamp(Math.round(e.vx * 3), -3, 3);
    const bodyLift = Math.round(support * 2) - (panic ? 1 : 0);
    const R: RGB = panic ? [0.42, 0.28, 0.18] : [0.18, 0.46, 0.25];
    const RD: RGB = panic ? [0.22, 0.14, 0.1] : [0.08, 0.23, 0.12];
    const RL: RGB = [0.36, 0.78, 0.38];
    const lineRoot = (x0: number, y0: number, x1: number, y1: number, col: RGB, glow = false): void => {
      const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = Math.round(x0 + (x1 - x0) * t);
        const y = Math.round(y0 + (y1 - y0) * t);
        (glow ? PE : P)(x, y, ...col);
      }
    };
    for (let arm = 0; arm < 6; arm++) {
      const side = arm < 3 ? -1 : 1;
      const rank = arm % 3;
      const hipX = side * (2 + rank);
      const hipY = 5 + rank * 2 + bodyLift;
      const phase = frameCount * (panic ? 0.18 : 0.055) + e.bobPhase + arm * 1.7;
      const reach = 9 + rank * 3 + support * 5;
      const footX = side * reach + Math.round(Math.sin(phase) * (panic ? 4 : 2)) + lean;
      const footY = Math.max(0, hipY - 7 - rank + Math.round(Math.cos(phase) * (panic ? 3 : 1)));
      lineRoot(hipX + lean, hipY, Math.round((hipX + footX) * 0.5), Math.round((hipY + footY) * 0.5 + 2), RD);
      lineRoot(Math.round((hipX + footX) * 0.5), Math.round((hipY + footY) * 0.5 + 2), footX, footY, panic ? RD : RL);
      if (support > 0.45 && frameCount % 20 < 8) PE(footX, footY, 0.16, 0.65, 0.2);
    }
    const stretch = (e.windup ?? 0) > 0 ? 2 : Math.round(pull * 1.5);
    for (let dy = 3; dy <= 12; dy++) {
      const hw = dy < 7 ? 3 : 4;
      for (let dx = -hw; dx <= hw; dx++) {
        const edge = Math.abs(dx) === hw || dy === 3 || dy === 12;
        P(dx + lean + Math.round((dy - 8) * 0.18 * look) + stretch, dy + bodyLift, ...(edge ? RD : R));
      }
    }
    // Head and honest eyes, pulled toward the committed lash target while winding up.
    const headX = look * (4 + ((e.windup ?? 0) > 0 ? 2 : 0)) + lean + stretch;
    for (let dx = -2; dx <= 2; dx++) P(headX + dx, 13 + bodyLift, ...(Math.abs(dx) === 2 ? RD : R));
    PE(headX + look, 13 + bodyLift, 0.62, 0.95, 0.58);
    if ((e.windup ?? 0) > 0) {
      const lash = 1 - (e.windup ?? 0) / 13;
      const tx = e.rootLashX !== undefined ? e.rootLashX - e.x : look * 24;
      const ty = e.rootLashY !== undefined ? e.y - e.rootLashY : -2;
      const len = Math.hypot(tx, ty) || 1;
      const reach = 10 + lash * 18;
      const lx = Math.round((tx / len) * Math.min(reach, 30));
      const ly = Math.round(11 + bodyLift + (ty / len) * Math.min(reach, 22));
      lineRoot(headX, 11 + bodyLift, lx, ly + Math.round(Math.sin(frameCount * 0.5) * 1.5), [0.2, 0.95, 0.22], true);
    }
  } else if (e.kind === 'stonemaw') {
    // --- Stone Maw: pressure-wave worm, mouth plates open while chewing ---
    const dir = e.mawDir === -1 || e.mawDir === 1 ? e.mawDir : look;
    const chew = e.mawChewT ?? 0;
    const stunned = (e.mawStun ?? 0) > 0;
    const pulse = Math.sin(frameCount * (chew > 0 ? 0.28 : 0.08) + e.bobPhase);
    const S: RGB = stunned ? [0.28, 0.32, 0.34] : [0.42, 0.36, 0.32];
    const SD: RGB = [0.18, 0.16, 0.15];
    const SL: RGB = [0.58, 0.5, 0.42];
    for (let seg = 0; seg < 6; seg++) {
      const sx = -dir * (seg * 4 - 8);
      const sy = 5 + Math.round(Math.sin(seg * 0.9 + pulse) * (stunned ? 1 : 2));
      const radius = Math.max(2, 5 - Math.floor(seg * 0.45) + (chew > 0 && seg < 2 ? 1 : 0));
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const edge = dx * dx + dy * dy >= (radius - 1) * (radius - 1);
          P(sx + dx, sy + dy, ...(edge ? SD : S));
        }
      }
      if (seg > 0) P(sx + dir * 2, sy + 3, ...SL);
    }
    const mouthX = dir * 12;
    const gape = chew > 0 ? 3 : stunned ? 1 : 0;
    for (let k = 0; k <= 4; k++) {
      P(mouthX + dir * k, 7 + gape, ...SD);
      P(mouthX + dir * k, 3 - gape, ...SD);
    }
    if (chew > 0 && frameCount % 2 === 0) {
      PE(mouthX + dir * 6, 5, 0.7, 0.58, 0.35);
      PE(mouthX + dir * 8, 6, 0.45, 0.38, 0.25);
    }
  } else if (e.kind === 'rillback') {
    // --- Rillback Silt Eel: trailing linked body, stiff cyan charge pulse ---
    const wet = e.rillWet ?? 0;
    const charging = (e.rillChargeWindup ?? 0) > 0;
    const charged = charging || (e.blink ?? 0) > 0 || e.status.electrified > 0;
    const count = 7;
    if (!e.rillSegments || e.rillSegments.length !== count) {
      e.rillSegments = Array.from({ length: count }, (_, idx) => ({ x: e.x - look * idx * 3, y: e.y - 4 }));
    }
    e.rillSegments[0].x += (e.x - e.rillSegments[0].x) * 0.55;
    e.rillSegments[0].y += (e.y - 4 - e.rillSegments[0].y) * 0.55;
    for (let idx = 1; idx < count; idx++) {
      const prev = e.rillSegments[idx - 1];
      const seg = e.rillSegments[idx];
      const dx = prev.x - seg.x;
      const dy = prev.y - seg.y;
      const d = Math.hypot(dx, dy) || 1;
      const desired = wet >= 0.28 ? 3.8 : 2.8;
      seg.x += (dx / d) * (d - desired) * 0.45;
      seg.y += (dy / d) * (d - desired) * 0.45;
      if (wet >= 0.28) seg.y += Math.sin(frameCount * 0.18 + idx * 0.9 + e.bobPhase) * 0.12;
    }
    const A: RGB = wet >= 0.28 ? [0.12, 0.34, 0.36] : [0.18, 0.23, 0.22];
    const AD: RGB = [0.05, 0.16, 0.17];
    const AL: RGB = charged ? [0.2, 0.9, 1.1] : [0.2, 0.5, 0.5];
    for (let idx = count - 1; idx >= 0; idx--) {
      const seg = e.rillSegments[idx];
      const dx = Math.round(seg.x - bx);
      const dy = Math.round(by - seg.y);
      const r = idx === 0 ? 3 : Math.max(1, 3 - Math.floor(idx / 3));
      for (let yy = -r; yy <= r; yy++) {
        for (let xx = -r; xx <= r; xx++) {
          if (xx * xx + yy * yy > r * r) continue;
          P(dx + xx, dy + yy, ...(xx * xx + yy * yy >= (r - 1) * (r - 1) ? AD : A));
        }
      }
      if (charged && idx % 2 === 0) {
        const lift = charging ? Math.round(Math.sin(frameCount * 0.75 + idx) * 1.5) : 0;
        PE(dx, dy + 1 + lift, ...AL);
      }
    }
    const head = e.rillSegments[0];
    const hx = Math.round(head.x - bx);
    const hy = Math.round(by - head.y);
    PE(hx + look, hy + 1, charged ? 0.35 : 0.75, charged ? 0.9 : 0.85, charged ? 1.1 : 0.78);
    if (charging) {
      P(hx - look * 2, hy - 3, 0.16, 0.62, 0.92);
      P(hx, hy - 4, 0.2, 0.82, 1.1);
      P(hx + look * 2, hy - 3, 0.16, 0.62, 0.92);
    }
    if ((e.windup ?? 0) > 0 || (e.swoop ?? 0) > 0) {
      P(hx + look * 3, hy, 0.8, 0.86, 0.78);
      P(hx + look * 4, hy - 1, 0.8, 0.86, 0.78);
    }
  } else if (e.kind === 'weaver') {
    // --- Weaver: draws the tick-owned surface-crawler rig ---
    // Locomotion (entities/weaverLocomotion) owns the body pose, orientation
    // and the load-bearing feet at tick rate; this branch is pure presentation
    // (constrained IK through the rig parts, the sprung head, attack poses,
    // glow). It decides nothing about where feet grip, and gameplay reads
    // nothing it writes.
    const loco = e.weaverLoco;
    const asleep = e.sleeping === true;
    const airborneNow = !asleep && (loco?.mode ?? 'attached') === 'airborne';
    const recovering = (loco?.recoverT ?? 0) > 0;
    const speedNow = loco?.speed ?? 0;
    const orient = loco?.orient ?? 0;
    const bodyFace = loco?.face ?? 1;
    const stride = loco?.stride ?? 0;
    const nX = loco?.nx ?? 0;
    const nY = loco?.ny ?? -1;
    const moving = !asleep && (airborneNow || speedNow > 0.08);
    const wallwork = !asleep && !airborneNow && Math.abs(orient) > 0.6; // on a wall/ceiling
    const unstable = !asleep && !airborneNow && (recovering || (e.weaverFallT ?? 0) > 10);
    const support = e.weaverSupport ?? 0.65;
    const poised = !asleep && (e.windup ?? 0) > 0;
    const weaving = !asleep && e.blink > 0;
    const cranky = !asleep && (e.cranky ?? 0) > 0;
    const pulse = Math.max(0, e.webPulse ?? 0) / 18;
    const feedCrouch = !asleep && (e.weaverFeedT ?? 0) > 0;
    const fallPose = airborneNow ? clamp((e.weaverFallT ?? 0) / 45, 0, 1) : 0;
    const aim = Math.sign(ctx.player.x - e.x || 1); // world-x aim for attack poses

    // REAR-UP REACH: pose smoothing for the grasping front leg + head crane
    // (the physical rise comes from the locomotion's 'rear' stance).
    const headYW = e.y - def.h * 0.5;
    const overhead = e.alerted && !asleep ? clamp((headYW - ctx.player.y) / 58, 0, 1) : 0;
    const nearX = e.alerted && !asleep ? clamp(1 - Math.abs(ctx.player.x - e.x) / 170, 0, 1) : 0;
    const reachTarget =
      unstable || airborneNow || feedCrouch || poised || weaving ? 0 : overhead * (0.35 + 0.65 * nearX);
    e.weaverReach = lerp(e.weaverReach ?? 0, reachTarget, 0.06);
    const reach01 = e.weaverReach ?? 0;
    // AGGRESSION: alerted + actually closing = lower, hungrier posture cues.
    const aggroTarget =
      e.alerted && moving && !feedCrouch && !unstable && !poised && !weaving && reach01 < 0.3
        ? clamp(0.45 + (cranky ? 0.55 : 0) + Math.min(0.35, speedNow * 0.4), 0, 1)
        : 0;
    e.weaverAggro = lerp(e.weaverAggro ?? 0, aggroTarget, aggroTarget > (e.weaverAggro ?? 0) ? 0.08 : 0.04);
    const aggro = e.weaverAggro ?? 0;

    // FREE HEAD: the cephalothorax is slung on a short neck and carried by a
    // light spring, so it TRACKS the alchemist, SCANS when unaware, LEADS the
    // crawl, and never simply snaps to the facing. Cosmetic only.
    const aware = e.alerted && !asleep;
    const headPdx = ctx.player.x - e.x;
    const headPdy = ctx.player.y - (e.y - def.h * 0.62);
    const trackX = aware ? clamp(headPdx / 52, -1, 1) : Math.sin(frameCount * 0.017 + e.bobPhase * 2.7) * 0.7;
    const trackY = aware ? clamp(-headPdy / 60, -1, 1.2) : Math.sin(frameCount * 0.012 + e.bobPhase * 1.3) * 0.4;
    const idleBob = Math.sin(frameCount * 0.05 + e.bobPhase) * (aware ? 0.5 : 0.3);
    const headTX = clamp(trackX * 3.6 + (loco?.vx ?? 0) * 1.4 + (aware ? 0 : bodyFace * 0.6), -5.5, 5.5);
    const headTY = clamp(trackY * 3.1 + reach01 * 2 + idleBob + (cranky ? Math.sin(frameCount * 0.4) * 0.5 : 0), -4, 4.5);
    const headStiff = cranky ? 0.27 : poised || weaving ? 0.34 : 0.18; // snappier when agitated/striking
    e.weaverHeadVX = (e.weaverHeadVX ?? 0) * 0.74 + (headTX - (e.weaverHeadX ?? 0)) * headStiff;
    e.weaverHeadVY = (e.weaverHeadVY ?? 0) * 0.74 + (headTY - (e.weaverHeadY ?? 0)) * headStiff;
    e.weaverHeadX = clamp((e.weaverHeadX ?? 0) + e.weaverHeadVX, -7, 7);
    e.weaverHeadY = clamp((e.weaverHeadY ?? 0) + e.weaverHeadVY, -5, 6);
    const headDX = asleep ? 0 : Math.round(e.weaverHeadX ?? 0);
    const headDY = asleep ? -1 : Math.round(e.weaverHeadY ?? 0);

    // One reused traceLine plot callback + ambient colour/glow, so each leg
    // segment doesn't allocate a fresh closure every frame.
    let lineCol: RGB = [0, 0, 0];
    let lineGlow = false;
    const plotLine = (px: number, py: number): void => {
      const dx = px - bx;
      const dy = by - py;
      if (lineGlow) PE(dx, dy, lineCol[0], lineCol[1], lineCol[2]);
      else P(dx, dy, lineCol[0], lineCol[1], lineCol[2]);
    };
    const lineW = (x0: number, y0: number, x1: number, y1: number, col: RGB, glow = false): void => {
      lineCol = col;
      lineGlow = glow;
      traceLine(x0, y0, x1, y1, plotLine);
    };
    const dotW = (x: number, y: number, col: RGB, glow = false): void => {
      const dx = Math.round(x) - bx;
      const dy = by - Math.round(y);
      if (glow) PE(dx, dy, col[0], col[1], col[2]);
      else P(dx, dy, col[0], col[1], col[2]);
    };
    const rigReady = weaverRigReady();
    const rigLight = { r: bR, g: bG, b: bB };

    const LEG: RGB = unstable ? [0.2, 0.08, 0.1] : [0.13, 0.09, 0.11];
    const LEG_HI: RGB = [
      0.24 + support * 0.08 + pulse * 0.08,
      0.2 + support * 0.12 + pulse * 0.25,
      0.18 + pulse * 0.05,
    ];
    const LEG_MID: RGB = [
      0.18 + support * 0.06 + pulse * 0.05,
      0.14 + support * 0.1 + pulse * 0.16,
      0.13 + pulse * 0.04,
    ];
    const JOINT: RGB = [0.28 + pulse * 0.08, 0.23 + support * 0.12 + pulse * 0.18, 0.2];
    const LEG_WARN: RGB = [0.35, 0.95, 0.42];
    const PLANT_DOT: RGB = [0.32, 0.62, 0.26];
    // --- BODY ORIENTATION comes straight from the locomotion (0 floor, ±π/2
    // wall, π ceiling — the chimney straddle is pinned upright at tick rate).
    // Rotation is rigid about the body centre (WV_PIVOT above the anchor), so
    // on flat ground every offset is identity — zero change.
    const cosO = Math.cos(orient);
    const sinO = Math.sin(orient);
    const WV_PIVOT = 9;
    // body-local (dx right, dyUp up; origin at the foot anchor) -> P()'s local
    // frame, rotated about the body centre.
    const wvOff = (dx: number, dyUp: number): [number, number] => {
      const ly = dyUp - WV_PIVOT;
      return [dx * cosO - ly * sinO, WV_PIVOT + (dx * sinO + ly * cosO)];
    };
    const PR = (dx: number, dyUp: number, r: number, g: number, b: number): void => {
      const [lx, lyUp] = wvOff(dx, dyUp);
      P(Math.round(lx), Math.round(lyUp), r, g, b);
    };
    const PER = (dx: number, dyUp: number, r: number, g: number, b: number): void => {
      const [lx, lyUp] = wvOff(dx, dyUp);
      PE(Math.round(lx), Math.round(lyUp), r, g, b);
    };
    // world position of a body-local point (head/spit origin).
    const wvWorld = (dx: number, dyUp: number): [number, number] => {
      const [lx, lyUp] = wvOff(dx, dyUp);
      return [e.x + lx, e.y - lyUp];
    };
    const basisOrigin = wvWorld(0, 0);
    const basisRight = wvWorld(1, 0);
    const basisUp = wvWorld(0, 1);
    const legBasisX = { x: basisRight[0] - basisOrigin[0], y: basisRight[1] - basisOrigin[1] };
    const legBasisY = { x: basisUp[0] - basisOrigin[0], y: basisUp[1] - basisOrigin[1] };
    const rigLegOptions = { light: rigLight, flash, boost, flipX: false, alpha: 1 };
    const rigJointAOptions = { light: rigLight, flash, boost, flipX: false, alpha: 1 };
    const rigJointBOptions = { light: rigLight, flash, boost, flipX: false, alpha: 1 };
    const attackLeg = 4; // positive-arc legs always point toward the head
    let strainSum = 0;
    for (let i = 0; i < WEAVER_LOCO_REST.length; i++) {
      const rest = WEAVER_LOCO_REST[i];
      const leg = loco ? loco.legs[i] : undefined;
      const hip = loco
        ? weaverHipWorld(loco, i)
        : { x: e.x + rest.hipArc * bodyFace, y: e.y - rest.hipOut };
      const hipX = hip.x;
      const hipY = hip.y - Math.sin(frameCount * 0.03 + i) * 0.4; // breathing
      const hot = poised && i === attackLeg;
      const grasping = !hot && reach01 > 0.5 && i === attackLeg;
      const silkLeg = weaving && i === attackLeg + 1;
      // tick-owned foot; the 0..1 swing phase lifts along the surface normal
      const liftCells = (leg?.lift ?? 0) * (3.3 + speedNow * 1.5);
      let footX = leg ? leg.x + nX * liftCells : e.x + rest.arc * 0.6 * bodyFace;
      let footY = leg ? leg.y + nY * liftCells : e.y;
      if (hot) {
        // Needle Step: the poised foreleg aims at the locked target
        const aimT = 1 - clamp((e.windup ?? 0) / 18, 0, 1);
        footX = (e.needleX ?? ctx.player.x) - aim * (4 - aimT * 8);
        footY = e.needleY ?? ctx.player.y - 9;
      } else if (silkLeg) {
        // Thread-spit: the second foreleg braces high while silk streams
        footX = e.x + aim * 17;
        footY = e.y - 14;
      } else if (grasping) {
        // Rear-up: the front leg paws up toward the hovering alchemist,
        // clamped to the leg's real reach so the bones stay connected.
        let rx = ctx.player.x - aim * 3;
        let ry = ctx.player.y + 2;
        const rd = Math.hypot(rx - hipX, ry - hipY) || 1;
        const maxR = WEAVER_LEG_REACH_LOCO[i] * 1.24;
        if (rd > maxR) {
          rx = hipX + ((rx - hipX) / rd) * maxR;
          ry = hipY + ((ry - hipY) / rd) * maxR;
        }
        footX = rx;
        footY = ry;
      }
      const planted = leg?.planted === true && !hot && !silkLeg && !grasping;
      const strain = leg?.strain ?? 0.4;
      strainSum += strain;
      const searching =
        !asleep && !airborneNow && leg !== undefined && !leg.planted && leg.stepT < 0 && !hot && !silkLeg && !grasping;
      // warn-glow means "this leg can find no grip" — never a planted leg at
      // full stretch (strain rides ~1.0 right before every re-step)
      const failing = searching;
      // --- Animator-style constrained IK: target envelope + pole vector + flex
      // limits, damped between frames — shared rig discipline (ConstrainedLegIk).
      const sideLocal = Math.sign(rest.arc) * bodyFace || 1;
      const Lnat = WEAVER_LEG_REACH_LOCO[i] * (hot ? 1.05 : grasping ? 1.2 : failing ? 1.08 : 1);
      // long femur, tapering tibia/tarsus: the reference silhouette
      const L1 = Lnat * 0.4;
      const L2 = Lnat * 0.34;
      const L3 = Lnat * 0.26;
      const chainReach = L1 + L2 + L3;
      const sideNear = chainReach * 0.06;
      const sideFar = chainReach * (hot || grasping ? 0.9 : wallwork ? 0.84 : 0.82);
      const downReach = chainReach * (airborneNow ? 0.9 : unstable ? 0.72 : 0.62);
      const upReach = chainReach * (hot || grasping ? 0.52 : wallwork ? 0.42 : 0.3);
      const envelope = {
        basisX: legBasisX,
        basisY: legBasisY,
        minX: sideLocal < 0 ? -sideFar : sideNear,
        maxX: sideLocal < 0 ? -sideNear : sideFar,
        minY: -downReach,
        maxY: upReach,
        minRadius: chainReach * 0.16,
        maxRadius: chainReach * (hot || failing ? 0.91 : 0.86),
      };
      // knees arch HIGH above the back (the towering-legs read): the pole
      // points mostly UP so the generous chain slack is spent on knee height
      const poleOut = hot ? 0.64 : wallwork ? 0.6 : 0.5;
      const poleUp = hot ? 0.5 : wallwork ? 0.85 : 1.0;
      const pole = {
        x: legBasisX.x * sideLocal * poleOut + legBasisY.x * poleUp,
        y: legBasisX.y * sideLocal * poleOut + legBasisY.y * poleUp,
      };
      const ik = solveConstrainedLegIk({
        hip: { x: hipX, y: hipY },
        target: { x: footX, y: footY },
        lengths: [L1, L2, L3],
        pole,
        envelope,
        limits: {
          maxExtension: hot || grasping ? 0.92 : failing ? 0.9 : 0.87,
          minFlex: hot ? 0.2 : failing ? 0.24 : 0.3,
          maxFlex: unstable ? 2.6 : 2.55,
          maxAngularStep: wallwork ? 0.36 : cranky ? 0.4 : unstable ? 0.34 : 0.28,
          // tall tented knees: spend the chain slack on arch height
          archScale: hot || grasping ? 1.1 : wallwork ? 1.55 : 2.0,
        },
        previous: leg?.ik,
        iterations: 5,
      });
      if (leg) leg.ik = ik.state;
      const upperX = ik.upper.x,
        upperY = ik.upper.y;
      const lowerX = ik.lower.x,
        lowerY = ik.lower.y;
      const ikFootX = ik.foot.x,
        ikFootY = ik.foot.y;
      const jointDot = (x: number, y: number, col: RGB, glow = false): void => {
        dotW(x, y, col, glow);
        dotW(x + sideLocal, y, col, glow);
        dotW(x, y + 1, col, glow);
      };
      if (rigReady) {
        const legAlpha = hot || failing ? 0.9 : 1;
        const flipLeg = sideLocal < 0;
        rigLegOptions.flipX = flipLeg;
        rigLegOptions.alpha = legAlpha;
        drawWeaverRigSegment(s, weaverUpperLegPart(i), hipX, hipY, upperX, upperY, rigLegOptions);
        drawWeaverRigSegment(s, weaverLowerLegPart(i), upperX, upperY, lowerX, lowerY, rigLegOptions);
        drawWeaverRigSegment(s, weaverFootPart(i), lowerX, lowerY, ikFootX, ikFootY, rigLegOptions);
        const jointAngle = Math.atan2(lowerY - upperY, lowerX - upperX) + Math.PI * 0.5;
        rigJointAOptions.flipX = flipLeg;
        rigJointAOptions.alpha = legAlpha * 0.82;
        drawWeaverRigPart(s, 'jointCap', upperX, upperY, jointAngle, rigJointAOptions);
        rigJointBOptions.flipX = flipLeg;
        rigJointBOptions.alpha = legAlpha * 0.72;
        drawWeaverRigPart(s, 'jointCap', lowerX, lowerY, jointAngle, rigJointBOptions);
      }
      if (!rigReady || hot || failing) {
        lineW(hipX, hipY, upperX, upperY, hot || failing ? LEG_WARN : LEG, hot || failing);
        lineW(upperX, upperY, lowerX, lowerY, hot || failing ? LEG_WARN : LEG_MID, hot || failing);
        lineW(lowerX, lowerY, ikFootX, ikFootY, hot || failing ? LEG_WARN : LEG_HI, hot || failing);
        jointDot(upperX, upperY, hot || failing ? LEG_WARN : JOINT, hot || failing);
        jointDot(lowerX, lowerY, hot || failing ? LEG_WARN : JOINT, hot || failing);
        dotW(ikFootX, ikFootY, hot || failing ? LEG_WARN : LEG_HI, hot || failing);
        if (!rigReady && planted && !failing && !hot && leg && leg.lift === 0) {
          dotW(ikFootX, ikFootY - 1, PLANT_DOT, true);
        }
      }
    }

    const avgStrain = strainSum / WEAVER_LOCO_REST.length;
    const BODY: RGB = asleep
      ? [0.1, 0.08, 0.09]
      : unstable || fallPose > 0.35
        ? [0.2, 0.09, 0.11]
        : [0.16, 0.11, 0.13];
    const BODY_D: RGB = asleep ? [0.04, 0.035, 0.045] : [0.07, 0.05, 0.06];
    const BODY_L: RGB = asleep ? [0.15, 0.12, 0.13] : [0.27, 0.21, 0.22];
    const bellyBob = asleep
      ? -1
      : Math.round(
          Math.sin(stride * (cranky ? 0.95 : 0.6) + e.bobPhase) * (moving ? (cranky ? 2 : 1) : 0.4) +
            Math.sin(frameCount * 0.17 + e.bobPhase) * fallPose,
        );
    const crouch = asleep ? -2 : poised ? -1 : (e.recoil ?? 0) > 0 ? 1 : recovering ? -2 : 0;
    const bodyJitter = cranky || unstable ? Math.round(Math.sin(frameCount * 0.45 + e.bobPhase) * pulse) : 0;
    const sag = Math.round(fallPose * 4 + avgStrain * 1.2);
    // The PHYSICAL ride height already carries stance (the locomotion squeezes
    // through tunnels, crouches to sleep, rears to reach) — the draw offset
    // only adds pose flavour around the true body centre.
    const bodyDrawLift = Math.round(-fallPose * 2.5 + reach01 * 2);
    const tiltShift = (_dy: number): number => bodyJitter;
    // PREDATORY STALK coil/lunge (driven by the AI's stalk wave).
    const stalk = asleep ? 0 : e.weaverStalk ?? 0; // -1 gather .. +1 lunge
    const stalkX = Math.round(stalk * bodyFace * 2.4);
    const stalkY = Math.round(Math.max(0, -stalk) * 1.7);
    // ORGANIC WALK: the heavy abdomen rocks a half-beat behind the legs.
    const gaitSway = moving ? Math.round(Math.sin(stride * 0.5 + e.bobPhase + 1.2) * (cranky ? 1.5 : 0.95)) : 0;
    const abX = Math.round(stalkX * 0.3) + gaitSway;
    const abY = Math.round(stalkY * 0.5);
    // FREE HEAD: a cephalon slung ahead of the thorax on a short flexible neck.
    const neckBaseX = bodyFace * 4 + tiltShift(15) + stalkX;
    const neckTopY = 15 + crouch + bodyDrawLift - sag - stalkY;
    const headCX = bodyFace * 9 + headDX + tiltShift(15) + stalkX;
    const headCY = neckTopY + headDY;
    if (!rigReady) {
      // abdomen — drawn through PR so the whole body rotates onto the surface.
      for (let dy = 4; dy <= 13; dy++) {
        const t = (dy - 8.5) / 5.8;
        const w2 = Math.max(2, Math.round(10 * Math.sqrt(Math.max(0, 1 - t * t))));
        for (let dx = -w2; dx <= w2; dx++) {
          PR(
            dx - bodyFace * 3 + tiltShift(dy) + abX,
            dy + bellyBob + crouch + bodyDrawLift - sag - abY,
            Math.abs(dx) >= w2 ? BODY_D[0] : BODY[0],
            Math.abs(dx) >= w2 ? BODY_D[1] : BODY[1],
            Math.abs(dx) >= w2 ? BODY_D[2] : BODY[2],
          );
        }
      }
      // thorax and head
      for (let dy = 9; dy <= 17; dy++) {
        const w2 = dy >= 15 ? 5 : 7;
        for (let dx = -w2; dx <= w2; dx++) {
          PR(dx + bodyFace * 3 + tiltShift(dy) + stalkX, dy + crouch + bodyDrawLift - sag - stalkY, ...(Math.abs(dx) >= w2 ? BODY_D : BODY_L));
        }
      }
      for (let n = 1; n <= 2; n++) {
        const f = n / 3;
        const nx2 = neckBaseX + (headCX - neckBaseX) * f;
        const ny2 = neckTopY + (headCY - neckTopY) * f;
        PR(nx2, ny2, ...BODY);
        PR(nx2, ny2 - 1, ...BODY_D);
      }
      for (let hy = -2; hy <= 2; hy++) {
        const hw = Math.abs(hy) >= 2 ? 2 : 3;
        for (let hx = -hw; hx <= hw; hx++) {
          PR(headCX + hx, headCY + hy, ...(Math.abs(hx) >= hw || Math.abs(hy) >= 2 ? BODY_D : BODY_L));
        }
      }
    }
    if (rigReady) {
      const rigAngle = -orient;
      const rigFlip = bodyFace > 0;
      const bodyAlpha = asleep ? 0.78 : unstable || fallPose > 0.45 ? 0.9 : 0.98;
      const bodyRigOptions = { light: rigLight, flash, boost, flipX: rigFlip, alpha: bodyAlpha };
      const bodyDetailRigOptions = { light: rigLight, flash, boost, flipX: rigFlip, alpha: bodyAlpha * 0.92 };
      const mandibleARigOptions = { light: rigLight, flash, boost, flipX: rigFlip, alpha: bodyAlpha * 0.88 };
      const mandibleBRigOptions = { light: rigLight, flash, boost, flipX: rigFlip, alpha: bodyAlpha * 0.82 };
      let p = wvWorld(-bodyFace * 4 + abX, 9 + bellyBob + crouch + bodyDrawLift - sag - abY);
      drawWeaverRigPart(s, 'abdomen', p[0], p[1], rigAngle, bodyRigOptions);
      p = wvWorld(bodyFace * 3 + stalkX, 13 + crouch + bodyDrawLift - sag - stalkY);
      drawWeaverRigPart(s, 'thorax', p[0], p[1], rigAngle, bodyRigOptions);
      p = wvWorld(headCX, headCY);
      drawWeaverRigPart(s, 'head', p[0], p[1], rigAngle, bodyRigOptions);
      p = wvWorld(-bodyFace * 4 + abX, 18 + bodyDrawLift - sag - abY);
      drawWeaverRigPart(s, 'crystalSpine', p[0], p[1], rigAngle, bodyDetailRigOptions);
      p = wvWorld(-bodyFace * 17 + abX, 8 + bellyBob + crouch + bodyDrawLift - sag - abY);
      drawWeaverRigPart(s, 'spinnerets', p[0], p[1], rigAngle, bodyDetailRigOptions);
      p = wvWorld(headCX + bodyFace * 4, headCY - 1);
      drawWeaverRigPart(s, 'mandibleA', p[0], p[1], rigAngle + bodyFace * 0.18, mandibleARigOptions);
      p = wvWorld(headCX + bodyFace * 5, headCY + 1);
      drawWeaverRigPart(s, 'mandibleB', p[0], p[1], rigAngle - bodyFace * 0.16, mandibleBRigOptions);
    }
    const eyePulse = asleep
      ? 0.1
      : 0.55 + Math.sin(frameCount * 0.11 + e.bobPhase) * 0.25 + (poised ? 0.35 : 0) + (cranky ? 0.28 : 0) + pulse * 0.45 + aggro * 0.2;
    // a faint independent eye dart while unaware — the gaze flicks even when the head is still
    const dart = aware ? 0 : Math.round(Math.sin(frameCount * 0.08 + e.bobPhase * 2) * 0.7);
    PER(headCX + bodyFace * 2 + dart, headCY - 1, 0.18 * eyePulse * boost, 0.95 * eyePulse * boost, 0.32 * eyePulse * boost);
    PER(headCX + bodyFace * 1 + dart, headCY, 0.14 * eyePulse * boost, 0.72 * eyePulse * boost, 0.25 * eyePulse * boost);
    if (weaving) {
      const spit = 0.5 + Math.sin(frameCount * 0.6) * 0.3;
      const [sx0, sy0] = wvWorld(headCX + bodyFace * 2, headCY + 1);
      const [sx1, sy1] = wvWorld(headCX + bodyFace * 9, headCY + 3);
      if (rigReady) {
        const silkRigOptions = { light: rigLight, flash, boost, flipX: bodyFace < 0, alpha: 0.52 + spit * 0.35 };
        drawWeaverRigSegment(s, 'silk', sx0, sy0, sx1, sy1, silkRigOptions);
      }
      lineW(sx0, sy0, sx1, sy1, [0.18 * spit, 0.9 * spit, 0.24 * spit], true);
    }
  } else if (e.kind === 'golem') {
    // --- Heavy stride driven by real displacement, arms, breath, pulsing core ---
    const gx2 = e.x + (e.fx || 0);
    const grvRaw = gx2 - (e._px === undefined ? gx2 : e._px);
    const grv = Math.abs(grvRaw) > 8 ? 0 : grvRaw; // teleport = no stride pop
    e._px = gx2;
    e._svx = (e._svx || 0) * 0.55 + grv * 0.45;
    const walking = e.grounded && Math.abs(e._svx) > 0.08;
    if (walking) e.stride += Math.abs(e._svx) * 0.22;
    const st = e.stride;
    const legA = e.grounded ? Math.round(Math.sin(st) * 2) : 1;
    const legB = -legA;
    const legAy = Math.sin(st) > 0.6 ? 1 : 0;
    const legBy = Math.sin(st) < -0.6 ? 1 : 0;
    const bobG = walking ? -Math.round(Math.abs(Math.cos(st))) : 0;
    const breathe = !walking ? Math.round(Math.sin(frameCount * 0.03 + e.bobPhase)) : 0;
    const armSwing = Math.round(Math.sin(st + Math.PI) * 2);

    const S: RGB = [0.44, 0.44, 0.48], SD: RGB = [0.27, 0.27, 0.31], SL: RGB = [0.58, 0.58, 0.64];
    const B = bobG;

    // legs: two pillars striding
    for (let dy = 0; dy <= 5; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        P(dx - 3 + legA, dy + legAy, ...(dx === -1 ? SD : S));
        P(dx + 3 + legB, dy + legBy, ...(dx === 1 ? SD : S));
      }
    }
    // hips
    for (let dx = -4; dx <= 4; dx++) P(dx, 6 + B, ...S);
    // torso
    for (let dy = 7; dy <= 13; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        P(dx, dy + B, ...(Math.abs(dx) === 4 ? SD : S));
      }
    }
    // WALL POUND: wind-up then a two-fisted haymaker into the rock face —
    // the whole frame reads as work: lean, drawn fists, impact sparks
    const punch = e.punching ?? 0;
    if (punch > 0) {
      const windup = punch > 10; // first frames rear back, then SLAM
      const reach = windup ? -2 : 5;
      const lean = windup ? -1 : 1;
      for (let dy = 7; dy <= 11; dy++) {
        P(look * (6 + (windup ? 0 : 2)) , dy + B + lean, ...SD);
        P(-look * 5, dy + B - lean, ...SD);
      }
      // both fists thrown at wall height
      const fxp = look * (7 + reach);
      P(fxp, 8 + B, ...SL); P(fxp + look, 8 + B, ...SL);
      P(fxp, 9 + B, ...SL); P(fxp + look, 9 + B, ...SL);
      P(fxp, 10 + B, ...SL); P(fxp + look, 10 + B, ...SL);
      if (!windup && frameCount % 2 === 0) {
        // impact grit sparking off the knuckles
        PE(fxp + look * 2, 9 + B, 0.8, 0.7, 0.4);
        PE(fxp + look * 2, 7 + B, 0.5, 0.45, 0.25);
        PE(fxp + look * 2, 11 + B, 0.5, 0.45, 0.25);
      }
    } else {
      // arms swing opposite the legs
      for (let dy = 5; dy <= 12; dy++) {
        P(-6 - (dy <= 7 ? Math.round(armSwing * 0.6) : 0), dy + B, ...SD);
        P(-7, dy + B, ...(dy >= 11 ? SL : SD));
        P(6 + (dy <= 7 ? Math.round(armSwing * 0.6) : 0), dy + B, ...SD);
        P(7, dy + B, ...(dy >= 11 ? SL : SD));
      }
      // fists
      P(-7 - Math.round(armSwing * 0.6), 4 + B, ...SL); P(-6 - Math.round(armSwing * 0.6), 4 + B, ...SL);
      P(7 + Math.round(armSwing * 0.6), 4 + B, ...SL); P(6 + Math.round(armSwing * 0.6), 4 + B, ...SL);
    }
    // shoulders breathe
    for (let dx = -7; dx <= 7; dx++) P(dx, 14 + B + breathe, ...(Math.abs(dx) >= 6 ? SD : SL));
    // head, eyes track
    for (let dx = -2; dx <= 2; dx++) { P(dx + look, 17 + B, ...SD); P(dx + look, 16 + B, ...S); P(dx + look, 15 + B, ...S); }
    PE(look * 2 - 1, 16 + B, 0.95, 0.18, 0.08); PE(look * 2 + 1, 16 + B, 0.95, 0.18, 0.08);
    // glowing core, 2x2 with cross bleed
    const corePulse = (0.7 + Math.sin(frameCount * 0.12 + e.bobPhase) * 0.3) * boost * 0.45;
    PE(0, 10 + B, corePulse, corePulse * 0.8, corePulse * 0.15);
    PE(1, 10 + B, corePulse * 0.9, corePulse * 0.7, corePulse * 0.13);
    PE(0, 11 + B, corePulse * 0.9, corePulse * 0.7, corePulse * 0.13);
    PE(1, 11 + B, corePulse * 0.7, corePulse * 0.55, corePulse * 0.1);
    PE(2, 10 + B, corePulse * 0.4, corePulse * 0.3, 0.05);
    PE(0, 9 + B, corePulse * 0.4, corePulse * 0.3, 0.05);
    // thruster flames while the jets burn
    if (e.jetFuel > 0) {
      const jf = (1.2 + flickerNoise(frameCount, e.bobPhase * 7.7 + 5) * 0.8) * boost * 0.4;
      PE(-3 + legA, -1, jf, jf * 0.6, 0.1);
      PE(3 + legB, -1, jf, jf * 0.6, 0.1);
      PE(-3 + legA, -2, jf * 0.7, jf * 0.35, 0.05);
      PE(3 + legB, -2, jf * 0.7, jf * 0.35, 0.05);
    }
  } else if (e.kind === 'colossus') {
    // --- THE KILN COLOSSUS: a walking furnace of cracked basalt ---
    const cx2 = e.x + (e.fx || 0);
    const cdrvRaw = cx2 - (e._px === undefined ? cx2 : e._px);
    const cdrv = Math.abs(cdrvRaw) > 8 ? 0 : cdrvRaw; // teleport = no stride pop
    e._px = cx2;
    e._svx = (e._svx || 0) * 0.55 + cdrv * 0.45;
    const cWalking = e.grounded && Math.abs(e._svx) > 0.05;
    if (cWalking) e.stride += Math.abs(e._svx) * 0.16;
    const cst = e.stride;
    const cLegA = e.grounded ? Math.round(Math.sin(cst) * 3) : 1;
    const cLegB = -cLegA;
    const doused = e.status.wet > 0;
    // doused basalt runs dark; a healthy kiln glows from every crack
    const heat = doused ? 0.25 : 0.7 + Math.sin(frameCount * 0.09 + e.bobPhase) * 0.3;

    const R: RGB = [0.3, 0.26, 0.27], RD: RGB = [0.18, 0.15, 0.16], RL: RGB = [0.42, 0.36, 0.36];

    // legs: massive striding pillars
    for (let dy = 0; dy <= 7; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        P(dx - 6 + cLegA, dy, ...(dx === -2 ? RD : R));
        P(dx + 6 + cLegB, dy, ...(dx === 2 ? RD : R));
      }
    }
    // hips + torso slab
    for (let dx = -8; dx <= 8; dx++) P(dx, 8, ...R);
    for (let dy = 9; dy <= 19; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        P(dx, dy, ...(Math.abs(dx) >= 8 ? RD : R));
      }
    }
    // molten cracks: deterministic zig-zags that pulse with the furnace
    for (let k = 0; k < 5; k++) {
      const sxx = ((k * 37) % 15) - 7;
      for (let dy = 0; dy < 4; dy++) {
        const wob = (k + dy) % 2 === 0 ? 1 : 0;
        PE(sxx + wob, 10 + k + dy, heat * boost * 0.28, heat * boost * 0.12, 0.02);
      }
    }
    // arms: slabs ending in slam-fists
    const cArm = Math.round(Math.sin(cst + Math.PI) * 3);
    for (let dy = 6; dy <= 17; dy++) {
      P(-11 - (dy <= 9 ? Math.round(cArm * 0.6) : 0), dy, ...RD);
      P(-12, dy, ...(dy >= 15 ? RL : RD));
      P(11 + (dy <= 9 ? Math.round(cArm * 0.6) : 0), dy, ...RD);
      P(12, dy, ...(dy >= 15 ? RL : RD));
    }
    for (const fx2 of [-12, -11, 11, 12]) {
      P(fx2 - Math.sign(fx2) * Math.round(cArm * 0.4), 5, ...RL);
    }
    // shoulder ridge
    for (let dx = -11; dx <= 11; dx++) P(dx, 20, ...(Math.abs(dx) >= 9 ? RD : RL));
    // head: a squat kiln-mouth with twin white-hot eyes
    for (let dx = -3; dx <= 3; dx++) {
      P(dx + look, 23, ...RD);
      P(dx + look, 22, ...R);
      P(dx + look, 21, ...R);
    }
    PE(look * 2 - 2, 22, heat * boost * 0.5, heat * boost * 0.42, heat * 0.2);
    PE(look * 2 + 2, 22, heat * boost * 0.5, heat * boost * 0.42, heat * 0.2);
    // THE CORE: a 3x3 furnace heart — the thing water is for
    const cHeart = heat * boost * 0.55;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const fall = dx === 0 && dy === 0 ? 1 : 0.6;
        PE(dx, 14 + dy, cHeart * fall, cHeart * 0.75 * fall, cHeart * 0.16 * fall);
      }
    }
    // doused: steam wisps bleed off the slab
    if (doused && frameCount % 3 === 0) {
      P(((frameCount / 3) % 17) - 8, 20 + ((frameCount / 7) % 3), 0.7, 0.74, 0.78);
    }
  } else if (e.kind === 'leviathan') {
    // --- THE SUNKEN LEVIATHAN: an armored deep-fish with an angler's lamp ---
    const lx2 = e.x + (e.fx || 0);
    const ldrvRaw = lx2 - (e._px === undefined ? lx2 : e._px);
    const ldrv = Math.abs(ldrvRaw) > 8 ? 0 : ldrvRaw; // teleport = no stride pop
    e._px = lx2;
    e._svx = (e._svx || 0) * 0.6 + ldrv * 0.4;
    const dir = Math.abs(e._svx) > 0.05 ? Math.sign(e._svx) : look;
    const sub = e.submerged === true;
    // swimming undulates; beached flops in heaving spasms
    const swim = Math.sin(frameCount * (sub ? 0.12 : 0.3) + e.bobPhase);
    const flop = sub ? 0 : Math.round(Math.abs(swim) * 2);
    const coiled = (e.windup ?? 0) > 0;
    const A: RGB = [0.1, 0.3, 0.34], AD: RGB = [0.05, 0.18, 0.22], AL: RGB = [0.2, 0.46, 0.5];
    const BELLY: RGB = [0.5, 0.62, 0.6];

    // body: a long armored hull, dy 2..12, tapering toward the tail
    for (let dy = 2; dy <= 12; dy++) {
      const t = (dy - 7) / 5.5; // -1 top .. +1 (rows from spine)
      const w2 = Math.max(2, Math.round(9 * Math.sqrt(Math.max(0, 1 - t * t)))) - (coiled ? 1 : 0);
      for (let dx = -w2; dx <= w2; dx++) {
        const edge = Math.abs(dx) >= w2 - 0;
        const belly = dy <= 4;
        P(dx + (sub ? 0 : (frameCount % 19 < 9 ? flop : -flop)), dy, ...(edge ? AD : belly ? BELLY : A));
      }
    }
    // armor ridge plates along the spine
    for (let k = -7; k <= 7; k += 2) P(k, 12, ...AL);
    // dorsal spines
    for (const sx2 of [-5, -1, 3]) {
      P(sx2, 13, ...AD);
      P(sx2, 14, ...AL);
    }
    // tail fin at the rear, sweeping with the swim phase
    const tailY = Math.round(swim * (sub ? 3 : 1));
    for (let k = 0; k <= 3; k++) {
      P(-dir * (10 + k), 7 + tailY + (k % 2), ...AD);
      P(-dir * (10 + k), 9 + tailY - (k % 2), ...AD);
      P(-dir * (10 + k), 8 + tailY, ...A);
    }
    // pectoral fin
    P(dir * 2, 1 + (frameCount % 14 < 7 ? 0 : 1), ...AD);
    P(dir * 3, 1, ...AD);
    // jaw: shut while cruising, agape while coiled or mid-swoop
    const agape = coiled || (e.swoop ?? 0) > 0;
    for (let k = 0; k <= 2; k++) P(dir * (8 + k), agape ? 7 : 5, ...AD);
    if (agape) {
      for (let k = 0; k <= 2; k++) P(dir * (8 + k), 3, ...AD);
      P(dir * 8, 6, 0.85, 0.9, 0.88); // teeth glint
      P(dir * 9, 4, 0.85, 0.9, 0.88);
    }
    // the eye: a cold ember that locks on
    PE(dir * 5, 9, 0.95 * boost, 0.6 * boost, 0.18);
    // THE LURE: a stalk over the brow, bulb pulsing cyan — its own light
    const lure = 0.65 + Math.sin(frameCount * 0.07 + e.bobPhase) * 0.35;
    P(dir * 4, 13, ...AD);
    P(dir * 5, 14, ...AD);
    PE(dir * 6, 15, 0.25 * lure * boost, 0.85 * lure * boost, lure * boost);
    PE(dir * 7, 15, 0.18 * lure * boost, 0.6 * lure * boost, 0.8 * lure * boost);
    // beached: it leaks — dark water sweats off the hull
    if (!sub && frameCount % 4 === 0) {
      P(((frameCount / 4) % 15) - 7, 1, 0.3, 0.5, 0.62);
    }
  }

  // HP bar above damaged enemies
  if (e.hp < e.maxHp) {
    const barW = def.halfW * 2 + 5;
    const half = Math.floor(barW / 2);
    const fill = Math.max(0, Math.ceil((e.hp / e.maxHp) * barW));
    const by = e.y - def.h - 4;
    for (let i = 0; i < barW; i++) {
      const dx = i - half;
      if (i < fill) s.setPx(e.x + dx, by, 0.15, 0.95, 0.30);
      else s.setPx(e.x + dx, by, 0.30, 0.05, 0.05);
    }
  }
}

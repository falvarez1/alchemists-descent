import type { Ctx, Enemy, WeaverLegState } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { clamp, lerp, traceLine } from '@/core/math';
import { blocksEntity, isSoftGrowth } from '@/sim/CellType';

type RGB = readonly [number, number, number];

const WEAVER_REST = [
  // Eight legs FANNED front-to-back (feet spread along the ground, not bunched at one
  // far point) and pulled in a touch from the old daddy-long-legs splay, for a compact,
  // purposeful spider stance. Front legs reach forward & nearer, rear legs trail farther.
  { side: -1, hipX: -5, hipY: 16, footX: -28, footY: 2, phase: 0.0 },
  { side: -1, hipX: -8, hipY: 14, footX: -38, footY: -1, phase: Math.PI },
  { side: -1, hipX: -8, hipY: 11, footX: -45, footY: 2, phase: Math.PI * 0.5 },
  { side: -1, hipX: -5, hipY: 8, footX: -48, footY: 0, phase: Math.PI * 1.5 },
  { side: 1, hipX: 5, hipY: 16, footX: 28, footY: 2, phase: Math.PI },
  { side: 1, hipX: 8, hipY: 14, footX: 38, footY: -1, phase: 0.0 },
  { side: 1, hipX: 8, hipY: 11, footX: 45, footY: 2, phase: Math.PI * 1.5 },
  { side: 1, hipX: 5, hipY: 8, footX: 48, footY: 0, phase: Math.PI * 0.5 },
] as const;

// Natural reach per leg = the summed length of its three bones. Set well ABOVE the
// rest hip->foot span (×1.65) so the long legs carry real slack: the knee arches
// high above the leg line (the spider silhouette) across the whole gait range
// instead of locking straight. Precomputed once; the IK splits it femur/patella/tarsus.
const WEAVER_LEG_REACH = WEAVER_REST.map(
  (r) => Math.hypot(r.footX - r.hipX, r.footY - r.hipY) * 1.65,
);
const WEAVER_LEG_HARD_RESET = 1.28;

interface WeaverFootTarget {
  x: number;
  y: number;
  planted: boolean;
  strain: number;
  surface: NonNullable<WeaverLegState['surface']>;
}

function weaverCanFootOccupy(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  if (!w.inBounds(x, y)) return false;
  return !blocksEntity(w.types[w.idx(x, y)]);
}

function weaverFootStillSupported(ctx: Ctx, footX: number, footY: number): boolean {
  const w = ctx.world;
  const fx = Math.floor(footX);
  const fy = Math.floor(footY);
  for (let yy = fy - 2; yy <= fy + 2; yy++) {
    if (yy < 1 || yy >= w.height - 1) continue;
    for (let xx = fx - 2; xx <= fx + 2; xx++) {
      if (xx < 1 || xx >= w.width - 1) continue;
      const t = w.types[xx + yy * w.width];
      if (!blocksEntity(t) && !isSoftGrowth(t)) continue;
      const candidates = [
        [xx + 0.5, yy - 0.5],
        [xx - 0.5, yy + 0.15],
        [xx + 1.5, yy + 0.15],
        [xx + 0.5, yy + 1.5],
      ] as const;
      for (const [cx, cy] of candidates) {
        if (Math.hypot(cx - footX, cy - footY) < 2.8) return true;
      }
    }
  }
  return false;
}

function weaverFootTarget(
  ctx: Ctx,
  desiredX: number,
  desiredY: number,
  hipX: number,
  hipY: number,
  side: number,
  desperate: boolean,
  lifted = false,
): WeaverFootTarget {
  const w = ctx.world;
  const width = w.width;
  const height = w.height;
  if (lifted) {
    return {
      x: clamp(hipX + side * 3, 2, width - 3),
      y: clamp(hipY + (desperate ? 34 : 27), 3, height - 4),
      planted: false,
      strain: 1,
      surface: 'failed',
    };
  }
  const sx = Math.floor(clamp(desiredX, 2, width - 3));
  const sy = Math.floor(clamp(desiredY, 3, height - 4));
  // Desperate legs (footing cut away) sweep a much WIDER horizontal arc so a leg
  // over a hole can find the near/far rim and bridge it instead of giving up.
  const searchX = desperate ? 42 : 18;
  const searchUp = desperate ? 26 : 12;
  const searchDown = desperate ? 34 : 18;
  const maxReach = desperate ? 90 : 74;
  let best: WeaverFootTarget | null = null;
  let bestScore = Infinity;
  const addCandidate = (
    fx: number,
    fy: number,
    faceBias: number,
    clingBonus: number,
    surface: NonNullable<WeaverLegState['surface']>,
  ): void => {
    const hipDist = Math.hypot(fx - hipX, fy - hipY);
    if (hipDist > maxReach) return;
    const dx = fx - desiredX;
    const dy = fy - desiredY;
    const sidePenalty = Math.sign(fx - hipX || side) === side ? 0 : 16;
    const score = dx * dx + dy * dy * 1.35 + sidePenalty + faceBias - clingBonus;
    if (score >= bestScore) return;
    bestScore = score;
    best = { x: fx, y: fy, planted: true, strain: clamp(hipDist / maxReach, 0, 1), surface };
  };

  for (let yy = sy - searchUp; yy <= sy + searchDown; yy++) {
    if (yy < 1 || yy >= height - 1) continue;
    for (let xx = sx - searchX; xx <= sx + searchX; xx++) {
      if (xx < 1 || xx >= width - 1) continue;
      const t = w.types[xx + yy * width];
      if (!blocksEntity(t) && !isSoftGrowth(t)) continue;
      const clingBonus = isSoftGrowth(t) ? 4 : 0;
      if (weaverCanFootOccupy(ctx, xx, yy - 1)) addCandidate(xx + 0.5, yy - 0.5, 0, clingBonus, 'floor');
      if (weaverCanFootOccupy(ctx, xx - 1, yy)) addCandidate(xx - 0.5, yy + 0.15, 5, clingBonus, 'rightWall');
      if (weaverCanFootOccupy(ctx, xx + 1, yy)) addCandidate(xx + 1.5, yy + 0.15, 5, clingBonus, 'leftWall');
      if (weaverCanFootOccupy(ctx, xx, yy + 1)) addCandidate(xx + 0.5, yy + 1.5, 9, clingBonus, 'ceiling');
    }
  }
  if (best) return best;

  // Nothing near the DESIRED spot — sweep outward from the hip for the nearest
  // grippable surface within the leg's real reach. This is what lets a leg on the
  // open-air side of a wall (or under a ledge) reach BACK to the surface the body is
  // gripping instead of flailing into the void, and it never draws a leg across a
  // gap because the foothold it returns is genuinely within reach of the hip. It is
  // orientation-independent (pure nearest-surface), so it can't feed back into the
  // body's tilt. A truly airborne weaver finds no surface in reach and falls through
  // to the dangle below.
  const hxF = Math.floor(hipX);
  const hyF = Math.floor(hipY);
  for (let r = 5; r <= maxReach; r += 3) {
    let ringBest: WeaverFootTarget | null = null;
    let ringBestD = Infinity;
    const consider = (
      fx: number,
      fy: number,
      surface: NonNullable<WeaverLegState['surface']>,
    ): void => {
      const d = Math.hypot(fx - hipX, fy - hipY);
      if (d > maxReach || d >= ringBestD) return;
      ringBestD = d;
      ringBest = { x: fx, y: fy, planted: true, strain: clamp(d / maxReach, 0, 1), surface };
    };
    const steps = Math.max(10, Math.round(r * 1.1));
    for (let a = 0; a < steps; a++) {
      const ang = (a / steps) * Math.PI * 2;
      const xx = hxF + Math.round(Math.cos(ang) * r);
      const yy = hyF + Math.round(Math.sin(ang) * r);
      if (xx < 1 || xx >= width - 1 || yy < 1 || yy >= height - 1) continue;
      const t = w.types[xx + yy * width];
      if (!blocksEntity(t) && !isSoftGrowth(t)) continue;
      if (weaverCanFootOccupy(ctx, xx, yy - 1)) consider(xx + 0.5, yy - 0.5, 'floor');
      if (weaverCanFootOccupy(ctx, xx - 1, yy)) consider(xx - 0.5, yy + 0.15, 'rightWall');
      if (weaverCanFootOccupy(ctx, xx + 1, yy)) consider(xx + 1.5, yy + 0.15, 'leftWall');
      if (weaverCanFootOccupy(ctx, xx, yy + 1)) consider(xx + 0.5, yy + 1.5, 'ceiling');
    }
    if (ringBest) return ringBest;
  }

  // No purchase anywhere in reach: pull the foot UP toward the hip into a
  // raised, feeling-for-grip pose (not a dead limb sagging into a hole — see the
  // footing-recovery note). Lifted/held bodies return the hanging target above.
  const reachOut = desperate ? 8 : 5;
  const tuckUp = desperate ? 9 : 6;
  return {
    x: clamp(hipX + side * reachOut, 2, width - 3),
    y: clamp(hipY + tuckUp, 3, height - 4),
    planted: false,
    strain: 1,
    surface: 'failed',
  };
}

function resetWeaverLegToTarget(
  leg: WeaverLegState,
  target: WeaverFootTarget,
  hipX: number,
  hipY: number,
  maxReach: number,
): void {
  const dx = target.x - hipX;
  const dy = target.y - hipY;
  const dist = Math.hypot(dx, dy);
  const targetInReach = dist <= maxReach || dist <= 0.001;
  const x = targetInReach ? target.x : hipX + (dx / dist) * maxReach;
  const y = targetInReach ? target.y : hipY + (dy / dist) * maxReach;
  leg.x = x;
  leg.y = y;
  leg.tx = x;
  leg.ty = y;
  leg.fromX = undefined;
  leg.fromY = undefined;
  leg.step = undefined;
  leg.lift = 0;
  leg.smoothTx = x;
  leg.smoothTy = y;
  leg.planted = target.planted && targetInReach;
  leg.surface = leg.planted ? target.surface : 'failed';
  leg.strain = leg.planted ? target.strain : 1;
  leg.failT = leg.planted ? 0 : Math.max(1, leg.failT ?? 0);
  leg.plantAge = leg.planted ? 1 : 0;
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
  const bx = conv ? e.x + ((Math.random() * 5) | 0) - 2 : e.x;
  const by = conv ? e.y + ((Math.random() * 3) | 0) - 1 : e.y;
  const P = (dx: number, dy: number, r: number, g: number, b: number): void => {
    if (flash) s.setPx(bx + dx, by - dy, 2.2, 2.2, 2.2);
    else s.setPx(bx + dx, by - dy, r * bR, g * bG, b * bB);
  };
  const PE = (dx: number, dy: number, r: number, g: number, b: number): void => {
    if (flash) s.setPx(bx + dx, by - dy, 2.2, 2.2, 2.2);
    else s.setPx(bx + dx, by - dy, r, g, b);
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
    if (e.blink > 0) e.blink--; else if (Math.random() < 0.008) e.blink = 6;

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
    const flick = 0.85 + Math.random() * 0.45;
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
    const eb = 1.3 + Math.random() * 0.5;
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
    const flick = 0.8 + Math.random() * 0.35 + Math.sin(frameCount * 0.23 + e.bobPhase) * 0.12;
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
      (channeling ? 1.6 + Math.random() * 0.6 : 0.55 + Math.sin(frameCount * 0.09 + e.bobPhase) * 0.18) *
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
    const tumbling = (e.tumble ?? 0) > 0;
    const hover =
      Math.round(Math.sin(e.bobPhase) * 1.2) +
      (tumbling ? Math.round((Math.random() - 0.5) * 2) : 0);
    const Q = (dx: number, dy: number, r: number, g: number, b: number): void =>
      P(dx, dy + hover, r, g, b);
    const V: RGB = [0.36, 0.22, 0.46],
      VD: RGB = [0.2, 0.11, 0.27];
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
    const ef = 0.8 + Math.random() * 0.5;
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
  } else if (e.kind === 'weaver') {
    // --- Weaver: eight long IK legs with renderer-owned planted feet ---
    const wx2 = e.x + (e.fx || 0);
    const wdrv = wx2 - (e._px === undefined ? wx2 : e._px);
    e._px = wx2;
    e._svx = (e._svx || 0) * 0.6 + wdrv * 0.4;
    const asleep = e.sleeping === true;
    // Lifted off any surface: legs with no foothold dangle DOWN instead of
    // tucking up toward the hip. Debug-dragged bodies force that hanging target
    // even if a wall/ceiling is within reach, so posing a Weaver does not glue
    // its feet to old surfaces.
    const lifted = !asleep && e.grounded === false;
    const debugHeld = !asleep && ctx.debug?.dragRef === e;
    const debugDangle = debugHeld && lifted;
    const moving = !asleep && e.grounded && (Math.abs(e._svx) > 0.035 || e.alerted);
    const face = Math.abs(e._svx) > 0.05 ? Math.sign(e._svx) : look;
    const support = e.weaverSupport ?? 0.65;
    const poised = !asleep && (e.windup ?? 0) > 0;
    const weaving = !asleep && e.blink > 0;
    const cranky = !asleep && (e.cranky ?? 0) > 0;
    // A committed wall climb is DELIBERATE, not a scramble — even though clinging reads
    // as low physical support. Excluding it from `unstable` gives the climb the calm,
    // measured leg animation (no jitter, no oversized flail) instead of the distress wobble.
    const climbingNow = !asleep && (e.weaverClimbT ?? 0) > 0;
    // Visual instability tracks REAL footing loss (physical support / fall timer),
    // not the growth-confidence `support` — bare stone reads as a calm, planted
    // stance, while cut-away terrain reads as the scrambling wobble.
    const unstable = !asleep && !climbingNow && ((e.weaverPhysicalSupport ?? 0.6) < 0.32 || (e.weaverFallT ?? 0) > 10);
    const pulse = Math.max(0, e.webPulse ?? 0) / 18;
    const feedCrouch = !asleep && (e.weaverFeedT ?? 0) > 0;
    const supportPanic = clamp((e.weaverFallT ?? 0) / 45, 0, 1);
    const priorVisualSupport = e.weaverVisualSupport ?? 1;
    // REAR-UP REACH: an alerted Weaver with the alchemist hovering OVERHEAD rises
    // on its back legs and reaches up. Gated to a nearby target (so it doesn't
    // rear at someone across the room) and to a STABLE stance (footing first).
    const headY = e.y - def.h * 0.5;
    const overhead = e.alerted && !asleep ? clamp((headY - ctx.player.y) / 58, 0, 1) : 0;
    const nearX = e.alerted && !asleep ? clamp(1 - Math.abs(ctx.player.x - e.x) / 170, 0, 1) : 0;
    const reachTarget = unstable || feedCrouch || poised || weaving || lifted ? 0 : overhead * (0.35 + 0.65 * nearX);
    e.weaverReach = lerp(e.weaverReach ?? 0, reachTarget, 0.06);
    const reach01 = e.weaverReach ?? 0;
    // AGGRESSION: alerted + actually pursuing (moving, not feeding/rearing/falling)
    // swaps the calm tetrapod walk for a fast, low, lunging rippled chase. Cranky
    // pegs it to full; it snaps on quicker than it eases off.
    const aggroTarget =
      e.alerted && moving && !feedCrouch && !unstable && !poised && !weaving && !lifted && reach01 < 0.3
        ? clamp(0.45 + (cranky ? 0.55 : 0) + Math.min(0.35, Math.abs(e._svx) * 0.5), 0, 1)
        : 0;
    e.weaverAggro = lerp(e.weaverAggro ?? 0, aggroTarget, aggroTarget > (e.weaverAggro ?? 0) ? 0.08 : 0.04);
    const aggro = e.weaverAggro ?? 0;
    if (moving) e.stride += Math.max(0.015, Math.abs(e._svx) * 0.2) * (1 + aggro * 0.85);
    const REAR_BONUS = 12; // extra body lift at a full overhead reach (rears tall)
    const bodyLiftTarget =
      (lifted
        ? 3 // held/airborne: the body relaxes low so the legs hang below it
        : asleep
        ? 1
        : feedCrouch
          ? 2
          : poised || weaving
            ? 7
            : unstable
              ? 5
              : 13.5) + reach01 * REAR_BONUS - aggro * 3; // chase hugs the ground
    const supportedLiftTarget = bodyLiftTarget * (0.35 + priorVisualSupport * 0.65) - supportPanic * 7.5;
    e.weaverBodyLift = lerp(e.weaverBodyLift ?? supportedLiftTarget, supportedLiftTarget, 0.07);
    const bodyLift = e.weaverBodyLift ?? bodyLiftTarget;

    // FREE HEAD: the cephalothorax is slung on a short neck and carried by a light
    // spring, so it turns to TRACK the alchemist (horizontal sweep + pitch), SCANS
    // the room on a slow wander when unaware, LEADS the body as it walks, and never
    // simply snaps to the facing. Overshoot + settle reads as a living, craning head.
    const aware = e.alerted && !asleep;
    const headPdx = ctx.player.x - e.x;
    const headPdy = ctx.player.y - (e.y - def.h * 0.62);
    const trackX = aware ? clamp(headPdx / 52, -1, 1) : Math.sin(frameCount * 0.017 + e.bobPhase * 2.7) * 0.7;
    // pitch: render dy increases UPWARD, and an overhead alchemist sits at headPdy<0,
    // so the head must rise (positive) toward a target above — negate the screen delta.
    const trackY = aware ? clamp(-headPdy / 60, -1, 1.2) : Math.sin(frameCount * 0.012 + e.bobPhase * 1.3) * 0.4;
    const idleBob = Math.sin(frameCount * 0.05 + e.bobPhase) * (aware ? 0.5 : 0.3);
    const headTX = clamp(trackX * 3.6 + e._svx * 0.8 + (aware ? 0 : face * 0.6), -5.5, 5.5);
    const headTY = clamp(trackY * 3.1 + reach01 * 2 + idleBob + (cranky ? Math.sin(frameCount * 0.4) * 0.5 : 0), -4, 4.5);
    const headStiff = cranky ? 0.27 : poised || weaving ? 0.34 : 0.18; // snappier when agitated/striking
    e.weaverHeadVX = (e.weaverHeadVX ?? 0) * 0.74 + (headTX - (e.weaverHeadX ?? 0)) * headStiff;
    e.weaverHeadVY = (e.weaverHeadVY ?? 0) * 0.74 + (headTY - (e.weaverHeadY ?? 0)) * headStiff;
    e.weaverHeadX = clamp((e.weaverHeadX ?? 0) + e.weaverHeadVX, -7, 7);
    e.weaverHeadY = clamp((e.weaverHeadY ?? 0) + e.weaverHeadVY, -5, 6);
    const headDX = asleep ? 0 : Math.round(e.weaverHeadX ?? 0);
    const headDY = asleep ? -1 : Math.round(e.weaverHeadY ?? 0);

    if (!e.weaverLegs || e.weaverLegs.length !== WEAVER_REST.length) {
      e.weaverLegs = WEAVER_REST.map((r) => {
        const fx = e.x + r.footX;
        const target = weaverFootTarget(ctx, fx, e.y - r.footY, e.x + r.hipX, e.y - r.hipY, r.side, true);
        return {
          x: target.x,
          y: target.y,
          tx: target.x,
          ty: target.y,
          lift: 0,
          plantAge: 0,
          planted: target.planted,
          strain: target.strain,
          surface: target.surface,
          failT: target.planted ? 0 : 1,
          smoothTx: target.x,
          smoothTy: target.y,
          stepCooldown: 0,
        };
      });
    }

    // One reused traceLine plot callback + ambient colour/glow, so each leg
    // segment doesn't allocate a fresh closure every frame (8 legs x 2 segments
    // x every on-screen weaver, per frame). lineCol is set before every use.
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
    const attackLeg = face >= 0 ? 4 : 0;
    let plantedLegs = 0;
    let plantLoadSum = 0;
    let strainSum = 0;
    // --- BODY ORIENTATION: the whole creature rotates so its legs point at whatever
    // surface they grip. `orient` is last frame's smoothed angle (0 floor, +π/2 wall
    // on its right, −π/2 wall on its left, π ceiling); we place the hips & draw the
    // body through it this frame, then re-derive the target from THIS frame's planted
    // feet below. Rotation is rigid about the body centre (WV_PIVOT above the foot
    // anchor), so on flat ground (orient 0) every offset is identity — zero change.
    const orient = e.weaverOrient ?? 0;
    const cosO = Math.cos(orient);
    const sinO = Math.sin(orient);
    const WV_PIVOT = 9;
    // body-local (dx right, dyUp up; origin at the foot anchor) -> P()'s local frame,
    // rotated about the body centre.
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
    // world position of a body-local point (leg hips, head/spit origin).
    const wvWorld = (dx: number, dyUp: number): [number, number] => {
      const [lx, lyUp] = wvOff(dx, dyUp);
      return [e.x + lx, e.y - lyUp];
    };
    const bodyCX = e.x;
    const bodyCY = e.y - WV_PIVOT;
    // Weighted moments of the planted-foot cloud (world coords). Their covariance
    // gives the line the feet lie along (PCA) — the surface — whose normal is the
    // body's "up". This is far steadier than the mean foot direction: the feet splay
    // wide but sit only ~9 below the body, so a mean-direction normal swings on every
    // stride, whereas the line-fit normal stays put as long as the feet are coplanar.
    let fW = 0; // Σ weight
    let fSx = 0; // Σ w·x
    let fSy = 0; // Σ w·y
    let fSxx = 0; // Σ w·x²
    let fSyy = 0; // Σ w·y²
    let fSxy = 0; // Σ w·x·y
    for (let i = 0; i < WEAVER_REST.length; i++) {
      const rest = WEAVER_REST[i];
      const leg = e.weaverLegs[i] as WeaverLegState;
      const tetrapod = i === 0 || i === 2 || i === 5 || i === 7 ? 0 : Math.PI;
      // The calm walk's clean alternating tetrapod ramps into a fast front-to-back
      // RIPPLE as aggression rises (each leg lags its neighbour) — a frantic,
      // low predatory scuttle instead of a measured stride.
      const ripple = (i % 4) * 1.1; // staggered wave across each side
      // Even the CALM walk carries a little ripple so the eight legs cascade in a
      // metachronal wave instead of clapping down in two rigid tetrapod groups — reads
      // far more like a real spider flowing along than a wind-up toy.
      const pattern = lerp(tetrapod, ripple, Math.max(0.32, aggro));
      const cadence = (cranky ? 1.35 : unstable ? 1.08 : 1) * (1 + aggro * 0.6);
      const gait = e.stride * cadence + pattern + rest.phase * 0.08;
      leg.stepCooldown = Math.max(0, (leg.stepCooldown ?? 0) - 1);
      const swingGate = lerp(unstable ? 0.42 : 0.68, 0.32, aggro) - (cranky ? 0.04 : 0);
      const swing = moving && Math.sin(gait) > swingGate;
      const reachAmp = lerp(unstable ? 4.4 : 4.0, 5.6, aggro) + (cranky ? 0.4 : 0);
      const reach = moving
        ? Math.sin(gait) * reachAmp + face * lerp(2.2, 4.4, aggro) // lunges further forward
        : Math.sin(frameCount * 0.025 + i) * 0.8;
      let tx = e.x + rest.footX + reach;
      // Default footing target's surface is raycast lazily — only the branch that
      // actually plants on terrain pays for it (asleep/poised/weaving skip it).
      let ty = 0;
      const startStep = (
        nx: number,
        ny: number,
        lift: number,
        surface: NonNullable<WeaverLegState['surface']>,
        strain: number,
      ): void => {
        if ((leg.step ?? 0) > 0) return;
        leg.fromX = leg.x;
        leg.fromY = leg.y;
        leg.tx = nx;
        leg.ty = ny;
        leg.step = 0.001;
        leg.lift = lift;
        leg.plantAge = 0;
        leg.planted = false;
        leg.surface = surface;
        leg.strain = strain;
      };
      const dampTarget = (target: WeaverFootTarget, alpha: number): WeaverFootTarget => {
        leg.smoothTx = lerp(leg.smoothTx ?? target.x, target.x, alpha);
        leg.smoothTy = lerp(leg.smoothTy ?? target.y, target.y, alpha);
        return { ...target, x: leg.smoothTx, y: leg.smoothTy };
      };
      const hipUp =
        rest.hipY +
        bodyLift -
        Math.sin(frameCount * 0.03 + i) * 0.5 -
        (unstable ? Math.sin(frameCount * 0.37 + i) * 1.0 : 0);
      const [hipX, hipY] = wvWorld(rest.hipX, hipUp);
      if (asleep) {
        tx = e.x + rest.footX * 0.58;
        const target = dampTarget(weaverFootTarget(ctx, tx, e.y - 2 + Math.abs(rest.side) * 2, hipX, hipY, rest.side, false), 0.05);
        tx = target.x;
        ty = target.y;
        leg.step = undefined;
        leg.plantAge = 0;
        leg.planted = target.planted;
        leg.surface = target.surface;
        leg.strain = target.strain;
        leg.failT = target.planted ? Math.max(0, (leg.failT ?? 0) - 2) : (leg.failT ?? 0) + 1;
        leg.x += (tx - leg.x) * 0.08;
        leg.y += (ty - leg.y) * 0.08;
        leg.lift *= 0.45;
      } else if (poised && i === attackLeg) {
        const aimT = 1 - clamp((e.windup ?? 0) / 18, 0, 1);
        tx = (e.needleX ?? ctx.player.x) - face * (4 - aimT * 8);
        ty = e.needleY ?? ctx.player.y - 9;
        leg.step = undefined;
        leg.plantAge = 0;
        leg.planted = false;
        leg.surface = 'failed';
        leg.strain = 1;
        leg.failT = (leg.failT ?? 0) + 1;
        leg.x += (tx - leg.x) * 0.26;
        leg.y += (ty - leg.y) * 0.26;
        leg.lift = Math.max(leg.lift, 0.95);
      } else if (weaving && i === attackLeg + 1) {
        tx = e.x + face * 17;
        ty = e.y - 14;
        leg.step = undefined;
        leg.plantAge = 0;
        leg.planted = false;
        leg.surface = 'failed';
        leg.strain = 1;
        leg.failT = (leg.failT ?? 0) + 1;
        leg.x += (tx - leg.x) * 0.2;
        leg.y += (ty - leg.y) * 0.2;
        leg.lift = Math.max(leg.lift, 0.7);
      } else if (reach01 > 0.5 && i === attackLeg && Math.abs(e._svx) < 0.3) {
        // Reaching for the alchemist overhead: the front leg paws UP toward him,
        // clamped to the leg's real reach so the bones stay connected (not a calm
        // plant, not the green attack-leg either — a slow grasping feeler).
        let rx = ctx.player.x - face * 3;
        let ry = ctx.player.y + 2;
        const rd = Math.hypot(rx - hipX, ry - hipY) || 1;
        const maxR = WEAVER_LEG_REACH[i] * 0.95;
        if (rd > maxR) {
          rx = hipX + ((rx - hipX) / rd) * maxR;
          ry = hipY + ((ry - hipY) / rd) * maxR;
        }
        tx = rx;
        ty = ry;
        leg.step = undefined;
        leg.plantAge = 0;
        leg.planted = false;
        leg.surface = 'failed';
        leg.strain = 0.6;
        leg.failT = 0; // a deliberate reach, not a distressed search
        leg.x += (rx - leg.x) * 0.1;
        leg.y += (ry - leg.y) * 0.1;
        leg.lift = Math.max(leg.lift, 0.55);
      } else {
        let footLocalX = rest.footX + reach;
        if (unstable) footLocalX += Math.sin(frameCount * 0.19 + i * 1.7) * 2.6;
        // Climbing: reach for footholds ON the gripped surface — rotate the desired foot
        // into the body frame so the legs spread ALONG the wall and grip TOWARD it,
        // instead of half of them splaying into the open air beside it (the clumsy climb).
        // Safe from the orientation feedback loop: a climb's orientation is AI-driven
        // (climbDir), not derived from the feet, so moving the targets can't spin it.
        const [dfx, dfy] = climbingNow ? wvWorld(footLocalX, rest.footY) : [e.x + footLocalX, e.y - rest.footY];
        const rawTarget = weaverFootTarget(ctx, dfx, dfy, hipX, hipY, rest.side, unstable || (e.weaverFallT ?? 0) > 18, debugDangle);
        const hardResetReach = WEAVER_LEG_REACH[i] * WEAVER_LEG_HARD_RESET;
        const staleSpan = Math.hypot(leg.x - hipX, leg.y - hipY);
        if (
          !Number.isFinite(leg.x) ||
          !Number.isFinite(leg.y) ||
          !Number.isFinite(staleSpan) ||
          staleSpan > hardResetReach
        ) {
          resetWeaverLegToTarget(leg, rawTarget, hipX, hipY, WEAVER_LEG_REACH[i]);
        }
        const hipLoad = Math.hypot(hipX - leg.x, hipY - leg.y) / WEAVER_LEG_REACH[i];
        // A foot stretched past the leg's real reach can't still be "supported" — it
        // must let go and re-step. Without this, a yanked/teleported/lifted body
        // drags a glued foot across the level on an impossibly long leg.
        const currentSupported = !debugDangle && leg.planted === true && hipLoad <= 1.12 && weaverFootStillSupported(ctx, leg.x, leg.y);
        const targetDelta = Math.hypot(rawTarget.x - leg.x, rawTarget.y - leg.y);
        if (currentSupported) {
          leg.surface = leg.surface === 'failed' ? rawTarget.surface : leg.surface;
          leg.strain = clamp(hipLoad, 0, 1);
          leg.failT = 0;
        }

        const minPlantAge = cranky ? 12 : unstable ? 10 : 24;
        const loadStep = hipLoad > (unstable ? 0.86 : 0.8);
        const driftStep = targetDelta > (unstable ? 26 : 36);
        const gaitStep = swing && targetDelta > (unstable ? 14 : 20);
        const shouldStep =
          rawTarget.planted &&
          (!currentSupported || ((leg.plantAge ?? 0) > minPlantAge && (loadStep || driftStep || gaitStep)));

        if (shouldStep) {
          const target = dampTarget(rawTarget, currentSupported ? 0.22 : 0.12);
          startStep(target.x, target.y, cranky ? 0.78 : unstable ? 0.88 : 0.62, target.surface, target.strain);
        } else if (currentSupported) {
          leg.smoothTx = leg.x;
          leg.smoothTy = leg.y;
          leg.lift *= 0.35;
          leg.plantAge = (leg.plantAge ?? 0) + 1;
        } else if (!rawTarget.planted) {
          // Reel the foot toward where it should hang: fast when it's far (a yank
          // or a big lift dragged the body off its old foothold), gentle when it's
          // just feeling around nearby. The damp tracks the same speed so the
          // smoothed target can't throttle the reel-in.
          const pull = clamp(targetDelta / 50, unstable ? 0.05 : 0.04, 0.34);
          const target = dampTarget(rawTarget, pull);
          const search = Math.sin(frameCount * 0.12 + i * 1.83) * (unstable ? 0.9 : 0.55);
          leg.step = undefined;
          leg.plantAge = 0;
          leg.planted = false;
          leg.surface = 'failed';
          leg.strain = 1;
          leg.failT = (leg.failT ?? 0) + 1;
          leg.x = lerp(leg.x, target.x + search, pull);
          leg.y = lerp(leg.y, target.y + Math.abs(search) * 0.2, pull);
          leg.lift *= 0.18;
        } else {
          const target = dampTarget(rawTarget, 0.08);
          startStep(target.x, target.y, cranky ? 0.78 : unstable ? 0.88 : 0.62, target.surface, target.strain);
        }
        if ((leg.step ?? 0) > 0) {
          const speed = cranky ? 0.13 : unstable ? 0.072 : 0.085;
          const step = Math.min(1, (leg.step ?? 0) + speed);
          const smooth = step * step * (3 - 2 * step);
          leg.x = (leg.fromX ?? leg.x) + (leg.tx - (leg.fromX ?? leg.x)) * smooth;
          leg.y = (leg.fromY ?? leg.y) + (leg.ty - (leg.fromY ?? leg.y)) * smooth;
          leg.lift = Math.sin(step * Math.PI) * (cranky ? 1.05 : unstable ? 1.15 : 0.9);
          leg.planted = false;
          leg.failT = (leg.failT ?? 0) + 1;
          leg.step = step >= 1 ? undefined : step;
          if (step >= 1) {
            leg.x = leg.tx;
            leg.y = leg.ty;
            leg.lift = 0;
            leg.plantAge = 1;
            leg.planted = true;
            leg.failT = 0;
            leg.stepCooldown = cranky ? 5 : unstable ? 4 : 10;
          }
        } else {
          leg.lift *= 0.35;
        }
      }

      const footX = leg.x;
      const footY = leg.y - leg.lift * (cranky ? 7.2 : unstable ? 8.0 : 5.5);
      const hot = poised && i === attackLeg;
      const searching = !leg.planted && (leg.step ?? 0) === undefined && (leg.failT ?? 0) > 6;
      const failing = searching || (leg.strain ?? 0) > 0.96;
      if (leg.planted) {
        const plantLoad = clamp(1 - Math.max(0, (leg.strain ?? 0) - 0.84) / 0.14, 0, 1);
        plantLoadSum += plantLoad;
        if (plantLoad > 0.25) plantedLegs++;
        // Orientation: feed this contact point into the foot-cloud moments. EVERY
        // planted foot votes, not just well-loaded ones — a wall-climbing leg is
        // stretched (low plantLoad) yet still marks where the surface lies. Floored
        // weight keeps stretched feet meaningful.
        const gw = Math.max(0.2, plantLoad);
        const fx = leg.x;
        const fy = leg.y;
        fW += gw;
        fSx += gw * fx;
        fSy += gw * fy;
        fSxx += gw * fx * fx;
        fSyy += gw * fy * fy;
        fSxy += gw * fx * fy;
      }
      strainSum += leg.strain ?? 0;
      // --- Real length-preserving IK: two joints (femur->patella->tarsus) of FIXED
      // bone length, so the long legs ARTICULATE instead of rubber-stretching.
      // FABRIK solves the joint chain from the fixed hip to the planted foot; the
      // joints are then reflected onto the "up" side of the hip->foot chord so the
      // elbow always rides high (the spider silhouette). Reflection is rigid, so it
      // preserves the bone lengths the solve just enforced.
      const Lnat = WEAVER_LEG_REACH[i] * (hot ? 1.05 : failing ? 1.08 : 1);
      const L1 = Lnat * 0.38;
      const L2 = Lnat * 0.32;
      const L3 = Lnat * 0.3;
      let j1x: number, j1y: number, j2x: number, j2y: number;
      const legSpanRaw = Math.hypot(footX - hipX, footY - hipY);
      const chainReach = L1 + L2 + L3;
      let ikFootX = footX;
      let ikFootY = footY;
      if (legSpanRaw > chainReach) {
        const ux = (footX - hipX) / (legSpanRaw || 1);
        const uy = (footY - hipY) / (legSpanRaw || 1);
        ikFootX = hipX + ux * chainReach;
        ikFootY = hipY + uy * chainReach;
      }
      const legSpan = Math.min(legSpanRaw, chainReach);
      if (legSpan >= L1 + L2 + L3) {
        // Foot beyond the leg's span: lay the bones straight toward it.
        const ux = (ikFootX - hipX) / (legSpan || 1);
        const uy = (ikFootY - hipY) / (legSpan || 1);
        j1x = hipX + ux * L1;
        j1y = hipY + uy * L1;
        j2x = j1x + ux * L2;
        j2y = j1y + uy * L2;
      } else {
        // Seed the knees raised & outward so the solve settles into the up-bent pose.
        j1x = hipX + (ikFootX - hipX) * 0.3 + rest.side * (Lnat * 0.17);
        j1y = Math.min(hipY, ikFootY) - Lnat * 0.34;
        j2x = hipX + (ikFootX - hipX) * 0.7 + rest.side * (Lnat * 0.04);
        j2y = ikFootY - Lnat * (failing ? 0.05 : 0.16);
        for (let it = 0; it < 4; it++) {
          // backward pass from the planted foot
          let vx = j2x - ikFootX, vy = j2y - ikFootY, d = Math.hypot(vx, vy) || 1;
          j2x = ikFootX + (vx / d) * L3; j2y = ikFootY + (vy / d) * L3;
          vx = j1x - j2x; vy = j1y - j2y; d = Math.hypot(vx, vy) || 1;
          j1x = j2x + (vx / d) * L2; j1y = j2y + (vy / d) * L2;
          // forward pass from the fixed hip
          vx = j1x - hipX; vy = j1y - hipY; d = Math.hypot(vx, vy) || 1;
          j1x = hipX + (vx / d) * L1; j1y = hipY + (vy / d) * L1;
          vx = j2x - j1x; vy = j2y - j1y; d = Math.hypot(vx, vy) || 1;
          j2x = j1x + (vx / d) * L2; j2y = j1y + (vy / d) * L2;
        }
      }
      // Force the elbow to the high side of the hip->foot chord (smaller y = up).
      {
        const cx = ikFootX - hipX, cy = ikFootY - hipY;
        const nn = cx * cx + cy * cy || 1;
        const f1 = (2 * (cx * (j1y - hipY) - cy * (j1x - hipX))) / nn;
        if (j1y - f1 * cx < j1y) {
          // reflecting the chain raises the upper joint -> mirror both joints
          j1x += f1 * cy; j1y -= f1 * cx;
          const f2 = (2 * (cx * (j2y - hipY) - cy * (j2x - hipX))) / nn;
          j2x += f2 * cy; j2y -= f2 * cx;
        }
      }
      const upperX = j1x, upperY = j1y;
      const lowerX = j2x, lowerY = j2y;
      const jointDot = (x: number, y: number, col: RGB, glow = false): void => {
        dotW(x, y, col, glow);
        dotW(x + rest.side, y, col, glow);
        dotW(x, y + 1, col, glow);
      };
      lineW(hipX, hipY, upperX, upperY, hot || failing ? LEG_WARN : LEG, hot || failing);
      lineW(upperX, upperY, lowerX, lowerY, hot || failing ? LEG_WARN : LEG_MID, hot || failing);
      lineW(lowerX, lowerY, ikFootX, ikFootY, hot || failing ? LEG_WARN : LEG_HI, hot || failing);
      jointDot(upperX, upperY, hot || failing ? LEG_WARN : JOINT, hot || failing);
      jointDot(lowerX, lowerY, hot || failing ? LEG_WARN : JOINT, hot || failing);
      dotW(ikFootX, ikFootY, hot || failing ? LEG_WARN : LEG_HI, hot || failing);
      if (leg.planted && !failing && !hot && (leg.plantAge ?? 0) === 1) dotW(ikFootX, ikFootY - 1, PLANT_DOT, true);
    }

    const plantSupport = plantLoadSum / WEAVER_REST.length;
    e.weaverVisualSupport = plantSupport;
    e.weaverVisualPlanted = plantedLegs;
    const avgStrain = strainSum / WEAVER_REST.length;
    const fallPose = clamp(Math.max(1 - plantSupport, (e.weaverFallT ?? 0) / 45), 0, 1);
    // Re-derive the body orientation from where the feet actually landed. θ aims the
    // legs at the gripped surface: 0 floor, +π/2 wall on its right, −π/2 wall on its
    // left, π ceiling — blending smoothly through corners.
    let targetOrient = 0;
    const climbDir = e.weaverClimbDir ?? 0;
    if (fW > 0.001) {
      const mx = fSx / fW;
      const my = fSy / fW;
      const offX = mx - bodyCX; // mean foot offset from the body centre
      const offY = my - bodyCY;
      // Covariance of the foot cloud → its principal axis is the surface tangent; the
      // perpendicular minor axis is the surface normal (thin for a real flat surface).
      const vxx = fSxx / fW - mx * mx;
      const vyy = fSyy / fW - my * my;
      const vxy = fSxy / fW - mx * my;
      const tr = vxx + vyy;
      const det = vxx * vyy - vxy * vxy;
      const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      const lMin = Math.max(0, tr / 2 - disc); // variance ACROSS the normal
      const tang = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
      const nx = -Math.sin(tang);
      const ny = Math.cos(tang);
      const proj = offX * nx + offY * ny; // body's offset from the foot cloud along the normal
      if (Math.abs(proj) < Math.sqrt(lMin) * 0.85) {
        // The body sits INSIDE the foot cloud along the normal — feet straddle it
        // (a chimney/tunnel with walls on BOTH sides). The normal's sign is genuinely
        // ambiguous, so PCA would flip the body ±90° every frame: the paused-spider
        // spasm. Pin it UPRIGHT — the one stable resolution, and it lets the spider
        // chimney straight up a tunnel instead of fighting which wall to face.
        targetOrient = 0;
      } else if ((e.weaverClimbT ?? 0) > 0 && climbDir !== 0) {
        // Scaling a single committed wall: square the body onto it (+x → +π/2).
        targetOrient = (climbDir * Math.PI) / 2;
      } else {
        // g = into the surface = the normal pointed TOWARD the feet (the surface side).
        const gx = proj >= 0 ? nx : -nx;
        const gy = proj >= 0 ? ny : -ny;
        targetOrient = Math.atan2(gx, gy); // 0 floor, ±π/2 wall, ±π ceiling
      }
    }
    let dOrient = targetOrient - orient;
    while (dOrient > Math.PI) dOrient -= Math.PI * 2;
    while (dOrient < -Math.PI) dOrient += Math.PI * 2;
    // ease in; quicker while actively moving so transitions over corners feel alive.
    let nextOrient = orient + dOrient * (asleep ? 0.05 : moving ? 0.2 : 0.12);
    // keep the stored angle in (−π, π] so it never spirals out of range over a long
    // chase (cos/sin don't care, but readers/probes and the wobble term stay sane).
    if (nextOrient > Math.PI) nextOrient -= Math.PI * 2;
    else if (nextOrient < -Math.PI) nextOrient += Math.PI * 2;
    e.weaverOrient = nextOrient;
    e.weaverTilt = e.weaverOrient; // kept for any external readers; now the true angle

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
        Math.sin(e.stride * (cranky ? 0.95 : 0.6) + e.bobPhase) * (moving ? (cranky ? 2 : 1) : 0.4) +
          Math.sin(frameCount * 0.17 + e.bobPhase) * fallPose,
      );
    const crouch = asleep ? -2 : poised ? -1 : (e.recoil ?? 0) > 0 ? 1 : unstable ? 0 : 0;
    const bodyJitter = cranky || unstable ? Math.round(Math.sin(frameCount * 0.45 + e.bobPhase) * pulse) : 0;
    const sag = Math.round(fallPose * 5 + avgStrain * 1.4);
    const bodyDrawLift = Math.round(bodyLift * (0.25 + plantSupport * 0.75) - fallPose * 2.5);
    // body lean is now a true rotation (e.weaverOrient, applied by PR/PER/wvWorld);
    // tiltShift only carries the agitated jitter shake so the silhouette still buzzes.
    const tiltShift = (_dy: number): number => bodyJitter;
    // PREDATORY STALK coil/lunge (driven by the AI's stalk wave): the cephalothorax
    // eases BACK to gather then drives FORWARD on the surge, dipping into the coil —
    // so the body visibly winds and springs with the paced approach.
    const stalk = asleep ? 0 : e.weaverStalk ?? 0; // -1 gather .. +1 lunge
    const stalkX = Math.round(stalk * face * 2.4);
    const stalkY = Math.round(Math.max(0, -stalk) * 1.7);
    // ORGANIC WALK: the heavy abdomen rocks side-to-side a half-beat behind the legs
    // instead of riding rigidly level — an articulated, weight-shifting gait.
    const gaitSway = moving ? Math.round(Math.sin(e.stride * 0.5 + e.bobPhase + 1.2) * (cranky ? 1.5 : 0.95)) : 0;
    const abX = Math.round(stalkX * 0.3) + gaitSway;
    const abY = Math.round(stalkY * 0.5);
    // abdomen — drawn through PR so the whole body rotates onto the gripped surface.
    for (let dy = 4; dy <= 13; dy++) {
      const t = (dy - 8.5) / 5.8;
      const w2 = Math.max(2, Math.round(10 * Math.sqrt(Math.max(0, 1 - t * t))));
      for (let dx = -w2; dx <= w2; dx++) {
        PR(
          dx - face * 3 + tiltShift(dy) + abX,
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
        PR(dx + face * 3 + tiltShift(dy) + stalkX, dy + crouch + bodyDrawLift - sag - stalkY, ...(Math.abs(dx) >= w2 ? BODY_D : BODY_L));
      }
    }
    // --- FREE HEAD: a cephalon slung ahead of the thorax on a short flexible neck,
    // carried by the head spring so it cranes, pitches and bobs as its own segment ---
    const neckBaseX = face * 4 + tiltShift(15) + stalkX;
    const neckTopY = 15 + crouch + bodyDrawLift - sag - stalkY;
    const headCX = face * 9 + headDX + tiltShift(15) + stalkX;
    const headCY = neckTopY + headDY;
    for (let n = 1; n <= 2; n++) {
      const f = n / 3;
      const nx = neckBaseX + (headCX - neckBaseX) * f;
      const ny = neckTopY + (headCY - neckTopY) * f;
      PR(nx, ny, ...BODY);
      PR(nx, ny - 1, ...BODY_D);
    }
    for (let hy = -2; hy <= 2; hy++) {
      const hw = Math.abs(hy) >= 2 ? 2 : 3;
      for (let hx = -hw; hx <= hw; hx++) {
        PR(headCX + hx, headCY + hy, ...(Math.abs(hx) >= hw || Math.abs(hy) >= 2 ? BODY_D : BODY_L));
      }
    }
    const eyePulse = asleep ? 0.1 : 0.55 + Math.sin(frameCount * 0.11 + e.bobPhase) * 0.25 + (poised ? 0.35 : 0) + (cranky ? 0.28 : 0) + pulse * 0.45;
    // a faint independent eye dart while unaware — the gaze flicks even when the head is still
    const dart = aware ? 0 : Math.round(Math.sin(frameCount * 0.08 + e.bobPhase * 2) * 0.7);
    PER(headCX + face * 2 + dart, headCY - 1, 0.18 * eyePulse * boost, 0.95 * eyePulse * boost, 0.32 * eyePulse * boost);
    PER(headCX + face * 1 + dart, headCY, 0.14 * eyePulse * boost, 0.72 * eyePulse * boost, 0.25 * eyePulse * boost);
    if (weaving) {
      const spit = 0.5 + Math.sin(frameCount * 0.6) * 0.3;
      const [sx0, sy0] = wvWorld(headCX + face * 2, headCY + 1);
      const [sx1, sy1] = wvWorld(headCX + face * 9, headCY + 3);
      lineW(sx0, sy0, sx1, sy1, [0.18 * spit, 0.9 * spit, 0.24 * spit], true);
    }
  } else if (e.kind === 'golem') {
    // --- Heavy stride driven by real displacement, arms, breath, pulsing core ---
    const gx2 = e.x + (e.fx || 0);
    const grv = gx2 - (e._px === undefined ? gx2 : e._px);
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
      const jf = (1.2 + Math.random() * 0.8) * boost * 0.4;
      PE(-3 + legA, -1, jf, jf * 0.6, 0.1);
      PE(3 + legB, -1, jf, jf * 0.6, 0.1);
      PE(-3 + legA, -2, jf * 0.7, jf * 0.35, 0.05);
      PE(3 + legB, -2, jf * 0.7, jf * 0.35, 0.05);
    }
  } else if (e.kind === 'colossus') {
    // --- THE KILN COLOSSUS: a walking furnace of cracked basalt ---
    const cx2 = e.x + (e.fx || 0);
    const cdrv = cx2 - (e._px === undefined ? cx2 : e._px);
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
    const ldrv = lx2 - (e._px === undefined ? lx2 : e._px);
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

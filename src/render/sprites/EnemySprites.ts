import type { Ctx, Enemy } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { clamp } from '@/core/math';

type RGB = readonly [number, number, number];

/**
 * Procedural enemy sprites (original drawEnemySprite): slime squash & stretch,
 * imp hover/flap/flicker, golem heavy stride with pulsing core.
 *
 * NOTE: this function intentionally MUTATES animation state on the enemy
 * (e.splat / e.prevG / e.blink for slimes; e._px / e._svx / e.stride for
 * golems) exactly like the original did from inside the renderer.
 */
export function drawEnemySprite(s: PixelSurface, light: LightField, ctx: Ctx, e: Enemy): void {
  const frameCount = ctx.state.frameCount;
  const def = ctx.enemyCtl.defs[e.kind];
  const flash = e.flash > 0;
  const boost = ctx.params.global.maxBrightness;
  // Creatures obey the light: a body in shadow is a silhouette, a body near
  // glowing material is revealed. Emissive parts (eyes, cores, flames) stay lit.
  const lt = light.sample(e.x, e.y - def.h * 0.5);
  const bR = e.kind === 'imp' ? 1 : Math.max(0.05, lt.r);
  const bG = e.kind === 'imp' ? 1 : Math.max(0.05, lt.g);
  const bB = e.kind === 'imp' ? 1 : Math.max(0.05, lt.b);
  const P = (dx: number, dy: number, r: number, g: number, b: number): void => {
    if (flash) s.setPx(e.x + dx, e.y - dy, 2.2, 2.2, 2.2);
    else s.setPx(e.x + dx, e.y - dy, r * bR, g * bG, b * bB);
  };
  const PE = (dx: number, dy: number, r: number, g: number, b: number): void => {
    if (flash) s.setPx(e.x + dx, e.y - dy, 2.2, 2.2, 2.2);
    else s.setPx(e.x + dx, e.y - dy, r, g, b);
  };
  const look = ctx.player.x > e.x ? 1 : -1;

  if (e.kind === 'slime') {
    // --- Squash & stretch: tall in flight, splat on landing, wobble at rest ---
    if (e.grounded && !e.prevG && Math.abs(e.vy) < 0.1) e.splat = 8;
    e.prevG = e.grounded;
    if (e.splat > 0) e.splat--;
    if (e.blink > 0) e.blink--; else if (Math.random() < 0.008) e.blink = 6;

    let sy = 1, sx = 1;
    if (!e.grounded) { sy = 1 + Math.min(0.45, Math.abs(e.vy) * 0.13); sx = 1 / sy; }
    else if (e.splat > 0) { sx = 1 + e.splat * 0.05; sy = 1 / sx; }
    else { const w = Math.sin(frameCount * 0.085 + e.bobPhase) * 0.07; sx = 1 + w; sy = 1 - w; }

    const G: RGB = [0.20, 0.78, 0.35], GD: RGB = [0.10, 0.45, 0.20], GL: RGB = [0.55, 1.0, 0.65];
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
    if (e.blink === 0) {
      const eyeY = Math.max(1, Math.round(H * 0.4));
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
    // arms swing opposite the legs
    for (let dy = 5; dy <= 12; dy++) {
      const sw = dy <= 7 ? armSwing : Math.round(armSwing * 0.5);
      P(-6 + (dy <= 7 ? -sw : 0) * 0 - (dy <= 7 ? Math.round(armSwing * 0.6) : 0), dy + B, ...SD);
      P(-7, dy + B, ...(dy >= 11 ? SL : SD));
      P(6 + (dy <= 7 ? Math.round(armSwing * 0.6) : 0), dy + B, ...SD);
      P(7, dy + B, ...(dy >= 11 ? SL : SD));
    }
    // fists
    P(-7 - Math.round(armSwing * 0.6), 4 + B, ...SL); P(-6 - Math.round(armSwing * 0.6), 4 + B, ...SL);
    P(7 + Math.round(armSwing * 0.6), 4 + B, ...SL); P(6 + Math.round(armSwing * 0.6), 4 + B, ...SL);
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

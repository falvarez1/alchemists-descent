import type { Ctx, Enemy } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { clamp } from '@/core/math';

type RGB = readonly [number, number, number];

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
  const P = (dx: number, dy: number, r: number, g: number, b: number): void => {
    if (flash) s.setPx(e.x + dx, e.y - dy, 2.2, 2.2, 2.2);
    else s.setPx(e.x + dx, e.y - dy, r * bR, g * bG, b * bB);
  };
  const PE = (dx: number, dy: number, r: number, g: number, b: number): void => {
    if (flash) s.setPx(e.x + dx, e.y - dy, 2.2, 2.2, 2.2);
    else s.setPx(e.x + dx, e.y - dy, r, g, b);
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
        const sw = dy <= 7 ? armSwing : Math.round(armSwing * 0.5);
        P(-6 + (dy <= 7 ? -sw : 0) * 0 - (dy <= 7 ? Math.round(armSwing * 0.6) : 0), dy + B, ...SD);
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

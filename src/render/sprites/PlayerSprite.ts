import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { clamp } from '@/core/math';

type RGB = readonly [number, number, number];

/**
 * Crawl pose selector. 'prone' is the shipped low crawl (belly to the floor,
 * elbow-drag); 'allfours' is the retired hands-and-knees creep, kept intact
 * for a future verb (downed-crawl revive and heavy-landing recovery are the
 * leading candidates) — flip here to A/B both poses in dev.
 * The cast keeps TS from narrowing the const to its literal (the comparison
 * below must stay legal).
 */
const CRAWL_POSE = 'prone' as 'prone' | 'allfours';

/**
 * Procedural wizard sprite (original drawPlayerSprite): boots ride a stride
 * wheel, the robe sways and flares, the torso leans with smoothed velocity,
 * the 4-segment spring hat whips, and the wand glows toward the aim.
 *
 * The player is fully self-lit — the light field is not sampled here (the
 * parameter is kept for the shared sprite-drawing signature).
 */
export function drawPlayerSprite(out: PixelSurface, _light: LightField, ctx: Ctx): void {
  const player = ctx.player;
  const frameCount = ctx.state.frameCount;
  if (ctx.state.mode !== 'play' || player.dead) return;
  if (player.invuln > 0 && frameCount % 6 < 3) return;

  // Silhouette pass: every BODY pixel is recorded so a near-black rim can be
  // stamped around the finished figure (Noita/Dead Cells readability — the
  // character cuts against any background instead of dissolving into it).
  // The wand, charge meter, and tip glow draw after recording stops.
  const marks = new Set<number>();
  let recording = true;
  const s: PixelSurface = {
    setPx(x: number, y: number, r: number, g: number, b: number): void {
      if (recording) marks.add((Math.round(x) & 0xfff) | ((Math.round(y) & 0xfff) << 12));
      out.setPx(x, y, r, g, b);
    },
    addPx(x: number, y: number, r: number, g: number, b: number): void {
      out.addPx(x, y, r, g, b);
    },
  };

  const px = player.x, f = player.facing;
  // Value-contrast palette: edges run DARK (they read as outline from inside),
  // accents run bright, so the figure keeps its shape at 2-3 screen px/cell.
  const HAT: RGB = [0.62, 0.30, 0.94], HAT_D: RGB = [0.24, 0.09, 0.42], BAND: RGB = [1.0, 0.84, 0.25];
  const ROBE: RGB = [0.22, 0.50, 0.95], ROBE_D: RGB = [0.08, 0.16, 0.38], TRIM: RGB = [0.70, 0.85, 1.0];
  const SKIN: RGB = [0.95, 0.80, 0.62], SKIN_D: RGB = [0.78, 0.62, 0.46], BOOT: RGB = [0.10, 0.08, 0.14], BOOT_L: RGB = [0.30, 0.24, 0.34];
  const SHADE: RGB = [0.48, 0.38, 0.30]; // brim shadow across the brow

  const stampOutline = (): void => {
    recording = false;
    const feetY = player.y;
    for (const key of marks) {
      const mx = key & 0xfff;
      const my = (key >> 12) & 0xfff;
      // 4-neighbour rim; skip below the feet so the ground line stays clean
      for (let n = 0; n < 4; n++) {
        const nx = mx + (n === 0 ? 1 : n === 1 ? -1 : 0);
        const ny = my + (n === 2 ? 1 : n === 3 ? -1 : 0);
        if (ny > feetY) continue;
        if (marks.has((nx & 0xfff) | ((ny & 0xfff) << 12))) continue;
        out.setPx(nx, ny, 0.02, 0.03, 0.07);
      }
    }
  };

  const svx = player._svx || 0, svy = player._svy || 0;

  const row = (x0: number, x1: number, yy: number, c: RGB): void => {
    for (let xx = x0; xx <= x1; xx++) s.setPx(xx, yy, c[0], c[1], c[2]);
  };

  // --- The staff, drawn TIP-FIRST (shared by every pose that casts) ---
  // wandTip() is the gameplay muzzle (projectile spawn + light seed); the
  // shaft is laid backward from that exact point through the gripping hand,
  // so the glow always sits ON the staff's end — no more drifting apart.
  // The butt extends behind the grip to keep a constant ~11-cell Gandalf
  // length whatever the pose did to the hand position.
  // Swap: the staff sweeps a quadratically-eased draw arc up into the aim.
  // Recoil: a cast kicks the WHOLE staff back along the aim for a few frames.
  const drawStaff = (gripX: number, gripY: number): void => {
    const tipBase = ctx.spells.wandTip();
    const drawT = player.swapT > 0 ? player.swapT / 12 : 0;
    const a = Math.atan2(tipBase.y - gripY, tipBase.x - gripX) + drawT * drawT * 2.2 * f;
    const shaftLen = Math.max(4, Math.round(Math.hypot(tipBase.x - gripX, tipBase.y - gripY)));
    const buttLen = Math.max(2, 11 - shaftLen);
    const rec = player.recoilT > 0 ? (player.recoilT > 3 ? 2 : 1) : 0;
    const wsx = gripX - Math.cos(a) * rec;
    const wsy = gripY - Math.sin(a) * rec;
    // staff end (the recoiled, possibly mid-draw muzzle the visuals attach to)
    const endX = wsx + Math.cos(a) * shaftLen;
    const endY = wsy + Math.sin(a) * shaftLen;
    // One-sided drop shadow (underside only) — pops the shaft off the
    // background without the fattening of a full outline.
    const wandKeys = new Set<number>();
    const wandPx = (d: number, r: number, g: number, b: number): void => {
      const wx2 = wsx + Math.cos(a) * d;
      const wy2 = wsy + Math.sin(a) * d;
      wandKeys.add((Math.round(wx2) & 0xfff) | ((Math.round(wy2) & 0xfff) << 12));
      s.setPx(wx2, wy2, r, g, b);
    };
    for (let d = -buttLen; d <= shaftLen; d++) {
      if (d === 0) continue; // the hand owns this cell
      const t = (d + buttLen) / (shaftLen + buttLen); // dark butt -> bright head
      wandPx(d, 0.26 + 0.46 * t, 0.16 + 0.36 * t, 0.10 + 0.20 * t);
    }
    // the gripping hand sits over the shaft
    s.setPx(wsx, wsy, ...SKIN);
    for (const key of wandKeys) {
      const sx2 = key & 0xfff;
      const sy2 = ((key >> 12) & 0xfff) + 1;
      const skey = (sx2 & 0xfff) | ((sy2 & 0xfff) << 12);
      if (!wandKeys.has(skey) && !marks.has(skey)) out.setPx(sx2, sy2, 0.02, 0.03, 0.07);
    }
    if (player.swapT >= 5 && player.swapT <= 7) {
      // mid-draw gleam: the staff head catches the light as it comes up
      s.setPx(endX, endY, 1.0, 1.0, 0.85);
    }
    // Charged throw meter: dots march out along the aim as power builds
    const bombCharge = ctx.input.bombCharge;
    if (bombCharge >= 0) {
      const ca = player.aimAngle;
      const steps = Math.floor(bombCharge * 8 + 0.001);
      for (let k = 0; k < steps; k++) {
        const t = (k + 1) / 8;
        // meter dots march out PAST the staff tip (the shaft now owns 1..8)
        const ddx = gripX + Math.cos(ca) * (11 + k * 2.6);
        const ddy = gripY + Math.sin(ca) * (11 + k * 2.6);
        const bst = ctx.params.global.maxBrightness * (0.5 + bombCharge * 0.5);
        s.setPx(ddx, ddy, (0.7 + t * 0.8) * bst, (1.0 - t * 0.85) * bst, 0.06 * bst);
      }
    }

    // Tip glow stays dark through the first half of a draw — the staff isn't
    // up yet, so the muzzle has nothing to say. It rides the VISUAL staff end
    // (recoil and all); projectiles still spawn at the wandTip contract point.
    if (player.swapT <= 6) {
      const boost = ctx.params.global.maxBrightness;
      // At rest the tip smolders instead of flaring — the constant bloom halo
      // was washing the character's silhouette out. Full brightness returns
      // the moment the trigger is down.
      const pulse = (0.8 + Math.sin(frameCount * 0.3) * 0.2) * (player.firing ? 1 : 0.55);
      s.setPx(endX, endY, 0.5 * boost * pulse, 0.9 * boost * pulse, 1.0 * boost * pulse);
      if (player.firing && frameCount % 4 < 2) {
        s.setPx(endX + Math.cos(a), endY + Math.sin(a), 0.9 * boost, 0.95 * boost, 1.0 * boost);
        s.setPx(endX + Math.cos(a) * 2, endY + Math.sin(a) * 2, 0.6 * boost, 0.7 * boost, 0.8 * boost);
      }
    }
  };

  // ---- CRAWL pose (docs/CRAWL.md). The collision box stays an axis-aligned
  // 9x9; only the DRAWING tilts — the figure lays along the smoothed travel
  // slope (quantized to ~16 steps), so a diagonal chute reads as diagonal
  // crawling. CRAWL_POSE (module top) picks prone vs the retired all-fours.
  if (player.crawling) {
    const ease = clamp(player.crawlT / 10, 0, 1);
    const settle = Math.round((1 - ease) * 5); // dropping down flat
    const q = Math.round(player.crawlSlope * 8) / 8;
    const stride = player.stridePhase;
    const hat = player.hat;
    const py = player.y;
    const cu = (u: number): number => px + u * f;
    const cy = (u: number, up: number): number => py - up - settle + Math.round(q * u * f);
    // ceiling at exactly crawl gauge: not even the head gets to come up
    const lowCeiling = !ctx.physics.entityFree(player.x, player.y, 4, 10);

    if (CRAWL_POSE === 'allfours') {
      // RESERVED hands-and-knees creep (the original crawl pose) — see the
      // CRAWL_POSE note. Kept verbatim so its future verb inherits it whole.
      // rear leg: boot pads down, knee tucked under the hip
      s.setPx(cu(-4), cy(-4, 0), ...BOOT);
      s.setPx(cu(-3), cy(-3, 0), ...BOOT);
      s.setPx(cu(-3), cy(-3, 1), ...BOOT_L);
      s.setPx(cu(-2), cy(-2, 0), ...BOOT_L);

      // robe arched over the back, trailing edge dark
      for (let u = -3; u <= 2; u++) {
        const top = u <= -2 ? 3 : 4;
        for (let up = 1; up <= top; up++) {
          const c = up === top || u === -3 ? ROBE_D : ROBE;
          s.setPx(cu(u), cy(u, up), ...c);
        }
      }
      s.setPx(cu(-1), cy(-1, 2), ...BAND); // belt glint low on the belly
      s.setPx(cu(1), cy(1, 3), ...TRIM); // chest trim

      // hand-over-hand keyed to the stride wheel (real x-progress)
      const reach = Math.round(Math.sin(stride) * 1.2);
      const lift = Math.abs(Math.sin(stride)) > 0.7 ? 1 : 0;
      s.setPx(cu(3), cy(3, 1), ...SKIN_D); // forearm
      s.setPx(cu(4 + reach), cy(4 + reach, reach > 0 ? lift : 0), ...SKIN);
      s.setPx(cu(4 - reach), cy(4 - reach, reach < 0 ? lift : 0), ...SKIN_D);

      // head leading: face block, brow shaded under the brim
      for (let up = 2; up <= 4; up++) {
        s.setPx(cu(3), cy(3, up), ...(up === 4 ? SHADE : SKIN_D));
        s.setPx(cu(4), cy(4, up), ...(up === 4 ? SHADE : SKIN));
      }
      if (player.blinkTimer === 0) {
        s.setPx(cu(4), cy(4, 3), 1.0, 1.0, 1.0);
        s.setPx(cu(3), cy(3, 3), 0.08, 0.08, 0.12);
      }

      // the hat rides pushed back — and presses FLAT when the ceiling says so
      for (let u = 1; u <= 4; u++) {
        s.setPx(cu(u), cy(u, 5), ...(u === 1 || u === 4 ? HAT_D : HAT));
      }
      s.setPx(cu(3), cy(3, 5), ...BAND);
      const coneUp = lowCeiling ? 5 : 6;
      s.setPx(cu(0), cy(0, coneUp), ...HAT);
      s.setPx(cu(-1), cy(-1, coneUp), ...HAT);
      s.setPx(
        cu(-2) + Math.round(hat.ox * 0.6),
        cy(-2, coneUp) + (lowCeiling ? 0 : Math.round(hat.oy * 0.5)),
        ...HAT_D,
      );

      stampOutline();
      drawStaff(cu(2), cy(2, 2));
      return;
    }

    // ---- PRONE low crawl: the 17-tall wizard laid out FULL LENGTH — the
    // sprite spans ~17 cells nose to toes (conservation of mass; the 9x9
    // box is collision law, the drawing overflows it just like the standing
    // hat does). A wedge silhouette: flat trailing legs, two-cell torso,
    // humped shoulders, the head leading. Only the head leaves the ground —
    // and under a gauge-tight ceiling not even that (cheek pressed to the
    // floor is the CRAMPED tell).
    const headUp = lowCeiling ? 0 : 1; // how far he dares lift his chin

    // nose-to-the-rock: probe the chin row ahead and scrunch the head group
    // back at a dead end instead of burying the face in the wall
    let front = 9;
    for (let u = 4; u <= 8; u++) {
      if (ctx.physics.cellBlocks(Math.round(cu(u)), py - 1 + Math.round(q * u * f))) {
        front = u;
        break;
      }
    }
    const scrunch = clamp(7 - front, 0, 2);
    const hu = (u: number): number => u - scrunch; // head-group slide

    // legs trail straight back, toes down; the push-leg shoves on the
    // stride's back-beat, its knee cocking a pixel above the hemline
    const push = Math.sin(stride + Math.PI);
    const kick = push < -0.55 ? 1 : 0;
    s.setPx(cu(-8 + kick), cy(-8 + kick, 0), ...BOOT); // trailing toe drags
    s.setPx(cu(-7 + kick), cy(-7 + kick, 0), ...BOOT_L);
    s.setPx(cu(-7), cy(-7, push > 0.55 ? 1 : 0), ...BOOT); // push-knee cocks

    // the robe is ONE continuous bright mass that thickens tail-to-chest —
    // 1 cell over the calves, 2 over the hips, 3 at the chest/shoulders —
    // so the silhouette reads as a wedge of wizard, not a plank
    for (let u = -6; u <= 3; u++) {
      s.setPx(cu(u), cy(u, 0), ...(u === -6 ? ROBE_D : ROBE));
      if (u >= -4) s.setPx(cu(u), cy(u, 1), ...(u === -4 ? ROBE_D : ROBE));
      if (u >= 0) s.setPx(cu(u), cy(u, 2), ...(u === 0 ? ROBE_D : ROBE));
    }
    s.setPx(cu(-3), cy(-3, 1), ...BAND); // belt glint where the hips rise
    s.setPx(cu(2), cy(2, 2), ...TRIM); // chest trim behind the head

    // head low and leading, chin skimming the floor — cheek-flat when CRAMPED
    for (let u = 4; u <= 6; u++) {
      for (let up = headUp; up <= headUp + 1; up++) {
        s.setPx(cu(hu(u)), cy(hu(u), up), ...(u === 4 ? SKIN_D : SKIN));
      }
    }
    if (player.blinkTimer === 0) {
      s.setPx(cu(hu(5)), cy(hu(5), headUp + 1), 1.0, 1.0, 1.0);
      s.setPx(cu(hu(6)), cy(hu(6), headUp + 1), 0.08, 0.08, 0.12);
    }

    // the hat CROWNS the skull (it does not carpet the spine): a dark brim
    // lip over the eyes, the band glint, a short cone trailing onto the
    // shoulders, the tip riding the spring
    const hatUp = headUp + 2;
    s.setPx(cu(hu(6)), cy(hu(6), hatUp), ...HAT_D); // brim over the eyes
    s.setPx(cu(hu(5)), cy(hu(5), hatUp), ...HAT_D);
    s.setPx(cu(hu(4)), cy(hu(4), hatUp), ...BAND);
    s.setPx(cu(hu(3)), cy(hu(3), hatUp), ...HAT);
    s.setPx(cu(hu(2)), cy(hu(2), hatUp), ...HAT);
    s.setPx(
      cu(hu(1)) + Math.round(hat.ox * 0.6),
      cy(hu(1), hatUp) + (lowCeiling ? 0 : Math.round(hat.oy * 0.5)),
      ...HAT_D,
    ); // tip wags with the spring

    // arms LAST — the near-side arm crosses in front of the body. Elbow-drag
    // keyed to the stride wheel: the lead hand reaches out and rakes back
    // along the floor; the pulling elbow pops above the back on the power
    // stroke (never under a gauge-tight ceiling)
    const reach = Math.round(Math.sin(stride) * 1.5);
    const elbowUp = !lowCeiling && Math.sin(stride) < -0.2 ? 3 : 2;
    s.setPx(cu(3), cy(3, elbowUp), ...SKIN_D); // crooked elbow
    s.setPx(cu(hu(4)), cy(hu(4), 0), ...SKIN_D); // forearm flat on the floor
    s.setPx(cu(hu(5)), cy(hu(5), 0), ...SKIN_D);
    const handU = Math.min(6 + reach - scrunch, front - 1);
    s.setPx(cu(handU), cy(handU, 0), ...SKIN); // lead hand pulls

    stampOutline();
    drawStaff(cu(hu(5)), cy(hu(5), headUp)); // prone grip: muzzle rides low
    return;
  }

  // ---- WALL CLIMB / WALL GRAB pose (bouldering). Keyed climbing is a
  // first-class verb; the older lip-grab still borrows the same silhouette.
  // Both hands find holds, feet brace, and the body moves in visible
  // catch -> brace -> reach -> pull -> step -> settle beats.
  if (
    player.climbing ||
    (
      player.wallGrabT >= 5 &&
      player.grounded &&
      Math.abs(svx) < 0.6 &&
      player.pullT === 0 &&
      player.recharge === 0
    )
  ) {
    const wd = player.climbing ? player.climbDir : player.wallGrabDir;
    const movingClimb = player.climbing && player.climbIntentY !== 0;
    const phase = player.climbing
      ? (player.climbPhase + player.climbMoveT) % 24
      : (Math.floor(frameCount / 50) % 2) * 12;
    const beat = Math.floor(phase / 4) % 6;
    const up = player.climbIntentY < 0;
    const bodyBob = movingClimb
      ? up
        ? beat < 2 ? 1 : beat < 5 ? 0 : -1
        : beat < 2 ? -1 : beat < 5 ? 0 : 1
      : 0;
    const py = player.y + bodyBob;
    const hat = player.hat;
    // hands and feet trade holds across the six-beat bouldering cycle
    const shift = beat >= 2 && beat <= 4 ? 1 : 0;
    const reach = movingClimb && beat === 2 ? (up ? 2 : -1) : 0;
    const pull = movingClimb && beat === 3 ? (up ? 1 : -1) : 0;
    const step = movingClimb && beat >= 4 ? (up ? 1 : -1) : 0;

    // feet: one toe on the lip, the other jammed into the face higher up
    s.setPx(px + wd * 3, py, ...BOOT);
    s.setPx(px + wd * 2, py, ...BOOT);
    s.setPx(px + wd * 2, py - 1, ...BOOT_L);
    s.setPx(px + wd * 3, py - 4 - step, ...BOOT);
    s.setPx(px + wd * 2, py - 4 - step, ...BOOT_L);

    // bent legs holding the hips off the rock
    s.setPx(px + wd, py - 2, ...ROBE_D);
    s.setPx(px + wd, py - 5 - Math.max(0, step), ...ROBE_D);

    // the skirt hangs PLUMB off the hips — gravity owns it, not the stride
    for (const [dy, hw] of [[3, 3], [4, 3], [5, 2], [6, 2]] as const) {
      for (let dx = -hw; dx <= hw; dx++) {
        const edge = Math.abs(dx) === hw;
        s.setPx(px - wd + dx, py - dy, ...(edge ? ROBE_D : ROBE));
      }
    }

    // torso pressed in toward the face
    for (let dy = 7; dy <= 10; dy++) {
      const shiftX = dy >= 9 ? wd : 0;
      for (let dx = -2; dx <= 2; dx++) {
        const c = dx === 0 ? TRIM : Math.abs(dx) === 2 ? ROBE_D : ROBE;
        s.setPx(px + shiftX + dx, py - dy, ...c);
      }
    }
    row(px + wd - 2, px + wd + 2, py - 11, ROBE); // shoulders

    // both arms up the wall: a high lock-off and a mid hold, trading places
    s.setPx(px + wd * 2, py - 12 - pull, ...ROBE_D);
    s.setPx(px + wd * 3, py - 13 + shift - reach, ...ROBE_D);
    s.setPx(px + wd * 4, py - 14 + shift - reach, ...SKIN);
    s.setPx(px + wd * 3, py - 11 - shift + pull, ...ROBE_D);
    s.setPx(px + wd * 4, py - 10 - shift + pull, ...SKIN_D);

    // head tight to the rock, eyes UP the route
    const hx = px + wd;
    for (let dy = 12; dy <= 14; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const c = dy === 14 ? SHADE : dx * wd > 0 ? SKIN : SKIN_D;
        s.setPx(hx + dx, py - dy, ...c);
      }
    }
    if (player.blinkTimer === 0) {
      s.setPx(hx + wd, py - 13, 1.0, 1.0, 1.0);
      s.setPx(hx + wd * 2, py - 13, 0.08, 0.08, 0.12);
    }

    // hat tipped back off the brow — he's reading the wall above
    const hatY = py - 15;
    for (let dx = -4; dx <= 4; dx++) {
      s.setPx(hx - wd + dx, hatY, ...(Math.abs(dx) === 4 ? HAT_D : HAT));
    }
    row(hx - wd - 1, hx - wd + 1, hatY - 1, BAND);
    row(hx - wd * 2 - 1, hx - wd * 2 + 1, hatY - 2, HAT);
    s.setPx(hx - wd * 3 + Math.round(hat.ox * 0.5), hatY - 3 + Math.round(hat.oy * 0.5), ...HAT_D);

    stampOutline();
    // both hands are on the rock; the trigger breaks one free to cast
    if (player.firing) drawStaff(px - wd * 2, py - 10);
    return;
  }

  const moving = player.grounded && Math.abs(svx) > 0.2;
  const stride = player.stridePhase;
  const skid = player.skidT > 0 && player.grounded;
  // Lean: velocity, plus a hurt flinch away from the blow; a skid throws the
  // torso back the way it was travelling while the heels plant forward.
  let lean = clamp(Math.round(svx * 1.1), -2, 2);
  if (player.staggerT > 0)
    lean = clamp(lean + player.staggerDir * (player.staggerT > 6 ? 2 : 1), -3, 3);
  if (skid) lean = player.skidDir * (player.skidT > 5 ? 3 : 2);
  // Crouch has its own low silhouette instead of borrowing the landing squash:
  // planted boots, folded robe, dropped shoulders/head, and a slight forward hunch.
  const crouchPose = player.grounded && player.crouchT > 0;
  const crouchRaw = crouchPose ? clamp(player.crouchT / 10, 0, 1) : 0;
  const crouchEase = crouchRaw * crouchRaw * (3 - 2 * crouchRaw);
  const crouch = crouchPose ? Math.max(1, Math.round(crouchEase * 4)) : 0;
  if (crouch > 0 && !skid) lean = clamp(lean + f, -3, 3);
  const landSquash = player.landTimer > 0 ? Math.min(3, Math.ceil(player.landTimer / 3)) : 0;
  const sq = Math.max(landSquash, crouch > 0 ? 2 : 0);
  const diving = player.diveT > 0 && !player.grounded;
  // launch stretch elongates; a dive locks the body into a falling spear
  const stretch = sq === 0 && (player.stretchT > 0 || diving) ? (player.stretchT > 3 || diving ? 2 : 1) : 0;
  const bob = moving ? -Math.round(Math.abs(Math.sin(stride)) * 1.4) : 0;
  const breathe = (!moving && player.grounded && crouch === 0) ? (Math.sin(frameCount * 0.045) > 0.2 ? -1 : 0) : 0;
  const py = player.y;
  const lift = bob + breathe + landSquash - stretch;
  const crouchShift = (dy: number): number =>
    crouch > 0 ? Math.round(crouch * clamp((dy - 3) / 6, 0, 1)) : 0;
  const poseY = (dy: number): number => py - dy - lift + crouchShift(dy);

  // --- Boots: alternate fore/aft with the stride wheel; the air gets three
  // distinct poses (rising tuck / apex drift / falling sprawl); a skid
  // plants both heels down the old travel direction ---
  let footA = 0, footB = 0, footAy = 0, footBy = 0;
  if (skid) {
    footA = player.skidDir * 3; footB = player.skidDir;  // braced stance
  } else if (crouch > 0) {
    const creep = moving ? Math.round(Math.sin(stride) * 1.1) : 0;
    footA = -2 + creep; footB = 2 - creep;                // crouch: feet planted wide
    footAy = moving && Math.sin(stride) > 0.75 ? -1 : 0;
    footBy = moving && Math.sin(stride) < -0.75 ? -1 : 0;
  } else if (moving) {
    footA = Math.round(Math.sin(stride) * 2.6);
    footB = -footA;
    footAy = Math.sin(stride) > 0.55 ? -1 : 0;       // lifting foot clears the ground
    footBy = Math.sin(stride) < -0.55 ? -1 : 0;
  } else if (!player.grounded) {
    if (diving) {
      footA = 0; footB = 0; footAy = 0; footBy = 0;           // dive: legs speared tight
    } else if (svy < -0.8) {
      footA = f; footB = -f; footAy = -2; footBy = -2;        // rising: tight tuck
    } else if (svy > 1.6) {
      footA = f * 2; footB = -f * 2; footAy = -1; footBy = 0; // falling: legs trail apart
    } else {
      footA = f; footB = -f; footAy = -1; footBy = -2;        // apex drift
    }
  }
  row(px - 3 + footA, px - 1 + footA, py + footAy, BOOT);
  row(px - 3 + footA, px - 2 + footA, py - 1 + footAy, BOOT_L);
  row(px + 1 + footB, px + 3 + footB, py + footBy, BOOT);
  row(px + 2 + footB, px + 3 + footB, py - 1 + footBy, BOOT_L);
  if (crouch > 0) {
    row(px - 2, px + 2, py - 2, ROBE_D);
    s.setPx(px - 4, py - 1, ...BOOT_L);
    s.setPx(px + 4, py - 1, ...BOOT_L);
  }

  // --- Robe skirt: real cloth now — part instant wind, part the lagged
  // hem spring, so it swings past a stop and settles instead of snapping.
  // A skid sends it overtaking the body; falling lifts it; stretch tapers it.
  let hemSway = clamp(Math.round(-svx * 0.6 - player.robe.ox * 1.1), -3, 3);
  if (skid) hemSway = clamp(hemSway + player.skidDir * 2, -4, 4);
  const falling = !player.grounded && svy > 1.6;
  const skirt = crouch > 0
    ? [
      { dy: 2, hw: 5 },
      { dy: 3, hw: 5 },
      { dy: 4, hw: 4 },
      { dy: 5, hw: 4 },
      { dy: 6, hw: 3 },
    ]
    : [
      { dy: 2, hw: 4 + (sq > 0 ? 1 : 0) - (stretch > 0 ? 1 : 0) },
      { dy: 3, hw: 4 },
      { dy: 4, hw: 3 },
      { dy: 5, hw: 3 },
      { dy: 6, hw: 3 },
    ];
  for (const sRow of skirt) {
    const yy = poseY(sRow.dy) + (falling && sRow.dy <= 3 ? -1 : 0);
    const off = sRow.dy <= 3 ? hemSway : Math.round(hemSway * 0.5);
    const hw = sRow.hw + (falling && sRow.dy <= 3 ? 1 : 0);
    for (let dx = -hw; dx <= hw; dx++) {
      const edge = Math.abs(dx) === hw;
      s.setPx(px + dx + off, yy, ...(edge ? ROBE_D : ROBE));
    }
  }

  // --- Belt ---
  row(px - 3 + lean, px - 1 + lean, poseY(7), ROBE_D);
  s.setPx(px + lean, poseY(7), ...BAND);
  row(px + 1 + lean, px + 3 + lean, poseY(7), ROBE_D);

  // --- Torso with trim, leaning into the run ---
  for (let dy = 8; dy <= 10; dy++) {
    const yy = poseY(dy);
    for (let dx = -3; dx <= 3; dx++) {
      const c = dx === 0 ? TRIM : (Math.abs(dx) === 3 ? ROBE_D : ROBE);
      s.setPx(px + dx + lean, yy, ...c);
    }
  }
  // Off-hand: swings opposite the legs; trails high in a fall; reaches up
  // to straighten the hat during the idle fidget.
  const reachUp = player.fidgetT > 58 && player.fidgetT <= 88;
  if (reachUp) {
    s.setPx(px - f * 3 + lean, poseY(11), ...ROBE_D);
    s.setPx(px - f * 3 + lean, poseY(13), ...SKIN_D);
    s.setPx(px - f * 2 + lean, poseY(15), ...SKIN);
  } else if (crouch > 0) {
    s.setPx(px - f * 4 + lean, poseY(9), ...ROBE_D);
    s.setPx(px - f * 5 + lean, poseY(8), ...SKIN_D);
    s.setPx(px - f * 4 + lean, poseY(8), ...SKIN);
  } else if (falling) {
    s.setPx(px - f * 4 + lean, poseY(11), ...ROBE_D);
    s.setPx(px - f * 5 + lean, poseY(12), ...SKIN_D);
  } else {
    const armSwing = moving ? Math.round(Math.sin(stride + Math.PI) * 2) : 0;
    s.setPx(px - f * 4 + lean + armSwing, poseY(9), ...ROBE_D);
    s.setPx(px - f * 4 + lean + armSwing, poseY(8), ...SKIN_D);
  }

  // --- Shoulders ---
  row(px - 3 + lean, px + 3 + lean, poseY(11), ROBE);

  // --- Head with blinking, directionally lit; the brim shades the brow ---
  const hx = px + lean;
  for (let dy = 12; dy <= 14; dy++) {
    const yy = poseY(dy);
    for (let dx = -2; dx <= 2; dx++) {
      const c = dy === 14 ? SHADE : (dx * f) < 0 ? SKIN_D : SKIN;
      s.setPx(hx + dx, yy, ...c);
    }
  }
  if (player.blinkTimer === 0) {
    // Rain World look-at: the eye finds the nearest threat (even one behind
    // him); with no threat it follows the aim pitch — and a crouch-peek
    // glances down at whatever the ledge is hiding.
    let side = f;
    let drop = clamp(Math.round(Math.sin(player.aimAngle) * 1.4), -1, 1);
    if (player.crouchT > 4) drop = 1;
    let best = 80 * 80;
    for (const en of ctx.enemies) {
      const ddx = en.x - px;
      const ddy = en.y - 6 - (py - 13);
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < best) {
        best = d2;
        side = ddx < 0 ? -1 : 1;
        drop = ddy < -14 ? -1 : ddy > 14 ? 1 : 0;
      }
    }
    const ey = poseY(13) + drop;
    s.setPx(hx + side, ey, 1.0, 1.0, 1.0);
    s.setPx(hx + side * 2, ey, 0.08, 0.08, 0.12);
  }

  // --- The floppy hat: brim barely moves, segments lean progressively, tip whips ---
  const h = player.hat;
  const hatY = poseY(15);
  const seg = (t: number): { x: number; y: number } => ({ x: Math.round(h.ox * t), y: Math.round(h.oy * t) });
  const s0 = seg(0.25), s1 = seg(0.5), s2 = seg(0.75), s3 = seg(1.0);
  // brim
  for (let dx = -5; dx <= 5; dx++) {
    s.setPx(hx + dx + s0.x, hatY + s0.y, ...(Math.abs(dx) === 5 ? HAT_D : HAT));
  }
  // band + lower cone
  s.setPx(hx - 2 + s1.x, hatY - 1 + s1.y, ...BAND);
  row(hx - 1 + s1.x, hx + 1 + s1.x, hatY - 1 + s1.y, BAND);
  s.setPx(hx + 2 + s1.x, hatY - 1 + s1.y, ...BAND);
  row(hx - 2 + s1.x, hx + 2 + s1.x, hatY - 2 + s1.y, HAT);
  // mid cone
  row(hx - 1 + s2.x, hx + 1 + s2.x, hatY - 3 + s2.y, HAT);
  s.setPx(hx - 2 * f + s2.x, hatY - 3 + s2.y, ...HAT_D);
  // tip: droops at rest, whips with the spring
  const restDroop = (Math.abs(h.ox) < 1 && Math.abs(h.oy) < 1) ? 1 : 0;
  s.setPx(hx + s3.x - f * restDroop, hatY - 4 + s3.y + restDroop, ...HAT);
  s.setPx(hx + s3.x - f * (restDroop + 1), hatY - 4 + s3.y + restDroop + (restDroop ? 1 : 0), ...HAT_D);

  // --- Status skin: tiny readable tells layered onto the existing pose ---
  const st = player.status;
  if (st.wet > 0 && frameCount % 10 < 5) {
    const dripX = px + ((frameCount >> 3) % 5) - 2;
    s.addPx(dripX, poseY(3) + 1, 0.06, 0.16, 0.28);
    if (frameCount % 20 < 5) s.addPx(px - f * 2, poseY(12), 0.04, 0.12, 0.22);
  }
  if (st.oiled > 0) {
    const sheen = 0.08 + Math.sin(frameCount * 0.12) * 0.03;
    s.addPx(px - 2 + lean, poseY(9), sheen * 0.8, sheen * 0.7, sheen * 0.45);
    s.addPx(px + 3 + lean, poseY(6), sheen, sheen * 0.8, sheen * 0.45);
  }
  if (st.frozen > 0) {
    const chill = frameCount % 16 < 8 ? 1 : 0.65;
    s.setPx(px - 4 + lean, poseY(9), 0.55 * chill, 0.82 * chill, 1.0 * chill);
    s.setPx(px + 4 + lean, poseY(7), 0.45 * chill, 0.75 * chill, 1.0 * chill);
    if (frameCount % 18 < 5) s.addPx(hx + f * 4, poseY(12) - 1, 0.12, 0.2, 0.26);
  }
  if (st.stoneskin > 0) {
    const crust = frameCount % 20 < 10 ? 0.46 : 0.36;
    s.setPx(px - 3 + lean, poseY(11), crust, crust, crust * 1.05);
    s.setPx(px + 3 + lean, poseY(8), crust * 0.85, crust * 0.85, crust * 0.95);
    s.setPx(px - 1, py - 2, crust * 0.75, crust * 0.72, crust * 0.68);
  }
  if (st.swift > 0 && Math.abs(svx) > 0.55 && frameCount % 3 === 0) {
    const tx = px - Math.sign(svx) * 5;
    s.addPx(tx, poseY(6), 0.08, 0.24, 0.32);
    s.addPx(tx - Math.sign(svx) * 2, poseY(4), 0.05, 0.16, 0.24);
  }
  if (st.torch > 0 && frameCount % 6 < 3) {
    s.addPx(hx + s0.x, hatY - 1 + s0.y, 0.16, 0.1, 0.03);
  }

  // --- Lever pull: wand stowed, both arms out to the iron, body heaving ---
  if (player.pullT > 0) {
    const pd = player.pullDir;
    const haul = Math.sin((26 - player.pullT) * 0.24) * 1.2; // strain bob
    const ay = poseY(9) + Math.round(haul * 0.5);
    // two reaching arms, hands stacked on the lever side
    s.setPx(px + pd * 4 + lean, ay, ...ROBE_D);
    s.setPx(px + pd * 5 + lean, ay, ...SKIN_D);
    s.setPx(px + pd * 6 + lean, ay, ...SKIN);
    s.setPx(px + pd * 4 + lean, ay + 1, ...ROBE_D);
    s.setPx(px + pd * 5 + lean, ay + 1, ...SKIN);
    stampOutline();
    return; // no wand, no charge meter — both hands are busy
  }
  stampOutline();
  drawStaff(px + f * 3 + lean, poseY(10));
}

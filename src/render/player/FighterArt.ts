import type { Ctx, PlayerState, RigidBody } from '@/core/types';
import type { PlayerCostume } from '@/entities/playerCostume';
import type { Skeleton, V } from '@/entities/playerPose';
import { makeSkeleton, poseAlchemist } from '@/entities/playerPose';
import type { LightField, PixelSurface } from '@/render/pixels';
import { chainTube } from '@/render/creatures/anatomy';
import { blankLight, sampleSceneLight, sharedRaster } from '@/render/creatures/raster';
import type { CreatureRaster } from '@/render/creatures/raster';
import {
  BEARD, BLOOD, BOOT, COAT, COAT_D, COPPER, CYAN, EYE, FLAME, GLASS, GLINT, HEART, LEATHER, LIQUID, MANTLE, RIME, RUNE, SKIN, WOOD,
  boot, drawBreath, drawChill, drawWand, hand, limb,
} from '@/render/player/AlchemistArt';
import type { FighterLook, LookCtx, PassName } from '@/render/player/fighterLook';
import { lookFor } from '@/render/player/looks';

/**
 * A FIGHTER drawn on the alchemist's own skeleton, cloth rig and lit-volume rasterizer (see fighterLook.ts
 * and docs/PLAYER-ART.md). Passes run back to front: far limbs and rear cloth, the torso and outfit, the
 * near leg, the shoulders, the head, the headgear, whatever is held, the near arm, then the effects that
 * belong to the body (levitation ring, communion glow, burning, the chill's rime, a shock's arc). Each pass
 * is the shared default for the look's outfit/headgear/hair, plus the look's own `extras`, or the look's
 * own drawing when it `replace`s the pass. The living (`drawFighter`) and the fallen (the ragdoll sprite)
 * share every stitch.
 */

const LIGHT = blankLight();
const SKEL_CACHE = new WeakMap<object, Skeleton>();

const lookOf = (ctx: Ctx): FighterLook | null => {
  const id = ctx.fighters?.id;
  return id ? lookFor(id) ?? null : null;
};

/** The living fighter (production fine surface). Returns false when no fighter look applies or the surface can't take it. */
export function drawFighter(out: PixelSurface, field: LightField, ctx: Ctx): boolean {
  const look = lookOf(ctx);
  if (!look || !out.setFinePx) return false;
  const a = ctx.player;
  let s = SKEL_CACHE.get(a);
  if (!s) { s = makeSkeleton(); SKEL_CACHE.set(a, s); }
  poseAlchemist(ctx, a, s);
  drawFighterBody(out, field, ctx, a, s, a.costume, null, 1, look);
  return true;
}

/** The fallen fighter, off the ragdoll's solved skeleton; false when the classic alchemist should be drawn. */
export function drawFighterFallen(out: PixelSurface, field: LightField, ctx: Ctx, s: Skeleton, hatBody: RigidBody | null, alpha: number): boolean {
  const look = lookOf(ctx);
  if (!look) return false;
  drawFighterBody(out, field, ctx, ctx.player, s, ctx.player.costume, hatBody, alpha, look);
  return true;
}

export function drawFighterBody(out: PixelSurface, field: LightField, ctx: Ctx, a: PlayerState, s: Skeleton,
  costumeIn: PlayerCostume | undefined, hatBody: RigidBody | null, alpha: number, look: FighterLook): void {
  const f = s.facing, frame = ctx.state.frameCount;
  const root = costumeIn?.tails[0].pts[0];
  const costume = root && Math.abs(root.x - s.hip.x) + Math.abs(root.y - s.hip.y) < 12 ? costumeIn : undefined;
  const fine = out.setFinePx !== undefined && (out.pixelStep ?? 1) < 1;
  const step = fine ? out.pixelStep ?? 1 : 1;
  const r = sharedRaster;
  const pts = [s.hip, s.chest, s.head, s.backFoot, s.frontFoot, s.backHand, s.frontHand, s.crown];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  if (costume) for (const ch of [costume.tails[0], costume.tails[1], costume.mantle, costume.crown]) for (const p of ch.pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  // A staff, a halo, a lantern on a pole: pad the box generously (the wand reaches 14 cells either way).
  if (s.wand.visible) { x0 = Math.min(x0, s.wand.x - 18); x1 = Math.max(x1, s.wand.x + 18); y0 = Math.min(y0, s.wand.y - 18); y1 = Math.max(y1, s.wand.y + 18); }
  if (hatBody) { x0 = Math.min(x0, hatBody.x - 8); x1 = Math.max(x1, hatBody.x + 8); y0 = Math.min(y0, hatBody.y - 8); y1 = Math.max(y1, hatBody.y + 8); }
  r.begin(step, x0 - 10, y0 - 12, x1 + 10, y1 + 8, look.mats, a.x, a.y);
  r.outline = 1; r.bands = 0.7; r.dither = false; r.blend = 1.4;
  const dead = s.kind === 'dead';

  const ht = s.headTilt, hc = Math.cos(ht), hs = Math.sin(ht);
  const H = (side: number, up: number): [number, number] => [s.head.x + (side * f) * hc - (-up) * hs, s.head.y + (side * f) * hs + (-up) * hc];
  const ux = s.chest.x - s.hip.x, uy = s.chest.y - s.hip.y;
  const L: LookCtx = {
    r, s, f, frame, ctx, a, costume, dead, look, H,
    mid: { x: (s.hip.x + s.chest.x) / 2, y: (s.hip.y + s.chest.y) / 2 }, ux, uy,
  };

  const run = (name: PassName, shared: (c: LookCtx) => void): void => {
    if (!look.replace?.includes(name)) shared(L);
    look.extras?.[name]?.(L);
  };
  run('back', passBack);
  run('torso', passTorso);
  passNearLeg(L);
  run('shoulders', passShoulders);
  run('head', passHead);
  run('headgear', (c) => passHeadgear(c, hatBody, alpha));
  run('held', passHeld);
  passNearArm(L);
  run('front', () => undefined);
  run('effects', passEffects);

  // --- The chill: rime on the real silhouette (never a shape pasted over it) ---
  const glaze = drawChill(r, ctx, a, s, f, dead, look.headgear === 'hat' || look.headgear === 'wide' ? !hatBody : false, H);
  const flash = !ctx.state.reduceFlashes && a.staggerT > 7 ? 0.18 : 0;
  sampleSceneLight(field, s.chest.x, s.chest.y, 10, flash, LIGHT, dead ? 0.15 : 1);
  // The hero stays readable in any gloom; the direction still comes from the lamps.
  LIGHT.r = Math.min(1.08, Math.max(0.74, LIGHT.r)); LIGHT.g = Math.min(1.08, Math.max(0.74, LIGHT.g)); LIGHT.b = Math.min(1.08, Math.max(0.76, LIGHT.b));
  LIGHT.tint = glaze;
  r.resolve(out, LIGHT);
  LIGHT.tint = undefined;
  if (!dead && a.chill) drawBreath(out, field, ctx, a.chill);
  if (a.status.electrified > 0 && frame % 4 !== 0 && !dead) {
    const arc = (out.setFinePx ?? out.setPx).bind(out);
    for (let i = 0; i < 6; i++) arc(s.chest.x - 4 + i * 1.6, s.chest.y - 3 + ((i * 7 + frame) % 5) - 2, 0.42, 0.86, 1);
  }
}

// ======================================================================================== body-size helpers

const limbK = (c: LookCtx): number => c.look.build?.limb ?? 1;
const torsoK = (c: LookCtx): number => c.look.build?.torso ?? 1;
const headK = (c: LookCtx): number => c.look.build?.head ?? 1;

/** A limb capsule scaled by the look's build. */
function lb(c: LookCtx, a: V, b: V, ra: number, rb: number, z: number, mat: number, group: number, far = false): void {
  const k = limbK(c);
  limb(c.r, a, b, ra * k, rb * k, z, mat, group, far);
}

// ======================================================================================== passes

/** Far arm and leg, the rear cloth. */
function passBack(c: LookCtx): void {
  const { r, s, look, costume, f } = c;
  const legMat = look.outfit === 'robe' ? COAT_D : look.outfit === 'armor' ? COPPER : COAT_D;
  lb(c, s.chest, s.backElbow, 0.95, 0.8, -6, COAT_D, 2, true);
  lb(c, s.backElbow, s.backHand, 0.82, 0.62, -6, COAT_D, 2, true);
  hand(r, s.backHand, s.backElbow, -6, 2, true);
  lb(c, s.hip, s.backKnee, 1.2, 0.95, -5, legMat, 3, true);
  lb(c, s.backKnee, s.backFoot, 0.95, 0.8, -5, BOOT, 3, true);
  boot(r, s.backFoot, s.backKnee, f, -5, 3, true);
  if (costume) {
    if (look.outfit === 'coat' || look.outfit === 'robe') {
      const w = look.outfit === 'robe' ? 1.5 : 1.25;
      chainTube(r, costume.tails[0], -4, COAT_D, { group: 4 }, w, w + 0.25);
    }
    if (look.mantle !== false && look.outfit === 'coat' && look.hair !== 'braid' && look.hair !== 'ponytail') chainTube(r, costume.mantle, -3, MANTLE, { group: 5, far: true }, 0.8, 1.0);
    // A braid or ponytail hangs down the back on the shoulder chain, tied in at the nape.
    if (look.hair === 'braid' || look.hair === 'ponytail') {
      const nape = c.H(-1.9, -0.6);
      const root = costume.mantle.pts[0];
      r.capsule(nape[0], nape[1], 1.1, root.x, root.y, look.hair === 'braid' ? 0.95 : 1.15, -2.8, -3.0, BEARD, { group: 33 });
      chainTube(r, costume.mantle, -3.1, BEARD, { group: 33 }, look.hair === 'braid' ? 0.95 : 1.15, look.hair === 'braid' ? 0.4 : 0.3);
    }
  }
}

/** The torso and what it wears. */
function passTorso(c: LookCtx): void {
  const { r, s, look, f } = c;
  const tk = torsoK(c);
  const { mid } = c;
  r.capsule(s.hip.x, s.hip.y, (2.0 + s.crouch * 0.4) * tk, mid.x, mid.y, 2.2 * tk, 0, 0, COAT, { group: 1 });
  r.capsule(mid.x, mid.y, 2.2 * tk, s.chest.x, s.chest.y, 2.5 * tk, 0, 0.5, COAT, { group: 1 });
  r.shade(s.hip.x - f * 1.2 + (s.chest.x - s.hip.x) * 0.5, mid.y, 1.2, 3.2, s.lean, -0.8, 1);
  const belt = { x: s.hip.x + c.ux * 0.12, y: s.hip.y + c.uy * 0.12 };
  r.stamp(belt.x, belt.y, 2.3 * tk, 0.6, Math.atan2(c.uy, c.ux) + Math.PI / 2, LEATHER, 1, false, 1);
  r.dot(belt.x + f * 0.4, belt.y, COPPER, 3, 5);
  if (look.outfit === 'robe') {
    // The robe's skirt: from the waist, flaring to a hem that swings with the stride.
    const hemY = Math.max(s.backFoot.y, s.frontFoot.y) - 1.2 + s.crouch * 1.5;
    const sway = (s.frontFoot.x - s.backFoot.x) * 0.25;
    const pts = [
      s.hip.x - 2.3 * tk, s.hip.y - 0.4,
      s.hip.x + 2.3 * tk, s.hip.y - 0.4,
      s.hip.x + 4.2 + sway + f * 0.8, hemY,
      s.hip.x - 4.2 + sway - f * 0.8, hemY,
    ];
    r.poly(pts, 4, 1.2, COAT, 0.15, { group: 1 });
    r.stroke(s.hip.x - 4.0 + sway - f * 0.8, hemY - 0.2, s.hip.x + 4.0 + sway + f * 0.8, hemY - 0.2, COPPER, 1.2, true);
  }
  if (look.pouches !== false && look.outfit !== 'robe') {
    r.ellipse(belt.x - f * 2.1, belt.y + 0.8, 1.1, 1.2, 0, 2.5, LEATHER, { group: 6 });
    r.ellipse(belt.x + f * 1.9, belt.y + 0.6, 0.95, 1.05, 0, 2.5, LEATHER, { group: 6 });
  }
  if (look.bandolier) {
    const shoulderBack = { x: s.chest.x - f * 1.6, y: s.chest.y - 0.4 }, hipFront = { x: s.hip.x + f * 1.6, y: s.hip.y - 0.2 };
    r.stroke(shoulderBack.x, shoulderBack.y, hipFront.x, hipFront.y, LEATHER, 1.5, false, 0.35);
    const vb = c.costume?.vial ?? 0;
    const vx = s.chest.x + (hipFront.x - s.chest.x) * 0.45 + f * 0.6, vy = s.chest.y + (hipFront.y - s.chest.y) * 0.45 + vb * 0.4;
    r.ellipse(vx, vy, 0.7, 1.05, vb * 0.2, 3, c.dead ? GLASS : CYAN, { group: 7 });
  }
  if (look.outfit === 'armor') {
    // Plate: a breastplate over the coat, a gorget, knee caps and greaves ride the legs.
    r.ellipse(s.chest.x + f * 0.5, (s.chest.y + mid.y) / 2, 2.9 * tk, 2.7 * tk, s.lean * 0.6, 2.4, COPPER, { group: 34 });
    r.stamp(s.chest.x + f * 0.6, s.chest.y + 0.6, 2.2 * tk, 0.55, s.lean, COAT, 2, false, 34);
  }
}

function passNearLeg(c: LookCtx): void {
  const { r, s, look, costume, f } = c;
  const legMat = look.outfit === 'robe' ? COAT_D : COAT_D;
  lb(c, s.hip, s.frontKnee, 1.25, 1.0, 3, legMat, 8);
  lb(c, s.frontKnee, s.frontFoot, 1.0, 0.85, 3, BOOT, 8);
  boot(r, s.frontFoot, s.frontKnee, f, 3, 8, false);
  if (look.outfit === 'armor') {
    r.ellipse(s.frontKnee.x + f * 0.5, s.frontKnee.y, 1.5 * limbK(c), 1.4 * limbK(c), 0, 3.6, COPPER, { group: 35 });
  }
  if (costume && (look.outfit === 'coat' || look.outfit === 'robe')) chainTube(r, costume.tails[1], 3.5, COAT, { group: 9 }, 1.2, 1.45);
  // Blood soak: the hem and boots redden as he wades (player.bloodStain).
  const stain = Math.min(1, c.a.bloodStain / 1000);
  if (stain > 0.05) {
    const feetY = Math.max(s.backFoot.y, s.frontFoot.y);
    for (const p of [s.backFoot, s.frontFoot]) r.shade(p.x, p.y - 1, 2.4, 2.2 + stain * 2, 0, -0.5 * stain);
    r.stamp(s.frontFoot.x, feetY - 0.8, 2.2, 0.6 + stain * 1.2, 0, BLOOD, 1 + stain, false, 8);
    r.stamp(s.backFoot.x, feetY - 0.8, 2.2, 0.6 + stain * 1.2, 0, BLOOD, 1 + stain, false, 3);
  }
}

function passShoulders(c: LookCtx): void {
  const { r, s, look, f } = c;
  if (look.mantle === true || (look.mantle === undefined && look.outfit === 'coat')) {
    r.ellipse(s.chest.x - f * 0.3, s.chest.y - 0.1, 2.9, 1.45, s.lean * 0.8 + f * 0.1, 2, MANTLE, { group: 10 });
    r.shade(s.chest.x - f * 0.3, s.chest.y + 0.7, 2.7, 0.6, s.lean, -0.9, 10);
  }
  if (look.outfit === 'armor') {
    const k = torsoK(c);
    r.ellipse(s.chest.x - f * 0.2, s.chest.y - 0.6, 3.4 * k, 2.0 * k, s.lean * 0.8, 2.6, COPPER, { group: 36 });
    r.shade(s.chest.x - f * 0.2, s.chest.y + 0.6, 3.1 * k, 0.6, s.lean, -0.9, 36);
  }
}

/** Neck, head, face and hair. */
function passHead(c: LookCtx): void {
  const { r, s, look, f, H } = c;
  const hk = headK(c);
  const ht = s.headTilt;
  limb(r, s.neck, s.head, 0.85, 0.9, 3, SKIN, 11);
  r.ellipse(s.head.x, s.head.y, 2.3 * hk, 2.45 * hk, ht, 4, SKIN, { group: 11 });
  if (look.face !== 'shadow') {
    r.ellipse(...H(2.25 * hk, 0.05), 0.95, 0.72, ht + f * 0.25, 4.6, SKIN, { group: 11 });
    r.stamp(...H(-1.25, 0.2), 0.5, 0.7, ht, SKIN, 0.5, false, 11);
  }
  if (look.hair === 'beard') {
    r.stamp(...H(0.5, -1.55), 1.8, 0.95, ht, BEARD, 1, false, 11);
    r.stamp(...H(1.7, -0.75), 0.95, 0.35, ht, BEARD, 1.6, false, 11);
  } else if (look.hair === 'bob') {
    r.ellipse(...H(-0.8, 0.4), 2.6 * hk, 2.9 * hk, ht, 4.4, BEARD, { group: 11 });
    r.stamp(...H(-1.8, -1.2), 1.4, 1.5, ht, BEARD, 0.5, false, 11);
  } else if (look.hair === 'short') {
    r.ellipse(...H(-0.5, 0.9), 2.5 * hk, 1.7 * hk, ht, 4.5, BEARD, { group: 11 });
  } else if (look.hair === 'braid' || look.hair === 'ponytail') {
    // Hair swept back from the brow, gathered at the nape.
    r.ellipse(...H(-0.9, 0.7), 2.4 * hk, 2.0 * hk, ht, 4.4, BEARD, { group: 11 });
    r.stamp(...H(-1.9, -0.3), 1.2, 1.5, ht, BEARD, 0.4, false, 11);
  }
  if (s.mouth > 0.3 && look.face === 'open') r.stamp(...H(1.55, -1.1), 0.5, 0.2 + s.mouth * 0.35, ht, EYE, 0, true, 11);
  const [ex, ey] = H(1.2, 0.72);
  if (look.face === 'shadow') {
    // A hood's dark: no face, two points of light.
    r.ellipse(...H(0.9, 0.3), 1.9 * hk, 2.0 * hk, ht, 4.7, BOOT, { group: 11 });
    if (!s.eyesShut && look.eyeGlow && !c.dead) r.dot(...H(1.5, 0.7), CYAN, 3, 40); // (the look recolours the glow slot)
    return;
  }
  if (s.eyesShut) r.stroke(ex - 0.55, ey, ex + 0.5, ey + 0.1, BEARD, 0, true);
  else {
    r.stamp(ex, ey, 0.55, 0.66, 0, EYE, 0, false, 11);
    r.dot(ex + 0.15 + s.gazeX * 0.2 * f, ey - 0.25 + s.gazeY * 0.15, GLINT, 1, 30);
  }
  r.stroke(...H(0.5, 1.35), ...H(1.9, 1.25), BEARD, 1.2, true);
  r.shade(...H(0.6, 1.6), 2.2, 0.55, ht, -0.8, 11);
  if (look.face === 'masked') {
    // Lower face covered: a cloth over nose and mouth.
    r.ellipse(...H(1.3, -0.9), 1.9, 1.3, ht, 4.9, COAT, { group: 12 });
  }
}

function passHeadgear(c: LookCtx, hatBody: RigidBody | null, alpha: number): void {
  const { r, s, look, costume, f, H } = c;
  const ht = s.headTilt;
  const kind = look.headgear;
  if (kind === 'none') return;
  if (kind === 'hat' || kind === 'wide') {
    if (hatBody) { drawLoose(r, hatBody, alpha); return; }
    const [bx, by] = H(-0.1, 2.15);
    const ba = s.brimAngle;
    const [cx, cy] = H(-0.25, kind === 'wide' ? 3.1 : 3.5);
    r.ellipse(cx, cy, kind === 'wide' ? 2.3 : 2.35, kind === 'wide' ? 1.35 : 1.55, ba, 5.8, MANTLE, { group: 16 });
    if (kind === 'hat' && costume) {
      const ch = costume.crown, root = ch.pts[0];
      r.capsule(cx, cy - 0.4, 1.9, root.x, root.y, 1.7, 5.9, 6.0, MANTLE, { group: 16 });
      chainTube(r, ch, 6.0, MANTLE, { group: 16 }, 1.7, 0.45);
      const tip = ch.pts[ch.pts.length - 1];
      r.ellipse(tip.x, tip.y, 0.62, 0.62, 0, 6.8, COPPER, { group: 17 });
      r.shade(ch.pts[1].x, ch.pts[1].y, 1.3, 0.5, 0, -1.0, 16);
    }
    r.stamp(cx, cy + 0.55, 2.4, 0.5, ba, LEATHER, 1, false, 16);
    r.stamp(cx + f * 1.0, cy + 0.55, 0.5, 0.45, ba, COPPER, 2.5, false, 16);
    const bc = Math.cos(ba), bs = Math.sin(ba);
    const reach = kind === 'wide' ? 6.6 : 5.6;
    r.capsule(bx - bc * reach, by - bs * reach + 0.4, 0.5, bx, by, 0.75, 6.2, 6.4, MANTLE, { group: 15 });
    r.capsule(bx, by, 0.75, bx + bc * (reach + 0.3), by + bs * (reach + 0.3) + 0.35, 0.5, 6.4, 6.2, MANTLE, { group: 15 });
    r.shade(bx, by + 0.5, reach + 0.2, 0.35, ba, -1.2, 15);
  } else if (kind === 'hood') {
    // A cowl over the head, its peak drooping on the crown chain.
    r.ellipse(...H(-0.5, 0.5), 3.4, 3.5, ht, 6.0, COAT, { group: 18 });
    r.ellipse(...H(-1.6, -0.8), 2.4, 2.6, ht, 5.6, COAT_D, { group: 18 });
    if (costume) {
      const ch = costume.crown;
      r.capsule(...H(-0.3, 2.2), 1.7, ch.pts[0].x, ch.pts[0].y, 1.4, 6.1, 6.2, COAT, { group: 18 });
      chainTube(r, ch, 6.2, COAT, { group: 18 }, 1.4, 0.3);
    }
    r.shade(...H(1.6, 0.4), 1.4, 2.4, ht, -1.0, 18);
  } else if (kind === 'helm') {
    r.ellipse(...H(0, 0.4), 3.0, 3.1, ht, 6.0, COPPER, { group: 18 });
    r.stamp(...H(1.6, 0.2), 1.6, 0.5, ht, EYE, 0, true, 18); // the visor slit
    if (look.eyeGlow) r.dot(...H(1.6, 0.2), CYAN, 3, 40);
    r.shade(...H(-0.6, 1.4), 2.4, 0.7, ht, -0.7, 18);
  } else if (kind === 'band') {
    r.stroke(...H(-1.8, 1.4), ...H(2.3, 1.5), LEATHER, 0, false, 1.1);
    r.stamp(...H(0, 1.7), 2.6, 0.9, ht, LEATHER, 1, false, 18);
  } else if (kind === 'halo') {
    const [hx, hy] = H(-0.2, 4.6);
    r.ellipse(hx, hy, 2.9, 0.9, ht, 8, COPPER, { group: 40, noOutline: true });
    r.glowStamp(hx, hy, 3.2, 1.0, ht, COPPER, 1.6, 0.5, 40);
  }
  void s; void costume; void f;
}

function drawLoose(r: CreatureRaster, hat: RigidBody, alpha: number): void {
  const px = hat.previousX ?? hat.x, py = hat.previousY ?? hat.y;
  const x = px + (hat.x - px) * alpha, y = py + (hat.y - py) * alpha, ang = hat.angle;
  const cc = Math.cos(ang), sn = Math.sin(ang);
  const P = (lx: number, ly: number): [number, number] => [x + lx * cc - ly * sn, y + lx * sn + ly * cc];
  r.capsule(...P(-4.2, 0.2), 0.55, ...P(4.2, 0.2), 0.5, 6, 6, MANTLE, { group: 15 });
  r.capsule(...P(0, -0.6), 2.3, ...P(-0.8, -3.4), 1.4, 6.5, 6.5, MANTLE, { group: 16 });
  r.stamp(...P(0, -0.9), 2.4, 0.5, ang, LEATHER, 1, false, 16);
}

/** What is held in the off hand (a flask) and the wand in its skin. */
function passHeld(c: LookCtx): void {
  const { r, s, ctx, frame } = c;
  if (s.held) {
    const h = s.held;
    const cc = Math.cos(h.angle), sn = Math.sin(h.angle), f = c.f;
    const fill = ctx.flask?.state.material;
    r.ellipse(h.x + cc * 0.9 * f, h.y + sn * 0.9, 1.5, 1.1, h.angle, 9, GLASS, { group: 12 });
    if (fill !== null && fill !== undefined && (ctx.flask?.state.count ?? 0) > 0) r.stamp(h.x + cc * 1.1 * f, h.y + sn * 1.1 + 0.3, 1.1, 0.6, h.angle, LIQUID, 2, false, 12);
    r.capsule(h.x - cc * 0.7 * f, h.y - sn * 0.7, 0.45, h.x - cc * 1.5 * f, h.y - sn * 1.5, 0.35, 9.5, 9.5, WOOD, { group: 12 });
  }
  if (!s.wand.visible) return;
  if (c.look.drawWand) { c.look.drawWand(c); return; }
  drawWandSkin(c, frame);
}

function drawWandSkin(c: LookCtx, frame: number): void {
  const { r, s, ctx, a, look } = c;
  const w = s.wand, ang = w.angle + w.spin, cc = Math.cos(ang), sn = Math.sin(ang);
  const glow = w.glow * (0.9 + Math.sin(frame * 0.3) * 0.1);
  const hooded = ctx.state.lanternHooded === true && !a.firing;
  switch (look.wand) {
    case 'wand': drawWand(r, s, frame, hooded); return;
    case 'pistol': {
      // A short flintlock: grip, barrel, a brass cap and a muzzle that flares when she fires.
      r.capsule(w.x - cc * 1.2, w.y - sn * 1.2 + 0.6, 0.7, w.x + cc * 0.2, w.y + sn * 0.2, 0.6, 8.2, 8.2, WOOD, { group: 14 });
      r.capsule(w.x, w.y, 0.5, w.x + cc * 6.2, w.y + sn * 6.2, 0.42, 8.3, 8.3, COPPER, { group: 14 });
      r.capsule(w.x + cc * 5.2, w.y + sn * 5.2, 0.62, w.x + cc * 6.4, w.y + sn * 6.4, 0.6, 8.4, 8.4, COPPER, { group: 14 });
      const mx = w.x + cc * 7.0, my = w.y + sn * 7.0;
      r.ellipse(mx, my, 0.5 + glow * 0.4, 0.5 + glow * 0.4, 0, 9, FLAME, { group: 14, noOutline: true });
      r.glowStamp(mx, my, 0.6 + glow * 0.5, 0.6 + glow * 0.5, 0, FLAME, 1.4 + glow * 1.6, 0.7, 14);
      return;
    }
    case 'staff': {
      r.capsule(w.x - cc * 4.5, w.y - sn * 4.5, 0.5, w.x + cc * 12.5, w.y + sn * 12.5, 0.38, 8.2, 8.2, WOOD, { group: 14 });
      const tx = w.x + cc * 13.2, ty = w.y + sn * 13.2;
      r.ellipse(tx, ty, 0.9, 0.9, 0, 8.6, COPPER, { group: 14 });
      r.ellipse(tx + cc * 0.6, ty + sn * 0.6, 0.6 + glow * 0.3, 0.6 + glow * 0.3, 0, 9, CYAN, { group: 14, noOutline: true });
      r.glowStamp(tx + cc * 0.6, ty + sn * 0.6, 0.7 + glow * 0.4, 0.7 + glow * 0.4, 0, CYAN, 1.5 + glow * 1.5, 0.8, 14);
      return;
    }
    case 'spear': {
      r.capsule(w.x - cc * 3.0, w.y - sn * 3.0, 0.4, w.x + cc * 9.0, w.y + sn * 9.0, 0.34, 8.2, 8.2, COPPER, { group: 14 });
      r.capsule(w.x + cc * 9.0, w.y + sn * 9.0, 0.7, w.x + cc * 13.2, w.y + sn * 13.2, 0.1, 8.4, 8.4, RIME, { group: 14 });
      r.glowStamp(w.x + cc * 11.2, w.y + sn * 11.2, 0.7, 0.4, ang, CYAN, 1.2 + glow, 0.6, 14);
      return;
    }
    case 'scythe': {
      r.capsule(w.x - cc * 5.5, w.y - sn * 5.5, 0.5, w.x + cc * 12.0, w.y + sn * 12.0, 0.4, 8.2, 8.2, WOOD, { group: 14 });
      const tx = w.x + cc * 12.0, ty = w.y + sn * 12.0;
      // The blade curls back along the line of the shaft.
      const bx = tx + cc * 2.4 - sn * 3.2 * c.f, by = ty + sn * 2.4 + cc * 3.2 * c.f;
      r.capsule(tx, ty, 0.6, bx, by, 0.15, 8.4, 8.4, RIME, { group: 14 });
      return;
    }
    case 'lantern': {
      r.capsule(w.x - cc * 2.6, w.y - sn * 2.6, 0.45, w.x + cc * 6.5, w.y + sn * 6.5, 0.32, 8.2, 8.2, WOOD, { group: 14 });
      const lx = w.x + cc * 6.8, ly = w.y + sn * 6.8 + 1.4;
      r.capsule(lx, ly - 1.2, 0.5, lx, ly + 1.2, 0.5, 8.6, 8.6, COPPER, { group: 14 });
      r.ellipse(lx, ly, 0.7, 0.9, 0, 9, FLAME, { group: 14, noOutline: true });
      r.glowStamp(lx, ly, 0.8, 1.0, 0, FLAME, 1.6 + glow, 0.7, 14);
      return;
    }
    case 'bell': {
      r.capsule(w.x - cc * 2.6, w.y - sn * 2.6, 0.45, w.x + cc * 6.2, w.y + sn * 6.2, 0.32, 8.2, 8.2, COPPER, { group: 14 });
      const bx = w.x + cc * 6.4, by = w.y + sn * 6.4;
      const sw = Math.sin(frame * 0.2) * 0.6 * (a.firing ? 2 : 0.4);
      r.ellipse(bx + sw, by + 1.2, 1.4, 1.6, 0, 8.6, COPPER, { group: 14 });
      r.ellipse(bx + sw, by + 2.4, 1.8, 0.5, 0, 8.7, COPPER, { group: 14 });
      r.glowStamp(bx + sw, by + 1.4, 1.2, 1.2, 0, RUNE, 0.8 + glow, 0.3, 14);
      return;
    }
    case 'fist': {
      // No wand in the hand: the fist itself is the weapon, a coal at the knuckles.
      r.glowStamp(w.x + cc * 1.2, w.y + sn * 1.2, 1.2, 1.2, 0, FLAME, 1.4 + glow, 0.6, 14);
      return;
    }
  }
}

function passNearArm(c: LookCtx): void {
  const { r, s, f, look } = c;
  const armMat = look.outfit === 'armor' ? COPPER : COAT;
  lb(c, s.chest, s.frontElbow, 1.0, 0.85, 8, armMat, 13);
  lb(c, s.frontElbow, s.frontHand, 0.85, 0.65, 8.5, armMat, 13);
  r.stamp((s.frontElbow.x + s.frontHand.x * 2) / 3, (s.frontElbow.y + s.frontHand.y * 2) / 3, 0.7, 0.7, 0, look.outfit === 'armor' ? COAT : MANTLE, 1, false, 13);
  hand(r, s.frontHand, s.frontElbow, 8.5, 13, false);
  void f;
}

/** Effects that belong to the body: the levitation ring, communion, burning. */
function passEffects(c: LookCtx): void {
  const { r, s, a, frame, dead } = c;
  if (s.lift > 0) {
    const fx = (s.backFoot.x + s.frontFoot.x) / 2, fy = Math.max(s.backFoot.y, s.frontFoot.y) + 1.2;
    const pulse = 0.8 + Math.sin(frame * 0.4) * 0.2;
    r.ellipse(fx, fy, 3.6 * pulse, 0.9, 0, 12, RUNE, { group: 20, noOutline: true, depth: 0.3 });
    r.glowStamp(fx, fy, 3.6 * pulse, 0.9, 0, RUNE, 2.4, 0.6, 20);
  }
  if (s.commune > 0) {
    const hx = (s.backHand.x + s.frontHand.x) / 2, hy = (s.backHand.y + s.frontHand.y) / 2;
    const beat = 0.8 + Math.max(0, Math.sin(frame * 0.2)) * 0.5;
    r.ellipse(hx, hy - 0.3, 1.1 * beat, 1.0 * beat, 0, 12, HEART, { group: 21, noOutline: true });
  }
  if (a.status.burning > 0 && !dead) {
    for (let i = 0; i < 4; i++) {
      const fx = s.hip.x - 2.4 + i * 1.6, fy = s.chest.y - Math.sin(frame * 0.22 + i) * 2 + 1;
      r.ellipse(fx, fy, 0.9, 1.6 + Math.sin(frame * 0.5 + i) * 0.4, 0, 15, FLAME, { group: 23 + i, noOutline: true });
    }
  }
}

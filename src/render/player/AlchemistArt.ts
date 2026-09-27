import type { Ctx, PlayerState, RigidBody } from '@/core/types';
import type { PlayerCostume } from '@/entities/playerCostume';
import type { Skeleton, V } from '@/entities/playerPose';
import { makeSkeleton, poseAlchemist } from '@/entities/playerPose';
import type { LightField, PixelSurface } from '@/render/pixels';
import { chainTube } from '@/render/creatures/anatomy';
import { material } from '@/render/creatures/palette';
import type { CreatureMaterial } from '@/render/creatures/palette';
import { blankLight, sampleSceneLight, sharedRaster } from '@/render/creatures/raster';
import type { CreatureRaster } from '@/render/creatures/raster';

/**
 * The alchemist, drawn as lit volumes on the creature rasterizer: a teal
 * coat with split tails that really swing, a bone mantle and a battered hooked
 * hat whose crown flops on its own chain, copper fittings, a bandolier with a
 * glowing vial, gloves, buckled boots, a beard. The pose comes from
 * entities/playerPose (the same skeleton the ragdoll produces), so the living
 * and the fallen share every stitch.
 */
const COAT = 1, COAT_D = 2, MANTLE = 3, LEATHER = 4, COPPER = 5, SKIN = 6, BEARD = 7, BOOT = 8, EYE = 9, GLINT = 10,
  CYAN = 11, WOOD = 12, GLASS = 13, BLOOD = 14, RUNE = 15, HEART = 16, ICE = 17, FLAME = 18, LIQUID = 19;

const MATS: CreatureMaterial[] = [
  material({ keys: [0x0a1a1c, 0x133538, 0x1f5150, 0x347168, 0x5e9c88], gloss: 0.12, rim: 0.85, outline: 0x040a0b }),
  material({ keys: [0x061012, 0x0c2426, 0x153a3c, 0x245552, 0x3c7666], gloss: 0.1, rim: 0.7, outline: 0x040a0b }),
  material({ keys: [0x2a2519, 0x5c533f, 0x9a8d6c, 0xc9b991, 0xefe2bb], gloss: 0.1, rim: 0.75, outline: 0x0e0c08 }),
  material({ keys: [0x120a0e, 0x2a181c, 0x482b28, 0x6d4535, 0x9a6b4a], gloss: 0.25, rim: 0.6, outline: 0x060304 }),
  material({ keys: [0x3a1806, 0x8a4816, 0xd07a2a, 0xffb55a, 0xffe6a8], gloss: 0.8, shine: 22, rim: 0.7, outline: 0x140802 }),
  material({ keys: [0x3a1c12, 0x7a432c, 0xb86e4c, 0xe39c72, 0xfbc89c], gloss: 0.15, rim: 0.6, outline: 0x160a06 }),
  material({ keys: [0x050808, 0x0e1616, 0x1b2828, 0x2c3e3e], rim: 0.5, outline: 0x020303 }),
  material({ keys: [0x06040a, 0x140e17, 0x281c27, 0x46323e, 0x6a4c5a], gloss: 0.35, shine: 16, rim: 0.7, outline: 0x030204 }),
  material({ keys: [0x010101, 0x07090a, 0x101418], gloss: 1, shine: 40 }),
  material({ keys: [0xf4f0e0, 0xffffff], emissive: 1 }),
  material({ keys: [0x0e4a58, 0x3ac4dc, 0xa4f4ff, 0xffffff], emissive: 1, glow: 0x0c3c4a, glowK: 0.9 }),
  material({ keys: [0x140c06, 0x34200e, 0x5c3a1c, 0x86592e], gloss: 0.3, rim: 0.6, outline: 0x060403 }),
  material({ keys: [0x24343a, 0x5a7a82, 0xb0d4dc, 0xf0ffff], translucent: 0.45, gloss: 1, shine: 30, rim: 1, outline: 0x0a1418 }),
  material({ keys: [0x1a0204, 0x4a060c, 0x7a1018, 0xa42028], gloss: 0.5, rim: 0.4, outline: 0x0a0102 }),
  material({ keys: [0x0a3a48, 0x2aa8c8, 0x9aecff, 0xffffff], emissive: 1, glow: 0x0c3a48, glowK: 0.9, translucent: 0.35 }),
  material({ keys: [0x5a0a20, 0xd03a64, 0xff94b4, 0xfff0f4], emissive: 1, glow: 0x4a0a1c, glowK: 1 }),
  material({ keys: [0x6a9ab0, 0xa8d4e8, 0xe4f8ff, 0xffffff], translucent: 0.4, gloss: 1, shine: 30, rim: 1 }),
  material({ keys: [0x6a1a00, 0xe05a08, 0xffb030, 0xfff2b0], emissive: 1, glow: 0x7a2a04, glowK: 1.1, translucent: 0.2 }),
  material({ keys: [0x1a3a5a, 0x2a6a9a, 0x5aa0d0, 0xa0d8ff], translucent: 0.2, emissive: 0.3, gloss: 0.8 }),
];

const LIGHT = blankLight();

function limb(r: CreatureRaster, a: V, b: V, ra: number, rb: number, z: number, mat: number, group: number, far = false): void {
  r.capsule(a.x, a.y, ra, b.x, b.y, rb, z, z, mat, { group, far });
}

function boot(r: CreatureRaster, foot: V, knee: V, facing: number, z: number, group: number, far: boolean): void {
  // The boot points along the ground (forward), shaped by the shin's angle.
  const sx = foot.x - knee.x, sy = foot.y - knee.y;
  const ang = Math.atan2(sy, sx) - Math.PI / 2 * facing * (sx * facing >= -0.5 ? 1 : 0.5);
  const fx = foot.x + Math.cos(ang) * 0.9 * facing, fy = foot.y - 0.7 + Math.sin(ang) * 0.4;
  r.ellipse(fx, fy, 1.9, 1.05, ang * 0.3, z + 0.3, BOOT, { group, far });
  r.stamp(fx - facing * 0.3, fy - 0.2, 0.6, 0.45, 0, COPPER, far ? 0 : 1.6, false, group);
  r.stamp(fx, fy + 0.7, 1.9, 0.3, 0, BOOT, 0, true, group);
}

function hand(r: CreatureRaster, h: V, e: V, z: number, group: number, far: boolean): void {
  const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy) || 1;
  r.ellipse(h.x + dx / d * 0.25, h.y + dy / d * 0.25, 0.95, 0.8, Math.atan2(dy, dx), z + 0.4, LEATHER, { group, far });
}

/** Draw the alchemist's body for a skeleton (alive or fallen). */
export function drawAlchemistBody(out: PixelSurface, field: LightField, ctx: Ctx, a: PlayerState, s: Skeleton,
  costumeIn: PlayerCostume | undefined, hatBody: RigidBody | null, alpha = 1): void {
  const f = s.facing, frame = ctx.state.frameCount;
  // Cloth that isn't hanging on this body (not yet re-anchored after a
  // teleport or respawn) is left out for the frame rather than stretched.
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
  if (s.wand.visible) { x0 = Math.min(x0, s.wand.x - 14); x1 = Math.max(x1, s.wand.x + 14); y0 = Math.min(y0, s.wand.y - 14); y1 = Math.max(y1, s.wand.y + 14); }
  if (hatBody) { x0 = Math.min(x0, hatBody.x - 8); x1 = Math.max(x1, hatBody.x + 8); y0 = Math.min(y0, hatBody.y - 8); y1 = Math.max(y1, hatBody.y + 8); }
  r.begin(step, x0 - 8, y0 - 8, x1 + 8, y1 + 8, MATS, a.x, a.y);
  r.outline = 1; r.bands = 0.7; r.dither = false; r.blend = 1.4;
  const dead = s.kind === 'dead';

  // --- Behind: far arm, far leg, rear coat tail, mantle hem ---
  limb(r, s.chest, s.backElbow, 0.95, 0.8, -6, COAT_D, 2, true);
  limb(r, s.backElbow, s.backHand, 0.82, 0.62, -6, COAT_D, 2, true);
  hand(r, s.backHand, s.backElbow, -6, 2, true);
  limb(r, s.hip, s.backKnee, 1.2, 0.95, -5, COAT_D, 3, true);
  limb(r, s.backKnee, s.backFoot, 0.95, 0.8, -5, BOOT, 3, true);
  boot(r, s.backFoot, s.backKnee, f, -5, 3, true);
  if (costume) {
    chainTube(r, costume.tails[0], -4, COAT_D, { group: 4 }, 1.25, 1.5);
    chainTube(r, costume.mantle, -3, MANTLE, { group: 5, far: true }, 0.8, 1.0);
  }
  // --- Torso: coat, belt, bandolier and the glowing vial ---
  const mid = { x: (s.hip.x + s.chest.x) / 2, y: (s.hip.y + s.chest.y) / 2 };
  r.capsule(s.hip.x, s.hip.y, 2.0 + s.crouch * 0.4, mid.x, mid.y, 2.2, 0, 0, COAT, { group: 1 });
  r.capsule(mid.x, mid.y, 2.2, s.chest.x, s.chest.y, 2.5, 0, 0.5, COAT, { group: 1 });
  // Coat front panel darker on the far side of the body.
  r.shade(s.hip.x - f * 1.2 + (s.chest.x - s.hip.x) * 0.5, mid.y, 1.2, 3.2, s.lean, -0.8, 1);
  const ux = s.chest.x - s.hip.x, uy = s.chest.y - s.hip.y;
  const belt = { x: s.hip.x + ux * 0.12, y: s.hip.y + uy * 0.12 };
  r.stamp(belt.x, belt.y, 2.3, 0.6, Math.atan2(uy, ux) + Math.PI / 2, LEATHER, 1, false, 1);
  r.dot(belt.x + f * 0.4, belt.y, COPPER, 3, 5);
  // Pouches on the belt.
  r.ellipse(belt.x - f * 2.1, belt.y + 0.8, 1.1, 1.2, 0, 2.5, LEATHER, { group: 6 });
  r.ellipse(belt.x + f * 1.9, belt.y + 0.6, 0.95, 1.05, 0, 2.5, LEATHER, { group: 6 });
  // Bandolier diagonal with the vial.
  const shoulderBack = { x: s.chest.x - f * 1.6, y: s.chest.y - 0.4 }, hipFront = { x: s.hip.x + f * 1.6, y: s.hip.y - 0.2 };
  r.stroke(shoulderBack.x, shoulderBack.y, hipFront.x, hipFront.y, LEATHER, 1.5, false, 0.35);
  const vb = costume?.vial ?? 0;
  const vx = s.chest.x + (hipFront.x - s.chest.x) * 0.45 + f * 0.6, vy = s.chest.y + (hipFront.y - s.chest.y) * 0.45 + vb * 0.4;
  r.ellipse(vx, vy, 0.7, 1.05, vb * 0.2, 3, dead ? GLASS : CYAN, { group: 7 });
  // --- Near leg over the coat body ---
  limb(r, s.hip, s.frontKnee, 1.25, 1.0, 3, COAT_D, 8);
  limb(r, s.frontKnee, s.frontFoot, 1.0, 0.85, 3, BOOT, 8);
  boot(r, s.frontFoot, s.frontKnee, f, 3, 8, false);
  if (costume) chainTube(r, costume.tails[1], 3.5, COAT, { group: 9 }, 1.2, 1.45);
  // Blood soak: the hem and boots redden as he wades (player.bloodStain).
  const stain = Math.min(1, a.bloodStain / 1000);
  if (stain > 0.05) {
    const feetY = Math.max(s.backFoot.y, s.frontFoot.y);
    for (const p of [s.backFoot, s.frontFoot]) r.shade(p.x, p.y - 1, 2.4, 2.2 + stain * 2, 0, -0.5 * stain);
    r.stamp(s.frontFoot.x, feetY - 0.8, 2.2, 0.6 + stain * 1.2, 0, BLOOD, 1 + stain, false, 8);
    r.stamp(s.backFoot.x, feetY - 0.8, 2.2, 0.6 + stain * 1.2, 0, BLOOD, 1 + stain, false, 3);
  }
  // --- Mantle over the shoulders ---
  r.ellipse(s.chest.x - f * 0.3, s.chest.y - 0.1, 2.9, 1.45, s.lean * 0.8 + f * 0.1, 2, MANTLE, { group: 10 });
  r.shade(s.chest.x - f * 0.3, s.chest.y + 0.7, 2.7, 0.6, s.lean, -0.9, 10);
  // --- Head ---
  limb(r, s.neck, s.head, 0.85, 0.9, 3, SKIN, 11);
  const ht = s.headTilt, hc = Math.cos(ht), hs = Math.sin(ht);
  const H = (side: number, up: number): [number, number] => [s.head.x + (side * f) * hc - (-up) * hs, s.head.y + (side * f) * hs + (-up) * hc];
  r.ellipse(s.head.x, s.head.y, 2.3, 2.45, ht, 4, SKIN, { group: 11 });
  // Profile: a proper nose, an ear, the beard along the jaw, a moustache.
  r.ellipse(...H(2.25, 0.05), 0.95, 0.72, ht + f * 0.25, 4.6, SKIN, { group: 11 });
  r.stamp(...H(-1.25, 0.2), 0.5, 0.7, ht, SKIN, 0.5, false, 11);
  r.stamp(...H(0.5, -1.55), 1.8, 0.95, ht, BEARD, 1, false, 11);
  r.stamp(...H(1.7, -0.75), 0.95, 0.35, ht, BEARD, 1.6, false, 11);
  if (s.mouth > 0.3) r.stamp(...H(1.55, -1.1), 0.5, 0.2 + s.mouth * 0.35, ht, EYE, 0, true, 11);
  // Eye: looks where he aims; shut in a blink, a wince, or death.
  const [ex, ey] = H(1.2, 0.72);
  if (s.eyesShut) r.stroke(ex - 0.55, ey, ex + 0.5, ey + 0.1, BEARD, 0, true);
  else {
    r.stamp(ex, ey, 0.55, 0.66, 0, EYE, 0, false, 11);
    r.dot(ex + 0.15 + s.gazeX * 0.2 * f, ey - 0.25 + s.gazeY * 0.15, GLINT, 1, 30);
  }
  // Brow under the brim's shadow.
  r.stroke(...H(0.5, 1.35), ...H(1.9, 1.25), BEARD, 1.2, true);
  r.shade(...H(0.6, 1.6), 2.2, 0.55, ht, -0.8, 11);
  // --- Hat: brim + crooked crown (its own chain), band and buckle ---
  if (!hatBody) drawHat(r, s, costume, f, H);
  else drawLooseHat(r, hatBody, alpha);
  // --- Near arm, wand and anything held ---
  if (s.held) {
    const h = s.held;
    const c = Math.cos(h.angle), sn = Math.sin(h.angle);
    const fill = ctx.flask?.state.material;
    r.ellipse(h.x + c * 0.9 * f, h.y + sn * 0.9, 1.5, 1.1, h.angle, 9, GLASS, { group: 12 });
    if (fill !== null && fill !== undefined && (ctx.flask?.state.count ?? 0) > 0) r.stamp(h.x + c * 1.1 * f, h.y + sn * 1.1 + 0.3, 1.1, 0.6, h.angle, LIQUID, 2, false, 12);
    r.capsule(h.x - c * 0.7 * f, h.y - sn * 0.7, 0.45, h.x - c * 1.5 * f, h.y - sn * 1.5, 0.35, 9.5, 9.5, WOOD, { group: 12 });
  }
  if (s.wand.visible) drawWand(r, s, frame);
  limb(r, s.chest, s.frontElbow, 1.0, 0.85, 8, COAT, 13);
  limb(r, s.frontElbow, s.frontHand, 0.85, 0.65, 8.5, COAT, 13);
  r.stamp((s.frontElbow.x + s.frontHand.x * 2) / 3, (s.frontElbow.y + s.frontHand.y * 2) / 3, 0.7, 0.7, 0, MANTLE, 1, false, 13);
  hand(r, s.frontHand, s.frontElbow, 8.5, 13, false);
  // --- Effects that belong to the body ---
  if (s.lift > 0) {
    // Levitation: a rune ring kindles under the boots.
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
  if (a.status.frozen > 0 && !dead) {
    r.ellipse(s.chest.x, (s.chest.y + s.hip.y) / 2, 4.2, 8.2, s.lean, 14, ICE, { group: 22, noOutline: true, depth: 0.2 });
  }
  if (a.status.burning > 0 && !dead) {
    for (let i = 0; i < 4; i++) {
      const fx = s.hip.x - 2.4 + i * 1.6, fy = s.chest.y - Math.sin(frame * 0.22 + i) * 2 + 1;
      r.ellipse(fx, fy, 0.9, 1.6 + Math.sin(frame * 0.5 + i) * 0.4, 0, 15, FLAME, { group: 23 + i, noOutline: true });
    }
  }
  const flash = !ctx.state.reduceFlashes && a.staggerT > 7 ? 0.18 : 0;
  sampleSceneLight(field, s.chest.x, s.chest.y, 10, flash, LIGHT, dead ? 0.15 : 1);
  // The hero stays readable in any gloom; the direction still comes from the lamps.
  LIGHT.r = Math.min(1.08, Math.max(0.74, LIGHT.r)); LIGHT.g = Math.min(1.08, Math.max(0.74, LIGHT.g)); LIGHT.b = Math.min(1.08, Math.max(0.76, LIGHT.b));
  r.resolve(out, LIGHT);
  if (a.status.electrified > 0 && frame % 4 !== 0 && !dead) {
    const arc = (out.setFinePx ?? out.setPx).bind(out);
    for (let i = 0; i < 6; i++) arc(s.chest.x - 4 + i * 1.6, s.chest.y - 3 + ((i * 7 + frame) % 5) - 2, 0.42, 0.86, 1);
  }
}

function drawHat(r: CreatureRaster, s: Skeleton, costume: PlayerCostume | undefined, f: number, H: (side: number, up: number) => [number, number]): void {
  const [bx, by] = H(-0.1, 2.15);
  const ba = s.brimAngle;
  // Crown first (behind the brim's front edge): a squat base rising into the chain.
  const [cx, cy] = H(-0.25, 3.5);
  r.ellipse(cx, cy, 2.35, 1.55, ba, 5.8, MANTLE, { group: 16 });
  if (costume) {
    const c = costume.crown;
    const root = c.pts[0];
    r.capsule(cx, cy - 0.4, 1.9, root.x, root.y, 1.7, 5.9, 6.0, MANTLE, { group: 16 });
    chainTube(r, c, 6.0, MANTLE, { group: 16 }, 1.7, 0.45);
    const tip = c.pts[c.pts.length - 1];
    r.ellipse(tip.x, tip.y, 0.62, 0.62, 0, 6.8, COPPER, { group: 17 });
    // The fold where the crooked crown bends over.
    r.shade(c.pts[1].x, c.pts[1].y, 1.3, 0.5, 0, -1.0, 16);
  }
  // Band and buckle around the crown's base.
  r.stamp(cx, cy + 0.55, 2.4, 0.5, ba, LEATHER, 1, false, 16);
  r.stamp(cx + f * 1.0, cy + 0.55, 0.5, 0.45, ba, COPPER, 2.5, false, 16);
  // Brim: broad, edge-on, drooping a touch at the tips; its underside in shadow.
  const bc = Math.cos(ba), bs = Math.sin(ba);
  r.capsule(bx - bc * 5.6, by - bs * 5.6 + 0.4, 0.5, bx, by, 0.75, 6.2, 6.4, MANTLE, { group: 15 });
  r.capsule(bx, by, 0.75, bx + bc * 5.9, by + bs * 5.9 + 0.35, 0.5, 6.4, 6.2, MANTLE, { group: 15 });
  r.shade(bx, by + 0.5, 5.8, 0.35, ba, -1.2, 15);
}

function drawLooseHat(r: CreatureRaster, hat: RigidBody, alpha: number): void {
  const px = hat.previousX ?? hat.x, py = hat.previousY ?? hat.y;
  const x = px + (hat.x - px) * alpha, y = py + (hat.y - py) * alpha, ang = hat.angle;
  const c = Math.cos(ang), s = Math.sin(ang);
  const P = (lx: number, ly: number): [number, number] => [x + lx * c - ly * s, y + lx * s + ly * c];
  r.capsule(...P(-4.2, 0.2), 0.55, ...P(4.2, 0.2), 0.5, 6, 6, MANTLE, { group: 15 });
  r.capsule(...P(0, -0.6), 2.3, ...P(-0.8, -3.4), 1.4, 6.5, 6.5, MANTLE, { group: 16 });
  r.capsule(...P(-0.8, -3.4), 1.4, ...P(-2.8, -3.9), 0.5, 6.6, 6.6, MANTLE, { group: 16 });
  r.stamp(...P(0, -0.9), 2.4, 0.5, ang, LEATHER, 1, false, 16);
}

function drawWand(r: CreatureRaster, s: Skeleton, frame: number): void {
  const w = s.wand, ang = w.angle + w.spin;
  const c = Math.cos(ang), sn = Math.sin(ang);
  const len = 9.5;
  const bx = w.x - c * 2.6, by = w.y - sn * 2.6, tx = w.x + c * len, ty = w.y + sn * len;
  r.capsule(bx, by, 0.45, tx, ty, 0.3, 8.2, 8.2, WOOD, { group: 14 });
  r.capsule(tx - c * 1.4, ty - sn * 1.4, 0.42, tx - c * 0.2, ty - sn * 0.2, 0.42, 8.3, 8.3, COPPER, { group: 14 });
  const glow = w.glow * (0.9 + Math.sin(frame * 0.3) * 0.1);
  r.ellipse(tx + c * 0.35, ty + sn * 0.35, 0.55 + glow * 0.35, 0.55 + glow * 0.35, 0, 9, CYAN, { group: 14, noOutline: true });
  r.glowStamp(tx + c * 0.35, ty + sn * 0.35, 0.55 + glow * 0.35, 0.55 + glow * 0.35, 0, CYAN, 1.5 + glow * 1.5, 0.8, 14);
}

/** The dropped wand after death: a rigid body whose light gutters out. */
export function drawDroppedWand(out: PixelSurface, field: LightField, wand: RigidBody, glow: number, alpha: number): void {
  const fine = out.setFinePx !== undefined && (out.pixelStep ?? 1) < 1;
  const r = sharedRaster;
  const px = wand.previousX ?? wand.x, py = wand.previousY ?? wand.y;
  const x = px + (wand.x - px) * alpha, y = py + (wand.y - py) * alpha, c = Math.cos(wand.angle), sn = Math.sin(wand.angle);
  r.begin(fine ? out.pixelStep ?? 1 : 1, x - 8, y - 8, x + 8, y + 8, MATS, x, y);
  r.capsule(x - c * 5.5, y - sn * 5.5, 0.45, x + c * 5.5, y + sn * 5.5, 0.3, 0, 0, WOOD, { group: 1 });
  r.capsule(x + c * 4.2, y + sn * 4.2, 0.42, x + c * 5.4, y + sn * 5.4, 0.42, 0.2, 0.2, COPPER, { group: 1 });
  if (glow > 0.03) {
    r.ellipse(x + c * 5.8, y + sn * 5.8, 0.5 + glow * 0.3, 0.5 + glow * 0.3, 0, 1, CYAN, { group: 2, noOutline: true });
  }
  sampleSceneLight(field, x, y, 6, 0, LIGHT, glow);
  r.resolve(out, LIGHT);
}

const SKEL_CACHE = new WeakMap<object, Skeleton>();

/** The living alchemist (production fine surface). Returns false where it can't draw. */
export function drawAlchemist(out: PixelSurface, field: LightField, ctx: Ctx): boolean {
  const a = ctx.player;
  if (!out.setFinePx) return false;
  let s = SKEL_CACHE.get(a);
  if (!s) { s = makeSkeleton(); SKEL_CACHE.set(a, s); }
  poseAlchemist(ctx, a, s);
  drawAlchemistBody(out, field, ctx, a, s, a.costume, null);
  return true;
}

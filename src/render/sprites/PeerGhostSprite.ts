import { VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx, PeerGhost } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import {
  PEER_FLAG_CLIMBING,
  PEER_FLAG_CRAWLING,
  PEER_FLAG_DEAD,
  PEER_FLAG_FIRING,
  PEER_FLAG_GROUNDED,
} from '@/net/authorLinkProtocol';

/**
 * Another window's wizard, drawn as a spectral phantom.
 *
 * ADDITIVE, NOT OPAQUE. Every pixel goes through `addPx`, so a peer glows over
 * the terrain instead of replacing it. That is not a stylistic accident — a
 * phantom is NOT simulated here, cannot be collided with, and must never look
 * like something you can stand on or shoot. Making it translucent says so
 * without a tutorial, the way Souls games do, and it also means a mispredicted
 * position can never occlude the level you are actually playing.
 *
 * The silhouette deliberately matches the player's proportions — pointed hat,
 * flared robe, ~17 cells — so it reads instantly as "a wizard like me", while
 * the colour and translucency say "not here, not yours".
 *
 * Kept simple on purpose: this reads a 8-field pose, not the 40 fields
 * `PlayerSprite` uses. Adding detail means adding wire traffic, and the point
 * of stage 3 is to learn whether streamed movement FEELS alive before paying
 * for fidelity nobody has asked for yet.
 */

/** Feet-to-hat, matching the player's ~17-cell stature. */
const HEIGHT = 17;

/** Spectral palette — cool, luminous, unmistakably not the local wizard. */
const HAT_R = 0.42, HAT_G = 0.78, HAT_B = 1.0;
const ROBE_R = 0.24, ROBE_G = 0.56, ROBE_B = 0.95;
const SKIN_R = 0.62, SKIN_G = 0.88, SKIN_B = 1.0;
const STAFF_R = 0.75, STAFF_G = 0.95, STAFF_B = 1.0;

export function drawPeerGhosts(out: PixelSurface, _light: LightField, ctx: Ctx): void {
  const ghosts = ctx.peers.sample(Date.now());
  if (ghosts.length === 0) return;
  const cam = ctx.camera;
  for (const ghost of ghosts) drawGhost(out, ctx, ghost, cam.x, cam.y);
}

function drawGhost(out: PixelSurface, ctx: Ctx, ghost: PeerGhost, camX: number, camY: number): void {
  const { pose } = ghost;
  const x = Math.round(pose.x);
  const y = Math.round(pose.y);

  // Cull off-camera phantoms before doing any per-pixel work; a peer in
  // another part of the level is common and costs nothing to skip.
  if (x < camX - 40 || x > camX + VIEW_W + 40) return;
  if (y < camY - 40 || y > camY + VIEW_H + 40) return;

  const dead = (pose.flags & PEER_FLAG_DEAD) !== 0;
  const crawling = (pose.flags & PEER_FLAG_CRAWLING) !== 0;
  const climbing = (pose.flags & PEER_FLAG_CLIMBING) !== 0;
  const grounded = (pose.flags & PEER_FLAG_GROUNDED) !== 0;
  const firing = (pose.flags & PEER_FLAG_FIRING) !== 0;

  // A dead peer lies low and dim rather than disappearing — vanishing on death
  // reads as a disconnect, which is a different and more alarming thing.
  const a = ghost.alpha * (dead ? 0.35 : 0.72);
  if (a <= 0.01) return;

  const f = pose.facing < 0 ? -1 : 1;
  // Idle breathing keeps a standing phantom from looking like a paused frame.
  const speed = Math.hypot(pose.vx, pose.vy);
  const breath = Math.sin(ctx.state.frameCount * 0.06) * 0.5;
  // Lean into travel: a small, cheap cue that reads as momentum.
  const lean = Math.max(-2, Math.min(2, pose.vx * 1.6));

  const px = (cx: number, cy: number, r: number, g: number, b: number, k: number): void => {
    out.addPx(cx, cy, r * k * a, g * k * a, b * k * a);
  };

  if (dead) {
    // Collapsed: a low mound roughly where the body fell.
    for (let dx = -5; dx <= 5; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        const edge = 1 - Math.abs(dx) / 6;
        px(x + dx, y - dy, ROBE_R, ROBE_G, ROBE_B, 0.5 * edge);
      }
    }
    return;
  }

  const prone = crawling;
  const height = prone ? 8 : HEIGHT;
  const top = y - height;

  // --- legs: stride so the phantom walks instead of gliding ---
  const stridePhase = pose.stride;
  const walking = grounded && speed > 0.05;
  const swing = walking ? Math.sin(stridePhase) * 2.2 : 0;
  const legTop = y - (prone ? 2 : 5);
  for (let leg = 0; leg < 2; leg++) {
    const dir = leg === 0 ? 1 : -1;
    const off = walking ? swing * dir : dir * 1.2;
    for (let cy = y; cy > legTop; cy--) {
      const t = (y - cy) / Math.max(1, y - legTop);
      const lx = x + Math.round(off * t) + (leg === 0 ? 1 : -2);
      px(lx, cy, ROBE_R * 0.7, ROBE_G * 0.7, ROBE_B * 0.9, 0.55);
    }
  }

  // --- robe: a flare that widens toward the hem ---
  const robeTop = top + (prone ? 3 : 8);
  for (let cy = legTop; cy >= robeTop; cy--) {
    const t = (legTop - cy) / Math.max(1, legTop - robeTop);
    const halfW = Math.round(4 - t * 1.6 + breath * 0.4);
    const shift = Math.round(lean * t);
    for (let dx = -halfW; dx <= halfW; dx++) {
      // Brighter at the silhouette edge: gives the figure a rim without an
      // outline pass, which additive blending cannot do cleanly anyway.
      const edge = Math.abs(dx) >= halfW - 1 ? 1.15 : 0.72;
      px(x + dx + shift, cy, ROBE_R, ROBE_G, ROBE_B, 0.6 * edge);
    }
  }

  // --- head ---
  const headY = robeTop - 2;
  const headShift = Math.round(lean);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = 0; dy < 3; dy++) {
      px(x + dx + headShift, headY - dy, SKIN_R, SKIN_G, SKIN_B, 0.62);
    }
  }

  // --- hat: the pointed cone that makes the silhouette unmistakable ---
  const hatBase = headY - 3;
  for (let dx = -4; dx <= 4; dx++) px(x + dx + headShift, hatBase, HAT_R, HAT_G, HAT_B, 0.85);
  for (let k = 1; k <= 4; k++) {
    const halfW = Math.max(0, 3 - k);
    // The tip trails backwards, so the hat reads as fabric rather than a cone.
    const tipLean = Math.round(-f * k * 0.5 + lean);
    for (let dx = -halfW; dx <= halfW; dx++) {
      px(x + dx + tipLean + headShift, hatBase - k, HAT_R, HAT_G, HAT_B, 0.8);
    }
  }

  // --- staff, aimed where the peer is aiming ---
  const gripX = x + f * 3 + headShift;
  const gripY = robeTop + 1;
  const ca = Math.cos(pose.aim);
  const sa = Math.sin(pose.aim);
  for (let d = -3; d <= 8; d++) {
    px(gripX + ca * d, gripY + sa * d, STAFF_R, STAFF_G, STAFF_B, d > 6 ? 1.1 : 0.6);
  }
  if (firing) {
    // A muzzle bloom, so a casting peer is legible at a glance.
    const tipX = gripX + ca * 8;
    const tipY = gripY + sa * 8;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const fall = 1 - Math.hypot(dx, dy) / 3;
        if (fall > 0) px(tipX + dx, tipY + dy, STAFF_R, STAFF_G, STAFF_B, fall * 1.3);
      }
    }
  }

  if (climbing) {
    // A pair of grip marks above the head sells "on a wall" without a pose rig.
    px(x + f * 4 + headShift, hatBase - 1, STAFF_R, STAFF_G, STAFF_B, 0.9);
    px(x + f * 4 + headShift, hatBase - 3, STAFF_R, STAFF_G, STAFF_B, 0.7);
  }
}

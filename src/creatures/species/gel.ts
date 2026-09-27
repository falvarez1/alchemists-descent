import type { Ctx, Enemy } from '@/core/types';
import { makeChain, shiftChain, stepChain } from '@/creatures/rig/chain';
import { makeSoftBody, softImpulse, stepSoftBody } from '@/creatures/rig/softbody';
import { makeRig } from '@/creatures/rig/types';
import type { CreatureRig } from '@/creatures/rig/types';

/**
 * Gel bodies: slimes, acid slimes and bombers are pressurised soft rings
 * that really squash on landing, stretch through a hop, pour over lips and
 * wobble when struck, with a nucleus that sloshes around inside. The gameplay
 * box still decides where the slime is; the gel decides what that looks like.
 */
export const GEL = {
  nucX: 0, nucY: 1, nucVX: 2, nucVY: 3,
  lastX: 4, lastY: 5, lastVy: 6, wasGrounded: 7,
  lastFlash: 8, face: 9, fuse: 10, heat: 11,
  rx: 12, ry: 13, bubble: 14,
} as const;

function dims(e: Enemy): [number, number] {
  if (e.kind === 'bomber') return [5.6, 4.6];
  if (e.kind === 'eggs') return [5, 3.5];
  return [6.2, 4.4];
}

export function buildGel(e: Enemy): CreatureRig {
  const rig = makeRig('gel');
  const [rx, ry] = dims(e);
  const cy = e.y + 1 - ry;
  rig.soft = makeSoftBody(e.x, cy, rx, ry, e.kind === 'bomber' ? 12 : 14, 0.4);
  rig.f[GEL.rx] = rx; rig.f[GEL.ry] = ry;
  rig.f[GEL.nucX] = e.x; rig.f[GEL.nucY] = cy;
  rig.f[GEL.lastX] = e.x; rig.f[GEL.lastY] = e.y;
  rig.f[GEL.face] = e.mind?.facing ?? 1;
  if (e.kind === 'bomber') rig.chains.push(makeChain(4, e.x, cy - ry, 0.2, -1, 1.3, 0.55, 0.35, 0.4));
  return rig;
}

export function stepGel(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  const F = rig.f, sb = rig.soft;
  if (!sb) return;
  const world = ctx.world, tick = ctx.state.frameCount;
  const rx = F[GEL.rx], ry = F[GEL.ry];
  const x = e.x + e.fx, y = e.y + e.fy;
  const vx = x - F[GEL.lastX], vy = y - F[GEL.lastY];
  F[GEL.lastX] = x; F[GEL.lastY] = y;
  F[GEL.face] += ((e.mind?.facing ?? 1) - F[GEL.face]) * 0.2;
  // Shape intent: gather before the hop, stretch in flight, inflate on the fuse.
  const windup = e.windup ?? 0;
  let sx = 1, sy = 1;
  const breath = Math.sin(tick * 0.06 + e.bobPhase) * 0.035;
  if (e.grounded) { sx = 1 + breath; sy = 1 - breath; }
  if (windup > 0) { const k = Math.min(1, (12 - Math.min(12, windup)) / 8 + 0.35); sx = 1 + 0.26 * k; sy = 1 - 0.3 * k; }
  if (!e.grounded) {
    const up = Math.max(-1, Math.min(1, -vy / 3));
    sx = 1 - 0.16 * Math.abs(up); sy = 1 + 0.2 * Math.abs(up);
  }
  const fusing = e.fusing ?? 0;
  if (e.kind === 'bomber') {
    F[GEL.fuse] += ((fusing > 0 ? 1 - fusing / 36 : 0) - F[GEL.fuse]) * 0.3;
    const swell = 1 + F[GEL.fuse] * 0.5 + (fusing > 0 ? Math.sin(tick * 0.9) * 0.05 * F[GEL.fuse] : 0);
    sx *= swell; sy *= swell;
  }
  // Anchor the centroid so the belly stays on the floor however it deforms.
  const ax = x, ay = y + 1 - ry * sy;
  stepSoftBody(world, sb, ax, ay, {
    gravity: 0.14, damping: 0.9, wetDamping: 0.8, buoyancy: 0.4, friction: 0.55,
    shape: e.kind === 'bomber' ? 0.28 : 0.2, pressure: 0.55, follow: e.grounded ? 0.42 : 0.6,
    scaleX: sx, scaleY: sy, angle: Math.max(-0.35, Math.min(0.35, vx * 0.12)),
  });
  // Landing: the fall is spent as a splat — the ring flattens and recovers.
  if (e.grounded && F[GEL.wasGrounded] === 0 && F[GEL.lastVy] > 1.0) {
    softImpulse(sb, 0, Math.min(2.2, F[GEL.lastVy] * 0.5), 0.35);
  }
  F[GEL.wasGrounded] = e.grounded ? 1 : 0;
  F[GEL.lastVy] = vy;
  // (A blow's dent is answered generically in species/index answerHit.)
  F[GEL.lastFlash] = e.flash;
  // Nucleus: a heavy organelle sloshing on a soft spring inside the gel.
  const tx = sb.cx - vx * 1.8 + F[GEL.face] * 0.6, ty = sb.cy + ry * 0.18 - vy * 0.8;
  F[GEL.nucVX] = F[GEL.nucVX] * 0.84 + (tx - F[GEL.nucX]) * 0.1;
  F[GEL.nucVY] = F[GEL.nucVY] * 0.84 + (ty - F[GEL.nucY]) * 0.1;
  F[GEL.nucX] += F[GEL.nucVX]; F[GEL.nucY] += F[GEL.nucVY];
  const ndx = F[GEL.nucX] - sb.cx, ndy = F[GEL.nucY] - sb.cy, nd = Math.hypot(ndx / (rx * 0.5), ndy / (ry * 0.45));
  if (nd > 1) { F[GEL.nucX] = sb.cx + ndx / nd; F[GEL.nucY] = sb.cy + ndy / nd; }
  // Bomber wick: a short fuse that flops with the body.
  const wick = rig.chains[0];
  if (wick) {
    let top = sb.pts[0];
    for (const p of sb.pts) if (p.y < top.y) top = p;
    if (Math.abs(wick.pts[0].x - top.x) > 30) shiftChain(wick, top.x - wick.pts[0].x, top.y - wick.pts[0].y);
    stepChain(world, wick, top.x - F[GEL.face] * 0.8, top.y + 0.4, -F[GEL.face] * 0.35, -1, {
      gravity: 0.06, damping: 0.86, stiffness: 0.45, rootStiffness: 0.7, curl: -F[GEL.face] * 0.25, collide: false,
    });
  }
  F[GEL.bubble] = (F[GEL.bubble] + 0.02 + (e.kind === 'acidslime' ? 0.015 : 0)) % 1;
  F[GEL.heat] += ((e.kind === 'bomber' ? 0.4 + F[GEL.fuse] * 0.6 : 0) - F[GEL.heat]) * 0.1;
}

/* ---------------- Egg clutch ---------------- */

export const EGG = { wob: 0, twitch: 8, lastFlash: 16 } as const;

export function buildEggs(e: Enemy): CreatureRig {
  const rig = makeRig('eggs', 24);
  rig.f[EGG.lastFlash] = e.flash;
  return rig;
}

export function stepEggs(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  const F = rig.f, tick = ctx.state.frameCount;
  // Each egg wobbles on its own spring; a hit sets them all quivering.
  const hit = e.flash > F[EGG.lastFlash] && e.flash >= 5;
  F[EGG.lastFlash] = e.flash;
  const ripe = Math.min(1, e.timer / (1400 + e.bobPhase * 220));
  for (let i = 0; i < 4; i++) {
    const w = EGG.wob + i * 2;
    const kick = hit ? (i % 2 ? 0.5 : -0.5) : 0;
    // Embryos twitch more as they ripen.
    const twitch = Math.sin(tick * (0.07 + i * 0.013) + i * 1.7) > 0.985 - ripe * 0.04 ? (i % 2 ? 0.18 : -0.18) : 0;
    F[w + 1] = F[w + 1] * 0.8 + (-F[w] * 0.12) + kick + twitch;
    F[w] += F[w + 1];
    F[EGG.twitch + i] = F[EGG.twitch + i] * 0.85 + Math.abs(twitch) * 3;
  }
}

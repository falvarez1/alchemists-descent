import type { Ctx, Enemy } from '@/core/types';
import { makeChain, shiftChain, stepChain } from '@/creatures/rig/chain';
import { point, translate } from '@/creatures/rig/physics';
import { makeRig } from '@/creatures/rig/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { leviathanLureDim } from '@/creatures/bosses/leviathan';

/**
 * Long bodies. The Rillback and Stone Maw already own a physical chain
 * (creatures/body — tested, and gameplay-bearing: tails trap, bodies take
 * hits); their rigs only keep the springs for jaws, gills, feelers and the
 * leg wave. The Leviathan gets a real chain here: its body used to be a
 * sine wave painted behind the head.
 */
export const SRP = {
  jaw: 0, jawV: 1, gill: 2, walk: 3, lastX: 4, lastY: 5, face: 6, charge: 7,
  antA: 8, antAV: 9, antB: 10, antBV: 11, speed: 12, swim: 13, lure: 14, beach: 15,
} as const;

export function buildEel(e: Enemy): CreatureRig {
  const rig = makeRig('eel');
  rig.f[SRP.lastX] = e.x; rig.f[SRP.lastY] = e.y; rig.f[SRP.face] = e.mind?.facing ?? 1;
  return rig;
}

/** Shared jaw/gill/feeler springs for the chain-bodied hunters. */
export function stepEel(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  const F = rig.f, tick = ctx.state.frameCount;
  const x = e.x + e.fx, y = e.y + e.fy;
  const vx = x - F[SRP.lastX], vy = y - F[SRP.lastY];
  F[SRP.lastX] = x; F[SRP.lastY] = y;
  const sp = Math.abs(vx) + Math.abs(vy) < 20 ? Math.hypot(vx, vy) : 0;
  F[SRP.speed] += (sp - F[SRP.speed]) * 0.2;
  F[SRP.walk] += sp * 0.9 + 0.01;
  F[SRP.face] += ((e.mind?.facing ?? 1) - F[SRP.face]) * 0.15;
  const windup = (e.windup ?? 0) > 0, swoop = (e.swoop ?? 0) > 0;
  const chew = (e.mawChewT ?? 0) > 0, feed = (e.rillFeedT ?? 0) > 0;
  let want = e.expression?.jaw ?? 0;
  if (windup) want = 1;
  if (swoop) want = 0.15;
  if (chew || feed) want = 0.45 + Math.sin(tick * 0.5) * 0.4;
  F[SRP.jawV] = F[SRP.jawV] * 0.55 + (want - F[SRP.jaw]) * 0.4;
  F[SRP.jaw] = Math.max(0, Math.min(1.1, F[SRP.jaw] + F[SRP.jawV]));
  F[SRP.gill] += ((e.expression?.alert ?? 0) * 0.7 + (windup ? 0.5 : 0) + Math.sin(tick * 0.08) * 0.1 - F[SRP.gill]) * 0.12;
  F[SRP.charge] += ((e.rillChargeWindup ?? 0) > 0 || e.blink > 0 ? 1 : -F[SRP.charge] * 0.5) * 0.15;
  F[SRP.charge] = Math.max(0, Math.min(1, F[SRP.charge]));
  // Feelers: sprung, twitching toward what the animal senses.
  const sensed = (e.mind?.confidence ?? 0) > 0.12;
  const tgtA = sensed ? -0.5 : Math.sin(tick * 0.05 + e.bobPhase) * 0.6;
  const tgtB = sensed ? 0.4 : Math.sin(tick * 0.043 + e.bobPhase + 2) * 0.6;
  F[SRP.antAV] = F[SRP.antAV] * 0.8 + (tgtA - F[SRP.antA]) * 0.08 + (tick % 37 === 0 ? 0.25 : 0);
  F[SRP.antBV] = F[SRP.antBV] * 0.8 + (tgtB - F[SRP.antB]) * 0.08 - (tick % 41 === 0 ? 0.25 : 0);
  F[SRP.antA] += F[SRP.antAV]; F[SRP.antB] += F[SRP.antBV];
  F[SRP.swim] += 0.12 + F[SRP.speed] * 0.35;
}

/* ---------------- Leviathan ---------------- */

export const LEV_LINKS = 13;

export function buildLeviathan(e: Enemy): CreatureRig {
  const rig = makeRig('leviathan');
  const f = e.mind?.facing ?? 1;
  rig.pts.push(point(e.x + f * 6, e.y - 10, 2.5));
  const c = makeChain(LEV_LINKS, e.x + f * 2, e.y - 9, -f, 0, 4.3, 7.8, 1.3, 1.2);
  for (let i = 0; i < LEV_LINKS; i++) c.radius[i] = 7.8 * Math.pow(1 - i / LEV_LINKS, 0.8) + 1.2;
  rig.chains.push(c);
  rig.chains.push(makeChain(6, e.x + f * 6, e.y - 18, f * 0.3, -1, 2.4, 0.5, 0.35, 0));
  rig.f[SRP.lastX] = e.x; rig.f[SRP.lastY] = e.y; rig.f[SRP.face] = f;
  return rig;
}

export function stepLeviathan(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  stepEel(ctx, e, rig);
  const world = ctx.world, F = rig.f, tick = ctx.state.frameCount;
  const fs = F[SRP.face];
  const head = rig.pts[0];
  const hx = e.x + e.fx + fs * 6, hy = e.y + e.fy - 10;
  if (Math.abs(head.x - hx) + Math.abs(head.y - hy) > 40) {
    const dx = hx - head.x, dy = hy - head.y;
    translate(head, dx, dy);
    for (const c of rig.chains) shiftChain(c, dx, dy);
  }
  head.px = head.x; head.py = head.y;
  head.x += (hx - head.x) * 0.5; head.y += (hy - head.y) * 0.5;
  const sub = e.submerged === true;
  F[SRP.beach] += ((sub ? 0 : 1) - F[SRP.beach]) * 0.1;
  // The body follows the head through the water with a travelling wave;
  // beached, it is just heavy meat that gravity lays on the tiles.
  const body = rig.chains[0];
  const wave = Math.sin(F[SRP.swim]) * (sub ? 0.35 : 0.12);
  stepChain(world, body, head.x - fs * 3.5, head.y + 0.5, -fs, wave, {
    gravity: sub ? 0.015 : 0.35, damping: sub ? 0.86 : 0.8, wetDamping: 0.84, buoyancy: 0.05, friction: 0.5,
    stiffness: sub ? 0.16 : 0.1, rootStiffness: 0.7, curl: Math.sin(F[SRP.swim] - 1) * (sub ? 0.06 : 0.02) * fs,
    iterations: 3, collide: true,
  });
  // The angler lure bobs on its stalk, drawn toward whatever it hunts.
  const lure = rig.chains[1];
  const tx = (e.mind?.targetX ?? head.x) - head.x;
  stepChain(world, lure, head.x + fs * 2, head.y - 6.2, fs * 0.5 + Math.max(-0.4, Math.min(0.4, tx / 200)), -1, {
    gravity: 0.03, damping: 0.88, stiffness: 0.25, rootStiffness: 0.8, curl: fs * 0.22, collide: false,
  });
  // The lure goes dark before it strikes (the lunge/dive tell), flickers when shocked.
  const dim = leviathanLureDim(e);
  F[SRP.lure] += ((0.65 + Math.sin(tick * 0.07 + e.bobPhase) * 0.35) * (1 - dim * 0.92) - F[SRP.lure]) * (dim > 0.5 ? 0.35 : 0.12);
}

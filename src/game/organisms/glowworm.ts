import type { Critter, Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type { OrganismHost } from './common';
import { enemyWithin, isHot, organismEvent, playerGap, solidAt, typeAt, wandLightAt } from './common';
import {
  GLOW, GLOW_HIDE, GLOW_LIGHT_SHY, GLOW_LOWER, GLOW_MEAL, GLOW_REEL, GLOW_RETRACT, SNARE_PREY, critterKey,
} from './types';

/**
 * GLOW-WORM — a pale larva on a cave ceiling that fishes with light. It pays
 * out a sticky thread beaded with luminous droplets; moths and flies drawn to
 * the beads stick, and the worm reels them up and eats them (its belly glows
 * for a while after). It is light-shy and nervous: sweep the wand over it, brush
 * the thread, or stamp about beneath it and it hauls the whole lure up and
 * hides for a few seconds. Hood the lantern and the threads come back down.
 *
 * Grid honesty: the thread hangs in real open cells (it stops on anything
 * solid), the worm dies if its ceiling is dug out, burned or dissolved.
 */

/** A glow-worm pays out a small curtain: [x offset, share of the full length, sway phase]. */
export const GLOW_THREADS: ReadonlyArray<readonly [number, number, number]> = [[0, 1, 0], [-1.5, 0.62, 1.7], [1.4, 0.8, 3.1]];

/** Thread x at height y — a slow sway that grows toward the tip. */
export function glowThreadX(c: Critter, y: number, thread = 0): number {
  const ax = c.anchorX ?? c.x, ay = c.anchorY ?? c.y, reach = Math.max(4, c.reach ?? 16);
  const [ox, , ph] = GLOW_THREADS[thread] ?? GLOW_THREADS[0];
  const down = Math.max(0, y - ay);
  return ax + 0.5 + ox + Math.sin(c.phase * 1.3 + ph + down * 0.16) * Math.min(1.4, down / reach * 1.7);
}

/** How strongly the wand's beam falls on the worm: its body, the middle and the tip of its lure. */
function litWorm(ctx: Ctx, c: Critter): number {
  const ax = (c.anchorX ?? c.x) + 0.5, ay = c.anchorY ?? c.y, ext = Math.max(c.extent ?? 0, 4);
  let lit = wandLightAt(ctx, ax, ay + 1.5);
  for (const k of [0.5, 1]) lit = Math.max(lit, wandLightAt(ctx, glowThreadX(c, ay + ext * k), ay + ext * k));
  return lit;
}

function pinPrey(c: Critter, prey: Critter, t: number): void {
  const ay = c.anchorY ?? c.y, tip = ay + (c.extent ?? 0);
  prey.x = glowThreadX(c, tip) + Math.sin(t * 0.9 + prey.phase) * 0.35;
  prey.y = tip + 0.6;
  prey.vx = 0; prey.vy = 0;
}

function release(host: OrganismHost, c: Critter): void {
  const prey = host.find(c.holds);
  if (prey) { prey.heldBy = undefined; prey.startle = 12; prey.vy = 0.4; }
  c.holds = undefined;
}

export function stepGlowworm(ctx: Ctx, c: Critter, host: OrganismHost): boolean {
  const ax = c.anchorX ?? Math.floor(c.x), ay = c.anchorY ?? Math.floor(c.y);
  c.anchorX = ax; c.anchorY = ay; c.x = ax + 0.5; c.y = ay + 0.5;
  const t = ctx.state.frameCount;
  // The roof it hangs from was dug away, or its hole filled: it drops and dies.
  const here = typeAt(ctx, ax, ay);
  if (!solidAt(ctx, ax, ay - 1) || solidAt(ctx, ax, ay) || isHot(here) || here === Cell.Acid) {
    release(host, c);
    ctx.particles.burst(ax, ay, 4, null, () => packRGB(150, 220, 205), 0.8, { glow: 1.4, grav: 0.06 });
    organismEvent(ctx, 'glowworm', 'die', ax, ay);
    return false;
  }
  c.phase += 0.02;
  c.stateT = (c.stateT ?? 0) + 1;
  if ((c.meal ?? 0) > 0) c.meal = (c.meal ?? 0) - 1;
  const reach = Math.max(4, c.reach ?? 16);
  let ext = c.extent ?? 0;
  const state = c.state ?? GLOW.FISH;

  // ---- disturbance: light on its body, a body through the thread, stamping below ----
  let disturbed = false;
  if ((t + ax) % 3 === 0) {
    // The beam on its body or anywhere down its lure.
    const lit = litWorm(ctx, c);
    if (lit > GLOW_LIGHT_SHY) disturbed = true;
    const tipY = ay + ext;
    const p = ctx.player;
    const probeY = Math.max(ay, Math.min(tipY, p.y - 8));
    if (ext > 1.5 && playerGap(ctx, glowThreadX(c, probeY), probeY) <= 1.2) disturbed = true;
    else if (Math.abs(p.x - ax) < 16 && p.y > ay && p.y - 17 < tipY + 10 && Math.abs(p.vx) + Math.abs(p.vy) > 1.8) disturbed = true;
    if (!disturbed && ext > 1.5) {
      const e = enemyWithin(ctx, glowThreadX(c, ay + ext * 0.6), ay + ext * 0.6, 1.5, false);
      if (e) disturbed = true;
    }
  }

  if (state === GLOW.FISH) {
    // Pay out the lure a little at a time; the thread stops on whatever is below.
    if (ext < reach && !solidAt(ctx, glowThreadX(c, ay + ext + 1), ay + ext + 1)) ext = Math.min(reach, ext + GLOW_LOWER);
    if (disturbed) {
      c.state = GLOW.RETRACT; c.stateT = 0;
      organismEvent(ctx, 'glowworm', 'retract', ax, ay);
    } else if (ext > 2 && t % 2 === 0) {
      // Anything small and airborne that blunders into the beaded thread sticks.
      for (const prey of host.list) {
        if (!SNARE_PREY.has(prey.kind) || prey.heldBy || (prey.dead ?? 0) > 0) continue;
        if (prey.y < ay + 1 || Math.abs(prey.x - ax) > 4) continue;
        let stuck = false;
        for (let k = 0; k < GLOW_THREADS.length && !stuck; k++) {
          stuck = prey.y <= ay + ext * GLOW_THREADS[k][1] + 0.8 && Math.abs(prey.x - glowThreadX(c, prey.y, k)) <= 1.25;
        }
        if (!stuck) continue;
        prey.heldBy = critterKey(c);
        c.holds = critterKey(prey);
        c.state = GLOW.REEL; c.stateT = 0;
        ext = Math.max(1, prey.y - ay - 0.6);
        ctx.particles.burst(prey.x, prey.y, 3, null, () => packRGB(170, 240, 230), 0.4, { glow: 1.6, grav: 0.01 });
        organismEvent(ctx, 'glowworm', 'snare', prey.x, prey.y); // the stuck flutter: audio/EventCues
        break;
      }
    }
  } else if (state === GLOW.REEL) {
    const prey = host.find(c.holds);
    if (!prey) { c.holds = undefined; c.state = GLOW.FISH; c.stateT = 0; }
    else {
      ext = Math.max(0, ext - (disturbed ? GLOW_REEL * 3 : GLOW_REEL));
      pinPrey(c, prey, t);
      if (ext <= 1.1) {
        host.remove(prey);
        c.holds = undefined;
        c.meal = GLOW_MEAL;
        c.state = GLOW.FISH; c.stateT = 0;
        ctx.particles.burst(ax + 0.5, ay + 1, 3, null, () => packRGB(120, 255, 220), 0.5, { glow: 2, grav: -0.01 });
        organismEvent(ctx, 'glowworm', 'eat', ax, ay);
      }
    }
  } else {
    ext = Math.max(0, ext - GLOW_RETRACT);
    if (c.holds) release(host, c);
    const hide = GLOW_HIDE + (ax * 37 + ay * 11) % 140;
    const lit = litWorm(ctx, c);
    if (lit > GLOW_LIGHT_SHY) c.stateT = Math.min(c.stateT ?? 0, 60); // it will not come down into the beam
    if ((c.stateT ?? 0) > hide && !disturbed) {
      c.state = GLOW.FISH; c.stateT = 0;
      organismEvent(ctx, 'glowworm', 'lower', ax, ay); // the lure comes back down
    }
  }
  c.extent = ext;
  return true;
}

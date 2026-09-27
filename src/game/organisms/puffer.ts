import type { Critter, Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type { OrganismHost } from './common';
import { critterWithin, enemyWithin, hotNear, organismEvent, playerGap, projectileWithin, solidAt } from './common';
import { PUFF, PUFF_GROW, PUFF_RADIUS, PUFF_RADIUS_K, PUFF_RIPE } from './types';

/**
 * SPORE PUFFER — a fungal bladder that slowly fills with bog gas. Ripe, it
 * bursts at a touch: a body brushing it, a bolt passing through, a kick's
 * gust, a blast nearby — or flame, which lights the cloud as it leaves the
 * sac. The cloud is REAL marsh gas written into the open cells around it: it
 * rises, pools under the ceiling and burns as a racing front. A spent sac
 * sags and slowly refills (the same individual — populations don't churn).
 */

const TRIGGER_KINDS = new Set<Critter['kind']>(['beetle', 'isopod', 'emberbeetle', 'fly', 'moth']);

/** Where the sac sits: one stalk-length out from the rooting cell along its normal. */
export function pufferSac(c: Critter): { x: number; y: number; r: number } {
  const ax = (c.anchorX ?? c.x) + 0.5, ay = (c.anchorY ?? c.y) + 0.5;
  const nx = c.nx ?? 0, ny = c.ny ?? -1, inf = c.extent ?? 0;
  const r = 1.3 + inf * 2.3;
  const stalk = 1.2 + r * 0.8;
  return { x: ax + nx * stalk, y: ay + ny * stalk, r };
}

/** Burst: write the gas, loose the spores, tell anything listening. */
export function burstPuffer(ctx: Ctx, c: Critter): void {
  const { x, y } = pufferSac(c);
  const inf = c.extent ?? 0;
  const R = PUFF_RADIUS + inf * PUFF_RADIUS_K;
  const w = ctx.world;
  let written = 0;
  for (let dy = -Math.ceil(R); dy <= Math.ceil(R); dy++) {
    for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const X = Math.floor(x + dx), Y = Math.floor(y + dy - 1); // the cloud leaves slightly upward
      if (!w.inBounds(X, Y)) continue;
      const i = w.idx(X, Y);
      if (w.types[i] !== Cell.Empty) continue;
      // A deterministic lattice, not a solid ball: the cloud reads as puffs.
      if (((X * 7 + Y * 13) & 3) === 0) continue;
      w.replaceCellAt(i, Cell.MarshGas, packRGB(118 + ((X + Y) & 7) * 3, 134, 84));
      written++;
    }
  }
  ctx.particles.burst(x, y, 10 + Math.round(inf * 12), null, () => packRGB(150, 210, 120), 1.4 + inf, { glow: 1.1, grav: -0.02 });
  ctx.particles.burst(x, y, 6, null, () => packRGB(120, 110, 70), 0.9, { grav: 0.03 });
  ctx.audio.at(x, y, () => { ctx.audio.noiseBurst(0.14, 700, 0.06); ctx.audio.squelch(x, y); }, 260);
  ctx.events.emit('creatureSignal', { x, y, radius: 90, strength: 0.5, kind: 'sound' });
  organismEvent(ctx, 'puffer', 'burst', x, y);
  c.extent = 0;
  c.state = PUFF.SPENT;
  c.stateT = 0;
  c.meal = written;
}

export function stepPuffer(ctx: Ctx, c: Critter, host: OrganismHost): boolean {
  const ax = c.anchorX ?? Math.floor(c.x), ay = c.anchorY ?? Math.floor(c.y);
  const nx = c.nx ?? 0, ny = c.ny ?? -1;
  // Its footing is gone (dug, blasted, dissolved): the bladder is torn loose.
  if (!solidAt(ctx, ax - nx, ay - ny)) {
    if ((c.extent ?? 0) > 0.15) burstPuffer(ctx, c);
    organismEvent(ctx, 'puffer', 'die', ax, ay);
    return false;
  }
  c.stateT = (c.stateT ?? 0) + 1;
  c.phase += 0.03;
  let inf = c.extent ?? 0;
  if (c.state === PUFF.SPENT && (c.stateT ?? 0) > 240) c.state = PUFF.GROW;
  if (c.state !== PUFF.SPENT) inf = Math.min(1, inf + PUFF_GROW);
  c.extent = inf;
  const sac = pufferSac(c);
  c.x = sac.x; c.y = sac.y;
  if (inf < PUFF_RIPE) return true;
  const t = ctx.state.frameCount;
  const reach = sac.r + 1.5;
  // Flame bursts it at once (and lights what it lets out — the grid does that part).
  const hot = (t + ax) % 4 === 0 && hotNear(ctx, sac.x, sac.y, sac.r + 2) > 0;
  const touched = hot || playerGap(ctx, sac.x, sac.y) <= reach ||
    projectileWithin(ctx, sac.x, sac.y, sac.r + 3) !== null ||
    enemyWithin(ctx, sac.x, sac.y, reach, false) !== null ||
    ((t + ay) % 3 === 0 && critterWithin(host, c, sac.x, sac.y, sac.r + 0.8, TRIGGER_KINDS) !== null);
  if (touched) burstPuffer(ctx, c);
  return true;
}

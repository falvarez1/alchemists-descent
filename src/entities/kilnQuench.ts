import type { Ctx, Enemy, EnemyDef } from '@/core/types';
import { entityRandom } from '@/core/simRandom';
import { Cell } from '@/sim/CellType';
import { packRGB, steamColor, stoneColor } from '@/sim/colors';

/**
 * THE KILN CRACKS. The presentation of one thermal-shock burst on the Kiln
 * Colossus (the damage and its cadence are core/bossWard's KILN_QUENCH): the
 * water on its body flashes to REAL steam, the stone skin spits shards and
 * glowing cracks, the world hitches, the kiln roars and hisses, a callout names
 * it, and it staggers. Replaces a silent 84 hp/s drain nobody could read.
 */

/** Water this close around the body flashes to steam in one crack. */
const QUENCH_STEAM_MARGIN = 2;
/** ...at most this many cells per crack — the rest of the flood stays on the
 *  floor to soak it again (a flood is a handful of cracks, not one). */
const QUENCH_STEAM_CAP = 24;
/** The crack staggers it: no attacks for 2 s. */
export const QUENCH_STAGGER_TICKS = 120;

export function kilnQuenchBurst(ctx: Ctx, e: Enemy, def: EnemyDef): void {
  const w = ctx.world;
  const bx = Math.floor(e.x);
  const by = Math.floor(e.y);
  // 1) The water on it boils off: real Steam cells (grid-honest), capped.
  let flashed = 0;
  for (let y = by - def.h - QUENCH_STEAM_MARGIN; y <= by + 1 && flashed < QUENCH_STEAM_CAP; y++) {
    for (let x = bx - def.halfW - QUENCH_STEAM_MARGIN; x <= bx + def.halfW + QUENCH_STEAM_MARGIN; x++) {
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      if (w.types[i] !== Cell.Water) continue;
      w.replaceCellAt(i, Cell.Steam, steamColor());
      w.life[i] = 40 + Math.floor(entityRandom() * 30);
      if (++flashed >= QUENCH_STEAM_CAP) break;
    }
  }
  const midY = e.y - def.h * 0.55;
  // 2) A steam gout, glowing fissures and shards of its own stone skin.
  ctx.particles.burst(e.x, midY, 26, Cell.Steam, steamColor, 2.8, { grav: -0.04 });
  ctx.particles.burst(e.x, midY, 18, null, () => packRGB(255, 140 + Math.floor(entityRandom() * 90), 36), 3.2, {
    glow: 2.4,
    grav: 0.05,
  });
  ctx.particles.burst(e.x, midY, 10, Cell.Stone, stoneColor, 3.4);
  // 3) Weight: a hurt flash, a squash, a hitch, a shake, a lens kick.
  e.flash = Math.max(e.flash, 14);
  e.squash = Math.max(e.squash ?? 0, 0.3);
  ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, 5);
  ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.05, 0.09);
  if (!ctx.state.reduceFlashes) ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 0.55);
  // 4) The sound of a furnace meeting a bucket.
  ctx.audio.at(
    e.x,
    e.y - 10,
    () => {
      ctx.audio.steam();
      ctx.audio.shellCrack();
      ctx.audio.tone(64, 36, 0.6, 'sawtooth', 0.2);
      ctx.audio.noiseBurst(0.45, 2600, 0.12, true);
    },
    900,
  );
  // 5) Say it, and stagger.
  ctx.events.emit('combatCallout', { x: e.x, y: e.y - def.h - 10, text: 'THERMAL SHOCK', tone: 'finisher' });
  e.attackCd = Math.max(e.attackCd, QUENCH_STAGGER_TICKS);
  e.vx *= 0.2;
}

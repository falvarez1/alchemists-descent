import type { Ctx, EntityStatus, Pickup, PickupKind, PickupsApi } from '@/core/types';
import { blocksEntity } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';

/**
 * World pickups (upgrade-port meta layer): hearts, spell tomes, chests,
 * potions, gold piles, and the golden key. They fall, settle, bob, drift
 * toward a close player, and collect on touch. They live on the level's
 * runtime, so untaken treasure persists when you leave and return.
 */

/** Instant potions: drinking applies a timed status (the grid explains the rest). */
export const POTION_DEFS: Record<string, { name: string; status: keyof EntityStatus; frames: number }> = {
  vigor: { name: 'POTION OF VIGOR', status: 'regen', frames: 600 },
  levity: { name: 'POTION OF LEVITY', status: 'levity', frames: 700 },
  stoneskin: { name: 'POTION OF STONESKIN', status: 'stoneskin', frames: 700 },
  swift: { name: 'POTION OF SWIFTNESS', status: 'swift', frames: 700 },
  torch: { name: 'TORCHBEARER TONIC', status: 'torch', frames: 900 },
};

export const POTION_KINDS = Object.keys(POTION_DEFS);

export function makePickup(kind: PickupKind, x: number, y: number, data: Pickup['data'] = {}): Pickup {
  return { kind, x, y, vx: 0, vy: 0, taken: false, data };
}

/** Display colors for rendering + minimap dots. */
export const PICKUP_COLOR: Record<PickupKind, number> = {
  goldpile: packRGB(255, 210, 60),
  heart: packRGB(255, 80, 110),
  tome: packRGB(140, 200, 255),
  chest: packRGB(210, 150, 70),
  potion: packRGB(220, 120, 255),
  key: packRGB(255, 230, 90),
};

export class Pickups implements PickupsApi {
  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') return;
    const runtime = ctx.levels.current;
    if (!runtime) return;
    const world = ctx.world;
    const player = ctx.player;

    for (const p of runtime.pickups) {
      if (p.taken) continue;

      // Settle physics: fall until resting on blocking cells.
      const below = world.inBounds(Math.floor(p.x), Math.floor(p.y) + 1)
        ? world.types[world.idx(Math.floor(p.x), Math.floor(p.y) + 1)]
        : 0;
      if (!blocksEntity(below)) {
        p.vy = Math.min(2.4, p.vy + 0.12);
      } else {
        p.vy = 0;
      }
      // Gentle magnetism when the alchemist is near.
      const dx = player.x - p.x;
      const dy = player.y - 8 - p.y;
      const d2 = dx * dx + dy * dy;
      if (!player.dead && d2 < 24 * 24) {
        const d = Math.sqrt(d2) || 1;
        p.vx += (dx / d) * 0.18;
        p.vy += (dy / d) * 0.18;
        p.vx *= 0.88;
        p.vy *= 0.88;
      } else {
        p.vx *= 0.8;
      }
      p.x += p.vx;
      p.y += p.vy;

      if (!player.dead && d2 < 49) this.collect(ctx, p);
    }
  }

  private collect(ctx: Ctx, p: Pickup): void {
    const player = ctx.player;
    p.taken = true;
    ctx.telemetry.count('pickup.' + p.kind);

    if (p.kind === 'goldpile') {
      const amount = p.data.amount ?? 25;
      ctx.state.score += amount;
      ctx.events.emit('scoreChanged', { score: ctx.state.score });
      ctx.events.emit('toast', { text: `+${amount} oz GOLD` });
      ctx.audio.pickup();
    } else if (p.kind === 'heart') {
      player.maxHp += 20;
      player.hp = Math.min(player.maxHp, player.hp + 20);
      ctx.events.emit('toast', { text: '+20 MAX HP' });
      ctx.audio.chest();
      ctx.particles.burst(p.x, p.y - 2, 14, null, () => packRGB(255, 90, 120), 1.8, {
        glow: 1.8,
        grav: -0.02,
      });
    } else if (p.kind === 'tome') {
      const card = p.data.card ?? 'spark';
      ctx.wands.grantCard(ctx, card);
      ctx.audio.learn();
    } else if (p.kind === 'chest') {
      // Chests burst into gold piles (and sometimes a potion) where they stand.
      const runtime = ctx.levels.current;
      const piles = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < piles; i++) {
        const gp = makePickup('goldpile', p.x + (Math.random() - 0.5) * 14, p.y - 4 - Math.random() * 6, {
          amount: 15 + Math.floor(Math.random() * 25),
        });
        gp.vx = (Math.random() - 0.5) * 1.6;
        gp.vy = -1.2 - Math.random();
        runtime?.pickups.push(gp);
      }
      if (Math.random() < 0.45) {
        const potion = POTION_KINDS[Math.floor(Math.random() * POTION_KINDS.length)];
        runtime?.pickups.push(makePickup('potion', p.x, p.y - 8, { potion }));
      }
      ctx.events.emit('toast', { text: 'CHEST OPENED' });
      ctx.audio.chest();
    } else if (p.kind === 'potion') {
      const def = POTION_DEFS[p.data.potion ?? 'vigor'] ?? POTION_DEFS.vigor;
      const st = player.status;
      st[def.status] = Math.min(1800, st[def.status] + def.frames);
      ctx.events.emit('toast', { text: def.name });
      ctx.audio.drinkPotion();
    } else if (p.kind === 'key') {
      const runtime = ctx.levels.current;
      if (runtime) runtime.keyTaken = true;
      ctx.events.emit('toast', { text: 'GOLDEN KEY ACQUIRED' });
      ctx.events.emit('objectiveChanged', { text: 'REACH THE PORTAL' });
      ctx.audio.keyJingle();
      ctx.particles.burst(p.x, p.y - 2, 16, null, () => packRGB(255, 230, 90), 2.0, {
        glow: 2.2,
        grav: -0.01,
      });
    }
  }
}

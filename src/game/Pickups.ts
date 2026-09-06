import {
  buildCardOffer,
  collectOwnedCards,
  requestCardOffer,
  TOME_REWARD_POOL,
} from '@/combat/wands/rewardPools';
import { ALL_CARD_IDS } from '@/combat/wands/cards';
import { makePickup, POTION_DEFS, POTION_KINDS } from '@/core/pickupDefs';
import type { CardId, Ctx, Pickup, PickupsApi } from '@/core/types';
import { blocksEntity } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';
import { LEG_CLUB_SWINGS } from '@/combat/WeaverLimbs';
import { updateLooseWeaverLeg } from '@/combat/LooseWeaverLeg';
import { sightClear } from '@/creatures/perception';
import { cancelChargingBlackHole } from '@/core/runtimeState';
import { getBindings, keyLabel } from '@/input/bindings';

/**
 * World pickups (upgrade-port meta layer): hearts, spell tomes, chests,
 * potions, gold piles, and the golden key. They fall, settle, bob, drift
 * toward a close player, and collect on touch. They live on the level's
 * runtime, so untaken treasure persists when you leave and return.
 */

const CARD_IDS = new Set<string>(ALL_CARD_IDS);
const POTION_IDS = new Set<string>(POTION_KINDS);

function validCardId(value: unknown): CardId | undefined {
  if (typeof value !== 'string' || value === '' || value === 'random') return undefined;
  return CARD_IDS.has(value) ? (value as CardId) : undefined;
}

function potionIdOrRandom(value: unknown): string {
  if (typeof value === 'string' && POTION_IDS.has(value)) return value;
  return POTION_KINDS[Math.floor(entityRandom() * POTION_KINDS.length)] ?? 'vigor';
}

export { makePickup, PICKUP_COLOR, POTION_DEFS, POTION_KINDS } from '@/core/pickupDefs';

export class Pickups implements PickupsApi {
  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') return;
    const runtime = ctx.levels.current;
    if (!runtime) return;
    const world = ctx.world;
    const player = ctx.player;

    for (const p of runtime.pickups) {
      if (p.taken || p.data.offerPending) continue;
      const handsFree = !player.legClub && !player.swinging && !ctx.rigidBodies?.isHolding?.();
      if (p.kind === 'weaverleg' && p.data.legDurability !== undefined) {
        updateLooseWeaverLeg(ctx, p);
        if (!p.taken && !player.dead && handsFree && !p.data.legThrown && !p.data.legPickupBlocked &&
            Math.hypot(player.x - p.x, player.y - 8 - p.y) < 14 && sightClear(world, player.x, player.y - 8, p.x, p.y)) this.collect(ctx, p);
        continue;
      }

      // Settle physics: fall until resting on blocking cells.
      const below = world.inBounds(Math.floor(p.x), Math.floor(p.y) + 1)
        ? world.types[world.idx(Math.floor(p.x), Math.floor(p.y) + 1)]
        : 0;
      if (!blocksEntity(below)) {
        p.vy = Math.min(2.4, p.vy + 0.12);
      } else {
        p.vy = 0;
      }
      // Gentle magnetism when the alchemist is near — but never through
      // walls: a sealed vault's loot must not leak past its lock.
      const dx = player.x - p.x;
      const dy = player.y - 8 - p.y;
      const d2 = dx * dx + dy * dy;
      const canCollect = p.kind !== 'weaverleg' || handsFree;
      if (p.kind === 'weaverleg') {
        p.data.legAge = Math.min(100000, (p.data.legAge ?? 0) + 1);
        if (blocksEntity(below)) { p.data.legSpin = (p.data.legSpin ?? 0) * .6; p.data.legAngle = (p.data.legAngle ?? 0) * .8; }
        else p.data.legAngle = (p.data.legAngle ?? 0) + (p.data.legSpin ?? 0);
      }
      const magnetRange = player.perks.goldmagnet && p.kind === 'goldpile' ? 48 : 24;
      let clearLine = true;
      if (d2 < magnetRange * magnetRange) {
        for (const t of [0.3, 0.55, 0.8]) {
          const sx = Math.floor(p.x + dx * t);
          const sy = Math.floor(p.y + dy * t);
          if (world.inBounds(sx, sy) && blocksEntity(world.types[world.idx(sx, sy)])) {
            clearLine = false;
            break;
          }
        }
      }
      if (!player.dead && canCollect && d2 < magnetRange * magnetRange && clearLine) {
        const d = Math.sqrt(d2) || 1;
        p.vx += (dx / d) * 0.18;
        p.vy += (dy / d) * 0.18;
        p.vx *= 0.88;
        p.vy *= 0.88;
      } else {
        p.vx *= 0.8;
      }
      if (p.kind === 'weaverleg' && world.inBounds(Math.floor(p.x + p.vx), Math.floor(p.y)) &&
          blocksEntity(world.types[world.idx(Math.floor(p.x + p.vx), Math.floor(p.y))])) p.vx *= -.3;
      p.x += p.vx;
      p.y += p.vy;

      if (!player.dead && canCollect && d2 < 49 && clearLine) this.collect(ctx, p);
    }
  }

  private collect(ctx: Ctx, p: Pickup): void {
    const player = ctx.player;
    if (p.kind === 'tome') {
      this.collectTome(ctx, p);
      return;
    }
    p.taken = true;
    ctx.telemetry.count('pickup.' + p.kind);

    if (p.kind === 'weaverleg') {
      const durability = Math.max(1, Math.min(LEG_CLUB_SWINGS, p.data.legDurability ?? LEG_CLUB_SWINGS));
      player.legClub = { durability, length: Math.max(26, Math.min(44, p.data.legLength ?? 34)), swingT: 0, angle: player.aimAngle, cooldown: 0, owner: p.data.legOwner };
      player.firing = false; player.firePressed = false; player.fireBlockedUntilRelease = true; player.recoilT = 0;
      cancelChargingBlackHole(ctx, { removeProjectile: true });
      ctx.events.emit('toast', { text: `Weaver leg equipped · LMB whip · RMB throw · ${keyLabel(getBindings().carry)} drop` });
      ctx.audio.pickup();
    } else if (p.kind === 'goldpile') {
      const amount = p.data.amount ?? 25;
      ctx.state.score += amount;
      ctx.events.emit('scoreChanged', { score: ctx.state.score });
      ctx.events.emit('toast', { text: `+${amount} oz GOLD` });
      ctx.audio.pickup();
    } else if (p.kind === 'heart') {
      // The vessel grows at once; refilling it is a COMMUNION — the alchemist
      // roots in place, glowing, while ~20 HP charges in (see Player.update).
      player.maxHp += 20;
      player.recharge = 110;
      ctx.events.emit('toast', { text: '+20 MAX HP — COMMUNION, HOLD FAST' });
      ctx.audio.chest();
      ctx.particles.burst(p.x, p.y - 2, 14, null, () => packRGB(255, 90, 120), 1.8, {
        glow: 1.8,
        grav: -0.02,
      });
    } else if (p.kind === 'chest') {
      // Chests burst into gold piles (and sometimes a potion) where they stand.
      const runtime = ctx.levels.current;
      const piles = 3 + Math.floor(entityRandom() * 3);
      for (let i = 0; i < piles; i++) {
        const gp = makePickup('goldpile', p.x + (entityRandom() - 0.5) * 14, p.y - 4 - entityRandom() * 6, {
          amount: 15 + Math.floor(entityRandom() * 25),
        });
        gp.vx = (entityRandom() - 0.5) * 1.6;
        gp.vy = -1.2 - entityRandom();
        runtime?.pickups.push(gp);
      }
      if (entityRandom() < 0.45) {
        const potion = POTION_KINDS[Math.floor(entityRandom() * POTION_KINDS.length)];
        runtime?.pickups.push(makePickup('potion', p.x, p.y - 8, { potion }));
      }
      ctx.events.emit('toast', { text: 'CHEST OPENED' });
      ctx.audio.chest();
    } else if (p.kind === 'potion') {
      const def = POTION_DEFS[potionIdOrRandom(p.data.potion)] ?? POTION_DEFS.vigor;
      const st = player.status;
      st[def.status] = Math.min(1800, st[def.status] + def.frames);
      ctx.events.emit('toast', { text: def.name });
      ctx.audio.drinkPotion();
    } else if (p.kind === 'key') {
      const runtime = ctx.levels.current;
      if (runtime) runtime.keyTaken = true;
      ctx.events.emit('toast', { text: runtime?.living ? 'The brass bell is yours.' : 'GOLDEN KEY ACQUIRED' });
      ctx.events.emit('objectiveChanged', { text: runtime?.living ? 'Follow the undertow to the lower gate.' : 'RETURN TO THE PORTAL' });
      ctx.audio.keyJingle();
      ctx.particles.burst(p.x, p.y - 2, 16, null, () => packRGB(255, 230, 90), 2.0, {
        glow: 2.2,
        grav: -0.01,
      });
    }
  }

  private collectTome(ctx: Ctx, p: Pickup): void {
    if (p.data.offerPending) return;
    ctx.telemetry.count('pickup.tome');
    const fixedCard = validCardId(p.data.card);
    const grant = (card: CardId): void => {
      if (p.taken) return;
      p.taken = true;
      p.data.offerPending = false;
      ctx.wands.grantCard(ctx, card);
      ctx.audio.learn();
    };

    if (fixedCard === 'vitrify') {
      grant(fixedCard);
      return;
    }

    const pool = fixedCard && !TOME_REWARD_POOL.includes(fixedCard)
      ? [fixedCard, ...TOME_REWARD_POOL]
      : TOME_REWARD_POOL;
    const cards = buildCardOffer(pool, collectOwnedCards(ctx.wands), {
      preferred: fixedCard ? [fixedCard] : [],
      ensureKind: 'projectile',
    });
    p.data.offerPending = true;
    const handled = requestCardOffer(ctx, {
      source: 'tome',
      title: 'SPELL TOME',
      prompt: 'Choose one page',
      cards,
      onChoose: grant,
    });
    if (!handled) p.data.offerPending = false;
  }
}

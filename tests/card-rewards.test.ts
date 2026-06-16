import { afterEach, describe, expect, it, vi } from 'vitest';

import { CARD_DEFS } from '@/combat/wands/cards';
import { getDiscoveredCards, markCardDiscovered } from '@/combat/wands/cardDiscovery';
import {
  buildCardOffer,
  COMBO_SETUP_POOL,
  DEPTH_PROJECTILE_POOL,
  requestCardOffer,
  SANCTUM_LOST_PAGES_POOL,
  TOME_REWARD_POOL,
  WAYSTONE_MOD_POOL,
} from '@/combat/wands/rewardPools';
import { EventBus } from '@/core/events';
import type { EventMap } from '@/core/events';
import type { CardId, Ctx } from '@/core/types';

describe('card reward pools', () => {
  it('keeps generic offers away from unique or progression-gated cards', () => {
    expect(TOME_REWARD_POOL).not.toContain('vitrify');
    expect(SANCTUM_LOST_PAGES_POOL).not.toContain('vitrify');
    expect(TOME_REWARD_POOL).not.toContain('infuser');
    expect(SANCTUM_LOST_PAGES_POOL).not.toContain('infuser');
  });

  it('puts Phase 4 combo setup modifiers in normal live reward pools', () => {
    expect(COMBO_SETUP_POOL).toEqual(['watertrail', 'electriccharge', 'critwet', 'oiltrail', 'shorthoming']);
    expect(new Set(COMBO_SETUP_POOL).size).toBe(COMBO_SETUP_POOL.length);
    for (const card of COMBO_SETUP_POOL) {
      expect(CARD_DEFS[card].kind).toBe('modifier');
      expect(TOME_REWARD_POOL).toContain(card);
      expect(SANCTUM_LOST_PAGES_POOL).toContain(card);
      expect(WAYSTONE_MOD_POOL).toContain(card);
      expect(DEPTH_PROJECTILE_POOL).not.toContain(card);
    }
  });

  it('builds three unique unknown card offers before falling back to known cards', () => {
    const offer = buildCardOffer(['speed', 'heavy', 'spread', 'double'], new Set<CardId>(['speed']), {
      rng: () => 0,
    });
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size).toBe(3);
    expect(offer).not.toContain('speed');
  });

  it('uses preferred tome card seeds when they are still unknown', () => {
    const offer = buildCardOffer(TOME_REWARD_POOL, new Set<CardId>(), {
      preferred: ['flame'],
      rng: () => 0,
    });
    expect(offer[0]).toBe('flame');
    expect(new Set(offer).size).toBe(3);
  });

  it('falls back to known cards when fewer than three unknown cards remain', () => {
    const pool: CardId[] = ['speed', 'heavy', 'spread'];
    const offer = buildCardOffer(pool, new Set<CardId>(['speed', 'heavy']), { rng: () => 0 });
    expect(offer).toEqual(['spread', 'speed', 'heavy']);
  });

  it('can keep normal offers from becoming setup-only while unknown payloads remain', () => {
    const offer = buildCardOffer(['watertrail', 'electriccharge', 'critwet', 'bomb'], new Set<CardId>(), {
      ensureKind: 'projectile',
      rng: () => 0,
    });

    expect(offer).toHaveLength(3);
    expect(offer).toContain('bomb');
    expect(offer).toContain('watertrail');
  });

  it('does not force known payload cards over a full unknown setup offer', () => {
    const offer = buildCardOffer(['bomb', 'watertrail', 'electriccharge', 'critwet'], new Set<CardId>(['bomb']), {
      ensureKind: 'projectile',
      rng: () => 0,
    });

    expect(offer).toEqual(['watertrail', 'electriccharge', 'critwet']);
  });

  it('keeps card metadata complete for offer rendering', () => {
    for (const def of Object.values(CARD_DEFS)) {
      expect(def.tags.length, def.id).toBeGreaterThan(0);
      expect(def.name.length, def.id).toBeGreaterThan(0);
      expect(def.blurb.length, def.id).toBeGreaterThan(0);
    }
  });
});

describe('card offer requests', () => {
  it('falls back to the first option when no UI handles the offer', () => {
    const events = new EventBus();
    const chosen: CardId[] = [];
    const handled = requestCardOffer({ events } as unknown as Ctx, {
      source: 'tome',
      title: 'SPELL TOME',
      cards: ['speed', 'heavy', 'spread'],
      onChoose: (card) => chosen.push(card),
    });
    expect(handled).toBe(false);
    expect(chosen).toEqual(['speed']);
  });

  it('lets a UI listener handle the offer and choose later', () => {
    const events = new EventBus();
    let request: EventMap['cardOfferRequested'] | null = null;
    events.on('cardOfferRequested', (payload) => {
      payload.handled = true;
      request = payload;
    });

    const chosen: CardId[] = [];
    const handled = requestCardOffer({ events } as unknown as Ctx, {
      source: 'sanctum',
      title: 'LOST PAGES',
      cards: ['speed', 'heavy', 'spread'],
      onChoose: (card) => chosen.push(card),
    });

    expect(handled).toBe(true);
    expect(chosen).toEqual([]);
    request?.onChoose('heavy');
    expect(chosen).toEqual(['heavy']);
  });
});

describe('card discovery persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores discovered cards in a separate versioned localStorage record', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });

    markCardDiscovered('speed');
    markCardDiscovered('speed');
    markCardDiscovered('flame');

    expect(getDiscoveredCards().sort()).toEqual(['flame', 'speed']);
    expect([...store.keys()]).toEqual(['alchemists-descent-card-discovery-v1']);
  });

  it('degrades gracefully when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });

    expect(() => markCardDiscovered('speed')).not.toThrow();
    expect(getDiscoveredCards()).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { ALL_CARD_IDS, CARD_DEFS } from '@/combat/wands/cards';
import { compileWand } from '@/combat/wands/compiler';
import {
  BARGAIN_RULES,
  HOST_BOUND_MODIFIERS,
  STATE_READERS,
  STATE_SETTERS,
  deadModifiers,
  isBargain,
  modifierWorksOn,
} from '@/combat/wands/cardRules';
import { cardFit, makeFitter, nameList } from '@/combat/wands/cardFit';
import { composeAltarOffer, composeDepthOffer } from '@/combat/wands/altarOffers';
import { buildCardOffer, collectOwnedCards, withDiscoveredCards } from '@/combat/wands/rewardPools';
import { BARGAIN_POOL, DEPTH_PROJECTILE_POOL, TOME_REWARD_POOL, SANCTUM_LOST_PAGES_POOL, WAYSTONE_MOD_POOL, LEVIATHAN_REWARD_POOL } from '@/content/cardRewardPools';
import {
  ARCHETYPE_FRAMES,
  UPGRADE_FRAMES,
  cycleView,
  frameStatRows,
  pickFrameFind,
  pickFrameRack,
  previewRefit,
  refitCards,
  requestWandOffer,
} from '@/combat/wands/wandFinds';
import { WAND_FRAMES } from '@/combat/wands/wandCatalog';
import { WandSystem } from '@/combat/wands/WandSystem';
import { buildWandSentenceView } from '@/combat/wands/sentenceView';
import { deadCardText, freshBuildNotes, sanitizeBuildNotes } from '@/combat/wands/BuildDirector';
import { EventBus } from '@/core/events';
import type { EventMap } from '@/core/events';
import type { CardId, Ctx } from '@/core/types';
import { World } from '@/sim/World';
import { buildLine, recapRows, wandGroups } from '@/combat/wands/buildRecap';
import { buildNotesReport, floorTimes, runNotesLine } from '@/ui/runNotes';
import { buildRunSummary, cleanBuildLine, shareLine, type RunStatsInput } from '@/game/runRules';
import { createGameParams } from '@/config/params';

/** A seeded rng so composition tests are reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const holdings = (wand1: Array<CardId | null>, wand2: Array<CardId | null> = [], collection: CardId[] = []) => ({
  wands: [{ cards: wand1 }, { cards: wand2 }],
  collection,
});

describe('card rules: which card works on which', () => {
  it('names the host rule once: body mods ride bodies only, charms ride what they change', () => {
    expect(modifierWorksOn('watertrail', 'spark')).toBe(true);
    expect(modifierWorksOn('watertrail', 'lightning')).toBe(false);
    expect(modifierWorksOn('critwet', 'flame')).toBe(false);
    // bounce, infuser and trigger write their marks onto a spawned body, so they are host-bound too
    expect(modifierWorksOn('trigger', 'dig')).toBe(false);
    expect(modifierWorksOn('bounce', 'cryojet')).toBe(false);
    expect(modifierWorksOn('bounce', 'blackhole')).toBe(false);
    expect(modifierWorksOn('bounce', 'bomb')).toBe(true);
    expect(modifierWorksOn('speed', 'lightning')).toBe(false);
    expect(modifierWorksOn('heavy', 'conjure')).toBe(false);
    expect(modifierWorksOn('spread', 'conjure')).toBe(false);
    for (const id of HOST_BOUND_MODIFIERS) expect(CARD_DEFS[id].kind).toBe('modifier');
  });

  it('finds dead modifiers the way the compiler walks: a modifier is eaten by the NEXT projectile', () => {
    expect(deadModifiers(['watertrail', 'lightning'])).toEqual([{ slot: 0, modifier: 'watertrail', hostSlot: 1, host: 'lightning' }]);
    // the Water Trail's host is the Spark Bolt after it, not the Lightning before it
    expect(deadModifiers(['lightning', 'watertrail', 'spark'])).toEqual([]);
    expect(deadModifiers(['heavy', null, 'dig', 'spark'])).toEqual([]);
    expect(deadModifiers(['trigger', 'flame', 'spark'])).toHaveLength(1);
    expect(deadModifiers(['spark'])).toEqual([]);
  });

  it('keeps the sentence view in step: a Trigger on a jet is warned about like any other dead modifier', () => {
    const view = buildWandSentenceView(['trigger', 'flame', 'spark']);
    expect(view.warnings.some((w) => w.includes('Trigger') && w.includes('needs a projectile body'))).toBe(true);
  });

  it('names a state a card sets or pays off, because crits read the TARGET', () => {
    expect(STATE_SETTERS.aquajet).toEqual(['wet']);
    expect(STATE_SETTERS.frostshard).toEqual(['frozen']);
    expect(STATE_SETTERS.flame).toEqual(['burning']);
    expect(STATE_READERS).toEqual({ critwet: 'wet', shattercrit: 'frozen', pyrecrit: 'burning' });
  });
});

describe("devil's bargains in the compiler", () => {
  it('land only on hosts their rule names, and the price lands with the benefit', () => {
    const [g] = compileWand(['loosecannon', 'spark']);
    expect(g.actions[0].dmgMul).toBe(4);
    expect(g.actions[0].spreadAdd).toBeCloseTo(0.5);
    expect(g.actions[0].bargains).toEqual(['loosecannon']);
    // An Ember Storm has no aim jitter to pay with: so the bargain is a DUD there (benefit AND price), never a free x3.
    const [dud] = compileWand(['loosecannon', 'emberstorm']);
    expect(dud.actions[0].dmgMul).toBe(1);
    expect(dud.actions[0].spreadAdd).toBe(0);
    expect(dud.actions[0].bargains).toBeUndefined();
    // ...and its mana is still charged
    expect(dud.manaCost).toBe(CARD_DEFS.loosecannon.manaCost + CARD_DEFS.emberstorm.manaCost);
  });

  it('puts the price in the compile: lifetime, speed, recoil, mana', () => {
    expect(compileWand(['shortfuse', 'spark'])[0].actions[0].lifeMul).toBeCloseTo(0.03);
    expect(compileWand(['shortfuse', 'flame'])[0].actions[0].lifeMul).toBeUndefined();
    expect(compileWand(['millstone', 'spark'])[0].actions[0].speedMul).toBeCloseTo(0.3);
    expect(compileWand(['kickback', 'spark'])[0].actions[0].recoil).toBeGreaterThan(0);
    expect(compileWand(['overcharge', 'spark'])[0].manaCost).toBe(CARD_DEFS.overcharge.manaCost + CARD_DEFS.spark.manaCost);
    // a plain cast carries none of the new fields (existing action shapes are unchanged)
    const plain = compileWand(['heavy', 'spark'])[0].actions[0];
    expect('lifeMul' in plain || 'recoil' in plain || 'bargains' in plain).toBe(false);
  });

  it('stays inside the x4 clamp however many are stacked', () => {
    for (const stack of [['overcharge', 'millstone', 'heavy', 'spark'], ['millstone', 'loosecannon', 'kickback', 'bomb']] as CardId[][]) {
      for (const g of compileWand(stack)) for (const a of g.actions) expect(a.dmgMul).toBeLessThanOrEqual(4);
    }
  });

  it('are altar-only: in no tome, page, depth or waystone pool, and discovery never feeds them', () => {
    for (const id of BARGAIN_POOL) {
      expect(isBargain(id)).toBe(true);
      expect(CARD_DEFS[id].bargain).toBe(true);
      expect(CARD_DEFS[id].cost && CARD_DEFS[id].cost!.length).toBeGreaterThan(10);
      expect(CARD_DEFS[id].tags).toContain('Bargain');
      for (const pool of [TOME_REWARD_POOL, SANCTUM_LOST_PAGES_POOL, DEPTH_PROJECTILE_POOL, WAYSTONE_MOD_POOL, LEVIATHAN_REWARD_POOL]) {
        expect(pool).not.toContain(id);
      }
    }
    expect(withDiscoveredCards(['spark'], ['overcharge', 'loosecannon', 'triple'])).toEqual(['spark', 'triple']);
    expect(new Set(BARGAIN_POOL).size).toBe(Object.keys(BARGAIN_RULES).length);
  });
});

describe('cardFit: what a card does in YOUR hands', () => {
  it('says what works with the hosts you carry', () => {
    const fit = cardFit(holdings(['spark', 'dig']), 'watertrail');
    expect(fit.verdict).toBe('works');
    expect(fit.line).toBe('Works with your Spark Bolt');
    expect(fit.primes).toEqual(['wet']);
  });

  it('says what does nothing on the hosts you carry', () => {
    const fit = cardFit(holdings(['lightning', 'dig']), 'watertrail');
    expect(fit.verdict).toBe('dead');
    expect(fit.line).toBe('Does nothing on your Chain Lightning and Excavate Ray');
    expect(cardFit(holdings(['lightning']), 'heavy').verdict).toBe('works'); // heavy floors the arcs
    expect(cardFit(holdings(['conjure']), 'heavy').verdict).toBe('dead');
  });

  it('is not fooled by a card in the satchel, but says so', () => {
    const fit = cardFit(holdings(['dig'], [], ['spark']), 'critwet');
    expect(fit.verdict).toBe('works');
    expect(fit.line).toContain('(in the satchel)');
  });

  it('names the state a card primes, and what it pairs with', () => {
    const frost = cardFit(holdings(['spark']), 'frostcharge');
    expect(frost.primes).toEqual(['frozen']);
    expect(frost.note).toBe('Primes: frozen. Pairs with Shatter Frozen.');
    expect(frost.primed).toBe(false);
    const whole = cardFit(holdings(['spark', 'shattercrit']), 'frostcharge');
    expect(whole.note).toBe('Primes: frozen. Pairs with your Shatter Frozen.');
    expect(whole.primed).toBe(true);
  });

  it('names the state a payoff reads, and whether you can set it', () => {
    const unprimed = cardFit(holdings(['spark']), 'shattercrit');
    expect(unprimed.reads).toBe('frozen');
    expect(unprimed.primed).toBe(false);
    expect(unprimed.note).toContain('Needs Frost Charge or Frost Shard');
    const primed = cardFit(holdings(['spark', 'icelance']), 'shattercrit');
    expect(primed.primed).toBe(true);
    expect(primed.note).toBe('Pays off on frozen foes. You carry Ice Lance.');
  });

  it('knows a multicast wants projectiles, and a Trigger wants two', () => {
    expect(cardFit(holdings(['spark']), 'double').verdict).toBe('dead');
    expect(cardFit(holdings(['spark', 'bomb']), 'double').verdict).toBe('works');
    expect(cardFit(holdings(['spark']), 'triple').verdict).toBe('dead');
    expect(cardFit(holdings(['spark']), 'trigger').verdict).toBe('dead');
    expect(cardFit(holdings(['spark', 'bomb']), 'trigger').verdict).toBe('works');
    expect(cardFit(holdings(['lightning', 'bomb']), 'trigger').verdict).toBe('works'); // the bomb hosts, the arc is the payload
    expect(cardFit(holdings(['dig', 'lightning']), 'trigger').verdict).toBe('dead');
  });

  it('tells a projectile what it can carry', () => {
    expect(cardFit(holdings(['spark', 'watertrail']), 'bomb').line).toBe('Carries your Water Trail');
    const jet = cardFit(holdings(['spark', 'watertrail']), 'cryojet');
    expect(jet.verdict).toBe('open');
    expect(jet.line).toBe('Can’t carry your Water Trail');
  });

  it('judges bargains by the hosts they land on', () => {
    expect(cardFit(holdings(['spark']), 'shortfuse').verdict).toBe('works');
    expect(cardFit(holdings(['flame']), 'shortfuse').verdict).toBe('dead');
    expect(cardFit(holdings(['lightning']), 'loosecannon').verdict).toBe('works'); // lightning has both damage and aim jitter
    expect(cardFit(holdings(['conjure']), 'overcharge').verdict).toBe('dead');
  });

  it('names lists the way a tile reads', () => {
    expect(nameList(['spark'])).toBe('Spark Bolt');
    expect(nameList(['spark', 'bomb'])).toBe('Spark Bolt and Cast Bomb');
    expect(nameList(['spark', 'bomb', 'wisp'])).toBe('Spark Bolt, Cast Bomb and Seeking Wisp');
    expect(nameList(['spark', 'bomb', 'wisp', 'meteor'])).toBe('Spark Bolt, Cast Bomb and 2 more');
  });

  it('the fitter ranks a whole pair above a half and a dead card at the bottom', () => {
    const fit = makeFitter(holdings(['spark', 'aquajet']));
    expect(fit.score('critwet')).toBe(3);
    expect(fit.score('shattercrit')).toBe(2);
    const lightning = makeFitter(holdings(['lightning']));
    expect(lightning.score('watertrail')).toBe(0);
    expect(lightning.dead('watertrail')).toBe(true);
  });
});

describe('offers prefer what fits', () => {
  it('never hands over three dead cards while a live one is in the pool', () => {
    const lightningOnly = holdings(['lightning'], ['dig']);
    const fitter = makeFitter(lightningOnly);
    const pool: CardId[] = ['watertrail', 'critwet', 'oiltrail', 'electriccharge', 'speed', 'heavy', 'spread'];
    for (let seed = 1; seed <= 40; seed++) {
      const offer = buildCardOffer(pool, new Set<CardId>(['lightning', 'dig']), { rng: seeded(seed), dead: fitter.dead });
      expect(offer).toHaveLength(3);
      expect(offer.filter((id) => fitter.dead(id)).length).toBeLessThanOrEqual(1);
    }
  });

  it('leaves an authored tome card alone even when it is dead', () => {
    const fitter = makeFitter(holdings(['lightning']));
    const offer = buildCardOffer(TOME_REWARD_POOL, new Set<CardId>(['lightning']), { preferred: ['watertrail'], rng: seeded(3), dead: fitter.dead });
    expect(offer).toContain('watertrail');
  });

  it('keeps the old behaviour without a fit predicate', () => {
    const offer = buildCardOffer(['speed', 'heavy', 'spread', 'double'], new Set<CardId>(['speed']), { rng: () => 0 });
    expect(offer).not.toContain('speed');
  });
});

describe('the altar: a host, a match for your wands, and a wild card with a price', () => {
  const hands = holdings(['spark', 'aquajet', null], ['dig', null, null, null]);
  const owned = collectOwnedCards({ collection: [], wands: [{ cards: ['spark', 'aquajet', null] }, { cards: ['dig'] }] } as never);

  it('offers three different cards, each in its role', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const offer = composeAltarOffer({ holdings: hands, owned, rng: seeded(seed) });
      expect(new Set(offer.cards).size).toBe(3);
      const [host, synergy, wild] = offer.cards;
      expect(CARD_DEFS[host].kind).toBe('projectile');
      expect(CARD_DEFS[synergy].kind).not.toBe('projectile');
      expect(offer.labels).toEqual(['Host', 'Synergy', 'Wild · a bargain']);
      expect(isBargain(wild)).toBe(true);
      expect(owned.has(host)).toBe(false);
    }
  });

  it('the synergy always works with the hosts you carry', () => {
    const fitter = makeFitter(hands);
    for (let seed = 1; seed <= 60; seed++) {
      const { cards } = composeAltarOffer({ holdings: hands, owned, rng: seeded(seed) });
      expect(fitter.dead(cards[1])).toBe(false);
    }
  });

  it('with only an arc in hand, the synergy is never a body mod', () => {
    const arc = holdings(['lightning'], ['dig']);
    const fitter = makeFitter(arc);
    for (let seed = 1; seed <= 60; seed++) {
      const { cards } = composeAltarOffer({ holdings: arc, owned: new Set<CardId>(['lightning', 'dig']), rng: seeded(seed) });
      expect(HOST_BOUND_MODIFIERS.has(cards[1])).toBe(false);
      expect(fitter.dead(cards[1])).toBe(false);
    }
  });

  it('leans toward a pair that is whole in your hands', () => {
    // aquajet is held: Critical on Wet is a whole pair (score 3) and should come up far more than chance.
    let wet = 0;
    for (let seed = 1; seed <= 200; seed++) {
      if (composeAltarOffer({ holdings: hands, owned, rng: seeded(seed) }).cards[1] === 'critwet') wet++;
    }
    expect(wet).toBeGreaterThan(200 / WAYSTONE_MOD_POOL.length);
  });

  it('with every bargain in hand, the wild card is a Leviathan-grade card instead', () => {
    const all = new Set<CardId>([...owned, ...BARGAIN_POOL]);
    const offer = composeAltarOffer({ holdings: hands, owned: all, rng: seeded(7) });
    expect(offer.cards).toHaveLength(3);
    expect(new Set(offer.cards).size).toBe(3);
    expect(isBargain(offer.cards[2])).toBe(false);
    expect(offer.labels[2]).toBe('Wild');
  });

  it('lets a card discovered in an earlier run into the pools', () => {
    let seen = false;
    for (let seed = 1; seed <= 200 && !seen; seed++) {
      const { cards } = composeAltarOffer({ holdings: hands, owned, discovered: ['vitrify'], rng: seeded(seed) });
      if (cards.includes('vitrify')) seen = true;
    }
    expect(seen).toBe(true);
  });
});

describe('the arrival gift: three different answers', () => {
  it('offers a burst, a precise shot and a utility', () => {
    const hands = holdings(['spark'], ['dig']);
    for (let seed = 1; seed <= 40; seed++) {
      const offer = composeDepthOffer({ holdings: hands, owned: new Set<CardId>(['spark', 'dig']), rng: seeded(seed) });
      expect(offer.cards).toHaveLength(3);
      expect(new Set(offer.cards).size).toBe(3);
      expect(offer.labels).toEqual(['Burst', 'Precision', 'Utility']);
      for (const id of offer.cards) expect(CARD_DEFS[id].kind).toBe('projectile');
    }
  });

  it('finds the one unowned card a discovery added', () => {
    const owned = new Set<CardId>([...DEPTH_PROJECTILE_POOL, 'spark']);
    const offer = composeDepthOffer({ holdings: holdings(['spark']), owned, discovered: ['vitrify'], rng: seeded(2) });
    expect(offer.cards).toContain('vitrify');
  });
});

describe('wand frames as loot', () => {
  it('grows the catalogue to eight with real archetypes', () => {
    expect(Object.keys(WAND_FRAMES).sort()).toEqual(['bone', 'brass', 'mortar', 'oak', 'pepperpot', 'quill', 'samovar', 'void']);
    for (const id of ARCHETYPE_FRAMES) {
      const f = WAND_FRAMES[id];
      expect(f.blurb && f.blurb.length).toBeGreaterThan(20);
      expect(f.capacity).toBeGreaterThanOrEqual(3);
      expect(f.capacity).toBeLessThanOrEqual(6);
    }
    // each archetype is a specialist, not a sidegrade of the starter
    expect(WAND_FRAMES.quill.castDelay).toBeLessThan(WAND_FRAMES.oak.castDelay);
    expect(WAND_FRAMES.mortar.capacity).toBeGreaterThan(WAND_FRAMES.brass.capacity);
    expect(WAND_FRAMES.pepperpot.spread).toBeGreaterThan(WAND_FRAMES.brass.spread);
    expect(WAND_FRAMES.samovar.manaMax).toBeGreaterThan(WAND_FRAMES.void.manaMax);
  });

  it('closes cards up before it displaces any, and never loses one', () => {
    const near = refitCards(['spark', null, null, 'heavy'], 3);
    expect(near.cards).toEqual(['spark', 'heavy', null]);
    expect(near.displaced).toEqual([]);
    expect(near.closedUp).toBe(true);
    const tight = refitCards(['spark', 'heavy', 'watertrail', 'bomb'], 3);
    expect(tight.cards).toEqual(['spark', 'heavy', 'watertrail']);
    expect(tight.displaced).toEqual(['bomb']);
    const wider = refitCards(['spark', 'heavy'], 5);
    expect(wider.cards).toEqual(['spark', 'heavy', null, null, null]);
    expect(wider.closedUp).toBe(false);
    const kept = refitCards(['spark', null, 'heavy'], 3);
    expect(kept.cards).toEqual(['spark', null, 'heavy']); // fits where it is: nothing moves
  });

  it('previews the swap: the stat diff, the displaced cards, and how YOUR cards would cycle', () => {
    const cards: Array<CardId | null> = ['double', 'spark', 'spark', 'heavy'];
    const preview = previewRefit(cards, WAND_FRAMES.bone, WAND_FRAMES.quill);
    expect(preview.displaced).toEqual(['heavy']);
    expect(preview.rows.find((r) => r.label === 'Slots')).toMatchObject({ from: '4', to: '3', trend: 'worse' });
    expect(preview.rows.find((r) => r.label === 'Cast')?.trend).toBe('better');
    expect(preview.after.seconds).toBeLessThan(preview.before.seconds);
    expect(frameStatRows(WAND_FRAMES.oak, WAND_FRAMES.oak).every((r) => r.trend === 'same')).toBe(true);
  });

  it('reads a cycle: groups, seconds, mana, and whether the frame refills what it spends', () => {
    const view = cycleView(['spark'], WAND_FRAMES.oak);
    expect(view.groups).toBe(1);
    expect(view.seconds).toBeCloseTo(0.6);
    expect(view.sustain).toBeGreaterThan(1);
    expect(cycleView(['meteor'], WAND_FRAMES.quill).sustain).toBeLessThan(0.25);
    expect(cycleView([], WAND_FRAMES.oak).groups).toBe(0);
  });

  it('turns up a frame that is not already in hand, and a rack of specialists', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const found = pickFrameFind({ equipped: ['oak', 'bone'], depth: 2, rng: seeded(seed) });
      expect(found).not.toBeNull();
      expect(['oak', 'bone']).not.toContain(found);
      const rack = pickFrameRack({ equipped: ['quill', 'bone'], depth: 3, rng: seeded(seed) });
      expect(rack).toHaveLength(3);
      expect(new Set(rack).size).toBe(3);
      for (const id of rack) { expect(ARCHETYPE_FRAMES).toContain(id); expect(id).not.toBe('quill'); }
    }
    // the specialists are the find; the paid frames are the rare ones
    let upgrades = 0;
    for (let seed = 1; seed <= 300; seed++) if (UPGRADE_FRAMES.includes(pickFrameFind({ equipped: [], depth: 2, rng: seeded(seed) })!)) upgrades++;
    expect(upgrades).toBeLessThan(300 * 0.3);
  });

  it('a wand offer with no UI listening is declined, never auto-fitted', () => {
    const events = new EventBus();
    let declined = 0;
    const handled = requestWandOffer({ events } as unknown as Ctx, { source: 'boss', title: 'x', frames: ['quill'], onChoose: () => { throw new Error('fitted unseen'); }, onDecline: () => declined++ });
    expect(handled).toBe(false);
    expect(declined).toBe(1);
  });
});

/* ---------------- the director, through a real WandSystem ---------------- */

function makeCtx(over: Record<string, unknown> = {}): Ctx & { telemetry: { count: ReturnType<typeof vi.fn> } } {
  return {
    world: new World(),
    events: new EventBus(),
    telemetry: { count: vi.fn() },
    audio: { sfx: () => undefined, creature: () => undefined, zap: () => undefined, noiseBurst: () => undefined, tone: () => undefined, flame: () => undefined, dig: () => undefined, dryFire: () => undefined, learn: () => undefined, wandSwap: () => undefined, splash: () => undefined },
    params: createGameParams(),
    state: { mode: 'play', paused: false, frameCount: 1 },
    input: { mouse: { x: 180, y: 180 }, activeChargingBlackHole: null },
    player: { perks: {}, dead: false, aimAngle: 0, vx: 0, vy: 0, grounded: false, hat: { vx: 0, vy: 0 }, robe: { vx: 0, vy: 0 }, mana: 0, maxMana: 0 },
    levels: { transitioning: false },
    projectiles: [],
    particles: { spawn: () => undefined, burst: () => undefined },
    lightning: { cast: () => undefined },
    spells: { wandTip: () => ({ x: 10, y: 10 }), digRay: () => null, erodeAt: () => undefined },
    fx: { digBeam: null },
    flask: { state: { material: null, count: 0, capacity: 600 } },
    ...over,
  } as unknown as Ctx & { telemetry: { count: ReturnType<typeof vi.fn> } };
}

function tick(ctx: Ctx, wands: WandSystem, n = 1): void {
  for (let i = 0; i < n; i++) {
    ctx.state.frameCount++;
    wands.update(ctx);
  }
}

function collect<K extends 'cardOfferRequested' | 'wandOfferRequested'>(ctx: Ctx, name: K): Array<EventMap[K]> {
  const seen: Array<EventMap[K]> = [];
  ctx.events.on(name, ((r: EventMap[K]) => { (r as { handled?: boolean }).handled = true; seen.push(r); }) as never);
  return seen;
}

describe('the build director: choices on the route', () => {
  it('a lit waystone opens a three-card altar once its flare has had its moment', () => {
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    const offers = collect(ctx, 'cardOfferRequested');
    ctx.events.emit('waystoneLit', { index: 0, depth: 2, levelId: 'd2' });
    expect(offers).toHaveLength(0);
    expect(wands.collection).toEqual(['double', 'speed']); // nothing is handed over unseen
    tick(ctx, wands, 80);
    expect(offers).toHaveLength(1);
    const offer = offers[0];
    expect(offer.source).toBe('altar');
    expect(offer.cards).toHaveLength(3);
    expect(offer.labels).toEqual(['Host', 'Synergy', 'Wild · a bargain']);
    expect(offer.cards).not.toContain('infuser');
    // taking the bargain is a choice that lands in the satchel and in the notes
    const grants: string[] = [];
    ctx.events.on('cardGranted', ({ id }) => grants.push(id));
    offer.onChoose(offer.cards[2]);
    expect(grants).toEqual([offer.cards[2]]);
    const notes = wands.buildNotes();
    expect(notes.altars).toBe(1);
    expect(notes.offersShown).toBe(1);
    expect(notes.offersTaken).toBe(1);
    expect(notes.bargainsTaken).toBe(1);
    expect(notes.bySource.altar).toEqual({ shown: 1, taken: 1 });
    expect(notes.picks).toEqual([offer.cards[2]]);
  });

  it('holds the offer while the game is paused, in a curtain, in a story beat, or the player is down', () => {
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    const offers = collect(ctx, 'cardOfferRequested');
    ctx.events.emit('waystoneLit', { index: 0, depth: 2, levelId: 'd2' });
    tick(ctx, wands, 80);
    // the offer fired already; queue another and hold it each way
    for (const hold of [
      () => { ctx.state.paused = true; },
      () => { (ctx.levels as { transitioning: boolean }).transitioning = true; },
      () => { (ctx as { story?: { beatActive: boolean } }).story = { beatActive: true }; },
      () => { ctx.player.dead = true; },
    ]) {
      const before = offers.length;
      ctx.state.paused = false;
      (ctx.levels as { transitioning: boolean }).transitioning = false;
      (ctx as { story?: unknown }).story = undefined;
      ctx.player.dead = false;
      ctx.events.emit('waystoneLit', { index: 1, depth: 2, levelId: 'd2' });
      hold();
      if (!ctx.state.paused) tick(ctx, wands, 80);
      else { ctx.state.frameCount += 80; wands.update(ctx); }
      expect(offers.length, 'held').toBe(before);
      ctx.state.paused = false;
      (ctx.levels as { transitioning: boolean }).transitioning = false;
      (ctx as { story?: unknown }).story = undefined;
      ctx.player.dead = false;
      tick(ctx, wands, 5);
      expect(offers.length, 'released').toBe(before + 1);
      offers[offers.length - 1].onChoose(offers[offers.length - 1].cards[0]);
    }
  });

  it('the arrival gift is a choice, offered once per floor and not before the title card has had its moment', () => {
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    const offers = collect(ctx, 'cardOfferRequested');
    ctx.events.emit('levelChanged', { depth: 2, name: 'THE ROT GARDENS' });
    tick(ctx, wands, 30);
    expect(offers).toHaveLength(0);
    tick(ctx, wands, 400);
    expect(offers).toHaveLength(1);
    expect(offers[0].source).toBe('depth');
    expect(offers[0].labels).toEqual(['Burst', 'Precision', 'Utility']);
    // coming back to the same floor is not a second gift
    ctx.events.emit('levelChanged', { depth: 2, name: 'THE ROT GARDENS' });
    tick(ctx, wands, 400);
    expect(offers).toHaveLength(1);
    // depth 1 never gifts
    ctx.events.emit('levelChanged', { depth: 1, name: 'THE WORKS' });
    tick(ctx, wands, 400);
    expect(offers).toHaveLength(1);
  });

  it('one altar in three also turns up a wand, after the card is chosen', () => {
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    const cardOffers = collect(ctx, 'cardOfferRequested');
    const wandOffers = collect(ctx, 'wandOfferRequested');
    for (let altar = 1; altar <= 3; altar++) {
      ctx.events.emit('waystoneLit', { index: altar, depth: 2, levelId: 'd2' });
      tick(ctx, wands, 80);
      expect(cardOffers).toHaveLength(altar);
      cardOffers[altar - 1].onChoose(cardOffers[altar - 1].cards[0]);
      tick(ctx, wands, 80);
      expect(wandOffers, 'after altar ' + altar).toHaveLength(altar === 3 ? 1 : 0);
    }
    expect(wandOffers[0].source).toBe('altar');
    expect(wandOffers[0].frames).toHaveLength(1);
    expect(['oak', 'bone']).not.toContain(wandOffers[0].frames[0]);
    expect(wands.buildNotes().framesFound).toBe(1);
  });

  it('a Leviathan, a Lenswright or a Rime Warden falling leaves a frame in the wreckage; the Colossus does not', () => {
    for (const kind of ['leviathan', 'lenswright', 'rimewarden'] as const) {
      const ctx = makeCtx();
      const wands = new WandSystem(ctx);
      const wandOffers = collect(ctx, 'wandOfferRequested');
      ctx.events.emit('enemyKilled', { kind, x: 0, y: 0 });
      tick(ctx, wands, 60);
      expect(wandOffers, kind + ' too soon').toHaveLength(0);
      tick(ctx, wands, 200);
      expect(wandOffers, kind).toHaveLength(1);
      expect(wandOffers[0].source).toBe('boss');
    }
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    const wandOffers = collect(ctx, 'wandOfferRequested');
    ctx.events.emit('enemyKilled', { kind: 'colossus', x: 0, y: 0 });
    ctx.events.emit('enemyKilled', { kind: 'slime', x: 0, y: 0 });
    tick(ctx, wands, 400);
    expect(wandOffers).toHaveLength(0);
  });

  it('refitting returns the cards a smaller frame cannot hold to the satchel — never deletes them', () => {
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    wands.wands[1].cards.splice(0, 4, 'dig', 'spark', 'heavy', 'bomb');
    const before = [...wands.collection];
    expect(wands.upgradeFrame(ctx, 1, 'quill')).toBe(true);
    expect(wands.wands[1].frame.id).toBe('quill');
    expect(wands.wands[1].cards).toEqual(['dig', 'spark', 'heavy']);
    expect(wands.collection).toEqual([...before, 'bomb']);
    // refitting to a frame it already carries changes nothing
    expect(wands.upgradeFrame(ctx, 1, 'quill')).toBe(false);
    // a wide frame leaves empty slots, and a card sitting past a smaller frame's end closes up first
    wands.upgradeFrame(ctx, 1, 'mortar');
    expect(wands.wands[1].cards).toHaveLength(6);
    wands.wands[1].cards.splice(0, 6, 'dig', null, null, null, null, 'spark');
    wands.upgradeFrame(ctx, 1, 'samovar');
    expect(wands.wands[1].cards).toEqual(['dig', 'spark', null, null]);
  });

  it('says a modifier is dead the moment it is cast on a card it does nothing for — once per card per run', () => {
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    const captions: string[] = [];
    ctx.events.on('deadCardCast', ({ text }) => captions.push(text));
    const toasts: string[] = [];
    ctx.events.on('toast', ({ text }) => toasts.push(text));
    wands.wands[0].cards.splice(0, 3, 'watertrail', 'lightning', null);
    wands.invalidatePrograms();
    for (let i = 0; i < 3; i++) {
      ctx.player.firePressed = true;
      wands.wands[0].cooldown = 0;
      wands.wands[0].mana = 90;
      wands.fire(ctx);
    }
    expect(captions).toEqual(['Water Trail does nothing on Chain Lightning: it needs a projectile body.']);
    expect(toasts).toEqual(captions);
    expect(wands.buildNotes().deadCardCasts).toBe(1);
    // a live modifier says nothing
    wands.wands[0].cards.splice(0, 3, 'watertrail', 'spark', null);
    wands.invalidatePrograms();
    ctx.player.firePressed = true;
    wands.wands[0].cooldown = 0;
    wands.fire(ctx);
    expect(captions).toHaveLength(1);
    // a new run starts the count again
    wands.resetLoadout();
    expect(wands.buildNotes().deadCaptioned).toEqual([]);
  });

  it('a bargain cast puts its price on the projectile: a short life, a kick', () => {
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    wands.wands[0].cards.splice(0, 3, 'shortfuse', 'spark', null);
    wands.invalidatePrograms();
    ctx.player.firePressed = true;
    wands.fire(ctx);
    // x3 is ONE bolt carrying the multiplier (it was three stacked bolts: the extras detonated on the first one's debris)
    expect(ctx.projectiles).toHaveLength(1);
    expect(ctx.projectiles[0].mul).toBe(3);
    expect(ctx.projectiles[0].life).toBeLessThan(10);
    const calm = makeCtx();
    const w2 = new WandSystem(calm);
    w2.wands[0].cards.splice(0, 3, 'spark', null, null);
    w2.invalidatePrograms();
    calm.player.firePressed = true;
    w2.fire(calm);
    const plainKick = Math.abs(calm.player.vx);
    const kick = makeCtx();
    const w3 = new WandSystem(kick);
    w3.wands[0].cards.splice(0, 3, 'kickback', 'spark', null);
    w3.invalidatePrograms();
    kick.player.firePressed = true;
    w3.fire(kick);
    expect(Math.abs(kick.player.vx)).toBeGreaterThan(plainKick * 1.5);
  });

  it('a heavy Spark Bolt is one bolt that hits x1.7 as hard, not two bolts that sometimes do', () => {
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    wands.wands[0].cards.splice(0, 3, 'heavy', 'spark', null);
    wands.invalidatePrograms();
    ctx.player.firePressed = true;
    wands.fire(ctx);
    expect(ctx.projectiles).toHaveLength(1);
    expect(ctx.projectiles[0].type).toBe('bolt');
    expect(ctx.projectiles[0].mul).toBeCloseTo(1.7);
    // Power Surge (x1.25) now reaches the starter bolt too: round(1.25) was one bolt, so it did nothing before
    const surge = makeCtx();
    (surge.player.perks as Record<string, boolean>).might = true;
    const w2 = new WandSystem(surge);
    w2.wands[0].cards.splice(0, 3, 'spark', null, null);
    w2.invalidatePrograms();
    surge.player.firePressed = true;
    w2.fire(surge);
    expect(surge.projectiles[0].mul).toBeCloseTo(1.25);
  });

  it('keeps its notes through a save and starts empty for a save from before them', () => {
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    const offers = collect(ctx, 'cardOfferRequested');
    ctx.events.emit('waystoneLit', { index: 0, depth: 2, levelId: 'd2' });
    tick(ctx, wands, 80);
    offers[0].onChoose(offers[0].cards[1]);
    tick(ctx, wands, 300);
    const snap = wands.snapshotRuntimeState();
    expect(snap.build?.altars).toBe(1);
    expect(Object.values(snap.build?.floorTicks ?? {}).reduce((a, b) => a + b, 0)).toBeGreaterThan(300);

    const restored = new WandSystem(makeCtx());
    restored.restoreRuntimeState(JSON.parse(JSON.stringify(snap)));
    expect(restored.buildNotes()).toEqual(wands.buildNotes());
    // an old save has no `build`
    const { build: _drop, ...old } = snap;
    restored.restoreRuntimeState(old);
    expect(restored.buildNotes()).toEqual(freshBuildNotes());
    // and a hand-mangled one degrades instead of throwing
    expect(sanitizeBuildNotes({ altars: 'x', picks: ['spark', 'nonsense', 4], floorTicks: { 2: 'y' }, bySource: { tome: 7 } })).toMatchObject({ altars: 0, picks: ['spark'], floorTicks: { 2: 0 }, bySource: {} });
  });

  it('writes lifetime counters to telemetry as decisions happen', () => {
    const ctx = makeCtx();
    const wands = new WandSystem(ctx);
    const offers = collect(ctx, 'cardOfferRequested');
    ctx.events.emit('waystoneLit', { index: 0, depth: 2, levelId: 'd2' });
    tick(ctx, wands, 80);
    offers[0].onChoose(offers[0].cards[2]);
    const keys = ctx.telemetry.count.mock.calls.map((c) => c[0] as string);
    expect(keys).toContain('build.altar');
    expect(keys).toContain('build.offer.shown.altar');
    expect(keys).toContain('build.offer.taken.altar');
    expect(keys.some((k) => k.startsWith('build.bargain.taken.'))).toBe(true);
  });

  it('says dead cards in the house plain voice', () => {
    expect(deadCardText({ modifier: 'speed', host: 'lightning' })).toBe('Swift Charm does nothing on Chain Lightning.');
    expect(deadCardText({ modifier: 'watertrail', host: 'dig' })).toBe('Water Trail does nothing on Excavate Ray: it needs a projectile body.');
  });
});

describe('the catalogue after the choice update', () => {
  it('keeps every card id real and every bargain drawn', () => {
    expect(ALL_CARD_IDS.length).toBe(Object.keys(CARD_DEFS).length);
    for (const id of BARGAIN_POOL) expect(ALL_CARD_IDS).toContain(id);
  });
});

describe('the build, read back', () => {
  const oak = { name: 'Oak Sprig', capacity: 3 };
  const bone = { name: 'Bone Crook', capacity: 4 };

  it('says what a click casts, the way the bench says it', () => {
    expect(wandGroups(['frostcharge', 'spark', 'bomb'])).toEqual(['Frost-Charged Spark Bolt', 'Cast Bomb']);
    expect(wandGroups(['dig'])).toEqual(['Excavate Ray']);
    // nothing castable is not a group
    expect(wandGroups([null, null, null])).toEqual([]);
    expect(wandGroups(['heavy', null, null])).toEqual([]);
    const rows = recapRows([{ frame: oak, cards: ['frostcharge', 'spark', 'bomb'] }, { frame: bone, cards: ['dig', null, null, null] }]);
    expect(rows[0]).toMatchObject({ numeral: 'I', frameName: 'Oak Sprig', capacity: 3, sentence: 'Frost-Charged Spark Bolt, then Cast Bomb' });
    expect(rows[1]).toMatchObject({ numeral: 'II', sentence: 'Excavate Ray' });
    expect(recapRows([{ frame: oak, cards: [null, null, null] }])[0].sentence).toBe('Nothing castable yet');
  });

  it('names a bargain on the cast it struck', () => {
    expect(wandGroups(['loosecannon', 'spark'])[0]).toBe('Loose Spark Bolt');
    expect(wandGroups(['shortfuse', 'bomb'])[0]).toBe('Short-Fused Cast Bomb');
    // a plain Heavy Charm still says Heavy; a bargain's own multiplier does not read as Heavy
    expect(wandGroups(['heavy', 'spark'])[0]).toBe('Heavy Spark Bolt');
    expect(wandGroups(['overcharge', 'spark'])[0]).toBe('Overcharged Spark Bolt');
  });

  it('writes the one-line build for the ledger and the share line', () => {
    expect(buildLine([{ frame: oak, cards: ['frostcharge', 'spark'] }, { frame: bone, cards: ['dig'] }])).toBe('Frost-Charged Spark Bolt & Excavate Ray');
    expect(buildLine([{ frame: oak, cards: ['spark'] }, { frame: bone, cards: ['spark'] }])).toBe('Spark Bolt');
    expect(buildLine([{ frame: oak, cards: [null] }, { frame: bone, cards: [null] }])).toBe('');
    expect(cleanBuildLine('  a   b 	 c ')).toBe('a b c');
    expect(cleanBuildLine('x'.repeat(200)).length).toBe(96);
    expect(cleanBuildLine(undefined)).toBe('');
  });

  const stats = (over: Partial<RunStatsInput> = {}): RunStatsInput => ({
    outcome: 'fallen', seed: 1234, daily: null, kit: 'spark', floor: 3, floorName: 'The Drowned Cisterns', floorsTotal: 4,
    timeMs: 842_000, kills: 12, alchemicalKills: 9, bestChain: 3, deaths: 2, gold: 400, cardsFound: 5, ...over,
  });

  it('leaves a share line with no build byte-identical, and appends the wands last when there is one', () => {
    const plain = buildRunSummary(stats());
    expect('build' in plain).toBe(false);
    expect(shareLine(plain)).toBe('Breathing Works — Floor 3/4 in 14:02 · 9 alchemical kills · best chain ×3');
    expect(shareLine(buildRunSummary(stats({ build: '' })))).toBe(shareLine(plain));
    const built = buildRunSummary(stats({ build: 'Frost-Charged Spark Bolt & Excavate Ray', boons: ['rimesoles'] }));
    expect(built.build).toBe('Frost-Charged Spark Bolt & Excavate Ray');
    expect(shareLine(built)).toBe('Breathing Works — Floor 3/4 in 14:02 · with Rime Soles · 9 alchemical kills · best chain ×3 · wands: Frost-Charged Spark Bolt & Excavate Ray');
  });

  it('writes the run notes: offers, bargains, dead cards, frames, and the clock on each floor', () => {
    const notes = freshBuildNotes();
    expect(runNotesLine(notes)).toBeNull();
    notes.offersShown = 8;
    notes.offersTaken = 7;
    notes.bySource = { altar: { shown: 3, taken: 3 }, depth: { shown: 2, taken: 2 }, tome: { shown: 3, taken: 2 } };
    notes.bargainsTaken = 1;
    notes.deadCardCasts = 2;
    notes.framesFound = 2;
    notes.framesFitted = 1;
    notes.floorTicks = { '1': 60 * 252, '2': 60 * 400, '3': 20 };
    expect(runNotesLine(notes)).toBe('8 offers, 7 taken (altars 3/3, gifts 2/2, tomes 2/3) · 1 bargain · 2 dead cards cast · 2 frames found, 1 fitted · floor 1 4:12, floor 2 6:40');
    // a floor glanced at for under a second says nothing
    expect(floorTimes(notes).map((f) => f.floor)).toEqual([1, 2]);
    const report = buildNotesReport(notes);
    expect(report.floorSeconds).toEqual({ '1': 252, '2': 400, '3': 0.3 });
    expect(report.summary).toBe(runNotesLine(notes));
    expect('floorTicks' in report).toBe(false);
  });
});

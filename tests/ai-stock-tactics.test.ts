import { afterEach, describe, expect, test } from 'vitest';
import { StockTactics, cleanGround, forwardReach, predictFoe, swingNow, threatReach } from '@/arena/ai/stockTactics';
import type { StockFoeRead, StockOrder, StockSelfRead, StockTacticsView } from '@/arena/ai/stockTactics';
import { AI_PERSONALITIES, resetPersonalities } from '@/config/aiPersonalities';
import type { PersonalityId } from '@/config/aiPersonalities';
import { stockMoveset } from '@/config/stockAttacks';
import { Rng } from '@/core/rng';

afterEach(() => resetPersonalities());

const DECK = { x0: 568, x1: 1032, y: 639 };
const STAGE = { x0: 560, x1: 1040, y: 639 };

function self(patch: Partial<StockSelfRead> = {}): StockSelfRead {
  return { x: 760, y: 639, vx: 0, vy: 0, grounded: true, facing: 1, percent: 0, canAct: true, shieldStrength: 100, shielding: false,
    dodgeReady: true, canThrow: false, moves: stockMoveset('ilyra-voss'), ...patch };
}
function opponent(patch: Partial<StockFoeRead> = {}): StockFoeRead {
  return { x: 840, y: 639, vx: 0, vy: 0, age: 14, grounded: true, attack: null, shielding: false, dodging: false, stunned: false,
    onLedge: false, grabbing: false, percent: 0, moves: stockMoveset('brann-rook'), ...patch };
}
function view(patch: Partial<StockTacticsView> & { me?: Partial<StockSelfRead>; foe?: Partial<StockFoeRead> } = {}, personality: PersonalityId = 'duelist', level = 3): StockTacticsView {
  const { me, foe, ...rest } = patch;
  return { tick: 1000, me: self(me), foe: opponent(foe), deck: DECK, stage: STAGE, personality: AI_PERSONALITIES[personality],
    skill: { level, prediction: 0.7, spacing: 0 }, shotIn: null, rng: new Rng(7), decide: true, ...rest };
}
/** Run the tactics for `ticks` ticks over a fixed picture (a decision beat every 10), collecting the orders. */
function run(t: StockTactics, make: (tick: number) => StockTacticsView, ticks: number, from = 1000): StockOrder[] {
  const out: StockOrder[] = [];
  for (let i = 0; i < ticks; i++) out.push(t.next({ ...make(from + i), tick: from + i, decide: i % 10 === 0 }));
  return out;
}

describe('stock tactics: reading the opponent', () => {
  test('leads a moving opponent by its (old) motion, keeps it on its surface, and stops it during a grounded swing', () => {
    const foe = opponent({ x: 900, vx: 2, age: 10 });
    expect(predictFoe(foe, 1).x).toBeCloseTo(920);
    expect(predictFoe(foe, 0.5).x).toBeCloseTo(910);
    expect(predictFoe({ ...foe, vx: 20 }, 1, 0, { x0: 560, x1: 1040 }).x).toBe(1040);
    const swinging = { ...foe, attack: { kind: 'finisher' as const, spec: stockMoveset('brann-rook').finisher, facing: -1, age: 3 } };
    expect(predictFoe(swinging, 1).x).toBe(900);
  });

  test('ages a seen swing to now, and forgets one that must be over', () => {
    const spec = stockMoveset('brann-rook').finisher; // 23 startup, 5 active, 33 recovery
    const s = swingNow(opponent({ age: 14, attack: { kind: 'finisher', spec, facing: -1, age: 2 } }))!;
    expect(s.age).toBe(16);
    expect(s.toActive).toBe(7);
    expect(swingNow(opponent({ age: 14, attack: { kind: 'opener', spec: stockMoveset('ilyra-voss').opener, facing: -1, age: 4 } }))).toBeNull();
  });

  test('threat reach is the farthest grounded blow plus a half body', () => {
    expect(threatReach(stockMoveset('mara-quell'))).toBe(forwardReach(stockMoveset('mara-quell').finisher));
    expect(forwardReach(stockMoveset('ilyra-voss').opener)).toBe(26);
  });
});

describe('stock tactics: spacing (the leapfrog fix)', () => {
  test('every neutral goal stays on the bot\'s own side of the opponent, overlapping bodies included', () => {
    for (const [mx, fx] of [[700, 840], [820, 840], [838, 840], [841, 840], [900, 700], [702, 700]] as const) {
      const t = new StockTactics();
      const orders = run(t, () => view({ me: { x: mx }, foe: { x: fx } }), 40);
      for (const o of orders.filter(o => o.goalX !== null && o.mode === 'neutral')) {
        const side = Math.sign(fx - mx) || 1;
        expect(Math.sign(fx - o.goalX!) === side || Math.abs(fx - o.goalX!) < 1, `me ${mx} foe ${fx} goal ${o.goalX}`).toBe(true);
      }
    }
  });

  test('holds outside the opponent\'s reach as a guardian, closer as a berserker', () => {
    const gap = (p: PersonalityId) => {
      const t = new StockTactics();
      const o = t.next(view({ decide: false, me: { x: 700 }, foe: { x: 860 } }, p));
      expect(o.mode).toBe('neutral');
      return 860 - o.goalX!;
    };
    expect(gap('guardian')).toBeGreaterThan(threatReach(stockMoveset('brann-rook')));
    expect(gap('berserker')).toBeLessThan(gap('guardian'));
  });

  test('never jumps while holding spacing', () => {
    const t = new StockTactics();
    const orders = run(t, (tick) => view({ me: { x: 700 + Math.sin(tick) * 3 }, foe: { x: 790 } }, 'trickster'), 300);
    expect(orders.filter(o => o.mode === 'neutral' && o.jump)).toEqual([]);
  });
});

describe('stock tactics: answers', () => {
  test('shields a slow blow it can see coming; a body mid-swing cannot answer and keeps the roll for later', () => {
    const spec = stockMoveset('brann-rook').finisher;
    let shields = 0;
    for (let seed = 0; seed < 40; seed++) {
      const t = new StockTactics();
      const o = t.next(view({ rng: new Rng(seed), me: { x: 814 }, foe: { x: 830, age: 7, attack: { kind: 'finisher', spec, facing: -1, age: 1 } } }, 'guardian', 5));
      if (o.shield) shields++;
    }
    expect(shields).toBeGreaterThan(25);
    const busy = new StockTactics();
    expect(busy.next(view({ me: { x: 814, canAct: false }, foe: { x: 830, age: 7, attack: { kind: 'finisher', spec, facing: -1, age: 1 } } }, 'guardian', 5)).shield).toBe(false);
  });

  test('does not answer a blow facing away or out of reach', () => {
    const spec = stockMoveset('brann-rook').finisher;
    const t = new StockTactics();
    expect(t.next(view({ me: { x: 800 }, foe: { x: 830, age: 7, attack: { kind: 'finisher', spec, facing: 1, age: 1 } } }, 'guardian', 5)).shield).toBe(false);
    expect(t.next(view({ me: { x: 700 }, foe: { x: 830, age: 7, attack: { kind: 'finisher', spec, facing: -1, age: 1 } } }, 'guardian', 5)).shield).toBe(false);
  });

  test('punishes a long recovery it can reach in time, with a blow that lands', () => {
    const spec = stockMoveset('brann-rook').finisher;
    let strikes = 0;
    for (let seed = 0; seed < 20; seed++) {
      const t = new StockTactics();
      // The swing is in its recovery: 23 + 5 + 33 = 61 ticks long, seen 30 ticks in (16 + 14 of age).
      const orders = run(t, (tick) => view({ rng: new Rng(seed * 31 + tick), me: { x: 800 }, foe: { x: 832, age: 14, attack: { kind: 'finisher', spec, facing: -1, age: 16 + (tick - 1000) } } }, 'duelist', 5), 12);
      if (orders.some(o => o.strike !== null && o.strike !== 'grab')) strikes++;
    }
    expect(strikes).toBeGreaterThan(14);
  });

  test('grabs a shield it walked up to', () => {
    const t = new StockTactics();
    let grabbed = false;
    for (let i = 0; i < 200 && !grabbed; i++) {
      const o = t.next(view({ tick: 1000 + i, decide: i % 10 === 0, rng: new Rng(i), me: { x: 820 }, foe: { x: 836, shielding: true } }, 'berserker', 5));
      grabbed = o.strike === 'grab';
    }
    expect(grabbed).toBe(true);
  });

  test('throws toward the nearer blast line while holding', () => {
    const t = new StockTactics();
    expect(t.next(view({ me: { x: 600, canThrow: true }, foe: { x: 618 } })).throwDir).toBe('left');
    expect(t.next(view({ me: { x: 1000, canThrow: true }, foe: { x: 982 } })).throwDir).toBe('right');
  });
});

describe('stock tactics: the stage', () => {
  test('guards the edge an opponent fell off without leaving the deck', () => {
    const t = new StockTactics();
    const orders = run(t, () => view({ me: { x: 800 }, foe: { x: 520, y: 700, grounded: false, vy: -3 } }), 30);
    for (const o of orders) {
      expect(o.mode).toBe('edgeguard');
      expect(o.goalX!).toBeGreaterThanOrEqual(DECK.x0);
      expect(o.goalX!).toBeLessThan(DECK.x0 + 30);
    }
  });

  test('finds the nearest clean ground on its own side of the opponent', () => {
    const burning = (x: number) => (x > 740 && x < 790 ? 5 : 0);
    expect(cleanGround(770, 1, 860, DECK, burning)).toBe(791);
    expect(cleanGround(770, 1, 785, DECK, burning)).toBe(740); // 791 is past the opponent
    expect(cleanGround(770, 1, 860, DECK, () => 1)).toBeNull();
  });

  test('walks through a few embers to clean ground beyond them, and steps out of a fire it would stand in', () => {
    const embers = (x: number) => (x > 765 && x < 775 ? 2 : 0);
    const t = new StockTactics();
    const through = t.next(view({ decide: false, me: { x: 770 }, foe: { x: 900 }, heat: embers }));
    expect(through.why).toBe('hold spacing');
    expect(embers(through.goalX!)).toBe(0);
    const fire = (x: number) => (x > 700 && x < 900 ? 5 : 0);
    const t2 = new StockTactics();
    const out = t2.next(view({ decide: false, me: { x: 800 }, foe: { x: 830, attack: null }, heat: fire }));
    expect(fire(out.goalX!)).toBe(0);
  });

  test('does not choose a burning spacing spot', () => {
    const t = new StockTactics();
    const burning = (x: number) => (x > 780 && x < 830 ? 5 : 0);
    const orders = run(t, () => view({ me: { x: 700 }, foe: { x: 860 }, heat: burning }), 30);
    for (const o of orders.filter(o => o.mode === 'neutral' && o.goalX !== null && o.tol > 0)) expect(burning(o.goalX!)).toBe(0);
  });
});

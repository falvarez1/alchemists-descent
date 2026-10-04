import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FIGHTER_ORDER } from '@/content/fighters';
import { STOCK_BALANCE, STOCK_BALANCE_RANGES, stockDealt, stockLaunchTaken } from '@/config/stockBalance';
import { STOCK_ATTACKS, STOCK_ATTACK_RANGES, hasAuthoredMoveset, stockMoveset } from '@/config/stockAttacks';

describe('the Duel balance levers', () => {
  test('every fighter has both levers, inside their ranges, and unknown fighters read 1', () => {
    for (const id of FIGHTER_ORDER) {
      const b = STOCK_BALANCE[id];
      for (const k of ['dealt', 'launch'] as const) {
        expect(b[k]).toBeGreaterThanOrEqual(STOCK_BALANCE_RANGES[k].min);
        expect(b[k]).toBeLessThanOrEqual(STOCK_BALANCE_RANGES[k].max);
      }
      expect(stockDealt(id)).toBe(b.dealt);
      expect(stockLaunchTaken(id)).toBe(b.launch);
    }
    expect(stockDealt(null)).toBe(1);
    expect(stockLaunchTaken(undefined)).toBe(1);
  });

  test('the table keeps the one-line shape scripts/duel-tune.mjs reads and writes', () => {
    const src = readFileSync('src/config/stockBalance.ts', 'utf8');
    for (const id of FIGHTER_ORDER) expect(src).toMatch(new RegExp(`'${id}': \\{ dealt: [0-9.]+, launch: [0-9.]+ \\},`));
    expect(src).toMatch(/dealt: \{ min: [0-9.]+, max: [0-9.]+/);
  });
});

describe('per-fighter stock movesets', () => {
  test('every fighter owns a copy: the seven without an authored set start equal to the prototype and tune independently', () => {
    const proto = stockMoveset('ilyra-voss');
    for (const id of FIGHTER_ORDER) {
      expect(STOCK_ATTACKS[id]).toBeDefined();
      if (id !== 'ilyra-voss') expect(STOCK_ATTACKS[id]).not.toBe(proto);
      if (!hasAuthoredMoveset(id)) for (const kind of ['opener','launcher','aerial','finisher'] as const) expect(STOCK_ATTACKS[id][kind]).toEqual(proto[kind]);
    }
    const kest = STOCK_ATTACKS['kest-rel'].opener as { damage: number };
    const was = kest.damage;
    kest.damage = was + 5;
    try {
      expect(stockMoveset('nox-calder').opener.damage).toBe(was);
      expect(stockMoveset('ilyra-voss').opener.damage).toBe(was);
    } finally { kest.damage = was; }
  });

  test('every shipped blow lies inside the tuner ranges', () => {
    for (const id of FIGHTER_ORDER) for (const spec of Object.values(STOCK_ATTACKS[id])) {
      for (const [field, r] of Object.entries(STOCK_ATTACK_RANGES)) {
        const v = spec[field as keyof typeof STOCK_ATTACK_RANGES];
        expect(v, `${id} ${spec.name} ${field}`).toBeGreaterThanOrEqual(r.min);
        expect(v, `${id} ${spec.name} ${field}`).toBeLessThanOrEqual(r.max);
        if (r.integer) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
});

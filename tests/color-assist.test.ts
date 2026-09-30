import { describe, expect, it } from 'vitest';

import { ASSIST_PALETTES, SHIPPED_BARS, deltaE, lighten, minSeparation, parseHex, simulateCvd, toHex } from '@/config/colorAssist';

describe('the colour maths', () => {
  it('reads and writes hex, forgiving a bad one', () => {
    expect(parseHex('#d4826a')).toEqual([212, 130, 106]);
    expect(parseHex('d4826a')).toEqual([212, 130, 106]);
    expect(parseHex('nope')).toEqual([0, 0, 0]);
    expect(toHex([212, 130, 106])).toBe('#d4826a');
    expect(toHex([300, -5, 1.4])).toBe('#ff0001');
  });

  it('puts a colour at zero from itself, and black far from white', () => {
    expect(deltaE('#88bfcd', '#88bfcd')).toBe(0);
    expect(deltaE('#000000', '#ffffff')).toBeGreaterThan(95);
  });

  it('simulates each deficiency, and leaves a grey grey', () => {
    for (const type of ['protan', 'deutan', 'tritan'] as const) {
      const grey = parseHex(simulateCvd('#808080', type));
      expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(3);
    }
    // Red and green, which differ plainly to normal sight, come close together for a red-green deficiency.
    expect(deltaE('#ff0000', '#00aa00')).toBeGreaterThan(80);
    expect(deltaE(simulateCvd('#ff0000', 'deutan'), simulateCvd('#00aa00', 'deutan'))).toBeLessThan(60);
    expect(simulateCvd('#abcdef', null)).toBe('#abcdef');
  });

  it('lightens towards white and no further', () => {
    expect(lighten('#000000', 0.5)).toBe('#808080');
    expect(lighten('#d4826a', 0)).toBe('#d4826a');
    expect(lighten('#d4826a', 9)).toBe('#ffffff');
  });
});

describe('the HUD bars for colour-blind players', () => {
  it('the shipped hues run together for red-green deficiency (why there is an option)', () => {
    expect(minSeparation(SHIPPED_BARS, 'deutan')).toBeLessThan(20);
    expect(minSeparation(SHIPPED_BARS, 'protan')).toBeLessThan(25);
  });

  it('the red-green assist keeps HP, MANA and LEV plainly apart to protan, deutan and normal sight', () => {
    const p = ASSIST_PALETTES['red-green'];
    for (const type of ['protan', 'deutan', null] as const) expect(minSeparation(p, type)).toBeGreaterThan(40);
    expect(minSeparation(p, 'deutan')).toBeGreaterThan(minSeparation(SHIPPED_BARS, 'deutan') * 3);
  });

  it('the blue-yellow assist does the same for tritan and normal sight', () => {
    const p = ASSIST_PALETTES['blue-yellow'];
    for (const type of ['tritan', null] as const) expect(minSeparation(p, type)).toBeGreaterThan(40);
    expect(minSeparation(p, 'tritan')).toBeGreaterThan(minSeparation(SHIPPED_BARS, 'tritan'));
  });

  it('every assist colour reads against the bars’ dark track', () => {
    for (const palette of Object.values(ASSIST_PALETTES)) {
      for (const colour of [palette.hp, palette.mana, palette.levit]) expect(deltaE(colour, '#071014')).toBeGreaterThan(30);
    }
  });
});

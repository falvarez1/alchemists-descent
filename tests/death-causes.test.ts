import { describe, expect, it } from 'vitest';

import { deathCauseLine, deathTitle, knownDeathCauseSources } from '@/ui/deathCauses';

describe('death cause copy', () => {
  it('has witty lines for key lethal sources', () => {
    expect(deathCauseLine('wet-electrocution', 0)).toContain('Self-inflicted electrocution in water');
    expect(deathCauseLine('weaver-bite', 0)).toContain('Weaver');
    expect(deathCauseLine('colossus-fireball', 0)).toContain('Kiln Colossus');
  });

  it('falls back cleanly for unknown sources', () => {
    expect(deathCauseLine('something-new', 0)).toContain('caves');
  });

  it('keeps the covered source list broad', () => {
    expect(knownDeathCauseSources()).toEqual(expect.arrayContaining([
      'acid',
      'barrel-explosion',
      'bomber',
      'gunpowder',
      'hostile-fireball',
      'lava',
      'leviathan-water',
      'self-explosion',
      'weaver-needle',
      'wet-electrocution',
    ]));
  });

  it('titles the card by what actually killed you', () => {
    expect(deathTitle('wet-electrocution')).toBe('The current took you.');
    expect(deathTitle('electrocution')).toBe('The current took you.');
    expect(deathTitle('lava')).toBe('You melted.');
    expect(deathTitle('impact')).toBe('You fell.');
    expect(deathTitle(null)).toBe('You died.');
    expect(deathTitle('something-new')).toBe('You died.');
    // Only the ground earns "You fell."
    for (const source of knownDeathCauseSources()) {
      if (source !== 'impact') expect(deathTitle(source)).not.toBe('You fell.');
    }
  });

  it('writes a line and a title for every creature that can kill', () => {
    for (const source of [
      'stonemaw-bite', 'rillback-bite', 'rillback-flop', 'rootloper-lash', 'steam-pressure',
      // Wave 2: organisms and the rebuilt bosses' new moves.
      'snapjaw-bite', 'leech', 'colossus-stomp', 'colossus-vent', 'leviathan-thrash',
    ]) {
      expect(knownDeathCauseSources()).toContain(source);
      expect(deathTitle(source)).not.toBe('You died.');
    }
  });
});

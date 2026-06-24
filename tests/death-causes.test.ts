import { describe, expect, it } from 'vitest';

import { deathCauseLine, knownDeathCauseSources } from '@/ui/deathCauses';

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
});

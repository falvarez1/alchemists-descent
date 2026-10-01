import { beforeEach, describe, expect, it } from 'vitest';

import { deathCauseLine, deathLineFor, deathTitle, knownDeathCauseSources, resetDeathLines } from '@/ui/deathCauses';

/** The Weaver's three bite lines, for the pick-once checks. */
const DEATH_VARIANTS = { weaver: [0, 1, 2].map((i) => deathCauseLine('weaver-bite', i)) };

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

describe('the one line per death', () => {
  beforeEach(() => resetDeathLines());

  it('gives every reader of the same death the same line', () => {
    // The screen, the narrator, the ledger and the clip card all ask inside one playerDied dispatch (one frame).
    const screen = deathLineFor('weaver-bite', 412);
    expect(deathLineFor('weaver-bite', 412)).toBe(screen);
    expect(deathLineFor('weaver-bite', 412)).toBe(screen);
    expect(DEATH_VARIANTS.weaver).toContain(screen);
  });

  it('does not repeat the line it showed last time for the same cause', () => {
    for (let frame = 0; frame < 60; frame++) {
      const first = deathLineFor('fire', frame * 2);
      const second = deathLineFor('fire', frame * 2 + 1);
      expect(second, `frame ${frame}`).not.toBe(first);
    }
  });

  it('cycles every variant of a three-line cause without stalling on one', () => {
    const seen = new Set<string>();
    for (let frame = 0; frame < 120; frame++) seen.add(deathLineFor('weaver-bite', frame));
    expect(seen.size).toBe(3);
  });

  it('repeats a one-line cause rather than invent a second', () => {
    expect(deathLineFor('probe', 1)).toBe(deathLineFor('probe', 2));
  });

  it('survives a missing or odd frame', () => {
    expect(deathLineFor('bomber')).toBeTruthy();
    expect(deathLineFor('bomber', Number.NaN)).toBeTruthy();
    expect(deathLineFor(null, -7)).toBeTruthy();
  });
});

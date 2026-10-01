import { describe, expect, it } from 'vitest';
import { darkMapFor, sampleDarkMap } from '@/core/darkness';

/** The complications' darkness floor (content/mutators 'darkness', Dark Works) over the designed-darkness map. */
describe('darkMapFor with a darkness lift', () => {
  const floor = (id: string) => ({ def: { id }, darkZones: [] as never[] });

  it('is exactly the designed map at a lift of 0, and caches per lift', () => {
    const d2 = floor('d2');
    const designed = darkMapFor(d2);
    expect(designed).not.toBeNull();
    expect(darkMapFor(d2, 0)).toBe(designed);
    expect(sampleDarkMap(designed, 500, 500)).toBeCloseTo(0.3, 1);
    const lifted = darkMapFor(d2, 0.7);
    expect(lifted).not.toBe(designed);
    expect(sampleDarkMap(lifted, 500, 500)).toBeCloseTo(0.7, 1);
    // Back to 0: the designed map again (a run that ends leaves nothing behind).
    expect(sampleDarkMap(darkMapFor(d2, 0), 500, 500)).toBeCloseTo(0.3, 1);
  });

  it('only deepens: a floor already darker than the lift keeps its own base', () => {
    const d3b = floor('d3b'); // base 0.36
    expect(sampleDarkMap(darkMapFor(d3b, 0.2), 500, 500)).toBeCloseTo(0.36, 1);
  });

  it('lights nothing it should not darken: a level with no designed profile stays readable', () => {
    expect(darkMapFor(floor('sanctum'), 0.7)).toBeNull();
    expect(darkMapFor(floor('custom-level'), 0.7)).toBeNull();
  });

  it('darkens the lamp-lit Works (a floor whose designed base is 0) too', () => {
    const d1 = floor('d1');
    expect(darkMapFor(d1, 0)).toBeNull();
    expect(sampleDarkMap(darkMapFor(d1, 0.7), 500, 500)).toBeCloseTo(0.7, 1);
  });
});

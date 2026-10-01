import { describe, expect, it } from 'vitest';
import { descentCurtainCopy } from '@/game/descentCurtain';
import { FLOORS_TOTAL, floorDisplayName, nextDoors } from '@/config/worldgraph';

describe('descentCurtainCopy', () => {
  it('names the floor the way Levels.enterLevel does, with its place in the descent', () => {
    expect(descentCurtainCopy('d1')).toEqual({ title: floorDisplayName('d1'), detail: `Floor 1 of ${FLOORS_TOTAL}` });
    for (const door of nextDoors('d1')) {
      const copy = descentCurtainCopy(door);
      expect(copy.title).toBe(floorDisplayName(door));
      expect(copy.detail).toMatch(/^Floor \d of \d$/);
    }
  });

  it('falls back to a plain curtain for a level off the campaign spine', () => {
    const copy = descentCurtainCopy('not-a-level');
    expect(copy.title).toBe('Opening the descent');
    expect(copy.detail.length).toBeGreaterThan(0);
  });
});

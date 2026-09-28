import { describe, expect, it } from 'vitest';

import { titleCaseName } from '@/core/strings';

describe('titleCaseName (memoized)', () => {
  it('title-cases capitals, keeps mixed case, and answers repeats identically', () => {
    for (let pass = 0; pass < 2; pass++) {
      expect(titleCaseName('THE KILN HEART')).toBe('The Kiln Heart');
      expect(titleCaseName('THE KILN HEART')).toBe('The Kiln Heart');
      expect(titleCaseName('OF THE DEEP')).toBe('Of the Deep');
      expect(titleCaseName('The Rot Gardens')).toBe('The Rot Gardens');
      expect(titleCaseName('')).toBe('');
      expect(titleCaseName('THE ROT GARDENS AND A CELLAR')).toBe('The Rot Gardens and a Cellar');
    }
  });
});

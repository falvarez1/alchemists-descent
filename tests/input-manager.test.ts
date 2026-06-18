import { describe, expect, it } from 'vitest';

import { isGameplayKeyCode } from '@/input/InputManager';

describe('gameplay input contract', () => {
  it('claims the vine/body grab key as gameplay input', () => {
    expect(isGameplayKeyCode('KeyG')).toBe(true);
  });

  it('continues to claim numbered hotbar keys', () => {
    expect(isGameplayKeyCode('Digit9')).toBe(true);
  });
});

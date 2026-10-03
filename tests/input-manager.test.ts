import { describe, expect, it } from 'vitest';

import { isGameplayKeyCode, isKeyboardUiOwnerActive } from '@/input/InputManager';
import { sanitizeBindings } from '@/input/bindings';

describe('gameplay input contract', () => {
  it('claims dodge and preserves a legacy assignment of its new default key', () => {
    expect(isGameplayKeyCode('KeyK')).toBe(true);
    const legacy = sanitizeBindings({ clip: 'KeyK' });
    expect(legacy.clip).toBe('KeyK'); expect(legacy.dodge).not.toBe('KeyK');
    expect(new Set(Object.values(legacy)).size).toBe(Object.keys(legacy).length);
  });
  it('claims the vine/body grab key as gameplay input', () => {
    expect(isGameplayKeyCode('KeyG')).toBe(true);
  });

  it('continues to claim numbered hotbar keys', () => {
    expect(isGameplayKeyCode('Digit9')).toBe(true);
  });

  it('treats modal and runtime overlays as keyboard owners', () => {
    const activeDoc = {
      querySelector: (selector: string) =>
        selector.includes('#runtime-inspector.open') ? ({} as Element) : null,
    } as unknown as Document;
    const inactiveDoc = { querySelector: () => null } as unknown as Document;

    expect(isKeyboardUiOwnerActive(activeDoc)).toBe(true);
    expect(isKeyboardUiOwnerActive(inactiveDoc)).toBe(false);
  });
});

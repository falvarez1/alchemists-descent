import { describe, expect, it } from 'vitest';
import { DuelButtons as B, DuelInputBuffer } from '@/net/duel/input';

describe('network fighter input', () => {
  it('retains the direction of a quick action chord until the host consumes it', () => {
    const input = new DuelInputBuffer();
    input.accept({ seq: 1, buttons: B.up | B.special, aim: -1 }, 0);
    input.accept({ seq: 2, buttons: 0, aim: 0 }, 5);
    expect(input.take(10)).toMatchObject({ buttons: B.up | B.special, pressed: B.up | B.special, aim: -1 });
    expect(input.take(11)).toMatchObject({ buttons: 0, pressed: 0, aim: 0 });
  });
  it('keeps a quick press until a simulation tick consumes it, exactly once', () => {
    const input = new DuelInputBuffer();
    input.accept({ seq: 1, buttons: B.attack, aim: 0 }, 0);
    input.accept({ seq: 2, buttons: 0, aim: 0 }, 5);
    expect(input.take(10).pressed & B.attack).toBe(B.attack);
    expect(input.take(11).pressed).toBe(0);
  });
  it('rejects replayed and out of order inputs and releases a stalled connection', () => {
    const input = new DuelInputBuffer();
    input.accept({ seq: 5, buttons: B.right, aim: 0 }, 0);
    expect(input.accept({ seq: 4, buttons: B.left, aim: 0 }, 10)).toBe(false);
    expect(input.take(20).buttons).toBe(B.right);
    expect(input.take(501).buttons).toBe(0);
  });
  it('clears held and queued actions across pause and match boundaries', () => {
    const input = new DuelInputBuffer();
    input.accept({ seq: 1, buttons: B.jump | B.special, aim: 1 }, 0);
    input.clear();
    expect(input.take(1)).toMatchObject({ buttons: 0, pressed: 0 });
  });
});

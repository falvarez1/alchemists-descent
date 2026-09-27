import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/events';

describe('EventBus', () => {
  it('a throwing listener neither silences the others nor aborts the emitter, and its error still surfaces', async () => {
    const bus = new EventBus();
    const heard: string[] = [];
    bus.on('toast', () => { heard.push('first'); });
    bus.on('toast', () => { throw new Error('broken listener'); });
    bus.on('toast', ({ text }) => { heard.push(text); });
    const surfaced = new Promise<unknown>((resolve) => {
      const onError = (err: unknown): void => { process.off('uncaughtException', onError); resolve(err); };
      process.on('uncaughtException', onError);
    });
    let after = false;
    expect(bus.emit('toast', { text: 'still heard' })).toBe(true);
    after = true; // the emitter carried on past the broken listener
    expect(after).toBe(true);
    expect(heard).toEqual(['first', 'still heard']);
    expect(String(await surfaced)).toContain('broken listener');
  });
});

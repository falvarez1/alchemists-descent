import { afterEach, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import { DuelControls } from '@/input/DuelControls';
import { DuelButtons as B } from '@/net/duel/input';

afterEach(() => vi.unstubAllGlobals());
it('keeps grab held when the separate heavy/climb key is released', () => {
  const listeners = new Map<string, (e: KeyboardEvent) => void>();
  vi.stubGlobal('window', { addEventListener: (name: string, fn: (e: KeyboardEvent) => void) => listeners.set(name, fn), removeEventListener() {} });
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  const player = { grounded: false, facing: 1 };
  const ctx = { duel: { active: true, room: { phase: 'playing' }, slot: 0, flushInput() {} }, arena: { bundle: () => ({ player }) }, player } as unknown as Ctx;
  const controls = new DuelControls(ctx, () => ({} as HTMLCanvasElement));
  const key = (type: string, code: string) => listeners.get(type)!({ type, code, repeat: false, preventDefault() {}, stopImmediatePropagation() {} } as KeyboardEvent);
  key('keydown', 'KeyG'); key('keydown', 'ShiftLeft'); controls.sample();
  key('keyup', 'ShiftLeft');
  expect(controls.sample().buttons & B.grab).toBe(B.grab);
  key('keyup', 'KeyG');
  expect(controls.sample().buttons & B.grab).toBe(0);
  controls.dispose();
});

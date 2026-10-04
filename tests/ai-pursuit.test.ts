import { describe, expect, test } from 'vitest';
import { Control } from '@/arena/ai/control';
import { createWorldView } from '@/arena/ai/worldView';
import type { BrainSelf } from '@/arena/ai/brain';
import type { NavEdge } from '@/arena/ai/nav';

function fixture() {
  const self = { input: { keys: { left: false, right: false, jump: false }, mouse: {} }, player: {} } as unknown as BrainSelf;
  const control = new Control(self, { free: () => true }, .7);
  const me = { ...createWorldView().me, x: 630, y: 639, grounded: true, levit: 30, maxLevit: 100 };
  const edge: NavEdge = Object.assign({ from: 'floor', to: 'side0', kind: 'levitate' as const, launchX: 630, landX: 630, clearY: 555, dir: -1 as const, cost: 80 }, { through: true, minFuel: 90 });
  control.startEdge(edge);
  return { self, control, me };
}

describe('deliberate platform climbs', () => {
  test('waits for enough fuel rather than starting the same doomed climb', () => {
    const { self, control, me } = fixture();
    for (let tick = 0; tick < 20; tick++) {
      control.observe(me, tick); control.runEdge(me, false);
      expect(self.input.keys.jump).toBe(false);
    }
    me.levit = 95;
    control.observe(me, 20); control.runEdge(me, false);
    control.observe(me, 21); control.runEdge(me, false);
    expect(self.input.keys.jump).toBe(true);
  });
  test('rises through the platform before cutting thrust, then lands without re-jumping', () => {
    const { self, control, me } = fixture(); me.levit = 100;
    control.observe(me, 0); control.runEdge(me, false);
    Object.assign(me, { y: 564, vy: -3, grounded: false });
    for (let tick = 1; tick <= 4; tick++) { control.observe(me, tick); control.runEdge(me, false); }
    expect(self.input.keys.jump).toBe(true);
    me.y = 548; control.observe(me, 5); control.runEdge(me, false);
    expect(self.input.keys.jump).toBe(false);
    Object.assign(me, { y: 559, vy: 0, grounded: true });
    control.observe(me, 6); expect(control.runEdge(me, true)).toBe('done');
    expect(self.input.keys.jump).toBe(false);
  });
});

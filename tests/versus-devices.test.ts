import { describe, expect, it } from 'vitest';
import { VersusDevices, readVersusPad } from '@/input/versusDevices';

const pad = (index: number, pressed: number[] = [], axes = [0, 0, 0, 0]): Gamepad => ({
  index, id: `test ${index}`, connected: true, mapping: 'standard', axes,
  buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), touched: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
} as Gamepad);

describe('versus device ownership', () => {
  it('supports keyboard plus pad and two pads without sharing a device', () => {
    const devices = new VersusDevices();
    devices.update([pad(0), pad(1)]);
    expect(devices.assign(1, 'pad:0')).toBe(true);
    expect(devices.assign(0, 'pad:0')).toBe(false);
    expect(devices.assign(0, 'pad:1')).toBe(true);
    expect(devices.assigned).toEqual(['pad:1', 'pad:0']);
    expect(devices.assign(1, 'keyboard')).toBe(false);
  });
  it('keeps ownership through a disconnect and requires the assigned device to return', () => {
    const devices = new VersusDevices();
    devices.update([pad(0), pad(1)]); devices.assign(1, 'pad:1');
    devices.update([pad(0), null]);
    expect(devices.missing).toEqual([1]);
    expect(devices.assigned[1]).toBe('pad:1');
    expect(devices.assign(1, 'pad:3')).toBe(false);
    devices.update([pad(0), pad(1)]); expect(devices.missing).toEqual([]);
  });
  it('joins an unclaimed controller to the CPU seat before replacing the keyboard', () => {
    const devices = new VersusDevices(); devices.update([pad(0), pad(1)]);
    expect(devices.join(0)).toBe(1); expect(devices.join(1)).toBe(0);
    expect(devices.join(0)).toBe(1);
  });
  it('rejects invalid slots and unconnected or nonstandard devices', () => {
    const devices = new VersusDevices(); devices.update([{ ...pad(0), mapping: '' }]);
    expect(devices.assign(0, 'pad:0')).toBe(false);
    expect(devices.assign(7, 'cpu')).toBe(false);
  });
});

describe('versus pad actions', () => {
  it('maps independent movement, aim, fire and fresh action edges', () => {
    const previous = new Uint8Array(18);
    const controller = pad(1, [0, 2, 4, 7], [-1, -1, .7, .5]);
    const first = readVersusPad(controller, previous, .2);
    expect(first).toMatchObject({ left: true, right: false, up: true, jump: true, jumpPressed: true, dodge: true, tactical: true, fire: true, firePressed: true, aimX: .7, aimY: .5 });
    const next = readVersusPad(controller, previous, .2);
    expect(next).toMatchObject({ jump: true, jumpPressed: false, dodge: false, tactical: false, fire: true, firePressed: false });
  });
  it('does not move or aim inside the chosen dead zone', () => {
    expect(readVersusPad(pad(0, [], [.1, -.1, .1, .1]), new Uint8Array(18), .3)).toMatchObject({ left: false, right: false, up: false, down: false, aimX: 0, aimY: 0 });
  });
});

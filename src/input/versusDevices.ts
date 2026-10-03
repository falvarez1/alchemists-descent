import type { VersusDevice } from '@/core/versus';
import { padThresholds } from '@/config/playerPrefs';

/** Device identities survive unplugging. A second controller never inherits a missing seat. */
export class VersusDevices {
  readonly assigned: [VersusDevice, VersusDevice] = ['keyboard', 'cpu'];
  private pads: readonly (Gamepad | null)[] = [];
  update(pads: readonly (Gamepad | null)[]): void { this.pads = pads; }
  pad(device: VersusDevice): Gamepad | null {
    if (!device.startsWith('pad:')) return null;
    return this.pads.find(p => p?.index === Number(device.slice(4)) && p.connected && p.mapping === 'standard') ?? null;
  }
  get available(): ReadonlyArray<{ device: VersusDevice; label: string }> {
    return [
      { device: 'keyboard', label: 'Keyboard + mouse' }, { device: 'cpu', label: 'CPU · skill 3' },
      ...this.pads.filter((p): p is Gamepad => !!p?.connected && p.mapping === 'standard')
        .map(p => ({ device: `pad:${p.index}` as VersusDevice, label: `Controller ${p.index + 1}` })),
    ];
  }
  get missing(): number[] { return this.assigned.flatMap((device, slot) => device.startsWith('pad:') && !this.pad(device) ? [slot] : []); }
  assign(slot: number, device: VersusDevice): boolean {
    if (slot !== 0 && slot !== 1) return false;
    if (device === 'keyboard' && slot !== 0) return false;
    if (device !== 'cpu' && this.assigned[1 - slot] === device) return false;
    if (device.startsWith('pad:') && !this.pad(device)) return false;
    this.assigned[slot] = device; return true;
  }
  join(index: number): number {
    const device: VersusDevice = `pad:${index}`;
    const existing = this.assigned.indexOf(device);
    if (existing >= 0) return existing;
    const slot = this.assigned.indexOf('cpu') >= 0 ? this.assigned.indexOf('cpu') : this.assigned.indexOf('keyboard');
    return this.assign(slot, device) ? slot : -1;
  }
}

export function readVersusPad(pad: Gamepad, previous: Uint8Array, deadzone: number) {
  const held = (i: number): boolean => pad.buttons[i]?.pressed === true;
  const pressed = (i: number): boolean => held(i) && !previous[i];
  const [x = 0, y = 0, aimX = 0, aimY = 0] = pad.axes;
  const th = padThresholds(deadzone), aiming = Math.hypot(aimX, aimY) > th.aim;
  const actions = {
    left: x < -th.move || held(14), right: x > th.move || held(15), up: y < -th.up || held(12), down: y > th.down || held(13),
    jump: held(0), jumpPressed: pressed(0), dodge: pressed(4), fire: held(7), firePressed: pressed(7),
    tactical: pressed(2), ultimate: pressed(3), kick: pressed(1) || pressed(11), flask: pressed(5), pour: held(6), wand: pressed(10),
    aimX: aiming ? aimX : 0, aimY: aiming ? aimY : 0,
    confirm: pressed(0), back: pressed(1), previous: pressed(14), next: pressed(15), pause: pressed(9),
    menuPrevious: pressed(12) || pressed(14), menuNext: pressed(13) || pressed(15),
  };
  for (let i = 0; i < previous.length; i++) previous[i] = held(i) ? 1 : 0;
  return actions;
}

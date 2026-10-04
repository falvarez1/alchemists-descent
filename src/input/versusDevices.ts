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
      { device: 'keyboard', label: 'Keyboard + mouse' }, { device: 'cpu', label: 'CPU' },
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
  const held = (i: number): boolean => pad.buttons[i]?.pressed === true || ((i === 6 || i === 7) && (pad.buttons[i]?.value ?? 0) > .45);
  const pressed = (i: number): boolean => held(i) && !previous[i];
  const [x = 0, y = 0, aimX = 0, aimY = 0] = pad.axes;
  const th = padThresholds(deadzone), aiming = Math.hypot(aimX, aimY) > th.aim;
  const stickDirection = !aiming ? 0 : Math.abs(aimX) > Math.abs(aimY) ? aimX < 0 ? 1 : 2 : aimY < 0 ? 3 : 4;
  const direction = x < -th.move || held(14) ? 1 : x > th.move || held(15) ? 2 : y > th.down || held(13) ? 3 : 0;
  const defense = held(6) || held(7);
  const smash = stickDirection && !previous[18] ? (['left', 'right', 'up', 'down'] as const)[stickDirection - 1] : null;
  const actions = {
    left: x < -th.move || held(14), right: x > th.move || held(15), up: y < -th.up || held(12), down: y > th.down || held(13),
    jump: held(2) || held(3), jumpPressed: pressed(2) || pressed(3),
    defense, defensePressed: pressed(6) || pressed(7), dodgeDirection: defense && direction !== 0 && previous[19] !== direction,
    grab: pressed(4) || pressed(5), attack: pressed(0), special: held(1), specialPressed: pressed(1), smash,
    confirm: pressed(0), back: pressed(1), previous: pressed(14), next: pressed(15), pause: pressed(9),
    // The lobby's stage picker (in a match LB/RB are grab).
    stagePrevious: pressed(4), stageNext: pressed(5),
    menuPrevious: pressed(12) || pressed(14), menuNext: pressed(13) || pressed(15),
  };
  for (let i = 0; i < 18; i++) previous[i] = held(i) ? 1 : 0;
  previous[18] = stickDirection; previous[19] = defense ? direction : 0;
  return actions;
}

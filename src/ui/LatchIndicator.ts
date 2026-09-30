import type { Ctx } from '@/core/types';

const NAMES = { down: 'Crouch', jump: 'Levitate', pour: 'Pour', interact: 'Siphon' } as const;

/**
 * "Holding: Crouch · Pour": while the Hold-or-toggle option has something latched, a small chip says so
 * (and how to let go), because nothing in the hand reminds you. It appears only for latched actions, so
 * for everyone who holds their keys it never exists.
 */
export class LatchIndicator {
  private readonly el = document.createElement('div');
  private readonly off: () => void;

  constructor(ctx: Ctx) {
    this.el.id = 'latch-indicator';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    document.getElementById('canvas-holder')?.appendChild(this.el);
    this.off = ctx.events.on('inputLatches', ({ held }) => {
      this.el.hidden = held.length === 0;
      this.el.textContent = held.length === 0 ? '' : `Holding: ${held.map((action) => NAMES[action]).join(' · ')} — press again to let go`;
    });
  }

  dispose(): void {
    this.off();
    this.el.remove();
  }
}

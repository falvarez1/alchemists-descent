import type { Ctx } from '@/core/types';

const NAMES = { down: 'Crouch', jump: 'Levitate', pour: 'Pour', interact: 'Siphon' } as const;

/**
 * "Holding: Crouch · Pour": while the Hold-or-toggle option has something latched, a small chip says so
 * (and how to let go), because nothing in the hand reminds you. It appears only for latched actions, so
 * for everyone who holds their keys it never exists (the element is made on the first latch).
 */
export class LatchIndicator {
  private el: HTMLElement | null = null;
  private readonly off: () => void;

  constructor(ctx: Ctx) {
    this.off = ctx.events.on('inputLatches', ({ held }) => {
      if (held.length === 0 && !this.el) return;
      const el = this.element();
      el.hidden = held.length === 0;
      el.textContent = held.length === 0 ? '' : `Holding: ${held.map((action) => NAMES[action]).join(' · ')} — press again to let go`;
    });
  }

  private element(): HTMLElement {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.id = 'latch-indicator';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    document.getElementById('canvas-holder')?.appendChild(el);
    this.el = el;
    return el;
  }

  dispose(): void {
    this.off();
    this.el?.remove();
  }
}

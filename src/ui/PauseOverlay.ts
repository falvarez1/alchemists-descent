import type { Ctx } from '@/core/types';

/**
 * ESC pause. Owns its own pause claim so it never fights the Sanctum, the
 * Handbook, or the victory screen for the ctx.state.paused flag — ESC only
 * releases a pause that ESC took.
 */
export class PauseOverlay {
  private active = false;

  constructor(private ctx: Ctx) {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      // Other modals own ESC (or ignore it) while they are up.
      if (this.ctx.sanctum.isOpen) return;
      if (document.getElementById('help-overlay')?.classList.contains('visible')) return;
      if (document.getElementById('victory-overlay')?.classList.contains('visible')) return;
      if (!this.active && this.ctx.state.paused) return; // someone else paused
      this.toggle();
    });
  }

  private toggle(): void {
    this.active = !this.active;
    this.ctx.state.paused = this.active;
    document.getElementById('pause-overlay')?.classList.toggle('visible', this.active);
  }
}

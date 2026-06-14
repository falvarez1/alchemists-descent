import type { Ctx } from '@/core/types';

/**
 * The Alchemist's Handbook (H): a paused, readable summary of every system —
 * ten interacting mechanics deserve more teaching than one line of key hints.
 */
export class HelpOverlay {
  private visible = false;
  /** Pause state to restore on close (the Sanctum owns its own pause). */
  private pausedBefore = false;

  constructor(private ctx: Ctx) {
    window.addEventListener('keydown', (e) => {
      if ((document.getElementById('builder-intent-modal') || document.querySelector('.app-dialog-root')) && !this.visible) return;
      if (document.body.classList.contains('builder-open') && !this.visible) return;
      if (e.code === 'KeyH' && !e.repeat && !this.ctx.sanctum.isOpen) this.toggle();
      else if (e.code === 'Escape' && this.visible) this.toggle();
    });
  }

  private toggle(): void {
    this.visible = !this.visible;
    document.getElementById('help-overlay')?.classList.toggle('visible', this.visible);
    if (this.visible) {
      this.pausedBefore = this.ctx.state.paused;
      this.ctx.state.paused = true;
    } else {
      this.ctx.state.paused = this.pausedBefore;
    }
  }
}

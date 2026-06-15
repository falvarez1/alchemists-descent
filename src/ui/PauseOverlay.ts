import type { Ctx } from '@/core/types';
import { isRunLauncherOpen } from '@/ui/RunLauncher';

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
      if (e.defaultPrevented) return;
      // Other modals own ESC (or ignore it) while they are up.
      if (document.querySelector('.app-dialog-root')) return;
      if (isRunLauncherOpen()) return;
      if (this.ctx.sanctum.isOpen) return;
      if (document.getElementById('help-overlay')?.classList.contains('visible')) return;
      if (document.getElementById('victory-overlay')?.classList.contains('visible')) return;
      if (!this.active && this.ctx.state.paused) return; // someone else paused
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });
    document.getElementById('pause-exit-fullscreen')?.addEventListener('click', () => {
      const exit = document.exitFullscreen?.();
      if (!exit) return;
      void exit
        .catch(() => this.ctx.events.emit('toast', { text: 'EXIT FULLSCREEN FAILED' }))
        .finally(() => this.syncFullscreenButton());
    });
    document.addEventListener('fullscreenchange', () => this.syncFullscreenButton());
    this.syncFullscreenButton();
  }

  private toggle(): void {
    this.active = !this.active;
    this.ctx.state.paused = this.active;
    document.getElementById('pause-overlay')?.classList.toggle('visible', this.active);
    this.syncFullscreenButton();
  }

  private syncFullscreenButton(): void {
    document
      .getElementById('pause-exit-fullscreen')
      ?.classList.toggle('visible', this.active && Boolean(document.fullscreenElement));
  }
}

import type { Ctx } from '@/core/types';
import { isRunLauncherOpen } from '@/ui/RunLauncher';
import { appDialog } from '@/ui/AppDialog';

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
    document.getElementById('pause-restart')?.addEventListener('click', () => void this.restartLevel());
    document.getElementById('pause-launcher')?.addEventListener('click', () => this.openLauncher());
    document.addEventListener('fullscreenchange', () => this.syncFullscreenButton());
    this.syncFullscreenButton();
  }

  /** Release the ESC pause (if this overlay owns it) before handing off to a run action. */
  private resume(): void {
    if (this.active) this.toggle();
  }

  /** Pause -> reopen the Start Run launcher (works during disposable test runs, not in Builder). */
  private openLauncher(): void {
    if (document.body.classList.contains('builder-open')) return;
    this.resume();
    window.dispatchEvent(new CustomEvent('run-launcher-request', { cancelable: true, detail: { source: 'pause' } }));
  }

  /** Pause -> restart the current level. Re-runs it through the same Levels.startRun path the
   *  launcher uses (inferring mode/world/seed from the live run). A normal expedition is a
   *  persistent descent, so restarting it is confirmed first. */
  private async restartLevel(): Promise<void> {
    if (document.body.classList.contains('builder-open')) return;
    const status = this.ctx.levels.runStatus(this.ctx);
    if (!status.level) return;
    if (status.playtestSource === null) {
      const ok = await appDialog.confirm('Restart this level? Your current descent will be abandoned.', {
        title: 'Restart Level',
        confirmText: 'Restart',
        tone: 'danger',
      });
      if (!ok) return;
    }
    this.resume();
    const seed = status.worldSeed >>> 0;
    const started = status.level.id.startsWith('virtual')
      ? this.ctx.levels.startRun(this.ctx, { mode: 'test', worldSource: 'virtual-world', seed })
      : this.ctx.levels.startRun(this.ctx, {
          mode: status.playtestSource === 'test' ? 'test' : 'normal',
          worldSource: 'campaign-level',
          levelId: status.level.id,
          seed,
          loadout: status.playtestSource === 'test' ? 'advanced' : 'fresh',
          continueSave: false,
        });
    if (!started.ok) this.ctx.events.emit('toast', { text: started.message });
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

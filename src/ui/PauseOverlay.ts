import type { Ctx } from '@/core/types';
import { isRunLauncherOpen } from '@/ui/RunLauncher';
import { appDialog } from '@/ui/AppDialog';
import { BUILD_STAMP, buildPlaytestReport } from '@/ui/playtestReport';
import { WORKS_ROOMS } from '@/world/breathingWorks';
import { titleCaseName } from '@/core/strings';
import { FLOORS_TOTAL, floorOf } from '@/config/worldgraph';

/**
 * ESC pause. Owns its own pause claim so it never fights the Sanctum, the
 * Handbook, or the victory screen for the ctx.state.paused flag — ESC only
 * releases a pause that ESC took.
 */
export class PauseOverlay {
  private active = false;
  private restarting = false;
  private ending = false;
  private readonly abandonButton = document.createElement('button');
  private readonly titleButton = document.createElement('button');

  constructor(private ctx: Ctx) {
    // The run's two ways out: end it here (the ledger follows), or step back
    // to the title with the descent saved for Continue.
    this.titleButton.type = 'button';
    this.titleButton.id = 'pause-title-btn';
    this.titleButton.innerHTML = '<span>Quit to title</span>';
    this.abandonButton.type = 'button';
    this.abandonButton.id = 'pause-abandon';
    this.abandonButton.innerHTML = '<span>Abandon run</span>';
    const restart = document.getElementById('pause-restart');
    restart?.after(this.titleButton, this.abandonButton);
    this.titleButton.addEventListener('click', this.onTitleClick);
    this.abandonButton.addEventListener('click', this.onAbandonClick);
    // Player builds: the run launcher (test levels, god kits) is an authoring
    // tool, not a pause-menu door.
    if (!__AUTHORING__) document.getElementById('pause-launcher')?.remove();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('game-pause-request', this.onPauseRequest);
    document.getElementById('expedition-pause')?.addEventListener('click', this.onPauseRequest);
    document.getElementById('pause-exit-fullscreen')?.addEventListener('click', this.onExitFullscreenClick);
    document.getElementById('pause-restart')?.addEventListener('click', this.onRestartClick);
    document.getElementById('pause-resume')?.addEventListener('click', this.onResumeClick);
    document.getElementById('pause-launcher')?.addEventListener('click', this.onLauncherClick);
    document.getElementById('pause-copy-report')?.addEventListener('click', this.onCopyReportClick);
    document.getElementById('pause-overlay')?.addEventListener('click', this.onMenuClick);
    document.getElementById('pause-overlay')?.addEventListener('keydown', this.onMenuKeys);
    const build = document.getElementById('pause-build');
    if (build) build.textContent = `build ${BUILD_STAMP}`;
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.syncFullscreenButton();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape') return;
    if (e.defaultPrevented) return;
    // Other modals own ESC (or ignore it) while they are up.
    if (document.querySelector('.app-dialog-root')) return;
    if (document.querySelector('#player-settings[open], #expedition-entry:not([hidden])')) return;
    if (isRunLauncherOpen()) return;
    if (this.ctx.sanctum.isOpen) return;
    if (document.getElementById('help-overlay')?.classList.contains('visible')) return;
    if (document.getElementById('run-summary')?.classList.contains('visible')) return;
    if (!this.active && this.ctx.state.paused) return; // someone else paused
    e.preventDefault();
    e.stopPropagation();
    this.toggle();
  };

  private readonly onExitFullscreenClick = (): void => {
    const exit = document.exitFullscreen?.();
    if (!exit) return;
    void exit
      .catch(() => this.ctx.events.emit('toast', { text: 'EXIT FULLSCREEN FAILED' }))
      .finally(() => this.syncFullscreenButton());
  };

  private readonly onPauseRequest = (): void => {
    if (this.ctx.state.mode !== 'play' || document.querySelector('#player-settings[open]') || this.ctx.sanctum.isOpen) return;
    if (this.ctx.state.paused && !this.active) return;
    this.toggle();
  };

  private readonly onRestartClick = (): void => void this.restartLevel();
  private readonly onTitleClick = (): void => this.quitToTitle();
  private readonly onAbandonClick = (): void => void this.abandonRun();
  private readonly onResumeClick = (): void => this.resume();

  private readonly onLauncherClick = (): void => this.openLauncher();

  private readonly onCopyReportClick = (): void => void this.copyReport();

  private readonly onFullscreenChange = (): void => this.syncFullscreenButton();

  /** Copy the playtest report to the clipboard; if the browser blocks the
   *  clipboard (permissions, non-secure context), print it to the console so
   *  the report is never simply lost. */
  private async copyReport(): Promise<void> {
    const text = buildPlaytestReport(this.ctx);
    try {
      await navigator.clipboard.writeText(text);
      this.ctx.events.emit('toast', { text: 'PLAYTEST REPORT COPIED — PASTE IT WITH YOUR FEEDBACK' });
    } catch {
      console.info(`[playtest report]\n${text}`);
      this.ctx.events.emit('toast', { text: 'CLIPBOARD BLOCKED — REPORT PRINTED TO CONSOLE (F12)' });
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('game-pause-request', this.onPauseRequest);
    document.getElementById('expedition-pause')?.removeEventListener('click', this.onPauseRequest);
    document.getElementById('pause-exit-fullscreen')?.removeEventListener('click', this.onExitFullscreenClick);
    document.getElementById('pause-restart')?.removeEventListener('click', this.onRestartClick);
    document.getElementById('pause-resume')?.removeEventListener('click', this.onResumeClick);
    document.getElementById('pause-launcher')?.removeEventListener('click', this.onLauncherClick);
    document.getElementById('pause-copy-report')?.removeEventListener('click', this.onCopyReportClick);
    document.getElementById('pause-overlay')?.removeEventListener('click', this.onMenuClick);
    document.getElementById('pause-overlay')?.removeEventListener('keydown', this.onMenuKeys);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.titleButton.removeEventListener('click', this.onTitleClick);
    this.abandonButton.removeEventListener('click', this.onAbandonClick);
    this.titleButton.remove();
    this.abandonButton.remove();
  }

  /** Pause -> title. The descent is checkpointed first so Continue picks it up. */
  private quitToTitle(): void {
    if (document.body.classList.contains('builder-open')) return;
    this.resume();
    if (this.ctx.run?.active && !this.ctx.player.dead) this.ctx.levels.saveExpedition(this.ctx);
    window.dispatchEvent(new CustomEvent('expedition-title-request'));
  }

  /** Pause -> end the run by choice. Confirmed, then the ledger takes over. */
  private async abandonRun(): Promise<void> {
    const run = this.ctx.run;
    if (this.ending || !run?.active) return;
    this.ending = true;
    try {
      const ok = await appDialog.confirm('Abandon this descent? It ends here, and the ledger is written up as it stands.', {
        title: 'Abandon run',
        confirmText: 'Abandon',
        tone: 'danger',
      });
      if (!ok) return;
      this.resume();
      run.abandon(this.ctx);
    } finally {
      this.ending = false;
    }
  }

  /**
   * The pause menu's doors to the other menus: resume, then press the same
   * key the player would (each menu owns its own toggle and pause claim).
   */
  private readonly onMenuClick = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-pause-open]');
    if (!button) return;
    const code = button.dataset.pauseOpen ?? '';
    this.resume();
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace('Key', '').toLowerCase(), bubbles: true }));
  };

  /** Arrow keys walk the menu; the list wraps. */
  private readonly onMenuKeys = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...document.querySelectorAll<HTMLElement>('#pause-overlay #pause-resume, #pause-overlay .pause-menu button')]
      .filter((node) => node.offsetParent !== null);
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? 0 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  /** Where you are: level, room, the current goal, and what you carry. */
  private fillStatus(): void {
    const ctx = this.ctx;
    const level = ctx.levels.current;
    const place = document.getElementById('pause-place');
    const goal = document.getElementById('pause-goal');
    const stats = document.getElementById('pause-stats');
    if (!place || !goal || !stats) return;
    if (!level) { place.textContent = ''; goal.textContent = ''; stats.replaceChildren(); return; }
    const room = level.living ? WORKS_ROOMS.find((r) => r.id === level.living?.room)?.name : undefined;
    const name = titleCaseName(level.def.name);
    place.textContent = room ? room + ' · ' + name : name;
    goal.textContent = document.getElementById('objective')?.textContent?.trim() || '';
    let charted = 0;
    for (let i = 0; i < level.explored.length; i++) if (level.explored[i] > 0) charted++;
    const floor = floorOf(level.def.id);
    const rows: Array<[string, string]> = [
      floor > 0 ? ['Floor', `${floor} of ${FLOORS_TOTAL}`] : ['Depth', String(level.def.depth)],
      ['Health', Math.ceil(Math.max(0, ctx.player.hp)) + ' / ' + ctx.player.maxHp],
      ['Gold carried', ctx.state.score + ' oz'],
      ['Charted', Math.round(charted / Math.max(1, level.explored.length) * 100) + '%'],
      ['Spell cards', String(ctx.wands.collection.length + ctx.wands.wands.reduce((n, w) => n + w.cards.filter(Boolean).length, 0))],
    ];
    if (level.living) rows.push(['Glowseeds', String(level.living.glowseeds)]);
    if (ctx.run?.active) rows.splice(2, 0, ['Return phials', `${ctx.run.phials} of ${ctx.run.maxPhials}`]);
    stats.replaceChildren(...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }));
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
    if (this.restarting) return;
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
    this.restarting = true;
    try {
      await this.beginRestartLoading(status.level.name);
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
      if (!started.ok) {
        this.ctx.events.emit('levelCurtain', { visible: false });
        this.ctx.events.emit('toast', { text: started.message });
      }
    } finally {
      this.restarting = false;
    }
  }

  private async beginRestartLoading(levelName: string): Promise<void> {
    this.ctx.events.emit('levelCurtain', {
      visible: true,
      title: 'Restarting level',
      detail: `Rebuilding ${levelName}.`,
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  private toggle(): void {
    this.active = !this.active;
    this.ctx.state.paused = this.active;
    document.getElementById('pause-overlay')?.classList.toggle('visible', this.active);
    const hint = document.getElementById('pause-input-hint');
    if (hint) hint.textContent = Array.from(navigator.getGamepads?.() ?? []).some(p => p?.connected)
      ? 'Start to resume · A to choose' : 'Escape to resume · H for the handbook';
    if (this.active) {
      this.fillStatus();
      this.syncRunButtons();
      document.getElementById('pause-resume')?.focus();
    }
    this.syncFullscreenButton();
  }

  /** A tracked run offers Abandon + Quit to title; Restart stays for disposable test runs. */
  private syncRunButtons(): void {
    const tracked = this.ctx.run?.active === true;
    this.abandonButton.hidden = !tracked;
    this.titleButton.hidden = this.ctx.state.mode !== 'play';
    const restart = document.getElementById('pause-restart');
    if (restart) restart.hidden = tracked;
  }

  private syncFullscreenButton(): void {
    document
      .getElementById('pause-exit-fullscreen')
      ?.classList.toggle('visible', this.active && Boolean(document.fullscreenElement));
  }
}

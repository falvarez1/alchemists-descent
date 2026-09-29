import type { Ctx, RunStartResult } from '@/core/types';
import type { KitId } from '@/core/run';
import { GAME_SUBTITLE, GAME_TAGLINE, GAME_TITLE } from '@/config/brand';
import { FLOORS_TOTAL } from '@/config/worldgraph';
import { formatRunTime } from '@/game/runRules';
import { PlayerSettings } from '@/ui/PlayerSettings';
import { KitPicker } from '@/ui/KitPicker';
import { appDialog } from '@/ui/AppDialog';
import { openTrailer } from '@/ui/TrailerLightbox';

/** "Breathing Works" → "Breathing<br><em>Works</em>": the last word takes the brass. */
function titleMarkup(title: string): string {
  const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const cut = title.lastIndexOf(' ');
  if (cut <= 0) return `<em>${escape(title)}</em>`;
  return `${escape(title.slice(0, cut))}<br><em>${escape(title.slice(cut + 1))}</em>`;
}

/**
 * The player entrance: Continue / Begin / Today's descent, the case to descend
 * with, Controls & comfort — and, once a first run has ended, The Workshop
 * (the material sandbox). The Builder and the advanced run launcher stay
 * behind the authoring-only Workshops fold.
 */
export class ExpeditionEntry {
  private readonly root = document.createElement('section');
  private readonly settings: PlayerSettings;
  private readonly kits: KitPicker;
  private readonly disposers: Array<() => void> = [];
  private launching = false;
  private selectedKit: KitId = 'spark';

  /**
   * `playReady` resolves once the play systems (game/playSystems: the story,
   * the score, the Sanctum…) are installed — false if they could not load.
   * They are fetched under the title; a launch waits for them.
   */
  constructor(private readonly ctx: Ctx, private readonly playReady: () => Promise<boolean> = () => Promise.resolve(true)) {
    this.settings = new PlayerSettings(ctx);
    this.root.id = 'expedition-entry';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'expedition-title');
    this.root.innerHTML = `<div class="entry-scene" aria-hidden="true"></div><div class="entry-content">
      <h1 id="expedition-title">${titleMarkup(GAME_TITLE)}</h1>
      <p class="entry-subtitle">${GAME_SUBTITLE}</p>
      <p class="entry-tagline">${GAME_TAGLINE.replace('. ', '.<br>')}</p>
      <nav aria-label="Expedition"><button type="button" data-entry="continue" hidden>Continue your descent</button>
      <button type="button" data-entry="begin">Begin the descent</button>
      <div class="entry-kits"></div>
      <button type="button" data-entry="daily" class="entry-daily">Today’s descent<span class="entry-note" data-entry-note="daily"></span></button>
      <button type="button" data-entry="settings">Controls & comfort</button>
      <button type="button" data-entry="trailer" class="entry-trailer">Watch the trailer<span class="entry-note">Ninety-five seconds of safety induction. Mind the duck.</span></button>
      <button type="button" data-entry="opening" class="entry-opening" hidden>The opening<span class="entry-note">Kettleby, the lift, and a voice in the pipes.</span></button>
      <button type="button" data-entry="workshop" class="entry-workshop" hidden>The Workshop<span class="entry-note">The material sandbox. Nothing here can hurt you, much.</span></button></nav>
      <p class="touch-entry-hint">Touch controls are ready. Turn sideways for a larger view. Change controls in Controls & comfort.</p>
      <p class="entry-status" role="status"></p>
      <details class="entry-workshops"><summary>Workshops</summary><div><button type="button" data-entry="sandbox">Material sandbox</button><button type="button" data-entry="builder">Level builder</button><button type="button" data-entry="advanced">Advanced run setup</button></div></details>
      </div><div class="entry-footer"><span class="entry-release">${GAME_TITLE} <b aria-label="Game version ${__APP_VERSION__}">v${__APP_VERSION__}</b></span><span>Keyboard + mouse / controller</span></div>`;
    this.kits = new KitPicker('Your case', (kit) => {
      this.selectedKit = kit;
      ctx.run?.chooseKit(kit);
    });
    this.root.querySelector('.entry-kits')!.appendChild(this.kits.root);
    document.getElementById('canvas-holder')!.appendChild(this.root);
    this.root.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-entry]');
      if (!button) return;
      const action = button.dataset.entry;
      if (action === 'settings') this.settings.open();
      else if (action === 'trailer') openTrailer(ctx, button);
      else if (action === 'opening') void ctx.story?.playOpening({ replay: true });
      else if (action === 'begin' || action === 'continue') void this.launch(action === 'continue' ? 'continue' : 'begin');
      else if (action === 'daily') void this.launch('daily');
      else if (action === 'sandbox' || action === 'builder' || action === 'workshop') {
        this.hide(); ctx.state.paused = false;
        document.getElementById(action === 'builder' ? 'mode-builder-btn' : 'mode-build-btn')?.click();
      } else if (action === 'advanced') {
        this.hide(); ctx.state.paused = false;
        window.dispatchEvent(new CustomEvent('run-launcher-request', { detail: { source: 'play-button' } }));
      }
    });
    this.disposers.push(ctx.events.on('modeChanged', ({ mode }) => { if (mode === 'play') this.hide(); }));
    window.addEventListener('expedition-title-request', this.onTitleRequest);
    this.disposers.push(() => window.removeEventListener('expedition-title-request', this.onTitleRequest));
    if (!__AUTHORING__) {
      this.root.querySelector('.entry-workshops')?.remove();
      // Player builds: the header's Play (and Tab) in the Workshop lead back
      // here, never to the authoring run launcher. Capture on window runs
      // before the launcher's own listener.
      window.addEventListener('run-launcher-request', this.onLauncherRequest, { capture: true });
      this.disposers.push(() => window.removeEventListener('run-launcher-request', this.onLauncherRequest, { capture: true }));
      // The launcher claims the header Play button itself (capture on the
      // button); a document-level capture sees the click first.
      document.addEventListener('click', this.onPlayButtonCapture, true);
      this.disposers.push(() => document.removeEventListener('click', this.onPlayButtonCapture, true));
    }
  }

  show(): void {
    if (document.body.classList.contains('builder-open') || this.ctx.state.mode === 'play') return;
    this.ctx.state.paused = true;
    this.root.hidden = false;
    document.body.classList.add('entry-active');
    const saved = this.ctx.levels.hasSavedExpedition() || this.ctx.run?.active === true;
    this.root.querySelector<HTMLButtonElement>('[data-entry="continue"]')!.hidden = !saved;
    this.root.querySelector<HTMLButtonElement>('[data-entry="begin"]')!.textContent = saved ? 'Start a new descent' : 'Begin the descent';
    this.refreshMeta();
    this.root.querySelector<HTMLElement>('.entry-status')!.textContent = '';
    this.root.querySelector<HTMLButtonElement>(saved ? '[data-entry="continue"]' : '[data-entry="begin"]')?.focus();
  }

  private refreshMeta(): void {
    const view = this.ctx.run?.metaView();
    this.selectedKit = view?.lastKit ?? 'spark';
    this.kits.render(view?.unlockedKits ?? ['spark'], this.selectedKit);
    const note = this.root.querySelector<HTMLElement>('[data-entry-note="daily"]');
    if (note && view) {
      const best = view.todayBest;
      const bestText = best
        ? best.victory ? ` · best: the Kiln quieted in ${formatRunTime(best.timeMs)}` : ` · best: Floor ${best.floor}/${FLOORS_TOTAL} in ${formatRunTime(best.timeMs)}`
        : '';
      note.textContent = `${view.today} · one seed for everyone · the Sparkwright’s case${bestText}`;
    }
    // STORY: once seen, the opening can be watched again from here.
    const opening = this.root.querySelector<HTMLButtonElement>('[data-entry="opening"]');
    if (opening) opening.hidden = this.ctx.story?.openingSeen !== true;
    // The material sandbox opens to players once a first run has ended.
    const workshop = this.root.querySelector<HTMLButtonElement>('[data-entry="workshop"]');
    if (workshop) workshop.hidden = view?.workshopUnlocked !== true;
  }

  /** The story arrives with the play systems, after the title may already show: "The opening" follows it. */
  refreshStory(): void {
    const opening = this.root.querySelector<HTMLButtonElement>('[data-entry="opening"]');
    if (opening) opening.hidden = this.ctx.story?.openingSeen !== true;
  }

  private hide(): void { this.root.hidden = true; document.body.classList.remove('entry-active'); }

  private readonly onTitleRequest = (): void => {
    if (this.ctx.state.mode === 'play') document.getElementById('mode-build-btn')?.click();
    this.show();
  };

  private readonly onPlayButtonCapture = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('#mode-play-btn')) return;
    if (this.ctx.state.playtestSource !== null || document.body.classList.contains('builder-open')) return;
    event.preventDefault();
    event.stopPropagation();
    (target.closest('#mode-play-btn') as HTMLElement | null)?.blur();
    this.show();
  };

  private readonly onLauncherRequest = (event: Event): void => {
    const source = event instanceof CustomEvent ? (event.detail as { source?: string } | null)?.source : undefined;
    if (source === 'pause') return;
    event.stopImmediatePropagation();
    event.preventDefault();
    this.show();
  };

  private async launch(kind: 'continue' | 'begin' | 'daily'): Promise<void> {
    if (this.launching) return;
    const replacing = kind !== 'continue' && (this.ctx.levels.hasSavedExpedition() || this.ctx.run?.active === true);
    if (replacing) {
      const agreed = await appDialog.confirm(
        kind === 'daily'
          ? 'Begin today’s descent? Your current descent will be replaced.'
          : 'Start a new descent? Your current descent will be replaced.',
        { title: 'A new descent', confirmText: 'Begin anew', tone: 'danger' },
      );
      if (!agreed) return;
    }
    this.launching = true;
    const buttons = this.root.querySelectorAll<HTMLButtonElement>('button');
    for (const button of buttons) button.disabled = true;
    this.root.querySelector('.entry-status')!.textContent = kind === 'continue' ? 'Returning to the Works…' : 'Opening the intake…';
    this.ctx.audio.ensure();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      if (!(await this.playReady())) {
        this.root.querySelector('.entry-status')!.textContent = 'The Works could not finish loading. Refresh the page to try again.';
        return;
      }
      const started = this.start(kind);
      if (started.ok) { this.hide(); this.ctx.state.paused = false; }
      else this.root.querySelector('.entry-status')!.textContent = started.message;
    } catch (error) {
      this.root.querySelector('.entry-status')!.textContent = `The descent could not open. ${error instanceof Error ? error.message : 'Try again.'}`;
    } finally {
      this.launching = false;
      for (const button of buttons) button.disabled = false;
    }
  }

  private start(kind: 'continue' | 'begin' | 'daily'): RunStartResult {
    const ctx = this.ctx;
    if (kind === 'continue' || !ctx.run) {
      return ctx.levels.startRun(ctx, { mode: 'normal', worldSource: 'campaign', continueSave: kind === 'continue', loadout: 'fresh' });
    }
    return ctx.run.startNewRun(ctx, { kit: this.selectedKit, daily: kind === 'daily' });
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.settings.dispose();
    this.root.remove();
  }
}

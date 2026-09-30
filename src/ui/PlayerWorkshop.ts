import '@/styles/workshop.css';
import type { Ctx } from '@/core/types';
import { GAME_TITLE } from '@/config/brand';
import { ensureSandboxWorldDetached, resetCombatTransients } from '@/core/runtimeState';

/**
 * The Workshop as a player meets it (player builds only; main.ts constructs
 * this when `__AUTHORING__` is false).
 *
 * The Sandbox is the studio's material bench: world generation, level
 * library, frame stepping, per-material parameters. A player who has finished
 * a run and opened "The Workshop" from the title should find the same house
 * as the title and the ledger: a Cormorant heading, slate and brass, the
 * material palette, a brush, and a few safe toys. So this dresses the studio
 * chrome in place instead of building a second sandbox:
 *
 * - `body.player-build` scopes the house styles (styles/workshop.css) and
 *   hides every `[data-workshop-dev]` control (index.html). Those stay in the
 *   DOM: their owners bind them strictly, and hidden is all a player needs.
 * - The header becomes "The Workshop" with a way back to the title.
 * - The right rail becomes the bench: the existing brush slider (moved, so
 *   its binding stays live), Pause / Step, "Set the bench again" (the
 *   existing Fresh Workshop button, relabelled) and "Sweep it clean" — its
 *   own sweep, because the studio's Clear Canvas Matrix also zeroes the
 *   score, and a player can hold a live descent (Continue) while here.
 *
 * Everything a toy changes (a paused clock) is put back when the player
 * leaves for the title or starts a run: play must never inherit it.
 */
export class PlayerWorkshop {
  private readonly bench = document.createElement('div');
  private readonly pauseButton = document.createElement('button');
  private readonly stepButton = document.createElement('button');
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly ctx: Ctx) {
    document.body.classList.add('player-build');
    // The dock's tab panels are flattened into one list here, with no tabs to label them.
    for (const panel of document.querySelectorAll('#left-toolbar .sb-panel')) {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-labelledby');
    }
    this.dressHeader();
    this.buildBench();
    const filter = document.getElementById('toolbar-filter') as HTMLInputElement | null;
    if (filter) {
      filter.placeholder = 'Find a material…';
      filter.setAttribute('aria-label', 'Find a material or spell');
    }
    this.disposers.push(
      ctx.events.on('timeControlsChanged', () => this.syncTime()),
      ctx.events.on('modeChanged', ({ mode }) => { if (mode !== 'build') this.putToysAway(); }),
    );
    // Capture, so the in-run pause menu (which also listens for Escape) never
    // opens over the Workshop: here Escape is the way out.
    window.addEventListener('keydown', this.onKeyDown, true);
    this.disposers.push(() => window.removeEventListener('keydown', this.onKeyDown, true));
    this.syncTime();
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.bench.remove();
    document.body.classList.remove('player-build', 'workshop-paused');
  }

  private dressHeader(): void {
    const header = document.querySelector('body > header');
    const heading = header?.querySelector('h1');
    if (!header || !heading) return;
    heading.className = 'workshop-heading';
    heading.innerHTML = '<span class="workshop-title">The Workshop</span>' +
      '<span class="workshop-sub">Nothing here can hurt you, much.</span>';
    heading.title = `${GAME_TITLE} — the material bench`;
    const back = document.createElement('button');
    back.type = 'button';
    back.id = 'workshop-title-btn';
    back.className = 'workshop-btn';
    back.innerHTML = '<span class="workshop-btn-arrow" aria-hidden="true">←</span>Back to the title<kbd class="key">Esc</kbd>';
    back.setAttribute('aria-keyshortcuts', 'Escape');
    back.addEventListener('click', () => {
      back.blur();
      this.leave();
    });
    header.querySelector('.hud-wrapper')?.prepend(back);
  }

  private buildBench(): void {
    const rail = document.getElementById('right-inspector');
    if (!rail) return;
    this.bench.className = 'workshop-bench';

    const brush = this.group('Brush');
    const brushRow = document.getElementById('brush-size')?.parentElement;
    if (brushRow) {
      brushRow.classList.add('workshop-brush');
      const label = brushRow.querySelector('label');
      if (label) label.textContent = 'Size';
      brush.appendChild(brushRow);
    }
    const hint = document.createElement('p');
    hint.className = 'workshop-note';
    hint.textContent = 'Left click pours the material. Right click takes up whatever is under the cursor.';
    brush.appendChild(hint);

    const time = this.group('Time');
    const row = document.createElement('div');
    row.className = 'workshop-row';
    this.pauseButton.type = 'button';
    this.pauseButton.className = 'workshop-btn';
    this.pauseButton.addEventListener('click', () => {
      this.pauseButton.blur();
      this.ctx.time.setManual(!this.ctx.time.manual);
    });
    this.stepButton.type = 'button';
    this.stepButton.className = 'workshop-btn';
    this.stepButton.textContent = 'Step';
    this.stepButton.title = 'Advance one tick';
    this.stepButton.addEventListener('click', () => {
      this.stepButton.blur();
      this.ctx.time.queueTicks(1);
    });
    row.append(this.pauseButton, this.stepButton);
    time.appendChild(row);

    const tidy = this.group('The bench');
    const reset = document.getElementById('btn-sandbox');
    if (reset) {
      reset.className = 'workshop-btn';
      reset.textContent = 'Set the bench again';
      reset.title = 'Restore the Workshop as it was when you arrived';
      tidy.appendChild(reset);
    }
    const sweep = document.createElement('button');
    sweep.type = 'button';
    sweep.className = 'workshop-btn';
    sweep.textContent = 'Sweep it clean';
    sweep.title = 'Clear every cell from the bench';
    sweep.addEventListener('click', () => {
      sweep.blur();
      this.sweep();
    });
    tidy.appendChild(sweep);

    this.bench.append(brush, time, tidy);
    rail.prepend(this.bench);
  }

  private group(title: string): HTMLElement {
    const section = document.createElement('section');
    section.className = 'workshop-group';
    const heading = document.createElement('h2');
    heading.className = 'workshop-group-title';
    heading.textContent = title;
    section.appendChild(heading);
    return section;
  }

  private syncTime(): void {
    const paused = this.ctx.time.manual;
    this.pauseButton.textContent = paused ? 'Resume' : 'Pause';
    this.pauseButton.setAttribute('aria-pressed', String(paused));
    this.pauseButton.classList.toggle('lit', paused);
    this.stepButton.disabled = !paused;
    document.body.classList.toggle('workshop-paused', paused);
  }

  /** Empty the bench's grid. Only the sandbox world: never a run's gold or state. */
  private sweep(): void {
    const ctx = this.ctx;
    ensureSandboxWorldDetached(ctx);
    ctx.world.clear();
    resetCombatTransients(ctx, { simulationAccumulator: true });
    ctx.fx.screenShake = 0;
  }

  private leave(): void {
    this.putToysAway();
    window.dispatchEvent(new CustomEvent('expedition-title-request'));
  }

  /** Escape leaves the Workshop (after first letting go of the filter field). */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape' || e.defaultPrevented || e.repeat || this.ctx.state.mode !== 'build') return;
    const body = document.body.classList;
    if (body.contains('entry-active') || body.contains('builder-open') || body.contains('run-summary-open')) return;
    // Anything open over the bench owns its own Escape.
    if (document.querySelector('.app-dialog-root, #player-settings[open], #help-overlay.visible, #pause-overlay.visible')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.target instanceof HTMLInputElement) {
      e.target.blur();
      return;
    }
    this.leave();
  };

  /** Leave nothing behind for play: an unpaused clock. */
  private putToysAway(): void {
    if (this.ctx.time.manual) this.ctx.time.setManual(false);
  }
}

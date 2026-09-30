import type { Ctx, Difficulty, RunResult } from '@/core/types';
import type { KitId } from '@/core/run';
import { FLOOR_DOORS, doorTaken, floorDisplayName } from '@/config/worldgraph';
import { KIT_DEFS } from '@/content/kits';
import { boonNames, formatChain, formatRunTime, runHeadline, shareLine } from '@/game/runRules';
import { KitPicker } from '@/ui/KitPicker';
import { DifficultyPicker } from '@/ui/DifficultyPicker';
import { BASE_DIFFICULTY, DIFFICULTY_BLURBS } from '@/config/difficultyLadder';
import { DIFFICULTY } from '@/config/difficulty';
import { createModalFocusTrap, type ModalFocusTrap } from '@/ui/modalFocusTrap';

/** Victory lands after the Colossus's last explosion has. */
const VICTORY_REVEAL_MS = 2400;
/** Stat rows count up one after another. */
const STAT_STAGGER_MS = 110;
const COUNT_MS = 650;

/** Keys the ledger lets through: focus movement and activation. */
const NAV_KEYS = new Set([
  'Tab', 'Enter', 'NumpadEnter', 'Space', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyC',
]);

interface StatRow {
  label: string;
  value: number;
  format: (n: number) => string;
  /** Highlight the row (a best, an achievement). */
  accent?: boolean;
}

function reducedMotion(ctx: Ctx): boolean {
  return ctx.state.reduceFlashes === true || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * The run ledger (Breathing Works): what a finished run hands back. The
 * outcome headline in Cormorant over slate, the epitaph, the four floors with
 * the last one marked, the counters counting up one by one, today's best for
 * a daily, any kit the run unlocked, and the way on: Descend again (focused),
 * Save clip, Copy share line, Title.
 *
 * Victory reveals itself after the Colossus falls; an abandoned run shows at
 * once; a fall waits for the death screen's "Read the ledger".
 */
export class RunSummary {
  private readonly root = document.createElement('section');
  private readonly shell = document.createElement('div');
  private readonly kicker = document.createElement('p');
  private readonly title = document.createElement('h2');
  private readonly epitaph = document.createElement('p');
  private readonly floors = document.createElement('ol');
  private readonly stats = document.createElement('dl');
  private readonly daily = document.createElement('p');
  private readonly boons = document.createElement('p');
  private readonly unlocks = document.createElement('ul');
  private readonly kits: KitPicker;
  private readonly grades: DifficultyPicker;
  private readonly actions = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly shareText = document.createElement('p');
  private readonly againButton: HTMLButtonElement;
  private readonly trap: ModalFocusTrap;
  private readonly disposers: Array<() => void> = [];
  private readonly timers = new Set<number>();
  private rafs = new Set<number>();
  private shown: RunResult | null = null;
  private busy = false;
  /** A "Save clip" from the ledger is in flight; its outcome lands in the status line. */
  private awaitingClip = false;
  private chosenKit: KitId = 'spark';
  private chosenDifficulty: Difficulty = BASE_DIFFICULTY;

  constructor(private readonly ctx: Ctx) {
    this.root.id = 'run-summary';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'run-summary-title');
    this.shell.className = 'rs-shell';
    this.kicker.className = 'menu-label rs-kicker';
    this.title.id = 'run-summary-title';
    this.title.className = 'rs-title';
    this.epitaph.className = 'rs-epitaph';
    this.floors.className = 'rs-floors';
    this.floors.setAttribute('aria-label', 'Floors of the descent');
    this.stats.className = 'rs-stats';
    this.daily.className = 'rs-daily';
    this.boons.className = 'rs-boons';
    this.unlocks.className = 'rs-unlocks';
    this.kits = new KitPicker('Next descent', (kit) => {
      this.chosenKit = kit;
      ctx.run?.chooseKit(kit);
    });
    this.kits.root.classList.add('rs-kits');
    this.grades = new DifficultyPicker('Difficulty', (tier) => {
      this.chosenDifficulty = tier;
      ctx.run?.chooseDifficulty(tier);
    });
    this.grades.root.classList.add('rs-grades');
    this.actions.className = 'rs-actions';
    this.againButton = this.button('Descend again', 'again', true);
    this.actions.append(
      this.againButton,
      this.button('Save clip', 'clip'),
      this.button('Copy share line', 'share'),
      this.button('Title', 'title'),
    );
    this.actions.addEventListener('click', this.onAction);
    this.actions.addEventListener('keydown', this.onActionKeys);
    this.status.className = 'rs-status';
    this.status.setAttribute('role', 'status');
    this.shareText.className = 'rs-share';

    // A div, not <header>: the app shell styles every header element.
    const head = document.createElement('div');
    head.className = 'rs-head';
    head.append(this.kicker, this.title, this.epitaph);
    const body = document.createElement('div');
    body.className = 'rs-body';
    body.append(this.floors, this.stats, this.boons, this.daily, this.unlocks);
    const foot = document.createElement('div');
    foot.className = 'rs-foot';
    // The next descent's two choices sit side by side: the kit picker is the taller of the two, so the
    // difficulty picker beside it costs the ledger no height (it already scrolls on a short window).
    const choices = document.createElement('div');
    choices.className = 'rs-choices';
    choices.append(this.kits.root, this.grades.root);
    foot.append(choices, this.actions, this.status, this.shareText);
    this.shell.append(head, body, foot);
    this.root.appendChild(this.shell);
    document.getElementById('canvas-holder')?.appendChild(this.root);

    this.trap = createModalFocusTrap(this.root, { initialFocus: () => this.againButton, onEscape: () => this.againButton.focus() });
    this.disposers.push(ctx.events.on('runEnded', () => this.onRunEnded()));
    this.disposers.push(ctx.events.on('clipSaved', ({ durationMs }) => {
      if (!this.awaitingClip || !this.isOpen) return;
      this.awaitingClip = false;
      this.status.textContent = `Bottled: the last ${Math.max(1, Math.round(durationMs / 1000))} seconds, ready on the plate in the corner.`;
    }));
    this.disposers.push(ctx.events.on('clipFailed', ({ message }) => {
      if (!this.awaitingClip || !this.isOpen) return;
      this.awaitingClip = false;
      this.status.textContent = message;
    }));
    window.addEventListener('keydown', this.onKeyCapture, true);
    this.disposers.push(() => window.removeEventListener('keydown', this.onKeyCapture, true));
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.clearTimers();
    this.trap.deactivate({ restoreFocus: false });
    this.actions.removeEventListener('click', this.onAction);
    this.actions.removeEventListener('keydown', this.onActionKeys);
    this.root.remove();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * While the ledger is up it owns the keyboard: the game's hotkeys (bench,
   * map, handbook, grimoire, console) must not open underneath it. Navigation
   * keys pass through to the focus trap and the buttons.
   */
  private readonly onKeyCapture = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (NAV_KEYS.has(event.code)) return;
    event.stopImmediatePropagation();
  };

  /** The death screen's "Read the ledger". */
  showLast(): void {
    const result = this.ctx.run?.lastResult;
    if (result) this.show(result);
  }

  private onRunEnded(): void {
    const result = this.ctx.run?.lastResult;
    if (!result || !result.present) return;
    if (result.summary.outcome === 'abandoned') this.show(result);
    else if (result.summary.outcome === 'victory') this.later(() => this.show(result), VICTORY_REVEAL_MS);
    // A fall waits for the title card and the player's "Read the ledger".
  }

  private button(label: string, action: string, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'menu-btn primary' : 'menu-btn';
    b.dataset.rs = action;
    b.textContent = label;
    return b;
  }

  /* ---------------- reveal ---------------- */

  show(result: RunResult): void {
    if (this.isOpen && this.shown === result) return;
    this.clearTimers();
    this.shown = result;
    this.busy = false;
    const { summary } = result;
    const ctx = this.ctx;
    const still = reducedMotion(ctx);
    this.root.classList.toggle('rs-still', still);
    this.root.dataset.outcome = summary.outcome;

    // A tier other than Adept is named in the header, as the share line names it.
    const tier = summary.difficulty && summary.difficulty !== BASE_DIFFICULTY ? ` · ${DIFFICULTY[summary.difficulty].name}` : '';
    this.kicker.textContent = (summary.daily ? `The ledger · Daily descent ${summary.daily}` : 'The ledger') + tier;
    this.title.textContent = runHeadline(summary);
    this.epitaph.textContent = summary.epitaph;
    this.renderFloors(result);
    const rows = this.renderStats(result);
    this.renderBoons(result);
    this.renderDaily(result);
    this.renderUnlocks(result);
    const view = ctx.run?.metaView();
    this.chosenKit = view?.lastKit ?? summary.kit;
    this.kits.render(view?.unlockedKits ?? ['spark'], this.chosenKit, result.unlocked);
    this.chosenDifficulty = view?.lastDifficulty ?? BASE_DIFFICULTY;
    this.grades.render(view?.bestVictoryDifficulty ?? 0, this.chosenDifficulty, result.unlockedDifficulty);
    this.awaitingClip = false;
    this.status.textContent = result.recorded ? '' : 'A practice descent: debug tools were used, so the ledger keeps no record.';
    this.shareText.textContent = shareLine(summary);
    for (const b of this.actions.querySelectorAll('button')) b.disabled = false;

    ctx.state.paused = true;
    ctx.input.releaseHeldInput?.();
    this.root.hidden = false;
    document.body.classList.add('run-summary-open');
    ctx.events.emit('runLedger', { open: true });
    // Restart the reveal keyframes on every show.
    this.root.classList.remove('visible');
    void this.root.offsetWidth;
    this.root.classList.add('visible');
    this.trap.activate();
    this.trap.focusInitial(this.againButton);

    ctx.audio.ensure();
    this.playReveal(summary.outcome === 'victory');
    this.countUp(rows, still);
    if (result.unlocked.length > 0) this.later(() => ctx.audio.learn(), still ? 0 : 700 + rows.length * STAT_STAGGER_MS);
  }

  private hide(): void {
    this.clearTimers();
    this.awaitingClip = false;
    this.trap.deactivate({ restoreFocus: false });
    const wasOpen = !this.root.hidden;
    this.root.hidden = true;
    this.root.classList.remove('visible');
    document.body.classList.remove('run-summary-open');
    if (wasOpen) this.ctx.events.emit('runLedger', { open: false });
  }

  private playReveal(victory: boolean): void {
    this.ctx.audio.sfx(victory ? 'ui.summary.victory' : 'ui.summary.fallen');
  }

  private renderFloors(result: RunResult): void {
    const { summary } = result;
    this.floors.replaceChildren();
    // The route: each reached floor names the door this run took; a floor
    // not reached names both of its doors.
    FLOOR_DOORS.forEach((doors, i) => {
      const n = i + 1;
      const reachedFloor = n <= summary.floor;
      const id = reachedFloor ? doorTaken(summary.path, n) : doors[0];
      const label = !reachedFloor && doors.length > 1 ? doors.map(floorDisplayName).join(' or ') : floorDisplayName(id);
      const li = document.createElement('li');
      li.className = 'rs-floor';
      li.style.setProperty('--i', String(i));
      const reached = n <= summary.floor;
      if (reached) li.classList.add('reached');
      if (n === summary.floor) li.classList.add(summary.outcome === 'victory' ? 'won' : summary.outcome === 'fallen' ? 'fell' : 'left');
      const no = document.createElement('span');
      no.className = 'rs-floor-no';
      no.textContent = String(n);
      const name = document.createElement('span');
      name.className = 'rs-floor-name';
      name.textContent = label;
      if (doors.length > 1 && reachedFloor) li.classList.add('branch');
      li.append(no, name);
      li.setAttribute('aria-label', `Floor ${n}, ${label}${reached ? ', reached' : ''}`);
      this.floors.appendChild(li);
    });
  }

  private renderStats(result: RunResult): Array<{ row: StatRow; node: HTMLElement }> {
    const s = result.summary;
    const rows: StatRow[] = [
      { label: 'Time', value: s.timeMs, format: formatRunTime },
      { label: 'Floor', value: s.floor, format: (n) => `${Math.round(n)} of ${s.floorsTotal}`, accent: result.newBestFloor },
      { label: 'Kills', value: s.kills, format: (n) => String(Math.round(n)) },
      { label: 'Alchemical kills', value: s.alchemicalKills, format: (n) => String(Math.round(n)) },
      // The count-up passes fractions; a chain under ×1 is still a dash.
      { label: 'Best chain', value: s.bestChain, format: (n) => formatChain(Math.floor(n)) },
      { label: 'Deaths', value: s.deaths, format: (n) => String(Math.round(n)) },
      { label: 'Gold carried', value: s.gold, format: (n) => `${Math.round(n)} oz` },
      { label: 'Cards found', value: s.cardsFound, format: (n) => String(Math.round(n)) },
    ];
    this.stats.replaceChildren();
    return rows.map((row, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'rs-stat';
      if (row.accent) wrap.classList.add('accent');
      wrap.style.setProperty('--i', String(i));
      const dt = document.createElement('dt');
      dt.textContent = row.label;
      const dd = document.createElement('dd');
      dd.textContent = row.format(0);
      wrap.append(dt, dd);
      this.stats.appendChild(wrap);
      return { row, node: dd };
    });
  }

  /** The bargains this descent struck, named the way the share line names them. */
  private renderBoons(result: RunResult): void {
    const names = boonNames(result.summary.boons);
    this.boons.hidden = names === '';
    this.boons.replaceChildren();
    if (names === '') return;
    const label = document.createElement('span');
    label.className = 'rs-boons-label';
    label.textContent = 'Struck at the Sanctum';
    this.boons.append(label, document.createTextNode(names));
  }

  private renderDaily(result: RunResult): void {
    const { summary, dailyBest, newDailyBest } = result;
    this.daily.replaceChildren();
    this.daily.hidden = !summary.daily;
    if (!summary.daily) return;
    const best = dailyBest;
    const line = best
      ? best.victory
        ? `Today’s best: the Kiln quieted in ${formatRunTime(best.timeMs)}`
        : `Today’s best: Floor ${best.floor}/${summary.floorsTotal} in ${formatRunTime(best.timeMs)}`
      : summary.outcome === 'abandoned' && result.recorded
        ? 'An abandoned descent sets no daily best.'
        : 'Today’s descent is not recorded (practice run).';
    this.daily.append(document.createTextNode(line));
    if (newDailyBest) {
      const badge = document.createElement('b');
      badge.className = 'rs-badge';
      badge.textContent = 'New best';
      this.daily.append(' ', badge);
    }
  }

  private renderUnlocks(result: RunResult): void {
    this.unlocks.replaceChildren();
    this.unlocks.hidden = result.unlocked.length === 0 && result.unlockedDifficulty === null;
    // A victory can open a harder tier: it is announced with the new cases.
    if (result.unlockedDifficulty !== null) {
      const tier = DIFFICULTY[result.unlockedDifficulty];
      const li = document.createElement('li');
      li.className = 'rs-unlock';
      li.style.setProperty('--i', '0');
      const label = document.createElement('span');
      label.className = 'menu-label';
      label.textContent = 'A harder Works';
      const name = document.createElement('b');
      name.textContent = `${tier.name} (${tier.roman}) is open`;
      const blurb = document.createElement('span');
      blurb.className = 'rs-unlock-blurb';
      blurb.textContent = DIFFICULTY_BLURBS[result.unlockedDifficulty];
      li.append(label, name, blurb);
      this.unlocks.appendChild(li);
    }
    result.unlocked.forEach((kit, i) => {
      const def = KIT_DEFS[kit];
      const li = document.createElement('li');
      li.className = 'rs-unlock';
      li.style.setProperty('--i', String(i));
      const label = document.createElement('span');
      label.className = 'menu-label';
      label.textContent = 'A new case on the rack';
      const name = document.createElement('b');
      name.textContent = def.name;
      const blurb = document.createElement('span');
      blurb.className = 'rs-unlock-blurb';
      blurb.textContent = def.blurb;
      li.append(label, name, blurb);
      this.unlocks.appendChild(li);
    });
  }

  /** Numbers roll up in turn, each landing with a small tick. */
  private countUp(rows: Array<{ row: StatRow; node: HTMLElement }>, still: boolean): void {
    if (still) {
      for (const { row, node } of rows) node.textContent = row.format(row.value);
      return;
    }
    rows.forEach(({ row, node }, i) => {
      this.later(() => {
        const start = performance.now();
        const step = (now: number): void => {
          const t = Math.min(1, (now - start) / COUNT_MS);
          const eased = 1 - Math.pow(1 - t, 3);
          node.textContent = row.format(row.value * eased);
          if (t < 1) {
            this.frame(step);
          } else {
            node.textContent = row.format(row.value);
            if (row.value > 0) this.ctx.audio.sfx('ui.tally', undefined, undefined, { pitch: -i * 0.5 });
          }
        };
        this.frame(step);
      }, 380 + i * STAT_STAGGER_MS);
    });
  }

  /* ---------------- actions ---------------- */

  private readonly onAction = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-rs]');
    if (!button || button.disabled || this.busy) return;
    this.ctx.audio.ensure();
    switch (button.dataset.rs) {
      case 'again': void this.descendAgain(); break;
      case 'clip': this.saveClip(); break;
      case 'share': void this.copyShare(); break;
      case 'title': this.toTitle(); break;
    }
  };

  /** Arrow keys walk the action row (and wrap). */
  private readonly onActionKeys = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const buttons = [...this.actions.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    buttons[(at + dir + buttons.length) % buttons.length]?.focus();
  };

  private async descendAgain(): Promise<void> {
    const run = this.ctx.run;
    if (!run) return;
    this.busy = true;
    for (const b of this.actions.querySelectorAll('button')) b.disabled = true;
    this.status.textContent = `Opening the intake with ${KIT_DEFS[this.chosenKit].name}…`;
    // Two frames so the status paints before generation blocks the thread.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const started = run.startNewRun(this.ctx, { kit: this.chosenKit, daily: false, difficulty: this.chosenDifficulty });
    this.busy = false;
    if (started.ok) {
      this.hide();
      return;
    }
    this.status.textContent = started.message;
    for (const b of this.actions.querySelectorAll('button')) b.disabled = false;
  }

  private saveClip(): void {
    // Set before emitting: a refusal answers synchronously (clipFailed).
    this.awaitingClip = true;
    this.status.textContent = 'Bottling the last few seconds…';
    const handled = this.ctx.events.emit('clipRequested', { reason: 'summary' });
    if (!handled) {
      this.awaitingClip = false;
      this.status.textContent = 'Clips are not available in this build.';
    }
  }

  private async copyShare(): Promise<void> {
    const text = this.shareText.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      this.status.textContent = 'Copied. Paste it somewhere with a straight face.';
    } catch {
      // Clipboard refused (permissions, insecure context): select the line
      // so a Ctrl+C still works.
      const range = document.createRange();
      range.selectNodeContents(this.shareText);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      this.status.textContent = 'The clipboard declined. The line is selected; copy it by hand.';
    }
  }

  private toTitle(): void {
    this.hide();
    // The fall's title card must not linger over the title screen.
    if (this.ctx.player.dead) this.ctx.events.emit('playerDeathCleared');
    window.dispatchEvent(new CustomEvent('expedition-title-request'));
  }

  /* ---------------- timers ---------------- */

  private later(callback: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, ms);
    this.timers.add(id);
  }

  private frame(callback: (now: number) => void): void {
    const id = requestAnimationFrame((now) => {
      this.rafs.delete(id);
      callback(now);
    });
    this.rafs.add(id);
  }

  private clearTimers(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    for (const id of this.rafs) cancelAnimationFrame(id);
    this.rafs = new Set();
  }
}

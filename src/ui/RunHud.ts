import type { Ctx } from '@/core/types';
import { floorDisplayName, floorLabel, floorOf } from '@/config/worldgraph';
import { PhialRow, phialsLeftLine } from '@/ui/phialGlyph';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/**
 * The run's presence in play (Breathing Works): the three return phials
 * beside the vitals, and the death screen's side of the phial bargain.
 *
 * - HUD: a row of phial glyphs at the top of the vitals. A death drains one;
 *   the refuge or the Sanctum fills one back, with a chime.
 * - Death screen: the same row inside the title card, draining the phial this
 *   death spent as the card lands; the button reads "Return with a phial
 *   (2 left)". The death that finds no phial left swaps the button for
 *   "Read the ledger", which opens the run summary.
 *
 * Presentation only: RunDirector decides, this listens (runs after it on the
 * bus, so the counts are already settled when playerDied arrives here).
 */
export class RunHud {
  private readonly hudRow: PhialRow;
  private readonly deathRow: PhialRow;
  private readonly deathBlock = document.createElement('div');
  private readonly deathNote = document.createElement('p');
  private readonly ledgerButton = document.createElement('button');
  private readonly disposers: Array<() => void> = [];
  private readonly timers = new Set<number>();
  /** The phial this death spent, drained on the title card (-1 = none). */
  private pendingDrain = -1;
  private readonly respawnDefault: string;

  constructor(private readonly ctx: Ctx, private readonly openLedger: () => void) {
    const max = ctx.run?.maxPhials ?? 3;
    this.hudRow = new PhialRow(max, 'phial-row hud-phials');
    this.hudRow.root.id = 'phial-row';
    this.hudRow.root.hidden = true;
    const vitals = document.querySelector('#hud-left .vitals');
    vitals?.insertBefore(this.hudRow.root, vitals.firstChild);

    this.deathRow = new PhialRow(max, 'phial-row go-phial-row');
    this.deathBlock.className = 'go-phials';
    this.deathBlock.hidden = true;
    this.deathNote.className = 'go-phials-note';
    this.deathBlock.append(this.deathRow.root, this.deathNote);
    this.ledgerButton.type = 'button';
    this.ledgerButton.id = 'ledger-btn';
    this.ledgerButton.textContent = 'Read the ledger';
    this.ledgerButton.hidden = true;
    this.ledgerButton.addEventListener('click', this.onLedgerClick);
    const respawn = el('respawn-btn');
    this.respawnDefault = respawn?.textContent ?? 'Return to your waystone';
    el('go-cause')?.after(this.deathBlock);
    respawn?.after(this.ledgerButton);

    const on = ctx.events.on.bind(ctx.events);
    this.disposers.push(
      on('phialsChanged', ({ phials, max: cap, reason }) => this.onPhials(phials, cap, reason)),
      on('playerDied', () => this.onDied()),
      on('deathCinema', ({ phase }) => { if (phase === 'title') this.onTitle(); }),
      on('playerRespawned', () => this.resetDeathScreen()),
      on('playerDeathCleared', () => this.resetDeathScreen()),
      on('modeChanged', () => this.syncVisibility()),
      on('levelChanged', () => this.syncVisibility()),
      on('runEnded', () => this.syncVisibility()),
    );
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    this.ledgerButton.removeEventListener('click', this.onLedgerClick);
    this.ledgerButton.remove();
    this.deathBlock.remove();
    this.hudRow.dispose();
    this.deathRow.dispose();
    const respawn = el('respawn-btn');
    if (respawn) {
      respawn.hidden = false;
      respawn.textContent = this.respawnDefault;
    }
  }

  private readonly onLedgerClick = (): void => {
    this.ctx.audio.ensure();
    this.openLedger();
  };

  private syncVisibility(): void {
    const run = this.ctx.run;
    const playtest = this.ctx.state.playtestSource !== null && this.ctx.state.playtestSource !== undefined;
    this.hudRow.root.hidden = !(this.ctx.state.mode === 'play' && !playtest && run && (run.active || run.over));
  }

  private onPhials(phials: number, max: number, reason: 'start' | 'death' | 'refuge' | 'sanctum' | 'restore'): void {
    this.syncVisibility();
    if (reason === 'death') {
      this.hudRow.drain(phials, phials, max);
      return;
    }
    if (reason === 'refuge' || reason === 'sanctum') {
      this.hudRow.fill(phials - 1, phials, max);
      this.hudRow.root.classList.remove('refilled');
      void this.hudRow.root.offsetWidth;
      this.hudRow.root.classList.add('refilled');
      this.chime();
      return;
    }
    this.hudRow.set(phials, max);
  }

  /** A glassy rising chime: the phial is full again. */
  private chime(): void {
    const audio = this.ctx.audio;
    audio.tone(784, 1175, 0.22, 'sine', 0.045);
    this.later(() => audio.tone(1175, 1568, 0.3, 'triangle', 0.03), 110);
    this.later(() => audio.tone(1568, 1568, 0.45, 'sine', 0.018), 240);
  }

  private onDied(): void {
    const run = this.ctx.run;
    const respawn = el('respawn-btn');
    this.pendingDrain = -1;
    const playtest = this.ctx.state.playtestSource !== null && this.ctx.state.playtestSource !== undefined;
    if (!run || playtest || (!run.active && !run.over)) {
      this.deathBlock.hidden = true;
      this.ledgerButton.hidden = true;
      if (respawn) {
        respawn.hidden = false;
        respawn.textContent = this.respawnDefault;
      }
      return;
    }
    this.deathBlock.hidden = false;
    this.deathBlock.classList.toggle('final', run.over);
    // "Floor 2 of 4 · The Rot Gardens" in place of the depth code.
    const levelId = this.ctx.levels.current?.def.id;
    const wave = el('go-wave');
    if (wave && floorOf(levelId) > 0) wave.textContent = `${floorLabel(levelId)} · ${floorDisplayName(levelId)}`;
    if (run.over) {
      // The death that found no phial: every glass is already dark.
      this.deathRow.set(0, run.maxPhials);
      this.deathNote.textContent = 'No return phials left. The descent ends here.';
      if (respawn) respawn.hidden = true;
      this.ledgerButton.hidden = false;
      return;
    }
    // Show the glass as it was a moment ago; the title card drains it.
    this.deathRow.set(run.phials + 1, run.maxPhials);
    this.pendingDrain = run.phials;
    this.deathNote.textContent = phialsLeftLine(run.phials);
    this.ledgerButton.hidden = true;
    if (respawn) {
      respawn.hidden = false;
      respawn.textContent = run.phials > 0 ? `Return with a phial (${run.phials} left)` : 'Return with your last phial';
    }
  }

  private onTitle(): void {
    const run = this.ctx.run;
    if (!run) return;
    if (run.over) {
      this.ctx.audio.tone(110, 55, 1.4, 'sine', 0.06);
      this.later(() => this.ledgerButton.focus({ preventScroll: true }), 30);
      return;
    }
    if (this.pendingDrain < 0) return;
    const index = this.pendingDrain;
    this.pendingDrain = -1;
    // Let the title settle first, then the glass gives up its draught.
    this.later(() => {
      this.deathRow.drain(index, run.phials, run.maxPhials);
      const audio = this.ctx.audio;
      audio.tone(1760, 1320, 0.12, 'triangle', 0.035);
      this.later(() => audio.tone(660, 330, 0.5, 'sine', 0.04), 90);
    }, 900);
  }

  private resetDeathScreen(): void {
    this.pendingDrain = -1;
    this.deathBlock.hidden = true;
    this.deathBlock.classList.remove('final');
    this.ledgerButton.hidden = true;
    const respawn = el('respawn-btn');
    if (respawn) {
      respawn.hidden = false;
      respawn.textContent = this.respawnDefault;
    }
    this.syncVisibility();
  }

  private later(callback: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, ms);
    this.timers.add(id);
  }
}

import type { Ctx } from '@/core/types';
import { parseChosenSeed } from '@/game/runRules';

/**
 * "Choose a seed": a small fold under Today's descent on the title. The same seed and case make
 * the same Works, so a friend's number (from a ledger or a share line) or any words will do; the
 * daily is untouched. Leaving it empty is what Begin always did: a random descent.
 *
 * Owns only its own widgets. The title tells it what to do with a chosen seed (`onBegin`), and
 * asks it to `refresh()` whenever it shows, so "Copy this descent's seed" appears only while a
 * descent is in hand.
 */
export class SeedDisclosure {
  readonly root = document.createElement('details');
  private readonly input: HTMLInputElement;
  private readonly preview: HTMLElement;
  private readonly begin: HTMLButtonElement;
  private readonly copy: HTMLButtonElement;

  constructor(private readonly ctx: Ctx, onBegin: (seed: number) => void) {
    this.root.className = 'entry-seed';
    this.root.innerHTML = `<summary>Choose a seed</summary><div class="entry-seed-body">
      <label for="entry-seed-input">Seed</label>
      <input id="entry-seed-input" type="text" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="a number, or any words" aria-describedby="entry-seed-preview">
      <p class="entry-seed-preview" id="entry-seed-preview" role="status"></p>
      <div class="entry-seed-actions"><button type="button" data-seed="begin" disabled>Begin with this seed</button><button type="button" data-seed="copy" hidden>Copy this descent’s seed</button></div>
      <p class="entry-seed-note">Same seed, same case, same Works. The ledger and share line print it for a friend.</p></div>`;
    this.input = this.root.querySelector('input')!;
    this.preview = this.root.querySelector<HTMLElement>('.entry-seed-preview')!;
    this.begin = this.root.querySelector<HTMLButtonElement>('[data-seed="begin"]')!;
    this.copy = this.root.querySelector<HTMLButtonElement>('[data-seed="copy"]')!;
    // Keys typed here are the field's, not the title's or the game's.
    this.input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && !this.begin.disabled) { event.preventDefault(); this.begin.click(); }
    });
    this.input.addEventListener('input', () => this.sync());
    this.begin.addEventListener('click', () => {
      const chosen = parseChosenSeed(this.input.value);
      if (chosen) onBegin(chosen.seed);
    });
    this.copy.addEventListener('click', () => void this.copyCurrent());
    // Opened, the fold brings itself into view and the title's footer steps aside (it would print over the note).
    this.root.addEventListener('toggle', () => {
      this.root.closest('#expedition-entry')?.classList.toggle('seed-open', this.root.open);
      if (this.root.open) this.root.scrollIntoView({ block: 'nearest' });
    });
  }

  /** The seed of the descent in hand, if there is one. */
  currentSeed(): number | null {
    const save = this.ctx.run?.active ? this.ctx.run.snapshotForSave() : null;
    return save ? save.seed >>> 0 : null;
  }

  /** The title is showing: offer the copy button only while a descent exists. */
  refresh(): void {
    this.copy.hidden = this.currentSeed() === null;
    this.sync();
  }

  private sync(): void {
    const chosen = parseChosenSeed(this.input.value);
    this.begin.disabled = chosen === null;
    this.preview.textContent = chosen === null ? '' : chosen.phrase ? `Those words make seed ${chosen.seed}.` : `Seed ${chosen.seed}.`;
  }

  private async copyCurrent(): Promise<void> {
    const seed = this.currentSeed();
    if (seed === null) return;
    try {
      await navigator.clipboard.writeText(String(seed));
      this.preview.textContent = `Copied seed ${seed}.`;
    } catch {
      // Clipboard refused (permissions, insecure context): put it in the field, selected, so Ctrl+C works.
      this.input.value = String(seed);
      this.input.focus();
      this.input.select();
      this.sync();
      this.preview.textContent = `The clipboard declined. Seed ${seed} is in the field; copy it by hand.`;
    }
  }
}

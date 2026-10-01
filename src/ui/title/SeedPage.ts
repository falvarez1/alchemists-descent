import type { Ctx } from '@/core/types';
import { parseChosenSeed } from '@/game/runRules';
import { SEED_NOTE } from '@/ui/title/titleMenuModel';

export interface ChosenSeed { seed: number; phrase: boolean }

/**
 * The Seed page of the new-descent menu: a text field, a line that says what the text makes, and (while a
 * descent is in hand) a way to copy its seed for a friend. The same seed and case make the same Works, so a
 * number from a ledger or any words will do. Empty means what Begin always did: a random descent.
 *
 * Owns only its own widgets; the entry reads `parsed()` and asks it to `refresh()` whenever the page opens.
 */
export class SeedPage {
  readonly input = document.createElement('input');
  private readonly preview = document.createElement('p');
  private readonly bodyEl = document.createElement('div');

  constructor(private readonly ctx: Ctx, private readonly onChange: () => void, private readonly onSubmit: () => void) {
    this.bodyEl.className = 'tm-seed';
    const label = document.createElement('label');
    label.htmlFor = 'entry-seed-input';
    label.textContent = 'Seed';
    this.input.id = 'entry-seed-input';
    this.input.type = 'text';
    this.input.maxLength = 40;
    this.input.autocomplete = 'off';
    this.input.autocapitalize = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = 'a number, or any words';
    this.input.setAttribute('aria-describedby', 'entry-seed-preview');
    this.preview.id = 'entry-seed-preview';
    this.preview.className = 'entry-seed-preview';
    this.preview.setAttribute('role', 'status');
    const note = document.createElement('p');
    note.className = 'tm-seed-note';
    note.textContent = SEED_NOTE;
    this.bodyEl.append(label, this.input, this.preview, note);
    // Keys typed here are the field's: not the menu's (Left / Right / Backspace), not the game's.
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.onSubmit(); return; }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Escape') event.stopPropagation();
    });
    this.input.addEventListener('input', () => { this.sync(); this.onChange(); });
  }

  body(): HTMLElement { return this.bodyEl; }

  parsed(): ChosenSeed | null {
    return parseChosenSeed(this.input.value);
  }

  /** Show `chosen` in the field (the page opens on what was picked last). */
  show(chosen: ChosenSeed | null, phrase?: string): void {
    this.input.value = chosen ? phrase ?? String(chosen.seed >>> 0) : '';
    this.sync();
  }

  clear(): void {
    this.input.value = '';
    this.sync();
  }

  /** The seed of the descent in hand, if there is one. */
  currentSeed(): number | null {
    const save = this.ctx.run?.active ? this.ctx.run.snapshotForSave() : null;
    return save ? save.seed >>> 0 : null;
  }

  sync(): void {
    const chosen = this.parsed();
    this.preview.textContent = chosen === null ? '' : chosen.phrase ? `Those words make seed ${chosen.seed}.` : `Seed ${chosen.seed}.`;
  }

  async copyCurrent(): Promise<void> {
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

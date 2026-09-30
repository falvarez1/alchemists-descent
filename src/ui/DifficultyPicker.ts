import type { Difficulty } from '@/core/types';
import { DIFFICULTY, DIFFICULTY_ORDER } from '@/config/difficulty';
import {
  BASE_DIFFICULTY,
  DIFFICULTY_BLURBS,
  difficultyUnlockHint,
  isDifficultyOpen,
  openDifficulty,
} from '@/config/difficultyLadder';

/**
 * Choose how hard the descent bites. Four chips (a roman numeral and the tier's
 * name) and one line of copy below for the selected tier — or, for a locked
 * chip under the pointer or focus, how to earn it. Built on the kit picker's
 * chip styles and behaves like it: arrow keys move the choice, locked chips
 * can be focused (so their hint is readable) but never chosen. Shared by the
 * title screen and the run ledger.
 */
export class DifficultyPicker {
  readonly root = document.createElement('div');
  private readonly row = document.createElement('div');
  private readonly note = document.createElement('p');
  private readonly chips = new Map<Difficulty, HTMLButtonElement>();
  private bestVictory = 0;
  private fresh: Difficulty | null = null;
  private _selected: Difficulty = BASE_DIFFICULTY;

  constructor(label: string, private readonly onChange: (tier: Difficulty) => void) {
    this.root.className = 'kit-picker difficulty-picker';
    const heading = document.createElement('p');
    heading.className = 'kit-picker-label menu-label';
    heading.textContent = label;
    this.row.className = 'kit-chips';
    this.row.setAttribute('role', 'radiogroup');
    this.row.setAttribute('aria-label', label);
    this.note.className = 'kit-note';
    this.note.setAttribute('aria-live', 'polite');
    for (const tier of DIFFICULTY_ORDER) {
      const def = DIFFICULTY[tier];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'kit-chip difficulty-chip';
      chip.dataset.difficulty = String(tier);
      chip.setAttribute('role', 'radio');
      const numeral = document.createElement('span');
      numeral.className = 'kit-chip-icon difficulty-numeral';
      numeral.textContent = def.roman;
      const name = document.createElement('span');
      name.className = 'kit-chip-name';
      name.textContent = def.name;
      chip.append(numeral, name);
      chip.addEventListener('click', () => this.choose(tier, true));
      chip.addEventListener('mouseenter', () => this.describe(tier));
      chip.addEventListener('mouseleave', () => this.describe(this._selected));
      chip.addEventListener('focus', () => this.describe(tier));
      chip.addEventListener('blur', () => this.describe(this._selected));
      chip.addEventListener('keydown', (event) => this.onKey(event, tier));
      this.chips.set(tier, chip);
      this.row.appendChild(chip);
    }
    this.root.append(heading, this.row, this.note);
  }

  get selected(): Difficulty {
    return this._selected;
  }

  /** Refresh what is open (from the hardest tier won on) and the selection; `fresh` wears the new-unlock shine. */
  render(bestVictory: number, selected: Difficulty, fresh: Difficulty | null = null): void {
    this.bestVictory = bestVictory;
    this.fresh = fresh;
    this._selected = openDifficulty(selected, bestVictory);
    for (const [tier, chip] of this.chips) {
      const open = isDifficultyOpen(tier, bestVictory);
      const def = DIFFICULTY[tier];
      chip.classList.toggle('locked', !open);
      chip.classList.toggle('fresh', this.fresh === tier);
      chip.setAttribute('aria-disabled', String(!open));
      chip.setAttribute('aria-checked', String(tier === this._selected));
      chip.tabIndex = tier === this._selected ? 0 : -1;
      const hint = difficultyUnlockHint(tier);
      chip.title = open ? def.name : `${def.name} — locked. ${hint}`;
      chip.setAttribute('aria-label', open ? def.name : `${def.name}, locked. ${hint}`);
    }
    this.describe(this._selected);
  }

  focus(): void {
    this.chips.get(this._selected)?.focus({ preventScroll: true });
  }

  private choose(tier: Difficulty, notify: boolean): void {
    if (!isDifficultyOpen(tier, this.bestVictory)) {
      this.describe(tier);
      const chip = this.chips.get(tier);
      chip?.classList.remove('refused');
      void chip?.offsetWidth;
      chip?.classList.add('refused');
      return;
    }
    const changed = tier !== this._selected;
    this.render(this.bestVictory, tier, this.fresh === tier ? null : this.fresh);
    if (notify && changed) this.onChange(tier);
  }

  private onKey(event: KeyboardEvent, tier: Difficulty): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    let at = DIFFICULTY_ORDER.indexOf(tier);
    for (let n = 0; n < DIFFICULTY_ORDER.length; n++) {
      at = (at + step + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length;
      const next = DIFFICULTY_ORDER[at];
      if (isDifficultyOpen(next, this.bestVictory)) {
        this.choose(next, true);
        this.chips.get(next)?.focus({ preventScroll: true });
        return;
      }
    }
  }

  private describe(tier: Difficulty): void {
    const open = isDifficultyOpen(tier, this.bestVictory);
    this.note.classList.toggle('locked', !open);
    this.note.replaceChildren();
    const name = document.createElement('b');
    name.textContent = DIFFICULTY[tier].name;
    this.note.append(name, document.createTextNode(open ? ` — ${DIFFICULTY_BLURBS[tier]}` : ` — locked. ${difficultyUnlockHint(tier)}`));
  }
}

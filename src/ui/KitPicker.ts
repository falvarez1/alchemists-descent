import type { KitId } from '@/core/run';
import { KIT_DEFS, KIT_ORDER } from '@/content/kits';
import { cardIconName, makeIconCanvas } from '@/ui/icons';

/**
 * Choose the case you descend with. A row of four kit chips (icon + short
 * name) and one line of copy below that describes the selected kit — or, for
 * a locked chip under the pointer or focus, how to earn it. Arrow keys move
 * the choice; locked chips can be focused (so their hint is readable) but
 * never chosen. Shared by the title screen and the run ledger.
 */
export class KitPicker {
  readonly root = document.createElement('div');
  private readonly row = document.createElement('div');
  private readonly note = document.createElement('p');
  private readonly chips = new Map<KitId, HTMLButtonElement>();
  private unlocked = new Set<KitId>(['spark']);
  private fresh = new Set<KitId>();
  private _selected: KitId = 'spark';

  constructor(label: string, private readonly onChange: (kit: KitId) => void) {
    this.root.className = 'kit-picker';
    const heading = document.createElement('p');
    heading.className = 'kit-picker-label menu-label';
    heading.textContent = label;
    this.row.className = 'kit-chips';
    this.row.setAttribute('role', 'radiogroup');
    this.row.setAttribute('aria-label', label);
    this.note.className = 'kit-note';
    this.note.setAttribute('aria-live', 'polite');
    for (const id of KIT_ORDER) {
      const def = KIT_DEFS[id];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'kit-chip';
      chip.dataset.kit = id;
      chip.setAttribute('role', 'radio');
      const icon = document.createElement('span');
      icon.className = 'kit-chip-icon';
      const canvas = makeIconCanvas(cardIconName(def.wands[0][0] ?? 'spark'), 2);
      if (canvas) icon.appendChild(canvas);
      const name = document.createElement('span');
      name.className = 'kit-chip-name';
      name.textContent = def.short;
      chip.append(icon, name);
      chip.addEventListener('click', () => this.choose(id, true));
      chip.addEventListener('mouseenter', () => this.describe(id));
      chip.addEventListener('mouseleave', () => this.describe(this._selected));
      chip.addEventListener('focus', () => this.describe(id));
      chip.addEventListener('blur', () => this.describe(this._selected));
      chip.addEventListener('keydown', (event) => this.onKey(event, id));
      this.chips.set(id, chip);
      this.row.appendChild(chip);
    }
    this.root.append(heading, this.row, this.note);
  }

  get selected(): KitId {
    return this._selected;
  }

  /** Refresh unlocks and the selection; `fresh` kits wear the new-unlock shine. */
  render(unlocked: readonly KitId[], selected: KitId, fresh: readonly KitId[] = []): void {
    this.unlocked = new Set<KitId>(['spark', ...unlocked]);
    this.fresh = new Set(fresh);
    this._selected = this.unlocked.has(selected) ? selected : 'spark';
    for (const [id, chip] of this.chips) {
      const open = this.unlocked.has(id);
      chip.classList.toggle('locked', !open);
      chip.classList.toggle('fresh', this.fresh.has(id));
      chip.setAttribute('aria-disabled', String(!open));
      chip.setAttribute('aria-checked', String(id === this._selected));
      chip.tabIndex = id === this._selected ? 0 : -1;
      const def = KIT_DEFS[id];
      chip.title = open ? def.name : `${def.name} — locked. ${def.unlockHint}`;
      chip.setAttribute('aria-label', open ? def.name : `${def.name}, locked. ${def.unlockHint}`);
    }
    this.describe(this._selected);
  }

  /** Focus the chosen chip (roving tab stop). */
  focus(): void {
    this.chips.get(this._selected)?.focus({ preventScroll: true });
  }

  private choose(id: KitId, notify: boolean): void {
    if (!this.unlocked.has(id)) {
      this.describe(id);
      const chip = this.chips.get(id);
      chip?.classList.remove('refused');
      void chip?.offsetWidth;
      chip?.classList.add('refused');
      return;
    }
    const changed = id !== this._selected;
    this.render([...this.unlocked], id, [...this.fresh].filter((kit) => kit !== id));
    if (notify && changed) this.onChange(id);
  }

  private onKey(event: KeyboardEvent, id: KitId): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const order = [...KIT_ORDER];
    const step = event.key === 'ArrowRight' ? 1 : -1;
    let at = order.indexOf(id);
    for (let n = 0; n < order.length; n++) {
      at = (at + step + order.length) % order.length;
      const next = order[at];
      if (this.unlocked.has(next)) {
        this.choose(next, true);
        this.chips.get(next)?.focus({ preventScroll: true });
        return;
      }
    }
  }

  private describe(id: KitId): void {
    const def = KIT_DEFS[id];
    const open = this.unlocked.has(id);
    this.note.classList.toggle('locked', !open);
    this.note.replaceChildren();
    const name = document.createElement('b');
    name.textContent = def.name;
    this.note.append(name, document.createTextNode(open ? ` — ${def.blurb}` : ` — locked. ${def.unlockHint}`));
  }
}

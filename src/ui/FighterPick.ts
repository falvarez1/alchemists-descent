import { FIGHTER_DEFS, fighterPortraitUrl } from '@/content/fighters';
import type { FighterId } from '@/content/fighters';
import type { Ctx } from '@/core/types';
import { getBindings, keyLabel } from '@/input/bindings';
import { FighterRoster } from '@/ui/FighterRoster';

/**
 * "Your fighter": the one chip on the title and the ledger that names who the descent is for and opens the
 * Fighter Roster to change it. It borrows the kit picker's look (a labelled row of chips and one line of
 * copy) so the two read as a pair: the case you carry, and the one who carries it.
 *
 * One Fighter Roster serves the whole game (its overlay has a fixed id), so the picker that opened it hands
 * over its own callbacks for the one choice.
 */

let roster: FighterRoster | null = null;
const handlers: { choose: ((id: FighterId | null) => void) | null; cancel: (() => void) | null } = { choose: null, cancel: null };

function sharedRoster(ctx: Ctx): FighterRoster {
  roster ??= new FighterRoster(ctx, {
    onChoose: (id) => { const h = handlers.choose; handlers.choose = handlers.cancel = null; h?.(id); },
    onCancel: () => { const h = handlers.cancel; handlers.choose = handlers.cancel = null; h?.(); },
  });
  return roster;
}

/** Open the roster for one caller; `choose` fires with the choice (null = the classic Alchemist), `cancel` on Escape or Back. */
export function openFighterRoster(ctx: Ctx, selected: FighterId | null, choose: (id: FighterId | null) => void, cancel?: () => void): void {
  handlers.choose = choose;
  handlers.cancel = cancel ?? null;
  const r = sharedRoster(ctx);
  const b = getBindings();
  r.refresh({ keyLabels: { tactical: keyLabel(b.tactical), ultimate: keyLabel(b.ultimate) } });
  r.open(selected);
}

export class FighterPick {
  readonly root = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly note = document.createElement('p');
  private selected: FighterId | null = null;

  constructor(private readonly ctx: Ctx, label: string, private readonly onChange: (id: FighterId | null) => void) {
    this.root.className = 'kit-picker fighter-pick';
    const heading = document.createElement('p');
    heading.className = 'kit-picker-label menu-label';
    heading.textContent = label;
    const row = document.createElement('div');
    row.className = 'kit-chips';
    this.button.type = 'button';
    this.button.className = 'kit-chip fighter-pick-chip';
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.addEventListener('click', () => this.open());
    row.append(this.button);
    this.note.className = 'kit-note';
    this.note.setAttribute('aria-live', 'polite');
    this.root.append(heading, row, this.note);
    this.render(null);
  }

  get value(): FighterId | null {
    return this.selected;
  }

  render(selected: FighterId | null): void {
    this.selected = selected;
    const def = selected ? FIGHTER_DEFS[selected] : null;
    this.button.replaceChildren();
    const thumb = document.createElement('span');
    thumb.className = 'kit-chip-icon fighter-pick-thumb';
    if (def) {
      const img = document.createElement('img');
      img.src = fighterPortraitUrl(def.id);
      img.alt = '';
      img.decoding = 'async';
      thumb.append(img);
      thumb.style.setProperty('--fighter-accent', def.accent);
    } else thumb.textContent = '⚗';
    const name = document.createElement('span');
    name.className = 'kit-chip-name';
    name.textContent = def ? def.name : 'The Alchemist';
    const more = document.createElement('span');
    more.className = 'fighter-pick-more';
    more.textContent = 'Change';
    more.setAttribute('aria-hidden', 'true');
    this.button.append(thumb, name, more);
    this.button.setAttribute('aria-label', `${label(def)}: change fighter`);
    const b = getBindings();
    this.note.textContent = def
      ? `${def.title}. ${def.role}: ${def.passive.name} (passive), ${def.tactical.name} (${keyLabel(b.tactical)}), ${def.ultimate.name} (${keyLabel(b.ultimate)}).`
      : 'The classic descent: the Alchemist, with no passive and no abilities.';
  }

  private open(): void {
    openFighterRoster(
      this.ctx,
      this.selected,
      (id) => { this.render(id); this.onChange(id); this.button.focus({ preventScroll: true }); },
      () => this.button.focus({ preventScroll: true }),
    );
  }

  dispose(): void {
    this.root.remove();
  }
}

function label(def: (typeof FIGHTER_DEFS)[FighterId] | null): string {
  return def ? `${def.name}, ${def.title}` : 'The Alchemist (no fighter)';
}

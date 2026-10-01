import type { Ctx } from '@/core/types';
import {
  MAX_MUTATORS,
  MUTATOR_DEFS,
  MUTATOR_ORDER,
  cleanMutators,
  conflictsWith,
  mutatorLoad,
  mutatorLoadText,
  mutatorNames,
  mutatorsCountForLadder,
  type MutatorId,
} from '@/content/mutators';

/** The weight's mark on a chip: '+1', '±0', '−1' (a real minus, not a hyphen). */
function loadMark(weight: number): string {
  if (weight > 0) return `+${weight}`;
  if (weight < 0) return `−${-weight}`;
  return '±0';
}

/**
 * "Complications": a fold on the title (and on the ledger, for the next descent) that chooses the
 * standing regulations a descent runs under (content/mutators). Up to three, each a toggle chip with its
 * weight on it; the regulation under the pointer or focus is read out below; a total says what the set
 * adds up to and whether a win under it would count toward the next tier.
 *
 * It is a `<details>` like the seed fold (the difficulty row leaves almost no height on a 720p title),
 * closed it is one line that names what is chosen, and it remembers the choice through
 * `ctx.run.chooseMutators` (the meta profile), so "Begin" and "Descend again" both start from it.
 * Today's descent carries its own, set by the date, and ignores whatever is chosen here: the fold says so.
 */
export class ComplicationsDisclosure {
  readonly root = document.createElement('details');
  private readonly summary = document.createElement('summary');
  private readonly chips = new Map<MutatorId, HTMLButtonElement>();
  private readonly note = document.createElement('p');
  private readonly total = document.createElement('p');
  private readonly today = document.createElement('p');
  private readonly clear = document.createElement('button');
  private chosen: MutatorId[] = [];
  private focused: MutatorId | null = null;

  constructor(private readonly ctx: Ctx, surface: 'title' | 'ledger') {
    this.root.className = `entry-seed entry-comps entry-comps-${surface}`;
    const body = document.createElement('div');
    body.className = 'entry-comps-body';
    const lead = document.createElement('p');
    lead.className = 'entry-comps-lead';
    lead.textContent = `Standing regulations for one descent: up to ${MAX_MUTATORS}. Each changes how the floors behave, not what they are.`;
    const row = document.createElement('div');
    row.className = 'comp-chips';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Complications');
    for (const id of MUTATOR_ORDER) {
      const def = MUTATOR_DEFS[id];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'comp-chip';
      chip.dataset.mutator = id;
      chip.dataset.weight = String(def.weight);
      chip.setAttribute('aria-pressed', 'false');
      const name = document.createElement('span');
      name.className = 'comp-chip-name';
      name.textContent = def.name;
      const load = document.createElement('span');
      load.className = 'comp-chip-load';
      load.setAttribute('aria-hidden', 'true');
      load.textContent = loadMark(def.weight);
      chip.title = `${def.name}: ${def.regulation}`;
      chip.append(name, load);
      chip.addEventListener('click', () => this.toggle(id));
      for (const type of ['mouseenter', 'focus'] as const) chip.addEventListener(type, () => this.describe(id));
      for (const type of ['mouseleave', 'blur'] as const) chip.addEventListener(type, () => this.describe(null));
      this.chips.set(id, chip);
      row.appendChild(chip);
    }
    this.note.className = 'comp-note';
    this.note.setAttribute('aria-live', 'polite');
    this.total.className = 'comp-total';
    this.today.className = 'comp-today';
    this.clear.type = 'button';
    this.clear.className = 'comp-clear';
    this.clear.textContent = 'Clear';
    this.clear.addEventListener('click', () => this.set([]));
    const foot = document.createElement('div');
    foot.className = 'comp-foot';
    foot.append(this.total, this.clear);
    body.append(lead, row, this.note, foot, this.today);
    this.root.append(this.summary, body);
    // Opened on the title, the footer steps aside (it would print over the fold); the fold brings itself into view.
    this.root.addEventListener('toggle', () => {
      this.root.closest('#expedition-entry')?.classList.toggle('seed-open', this.root.open);
      if (this.root.open) this.root.scrollIntoView({ block: 'nearest' });
    });
    this.render();
  }

  /** The choice, in the canonical order. */
  get selected(): readonly MutatorId[] {
    return this.chosen;
  }

  /** The title or ledger is showing: start from the remembered choice, and say what today's descent carries. */
  refresh(): void {
    const view = this.ctx.run?.metaView();
    this.chosen = cleanMutators(view?.lastMutators ?? []);
    const today = cleanMutators(view?.todayMutators ?? []);
    this.today.textContent = today.length > 0
      ? `Today’s descent carries ${mutatorNames(today)}, set by the date. It ignores the choice above.`
      : '';
    this.today.hidden = today.length === 0;
    this.render();
  }

  /** Choose exactly this set (cleaned) and remember it. */
  set(ids: readonly string[]): void {
    this.chosen = cleanMutators(ids);
    this.ctx.run?.chooseMutators(this.chosen);
    this.render();
  }

  private toggle(id: MutatorId): void {
    if (this.chosen.includes(id)) {
      this.set(this.chosen.filter((c) => c !== id));
      return;
    }
    if (this.chosen.length >= MAX_MUTATORS) {
      // Refused, and said so: the chip shakes (the difficulty picker's refusal) and the note names the limit.
      const chip = this.chips.get(id);
      chip?.classList.remove('refused');
      void chip?.offsetWidth;
      chip?.classList.add('refused');
      this.note.textContent = `${MAX_MUTATORS} at a time. Put one back to take another.`;
      return;
    }
    // Two that cancel (Hush and Nosy Neighbours) never share a descent: the new one takes the old one's place, and the note says so.
    const displaced = this.chosen.find((c) => conflictsWith(c, id));
    if (displaced) {
      this.set([...this.chosen.filter((c) => c !== displaced), id]);
      this.note.textContent = `${MUTATOR_DEFS[id].name} takes the place of ${MUTATOR_DEFS[displaced].name}: the two cancel out.`;
      return;
    }
    this.set([...this.chosen, id]);
  }

  private describe(id: MutatorId | null): void {
    this.focused = id;
    this.renderNote();
  }

  private renderNote(): void {
    const id = this.focused;
    this.note.replaceChildren();
    if (id) {
      const def = MUTATOR_DEFS[id];
      const name = document.createElement('b');
      name.textContent = def.name;
      this.note.append(name, document.createTextNode(` — ${def.regulation}${def.ladder ? '' : ' (A win under it will not open a harder tier.)'}`));
    }
  }

  private render(): void {
    for (const [id, chip] of this.chips) {
      const on = this.chosen.includes(id);
      chip.setAttribute('aria-pressed', String(on));
      chip.classList.toggle('on', on);
      chip.classList.toggle('full', !on && this.chosen.length >= MAX_MUTATORS);
    }
    const names = mutatorNames(this.chosen);
    this.summary.textContent = this.chosen.length > 0 ? `Complications: ${names}` : 'Complications';
    this.summary.title = this.chosen.length > 0 ? `${names} — ${mutatorLoadText(this.chosen)}` : 'Standing regulations for one descent';
    this.root.classList.toggle('has-choice', this.chosen.length > 0);
    this.clear.hidden = this.chosen.length === 0;
    this.renderNote();
    if (this.chosen.length === 0) {
      this.total.textContent = 'None in force. The Works as issued.';
    } else {
      const counts = mutatorsCountForLadder(this.chosen);
      this.total.textContent = `${this.chosen.length} in force: ${mutatorLoadText(this.chosen)}. ${
        counts ? 'A win counts toward the next tier.' : 'A win under these will not open a harder tier.'
      }`;
      this.total.dataset.load = String(mutatorLoad(this.chosen));
    }
  }
}

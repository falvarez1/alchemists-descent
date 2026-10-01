import '@/styles/fighters.css';
import type { Ctx } from '@/core/types';
import {
  FIGHTER_DEFS,
  FIGHTER_ORDER,
  fighterPortraitUrl,
  fighterSheetUrl,
  isFighterId,
  type FighterDef,
  type FighterId,
} from '@/content/fighters';
import { createModalFocusTrap, type ModalFocusTrap } from '@/ui/modalFocusTrap';
import { icon, roleIconName } from '@/ui/fighterIcons';
import {
  ABILITY_KINDS,
  CLASSIC_COPY,
  CLASSIC_ENTRY,
  DEFAULT_KEY_LABELS,
  ROLE_FILTERS,
  ROSTER_NOTE,
  STAT_ORDER,
  STAT_MAX,
  abilityKeyLabel,
  chooseLabel,
  emptyMessage,
  isGridKey,
  padNumber,
  resultSummary,
  roleCounts,
  rosterEntries,
  shortName,
  statBar,
  stepGridIndex,
  stepRadioIndex,
  type AbilityKind,
  type KeyLabels,
  type RoleFilter,
  type RosterEntry,
} from '@/ui/fighterRosterModel';

/** The overlay's root id and the selectors a host adds to its "a menu owns the keyboard" lists. */
export const FIGHTER_ROSTER_ID = 'fighter-roster';
export const FIGHTER_ROSTER_SELECTOR = '#fighter-roster';
/** Present only while the roster is showing (the form KEYBOARD_UI_BLOCK_SELECTOR and the pad's overlay list use). */
export const FIGHTER_ROSTER_OPEN_SELECTOR = '#fighter-roster.visible';

export interface FighterRosterOptions {
  /** Called when the player confirms a choice; null = the classic Alchemist. */
  onChoose(id: FighterId | null): void;
  /** Called when the overlay closes without choosing (Escape / Back). */
  onCancel?(): void;
  /** The player's bindings for the Tactical and Ultimate keys (default Z and T). */
  keyLabels?: { tactical: string; ultimate: string };
  /** Fighters the player may choose (default: all ten). A locked card can be focused and read, never chosen. */
  unlocked?: ReadonlySet<FighterId>;
  /** How to earn a locked fighter. */
  unlockHint?(id: FighterId): string;
}

/**
 * Keys the roster lets through while it is up: focus movement, activation, the search's "/" and the
 * arrows. Anything else is kept from the game's hotkeys underneath (the same guard the run ledger has);
 * a typed letter still lands in the search box, because only its listeners are stopped, not its default.
 */
const NAV_CODES = new Set([
  'Tab', 'Enter', 'NumpadEnter', 'Space', 'Escape', 'Slash', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

const SHEET_ALT = 'concept sheet: portrait, lore, and idle, run, jump, attack, ability, hurt and death poses.';

let instances = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, label: string): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  if (label) b.textContent = label;
  return b;
}

/**
 * The Fighter Roster: who descends. A full overlay with the ten fighters (and, first, the classic
 * Alchemist) in a grid, a role filter and a search, and a dossier for the one in focus: portrait, lore,
 * the three-part kit with the keys it sits on, the four ratings, and a lazily loaded concept sheet.
 * Arrow keys walk the grid and the dossier follows the focus (the house's describe-on-focus, as in the
 * kit picker); Choose confirms. Weapons stay with the kit and with loot, so this is only the hands.
 *
 * Ids and the shell follow ui/RunSummary: built in JS, appended to #canvas-holder, role=dialog with
 * the modal focus trap, paused while open (and put back as found). Layout lives in styles/fighters.css
 * and keys off the overlay's OWN size (a container query), because the game view is a 16:9 letterbox
 * inside the window and a media query on the window misjudges it.
 */
export class FighterRoster {
  readonly root: HTMLElement;

  private readonly ctx: Ctx;
  private readonly options: FighterRosterOptions;
  private keyLabels: KeyLabels;
  private unlocked: ReadonlySet<FighterId> | null;
  private readonly trap: ModalFocusTrap;

  // layers
  private readonly main = el('div', 'fr-main');
  private readonly sheet = el('div', 'fr-sheet');
  // head
  private readonly backButton = button('menu-close fr-back', '');
  // browse
  private readonly filterButtons = new Map<RoleFilter, HTMLButtonElement>();
  private readonly filterCounts = new Map<RoleFilter, HTMLElement>();
  private readonly search = el('input', 'fr-search-input');
  private readonly searchWrap = el('div', 'fr-search');
  private readonly clearButton = button('fr-search-clear', '');
  private readonly resultCount = el('p', 'fr-result');
  private readonly grid = el('div', 'fr-grid');
  private readonly empty = el('div', 'fr-empty');
  private readonly emptyMessage = el('p', 'fr-empty-text');
  private readonly cards = new Map<RosterEntry, HTMLButtonElement>();
  private readonly cardImages = new Map<FighterId, HTMLImageElement>();
  // dossier
  private readonly dossier = el('aside', 'fr-dossier');
  private readonly dossierScroll = el('div', 'fr-dossier-scroll');
  private readonly dossierBody = el('div', 'fr-dossier-body');
  private readonly dossierNo = el('b', 'fr-dossier-no');
  private readonly stageImg = el('img', 'fr-stage-img');
  private readonly stageGlyph = icon('flask', 'fr-stage-glyph');
  private readonly stageRole = el('span', 'fr-stage-role');
  private readonly name = el('h3', 'fr-name');
  private readonly subtitle = el('p', 'fr-subtitle');
  private readonly symbol = el('span', 'fr-symbol');
  private readonly lockNote = el('p', 'fr-lock-note');
  private readonly lore = el('p', 'fr-lore');
  private readonly tags = el('ul', 'fr-tags');
  private readonly kit = el('section', 'fr-kit');
  private readonly abilityRows = new Map<AbilityKind, { row: HTMLElement; name: HTMLElement; desc: HTMLElement; key: HTMLElement }>();
  private readonly profile = el('section', 'fr-profile');
  private readonly playstyle = el('p', 'fr-playstyle');
  private readonly statRows = new Map<string, { value: HTMLElement; ticks: HTMLElement[]; row: HTMLElement }>();
  // foot
  private readonly sheetButton = button('fr-sheet-btn fr-stage-sheet', '');
  private readonly chooseButton = button('menu-btn primary fr-choose', '');
  private readonly chooseLabelNode = el('span', 'fr-choose-label');
  // sheet layer
  private readonly sheetTitle = el('h3', 'fr-sheet-title');
  private readonly sheetSub = el('p', 'fr-sheet-sub');
  private readonly sheetCount = el('span', 'fr-sheet-count');
  private readonly sheetView = el('div', 'fr-sheet-view');
  private readonly sheetImg = el('img', 'fr-sheet-img');
  private readonly sheetBack = button('menu-close fr-sheet-back', '');
  private readonly sheetZoom = button('fr-tool fr-sheet-zoom', '');
  private readonly sheetPrev = button('fr-tool fr-sheet-prev', '');
  private readonly sheetNext = button('fr-tool fr-sheet-next', '');
  private readonly live = el('div', 'fr-live');

  private role: RoleFilter = 'All';
  private query = '';
  private visible: RosterEntry[] = [];
  private inspected: RosterEntry = CLASSIC_ENTRY;
  /** What the caller had chosen when the roster opened (wears the check mark; "Keep" on the button). */
  private current: RosterEntry = CLASSIC_ENTRY;
  private sheetOpen = false;
  private sheetId: FighterId = FIGHTER_ORDER[0];
  private sheetFit: 'whole' | 'width' = 'whole';
  private artRequested = false;
  private still = false;
  private wasPaused = false;
  private announceTimer = 0;
  private refuseTimer = 0;
  private readonly disposers: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(ctx: Ctx, options: FighterRosterOptions) {
    this.ctx = ctx;
    this.options = options;
    this.keyLabels = { ...DEFAULT_KEY_LABELS, ...options.keyLabels };
    this.unlocked = options.unlocked ?? null;
    const uid = ++instances;
    const titleId = `fr-title-${uid}`;

    this.root = el('section', 'fighter-roster');
    this.root.id = FIGHTER_ROSTER_ID;
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', titleId);

    const frame = el('div', 'fr-frame');
    const shell = el('div', 'fr-shell');
    this.main.append(this.buildHead(titleId), this.buildBrowse(), this.buildDossier(), this.buildFoot());
    shell.append(this.main, this.buildSheet());
    frame.appendChild(shell);
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    this.root.append(frame, this.live);
    (document.getElementById('canvas-holder') ?? document.body).appendChild(this.root);

    this.trap = createModalFocusTrap(this.root, {
      initialFocus: () => this.initialFocus(),
      onEscape: () => this.onEscape(),
    });

    this.root.addEventListener('keydown', this.onKeyDown);
    this.disposers.push(() => this.root.removeEventListener('keydown', this.onKeyDown));

    // A fade at the foot of a scroller that has more below (the kit and ratings run past a short view).
    for (const scroller of [this.dossierScroll, this.sheetView, this.grid]) {
      scroller.addEventListener('scroll', this.updateMore, { passive: true });
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.updateMore);
      for (const node of [this.dossierScroll, this.dossierBody, this.sheetView, this.grid]) this.resizeObserver.observe(node);
      this.disposers.push(() => this.resizeObserver?.disconnect());
    }
    this.sheetImg.addEventListener('load', this.updateMore);

    this.visible = rosterEntries('All', '');
    this.renderDossier(this.inspected);
    this.syncCounts();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Show the roster with `selected` (null = the classic Alchemist) as both the current choice and the focus. */
  open(selected: FighterId | null): void {
    const entry: RosterEntry = selected !== null && isFighterId(selected) ? selected : CLASSIC_ENTRY;
    this.current = entry;
    if (!this.isOpen) {
      this.wasPaused = this.ctx.state.paused;
      this.ctx.state.paused = true;
      this.ctx.input.releaseHeldInput?.();
    }
    this.still = this.reducedMotion();
    this.root.classList.toggle('fr-still', this.still);
    this.requestArt();
    // Every opening starts wide: the current fighter must be on the grid to be found.
    this.role = 'All';
    this.query = '';
    this.search.value = '';
    this.setSheetState(false);
    this.inspected = entry;
    this.applyFilters(false);
    this.renderDossier(entry);
    this.syncActions();
    this.root.hidden = false;
    // Restart the entrance keyframes on every opening.
    this.root.classList.remove('visible');
    void this.root.offsetWidth;
    this.root.classList.add('visible');
    document.body.classList.add('fighter-roster-open');
    FighterRoster.showing.add(this);
    this.trap.activate();
    this.trap.focusInitial(this.cards.get(entry) ?? null);
    this.cards.get(entry)?.focus({ preventScroll: true });
    this.ctx.audio.sfx('ui.open');
  }

  /** Hide the roster without calling onCancel (the host decided). Focus returns to where it was. */
  close(): void {
    if (!this.isOpen) return;
    window.clearTimeout(this.announceTimer);
    window.clearTimeout(this.refuseTimer);
    FighterRoster.showing.delete(this);
    this.setSheetState(false);
    this.trap.deactivate();
    this.root.hidden = true;
    this.root.classList.remove('visible');
    document.body.classList.remove('fighter-roster-open');
    this.ctx.state.paused = this.wasPaused;
    // Arrows and Space pressed in here must not leave the player running or jumping when the game resumes.
    this.ctx.input.releaseHeldInput?.();
  }

  /** The host's unlocks or key bindings changed: redraw what shows them. */
  refresh(opts: Partial<Pick<FighterRosterOptions, 'unlocked' | 'keyLabels'>> = {}): void {
    if ('unlocked' in opts) this.unlocked = opts.unlocked ?? null;
    if (opts.keyLabels) this.keyLabels = { ...DEFAULT_KEY_LABELS, ...opts.keyLabels };
    this.still = this.reducedMotion();
    this.root.classList.toggle('fr-still', this.still);
    this.syncCards();
    this.renderDossier(this.inspected);
    this.syncActions();
    if (this.sheetOpen && this.isLocked(this.sheetId)) this.setSheetState(false);
  }

  dispose(): void {
    FighterRoster.showing.delete(this);
    if (this.isOpen) {
      this.trap.deactivate({ restoreFocus: false });
      this.ctx.state.paused = this.wasPaused;
      document.body.classList.remove('fighter-roster-open');
    }
    window.clearTimeout(this.announceTimer);
    window.clearTimeout(this.refuseTimer);
    for (const dispose of this.disposers.splice(0)) dispose();
    this.root.remove();
  }

  /* ---------------- build ---------------- */

  private buildHead(titleId: string): HTMLElement {
    const head = el('div', 'fr-head');
    const copy = el('div', 'fr-head-copy');
    const kicker = el('p', 'menu-label fr-kicker', 'Field guide · The ten');
    const title = el('h2', 'fr-title', 'Choose your experiment.');
    title.id = titleId;
    const intro = el('p', 'fr-intro', 'Ten fighters. One descent. Choose who goes down into the Works.');
    copy.append(kicker, title, intro);

    const meta = el('div', 'fr-head-meta');
    meta.setAttribute('aria-hidden', 'true');
    const roles = ROLE_FILTERS.length - 1;
    for (const [value, label] of [[padNumber(FIGHTER_ORDER.length), 'Fighters'], [padNumber(roles), 'Combat roles']] as const) {
      const item = el('div', 'fr-head-stat');
      item.append(el('strong', '', value), el('span', '', label));
      meta.appendChild(item);
    }

    this.backButton.dataset.sfx = 'back';
    this.backButton.setAttribute('aria-label', 'Back, without choosing');
    this.backButton.append(icon('left'), el('span', 'fr-back-label', 'Back'), el('kbd', 'key', 'Esc'));
    this.backButton.addEventListener('click', () => this.cancel());
    head.append(copy, meta, this.backButton);
    return head;
  }

  private buildBrowse(): HTMLElement {
    const browse = el('div', 'fr-browse');
    const tools = el('div', 'fr-tools');

    const filters = el('div', 'fr-filters');
    filters.setAttribute('role', 'radiogroup');
    filters.setAttribute('aria-label', 'Filter fighters by combat role');
    for (const role of ROLE_FILTERS) {
      const b = button('fr-filter', '');
      b.setAttribute('role', 'radio');
      b.dataset.role = role;
      const count = el('span', 'fr-filter-count');
      count.setAttribute('aria-hidden', 'true');
      b.append(icon(roleIconName(role)), el('span', 'fr-filter-label', role), count);
      b.addEventListener('click', () => this.setRole(role));
      this.filterButtons.set(role, b);
      this.filterCounts.set(role, count);
      filters.appendChild(b);
    }

    this.search.type = 'text';
    this.search.placeholder = 'Search fighters…';
    this.search.autocomplete = 'off';
    this.search.spellcheck = false;
    this.search.enterKeyHint = 'search';
    this.search.setAttribute('aria-label', 'Search fighters by name, role, title or ability');
    this.search.addEventListener('input', () => this.setQuery(this.search.value));
    this.clearButton.setAttribute('aria-label', 'Clear search');
    this.clearButton.append(icon('close'));
    this.clearButton.addEventListener('click', () => {
      this.search.value = '';
      this.setQuery('');
      this.search.focus({ preventScroll: true });
    });
    this.searchWrap.append(icon('search', 'fr-search-icon'), this.search, el('kbd', 'fr-search-key', '/'), this.clearButton);
    tools.append(filters, this.searchWrap);

    this.resultCount.setAttribute('aria-hidden', 'true');
    this.grid.setAttribute('role', 'radiogroup');
    this.grid.setAttribute('aria-label', 'Choose who descends');
    this.grid.appendChild(this.buildCard(CLASSIC_ENTRY));
    for (const id of FIGHTER_ORDER) this.grid.appendChild(this.buildCard(id));

    const reset = button('menu-btn fr-empty-reset', 'Clear search and filter');
    reset.addEventListener('click', () => this.resetFilters());
    this.empty.hidden = true;
    this.empty.append(icon('search', 'fr-empty-icon'), el('h3', 'fr-empty-title', 'No fighters found.'), this.emptyMessage, reset);

    browse.append(tools, this.resultCount, this.grid, this.empty);
    return browse;
  }

  private buildCard(entry: RosterEntry): HTMLButtonElement {
    const card = button('fr-card', '');
    card.setAttribute('role', 'radio');
    card.dataset.entry = entry;
    const top = el('span', 'fr-card-top');
    const art = el('span', 'fr-card-art');
    const copy = el('span', 'fr-card-copy');
    if (entry === CLASSIC_ENTRY) {
      card.style.setProperty('--fr-card', CLASSIC_COPY.accent);
      const role = el('span', 'fr-card-role');
      role.append(icon('flask'), el('span', 'fr-card-role-text', 'Classic'));
      top.append(role, el('span', 'fr-card-no', '—'));
      art.appendChild(icon('flask', 'fr-card-glyph'));
      copy.append(el('span', 'fr-card-name', CLASSIC_COPY.name), el('span', 'fr-card-title', CLASSIC_COPY.tag));
    } else {
      const def = FIGHTER_DEFS[entry];
      card.style.setProperty('--fr-card', def.accent);
      const role = el('span', 'fr-card-role');
      role.append(icon(roleIconName(def.role)), el('span', 'fr-card-role-text', def.role));
      top.append(role, el('span', 'fr-card-no', padNumber(def.number)));
      const img = el('img');
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.width = 331;
      img.height = 331;
      img.dataset.src = fighterPortraitUrl(entry);
      img.addEventListener('load', () => card.classList.add('is-loaded'));
      this.cardImages.set(entry, img);
      art.appendChild(img);
      copy.append(el('span', 'fr-card-name', def.name), el('span', 'fr-card-title', def.title));
    }
    const mark = el('span', 'fr-card-mark');
    mark.setAttribute('aria-hidden', 'true');
    mark.appendChild(icon('check'));
    const lock = el('span', 'fr-card-lock');
    lock.setAttribute('aria-hidden', 'true');
    lock.appendChild(icon('lock'));
    copy.appendChild(el('span', 'fr-card-short', shortName(entry)));
    art.append(mark, lock);
    card.append(top, art, copy);

    card.addEventListener('focus', () => {
      this.inspect(entry);
      this.revealCard(card);
    });
    card.addEventListener('click', (event) => {
      this.inspect(entry);
      // A keyboard or pad press (no pointer: detail 0) carries on to the button that confirms.
      if (event.detail === 0 && this.visible.includes(entry)) this.chooseButton.focus({ preventScroll: true });
    });
    card.addEventListener('dblclick', () => {
      this.inspect(entry);
      this.choose();
    });
    this.cards.set(entry, card);
    return card;
  }

  private buildDossier(): HTMLElement {
    const top = el('div', 'fr-dossier-top');
    const label = el('span', 'fr-dossier-label');
    label.append(icon('record'), document.createTextNode('Fighter dossier'));
    const place = el('span', 'fr-dossier-place');
    place.append(this.dossierNo, document.createTextNode(` / ${padNumber(FIGHTER_ORDER.length)}`));
    top.append(label, place);

    const stage = el('div', 'fr-stage');
    this.stageImg.draggable = false;
    this.stageImg.decoding = 'async';
    this.stageImg.alt = '';
    const crossA = el('span', 'fr-stage-cross', '+');
    const crossB = el('span', 'fr-stage-cross', '+');
    crossA.setAttribute('aria-hidden', 'true');
    crossB.setAttribute('aria-hidden', 'true');
    this.sheetButton.append(icon('sheet'), el('span', 'fr-sheet-btn-label', 'Concept sheet'));
    this.sheetButton.addEventListener('click', () => this.openSheet());
    stage.append(this.stageRole, this.sheetButton, this.stageImg, this.stageGlyph, crossA, crossB);

    const body = this.dossierBody;
    const heading = el('div', 'fr-heading');
    const headingCopy = el('div', 'fr-heading-copy');
    headingCopy.append(this.name, this.subtitle);
    this.symbol.setAttribute('aria-hidden', 'true');
    heading.append(headingCopy, this.symbol);
    this.lockNote.hidden = true;

    const kitLabel = el('p', 'fr-section-label');
    kitLabel.append(el('span', '', 'Signature kit'), el('i', 'fr-rule'));
    const kitList = el('div', 'fr-abilities');
    const kindLabel: Record<AbilityKind, string> = { passive: 'Passive', tactical: 'Tactical', ultimate: 'Ultimate' };
    for (const kind of ABILITY_KINDS) {
      const row = el('article', `fr-ability fr-ability-${kind}`);
      const badge = el('span', 'fr-badge');
      badge.appendChild(icon(kind));
      const type = el('p', 'fr-ability-type');
      const key = el('kbd', 'key fr-ability-key');
      type.append(el('span', '', kindLabel[kind]), key);
      const name = el('h4', 'fr-ability-name');
      const desc = el('p', 'fr-ability-desc');
      const text = el('div', 'fr-ability-text');
      text.append(type, name, desc);
      row.append(badge, text);
      kitList.appendChild(row);
      this.abilityRows.set(kind, { row, name, desc, key });
    }
    this.kit.append(kitLabel, kitList);

    const profileLabel = el('p', 'fr-section-label');
    profileLabel.append(el('span', '', 'In play'), el('i', 'fr-rule'));
    const stats = el('div', 'fr-stats');
    for (const stat of STAT_ORDER) {
      const row = el('div', 'fr-stat');
      const head = el('div', 'fr-stat-head');
      const value = el('b', 'fr-stat-value');
      head.append(el('span', '', stat), value);
      const ticks = el('div', 'fr-ticks');
      ticks.setAttribute('aria-hidden', 'true');
      const tickNodes: HTMLElement[] = [];
      for (let i = 0; i < STAT_MAX; i++) {
        const tick = el('i', 'fr-tick');
        tick.style.setProperty('--k', String(i));
        tickNodes.push(tick);
        ticks.appendChild(tick);
      }
      row.append(head, ticks);
      stats.appendChild(row);
      this.statRows.set(stat, { value, ticks: tickNodes, row });
    }
    const ratings = el('p', 'fr-ratings-note', 'Relative design ratings, not balance values.');
    this.profile.append(profileLabel, this.playstyle, stats, ratings);

    body.append(heading, this.lockNote, this.lore, this.tags, this.kit, this.profile);
    this.dossierScroll.setAttribute('tabindex', '0');
    this.dossierScroll.setAttribute('role', 'region');
    this.dossierScroll.setAttribute('aria-label', 'Fighter details');
    this.dossierScroll.append(stage, body);
    this.dossier.append(top, this.dossierScroll);
    return this.dossier;
  }

  private buildFoot(): HTMLElement {
    const foot = el('div', 'fr-foot');
    const info = el('div', 'fr-foot-info');
    const note = el('p', 'fr-note');
    note.append(el('b', '', ROSTER_NOTE.headline), document.createTextNode(` ${ROSTER_NOTE.edge}`));
    const keys = el('p', 'fr-keys');
    for (const [cap, text] of [['← → ↑ ↓', 'Browse'], ['/', 'Search'], ['Esc', 'Back']] as const) {
      const item = el('span', 'fr-key-hint');
      item.append(el('kbd', 'key', cap), document.createTextNode(` ${text}`));
      keys.appendChild(item);
    }
    info.append(note, keys);

    const act = el('div', 'fr-foot-act');
    const actions = el('div', 'fr-actions');
    this.chooseButton.dataset.sfx = 'none';
    this.chooseButton.append(this.chooseLabelNode, icon('right'));
    this.chooseButton.addEventListener('click', () => this.choose());
    actions.append(this.chooseButton);
    act.append(actions, el('p', 'fr-weapons', ROSTER_NOTE.weapons));
    foot.append(info, act);
    return foot;
  }

  private buildSheet(): HTMLElement {
    this.sheet.hidden = true;
    this.sheet.setAttribute('role', 'region');
    this.sheet.setAttribute('aria-label', 'Concept sheet');
    const head = el('div', 'fr-sheet-head');
    this.sheetBack.dataset.sfx = 'back';
    this.sheetBack.append(icon('left'), el('span', 'fr-back-label', 'Roster'), el('kbd', 'key', 'Esc'));
    this.sheetBack.addEventListener('click', () => this.closeSheet());
    const titles = el('div', 'fr-sheet-titles');
    titles.append(el('p', 'menu-label fr-kicker', 'Concept sheet'), this.sheetTitle, this.sheetSub);

    const tools = el('div', 'fr-sheet-tools');
    this.sheetZoom.addEventListener('click', () => this.setSheetFit(this.sheetFit === 'whole' ? 'width' : 'whole'));
    this.sheetPrev.append(icon('left'));
    this.sheetPrev.setAttribute('aria-label', 'Previous fighter’s sheet');
    this.sheetPrev.addEventListener('click', () => this.stepSheet(-1));
    this.sheetNext.append(icon('right'));
    this.sheetNext.setAttribute('aria-label', 'Next fighter’s sheet');
    this.sheetNext.addEventListener('click', () => this.stepSheet(1));
    const nav = el('div', 'fr-sheet-nav');
    nav.append(this.sheetPrev, this.sheetCount, this.sheetNext);
    tools.append(this.sheetZoom, nav);
    head.append(this.sheetBack, titles, tools);

    this.sheetImg.draggable = false;
    this.sheetImg.decoding = 'async';
    this.sheetImg.addEventListener('load', () => {
      this.sheetView.classList.remove('is-loading', 'is-error');
    });
    this.sheetImg.addEventListener('error', () => {
      this.sheetView.classList.remove('is-loading');
      this.sheetView.classList.add('is-error');
    });
    const loading = el('p', 'fr-sheet-status', 'Unrolling the sheet…');
    loading.setAttribute('aria-hidden', 'true');
    const failed = el('p', 'fr-sheet-failed', 'The sheet would not unroll. Check the connection and open it again.');
    this.sheetView.setAttribute('tabindex', '0');
    this.sheetView.setAttribute('aria-label', 'Concept sheet image');
    this.sheetView.append(this.sheetImg, loading, failed);

    const foot = el('p', 'fr-sheet-foot', 'Concept artwork: reference for the look, not the in-game sprite.');
    this.sheet.append(head, this.sheetView, foot);
    return this.sheet;
  }

  /* ---------------- state ---------------- */

  private isLocked(entry: RosterEntry): boolean {
    return entry !== CLASSIC_ENTRY && this.unlocked !== null && !this.unlocked.has(entry);
  }

  private hintFor(id: FighterId): string {
    return this.options.unlockHint?.(id) ?? 'Not yet earned.';
  }

  private reducedMotion(): boolean {
    return this.ctx.state.reduceFlashes === true || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }

  /** The portraits load the first time the roster opens, not when it is built (the title builds it at boot). */
  private requestArt(): void {
    if (this.artRequested) return;
    this.artRequested = true;
    for (const img of this.cardImages.values()) {
      const src = img.dataset.src;
      if (src) img.src = src;
    }
  }

  private visibleCards(): HTMLButtonElement[] {
    const cards: HTMLButtonElement[] = [];
    for (const entry of this.visible) {
      const card = this.cards.get(entry);
      if (card) cards.push(card);
    }
    return cards;
  }

  /** The card that holds the roving tab stop: the inspected one, or the first shown. */
  private rovingEntry(): RosterEntry | null {
    if (this.visible.includes(this.inspected)) return this.inspected;
    return this.visible[0] ?? null;
  }

  private initialFocus(): HTMLElement | null {
    if (this.sheetOpen) return this.sheetBack;
    const entry = this.rovingEntry();
    return (entry !== null ? this.cards.get(entry) : null) ?? this.backButton;
  }

  private setRole(role: RoleFilter): void {
    if (role === this.role) return;
    this.role = role;
    this.applyFilters(true);
  }

  private setQuery(query: string): void {
    if (query === this.query) return;
    this.query = query;
    this.applyFilters(true);
  }

  private resetFilters(): void {
    this.role = 'All';
    this.query = '';
    this.search.value = '';
    this.applyFilters(true);
    this.rovingFocus();
  }

  private rovingFocus(): void {
    const entry = this.rovingEntry();
    const card = entry !== null ? this.cards.get(entry) : undefined;
    (card ?? this.search).focus({ preventScroll: true });
  }

  /** Re-derive the grid from the role and the search; keep the dossier on something that is shown. */
  private applyFilters(announce: boolean): void {
    const entries = rosterEntries(this.role, this.query);
    const shown = new Set<RosterEntry>(entries);
    let i = 0;
    for (const [entry, card] of this.cards) {
      const show = shown.has(entry);
      card.hidden = !show;
      if (show) card.style.setProperty('--i', String(i++));
    }
    this.visible = entries;
    const fighters = entries.filter((entry) => entry !== CLASSIC_ENTRY).length;
    this.resultCount.textContent = `Showing ${fighters} of ${FIGHTER_ORDER.length}`;
    this.empty.hidden = entries.length > 0;
    this.grid.hidden = entries.length === 0;
    this.emptyMessage.textContent = emptyMessage(this.role, this.query);
    this.searchWrap.classList.toggle('has-query', this.query !== '');
    this.syncCounts();
    if (entries.length > 0 && !shown.has(this.inspected)) {
      const first = entries[0];
      if (first !== undefined) this.inspect(first, false);
    }
    this.syncCards();
    this.grid.scrollTo({ left: 0, top: 0 });
    if (announce) this.announce(resultSummary(fighters, FIGHTER_ORDER.length, this.role, this.query));
  }

  /** The filter buttons: the pressed one, its roving tab stop, and a count that follows the search. */
  private syncCounts(): void {
    const counts = roleCounts(this.query);
    for (const role of ROLE_FILTERS) {
      const b = this.filterButtons.get(role);
      const countNode = this.filterCounts.get(role);
      if (!b || !countNode) continue;
      const on = role === this.role;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('is-empty', counts[role] === 0);
      countNode.textContent = String(counts[role]);
      b.setAttribute('aria-label', `${role === 'All' ? 'All fighters' : `${role} fighters`}, ${counts[role]}`);
    }
  }

  /** Checked, current, locked and the tab stop on every card. */
  private syncCards(): void {
    const roving = this.rovingEntry();
    for (const [entry, card] of this.cards) {
      const on = entry === this.inspected;
      const locked = this.isLocked(entry);
      const current = entry === this.current;
      card.setAttribute('aria-checked', String(on));
      card.setAttribute('aria-disabled', String(locked));
      card.tabIndex = entry === roving ? 0 : -1;
      card.classList.toggle('is-current', current);
      card.classList.toggle('is-locked', locked);
      if (entry === CLASSIC_ENTRY) {
        card.setAttribute('aria-label', `${CLASSIC_COPY.name}, no fighter${current ? ', your current choice' : ''}`);
        card.title = CLASSIC_COPY.name;
      } else {
        const def = FIGHTER_DEFS[entry];
        const hint = locked ? `. Locked. ${this.hintFor(entry)}` : '';
        card.setAttribute('aria-label', `${def.name}, ${def.title}, ${def.role}${current ? ', your current choice' : ''}${hint}`);
        card.title = locked ? `${def.name}: locked. ${this.hintFor(entry)}` : `${def.name}, ${def.title}`;
      }
    }
  }

  /** Put `entry` in the dossier. Focus does this on its own; clicks and refresh call it too. */
  private inspect(entry: RosterEntry, announce = true): void {
    if (entry === this.inspected) {
      this.syncCards();
      return;
    }
    this.inspected = entry;
    this.syncCards();
    this.renderDossier(entry);
    this.syncActions();
    if (announce) this.announce(this.describe(entry));
  }

  private describe(entry: RosterEntry): string {
    if (entry === CLASSIC_ENTRY) return `${CLASSIC_COPY.name}. ${CLASSIC_COPY.blurb}`;
    const def = FIGHTER_DEFS[entry];
    const locked = this.isLocked(entry) ? ` Locked. ${this.hintFor(entry)}` : '';
    return `${def.name}, ${def.role}. ${def.title}.${locked}`;
  }

  private announce(text: string): void {
    window.clearTimeout(this.announceTimer);
    this.live.textContent = '';
    this.announceTimer = window.setTimeout(() => {
      this.live.textContent = text;
    }, 70);
  }

  /** The Choose and Concept sheet buttons say what pressing them will do now. */
  private syncActions(): void {
    const entry = this.inspected;
    const locked = this.isLocked(entry);
    this.chooseLabelNode.textContent = chooseLabel(entry, { current: this.current, locked });
    this.chooseButton.setAttribute('aria-disabled', String(locked));
    this.chooseButton.classList.toggle('is-locked', locked);
    this.chooseButton.title = locked && entry !== CLASSIC_ENTRY ? this.hintFor(entry) : '';
    const classic = entry === CLASSIC_ENTRY;
    this.sheetButton.hidden = classic;
    this.sheetButton.setAttribute('aria-disabled', String(locked));
    this.sheetButton.classList.toggle('is-locked', locked);
    if (!classic) this.sheetButton.setAttribute('aria-label', `View ${FIGHTER_DEFS[entry].name}’s concept sheet`);
  }

  /** Fill the dossier in place (nodes are reused, so the ticks and the accent can transition). */
  private renderDossier(entry: RosterEntry): void {
    const classic = entry === CLASSIC_ENTRY;
    this.dossier.dataset.entry = entry;
    this.dossier.classList.toggle('is-classic', classic);
    const locked = this.isLocked(entry);
    this.dossier.classList.toggle('is-locked', locked);
    this.lockNote.hidden = !locked;
    this.dossierScroll.scrollTop = 0;
    this.dossierScroll.classList.remove('is-swapping');
    void this.dossierScroll.offsetWidth;
    this.dossierScroll.classList.add('is-swapping');
    window.requestAnimationFrame(this.updateMore);

    if (classic) {
      this.dossier.style.setProperty('--fr-accent', CLASSIC_COPY.accent);
      this.dossierNo.textContent = '—';
      this.stageImg.hidden = true;
      this.stageGlyph.style.display = '';
      this.stageRole.replaceChildren(icon('flask'), document.createTextNode('Classic'));
      this.name.textContent = CLASSIC_COPY.name;
      this.subtitle.textContent = CLASSIC_COPY.tag;
      this.symbol.replaceChildren(icon('flask'));
      this.lore.textContent = CLASSIC_COPY.blurb;
      this.tags.replaceChildren();
      this.tags.hidden = true;
      const none: Record<AbilityKind, string> = { passive: 'No passive.', tactical: 'No tactical ability.', ultimate: 'No ultimate.' };
      for (const kind of ABILITY_KINDS) {
        const rowParts = this.abilityRows.get(kind);
        if (!rowParts) continue;
        rowParts.name.textContent = 'None';
        rowParts.desc.textContent = none[kind];
        rowParts.key.hidden = true;
        rowParts.row.classList.add('is-empty');
      }
      this.profile.hidden = true;
      return;
    }

    const def: FighterDef = FIGHTER_DEFS[entry];
    this.dossier.style.setProperty('--fr-accent', def.accent);
    this.dossierNo.textContent = padNumber(def.number);
    this.stageGlyph.style.display = 'none';
    this.stageImg.hidden = false;
    this.stageImg.src = fighterPortraitUrl(def.id);
    this.stageImg.alt = `${def.name}, ${def.title}: pixel-art portrait`;
    this.stageRole.replaceChildren(icon(roleIconName(def.role)), document.createTextNode(def.role));
    this.name.textContent = def.name;
    this.subtitle.textContent = def.title;
    this.symbol.replaceChildren(icon(roleIconName(def.role)));
    this.lockNote.textContent = locked ? `Locked. ${this.hintFor(def.id)}` : '';
    this.lore.textContent = def.lore;
    this.tags.hidden = false;
    this.tags.replaceChildren(...def.tags.map((tag) => el('li', 'fr-tag', tag)));
    for (const kind of ABILITY_KINDS) {
      const rowParts = this.abilityRows.get(kind);
      if (!rowParts) continue;
      const ability = def[kind];
      const key = abilityKeyLabel(kind, this.keyLabels);
      rowParts.name.textContent = ability.name;
      rowParts.desc.textContent = ability.description;
      rowParts.key.hidden = key === null;
      rowParts.key.textContent = key ?? '';
      rowParts.row.classList.remove('is-empty');
    }
    this.profile.hidden = false;
    this.playstyle.textContent = def.playstyle;
    for (const stat of STAT_ORDER) {
      const rowParts = this.statRows.get(stat);
      if (!rowParts) continue;
      const bar = statBar(stat, def.stats[stat]);
      rowParts.value.textContent = String(bar.value);
      rowParts.row.setAttribute('aria-label', bar.label);
      rowParts.ticks.forEach((tick, i) => tick.classList.toggle('is-on', i < bar.filled));
    }
  }

  /* ---------------- actions ---------------- */

  private choose(): void {
    const entry = this.inspected;
    if (this.isLocked(entry)) {
      this.refuse(entry);
      return;
    }
    this.current = entry;
    this.ctx.audio.sfx('ui.card.choose');
    this.close();
    this.options.onChoose(entry === CLASSIC_ENTRY ? null : entry);
  }

  /** A locked fighter shakes its button and says why (the kit picker's refusal). */
  private refuse(entry: RosterEntry): void {
    if (entry !== CLASSIC_ENTRY) this.announce(`${FIGHTER_DEFS[entry].name} is locked. ${this.hintFor(entry)}`);
    this.lockNote.hidden = false;
    for (const node of [this.chooseButton, this.cards.get(entry)]) {
      if (!node) continue;
      node.classList.remove('is-refused');
      void node.offsetWidth;
      node.classList.add('is-refused');
    }
    window.clearTimeout(this.refuseTimer);
    this.refuseTimer = window.setTimeout(() => {
      this.chooseButton.classList.remove('is-refused');
      this.cards.get(entry)?.classList.remove('is-refused');
    }, 400);
  }

  private cancel(): void {
    this.close();
    this.options.onCancel?.();
  }

  private onEscape(): void {
    if (this.sheetOpen) {
      this.closeSheet();
      return;
    }
    if (document.activeElement === this.search && this.search.value !== '') {
      this.search.value = '';
      this.setQuery('');
      return;
    }
    this.ctx.audio.sfx('ui.close');
    this.cancel();
  }

  /* ---------------- the concept sheet ---------------- */

  private sheetOrder(): FighterId[] {
    return FIGHTER_ORDER.filter((id) => !this.isLocked(id));
  }

  private openSheet(): void {
    const entry = this.inspected;
    if (entry === CLASSIC_ENTRY) return;
    if (this.isLocked(entry)) {
      this.refuse(entry);
      return;
    }
    this.sheetFit = this.root.clientHeight < 640 ? 'width' : 'whole';
    this.applySheetFit();
    this.showSheet(entry);
    this.setSheetState(true);
    this.sheetBack.focus({ preventScroll: true });
  }

  private closeSheet(): void {
    if (!this.sheetOpen) return;
    this.setSheetState(false);
    this.sheetButton.focus({ preventScroll: true });
  }

  /** The sheet replaces the browse view (hidden, so the focus trap cannot Tab into what is covered). */
  private setSheetState(open: boolean): void {
    this.sheetOpen = open;
    this.main.hidden = open;
    this.sheet.hidden = !open;
    this.root.classList.toggle('is-sheet', open);
    if (open) {
      this.sheet.classList.remove('is-entering');
      void this.sheet.offsetWidth;
      this.sheet.classList.add('is-entering');
    }
  }

  /** Assign the sheet's src now: it is ~150 KB and nothing fetches it until the player asks. */
  private showSheet(id: FighterId): void {
    const def = FIGHTER_DEFS[id];
    this.sheetId = id;
    this.sheetTitle.textContent = def.name;
    this.sheetSub.textContent = def.title;
    this.sheetCount.textContent = `${padNumber(def.number)} / ${padNumber(FIGHTER_ORDER.length)}`;
    this.sheetImg.alt = `${def.name}, ${def.title}: ${SHEET_ALT}`;
    this.sheetView.classList.remove('is-error');
    this.sheetView.classList.add('is-loading');
    const url = fighterSheetUrl(id);
    this.sheetImg.dataset.src = url;
    this.sheetImg.src = url;
    this.sheetView.scrollTo({ left: 0, top: 0 });
  }

  private stepSheet(dir: 1 | -1): void {
    const order = this.sheetOrder();
    if (order.length < 2) return;
    const at = Math.max(0, order.indexOf(this.sheetId));
    const next = order[(at + dir + order.length) % order.length];
    if (next === undefined) return;
    this.showSheet(next);
    // The dossier behind the sheet follows, so Back lands on the fighter just read.
    this.inspected = next;
    this.syncCards();
    this.renderDossier(next);
    this.syncActions();
  }

  private setSheetFit(fit: 'whole' | 'width'): void {
    this.sheetFit = fit;
    this.applySheetFit();
    this.sheetView.scrollTo({ left: 0, top: 0 });
  }

  private applySheetFit(): void {
    const whole = this.sheetFit === 'whole';
    this.sheetView.classList.toggle('is-whole', whole);
    this.sheetView.classList.toggle('is-width', !whole);
    this.sheetZoom.replaceChildren(icon('zoom'), el('span', 'fr-tool-label', whole ? 'Fill width' : 'Whole sheet'));
    this.sheetZoom.setAttribute('aria-pressed', String(!whole));
    this.sheetZoom.title = whole ? 'Fill the width and scroll, to read the small print' : 'Fit the whole sheet in view';
    window.requestAnimationFrame(this.updateMore);
  }

  private readonly updateMore = (): void => {
    for (const scroller of [this.dossierScroll, this.sheetView, this.grid]) {
      scroller.classList.toggle('is-more', scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 4);
      scroller.classList.toggle('is-less', scroller.scrollTop > 4);
    }
  };

  /* ---------------- keys ---------------- */

  private columns(cards: readonly HTMLElement[]): number {
    const first = cards[0];
    if (!first) return 1;
    let n = 0;
    for (const card of cards) {
      if (Math.abs(card.offsetTop - first.offsetTop) > 3) break;
      n++;
    }
    return Math.max(1, n);
  }

  /** Scroll the grid (a strip, or a short window) so the focused card is whole. */
  private revealCard(card: HTMLElement): void {
    const sc = this.grid;
    if (sc.scrollHeight <= sc.clientHeight + 1 && sc.scrollWidth <= sc.clientWidth + 1) return;
    const a = card.getBoundingClientRect();
    const b = sc.getBoundingClientRect();
    const pad = 8;
    let dx = 0;
    let dy = 0;
    if (a.left < b.left + pad) dx = a.left - b.left - pad;
    else if (a.right > b.right - pad) dx = a.right - b.right + pad;
    if (a.top < b.top + pad) dy = a.top - b.top - pad;
    else if (a.bottom > b.bottom - pad) dy = a.bottom - b.bottom + pad;
    if (dx !== 0 || dy !== 0) sc.scrollBy({ left: dx, top: dy, behavior: this.still ? 'auto' : 'smooth' });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // (No defaultPrevented guard: the game's own key handler runs first, in the capture phase, and
    // claims the arrows and Space for the player until the host lists this overlay as a keyboard owner.)
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (this.sheetOpen) {
      this.onSheetKey(event);
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    const typing = target === this.search;
    if (event.key === '/' && !typing) {
      event.preventDefault();
      this.search.focus({ preventScroll: true });
      this.search.select();
      return;
    }
    if (typing) {
      if ((event.key === 'ArrowDown' || event.key === 'Enter') && this.visible.length > 0) {
        event.preventDefault();
        this.rovingFocus();
      }
      return;
    }
    const card = target.closest<HTMLButtonElement>('.fr-card');
    if (card && isGridKey(event.key)) {
      const cards = this.visibleCards();
      const next = stepGridIndex(cards.indexOf(card), event.key, cards.length, this.columns(cards));
      event.preventDefault();
      cards[next]?.focus({ preventScroll: true });
      return;
    }
    const filter = target.closest<HTMLButtonElement>('.fr-filter');
    if (filter && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      const at = ROLE_FILTERS.indexOf(filter.dataset.role as RoleFilter);
      const next = ROLE_FILTERS[stepRadioIndex(at, event.key, ROLE_FILTERS.length)];
      if (next === undefined) return;
      event.preventDefault();
      this.setRole(next);
      this.filterButtons.get(next)?.focus({ preventScroll: true });
    }
  };

  private onSheetKey(event: KeyboardEvent): void {
    const view = this.sheetView;
    const page = view.clientHeight * 0.9;
    switch (event.key) {
      case 'ArrowLeft': this.stepSheet(-1); break;
      case 'ArrowRight': this.stepSheet(1); break;
      case 'ArrowUp': view.scrollBy({ top: -80 }); break;
      case 'ArrowDown': view.scrollBy({ top: 80 }); break;
      case 'PageUp': view.scrollBy({ top: -page }); break;
      case 'PageDown': view.scrollBy({ top: page }); break;
      case 'Home': view.scrollTo({ top: 0 }); break;
      case 'End': view.scrollTo({ top: view.scrollHeight }); break;
      default: return;
    }
    event.preventDefault();
  }

  /**
   * While a roster is up it owns the keyboard: the game's hotkeys must not open anything underneath it, and
   * a pad's B (or a pause button) means Back here, not the pause menu. These guards sit on the window in the
   * CAPTURE phase and are installed when this module loads (at boot, when the host imports it), so they run
   * before the game's own capture-phase listeners, which are added later, whatever order the systems are built in.
   * Navigation keys (focus, activation, arrows, Esc) still reach the roster; a typed letter still lands in the
   * search box, because only listeners are stopped, not the key's default action.
   */
  private static readonly showing = new Set<FighterRoster>();

  static {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (event: KeyboardEvent) => {
        if (FighterRoster.showing.size === 0 || NAV_CODES.has(event.code)) return;
        event.stopImmediatePropagation();
      }, true);
      window.addEventListener('game-pause-request', (event: Event) => {
        if (FighterRoster.showing.size === 0) return;
        event.stopImmediatePropagation();
        for (const roster of [...FighterRoster.showing]) roster.onEscape();
      }, true);
    }
  }
}

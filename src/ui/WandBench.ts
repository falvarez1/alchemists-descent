import { FLASK_SLOT_COUNT, type CardId, type Ctx, type FlaskState, type WandFrame } from '@/core/types';
import { ALL_CARD_IDS, CARD_DEFS } from '@/combat/wands/cards';
import { REVIEW_WAND_LOADOUTS, WAND_FRAMES, type BuiltInWandLoadout } from '@/combat/wands/wandCatalog';
import { buildWandSentenceView, type WandSentenceView, type WandSlotLinkKind } from '@/combat/wands/sentenceView';
import { POTION_DEFS, POTION_KINDS } from '@/core/pickupDefs';
import { flaskMaterialOptions } from '@/content/flaskMaterials';
import { PERK_DEFS, isPerkActive, togglePerkActive } from '@/content/perks';
import { cardIconName, ELEMENT_ICON, makeIconCanvas } from '@/ui/icons';

/** Non-null getElementById — the bench root exists statically in index.html. */
function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/** Tooltip text shared by every card tile: name, cost, then the blurb. */
function cardTitle(id: CardId): string {
  const def = CARD_DEFS[id];
  return def.name + ' — ' + def.manaCost + ' mana — ' + def.blurb;
}

const BENCH_STATUS_CAP = 3600;

export type BenchCardFilter = 'all' | 'projectile' | 'modifier' | 'multicast' | 'setup' | 'terrain';

const BENCH_CARD_FILTERS: Array<{ id: BenchCardFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'projectile', label: 'Projectiles' },
  { id: 'modifier', label: 'Modifiers' },
  { id: 'multicast', label: 'Multicast' },
  { id: 'setup', label: 'Setup' },
  { id: 'terrain', label: 'Terrain' },
];

const CARD_RECIPE_HINTS: Partial<Record<CardId, string[]>> = {
  watertrail: ['Pairs with Critical on Wet and Electric Charge.'],
  critwet: ['Pairs with Water Trail or any wet target.'],
  electriccharge: ['Pairs with Water Trail and conductor cells.'],
  oiltrail: ['Pairs with Flame as a visible fuse.'],
  cryojet: ['Freezes water into bridgeable ice strips.'],
  aquajet: ['Douses fire and leaves targets wet for Critical on Wet / Electric Charge.'],
  frostcharge: ['Pairs with Shatter Frozen as the setup hit.'],
  shattercrit: ['Pairs with Frost Charge or naturally frozen targets.'],
  trigger: ['Put a host projectile next, then a payload group after it.'],
  infuser: ['Uses the active flask material as the projectile trail.'],
};

export function cardMatchesBenchFilter(id: CardId, filter: BenchCardFilter): boolean {
  if (filter === 'all') return true;
  const def = CARD_DEFS[id];
  if (filter === 'projectile' || filter === 'modifier' || filter === 'multicast') return def.kind === filter;
  if (filter === 'setup') return def.tags.includes('Setup');
  return def.tags.includes('Terrain');
}

export function recipeHintsForCard(id: CardId): readonly string[] {
  return CARD_RECIPE_HINTS[id] ?? [];
}

const POTION_ICON: Record<string, string> = {
  vigor: 'elixirLife',
  levity: 'elixirLevity',
  stoneskin: 'elixirStone',
  swift: 'card-speed',
  torch: 'fire',
};

type BenchDragSource =
  | { kind: 'collection'; index: number; id: CardId }
  | { kind: 'slot'; wand: 0 | 1; slot: number; id: CardId };

interface SlotLinkSummary {
  outgoingSlots: number[];
  incomingSlots: number[];
  badgeLabel: string;
  badgeClass: string;
  titleLines: string[];
}

export function canOpenWandBench(ctx: Ctx): boolean {
  // The bench is the alchemist's own kit — openable any time in play, on any
  // floor (not just at the Refuge). Opening it pauses the sim, so it never
  // overlaps live combat regardless of where you pop it open.
  return ctx.state.mode === 'play' && !ctx.player.dead && ctx.levels.current !== null;
}

// ===================== Wand Bench =====================
/**
 * The wandsmith's bench (B, play mode): a full overlay for moving spell cards
 * between the collection and the two wand frames. Click-based, no dragging —
 * click a collection card to hold it, click a slot to place it; clicking a
 * filled slot empty-handed returns its card to the collection; clicking a
 * filled slot while holding swaps.
 *
 * Opening the bench pauses the sim (see setVisible): tinkering is a safe modal
 * read, like the Grimoire — the prior pause state is restored on close so it
 * nests under the pause menu. All edits go through ctx.wands.slotCard — the
 * bench never mutates wand state directly, and it re-renders from ctx.wands on
 * every open and on wandChanged while open.
 */
export class WandBench {
  private visible = false;
  /** Index into ctx.wands.collection of the card held by the cursor, or -1. */
  private heldIdx = -1;
  private inspectedCard: CardId | null = null;
  private dragSource: BenchDragSource | null = null;
  private collectionFilter: BenchCardFilter = 'all';
  private closeWatchTimer: number | null = null;
  /** Sim pause state captured when the bench opens, restored on close. */
  private wasPaused = false;
  private readonly eventDisposers: Array<() => void> = [];

  constructor(private ctx: Ctx) {
    window.addEventListener('keydown', this.onKeyDown);

    // The bench is a play-mode verb; leaving play always closes it.
    this.eventDisposers.push(ctx.events.on('modeChanged', ({ mode }) => {
      if (mode !== 'play') this.setVisible(false);
    }));
    this.eventDisposers.push(ctx.events.on('wandChanged', () => {
      if (!this.visible) return;
      if (!canOpenWandBench(this.ctx)) {
        this.setVisible(false);
        return;
      }
      this.render();
    }));
    this.closeWatchTimer = window.setInterval(() => {
      if (this.visible && !canOpenWandBench(this.ctx)) this.setVisible(false);
    }, 250);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'KeyB' && this.ctx.state.mode === 'play') this.toggleFromKey();
    else if (e.code === 'Escape' && this.visible) {
      // Consumed here: Pause ignores a handled Escape instead of opening
      // itself the moment the bench closes (and unpauses) beneath it.
      e.preventDefault();
      if (this.heldIdx >= 0) {
        this.heldIdx = -1;
        this.render();
      } else this.setVisible(false);
    }
  };

  dispose(): void {
    for (const dispose of this.eventDisposers.splice(0)) dispose();
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.closeWatchTimer !== null) {
      window.clearInterval(this.closeWatchTimer);
      this.closeWatchTimer = null;
    }
  }

  /** Keyboard users keep their place across the bench's full re-render. */
  private refocus(selector: string): void {
    el('wand-bench').querySelector<HTMLElement>(selector)?.focus();
  }

  private setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    const root = el('wand-bench');
    if (on) root.addEventListener('mousemove', this.onPointerMove);
    else root.removeEventListener('mousemove', this.onPointerMove);
    this.heldIdx = -1;
    this.inspectedCard = null;
    el('wand-bench').classList.toggle('visible', on);
    // Tinkering at the bench pauses the world; restore the prior pause state on
    // close so it nests under the pause menu.
    if (on) {
      this.wasPaused = this.ctx.state.paused;
      this.ctx.state.paused = true;
      this.render();
      root.querySelector<HTMLElement>('.bench-wand.active .bench-slot')?.focus({ preventScroll: true });
      this.ctx.events.emit('benchOpened');
    } else {
      this.ctx.state.paused = this.wasPaused;
    }
  }

  private toggleFromKey(): void {
    if (this.visible) {
      this.setVisible(false);
      return;
    }
    if (!canOpenWandBench(this.ctx)) return; // dead / not in a run
    this.setVisible(true);
  }

  /** Full rebuild from ctx.wands state — cheap at this element count. */
  private render(): void {
    const root = el('wand-bench');
    root.innerHTML = '';
    root.classList.toggle('holding', this.heldIdx >= 0);
    const wands = this.ctx.wands;

    const shell = document.createElement('div');
    shell.className = 'wb-shell';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-labelledby', 'wb-title');

    const head = document.createElement('div');
    head.className = 'wb-head';
    const titles = document.createElement('div');
    const title = document.createElement('h2');
    title.className = 'menu-title bench-title';
    title.id = 'wb-title';
    title.textContent = "Wandsmith's Bench";
    const sub = document.createElement('p');
    sub.className = 'menu-sub';
    sub.textContent = 'Each click of the wand fires its next group of cards, left to right. Modifiers change the spell after them.';
    titles.append(title, sub);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'menu-close';
    close.innerHTML = '<kbd class="key">B</kbd>Close';
    close.addEventListener('click', () => this.setVisible(false));
    head.append(titles, close);
    shell.appendChild(head);

    const scroll = document.createElement('div');
    scroll.className = 'wb-scroll';

    wands.wands.forEach((wand, i) => {
      const w = i as 0 | 1;
      const active = wands.active === w;
      const row = document.createElement('section');
      row.className = 'bench-wand' + (active ? ' active' : '');
      row.setAttribute('aria-label', 'Wand ' + (w + 1) + ': ' + wand.frame.name);

      const wandHead = document.createElement('div');
      wandHead.className = 'bench-wand-head';
      const id = document.createElement('div');
      id.className = 'wb-wand-id';
      const numeral = document.createElement('span');
      numeral.className = 'wb-numeral';
      numeral.textContent = w === 0 ? 'I' : 'II';
      const name = document.createElement('span');
      name.className = 'wb-wand-name';
      name.textContent = wand.frame.name;
      id.append(numeral, name);
      if (active) {
        const pill = document.createElement('span');
        pill.className = 'wb-in-hand';
        pill.textContent = 'In hand';
        id.appendChild(pill);
      } else {
        const swap = document.createElement('button');
        swap.type = 'button';
        swap.className = 'wb-swap';
        swap.textContent = 'Hold this wand';
        swap.addEventListener('click', () => {
          this.ctx.wands.active = w;
          this.ctx.audio.cardPick();
          this.ctx.events.emit('wandChanged');
          this.render();
        });
        id.appendChild(swap);
      }
      wandHead.append(id, this.makeWandStats(wand.frame));
      row.appendChild(wandHead);

      const sentence = buildWandSentenceView(wand.cards, wand.castIndex);
      const slotsRow = document.createElement('div');
      slotsRow.className = 'wb-slots-row';
      const slots = document.createElement('div');
      slots.className = 'bench-slots';
      wand.cards.forEach((card, s) => slots.appendChild(this.makeSlotTile(w, s, card, sentence)));
      slotsRow.append(slots, this.makeSentencePreview(sentence, wand.mana));
      row.appendChild(slotsRow);
      scroll.appendChild(row);
    });

    const collectionSection = document.createElement('section');
    collectionSection.className = 'wb-collection';
    const collectionHead = document.createElement('div');
    collectionHead.className = 'wb-collection-head';
    const collectionTitle = document.createElement('div');
    collectionTitle.className = 'wb-collection-title';
    const h3 = document.createElement('h3');
    h3.textContent = 'Collection';
    const count = document.createElement('span');
    count.textContent = wands.collection.length === 1 ? '1 spare card' : wands.collection.length + ' spare cards';
    collectionTitle.append(h3, count);
    collectionHead.append(collectionTitle, this.makeCollectionFilters());
    collectionSection.appendChild(collectionHead);

    const grid = document.createElement('div');
    grid.className = 'bench-collection bench-card-collection';
    // The whole section takes a returned card, not just the tiles' grid.
    this.installCollectionDropTarget(collectionSection, grid);
    const collection = wands.collection
      .map((id, index) => ({ id, index }))
      .filter(({ id }) => cardMatchesBenchFilter(id, this.collectionFilter));
    if (wands.collection.length === 0 || collection.length === 0) {
      const none = document.createElement('div');
      none.className = 'bench-empty';
      none.textContent = wands.collection.length === 0
        ? 'Every card you own is in a wand. Tomes in the caves teach new ones.'
        : 'No spare cards of this kind. Try All.';
      grid.appendChild(none);
    }
    collection.forEach(({ id, index }) => grid.appendChild(this.makeCollectionTile(id, index)));
    collectionSection.appendChild(grid);
    scroll.appendChild(collectionSection);

    if (this.ctx.state.debugGodMode) this.appendReviewTools(scroll);
    shell.appendChild(scroll);

    const foot = document.createElement('div');
    foot.className = 'wb-foot';
    foot.innerHTML =
      '<span><kbd class="key">Click</kbd>a card, then a slot</span>' +
      '<span><kbd class="key">Drag</kbd>to move or reorder</span>' +
      '<span><kbd class="key">Right-click</kbd>a slot to take its card out</span>' +
      '<span><kbd class="key">Esc</kbd>close</span>';
    const status = document.createElement('span');
    status.className = 'wb-status';
    status.setAttribute('aria-live', 'polite');
    const held = this.heldIdx >= 0 ? wands.collection[this.heldIdx] : undefined;
    status.textContent = held ? 'Holding ' + CARD_DEFS[held].name + ' — choose a slot' : '';
    foot.appendChild(status);
    shell.appendChild(foot);
    root.appendChild(shell);

    // The detail popover and the held-card ghost live on the bench root so they
    // can sit beside whatever tile you point at.
    const pop = document.createElement('div');
    pop.className = 'menu-pop bench-inspect';
    pop.setAttribute('role', 'tooltip');
    pop.id = 'wb-inspect';
    root.appendChild(pop);
    if (held) {
      const ghost = document.createElement('div');
      ghost.className = 'wb-held-ghost';
      const icon = makeIconCanvas(cardIconName(held), 2);
      if (icon) ghost.appendChild(icon);
      ghost.appendChild(document.createTextNode(CARD_DEFS[held].name));
      ghost.style.left = this.pointer.x + 16 + 'px';
      ghost.style.top = this.pointer.y + 14 + 'px';
      ghost.hidden = this.pointer.x < 0;
      root.appendChild(ghost);
    }
  }

  /** Last pointer position inside the bench, for the held-card ghost. */
  private pointer = { x: -1, y: -1 };
  private readonly onPointerMove = (event: MouseEvent): void => {
    const root = el('wand-bench');
    const rect = root.getBoundingClientRect();
    this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const ghost = root.querySelector<HTMLElement>('.wb-held-ghost');
    if (!ghost) return;
    ghost.hidden = false;
    ghost.style.left = Math.min(rect.width - ghost.offsetWidth - 8, this.pointer.x + 16) + 'px';
    ghost.style.top = Math.min(rect.height - ghost.offsetHeight - 8, this.pointer.y + 14) + 'px';
  };

  private makeWandStats(frame: WandFrame): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'bench-stats';
    const seconds = (frames: number): string => (frames / 60).toFixed(2) + 's';
    const stat = (label: string, value: string, hint: string): void => {
      const item = document.createElement('li');
      item.title = hint;
      item.append(label + ' ');
      const b = document.createElement('b');
      b.textContent = value;
      item.appendChild(b);
      list.appendChild(item);
    };
    stat('Slots', String(frame.capacity), 'How many cards this wand holds');
    stat('Cast', seconds(frame.castDelay), 'Pause between groups while the wand still has cards to fire');
    stat('Recharge', seconds(frame.recharge), 'Pause after the last card, before the wand starts over');
    stat('Mana', String(frame.manaMax), 'Mana tank');
    stat('Regen', Math.round(frame.manaRegen * 60) + '/s', 'Mana refilled per second');
    stat('Spread', (frame.spread * 180 / Math.PI).toFixed(1) + '°', 'Aim wobble of every shot');
    return list;
  }

  private makeSentencePreview(view: WandSentenceView, mana: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'bench-sentence';
    for (const line of view.lines.slice(0, 3)) {
      const row = document.createElement('div');
      row.className = 'bench-sentence-line' + (line.manaCost > mana ? ' overmana' : '');
      const label = document.createElement('span');
      label.className = 'bench-sentence-label';
      label.textContent = line.label;
      const detail = document.createElement('span');
      detail.className = 'bench-sentence-detail';
      const slotDetail = line.detail.replace(/^\d+ mana - /, '');
      detail.textContent = line.manaCost > mana
        ? 'Needs ' + line.manaCost + ' mana, tank has ' + Math.floor(mana) + ' - ' + slotDetail
        : line.detail;
      row.appendChild(label);
      row.appendChild(detail);
      wrap.appendChild(row);
    }
    for (const warning of view.warnings.slice(0, 2)) {
      const row = document.createElement('div');
      row.className = 'bench-sentence-warning';
      row.textContent = warning;
      wrap.appendChild(row);
    }
    return wrap;
  }

  private populateCardInspect(panel: HTMLElement, id: CardId, extra: readonly string[] = [], action = ''): void {
    panel.innerHTML = '';
    const def = CARD_DEFS[id];
    const iconWrap = document.createElement('div');
    iconWrap.className = 'bench-inspect-icon';
    const icon = makeIconCanvas(cardIconName(id), 3);
    if (icon) iconWrap.appendChild(icon);
    panel.appendChild(iconWrap);

    const copy = document.createElement('div');
    copy.className = 'bench-inspect-copy';
    const name = document.createElement('div');
    name.className = 'bench-inspect-name';
    name.textContent = def.name;
    const meta = document.createElement('div');
    meta.className = 'bench-inspect-meta';
    meta.textContent = def.kind.toUpperCase() + ' - ' + def.manaCost + ' MANA';
    copy.append(name, meta);
    panel.appendChild(copy);

    const blurb = document.createElement('div');
    blurb.className = 'bench-inspect-blurb';
    blurb.textContent = def.blurb;
    panel.appendChild(blurb);
    if (def.tags.length > 0) {
      const tags = document.createElement('div');
      tags.className = 'bench-inspect-tags';
      def.tags.forEach((tag) => {
        const chip = document.createElement('span');
        chip.textContent = tag;
        tags.appendChild(chip);
      });
      panel.appendChild(tags);
    }
    if (extra.length > 0) {
      const links = document.createElement('div');
      links.className = 'wb-inspect-links';
      extra.forEach((line) => {
        const row = document.createElement('div');
        row.textContent = line;
        links.appendChild(row);
      });
      panel.appendChild(links);
    }
    const hints = recipeHintsForCard(id);
    if (hints.length > 0) {
      const hintWrap = document.createElement('div');
      hintWrap.className = 'bench-inspect-hints';
      hints.forEach((hint) => {
        const row = document.createElement('div');
        row.textContent = hint;
        hintWrap.appendChild(row);
      });
      panel.appendChild(hintWrap);
    }
    if (action) {
      const row = document.createElement('div');
      row.className = 'wb-inspect-action';
      row.innerHTML = action;
      panel.appendChild(row);
    }
  }

  /** Show a card's details beside the tile it belongs to. */
  private inspectCard(id: CardId, anchor: HTMLElement, extra: readonly string[] = [], action = ''): void {
    this.inspectedCard = id;
    const root = el('wand-bench');
    const pop = root.querySelector<HTMLElement>('.bench-inspect');
    if (!pop) return;
    this.populateCardInspect(pop, id, extra, action);
    // The card stays inside the bench's own panel (not the whole view: at 960 px the view edge is outside it)
    // and prefers the right of its tile, so it never covers the wand or card below.
    const box = root.getBoundingClientRect(), tile = anchor.getBoundingClientRect();
    const panel = root.querySelector<HTMLElement>('.wb-shell')?.getBoundingClientRect() ?? box;
    pop.style.left = '0px';
    pop.style.top = '0px';
    pop.classList.add('shown');
    const w = pop.offsetWidth, h = pop.offsetHeight, gap = 10, pad = 10;
    const minX = panel.left - box.left + pad, maxX = panel.right - box.left - pad;
    const minY = panel.top - box.top + pad, maxY = panel.bottom - box.top - pad;
    const tileL = tile.left - box.left, tileR = tile.right - box.left, tileT = tile.top - box.top, tileB = tile.bottom - box.top;
    let left: number, top: number;
    if (tileR + gap + w <= maxX) {
      // Top edge with the tile's: what hangs below it is a card slot or a hint line, not the wand's name and stats above.
      left = tileR + gap; top = tileT - 4;
    } else if (tileL - gap - w >= minX) {
      left = tileL - gap - w; top = tileT - 4;
    } else {
      left = tileL + tile.width / 2 - w / 2;
      const below = tileB + gap, above = tileT - gap - h;
      top = below + h <= maxY || above < minY ? below : above;
    }
    left = Math.max(minX, Math.min(maxX - w, left));
    top = Math.max(minY, Math.min(maxY - h, top));
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  private hideInspect(): void {
    el('wand-bench').querySelector('.bench-inspect')?.classList.remove('shown');
  }

  private reviewOpen = true;

  private appendReviewTools(parent: HTMLElement): void {
    const root = document.createElement('details');
    root.className = 'wb-review';
    root.open = this.reviewOpen;
    root.addEventListener('toggle', () => { this.reviewOpen = root.open; });
    const summary = document.createElement('summary');
    summary.textContent = 'Playtest tools (god mode)';
    root.appendChild(summary);
    parent.appendChild(root);
    this.appendSection(root, 'REVIEW LOADOUTS');
    const loadouts = document.createElement('div');
    loadouts.className = 'bench-loadouts';
    REVIEW_WAND_LOADOUTS.forEach((loadout) => loadouts.appendChild(this.makeReviewLoadoutButton(loadout)));
    root.appendChild(loadouts);

    this.appendSection(root, 'STATUS POTIONS');
    const potions = document.createElement('div');
    potions.className = 'bench-collection';
    POTION_KINDS.forEach((kind) => potions.appendChild(this.makePotionTile(kind)));
    root.appendChild(potions);

    this.appendSection(root, 'POTION INVENTORY');
    this.appendFlaskInventory(root);

    this.appendSection(root, 'ACTIVE POWERS');
    const powers = document.createElement('div');
    powers.className = 'bench-powers';
    PERK_DEFS.forEach(({ id, shortLabel }) => {
      const active = isPerkActive(this.ctx, id);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'bench-power' + (active ? ' active' : '');
      chip.textContent = shortLabel;
      chip.setAttribute('aria-label', shortLabel + ' power');
      chip.setAttribute('aria-pressed', String(active));
      chip.addEventListener('click', () => {
        const enabled = togglePerkActive(this.ctx, id);
        this.ctx.events.emit('toast', { text: shortLabel + (enabled ? ' POWER READY' : ' POWER OFF') });
        this.render();
      });
      powers.appendChild(chip);
    });
    root.appendChild(powers);
  }

  private makeReviewLoadoutButton(loadout: BuiltInWandLoadout): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bench-loadout';
    button.textContent = loadout.name;
    button.setAttribute('aria-label', 'Apply ' + loadout.name + ' to active wand');
    button.title = loadout.cards.map((id) => CARD_DEFS[id].name).join(' + ');
    button.addEventListener('click', () => {
      this.applyReviewLoadout(loadout);
    });
    return button;
  }

  private applyReviewLoadout(loadout: BuiltInWandLoadout): void {
    const frame = WAND_FRAMES[loadout.frameId];
    if (!frame) return;
    const active = this.ctx.wands.active;
    const snapshot = this.ctx.wands.snapshotLoadout();
    const cards: Array<CardId | null> = [...loadout.cards];
    while (cards.length < frame.capacity) cards.push(null);
    cards.length = frame.capacity;

    snapshot.active = active;
    snapshot.collection = [...ALL_CARD_IDS];
    snapshot.wands[active] = {
      frameId: frame.id,
      cards,
      mana: frame.manaMax,
    };
    this.ctx.wands.loadLoadout(snapshot);
    this.ctx.audio.cardSlot();
    this.ctx.events.emit('toast', { text: loadout.name.toUpperCase() + ' READY' });
    this.inspectedCard = loadout.cards[0] ?? null;
    this.render();
  }

  private appendSection(root: HTMLElement, label: string): void {
    const section = document.createElement('div');
    section.className = 'bench-section';
    section.textContent = label;
    root.appendChild(section);
  }

  private makeCollectionFilters(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'bench-card-filters';
    wrap.classList.add('menu-tabs');
    for (const filter of BENCH_CARD_FILTERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'menu-tab';
      btn.textContent = filter.label;
      const total = this.ctx.wands.collection.filter((id) => cardMatchesBenchFilter(id, filter.id)).length;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(total);
      btn.appendChild(count);
      btn.dataset.benchCardFilter = filter.id;
      btn.setAttribute('aria-pressed', String(this.collectionFilter === filter.id));
      btn.addEventListener('click', () => {
        this.collectionFilter = filter.id;
        this.heldIdx = -1;
        this.render();
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  private makePotionTile(kind: string): HTMLElement {
    const def = POTION_DEFS[kind] ?? POTION_DEFS.vigor;
    const tile = this.makeTestTile(POTION_ICON[kind] ?? 'elixirLife', kind.slice(0, 3).toUpperCase());
    tile.setAttribute('aria-label', def.name + ' refreshes ' + def.status);
    tile.addEventListener('click', () => {
      const status = this.ctx.player.status;
      status[def.status] = Math.min(BENCH_STATUS_CAP, status[def.status] + def.frames);
      this.ctx.audio.drinkPotion();
      this.ctx.events.emit('toast', { text: def.name });
    });
    return tile;
  }

  private appendFlaskInventory(root: HTMLElement): void {
    const grid = document.createElement('div');
    grid.className = 'bench-flask-grid';
    for (let i = 0; i < FLASK_SLOT_COUNT; i++) {
      grid.appendChild(this.makeFlaskSlotEditor(i));
    }
    root.appendChild(grid);
  }

  private makeFlaskSlotEditor(index: number): HTMLElement {
    const slot = this.ctx.flask.slots[index];
    const card = document.createElement('div');
    card.className = 'bench-flask-slot' + (index === this.ctx.flask.activeIndex ? ' active' : '');
    card.dataset.benchFlaskSlot = String(index);

    const head = document.createElement('div');
    head.className = 'bench-flask-head';
    const title = document.createElement('button');
    title.type = 'button';
    title.textContent = 'FLASK ' + (index + 1);
    title.setAttribute('aria-label', 'Select flask ' + (index + 1) + ' as active');
    title.addEventListener('click', () => {
      this.ctx.flask.selectSlot(index);
      this.ctx.events.emit('toast', { text: 'FLASK ' + (index + 1) + ' ACTIVE' });
      this.render();
    });
    const key = document.createElement('span');
    key.textContent = 'KEY ' + (index + 3);
    head.appendChild(title);
    head.appendChild(key);
    card.appendChild(head);

    const readout = document.createElement('div');
    readout.className = 'bench-flask-readout';
    readout.title = this.flaskMaterialName(slot);
    const iconWrap = document.createElement('div');
    iconWrap.className = 'bench-flask-icon';
    const icon = makeIconCanvas(this.flaskIcon(slot), 3);
    if (icon) iconWrap.appendChild(icon);
    readout.appendChild(iconWrap);
    card.appendChild(readout);

    const controls = document.createElement('div');
    controls.className = 'bench-flask-controls';

    const select = document.createElement('select');
    select.dataset.benchFlaskMaterial = String(index);
    select.setAttribute('aria-label', 'Flask ' + (index + 1) + ' potion');
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Empty';
    select.appendChild(emptyOption);
    for (const fill of flaskMaterialOptions(this.ctx.params.materials)) {
      const option = document.createElement('option');
      option.value = String(fill.id);
      option.textContent = fill.name;
      select.appendChild(option);
    }
    select.value = slot.material === null ? '' : String(slot.material);
    select.addEventListener('change', () => {
      const material = select.value === '' ? null : Number(select.value);
      this.setFlaskMaterial(index, material);
    });
    controls.appendChild(select);

    const output = document.createElement('output');
    output.className = 'bench-flask-count';
    output.value = String(slot.count);
    output.textContent = this.flaskCountLabel(slot);
    controls.appendChild(output);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(slot.capacity);
    slider.step = '25';
    slider.value = String(slot.count);
    slider.className = 'bench-flask-slider';
    slider.dataset.benchFlaskCount = String(index);
    slider.disabled = slot.material === null;
    slider.setAttribute('aria-label', 'Flask ' + (index + 1) + ' cell count');
    slider.addEventListener('input', () => {
      this.setFlaskCount(index, Number(slider.value), false);
      output.value = String(this.ctx.flask.slots[index].count);
      output.textContent = this.flaskCountLabel(this.ctx.flask.slots[index]);
    });
    slider.addEventListener('change', () => this.render());
    controls.appendChild(slider);
    card.appendChild(controls);

    return card;
  }

  private setFlaskMaterial(index: number, material: number | null): void {
    const slot = this.ctx.flask.slots[index];
    if (material === null) {
      this.emptyFlaskSlot(index);
      return;
    }
    const count = slot && slot.count > 0 ? slot.count : (slot?.capacity ?? 600);
    this.ctx.flask.setSlot(index, material, count);
    this.ctx.flask.selectSlot(index);
    this.ctx.audio.drinkPotion();
    this.ctx.events.emit('toast', { text: 'FLASK ' + (index + 1) + ': ' + this.flaskMaterialName(this.ctx.flask.slots[index]).toUpperCase() });
    this.render();
  }

  private emptyFlaskSlot(index: number): void {
    this.ctx.flask.setSlot(index, null, 0);
    this.ctx.flask.selectSlot(index);
    this.ctx.audio.drinkPotion();
    this.ctx.events.emit('toast', { text: 'FLASK ' + (index + 1) + ' EMPTIED' });
    this.render();
  }

  private setFlaskCount(index: number, count: number, rerender = true): void {
    const slot = this.ctx.flask.slots[index];
    if (!slot || slot.material === null) return;
    this.ctx.flask.setSlot(index, slot.material, count);
    this.ctx.flask.selectSlot(index);
    if (rerender) this.render();
  }

  private flaskIcon(slot: FlaskState): string {
    if (slot.material === null) return 'glass';
    return ELEMENT_ICON[slot.material] ?? 'elixirLife';
  }

  private flaskMaterialName(slot: FlaskState): string {
    if (slot.material === null || slot.count <= 0) return 'Empty';
    return this.ctx.params.materials[slot.material]?.name ?? 'Material ' + slot.material;
  }

  private flaskCountLabel(slot: FlaskState): string {
    return slot.count + '/' + slot.capacity;
  }

  private makeTestTile(iconName: string, label: string): HTMLElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'bench-card bench-test-card';
    const icon = makeIconCanvas(iconName, 2);
    if (icon) tile.appendChild(icon);
    const text = document.createElement('span');
    text.className = 'bench-card-label';
    text.textContent = label;
    tile.appendChild(text);
    return tile;
  }

  private installCollectionDropTarget(zone: HTMLElement, grid: HTMLElement): void {
    zone.addEventListener('dragover', (event) => {
      if (!this.dragSource) return;
      event.preventDefault();
      grid.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (event) => {
      if (!zone.contains(event.relatedTarget as Node | null)) grid.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      grid.classList.remove('drag-over');
      if (this.dragSource?.kind !== 'slot') {
        this.clearDragSource();
        return;
      }
      this.ctx.wands.moveSlotToCollection(this.dragSource.wand, this.dragSource.slot);
      this.ctx.audio.cardPick();
      this.clearDragSource();
      this.render();
    });
  }

  private onDragStart(event: DragEvent, source: BenchDragSource): void {
    this.dragSource = source;
    this.heldIdx = -1;
    this.inspectedCard = source.id;
    event.dataTransfer?.setData('text/plain', source.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  private onDragEnd(): void {
    this.clearDragSource();
  }

  private clearDragSource(): void {
    this.dragSource = null;
  }

  /** Slot to flash on the next render (CSS animation runs on the fresh tile). */
  private flashSlot: { w: 0 | 1; s: number } | null = null;

  private makeSlotTile(w: 0 | 1, s: number, id: CardId | null, view: WandSentenceView): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'bench-slot' + (id === null ? ' empty' : '');
    tile.dataset.benchWand = String(w);
    tile.dataset.benchSlot = String(s);
    if (view.slotWarnings[s]?.length) tile.classList.add('sentence-warning');
    if (this.flashSlot && this.flashSlot.w === w && this.flashSlot.s === s) {
      tile.classList.add('just-slotted');
    }
    const number = document.createElement('span');
    number.className = 'wb-slot-no';
    number.textContent = String(s + 1);
    tile.appendChild(number);
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    if (id === null) {
      tile.setAttribute('aria-label', 'Wand ' + (w + 1) + ' slot ' + (s + 1) + ', empty');
    } else {
      const slotLinks = this.describeSlotLinks(w, s, view);
      const warningLines = view.slotWarnings[s] ?? [];
      const titleParts = [cardTitle(id), ...(slotLinks?.titleLines ?? []), ...warningLines];
      tile.setAttribute('aria-label', 'Slot ' + (s + 1) + ': ' + titleParts.join(' - '));
      if (this.inspectedCard === id) tile.classList.add('inspected');
      const icon = makeIconCanvas(cardIconName(id), 3);
      if (icon) tile.appendChild(icon);
      if (slotLinks) this.appendSlotLinkBadge(tile, slotLinks);
      const cost = document.createElement('div');
      cost.className = 'cost';
      cost.textContent = String(CARD_DEFS[id].manaCost);
      tile.appendChild(cost);
      tile.draggable = true;
      tile.addEventListener('dragstart', (event) => this.onDragStart(event, { kind: 'slot', wand: w, slot: s, id }));
      tile.addEventListener('dragend', () => this.onDragEnd());
      const lines = [...(slotLinks?.titleLines ?? []), ...warningLines];
      const action = this.heldIdx >= 0
        ? '<b>Click</b> to swap in the card you are holding'
        : '<b>Click</b> or <b>right-click</b> to take it out · <b>drag</b> to reorder';
      const show = (): void => {
        this.inspectCard(id, tile, lines, action);
        this.highlightRelatedSlots(w, s);
      };
      tile.addEventListener('mouseenter', show);
      tile.addEventListener('focus', show);
      tile.addEventListener('mouseleave', () => { this.clearSentenceHighlights(); this.hideInspect(); });
      tile.addEventListener('blur', () => { this.clearSentenceHighlights(); this.hideInspect(); });
      tile.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.heldIdx = -1;
        this.ctx.wands.slotCard(w, s, null);
        this.ctx.audio.cardPick();
        this.render();
      });
    }
    tile.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.onSlotClick(w, s, id);
        this.refocus('[data-bench-wand="' + w + '"][data-bench-slot="' + s + '"]');
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && id !== null) {
        event.preventDefault();
        this.ctx.wands.slotCard(w, s, null);
        this.ctx.audio.cardPick();
        this.render();
        this.refocus('[data-bench-wand="' + w + '"][data-bench-slot="' + s + '"]');
      }
    });
    tile.addEventListener('dragover', (event) => {
      if (!this.dragSource) return;
      event.preventDefault();
      tile.classList.add('drag-over');
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
    tile.addEventListener('drop', (event) => {
      event.preventDefault();
      tile.classList.remove('drag-over');
      this.onSlotDrop(w, s);
    });
    tile.addEventListener('click', () => this.onSlotClick(w, s, id));
    return tile;
  }

  private describeSlotLinks(w: 0 | 1, s: number, view: WandSentenceView): SlotLinkSummary | null {
    const links = view.slotLinks[s] ?? [];
    if (links.length === 0) return null;

    const outgoingByKind = new Map<WandSlotLinkKind, number[]>();
    const incoming = new Set<number>();
    for (const link of links) {
      if (link.from === s) {
        const targets = outgoingByKind.get(link.kind) ?? [];
        if (!targets.includes(link.to)) targets.push(link.to);
        outgoingByKind.set(link.kind, targets);
      }
      if (link.to === s) incoming.add(link.from);
    }

    // Dedupe across kinds so a slot that is e.g. both a multicast and a trigger
    // target isn't listed twice in the data-bench-affects-slots attribute.
    const outgoingSlots = [...new Set(Array.from(outgoingByKind.values()).flat())];
    const incomingSlots = [...incoming].sort((a, b) => a - b);

    const cards = this.ctx.wands.wands[w].cards;
    const titleLines: string[] = [];
    for (const kind of ['modifier', 'multicast', 'trigger-host', 'trigger-payload'] as const) {
      const targets = outgoingByKind.get(kind) ?? [];
      if (targets.length > 0) titleLines.push(this.outgoingSlotLine(kind, targets, cards));
    }
    if (incomingSlots.length > 0) {
      titleLines.push('Affected by ' + this.namedSlotList(incomingSlots, cards));
    }

    const hasOutgoing = outgoingSlots.length > 0;
    const hasIncoming = incomingSlots.length > 0;
    const badgeLabel = hasOutgoing
      ? this.compactSlotBadge('→', outgoingSlots)
      : this.compactSlotBadge('←', incomingSlots);
    const badgeClass = hasOutgoing && hasIncoming ? 'mixed' : hasOutgoing ? 'outgoing' : 'incoming';
    return { outgoingSlots, incomingSlots, badgeLabel, badgeClass, titleLines };
  }

  private appendSlotLinkBadge(tile: HTMLElement, summary: SlotLinkSummary): void {
    tile.classList.add('has-slot-link', 'has-' + summary.badgeClass + '-link');
    if (summary.outgoingSlots.length > 0) {
      tile.dataset.benchAffectsSlots = summary.outgoingSlots.map((slot) => String(slot + 1)).join(',');
    }
    if (summary.incomingSlots.length > 0) {
      tile.dataset.benchAffectedBySlots = summary.incomingSlots.map((slot) => String(slot + 1)).join(',');
    }

    const badge = document.createElement('span');
    badge.className = 'bench-slot-link ' + summary.badgeClass;
    badge.textContent = summary.badgeLabel;
    badge.setAttribute('aria-hidden', 'true');
    tile.appendChild(badge);
  }

  private outgoingSlotLine(kind: WandSlotLinkKind, slots: number[], cards: (CardId | null)[]): string {
    const verb =
      kind === 'multicast' ? 'Groups ' :
      kind === 'trigger-host' ? 'Arms host ' :
      kind === 'trigger-payload' ? 'Triggers payload ' :
      'Affects ';
    return verb + this.namedSlotList(slots, cards);
  }

  private namedSlotList(slots: number[], cards: (CardId | null)[]): string {
    const sorted = [...new Set(slots)].sort((a, b) => a - b);
    const slotWord = sorted.length === 1 ? 'slot ' : 'slots ';
    return slotWord + sorted.map((slot) => {
      const id = cards[slot];
      return String(slot + 1) + (id ? ' (' + CARD_DEFS[id].name + ')' : '');
    }).join(', ');
  }

  private compactSlotBadge(prefix: string, slots: number[]): string {
    const sorted = [...new Set(slots)].sort((a, b) => a - b);
    if (sorted.length <= 2) return prefix + sorted.map((slot) => String(slot + 1)).join(',');
    return prefix + sorted.length + 'x';
  }

  private highlightRelatedSlots(w: 0 | 1, s: number): void {
    this.clearSentenceHighlights();
    const cards = this.ctx.wands.wands[w].cards;
    const view = buildWandSentenceView(cards, this.ctx.wands.wands[w].castIndex);
    const related = new Set<number>([s, ...(view.slotRelations[s] ?? [])]);
    for (const slot of related) {
      const tile = document.querySelector<HTMLElement>(
        '#wand-bench .bench-slot[data-bench-wand="' + w + '"][data-bench-slot="' + slot + '"]',
      );
      tile?.classList.add(slot === s ? 'sentence-source' : 'sentence-related');
    }
  }

  private clearSentenceHighlights(): void {
    document.querySelectorAll('#wand-bench .sentence-source, #wand-bench .sentence-related').forEach((node) => {
      node.classList.remove('sentence-source', 'sentence-related');
    });
  }

  private makeCollectionTile(id: CardId, i: number): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'bench-card' + (i === this.heldIdx ? ' held' : '');
    tile.draggable = true;
    tile.dataset.benchCollectionIndex = String(i);
    tile.dataset.benchCardId = id;
    tile.dataset.benchCardKind = CARD_DEFS[id].kind;
    tile.dataset.benchCardTags = CARD_DEFS[id].tags.join(' ');
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-label', cardTitle(id));
    tile.setAttribute('aria-pressed', String(i === this.heldIdx));
    if (this.inspectedCard === id) tile.classList.add('inspected');
    const kind = document.createElement('span');
    kind.className = 'wb-card-kind wb-kind-' + CARD_DEFS[id].kind;
    kind.setAttribute('aria-hidden', 'true');
    tile.appendChild(kind);
    const icon = makeIconCanvas(cardIconName(id), 3);
    if (icon) tile.appendChild(icon);
    const name = document.createElement('span');
    name.className = 'wb-card-name';
    name.textContent = CARD_DEFS[id].name;
    tile.appendChild(name);
    const cost = document.createElement('div');
    cost.className = 'cost';
    cost.textContent = String(CARD_DEFS[id].manaCost);
    tile.appendChild(cost);
    const action = i === this.heldIdx
      ? '<b>Click a slot</b> to seat it · click this card again to put it down'
      : '<b>Click</b> to pick up, then click a slot · or <b>drag</b> it onto a slot';
    const show = (): void => this.inspectCard(id, tile, [], action);
    tile.addEventListener('mouseenter', show);
    tile.addEventListener('focus', show);
    tile.addEventListener('mouseleave', () => this.hideInspect());
    tile.addEventListener('blur', () => this.hideInspect());
    tile.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      tile.click();
      this.refocus('[data-bench-collection-index="' + i + '"]');
    });
    tile.addEventListener('dragstart', (event) => this.onDragStart(event, { kind: 'collection', index: i, id }));
    tile.addEventListener('dragend', () => this.onDragEnd());
    // Click toggles 'held' — clicking the held card again puts it down.
    tile.addEventListener('click', () => {
      this.heldIdx = this.heldIdx === i ? -1 : i;
      this.inspectedCard = id;
      this.ctx.audio.cardPick(); // paper snick
      this.render();
    });
    return tile;
  }

  private onSlotDrop(w: 0 | 1, s: number): void {
    const source = this.dragSource;
    if (!source) return;
    if (source.kind === 'collection') {
      this.ctx.wands.slotCollectionCard(source.index, w, s);
      this.flashSlot = { w, s };
      this.ctx.audio.cardSlot();
    } else {
      this.ctx.wands.swapSlots(source.wand, source.slot, w, s);
      this.flashSlot = { w, s };
      this.ctx.audio.cardSlot();
    }
    this.clearDragSource();
    this.render();
    this.flashSlot = null;
  }

  private onSlotClick(w: 0 | 1, s: number, id: CardId | null): void {
    const wands = this.ctx.wands;
    const held = this.heldIdx >= 0 ? wands.collection[this.heldIdx] : undefined;
    this.heldIdx = -1;
    if (held !== undefined) {
      this.inspectedCard = held;
      // Swap: a filled slot returns its card to the collection first.
      if (id !== null) wands.slotCard(w, s, null);
      wands.slotCard(w, s, held);
      this.ctx.audio.cardSlot(); // firm clack: seated in the wand
      this.flashSlot = { w, s };
    } else if (id !== null) {
      this.inspectedCard = id;
      // Empty-handed click on a filled slot returns the card to the collection.
      wands.slotCard(w, s, null);
      this.ctx.audio.cardPick();
    }
    // slotCard emits wandChanged, but re-render directly so the bench never
    // depends on the event for its own interactions.
    this.render();
    this.flashSlot = null;
  }
}

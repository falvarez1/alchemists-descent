import { FLASK_SLOT_COUNT, type CardId, type Ctx, type FlaskState, type PerkId } from '@/core/types';
import { CARD_DEFS } from '@/combat/wands/cards';
import { POTION_DEFS, POTION_KINDS } from '@/game/Pickups';
import { Cell } from '@/sim/CellType';
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
const BENCH_REFUGE_RADIUS = 48;

const POTION_ICON: Record<string, string> = {
  vigor: 'elixirLife',
  levity: 'elixirLevity',
  stoneskin: 'elixirStone',
  swift: 'card-speed',
  torch: 'fire',
};

const FLASK_FILL_CHOICES = [
  { id: 'water', name: 'Water', label: 'WATER', cell: Cell.Water },
  { id: 'acid', name: 'Acid', label: 'ACID', cell: Cell.Acid },
  { id: 'lava', name: 'Lava', label: 'LAVA', cell: Cell.Lava },
  { id: 'nitrogen', name: 'Liquid Nitrogen', label: 'N2', cell: Cell.Nitrogen },
  { id: 'life', name: 'Elixir of Life', label: 'LIFE', cell: Cell.ElixirLife },
  { id: 'levity', name: 'Elixir of Levity', label: 'LEV', cell: Cell.ElixirLevity },
  { id: 'stone', name: 'Elixir of Stone', label: 'STONE', cell: Cell.ElixirStone },
] as const;

const PERK_LABELS: Array<{ id: PerkId; name: string }> = [
  { id: 'might', name: 'MIGHT' },
  { id: 'vampirism', name: 'VAMP' },
  { id: 'featherweight', name: 'FEATHER' },
  { id: 'manafont', name: 'MANA' },
  { id: 'swiftfoot', name: 'SWIFT' },
  { id: 'torchbearer', name: 'TORCH' },
  { id: 'ironhide', name: 'IRON' },
  { id: 'flameward', name: 'FIRE' },
  { id: 'toxinward', name: 'TOXIN' },
  { id: 'goldmagnet', name: 'GOLD' },
];

type BenchDragSource =
  | { kind: 'collection'; index: number; id: CardId }
  | { kind: 'slot'; wand: 0 | 1; slot: number; id: CardId };

export function canOpenWandBench(ctx: Ctx): boolean {
  if (ctx.state.mode !== 'play' || ctx.player.dead) return false;
  const runtime = ctx.levels.current;
  if (!runtime) return false;
  const refuge = runtime.refuge;
  if (!refuge) return false;
  const dx = refuge.x - ctx.player.x;
  const dy = refuge.y - ctx.player.y;
  return dx * dx + dy * dy <= BENCH_REFUGE_RADIUS * BENCH_REFUGE_RADIUS;
}

// ===================== Wand Bench =====================
/**
 * The wandsmith's bench (B, play mode): a full overlay for moving spell cards
 * between the collection and the two wand frames. Click-based, no dragging —
 * click a collection card to hold it, click a slot to place it; clicking a
 * filled slot empty-handed returns its card to the collection; clicking a
 * filled slot while holding swaps.
 *
 * Pause-light BY DESIGN: the simulation keeps running underneath (the descent
 * is forgiving; bench at your own risk). All edits go through
 * ctx.wands.slotCard — the bench never mutates wand state directly, and it
 * re-renders from ctx.wands on every open and on wandChanged while open.
 */
export class WandBench {
  private visible = false;
  /** Index into ctx.wands.collection of the card held by the cursor, or -1. */
  private heldIdx = -1;
  private dragSource: BenchDragSource | null = null;

  constructor(private ctx: Ctx) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyB' && this.ctx.state.mode === 'play') this.toggleFromKey();
      else if (e.code === 'Escape' && this.visible) this.setVisible(false);
    });

    // The bench is a play-mode verb; leaving play always closes it.
    ctx.events.on('modeChanged', ({ mode }) => {
      if (mode !== 'play') this.setVisible(false);
    });
    ctx.events.on('wandChanged', () => {
      if (!this.visible) return;
      if (!canOpenWandBench(this.ctx)) {
        this.setVisible(false);
        return;
      }
      this.render();
    });
    window.setInterval(() => {
      if (this.visible && !canOpenWandBench(this.ctx)) this.setVisible(false);
    }, 250);
  }

  private setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.heldIdx = -1;
    el('wand-bench').classList.toggle('visible', on);
    if (on) this.render();
  }

  private toggleFromKey(): void {
    if (this.visible) {
      this.setVisible(false);
      return;
    }
    if (!canOpenWandBench(this.ctx)) {
      this.ctx.events.emit('toast', { text: 'WAND BENCH WAITS IN THE REFUGE' });
      return;
    }
    this.setVisible(true);
  }

  /** Full rebuild from ctx.wands state — cheap at this element count. */
  private render(): void {
    const root = el('wand-bench');
    root.innerHTML = '';
    const wands = this.ctx.wands;

    const title = document.createElement('div');
    title.className = 'bench-title';
    title.textContent = "WANDSMITH'S BENCH";
    root.appendChild(title);

    wands.wands.forEach((wand, i) => {
      const w = i as 0 | 1;
      const row = document.createElement('div');
      row.className = 'bench-wand' + (wands.active === w ? ' active' : '');

      const head = document.createElement('div');
      head.className = 'bench-wand-head';
      const name = document.createElement('span');
      name.className = 'wand-label';
      name.textContent = wand.frame.name + (wands.active === w ? ' · ACTIVE' : '');
      const f = wand.frame;
      const stats = document.createElement('span');
      stats.className = 'bench-stats';
      stats.textContent =
        f.capacity + ' slots · delay ' + f.castDelay + 'f · recharge ' + f.recharge +
        'f · mana ' + f.manaMax + ' (+' + f.manaRegen + '/f) · spread ' + f.spread.toFixed(2);
      head.appendChild(name);
      head.appendChild(stats);
      row.appendChild(head);

      const slots = document.createElement('div');
      slots.className = 'bench-slots';
      wand.cards.forEach((id, s) => slots.appendChild(this.makeSlotTile(w, s, id)));
      row.appendChild(slots);
      root.appendChild(row);
    });

    const section = document.createElement('div');
    section.className = 'bench-section';
    section.textContent = 'COLLECTION';
    root.appendChild(section);

    const grid = document.createElement('div');
    grid.className = 'bench-collection bench-card-collection';
    this.installCollectionDropTarget(grid);
    if (wands.collection.length === 0) {
      const none = document.createElement('div');
      none.className = 'bench-empty';
      none.textContent = 'no spare cards — the caves hold more';
      grid.appendChild(none);
    }
    wands.collection.forEach((id, i) => grid.appendChild(this.makeCollectionTile(id, i)));
    root.appendChild(grid);

    if (this.ctx.state.debugGodMode) this.appendReviewTools(root);

    const hint = document.createElement('div');
    hint.className = 'bench-hint';
    hint.textContent =
      'CLICK A CARD, THEN A SLOT · CLICK A FILLED SLOT TO UNSLOT · B / ESC CLOSES · THE CAVES DO NOT WAIT';
    root.appendChild(hint);
  }

  private appendReviewTools(root: HTMLElement): void {
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
    PERK_LABELS.forEach(({ id, name }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'bench-power' + (this.ctx.player.perks[id] ? ' active' : '');
      chip.textContent = name;
      chip.setAttribute('aria-label', name + ' power is active');
      chip.addEventListener('click', () => {
        this.ctx.player.perks[id] = true;
        this.ctx.events.emit('toast', { text: name + ' POWER READY' });
        this.render();
      });
      powers.appendChild(chip);
    });
    root.appendChild(powers);
  }

  private appendSection(root: HTMLElement, label: string): void {
    const section = document.createElement('div');
    section.className = 'bench-section';
    section.textContent = label;
    root.appendChild(section);
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
    for (const fill of FLASK_FILL_CHOICES) {
      const option = document.createElement('option');
      option.value = String(fill.cell);
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

  private installCollectionDropTarget(grid: HTMLElement): void {
    grid.addEventListener('dragover', (event) => {
      if (!this.dragSource) return;
      event.preventDefault();
      grid.classList.add('drag-over');
    });
    grid.addEventListener('dragleave', (event) => {
      if (!grid.contains(event.relatedTarget as Node | null)) grid.classList.remove('drag-over');
    });
    grid.addEventListener('drop', (event) => {
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

  private makeSlotTile(w: 0 | 1, s: number, id: CardId | null): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'bench-slot' + (id === null ? ' empty' : '');
    tile.dataset.benchWand = String(w);
    tile.dataset.benchSlot = String(s);
    if (this.flashSlot && this.flashSlot.w === w && this.flashSlot.s === s) {
      tile.classList.add('just-slotted');
    }
    if (id === null) {
      tile.title = 'Empty slot';
    } else {
      tile.title = cardTitle(id);
      const icon = makeIconCanvas(cardIconName(id), 3);
      if (icon) tile.appendChild(icon);
      const cost = document.createElement('div');
      cost.className = 'cost';
      cost.textContent = String(CARD_DEFS[id].manaCost);
      tile.appendChild(cost);
      tile.draggable = true;
      tile.addEventListener('dragstart', (event) => this.onDragStart(event, { kind: 'slot', wand: w, slot: s, id }));
      tile.addEventListener('dragend', () => this.onDragEnd());
    }
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

  private makeCollectionTile(id: CardId, i: number): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'bench-card' + (i === this.heldIdx ? ' held' : '');
    tile.draggable = true;
    tile.dataset.benchCollectionIndex = String(i);
    tile.title = cardTitle(id);
    const icon = makeIconCanvas(cardIconName(id), 3);
    if (icon) tile.appendChild(icon);
    const cost = document.createElement('div');
    cost.className = 'cost';
    cost.textContent = String(CARD_DEFS[id].manaCost);
    tile.appendChild(cost);
    tile.addEventListener('dragstart', (event) => this.onDragStart(event, { kind: 'collection', index: i, id }));
    tile.addEventListener('dragend', () => this.onDragEnd());
    // Click toggles 'held' — clicking the held card again puts it down.
    tile.addEventListener('click', () => {
      this.heldIdx = this.heldIdx === i ? -1 : i;
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
      // Swap: a filled slot returns its card to the collection first.
      if (id !== null) wands.slotCard(w, s, null);
      wands.slotCard(w, s, held);
      this.ctx.audio.cardSlot(); // firm clack: seated in the wand
      this.flashSlot = { w, s };
    } else if (id !== null) {
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

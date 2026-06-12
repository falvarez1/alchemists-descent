import type { CardId, Ctx, PerkId } from '@/core/types';
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

const POTION_ICON: Record<string, string> = {
  vigor: 'elixirLife',
  levity: 'elixirLevity',
  stoneskin: 'elixirStone',
  swift: 'card-speed',
  torch: 'fire',
};

const ELIXIR_TESTS = [
  { name: 'Life', label: 'LIFE', cell: Cell.ElixirLife },
  { name: 'Levity', label: 'LEV', cell: Cell.ElixirLevity },
  { name: 'Stone', label: 'STONE', cell: Cell.ElixirStone },
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

  constructor(private ctx: Ctx) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyB' && this.ctx.state.mode === 'play') this.setVisible(!this.visible);
      else if (e.code === 'Escape' && this.visible) this.setVisible(false);
    });

    // The bench is a play-mode verb; leaving play always closes it.
    ctx.events.on('modeChanged', ({ mode }) => {
      if (mode !== 'play') this.setVisible(false);
    });
    ctx.events.on('wandChanged', () => {
      if (this.visible) this.render();
    });
  }

  private setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.heldIdx = -1;
    el('wand-bench').classList.toggle('visible', on);
    if (on) this.render();
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
    grid.className = 'bench-collection';
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
    this.appendSection(root, 'POTION BELT');
    const potions = document.createElement('div');
    potions.className = 'bench-collection';
    POTION_KINDS.forEach((kind) => potions.appendChild(this.makePotionTile(kind)));
    root.appendChild(potions);

    this.appendSection(root, 'ELIXIR FLASK FILLS');
    const elixirs = document.createElement('div');
    elixirs.className = 'bench-collection';
    ELIXIR_TESTS.forEach((elixir) => elixirs.appendChild(this.makeElixirTile(elixir)));
    root.appendChild(elixirs);

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

  private makeElixirTile(elixir: (typeof ELIXIR_TESTS)[number]): HTMLElement {
    const icon = ELEMENT_ICON[elixir.cell] ?? 'elixirLife';
    const tile = this.makeTestTile(icon, elixir.label);
    tile.setAttribute('aria-label', 'Fill flask with Elixir of ' + elixir.name);
    tile.addEventListener('click', () => {
      const flask = this.ctx.flask.state;
      flask.material = elixir.cell;
      flask.count = flask.capacity;
      this.ctx.audio.drinkPotion();
      this.ctx.events.emit('toast', { text: 'ELIXIR OF ' + elixir.name.toUpperCase() + ' FILLS THE FLASK' });
    });
    return tile;
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

  /** Slot to flash on the next render (CSS animation runs on the fresh tile). */
  private flashSlot: { w: 0 | 1; s: number } | null = null;

  private makeSlotTile(w: 0 | 1, s: number, id: CardId | null): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'bench-slot' + (id === null ? ' empty' : '');
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
    }
    tile.addEventListener('click', () => this.onSlotClick(w, s, id));
    return tile;
  }

  private makeCollectionTile(id: CardId, i: number): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'bench-card' + (i === this.heldIdx ? ' held' : '');
    tile.title = cardTitle(id);
    const icon = makeIconCanvas(cardIconName(id), 3);
    if (icon) tile.appendChild(icon);
    const cost = document.createElement('div');
    cost.className = 'cost';
    cost.textContent = String(CARD_DEFS[id].manaCost);
    tile.appendChild(cost);
    // Click toggles 'held' — clicking the held card again puts it down.
    tile.addEventListener('click', () => {
      this.heldIdx = this.heldIdx === i ? -1 : i;
      this.ctx.audio.cardPick(); // paper snick
      this.render();
    });
    return tile;
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

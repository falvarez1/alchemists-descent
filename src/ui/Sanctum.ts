import {
  buildCardOffer,
  collectOwnedCards,
  requestCardOffer,
  SANCTUM_LOST_PAGES_POOL,
  withDiscoveredCards,
} from '@/combat/wands/rewardPools';
import { getDiscoveredCards } from '@/combat/wands/cardDiscovery';
import type { CardId, Ctx, PerkId, SanctumApi } from '@/core/types';
import { POTION_DEFS, POTION_KINDS } from '@/core/pickupDefs';
import { SANCTUM_PERK_DEFS } from '@/content/perks';
import { FLOOR_LORE } from '@/content/floorLore';
import { FLOOR_LOOKS } from '@/config/floorLooks';
import { FLOORS_TOTAL, LEVELS, floorDisplayName, floorOf, nextDoors } from '@/config/worldgraph';
import { PhialRow } from '@/ui/phialGlyph';

/**
 * The Sanctum (upgrade-port meta layer): a paused rest stop between depths.
 * Touch the open portal and the old ones offer a bargain — draft one of three
 * boons, spend gold on provisions, then descend. Gameplay freezes underneath
 * (ctx.state.paused); rendering keeps breathing.
 */

interface SanctumPerk {
  id: string;
  /** Stored on player.perks; absent for instant boons (repeatable by design). */
  flag?: PerkId;
  name: string;
  desc: string;
  apply(ctx: Ctx): void;
}

const PERKS: SanctumPerk[] = [
  {
    id: 'vitality',
    name: 'Vitality',
    desc: '+30 max HP, fully restored',
    apply: (ctx) => {
      ctx.player.maxHp += 30;
      ctx.player.hp = ctx.player.maxHp;
    },
  },
  ...SANCTUM_PERK_DEFS.map((perk) => ({
    id: perk.id,
    flag: perk.id,
    name: perk.sanctumName,
    desc: perk.desc,
    apply: () => undefined,
  })),
];

function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/** 'The Cold Store' reads 'the Cold Store' on a button. */
function midName(name: string): string {
  return name.startsWith('The ') ? 'the ' + name.slice(4) : name;
}

export class Sanctum implements SanctumApi {
  private _open = false;
  private onDescend: ((nextLevelId: string) => void) | null = null;
  /** The door the alchemist has picked (the only door, where there is one). */
  private chosen: string | null = null;
  private fallbackNext: string | null = null;
  private readonly doorButtons: HTMLButtonElement[] = [];
  /** Re-arms the descend button after a boon or a door is chosen. */
  private rearm: (() => void) | null = null;
  private readonly onDescendClick = (): void => this.close();
  /** Pause state we found on open, so close() restores it rather than force-resuming a pause we didn't take. */
  private wasPaused = false;
  /** Between floors: a look at the floor below, and the phial the old ones pour. */
  private readonly teaser = document.createElement('section');
  private readonly phials = new PhialRow(3, 'phial-row sanc-phial-row');
  private readonly phialNote = document.createElement('p');
  private phialTimer: number | null = null;

  constructor(private ctx: Ctx) {
    el('descend-btn').addEventListener('click', this.onDescendClick);
    this.teaser.className = 'sanc-teaser';
    this.teaser.hidden = true;
    document.querySelector('#sanctum-overlay .sanc-body')?.prepend(this.teaser);
  }

  dispose(): void {
    el('descend-btn').removeEventListener('click', this.onDescendClick);
    if (this.phialTimer !== null) window.clearTimeout(this.phialTimer);
    this.phials.dispose();
    this.teaser.remove();
  }

  private static facts(signature: string, resident: string): HTMLDListElement {
    const facts = document.createElement('dl');
    facts.className = 'sanc-below-facts';
    for (const [term, text] of [['Signature', signature], ['In residence', resident]] as const) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = text;
      facts.append(dt, dd);
    }
    return facts;
  }

  /**
   * THE DOORS (the branching descent): the floor below offers two, side by
   * side, each with its teaser — the name, the epigraph its title card will
   * carry, the chemistry it is built around and who lives there. A door
   * nobody has walked through yet says so. Choosing one lights it; the
   * descend button waits for a boon and a door.
   */
  private renderDoors(ctx: Ctx, doors: readonly string[], floor: number): HTMLElement {
    const seen = new Set(ctx.run?.metaView().levelsSeen ?? []);
    const block = document.createElement('div');
    block.className = 'sanc-below sanc-below-doors';
    const label = document.createElement('p');
    label.className = 'menu-label';
    label.textContent = `Below · Floor ${floor} of ${FLOORS_TOTAL} · two doors`;
    const row = document.createElement('div');
    row.className = 'sanc-doors';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Choose a door');
    this.doorButtons.length = 0;
    doors.forEach((id, i) => {
      const def = LEVELS[id];
      const lore = FLOOR_LORE[id];
      const door = document.createElement('button');
      door.type = 'button';
      door.className = 'sanc-door';
      door.dataset.level = id;
      door.setAttribute('aria-pressed', 'false');
      const head = document.createElement('p');
      head.className = 'sanc-door-label';
      head.textContent = i === 0 ? 'Left-hand stair' : 'Right-hand stair';
      if (!seen.has(id)) {
        const tag = document.createElement('span');
        tag.className = 'sanc-door-new';
        tag.textContent = 'Unwalked';
        head.append(tag);
      }
      const name = document.createElement('h3');
      name.className = 'sanc-below-name';
      name.textContent = floorDisplayName(id);
      const epigraph = document.createElement('p');
      epigraph.className = 'sanc-below-line';
      epigraph.textContent = def ? FLOOR_LOOKS[def.biome].epigraph : '';
      door.append(head, name, epigraph);
      if (lore) door.append(Sanctum.facts(lore.signature, lore.resident));
      door.addEventListener('click', () => this.chooseDoor(ctx, id));
      // Matron Ash has a word about each door as the apprentice looks at it.
      if (def) {
        door.addEventListener('pointerenter', () => { if (this._open) ctx.story?.sanctumDoor(def.biome); });
        door.addEventListener('focus', () => { if (this._open) ctx.story?.sanctumDoor(def.biome); });
      }
      this.doorButtons.push(door);
      row.append(door);
    });
    block.append(label, row);
    return block;
  }

  private chooseDoor(ctx: Ctx, id: string): void {
    if (!this._open || this.chosen === id) return;
    this.chosen = id;
    for (const b of this.doorButtons) {
      const on = b.dataset.level === id;
      b.classList.toggle('chosen', on);
      b.classList.toggle('passed', !on);
      b.setAttribute('aria-pressed', String(on));
    }
    ctx.audio.sfx('ui.card.choose');
    ctx.telemetry.count(`sanctum.door.${id}`);
    const def = LEVELS[id];
    if (def) ctx.story?.sanctumDoor(def.biome);
    this.rearm?.();
  }

  /**
   * The floor below, in the house voice, and the return phials: the old ones
   * top one up on the way down (RunDirector owns the count; this shows it).
   * Where the floor below has two doors, both are shown and one is chosen.
   */
  private renderTeaser(ctx: Ctx, doors: readonly string[]): void {
    const nextId = doors[0] ?? null;
    const lore = nextId ? FLOOR_LORE[nextId] : undefined;
    const floor = floorOf(nextId);
    this.teaser.hidden = !lore || floor <= 0;
    this.teaser.classList.toggle('two-doors', doors.length > 1);
    if (!lore || !nextId || floor <= 0) return;
    let below: HTMLElement;
    if (doors.length > 1) {
      below = this.renderDoors(ctx, doors, floor);
    } else {
      below = document.createElement('div');
      below.className = 'sanc-below';
      const label = document.createElement('p');
      label.className = 'menu-label';
      label.textContent = `Below · Floor ${floor} of ${FLOORS_TOTAL}`;
      const name = document.createElement('h3');
      name.className = 'sanc-below-name';
      name.textContent = floorDisplayName(nextId);
      const line = document.createElement('p');
      line.className = 'sanc-below-line';
      line.textContent = lore.line;
      below.append(label, name, line, Sanctum.facts(lore.signature, lore.resident));
    }

    const run = ctx.run;
    const vial = document.createElement('div');
    vial.className = 'sanc-phials';
    const vialLabel = document.createElement('p');
    vialLabel.className = 'menu-label';
    vialLabel.textContent = 'Return phials';
    this.phialNote.className = 'sanc-phial-note';
    vial.append(vialLabel, this.phials.root, this.phialNote);
    vial.hidden = !run?.active;
    this.teaser.replaceChildren(below, vial);
    if (!run?.active) return;
    const restored = run.restorePhial(ctx, 'sanctum');
    const max = run.maxPhials;
    if (this.phialTimer !== null) window.clearTimeout(this.phialTimer);
    if (restored) {
      // The glass shows as it was, then the old ones pour.
      this.phials.set(run.phials - 1, max);
      this.phialNote.textContent = 'The old ones top up a return phial. No charge; they insist.';
      this.phialTimer = window.setTimeout(() => {
        this.phialTimer = null;
        this.phials.fill(run.phials - 1, run.phials, max);
      }, 260);
    } else {
      this.phials.set(run.phials, max);
      this.phialNote.textContent = 'Your phials are full. The old ones nod, approvingly.';
    }
  }

  get isOpen(): boolean {
    return this._open;
  }

  open(ctx: Ctx, onDescend: (nextLevelId: string) => void): void {
    if (this._open) return;
    this._open = true;
    this.onDescend = onDescend;
    this.wasPaused = ctx.state.paused;
    ctx.state.paused = true;

    const currentId = ctx.levels.current?.def.id ?? null;
    const doors = nextDoors(currentId).filter((id) => LEVELS[id]);
    const nextId = doors[0] ?? ctx.levels.current?.def.nextLevelId ?? null;
    this.fallbackNext = nextId;
    this.chosen = doors.length > 1 ? null : nextId;
    const nextFloor = floorOf(nextId);
    const depth = nextFloor > 0 ? nextFloor : (ctx.levels.current?.def.depth ?? 0) + 1;
    el('sanc-depth').textContent = nextFloor > 0 ? `${nextFloor} of ${FLOORS_TOTAL}` : String(depth);
    el('sanc-gold').textContent = String(ctx.state.score);
    this.doorButtons.length = 0;
    this.renderTeaser(ctx, doors.length > 0 ? doors : nextId ? [nextId] : []);
    // STORY: Matron Ash greets the apprentice and says a word about the door
    // below — where there are two, about each as he looks at it (sanctumDoor).
    ctx.story?.sanctumOpened(doors.length <= 1 && nextId && LEVELS[nextId] ? LEVELS[nextId].biome : null);

    const dBtn = el('descend-btn') as HTMLButtonElement;
    const row = el('perk-row');
    row.innerHTML = '';
    // 3 boons the alchemist doesn't own yet (instant boons can repeat)
    const pool = PERKS.filter((pk) => !pk.flag || !ctx.player.perks[pk.flag]);
    const offer: SanctumPerk[] = [];
    while (offer.length < 3 && pool.length) {
      offer.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    let perkTaken = offer.length === 0;
    const armDescend = (): void => {
      const target = this.chosen;
      if (perkTaken && target) {
        const name = LEVELS[target] ? floorDisplayName(target) : `depth ${depth}`;
        dBtn.disabled = false;
        dBtn.textContent = 'Descend to ' + midName(name);
      } else {
        dBtn.disabled = true;
        dBtn.textContent = !perkTaken && !target
          ? 'Choose a boon and a door'
          : !perkTaken ? 'Choose a boon to descend' : 'Choose a door to descend';
      }
    };
    this.rearm = armDescend;
    armDescend();
    const cards: HTMLButtonElement[] = [];
    for (const pk of offer) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'perk-card';
      const name = document.createElement('div');
      name.className = 'pk-name';
      name.textContent = pk.name;
      const desc = document.createElement('div');
      desc.className = 'pk-desc';
      desc.textContent = pk.desc;
      card.append(name, desc);
      card.addEventListener('click', () => {
        if (perkTaken) return;
        perkTaken = true;
        for (const button of cards) button.disabled = true;
        if (pk.flag) ctx.player.perks[pk.flag] = true;
        pk.apply(ctx);
        ctx.audio.learn();
        ctx.telemetry.count('perk.' + pk.id);
        card.classList.add('taken');
        row.querySelectorAll('.perk-card').forEach((c) => {
          if (c !== card) c.classList.add('faded');
        });
        perkTaken = true;
        armDescend();
      });
      cards.push(card);
      row.appendChild(card);
    }

    this.buildShop(ctx);
    el('sanctum-overlay').classList.add('visible');
  }

  /** The Refuge shrine's trade: shop only — boons are bargained at the portal. */
  openShop(ctx: Ctx): void {
    if (this._open) return;
    this._open = true;
    this.onDescend = null;
    this.rearm = null;
    this.chosen = null;
    this.wasPaused = ctx.state.paused;
    ctx.state.paused = true;
    this.teaser.hidden = true;
    const here = floorOf(ctx.levels.current?.def.id);
    el('sanc-depth').textContent = here > 0 ? `${here} of ${FLOORS_TOTAL}` : String(ctx.levels.current?.def.depth ?? 1);
    el('sanc-gold').textContent = String(ctx.state.score);
    const dBtn = el('descend-btn') as HTMLButtonElement;
    dBtn.disabled = false;
    dBtn.textContent = 'Return to the depths';
    el('perk-row').innerHTML =
      '<div class="sanc-note">The old ones only trade here. Boons are bargained at the exit portal, between depths.</div>';
    this.buildShop(ctx);
    el('sanctum-overlay').classList.add('visible');
  }

  private buildShop(ctx: Ctx): void {
    const shop = el('sanc-shop');
    shop.innerHTML = '';
    const items: Array<{ name: string; desc: string; cost: number; act(purchase: () => boolean): void }> = [
      {
        name: 'Mend wounds',
        desc: 'Restore your health to full',
        cost: 40,
        act: (purchase) => {
          if (!purchase()) return;
          ctx.player.hp = ctx.player.maxHp;
        },
      },
      {
        name: 'Toughen up',
        desc: '+15 maximum health, and healed by as much',
        cost: 90,
        act: (purchase) => {
          if (!purchase()) return;
          ctx.player.maxHp += 15;
          ctx.player.hp += 15;
        },
      },
      {
        name: 'Mystery brew',
        desc: 'Drink a random potent draught, right now',
        cost: 60,
        act: (purchase) => {
          if (!purchase()) return;
          const id = POTION_KINDS[Math.floor(Math.random() * POTION_KINDS.length)];
          const def = POTION_DEFS[id];
          const st = ctx.player.status;
          st[def.status] = Math.min(1800, st[def.status] + def.frames * 1.5);
          ctx.events.emit('toast', { text: def.name });
          ctx.audio.drinkPotion();
        },
      },
      // Wandwright: the gold sink that finally hands out the better frames.
      // Each offer disappears once any wand carries the frame.
      ...(ctx.wands.wands.some((w) => w.frame.id === 'brass')
        ? []
        : [
            {
              name: 'Wandwright: Brass Injector',
              desc: 'Refit wand I: 5 slots, a fast cycle and a deep mana tank',
              cost: 240,
              act: (purchase: () => boolean): void => {
                if (!purchase()) return;
                ctx.wands.upgradeFrame(ctx, 0, 'brass');
                this.buildShop(ctx);
              },
            },
          ]),
      ...(ctx.wands.wands.some((w) => w.frame.id === 'void')
        ? []
        : [
            {
              name: 'Wandwright: Void Lattice',
              desc: 'Refit wand II: 5 slots, perfect aim and vast mana',
              cost: 380,
              act: (purchase: () => boolean): void => {
                if (!purchase()) return;
                ctx.wands.upgradeFrame(ctx, 1, 'void');
                this.buildShop(ctx);
              },
            },
          ]),
      {
        name: 'Lost pages',
        desc: 'Choose one of three spell cards you do not own',
        cost: 160,
        act: (purchase) => {
          const pool = withDiscoveredCards(SANCTUM_LOST_PAGES_POOL, getDiscoveredCards());
          const cards = buildCardOffer(pool, collectOwnedCards(ctx.wands), { ensureKind: 'projectile' });
          requestCardOffer(ctx, {
            source: 'sanctum',
            title: 'Lost pages',
            prompt: 'Choose one page to keep. You pay only if you take one.',
            cards,
            onChoose: (card: CardId) => {
              if (!purchase()) return;
              ctx.wands.grantCard(ctx, card);
              ctx.audio.learn();
            },
          });
        },
      },
    ];
    for (const it of items) {
      const rowEl = document.createElement('div');
      rowEl.className = 'shop-row';
      const canAfford = ctx.state.score >= it.cost;
      rowEl.classList.toggle('unaffordable', !canAfford);
      rowEl.innerHTML =
        '<div class="sh-info"><div class="sh-name">' +
        it.name +
        '</div><div class="sh-desc">' +
        it.desc +
        '</div></div><button' +
        (canAfford ? '' : ' disabled title="Not enough gold"') +
        ' aria-label="Buy ' + it.name + ' for ' + it.cost + ' gold">' +
        it.cost +
        ' oz</button>';
      rowEl.querySelector('button')!.addEventListener('click', () => {
        if (ctx.state.score < it.cost) return;
        let purchased = false;
        const purchase = (): boolean => {
          if (purchased || ctx.state.score < it.cost) return false;
          purchased = true;
          ctx.state.score -= it.cost;
          ctx.events.emit('scoreChanged', { score: ctx.state.score });
          ctx.audio.sfx('ui.coins');
          el('sanc-gold').textContent = String(ctx.state.score);
          this.buildShop(ctx);
          return true;
        };
        it.act(purchase);
      });
      shop.appendChild(rowEl);
    }
  }

  private close(): void {
    if (!this._open) return;
    this._open = false;
    el('sanctum-overlay').classList.remove('visible');
    this.ctx.state.paused = this.wasPaused;
    const go = this.onDescend;
    const door = this.chosen ?? this.fallbackNext ?? '';
    this.onDescend = null;
    this.rearm = null;
    this.chosen = null;
    this.fallbackNext = null;
    this.doorButtons.length = 0;
    go?.(door);
  }

  /** The door picked so far (null until one is, where the floor below has two). */
  get chosenDoor(): string | null {
    return this._open ? this.chosen : null;
  }
}

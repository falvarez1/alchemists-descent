import {
  buildCardOffer,
  collectOwnedCards,
  requestCardOffer,
  SANCTUM_LOST_PAGES_POOL,
} from '@/combat/wands/rewardPools';
import type { CardId, Ctx, PerkId, SanctumApi } from '@/core/types';
import { POTION_DEFS, POTION_KINDS } from '@/core/pickupDefs';
import { SANCTUM_PERK_DEFS } from '@/content/perks';

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

export class Sanctum implements SanctumApi {
  private _open = false;
  private onDescend: (() => void) | null = null;
  private readonly onDescendClick = (): void => this.close();
  /** Pause state we found on open, so close() restores it rather than force-resuming a pause we didn't take. */
  private wasPaused = false;

  constructor(private ctx: Ctx) {
    el('descend-btn').addEventListener('click', this.onDescendClick);
  }

  dispose(): void {
    el('descend-btn').removeEventListener('click', this.onDescendClick);
  }

  get isOpen(): boolean {
    return this._open;
  }

  open(ctx: Ctx, onDescend: () => void): void {
    if (this._open) return;
    this._open = true;
    this.onDescend = onDescend;
    this.wasPaused = ctx.state.paused;
    ctx.state.paused = true;

    const depth = (ctx.levels.current?.def.depth ?? 0) + 1;
    el('sanc-depth').textContent = String(depth);
    el('sanc-gold').textContent = String(ctx.state.score);

    const dBtn = el('descend-btn') as HTMLButtonElement;
    const row = el('perk-row');
    row.innerHTML = '';
    // 3 boons the alchemist doesn't own yet (instant boons can repeat)
    const pool = PERKS.filter((pk) => !pk.flag || !ctx.player.perks[pk.flag]);
    const offer: SanctumPerk[] = [];
    while (offer.length < 3 && pool.length) {
      offer.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    let perkTaken = false;
    const armDescend = (): void => {
      dBtn.disabled = false;
      dBtn.textContent = 'DESCEND TO DEPTH ' + depth;
    };
    if (offer.length === 0) armDescend();
    else {
      dBtn.disabled = true;
      dBtn.textContent = 'CHOOSE A BOON TO DESCEND';
    }
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
    this.wasPaused = ctx.state.paused;
    ctx.state.paused = true;
    el('sanc-depth').textContent = String(ctx.levels.current?.def.depth ?? 1);
    el('sanc-gold').textContent = String(ctx.state.score);
    const dBtn = el('descend-btn') as HTMLButtonElement;
    dBtn.disabled = false;
    dBtn.textContent = 'RETURN TO THE DEPTHS';
    el('perk-row').innerHTML =
      '<div class="sanc-note">THE OLD ONES ONLY TRADE HERE — BOONS ARE BARGAINED AT THE PORTAL.</div>';
    this.buildShop(ctx);
    el('sanctum-overlay').classList.add('visible');
  }

  private buildShop(ctx: Ctx): void {
    const shop = el('sanc-shop');
    shop.innerHTML = '';
    const items: Array<{ name: string; desc: string; cost: number; act(purchase: () => boolean): void }> = [
      {
        name: 'MEND WOUNDS',
        desc: 'Restore to full HP',
        cost: 40,
        act: (purchase) => {
          if (!purchase()) return;
          ctx.player.hp = ctx.player.maxHp;
        },
      },
      {
        name: 'TOUGHEN UP',
        desc: '+15 max HP',
        cost: 90,
        act: (purchase) => {
          if (!purchase()) return;
          ctx.player.maxHp += 15;
          ctx.player.hp += 15;
        },
      },
      {
        name: 'MYSTERY BREW',
        desc: 'Drink a random potent draught',
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
              name: 'WANDWRIGHT: BRASS INJECTOR',
              desc: 'Refit wand I — 5 slots, fast cycle, deep tanks',
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
              name: 'WANDWRIGHT: VOID LATTICE',
              desc: 'Refit wand II — 5 slots, perfect aim, vast mana',
              cost: 380,
              act: (purchase: () => boolean): void => {
                if (!purchase()) return;
                ctx.wands.upgradeFrame(ctx, 1, 'void');
                this.buildShop(ctx);
              },
            },
          ]),
      {
        name: 'LOST PAGES',
        desc: 'Choose one of three unknown spell cards',
        cost: 160,
        act: (purchase) => {
          const cards = buildCardOffer(SANCTUM_LOST_PAGES_POOL, collectOwnedCards(ctx.wands), { ensureKind: 'projectile' });
          requestCardOffer(ctx, {
            source: 'sanctum',
            title: 'LOST PAGES',
            prompt: 'Choose one page',
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
      rowEl.innerHTML =
        '<div class="sh-info"><div class="sh-name">' +
        it.name +
        '</div><div class="sh-desc">' +
        it.desc +
        '</div></div><button' +
        (canAfford ? '' : ' disabled') +
        '>' +
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
          ctx.audio.coin();
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
    this.onDescend = null;
    go?.();
  }
}

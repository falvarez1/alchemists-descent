import { ALL_CARD_IDS } from '@/combat/wands/cards';
import type { CardId, Ctx, PerkId, SanctumApi } from '@/core/types';
import { POTION_DEFS, POTION_KINDS } from '@/game/Pickups';

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
  { id: 'manafont', flag: 'manafont', name: 'Mana Font', desc: 'Wand mana regenerates 60% faster', apply: () => {} },
  { id: 'featherweight', flag: 'featherweight', name: 'Featherweight', desc: 'Levitation drains 45% slower', apply: () => {} },
  { id: 'ironhide', flag: 'ironhide', name: 'Blast Shield', desc: 'Explosions deal 60% less to you', apply: () => {} },
  { id: 'flameward', flag: 'flameward', name: 'Pyro Skin', desc: 'Fire and lava deal 60% less; you cannot catch fire', apply: () => {} },
  { id: 'toxinward', flag: 'toxinward', name: 'Toxicology', desc: 'Acid and toxin deal 75% less', apply: () => {} },
  { id: 'vampirism', flag: 'vampirism', name: 'Vampirism', desc: 'Kills restore 2 HP', apply: () => {} },
  { id: 'goldmagnet', flag: 'goldmagnet', name: 'Gold Sense', desc: 'Your gold pull reaches much further', apply: () => {} },
  { id: 'swiftfoot', flag: 'swiftfoot', name: 'Swift Soles', desc: 'Move 18% faster', apply: () => {} },
  { id: 'might', flag: 'might', name: 'Power Surge', desc: 'All spell damage +25%', apply: () => {} },
];

const SANCTUM_CARD_POOL = ALL_CARD_IDS.filter((id) => id !== 'vitrify');

function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

export class Sanctum implements SanctumApi {
  private _open = false;
  private onDescend: (() => void) | null = null;

  constructor(private ctx: Ctx) {
    el('descend-btn').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return this._open;
  }

  open(ctx: Ctx, onDescend: () => void): void {
    if (this._open) return;
    this._open = true;
    this.onDescend = onDescend;
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
    for (const pk of offer) {
      const card = document.createElement('div');
      card.className = 'perk-card';
      card.innerHTML =
        '<div class="pk-name">' + pk.name + '</div><div class="pk-desc">' + pk.desc + '</div>';
      card.addEventListener('click', () => {
        if (perkTaken) return;
        perkTaken = true;
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
    const items: Array<{ name: string; desc: string; cost: number; act(): void }> = [
      {
        name: 'MEND WOUNDS',
        desc: 'Restore to full HP',
        cost: 40,
        act: () => {
          ctx.player.hp = ctx.player.maxHp;
        },
      },
      {
        name: 'TOUGHEN UP',
        desc: '+15 max HP',
        cost: 90,
        act: () => {
          ctx.player.maxHp += 15;
          ctx.player.hp += 15;
        },
      },
      {
        name: 'MYSTERY BREW',
        desc: 'Drink a random potent draught',
        cost: 60,
        act: () => {
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
              act: (): void => {
                ctx.wands.upgradeFrame(ctx, 0, 'brass');
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
              act: (): void => {
                ctx.wands.upgradeFrame(ctx, 1, 'void');
              },
            },
          ]),
      {
        name: 'LOST PAGES',
        desc: 'Learn a random unknown spell card',
        cost: 160,
        act: () => {
          const owned = new Set<CardId>(ctx.wands.collection);
          for (const w of ctx.wands.wands) for (const c of w.cards) if (c) owned.add(c);
          const unknown = SANCTUM_CARD_POOL.filter((c) => !owned.has(c));
          const pick = unknown.length
            ? unknown[Math.floor(Math.random() * unknown.length)]
            : SANCTUM_CARD_POOL[Math.floor(Math.random() * SANCTUM_CARD_POOL.length)];
          ctx.wands.grantCard(ctx, pick);
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
        ctx.state.score -= it.cost;
        ctx.events.emit('scoreChanged', { score: ctx.state.score });
        it.act();
        ctx.audio.coin();
        el('sanc-gold').textContent = String(ctx.state.score);
        this.buildShop(ctx);
      });
      shop.appendChild(rowEl);
    }
  }

  private close(): void {
    if (!this._open) return;
    this._open = false;
    el('sanctum-overlay').classList.remove('visible');
    this.ctx.state.paused = false;
    const go = this.onDescend;
    this.onDescend = null;
    go?.();
  }
}

import type { Ctx } from '@/core/types';
import { CARD_DEFS } from '@/combat/wands/cards';
import { COLOR_FN, unpackB, unpackG, unpackR } from '@/sim/colors';
import { cardIconName, makeIconCanvas } from '@/ui/icons';

/** Non-null getElementById — all HUD elements exist statically in index.html. */
function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

// ===================== HUD =====================
/**
 * Play-mode heads-up display: vitals bars, gold readout, spell hotbar,
 * wave banner, damage vignette and the game-over overlay.
 *
 * Gameplay systems never touch the DOM — they emit events on the bus and
 * the Hud (constructed after all systems exist) subscribes here.
 */
export class Hud {
  /** Last flask material rendered (undefined = never rendered), so the palette lookup runs once per change. */
  private flaskMaterial: number | null | undefined = undefined;
  /** Filled hotbar tiles + their card mana costs, rebuilt by buildHotbar. */
  private hotbarSlots: Array<{ tile: HTMLElement; cost: number }> = [];

  constructor(private ctx: Ctx) {
    ctx.events.on('scoreChanged', ({ score }) => {
      el('score-val').textContent = String(score);
      el('hud-gold').textContent = String(score);
    });

    ctx.events.on('waveStarted', ({ num }) => {
      el('wave-num').textContent = 'WAVE ' + num;
    });

    ctx.events.on('waveBanner', ({ big, small }) => this.showBanner(big, small));

    // The descent: depth readout + arrival banner whenever a level is entered.
    ctx.events.on('levelChanged', ({ depth, name }) => {
      el('wave-num').textContent = 'D' + depth;
      this.showBanner('D' + depth + ' — ' + name, 'THE DESCENT CONTINUES');
    });

    ctx.events.on('waystoneLit', () => {
      this.showBanner('WAYSTONE LIT', 'CHECKPOINT SET — VITALS RESTORED');
    });

    ctx.events.on('recipeDiscovered', ({ name, bounty }) => {
      this.showBanner(name + ' BREWED', 'GRIMOIRE UPDATED — +' + bounty + ' oz');
    });

    // Wandsmith: a found card announces itself; the bench (B) slots it.
    ctx.events.on('cardGranted', ({ name }) => {
      this.showBanner(name + ' ACQUIRED', 'NEW SPELL CARD — PRESS B');
    });

    // The hotbar mirrors the active wand; any loadout change rebuilds it.
    ctx.events.on('wandChanged', () => this.buildHotbar());

    ctx.events.on('enemiesLeft', ({ count }) => {
      el('enemies-left').textContent = String(count);
    });

    ctx.events.on('playerDied', ({ wave, gold }) => {
      el('go-wave').textContent = 'WAVE ' + wave;
      el('go-gold').textContent = String(gold);
      el('gameover-overlay').classList.add('visible');
    });

    ctx.events.on('playerRespawned', () => {
      el('gameover-overlay').classList.remove('visible');
    });

    ctx.events.on('modeChanged', ({ mode }) => {
      el('mode-build-btn').classList.toggle('active', mode === 'build');
      el('mode-play-btn').classList.toggle('active', mode === 'play');
      el('game-hud').classList.toggle('visible', mode === 'play');
      document.body.classList.toggle('play-active', mode === 'play');
      if (mode !== 'play') el('damage-vignette').style.opacity = '0';
      this.buildHotbar();
    });

    el('respawn-btn').addEventListener('click', () => { ctx.audio.ensure(); ctx.playerCtl.respawn(); });
  }

  private showBanner(big: string, small: string): void {
    el('banner-big').textContent = big;
    el('banner-small').textContent = small;
    const banner = el('wave-banner');
    banner.classList.add('show');
    setTimeout(() => banner.classList.remove('show'), 2200);
  }

  /**
   * Wandsmith (Wave D): the play-mode hotbar mirrors the ACTIVE WAND — its
   * name as a label, then one tile per frame slot (empty = dim). Cards are
   * not selectable in play (the program runs left-to-right; the bench owns
   * editing), so the tiles carry no click handlers and no digit keys.
   */
  buildHotbar(): void {
    const bar = el('spell-hotbar');
    bar.innerHTML = '';
    this.hotbarSlots = [];

    const wands = this.ctx.wands;
    const wand = wands.wands[wands.active];

    const label = document.createElement('div');
    label.className = 'wand-label';
    label.textContent = wand.frame.name;
    bar.appendChild(label);

    const row = document.createElement('div');
    row.className = 'wand-slots';
    wand.cards.forEach((id) => {
      const slot = document.createElement('div');
      slot.className = 'hot-slot';
      if (id === null) {
        slot.classList.add('empty');
        slot.title = 'Empty slot';
      } else {
        const def = CARD_DEFS[id];
        slot.title = def.name + ' — ' + def.manaCost + ' mana';
        const icon = makeIconCanvas(cardIconName(id), 3);
        if (icon) slot.appendChild(icon);
        const cost = document.createElement('div'); cost.className = 'cost'; cost.textContent = String(def.manaCost);
        slot.appendChild(cost);
        this.hotbarSlots.push({ tile: slot, cost: def.manaCost });
      }
      row.appendChild(slot);
    });
    bar.appendChild(row);
  }

  update(ctx: Ctx): void {
    const player = ctx.player;
    el('hp-fill').style.width = Math.max(0, (player.hp / player.maxHp) * 100) + '%';
    // player.mana mirrors the active wand's tank (WandSystem guarantee), so
    // the mana bar tracks the wand with no extra wiring here.
    el('mana-fill').style.width = Math.max(0, (player.mana / player.maxMana) * 100) + '%';
    el('levit-fill').style.width = Math.max(0, (player.levit / player.maxLevit) * 100) + '%';
    el('hud-gold').textContent = String(ctx.state.score);

    const flask = ctx.flask.state;
    const flaskFill = el('flask-fill');
    flaskFill.style.width = Math.max(0, (flask.count / flask.capacity) * 100) + '%';
    if (flask.material !== this.flaskMaterial) {
      this.flaskMaterial = flask.material;
      if (flask.material === null) {
        flaskFill.style.backgroundColor = '';
        flaskFill.title = 'Empty flask';
      } else {
        const c = COLOR_FN[flask.material]();
        flaskFill.style.backgroundColor = 'rgb(' + unpackR(c) + ', ' + unpackG(c) + ', ' + unpackB(c) + ')';
        flaskFill.title = ctx.params.materials[flask.material]?.name ?? 'Unknown material';
      }
    }

    const hurt = 1 - (player.hp / player.maxHp);
    el('damage-vignette').style.opacity = String(player.dead ? 0.85 : Math.max(0, (hurt - 0.4) * 1.3));

    for (const s of this.hotbarSlots) {
      s.tile.classList.toggle('unaffordable', player.mana < s.cost);
    }
  }
}

import type { Ctx } from '@/core/types';
import { SPELL_ORDER } from '@/config/params';
import { makeIconCanvas } from '@/ui/icons';

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
  constructor(private ctx: Ctx) {
    ctx.events.on('scoreChanged', ({ score }) => {
      el('score-val').textContent = String(score);
      el('hud-gold').textContent = String(score);
    });

    ctx.events.on('waveStarted', ({ num }) => {
      el('wave-num').textContent = 'WAVE ' + num;
    });

    ctx.events.on('waveBanner', ({ big, small }) => this.showBanner(big, small));

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

  buildHotbar(): void {
    const bar = el('spell-hotbar');
    bar.innerHTML = '';
    SPELL_ORDER.forEach((key, i) => {
      const sp = this.ctx.params.spells[key];
      const slot = document.createElement('div');
      slot.className = 'hot-slot';
      slot.id = 'hot-' + key;
      slot.title = sp.name + ' — ' + sp.manaCost + ' mana';
      const k = document.createElement('div'); k.className = 'key'; k.textContent = String(i + 1);
      const cost = document.createElement('div'); cost.className = 'cost'; cost.textContent = String(sp.manaCost);
      const icon = makeIconCanvas(key, 3);
      slot.appendChild(k);
      if (icon) slot.appendChild(icon);
      slot.appendChild(cost);
      slot.addEventListener('click', () => { this.ctx.player.spell = key; this.ctx.input.bombCharge = -1; });
      bar.appendChild(slot);
    });
  }

  update(ctx: Ctx): void {
    const player = ctx.player;
    el('hp-fill').style.width = Math.max(0, (player.hp / player.maxHp) * 100) + '%';
    el('mana-fill').style.width = Math.max(0, (player.mana / player.maxMana) * 100) + '%';
    el('levit-fill').style.width = Math.max(0, (player.levit / player.maxLevit) * 100) + '%';
    el('hud-gold').textContent = String(ctx.state.score);

    const hurt = 1 - (player.hp / player.maxHp);
    el('damage-vignette').style.opacity = String(player.dead ? 0.85 : Math.max(0, (hurt - 0.4) * 1.3));

    SPELL_ORDER.forEach(key => {
      const slot = document.getElementById('hot-' + key);
      if (!slot) return;
      slot.classList.toggle('selected', player.spell === key);
      slot.classList.toggle('unaffordable', player.mana < ctx.params.spells[key].manaCost);
    });
  }
}

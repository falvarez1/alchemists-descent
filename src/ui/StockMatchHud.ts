import type { Ctx } from '@/core/types';
import { FIGHTER_DEFS, fighterPortraitUrl } from '@/content/fighters';

/** Player-facing stock readout; the existing arena panel remains the training control. */
export class StockMatchHud {
  private readonly root = document.createElement('div');
  private readonly timer = document.createElement('div');
  private readonly message = document.createElement('div');
  private readonly rematch = document.createElement('button');
  private readonly offs: Array<() => void> = [];
  private readonly cards: Array<{ root: HTMLElement; portrait: HTMLImageElement; name: HTMLElement; percent: HTMLElement; stocks: HTMLElement; fuel: HTMLMeterElement }> = [];

  constructor(private readonly ctx: Ctx, onRematch: () => void) {
    this.offs.push(ctx.events.on('levelChanged', () => this.update()), ctx.events.on('modeChanged', () => this.update()));
    this.root.id = 'stock-match-hud';
    this.root.hidden = true;
    this.timer.className = 'stock-timer';
    this.message.className = 'stock-message';
    this.message.setAttribute('role', 'status');
    this.rematch.className = 'stock-rematch';
    this.rematch.type = 'button'; this.rematch.textContent = 'Rematch';
    this.rematch.addEventListener('click', () => { this.rematch.blur(); onRematch(); });
    this.root.append(this.timer, this.message, this.rematch);
    const hint = document.createElement('div'); hint.className = 'stock-controls';
    hint.textContent = 'Space: jump / levitate   ·   Up + Space in air: recovery burst   ·   Aim + fire: build volatility';
    this.root.append(hint);
    for (let slot = 0; slot < 2; slot++) {
      const root = document.createElement('div'), name = document.createElement('div');
      const percent = document.createElement('strong'), stocks = document.createElement('div'), fuel = document.createElement('meter');
      const portrait = document.createElement('img');
      portrait.className = 'stock-portrait'; portrait.alt = ''; portrait.hidden = true;
      root.className = `stock-fighter stock-fighter-${slot}`;
      name.className = 'stock-name'; percent.className = 'stock-percent'; stocks.className = 'stock-lives';
      fuel.min = 0; fuel.max = 1; fuel.setAttribute('aria-label', `Player ${slot + 1} recovery fuel`);
      root.append(portrait, name, percent, stocks, fuel); this.root.append(root);
      this.cards.push({ root, portrait, name, percent, stocks, fuel });
    }
    (document.getElementById('canvas-holder') ?? document.body).append(this.root);
  }

  update(): void {
    const arena = this.ctx.arena, match = arena?.stockMatch;
    const visible = !!match && this.ctx.levels.current?.def.id === 'fighter-duel' && this.ctx.state.mode === 'play';
    this.root.hidden = !visible;
    document.body.classList.toggle('stock-match', visible);
    if (!visible || !match || !arena) return;
    const seconds = Math.ceil(match.remainingTicks / 60);
    this.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    this.timer.setAttribute('aria-label', `${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds remaining`);
    for (let slot = 0; slot < 2; slot++) {
      const card = this.cards[slot], f = match.fighters[slot], b = arena.bundle(slot);
      const id = arena.fighterId(slot);
      card.portrait.hidden = !id;
      if (id && card.portrait.dataset.fighter !== id) {
        card.portrait.src = fighterPortraitUrl(id); card.portrait.dataset.fighter = id;
      }
      card.name.textContent = `P${slot + 1}  ${id ? FIGHTER_DEFS[id].name : slot === 0 ? 'Alchemist' : 'Add a rival'}`;
      card.percent.textContent = `${Math.round(f?.volatility ?? 0)}%`;
      card.percent.dataset.danger = (f?.volatility ?? 0) >= 100 ? 'true' : 'false';
      card.stocks.textContent = f ? '●'.repeat(f.stocks) + '○'.repeat(Math.max(0, 3 - f.stocks)) : '○ ○ ○';
      card.stocks.setAttribute('aria-label', `${f?.stocks ?? 0} stocks remaining`);
      card.fuel.value = b ? b.player.levit / Math.max(1, b.player.maxLevit) : 1;
    }
    let message = '';
    if (match.state === 'idle') message = 'Choose a rival to begin';
    if (match.state === 'countdown') message = String(Math.ceil(match.countdown / 60));
    if (match.state === 'finished') {
      const id = match.winner !== null ? arena.fighterId(match.winner) : null;
      message = match.winner === null ? 'Draw' : `${id ? FIGHTER_DEFS[id].name : 'Alchemist'} wins`;
    }
    if (this.message.textContent !== message) this.message.textContent = message;
    this.message.hidden = message === '';
    this.rematch.hidden = match.state !== 'finished';
  }

  dispose(): void { for (const off of this.offs) off(); this.root.remove(); document.body.classList.remove('stock-match'); }
}

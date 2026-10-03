import type { Ctx } from '@/core/types';
import { FIGHTER_DEFS, fighterPortraitUrl } from '@/content/fighters';
import { getBindings, keyLabel } from '@/input/bindings';
import '@/styles/arena.css';

/** Player-facing stock readout; the existing arena panel remains the training control. */
export class StockMatchHud {
  private readonly root = document.createElement('div');
  private readonly timer = document.createElement('div');
  private readonly message = document.createElement('div');
  private readonly rematch = document.createElement('button');
  private readonly hint = document.createElement('div');
  private readonly change = document.createElement('button');
  private readonly result = document.createElement('section');
  private readonly resultBody = document.createElement('div');
  private resultKey = '';
  private raf = 0;
  private readonly offs: Array<() => void> = [];
  private readonly cards: Array<{ root: HTMLElement; portrait: HTMLImageElement; name: HTMLElement; percent: HTMLElement; stocks: HTMLElement; defense: HTMLElement; fuel: HTMLMeterElement }> = [];

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
    this.change.className = 'stock-change'; this.change.type = 'button'; this.change.textContent = 'Change fighters';
    this.change.addEventListener('click', () => this.ctx.versus?.open()); this.root.append(this.change);
    this.result.className = 'stock-result'; this.result.hidden = true;
    this.result.setAttribute('aria-label', 'Match result'); this.resultBody.className = 'stock-result-body'; this.root.append(this.result);
    this.hint.className = 'stock-controls';
    this.root.append(this.hint);
    for (let slot = 0; slot < 2; slot++) {
      const root = document.createElement('div'), name = document.createElement('div');
      const percent = document.createElement('strong'), stocks = document.createElement('div'), fuel = document.createElement('meter');
      const portrait = document.createElement('img');
      const defense = document.createElement('div'); defense.className = 'stock-defense';
      portrait.className = 'stock-portrait'; portrait.alt = ''; portrait.hidden = true;
      root.className = `stock-fighter stock-fighter-${slot}`;
      name.className = 'stock-name'; percent.className = 'stock-percent'; stocks.className = 'stock-lives';
      fuel.min = 0; fuel.max = 1; fuel.setAttribute('aria-label', `Player ${slot + 1} recovery fuel`);
      root.append(portrait, name, percent, stocks, defense, fuel); this.root.append(root);
      this.cards.push({ root, portrait, name, percent, stocks, defense, fuel });
    }
    (document.getElementById('canvas-holder') ?? document.body).append(this.root);
    const tick = (): void => { this.update(); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }

  update(): void {
    const arena = this.ctx.arena, match = arena?.stockMatch;
    const visible = !!match && this.ctx.levels.current?.def.id === 'fighter-duel' && this.ctx.state.mode === 'play';
    this.root.hidden = !visible;
    document.body.classList.toggle('stock-match', visible);
    if (!visible || !match || !arena) return;
    const keys = getBindings();
    this.hint.textContent = `${keyLabel(keys.jump)}: jump · ${keyLabel(keys.up)} + jump: recover · ${keyLabel(keys.dodge)} / LB: dodge · ${keyLabel(keys.kick)} / B: melee · up + melee: launch · down + melee: finish`;
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
      const dodge = arena.stockDodge(slot), burst = arena.canRecover(slot), ledge = arena.stockLedge(slot);
      card.defense.textContent = `BURST ${burst ? '◆' : '◇'}  AIR ${dodge?.airReady ? '◆' : '◇'}  LEDGE ${ledge?.airReady ? '◆' : '◇'}`;
      card.defense.setAttribute('aria-label', `Recovery burst ${burst ? 'ready' : 'spent'}, air dodge ${dodge?.airReady ? 'ready' : 'spent'}, ledge catch ${ledge?.airReady ? 'ready' : 'spent'}`);
    }
    let message = '';
    if (match.state === 'idle') message = 'Choose a rival to begin';
    if (match.state === 'countdown') message = String(Math.ceil(match.countdown / 60));
    if (match.state === 'finished') {
      const id = match.winner !== null ? arena.fighterId(match.winner) : null;
      message = match.winner === null ? 'Draw' : `${id ? FIGHTER_DEFS[id].name : 'Alchemist'} wins`;
    }
    const resultKey = match.state === 'finished' ? `${message}|${arena.bout.endedAt}|${match.fighters.map(f => f.stocks).join(',')}` : '';
    if (resultKey !== this.resultKey) {
      this.resultKey = resultKey; this.result.hidden = resultKey === '';
      if (resultKey) {
        const winner = match.winner, id = winner !== null ? arena.fighterId(winner) : null;
        this.resultBody.replaceChildren();
        if (id) { const portrait = document.createElement('img'); portrait.src = fighterPortraitUrl(id); portrait.alt = ''; this.resultBody.append(portrait); }
        const stats = document.createElement('dl');
        const rows: Array<[string, string]> = winner === null
          ? match.fighters.map((f, slot) => [`Player ${slot + 1}`, `${f.stocks} stocks · ${Math.round(f.volatility)}%`])
          : [['Stocks remaining', String(match.fighters[winner].stocks)], ['Ring-outs scored', String(arena.bout.downs.filter(d => d.by === winner && d.slot !== winner).length)]];
        for (const [label, value] of rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; stats.append(dt, dd); }
        this.resultBody.append(stats);
        this.result.append(this.message, this.resultBody, this.rematch, this.change);
      } else this.root.append(this.message, this.rematch, this.change);
    }
    if (this.message.textContent !== message) this.message.textContent = message;
    this.message.hidden = message === '';
    this.rematch.hidden = match.state !== 'finished';
    this.change.hidden = match.state !== 'finished' || !this.ctx.versus?.active;
  }

  dispose(): void { cancelAnimationFrame(this.raf); for (const off of this.offs) off(); this.root.remove(); document.body.classList.remove('stock-match'); }
}

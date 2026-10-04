import type { Ctx } from '@/core/types';
import type { FighterId } from '@/content/fighters';
import { FIGHTER_DEFS, fighterPortraitUrl } from '@/content/fighters';
import { DUEL_ICON, DUEL_VICTORY, duelShortName } from '@/ui/duelCopy';
import '@/styles/versus.css';
import '@/styles/arena.css';

interface CardView {
  root: HTMLElement; portrait: HTMLImageElement; name: HTMLElement; percent: HTMLElement; value: Text; stocks: HTMLElement; dots: HTMLElement[];
  defense: HTMLElement; glyphs: Record<'shield' | 'burst' | 'air' | 'ledge', HTMLElement>; special: HTMLElement; cells: HTMLElement[]; specialHint: HTMLElement;
}

/** Volatility's colour: ivory when fresh, amber in the fight, red when one good hit sends you out (concepts/foundry-match.png). */
const HEAT: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [232, 220, 192]], [40, [239, 172, 88]], [85, [232, 88, 62]], [140, [200, 48, 44]],
];
function heat(volatility: number): string {
  let i = 1;
  while (i < HEAT.length - 1 && volatility > HEAT[i][0]) i++;
  const [a, ca] = HEAT[i - 1], [b, cb] = HEAT[i], t = Math.min(1, Math.max(0, (volatility - a) / (b - a)));
  return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(' ')})`;
}

const MAX_STOCKS = 3;

/** The HUD redraws every animation frame: write only what changed. */
function setAttr(el: Element, name: string, value: string): void { if (el.getAttribute(name) !== value) el.setAttribute(name, value); }
function setData(el: HTMLElement, key: string, value: string): void { if (el.dataset[key] !== value) el.dataset[key] = value; }
function setVar(el: HTMLElement, name: string, value: string): void { if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value); }

/**
 * Player-facing stock readout (docs/arena/platform-fighter/concepts/local-versus.png, foundry-match.png, special-charges.png):
 * a framed timer tab at the top, one card per fighter in the bottom corners (portrait, name, stock beads, the big percent,
 * the two special cells and four quiet readiness glyphs), the countdown, and the results card. The middle of the screen
 * belongs to the fight. The existing arena panel remains the training control.
 */
export class StockMatchHud {
  private readonly root = document.createElement('div');
  private readonly timer = document.createElement('div');
  private readonly clock = document.createElement('span');
  private readonly message = document.createElement('div');
  private readonly rematch = document.createElement('button');
  private readonly change = document.createElement('button');
  private readonly result = document.createElement('section');
  private readonly resultTitle = document.createElement('h2');
  private readonly resultTagline = document.createElement('p');
  private readonly resultBody = document.createElement('div');
  private resultKey = '';
  private raf = 0;
  private readonly offs: Array<() => void> = [];
  private readonly cards: CardView[] = [];

  constructor(private readonly ctx: Ctx, onRematch: () => void) {
    this.offs.push(ctx.events.on('levelChanged', () => this.update()), ctx.events.on('modeChanged', () => this.update()));
    this.root.id = 'stock-match-hud';
    this.root.hidden = true;
    this.timer.className = 'stock-timer'; this.timer.setAttribute('role', 'timer');
    this.clock.className = 'stock-clock'; this.timer.append(this.clock);
    this.message.className = 'stock-message';
    this.message.setAttribute('role', 'status');
    this.rematch.className = 'stock-rematch';
    this.rematch.type = 'button'; this.rematch.textContent = 'Rematch';
    this.rematch.addEventListener('click', () => { this.rematch.blur(); onRematch(); });
    this.change.className = 'stock-change'; this.change.type = 'button'; this.change.textContent = 'Change fighters';
    this.change.addEventListener('click', () => this.ctx.versus?.open());
    this.result.className = 'stock-result'; this.result.hidden = true;
    this.result.setAttribute('aria-label', 'Match result');
    const panel = document.createElement('div'); panel.className = 'stock-result-panel';
    this.resultTitle.className = 'stock-result-title'; this.resultTagline.className = 'stock-result-tagline';
    this.resultBody.className = 'stock-result-body';
    const actions = document.createElement('div'); actions.className = 'stock-result-actions';
    actions.append(this.rematch, this.change);
    panel.append(this.resultTitle, this.resultTagline, this.resultBody, actions);
    this.result.append(panel);
    this.root.append(this.timer, this.message);
    for (let slot = 0; slot < 2; slot++) {
      const root = document.createElement('div'); root.className = `stock-fighter stock-fighter-${slot}`;
      const frame = document.createElement('div'); frame.className = 'stock-portrait-frame';
      const portrait = document.createElement('img'); portrait.className = 'stock-portrait'; portrait.alt = ''; portrait.hidden = true;
      frame.append(portrait);
      const body = document.createElement('div'); body.className = 'stock-card-body';
      const name = document.createElement('div'); name.className = 'stock-name';
      const percent = document.createElement('strong'); percent.className = 'stock-percent';
      const value = document.createTextNode('0'), sign = document.createElement('small'); sign.textContent = '%';
      percent.append(value, sign);
      const stocks = document.createElement('div'); stocks.className = 'stock-lives'; stocks.setAttribute('role', 'img');
      const dots = Array.from({ length: MAX_STOCKS }, () => { const dot = document.createElement('span'); dot.className = 'stock-dot'; return dot; });
      stocks.append(...dots);
      const special = document.createElement('div'), label = document.createElement('span'), specialHint = document.createElement('span');
      special.className = 'stock-special'; special.setAttribute('role', 'meter'); special.setAttribute('aria-valuemin', '0'); special.setAttribute('aria-valuemax', '2');
      special.setAttribute('aria-label', `Player ${slot + 1} special charges`);
      label.className = 'stock-special-label'; label.textContent = 'Special'; specialHint.className = 'stock-special-hint';
      const cells = Array.from({ length: 2 }, () => { const cell = document.createElement('span'); cell.className = 'stock-special-cell'; cell.setAttribute('aria-hidden', 'true'); return cell; });
      special.append(label, ...cells, specialHint);
      // Shield, recovery burst, air dodge and ledge catch: four quiet glyphs, lit while ready.
      const defense = document.createElement('div'); defense.className = 'stock-defense'; defense.setAttribute('role', 'img');
      const glyph = (kind: 'shield' | 'burst' | 'air' | 'ledge'): HTMLElement => {
        const el = document.createElement('span'); el.className = `stock-glyph stock-glyph-${kind}`; el.innerHTML = DUEL_ICON[kind]; defense.append(el); return el;
      };
      const glyphs = { shield: glyph('shield'), burst: glyph('burst'), air: glyph('air'), ledge: glyph('ledge') };
      const side = document.createElement('div'); side.className = 'stock-card-side';
      side.append(frame, defense);
      body.append(name, percent, stocks, special);
      root.append(side, body); this.root.append(root);
      this.cards.push({ root, portrait, name, percent, value, stocks, dots, defense, glyphs, special, cells, specialHint });
    }
    this.root.append(this.result);
    (document.getElementById('canvas-holder') ?? document.body).append(this.root);
    const tick = (): void => { this.update(); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }

  update(): void {
    const arena = this.ctx.arena, match = arena?.stockMatch;
    const visible = !!match && this.ctx.levels.current?.def.id === 'fighter-duel' && this.ctx.state.mode === 'play';
    if (this.root.hidden !== !visible) this.root.hidden = !visible;
    document.body.classList.toggle('stock-match', visible);
    if (!visible || !match || !arena) return;
    const seconds = Math.ceil(match.remainingTicks / 60);
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (this.clock.textContent !== clock) {
      this.clock.textContent = clock;
      this.timer.setAttribute('aria-label', `${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds remaining`);
    }
    setData(this.timer, 'low', String(match.state === 'fighting' && seconds <= 30));
    for (let slot = 0; slot < 2; slot++) {
      const card = this.cards[slot], f = match.fighters[slot];
      const id = arena.fighterId(slot);
      if (card.portrait.hidden !== !id) card.portrait.hidden = !id;
      if (id && card.portrait.dataset.fighter !== id) {
        card.portrait.src = fighterPortraitUrl(id); card.portrait.dataset.fighter = id;
      }
      const name = id ? duelShortName(id) : slot === 0 ? 'Alchemist' : 'Add a rival';
      if (card.name.dataset.name !== name) { card.name.dataset.name = name; card.name.innerHTML = `<span class="stock-slot">P${slot + 1}</span>`; card.name.append(name); }
      const volatility = Math.round(f?.volatility ?? 0);
      if (card.value.data !== String(volatility)) {
        card.value.data = String(volatility);
        card.percent.style.color = heat(volatility);
        setData(card.percent, 'danger', String(volatility >= 100));
      }
      const stocks = f?.stocks ?? 0;
      for (let i = 0; i < MAX_STOCKS; i++) setData(card.dots[i], 'on', String(i < stocks));
      setAttr(card.stocks, 'aria-label', `${stocks} stocks remaining`);
      setData(card.root, 'out', String(!!f && stocks === 0));
      const dodge = arena.stockDodge(slot), burst = arena.canRecover(slot), ledge = arena.stockLedge(slot);
      const shield = arena.stockShield(slot), strength = Math.ceil(shield?.strength ?? 100), broken = shield?.phase === 'broken';
      const special = arena.stockSpecial(slot), charges = special?.charges ?? 2;
      setAttr(card.special, 'aria-valuenow', String(charges));
      setAttr(card.special, 'aria-valuetext', `${charges} of 2 charges. Melee hits recharge faster. Recovery burst is separate.`);
      const hint = charges === 0 ? 'Melee recharges' : '';
      if (card.specialHint.textContent !== hint) card.specialHint.textContent = hint;
      setData(card.special, 'busy', String(!!special?.busy));
      for (let i = 0; i < card.cells.length; i++) {
        const filled = i < charges;
        setData(card.cells[i], 'filled', String(filled));
        setVar(card.cells[i], '--charge', `${filled ? 100 : i === charges ? Math.round((special?.progress ?? 0) * 100) : 0}%`);
      }
      setData(card.glyphs.shield, 'state', broken ? 'broken' : strength < 100 ? 'worn' : 'ready');
      setVar(card.glyphs.shield, '--strength', String(Math.max(0, Math.min(100, strength)) / 100));
      setData(card.glyphs.burst, 'state', burst ? 'ready' : 'spent');
      setData(card.glyphs.air, 'state', dodge?.airReady ? 'ready' : 'spent');
      setData(card.glyphs.ledge, 'state', ledge?.airReady ? 'ready' : 'spent');
      setAttr(card.defense, 'aria-label', `Shield ${broken ? 'broken' : `${strength} percent`}, recovery burst ${burst ? 'ready' : 'spent'}, air dodge ${dodge?.airReady ? 'ready' : 'spent'}, ledge catch ${ledge?.airReady ? 'ready' : 'spent'}`);
    }
    let message = '';
    if (match.state === 'idle') message = 'Choose a rival to begin';
    if (match.state === 'countdown') message = String(Math.ceil(match.countdown / 60));
    if (this.message.textContent !== message) this.message.textContent = message;
    if (this.message.hidden !== (message === '')) this.message.hidden = message === '';
    setData(this.message, 'kind', match.state);
    const resultKey = match.state === 'finished' ? `${match.winner}|${arena.bout.endedAt}|${match.fighters.map(f => f.stocks).join(',')}` : '';
    if (resultKey !== this.resultKey) {
      this.resultKey = resultKey; this.result.hidden = resultKey === '';
      if (resultKey) this.fillResult();
    }
    this.rematch.hidden = match.state !== 'finished';
    this.change.hidden = match.state !== 'finished' || !this.ctx.versus?.active;
  }

  /** The results card: who won, the line under it, the portrait and what the match left them. */
  private fillResult(): void {
    const arena = this.ctx.arena, match = arena?.stockMatch;
    if (!arena || !match) return;
    const winner = match.winner, id = winner !== null ? arena.fighterId(winner) : null;
    const ids = [arena.fighterId(0), arena.fighterId(1)];
    this.result.dataset.slot = winner === null ? 'draw' : String(winner);
    this.resultTitle.textContent = winner === null ? 'Draw' : `${id ? duelShortName(id) : 'Alchemist'} wins`;
    this.resultTagline.textContent = id ? DUEL_VICTORY[id].tagline : 'Neither fell further than the other.';
    const figure = document.createElement('figure'); figure.className = 'stock-result-portrait';
    const portraits: FighterId[] = id ? [id] : ids.filter((f): f is FighterId => f !== null);
    for (const f of portraits) { const img = document.createElement('img'); img.src = fighterPortraitUrl(f); img.alt = FIGHTER_DEFS[f].name; figure.append(img); }
    const stats = document.createElement('div'); stats.className = 'stock-result-stats';
    const list = document.createElement('dl');
    const rows: Array<[string, string]> = winner === null
      ? match.fighters.map((f, slot) => { const who = ids[slot]; return [who ? duelShortName(who) : `Player ${slot + 1}`, `${f.stocks} · ${Math.round(f.volatility)}%`]; })
      : [['Stocks', String(match.fighters[winner].stocks)], ['Ring-outs', String(arena.bout.downs.filter(d => d.by === winner && d.slot !== winner).length)]];
    for (const [label, value] of rows) {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; row.append(dt, dd); list.append(row);
    }
    const quote = document.createElement('blockquote');
    quote.textContent = `“${id ? DUEL_VICTORY[id].quote : `${arena.stockStage.name} keeps the score. It will ask again.`}”`;
    stats.append(list, quote);
    this.resultBody.replaceChildren(...(portraits.length ? [figure] : []), stats);
  }

  dispose(): void { cancelAnimationFrame(this.raf); for (const off of this.offs) off(); this.root.remove(); document.body.classList.remove('stock-match'); }
}

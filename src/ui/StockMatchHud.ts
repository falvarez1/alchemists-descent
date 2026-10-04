import type { Ctx } from '@/core/types';
import type { FighterId } from '@/content/fighters';
import { FIGHTER_DEFS } from '@/content/fighters';
import { stockCountdownBeat } from '@/config/stockRules';
import { DUEL_ICON, DUEL_VICTORY, duelShortName, showFighterArt } from '@/ui/duelCopy';
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
/** After the last ring-out: GAME! at once, then <NAME> WINS over the winner's pose, then the results card. */
const WINS_AFTER_MS = 950, RESULTS_AFTER_MS = 2200, FIGHT_MS = 800;

const reducedMotion = (): boolean => document.body.classList.contains('reduce-flashes') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
function pop(el: Element, frames: Keyframe[], duration: number, easing = 'cubic-bezier(.2, 1.5, .45, 1)'): void {
  if (!reducedMotion()) el.animate(frames, { duration, easing });
}

/** The HUD redraws every animation frame: write only what changed. */
function setAttr(el: Element, name: string, value: string): void { if (el.getAttribute(name) !== value) el.setAttribute(name, value); }
function setData(el: HTMLElement, key: string, value: string): void { if (el.dataset[key] !== value) el.dataset[key] = value; }
function setVar(el: HTMLElement, name: string, value: string): void { if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value); }

/**
 * Player-facing stock readout (docs/arena/platform-fighter/concepts/local-versus.png, foundry-match.png, special-charges.png):
 * a framed timer tab at the top, one card per fighter in the bottom corners (the bust, name, stock beads, the big percent,
 * the two special cells and four quiet readiness glyphs), and the match's arcade beats: 3 · 2 · 1 slammed in on the
 * countdown's beats, FIGHT!, a percent that pops when it rises, a bead that bursts when a stock goes, GAME! (or TIME!)
 * at the end, <NAME> WINS over the winner's pose, then the results card. The middle of the screen belongs to the fight
 * except for those beats. duel-audio's announcer calls the same moments from the same state, so voice and type land
 * together. The existing arena panel remains the training control.
 */
export class StockMatchHud {
  private readonly root = document.createElement('div');
  private readonly timer = document.createElement('div');
  private readonly clock = document.createElement('span');
  private readonly message = document.createElement('div');
  private readonly banner = document.createElement('div');
  private readonly bannerText = document.createElement('span');
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
  /** What the last frame showed, so the beats fire on the change. */
  private shown = { state: '', beat: 0, volatility: [0, 0], stocks: [MAX_STOCKS, MAX_STOCKS] };
  private bannerUntil = 0;
  private finishedAt = 0;
  private winsShown = false;

  constructor(private readonly ctx: Ctx, onRematch: () => void) {
    this.offs.push(ctx.events.on('levelChanged', () => this.update()), ctx.events.on('modeChanged', () => this.update()));
    // A confirm (a pad's A, Enter, a click) skips the GAME! / WINS beat straight to the results card.
    this.offs.push(ctx.events.on('versusMenu', ({ action }) => { if (action === 'confirm') this.skipToResults(); }));
    this.root.id = 'stock-match-hud';
    this.root.hidden = true;
    this.timer.className = 'stock-timer'; this.timer.setAttribute('role', 'timer');
    this.clock.className = 'stock-clock'; this.timer.append(this.clock);
    this.message.className = 'stock-message';
    this.message.setAttribute('role', 'status');
    this.banner.className = 'stock-banner'; this.banner.hidden = true; this.banner.setAttribute('role', 'status');
    this.banner.append(this.bannerText);
    this.banner.addEventListener('pointerdown', () => this.skipToResults());
    this.rematch.className = 'stock-rematch';
    this.rematch.type = 'button'; this.rematch.textContent = 'Rematch';
    this.rematch.addEventListener('click', () => { this.rematch.blur(); onRematch(); });
    this.change.className = 'stock-change'; this.change.type = 'button'; this.change.textContent = 'Change fighters'; this.change.dataset.sfx = 'back';
    this.change.addEventListener('click', () => { if (this.ctx.duel?.active) this.ctx.duel.lobby(); else this.ctx.versus?.open(); });
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
      const portrait = document.createElement('img'); portrait.className = 'stock-portrait bust-fit'; portrait.alt = ''; portrait.hidden = true;
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
    this.root.append(this.banner, this.result);
    (document.getElementById('canvas-holder') ?? document.body).append(this.root);
    window.addEventListener('keydown', this.onKey, true);
    const tick = (): void => { this.update(); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }

  /** Enter or Space during GAME! / WINS skips to the card (Esc is left alone: the pause menu stands aside there). */
  private readonly onKey = (event: KeyboardEvent): void => {
    if ((event.key === 'Enter' || event.key === ' ') && this.finishedAt && this.result.hidden) { event.preventDefault(); this.skipToResults(); }
  };

  update(): void {
    const arena = this.ctx.arena, match = arena?.stockMatch;
    const visible = !!match && this.ctx.levels.current?.def.id === 'fighter-duel' && this.ctx.state.mode === 'play';
    if (this.root.hidden !== !visible) this.root.hidden = !visible;
    document.body.classList.toggle('stock-match', visible);
    if (!visible || !match || !arena) return;
    const now = performance.now();
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
      if (id) showFighterArt(card.portrait, id);
      const name = id ? duelShortName(id) : slot === 0 ? 'Alchemist' : 'Add a rival';
      if (card.name.dataset.name !== name) { card.name.dataset.name = name; card.name.innerHTML = `<span class="stock-slot">P${slot + 1}</span>`; card.name.append(name); }
      const volatility = Math.round(f?.volatility ?? 0);
      if (card.value.data !== String(volatility)) {
        card.value.data = String(volatility);
        card.percent.style.color = heat(volatility);
        setData(card.percent, 'danger', String(volatility >= 100));
        // A hit: the number pops, shakes and flashes; the bigger the hit, the harder.
        const rise = volatility - this.shown.volatility[slot];
        if (rise > 0 && match.state === 'fighting') {
          const kick = Math.min(1.45, 1.16 + rise / 60), shake = Math.min(5, 2 + rise / 6);
          pop(card.percent, [
            { transform: `scale(${kick}) translate(${shake}px, -1px)`, filter: 'brightness(2.4)' },
            { transform: `scale(${(kick + 1) / 2}) translate(${-shake}px, 1px)`, filter: 'brightness(1.5)', offset: .4 },
            { transform: 'none', filter: 'none' },
          ], 170, 'ease-out');
        }
      }
      this.shown.volatility[slot] = volatility;
      const stocks = f?.stocks ?? 0;
      for (let i = 0; i < MAX_STOCKS; i++) setData(card.dots[i], 'on', String(i < stocks));
      // A stock gone: its bead bursts.
      for (let i = stocks; i < Math.min(MAX_STOCKS, this.shown.stocks[slot]); i++) this.burst(card.dots[i]);
      this.shown.stocks[slot] = stocks;
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
    // 3 · 2 · 1: one number per countdown beat (stockCountdownBeat, the announcer's own clock), each slammed in.
    const beat = match.state === 'countdown' ? stockCountdownBeat(match.countdown) : 0;
    // (a Duel is never idle for long enough to read: the countdown follows at once)
    const message = match.state === 'idle' && !this.ctx.versus?.active ? 'Choose a rival to begin' : beat ? String(beat) : '';
    if (this.message.textContent !== message) this.message.textContent = message;
    if (this.message.hidden !== (message === '')) this.message.hidden = message === '';
    setData(this.message, 'kind', match.state);
    if (beat && beat !== this.shown.beat) pop(this.message, [{ transform: 'translate(-50%, -50%) scale(2.6)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(.9)', opacity: 1, offset: .55 }, { transform: 'translate(-50%, -50%)' }], 260, 'cubic-bezier(.2, 1.2, .4, 1)');
    this.shown.beat = beat;
    // FIGHT! as the countdown ends; GAME! (or TIME!) when it is over, then <NAME> WINS, then the card.
    if (match.state !== this.shown.state) {
      if (match.state === 'fighting' && this.shown.state === 'countdown') this.showBanner('Fight!', 'fight', FIGHT_MS);
      if (match.state === 'finished') { this.finishedAt = now; this.winsShown = false; this.showBanner(match.reason === 'timeout' ? 'Time!' : 'Game!', 'game', 0); }
      if (match.state !== 'finished') { this.finishedAt = 0; if (this.banner.dataset.kind !== 'fight') this.hideBanner(); }
      this.shown.state = match.state;
    }
    if (match.state === 'finished' && this.finishedAt && this.result.hidden) {
      if (!this.winsShown && now - this.finishedAt >= WINS_AFTER_MS) { this.winsShown = true; this.showBanner(this.winnerLine(), 'wins', 0); }
      if (now - this.finishedAt >= RESULTS_AFTER_MS) this.showResults();
    }
    if (this.bannerUntil && now >= this.bannerUntil) this.hideBanner();
    const resultKey = match.state === 'finished' ? `${match.winner}|${arena.bout.endedAt}|${match.fighters.map(f => f.stocks).join(',')}` : '';
    if (resultKey !== this.resultKey) {
      this.resultKey = resultKey;
      if (resultKey) this.fillResult(); else this.result.hidden = true;
    }
    this.rematch.hidden = match.state !== 'finished';
    this.rematch.disabled = this.ctx.duel?.replica === true;
    this.change.hidden = match.state !== 'finished' || (!this.ctx.versus?.active && !this.ctx.duel?.active);
    this.change.disabled = this.ctx.duel?.replica === true;
  }

  private winnerLine(): string {
    const arena = this.ctx.arena, winner = arena?.stockMatch?.winner ?? null, id = winner !== null ? arena?.fighterId(winner) : null;
    return winner === null ? 'Draw' : `${id ? duelShortName(id) : 'Alchemist'} wins`;
  }

  /** A banner slams in across the middle; `ms` 0 holds it until something replaces it. */
  private showBanner(text: string, kind: 'fight' | 'game' | 'wins', ms: number): void {
    this.bannerText.textContent = text; this.banner.dataset.kind = kind;
    const winner = this.ctx.arena?.stockMatch?.winner;
    this.banner.dataset.slot = kind === 'wins' && winner !== null && winner !== undefined ? String(winner) : '';
    this.banner.hidden = false; this.bannerUntil = ms ? performance.now() + ms : 0;
    pop(this.bannerText, [
      { transform: 'scale(3.2)', opacity: 0, filter: 'blur(6px) brightness(2)' },
      { transform: 'scale(.92)', opacity: 1, filter: 'none', offset: .6 },
      { transform: 'none' },
    ], kind === 'wins' ? 300 : 240, 'cubic-bezier(.2, 1.1, .35, 1)');
    pop(this.banner, [{ opacity: 0 }, { opacity: 1 }], 120, 'linear');
  }
  private hideBanner(): void {
    this.bannerUntil = 0;
    if (!this.banner.hidden) this.banner.hidden = true;
  }
  private skipToResults(): void {
    if (this.finishedAt && this.result.hidden && this.ctx.arena?.stockMatch?.state === 'finished') this.showResults();
  }
  private showResults(): void {
    this.hideBanner(); this.result.hidden = false;
    const panel = this.result.firstElementChild;
    if (panel) pop(panel, [{ transform: 'scale(1.14)', opacity: 0 }, { transform: 'scale(.98)', opacity: 1, offset: .6 }, { transform: 'none' }], 260, 'cubic-bezier(.2, 1.1, .35, 1)');
    pop(this.resultTitle, [{ transform: 'scale(1.8)', opacity: 0, filter: 'brightness(2)' }, { transform: 'none', opacity: 1, filter: 'none' }], 320, 'cubic-bezier(.2, 1.3, .4, 1)');
    this.rematch.focus({ preventScroll: true });
  }
  /** A lost stock's bead bursts: a ring of the seat's colour flies out from it. */
  private burst(dot: HTMLElement): void {
    if (reducedMotion()) return;
    const ring = document.createElement('i'); ring.className = 'stock-burst'; dot.append(ring);
    ring.animate([{ transform: 'scale(.6)', opacity: 1 }, { transform: 'scale(3.4)', opacity: 0 }], { duration: 420, easing: 'cubic-bezier(.16, 1, .3, 1)' }).onfinish = () => ring.remove();
    dot.animate([{ transform: 'scale(1.6)', filter: 'brightness(2.5)' }, { transform: 'none', filter: 'none' }], { duration: 260, easing: 'ease-out' });
  }

  /** The results card: who won, the line under it, the framed bust and what the match left them. */
  private fillResult(): void {
    const arena = this.ctx.arena, match = arena?.stockMatch;
    if (!arena || !match) return;
    const winner = match.winner, id = winner !== null ? arena.fighterId(winner) : null;
    const ids = [arena.fighterId(0), arena.fighterId(1)];
    this.result.dataset.slot = winner === null ? 'draw' : String(winner);
    this.resultTitle.textContent = this.winnerLine();
    this.resultTagline.textContent = id ? DUEL_VICTORY[id].tagline : 'Neither fell further than the other.';
    const figure = document.createElement('figure'); figure.className = 'stock-result-portrait';
    const portraits: FighterId[] = id ? [id] : ids.filter((f): f is FighterId => f !== null);
    portraits.forEach((f, i) => {
      const frame = document.createElement('span'); frame.className = `stock-result-bust stock-result-bust-${i}`;
      const img = document.createElement('img'); img.className = 'bust-fit'; img.alt = FIGHTER_DEFS[f].name; showFighterArt(img, f);
      frame.append(img); figure.append(frame);
    });
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

  dispose(): void {
    cancelAnimationFrame(this.raf); window.removeEventListener('keydown', this.onKey, true);
    for (const off of this.offs) off(); this.root.remove(); document.body.classList.remove('stock-match');
  }
}

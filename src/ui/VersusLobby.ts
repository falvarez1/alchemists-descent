import type { Ctx } from '@/core/types';
import type { VersusApi, VersusDevice } from '@/core/versus';
import { FIGHTER_DEFS, FIGHTER_ORDER, type FighterId } from '@/content/fighters';
import { STOCK_STAGES, STOCK_STAGE_ORDER, type StockStageId } from '@/config/stockStage';
import { STOCK_RULES } from '@/config/stockRules';
import { GAME_TITLE } from '@/config/brand';
import { DUEL_CPU_LEVELS, DUEL_ICON, duelDeviceLabel, duelShortName, duelTitle, showFighterArt } from '@/ui/duelCopy';
import '@/styles/versus.css';

/** One ◀ value ▶ row of a seat: the fighter, the device, a CPU's level. A focusable group the keyboard cursor rests on. */
interface Cycler { root: HTMLElement; value: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement }

interface SeatView {
  card: HTMLElement; frame: HTMLElement; box: HTMLElement; image: HTMLImageElement; name: HTMLElement; title: HTMLElement; pips: HTMLElement[];
  fighter: Cycler; device: Cycler; difficulty: Cycler; icon: HTMLElement; ready: HTMLButtonElement;
  shown: { fighter: string; ready: boolean };
}

const deviceIcon = (device: VersusDevice): string => device === 'cpu' ? DUEL_ICON.cpu : device === 'keyboard' ? DUEL_ICON.keyboard : DUEL_ICON.controller;
const reducedMotion = (): boolean => document.body.classList.contains('reduce-flashes') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
/** A short Web Animation, skipped when motion is reduced (the end state is always the CSS state). */
function pop(el: Element, frames: Keyframe[], duration: number, easing = 'cubic-bezier(.2, 1.5, .45, 1)'): void {
  if (!reducedMotion()) el.animate(frames, { duration, easing });
}
const glyph = (text: string, kind = ''): string => `<kbd class="versus-glyph${kind ? ` versus-glyph-${kind}` : ''}">${text}</kbd>`;

/** The keyboard player's seat while it still has to ready (the big READY is the keyboard and mouse's own confirm). */
function keyboardWaiting(session: VersusApi): number {
  return session.seats.findIndex((s, slot) => s.device === 'keyboard' && !s.ready && !session.disconnected.includes(slot));
}

/**
 * The Duel's select screen, an arcade cabinet's (docs/arena/platform-fighter/concepts/local-versus.png): the DUEL panel
 * (two busts facing across a compass VS, each seat's ◀ fighter ▶ and its card: ◀ device ▶, a CPU's ◀ level ▶ and a
 * readiness badge) with one big READY under them, the CHOOSE A STAGE panel, the chosen stage's backdrop behind both,
 * and a footer of short button prompts. Nothing is a dropdown: every choice cycles with chunky arrows that repeat while
 * held, and with each seat's own device (a pad's d-pad or stick in LocalVersus; the keyboard's arrows here, ↑↓ moving
 * the cursor between rows). Confirm readies (a pad's A, the keyboard's Enter or READY, which also starts the match once
 * everyone is ready); back un-readies. While the match loads, a VS card slams both fighters in.
 */
export class VersusLobby {
  private readonly root = document.createElement('section');
  private readonly reconnect = document.createElement('section');
  private readonly seats: SeatView[] = [];
  private readonly stages = new Map<StockStageId, HTMLButtonElement>();
  private readonly backdrops: HTMLElement[] = [];
  private readonly start = document.createElement('button');
  private readonly status = document.createElement('p');
  private readonly stageLine = document.createElement('p');
  private readonly keys = document.createElement('p');
  private readonly notice = document.createElement('p');
  private readonly splash = document.createElement('div');
  private readonly offs: Array<() => void> = [];
  private deviceKey = '';
  private backdropStage = '';
  private shownStage = '';
  private shown = false;
  private wasLoading = false;

  constructor(private readonly ctx: Ctx) {
    this.root.id = 'versus-lobby'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-labelledby', 'versus-heading');
    const minutes = Math.round(STOCK_RULES.timeTicks / 3600);
    this.root.innerHTML = `<div class="versus-backdrop" aria-hidden="true"><div></div><div></div></div>
    <div class="versus-shell">
      <div class="versus-top"><p class="versus-brand"><span class="versus-sigil">${DUEL_ICON.sigil}</span>${GAME_TITLE}</p><p class="versus-motto">Matter fights back.</p></div>
      <div class="versus-panels">
        <section class="versus-panel versus-duel">
          <div class="versus-head"><h1 id="versus-heading">Duel</h1><p>Two alchemists. A deeper truth.</p></div>
          <div class="versus-seats"><div class="versus-vs" aria-hidden="true">${DUEL_ICON.compass}<span>VS</span></div></div>
          <div class="versus-devices"></div>
          <div class="versus-go"></div>
        </section>
        <section class="versus-panel versus-stages" aria-labelledby="versus-stage-heading">
          <div class="versus-head"><h2 id="versus-stage-heading">Choose a stage</h2><p>Different grounds. The same hunger.</p></div>
          <div class="versus-stage-grid" role="radiogroup" aria-labelledby="versus-stage-heading"></div>
          <ul class="versus-rules" aria-label="Duel rules">
            <li>${DUEL_ICON.stock}<span>${STOCK_RULES.stocks} stocks</span></li>
            <li>${DUEL_ICON.hourglass}<span>${minutes} minutes</span></li>
            <li>${DUEL_ICON.noHazards}<span>Hazards off</span></li>
          </ul>
        </section>
      </div>
      <footer class="versus-footer"></footer>
    </div>`;
    this.backdrops.push(...this.root.querySelectorAll<HTMLElement>('.versus-backdrop > div'));
    const seatRow = this.root.querySelector('.versus-seats')!, devices = this.root.querySelector('.versus-devices')!;
    for (let slot = 0; slot < 2; slot++) {
      const player = `Player ${slot + 1}`, who = player.toLowerCase();
      const card = document.createElement('article'); card.className = `versus-seat versus-seat-${slot}`;
      const frame = document.createElement('div'); frame.className = 'versus-portrait-frame';
      const image = document.createElement('img'); image.alt = ''; image.className = 'versus-portrait bust-fit'; image.decoding = 'async';
      frame.append(image);
      // ◀ NAME ▶ under the bust, with a pip for each of the ten and the one shown lit.
      const fighter = this.cycler(`${player} fighter`, `Previous fighter for ${who}`, `Next fighter for ${who}`, dir => this.stepFighter(slot, dir));
      fighter.root.classList.add('versus-plate'); fighter.root.dataset.row = 'fighter';
      const name = document.createElement('h2'), title = document.createElement('p'); title.className = 'versus-fighter-title';
      const pipRow = document.createElement('span'); pipRow.className = 'versus-pips'; pipRow.setAttribute('aria-hidden', 'true');
      const pips = FIGHTER_ORDER.map(() => { const pip = document.createElement('i'); pipRow.append(pip); return pip; });
      fighter.value.classList.add('versus-names'); fighter.value.append(name, title, pipRow);
      card.append(frame, fighter.root);
      if (slot === 0) seatRow.prepend(card); else seatRow.append(card);

      // The seat card: PLAYER N, its readiness badge, ◀ device ▶ and (a CPU's) ◀ level ▶.
      const box = document.createElement('div'); box.className = `versus-device versus-device-${slot}`;
      const label = document.createElement('span'); label.className = 'versus-device-label'; label.textContent = player;
      const ready = document.createElement('button'); ready.type = 'button'; ready.className = 'versus-ready';
      ready.setAttribute('aria-label', `Ready player ${slot + 1}`); ready.innerHTML = DUEL_ICON.check;
      ready.addEventListener('click', () => ctx.versus?.ready(slot));
      const device = this.cycler(`${player} device`, `Previous device for ${who}`, `Next device for ${who}`, dir => this.stepDevice(slot, dir));
      device.root.dataset.row = 'device';
      const icon = document.createElement('span'); icon.className = 'versus-device-icon';
      device.value.before(icon);
      const difficulty = this.cycler(`${player} CPU difficulty`, `Lower CPU difficulty for ${who}`, `Higher CPU difficulty for ${who}`, dir => this.stepDifficulty(slot, dir));
      difficulty.root.dataset.row = 'difficulty'; difficulty.root.classList.add('versus-cpu'); difficulty.root.hidden = true;
      difficulty.root.title = 'Higher levels react faster and adapt more strongly to moves that work against you.';
      box.append(label, ready, device.root, difficulty.root); devices.append(box);
      this.seats.push({ card, frame, box, image, name, title, pips, fighter, device, difficulty, icon, ready, shown: { fighter: '', ready: false } });
    }

    this.start.type = 'button'; this.start.id = 'versus-start'; this.start.textContent = 'Ready';
    this.start.addEventListener('click', () => this.readyUp(false));
    this.root.querySelector('.versus-go')!.append(this.start);

    const grid = this.root.querySelector<HTMLElement>('.versus-stage-grid')!;
    for (const id of STOCK_STAGE_ORDER) {
      const def = STOCK_STAGES[id];
      const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'versus-stage-tile';
      tile.setAttribute('role', 'radio'); tile.dataset.stage = id; tile.dataset.sfx = 'move'; tile.style.setProperty('--stage-accent', def.accent);
      tile.innerHTML = `<span class="versus-stage-art"><img alt="" decoding="async" src="${import.meta.env.BASE_URL}${def.thumbnail}"></span><span class="versus-stage-name">${def.caption.charAt(0)}${def.caption.slice(1).toLowerCase()}</span>`;
      tile.addEventListener('click', () => ctx.versus?.chooseStage(id));
      grid.append(tile); this.stages.set(id, tile);
    }
    this.stageLine.className = 'versus-stage-foot'; this.stageLine.setAttribute('aria-live', 'polite');
    this.root.querySelector('.versus-stages')!.append(this.stageLine);

    const back = document.createElement('button'); back.type = 'button'; back.className = 'versus-back'; back.dataset.sfx = 'back';
    back.innerHTML = `${glyph('Esc')}<span>Back</span>`; back.setAttribute('aria-label', 'Back to title');
    back.addEventListener('click', () => this.leave());
    this.status.className = 'versus-status'; this.status.setAttribute('role', 'status');
    this.keys.className = 'versus-keys';
    this.notice.className = 'controller-notice';
    this.notice.innerHTML = `${DUEL_ICON.controller}<span>${glyph('A', 'a')} on a pad to join</span>`;
    const prompts = document.createElement('div'); prompts.className = 'versus-prompts'; prompts.append(this.keys, this.notice);
    this.root.querySelector('footer')!.append(back, this.status, prompts);

    // The VS card while the stage loads: both busts slam in, the names under them, the stage at the foot.
    this.splash.className = 'versus-splash'; this.splash.setAttribute('aria-hidden', 'true');
    this.splash.innerHTML = `<div class="versus-splash-side versus-splash-0"><img class="bust-fit" alt=""><b></b><small></small></div>
      <div class="versus-splash-vs"><span>VS</span></div>
      <div class="versus-splash-side versus-splash-1"><img class="bust-fit" alt=""><b></b><small></small></div>
      <p class="versus-splash-stage"></p>`;
    this.splash.addEventListener('pointerdown', () => this.skipSplash());
    this.root.append(this.splash);

    this.reconnect.id = 'versus-reconnect'; this.reconnect.hidden = true;
    this.reconnect.setAttribute('role', 'dialog'); this.reconnect.setAttribute('aria-modal', 'true'); this.reconnect.setAttribute('aria-labelledby', 'versus-reconnect-heading');
    this.reconnect.innerHTML = `<div class="versus-panel"><div class="versus-head"><h2 id="versus-reconnect-heading">Controller lost</h2></div><p role="status"></p><div class="versus-reconnect-actions"><button type="button" data-resume>Resume</button><button type="button" data-lobby>Change players</button></div></div>`;
    this.reconnect.querySelector('[data-resume]')!.addEventListener('click', () => ctx.versus?.resume());
    this.reconnect.querySelector('[data-lobby]')!.addEventListener('click', () => ctx.versus?.open());
    (document.getElementById('canvas-holder') ?? document.body).append(this.root, this.reconnect);
    this.offs.push(ctx.events.on('versusChanged', () => this.update()), ctx.events.on('versusMenu', ({ action }) => this.walkMenu(action)));
    this.root.addEventListener('keydown', this.onKey); this.reconnect.addEventListener('keydown', this.onKey);
  }

  /** A ◀ value ▶ row. Its arrows step on press (the cabinet clicks at once) and repeat while held. */
  private cycler(label: string, prevLabel: string, nextLabel: string, step: (dir: -1 | 1) => void): Cycler {
    const root = document.createElement('div'); root.className = 'versus-cycler';
    root.setAttribute('role', 'group'); root.setAttribute('aria-label', label); root.tabIndex = 0;
    const value = document.createElement('span'); value.className = 'versus-cycle-value';
    const arrow = (dir: -1 | 1, name: string): HTMLButtonElement => {
      const button = document.createElement('button'); button.type = 'button'; button.tabIndex = -1;
      button.className = `versus-arrow versus-arrow-${dir < 0 ? 'prev' : 'next'}`; button.setAttribute('aria-label', name);
      button.dataset.sfx = 'none'; // this screen sounds its own steps (one per step, held repeats too)
      const press = (): void => {
        step(dir); this.ctx.audio.duel?.menu('move');
        pop(button, [{ transform: `translateX(${dir * 7}px) scale(1.25)`, filter: 'brightness(2.2)' }, { transform: 'none', filter: 'none' }], 160, 'ease-out');
      };
      let timer = 0;
      const stop = (): void => { window.clearTimeout(timer); timer = 0; button.classList.remove('held'); };
      button.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || button.disabled) return;
        e.preventDefault(); root.focus({ preventScroll: true }); press(); button.classList.add('held');
        const again = (delay: number): void => { timer = window.setTimeout(() => { if (button.disabled) return stop(); press(); again(85); }, delay); };
        again(340);
      });
      for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) button.addEventListener(type, stop);
      button.addEventListener('click', (e) => { if (e.detail === 0) press(); }); // a keyboard or assistive activation
      return button;
    };
    const prev = arrow(-1, prevLabel), next = arrow(1, nextLabel);
    root.append(prev, value, next);
    return { root, value, prev, next };
  }
  private stepFighter(slot: number, dir: -1 | 1): void {
    const seat = this.ctx.versus?.seats[slot];
    if (seat) this.ctx.versus?.chooseFighter(slot, FIGHTER_ORDER[(FIGHTER_ORDER.indexOf(seat.fighter) + FIGHTER_ORDER.length + dir) % FIGHTER_ORDER.length]);
  }
  /** The devices this seat may take: every connected one but the keyboard for player 2 and what the other seat holds. */
  private deviceChoices(session: VersusApi, slot: number): VersusDevice[] {
    return session.devices.map(d => d.device).filter(d => (slot === 0 || d !== 'keyboard') && (d === 'cpu' || session.seats[1 - slot].device !== d));
  }
  private stepDevice(slot: number, dir: -1 | 1): void {
    const session = this.ctx.versus;
    if (!session) return;
    const choices = this.deviceChoices(session, slot), at = choices.indexOf(session.seats[slot].device);
    const pick = choices[(at + choices.length + dir) % choices.length];
    if (pick && pick !== session.seats[slot].device) session.chooseDevice(slot, pick);
  }
  private stepDifficulty(slot: number, dir: -1 | 1): void {
    const seat = this.ctx.versus?.seats[slot];
    if (!seat) return;
    const level = Math.max(1, Math.min(DUEL_CPU_LEVELS.length, seat.cpuLevel + dir));
    if (level !== seat.cpuLevel) this.ctx.versus?.chooseDifficulty(slot, level);
    else pop(this.seats[slot].difficulty.value, [{ transform: `translateX(${dir * 5}px)` }, { transform: 'none' }], 140, 'ease-out');
  }
  private leave(): void {
    this.ctx.versus?.close(); window.dispatchEvent(new Event('expedition-title-request'));
  }
  /** READY: the keyboard and mouse player's confirm. It readies their seat, and starts the match once everyone is ready. */
  private readyUp(fromKey: boolean): void {
    const session = this.ctx.versus;
    if (!session || session.phase !== 'lobby') return;
    this.ctx.audio.ensure();
    const waiting = keyboardWaiting(session);
    if (!session.canStart && waiting >= 0) session.ready(waiting);
    else if (fromKey) this.ctx.audio.duel?.menu(session.canStart ? 'confirm' : 'back');
    if (session.canStart) {
      pop(this.start, [{ transform: 'scale(1.12)', filter: 'brightness(1.8)' }, { transform: 'none', filter: 'none' }], 200);
      void session.start();
    }
  }
  /** The keyboard cursor's rows, top to bottom: each seat's rows, the chosen stage, READY. */
  private rows(): HTMLElement[] {
    const rows: HTMLElement[] = [];
    for (const seat of this.seats) for (const c of [seat.fighter, seat.device, seat.difficulty]) if (!c.root.hidden) rows.push(c.root);
    const stage = [...this.stages.values()].find(t => t.getAttribute('aria-checked') === 'true');
    if (stage) rows.push(stage);
    rows.push(this.start);
    return rows;
  }
  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.root.hidden && this.root.dataset.phase === 'loading') { this.skipSplash(); return; }
    if (this.root.hidden) {
      if (event.key === 'Tab') this.trapTab(event, this.reconnect);
      return;
    }
    const session = this.ctx.versus;
    if (!session) return;
    const focused = document.activeElement as HTMLElement | null;
    const cycler = focused?.classList.contains('versus-cycler') ? this.seats.flatMap(s => [s.fighter, s.device, s.difficulty]).find(c => c.root === focused) : undefined;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const dir = key === 'ArrowLeft' || key === 'a' ? -1 : key === 'ArrowRight' || key === 'd' ? 1 : 0;
    const move = key === 'ArrowUp' || key === 'w' ? -1 : key === 'ArrowDown' || key === 's' ? 1 : 0;
    if (key === 'Escape' || key === 'Backspace') {
      event.preventDefault(); event.stopPropagation();
      const mine = session.seats.findIndex(s => s.device === 'keyboard');
      if (mine >= 0 && session.seats[mine].ready) { session.ready(mine); this.ctx.audio.duel?.menu('back'); } else this.leave();
      return;
    }
    if (dir) {
      event.preventDefault();
      if (cycler) { (dir < 0 ? cycler.prev : cycler.next).click(); return; }
      if (focused?.classList.contains('versus-stage-tile')) {
        const at = STOCK_STAGE_ORDER.indexOf(session.stage), n = STOCK_STAGE_ORDER.length, id = STOCK_STAGE_ORDER[(at + n + dir) % n];
        session.chooseStage(id); this.stages.get(id)?.focus(); this.ctx.audio.duel?.menu('move');
        return;
      }
      // Anywhere else, left and right turn the keyboard player's own fighter.
      const mine = session.seats.findIndex(s => s.device === 'keyboard');
      if (mine >= 0) { (dir < 0 ? this.seats[mine].fighter.prev : this.seats[mine].fighter.next).click(); this.seats[mine].fighter.root.focus(); }
      return;
    }
    if (move) {
      event.preventDefault();
      const rows = this.rows(), at = rows.indexOf(focused as HTMLElement);
      const next = rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + move))];
      if (next && next !== focused) { next.focus(); this.ctx.audio.duel?.menu('move'); }
      return;
    }
    if ((key === 'Enter' || key === ' ') && (cycler || focused?.classList.contains('versus-stage-tile') || focused === this.root || !focused || !this.root.contains(focused))) {
      event.preventDefault(); this.readyUp(true); return;
    }
    if (key === 'Tab') this.trapTab(event, this.root);
  };
  private trapTab(event: KeyboardEvent, root: HTMLElement): void {
    const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length > 0 && el.tabIndex >= 0);
    const at = controls.indexOf(document.activeElement as HTMLElement);
    if ((event.shiftKey && at <= 0) || (!event.shiftKey && at === controls.length - 1)) {
      event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
    }
  }
  private walkMenu(action: 'previous' | 'next' | 'confirm' | 'back'): void {
    const root = document.querySelector<HTMLElement>('#player-settings[open], #pause-overlay.visible')
      ?? (this.ctx.arena?.stockMatch?.state === 'finished' ? document.querySelector<HTMLElement>('#stock-match-hud .stock-result:not([hidden])') : null);
    if (!root) return;
    if (action === 'back') { if (root.id === 'pause-overlay') this.ctx.events.emit('versusPause'); return; }
    const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled)')].filter(el => el.getClientRects().length > 0 && !el.hidden);
    let at = controls.indexOf(document.activeElement as HTMLElement);
    if (at < 0) at = 0;
    if (action === 'previous' || action === 'next') { at = (at + (action === 'next' ? 1 : controls.length - 1)) % controls.length; this.ctx.audio.duel?.menu('move'); }
    controls[at]?.focus(); if (action === 'confirm') controls[at]?.click();
  }
  private skipSplash(): void {
    if (this.root.dataset.phase === 'loading') this.splash.classList.add('skipped');
  }
  /** The chosen stage's backdrop behind the lobby, cross-faded between two layers. */
  private showBackdrop(id: StockStageId): void {
    if (this.backdropStage === id) return;
    this.backdropStage = id;
    const [a, b] = this.backdrops, next = a.classList.contains('on') ? b : a, prev = next === a ? b : a;
    next.style.backgroundImage = `url("${import.meta.env.BASE_URL}${STOCK_STAGES[id].backdrop}")`;
    next.dataset.stage = id; next.classList.add('on'); prev.classList.remove('on');
  }
  /** Short arcade prompts: who still has to press what. */
  private statusText(session: VersusApi): string {
    if (session.message) return session.message;
    if (session.disconnected.length) return session.disconnected.map(slot => `P${slot + 1} · pad lost`).join(' · ');
    if (session.canStart) return 'All ready!';
    return session.seats.flatMap((seat, slot) => seat.ready ? [] : [`P${slot + 1} · press ${seat.device === 'keyboard' ? 'Enter' : 'A'}`]).join('   ');
  }
  private fillSplash(session: VersusApi): void {
    for (let slot = 0; slot < 2; slot++) {
      const side = this.splash.querySelector(`.versus-splash-${slot}`)!, id = session.seats[slot].fighter;
      showFighterArt(side.querySelector('img')!, id);
      side.querySelector('b')!.textContent = duelShortName(id); side.querySelector('small')!.textContent = duelTitle(id);
    }
    this.splash.querySelector('.versus-splash-stage')!.textContent = STOCK_STAGES[session.stage].name;
  }
  private update(): void {
    const session = this.ctx.versus;
    if (!session) return;
    const show = session.phase === 'lobby' || session.phase === 'loading';
    this.root.hidden = !show;
    document.body.classList.toggle('versus-active', session.active);
    const wasReconnect = !this.reconnect.hidden;
    this.reconnect.hidden = session.phase !== 'reconnect';
    if (!this.reconnect.hidden) {
      this.reconnect.querySelector('p')!.textContent = session.disconnected.length ? `Reconnect ${session.disconnected.map(slot => `P${slot + 1}'s pad`).join(' and ')}.` : 'Back! Press Start to fight.';
      this.reconnect.querySelector<HTMLButtonElement>('[data-resume]')!.disabled = session.disconnected.length > 0;
      if (!wasReconnect) this.reconnect.querySelector<HTMLButtonElement>('[data-lobby]')!.focus();
    }
    if (!show) {
      if (this.shown && document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
      this.shown = false; this.wasLoading = false; return;
    }
    const loading = session.phase === 'loading';
    this.root.dataset.phase = session.phase;
    if (loading && !this.wasLoading) { this.fillSplash(session); this.splash.classList.remove('skipped'); }
    this.wasLoading = loading;
    const opening = !this.shown;
    const deviceKey = JSON.stringify([session.devices, session.seats.map(s => s.device)]);
    for (let slot = 0; slot < 2; slot++) {
      const seat = session.seats[slot], view = this.seats[slot], def = FIGHTER_DEFS[seat.fighter];
      showFighterArt(view.image, seat.fighter);
      view.name.textContent = duelShortName(seat.fighter); view.name.title = def.name; view.title.textContent = duelTitle(seat.fighter);
      view.fighter.root.dataset.value = seat.fighter;
      const index = FIGHTER_ORDER.indexOf(seat.fighter);
      view.pips.forEach((pip, i) => pip.classList.toggle('on', i === index));
      if (view.shown.fighter !== seat.fighter) this.fighterChanged(slot, seat.fighter, opening);
      view.fighter.prev.disabled = view.fighter.next.disabled = loading;
      if (deviceKey !== this.deviceKey) {
        const choices = this.deviceChoices(session, slot);
        view.device.root.dataset.options = choices.join(',');
        view.icon.innerHTML = deviceIcon(seat.device);
      }
      const lost = !session.devices.some(d => d.device === seat.device);
      view.device.value.textContent = lost ? `${duelDeviceLabel(seat.device)} · lost` : duelDeviceLabel(seat.device);
      view.device.root.dataset.value = seat.device;
      view.device.prev.disabled = view.device.next.disabled = loading;
      const isCpu = seat.device === 'cpu';
      view.difficulty.root.hidden = !isCpu; view.difficulty.root.dataset.value = String(seat.cpuLevel);
      view.difficulty.value.innerHTML = `<b>Lv ${seat.cpuLevel}</b> ${DUEL_CPU_LEVELS[seat.cpuLevel - 1] ?? ''}<span class="versus-level">${DUEL_CPU_LEVELS.map((_, i) => `<i${i < seat.cpuLevel ? ' class="on"' : ''}></i>`).join('')}</span>`;
      view.difficulty.prev.disabled = loading || seat.cpuLevel <= 1; view.difficulty.next.disabled = loading || seat.cpuLevel >= DUEL_CPU_LEVELS.length;
      view.ready.setAttribute('aria-pressed', String(seat.ready)); view.ready.disabled = isCpu || loading || session.disconnected.includes(slot);
      view.ready.title = isCpu ? 'The CPU is always ready' : seat.ready ? `P${slot + 1} ready` : `Ready P${slot + 1}`;
      view.card.dataset.ready = view.box.dataset.ready = String(seat.ready);
      view.box.dataset.device = isCpu || seat.device === 'keyboard' ? seat.device : 'pad';
      if (seat.ready && !view.shown.ready && !opening) this.readied(slot);
      view.shown.ready = seat.ready;
    }
    this.deviceKey = deviceKey;
    for (const [id, tile] of this.stages) {
      const on = id === session.stage;
      tile.setAttribute('aria-checked', String(on)); tile.tabIndex = on ? 0 : -1; tile.disabled = loading;
      if (on && this.shownStage !== id && this.shownStage) pop(tile.querySelector('.versus-stage-art')!, [{ transform: 'scale(1.1)', filter: 'brightness(1.9)' }, { transform: 'none', filter: 'none' }], 220);
    }
    this.shownStage = session.stage;
    const stage = STOCK_STAGES[session.stage];
    this.stageLine.textContent = `${stage.name} · ${stage.tagline}`;
    this.showBackdrop(session.stage);
    this.start.disabled = loading || (!session.canStart && keyboardWaiting(session) < 0);
    this.start.dataset.go = String(session.canStart);
    this.start.textContent = session.canStart ? 'Fight!' : 'Ready';
    this.status.textContent = this.statusText(session);
    this.status.dataset.go = String(session.canStart);
    const pads = session.devices.some(d => d.device.startsWith('pad:')), keyboard = session.seats.some(s => s.device === 'keyboard');
    this.keys.innerHTML = [
      keyboard ? `<span>${glyph('←')}${glyph('→')} choose</span><span>${glyph('↑')}${glyph('↓')} move</span><span>${glyph('Enter')} ready</span>` : '',
      pads ? `<span>${glyph('A', 'a')} ready</span><span>${glyph('B', 'b')} back</span><span>${glyph('LB')}${glyph('RB')} stage</span><span>${glyph('Start')} fight</span>` : '',
    ].join('');
    this.notice.hidden = pads;
    if (opening) {
      this.shown = true;
      const mine = session.seats.findIndex(s => s.device === 'keyboard');
      (mine >= 0 ? this.seats[mine].fighter.root : this.start).focus({ preventScroll: true });
      const [duel, stages] = this.root.querySelectorAll('.versus-panel');
      pop(duel, [{ transform: 'translateX(-60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], 260, 'cubic-bezier(.16, 1, .3, 1)');
      pop(stages, [{ transform: 'translateX(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], 260, 'cubic-bezier(.16, 1, .3, 1)');
    }
  }
  /** A new fighter in a seat: the bust slides in from that seat's side with a flash, the name slams down. */
  private fighterChanged(slot: number, id: FighterId, opening: boolean): void {
    const view = this.seats[slot], side = slot === 0 ? -1 : 1;
    view.shown.fighter = id;
    pop(view.frame, [{ transform: `translateX(${side * (opening ? 90 : 46)}px)`, opacity: 0, filter: 'brightness(2.6)' }, { transform: 'none', opacity: 1, filter: 'none' }], opening ? 320 : 190, 'cubic-bezier(.16, 1, .3, 1)');
    pop(view.name, [{ transform: 'scale(1.7)', opacity: 0 }, { transform: 'scale(.94)', opacity: 1, offset: .7 }, { transform: 'none' }], 200, 'ease-out');
  }
  /** A seat locked in: the card pulses in the seat's colour and the badge pops. */
  private readied(slot: number): void {
    const view = this.seats[slot];
    pop(view.box, [{ transform: 'scale(1)' }, { transform: 'scale(1.08)', filter: 'brightness(1.6)', offset: .35 }, { transform: 'none', filter: 'none' }], 300, 'ease-out');
    pop(view.ready, [{ transform: 'scale(.4)' }, { transform: 'scale(1.35)', offset: .55 }, { transform: 'none' }], 300, 'ease-out');
  }
  dispose(): void { for (const off of this.offs) off(); this.root.remove(); this.reconnect.remove(); document.body.classList.remove('versus-active'); }
}

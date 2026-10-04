import type { Ctx } from '@/core/types';
import type { VersusDevice } from '@/core/versus';
import { FIGHTER_DEFS, FIGHTER_ORDER, fighterPortraitUrl } from '@/content/fighters';
import { STOCK_STAGES, STOCK_STAGE_ORDER, type StockStageId } from '@/config/stockStage';
import { STOCK_RULES } from '@/config/stockRules';
import { GAME_TITLE } from '@/config/brand';
import { DUEL_ICON, duelShortName, duelTitle } from '@/ui/duelCopy';
import '@/styles/versus.css';

interface SeatView {
  card: HTMLElement; box: HTMLElement; image: HTMLImageElement; name: HTMLElement; title: HTMLElement;
  prev: HTMLButtonElement; next: HTMLButtonElement; icon: HTMLElement; device: HTMLSelectElement; ready: HTMLButtonElement;
}

const deviceIcon = (device: VersusDevice): string => device === 'cpu' ? DUEL_ICON.cpu : device === 'keyboard' ? DUEL_ICON.keyboard : DUEL_ICON.controller;

/**
 * Player-facing selection and reconnect screens (docs/arena/platform-fighter/concepts/local-versus.png): the DUEL panel
 * (two portraits facing across a compass VS, each seat's device and ready), the CHOOSE A STAGE panel (four tiles and
 * the rules), and a quiet footer for the way back, the status and the controller legend.
 */
export class VersusLobby {
  private readonly root = document.createElement('section');
  private readonly reconnect = document.createElement('section');
  private readonly seats: SeatView[] = [];
  private readonly stages = new Map<StockStageId, HTMLButtonElement>();
  private readonly start = document.createElement('button');
  private readonly status = document.createElement('p');
  private readonly stageName = document.createElement('h3');
  private readonly stageTagline = document.createElement('p');
  private readonly keys = document.createElement('p');
  private readonly notice = document.createElement('p');
  private readonly offs: Array<() => void> = [];
  private deviceKey = '';
  private shown = false;

  constructor(private readonly ctx: Ctx) {
    this.root.id = 'versus-lobby'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-labelledby', 'versus-heading');
    const minutes = Math.round(STOCK_RULES.timeTicks / 3600);
    this.root.innerHTML = `<div class="versus-shell">
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
          <div class="versus-stage-detail" aria-live="polite"></div>
          <ul class="versus-rules" aria-label="Duel rules">
            <li>${DUEL_ICON.stock}<span>${STOCK_RULES.stocks} stocks</span></li>
            <li>${DUEL_ICON.hourglass}<span>${minutes} minutes</span></li>
            <li>${DUEL_ICON.noHazards}<span>Hazards off</span></li>
          </ul>
          <p class="versus-stage-foot">Same elements. New perspective.</p>
        </section>
      </div>
      <footer class="versus-footer"></footer>
    </div>`;
    const seatRow = this.root.querySelector('.versus-seats')!, devices = this.root.querySelector('.versus-devices')!;
    for (let slot = 0; slot < 2; slot++) {
      const player = `Player ${slot + 1}`;
      const card = document.createElement('article'); card.className = `versus-seat versus-seat-${slot}`;
      const frame = document.createElement('div'); frame.className = 'versus-portrait-frame';
      const image = document.createElement('img'); image.alt = ''; image.className = 'versus-portrait'; image.decoding = 'async';
      frame.append(image);
      const plate = document.createElement('div'); plate.className = 'versus-plate';
      const step = (dir: -1 | 1): HTMLButtonElement => {
        const button = document.createElement('button'); button.type = 'button'; button.className = `versus-arrow versus-arrow-${dir < 0 ? 'prev' : 'next'}`;
        button.setAttribute('aria-label', `${dir < 0 ? 'Previous' : 'Next'} fighter for ${player.toLowerCase()}`);
        button.addEventListener('click', () => {
          const seat = ctx.versus?.seats[slot];
          if (seat) ctx.versus?.chooseFighter(slot, FIGHTER_ORDER[(FIGHTER_ORDER.indexOf(seat.fighter) + FIGHTER_ORDER.length + dir) % FIGHTER_ORDER.length]);
        });
        return button;
      };
      const prev = step(-1), next = step(1);
      const names = document.createElement('div'); names.className = 'versus-names';
      const name = document.createElement('h2'), title = document.createElement('p'); title.className = 'versus-fighter-title';
      names.append(name, title); plate.append(prev, names, next);
      card.append(frame, plate);
      if (slot === 0) seatRow.prepend(card); else seatRow.append(card);

      const box = document.createElement('div'); box.className = `versus-device versus-device-${slot}`;
      const label = document.createElement('span'); label.className = 'versus-device-label'; label.textContent = player;
      const row = document.createElement('div'); row.className = 'versus-device-row';
      const icon = document.createElement('span'); icon.className = 'versus-device-icon';
      const device = document.createElement('select'); device.setAttribute('aria-label', `${player} device`);
      device.addEventListener('change', () => { ctx.versus?.chooseDevice(slot, device.value as VersusDevice); this.update(); });
      // The concept's ◂ ▸ beside the device: a pointer shortcut through the same options (the select keeps the keyboard).
      const cycle = (dir: -1 | 1): HTMLElement => {
        const arrow = document.createElement('span'); arrow.className = 'versus-device-step'; arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = dir < 0 ? '◂' : '▸';
        arrow.addEventListener('click', () => {
          if (device.disabled) return;
          const options = [...device.options].filter(o => !o.disabled);
          const at = options.findIndex(o => o.value === device.value);
          const pick = options[(at + options.length + dir) % options.length];
          if (pick && pick.value !== device.value) { ctx.versus?.chooseDevice(slot, pick.value as VersusDevice); this.update(); }
        });
        return arrow;
      };
      row.append(cycle(-1), icon, device, cycle(1));
      const ready = document.createElement('button'); ready.type = 'button'; ready.className = 'versus-ready';
      ready.setAttribute('aria-label', `Ready player ${slot + 1}`);
      ready.addEventListener('click', () => ctx.versus?.ready(slot));
      box.append(label, row, ready); devices.append(box);
      this.seats.push({ card, box, image, name, title, prev, next, icon, device, ready });
    }

    this.start.type = 'button'; this.start.id = 'versus-start'; this.start.textContent = 'Fight';
    this.start.addEventListener('click', () => { ctx.audio.ensure(); void ctx.versus?.start(); });
    this.root.querySelector('.versus-go')!.append(this.start);

    const grid = this.root.querySelector<HTMLElement>('.versus-stage-grid')!;
    for (const id of STOCK_STAGE_ORDER) {
      const def = STOCK_STAGES[id];
      const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'versus-stage-tile';
      tile.setAttribute('role', 'radio'); tile.dataset.stage = id; tile.style.setProperty('--stage-accent', def.accent);
      tile.innerHTML = `<span class="versus-stage-art"><img alt="" decoding="async" src="${import.meta.env.BASE_URL}${def.thumbnail}"></span><span class="versus-stage-name">${def.caption.charAt(0)}${def.caption.slice(1).toLowerCase()}</span>`;
      tile.addEventListener('click', () => ctx.versus?.chooseStage(id));
      grid.append(tile); this.stages.set(id, tile);
    }
    grid.addEventListener('keydown', this.onStageKey);
    this.stageName.className = 'versus-stage-title'; this.stageTagline.className = 'versus-stage-tagline';
    this.root.querySelector('.versus-stage-detail')!.append(this.stageName, this.stageTagline);

    const back = document.createElement('button'); back.type = 'button'; back.className = 'versus-back'; back.textContent = 'Back to title';
    back.addEventListener('click', () => this.leave());
    this.status.className = 'versus-status'; this.status.setAttribute('role', 'status');
    this.keys.className = 'versus-keys';
    this.keys.innerHTML = `${DUEL_ICON.controller}<span><kbd>A</kbd> join · ready</span><span><kbd>◂ ▸</kbd> fighter</span><span><kbd>LB</kbd><kbd>RB</kbd> stage</span><span><kbd>Start</kbd> fight</span>`;
    this.notice.className = 'controller-notice';
    this.notice.innerHTML = `${DUEL_ICON.controller}<span>Best with an Xbox controller: press <kbd>A</kbd> on one to join.</span>`;
    this.root.querySelector('footer')!.append(back, this.status, this.keys, this.notice);

    this.reconnect.id = 'versus-reconnect'; this.reconnect.hidden = true;
    this.reconnect.setAttribute('role', 'dialog'); this.reconnect.setAttribute('aria-modal', 'true'); this.reconnect.setAttribute('aria-labelledby', 'versus-reconnect-heading');
    this.reconnect.innerHTML = `<div class="versus-panel"><div class="versus-head"><h2 id="versus-reconnect-heading">Controller disconnected</h2></div><p role="status"></p><div class="versus-reconnect-actions"><button type="button" data-resume>Resume match</button><button type="button" data-lobby>Change players</button></div></div>`;
    this.reconnect.querySelector('[data-resume]')!.addEventListener('click', () => ctx.versus?.resume());
    this.reconnect.querySelector('[data-lobby]')!.addEventListener('click', () => ctx.versus?.open());
    (document.getElementById('canvas-holder') ?? document.body).append(this.root, this.reconnect);
    this.offs.push(ctx.events.on('versusChanged', () => this.update()), ctx.events.on('versusMenu', ({ action }) => this.walkMenu(action)));
    this.root.addEventListener('keydown', this.onKey); this.reconnect.addEventListener('keydown', this.onKey);
  }
  private leave(): void {
    this.ctx.versus?.close(); window.dispatchEvent(new Event('expedition-title-request'));
  }
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !this.root.hidden) { event.preventDefault(); event.stopPropagation(); this.leave(); return; }
    if (event.key !== 'Tab') return;
    const root = this.root.hidden ? this.reconnect : this.root;
    const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)')].filter(el => el.getClientRects().length > 0 && el.tabIndex >= 0);
    const at = controls.indexOf(document.activeElement as HTMLElement);
    if ((event.shiftKey && at <= 0) || (!event.shiftKey && at === controls.length - 1)) {
      event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
    }
  };
  /** The stage tiles are one radio group: arrows move the choice, Tab leaves the group. */
  private readonly onStageKey = (event: KeyboardEvent): void => {
    const session = this.ctx.versus;
    const dir = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (!session || session.phase !== 'lobby' || (!dir && event.key !== 'Home' && event.key !== 'End')) return;
    event.preventDefault();
    const at = STOCK_STAGE_ORDER.indexOf(session.stage), n = STOCK_STAGE_ORDER.length;
    const id = event.key === 'Home' ? STOCK_STAGE_ORDER[0] : event.key === 'End' ? STOCK_STAGE_ORDER[n - 1] : STOCK_STAGE_ORDER[(at + n + dir) % n];
    session.chooseStage(id); this.stages.get(id)?.focus();
  };
  private walkMenu(action: 'previous' | 'next' | 'confirm' | 'back'): void {
    const root = document.querySelector<HTMLElement>('#player-settings[open], #pause-overlay.visible')
      ?? (this.ctx.arena?.stockMatch?.state === 'finished' ? document.getElementById('stock-match-hud') : null);
    if (!root) return;
    if (action === 'back') { if (root.id === 'pause-overlay') this.ctx.events.emit('versusPause'); return; }
    const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled)')].filter(el => el.getClientRects().length > 0 && !el.hidden);
    let at = controls.indexOf(document.activeElement as HTMLElement);
    if (at < 0) at = 0;
    if (action === 'previous' || action === 'next') at = (at + (action === 'next' ? 1 : controls.length - 1)) % controls.length;
    controls[at]?.focus(); if (action === 'confirm') controls[at]?.click();
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
      this.reconnect.querySelector('p')!.textContent = session.disconnected.length ? `Reconnect ${session.disconnected.map(slot => `Player ${slot + 1}'s controller`).join(' and ')}. The match is paused.` : 'Controllers are back. Press Start or choose Resume match.';
      this.reconnect.querySelector<HTMLButtonElement>('[data-resume]')!.disabled = session.disconnected.length > 0;
      if (!wasReconnect) this.reconnect.querySelector<HTMLButtonElement>('[data-lobby]')!.focus();
    }
    if (!show) {
      if (this.shown && document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
      this.shown = false; return;
    }
    const loading = session.phase === 'loading';
    this.root.dataset.phase = session.phase;
    const deviceKey = JSON.stringify([session.devices, session.seats.map(s => s.device)]);
    for (let slot = 0; slot < 2; slot++) {
      const seat = session.seats[slot], view = this.seats[slot], def = FIGHTER_DEFS[seat.fighter];
      if (view.image.dataset.fighter !== seat.fighter) { view.image.src = fighterPortraitUrl(seat.fighter); view.image.dataset.fighter = seat.fighter; }
      view.name.textContent = duelShortName(seat.fighter); view.name.title = def.name; view.title.textContent = duelTitle(seat.fighter);
      view.prev.disabled = view.next.disabled = loading;
      if (deviceKey !== this.deviceKey) {
        const devices = session.devices.filter(d => slot === 0 || d.device !== 'keyboard');
        if (!devices.some(d => d.device === seat.device)) devices.push({ device: seat.device, label: 'Controller disconnected' });
        view.device.replaceChildren(...devices.map(d => {
          const option = new Option(d.label, d.device); option.disabled = d.device !== 'cpu' && session.seats[1 - slot].device === d.device; return option;
        }));
        view.icon.innerHTML = deviceIcon(seat.device);
      }
      view.device.value = seat.device; view.device.disabled = loading;
      view.ready.textContent = seat.device === 'cpu' ? 'CPU ready' : 'Ready';
      view.ready.setAttribute('aria-pressed', String(seat.ready)); view.ready.disabled = seat.device === 'cpu' || loading || session.disconnected.includes(slot);
      view.card.dataset.ready = view.box.dataset.ready = String(seat.ready);
      view.box.dataset.device = seat.device === 'cpu' || seat.device === 'keyboard' ? seat.device : 'pad';
    }
    this.deviceKey = deviceKey;
    for (const [id, tile] of this.stages) {
      const on = id === session.stage;
      tile.setAttribute('aria-checked', String(on)); tile.tabIndex = on ? 0 : -1; tile.disabled = loading;
    }
    const stage = STOCK_STAGES[session.stage];
    this.stageName.textContent = stage.name; this.stageTagline.textContent = stage.tagline;
    this.start.disabled = !session.canStart;
    this.status.textContent = session.message || (session.disconnected.length ? 'Reconnect the missing controller or choose another device.' : session.canStart ? 'Both fighters are ready.' : 'Choose your fighters and ready each player.');
    const pads = session.devices.some(d => d.device.startsWith('pad:'));
    this.keys.hidden = !pads; this.notice.hidden = pads;
    if (!this.shown) { (this.seats[0].ready.disabled ? this.start : this.seats[0].ready).focus({ preventScroll: true }); this.shown = true; }
  }
  dispose(): void { for (const off of this.offs) off(); this.root.remove(); this.reconnect.remove(); document.body.classList.remove('versus-active'); }
}

import type { Ctx } from '@/core/types';
import type { VersusDevice } from '@/core/versus';
import { FIGHTER_DEFS, FIGHTER_ORDER, fighterPortraitUrl, type FighterId } from '@/content/fighters';
import '@/styles/versus.css';

/** Player-facing selection and reconnect screens, following the local-versus concept. */
export class VersusLobby {
  private readonly root = document.createElement('section');
  private readonly reconnect = document.createElement('section');
  private readonly seats: Array<{ card: HTMLElement; image: HTMLImageElement; name: HTMLElement; title: HTMLElement; fighter: HTMLSelectElement; device: HTMLSelectElement; difficulty: HTMLSelectElement; ready: HTMLButtonElement }> = [];
  private readonly start = document.createElement('button');
  private readonly status = document.createElement('p');
  private readonly offs: Array<() => void> = [];
  private deviceKey = '';
  private shown = false;

  constructor(private readonly ctx: Ctx) {
    this.root.id = 'versus-lobby'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-labelledby', 'versus-heading');
    this.root.innerHTML = `<div class="versus-shell"><header class="versus-header"><p>Alchemist's Descent · Local versus</p><h1 id="versus-heading">Duel</h1><p>Build volatility. Launch your rival. Survive the fall.</p></header><div class="versus-seats"></div><div class="versus-stage"><div class="versus-stage-art" aria-hidden="true"></div><div><span class="versus-kicker">Selected stage</span><h2>The Foundry</h2><p>3 stocks <span>·</span> 6 minutes <span>·</span> Hazards off</p></div></div><footer class="versus-footer"></footer><p class="versus-keys">Press A on a controller to join. D-pad left/right chooses a fighter. A readies your seat. Start begins the match.</p><p class="versus-controls">Xbox controller: left stick moves · A attacks · B casts a special · X/Y jump · LT/RT shield, add direction to dodge · LB/RB grab, then direction to throw · right stick smash · up + B recovery · down + B tactical · Start pause</p></div>`;
    const cards = this.root.querySelector('.versus-seats')!;
    for (let slot = 0; slot < 2; slot++) {
      const card = document.createElement('article'); card.className = `versus-seat versus-seat-${slot}`;
      const image = document.createElement('img'); image.alt = ''; image.className = 'versus-portrait';
      const copy = document.createElement('div'); copy.className = 'versus-seat-copy';
      const identity = document.createElement('p'); identity.className = 'versus-kicker'; identity.textContent = `Player ${slot + 1}`;
      const name = document.createElement('h2'), title = document.createElement('p'); title.className = 'versus-fighter-title';
      const fighter = document.createElement('select'); fighter.setAttribute('aria-label', `Player ${slot + 1} fighter`);
      for (const id of FIGHTER_ORDER) fighter.add(new Option(FIGHTER_DEFS[id].name, id));
      fighter.addEventListener('change', () => ctx.versus?.chooseFighter(slot, fighter.value as FighterId));
      const device = document.createElement('select'); device.setAttribute('aria-label', `Player ${slot + 1} device`);
      device.addEventListener('change', () => { ctx.versus?.chooseDevice(slot, device.value as VersusDevice); this.update(); });
      const difficulty = document.createElement('select'); difficulty.setAttribute('aria-label', `Player ${slot + 1} CPU difficulty`);
      ['1 · Gentle', '2 · Easy', '3 · Normal', '4 · Hard', '5 · Expert'].forEach((label, i) => difficulty.add(new Option(label, String(i + 1))));
      difficulty.title = 'Higher levels react faster and adapt more strongly to moves that work against you.';
      difficulty.addEventListener('change', () => ctx.versus?.chooseDifficulty(slot, Number(difficulty.value)));
      const ready = document.createElement('button'); ready.type = 'button'; ready.className = 'versus-ready';
      ready.addEventListener('click', () => ctx.versus?.ready(slot));
      copy.append(identity, name, title, fighter, device, difficulty, ready); card.append(image, copy); cards.append(card);
      this.seats.push({ card, image, name, title, fighter, device, difficulty, ready });
    }
    const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back to title'; back.addEventListener('click', () => this.leave());
    this.start.type = 'button'; this.start.id = 'versus-start'; this.start.textContent = 'Enter the Foundry'; this.start.addEventListener('click', () => { ctx.audio.ensure(); void ctx.versus?.start(); });
    this.status.className = 'versus-status'; this.status.setAttribute('role', 'status');
    this.root.querySelector('footer')!.append(back, this.status, this.start);
    this.reconnect.id = 'versus-reconnect'; this.reconnect.hidden = true;
    this.reconnect.setAttribute('role', 'dialog'); this.reconnect.setAttribute('aria-modal', 'true'); this.reconnect.setAttribute('aria-labelledby', 'versus-reconnect-heading');
    this.reconnect.innerHTML = `<div><h2 id="versus-reconnect-heading">Controller disconnected</h2><p role="status"></p><button type="button" data-resume>Resume match</button><button type="button" data-lobby>Change players</button></div>`;
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
    const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)')].filter(el => el.getClientRects().length > 0);
    const at = controls.indexOf(document.activeElement as HTMLElement);
    if ((event.shiftKey && at <= 0) || (!event.shiftKey && at === controls.length - 1)) {
      event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
    }
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
    const deviceKey = JSON.stringify([session.devices, session.seats.map(s => s.device)]);
    for (let slot = 0; slot < 2; slot++) {
      const seat = session.seats[slot], view = this.seats[slot], def = FIGHTER_DEFS[seat.fighter];
      if (view.image.dataset.fighter !== seat.fighter) { view.image.src = fighterPortraitUrl(seat.fighter); view.image.dataset.fighter = seat.fighter; }
      view.name.textContent = def.name; view.title.textContent = def.title;
      view.fighter.value = seat.fighter; view.fighter.disabled = session.phase === 'loading';
      if (deviceKey !== this.deviceKey) {
        const devices = session.devices.filter(d => slot === 0 || d.device !== 'keyboard');
        if (!devices.some(d => d.device === seat.device)) devices.push({ device: seat.device, label: 'Controller disconnected' });
        view.device.replaceChildren(...devices.map(d => {
          const option = new Option(d.label, d.device); option.disabled = d.device !== 'cpu' && session.seats[1 - slot].device === d.device; return option;
        }));
      }
      view.device.value = seat.device; view.device.disabled = session.phase === 'loading';
      view.difficulty.value = String(seat.cpuLevel); view.difficulty.hidden = seat.device !== 'cpu'; view.difficulty.disabled = session.phase === 'loading';
      view.ready.textContent = seat.device === 'cpu' ? 'CPU ready' : seat.ready ? `Player ${slot + 1} ready ✓` : `Ready player ${slot + 1}`;
      view.ready.setAttribute('aria-pressed', String(seat.ready)); view.ready.disabled = seat.device === 'cpu' || session.phase === 'loading' || session.disconnected.includes(slot);
      view.card.dataset.ready = String(seat.ready);
    }
    this.deviceKey = deviceKey;
    this.start.disabled = !session.canStart;
    this.status.textContent = session.message || (session.disconnected.length ? 'Reconnect the missing controller or choose another device.' : session.canStart ? 'Both fighters are ready.' : 'Choose your fighters and ready each player.');
    if (!this.shown) { this.seats[0].fighter.focus(); this.shown = true; }
  }
  dispose(): void { for (const off of this.offs) off(); this.root.remove(); this.reconnect.remove(); document.body.classList.remove('versus-active'); }
}

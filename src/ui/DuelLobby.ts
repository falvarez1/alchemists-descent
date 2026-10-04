import type { Ctx } from '@/core/types';
import { FIGHTER_DEFS, FIGHTER_ORDER, type FighterId } from '@/content/fighters';
import { STOCK_STAGES, DEFAULT_STOCK_STAGE } from '@/config/stockStage';
import { getBindings, keyLabel } from '@/input/bindings';
import { GAME_TITLE } from '@/config/brand';
import { DUEL_ICON, duelShortName, duelTitle, showFighterArt } from '@/ui/duelCopy';
import '@/styles/versus.css';
import '@/styles/duel-lan.css';

const reducedMotion = (): boolean => document.body.classList.contains('reduce-flashes') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
function pop(el: Element, frames: Keyframe[], duration: number, easing = 'cubic-bezier(.2, 1.5, .45, 1)'): void {
  if (!reducedMotion()) el.animate(frames, { duration, easing });
}
const glyph = (text: string): string => `<kbd class="versus-glyph">${text}</kbd>`;

interface SeatView { card: HTMLElement; frame: HTMLElement; image: HTMLImageElement; name: HTMLElement; title: HTMLElement; pips: HTMLElement[]; cycler: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement; select: HTMLSelectElement; state: HTMLElement; badge: HTMLElement; box: HTMLElement; shown: string }

/**
 * The LAN Duel's lobby (docs/DUEL-LAN.md), dressed as the same arcade cabinet as the local select screen (ui/VersusLobby):
 * the DUEL panel with both busts facing across the VS, each seat's ◀ NAME ▶ (only your own seat turns) and its card
 * (PLAYER N, you / host, waiting / choosing / ready), and the CONNECT panel (Host a match, or a room code to join; then
 * the room code large, where the other computer goes, the status). The big copper buttons are Ready, Start, Resume and
 * Change fighters as the room's phase allows. UI consumes session state; it never owns sockets or mutates a fighter.
 * Each fighter seat keeps its real <select> ("LAN Player N fighter", the probe's handle), visually replaced by the cycler.
 */
export class DuelLobby {
  private readonly root = document.createElement('section');
  private readonly bar = document.createElement('div');
  private readonly off: Array<() => void> = [];
  private readonly seats: SeatView[] = [];
  private opened = false;
  private wasVisible = false;
  private addresses: string[] = [];
  constructor(private readonly ctx: Ctx) {
    this.root.id = 'duel-network';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'duel-network-heading');
    const stage = STOCK_STAGES[DEFAULT_STOCK_STAGE];
    this.root.innerHTML = `<div class="versus-backdrop" aria-hidden="true"><div class="on" style="background-image:url('${import.meta.env.BASE_URL}${stage.backdrop}')"></div></div>
    <div class="versus-shell">
      <div class="versus-top"><p class="versus-brand"><span class="versus-sigil">${DUEL_ICON.sigil}</span>${GAME_TITLE}</p><p class="versus-motto">LAN · Two computers. One ${stage.caption.charAt(0)}${stage.caption.slice(1).toLowerCase()}.</p></div>
      <div class="versus-panels">
        <section class="versus-panel versus-duel duel-lan-duel">
          <div class="versus-head"><h1 id="duel-network-heading">Duel</h1><p>Over LAN · three stocks each</p></div>
          <div class="versus-seats"><div class="versus-vs" aria-hidden="true">${DUEL_ICON.compass}<span>VS</span></div></div>
          <div class="versus-devices"></div>
          <div class="versus-go duel-go-row">
            <button type="button" class="duel-go" data-ready>Ready</button>
            <button type="button" class="duel-go" data-start>Start match</button>
            <button type="button" class="duel-go" data-resume>Resume match</button>
            <button type="button" class="duel-go duel-go-quiet" data-fighters>Change fighters</button>
          </div>
        </section>
        <section class="versus-panel duel-lan-connect" aria-labelledby="duel-connect-heading">
          <div class="versus-head"><h2 id="duel-connect-heading">Connect</h2><p>Same network. Same server.</p></div>
          <div class="duel-connect">
            <button type="button" class="duel-go" data-host>Host a match</button>
            <p class="duel-or" aria-hidden="true">or</p>
            <form><label class="duel-code-label">Room code <input aria-label="Room code" maxlength="6" autocomplete="off" spellcheck="false" pattern="[A-Za-z0-9]{6}" required placeholder="······"></label><button type="submit" class="duel-go duel-go-quiet">Join match</button></form>
          </div>
          <div class="duel-room">
            <p class="duel-room-label">Room</p>
            <p class="duel-room-code"></p>
            <p class="duel-you"></p>
            <p class="duel-address"></p>
          </div>
          <p class="duel-status" role="status" aria-live="polite"></p>
          <p class="duel-help"></p>
        </section>
      </div>
      <footer class="versus-footer duel-footer"><div class="versus-actions"><button type="button" class="versus-back" data-leave data-sfx="back"></button></div><span></span><span></span></footer>
    </div>`;
    const seatRow = this.root.querySelector('.versus-seats')!, devices = this.root.querySelector('.versus-devices')!;
    for (const slot of [0, 1]) {
      const card = document.createElement('article');
      card.className = `versus-seat versus-seat-${slot}`;
      card.innerHTML = `<div class="versus-portrait-frame"><img class="versus-portrait bust-fit" alt="" decoding="async"></div>
        <div class="versus-cycler versus-plate" role="group" aria-label="Player ${slot + 1} fighter">
          <button type="button" class="versus-arrow versus-arrow-prev" aria-label="Previous fighter for player ${slot + 1}" data-sfx="none" tabindex="-1"></button>
          <span class="versus-cycle-value versus-names"><h2></h2><p class="versus-fighter-title"></p><span class="versus-pips" aria-hidden="true">${FIGHTER_ORDER.map(() => '<i></i>').join('')}</span></span>
          <button type="button" class="versus-arrow versus-arrow-next" aria-label="Next fighter for player ${slot + 1}" data-sfx="none" tabindex="-1"></button>
          <select class="duel-fighter-select" aria-label="LAN Player ${slot + 1} fighter" tabindex="-1"></select>
        </div>`;
      const select = card.querySelector('select')!;
      for (const id of FIGHTER_ORDER) select.add(new Option(FIGHTER_DEFS[id].name, id));
      select.addEventListener('change', () => ctx.duel?.choose(select.value as FighterId));
      const cycler = card.querySelector<HTMLElement>('.versus-cycler')!;
      const prev = card.querySelector<HTMLButtonElement>('.versus-arrow-prev')!, next = card.querySelector<HTMLButtonElement>('.versus-arrow-next')!;
      const step = (dir: -1 | 1): void => {
        if (select.disabled) return;
        const id = FIGHTER_ORDER[(FIGHTER_ORDER.indexOf(select.value as FighterId) + FIGHTER_ORDER.length + dir) % FIGHTER_ORDER.length];
        select.value = id; ctx.duel?.choose(id); ctx.audio.duel?.menu('move');
        pop(dir < 0 ? prev : next, [{ transform: `translateX(${dir * 7}px) scale(1.25)`, filter: 'brightness(2.2)' }, { transform: 'none', filter: 'none' }], 160, 'ease-out');
      };
      for (const [button, dir] of [[prev, -1], [next, 1]] as const) {
        let timer = 0;
        const stop = (): void => { window.clearTimeout(timer); button.classList.remove('held'); };
        button.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || button.disabled) return;
          e.preventDefault(); cycler.focus({ preventScroll: true }); step(dir); button.classList.add('held');
          const again = (delay: number): void => { timer = window.setTimeout(() => { if (button.disabled) return stop(); step(dir); again(85); }, delay); };
          again(340);
        });
        for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) button.addEventListener(type, stop);
        button.addEventListener('click', (e) => { if (e.detail === 0) step(dir); });
      }
      cycler.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowLeft' || e.key === 'a' ? -1 : e.key === 'ArrowRight' || e.key === 'd' ? 1 : 0;
        if (dir) { e.preventDefault(); step(dir); }
      });
      if (slot === 0) seatRow.prepend(card); else seatRow.append(card);
      const box = document.createElement('div'); box.className = `versus-device versus-device-${slot}`;
      box.innerHTML = `<span class="versus-device-label">Player ${slot + 1}</span><span class="versus-ready" aria-hidden="true">${DUEL_ICON.check}</span><p class="duel-seat-state"></p>`;
      devices.append(box);
      this.seats.push({
        card, frame: card.querySelector('.versus-portrait-frame')!, image: card.querySelector('img')!, name: card.querySelector('h2')!, title: card.querySelector('.versus-fighter-title')!,
        pips: [...card.querySelectorAll<HTMLElement>('.versus-pips i')], cycler, prev, next, select, state: box.querySelector('.duel-seat-state')!, badge: box.querySelector('.versus-ready')!, box, shown: '',
      });
    }
    const on = (selector: string, action: () => void): void => {
      this.root.querySelector(selector)!.addEventListener('click', () => {
        ctx.audio.ensure();
        action();
      });
    };
    on('[data-host]', () => ctx.duel?.host());
    on('[data-ready]', () => ctx.duel?.ready());
    on('[data-start]', () => ctx.duel?.start());
    on('[data-resume]', () => ctx.duel?.resume());
    on('[data-fighters]', () => ctx.duel?.lobby());
    on('[data-leave]', () => {
      this.opened = false;
      ctx.duel?.leave();
      ctx.versus?.open();
      this.update();
    });
    const input = this.root.querySelector('input')!;
    input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    this.root.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      ctx.audio.ensure();
      ctx.duel?.join(input.value);
    });
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const controls = [
        ...this.root.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),input,[tabindex="0"]'),
      ].filter((e) => e.getClientRects().length > 0);
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === controls.length - 1)) {
        event.preventDefault();
        controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
      }
    });
    // In a match: a framed tab under the timer's corner with the ping and the shared pause.
    this.bar.id = 'duel-network-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = `<span></span><button type="button">${glyph('Esc')}Pause match</button>`;
    this.bar.querySelector('button')!.setAttribute('aria-label', 'Pause match');
    this.bar.querySelector('button')!.addEventListener('click', () => ctx.duel?.pause());
    document.body.append(this.root, this.bar);
    this.off.push(
      ctx.events.on('duelOpen', () => {
        ctx.versus?.close();
        this.opened = true;
        this.update();
        void fetch('/__duel-addresses')
          .then((r) => (r.ok ? (r.json() as Promise<unknown>) : []))
          .then((addresses) => {
            if (Array.isArray(addresses))
              this.addresses = addresses
                .filter((a): a is string => typeof a === 'string' && /^https?:\/\/[\d.]+:\d+\/$/.test(a))
                .sort((a, b) => Number(b.includes('192.168.')) - Number(a.includes('192.168.')));
            this.update();
          })
          .catch(() => {
            /* Connection failures get their own session message. */
          });
      }),
      ctx.events.on('duelChanged', () => this.update()),
    );
  }
  private update(): void {
    const duel = this.ctx.duel,
      room = duel?.room;
    if (!duel) return;
    const visible = this.opened && (!duel.connected || !room || room.phase !== 'playing');
    this.root.hidden = !visible;
    this.bar.hidden = !duel.active || !duel.connected || room?.phase !== 'playing';
    this.bar.querySelector('span')!.textContent = `LAN · P${(duel.slot ?? 0) + 1} · ${duel.latency} ms`;
    this.bar.querySelector('span')!.title = 'Round trip to the LAN server. The host connects locally; the other computer crosses your network.';
    document.body.classList.toggle('versus-active', duel.active || this.ctx.versus?.active === true);
    this.root.dataset.room = room ? room.phase : 'none';
    this.root.querySelector<HTMLElement>('.duel-connect')!.hidden = duel.active;
    this.root.querySelector<HTMLElement>('.duel-room')!.hidden = !room;
    this.root.querySelector<HTMLElement>('.versus-seats')!.hidden = !room;
    this.root.querySelector<HTMLElement>('.versus-devices')!.hidden = !room;
    this.root.querySelector('.duel-room-code')!.textContent = room?.room ?? '';
    this.root.querySelector('.duel-you')!.textContent = room ? `You are P${(duel.slot ?? 0) + 1}${duel.slot === 0 ? ' · Host' : ''}` : '';
    const address = !['localhost', '127.0.0.1'].includes(location.hostname) ? location.origin + '/' : this.addresses[0];
    this.root.querySelector('.duel-address')!.innerHTML =
      room && duel.slot === 0
        ? `Other computer: open <b>${address ?? 'this computer’s LAN address, port 5180'}</b> → Duel → Play over LAN → <b>${room.room}</b>`
        : room ? '' : 'Both computers open the game from the same LAN server.';
    this.root.querySelector('.duel-status')!.textContent =
      duel.status || 'Host here, or enter the other computer’s code.';
    const keys = getBindings();
    this.root.querySelector('.duel-help')!.innerHTML =
      `<span>${glyph(keyLabel(keys.left))}${glyph(keyLabel(keys.right))} move</span><span>${glyph(keyLabel(keys.jump))} jump</span><span>${glyph(keyLabel(keys.kick))} melee</span><span>${glyph(keyLabel(keys.carry))} grab</span><span>${glyph(keyLabel(keys.dodge))} shield</span><span>${glyph('Click')} special</span><span>${glyph('Esc')} pause</span>`
      + (!isSecureContext ? '<span class="duel-note">Pads need HTTPS in some browsers</span>' : '');
    for (const slot of [0, 1]) {
      const view = this.seats[slot],
        seat = room?.seats[slot];
      if (!seat) continue;
      const def = FIGHTER_DEFS[seat.fighter];
      showFighterArt(view.image, seat.fighter);
      view.name.textContent = duelShortName(seat.fighter); view.name.title = def.name;
      view.title.textContent = duelTitle(seat.fighter);
      const index = FIGHTER_ORDER.indexOf(seat.fighter);
      view.pips.forEach((pip, i) => pip.classList.toggle('on', i === index));
      view.select.value = seat.fighter;
      const mine = slot === duel.slot && room?.phase === 'lobby' && duel.connected;
      view.select.disabled = !mine;
      view.prev.disabled = view.next.disabled = !mine;
      view.cycler.tabIndex = mine ? 0 : -1;
      view.cycler.dataset.value = seat.fighter;
      view.card.dataset.mine = view.box.dataset.mine = String(slot === duel.slot);
      view.state.textContent = !seat.connected ? 'Waiting…' : seat.ready ? 'Ready!' : slot === duel.slot ? 'Pick & ready' : 'Choosing';
      // (not data-ready: the probe and the buttons own [data-ready])
      view.box.dataset.locked = String(seat.ready); view.badge.setAttribute('data-on', String(seat.ready));
      view.box.dataset.waiting = String(!seat.connected);
      if (view.shown !== seat.fighter) {
        const side = slot === 0 ? -1 : 1;
        if (view.shown) {
          // Either seat's new fighter is called by name on both computers (a newer name cuts the last).
          this.ctx.audio.duel?.announceFighter(seat.fighter);
          pop(view.frame, [{ transform: `translateX(${side * 46}px)`, opacity: 0, filter: 'brightness(2.6)' }, { transform: 'none', opacity: 1, filter: 'none' }], 190, 'cubic-bezier(.16, 1, .3, 1)');
          pop(view.name, [{ transform: 'scale(1.7)', opacity: 0 }, { transform: 'scale(.94)', opacity: 1, offset: .7 }, { transform: 'none' }], 200, 'ease-out');
        }
        view.shown = seat.fighter;
      }
    }
    const button = (key: string, show: boolean, enabled: boolean): HTMLButtonElement => {
      const b = this.root.querySelector<HTMLButtonElement>(`[data-${key}]`)!;
      b.hidden = !show;
      b.disabled = !enabled;
      return b;
    };
    const ready = button('ready', room?.phase === 'lobby', duel.connected);
    ready.textContent = duel.slot !== null && room?.seats[duel.slot].ready ? 'Not ready' : 'Ready';
    ready.dataset.on = String(duel.slot !== null && room?.seats[duel.slot].ready === true);
    const start = button(
      'start',
      room?.phase === 'lobby' && duel.slot === 0,
      duel.connected && room?.seats.every((s) => s.connected && s.ready) === true,
    );
    start.dataset.go = String(!start.disabled);
    button(
      'resume',
      room?.phase === 'paused' && duel.slot === 0,
      duel.connected && room?.seats.every((s) => s.connected) === true,
    );
    button('fighters', room?.phase === 'paused' && duel.slot === 0, duel.connected);
    // (no key on this one: Esc in a paused room must never throw the room away)
    this.root.querySelector('[data-leave]')!.textContent = duel.active ? 'Leave room' : 'Back to Duel';
    if (visible && !this.wasVisible) {
      this.root.querySelector<HTMLElement>('button:not([hidden]):not(:disabled):not([tabindex="-1"])')?.focus();
      const [left, right] = this.root.querySelectorAll('.versus-panel');
      pop(left, [{ transform: 'translateX(-60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], 260, 'cubic-bezier(.16, 1, .3, 1)');
      pop(right, [{ transform: 'translateX(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], 260, 'cubic-bezier(.16, 1, .3, 1)');
    }
    this.wasVisible = visible;
  }
  dispose(): void {
    this.off.forEach((off) => off());
    this.root.remove();
    this.bar.remove();
  }
}

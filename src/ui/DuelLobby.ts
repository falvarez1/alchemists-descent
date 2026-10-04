import type { Ctx } from '@/core/types';
import { FIGHTER_DEFS, FIGHTER_ORDER, fighterPortraitUrl, type FighterId } from '@/content/fighters';
import { getBindings, keyLabel } from '@/input/bindings';
import '@/styles/duel-lan.css';

/** UI consumes session state; it never owns sockets or mutates a fighter. */
export class DuelLobby {
  private readonly root = document.createElement('section');
  private readonly bar = document.createElement('div');
  private readonly off: Array<() => void> = [];
  private opened = false;
  private wasVisible = false;
  private addresses: string[] = [];
  constructor(private readonly ctx: Ctx) {
    this.root.id = 'duel-network';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'duel-network-heading');
    this.root.innerHTML = `<div class="versus-shell"><header class="versus-header"><p>Alchemist's Descent · LAN multiplayer</p><h1 id="duel-network-heading">Duel</h1><p>Two computers. One Foundry. Three stocks each.</p></header>
      <div class="duel-connect"><button type="button" data-host>Host a match</button><form><label>Room code <input aria-label="Room code" maxlength="6" autocomplete="off" spellcheck="false" pattern="[A-Za-z0-9]{6}" required></label><button type="submit">Join match</button></form></div>
      <p class="duel-address"></p><p class="duel-room-code"></p><div class="versus-seats"></div>
      <p class="duel-status" role="status" aria-live="polite"></p><p class="duel-help"></p>
      <footer class="duel-footer"><button type="button" data-leave>Back to Duel</button><button type="button" data-ready>Ready</button><button type="button" data-start>Start match</button><button type="button" data-resume>Resume match</button><button type="button" data-fighters>Change fighters</button></footer></div>`;
    for (const slot of [0, 1]) {
      const card = document.createElement('article');
      card.className = `versus-seat versus-seat-${slot}`;
      card.innerHTML = `<img class="versus-portrait" alt=""><div class="versus-seat-copy"><p class="versus-kicker">Player ${slot + 1}</p><h2></h2><p class="versus-fighter-title"></p><select aria-label="LAN Player ${slot + 1} fighter"></select><p class="duel-seat-state"></p></div>`;
      const select = card.querySelector('select')!;
      for (const id of FIGHTER_ORDER) select.add(new Option(FIGHTER_DEFS[id].name, id));
      select.addEventListener('change', () => ctx.duel?.choose(select.value as FighterId));
      this.root.querySelector('.versus-seats')!.append(card);
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
    this.root.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      ctx.audio.ensure();
      ctx.duel?.join(this.root.querySelector('input')!.value);
    });
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const controls = [
        ...this.root.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input'),
      ].filter((e) => e.getClientRects().length > 0);
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === controls.length - 1)) {
        event.preventDefault();
        controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
      }
    });
    this.bar.id = 'duel-network-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = '<span></span><button type="button">Pause match</button>';
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
    document.body.classList.toggle('versus-active', duel.active || this.ctx.versus?.active === true);
    this.root.querySelector<HTMLElement>('.duel-connect')!.hidden = duel.active;
    this.root.querySelector<HTMLElement>('.versus-seats')!.hidden = !room;
    this.root.querySelector('.duel-room-code')!.textContent = room
      ? `Room ${room.room} · You are Player ${(duel.slot ?? 0) + 1}${duel.slot === 0 ? ' · Host' : ''}`
      : '';
    const address = !['localhost', '127.0.0.1'].includes(location.hostname) ? location.origin + '/' : this.addresses[0];
    this.root.querySelector('.duel-address')!.textContent =
      room && duel.slot === 0
        ? `On the other computer, open ${address ?? 'this computer’s LAN address on port 5180'}, choose Duel → Play over LAN, and enter ${room.room}.`
        : 'Both computers must open the game from the same LAN server.';
    this.root.querySelector('.duel-status')!.textContent =
      duel.status || 'Host here, or enter the code shown on the other computer.';
    const keys = getBindings();
    this.root.querySelector('.duel-help')!.textContent =
      `${keyLabel(keys.left)}/${keyLabel(keys.right)} move · ${keyLabel(keys.jump)} jump · ${keyLabel(keys.up)} + jump recover · ${keyLabel(keys.kick)} melee · ${keyLabel(keys.carry)} grab · ${keyLabel(keys.dodge)} shield · click special · Esc pause.${!isSecureContext ? ' Keyboard and mouse work over LAN HTTP. Controllers require HTTPS in browsers that restrict the Gamepad API.' : ' A connected controller also works.'}`;
    for (const slot of [0, 1]) {
      const card = this.root.querySelectorAll<HTMLElement>('.versus-seat')[slot],
        seat = room?.seats[slot];
      if (!seat) continue;
      const def = FIGHTER_DEFS[seat.fighter],
        image = card.querySelector('img')!;
      if (image.dataset.fighter !== seat.fighter) {
        image.src = fighterPortraitUrl(seat.fighter);
        image.dataset.fighter = seat.fighter;
      }
      card.querySelector('h2')!.textContent = def.name;
      card.querySelector('.versus-fighter-title')!.textContent = def.title;
      const select = card.querySelector('select')!;
      select.value = seat.fighter;
      select.disabled = slot !== duel.slot || room?.phase !== 'lobby' || !duel.connected;
      card.querySelector('.duel-seat-state')!.textContent = !seat.connected
        ? 'Waiting for connection'
        : seat.ready
          ? 'Ready'
          : 'Choosing fighter';
    }
    const button = (key: string, show: boolean, enabled: boolean): HTMLButtonElement => {
      const b = this.root.querySelector<HTMLButtonElement>(`[data-${key}]`)!;
      b.hidden = !show;
      b.disabled = !enabled;
      return b;
    };
    button('ready', room?.phase === 'lobby', duel.connected).textContent =
      duel.slot !== null && room?.seats[duel.slot].ready ? 'Not ready' : 'Ready';
    button(
      'start',
      room?.phase === 'lobby' && duel.slot === 0,
      duel.connected && room?.seats.every((s) => s.connected && s.ready) === true,
    );
    button(
      'resume',
      room?.phase === 'paused' && duel.slot === 0,
      duel.connected && room?.seats.every((s) => s.connected) === true,
    );
    button('fighters', room?.phase === 'paused' && duel.slot === 0, duel.connected);
    this.root.querySelector('[data-leave]')!.textContent = duel.active ? 'Leave room' : 'Back to Duel';
    if (visible && !this.wasVisible)
      this.root.querySelector<HTMLElement>('button:not([hidden]):not(:disabled)')?.focus();
    this.wasVisible = visible;
  }
  dispose(): void {
    this.off.forEach((off) => off());
    this.root.remove();
    this.bar.remove();
  }
}

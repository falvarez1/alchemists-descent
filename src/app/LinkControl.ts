import type { AuthorLinkConfig } from '@/app/authorLinkConfig';
import type { AuthorLinkWorldState } from '@/app/AuthorLink';
import {
  deriveLinkView,
  gameUrl,
  makeRoomCode,
  parseLinkInput,
  type LinkView,
} from '@/app/authorLinkView';
import type { AuthorLinkStatus } from '@/net/authorLinkProtocol';
import { editorIcon } from '@/ui/editor/icons';
import { escapeAttr, escapeHtml } from '@/core/strings';

/**
 * The "Game Link" control: a toolbar button whose label IS the link's state,
 * and a popover that says what is wrong and offers the one thing to click.
 *
 * It replaces a header pill that read `LINK ·` whether nobody had joined, the
 * room name had a typo, or a hosted relay was silently refusing every write.
 * All the judgement lives in `authorLinkView.ts`; this file is only DOM.
 *
 * It lives in `src/app` and takes the link through a narrow `LinkSource`, so
 * it imports nothing from the Builder and the same control serves the editor
 * toolbar and (later) the game window.
 */

export interface LinkSource {
  getStatus(): AuthorLinkStatus | null;
  onStatus(handler: (status: AuthorLinkStatus) => void): () => void;
  getWorldState(): AuthorLinkWorldState | null;
  onWorldState(handler: (state: AuthorLinkWorldState) => void): () => void;
  pullWorldFrom(clientId?: string): Promise<boolean>;
}

export interface LinkControlOptions {
  /** Where the button is mounted. */
  host: HTMLElement;
  config: AuthorLinkConfig;
  /** Null when this window has no link at all (production, `?link=off`, automation). */
  link: LinkSource | null;
  /** True in the editor: its job is to reach a game. */
  isEditor: boolean;
  /** Ask before a pull replaces this window's terrain. Resolve false to cancel. */
  confirmPull?: (peerLabel: string) => Promise<boolean>;
  toast?: (text: string) => void;
  /** Injected for tests; defaults to the real window. */
  win?: Pick<Window, 'open' | 'location' | 'addEventListener' | 'removeEventListener'>;
  /** Called with a room address just before the window navigates to it (the editor saves a draft). */
  beforeLeave?: () => void;
}

const POPOVER_ID = 'st-link-popover';

export class LinkControl {
  readonly button: HTMLButtonElement;
  private readonly pop: HTMLDivElement;
  private readonly disposers: Array<() => void> = [];
  private view: LinkView;
  private open = false;
  private attention = false;
  private lastState: LinkView['state'] | null = null;
  private roomEditorOpen = false;
  private pulling = false;
  private waitingForGame = false;
  private waitTimer = 0;

  constructor(private readonly opts: LinkControlOptions) {
    const doc = opts.host.ownerDocument;
    this.button = doc.createElement('button');
    this.button.type = 'button';
    this.button.className = 'st-btn st-link';
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => this.toggle());
    opts.host.appendChild(this.button);

    this.pop = doc.createElement('div');
    this.pop.id = POPOVER_ID;
    this.pop.className = 'st-link-pop';
    this.pop.setAttribute('role', 'dialog');
    this.pop.setAttribute('aria-label', 'Game link');
    this.pop.hidden = true;
    doc.body.appendChild(this.pop);
    this.pop.addEventListener('click', this.onPopClick);
    this.pop.addEventListener('keydown', this.onPopKey);

    const refresh = (): void => this.refresh();
    if (opts.link) {
      this.disposers.push(opts.link.onStatus(refresh), opts.link.onWorldState(refresh));
    }
    doc.addEventListener('pointerdown', this.onDocPointer, true);
    doc.addEventListener('keydown', this.onDocKey, true);
    window.addEventListener('resize', this.onResize, { passive: true });
    this.view = this.derive();
    this.render();
  }

  dispose(): void {
    window.clearTimeout(this.waitTimer);
    for (const d of this.disposers.splice(0)) d();
    const doc = this.button.ownerDocument;
    doc.removeEventListener('pointerdown', this.onDocPointer, true);
    doc.removeEventListener('keydown', this.onDocKey, true);
    window.removeEventListener('resize', this.onResize);
    this.pop.remove();
    this.button.remove();
  }

  /** The current view, for tests and for callers that want to mirror the state. */
  getView(): LinkView {
    return this.view;
  }

  /* ------------------------------------------------------------ state */

  private derive(): LinkView {
    return deriveLinkView({
      config: this.opts.config,
      status: this.opts.link?.getStatus() ?? null,
      world: this.opts.link?.getWorldState() ?? null,
      isEditor: this.opts.isEditor,
    });
  }

  private refresh(): void {
    const previous = this.lastState;
    this.view = this.derive();
    if (this.view.state !== 'waiting' && this.waitingForGame) {
      this.waitingForGame = false;
      window.clearTimeout(this.waitTimer);
    }
    // The state that silently drops every edit should not wait to be noticed.
    if (this.view.state === 'different' && previous !== 'different' && this.opts.isEditor && !this.open) {
      this.attention = true;
      this.opts.toast?.('The game is on a different level — open Game link to use it');
    }
    if (this.view.state !== 'different') this.attention = false;
    this.render();
  }

  private render(): void {
    const v = this.view;
    this.lastState = v.state;
    const b = this.button;
    b.dataset.state = v.state;
    b.dataset.tone = v.tone;
    b.classList.toggle('st-link--attention', this.attention);
    b.setAttribute('aria-label', `Game link: ${v.label}. ${v.summary}`);
    b.innerHTML =
      `<span class="st-dot st-dot--${dotClass(v.tone)}${v.tone === 'busy' ? ' st-dot--pulse' : ''}"></span>` +
      `<span class="st-link-label">${escapeHtml(v.label)}</span>` +
      `<span class="st-link-chevron">${editorIcon('chevronDown', 12)}</span>`;
    if (this.open) this.renderPop();
  }

  /* ------------------------------------------------------------ popover */

  private toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  private show(): void {
    this.open = true;
    this.attention = false;
    this.roomEditorOpen = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.button.classList.remove('st-link--attention');
    this.pop.hidden = false;
    this.renderPop();
    this.place();
    (this.pop.querySelector('[data-primary]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private close(focusButton = true): void {
    if (!this.open) return;
    this.open = false;
    this.button.setAttribute('aria-expanded', 'false');
    this.pop.hidden = true;
    if (focusButton) this.button.focus({ preventScroll: true });
  }

  private place(): void {
    const r = this.button.getBoundingClientRect();
    const w = this.pop.offsetWidth || 340;
    const margin = 8;
    const left = Math.max(margin, Math.min(window.innerWidth - w - margin, r.right - w));
    this.pop.style.left = `${left}px`;
    this.pop.style.top = `${r.bottom + 6}px`;
  }

  private renderPop(): void {
    const v = this.view;
    const cfg = this.opts.config;
    const parts: string[] = [];

    parts.push(
      `<div class="st-link-head" data-tone="${v.tone}">` +
        `<span class="st-dot st-dot--${dotClass(v.tone)}${v.tone === 'busy' ? ' st-dot--pulse' : ''}"></span>` +
        `<strong>${escapeHtml(v.label)}</strong></div>` +
        `<p class="st-link-summary">${escapeHtml(v.summary)}</p>`,
    );

    if (v.primary) {
      const p = v.primary;
      const busy = (p.id === 'pull' && this.pulling) || (p.id === 'open-game' && this.waitingForGame);
      const disabled = Boolean(p.disabledReason) || busy;
      const label = p.id === 'pull' && this.pulling ? 'Pulling…' : p.id === 'open-game' && this.waitingForGame ? 'Waiting for game window…' : p.label;
      parts.push(
        `<button type="button" class="st-btn st-btn--primary st-link-primary" data-primary data-action="${p.id}"${disabled ? ' disabled' : ''}>` +
          `${p.id === 'open-game' ? editorIcon('external', 14) : p.id === 'pull' ? editorIcon('broadcast', 14) : editorIcon('plug', 14)}` +
          `<span>${escapeHtml(label)}</span></button>`,
      );
      if (p.disabledReason) parts.push(`<p class="st-link-note">${escapeHtml(p.disabledReason)}</p>`);
      if (p.id === 'open-game' && this.waitingForGame && this.waitedLong) {
        parts.push('<p class="st-link-note">Nothing yet. If a pop-up blocker stopped the window, copy the game link below and open it yourself.</p>');
      }
    }

    if (v.synced.length > 0) {
      parts.push(
        '<div class="st-link-sec"><div class="st-label">In step</div><ul class="st-link-synced">' +
          v.synced.map((s) => `<li>${editorIcon('check', 12)}${escapeHtml(s)}</li>`).join('') +
          '</ul></div>',
      );
    }

    if (v.peers.length > 0) {
      parts.push(
        '<div class="st-link-sec"><div class="st-label">Windows in this room</div><ul class="st-link-peers">' +
          v.peers
            .map(
              (p) =>
                `<li data-same="${p.sameWorld}"><span class="st-link-who">${escapeHtml(p.who)}</span>` +
                `<span class="st-link-world">${escapeHtml(p.worldLabel)}</span>` +
                (p.sameWorld
                  ? `<span class="st-link-ok" title="Same level">${editorIcon('check', 12)}</span>`
                  : `<button type="button" class="st-btn st-btn--ghost" data-action="pull-peer" data-client="${escapeAttr(p.clientId)}"${this.pulling || !this.canPull() ? ' disabled' : ''}>Use</button>`) +
                '</li>',
            )
            .join('') +
          '</ul></div>',
      );
    }

    parts.push(
      '<div class="st-link-sec st-link-room">' +
        `<div class="st-label">Room</div>` +
        `<div class="st-link-roomrow"><code>${escapeHtml(v.room)}</code>` +
        (this.opts.link || cfg.enabled
          ? `<button type="button" class="st-btn st-btn--ghost" data-action="copy-game">Copy game link</button>` +
            `<button type="button" class="st-btn st-btn--ghost" data-action="room-edit" aria-expanded="${this.roomEditorOpen}">Change…</button>`
          : '') +
        '</div>' +
        (this.roomEditorOpen
          ? '<div class="st-link-roomedit"><input type="text" class="st-input" data-room-input spellcheck="false" placeholder="Room code or pasted link" maxlength="200" aria-label="Room code or link">' +
            '<button type="button" class="st-btn" data-action="room-join">Join</button>' +
            '<button type="button" class="st-btn" data-action="room-new" title="Start a private room and get a code to share">New private</button></div>'
          : '') +
        `<p class="st-link-foot">${cfg.relay === 'hosted' ? 'Hosted relay' : 'This dev server'} · ${cfg.writable ? 'read-write' : 'read-only'}</p>` +
        '</div>',
    );

    this.pop.innerHTML = parts.join('');
    if (this.roomEditorOpen) (this.pop.querySelector('[data-room-input]') as HTMLInputElement | null)?.focus({ preventScroll: true });
    this.place();
  }

  private waitedLong = false;

  private canPull(): boolean {
    return this.opts.link?.getWorldState()?.canPull ?? false;
  }

  /* ------------------------------------------------------------ actions */

  private readonly onPopClick = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const action = el.dataset.action;
    if (action === 'open-game') this.openGameWindow();
    else if (action === 'pull') void this.pull(undefined);
    else if (action === 'pull-peer') void this.pull(el.dataset.client);
    else if (action === 'start-linking') this.switchRoom(this.opts.config.room);
    else if (action === 'copy-game') void this.copy(gameUrl(this.opts.config.room, location.origin, baseUrl()), 'Game link copied');
    else if (action === 'room-edit') {
      this.roomEditorOpen = !this.roomEditorOpen;
      this.renderPop();
    } else if (action === 'room-join') this.joinFromInput();
    else if (action === 'room-new') this.switchRoom(makeRoomCode());
  };

  private readonly onPopKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('[data-room-input]')) {
      e.preventDefault();
      this.joinFromInput();
    }
  };

  private joinFromInput(): void {
    const input = this.pop.querySelector<HTMLInputElement>('[data-room-input]');
    const room = parseLinkInput(input?.value ?? '');
    if (!room) {
      this.opts.toast?.('That is not a room code. Paste a code or a link that has ?link=…');
      return;
    }
    this.switchRoom(room);
  }

  /** Rooms are chosen by the address, so changing one reloads this window (same page) with the new ?link=. */
  private switchRoom(room: string): void {
    this.opts.beforeLeave?.();
    const win = this.opts.win ?? window;
    const here = new URL(win.location.href);
    here.searchParams.set('link', room);
    win.location.assign(here.toString());
  }

  private openGameWindow(): void {
    const win = this.opts.win ?? window;
    const url = gameUrl(this.opts.config.room, win.location.origin, baseUrl());
    // noopener: the new window must NOT inherit this tab's sessionStorage, which
    // holds the dev "restore my last mode" key — the game window would boot
    // straight into the Builder.
    win.open(url, '_blank', 'noopener');
    this.waitingForGame = true;
    this.waitedLong = false;
    window.clearTimeout(this.waitTimer);
    this.waitTimer = window.setTimeout(() => {
      this.waitedLong = true;
      if (this.open) this.renderPop();
    }, 8000);
    this.renderPop();
  }

  private async pull(clientId: string | undefined): Promise<void> {
    const link = this.opts.link;
    if (!link || this.pulling) return;
    const peer = this.view.peers.find((p) => p.clientId === clientId) ?? this.view.peers.find((p) => !p.sameWorld) ?? this.view.peers[0];
    if (this.opts.confirmPull && !(await this.opts.confirmPull(peer ? `${peer.who} · ${peer.worldLabel}` : 'the other window'))) return;
    this.pulling = true;
    this.renderPop();
    let ok = false;
    try {
      ok = await link.pullWorldFrom(clientId);
    } finally {
      this.pulling = false;
    }
    this.opts.toast?.(ok ? 'Now editing the game\'s level' : 'The other window did not answer. Is it visible and not paused on the title screen?');
    this.refresh();
    if (ok) this.close(false);
  }

  private async copy(text: string, done: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.opts.toast?.(done);
    } catch {
      // Clipboard can be unavailable (insecure origin, permissions): show the text instead.
      window.prompt('Copy this link:', text);
    }
  }

  /* ------------------------------------------------------------ dismissal */

  private readonly onDocPointer = (e: PointerEvent): void => {
    if (!this.open) return;
    const t = e.target as Node;
    if (this.pop.contains(t) || this.button.contains(t)) return;
    this.close(false);
  };

  private readonly onDocKey = (e: KeyboardEvent): void => {
    if (this.open && e.key === 'Escape') {
      e.stopPropagation();
      this.close();
    }
  };

  private readonly onResize = (): void => {
    if (this.open) this.place();
  };
}

function dotClass(tone: LinkView['tone']): string {
  return tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'danger' ? 'danger' : tone === 'busy' ? 'busy' : 'off';
}

/** Vite's `base`, so addresses stay right on a sub-path deploy. */
function baseUrl(): string {
  return import.meta.env.BASE_URL || '/';
}

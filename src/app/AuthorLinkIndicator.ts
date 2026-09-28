import { describeWorld, type AuthorLinkStatus } from '@/net/authorLinkProtocol';
import type { AuthorLinkWorldState } from '@/app/AuthorLink';

/**
 * Header pill for the AuthorLink connection.
 *
 * Built in JS rather than added to `index.html` deliberately: the static shell
 * already duplicates too much catalog data, and a dev-only affordance has no
 * business shipping in the markup a player downloads.
 *
 * It answers the three questions that matter mid-authoring — am I linked, is
 * anyone listening, and *are we even on the same level*. That last one is the
 * one that bites: two windows can be happily connected and still be editing
 * unrelated worlds, in which case every stroke is refused. When that happens
 * the pill goes amber and becomes a button that pulls the peer's world.
 *
 * WHERE IT LIVES. The header, normally. Play mode hides the studio header
 * entirely (the cave gets the whole viewport), and the play window is exactly
 * where "your collaborator's edits are being refused" needs to be visible —
 * so while the header is away the pill re-parents itself into the canvas as a
 * small floating chip. It watches `body.class` for that rather than taking a
 * `Ctx`, because the indicator is shell chrome, not gameplay.
 */
export class AuthorLinkIndicator {
  private readonly el: HTMLButtonElement;
  private mismatch = false;
  private canPull = true;
  private mirror: AuthorLinkWorldState['mirror'] = 'off';
  private lastStatus: AuthorLinkStatus | null = null;
  private onPull: (() => void) | null = null;
  private floating = false;
  private readonly bodyObserver: MutationObserver | null;

  constructor(private readonly room: string) {
    this.el = document.createElement('button');
    this.el.className = 'sound-btn authorlink-pill';
    this.el.id = 'authorlink-status';
    this.el.type = 'button';
    this.el.disabled = true;
    this.el.textContent = 'LINK …';
    this.el.addEventListener('click', this.handleClick);
    this.placeInHeader();
    this.bodyObserver =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => this.syncPlacement());
    this.bodyObserver?.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.syncPlacement();
  }

  /** Wire the pull action; until this is set the pill stays read-only. */
  setPullHandler(handler: () => void): void {
    this.onPull = handler;
  }

  private readonly handleClick = (): void => {
    if (!this.mismatch || !this.canPull) return;
    this.onPull?.();
  };

  private placeInHeader(): void {
    const anchor = document.getElementById('sound-toggle');
    if (anchor?.parentElement) anchor.parentElement.insertBefore(this.el, anchor);
    else document.querySelector('header')?.appendChild(this.el);
  }

  /** Header while it is shown; a floating chip over the canvas while play hides it. */
  private syncPlacement(): void {
    const classes = document.body.classList;
    const wantFloating = classes.contains('play-active') || classes.contains('entry-active');
    if (wantFloating === this.floating) return;
    this.floating = wantFloating;
    this.el.classList.toggle('authorlink-pill--floating', wantFloating);
    if (wantFloating) {
      const holder = document.getElementById('canvas-holder');
      (holder ?? document.body).appendChild(this.el);
    } else {
      this.placeInHeader();
    }
  }

  update(status: AuthorLinkStatus): void {
    this.lastStatus = status;
    const peers = status.peers;
    if (status.kind === 'connected' && this.mismatch) {
      // Mismatch outranks the peer count: a connected link that silently drops
      // every edit is the failure mode worth shouting about. It is a button
      // only where pulling is safe — a window playing a live level must not
      // drop a foreign grid under its own runtime.
      this.el.dataset.state = 'mismatch';
      this.el.disabled = !this.canPull;
      this.el.textContent = 'LINK ≠';
      return;
    }
    this.el.disabled = true;
    this.el.dataset.state = status.kind;
    switch (status.kind) {
      case 'connected': {
        // The mirror arrows say which way the simulation is flowing: ⇣ this
        // window is showing the play window's sim, ⇡ this window is the sim.
        const glyph = this.mirror === 'receiving' ? '⇣' : this.mirror === 'sending' ? '⇡' : '';
        this.el.textContent = peers > 0 ? `LINK ${glyph}${peers}` : 'LINK ·';
        const mirrorNote =
          this.mirror === 'receiving'
            ? ' · mirroring the play window\'s simulation live'
            : this.mirror === 'sending'
              ? ' · streaming this simulation to the editor'
              : '';
        this.el.title =
          peers > 0
            ? `AuthorLink room "${this.room}" — ${peers} other window${peers === 1 ? '' : 's'} syncing (rev ${status.revision})${mirrorNote}`
            : `AuthorLink room "${this.room}" — connected, no other window open yet`;
        break;
      }
      case 'connecting':
        this.el.textContent = 'LINK …';
        this.el.title = `Connecting to AuthorLink room "${this.room}"`;
        break;
      case 'reconnecting':
        this.el.textContent = 'LINK ↻';
        this.el.title = `Reconnecting to AuthorLink room "${this.room}"${status.detail ? ` — ${status.detail}` : ''}`;
        break;
      default:
        this.el.textContent = 'LINK !';
        this.el.title = status.detail ?? 'AuthorLink unavailable';
        break;
    }
  }

  updateWorlds(state: AuthorLinkWorldState): void {
    this.mismatch = state.mismatch;
    this.canPull = state.canPull;
    this.mirror = state.mirror;
    if (state.mismatch) {
      const others = state.peers.map((p) => `${p.role}: ${describeWorld(p.world)}`).join('\n');
      const action = state.canPull
        ? `Click to pull the other window's world into this one (replaces your grid).`
        : `Pulling is blocked here (${state.pullBlockedReason ?? 'a level is live'}) — pull from the editor window instead.`;
      this.el.title =
        `Different worlds — edits between these windows are being refused.\n\n` +
        `you: ${describeWorld(state.mine)}\n${others}\n\n${action}`;
    }
    if (this.lastStatus) this.update(this.lastStatus);
  }

  dispose(): void {
    this.bodyObserver?.disconnect();
    this.el.removeEventListener('click', this.handleClick);
    this.el.remove();
  }
}

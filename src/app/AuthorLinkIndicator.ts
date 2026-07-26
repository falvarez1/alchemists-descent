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
 */
export class AuthorLinkIndicator {
  private readonly el: HTMLButtonElement;
  private mismatch = false;
  private lastStatus: AuthorLinkStatus | null = null;
  private onPull: (() => void) | null = null;

  constructor(private readonly room: string) {
    this.el = document.createElement('button');
    this.el.className = 'sound-btn authorlink-pill';
    this.el.id = 'authorlink-status';
    this.el.type = 'button';
    this.el.disabled = true;
    this.el.textContent = 'LINK …';
    this.el.addEventListener('click', this.handleClick);
    const anchor = document.getElementById('sound-toggle');
    if (anchor?.parentElement) anchor.parentElement.insertBefore(this.el, anchor);
    else document.querySelector('header')?.appendChild(this.el);
  }

  /** Wire the pull action; until this is set the pill stays read-only. */
  setPullHandler(handler: () => void): void {
    this.onPull = handler;
  }

  private readonly handleClick = (): void => {
    if (!this.mismatch) return;
    this.onPull?.();
  };

  update(status: AuthorLinkStatus): void {
    this.lastStatus = status;
    const peers = status.peers;
    if (status.kind === 'connected' && this.mismatch) {
      // Mismatch outranks the peer count: a connected link that silently drops
      // every edit is the failure mode worth shouting about.
      this.el.dataset.state = 'mismatch';
      this.el.disabled = false;
      this.el.textContent = 'LINK ≠';
      return;
    }
    this.el.disabled = true;
    this.el.dataset.state = status.kind;
    switch (status.kind) {
      case 'connected':
        this.el.textContent = peers > 0 ? `LINK ${peers}` : 'LINK ·';
        this.el.title =
          peers > 0
            ? `AuthorLink room "${this.room}" — ${peers} other window${peers === 1 ? '' : 's'} syncing (rev ${status.revision})`
            : `AuthorLink room "${this.room}" — connected, no other window open yet`;
        break;
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
    if (state.mismatch) {
      const others = state.peers.map((p) => `${p.role}: ${describeWorld(p.world)}`).join('\n');
      this.el.title =
        `Different worlds — edits between these windows are being refused.\n\n` +
        `you: ${describeWorld(state.mine)}\n${others}\n\n` +
        `Click to pull the other window's world into this one (replaces your grid).`;
    }
    if (this.lastStatus) this.update(this.lastStatus);
  }

  dispose(): void {
    this.el.removeEventListener('click', this.handleClick);
    this.el.remove();
  }
}

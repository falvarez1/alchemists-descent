/**
 * Single-writer election for localStorage keys shared across windows.
 *
 * Everything in this app assumes it is the only tab: tuning, the Builder
 * draft, the level library, and expedition saves all live under one origin
 * with last-write-wins. That was fine when nobody ran two windows. AuthorLink
 * makes two windows the *normal* setup, and then a background tab flushing a
 * stale snapshot on `visibilitychange` can quietly overwrite what the window
 * you are actually looking at just wrote.
 *
 * The rule: exactly one window owns writing at a time, and it is the one you
 * are looking at. Ownership follows focus, because the focused window is the
 * one whose state you would expect to survive.
 *
 * Deliberately NOT a lock with timeouts or storage-event handshakes — those
 * fail badly when a tab is suspended. A claim is a broadcast; the newest
 * claim wins; a window with no peers always owns. Worst case on a lost
 * message is the old behavior (both write), never a deadlock where nobody
 * saves.
 */

const CHANNEL = 'ad:storage-owner';

export interface StorageOwner {
  /** True when this window should perform shared-key writes. */
  readonly owns: boolean;
  dispose(): void;
}

interface ClaimMessage {
  kind: 'claim';
  id: string;
  at: number;
}

/** The slice of BroadcastChannel this needs; injectable so the election is testable. */
export interface OwnerChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  close(): void;
}

export type OwnerChannelFactory = () => OwnerChannel | null;

export class BroadcastStorageOwner implements StorageOwner {
  private owning = true;
  private readonly channel: OwnerChannel | null;
  private readonly id = `w${Math.random().toString(36).slice(2, 9)}`;
  private claimedAt = 0;
  private disposed = false;

  constructor(
    private readonly now: () => number,
    channelFactory: OwnerChannelFactory,
  ) {
    this.claimedAt = now();
    let channel: OwnerChannel | null = null;
    try {
      channel = channelFactory();
    } catch {
      channel = null;
    }
    this.channel = channel;
    if (channel) channel.addEventListener('message', this.onMessage);
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.claim);
      // A window that was already focused at load still needs to claim.
      if (typeof document === 'undefined' || document.visibilityState === 'visible') this.claim();
    }
    // No window (headless/tests): claim once so a lone instance still owns.
    if (typeof window === 'undefined') this.claim();
  }

  /** Test seam: simulate this window being focused. */
  focus(): void {
    this.claim();
  }

  get owns(): boolean {
    return this.owning;
  }

  private readonly claim = (): void => {
    if (this.disposed) return;
    this.claimedAt = this.now();
    this.owning = true;
    this.channel?.postMessage({ kind: 'claim', id: this.id, at: this.claimedAt } satisfies ClaimMessage);
  };

  private readonly onMessage = (event: MessageEvent): void => {
    const data = event.data as Partial<ClaimMessage> | null;
    if (!data || data.kind !== 'claim' || typeof data.id !== 'string' || typeof data.at !== 'number') return;
    if (data.id === this.id) return;
    // Strictly newer claims win. Ties keep the current owner, so two windows
    // focused in the same millisecond cannot both stand down.
    if (data.at > this.claimedAt) this.owning = false;
  };

  dispose(): void {
    this.disposed = true;
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.claim);
    if (this.channel) {
      this.channel.removeEventListener('message', this.onMessage);
      this.channel.close();
    }
    // A disposing window must not keep pretending to own the keys.
    this.owning = false;
  }
}

/** Always-owns stand-in for tests, headless runs, and unsupported browsers. */
const SOLE_OWNER: StorageOwner = { owns: true, dispose: () => undefined };

export function createStorageOwner(
  now: () => number = () => Date.now(),
  channelFactory?: OwnerChannelFactory,
): StorageOwner {
  const factory =
    channelFactory ??
    (() => (typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(CHANNEL) as OwnerChannel)));
  // Without a window there is only ever one writer, so election is pointless
  // and a no-op owner keeps headless runs and tests writing normally.
  if (channelFactory === undefined && (typeof BroadcastChannel === 'undefined' || typeof window === 'undefined')) {
    return SOLE_OWNER;
  }
  return new BroadcastStorageOwner(now, factory);
}

export { SOLE_OWNER as soleStorageOwner };

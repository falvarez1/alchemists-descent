/**
 * One outstanding world pull: "send me your grid" until the grid lands or the
 * peer is provably not going to send it.
 *
 * WHY NOT A PLAIN DEADLINE. A pull used to fail 20 s after the request,
 * whatever was happening. That budget silently assumed the snapshot is small
 * and both windows are quick, and neither holds: a generated cave's snapshot
 * is ~9 MB today (the paint repaint no longer reproduces the generator, so
 * the whole color plane ships), and a browser moves a WebSocket message
 * between its network process and the page in chunks the page's main thread
 * must service between frames. On a window that renders a few frames a second
 * (a GPU-less CI runner, a busy laptop, a background tab) delivery takes
 * minutes, not seconds; the pull "timed out" while the grid was still in
 * flight, and the late snapshot was then discarded as unsolicited.
 *
 * So the wait is in two phases, and only the first is about the clock:
 *
 *   asked      the request is out. The target answers at once with a tiny
 *              `world.announce` (ahead of the big snapshot, on the same ordered
 *              socket), so a silent target — gone, suspended by a Duel, or an
 *              old build — still fails fast.
 *   receiving  the target answered and the snapshot is on its way. Transfer
 *              time scales with size and with how starved the two windows
 *              are, so nothing here is a transfer budget. The pull ends when
 *              the grid lands, the link drops, or the room empties; the long
 *              ceiling only guards against a peer that answered and then
 *              never sent (its capture threw).
 *
 * Pure apart from timers, so the state machine is unit-tested with fake time.
 */

export type PullOutcome = 'pulled' | 'no-answer' | 'stalled' | 'link-lost' | 'peer-left' | 'cancelled';

export interface PullTimings {
  /** How long the target has to acknowledge the request. */
  answerMs: number;
  /** Leak guard once it has: NOT a transfer budget (see above). */
  receiveCeilingMs: number;
}

export const DEFAULT_PULL_TIMINGS: PullTimings = {
  answerMs: 20_000,
  receiveCeilingMs: 10 * 60_000,
};

export class PendingWorldPull {
  private phase: 'asked' | 'receiving' | 'done' = 'asked';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    /** The client id the request was addressed to. */
    readonly target: string,
    private readonly finish: (outcome: PullOutcome) => void,
    private readonly timings: PullTimings = DEFAULT_PULL_TIMINGS,
  ) {
    this.arm(timings.answerMs, 'no-answer');
  }

  get settled(): boolean {
    return this.phase === 'done';
  }

  get receiving(): boolean {
    return this.phase === 'receiving';
  }

  /**
   * A message from `clientId` arrived. From the target, it proves the request
   * reached a live peer that is answering; returns true on the FIRST such
   * proof (the caller tells the user the grid is on its way).
   */
  heardFrom(clientId: string): boolean {
    if (this.phase !== 'asked' || clientId !== this.target) return false;
    this.phase = 'receiving';
    this.arm(this.timings.receiveCeilingMs, 'stalled');
    return true;
  }

  /** The grid landed. */
  complete(): void {
    this.end('pulled');
  }

  /** The pull cannot finish (link dropped, room emptied, window closing). */
  fail(outcome: Exclude<PullOutcome, 'pulled'>): void {
    this.end(outcome);
  }

  private arm(ms: number, outcome: Exclude<PullOutcome, 'pulled'>): void {
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      this.end(outcome);
    }, ms);
  }

  private end(outcome: PullOutcome): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = null;
    this.finish(outcome);
  }
}

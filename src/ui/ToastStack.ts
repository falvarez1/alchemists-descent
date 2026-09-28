import { calmCase } from '@/ui/houseText';

/**
 * The HUD's event log: short toasts that coalesce instead of stacking.
 *
 * - An identical line arriving while its toast is still up merges into it:
 *   the toast stays, gains a ×N badge that pops, and its clock restarts.
 * - Tallies ("+44 oz gold" then "+23 oz gold") merge into a running total.
 * - At most MAX_VISIBLE toasts show; the oldest bows out first.
 * - Shouted legacy lines are calmed to sentence case (houseText.calmCase).
 *
 * DOM only; gameplay reaches it through the `toast` event (Hud wires it).
 */

const MAX_VISIBLE = 3;
/** On-screen life of a toast; a merge restarts it. */
const TOAST_MS = 3200;
/** Exit animation length (matches house.css .toast.leaving). */
const LEAVE_MS = 260;

interface LiveToast {
  key: string;
  node: HTMLElement;
  text: HTMLElement;
  badge: HTMLElement;
  count: number;
  /** Running total for "+N …" tallies, or null for plain lines. */
  total: number | null;
  suffix: string;
  timer: number;
}

/** "+44 oz gold" → { amount: 44, rest: " oz gold" }. */
function tally(text: string): { amount: number; rest: string } | null {
  const match = /^\+(\d+)(\s.*)$/.exec(text);
  return match ? { amount: Number(match[1]), rest: match[2] } : null;
}

export class ToastStack {
  private readonly live: LiveToast[] = [];

  constructor(private readonly host: HTMLElement) {}

  push(raw: string): void {
    const text = calmCase(raw.trim());
    if (!text) return;
    const counted = tally(text);
    const key = counted ? '+#' + counted.rest.toLowerCase() : text.toLowerCase();
    const existing = this.live.find((toast) => toast.key === key && !toast.node.classList.contains('leaving'));
    if (existing) {
      existing.count++;
      if (counted && existing.total !== null) {
        existing.total += counted.amount;
        existing.text.textContent = '+' + existing.total + existing.suffix;
      }
      existing.badge.textContent = '×' + existing.count;
      existing.badge.hidden = false;
      this.replay(existing.badge, 'pop');
      this.replay(existing.node, 'bump');
      this.arm(existing);
      return;
    }
    const node = document.createElement('div');
    node.className = 'toast';
    node.setAttribute('role', 'status');
    const body = document.createElement('span');
    body.className = 'toast-text';
    body.textContent = text;
    const badge = document.createElement('span');
    badge.className = 'toast-count';
    badge.hidden = true;
    node.append(body, badge);
    this.host.appendChild(node);
    const toast: LiveToast = {
      key, node, text: body, badge, count: 1,
      total: counted ? counted.amount : null, suffix: counted ? counted.rest : '', timer: 0,
    };
    this.live.push(toast);
    this.arm(toast);
    // Cap the stack: the oldest toast leaves to make room.
    const standing = this.live.filter((entry) => !entry.node.classList.contains('leaving'));
    for (let i = 0; i < standing.length - MAX_VISIBLE; i++) this.dismiss(standing[i]);
  }

  /** Drop everything immediately (HUD teardown). */
  clear(): void {
    for (const toast of this.live) {
      window.clearTimeout(toast.timer);
      toast.node.remove();
    }
    this.live.length = 0;
  }

  private arm(toast: LiveToast): void {
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => this.dismiss(toast), TOAST_MS);
  }

  private dismiss(toast: LiveToast): void {
    if (toast.node.classList.contains('leaving')) return;
    window.clearTimeout(toast.timer);
    toast.node.classList.add('leaving');
    toast.timer = window.setTimeout(() => {
      toast.node.remove();
      const index = this.live.indexOf(toast);
      if (index >= 0) this.live.splice(index, 1);
    }, LEAVE_MS);
  }

  /** Restart a one-shot CSS animation class. */
  private replay(node: HTMLElement, className: string): void {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }
}

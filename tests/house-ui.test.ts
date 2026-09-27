import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calmCase, isShouting } from '@/ui/houseText';
import { ToastStack } from '@/ui/ToastStack';

describe('house text', () => {
  it('calms shouted legacy lines to sentence case', () => {
    expect(calmCase('THE MECHANISM GROANS — SOMETHING GIVES WAY')).toBe('The mechanism groans — something gives way');
    expect(calmCase('+44 OZ GOLD')).toBe('+44 oz gold');
    expect(calmCase('NEW SPELL CARD — PRESS B TO SLOT')).toBe('New spell card — press B to slot');
    expect(calmCase('FRESH EXPEDITION: D2 — II ADEPT')).toBe('Fresh expedition: D2 — II adept');
    expect(calmCase('+20 MAX HP — A GIFT')).toBe('+20 max HP — a gift');
  });

  it('leaves lines that already carry lowercase alone', () => {
    expect(isShouting('The brass bell is yours.')).toBe(false);
    expect(calmCase('Weaver leg equipped · LMB whip')).toBe('Weaver leg equipped · LMB whip');
  });
});

/** Just enough DOM for ToastStack: elements with classes, text and children. */
class FakeElement {
  className = '';
  textContent = '';
  hidden = false;
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  readonly attrs = new Map<string, string>();
  readonly classList = {
    add: (...names: string[]): void => { const set = this.classes(); names.forEach((n) => set.add(n)); this.className = [...set].join(' '); },
    remove: (...names: string[]): void => { const set = this.classes(); names.forEach((n) => set.delete(n)); this.className = [...set].join(' '); },
    contains: (name: string): boolean => this.classes().has(name),
  };
  get offsetWidth(): number { return 1; }
  private classes(): Set<string> { return new Set(this.className.split(' ').filter(Boolean)); }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  append(...nodes: FakeElement[]): void { nodes.forEach((n) => this.appendChild(n)); }
  appendChild(node: FakeElement): void { node.parent = this; this.children.push(node); }
  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

describe('toast stack', () => {
  let host: FakeElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { createElement: () => new FakeElement() });
    host = new FakeElement();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const texts = (): string[] => host.children.map((toast) => toast.children.map((part) => (part.hidden ? '' : part.textContent)).join(''));

  it('merges an identical line into one toast with a count', () => {
    const stack = new ToastStack(host as unknown as HTMLElement);
    for (let i = 0; i < 4; i++) stack.push('THE MECHANISM GROANS — SOMETHING GIVES WAY');
    expect(host.children).toHaveLength(1);
    expect(texts()).toEqual(['The mechanism groans — something gives way×4']);
  });

  it('keeps a running total for tallies', () => {
    const stack = new ToastStack(host as unknown as HTMLElement);
    stack.push('+44 OZ GOLD');
    stack.push('+23 oz gold');
    stack.push('+15 oz gold');
    expect(texts()).toEqual(['+82 oz gold×3']);
  });

  it('caps the stack and lets merged toasts outlive their first clock', () => {
    const stack = new ToastStack(host as unknown as HTMLElement);
    for (const line of ['One.', 'Two.', 'Three.', 'Four.', 'Five.']) stack.push(line);
    const standing = host.children.filter((toast) => !toast.classList.contains('leaving'));
    expect(standing).toHaveLength(3);
    vi.advanceTimersByTime(3000);
    stack.push('Five.'); // restarts Five's clock
    vi.advanceTimersByTime(600);
    expect(texts().some((line) => line.startsWith('Five.'))).toBe(true);
    expect(texts().some((line) => line.startsWith('Three.'))).toBe(false);
    vi.advanceTimersByTime(4000);
    expect(host.children).toHaveLength(0);
  });
});

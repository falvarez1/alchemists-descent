const FOCUSABLE_SELECTOR =
  'button, input, textarea, select, [href], [tabindex]:not([tabindex="-1"])';

export interface ModalFocusTrap {
  activate(): void;
  deactivate(options?: { restoreFocus?: boolean }): void;
  focusInitial(target?: HTMLElement | null): void;
}

export function createModalFocusTrap(
  root: HTMLElement,
  options: { onEscape?: () => void; initialFocus?: () => HTMLElement | null } = {},
): ModalFocusTrap {
  let active = false;
  let previousFocus: HTMLElement | null = null;
  let redirectingFocus = false;

  const focusableControls = (): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
      if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
      return el.offsetParent !== null || el === document.activeElement;
    });

  const focusInitial = (target: HTMLElement | null = null): void => {
    const preferred = target ?? options.initialFocus?.() ?? focusableControls()[0] ?? root;
    if (preferred === document.activeElement || redirectingFocus) return;
    if (preferred === root && !root.hasAttribute('tabindex')) root.tabIndex = -1;
    redirectingFocus = true;
    try {
      preferred.focus({ preventScroll: true });
    } finally {
      window.queueMicrotask(() => {
        redirectingFocus = false;
      });
    }
  };

  const onDocumentFocusIn = (event: FocusEvent): void => {
    if (!active) return;
    if (event.target instanceof Node && root.contains(event.target)) return;
    event.stopPropagation();
    focusInitial();
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!active) return;
    const inside = event.target instanceof Node && root.contains(event.target);
    if (!inside) {
      event.preventDefault();
      event.stopPropagation();
      focusInitial();
      return;
    }
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      options.onEscape?.();
      return;
    }
    if (event.code !== 'Tab') return;

    const items = focusableControls();
    if (items.length === 0) {
      event.preventDefault();
      event.stopPropagation();
      focusInitial();
      return;
    }
    const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const index = current ? items.indexOf(current) : -1;
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      event.stopPropagation();
      items[items.length - 1].focus({ preventScroll: true });
    } else if (!event.shiftKey && (index < 0 || index === items.length - 1)) {
      event.preventDefault();
      event.stopPropagation();
      items[0].focus({ preventScroll: true });
    }
  };

  return {
    activate(): void {
      if (active) return;
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      active = true;
      document.addEventListener('focusin', onDocumentFocusIn, true);
      document.addEventListener('keydown', onDocumentKeyDown, true);
    },
    deactivate(opts: { restoreFocus?: boolean } = {}): void {
      if (!active) return;
      active = false;
      document.removeEventListener('focusin', onDocumentFocusIn, true);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      if (opts.restoreFocus !== false && previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
      previousFocus = null;
    },
    focusInitial,
  };
}

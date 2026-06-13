type DialogTone = 'normal' | 'danger';

interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
}

interface PromptOptions extends ConfirmOptions {
  multiline?: boolean;
  readOnly?: boolean;
  selectAll?: boolean;
}

type ActiveDialog<T> = {
  root: HTMLDivElement;
  resolve: (value: T) => void;
  fallback: T;
  cleanup: () => void;
  previousFocus: HTMLElement | null;
};

class AppDialog {
  private active: ActiveDialog<unknown> | null = null;

  alert(message: string, title = 'Notice'): Promise<void> {
    return this.open<void>({
      title,
      message,
      confirmText: 'OK',
      cancelText: null,
      fallback: undefined,
      renderInput: null,
      value: () => undefined,
    });
  }

  confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
    return this.open<boolean>({
      title: options.title ?? 'Confirm',
      message,
      confirmText: options.confirmText ?? 'OK',
      cancelText: options.cancelText ?? 'Cancel',
      tone: options.tone ?? 'normal',
      fallback: false,
      renderInput: null,
      value: () => true,
    });
  }

  prompt(message: string, initialValue = '', options: PromptOptions = {}): Promise<string | null> {
    let input: HTMLInputElement | HTMLTextAreaElement | null = null;
    return this.open<string | null>({
      title: options.title ?? 'Input',
      message,
      confirmText: options.confirmText ?? 'OK',
      cancelText: options.cancelText ?? 'Cancel',
      tone: options.tone ?? 'normal',
      fallback: null,
      renderInput: () => {
        input = options.multiline ? document.createElement('textarea') : document.createElement('input');
        input.className = 'app-dialog-input';
        input.value = initialValue;
        input.readOnly = options.readOnly === true;
        input.spellcheck = false;
        return input;
      },
      value: () => input?.value ?? '',
      afterOpen: () => {
        if (!input) return;
        input.focus();
        if (options.selectAll !== false) input.select();
      },
    });
  }

  private open<T>(cfg: {
    title: string;
    message: string;
    confirmText: string;
    cancelText: string | null;
    tone?: DialogTone;
    fallback: T;
    renderInput: (() => HTMLElement) | null;
    value: () => T;
    afterOpen?: () => void;
  }): Promise<T> {
    if (this.active) this.closeActive();

    const root = document.createElement('div');
    root.className = 'app-dialog-root';
    root.setAttribute('role', 'presentation');
    root.tabIndex = -1;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = document.createElement('div');
    panel.className = 'app-dialog-panel' + (cfg.tone === 'danger' ? ' danger' : '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'app-dialog-title';
    title.textContent = cfg.title;
    panel.appendChild(title);

    const body = document.createElement('div');
    body.className = 'app-dialog-message';
    body.textContent = cfg.message;
    panel.appendChild(body);

    const input = cfg.renderInput?.() ?? null;
    if (input) panel.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';

    const cancel = cfg.cancelText ? document.createElement('button') : null;
    if (cancel) {
      cancel.className = 'app-dialog-btn secondary';
      cancel.textContent = cfg.cancelText;
      actions.appendChild(cancel);
    }

    const confirm = document.createElement('button');
    confirm.className = 'app-dialog-btn primary' + (cfg.tone === 'danger' ? ' danger' : '');
    confirm.textContent = cfg.confirmText;
    actions.appendChild(confirm);

    panel.appendChild(actions);
    root.appendChild(panel);

    const mount = document.fullscreenElement ?? document.body;
    mount.appendChild(root);

    return new Promise<T>((resolve) => {
      const focusable = (): HTMLElement[] =>
        Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, input, textarea, select, [href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

      const focusDefault = (): void => {
        const target = input instanceof HTMLElement ? input : confirm;
        target.focus({ preventScroll: true });
      };

      const onDocumentFocusIn = (e: FocusEvent): void => {
        if (!this.active || this.active.root !== root) return;
        if (e.target instanceof Node && root.contains(e.target)) return;
        e.stopPropagation();
        focusDefault();
      };

      const onDocumentKeyDown = (e: KeyboardEvent): void => {
        if (!this.active || this.active.root !== root) return;
        const inside = e.target instanceof Node && root.contains(e.target);
        if (!inside) {
          e.preventDefault();
          e.stopPropagation();
          if (e.code === 'Escape') finish(cfg.fallback);
          else focusDefault();
          return;
        }
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(cfg.fallback);
        } else if (e.code === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          const items = focusable();
          if (items.length === 0) {
            focusDefault();
            return;
          }
          const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const i = current ? items.indexOf(current) : -1;
          const next = e.shiftKey
            ? items[(i <= 0 ? items.length : i) - 1]
            : items[(i + 1) % items.length];
          next.focus({ preventScroll: true });
        } else if (e.code === 'Enter' && !(e.target instanceof HTMLTextAreaElement && !e.ctrlKey)) {
          e.preventDefault();
          e.stopPropagation();
          finish(cfg.value());
        }
      };

      const cleanup = (): void => {
        document.removeEventListener('focusin', onDocumentFocusIn, true);
        document.removeEventListener('keydown', onDocumentKeyDown, true);
      };

      document.addEventListener('focusin', onDocumentFocusIn, true);
      document.addEventListener('keydown', onDocumentKeyDown, true);
      this.active = {
        root,
        resolve: resolve as (value: unknown) => void,
        fallback: cfg.fallback,
        cleanup,
        previousFocus,
      };

      const finish = (value: T) => {
        if (!this.active || this.active.root !== root) return;
        this.active.cleanup();
        root.remove();
        const restore = this.active.previousFocus;
        this.active = null;
        if (restore?.isConnected) restore.focus({ preventScroll: true });
        resolve(value);
      };

      confirm.addEventListener('click', () => finish(cfg.value()));
      cancel?.addEventListener('click', () => finish(cfg.fallback));

      window.setTimeout(() => {
        cfg.afterOpen?.();
        if (!input) confirm.focus();
      }, 0);
    });
  }

  private closeActive(): void {
    if (!this.active) return;
    const { root, resolve, fallback, cleanup, previousFocus } = this.active;
    cleanup();
    root.remove();
    this.active = null;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    resolve(fallback);
  }
}

export const appDialog = new AppDialog();

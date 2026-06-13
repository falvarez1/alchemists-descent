import type { CommandResult, Ctx } from '@/core/types';
import { loadConsoleBinds, loadConsoleWatches, normalizeBindKey, saveConsoleWatches } from '@/game/console/prefs';
import { upsertConsoleScript } from '@/game/console/scripts';

const HISTORY_KEY = 'noita-console-history';
const HISTORY_LIMIT = 100;
const LOG_LIMIT = 240;

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function canRunConsoleBind(target: EventTarget | null): boolean {
  if (isTextEntry(target)) return false;
  if (document.body.classList.contains('builder-open')) return false;
  if (document.getElementById('builder-intent-modal')) return false;
  if (document.getElementById('help-overlay')?.classList.contains('visible')) return false;
  if (document.getElementById('pause-overlay')?.classList.contains('visible')) return false;
  const element = target instanceof HTMLElement ? target : null;
  if (element?.closest('button, a, [role="button"], .app-dialog-root')) return false;
  return true;
}

function isUnmodifiedKey(e: KeyboardEvent): boolean {
  return !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(-HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    // History is a convenience; private mode/quota should not affect play.
  }
}

export class ConsoleOverlay {
  private readonly root: HTMLDivElement;
  private readonly logEl: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly hintEl: HTMLDivElement;
  private readonly watchEl: HTMLDivElement;
  private readonly scriptFile: HTMLInputElement;
  private readonly button: HTMLButtonElement | null;
  private history = loadHistory();
  private historyCursor = -1;
  private draft = '';
  private completionKey = '';
  private completions: string[] = [];
  private completionIndex = -1;
  private openState = false;
  private watchRefreshId = 0;
  private watchRefreshBusy = false;

  constructor(private readonly ctx: Ctx) {
    const holder = document.getElementById('canvas-holder') ?? document.body;
    const root = document.createElement('div');
    root.id = 'dev-console';
    root.className = 'dev-console';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="dev-console-head">
        <span>DEV CONSOLE</span>
        <div class="dev-console-actions">
          <button type="button" class="dev-console-import" title="Import console script file">IMPORT</button>
          <button type="button" class="dev-console-close" title="Close console">&times;</button>
        </div>
        <input type="file" class="dev-console-file" accept=".txt,.console,.json,text/plain,application/json" />
      </div>
      <div class="dev-console-log" aria-live="polite"></div>
      <div class="dev-console-hints"></div>
      <label class="dev-console-input-row">
        <span>&gt;</span>
        <input id="dev-console-input" autocomplete="off" spellcheck="false" />
      </label>`;
    holder.appendChild(root);
    const watchEl = document.createElement('div');
    watchEl.id = 'dev-console-watch';
    watchEl.className = 'dev-console-watch';
    holder.appendChild(watchEl);

    this.root = root;
    this.logEl = root.querySelector<HTMLDivElement>('.dev-console-log')!;
    this.input = root.querySelector<HTMLInputElement>('#dev-console-input')!;
    this.hintEl = root.querySelector<HTMLDivElement>('.dev-console-hints')!;
    this.watchEl = watchEl;
    this.scriptFile = root.querySelector<HTMLInputElement>('.dev-console-file')!;
    this.button = document.getElementById('dev-console-toggle') as HTMLButtonElement | null;

    root.querySelector<HTMLButtonElement>('.dev-console-close')?.addEventListener('click', () => this.close());
    root.querySelector<HTMLButtonElement>('.dev-console-import')?.addEventListener('click', () => {
      this.scriptFile.value = '';
      this.scriptFile.click();
    });
    this.scriptFile.addEventListener('change', () => void this.importScriptFile());
    root.addEventListener('keydown', (e) => e.stopPropagation());
    root.addEventListener('keyup', (e) => e.stopPropagation());
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.input.addEventListener('input', () => {
      this.resetCompletion();
      this.renderHints(this.ctx.console.complete(this.input.value));
    });
    this.button?.addEventListener('click', (e) => {
      this.toggle();
      (e.currentTarget as HTMLButtonElement).blur();
    });
    ctx.events.on('toast', ({ text }) => {
      this.appendLine('mirror', 'toast: ' + text);
    });
    window.addEventListener('error', (e) => {
      this.appendLine('error', `JS ERROR: ${e.message}${e.filename ? ` (${e.filename}:${e.lineno})` : ''}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
      this.appendLine('error', 'JS REJECTION: ' + reason);
    });

    window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
    window.addEventListener('keyup', (e) => this.onKeyUp(e), true);
    window.setInterval(() => void this.refreshWatchHud(), 500);
    void this.refreshWatchHud();
  }

  private toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  private open(): void {
    if (this.openState) return;
    this.openState = true;
    this.clearHeldInput();
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    this.button?.classList.add('lit');
    requestAnimationFrame(() => {
      if (this.openState) this.input.focus();
    });
    if (this.logEl.childElementCount === 0) {
      this.appendLine('result', 'Console ready. Type help.');
    }
  }

  private close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    this.button?.classList.remove('lit');
    this.resetCompletion();
    this.renderHints([]);
    if (document.activeElement === this.input) this.input.blur();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.openState) {
      const bindKey = normalizeBindKey(e.key || e.code);
      if (!e.repeat && bindKey && isUnmodifiedKey(e) && canRunConsoleBind(e.target)) {
        const command = loadConsoleBinds()[bindKey];
        if (command) {
          e.preventDefault();
          e.stopImmediatePropagation();
          void this.runBoundCommand(bindKey, command);
          return;
        }
      }
      if (e.repeat || e.code !== 'Backquote' || isTextEntry(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.open();
      return;
    }

    e.stopImmediatePropagation();
    if (e.code === 'Backquote') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      void this.submit();
      return;
    }
    if (e.code === 'ArrowUp') {
      e.preventDefault();
      this.stepHistory(-1);
      return;
    }
    if (e.code === 'ArrowDown') {
      e.preventDefault();
      this.stepHistory(1);
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      this.cycleCompletion(e.shiftKey ? -1 : 1);
      return;
    }
    if (document.activeElement !== this.input) this.input.focus();
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (!this.openState) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private clearHeldInput(): void {
    const { ctx } = this;
    const keys = ctx.input.keys;
    keys.left = false;
    keys.right = false;
    keys.up = false;
    keys.jump = false;
    keys.wallJump = false;
    keys.down = false;
    keys.grab = false;
    ctx.input.isDrawing = false;
    ctx.input.lastX = null;
    ctx.input.lastY = null;
    ctx.input.buildSpellHeld = false;
    ctx.input.bombCharge = -1;
    ctx.input.siphonHeld = false;
    ctx.input.pourHeld = false;
    ctx.input.drinkHeld = false;
    ctx.player.firing = false;
    ctx.player.climbing = false;
    if (ctx.input.activeChargingBlackHole) {
      ctx.input.activeChargingBlackHole.charging = false;
      ctx.input.activeChargingBlackHole = null;
    }
  }

  private async submit(): Promise<void> {
    const line = this.input.value.trim();
    this.resetCompletion();
    this.renderHints([]);
    if (!line) return;
    this.appendLine('echo', '> ' + line);
    this.pushHistory(line);
    this.input.value = '';
    const pending = this.appendLine('pending', '...');
    const res = await this.ctx.console.exec(line);
    this.renderCommandResult(pending, res);
    this.scrollToBottom();
  }

  private async runBoundCommand(key: string, command: string): Promise<void> {
    this.appendLine('echo', `> [${key}] ${command}`);
    const pending = this.appendLine('pending', '...');
    const res = await this.ctx.console.exec(command);
    this.renderCommandResult(pending, res);
  }

  private renderCommandResult(pending: HTMLDivElement, res: CommandResult): void {
    if (this.shouldClearLog(res)) {
      this.logEl.textContent = '';
      pending.remove();
      this.appendLine('result', res.text);
    } else {
      pending.className = 'dev-console-line ' + (res.ok ? 'result' : 'error');
      pending.textContent = res.text;
    }
    if (typeof res.data === 'object' && res.data !== null && (res.data as { action?: unknown }).action === 'watch') {
      void this.refreshWatchHud();
    }
    this.scrollToBottom();
  }

  private shouldClearLog(res: CommandResult): boolean {
    if (!res.ok || typeof res.data !== 'object' || res.data === null) return false;
    return (res.data as { action?: unknown }).action === 'clearLog';
  }

  private async importScriptFile(): Promise<void> {
    const file = this.scriptFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = this.importScriptText(file.name, text);
      if (imported.length === 0) {
        this.appendLine('error', 'No console scripts found in ' + file.name);
      } else {
        this.appendLine('result', `Imported ${imported.length} script${imported.length === 1 ? '' : 's'}: ${imported.join(', ')}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendLine('error', 'Script import failed: ' + message);
    }
  }

  private importScriptText(fileName: string, text: string): string[] {
    const imported: string[] = [];
    const trimmed = text.trim();
    const jsonImport = fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('{');
    if (jsonImport) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error('Invalid JSON console script file.');
      }
      const source =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'scripts' in parsed
          ? (parsed as { scripts?: unknown }).scripts
          : parsed;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('JSON console script import must be an object.');
      }
      for (const [name, value] of Object.entries(source)) {
        const body = typeof value === 'string' ? value : Array.isArray(value) && value.every((line) => typeof line === 'string') ? value.join('\n') : null;
        if (!body) continue;
        const saved = upsertConsoleScript(name, body);
        if (saved.ok) imported.push(saved.name);
      }
      return imported;
    }
    const name = fileName.replace(/\.[^.]+$/, '');
    const saved = upsertConsoleScript(name, text);
    if (saved.ok) imported.push(saved.name);
    return imported;
  }

  private pushHistory(line: string): void {
    this.history = this.history.filter((entry) => entry !== line);
    this.history.push(line);
    this.history = this.history.slice(-HISTORY_LIMIT);
    this.historyCursor = -1;
    this.draft = '';
    saveHistory(this.history);
  }

  private stepHistory(dir: -1 | 1): void {
    if (this.history.length === 0) return;
    if (this.historyCursor === -1) {
      this.draft = this.input.value;
      this.historyCursor = this.history.length;
    }
    this.historyCursor += dir;
    if (this.historyCursor < 0) this.historyCursor = 0;
    if (this.historyCursor >= this.history.length) {
      this.historyCursor = -1;
      this.input.value = this.draft;
    } else {
      this.input.value = this.history[this.historyCursor];
    }
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    this.resetCompletion();
    this.renderHints(this.ctx.console.complete(this.input.value));
  }

  private cycleCompletion(dir: -1 | 1): void {
    const key = this.input.value;
    if (this.completionKey !== key || this.completions.length === 0) {
      this.completionKey = key;
      this.completions = this.ctx.console.complete(key);
      this.completionIndex = -1;
    }
    if (this.completions.length === 0) {
      this.renderHints([]);
      return;
    }
    this.completionIndex =
      (this.completionIndex + dir + this.completions.length) % this.completions.length;
    this.applyCompletion(this.completions[this.completionIndex]);
    this.renderHints(this.completions);
  }

  private applyCompletion(candidate: string): void {
    const raw = this.input.value;
    const match = raw.match(/^(.*?)(\S*)$/);
    if (!match) {
      this.input.value = candidate + ' ';
      return;
    }
    const before = match[1];
    const token = match[2];
    const replacement =
      token.startsWith('@') && !candidate.startsWith('@')
        ? '@' + candidate
        : token.startsWith('--target=') && !candidate.startsWith('--target=')
          ? '--target=' + candidate
          : candidate;
    const suffix = before.length === 0 || before.endsWith(' ') ? ' ' : '';
    this.input.value = before + replacement + suffix;
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  private resetCompletion(): void {
    this.completionKey = '';
    this.completions = [];
    this.completionIndex = -1;
  }

  private renderHints(candidates: string[]): void {
    this.hintEl.textContent = candidates.slice(0, 12).join('  ');
  }

  private async refreshWatchHud(): Promise<void> {
    if (this.watchRefreshBusy) return;
    const id = ++this.watchRefreshId;
    const paths = loadConsoleWatches();
    if (paths.length === 0) {
      this.watchEl.replaceChildren();
      this.watchEl.classList.remove('visible');
      return;
    }
    this.watchRefreshBusy = true;
    const rows = await Promise.all(
      paths.map(async (path) => {
        const res = await this.ctx.console.exec('get ' + path);
        return {
          path,
          ok: res.ok,
          value: res.ok && typeof res.data === 'object' && res.data !== null ? (res.data as { value?: unknown }).value : res.text,
        };
      }),
    ).finally(() => {
      this.watchRefreshBusy = false;
    });
    if (id !== this.watchRefreshId) return;
    const validPaths = rows.filter((row) => row.ok).map((row) => row.path);
    if (validPaths.length !== paths.length) saveConsoleWatches(validPaths);
    this.watchEl.replaceChildren();
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'dev-console-watch-row' + (row.ok ? '' : ' error');
      const name = document.createElement('span');
      name.className = 'dev-console-watch-name';
      name.textContent = row.path;
      const value = document.createElement('span');
      value.className = 'dev-console-watch-value';
      value.textContent = String(row.value);
      el.append(name, value);
      this.watchEl.appendChild(el);
    }
    this.watchEl.classList.add('visible');
  }

  private appendLine(kind: 'echo' | 'result' | 'error' | 'pending' | 'mirror', text: string): HTMLDivElement {
    const last = this.logEl.lastElementChild as HTMLDivElement | null;
    if ((kind === 'mirror' || kind === 'error') && last?.dataset.kind === kind && last.dataset.raw === text) {
      const count = Number(last.dataset.repeat ?? '1') + 1;
      last.dataset.repeat = String(count);
      last.textContent = `${text} (x${count})`;
      this.scrollToBottom();
      return last;
    }
    const line = document.createElement('div');
    line.className = 'dev-console-line ' + kind;
    line.dataset.kind = kind;
    line.dataset.raw = text;
    line.textContent = text;
    this.logEl.appendChild(line);
    while (this.logEl.childElementCount > LOG_LIMIT) this.logEl.removeChild(this.logEl.firstElementChild!);
    this.scrollToBottom();
    return line;
  }

  private scrollToBottom(): void {
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}

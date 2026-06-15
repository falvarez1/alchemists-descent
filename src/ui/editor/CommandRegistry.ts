export interface CommandContext {
  id: string;
}

export interface CommandSpec {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  scopes?: readonly CommandScope[];
  priority?: number;
  keywords?: readonly string[];
  run(ctx: CommandContext): void | Promise<void>;
  enabled?: () => boolean;
  disabledReason?: () => string;
  visible?: () => boolean;
}

export type CommandScope = 'global' | 'builder.author' | 'builder.livePreview' | 'builder.playtest' | 'sandbox' | 'play' | 'console';

export interface CommandRunResult {
  ok: boolean;
  reason?: string;
  pending?: boolean;
}

type AsyncCommandErrorReporter = (id: string, reason: string) => void;

export class CommandRegistry {
  private readonly commands = new Map<string, CommandSpec>();

  constructor(private readonly reportAsyncError?: AsyncCommandErrorReporter) {}

  register(spec: CommandSpec): void {
    if (this.commands.has(spec.id)) {
      throw new Error(`duplicate command id: ${spec.id}`);
    }
    this.commands.set(spec.id, spec);
  }

  get(id: string): CommandSpec | null {
    return this.commands.get(id) ?? null;
  }

  list(includeHidden = false): CommandSpec[] {
    return [...this.commands.values()]
      .filter((cmd) => includeHidden || cmd.visible?.() !== false)
      .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  }

  search(query: string, includeHidden = false): CommandSpec[] {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.list(includeHidden).filter((cmd) => {
      if (terms.length === 0) return true;
      const haystack = [
        cmd.label,
        cmd.id,
        cmd.category,
        cmd.shortcut ?? '',
        ...(cmd.keywords ?? []),
      ].join(' ').toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }

  isEnabled(id: string): boolean {
    const cmd = this.commands.get(id);
    if (!cmd) return false;
    return cmd.enabled?.() !== false;
  }

  disabledReason(id: string): string {
    const cmd = this.commands.get(id);
    if (!cmd) return 'Unknown command';
    return cmd.disabledReason?.() ?? 'Command unavailable';
  }

  run(id: string): CommandRunResult {
    const cmd = this.commands.get(id);
    if (!cmd) return { ok: false, reason: 'Unknown command' };
    if (cmd.enabled?.() === false) return { ok: false, reason: this.disabledReason(id) };
    try {
      const value = cmd.run({ id });
      if (value instanceof Promise || isPromiseLike(value)) {
        void Promise.resolve(value).catch((error) => {
          this.reportAsyncError?.(cmd.id, commandErrorReason(error));
        });
        return { ok: true, pending: true };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: commandErrorReason(error) };
    }
  }

  async runAsync(id: string): Promise<CommandRunResult> {
    const cmd = this.commands.get(id);
    if (!cmd) return { ok: false, reason: 'Unknown command' };
    if (cmd.enabled?.() === false) return { ok: false, reason: this.disabledReason(id) };
    try {
      await cmd.run({ id });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: commandErrorReason(error) };
    }
  }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof value === 'object' && 'then' in value && typeof (value as { then?: unknown }).then === 'function';
}

function commandErrorReason(error: unknown): string {
  return error instanceof Error ? error.message : 'Command failed';
}

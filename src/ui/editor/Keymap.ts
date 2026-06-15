import type { CommandRegistry, CommandScope, CommandSpec } from '@/ui/editor/CommandRegistry';
import { isEditorTextEntryTarget } from '@/ui/editor/FocusRouter';

export interface KeymapResult {
  handled: boolean;
  ok?: boolean;
  commandId?: string;
  reason?: string;
}

export interface KeymapOptions {
  scope?: CommandScope;
}

export interface KeymapConflict {
  shortcut: string;
  commandIds: string[];
}

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const mods = new Set<string>();
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'cmd' || lower === 'command' || lower === 'meta') mods.add('Meta');
    else if (lower === 'ctrl' || lower === 'control') mods.add('Ctrl');
    else if (lower === 'alt' || lower === 'option') mods.add('Alt');
    else if (lower === 'shift') mods.add('Shift');
    else key = formatKey(part);
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].filter(Boolean).join('+');
}

export function shortcutFromEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');
  return [...mods, eventKey(e)].join('+');
}

export function isTextInputTarget(target: EventTarget | null): boolean {
  return isEditorTextEntryTarget(target);
}

export class Keymap {
  constructor(private readonly registry: CommandRegistry) {}

  conflicts(): KeymapConflict[] {
    const byShortcut = new Map<string, string[]>();
    for (const cmd of this.registry.list(true)) {
      if (!cmd.shortcut) continue;
      const shortcut = normalizeShortcut(cmd.shortcut);
      const ids = byShortcut.get(shortcut) ?? [];
      ids.push(cmd.id);
      byShortcut.set(shortcut, ids);
    }
    return [...byShortcut.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([shortcut, commandIds]) => ({ shortcut, commandIds }));
  }

  handleKeyDown(e: KeyboardEvent, options: KeymapOptions = {}): KeymapResult {
    if (isTextInputTarget(e.target)) return { handled: false };
    const command = this.commandForEvent(e, options.scope);
    if (!command) return { handled: false };
    e.preventDefault();
    e.stopPropagation();
    const result = this.registry.run(command.id);
    return { handled: true, ok: result.ok, commandId: command.id, reason: result.reason };
  }

  private commandForEvent(e: KeyboardEvent, scope: CommandScope | undefined): CommandSpec | null {
    const shortcut = shortcutFromEvent(e);
    return (
      this.registry
        .list(true)
        .filter((cmd) => cmd.shortcut && normalizeShortcut(cmd.shortcut) === shortcut && commandMatchesScope(cmd, scope))
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] ?? null
    );
  }
}

function commandMatchesScope(command: CommandSpec, scope: CommandScope | undefined): boolean {
  if (!scope) return true;
  if (!command.scopes || command.scopes.length === 0) return false;
  return command.scopes.includes('global') || command.scopes.includes(scope);
}

function eventKey(e: KeyboardEvent): string {
  if (e.code.startsWith('Key')) return e.code.slice(3).toUpperCase();
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  if (e.code === 'Backquote') return '`';
  if (e.code === 'Escape') return 'Escape';
  if (e.code === 'Delete') return 'Delete';
  if (e.code === 'Enter') return 'Enter';
  if (e.code.startsWith('Arrow')) return e.code.slice(5);
  return formatKey(e.key.length === 1 ? e.key.toUpperCase() : e.key);
}

function formatKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  if (key === '`' || key === 'Backquote') return '`';
  return key[0].toUpperCase() + key.slice(1);
}

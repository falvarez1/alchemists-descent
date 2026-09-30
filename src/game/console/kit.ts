import type { CommandInfo, CommandResult } from '@/core/types';
import type { CompletionRequest } from '@/game/console/registry';

/**
 * The small helpers every console command file shares: the result and info
 * builders and the completion matchers. They were private to commands.ts until
 * the travel commands (console/travel) needed the same ones.
 */

export function result(ok: boolean, text: string, data?: unknown): CommandResult {
  return data === undefined ? { ok, text } : { ok, text, data };
}

export function info(
  id: string,
  label: string,
  usage: string,
  description: string,
  category: CommandInfo['category'] = id.startsWith('console.') ? 'console' : 'game',
  shortcut?: string,
): CommandInfo {
  return { id, label, category, usage, description, shortcut, enabled: true };
}

export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The word being typed: empty after a trailing space, else the last argument. */
export function currentToken(req: CompletionRequest): string {
  if (req.trailingSpace) return '';
  return req.args[req.args.length - 1] ?? '';
}

export function matching(values: Iterable<string>, prefix: string): string[] {
  const p = normalizeKey(prefix);
  return [...values].filter((v) => normalizeKey(v).startsWith(p));
}

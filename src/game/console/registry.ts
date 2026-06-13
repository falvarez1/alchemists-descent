import type { CommandInfo, CommandResult, ConsoleApi, Ctx } from '@/core/types';

export interface ParsedLine {
  raw: string;
  name: string;
  args: string[];
}

export interface CompletionRequest {
  raw: string;
  name: string;
  args: string[];
  completingArg: number;
  trailingSpace: boolean;
}

export interface ConsoleCommandDefinition {
  name: string;
  aliases?: string[];
  info: CommandInfo;
  run(ctx: Ctx, args: string[], parsed: ParsedLine): CommandResult | Promise<CommandResult>;
  complete?(ctx: Ctx, request: CompletionRequest): string[];
}

export interface TokenizedLine {
  tokens: string[];
  trailingSpace: boolean;
  quoteOpen: boolean;
}

export function tokenizeConsoleLine(line: string): TokenizedLine {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (escaped) current += '\\';
  if (current.length > 0) tokens.push(current);
  return {
    tokens,
    trailingSpace: line.length > 0 && /\s/.test(line[line.length - 1]),
    quoteOpen: quote !== null,
  };
}

export function parseConsoleLine(line: string): ParsedLine | null {
  const tokenized = tokenizeConsoleLine(line.trim());
  const [name, ...args] = tokenized.tokens;
  if (!name) return null;
  return { raw: line, name: name.toLowerCase(), args };
}

export class ConsoleCommandRegistry implements ConsoleApi {
  private readonly primary: ConsoleCommandDefinition[] = [];
  private readonly byName = new Map<string, ConsoleCommandDefinition>();

  constructor(
    private readonly ctx: Ctx,
    definitions: ConsoleCommandDefinition[],
  ) {
    for (const def of definitions) this.add(def);
  }

  async exec(line: string): Promise<CommandResult> {
    const parsed = parseConsoleLine(line);
    if (!parsed) return { ok: true, text: '', data: { empty: true } };
    const def = this.byName.get(parsed.name);
    if (!def) {
      return {
        ok: false,
        text: `Unknown command "${parsed.name}". Try: help`,
        data: { code: 'unknown-command', command: parsed.name },
      };
    }
    try {
      return await def.run(this.ctx, parsed.args, parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        text: `${def.name} failed: ${message}`,
        data: { code: 'command-error', command: def.info.id, message },
      };
    }
  }

  complete(partial: string): string[] {
    const tokenized = tokenizeConsoleLine(partial);
    const [rawName, ...rest] = tokenized.tokens;
    if (!rawName || (!tokenized.trailingSpace && tokenized.tokens.length === 1)) {
      const prefix = (rawName ?? '').toLowerCase();
      return this.primary
        .map((def) => def.name)
        .filter((name) => name.startsWith(prefix))
        .sort();
    }

    const def = this.byName.get(rawName.toLowerCase());
    if (!def?.complete) return [];
    return def
      .complete(this.ctx, {
        raw: partial,
        name: rawName.toLowerCase(),
        args: rest,
        completingArg: tokenized.trailingSpace ? rest.length : Math.max(0, rest.length - 1),
        trailingSpace: tokenized.trailingSpace,
      })
      .sort();
  }

  list(): CommandInfo[] {
    return this.primary.map((def) => def.info);
  }

  private add(def: ConsoleCommandDefinition): void {
    this.primary.push(def);
    this.byName.set(def.name.toLowerCase(), def);
    for (const alias of def.aliases ?? []) this.byName.set(alias.toLowerCase(), def);
  }
}

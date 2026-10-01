import { describe, expect, it } from 'vitest';

import type { CommandInfo, CommandResult, Ctx } from '@/core/types';
import { createConsoleApi } from '@/game/console/commands';
import {
  HELP_GROUPS,
  HELP_META,
  HELP_NAME_COL,
  buildHelpEntries,
  overviewRows,
  resolveHelpQuery,
  rowsToText,
  searchHelp,
  type HelpRow,
} from '@/game/console/help';
import { helpRowsOf } from '@/ui/consoleHelpView';

const console_ = createConsoleApi({} as Ctx);

function rowsOf(res: CommandResult): HelpRow[] {
  const rows = helpRowsOf(res);
  expect(rows, res.text).not.toBeNull();
  return rows ?? [];
}

describe('help and ?', () => {
  it('lists every registered command once, grouped, one line each', async () => {
    const res = await console_.exec('help');
    expect(res.ok).toBe(true);
    const infos = console_.list();
    const lines = res.text.split('\n');
    // A group heading each, then a row per command.
    for (const group of HELP_GROUPS) expect(lines.some((l) => l.startsWith(group.title.toUpperCase())), group.title).toBe(true);
    for (const info of infos) {
      const name = info.usage.split(' ')[0];
      const rows = lines.filter((l) => l.startsWith(`  ${name} `) || l === `  ${name}`);
      expect(rows.length, `${name} lists once`).toBe(1);
    }
    expect(res.text).toContain('Type help <command> for details; Tab completes.');
  });

  it('keeps every list line readable: aligned summaries, no line past a console width', async () => {
    const res = await console_.exec('help');
    for (const line of res.text.split('\n')) {
      expect(line.length, line).toBeLessThanOrEqual(120);
    }
    const rows = overviewRows(buildHelpEntries(console_.list().map((info) => ({ name: info.usage.split(' ')[0], info }))));
    for (const row of rows) {
      if (row.kind !== 'command') continue;
      const left = `  ${row.args ? `${row.name} ${row.args}` : row.name}`;
      expect(left.length, left).toBeLessThan(HELP_NAME_COL);
      expect(row.summary.length, row.summary).toBeLessThanOrEqual(62);
    }
  });

  it('keeps the structured data the probes read: the commands, and the rows the overlay lays out', async () => {
    const res = await console_.exec('help');
    const data = res.data as { action: string; commands: CommandInfo[]; groups: unknown[] };
    expect(data.action).toBe('help');
    expect(data.commands.length).toBe(console_.list().length);
    expect(data.commands.every((c) => typeof c.usage === 'string' && typeof c.group === 'string')).toBe(true);
    expect(rowsToText(rowsOf(res))).toBe(res.text);
  });

  it('answers ? exactly as help', async () => {
    const a = await console_.exec('help');
    const b = await console_.exec('?');
    expect(b.text).toBe(a.text);
    const c = await console_.exec('? run');
    expect(c.text).toBe((await console_.exec('help run')).text);
  });

  it('files every command under a group, with a short summary and a short argument hint', () => {
    const entries = buildHelpEntries(console_.list().map((info) => ({ name: info.usage.split(' ')[0], info })));
    for (const e of entries) {
      expect(HELP_META[e.name], `${e.name} has help facts`).toBeDefined();
      expect(HELP_GROUPS.some((g) => g.id === e.group), e.name).toBe(true);
      expect(e.examples.length, `${e.name} has an example`).toBeGreaterThan(0);
    }
  });

  it('marks the commands that taint the run', async () => {
    const res = await console_.exec('help');
    const rows = rowsOf(res).filter((r): r is Extract<HelpRow, { kind: 'command' }> => r.kind === 'command');
    const taints = new Set(rows.filter((r) => r.taints).map((r) => r.name));
    for (const name of ['god', 'tp', 'spawn', 'give', 'kill', 'cell', 'fill', 'level', 'heal', 'gold']) expect(taints.has(name), name).toBe(true);
    for (const name of ['help', 'pos', 'get', 'dump', 'count', 'find']) expect(taints.has(name), name).toBe(false);
    expect(res.text).toContain('[taints]');
  });
});

describe('help <command>', () => {
  it('shows the full usage, aliases and an example', async () => {
    const res = await console_.exec('help run');
    expect(res.ok).toBe(true);
    expect(res.text).toContain('usage');
    expect(res.text).toContain('run <status|continue|new|test|save|abandon>');
    expect(res.text).toMatch(/aliases\s+expedition/);
    expect(res.text).toContain('example');
    expect(res.text).toContain('run test --level d3');
    expect((res.data as { command: CommandInfo }).command.usage).toContain('run');
  });

  it('finds a command by its alias and says what taints', async () => {
    const res = await console_.exec('help teleport');
    expect(res.ok).toBe(true);
    expect(res.text).toContain('tp <x|~> <y|~>');
    expect(res.text).toContain('Taints the run');
  });

  it('lists one group with help <group>', async () => {
    const res = await console_.exec('help console');
    expect(res.ok).toBe(true);
    expect(res.text).toContain('help [command|group|find word]');
    expect(res.text).not.toContain('cell <material>');
    const world = await console_.exec('help world');
    expect(world.text).toContain('cell <material> [radius]');
    expect(world.text).not.toContain('bind <F4');
  });

  it('searches with help find <word>', async () => {
    const res = await console_.exec('help find paint');
    expect(res.ok).toBe(true);
    expect((res.data as { matches: string[] }).matches).toContain('cell');
    const none = await console_.exec('help find zzzz');
    expect(none.ok).toBe(true);
    expect(none.text).toContain('Nothing matches');
  });

  it('explains the taint', async () => {
    const res = await console_.exec('help taint');
    expect(res.ok).toBe(true);
    expect(res.text).toContain('no autosave');
    expect(res.text).toContain('no ledger credit');
  });

  it('says plainly when there is no such command, and offers near names', async () => {
    const res = await console_.exec('help gol');
    expect(res.ok).toBe(false);
    expect(res.text).toContain('No help for "gol"');
    expect(res.text).toContain('gold');
    expect((res.data as { code: string }).code).toBe('help-missing');
  });

  it('completes commands, groups and find', () => {
    expect(console_.complete('help ru')).toContain('run');
    expect(console_.complete('help wor')).toContain('world');
    expect(console_.complete('help fi')).toEqual(expect.arrayContaining(['find', 'fill']));
    expect(console_.complete('? ta')).toContain('taint');
  });
});

describe('the help pages are built from the registered commands', () => {
  it('resolves queries: a command beats a group, find and taint are topics', () => {
    const entries = buildHelpEntries(console_.list().map((info) => ({ name: info.usage.split(' ')[0], info })));
    expect(resolveHelpQuery(entries, [])).toEqual({ kind: 'overview' });
    expect(resolveHelpQuery(entries, ['RUN']).kind).toBe('command');
    expect(resolveHelpQuery(entries, ['world']).kind).toBe('group');
    expect(resolveHelpQuery(entries, ['find', 'cell'])).toEqual({ kind: 'search', word: 'cell' });
    expect(resolveHelpQuery(entries, ['taint']).kind).toBe('taint');
    expect(resolveHelpQuery(entries, ['nothing-like-it']).kind).toBe('missing');
  });

  it('ranks a name match above a summary match when searching', () => {
    const entries = buildHelpEntries(console_.list().map((info) => ({ name: info.usage.split(' ')[0], info })));
    const found = searchHelp(entries, 'cell').map((e) => e.name);
    expect(found[0]).toBe('cell');
    expect(searchHelp(entries, '')).toEqual([]);
  });
});

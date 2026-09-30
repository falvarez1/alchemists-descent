import type { CommandInfo } from '@/core/types';
import { TRAVEL_HELP_META } from '@/game/console/travelHelp';

/**
 * What `help` and `?` print. Pure: no Ctx, no DOM. The command registry hands it
 * the registered definitions; it files each under a group, writes the one-line
 * list, the per-command page and the group page, and searches them. The same
 * rows come out twice: as plain text (the result's `text`, what probes, scripts
 * and the AuthorLink mirror read) and as `rows` (what ConsoleOverlay lays out in
 * columns that wrap at any width).
 */

export type HelpGroupId = 'runs' | 'player' | 'world' | 'story' | 'debug' | 'console';

export interface HelpGroup {
  id: HelpGroupId;
  title: string;
  blurb: string;
}

export const HELP_GROUPS: readonly HelpGroup[] = [
  { id: 'runs', title: 'Run & levels', blurb: 'runs, levels and the state of a run' },
  { id: 'player', title: 'Player', blurb: 'the alchemist: position, health, gold, cards' },
  { id: 'world', title: 'World & cells', blurb: 'paint cells, spawn creatures and bodies, find things' },
  { id: 'story', title: 'Story', blurb: "Pell's camp and the memory echoes" },
  { id: 'debug', title: 'Debug & perf', blurb: 'live parameters, time, telemetry, frame cost' },
  { id: 'console', title: 'Console', blurb: 'help, scripts, binds, assertions' },
];

/** One command's help facts beyond its CommandInfo (keyed by command name). */
export interface HelpMeta {
  group: HelpGroupId;
  /** Where it lists within its group (lower first); commands without one follow, in registration order. */
  order?: number;
  /** The short argument hint for the list (the full grammar is CommandInfo.usage). */
  args?: string;
  /** One line, for the list. */
  summary: string;
  /** The run becomes a test run when this changes something. */
  taints?: boolean;
  examples?: readonly string[];
  /** Paragraphs for the command's own page. */
  detail?: readonly string[];
}

const TAINT_NOTE =
  'Taints the run: a run that used it is a test run. It is never autosaved over a real expedition, never written to the ledger, and unlocks nothing (kits, tiers, bests, story beats).';

const BASE_HELP_META: Readonly<Record<string, HelpMeta>> = {
  /* ---------------- run & levels ---------------- */
  run: {
    group: 'runs',
    order: 10,
    args: '<status|continue|new|test|save|abandon>',
    summary: 'start, resume, save, test or abandon a run',
    examples: ['run status', 'run new --seed 12345', 'run test --level d3 --loadout advanced', 'run test --level d4 --gold 500 --perks all'],
    detail: [
      'status reports mode, level, seed, save, autosave and whether the run is a test run. new starts a real descent on D1 with a fresh kit; continue resumes the saved expedition; save checkpoints a clean run; abandon deletes the saved expedition.',
      'test starts a disposable run that never overwrites the saved expedition. Test-only setup flags: --level id  --seed n  --loadout fresh|advanced|review  --world campaign|campaign-level|virtual-world  --gold n  --hp n  --max-hp n  --levit n  --cards all|id,id  --perks all|id,id  --flask material:count  --flasks slot1,slot2  --active-flask 1-4.',
    ],
  },
  level: {
    group: 'runs',
    order: 170,
    args: '<id>',
    summary: 'jump to a level (god-mode taint)',
    taints: true,
    examples: ['level d3'],
    detail: ['It turns god mode on, which refills the kit at every arrival, and taints the run.'],
  },

  /* ---------------- player ---------------- */
  god: { group: 'player', args: '[off]', summary: 'every card, perk and potion; no death (god off undoes it)', taints: true, examples: ['god', 'god off'] },
  tp: {
    group: 'player',
    args: '<x|~> <y|~>',
    summary: 'move the player (17-cell headroom check)',
    taints: true,
    examples: ['tp 800 400', 'tp ~20 ~-10'],
    detail: ['~ is the player\'s own coordinate: ~12 is twelve cells right, ~-12 twelve left.'],
  },
  heal: { group: 'player', args: '[amount|full]', summary: 'restore player HP', taints: true, examples: ['heal', 'heal 40'] },
  gold: { group: 'player', args: '<n>', summary: 'grant gold', taints: true, examples: ['gold 500'] },
  give: { group: 'player', args: '<gold|heart|tome|card> [arg]', summary: 'grant gold, a heart or a spell card', taints: true, examples: ['give card lightning', 'give heart 2'] },
  pos: { group: 'player', summary: 'report player, camera, mode and level position', examples: ['pos'] },

  /* ---------------- world & cells ---------------- */
  spawn: { group: 'world', args: '<kind> [n] [x y]', summary: 'spawn up to 32 creatures', taints: true, examples: ['spawn slime 3', 'spawn bat 1 ~10 ~-20'] },
  kill: { group: 'world', args: '[all|radius n]', summary: 'kill hostiles nearby, or all of them', taints: true, examples: ['kill', 'kill all', 'kill radius 200'] },
  crate: { group: 'world', args: '[n] [x y] [wood|metal|stone]', summary: 'drop rigid-body crates', examples: ['crate 4', 'crate 2 large metal'] },
  boulder: { group: 'world', args: '[n] [x y] [wood|metal|stone]', summary: 'drop rigid-body boulders', examples: ['boulder 3 large'] },
  playground: { group: 'world', summary: 'carve a rigid-body test arena around you', examples: ['playground'] },
  grow: { group: 'world', args: '<species> [x y] [--pods p]', summary: 'grow a real-cell plant in front of you', examples: ['grow oak', 'grow kelp --height 30'] },
  cell: { group: 'world', args: '<material> [radius]', summary: 'paint a material disc at the cursor or player', taints: true, examples: ['cell water 6', 'cell lava 3'] },
  fill: { group: 'world', args: '<x0> <y0> <x1> <y1> <material>', summary: 'fill a bounded rectangle of cells', taints: true, examples: ['fill 100 100 140 110 water'] },
  dump: { group: 'world', args: '<x> <y> <w> <h>', summary: 'ASCII and raw dump of a cell region', examples: ['dump ~-8 ~-8 16 16'] },
  count: { group: 'world', args: '<material> [x y w h]', summary: 'count a material in the world or a region', examples: ['count water', 'count lava 0 0 400 300'] },
  find: { group: 'world', args: '<pickup|mechanism|portal>', summary: 'the nearest pickup or mechanism, or the portal', examples: ['find pickup', 'find portal'] },

  /* ---------------- story ---------------- */

  /* ---------------- debug & perf ---------------- */
  get: { group: 'debug', args: '<paramPath>', summary: 'read a live-tunable parameter', examples: ['get global.simSpeed'] },
  set: { group: 'debug', args: '<paramPath> <value>', summary: 'write a live-tunable parameter (no taint)', examples: ['set global.simSpeed 0.5'] },
  watch: { group: 'debug', args: '<paramPath>|list|clear', summary: 'pin a live parameter to the watch HUD', examples: ['watch global.simSpeed', 'watch clear'] },
  time: { group: 'debug', args: '<simSpeed>', summary: 'set the simulation speed', examples: ['time 0.25'] },
  gpu: { group: 'debug', args: '<on|off|toggle>', summary: 'toggle GPU frame composition', examples: ['gpu toggle'] },
  perf: { group: 'debug', args: '<on|off|toggle>', summary: 'show or hide the performance HUD', examples: ['perf on'] },
  perfrec: { group: 'debug', args: '<frames>', summary: 'record per-frame perf buckets', examples: ['perfrec 300'] },
  tele: { group: 'debug', summary: 'dump the local telemetry counters', examples: ['tele'] },
  screenshot: { group: 'debug', summary: 'capture the game canvas as a PNG data URL', examples: ['screenshot'] },

  /* ---------------- console ---------------- */
  help: {
    group: 'console',
    args: '[command|group|find word]',
    summary: 'this list; help <command> for one',
    examples: ['help', '? run', 'help runs', 'help find level', 'help taint'],
    detail: ['The groups: ' + HELP_GROUPS.map((g) => g.id).join(', ') + '. help find <word> searches names, summaries and usage (help find on its own explains the find command). help taint explains what marking a run as a test run means.'],
  },
  clear: { group: 'console', summary: 'clear the console log', examples: ['clear'] },
  exec: { group: 'console', args: '<name>', summary: 'run a saved console script, stopping at the first failure', examples: ['exec d3-tour'] },
  assert: { group: 'console', args: '<paramPath> <op> <value>', summary: 'check a live parameter (for scripts)', examples: ['assert global.simSpeed >= 0.5'] },
  bind: { group: 'console', args: '<F4-F10|F12> <command...>|clear|list', summary: 'bind a console command to a function key', examples: ['bind F6 heal full', 'bind list'] },
};

/** The travel commands' help exists only where the commands do (an authoring build). */
export const HELP_META: Readonly<Record<string, HelpMeta>> = { ...BASE_HELP_META, ...(__AUTHORING__ ? TRAVEL_HELP_META : {}) };

/** The taint topic: `help taint`. */
export const TAINT_TOPIC: readonly string[] = [
  'A run that used a debug command is a TEST RUN ("taint"). The game keeps it apart from real play:',
  '  no autosave: the saved expedition (run continue) is never overwritten by it',
  '  no ledger credit: a victory or a fall is shown as a practice descent and writes no best, daily best or unlock',
  '  no meta unlocks: kits, difficulty tiers and levels-seen stay as they were',
  '  no story memory: what Pell, the echoes and the Sanctum say is heard from a scratch copy, never marked heard',
  'Commands that taint are marked [taints] in help. Commands that only read (pos, get, dump, count, find, and a travel command with nothing to change) never taint.',
  'A new run (run new, run test) starts clean.',
];

export interface HelpEntry {
  name: string;
  aliases: string[];
  usage: string;
  description: string;
  group: HelpGroupId;
  args: string;
  summary: string;
  taints: boolean;
  examples: string[];
  detail: string[];
}

export type HelpRow =
  | { kind: 'text'; text: string }
  | { kind: 'gap' }
  | { kind: 'heading'; title: string; hint?: string }
  | { kind: 'command'; name: string; args: string; summary: string; taints: boolean }
  | { kind: 'field'; label: string; text: string }
  | { kind: 'code'; text: string };

/** The width of the name-and-arguments column in the plain-text list. */
export const HELP_NAME_COL = 48;

interface RegisteredCommand {
  name: string;
  aliases?: string[];
  info: CommandInfo;
}

/** A registered command with its help facts (a command with no entry in HELP_META still lists, under Console). */
export function buildHelpEntries(commands: readonly RegisteredCommand[]): HelpEntry[] {
  const at = (c: RegisteredCommand, i: number): number => HELP_META[c.name]?.order ?? 1000 + i;
  const order = commands.map((c, i) => ({ c, key: at(c, i) })).sort((a, b) => a.key - b.key).map((x) => x.c);
  return order.map((c) => {
    const meta = HELP_META[c.name];
    const usageArgs = c.info.usage.startsWith(c.name) ? c.info.usage.slice(c.name.length).trim() : c.info.usage;
    return {
      name: c.name,
      aliases: [...(c.aliases ?? [])],
      usage: c.info.usage,
      description: c.info.description,
      group: meta?.group ?? 'console',
      args: meta?.args ?? usageArgs,
      summary: meta?.summary ?? c.info.description,
      taints: meta?.taints === true,
      examples: [...(meta?.examples ?? [])],
      detail: [...(meta?.detail ?? [])],
    };
  });
}

/** The CommandInfo the registry lists: the command's own plus its group, aliases and taint flag. */
export function enrichInfo(name: string, aliases: readonly string[] | undefined, base: CommandInfo): CommandInfo {
  const meta = HELP_META[name];
  return {
    ...base,
    group: meta?.group ?? 'console',
    ...(aliases && aliases.length > 0 ? { aliases: [...aliases] } : {}),
    ...(meta?.taints ? { taints: true } : {}),
  };
}

export function groupTitle(id: HelpGroupId): string {
  return HELP_GROUPS.find((g) => g.id === id)?.title ?? id;
}

function commandLeft(e: { name: string; args: string }): string {
  return e.args ? `${e.name} ${e.args}` : e.name;
}

function groupRows(entries: readonly HelpEntry[], group: HelpGroup): HelpRow[] {
  const rows: HelpRow[] = [{ kind: 'heading', title: group.title, hint: `help ${group.id}` }];
  for (const e of entries.filter((x) => x.group === group.id)) {
    rows.push({ kind: 'command', name: e.name, args: e.args, summary: e.summary, taints: e.taints });
  }
  return rows;
}

export function overviewRows(entries: readonly HelpEntry[]): HelpRow[] {
  const rows: HelpRow[] = [
    { kind: 'text', text: `Developer console: ${entries.length} commands. Type help <command> for details; Tab completes.` },
    { kind: 'text', text: 'help <group> lists one group, help find <word> searches, help taint says what [taints] means.' },
  ];
  for (const group of HELP_GROUPS) {
    if (!entries.some((e) => e.group === group.id)) continue;
    rows.push({ kind: 'gap' }, ...groupRows(entries, group));
  }
  return rows;
}

export function groupPageRows(entries: readonly HelpEntry[], group: HelpGroup): HelpRow[] {
  return [
    { kind: 'text', text: `${group.title}: ${group.blurb}.` },
    { kind: 'gap' },
    ...groupRows(entries, group).slice(1),
    { kind: 'gap' },
    { kind: 'text', text: 'help <command> for usage, aliases and examples.' },
  ];
}

export function detailRows(entry: HelpEntry): HelpRow[] {
  const rows: HelpRow[] = [
    { kind: 'heading', title: `${entry.name}: ${entry.summary}` },
    { kind: 'field', label: 'usage', text: entry.usage },
  ];
  if (entry.aliases.length > 0) rows.push({ kind: 'field', label: 'aliases', text: entry.aliases.join(', ') });
  rows.push({ kind: 'field', label: 'group', text: `${groupTitle(entry.group)} (help ${entry.group})` });
  if (entry.taints) rows.push({ kind: 'field', label: 'taints', text: TAINT_NOTE });
  for (const paragraph of entry.detail) rows.push({ kind: 'gap' }, { kind: 'text', text: paragraph });
  if (entry.examples.length > 0) {
    rows.push({ kind: 'gap' }, { kind: 'text', text: entry.examples.length === 1 ? 'example:' : 'examples:' });
    for (const example of entry.examples) rows.push({ kind: 'code', text: example });
  }
  return rows;
}

export function taintRows(): HelpRow[] {
  return [{ kind: 'heading', title: 'Test runs ("taint")' }, ...TAINT_TOPIC.map((text): HelpRow => ({ kind: 'text', text }))];
}

export function searchRows(entries: readonly HelpEntry[], word: string, found: readonly HelpEntry[]): HelpRow[] {
  if (found.length === 0) {
    return [{ kind: 'text', text: `Nothing matches "${word}". help lists every command; help <group> lists one group.` }];
  }
  const rows: HelpRow[] = [{ kind: 'text', text: `${found.length} of ${entries.length} commands match "${word}":` }];
  for (const e of found) rows.push({ kind: 'command', name: e.name, args: e.args, summary: e.summary, taints: e.taints });
  return rows;
}

/** Every command whose name, alias, summary or usage contains `word` (case-insensitive), names first. */
export function searchHelp(entries: readonly HelpEntry[], word: string): HelpEntry[] {
  const w = word.trim().toLowerCase();
  if (!w) return [];
  const score = (e: HelpEntry): number => {
    if (e.name === w) return 0;
    if (e.name.includes(w) || e.aliases.some((a) => a.includes(w))) return 1;
    if (e.summary.toLowerCase().includes(w)) return 2;
    if (e.usage.toLowerCase().includes(w) || e.description.toLowerCase().includes(w) || e.detail.some((d) => d.toLowerCase().includes(w))) return 3;
    return 4;
  };
  return entries
    .map((e) => ({ e, s: score(e) }))
    .filter((x) => x.s < 4)
    .sort((a, b) => a.s - b.s || a.e.name.localeCompare(b.e.name))
    .map((x) => x.e);
}

/** Plain text for the rows: aligned columns, what probes and scripts read. */
export function rowsToText(rows: readonly HelpRow[]): string {
  return rows
    .map((row) => {
      switch (row.kind) {
        case 'text':
          return row.text;
        case 'gap':
          return '';
        case 'heading':
          return row.hint ? `${row.title.toUpperCase()}   (${row.hint})` : row.title;
        case 'command': {
          const left = `  ${commandLeft(row)}`;
          const pad = left.length < HELP_NAME_COL ? ' '.repeat(HELP_NAME_COL - left.length) : '  ';
          return `${left}${pad}${row.summary}${row.taints ? '  [taints]' : ''}`;
        }
        case 'field':
          return `  ${row.label.padEnd(9)} ${row.text}`;
        case 'code':
          return `    ${row.text}`;
      }
    })
    .join('\n');
}

export type HelpQuery =
  | { kind: 'overview' }
  | { kind: 'taint' }
  | { kind: 'search'; word: string }
  | { kind: 'command'; entry: HelpEntry }
  | { kind: 'group'; group: HelpGroup }
  | { kind: 'missing'; query: string; near: string[] };

/**
 * What `help <words>` means: a command or alias (exact) first, then a group id or
 * title, then `find <word>`, then `taint`; else the nearest names.
 */
export function resolveHelpQuery(entries: readonly HelpEntry[], args: readonly string[]): HelpQuery {
  if (args.length === 0) return { kind: 'overview' };
  const first = args[0].toLowerCase();
  // `help find <word>` searches; `find` is also a command, so it is the word after it that decides.
  if (first === 'find' || first === 'search') {
    const word = args.slice(1).join(' ').trim();
    if (word) return { kind: 'search', word };
  }
  const exact = entries.find((e) => e.name === first || e.aliases.includes(first));
  if (exact) return { kind: 'command', entry: exact };
  const group = HELP_GROUPS.find((g) => g.id === first || g.title.toLowerCase() === args.join(' ').toLowerCase());
  if (group) return { kind: 'group', group };
  if (first === 'taint' || first === 'tainted' || first === 'test-run') return { kind: 'taint' };
  const near = searchHelp(entries, args.join(' ')).slice(0, 6).map((e) => e.name);
  return { kind: 'missing', query: args.join(' '), near };
}

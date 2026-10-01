import { CAMPAIGN_LEVELS, FLOORS_TOTAL, LEVELS, doorTaken, floorDisplayName, floorOf, nextDoors } from '@/config/worldgraph';

/**
 * Where the travel commands can go, and how a typed word becomes a level. Pure:
 * no Ctx, no DOM, so the parsing and the level list are unit-tested on their own
 * (tests/console-travel.test.ts). The commands themselves live in console/travel.
 */

/** The spots `goto --at` (and the teleport commands) can put the alchemist at. */
export const AT_SPOTS = ['spawn', 'portal', 'boss', 'camp', 'waystone', 'valve', 'key'] as const;
export type AtSpot = (typeof AT_SPOTS)[number];

export function isAtSpot(value: string): value is AtSpot {
  return (AT_SPOTS as readonly string[]).includes(value);
}

/** Every level id: the campaign spine floor by floor (every door), then the test arenas. */
export function allLevelIds(): string[] {
  const arenas = Object.keys(LEVELS).filter((id) => !CAMPAIGN_LEVELS.includes(id));
  return [...CAMPAIGN_LEVELS, ...arenas];
}

export type TravelTarget = { ok: true; id: string } | { ok: false; text: string; data: { code: string; [key: string]: unknown } };

function levelListHint(): string {
  const spine = allLevelIds().filter((id) => floorOf(id) > 0);
  const arenas = allLevelIds().filter((id) => floorOf(id) === 0);
  return `Level ids: ${spine.join(', ')}; test arenas: ${arenas.join(', ')}. Also a floor number 1-${FLOORS_TOTAL}, next, prev. The levels command lists them.`;
}

/**
 * A level from what was typed: an id (case-insensitive), a floor number (the door
 * this run took on that floor, else its first door), or next / prev relative to
 * `currentId`. `path` is the doors the run has walked (RunSaveState.path).
 */
export function resolveTravelTarget(raw: string, currentId: string | null, path: readonly string[] | null | undefined): TravelTarget {
  const word = raw.trim().toLowerCase();
  if (!word) return { ok: false, text: `goto needs a level. ${levelListHint()}`, data: { code: 'usage', expected: allLevelIds() } };
  if (Object.prototype.hasOwnProperty.call(LEVELS, word)) return { ok: true, id: word };
  if (/^\d+$/.test(word)) {
    const floor = Number(word);
    if (floor >= 1 && floor <= FLOORS_TOTAL) return { ok: true, id: doorTaken(path, floor) };
    return { ok: false, text: `There is no floor ${word}: the descent has ${FLOORS_TOTAL}. ${levelListHint()}`, data: { code: 'parse-level', raw, expected: allLevelIds() } };
  }
  if (word === 'next' || word === 'prev' || word === 'previous') {
    const here = floorOf(currentId);
    if (word === 'next') {
      if (here > 0 && here < FLOORS_TOTAL) return { ok: true, id: doorTaken(path, here + 1) };
      const off = here === 0 ? nextDoors(currentId)[0] : undefined;
      if (off) return { ok: true, id: off };
      return { ok: false, text: here === 0 ? `${currentId ?? 'this level'} has no floor below it.` : `Floor ${here} is the last floor. There is nothing below the Kiln Heart.`, data: { code: 'no-next', from: currentId } };
    }
    if (here > 1) return { ok: true, id: doorTaken(path, here - 1) };
    return { ok: false, text: here === 1 ? 'Floor 1 is the first floor. There is nothing above the Bellows.' : `${currentId ?? 'this level'} is not on the descent, so it has no floor above it.`, data: { code: 'no-prev', from: currentId } };
  }
  return { ok: false, text: `Unknown level "${raw}". ${levelListHint()}`, data: { code: 'parse-level', raw, expected: allLevelIds() } };
}

/** The floor number for `sanctum 2`-style arguments (1..FLOORS_TOTAL), or null. */
export function parseFloorNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const floor = Number(raw);
  return floor >= 1 && floor <= FLOORS_TOTAL ? floor : null;
}

export interface LevelRow {
  id: string;
  floor: number;
  name: string;
  biome: string;
  boss: string;
  down: string[];
  here: boolean;
  built: boolean;
}

export function levelRows(currentId: string | null, generated: readonly string[]): LevelRow[] {
  return allLevelIds().map((id) => {
    const def = LEVELS[id];
    return {
      id,
      floor: floorOf(id),
      name: floorDisplayName(id),
      biome: def.biome,
      boss: def.boss ?? '',
      down: [...nextDoors(id)],
      here: id === currentId,
      built: generated.includes(id),
    };
  });
}

/** The `levels` listing: the descent, its doors, and the test arenas. Plain aligned text. */
export function formatLevelTable(rows: readonly LevelRow[]): string {
  const spine = rows.filter((r) => r.floor > 0);
  const arenas = rows.filter((r) => r.floor === 0);
  const head = `${'  '}${'id'.padEnd(13)}${'floor'.padEnd(7)}${'name'.padEnd(26)}${'biome'.padEnd(10)}${'boss'.padEnd(12)}doors down`;
  const line = (r: LevelRow): string =>
    `${r.here ? '> ' : '  '}${(r.id + (r.built ? ' *' : '')).padEnd(13)}${(r.floor > 0 ? `${r.floor} of ${FLOORS_TOTAL}` : '-').padEnd(7)}${r.name.padEnd(26)}${r.biome.padEnd(10)}${(r.boss || '-').padEnd(12)}${r.down.length > 0 ? r.down.join(', ') : '-'}`;
  const out = [
    'The descent: four floors; floors 2 and 3 have two doors, chosen at the Sanctum. > is where you are, * is built this run.',
    head,
    ...spine.map(line),
    '',
    'Test arenas (off the spine, reached by id; they have no exit):',
    ...arenas.map(line),
    '',
    'goto <level|floor|next|prev> travels (the run is kept); skip takes this floor\'s exit properly; help goto.',
  ];
  return out.join('\n');
}

/** Flags of a travel-style command line: `--name value`, `--name=value`, and bare switches. */
export interface ParsedFlags {
  positional: string[];
  values: Record<string, string>;
  switches: Set<string>;
  error?: { text: string; code: string };
}

export function parseFlags(args: readonly string[], spec: { values: readonly string[]; switches: readonly string[] }): ParsedFlags {
  const out: ParsedFlags = { positional: [], values: {}, switches: new Set() };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      out.positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = (eq >= 0 ? arg.slice(0, eq) : arg).slice(2).toLowerCase();
    if (spec.switches.includes(name)) {
      out.switches.add(name);
      continue;
    }
    if (spec.values.includes(name)) {
      const value = eq >= 0 ? arg.slice(eq + 1) : args[++i];
      if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) {
        out.error = { code: 'usage', text: `--${name} needs a value.` };
        return out;
      }
      out.values[name] = value;
      continue;
    }
    const known = [...spec.values.map((v) => `--${v} <value>`), ...spec.switches.map((s) => `--${s}`)];
    out.error = { code: 'usage', text: `Unknown option ${arg}.${known.length > 0 ? ` Options: ${known.join(', ')}.` : ''}` };
    return out;
  }
  return out;
}

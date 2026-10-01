import type { BuildNotes } from '@/core/types';
import { formatRunTime } from '@/game/runRules';

/**
 * "Run notes": the ledger's small, honest line about what the run's choices were — how many offers, how
 * many taken, what the altars gave, how long each floor held the player. It exists so "what happens at
 * minute five" can be answered with a number the next time the owner asks (the same record rides the
 * playtest report). Pure; null when the run made no decisions at all.
 */

const SOURCE_LABEL: Record<string, string> = { tome: 'tomes', altar: 'altars', depth: 'gifts', sanctum: 'Sanctum' };

const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;

/** Floor clocks: 60 unpaused ticks a second. */
export function floorTimes(notes: BuildNotes): Array<{ floor: number; ms: number }> {
  return Object.entries(notes.floorTicks)
    .map(([floor, ticks]) => ({ floor: Number(floor), ms: Math.round((ticks / 60) * 1000) }))
    .filter((f) => Number.isFinite(f.floor) && f.ms >= 1000)
    .sort((a, b) => a.floor - b.floor);
}

export function runNotesLine(notes: BuildNotes): string | null {
  const parts: string[] = [];
  if (notes.offersShown > 0) {
    const bySource = Object.entries(notes.bySource)
      .filter(([, v]) => v.shown > 0)
      .map(([k, v]) => `${SOURCE_LABEL[k] ?? k} ${v.taken}/${v.shown}`);
    parts.push(`${plural(notes.offersShown, 'offer')}, ${notes.offersTaken} taken${bySource.length > 0 ? ` (${bySource.join(', ')})` : ''}`);
  }
  if (notes.bargainsTaken > 0) parts.push(plural(notes.bargainsTaken, 'bargain'));
  if (notes.deadCardCasts > 0) parts.push(`${plural(notes.deadCardCasts, 'dead card')} cast`);
  if (notes.framesFound > 0) parts.push(`${plural(notes.framesFound, 'frame')} found, ${notes.framesFitted} fitted`);
  const floors = floorTimes(notes);
  if (floors.length > 0) parts.push(floors.map((f) => `floor ${f.floor} ${formatRunTime(f.ms)}`).join(', '));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The record as the playtest report prints it: counters as they are, floor clocks in seconds. */
export function buildNotesReport(notes: BuildNotes): Record<string, unknown> {
  const floorSeconds: Record<string, number> = {};
  for (const [floor, ticks] of Object.entries(notes.floorTicks)) floorSeconds[floor] = Math.round((ticks / 60) * 10) / 10;
  const { floorTicks: _ticks, owed: _owed, ...rest } = notes;
  return { ...rest, floorSeconds, summary: runNotesLine(notes) };
}

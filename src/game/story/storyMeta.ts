import type { Beat } from '@/content/story/types';

/**
 * The story's memory ACROSS runs (Breathing Works, wave 3 WS-S): which beats a
 * player has ever heard, how many runs they have begun, how often they have
 * sat with Pell, whether they have seen the opening and the ending, and the
 * Journal pages they have unlocked. First run rich, repeat runs light: a
 * heard beat speaks its `again` line (or keeps quiet) from then on.
 *
 * Its own localStorage document, versioned and corrupt-safe like the meta
 * profile (game/MetaProfile): parsing never throws, a newer version on disk
 * is left alone and the store goes read-only rather than clobbering it.
 */

export const STORY_META_KEY = 'breathing-works-story';
export const STORY_META_VERSION = 1;

export interface StoryMetaData {
  version: typeof STORY_META_VERSION;
  /** Runs begun (a tracked descent's first floor). */
  runsBegun: number;
  /** Beat ids heard at least once, ever. */
  heard: string[];
  /** Runs in which the apprentice talked with Pell at least once. */
  pellRuns: number;
  openingSeen: boolean;
  /** Endings seen, by which Pell ending played. */
  endings: { waiting: number; lantern: number };
  /** Journal entry ids unlocked. */
  journal: string[];
}

export type StoryMetaStatus = 'fresh' | 'ok' | 'corrupt' | 'future';

export function defaultStoryMeta(): StoryMetaData {
  return { version: STORY_META_VERSION, runsBegun: 0, heard: [], pellRuns: 0, openingSeen: false, endings: { waiting: 0, lantern: 0 }, journal: [] };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 120))] : []);

export function parseStoryMeta(raw: string | null): { data: StoryMetaData; status: StoryMetaStatus } {
  if (raw === null || raw === '') return { data: defaultStoryMeta(), status: 'fresh' };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { data: defaultStoryMeta(), status: 'corrupt' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { data: defaultStoryMeta(), status: 'corrupt' };
  const o = value as Record<string, unknown>;
  const version = count(o.version);
  if (version > STORY_META_VERSION) return { data: defaultStoryMeta(), status: 'future' };
  if (version !== STORY_META_VERSION) return { data: defaultStoryMeta(), status: 'corrupt' };
  const endings = (o.endings && typeof o.endings === 'object' ? o.endings : {}) as Record<string, unknown>;
  return {
    status: 'ok',
    data: {
      version: STORY_META_VERSION,
      runsBegun: count(o.runsBegun),
      heard: ids(o.heard),
      pellRuns: count(o.pellRuns),
      openingSeen: o.openingSeen === true,
      endings: { waiting: count(endings.waiting), lantern: count(endings.lantern) },
      journal: ids(o.journal),
    },
  };
}

/* ---------------- pure rules ---------------- */

/** Has this beat ever been heard? */
export function beatHeard(meta: Pick<StoryMetaData, 'heard'>, id: string): boolean {
  return meta.heard.includes(id);
}

/**
 * What a beat says now: its rich first line until it has been heard, then its
 * `again` line (or null — the beat keeps quiet on repeat runs).
 */
export function beatLine(meta: Pick<StoryMetaData, 'heard'>, beat: Beat): { text: string; fresh: boolean } | null {
  if (!beatHeard(meta, beat.id)) return { text: beat.first, fresh: true };
  return beat.again ? { text: beat.again, fresh: false } : null;
}

/** Mark beats heard (returns a new document; the same one when nothing changed). */
export function withHeard(meta: StoryMetaData, ...beatIds: string[]): StoryMetaData {
  const add = [...new Set(beatIds)].filter(id => id && !meta.heard.includes(id));
  return add.length ? { ...meta, heard: [...meta.heard, ...add] } : meta;
}

export function withJournal(meta: StoryMetaData, ...entryIds: string[]): StoryMetaData {
  const add = [...new Set(entryIds)].filter(id => id && !meta.journal.includes(id));
  return add.length ? { ...meta, journal: [...meta.journal, ...add] } : meta;
}

/** Pell's recognition: never met → 'first'; met on 1–2 earlier runs → 'again'; 3+ → 'veteran'. */
export function pellRecognition(meta: Pick<StoryMetaData, 'pellRuns'>): 'first' | 'again' | 'veteran' {
  if (meta.pellRuns <= 0) return 'first';
  return meta.pellRuns >= 3 ? 'veteran' : 'again';
}

/** The opening plays on a player's first descent only (the title replays it on request). */
export function openingDue(meta: Pick<StoryMetaData, 'openingSeen' | 'runsBegun'>): boolean {
  return !meta.openingSeen;
}

/* ---------------- the store ---------------- */

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export class StoryMetaStore {
  private doc: StoryMetaData;
  readonly status: StoryMetaStatus;
  private readonly readOnly: boolean;

  constructor(private readonly storage: StorageLike | null = defaultStorage()) {
    let raw: string | null = null;
    try { raw = storage?.getItem(STORY_META_KEY) ?? null; } catch { raw = null; }
    const parsed = parseStoryMeta(raw);
    this.doc = parsed.data;
    this.status = parsed.status;
    this.readOnly = parsed.status === 'future';
  }

  get data(): Readonly<StoryMetaData> { return this.doc; }

  commit(next: StoryMetaData): void {
    if (next === this.doc) return;
    this.doc = next;
    if (this.readOnly || !this.storage) return;
    try { this.storage.setItem(STORY_META_KEY, JSON.stringify(next)); } catch { /* storage full or blocked: memory keeps it for the session */ }
  }

  update(fn: (meta: StoryMetaData) => StoryMetaData): void {
    this.commit(fn(this.doc));
  }
}

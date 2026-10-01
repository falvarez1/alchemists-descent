import { isFighterId } from '@/content/fighters';
import type { FighterId } from '@/content/fighters';
import type { CardId, Difficulty } from '@/core/types';
import type { KitId, RunSummary } from '@/core/run';
import { DEFAULT_KIT, KIT_ORDER, isKitId } from '@/content/kits';
import { getDiscoveredCards } from '@/combat/wands/cardDiscovery';
import { betterDailyResult, isDateKey } from '@/game/runRules';
import { CAMPAIGN_LEVELS } from '@/config/worldgraph';
import { BASE_DIFFICULTY, bestVictoryAfter, isDifficultyOpen, openDifficulty, tierOpenedByVictory } from '@/config/difficultyLadder';
import { cleanMutators, mutatorsCountForLadder } from '@/content/mutators';

/**
 * The meta profile: what persists ACROSS runs (Breathing Works). Runs begun
 * and finished, the deepest floor, victories, unlocked kits, the last kit
 * chosen, the hardest difficulty the Kiln has been quieted on (which opens the
 * ladder: config/difficultyLadder), whether the Workshop has opened, and the
 * daily bests. Discovered
 * spell cards live in their own long-standing store (combat/wands/
 * cardDiscovery) and are read through here, not duplicated.
 *
 * One localStorage document with a version field. Parsing never throws:
 * corrupt or missing data starts a fresh profile, older versions migrate,
 * and a NEWER version is left untouched on disk (the store goes read-only
 * rather than clobbering a profile a later build wrote).
 */

/** Storage prefix follows the save keys, not the brand (see config/brand.ts). */
export const META_KEY = 'alchemists-descent-meta';
export const META_VERSION = 1;
/** Daily bests kept, newest dates first. */
const DAILY_HISTORY = 60;

export interface DailyBest {
  floor: number;
  timeMs: number;
  victory: boolean;
}

export interface MetaProfileData {
  version: typeof META_VERSION;
  runsStarted: number;
  runsEnded: number;
  victories: number;
  /** Deepest floor reached in any recorded run (0 = never played). */
  bestFloor: number;
  /**
   * Times a floor-3 warden has been slain: the Sunken Leviathan or, behind the
   * Galleries' door, the Lenswright (the field keeps its first name: it is a
   * stored key).
   */
  leviathansSlain: number;
  /**
   * Fastest victory, or null before the first. A descent under complications never sets it
   * (a Low Gravity run is not a record for the Works as issued); see docs/DIFFICULTY.md.
   */
  fastestVictoryMs: number | null;
  unlockedKits: KitId[];
  lastKit: KitId;
  /** The fighter the player last chose (null = the classic Alchemist). Optional on disk: a profile from before fighters has none. */
  lastFighter: FighterId | null;
  /**
   * The hardest difficulty tier (1–4) the Kiln has been quieted on; 0 before the
   * first victory. Opens the tier above it (config/difficultyLadder).
   */
  bestVictoryDifficulty: number;
  /** The tier last chosen on the title screen or the ledger; only ever one that is open. */
  lastDifficulty: Difficulty;
  /** The material sandbox opens to players after their first run ends. */
  workshopUnlocked: boolean;
  /** Best result per daily date (YYYY-MM-DD). */
  dailyBests: Record<string, DailyBest>;
  /**
   * Campaign levels ever walked into (recorded runs only), in first-visit
   * order. The Sanctum marks a door nobody has opened yet. Absent on profiles
   * from before the branching descent; migration reads it as empty.
   */
  levelsSeen: string[];
  /**
   * The complications last chosen for an ordinary descent (content/mutators ids). The title's
   * fold opens with them and "Descend again" carries them. Absent on profiles from before
   * complications; migration reads it as none. The daily never reads it.
   */
  lastMutators: string[];
}

export type MetaParseStatus = 'fresh' | 'ok' | 'migrated' | 'corrupt' | 'future';

export function defaultMetaProfile(): MetaProfileData {
  return {
    version: META_VERSION,
    runsStarted: 0,
    runsEnded: 0,
    victories: 0,
    bestFloor: 0,
    leviathansSlain: 0,
    fastestVictoryMs: null,
    unlockedKits: [DEFAULT_KIT],
    lastKit: DEFAULT_KIT,
    lastFighter: null,
    bestVictoryDifficulty: 0,
    lastDifficulty: BASE_DIFFICULTY,
    workshopUnlocked: false,
    dailyBests: {},
    levelsSeen: [],
    lastMutators: [],
  };
}

function sanitizeLevelsSeen(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const id of value) if (typeof id === 'string' && CAMPAIGN_LEVELS.includes(id) && !out.includes(id)) out.push(id);
  return out;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function sanitizeDaily(value: unknown): Record<string, DailyBest> {
  const out: Record<string, DailyBest> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [date, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isDateKey(date) || !raw || typeof raw !== 'object') continue;
    const best = raw as Partial<DailyBest>;
    const floor = count(best.floor);
    if (floor <= 0) continue;
    out[date] = { floor, timeMs: count(best.timeMs), victory: best.victory === true };
  }
  return trimDaily(out);
}

function trimDaily(bests: Record<string, DailyBest>): Record<string, DailyBest> {
  const dates = Object.keys(bests).sort().reverse().slice(0, DAILY_HISTORY);
  const out: Record<string, DailyBest> = {};
  for (const date of dates) out[date] = bests[date];
  return out;
}

/**
 * Read any stored shape into the current version, field by field: anything
 * missing, negative, non-numeric or unknown falls back to its default. A
 * document without a version (hand-edited, or written before the field
 * existed) is version 0 and migrates the fields it does carry.
 */
export function migrateMetaProfile(value: unknown): { profile: MetaProfileData; status: MetaParseStatus } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { profile: defaultMetaProfile(), status: 'corrupt' };
  const raw = value as Record<string, unknown>;
  const version = raw.version === undefined ? 0 : raw.version;
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 0) {
    return { profile: defaultMetaProfile(), status: 'corrupt' };
  }
  if (version > META_VERSION) return { profile: defaultMetaProfile(), status: 'future' };
  const kits = Array.isArray(raw.unlockedKits) ? raw.unlockedKits.filter(isKitId) : [];
  const unlockedKits = KIT_ORDER.filter((kit) => kit === DEFAULT_KIT || kits.includes(kit));
  const lastKit = isKitId(raw.lastKit) && unlockedKits.includes(raw.lastKit) ? raw.lastKit : DEFAULT_KIT;
  const leviathansSlain = count(raw.leviathansSlain);
  const victories = count(raw.victories);
  // A profile from before the ladder that has won at all won on what was then the only tier: Adept.
  const bestVictoryDifficulty = Math.min(4, raw.bestVictoryDifficulty === undefined ? (victories > 0 ? BASE_DIFFICULTY : 0) : count(raw.bestVictoryDifficulty));
  const fastest = raw.fastestVictoryMs;
  const profile: MetaProfileData = {
    version: META_VERSION,
    runsStarted: count(raw.runsStarted),
    runsEnded: count(raw.runsEnded),
    victories,
    bestFloor: count(raw.bestFloor),
    leviathansSlain,
    fastestVictoryMs: typeof fastest === 'number' && Number.isFinite(fastest) && fastest > 0 ? Math.floor(fastest) : null,
    unlockedKits,
    lastKit,
    lastFighter: isFighterId(raw.lastFighter) ? raw.lastFighter : null,
    bestVictoryDifficulty,
    lastDifficulty: openDifficulty(raw.lastDifficulty, bestVictoryDifficulty),
    workshopUnlocked: raw.workshopUnlocked === true || count(raw.runsEnded) > 0,
    dailyBests: sanitizeDaily(raw.dailyBests),
    levelsSeen: sanitizeLevelsSeen(raw.levelsSeen),
    lastMutators: cleanMutators(Array.isArray(raw.lastMutators) ? raw.lastMutators : []),
  };
  return { profile, status: version === META_VERSION ? 'ok' : 'migrated' };
}

export function parseMetaProfile(text: string | null | undefined): { profile: MetaProfileData; status: MetaParseStatus } {
  if (text === null || text === undefined || text === '') return { profile: defaultMetaProfile(), status: 'fresh' };
  try {
    return migrateMetaProfile(JSON.parse(text) as unknown);
  } catch {
    return { profile: defaultMetaProfile(), status: 'corrupt' };
  }
}

/* ---------------- milestones → kits ---------------- */

/** The kits a profile has earned by its milestones. */
export function earnedKits(profile: Pick<MetaProfileData, 'bestFloor' | 'leviathansSlain' | 'victories'>): KitId[] {
  const earned: KitId[] = [DEFAULT_KIT];
  if (profile.bestFloor >= 2) earned.push('frost');
  if (profile.leviathansSlain > 0) earned.push('ember');
  if (profile.victories > 0) earned.push('storm');
  return earned;
}

/** Fold earned kits into the unlocked list; report the ones that are new. */
function withUnlocks(profile: MetaProfileData): { profile: MetaProfileData; unlocked: KitId[] } {
  const have = new Set(profile.unlockedKits);
  const unlocked = earnedKits(profile).filter((kit) => !have.has(kit));
  if (unlocked.length === 0) return { profile, unlocked };
  const all = new Set([...profile.unlockedKits, ...unlocked]);
  return { profile: { ...profile, unlockedKits: KIT_ORDER.filter((kit) => all.has(kit)) }, unlocked };
}

export function recordRunStarted(profile: MetaProfileData, kit: KitId): MetaProfileData {
  return { ...profile, runsStarted: profile.runsStarted + 1, lastKit: profile.unlockedKits.includes(kit) ? kit : profile.lastKit };
}

export function recordFloorReached(profile: MetaProfileData, floor: number): { profile: MetaProfileData; unlocked: KitId[] } {
  if (floor <= profile.bestFloor) return { profile, unlocked: [] };
  return withUnlocks({ ...profile, bestFloor: Math.floor(floor) });
}

/** A floor-3 warden fell (the Leviathan or the Lenswright): the ember kit's milestone. */
export function recordLeviathanSlain(profile: MetaProfileData): { profile: MetaProfileData; unlocked: KitId[] } {
  return withUnlocks({ ...profile, leviathansSlain: profile.leviathansSlain + 1 });
}

/** A campaign level walked into for the first time (a door nobody had opened). */
export function recordLevelSeen(profile: MetaProfileData, levelId: string): MetaProfileData {
  if (!CAMPAIGN_LEVELS.includes(levelId) || profile.levelsSeen.includes(levelId)) return profile;
  return { ...profile, levelsSeen: [...profile.levelsSeen, levelId] };
}

export interface RunEndRecord {
  profile: MetaProfileData;
  unlocked: KitId[];
  /** The difficulty tier this victory newly opened, or null. */
  unlockedDifficulty: Difficulty | null;
  /** This date's best after the run (daily runs only). */
  dailyBest: DailyBest | null;
  /** The run set (or tied into) a new daily best. */
  newDailyBest: boolean;
  /** The run reached a floor no earlier run had. */
  newBestFloor: boolean;
}

export function recordRunEnded(profile: MetaProfileData, summary: RunSummary): RunEndRecord {
  const victory = summary.outcome === 'victory';
  const newBestFloor = summary.floor > profile.bestFloor;
  // A ledger from before the ladder was played on what was then the only tier.
  const tier = summary.difficulty ?? BASE_DIFFICULTY;
  // COMPLICATIONS (docs/DIFFICULTY.md "Complications"): a descent under any of them is a real run and is
  // credited as one (a win, the floor, the kits it earns), with two exceptions. A complication that
  // EASES the descent (ladder: false) never opens a tier, and a victory under ANY complication is not
  // a fastest-victory record: that figure stays the Works as issued. dailyBests are untouched (they
  // are per date, and a date's complications are fixed by the table).
  const mutated = (summary.mutators?.length ?? 0) > 0;
  const countsForLadder = mutatorsCountForLadder(summary.mutators);
  const unlockedDifficulty = victory && countsForLadder ? tierOpenedByVictory(profile.bestVictoryDifficulty, tier) : null;
  let next: MetaProfileData = {
    ...profile,
    runsEnded: profile.runsEnded + 1,
    workshopUnlocked: true,
    bestFloor: Math.max(profile.bestFloor, summary.floor),
    victories: profile.victories + (victory ? 1 : 0),
    bestVictoryDifficulty: victory && countsForLadder ? bestVictoryAfter(profile.bestVictoryDifficulty, tier) : profile.bestVictoryDifficulty,
    fastestVictoryMs: victory && !mutated
      ? Math.min(profile.fastestVictoryMs ?? Number.POSITIVE_INFINITY, summary.timeMs)
      : profile.fastestVictoryMs,
  };
  let dailyBest: DailyBest | null = null;
  let newDailyBest = false;
  if (summary.daily && isDateKey(summary.daily)) {
    const result: DailyBest = { floor: summary.floor, timeMs: summary.timeMs, victory };
    const previous = next.dailyBests[summary.daily];
    // A daily best is a descent that FINISHED — the Kiln quieted or the last
    // phial spent. An abandoned run never sets one (QA: a 20-second abandoned
    // daily recorded "New best"); it still reports the date's standing best.
    newDailyBest = summary.outcome !== 'abandoned' && betterDailyResult(result, previous);
    dailyBest = newDailyBest ? result : (previous ?? null);
    if (newDailyBest) next = { ...next, dailyBests: trimDaily({ ...next.dailyBests, [summary.daily]: result }) };
  }
  const unlocks = withUnlocks(next);
  return { profile: unlocks.profile, unlocked: unlocks.unlocked, unlockedDifficulty, dailyBest, newDailyBest, newBestFloor };
}

/* ---------------- the store ---------------- */

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Owns the one meta document. Every write goes straight to storage. */
export class MetaProfileStore {
  private data: MetaProfileData;
  /** A newer build's profile is on disk: read defaults, never overwrite it. */
  private readonly readOnly: boolean;
  readonly status: MetaParseStatus;

  constructor(private readonly storage: Storage | null = defaultStorage()) {
    let text: string | null = null;
    try {
      text = storage?.getItem(META_KEY) ?? null;
    } catch {
      text = null;
    }
    const parsed = parseMetaProfile(text);
    this.data = parsed.profile;
    this.status = parsed.status;
    this.readOnly = parsed.status === 'future';
    if (parsed.status === 'migrated' || parsed.status === 'corrupt') this.write();
  }

  get profile(): Readonly<MetaProfileData> {
    return this.data;
  }

  isKitUnlocked(kit: KitId): boolean {
    return this.data.unlockedKits.includes(kit);
  }

  /** Every card ever found, from the long-standing discovery store. */
  discoveredCards(): CardId[] {
    return getDiscoveredCards();
  }

  commit(next: MetaProfileData): void {
    this.data = next;
    this.write();
  }

  setLastFighter(id: FighterId | null): void {
    if (this.data.lastFighter === id) return;
    this.commit({ ...this.data, lastFighter: id });
  }

  setLastKit(kit: KitId): void {
    if (!this.isKitUnlocked(kit) || this.data.lastKit === kit) return;
    this.commit({ ...this.data, lastKit: kit });
  }

  /** Remember the tier chosen; a tier still locked is ignored. */
  setLastDifficulty(tier: Difficulty): void {
    if (!isDifficultyOpen(tier, this.data.bestVictoryDifficulty) || this.data.lastDifficulty === tier) return;
    this.commit({ ...this.data, lastDifficulty: tier });
  }

  /** Remember the complications chosen for the next ordinary descent (cleaned, canonical order). */
  setLastMutators(ids: readonly string[]): void {
    const next = cleanMutators(ids);
    if (next.length === this.data.lastMutators.length && next.every((id, i) => id === this.data.lastMutators[i])) return;
    this.commit({ ...this.data, lastMutators: next });
  }

  private write(): void {
    if (this.readOnly || !this.storage) return;
    try {
      this.storage.setItem(META_KEY, JSON.stringify(this.data));
    } catch {
      // Meta progress is a nicety; a full or blocked storage must never break a run.
    }
  }
}

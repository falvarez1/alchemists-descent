import type { StoryCampDress, StoryRunSave } from '@/core/story';
import {
  PELL_GIFT_HINTS,
  PELL_HP_HIGH,
  PELL_HP_LOW,
  PELL_NOTICES,
  PELL_PIN_PS,
  PELL_TEA_REFUSE_AT,
  PELL_TEA_UNNEEDED_HINT,
  type PellChoice,
  type PellNotice,
  type PellVisit,
  type StoryBiome,
} from '@/content/story';
import { floorOf } from '@/config/worldgraph';
import type { PellFacts } from './host';

/**
 * PELL's rules, pure (tests/story-pell.test.ts): which notice he has for a
 * visit, what he says to an apprentice who comes back to him, which buttons
 * he still has, what his camp has gathered, and how his mouth follows a line.
 * PellCamp runs the conversation; nothing here touches the game.
 */

/* ---------------- what he has told this run ---------------- */

export const noticeKey = (id: string): string => `notice.${id}`;
export const barkKey = (id: string): string => `bark.${id}`;
export const onceKey = (id: string): string => `once.${id}`;
/** The story meta's record of a notice said on any run (the `ever` ones never repeat). */
export const noticeHeardId = (id: string): string => `pell.notice.${id}`;

export function isTold(run: Pick<StoryRunSave, 'told'>, key: string): boolean {
  return run.told.includes(key);
}

export function withTold(run: StoryRunSave, key: string): StoryRunSave {
  return run.told.includes(key) ? run : { ...run, told: [...run.told, key] };
}

/* ---------------- notices ---------------- */

function holds(n: PellNotice, f: PellFacts, biome: StoryBiome, pinPaid: boolean): boolean {
  if (n.kit && (!f.kit || !n.kit.includes(f.kit))) return false;
  if (n.biomes && !n.biomes.includes(biome)) return false;
  if (n.minFloor !== undefined && f.floor < n.minFloor) return false;
  if (n.phials !== undefined && f.phials !== n.phials) return false;
  if (n.minDeaths !== undefined && f.deaths < n.minDeaths) return false;
  if (n.hp === 'low' && !(f.hpFrac < PELL_HP_LOW)) return false;
  if (n.hp === 'high' && !(f.hpFrac >= PELL_HP_HIGH)) return false;
  if (n.minGold !== undefined && f.gold < n.minGold) return false;
  if (n.boon && !f.boons.includes(n.boon)) return false;
  if (n.tier === 'hard' && f.difficulty < 4) return false;
  if (n.tier === 'easy' && f.difficulty > 1) return false;
  if (n.daily && !f.daily) return false;
  if (n.pinPaid && !pinPaid) return false;
  return true;
}

/**
 * The one line he has to say about the run, or null: the most pressing notice
 * whose facts hold, that he has not said this run (nor, for the `ever` jokes,
 * on any run).
 */
export function pickNotice(facts: PellFacts, biome: StoryBiome, run: Pick<StoryRunSave, 'told' | 'pinsPaid'>, heard: readonly string[]): PellNotice | null {
  let best: PellNotice | null = null;
  for (const n of PELL_NOTICES) {
    if (isTold(run, noticeKey(n.id))) continue;
    if (n.ever && heard.includes(noticeHeardId(n.id))) continue;
    if (!holds(n, facts, biome, run.pinsPaid.length > 0)) continue;
    if (!best || n.priority < best.priority) best = n;
  }
  return best;
}

/* ---------------- the second talk ---------------- */

/** One of `pool`, never the same as `last` (when there is a choice). */
export function pickDifferent(pool: readonly string[], last: string | null, rand: () => number): string {
  const options = pool.length > 1 ? pool.filter(s => s !== last) : pool;
  return options[Math.min(options.length - 1, Math.floor(rand() * options.length))] ?? '';
}

/* ---------------- the menu ---------------- */

/**
 * The buttons he has right now. The first time, everything that applies;
 * coming back to him with the gift still to take, the same; coming back after
 * the gift, only the answers that were not there before (the rope).
 */
export function menuFor(visit: PellVisit, run: Pick<StoryRunSave, 'echoes' | 'told'>, gifted: boolean): readonly PellChoice[] {
  const avail = visit.choices.filter(c =>
    (!c.requires || run.echoes.includes(c.requires.echo)) && (!c.once || !isTold(run, onceKey(c.once))));
  return gifted ? avail.filter(c => !c.gift && c.requires) : avail;
}

/** Health at which his tea is not needed. */
export function teaUnneeded(hpFrac: number): boolean {
  return hpFrac >= PELL_TEA_REFUSE_AT;
}

/** The small word beside a button saying what it gives ('' for a choice that only talks). */
export function giftHint(choice: PellChoice, hpFrac: number): string {
  if (!choice.gift) return '';
  if (choice.gift === 'tea' && teaUnneeded(hpFrac)) return PELL_TEA_UNNEEDED_HINT;
  return PELL_GIFT_HINTS[choice.gift];
}

/* ---------------- his last page ---------------- */

/** The P.S. under his last page, when his mark led the apprentice to a pickup. */
export function pinPostscript(run: Pick<StoryRunSave, 'pinsPaid'>, pageHeard: boolean): string | null {
  if (run.pinsPaid.length === 0) return null;
  return pageHeard ? PELL_PIN_PS.again : PELL_PIN_PS.first;
}

/* ---------------- the camp ---------------- */

/** How far from the mark (cells) a pickup counts as the one he pointed to. */
export const PIN_REACH = 70;

/** What has accrued at his camp this run: the pages he has pinned up, the cup, the frost, the tin. */
export function campDress(run: Pick<StoryRunSave, 'pell'>, floor: number, biome: string): StoryCampDress {
  let pages = 0;
  let tea = false;
  for (const [levelId, v] of Object.entries(run.pell)) {
    if (v.gift === 'tea') tea = true;
    if (v.met && floorOf(levelId) > 0 && floorOf(levelId) < floor) pages++;
  }
  return {
    floor,
    pages: Math.min(3, pages),
    cup: tea && floor >= 3 && biome !== 'volcanic',
    frost: biome === 'frozen',
    tin: biome === 'volcanic' ? (tea ? 'empty' : 'full') : 'none',
  };
}

/* ---------------- his mouth ---------------- */

/**
 * How open his mouth is (0..1) `u` of the way through saying `text`: the
 * letter under the line's clock decides it, so the mouth moves with the words
 * as the box types them and stops when the line does.
 */
export function mouthOpen(text: string, u: number): number {
  if (u <= 0 || u >= 1 || text.length === 0) return 0;
  const ch = text[Math.min(text.length - 1, Math.floor(u * text.length))]!.toLowerCase();
  if ('aeiouy'.includes(ch)) return 0.85;
  if ('mbp'.includes(ch)) return 0;
  if (/[a-z]/.test(ch)) return 0.4;
  return 0;
}

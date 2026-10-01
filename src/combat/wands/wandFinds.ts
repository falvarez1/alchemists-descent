import type { CardId, Ctx, WandFrame } from '@/core/types';
import { entityRandom } from '@/core/simRandom';
import { CARD_DEFS } from './cards';
import { compileWand } from './compiler';
import { WAND_FRAMES } from './wandCatalog';

/**
 * Wand frames as LOOT: which frame a boss's wreckage or an altar turns up, how it compares with the one it
 * would replace, and — the point of the exercise — which cards the swap would push out when the new frame
 * has fewer slots. Pure of Ctx (the overlay and the director call in with plain data), unit-tested.
 */

/** The four found archetypes, each a specialist. */
export const ARCHETYPE_FRAMES: readonly string[] = ['quill', 'pepperpot', 'mortar', 'samovar'];
/** The Wandwright's paid upgrades; they may also turn up deeper down. */
export const UPGRADE_FRAMES: readonly string[] = ['brass', 'void'];
/** One in this many waystone altars also turns up a wand. */
export const WAND_FIND_EVERY = 3;

export function frameById(id: string): WandFrame | null {
  return WAND_FRAMES[id] ?? null;
}

/**
 * Seat a wand's cards in a frame of `capacity` slots. A card that sits past the end is not simply lost:
 * the cards close up (empty slots drop out, the order the compiler reads is kept) and only what still does
 * not fit is displaced — handed back to the satchel by the caller, and named by the overlay beforehand.
 */
export function refitCards(
  cards: ReadonlyArray<CardId | null>,
  capacity: number,
): { cards: Array<CardId | null>; displaced: CardId[]; closedUp: boolean } {
  const keep = Math.max(0, Math.floor(capacity));
  const overhang = cards.slice(keep).some((c) => c !== null);
  let seated: Array<CardId | null>;
  const displaced: CardId[] = [];
  if (!overhang) {
    seated = cards.slice(0, keep);
  } else {
    const packed = cards.filter((c): c is CardId => c !== null);
    seated = packed.slice(0, keep);
    displaced.push(...packed.slice(keep));
  }
  while (seated.length < keep) seated.push(null);
  return { cards: seated, displaced, closedUp: overhang };
}

export type StatTrend = 'better' | 'worse' | 'same';

export interface FrameStatRow {
  label: string;
  from: string;
  to: string;
  trend: StatTrend;
}

const seconds = (frames: number): string => (frames / 60).toFixed(2) + 's';
const perSecond = (perTick: number): string => Math.round(perTick * 60) + '/s';
const degrees = (rad: number): string => ((rad * 180) / Math.PI).toFixed(1) + '°';

function trendOf(from: number, to: number, higherIsBetter: boolean): StatTrend {
  if (Math.abs(from - to) < 1e-9) return 'same';
  return (to > from) === higherIsBetter ? 'better' : 'worse';
}

/** Stat rows for a refit, `from` the frame in the wand now, `to` the one on offer. */
export function frameStatRows(from: WandFrame, to: WandFrame): FrameStatRow[] {
  return [
    { label: 'Slots', from: String(from.capacity), to: String(to.capacity), trend: trendOf(from.capacity, to.capacity, true) },
    { label: 'Cast', from: seconds(from.castDelay), to: seconds(to.castDelay), trend: trendOf(from.castDelay, to.castDelay, false) },
    { label: 'Recharge', from: seconds(from.recharge), to: seconds(to.recharge), trend: trendOf(from.recharge, to.recharge, false) },
    { label: 'Mana', from: String(from.manaMax), to: String(to.manaMax), trend: trendOf(from.manaMax, to.manaMax, true) },
    { label: 'Regen', from: perSecond(from.manaRegen), to: perSecond(to.manaRegen), trend: trendOf(from.manaRegen, to.manaRegen, true) },
    { label: 'Spread', from: degrees(from.spread), to: degrees(to.spread), trend: trendOf(from.spread, to.spread, false) },
  ];
}

/** How a wand's own cards would cycle in a frame: groups per cycle, the cycle's length, and the mana it spends. */
export interface CycleView {
  groups: number;
  seconds: number;
  mana: number;
  /** Mana the frame refills over that cycle, as a share of what the cycle spends (>= 1 never runs dry). */
  sustain: number;
}

export function cycleView(cards: ReadonlyArray<CardId | null>, frame: WandFrame): CycleView {
  const program = compileWand([...cards]);
  const groups = program.length;
  if (groups === 0) return { groups: 0, seconds: 0, mana: 0, sustain: Infinity };
  const ticks = groups * frame.castDelay + frame.recharge;
  const mana = program.reduce((sum, g) => sum + g.manaCost, 0);
  const regen = frame.manaRegen * ticks;
  return { groups, seconds: ticks / 60, mana, sustain: mana > 0 ? regen / mana : Infinity };
}

/** The whole comparison one wand's refit shows: stats, the build-specific cycle, the cards that would not fit. */
export interface RefitPreview {
  rows: FrameStatRow[];
  before: CycleView;
  after: CycleView;
  /** Cards pushed out of the wand (they return to the satchel). */
  displaced: CardId[];
  /** Cards that move to a different slot as the rest close up. */
  shifted: boolean;
}

export function previewRefit(cards: ReadonlyArray<CardId | null>, current: WandFrame, next: WandFrame): RefitPreview {
  const seated = refitCards(cards, next.capacity);
  return {
    rows: frameStatRows(current, next),
    before: cycleView(cards, current),
    after: cycleView(seated.cards, next),
    displaced: seated.displaced,
    shifted: seated.closedUp,
  };
}

/** "Spark Bolt, Heavy Charm and Water Trail" — the cards a refit would send back to the satchel. */
export function displacedNames(cards: readonly CardId[]): string {
  const names = cards.map((id) => CARD_DEFS[id].name);
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/* ---------------- what turns up ---------------- */

export interface FindInput {
  /** The frame ids on wand I and wand II now. */
  equipped: readonly string[];
  depth?: number;
  rng?: () => number;
}

function weightFor(id: string, depth: number): number {
  // The specialists are the find; the paid frames are rare below the first real floors.
  if (ARCHETYPE_FRAMES.includes(id)) return 3;
  return depth >= 3 ? 1.5 : 0.5;
}

function drawFrames(pool: string[], count: number, depth: number, rng: () => number): string[] {
  const out: string[] = [];
  const left = [...pool];
  while (out.length < count && left.length > 0) {
    const weights = left.map((id) => weightFor(id, depth));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng() * total;
    let at = left.length - 1;
    for (let i = 0; i < left.length; i++) {
      roll -= weights[i];
      if (roll < 0) { at = i; break; }
    }
    out.push(left.splice(at, 1)[0]);
  }
  return out;
}

/** One frame a boss's wreckage or an altar turns up: never one already in a wand's hand. */
export function pickFrameFind(input: FindInput): string | null {
  const rng = input.rng ?? entityRandom;
  const pool = [...ARCHETYPE_FRAMES, ...UPGRADE_FRAMES].filter((id) => !input.equipped.includes(id) && WAND_FRAMES[id]);
  return drawFrames(pool, 1, input.depth ?? 2, rng)[0] ?? null;
}

/**
 * The Wandwright's rack: up to three frames to choose from. The paid upgrades have rows of their own, so the
 * rack is the specialists (any not already in hand).
 */
export function pickFrameRack(input: FindInput, count = 3): string[] {
  const rng = input.rng ?? entityRandom;
  const pool = ARCHETYPE_FRAMES.filter((id) => !input.equipped.includes(id) && WAND_FRAMES[id]);
  return drawFrames([...pool], count, input.depth ?? 2, rng);
}

/** Ask the UI for a wand offer; with no UI listening the offer is simply declined (a frame is never swapped unseen). */
export function requestWandOffer(
  ctx: Ctx,
  offer: {
    source: 'boss' | 'altar' | 'sanctum';
    title: string;
    prompt?: string;
    frames: string[];
    onChoose(frameId: string, wand: 0 | 1): void;
    onDecline?(): void;
  },
): boolean {
  const request = { ...offer, frames: offer.frames.filter((id) => WAND_FRAMES[id]), handled: false };
  if (request.frames.length === 0) return false;
  ctx.events.emit('wandOfferRequested', request);
  if (!request.handled) {
    offer.onDecline?.();
    return false;
  }
  return true;
}

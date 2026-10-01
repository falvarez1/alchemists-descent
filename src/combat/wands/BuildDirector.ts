import type { BuildNotes, CardId, Ctx, EnemyKind, WandsApi } from '@/core/types';
import type { EventMap } from '@/core/events';
import { entityRandom } from '@/core/simRandom';
import { CARD_DEFS, PROJECTILE_MOD_HOST_CARDS } from './cards';
import { getDiscoveredCards } from './cardDiscovery';
import { composeAltarOffer, composeDepthOffer } from './altarOffers';
import { HOST_BOUND_MODIFIERS, type DeadModifier } from './cardRules';
import { collectOwnedCards, requestCardOffer } from './rewardPools';
import { WAND_FIND_EVERY, pickFrameFind, requestWandOffer } from './wandFinds';

/**
 * The build decisions that sit ON the route (Breathing Works, pillar 2 "the choice"): a lit waystone's altar
 * is a three-card choice, a floor's arrival gift is a choice, a boss's wreckage and one altar in three turn
 * up a wand frame to refit, and a modifier cast on a card it does nothing for says so, once. It also keeps
 * the run's decision NOTES (offers, altars, frames, time per floor) for the ledger and the playtest report.
 *
 * WandSystem owns one and calls in from its event handlers; everything here goes through the public WandsApi
 * and the Ctx event bus (events outward, calls inward) — no DOM. Offers are never requested straight from
 * an event: they wait in `pending` until play is calm (not paused, not in a curtain or a story beat, the
 * player alive), so a lit waystone's gong, a boss's death and a floor's title card all get their moment first.
 */

/** Ticks a lit waystone's flare gets before the altar speaks. */
const ALTAR_DELAY = 50;
/** Ticks after arrival before the floor's gift is offered (the arrival grace, while the title card is up, holds it longer). */
const GIFT_DELAY = 60;
/** Ticks after a boss falls before its wreckage turns up a frame. */
const BOSS_DELAY = 170;
/** Ticks between an altar's card pick and its wand offer, when it has one. */
const FOLLOW_DELAY = 40;
/** The bosses whose wreckage holds a wand. The Colossus ends the run: a frame found there would never be fired. */
const FRAME_BOSSES: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['leviathan', 'lenswright', 'rimewarden']);
const PICKS_CAP = 48;

export function freshBuildNotes(): BuildNotes {
  return {
    offersShown: 0,
    offersTaken: 0,
    bySource: {},
    altars: 0,
    bargainsTaken: 0,
    deadCardCasts: 0,
    framesFound: 0,
    framesFitted: 0,
    framesLeft: 0,
    floorTicks: {},
    picks: [],
    deadCaptioned: [],
  };
}

const whole = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** A note record read back from a save: unknown shapes become an empty one, stale card ids drop out. */
export function sanitizeBuildNotes(raw: unknown): BuildNotes {
  const out = freshBuildNotes();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<Record<keyof BuildNotes, unknown>>;
  out.offersShown = whole(r.offersShown);
  out.offersTaken = whole(r.offersTaken);
  out.altars = whole(r.altars);
  out.bargainsTaken = whole(r.bargainsTaken);
  out.deadCardCasts = whole(r.deadCardCasts);
  out.framesFound = whole(r.framesFound);
  out.framesFitted = whole(r.framesFitted);
  out.framesLeft = whole(r.framesLeft);
  if (r.bySource && typeof r.bySource === 'object') {
    for (const [k, v] of Object.entries(r.bySource as Record<string, unknown>)) {
      if (v && typeof v === 'object') out.bySource[k] = { shown: whole((v as { shown?: unknown }).shown), taken: whole((v as { taken?: unknown }).taken) };
    }
  }
  if (r.floorTicks && typeof r.floorTicks === 'object') {
    for (const [k, v] of Object.entries(r.floorTicks as Record<string, unknown>)) out.floorTicks[k] = whole(v);
  }
  const isCard = (c: unknown): c is CardId => typeof c === 'string' && Object.prototype.hasOwnProperty.call(CARD_DEFS, c);
  if (Array.isArray(r.picks)) out.picks = r.picks.filter(isCard).slice(-PICKS_CAP);
  if (Array.isArray(r.deadCaptioned)) out.deadCaptioned = r.deadCaptioned.filter(isCard);
  return out;
}

interface Pending {
  /** Not before this tick (ctx.state.frameCount). */
  at: number;
  run(): void;
}

/** The sentence a dead modifier earns: what, on what, and (for a body mod) what it was missing. */
export function deadCardText(d: Pick<DeadModifier, 'modifier' | 'host'>): string {
  const mod = CARD_DEFS[d.modifier].name;
  const host = CARD_DEFS[d.host].name;
  return HOST_BOUND_MODIFIERS.has(d.modifier) && !PROJECTILE_MOD_HOST_CARDS.has(d.host)
    ? `${mod} does nothing on ${host}: it needs a projectile body.`
    : `${mod} does nothing on ${host}.`;
}

export class BuildDirector {
  private notes: BuildNotes = freshBuildNotes();
  private readonly pending: Pending[] = [];
  private depth = 1;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly ctx: Ctx, private readonly wands: WandsApi) {
    const on = ctx.events.on.bind(ctx.events);
    this.disposers.push(
      // Every offer, whoever asks for it (a tome, the Sanctum, an altar): counted when shown and when taken.
      on('cardOfferRequested', (request) => this.watchCardOffer(request)),
      on('wandOfferRequested', (request) => this.watchWandOffer(request)),
      on('enemyKilled', ({ kind }) => this.onKilled(kind)),
      on('levelChanged', ({ depth }) => { this.depth = depth; }),
    );
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
  }

  /* ---------------- the notes ---------------- */

  view(): BuildNotes {
    return sanitizeBuildNotes(this.notes);
  }

  snapshot(): BuildNotes {
    return this.view();
  }

  restore(raw: unknown): void {
    this.notes = sanitizeBuildNotes(raw);
    this.pending.length = 0;
  }

  /** A new run: the record starts empty and nothing is waiting. */
  reset(): void {
    this.notes = freshBuildNotes();
    this.pending.length = 0;
  }

  private count(key: string): void {
    this.ctx.telemetry?.count(key);
  }

  private source(name: string): { shown: number; taken: number } {
    return (this.notes.bySource[name] ??= { shown: 0, taken: 0 });
  }

  private watchCardOffer(request: EventMap['cardOfferRequested']): void {
    this.notes.offersShown++;
    this.source(request.source).shown++;
    this.count('build.offer.shown.' + request.source);
    const choose = request.onChoose;
    request.onChoose = (card: CardId): void => {
      this.notes.offersTaken++;
      this.source(request.source).taken++;
      this.notes.picks.push(card);
      if (this.notes.picks.length > PICKS_CAP) this.notes.picks.shift();
      this.count('build.offer.taken.' + request.source);
      choose(card);
    };
  }

  private watchWandOffer(request: EventMap['wandOfferRequested']): void {
    this.notes.framesFound++;
    this.count('build.frame.found.' + request.source);
    const choose = request.onChoose;
    request.onChoose = (frameId: string, wand: 0 | 1): void => {
      this.notes.framesFitted++;
      this.count('build.frame.fitted');
      choose(frameId, wand);
    };
    const decline = request.onDecline;
    request.onDecline = (): void => {
      this.notes.framesLeft++;
      this.count('build.frame.left');
      decline?.();
    };
  }

  /** WandSystem.grantCard reports every card that joined the satchel. */
  noteGranted(card: CardId): void {
    if (CARD_DEFS[card]?.bargain) {
      this.notes.bargainsTaken++;
      this.count('build.bargain.taken.' + card);
    }
  }

  /** Tick the per-floor clock (WandSystem.update runs only while the game does). */
  update(): void {
    const ctx = this.ctx;
    if (ctx.state.mode !== 'play') return;
    if (!ctx.player?.dead) {
      const key = String(this.depth);
      this.notes.floorTicks[key] = (this.notes.floorTicks[key] ?? 0) + 1;
    }
    this.pump();
  }

  /* ---------------- waiting for a calm moment ---------------- */

  private later(delay: number, run: () => void): void {
    this.pending.push({ at: (this.ctx.state.frameCount ?? 0) + delay, run });
  }

  /** Nothing else owns the screen: no pause, no curtain, no story beat, no Sanctum, a living player. */
  private calm(): boolean {
    const ctx = this.ctx;
    if (ctx.state.mode !== 'play' || ctx.state.paused) return false;
    if (ctx.player?.dead) return false;
    if (ctx.levels?.transitioning) return false;
    if (ctx.story?.beatActive) return false;
    if (ctx.sanctum?.isOpen) return false;
    // The floor's name is still up (Levels' arrival grace): an offer would land on top of its title card.
    if ((ctx.state.frameCount ?? 0) < (ctx.state.arrivalGraceUntil ?? -1)) return false;
    return true;
  }

  private pump(): void {
    const next = this.pending[0];
    if (!next || (this.ctx.state.frameCount ?? 0) < next.at || !this.calm()) return;
    this.pending.shift();
    next.run();
  }

  /** Offers still waiting for a calm moment (probes and tests read it). */
  get waiting(): number {
    return this.pending.length;
  }

  /* ---------------- the altar ---------------- */

  /** A waystone caught: the altar will speak once the flare has had its moment. */
  onWaystoneLit(): void {
    this.later(ALTAR_DELAY, () => this.openAltar());
  }

  private openAltar(): void {
    const ctx = this.ctx;
    const n = ++this.notes.altars;
    this.count('build.altar');
    const owned = collectOwnedCards(this.wands);
    const offer = composeAltarOffer({ holdings: this.wands, owned, discovered: getDiscoveredCards(), rng: entityRandom });
    requestCardOffer(ctx, {
      source: 'altar',
      title: 'The altar answers',
      prompt: 'Take one: a new host, a match for the wands you carry, or a wild card with a price.',
      cards: offer.cards,
      labels: offer.labels,
      onChoose: (card) => {
        this.wands.grantCard(ctx, card);
        ctx.audio?.learn?.();
        // One altar in three also turns up a wand.
        if (n % WAND_FIND_EVERY === 0) this.later(FOLLOW_DELAY, () => this.openFrameFind('altar'));
      },
    });
  }

  /* ---------------- the floor's gift ---------------- */

  /** First arrival on a new floor: the gift is a choice now, offered once the floor has settled. */
  onDepthArrival(): void {
    this.later(GIFT_DELAY, () => {
      const ctx = this.ctx;
      const owned = collectOwnedCards(this.wands);
      const offer = composeDepthOffer({ holdings: this.wands, owned, discovered: getDiscoveredCards(), rng: entityRandom });
      requestCardOffer(ctx, {
        source: 'depth',
        title: 'A gift for the way down',
        prompt: 'Take one: a big hit, a clean one, or a way with the ground.',
        cards: offer.cards,
        labels: offer.labels,
        onChoose: (card) => {
          this.wands.grantCard(ctx, card);
          ctx.audio?.learn?.();
        },
      });
    });
  }

  /* ---------------- wands as loot ---------------- */

  private onKilled(kind: EnemyKind): void {
    if (!FRAME_BOSSES.has(kind)) return;
    this.later(BOSS_DELAY, () => this.openFrameFind('boss'));
  }

  private openFrameFind(source: 'boss' | 'altar'): void {
    const ctx = this.ctx;
    const equipped = this.wands.wands.map((w) => w.frame.id);
    const frame = pickFrameFind({ equipped, depth: this.depth, rng: entityRandom });
    if (!frame) return;
    requestWandOffer(ctx, {
      source,
      title: source === 'boss' ? 'A frame in the wreckage' : 'A wand on the altar',
      prompt: 'Refit wand I or II with it, or leave it where it lies. Cards that no longer fit go back to your satchel.',
      frames: [frame],
      onChoose: (frameId, wand) => {
        this.wands.upgradeFrame(ctx, wand, frameId);
      },
    });
  }

  /* ---------------- the dead-card caption ---------------- */

  /**
   * A group was just cast. Any modifier in it that does nothing to the projectile it rode says so — once per
   * card per run — because the compiler still charged its mana and the HUD caption simply left it out.
   */
  noteCast(dead: readonly DeadModifier[], groupSlots: readonly number[]): void {
    if (dead.length === 0) return;
    for (const d of dead) {
      if (!groupSlots.includes(d.slot) || this.notes.deadCaptioned.includes(d.modifier)) continue;
      this.notes.deadCaptioned.push(d.modifier);
      this.notes.deadCardCasts++;
      this.count('build.deadCard.' + d.modifier);
      const text = deadCardText(d);
      this.ctx.events.emit('deadCardCast', { card: d.modifier, host: d.host, text });
      this.ctx.events.emit('toast', { text });
      return;
    }
  }
}

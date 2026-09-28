import { CARD_DEFS } from '@/combat/wands/cards';
import type { CardId, Ctx } from '@/core/types';

/**
 * How to light a waystone, said without stopping the game. QA counted 41 modal
 * prompts in one session: a kit with no fire card paused the game on every
 * approach to every unlit waystone. The lesson is now a teach card (once per
 * waystone per floor, ui/HintTeachOverlay: non-modal, it yields to the story's
 * beats) and the contextual hint line (game/Hints) while he stands at one.
 */

/** Fire spells that keep a waystone's bowl burning, best first. */
export const WAYSTONE_FIRE_CARDS: readonly CardId[] = ['flame', 'emberstorm', 'meteor'];

/** Cells: this close to an unlit waystone the help is offered. */
export const WAYSTONE_HELP_RADIUS = 26;

/** The wand in hand can already make lasting fire. */
export function wandMakesFire(ctx: Ctx): boolean {
  const active = ctx.wands.wands[ctx.wands.active];
  return !!active && WAYSTONE_FIRE_CARDS.some((c) => active.cards.includes(c));
}

/** A fire card he owns (in the collection or on the other wand), if any. */
export function ownedFireCard(ctx: Ctx): CardId | null {
  return WAYSTONE_FIRE_CARDS.find((c) => ctx.wands.collection.includes(c) || ctx.wands.wands.some((w) => w.cards.includes(c))) ?? null;
}

export interface WaystoneHelp {
  /** The hint line (tier 2, under the objective). */
  line: string;
  /** The teach card. */
  title: string;
  body: string;
}

/** What to say at an unlit waystone, for the kit he carries. */
export function waystoneHelp(ctx: Ctx): WaystoneHelp {
  const title = 'An Unlit Waystone';
  const what = 'A waystone lights when fire keeps burning in the stone bowl at its base; from then on it is where you wake after dying.';
  if (wandMakesFire(ctx)) {
    return { line: 'Unlit waystone — hold your flame on its bowl', title, body: `${what} Hold your wand’s flame on the bowl until the brazier catches.` };
  }
  const card = ownedFireCard(ctx);
  if (card) {
    const name = CARD_DEFS[card].name;
    return {
      line: `Unlit waystone — seat ${name} at the bench (B) to light it`,
      title,
      body: `${what} Your ${name} card makes lasting fire: seat it in your wand at the bench (B), then hold its flame on the bowl.`,
    };
  }
  return {
    line: 'Unlit waystone — it wants fire that lasts in its bowl',
    title,
    body: `${what} A Spark Bolt’s flash is gone before the bowl warms. Bring fire that lasts: pour lava in from a flask, push something burning onto it, or find a fire spell card.`,
  };
}

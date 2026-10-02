import type { FighterId } from '@/content/fighters';
import type { Ctx } from '@/core/types';
import { getBindings, keyLabel } from '@/input/bindings';
import { FighterRoster } from '@/ui/FighterRoster';

/**
 * Opening the Fighter Roster for whoever asks (the title's Arena door, the Proving Yard's panel). One roster
 * serves the whole game (its overlay has a fixed id), so the caller that opened it hands over its own
 * callbacks for the one choice.
 */

let roster: FighterRoster | null = null;
const handlers: { choose: ((id: FighterId | null) => void) | null; cancel: (() => void) | null } = { choose: null, cancel: null };

function sharedRoster(ctx: Ctx): FighterRoster {
  roster ??= new FighterRoster(ctx, {
    onChoose: (id) => { const h = handlers.choose; handlers.choose = handlers.cancel = null; h?.(id); },
    onCancel: () => { const h = handlers.cancel; handlers.choose = handlers.cancel = null; h?.(); },
  });
  return roster;
}

/** Open the roster for one caller; `choose` fires with the choice (null = the classic Alchemist), `cancel` on Escape or Back. */
export function openFighterRoster(ctx: Ctx, selected: FighterId | null, choose: (id: FighterId | null) => void, cancel?: () => void): void {
  handlers.choose = choose;
  handlers.cancel = cancel ?? null;
  const r = sharedRoster(ctx);
  const b = getBindings();
  r.refresh({ keyLabels: { tactical: keyLabel(b.tactical), ultimate: keyLabel(b.ultimate) } });
  r.open(selected);
}

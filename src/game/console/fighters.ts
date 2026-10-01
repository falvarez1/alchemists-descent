import { FIGHTER_DEFS, FIGHTER_ORDER, isFighterId } from '@/content/fighters';
import { isRunTainted, taintRun } from '@/core/runTaint';
import type { ConsoleCommandDefinition } from '@/game/console/registry';
import { currentToken, info, matching, result } from '@/game/console/kit';

/**
 * The tester's `fighter` command (src/fighters): list the ten, equip one (or `none` for the classic
 * Alchemist), fill the ultimate's bar, clear the cooldowns. Listing never taints. Equipping or topping up
 * does when a real run is in progress, because a fighter or a free ultimate put on by hand is not the
 * descent the player chose on the title, so the run becomes a test run (no autosave over a real
 * expedition, no ledger credit, no unlocks), like `kit` and `tier`. In the Sandbox nothing is tainted.
 * Registered behind `__AUTHORING__` with the travel commands.
 */

const TAINT_SENTENCE = 'DEBUG TAINT: this run is now a test run (no autosave over a real expedition, no ledger credit, no unlocks).';

export function createFighterCommands(): ConsoleCommandDefinition[] {
  return [{
    name: 'fighter',
    aliases: ['fighters'],
    info: info('game.fighter', 'Fighter', 'fighter [id|none|charge [0-1]|refill]', 'List the fighters, equip one, or top up the ultimate and cooldowns. Changing it taints a real run.'),
    run: (ctx, args) => {
      const fighters = ctx.fighters;
      if (!fighters) return result(false, 'fighter: the fighter system is not available in this context.', { code: 'not-ready' });
      const verb = (args[0] ?? 'list').toLowerCase();
      const taint = (): string => {
        if (!ctx.run?.active) return '';
        const was = isRunTainted(ctx.state);
        taintRun(ctx);
        return was ? '' : ` ${TAINT_SENTENCE}`;
      };
      if (verb === 'list') {
        const now = fighters.id;
        const rows = FIGHTER_ORDER.map((id) => {
          const d = FIGHTER_DEFS[id];
          return { id, name: d.name, title: d.title, role: d.role, tactical: d.tactical.name, ultimate: d.ultimate.name, on: id === now };
        });
        const text = [
          `Fighters (* equipped${now === null ? '; none: the classic Alchemist' : ''}):`,
          ...rows.map((r) => `  ${(r.on ? '* ' : '  ') + r.id.padEnd(15)}${r.role.padEnd(11)}${r.name}, ${r.title}: ${r.tactical} / ${r.ultimate}`),
          'fighter <id> | none | charge [0-1] | refill.',
        ].join('\n');
        return result(true, text, { action: 'fighters', current: now, fighters: rows });
      }
      if (verb === 'none' || verb === 'classic') {
        fighters.equip(null);
        return result(true, `The classic Alchemist.${taint()}`, { action: 'fighter', id: null });
      }
      if (verb === 'refill') {
        if (fighters.id === null) return result(false, 'No fighter equipped.', { code: 'no-fighter' });
        fighters.refill();
        return result(true, `Cooldowns cleared and the ultimate's bar filled.${taint()}`, { action: 'refill' });
      }
      if (verb === 'charge') {
        if (fighters.id === null) return result(false, 'No fighter equipped.', { code: 'no-fighter' });
        const amount = args[1] === undefined ? 1 : Number(args[1]);
        if (!Number.isFinite(amount) || amount < 0 || amount > 1) return result(false, 'Usage: fighter charge [0-1]', { code: 'usage' });
        fighters.addCharge(amount);
        return result(true, `Ultimate charge +${Math.round(amount * 100)}%.${taint()}`, { action: 'charge', amount });
      }
      if (!isFighterId(verb)) return result(false, `Unknown fighter "${args[0]}". Fighters: ${FIGHTER_ORDER.join(', ')}.`, { code: 'parse-fighter', raw: args[0], expected: [...FIGHTER_ORDER] });
      fighters.equip(verb);
      const d = FIGHTER_DEFS[verb];
      return result(true, `${d.name}, ${d.title}. Z: ${d.tactical.name}. T: ${d.ultimate.name}.${taint()}`, { action: 'fighter', id: verb });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching([...FIGHTER_ORDER, 'none', 'charge', 'refill', 'list'], currentToken(req)) : []),
  }];
}

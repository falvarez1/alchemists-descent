import { FIGHTER_ORDER, isFighterId } from '@/content/fighters';
import { BRAIN_BLURBS, isBrainId } from '@/arena/ai';
import { botDriverFor, rivalDriverFor } from '@/arena/ai/driver';
import type { ConsoleCommandDefinition } from '@/game/console/registry';
import { currentToken, info, matching, result } from '@/game/console/kit';

/**
 * The tester's `arena` command (src/arena, docs/arena): put a second fighter in the world, give either one a computer brain, restart
 * the bout. Slot 0 is the fighter you hold; slot 1 is the rival. `ai` (src/game/console/ai) drives slot 0 alone; `arena bot` drives either.
 */

const USAGE = 'arena [status | add <fighter> [x y] | remove | reset | bot <0|1> <dummy|basic|off> [level 1-5]]';

export function createArenaCommands(): ConsoleCommandDefinition[] {
  return [{
    name: 'arena',
    info: info('game.arena', 'Arena', USAGE, 'Add a rival fighter, put computer brains in charge of either fighter, restart the bout. The rival is hurt by your spells, kicks, blasts and kit and hurts you with its own.', 'game'),
    run: async (ctx, args) => {
      const arena = ctx.arena;
      if (!arena) return result(false, 'arena: not available in this context.', { code: 'not-ready' });
      const verb = (args[0] ?? 'status').toLowerCase();
      if (verb === 'status') {
        const b = arena.bout;
        const lines = [`bout ${b.state}${b.winner !== null ? `, winner slot ${b.winner}` : ''}; ${arena.slotCount} fighter${arena.slotCount === 1 ? '' : 's'}`];
        for (let s = 0; s < arena.slotCount; s++) {
          const bn = arena.bundle(s);
          if (!bn) continue;
          const p = bn.player;
          lines.push(`  slot ${s}: ${arena.fighterId(s) ?? 'the Alchemist'}  hp ${Math.round(p.hp)}/${Math.round(p.maxHp)}${p.dead ? ' DOWN' : ''}  at ${Math.round(p.x)},${Math.round(p.y)}`);
        }
        return result(true, lines.join('\n'), { state: b.state, winner: b.winner, slots: arena.slotCount });
      }
      if (verb === 'add') {
        const id = args[1];
        if (!isFighterId(id)) return result(false, `Usage: arena add <${FIGHTER_ORDER.join('|')}> [x y]`, { code: 'usage' });
        const x = args[2] === undefined ? ctx.player.x + 70 : Number(args[2]);
        const y = args[3] === undefined ? ctx.player.y : Number(args[3]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return result(false, 'arena add: x and y must be numbers.', { code: 'usage' });
        const slot = await arena.addRival(id, x, y);
        return result(true, `${id} joined as slot ${slot} at ${Math.round(x)},${Math.round(y)}. \`arena bot 1 basic 3\` gives it a brain.`, { slot });
      }
      if (verb === 'remove') {
        arena.removeRival(1);
        return result(true, 'The rival is gone.', { slots: arena.slotCount });
      }
      if (verb === 'reset') {
        arena.reset();
        return result(true, 'A new bout.', { state: arena.bout.state });
      }
      if (verb === 'bot') {
        const slot = Number(args[1]);
        const brain = (args[2] ?? '').toLowerCase();
        if (!Number.isInteger(slot) || slot < 0 || slot >= arena.slotCount) return result(false, `Usage: ${USAGE}`, { code: 'usage' });
        const driver = slot === 0 ? botDriverFor(ctx) : rivalDriverFor(ctx, slot);
        if (!driver) return result(false, `arena bot: no fighter in slot ${slot}.`, { code: 'no-slot' });
        if (brain === 'off') { driver.off(); return result(true, `Slot ${slot}: no brain.`, { slot, active: false }); }
        if (!isBrainId(brain)) return result(false, `Usage: ${USAGE}`, { code: 'usage' });
        const level = args[3] === undefined ? 3 : Number(args[3]);
        if (!Number.isFinite(level)) return result(false, 'arena bot: the level is 1-5.', { code: 'usage' });
        const made = driver.install(brain, level);
        return result(true, `Slot ${slot}: ${made.id} level ${made.level} (${BRAIN_BLURBS[made.id]}).`, { slot, brain: made.id, level: made.level });
      }
      return result(false, `Unknown arena verb "${args[0]}". ${USAGE}`, { code: 'usage' });
    },
    complete: (_ctx, req) => {
      if (req.completingArg === 0) return matching(['status', 'add', 'remove', 'reset', 'bot'], currentToken(req));
      if (req.completingArg === 1 && req.args[0]?.toLowerCase() === 'add') return matching(FIGHTER_ORDER, currentToken(req));
      if (req.completingArg === 2 && req.args[0]?.toLowerCase() === 'bot') return matching(['dummy', 'basic', 'off'], currentToken(req));
      return [];
    },
  }];
}

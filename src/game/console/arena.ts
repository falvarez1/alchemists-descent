import { FIGHTER_ORDER, isFighterId } from '@/content/fighters';
import { BRAIN_BLURBS, isBrainId } from '@/arena/ai';
import { botDriverFor, brainForSlot, rivalDriverFor } from '@/arena/ai/driver';
import type { ConsoleCommandDefinition } from '@/game/console/registry';
import { currentToken, info, matching, result } from '@/game/console/kit';
import { difficultyLevel } from '@/config/aiTiers';
import { isPersonality, PERSONALITY_IDS } from '@/config/aiPersonalities';

/**
 * The tester's `arena` command (src/arena, docs/arena): put a second fighter in the world, give either one a computer brain, restart
 * the bout. Slot 0 is the fighter you hold; slot 1 is the rival. `ai` (src/game/console/ai) drives slot 0 alone; `arena bot` drives either.
 */

const USAGE = 'arena [status | add <fighter> [x y] | remove | reset | bot <0|1> <dummy|basic|off> [easy|normal|hard|expert|1-5] [personality]]';

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
        const bots = Array.from({ length: arena.slotCount }, (_, slot) => {
          const brain = brainForSlot(ctx, slot);
          return brain ? { brain: brain.id, level: brain.level, ...brain.status, personality: brain.personality } : null;
        });
        return result(true, lines.join('\n'), { state: b.state, winner: b.winner, slots: arena.slotCount, bots });
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
        const level = difficultyLevel(args[3] ?? 'normal');
        if (level === null || (args[4] !== undefined && !isPersonality(args[4]))) return result(false, USAGE, { code: 'usage' });
        const made = driver.install(brain, level, { personality: isPersonality(args[4]) ? args[4] : undefined });
        return result(true, `Slot ${slot}: ${made.id} ${made.personality} level ${made.level} (${BRAIN_BLURBS[made.id]}).`, { slot, brain: made.id, level: made.level, personality: made.personality });
      }
      return result(false, `Unknown arena verb "${args[0]}". ${USAGE}`, { code: 'usage' });
    },
    complete: (_ctx, req) => {
      if (req.completingArg === 0) return matching(['status', 'add', 'remove', 'reset', 'bot'], currentToken(req));
      if (req.completingArg === 1 && req.args[0]?.toLowerCase() === 'add') return matching(FIGHTER_ORDER, currentToken(req));
      if (req.completingArg === 2 && req.args[0]?.toLowerCase() === 'bot') return matching(['dummy', 'basic', 'off'], currentToken(req));
      if (req.completingArg === 4 && req.args[0]?.toLowerCase() === 'bot') return matching(PERSONALITY_IDS, currentToken(req));
      return [];
    },
  }];
}

interface FightToolsHandle {
  ready(): Promise<void>;
  params: {
    list(prefix?: string): Array<{ path: string; default: number | boolean; min: number; max: number }>;
    get(path: string): number | boolean | undefined;
    set(path: string, value: number | boolean): boolean;
    reset(): void;
    snapshot(): Record<string, number | boolean>;
  };
}

const FTUNE_USAGE = 'ftune [list [prefix] | get <path> | set <path> <value> | diff | reset]';

/**
 * The tester's `ftune` command: turn any fighter number live (a body multiplier, a kit's cooldown or damage, the duel's tempo) while you
 * watch the Duel Stage; the same registry the balance tuner turns (src/fighters/paramOverride). A change made mid-fight is unsupported for
 * a kit's cooldown and an ultimate's length (read when the fighter is equipped): re-equip, or start the next bout.
 */
export function createFtuneCommands(): ConsoleCommandDefinition[] {
  return [{
    name: 'ftune',
    info: info('game.ftune', 'Fighter tuning', FTUNE_USAGE, 'List, read and turn the fighter numbers (bodies, kits, the duel tempo) live; diff shows what you changed.', 'game'),
    run: async (_ctx, args) => {
      const tools = (window as unknown as { __fight?: FightToolsHandle }).__fight;
      if (!tools) return result(false, 'ftune: the fight tools are not loaded (a dev build, once the page has settled).', { code: 'not-ready' });
      await tools.ready();
      const p = tools.params;
      const verb = (args[0] ?? 'list').toLowerCase();
      if (verb === 'list') {
        const rows = p.list(args[1] ?? '');
        const shown = rows.slice(0, 60);
        const text = [`${rows.length} knobs${args[1] ? ` under "${args[1]}"` : ''}${rows.length > shown.length ? ' (first 60: add a prefix, e.g. ftune list body.brann)' : ''}:`, ...shown.map((r) => `  ${r.path.padEnd(44)} ${String(p.get(r.path)).padStart(8)}  (${r.min}..${r.max}, shipped ${r.default})`)].join('\n');
        return result(true, text, { count: rows.length });
      }
      if (verb === 'get') {
        const v = p.get(args[1] ?? '');
        return v === undefined ? result(false, `ftune: no knob "${args[1]}".`, { code: 'unknown' }) : result(true, `${args[1]} = ${v}`, { path: args[1], value: v });
      }
      if (verb === 'set') {
        const raw = args[2];
        const value = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
        if (!args[1] || raw === undefined || (typeof value === 'number' && !Number.isFinite(value))) return result(false, `Usage: ${FTUNE_USAGE}`, { code: 'usage' });
        return p.set(args[1], value) ? result(true, `${args[1]} = ${value}`, { path: args[1], value }) : result(false, `ftune: ${args[1]} refused ${raw} (unknown knob, wrong type, or out of its range).`, { code: 'refused' });
      }
      if (verb === 'diff') {
        const d = p.snapshot();
        const keys = Object.keys(d);
        return result(true, keys.length ? keys.map((k) => `  ${k} = ${d[k]}`).join('\n') : 'Nothing changed from the shipped numbers.', { diff: d });
      }
      if (verb === 'reset') { p.reset(); return result(true, 'Every number is back to its shipped value.', { reset: true }); }
      return result(false, `Unknown ftune verb "${args[0]}". ${FTUNE_USAGE}`, { code: 'usage' });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['list', 'get', 'set', 'diff', 'reset'], currentToken(req)) : []),
  }];
}

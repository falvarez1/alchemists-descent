import { AI_LEVELS, AI_TIERS, AI_TIER_KEYS, AI_TIER_RANGES, resetAiTiers, setAiTierValue } from '@/config/aiTiers';
import type { AiTierKey } from '@/config/aiTiers';
import { BRAIN_BLURBS, BRAIN_IDS, isBrainId } from '@/arena/ai';
import { botDriverFor } from '@/arena/ai/driver';
import type { ConsoleCommandDefinition } from '@/game/console/registry';
import { currentToken, info, matching, result } from '@/game/console/kit';

/**
 * The tester's `ai` command (src/arena/ai, docs/arena/AI-FIGHTERS.md): put a computer brain in charge of the fighter you are
 * holding, change its skill live, tune a skill level's four numbers, or hand the keyboard back. A bot drives the same inputs a
 * person does (keys, the cursor, the trigger, the Z/T and kick presses); the keyboard stands down while it plays.
 * Registered behind `__AUTHORING__` with the other fighter commands.
 */

const USAGE = 'ai [status | off | dummy|basic [level 1-5] | level <1-5> | tier <1-5> <reaction|aimError|decision|mistake> <n> | tiers | reset]';

function statusText(ctx: Parameters<ConsoleCommandDefinition['run']>[0]): { text: string; data: unknown } {
  const d = botDriverFor(ctx);
  const b = d.brain;
  if (!b) return { text: 'No bot: the keyboard is yours.', data: { active: false } };
  const s = b.status;
  const line = `${b.id} level ${b.level}: ${s.intent}${s.target !== '-' ? ` -> ${s.target}` : ''}${s.rule ? ` (${s.rule})` : ''}`;
  const stats = Object.entries(s.stats).map(([k, v]) => `${k} ${v}`).join(', ');
  return { text: `${line}\n  ${stats}`, data: { active: true, brain: b.id, level: b.level, status: s } };
}

export function createAiCommands(): ConsoleCommandDefinition[] {
  return [{
    name: 'ai',
    info: info('game.ai', 'AI fighter', USAGE, 'Put a computer brain in charge of your fighter (the keyboard stands down), change its skill, tune the skill levels, or hand the keyboard back.', 'game'),
    run: (ctx, args) => {
      const verb = (args[0] ?? 'status').toLowerCase();
      const driver = botDriverFor(ctx);
      if (verb === 'status') {
        const s = statusText(ctx);
        return result(true, s.text, s.data);
      }
      if (verb === 'off' || verb === 'stop') {
        driver.off();
        return result(true, 'The keyboard is yours.', { active: false });
      }
      if (isBrainId(verb)) {
        if (ctx.state.mode !== 'play') return result(false, 'ai: start a run first (the Proving Yard is `run test --level fighter-test --world campaign-level`).', { code: 'not-playing' });
        const level = args[1] === undefined ? 3 : Number(args[1]);
        if (!Number.isFinite(level)) return result(false, `ai: "${args[1]}" is not a level (1-5).`, { code: 'usage' });
        const brain = driver.install(verb, level);
        return result(true, `${brain.id} level ${brain.level}: ${BRAIN_BLURBS[brain.id]}. \`ai off\` hands the keyboard back.`, { active: true, brain: brain.id, level: brain.level });
      }
      if (verb === 'level') {
        if (!driver.active) return result(false, 'ai: no bot is playing.', { code: 'no-bot' });
        const level = Number(args[1]);
        if (!Number.isFinite(level)) return result(false, 'Usage: ai level <1-5>', { code: 'usage' });
        return result(true, `Level ${driver.setLevel(level)}.`, { level: driver.brain?.level });
      }
      if (verb === 'tiers') {
        const rows = AI_LEVELS.map((l) => `  ${l}: ${AI_TIER_KEYS.map((k) => `${k} ${AI_TIERS[l][k]}`).join(', ')}`);
        return result(true, ['Skill levels (live; `ai tier <level> <key> <n>` changes one, `ai reset` restores):', ...rows].join('\n'), { tiers: AI_TIERS });
      }
      if (verb === 'tier') {
        const level = Number(args[1]);
        const key = args[2] as AiTierKey | undefined;
        const value = Number(args[3]);
        if (!Number.isFinite(level) || !key || !AI_TIER_KEYS.includes(key) || !Number.isFinite(value)) {
          return result(false, `Usage: ai tier <1-5> <${AI_TIER_KEYS.join('|')}> <n>`, { code: 'usage' });
        }
        const applied = setAiTierValue(level, key, value);
        const range = AI_TIER_RANGES[key];
        return result(true, `Level ${level} ${key} = ${applied} (range ${range.min}..${range.max}).`, { level, key, value: applied });
      }
      if (verb === 'reset') {
        resetAiTiers();
        return result(true, 'The skill levels are back to their shipped numbers.', { reset: true });
      }
      return result(false, `Unknown ai verb "${args[0]}". ${USAGE}`, { code: 'usage' });
    },
    complete: (_ctx, req) => {
      if (req.completingArg === 0) return matching(['status', 'off', ...BRAIN_IDS, 'level', 'tier', 'tiers', 'reset'], currentToken(req));
      if (req.completingArg === 2 && req.args[0]?.toLowerCase() === 'tier') return matching(AI_TIER_KEYS, currentToken(req));
      return [];
    },
  }];
}

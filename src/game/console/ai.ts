import { AI_LEVELS, AI_TIERS, AI_TIER_KEYS, AI_TIER_RANGES, difficultyLevel, resetAiTiers, setAiTierValue } from '@/config/aiTiers';
import type { AiTierKey } from '@/config/aiTiers';
import { AI_BEHAVIOR, AI_BEHAVIOR_KEYS, AI_BEHAVIOR_RANGES, resetAiBehavior, setAiBehaviorValue } from '@/config/aiBehavior';
import type { AiBehaviorKey } from '@/config/aiBehavior';
import { BRAIN_BLURBS, BRAIN_IDS, isBrainId } from '@/arena/ai';
import { botDriverFor } from '@/arena/ai/driver';
import type { ConsoleCommandDefinition } from '@/game/console/registry';
import { currentToken, info, matching, result } from '@/game/console/kit';
import { AI_PERSONALITIES, PERSONALITY_HELP, PERSONALITY_IDS, PERSONALITY_KEYS, isPersonality, resetPersonalities, setPersonalityValue } from '@/config/aiPersonalities';
import type { PersonalityKey } from '@/config/aiPersonalities';

/**
 * The tester's `ai` command (src/arena/ai, docs/arena/AI-FIGHTERS.md): put a computer brain in charge of the fighter you are
 * holding, change its skill live, tune a skill level's four numbers, or hand the keyboard back. A bot drives the same inputs a
 * person does (keys, the cursor, the trigger, the Z/T and kick presses); the keyboard stands down while it plays.
 * Registered behind `__AUTHORING__` with the other fighter commands.
 */

const USAGE = 'ai [status | off | dummy|basic [easy|normal|hard|expert|1-5] [personality] | level <difficulty> | personality <id> | profile [id [key value] | reset] | tier <difficulty> <key> <n> | tiers | behavior [key value | reset] | reset]';

function statusText(ctx: Parameters<ConsoleCommandDefinition['run']>[0]): { text: string; data: unknown } {
  const d = botDriverFor(ctx);
  const b = d.brain;
  if (!b) return { text: 'No bot: the keyboard is yours.', data: { active: false } };
  const s = b.status;
  const line = `${b.id} ${b.personality} level ${b.level}: ${s.intent}${s.target !== '-' ? ` -> ${s.target}` : ''}${s.rule ? ` (${s.rule})` : ''}`;
  const stats = Object.entries(s.stats).map(([k, v]) => `${k} ${v}`).join(', ');
  const scores = s.scores?.slice(0, 4).map(r => `  ${r.action} ${r.total.toFixed(2)}: ${Object.entries(r.terms).filter(([, n]) => n !== 0).map(([k, n]) => `${k} ${n.toFixed(2)}`).join(', ')}`).join('\n') ?? '';
  return { text: `${line}\n  ${stats}\n${scores}`, data: { active: true, brain: b.id, level: b.level, personality: b.personality, status: s } };
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
        const level = difficultyLevel(args[1] ?? 'normal');
        if (level === null || (args[2] !== undefined && !isPersonality(args[2]))) return result(false, USAGE, { code: 'usage' });
        const brain = driver.install(verb, level, { personality: isPersonality(args[2]) ? args[2] : undefined });
        return result(true, `${brain.id} level ${brain.level}: ${BRAIN_BLURBS[brain.id]}. \`ai off\` hands the keyboard back.`, { active: true, brain: brain.id, level: brain.level });
      }
      if (verb === 'level') {
        if (!driver.active) return result(false, 'ai: no bot is playing.', { code: 'no-bot' });
        const level = difficultyLevel(args[1] ?? '');
        if (level === null) return result(false, 'Usage: ai level <easy|normal|hard|expert|1-5>', { code: 'usage' });
        return result(true, `Level ${driver.setLevel(level)}.`, { level: driver.brain?.level });
      }
      if (verb === 'tiers') {
        const rows = AI_LEVELS.map((l) => `  ${l}: ${AI_TIER_KEYS.map((k) => `${k} ${AI_TIERS[l][k]}`).join(', ')}`);
        return result(true, ['Skill levels (live; `ai tier <level> <key> <n>` changes one, `ai reset` restores):', ...rows].join('\n'), { tiers: AI_TIERS });
      }
      if (verb === 'tier') {
        const level = difficultyLevel(args[1] ?? '');
        const key = args[2] as AiTierKey | undefined;
        const value = Number(args[3]);
        if (level === null || !key || !AI_TIER_KEYS.includes(key) || !Number.isFinite(value)) {
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
      if (verb === 'personality') {
        if (!isPersonality(args[1])) return result(false, `Choose ${PERSONALITY_IDS.join('|')}.`, { code: 'usage' });
        driver.setPersonality(args[1]);
        return result(true, `Personality: ${args[1]}. Difficulty unchanged.`, { personality: args[1] });
      }
      if (verb === 'profile') {
        if (args[1] === 'reset') { resetPersonalities(); return result(true, 'Personality profiles restored.', { reset: true }); }
        if (!args[1]) return result(true, PERSONALITY_IDS.join(', '), { profiles: AI_PERSONALITIES });
        const id = args[1];
        if (!isPersonality(id)) return result(false, `Choose ${PERSONALITY_IDS.join('|')}.`, { code: 'usage' });
        if (args.length === 2) return result(true, PERSONALITY_KEYS.map(k => `${k} = ${AI_PERSONALITIES[id][k]} (0..1): ${PERSONALITY_HELP[k]}`).join('\n'), { profile: AI_PERSONALITIES[id] });
        const key = args[2] as PersonalityKey, value = Number(args[3]);
        if (args.length !== 4 || !PERSONALITY_KEYS.includes(key) || !Number.isFinite(value)) return result(false, 'Usage: ai profile <id> <key> <0..1>', { code: 'usage' });
        return result(true, `${id}.${key} = ${setPersonalityValue(id, key, value)}`, { profile: AI_PERSONALITIES[id] });
      }
      if (verb === 'behavior') {
        if (args[1] === 'reset') {
          resetAiBehavior();
          return result(true, 'Combat behavior restored to defaults.', { behavior: { ...AI_BEHAVIOR } });
        }
        if (args.length === 1) {
          return result(true, AI_BEHAVIOR_KEYS.map((k) => `${k} = ${AI_BEHAVIOR[k]} (${AI_BEHAVIOR_RANGES[k].min}..${AI_BEHAVIOR_RANGES[k].max}): ${AI_BEHAVIOR_RANGES[k].description}`).join('\n'), { behavior: { ...AI_BEHAVIOR } });
        }
        const key = args[1] as AiBehaviorKey;
        const value = Number(args[2]);
        if (args.length !== 3 || !AI_BEHAVIOR_KEYS.includes(key) || !Number.isFinite(value)) return result(false, 'Usage: ai behavior [key number | reset]', { code: 'usage' });
        const applied = setAiBehaviorValue(key, value);
        return result(true, `${key} = ${applied}. Applies to all running Arena and Duel bots.`, { key, value: applied });
      }
      return result(false, `Unknown ai verb "${args[0]}". ${USAGE}`, { code: 'usage' });
    },
    complete: (_ctx, req) => {
      if (req.completingArg === 0) return matching(['status', 'off', ...BRAIN_IDS, 'level', 'tier', 'tiers', 'behavior', 'personality', 'profile', 'reset'], currentToken(req));
      if (req.completingArg === 1 && ['personality', 'profile'].includes(req.args[0])) return matching(PERSONALITY_IDS, currentToken(req));
      if (req.completingArg === 2 && req.args[0] === 'profile') return matching(PERSONALITY_KEYS, currentToken(req));
      if (req.completingArg === 1 && req.args[0]?.toLowerCase() === 'behavior') return matching([...AI_BEHAVIOR_KEYS, 'reset'], currentToken(req));
      if (req.completingArg === 2 && req.args[0]?.toLowerCase() === 'tier') return matching(AI_TIER_KEYS, currentToken(req));
      return [];
    },
  }];
}

import { FIGHTER_BODIES } from '@/content/fighterBodies';
import { FIGHTER_ORDER } from '@/content/fighters';
import type { FighterId } from '@/content/fighters';
import { BODY_RANGES } from '@/core/fighterBody';
import type { BodyField } from '@/core/fighterBody';
import type { Ctx } from '@/core/types';
import { botDriverFor, rivalDriverFor } from '@/arena/ai/driver';
import type { BrainId } from '@/arena/ai';
import { FightRecorder } from '@/fighters/telemetry/fightLog';
import type { FightTotals } from '@/fighters/telemetry/fightLog';
import { getParamOverride } from '@/fighters/paramOverride';
import type { ParamValue } from '@/fighters/paramOverride';
import { DUEL, resetDuelStage } from '@/world/duelStage';
import { FIGHTER_LOADOUTS } from '@/content/fighterLoadouts';
import { ARENA_RULES, ARENA_RULE_RANGES } from '@/config/arenaRules';
import type { ArenaRuleKey } from '@/config/arenaRules';
import type { FighterLoadout } from '@/content/fighterLoadouts';

/**
 * THE FIGHT HARNESS (docs/arena/TELEMETRY-AND-BALANCE.md 3.3), dev builds only: one call stages, runs and records a whole duel in the
 * page, in the paused-step regime with nothing rendered, and hands back the JSONL. `scripts/fight-batch.mjs` calls it a few thousand
 * times; a person can call `__fight.run(...)` from the console to watch one (pass \`render: true\`).
 *
 * A fight is: apply the parameter overrides, put the stage back to its start, equip slot 0, add the rival, give each a brain (its own
 * seeded Rng), record, step until a knockout or the tick cap, close the record, restore everything. Nothing carries to the next fight.
 */

export interface FightSide {
  id: FighterId;
  brain: BrainId;
  level: number;
}

export interface FightSpec {
  /** Slot 0 (spawns on the left) and slot 1 (the right): run a pair both ways round to cancel the side. */
  a: FightSide;
  b: FightSide;
  seed: number;
  /** The tick cap (default 5400: 90 s). A fight that reaches it is a timeout; the more healthy fighter is named the winner. */
  maxTicks?: number;
  sampleEvery?: number;
  overrides?: Record<string, ParamValue>;
  runId?: string;
  fight?: number;
  git?: string;
  dirty?: boolean;
  /** Render the frames (slow; only to watch). */
  render?: boolean;
  /** Slot 0 spawns on the RIGHT and slot 1 on the left (to tell a slot's edge from a side's). */
  swapSpawns?: boolean;
  /** Signature loadouts to use for this fight only (the data of content/fighterLoadouts, by fighter id): a loadout is tuned like a number. */
  loadouts?: Partial<Record<FighterId, Partial<Pick<FighterLoadout, 'wands' | 'flasks'>>>>;
}

export interface FightOutcome {
  winner: number | null;
  reason: 'ko' | 'timeout';
  ticks: number;
  hp: number[];
  jsonl: string;
  totals: FightTotals;
  ms: number;
}

/** What the harness needs of the game (the `Game` class satisfies it). */
export interface FightGame {
  ctx: Ctx;
  advance(ticks: number, options?: { render?: boolean }): void;
  resetForFight(seed: number, rebuild?: (ctx: Ctx) => void): void;
}

let bodiesRegistered = false;

export interface FightTools {
  run(spec: FightSpec): Promise<FightOutcome>;
  /** Load every kit's tuning and register the body and arena roots (the first `run` does it; the console's `ftune` asks first). */
  ready(): Promise<void>;
  params: ReturnType<typeof getParamOverride>;
  fighters: readonly FighterId[];
  /** Everything a tuner may turn: path, default, range. */
  knobs(prefix?: string): ReturnType<ReturnType<typeof getParamOverride>['list']>;
}

export function installFightTools(game: FightGame): FightTools {
  const params = getParamOverride();
  const ready = async (): Promise<void> => {
    await params.ready();
    if (!bodiesRegistered) {
      bodiesRegistered = true;
      params.addRoot('arena', ARENA_RULES, {
        range: (path) => { const r = ARENA_RULE_RANGES[path.slice(path.lastIndexOf('.') + 1) as ArenaRuleKey]; return r ? { min: r.min, max: r.max, step: 0.01 } : null; },
      });
      params.addRoot('body', FIGHTER_BODIES, {
        range: (path) => {
          const leaf = path.slice(path.lastIndexOf('.') + 1) as BodyField;
          const r = BODY_RANGES[leaf];
          return r ? { min: r.min, max: r.max, step: 0.01 } : null;
        },
      });
    }
  };

  async function run(spec: FightSpec): Promise<FightOutcome> {
    const t0 = performance.now();
    await ready();
    const ctx = game.ctx;
    const arena = ctx.arena;
    if (!arena) throw new Error('fight harness: no arena on this ctx');
    const restoreParams = params.apply(spec.overrides ?? {});
    const savedLoadouts: Array<[FighterId, FighterLoadout]> = [];
    for (const [id, patch] of Object.entries(spec.loadouts ?? {}) as Array<[FighterId, Partial<FighterLoadout>]>) {
      savedLoadouts.push([id, { ...FIGHTER_LOADOUTS[id] }]);
      (FIGHTER_LOADOUTS as Record<FighterId, FighterLoadout>)[id] = { ...FIGHTER_LOADOUTS[id], ...patch };
    }
    const restore = (): void => {
      restoreParams();
      for (const [id, was] of savedLoadouts) (FIGHTER_LOADOUTS as Record<FighterId, FighterLoadout>)[id] = was;
    };
    const recorder = new FightRecorder({
      player: ctx.player,
      enemies: ctx.enemies,
      state: ctx.state,
      get fighters() { return ctx.fighters as never; },
      arena,
    } as never, { sampleEvery: spec.sampleEvery ?? 6 });
    const d0 = botDriverFor(ctx);
    try {
      arena.removeRival(1);
      d0.off();
      ctx.state.paused = true;
      game.resetForFight(spec.seed, (c) => resetDuelStage(c));
      ctx.fighters?.equip(spec.a.id);
      await ctx.fighters?.whenReady();
      ctx.state.arrivalGraceUntil = 0;
      const spawns = spec.swapSpawns ? [DUEL.spawns[1], DUEL.spawns[0]] : DUEL.spawns;
      arena.setSpawns(spawns);
      await arena.addRival(spec.b.id, spawns[1].x, spawns[1].y);
      arena.reset();
      d0.install(spec.a.brain, spec.a.level, { seed: spec.seed });
      const d1 = rivalDriverFor(ctx, 1);
      d1?.install(spec.b.brain, spec.b.level, { seed: spec.seed });
      const p0 = arena.bundle(0)!.player, p1 = arena.bundle(1)!.player;
      recorder.install();
      recorder.start({
        runId: spec.runId ?? 'adhoc',
        fight: spec.fight ?? 0,
        seed: spec.seed,
        yard: 'fighter-duel',
        fighters: [
          { slot: 0, id: spec.a.id, brain: `${spec.a.brain}:${spec.a.level}`, hp: p0.maxHp, maxHp: p0.maxHp },
          { slot: 1, id: spec.b.id, brain: `${spec.b.brain}:${spec.b.level}`, hp: p1.maxHp, maxHp: p1.maxHp },
        ],
        overrides: params.snapshot(),
        git: spec.git,
        dirty: spec.dirty,
        scenario: { maxTicks: spec.maxTicks ?? 5400, spawns, swapSpawns: spec.swapSpawns === true },
      });
      const cap = spec.maxTicks ?? 5400;
      let ticks = 0;
      while (ticks < cap && arena.bout.state !== 'won') {
        const n = Math.min(30, cap - ticks);
        game.advance(n, { render: spec.render === true });
        ticks += n;
      }
      const hp = [p0.hp, p1.hp];
      let winner: number | null;
      let reason: FightOutcome['reason'];
      if (arena.bout.state === 'won') { winner = arena.bout.winner; reason = 'ko'; }
      else {
        reason = 'timeout';
        const f0 = p0.hp / Math.max(1, p0.maxHp), f1 = p1.hp / Math.max(1, p1.maxHp);
        winner = Math.abs(f0 - f1) < 0.005 ? null : f0 > f1 ? 0 : 1;
      }
      recorder.end({ winner, reason });
      return { winner, reason, ticks: recorder.ticks, hp, jsonl: recorder.toJSONL(), totals: recorder.totals(), ms: performance.now() - t0 };
    } finally {
      recorder.uninstall();
      d0.off();
      rivalDriverFor(ctx, 1)?.off();
      arena.removeRival(1);
      restore();
    }
  }

  return { run, ready, params, fighters: FIGHTER_ORDER, knobs: (prefix) => params.list(prefix) };
}

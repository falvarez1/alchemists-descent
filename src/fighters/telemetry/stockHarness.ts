import type { Ctx } from '@/core/types';
import { FIGHTER_ORDER } from '@/content/fighters';
import type { FighterId } from '@/content/fighters';
import { botDriverFor, rivalDriverFor } from '@/arena/ai/driver';
import { defaultPersonality, isPersonality } from '@/config/aiPersonalities';
import type { PersonalityId } from '@/config/aiPersonalities';
import { clampAiLevel } from '@/config/aiTiers';
import { DEFAULT_STOCK_STAGE, STOCK_STAGES, STOCK_STAGE_ORDER, isStockStageId } from '@/config/stockStage';
import type { StockStageId } from '@/config/stockStage';
import { STOCK_ATTACKS, STOCK_ATTACK_RANGES } from '@/config/stockAttacks';
import { STOCK_RULES } from '@/config/stockRules';
import { STOCK_BALANCE, STOCK_BALANCE_RANGES } from '@/config/stockBalance';
import type { StockBalance } from '@/config/stockBalance';
import { FIGHTER_BODIES } from '@/content/fighterBodies';
import { BODY_RANGES } from '@/core/fighterBody';
import type { BodyField } from '@/core/fighterBody';
import { getParamOverride } from '@/fighters/paramOverride';
import type { ParamValue } from '@/fighters/paramOverride';
import { resetDuelStage } from '@/world/duelStage';
import { PLAYER_H } from '@/core/types';

/**
 * THE DUEL HARNESS (docs/arena/STOCK-TELEMETRY.md), dev builds only: one call stages a real stock match (the Duel) between
 * two computer fighters, runs it headless in the paused-step regime to its end, and hands back what happened. It is the
 * stock-match sibling of `fightHarness` (the health duel): `scripts/duel-batch.mjs` calls it for every pairing, and
 * `scripts/duel-analyse.mjs` turns the records into the balance report.
 *
 *   await __duel.run({ a: { id: 'ilyra-voss' }, b: { id: 'brann-rook' }, seed: 11 })
 *   await __duel.run({ a: { id: 'mara-quell', level: 5 }, b: { id: 'kest-rel', level: 5 }, seed: 3, stage: 'kiln',
 *                      overrides: { 'stock.mara-quell.finisher.damage': 36 } })
 *
 * A fight: apply the overrides, re-stamp the stage, equip slot 0, add the rival, give each a seeded brain, step to the
 * end (or the cap), restore everything. Nothing carries to the next fight. The match is the shipped one (3 stocks, 6
 * minutes) on the chosen stage. The first call opens the Duel through `ctx.versus` (the lobby's own path) if no stock
 * match is loaded yet.
 *
 * Parameter roots (the registry's `addRoot`): `stockBalance.<fighter>.dealt|launch` (the Duel's balance levers),
 * `stock.<fighter>.<kind>.<field>` (each fighter's blows: frame data,
 * damage, reach, knock, growth, stun) and `body.<fighter>.<attribute>` (mass, speed, jump, `dealt`...), on top of the
 * kit roots the registry already has.
 */

export interface DuelSide {
  id: FighterId;
  /** CPU level 1..5 (default 3, Normal). */
  level?: number;
  /** Default: the fighter's own personality (the Duel lobby's choice). Pass the same one to both sides to compare kits. */
  personality?: PersonalityId;
}

export interface DuelSpec {
  /** Slot 0 (left spawn) and slot 1 (right spawn). Run a pair both ways round to cancel the side. */
  a: DuelSide;
  b: DuelSide;
  seed: number;
  stage?: StockStageId;
  /** Tick cap including the countdown (default: the match clock plus the countdown and a margin). */
  maxTicks?: number;
  overrides?: Record<string, ParamValue>;
  /** Slot 0 spawns on the right. */
  swapSpawns?: boolean;
  /** Keep a position sample every N ticks (0, the default: none). */
  traceEvery?: number;
  /** With a trace: also note what each brain was doing at each sample (its mode and the rule that fired). */
  traceStatus?: boolean;
  render?: boolean;
}

export interface DuelKo {
  t: number;
  slot: number;
  /** The slot credited (the victim's own slot: a self-destruct, no recent blow). */
  by: number;
  /** Which blast line: left / right / top / bottom. */
  edge: 'left' | 'right' | 'top' | 'bottom';
  percent: number;
  /** The last blow that hit the victim before it went out (attack tag), or null. */
  last: string | null;
}

export interface DuelSideResult {
  id: FighterId;
  level: number;
  personality: PersonalityId;
  stocks: number;
  /** Percent dealt to the opponent, by attack group (melee, throw, spell, ability, world). */
  dealt: Record<string, number>;
  dealtTotal: number;
  taken: number;
  /** Stocks this side took (KOs credited to it) and lost to itself. */
  kos: number;
  selfKos: number;
  /** Landed hits by tag, and blows started by kind (whiff rate = 1 - landed melee / started). */
  hits: Record<string, number>;
  starts: Record<string, number>;
  shields: number;
  shieldTicks: number;
  shieldBreaks: number;
  dodges: number;
  grabs: number;
  specials: number;
  ultimates: number;
  airTicks: number;
  stunTicks: number;
  /** What the brain counted (tactics modes, strikes, punishes, edgeguards...) and its status counters. */
  tactics: Record<string, number>;
  stats: Record<string, number>;
}

export interface DuelResult {
  v: 1;
  spec: DuelSpec;
  stage: StockStageId;
  winner: number | null;
  reason: 'stocks' | 'timeout' | 'draw' | 'cap';
  /** Ticks of fighting (after the countdown). */
  ticks: number;
  sides: [DuelSideResult, DuelSideResult];
  kos: DuelKo[];
  /** Behaviour sanity: crossings of the two bodies on one surface, the share of time each spends in the air, spacing. */
  behaviour: { crossingsPerMin: number; meanDist: number; closeShare: number; airShare: [number, number]; neutralShare: number };
  overrides: Record<string, ParamValue>;
  trace?: Array<[number, number, number, number, number]>;
  notes?: string[];
  ms: number;
}

/** What the harness needs of the game (the `Game` class satisfies it). */
export interface DuelGame {
  ctx: Ctx;
  advance(ticks: number, options?: { render?: boolean }): void;
  resetForFight(seed: number, rebuild?: (ctx: Ctx) => void): void;
}

export interface DuelTools {
  run(spec: DuelSpec): Promise<DuelResult>;
  ready(): Promise<void>;
  fighters: readonly FighterId[];
  stages: readonly StockStageId[];
  params: ReturnType<typeof getParamOverride>;
  knobs(prefix?: string): ReturnType<ReturnType<typeof getParamOverride>['list']>;
}

let rootsRegistered = false;

const group = (tag: string): string => tag.startsWith('melee.') ? 'melee' : tag.startsWith('throw.') ? 'throw' : tag.startsWith('ability') ? 'ability' : tag === 'world' ? 'world' : 'spell';

export function installDuelTools(game: DuelGame): DuelTools {
  const params = getParamOverride();
  const ready = async (): Promise<void> => {
    await params.ready();
    if (rootsRegistered) return;
    rootsRegistered = true;
    params.addRoot('stockBalance', STOCK_BALANCE, {
      range: (path) => STOCK_BALANCE_RANGES[path.slice(path.lastIndexOf('.') + 1) as keyof StockBalance] ?? null,
    });
    params.addRoot('stock', STOCK_ATTACKS, {
      range: (path) => STOCK_ATTACK_RANGES[path.slice(path.lastIndexOf('.') + 1) as keyof typeof STOCK_ATTACK_RANGES] ?? null,
    });
    // (the health-duel harness registers the same body root: register it once, before any override can be in force)
    if (params.list('body.').length === 0) params.addRoot('body', FIGHTER_BODIES, {
      range: (path) => { const r = BODY_RANGES[path.slice(path.lastIndexOf('.') + 1) as BodyField]; return r ? { min: r.min, max: r.max, step: 0.01 } : null; },
    });
  };

  /** Open the Duel through the lobby's own path once, so the stock level, its stage and the second slot exist. */
  async function ensureDuel(spec: DuelSpec, stage: StockStageId): Promise<void> {
    const ctx = game.ctx, v = ctx.versus;
    if (ctx.arena?.stockMatch && ctx.levels?.current?.def.id === 'fighter-duel' && v?.phase === 'playing') return;
    if (!v) throw new Error('duel harness: no versus session on this ctx');
    if (v.phase === 'idle') v.open();
    v.chooseDevice(0, 'cpu'); v.chooseDevice(1, 'cpu');
    v.chooseFighter(0, spec.a.id); v.chooseFighter(1, spec.b.id);
    v.chooseStage(stage);
    const started = v.start();
    v.skipIntro();
    if (!(await started)) throw new Error(`duel harness: the Duel did not open (${v.message || v.phase})`);
  }

  async function run(spec: DuelSpec): Promise<DuelResult> {
    const t0 = performance.now();
    await ready();
    const stageId: StockStageId = spec.stage && isStockStageId(spec.stage) ? spec.stage : DEFAULT_STOCK_STAGE;
    const levels = [clampAiLevel(spec.a.level ?? 3), clampAiLevel(spec.b.level ?? 3)];
    const personalities: PersonalityId[] = [spec.a, spec.b].map(s => isPersonality(s.personality) ? s.personality : defaultPersonality(s.id));
    await ensureDuel(spec, stageId);
    const ctx = game.ctx, arena = ctx.arena!;
    const stage = STOCK_STAGES[stageId];
    const restore = params.apply(spec.overrides ?? {});
    const offs: Array<() => void> = [];
    const d0 = botDriverFor(ctx);
    try {
      d0.off(); rivalDriverFor(ctx, 1)?.off();
      arena.removeRival(1);
      ctx.state.paused = true;
      arena.selectStockStage?.(stageId);
      arena.configureStocks(stage.zone);
      game.resetForFight(spec.seed, (c) => resetDuelStage(c));
      ctx.fighters?.equip(spec.a.id);
      await ctx.fighters?.whenReady();
      ctx.state.arrivalGraceUntil = 0;
      const spawns = spec.swapSpawns ? [stage.spawns[1], stage.spawns[0]] : [...stage.spawns];
      arena.setSpawns(spawns);
      if (await arena.addRival(spec.b.id, spawns[1].x, spawns[1].y) < 0) throw new Error('duel harness: the rival could not join');
      arena.reset();
      d0.install('basic', levels[0], { seed: spec.seed, personality: personalities[0] });
      rivalDriverFor(ctx, 1)?.install('basic', levels[1], { seed: spec.seed, personality: personalities[1] });

      // ---- what is recorded ----
      const blank = (i: number): DuelSideResult => ({
        id: i === 0 ? spec.a.id : spec.b.id, level: levels[i], personality: personalities[i], stocks: 0, dealt: {}, dealtTotal: 0, taken: 0,
        kos: 0, selfKos: 0, hits: {}, starts: {}, shields: 0, shieldTicks: 0, shieldBreaks: 0, dodges: 0, grabs: 0, specials: 0, ultimates: 0,
        airTicks: 0, stunTicks: 0, tactics: {}, stats: {},
      });
      const sides: [DuelSideResult, DuelSideResult] = [blank(0), blank(1)];
      const kos: DuelKo[] = [];
      const lastBlow: Array<string | null> = [null, null];
      let fighting = 0, crossings = 0, lastSide = 0, distSum = 0, distN = 0, close = 0, neutral = 0;
      offs.push(ctx.events.on('fighterHit', (h) => {
        if (h.victim !== 0 && h.victim !== 1) return;
        const tag = h.attack ?? 'world';
        if (tag !== 'world') lastBlow[h.victim] = tag;
        sides[h.victim].taken += h.damage;
        if (h.by === h.victim) return;
        const side = sides[h.by];
        if (!side) return;
        side.dealt[group(tag)] = (side.dealt[group(tag)] ?? 0) + h.damage;
        side.dealtTotal += h.damage;
        side.hits[tag] = (side.hits[tag] ?? 0) + 1;
      }));
      offs.push(ctx.events.on('fighterDown', (d) => {
        const z = stage.zone, f = arena.stockMatch?.fighters[d.slot];
        const edge = d.x < z.left ? 'left' : d.x > z.right ? 'right' : d.y < z.top ? 'top' : 'bottom';
        kos.push({ t: fighting, slot: d.slot, by: d.by, edge, percent: Math.round(f?.volatility ?? 0), last: lastBlow[d.slot] });
        if (d.by === d.slot) sides[d.slot].selfKos++; else if (sides[d.by]) sides[d.by].kos++;
        lastBlow[d.slot] = null;
      }));
      offs.push(ctx.events.on('stockShieldBreak', ({ slot }) => { if (sides[slot]) sides[slot].shieldBreaks++; }));
      offs.push(ctx.events.on('stockUltimate', ({ slot }) => { if (sides[slot]) sides[slot].ultimates++; }));

      const prev = [0, 1].map(() => ({ attack: 0, shield: false, dodge: false, grab: false, charges: 0 }));
      const trace: Array<[number, number, number, number, number]> = [];
      const notes: string[] = [];
      const cap = spec.maxTicks ?? STOCK_RULES.timeTicks + STOCK_RULES.countdownTicks + 600;
      let ticks = 0;
      const match = () => arena.stockMatch;
      for (const s of [0, 1]) prev[s].charges = arena.stockSpecial(s)?.charges ?? 0;
      while (ticks < cap && match()?.state !== 'finished') {
        game.advance(1, { render: spec.render === true });
        ticks++;
        const m = match();
        if (!m || m.state !== 'fighting') continue;
        fighting++;
        const p = [arena.bundle(0)!.player, arena.bundle(1)!.player];
        for (const s of [0, 1]) {
          const side = sides[s], was = prev[s], body = p[s];
          const attack = arena.stockAttack(s), shield = arena.stockShield(s), dodge = arena.stockDodge(s), grab = arena.stockGrab(s), special = arena.stockSpecial(s);
          if (attack?.busy && attack.id !== was.attack && attack.kind) { side.starts[attack.kind] = (side.starts[attack.kind] ?? 0) + 1; was.attack = attack.id; }
          const guarding = shield?.guarding === true;
          if (guarding && !was.shield) side.shields++;
          if (guarding) side.shieldTicks++;
          was.shield = guarding;
          const dodging = dodge?.busy === true;
          if (dodging && !was.dodge) side.dodges++;
          was.dodge = dodging;
          const reaching = grab?.phase === 'startup';
          if (reaching && !was.grab) side.grabs++;
          was.grab = reaching;
          const charges = special?.charges ?? 0;
          if (charges < was.charges) side.specials += was.charges - charges;
          was.charges = charges;
          if (!body.dead && !body.grounded) { if (body.stunT > 0) side.stunTicks++; else side.airTicks++; }
        }
        if (!p[0].dead && !p[1].dead) {
          const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
          distSum += d; distN++;
          if (d < 40) close++;
          if (d >= 40 && d < 90) neutral++;
          // A crossing that counts: both standing on one surface, one walking through the other.
          const sameSurface = p[0].grounded && p[1].grounded && Math.abs(p[0].y - p[1].y) < 8;
          const side = Math.sign(p[1].x - p[0].x);
          if (side !== 0) {
            if (sameSurface && lastSide !== 0 && side !== lastSide) crossings++;
            lastSide = side;
          }
        } else lastSide = 0;
        if (spec.traceEvery && spec.traceStatus && fighting % spec.traceEvery === 0) {
          const brains = [d0.brain, rivalDriverFor(ctx, 1)?.brain ?? null];
          notes.push(brains.map((b, s) => {
            if (!b) return '-';
            const k = arena.bundle(s)!.input.keys, st = b.status;
            const keys = `${k.left ? 'L' : ''}${k.right ? 'R' : ''}${k.jump ? 'J' : ''}${k.up ? 'U' : ''}${k.down ? 'D' : ''}`;
            return `${st.intent}:${st.rule}:${st.goalX === null ? '-' : Math.round(st.goalX)}:${st.action ?? ''} keys[${keys}] hz${st.stats.hazardWaits ?? 0}/${st.stats.hazardStops ?? 0} stuck${st.stats.stuck ?? 0}`;
          }).join(' | '));
        }
        if (spec.traceEvery && fighting % spec.traceEvery === 0) trace.push([fighting, Math.round(p[0].x), Math.round(p[0].y - PLAYER_H / 2), Math.round(p[1].x), Math.round(p[1].y - PLAYER_H / 2)]);
      }
      const m = match();
      const reason: DuelResult['reason'] = m?.state === 'finished' ? (m.reason ?? 'draw') : 'cap';
      let winner = m?.state === 'finished' ? m.winner : null;
      if (reason === 'cap' && m) {
        const [f0, f1] = m.fighters;
        winner = f0.stocks !== f1.stocks ? (f0.stocks > f1.stocks ? 0 : 1) : f0.volatility !== f1.volatility ? (f0.volatility < f1.volatility ? 0 : 1) : null;
      }
      for (const s of [0, 1]) {
        sides[s].stocks = m?.fighters[s]?.stocks ?? 0;
        sides[s].dealtTotal = Math.round(sides[s].dealtTotal * 10) / 10;
        sides[s].taken = Math.round(sides[s].taken * 10) / 10;
        for (const k of Object.keys(sides[s].dealt)) sides[s].dealt[k] = Math.round(sides[s].dealt[k] * 10) / 10;
      }
      const bots = [d0.brain, rivalDriverFor(ctx, 1)?.brain ?? null];
      for (const s of [0, 1]) {
        const status = bots[s]?.status;
        sides[s].stats = status ? { ...status.stats } : {};
        sides[s].tactics = status?.tactics ? { ...status.tactics } : {};
      }
      const minutes = Math.max(1, fighting) / 3600;
      return {
        v: 1, spec, stage: stageId, winner, reason, ticks: fighting, sides, kos,
        behaviour: {
          crossingsPerMin: Math.round(crossings / minutes * 10) / 10,
          meanDist: Math.round(distSum / Math.max(1, distN)),
          closeShare: Math.round(close / Math.max(1, distN) * 100) / 100,
          neutralShare: Math.round(neutral / Math.max(1, distN) * 100) / 100,
          airShare: [0, 1].map(s => Math.round(sides[s].airTicks / Math.max(1, fighting) * 100) / 100) as [number, number],
        },
        overrides: params.snapshot(),
        ...(spec.traceEvery ? { trace } : {}),
        ...(spec.traceStatus ? { notes } : {}),
        ms: Math.round(performance.now() - t0),
      };
    } finally {
      for (const off of offs) off();
      d0.off();
      rivalDriverFor(ctx, 1)?.off();
      restore();
    }
  }

  return { run, ready, fighters: FIGHTER_ORDER, stages: STOCK_STAGE_ORDER, params, knobs: (prefix) => params.list(prefix) };
}

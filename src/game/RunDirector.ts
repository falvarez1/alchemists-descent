import type {
  Ctx,
  RunApi,
  RunBeginOptions,
  RunMetaView,
  RunResult,
  RunSaveState,
  RunStartResult,
} from '@/core/types';
import type { AlchemyKillInfo, KitId, RunOutcome } from '@/core/run';
import { randomSeed } from '@/core/rng';
import { FLOORS_TOTAL, floorDisplayName, floorOf } from '@/config/worldgraph';
import { DEFAULT_KIT, KIT_DEFS, isKitId } from '@/content/kits';
import {
  MetaProfileStore,
  recordFloorReached,
  recordLeviathanSlain,
  recordRunEnded,
  recordRunStarted,
} from '@/game/MetaProfile';
import {
  PHIALS_PER_RUN,
  buildRunSummary,
  clampPhials,
  dailySeed,
  isDateKey,
  restorePhial,
  spendPhial,
  utcDateKey,
} from '@/game/runRules';
import { deathCauseLine } from '@/ui/deathCauses';

/** One 60 Hz tick of wall time, the most a single tick may add to the clock. */
const TICK_MS = 1000 / 60;
/** A gap longer than this between ticks was a pause, a hidden tab or a hitch. */
const MAX_TICK_GAP_MS = 250;
/** The refuge's warmth re-arms once the alchemist has walked this far away. */
const REFUGE_REARM_DISTANCE = 160;
/** LivingExpedition's rest completes at this many still, unthreatened ticks. */
const REFUGE_REST_TICKS = 120;

function freshState(opts: RunBeginOptions, recorded: boolean): RunSaveState {
  return {
    v: 1,
    phials: PHIALS_PER_RUN,
    kit: opts.kit,
    daily: opts.daily,
    seed: opts.seed >>> 0,
    timeMs: 0,
    kills: 0,
    alchemicalKills: 0,
    bestChain: 0,
    deaths: 0,
    cardsFound: 0,
    maxFloor: 0,
    leviathanSlain: false,
    recorded,
  };
}

function sanitizeSave(save: RunSaveState): RunSaveState | null {
  if (!save || typeof save !== 'object' || save.v !== 1) return null;
  const whole = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  return {
    v: 1,
    phials: clampPhials(typeof save.phials === 'number' ? save.phials : PHIALS_PER_RUN),
    kit: isKitId(save.kit) ? save.kit : DEFAULT_KIT,
    daily: isDateKey(save.daily) ? save.daily : null,
    seed: whole(save.seed) >>> 0,
    timeMs: whole(save.timeMs),
    kills: whole(save.kills),
    alchemicalKills: whole(save.alchemicalKills),
    bestChain: whole(save.bestChain),
    deaths: whole(save.deaths),
    cardsFound: whole(save.cardsFound),
    maxFloor: Math.min(FLOORS_TOTAL, whole(save.maxFloor)),
    leviathanSlain: save.leviathanSlain === true,
    recorded: save.recorded !== false,
  };
}

/**
 * The run lifecycle (Breathing Works): one run is up to four floors and three
 * return phials. RunDirector owns the run's state and its ledger — play time
 * without pauses, kills, alchemical kills and the best chain, deaths, cards
 * found, the deepest floor — and ends the run on the Colossus, on a death with
 * no phial left, or when the player abandons it. Ending writes the meta
 * profile, retires the expedition save and emits `runEnded` with the
 * RunSummary; the ledger screen, audio and clips listen.
 *
 * It never touches the DOM. Levels calls in when a run begins or resumes and
 * for its save slice; the Sanctum and the D1 refuge pour phials back.
 */
export class RunDirector implements RunApi {
  private readonly meta = new MetaProfileStore();
  private state: RunSaveState | null = null;
  private tracked = false;
  private finished = false;
  private result: RunResult | null = null;
  /** Kits unlocked mid-run (floor reached, Leviathan), for the ledger. */
  private runUnlocks: KitId[] = [];
  /** A creature died since the last tick (the Leviathan watch reads it). */
  private killedSinceTick = false;
  private lastTickWall = 0;
  private lastGold = 0;
  private lastCause: string | null = null;
  private refugeArmed = true;
  private restWasComplete = false;
  private leviathanPresent = false;
  private leviathanLevel: string | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly ctx: Ctx) {
    const on = ctx.events.on.bind(ctx.events);
    this.disposers.push(
      on('playerDied', ({ cause }) => this.onPlayerDied(cause)),
      on('runComplete', () => { if (this.active) this.endRun(this.ctx, 'victory', true); }),
      on('enemyKilled', () => this.onEnemyKilled()),
      on('alchemyKill', (info) => this.onAlchemyKill(info)),
      on('cardGranted', () => { if (this.active && this.state) this.state.cardsFound++; }),
      on('levelChanged', () => this.onLevelChanged()),
    );
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  get active(): boolean {
    return this.tracked && this.state !== null && !this.finished;
  }

  get over(): boolean {
    return this.finished;
  }

  get phials(): number {
    return this.state?.phials ?? 0;
  }

  get maxPhials(): number {
    return PHIALS_PER_RUN;
  }

  get kit(): KitId {
    return this.state?.kit ?? this.meta.profile.lastKit;
  }

  get daily(): string | null {
    return this.state?.daily ?? null;
  }

  get lastResult(): RunResult | null {
    return this.result;
  }

  /* ---------------- lifecycle ---------------- */

  beginRun(ctx: Ctx, opts: RunBeginOptions): void {
    // A run replaced by a new one still counts: record it, show nothing.
    if (this.active) this.endRun(ctx, 'abandoned', false);
    this.finished = false;
    this.result = null;
    this.runUnlocks = [];
    this.resetTracking(ctx);
    this.tracked = opts.tracked;
    if (!opts.tracked) {
      this.state = null;
      return;
    }
    const recorded = !this.tainted(ctx);
    this.state = freshState(opts, recorded);
    if (recorded) this.meta.commit(recordRunStarted(this.meta.profile, opts.kit));
    ctx.events.emit('phialsChanged', { phials: this.state.phials, max: PHIALS_PER_RUN, reason: 'start' });
  }

  snapshotForSave(): RunSaveState | null {
    if (!this.active || !this.state) return null;
    return { ...this.state };
  }

  restoreFromSave(ctx: Ctx, save: RunSaveState | undefined): void {
    const restored = save ? sanitizeSave(save) : null;
    this.finished = false;
    this.result = null;
    this.runUnlocks = [];
    this.resetTracking(ctx);
    this.tracked = true;
    // A save from before runs existed resumes as a fresh spark run with full phials.
    this.state = restored ?? freshState({
      seed: ctx.levels.runStatus(ctx).worldSeed,
      kit: DEFAULT_KIT,
      daily: null,
      tracked: true,
    }, !this.tainted(ctx));
    ctx.events.emit('phialsChanged', { phials: this.state.phials, max: PHIALS_PER_RUN, reason: 'restore' });
  }

  abandon(ctx: Ctx): void {
    if (!this.active) return;
    this.endRun(ctx, 'abandoned', true);
  }

  startNewRun(ctx: Ctx, opts: { kit: KitId; daily: boolean }): RunStartResult {
    const today = utcDateKey(new Date());
    const kit = opts.daily ? DEFAULT_KIT : (this.meta.isKitUnlocked(opts.kit) ? opts.kit : DEFAULT_KIT);
    if (!opts.daily) this.meta.setLastKit(kit);
    return ctx.levels.startRun(ctx, {
      mode: 'normal',
      worldSource: 'campaign',
      continueSave: false,
      loadout: 'fresh',
      seed: opts.daily ? dailySeed(today) : randomSeed(),
      starterKit: kit,
      daily: opts.daily ? today : null,
    });
  }

  chooseKit(kit: KitId): void {
    this.meta.setLastKit(kit);
  }

  metaView(): RunMetaView {
    const profile = this.meta.profile;
    const today = utcDateKey(new Date());
    return {
      unlockedKits: [...profile.unlockedKits],
      lastKit: profile.lastKit,
      workshopUnlocked: profile.workshopUnlocked,
      runsEnded: profile.runsEnded,
      bestFloor: profile.bestFloor,
      victories: profile.victories,
      today,
      todayBest: profile.dailyBests[today] ?? null,
    };
  }

  /* ---------------- phials ---------------- */

  restorePhial(ctx: Ctx, reason: 'refuge' | 'sanctum'): boolean {
    if (!this.active || !this.state) return false;
    const next = restorePhial(this.state.phials);
    if (!next.restored) return false;
    this.state.phials = next.phials;
    ctx.events.emit('phialsChanged', { phials: next.phials, max: PHIALS_PER_RUN, reason });
    if (reason === 'refuge') {
      ctx.events.emit('toast', { text: `The refuge's warmth fills a return phial. ${next.phials} of ${PHIALS_PER_RUN}.` });
    }
    return true;
  }

  private onPlayerDied(cause: string): void {
    const ctx = this.ctx;
    if (!this.active || !this.state) return;
    // A Builder/Sandbox playtest in the middle of a run is not the run.
    if (ctx.state.playtestSource !== null && ctx.state.playtestSource !== undefined) return;
    this.state.deaths++;
    this.lastCause = cause;
    const spent = spendPhial(this.state.phials);
    if (spent.final) {
      this.endRun(ctx, 'fallen', true);
      return;
    }
    this.state.phials = spent.phials;
    ctx.events.emit('phialsChanged', { phials: spent.phials, max: PHIALS_PER_RUN, reason: 'death' });
    // Player.kill wrote the death checkpoint before this handler ran; write it
    // again so the save carries the phial this death just spent.
    ctx.levels.saveDeathCheckpoint(ctx);
  }

  /* ---------------- the tick ---------------- */

  update(ctx: Ctx): void {
    const state = this.state;
    if (!this.active || !state) return;
    if (ctx.state.mode !== 'play' || (ctx.state.playtestSource !== null && ctx.state.playtestSource !== undefined)) {
      this.lastTickWall = 0;
      return;
    }
    if (state.recorded && this.tainted(ctx)) state.recorded = false;

    // Play time on the wall clock, tick by tick: slow motion still counts as
    // the seconds it takes, a pause or a hidden tab (no ticks) does not.
    const now = performance.now();
    if (!ctx.player.dead && !ctx.levels.transitioning) {
      const gap = this.lastTickWall > 0 ? now - this.lastTickWall : TICK_MS;
      state.timeMs += gap > MAX_TICK_GAP_MS ? TICK_MS : gap;
    }
    this.lastTickWall = now;
    this.lastGold = ctx.state.score;

    const killed = this.killedSinceTick;
    this.killedSinceTick = false;

    const runtime = ctx.levels.current;
    this.watchLeviathan(ctx, runtime?.def.id ?? null, runtime?.def.boss === 'leviathan', killed);
    this.watchRefuge(ctx);
  }

  private watchLeviathan(ctx: Ctx, levelId: string | null, bossFloor: boolean, killed: boolean): void {
    const present = bossFloor && ctx.enemies.some((e) => e.kind === 'leviathan');
    const sameFloor = levelId !== null && levelId === this.leviathanLevel;
    if (bossFloor && sameFloor && this.leviathanPresent && !present && killed && !ctx.levels.transitioning) {
      this.onLeviathanSlain(ctx);
    }
    this.leviathanPresent = present;
    this.leviathanLevel = levelId;
  }

  private onLeviathanSlain(ctx: Ctx): void {
    const state = this.state;
    if (!state || state.leviathanSlain) return;
    state.leviathanSlain = true;
    if (!state.recorded) return;
    const next = recordLeviathanSlain(this.meta.profile);
    this.meta.commit(next.profile);
    this.announceUnlocks(ctx, next.unlocked);
  }

  /** The D1 refuge: a completed rest pours a phial back, once per visit. */
  private watchRefuge(ctx: Ctx): void {
    const runtime = ctx.levels.current;
    const living = runtime?.living;
    const refuge = runtime?.refuge;
    if (!living || !refuge) {
      this.restWasComplete = false;
      return;
    }
    const rested = living.restTicks >= REFUGE_REST_TICKS;
    if (rested && !this.restWasComplete && this.refugeArmed && this.restorePhial(ctx, 'refuge')) {
      this.refugeArmed = false;
      ctx.levels.saveExpedition(ctx);
    }
    this.restWasComplete = rested;
    if (Math.hypot(ctx.player.x - refuge.x, ctx.player.y - refuge.y) > REFUGE_REARM_DISTANCE) this.refugeArmed = true;
  }

  private onLevelChanged(): void {
    const ctx = this.ctx;
    const state = this.state;
    if (!this.active || !state) return;
    const floor = floorOf(ctx.levels.current?.def.id);
    if (floor <= 0 || floor <= state.maxFloor) return;
    state.maxFloor = floor;
    if (!state.recorded || this.tainted(ctx)) return;
    const next = recordFloorReached(this.meta.profile, floor);
    this.meta.commit(next.profile);
    this.announceUnlocks(ctx, next.unlocked);
  }

  /**
   * The ledger counts deaths as they happen (`enemyKilled`), not by polling a
   * counter once a tick: the Colossus's death ends the run inside the very call
   * that kills it, before any tick could see it, and a counter reset between
   * floors could hide kills from a poll.
   */
  private onEnemyKilled(): void {
    const ctx = this.ctx;
    const state = this.state;
    if (!this.active || !state) return;
    if (ctx.state.mode !== 'play' || (ctx.state.playtestSource !== null && ctx.state.playtestSource !== undefined)) return;
    state.kills++;
    this.killedSinceTick = true;
  }

  private onAlchemyKill(info: AlchemyKillInfo): void {
    const state = this.state;
    if (!this.active || !state) return;
    state.alchemicalKills++;
    state.bestChain = Math.max(state.bestChain, Math.max(1, Math.floor(info.chain)));
  }

  private announceUnlocks(ctx: Ctx, kits: readonly KitId[]): void {
    for (const kit of kits) {
      if (!this.runUnlocks.includes(kit)) this.runUnlocks.push(kit);
      ctx.events.emit('toast', { text: `A new case on the rack: ${KIT_DEFS[kit].name}. Choose it at your next descent.` });
      ctx.audio.learn();
    }
  }

  /* ---------------- the end ---------------- */

  private endRun(ctx: Ctx, outcome: RunOutcome, present: boolean): void {
    const state = this.state;
    if (!state || this.finished) return;
    const levelId = ctx.levels.current?.def.id ?? null;
    const floor = floorOf(levelId) || Math.max(1, state.maxFloor);
    const floorId = floorOf(levelId) > 0 ? levelId : `d${floor}`;
    const recorded = state.recorded && !this.tainted(ctx);
    const summary = buildRunSummary({
      outcome,
      seed: state.seed,
      daily: state.daily,
      kit: state.kit,
      floor: outcome === 'victory' ? FLOORS_TOTAL : floor,
      floorName: floorDisplayName(floorId),
      floorsTotal: FLOORS_TOTAL,
      timeMs: state.timeMs,
      kills: state.kills,
      alchemicalKills: state.alchemicalKills,
      bestChain: state.bestChain,
      deaths: state.deaths,
      gold: present ? ctx.state.score : this.lastGold,
      cardsFound: state.cardsFound,
      causeLine: outcome === 'fallen' ? deathCauseLine(this.lastCause, state.seed) : undefined,
    });
    let unlocked = [...this.runUnlocks];
    let record: Pick<RunResult, 'dailyBest' | 'newDailyBest' | 'newBestFloor'> = { dailyBest: null, newDailyBest: false, newBestFloor: false };
    if (recorded) {
      const end = recordRunEnded(this.meta.profile, summary);
      this.meta.commit(end.profile);
      unlocked = [...new Set([...unlocked, ...end.unlocked])];
      record = { dailyBest: end.dailyBest, newDailyBest: end.newDailyBest, newBestFloor: end.newBestFloor };
      for (const kit of end.unlocked) ctx.telemetry.count(`run.unlock.${kit}`);
    }
    ctx.telemetry.count(`run.ended.${outcome}`);
    this.result = { summary, unlocked, ...record, recorded, present };
    this.finished = present;
    if (!present) {
      this.state = null;
      this.tracked = false;
    }
    // The run is over: nothing is left for Continue to resume.
    ctx.levels.abandonExpedition();
    ctx.events.emit('runEnded', summary);
  }

  private resetTracking(ctx: Ctx): void {
    this.killedSinceTick = false;
    this.lastTickWall = 0;
    this.lastGold = ctx.state.score;
    this.lastCause = null;
    this.refugeArmed = true;
    this.restWasComplete = false;
    this.leviathanPresent = false;
    this.leviathanLevel = null;
  }

  private tainted(ctx: Ctx): boolean {
    return ctx.state.debugGodMode === true || ctx.state.debugTainted === true;
  }
}

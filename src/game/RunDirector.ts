import type {
  Ctx,
  RunApi,
  RunBeginOptions,
  RunMetaView,
  RunResult,
  RunSaveState,
  RunStartResult,
  Difficulty,
} from '@/core/types';
import type { AlchemyKillInfo, KitId, RunOutcome } from '@/core/run';
import { randomSeed } from '@/core/rng';
import { isRunTainted } from '@/core/runTaint';
import { FLOORS_TOTAL, doorTaken, floorDisplayName, floorOf } from '@/config/worldgraph';
import { DEFAULT_KIT, KIT_DEFS, isKitId } from '@/content/kits';
import {
  MetaProfileStore,
  recordFloorReached,
  recordLevelSeen,
  recordLeviathanSlain,
  recordRunEnded,
  recordRunStarted,
} from '@/game/MetaProfile';
import {
  PHIALS_PER_RUN,
  buildRunSummary,
  clampPhials,
  cleanRunBoons,
  cleanRunPath,
  dailySeed,
  isDateKey,
  restorePhial,
  spendPhial,
  utcDateKey,
} from '@/game/runRules';
import { deathLineFor } from '@/ui/deathCauses';
import { asDifficulty, difficultyMods } from '@/config/difficulty';
import { BASE_DIFFICULTY, openDifficulty } from '@/config/difficultyLadder';
import { canBargain, cleanMutators, dailyMutators, rescaleHealth, type Bargain } from '@/content/mutators';

/** One 60 Hz tick of wall time, the most a single tick may add to the clock. */
const TICK_MS = 1000 / 60;
/** A gap longer than this between ticks was a pause, a hidden tab or a hitch. */
const MAX_TICK_GAP_MS = 250;
/** The refuge's warmth re-arms once the alchemist has walked this far away. */
const REFUGE_REARM_DISTANCE = 160;
/** LivingExpedition's rest completes at this many still, unthreatened ticks. */
const REFUGE_REST_TICKS = 120;

function freshState(opts: RunBeginOptions, recorded: boolean, seedChosen = false): RunSaveState {
  return {
    v: 1,
    phials: PHIALS_PER_RUN,
    kit: opts.kit,
    daily: opts.daily,
    seed: opts.seed >>> 0,
    ...(seedChosen && !opts.daily ? { seedChosen: true } : {}),
    ...(runMutators(opts.daily, opts.mutators).length > 0 ? { mutators: runMutators(opts.daily, opts.mutators) } : {}),
    timeMs: 0,
    kills: 0,
    alchemicalKills: 0,
    bestChain: 0,
    deaths: 0,
    cardsFound: 0,
    maxFloor: 0,
    leviathanSlain: false,
    recorded,
    path: [],
    boons: [],
  };
}

/**
 * The complications a run carries: today's daily takes the ones its DATE names (the player's own
 * choice never applies to it, like the kit and the tier); any other run takes its cleaned choice.
 */
function runMutators(daily: string | null | undefined, chosen: readonly unknown[] | null | undefined): string[] {
  return isDateKey(daily) ? dailyMutators(daily) : cleanMutators(chosen);
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
    ...(save.seedChosen === true && !isDateKey(save.daily) ? { seedChosen: true } : {}),
    ...(runMutators(save.daily, save.mutators).length > 0 ? { mutators: runMutators(save.daily, save.mutators) } : {}),
    ...(cleanBargains(save.daily, save.bargains).length > 0 ? { bargains: cleanBargains(save.daily, save.bargains) } : {}),
    timeMs: whole(save.timeMs),
    kills: whole(save.kills),
    alchemicalKills: whole(save.alchemicalKills),
    bestChain: whole(save.bestChain),
    deaths: whole(save.deaths),
    cardsFound: whole(save.cardsFound),
    maxFloor: Math.min(FLOORS_TOTAL, whole(save.maxFloor)),
    leviathanSlain: save.leviathanSlain === true,
    recorded: save.recorded !== false,
    path: cleanRunPath(Array.isArray(save.path) ? save.path : []),
    boons: cleanRunBoons(Array.isArray(save.boons) ? save.boons : []),
  };
}

const NO_MUTATORS: readonly string[] = Object.freeze([]);
const NO_BARGAINS: ReadonlyArray<Bargain> = Object.freeze([]);

/** The bargains a save carries: one per floor at most, a floor that exists, a complication that exists, and none on the daily (it is the date's). */
function cleanBargains(daily: string | null | undefined, raw: unknown): Bargain[] {
  if (isDateKey(daily) || !Array.isArray(raw)) return [];
  const out: Bargain[] = [];
  for (const entry of raw) {
    const floor = (entry as Bargain | null)?.floor;
    const id = (entry as Bargain | null)?.id;
    if (typeof floor !== 'number' || !Number.isInteger(floor) || floor < 1 || floor > FLOORS_TOTAL || typeof id !== 'string') continue;
    if (cleanMutators([id]).length === 0 || out.some((b) => b.floor === floor)) continue;
    out.push({ floor, id });
  }
  return out;
}

/** The floor-3 wardens: either one slain is the ember kit's milestone. */
const FLOOR3_WARDENS = new Set<string>(['leviathan', 'lenswright']);

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
  /** startNewRun is about to begin a run on a seed the player chose; beginRun (called from inside startRun) consumes it. */
  private chosenSeedPending = false;
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

  get mutators(): readonly string[] {
    return this.state?.mutators ?? NO_MUTATORS;
  }

  get bargains(): ReadonlyArray<{ floor: number; id: string }> {
    return this.state?.bargains ?? NO_BARGAINS;
  }

  get deaths(): number {
    return this.state?.deaths ?? 0;
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
    const seedChosen = this.chosenSeedPending;
    this.chosenSeedPending = false;
    if (!opts.tracked) {
      this.state = null;
      ctx.mutators?.deactivate(ctx);
      return;
    }
    const recorded = !this.tainted(ctx);
    this.state = freshState(opts, recorded, seedChosen);
    // The run's complications are in force from its first tick (and again here, after a replaced
    // run's end deactivated them: this state is the authority).
    ctx.mutators?.activate(ctx, this.state.mutators ?? []);
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
    ctx.mutators?.activate(ctx, this.state.mutators ?? []);
    ctx.events.emit('phialsChanged', { phials: this.state.phials, max: PHIALS_PER_RUN, reason: 'restore' });
  }

  abandon(ctx: Ctx): void {
    if (!this.active) return;
    this.endRun(ctx, 'abandoned', true);
  }

  startNewRun(ctx: Ctx, opts: { kit: KitId; daily: boolean; difficulty?: Difficulty; seed?: number; mutators?: readonly string[] }): RunStartResult {
    const today = utcDateKey(new Date());
    const kit = opts.daily ? DEFAULT_KIT : (this.meta.isKitUnlocked(opts.kit) ? opts.kit : DEFAULT_KIT);
    if (!opts.daily) this.meta.setLastKit(kit);
    // The tier asked for, if it is open to this player; Adept otherwise. Today's descent is one
    // seed for everyone, so it is always Adept (and does not move the remembered choice).
    const profile = this.meta.profile;
    const difficulty = opts.daily ? BASE_DIFFICULTY : openDifficulty(opts.difficulty ?? profile.lastDifficulty, profile.bestVictoryDifficulty);
    if (!opts.daily) this.meta.setLastDifficulty(difficulty);
    // A chosen seed only ever rides a normal descent: today's is one seed for everyone.
    const chosen = !opts.daily && typeof opts.seed === 'number' && Number.isFinite(opts.seed) && opts.seed > 0 ? opts.seed >>> 0 : null;
    this.chosenSeedPending = chosen !== null;
    // Today's complications are the date's; an ordinary descent takes the player's (and remembers them).
    const mutators = runMutators(opts.daily ? today : null, opts.mutators);
    if (!opts.daily) this.meta.setLastMutators(mutators);
    try {
      return ctx.levels.startRun(ctx, {
        mode: 'normal',
        worldSource: 'campaign',
        continueSave: false,
        loadout: 'fresh',
        seed: opts.daily ? dailySeed(today) : chosen ?? randomSeed(),
        starterKit: kit,
        daily: opts.daily ? today : null,
        difficulty,
        mutators,
      });
    } finally {
      this.chosenSeedPending = false;
    }
  }

  chooseKit(kit: KitId): void {
    this.meta.setLastKit(kit);
  }

  chooseDifficulty(difficulty: Difficulty): void {
    this.meta.setLastDifficulty(difficulty);
  }

  chooseMutators(ids: readonly string[]): void {
    this.meta.setLastMutators(ids);
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
      bestVictoryDifficulty: profile.bestVictoryDifficulty,
      lastDifficulty: profile.lastDifficulty,
      today,
      todayBest: profile.dailyBests[today] ?? null,
      levelsSeen: [...profile.levelsSeen],
      lastMutators: [...profile.lastMutators],
      todayMutators: dailyMutators(today),
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

  debugSetPhials(ctx: Ctx, phials: number): boolean {
    if (!this.active || !this.state) return false;
    this.state.phials = clampPhials(phials);
    ctx.events.emit('phialsChanged', { phials: this.state.phials, max: PHIALS_PER_RUN, reason: 'restore' });
    return true;
  }

  debugSetKit(kit: KitId): boolean {
    if (!this.active || !this.state || !isKitId(kit)) return false;
    this.state.kit = kit;
    return true;
  }

  strikeBargain(ctx: Ctx, id: string, floor: number): boolean {
    const state = this.state;
    if (!this.active || !state || state.daily || !Number.isInteger(floor) || floor < 1) return false;
    if ((state.bargains ?? []).some((b) => b.floor === floor) || !canBargain(state.mutators, id)) return false;
    const hpBefore = difficultyMods(ctx.state).playerHp;
    const next = cleanMutators([...(state.mutators ?? []), id]);
    state.mutators = next;
    state.bargains = [...(state.bargains ?? []), { floor, id }];
    ctx.mutators?.activate(ctx, next);
    // A bargain that moves the HP dial (Glass Cannon) takes the alchemist's health with it, in proportion.
    const scaled = rescaleHealth(ctx.player.hp, ctx.player.maxHp, hpBefore, difficultyMods(ctx.state).playerHp);
    ctx.player.maxHp = scaled.maxHp;
    ctx.player.hp = scaled.hp;
    ctx.telemetry.count(`bargain.${id}`);
    return true;
  }

  debugSetMutators(ctx: Ctx, ids: readonly string[]): boolean {
    if (!this.active || !this.state) return false;
    const next = cleanMutators(ids);
    if (next.length > 0) this.state.mutators = next;
    else delete this.state.mutators;
    ctx.mutators?.activate(ctx, next);
    return true;
  }

  private onPlayerDied(cause: string): void {
    const ctx = this.ctx;
    if (!this.active || !this.state) return;
    // A Builder/Sandbox playtest in the middle of a run is not the run.
    if (ctx.state.playtestSource !== null && ctx.state.playtestSource !== undefined) return;
    // The Kiln escape is generous: a fall in the climb costs no phial (the story restarts the climb).
    if (ctx.story?.escapeActive) return;
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
    const warden = runtime?.def.boss && FLOOR3_WARDENS.has(runtime.def.boss) ? runtime.def.boss : null;
    this.watchLeviathan(ctx, runtime?.def.id ?? null, warden, killed);
    this.watchRefuge(ctx);
    // The run's complications: vents and drips, heals, fireworks (game/MutatorDirector).
    ctx.mutators?.update(ctx);
  }

  /** A floor-3 warden (the Leviathan, or the Lenswright behind the Galleries' door) died on its floor. */
  private watchLeviathan(ctx: Ctx, levelId: string | null, warden: string | null, killed: boolean): void {
    const bossFloor = warden !== null;
    const present = bossFloor && ctx.enemies.some((e) => e.kind === warden);
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
    const id = ctx.levels.current?.def.id;
    const floor = floorOf(id);
    if (floor <= 0 || !id) return;
    // The route: the first door taken on each floor (a return trip up a floor
    // never rewrites which door the run chose).
    const path = state.path ?? (state.path = []);
    if (!path.some((p) => floorOf(p) === floor)) path.push(id);
    this.noteBoons(state);
    const recordable = state.recorded && !this.tainted(ctx);
    if (recordable) {
      const seen = recordLevelSeen(this.meta.profile, id);
      if (seen !== this.meta.profile) this.meta.commit(seen);
    }
    if (floor <= state.maxFloor) return;
    state.maxFloor = floor;
    if (!recordable) return;
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

  /**
   * The boons struck so far, in the order taken: the Sanctum sets the flag on
   * `player.perks` and the next floor's arrival (or the end of the run) finds it
   * here. Read off the player rather than announced, so a save resumed
   * mid-run and a boon taken before this run was tracked both land in the ledger.
   */
  private noteBoons(state: RunSaveState): void {
    const held = cleanRunBoons(Object.keys(this.ctx.player.perks ?? {}));
    const boons = state.boons ?? (state.boons = []);
    for (const id of held) if (!boons.includes(id)) boons.push(id);
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
    this.noteBoons(state);
    const levelId = ctx.levels.current?.def.id ?? null;
    const floor = floorOf(levelId) || Math.max(1, state.maxFloor);
    // Off the spine (a playtest, a test arena) the ledger names the door this
    // run took on the floor it reached.
    const floorId = floorOf(levelId) > 0 ? levelId : doorTaken(state.path, floor);
    const recorded = state.recorded && !this.tainted(ctx);
    const summary = buildRunSummary({
      outcome,
      seed: state.seed,
      daily: state.daily,
      seedChosen: state.seedChosen,
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
      // The very line the death screen showed and the narrator spoke (same dispatch, same frame).
      causeLine: outcome === 'fallen' ? deathLineFor(this.lastCause, ctx.state.frameCount) : undefined,
      path: state.path ?? [],
      boons: state.boons ?? [],
      difficulty: asDifficulty(ctx.state.difficulty, BASE_DIFFICULTY),
      mutators: state.mutators ?? [],
    });
    let unlocked = [...this.runUnlocks];
    let record: Pick<RunResult, 'dailyBest' | 'newDailyBest' | 'newBestFloor' | 'unlockedDifficulty'> = { dailyBest: null, newDailyBest: false, newBestFloor: false, unlockedDifficulty: null };
    if (recorded) {
      const end = recordRunEnded(this.meta.profile, summary);
      this.meta.commit(end.profile);
      unlocked = [...new Set([...unlocked, ...end.unlocked])];
      record = { dailyBest: end.dailyBest, newDailyBest: end.newDailyBest, newBestFloor: end.newBestFloor, unlockedDifficulty: end.unlockedDifficulty };
      for (const kit of end.unlocked) ctx.telemetry.count(`run.unlock.${kit}`);
    }
    ctx.telemetry.count(`run.ended.${outcome}`);
    this.result = { summary, unlocked, ...record, recorded, present };
    this.finished = present;
    if (!present) {
      this.state = null;
      this.tracked = false;
    }
    // The run is over: nothing is left for Continue to resume. A test run leaves an
    // older checkpoint alone: it is not this run's to delete (core/runTaint).
    if (!this.tainted(ctx)) ctx.levels.abandonExpedition();
    // The shipped tuning comes back with the run's end (the ledger reads the summary, not the dials).
    ctx.mutators?.deactivate(ctx);
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
    return isRunTainted(ctx.state);
  }
}

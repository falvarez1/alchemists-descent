import type { CommandResult, Ctx, LevelRuntime } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { FLOORS_TOTAL, LEVELS, floorDisplayName, floorOf, nextDoors } from '@/config/worldgraph';
import { DIFFICULTY, DIFFICULTY_ORDER, asDifficulty, isDifficulty } from '@/config/difficulty';
import { KIT_DEFS, KIT_ORDER, isKitId } from '@/content/kits';
import { SANCTUM_PERK_DEFS } from '@/content/perks';
import { isRunTainted, taintRun } from '@/core/runTaint';
import { arrivalStandable } from '@/game/arrival';
import { descendBehindCurtain, descentCurtainCopy } from '@/game/descentCurtain';
import type { CompletionRequest, ConsoleCommandDefinition } from '@/game/console/registry';
import { currentToken, info, matching, result } from '@/game/console/kit';
import {
  AT_SPOTS,
  allLevelIds,
  formatLevelTable,
  isAtSpot,
  levelRows,
  parseFlags,
  parseFloorNumber,
  resolveTravelTarget,
  type AtSpot,
} from '@/game/console/travelTargets';

/**
 * The tester's travel kit (docs/DEVELOPER-CONSOLE-RUN-WORKFLOW.md): go to any
 * level, skip a floor, reach the key, the portal, the boss, Pell's camp, the
 * memory valve, a waystone, and end a run either way — all inside the run that
 * is already going, so its kit, boons, phials and tier are kept.
 *
 * Every command goes through the game's own code and leaves the run TAINTED
 * (core/runTaint): no autosave over a real expedition, no ledger credit, no
 * meta unlocks, and the story hears it from a scratch memory. Reading commands
 * (levels, seed, and boon/kit/tier/phials with no argument) never taint.
 *
 * These registrations live behind `__AUTHORING__` (game/console/commands): the
 * player build does not contain them at all.
 */

export interface TravelDeps {
  /** Raise the curtain, let it paint, then run the blocking work (game/descentCurtain). Node tests run it directly. */
  curtain<T>(ctx: Ctx, copy: { title: string; detail: string }, run: () => T): Promise<T>;
  sleep(ms: number): Promise<void>;
}

export const DEFAULT_TRAVEL_DEPS: TravelDeps = {
  curtain: (ctx, copy, run) => (typeof document === 'undefined' ? Promise.resolve(run()) : descendBehindCurtain(ctx, copy, run)),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const TAINT_SENTENCE = 'DEBUG TAINT: this run is now a test run (no autosave over a real expedition, no ledger credit, no unlocks).';
const ARRIVAL_POLL_MS = 100;
const ARRIVAL_TIMEOUT_MS = 30_000;

function taintNote(wasTainted: boolean): string {
  return wasTainted ? '' : ` ${TAINT_SENTENCE}`;
}

type Gate = { ok: true; runtime: LevelRuntime } | { ok: false; result: CommandResult };

/** The run a travel command needs: in play, on a campaign level or a test arena, and not over. */
function gateRun(ctx: Ctx, verb: string, opts: { allowOver?: boolean } = {}): Gate {
  const current = ctx.levels.current;
  const startHint = 'Start one: run new (a real descent) or run test --level d3 (a disposable test run).';
  if (ctx.state.mode !== 'play' || !current) {
    const where = ctx.state.mode === 'build' ? 'You are in the Sandbox, the Builder or on the title' : `Mode is ${ctx.state.mode}`;
    return { ok: false, result: result(false, `${verb} needs a run in progress. ${where}. ${startHint}`, { code: 'no-run', command: verb, mode: ctx.state.mode }) };
  }
  if (ctx.state.playtestSource === 'builder') {
    return { ok: false, result: result(false, `${verb} works in a campaign or test run, not in a Builder playtest.`, { code: 'builder-playtest', command: verb }) };
  }
  if (!LEVELS[current.def.id]) {
    return { ok: false, result: result(false, `${verb} works on the campaign levels and the test arenas; this is a custom or virtual-world runtime. ${startHint}`, { code: 'not-campaign', command: verb, level: current.def.id }) };
  }
  if (ctx.run?.over && !opts.allowOver) {
    return { ok: false, result: result(false, `The run has ended (its ledger is up or was shown). ${startHint}`, { code: 'run-over', command: verb }) };
  }
  return { ok: true, runtime: current };
}

function walkedDoors(ctx: Ctx): string[] | null {
  return ctx.run?.snapshotForSave?.()?.path ?? null;
}

/* ---------------- where to stand ---------------- */

interface Anchor {
  label: string;
  x: number;
  y: number;
  /** Horizontal offsets to try, in order of preference. */
  dxs: number[];
  /** Feet rows to try, relative to `y`. */
  fyMin: number;
  fyMax: number;
}

/** [min, -min, min+step, -(min+step), ... max, -max]: nearest first, alternating sides. */
function offsets(min: number, max: number, step: number): number[] {
  const out: number[] = min === 0 ? [0] : [];
  for (let d = Math.max(min, step); d <= max; d += step) out.push(d, -d);
  if (min > 0) out.unshift(...[min, -min].filter((d) => !out.includes(d)));
  return out;
}

function nearestFirst(span: number): number[] {
  const out = [0];
  for (let d = 1; d <= span; d++) out.push(d, -d);
  return out;
}

function supported(ctx: Ctx, x: number, fy: number): boolean {
  return ctx.physics.entityFree(x, fy, PLAYER_HALF_W, PLAYER_H) && !ctx.physics.entityFree(x, fy + 1, PLAYER_HALF_W, 1);
}

/** A feet row to stand on near an anchor: the arrival's own standing rules first, plain footing with headroom as the fallback. */
function findStanding(ctx: Ctx, a: Anchor): { x: number; y: number } | null {
  const rows = nearestFirst(Math.max(Math.abs(a.fyMin), Math.abs(a.fyMax))).filter((d) => d >= a.fyMin && d <= a.fyMax);
  for (const strict of [true, false]) {
    for (const dx of a.dxs) {
      const x = Math.round(a.x + dx);
      for (const dy of rows) {
        const fy = Math.round(a.y) + dy;
        if (strict ? arrivalStandable(ctx, x, fy) : supported(ctx, x, fy)) return { x, y: fy };
      }
    }
  }
  return null;
}

function anchorFor(ctx: Ctx, runtime: LevelRuntime, at: AtSpot, pick?: number): Anchor | string {
  switch (at) {
    case 'spawn':
      return { label: 'the level spawn', x: runtime.spawn.x, y: runtime.spawn.y, dxs: [0, ...offsets(2, 10, 2)], fyMin: -2, fyMax: 14 };
    case 'portal': {
      const p = runtime.portal;
      if (!p) return `${runtime.def.name} has no exit portal${runtime.def.boss ? ` (its way out is the ${runtime.def.boss}'s death)` : ''}.`;
      return { label: 'the exit portal', x: p.x, y: p.y, dxs: offsets(12, 48, 4), fyMin: 0, fyMax: 20 };
    }
    case 'boss': {
      const b = runtime.boss;
      if (!b) return `${runtime.def.name} has no guardian.`;
      return { label: `the ${b.kind ?? runtime.def.boss ?? 'guardian'}'s arena`, x: b.x, y: b.y, dxs: offsets(36, 90, 6), fyMin: -50, fyMax: 50 };
    }
    case 'camp': {
      const c = runtime.story?.camp;
      if (!c) return `${runtime.def.name} has no camp for Pell.`;
      return { label: "Pell's camp", x: c.x, y: c.floorY, dxs: offsets(10, 34, 4), fyMin: -6, fyMax: 6 };
    }
    case 'valve': {
      const v = runtime.story?.valve;
      if (!v) return `${runtime.def.name} has no resonant valve.`;
      return { label: 'the resonant valve', x: v.x, y: v.floorY, dxs: [0, ...offsets(4, 16, 4)], fyMin: -5, fyMax: 5 };
    }
    case 'waystone': {
      const stones = runtime.waystones.map((ws, index) => ({ ws, index }));
      if (stones.length === 0) return `${runtime.def.name} has no waystones.`;
      const chosen = pick !== undefined
        ? stones[pick]
        : [...stones].sort((a, b) => Number(a.ws.lit) - Number(b.ws.lit) || Math.hypot(a.ws.x - ctx.player.x, a.ws.y - ctx.player.y) - Math.hypot(b.ws.x - ctx.player.x, b.ws.y - ctx.player.y))[0];
      if (!chosen) return `${runtime.def.name} has ${stones.length} waystone${stones.length === 1 ? '' : 's'}; there is no waystone ${(pick ?? 0) + 1}.`;
      return { label: `waystone ${chosen.index + 1}${chosen.ws.lit ? ' (lit)' : ''}`, x: chosen.ws.x, y: chosen.ws.y, dxs: offsets(10, 30, 4), fyMin: -8, fyMax: 8 };
    }
    case 'key': {
      const k = runtime.pickups.find((p) => p.kind === 'key' && !p.taken);
      if (!k) return runtime.pickups.some((p) => p.kind === 'key') || runtime.keyTaken ? 'The key is already taken.' : `${runtime.def.name} has no key.`;
      return { label: runtime.living ? 'the brass bell' : 'the golden key', x: k.x, y: k.y, dxs: [0, ...offsets(4, 24, 4)], fyMin: -6, fyMax: 12 };
    }
  }
}

function placePlayer(ctx: Ctx, x: number, y: number): void {
  const p = ctx.player;
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.fx = 0;
  p.fy = 0;
  ctx.camera.snapTo(x, y);
}

/** Put the alchemist at a spot on this level: the move, or why not. Taints on a move. */
function teleportAt(ctx: Ctx, runtime: LevelRuntime, at: AtSpot, pick?: number): { ok: true; label: string; x: number; y: number } | { ok: false; text: string } {
  const anchor = anchorFor(ctx, runtime, at, pick);
  if (typeof anchor === 'string') return { ok: false, text: anchor };
  const spot = findStanding(ctx, anchor);
  if (!spot) return { ok: false, text: `No footing with headroom near ${anchor.label} (${Math.round(anchor.x)},${Math.round(anchor.y)}). tp x y places you by hand.` };
  placePlayer(ctx, spot.x, spot.y);
  return { ok: true, label: anchor.label, x: spot.x, y: spot.y };
}

/* ---------------- shared travel ---------------- */

interface TravelOptions {
  seed?: number;
  fresh?: boolean;
  at?: AtSpot;
}

async function travelTo(ctx: Ctx, deps: TravelDeps, id: string, opts: TravelOptions): Promise<CommandResult> {
  const gate = gateRun(ctx, 'goto');
  if (!gate.ok) return gate.result;
  const wasTainted = isRunTainted(ctx.state);
  const wasDead = ctx.player.dead;
  // Leave the Sanctum behind (or whatever the pause was): the alchemist is going through another door.
  ctx.sanctum.dismiss?.();
  const travel = await deps.curtain(ctx, descentCurtainCopy(id), () => ctx.levels.debugTravel(ctx, id, { seed: opts.seed, fresh: opts.fresh }));
  if (!travel.ok) {
    ctx.events.emit('levelCurtain', { visible: false });
    return result(false, `Could not travel to ${id}: ${travel.reason ?? 'the level did not load'}.`, { code: 'travel-failed', ...travel });
  }
  taintRun(ctx); // Levels taints on the way; saying it here keeps the command honest on its own
  // A death is settled by the trip: the phial was spent when it happened; the level's own spawn takes him.
  if (wasDead) ctx.playerCtl.respawn();
  const runtime = ctx.levels.current;
  let where = 'at the arrival';
  let spot: { x: number; y: number } | null = null;
  let atNote = '';
  if (opts.at && runtime) {
    const moved = teleportAt(ctx, runtime, opts.at);
    if (moved.ok) {
      where = `at ${moved.label}`;
      spot = { x: moved.x, y: moved.y };
    } else {
      atNote = ` Could not place you --at ${opts.at}: ${moved.text}`;
    }
  }
  const floor = floorOf(id);
  const built = travel.generated ? (opts.seed !== undefined ? `rebuilt from seed ${opts.seed >>> 0}` : opts.fresh ? 'rebuilt from the run seed' : 'built from the run seed') : 'kept as you left it';
  return result(
    true,
    `goto ${id}: ${floorDisplayName(id)} (${floor > 0 ? `floor ${floor} of ${FLOORS_TOTAL}` : 'a test arena'}), ${built}, ${travel.ms} ms; ${where}.${atNote}${taintNote(wasTainted)}`,
    {
      action: 'goto',
      from: travel.from,
      to: id,
      floor,
      generated: travel.generated,
      ms: travel.ms,
      seed: ctx.levels.levelSeed(ctx, id),
      at: spot,
      respawned: wasDead,
      arrivalGraceUntil: ctx.state.arrivalGraceUntil ?? null,
      findabilityReady: ctx.levels.findabilityReady ?? null,
      tainted: true,
    },
  );
}

/** Wait (bounded) until the level has changed from `from` and the curtain is up: a skip with no Sanctum descends on its own clock. */
async function awaitArrival(ctx: Ctx, deps: TravelDeps, from: string): Promise<boolean> {
  for (let waited = 0; waited < ARRIVAL_TIMEOUT_MS; waited += ARRIVAL_POLL_MS) {
    if (ctx.levels.current?.def.id !== from && !ctx.levels.transitioning) return true;
    await deps.sleep(ARRIVAL_POLL_MS);
  }
  return ctx.levels.current?.def.id !== from;
}

/* ---------------- ending a run ---------------- */

function winRun(ctx: Ctx, verb: string): CommandResult {
  const gate = gateRun(ctx, verb);
  if (!gate.ok) return gate.result;
  if (!ctx.run?.active) {
    return result(false, `${verb}: this is a test run, which has no ledger to end. run new starts a real descent; a test run ends where you leave it.`, { code: 'untracked-run', command: verb });
  }
  const wasTainted = isRunTainted(ctx.state);
  taintRun(ctx);
  // The same event the top of the flue (and a Colossus with no flue) raises: RunDirector ends the run as a victory.
  ctx.events.emit('runComplete', { gold: ctx.state.score });
  return result(true, `${verb}: the descent ends as a victory. The ledger shows a practice descent and records nothing.${taintNote(wasTainted)}`, {
    action: 'win',
    over: ctx.run.over,
    outcome: ctx.run.lastResult?.summary.outcome ?? null,
    recorded: ctx.run.lastResult?.recorded ?? null,
    tainted: true,
  });
}

function loseRun(ctx: Ctx): CommandResult {
  const gate = gateRun(ctx, 'lose');
  if (!gate.ok) return gate.result;
  const wasTainted = isRunTainted(ctx.state);
  taintRun(ctx);
  const notes: string[] = [];
  // God mode turns a death away: a fall that ends the run needs a mortal.
  if (ctx.state.debugGodMode) {
    ctx.state.debugGodMode = false;
    notes.push('God mode turned off.');
  }
  const tracked = ctx.run?.active === true;
  if (tracked) ctx.run?.debugSetPhials?.(ctx, 0);
  if (ctx.player.dead) ctx.playerCtl.respawn();
  ctx.playerCtl.kill();
  const over = ctx.run?.over === true;
  const text = tracked
    ? `lose: the phials are empty and the alchemist falls${over ? '; the run is over and the ledger follows' : ''}.`
    : 'lose: the alchemist falls. (A test run has no phials or ledger: respawn gets up.)';
  return result(true, `${[text, ...notes].join(' ')}${taintNote(wasTainted)}`, { action: 'lose', tracked, over, tainted: true });
}

/* ---------------- completions ---------------- */

function flagCompletions(req: CompletionRequest, positional: () => string[], flags: readonly string[], values: Record<string, () => string[]>): string[] {
  const token = currentToken(req);
  const hasValues = (flag: string | undefined): flag is string => flag !== undefined && flag.startsWith('--') && Object.prototype.hasOwnProperty.call(values, flag);
  // The word before the one being typed (the last word, after a trailing space).
  const before = req.trailingSpace ? req.args[req.args.length - 1] : req.args[req.args.length - 2];
  if (hasValues(before)) return matching(values[before](), token);
  const eq = token.indexOf('=');
  if (token.startsWith('--') && eq > 0 && hasValues(token.slice(0, eq))) {
    const flag = token.slice(0, eq);
    return matching(values[flag]().map((v) => `${flag}=${v}`), token);
  }
  if (token.startsWith('--')) return matching(flags, token);
  // A positional is offered only while none has been typed yet.
  const done = req.trailingSpace ? req.args : req.args.slice(0, -1);
  const typed = done.filter((word, i) => !word.startsWith('--') && !hasValues(done[i - 1])).length;
  return typed === 0 ? matching(positional(), token) : [];
}

function boonIds(): string[] {
  return ['vitality', ...SANCTUM_PERK_DEFS.map((perk) => perk.id)];
}

/* ---------------- the commands ---------------- */

export function createTravelCommands(deps: TravelDeps = DEFAULT_TRAVEL_DEPS): ConsoleCommandDefinition[] {
  const defs: ConsoleCommandDefinition[] = [];
  const add = (def: ConsoleCommandDefinition): void => {
    defs.push(def);
  };
  const levelTargets = (): string[] => [...allLevelIds(), ...Array.from({ length: FLOORS_TOTAL }, (_, i) => String(i + 1)), 'next', 'prev'];

  add({
    name: 'levels',
    info: info('game.levels', 'List Levels', 'levels', 'List every level: floor, biome, boss and which doors lead where.', 'game'),
    run: (ctx) => {
      const rows = levelRows(ctx.levels.current?.def.id ?? null, ctx.levels.generatedLevels?.() ?? []);
      return result(true, formatLevelTable(rows), { action: 'levels', levels: rows, current: ctx.levels.current?.def.id ?? null });
    },
  });

  add({
    name: 'goto',
    info: info(
      'game.goto',
      'Travel',
      'goto <level id|floor 1-4|next|prev> [--at spawn|portal|boss|camp|waystone|valve|key] [--seed n] [--fresh]',
      'Travel to a level through the real transition; the run (kit, boons, phials, tier) is kept. Taints the run.',
      'game',
    ),
    run: async (ctx, args) => {
      const flags = parseFlags(args, { values: ['at', 'seed'], switches: ['fresh'] });
      if (flags.error) return result(false, `${flags.error.text} Usage: goto <level|floor|next|prev> [--at spot] [--seed n] [--fresh]`, { code: flags.error.code });
      if (flags.positional.length !== 1) return result(false, `Usage: goto <level|floor|next|prev> [--at spot] [--seed n] [--fresh]. ${resolveTravelTargetHint()}`, { code: 'usage', expected: allLevelIds() });
      let at: AtSpot | undefined;
      if (flags.values.at !== undefined) {
        const word = flags.values.at.toLowerCase();
        if (!isAtSpot(word)) return result(false, `Unknown --at "${flags.values.at}". Spots: ${AT_SPOTS.join(', ')}.`, { code: 'parse-at', raw: flags.values.at, expected: [...AT_SPOTS] });
        at = word;
      }
      let seed: number | undefined;
      if (flags.values.seed !== undefined) {
        const n = Number(flags.values.seed);
        if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return result(false, `--seed needs a whole number from 0 to 4294967295, got "${flags.values.seed}".`, { code: 'parse-seed', raw: flags.values.seed });
        seed = n >>> 0;
      }
      const gate = gateRun(ctx, 'goto');
      if (!gate.ok) return gate.result;
      const target = resolveTravelTarget(flags.positional[0], gate.runtime.def.id, walkedDoors(ctx));
      if (!target.ok) return result(false, target.text, target.data);
      return travelTo(ctx, deps, target.id, { seed, fresh: flags.switches.has('fresh'), at });
    },
    complete: (_ctx, req) => flagCompletions(req, levelTargets, ['--at', '--seed', '--fresh'], { '--at': () => [...AT_SPOTS], '--seed': () => [] }),
  });

  add({
    name: 'skip',
    aliases: ['descend'],
    info: info('game.skip', 'Skip Floor', 'skip [--no-sanctum] [--door id]', "Take this floor's exit the way the portal does (the Sanctum, then the floor below); on the Kiln Heart, end the descent. Taints the run.", 'game'),
    run: async (ctx, args) => {
      const flags = parseFlags(args, { values: ['door'], switches: ['no-sanctum'] });
      if (flags.error || flags.positional.length > 0) return result(false, `${flags.error?.text ?? `Unexpected "${flags.positional[0]}".`} Usage: skip [--no-sanctum] [--door id]`, { code: 'usage' });
      const gate = gateRun(ctx, 'skip');
      if (!gate.ok) return gate.result;
      if (ctx.player.dead) return result(false, 'skip: you are dead. respawn first.', { code: 'dead' });
      const here = gate.runtime.def;
      if (!here.nextLevelId) {
        if (floorOf(here.id) === FLOORS_TOTAL) return winRun(ctx, 'skip');
        return result(false, `${here.id} has no exit. goto <level> leaves it.`, { code: 'no-exit', level: here.id });
      }
      const doors = [...nextDoors(here.id)];
      const door = flags.values.door?.toLowerCase();
      if (door !== undefined && !doors.includes(door)) return result(false, `${door} is not a door below ${here.id}. Doors: ${doors.join(', ')}.`, { code: 'bad-door', expected: doors });
      const wasTainted = isRunTainted(ctx.state);
      const noSanctum = flags.switches.has('no-sanctum');
      const finished = ctx.levels.debugFinishFloor(ctx, { sanctum: !noSanctum, door });
      if (!finished.ok) {
        const why: Record<string, string> = {
          'sanctum-open': 'The Sanctum is already open: choose a boon and a door there (or goto elsewhere).',
          'no-exit': `${here.id} has no exit.`,
          'no-run': 'skip needs a run in progress.',
          'bad-door': `Not a door below ${here.id}.`,
        };
        return result(false, `skip: ${why[finished.reason ?? 'no-run'] ?? 'nothing happened.'}`, { code: finished.reason ?? 'skip-failed', ...finished });
      }
      taintRun(ctx);
      if (!noSanctum) {
        return result(true, `skip: took ${here.id}'s exit. The Sanctum is open (Floor ${floorOf(here.id) + 1}: ${doors.join(' or ')}): strike a boon, choose a door, descend.${taintNote(wasTainted)}`, {
          action: 'skip',
          sanctum: true,
          from: here.id,
          doors,
          tainted: true,
        });
      }
      taintRun(ctx);
      const landed = await awaitArrival(ctx, deps, here.id);
      const now = ctx.levels.current?.def.id ?? null;
      return result(landed, landed
        ? `skip: through the Sanctum (first boon on offer) to ${now} ${floorDisplayName(now)}.${taintNote(wasTainted)}`
        : `skip: the Sanctum was asked to descend but ${here.id} is still the level after ${ARRIVAL_TIMEOUT_MS / 1000} s.`, {
        action: 'skip',
        sanctum: false,
        from: here.id,
        to: now,
        arrivalGraceUntil: ctx.state.arrivalGraceUntil ?? null,
        tainted: true,
      });
    },
    complete: (_ctx, req) => flagCompletions(req, () => [], ['--no-sanctum', '--door'], { '--door': () => allLevelIds() }),
  });

  add({
    name: 'sanctum',
    info: info('game.sanctum', 'Open Sanctum', 'sanctum [floor 1-3]', 'Open the Sanctum as if that floor (default: this one) had just been finished. Taints the run.', 'game'),
    run: async (ctx, args) => {
      if (args.length > 1) return result(false, 'Usage: sanctum [floor 1-3]', { code: 'usage' });
      const gate = gateRun(ctx, 'sanctum');
      if (!gate.ok) return gate.result;
      let here = gate.runtime;
      let via = '';
      if (args[0] !== undefined) {
        const floor = parseFloorNumber(args[0]);
        if (floor === null || floor >= FLOORS_TOTAL) return result(false, `sanctum takes a floor from 1 to ${FLOORS_TOTAL - 1} (there is no Sanctum below the Kiln Heart), got "${args[0]}".`, { code: 'parse-floor', raw: args[0] });
        if (floorOf(here.def.id) !== floor) {
          const target = resolveTravelTarget(String(floor), here.def.id, walkedDoors(ctx));
          if (!target.ok) return result(false, target.text, target.data);
          const went = await travelTo(ctx, deps, target.id, { at: 'portal' });
          if (!went.ok) return went;
          via = `Went to ${target.id} first. `;
          const now = ctx.levels.current;
          if (!now) return result(false, 'sanctum: the level did not load.', { code: 'travel-failed' });
          here = now;
        }
      }
      if (!here.def.nextLevelId) return result(false, `${here.def.id} has no Sanctum below it.`, { code: 'no-exit', level: here.def.id });
      if (ctx.sanctum.isOpen) return result(true, 'The Sanctum is already open.', { action: 'sanctum', already: true });
      const wasTainted = isRunTainted(ctx.state);
      const finished = ctx.levels.debugFinishFloor(ctx, { sanctum: true });
      if (!finished.ok) return result(false, `sanctum: ${finished.reason ?? 'could not open'}.`, { code: finished.reason ?? 'sanctum-failed', ...finished });
      taintRun(ctx);
      return result(true, `${via}The Sanctum is open for ${here.def.id} (doors below: ${finished.doors.join(', ')}).${taintNote(wasTainted)}`, { action: 'sanctum', from: here.def.id, doors: finished.doors, tainted: true });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['1', '2', '3'], currentToken(req)) : []),
  });

  const teleportCommand = (name: string, at: AtSpot, label: string, description: string): ConsoleCommandDefinition => ({
    name,
    info: info(`game.${name}`, label, name, description, 'game'),
    run: (ctx, args) => {
      if (args.length > 0) return result(false, `Usage: ${name}`, { code: 'usage' });
      const gate = gateRun(ctx, name);
      if (!gate.ok) return gate.result;
      const wasTainted = isRunTainted(ctx.state);
      const moved = teleportAt(ctx, gate.runtime, at);
      if (!moved.ok) return result(false, `${name}: ${moved.text}`, { code: 'no-spot', at });
      taintRun(ctx);
      return result(true, `Teleported to ${moved.label} at ${moved.x},${moved.y}.${taintNote(wasTainted)}`, { action: 'teleport', at, x: moved.x, y: moved.y, tainted: true });
    },
  });
  add(teleportCommand('portal', 'portal', 'To Portal', "Teleport beside this floor's exit portal. Taints the run."));
  add(teleportCommand('camp', 'camp', 'To Camp', "Teleport to Pell's camp on this floor. Taints the run."));
  add(teleportCommand('echo', 'valve', 'To Echo', "Teleport to this floor's resonant valve, where the memory echo plays. Taints the run."));

  add({
    name: 'boss',
    info: info('game.boss', 'Boss', 'boss [kill]', "Teleport to the floor's guardian; `boss kill` fells it through the real death path. Taints the run.", 'game'),
    run: (ctx, args) => {
      if (args.length > 1 || (args[0] !== undefined && args[0].toLowerCase() !== 'kill')) return result(false, 'Usage: boss [kill]', { code: 'usage' });
      const gate = gateRun(ctx, 'boss');
      if (!gate.ok) return gate.result;
      const runtime = gate.runtime;
      const wasTainted = isRunTainted(ctx.state);
      if (args[0] === undefined) {
        const moved = teleportAt(ctx, runtime, 'boss');
        if (!moved.ok) return result(false, `boss: ${moved.text}`, { code: 'no-spot', at: 'boss' });
        taintRun(ctx);
        return result(true, `Teleported to ${moved.label} at ${moved.x},${moved.y}.${taintNote(wasTainted)}`, { action: 'teleport', at: 'boss', x: moved.x, y: moved.y, tainted: true });
      }
      const kind = runtime.boss?.kind ?? runtime.def.boss;
      if (!kind) return result(false, `${runtime.def.name} has no guardian.`, { code: 'no-boss' });
      const bosses = ctx.enemies.filter((e) => e.kind === kind && e.hp > 0);
      if (bosses.length === 0) return result(false, `The ${kind} is already down (or not here).`, { code: 'boss-down', kind });
      taintRun(ctx);
      for (const boss of bosses) ctx.enemyCtl.kill(boss, 0, 0);
      // The Colossus dies as a sequence: it stays on the floor for a few seconds, then the run's aftermath starts.
      const sequence = ctx.enemies.some((e) => e.kind === kind);
      return result(true, `The ${kind} falls through the real death path${sequence ? ': its death sequence has begun and plays out over a few seconds' : ''}.${taintNote(wasTainted)}`, { action: 'boss-kill', kind, killed: bosses.length, tainted: true });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['kill'], currentToken(req)) : []),
  });

  add({
    name: 'key',
    info: info('game.key', 'Take Key', 'key', "Collect this floor's golden key (D1: the brass bell) through the code a walk-over uses, so the portal wakes. Taints the run.", 'game'),
    run: (ctx, args) => {
      if (args.length > 0) return result(false, 'Usage: key', { code: 'usage' });
      const gate = gateRun(ctx, 'key');
      if (!gate.ok) return gate.result;
      if (!ctx.pickups.grantKey) return result(false, 'key: the play systems are not loaded yet.', { code: 'not-ready' });
      const wasTainted = isRunTainted(ctx.state);
      const outcome = ctx.pickups.grantKey(ctx);
      if (outcome === 'no-key') return result(false, `${gate.runtime.def.name} has no key. (The Kiln Heart's way out is the Colossus.)`, { code: 'no-key' });
      if (outcome === 'already-taken') return result(false, 'The key is already yours.', { code: 'key-taken' });
      taintRun(ctx);
      const d1 = gate.runtime.living ? ' On D1 the lower gate also wants the engine\'s bell rung and the grate open: skip goes around all of it.' : '';
      return result(true, `${gate.runtime.living ? 'The brass bell' : 'The golden key'} is yours; the portal will wake when you reach it.${d1}${taintNote(wasTainted)}`, { action: 'key', keyTaken: gate.runtime.keyTaken, tainted: true });
    },
  });

  add({
    name: 'waystone',
    info: info('game.waystone', 'Waystone', 'waystone [tp|light] [n]', 'Go to, or really light, a waystone (the respawn anchor). Taints the run.', 'game'),
    run: (ctx, args) => {
      const gate = gateRun(ctx, 'waystone');
      if (!gate.ok) return gate.result;
      const runtime = gate.runtime;
      let verb = 'tp';
      const rest = [...args];
      if (rest[0] && ['tp', 'light'].includes(rest[0].toLowerCase())) verb = rest.shift()!.toLowerCase();
      if (rest.length > 1) return result(false, 'Usage: waystone [tp|light] [n]', { code: 'usage' });
      let pick: number | undefined;
      if (rest[0] !== undefined) {
        const n = Number(rest[0]);
        if (!Number.isInteger(n) || n < 1 || n > runtime.waystones.length) {
          return result(false, runtime.waystones.length === 0 ? `${runtime.def.name} has no waystones.` : `waystone n is 1 to ${runtime.waystones.length}, got "${rest[0]}".`, { code: 'parse-waystone', count: runtime.waystones.length });
        }
        pick = n - 1;
      }
      const wasTainted = isRunTainted(ctx.state);
      if (verb === 'light') {
        // The nearest unlit one, as tp goes to: standing beside a bowl and lighting another would be a trap.
        const nearestUnlit = runtime.waystones
          .map((ws, i) => ({ ws, i, d: Math.hypot(ws.x - ctx.player.x, ws.y - ctx.player.y) }))
          .filter((w) => !w.ws.lit)
          .sort((a, b) => a.d - b.d)[0];
        const index = pick ?? nearestUnlit?.i ?? -1;
        if (index < 0) return result(false, 'Every waystone here is already lit.', { code: 'all-lit' });
        if (!ctx.levels.debugLightWaystone(ctx, index)) return result(false, `Waystone ${index + 1} is already lit.`, { code: 'lit' });
        taintRun(ctx);
        return result(true, `Waystone ${index + 1} lit through the real ignition: your return point is there.${taintNote(wasTainted)}`, { action: 'waystone-light', index, tainted: true });
      }
      const moved = teleportAt(ctx, runtime, 'waystone', pick);
      if (!moved.ok) return result(false, `waystone: ${moved.text}`, { code: 'no-spot', at: 'waystone' });
      taintRun(ctx);
      return result(true, `Teleported to ${moved.label} at ${moved.x},${moved.y}.${taintNote(wasTainted)}`, { action: 'teleport', at: 'waystone', x: moved.x, y: moved.y, tainted: true });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['tp', 'light'], currentToken(req)) : []),
  });

  add({
    name: 'phials',
    info: info('game.phials', 'Return Phials', 'phials [0-3]', 'Show or set the return phials of the run. Setting taints the run.', 'game'),
    run: (ctx, args) => {
      if (args.length > 1) return result(false, 'Usage: phials [0-3]', { code: 'usage' });
      const run = ctx.run;
      if (!run?.active) return result(false, 'phials: no tracked run. (A test run has no phials; run new starts a real descent.)', { code: 'untracked-run' });
      if (args[0] === undefined) return result(true, `Return phials: ${run.phials} of ${run.maxPhials}.`, { action: 'phials', phials: run.phials, max: run.maxPhials });
      const n = Number(args[0]);
      if (!Number.isInteger(n) || n < 0 || n > run.maxPhials) return result(false, `phials takes 0 to ${run.maxPhials}, got "${args[0]}".`, { code: 'parse-phials', max: run.maxPhials });
      const wasTainted = isRunTainted(ctx.state);
      taintRun(ctx);
      run.debugSetPhials?.(ctx, n);
      return result(true, `Return phials set to ${run.phials} of ${run.maxPhials}.${taintNote(wasTainted)}`, { action: 'phials', phials: run.phials, max: run.maxPhials, tainted: true });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['0', '1', '2', '3'], currentToken(req)) : []),
  });

  add({
    name: 'boon',
    info: info('game.boon', 'Sanctum Boon', 'boon [id]', "List the Sanctum's boons, or strike one through the Sanctum's own code. Striking taints the run.", 'game'),
    run: (ctx, args) => {
      if (args.length > 1) return result(false, 'Usage: boon [id]', { code: 'usage' });
      const held = (id: string): boolean => (ctx.player.perks as Record<string, boolean | undefined>)[id] === true;
      if (args[0] === undefined) {
        const rows = [
          { id: 'vitality', name: 'Vitality', desc: '+30 max HP, fully restored (instant; repeatable)', held: false },
          ...SANCTUM_PERK_DEFS.map((perk) => ({ id: perk.id, name: perk.sanctumName, desc: perk.desc, held: held(perk.id) })),
        ];
        const text = ['Sanctum boons (* held):', ...rows.map((r) => `  ${(r.held ? '* ' : '  ') + r.id.padEnd(14)}${r.name.padEnd(20)}${r.desc}`), 'boon <id> strikes one.'].join('\n');
        return result(true, text, { action: 'boons', boons: rows });
      }
      const id = args[0].toLowerCase();
      if (!boonIds().includes(id)) return result(false, `Unknown boon "${args[0]}". Boons: ${boonIds().join(', ')}.`, { code: 'parse-boon', raw: args[0], expected: boonIds() });
      if (!ctx.sanctum.applyBoon) return result(false, 'boon: the play systems are not loaded yet.', { code: 'not-ready' });
      if (ctx.state.mode !== 'play') return result(false, 'boon needs a run in progress.', { code: 'no-run' });
      const wasTainted = isRunTainted(ctx.state);
      taintRun(ctx);
      ctx.sanctum.applyBoon(ctx, id);
      return result(true, `Struck ${id}.${taintNote(wasTainted)}`, { action: 'boon', id, tainted: true });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(boonIds(), currentToken(req)) : []),
  });

  add({
    name: 'kit',
    info: info('game.kit', 'Starting Kit', 'kit [id]', "Show the kits, or reset the wands, satchel and flasks to another kit's starting hand. Switching taints the run.", 'game'),
    run: (ctx, args) => {
      if (args.length > 1) return result(false, 'Usage: kit [id]', { code: 'usage' });
      const current = ctx.run?.active ? ctx.run.kit : null;
      if (args[0] === undefined) {
        const text = ['Kits (* this run):', ...KIT_ORDER.map((id) => `  ${(id === current ? '* ' : '  ') + id.padEnd(8)}${KIT_DEFS[id].name}: ${KIT_DEFS[id].blurb}`), 'kit <id> switches.'].join('\n');
        return result(true, text, { action: 'kits', current, kits: [...KIT_ORDER] });
      }
      const id = args[0].toLowerCase();
      if (!isKitId(id)) return result(false, `Unknown kit "${args[0]}". Kits: ${KIT_ORDER.join(', ')}.`, { code: 'parse-kit', raw: args[0], expected: [...KIT_ORDER] });
      const gate = gateRun(ctx, 'kit');
      if (!gate.ok) return gate.result;
      const wasTainted = isRunTainted(ctx.state);
      if (!ctx.levels.debugApplyKit(ctx, id)) return result(false, 'kit: could not apply the kit.', { code: 'kit-failed' });
      taintRun(ctx);
      ctx.run?.debugSetKit?.(id);
      return result(true, `Kit ${id}: ${KIT_DEFS[id].name}. Wands, satchel and flasks reset to its starting hand.${taintNote(wasTainted)}`, { action: 'kit', id, tainted: true });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(KIT_ORDER, currentToken(req)) : []),
  });

  add({
    name: 'tier',
    info: info('game.tier', 'Difficulty Tier', 'tier [1-4]', 'Show or set the difficulty tier of this run. Setting taints the run.', 'game'),
    run: (ctx, args) => {
      if (args.length > 1) return result(false, 'Usage: tier [1-4]', { code: 'usage' });
      const now = asDifficulty(ctx.state.difficulty, 3);
      const list = DIFFICULTY_ORDER.map((d) => `${d} ${DIFFICULTY[d].name}`).join(', ');
      if (args[0] === undefined) return result(true, `Tier ${now} (${DIFFICULTY[now].name}). Tiers: ${list}.`, { action: 'tier', tier: now, name: DIFFICULTY[now].name });
      const byName = DIFFICULTY_ORDER.find((d) => DIFFICULTY[d].name.toLowerCase() === args[0].toLowerCase());
      const n = byName ?? Number(args[0]);
      if (!isDifficulty(n)) return result(false, `Unknown tier "${args[0]}". Tiers: ${list}.`, { code: 'parse-tier', raw: args[0] });
      const wasTainted = isRunTainted(ctx.state);
      taintRun(ctx);
      ctx.state.difficulty = asDifficulty(n, 3);
      return result(true, `Tier ${ctx.state.difficulty} (${DIFFICULTY[ctx.state.difficulty].name}) for foes and penalties from now on; floors already built keep their foes.${taintNote(wasTainted)}`, { action: 'tier', tier: ctx.state.difficulty, tainted: true });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['1', '2', '3', '4', ...DIFFICULTY_ORDER.map((d) => DIFFICULTY[d].name.toLowerCase())], currentToken(req)) : []),
  });

  add({
    name: 'seed',
    info: info('game.seed', 'Seeds', 'seed', 'Show the run seed and every level seed. A run\'s seed is fixed when it starts.', 'game'),
    run: (ctx, args) => {
      const status = ctx.levels.runStatus(ctx);
      if (args.length > 0) {
        return result(false, "A run's seed is fixed when it starts. To start over on a seed: run new --seed n. To rebuild one floor from a seed inside this run: goto <level> --seed n.", { code: 'seed-fixed' });
      }
      const built = ctx.levels.generatedLevels?.() ?? [];
      const rows = allLevelIds().filter((id) => floorOf(id) > 0).map((id) => ({ id, seed: ctx.levels.levelSeed(ctx, id), built: built.includes(id) }));
      const text = [
        `Run seed ${status.worldSeed}${status.expeditionSeed !== null ? '' : ' (no expedition yet)'}. Level seeds (the run seed salted with the id; * built this run):`,
        ...rows.map((r) => `  ${(r.id + (r.built ? ' *' : '')).padEnd(8)}${r.seed}`),
      ].join('\n');
      return result(true, text, { action: 'seed', runSeed: status.worldSeed, expeditionSeed: status.expeditionSeed, levels: rows });
    },
  });

  add({
    name: 'win',
    info: info('game.win', 'Win Run', 'win', 'End the run as a victory through RunDirector (no escape, no ending plates). Taints the run.', 'game'),
    run: (ctx, args) => (args.length > 0 ? result(false, 'Usage: win', { code: 'usage' }) : winRun(ctx, 'win')),
  });

  add({
    name: 'lose',
    info: info('game.lose', 'Lose Run', 'lose', 'End the run as a fall: empty the phials and die through the real death path. Taints the run.', 'game'),
    run: (ctx, args) => (args.length > 0 ? result(false, 'Usage: lose', { code: 'usage' }) : loseRun(ctx)),
  });

  add({
    name: 'respawn',
    info: info('game.respawn', 'Respawn', 'respawn', "Get up after a death, as the death screen's button does.", 'game'),
    run: (ctx, args) => {
      if (args.length > 0) return result(false, 'Usage: respawn', { code: 'usage' });
      if (ctx.state.mode !== 'play') return result(false, 'respawn needs a run in progress.', { code: 'no-run' });
      if (ctx.run?.over) return result(false, 'The run is over: there is no getting up from this one. Its ledger offers another descent.', { code: 'run-over' });
      if (!ctx.player.dead) return result(false, 'You are not dead. portal, camp, echo and goto move you.', { code: 'alive' });
      ctx.playerCtl.respawn();
      return result(true, `Back on your feet at ${Math.round(ctx.player.x)},${Math.round(ctx.player.y)}.`, { action: 'respawn', x: ctx.player.x, y: ctx.player.y });
    },
  });

  return defs;
}

function resolveTravelTargetHint(): string {
  return `Level ids: ${allLevelIds().join(', ')}; or a floor 1-${FLOORS_TOTAL}, next, prev.`;
}

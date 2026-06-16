import { sanitizeBackdropSettings, saveBackdropSettings } from '@/config/backdrop';
import { LEVELS } from '@/config/worldgraph';
import { FLASK_SLOT_COUNT, type BodyMaterial, type CardId, type CommandInfo, type CommandResult, type ConsoleApi, type Ctx, type EnemyKind, type FlaskSlotConfig, type LevelRuntime, type Mechanism, type PerkId, type Pickup, type RunTestKitConfig } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { grantFullReviewKit } from '@/entities/Player';
import { ALL_CARD_IDS, CARD_DEFS } from '@/combat/wands/cards';
import { Cell, CELL_COUNT } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import { ConsoleCommandRegistry, parseConsoleLine } from '@/game/console/registry';
import type { CompletionRequest, ConsoleCommandDefinition } from '@/game/console/registry';
import { loadConsoleBinds, loadConsoleWatches, normalizeBindKey, saveConsoleBinds, saveConsoleWatches } from '@/game/console/prefs';
import { loadConsoleScripts, normalizeScriptName, parseScriptLines, scriptNames } from '@/game/console/scripts';

type ConsoleTarget =
  | 'sandbox'
  | 'expedition'
  | 'builder-document'
  | 'builder-live-preview'
  | 'builder-playtest';

type TargetedArgs =
  | { ok: true; args: string[]; target: ConsoleTarget; explicit: boolean }
  | { ok: false; result: CommandResult };

const TARGETS: ConsoleTarget[] = [
  'sandbox',
  'expedition',
  'builder-document',
  'builder-live-preview',
  'builder-playtest',
];

const GAMEPLAY_TAINT_COMMANDS = new Set(['god', 'tp', 'spawn', 'give', 'kill', 'cell', 'fill', 'level', 'heal', 'gold']);
const FILL_CELL_CAP = 150_000;
const DUMP_CELL_CAP = 4_096;
const PERFREC_MAX_FRAMES = 600;
const SCRIPT_MAX_DEPTH = 4;
const RENDER_BACKEND_MODES = ['webgl', 'webgpu', 'auto'] as const;
const RUN_SUBCOMMANDS = ['status', 'continue', 'resume', 'new', 'fresh', 'test', 'save', 'abandon'] as const;
const RUN_WORLD_SOURCES = ['campaign', 'campaign-level', 'virtual-world', 'virtual'] as const;
const RUN_LOADOUTS = ['fresh', 'advanced', 'review'] as const;
const RUN_PERKS: PerkId[] = [
  'might',
  'vampirism',
  'featherweight',
  'manafont',
  'swiftfoot',
  'torchbearer',
  'ironhide',
  'flameward',
  'toxinward',
  'goldmagnet',
];

const GOD_FLASKS: FlaskSlotConfig[] = [
  { material: Cell.ElixirLife, count: 600 },
  { material: Cell.ElixirLevity, count: 600 },
  { material: Cell.ElixirStone, count: 600 },
  { material: Cell.Water, count: 600 },
];

type Bounds = { x0: number; y0: number; x1: number; y1: number };
type PerfPhase = 'sim' | 'entities' | 'render' | 'compose' | 'gl' | 'frame';
type PerfSample = Record<PerfPhase, number>;
type ParsedRunOptions = {
  ok: true;
  levelId?: string;
  seed?: number;
  loadout?: 'fresh' | 'advanced' | 'review';
  worldSource?: 'campaign' | 'campaign-level' | 'virtual-world';
  kit?: RunTestKitConfig;
  hasTestOnlySetup: boolean;
};
type PerfWindow = Window & {
  __perfRecord?: boolean;
  __perfSamples?: PerfSample[];
};
type BrowserWindow = Window & typeof globalThis;

function result(ok: boolean, text: string, data?: unknown): CommandResult {
  return data === undefined ? { ok, text } : { ok, text, data };
}

function info(
  id: string,
  label: string,
  usage: string,
  description: string,
  category: CommandInfo['category'] = id.startsWith('console.') ? 'console' : 'game',
  shortcut?: string,
): CommandInfo {
  return { id, label, category, usage, description, shortcut, enabled: true };
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function currentToken(req: CompletionRequest): string {
  if (req.trailingSpace) return '';
  return req.args[req.args.length - 1] ?? '';
}

function matching(values: Iterable<string>, prefix: string): string[] {
  const p = normalizeKey(prefix);
  return [...values].filter((v) => normalizeKey(v).startsWith(p));
}

function isBuilderOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.body.classList.contains('builder-open');
}

function parseTargetFlag(args: string[]): { args: string[]; target?: ConsoleTarget; error?: CommandResult } {
  const out: string[] = [];
  let target: ConsoleTarget | undefined;
  let targetToken: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let raw: string | undefined;
    if (arg === '--target') {
      raw = args[++i];
    } else if (arg.startsWith('--target=')) {
      raw = arg.slice('--target='.length);
    } else if (arg.startsWith('@')) {
      raw = arg.slice(1);
    } else {
      out.push(arg);
      continue;
    }
    if (!raw) return { args: out, error: result(false, 'Expected target after --target', { code: 'target-missing' }) };
    const found = TARGETS.find((t) => t === raw);
    if (!found) {
      return {
        args: out,
        error: result(false, `Unknown target "${raw}". Targets: ${TARGETS.join(', ')}`, {
          code: 'target-unknown',
          target: raw,
          targets: TARGETS,
        }),
      };
    }
    if (target) {
      return {
        args: out,
        error: result(false, `Duplicate target "${raw}" after "${targetToken}". Use exactly one target.`, {
          code: 'target-duplicate',
          first: target,
          duplicate: raw,
          targets: TARGETS,
        }),
      };
    }
    target = found;
    targetToken = raw;
  }
  return { args: out, target };
}

function resolveTarget(ctx: Ctx, args: string[], command: string): TargetedArgs {
  const parsed = parseTargetFlag(args);
  if (parsed.error) return { ok: false, result: parsed.error };

  const builderOpen = isBuilderOpen();
  const current = ctx.levels.current;
  const builderPlaytestActive = isBuilderPlaytestActive(ctx);
  const builderPlaytestRuntime = isBuilderPlaytestRuntime(ctx);
  let target = parsed.target;
  const explicit = target !== undefined;

  if (!target) {
    if (builderOpen) {
      return {
        ok: false,
        result: result(
          false,
          `${command} needs an explicit target while Builder Author is open: ${TARGETS.join(', ')}`,
          {
            code: 'target-ambiguous',
            command,
            targets: TARGETS,
            builderOpen: true,
          },
        ),
      };
    }
    target = ctx.state.mode === 'play' ? (builderPlaytestActive ? 'builder-playtest' : 'expedition') : 'sandbox';
  }

  if (target === 'builder-document') {
    return {
      ok: false,
      result: result(
        false,
        `${command} cannot mutate builder-document through raw ctx.world writes; use Builder commands/undo when that bridge exists.`,
        { code: 'target-blocked', command, target },
      ),
    };
  }
  if (target === 'builder-live-preview') {
    return {
      ok: false,
      result: result(false, `${command} cannot target builder-live-preview yet; the workspace live preview runtime does not exist.`, {
        code: 'target-unavailable',
        command,
        target,
      }),
    };
  }
  if (target === 'sandbox' && (ctx.state.mode !== 'build' || builderOpen)) {
    return {
      ok: false,
      result: result(false, `${command} target sandbox requires Sandbox with Builder closed.`, {
        code: 'target-inactive',
        command,
        target,
        mode: ctx.state.mode,
        builderOpen,
      }),
    };
  }
  if (target === 'expedition' && (ctx.state.mode !== 'play' || builderPlaytestActive)) {
    return {
      ok: false,
      result: result(false, `${command} target expedition requires normal Play, not Sandbox or Builder Playtest.`, {
        code: 'target-inactive',
        command,
        target,
        mode: ctx.state.mode,
        level: current?.def.id ?? null,
        playtestSource: ctx.state.playtestSource,
      }),
    };
  }
  if (target === 'builder-playtest' && !builderPlaytestRuntime) {
    return {
      ok: false,
      result: result(false, `${command} target builder-playtest requires an active Builder-owned disposable custom runtime.`, {
        code: 'target-inactive',
        command,
        target,
        mode: ctx.state.mode,
        level: current?.def.id ?? null,
        playtestSource: ctx.state.playtestSource,
      }),
    };
  }

  return { ok: true, args: parsed.args, target, explicit };
}

function resolveReadTarget(ctx: Ctx, args: string[], command: string): TargetedArgs {
  const parsed = parseTargetFlag(args);
  if (parsed.error) return { ok: false, result: parsed.error };

  const builderOpen = isBuilderOpen();
  const current = ctx.levels.current;
  const builderPlaytestActive = isBuilderPlaytestActive(ctx);
  const builderPlaytestRuntime = isBuilderPlaytestRuntime(ctx);
  let target = parsed.target;
  const explicit = target !== undefined;

  if (!target) {
    if (builderOpen) {
      return {
        ok: false,
        result: result(false, `${command} needs an explicit target while Builder Author is open: ${TARGETS.join(', ')}`, {
          code: 'target-ambiguous',
          command,
          targets: TARGETS,
          builderOpen: true,
        }),
      };
    }
    target = ctx.state.mode === 'play' ? (builderPlaytestActive ? 'builder-playtest' : 'expedition') : 'sandbox';
  }

  if (target === 'builder-document') {
    return {
      ok: false,
      result: result(false, `${command} cannot inspect builder-document yet; no Builder command/document adapter is registered.`, {
        code: 'target-unavailable',
        command,
        target,
      }),
    };
  }
  if (target === 'builder-live-preview') {
    return {
      ok: false,
      result: result(false, `${command} cannot inspect builder-live-preview yet; the workspace live preview runtime does not exist.`, {
        code: 'target-unavailable',
        command,
        target,
      }),
    };
  }
  if (target === 'sandbox' && builderOpen) {
    return {
      ok: false,
      result: result(false, `${command} cannot inspect sandbox while Builder Author is open; Builder needs a document/live-preview read adapter.`, {
        code: 'target-blocked',
        command,
        target,
        reason: 'builder-open',
        builderOpen: true,
      }),
    };
  }
  if (target === 'sandbox' && ctx.state.mode !== 'build') {
    return {
      ok: false,
      result: result(false, `${command} target sandbox requires Sandbox/Builder Author mode.`, {
        code: 'target-inactive',
        command,
        target,
        mode: ctx.state.mode,
        builderOpen,
      }),
    };
  }
  if (target === 'expedition' && (ctx.state.mode !== 'play' || builderPlaytestActive)) {
    return {
      ok: false,
      result: result(false, `${command} target expedition requires normal Play, not Sandbox or Builder Playtest.`, {
        code: 'target-inactive',
        command,
        target,
        mode: ctx.state.mode,
        level: current?.def.id ?? null,
        playtestSource: ctx.state.playtestSource,
      }),
    };
  }
  if (target === 'builder-playtest' && !builderPlaytestRuntime) {
    return {
      ok: false,
      result: result(false, `${command} target builder-playtest requires an active Builder-owned disposable custom runtime.`, {
        code: 'target-inactive',
        command,
        target,
        mode: ctx.state.mode,
        level: current?.def.id ?? null,
        playtestSource: ctx.state.playtestSource,
      }),
    };
  }

  return { ok: true, args: parsed.args, target, explicit };
}

function taintIfNeeded(ctx: Ctx, command: string, target: ConsoleTarget): string | null {
  if (!GAMEPLAY_TAINT_COMMANDS.has(command)) return null;
  if (target !== 'expedition') return null;
  if (ctx.state.debugGodMode) return null;
  ctx.state.debugGodMode = true;
  return 'DEBUG TAINT: expedition autosave is disabled for this run.';
}

function blockBuilderPlaytestPersistentState(command: string, target: ConsoleTarget): CommandResult | null {
  if (target !== 'builder-playtest') return null;
  return result(
    false,
    `${command} cannot target builder-playtest yet because player/progression state is not disposable.`,
    { code: 'target-blocked', command, target, reason: 'persistent-state' },
  );
}

function requireNoBuilderPlaytestPersistentState(command: string, target: ConsoleTarget): CommandResult | null {
  return blockBuilderPlaytestPersistentState(command, target);
}

function isBuilderPlaytestActive(ctx: Ctx): boolean {
  return ctx.state.mode === 'play' && ctx.state.playtestSource === 'builder';
}

function isBuilderPlaytestRuntime(ctx: Ctx): boolean {
  return isBuilderPlaytestActive(ctx) && ctx.levels.current?.def.id === 'custom';
}

function coordBase(ctx: Ctx, target: ConsoleTarget): { x: number; y: number } {
  if (target === 'sandbox') return { x: Math.floor(ctx.input.mouse.x), y: Math.floor(ctx.input.mouse.y) };
  return { x: Math.floor(ctx.player.x), y: Math.floor(ctx.player.y) };
}

function parseFiniteNumber(raw: string, label: string): number | CommandResult {
  const n = Number(raw);
  if (!Number.isFinite(n)) return result(false, `Expected ${label} to be a number, got "${raw}"`, { code: 'parse-number', label, raw });
  return n;
}

function parsePositiveInt(raw: string, label: string, max: number): number | CommandResult {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    return result(false, `Expected ${label} to be an integer from 1 to ${max}, got "${raw}"`, {
      code: 'parse-int',
      label,
      raw,
      max,
    });
  }
  return n;
}

export function resolveRelativeCoord(raw: string, base: number): number | CommandResult {
  if (raw === '~') return Math.floor(base);
  if (raw.startsWith('~')) {
    const delta = raw.slice(1);
    if (delta === '') return Math.floor(base);
    const n = Number(delta);
    if (!Number.isFinite(n)) {
      return result(false, `Expected relative coordinate like ~, ~12, or ~-12; got "${raw}"`, {
        code: 'parse-coordinate',
        raw,
      });
    }
    return Math.floor(base + n);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return result(false, `Expected coordinate number or ~ offset, got "${raw}"`, { code: 'parse-coordinate', raw });
  return Math.floor(n);
}

/** Shared body of the `crate`/`boulder` dev commands: drop N rigid bodies. */
function spawnRigidTest(ctx: Ctx, args: string[], kind: 'crate' | 'boulder'): CommandResult {
  const target = resolveTarget(ctx, args, kind);
  if (!target.ok) return target.result;
  // Pull optional material (wood/metal/stone) and size (small/large) tokens out.
  const MATERIALS: BodyMaterial[] = ['wood', 'metal', 'stone'];
  let material: BodyMaterial | undefined;
  let size: 'small' | 'large' | undefined;
  const rest = target.args.filter((a) => {
    if ((MATERIALS as string[]).includes(a)) {
      material = a as BodyMaterial;
      return false;
    }
    if (a === 'small' || a === 'large') {
      size = a;
      return false;
    }
    return true;
  });
  const mat: BodyMaterial = material ?? (kind === 'boulder' ? 'stone' : 'wood');
  const big = size === 'large';
  let n = 1;
  let coordAt = 0;
  if (rest.length === 1 || rest.length >= 3) {
    const parsedN = parsePositiveInt(rest[0], `${kind} count`, 32);
    if (typeof parsedN !== 'number') return parsedN;
    n = parsedN;
    coordAt = 1;
  }
  let x = Math.floor(ctx.player.x + ctx.player.facing * 18);
  let y = Math.floor(ctx.player.y - 30);
  if (rest.length - coordAt === 2) {
    const px = resolveRelativeCoord(rest[coordAt], ctx.player.x);
    if (typeof px !== 'number') return px;
    const py = resolveRelativeCoord(rest[coordAt + 1], ctx.player.y);
    if (typeof py !== 'number') return py;
    x = px;
    y = py;
  } else if (rest.length - coordAt !== 0) {
    return result(false, `Usage: ${kind} [n] [x y] [--target ...]`, { code: 'usage' });
  }
  const spacing = big ? 16 : 9;
  for (let i = 0; i < n; i++) {
    const ox = x + i * spacing;
    if (kind === 'boulder') ctx.rigidBodies.spawn({ kind: 'circle', radius: big ? 7 : 4 }, ox, y, { material: mat, restitution: 0.2, friction: 0.85 });
    else ctx.rigidBodies.spawn({ kind: 'box', halfW: big ? 6 : 3, halfH: big ? 6 : 3 }, ox, y, { material: mat, restitution: 0.2, friction: 0.6 });
  }
  return result(true, `Dropped ${n} ${big ? 'large ' : ''}${mat} ${kind}${n === 1 ? '' : 's'} at ${x},${y}.`, {
    target: target.target,
    requested: { x, y, n },
    live: ctx.rigidBodies.bodies.length,
  });
}

/**
 * Carve a self-contained rigid-body test arena into the world (two ramps, a
 * valley, a drop shelf) and populate it with boulders + crates, then drop the
 * player into the valley. A one-command physics demo for the `playground` cmd.
 */
function buildPlayground(ctx: Ctx): void {
  const w = ctx.world;
  const LEFT = 700;
  const RIGHT = 900;
  const TOP = 440;
  const FLOOR = 552;
  const BOTTOM = 560;
  const stamp = (x: number, y: number): void => {
    if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), Cell.Stone, COLOR_FN[Cell.Stone]());
  };
  const clear = (x: number, y: number): void => {
    if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
  };
  // Hollow the arena, lay the floor, raise the side walls.
  for (let x = LEFT; x <= RIGHT; x++) for (let y = TOP; y <= BOTTOM; y++) clear(x, y);
  for (let x = LEFT; x <= RIGHT; x++) for (let y = FLOOR; y <= BOTTOM; y++) stamp(x, y);
  for (let y = TOP; y <= FLOOR; y++) for (let d = 0; d < 4; d++) {
    stamp(LEFT + d, y);
    stamp(RIGHT - d, y);
  }
  // Left ramp descends to the right; right ramp descends to the left — a V that
  // funnels rolling boulders into the central valley (x 793..807, left clear).
  for (let x = LEFT + 12; x <= 792; x++) {
    const top = Math.round(468 + (x - (LEFT + 12)) * 0.72);
    for (let y = top; y <= FLOOR; y++) stamp(x, y);
  }
  for (let x = 808; x <= RIGHT - 12; x++) {
    const top = Math.round(468 + (RIGHT - 12 - x) * 0.72);
    for (let y = top; y <= FLOOR; y++) stamp(x, y);
  }
  // A shelf off the left wall to pile crates on (and let some tumble off).
  for (let x = LEFT + 6; x <= LEFT + 40; x++) for (let y = 478; y <= 480; y++) stamp(x, y);

  const rb = ctx.rigidBodies;
  rb.clear();
  // Boulders at the ramp tops — they roll down and collect in the valley.
  rb.spawn({ kind: 'circle', radius: 4 }, 718, 450, { friction: 0.9, restitution: 0.15, color: COLOR_FN[Cell.Stone]() });
  rb.spawn({ kind: 'circle', radius: 4 }, 882, 450, { friction: 0.9, restitution: 0.15, color: COLOR_FN[Cell.Stone]() });
  // Crates piled on the shelf.
  for (let i = 0; i < 3; i++) rb.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 712 + i * 8, 468, {});
  for (let i = 0; i < 2; i++) rb.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 716 + i * 8, 460, {});
  // Crates dropped above each ramp — they tumble down.
  rb.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 758, 440, {});
  rb.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 842, 440, {});

  // Drop the player into the clear valley with full headroom.
  const p = ctx.player;
  p.x = 800;
  p.y = 551;
  p.fx = 0;
  p.fy = 0;
  p.vx = 0;
  p.vy = 0;
  p.dead = false;
  p.crawling = false;
  p.climbing = false;
  p.diveT = 0;
  p.hp = p.maxHp;
  ctx.camera.snapTo(800, 500);
}

function cellNameEntries(ctx: Ctx): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const [name, value] of Object.entries(Cell)) {
    if (typeof value === 'number') out.push([name, value]);
  }
  for (let id = 0; id < CELL_COUNT; id++) {
    const name = ctx.params.materials[id]?.name;
    if (name) out.push([name, id]);
  }
  out.push(['eraser', Cell.Empty]);
  return out;
}

export function parseCellType(ctx: Ctx, raw: string): number | CommandResult {
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < CELL_COUNT) return numeric;
  const key = normalizeKey(raw);
  for (const [name, id] of cellNameEntries(ctx)) {
    if (normalizeKey(name) === key) return id;
  }
  return result(false, `Unknown material "${raw}"`, {
    code: 'parse-cell',
    raw,
    expected: cellNameEntries(ctx).map(([name]) => name).sort(),
  });
}

function cellSuggestions(ctx: Ctx, prefix: string): string[] {
  return matching(cellNameEntries(ctx).map(([name]) => normalizeKey(name)), prefix);
}

function parseEnemyKind(ctx: Ctx, raw: string): EnemyKind | CommandResult {
  const key = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ctx.enemyCtl.defs, key)) return key as EnemyKind;
  return result(false, `Unknown enemy kind "${raw}"`, {
    code: 'parse-enemy',
    raw,
    expected: Object.keys(ctx.enemyCtl.defs).sort(),
  });
}

function parseCardId(raw: string): keyof typeof CARD_DEFS | CommandResult {
  const key = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CARD_DEFS, key)) return key as keyof typeof CARD_DEFS;
  return result(false, `Unknown card "${raw}"`, { code: 'parse-card', raw, expected: Object.keys(CARD_DEFS).sort() });
}

function parsePerkId(raw: string): PerkId | CommandResult {
  const key = raw.toLowerCase();
  if (RUN_PERKS.includes(key as PerkId)) return key as PerkId;
  return result(false, `Unknown perk "${raw}"`, { code: 'parse-perk', raw, expected: RUN_PERKS });
}

function parseLevelId(raw: string): string | CommandResult {
  const key = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LEVELS, key)) return key;
  return result(false, `Unknown level "${raw}"`, { code: 'parse-level', raw, expected: Object.keys(LEVELS).sort() });
}

function findTeleportSpot(ctx: Ctx, x: number, y: number): { x: number; y: number; free: boolean } {
  const offsets = [0];
  for (let d = 1; d <= 24; d++) offsets.push(-d, d);
  for (const dy of offsets) {
    const ty = y + dy;
    if (ctx.physics.entityFree(x, ty, PLAYER_HALF_W, PLAYER_H)) return { x, y: ty, free: true };
  }
  return { x, y, free: false };
}

function paintDisc(ctx: Ctx, cx: number, cy: number, radius: number, type: number): { cells: number; bounds: { x0: number; y0: number; x1: number; y1: number } } {
  const world = ctx.world;
  const fn = COLOR_FN[type];
  let cells = 0;
  const bounds = {
    x0: Math.max(0, cx - radius),
    y0: Math.max(0, cy - radius),
    x1: Math.min(world.width - 1, cx + radius),
    y1: Math.min(world.height - 1, cy + radius),
  };
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = world.idx(x, y);
      world.types[i] = type;
      world.colors[i] = fn ? fn() : EMPTY_COLOR;
      world.life[i] = 0;
      world.charge[i] = 0;
      cells++;
    }
  }
  return { cells, bounds };
}

function normalizeBounds(x0: number, y0: number, x1: number, y1: number): Bounds {
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
}

function clipBounds(ctx: Ctx, bounds: Bounds): Bounds {
  return {
    x0: Math.max(0, bounds.x0),
    y0: Math.max(0, bounds.y0),
    x1: Math.min(ctx.world.width - 1, bounds.x1),
    y1: Math.min(ctx.world.height - 1, bounds.y1),
  };
}

function boundsArea(bounds: Bounds): number {
  return Math.max(0, bounds.x1 - bounds.x0 + 1) * Math.max(0, bounds.y1 - bounds.y0 + 1);
}

function paintRect(ctx: Ctx, bounds: Bounds, type: number): { cells: number; bounds: Bounds } {
  const world = ctx.world;
  const fn = COLOR_FN[type];
  const clipped = clipBounds(ctx, bounds);
  let cells = 0;
  if (clipped.x0 > clipped.x1 || clipped.y0 > clipped.y1) return { cells, bounds: clipped };
  for (let y = clipped.y0; y <= clipped.y1; y++) {
    for (let x = clipped.x0; x <= clipped.x1; x++) {
      const i = world.idx(x, y);
      world.types[i] = type;
      world.colors[i] = fn ? fn() : EMPTY_COLOR;
      world.life[i] = 0;
      world.charge[i] = 0;
      cells++;
    }
  }
  return { cells, bounds: clipped };
}

function parseWorldCoordPair(args: string[], base: { x: number; y: number }): { ok: true; x: number; y: number } | CommandResult {
  const x = resolveRelativeCoord(args[0], base.x);
  if (typeof x !== 'number') return x;
  const y = resolveRelativeCoord(args[1], base.y);
  if (typeof y !== 'number') return y;
  return { ok: true, x, y };
}

function materialName(ctx: Ctx, type: number): string {
  return ctx.params.materials[type]?.name ?? `cell ${type}`;
}

function dumpRegion(ctx: Ctx, x0: number, y0: number, w: number, h: number): {
  ascii: string[];
  types: Array<Array<number | null>>;
  legend: Array<{ char: string; id: number | null; name: string }>;
} {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const charByType = new Map<number | null, string>([
    [Cell.Empty, '.'],
    [null, '!'],
  ]);
  let nextChar = 0;
  const legendMap = new Map<string, { char: string; id: number | null; name: string }>([
    ['.', { char: '.', id: Cell.Empty, name: materialName(ctx, Cell.Empty) }],
    ['!', { char: '!', id: null, name: 'out of bounds' }],
  ]);
  const types: Array<Array<number | null>> = [];
  const ascii: string[] = [];

  for (let dy = 0; dy < h; dy++) {
    const typeRow: Array<number | null> = [];
    let line = '';
    for (let dx = 0; dx < w; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      const id = ctx.world.inBounds(x, y) ? ctx.world.types[ctx.world.idx(x, y)] : null;
      typeRow.push(id);
      let ch = charByType.get(id);
      if (!ch) {
        ch = chars[nextChar] ?? '?';
        nextChar++;
        charByType.set(id, ch);
        legendMap.set(ch, { char: ch, id, name: id === null ? 'out of bounds' : materialName(ctx, id) });
      }
      line += ch;
    }
    types.push(typeRow);
    ascii.push(line);
  }

  return { ascii, types, legend: [...legendMap.values()].filter((entry) => ascii.some((row) => row.includes(entry.char))) };
}

function countCellType(ctx: Ctx, type: number, bounds?: Bounds): { count: number; bounds: Bounds } {
  const world = ctx.world;
  const region = bounds ? clipBounds(ctx, bounds) : { x0: 0, y0: 0, x1: world.width - 1, y1: world.height - 1 };
  let count = 0;
  if (region.x0 > region.x1 || region.y0 > region.y1) return { count, bounds: region };
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      if (world.types[world.idx(x, y)] === type) count++;
    }
  }
  return { count, bounds: region };
}

function setSimSpeed(ctx: Ctx, value: number): CommandResult {
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    return result(false, `Expected sim speed from 0 to 2, got "${value}"`, { code: 'parse-range', min: 0, max: 2, value });
  }
  const oldValue = ctx.params.global.simSpeed;
  ctx.params.global.simSpeed = value;
  syncKnownParamInputs('global.simSpeed', value);
  return result(true, `global.simSpeed: ${oldValue} -> ${value}`, {
    path: 'global.simSpeed',
    oldValue,
    value,
    tainted: false,
  });
}

function setGpuCompose(ctx: Ctx, mode: string): CommandResult {
  const key = mode.toLowerCase();
  let value: boolean;
  if (key === 'toggle') value = !ctx.state.postFx.gpuCompose;
  else if (['on', 'true', '1', 'yes'].includes(key)) value = true;
  else if (['off', 'false', '0', 'no'].includes(key)) value = false;
  else return result(false, 'Usage: gpu <on|off|toggle>', { code: 'usage' });
  const oldValue = ctx.state.postFx.gpuCompose;
  ctx.state.postFx.gpuCompose = value;
  syncKnownParamInputs('postFx.gpuCompose', value);
  return result(true, `GPU compose ${value ? 'on' : 'off'}.`, { path: 'postFx.gpuCompose', oldValue, value, tainted: false });
}

function grantGold(ctx: Ctx, amount: number, target: ConsoleTarget): CommandResult {
  const taint = taintIfNeeded(ctx, 'gold', target);
  ctx.state.score += amount;
  ctx.events.emit('scoreChanged', { score: ctx.state.score });
  return result(true, `${taint ? taint + ' ' : ''}+${amount} gold.`, { target, amount, score: ctx.state.score, tainted: ctx.state.debugGodMode });
}

function healPlayer(ctx: Ctx, amount: number | null, target: ConsoleTarget): CommandResult {
  const taint = taintIfNeeded(ctx, 'heal', target);
  const oldHp = ctx.player.hp;
  const wasDead = ctx.player.dead;
  ctx.player.dead = false;
  ctx.player.hp = amount === null ? ctx.player.maxHp : Math.min(ctx.player.maxHp, ctx.player.hp + amount);
  if (wasDead) ctx.events.emit('playerRespawned');
  return result(true, `${taint ? taint + ' ' : ''}HP ${oldHp} -> ${ctx.player.hp}.`, {
    target,
    oldHp,
    hp: ctx.player.hp,
    maxHp: ctx.player.maxHp,
    wasDead,
    tainted: ctx.state.debugGodMode,
  });
}

function activePlayRuntime(ctx: Ctx): LevelRuntime | null {
  return ctx.state.mode === 'play' ? ctx.levels.current : null;
}

function runtimeForTarget(ctx: Ctx, target: ConsoleTarget, command: string): LevelRuntime | CommandResult {
  const runtime = ctx.levels.current;
  const builderPlaytestActive = isBuilderPlaytestActive(ctx);
  if (target === 'sandbox') {
    return result(false, `${command} target sandbox has no level-runtime metadata source.`, {
      code: 'runtime-unavailable',
      command,
      target,
    });
  }
  if (!runtime) {
    return result(false, `No active ${target} runtime to inspect.`, { code: 'runtime-missing', command, target });
  }
  if (target === 'expedition' && builderPlaytestActive) {
    return result(false, `${command} target expedition cannot inspect Builder Playtest runtime.`, {
      code: 'target-inactive',
      command,
      target,
      level: runtime.def.id,
      playtestSource: ctx.state.playtestSource,
    });
  }
  if (target === 'builder-playtest' && (!builderPlaytestActive || runtime.def.id !== 'custom')) {
    return result(false, `${command} target builder-playtest requires an active Builder-owned custom runtime.`, {
      code: 'target-inactive',
      command,
      target,
      level: runtime.def.id,
      playtestSource: ctx.state.playtestSource,
    });
  }
  return runtime;
}

function distanceSquared(ctx: Ctx, x: number, y: number): number {
  const dx = x - ctx.player.x;
  const dy = y - ctx.player.y;
  return dx * dx + dy * dy;
}

function nearestPickup(ctx: Ctx, pickups: Pickup[]): Pickup | null {
  let best: Pickup | null = null;
  let bestD2 = Infinity;
  for (const pickup of pickups) {
    if (pickup.taken) continue;
    const d2 = distanceSquared(ctx, pickup.x, pickup.y);
    if (d2 < bestD2) {
      best = pickup;
      bestD2 = d2;
    }
  }
  return best;
}

function nearestMechanism(ctx: Ctx, mechanisms: Mechanism[]): Mechanism | null {
  let best: Mechanism | null = null;
  let bestD2 = Infinity;
  for (const mechanism of mechanisms) {
    const d2 = distanceSquared(ctx, mechanism.x + mechanism.w / 2, mechanism.y + mechanism.h / 2);
    if (d2 < bestD2) {
      best = mechanism;
      bestD2 = d2;
    }
  }
  return best;
}

function perfWindow(): PerfWindow | null {
  if (typeof window === 'undefined') return null;
  return window as PerfWindow;
}

function browserWindow(): BrowserWindow | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  return window as BrowserWindow;
}

async function captureScreenshot(): Promise<CommandResult> {
  const w = browserWindow();
  if (!w) return result(false, 'screenshot requires the browser runtime.', { code: 'ui-unavailable' });
  await new Promise<void>((resolve) => w.requestAnimationFrame(() => resolve()));
  const source = document.querySelector<HTMLCanvasElement>('#canvas-holder canvas');
  if (!source || source.width <= 0 || source.height <= 0) {
    return result(false, 'No rendered canvas available for screenshot.', { code: 'canvas-unavailable' });
  }
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const g = out.getContext('2d');
  if (!g) return result(false, 'Unable to create screenshot canvas.', { code: 'canvas-unavailable' });
  g.drawImage(source, 0, 0);
  let nonBlankSamples = 0;
  let sampleHash = 2166136261;
  try {
    const image = g.getImageData(0, 0, out.width, out.height).data;
    const sampleX = Math.max(1, Math.floor(out.width / 16));
    const sampleY = Math.max(1, Math.floor(out.height / 16));
    for (let y = 0; y < out.height; y += sampleY) {
      for (let x = 0; x < out.width; x += sampleX) {
        const i = (y * out.width + x) * 4;
        const r = image[i] ?? 0;
        const green = image[i + 1] ?? 0;
        const b = image[i + 2] ?? 0;
        const a = image[i + 3] ?? 0;
        if (a !== 0 && (r !== 0 || green !== 0 || b !== 0)) nonBlankSamples++;
        sampleHash ^= r + (green << 8) + (b << 16) + (a << 24);
        sampleHash = Math.imul(sampleHash, 16777619) >>> 0;
      }
    }
  } catch (err) {
    return result(false, 'Unable to sample screenshot pixels.', {
      code: 'canvas-sample-unavailable',
      message: err instanceof Error ? err.message : String(err),
    });
  }
  if (nonBlankSamples === 0) {
    return result(false, 'Screenshot canvas appears blank.', {
      code: 'canvas-blank',
      width: out.width,
      height: out.height,
      sampleHash,
      nonBlankSamples,
    });
  }
  const dataUrl = out.toDataURL('image/png');
  return result(true, `screenshot ${out.width}x${out.height}`, {
    width: out.width,
    height: out.height,
    type: 'image/png',
    dataUrl,
    bytesApprox: Math.ceil((dataUrl.length * 3) / 4),
    nonBlankSamples,
    sampleHash,
  });
}

function summarizePerfSamples(samples: PerfSample[]): Record<PerfPhase, { min: number; max: number; avg: number }> {
  const phases: PerfPhase[] = ['sim', 'entities', 'render', 'compose', 'gl', 'frame'];
  const out = {} as Record<PerfPhase, { min: number; max: number; avg: number }>;
  for (const phase of phases) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const sample of samples) {
      const value = sample[phase] ?? 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    out[phase] = {
      min: samples.length > 0 ? min : 0,
      max: samples.length > 0 ? max : 0,
      avg: samples.length > 0 ? sum / samples.length : 0,
    };
  }
  return out;
}

function waitForPerfSamples(frames: number): Promise<PerfSample[]> {
  const w = perfWindow();
  if (!w) return Promise.resolve([]);
  w.__perfSamples = [];
  w.__perfRecord = true;
  const started = performance.now();
  return new Promise((resolve) => {
    const poll = (): void => {
      const samples = w.__perfSamples ?? [];
      if (samples.length >= frames || performance.now() - started > 5000) {
        w.__perfRecord = false;
        resolve(samples.slice(0, frames));
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

type ParamOwner = Record<string, unknown>;
type AssertionOp = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'includes';
interface ResolvedParamPath {
  owner: ParamOwner;
  key: string;
  current: unknown;
  canonical: string;
  allowed?: readonly string[];
}

interface ScriptExecutionRow {
  lineNumber: number;
  line: string;
  ok: boolean;
  text: string;
  data?: unknown;
}

function isCommandResult(value: unknown): value is CommandResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    'text' in value &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

function resolveParamPath(ctx: Ctx, path: string): ResolvedParamPath | CommandResult {
  const parts = path.split('.').filter(Boolean);
  if (parts.length < 2) return result(false, 'Expected parameter path like global.simSpeed or materials.lava.bloomWeight', { code: 'parse-param-path', path });
  if (parts[0] === 'global') {
    const owner = ctx.params.global as unknown as ParamOwner;
    const key = parts[1];
    if (!(key in owner)) return result(false, `Unknown global parameter "${key}"`, { code: 'parse-param-path', path });
    return { owner, key, current: owner[key], canonical: `global.${key}` };
  }
  if (parts[0] === 'materials' && parts.length >= 3) {
    const cell = parseCellType(ctx, parts[1]);
    if (typeof cell !== 'number') return cell;
    const owner = ctx.params.materials[cell] as unknown as ParamOwner | undefined;
    const key = parts[2];
    if (!owner || !(key in owner)) return result(false, `Unknown material parameter "${parts[1]}.${key}"`, { code: 'parse-param-path', path });
    return { owner, key, current: owner[key], canonical: `materials.${cell}.${key}` };
  }
  if (parts[0] === 'spells' && parts.length >= 3) {
    const key = parts[1] as keyof typeof ctx.params.spells;
    const owner = ctx.params.spells[key] as unknown as ParamOwner | undefined;
    const param = parts[2];
    if (!owner || !(param in owner)) return result(false, `Unknown spell parameter "${parts[1]}.${param}"`, { code: 'parse-param-path', path });
    return { owner, key: param, current: owner[param], canonical: `spells.${parts[1]}.${param}` };
  }
  if (parts[0] === 'postFx') {
    const owner = ctx.state.postFx as unknown as ParamOwner;
    const key = parts[1];
    if (!(key in owner)) return result(false, `Unknown postFx parameter "${key}"`, { code: 'parse-param-path', path });
    return { owner, key, current: owner[key], canonical: `postFx.${key}` };
  }
  if (parts[0] === 'render') {
    const owner = ctx.state.render as unknown as ParamOwner;
    const key = parts[1];
    if (!(key in owner)) return result(false, `Unknown render parameter "${key}"`, { code: 'parse-param-path', path });
    const allowed = key === 'backend' ? RENDER_BACKEND_MODES : undefined;
    return { owner, key, current: owner[key], canonical: `render.${key}`, allowed };
  }
  if (parts[0] === 'backdrop' && parts[1] === 'layers' && parts.length >= 4) {
    const owner = ctx.params.backdrop.layers[parts[2] as keyof typeof ctx.params.backdrop.layers] as unknown as ParamOwner | undefined;
    const key = parts[3];
    if (!owner || !(key in owner)) return result(false, `Unknown backdrop parameter "${parts.slice(1).join('.')}"`, { code: 'parse-param-path', path });
    return { owner, key, current: owner[key], canonical: `backdrop.layers.${parts[2]}.${key}` };
  }
  return result(false, `Unknown parameter path "${path}"`, { code: 'parse-param-path', path });
}

function parseParamValue(raw: string, current: unknown, allowed?: readonly string[]): unknown | CommandResult {
  if (allowed) {
    const key = raw.toLowerCase();
    if (allowed.includes(key)) return key;
    return result(false, `Expected one of ${allowed.join(', ')}, got "${raw}"`, {
      code: 'parse-param-value',
      raw,
      expected: allowed,
    });
  }
  if (typeof current === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return result(false, `Expected numeric value, got "${raw}"`, { code: 'parse-param-value', raw });
    return n;
  }
  if (typeof current === 'boolean') {
    const key = raw.toLowerCase();
    if (['true', 'on', '1', 'yes'].includes(key)) return true;
    if (['false', 'off', '0', 'no'].includes(key)) return false;
    return result(false, `Expected boolean value, got "${raw}"`, { code: 'parse-param-value', raw });
  }
  return raw;
}

function parseAssertionOp(raw: string): AssertionOp | CommandResult {
  if (raw === '=' || raw === '==' || raw === '===') return '==';
  if (raw === '!=' || raw === '!==') return '!=';
  if (raw === '>' || raw === '>=' || raw === '<' || raw === '<=') return raw;
  if (raw === 'contains' || raw === 'includes') return 'includes';
  return result(false, `Unknown assert operator "${raw}"`, {
    code: 'parse-assert-op',
    raw,
    expected: ['==', '!=', '>', '>=', '<', '<=', 'includes'],
  });
}

function compareAssertion(actual: unknown, op: AssertionOp, expected: unknown): boolean {
  if (op === '==') return Object.is(actual, expected);
  if (op === '!=') return !Object.is(actual, expected);
  if (op === 'includes') return String(actual).includes(String(expected));
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  if (op === '>') return actual > expected;
  if (op === '>=') return actual >= expected;
  if (op === '<') return actual < expected;
  return actual <= expected;
}

async function executeNamedScript(ctx: Ctx, nameRaw: string, stack: string[] = []): Promise<CommandResult> {
  const name = normalizeScriptName(nameRaw);
  if (!name) return result(false, 'Usage: exec <name>', { code: 'usage' });
  const scripts = loadConsoleScripts();
  const body = scripts[name];
  if (body === undefined) {
    return result(false, `No console script named "${name}".`, {
      code: 'script-missing',
      name,
      scripts: Object.keys(scripts).sort(),
    });
  }

  if (stack.length >= SCRIPT_MAX_DEPTH) {
    return result(false, `Script recursion depth exceeded while running "${name}".`, {
      code: 'script-depth',
      name,
      maxDepth: SCRIPT_MAX_DEPTH,
      stack,
    });
  }
  if (stack.includes(name)) {
    return result(false, `Script recursion cycle: ${[...stack, name].join(' -> ')}`, {
      code: 'script-cycle',
      name,
      stack: [...stack, name],
    });
  }

  const commands = parseScriptLines(body);
  const rows: ScriptExecutionRow[] = [];
  const nextStack = [...stack, name];
  for (const command of commands) {
    const parsed = parseConsoleLine(command.line);
    const nested =
      parsed && (parsed.name === 'exec' || parsed.name === 'run') && parsed.args.length === 1
        ? await executeNamedScript(ctx, parsed.args[0], nextStack)
        : null;
    const res = nested ?? (await ctx.console.exec(command.line));
    const row: ScriptExecutionRow = {
      lineNumber: command.lineNumber,
      line: command.line,
      ok: res.ok,
      text: res.text,
    };
    if (res.data !== undefined) row.data = res.data;
    rows.push(row);
    if (!res.ok) {
      return result(false, `script ${name} failed at line ${command.lineNumber}: ${res.text}`, {
        code: 'script-failed',
        name,
        lineNumber: command.lineNumber,
        line: command.line,
        commands: commands.length,
        results: rows,
      });
    }
  }

  return result(true, `script ${name} completed (${rows.length} command${rows.length === 1 ? '' : 's'}).`, {
    code: 'script-complete',
    name,
    commands: commands.length,
    results: rows,
  });
}

function paramSuggestions(ctx: Ctx, prefix: string): string[] {
  const paths: string[] = [
    ...Object.keys(ctx.params.global).map((k) => `global.${k}`),
    ...Object.keys(ctx.state.postFx).map((k) => `postFx.${k}`),
    ...Object.keys(ctx.state.render).map((k) => `render.${k}`),
  ];
  for (let id = 0; id < CELL_COUNT; id++) {
    const material = ctx.params.materials[id];
    if (!material) continue;
    const name = normalizeKey(material.name);
    for (const key of Object.keys(material)) paths.push(`materials.${name}.${key}`, `materials.${id}.${key}`);
  }
  for (const [spell, params] of Object.entries(ctx.params.spells)) {
    for (const key of Object.keys(params)) paths.push(`spells.${spell}.${key}`);
  }
  for (const [layer, params] of Object.entries(ctx.params.backdrop.layers)) {
    for (const key of Object.keys(params)) paths.push(`backdrop.layers.${layer}.${key}`);
  }
  return matching(paths, prefix);
}

function syncKnownParamInputs(path: string, value: unknown): void {
  if (typeof document === 'undefined') return;
  const text = typeof value === 'number' ? String(value) : String(value);
  if (path === 'global.simSpeed') {
    const input = document.getElementById('g-speed') as HTMLInputElement | null;
    const readout = document.getElementById('g-speed-value');
    if (input) input.value = text;
    if (readout && typeof value === 'number') readout.textContent = value.toFixed(1) + 'x';
  }
  if (path === 'postFx.gpuCompose') {
    const input = document.getElementById('post-gpu-compose') as HTMLInputElement | null;
    const button = document.getElementById('gpu-compose-toggle');
    if (input && typeof value === 'boolean') input.checked = value;
    button?.classList.toggle('lit', value === true);
  }
}

function commandTargetCompletions(req: CompletionRequest): string[] {
  const token = currentToken(req);
  if (token.startsWith('@')) return matching(TARGETS.map((t) => '@' + t), token);
  if (req.args.includes('--target')) return matching(TARGETS, token);
  if (token.startsWith('--target=')) return matching(TARGETS.map((t) => '--target=' + t), token);
  if (token.startsWith('--')) return ['--target'];
  return [];
}

function grantGodFlasks(ctx: Ctx): void {
  ctx.flask.clearSlots();
  GOD_FLASKS.forEach((flask, index) => ctx.flask.setSlot(index, flask.material, flask.count));
  ctx.flask.selectSlot(0);
}

function normalizeRunWorldSource(raw: string): 'campaign' | 'campaign-level' | 'virtual-world' | CommandResult {
  const key = raw.toLowerCase();
  if (key === 'campaign' || key === 'descent' || key === 'progression') return 'campaign';
  if (key === 'campaign-level' || key === 'level' || key === 'current') return 'campaign-level';
  if (key === 'virtual' || key === 'virtual-world' || key === 'chunked') return 'virtual-world';
  return result(false, `Unknown run world "${raw}".`, {
    code: 'parse-run-world',
    raw,
    expected: ['campaign', 'campaign-level', 'virtual-world'],
  });
}

function isParsedRunOptions(parsed: ParsedRunOptions | CommandResult): parsed is ParsedRunOptions {
  return parsed.ok === true && !('text' in parsed);
}

function parseRunList(raw: string): string[] {
  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

function parseRunNumber(raw: string, name: string, min: number, max: number): number | CommandResult {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return result(false, `Expected ${name} to be an integer from ${min} to ${max}, got "${raw}"`, {
      code: 'parse-run-number',
      raw,
      name,
      min,
      max,
    });
  }
  return n;
}

function parseRunFlaskSpec(ctx: Ctx, raw: string): FlaskSlotConfig | CommandResult {
  const [rawMaterial, rawCount] = raw.split(':', 2);
  if (!rawMaterial) return result(false, 'Usage: flask spec must be <empty|material[:count]>', { code: 'usage' });
  let material: number | null;
  if (rawMaterial.toLowerCase() === 'empty' || rawMaterial.toLowerCase() === 'none') {
    material = null;
  } else {
    const parsed = parseCellType(ctx, rawMaterial);
    if (typeof parsed !== 'number') return parsed;
    material = parsed;
  }
  const count = rawCount === undefined
    ? material === null ? 0 : 600
    : parseRunNumber(rawCount, 'flask count', 0, 600);
  if (typeof count !== 'number') return count;
  if (material === null && count > 0) {
    return result(false, 'Empty flask cannot have cells.', { code: 'run-empty-flask-with-cells', flaskCount: count });
  }
  return { material, count };
}

function parseRunOptions(ctx: Ctx, args: string[]): ParsedRunOptions | CommandResult {
  let levelId: string | undefined;
  let seed: number | undefined;
  let loadout: 'fresh' | 'advanced' | 'review' | undefined;
  let worldSource: 'campaign' | 'campaign-level' | 'virtual-world' | undefined;
  let flaskMaterial: number | null | undefined;
  let flaskCount: number | undefined;
  let flaskSlots: FlaskSlotConfig[] | undefined;
  let activeFlaskIndex: number | undefined;
  let hasTestOnlySetup = false;
  const kit: RunTestKitConfig = {};

  const readValue = (arg: string, i: number): { value?: string; next: number } => {
    const eq = arg.indexOf('=');
    if (eq >= 0) return { value: arg.slice(eq + 1), next: i };
    return { value: args[i + 1], next: i + 1 };
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--level' || arg.startsWith('--level=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --level <id>', { code: 'usage' });
      const id = parseLevelId(parsed.value);
      if (typeof id !== 'string') return id;
      levelId = id;
      i = parsed.next;
      continue;
    }
    if (arg === '--seed' || arg.startsWith('--seed=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --seed <uint32>', { code: 'usage' });
      const n = parseRunNumber(parsed.value, 'seed', 0, 0xffffffff);
      if (typeof n !== 'number') return n;
      seed = n >>> 0;
      i = parsed.next;
      continue;
    }
    if (arg === '--loadout' || arg.startsWith('--loadout=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --loadout <fresh|advanced|review>', { code: 'usage' });
      const key = parsed.value.toLowerCase();
      if (!RUN_LOADOUTS.includes(key as (typeof RUN_LOADOUTS)[number])) {
        return result(false, `Unknown loadout "${parsed.value}".`, {
          code: 'parse-loadout',
          raw: parsed.value,
          expected: RUN_LOADOUTS,
        });
      }
      loadout = key as 'fresh' | 'advanced' | 'review';
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    if (arg === '--world' || arg.startsWith('--world=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --world <campaign|campaign-level|virtual-world>', { code: 'usage' });
      const source = normalizeRunWorldSource(parsed.value);
      if (typeof source !== 'string') return source;
      worldSource = source;
      i = parsed.next;
      continue;
    }
    if (arg === '--gold' || arg.startsWith('--gold=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --gold <amount>', { code: 'usage' });
      const n = parseRunNumber(parsed.value, 'gold', 0, 999999);
      if (typeof n !== 'number') return n;
      kit.gold = n;
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    if (arg === '--hp' || arg.startsWith('--hp=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --hp <amount>', { code: 'usage' });
      const n = parseRunNumber(parsed.value, 'hp', 1, 9999);
      if (typeof n !== 'number') return n;
      kit.hp = n;
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    if (arg === '--max-hp' || arg.startsWith('--max-hp=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --max-hp <amount>', { code: 'usage' });
      const n = parseRunNumber(parsed.value, 'max-hp', 1, 9999);
      if (typeof n !== 'number') return n;
      kit.maxHp = n;
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    if (arg === '--levit' || arg === '--max-levit' || arg.startsWith('--levit=') || arg.startsWith('--max-levit=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --levit <amount>', { code: 'usage' });
      const n = parseRunNumber(parsed.value, 'levit', 1, 9999);
      if (typeof n !== 'number') return n;
      kit.maxLevit = n;
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    if (arg === '--cards' || arg.startsWith('--cards=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --cards <all|card,card,...>', { code: 'usage' });
      if (parsed.value.toLowerCase() === 'all') {
        kit.cards = [...ALL_CARD_IDS];
      } else {
        const cards: CardId[] = [];
        for (const raw of parseRunList(parsed.value)) {
          const card = parseCardId(raw);
          if (typeof card !== 'string') return card;
          cards.push(card as CardId);
        }
        kit.cards = cards;
      }
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    if (arg === '--perks' || arg.startsWith('--perks=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --perks <all|perk,perk,...>', { code: 'usage' });
      if (parsed.value.toLowerCase() === 'all') {
        kit.perks = [...RUN_PERKS];
      } else {
        const perks: PerkId[] = [];
        for (const raw of parseRunList(parsed.value)) {
          const perk = parsePerkId(raw);
          if (typeof perk !== 'string') return perk;
          perks.push(perk);
        }
        kit.perks = perks;
      }
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    if (arg === '--flask' || arg.startsWith('--flask=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --flask <empty|material[:count]>', { code: 'usage' });
      const [rawMaterial, rawCount] = parsed.value.split(':', 2);
      if (rawMaterial.toLowerCase() === 'empty' || rawMaterial.toLowerCase() === 'none') {
        flaskMaterial = null;
      } else {
        const material = parseCellType(ctx, rawMaterial);
        if (typeof material !== 'number') return material;
        flaskMaterial = material;
      }
      if (rawCount !== undefined) {
        const n = parseRunNumber(rawCount, 'flask count', 0, 600);
        if (typeof n !== 'number') return n;
        flaskCount = n;
      }
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    if (arg === '--flasks' || arg.startsWith('--flasks=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --flasks <slot1,slot2,...> where each slot is empty or material[:count]', { code: 'usage' });
      const specs = parseRunList(parsed.value);
      if (specs.length > FLASK_SLOT_COUNT) {
        return result(false, `Expected at most ${FLASK_SLOT_COUNT} flask slots, got ${specs.length}`, {
          code: 'run-flask-slot-count',
          slots: specs.length,
          max: FLASK_SLOT_COUNT,
        });
      }
      flaskSlots = [];
      for (const spec of specs) {
        const flask = parseRunFlaskSpec(ctx, spec);
        if ('ok' in flask) return flask;
        flaskSlots.push(flask);
      }
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    if (arg === '--active-flask' || arg.startsWith('--active-flask=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --active-flask <1-4>', { code: 'usage' });
      const n = parseRunNumber(parsed.value, 'active flask', 1, FLASK_SLOT_COUNT);
      if (typeof n !== 'number') return n;
      activeFlaskIndex = n - 1;
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    if (arg === '--flask-count' || arg.startsWith('--flask-count=')) {
      const parsed = readValue(arg, i);
      if (!parsed.value) return result(false, 'Usage: --flask-count <cells>', { code: 'usage' });
      const n = parseRunNumber(parsed.value, 'flask count', 0, 600);
      if (typeof n !== 'number') return n;
      flaskCount = n;
      hasTestOnlySetup = true;
      i = parsed.next;
      continue;
    }
    return result(false, `Unknown run option "${arg}".`, {
      code: 'usage',
      usage: 'run <status|continue|new|test|save|abandon> [--level id] [--seed n] [--loadout preset] [--world source] [--gold n] [--cards list] [--perks list]',
    });
  }

  if (flaskCount !== undefined && flaskMaterial === undefined) {
    return result(false, '--flask-count requires --flask <material|empty>.', {
      code: 'run-flask-count-without-material',
      flaskCount,
    });
  }
  if (flaskMaterial === null && flaskCount !== undefined && flaskCount > 0) {
    return result(false, 'Empty flask cannot have cells. Use --flask empty or --flask <material>:<count>.', {
      code: 'run-empty-flask-with-cells',
      flaskCount,
    });
  }
  if (flaskSlots) {
    kit.flasks = flaskSlots;
  } else if (flaskMaterial !== undefined || flaskCount !== undefined) {
    kit.flask = { material: flaskMaterial ?? null, count: flaskCount ?? (flaskMaterial === null ? 0 : 600) };
  }
  if (activeFlaskIndex !== undefined) kit.activeFlaskIndex = activeFlaskIndex;
  return {
    ok: true,
    levelId,
    seed,
    loadout,
    worldSource,
    kit: Object.keys(kit).length > 0 ? kit : undefined,
    hasTestOnlySetup,
  };
}

function runCommandCompletions(req: CompletionRequest): string[] {
  const token = currentToken(req);
  if (req.completingArg === 0) return matching(RUN_SUBCOMMANDS, token);
  const prev = req.args[req.args.length - 2];
  if (prev === '--level') return matching(Object.keys(LEVELS), token);
  if (prev === '--loadout') return matching(RUN_LOADOUTS, token);
  if (prev === '--world') return matching(RUN_WORLD_SOURCES, token);
  if (prev === '--cards') return matching(['all', ...Object.keys(CARD_DEFS)], token);
  if (prev === '--perks') return matching(['all', ...RUN_PERKS], token);
  if (prev === '--flask') return matching(['empty', 'water', 'acid', 'lava', 'oil'], token);
  if (prev === '--flasks') return matching(['water:600', 'water:450,acid:200', 'empty,water:300'], token);
  if (prev === '--active-flask') return matching(['1', '2', '3', '4'], token);
  if (token.startsWith('--level=')) return matching(Object.keys(LEVELS).map((id) => '--level=' + id), token);
  if (token.startsWith('--loadout=')) return matching(RUN_LOADOUTS.map((id) => '--loadout=' + id), token);
  if (token.startsWith('--world=')) return matching(RUN_WORLD_SOURCES.map((id) => '--world=' + id), token);
  if (token.startsWith('--cards=')) return matching(['--cards=all', ...Object.keys(CARD_DEFS).map((id) => '--cards=' + id)], token);
  if (token.startsWith('--perks=')) return matching(['--perks=all', ...RUN_PERKS.map((id) => '--perks=' + id)], token);
  if (token.startsWith('--flask=')) return matching(['--flask=empty', '--flask=water:600', '--flask=acid:300', '--flask=lava:300', '--flask=oil:300'], token);
  if (token.startsWith('--')) {
    return matching([
      '--level',
      '--seed',
      '--loadout',
      '--world',
      '--gold',
      '--hp',
      '--max-hp',
      '--levit',
      '--cards',
      '--perks',
      '--flask',
      '--flask-count',
      '--flasks',
      '--active-flask',
    ], token);
  }
  return [];
}

export function createConsoleApi(ctx: Ctx): ConsoleApi {
  const definitions: ConsoleCommandDefinition[] = [];
  const add = (def: ConsoleCommandDefinition): void => {
    definitions.push(def);
  };

  add({
    name: 'help',
    aliases: ['?'],
    info: info('console.help', 'Help', 'help [command]', 'List commands or show one command signature.'),
    run: (_ctx, args) => {
      if (args.length > 0) {
        const q = args[0].toLowerCase();
        const found = definitions.find((d) => d.name === q || d.aliases?.includes(q) || d.info.id === q);
        if (!found) return result(false, `No help for "${args[0]}"`, { code: 'help-missing', query: args[0] });
        return result(true, `${found.info.usage} - ${found.info.description}`, { command: found.info });
      }
      const lines = definitions.map((d) => d.info.usage).join(' | ');
      return result(true, lines, { commands: definitions.map((d) => d.info) });
    },
    complete: (_ctx, req) => matching(definitions.map((d) => d.name), currentToken(req)),
  });

  add({
    name: 'clear',
    info: info('console.clear', 'Clear Log', 'clear', 'Clear the visible console scrollback.'),
    run: () => result(true, 'Console cleared.', { action: 'clearLog' }),
  });

  add({
    name: 'exec',
    aliases: ['run'],
    info: info('console.exec', 'Run Script', 'exec <name>', 'Run a named localStorage console script with fail-fast results.'),
    run: async (ctx, args) => {
      if (args.length !== 1) return result(false, 'Usage: exec <name>', { code: 'usage' });
      return executeNamedScript(ctx, args[0]);
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(scriptNames(), currentToken(req)) : []),
  });

  add({
    name: 'assert',
    info: info('console.assert', 'Assert Param', 'assert <paramPath> <op> <value>', 'Compare a live parameter path for script gating.'),
    run: (ctx, args) => {
      if (args.length !== 3) return result(false, 'Usage: assert <paramPath> <op> <value>', { code: 'usage' });
      const resolved = resolveParamPath(ctx, args[0]);
      if (isCommandResult(resolved)) return resolved;
      const op = parseAssertionOp(args[1]);
      if (isCommandResult(op)) return op;
      const expected = parseParamValue(args[2], resolved.current, resolved.allowed);
      if (isCommandResult(expected)) return expected;
      const pass = compareAssertion(resolved.current, op, expected);
      return result(pass, `assert ${resolved.canonical} ${op} ${String(expected)} ${pass ? 'passed' : `failed (actual ${String(resolved.current)})`}`, {
        code: pass ? 'assert-pass' : 'assert-fail',
        path: resolved.canonical,
        op,
        expected,
        actual: resolved.current,
      });
    },
    complete: (ctx, req) => {
      if (req.completingArg === 0) return paramSuggestions(ctx, currentToken(req));
      if (req.completingArg === 1) return matching(['==', '!=', '>', '>=', '<', '<=', 'includes'], currentToken(req));
      return [];
    },
  });

  add({
    name: 'watch',
    info: info('console.watch', 'Watch Param', 'watch <paramPath>|list|clear', 'Pin live parameter values to the console watch HUD.'),
    run: (ctx, args) => {
      if (args.length !== 1) return result(false, 'Usage: watch <paramPath>|list|clear', { code: 'usage' });
      const key = args[0].toLowerCase();
      if (key === 'list') {
        const watches = loadConsoleWatches();
        saveConsoleWatches(watches);
        return result(true, watches.length ? `watches: ${watches.join(', ')}` : 'watches: none', { watches });
      }
      if (key === 'clear') {
        saveConsoleWatches([]);
        return result(true, 'watches cleared.', { action: 'watch', watches: [] });
      }
      const resolved = resolveParamPath(ctx, args[0]);
      if (isCommandResult(resolved)) return resolved;
      const watches = loadConsoleWatches();
      const existing = watches.includes(resolved.canonical);
      const next = existing ? watches.filter((path) => path !== resolved.canonical) : [...watches, resolved.canonical];
      saveConsoleWatches(next);
      return result(true, `${existing ? 'unwatched' : 'watching'} ${resolved.canonical}`, {
        action: 'watch',
        path: resolved.canonical,
        watching: !existing,
        value: resolved.current,
        watches: next.sort(),
      });
    },
    complete: (ctx, req) => {
      if (req.completingArg === 0) return [...matching(['list', 'clear'], currentToken(req)), ...paramSuggestions(ctx, currentToken(req))];
      return [];
    },
  });

  add({
    name: 'bind',
    info: info('console.bind', 'Bind Command', 'bind <F4-F10|F12> <command...>|clear|list', 'Bind console commands to transitional F-key shortcuts.'),
    run: (_ctx, args) => {
      if (args.length === 1 && args[0].toLowerCase() === 'list') {
        const binds = loadConsoleBinds();
        saveConsoleBinds(binds);
        const lines = Object.entries(binds).map(([key, command]) => `${key}=${command}`);
        return result(true, lines.length ? `binds: ${lines.join(' ')}` : 'binds: none', { binds });
      }
      if (args.length < 2) return result(false, 'Usage: bind <F4-F10|F12> <command...>|clear|list', { code: 'usage' });
      const key = normalizeBindKey(args[0]);
      if (!key) {
        return result(false, 'Binds are limited to F4-F10 and F12 during the transitional console phase.', {
          code: 'bind-key-invalid',
          key: args[0],
          allowed: ['F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F12'],
        });
      }
      const binds = loadConsoleBinds();
      const command = args.slice(1).join(' ').trim();
      if (command.toLowerCase() === 'clear') {
        delete binds[key];
        saveConsoleBinds(binds);
        return result(true, `${key} unbound.`, { action: 'bind', key, command: null, binds });
      }
      const parsed = parseConsoleLine(command);
      if (!parsed) return result(false, 'Bind command cannot be empty.', { code: 'usage' });
      binds[key] = command;
      saveConsoleBinds(binds);
      return result(true, `${key} -> ${command}`, { action: 'bind', key, command, binds });
    },
    complete: (_ctx, req) => {
      if (req.completingArg === 0) return matching(['list', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F12'], currentToken(req));
      if (req.completingArg === 1) return matching(['clear'], currentToken(req));
      return [];
    },
  });

  add({
    name: 'run',
    aliases: ['expedition'],
    info: info(
      'game.run',
      'Run Control',
      'run <status|continue|new|test|save|abandon> [--level id] [--seed n] [--world campaign|campaign-level|virtual-world] [test-only: --loadout preset --gold n --cards all|id,id --perks all|id,id --flask material:count --flasks slot1,slot2 --active-flask 1-4]',
      'Canonical start/reset/save/test-run workflow for expeditions.',
      'game',
    ),
    run: (ctx, args) => {
      const sub = (args[0] ?? 'status').toLowerCase();
      if (sub === 'status') {
        const status = ctx.levels.runStatus(ctx);
        const level = status.level ? `${status.level.id} ${status.level.name}` : 'none';
        const blocked = status.autosaveBlockReason ? ` block=${status.autosaveBlockReason}` : '';
        return result(true, `mode=${status.mode} level=${level} seed=${status.worldSeed} save=${status.savedExpedition ? 'yes' : 'no'} autosave=${status.autosaveEnabled ? 'on' : 'off'}${blocked}`, {
          action: 'status',
          ...status,
        });
      }
      if (sub === 'abandon') {
        ctx.levels.abandonExpedition();
        return result(true, 'Saved expedition abandoned. Use `run new` to reset the live run too.', {
          action: 'abandon',
          status: ctx.levels.runStatus(ctx),
        });
      }
      if (sub === 'save') {
        const status = ctx.levels.runStatus(ctx);
        if (!status.autosaveEnabled) {
          return result(false, 'Current run is disposable or debug-tainted; it will not be saved.', {
            code: 'save-disabled',
            action: 'save',
            status,
          });
        }
        ctx.levels.saveExpedition(ctx);
        return result(true, 'Expedition saved.', { action: 'save', status: ctx.levels.runStatus(ctx) });
      }
      if (sub === 'continue' || sub === 'resume') {
        ctx.audio.ensure();
        const started = ctx.levels.startRun(ctx, { mode: 'normal', worldSource: 'campaign', continueSave: true });
        return result(started.ok, started.message, { action: 'continue', run: started, status: ctx.levels.runStatus(ctx) });
      }
      if (sub === 'new' || sub === 'fresh' || sub === 'test') {
        const parsed = parseRunOptions(ctx, args.slice(1));
        if (!isParsedRunOptions(parsed)) return parsed;
        const test = sub === 'test';
        if (!test && parsed.hasTestOnlySetup) {
          return result(false, 'Loadout and granular kit options are Test Run-only. Use `run test ...` for disposable setup.', {
            code: 'run-kit-test-only',
            action: 'new',
          });
        }
        const worldSource = parsed.worldSource ?? (parsed.levelId ? 'campaign-level' : 'campaign');
        ctx.audio.ensure();
        const started = ctx.levels.startRun(ctx, {
          mode: test ? 'test' : 'normal',
          worldSource,
          levelId: parsed.levelId,
          seed: parsed.seed,
          loadout: parsed.loadout ?? (test ? 'advanced' : 'fresh'),
          kit: parsed.kit,
          continueSave: false,
        });
        return result(started.ok, started.message, {
          action: test ? 'test' : 'new',
          run: started,
          status: ctx.levels.runStatus(ctx),
        });
      }
      return result(false, 'Usage: run <status|continue|new|test|save|abandon> [--level id] [--seed n] [--loadout preset] [--world source] [--gold n] [--cards list] [--perks list]', {
        code: 'usage',
        subcommand: sub,
      });
    },
    complete: (_ctx, req) => runCommandCompletions(req),
  });

  add({
    name: 'god',
    info: info('game.god', 'God Kit', 'god [--target expedition]', 'Grant every debug capability, card, perk, and potion.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'god');
      if (!target.ok) return target.result;
      const blocked = blockBuilderPlaytestPersistentState('god', target.target);
      if (blocked) return blocked;
      if (target.target !== 'expedition') {
        return result(false, 'god requires expedition target.', { code: 'target-invalid', target: target.target });
      }
      ctx.audio.ensure();
      if (ctx.levels.current === null) ctx.levels.startDescent(ctx);
      const wasDead = ctx.player.dead;
      const alreadyTainted = ctx.state.debugGodMode;
      ctx.state.debugGodMode = true;
      ctx.player.dead = false;
      grantFullReviewKit(ctx.player);
      ctx.player.invuln = Math.max(ctx.player.invuln, 90);
      ctx.wands.grantReviewLoadout();
      grantGodFlasks(ctx);
      ctx.levels.seedReviewKit(ctx);
      if (wasDead) ctx.events.emit('playerRespawned');
      ctx.events.emit('toast', { text: alreadyTainted ? 'GOD MODE REFRESHED' : 'GOD MODE ENABLED' });
      return result(true, alreadyTainted ? 'God mode refreshed.' : 'God mode enabled. Expedition autosave is disabled.', {
        target: target.target,
        tainted: true,
        wasDead,
        hp: ctx.player.hp,
        maxHp: ctx.player.maxHp,
        cards: ctx.wands.collection.length,
        wands: ctx.wands.wands.map((wand) => ({ frameId: wand.frame.id, cards: wand.cards })),
        flasks: ctx.flask.slots.map((slot) => ({ material: slot.material, count: slot.count })),
        activeFlaskIndex: ctx.flask.activeIndex,
        perks: Object.keys(ctx.player.perks).sort(),
      });
    },
    complete: (_ctx, req) => commandTargetCompletions(req),
  });

  add({
    name: 'tp',
    aliases: ['teleport'],
    info: info('game.tp', 'Teleport', 'tp <x|~> <y|~> [--target ...]', 'Move the player with a 17-cell headroom check.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'tp');
      if (!target.ok) return target.result;
      if (target.args.length !== 2) return result(false, 'Usage: tp <x|~> <y|~> [--target ...]', { code: 'usage', usage: 'tp <x> <y>' });
      const x = resolveRelativeCoord(target.args[0], ctx.player.x);
      if (typeof x !== 'number') return x;
      const y = resolveRelativeCoord(target.args[1], ctx.player.y);
      if (typeof y !== 'number') return y;
      const spot = findTeleportSpot(ctx, x, y);
      if (!spot.free) {
        return result(false, `No player headroom within 24 cells of ${x},${y}`, {
          code: 'tp-blocked',
          requested: { x, y },
          halfW: PLAYER_HALF_W,
          height: PLAYER_H,
        });
      }
      const taint = taintIfNeeded(ctx, 'tp', target.target);
      ctx.player.x = spot.x;
      ctx.player.y = spot.y;
      ctx.player.vx = 0;
      ctx.player.vy = 0;
      ctx.player.fx = 0;
      ctx.player.fy = 0;
      ctx.camera.snapTo(spot.x, spot.y);
      return result(true, `${taint ? taint + ' ' : ''}Teleported to ${spot.x},${spot.y}.`, {
        target: target.target,
        requested: { x, y },
        resolved: spot,
        tainted: ctx.state.debugGodMode,
      });
    },
    complete: (_ctx, req) => commandTargetCompletions(req),
  });

  add({
    name: 'spawn',
    info: info('game.spawn', 'Spawn Enemy', 'spawn <kind> [n] [x y] [--target ...]', 'Spawn up to 32 enemies through enemyCtl.spawn.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'spawn');
      if (!target.ok) return target.result;
      if (target.args.length < 1) return result(false, 'Usage: spawn <kind> [n] [x y] [--target ...]', { code: 'usage' });
      const kind = parseEnemyKind(ctx, target.args[0]);
      if (typeof kind !== 'string') return kind;
      const rest = target.args.slice(1);
      let n = 1;
      let coordAt = 0;
      if (rest.length === 1 || rest.length >= 3) {
        const parsedN = parsePositiveInt(rest[0], 'spawn count', 32);
        if (typeof parsedN !== 'number') return parsedN;
        n = parsedN;
        coordAt = 1;
      }
      let x = Math.floor(ctx.player.x + ctx.player.facing * 24);
      let y = Math.floor(ctx.player.y);
      if (rest.length - coordAt === 2) {
        const px = resolveRelativeCoord(rest[coordAt], ctx.player.x);
        if (typeof px !== 'number') return px;
        const py = resolveRelativeCoord(rest[coordAt + 1], ctx.player.y);
        if (typeof py !== 'number') return py;
        x = px;
        y = py;
      } else if (rest.length - coordAt !== 0) {
        return result(false, 'Usage: spawn <kind> [n] [x y] [--target ...]', { code: 'usage' });
      }
      const taint = taintIfNeeded(ctx, 'spawn', target.target);
      const before = ctx.enemies.length;
      for (let i = 0; i < n; i++) ctx.enemyCtl.spawn(kind, x + i * 3, y);
      const spawned = ctx.enemies.slice(before).map((e, i) => ({ index: before + i, kind: e.kind, x: e.x, y: e.y, hp: e.hp }));
      return result(true, `${taint ? taint + ' ' : ''}Spawned ${spawned.length} ${kind}.`, {
        target: target.target,
        kind,
        requested: { x, y, n },
        spawned,
      });
    },
    complete: (ctx, req) => {
      if (req.completingArg === 0) return matching(Object.keys(ctx.enemyCtl.defs), currentToken(req));
      return commandTargetCompletions(req);
    },
  });

  add({
    name: 'crate',
    info: info('game.crate', 'Spawn Crate', 'crate [n] [x y] [wood|metal|stone] [small|large] [--target ...]', 'Drop rigid-body test crates (boxes that fall, tumble, collide; large ones resist kicks/blasts and shatter).', 'game'),
    run: (ctx, args) => spawnRigidTest(ctx, args, 'crate'),
    complete: (_ctx, req) => commandTargetCompletions(req),
  });

  add({
    name: 'boulder',
    info: info('game.boulder', 'Spawn Boulder', 'boulder [n] [x y] [wood|metal|stone] [small|large] [--target ...]', 'Drop rigid-body boulders (circles that roll down slopes; large ones resist kicks/blasts).', 'game'),
    run: (ctx, args) => spawnRigidTest(ctx, args, 'boulder'),
    complete: (_ctx, req) => commandTargetCompletions(req),
  });

  add({
    name: 'playground',
    aliases: ['physlab'],
    info: info('game.playground', 'Physics Playground', 'playground [--target ...]', 'Carve a rigid-body test arena (ramps + shelf + valley) and drop boulders/crates around you.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'playground');
      if (!target.ok) return target.result;
      buildPlayground(ctx);
      const note = ctx.state.mode === 'play' ? '' : ' (start a run / PLAY to see the bodies render)';
      return result(true, `Physics playground built — boulders roll the ramps, crates pile on the shelf. Lob a bomb to scatter them.${note}`, {
        target: target.target,
        bodies: ctx.rigidBodies.bodies.length,
      });
    },
    complete: (_ctx, req) => commandTargetCompletions(req),
  });

  add({
    name: 'give',
    info: info('game.give', 'Give', 'give <gold|heart|tome|card> [arg] [--target ...]', 'Grant currency, vitality, or cards.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'give');
      if (!target.ok) return target.result;
      const blocked = blockBuilderPlaytestPersistentState('give', target.target);
      if (blocked) return blocked;
      const [kind, arg] = target.args;
      if (!kind) return result(false, 'Usage: give <gold|heart|tome|card> [arg] [--target ...]', { code: 'usage' });
      if (kind === 'gold') {
        const amountRaw = arg ?? '100';
        const amount = parsePositiveInt(amountRaw, 'gold amount', 999999);
        if (typeof amount !== 'number') return amount;
        const taint = taintIfNeeded(ctx, 'give', target.target);
        ctx.state.score += amount;
        ctx.events.emit('scoreChanged', { score: ctx.state.score });
        return result(true, `${taint ? taint + ' ' : ''}+${amount} gold.`, { target: target.target, kind, amount, score: ctx.state.score });
      }
      if (kind === 'heart') {
        const count = arg ? parsePositiveInt(arg, 'heart count', 50) : 1;
        if (typeof count !== 'number') return count;
        const taint = taintIfNeeded(ctx, 'give', target.target);
        ctx.player.maxHp += 20 * count;
        ctx.player.hp = ctx.player.maxHp;
        return result(true, `${taint ? taint + ' ' : ''}+${count} heart${count === 1 ? '' : 's'}.`, {
          target: target.target,
          kind,
          count,
          hp: ctx.player.hp,
          maxHp: ctx.player.maxHp,
        });
      }
      if (kind === 'tome' || kind === 'card') {
        const card = parseCardId(arg ?? 'spark');
        if (typeof card !== 'string') return card;
        const taint = taintIfNeeded(ctx, 'give', target.target);
        ctx.wands.grantCard(ctx, card);
        return result(true, `${taint ? taint + ' ' : ''}Granted card ${card}.`, { target: target.target, kind, card });
      }
      return result(false, `Unknown give kind "${kind}"`, { code: 'parse-give-kind', expected: ['gold', 'heart', 'tome', 'card'] });
    },
    complete: (_ctx, req) => {
      if (req.completingArg === 0) return matching(['gold', 'heart', 'tome', 'card'], currentToken(req));
      if (req.args[0] === 'card' || req.args[0] === 'tome') return matching(Object.keys(CARD_DEFS), currentToken(req));
      return commandTargetCompletions(req);
    },
  });

  add({
    name: 'kill',
    info: info('game.kill', 'Kill Enemies', 'kill [all|radius n] [--target ...]', 'Remove hostiles through enemyCtl.kill.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'kill');
      if (!target.ok) return target.result;
      const mode = target.args[0] ?? 'radius';
      let victims = [...ctx.enemies];
      if (mode === 'radius') {
        const radius = target.args[1] ? parseFiniteNumber(target.args[1], 'radius') : 120;
        if (typeof radius !== 'number') return radius;
        const r2 = radius * radius;
        victims = victims.filter((e) => {
          const dx = e.x - ctx.player.x;
          const dy = e.y - ctx.player.y;
          return dx * dx + dy * dy <= r2;
        });
      } else if (mode !== 'all') {
        return result(false, 'Usage: kill [all|radius n] [--target ...]', { code: 'usage' });
      }
      const taint = taintIfNeeded(ctx, 'kill', target.target);
      for (const enemy of victims) ctx.enemyCtl.kill(enemy, 0, 0);
      return result(true, `${taint ? taint + ' ' : ''}Killed ${victims.length} hostile${victims.length === 1 ? '' : 's'}.`, {
        target: target.target,
        killed: victims.map((e) => ({ kind: e.kind, x: e.x, y: e.y })),
      });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['all', 'radius'], currentToken(req)) : commandTargetCompletions(req)),
  });

  add({
    name: 'cell',
    info: info('game.cell', 'Paint Cell', 'cell <material> [radius] [--target ...]', 'Paint a material disc at the cursor or player.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'cell');
      if (!target.ok) return target.result;
      const material = target.args[0];
      if (!material) return result(false, 'Usage: cell <material> [radius] [--target ...]', { code: 'usage' });
      const type = parseCellType(ctx, material);
      if (typeof type !== 'number') return type;
      const radius = target.args[1] ? parsePositiveInt(target.args[1], 'radius', 64) : Math.max(1, Math.min(64, ctx.state.brushSize));
      if (typeof radius !== 'number') return radius;
      const anchor =
        target.target === 'sandbox'
          ? { x: Math.floor(ctx.input.mouse.x), y: Math.floor(ctx.input.mouse.y) }
          : { x: Math.floor(ctx.player.x), y: Math.floor(ctx.player.y - PLAYER_H / 2) };
      const taint = taintIfNeeded(ctx, 'cell', target.target);
      const painted = paintDisc(ctx, anchor.x, anchor.y, radius, type);
      ctx.events.emit('worldEdited', {
        source: 'console',
        command: 'cell',
        target: target.target,
        bounds: painted.bounds,
        cells: painted.cells,
      });
      const name = ctx.params.materials[type]?.name ?? `cell ${type}`;
      return result(true, `${taint ? taint + ' ' : ''}Painted ${painted.cells} ${name} cells.`, {
        target: target.target,
        material: { id: type, name },
        radius,
        anchor,
        ...painted,
      });
    },
    complete: (ctx, req) => {
      if (req.completingArg === 0) return cellSuggestions(ctx, currentToken(req));
      return commandTargetCompletions(req);
    },
  });

  add({
    name: 'fill',
    info: info('game.fill', 'Fill Rect', 'fill <x0> <y0> <x1> <y1> <material> [--target ...]', 'Fill a bounded cell rectangle.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'fill');
      if (!target.ok) return target.result;
      if (target.args.length !== 5) {
        return result(false, 'Usage: fill <x0> <y0> <x1> <y1> <material> [--target ...]', { code: 'usage' });
      }
      const base = coordBase(ctx, target.target);
      const p0 = parseWorldCoordPair(target.args, base);
      if (isCommandResult(p0)) return p0;
      const p1 = parseWorldCoordPair(target.args.slice(2), base);
      if (isCommandResult(p1)) return p1;
      const type = parseCellType(ctx, target.args[4]);
      if (typeof type !== 'number') return type;
      const requestedBounds = normalizeBounds(p0.x, p0.y, p1.x, p1.y);
      const area = boundsArea(requestedBounds);
      if (area > FILL_CELL_CAP) {
        return result(false, `fill area ${area} exceeds cap ${FILL_CELL_CAP}`, {
          code: 'area-cap',
          command: 'fill',
          area,
          cap: FILL_CELL_CAP,
          requestedBounds,
        });
      }
      const taint = taintIfNeeded(ctx, 'fill', target.target);
      const painted = paintRect(ctx, requestedBounds, type);
      ctx.events.emit('worldEdited', {
        source: 'console',
        command: 'fill',
        target: target.target,
        bounds: painted.bounds,
        cells: painted.cells,
      });
      const name = materialName(ctx, type);
      return result(true, `${taint ? taint + ' ' : ''}Filled ${painted.cells} ${name} cells.`, {
        target: target.target,
        material: { id: type, name },
        requestedBounds,
        ...painted,
        tainted: ctx.state.debugGodMode,
      });
    },
    complete: (ctx, req) => (req.completingArg === 4 ? cellSuggestions(ctx, currentToken(req)) : commandTargetCompletions(req)),
  });

  add({
    name: 'dump',
    info: info('game.dump', 'Dump Cells', 'dump <x> <y> <w> <h> [--target ...]', 'Return an ASCII and raw type dump of a cell region.', 'game'),
    run: (ctx, args) => {
      const target = resolveReadTarget(ctx, args, 'dump');
      if (!target.ok) return target.result;
      if (target.args.length !== 4) return result(false, 'Usage: dump <x> <y> <w> <h> [--target ...]', { code: 'usage' });
      const base = coordBase(ctx, target.target);
      const p = parseWorldCoordPair(target.args, base);
      if (isCommandResult(p)) return p;
      const w = parsePositiveInt(target.args[2], 'width', 256);
      if (typeof w !== 'number') return w;
      const h = parsePositiveInt(target.args[3], 'height', 256);
      if (typeof h !== 'number') return h;
      const area = w * h;
      if (area > DUMP_CELL_CAP) return result(false, `dump area ${area} exceeds cap ${DUMP_CELL_CAP}`, { code: 'area-cap', command: 'dump', area, cap: DUMP_CELL_CAP });
      const dumped = dumpRegion(ctx, p.x, p.y, w, h);
      return result(true, `dump ${w}x${h} @ ${p.x},${p.y}\n${dumped.ascii.join('\n')}`, {
        target: target.target,
        origin: { x: p.x, y: p.y },
        size: { w, h },
        ...dumped,
      });
    },
    complete: (_ctx, req) => commandTargetCompletions(req),
  });

  add({
    name: 'count',
    info: info('game.count', 'Count Cells', 'count <material> [x y w h] [--target ...]', 'Count a material in the target world or bounded region.', 'game'),
    run: (ctx, args) => {
      const target = resolveReadTarget(ctx, args, 'count');
      if (!target.ok) return target.result;
      if (target.args.length !== 1 && target.args.length !== 5) {
        return result(false, 'Usage: count <material> [x y w h] [--target ...]', { code: 'usage' });
      }
      const type = parseCellType(ctx, target.args[0]);
      if (typeof type !== 'number') return type;
      let requestedBounds: Bounds | null = null;
      if (target.args.length === 5) {
        const base = coordBase(ctx, target.target);
        const p = parseWorldCoordPair(target.args.slice(1), base);
        if (isCommandResult(p)) return p;
        const w = parsePositiveInt(target.args[3], 'width', 4096);
        if (typeof w !== 'number') return w;
        const h = parsePositiveInt(target.args[4], 'height', 4096);
        if (typeof h !== 'number') return h;
        requestedBounds = { x0: p.x, y0: p.y, x1: p.x + w - 1, y1: p.y + h - 1 };
      }
      const counted = countCellType(ctx, type, requestedBounds ?? undefined);
      const name = materialName(ctx, type);
      return result(true, `${name}: ${counted.count} cell${counted.count === 1 ? '' : 's'}`, {
        target: target.target,
        material: { id: type, name },
        requestedBounds,
        ...counted,
      });
    },
    complete: (ctx, req) => (req.completingArg === 0 ? cellSuggestions(ctx, currentToken(req)) : commandTargetCompletions(req)),
  });

  add({
    name: 'level',
    info: info('game.level', 'Enter Level', 'level <id> [--target expedition]', 'Jump to a generated expedition level.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'level');
      if (!target.ok) return target.result;
      if (target.target !== 'expedition') return result(false, 'level only targets normal expedition Play.', { code: 'target-invalid', target: target.target });
      const idRaw = target.args[0];
      if (!idRaw) return result(false, 'Usage: level <id> [--target expedition]', { code: 'usage' });
      const id = parseLevelId(idRaw);
      if (typeof id !== 'string') return id;
      const taint = taintIfNeeded(ctx, 'level', target.target);
      const ok = ctx.levels.debugEnterLevel(ctx, id);
      if (!ok) return result(false, `Unable to enter level "${id}"`, { code: 'level-failed', id });
      return result(true, `${taint ? taint + ' ' : ''}Entered ${id}.`, {
        target: target.target,
        id,
        level: ctx.levels.current?.def ?? null,
        player: { x: ctx.player.x, y: ctx.player.y },
      });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(Object.keys(LEVELS), currentToken(req)) : commandTargetCompletions(req)),
  });

  add({
    name: 'pos',
    info: info('game.pos', 'Position', 'pos', 'Report player, camera, mode, and level position.', 'game'),
    run: (ctx) => {
      const runtime = activePlayRuntime(ctx);
      const data = {
        mode: ctx.state.mode,
        builderOpen: isBuilderOpen(),
        player: {
          x: ctx.player.x,
          y: ctx.player.y,
          vx: ctx.player.vx,
          vy: ctx.player.vy,
          hp: ctx.player.hp,
          maxHp: ctx.player.maxHp,
          dead: ctx.player.dead,
        },
        camera: {
          x: ctx.camera.x,
          y: ctx.camera.y,
          renderX: ctx.camera.renderX,
          renderY: ctx.camera.renderY,
          zoom: ctx.camera.zoom,
        },
        level: runtime
          ? {
              id: runtime.def.id,
              name: runtime.def.name,
              depth: runtime.def.depth,
              biome: runtime.def.biome,
              spawn: runtime.spawn,
              pickups: runtime.pickups.filter((p) => !p.taken).length,
              mechanisms: runtime.mechanisms.length,
            }
          : null,
        world: { width: ctx.world.width, height: ctx.world.height, simBounds: { ...ctx.world.simBounds } },
      };
      return result(true, `player ${ctx.player.x},${ctx.player.y} camera ${Math.round(ctx.camera.x)},${Math.round(ctx.camera.y)} level ${runtime?.def.id ?? 'none'}`, data);
    },
  });

  add({
    name: 'find',
    info: info('game.find', 'Find Runtime Item', 'find <pickup|mechanism|portal> [--target ...]', 'Find the nearest pickup/mechanism or active portal.', 'game'),
    run: (ctx, args) => {
      const target = resolveReadTarget(ctx, args, 'find');
      if (!target.ok) return target.result;
      const kind = target.args[0];
      if (!kind) return result(false, 'Usage: find <pickup|mechanism|portal> [--target ...]', { code: 'usage' });
      const runtime = runtimeForTarget(ctx, target.target, 'find');
      if (isCommandResult(runtime)) return runtime;
      if (kind === 'pickup') {
        const pickup = nearestPickup(ctx, runtime.pickups);
        if (!pickup) return result(false, 'No untaken pickups in the active runtime.', { code: 'not-found', kind, target: target.target });
        return result(true, `nearest pickup ${pickup.kind} at ${Math.round(pickup.x)},${Math.round(pickup.y)}`, {
          target: target.target,
          kind,
          item: { kind: pickup.kind, x: pickup.x, y: pickup.y, taken: pickup.taken, data: pickup.data },
          distance: Math.sqrt(distanceSquared(ctx, pickup.x, pickup.y)),
        });
      }
      if (kind === 'mechanism') {
        const mechanism = nearestMechanism(ctx, runtime.mechanisms);
        if (!mechanism) return result(false, 'No mechanisms in the active runtime.', { code: 'not-found', kind, target: target.target });
        return result(true, `nearest mechanism ${mechanism.kind}#${mechanism.id} at ${mechanism.x},${mechanism.y}`, {
          target: target.target,
          kind,
          item: {
            id: mechanism.id,
            kind: mechanism.kind,
            x: mechanism.x,
            y: mechanism.y,
            w: mechanism.w,
            h: mechanism.h,
            state: mechanism.state,
            targetId: mechanism.targetId,
          },
          distance: Math.sqrt(distanceSquared(ctx, mechanism.x + mechanism.w / 2, mechanism.y + mechanism.h / 2)),
        });
      }
      if (kind === 'portal') {
        const portal = runtime.portal;
        if (!portal) return result(false, 'No portal in the active runtime.', { code: 'not-found', kind, target: target.target });
        return result(true, `portal ${portal.open ? 'open' : 'closed'} at ${portal.x},${portal.y}`, {
          target: target.target,
          kind,
          item: { ...portal },
          distance: Math.sqrt(distanceSquared(ctx, portal.x, portal.y)),
        });
      }
      return result(false, `Unknown find kind "${kind}"`, { code: 'parse-find-kind', expected: ['pickup', 'mechanism', 'portal'] });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['pickup', 'mechanism', 'portal'], currentToken(req)) : commandTargetCompletions(req)),
  });

  add({
    name: 'get',
    info: info('game.get', 'Get Parameter', 'get <paramPath>', 'Read a live-tunable parameter.', 'game'),
    run: (ctx, args) => {
      if (args.length !== 1) return result(false, 'Usage: get <paramPath>', { code: 'usage' });
      const resolved = resolveParamPath(ctx, args[0]);
      if (isCommandResult(resolved)) return resolved;
      return result(true, `${resolved.canonical} = ${String(resolved.current)}`, {
        path: resolved.canonical,
        value: resolved.current,
      });
    },
    complete: (ctx, req) => paramSuggestions(ctx, currentToken(req)),
  });

  add({
    name: 'set',
    info: info('game.set', 'Set Parameter', 'set <paramPath> <value>', 'Write a live-tunable parameter without tainting saves.', 'game'),
    run: (ctx, args) => {
      if (args.length !== 2) return result(false, 'Usage: set <paramPath> <value>', { code: 'usage' });
      const resolved = resolveParamPath(ctx, args[0]);
      if (isCommandResult(resolved)) return resolved;
      if (resolved.canonical === 'render.backend') {
        return result(false, 'render.backend is startup-only; use ?renderBackend=webgl|webgpu|auto before boot.', {
          code: 'startup-only-param',
          path: resolved.canonical,
          expected: RENDER_BACKEND_MODES,
        });
      }
      const next = parseParamValue(args[1], resolved.current, resolved.allowed);
      if (isCommandResult(next)) return next;
      resolved.owner[resolved.key] = next;
      let value = next;
      if (resolved.canonical.startsWith('backdrop.')) {
        ctx.params.backdrop = sanitizeBackdropSettings(ctx.params.backdrop);
        saveBackdropSettings(ctx.params.backdrop);
        const reread = resolveParamPath(ctx, resolved.canonical);
        if (!isCommandResult(reread)) value = reread.current;
      }
      syncKnownParamInputs(resolved.canonical, value);
      return result(true, `${resolved.canonical}: ${String(resolved.current)} -> ${String(value)}`, {
        path: resolved.canonical,
        oldValue: resolved.current,
        value,
        tainted: false,
      });
    },
    complete: (ctx, req) => (req.completingArg === 0 ? paramSuggestions(ctx, currentToken(req)) : []),
  });

  add({
    name: 'time',
    info: info('game.time', 'Simulation Speed', 'time <simSpeed>', 'Set global.simSpeed through the existing live-tuning dial.', 'game'),
    run: (ctx, args) => {
      if (args.length !== 1) return result(false, 'Usage: time <simSpeed>', { code: 'usage' });
      const value = parseFiniteNumber(args[0], 'sim speed');
      if (typeof value !== 'number') return value;
      return setSimSpeed(ctx, value);
    },
  });

  add({
    name: 'gpu',
    info: info('game.gpu', 'GPU Compose', 'gpu <on|off|toggle>', 'Toggle GPU frame composition without tainting saves.', 'game'),
    run: (ctx, args) => {
      if (args.length !== 1) return result(false, 'Usage: gpu <on|off|toggle>', { code: 'usage' });
      return setGpuCompose(ctx, args[0]);
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['on', 'off', 'toggle'], currentToken(req)) : []),
  });

  add({
    name: 'gold',
    info: info('game.gold', 'Grant Gold', 'gold <n> [--target ...]', 'Grant gold as a gameplay-mutating QA command.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'gold');
      if (!target.ok) return target.result;
      const blocked = requireNoBuilderPlaytestPersistentState('gold', target.target);
      if (blocked) return blocked;
      if (target.args.length !== 1) return result(false, 'Usage: gold <n> [--target ...]', { code: 'usage' });
      const amount = parsePositiveInt(target.args[0], 'gold amount', 999999);
      if (typeof amount !== 'number') return amount;
      return grantGold(ctx, amount, target.target);
    },
    complete: (_ctx, req) => commandTargetCompletions(req),
  });

  add({
    name: 'heal',
    info: info('game.heal', 'Heal Player', 'heal [amount|full] [--target ...]', 'Restore player HP as a gameplay-mutating QA command.', 'game'),
    run: (ctx, args) => {
      const target = resolveTarget(ctx, args, 'heal');
      if (!target.ok) return target.result;
      const blocked = requireNoBuilderPlaytestPersistentState('heal', target.target);
      if (blocked) return blocked;
      if (target.args.length > 1) return result(false, 'Usage: heal [amount|full] [--target ...]', { code: 'usage' });
      let amount: number | null = null;
      if (target.args[0] && target.args[0] !== 'full') {
        const parsed = parsePositiveInt(target.args[0], 'heal amount', 9999);
        if (typeof parsed !== 'number') return parsed;
        amount = parsed;
      }
      return healPlayer(ctx, amount, target.target);
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['full'], currentToken(req)) : commandTargetCompletions(req)),
  });

  add({
    name: 'tele',
    aliases: ['telemetry'],
    info: info('game.tele', 'Telemetry', 'tele', 'Dump local telemetry counters.', 'game'),
    run: (ctx) => {
      const counters = ctx.telemetry.all();
      const entries = Object.entries(counters).sort(([a], [b]) => a.localeCompare(b));
      const text = entries.length === 0 ? 'telemetry: empty' : entries.map(([key, value]) => `${key}=${value}`).join(' ');
      return result(true, text, { counters: Object.fromEntries(entries) });
    },
  });

  add({
    name: 'perf',
    info: info('game.perf', 'Perf HUD', 'perf <on|off|toggle>', 'Show or hide the existing performance HUD.', 'game'),
    run: (ctx, args) => {
      if (args.length !== 1) return result(false, 'Usage: perf <on|off|toggle>', { code: 'usage' });
      const key = args[0].toLowerCase();
      const before = ctx.perf.visible;
      let desired: boolean;
      if (key === 'toggle') desired = !before;
      else if (key === 'on') desired = true;
      else if (key === 'off') desired = false;
      else return result(false, 'Usage: perf <on|off|toggle>', { code: 'usage' });
      const visible = ctx.perf.setVisible(desired);
      return result(true, `perf HUD ${visible ? 'on' : 'off'}.`, { oldValue: before, value: visible });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['on', 'off', 'toggle'], currentToken(req)) : []),
  });

  add({
    name: 'perfrec',
    info: info('game.perfrec', 'Record Perf', 'perfrec <frames>', 'Record raw per-frame perf buckets and return summary data.', 'game'),
    run: async (_ctx, args) => {
      if (args.length !== 1) return result(false, 'Usage: perfrec <frames>', { code: 'usage' });
      if (!perfWindow()) return result(false, 'perfrec requires the browser runtime.', { code: 'ui-unavailable' });
      const frames = parsePositiveInt(args[0], 'frame count', PERFREC_MAX_FRAMES);
      if (typeof frames !== 'number') return frames;
      const samples = await waitForPerfSamples(frames);
      const summary = summarizePerfSamples(samples);
      const ok = samples.length >= frames;
      return result(ok, `perfrec ${samples.length}/${frames} frames: frame avg ${summary.frame.avg.toFixed(2)}ms`, {
        code: ok ? 'perfrec-complete' : 'perfrec-partial',
        framesRequested: frames,
        framesCaptured: samples.length,
        summary,
        samples,
      });
    },
  });

  add({
    name: 'screenshot',
    aliases: ['shot'],
    info: info('game.screenshot', 'Screenshot', 'screenshot', 'Capture the current game canvas as a PNG data URL.', 'game'),
    run: async (_ctx, args) => {
      if (args.length !== 0) return result(false, 'Usage: screenshot', { code: 'usage' });
      return captureScreenshot();
    },
  });

  return new ConsoleCommandRegistry(ctx, definitions);
}

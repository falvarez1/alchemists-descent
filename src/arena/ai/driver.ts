import { hashSeed } from '@/core/rng';
import type { Ctx } from '@/core/types';
import { clampAiLevel } from '@/config/aiTiers';
import type { AiLevel } from '@/config/aiTiers';
import { setExternalControl } from '@/input/externalControl';
import type { Brain, BrainId, BrainSelf, Hands } from '@/arena/ai/brain';
import { createBrain } from '@/arena/ai';

/**
 * THE DRIVER (docs/arena/AI-FIGHTERS.md 3): installs a brain on a fighter slot and runs it every fixed tick.
 *
 * For now there is one slot, 0, which IS the player: the driver detaches the keyboard (`input/externalControl`), builds the
 * `BrainSelf` (the player, `ctx.input`, `ctx.fighters` and the hands) and calls `brain.think` once per tick from
 * `Game.updateFixedTick` (`runBots`), right before `playerCtl.update` reads the inputs it wrote. A second fighter's driver
 * (the duel, phase 3) is the same class on that slot's bundle: only `selfFor` differs, so `BotDriver` takes the `BrainSelf` as
 * a function.
 *
 * It hands the keyboard back, cleanly, the moment the brain is switched off, the level changes or play ends.
 *
 *   const driver = botDriverFor(ctx);
 *   driver.install('basic', 3, seed);   // the keyboard is now the bot's
 *   driver.setLevel(5);                 // live
 *   driver.off();                       // and the keyboard is yours again
 *
 * The batch runner (telemetry) and the duel make their own `BotDriver` over their own `BrainSelf`: `new BotDriver(ctx, self)`.
 */

export interface BotInstallOptions {
  /** Seed for the bot's own `Rng`: `hashSeed(seed, 'bot:' + slot)`. Defaults to the world's seed. */
  seed?: number;
}

/** The hands of the player slot: the input layer's own paths (F: `playerCtl.kick`, right mouse: the flask, Z/T: `fighters.press`, R). */
export function playerHands(ctx: Ctx): Hands {
  return {
    press: (slot) => ctx.fighters?.press(slot),
    kick: () => { if (!ctx.player.dead) ctx.playerCtl.kick(ctx); },
    flask: () => { if (!ctx.player.dead) ctx.flask.throwFlask(ctx); },
    respawn: () => { if (ctx.player.dead) ctx.playerCtl.respawn(); },
  };
}

export function playerSelf(ctx: Ctx): BrainSelf {
  return { slot: 0, player: ctx.player, input: ctx.input, fighters: ctx.fighters, hands: playerHands(ctx) };
}

/** A rival slot's `BrainSelf` (its own body, input and hands; `think` runs under that slot's binding, so `ctx.*` is its own). */
export function slotSelf(ctx: Ctx, slot: number): BrainSelf | null {
  const b = ctx.arena?.bundle(slot);
  if (!b) return null;
  return {
    slot,
    player: b.player,
    input: b.input,
    fighters: b.fighters,
    hands: {
      press: (s) => b.fighters.press(s),
      kick: () => { if (!b.player.dead) b.playerCtl.kick(ctx); },
      flask: () => { if (!b.player.dead) b.flask.throwFlask(ctx); },
      respawn: () => undefined,
    },
  };
}

export class BotDriver {
  private current: Brain | null = null;
  private levelId: string | undefined;
  private seedUsed = 0;
  private ticks = 0;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly ctx: Ctx,
    readonly self: BrainSelf = playerSelf(ctx),
  ) {
    // The level changing hands the keyboard back (the new floor is nobody's plan); so does leaving play.
    this.offs.push(
      ctx.events.on('levelChanged', () => this.off()),
      ctx.events.on('modeChanged', ({ mode }) => { if (mode !== 'play') this.off(); }),
    );
  }

  get brain(): Brain | null {
    return this.current;
  }

  get active(): boolean {
    return this.current !== null;
  }

  get seed(): number {
    return this.seedUsed;
  }

  /** Ticks the current brain has thought since it was installed. */
  get thought(): number {
    return this.ticks;
  }

  /** Put `id` in charge of the slot (replacing any brain). The keyboard detaches on this call. */
  install(id: BrainId, level: number, opts: BotInstallOptions = {}): Brain {
    this.off();
    const seed = opts.seed ?? this.ctx.state.worldSeed;
    this.seedUsed = seed >>> 0;
    const brain = createBrain(id, { level: clampAiLevel(level), seed: hashSeed(seed, `bot:${this.self.slot}`), slot: this.self.slot });
    this.current = brain;
    this.levelId = this.ctx.levels?.current?.def.id;
    this.ticks = 0;
    if (this.self.slot === 0) setExternalControl(this.ctx.input, true);
    return brain;
  }

  setLevel(level: number): AiLevel {
    const l = clampAiLevel(level);
    if (this.current) this.current.level = l;
    return l;
  }

  /** Hand the slot back: every key, the trigger and the cursor stand down and the keyboard is the person's again. */
  off(): void {
    const brain = this.current;
    if (brain === null) return;
    this.current = null;
    brain.reset();
    const input = this.self.input;
    const k = input.keys;
    k.left = k.right = k.up = k.jump = k.wallJump = k.down = k.grab = false;
    input.queuedJump = undefined;
    this.self.player.firing = false;
    this.self.player.fireBlockedUntilRelease = false;
    if (this.self.slot === 0) setExternalControl(input, false);
  }

  /** Fixed tick, before the body reads its inputs. */
  tick(): void {
    const brain = this.current;
    if (brain === null) return;
    const ctx = this.ctx;
    // a bot plays only the level it was installed on, in play mode
    if (ctx.state.mode !== 'play' || ctx.levels?.current?.def.id !== this.levelId) { this.off(); return; }
    brain.think(ctx, this.self, ctx.state.frameCount);
    this.ticks++;
  }

  dispose(): void {
    this.off();
    for (const off of this.offs.splice(0)) off();
  }
}

// ---- one driver per game (keyed by its Ctx: no field on the contract file, and a test's fake Ctx gets its own) ----

const DRIVERS = new WeakMap<Ctx, BotDriver>();

/** The player slot's driver for this game, made on first use. */
export function botDriverFor(ctx: Ctx): BotDriver {
  let driver = DRIVERS.get(ctx);
  if (driver === undefined) {
    driver = new BotDriver(ctx);
    DRIVERS.set(ctx, driver);
  }
  return driver;
}

const RIVAL_DRIVERS = new WeakMap<Ctx, Map<number, BotDriver>>();

/**
 * A driver for a RIVAL slot (the duel): its brain thinks under that slot's binding, once a tick, right before the slot's body phase
 * (`ArenaApi.setDriver`). Made on first use, and re-made when the slot's bundle is a new one (a rival that was removed and re-added).
 */
export function rivalDriverFor(ctx: Ctx, slot: number): BotDriver | null {
  const self = slotSelf(ctx, slot);
  if (!self || !ctx.arena) return null;
  let byCtx = RIVAL_DRIVERS.get(ctx);
  if (!byCtx) { byCtx = new Map(); RIVAL_DRIVERS.set(ctx, byCtx); }
  let d = byCtx.get(slot);
  if (d === undefined || d.self.player !== self.player) {
    d?.dispose();
    d = new BotDriver(ctx, self);
    byCtx.set(slot, d);
    const driver = d;
    ctx.arena.setDriver(slot, () => driver.tick());
  }
  return d;
}

/** The one call `Game.updateFixedTick` makes each tick, before `playerCtl.update`. Free when no bot has ever been installed. */
export function runBots(ctx: Ctx): void {
  DRIVERS.get(ctx)?.tick();
}

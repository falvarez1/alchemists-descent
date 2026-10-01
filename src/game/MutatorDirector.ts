import type { Ctx, EnemyKind, GlobalParams, LevelDef, LevelRuntime, MaterialParams, MutatorApi, MutatorLevelGen } from '@/core/types';
import { floorOf } from '@/config/worldgraph';
import { cleanMutators, mutatorDef, mutatorMods, mutatorNames, type MutatorMods } from '@/content/mutators';
import { marshGasColor, packRGB, slimeColor, waterColor } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';
import {
  EMPTY_PLAN,
  applyPuddles,
  dripReady,
  emitVent,
  planDressing,
  type DressingAnchors,
  type LevelPlan,
} from '@/game/mutatorDressing';

/**
 * COMPLICATIONS at runtime (content/mutators is the registry and the arithmetic; this is what
 * makes them happen). It owns four things:
 *
 *  - The PER-RUN TUNING CLONE. A complication that changes how fuel burns or how bright the cave
 *    is changes `ctx.params.materials` / `ctx.params.global`. Those are the shared tuning
 *    singletons (config/params), which config/tuningStore diffs and saves as the player's own
 *    tuning (`ad:tuning:v1`) on every change and on page hide, so writing them would leak a run's
 *    complication into the next boot. So the director swaps `ctx.params` to a CLONE for the run and
 *    puts the original objects back when the run ends (or the player leaves play mode). The
 *    singletons are never written; tests/mutators-runtime.test.ts and verify-mutators.mjs prove it.
 *  - The FLOOR DRESSING: planned from the pristine cells on both createLevel and restoreLevel
 *    (game/mutatorDressing), puddles written once at creation, vents ticked here.
 *  - The PER-TICK EFFECTS the dials cannot express: Short Rations' halved heals and Fireworks'
 *    delayed pops.
 *  - The announcement: one toast per run (and per resume) naming what is in force.
 *
 * The dials themselves (enemy count, damage, gravity, gold, ...) are not here: they are read
 * straight off `ctx.state.mutators` through `difficultyMods` / `mutatorMods`.
 */

const NONE: readonly string[] = Object.freeze([]);

/** A vent or drip is only worth running while the alchemist can see its cells land. */
const VENT_RANGE = 280;
/** How far a firework's burst reaches creatures and the alchemist, in cells. */
const POP_RADIUS = 20;
const POP_PLAYER_RADIUS = 12;
/** Ticks between a creature falling and its burst: the fuse, and the rhythm of a chain. */
const POP_FUSE = 14;
const POP_QUEUE_MAX = 24;
/**
 * A rise in health in one tick larger than this is a set piece (a rest, a respawn), not a potion: left alone. It
 * is a fraction of maximum health with a floor, so that on a small pool (Glass Cannon's half) the largest ordinary
 * heal, a heart pickup (+20), is still a heal and still halved.
 */
const HEAL_SET_PIECE = 0.3;
const HEAL_SET_PIECE_MIN = 24;
/** A gap this long between two ticks was a menu (the Sanctum's "Mend wounds" is paid for and says "to full"), a hidden tab or a hitch: what changed in it is not a heal. */
const MAX_TICK_GAP_MS = 250;

/** The wardens (the keys of entities/Enemies BOSS_LAIRS): a warden's death has its own spectacle, and its ward admits no stray blast. */
const WARDENS: ReadonlySet<string> = new Set(['colossus', 'leviathan', 'rimewarden', 'lenswright']);

/**
 * The first time the alchemist comes near each kind of vent in a run, one notice: what it is and what
 * it does, instruction first. Once per kind per run, so it is a lesson and never a lecture.
 */
const VENT_NOTICE: Record<'drips' | 'slime' | 'gas', string> = {
  drips: 'Wet floors. Water carries current, so keep your sparks away from your own feet.',
  slime: 'Slime from the ceiling. Fire turns it to acid, so keep your flame to yourself.',
  gas: 'Marsh gas, seeping from the floor. A flame will light it, and it will light everything else.',
};
const NOTICE_RANGE = 75;

const FIREWORK_PALETTES: readonly (readonly number[])[] = [
  [0xffd27a, 0xffb830, 0xfff0c0],
  [0xff5a5a, 0xff9a6a, 0xffd0c0],
  [0x6fd0ff, 0x9fe8ff, 0xd8f4ff],
  [0x8cff9a, 0xc8ffd0, 0xf0fff2],
  [0xd08cff, 0xe8c8ff, 0xffd8f4],
];

interface Pop {
  x: number;
  y: number;
  at: number;
}

/** A tuning copy for the run: the materials with fuel scaled, the globals with ambient scaled. */
function cloneParams(ctx: Ctx, mods: Readonly<MutatorMods>): { materials: Record<number, MaterialParams>; global: GlobalParams } {
  const materials: Record<number, MaterialParams> = {};
  for (const [id, params] of Object.entries(ctx.params.materials)) materials[Number(id)] = { ...params };
  if (mods.flammability !== 1) {
    for (const params of Object.values(materials)) {
      // The fixed fuel list: whatever the sim reads a flammability or an ignition chance for.
      if (typeof params.flammability === 'number') params.flammability = Math.min(1, params.flammability * mods.flammability);
      if (typeof params.igniteChance === 'number') params.igniteChance = Math.min(1, params.igniteChance * mods.flammability);
    }
  }
  const global: GlobalParams = { ...ctx.params.global };
  if (mods.ambient !== 1) global.ambient = ctx.params.global.ambient * mods.ambient;
  return { materials, global };
}

function needsClone(mods: Readonly<MutatorMods>): boolean {
  return mods.flammability !== 1 || mods.ambient !== 1;
}

export class MutatorDirector implements MutatorApi {
  private active: readonly string[] = NONE;
  /** What `ctx.params` held before the clone went in (the tuning singletons), or null when no clone is installed. */
  private shared: { materials: Record<number, MaterialParams>; global: GlobalParams } | null = null;
  private clone: { materials: Record<number, MaterialParams>; global: GlobalParams } | null = null;
  private readonly plans = new Map<string, LevelPlan>();
  /** What the last plan and the last dressing cost, in ms (probes read them: a floor is built behind the curtain, but not for free). */
  lastPlanMs = 0;
  lastDressMs = 0;
  private pops: Pop[] = [];
  private readonly noticed = new Set<string>();
  private lastHp = 0;
  private lastHealAt = 0;
  private announceAt = -1;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly ctx: Ctx) {
    this.disposers.push(
      ctx.events.on('enemyKilled', ({ kind, x, y }) => this.onKilled(kind, x, y)),
      // The title, the Workshop and the Builder are not the descent: they play on the shipped tuning.
      ctx.events.on('modeChanged', () => this.syncParams()),
    );
  }

  dispose(): void {
    this.deactivate(this.ctx);
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  get ids(): readonly string[] {
    return this.active;
  }

  has(id: string): boolean {
    return this.active.includes(id);
  }

  /* ---------------- in force / out of force ---------------- */

  activate(ctx: Ctx, ids: readonly string[]): void {
    const next = cleanMutators(ids);
    if (next.length === 0) {
      this.deactivate(ctx);
      return;
    }
    const same = next.length === this.active.length && next.every((id, i) => id === this.active[i]);
    if (!same) {
      this.removeClone(ctx);
      this.plans.clear();
      this.pops.length = 0;
      this.noticed.clear();
      this.active = Object.freeze(next);
      this.lastHp = 0;
      this.announceAt = ctx.state.frameCount + 150;
    }
    ctx.state.mutators = this.active;
    this.syncParams();
  }

  deactivate(ctx: Ctx): void {
    this.removeClone(ctx);
    this.plans.clear();
    this.pops.length = 0;
    this.noticed.clear();
    this.active = NONE;
    this.lastHp = 0;
    this.announceAt = -1;
    if (ctx.state.mutators !== undefined) delete ctx.state.mutators;
  }

  /**
   * Install the run's tuning clone while the descent is being played, and put the shipped tuning back
   * whenever it is not (the title, the Workshop, the Builder). Idempotent.
   */
  private syncParams(): void {
    const ctx = this.ctx;
    const mods = mutatorMods({ mutators: this.active });
    const want = this.active.length > 0 && needsClone(mods) && ctx.state.mode === 'play';
    if (!want) {
      this.removeClone(ctx);
      return;
    }
    if (this.clone && ctx.params.materials === this.clone.materials) return;
    this.removeClone(ctx);
    this.shared = { materials: ctx.params.materials, global: ctx.params.global };
    this.clone = cloneParams(ctx, mods);
    ctx.params.materials = this.clone.materials;
    ctx.params.global = this.clone.global;
  }

  private removeClone(ctx: Ctx): void {
    if (this.shared) {
      // Only undo what this director did: if something else has since replaced the objects, leave them be.
      if (this.clone && ctx.params.materials === this.clone.materials) ctx.params.materials = this.shared.materials;
      if (this.clone && ctx.params.global === this.clone.global) ctx.params.global = this.shared.global;
    }
    this.shared = null;
    this.clone = null;
  }

  /* ---------------- the floors ---------------- */

  planLevel(ctx: Ctx, def: LevelDef, seed: number, gen: MutatorLevelGen): void {
    this.plans.delete(def.id);
    if (this.active.length === 0 || def.id === 'd1' || floorOf(def.id) <= 0) return;
    if (!this.active.some((id) => (mutatorDef(id)?.dressing?.length ?? 0) > 0)) return;
    const key = gen.pickups.find((p) => p.kind === 'key') ?? null;
    const anchors: DressingAnchors = {
      spawn: gen.spawn,
      exit: gen.exit,
      key: key ? { x: key.x, y: key.y } : null,
      portal: gen.portal ? { x: gen.portal.x, y: gen.portal.y } : null,
      boss: gen.boss ? { x: gen.boss.x, y: gen.boss.y } : null,
      keepOutRects: [
        ...gen.placedPrefabs.map((p) => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 })),
        ...gen.mechanisms.map((m) => ({ x0: m.x, y0: m.y, x1: m.x + m.w, y1: m.y + m.h })),
      ],
      keepClear: [
        ...gen.pickups.map((p) => ({ x: p.x, y: p.y })),
        ...gen.waystones.map((w) => ({ x: w.x, y: w.y })),
        ...(gen.portal ? [{ x: gen.portal.x, y: gen.portal.y }] : []),
        { x: gen.exit.x, y: gen.exit.sealY },
      ],
    };
    const t0 = performance.now();
    const plan = planDressing(ctx.world, anchors, seed, this.active);
    this.lastPlanMs = performance.now() - t0;
    this.plans.set(def.id, plan);
    ctx.telemetry.count(`mutator.plan.${def.id}.vents`, plan.vents.length);
    ctx.telemetry.count(`mutator.plan.${def.id}.puddles`, plan.puddles.length);
    if (plan.skipped) ctx.telemetry.count(`mutator.plan.${def.id}.skipped`);
  }

  dressLevel(ctx: Ctx, runtime: LevelRuntime): void {
    const plan = this.plans.get(runtime.def.id) ?? EMPTY_PLAN;
    if (plan.puddles.length === 0) return;
    const t0 = performance.now();
    const result = applyPuddles(runtime.world, runtime.spawn, plan.puddles);
    this.lastDressMs = performance.now() - t0;
    ctx.telemetry.count(`mutator.dress.${runtime.def.id}.cells`, result.cells);
    if (result.reverted) {
      // Fail open: the dressing would have cost the route (it cannot with liquid, but the check is the guarantee).
      plan.puddles.length = 0;
      ctx.telemetry.count(`mutator.dress.${runtime.def.id}.reverted`);
    }
  }

  /** The plan for a floor (probes and tests read it; undefined when the floor has none). */
  planFor(levelId: string): LevelPlan | undefined {
    return this.plans.get(levelId);
  }

  /* ---------------- the tick ---------------- */

  update(ctx: Ctx): void {
    if (this.active.length === 0) return;
    if (ctx.state.mode !== 'play' || (ctx.state.playtestSource !== null && ctx.state.playtestSource !== undefined)) return;
    // The shipped tuning is swapped back at the title and the Workshop; the descent resuming puts the clone in again.
    this.syncParams();
    this.announce(ctx);
    this.tickVents(ctx);
    this.tickHealing(ctx);
    this.tickPops(ctx);
  }

  private announce(ctx: Ctx): void {
    if (this.announceAt < 0 || ctx.state.frameCount < this.announceAt || ctx.state.frameCount < (ctx.state.arrivalGraceUntil ?? 0)) return;
    this.announceAt = -1;
    const names = mutatorNames(this.active);
    if (names) ctx.events.emit('toast', { text: `Notice posted: ${names} in force for this descent.` });
  }

  private tickVents(ctx: Ctx): void {
    const id = ctx.levels.current?.def.id;
    const plan = id ? this.plans.get(id) : undefined;
    if (!plan || plan.vents.length === 0) return;
    const frame = ctx.state.frameCount;
    const world = ctx.world;
    for (const v of plan.vents) {
      if (!this.noticed.has(v.kind) && Math.hypot(v.x - ctx.player.x, v.y - ctx.player.y) < NOTICE_RANGE) {
        this.noticed.add(v.kind);
        ctx.events.emit('toast', { text: VENT_NOTICE[v.kind as keyof typeof VENT_NOTICE] });
      }
      if ((frame + v.phase) % v.rate !== 0 || v.budget <= 0) continue;
      if (Math.hypot(v.x - ctx.player.x, v.y - ctx.player.y) > VENT_RANGE) continue;
      const nearby = Math.hypot(v.x - ctx.player.x, v.y - ctx.player.y) < 200;
      if (v.kind === 'gas') {
        if (emitVent(world, v) === 0) continue;
        // A vent reads as a vent: a puff of the bog's own green and, near enough, the hiss.
        ctx.particles.burst(v.x, v.y - 2, 2, null, marshGasColor, 0.5, { glow: 0.25, grav: -0.012 });
        if (nearby && frame % (v.rate * 3) < v.rate) ctx.audio.sfx('mat.steam', v.x, v.y - 3, { gain: 0.35 });
      } else {
        // A drip is a falling droplet that lands as a real cell (and splashes, if it lands in water).
        if (!dripReady(world, v)) continue;
        const colorOf = v.kind === 'slime' ? slimeColor : waterColor;
        for (let k = 0; k < v.burst && v.budget > 0; k++) {
          ctx.particles.spawn(v.x + (entityRandom() - 0.5) * 0.8, v.y + 1.5 + k, (entityRandom() - 0.5) * 0.12, 0.25, v.cell, colorOf(), 900, { deposit: true, grav: 0.12 });
          v.budget--;
        }
        if (nearby && frame % (v.rate * 4) < v.rate) ctx.audio.sfx('mat.drip', v.x, v.y + 2, { gain: 0.7 });
      }
    }
  }

  /**
   * Short Rations: whatever the alchemist heals in a tick is halved. Healing has a dozen sources
   * (potions, springs, regeneration, kills, pickups) and more arrive with every wave of content, so the
   * rule is read where they all meet, the health itself, not wired into each. A jump larger than
   * `HEAL_SET_PIECE` of maximum health in one tick is a rest or a respawn, not a heal, and stands.
   */
  private tickHealing(ctx: Ctx): void {
    const player = ctx.player;
    const healing = mutatorMods({ mutators: this.active }).healing;
    const now = performance.now();
    const gap = this.lastHealAt > 0 ? now - this.lastHealAt : 0;
    this.lastHealAt = now;
    if (healing < 1 && !player.dead && this.lastHp > 0 && player.hp > this.lastHp && gap <= MAX_TICK_GAP_MS) {
      const rise = player.hp - this.lastHp;
      if (rise <= Math.max(HEAL_SET_PIECE_MIN, player.maxHp * HEAL_SET_PIECE)) player.hp = this.lastHp + rise * healing;
    }
    this.lastHp = player.dead ? 0 : player.hp;
  }

  /* ---------------- fireworks ---------------- */

  private onKilled(kind: EnemyKind, x: number, y: number): void {
    const ctx = this.ctx;
    if (!this.has('fireworks') || ctx.state.mode !== 'play') return;
    if (this.pops.length >= POP_QUEUE_MAX || WARDENS.has(kind)) return;
    if (Math.hypot(x - ctx.player.x, y - ctx.player.y) > 700) return;
    this.pops.push({ x, y: y - 6, at: ctx.state.frameCount + POP_FUSE });
  }

  private tickPops(ctx: Ctx): void {
    if (this.pops.length === 0) return;
    const now = ctx.state.frameCount;
    const due = this.pops.filter((p) => p.at <= now);
    if (due.length === 0) return;
    this.pops = this.pops.filter((p) => p.at > now);
    for (const pop of due) this.burst(ctx, pop);
  }

  private burst(ctx: Ctx, pop: Pop): void {
    const palette = FIREWORK_PALETTES[Math.floor(entityRandom() * FIREWORK_PALETTES.length)];
    ctx.sparks?.burst(pop.x, pop.y, { count: 160, speed: 2.1, kind: 'spark', glow: 1.9, life: 52, radius: 1.5, colors: palette });
    ctx.sparks?.burst(pop.x, pop.y, { count: 40, speed: 0.9, kind: 'ember', glow: 1.3, life: 60, radius: 3, colors: palette });
    // The CPU path (and the partial contexts without GPU sparks) still sees a burst.
    ctx.particles.burst(pop.x, pop.y, 12, null, () => packRGB(255, 200 + Math.floor(entityRandom() * 55), 90), 2.2, { glow: 2.4, grav: 0.04 });
    ctx.audio.sfx('organism.emberbeetle.pop', pop.x, pop.y, { gain: 1.1 });
    ctx.audio.boom(5, pop.x, pop.y);
    ctx.fx.bloomKick = Math.min(0.95, (ctx.fx.bloomKick ?? 0) + 0.12);
    // The pop hurts what is near it. A creature caught in one may fall in its turn: the chain.
    for (const e of [...ctx.enemies]) {
      if (e.hp <= 0) continue;
      const dx = e.x - pop.x;
      const dy = e.y - 6 - pop.y;
      const d = Math.hypot(dx, dy);
      if (d > POP_RADIUS) continue;
      ctx.enemyCtl.damage(e, 5 + (1 - d / POP_RADIUS) * 9, (dx / (d || 1)) * 1.6, -1.2, 'detonated');
    }
    if (!ctx.player.dead) {
      const dx = ctx.player.x - pop.x;
      const dy = ctx.player.y - 8 - pop.y;
      const d = Math.hypot(dx, dy);
      if (d < POP_PLAYER_RADIUS) ctx.playerCtl.damage(3 + (1 - d / POP_PLAYER_RADIUS) * 4, (dx / (d || 1)) * 1.8, -1.4, 'explosion');
    }
  }
}

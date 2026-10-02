import { FIGHTER_DEFS, isFighterId } from '@/content/fighters';
import { bodyFor } from '@/content/fighterBodies';
import { FIGHTER_TECHNIQUES } from '@/content/fighterTechniques';
import { NEUTRAL_BODY, applyBodyMod, cloneBody, composeBody, type BodyProfile } from '@/core/fighterBody';
import { techniqueFor, type Technique } from '@/fighters/techniques';
import type { FighterId } from '@/content/fighters';
import { playerBlow } from '@/core/bossWard';
import { fightSink } from '@/core/fightSink';
import type { FightTag } from '@/core/fightSink';
import type {
  AbilitySlot, AbilityView, FighterApi, FighterDrawable, FighterSaveState, FighterView,
} from '@/core/fighters';
import { PLAYER_CRAWL_H, PLAYER_H, PLAYER_HALF_W, PLAYER_STEP_UP } from '@/core/types';
import type { Ctx, Enemy, EnemyDamageSource, Projectile } from '@/core/types';
import type { FighterKitDef, FighterMod, KitInstance } from '@/fighters/kit';
import { kitFor } from '@/fighters/kits';
import { FIGHTER_TUNING } from '@/fighters/tuning';
import { drawReveals } from '@/render/fighterReveal';
import { entityRandom } from '@/core/simRandom';
import type { AuthoredLight } from '@/core/types';

/** A move the system carries out for the body (a dash, a blink-in, a ram, a tether pull). */
export interface MovePlan {
  /** Ticks at most; the plan ends sooner when `step` returns null or the body is blocked. */
  ticks: number;
  /** Cells to travel this tick (the plan may read the player each call). null ends the move. */
  step(tick: number): { dx: number; dy: number } | null;
  /** Hold invulnerability for the move (ticks of `player.invuln` kept topped up). */
  invuln?: number;
  /** Face the direction of travel. */
  face?: boolean;
  /** Called every tick the body actually moved (a ram's hit test, a trail of fire). */
  onStep?(tick: number): void;
  /** The move ended: 'done' (ran its course), 'blocked' (a wall or ceiling), 'cancelled' (death, a new floor). */
  onEnd?(reason: 'done' | 'blocked' | 'cancelled'): void;
  /** Velocity (cells/tick) the body keeps when the move ends, so a dash hands back its momentum. */
  exitVx?: number;
  exitVy?: number;
}

interface ActiveMove {
  plan: MovePlan;
  tick: number;
  ax: number;
  ay: number;
}

interface EnemyFx {
  slowK: number;
  /** Time-dilation sequence position and its per-foe offset (see `enemyRuns`). */
  phase: number;
  seed: number;
  slowUntil: number;
  revealUntil: number;
  revealRgb: readonly [number, number, number];
  markUntil: number;
  stunUntil: number;
}

interface ModEntry {
  until: number;
  mod: FighterMod;
}

const NO_REVEAL: readonly [number, number, number] = [1, 1, 1];
const NO_IMMUNITY: readonly string[] = [];
/** The most armor a save may restore before the kit has set its own ceiling (the roster's largest is Kiln Heart's 80). */
const ARMOR_RESTORE_CAP = 100;
/** A kit's damage with no explicit tag counts as the tactical's for this many ticks after it fired (a ram or a thrown vial lands later). */
const TACTICAL_TAG_WINDOW = 120;

/**
 * THE FIGHTER SYSTEM (docs/FIGHTERS.md). Inert until a fighter is equipped (`id` null = the classic
 * Alchemist), and then it owns the three things every kit shares: the tactical cooldown, the ultimate's
 * charge and duration, and the machinery a kit's effects are made of (modifiers, enemy slow / stun /
 * reveal, a body-owning move, placed drawables, an armor pool). A kit (src/fighters/kits/<id>.ts) is
 * only the rules.
 *
 * Tick: right after the player moves and before the enemies think (Game.tick), so a dash that starts
 * this tick has already moved the body when the foes look at it. The engine's questions of a fighter
 * (`reduceIncoming`, `moveScale`, `enemySlow`, ...) are cached numbers, never a scan.
 */
export class FighterSystem implements FighterApi {
  id: FighterId | null = null;
  readonly view: FighterView = {
    id: null,
    technique: { name: '', state: 'idle', uses: 0, usedAt: -1 },
    tactical: blankAbility('tactical'),
    ultimate: blankAbility('ultimate'),
    armor: 0,
    armorMax: 0,
    meter: null,
  };
  readonly drawables: FighterDrawable[] = [];

  // ---- the equipped kit and its clocks ----
  private def: FighterKitDef | null = null;
  private kit: KitInstance | null = null;
  private tacticalCd = 0;
  private tacticalCdMax = 1;
  /** 0..1 */
  private charge = 0;
  private ultimateLeft = 0;
  private ultimateMax = 1;
  private pendingTactical = -1;
  private pendingUltimate = -1;
  private alive = false;
  private lastHp = -1;

  // ---- armor and modifiers ----
  armor = 0;
  armorMax = 0;
  private readonly mods = new Map<string, ModEntry>();
  private cMove = 1;
  private cClimb = 1;
  private cDamage = 1;
  private cStagger = false;
  private cConceal = 0;
  private cImmune: readonly string[] = NO_IMMUNITY;
  // ---- the body (core/fighterBody): the fighter's profile, the live composition with its running effects ----
  /** This fighter's movement technique (fighters/techniques): its own way of getting around. */
  private technique: Technique | null = null;
  private baseBody: Readonly<BodyProfile> = NEUTRAL_BODY;
  private readonly liveBody: BodyProfile = cloneBody(NEUTRAL_BODY);
  /** The health and levitation-tank factors already applied to the player, so a re-equip divides them out first. */
  private bodyHpApplied = 1;
  private bodyFuelApplied = 1;

  // ---- enemy effects ----
  private readonly enemyFx = new WeakMap<Enemy, EnemyFx>();
  /** Foes with a live effect (the render and the stun refresh walk this, never the WeakMap). */
  private readonly touched: Enemy[] = [];
  private revealing = 0;
  private readonly nearBuf: Enemy[] = [];
  /** Lights a kit has placed (a flash, a prism's glow): removed from the level when they lapse or the floor changes. */
  private readonly lights: Array<{ light: AuthoredLight; set: AuthoredLight[]; start: number; until: number; peak: number; fade: boolean }> = [];
  private meleeAt = -10;

  // ---- body-owning move ----
  private move: ActiveMove | null = null;
  /** True while a kit callback is running (guards a kit's own damage from re-entering its hooks). */
  private inKit = false;
  /** Attribution for a fight recorder (docs/arena/TELEMETRY-AND-BALANCE.md 3.2): the ability whose callback is running, the tag of the `hurt(...)` in flight, and when each ability last fired. */
  private inAbility: FightTag | null = null;
  private hitTag: FightTag | null = null;
  private readonly firedAt = { tactical: -1000, ultimate: -1000 };

  private readonly disposers: Array<() => void> = [];
  private readonly revealDrawable: FighterDrawable = {
    layer: 'over',
    draw: (out, field, ctx) => { drawReveals(out, field, ctx, this.touched, (e) => this.revealOf(e)); },
  };

  /** The kit's chunk is still loading (equip returns at once; abilities arrive when it lands). */
  private loading: Promise<void> = Promise.resolve();
  private pendingRestore: FighterSaveState | null = null;

  /** `kits` resolves a fighter id to its kit, now or later (tests pass their own). */
  constructor(
    readonly ctx: Ctx,
    private readonly kits: (id: FighterId) => FighterKitDef | Promise<FighterKitDef | undefined> | undefined = kitFor,
  ) {
    this.disposers.push(
      ctx.events.on('playerRespawned', () => this.resetAll()),
      ctx.events.on('playerDeathCleared', () => this.resetAll()),
      // A new floor: what was placed stays behind with the old World; the fighter itself carries on.
      ctx.events.on('levelChanged', () => this.onLevelChanged()),
    );
  }

  dispose(): void {
    this.teardown();
    for (const off of this.disposers.splice(0)) off();
  }

  // ======================================================================== equip

  equip(id: FighterId | null): void {
    this.teardown();
    this.id = id;
    this.def = null;
    this.kit = null;
    this.loading = Promise.resolve();
    // The numbers start clean BEFORE the kit is created, so a kit's create() may set its own armor ceiling.
    this.tacticalCd = 0;
    this.charge = 0;
    this.ultimateLeft = 0;
    this.armor = 0;
    this.armorMax = 0;
    this.lastHp = -1;
    this.pendingTactical = this.pendingUltimate = -1;
    this.baseBody = bodyFor(id);
    this.technique?.reset();
    this.technique = techniqueFor(id);
    this.view.technique.name = id ? FIGHTER_TECHNIQUES[id].name : '';
    this.recompute();
    this.applyBodyTank();
    this.firedAt.tactical = this.firedAt.ultimate = -1000;
    if (id) {
      const found = this.kits(id);
      if (found && typeof (found as Promise<unknown>).then === 'function') {
        this.loading = (found as Promise<FighterKitDef | undefined>).then((def) => {
          // Only if this fighter is still the chosen one when its chunk lands.
          if (def && this.id === id && this.kit === null) this.adopt(def);
        });
      } else if (found) this.adopt(found as FighterKitDef);
    }
    const adopted = this.def as FighterKitDef | null; // (adopt() may have set it above)
    this.tacticalCdMax = Math.max(1, adopted?.tacticalCooldown ?? 1);
    this.ultimateMax = Math.max(1, adopted?.ultimateDuration ?? 1);
    this.view.id = id;
    const copy = id ? FIGHTER_DEFS[id] : null;
    this.view.tactical.name = copy?.tactical.name ?? '';
    this.view.ultimate.name = copy?.ultimate.name ?? '';
    this.syncView();
  }

  /** Resolves once the equipped fighter's kit has loaded (immediately when it already had). */
  whenReady(): Promise<void> {
    return this.loading;
  }

  private adopt(def: FighterKitDef): void {
    this.def = def;
    const scope = this.bindScope;
    if (scope) scope(() => { this.kit = def.create(this); });
    else this.kit = def.create(this);
    this.tacticalCdMax = Math.max(1, def.tacticalCooldown);
    this.ultimateMax = Math.max(1, def.ultimateDuration);
    const copy = this.id ? FIGHTER_DEFS[this.id] : null;
    this.view.tactical.name = copy?.tactical.name ?? '';
    this.view.ultimate.name = copy?.ultimate.name ?? '';
    // A save that arrived before the chunk did is applied now.
    if (this.pendingRestore) {
      const save = this.pendingRestore;
      this.pendingRestore = null;
      this.restore(save);
    }
    this.syncView();
  }

  // ======================================================================== input

  press(slot: AbilitySlot): void {
    if (this.id === null) return;
    const now = this.ctx.state.frameCount;
    if (slot === 'tactical') this.pendingTactical = now;
    else this.pendingUltimate = now;
  }

  releaseInputs(): void { this.pendingTactical = this.pendingUltimate = -1; }

  // ======================================================================== tick

  update(ctx: Ctx): void {
    if (this.id === null || ctx.state.mode !== 'play') return;
    const p = ctx.player;
    const now = ctx.state.frameCount;
    if (p.dead) {
      if (this.alive) this.cancelEffects();
      this.alive = false;
      this.lastHp = -1;
      this.pendingTactical = this.pendingUltimate = -1;
      return;
    }
    this.alive = true;

    // What the fighter lost this tick, by whatever road (a blow, a hazard's drip, a status).
    if (this.lastHp >= 0 && this.lastHp - p.hp > 0.01) this.noteHurt(this.lastHp - p.hp);
    if (this.tacticalCd > 0) this.tacticalCd--;

    // Presses are latched between ticks and consumed here, inside the tick.
    const window = FIGHTER_TUNING.pressWindow;
    if (this.pendingTactical >= 0) {
      if (now - this.pendingTactical <= window) this.tryTactical(now);
      this.pendingTactical = -1;
    }
    if (this.pendingUltimate >= 0) {
      if (now - this.pendingUltimate <= window) this.tryUltimate(now);
      this.pendingUltimate = -1;
    }

    this.stepMove();
    this.expire(now);
    if (this.lights.length > 0) this.tickLights(now);
    this.keepStunned(now);

    if (this.ultimateLeft > 0) {
      this.ultimateLeft--;
      this.guard(() => this.kit?.ultimateTick?.(this.ultimateLeft + 1));
      if (this.ultimateLeft === 0) this.guard(() => this.kit?.ultimateEnd?.());
    } else this.charge = Math.min(1, this.charge + FIGHTER_TUNING.chargeTrickle);

    this.guard(() => this.kit?.tick?.());
    // (small test contexts have no input: a technique reads the keys a person presses, so it has nothing to read there)
    if (this.technique && ctx.input) this.guard(() => this.technique?.tick(this));
    this.lastHp = p.hp;
    this.syncView();
  }

  private tryTactical(now: number): void {
    const p = this.ctx.player;
    if (!this.kit || !this.def) return;
    if (this.rooted(p)) return this.refuse('tactical', now);
    if (this.tacticalCd > 0) {
      // A kit may answer a press while its tactical cools (Z lowers a raised plate): consumed, never a refusal.
      let again = false;
      if (this.kit.tacticalAgain) this.guard(() => { again = this.kit?.tacticalAgain?.() === true; });
      if (again) fightSink?.ability('tactical', 'again');
      else this.refuse('tactical', now);
      return;
    }
    let fired = false;
    this.inAbility = 'ability.tactical';
    this.guard(() => { fired = this.kit?.tactical() === true; });
    this.inAbility = null;
    if (!fired) return this.refuse('tactical', now);
    this.tacticalCd = this.tacticalCdMax = Math.max(1, this.def.tacticalCooldown);
    this.view.tactical.usedAt = now;
    this.firedAt.tactical = now;
    fightSink?.ability('tactical', 'fired');
  }

  private tryUltimate(now: number): void {
    const p = this.ctx.player;
    if (!this.kit || !this.def) return;
    if (this.ultimateLeft > 0 || this.charge < 1 || this.rooted(p)) return this.refuse('ultimate', now);
    let began = false;
    this.inAbility = 'ability.ultimate';
    this.guard(() => { began = this.kit?.ultimate() === true; });
    this.inAbility = null;
    if (!began) return this.refuse('ultimate', now);
    this.charge = 0;
    this.view.ultimate.usedAt = now;
    this.firedAt.ultimate = now;
    fightSink?.ability('ultimate', 'fired');
    if (this.def.ultimateDuration > 0) {
      this.ultimateLeft = this.ultimateMax = this.def.ultimateDuration;
    } else this.guard(() => this.kit?.ultimateEnd?.());
  }

  /** Rooted by a communion, a lever, or the ice: no ability. */
  private rooted(p: Ctx['player']): boolean {
    return p.recharge > 0 || p.pullT > 0 || (p.chill?.shell ?? 0) > 0;
  }

  private refuse(slot: AbilitySlot, now: number): void {
    if (slot === 'tactical') this.view.tactical.refusedAt = now;
    else this.view.ultimate.refusedAt = now;
    fightSink?.ability(slot, 'refused');
  }

  /**
   * A kit's reward for using its tactical well (Selene's recall): keep `keep` (0..1) of what is left of the
   * tactical's cooldown. Never lengthens it, never touches the ultimate.
   */
  scaleTacticalCooldown(keep: number): void {
    if (!(this.tacticalCd > 0) || !Number.isFinite(keep)) return;
    this.tacticalCd = Math.min(this.tacticalCd, Math.ceil(this.tacticalCd * Math.max(0, keep)));
    this.syncView();
  }

  // ======================================================================== charge

  addCharge(amount: number): void {
    if (this.id === null || !(amount > 0) || this.ultimateLeft > 0) return;
    const before = this.charge;
    this.charge = Math.min(1, this.charge + amount);
    if (before < 1 && this.charge >= 1) {
      const ctx = this.ctx;
      this.view.ultimate.readyAt = ctx.state.frameCount;
      ctx.audio.sfx('pickup.bell', ctx.player.x, ctx.player.y, { gain: 0.6, pitch: 1.25 });
      this.callout(`${this.view.ultimate.name.toUpperCase()} READY`);
    }
  }

  refill(): void {
    this.tacticalCd = 0;
    if (this.charge < 1) this.addCharge(1);
  }

  /** The harm the fighter did a foe, or the world did on its behalf (Enemies.damage calls this). */
  noteEnemyHurt(e: Enemy, amount: number, source: EnemyDamageSource, killed: boolean): void {
    if (this.id === null) return;
    const t = FIGHTER_TUNING;
    const share = playerBlow(source) ? 1 : t.chargeWorldShare;
    this.addCharge(Math.min(amount, e.maxHp) * t.chargeDealt * share + (killed ? t.chargeKill : 0));
    if (this.inKit) return; // a kit's own damage charges the bar but never re-enters the kit's hooks
    this.guard(() => this.kit?.onEnemyHurt?.(e, amount, source, killed));
  }

  private noteHurt(lost: number): void {
    this.addCharge(lost * FIGHTER_TUNING.chargeTaken);
    const source = this.ctx.player.lastDamageSource ?? undefined;
    this.guard(() => this.kit?.onPlayerHurt?.(lost, source));
  }

  // ======================================================================== modifiers and armor

  /**
   * Hold a modifier for `ticks` (refreshing one with the same id). Scales multiply, damage taken
   * multiplies, concealment takes the strongest, stagger resistance is any.
   */
  setMod(id: string, ticks: number, mod: FighterMod): void {
    this.mods.set(id, { until: this.ctx.state.frameCount + Math.max(1, ticks), mod });
    this.recompute();
  }

  clearMod(id: string): void {
    if (this.mods.delete(id)) this.recompute();
  }

  hasMod(id: string): boolean {
    return this.mods.has(id);
  }

  private expire(now: number): void {
    let changed = false;
    for (const [id, m] of this.mods) {
      if (now >= m.until) { this.mods.delete(id); changed = true; }
    }
    if (changed) this.recompute();
    // Enemy effects lapse on their own clocks; drop the foes with none left.
    if (this.touched.length > 0 && (now & 7) === 0) this.sweepTouched(now);
  }

  private recompute(): void {
    let move = 1, climb = 1, dmg = 1, conceal = 0, stagger = false;
    let immune: string[] | null = null;
    for (const { mod } of this.mods.values()) {
      if (mod.immuneTo) (immune ??= []).push(...mod.immuneTo);
      if (mod.moveScale !== undefined) move *= mod.moveScale;
      if (mod.climbScale !== undefined) climb *= mod.climbScale;
      if (mod.damageTaken !== undefined) dmg *= mod.damageTaken;
      if (mod.concealment !== undefined) conceal = Math.max(conceal, mod.concealment);
      if (mod.staggerResist) stagger = true;
    }
    this.cMove = move; this.cClimb = climb; this.cDamage = dmg; this.cConceal = conceal; this.cStagger = stagger;
    this.cImmune = immune ?? NO_IMMUNITY;
    composeBody(this.liveBody, this.baseBody, []);
    for (const { mod } of this.mods.values()) applyBodyMod(this.liveBody, mod);
  }

  /** The fighter's health and levitation tank, scaled once per equip against what the player already has (the ratio is kept). */
  private applyBodyTank(): void {
    const p = this.ctx.player;
    if (typeof p?.maxHp !== 'number' || typeof p.maxLevit !== 'number') return;
    const hpF = this.baseBody.maxHp;
    if (hpF !== this.bodyHpApplied && p.maxHp > 0) {
      const ratio = p.hp / p.maxHp;
      p.maxHp = Math.max(1, Math.round((p.maxHp / this.bodyHpApplied) * hpF));
      p.hp = Math.min(p.maxHp, ratio * p.maxHp);
      this.bodyHpApplied = hpF;
    }
    const fuelF = this.baseBody.jetFuel;
    if (fuelF !== this.bodyFuelApplied && p.maxLevit > 0) {
      const ratio = p.levit / p.maxLevit;
      p.maxLevit = Math.max(1, (p.maxLevit / this.bodyFuelApplied) * fuelF);
      p.levit = Math.min(p.maxLevit, ratio * p.maxLevit);
      this.bodyFuelApplied = fuelF;
    }
  }

  /** Raise the armor ceiling (a kit's call) and optionally fill the new room. */
  setArmorMax(max: number, fill = false): void {
    this.armorMax = Math.max(0, max);
    this.armor = fill ? this.armorMax : Math.min(this.armor, this.armorMax);
  }

  addArmor(amount: number): void {
    if (this.armorMax <= 0 || !(amount > 0)) return;
    this.armor = Math.min(this.armorMax, this.armor + amount);
  }

  // ---- the engine's questions (cheap and allocation-free) ----

  reduceIncoming(amount: number, source: string | undefined, kx = 0, ky = 0): number {
    if (this.id === null) return amount;
    if (source !== undefined && this.cImmune.length > 0 && this.cImmune.includes(source)) return 0;
    amount *= this.cDamage;
    // The kit's own say (a plate that halves a blow from the front): after the modifiers, before the armor.
    if (this.kit?.reduceIncoming && amount > 0) amount = this.kit.reduceIncoming(amount, source, kx, ky);
    if (this.armor > 0 && amount > 0) {
      const take = Math.min(this.armor, amount);
      this.armor -= take;
      amount -= take;
      this.armorStruck(take);
    }
    return amount;
  }

  isStunned(e: Enemy): boolean {
    const fx = this.enemyFx.get(e);
    return fx !== undefined && this.ctx.state.frameCount < fx.stunUntil;
  }

  /** ARENA (core/arena): kit creation runs through this on a rival's system, under that fighter's binding. */
  bindScope: ((fn: () => void) => void) | null = null;

  moveScale(): number { return this.cMove; }
  climbScale(): number { return this.cClimb * this.baseBody.climb; }
  /** The body the player controller reads (NEUTRAL_BODY for the classic Alchemist). */
  get body(): Readonly<BodyProfile> { return this.id === null ? NEUTRAL_BODY : this.liveBody; }
  climbHold(x: number, y: number): boolean { return this.kit?.climbHold?.(x, y) === true; }
  get staggerResist(): boolean { return this.cStagger; }
  get ownsMovement(): boolean { return this.move !== null; }

  concealment(): number {
    if (this.id === null) return 0;
    let c = this.cConceal;
    const k = this.kit?.concealment?.();
    if (k !== undefined && k > c) c = k;
    return c > 0.95 ? 0.95 : c;
  }

  enemySlow(e: Enemy): number {
    if (this.touched.length === 0) return 1;
    const fx = this.enemyFx.get(e);
    return fx && this.ctx.state.frameCount < fx.slowUntil ? fx.slowK : 1;
  }

  enemyRuns(e: Enemy): boolean {
    if (this.touched.length === 0) return true;
    const fx = this.enemyFx.get(e);
    if (!fx || this.ctx.state.frameCount >= fx.slowUntil || fx.slowK >= 1) return true;
    // A golden-ratio (Weyl) sequence: exactly the right long-run fraction of ticks, with no period an AI cadence
    // (every 6th or 8th tick) could line up with and never see.
    fx.phase++;
    return (fx.phase * 0.6180339887498949 + fx.seed) % 1 < fx.slowK;
  }

  decoyFor(e: Enemy): { x: number; y: number; vx: number } | null {
    return this.kit?.decoyFor?.(e) ?? null;
  }

  interceptProjectile(p: Projectile): boolean {
    return this.kit?.intercept?.(p) === true;
  }

  private armorStruck(amount: number): void {
    const ctx = this.ctx, p = ctx.player;
    ctx.particles.burst(p.x, p.y - 9, Math.min(8, 2 + amount * 0.3), null, () => 0xe8d8a8, 1.6, { glow: 1.2, grav: 0.02 });
  }

  // ======================================================================== enemy effects

  private fxOf(e: Enemy): EnemyFx {
    let fx = this.enemyFx.get(e);
    if (!fx) {
      fx = { slowK: 1, phase: 0, seed: entityRandom(), slowUntil: 0, revealUntil: 0, revealRgb: NO_REVEAL, markUntil: 0, stunUntil: 0 };
      this.enemyFx.set(e, fx);
    }
    if (!this.touched.includes(e)) this.touched.push(e);
    return fx;
  }

  slowEnemy(e: Enemy, factor: number, ticks: number): void {
    const fx = this.fxOf(e);
    const until = this.ctx.state.frameCount + ticks;
    // A harder slow wins; an equal one extends.
    if (until > fx.slowUntil || factor < fx.slowK) { fx.slowK = factor; fx.slowUntil = Math.max(fx.slowUntil, until); }
  }

  stunEnemy(e: Enemy, ticks: number): void {
    const fx = this.fxOf(e);
    fx.stunUntil = Math.max(fx.stunUntil, this.ctx.state.frameCount + ticks);
  }

  /** Show `e` through walls and darkness for `ticks` (the HUD's tell for Bloodsense, a bell, the spoor). */
  revealEnemy(e: Enemy, ticks: number, rgb: readonly [number, number, number] = NO_REVEAL): void {
    const fx = this.fxOf(e);
    const until = this.ctx.state.frameCount + ticks;
    if (this.revealOf(e) === undefined) this.revealing++;
    fx.revealUntil = Math.max(fx.revealUntil, until);
    fx.revealRgb = rgb;
    if (!this.drawables.includes(this.revealDrawable)) this.drawables.push(this.revealDrawable);
  }

  markEnemy(e: Enemy, ticks: number): void {
    const fx = this.fxOf(e);
    fx.markUntil = Math.max(fx.markUntil, this.ctx.state.frameCount + ticks);
  }

  isMarked(e: Enemy): boolean {
    const fx = this.enemyFx.get(e);
    return fx !== undefined && this.ctx.state.frameCount < fx.markUntil;
  }

  isRevealed(e: Enemy): boolean {
    return this.revealOf(e) !== undefined;
  }

  /** The reveal colour while `e` is revealed (the renderer reads this), else undefined. */
  revealOf(e: Enemy): readonly [number, number, number] | undefined {
    const fx = this.enemyFx.get(e);
    return fx && this.ctx.state.frameCount < fx.revealUntil ? fx.revealRgb : undefined;
  }

  /** Re-pin stunned foes each tick: a stun is the knock state held at zero velocity, so the AI stays off. */
  private keepStunned(now: number): void {
    for (const e of this.touched) {
      const fx = this.enemyFx.get(e);
      if (!fx || now >= fx.stunUntil) continue;
      e.knockVx = 0;
      e.knockVy = Math.max(0, e.knockVy ?? 0);
      e.knockT = Math.max(e.knockT ?? 0, 2);
    }
  }

  private sweepTouched(now: number): void {
    for (let i = this.touched.length - 1; i >= 0; i--) {
      const e = this.touched[i];
      const fx = this.enemyFx.get(e);
      const alive = this.ctx.enemies.includes(e);
      if (!fx || !alive || (now >= fx.slowUntil && now >= fx.revealUntil && now >= fx.markUntil && now >= fx.stunUntil)) {
        this.touched.splice(i, 1);
        if (fx) this.enemyFx.delete(e);
      }
    }
    this.revealing = this.touched.reduce((n, e) => n + (this.revealOf(e) !== undefined ? 1 : 0), 0);
    if (this.revealing === 0) {
      const at = this.drawables.indexOf(this.revealDrawable);
      if (at >= 0) this.drawables.splice(at, 1);
    }
  }

  /** Foes whose body centre is within `r` of (x, y), nearest first, in a buffer that is reused on the next call. */
  enemiesNear(x: number, y: number, r: number): readonly Enemy[] {
    const out = this.nearBuf;
    out.length = 0;
    const defs = this.ctx.enemyCtl.defs;
    for (const e of this.ctx.enemies) {
      const def = defs[e.kind];
      const dx = e.x - x, dy = e.y - (def ? def.h * 0.5 : 5) - y;
      const reach = r + (def ? def.halfW : 4);
      if (dx * dx + dy * dy <= reach * reach) out.push(e);
    }
    out.sort((a, b) => (a.x - x) ** 2 + (a.y - y) ** 2 - ((b.x - x) ** 2 + (b.y - y) ** 2));
    return out;
  }

  /**
   * A blow from the fighter (credited as the player's own). Kit hooks do not re-enter. `tag` names the ability
   * it belongs to for a fight recorder; left out, `attribute` infers it from what the fighter is doing.
   */
  hurt(e: Enemy, amount: number, kx: number, ky: number, tag?: FightTag): void {
    const was = this.inKit;
    const wasTag = this.hitTag;
    this.inKit = true;
    this.hitTag = tag ?? null;
    try { this.ctx.enemyCtl.damage(e, amount, kx, ky, 'direct'); } finally { this.inKit = was; this.hitTag = wasTag; }
  }

  /**
   * What the blow `Enemies.damage` is landing right now belongs to (a fight recorder asks inside its `hit` call).
   * The kit's own damage: the tag `hurt(...)` was given, else the ability whose callback is running, else the
   * one that fired most recently (a ram's steps land ticks after the press), else the passive. A blow that is
   * not the kit's: the kick, the wand ('spell'), or the world's own harm done on its behalf.
   */
  attribute(source: EnemyDamageSource): FightTag {
    if (this.hitTag !== null) return this.hitTag;
    if (this.inKit) {
      if (this.inAbility !== null) return this.inAbility;
      const now = this.ctx.state.frameCount;
      const tacticalAge = now - this.firedAt.tactical;
      const ultimateOn = this.ultimateLeft > 0 || now - this.firedAt.ultimate <= 2;
      const tacticalOn = tacticalAge <= TACTICAL_TAG_WINDOW;
      if (ultimateOn && tacticalOn) return this.firedAt.tactical > this.firedAt.ultimate ? 'ability.tactical' : 'ability.ultimate';
      if (ultimateOn) return 'ability.ultimate';
      return tacticalOn ? 'ability.tactical' : 'passive';
    }
    if (source !== 'direct') return 'world';
    return this.recentMelee ? 'kick' : 'spell';
  }

  // ======================================================================== the body-owning move

  startMove(plan: MovePlan): void {
    this.endMove('cancelled');
    const p = this.ctx.player;
    p.climbing = false;
    p.crouchT = 0;
    this.move = { plan, tick: 0, ax: 0, ay: 0 };
  }

  cancelMove(): void {
    this.endMove('cancelled');
  }

  private stepMove(): void {
    const m = this.move;
    if (!m) return;
    const ctx = this.ctx, p = ctx.player;
    const s = m.tick < m.plan.ticks ? m.plan.step(m.tick) : null;
    if (!s) return this.endMove('done');
    if (m.plan.invuln) p.invuln = Math.max(p.invuln, m.plan.invuln);
    if (m.plan.face && Math.abs(s.dx) > 0.01) p.facing = s.dx > 0 ? 1 : -1;
    m.ax += s.dx;
    m.ay += s.dy;
    const bodyH = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    let blocked = false;
    // Whole cells only, one at a time, so a wall stops the body where it is.
    while (!blocked && Math.abs(m.ax) >= 1) {
      const sx = m.ax > 0 ? 1 : -1;
      if (ctx.physics.tryMoveEntity(p, sx, 0, PLAYER_HALF_W, bodyH, PLAYER_STEP_UP)) m.ax -= sx;
      else blocked = true;
    }
    while (!blocked && Math.abs(m.ay) >= 1) {
      const sy = m.ay > 0 ? 1 : -1;
      if (ctx.physics.tryMoveEntity(p, 0, sy, PLAYER_HALF_W, bodyH, 0)) m.ay -= sy;
      else blocked = true;
    }
    p.vx = s.dx;
    p.vy = s.dy;
    p.fx = 0;
    p.fy = 0;
    p.grounded = !ctx.physics.entityFree(p.x, p.y + 1, PLAYER_HALF_W, 1);
    m.tick++;
    m.plan.onStep?.(m.tick);
    if (this.move !== m) return; // onStep started or cancelled another move
    if (blocked) this.endMove('blocked');
  }

  private endMove(reason: 'done' | 'blocked' | 'cancelled'): void {
    const m = this.move;
    if (!m) return;
    this.move = null;
    const p = this.ctx.player;
    if (reason !== 'cancelled') {
      p.vx = m.plan.exitVx ?? Math.max(-3, Math.min(3, p.vx));
      p.vy = m.plan.exitVy ?? Math.max(-3, Math.min(3, p.vy));
    }
    m.plan.onEnd?.(reason);
  }

  // ======================================================================== placed things

  /**
   * A light the level's lighting reads (a flash, a lantern, a prism) for `ticks`, fading over its last
   * third. It is removed when it lapses, when the floor changes and when the fighter dies, so it can
   * never be left behind in a level that persists.
   */
  addLight(
    x: number,
    y: number,
    spec: { rgb: readonly [number, number, number]; intensity: number; radius: number; bloom?: number; flicker?: number },
    ticks: number,
    fade = true,
  ): AuthoredLight | null {
    const rt = this.ctx.levels?.current;
    if (!rt) return null;
    const set = (rt.authoredLights ??= []);
    const light: AuthoredLight = {
      x, y, r: spec.rgb[0], g: spec.rgb[1], b: spec.rgb[2], intensity: spec.intensity, radius: spec.radius,
      bloom: spec.bloom ?? 0.4, flicker: spec.flicker ?? 0.08, flickerPhase: entityRandom() * 6.28, falloff: 'soft', occluded: true,
    };
    set.push(light);
    const now = this.ctx.state.frameCount;
    this.lights.push({ light, set, start: now, until: now + ticks, peak: spec.intensity, fade });
    return light;
  }

  private tickLights(now: number): void {
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      if (now >= l.until) { this.dropLight(i); continue; }
      if (l.fade) {
        const left = (l.until - now) / Math.max(1, l.until - l.start);
        l.light.intensity = l.peak * (left < 0.34 ? left / 0.34 : 1);
      }
    }
  }

  private dropLight(i: number): void {
    const l = this.lights[i];
    const at = l.set.indexOf(l.light);
    if (at >= 0) l.set.splice(at, 1);
    this.lights.splice(i, 1);
  }

  /** Mark this tick's blows as melee (a kick, a limb swing, a ram). */
  noteMelee(): void {
    this.meleeAt = this.ctx.state.frameCount;
  }

  /** True when a melee blow landed this tick or the last: a kill now was a melee kill. */
  get recentMelee(): boolean {
    return this.ctx.state.frameCount - this.meleeAt <= 1;
  }

  addDrawable(d: FighterDrawable): () => void {
    this.drawables.push(d);
    return () => {
      const at = this.drawables.indexOf(d);
      if (at >= 0) this.drawables.splice(at, 1);
    };
  }

  /** A short floating line over the fighter ("PHOENIX DRAFT READY"). */
  callout(text: string): void {
    const p = this.ctx.player;
    this.ctx.events.emit('combatCallout', { x: p.x, y: p.y - 24, text, tone: 'brass' });
  }

  // ======================================================================== lifecycle

  private guard(fn: () => void): void {
    const was = this.inKit;
    this.inKit = true;
    try { fn(); } finally { this.inKit = was; }
  }

  /** Stop everything running (a death, a floor, a new fighter) without touching the cooldowns. */
  private cancelEffects(): void {
    this.endMove('cancelled');
    if (this.ultimateLeft > 0) {
      this.ultimateLeft = 0;
      this.guard(() => this.kit?.ultimateEnd?.());
    }
    this.guard(() => this.kit?.reset?.());
    this.technique?.reset();
    for (let i = this.lights.length - 1; i >= 0; i--) this.dropLight(i);
    this.mods.clear();
    this.recompute();
    for (let i = this.drawables.length - 1; i >= 0; i--) {
      if (this.drawables[i] !== this.revealDrawable) this.drawables.splice(i, 1);
    }
    this.touched.length = 0;
    this.revealing = 0;
    const at = this.drawables.indexOf(this.revealDrawable);
    if (at >= 0) this.drawables.splice(at, 1);
  }

  private onLevelChanged(): void {
    if (this.id === null) return;
    this.cancelEffects();
    this.lastHp = -1;
  }

  /** A respawn or a cleared death: a fresh start for the same fighter. */
  private resetAll(): void {
    if (this.id === null) return;
    this.cancelEffects();
    this.tacticalCd = 0;
    this.charge = 0;
    this.armor = 0;
    this.lastHp = -1;
    this.firedAt.tactical = this.firedAt.ultimate = -1000;
    this.syncView();
  }

  reset(): void {
    this.resetAll();
  }

  private teardown(): void {
    this.cancelEffects();
    this.guard(() => this.kit?.dispose?.());
    this.kit = null;
    this.def = null;
  }

  // ======================================================================== save

  snapshot(): FighterSaveState | null {
    if (this.id === null) return null;
    return {
      v: 1,
      id: this.id,
      tacticalCooldown: this.tacticalCd,
      ultimateCooldown: 0,
      charge: this.charge,
      armor: this.armor,
      kit: this.kit?.save?.() ?? {},
    };
  }

  restore(save: FighterSaveState | null | undefined): void {
    if (!save || save.v !== 1 || !isFighterId(save.id)) return;
    if (this.id !== save.id) this.equip(save.id);
    // The kit's chunk may still be on its way: keep the save until it lands, then apply it whole.
    if (this.kit === null && this.def === null && this.kits(save.id) !== undefined) {
      this.pendingRestore = save;
      return;
    }
    const finite = (n: unknown, lo: number, hi: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0);
    this.tacticalCd = finite(save.tacticalCooldown, 0, this.tacticalCdMax);
    this.charge = finite(save.charge, 0, 1);
    // (a kit that raises its ceiling on its first tick has not yet: clamp to a sane cap, and the kit re-asserts its own ceiling, trimming the pool, when it ticks)
    this.armor = finite(save.armor, 0, Math.max(this.armorMax, ARMOR_RESTORE_CAP));
    if (this.kit?.load && save.kit && typeof save.kit === 'object') {
      const bag: Record<string, number> = {};
      for (const [k, v] of Object.entries(save.kit)) if (typeof v === 'number' && Number.isFinite(v)) bag[k] = v;
      this.kit.load(bag);
    }
    this.syncView();
  }

  // ======================================================================== view

  private syncView(): void {
    const v = this.view;
    const t = v.tactical, u = v.ultimate;
    t.cooldown = this.tacticalCd > 0 ? this.tacticalCd / this.tacticalCdMax : 0;
    t.cooldownSeconds = Math.ceil(this.tacticalCd / 60);
    t.ready = this.id !== null && this.tacticalCd <= 0 && this.alive;
    t.active = this.kit?.tacticalActive?.() ?? 0;
    t.charge = 1;
    u.charge = this.charge;
    u.active = this.ultimateLeft > 0 ? this.ultimateLeft / this.ultimateMax : 0;
    u.cooldown = 0;
    u.cooldownSeconds = 0;
    u.ready = this.id !== null && this.charge >= 1 && this.ultimateLeft <= 0 && this.alive;
    v.armor = this.armor;
    v.armorMax = this.armorMax;
    v.meter = this.kit?.meter?.() ?? null;
    const tech = this.technique;
    v.technique.state = tech?.state ?? 'idle';
    v.technique.uses = tech?.uses ?? 0;
    v.technique.usedAt = tech?.usedAt ?? -1;
  }
}

function blankAbility(slot: AbilitySlot): AbilityView {
  return { slot, name: '', ready: false, cooldown: 0, cooldownSeconds: 0, active: 0, charge: slot === 'tactical' ? 1 : 0, usedAt: -1, refusedAt: -1, readyAt: -1 };
}

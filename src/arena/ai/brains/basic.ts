import type { Ctx } from '@/core/types';
import { Rng } from '@/core/rng';
import { blankStatus } from '@/arena/ai/brain';
import type { Brain, BrainOptions, BrainSelf, BrainStatus } from '@/arena/ai/brain';
import { Control, leadPoint } from '@/arena/ai/control';
import { Execution } from '@/arena/ai/execution';
import type { PerceivedFoe } from '@/arena/ai/execution';
import { MELEE_STYLE, chooseIntent, styleFor, traitsOf } from '@/arena/ai/intent';
import type { IntentId, Style } from '@/arena/ai/intent';
import { edgeKey, stageNavFor } from '@/arena/ai/nav';
import type { NavEdge, StageNav } from '@/arena/ai/nav';
import { buildWorldView, createWorldView, lineClear } from '@/arena/ai/worldView';
import type { WorldView } from '@/arena/ai/worldView';
import type { AiLevel } from '@/config/aiTiers';
import { YARD } from '@/world/fighterArena';

/**
 * THE BASIC BRAIN (v1, docs/arena/AI-FIGHTERS.md 7): one shared behaviour for all ten fighters (the playbooks of v2 layer
 * on top). Per decision it picks a goal and a foe (`intent.ts`), and every tick it walks to a good range with traction-aware
 * braking, aims with lead, holds the wand's trigger when the line is clear, kicks anything inside the kick cone, hops
 * what is in the way, climbs to a foe on another surface by the stage's nav edges, presses Z when a foe is within its tip
 * range and T when three foes crowd it or its health is low, and shakes itself loose when the stuck detector fires.
 *
 * It writes only what a person's hands write (`Control.Hand`), and perceives only what is on screen (`worldView.ts`) as it
 * was `reaction` ticks ago (`execution.ts`).
 */

/** The bolt's muzzle speed (params.spells.bolt.velocityForce): a spark card's flight time for the lead. */
const SHOT_SPEED = 9.5;
/** Beyond this the bolt's life runs out before it arrives (PROJECTILE_LIFE.bolt is far longer, but aim error makes it a waste). */
const SHOOT_RANGE = 250;
/** A bolt bursts within `explosionRadius * 1.5` of where it lands and the burst hurts the shooter: stay clear of that. */
const SELF_BLAST = 13;
const ESCAPE_TICKS = 50;
/** A ready ability a bot has not used in this long is pressed on any foe in sight (hoarding is not a plan). */
const Z_HOARD = 480;
const T_HOARD = 900;
const PRESS_GAP = 30;
const RESPAWN_AFTER = 100;

export class BasicBrain implements Brain {
  readonly id = 'basic' as const;
  readonly status: BrainStatus = blankStatus();
  private readonly rng: Rng;
  private readonly exec: Execution;
  private readonly view: WorldView = createWorldView();
  private control: Control | null = null;
  private world: Ctx | null = null;
  private nav: StageNav | null = null;
  private navFor: string | undefined;

  // ---- the plan (re-made every decision) ----
  private intent: IntentId = 'search';
  private intentSince = 0;
  private targetRef: object | null = null;
  private range = 0;
  private goalX: number | null = null;
  private noShotTicks = 0;
  private readonly blocked = new Set<string>();
  private blockedAt = 0;
  private edgeTarget: string | null = null;

  // ---- what the hands did last ----
  private lastKick = -999;
  private lastZ = -999;
  private lastT = -999;
  private zReadySince = -1;
  private tReadySince = -1;
  private deadSince = -1;
  private holding = false;
  private wasHolding = false;

  constructor(private readonly opts: BrainOptions) {
    this.rng = new Rng(opts.seed);
    this.exec = new Execution(this.rng, opts.level);
  }

  get level(): AiLevel {
    return this.exec.level;
  }

  set level(level: AiLevel) {
    this.exec.level = level;
  }

  reset(): void {
    this.control?.reset();
    this.exec.reset();
    this.intent = 'search';
    this.intentSince = 0;
    this.targetRef = null;
    this.goalX = null;
    this.edgeTarget = null;
    this.blocked.clear();
    this.noShotTicks = 0;
    this.zReadySince = this.tReadySince = -1;
    this.deadSince = -1;
    this.holding = this.wasHolding = false;
    const stats = this.status.stats;
    for (const k of Object.keys(stats)) stats[k] = 0;
    Object.assign(this.status, { intent: 'idle', target: '-', rule: '', aim: null, goalX: null, range: 0, idleTicks: 0 });
  }

  private controlFor(ctx: Ctx, self: BrainSelf): Control {
    if (this.control === null || this.world !== ctx) {
      this.world = ctx;
      this.control = new Control(self, { free: (x, y, hw, h) => ctx.physics.entityFree(x, y, hw, h) }, ctx.params.player.groundStopDecay);
    }
    return this.control;
  }

  think(ctx: Ctx, self: BrainSelf, tick: number): void {
    const control = this.controlFor(ctx, self);
    const hand = control.hand;
    hand.begin();
    const st = this.status;
    const p = self.player;

    // ---- the dead do not act; a person presses R after a beat ----
    if (p.dead) {
      if (this.deadSince < 0) { this.deadSince = tick; control.reset(); this.exec.reset(); this.targetRef = null; this.edgeTarget = null; }
      st.intent = 'dead';
      st.rule = 'down';
      st.aim = null;
      if (tick - this.deadSince >= RESPAWN_AFTER) { self.hands.respawn(); this.deadSince = tick; }
      hand.end();
      return;
    }
    this.deadSince = -1;

    // ---- the stage's nav (the level can change under a running bot) ----
    const levelId = ctx.levels?.current?.def.id;
    if (this.navFor !== levelId) { this.navFor = levelId; this.nav = stageNavFor(levelId); this.blocked.clear(); }

    // ---- see ----
    const view = buildWorldView(ctx, self, tick, this.view);
    const me = view.me;
    this.exec.record(view);
    control.observe(me, tick);
    const foes = this.exec.perceive(view);
    if (tick - this.blockedAt > 1200 && this.blocked.size > 0) { this.blocked.clear(); this.blockedAt = tick; }

    // ---- decide (on the bot's own beat, or at once when it has no foe to act on) ----
    let target = this.find(foes, this.targetRef);
    if (target === null || this.exec.decisionDue(tick)) {
      this.decide(ctx, self, foes, tick);
      target = this.find(foes, this.targetRef);
    }
    const lapse = this.exec.lapse;
    const whiff = this.exec.lapsing('whiff', tick);

    // ---- act: walking ----
    const nav = this.nav;
    this.holding = false;
    if (target === null && foes.length === 0) {
      st.target = '-';
      st.aim = null;
      this.moveToGoal(ctx, me, tick);
    } else {
      this.moveToGoal(ctx, me, tick);
    }
    if (this.exec.lapsing('misstep', tick) && lapse !== null && !control.committed) {
      control.hand.move(lapse.dir); // a stumble: a few ticks the wrong way
      st.rule = 'misstep';
    }

    // ---- act: aiming, shooting, kicking, abilities ----
    if (target !== null) this.fight(ctx, self, view, foes, target, tick, whiff);
    else { hand.fire(false); st.aim = null; st.target = '-'; }

    // ---- the stuck detector: the same place for 3 s while the goal said move ----
    const goalX = this.goalX;
    const wantsMove = control.activeEdge !== null || (goalX !== null && Math.abs(goalX - me.x) > 10 && this.intent !== 'zone');
    if (control.stuck.update(me, wantsMove && foes.length > 0 && !p.dead, tick)) {
      st.stats.stuck++;
      const edge = control.activeEdge;
      if (edge !== null) { this.blocked.add(edgeKey(edge)); this.blockedAt = tick; control.cancelEdge(); this.edgeTarget = null; }
      const away = goalX !== null && goalX > me.x ? -1 : 1;
      control.startEscape(this.rng.next() < 0.7 ? away : -away, ESCAPE_TICKS);
      st.rule = 'stuck: shaking loose';
    }
    void nav;

    hand.end();
    st.idleTicks = hand.idle;
    if (foes.length > 0 && hand.idle > st.stats.idleMax) st.stats.idleMax = hand.idle;
    st.stats.hops = control.hops;
    st.stats.lapses = this.exec.lapses;
  }

  private find(foes: readonly PerceivedFoe[], ref: object | null): PerceivedFoe | null {
    if (ref === null) return null;
    for (const f of foes) if (f.foe.ref === ref) return f;
    return null;
  }

  // ====================================================================================================== deciding

  private decide(ctx: Ctx, self: BrainSelf, foes: readonly PerceivedFoe[], tick: number): void {
    const view = this.view;
    const me = view.me;
    const control = this.control;
    if (control === null) return;
    const exec = this.exec;
    exec.decided(tick);
    if (exec.lapsing('hesitate', tick) && this.targetRef !== null && this.find(foes, this.targetRef) !== null) {
      this.status.rule = 'hesitates';
      return; // a lapse: the old plan stands for this beat
    }
    const nav = this.nav;
    const cellBlocks = (x: number, y: number): boolean => ctx.physics.cellBlocks(x, y);
    const hasLine = (f: PerceivedFoe): boolean => lineClear(cellBlocks, me.x, me.sy, f.cx, f.cy);
    const myNode = nav?.nodeAt(me.x, me.y) ?? null;

    // a foe the bot cannot reach and cannot see a line to (the sealed cell's) is not a target; a roosting one is not either
    const engageable: PerceivedFoe[] = [];
    for (const f of foes) {
      if (f.foe.sleeping) continue;
      if (nav !== null && f.foe.grounded && nav.nodeAt(f.x, f.y) === null && !hasLine(f)) continue;
      engageable.push(f);
    }

    const style: Style = me.shotAffordable ? styleFor(me.fighter) : MELEE_STYLE;
    const choice = chooseIntent({
      me,
      foes: engageable,
      style,
      current: this.intent,
      heldFor: tick - this.intentSince,
      currentTarget: this.targetRef,
      otherLevel: (f) => nav !== null && f.foe.grounded && myNode !== null && (nav.nodeAt(f.x, f.y)?.id ?? myNode.id) !== myNode.id && !hasLine(f),
      noShotTicks: this.noShotTicks,
    });
    if (choice.intent !== this.intent) { this.intent = choice.intent; this.intentSince = tick; }
    this.targetRef = choice.target?.foe.ref ?? null;
    this.range = choice.range;
    const target = choice.target;
    const st = this.status;
    st.intent = this.intent;
    st.range = this.range;

    // ---- the goal: a place to walk to (or an edge of the nav to run) ----
    if (target === null) {
      this.edgeTarget = null;
      this.goalX = this.nav?.patrolX ?? YARD.ring.cx;
      return;
    }
    const dx = target.cx - me.x;
    const dir = Math.sign(dx) || me.facing || 1;
    // the nav: a foe on another surface that cannot be shot from here is walked, hopped or levitated to
    if (nav !== null && myNode !== null && this.intent === 'reposition') {
      const toNode = nav.nodeAt(target.x, target.y);
      if (toNode !== null && toNode.id !== myNode.id) {
        const route = nav.route(myNode.id, toNode.id, this.blocked);
        if (route !== null && route.length > 0) {
          this.startEdgeIfNew(control, route[0]);
          return;
        }
      }
    }
    if (control.activeEdge !== null && !control.committed) { control.cancelEdge(); this.edgeTarget = null; }
    const x0 = YARD.x0 + 28;
    const x1 = YARD.x1 - 28;
    const lo = this.range - style.band;
    const hi = this.range + style.band;
    switch (this.intent) {
      case 'approach':
        this.goalX = target.cx - dir * (hi - 6);
        break;
      case 'retreat': {
        const away = me.x - dir * 70;
        const g = Math.max(x0, Math.min(x1, away));
        // cornered: no room to run, so stand and fight
        this.goalX = Math.abs(g - me.x) < 12 ? me.x : g;
        break;
      }
      case 'pressure':
        this.goalX = target.cx - dir * 14;
        break;
      case 'reposition':
        this.goalX = target.cx - dir * Math.min(30, lo);
        break;
      case 'zone':
      default: {
        const ax = Math.abs(dx);
        this.goalX = ax < lo ? me.x - dir * (lo - ax + 4) : ax > hi ? me.x + dir * (ax - hi + 4) : me.x;
        break;
      }
    }
    void self;
  }

  private startEdgeIfNew(control: Control, edge: NavEdge): void {
    const key = edgeKey(edge);
    if (this.edgeTarget === key && control.activeEdge !== null) return;
    this.edgeTarget = key;
    control.startEdge(edge);
    this.status.stats.edges++;
    this.status.rule = `${edge.kind} ${edge.from} -> ${edge.to}`;
  }

  // =========================================================================================================== moving

  private moveToGoal(ctx: Ctx, me: WorldView['me'], tick: number): void {
    const control = this.control;
    if (control === null) return;
    const edge = control.activeEdge;
    if (edge !== null) {
      const onTarget = this.nav?.nodeAt(me.x, me.y)?.id === edge.to;
      const status = control.runEdge(me, onTarget);
      if (status === 'running') { this.status.goalX = edge.landX; return; }
      if (status === 'failed') { this.blocked.add(edgeKey(edge)); this.blockedAt = tick; }
      this.edgeTarget = null;
      this.goalX = null;
      this.status.goalX = null;
      // after an edge the next decision picks the next leg; until then, stand
      return;
    }
    const goalX = this.goalX;
    this.status.goalX = goalX;
    if (goalX === null) { control.hold(me); return; }
    const tol = this.intent === 'pressure' ? 4 : this.intent === 'retreat' ? 8 : 6;
    if (this.intent === 'zone' && Math.abs(goalX - me.x) < 2) control.hold(me);
    else control.walkTo(me, goalX, { tol });
    void ctx;
  }

  // ========================================================================================================= fighting

  private fight(ctx: Ctx, self: BrainSelf, view: WorldView, foes: readonly PerceivedFoe[], target: PerceivedFoe, tick: number, whiff: boolean): void {
    const me = view.me;
    const control = this.control;
    if (control === null) return;
    const hand = control.hand;
    const st = this.status;
    const t = this.exec.tier;
    const cellBlocks = (x: number, y: number): boolean => ctx.physics.cellBlocks(x, y);
    const shoulder = { x: me.x, y: me.sy };

    // ---- aim: lead the foe by what the bot knows of its motion, then the hand's wobble ----
    const speed = Math.hypot(target.vx, target.vy);
    const err = this.exec.tickAim(speed);
    const aim = leadPoint(shoulder, target, SHOT_SPEED, err);
    hand.aim(aim.x, aim.y);
    st.aim = aim;
    const d = target.dist;
    st.target = `${target.foe.kind} ${Math.round(d)}`;
    const line = lineClear(cellBlocks, shoulder.x, shoulder.y, target.cx, target.cy);
    if (d < this.range + 30 && !line) this.noShotTicks++;
    else this.noShotTicks = 0;

    // ---- the wand: the trigger is held while the shot is clear, in range and not too close to burst on its owner ----
    const margin = traitsOf(target.foe.kind).reach > 0 ? 0 : 0;
    const closeEnough = d <= SHOOT_RANGE && d >= SELF_BLAST + target.foe.halfW * 0.5 + margin;
    const fire = closeEnough && line && me.shotAffordable && !whiff && !me.climbing;
    hand.fire(fire);
    if (fire && !this.wasHolding) st.stats.shots++;
    this.wasHolding = fire;
    if (fire) st.rule = 'shoot';
    else if (!line && d < SHOOT_RANGE) st.rule = 'no line of fire';
    else if (d < SELF_BLAST) st.rule = 'too close to shoot';

    // ---- the kick: anything inside the cone, off cooldown ----
    const lp = ctx.params.player;
    const dirX = Math.cos(self.player.aimAngle);
    const dirY = Math.sin(self.player.aimAngle);
    const ox = me.x + dirX * 3;
    const oy = me.y - 8 + dirY * 3;
    const cosArc = Math.cos(lp.kickArc);
    if (!whiff && !me.climbing && tick - this.lastKick >= lp.kickCooldown + 1) {
      for (const f of foes) {
        const fx = f.x - ox;
        const fy = f.y - 5 - oy;
        const fd = Math.hypot(fx, fy) || 1;
        if (fd > lp.kickRange + 4) continue; // (the game's reach is kickRange + 6; a margin for a foe stepping away)
        if ((fx / fd) * dirX + (fy / fd) * dirY < cosArc + 0.05) continue;
        self.hands.kick();
        hand.pressed();
        this.lastKick = tick;
        st.stats.kicks++;
        st.rule = `kick ${f.foe.kind}`;
        break;
      }
    }

    // ---- Z and T ----
    const view2 = self.fighters?.view;
    if (view2 === undefined || me.fighter === null) return;
    const style = styleFor(me.fighter);
    if (me.tactical.ready) { if (this.zReadySince < 0) this.zReadySince = tick; } else this.zReadySince = -1;
    if (me.ultimate.ready) { if (this.tReadySince < 0) this.tReadySince = tick; } else this.tReadySince = -1;
    if (whiff) return;
    if (me.tactical.ready && tick - this.lastZ >= PRESS_GAP) {
      const inTip = d >= style.z[0] && d <= style.z[1] && (line || d < 40);
      const hoarded = tick - this.zReadySince >= Z_HOARD && d < 220;
      if (inTip || hoarded) {
        self.hands.press('tactical');
        hand.pressed();
        this.lastZ = tick;
        st.stats.z++;
        st.rule = inTip ? `Z: foe at ${Math.round(d)}, tip range ${style.z[0]}-${style.z[1]}` : 'Z: ready too long';
      }
    } else if (!me.tactical.ready && tick % 30 === 0 && d < style.z[1]) {
      if (st.rule === '' || st.rule.startsWith('Z waits')) st.rule = `Z waits: cooling ${me.tactical.cooldownSeconds}s`;
    }
    if (me.ultimate.ready && tick - this.lastT >= PRESS_GAP) {
      let near = 0;
      for (const f of foes) if (f.dist < 160) near++;
      const crowd = near >= 3;
      const low = me.hpFrac < 0.4 && near >= 1;
      const hoarded = tick - this.tReadySince >= T_HOARD && d < 200;
      if (crowd || low || hoarded) {
        self.hands.press('ultimate');
        hand.pressed();
        this.lastT = tick;
        st.stats.t++;
        st.rule = crowd ? `T: ${near} foes close` : low ? 'T: health low' : 'T: ready too long';
      }
    }
    void t;
  }
}

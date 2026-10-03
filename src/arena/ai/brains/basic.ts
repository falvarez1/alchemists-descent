import type { Ctx } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { Rng } from '@/core/rng';
import { blankStatus } from '@/arena/ai/brain';
import type { Brain, BrainOptions, BrainSelf, BrainStatus } from '@/arena/ai/brain';
import { Control, leadPoint } from '@/arena/ai/control';
import { Execution } from '@/arena/ai/execution';
import type { PerceivedFoe } from '@/arena/ai/execution';
import { chooseIntent, styleFor } from '@/arena/ai/intent';
import type { IntentId, Style } from '@/arena/ai/intent';
import { edgeKey, stageNavFor } from '@/arena/ai/nav';
import type { NavEdge, StageNav } from '@/arena/ai/nav';
import { buildWorldView, createWorldView, lineClear } from '@/arena/ai/worldView';
import type { WorldView } from '@/arena/ai/worldView';
import { abilityPlan } from '@/arena/ai/playbooks';
import { incomingShot, safeDrop, safeFooting, safeTravel, safeMobilityLanding, hazardHopClearance, weaponLaneClear } from '@/arena/ai/combat';
import { AI_BEHAVIOR } from '@/config/aiBehavior';
import type { AiLevel } from '@/config/aiTiers';
import { YARD } from '@/world/fighterArena';
import { DUEL } from '@/world/duelStage';
import { STOCK_STAGE } from '@/config/stockStage';
import { STOCK_DODGE } from '@/config/stockMovement';
import { stockMoveset } from '@/config/stockAttacks';
import { stockAttackOverlaps } from '@/arena/StockAttack';
import { StockFootwork } from '@/arena/ai/stockFootwork';
import { AI_PERSONALITIES } from '@/config/aiPersonalities';
import type { PersonalityId } from '@/config/aiPersonalities';
import { CombatMemory } from '@/arena/ai/memory';
import type { ObservedHit } from '@/arena/ai/memory';
import { actionUtilities, selectAction, targetUtilities } from '@/arena/ai/utility';
import type { CombatAction } from '@/arena/ai/utility';

/**
 * Shared Arena/Duel combat brain. Chooses a target and firing distance, changes its footwork,
 * recovers mana, reacts to projectiles and uses each fighter's ability playbook. Runtime tuning
 * lives in config/aiBehavior.ts; execution skill remains in config/aiTiers.ts.
 *
 * It writes only what a person's hands write (`Control.Hand`), and perceives only what is on screen (`worldView.ts`) as it
 * was `reaction` ticks ago (`execution.ts`).
 */

const ESCAPE_TICKS = 50;
const PRESS_GAP = 30;
const RESPAWN_AFTER = 100;

export class BasicBrain implements Brain {
  readonly id = 'basic' as const;
  readonly status: BrainStatus = blankStatus();
  private readonly rng: Rng;
  personality: PersonalityId;
  private readonly memory: CombatMemory;
  private action: CombatAction = 'wait';
  private actionUntil = 0;
  private nextAction = 0;
  private actionThreatened = false;
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
  private lastWand = -999;
  private nextCornerEscape = 0;
  private recovering = false;
  private strafeUntil = 0;
  private strafeDir = 1;
  private dodgeUntil = 0;
  private nextDodge = 0;
  private dodgeDir = 0;
  private dodgeJump = false;
  private threatened = false;
  private deadSince = -1;
  private wasHolding = false;
  private readonly stockFootwork = new StockFootwork();

  constructor(opts: BrainOptions) {
    this.rng = new Rng(opts.seed);
    this.exec = new Execution(this.rng, opts.level);
    this.personality = opts.personality ?? 'duelist';
    this.memory = new CombatMemory(opts.slot);
  }

  observeHit(hit: ObservedHit): void { this.memory.hear(hit); }
  actionPerformed(action: string): void {
    if (this.memory.lastAction === action) this.status.stats.repeatedActions = (this.status.stats.repeatedActions ?? 0) + 1;
    this.memory.acted(action);
    if (action === 'shoot') this.status.stats.attacks = (this.status.stats.attacks ?? 0) + 1;
  }

  get level(): AiLevel {
    return this.exec.level;
  }

  set level(level: AiLevel) {
    this.exec.level = level;
  }

  reset(): void {
    this.stockFootwork.reset();
    this.control?.reset();
    this.exec.reset();
    this.memory.reset();
    this.action = 'wait'; this.nextAction = this.actionUntil = 0; this.actionThreatened = false;
    this.status.action = 'wait'; this.status.scores = []; this.status.targetScores = [];
    this.status.memory = { opponents: 0, confidence: 0, caution: 0 };
    this.intent = 'search';
    this.intentSince = 0;
    this.targetRef = null;
    this.goalX = null;
    this.edgeTarget = null;
    this.blocked.clear();
    this.noShotTicks = 0;
    this.recovering = false;
    this.threatened = this.dodgeJump = false;
    this.dodgeDir = 0;
    this.status.threat = false;
    this.strafeUntil = this.dodgeUntil = this.nextDodge = 0;
    this.nextCornerEscape = 0;
    this.lastKick = this.lastZ = this.lastT = this.lastWand = -999;
    this.range = 0;
    this.deadSince = -1;

    this.wasHolding = false;
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
    const personality = AI_PERSONALITIES[this.personality];
    st.personality = this.personality;
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

    const ledge = ctx.arena?.stockMatch ? ctx.arena.stockLedge(self.slot) : null;
    if (ledge?.busy) {
      hand.move(ledge.side); self.input.keys.up = true; hand.down(false); hand.jump(false); hand.fire(false);
      st.intent = 'recover'; st.rule = 'climb from the ledge'; hand.end(); return;
    }

    // ---- the stage's nav (the level can change under a running bot) ----
    // Offstage survival takes priority over aiming or attacking. Inputs still use the normal body controller.
    if (ctx.arena?.stockMatch && (p.y > STOCK_STAGE.main.y + 5 || p.x < STOCK_STAGE.main.x0 - 8 || p.x > STOCK_STAGE.main.x1 + 8) && !p.grounded) {
      const main = STOCK_STAGE.main;
      // Rise beside the lip first; steering under a solid platform cannot recover through its underside.
      const under = p.y > main.y - 8;
      const target = under ? (p.x < STOCK_STAGE.center.x ? main.x0 - 12 : main.x1 + 12) : Math.max(main.x0 + 18, Math.min(main.x1 - 18, p.x));
      hand.move(Math.abs(target - p.x) > 4 ? Math.sign(target - p.x) : 0);
      // A held recovery request is edge-triggered. Do not spend that edge on the final locked stun tick.
      self.input.keys.up = ctx.arena.canRecover(self.slot) && !ctx.arena.isActionLocked(self.slot);
      hand.down(false); hand.jump(true); hand.fire(false);
      st.intent = 'recover'; st.rule = 'rise beside the ledge, then return'; st.goalX = target;
      hand.end(); return;
    }
    if (ctx.arena?.stockMatch) self.input.keys.up = false;
    const levelId = ctx.arena?.stockMatch ? 'fighter-stock' : ctx.levels?.current?.def.id;
    if (this.navFor !== levelId) { this.navFor = levelId; this.nav = stageNavFor(levelId); this.blocked.clear(); }

    // ---- see ----
    const view = buildWorldView(ctx, self, tick, this.view);
    const me = view.me;
    this.exec.record(view);
    control.observe(me, tick);
    const foes = this.exec.perceive(view);
    const shots = this.exec.perceiveShots(view);
    this.memory.update(tick, me.hp, me.maxHp, foes, shots);
    st.memory = { opponents: this.memory.opponents.size, confidence: this.memory.confidence, caution: this.memory.caution };
    const incoming = incomingShot(me, shots, (x0, y0, x1, y1) => lineClear((x, y) => ctx.physics.cellBlocks(x, y), x0, y0, x1, y1));
    this.threatened = incoming !== null;
    st.threat = this.threatened;
    if (this.recovering) this.recovering = me.manaFrac < AI_BEHAVIOR.manaResume;
    else this.recovering = !me.shotAffordable || me.manaFrac < AI_BEHAVIOR.manaReserve;
    if (tick - this.blockedAt > 1200 && this.blocked.size > 0) { this.blocked.clear(); this.blockedAt = tick; }

    // ---- decide (on the bot's own beat, or at once when it has no foe to act on) ----
    let target = this.find(foes, this.targetRef);
    if ((target === null && (this.targetRef !== null || foes.length > 0)) || this.exec.decisionDue(tick)) {
      this.decide(ctx, self, foes, tick);
      target = this.find(foes, this.targetRef);
    }
    // Rusk's bomb needs room; his equipped flame wand is the close-range weapon.
    // Check the actual loadout so custom loadouts never acquire an unowned weapon.
    if (target && me.fighter === 'rusk-emberjaw' && tick - this.lastWand >= AI_BEHAVIOR.weaponSwapTicks) {
      const wands = ctx.wands;
      const want: 0 | 1 = target.dist < 145 ? 1 : target.dist > 190 ? 0 : wands.active;
      if (want !== wands.active && wands.wands[0].cards.includes('bomb') && wands.wands[1].cards.includes('flame')) {
        hand.fire(false);
        self.player.firePressed = false;
        self.hands.wand(want);
        this.lastWand = tick;
        st.stats.swaps++;
        buildWorldView(ctx, self, tick, this.view);
        this.recovering = !me.shotAffordable;
        this.decide(ctx, self, foes, tick);
      }
    }
    // Choose inputs before footwork so a defensive commitment can request an evasion this tick.
    if (target !== null) this.fight(ctx, self, view, foes, target, tick);
    else { hand.fire(false); st.aim = null; st.target = '-'; this.action = 'wait'; }
    if (target) {
      st.stats.combatTicks = (st.stats.combatTicks ?? 0) + 1;
      st.stats.distanceTotal = (st.stats.distanceTotal ?? 0) + target.dist;
      st.stats[this.intent + 'Ticks'] = (st.stats[this.intent + 'Ticks'] ?? 0) + 1;
    }

    // ---- act: walking ----
    this.moveToGoal(ctx, me, tick);
    if (!control.committed || control.activeEdge === null) {
      if (incoming && (this.action === 'defend' || incoming.ticks <= 3) && tick >= this.nextDodge &&
        (me.grounded || me.levit > AI_BEHAVIOR.dodgeLevitReserve) && !me.climbing && self.player.stunT <= 0 && self.player.pullT <= 0) {
        const dir = Math.sign(me.x - incoming.shot.x) || this.strafeDir;
        this.dodgeJump = Math.abs(incoming.shot.vx) >= Math.abs(incoming.shot.vy) && ctx.physics.entityFree(me.x, me.y - 24, PLAYER_HALF_W, PLAYER_H);
        const dodgeDistance = ctx.arena?.stockMatch ? STOCK_DODGE.groundSpeed * STOCK_DODGE.active + PLAYER_HALF_W + 6 : AI_BEHAVIOR.hazardLookahead;
        this.dodgeDir = safeFooting(ctx, me.x + dir * dodgeDistance, me.y) ? dir : safeFooting(ctx, me.x - dir * dodgeDistance, me.y) ? -dir : 0;
        if (this.dodgeJump || this.dodgeDir !== 0) {
          this.dodgeUntil = tick + AI_BEHAVIOR.dodgeHold;
          this.nextDodge = tick + AI_BEHAVIOR.dodgeCooldown * (1.5 - 0.6 * personality.dodge - 0.25 * personality.defense);
          st.stats.dodges++;
          if (ctx.arena?.stockMatch && !ctx.arena.isActionLocked(self.slot)) self.input.queuedDodge = true;
        }
      }
      if (tick < this.dodgeUntil) {
        hand.move(this.dodgeDir);
        hand.jump(this.dodgeJump && (me.grounded || me.levit > AI_BEHAVIOR.dodgeLevitReserve));
      }
    }
    // Do not walk or strafe into acid, fire or an unsupported drop. Navigation owns deliberate crossings.
    if (me.grounded && control.activeEdge === null && !control.committed && hand.dir !== 0) {
      const x = me.x + hand.dir * AI_BEHAVIOR.hazardLookahead * (0.75 + 0.5 * personality.hazardAvoidance);
      if (ctx.physics.entityFree(x, me.y, PLAYER_HALF_W, PLAYER_H) && (!safeDrop(ctx, x, me.y) || !safeTravel(ctx, me.x, me.y, x))) {
        const dir = hand.dir;
        let hop: { clearY: number; landingX: number } | null = null;
        if (!control.escaping) {
          const maxRise = Math.min(64, 24 + Math.max(0, me.levit - AI_BEHAVIOR.dodgeLevitReserve) * .8);
          hop = hazardHopClearance(ctx, me.x, me.y, dir, AI_BEHAVIOR.hazardLookahead, maxRise);
        }
        if (hop !== null) {
          control.startHop(dir, hop.clearY, me.y, hop.landingX);
          st.stats.hazardHops++;
        } else if (!control.escaping && safeMobilityLanding(ctx, me.x, me.y, me.x - dir * AI_BEHAVIOR.hazardLookahead * 2)) {
          // A broad patch cannot be cleared by the short hop. Walk back to
          // safe ground for another angle, rather than waiting for a stuck timeout.
          control.startEscape(-dir, 18, false);
          hand.move(-dir);
          hand.jump(false);
          st.stats.hazardRepositions = (st.stats.hazardRepositions ?? 0) + 1;
        } else {
          hand.move(0);
          this.strafeUntil = 0;
          st.stats.hazardStops++;
        }
      }
    }

    // A blocked route gets another attempt within 1.5 s, including search
    // after cover hides a foe. Deliberate holds never count as wanting to move.
    const goalX = this.goalX;
    const wantsMove = control.activeEdge !== null || (this.intent === 'reposition' && this.noShotTicks > AI_BEHAVIOR.blockedTicks) || (goalX !== null && Math.abs(goalX - me.x) > 10 && this.intent !== 'zone');
    if (control.stuck.update(me, wantsMove && !p.dead, tick, hand.idle)) {
      st.stats.stuck++;
      const edge = control.activeEdge;
      if (edge !== null) { this.blocked.add(edgeKey(edge)); this.blockedAt = tick; control.cancelEdge(); this.edgeTarget = null; }
      const away = goalX !== null && goalX > me.x ? -1 : 1;
      control.startEscape(this.rng.next() < 0.7 ? away : -away, ESCAPE_TICKS);
      st.rule = 'stuck: shaking loose';
    }
    if (tick < this.dodgeUntil) st.rule = 'evade incoming shot';

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
      // A fighter in a crater or on newly grown roots is still an opponent. Only exclude
      // unreachable creatures in the Yard's sealed demonstration chambers.
      if (f.foe.kind !== 'fighter' && nav !== null && f.foe.grounded && nav.nodeAt(f.x, f.y) === null && !hasLine(f)) continue;
      engageable.push(f);
    }

    const style: Readonly<Style> = styleFor(me.fighter);
    const personality = AI_PERSONALITIES[this.personality];
    const choice = chooseIntent({
      me,
      foes: engageable,
      style,
      current: this.intent,
      heldFor: tick - this.intentSince,
      currentTarget: this.targetRef,
      otherLevel: (f) => nav !== null && f.foe.grounded && myNode !== null && (nav.nodeAt(f.x, f.y)?.id ?? myNode.id) !== myNode.id && !hasLine(f),
      noShotTicks: this.noShotTicks,
      recovering: this.recovering,
      hasLine,
      personality,
      memory: this.memory,
      tick,
    });
    this.status.targetScores = targetUtilities(engageable, this.targetRef, personality, this.memory, hasLine);
    const stock = !!ctx.arena?.stockMatch;
    if (stock && choice.target) {
      // Stocks reward closing for a launch. A wand's preferred firing distance must not keep melee fighters apart.
      choice.intent = Math.abs(choice.target.y - me.y) > 40 && choice.target.foe.grounded ? 'reposition' : choice.target.dist > 36 ? 'approach' : 'pressure';
      choice.range = 24;
    }
    if (choice.intent !== this.intent) { this.intent = choice.intent; this.intentSince = tick; }
    const nextTarget = choice.target?.foe.ref ?? null;
    if (this.targetRef && nextTarget && nextTarget !== this.targetRef) this.status.stats.targetSwitches = (this.status.stats.targetSwitches ?? 0) + 1;
    this.targetRef = nextTarget;
    this.range = stock ? 24 : Math.max(me.weapon.minRange + 8, choice.range + this.exec.spacingBias);
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
        if (route !== null && route.length > 0 && me.levit > 12 + personality.recoveryCaution * 20) {
          this.startEdgeIfNew(control, route[0]);
          return;
        }
      }
    }
    if (control.activeEdge !== null && !control.committed) { control.cancelEdge(); this.edgeTarget = null; }
    const stage = this.navFor === 'fighter-stock' ? STOCK_STAGE.main : this.navFor === 'fighter-duel' ? DUEL : YARD;
    const x0 = stage.x0 + 16;
    const x1 = stage.x1 - 16;
    const lo = this.range - style.band;
    const hi = this.range + style.band;
    switch (this.intent) {
      case 'approach':
        this.goalX = stock ? this.stockFootwork.goal(me.x, target.x, tick) : target.cx - dir * (hi - 6);
        break;
      case 'recover':
      case 'retreat': {
        const away = me.x - dir * 70;
        const g = Math.max(x0, Math.min(x1, away));
        const cornered = Math.abs(g - me.x) < 12;
        const escapeDir = cornered ? Math.sign((x0 + x1) / 2 - me.x) || 1 : dir;
        // When overlapping at a wall, aiming and kicking cannot separate the bodies. Walk inward,
        // and cross above the opponent if there is a safe landing and an unobstructed overhead lane.
        this.goalX = this.intent === 'recover' && Math.abs(dx) > hi + 30 ? me.x : cornered ? me.x + escapeDir * 70 : g;
        // Once pinned, cross over the opponent if the landing and overhead lane are clear.
        const landing = target.cx + escapeDir * 36;
        if (cornered && target.dist < 110 && me.grounded && tick >= this.nextCornerEscape && !control.committed &&
          landing > x0 && landing < x1 && safeFooting(ctx, landing, me.y) &&
          lineClear(cellBlocks, me.x, me.sy - 30, landing, me.sy - 30) && ctx.physics.entityFree(me.x, me.y - 24, PLAYER_HALF_W, PLAYER_H)) {
          control.startEscape(escapeDir, ESCAPE_TICKS);
          this.nextCornerEscape = tick + AI_BEHAVIOR.cornerEscapeCooldown;
          st.stats.flanks++;
        }
        break;
      }
      case 'pressure':
        this.goalX = stock ? this.stockFootwork.goal(me.x, target.x, tick) : target.cx - dir * Math.max(AI_BEHAVIOR.pressureRange, me.weapon.minRange + 12, this.range * 0.65);
        break;
      case 'reposition':
        this.goalX = target.cx - dir * 12;
        break;
      case 'zone':
      default: {
        const ax = Math.abs(dx);
        if (tick >= this.strafeUntil) {
          this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
          this.strafeUntil = tick + Math.round(AI_BEHAVIOR.strafeTicks * (0.75 + this.rng.next() * 0.5));
        }
        const offset = this.strafeDir * Math.min(style.band * 0.85, AI_BEHAVIOR.strafeDistance * (0.4 + personality.mobility));
        this.goalX = ax < lo ? me.x - dir * (lo - ax + 4) : ax > hi ? me.x + dir * (ax - hi + 4) : target.cx - dir * (this.range + offset);
        break;
      }
    }
    // A modest bias away from the nearest wall; never replaces weapon spacing or a nav route.
    if (this.goalX !== null) {
      if (this.intent === 'zone' && (me.x - x0 < 65 || x1 - me.x < 65)) this.goalX += Math.sign((x0 + x1) / 2 - me.x) * 12 * personality.strongPosition;
      this.goalX = Math.max(x0, Math.min(x1, this.goalX));
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
      if (status === 'done') this.status.stats.landings = (this.status.stats.landings ?? 0) + 1;
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

  private fight(ctx: Ctx, self: BrainSelf, view: WorldView, foes: readonly PerceivedFoe[], target: PerceivedFoe, tick: number): void {
    const me = view.me;
    const control = this.control;
    if (control === null) return;
    const hand = control.hand;
    const st = this.status;
    const cellBlocks = (x: number, y: number): boolean => ctx.physics.cellBlocks(x, y);
    const shoulder = { x: me.x, y: me.sy };

    // ---- aim: lead the foe by what the bot knows of its motion, then the hand's wobble ----
    const speed = Math.hypot(target.vx, target.vy);
    const err = this.exec.tickAim(speed);
    const aim = leadPoint(shoulder, target, me.weapon.speed, err, me.weapon.gravity, this.exec.tier.prediction);
    hand.aim(aim.x, aim.y);
    st.aim = aim;
    const d = target.dist;
    st.target = `${target.foe.kind} ${Math.round(d)}`;
    const line = lineClear(cellBlocks, shoulder.x, shoulder.y, target.cx, target.cy);
    const lane = weaponLaneClear(shoulder, { x: target.cx, y: target.cy }, aim, me.weapon,
      (ax, ay, bx, by) => lineClear(cellBlocks, ax, ay, bx, by));
    if (!lane) this.noShotTicks++;
    else this.noShotTicks = 0;

    // ---- the wand: the trigger is held while the shot is clear, in range and not too close to burst on its owner ----
    const closeEnough = d <= me.weapon.maxRange && d >= me.weapon.minRange + target.foe.halfW * 0.5;
    const remembered = this.memory.get(target.foe.ref);
    const damage = remembered?.damageEstimate ?? 0;
    const finishing = damage > 0 && damage >= target.foe.hp;
    const canAct = !me.climbing && self.player.stunT <= 0 && self.player.pullT <= 0 &&
      (!ctx.arena?.stockMatch || !ctx.arena.isActionLocked(self.slot));

    // ---- the kick: anything inside the cone, off cooldown ----
    const lp = ctx.params.player;
    const angle = Math.atan2(target.cy - me.sy, target.cx - me.x);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const ox = me.x + dirX * 3;
    const oy = me.y - 8 + dirY * 3;
    const cosArc = Math.cos(lp.kickArc);
    let kick = false;
    const stock = !!ctx.arena?.stockMatch;
    // Use delayed position and speed, just as aiming does. A still nearby target is a commitment opportunity.
    const meleeKind = !me.grounded ? 'aerial' : target.cy < me.y - 20 ? 'launcher'
      : st.stats.kicks % 4 === 3 && Math.hypot(target.vx, target.vy) < .6 && target.dist < 25 ? 'finisher' : 'opener';
    const melee = stockMoveset(me.fighter)[meleeKind];
    const meleeFacing = Math.sign(target.x - me.x) || me.facing;
    if (canAct && ctx.playerCtl.kickReady !== false && tick - this.lastKick >= lp.kickCooldown + 1) {
      if (stock) {
        kick = stockAttackOverlaps(melee, meleeFacing, me.x, me.y, target.x, target.y) &&
          lineClear(cellBlocks, me.x, me.y - 10, target.cx, target.cy);
      } else {
        for (const f of foes) {
          const fx = f.x - ox;
          const fy = f.y - 5 - oy;
          const fd = Math.hypot(fx, fy) || 1;
          if (fd > lp.kickRange + 4) continue; // (the game's reach is kickRange + 6; a margin for a foe stepping away)
          if ((fx / fd) * dirX + (fy / fd) * dirY < cosArc + 0.05) continue;
          if (!lineClear(cellBlocks, ox, oy, f.cx, f.cy)) continue;
          // kick() runs immediately, before Player.update consumes the new cursor.
          // Its cone uses player.aimAngle, so wait until last tick's aim agrees.
          if (Math.cos(self.player.aimAngle - angle) < cosArc) continue;
          kick = true;
          break;
        }
      }
    }

    // ---- Z and T ----
    const plan = abilityPlan(me, target, this.intent, line, this.threatened);
    const mobility = me.fighter === 'kest-rel' || me.fighter === 'selene-wraith';
    const safeAbility = !plan.tactical || !mobility || !plan.aim || safeMobilityLanding(ctx, me.x, me.y, plan.aim.x);
    const eligible: Record<CombatAction, boolean> = {
      shoot: canAct && (!stock || (target.dist > 65 && ctx.arena!.canStockSpecial())) && closeEnough && lane && me.shotAffordable && me.wandCooldown <= 0 && (!this.recovering || finishing),
      kick,
      tactical: canAct && (!stock || ctx.arena!.canStockSpecial()) && !!self.fighters && !!plan.tactical && safeAbility && tick - this.lastZ >= PRESS_GAP,
      ultimate: canAct && (!stock || ctx.arena!.canStockSpecial(2)) && !!self.fighters && !!plan.ultimate && tick - this.lastT >= PRESS_GAP,
      defend: canAct && this.threatened && (tick < this.dodgeUntil || tick >= this.nextDodge),
      wait: true,
    };
    // Only an observed threat or an invalid action can interrupt the tactical cadence.
    if (tick >= this.nextAction || !eligible[this.action] || (this.threatened && !this.actionThreatened)) {
      const rows = actionUtilities({ me, target, personality: AI_PERSONALITIES[this.personality], skill: this.exec.tier,
        memory: this.memory, tick, threatened: this.threatened, eligible, damage, variation: this.exec.variation,
        defensiveKit: me.fighter === 'brann-rook' || me.fighter === 'edda-morrow' });
      const next = selectAction(rows, this.action, tick < this.actionUntil, this.threatened);
      if (next !== this.action) {
        this.actionUntil = tick + Math.round(this.exec.tier.decision * (1 + this.exec.tier.overcommit));
        if (next === 'defend') st.stats.defensiveChoices = (st.stats.defensiveChoices ?? 0) + 1;
      }
      this.action = next;
      this.nextAction = tick + this.exec.tier.decision;
      st.scores = rows;
    }
    this.actionThreatened = this.threatened;
    st.action = this.action;
    const fire = this.action === 'shoot' && eligible.shoot;
    hand.fire(fire);
    if (fire && !this.wasHolding) st.stats.shots++;
    this.wasHolding = fire;
    st.rule = this.action === 'wait' ? this.recovering ? 'saving mana' : !line ? 'seeking clear lane' : 'waiting for a ready action' : this.action;
    if (this.action === 'kick' && eligible.kick) {
      if (stock) {
        hand.move(meleeFacing);
        self.input.keys.up = meleeKind === 'launcher'; hand.down(meleeKind === 'finisher');
      }
      self.hands.kick(); hand.pressed(); this.lastKick = tick; st.stats.kicks++;
      this.actionPerformed('kick');
    } else if (this.action === 'ultimate' && eligible.ultimate) {
      self.hands.press('ultimate');
      hand.pressed();
      this.lastT = tick;
      st.stats.t++;
      this.actionPerformed('ultimate');
      st.rule = `T: ${plan.ultimate}`;
    } else if (this.action === 'tactical' && eligible.tactical) {
      if (plan.aim !== null) {
        // Movement skills must have somewhere safe to land; Thorne deliberately aims at ground.
        hand.aim(plan.aim.x, plan.aim.y);
        st.aim = plan.aim;
        // One cursor serves the wand and the ability. Do not fire a wand shot at an escape point.
        hand.fire(false);
        self.player.firePressed = false;
        this.wasHolding = false;
      }
      self.hands.press('tactical');
      hand.pressed();
      this.lastZ = tick;
      st.stats.z++;
      this.actionPerformed('tactical');
      st.rule = `Z: ${plan.tactical}`;
    }
  }
}

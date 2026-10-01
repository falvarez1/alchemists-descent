import type { FighterId } from '@/content/fighters';
import type { CardId, Ctx, Enemy, EnemyKind } from '@/core/types';
import { VIEW_H, VIEW_W } from '@/config/constants';
import type { BrainSelf } from '@/arena/ai/brain';

/**
 * WORLDVIEW (docs/arena/AI-FIGHTERS.md 2.1): what the bot SEES, as a read-only snapshot refilled every tick. It holds the
 * fighter's own body and abilities (the HUD shows all of it), every foe a person could see (see `isVisible`), and the
 * hostile shots in the air. It is built once and refilled in place (the arrays are mutated, never reassigned), so a
 * thinking bot costs no allocation.
 *
 * What a bot may and may not know (the "no cheating" contract):
 *  - OWN body, health, mana, LEV, cooldowns, charge: on the HUD, so known exactly and now.
 *  - FOES: anything inside the screen rectangle around the fighter, unless it is `sleeping` with no line of sight to it
 *    (a roosting bat in the dark is not seen). v1 keeps it that simple: no darkness, smoke or concealment test and no
 *    last-known memory (docs/arena/AI-FIGHTERS.md B4.6 does those); a foe a bot sees through a wall is one a person
 *    would see on the screen too (the Locked Cell's foes glow behind its door).
 *  - The Execution layer then makes the foes' kinematics `reaction` ticks old (execution.ts): this module is the truth.
 */

/** A foe's body centre height above its feet, as a fraction of its height: where a shot is aimed. */
const BODY_CENTRE = 0.5;
/** The screen's half extents: a foe beyond this is off screen. */
const SIGHT_HALF_W = VIEW_W / 2 + 16;
const SIGHT_HALF_H = VIEW_H / 2 + 16;
/** The shoulder: where the wand and the kick come from, above the feet (Player aims from y - 9). */
export const SHOULDER = 9;
const MAX_FOES = 16;
const MAX_SHOTS = 12;

export interface AbilityReadout {
  ready: boolean;
  /** 0 ready .. 1 just used. */
  cooldown: number;
  cooldownSeconds: number;
  /** 1..0 while the effect runs. */
  active: number;
  /** Ultimate charge 0..1 (the tactical reports 1). */
  charge: number;
}

export interface MeView {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The shoulder, where the shot leaves. */
  sy: number;
  hp: number;
  maxHp: number;
  hpFrac: number;
  armor: number;
  grounded: boolean;
  climbing: boolean;
  inLiquid: boolean;
  crawling: boolean;
  dead: boolean;
  facing: number;
  levit: number;
  maxLevit: number;
  fighter: FighterId | null;
  tactical: AbilityReadout;
  ultimate: AbilityReadout;
  /** The active wand has the mana for its next cast (the mana bar), is cycling (the cooldown ring: ticks left), and what its next card is. */
  shotAffordable: boolean;
  wandCooldown: number;
  shotCard: CardId | null;
}

export interface FoeView {
  ref: Enemy;
  kind: EnemyKind;
  /** Feet. */
  x: number;
  y: number;
  /** Body centre. */
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  hpFrac: number;
  halfW: number;
  h: number;
  /** From my shoulder to its body centre. */
  dx: number;
  dy: number;
  dist: number;
  grounded: boolean;
  /** Awake and notice-able (a roosting bat, or one hanging in the dark, is `sleeping`). */
  sleeping: boolean;
}

export interface ShotView {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface WorldView {
  tick: number;
  me: MeView;
  foes: FoeView[];
  shots: ShotView[];
  /** The objects `foes` and `shots` are filled from: per view, so two brains never share a snapshot. */
  readonly pool: { foes: FoeView[]; shots: ShotView[] };
}

function blankAbility(): AbilityReadout {
  return { ready: false, cooldown: 0, cooldownSeconds: 0, active: 0, charge: 0 };
}

export function createWorldView(): WorldView {
  const foes: FoeView[] = [];
  const shots: ShotView[] = [];
  return {
    tick: 0,
    me: {
      x: 0, y: 0, vx: 0, vy: 0, sy: 0, hp: 1, maxHp: 1, hpFrac: 1, armor: 0, grounded: true, climbing: false, inLiquid: false,
      crawling: false, dead: false, facing: 1, levit: 0, maxLevit: 1, fighter: null, tactical: blankAbility(), ultimate: blankAbility(),
      shotAffordable: false, wandCooldown: 0, shotCard: null,
    },
    foes,
    shots,
    pool: { foes: [], shots: [] },
  };
}

/** Is the straight line between two world points free of anything solid? Samples every second cell. */
export function lineClear(
  cellBlocks: (x: number, y: number) => boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.floor(Math.max(Math.abs(dx), Math.abs(dy)) / 2));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (cellBlocks(Math.round(x0 + dx * t), Math.round(y0 + dy * t))) return false;
  }
  return true;
}

/** A foe is perceived when it is on screen and not roosting out of sight (`lineOfSight` is asked only for a sleeper). */
export function isVisible(me: { x: number; y: number }, foe: { x: number; y: number; sleeping: boolean }, lineOfSight: () => boolean): boolean {
  if (Math.abs(foe.x - me.x) > SIGHT_HALF_W || Math.abs(foe.y - me.y) > SIGHT_HALF_H) return false;
  return !foe.sleeping || lineOfSight();
}

function fillAbility(out: AbilityReadout, a: { ready: boolean; cooldown: number; cooldownSeconds: number; active: number; charge: number }): void {
  out.ready = a.ready;
  out.cooldown = a.cooldown;
  out.cooldownSeconds = a.cooldownSeconds;
  out.active = a.active;
  out.charge = a.charge;
}

/** Refill `out` from the live game. `self` is the fighter being driven (slot 0 today). */
export function buildWorldView(ctx: Ctx, self: BrainSelf, tick: number, out: WorldView): WorldView {
  const p = self.player;
  const me = out.me;
  out.tick = tick;
  me.x = p.x;
  me.y = p.y;
  me.vx = p.vx;
  me.vy = p.vy;
  me.sy = p.y - (p.crawling ? 4 : SHOULDER);
  me.hp = p.hp;
  me.maxHp = Math.max(1, p.maxHp);
  me.hpFrac = Math.max(0, Math.min(1, p.hp / me.maxHp));
  me.grounded = p.grounded;
  me.climbing = p.climbing;
  me.inLiquid = p.inLiquid;
  me.crawling = p.crawling;
  me.dead = p.dead;
  me.facing = p.facing;
  me.levit = p.levit;
  me.maxLevit = Math.max(1, p.maxLevit);
  const fighters = self.fighters;
  me.fighter = fighters?.id ?? null;
  me.armor = fighters?.view.armor ?? 0;
  if (fighters) {
    fillAbility(me.tactical, fighters.view.tactical);
    fillAbility(me.ultimate, fighters.view.ultimate);
  } else {
    fillAbility(me.tactical, { ready: false, cooldown: 0, cooldownSeconds: 0, active: 0, charge: 0 });
    fillAbility(me.ultimate, { ready: false, cooldown: 0, cooldownSeconds: 0, active: 0, charge: 0 });
  }
  // The wand: the HUD shows its cooldown ring and mana bar, and the next card.
  const wands = ctx.wands;
  const wand = wands?.wands[wands.active];
  const peek = wands?.peekCast?.() ?? null;
  me.shotAffordable = wand !== undefined && (peek === null || peek.affordable);
  me.wandCooldown = wand?.cooldown ?? 0;
  me.shotCard = peek && peek.actions.length > 0 ? peek.actions[0].card : null;

  // foes
  const foes = out.foes;
  foes.length = 0;
  const defs = ctx.enemyCtl.defs;
  const cellBlocks = (x: number, y: number): boolean => ctx.physics.cellBlocks(x, y);
  for (const e of ctx.enemies) {
    if (foes.length >= MAX_FOES) break;
    if (e.hp <= 0) continue;
    const sleeping = e.sleeping === true;
    if (!isVisible(p, { x: e.x, y: e.y, sleeping }, () => lineClear(cellBlocks, me.x, me.sy, e.x, e.y - 4))) continue;
    const def = defs[e.kind];
    const h = def ? def.h : 10;
    const halfW = def ? def.halfW : 5;
    let f = out.pool.foes[foes.length];
    if (!f) { f = {} as FoeView; out.pool.foes[foes.length] = f; }
    f.ref = e;
    f.kind = e.kind;
    f.x = e.x;
    f.y = e.y;
    f.cx = e.x;
    f.cy = e.y - h * BODY_CENTRE;
    f.vx = e.vx;
    f.vy = e.vy;
    f.hp = e.hp;
    f.maxHp = Math.max(1, e.maxHp);
    f.hpFrac = Math.max(0, Math.min(1, e.hp / f.maxHp));
    f.halfW = halfW;
    f.h = h;
    f.dx = f.cx - me.x;
    f.dy = f.cy - me.sy;
    f.dist = Math.hypot(f.dx, f.dy);
    f.grounded = e.grounded;
    f.sleeping = sleeping;
    foes.push(f);
  }

  // hostile shots near the fighter (v1 does not dodge, v2 does: the data is here so the playbooks need no new plumbing)
  const shots = out.shots;
  shots.length = 0;
  for (const s of ctx.projectiles) {
    if (!s.hostile || shots.length >= MAX_SHOTS) continue;
    if (Math.abs(s.x - me.x) > SIGHT_HALF_W || Math.abs(s.y - me.y) > SIGHT_HALF_H) continue;
    let v = out.pool.shots[shots.length];
    if (!v) { v = { x: 0, y: 0, vx: 0, vy: 0 }; out.pool.shots[shots.length] = v; }
    v.x = s.x;
    v.y = s.y;
    v.vx = s.vx;
    v.vy = s.vy;
    shots.push(v);
  }
  return out;
}

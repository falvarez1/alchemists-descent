import type { Ctx, WandState } from '@/core/types';
import type { TelekinesisPhase } from '@/core/events';
import type { Corpse } from '@/creatures/corpses';
import { BOWL_CREDIT_TICKS, corpseLive, corpses, launchCorpse, releaseCorpse, touchCorpse } from '@/creatures/corpses';
import type { GripPoint } from '@/creatures/corpseBody';
import { corpseFrame, emptySample, gripPoint, LIFT_MASS_MAX, nearestGrip, pushBody, sampleBody } from '@/creatures/corpseBody';
import { sightClear } from '@/creatures/perception';
import { packRGB } from '@/sim/colors';
import { fxRandom } from '@/core/simRandom';

/**
 * TELEKINESIS — the wand's grip on a body. E on the fallen (or a crate) under
 * the cursor lifts it; it hangs in the air on a brass thread from the wand
 * tip, pulled toward the cursor by a damped spring that acts on ONE point of
 * the body, so the rest of it swings from that grip with its own weight: a
 * lizard held by the tail dangles by the tail, limbs trail, a heavy carcass
 * lags and sags, a bat snaps to the cursor. E again sets it down (it keeps the
 * momentum it has); F — or a right-click while holding — hurls it at the
 * cursor. Holding costs the wand its regeneration and a little more (heavier
 * bodies more); a hurl costs a draught scaled by mass, and a short tank hurls
 * weaker. With nothing left the grip fails: the body drops, the wand fizzles.
 *
 * Crates keep their own lift (entities/RigidBodies: free of mana, because
 * puzzle weights must stay fail-open); they share this verb's keys, thread,
 * hum and cursor rule, so crate and corpse are one gesture.
 */

// ------------------------------------------------------------------ tuning
export const TK = {
  /** Cells from the wand tip a body can be gripped at. */
  REACH: 90,
  /** The pull's target stays within this of the alchemist's chest (the leash). */
  LEASH: 64,
  /** Dragged (or dropped) farther than this from him, the thread snaps. */
  SNAP: 150,
  /** Cursor within this of a body's surface is ON it (it beats a crate beneath). */
  CURSOR_ON: 1.5,
  /** ...within this counts as aiming at it (no crate under the cursor). */
  CURSOR_GRACE: 4,
  /** Spring stiffness per tick², for a 1-slime body (÷ mass). */
  K: 0.03,
  /** Spring damping per tick (÷ √mass), on top of the body's own air drag. */
  C: 0.12,
  /** Cap on the pull, cells/tick² (÷ √mass): a far cursor does not yank. */
  ACCEL_MAX: 0.9,
  /** The body hangs this many cells below the cursor per slime of weight. */
  SAG: 1.6,
  /** Mana per tick on top of cancelling the wand's regeneration, and per slime. */
  DRAIN_BASE: 0.08,
  DRAIN_MASS: 0.09,
  /** Mana to take hold, plus per slime. */
  GRAB_COST: 2,
  GRAB_COST_MASS: 1.5,
  /** Mana to hurl, plus per slime. */
  HURL_COST: 6,
  HURL_COST_MASS: 5,
  /** Hurl speed, cells/tick, for a 1-slime body at full power (÷ mass^0.35, clamped). */
  HURL_SPEED: 8,
  HURL_SPEED_MIN: 3.5,
  HURL_SPEED_MAX: 7.5,
  /** Below this share of the hurl's cost in the tank the throw fizzles. */
  HURL_MIN_POWER: 0.25,
  /** Ticks the thread survives out of the wand's sight. */
  LOS_GRACE: 45,
  /** Too heavy to lift: E nudges it this hard (cells/tick, ÷ mass^0.5) for this much mana. */
  NUDGE: 1.1,
  NUDGE_COST: 6,
  /** Ticks between two "Rather heavy." remarks. */
  STRAIN_REMARK_TICKS: 150,
} as const;

// ------------------------------------------------------------------ pure math
/** The pull's target: the cursor, clamped to the leash around (ax, ay). */
export function leashTarget(ax: number, ay: number, mx: number, my: number, leash: number): { x: number; y: number } {
  const dx = mx - ax, dy = my - ay, d = Math.hypot(dx, dy);
  if (d <= leash || d < 1e-6) return { x: mx, y: my };
  return { x: ax + (dx / d) * leash, y: ay + (dy / d) * leash };
}

/**
 * The damped spring on the grip point: stiffness falls with mass (a heavy body
 * follows slowly and lags), damping with √mass (a light one snaps crisp and
 * barely overshoots), and the pull is capped. Returns cells/tick².
 */
export function springAccel(gx: number, gy: number, vx: number, vy: number, tx: number, ty: number, mass: number): { ax: number; ay: number } {
  const m = Math.max(0.3, mass);
  const k = TK.K / m, c = TK.C / Math.sqrt(m);
  let ax = (tx - gx) * k - vx * c, ay = (ty - gy) * k - vy * c;
  const cap = TK.ACCEL_MAX / Math.sqrt(m), a = Math.hypot(ax, ay);
  if (a > cap) { ax *= cap / a; ay *= cap / a; }
  return { ax, ay };
}

/** Mana per tick to hold a body: the wand's regeneration (the grip has its attention) plus weight. */
export function holdDrain(mass: number, regen: number): number {
  return Math.max(0, regen) + TK.DRAIN_BASE + TK.DRAIN_MASS * mass;
}

export function grabCost(mass: number): number {
  return TK.GRAB_COST + TK.GRAB_COST_MASS * mass;
}

export function hurlCost(mass: number): number {
  return TK.HURL_COST + TK.HURL_COST_MASS * mass;
}

/** Share of a full hurl the tank can pay for (0..1). */
export function hurlPower(mana: number, cost: number): number {
  return cost <= 0 ? 1 : Math.max(0, Math.min(1, mana / cost));
}

/** Launch speed for a body of `mass` at `power` (a bat flies, a golem is shoved). */
export function hurlSpeed(mass: number, power: number): number {
  const base = Math.max(TK.HURL_SPEED_MIN, Math.min(TK.HURL_SPEED_MAX, TK.HURL_SPEED / Math.pow(Math.max(0.3, mass), 0.35)));
  return base * Math.max(0, Math.min(1, power));
}

/**
 * Where to throw so the body lands on the cursor: the flattest arc of the
 * body's own flight (gravity `g`, per-tick velocity `keep`) that passes within
 * a few cells of (dx, dy) — found by flying candidate throws, low to high.
 * Out of range, the throw that comes nearest. Returns a unit direction.
 */
export function throwDirection(dx: number, dy: number, speed: number, g: number, keep: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy) || 1;
  const direct = Math.atan2(dy, dx);
  // Lift the aim toward straight up, whichever side the target is on.
  const up = dx >= 0 ? -1 : 1;
  let bestA = direct, bestMiss = Infinity;
  for (let k = 0; k <= 36; k++) {
    const a = direct + up * k * 0.04;
    if (Math.abs(a - direct) > 1.45) break;
    let x = 0, y = 0, vx = Math.cos(a) * speed, vy = Math.sin(a) * speed, miss = Infinity;
    for (let t = 0; t < 160; t++) {
      vx *= keep; vy = vy * keep + g;
      x += vx; y += vy;
      miss = Math.min(miss, Math.hypot(x - dx, y - dy));
      if (y > dy + 40 || Math.hypot(x, y) > d + 60) break;
    }
    if (miss < 3) return { x: Math.cos(a), y: Math.sin(a) };
    if (miss < bestMiss) { bestMiss = miss; bestA = a; }
  }
  return { x: Math.cos(bestA), y: Math.sin(bestA) };
}

// ------------------------------------------------------------------ state
interface Hold {
  corpse: Corpse;
  /** The gripped point (corpseBody nearestGrip). */
  index: number;
  /** Ticks the thread has been out of sight. */
  lostSight: number;
  /** Ticks held. */
  heldT: number;
}

let hold: Hold | null = null;
let lastStrainRemark = -1e9;
const GP: GripPoint = { x: 0, y: 0, vx: 0, vy: 0 };
const SAMPLE = emptySample();

export function heldCorpse(): Corpse | null {
  return hold?.corpse ?? null;
}

/** Forget the grip (a new run, a level change, tests). */
export function clearTelekinesis(): void {
  if (hold) hold.corpse.grip = null;
  hold = null;
}

/** Anything in the wand's grip: a corpse, or a crate (lifted with E or carried with G). */
export function telekinesisHolding(ctx: Ctx): boolean {
  return hold !== null || ctx.rigidBodies?.isHolding?.() === true;
}

function activeWand(ctx: Ctx): WandState | null {
  const w = ctx.wands;
  return w?.wands?.[w.active] ?? null;
}

function emit(ctx: Ctx, phase: TelekinesisPhase, x: number, y: number, mass: number, target: 'corpse' | 'crate' = 'corpse'): void {
  ctx.events?.emit('telekinesis', { phase, x, y, mass, target });
}

/** No mana: the thread frays — a hollow click, the mana bar flinches, a sad fizzle at the tip. */
function dryFizzle(ctx: Ctx, x: number, y: number, mass: number): void {
  ctx.audio?.dryFire?.();
  ctx.events?.emit('dryFire');
  const tip = ctx.spells?.wandTip?.() ?? { x, y };
  ctx.particles?.burst(tip.x, tip.y, 4, null, () => packRGB(170, 150, 110), 0.7, { glow: 0.8, grav: 0.04 });
  emit(ctx, 'fizzle', x, y, mass);
}

/** Brass motes at the grip. */
function shimmer(ctx: Ctx, x: number, y: number, n: number, speed: number): void {
  ctx.particles?.burst(x, y, n, null, () => packRGB(255, 205 + ((fxRandom() * 40) | 0), 120), speed, { glow: 2, grav: -0.01 });
}

// ------------------------------------------------------------------ picking
export interface CorpsePick {
  corpse: Corpse;
  index: number;
  /** Cells from the cursor to the body's surface. */
  gap: number;
}

/**
 * The body the wand would take: with a cursor, the one whose surface is
 * nearest (x, y); with a controller's aim (`aim`), the one nearest the aim
 * line. Only bodies within reach of the wand tip and in its sight.
 */
export function pickCorpse(ctx: Ctx, x: number, y: number, aim = false): CorpsePick | null {
  const world = ctx.world, p = ctx.player;
  const tip = ctx.spells?.wandTip?.() ?? { x: p.x, y: p.y - 9 };
  let best: CorpsePick | null = null, bestScore = Infinity;
  const ax = Math.cos(p.aimAngle ?? 0), ay = Math.sin(p.aimAngle ?? 0);
  for (const c of corpses()) {
    if (c.world !== world || c.gone) continue;
    let index: number, gap: number, score: number;
    if (aim) {
      const s = sampleBody(c.e, SAMPLE);
      const dx = s.x - tip.x, dy = s.y - tip.y, d = Math.hypot(dx, dy) || 1;
      if (d > TK.REACH + s.r) continue;
      const off = Math.acos(Math.max(-1, Math.min(1, (dx * ax + dy * ay) / d)));
      if (off > 0.45) continue;
      const g = nearestGrip(c.e, tip.x + ax * d, tip.y + ay * d);
      index = g.index; gap = g.gap; score = off * 60 + d * 0.2;
    } else {
      const g = nearestGrip(c.e, x, y);
      index = g.index; gap = g.gap; score = gap;
      if (gap > TK.CURSOR_GRACE) continue;
    }
    gripPoint(c.e, index, GP);
    const gx = GP.x, gy = GP.y;
    if (Math.hypot(gx - tip.x, gy - tip.y) > TK.REACH) continue;
    if (!sightClear(world, tip.x, tip.y, gx, gy)) continue;
    if (score < bestScore) { bestScore = score; best = { corpse: c, index, gap }; }
  }
  return best;
}

// ------------------------------------------------------------------ the verb
/**
 * E: lift the body under the cursor — a corpse, or (through the crate lift) a
 * crate. The body the cursor is ON wins; a corpse merely near the cursor
 * yields to a crate directly under it. Returns true when E was spent here
 * (lifted, nudged, or refused for want of mana); false leaves E to levers
 * and the siphon.
 */
export function telekinesisLift(ctx: Ctx, aim = false): boolean {
  const p = ctx.player;
  if (hold || p.dead || p.climbing || ctx.state.mode !== 'play') return false;
  const mx = ctx.input.mouse.x, my = ctx.input.mouse.y;
  const pick = pickCorpse(ctx, mx, my, aim);
  const under = aim ? null : ctx.rigidBodies?.hitTest?.(mx, my) ?? null;
  const crateUnder = under !== null && under.kind === 'dynamic' && !under.tag?.startsWith('flora-');
  if (pick && (aim || pick.gap <= TK.CURSOR_ON || !crateUnder)) return liftCorpse(ctx, pick);
  if (aim) return false;
  const lifted = ctx.rigidBodies?.grabAtCursor?.(ctx) === true;
  if (lifted) {
    const b = ctx.rigidBodies.heldBody();
    if (b) emit(ctx, 'grab', b.x, b.y, 1, 'crate');
  }
  return lifted;
}

function liftCorpse(ctx: Ctx, pick: CorpsePick): boolean {
  const c = pick.corpse, now = ctx.state.frameCount;
  const wand = activeWand(ctx);
  gripPoint(c.e, pick.index, GP);
  const gx = GP.x, gy = GP.y;
  // Too heavy (the dead Leviathan): the wand strains and only nudges it.
  if (c.mass > LIFT_MASS_MAX) {
    if (wand && wand.mana < TK.NUDGE_COST) { dryFizzle(ctx, gx, gy, c.mass); return true; }
    if (wand) wand.mana -= TK.NUDGE_COST;
    const dx = ctx.input.mouse.x - gx, dy = ctx.input.mouse.y - gy, d = Math.hypot(dx, dy) || 1;
    const k = TK.NUDGE / Math.sqrt(c.mass);
    pushBody(c.e, (dx / d) * k, (dy / d) * k - k * 0.4);
    touchCorpse(c, now);
    shimmer(ctx, gx, gy, 6, 0.7);
    emit(ctx, 'strain', gx, gy, c.mass);
    if (now - lastStrainRemark > TK.STRAIN_REMARK_TICKS) {
      lastStrainRemark = now;
      ctx.events?.emit('combatCallout', { x: gx, y: gy - 14, text: 'Rather heavy.', tone: 'brass' });
    }
    return true;
  }
  const cost = grabCost(c.mass);
  if (wand && wand.mana < cost) { dryFizzle(ctx, gx, gy, c.mass); return true; }
  if (wand) wand.mana -= cost;
  hold = { corpse: c, index: pick.index, lostSight: 0, heldT: 0 };
  c.grip = { index: pick.index, ax: 0, ay: 0 };
  touchCorpse(c, now);
  // The tug: the body is plucked toward the wand, and it flashes brass-white.
  const tip = ctx.spells?.wandTip?.() ?? { x: ctx.player.x, y: ctx.player.y - 9 };
  const dx = tip.x - gx, dy = tip.y - gy, d = Math.hypot(dx, dy) || 1;
  const tug = 0.9 / Math.sqrt(c.mass);
  pushBody(c.e, (dx / d) * tug, (dy / d) * tug - tug * 0.8);
  c.e.flash = Math.max(c.e.flash, 5);
  shimmer(ctx, gx, gy, 10, 1.1);
  emit(ctx, 'grab', gx, gy, c.mass);
  return true;
}

/** E again: set the held body down (a corpse keeps its momentum; a crate settles). */
export function telekinesisSetDown(ctx: Ctx): boolean {
  if (hold) {
    const c = hold.corpse;
    hold = null;
    if (corpseLive(c, ctx.world)) {
      releaseCorpse(c, ctx.state.frameCount);
      const s = sampleBody(c.e, SAMPLE);
      emit(ctx, 'release', s.x, s.y, c.mass);
    } else c.grip = null;
    return true;
  }
  if (ctx.rigidBodies?.isHolding?.()) {
    const b = ctx.rigidBodies.heldBody();
    ctx.rigidBodies.release(ctx, false);
    if (b) emit(ctx, 'release', b.x, b.y, 1, 'crate');
    return true;
  }
  return false;
}

/**
 * F (or a right-click while holding): hurl the held body at the cursor. The
 * throw costs mana by mass; a short tank throws weaker, an empty one fizzles
 * and the body just drops. The alchemist feels the throw (a small recoil).
 */
export function telekinesisHurl(ctx: Ctx): boolean {
  if (!hold) {
    if (!ctx.rigidBodies?.isHolding?.()) return false;
    const b = ctx.rigidBodies.heldBody();
    ctx.rigidBodies.release(ctx, true);
    if (b) emit(ctx, 'hurl', b.x, b.y, 1, 'crate');
    return true;
  }
  const c = hold.corpse, index = hold.index, now = ctx.state.frameCount;
  hold = null;
  if (!corpseLive(c, ctx.world)) { c.grip = null; return true; }
  gripPoint(c.e, index, GP);
  const gx = GP.x, gy = GP.y;
  const wand = activeWand(ctx);
  const cost = hurlCost(c.mass);
  const power = wand ? hurlPower(wand.mana, cost) : 1;
  if (power < TK.HURL_MIN_POWER) {
    releaseCorpse(c, now);
    dryFizzle(ctx, gx, gy, c.mass);
    return true;
  }
  if (wand) wand.mana = Math.max(0, wand.mana - cost * power);
  // At the cursor — lobbed so it lands there when it can; with the cursor on
  // the body itself, straight along the aim.
  const p = ctx.player;
  const speed = hurlSpeed(c.mass, power);
  const s = sampleBody(c.e, SAMPLE);
  const tx = ctx.input.mouse.x - s.x, ty = ctx.input.mouse.y - s.y;
  let dx: number, dy: number;
  if (Math.hypot(tx, ty) < 6) { dx = Math.cos(p.aimAngle); dy = Math.sin(p.aimAngle); }
  else {
    const weaver = corpseFrame(c.e) === 'weaver';
    const dir = throwDirection(tx, ty, speed, weaver ? 0.25 : 0.22, weaver ? 0.995 : 0.985);
    dx = dir.x; dy = dir.y;
  }
  // The body leaves at the throw's velocity (its own swing becomes tumble).
  launchCorpse(c, dx * speed + p.vx * 0.3 - s.vx, dy * speed + p.vy * 0.3 - s.vy, now, index);
  c.bowlUntil = now + BOWL_CREDIT_TICKS;
  // Newton: a heavy throw pushes the thrower back a little.
  const recoil = Math.min(1.6, 0.35 * c.mass * power);
  ctx.playerCtl?.applyImpulse?.(-dx * recoil, -dy * recoil * 0.5);
  // A streak of displaced air behind the throw.
  for (let i = 0; i < 10; i++) {
    const t = fxRandom();
    ctx.particles?.spawn(gx - dx * t * 10, gy - dy * t * 10, dx * (1.5 + fxRandom() * 2), dy * (1.5 + fxRandom() * 2), null,
      i % 3 ? packRGB(220, 214, 196) : packRGB(255, 214, 130), 8 + ((fxRandom() * 8) | 0), { glow: i % 3 ? 0 : 1.4, grav: 0 });
  }
  if (!ctx.state.reduceFlashes && ctx.fx) ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick ?? 0, 0.18 + power * 0.12);
  emit(ctx, 'hurl', gx, gy, c.mass);
  return true;
}

/**
 * Per tick (after the alchemist moves, before the remains step): keep the
 * grip — or lose it — and write this tick's pull onto the body.
 */
export function updateTelekinesis(ctx: Ctx): void {
  const now = ctx.state.frameCount;
  if (!hold) {
    // A lifted or carried crate hums on the same thread.
    const b = ctx.rigidBodies?.heldBody?.();
    if (b && ctx.state.mode === 'play') emit(ctx, 'hold', b.x, b.y, 1, 'crate');
    return;
  }
  const c = hold.corpse, p = ctx.player, world = ctx.world;
  // Taken out of the grip: eaten, shattered, melted, kicked or blasted loose.
  if (!corpseLive(c, world) || c.grip === null) {
    hold = null;
    c.grip = null;
    const s = sampleBody(c.e, SAMPLE);
    emit(ctx, 'release', s.x, s.y, c.mass);
    return;
  }
  const lose = (fizzle: boolean): void => {
    hold = null;
    releaseCorpse(c, now);
    const s = sampleBody(c.e, SAMPLE);
    if (fizzle) { dryFizzle(ctx, s.x, s.y, c.mass); } else emit(ctx, 'release', s.x, s.y, c.mass);
  };
  if (p.dead || ctx.state.mode !== 'play' || p.climbing || p.legClub) { lose(false); return; }
  const tip = ctx.spells?.wandTip?.() ?? { x: p.x, y: p.y - 9 };
  gripPoint(c.e, hold.index, GP);
  if (Math.hypot(GP.x - p.x, GP.y - (p.y - 9)) > TK.SNAP) { lose(true); return; }
  if (now % 3 === 0) hold.lostSight = sightClear(world, tip.x, tip.y, GP.x, GP.y) ? 0 : hold.lostSight + 3;
  if (hold.lostSight > TK.LOS_GRACE) { lose(true); return; }
  const wand = activeWand(ctx);
  if (wand) {
    const regen = (wand.frame?.manaRegen ?? 0) * (p.perks?.manafont ? 1.6 : 1);
    const drain = holdDrain(c.mass, regen);
    if (wand.mana < drain) { wand.mana = 0; lose(true); return; }
    wand.mana -= drain;
  }
  const t = leashTarget(p.x, p.y - 9, ctx.input.mouse.x, ctx.input.mouse.y + TK.SAG * c.mass, TK.LEASH);
  const a = springAccel(GP.x, GP.y, GP.vx, GP.vy, t.x, t.y, c.mass);
  c.grip.index = hold.index;
  c.grip.ax = a.ax;
  c.grip.ay = a.ay;
  c.touchT = now;
  c.bowlUntil = now + BOWL_CREDIT_TICKS;
  hold.heldT++;
  // Motes run down the thread into the body; a few orbit it.
  if (now % 4 === 0) {
    const dx = GP.x - tip.x, dy = GP.y - tip.y, d = Math.hypot(dx, dy) || 1, sp = 2.2;
    ctx.particles?.spawn(tip.x, tip.y, (dx / d) * sp, (dy / d) * sp, null, packRGB(255, 214, 130), Math.max(4, Math.round(d / sp)), { glow: 1.8, grav: 0 });
  }
  if (now % 7 === 0) {
    const s = sampleBody(c.e, SAMPLE), ang = fxRandom() * Math.PI * 2, rr = s.r + 1.5;
    ctx.particles?.spawn(s.x + Math.cos(ang) * rr, s.y + Math.sin(ang) * rr, -Math.sin(ang) * 0.3, Math.cos(ang) * 0.3, null, packRGB(240, 200, 120), 12 + ((fxRandom() * 8) | 0), { glow: 1.6, grav: 0 });
  }
  emit(ctx, 'hold', GP.x, GP.y, c.mass);
}

// ------------------------------------------------------------------ render view
export interface TetherView {
  /** Wand tip → grip. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  mass: number;
  target: 'corpse' | 'crate';
  /** Ticks held (the grab flares for the first few). */
  heldT: number;
  /** 0..1 how hard the spring is pulling (the thread tightens and brightens). */
  strain: number;
}

const VIEW: TetherView = { x0: 0, y0: 0, x1: 0, y1: 0, mass: 1, target: 'corpse', heldT: 0, strain: 0 };

/** The thread to draw this frame, or null. */
export function tetherView(ctx: Ctx): TetherView | null {
  const p = ctx.player;
  if (p.dead || ctx.state.mode !== 'play') return null;
  const tip = ctx.spells?.wandTip?.();
  if (!tip) return null;
  if (hold && corpseLive(hold.corpse, ctx.world) && hold.corpse.grip) {
    gripPoint(hold.corpse.e, hold.index, GP);
    const g = hold.corpse.grip;
    VIEW.x0 = tip.x; VIEW.y0 = tip.y; VIEW.x1 = GP.x; VIEW.y1 = GP.y;
    VIEW.mass = hold.corpse.mass; VIEW.target = 'corpse'; VIEW.heldT = hold.heldT;
    VIEW.strain = Math.min(1, Math.hypot(g.ax, g.ay) / (TK.ACCEL_MAX / Math.sqrt(Math.max(0.3, hold.corpse.mass))));
    return VIEW;
  }
  const b = ctx.rigidBodies?.heldBody?.();
  if (b) {
    VIEW.x0 = tip.x; VIEW.y0 = tip.y; VIEW.x1 = b.x; VIEW.y1 = b.y;
    VIEW.mass = 1; VIEW.target = 'crate'; VIEW.heldT = 30; VIEW.strain = Math.min(1, Math.hypot(b.vx, b.vy) / 6);
    return VIEW;
  }
  return null;
}

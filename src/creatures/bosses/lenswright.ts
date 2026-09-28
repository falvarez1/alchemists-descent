import type { Ctx, Enemy, EnemyDamageSource, EnemyDef } from '@/core/types';
import { clamp } from '@/core/math';
import { entityRandom } from '@/core/simRandom';
import { PHOTOCELL } from '@/config/darkness';
import { Cell } from '@/sim/CellType';
import { crystalColor, fireColor, glassColor, packRGB, waterColor } from '@/sim/colors';
import { distanceToSegment, traceBeam, type BeamSegment } from '@/sim/beam';
import type { BossBrain, BossHost, BossMove, BossSense } from './types';
import { bossPhaseFor, ensureBossBrain } from './types';

/**
 * THE LENSWRIGHT — the Glass Galleries' guardian: the glassworks' great
 * grinding-lens, a brass-rimmed eye that hangs in the air of its gallery
 * trailing crystal drops, and burns what it looks at.
 *
 * Its weapon is the LANCE: a beam of focused light traced through the real
 * grid (sim/beam — the same geometry the wand's beam obeys). It banks off the
 * gallery's silvered panels and splits in crystal, so cover is only cover
 * until it finds the angle. Every lance is told: the iris opens and a faint
 * aim line walks onto you (it tracks, then LOCKS — the line brightens — and
 * a heartbeat later it fires down that line). From the second phase the lance
 * SWEEPS an arc as it fires; in the third it fires through its own prism,
 * three lances at once. Too close, and it FLARES you back.
 *
 * Shut, the brass housing glances blows (a third). Its weaknesses are light:
 *
 * - DAZZLE: it meets a straight stare (it is a lens: it looks straight back),
 *   but light it is not expecting blinds it. While its iris is open (a
 *   lance's tell), bank your wand's beam off a silvered panel into its eye
 *   and hold it there: it backfires — the iris slams, it drops out of the air
 *   and lies stunned, and blows land double. The game checks it the way the
 *   renderer draws it: the real light field at its eye, and the wand's cone
 *   traced through the grid (sim/beam) reaching it after a bounce.
 * - ITS OWN LIGHT: a lance that comes back to it off a mirror (stand before a
 *   silvered panel and get out of the way) burns it.
 *
 * Only what the player caused hurts it (core/bossWard): its own reflected
 * lance counts only while he is engaged.
 */

export const LENS = {
  /** Hover band: this far above the floor under it, this far from the alchemist. */
  HOVER: 40, NEAR: 64, FAR: 118,
  SPEED: [0.55, 0.65, 0.78] as const,
  LANCE_DUR: 92, LOCK: 38, FIRE: 54, FIRE_END: 70,
  SWEEP_DUR: 112, SWEEP_END: 94, SWEEP_ARC: 0.34,
  PRISM_SPREAD: 0.3,
  LANCE_DMG: 16, SELF_DMG: 42,
  REACH: 420,
  /** Beam-in-the-eye ticks (during an open iris) that dazzle it. */
  DAZZLE_TICKS: 16,
  DAZZLED: 170,
  FLARE_DUR: 34, FLARE_R: 26, FLARE_DMG: 6,
  GLANCE_MUL: 0.35, OPEN_MUL: 1.25, DAZZLED_MUL: 2.0,
  RECOVER: [96, 78, 60] as const,
  ROAR_DUR: 60,
} as const;

/** What a lance that stops on it sets alight. */
const BURNS: ReadonlySet<number> = new Set<number>([Cell.Wood, Cell.Oil, Cell.Vines, Cell.Moss, Cell.Gunpowder, Cell.Coal, Cell.Fungus]);

/**
 * Is the wand's light reaching its eye OFF A MIRROR? The wand's cone, traced
 * through the grid (a few rays across it), passes the eye after a bounce.
 */
function reflectedInto(ctx: Ctx, ex: number, ey: number, r: number): boolean {
  const p = ctx.player, aim = p.aimAngle;
  const ox = p.x + Math.cos(aim) * 4, oy = p.y - 9 + Math.sin(aim) * 4;
  for (let k = -4; k <= 4; k++) {
    const segs = trace(ctx, ox, oy, aim + k * 0.05, SCRATCH);
    for (const s of segs) if (s.depth >= 1 && distanceToSegment(ex, ey, s) < r) return true;
  }
  return false;
}

/** The lance's traced path this move (reused buffers). */
const PATHS = new WeakMap<Enemy, { segs: BeamSegment[][]; hitPlayer: boolean; hitSelf: boolean; scorched: boolean }>();
const SCRATCH: BeamSegment[] = [];

function begin(ctx: Ctx, e: Enemy, b: BossBrain, move: BossMove, dur: number): void {
  b.lastMove = b.move === 'march' ? b.lastMove : b.move;
  b.move = move;
  b.moveT = 0;
  b.moveDur = dur;
  ctx.events.emit('bossMove', { kind: e.kind, move, phase: b.phase, x: e.x, y: e.y });
}

/** The eye: the centre of the lens. */
export function lensEye(e: Enemy, def: EnemyDef): [number, number] {
  return [e.x, e.y - def.h * 0.55];
}

/** Is the iris open (a lance told or firing)? Blows land whole on the bare lens. */
export function lensOpen(e: Enemy): boolean {
  const b = e.boss;
  if (!b) return false;
  return (b.move === 'lance' || b.move === 'sweep') && b.moveT < (b.move === 'sweep' ? LENS.SWEEP_END : LENS.FIRE_END);
}

/** The blow that actually lands: glanced by the shut housing, whole on the open lens, doubled while dazzled. */
export function lenswrightHit(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, amount: number, source: EnemyDamageSource): number {
  const b = ensureBossBrain(e);
  if (b.move === 'dazzled') return amount * LENS.DAZZLED_MUL;
  if (lensOpen(e)) return source === 'direct' ? amount * LENS.OPEN_MUL : amount;
  const [ex, ey] = lensEye(e, def);
  ctx.particles.burst(ex, ey, 3, null, () => packRGB(255, 226, 150), 1.1, { glow: 1.4, grav: -0.01 });
  host.voice(e, () => ctx.audio.sfx('creature.lenswright.glance', e.x, e.y));
  return amount * LENS.GLANCE_MUL;
}

/** Trace the lance from the eye along `angle` (bounces and splits included). */
function trace(ctx: Ctx, x: number, y: number, angle: number, out: BeamSegment[]): BeamSegment[] {
  return traceBeam(ctx.world, x, y, angle, LENS.REACH, out, { maxSegments: 12, step: 0.7 });
}

/** How close a traced lance passes to the alchemist's chest (and at what depth). */
function passes(segs: readonly BeamSegment[], px: number, py: number): { d: number; depth: number } {
  let best = Infinity, depth = 99;
  for (const s of segs) {
    const d = distanceToSegment(px, py, s);
    if (d < best - 0.5 || (Math.abs(d - best) <= 0.5 && s.depth < depth)) { best = d; depth = s.depth; }
  }
  return { d: best, depth };
}

/**
 * Find a firing angle whose lance reaches the alchemist: the straight line if
 * it is clear, else the best bank shot off the mirrors (a sweep of angles).
 */
function findAim(ctx: Ctx, ex: number, ey: number, px: number, py: number): number | null {
  const direct = Math.atan2(py - ey, px - ex);
  if (passes(trace(ctx, ex, ey, direct, SCRATCH), px, py).d < 3.5) return direct;
  let bestA: number | null = null, bestScore = Infinity;
  const N = 96;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const segs = trace(ctx, ex, ey, a, SCRATCH);
    if (segs.length < 2) continue; // only banked lines
    const { d, depth } = passes(segs, px, py);
    if (d > 5) continue;
    const score = d + depth * 2;
    if (score < bestScore) { bestScore = score; bestA = a; }
  }
  return bestA;
}

/** The dotted aim line along the traced lance (the tell) and the bright line when it fires. */
function drawLance(ctx: Ctx, segs: readonly BeamSegment[], firing: boolean, locked: boolean, tick: number): void {
  for (const s of segs) {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    const every = firing ? 2 : locked ? 5 : 8;
    const phase = firing ? 0 : (tick * (locked ? 0.9 : 0.5)) % every;
    for (let d = phase; d < len; d += every) {
      const u = d / Math.max(1, len);
      const x = s.x0 + (s.x1 - s.x0) * u, y = s.y0 + (s.y1 - s.y0) * u;
      const warm = s.tint > 0, cool = s.tint < 0;
      const col = firing
        ? (warm ? packRGB(255, 196, 120) : cool ? packRGB(150, 200, 255) : packRGB(255, 246, 214))
        : packRGB(255, 220, 140);
      ctx.particles.spawn(x, y, 0, 0, null, col, firing ? 4 : locked ? 3 : 2, { glow: firing ? 2.6 : locked ? 1.4 : 0.7, grav: 0 });
    }
  }
}

/** Where the lance stops, the grid answers: ice melts, what burns catches. */
function scorch(ctx: Ctx, segs: readonly BeamSegment[]): void {
  const w = ctx.world;
  for (const s of segs) {
    if (s.end !== 'stop') continue;
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
    const X = Math.floor(s.x1 + (s.x1 - s.x0) / len), Y = Math.floor(s.y1 + (s.y1 - s.y0) / len);
    if (!w.inBounds(X, Y)) continue;
    const t = w.types[w.idx(X, Y)];
    if (t === Cell.Ice || t === Cell.Snow) w.replaceCellAt(w.idx(X, Y), Cell.Water, waterColor());
    else if (BURNS.has(t)) {
      const ax = Math.floor(s.x1), ay = Math.floor(s.y1);
      if (w.inBounds(ax, ay) && w.types[w.idx(ax, ay)] === Cell.Empty) { w.replaceCellAt(w.idx(ax, ay), Cell.Fire, fireColor()); w.life[w.idx(ax, ay)] = 30; }
    }
    ctx.particles.burst(s.x1, s.y1, 5, null, () => packRGB(255, 220, 150), 1.4, { glow: 2.0, grav: -0.01 });
  }
}

/** LANCE / SWEEP: tell (the iris opens, the aim line walks on and LOCKS), then fire. */
function lance(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain, sweep: boolean): void {
  const t = b.moveT, p = ctx.player;
  const [ex, ey] = lensEye(e, def);
  const px = p.x, py = p.y - 9;
  let rec = PATHS.get(e);
  if (!rec) { rec = { segs: [[], [], []], hitPlayer: false, hitSelf: false, scorched: false }; PATHS.set(e, rec); }
  if (t === 1) {
    rec.hitPlayer = false; rec.hitSelf = false; rec.scorched = false; b.heat = 0;
    const a = findAim(ctx, ex, ey, px, py);
    if (a === null) { b.move = 'march'; b.moveT = 0; e.attackCd = 30; return; } // no line: reposition
    b.aimX = a;
  }
  // Until it LOCKS, the aim walks onto you (a straight line re-aims; a bank holds).
  if (t < LENS.LOCK) {
    const direct = Math.atan2(py - ey, px - ex);
    if (passes(trace(ctx, ex, ey, direct, SCRATCH), px, py).d < 3.5) {
      const da = Math.atan2(Math.sin(direct - b.aimX), Math.cos(direct - b.aimX));
      b.aimX += da * 0.25;
    }
  }
  if (t === LENS.LOCK) ctx.audio.sfx('creature.lenswright.lock', ex, ey);
  const fireEnd = sweep ? LENS.SWEEP_END : LENS.FIRE_END;
  const firing = t >= LENS.FIRE && t < fireEnd;
  // The sweep carries the locked line across an arc while it burns.
  let aim = b.aimX;
  if (sweep && firing) aim += Math.sin(((t - LENS.FIRE) / (fireEnd - LENS.FIRE)) * Math.PI - Math.PI / 2) * LENS.SWEEP_ARC * (b.aimY >= 0 ? 1 : -1);
  if (t === LENS.FIRE - 20) b.aimY = entityRandom() < 0.5 ? 1 : -1; // which way the sweep runs
  const prism = b.phase >= 3;
  const angles = prism && firing ? [aim, aim - LENS.PRISM_SPREAD, aim + LENS.PRISM_SPREAD] : [aim];
  for (let k = 0; k < 3; k++) rec.segs[k].length = 0;
  for (let k = 0; k < angles.length; k++) trace(ctx, ex, ey, angles[k], rec.segs[k]);
  // DAZZLE: the wand's beam in its open eye before it fires — off a mirror.
  if (t < LENS.FIRE && t > 4) {
    const shine = ctx.lightQuery?.wandLight(ex, ey) ?? 0;
    if (shine >= PHOTOCELL.beam && reflectedInto(ctx, ex, ey, def.halfW * 0.8)) {
      b.heat += 1;
      if (t % 3 === 0) ctx.particles.spawn(ex + (entityRandom() - 0.5) * 6, ey + (entityRandom() - 0.5) * 6, 0, -0.2, null, packRGB(255, 255, 230), 10, { glow: 2.4, grav: 0 });
      if (b.heat >= LENS.DAZZLE_TICKS) { dazzle(ctx, e, def, host, b); return; }
    }
  }
  const locked = t >= LENS.LOCK;
  if (t < fireEnd) for (let k = 0; k < angles.length; k++) drawLance(ctx, rec.segs[k], firing, locked, ctx.state.frameCount);
  if (t === LENS.FIRE) {
    ctx.audio.sfx('creature.lenswright.lance', ex, ey);
    host.shakeAt(e.x, e.y, 0.02, 0.05);
    if (!ctx.state.reduceFlashes) ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 0.6);
  }
  if (!firing) return;
  for (let k = 0; k < angles.length; k++) {
    const segs = rec.segs[k];
    if (!rec.scorched) scorch(ctx, segs);
    // The alchemist in the line (once a lance).
    if (!rec.hitPlayer && !p.dead) {
      for (const s of segs) {
        if (distanceToSegment(px, py, s) < 4.2 || distanceToSegment(p.x, p.y - 3, s) < 3.2) {
          rec.hitPlayer = true;
          const d = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
          ctx.playerCtl.damage(LENS.LANCE_DMG * (e.dmgK ?? 1), ((s.x1 - s.x0) / d) * 2.2, -1.4, 'lenswright-lance');
          break;
        }
      }
    }
    // Its own light, come back to it off a mirror: it burns (the ward decides).
    if (!rec.hitSelf) {
      for (const s of segs) {
        if (s.depth < 1) continue;
        if (distanceToSegment(ex, ey, s) < def.halfW) {
          rec.hitSelf = true;
          if (host.worldHarm(e)) {
            ctx.events.emit('combatCallout', { x: e.x, y: e.y - def.h - 8, text: 'ITS OWN LIGHT', tone: 'brass' });
            ctx.particles.burst(ex, ey, 18, null, () => packRGB(255, 240, 190), 2.4, { glow: 2.6, grav: -0.01 });
            ctx.enemyCtl.damage(e, LENS.SELF_DMG, 0, 0, 'burned');
          }
          break;
        }
      }
    }
  }
  rec.scorched = true;
}

/** Dazzled: the iris slams, the lance backfires in a flash, and it drops out of the air. */
function dazzle(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const [ex, ey] = lensEye(e, def);
  ctx.particles.burst(ex, ey, 30, null, () => packRGB(255, 250, 220), 3.0, { glow: 3.0, grav: 0 });
  if (!ctx.state.reduceFlashes) ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 1.2);
  host.shakeAt(e.x, e.y, 0.03, 0.06);
  ctx.audio.sfx('creature.lenswright.dazzle', ex, ey);
  ctx.events.emit('combatCallout', { x: e.x, y: e.y - def.h - 10, text: 'DAZZLED', tone: 'finisher' });
  b.heat = 0;
  b.exposed = LENS.DAZZLED;
  b.selfHarmUntil = ctx.state.frameCount + 10;
  begin(ctx, e, b, 'dazzled', LENS.DAZZLED);
  e.attackCd = Math.max(e.attackCd, LENS.DAZZLED);
}

/** FLARE: too close — a flash off the whole lens throws the alchemist back. */
function flare(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const [ex, ey] = lensEye(e, def);
  if (b.moveT < 16 && b.moveT % 2 === 0) {
    ctx.particles.spawn(ex + (entityRandom() - 0.5) * 16, ey + (entityRandom() - 0.5) * 16, 0, 0, null, packRGB(255, 230, 170), 8, { glow: 1.6, grav: 0 });
  }
  if (b.moveT !== 16) return;
  ctx.particles.burst(ex, ey, 26, null, () => packRGB(255, 236, 180), 3.2, { glow: 2.4, grav: 0 });
  ctx.audio.sfx('creature.lenswright.flare', ex, ey);
  host.shakeAt(e.x, e.y, 0.02, 0.05);
  const p = ctx.player;
  const dx = p.x - ex, dy = p.y - 9 - ey, d = Math.hypot(dx, dy) || 1;
  if (!p.dead && d < LENS.FLARE_R + 6) {
    ctx.playerCtl.damage(LENS.FLARE_DMG * (e.dmgK ?? 1), (dx / d) * 3.6, -2.2, 'lenswright-flare');
  }
}

/** ROAR (a phase turns): the lens rings, and its crystal drops chime. */
function roar(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  if (b.moveT !== 1) return;
  const [ex, ey] = lensEye(e, def);
  ctx.audio.duck(0.5, 900);
  host.shakeAt(e.x, e.y, 0.03, 0.06);
  ctx.particles.burst(ex, ey, 24, null, () => (entityRandom() < 0.5 ? packRGB(200, 170, 255) : packRGB(150, 220, 255)), 2.2, { glow: 2.0, grav: 0 });
}

/* ------------------------------------------------------------------ brain */

/** Floor surface under (x, y) within `span` cells, or null. */
function floorBelow(ctx: Ctx, x: number, y: number, span: number): number | null {
  const w = ctx.world, X = Math.floor(x);
  for (let Y = Math.floor(y); Y < Math.floor(y) + span; Y++) {
    if (!w.inBounds(X, Y + 1)) return null;
    const t = w.types[w.idx(X, Y + 1)];
    if (t !== Cell.Empty && t !== Cell.Fire && t !== Cell.Smoke && t !== Cell.Steam) return Y;
  }
  return null;
}

export function tickLenswright(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, s: BossSense): void {
  const b = ensureBossBrain(e);
  if (b.exposed > 0) b.exposed--;
  const p = ctx.player;
  const dazzled = b.move === 'dazzled';

  // Phase turns ring the lens.
  const phase = bossPhaseFor(e.hp / e.maxHp);
  if (phase > b.phase && !dazzled) {
    b.phase = phase;
    begin(ctx, e, b, 'roar', LENS.ROAR_DUR);
  }

  if (dazzled) {
    // Dropped out of the air: it falls, rings on the floor, and lies there.
    e.vy = Math.min(3, e.vy + 0.3);
    e.vx *= 0.9;
    e.grounded = floorBelow(ctx, e.x, e.y, 2) !== null;
    if (e.grounded && !e.prevG) { host.shakeAt(e.x, e.y, 0.025, 0.05); ctx.audio.sfx('creature.lenswright.fall', e.x, e.y); }
    e.prevG = e.grounded;
  } else {
    // Hover: hold the band above the floor, and a firing distance from him.
    const floor = floorBelow(ctx, e.x, e.y, 90);
    const wantY = (floor ?? e.y) - LENS.HOVER + Math.sin(ctx.state.frameCount * 0.04 + e.bobPhase) * 3;
    const dx = p.x - e.x, dist = Math.abs(dx);
    let wantVx = 0;
    if (s.targetAlive) {
      if (dist < LENS.NEAR) wantVx = -Math.sign(dx || 1);
      else if (dist > LENS.FAR) wantVx = Math.sign(dx);
      else wantVx = Math.sin(ctx.state.frameCount * 0.013 + e.bobPhase) * 0.5; // a slow drift across the gallery
    }
    const busy = b.move !== 'march';
    const cap = (LENS.SPEED[b.phase - 1] ?? LENS.SPEED[0]) * (busy ? 0.25 : 1);
    e.vx += (wantVx * cap - e.vx) * 0.06;
    e.vy += (clamp((wantY - e.y) * 0.05, -0.8, 0.8) - e.vy) * 0.1;
    e.prevG = false;
    if (e.mind && Math.abs(dx) > 2) e.mind.facing = Math.sign(dx);
  }

  // Idle shimmer: the drops catch the light.
  if (ctx.state.frameCount % 9 === 0) {
    ctx.particles.spawn(e.x + (entityRandom() - 0.5) * def.halfW * 1.6, e.y - 2, 0, 0.15, null, crystalColor(), 18, { glow: 1.0, grav: 0.01 });
  }

  const busy = b.move !== 'march';
  if (busy) {
    b.moveT++;
    switch (b.move) {
      case 'lance': lance(ctx, e, def, host, b, false); break;
      case 'sweep': lance(ctx, e, def, host, b, true); break;
      case 'flare': flare(ctx, e, def, host, b); break;
      case 'roar': roar(ctx, e, def, host, b); break;
      default: break;
    }
    if (b.move !== 'march' && b.moveT >= b.moveDur) {
      b.lastMove = b.move;
      b.move = 'march';
      b.moveT = 0;
      b.heat = 0;
      e.attackCd = (LENS.RECOVER[b.phase - 1] ?? LENS.RECOVER[0]) + Math.floor(entityRandom() * 30);
    }
    return;
  }
  if (!s.canAttack || e.attackCd > 0 || host.introducing(e)) return;
  const [ex, ey] = lensEye(e, def);
  const close = Math.hypot(p.x - ex, p.y - 9 - ey) < LENS.FLARE_R;
  let next: BossMove;
  let dur: number;
  if (close && b.lastMove !== 'flare') { next = 'flare'; dur = LENS.FLARE_DUR; }
  else if (b.phase >= 2 && b.lastMove === 'lance') { next = 'sweep'; dur = LENS.SWEEP_DUR; }
  else { next = 'lance'; dur = LENS.LANCE_DUR; }
  begin(ctx, e, b, next, dur);
}

/** The Lenswright's death: the lens bursts into real glass and its drops fall as crystal. */
export function lenswrightDeathShards(ctx: Ctx, e: Enemy, def: EnemyDef): void {
  const [ex, ey] = lensEye(e, def);
  for (let k = 0; k < 70; k++) {
    const a = entityRandom() * Math.PI * 2, sp = 0.8 + entityRandom() * 2.6;
    ctx.particles.spawn(ex, ey, Math.cos(a) * sp, Math.sin(a) * sp - 1, k % 5 === 0 ? Cell.Crystal : Cell.Glass,
      k % 5 === 0 ? crystalColor() : glassColor(), 160, { deposit: true, glow: 0.6 });
  }
  ctx.particles.burst(ex, ey, 40, null, () => packRGB(255, 244, 210), 4.0, { glow: 2.8, grav: 0.01 });
  if (!ctx.state.reduceFlashes) ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 1.4);
}

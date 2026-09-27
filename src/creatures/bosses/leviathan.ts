import type { Ctx, Enemy, EnemyDef } from '@/core/types';
import { clamp } from '@/core/math';
import { entityRandom } from '@/core/simRandom';
import { Cell, isLiquid } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type { BossBrain, BossHost, BossMove, BossSense } from './types';
import { bossPhaseFor, ensureBossBrain } from './types';

/**
 * THE SUNKEN LEVIATHAN — the Cisterns' angler, the Kiln's mirror: WATER IS
 * ITS ARMOUR (blows glance off it while it is submerged) and its pool is one
 * big conductor.
 *
 * It LURKS with its lure lit, feeding on the fish the lure draws. Its tell is
 * the lure going DARK: it douses its light, sinks, and LUNGES (a breach that
 * can clear the surface). At range it throws its own pool (the VOLLEY, after
 * its throat swells). Below 66% it THRASHES — its tail slams the surface and
 * flings a sheet of real water at the shore (every thrash spends its own
 * pool). Below 33% it DIVES to the floor and SURGES straight up under you.
 *
 * Its weaknesses: drain the basin (dig the plugs) and it is heavy meat on the
 * tiles — every blow lands, harder; or put a spark in the water and it is
 * SHORTED — a jolt of damage and a convulsion (an opening) every 24 ticks for
 * as long as the current lives. Only what the player caused hurts it.
 */

export const LEV = {
  LUNGE_TELL: 22, LUNGE_SWOOP: 18, LUNGE_RANGE: 92, BITE: 16,
  VOLLEY_TELL: 20, VOLLEY_MIN: 90, VOLLEY_MAX: 320,
  THRASH_TELL: 18, THRASH_DUR: 40, THRASH_RANGE: 90, THRASH_CELLS: 22, THRASH_DMG: 9,
  DIVE_TELL: 34, DIVE_DUR: 70, SURGE_VY: 3.4,
  /** Electrocution: a jolt every JOLT ticks while the pool it floats in is live. */
  JOLT: 24, JOLT_SHARE: 0.035, JOLT_STUN: 14,
  /** A beached body takes blows harder; a convulsing one harder still. */
  BEACHED_MUL: 1.3, EXPOSED_MUL: 1.6,
  RECOVER: [110, 90, 70] as const,
} as const;

/** Damage multiplier for a blow landing on the Leviathan (submersion is applied by the caller). */
export function leviathanDamageScale(e: Enemy): number {
  const b = e.boss;
  let k = 1;
  if (e.submerged !== true) k *= LEV.BEACHED_MUL;
  if (b && b.exposed > 0) k *= LEV.EXPOSED_MUL;
  return k;
}

function begin(ctx: Ctx, e: Enemy, b: BossBrain, move: BossMove, dur: number): void {
  if (b.move !== 'lurk') b.lastMove = b.move;
  b.move = move;
  b.moveT = 0;
  b.moveDur = dur;
  ctx.events.emit('bossMove', { kind: e.kind, move, phase: b.phase, x: e.x, y: e.y });
}

function end(e: Enemy, b: BossBrain, cooldown: number): void {
  b.lastMove = b.move;
  b.move = 'lurk';
  b.moveT = 0;
  e.attackCd = Math.max(e.attackCd, cooldown);
}

/** How dark the lure is (0 lit … 1 doused): the lunge and dive tells. Read by the rig. */
export function leviathanLureDim(e: Enemy): number {
  const b = e.boss;
  if (!b) return 0;
  if (b.move === 'lunge') return b.moveT < LEV.LUNGE_TELL ? Math.min(1, b.moveT / 8) : 1;
  if (b.move === 'dive') return 1;
  if (b.move === 'shock') return 0.5 + Math.sin(b.moveT * 1.7) * 0.5;
  return 0;
}

function thrash(ctx: Ctx, e: Enemy, host: BossHost, b: BossBrain): void {
  const w = ctx.world, p = ctx.player;
  const f = e.mind?.facing ?? 1;
  const tx = e.x - f * 16, ty = e.y - 8; // the tail's side
  if (b.moveT === 1) host.voice(e, () => { ctx.audio.sfx('creature.leviathan.windup', e.x, e.y); ctx.audio.slither(1.6); }, 700);
  if (b.moveT === LEV.THRASH_TELL) {
    // The slam: the pool's own surface is flung at the shore as real water.
    let n = 0;
    for (let dy = -14; dy <= 6 && n < LEV.THRASH_CELLS; dy++) for (let dx = -12; dx <= 12 && n < LEV.THRASH_CELLS; dx++) {
      const X = Math.floor(tx + dx), Y = Math.floor(ty + dy);
      if (!w.inBounds(X, Y) || w.types[w.idx(X, Y)] !== Cell.Water) continue;
      if (w.inBounds(X, Y - 1) && isLiquid(w.types[w.idx(X, Y - 1)])) continue; // surface cells only
      const i = w.idx(X, Y), color = w.colors[i];
      w.clearCellAt(i);
      const aim = Math.atan2(p.y - 12 - Y, p.x - X) + (entityRandom() - 0.5) * 0.5;
      const spd = 2.8 + entityRandom() * 1.4;
      ctx.particles.spawn(X, Y, Math.cos(aim) * spd, Math.sin(aim) * spd - 1.2, Cell.Water, color, 170, {
        hostileDmg: 4, hostileSource: 'leviathan-water', glow: 0.4, grav: 0.06,
      });
      n++;
    }
    ctx.particles.burst(tx, ty, 18, null, () => packRGB(180, 225, 250), 2.6, { glow: 0.5, grav: 0.08 });
    host.shakeAt(e.x, e.y, 0.03, 0.06);
    host.voice(e, () => { ctx.audio.splash(1.6, tx, ty); ctx.audio.boom(8); }, 800);
    if (!p.dead && Math.hypot(p.x - e.x, p.y - e.y) < 26) {
      ctx.playerCtl.damage(LEV.THRASH_DMG * (e.dmgK ?? 1), Math.sign(p.x - e.x || 1) * 3.4, -2.6, 'leviathan-thrash');
    }
  }
}

/**
 * One tick of the Leviathan. Returns false if it died this tick (the caller
 * then skips the shared integration).
 */
export function tickLeviathan(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, s: BossSense): boolean {
  const b = ensureBossBrain(e);
  const player = ctx.player;
  if (b.move === 'march' || b.move === 'beached') b.move = 'lurk';
  if (e.timer % 4 === 0) {
    let waterN = 0;
    for (let dy = 0; dy < def.h; dy += 3) for (let dx = -def.halfW; dx <= def.halfW; dx += 3) {
      const X = e.x + dx, Y = e.y - dy;
      if (ctx.world.inBounds(X, Y) && ctx.world.types[ctx.world.idx(X, Y)] === Cell.Water) waterN++;
    }
    e.submerged = waterN >= 8;
  }
  const sub = e.submerged === true;
  if (b.exposed > 0) b.exposed--;
  if (b.jolt > 0) b.jolt--;
  const phase = bossPhaseFor(e.hp / e.maxHp);
  if (phase > b.phase) {
    b.phase = phase;
    host.voice(e, () => { ctx.audio.groan(); ctx.audio.sfx('creature.leviathan.alert', e.x, e.y); }, 800);
    ctx.particles.burst(e.x, e.y - 10, 22, null, () => packRGB(150, 220, 255), 2, { glow: 1.4, grav: -0.03 });
    host.shakeAt(e.x, e.y, 0.03, 0.06);
  }

  // SHORTED: the live pool jolts it — a burst of damage and a convulsion,
  // not a silent drain. Only a fight the player started counts.
  // (The ward decides whether the current is the player's: core/bossWard.)
  if (sub && e.status.electrified > 0 && b.jolt <= 0 && host.worldHarm(e)) {
    b.jolt = LEV.JOLT;
    const dmg = e.maxHp * LEV.JOLT_SHARE;
    ctx.alchemy?.noteHit(e, 'shorted');
    e.hp -= dmg;
    b.playerDamage += dmg;
    e.flash = Math.max(e.flash, 6);
    b.exposed = Math.max(b.exposed, LEV.JOLT_STUN + 6);
    if (b.move !== 'shock') begin(ctx, e, b, 'shock', LEV.JOLT_STUN);
    else b.moveT = 0;
    ctx.particles.burst(e.x, e.y - 8, 12, null, () => packRGB(150, 235, 255), 2.4, { glow: 2.6, grav: 0 });
    ctx.lightning?.spark?.(e.x - def.halfW, e.y - def.h, e.x + def.halfW, e.y - 2);
    host.voice(e, () => { ctx.audio.zap(); ctx.audio.groan(); }, 800);
    if (!b.said.includes('shorted')) {
      b.said.push('shorted');
      ctx.events.emit('combatCallout', { x: e.x, y: e.y - def.h - 8, text: 'SHORTED', tone: 'brass' });
    }
    e.windup = 0; e.swoop = 0;
    if (e.hp <= 0) { host.finishDeath(e); return false; }
  }

  if (sub) {
    e.vx *= 0.96;
    e.vy *= 0.9;
    const hunting = s.targetAlive && e.alerted;
    if (b.move === 'shock') {
      // Convulsing: rigid, twitching, going nowhere.
      e.vx = (entityRandom() - 0.5) * 0.3; e.vy = (entityRandom() - 0.5) * 0.3;
    } else if (b.move === 'dive' && b.moveT < LEV.DIVE_TELL) {
      e.vy += 0.12; // down to the floor, lure dark
      e.vx += Math.sign(player.x - e.x) * 0.05;
    } else if (hunting && (e.windup ?? 0) === 0 && b.move === 'lurk') {
      if (e.timer % 2 === 0) {
        e.vx += Math.sign(s.pdx) * 0.09;
        e.vy += Math.sign(player.y - 6 - e.y) * 0.07;
      }
    } else if (b.move === 'lurk') {
      // Patrol sway; a fish that comes for the lure is supper.
      e.vx += Math.cos(e.timer * 0.02 + e.bobPhase) * 0.02;
      e.vy += Math.sin(e.timer * 0.05 + e.bobPhase) * 0.015;
      if (e.timer % 6 === 0) {
        const f = e.mind?.facing ?? 1;
        const hx = e.x + f * 7, hy = e.y - 10;
        for (const c of ctx.critters.list) {
          if (c.kind !== 'fish' || (c.dead ?? 0) > 0 || Math.abs(c.x - hx) > 6 || Math.abs(c.y - hy) > 6) continue;
          ctx.critters.remove(c);
          ctx.particles.burst(hx, hy, 6, null, () => packRGB(170, 220, 250), 0.9, { grav: -0.04 });
          host.voice(e, () => ctx.audio.bubble(hx, hy), 300);
          ctx.events.emit('organism', { kind: 'leviathan', action: 'eat', x: hx, y: hy });
          break;
        }
      }
    }
    e.vx = clamp(e.vx, -1.5, 1.5);
    e.vy = clamp(e.vy, -0.9, 0.9);
    if (ctx.state.frameCount % 7 === 0 && Math.abs(e.vx) > 0.5) {
      ctx.particles.spawn(e.x - Math.sign(e.vx) * def.halfW, e.y - 6 - entityRandom() * 6, -e.vx * 0.2, -0.3 - entityRandom() * 0.3,
        null, packRGB(170, 220, 250), 14, { grav: -0.04 });
    }
  } else {
    // BEACHED: gravity owns it. Heaving flops, each one a dying gasp.
    e.vy += 0.34;
    e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
    e.vx *= 0.92;
    if (e.grounded && e.timer % 38 === 0) {
      e.vy = -1.8;
      e.vx = (s.targetAlive ? Math.sign(s.pdx) || 1 : entityRandom() < 0.5 ? -1 : 1) * 0.85;
      host.voice(e, () => ctx.audio.hop(1.6), 640);
      host.shakeAt(e.x, e.y, 0.012, 0.04);
    }
    if (ctx.state.frameCount % 11 === 0) {
      ctx.particles.spawn(e.x + (entityRandom() - 0.5) * 10, e.y - def.h + 2, (entityRandom() - 0.5) * 0.4, -0.4, null, packRGB(150, 200, 230), 16, { grav: -0.02 });
    }
    if (b.move === 'dive' || b.move === 'thrash' || b.move === 'volley') end(e, b, 60);
  }

  // ---- committed moves ----
  if (b.move !== 'lurk') b.moveT++;
  if (b.move === 'shock' && b.moveT >= b.moveDur) end(e, b, 20);
  if (b.move === 'lunge') {
    if (b.moveT === LEV.LUNGE_TELL && s.canAttack) {
      e.swoop = LEV.LUNGE_SWOOP;
      const a = Math.atan2(player.y - 8 - e.y, player.x - e.x);
      e.vx = Math.cos(a) * 3.4;
      e.vy = Math.sin(a) * 2.6;
      host.voice(e, () => ctx.audio.sfx('creature.leviathan.lunge', e.x, e.y), 640);
    } else if (b.moveT < LEV.LUNGE_TELL) {
      e.vx *= 0.8; e.vy = e.vy * 0.8 + 0.05; // sinking, coiled, lure dark
      e.windup = LEV.LUNGE_TELL - b.moveT;
    }
    if (b.moveT >= LEV.LUNGE_TELL + LEV.LUNGE_SWOOP) end(e, b, (LEV.RECOVER[b.phase - 1] ?? 100) + Math.floor(entityRandom() * 40));
  } else if (b.move === 'volley') {
    // The throat swells, then the pool comes at you.
    if (b.moveT === LEV.VOLLEY_TELL && sub) host.poolVolley(e);
    if (b.moveT >= LEV.VOLLEY_TELL + 6) end(e, b, 140 + Math.floor(entityRandom() * 40));
  } else if (b.move === 'thrash') {
    thrash(ctx, e, host, b);
    if (b.moveT >= LEV.THRASH_DUR) end(e, b, 90 + Math.floor(entityRandom() * 30));
  } else if (b.move === 'dive') {
    if (b.moveT === LEV.DIVE_TELL) {
      // SURGE: straight up under the alchemist.
      e.swoop = 22;
      e.vx = clamp((player.x - e.x) * 0.06, -1.4, 1.4);
      e.vy = -LEV.SURGE_VY;
      host.voice(e, () => { ctx.audio.sfx('creature.leviathan.lunge', e.x, e.y); ctx.audio.splash(1.4, e.x, e.y); }, 800);
      ctx.particles.burst(e.x, e.y - def.h, 22, null, () => packRGB(190, 230, 255), 3, { glow: 0.4, grav: 0.08 });
    }
    if (b.moveT >= LEV.DIVE_DUR) end(e, b, 110);
  }

  if ((e.swoop ?? 0) > 0) {
    if (!s.debugSuppressed) e.swoop = (e.swoop ?? 1) - 1;
    if (!sub) e.vy += 0.12; // a breaching arc falls back home
    if (s.canAttack && e.attackCd === 0 && Math.abs(s.pdx) < 12 && Math.abs(s.pdy) < 16) {
      ctx.playerCtl.damage(LEV.BITE * (e.dmgK ?? 1), Math.sign(s.pdx) * -4.2, -2.8, 'leviathan-bite');
      e.attackCd = 140;
      e.swoop = 0;
    }
  }
  if ((e.windup ?? 0) > 0 && b.move !== 'lunge') e.windup = 0;

  // ---- choose ----
  if (b.move === 'lurk' && sub && s.canAttack && e.alerted && e.attackCd === 0 && (e.swoop ?? 0) === 0) {
    const P = b.phase;
    const playerDry = !isLiquid(ctx.world.type(Math.floor(player.x), Math.floor(player.y - 3)));
    if (P >= 3 && b.lastMove !== 'dive' && Math.abs(s.pdx) < 40 && player.y < e.y) begin(ctx, e, b, 'dive', LEV.DIVE_DUR);
    else if (s.pDist < LEV.LUNGE_RANGE) begin(ctx, e, b, 'lunge', LEV.LUNGE_TELL + LEV.LUNGE_SWOOP);
    else if (P >= 2 && playerDry && s.pDist < LEV.THRASH_RANGE + 40 && b.lastMove !== 'thrash') begin(ctx, e, b, 'thrash', LEV.THRASH_DUR);
    else if (s.pDist >= LEV.VOLLEY_MIN && s.pDist < LEV.VOLLEY_MAX && host.hasAttackLine(e, def, true)) begin(ctx, e, b, 'volley', LEV.VOLLEY_TELL + 6);
    if ((b.move as BossMove) === 'lunge') host.voice(e, () => ctx.audio.sfx('creature.leviathan.windup', e.x, e.y), 640);
  }

  // Contact graze outside a committed bite.
  if (s.canAttack && (e.swoop ?? 0) === 0 && b.move !== 'shock' && e.attackCd < 100 && Math.abs(s.pdx) < 11 && Math.abs(s.pdy) < 14) {
    ctx.playerCtl.damage(10 * (e.dmgK ?? 1), Math.sign(s.pdx) * -3.0, -2.0, 'leviathan-graze');
    e.attackCd = Math.max(e.attackCd, 120);
  }
  return true;
}

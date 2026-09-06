import type { Ctx, Enemy } from '@/core/types';
import { makePickup } from '@/core/pickupDefs';
import { clamp } from '@/core/math';
import { weaverLegGeometry } from '@/creatures/weaverAnatomy';
import { packRGB } from '@/sim/colors';
import { canHumiliate, recordTrickshot } from '@/combat/Trickshot';
import { heldLegContact, updateHeldLeg } from '@/combat/HeldLeg';

export const LEG_STRENGTH = 14;
export const LEG_CLUB_SWINGS = 6;
export const LEG_SWING_TICKS = 18;

/** Aimed projectile damage only. The mask and pickup are changed together, so
 * repeats, death and save/resume cannot produce two copies of the same limb. */
export function strikeWeaverLeg(ctx: Ctx, e: Enemy, index: number, damage: number, vx: number, vy: number): boolean {
  if (e.kind !== 'weaver' || !e.weaverLoco || e.hp <= 0 || index < 0 || index > 7 || damage <= 0 ||
      ((e.weaverMissingLegs ?? 0) & (1 << index))) return false;
  const wounds = e.weaverLegDamage ??= Array<number>(8).fill(0);
  wounds[index] += damage;
  e.flash = 6;
  if (wounds[index] >= LEG_STRENGTH) {
    e.weaverSalvageId ??= `${ctx.state.worldSeed}:${ctx.levels.current?.def?.id}:${e.x}:${e.y}:${e.bobPhase}`;
    const points = weaverLegGeometry(e, index), hip = points[0], foot = points[points.length - 1];
    e.weaverMissingLegs = (e.weaverMissingLegs ?? 0) | (1 << index);
    const leg = e.weaverLoco.legs[index]; leg.missing = true; leg.planted = false; leg.stepT = -1;
    e.weaverFlinchT = 24; e.weaverRetreatT = 120; e.windup = 0; e.blink = 0;
    e.weaverLoco.recoverT = Math.max(e.weaverLoco.recoverT, 24);
    e.weaverLoco.vx -= e.weaverLoco.nx * .7; e.weaverLoco.vy -= e.weaverLoco.ny * .7;
    const pickup = makePickup('weaverleg', (hip.x + foot.x) / 2, (hip.y + foot.y) / 2, {
      legLength: clamp(Math.hypot(foot.x - hip.x, foot.y - hip.y), 26, 44),
      legAngle: Math.atan2(foot.y - hip.y, foot.x - hip.x), legSpin: Math.sign(vx || 1) * .18, legAge: 0,
      legOwner: e.weaverSalvageId,
    });
    pickup.vx = clamp(vx * .28, -2.4, 2.4); pickup.vy = -1.8 + Math.min(.5, vy * .12);
    ctx.levels.current?.pickups.push(pickup);
    ctx.particles.burst(hip.x, hip.y, 5, null, () => packRGB(157, 185, 147), 1.5, { grav: .12 });
    ctx.audio.noiseBurst(.06, 1700, .09, true); ctx.audio.tone(270, 65, .12, 'triangle', .065);
    ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, 4);
    ctx.telemetry.count('weaver.legSevered');
    recordTrickshot(ctx, e, 'sever');
  } else {
    ctx.audio.tone(480, 230, .05, 'triangle', .04);
  }
  ctx.enemyCtl.damage(e, damage * .25, vx * .12, vy * .1);
  return true;
}

export function startLegSwing(ctx: Ctx): boolean {
  const p = ctx.player, club = p.legClub;
  if (!club) return false;
  if (club.cooldown > 0 || p.recharge > 0 || p.pullT > 0) return true;
  club.angle = p.aimAngle; club.swingT = LEG_SWING_TICKS; club.cooldown = 26;
  club.hitThisSwing = false;
  p.facing = Math.cos(club.angle) < 0 ? -1 : 1;
  ctx.audio.noiseBurst(.06, 680, .065, true);
  return true;
}

/** Contact follows the solved thigh during the active stroke, once per swing.
 * The wind-up is harmless, and misses do not consume durability. */
export function updateLegSwing(ctx: Ctx): void {
  const p = ctx.player, club = p.legClub;
  if (!club) return;
  club.cooldown = Math.max(0, club.cooldown - 1);
  club.swingT = Math.max(0, club.swingT - 1);
  const rig = updateHeldLeg(ctx);
  if (!rig || club.hitThisSwing || club.swingT > 12 || club.swingT < 3) return;
  const ox = p.x, oy = p.y - (p.crawling ? 4 : 10), dx = Math.cos(club.angle), dy = Math.sin(club.angle);
  let hit = false;
  for (let i = ctx.enemies.length - 1; i >= 0; i--) {
    const e = ctx.enemies[i];
    if (e.hp <= 0 || Math.hypot((e.weaverLoco?.px ?? e.x) - ox, (e.weaverLoco?.py ?? e.y - 7) - oy) > club.length + 28) continue;
    const contact = heldLegContact(ctx, e, rig);
    if (!contact) continue;
    const ex = contact.x - ox, ey = contact.y - oy, distance = Math.hypot(ex, ey);
    if ((ex * dx + ey * dy) / Math.max(1, distance) < .55) continue;
    const finish = canHumiliate(ctx, e);
    ctx.enemyCtl.damage(e, finish ? Math.max(24, e.hp * 2) : 24, dx * (finish ? 5.2 : 3.2), dy * 2 - (finish ? 2 : 1.2));
    recordTrickshot(ctx, e, finish && e.hp <= 0 ? 'finish' : e.hp <= 0 ? 'kill' : 'hit');
    if (e.hp > 0) ctx.enemyCtl.gustShove(e, dx, dy - .15, 1.6);
    if (e.kind === 'weaver') {
      e.weaverFlinchT = 30; e.weaverRetreatT = 150; e.windup = 0; e.blink = 0; e.attackCd = Math.max(e.attackCd, 55);
    }
    hit = true;
  }
  if (!hit) return;
  club.hitThisSwing = true;
  rig.vx *= .3; rig.vy *= .3; rig.wristVelocity *= .4;
  club.durability--;
  ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, 4);
  ctx.audio.noiseBurst(.07, 420, .12, true); ctx.audio.tone(120, 42, .1, 'triangle', .08);
  ctx.telemetry.count('weaver.legClubHit');
  if (club.durability <= 0) {
    ctx.particles.burst(ox + dx * 18, oy + dy * 18, 10, null, () => packRGB(158, 183, 144), 2.5, { grav: .15 });
    p.legClub = undefined;
    ctx.events.emit('toast', { text: 'The borrowed leg splinters.' });
  }
}

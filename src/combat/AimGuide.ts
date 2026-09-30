import type { CastAction, Ctx, Enemy, ProjectileType } from '@/core/types';
import { Cell, isGas } from '@/sim/CellType';
import { pointHitsCreature } from '@/creatures/body';
import { weaverLegAt, weaverLegGeometry } from '@/creatures/weaverAnatomy';
import { PROJECTILE_LIFE, projectileGravity, isSpentGore, WEAVER_LIMB_DAMAGE } from './projectileDefs';
import { AIM_ASSIST_DEGREES, pickBearingAssist } from './aimAssist';

interface Ballistic { type: ProjectileType; speed: number; gravity: number; bias: number; life: number }
export interface AimGuide {
  angle: number;
  points: Array<{ x: number; y: number }>;
  enemy: Enemy | null;
  leg: number;
  contact: boolean;
  uncertain: boolean;
  spread: number;
  affordable: boolean;
  assisted: boolean;
}

function ballistic(ctx: Ctx, action: CastAction): Ballistic | null {
  const sp = ctx.params.spells;
  const specs: Partial<Record<CastAction['card'], [ProjectileType, number, number]>> = {
    spark: ['bolt', sp.bolt.velocityForce!, 0], bomb: ['bomb', sp.bomb.velocityForce!, 0],
    frostshard: ['iceshard', 11, 0], icelance: ['icelance', 16, 0], meteor: ['meteor', 6.5, -2.2],
  };
  const spec = specs[action.card];
  if (!spec) return null;
  return { type: spec[0], speed: spec[1] * action.speedMul, gravity: projectileGravity(spec[0]), bias: spec[2],
    life: spec[0] === 'bomb' ? sp.bomb.fuseTicks! : PROJECTILE_LIFE[spec[0] as keyof typeof PROJECTILE_LIFE] };
}

/** First contact, using the live spell's discrete gravity and one-cell sweep.
 * Spread, homing, multicast and later ricochets never promise an exact landing. */
function trace(ctx: Ctx, angle: number, spec: Ballistic, guide: AimGuide): AimGuide {
  const p = ctx.player, world = ctx.world;
  let x = p.x + Math.cos(angle) * 9, y = p.y - (p.crawling ? 4 : 9) + Math.sin(angle) * 9;
  const vx = Math.cos(angle) * spec.speed;
  let vy = Math.sin(angle) * spec.speed + spec.bias, travelled = 0;
  guide.angle = angle; guide.points.push({ x, y });
  const enemies = ctx.enemies.filter(e => e.hp > 0 && Math.hypot(e.x - p.x, e.y - p.y) < 290);
  for (let tick = 0; tick < Math.min(90, spec.life); tick++) {
    vy += spec.gravity;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy))));
    for (let step = 0; step < steps; step++) {
      x += vx / steps; y += vy / steps; travelled += Math.hypot(vx, vy) / steps;
      const gx = Math.floor(x), gy = Math.floor(y), type = world.type(gx, gy);
      const solid = !world.inBounds(gx, gy) || (type !== Cell.Empty && !isGas(type) && !isSpentGore(type));
      for (const enemy of enemies) {
        if (Math.abs(enemy.x - x) > 80 || Math.abs(enemy.y - y) > 65) continue;
        const leg = WEAVER_LIMB_DAMAGE[spec.type] && !solid && enemy.kind === 'weaver' ? weaverLegAt(enemy, x, y, 1) : -1;
        const body = spec.type !== 'bomb' && pointHitsCreature(enemy, ctx.enemyCtl.defs[enemy.kind], x, y, spec.type === 'icelance' ? 3 : spec.type === 'meteor' ? 7 : 2);
        if (leg >= 0 || body) {
          guide.enemy = enemy; guide.leg = leg; guide.contact = true; guide.points.push({ x, y }); return guide;
        }
      }
      if (solid || ctx.rigidBodies?.hitTest?.(x, y)) {
        guide.contact = true; guide.points.push({ x, y }); return guide;
      }
      if (travelled >= 240) { guide.points.push({ x, y }); return guide; }
    }
    guide.points.push({ x, y });
  }
  return guide;
}

/** The angle to launch at (x, y) from (ox, oy) so the spell's gravity and upward bias still bring it there. */
function launchAngle(ox: number, oy: number, x: number, y: number, spec: Ballistic): number {
  let angle = Math.atan2(y - oy, x - ox);
  for (let i = 0; i < 4; i++) {
    const t = Math.max(0, (x - ox - Math.cos(angle) * 9) / (Math.cos(angle) * spec.speed || .001));
    angle = Math.atan2(y - oy - spec.bias * t - spec.gravity * t * (t + 1) / 2, x - ox);
  }
  return angle;
}

/**
 * The player's Aim assist option (Off / Light / Strong; Trickshot off): a creature the aim DIRECTION already
 * points near is locked, because a stick or a keyboard has no cursor to put on it. Sleeping creatures are
 * left alone (a lock should not wake a roost).
 */
function bearingAssist(ctx: Ctx, raw: number, spec: Ballistic): { angle: number; enemy: Enemy; leg: number } | null {
  const tolerance = AIM_ASSIST_DEGREES[ctx.state.aimAssist ?? 'off'] * Math.PI / 180;
  const p = ctx.player, ox = p.x, oy = p.y - (p.crawling ? 4 : 9);
  const targets = ctx.enemies.filter(e => e.hp > 0 && !e.sleeping).map(e => ({ x: e.x, y: e.y - ctx.enemyCtl.defs[e.kind].h * .45, ref: e }));
  const hit = pickBearingAssist(ox, oy, raw, tolerance, targets, 260, (x, y) => launchAngle(ox, oy, x, y, spec));
  return hit ? { angle: hit.angle, enemy: hit.ref, leg: -1 } : null;
}

function assistAngle(ctx: Ctx, raw: number, spec: Ballistic): { angle: number; enemy: Enemy; leg: number } | null {
  const tolerance = (ctx.state.trickshot?.assistDegrees ?? 0) * Math.PI / 180;
  if (tolerance <= 0) return null;
  let best: ReturnType<typeof assistAngle> = null, score = 18;
  const p = ctx.player, ox = p.x, oy = p.y - (p.crawling ? 4 : 9);
  const candidate = (enemy: Enemy, x: number, y: number, leg: number) => {
    const distance = Math.hypot(x - ctx.input.mouse.x, y - ctx.input.mouse.y);
    if (distance >= score || Math.hypot(x - ox, y - oy) > 220) return;
    const angle = launchAngle(ox, oy, x, y, spec);
    const delta = Math.atan2(Math.sin(angle - raw), Math.cos(angle - raw));
    if (Math.abs(delta) > tolerance) return;
    score = distance; best = { angle: raw + delta, enemy, leg };
  };
  for (const e of ctx.enemies) {
    if (e.hp <= 0 || Math.hypot(e.x - ox, e.y - oy) > 260) continue;
    if (WEAVER_LIMB_DAMAGE[spec.type] && e.kind === 'weaver' && e.weaverLoco) {
      for (let i = 0; i < 8; i++) {
        if ((e.weaverMissingLegs ?? 0) & (1 << i)) continue;
        const points = weaverLegGeometry(e, i);
        for (let j = 2; j < points.length; j++) {
          const x = (points[j - 1].x + points[j].x) / 2, y = (points[j - 1].y + points[j].y) / 2;
          if (weaverLegAt(e, x, y, 1) === i) candidate(e, x, y, i);
        }
      }
    }
    candidate(e, e.x, e.y - ctx.enemyCtl.defs[e.kind].h * .45, -1);
  }
  return best;
}

const cache = new WeakMap<Ctx, { key: string; value: AimGuide | null }>();
export function getAimGuide(ctx: Ctx): AimGuide | null {
  const trick = ctx.state.trickshot?.enabled === true;
  // The player's Aim assist option stands in for Trickshot's lock when Trickshot is off; with both off there is no guide.
  const bearing = !trick && (ctx.state.aimAssist ?? 'off') !== 'off';
  if ((!trick && !bearing) || ctx.player.dead || ctx.player.legClub || ctx.state.mode !== 'play') return null;
  const p = ctx.player, wand = ctx.wands.wands[ctx.wands.active];
  const key = `${ctx.state.frameCount}:${p.x}:${p.y}:${p.crawling}:${ctx.input.mouse.x}:${ctx.input.mouse.y}:${ctx.wands.active}:${wand.castIndex}:${wand.mana}:${ctx.state.trickshot?.assistDegrees}:${ctx.state.aimAssist}`;
  const old = cache.get(ctx); if (old?.key === key) return old.value;
  const cast = ctx.wands.peekCast?.(), action = cast?.actions[0];
  const spec = action ? ballistic(ctx, action) : null;
  if (!spec || !cast || !action) { cache.set(ctx, { key, value: null }); return null; }
  const raw = Math.atan2(ctx.input.mouse.y - p.y + (p.crawling ? 4 : 9), ctx.input.mouse.x - p.x);
  const make = (): AimGuide => ({ angle: raw, points: [], enemy: null, leg: -1, contact: false,
    uncertain: action.shortHoming || cast.actions.length > 1 || action.bounces > 0 || action.card === 'bomb' || (action.card === 'spark' && action.dmgMul >= 1.5),
    spread: ctx.state.debugGodMode ? 0 : Math.max(0, cast.spread + action.spreadAdd), affordable: cast.affordable, assisted: false });
  const target = action.shortHoming ? null : bearing ? bearingAssist(ctx, raw, spec) : assistAngle(ctx, raw, spec);
  // No creature in the cone: the aim is the player's own, untouched, and nothing is traced.
  if (bearing && !target) { cache.set(ctx, { key, value: null }); return null; }
  let guide = target ? trace(ctx, target.angle, spec, make()) : trace(ctx, raw, spec, make());
  if (target && (guide.enemy !== target.enemy || guide.leg !== target.leg)) guide = trace(ctx, raw, spec, make());
  else if (target) {
    guide.assisted = true;
    if (!guide.uncertain) guide.spread = 0;
  }
  cache.set(ctx, { key, value: guide }); return guide;
}

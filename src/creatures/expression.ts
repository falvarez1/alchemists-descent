import type { Enemy } from '@/core/types';
import { clamp, lerp } from '@/core/math';

/** Small, tick-owned facial rig. It uses remembered observations; a hidden
 * player cannot steer a creature's eyes through a wall. These cosmetic springs
 * rebuild after loading and never consume the simulation's random stream. */
export interface CreatureExpression {
  gazeX: number;
  gazeY: number;
  alert: number;
  fear: number;
  hurt: number;
  jaw: number;
  lid: number;
}

export function tickCreatureExpression(e: Enemy, tick: number): void {
  const phase = e.mind?.phase ?? Math.floor(e.bobPhase * 100);
  const face = e.mind?.facing ?? Math.sign(e.vx || 1);
  const sensed = (e.mind?.confidence ?? 0) > .12;
  const asleep = e.sleeping || e.mind?.intent === 'rest';
  const threat = e.mind?.intent === 'hunt';
  const fear = Math.max(e.fear ?? 0, e.mind?.intent === 'retreat' || (e.rootPanic ?? 0) > 0 || (e.weaverRetreatT ?? 0) > 0 ? .9 : 0);
  const hurt = clamp(1 - e.hp / Math.max(1, e.maxHp), 0, 1);
  const feeding = (e.weaverFeedT ?? 0) > 0 || (e.rillFeedT ?? 0) > 0 || (e.mawChewT ?? 0) > 0;
  const attacking = (e.windup ?? 0) > 0 || (e.swoop ?? 0) > 0 || (e.fusing ?? 0) > 0;
  const targetX = sensed ? clamp(((e.mind?.targetX ?? e.x) - e.x) / 55, -1, 1) : face * .55 + Math.sin(tick * .013 + phase) * .25;
  const targetY = sensed ? clamp(((e.mind?.targetY ?? e.y) - e.y + 7) / 55, -1, 1) : Math.sin(tick * .017 + phase) * .2;
  const rig = e.expression ??= { gazeX: face * .5, gazeY: 0, alert: 0, fear: 0, hurt: 0, jaw: 0, lid: 0 };
  rig.gazeX = lerp(rig.gazeX, targetX, .13);
  rig.gazeY = lerp(rig.gazeY, targetY, .13);
  rig.alert = lerp(rig.alert, attacking ? 1 : threat ? .8 : sensed ? .55 : 0, .12);
  rig.fear = lerp(rig.fear, fear, fear > rig.fear ? .2 : .045);
  rig.hurt = lerp(rig.hurt, hurt, .12);
  rig.jaw = lerp(rig.jaw, feeding ? .35 + Math.sin(tick * .48 + phase) * .25 : attacking ? .95 : fear * .45, .3);
  // Enemy.blink is also an attack telegraph. Eyelids have an independent clock.
  const blinkPhase = (tick + phase) % (185 + phase % 67);
  const blink = blinkPhase < 7 ? Math.sin(blinkPhase / 7 * Math.PI) : 0;
  rig.lid = clamp(Math.max(blink * (1 - rig.alert * .7), e.sleeping ? .95 : asleep && !feeding ? .6 : hurt * .24), 0, 1);
}

import type { Enemy } from '@/core/types';
import type { World } from '@/sim/World';
import { blocksEntity, Cell } from '@/sim/CellType';
import type { CreatureCue, CreatureMind } from './types';

export interface PerceivedPlayer {
  x: number;
  y: number;
  vx: number;
  dead: boolean;
  crouching: boolean;
  light: number;
}

export function ensureCreatureMind(enemy: Enemy, seed: number): CreatureMind {
  if (enemy.mind) return enemy.mind;
  const phase = (Math.imul(Math.round(enemy.x * 31 + enemy.y * 17 + enemy.bobPhase * 1000), 2654435761) ^ seed) >>> 0;
  enemy.mind = {
    id: `${enemy.kind}-${phase.toString(36)}`, phase,
    homeX: enemy.x, homeY: enemy.y,
    targetX: enemy.x, targetY: enemy.y, targetVx: 0,
    confidence: 0, visible: false, lastSeen: -10000, lastHeard: -10000, lastTick: -1,
    nextSense: 0, nextDecision: 0, commitUntil: 0, intent: 'forage',
    hunger: 0.3 + (phase % 17) * 0.01, irritation: 0, lastHp: enemy.hp, facing: phase % 2 ? 1 : -1,
  };
  return enemy.mind;
}

/** Grid-occluded senses are independent of the view, renderer and light texture. */
export function sightClear(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 2; i < steps; i++) {
    const x = Math.floor(x0 + (x1 - x0) * i / steps);
    const y = Math.floor(y0 + (y1 - y0) * i / steps);
    if (!world.inBounds(x, y)) return false;
    const type = world.type(x, y);
    if (blocksEntity(type) && type !== Cell.Glass) return false;
  }
  return true;
}

export function tickCreatureMind(
  world: World, enemy: Enemy, player: PerceivedPlayer, cues: readonly CreatureCue[], tick: number, seed: number, senseScale = 1,
): CreatureMind {
  const mind = ensureCreatureMind(enemy, seed);
  const elapsed = mind.lastTick < 0 ? 1 : Math.max(0, tick - mind.lastTick);
  mind.lastTick = tick;
  mind.hunger = Math.min(1, mind.hunger + elapsed / 21000);
  mind.confidence = Math.max(0, mind.confidence - elapsed / 420);
  mind.irritation = Math.max(0, mind.irritation - elapsed / 800);
  if (enemy.hp < mind.lastHp) {
    mind.irritation = Math.min(1, mind.irritation + (mind.lastHp - enemy.hp) / Math.max(12, enemy.maxHp * 0.12));
    mind.nextSense = 0;
    mind.nextDecision = 0;
  }
  mind.lastHp = enemy.hp;
  if (Math.abs(enemy.vx) > 0.12) mind.facing = Math.sign(enemy.vx);
  if (tick >= mind.nextSense) {
    mind.nextSense = tick + 6 + mind.phase % 3;
    const dx = player.x - enemy.x;
    const dy = player.y - 9 - (enemy.y - 6);
    const distance = Math.hypot(dx, dy);
    const vision = enemy.kind === 'stonemaw' ? 26 : enemy.kind === 'weaver' ? 215 : 265;
    const range = vision * senseScale * (0.52 + player.light * 0.48) * (player.crouching ? 0.65 : 1);
    const facing = dx * mind.facing > -18 || distance < 42 || mind.irritation > 0.3;
    mind.visible = !player.dead && !enemy.sleeping && distance < range && facing && sightClear(world, enemy.x, enemy.y - 6, player.x, player.y - 9);
    if (mind.visible) {
      mind.targetX = player.x;
      mind.targetY = player.y;
      mind.targetVx = player.vx;
      mind.lastSeen = tick;
      mind.confidence = Math.min(1, mind.confidence + (distance < 55 ? 0.7 : 0.3));
    } else {
      // Sounds locate the sound, not the now-hidden player. Occlusion attenuates
      // hearing; Stone Maws specialize in vibrations transmitted through rock.
      for (const cue of cues) {
        if (cue.tick <= mind.lastHeard || tick - cue.tick > 60) continue;
        const d = Math.hypot(cue.x - enemy.x, cue.y - enemy.y);
        const specialist = enemy.kind === 'stonemaw' && cue.kind === 'vibration';
        const transmission = specialist || sightClear(world, enemy.x, enemy.y - 5, cue.x, cue.y) ? 1 : 0.28;
        if (d > cue.radius * transmission || cue.strength < 0.15) continue;
        mind.targetX = cue.x;
        mind.targetY = cue.y;
        mind.targetVx = 0;
        mind.lastHeard = cue.tick;
        mind.confidence = Math.max(mind.confidence, Math.min(0.7, cue.strength * 0.65));
      }
    }
  }
  if (tick < mind.nextDecision && mind.irritation < 0.75) return mind;
  mind.nextDecision = tick + 15 + mind.phase % 8;
  const distance = Math.hypot(mind.targetX - enemy.x, mind.targetY - enemy.y);
  const organic = enemy.kind === 'weaver' || enemy.kind === 'rillback' || enemy.kind === 'rootloper' || enemy.kind === 'stonemaw';
  const alarm = enemy.status.burning > 0 || enemy.hp < enemy.maxHp * 0.25;
  const homeDistance = Math.hypot(enemy.x - mind.homeX, enemy.y - mind.homeY);
  const intrusion = mind.visible && distance < (enemy.kind === 'rillback' ? 38 : 52);
  let next: CreatureMind['intent'];
  if (alarm) next = 'retreat';
  else if (mind.confidence > 0.12 && (!organic || mind.irritation > 0.22 || intrusion || mind.hunger > 0.82)) next = mind.visible ? 'hunt' : 'investigate';
  else if (mind.confidence > 0.12 && !mind.visible) next = 'investigate';
  else if (homeDistance > 190) next = 'return';
  else if (mind.visible && distance < 150) next = 'observe';
  else next = mind.hunger < 0.18 ? 'rest' : 'forage';
  // A new threat can interrupt. Idle choices commit long enough to read as
  // behavior, without flickering between contradictory directions each frame.
  if (next === 'retreat' || next === 'hunt' || (next === 'investigate' && !mind.visible) || tick >= mind.commitUntil || mind.confidence === 0) {
    if (next !== mind.intent) mind.commitUntil = tick + 60 + mind.phase % 40;
    mind.intent = next;
  }
  return mind;
}

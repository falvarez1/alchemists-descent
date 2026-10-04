import type { AnimationClock } from './animation';

export interface PoseDetail {
  grounded: boolean; crawling: boolean; crouch: number; stun: number; frozen: boolean; burning: boolean;
  stagger: number; staggerDir: number; facing: number; skid: number; swap: number; fidget: number;
  speed: number; near: boolean; dead: boolean; finished: boolean; winner: boolean; entrance: number;
  shieldHit: boolean;
}
/** Presentation follows authoritative body state; it never starts or extends an action lock. */
export function detailAnimation(action: string, body: PoseDetail, previous?: AnimationClock): string {
  if (body.finished) return body.winner ? 'victory' : 'defeat';
  if (body.dead) return 'ko';
  if (action === 'shield') return body.shieldHit ? 'shield_hit' : 'shield';
  if (action === 'hurt') return body.crawling ? 'hurt_crouch' : !body.grounded ? 'hurt_air'
    : body.staggerDir * body.facing > 0 ? 'hurt_back' : 'hurt';
  const movement = ['idle', 'run', 'land', 'jump', 'fall'].includes(action);
  if (!movement) return action;
  if (body.frozen) return 'frozen';
  if (body.stun > 0) return 'stun';
  if (body.entrance >= 0 && body.entrance < 18) return 'respawn';
  if (body.swap > 0) return 'pickup';
  if (body.burning) return 'burning';
  if (!body.grounded) {
    if (previous?.action === 'ledge_hang' || previous?.action === 'ledge_release' && previous.age < 12) return 'ledge_release';
    return action;
  }
  if (body.crawling || body.crouch > 0) return body.crouch > 0 && body.crouch < 4 ? 'duck' : body.speed > .25 ? 'crouch_walk' : 'crouch_idle';
  if (['duck', 'crouch_idle', 'crouch_walk'].includes(previous?.action ?? '') || previous?.action === 'stand_up' && previous.age < 12) return 'stand_up';
  if (['tumble', 'hurt_air'].includes(previous?.action ?? '') || previous?.action === 'get_up' && previous.age < 12) return 'get_up';
  if (body.skid > 0) return 'brake';
  if (action === 'run') {
    if (body.speed < 1.2) return 'walk';
    if (['idle', 'idle_ready', 'walk'].includes(previous?.action ?? '') || previous?.action === 'dash' && previous.age < 9) return 'dash';
    return 'run';
  }
  if (action === 'idle') return body.fidget > 0 ? 'taunt' : body.near ? 'idle_ready' : 'idle';
  return action;
}

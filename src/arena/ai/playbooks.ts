import type { FighterId } from '@/content/fighters';
import type { PerceivedFoe } from '@/arena/ai/execution';
import type { MeView } from '@/arena/ai/worldView';
import type { IntentId } from '@/arena/ai/intent';
import { styleFor } from '@/arena/ai/intent';

export interface AbilityPlan { tactical: string | null; ultimate: string | null; aim: { x: number; y: number } | null }

/** Each kit spends its resources for a specific opportunity, never just because a timer expired. */
export function abilityPlan(me: MeView, target: PerceivedFoe, intent: IntentId, line: boolean, threatened: boolean): AbilityPlan {
  const d = target.dist, id = me.fighter;
  const style = styleFor(id);
  const withdrawing = intent === 'retreat' || intent === 'recover';
  const close = d < 100;
  const trading = line && d < 190;
  const plan: AbilityPlan = { tactical: null, ultimate: null, aim: tacticalAim(id, me, target) };
  if (line && d >= style.z[0] && d <= style.z[1]) plan.tactical = 'target in effective range';
  switch (id) {
    case 'brann-rook':
      plan.tactical = threatened || trading ? 'guard the exchange' : null;
      plan.ultimate = close && (me.hpFrac < 0.7 || threatened) ? 'armour for a close trade' : null;
      break;
    case 'edda-morrow':
      plan.tactical = threatened || trading ? 'protect before trading' : null;
      plan.ultimate = me.grounded && me.hpFrac < 0.72 && d < 210 ? 'heal and deflect' : null;
      break;
    case 'kest-rel':
    case 'selene-wraith': {
      plan.tactical = line && (withdrawing || threatened || (d > style.range + 20 && d < 135)) ? 'dash to better spacing' : null;
      const dir = Math.sign(target.cx - me.x) || me.facing;
      plan.aim = { x: me.x + dir * (withdrawing || threatened ? -45 : 45), y: me.sy };
      plan.ultimate = id === 'kest-rel' ? (close && (threatened || withdrawing) ? 'break close pressure' : null) : (trading ? 'disrupt tracking' : null);
      break;
    }
    case 'ilyra-voss': plan.ultimate = trading && me.shotAffordable ? 'overcharge the attack' : null; break;
    case 'rusk-emberjaw':
      plan.tactical = line && !withdrawing && d >= 20 && d < 85 && Math.abs(target.cy - me.sy) < 20 ? 'ram a reachable target' : null;
      plan.ultimate = close ? 'armour before closing' : null;
      break;
    case 'sable-fen': plan.ultimate = target.foe.hpFrac < 0.65 && d < 300 ? 'track a wounded opponent' : null; break;
    case 'mara-quell': plan.ultimate = d < 140 ? 'slow a target in the wave' : null; break;
    case 'nox-calder': plan.ultimate = trading ? 'conceal the next exchange' : null; break;
    case 'father-thorne': plan.ultimate = me.grounded && d < 110 ? 'control contested ground' : null; break;
  }
  if (!me.tactical.ready || me.tactical.active > 0) plan.tactical = null;
  if (!me.ultimate.ready) plan.ultimate = null;
  return plan;
}

/**
 * PLAYBOOKS (docs/arena/AI-FIGHTERS.md 4): the few places where a fighter's kit asks the bot to do something the shared rules would not.
 * The basic brain shoots, walks and presses Z and T by the fighter's `Style`; a playbook is the exception that makes one tactical land.
 * Small on purpose: each entry exists because a measurement showed the shared rule failing (a tactical refused every time), not because a
 * style would be nice. v2 grows this into the full per-fighter rule lists.
 */

/**
 * Where the cursor must be when Z is pressed, when that is NOT the foe's body; null = the shared aim (at the foe, led).
 *  - Father Thorne's Ironvine grows along a surface the aim crosses: aimed at the foe in the air it found no ground and was refused every
 *    time (`verify-ai-basic`: Z pressed 11 times a fight, fired 0); aimed at the floor under the foe it plants the vines in its path.
 */
export function tacticalAim(id: FighterId | null, _me: MeView, target: PerceivedFoe): { x: number; y: number } | null {
  switch (id) {
    case 'father-thorne':
      return { x: target.x, y: target.y + 1 };
    default:
      return null;
  }
}

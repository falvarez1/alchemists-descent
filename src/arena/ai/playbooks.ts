import type { FighterId } from '@/content/fighters';
import type { PerceivedFoe } from '@/arena/ai/execution';
import type { MeView } from '@/arena/ai/worldView';

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

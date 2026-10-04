import type { AdaptiveMemory, LearnedMove } from '@/arena/ai/adaptiveMemory';
import type { MeView } from '@/arena/ai/worldView';
import type { NavEdge, NavNode, StageNav } from '@/arena/ai/nav';
import type { Rng } from '@/core/rng';

export interface PursuitPlan extends LearnedMove { edge: NavEdge }

/** Pick once per leg. Outcome memory and observed geometry outrank the small variety term. */
export function planPursuit(nav: StageNav, from: NavNode, to: NavNode, me: MeView, targetX: number,
  opponent: number, memory: AdaptiveMemory, strength: number, rng: Rng, canStand: (x: number, y: number) => boolean): PursuitPlan | null {
  const first = nav.route(from.id, to.id)?.[0];
  if (!first) return null;
  const context = `${opponent}:${from.id}>${to.id}:${Math.round(targetX / 48)}`;
  const candidates: NavEdge[] = [{ ...first, planId: 'lip', minFuel: first.kind === 'levitate' ? me.maxLevit : 0 }];
  if (from.id === 'floor' && first.to === to.id && to.y < from.y) {
    const lo = Math.max(from.x0, to.x0) + 8, hi = Math.min(from.x1, to.x1) - 8;
    if (lo <= hi) {
      const center = Math.max(lo, Math.min(hi, targetX));
      for (const [id, offset] of [['center', 0], ['left', -36], ['right', 36]] as const) {
        const x = Math.max(lo, Math.min(hi, center + offset));
        if (!canStand(x, from.y) || !canStand(x, to.y)) continue;
        if (candidates.some(e => e.through && Math.abs(e.launchX - x) < 12)) continue;
        candidates.push({ ...first, planId: `through-${id}`, through: true, launchX: x, landX: x, minFuel: me.maxLevit });
      }
    }
  }
  let best: PursuitPlan | null = null, bestCost = Infinity;
  for (const edge of candidates) {
    const action = edge.planId!;
    if (!memory.allowed(context, action)) continue;
    const cost = Math.abs(me.x - edge.launchX) + Math.abs(targetX - edge.landX) * .6 + (edge.through ? 0 : 35)
      - 100 * memory.bias(context, action, Math.max(.5, strength)) + rng.range(-12, 12);
    if (cost < bestCost) { bestCost = cost; best = { context, action, edge }; }
  }
  return best;
}

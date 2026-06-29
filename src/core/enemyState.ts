import type { Enemy } from '@/core/types';

export const RILLBACK_WET_THRESHOLD = 0.28;

/** Human-readable AI state for runtime inspection surfaces. */
export function enemyStateLabel(e: Enemy): string {
  if ((e.knockT ?? 0) > 0) return 'launched';
  if (e.status.frozen > 0) return 'frozen';
  if (e.status.burning > 0) return 'panicking';
  if (e.status.electrified > 0) return 'shocked';
  if (e.kind === 'bat' && (e.slimed ?? 0) > 0) return 'slimed';
  if ((e.wary ?? 0) > 0) return 'wary';
  if (e.kind === 'rootloper' && (e.rootPanic ?? 0) > 0) return 'unrooted';
  if (e.kind === 'stonemaw' && (e.mawChewT ?? 0) > 0) return 'chewing';
  if (e.kind === 'stonemaw' && (e.mawStun ?? 0) > 0) return 'stunned';
  if (e.kind === 'rillback' && (e.rillChargeWindup ?? 0) > 0) return 'charging';
  if (e.kind === 'rillback' && (e.rillWet ?? 0) < RILLBACK_WET_THRESHOLD) return 'beached';
  if (e.kind === 'weaver' && (e.windup ?? 0) > 0) return 'poised';
  if (e.kind === 'weaver' && e.blink > 0) return 'weaving';
  if (e.sleeping) return 'asleep';
  if (e.kind === 'weaver' && (e.cranky ?? 0) > 0) return 'cranky';
  if (e.windup) return 'winding up';
  if (e.alerted) return 'hunting';
  if (e.patrol && e.patrol.length > 0) return 'patrolling';
  return 'idle';
}

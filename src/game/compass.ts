import type { LevelRuntime } from '@/core/types';

/**
 * The compass the game itself steers by (the HUD arrow and the map's yellow
 * star). One waypoint per level, and whoever set it last wins, except that the
 * game never takes the compass from a hand that set it: only a waypoint the game
 * itself put there (the labels below) is replaced. Pell's gift and the Kiln's
 * escape write their own marks and are left alone here too.
 */

/** The label the exit portal's waypoint carries (set when the golden key is taken). */
export const PORTAL_WAYPOINT_LABEL = 'Exit Portal';

/** Labels the game sets through this module, so it may replace them. */
const GAME_LABELS: ReadonlySet<string> = new Set([PORTAL_WAYPOINT_LABEL]);

/** Point the compass at (x, y) unless a waypoint of anyone else's stands. True when it was set. */
export function setGameWaypoint(rt: Pick<LevelRuntime, 'mapWaypoint'>, label: string, x: number, y: number): boolean {
  const current = rt.mapWaypoint;
  if (current && !GAME_LABELS.has(current.label)) return false;
  rt.mapWaypoint = { x: Math.round(x), y: Math.round(y), label };
  return true;
}

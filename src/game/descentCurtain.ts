import type { Ctx } from '@/core/types';
import { FLOORS_TOTAL, LEVELS, floorDisplayName, floorOf } from '@/config/worldgraph';

/**
 * PAINT-FIRST DESCENT. Levels.enterLevel raises the level curtain and then
 * generates the floor in the same task, so the browser never gets a frame to
 * paint the curtain: the player clicked "Descend" and watched an unchanged
 * Sanctum for ~4 s (the feel review measured a 4085 ms long task that began
 * 17 ms after the click). Every way down that starts a fresh floor goes
 * through here instead: raise the curtain ABOVE the menu it came from, let two
 * frames go by so it is on screen, and only then run the synchronous work.
 *
 * Presentation only: the floor it opens, the save, the run are all the
 * caller's own `run` callback.
 */

/** The curtain's words for a floor (the same copy Levels.enterLevel raises). */
export function descentCurtainCopy(levelId: string): { title: string; detail: string } {
  const floor = floorOf(levelId);
  if (floor > 0) return { title: floorDisplayName(levelId), detail: `Floor ${floor} of ${FLOORS_TOTAL}` };
  const name = LEVELS[levelId]?.name;
  return { title: 'Opening the descent', detail: name ? `Preparing ${name}.` : 'Drawing the cave mouth open.' };
}

/** A gentler, slower fade's worth of waiting (ms) for players who asked for fewer flashes. */
const CALM_FADE_MS = 200;
/** rAF never fires in a hidden tab: go anyway after this long. */
const FRAME_FALLBACK_MS = 250;

function twoFrames(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    window.setTimeout(finish, FRAME_FALLBACK_MS);
  });
}

/**
 * Show the curtain, wait until it has painted, run `run` (the blocking work),
 * then put the curtain's stacking back. Resolves with `run`'s result. The
 * curtain itself lifts the usual way (Levels emits `levelCurtain` hidden).
 */
export async function descendBehindCurtain<T>(
  ctx: Ctx,
  copy: { title: string; detail: string },
  run: () => T,
): Promise<T> {
  const curtain = document.getElementById('level-curtain');
  curtain?.classList.add('over-menus');
  ctx.events.emit('levelCurtain', { visible: true, title: copy.title, detail: copy.detail });
  await twoFrames();
  // Reduce flashes: the fade is slower (menus.css), so wait it out before the thread blocks.
  if (ctx.state.reduceFlashes === true) await new Promise<void>((resolve) => window.setTimeout(resolve, CALM_FADE_MS));
  try {
    return run();
  } finally {
    curtain?.classList.remove('over-menus');
  }
}

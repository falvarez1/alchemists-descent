import type { Ctx } from '@/core/types';

/**
 * The chill as the lens sees it (entities/chill `screen`): one reading for
 * both post passes (render/PostFx on WebGL, the WebGPU backend's twin).
 *
 * - `grade` 0..1: warmth and colour drain toward a cold blue-grey.
 * - `frost` 0..1: how far the crystals have grown in from the edges (they
 *   start once the grade is under way, so a brush with the cold is only a
 *   tint and a deep chill is a frame of ice).
 * - `cap`: the frost's opacity ceiling. The play area stays readable: the
 *   middle is always clear, and high-readability lighting thins it further.
 * - `calm`: reduced flashes (no glints at the growing front).
 */
export interface ChillLensView {
  grade: number;
  frost: number;
  cap: number;
  calm: boolean;
}

const VIEW: ChillLensView = { grade: 0, frost: 0, cap: 0.55, calm: false };

export function chillLens(ctx: Ctx): ChillLensView {
  const screen = ctx.state.mode === 'play' ? ctx.player.chill?.screen ?? 0 : 0;
  const s = Number.isFinite(screen) ? Math.max(0, Math.min(1, screen)) : 0;
  VIEW.grade = s;
  VIEW.frost = s <= 0.12 ? 0 : ((s - 0.12) / 0.88) ** 1.1;
  VIEW.cap = ctx.state.highReadability ? 0.36 : 0.55;
  VIEW.calm = ctx.state.reduceFlashes === true;
  return VIEW;
}

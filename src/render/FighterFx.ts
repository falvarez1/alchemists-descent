import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { drawStockMovementFx } from '@/render/StockMovementFx';

/**
 * What the equipped fighter's kit has placed in the world (a bell, a prism, an echo, a reveal ring).
 * The kit owns each drawable and its lifetime; this only walks the list, so the render layer never
 * imports a kit. 'under' runs before the foes and the player are drawn, 'over' after (FrameComposer).
 */
export function drawFighterFx(out: PixelSurface, field: LightField, ctx: Ctx, layer: 'under' | 'over'): void {
  if (layer === 'under') drawStockMovementFx(out, ctx);
  const f = ctx.fighters;
  if (!f || f.id === null || ctx.state.mode !== 'play') return;
  const list = f.drawables;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (d.layer === layer) d.draw(out, field, ctx);
  }
}

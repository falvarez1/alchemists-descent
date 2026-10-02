import type { Ctx, Enemy } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';

/**
 * Foes a fighter has revealed (Bloodsense, a ringing bell, the spoor): a pulsing outline around the
 * body that shows through walls and darkness, so the information is something the player can SEE.
 * The outline is a ring of fine pixels, additive so it lights the stone around it a little.
 */
export function drawReveals(
  out: PixelSurface,
  _field: LightField,
  ctx: Ctx,
  touched: readonly Enemy[],
  colourOf: (e: Enemy) => readonly [number, number, number] | undefined,
): void {
  const px = out.addFinePx ?? out.addPx;
  const step = out.pixelStep ?? 1;
  const frame = ctx.state.frameCount;
  const defs = ctx.enemyCtl.defs;
  const calm = ctx.state.reduceFlashes === true;
  for (const e of touched) {
    const rgb = colourOf(e);
    if (!rgb) continue;
    const def = defs[e.kind];
    if (!def) continue;
    const cx = e.x, cy = e.y - def.h * 0.5;
    const rx = def.halfW + 3, ry = def.h * 0.5 + 3;
    const pulse = calm ? 0.8 : 0.7 + 0.3 * Math.sin(frame * 0.15 + e.bobPhase * 6);
    const n = Math.max(24, Math.round((rx + ry) * 2.4));
    const k = 0.55 * pulse;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // The ring breathes open and shut in a slow chase so it reads as attention, not a hitbox.
      const gate = 0.55 + 0.45 * Math.cos(a * 3 - frame * 0.08);
      px.call(out, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, rgb[0] * k * gate, rgb[1] * k * gate, rgb[2] * k * gate);
    }
    // A small chevron above the head, so a foe far out of the light is still found.
    const hy = e.y - def.h - 5 - (calm ? 0 : Math.sin(frame * 0.12) * 1.2);
    for (let i = 0; i <= 3; i += step) {
      px.call(out, cx - i, hy - 3 + i, rgb[0] * k * 1.4, rgb[1] * k * 1.4, rgb[2] * k * 1.4);
      px.call(out, cx + i, hy - 3 + i, rgb[0] * k * 1.4, rgb[1] * k * 1.4, rgb[2] * k * 1.4);
    }
  }
}

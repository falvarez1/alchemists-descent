import type { Ctx } from '@/core/types';
import type { FighterDrawable } from '@/core/fighters';
import type { LightField, PixelSurface } from '@/render/pixels';
import type { DuelEffect } from '@/net/duel/snapshot';

/** Compatibility adapter for existing closure-owned kit visuals. Gameplay and
 * terrain never use these commands. A future kit can export semantic visual
 * state instead without changing match authority or the transport. */
export function captureDuelEffects(ctx: Ctx, light: LightField): DuelEffect[] {
  let budget = 24_000;
  return (ctx.fighters?.drawables ?? []).slice(0, 32).map((drawable) => {
    const pixels: number[] = [];
    const pixel = (mode: number, x: number, y: number, r: number, g: number, b: number): void => {
      if (budget <= 0 || ![x, y, r, g, b].every(Number.isFinite)) return;
      budget--;
      pixels.push(
        mode,
        Math.round(x * 2) / 2,
        Math.round(y * 2) / 2,
        Math.round(r * 1000) / 1000,
        Math.round(g * 1000) / 1000,
        Math.round(b * 1000) / 1000,
      );
    };
    const out: PixelSurface = {
      pixelStep: 1,
      setPx: (x, y, r, g, b) => pixel(0, x, y, r, g, b),
      addPx: (x, y, r, g, b) => pixel(1, x, y, r, g, b),
    };
    drawable.draw(out, light, ctx);
    return { layer: drawable.layer, pixels };
  });
}
export function replicaDuelEffects(effects: DuelEffect[]): FighterDrawable[] {
  return effects.map((effect) => ({
    layer: effect.layer,
    draw(out) {
      const p = effect.pixels;
      for (let i = 0; i < p.length; i += 6) {
        if (p[i] === 0) out.setPx(p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
        else out.addPx(p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
      }
    },
  }));
}

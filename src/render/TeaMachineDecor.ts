import type { Ctx } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';
import { drawTeaLinkages } from '@/render/TeaMachineLinkages';

/** Riveted wheels and the duck are drawn in the same cell-scale grammar as props. */
export function drawTeaMachineDecor(out: PixelSurface, ctx: Ctx): void {
  if (!ctx.levels.current?.living?.tea) return;
  drawTeaLinkages(out, ctx);
  const lit = (x: number, y: number, r: number, g: number, b: number): void => out.setPx(x, y, r, g, b);
  const duck = ctx.rigidBodies.bodies.find(b => b.tag === 'tea-duck');
  if (duck) {
    const c = Math.cos(duck.angle), s = Math.sin(duck.angle);
    // Inverse sample destination cells so rotation cannot leave pinholes
    // between forward-mapped head pixels.
    for (let y = Math.floor(duck.y - 22); y <= duck.y + 22; y++) for (let x = Math.floor(duck.x - 22); x <= duck.x + 22; x++) {
      const dx = Math.round((x - duck.x) * c + (y - duck.y) * s - 7);
      const dy = Math.round(-(x - duck.x) * s + (y - duck.y) * c + 8);
      if (dx * dx + (dy + 1) ** 2 < 26) lit(x, y, .88, .67, .16);
      if (dx >= 4 && dx < 10 && dy >= 0 && dy < 3) lit(x, y, .85, .38, .09);
      if (dx === 2 && dy === -2) lit(x, y, .1, .08, .04);
    }
  }
}

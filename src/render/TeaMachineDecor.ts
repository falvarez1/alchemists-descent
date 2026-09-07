import type { Ctx } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';

/** Riveted wheels and the duck are drawn in the same cell-scale grammar as props. */
export function drawTeaMachineDecor(out: PixelSurface, ctx: Ctx): void {
  if (!ctx.levels.current?.living?.tea) return;
  const s = ctx.levels.current.living.tea;
  const lit = (x: number, y: number, r: number, g: number, b: number): void => out.setPx(x, y, r, g, b);
  for (const [x, y, radius, stage] of [[430, 300, 9, 1], [607, 147, 7, 2], [824, 199, 9, 4], [968, 175, 7, 5], [1171, 201, 9, 7], [1289, 105, 8, 8]]) {
    const angle = s.stage === stage && !s.stalled ? ctx.state.frameCount * .035 : stage * .7;
    for (let a = 0; a < Math.PI * 2; a += .06) {
      const rad = radius + (Math.floor((a + angle) * 5) % 2 ? 1 : 0);
      lit(x + Math.cos(a) * rad, y + Math.sin(a) * rad, .59, .43, .2);
    }
    for (let spoke = 0; spoke < 4; spoke++) for (let d = 0; d < radius; d++) {
      const a = angle + spoke * Math.PI / 2;
      lit(x + Math.cos(a) * d, y + Math.sin(a) * d, .51, .4, .23);
    }
    lit(x, y, .9, .74, .4);
  }
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

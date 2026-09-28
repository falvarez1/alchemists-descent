import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { BRASS, BRASS_D, BRASS_L, INK, IRON, IRON_D, Pen, STEEL, STEEL_L, cameraView, type RGB } from '@/render/sprites/FineArt';
import { Cell } from '@/sim/CellType';
import { WORKS_BARRICADE, WORKS_GATE, worksGateOpen } from '@/world/breathingWorks';

const ENAMEL: RGB = [0.86, 0.82, 0.7];
const SIGNAL: RGB = [0.78, 0.16, 0.1];
const FLAME: RGB = [1.1, 0.62, 0.18];
const EMBER: RGB = [1.15, 0.74, 0.32];

/**
 * The Breathing Works' readable fixtures, drawn at presentation resolution
 * over the real cells they dress: the barricade's straps and its enamel
 * "no naked flames" plate (they fall away with the wood beneath them), and
 * the Lower Bell's floor gate, whose bars follow the grid's real sliding leaves.
 */
export function drawWorksFixtures(out: PixelSurface, light: LightField, ctx: Ctx): void {
  const view = cameraView(ctx.camera, 24);
  const penAt = (x: number, y: number): Pen => {
    const s = light.sample(x, y), floor = 0.55 * (s.open ?? 1);
    return new Pen(out, view, [Math.min(1.05, Math.max(floor, s.r)), Math.min(1.05, Math.max(floor, s.g)), Math.min(1.05, Math.max(floor, s.b))]);
  };
  const w = ctx.world, frame = ctx.state.frameCount;
  const wood = (x: number, y: number): boolean => w.type(Math.floor(x), Math.floor(y)) === Cell.Wood;

  // ---- The barricade: two iron straps and a sign, only over wood still standing.
  {
    const B = WORKS_BARRICADE, p = penAt((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2);
    if (p.inView(B.x0 - 2, B.y0 - 2, B.x1 + 2, B.y1 + 2)) {
      for (const y of [B.y0 + 6, B.y1 - 7]) {
        for (let x = B.x0; x <= B.x1 + 0.5; x += p.step) if (wood(x, y) && wood(x, y + 1)) {
          p.px(x, y, IRON); p.px(x, y + 0.5, IRON_D); p.px(x, y + 1, INK, .6);
        }
        for (const x of [B.x0 + 1, B.x1 - 1]) if (wood(x, y)) p.rivet(x, y + .5, STEEL_L);
      }
      // The plate: a flame, struck through. Advice the alchemist is about to ignore.
      const sx = (B.x0 + B.x1) / 2, sy = B.y0 + 12;
      if (wood(sx - 2, sy - 2) && wood(sx + 2, sy + 2)) {
        p.polygon([[sx - 3.5, sy - 3], [sx + 3.5, sy - 3], [sx + 3.5, sy + 3], [sx - 3.5, sy + 3]], ENAMEL, 1, 0.15);
        p.line(sx - 3.5, sy - 3, sx + 3.5, sy - 3, INK); p.line(sx - 3.5, sy + 3, sx + 3.5, sy + 3, INK);
        p.line(sx - 3.5, sy - 3, sx - 3.5, sy + 3, INK); p.line(sx + 3.5, sy - 3, sx + 3.5, sy + 3, INK);
        p.polygon([[sx, sy - 2.2], [sx + 1.4, sy + .4], [sx + .6, sy + 1.8], [sx - .6, sy + 1.8], [sx - 1.4, sy + .4]], FLAME, 1, 0.3);
        p.line(sx - 2.6, sy + 2.2, sx + 2.6, sy - 2.2, SIGNAL, .5);
        p.rivet(sx - 2.8, sy - 2.3, STEEL); p.rivet(sx + 2.8, sy - 2.3, STEEL);
      }
    }
  }

  // ---- The Lower Bell gate: a riveted iron frame, bars drawn over each leaf
  // cell that is still over the pit or sliding into its slot, a bell lock on
  // its post, and the way down glowing once the grate has withdrawn.
  {
    const G = WORKS_GATE, cx = G.x, fy = G.floor, p = penAt(cx, fy - 6);
    const A = G.arch;
    if (p.inView(G.pit.x0 - G.slot - 4, A.top - A.beam - 6, G.pit.x1 + G.slot + 8, G.pit.y1 + 4)) {
      const open = worksGateOpen(w);
      for (let x = G.pit.x0 - G.slot; x <= G.pit.x1 + G.slot; x++) {
        if (w.type(x, G.leaves.y0) !== Cell.Metal) continue;
        const inSlot = x < G.pit.x0 || x > G.pit.x1;
        p.line(x, G.leaves.y0 - .5, x + .5, G.leaves.y0 - .5, inSlot ? IRON_D : STEEL, 0, inSlot ? .5 : 1);
        if ((x - G.pit.x0) % 4 === 3) p.line(x + .25, G.leaves.y0 - .5, x + .25, G.leaves.y1 + .5, IRON_D, 0, .9);
      }
      // Frame lips over both slot mouths, rivets along them.
      for (const [x0, x1] of [[G.pit.x0 - 3, G.pit.x0], [G.pit.x1, G.pit.x1 + 3]] as const) {
        p.line(x0, fy - .5, x1, fy - .5, BRASS_D, .5);
        p.rivet(x0 + 1, fy - .2, BRASS);
      }
      // The archway, behind the player: banded iron pillars and a riveted beam.
      const PILLAR: RGB = [0.27, 0.26, 0.26], BEAM: RGB = [0.34, 0.29, 0.22];
      for (const x of [A.x0 + A.pillar / 2, A.x1 - A.pillar / 2 + 1]) {
        p.box(x, (A.top + fy) / 2, A.pillar / 2, (fy - A.top) / 2, 0, PILLAR, INK);
        p.line(x - A.pillar / 2 + .5, A.top, x - A.pillar / 2 + .5, fy - 1, IRON, 0, .8);
        for (let y = A.top + 4; y < fy - 1; y += 7) { p.line(x - 2.5, y, x + 2.5, y, IRON_D, .5); p.rivet(x - 1.5, y - 1, STEEL); p.rivet(x + 1.5, y - 1, STEEL); }
      }
      p.box((A.x0 + A.x1) / 2 + .5, A.top - A.beam / 2, (A.x1 - A.x0) / 2 + 2.5, A.beam / 2, 0, BEAM, INK);
      for (let x = A.x0; x <= A.x1; x += 5) p.rivet(x, A.top - A.beam + 1.5, BRASS);
      p.line(A.x0 - 2, A.top - .5, A.x1 + 2, A.top - .5, BRASS_D, .5);
      // The lock bell hangs from the beam over the grate: dark iron until the
      // brass bell is carried under it, then it rings and swings.
      const bx = G.x, by = A.top;
      p.rod(bx, by, bx, by + 6, IRON_D, .6);
      const ringing = !!ctx.levels.current?.portal?.open;
      const bellTone: RGB = ringing ? BRASS : [0.32, 0.28, 0.22];
      const swing = ringing && !open ? Math.sin(frame * 0.35) * 0.35 : 0;
      const hx = bx, hy = by + 6;
      const at = (dx: number, dy: number): [number, number] => [hx + dx * Math.cos(swing) - dy * Math.sin(swing), hy + dx * Math.sin(swing) + dy * Math.cos(swing)];
      p.polygon([at(-2, 0), at(2, 0), at(3.2, 3), at(4.6, 7), at(-4.6, 7), at(-3.2, 3)], bellTone, 1, 0.35);
      p.line(...at(-5, 7.5), ...at(5, 7.5), ringing ? BRASS_L : IRON_D, .6);
      p.disc(...at(0, 8.6), 0.9, ringing ? BRASS_D : IRON_D, INK);
      if (ringing && !open) p.glow(...at(0, 4), [1, 0.8, 0.4], 0.55 + Math.sin(frame * 0.35) * 0.25);
      if (open) {
        // Warm air rises from the way down.
        for (let k = 0; k < 6; k++) {
          const x = G.pit.x0 + 2 + ((k * 7 + frame * .3) % (G.pit.x1 - G.pit.x0 - 3));
          const y = G.pit.y1 - ((frame * .4 + k * 5) % (G.pit.y1 - fy + 4));
          p.glow(x, y, EMBER, 0.28);
        }
        p.glow(cx, G.pit.y1 - 2, EMBER, 0.55);
      }
    }
  }
}

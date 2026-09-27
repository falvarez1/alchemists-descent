import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { BRASS, BRASS_D, BRASS_L, COPPER, INK, IRON, IRON_D, Pen, STEEL, STEEL_D, STEEL_L, cameraView, type RGB } from '@/render/sprites/FineArt';
import { Cell } from '@/sim/CellType';
import { WORKS_BARRICADE, WORKS_GATE, worksGateOpen } from '@/world/breathingWorks';
import { TEA_FAULTS, teaRubbleCells } from '@/world/teaMachine';

const ENAMEL: RGB = [0.86, 0.82, 0.7];
const SIGNAL: RGB = [0.78, 0.16, 0.1];
const FLAME: RGB = [1.1, 0.62, 0.18];
const EMBER: RGB = [1.15, 0.74, 0.32];

/**
 * The Breathing Works' readable fixtures, drawn at presentation resolution
 * over the real cells they dress: the barricade's straps and its enamel
 * "no naked flames" plate (they fall away with the wood beneath them), the
 * engine's three inspection hatches and service ledges, and the Lower Bell's
 * floor gate, whose bars follow the grid's real sliding leaves.
 */
export function drawWorksFixtures(out: PixelSurface, light: LightField, ctx: Ctx): void {
  const view = cameraView(ctx.camera, 24);
  const penAt = (x: number, y: number): Pen => {
    const s = light.sample(x, y);
    return new Pen(out, view, [Math.min(1.05, Math.max(0.55, s.r)), Math.min(1.05, Math.max(0.55, s.g)), Math.min(1.05, Math.max(0.55, s.b))]);
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

  // ---- Fault I's rubble wedge: an inked outline and a few lit edges on every
  // stone still standing, so the pile reads even behind the pendulum's art.
  {
    const r = TEA_FAULTS.rubble, p = penAt((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
    if (p.inView(r.x0 - 3, r.y0 - 3, r.x1 + 3, r.y1 + 3)) {
      const stone = (x: number, y: number): boolean => w.type(x, y) === Cell.Stone;
      for (const [x, y] of teaRubbleCells()) {
        if (!stone(x, y)) continue;
        if (!stone(x, y - 1)) { p.line(x, y, x + 1, y, INK, 0, .8); if ((x + y) % 2 === 0) p.px(x + .5, y + .5, [0.93, 0.87, 0.72], .9); }
        if (!stone(x - 1, y)) p.line(x, y, x, y + 1, INK, 0, .8);
        if (!stone(x + 1, y)) p.line(x + 1, y, x + 1, y + 1, INK, 0, .8);
        if (!stone(x, y + 1)) p.line(x, y + 1, x + 1, y + 1, INK, 0, .8);
      }
    }
  }

  // ---- Inspection hatches in the catwalk ceiling and the ledges above them.
  // Hinged lids hang open, a short ladder shows the way up, and each station
  // carries a brass plate with its number (I, II, III) in etched strokes.
  const station = (n: number, lx: number, ly: number, lw: number): void => {
    const p = penAt(lx + lw / 2, ly);
    if (!p.inView(lx - 4, ly - 8, lx + lw + 4, ly + 8)) return;
    for (let x = lx; x < lx + lw; x += 3) { p.line(x, ly - .5, x + 1.5, ly - .5, STEEL_L, 0, .8); }
    p.line(lx, ly + 2.5, lx + lw - 1, ly + 2.5, IRON_D, .5);
    for (const x of [lx + 2, lx + lw - 3]) {
      p.rod(x, ly + 3, x - 2, ly + 8, IRON, .75);
      p.rivet(x, ly + 1);
    }
    const px = lx + lw - 9, py = ly - 5;
    p.polygon([[px - 3, py - 2], [px + 3, py - 2], [px + 3, py + 2], [px - 3, py + 2]], BRASS_D, 1, 0.2);
    for (let i = 0; i < n; i++) p.line(px - (n - 1) + i * 2, py - 1.2, px - (n - 1) + i * 2, py + 1.2, BRASS_L, 0, 1.1);
  };
  const hatch = (x: number, width: number): void => {
    const p = penAt(x + width / 2, 262);
    if (!p.inView(x - 6, 250, x + width + 6, 312)) return;
    for (const hx of [x - 1, x + width]) { p.rod(hx, 258, hx, 265, BRASS, 1); p.rivet(hx, 259.5); p.rivet(hx, 263.5); }
    // The lid hangs from its hinge on the left edge, swung down into the corridor.
    p.box(x + 1, 272, 1.1, 7, 0.12, IRON, INK);
    p.rivet(x + 1.5, 267); p.rivet(x + 1.5, 277);
    // A short service ladder hung under the hatch: rails and rungs.
    const lx0 = x + width / 2 - 3, lx1 = x + width / 2 + 3;
    p.rod(lx0, 265, lx0, 290, STEEL_D, .6); p.rod(lx1, 265, lx1, 290, STEEL_D, .6);
    for (let y = 268; y <= 288; y += 5) p.line(lx0, y, lx1, y, STEEL, .5);
    const pulse = 0.35 + Math.sin(frame * 0.07 + x) * 0.12;
    p.glow(x + width / 2, 266, [1, 0.72, 0.32], pulse);
  };
  hatch(TEA_FAULTS.rubble.port.x, TEA_FAULTS.rubble.port.w);
  hatch(TEA_FAULTS.dry.port.x, TEA_FAULTS.dry.port.w);
  station(1, TEA_FAULTS.rubble.ledge.x, TEA_FAULTS.rubble.ledge.y, TEA_FAULTS.rubble.ledge.w);
  station(2, TEA_FAULTS.dry.ledge.x, TEA_FAULTS.dry.ledge.y, TEA_FAULTS.dry.ledge.w);
  station(3, TEA_FAULTS.wire.ledge.x, TEA_FAULTS.wire.ledge.y, TEA_FAULTS.wire.ledge.w);

  // ---- The frayed ends at the wire's missing length: copper whiskers, and
  // an arc on the live stub while it still holds the generator's current.
  {
    const g = TEA_FAULTS.wire, p = penAt(g.x, (g.y0 + g.y1) / 2);
    if (p.inView(g.x - 6, g.y0 - 6, g.x + 6, g.y1 + 6)) {
      const top = w.type(g.x, g.y0 - 1) === Cell.Metal, stub = w.type(g.x, g.y1 + 1) === Cell.Metal;
      if (top) for (const [dx, dy] of [[-1.5, 2], [0, 2.5], [1.5, 1.8]]) p.line(g.x + .5, g.y0 - .5, g.x + .5 + dx, g.y0 + dy, COPPER, 0, .9);
      if (stub) for (const [dx, dy] of [[-1.8, -2], [.4, -2.8], [1.6, -1.6]]) p.line(g.x + .5, g.y1 + 1, g.x + .5 + dx, g.y1 + 1 + dy, COPPER, 0, .9);
      const live = w.charge[w.idx(g.x, g.y1 + 1)];
      if (stub && live > 40 && frame % 4 !== 0) {
        let x: number = g.x + .5, y: number = g.y1;
        for (let k = 0; k < 5; k++) {
          const nx = g.x + .5 + Math.sin(frame * 1.7 + k * 2.3) * 2, ny = y - 1.2;
          p.line(x, y, nx, ny, [0.6, 0.95, 1.1], 0, 1.1); x = nx; y = ny;
        }
        p.glow(g.x + .5, g.y1, [0.4, 0.85, 1], Math.min(1, live / 900) * 0.8);
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

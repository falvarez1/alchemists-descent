import type { Ctx, VineStrandView } from '@/core/types';
import type { LightField, PixelSurface } from './pixels';
import { Cell, isGas, isSoftGrowth } from '@/sim/CellType';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { WORKS_PLANTS, worksPlantRoot } from '@/world/worksHabitat';
import { habitatBend } from '@/game/HabitatMotion';

/** Fronds belong to a living material anchor. Cutting or burning that root
 * removes its crown, and nearby bodies bend it without changing collision. */
export function drawHabitatScenery(out: PixelSurface, light: LightField, ctx: Ctx): void {
  if (!ctx.levels.current?.living) return;
  const { world, camera } = ctx, tick = ctx.state.frameCount;
  const pixelStep = out.pixelStep ?? 1;
  for (let plantIndex = 0; plantIndex < WORKS_PLANTS.length; plantIndex++) {
    const [x, expectedY, size, hanging] = WORKS_PLANTS[plantIndex];
    // Hanging crowns belong to live VineStrands. A fixed-root overlay would
    // hide their sway and remain floating after the physical stem was cut.
    if (hanging) continue;
    if (x < camera.renderX - size || x > camera.renderX + VIEW_W + size || expectedY < camera.renderY - size || expectedY > camera.renderY + VIEW_H + size) continue;
    const y = worksPlantRoot(world, x, expectedY, hanging, true);
    if (y < 0) continue;
    const sample = light.sample(x, y), lr = Math.max(.5, sample.r), lg = Math.max(.5, sample.g), lb = Math.max(.5, sample.b);
    const bend = habitatBend(world, plantIndex);
    const pixel = (px: number, py: number, value: number) => {
      const ix = Math.round(px), iy = Math.round(py);
      if (!world.inBounds(ix, iy)) return;
      const type = world.type(ix, iy);
      if (type !== Cell.Empty && !isSoftGrowth(type) && !isGas(type)) return;
      (out.setFinePx ?? out.setPx).call(out, px, py, (.18 + value * .22) * lr, (.32 + value * .29) * lg, (.25 + value * .19) * lb);
    };
    const line = (ax: number, ay: number, bx: number, by: number, value: number) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / pixelStep));
      for (let i = 0; i <= steps; i++) pixel(ax + (bx - ax) * i / steps, ay + (by - ay) * i / steps, value);
    };
    const leaf = (ax: number, ay: number, bx: number, by: number, value: number) => {
      const length = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / length, ny = (bx - ax) / length;
      const steps = Math.ceil(length / pixelStep);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, width = Math.sin(t * Math.PI) * .85;
        const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
        for (let cross = -width; cross <= width; cross += pixelStep) pixel(px + nx * cross, py + ny * cross, value - Math.max(0, cross) * .12);
      }
    };
    const sign = hanging ? 1 : -1;
    const fronds = hanging ? 4 + x % 2 : 6 + x % 3;
    for (let frond = 0; frond < fronds; frond++) {
      const rank = frond - (fronds - 1) / 2, reach = hanging ? rank * 7 : rank * size * .19;
      const height = size * (1 - Math.abs(rank) * (hanging ? .09 : .12));
      let oldX = x, oldY = y;
      for (let step = 1; step <= 18; step++) {
        const t = step / 18;
        const angle = bend * t, c = Math.cos(angle), s = Math.sin(angle);
        const localX = reach * t, localY = sign * height * (Math.sin(t * Math.PI / 2) - t ** 3 * .26);
        const px = x + localX * c - localY * s;
        const py = y + localX * s + localY * c;
        line(oldX, oldY, px, py, .45 + frond % 3 * .12);
        if (step > 3 && step < 17 && step % 2 === 0) {
          const reach = (hanging ? 5 : 4) * Math.sin(t * Math.PI);
          leaf(px, py, px - reach * c - sign * reach * .8 * s, py - reach * s + sign * reach * .8 * c, .62 + frond % 2 * .15);
          leaf(px, py, px + reach * c - sign * reach * .7 * s, py + reach * s + sign * reach * .7 * c, .3 + frond % 2 * .1);
        }
        oldX = px; oldY = py;
      }
    }
    // Spores drift above the colony, at the simulation clock even while paused.
    if (!hanging && x % 3 === 0) for (let i = 0; i < 3; i++) {
      const phase = ((tick + x * 7 + i * 89) % 300) / 300;
      const sx = Math.round(x + Math.sin(phase * 5 + i) * 17), sy = Math.round(y - 9 - phase * 40);
      if (world.type(sx, sy) === Cell.Empty) out.setPx(sx, sy, .23, .45 + Math.sin(phase * Math.PI) * .13, .35);
    }
  }
}

/** Leaf stems inherit their node's orientation and motion, with no independent
 * root lookup. A severed leaf-bearing section keeps exactly the same foliage. */
export function drawVineFoliage(out: PixelSurface, light: LightField, ctx: Ctx, strand: VineStrandView): void {
  if (!strand.foliage) return;
  const step = out.pixelStep ?? 1, camera = ctx.camera;
  for (let i = 1; i < strand.nodes.length; i++) {
    const node = strand.nodes[i], previous = strand.nodes[i - 1], length = node.leafLength;
    if (!length || node.x < camera.renderX - 14 || node.x > camera.renderX + VIEW_W + 14 || node.y < camera.renderY - 14 || node.y > camera.renderY + VIEW_H + 14) continue;
    const dx = node.x - previous.x, dy = node.y - previous.y, distance = Math.hypot(dx, dy) || 1;
    const tx = dx / distance, ty = dy / distance, nx = -ty, ny = tx;
    const sample = light.sample(node.x, node.y);
    const r = Math.max(.5, sample.r), g = Math.max(.5, sample.g), b = Math.max(.5, sample.b);
    for (const side of [-1, 1]) {
      const count = Math.ceil(length / step);
      for (let k = 0; k <= count; k++) {
        const t = k / count, curl = t * t * length * .5;
        const x = node.x + nx * side * length * t + tx * curl, y = node.y + ny * side * length * t + ty * curl;
        const width = Math.sin(t * Math.PI) * (1.2 + Math.sin(t * 8 * Math.PI) * .3);
        for (let cross = -width; cross <= width; cross += step) {
          const px = x + tx * cross, py = y + ty * cross;
          if (!ctx.world.inBounds(Math.floor(px), Math.floor(py))) continue;
          const cell = ctx.world.type(Math.floor(px), Math.floor(py));
          if (cell !== Cell.Empty && !isSoftGrowth(cell) && !isGas(cell)) continue;
          const vein = Math.abs(cross) < step * .6 ? .14 : 0;
          (out.setFinePx ?? out.setPx).call(out, px, py, (.26 + vein) * r, (.44 + vein - t * .08) * g, (.33 + vein * .5) * b);
        }
      }
    }
  }
}

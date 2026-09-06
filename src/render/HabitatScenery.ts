import type { Ctx, VineStrandView } from '@/core/types';
import type { LightField, PixelSurface } from './pixels';
import { Cell, isGas, isSoftGrowth } from '@/sim/CellType';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { WORKS_PLANTS, worksPlantRoot } from '@/world/worksHabitat';
import { habitatPlant } from '@/game/HabitatMotion';
import { visitFronds } from '@/world/foliageGeometry';

/** Draw the simulation-owned crown, including its char and detached motion. */
export function drawHabitatScenery(out: PixelSurface, light: LightField, ctx: Ctx): void {
  if (!ctx.levels.current?.living) return;
  const { world, camera } = ctx, tick = ctx.state.frameCount;
  const pixelStep = out.pixelStep ?? 1;
  for (let plantIndex = 0; plantIndex < WORKS_PLANTS.length; plantIndex++) {
    const [rootX, expectedY, size, hanging] = WORKS_PLANTS[plantIndex];
    // Hanging crowns belong to live VineStrands. A fixed-root overlay would
    // hide their sway and remain floating after the physical stem was cut.
    if (hanging) continue;
    const plant = habitatPlant(world, plantIndex);
    if (plant?.spent) continue;
    const x = plant?.x ?? rootX, y = plant?.y ?? worksPlantRoot(world, rootX, expectedY, false, true);
    if (x < camera.renderX - size || x > camera.renderX + VIEW_W + size || y < camera.renderY - size || y > camera.renderY + VIEW_H + size) continue;
    if (y < 0) continue;
    const sample = light.sample(x, y), lr = Math.max(.5, sample.r), lg = Math.max(.5, sample.g), lb = Math.max(.5, sample.b);
    const bend = plant?.angle ?? 0, burn = plant?.burn ?? 0;
    const pixel = (px: number, py: number, value: number) => {
      const ix = Math.round(px), iy = Math.round(py);
      if (!world.inBounds(ix, iy)) return;
      const type = world.type(ix, iy);
      if (type === Cell.Fire || (type !== Cell.Empty && !isSoftGrowth(type) && !isGas(type) && type !== Cell.Water && type !== Cell.Blood)) return;
      const char = Math.min(1, burn * 1.7), wet = type === Cell.Water || type === Cell.Blood ? .65 : 1;
      (out.setFinePx ?? out.setPx).call(out, px, py,
        ((.18 + value * .22) * (1 - char) + .16 * char) * lr * wet,
        ((.32 + value * .29) * (1 - char) + .12 * char) * lg * wet,
        ((.25 + value * .19) * (1 - char) + .075 * char) * lb * wet);
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
    visitFronds(x, y, size, rootX, bend, plant?.rotation ?? 0, (ax, ay, bx, by, value, isLeaf, frond, along) => {
      if (isLeaf ? along > 1 - burn * (.8 + frond % 3 * .08) : along > 1 - burn * .6) return;
      (isLeaf ? leaf : line)(ax, ay, bx, by, value);
    });
    // Spores drift above the colony, at the simulation clock even while paused.
    if (!plant?.detached && burn === 0 && rootX % 3 === 0) for (let i = 0; i < 3; i++) {
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
    const node = strand.nodes[i], previous = strand.nodes[i - 1], burn = node.burn ?? 0, length = (node.leafLength ?? 0) * (1 - burn);
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
          if (cell === Cell.Fire || (cell !== Cell.Empty && !isSoftGrowth(cell) && !isGas(cell))) continue;
          const vein = Math.abs(cross) < step * .6 ? .14 : 0;
          const char = Math.min(1, burn * 1.6);
          (out.setFinePx ?? out.setPx).call(out, px, py, ((.26 + vein) * (1 - char) + .16 * char) * r,
            ((.44 + vein - t * .08) * (1 - char) + .12 * char) * g, ((.33 + vein * .5) * (1 - char) + .075 * char) * b);
        }
      }
    }
  }
}

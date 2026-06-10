import type { Ctx, SimulationApi } from '@/core/types';
import { Cell, isSolid } from '@/sim/CellType';
import { EMPTY_COLOR } from '@/sim/colors';
import { stainCell } from '@/sim/stains';
import { handleGas } from '@/sim/elements/gas';
import {
  handleAcid,
  handleLava,
  handleNitrogen,
  handleOil,
  handleViscousLiquid,
  handleWater,
} from '@/sim/elements/liquids';
import {
  handleAsh,
  handleCoal,
  handleExoticLiquid,
  handleFungus,
  handleSnow,
} from '@/sim/elements/newMaterials';
import { handleGunpowder, handleSand } from '@/sim/elements/powders';
import { handleEmber, handleFire, handleIce } from '@/sim/elements/thermal';
import { handleVines } from '@/sim/elements/vines';
import { updateElectricalGrid } from '@/sim/electrical';
import { runHarvesterField } from '@/sim/harvester';

/* ===================== Core Simulation Frame ===================== */
export class Simulation implements SimulationApi {
  accumulator = 0;

  /** Fixed-step accumulator: runs 0-6 processFrame substeps per render frame. */
  update(ctx: Ctx): void {
    this.accumulator += ctx.params.global.simSpeed;
    let safetyLimit = 0;
    while (this.accumulator >= 1.0 && safetyLimit < 6) {
      this.processFrame(ctx);
      this.accumulator -= 1.0;
      safetyLimit++;
    }
  }

  processFrame(ctx: Ctx): void {
    const world = ctx.world;
    const sim = world.simBounds;

    runHarvesterField(ctx);
    updateElectricalGrid(ctx);
    ctx.projectileCtl.update(ctx);

    for (let i = ctx.shockwaves.length - 1; i >= 0; i--) {
      const w = ctx.shockwaves[i];
      w.currentRadius += w.speed;
      if (w.currentRadius >= w.maxRadius) ctx.shockwaves.splice(i, 1);
    }

    for (let x = sim.x0; x < sim.x1; x++) {
      for (let y = sim.y0; y < sim.y1; y++) {
        world.moved[x + y * world.width] = 0;
      }
    }

    const spanW = sim.x1 - sim.x0;
    for (let y = sim.y1 - 1; y >= sim.y0; y--) {
      const leftToRight = Math.random() < 0.5;
      for (let i = 0; i < spanW; i++) {
        const x = leftToRight ? sim.x0 + i : sim.x1 - 1 - i;
        const ci = x + y * world.width;
        if (world.moved[ci]) continue;

        const type = world.types[ci] as Cell;
        if (
          type === Cell.Empty ||
          type === Cell.Wall ||
          type === Cell.Wood ||
          type === Cell.Stone ||
          type === Cell.Metal ||
          type === Cell.Ice ||
          type === Cell.Vines ||
          type === Cell.Crystal ||
          type === Cell.Glass ||
          type === Cell.Fungus ||
          type === Cell.Glowshroom
        )
          continue;

        if (type === Cell.Sand || type === Cell.Gold) handleSand(ctx, x, y, type);
        else if (type === Cell.Water) handleWater(ctx, x, y);
        else if (type === Cell.Fire) handleFire(ctx, x, y);
        else if (type === Cell.Ember) handleEmber(ctx, x, y);
        else if (type === Cell.Oil) handleOil(ctx, x, y);
        else if (type === Cell.Acid) handleAcid(ctx, x, y);
        else if (type === Cell.Gunpowder) handleGunpowder(ctx, x, y);
        else if (type === Cell.Lava) handleLava(ctx, x, y);
        else if (type === Cell.Nitrogen) handleNitrogen(ctx, x, y);
        else if (type === Cell.Snow) handleSnow(ctx, x, y);
        else if (type === Cell.Coal) handleCoal(ctx, x, y);
        else if (type === Cell.Ash) handleAsh(ctx, x, y);
        else if (type === Cell.Toxic || type === Cell.Healium || type === Cell.Teleportium)
          handleExoticLiquid(ctx, x, y, type);
        else if (
          type === Cell.Blood ||
          type === Cell.Slime ||
          type === Cell.ElixirLife ||
          type === Cell.ElixirLevity ||
          type === Cell.ElixirStone
        ) {
          if (type === Cell.Blood) {
            // wet blood stains adjacent rock and timber, and slowly soaks in
            if (Math.random() < 0.10) {
              stainCell(world, x, y + 1, 118, 14, 20, 0.22);
              if (Math.random() < 0.5)
                stainCell(world, x + (Math.random() < 0.5 ? 1 : -1), y, 118, 14, 20, 0.16);
            }
            if (
              Math.random() < 0.004 &&
              world.inBounds(x, y + 1) &&
              isSolid(world.types[world.idx(x, y + 1)])
            ) {
              stainCell(world, x, y + 1, 110, 12, 18, 0.5);
              world.types[ci] = Cell.Empty;
              world.colors[ci] = EMPTY_COLOR;
              continue;
            }
          }
          handleViscousLiquid(ctx, x, y, type);
        } else if (type === Cell.Steam)
          handleGas(ctx, x, y, Cell.Steam, ctx.params.materials[Cell.Water].flowRate!, 0.3);
        else if (type === Cell.Smoke)
          handleGas(
            ctx,
            x,
            y,
            Cell.Smoke,
            ctx.params.materials[Cell.Smoke].floatSpeed!,
            ctx.params.materials[Cell.Smoke].dispersion!,
          );
      }
    }

    for (let y = sim.y1 - 1; y >= sim.y0; y--) {
      for (let x = sim.x0; x < sim.x1; x++) {
        const ci = x + y * world.width;
        if (world.types[ci] === Cell.Ice && !world.moved[ci]) handleIce(ctx, x, y);
        if (world.types[ci] === Cell.Vines && !world.moved[ci]) handleVines(ctx, x, y);
        if (world.types[ci] === Cell.Fungus && !world.moved[ci]) handleFungus(ctx, x, y);
      }
    }
  }
}

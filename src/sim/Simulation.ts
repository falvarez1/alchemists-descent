import type { Ctx, SimulationApi } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { canDryBloodOnSurface, stainCell } from '@/sim/stains';
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
  handleMoss,
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
    // Clamp the carry after the 6-substep cap: an overdriven simSpeed could
    // otherwise let the backlog grow unbounded and pin the sim at 6 substeps
    // forever. Drop the un-spent overflow so normal speeds (carry < 1) are
    // unchanged but the sim can never run away.
    if (this.accumulator > 1.0) this.accumulator = 1.0;
  }

  processFrame(ctx: Ctx): void {
    const world = ctx.world;
    const sim = world.simBounds;

    // New substep = new moved-epoch (see World.movedTick). The old code
    // zeroed every window cell here, column-major, every substep.
    world.movedTick++;
    if (world.movedTick > 255) {
      world.moved.fill(0);
      world.movedTick = 1;
    }

    runHarvesterField(ctx);
    updateElectricalGrid(ctx);
    ctx.projectileCtl.update(ctx);

    for (let i = ctx.shockwaves.length - 1; i >= 0; i--) {
      const w = ctx.shockwaves[i];
      w.currentRadius += w.speed;
      if (w.currentRadius >= w.maxRadius) ctx.shockwaves.splice(i, 1);
    }

    // Hoisted for the hot loop: handlers run inside it, so V8 cannot prove
    // these fields stable and would reload them per cell otherwise.
    const movedArr = world.moved;
    const tick = world.movedTick;

    const spanW = sim.x1 - sim.x0;
    let runSparsePass = false;
    for (let y = sim.y1 - 1; y >= sim.y0; y--) {
      const leftToRight = Math.random() < 0.5;
      for (let i = 0; i < spanW; i++) {
        const x = leftToRight ? sim.x0 + i : sim.x1 - 1 - i;
        const ci = x + y * world.width;
        if (movedArr[ci] === tick) continue;

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
          type === Cell.Glowshroom ||
          type === Cell.Moss ||
          type === Cell.RawOre
        ) {
          if (type === Cell.Ice || type === Cell.Vines || type === Cell.Fungus || type === Cell.Moss) {
            runSparsePass = true;
          }
          continue;
        }

        if (type === Cell.Sand || type === Cell.Gold || type === Cell.Catalyst)
          handleSand(ctx, x, y, type);
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
              canDryBloodOnSurface(world, x, y + 1)
            ) {
              stainCell(world, x, y + 1, 110, 12, 18, 0.5);
              world.clearCellAt(ci);
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

    if (runSparsePass) {
      for (let y = sim.y1 - 1; y >= sim.y0; y--) {
        for (let x = sim.x0; x < sim.x1; x++) {
          const ci = x + y * world.width;
          // Type check FIRST: these materials are sparse, so the moved-epoch
          // load short-circuits away for almost every cell.
          const t2 = world.types[ci];
          if (t2 === Cell.Ice && movedArr[ci] !== tick) handleIce(ctx, x, y);
          else if (t2 === Cell.Vines && movedArr[ci] !== tick) handleVines(ctx, x, y);
          else if (t2 === Cell.Fungus && movedArr[ci] !== tick) handleFungus(ctx, x, y);
          else if (t2 === Cell.Moss && movedArr[ci] !== tick) handleMoss(ctx, x, y);
        }
      }
    }
  }
}

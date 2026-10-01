import type { Ctx, SimulationApi } from '@/core/types';
import { Cell, isElixir, isLiquid } from '@/sim/CellType';
import { canDryBloodOnSurface, stainCell } from '@/sim/stains';
import { handleGas, handleMarshGas } from '@/sim/elements/gas';
import { maybeReact, refreshSecretReaction } from '@/sim/reactions';
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
  handleGrass,
  handleMoss,
  handleSnow,
} from '@/sim/elements/newMaterials';
import { handleGunpowder, handleSand } from '@/sim/elements/powders';
import { handleEmber, handleFire, handleIce } from '@/sim/elements/thermal';
import { handleVines } from '@/sim/elements/vines';
import { handleLeaf, handleSeed, handleTrunk } from '@/sim/elements/flora';
import { handleBrine } from '@/sim/elements/brine';
import { updateElectricalGrid } from '@/sim/electrical';
import { runHarvesterField } from '@/sim/harvester';
import { reseedSimChunk, reseedSimSubstep, simRandom } from '@/core/simRandom';
import type { World } from '@/sim/World';

/** Stream key the growth pass reseeds with after a parallel sweep (sim/parallel/protocol). */
const GROWTH_STREAM_KEY = 0x7ff1;

/**
 * A multithreaded replacement for the material sweep (the prototype sandbox:
 * sim/parallel/ParallelSim). Everything before and after the sweep stays
 * here and serial; `handles` gates it to the one shared world it owns.
 */
export interface ParallelSweep {
  handles(world: World): boolean;
  /** Stands in for world.activity.beginStep. */
  activityStep(ctx: Ctx, interest: { x0: number; y0: number; x1: number; y1: number } | undefined, tick: number): void;
  sweep(ctx: Ctx, substep: number): void;
}

/* ===================== Core Simulation Frame ===================== */
export class Simulation implements SimulationApi {
  accumulator = 0;
  /** Optional parallel sweep (docs/SANDBOX-MT.md); null = always serial. */
  parallel: ParallelSweep | null = null;
  private readonly sparseGrowthCells: number[] = [];
  /** Substep index within the current tick, for the per-substep reseed below.
   *  Derived from `frameCount` rather than from `update`'s loop counter so a
   *  direct `processFrame` call (settle passes, probes) seeds itself too. */
  private lastSeededTick = -1;
  private substep = 0;

  /** Fixed-step accumulator: runs 0-6 processFrame substeps per render frame. */
  update(ctx: Ctx): void {
    // the run's SECRET world reaction re-derives from the seed (one integer
    // compare when nothing changed — covers new runs, resumes, playtests)
    refreshSecretReaction(ctx);
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

    // Every substep gets its own stream. A divergence inside one substep then
    // cannot offset the next one, which is what lets a failing golden frame
    // name a tick instead of condemning the whole run.
    const gameTick = ctx.state.frameCount;
    if (gameTick !== this.lastSeededTick) {
      this.lastSeededTick = gameTick;
      this.substep = 0;
    }
    const substep = this.substep++;
    reseedSimSubstep(ctx.state.worldSeed, gameTick, substep);

    // New substep = new moved-epoch (see World.movedTick). The old code
    // zeroed every window cell here, column-major, every substep.
    world.movedTick++;
    if (world.movedTick > 255) {
      world.moved.fill(0);
      world.movedTick = 1;
    }

    world.flow.beginStep(world);
    runHarvesterField(ctx);
    updateElectricalGrid(ctx);
    ctx.projectileCtl.update(ctx);
    const parallel = this.parallel !== null && this.parallel.handles(world) ? this.parallel : null;
    const interest = ctx.state.mode === 'play' ? world.simBounds : undefined;
    if (parallel !== null) parallel.activityStep(ctx, interest, gameTick);
    else world.activity.beginStep(world, interest, gameTick);
    const sim = world.activity.bounds;

    for (let i = ctx.shockwaves.length - 1; i >= 0; i--) {
      const w = ctx.shockwaves[i];
      w.currentRadius += w.speed;
      if (w.currentRadius >= w.maxRadius) ctx.shockwaves.splice(i, 1);
    }

    if (parallel !== null) {
      parallel.sweep(ctx, substep);
      // the sweep left the sim stream wherever its last chunk did; growth
      // draws from its own so the result is independent of thread count
      reseedSimChunk(ctx.state.worldSeed | 0, gameTick, substep, GROWTH_STREAM_KEY);
      this.sparseGrowthCells.length = 0;
      this.growthPass(ctx, world);
      return;
    }

    // Hoisted for the hot loop: handlers run inside it, so V8 cannot prove
    // these fields stable and would reload them per cell otherwise.
    const movedArr = world.moved;
    const tick = world.movedTick;

    const firstWord = sim.x0 >> 5, endWord = Math.ceil(sim.x1 / 32);
    const masks = world.activity.rowMasks, wordsPerRow = world.activity.wordsPerRow;
    const sparseGrowthCells = this.sparseGrowthCells;
    sparseGrowthCells.length = 0;
    for (let y = sim.y1 - 1; y >= sim.y0; y--) {
      const leftToRight = simRandom() < 0.5;
      for (let wordOffset = 0; wordOffset < endWord - firstWord; wordOffset++) {
        const word = leftToRight ? firstWord + wordOffset : endWord - 1 - wordOffset;
        if (!world.activity.scheduled[(word >> 1) + (y >> 6) * world.activity.columns]) continue;
        let mask = masks[y * wordsPerRow + word];
        while (mask !== 0) {
          const bit = leftToRight ? 31 - Math.clz32(mask & -mask) : 31 - Math.clz32(mask);
          mask &= ~(1 << bit);
          const x = word * 32 + bit;
          const ci = x + y * world.width;
          if (movedArr[ci] === tick || !world.activity.eligible[ci]) continue;

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
            type === Cell.RawOre ||
            type === Cell.Grass ||
            type === Cell.Leaf ||
            type === Cell.Trunk ||
            type === Cell.Mirror
          ) {
            continue;
          }

          // THE ALCHEMY TABLE: liquids consult the data-driven pair reactions
          // first — a listed pair (acid+lava -> glass, blood+catalyst ->
          // healium...) wins over the cell's generic handler for this substep.
          if (isLiquid(type) && maybeReact(ctx, x, y, type)) continue;

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
            isElixir(type)
          ) {
            if (type === Cell.Blood) {
              // wet blood stains adjacent rock and timber, and slowly soaks in
              if (simRandom() < 0.10) {
                stainCell(world, x, y + 1, 118, 14, 20, 0.22);
                if (simRandom() < 0.5)
                  stainCell(world, x + (simRandom() < 0.5 ? 1 : -1), y, 118, 14, 20, 0.16);
              }
              if (
                simRandom() < 0.004 &&
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
          else if (type === Cell.MarshGas) handleMarshGas(ctx, x, y);
          else if (type === Cell.Seed) handleSeed(ctx, x, y);
          else if (type === Cell.Brine) handleBrine(ctx, x, y);
        }
      }
    }

    this.growthPass(ctx, world);
  }

  /** The sparse growth pass (ice, vines, fungus, moss, grass, leaf, trunk) after the sweep. */
  private growthPass(ctx: Ctx, world: World): void {
    const movedArr = world.moved;
    const tick = world.movedTick;
    const sparseGrowthCells = this.sparseGrowthCells;
    for (let key = 0; key < world.activity.growthCells.length; key++) {
      if (world.activity.growthScheduled[key]) for (const ci of world.activity.growthCells[key]) sparseGrowthCells.push(ci);
    }
    if (sparseGrowthCells.length > 0) {
      for (const ci of sparseGrowthCells) {
        if (movedArr[ci] === tick) continue;
        const t2 = world.types[ci];
        const y = Math.floor(ci / world.width);
        const x = ci - y * world.width;
        // Mature growth has no time-driven work. Only a changed contact halo
        // needs its support checked; live growth and ice still advance globally.
        if (world.life[ci] < 0 && t2 !== Cell.Ice &&
            !world.activity.growthChanged[(x >> 6) + (y >> 6) * world.activity.columns] &&
            !world.activity.dirty[(x >> 6) + (y >> 6) * world.activity.columns]) continue;
        if (t2 === Cell.Ice) handleIce(ctx, x, y);
        else if (t2 === Cell.Vines) handleVines(ctx, x, y);
        else if (t2 === Cell.Fungus) handleFungus(ctx, x, y);
        else if (t2 === Cell.Moss) handleMoss(ctx, x, y);
        else if (t2 === Cell.Grass) handleGrass(ctx, x, y);
        else if (t2 === Cell.Leaf) handleLeaf(ctx, x, y);
        else if (t2 === Cell.Trunk) handleTrunk(ctx, x, y);
      }
    }
    for (let key = 0; key < world.activity.growthChanged.length; key++) {
      if (world.activity.growthScheduled[key]) world.activity.growthChanged[key] = 0;
    }
  }
}

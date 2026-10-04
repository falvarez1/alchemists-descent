import { STOCK_STAGE, slabArt, slabRuns, type StockSlab, type StockStageDef } from '@/config/stockStage';
import { stageArtImage, type StageArtImage } from '@/content/arena/stageArtImages';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';

const RIM = packRGB(225, 155, 78), BODY = packRGB(60, 69, 77);

/**
 * A lantern's glass cell colour: the glass's own hue (teal when the art names none), its brightest channel held to 70.
 * Glowshroom is emissive (bloomWeight 0.4: x1.6, self-glow, a breath on green), so the cell composes at ~2.4x its colour
 * by its own lamp; 70 lands it near 0.8, under the 0.85 bloom threshold. The glass reads through the lantern art drawn
 * over it; its LIGHT is seeded separately in the same hue (render/Lighting seedStockLamps).
 */
const GLASS_MAX = 70;
function glassColor(c: readonly [number, number, number] | null): number {
  const [r, g, b] = c ?? [101, 202, 197], k = GLASS_MAX / Math.max(1, r, g, b);
  return packRGB(Math.round(r * k), Math.round(g * k), Math.round(b * k));
}

/** The baked colour of a slab cell, or the plain slab colours while (or if) the art is not loaded. */
function cellColor(slab: StockSlab, img: StageArtImage | null, x: number, y: number): number {
  if (!img) return y < slab.y + 2 ? RIM : BODY;
  const art = slabArt(slab)!;
  const ax = slab.mirror ? art.width - 1 - (x - slab.x0) : x - slab.x0, o = (ax + (y - slab.y) * img.width) * 4;
  return packRGB(img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]);
}

const artPath = (slab: StockSlab): string | null => slab.art ? `${slab.art}.png` : null;

/** Stamp the selected stage's stable competitive geometry. Decorative colour never changes collision. */
export function stampStockStage(ctx: Ctx): void {
  const w = ctx.world, stage = ctx.arena?.stockStage ?? STOCK_STAGE;
  for (const slab of [stage.main, ...stage.platforms]) {
    const path = artPath(slab);
    // The art may still be on its way: stamp now (collision never waits), recolour the surviving cells when it lands.
    const img = path ? stageArtImage(path, () => recolor(ctx, stage, slab)) : null;
    for (let y = slab.y; y < slab.y + slab.depth; y++) {
      const runs = slabRuns(slab, y);
      for (let k = 0; k < runs.length; k += 2) for (let x = runs[k]; x <= runs[k + 1]; x++) {
        const i = w.idx(x, y);
        w.replaceCellAt(i, Cell.Metal, cellColor(slab, img, x, y));
        // Baked art is authored colour: the terrain dressing must not repaint it as generic plate.
        if (slab.art) w.colorOverrides.add(i);
      }
    }
    // Hanging lantern glass: real light in the glass's own colour (render/Lighting reads it while the lantern's hull
    // stands), soft growth (bodies pass through), so a lantern never becomes a ledge.
    const art = slabArt(slab);
    const glass = glassColor(art?.glassColor ?? null);
    if (art) for (const [gx, gy] of art.glass) {
      const x = slab.mirror ? slab.x0 + art.width - 1 - gx : slab.x0 + gx, y = slab.y + gy;
      if (w.inBounds(x, y) && w.type(x, y) === Cell.Empty) { const i = w.idx(x, y); w.replaceCellAt(i, Cell.Glowshroom, glass); w.colorOverrides.add(i); }
    }
  }
  for (const lamp of stage.lamps) {
    for (let y = lamp.y - 4; y <= lamp.y + 6; y++) for (let x = lamp.x - 3; x <= lamp.x + 3; x++) {
      const glass = x > lamp.x - 2 && x < lamp.x + 2 && y >= lamp.y && y <= lamp.y + 3;
      const shell = x === lamp.x - 3 || x === lamp.x + 3 || y === lamp.y - 1 || y === lamp.y + 5;
      if (glass || shell) w.replaceCellAt(w.idx(x, y), glass ? Cell.Glowshroom : Cell.Metal, glass ? glassColor(null) : packRGB(65, 83, 90));
    }
  }
  ctx.arena?.setSpawns(stage.spawns);
  ctx.camera.snapTo(stage.center.x, stage.center.y);
}

/** The art arrived after the stamp: give the slab's still-standing Metal its baked colours (destroyed cells stay gone). */
function recolor(ctx: Ctx, stage: StockStageDef, slab: StockSlab): void {
  if (ctx.arena?.stockStage?.id !== stage.id || !ctx.arena.stockMatch) return;
  const path = artPath(slab), img = path ? stageArtImage(path) : null;
  if (!img) return;
  const w = ctx.world;
  for (let y = slab.y; y < slab.y + slab.depth; y++) {
    const runs = slabRuns(slab, y);
    for (let k = 0; k < runs.length; k += 2) for (let x = runs[k]; x <= runs[k + 1]; x++) {
      const i = w.idx(x, y);
      if (w.types[i] === Cell.Metal) { w.colors[i] = cellColor(slab, img, x, y); w.colorOverrides.add(i); }
    }
  }
}

/** Fetch every slab image of a stage ahead of its first stamp (the lobby calls this when a stage is chosen). */
export function preloadStockStageArt(stage: StockStageDef): void {
  for (const slab of [stage.main, ...stage.platforms]) {
    const path = artPath(slab);
    if (path) stageArtImage(path);
    const art = slabArt(slab);
    if (art?.decor) stageArtImage(`${slab.art!.split('/')[0]}/${art.decor.file}`);
  }
}

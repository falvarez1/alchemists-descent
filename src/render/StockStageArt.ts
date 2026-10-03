import { STOCK_STAGE } from '@/config/stockStage';
import type { Ctx } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';
import { Cell } from '@/sim/CellType';

interface ArtPixel { x: number; y: number; r: number; g: number; b: number; type: Cell }
let artwork: ArtPixel[] | undefined;

/** Copper seams and rivets read the actual surviving Metal cells. Never invent terrain. */
export function drawStockStageArt(out: PixelSurface, ctx: Ctx): void {
  if (!ctx.arena?.stockMatch || ctx.levels.current?.def.id !== 'fighter-duel') return;
  artwork ??= buildArtwork();
  for (const p of artwork) {
    if (ctx.world.type(p.x, p.y) === p.type) out.setPx(p.x, p.y, p.r, p.g, p.b);
  }
}

/** Bake invariant material detail once; only the surviving-cell mask is sampled each frame. */
function buildArtwork(): ArtPixel[] {
  const pixels: ArtPixel[] = [];
  const out = { setPx(x: number, y: number, r: number, g: number, b: number): void {
    pixels.push({ x, y, r, g, b, type: Cell.Metal });
  } };
  for (const slab of [STOCK_STAGE.main, ...STOCK_STAGE.platforms]) {
    // Paint the collision rim last so a wide camera never loses its thin highlight to downsampling.
    for (let y = slab.y + slab.depth - 1; y >= slab.y; y--) for (let x = slab.x0; x <= slab.x1; x++) {
      const dy = y - slab.y, dx = x - slab.x0;
      const inset = dy > 8 ? Math.floor((dy - 8) * 1.7) : 0;
      if (x < slab.x0 + inset || x > slab.x1 - inset) continue;
      const seam = dx % 30 === 0 || dy === 7 || dy % 18 === 17;
      const rivet = dx % 30 === 4 && (dy === 4 || dy % 18 === 13);
      const grain = ((x * 13 ^ y * 7) & 3) * .004;
      let r = .13 + grain, g = .16 + grain, b = .19 + grain;
      if (seam) { r = .11; g = .13; b = .16; }
      if (dy === 0) { r = .96; g = .70; b = .35; }
      if (dy === 1 || dy === 2) { r = .62; g = .35; b = .16; }
      if (rivet) { r = .77; g = .55; b = .30; }
      // Worn bevels, copper corner brackets, and a diagonal brace in every plate.
      if (dy > 8 && (dx % 30 === (dy - 8) % 18 || 29 - dx % 30 === (dy - 8) % 18)) { r = .28; g = .25; b = .20; }
      if ((dx % 30 < 3 || dx % 30 > 27) && (dy === 3 || dy === 6)) { r = .56; g = .36; b = .20; }
      if (dy === 3 && dx % 30 > 4 && dx % 30 < 25) { r = .34; g = .31; b = .25; }
      if (dy > 8 && (dx % 60 < 4 || dx % 60 > 55)) { r = .34; g = .25; b = .16; }
      const nextInset = Math.floor((dy - 7) * 1.7);
      if (dy > 8 && (dy === slab.depth - 1 || x < slab.x0 + nextInset || x > slab.x1 - nextInset)) { r = .43; g = .31; b = .18; }
      out.setPx(x, y, r, g, b);
    }
  }
  for (const lamp of STOCK_STAGE.lamps) {
    for (let y = lamp.y - 4; y <= lamp.y + 6; y++) for (let x = lamp.x - 3; x <= lamp.x + 3; x++) {
      pixels.push({ x, y, r: .35, g: .94, b: .89, type: Cell.Glowshroom });
      out.setPx(x, y, .22, .34, .36);
    }
  }
  // A riveted copper housing, toothed gear, and flask cutout on the real central body.
  const emblemY = STOCK_STAGE.main.y + 33, emblemX = STOCK_STAGE.center.x;
  for (let y = emblemY - 27; y <= emblemY + 27; y++) for (let x = emblemX - 27; x <= emblemX + 27; x++) {
    const dx = x - emblemX, dy = y - emblemY, radius = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const bevel = dx + dy < 0 ? 1 : .64;
    if (radius < 26) out.setPx(x, y, .095, .115, .13);
    if (radius > 23 && radius < 26) out.setPx(x, y, .64 * bevel, .44 * bevel, .26 * bevel);
    if (radius > 15 && radius < (Math.cos(angle * 12) > 0 ? 21 : 18)) out.setPx(x, y, .68 * bevel, .47 * bevel, .25 * bevel);
    const flask = (Math.abs(dx) <= 2 && dy >= -12 && dy <= 1)
      || (dy >= -2 && dy <= 13 && Math.abs(dx) <= (dy + 4) * .48);
    if (flask || (Math.abs(dx) <= 4 && dy >= -13 && dy <= -11)) out.setPx(x, y, .78, .54, .28);
    if (dy > 5 && dy < 11 && Math.abs(dx) < (dy - 2) * .48) out.setPx(x, y, .21, .25, .26);
    if (radius > 23.5 && radius < 24.7 && Math.abs(Math.sin(angle * 4)) < .10) out.setPx(x, y, .89, .69, .41);
  }
  return pixels;
}

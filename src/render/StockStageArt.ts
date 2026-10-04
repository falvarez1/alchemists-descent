import { STOCK_STAGE, slabArt, slabRow, type StockSlab, type StockStageDef } from '@/config/stockStage';
import { stageArtImage, type StageArtImage } from '@/content/arena/stageArtImages';
import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { cameraView } from '@/render/sprites/FineArt';
import { Cell } from '@/sim/CellType';

interface ArtPixel { x: number; y: number; r: number; g: number; b: number; type: Cell }
const artworks = new Map<string, ArtPixel[]>();

/**
 * Stage art over the real cells. A baked slab's colours already live in its cells (world/stockStage); here only its
 * hangings are drawn (chains, lantern housings), each while the hull cell it hangs from survives. Slabs without baked
 * art keep the procedural copper seams and rivets, which read the surviving Metal cells. Never invent terrain.
 */
export function drawStockStageArt(out: PixelSurface, ctx: Ctx, light?: LightField): void {
  if (!ctx.arena?.stockMatch || ctx.levels.current?.def.id !== 'fighter-duel') return;
  const stage = ctx.arena.stockStage ?? STOCK_STAGE;
  let artwork = artworks.get(stage.id);
  if (!artwork) { artwork = buildArtwork(stage); artworks.set(stage.id, artwork); }
  for (const p of artwork) {
    if (ctx.world.type(p.x, p.y) === p.type) out.setPx(p.x, p.y, p.r, p.g, p.b);
  }
  for (const slab of [stage.main, ...stage.platforms]) if (slab.art) { drawFace(out, ctx, slab, light); drawHangings(out, ctx, slab); }
}

/** A baked hull face at presentation resolution (and its mirror), alpha 0/1. */
interface Face { w: number; h: number; rgb: Float32Array; a: Float32Array; rgbM: Float32Array; aM: Float32Array }
const faces = new Map<string, Face | null>();
let faceRgb = new Float32Array(3 * 2048);

function faceFor(slab: StockSlab): Face | null {
  const key = slab.art!, art = slabArt(slab);
  if (!art?.fine) return null;
  const cached = faces.get(key);
  if (cached !== undefined) return cached;
  const img = stageArtImage(`${key.split('/')[0]}/${art.fine}`);
  if (!img) return null;
  const { width: w, height: h, pixels } = img;
  const rgb = new Float32Array(w * h * 3), a = new Float32Array(w * h), rgbM = new Float32Array(w * h * 3), aM = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (x + y * w) * 4, k = x + y * w, m = (w - 1 - x) + y * w;
    const al = pixels[s + 3] >= 128 ? 1 : 0;
    a[k] = al; aM[m] = al;
    for (let c = 0; c < 3; c++) { rgb[k * 3 + c] = pixels[s + c] / 255; rgbM[m * 3 + c] = pixels[s + c] / 255; }
  }
  const face = { w, h, rgb, a, rgbM, aM };
  faces.set(key, face);
  return face;
}

/**
 * Close framings draw a baked slab's face at presentation resolution over its cells, so the stage has the fighters' pixel
 * density (the concept's single pixel grid) instead of 2x2 cell blocks. Only surviving stage Metal is drawn, run by run,
 * lit by the scene light like the cells beneath; cell-resolution surfaces (expanded wide shots) keep the cell colours.
 */
function drawFace(out: PixelSurface, ctx: Ctx, slab: StockSlab, light?: LightField): void {
  if (!out.blitFine || (out.pixelStep ?? 1) >= 1) return;
  const face = faceFor(slab);
  if (!face) return;
  const v = cameraView(ctx.camera, 2), w = ctx.world, types = w.types;
  const y0 = Math.max(slab.y, Math.floor(v.y0)), y1 = Math.min(slab.y + slab.depth - 1, Math.ceil(v.y1));
  const xa = Math.max(slab.x0, Math.floor(v.x0)), xb = Math.min(slab.x1, Math.ceil(v.x1));
  if (y0 > y1 || xa > xb) return;
  const rgb = slab.mirror ? face.rgbM : face.rgb, alpha = slab.mirror ? face.aM : face.a;
  const sample = typeof light?.sample === 'function' ? light.sample.bind(light) : null;
  for (let y = y0; y <= y1; y++) {
    const row = y * w.width;
    let x = xa;
    while (x <= xb) {
      while (x <= xb && types[row + x] !== Cell.Metal) x++;
      if (x > xb) break;
      const start = x;
      while (x <= xb && types[row + x] === Cell.Metal) x++;
      const n = (x - start) * 2, fx0 = (start - slab.x0) * 2;
      if (faceRgb.length < n * 3) faceRgb = new Float32Array(n * 3);
      for (let r = 0; r < 2; r++) {
        const fy = (y - slab.y) * 2 + r, base = fy * face.w + fx0;
        let lr = 1, lg = 1, lb = 1;
        for (let i = 0; i < n; i++) {
          // One light sample per cell (the cells beneath are lit at that grain), shared by its two pixels.
          if (sample && (i & 1) === 0) { const l = sample(start + (i >> 1), y); lr = l.r; lg = l.g; lb = l.b; }
          const k = (base + i) * 3, o = i * 3;
          faceRgb[o] = rgb[k] * lr; faceRgb[o + 1] = rgb[k + 1] * lg; faceRgb[o + 2] = rgb[k + 2] * lb;
        }
        out.blitFine(slab.x0 + fx0 * 0.5, slab.y + fy * 0.5, n, 1, faceRgb.subarray(0, n * 3), alpha.subarray(base, base + n), null);
      }
    }
  }
}

/** One hanging: its pixels (fine, slab-relative, unmirrored) and the hull cell it hangs from. */
interface Hanging { fx: number[]; fy: number[]; rgb: number[]; anchorX: number; anchorY: number }
const hangings = new Map<string, Hanging[] | null>();

function hangingsFor(slab: StockSlab): Hanging[] | null {
  const key = slab.art!, art = slabArt(slab);
  if (!art?.decor) return null;
  const cached = hangings.get(key);
  if (cached !== undefined) return cached;
  const img = stageArtImage(`${key.split('/')[0]}/${art.decor.file}`);
  if (!img) return null;
  const list = splitHangings(img, art.decor.x, art.decor.y, art.runs);
  hangings.set(key, list);
  return list;
}

/** Group the decor into connected hangings (8-connected), each anchored to the nearest hull cell above its top. */
function splitHangings(img: StageArtImage, ox: number, oy: number, runs: readonly (readonly number[])[]): Hanging[] {
  const { width: w, height: h, pixels } = img, seen = new Uint8Array(w * h), out: Hanging[] = [];
  const solid = (cx: number, cy: number): boolean => { const row = runs[cy]; if (!row) return false; for (let k = 0; k < row.length; k += 2) if (cx >= row[k] && cx <= row[k + 1]) return true; return false; };
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || pixels[s * 4 + 3] < 128) continue;
    const g: Hanging = { fx: [], fy: [], rgb: [], anchorX: 0, anchorY: 0 };
    const st = [s]; seen[s] = 1; let top = h, topX = 0;
    while (st.length) {
      const i = st.pop()!, x = i % w, y = (i / w) | 0;
      g.fx.push(ox + x); g.fy.push(oy + y); g.rgb.push(pixels[i * 4] / 255, pixels[i * 4 + 1] / 255, pixels[i * 4 + 2] / 255);
      if (y < top) { top = y; topX = x; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, j = X + Y * w;
        if (X >= 0 && Y >= 0 && X < w && Y < h && !seen[j] && pixels[j * 4 + 3] >= 128) { seen[j] = 1; st.push(j); }
      }
    }
    // Walk up from the top pixel to the hull cell it hangs from (none within reach: it is anchored to its own top).
    const cx = (ox + topX) >> 1;
    let cy = ((oy + top) >> 1) - 1;
    while (cy >= 0 && !solid(cx, cy)) cy--;
    g.anchorX = cx; g.anchorY = Math.max(0, cy);
    out.push(g);
  }
  return out;
}

function drawHangings(out: PixelSurface, ctx: Ctx, slab: StockSlab): void {
  const list = hangingsFor(slab), art = slabArt(slab);
  if (!list || !art) return;
  const fine = out.setFinePx !== undefined && (out.pixelStep ?? 1) < 1;
  const wf = art.width * 2;
  for (const g of list) {
    const ax = slab.mirror ? slab.x0 + art.width - 1 - g.anchorX : slab.x0 + g.anchorX;
    if (ctx.world.type(ax, slab.y + g.anchorY) !== Cell.Metal) continue; // its hull is gone: so is the hanging
    for (let k = 0; k < g.fx.length; k++) {
      const fx = slab.mirror ? wf - 1 - g.fx[k] : g.fx[k];
      const r = g.rgb[k * 3], gg = g.rgb[k * 3 + 1], b = g.rgb[k * 3 + 2];
      if (fine) out.setFinePx!(slab.x0 + fx * 0.5, slab.y + g.fy[k] * 0.5, r, gg, b);
      else if ((fx & 1) === 0 && (g.fy[k] & 1) === 0) out.setPx(slab.x0 + (fx >> 1), slab.y + (g.fy[k] >> 1), r, gg, b);
    }
  }
}

/** Bake invariant material detail once; only the surviving-cell mask is sampled each frame. */
function buildArtwork(stage: StockStageDef): ArtPixel[] {
  const pixels: ArtPixel[] = [];
  const out = { setPx(x: number, y: number, r: number, g: number, b: number): void {
    pixels.push({ x, y, r, g, b, type: Cell.Metal });
  } };
  for (const slab of [stage.main, ...stage.platforms]) {
    if (slab.art) continue; // baked art lives in the cells themselves
    // Paint the collision rim last so a wide camera never loses its thin highlight to downsampling.
    for (let y = slab.y + slab.depth - 1; y >= slab.y; y--) for (let x = slab.x0; x <= slab.x1; x++) {
      const dy = y - slab.y, dx = x - slab.x0;
      const row = slabRow(slab, y);
      if (!row || x < row.x0 || x > row.x1) continue;
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
      const next = slabRow(slab, y + 1);
      if (dy > 8 && (dy === slab.depth - 1 || !next || x < next.x0 || x > next.x1)) { r = .43; g = .31; b = .18; }
      out.setPx(x, y, r, g, b);
    }
  }
  for (const lamp of stage.lamps) {
    for (let y = lamp.y - 4; y <= lamp.y + 6; y++) for (let x = lamp.x - 3; x <= lamp.x + 3; x++) {
      pixels.push({ x, y, r: .35, g: .94, b: .89, type: Cell.Glowshroom });
      out.setPx(x, y, .22, .34, .36);
    }
  }
  // A riveted copper housing, toothed gear, and flask cutout on the real central body (baked art carries its own).
  if (stage.main.art) return pixels;
  const emblemY = stage.main.y + 33, emblemX = stage.center.x;
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

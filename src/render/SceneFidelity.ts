import type { Ctx, AuthoredLight } from '@/core/types';
import type { World } from '@/sim/World';
import type { LightField, PixelSurface } from '@/render/pixels';
import { Cell, isGas, isSoftGrowth } from '@/sim/CellType';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { VISUAL_FIDELITY } from '@/config/visualFidelity';
// Export the actual shared table for browser isolation probes, including HMR.
export { VISUAL_FIDELITY } from '@/config/visualFidelity';
import { Pen, BRASS, BRASS_D, BRASS_L, INK, cameraView } from '@/render/sprites/FineArt';
import type { RGB } from '@/render/sprites/FineArt';

const masonry = (t: number): boolean => t === Cell.Stone || t === Cell.Wall || t === Cell.Wood;
const air = (t: number): boolean => t === Cell.Empty || isGas(t) || isSoftGrowth(t);
const hash = (x: number, y: number): number => (Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
interface GrowthAnchor { x: number; y: number; side: number; seed: number }
interface GrowthChunk { version: number; anchors: GrowthAnchor[] }
interface GrowthCache { epoch: number; revision: number; chunks: Map<number, GrowthChunk> }
const growth = new WeakMap<World, GrowthCache>();
interface MaterialChunk { version: number; water: number[]; rims: number[] }
interface MaterialCache { epoch: number; revision: number; chunks: Map<number, MaterialChunk> }
const materials = new WeakMap<World, MaterialCache>();
const waterWarpX = new Float64Array(VIEW_W + 2), waterWarpY = new Float64Array(VIEW_H + 2);

/** Every tuft belongs to a current material face. Cache only the roots, never
 * the pixels: cell edits remove the dressing with the face, and lighting and
 * wind remain live. No cells, colliders or interactive plants are invented. */
function drawSurfaceGrowth(out: PixelSurface, light: LightField, ctx: Ctx): void {
  if (VISUAL_FIDELITY.surfaceGrowth <= 0) return;
  const { world, camera } = ctx, tick = ctx.state.frameCount;
  const view = cameraView(camera, 36), pen = new Pen(out, view), a = world.activity;
  let cache = growth.get(world);
  if (!cache) { cache = { epoch: a.epoch, revision: -1, chunks: new Map() }; growth.set(world, cache); }
  if (cache.epoch !== a.epoch || (!a.ready && cache.revision !== world.mutationVersion)) cache.chunks.clear();
  cache.epoch = a.epoch; cache.revision = world.mutationVersion;
  const chunks = cache.chunks;
  const cx0 = Math.max(0, Math.floor(view.x0 / 64)), cy0 = Math.max(0, Math.floor(view.y0 / 64));
  const cx1 = Math.min(a.columns - 1, Math.floor(view.x1 / 64)), cy1 = Math.min(Math.ceil(world.height / 64) - 1, Math.floor(view.y1 / 64));
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const key = cy * a.columns + cx, version = a.versions[key];
    let chunk = chunks.get(key);
    if (!chunk || chunk.version !== version) {
      const anchors: GrowthAnchor[] = [];
      for (let y = Math.max(1, cy * 64); y < Math.min(world.height - 1, cy * 64 + 64); y++) {
        for (let x = Math.max(1, cx * 64); x < Math.min(world.width - 1, cx * 64 + 64); x++) {
          const i = world.idx(x, y), t = world.types[i];
          if (!masonry(t)) continue;
          const seed = hash(x, y);
          if (x % 6 === 0 && (air(world.types[i - world.width]) || world.types[i - world.width] === Cell.Water) &&
            seed % 5 !== 0 && hash(x >> 4, y >> 4) % 4 !== 0) anchors.push({ x, y, side: 0, seed });
          else if (y % 11 === 0 && seed % 4 < 2) {
            if (air(world.types[i - 1])) anchors.push({ x, y, side: -1, seed });
            else if (air(world.types[i + 1])) anchors.push({ x, y, side: 1, seed });
          }
        }
      }
      chunk = { version, anchors }; chunks.set(key, chunk);
    }
    for (const root of chunk.anchors) {
      const { x, y, seed, side } = root;
      if (!pen.inView(x - 8, y - 10, x + 8, y + 35) || !masonry(world.type(x, y))) continue;
      const s = light.sample(x, y - 2), open = s.open ?? 1;
      if (open < .08 || world.type(x, y - 1) === Cell.Fire) continue;
      const lr = Math.min(1.2, Math.max(.64 * open, s.r)), lg = Math.min(1.2, Math.max(.72 * open, s.g)), lb = Math.min(1.2, Math.max(.55 * open, s.b));
      const color: RGB = [(.30 + (seed & 3) * .025) * lr, (.43 + (seed & 3) * .045) * lg, .14 * lb];
      const shade: RGB = [.12 * lr, .23 * lg, .11 * lb], rim: RGB = [.65 * lr, .72 * lg, .27 * lb];
      if (side === 0) {
        const aquatic = world.type(x, y - 1) === Cell.Water;
        const height = aquatic ? 10 + seed % 20 : 3 + seed % 7;
        const sway = Math.sin(tick * .021 + x * .07) * .9;
        for (const dir of [-1, 0, 1]) {
          const tipX = x + dir * (2 + seed % 3) + sway, tipY = y - height + Math.abs(dir) * 2;
          const tip = world.type(Math.round(tipX), Math.round(tipY));
          if (!air(tip) && !(aquatic && tip === Cell.Water)) continue;
          pen.line(x, y - .5, tipX, tipY, shade);
          const leaves = aquatic ? 7 : 3;
          for (let k = 1; k <= leaves; k++) {
            const t = k / (leaves + 1), px = x + (tipX - x) * t + (aquatic ? Math.sin(t * 7 + tick * .015 + x) * 1.4 : 0), py = y - .5 + (tipY - y) * t;
            pen.line(px, py, px + (k % 2 ? -2 : 2), py - 1.5, color, 1.2);
            pen.px(px + .5, py - .5, rim, .72);
          }
        }
        if (!aquatic && seed % 13 === 0 && air(world.type(x, y - height))) {
          // Tiny ordinary flowers: pale petals have no emissive gameplay cue.
          const petal: RGB = [.48 * lr, .67 * lg, .78 * lb];
          pen.line(x - 1, y - height - .5, x + 1, y - height - .5, petal);
          pen.line(x, y - height - 1.5, x, y - height + .5, petal);
          pen.px(x, y - height - .5, rim);
        }
        // Moss creeps down the stone face, following the current material.
        for (let k = 0; k < 5 + seed % 14; k++) {
          const px = x + Math.round(Math.sin(k * .35 + seed) * 2);
          if (!masonry(world.type(px, y + k))) break;
          pen.px(px, y + k, k % 3 ? shade : color);
          if (k % 3 === 0) pen.line(px, y + k, px + 1.5, y + k + .5, color);
        }
      } else {
        const length = 9 + seed % 25;
        for (let k = 0; k < length; k++) {
          const px = x + side * (1 + Math.sin(k * .17 + seed) * 1.6);
          const py = y + k;
          const t = world.type(Math.round(px), py);
          if (t === Cell.Fire || (!air(t) && !masonry(t))) break;
          pen.px(px, py, shade);
          if (k % 3 === 0) {
            pen.line(px, py, px + side * 2.5, py + 1, color, 1.4);
            pen.px(px + side * 1.5, py, rim, .65);
          }
        }
      }
    }
  }
}

/** Fine material edges, caustics and foam belong to real cells, including draining and newly
 * filled pools. A lone falling cell gets a glint, never a false pool outline. */
function drawMaterialLight(out: PixelSurface, light: LightField, ctx: Ctx): void {
  const { world, camera } = ctx, tick = ctx.state.frameCount;
  const step = out.pixelStep ?? 1;
  const pen = new Pen(out, cameraView(camera, 1));
  const x0 = Math.max(1, camera.renderX), x1 = Math.min(world.width - 2, camera.renderX + VIEW_W);
  const y0 = Math.max(1, camera.renderY), y1 = Math.min(world.height - 2, camera.renderY + VIEW_H);
  const phase = tick * .018;
  const a = world.activity;
  let cache = materials.get(world);
  if (!cache) { cache = { epoch: a.epoch, revision: -1, chunks: new Map() }; materials.set(world, cache); }
  if (cache.epoch !== a.epoch || (!a.ready && cache.revision !== world.mutationVersion)) cache.chunks.clear();
  cache.epoch = a.epoch; cache.revision = world.mutationVersion;
  // Inactive stone interiors cannot contribute an edge. Retain only current
  // water and exposed faces, invalidated by the normal cell-edit halo.
  const visible: MaterialChunk[] = [];
  for (let cy = Math.floor(y0 / 64); cy <= Math.floor(y1 / 64); cy++) for (let cx = Math.floor(x0 / 64); cx <= Math.floor(x1 / 64); cx++) {
    const key = cy * a.columns + cx, version = a.versions[key];
    let chunk = cache.chunks.get(key);
    if (!chunk || chunk.version !== version) {
      const water = chunk?.water ?? [], rims = chunk?.rims ?? [];
      water.length = 0; rims.length = 0;
      for (let y = Math.max(1, cy * 64); y < Math.min(world.height - 1, cy * 64 + 64); y++) for (let x = Math.max(1, cx * 64); x < Math.min(world.width - 1, cx * 64 + 64); x++) {
        const i = world.idx(x, y), t = world.types[i];
        if (t === Cell.Water) water.push(i);
        else if ((masonry(t) || t === Cell.Metal) && (air(world.types[i - world.width]) || world.types[i - world.width] === Cell.Water || air(world.types[i - 1]))) rims.push(i);
      }
      chunk = { version, water, rims }; cache.chunks.set(key, chunk);
    }
    visible.push(chunk);
  }
  if (VISUAL_FIDELITY.materialRims > 0) for (const chunk of visible) for (const index of chunk.rims) {
    const x = index % world.width, y = Math.floor(index / world.width);
    if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
    if (world.colorOverrides.has(index)) continue;
    const material = world.types[index];
    if (masonry(material) || material === Cell.Metal) {
      const top = air(world.types[index - world.width]) || world.types[index - world.width] === Cell.Water;
      const left = air(world.types[index - 1]);
      if (top || left) {
        const s = light.sample(x, y), open = s.open ?? 1;
        const k = (.5 + hash(x, y) % 7 / 10) * VISUAL_FIDELITY.materialRims;
        const metal = material === Cell.Wood || material === Cell.Metal;
        const rim: RGB = metal ? [.15 * Math.max(open * .6, s.r), .10 * Math.max(open * .6, s.g), .045 * Math.max(open * .6, s.b)] :
          [.075 * Math.max(open * .6, s.r), .095 * Math.max(open * .6, s.g), .10 * Math.max(open * .6, s.b)];
        pen.glow(x, y, rim, k);
        if (top && step < 1) pen.glow(x + step, y, rim, k * .8);
      }
    }
  }
  for (let x = x0; x < x1; x++) waterWarpX[x - x0] = Math.sin(x * .054 - phase) * 1.5;
  for (let y = y0; y < y1; y++) waterWarpY[y - y0] = Math.sin(y * .063 + phase) * 1.8;
  for (const chunk of visible) for (const index of chunk.water) {
    const x = index % world.width, y = Math.floor(index / world.width);
    if (x < x0 || x >= x1 || y < y0 || y >= y1 || world.types[index] !== Cell.Water || world.colorOverrides.has(index)) continue;
    if (world.types[index - world.width] === Cell.Empty && world.types[index + world.width] === Cell.Water) {
      // White-cyan broken meniscus, with a coherent crest and fine spray.
      const s = light.sample(x, y), dk = s.open ?? 1;
      const crest = .65 + .35 * Math.sin(x * .63 + tick * .11);
      const glint = VISUAL_FIDELITY.waterFoam * dk * crest;
      pen.glow(x, y, [.12, .65, .72], glint);
      pen.glow(x + step, y, [.10, .38, .45], glint);
      if (hash(x, y) % 7 === 0) {
        const lift = .5 + .5 * Math.sin(tick * .09 + x);
        if (world.type(x, y - 1) === Cell.Empty) pen.glow(x, y - lift, [.24, .69, .72], glint * .5);
      }
    } else if (VISUAL_FIDELITY.waterCaustics > 0) {
      const u = x * .095 + waterWarpY[y - y0];
      const v = y * .12 + waterWarpX[x - x0];
      const field = Math.sin(u + Math.sin(v * .7)) + Math.sin(v + Math.sin(u * .9 + phase) * .9);
      const ridge = Math.max(0, 1 - Math.abs(field) * 7);
      if (ridge <= 0) continue;
      const s = light.sample(x, y), open = s.open ?? 1;
      const k = ridge * ridge * VISUAL_FIDELITY.waterCaustics * Math.max(.55 * open, Math.min(1, s.g));
      pen.glow(x, y, [.19, .83, .88], k);
      if (step < 1) {
        pen.glow(x + step, y, [.12, .50, .58], k * .85);
        pen.glow(x, y + step, [.12, .50, .58], k * .7);
        pen.glow(x + step, y + step, [.12, .50, .58], k * .6);
      }
    }
  }
}

function drawLamp(pen: Pen, fixture: AuthoredLight, tick: number, world: World): void {
  const { x, y } = fixture;
  if (!pen.inView(x - 22, y - 18, x + 22, y + 22)) return;
  // The failing Undertow fixtures already have their own physical metal/glass.
  if (fixture.intensity < .4) return;
  const warm = fixture.r > fixture.b * 1.2;
  const glass: RGB = warm ? [1.9, 1.12, .36] : [.30, 1.24, .9];
  const flicker = 1 + Math.sin(tick * .09 + fixture.flickerPhase) * fixture.flicker;
  const glow = VISUAL_FIDELITY.fixtureGlow * fixture.intensity * flicker;
  for (let dy = -20; dy <= 20; dy += 1) for (let dx = -20; dx <= 20; dx += 1) {
    const d = dx * dx + dy * dy;
    if (d > 400 || !air(world.type(Math.round(x + dx), Math.round(y + dy)))) continue;
    pen.glow(x + dx, y + dy, glass, glow * .22 * (1 - d / 400) ** 2);
  }
  pen.line(x, y - 13, x, y - 7, BRASS_D, 1);
  pen.ring(x, y - 5.5, 1.4, .5, BRASS);
  pen.line(x - 3, y - 3, x, y - 5, BRASS_L, 1);
  pen.line(x, y - 5, x + 3, y - 3, BRASS_D, 1);
  pen.line(x - 3, y - 3, x - 3, y + 4, INK, 1.5);
  pen.line(x + 3, y - 3, x + 3, y + 4, INK, 1.5);
  for (let dy = -2; dy <= 3; dy += pen.step) {
    pen.raw(x - 1.5, y + dy, glass, flicker * .65);
    pen.raw(x, y + dy, glass, flicker);
    pen.raw(x + 1.5, y + dy, glass, flicker * .45);
  }
  pen.line(x - 3, y - 3, x + 3, y - 3, BRASS_L, .6);
  pen.line(x - 3.5, y + 4, x + 3.5, y + 4, BRASS, 1);
  pen.line(x - 3, y + 5, x + 3, y + 5, INK, 1);
  pen.px(x, y + 6, BRASS_L);
}

/** Detail stays below actors and projectiles, at the renderer's fine pixel
 * resolution. The shared overlay also serves CPU and WebGPU presentation. */
export function drawSceneFidelity(out: PixelSurface, light: LightField, ctx: Ctx): void {
  if (!VISUAL_FIDELITY.enabled || !ctx.levels.current || ctx.state.mode !== 'play') return;
  drawMaterialLight(out, light, ctx);
  const biome = ctx.levels.current.def.biome;
  if (ctx.levels.current.living || biome === 'fungal' || biome === 'flooded') drawSurfaceGrowth(out, light, ctx);
  if (ctx.levels.current.living && VISUAL_FIDELITY.fixtureGlow > 0) {
    const pen = new Pen(out, cameraView(ctx.camera, 20));
    for (const fixture of ctx.levels.current.authoredLights ?? []) {
      if (fixture.fixture === 'lantern') drawLamp(pen, fixture, ctx.state.frameCount, ctx.world);
    }
  }
}

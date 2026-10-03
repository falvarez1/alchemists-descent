import type { Ctx, AuthoredLight } from '@/core/types';
import type { World } from '@/sim/World';
import type { LightField, PixelSurface } from '@/render/pixels';
import { blocksEntity, Cell, isGas, isSoftGrowth } from '@/sim/CellType';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { VISUAL_FIDELITY } from '@/config/visualFidelity';
// Export the actual shared table for browser isolation probes, including HMR.
export { VISUAL_FIDELITY } from '@/config/visualFidelity';
import { Pen, BRASS, BRASS_D, BRASS_L, INK, cameraView, finePixelStep, viewIntersects } from '@/render/sprites/FineArt';
import type { RGB } from '@/render/sprites/FineArt';
import { visibleSurfaceFoliage, type SurfacePlant } from '@/game/SurfaceFoliage';
import { buildFlora, createFloraBlades, floraLean } from '@/world/flora';
import { blitFloraCache, createFloraCache, floraPalette, paintFlora, pruneFloraCaches, settleFloraLight, type FloraCache } from '@/render/FloraPainter';
import { surfaceFoliageHash as hash } from '@/world/surfaceFoliage';
import { lanternFlicker } from '@/config/ambientMotion';

const masonry = (t: number): boolean => t === Cell.Stone || t === Cell.Wall || t === Cell.Wood;
const air = (t: number): boolean => t === Cell.Empty || isGas(t) || isSoftGrowth(t);
interface MaterialChunk { version: number; water: number[]; rims: number[] }
interface MaterialCache { epoch: number; revision: number; chunks: Map<number, MaterialChunk> }
const materials = new WeakMap<World, MaterialCache>();
const plant = createFloraBlades();
const caches = new WeakMap<SurfacePlant, FloraCache>();
const mix = (h: number, v: number): number => Math.imul((h ^ (v | 0)) >>> 0, 16777619) >>> 0;
interface SeeThrough {
  /** Everything the opacity depends on inside a box, folded into a cache key. */
  key(x0: number, y0: number, x1: number, y1: number): number;
  opacity(x: number, y: number): number;
}
const waterWarpX = new Float64Array(VIEW_W + 2), waterWarpY = new Float64Array(VIEW_H + 2);

/** Current moss cells own the plant, its motion and fuel. Render only reads
 * those poses; repeated compose calls never advance a spring or smoulder. */
function drawSurfaceGrowth(out: PixelSurface, light: LightField, ctx: Ctx, foreground = false, see?: SeeThrough): void {
  if (!foreground && VISUAL_FIDELITY.surfaceGrowth <= 0) return;
  const { world, camera } = ctx, frame = ctx.state.frameCount, a = world.activity;
  const palette = floraPalette(ctx.levels.current?.def?.biome, foreground);
  const isSolid = (x: number, y: number): boolean => blocksEntity(world.type(Math.floor(x), Math.floor(y)));
  const step = finePixelStep(out), inv = 1 / step;
  // Cover plants flutter leaf by leaf, sampled in staggered 2-tick buckets. A
  // ground tuft only leans, so it re-paints when its lean moves a quarter cell.
  const bucket = 2;
  const frameKey = mix(mix(mix(Math.round(step * 1000), Math.round(((camera.renderX * inv) % 1) * 8)),
    Math.round(((camera.renderY * inv) % 1) * 8)), foreground ? 1 : 0);
  pruneFloraCaches(frame);
  for (const root of visibleSurfaceFoliage(ctx)) {
    if (Boolean(root.foreground) !== foreground) continue;
    const reach = root.height * 1.3 + 8;
    if (!viewIntersects(camera, root.x - reach, root.y - reach, root.x + reach, root.y + reach, 4)) continue;
    const time = frame - ((frame + root.seed) % bucket + bucket) % bucket;
    const motion = foreground || root.burning ? time : Math.round(floraLean(root, time) * 4) * 7919;
    let cache = caches.get(root);
    if (!cache) { cache = createFloraCache(); caches.set(root, cache); }
    const H = root.height * (1 - root.burn * .75);
    const lit = settleFloraLight(cache, light, root.x + .5, root.side !== 0 ? root.y + .5 : root.y + 1, H, foreground, frame);
    let key = mix(mix(mix(mix(mix(frameKey, motion), Math.round(root.angle * 48)), Math.round(root.part * 24)),
      Math.round(root.burn * 45) * 2 + (root.burning ? 1 : 0)), lit);
    // Terrain edits (digging, a door) under the plant change what it may paint over.
    if (a.ready) {
      for (let cy = Math.max(0, Math.floor((root.y - reach) / 64)); cy <= Math.min(a.rows - 1, Math.floor((root.y + reach) / 64)); cy++) {
        for (let cx = Math.max(0, Math.floor((root.x - reach) / 64)); cx <= Math.min(a.columns - 1, Math.floor((root.x + reach) / 64)); cx++) key = mix(key, a.versions[cy * a.columns + cx]);
      }
    } else key = mix(key, world.mutationVersion);
    if (see) key = mix(key, see.key(root.x - reach, root.y - reach, root.x + reach, root.y + reach));
    if (blitFloraCache(out, cache, key, frame)) continue;
    const blades = buildFlora(root, time, plant), rootY = blades.rootY;
    // Leaves never paint into rock, except the base, which tucks over the floor lip.
    const opacity = (x: number, y: number): number => {
      if (isSolid(x, y) && (y < rootY - .25 || y > rootY + 1.8)) return 0;
      return see ? see.opacity(x, y) : 1;
    };
    paintFlora(out, { blades, palette, light, time, burn: root.burn, burning: root.burning,
      camX: camera.renderX, camY: camera.renderY, foreground, opacity, isSolid,
      skirt: root.side !== 0 ? 0 : foreground ? 6 + root.seed % 5 : 1.5 + root.seed % 4 }, cache, key, frame);
  }
}

/** Functional cover always draws, including with cosmetic fidelity disabled.
 * Leaves cover bodies (thinning where the alchemist stands, so he stays
 * readable), but never paint through terrain or bury control glyphs. */
export function drawForegroundFoliage(out: PixelSurface, light: LightField, ctx: Ctx): void {
  const level = ctx.levels.current;
  if (!level || ctx.state.mode !== 'play') return;
  const protectedPoints = [
    ...(level.pickups ?? []).filter(p => !p.taken).map(p => ({ x: p.x, y: p.y, radius: 8 })),
    ...(level.mechanisms ?? []).map(m => ({ x: m.x, y: m.y, radius: 12 })),
    ...(level.portal ? [{ x: level.portal.x, y: level.portal.y, radius: 16 }] : []),
  ].filter(p => Math.abs(p.x - ctx.camera.renderX - VIEW_W / 2) < VIEW_W / 2 + 40 &&
    Math.abs(p.y - ctx.camera.renderY - VIEW_H / 2) < VIEW_H / 2 + 40);
  const p = ctx.player, body = !p.dead;
  const cx = p.x, cy = p.y - 8, head = p.y - 17;
  // Settling into cover closes the leaves around him: the see-through thins as concealment builds.
  const clear = .42 + .3 * (ctx.foliageCover?.progress ?? 0);
  const progress = Math.round((ctx.foliageCover?.progress ?? 0) * 16);
  drawSurfaceGrowth(out, light, ctx, true, { key: (x0, y0, x1, y1) => {
    // Only what overlaps this plant: his see-through window and nearby glyphs.
    let key = 0;
    if (body && cx + 6 > x0 && cx - 6 < x1 && cy + 10 > y0 && cy - 10 < y1) {
      key = mix(mix(mix(1, Math.round(cx * 4)), Math.round(cy * 4)), progress);
    }
    for (const q of protectedPoints) {
      if (q.x + q.radius > x0 && q.x - q.radius < x1 && q.y + q.radius > y0 && q.y - q.radius < y1) key = mix(mix(key, Math.round(q.x * 4)), Math.round(q.y * 4));
    }
    return key;
  }, opacity: (x, y) => {
    let a = 1;
    for (const q of protectedPoints) {
      const d = Math.max(Math.abs(x - q.x), Math.abs(y - q.y)) / q.radius;
      if (d < 1) a = Math.min(a, .22 + .78 * d * d);
    }
    if (body) {
      const e = ((x - cx) / 5.5) ** 2 + ((y - cy) / 9) ** 2;
      if (e < 1 && y > head) a *= clear + (1 - clear) * Math.max(0, (e - .45) / .55);
    }
    return a;
  } });
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
  const flicker = lanternFlicker(tick, fixture.flickerPhase, fixture.flicker);
  const glow = VISUAL_FIDELITY.fixtureGlow * VISUAL_FIDELITY.lampIntensity * fixture.intensity * flicker;
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
  const flameX = Math.sin(tick * .12 + fixture.flickerPhase) * .55;
  pen.raw(x + flameX, y - 2.5 - flicker, glass, flicker * .65);
  pen.line(x - 3.5, y + 4, x + 3.5, y + 4, BRASS, 1);
  pen.line(x - 3, y + 5, x + 3, y + 5, INK, 1);
  pen.px(x, y + 6, BRASS_L);
}

/** Detail stays below actors and projectiles, at the renderer's fine pixel
 * resolution. The shared overlay also serves CPU and WebGPU presentation. */
export function drawSceneFidelity(out: PixelSurface, light: LightField, ctx: Ctx): void {
  if (!VISUAL_FIDELITY.enabled || !ctx.levels.current || ctx.state.mode !== 'play') return;
  drawMaterialLight(out, light, ctx);
  drawSurfaceGrowth(out, light, ctx);
  if (ctx.levels.current.living && VISUAL_FIDELITY.fixtureGlow > 0) {
    const pen = new Pen(out, cameraView(ctx.camera, 20));
    for (const fixture of ctx.levels.current.authoredLights ?? []) {
      if (fixture.fixture === 'lantern') drawLamp(pen, fixture, ctx.state.frameCount, ctx.world);
    }
  }
}

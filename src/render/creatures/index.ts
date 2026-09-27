import type { Ctx, Enemy, EnemyKind } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { ensureRig } from '@/creatures/species';
import { corpses } from '@/creatures/corpses';
import { blankLight, sampleSceneLight, sharedRaster } from './raster';
import type { SpeciesArt } from './types';
import { lizardArt } from './lizard';
import { eggsArt, gelArt } from './gel';
import { batArt } from './bat';
import { impArt } from './imp';
import { wispArt } from './wisp';
import { bruteArt } from './brute';
import { mageArt } from './mage';
import { weaverArt } from './weaver';
import { leviathanArt, rillbackArt, stonemawArt } from './serpents';
import { rootloperArt } from './rootloper';

/**
 * Creature art dispatcher. Species with a rig draw through the shared
 * rasterizer; any kind not yet migrated keeps its legacy pen drawing.
 */
const ART: Partial<Record<EnemyKind, SpeciesArt>> = {
  spitter: lizardArt,
  slime: gelArt,
  acidslime: gelArt,
  bomber: gelArt,
  eggs: eggsArt,
  bat: batArt,
  imp: impArt,
  wisp: wispArt,
  golem: bruteArt,
  colossus: bruteArt,
  mage: mageArt,
  weaver: weaverArt,
  rillback: rillbackArt,
  stonemaw: stonemawArt,
  leviathan: leviathanArt,
  rootloper: rootloperArt,
};

const LIGHT = blankLight();

export function hasSpeciesArt(kind: EnemyKind): boolean {
  return ART[kind] !== undefined;
}

export function drawSpecies(out: PixelSurface, light: LightField, ctx: Ctx, e: Enemy, glow = 1): boolean {
  const art = ART[e.kind];
  if (!art) return false;
  const rig = ensureRig(e);
  if (!rig) return false;
  const fine = out.setFinePx !== undefined && (out.pixelStep ?? 1) < 1;
  const step = fine ? out.pixelStep ?? 1 : 1;
  const [x0, y0, x1, y1] = art.bounds(e, rig);
  const r = sharedRaster;
  r.begin(step, x0, y0, x1, y1, art.materials(e), e.x, e.y);
  r.outline = art.style?.outline ?? 1;
  r.bands = art.style?.bands ?? 0.72;
  r.dither = art.style?.dither ?? false;
  r.blend = art.style?.blend ?? 1.6;
  art.draw(r, ctx, e, rig);
  const probe = art.lightProbe?.(e, rig) ?? [e.x, e.y - 6, 10];
  const flash = !ctx.state.reduceFlashes && e.flash > 0 ? Math.min(0.55, e.flash / 11) : 0;
  sampleSceneLight(light, probe[0], probe[1], probe[2], flash, LIGHT, glow);
  if (art.selfLit) {
    // Its own lamp floods the sample it is tinted by: keep the level, lose most of the hue.
    const lum = LIGHT.r * 0.3 + LIGHT.g * 0.5 + LIGHT.b * 0.2, k = 0.3, cap = 1.05;
    LIGHT.r = Math.min(cap, lum + (LIGHT.r - lum) * k); LIGHT.g = Math.min(cap, lum + (LIGHT.g - lum) * k); LIGHT.b = Math.min(cap, lum + (LIGHT.b - lum) * k);
  }
  r.resolve(out, LIGHT);
  return true;
}

/** Remains of the dead: drawn under the living, their lights guttering out. */
export function drawCorpses(out: PixelSurface, light: LightField, ctx: Ctx, inView: (e: Enemy) => boolean): void {
  for (const c of corpses()) {
    if (c.world !== ctx.world || !inView(c.e)) continue;
    drawSpecies(out, light, ctx, c.e, c.glow);
  }
}

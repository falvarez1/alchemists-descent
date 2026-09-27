import type { Ctx, Enemy, EnemyKind } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { ensureRig } from '@/creatures/species';
import { corpses } from '@/creatures/corpses';
import type { Corpse } from '@/creatures/corpses';
import { blankLight, sampleSceneLight, sharedRaster } from './raster';
import type { SpeciesArt } from './types';
import type { SceneLight } from './raster';
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
import { resetEyeMarks } from './anatomy';
import { drawEyeshine, revealFor } from './eyeshine';

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

export function drawSpecies(out: PixelSurface, light: LightField, ctx: Ctx, e: Enemy, glow = 1, tint?: SceneLight['tint']): boolean {
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
  resetEyeMarks();
  art.draw(r, ctx, e, rig);
  const probe = art.lightProbe?.(e, rig) ?? [e.x, e.y - 6, 10];
  const flash = !ctx.state.reduceFlashes && e.flash > 0 ? Math.min(0.55, e.flash / 11) : 0;
  sampleSceneLight(light, probe[0], probe[1], probe[2], flash, LIGHT, glow);
  if (art.selfLit) {
    // Its own lamp floods the sample it is tinted by: keep the level, lose most of the hue.
    const lum = LIGHT.r * 0.3 + LIGHT.g * 0.5 + LIGHT.b * 0.2, k = 0.3, cap = 1.05;
    LIGHT.r = Math.min(cap, lum + (LIGHT.r - lum) * k); LIGHT.g = Math.min(cap, lum + (LIGHT.g - lum) * k); LIGHT.b = Math.min(cap, lum + (LIGHT.b - lum) * k);
  }
  // Light wave: in designed darkness the body resolves as the light finds it,
  // and its eyes and markings glow on top (render/creatures/eyeshine).
  LIGHT.reveal = glow >= 0.999 ? revealFor(ctx, e, LIGHT, probe[0], probe[1]) : 1;
  LIGHT.tint = tint;
  r.resolve(out, LIGHT);
  LIGHT.tint = undefined;
  drawEyeshine(out, ctx, e, glow);
  return true;
}

const TINT: [number, number, number, number] = [0, 0, 0, 0];

/**
 * What the world has done to the remains, as a wash over the body: frozen
 * ice-pale, charred toward soot with embers breathing through while it burns,
 * and a faint brass glow while the wand holds it.
 */
function corpseTint(ctx: Ctx, c: Corpse): SceneLight['tint'] {
  const t = ctx.state.frameCount;
  if (c.frozen > 0) { TINT[0] = 0.8; TINT[1] = 0.92; TINT[2] = 1; TINT[3] = 0.42; return TINT; }
  if (c.grip) {
    TINT[0] = 1; TINT[1] = 0.8; TINT[2] = 0.45;
    TINT[3] = ctx.state.reduceFlashes ? 0.08 : 0.11 + 0.05 * Math.sin(t * 0.2);
    return TINT;
  }
  if (c.burn > 0) {
    const f = 0.5 + 0.5 * Math.sin(t * 0.37 + c.e.bobPhase * 9);
    TINT[0] = 0.4 + 0.25 * f; TINT[1] = 0.12 + 0.06 * f; TINT[2] = 0.03; TINT[3] = Math.min(0.8, 0.25 + c.char * 0.55);
    return TINT;
  }
  if (c.char > 0.02) { TINT[0] = 0.09; TINT[1] = 0.07; TINT[2] = 0.06; TINT[3] = Math.min(0.78, c.char * 0.8); return TINT; }
  return undefined;
}

/** Remains of the dead: drawn under the living, their lights guttering out. */
export function drawCorpses(out: PixelSurface, light: LightField, ctx: Ctx, inView: (e: Enemy) => boolean): void {
  for (const c of corpses()) {
    if (c.world !== ctx.world || !inView(c.e)) continue;
    drawSpecies(out, light, ctx, c.e, c.glow, corpseTint(ctx, c));
  }
}

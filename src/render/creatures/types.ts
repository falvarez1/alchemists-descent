import type { Ctx, Enemy } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import type { CreatureMaterial } from './palette';
import type { CreatureRaster } from './raster';

/** How one species turns its simulated rig into lit volumes. */
export interface SpeciesArt {
  /** Material table for this individual (variants may swap palettes). */
  materials(e: Readonly<Enemy>): CreatureMaterial[];
  /** World-space bounds [x0, y0, x1, y1] the drawing may touch. */
  bounds(e: Readonly<Enemy>, rig: CreatureRig): [number, number, number, number];
  /** Emit primitives into the raster (it is already begun with `materials`). */
  draw(r: CreatureRaster, ctx: Ctx, e: Enemy, rig: CreatureRig): void;
  /** Light probe centre offset / radius (defaults: body centre, 10 cells). */
  lightProbe?(e: Readonly<Enemy>, rig: CreatureRig): [number, number, number];
  /** Rasterizer style overrides. */
  style?: { outline?: number; bands?: number; dither?: boolean; blend?: number };
  /** The creature seeds light where it stands: read the field with its own glow muted. */
  selfLit?: boolean;
}

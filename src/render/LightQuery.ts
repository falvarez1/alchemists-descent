import type { Ctx, LightQueryApi } from '@/core/types';
import { mutatorMods } from '@/content/mutators';
import { darkMapFor, openAtCell, renderOpenLut, sampleDarkMap } from '@/core/darkness';
import { LIGHT_CLAMP, renderAmbient } from '@/render/lightingModel';

/** The slice of the light field a gameplay query reads (render/Lighting). */
export interface QueryableLightField {
  readonly LW: number;
  readonly LH: number;
  readonly lightR: Float32Array;
  readonly lightG: Float32Array;
  readonly lightB: Float32Array;
  readonly wandField: Float32Array;
  readonly lightOpen?: Float32Array;
  /** lightOpen is all ones this build (a readable level). */
  readonly openFlat?: boolean;
  /** Camera origin the field was built at (half-res texel = (x - originX) >> 1). */
  readonly originX: number;
  readonly originY: number;
  readonly built: boolean;
}

/**
 * Light as a gameplay fact (the contract in core/types LightQueryApi).
 *
 * Creatures, organisms, plants and devices ask the light the player actually
 * sees instead of reaching into the renderer: the most recent light build
 * (even frames), indexed by the camera origin it was built at. The field only
 * covers the view window, so an off-view point reads as unlit (ambient only)
 * — exactly as dark as it looks. Darkness BY DESIGN comes from the level's
 * baked zone map and reads everywhere.
 */
export class LightQuery implements LightQueryApi {
  constructor(
    private readonly ctx: Ctx,
    private readonly field: QueryableLightField,
  ) {}

  get hooded(): boolean {
    return this.ctx.state.lanternHooded === true;
  }

  /** Field texel index for a world point, or -1 off the built field. */
  private texel(x: number, y: number): number {
    const f = this.field;
    if (!f.built) return -1;
    const lx = (Math.floor(x) - f.originX) >> 1, ly = (Math.floor(y) - f.originY) >> 1;
    if (lx < 0 || ly < 0 || lx >= f.LW || ly >= f.LH) return -1;
    return ly * f.LW + lx;
  }

  level(x: number, y: number): number {
    const i = this.texel(x, y);
    const f = this.field;
    let open: number;
    let L = 0;
    if (i >= 0) {
      // The darkness reads smooth, exactly as drawn (core/darkness openAtCell).
      open = f.lightOpen && f.openFlat !== true
        ? openAtCell(f.lightOpen, f.LW, f.LH, Math.floor(x) - f.originX, Math.floor(y) - f.originY)
        : 1;
      L = Math.max(f.lightR[i], f.lightG[i], f.lightB[i]);
    } else {
      const d = sampleDarkMap(darkMapFor(this.ctx.levels?.current, mutatorMods(this.ctx.state).darkness), x, y);
      open = renderOpenLut(this.ctx.state.highReadability === true)[Math.round(d * 255)];
    }
    return Math.min(2, renderAmbient(this.ctx) * open + Math.min(LIGHT_CLAMP, L));
  }

  wandLight(x: number, y: number): number {
    if (this.hooded) return 0;
    const i = this.texel(x, y);
    return i >= 0 ? this.field.wandField[i] : 0;
  }

  darkness(x: number, y: number): number {
    return sampleDarkMap(darkMapFor(this.ctx.levels?.current, mutatorMods(this.ctx.state).darkness), x, y);
  }
}

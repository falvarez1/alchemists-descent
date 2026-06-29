import type { BodyMaterial } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';

/**
 * Rigid-body materials. One number, `density` relative to water (= 1), drives
 * both mass and buoyancy. Material also sets default colour and spell-reaction
 * flags.
 */
export interface BodyMaterialDef {
  /** Rapier density (mass = area x density); also density vs water for buoyancy. */
  density: number;
  /** Default packed 0xRRGGBB fill colour. */
  color: number;
  /** Fire ignites and destroys it. */
  flammable: boolean;
  /** Lightning arcs through it. */
  conductive: boolean;
  /** Cell type strewn when it is destroyed, or null. */
  gore: number | null;
}

/** Water's reference density: bodies lighter than this float. */
export const WATER_DENSITY = 1;

export const BODY_MATERIALS: Record<BodyMaterial, BodyMaterialDef> = {
  wood: { density: 0.6, color: packRGB(150, 100, 55), flammable: true, conductive: false, gore: Cell.Ash },
  stone: { density: 1.5, color: packRGB(112, 108, 112), flammable: false, conductive: false, gore: Cell.Stone },
  metal: { density: 2.6, color: packRGB(122, 134, 150), flammable: false, conductive: true, gore: null },
};

export function bodyMaterialDef(material: BodyMaterial): BodyMaterialDef {
  return BODY_MATERIALS[material];
}

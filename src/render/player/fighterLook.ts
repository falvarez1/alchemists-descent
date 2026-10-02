import type { FighterId } from '@/content/fighters';
import type { Ctx, PlayerState } from '@/core/types';
import type { Skeleton, V } from '@/entities/playerPose';
import type { PlayerCostume } from '@/entities/playerCostume';
import { material } from '@/render/creatures/palette';
import type { CreatureMaterial, MaterialSpec } from '@/render/creatures/palette';
import type { CreatureRaster } from '@/render/creatures/raster';
import {
  ALCHEMIST_MATS, BEARD, BLOOD, BOOT, COAT, COAT_D, COPPER, CYAN, EYE, FLAME, GLASS, HEART, LEATHER, LIQUID, MANTLE, RUNE, SKIN, WOOD,
} from '@/render/player/AlchemistArt';

/**
 * A FIGHTER'S LOOK (docs/FIGHTERS.md "Art"). The concept sheets are illustrated at ~120 px a figure and the
 * player is 17 cells tall, so a fighter is not a sprite: it is the alchemist's own skeleton, cloth rig and
 * lit-volume rasterizer dressed differently. A look is a palette plus a few structural choices (outfit,
 * headgear, hair, wand) and, where a character needs it, per-pass overrides that draw its own pieces (a
 * tower shield, a halo, a shoulder lantern). Everything a look draws goes through the shared rasterizer, so
 * it is lit by the scene, outlined, frosted by the chill and ragdolled in death like the alchemist.
 *
 * Add a look by creating `looks/<id>.ts` exporting `look: FighterLook`; `scripts/fighter-studio.mjs` draws
 * every look in every pose.
 */

/** Material ids 1..21 keep the alchemist's meaning (the chill and breath passes depend on them); a look's own materials are ids EXTRA0 and up. */
export const EXTRA0 = 22;

export type Outfit = 'coat' | 'robe' | 'suit' | 'armor';
export type Headgear = 'hat' | 'wide' | 'hood' | 'helm' | 'band' | 'halo' | 'none';
export type Hair = 'beard' | 'none' | 'bob' | 'ponytail' | 'braid' | 'short';
export type Face = 'open' | 'masked' | 'shadow';
export type WandSkin = 'wand' | 'pistol' | 'staff' | 'spear' | 'scythe' | 'lantern' | 'bell' | 'fist';

export type PassName = 'back' | 'torso' | 'shoulders' | 'head' | 'headgear' | 'held' | 'front' | 'effects';

/** Everything a pass needs: the raster, the posed body, the cloth, and the head-local helper the classic art uses. */
export interface LookCtx {
  r: CreatureRaster;
  s: Skeleton;
  /** +1 / -1: the way the body faces. */
  f: number;
  frame: number;
  ctx: Ctx;
  a: PlayerState;
  costume: PlayerCostume | undefined;
  dead: boolean;
  look: FighterLook;
  /** Head-local point: `side` cells along the facing, `up` cells along the head's up axis, honouring the head tilt. */
  H(side: number, up: number): [number, number];
  /** Midpoint of the torso. */
  mid: V;
  /** The unit vector down the spine (hip to chest, reversed): `ux, uy` point from hip to chest. */
  ux: number;
  uy: number;
}

export interface FighterLook {
  readonly id: FighterId;
  /** The material table: slots 1..21 as the alchemist's (recoloured) plus extras from EXTRA0. */
  mats: CreatureMaterial[];
  /** The fighter's signature colour as 0..1 rgb, for glows and effects drawn with it. */
  accent: readonly [number, number, number];
  outfit: Outfit;
  headgear: Headgear;
  hair: Hair;
  face: Face;
  wand: WandSkin;
  /** Radius multipliers against the alchemist (1). */
  build?: { limb?: number; torso?: number; head?: number };
  /** The bone mantle over the shoulders (the alchemist's; most fighters drop it). */
  mantle?: boolean;
  bandolier?: boolean;
  pouches?: boolean;
  /** The eyes glow (a hood's shadow with two points of light; a visor's slit). */
  eyeGlow?: readonly [number, number, number];
  /** Run these in addition to (after) the shared pass, or instead of it when `replace` lists the pass. */
  extras?: Partial<Record<PassName, (c: LookCtx) => void>>;
  replace?: readonly PassName[];
  /** The wand skin's own drawing, when 'wand' is not enough. Called with the wand's grip, angle and glow. */
  drawWand?: (c: LookCtx) => void;
}

/** One ramp's worth of colour, as the creature rasterizer's `material`. Re-exported so a look file needs one import. */
export { material };
export type { MaterialSpec };

/** The alchemist's slots, by name, for readable overrides. */
export const SLOT = {
  coat: COAT, coatD: COAT_D,
  /** The hat's and the mantle's cloth (the alchemist's bone-coloured felt). */
  mantle: MANTLE,
  leather: LEATHER,
  /** Metal fittings: buckles, hat buckle, belt dot, the staff's cap (the alchemist's copper). */
  trim: COPPER,
  skin: SKIN,
  /** Beard, brows, hair, the ponytail. */
  hair: BEARD,
  boot: BOOT, eye: EYE,
  /** The wand's glow and the bandolier vial (the alchemist's cyan). */
  glow: CYAN,
  /** The levitation ring (the alchemist's rune light). */
  rune: RUNE,
  /** Flame: burning, a muzzle flash, a lantern. */
  flame: FLAME,
  glass: GLASS, wood: WOOD, blood: BLOOD, heart: HEART, liquid: LIQUID,
} as const;
export type SlotName = keyof typeof SLOT;

/**
 * A material table for a look: the alchemist's, with some slots re-coloured, plus extras appended from
 * EXTRA0 (their index is `EXTRA0 + i` in the order given).
 */
export function matsFor(overrides: Partial<Record<SlotName, MaterialSpec>>, extras: readonly MaterialSpec[] = []): CreatureMaterial[] {
  // The rasterizer's material ids are 1-based (id n is table[n - 1]); the alchemist's table holds ids 1..21.
  const out = ALCHEMIST_MATS.slice();
  for (const [name, spec] of Object.entries(overrides) as Array<[SlotName, MaterialSpec]>) out[SLOT[name] - 1] = material(spec);
  for (const spec of extras) out.push(material(spec)); // ids EXTRA0, EXTRA0 + 1, ...
  return out;
}

/** Hex colour to the 0..1 triple a look's `accent` takes. */
export function rgbOf(hex: number): readonly [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

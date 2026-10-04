/**
 * The stock-match stages (docs/arena/platform-fighter/IMPLEMENTATION-PLAN.md, concepts/stages.png). All platforms are real
 * cells inside the world bounds; the blast box is fixed world coordinates the camera never moves. Every stage shares one
 * topology so the CPU nav, recovery intent and pass-through physics read any of them: a solid MAIN platform with real
 * ledge corners, and one-way RAISED platforms that straddle or flank it.
 */

import { STAGE_SLAB_ART, type StageSlabArt } from '@/content/arena/stageSlabs.generated';

export type StockStageId = 'foundry' | 'kiln' | 'cistern' | 'gallery';

/** A slab of real cells. `taper` narrows the underside below the deck (cells per row) so the body reads as a hull. */
export interface StockSlab {
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
  readonly depth: number;
  /** Rows of full-width deck before the underside begins to narrow. */
  readonly deck?: number;
  readonly taper?: number;
  /** Baked art ('foundry/main', scripts/arena-stages): its hull IS the slab's cells, its width and depth win. */
  readonly art?: string;
  /** Draw (and stamp) the art mirrored left-right: one side platform serves both sides. */
  readonly mirror?: boolean;
}

/** A slab whose geometry comes from its baked art: x0 and y place it, the art sizes it. */
function fromArt(key: string, x0: number, y: number, mirror = false): StockSlab {
  const a = STAGE_SLAB_ART[key];
  if (!a) throw new Error(`stock stage art '${key}' is not baked (scripts/arena-stages/bake-slab.mjs)`);
  return { x0, x1: x0 + a.width - 1, y, depth: a.depth, art: key, mirror };
}
/** The art behind a slab, if it has any. */
export function slabArt(slab: StockSlab): StageSlabArt | null {
  return slab.art ? STAGE_SLAB_ART[slab.art] ?? null : null;
}

export interface StockStageDef {
  readonly id: StockStageId;
  /** Display name ('The Foundry') and the lobby tile caption ('FOUNDRY'). */
  readonly name: string;
  readonly caption: string;
  readonly tagline: string;
  /** Knockout bounds: leaving this box costs a stock. */
  readonly zone: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly center: { readonly x: number; readonly y: number };
  readonly main: StockSlab;
  /** One-way raised platforms: rise through them, land on their surviving top cells. */
  readonly platforms: readonly StockSlab[];
  readonly spawns: readonly { readonly x: number; readonly y: number }[];
  /** Glass that really glows (Glowshroom cells in a metal housing), clear of every ascent column. */
  readonly lamps: readonly { readonly x: number; readonly y: number }[];
  /** Art under public/assets/arena/<id>/: the lobby thumbnail and the screen backdrop. */
  readonly thumbnail: string;
  readonly backdrop: string;
  /** CSS colour of the stage's identity (lobby tile focus ring). */
  readonly accent: string;
}

const art = (id: StockStageId, file: string): string => `assets/arena/${id}/${file}`;

const FOUNDRY: StockStageDef = {
  id: 'foundry', name: 'The Foundry', caption: 'FOUNDRY', tagline: 'Copper decks over a sleepless furnace.',
  zone: { left: 240, right: 1360, top: 180, bottom: 940 },
  center: { x: 800, y: 570 },
  // foundry-match.png: the raised platforms straddle the main platform's ends, 80 cells up (Brann's jump reaches it).
  main: fromArt('foundry/main', 560, 640),
  platforms: [fromArt('foundry/side', 480, 560), fromArt('foundry/side', 960, 560, true)],
  spawns: [{ x: 680, y: 639 }, { x: 920, y: 639 }],
  // Every lantern is baked art: hanging decor with real, soft, light-giving glass.
  lamps: [],
  thumbnail: art('foundry', 'thumb.webp'), backdrop: art('foundry', 'backdrop.webp'), accent: '#efac58',
};

const KILN: StockStageDef = {
  id: 'kiln', name: 'The Kiln', caption: 'KILN', tagline: 'Brick and slag above the firing pit.',
  zone: { left: 240, right: 1360, top: 180, bottom: 940 },
  center: { x: 800, y: 578 },
  // stages.png (Kiln): the ledges sit low and wide apart, only 40 cells up, their inner ends just over the main's ends.
  main: fromArt('kiln/main', 580, 648),
  platforms: [fromArt('kiln/side', 446, 608), fromArt('kiln/side', 1004, 608, true)],
  spawns: [{ x: 690, y: 647 }, { x: 910, y: 647 }],
  // The fire-lamps are baked hanging decor (warm glass: no Glowshroom, which glows teal).
  lamps: [],
  thumbnail: art('kiln', 'thumb.webp'), backdrop: art('kiln', 'backdrop.webp'), accent: '#ff7a36',
};

const CISTERN: StockStageDef = {
  id: 'cistern', name: 'The Cistern', caption: 'CISTERN', tagline: 'Brass walkways over the drowned works.',
  zone: { left: 240, right: 1360, top: 180, bottom: 940 },
  center: { x: 800, y: 580 },
  // stages.png (Cistern): the raised walkways stand at the outer ends, 70 cells up, overlapping the main's ends.
  main: fromArt('cistern/main', 570, 650),
  platforms: [fromArt('cistern/side', 441, 580), fromArt('cistern/side', 999, 580, true)],
  spawns: [{ x: 690, y: 649 }, { x: 910, y: 649 }],
  // Every lantern is baked art: hanging decor with real, soft, light-giving glass.
  lamps: [],
  thumbnail: art('cistern', 'thumb.webp'), backdrop: art('cistern', 'backdrop.webp'), accent: '#65cac5',
};

const GALLERY: StockStageDef = {
  id: 'gallery', name: 'The Gallery', caption: 'GALLERY', tagline: 'Pale stone, old vows, and the long drop.',
  zone: { left: 240, right: 1360, top: 180, bottom: 940 },
  center: { x: 800, y: 582 },
  // stages.png (Gallery): two side ledges 45 cells up over the main's ends, and a centred perch 78 up (rise beside it).
  main: fromArt('gallery/main', 580, 652),
  platforms: [
    fromArt('gallery/side', 490, 607), fromArt('gallery/side', 980, 607, true),
    fromArt('gallery/top', 740, 574),
  ],
  spawns: [{ x: 690, y: 651 }, { x: 910, y: 651 }],
  // The lanterns and the bell jar are baked hanging decor (warm and violet glass: no Glowshroom, which glows teal).
  lamps: [],
  thumbnail: art('gallery', 'thumb.webp'), backdrop: art('gallery', 'backdrop.webp'), accent: '#b49ae8',
};

export const STOCK_STAGES: Readonly<Record<StockStageId, StockStageDef>> = { foundry: FOUNDRY, kiln: KILN, cistern: CISTERN, gallery: GALLERY };
export const STOCK_STAGE_ORDER: readonly StockStageId[] = ['foundry', 'kiln', 'cistern', 'gallery'];
export const DEFAULT_STOCK_STAGE: StockStageId = 'foundry';

export function isStockStageId(id: unknown): id is StockStageId {
  return typeof id === 'string' && (STOCK_STAGE_ORDER as readonly string[]).includes(id);
}

/** The Foundry: the default stage, and the geometry the stage-agnostic tests and probes measure. */
export const STOCK_STAGE = FOUNDRY;

/**
 * Inclusive solid spans of one slab row, absolute cells, as [x0, x1, x0, x1, ...]. Baked art gives its hull's runs; a
 * plain slab is one span (the deck is full width; below it the hull narrows by `taper` per row).
 */
export function slabRuns(slab: StockSlab, y: number): readonly number[] {
  const art = slabArt(slab);
  if (art) {
    const row = art.runs[y - slab.y];
    if (!row) return [];
    const out: number[] = [];
    for (let k = 0; k < row.length; k += 2) {
      if (slab.mirror) out.push(slab.x0 + art.width - 1 - row[k + 1], slab.x0 + art.width - 1 - row[k]);
      else out.push(slab.x0 + row[k], slab.x0 + row[k + 1]);
    }
    return out;
  }
  const r = slabRow(slab, y);
  return r ? [r.x0, r.x1] : [];
}

/** Inclusive cell span of one plain slab row (the deck is full width; below it the hull narrows by `taper` per row). */
export function slabRow(slab: StockSlab, y: number): { x0: number; x1: number } | null {
  const dy = y - slab.y;
  if (dy < 0 || dy >= slab.depth) return null;
  const deck = slab.deck ?? 8, taper = slab.taper ?? 1.7;
  const inset = dy > deck ? Math.floor((dy - deck) * taper) : 0;
  return inset * 2 > slab.x1 - slab.x0 ? null : { x0: slab.x0 + inset, x1: slab.x1 - inset };
}

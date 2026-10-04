/**
 * The stock-match stages (docs/arena/platform-fighter/IMPLEMENTATION-PLAN.md, concepts/stages.png). All platforms are real
 * cells inside the world bounds; the blast box is fixed world coordinates the camera never moves. Every stage shares one
 * topology so the CPU nav, recovery intent and pass-through physics read any of them: a solid MAIN platform with real
 * ledge corners, and one-way RAISED platforms that straddle or flank it.
 */

import { WIDTH } from '@/config/constants';
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
  // foundry-match.png: the raised platforms straddle the main platform's ends, 56 cells up (the concept's ~2.4 fighters;
  // verify-stock-stationary: below 80 the CPU lands its finisher from the lip at 27-31 cells, around the probe's 30 bar).
  main: fromArt('foundry/main', 560, 640),
  platforms: [fromArt('foundry/side', 480, 584), fromArt('foundry/side', 960, 584, true)],
  spawns: [{ x: 680, y: 639 }, { x: 920, y: 639 }],
  // Every lantern is baked art: hanging decor with real, soft, light-giving glass (stockLampCells).
  lamps: [],
  thumbnail: art('foundry', 'thumb.webp'), backdrop: art('foundry', 'backdrop.webp'), accent: '#efac58',
};

const KILN: StockStageDef = {
  id: 'kiln', name: 'The Kiln', caption: 'KILN', tagline: 'Brick and slag above the firing pit.',
  zone: { left: 240, right: 1360, top: 180, bottom: 940 },
  center: { x: 800, y: 578 },
  // stages.png (Kiln): the ledges sit low and wide apart, 30 cells up, their inner lips just over the main's ends.
  main: fromArt('kiln/main', 590, 648),
  platforms: [fromArt('kiln/side', 444, 618), fromArt('kiln/side', 1006, 618, true)],
  spawns: [{ x: 690, y: 647 }, { x: 910, y: 647 }],
  // The fire-lamps are baked art: furnace-orange glass that lights in its own colour (stockLampCells).
  lamps: [],
  thumbnail: art('kiln', 'thumb.webp'), backdrop: art('kiln', 'backdrop.webp'), accent: '#ff7a36',
};

const CISTERN: StockStageDef = {
  id: 'cistern', name: 'The Cistern', caption: 'CISTERN', tagline: 'Brass walkways over the drowned works.',
  zone: { left: 240, right: 1360, top: 180, bottom: 940 },
  center: { x: 800, y: 580 },
  // stages.png (Cistern): the raised walkways stand at the outer ends, 40 cells up, overlapping the main's ends.
  main: fromArt('cistern/main', 570, 650),
  platforms: [fromArt('cistern/side', 441, 610), fromArt('cistern/side', 999, 610, true)],
  spawns: [{ x: 690, y: 649 }, { x: 910, y: 649 }],
  // Every lantern is baked art: hanging decor with real, soft, light-giving glass (stockLampCells).
  lamps: [],
  thumbnail: art('cistern', 'thumb.webp'), backdrop: art('cistern', 'backdrop.webp'), accent: '#65cac5',
};

const GALLERY: StockStageDef = {
  id: 'gallery', name: 'The Gallery', caption: 'GALLERY', tagline: 'Pale stone, old vows, and the long drop.',
  zone: { left: 240, right: 1360, top: 180, bottom: 940 },
  center: { x: 800, y: 582 },
  // stages.png (Gallery): two side ledges 42 cells up over the main's ends, and a centred perch 78 up (rise beside it).
  main: fromArt('gallery/main', 580, 652),
  platforms: [
    fromArt('gallery/side', 490, 610), fromArt('gallery/side', 980, 610, true),
    fromArt('gallery/top', 740, 574),
  ],
  spawns: [{ x: 690, y: 651 }, { x: 910, y: 651 }],
  // The amber lanterns and the violet bell jar are baked art whose glass lights in its own colour (stockLampCells).
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

/**
 * Every lamp's glass on a stage, as world cells: where the glass is (real Glowshroom, stamped by world/stockStage), the
 * hull cell it hangs from (the first hull cell straight above it, or the lamp's own metal shell), the colour of its
 * light (the glass's own, brightest channel 1) and the lantern it belongs to. A lamp lights only while its glass stands
 * AND its anchor is Metal: knock the hull away and the lantern goes dark with its hangings (render/Lighting).
 */
export interface StockLampCells {
  readonly cells: Int32Array;
  readonly anchors: Int32Array;
  readonly rgb: Float32Array;
  /** The lantern each glass cell belongs to (glass within LANTERN_REACH cells): one lantern flickers as one flame. */
  readonly lamp: Int32Array;
  /** How each lantern lives (stockLampLevel), by lantern. */
  readonly life: readonly StockLampLife[];
  /** World index -> slot in `cells`, so the light seeding can tell a lamp's glass from any other Glowshroom. */
  readonly index: ReadonlyMap<number, number>;
}

/**
 * A lantern's life (Duel direction: "fast-paced, adrenaline-pumping arcade", the lamps alive): the Foundry's teal glass
 * PULSES like a charged cell, the Kiln's fire-lamps FLICKER and gutter, the Cistern's lamps SHIMMER as if seen through
 * water, the Gallery's amber lanterns burn like CANDLES and its violet bell jar BREATHES.
 */
export type StockLampLife = 'pulse' | 'flicker' | 'shimmer' | 'candle' | 'breathe';

const TEAL: readonly [number, number, number] = [101, 202, 197];
/** Panes of one lantern sit at most this many cells apart; two lanterns, scores of cells. */
const LANTERN_REACH = 4;
const lampCache = new Map<StockStageId, StockLampCells>();

export function stockLampCells(stage: StockStageDef): StockLampCells {
  const hit = lampCache.get(stage.id);
  if (hit) return hit;
  const cells: number[] = [], anchors: number[] = [], rgb: number[] = [];
  const add = (x: number, y: number, ax: number, ay: number, c: readonly [number, number, number]): void => {
    const top = Math.max(1, c[0], c[1], c[2]);
    cells.push(x + y * WIDTH); anchors.push(ax + ay * WIDTH); rgb.push(c[0] / top, c[1] / top, c[2] / top);
  };
  for (const slab of [stage.main, ...stage.platforms]) {
    const art = slabArt(slab);
    if (!art) continue;
    const solidAt = (cx: number, cy: number): boolean => {
      const row = art.runs[cy];
      if (!row) return false;
      for (let k = 0; k < row.length; k += 2) if (cx >= row[k] && cx <= row[k + 1]) return true;
      return false;
    };
    for (const [gx, gy] of art.glass) {
      let ay = gy - 1;
      while (ay > 0 && !solidAt(gx, ay)) ay--;
      const wx = (cx: number): number => slab.mirror ? slab.x0 + art.width - 1 - cx : slab.x0 + cx;
      add(wx(gx), slab.y + gy, wx(gx), slab.y + Math.max(0, ay), art.glassColor ?? TEAL);
    }
  }
  for (const lamp of stage.lamps) for (let y = lamp.y; y <= lamp.y + 3; y++) for (let x = lamp.x - 1; x <= lamp.x + 1; x++) add(x, y, lamp.x, lamp.y - 1, TEAL);
  const index = new Map(cells.map((c, k) => [c, k]));
  // Lanterns: glass within LANTERN_REACH cells of glass (a lantern's frame bars split its glass into panes).
  const lamp = new Int32Array(cells.length).fill(-1), life: StockLampLife[] = [];
  for (let s0 = 0; s0 < cells.length; s0++) {
    if (lamp[s0] >= 0) continue;
    const id = life.length, st = [s0]; lamp[s0] = id;
    while (st.length) {
      const k = st.pop()!, x = cells[k] % WIDTH, y = (cells[k] - x) / WIDTH;
      for (let dy = -LANTERN_REACH; dy <= LANTERN_REACH; dy++) for (let dx = -LANTERN_REACH; dx <= LANTERN_REACH; dx++) {
        const j = index.get(x + dx + (y + dy) * WIDTH);
        if (j !== undefined && lamp[j] < 0) { lamp[j] = id; st.push(j); }
      }
    }
    const violet = rgb[s0 * 3 + 2] > rgb[s0 * 3 + 1] && rgb[s0 * 3] > rgb[s0 * 3 + 1];
    life.push(stage.id === 'kiln' ? 'flicker' : stage.id === 'cistern' ? 'shimmer' : stage.id === 'gallery' ? (violet ? 'breathe' : 'candle') : 'pulse');
  }
  const out: StockLampCells = { cells: Int32Array.from(cells), anchors: Int32Array.from(anchors), rgb: Float32Array.from(rgb), lamp, life, index };
  lampCache.set(stage.id, out);
  return out;
}

/** A small deterministic hash in [0, 1): the same tick shows the same flame on every machine. */
function lampHash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * How bright a lantern is at `tick` (60 Hz game ticks), 0.4..1 of its full light: the lamp's light (render/Lighting)
 * and its glass (render/StockStageArt) both follow it, so the flame you see is the light you get. Never above 1: the
 * glass is authored under the bloom threshold and stays there.
 */
export function stockLampLevel(lamps: StockLampCells, slot: number, tick: number): number {
  const id = lamps.lamp[slot], t = tick / 60, phase = id * 2.39996;
  let v: number;
  switch (lamps.life[id]) {
    case 'flicker': {
      // Fire: two quick waves, a fresh jitter every 3 ticks, and now and then a gutter that drops the flame low.
      const jitter = lampHash(Math.floor(tick / 3), id) - 0.5;
      const gutter = lampHash(Math.floor(tick / 18), id + 101) < 0.1 ? 0.62 : 1;
      v = (0.8 + 0.1 * Math.sin(t * 9.7 + phase) + 0.06 * Math.sin(t * 23.3 + phase * 1.7) + 0.18 * jitter) * gutter;
      break;
    }
    case 'pulse': {
      // A charged cell's beat: a quick swell and a slower fall, about 1.1 per second, each lamp a little behind the last.
      const c = (t * 1.1 + id * 0.17) % 1;
      v = 0.5 + 0.5 * (c < 0.25 ? c / 0.25 : Math.pow(1 - (c - 0.25) / 0.75, 1.6));
      break;
    }
    case 'shimmer':
      v = 0.8 + 0.12 * Math.sin(t * 3.1 + phase) + 0.08 * Math.sin(t * 7.9 + phase * 1.3);
      break;
    case 'candle': {
      const jitter = lampHash(Math.floor(tick / 5), id) - 0.5;
      v = 0.85 + 0.07 * Math.sin(t * 6.3 + phase) + 0.04 * Math.sin(t * 14.9 + phase * 2) + 0.08 * jitter;
      break;
    }
    default:
      v = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * Math.PI * 0.7 + phase));
  }
  return Math.max(0.4, Math.min(1, v));
}

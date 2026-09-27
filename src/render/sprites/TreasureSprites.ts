import type { LightField, PixelSurface } from '@/render/pixels';
import { Pen, type RGB, type ViewRect } from '@/render/sprites/FineArt';

/**
 * Treasure pickups drawn at presentation resolution.
 *
 * The gold pile used to be a flat five-cell bar over two dots: a tan
 * trapezoid that bobbed like a glyph. It now sits on the ground as a small
 * heap of coins — lit from the upper left, stacked rims, a shadowed foot —
 * with one coin turning on the crown and a glint that travels across the
 * face, so it reads as metal, not as a yellow block. Overlay pixels only.
 */

const GOLD_LIGHT: RGB = [1.0, 0.88, 0.5];
const GOLD: RGB = [0.9, 0.66, 0.2];
const GOLD_MID: RGB = [0.74, 0.5, 0.13];
const GOLD_DARK: RGB = [0.46, 0.29, 0.07];
const GOLD_FOOT: RGB = [0.22, 0.14, 0.05];
const GLINT: RGB = [1.0, 0.97, 0.82];

/** Heap rows from the crown down, as half-widths in fine pixels. */
const HEAP_ROWS = [1, 2, 3, 4, 5, 6, 7] as const;

export function drawGoldPile(
  out: PixelSurface,
  light: LightField,
  view: ViewRect,
  wx: number,
  wy: number,
  frame: number,
  seed: number,
): void {
  const sample = light.sample(wx, wy - 1);
  // A treasure tell: never swallowed by the dark (coin metal keeps its own
  // warmth), a little brighter where the scene's light actually falls.
  const lit: RGB = [Math.min(1.15, Math.max(0.9, sample.r)), Math.min(1.1, Math.max(0.86, sample.g)), Math.min(1.05, Math.max(0.78, sample.b))];
  const pen = new Pen(out, view, lit);
  const f = pen.step < 1 ? pen.step : 1; // one fine pixel in cells
  const baseX = Math.round(wx);
  const baseY = Math.floor(wy) + 1 - f; // the foot row sits on the ground below the resting cell
  const rows = HEAP_ROWS.length;
  const lean = (seed & 1) === 0 ? -1 : 1; // piles slump one way or the other
  // Travelling glint: sweeps the heap every ~2.5 s, offset per pile.
  const sweep = (frame + seed * 37) % 150;
  const glintCol = sweep < 24 ? Math.round((sweep / 24) * 14 - 7) : 99;
  for (let r = 0; r < rows; r++) {
    const half = HEAP_ROWS[r];
    const shift = r < 3 ? lean : 0; // the crown sits off-centre
    const y = baseY - (rows - 1 - r) * f;
    for (let c = -half; c < half; c++) {
      const col = c + shift;
      const x = baseX + (col + 0.5) * f;
      const edge = c === -half || c === half - 1;
      // Upper-left faces catch the light; the right flank and foot fall off.
      let color: RGB = c < -half + 2 ? GOLD_LIGHT : c >= half - 2 ? GOLD_MID : GOLD;
      if (r === rows - 1) color = edge ? GOLD_FOOT : GOLD_DARK;
      else if (edge && c > 0) color = GOLD_DARK;
      else if (((c * 5 + r * 3 + seed) % 7 + 7) % 7 === 0) color = GOLD_LIGHT; // a coin face catching light
      else if (r > 0 && (((c * 5 + (r - 1) * 3 + seed) % 7 + 7) % 7 === 0)) color = GOLD_DARK; // that coin's rim shadow
      pen.px(x, y, color);
      if (col === glintCol && r < rows - 1 && r > 0) pen.raw(x, y, GLINT, 0.95);
    }
  }
  // Two coins spilled at the foot.
  const footY = baseY;
  pen.px(baseX + (-HEAP_ROWS[rows - 1] - 1.5) * f, footY, GOLD);
  pen.px(baseX + (HEAP_ROWS[rows - 1] + 1.5) * f, footY, GOLD_MID);
  // One coin turning on the crown: full face, edge-on, face again.
  const turn = (frame + seed * 13) % 48;
  const crownX = baseX + lean * f;
  const crownY = baseY - rows * f;
  if (turn < 36) {
    pen.px(crownX - 0.5 * f, crownY, GOLD_LIGHT);
    pen.px(crownX + 0.5 * f, crownY, GOLD);
  } else {
    pen.px(crownX, crownY, GOLD_MID);
  }
  if (turn === 0 || turn === 1) pen.glow(crownX - 0.5 * f, crownY - f, GLINT, 0.35);
}

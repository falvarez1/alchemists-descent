import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import type { KitPalette, Rgb } from '@/config/depthKits';
import { basalt, chain, gear, kelp, mushroom, root, type Rand } from '@/render/depth/motifs';
import { framingAnchor } from '@/render/depth/parallax';
import { type Bitmap, MaskPlane, type Material, mixRgb, rng, shade } from '@/render/depth/raster';

/**
 * The foreground occluder plane: near-black silhouettes that pass IN FRONT
 * of the play layer (parallax > 1) and frame the view — chains, pipes,
 * girders, stalks, kelp, basalt. Unlike the background planes it does not
 * tile: it covers the whole level in plane space, so pieces are placed once
 * (floor 1 at authored spots that frame its rooms; generated floors on a
 * jittered grid). The quad that draws it fades every piece away from the
 * screen centre and from anything the player must read (render/depth/reveal).
 */

export type ForegroundBuilder = (p: MaskPlane, r: Rand, palette: KitPalette, place: Placer) => void;

/** Converts cells to foreground texels and exposes the authored framing helper. */
export interface Placer {
  readonly scale: number;
  readonly parallax: number;
  /** Texel x for a piece at screen-x `sx` (cells) when the camera frames world-x `fx`. */
  frameX(fx: number, sx: number): number;
  frameY(fy: number, sy: number): number;
  /** Cells → texels. */
  t(cells: number): number;
}

const M_BODY = 1, M_DETAIL = 2;
const between = (r: Rand, a: number, b: number): number => a + (b - a) * r();

/* ------------------------------ pieces ------------------------------ */

/** A heavy chain (face links 5 texels wide) hanging `len` texels from y0, ending in a hook. */
function heavyChain(p: MaskPlane, x: number, y0: number, len: number): void {
  chain(p, x, y0, len, M_BODY, 2);
  const hy = y0 + len + 2;
  p.ring(x + 3, hy + 6, 3.5, 6, M_BODY, 0);
  for (let yy = 0; yy < 7; yy++) p.clear(x - 4 + yy, hy + 1 + (yy >> 1));
}

/** A vertical pipe from y0 to y1 with flanges, a valve wheel and an elbow off the top. */
function pipe(p: MaskPlane, x: number, y0: number, y1: number, w: number, valve: boolean): void {
  p.vBar(x, y0, y1 - y0, w, M_BODY, 40);
  for (let y = y0 + 18; y < y1; y += 46) p.hBar(x - 2, y, w + 4, 4, M_DETAIL, 20);
  // The run turns off sideways at the top, with a flange at the joint.
  p.hBar(x, y0, w * 5, w, M_BODY, 40);
  p.vBar(x + w + 4, y0 - 2, w + 4, 4, M_DETAIL, 20);
  if (valve) {
    const vy = Math.round(y0 + (y1 - y0) * 0.55);
    p.rect(x + w, vy - 1, 6, 3, M_BODY, 0);
    gear(p, x + w + 12, vy, 9, 0, 4, M_DETAIL);
  }
}

/** A diagonal or level girder between two points. */
function beam(p: MaskPlane, x0: number, y0: number, x1: number, y1: number, depth: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
  p.line(x0, y0, x1, y1, 3, M_BODY, 16);
  p.line(x0 + nx * depth, y0 + ny * depth, x1 + nx * depth, y1 + ny * depth, 3, M_BODY, -10);
  const n = Math.max(2, Math.round(len / 12));
  for (let k = 0; k < n; k++) {
    const a = k / n, b = (k + 1) / n;
    const ax = x0 + (x1 - x0) * a, ay = y0 + (y1 - y0) * a;
    const bx = x0 + (x1 - x0) * b, by = y0 + (y1 - y0) * b;
    p.line(ax, ay, bx + nx * depth, by + ny * depth, 2, M_BODY, 0);
    p.line(ax, ay, ax + nx * depth, ay + ny * depth, 2, M_BODY, 4);
  }
}

/** A broken masonry column rising from `baseY`. */
function brokenColumn(p: MaskPlane, r: Rand, x: number, baseY: number, h: number, w: number): void {
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    const u = (xx / (w - 1)) * 2 - 1;
    const flute = xx % 5 === 0 ? -20 : 0;
    p.set(x + xx, baseY - y, M_BODY, (0.3 - u) * 30 + flute);
  }
  p.hBar(x - 4, baseY - 6, w + 8, 6, M_BODY, 10);
  // Jagged break at the top.
  for (let xx = 0; xx < w; xx++) {
    const bite = Math.round(between(r, 0, 12) + (xx / w) * 10);
    for (let y = 0; y < bite; y++) p.clear(x + xx, baseY - h + y);
  }
}

/** A mushroom stalk seen too close: a thick stem with the cap's underside at the top. */
function nearStalk(p: MaskPlane, r: Rand, x: number, baseY: number, h: number): void {
  // Seen too close to be tidy: a thick fibrous stem and the cap's broad underside.
  mushroom(p, r, x, baseY, h, Math.round(between(r, 120, 170)), M_BODY, M_BODY, M_DETAIL);
  for (let k = 0; k < 3; k++) root(p, r, x + Math.round(between(r, -14, 14)), baseY - Math.round(h * between(r, 0.3, 0.7)), Math.round(between(r, 20, 50)), 3, M_BODY);
}

/** A curtain of hanging roots. */
function rootCurtain(p: MaskPlane, r: Rand, x: number, y: number, n: number): void {
  for (let j = 0; j < n; j++) root(p, r, x + j * Math.round(between(r, 5, 10)), y, Math.round(between(r, 50, 150)), between(r, 3, 6), M_BODY);
  p.hBar(x - 6, y - 4, n * 8 + 12, 6, M_BODY, 6);
}

function kelpCluster(p: MaskPlane, r: Rand, x: number, baseY: number, n: number): void {
  for (let j = 0; j < n; j++) kelp(p, r, x + j * Math.round(between(r, 5, 9)), baseY, Math.round(between(r, 70, 170)), M_BODY);
}

function basaltCluster(p: MaskPlane, r: Rand, x: number, baseY: number, n: number): void {
  for (let j = 0; j < n; j++) basalt(p, r, x + j * 15, 14, baseY - Math.round(between(r, 90, 220)), baseY + 40, M_BODY);
}

function crucible(p: MaskPlane, x: number, y0: number, len: number): void {
  heavyChain(p, x, y0, len);
  const y = y0 + len + 8;
  p.poly([[x - 16, y], [x + 16, y], [x + 11, y + 22], [x - 11, y + 22]], M_BODY, 10);
  p.hBar(x - 18, y - 2, 37, 3, M_DETAIL, 20);
}

/* ------------------------------ builders ---------------------------- */

type Piece = (p: MaskPlane, r: Rand, x: number, y: number) => void;

/** Generated floors: a jittered grid, roughly one piece per screen, alternating hanging and rising pieces. */
function scatter(p: MaskPlane, r: Rand, place: Placer, hanging: readonly Piece[], rising: readonly Piece[]): void {
  const stepX = place.t(VIEW_W * 0.72), stepY = place.t(VIEW_H * 1.05);
  let row = 0;
  for (let y = place.t(40); y < p.height; y += stepY, row++) {
    for (let x = (row & 1) * stepX * 0.5; x < p.width; x += stepX) {
      if (r() < 0.2) continue;
      const px = Math.round(x + between(r, -0.25, 0.25) * stepX);
      const py = Math.round(y + between(r, -0.2, 0.2) * stepY);
      const list = r() < 0.55 ? hanging : rising;
      list[Math.floor(r() * list.length)](p, r, px, py);
    }
  }
}

const hangChain: Piece = (p, r, x, y) => heavyChain(p, x, y, Math.round(between(r, 60, 150)));
const hangChains: Piece = (p, r, x, y) => { heavyChain(p, x, y, Math.round(between(r, 50, 120))); heavyChain(p, x + Math.round(between(r, 14, 26)), y - 10, Math.round(between(r, 70, 150))); };

function bellowsFg(p: MaskPlane, r: Rand, _pal: KitPalette, place: Placer, levelId: string | null): void {
  if (levelId !== 'd1') {
    scatter(p, r, place, [hangChain, hangChains, (pp, rr, x, y) => beam(pp, x, y, x + place.t(220), y + place.t(between(rr, -30, 30)), 8)],
      [(pp, rr, x, y) => pipe(pp, x, y - place.t(160), y + place.t(200), 16, rr() < 0.5), (pp, _rr, x, y) => gear(pp, x, y, 42, 16, 6, M_BODY)]);
    return;
  }
  // FLOOR 1, authored: each piece frames a room when the camera follows the
  // player across it (focus = the room floor, less the player's half height).
  const at = (fx: number, fy: number, sx: number, sy: number): [number, number] => [place.frameX(fx, sx), place.frameY(fy, sy)];
  // The Intake: a riser pipe with its valve down the left edge (its right
  // side holds the barricade, the lever and the engine's first fuse: kept clear).
  {
    const [x, y] = at(280, 305, 12, -20);
    pipe(p, x, y, y + place.t(250), 18, true);
  }
  // The engine hall: great gears rising in the lower corners, under the
  // catwalk. Nothing hangs into the hall: the machine is played, not watched.
  {
    const [gx, gy] = at(760, 305, 30, 350);
    gear(p, gx, gy, place.t(68), 22, 6, M_BODY);
    const [hx, hy] = at(1250, 305, 616, 356);
    gear(p, hx, hy, place.t(54), 18, 5, M_BODY);
  }
  // The Breathing Chamber: a trunk main down the right edge, a gear at its foot.
  {
    const [x, y] = at(1290, 720, 606, -30);
    pipe(p, x, y, y + place.t(300), 20, false);
    const [gx, gy] = at(1290, 720, 70, 372);
    gear(p, gx, gy, place.t(46), 16, 5, M_BODY);
  }
  // The Silt Garden: roots hang from the garden's ceiling in the top-left.
  {
    const [x, y] = at(400, 815, 20, 0);
    rootCurtain(p, r, x, y, 7);
  }
  // The Warm Refuge: a lamp chain at the top edge.
  {
    const [x, y] = at(860, 750, 560, -8);
    heavyChain(p, x, y, place.t(90));
  }
  // The Lower Bell: a gear and a chain, bottom-right and top-left.
  {
    const [gx, gy] = at(1230, 1000, 612, 360);
    gear(p, gx, gy, place.t(60), 20, 6, M_BODY);
    const [cx, cy] = at(1230, 1000, 40, -10);
    heavyChain(p, cx, cy, place.t(130));
  }
  // The Undertow is dark: only stalactite-like roots at its roof.
  {
    const [x, y] = at(620, 1000, 470, 0);
    rootCurtain(p, r, x, y, 5);
  }
}

function rotFg(p: MaskPlane, r: Rand, _pal: KitPalette, place: Placer): void {
  scatter(p, r, place,
    [(pp, rr, x, y) => rootCurtain(pp, rr, x, y, Math.round(between(rr, 4, 8))), hangChain],
    [(pp, rr, x, y) => nearStalk(pp, rr, x, y + place.t(160), place.t(between(rr, 200, 320))),
      (pp, rr, x, y) => nearStalk(pp, rr, x, y + place.t(120), place.t(between(rr, 140, 220)))]);
}

function cisternFg(p: MaskPlane, r: Rand, _pal: KitPalette, place: Placer): void {
  scatter(p, r, place,
    [hangChain, hangChains],
    [(pp, rr, x, y) => kelpCluster(pp, rr, x, y + place.t(150), Math.round(between(rr, 4, 8))),
      (pp, rr, x, y) => brokenColumn(pp, rr, x, y + place.t(160), place.t(between(rr, 120, 240)), Math.round(between(rr, 24, 34)))]);
}

function kilnFg(p: MaskPlane, r: Rand, _pal: KitPalette, place: Placer): void {
  scatter(p, r, place,
    [(pp, rr, x, y) => crucible(pp, x, y, Math.round(between(rr, 50, 120))), hangChain],
    [(pp, rr, x, y) => basaltCluster(pp, rr, x, y + place.t(160), Math.round(between(rr, 2, 4)))]);
}

function genericFg(p: MaskPlane, r: Rand, _pal: KitPalette, place: Placer): void {
  scatter(p, r, place, [hangChain, hangChains],
    [(pp, rr, x, y) => brokenColumn(pp, rr, x, y + place.t(160), place.t(between(rr, 120, 220)), 26)]);
}

const FOREGROUND_ART: Readonly<Record<string, (p: MaskPlane, r: Rand, pal: KitPalette, place: Placer, levelId: string | null) => void>> = {
  'bellows-fg': bellowsFg,
  'rot-fg': rotFg,
  'cistern-fg': cisternFg,
  'kiln-fg': kilnFg,
  'generic-fg': genericFg,
};

function fgMaterials(pal: KitPalette): (Material | null)[] {
  const body: Rgb = pal.fg;
  const detail: Rgb = mixRgb(pal.fg, pal.fgRim, 0.25);
  return [
    null,
    { base: body, rim: pal.fgRim, shade: body },
    { base: detail, rim: pal.fgRim, shade: body },
  ];
}

/**
 * Bake a level's foreground: a non-tiling bitmap covering `planeW`×`planeH`
 * cells at `scale` cells per texel. `parallax` must match the kit's.
 */
export function buildForegroundArt(art: string, palette: KitPalette, planeW: number, planeH: number, scale: number, seed: number,
  levelId: string | null, parallax = 1.4): Bitmap {
  const w = Math.ceil(planeW / scale), h = Math.ceil(planeH / scale);
  const p = new MaskPlane(w, h, false);
  const r = rng(seed);
  const place: Placer = {
    scale,
    parallax,
    frameX: (fx, sx) => Math.round(framingAnchor(fx, sx, VIEW_W, WIDTH, parallax) / scale),
    frameY: (fy, sy) => Math.round(framingAnchor(fy, sy, VIEW_H, HEIGHT, parallax) / scale),
    t: (cells) => Math.round(cells / scale),
  };
  (FOREGROUND_ART[art] ?? genericFg)(p, r, palette, place, levelId);
  return shade(p, { materials: fgMaterials(palette), light: palette.light, grain: 2, seed });
}

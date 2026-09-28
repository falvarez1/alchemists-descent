import type { KitLight, KitPalette, Rgb } from '@/config/depthKits';
import {
  arcade, arch, basalt, bellows, chain, chimney, coilBank, displayCase, gear, girder, grate, hangingPrism, hookRail, hPipe, kelp,
  lensRack, lightPool, mushroom, pipeColumn, pressureStack, root, shaft, stalactites, statue, tank, type Rand,
} from '@/render/depth/motifs';
import {
  M_ACCENT, M_BODY, M_GLOW, M_SOFT, M_TINT, type SilhouetteOptions, lightField, paintLight, paintSilhouettes, paletteRamp, rampColor,
} from '@/render/depth/lightArt';
import { type Bitmap, MaskPlane, rng, smoothstep, tileFbm } from '@/render/depth/raster';

/**
 * The procedural depth-plane art, by id (config/depthKits names them).
 *
 * Every kit is painted as LIT SILHOUETTES (render/depth/lightArt): the far
 * plane is the kit's light itself — a furnace core, light wells from above,
 * spore pools — through the kit's restrained ramp; every nearer plane is
 * nearly flat silhouettes that step DOWN the ramp toward the viewer, veiled
 * by the light behind them and rimmed where it wraps their edges. Value does
 * the depth; texture only whispers.
 *
 * Builders are deterministic in (palette, size, seed) and tile: planes wrap
 * under the compositors' repeat sampling. Far planes barely scroll vertically
 * (parallax ≤ 0.14 moves them ≤ ~100 cells over a whole level), so their rows
 * map almost directly to the screen: a kit's light sits where the screen
 * needs it (the Kiln's furnace low, the Cisterns' wells high).
 */

export type PlaneArtBuilder = (palette: KitPalette, width: number, height: number, seed: number) => Bitmap;

const between = (r: Rand, a: number, b: number): number => a + (b - a) * r();

/** A kit's light when its palette names none: a soft band with two gentle pools. */
const DEFAULT_LIGHT: KitLight = {
  rows: [[0, 0.06], [0.45, 0.2], [0.7, 0.16], [1, 0.06]],
  cores: [{ x: 0.3, y: 0.5, rx: 0.22, ry: 0.3, k: 0.55 }, { x: 0.75, y: 0.45, rx: 0.16, ry: 0.26, k: 0.45 }],
  falloff: 1.6,
  smoke: 0.35,
  smokeCell: 70,
};

/** Evenly spread x positions with jitter: `n` slots across a tiling width. */
function slots(r: Rand, width: number, n: number, jitter = 0.35): number[] {
  const step = width / n;
  return Array.from({ length: n }, (_, i) => Math.round(i * step + (r() - 0.5) * step * jitter));
}

interface Painter {
  readonly ramp: readonly (readonly [number, Rgb])[];
  readonly field: Float32Array;
  paint(p: MaskPlane, o: Partial<SilhouetteOptions> & Pick<SilhouetteOptions, 'value' | 'veil' | 'rim'>): Bitmap;
  /** The light itself (an opaque far plane), scaled. */
  light(scale?: number): Bitmap;
}

function painter(pal: KitPalette, w: number, h: number, seed: number): Painter {
  const ramp = paletteRamp(pal);
  const field = lightField(w, h, pal.lightField ?? DEFAULT_LIGHT, seed);
  return {
    ramp,
    field,
    paint: (p, o) => paintSilhouettes(p, {
      ramp, field, rimDir: [pal.light[0], pal.light[1]], glow: pal.glow, soft: pal.shaft, ...o,
    }),
    light: (scale = 1) => paintLight(w, h, field, ramp, scale),
  };
}

/** A lattice tower: two chords with X bracing, full height (tiles vertically). */
function latticeTower(p: MaskPlane, x: number, w: number, m: number): void {
  p.vBar(x, 0, p.height, 2, m, 10);
  p.vBar(x + w, 0, p.height, 2, m, -10);
  for (let y = 0; y < p.height; y += w) {
    p.line(x + 1, y, x + w, y + w, 1, m, 0);
    p.line(x + w, y, x + 1, y + w, 1, m, -6);
    p.hBar(x, y, w + 2, 1, m, 6);
  }
}

/** Soft rising-heat (or falling-light) columns: streaky blobs inside a wavering band; tiles in y. */
function softColumns(p: MaskPlane, r: Rand, n: number, halfW: readonly [number, number], amp: readonly [number, number], seed: number): void {
  const { width: w, height: h } = p;
  for (let k = 0; k < n; k++) {
    const cx = r() * w, half = between(r, halfW[0], halfW[1]), phase = r() * Math.PI * 2, a = between(r, amp[0], amp[1]);
    for (let y = 0; y < h; y++) {
      const wob = Math.sin((y / h) * Math.PI * 4 + phase) * 6 + Math.sin((y / h) * Math.PI * 10 + phase * 2) * 2.5;
      for (let dx = -Math.ceil(half); dx <= half; dx++) {
        const u = Math.abs(dx) / half;
        if (u >= 1) continue;
        const blob = smoothstep(0.4, 0.8, tileFbm(cx + dx, y, 20, w, h, seed + k * 17));
        const c = a * (1 - u * u) * (0.3 + 0.7 * blob);
        if (c > 0.012) p.soft(Math.round(cx + wob + dx), y, M_SOFT, c);
      }
    }
  }
}

/* =========================== THE BELLOWS =========================== */

function bellowsHall(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  const xs = slots(r, w, 6, 0.4);
  for (let i = 0; i < xs.length; i++) {
    if (i % 3 === 2) latticeTower(p, xs[i], Math.round(between(r, 16, 24)), M_BODY);
    else pressureStack(p, xs[i], Math.round(between(r, 28, 46)), M_BODY, M_GLOW, r);
  }
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] + 40, b = (i + 1 < xs.length ? xs[i + 1] : xs[0] + w) - 4;
    if (r() < 0.6) {
      const y = Math.round(between(r, 0.15, 0.85) * h);
      girder(p, a, b, y, 7, M_BODY);
      if (r() < 0.6) chain(p, Math.round(between(r, a + 8, b - 8)), y + 9, Math.round(between(r, 30, 90)), M_BODY);
    }
    for (let k = 0; k < 2; k++) hPipe(p, a - 20, b, Math.round(between(r, 0.08, 0.92) * h), Math.round(between(r, 4, 7)), M_ACCENT);
  }
  // Hazy, not black: the engine hall's rods and frames must still read against it.
  return painter(pal, w, h, seed).paint(p, { value: 0.3, veil: 0.3, rim: 0.28, accent: { color: pal.accent, mix: 0.45 },
    glow: [pal.glow[0] * 0.55, pal.glow[1] * 0.55, pal.glow[2] * 0.55] });
}

function bellowsShafts(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // High grates between the hall's stacks (same plane speed and size: they line up).
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 6; k++) {
    shaft(p, M_SOFT, Math.round(r() * w), Math.round(between(r, 0.02, 0.4) * h), Math.round(between(r, 200, 320)), Math.round(between(r, 12, 30)),
      between(r, 0.1, 0.24), between(r, 0.28, 0.42), Math.round(r() * 100));
  }
  return painter(pal, w, h, seed).paint(p, { value: 0, veil: 0, rim: 0 });
}

function bellowsNear(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  pipeColumn(p, Math.round(w * 0.08), 16, M_BODY, r, M_ACCENT);
  pipeColumn(p, Math.round(w * 0.63), 12, M_BODY, r, M_ACCENT);
  const gy = Math.round(h * 0.2);
  girder(p, Math.round(w * 0.14), Math.round(w * 0.46), gy, 10, M_BODY);
  for (let k = 0; k < 3; k++) chain(p, Math.round(w * (0.18 + k * 0.1) + between(r, -8, 8)), gy + 12, Math.round(between(r, 60, 200)), M_BODY, 2);
  gear(p, Math.round(w * 0.12), Math.round(h * 0.64), 56, 18, 6, M_BODY);
  gear(p, Math.round(w * 0.7), Math.round(h * 0.42), 34, 12, 5, M_ACCENT);
  bellows(p, Math.round(w * 0.85), Math.round(h * 0.72), 96, 104, M_ACCENT);
  chain(p, Math.round(w * 0.85) - 30, 0, Math.round(h * 0.72) - 58, M_BODY, 2);
  chain(p, Math.round(w * 0.85) + 30, 0, Math.round(h * 0.72) - 58, M_BODY, 2);
  hPipe(p, Math.round(w * 0.3), Math.round(w * 0.7), Math.round(h * 0.9), 10, M_ACCENT);
  return painter(pal, w, h, seed).paint(p, { value: 0.07, veil: 0.12, rim: 0.5, accent: { color: pal.accent, mix: 0.6 }, tone: 0.2 });
}

/* ========================== THE ROT GARDENS ========================= */

function rotFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const P = painter(pal, w, h, seed);
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 5, 0.6)) {
    mushroom(p, r, x, Math.round(h * between(r, 0.7, 0.84)), Math.round(between(r, 200, 320)), Math.round(between(r, 120, 210)), M_BODY, M_BODY, M_GLOW);
  }
  return P.paint(p, { base: P.light(), value: 0.16, veil: 0.45, rim: 0.25 });
}

function rotStalksFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 6, 0.6)) {
    mushroom(p, r, x, Math.round(r() * h), Math.round(between(r, 200, 420)), Math.round(between(r, 90, 180)), M_BODY, M_ACCENT, M_GLOW);
  }
  for (let k = 0; k < 8; k++) root(p, r, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 60, 200)), between(r, 2, 4), M_BODY);
  return painter(pal, w, h, seed).paint(p, { value: 0.1, veil: 0.32, rim: 0.45, accent: { color: pal.accent, mix: 0.4 } });
}

function rotShafts(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 6; k++) {
    shaft(p, M_SOFT, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 260, 420)), Math.round(between(r, 26, 56)), between(r, -0.08, 0.08),
      between(r, 0.2, 0.32), Math.round(r() * 100));
  }
  return painter(pal, w, h, seed).paint(p, { value: 0, veil: 0, rim: 0 });
}

function rotMid(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 5, 0.7)) {
    const baseY = Math.round(r() * h);
    mushroom(p, r, x, baseY, Math.round(between(r, 120, 250)), Math.round(between(r, 60, 124)), M_BODY, M_ACCENT, M_GLOW);
    for (let k = 0; k < 3; k++) {
      const sy = baseY - Math.round(between(r, 20, 90));
      const side = r() < 0.5 ? -1 : 1;
      for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 13 - yy * 3; xx++) p.set(x + side * (4 + xx), sy + yy, M_ACCENT, 20 - yy * 12);
    }
  }
  for (let k = 0; k < 9; k++) root(p, r, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 50, 170)), between(r, 2, 4), M_BODY);
  return painter(pal, w, h, seed).paint(p, { value: 0.05, veil: 0.15, rim: 0.55, accent: { color: pal.accent, mix: 0.5 } });
}

function rotNear(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of [Math.round(w * 0.1), Math.round(w * 0.5), Math.round(w * 0.82)]) {
    const sw = Math.round(between(r, 16, 26));
    for (let y = 0; y < h; y++) {
      const wob = Math.round(Math.sin((y / h) * Math.PI * 2 * 2 + x) * 3);
      for (let xx = 0; xx < sw; xx++) {
        const u = (xx / (sw - 1)) * 2 - 1;
        p.set(x + xx + wob, y, M_BODY, (0.3 - u) * 40 + ((x + xx) % 4 === 0 ? -20 : 0));
      }
    }
    for (let k = 0; k < 4; k++) {
      const sy = Math.round(r() * h), side = r() < 0.5 ? -1 : 1;
      for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 22 - yy * 3; xx++) {
        p.set(x + (side < 0 ? -xx : sw + xx), sy + yy, M_ACCENT, 24 - yy * 10);
      }
      if (r() < 0.8) p.set(x + (side < 0 ? -6 : sw + 6), sy - 1, M_GLOW);
    }
  }
  for (let k = 0; k < 4; k++) {
    const x0 = Math.round(r() * w), y0 = Math.round(r() * h);
    for (let j = 0; j < 6; j++) root(p, r, x0 + j * Math.round(between(r, 4, 9)), y0, Math.round(between(r, 60, 220)), between(r, 2, 5), M_BODY);
  }
  return painter(pal, w, h, seed).paint(p, { value: 0.015, veil: 0.05, rim: 0.55, accent: { color: pal.accent, mix: 0.5 }, tone: 0.2 });
}

/* ======================= THE DROWNED CISTERNS ======================= */

function cisternFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const P = painter(pal, w, h, seed);
  const p = new MaskPlane(w, h);
  arcade(p, Math.round(h * 0.46), 128, 92, 8, 220, M_BODY, 20);
  return P.paint(p, { base: P.light(), value: 0.18, veil: 0.45, rim: 0.2 });
}

function cisternArcadeFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  arcade(p, Math.round(h * 0.32), 160, 112, 12, 170, M_BODY);
  arcade(p, Math.round(h * 0.84), 192, 140, 14, 120, M_BODY, 40);
  for (let k = 0; k < 6; k++) chain(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 30, 90)), M_BODY);
  return painter(pal, w, h, seed).paint(p, { value: 0.11, veil: 0.3, rim: 0.45, tone: 0.1 });
}

function cisternShafts(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 7; k++) {
    shaft(p, M_SOFT, Math.round(r() * w), Math.round(between(r, 0, 0.3) * h), Math.round(between(r, 240, 380)), Math.round(between(r, 14, 40)),
      between(r, 0.08, 0.2), between(r, 0.3, 0.44), Math.round(r() * 100));
  }
  return painter(pal, w, h, seed).paint(p, { value: 0, veil: 0, rim: 0 });
}

function cisternMid(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  const spring = Math.round(h * 0.4);
  const pier = 250;
  arcade(p, spring, 256, 176, 18, pier, M_BODY, 30);
  const floor = spring + pier;
  for (let x = 30 + 128; x < w + 30; x += 256) {
    statue(p, r, x + Math.round(between(r, -30, 30)), floor, Math.round(between(r, 84, 120)), M_ACCENT, r() < 0.45);
    for (let k = 0; k < 4; k++) kelp(p, r, x + Math.round(between(r, -70, 70)), floor, Math.round(between(r, 40, 120)), M_BODY);
  }
  return painter(pal, w, h, seed).paint(p, { value: 0.055, veil: 0.16, rim: 0.6, accent: { color: pal.accent, mix: 0.55 }, tone: 0.12 });
}

function cisternNear(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of [Math.round(w * 0.06), Math.round(w * 0.55)]) {
    const cw = Math.round(between(r, 28, 40));
    for (let y = 0; y < h; y++) for (let xx = 0; xx < cw; xx++) {
      const u = (xx / (cw - 1)) * 2 - 1;
      const joint = y % 16 === 0 || (xx === Math.floor(cw / 2) && Math.floor(y / 16) % 2 === 1);
      p.set(x + xx, y, M_BODY, (0.3 - u) * 34 + (joint ? -40 : 0));
    }
    const cap = Math.round(r() * h);
    p.hBar(x - 6, cap, cw + 12, 6, M_BODY, 20);
    p.hBar(x - 3, cap + 6, cw + 6, 4, M_BODY, 0);
  }
  for (let k = 0; k < 3; k++) {
    const x0 = Math.round(r() * w), base = Math.round(r() * h);
    for (let j = 0; j < 8; j++) kelp(p, r, x0 + j * Math.round(between(r, 6, 14)), base, Math.round(between(r, 80, 230)), M_ACCENT);
  }
  for (let k = 0; k < 3; k++) chain(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 60, 200)), M_BODY, 2);
  hPipe(p, Math.round(w * 0.2), Math.round(w * 0.5), Math.round(h * 0.7), 12, M_BODY);
  return painter(pal, w, h, seed).paint(p, { value: 0.015, veil: 0.05, rim: 0.55, accent: { color: pal.accent, mix: 0.45 }, tone: 0.2 });
}

/* ========================== THE KILN HEART ========================== */

function kilnFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const P = painter(pal, w, h, seed);
  const p = new MaskPlane(w, h);
  // Far chimneys stand in the furnace light; their throats glow.
  for (const x of slots(r, w, 6, 0.6)) {
    // Rooted below the visible rows: they rise out of the furnace floor.
    chimney(p, r, x, h - 1, Math.round(between(r, 22, 38)), Math.round(h * between(r, 0.62, 0.8)), M_BODY, M_GLOW);
  }
  for (let k = 0; k < 5; k++) {
    const x0 = Math.round(r() * w), top = Math.round(h * between(r, 0.5, 0.62));
    for (let j = 0; j < 3; j++) basalt(p, r, x0 + j * 11, 10, top + Math.round(between(r, 0, 30)), Math.round(h * 0.74), M_BODY);
  }
  return P.paint(p, { base: P.light(), value: 0.08, veil: 0.5, rim: 0.3, glow: rampColor(P.ramp, 0.9) });
}

function kilnStacks(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const P = painter(pal, w, h, seed);
  const p = new MaskPlane(w, h);
  // Few and slender: the furnace light behind must show between them.
  for (const x of slots(r, w, 4, 0.6)) {
    chimney(p, r, x, Math.round(between(r, 0.7, 0.95) * h), Math.round(between(r, 26, 42)), Math.round(between(r, 180, 330)), M_BODY, M_GLOW);
  }
  for (let k = 0; k < 3; k++) {
    const x0 = Math.round(r() * w), top = Math.round(r() * h * 0.6);
    for (let j = 0; j < 3; j++) basalt(p, r, x0 + j * 14, 12, top + Math.round(between(r, 0, 60)), top + Math.round(between(r, 220, 320)), M_ACCENT);
  }
  hPipe(p, 0, Math.round(w * 0.45), Math.round(h * 0.18), 7, M_BODY);
  return P.paint(p, { value: 0.06, veil: 0.28, rim: 0.6, accent: { color: pal.accent, mix: 0.3 }, glow: rampColor(P.ramp, 0.86) });
}

function kilnHeat(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // Heat rising: wavering, streaky columns that the kit scrolls upward.
  const r = rng(seed);
  const P = painter(pal, w, h, seed);
  const p = new MaskPlane(w, h);
  softColumns(p, r, 5, [14, 34], [0.12, 0.2], seed);
  return P.paint(p, { value: 0, veil: 0, rim: 0, soft: rampColor(P.ramp, 0.82) });
}

function kilnMid(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const P = painter(pal, w, h, seed);
  const p = new MaskPlane(w, h);
  // Brick tunnel mouths, firelit from their hearths: the opening glows up from the bed.
  for (let x = 90; x < w + 90; x += 300) {
    const spring = Math.round(between(r, 0.3, 0.55) * h);
    const span = 110, pierH = 150, r0 = span / 2;
    arch(p, x, spring, span, 16, pierH, M_ACCENT);
    for (let yy = -r0; yy < pierH; yy++) for (let xx = -r0 + 1; xx < r0; xx++) {
      if (yy < 0 && xx * xx + yy * yy >= r0 * r0) continue;
      const t = (yy + r0) / (pierH + r0);
      const side = 1 - Math.pow(Math.abs(xx) / r0, 2) * 0.6;
      p.soft(x + xx, spring + yy, M_SOFT, (0.03 + 0.4 * t * t * t) * side);
    }
    for (let xx = -r0 + 2; xx < r0 - 2; xx++) for (let yy = pierH - 3; yy < pierH; yy++) p.set(x + xx, spring + yy, M_GLOW);
  }
  hPipe(p, 0, Math.round(w * 0.6), Math.round(h * 0.12), 9, M_BODY);
  for (let k = 0; k < 4; k++) {
    const cx = Math.round(r() * w), top = Math.round(r() * h * 0.5), len = Math.round(between(r, 60, 150));
    chain(p, cx, top, len, M_BODY);
    p.poly([[cx - 12, top + len], [cx + 12, top + len], [cx + 8, top + len + 16], [cx - 8, top + len + 16]], M_BODY, 10);
    p.hBar(cx - 10, top + len, 21, 2, M_GLOW);
  }
  return P.paint(p, { value: 0.035, veil: 0.14, rim: 0.7, accent: { color: pal.accent, mix: 0.35 }, glow: rampColor(P.ramp, 0.92),
    soft: rampColor(P.ramp, 0.86) });
}

function kilnNear(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of [Math.round(w * 0.04), Math.round(w * 0.5)]) {
    for (let j = 0; j < 2; j++) basalt(p, r, x + j * 16, 15, Math.round(r() * h * 0.3), Math.round(r() * h * 0.3) + h, M_BODY);
  }
  for (let k = 0; k < 3; k++) chain(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 70, 220)), M_BODY, 2);
  hPipe(p, Math.round(w * 0.62), Math.round(w * 0.98), Math.round(h * 0.55), 14, M_ACCENT);
  gear(p, Math.round(w * 0.8), Math.round(h * 0.25), 44, 14, 5, M_BODY);
  return painter(pal, w, h, seed).paint(p, { value: 0.012, veil: 0.05, rim: 0.75, accent: { color: pal.accent, mix: 0.3 }, tone: 0.15 });
}

/* ========================== THE COLD STORE ========================== */

function coldFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // Cold light from the high vents over a hall of brine tanks lost in frost haze.
  const r = rng(seed);
  const P = painter(pal, w, h, seed);
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 5, 0.5)) {
    tank(p, r, x, Math.round(h * between(r, 0.8, 0.9)), Math.round(between(r, 56, 90)), Math.round(between(r, 120, 200)), M_BODY);
  }
  hookRail(p, r, 0, w, Math.round(h * 0.18), M_BODY);
  return P.paint(p, { base: P.light(), value: 0.2, veil: 0.42, rim: 0.2 });
}

function coldRacks(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // Cooling-coil banks and carcass rails, frost rimming every top edge.
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 4, 0.5)) {
    const cw = Math.round(between(r, 90, 150));
    coilBank(p, x, Math.round(between(r, 0.1, 0.55) * h), cw, Math.round(between(r, 5, 9)), 12, 4, M_BODY);
    p.vBar(x + Math.round(cw / 2), 0, p.height, 3, M_BODY, 10); // the bank's riser, full height (tiles)
  }
  for (let k = 0; k < 3; k++) {
    const x0 = Math.round(r() * w), len = Math.round(between(r, 160, 300));
    hookRail(p, r, x0, x0 + len, Math.round(between(r, 0.15, 0.85) * h), M_ACCENT);
  }
  return painter(pal, w, h, seed).paint(p, { value: 0.12, veil: 0.3, rim: 0.55, accent: { color: pal.accent, mix: 0.35 }, tone: 0.1 });
}

function coldShafts(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // Pale light falling through the frosted vents, soft and nearly vertical.
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 6; k++) {
    shaft(p, M_SOFT, Math.round(r() * w), Math.round(between(r, 0, 0.25) * h), Math.round(between(r, 220, 360)), Math.round(between(r, 14, 34)),
      between(r, -0.06, 0.06), between(r, 0.2, 0.32), Math.round(r() * 100));
  }
  return painter(pal, w, h, seed).paint(p, { value: 0, veil: 0, rim: 0 });
}

function coldMid(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // Brine tanks with ladders, frosted vent grates, hooks on chains.
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 3, 0.6)) {
    tank(p, r, x, Math.round(between(r, 0.55, 0.95) * h), Math.round(between(r, 44, 64)), Math.round(between(r, 90, 150)), M_BODY);
  }
  for (let k = 0; k < 4; k++) {
    grate(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 40, 70)), Math.round(between(r, 26, 44)), 6, M_ACCENT);
  }
  for (let k = 0; k < 4; k++) {
    const x = Math.round(r() * w), y = Math.round(r() * h * 0.6);
    hookRail(p, r, x, x + Math.round(between(r, 50, 110)), y, M_BODY);
  }
  return painter(pal, w, h, seed).paint(p, { value: 0.05, veil: 0.14, rim: 0.65, accent: { color: pal.accent, mix: 0.4 }, tone: 0.1 });
}

function coldNear(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // Heavy frost-rimed pipe columns with icicles at their flanges, hooks on heavy chains.
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of [Math.round(w * 0.1), Math.round(w * 0.58)]) {
    pipeColumn(p, x, 18, M_BODY, r, M_ACCENT);
    for (let y = Math.round(r() * 120); y < h; y += Math.round(between(r, 120, 200))) stalactites(p, r, x - 4, x + 24, y, 22, M_ACCENT);
  }
  hPipe(p, Math.round(w * 0.2), Math.round(w * 0.52), Math.round(h * 0.3), 12, M_BODY);
  for (let k = 0; k < 3; k++) {
    const x = Math.round(r() * w), y = Math.round(r() * h);
    chain(p, x, y, Math.round(between(r, 60, 180)), M_BODY, 2);
  }
  hookRail(p, r, Math.round(w * 0.66), Math.round(w * 0.96), Math.round(h * 0.62), M_BODY, 2);
  return painter(pal, w, h, seed).paint(p, { value: 0.015, veil: 0.05, rim: 0.6, accent: { color: pal.accent, mix: 0.5 }, tone: 0.15 });
}

/* ======================= THE GLASS GALLERIES ======================== */

/** Prism spill: violet, teal and amber, low and broad (never a beam; the floor's puzzles own the beams). */
function prismTints(pal: KitPalette): Rgb[] {
  const t = pal.tints ?? [pal.shaft];
  return t.map((c) => [c[0], c[1], c[2]] as Rgb);
}

function glassFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // A dim hall of tall arcades; soft coloured light spills where prisms hang.
  const r = rng(seed);
  const P = painter(pal, w, h, seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 5; k++) {
    lightPool(p, M_TINT + (k % 3), Math.round(r() * w), Math.round(h * between(r, 0.35, 0.65)), between(r, 60, 110), between(r, 70, 130), between(r, 0.14, 0.22));
  }
  arcade(p, Math.round(h * 0.42), 128, 96, 8, 240, M_BODY, 24);
  return P.paint(p, { base: P.light(), value: 0.16, veil: 0.4, rim: 0.2, tints: prismTints(pal) });
}

function glassArcade(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // Tall arcades glazed with dusty panes, ground lenses set into the piers.
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  const period = 160, span = 112, spring = Math.round(h * 0.34), pierH = 220;
  arcade(p, spring, period, span, 12, pierH, M_BODY);
  for (let x = period / 2; x < w + period / 2; x += period) {
    // The pane: faint streaked glass filling the arch below its spring.
    for (let y = spring - span / 2 + 6; y < spring + pierH; y++) for (let dx = -span / 2 + 3; dx < span / 2 - 3; dx++) {
      if (y < spring && dx * dx + (y - spring) ** 2 > (span / 2 - 3) ** 2) continue;
      // A faint glaze; a sheen only in the round head of the arch (short, not a beam).
      const sheen = y < spring && ((Math.round(x + dx) + y) & 15) < 3 ? 0.12 : 0.06;
      p.soft(Math.round(x + dx), y, M_TINT + 3, sheen);
    }
    // Mullions and a lens medallion on the pier.
    p.vBar(Math.round(x), spring - span / 2 + 4, span / 2 + pierH - 6, 2, M_BODY, 0);
    p.ring(Math.round(x + period / 2), spring - 20, 5, 8, M_ACCENT, 16);
  }
  for (let k = 0; k < 4; k++) chain(p, Math.round(r() * w), Math.round(r() * h * 0.4), Math.round(between(r, 30, 90)), M_BODY);
  return painter(pal, w, h, seed).paint(p, { value: 0.1, veil: 0.3, rim: 0.45, accent: { color: pal.accent, mix: 0.45 }, tone: 0.1,
    tints: prismTints(pal) });
}

function glassMid(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // Display cases, lens racks and hanging prisms of the grinding floor.
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 5, 0.5)) {
    const base = Math.round(between(r, 0.55, 0.92) * h);
    if (r() < 0.55) displayCase(p, r, x, base, Math.round(between(r, 36, 56)), Math.round(between(r, 34, 50)), M_BODY, M_TINT + 3);
    else lensRack(p, x, base, Math.round(between(r, 70, 120)), M_BODY);
  }
  for (let k = 0; k < 4; k++) hangingPrism(p, Math.round(r() * w), Math.round(r() * h * 0.4), Math.round(between(r, 40, 120)), Math.round(between(r, 5, 9)), M_ACCENT);
  return painter(pal, w, h, seed).paint(p, { value: 0.05, veil: 0.14, rim: 0.55, accent: { color: pal.accent, mix: 0.5 }, tone: 0.1,
    tints: prismTints(pal) });
}

function glassNear(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // Slender columns with glass capitals, a great lens frame, chains.
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of [Math.round(w * 0.08), Math.round(w * 0.56)]) {
    const cw = Math.round(between(r, 18, 26));
    for (let y = 0; y < h; y++) for (let xx = 0; xx < cw; xx++) {
      const u = (xx / (cw - 1)) * 2 - 1;
      p.set(x + xx, y, M_BODY, (0.3 - u) * 34 + (xx % 6 === 0 ? -24 : 0));
    }
    const cap = Math.round(r() * h);
    p.poly([[x - 8, cap], [x + cw + 8, cap], [x + cw, cap + 10], [x, cap + 10]], M_ACCENT, 20);
  }
  gear(p, Math.round(w * 0.82), Math.round(h * 0.3), 40, 0, 8, M_BODY);
  for (let k = 0; k < 3; k++) chain(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 60, 180)), M_BODY, 2);
  return painter(pal, w, h, seed).paint(p, { value: 0.015, veil: 0.05, rim: 0.55, accent: { color: pal.accent, mix: 0.5 }, tone: 0.15 });
}

/* ============================= GENERIC ============================== */

function genericFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const P = painter(pal, w, h, seed);
  const p = new MaskPlane(w, h);
  arcade(p, Math.round(h * 0.52), 144, 100, 10, 200, M_BODY, Math.round(r() * 40));
  return P.paint(p, { base: P.light(), value: 0.16, veil: 0.45, rim: 0.2 });
}

function genericArcade(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  arcade(p, Math.round(h * 0.36), 160, 116, 12, 180, M_BODY);
  stalactites(p, r, 0, w, Math.round(h * 0.02), 60, M_BODY);
  for (let k = 0; k < 6; k++) chain(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 30, 90)), M_BODY);
  return painter(pal, w, h, seed).paint(p, { value: 0.1, veil: 0.3, rim: 0.45, tone: 0.1 });
}

function genericShafts(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 6; k++) {
    shaft(p, M_SOFT, Math.round(r() * w), Math.round(between(r, 0, 0.35) * h), Math.round(between(r, 200, 340)), Math.round(between(r, 14, 34)),
      between(r, 0.08, 0.22), between(r, 0.26, 0.4), Math.round(r() * 100));
  }
  return painter(pal, w, h, seed).paint(p, { value: 0, veil: 0, rim: 0 });
}

function genericNear(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  pipeColumn(p, Math.round(w * 0.12), 18, M_BODY, r, M_ACCENT);
  pipeColumn(p, Math.round(w * 0.66), 14, M_BODY, r, M_ACCENT);
  stalactites(p, r, Math.round(w * 0.25), Math.round(w * 0.5), Math.round(h * 0.4), 80, M_BODY);
  for (let k = 0; k < 4; k++) chain(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 60, 200)), M_BODY, 2);
  girder(p, Math.round(w * 0.7), Math.round(w * 0.98), Math.round(h * 0.75), 9, M_BODY);
  return painter(pal, w, h, seed).paint(p, { value: 0.015, veil: 0.05, rim: 0.55, accent: { color: pal.accent, mix: 0.4 }, tone: 0.2 });
}

export const PLANE_ART: Readonly<Record<string, PlaneArtBuilder>> = {
  'bellows-hall': bellowsHall,
  'bellows-shafts': bellowsShafts,
  'bellows-near': bellowsNear,
  'rot-far': rotFar,
  'rot-stalks-far': rotStalksFar,
  'rot-shafts': rotShafts,
  'rot-mid': rotMid,
  'rot-near': rotNear,
  'cistern-far': cisternFar,
  'cistern-arcade-far': cisternArcadeFar,
  'cistern-shafts': cisternShafts,
  'cistern-mid': cisternMid,
  'cistern-near': cisternNear,
  'kiln-far': kilnFar,
  'kiln-stacks': kilnStacks,
  'kiln-plumes': kilnHeat,
  'kiln-mid': kilnMid,
  'kiln-near': kilnNear,
  'cold-far': coldFar,
  'cold-racks': coldRacks,
  'cold-shafts': coldShafts,
  'cold-mid': coldMid,
  'cold-near': coldNear,
  'glass-far': glassFar,
  'glass-arcade': glassArcade,
  'glass-mid': glassMid,
  'glass-near': glassNear,
  'generic-far': genericFar,
  'generic-arcade': genericArcade,
  'generic-shafts': genericShafts,
  'generic-near': genericNear,
};

/** Build a plane by id; unknown ids render the generic arcade (never a crash, never blank). */
export function buildPlaneArt(art: string, palette: KitPalette, width: number, height: number, seed: number): Bitmap {
  return (PLANE_ART[art] ?? genericArcade)(palette, width, height, seed);
}

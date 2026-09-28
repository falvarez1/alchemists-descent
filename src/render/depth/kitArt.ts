import type { KitPalette, Rgb } from '@/config/depthKits';
import {
  arcade, arch, basalt, bellows, chain, chimney, gear, girder, hPipe, kelp, mushroom, pipeColumn, pressureStack, root,
  shaft, stalactites, statue, type Rand,
} from '@/render/depth/motifs';
import { type Bitmap, MaskPlane, type Material, fogFill, mixRgb, over, rng, shade } from '@/render/depth/raster';

/**
 * The procedural depth-plane art, by id (config/depthKits names them).
 * Every builder paints a TILEABLE plane in the game's pixel grain from the
 * kit's palette; the kit's haze settings then push it back into the air.
 * Builders are deterministic in (palette, size, seed): every run sees the
 * same scenery, and the tests can hold the look.
 *
 * Far planes barely scroll vertically (parallax ≤ 0.14 moves them at most
 * ~100 cells over a whole level), so their rows map almost directly to the
 * screen: the far fills put their light where the screen needs it (the
 * Kiln's furnace glow low, the Cisterns' surface light high) and blend back
 * to the top colour past the visible rows, so the vertical wrap is seamless.
 */

export type PlaneArtBuilder = (palette: KitPalette, width: number, height: number, seed: number) => Bitmap;

const M_BODY = 1, M_ACCENT = 2, M_GLOW = 3, M_SOFT = 4;

const k3 = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

function palMaterials(pal: KitPalette, bodyK = 1, soft: Rgb = pal.shaft, glowK = 1): (Material | null)[] {
  const body = k3(pal.body, bodyK);
  const accent = k3(pal.accent, bodyK);
  return [
    null,
    { base: body, rim: mixRgb(body, pal.rim, 0.5 + 0.3 * (1 - Math.min(1, bodyK))), shade: k3(body, 0.66) },
    { base: accent, rim: mixRgb(accent, pal.rim, 0.5), shade: k3(accent, 0.64) },
    { base: k3(pal.glow, glowK), rim: pal.glow, shade: pal.glow, glow: true },
    { base: soft, rim: soft, shade: soft, glow: true },
  ];
}

const lightFromAbove = (t: number): number => 1.1 - 0.28 * t;
const lightFromBelow = (t: number): number => 0.75 + 0.4 * t * t;
const between = (r: Rand, a: number, b: number): number => a + (b - a) * r();

/** Evenly spread x positions with jitter: `n` slots across a tiling width. */
function slots(r: Rand, width: number, n: number, jitter = 0.35): number[] {
  const step = width / n;
  return Array.from({ length: n }, (_, i) => Math.round(i * step + (r() - 0.5) * step * jitter));
}

function shadeWith(p: MaskPlane, pal: KitPalette, mats: (Material | null)[], seed: number, grain = 5): Bitmap {
  return shade(p, {
    materials: mats,
    light: pal.light,
    gradient: pal.light[1] > 0 ? lightFromBelow : lightFromAbove,
    grain,
    seed,
  });
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

/* =========================== THE BELLOWS =========================== */

function bellowsHall(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  const xs = slots(r, w, 6, 0.4);
  for (let i = 0; i < xs.length; i++) {
    if (i % 3 === 2) latticeTower(p, xs[i], Math.round(between(r, 16, 24)), M_BODY);
    else pressureStack(p, xs[i], Math.round(between(r, 28, 46)), M_BODY, M_GLOW, r);
  }
  // Catwalks between neighbouring stacks (short spans: never a line across the whole view).
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] + 40, b = (i + 1 < xs.length ? xs[i + 1] : xs[0] + w) - 4;
    if (r() < 0.6) {
      const y = Math.round(between(r, 0.15, 0.85) * h);
      girder(p, a, b, y, 7, M_BODY);
      if (r() < 0.6) chain(p, Math.round(between(r, a + 8, b - 8)), y + 9, Math.round(between(r, 30, 90)), M_BODY);
    }
    for (let k = 0; k < 2; k++) hPipe(p, a - 20, b, Math.round(between(r, 0.08, 0.92) * h), Math.round(between(r, 4, 7)), M_ACCENT);
  }
  return shadeWith(p, pal, palMaterials(pal, 1, pal.shaft, 0.5), seed);
}

function bellowsShafts(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // High grates between the hall's stacks (same plane speed and size: they line up).
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 6; k++) {
    shaft(p, M_SOFT, Math.round(r() * w), Math.round(between(r, 0.02, 0.4) * h), Math.round(between(r, 200, 320)), Math.round(between(r, 12, 30)),
      between(r, 0.1, 0.24), between(r, 0.28, 0.42), Math.round(r() * 100));
  }
  return shadeWith(p, pal, palMaterials(pal), seed, 0);
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
  // The great bellows of the Breathing Chamber, slung on chains.
  bellows(p, Math.round(w * 0.85), Math.round(h * 0.72), 96, 104, M_ACCENT);
  chain(p, Math.round(w * 0.85) - 30, 0, Math.round(h * 0.72) - 58, M_BODY, 2);
  chain(p, Math.round(w * 0.85) + 30, 0, Math.round(h * 0.72) - 58, M_BODY, 2);
  hPipe(p, Math.round(w * 0.3), Math.round(w * 0.7), Math.round(h * 0.9), 10, M_ACCENT);
  return shadeWith(p, pal, palMaterials(pal, 0.72), seed);
}

/* ========================== THE ROT GARDENS ========================= */

function rotFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  // A spore-lit band across the middle of the screen, dark above and below.
  const fill = fogFill(w, h, [[0, pal.deep], [0.3, mixRgb(pal.deep, pal.haze, 0.7)], [0.5, mixRgb(pal.haze, pal.fog, 0.35)],
    [0.72, pal.haze], [0.86, pal.deep], [1, pal.deep]], { color: pal.fog, amount: 0.5, cell: 90, seed });
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 5, 0.6)) {
    mushroom(p, r, x, Math.round(h * between(r, 0.74, 0.86)), Math.round(between(r, 200, 320)), Math.round(between(r, 120, 210)), M_BODY, M_BODY, M_GLOW);
  }
  return over(fill, shadeWith(p, pal, palMaterials(pal, 1.25, pal.shaft, 0.45), seed));
}

function rotStalksFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 6, 0.6)) {
    mushroom(p, r, x, Math.round(r() * h), Math.round(between(r, 200, 420)), Math.round(between(r, 90, 180)), M_BODY, M_ACCENT, M_GLOW);
  }
  for (let k = 0; k < 8; k++) root(p, r, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 60, 200)), between(r, 2, 4), M_BODY);
  return shadeWith(p, pal, palMaterials(pal, 0.95, pal.shaft, 0.55), seed);
}

function rotShafts(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 6; k++) {
    shaft(p, M_SOFT, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 260, 420)), Math.round(between(r, 26, 56)), between(r, -0.08, 0.08),
      between(r, 0.26, 0.4), Math.round(r() * 100));
  }
  return shadeWith(p, pal, palMaterials(pal), seed, 0);
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
  return shadeWith(p, pal, palMaterials(pal, 0.7, pal.shaft, 0.75), seed);
}

function rotNear(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  // Thick stalks that climb the whole height (they tile), ringed with shelf fungi.
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
  return shadeWith(p, pal, palMaterials(pal, 0.5), seed);
}

/* ======================= THE DROWNED CISTERNS ======================= */

function cisternFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  // Light falls from somewhere above: bright high, murk low, back to light past the visible rows.
  const fill = fogFill(w, h, [[0, mixRgb(pal.haze, pal.fog, 0.6)], [0.35, pal.haze], [0.78, pal.deep], [0.9, pal.deep],
    [1, mixRgb(pal.haze, pal.fog, 0.6)]], { color: pal.fog, amount: 0.45, cell: 110, seed });
  const p = new MaskPlane(w, h);
  arcade(p, Math.round(h * 0.46), 128, 92, 8, 220, M_BODY, 20);
  return over(fill, shadeWith(p, pal, palMaterials(pal, 1.3), seed));
}

function cisternArcadeFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  arcade(p, Math.round(h * 0.32), 160, 112, 12, 170, M_BODY);
  arcade(p, Math.round(h * 0.84), 192, 140, 14, 120, M_BODY, 40);
  for (let k = 0; k < 6; k++) chain(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 30, 90)), M_BODY);
  return shadeWith(p, pal, palMaterials(pal, 1.05), seed);
}

function cisternShafts(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 7; k++) {
    shaft(p, M_SOFT, Math.round(r() * w), Math.round(between(r, 0, 0.3) * h), Math.round(between(r, 240, 380)), Math.round(between(r, 14, 40)),
      between(r, 0.08, 0.2), between(r, 0.3, 0.44), Math.round(r() * 100));
  }
  return shadeWith(p, pal, palMaterials(pal), seed, 0);
}

function cisternMid(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  const spring = Math.round(h * 0.4);
  const pier = 250;
  arcade(p, spring, 256, 176, 18, pier, M_BODY, 30);
  const floor = spring + pier;
  // Drowned statues keep vigil between the piers; kelp grows at their feet.
  for (let x = 30 + 128; x < w + 30; x += 256) {
    statue(p, r, x + Math.round(between(r, -30, 30)), floor, Math.round(between(r, 84, 120)), M_ACCENT, r() < 0.45);
    for (let k = 0; k < 4; k++) kelp(p, r, x + Math.round(between(r, -70, 70)), floor, Math.round(between(r, 40, 120)), M_BODY);
  }
  return shadeWith(p, pal, palMaterials(pal, 0.72), seed);
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
  return shadeWith(p, pal, palMaterials(pal, 0.5), seed);
}

/* ========================== THE KILN HEART ========================== */

function kilnFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  // Furnace glow LOW on the screen (rows ~0.55–0.8), soot above, dark past the visible rows.
  const fill = fogFill(w, h, [[0, pal.deep], [0.2, mixRgb(pal.deep, pal.haze, 0.3)], [0.45, pal.haze], [0.62, pal.fog],
    [0.74, pal.fog], [0.86, mixRgb(pal.deep, pal.haze, 0.6)], [1, pal.deep]], { color: mixRgb(pal.haze, pal.deep, 0.6), amount: 0.5, cell: 100, seed });
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 6, 0.6)) {
    chimney(p, r, x, Math.round(h * between(r, 0.7, 0.8)), Math.round(between(r, 24, 42)), Math.round(between(r, 150, 260)), M_BODY, M_GLOW);
  }
  return over(fill, shadeWith(p, pal, palMaterials(pal, 0.6, pal.shaft, 0.8), seed));
}

function kilnStacks(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of slots(r, w, 5, 0.6)) {
    chimney(p, r, x, Math.round(between(r, 0.75, 1.0) * h), Math.round(between(r, 34, 58)), Math.round(between(r, 180, 330)), M_BODY, M_GLOW);
  }
  for (let k = 0; k < 4; k++) {
    const x0 = Math.round(r() * w), top = Math.round(r() * h * 0.6);
    for (let j = 0; j < 4; j++) basalt(p, r, x0 + j * 14, 12, top + Math.round(between(r, 0, 60)), top + Math.round(between(r, 220, 320)), M_ACCENT);
  }
  hPipe(p, 0, Math.round(w * 0.45), Math.round(h * 0.18), 7, M_BODY);
  return shadeWith(p, pal, palMaterials(pal, 0.8, pal.shaft, 0.85), seed);
}

function kilnPlumes(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 6; k++) {
    shaft(p, M_SOFT, Math.round(r() * w), Math.round(between(r, 0.7, 0.95) * h), Math.round(between(r, 200, 340)), Math.round(between(r, 18, 44)),
      between(r, -0.06, 0.06), between(r, 0.28, 0.42), Math.round(r() * 100), -1);
  }
  return shadeWith(p, pal, palMaterials(pal), seed, 0);
}

function kilnMid(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  // Brick tunnel mouths with a hearth glowing at their feet.
  for (let x = 90; x < w + 90; x += 300) {
    const spring = Math.round(between(r, 0.3, 0.6) * h);
    arch(p, x, spring, 110, 16, 150, M_ACCENT);
    for (let yy = 143; yy < 150; yy++) for (let xx = -54; xx <= 54; xx++) {
      if (p.get(x + xx, spring + yy) === 0) p.set(x + xx, spring + yy, M_GLOW);
    }
    for (let k = 0; k < 14; k++) p.set(x + Math.round(between(r, -48, 48)), spring + Math.round(between(r, 120, 142)), M_GLOW);
  }
  hPipe(p, 0, Math.round(w * 0.6), Math.round(h * 0.12), 9, M_BODY);
  for (let k = 0; k < 4; k++) {
    const cx = Math.round(r() * w), top = Math.round(r() * h * 0.5), len = Math.round(between(r, 60, 150));
    chain(p, cx, top, len, M_BODY);
    p.poly([[cx - 12, top + len], [cx + 12, top + len], [cx + 8, top + len + 16], [cx - 8, top + len + 16]], M_BODY, 10);
    p.hBar(cx - 10, top + len, 21, 2, M_GLOW);
  }
  return shadeWith(p, pal, palMaterials(pal, 0.7, pal.shaft, 0.7), seed);
}

function kilnNear(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (const x of [Math.round(w * 0.04), Math.round(w * 0.5)]) {
    for (let j = 0; j < 3; j++) basalt(p, r, x + j * 18, 17, Math.round(r() * h * 0.3), Math.round(r() * h * 0.3) + h, M_BODY);
  }
  for (let k = 0; k < 4; k++) chain(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 70, 220)), M_BODY, 2);
  hPipe(p, Math.round(w * 0.62), Math.round(w * 0.98), Math.round(h * 0.55), 14, M_ACCENT);
  gear(p, Math.round(w * 0.8), Math.round(h * 0.25), 44, 14, 5, M_BODY);
  return shadeWith(p, pal, palMaterials(pal, 0.5), seed);
}

/* ============================= GENERIC ============================== */

function genericFar(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const fill = fogFill(w, h, [[0, pal.deep], [0.35, mixRgb(pal.deep, pal.haze, 0.7)], [0.6, pal.haze], [0.85, pal.deep], [1, pal.deep]],
    { color: pal.fog, amount: 0.45, cell: 100, seed });
  const p = new MaskPlane(w, h);
  arcade(p, Math.round(h * 0.52), 144, 100, 10, 200, M_BODY, Math.round(r() * 40));
  return over(fill, shadeWith(p, pal, palMaterials(pal, 1.25), seed));
}

function genericArcade(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  arcade(p, Math.round(h * 0.36), 160, 116, 12, 180, M_BODY);
  stalactites(p, r, 0, w, Math.round(h * 0.02), 60, M_BODY);
  for (let k = 0; k < 6; k++) chain(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 30, 90)), M_BODY);
  return shadeWith(p, pal, palMaterials(pal, 1), seed);
}

function genericShafts(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  for (let k = 0; k < 6; k++) {
    shaft(p, M_SOFT, Math.round(r() * w), Math.round(between(r, 0, 0.35) * h), Math.round(between(r, 200, 340)), Math.round(between(r, 14, 34)),
      between(r, 0.08, 0.22), between(r, 0.26, 0.4), Math.round(r() * 100));
  }
  return shadeWith(p, pal, palMaterials(pal), seed, 0);
}

function genericNear(pal: KitPalette, w: number, h: number, seed: number): Bitmap {
  const r = rng(seed);
  const p = new MaskPlane(w, h);
  pipeColumn(p, Math.round(w * 0.12), 18, M_BODY, r, M_ACCENT);
  pipeColumn(p, Math.round(w * 0.66), 14, M_BODY, r, M_ACCENT);
  stalactites(p, r, Math.round(w * 0.25), Math.round(w * 0.5), Math.round(h * 0.4), 80, M_BODY);
  for (let k = 0; k < 4; k++) chain(p, Math.round(r() * w), Math.round(r() * h), Math.round(between(r, 60, 200)), M_BODY, 2);
  girder(p, Math.round(w * 0.7), Math.round(w * 0.98), Math.round(h * 0.75), 9, M_BODY);
  return shadeWith(p, pal, palMaterials(pal, 0.66), seed);
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
  'kiln-plumes': kilnPlumes,
  'kiln-mid': kilnMid,
  'kiln-near': kilnNear,
  'generic-far': genericFar,
  'generic-arcade': genericArcade,
  'generic-shafts': genericShafts,
  'generic-near': genericNear,
};

/** Build a plane by id; unknown ids render the generic arcade (never a crash, never blank). */
export function buildPlaneArt(art: string, palette: KitPalette, width: number, height: number, seed: number): Bitmap {
  return (PLANE_ART[art] ?? genericArcade)(palette, width, height, seed);
}

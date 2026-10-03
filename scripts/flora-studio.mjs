// Every surface-flora species, several seeds each, in each climate's palette, on a
// neutral stage with a warm key light from the left — THE way to iterate the plants' look.
// Dev server running:  node scripts/flora-studio.mjs [url] [out.png] [climates=earthen,flooded,fungal,volcanic]
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5191/';
const file = process.argv[3] ?? 'verify-out/flora-studio/sheet.png';
const biomes = (process.argv[4] ?? 'earthen,flooded,fungal,volcanic').split(',');
mkdirSync(dirname(file), { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
  await page.goto(new URL('/audition.html', url).toString(), { waitUntil: 'domcontentloaded' }).catch(() => page.goto(url));
  const png = await page.evaluate(async (biomes) => {
    const flora = await import('/src/world/flora.ts');
    const { paintFlora, floraPalette } = await import('/src/render/FloraPainter.ts');
    const STEP = .5, CELL_W = 74, ROW_H = 58;
    const front = [flora.FERN, flora.BROADLEAF, flora.SEDGE, flora.LILY];
    const ground = [flora.GRASS, flora.SPRIG, flora.CLOVER, flora.CUSHION, flora.DRAPE];
    const seedsFor = (species, fg, n) => {
      const out = [];
      for (let s = 1; out.length < n; s++) {
        const seed = Math.imul(s, 2654435761) >>> 0;
        if (flora.floraSpecies(seed, species === flora.DRAPE ? 1 : 0, fg) === species) out.push(seed);
      }
      return out;
    };
    const rows = [];
    for (const biome of biomes) {
      for (const sp of front) rows.push({ biome, fg: true, items: seedsFor(sp, true, 3).map(seed => ({ seed, side: 0 })) });
      rows.push({ biome, fg: false, items: ground.flatMap(sp => seedsFor(sp, false, 1).map(seed => ({ seed, side: sp === flora.DRAPE ? 1 : 0 }))) });
    }
    const W = CELL_W * 5, Hh = ROW_H * rows.length;
    const cw = Math.round(W / STEP), ch = Math.round(Hh / STEP);
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const g = canvas.getContext('2d'), img = g.createImageData(cw, ch), d = img.data;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const k = (y * cw + x) * 4, v = 1 - y / ch * .2;
      d[k] = 38 * v; d[k + 1] = 62 * v; d[k + 2] = 70 * v; d[k + 3] = 255;
    }
    const put = (wx, wy, r, gg, b, a = 1) => {
      const x = Math.floor(wx / STEP + 1e-6), y = Math.floor(wy / STEP + 1e-6);
      if (x < 0 || y < 0 || x >= cw || y >= ch) return;
      const k = (y * cw + x) * 4;
      d[k] = d[k] * (1 - a) + Math.min(255, r * 255); d[k + 1] = d[k + 1] * (1 - a) + Math.min(255, gg * 255); d[k + 2] = d[k + 2] * (1 - a) + Math.min(255, b * 255);
    };
    const surface = {
      pixelStep: STEP,
      setPx: (x, y, r, gg, b) => put(x, y, r, gg, b),
      setFinePx: (x, y, r, gg, b) => put(x, y, r, gg, b),
      blendFinePx: (x, y, r, gg, b, a) => put(x, y, r / Math.max(a, 1e-3), gg / Math.max(a, 1e-3), b / Math.max(a, 1e-3), a),
      addPx: () => {},
      addFinePx: (x, y, r, gg, b) => {
        const px = Math.floor(x / STEP + 1e-6), py = Math.floor(y / STEP + 1e-6);
        if (px < 0 || py < 0 || px >= cw || py >= ch) return;
        const k = (py * cw + px) * 4;
        d[k] = Math.min(255, d[k] + r * 255); d[k + 1] = Math.min(255, d[k + 1] + gg * 255); d[k + 2] = Math.min(255, d[k + 2] + b * 255);
      },
    };
    const blades = flora.createFloraBlades();
    rows.forEach((row, r) => {
      const groundY = r * ROW_H + ROW_H - 8;
      // Stone floor (and a wall stub for the drapes).
      for (let y = groundY; y < groundY + 8; y += STEP) for (let x = 0; x < W; x += STEP) surface.setFinePx(x, y, .16, .17, .19);
      row.items.forEach((item, c) => {
        const x = c * CELL_W + CELL_W / 2;
        const wall = item.side !== 0;
        const rootX = Math.floor(x), rootY = wall ? groundY - 40 : groundY - 1;
        if (wall) for (let y = groundY - 52; y < groundY; y += STEP) for (let xx = rootX - 6; xx < rootX; xx += STEP) surface.setFinePx(xx, y, .16, .17, .19);
        const pose = { x: rootX, y: rootY, seed: item.seed, side: item.side, foreground: row.fg, angle: 0, part: 0, burn: 0 };
        pose.height = flora.floraHeight(item.seed, item.side, row.fg, false);
        flora.buildFlora(pose, 120, blades);
        const light = { sample: (lx) => { const k = Math.max(.35, Math.min(1.15, 1.1 - (lx - (c * CELL_W)) / CELL_W * .7)); return { r: k, g: k * .92, b: k * .78, open: 1 }; } };
        paintFlora(surface, { blades, palette: floraPalette(row.biome, row.fg), light, time: 120, burn: 0, burning: false,
          camX: 0, camY: 0, foreground: row.fg, skirt: wall ? 0 : row.fg ? 7 : 2.5, opacity: () => 1,
          isSolid: (sx, sy) => sy >= groundY || (wall && sx < rootX && sy > groundY - 52) });
      });
    });
    g.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }, biomes);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  console.log('wrote', file);
} finally { await browser.close(); }

// Parallax drift probe: do the depth kit's backdrop planes glide with the
// camera's sub-cell position, or judder against the world?
//
// Rig: the sim is paused (rendering continues), the frame clock is frozen on
// an even tick (lighting rebuilds with the camera) and film grain and the
// vignette are off. The probe drives the camera itself: each camera position
// renders twice, one kit plane shown then hidden (every other plane at
// opacity 0), and the canvas is read in the same task as each draw
// (preserveDrawingBuffer is false). The difference of the pair is that plane
// alone — the world, sprites and motes cancel.
//
// Per frame it tracks, in canvas pixels (2 per cell), sub-pixel:
//   world    — a band of solid terrain;
//   backdrop — a band of open air, through the isolated plane.
// A plane with parallax s should slide s× the world, steadily. The verdict is
// the plane's worst error against that ideal track and its backward lurches
// (steps against the camera: riding the world for a cell, then snapping back).
//
// It also saves rest frames (same clock and flicker in every session) at a
// camera where cam·s is whole for every plane, where the old and new mappings
// agree, and at a fractional one, for a pixel diff between builds.
//
// Usage: node scripts/verify-parallax-drift.mjs [url] [--label before|after]
//          [--out dir] [--levels d1,d2,d3] [--rest-only] [--cpu]
//   --label after gates: no backward lurch, worst error within half a cell.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5173/';
const label = opt('label', 'run');
const out = opt('out', 'verify-out/parallax-drift');
const levels = opt('levels', 'd1,d2,d3').split(',');
const restOnly = args.includes('--rest-only');
// --cpu: the CPU FrameComposer fallback (a cell-resolution texture, so its
// planes can only step whole cells; reported, not gated).
const cpu = args.includes('--cpu');
mkdirSync(out, { recursive: true });

// Camera paths: steady sub-cell drifts (cells per presented frame), and the
// follow camera's own ease (x += (tx − x)·0.12 a frame) settling twelve cells
// away, whose tail is a long run of ever-slower sub-cell steps. Then the
// planes to isolate per floor.
const DRIFTS = [0.1, 0.25, 'ease'];
const PLANES = { d1: [4, 0], d2: [4], d3: [4] };

const browser = await launchBrowser({ headless: true });
const report = { label, url, levels: {}, errors: [] };
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => report.errors.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  for (const level of levels) {
    await execConsoleCommand(page, `run test --level ${level} --world campaign-level --seed 777 --loadout fresh`);
    await waitForRunReady(page);
    await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
    await page.waitForFunction(() => window.__game.composer.layers.ready, null, { timeout: 30000 });
    await page.waitForTimeout(800);

    // Rig + a camera spot with a band of open air and a band of solid terrain.
    const spot = await page.evaluate((cpu) => {
      const game = window.__game, ctx = game.ctx, W = ctx.world;
      if (ctx.state.frameCount % 2) ctx.state.frameCount++;
      ctx.state.paused = true;
      const post = ctx.state.postFx;
      post.gpuCompose = !cpu;
      post.grain = 0;
      post.vignette = 0;
      ctx.fx.screenShake = 0;
      ctx.camera.zoom = 1;
      ctx.camera.zoomLock = 1;
      const VW = 640, VH = 360, x0 = 60, x1 = 580;
      const openRow = (cx, y) => { let n = 0; for (let x = cx + x0; x < cx + x1; x++) n += W.types[x + y * W.width] === 0 ? 1 : 0; return n / (x1 - x0); };
      let best = null;
      // cam·s is whole for every kit plane on a 100-cell grid (s has two decimals).
      for (let cy = 0; cy + VH <= W.height; cy += 100) {
        for (let cx = 0; cx + VW + 40 <= W.width; cx += 100) {
          const rows = [];
          for (let vy = 8; vy < VH - 8; vy++) rows.push(openRow(cx, cy + vy));
          const band = (want) => {
            let bestAt = -1, bestScore = -1;
            for (let i = 0; i + 14 <= rows.length; i++) {
              let s = 0;
              for (let k = 0; k < 14; k++) s += want ? rows[i + k] : 1 - rows[i + k];
              if (s > bestScore) { bestScore = s; bestAt = i; }
            }
            return { vy: bestAt + 8, score: bestScore / 14 };
          };
          const air = band(true), rock = band(false);
          const score = Math.min(air.score, rock.score);
          if (!best || score > best.score) best = { cx, cy, air, rock, score };
        }
      }
      ctx.camera.x = ctx.camera.tx = best.cx;
      ctx.camera.y = ctx.camera.ty = best.cy;
      game.composeDirty = true;
      const kit = game.composer.layers.activeKit?.kit;
      return { ...best, kit: kit?.id, planes: kit?.planes.map((p) => ({ label: p.label, parallax: p.parallax, scale: p.scale, opacity: p.opacity })) };
    }, cpu);
    report.levels[level] = { spot, rest: [], drifts: [] };
    console.log(`${level}: cam ${spot.cx},${spot.cy} air band vy ${spot.air.vy} (${spot.air.score.toFixed(2)}) rock band vy ${spot.rock.vy} (${spot.rock.score.toFixed(2)}) kit ${spot.kit}`);
    await page.waitForTimeout(300);

    // Rest frames: whole-cam positions (cam·s whole for every plane) and a
    // fractional one, all planes shown.
    for (const [dx, dy] of [[0, 0], [0.37, 0.61]]) {
      const png = await page.evaluate(async ({ dx, dy, cx, cy }) => {
        const game = window.__game, ctx = game.ctx;
        // Same clock and flicker in every session, so two builds compare pixel for pixel.
        ctx.state.frameCount = 36000;
        const random = Math.random;
        Math.random = () => 0.5;
        window.__composeFlickerMid = true;
        ctx.camera.x = cx + dx; ctx.camera.y = cy + dy;
        game.composeDirty = true;
        for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
        const url = await new Promise((resolve) => {
          const r = game.renderer, orig = r.render;
          r.render = function (c) {
            orig.call(this, c);
            r.render = orig;
            resolve(r.domElement.toDataURL('image/png'));
          };
          game.composeDirty = true;
        });
        Math.random = random;
        window.__composeFlickerMid = false;
        return url;
      }, { dx, dy, cx: spot.cx, cy: spot.cy });
      const name = `${level}-rest-${dx === 0 ? 'whole' : 'frac'}-${label}.png`;
      writeFileSync(`${out}/${name}`, Buffer.from(png.split(',')[1], 'base64'));
      report.levels[level].rest.push(name);
    }
    if (restOnly) continue;

    for (const plane of PLANES[level] ?? [4]) {
      for (const v of DRIFTS) {
        const res = await page.evaluate(async ({ plane, v, spot }) => {
          const game = window.__game, ctx = game.ctx;
          const kit = game.composer.layers.activeKit.kit;
          const saved = kit.planes.map((p) => p.opacity);
          kit.planes.forEach((p, i) => { if (i !== plane) p.opacity = 0; });
          const s = kit.planes[plane].parallax;
          const canvas = game.renderer.domElement;
          const W = canvas.width, H = canvas.height, ppc = W / 640;
          const scratch = document.createElement('canvas');
          scratch.width = W; scratch.height = H;
          const g = scratch.getContext('2d', { willReadFrequently: true });
          // Canvas rows of each band, inset so a vertical nothing ever leaves them.
          const airY = Math.round((spot.air.vy + 2) * ppc), airH = Math.round(10 * ppc);
          const rockY = Math.round((spot.rock.vy + 2) * ppc), rockH = Math.round(10 * ppc);
          const luma = (img) => {
            const d = img.data, o = new Float32Array(img.width * img.height);
            for (let i = 0; i < o.length; i++) o[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
            return o;
          };
          // Each camera position renders twice, the plane shown then hidden: the
          // difference is that plane alone (world, sprites and motes cancel).
          const frames = [];
          // Twelve cells of camera travel.
          const N = v === 'ease' ? 60 : Math.round(12 / v) + 1;
          const at = (k) => (v === 'ease' ? 12 * (1 - 0.88 ** k) : v * k);
          const x0 = spot.cx + 0.001;
          ctx.camera.x = x0;
          ctx.camera.y = spot.cy;
          game.composeDirty = true;
          for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
          await new Promise((resolve) => {
            const r = game.renderer, orig = r.render;
            let k = 0, shown = null;
            r.render = function (c) {
              orig.call(this, c);
              g.drawImage(canvas, 0, 0);
              const air = luma(g.getImageData(0, airY, W, airH));
              if (shown === null) {
                shown = { air, rock: luma(g.getImageData(0, rockY, W, rockH)) };
                kit.planes[plane].opacity = 0;
              } else {
                for (let i = 0; i < air.length; i++) air[i] = shown.air[i] - air[i];
                frames.push({ cam: ctx.camera.presentationX, renderX: ctx.camera.renderX, air, rock: shown.rock });
                shown = null;
                kit.planes[plane].opacity = saved[plane];
                k++;
                if (k >= N) { r.render = orig; resolve(); return; }
                ctx.camera.x = x0 + at(k);
              }
              game.composeDirty = true;
            };
            game.composeDirty = true;
          });
          kit.planes.forEach((p, i) => { p.opacity = saved[i]; });
          // Sub-pixel shift of b against reference a (content moved by d px): mean
          // absolute difference at whole shifts around a guess, then the split
          // between the best shift and its better neighbour. Pixel art under the
          // overscanned quad moves edge by edge, so a frame is a mix of k and k±1.
          const sad = (a, b, rowsN, d) => {
            let e = 0, n = 0;
            for (let y = 0; y < rowsN; y++) {
              const row = y * W;
              for (let x = 96; x < W - 96; x++) { e += Math.abs(a[row + x] - b[row + x + d]); n++; }
            }
            return e / n;
          };
          const track = (key, rowsN) => {
            const pos = [0];
            let guess = 0;
            for (let i = 1; i < frames.length; i++) {
              const a = frames[0][key], b = frames[i][key];
              let bestD = guess, bestE = Infinity;
              const errs = new Map();
              for (let d = guess - 4; d <= guess + 4; d++) {
                const e = sad(a, b, rowsN, d);
                errs.set(d, e);
                if (e < bestE) { bestE = e; bestD = d; }
              }
              const lo = errs.get(bestD - 1) ?? sad(a, b, rowsN, bestD - 1), hi = errs.get(bestD + 1) ?? sad(a, b, rowsN, bestD + 1);
              const frac = lo < hi ? -bestE / Math.max(1e-6, bestE + lo) : bestE / Math.max(1e-6, bestE + hi);
              pos.push(bestD + frac);
              guess = bestD;
            }
            return pos;
          };
          const worldPos = track('rock', rockH), backPos = track('air', airH);
          const r2 = (x) => Math.round(x * 100) / 100;
          const world = [], back = [], idealStep = [];
          let backErr = 0, worldErr = 0, backwards = 0, maxBack = 0;
          for (let i = 1; i < frames.length; i++) {
            const travel = frames[i].cam - frames[0].cam, step = frames[i].cam - frames[i - 1].cam;
            world.push(r2(worldPos[i] - worldPos[i - 1]));
            back.push(r2(backPos[i] - backPos[i - 1]));
            idealStep.push(r2(-ppc * s * step));
            worldErr = Math.max(worldErr, Math.abs(worldPos[i] + ppc * travel));
            backErr = Math.max(backErr, Math.abs(backPos[i] + ppc * s * travel));
            // A step against the camera's direction (the plane lurching back).
            const d = backPos[i] - backPos[i - 1];
            if (d > 0.25) { backwards++; maxBack = Math.max(maxBack, d); }
          }
          return { plane, label: kit.planes[plane].label, parallax: s, scale: kit.planes[plane].scale, v, frames: frames.length,
            world, backdrop: back, idealStep, worldErrPx: r2(worldErr), backdropErrPx: r2(backErr), backwardSteps: backwards,
            maxBackwardPx: r2(maxBack), backdropTrack: backPos.map(r2), worldTrack: worldPos.map(r2),
            idealTrack: frames.map((f) => r2(-ppc * s * (f.cam - frames[0].cam))),
            renderX: frames.map((f) => f.renderX) };
        }, { plane, v, spot });
        report.levels[level].drifts.push(res);
        const seq = (a) => a.slice(0, 24).map((x) => x.toFixed(2)).join(' ');
        console.log(`  ${level} plane ${plane} "${res.label}" s=${res.parallax} scale ${res.scale}, ${v === 'ease' ? 'eased follow' : `drift ${v} cell/frame`}:`);
        console.log(`    backdrop worst error ${res.backdropErrPx}px, ${res.backwardSteps} backward lurches (max ${res.maxBackwardPx}px); world worst error ${res.worldErrPx}px`);
        console.log(`    backdrop px/frame: ${seq(res.backdrop)}`);
        console.log(`    ideal    px/frame: ${seq(res.idealStep)}`);
        console.log(`    world    px/frame: ${seq(res.world)}`);
        if (label === 'after' && !cpu && (res.backwardSteps > 0 || res.backdropErrPx > 1.01)) failed = true;
      }
    }
    await page.evaluate(() => {
      const ctx = window.__game.ctx;
      ctx.state.paused = false;
      ctx.state.postFx.gpuCompose = true;
      ctx.camera.zoomLock = null;
    });
  }
  if (report.errors.length) failed = true;
} finally {
  writeFileSync(`${out}/parallax-drift-${label}.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(report.errors.length ? `page errors: ${report.errors.join(' | ')}` : 'no page errors');
if (failed) {
  console.log('FAIL');
  process.exit(1);
}
console.log('done');

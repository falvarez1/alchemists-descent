// Surface-flora flicker, measured on what the painter actually emits. Starts its own
// fresh dev server (a hot-reloaded one hands import() a second module instance).
//   node scripts/probe-flora-flicker.mjs [--spots=0,2,4] [--frames=220] [--level=d1]
// At each spot the alchemist walks right through the plants and back with real key
// presses while every flora bitmap is followed frame to frame (by base position) and
// its mean colour compared with the previous frame (only while he is not touching it:
// a pushed plant really moves). Wind and a lean step change a plant a little and
// rarely; flicker changes it a lot and often.
// Fails when any plant swings more than 60% in one frame or moves >6% in more than 25 frames.
import { spawn } from 'node:child_process';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, startConsoleTestRun } from './run-helpers.mjs';

const arg = (name, d) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? d;
const spots = arg('spots', '0,2,4').split(',').map(Number), frames = Number(arg('frames', 220)), level = arg('level', 'd1');
const port = 5197;
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
const browser = await launchBrowser();
let failed = false;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  for (const spotIndex of spots) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/?link=off`, { waitUntil: 'networkidle', timeout: 90000 });
    await leaveTitleIfShown(page);
    await startConsoleTestRun(page, { level, world: 'campaign-level', seed: 1337, settleMs: 1500, timeout: 90000 });
    const walk = (async () => {
      await new Promise(r => setTimeout(r, 2200));
      await page.keyboard.down('KeyD'); await new Promise(r => setTimeout(r, 1400)); await page.keyboard.up('KeyD');
      await page.keyboard.down('KeyA'); await new Promise(r => setTimeout(r, 900)); await page.keyboard.up('KeyA');
    })();
    const result = await page.evaluate(async ({ spotIndex, frames }) => {
      const g = window.__game, ctx = g.ctx, w = ctx.world;
      const { surfaceFoliageInBounds } = await import('/src/game/SurfaceFoliage.ts');
      ctx.player.godMode = true; ctx.state.arrivalGraceUntil = 0; ctx.enemies.length = 0;
      const front = surfaceFoliageInBounds(w, 0, 0, w.width, w.height).filter(p => p.foreground);
      const picks = [];
      for (const p of front) if (picks.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 260)) picks.push({ x: p.x, y: p.y });
      const spot = picks[Math.min(spotIndex, picks.length - 1)];
      Object.assign(ctx.player, { x: spot.x - 70, y: spot.y, vx: 0, vy: 0 });
      ctx.camera.zoomLock = 1.7; ctx.camera.snapTo(spot.x, spot.y - 20); ctx.state.paused = false;
      await new Promise(r => setTimeout(r, 1500));
      const comp = g.composer, blit = comp.blitFine.bind(comp);
      let calls = null;
      comp.blitFine = (x0, y0, ww, h, rgb, al, glow) => {
        if (calls && (new Error().stack ?? '').includes('FloraPainter')) {
          let sum = 0, n = 0;
          for (let k = 0; k < ww * h; k++) if (al[k] > 0) { sum += rgb[k * 3] + rgb[k * 3 + 1] + rgb[k * 3 + 2]; n++; }
          calls.push({ cx: x0 + ww * comp.pixelStep * .5, by: y0 + h * comp.pixelStep, mean: n ? sum / n : 0 });
        }
        return blit(x0, y0, ww, h, rgb, al, glow);
      };
      const tracks = new Map();
      let prev = [], next = 0;
      await new Promise(done => {
        let n = 0;
        const frame = () => {
          if (calls) {
            for (const c of calls) {
              let best = null, bd = 2.5;
              for (const p of prev) { const d = Math.hypot(p.cx - c.cx, p.by - c.by); if (d < bd && !p.taken) { bd = d; best = p; } }
              if (best) { best.taken = true; c.id = best.id; } else c.id = next++;
              let t = tracks.get(c.id);
              if (!t) tracks.set(c.id, t = { x: Math.round(c.cx), y: Math.round(c.by), last: null, jumps: 0, worst: 0 });
              // A plant the alchemist is pushing through really is moving: judge only the untouched ones.
              if (t.last !== null && Math.abs(c.cx - ctx.player.x) > 18) {
                // Relative, but only where it can be seen: near-black plants (designed
                // darkness, a lantern still approaching) change by invisible amounts.
                const step = Math.abs(c.mean - t.last), d = step / Math.max(.01, t.last);
                if (step > .03) { t.worst = Math.max(t.worst, d); if (d > .06) t.jumps++; }
              }
              t.last = c.mean;
            }
            prev = calls;
          }
          calls = [];
          if (++n < frames) requestAnimationFrame(frame); else done();
        };
        requestAnimationFrame(frame);
      });
      comp.blitFine = blit;
      const all = [...tracks.values()];
      const worst = all.reduce((a, t) => (t.worst > a.worst ? t : a), { worst: 0 });
      const busiest = all.reduce((a, t) => (t.jumps > a.jumps ? t : a), { jumps: 0 });
      return { spot, plants: all.length, worstSwing: +worst.worst.toFixed(3), worstAt: [worst.x, worst.y], mostJumps: busiest.jumps, mostAt: [busiest.x, busiest.y] };
    }, { spotIndex, frames });
    await walk.catch(() => {});
    const ok = result.worstSwing <= .6 && result.mostJumps <= 25;
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  spot ${spotIndex} ${JSON.stringify(result)}`);
    await page.close();
  }
} finally { await browser.close(); vite.kill(); }
if (failed) process.exitCode = 1;

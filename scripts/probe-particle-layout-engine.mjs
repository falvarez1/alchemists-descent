// Same-session AoS-vs-SoA particle-layout A/B in the REAL game runtime (Edge).
//
// Confirms the Node microbench result holds in the actual browser V8/Edge the
// game ships on, and measures the full per-frame particle cost (update + the
// FxSprites draw traversal). Drift-proof: AoS and SoA alternate within one page
// so thermal/JIT drift cancels. The timed evaluate() blocks the main thread, so
// the live game's rAF loop does not interfere with the measurement.
//
// Usage: node scripts/probe-particle-layout-engine.mjs [url] [frames] [reps]
import { chromium } from 'playwright-core';
import { writeJson, newBenchmarkPage } from './perf-harness.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const FRAMES = Number(process.argv[3] ?? 400);
const REPS = Number(process.argv[4] ?? 4);
const COUNTS = [4000, 16000, 64000, 256000];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await newBenchmarkPage(browser, { diagnosticsLabel: 'particle-layout' });
page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const out = await page.evaluate(
  async ({ FRAMES, REPS, COUNTS }) => {
    // ---- self-contained, mirrors scripts/bench-particle-layout.mjs ----
    const GW = 900, GH = 600, EMPTY = 0, SOLID = 13;
    const world = new Uint8Array(GW * GH);
    let ws = 0x12345678 >>> 0;
    for (let i = 0; i < GW * GH; i++) {
      ws = (ws * 1664525 + 1013904223) >>> 0;
      if (ws / 4294967296 < 0.03) world[i] = SOLID;
    }
    const idx = (x, y) => x + y * GW;
    const inB = (x, y) => x >= 0 && x < GW && y >= 0 && y < GH;
    const FBW = 960, FBH = 540;
    const fb = new Float32Array(FBW * FBH * 3);
    const drawPx = (x, y, r, g, b) => {
      const gx = ((x | 0) % FBW + FBW) % FBW, gy = ((y | 0) % FBH + FBH) % FBH;
      const o = (gx + gy * FBW) * 3;
      fb[o] = r; fb[o + 1] = g; fb[o + 2] = b;
    };
    const mulberry32 = (seed) => {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const spawnParams = (rng) => {
      const ang = rng() * Math.PI * 2, sp = 0.4 + rng() * 1.6;
      return {
        x: 100 + rng() * (GW - 200), y: 80 + rng() * (GH - 200),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.8,
        type: rng() < 0.4 ? (rng() * 35) | 0 : -1, color: (rng() * 0xffffff) | 0,
        life: 60 + ((rng() * 120) | 0), grav: 0.16,
        glow: rng() < 0.3 ? rng() * 2 : 0, homing: rng() < 0.05 ? 1 : 0,
        value: 10, hostileDmg: 0,
      };
    };

    function runAoS(N, frames, rng) {
      const list = [], free = [];
      const spawn = () => {
        const s = spawnParams(rng); const p = free.pop() ?? {};
        p.x = s.x; p.y = s.y; p.vx = s.vx; p.vy = s.vy; p.type = s.type; p.color = s.color;
        p.life = s.life; p.grav = s.grav; p.glow = s.glow; p.homing = s.homing; p.value = s.value; p.hostileDmg = s.hostileDmg;
        list.push(p);
      };
      for (let i = 0; i < N; i++) spawn();
      const removeAt = (i) => { const r = list[i], last = list.length - 1; if (i !== last) list[i] = list[last]; list.pop(); free.push(r); };
      const times = new Float64Array(frames);
      for (let f = 0; f < frames; f++) {
        const t0 = performance.now();
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          p.life--;
          if (p.homing) { p.vx *= 0.92; p.vy *= 0.92; } else { p.vy += p.grav; }
          p.x += p.vx; p.y += p.vy;
          const gx = p.x | 0, gy = p.y | 0;
          if (!inB(gx, gy) || p.life <= 0) { removeAt(i); continue; }
          if (world[idx(gx, gy)] !== EMPTY) removeAt(i);
        }
        for (let i = list.length; i < N; i++) spawn();
        for (let i = 0; i < list.length; i++) {
          const p = list[i], c = p.color;
          const k = p.glow > 0 ? p.glow : 0.5;
          drawPx(p.x, p.y, (((c >> 16) & 255) / 255) * k, (((c >> 8) & 255) / 255) * k, ((c & 255) / 255) * k);
        }
        times[f] = performance.now() - t0;
      }
      return times;
    }

    function runSoA(N, frames, rng) {
      const cap = N + 16;
      const px = new Float32Array(cap), py = new Float32Array(cap), vx = new Float32Array(cap), vy = new Float32Array(cap);
      const life = new Float32Array(cap), grav = new Float32Array(cap), glow = new Float32Array(cap);
      const value = new Float32Array(cap), hostileDmg = new Float32Array(cap);
      const color = new Int32Array(cap), type = new Int32Array(cap), homing = new Uint8Array(cap);
      let count = 0;
      const spawn = () => {
        const s = spawnParams(rng); const i = count++;
        px[i] = s.x; py[i] = s.y; vx[i] = s.vx; vy[i] = s.vy; type[i] = s.type; color[i] = s.color;
        life[i] = s.life; grav[i] = s.grav; glow[i] = s.glow; homing[i] = s.homing; value[i] = s.value; hostileDmg[i] = s.hostileDmg;
      };
      for (let i = 0; i < N; i++) spawn();
      const removeAt = (i) => {
        const last = --count; if (i === last) return;
        px[i] = px[last]; py[i] = py[last]; vx[i] = vx[last]; vy[i] = vy[last]; type[i] = type[last]; color[i] = color[last];
        life[i] = life[last]; grav[i] = grav[last]; glow[i] = glow[last]; homing[i] = homing[last]; value[i] = value[last]; hostileDmg[i] = hostileDmg[last];
      };
      const times = new Float64Array(frames);
      for (let f = 0; f < frames; f++) {
        const t0 = performance.now();
        for (let i = count - 1; i >= 0; i--) {
          life[i] -= 1;
          if (homing[i]) { vx[i] *= 0.92; vy[i] *= 0.92; } else { vy[i] += grav[i]; }
          px[i] += vx[i]; py[i] += vy[i];
          const gx = px[i] | 0, gy = py[i] | 0;
          if (!inB(gx, gy) || life[i] <= 0) { removeAt(i); continue; }
          if (world[idx(gx, gy)] !== EMPTY) removeAt(i);
        }
        for (let i = count; i < N; i++) spawn();
        for (let i = 0; i < count; i++) {
          const c = color[i], k = glow[i] > 0 ? glow[i] : 0.5;
          drawPx(px[i], py[i], (((c >> 16) & 255) / 255) * k, (((c >> 8) & 255) / 255) * k, ((c & 255) / 255) * k);
        }
        times[f] = performance.now() - t0;
      }
      return times;
    }

    const p50 = (arr) => { const a = Array.from(arr).sort((x, y) => x - y); return a[(a.length * 0.5) | 0]; };
    const results = [];
    for (const N of COUNTS) {
      runAoS(Math.min(N, 4000), 40, mulberry32(1)); // warm
      runSoA(Math.min(N, 4000), 40, mulberry32(1));
      const aosP = [], soaP = [];
      for (let r = 0; r < REPS; r++) {
        // alternate to cancel drift
        aosP.push(p50(runAoS(N, FRAMES, mulberry32(1000 + r))));
        soaP.push(p50(runSoA(N, FRAMES, mulberry32(1000 + r))));
      }
      aosP.sort((a, b) => a - b); soaP.sort((a, b) => a - b);
      const aos = aosP[0], soa = soaP[0]; // best-of-reps p50 (least noise)
      results.push({ N, aosMs: aos, soaMs: soa, speedup: aos / soa });
    }
    return { results, fbSum: fb[0] };
  },
  { FRAMES, REPS, COUNTS },
);

await page.context().close();
await browser.close();

console.log(`\n=== IN-ENGINE (Edge) AoS vs SoA-f32 — update + draw, per frame ===`);
console.log(`frames/measure=${FRAMES} reps=${REPS} (best-of-reps p50)\n`);
for (const r of out.results) {
  console.log(
    `N=${String(r.N).padStart(7)}  AoS ${r.aosMs.toFixed(3)}ms  SoA ${r.soaMs.toFixed(3)}ms  ${r.speedup.toFixed(2)}x`,
  );
}
writeJson('verify-out/probe-particle-layout-engine.json', {
  createdAt: new Date().toISOString(), url, frames: FRAMES, reps: REPS, results: out.results,
});
console.log('\nwrote verify-out/probe-particle-layout-engine.json');

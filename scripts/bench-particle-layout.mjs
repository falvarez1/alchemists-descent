// Isolated AoS-vs-SoA particle-update microbenchmark (Node / V8).
//
// Purpose: measure the *data-layout* effect on the particle hot loop in
// isolation, across scaling populations, to decide whether converting
// src/particles/Particles.ts from an array-of-objects (AoS) to parallel
// typed arrays (SoA) is worth it as the game scales entity/particle counts up.
//
// Methodology notes (so the numbers are auditable):
//  - The update loop faithfully mirrors Particles.update: life--, gravity
//    integrate, position integrate, bounds check, world-grid sample, and
//    swap-remove on death. Side effects that don't touch particle memory
//    (audio/events/score) are omitted — they're identical for both layouts.
//  - The AoS variant is POOLED with a free-list, exactly like the current
//    Particles.ts. That's the fair baseline: the current code already avoids
//    per-spawn GC. So any SoA win here is CACHE LOCALITY, not GC churn.
//  - Population is refilled to exactly N at the end of every frame (a particle
//    fountain at saturation), so both layouts process the same N each frame.
//  - Three layouts are compared:
//      AoS      : array of plain objects (doubles), free-list pooled
//      SoA-f64  : parallel Float64Array (doubles) — same numeric precision as
//                 AoS, so this isolates PURE LAYOUT effect (lockstep work).
//      SoA-f32  : parallel Float32Array — the layout a real refactor would use
//                 (sub-pixel precision is fine for particles); shows the extra
//                 cache win from halving per-field memory.
//  - Shared seeded RNG per (variant,N) phase so spawn params match.
//
// Run with:  node --expose-gc scripts/bench-particle-layout.mjs
// Optional:  node --expose-gc scripts/bench-particle-layout.mjs 800 5   (frames, reps)

import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';

const FRAMES = Number(process.argv[2] ?? 800);
const REPS = Number(process.argv[3] ?? 5);
const COUNTS = [1000, 4000, 16000, 64000, 256000];

// Representative draw surface (mirrors FxSprites.drawParticles: read x/y/color/
// glow per particle, scatter-write into a frame buffer). The READ of the
// particle fields is the layout-sensitive part; the buffer write is a shared
// constant. Every frame in-engine pays update + draw, so the bench does too.
const FBW = 960, FBH = 540;
const fb = new Float32Array(FBW * FBH * 3);
const drawPx = (x, y, r, g, b) => {
  const gx = ((x | 0) % FBW + FBW) % FBW;
  const gy = ((y | 0) % FBH + FBH) % FBH;
  const o = (gx + gy * FBW) * 3;
  fb[o] = r; fb[o + 1] = g; fb[o + 2] = b;
};

// Representative world window (cells). A sparse scatter of solids so a small
// fraction of particles "hit" terrain each frame and get recycled — same grid
// for every layout, so its cost is a shared constant.
const GW = 900;
const GH = 600;
const EMPTY = 0;
const SOLID = 13;
const world = new Uint8Array(GW * GH);
(function seedWorld() {
  // ~3% solid cells, deterministic scatter
  let s = 0x12345678 >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < GW * GH; i++) if (rnd() < 0.03) world[i] = SOLID;
})();
const idx = (x, y) => x + y * GW;
const inBounds = (x, y) => x >= 0 && x < GW && y >= 0 && y < GH;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Spawn parameters drawn from rng — identical sequence feeds every layout.
function spawnParams(rng) {
  const a = rng() * Math.PI * 2;
  const sp = 0.4 + rng() * 1.6;
  return {
    x: 100 + rng() * (GW - 200),
    y: 80 + rng() * (GH - 200),
    vx: Math.cos(a) * sp,
    vy: Math.sin(a) * sp - 0.8,
    type: rng() < 0.4 ? (rng() * 35) | 0 : -1, // -1 == null (purely visual)
    color: (rng() * 0xffffff) | 0,
    life: 60 + ((rng() * 120) | 0),
    grav: 0.16,
    glow: rng() < 0.3 ? rng() * 2 : 0,
    homing: rng() < 0.05 ? 1 : 0,
    value: 10,
    hostileDmg: 0,
  };
}

/* ----------------------------- AoS (pooled) ----------------------------- */
function runAoS(N, frames, rng, withDraw) {
  const list = [];
  const free = [];
  const spawn = () => {
    const sp = spawnParams(rng);
    const p = free.pop() ?? {};
    // Assign in a FIXED order → stable hidden class (matches Particles.spawn).
    p.x = sp.x; p.y = sp.y; p.vx = sp.vx; p.vy = sp.vy;
    p.type = sp.type; p.color = sp.color; p.life = sp.life;
    p.grav = sp.grav; p.glow = sp.glow; p.homing = sp.homing;
    p.value = sp.value; p.hostileDmg = sp.hostileDmg;
    list.push(p);
  };
  for (let i = 0; i < N; i++) spawn();

  const removeAt = (i) => {
    const removed = list[i];
    const last = list.length - 1;
    if (i !== last) list[i] = list[last];
    list.pop();
    free.push(removed);
  };

  let sink = 0;
  const times = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life--;
      if (p.homing) {
        p.vx *= 0.92; p.vy *= 0.92;
      } else {
        p.vy += p.grav;
      }
      p.x += p.vx; p.y += p.vy;
      const gx = p.x | 0, gy = p.y | 0;
      if (!inBounds(gx, gy) || p.life <= 0) { removeAt(i); continue; }
      const cell = world[idx(gx, gy)];
      if (cell !== EMPTY) { sink += cell; removeAt(i); }
    }
    // refill to N
    for (let i = list.length; i < N; i++) spawn();
    if (withDraw) {
      // mirror FxSprites.drawParticles field-access pattern
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const c = p.color;
        const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
        const k = p.glow > 0 ? p.glow : 0.5;
        drawPx(p.x, p.y, r * k, g * k, b * k);
      }
    }
    times[f] = performance.now() - t0;
  }
  return { times, sink, alive: list.length };
}

/* ------------------------------- SoA ------------------------------------ */
function makeSoA(Float) {
  return function runSoA(N, frames, rng, withDraw) {
    const cap = N + 16;
    const px = new Float(cap), py = new Float(cap);
    const vx = new Float(cap), vy = new Float(cap);
    const life = new Float(cap), grav = new Float(cap), glow = new Float(cap);
    const value = new Float(cap), hostileDmg = new Float(cap);
    const color = new Int32Array(cap), type = new Int32Array(cap);
    const homing = new Uint8Array(cap);
    let count = 0;

    const spawn = () => {
      const sp = spawnParams(rng);
      const i = count++;
      px[i] = sp.x; py[i] = sp.y; vx[i] = sp.vx; vy[i] = sp.vy;
      type[i] = sp.type; color[i] = sp.color; life[i] = sp.life;
      grav[i] = sp.grav; glow[i] = sp.glow; homing[i] = sp.homing;
      value[i] = sp.value; hostileDmg[i] = sp.hostileDmg;
    };
    for (let i = 0; i < N; i++) spawn();

    const removeAt = (i) => {
      const last = --count;
      if (i !== last) {
        px[i] = px[last]; py[i] = py[last]; vx[i] = vx[last]; vy[i] = vy[last];
        type[i] = type[last]; color[i] = color[last]; life[i] = life[last];
        grav[i] = grav[last]; glow[i] = glow[last]; homing[i] = homing[last];
        value[i] = value[last]; hostileDmg[i] = hostileDmg[last];
      }
    };

    let sink = 0;
    const times = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      const t0 = performance.now();
      for (let i = count - 1; i >= 0; i--) {
        life[i] -= 1;
        if (homing[i]) {
          vx[i] *= 0.92; vy[i] *= 0.92;
        } else {
          vy[i] += grav[i];
        }
        px[i] += vx[i]; py[i] += vy[i];
        const gx = px[i] | 0, gy = py[i] | 0;
        if (!inBounds(gx, gy) || life[i] <= 0) { removeAt(i); continue; }
        const cell = world[idx(gx, gy)];
        if (cell !== EMPTY) { sink += cell; removeAt(i); }
      }
      for (let i = count; i < N; i++) spawn();
      if (withDraw) {
        for (let i = 0; i < count; i++) {
          const c = color[i];
          const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
          const k = glow[i] > 0 ? glow[i] : 0.5;
          drawPx(px[i], py[i], r * k, g * k, b * k);
        }
      }
      times[f] = performance.now() - t0;
    }
    return { times, sink, alive: count };
  };
}
const runSoA64 = makeSoA(Float64Array);
const runSoA32 = makeSoA(Float32Array);

/* ----------------------------- harness ---------------------------------- */
function stats(arr) {
  const a = Array.from(arr).sort((x, y) => x - y);
  const n = a.length;
  const mean = a.reduce((s, v) => s + v, 0) / n;
  return {
    mean,
    p50: a[(n * 0.5) | 0],
    p95: a[(n * 0.95) | 0],
    max: a[n - 1],
  };
}

function bench(label, fn, N, withDraw) {
  // warm-up (JIT) on a small separate run, then forced GC, then measure.
  fn(Math.min(N, 4000), 60, mulberry32(1), withDraw);
  if (globalThis.gc) globalThis.gc();
  const heap0 = process.memoryUsage().heapUsed;
  let best = null;
  for (let r = 0; r < REPS; r++) {
    const res = fn(N, FRAMES, mulberry32(1000 + r), withDraw);
    const s = stats(res.times);
    if (!best || s.p50 < best.p50) best = { ...s, sink: res.sink, alive: res.alive };
  }
  const heap1 = process.memoryUsage().heapUsed;
  return { label, N, withDraw, ...best, heapDeltaMB: (heap1 - heap0) / (1024 * 1024) };
}

const results = [];
console.log(`particle-layout bench: frames=${FRAMES} reps=${REPS} (best-of-reps p50)`);
console.log(`world ${GW}x${GH}, ~3% solid; AoS pooled w/ free-list (matches current code)`);
console.log(`each measurement = one full per-frame pass; "+draw" adds the FxSprites read traversal\n`);

for (const N of COUNTS) {
  console.log(`N=${N}`);
  for (const withDraw of [false, true]) {
    const tag = withDraw ? 'update+draw' : 'update only ';
    const aos = bench('AoS', runAoS, N, withDraw);
    const soa64 = bench('SoA-f64', runSoA64, N, withDraw);
    const soa32 = bench('SoA-f32', runSoA32, N, withDraw);
    results.push(aos, soa64, soa32);
    const base = aos.mean;
    const sp = (v) => `${(base / v.mean).toFixed(2)}x`;
    console.log(`  [${tag}] AoS ${aos.mean.toFixed(3)}ms (p95 ${aos.p95.toFixed(3)}) ns/p ${((aos.mean * 1e6) / N).toFixed(1)} heapΔ ${aos.heapDeltaMB.toFixed(0)}MB`);
    console.log(`  [${tag}] SoA-f64 ${soa64.mean.toFixed(3)}ms ${sp(soa64)}  |  SoA-f32 ${soa32.mean.toFixed(3)}ms ${sp(soa32)} heapΔ ${soa32.heapDeltaMB.toFixed(0)}MB`);
  }
  console.log('');
}

mkdirSync('verify-out', { recursive: true });
writeFileSync(
  'verify-out/bench-particle-layout.json',
  JSON.stringify({ createdAt: new Date().toISOString(), frames: FRAMES, reps: REPS, world: { GW, GH }, results }, null, 2) + '\n',
);
console.log('wrote verify-out/bench-particle-layout.json');

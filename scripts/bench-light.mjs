// Light-propagation micro-benchmark: the TS reference (render/propagateLight.ts)
// vs the AssemblyScript SIMD kernels (assembly/light.ts), on a synthetic
// half-res field shaped like a cave view (rock blobs, a liquid pool, lights).
// Reports ms per propagation and the max difference from the reference.
// Usage: node scripts/bench-light.mjs [reps=300]   (after npm run build:wasm)
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const REPS = Number(process.argv[2] ?? 300);
const LW = 321, LH = 181, N = LW * LH;
const server = await createServer({ logLevel: 'error', server: { hmr: false, middlewareMode: true, watch: null } });
try {
  const { propagateLight } = await server.ssrLoadModule('/src/render/propagateLight.ts');
  const wasm = new WebAssembly.Instance(new WebAssembly.Module(readFileSync('build/light.wasm')), { env: { abort() { throw new Error('abort'); } } }).exports;
  // (the kernel the game embeds: src/render/lightWasm.ts is this file, base64)

  // Synthetic field.
  let s = 99;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const att = new Float32Array(N), seedR = new Float32Array(N), seedG = new Float32Array(N), seedB = new Float32Array(N);
  const blobs = Array.from({ length: 14 }, () => [rnd() * LW, rnd() * LH, 10 + rnd() * 40]);
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
    const i = y * LW + x;
    let a = 0.86;
    for (const [bx, by, br] of blobs) if ((x - bx) ** 2 + (y - by) ** 2 < br * br) a = 0.4;
    if (y > LH - 20 && x > 60 && x < 200) a = 0.8;
    att[i] = a;
  }
  for (let k = 0; k < 24; k++) {
    const i = ((rnd() * LH) | 0) * LW + ((rnd() * LW) | 0);
    seedR[i] = 0.5 + rnd(); seedG[i] = seedR[i] * 0.55; seedB[i] = seedR[i] * 0.14;
  }
  for (let k = 0; k < 400; k++) { const i = (rnd() * N) | 0; seedR[i] = 0.6; seedG[i] = 0.27; seedB[i] = 0.05; }

  const time = (fn) => {
    const t = [];
    for (let r = 0; r < REPS; r++) { const t0 = performance.now(); fn(); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    return { median: t[t.length >> 1], min: t[0] };
  };

  // Reference.
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  const runJs = () => { R.set(seedR); G.set(seedG); B.set(seedB); propagateLight(LW, LH, R, G, B, att); };
  const js = time(runJs);
  runJs();
  let subnormal = 0;
  for (const p of [R, G, B]) for (let i = 0; i < N; i++) if (p[i] !== 0 && p[i] < 1.1754943508222875e-38) subnormal++;

  // WASM.
  const bytes = N * 4;
  const rp = wasm.alloc(bytes), gp = wasm.alloc(bytes), bp = wasm.alloc(bytes), ap = wasm.alloc(bytes), lp = wasm.alloc(N * 32);
  const mem = () => new Float32Array(wasm.memory.buffer);
  const outR = new Float32Array(N), outG = new Float32Array(N), outB = new Float32Array(N);
  const runWasm = (fnName) => () => {
    const m = mem();
    m.set(seedR, rp >> 2); m.set(seedG, gp >> 2); m.set(seedB, bp >> 2); m.set(att, ap >> 2);
    wasm[fnName](rp, gp, bp, ap, lp, LW, LH);
    outR.set(m.subarray(rp >> 2, (rp >> 2) + N)); outG.set(m.subarray(gp >> 2, (gp >> 2) + N)); outB.set(m.subarray(bp >> 2, (bp >> 2) + N));
  };
  const report = (name, fn) => {
    const t = time(fn);
    fn();
    let maxAbs = 0, maxRel = 0, diffs = 0;
    for (const [a, b] of [[R, outR], [G, outG], [B, outB]]) for (let i = 0; i < N; i++) {
      if (a[i] !== b[i]) { diffs++; const d = Math.abs(a[i] - b[i]); maxAbs = Math.max(maxAbs, d); maxRel = Math.max(maxRel, d / Math.max(1e-30, Math.abs(a[i]))); }
    }
    console.log(`${name.padEnd(12)} median ${t.median.toFixed(3)} ms  min ${t.min.toFixed(3)}  x${(js.median / t.median).toFixed(2)}  diffs ${diffs}  maxAbs ${maxAbs.toExponential(2)}  maxRel ${maxRel.toExponential(2)}`);
  };
  console.log(`js-ref       median ${js.median.toFixed(3)} ms  min ${js.min.toFixed(3)}  (subnormal texels: ${subnormal})`);
  report('wasm-exact', runWasm('propagateExact'));
} finally {
  await server.close();
}

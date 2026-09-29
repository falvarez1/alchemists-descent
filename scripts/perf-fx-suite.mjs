// FX / physics stress suite: the before/after gate for the GPU-FX perf branch.
//
// Scenes (each recorded in the same page, in order):
//   quiet      the seed-777 test level as generated (real scenery, a few foes)
//   chaos      metal arena: water+lava slabs, burning oil, sand columns, foes, a bomb every 700 ms
//   particles  12k live motes (half self-lit embers, half light-sampled) in carved air
//   flood      a whole view (640x360) of falling sand / water / oil with a fire line
//   boss       boss-fight FX storm: ~60 live spell projectiles, lightning casts, ember
//              bursts, explosions and a few foes — the "crazy boss fight" load
//   bodies     80 dynamic rigid bodies (boxes + circles, wood/stone/metal) under repeated blasts
//
// Stress scenes run on the authored physics-test level (findability repair never
// re-carves it). Every scene is rebuilt deterministically (seeded placement).
//
// Usage:
//   node scripts/perf-fx-suite.mjs [--url U] [--label L] [--frames N] [--scenes a,b] [--profile]
//   node scripts/perf-fx-suite.mjs --ab URL_A,URL_B [--blocks 2] ...   interleaved A/B (A,B,B,A...)
//   node scripts/perf-fx-suite.mjs --compare verify-out/perf-fx-<label>.json ...
// Writes verify-out/perf-fx-<label>.json (per-scene bucket stats + raw per-frame samples).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { newBenchmarkPage, emptyBuckets, addSampleBuckets, summarizeBuckets, welchT } from './perf-harness.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const URL_ONE = arg('url', 'http://127.0.0.1:5190/');
const AB = arg('ab', null)?.split(',');
const BLOCKS = Number(arg('blocks', AB ? 2 : 1));
const LABEL = arg('label', AB ? 'ab' : 'run');
const FRAMES = Number(arg('frames', 300));
const SCENES = (arg('scenes', 'quiet,chaos,particles,flood,boss,bodies')).split(',');
const PROFILE = flag('profile');
const COMPARE = arg('compare', null);
const THROTTLE = Number(arg('throttle', 1));
const KEYS = ['sim', 'entities', 'compose', 'gl', 'render', 'frame'];

mkdirSync('verify-out', { recursive: true });

// ---------------------------------------------------------------- scene setups
// Each runs in the page. `seed` makes placement identical across A/B runs.
const SETUPS = {
  quiet: () => {
    const ctx = window.__game.ctx;
    ctx.particles.clear();
    return { level: ctx.levels.current?.def.id };
  },

  chaos: ({ seed }) => {
    const h = window.__perfArena(seed, { w: 240, h: 90 });
    const { ctx, px, py, writeCell } = h;
    for (let dx = -110; dx <= -40; dx++) for (let dy = -60; dy <= -40; dy++) writeCell(px + dx, py + dy, 2, 0x1e8ce6);
    for (let dx = 40; dx <= 110; dx++) for (let dy = -60; dy <= -40; dy++) writeCell(px + dx, py + dy, 11, 0xfc3c08);
    for (let dx = -30; dx <= 30; dx++) for (let dy = 10; dy <= 16; dy++) writeCell(px + dx, py + dy, 6, 0x55401e);
    for (const cx of [-70, 0, 70]) for (let dy = -35; dy <= -20; dy++) for (let dx = -3; dx <= 3; dx++) writeCell(px + cx + dx, py + dy, 1, 0xd2b45e);
    for (let dx = -3; dx <= 3; dx++) writeCell(px + dx, py + 9, 5, 0xe65c00, 90);
    for (const [kind, dx] of [['slime', -80], ['slime', 60], ['imp', -50], ['imp', 50], ['golem', -90], ['bat', -30], ['bat', 30], ['spitter', 100]]) {
      ctx.enemyCtl.spawn(kind, px + dx, py + 10);
    }
    const offsets = [-90, -45, 0, 45, 90];
    let bomb = 0;
    h.every(700, () => {
      ctx.explosions.trigger(px + offsets[bomb % offsets.length], py - 10 - (bomb % 3) * 12, 11);
      bomb++;
    });
    return { enemies: ctx.enemies.length };
  },

  particles: ({ seed }) => {
    const h = window.__perfArena(seed, { w: 220, h: 80 });
    const { ctx, px, py, rnd } = h;
    for (let n = 0; n < 12000; n++) {
      const spark = rnd() < 0.5;
      const color = spark ? 0xff8c1e : ((130 + ((rnd() * 80) | 0)) << 16) | 0x2020;
      ctx.particles.spawn(px - 100 + rnd() * 200, py - 60 + rnd() * 70, 0, 0, null, color, 1e9, { grav: 0, glow: spark ? 1.2 : 0 });
    }
    return { live: ctx.particles.list.length };
  },

  flood: ({ seed }) => {
    const h = window.__perfArena(seed, { w: 640, h: 340 });
    const { px, py, writeCell } = h;
    const X0 = px - 319, X1 = px + 319, Y0 = py - 320;
    let cells = 0;
    for (let x = X0; x <= X1; x++) for (let y = Y0; y < Y0 + 90; y++) {
      const band = (((x - X0) / 40) | 0) % 3;
      const t = band === 0 ? 1 : band === 1 ? 2 : 6;
      writeCell(x, y, t, t === 1 ? 0xd2b45e : t === 2 ? 0x1e8ce6 : 0x55401e);
      cells++;
    }
    for (let x = X0; x <= X1; x += 3) writeCell(x, Y0 + 91, 5, 0xe65c00, 90);
    return { cells };
  },

  boss: ({ seed }) => {
    const h = window.__perfArena(seed, { w: 560, h: 260 });
    const { ctx, px, py, rnd } = h;
    for (const [kind, dx] of [['golem', -200], ['golem', 200], ['imp', -120], ['imp', 120], ['spitter', 0]]) ctx.enemyCtl.spawn(kind, px + dx, py + 10);
    const kinds = ['bolt', 'fireball', 'wisp', 'frostbolt', 'scatter', 'acidglob', 'pellet', 'meteor'];
    const embers = [0xffb040, 0xff6020, 0xffe070, 0x80d0ff, 0xc070ff];
    let k = 0;
    // A storm the arena can hold for the whole recording: keep ~60 projectiles in flight.
    h.every(50, () => {
      while (ctx.projectiles.length < 60) {
        const a = rnd() * Math.PI * 2, s = 2.5 + rnd() * 2.5;
        ctx.projectiles.push({
          x: px - 250 + rnd() * 500, y: py - 220 + rnd() * 150, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          type: kinds[k++ % kinds.length], life: 120, age: 0, charging: false, hostile: false,
        });
      }
    });
    h.every(160, () => ctx.lightning.cast(px - 250 + rnd() * 500, py - 230, Math.PI / 2 + (rnd() - 0.5) * 0.8));
    h.every(120, () => {
      const c = embers[(rnd() * embers.length) | 0];
      ctx.particles.burst(px - 240 + rnd() * 480, py - 200 + rnd() * 160, 160, null, () => c, 3.2, { glow: 1.4, grav: 0.05 });
    });
    h.every(900, () => ctx.explosions.trigger(px - 220 + rnd() * 440, py - 160 + rnd() * 120, 14));
    return { enemies: ctx.enemies.length };
  },

  bodies: ({ seed }) => {
    const h = window.__perfArena(seed, { w: 500, h: 240 });
    const { ctx, px, py, rnd } = h;
    const mats = ['wood', 'stone', 'metal'];
    let n = 0;
    for (let row = 0; row < 5; row++) for (let col = 0; col < 16; col++) {
      const x = px - 225 + col * 30 + rnd() * 6, y = py - 200 + row * 30;
      const material = mats[n % 3];
      if (n % 4 === 3) ctx.rigidBodies.spawn({ kind: 'circle', radius: 3 + rnd() * 3 }, x, y, { material });
      else ctx.rigidBodies.spawn({ kind: 'box', halfW: 3 + rnd() * 4, halfH: 3 + rnd() * 4 }, x, y, { material, angle: rnd() });
      n++;
    }
    let b = 0;
    h.every(800, () => {
      const x = px - 180 + (b++ % 5) * 90;
      ctx.explosions.trigger(x, py + 8, 10);
      ctx.rigidBodies.applyRadialImpulse(x, py + 8, 60, 6);
    });
    return { bodies: ctx.rigidBodies.bodies.length };
  },
};

// Installed once per page: arena carving, seeded rng, managed intervals.
function installHelpers() {
  window.__perfTimers ??= [];
  window.__perfArena = (seed, { w, h }) => {
    for (const t of window.__perfTimers) clearInterval(t);
    window.__perfTimers.length = 0;
    const ctx = window.__game.ctx;
    const world = ctx.world;
    let s = seed >>> 0;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    ctx.player.hp = ctx.player.maxHp = ctx.player.invuln = 999999;
    ctx.enemies.length = 0;
    ctx.projectiles.length = 0;
    ctx.shockwaves.length = 0;
    ctx.lightning.clear();
    ctx.particles.clear();
    ctx.rigidBodies.clear();
    if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0;
    const px = 800, floorY = 690, py = floorY - 19;
    const writeCell = (x, y, type, color, life = 0) => {
      if (!world.inBounds(x, y)) return;
      const i = world.idx(x, y);
      world.types[i] = type; world.colors[i] = color; world.life[i] = life; world.charge[i] = 0;
      world.activity.touchIndex(i);
    };
    const hw = w >> 1;
    for (let x = px - hw - 1; x <= px + hw + 1; x++) for (let y = floorY - h - 1; y <= floorY + 1; y++) {
      const edge = x === px - hw - 1 || x === px + hw + 1 || y === floorY - h - 1 || y >= floorY;
      writeCell(x, y, edge ? 13 : 0, edge ? 0x606870 : 0x08080c);
    }
    ctx.player.x = px; ctx.player.y = floorY - 1; ctx.player.vx = 0; ctx.player.vy = 0;
    ctx.camera.x = ctx.camera.tx = px - 320; ctx.camera.y = ctx.camera.ty = floorY - 250;
    const every = (ms, fn) => window.__perfTimers.push(setInterval(fn, ms));
    return { ctx, px, py, rnd, writeCell, every };
  };
}

// ---------------------------------------------------------------- recording
async function recordScene(page, cdp, name, url) {
  const setupResult = await page.evaluate(SETUPS[name], { seed: 0x5eed + name.length * 7919 });
  await page.waitForTimeout(name === 'bodies' ? 2500 : 1500); // let the scene reach steady state
  if (cdp && PROFILE) await cdp.send('Profiler.start');
  const res = await page.evaluate(async (FRAMES) => {
    window.__perfSamples = [];
    window.__perfTicks = [];
    window.__perfRecord = true;
    const t0 = performance.now();
    let peakParticles = 0, peakProjectiles = 0, peakBodies = 0;
    await new Promise((resolve) => {
      const check = () => {
        const ctx = window.__game.ctx;
        peakParticles = Math.max(peakParticles, ctx.particles.list.length);
        peakProjectiles = Math.max(peakProjectiles, ctx.projectiles.length);
        peakBodies = Math.max(peakBodies, ctx.rigidBodies.bodies.length);
        if ((window.__perfSamples?.length ?? 0) >= FRAMES) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
    window.__perfRecord = false;
    return {
      samples: window.__perfSamples, ticks: window.__perfTicks, wallMs: performance.now() - t0,
      peak: { particles: peakParticles, projectiles: peakProjectiles, bodies: peakBodies },
    };
  }, FRAMES);
  let top = null;
  if (cdp && PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    top = topFunctions(profile, 25);
  }
  await page.evaluate(() => { for (const t of window.__perfTimers ?? []) clearInterval(t); });
  const buckets = emptyBuckets();
  addSampleBuckets(buckets, res.samples);
  const summary = summarizeBuckets(buckets);
  const tickTotals = res.ticks.map((t) => t.total);
  summary.tick = summarizeBuckets({ v: tickTotals }).v;
  summary.fps = res.samples.length / (res.wallMs / 1000);
  summary.ticksPerFrame = res.ticks.length / Math.max(1, res.samples.length);
  return { name, url, setup: setupResult, peak: res.peak, summary, raw: { ...buckets, tick: tickTotals }, top };
}

function topFunctions(profile, n) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i]) / 1000;
    const cf = byId.get(profile.samples[i]).callFrame;
    const file = (cf.url || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '') || `(${cf.functionName || 'native'})`;
    const key = `${cf.functionName || '(anon)'}  ${file}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + dt);
    total += dt;
  }
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => ({ fn: k, pct: +(100 * ms / total).toFixed(2) }));
}

async function runBlock(browser, url) {
  const page = await newBenchmarkPage(browser, { diagnosticsLabel: 'perf-fx' });
  await page.setViewportSize({ width: 1280, height: 800 });
  page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.addScriptTag({ content: `(${installHelpers.toString()})()` });
  const out = [];
  let onArena = false;
  for (const name of SCENES) {
    if (name === 'quiet') {
      await startConsoleTestRun(page, { seed: 777, settleMs: 1500 });
      await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
      onArena = false;
    } else if (!onArena) {
      await startConsoleTestRun(page, { seed: 777, level: 'physics-test', settleMs: 1500 });
      onArena = true;
    }
    const r = await recordScene(page, cdp, name, url);
    printScene(r);
    out.push(r);
  }
  const env = await page.evaluate(() => {
    const c = document.querySelector('#canvas-holder > canvas');
    const gl = c?.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return { canvas: c ? `${c.width}x${c.height}` : null, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null };
  });
  await page.context().close();
  return { env, scenes: out };
}

function printScene(r) {
  const s = r.summary;
  const f = (k) => `${k} ${s[k].mean.toFixed(2)}/${s[k].p95.toFixed(1)}`;
  console.log(`  ${r.name.padEnd(9)} fps ${s.fps.toFixed(1).padStart(5)}  ${KEYS.map(f).join('  ')}  tick ${s.tick.mean.toFixed(2)} x${s.ticksPerFrame.toFixed(2)}  peak ${JSON.stringify(r.peak)}`);
  if (r.top) for (const t of r.top.slice(0, 12)) console.log(`      ${String(t.pct).padStart(5)}%  ${t.fn}`);
}

function mergeRaw(blocks, label) {
  const scenes = {};
  for (const b of blocks.filter((x) => x.label === label)) for (const s of b.result.scenes) {
    const m = (scenes[s.name] ??= { raw: {}, fps: [], peak: s.peak, top: s.top });
    for (const [k, v] of Object.entries(s.raw)) (m.raw[k] ??= []).push(...v);
    m.fps.push(s.summary.fps);
  }
  for (const m of Object.values(scenes)) {
    m.summary = summarizeBuckets(m.raw);
    m.summary.fps = m.fps.reduce((a, b) => a + b, 0) / m.fps.length;
  }
  return scenes;
}

function compareScenes(nameA, a, nameB, b) {
  console.log(`\n=== ${nameA} -> ${nameB}  (mean ms, Welch t; |t|>2 ≈ significant) ===`);
  for (const scene of Object.keys(b)) {
    if (!a[scene]) continue;
    const parts = [];
    for (const k of [...KEYS, 'tick']) {
      const ra = a[scene].raw[k], rb = b[scene].raw[k];
      if (!ra?.length || !rb?.length) continue;
      const ma = a[scene].summary[k].mean, mb = b[scene].summary[k].mean;
      const pct = ma > 0 ? ((mb - ma) / ma) * 100 : 0;
      const { t } = welchT(ra, rb);
      parts.push(`${k} ${ma.toFixed(2)}→${mb.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%${Math.abs(t) > 2 ? '' : ' ns'})`);
    }
    const fa = a[scene].summary.fps, fb = b[scene].summary.fps;
    console.log(`  ${scene.padEnd(9)} fps ${fa.toFixed(1)}→${fb.toFixed(1)}  ${parts.join('  ')}`);
  }
}

// ---------------------------------------------------------------- main
const browser = await launchBrowser({ headless: true });
const blocks = [];
try {
  if (AB) {
    for (let i = 0; i < BLOCKS; i++) {
      const order = i % 2 === 0 ? [0, 1] : [1, 0];
      for (const which of order) {
        const label = which === 0 ? 'A' : 'B';
        console.log(`\n--- block ${i + 1} ${label} ${AB[which]}`);
        blocks.push({ label, url: AB[which], result: await runBlock(browser, AB[which]) });
      }
    }
  } else {
    for (let i = 0; i < BLOCKS; i++) {
      console.log(`\n--- block ${i + 1} ${URL_ONE}`);
      blocks.push({ label: 'A', url: URL_ONE, result: await runBlock(browser, URL_ONE) });
    }
  }
} finally {
  await browser.close();
}

const merged = { A: mergeRaw(blocks, 'A') };
if (AB) merged.B = mergeRaw(blocks, 'B');
const outPath = `verify-out/perf-fx-${LABEL}.json`;
writeFileSync(outPath, JSON.stringify({
  createdAt: new Date().toISOString(), label: LABEL, frames: FRAMES, throttle: THROTTLE, ab: AB, env: blocks[0]?.result.env,
  scenes: Object.fromEntries(Object.entries(merged.A).map(([k, v]) => [k, { summary: v.summary, peak: v.peak, top: v.top, raw: v.raw }])),
  scenesB: merged.B ? Object.fromEntries(Object.entries(merged.B).map(([k, v]) => [k, { summary: v.summary, peak: v.peak, top: v.top, raw: v.raw }])) : undefined,
}, null, 0));
console.log(`\nwrote ${outPath}  env ${JSON.stringify(blocks[0]?.result.env)}`);
if (AB) compareScenes(`A ${AB[0]}`, merged.A, `B ${AB[1]}`, merged.B);
if (COMPARE && existsSync(COMPARE)) {
  const base = JSON.parse(readFileSync(COMPARE, 'utf8'));
  compareScenes(COMPARE, base.scenes, outPath, merged.A);
}

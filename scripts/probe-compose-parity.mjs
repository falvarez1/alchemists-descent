// GPU frame-composition parity probe (docs/GPU-COMPOSE-PLAN.md, perf ticket #8).
// A/B readback: the CPU FrameComposer loop vs the ComposeShader fragment path
// must be pixel-equal for deterministic content and distribution-equal for
// stochastic flicker.
//
// Rig: frameCount frozen via defineProperty getter (tick++ lands in a shadow
// store), sim paused (rendering continues), postFx off (raw buffer), and
// Math.random hijacked to 0.5 so the CPU flicker sits at its midpoint while
// uFlickerMid pins the shader hash to 0.5 — every branch deterministic.
//
// Usage: node scripts/probe-compose-parity.mjs [url]   (dev server running)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const outDir = 'verify-out/compose-parity';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext()).newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e)}`));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text().slice(0, 400)}`);
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2500);

const results = [];
const record = (name, pass, info = '') => {
  results.push({ name, pass: !!pass, info: String(info) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? `  [${info}]` : ''}`);
};

// ---------- setup: rig + deterministic scene + in-page helpers ----------
const setupOk = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const W = ctx.world;
  const WIDTH = W.width;

  // Freeze the frame clock: tick's frameCount++ writes the shadow store, all
  // readers (compose, lighting, sprites) see the frozen value.
  let frozen = 1000; // even: lighting rebuilds every frame, deterministically
  let store = ctx.state.frameCount;
  Object.defineProperty(ctx.state, 'frameCount', {
    configurable: true,
    get: () => (frozen !== null ? frozen : store),
    set: (v) => {
      store = v;
    },
  });
  window.__setFrozen = (v) => {
    frozen = v;
  };

  ctx.state.paused = true;
  ctx.state.postFx.enabled = false;
  ctx.state.postFx.gpuCompose = false;
  ctx.enemies.length = 0;
  ctx.projectiles.length = 0;
  ctx.shockwaves.length = 0;
  ctx.particles.clear();
  ctx.lightning.clear();
  ctx.fx.screenShake = 0;
  ctx.fx.bloomKick = 0;
  ctx.fx.digBeam = null;

  // Determinism: CPU flicker at midpoint, shader hash pinned to 0.5.
  window.__realRandom = Math.random;
  Math.random = () => 0.5;
  window.__composeFlickerMid = true;

  ctx.camera.snapTo(700, 480);
  ctx.camera.zoom = 1;
  ctx.camera.zoomLock = null;
  const camX = ctx.camera.renderX;
  const camY = ctx.camera.renderY;

  const paint = (vx0, vy0, vx1, vy1, type, color, life = 0) => {
    for (let vy = vy0; vy <= vy1; vy++)
      for (let vx = vx0; vx <= vx1; vx++) {
        const i = camX + vx + (camY + vy) * WIDTH;
        W.types[i] = type;
        W.colors[i] = color;
        W.life[i] = life;
        W.charge[i] = 0;
      }
  };
  // Big air region (parallax + air-light path)
  paint(10, 10, 160, 120, 0, 0x08080c);
  // Solids: stone / metal / gold / crystal / glow flora
  paint(20, 200, 80, 260, 12, 0x606870);
  paint(90, 200, 130, 260, 13, 0x607080);
  paint(140, 220, 160, 240, 17, 0xd9b54a);
  paint(180, 200, 220, 240, 29, 0x7fd4e8);
  paint(230, 200, 260, 230, 33, 0x59d98f);
  paint(270, 200, 300, 215, 34, 0x3f7a4f);
  paint(270, 216, 300, 230, 15, 0x2e6b3a);
  paint(270, 231, 300, 245, 30, 0x6fae5d);
  // Charged metal patch (electric-cyan override path)
  for (let vy = 210; vy <= 220; vy++)
    for (let vx = 100; vx <= 110; vx++) W.charge[camX + vx + (camY + vy) * WIDTH] = 9;
  // Water cup with a free surface (deterministic sine shimmer)
  paint(320, 200, 370, 245, 13, 0x607080);
  paint(321, 201, 369, 214, 0, 0x08080c);
  paint(321, 215, 369, 244, 2, 0x1e8ce6);
  // Lava cup + fire + ember blocks (flicker at midpoint for the static diff)
  paint(380, 200, 430, 245, 13, 0x607080);
  paint(381, 210, 429, 244, 11, 0xfc3c08);
  paint(440, 210, 460, 230, 5, 0xff9632, 30000);
  paint(470, 210, 490, 230, 20, 0xff6420, 30000);

  // ---------- helpers ----------
  const glCanvas = document.querySelector('#canvas-holder > canvas');
  const tmp = document.createElement('canvas');
  tmp.width = glCanvas.width;
  tmp.height = glCanvas.height;
  const g = tmp.getContext('2d', { willReadFrequently: true });

  // drawImage works only inside rAF, right after the game's own render; idle
  // rAF batches (no tick) read back black — retry until a lit frame lands.
  window.__capture = () =>
    new Promise((resolve, reject) => {
      const tryOnce = (attempt) => {
        if (attempt > 60) return reject(new Error('capture: 60 black frames'));
        requestAnimationFrame(() => {
          g.drawImage(glCanvas, 0, 0);
          const d = g.getImageData(0, 0, tmp.width, tmp.height).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 16004) sum += d[i] + d[i + 1] + d[i + 2];
          if (sum > 50) resolve(d);
          else tryOnce(attempt + 1);
        });
      };
      tryOnce(0);
    });

  window.__captureRect = (x, y, w, h) =>
    new Promise((resolve, reject) => {
      const tryOnce = (attempt) => {
        if (attempt > 60) return reject(new Error('captureRect: 60 black frames'));
        requestAnimationFrame(() => {
          g.drawImage(glCanvas, 0, 0);
          const d = g.getImageData(x, y, w, h).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
          if (sum > 50) resolve(d);
          else tryOnce(attempt + 1);
        });
      };
      tryOnce(0);
    });

  window.__diff = (a, b) => {
    let exact = 0;
    let maxd = 0;
    let sumd = 0;
    let big = 0;
    const n = a.length;
    for (let i = 0; i < n; i += 4) {
      const d0 = Math.abs(a[i] - b[i]);
      const d1 = Math.abs(a[i + 1] - b[i + 1]);
      const d2 = Math.abs(a[i + 2] - b[i + 2]);
      const m = Math.max(d0, d1, d2);
      if (m === 0) exact++;
      else if (m > maxd) maxd = m;
      if (m > 2) big++;
      sumd += d0 + d1 + d2;
    }
    const px = n / 4;
    return {
      exactPct: +((100 * exact) / px).toFixed(3),
      maxd,
      meand: +(sumd / (px * 3)).toFixed(5),
      bigPct: +((100 * big) / px).toFixed(4),
    };
  };

  window.__wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__cam = { camX, camY };
  return ctx.target === undefined; // truthy sanity
});
if (!setupOk) console.log('setup evaluate returned falsy (non-fatal)');
await page.waitForTimeout(300);

// ---------- S0+S1: rig self-consistency, then static CPU vs GPU ----------
const s1 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.state.postFx.gpuCompose = false;
  await window.__wait(150);
  const cpuA = await window.__capture();
  await window.__wait(60);
  const cpuB = await window.__capture();
  const rig = window.__diff(cpuA, cpuB);

  ctx.state.postFx.gpuCompose = true;
  await window.__wait(150);
  const gpu = await window.__capture();
  const ab = window.__diff(cpuA, gpu);
  ctx.state.postFx.gpuCompose = false;
  return { rig, ab };
});
record('S0 rig: frozen clock renders identical CPU frames', s1.rig.maxd === 0, JSON.stringify(s1.rig));
record(
  'S1 static scene: CPU vs GPU pixel-equal (maxd<=2, no big diffs)',
  s1.ab.maxd <= 2 && s1.ab.bigPct === 0 && s1.ab.exactPct > 98,
  JSON.stringify(s1.ab),
);

// ---------- S2: max-size black hole at the view edge (distortion pad) ----------
const s2 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const { camX, camY } = window.__cam;
  // max-size singularity (collapseLimit 140) hugging the left view edge: the
  // worst-case lens offset must stay inside the window pad
  ctx.projectiles.push({
    type: 'blackhole',
    x: camX + 5,
    y: camY + 180,
    vx: 0,
    vy: 0,
    life: 99999,
    vortexRad: 140,
  });
  ctx.state.postFx.gpuCompose = false;
  await window.__wait(150);
  const cpu = await window.__capture();
  ctx.state.postFx.gpuCompose = true;
  await window.__wait(150);
  const gpu = await window.__capture();
  const ab = window.__diff(cpu, gpu);
  ctx.state.postFx.gpuCompose = false;
  ctx.projectiles.length = 0;
  return ab;
});
record(
  'S2 max black hole at view edge: lens parity inside pad (bigPct<=0.5%)',
  s2.bigPct <= 0.5 && s2.exactPct > 95,
  JSON.stringify(s2),
);

// ---------- S3: shockwave ring + sprite overlay semantics ----------
const s3 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const { camX, camY } = window.__cam;
  // static blast ring straddling air + stone (refraction over both paths)
  ctx.shockwaves.push({
    cx: camX + 90,
    cy: camY + 170,
    currentRadius: 40,
    maxRadius: 88,
    speed: 0,
    strength: 12,
  });
  // sprite projectiles: setPx cores, addPx halos, set-then-add layering
  ctx.projectiles.push(
    { type: 'bolt', x: camX + 60, y: camY + 60, vx: 3, vy: 0, life: 999 },
    { type: 'frostbolt', x: camX + 200, y: camY + 195, vx: 2, vy: 0, life: 999 },
    { type: 'meteor', x: camX + 120, y: camY + 80, vx: 1, vy: 1, life: 999 },
    { type: 'wisp', x: camX + 300, y: camY + 100, vx: 0, vy: 0, life: 999 },
  );
  ctx.state.postFx.gpuCompose = false;
  await window.__wait(150);
  const cpu = await window.__capture();
  ctx.state.postFx.gpuCompose = true;
  await window.__wait(150);
  const gpu = await window.__capture();
  const ab = window.__diff(cpu, gpu);
  ctx.state.postFx.gpuCompose = false;
  ctx.projectiles.length = 0;
  ctx.shockwaves.length = 0;
  return ab;
});
record(
  'S3 shockwave + sprites: ringGlow/refraction + setPx/addPx overlay parity',
  s3.bigPct <= 0.5 && s3.exactPct > 95,
  JSON.stringify(s3),
);

// ---------- S4: stochastic flicker — distribution bands over 60 frames ----------
const s4 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  // live randomness back on for both paths
  Math.random = window.__realRandom;
  window.__composeFlickerMid = false;

  // lava slab interior (world vx 386..424, vy 216..240) -> canvas rect at 2x,
  // shrunk for the overscan/sub-cell margin
  const rect = [2 * 386 + 6, 2 * 216 + 6, 2 * (424 - 386) - 12, 2 * (240 - 216) - 12];
  const collect = async (frames) => {
    let n = 0;
    const sum = [0, 0, 0];
    const sumSq = [0, 0, 0];
    for (let f = 0; f < frames; f++) {
      const d = await window.__captureRect(...rect);
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const v = d[i + c];
          sum[c] += v;
          sumSq[c] += v * v;
        }
        n++;
      }
      await window.__wait(15);
    }
    const mean = sum.map((s) => s / n);
    const std = sum.map((s, c) => Math.sqrt(Math.max(0, sumSq[c] / n - (s / n) ** 2)));
    return { mean, std, n };
  };

  ctx.state.postFx.gpuCompose = false;
  await window.__wait(120);
  const cpu = await collect(60);
  ctx.state.postFx.gpuCompose = true;
  await window.__wait(120);
  const gpu = await collect(60);
  ctx.state.postFx.gpuCompose = false;

  // restore determinism for the remaining sections
  Math.random = () => 0.5;
  window.__composeFlickerMid = true;
  return { cpu, gpu };
});
{
  const meanDevG = Math.abs(s4.gpu.mean[1] - s4.cpu.mean[1]) / Math.max(1, s4.cpu.mean[1]);
  const meanDevR = Math.abs(s4.gpu.mean[0] - s4.cpu.mean[0]) / Math.max(1, s4.cpu.mean[0]);
  const stdRatio = s4.gpu.std[1] / Math.max(0.001, s4.cpu.std[1]);
  record(
    'S4 lava flicker: same brightness distribution (mean dev<4%, std ratio 0.6-1.5)',
    meanDevR < 0.04 && meanDevG < 0.04 && stdRatio > 0.6 && stdRatio < 1.5,
    `cpu mean=[${s4.cpu.mean.map((v) => v.toFixed(1))}] std=[${s4.cpu.std.map((v) => v.toFixed(2))}] | gpu mean=[${s4.gpu.mean.map((v) => v.toFixed(1))}] std=[${s4.gpu.std.map((v) => v.toFixed(2))}]`,
  );
}

// ---------- S5: live-tuning — LUT + ambient must re-feed every frame ----------
const s5 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.state.postFx.gpuCompose = true;
  await window.__wait(120);
  const before = await window.__capture();
  const lava = ctx.params.materials[11];
  const oldBW = lava.bloomWeight;
  const oldAmb = ctx.params.global.ambient;
  lava.bloomWeight = 0.05;
  ctx.params.global.ambient = oldAmb + 0.25;
  await window.__wait(120);
  const after = await window.__capture();
  lava.bloomWeight = oldBW;
  ctx.params.global.ambient = oldAmb;
  ctx.state.postFx.gpuCompose = false;
  await window.__wait(80);
  return window.__diff(before, after);
});
record('S5 live-tuning: bloomWeight/ambient edits change the GPU frame', s5.exactPct < 99, JSON.stringify(s5));

// ---------- S6: full PostFx chain ON (bloom+lens through EffectComposer) ----------
const s6 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.state.postFx.enabled = true;
  ctx.state.postFx.gpuCompose = false;
  await window.__wait(150);
  const cpu = await window.__capture();
  ctx.state.postFx.gpuCompose = true;
  await window.__wait(150);
  const gpu = await window.__capture();
  const ab = window.__diff(cpu, gpu);
  return ab;
});
record(
  'S6 postFx ON: same tonemap/bloom treatment through the composer chain',
  s6.meand < 0.5 && s6.bigPct < 2,
  JSON.stringify(s6),
);

// ---------- eyeball record: A/B screenshots with the full look ----------
await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const { camX, camY } = window.__cam;
  ctx.shockwaves.push({
    cx: camX + 90,
    cy: camY + 170,
    currentRadius: 40,
    maxRadius: 88,
    speed: 0,
    strength: 12,
  });
  ctx.state.postFx.gpuCompose = false;
  await window.__wait(120);
});
await page.screenshot({ path: `${outDir}/cpu-shockwave.png` });
await page.evaluate(async () => {
  window.__game.ctx.state.postFx.gpuCompose = true;
  await window.__wait(120);
});
await page.screenshot({ path: `${outDir}/gpu-shockwave.png` });

const shaderErrors = consoleErrors.filter((e) => /THREE|shader|WebGL/i.test(e));
record('no shader/WebGL console errors', shaderErrors.length === 0, shaderErrors[0] ?? '');

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} assertions green`);
if (consoleErrors.length) {
  console.log('\nconsole noise (first 5):');
  for (const e of consoleErrors.slice(0, 5)) console.log('  ' + e);
}
process.exit(failed.length === 0 ? 0 : 1);

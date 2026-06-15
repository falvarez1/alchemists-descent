// Generic same-session feature A/B benchmark.
//
// Usage:
//   node scripts/perf-ab-feature.mjs <featurePath> <controlValue> <variantValue> [url] [framesPerBlock] [blocks] [scenario]
//
// Examples:
//   node scripts/perf-ab-feature.mjs postFx.gpuCompose false true
//   node scripts/perf-ab-feature.mjs state.postFx.gpuCompose false true http://localhost:5173/ 360 4 chaos
//
// Writes verify-out/perf-ab-<feature>-<scenario>-<timestamp>.json.
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';
import {
  captureCanvasPng,
  collectBackendCapabilities,
  collectWebGpuAdapterCapabilities,
  currentCommandLine,
  currentGitCommit,
  currentGitState,
  diffPixelSnapshots,
  newBenchmarkPage,
  PERF_BUCKETS,
  printBucketComparison,
  readCanvasPixels,
  sanitizeLabel,
  summarizeBuckets,
  writeJson,
} from './perf-harness.mjs';

const featurePath = process.argv[2] ?? 'postFx.gpuCompose';
const controlArg = process.argv[3] ?? 'false';
const variantArg = process.argv[4] ?? 'true';
const url = process.argv[5] ?? 'http://localhost:5173/';
const FRAMES = Number(process.argv[6] ?? 360);
const BLOCKS = Number(process.argv[7] ?? 4); // per value, interleaved
const scenario = process.argv[8] ?? 'chaos';
const captureVisuals = process.env.PERF_CAPTURE_VISUALS === '1';
const runId = Date.now();
const outputStem = `perf-ab-${sanitizeLabel(featurePath)}-${sanitizeLabel(scenario)}-${runId}`;

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === 'undefined') return undefined;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const controlValue = parseValue(controlArg);
const variantValue = parseValue(variantArg);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await newBenchmarkPage(browser, { diagnosticsLabel: 'perf-ab' });
page.on('pageerror', (error) => console.error('PAGE ERROR:', String(error)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await startConsoleTestRun(page, { seed: 777, settleMs: 1500 });

const initialCapabilities = await collectBackendCapabilities(page, 'current');
const webgpuCapabilities = await collectWebGpuAdapterCapabilities(page);

const result = await page.evaluate(
  async ({ featurePath, controlValue, variantValue, FRAMES, BLOCKS, scenario }) => {
    const ctx = window.__game.ctx;

    const setFeatureValue = (path, value) => {
      const parts = String(path)
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length === 0) throw new Error('Empty feature path');

      let owner;
      if (parts[0] === 'ctx') {
        owner = ctx;
        parts.shift();
      } else if (parts[0] === 'state') {
        owner = ctx.state;
        parts.shift();
      } else if (parts[0] === 'postFx') {
        owner = ctx.state.postFx;
        parts.shift();
      } else if (parts[0] === 'render') {
        owner = ctx.state.render;
        parts.shift();
      } else if (parts[0] === 'params') {
        owner = ctx.params;
        parts.shift();
      } else {
        owner = ctx;
      }

      for (let i = 0; i < parts.length - 1; i++) {
        owner = owner?.[parts[i]];
        if (owner === undefined || owner === null) {
          throw new Error(`Cannot resolve feature path segment "${parts[i]}" in "${path}"`);
        }
      }
      const key = parts[parts.length - 1];
      if (!(key in owner)) throw new Error(`Feature path "${path}" missing final key "${key}"`);
      owner[key] = value;
      return owner[key];
    };

    const requestedBackendForValue = (value) => {
      if (!featurePath.toLowerCase().includes('backend')) return 'current';
      const requested = String(value).toLowerCase();
      return requested === 'webgpu' || requested === 'webgl' || requested === 'webgl2'
        ? requested
        : 'current';
    };

    const pickRendererCanvas = () => {
      const direct = document.querySelector('#canvas-holder > canvas');
      if (direct) return direct;
      const canvases = Array.from(document.querySelectorAll('canvas'));
      canvases.sort((a, b) => {
        const aArea = Math.max(a.width * a.height, a.clientWidth * a.clientHeight);
        const bArea = Math.max(b.width * b.height, b.clientWidth * b.clientHeight);
        return bArea - aArea;
      });
      return canvases[0] ?? null;
    };

    const collectRuntimeCapabilities = (value) => {
      const requestedBackend = requestedBackendForValue(value);
      const canvas = pickRendererCanvas();
      const runtime = {
        requestedBackend,
        actualBackend: 'unknown',
        fellBackToWebGL2: false,
        feature: { path: featurePath, value },
        postFxGpuCompose: Boolean(ctx.state.postFx?.gpuCompose),
        render: { ...ctx.state.render },
        canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
        gl: null,
      };
      if (!canvas) return runtime;

      let gpu = null;
      let gl = null;
      try {
        gpu = canvas.getContext('webgpu');
      } catch {}
      try {
        gl = canvas.getContext('webgl2');
      } catch {}
      if (!gl && !gpu) {
        try {
          gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
        } catch {}
      }
      if (gpu) runtime.actualBackend = 'webgpu';
      if (gl) {
        const isWebGL2 =
          typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        runtime.actualBackend = isWebGL2 ? 'webgl2' : 'webgl';
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        runtime.gl = {
          version: gl.getParameter(gl.VERSION),
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
          unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
        };
      }
      runtime.fellBackToWebGL2 =
        requestedBackend === 'webgpu' && runtime.actualBackend === 'webgl2';
      return runtime;
    };

    let timers = [];
    const stopTimers = () => {
      for (const timer of timers) clearInterval(timer);
      timers = [];
    };

    const clearBenchmarkScene = () => {
      stopTimers();
      ctx.enemies.length = 0;
      ctx.projectiles.length = 0;
      ctx.shockwaves.length = 0;
      if (ctx.lightning?.arcs) ctx.lightning.arcs.length = 0;
      ctx.particles.clear();
      if (ctx.levels.current?.authoredLights) ctx.levels.current.authoredLights.length = 0;
    };

    const setupBaseChaosScene = () => {
      clearBenchmarkScene();
      const w = ctx.world;
      const px = Math.floor(ctx.player.x);
      const py = Math.floor(ctx.player.y);
      const writeCell = (x, y, type, color, life = 0, charge = 0) => {
        if (!w.inBounds(x, y)) return;
        const i = w.idx(x, y);
        w.types[i] = type;
        w.colors[i] = color;
        w.life[i] = life;
        w.charge[i] = charge;
      };
      ctx.player.hp = 999999;
      ctx.player.maxHp = 999999;
      ctx.player.invuln = 999999;

      for (let dx = -120; dx <= 120; dx++) {
        for (let dy = -70; dy <= 20; dy++) {
          const x = px + dx;
          const y = py + dy;
          if (!w.inBounds(x, y)) continue;
          const edge = Math.abs(dx) === 120 || dy === 20 || dy === -70;
          if (edge) {
            writeCell(x, y, 13, 0x606870);
          } else {
            writeCell(x, y, 0, 0x08080c);
          }
        }
      }

      for (let dx = -119; dx <= 119; dx++) writeCell(px + dx, py + 19, 12, 0x8a8a92);

      for (let dx = -110; dx <= -40; dx++) {
        for (let dy = -60; dy <= -40; dy++) {
          writeCell(px + dx, py + dy, 2, 0x1e8ce6);
        }
      }

      for (let dx = 40; dx <= 110; dx++) {
        for (let dy = -60; dy <= -40; dy++) {
          writeCell(px + dx, py + dy, 11, 0xfc3c08);
        }
      }

      for (let dx = -30; dx <= 30; dx++) {
        for (let dy = 10; dy <= 16; dy++) {
          writeCell(px + dx, py + dy, 6, 0x55401e);
        }
      }

      for (const cx of [-70, 0, 70]) {
        for (let dy = -35; dy <= -20; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            writeCell(px + cx + dx, py + dy, 1, 0xd2b45e);
          }
        }
      }

      for (let dx = -3; dx <= 3; dx++) {
        writeCell(px + dx, py + 9, 5, 0xe65c00, 90);
      }

      const roster = [
        ['slime', -80],
        ['slime', -60],
        ['slime', 60],
        ['slime', 80],
        ['imp', -50],
        ['imp', 50],
        ['imp', 90],
        ['golem', -90],
        ['golem', 95],
        ['bat', -30],
        ['bat', 30],
        ['bat', 0],
        ['spitter', -100],
        ['spitter', 100],
      ];
      for (const [kind, dx] of roster) ctx.enemyCtl.spawn(kind, px + dx, py + 10);
      return { px, py, rosterCount: roster.length };
    };

    const addVisualParticles = (px, py, count) => {
      for (let i = 0; i < count; i++) {
        const a = i * 2.399963;
        const r = 8 + (i % 73);
        const x = px + Math.cos(a) * r * 0.95;
        const y = py - 28 + Math.sin(a) * r * 0.45;
        const vx = Math.cos(a + 1.7) * 0.45;
        const vy = Math.sin(a + 1.7) * 0.35 - 0.08;
        ctx.particles.spawn(x, y, vx, vy, null, 0xffb85c, 240 + (i % 90), {
          glow: 0.35 + (i % 5) * 0.04,
          grav: 0.02,
        });
      }
    };

    const addProjectiles = (px, py, count) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        ctx.projectiles.push({
          x: px + Math.cos(a) * 70,
          y: py - 26 + Math.sin(a) * 28,
          vx: Math.cos(a + Math.PI * 0.5) * 0.9,
          vy: Math.sin(a + Math.PI * 0.5) * 0.45,
          life: 220,
          age: 0,
          charging: false,
          hostile: false,
          type: 'bolt',
        });
      }
    };

    const addAuthoredLights = (px, py, count) => {
      const runtime = ctx.levels.current;
      if (!runtime) return;
      runtime.authoredLights ??= [];
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / 8);
        const col = i % 8;
        runtime.authoredLights.push({
          x: px - 96 + col * 27,
          y: py - 62 + row * 16,
          r: i % 3 === 0 ? 1.0 : i % 3 === 1 ? 0.45 : 0.85,
          g: i % 3 === 0 ? 0.62 : i % 3 === 1 ? 0.82 : 1.0,
          b: i % 3 === 0 ? 0.28 : i % 3 === 1 ? 1.0 : 0.5,
          intensity: 1.1 + (i % 3) * 0.15,
          radius: 48 + (i % 4) * 6,
          bloom: 0.25,
          flicker: 0.12,
          flickerPhase: i * 0.73,
          falloff: 'soft',
          occluded: true,
        });
      }
    };

    const setupScenario = (scenarioName) => {
      const { px, py } = setupBaseChaosScene();

      if (scenarioName === 'particles' || scenarioName === 'emitters') addVisualParticles(px, py, 900);
      if (scenarioName === 'projectiles' || scenarioName === 'emitters') addProjectiles(px, py, 96);
      if (scenarioName === 'lights' || scenarioName === 'emitters') addAuthoredLights(px, py, 40);

      const offsets = [-90, -45, 0, 45, 90];
      let bomb = 0;
      timers.push(
        setInterval(() => {
          ctx.explosions.trigger(px + offsets[bomb % offsets.length], py - 10 - (bomb % 3) * 12, 11);
          bomb++;
        }, 700),
      );

      if (scenarioName === 'emitters') {
        let burst = 0;
        timers.push(
          setInterval(() => {
            addVisualParticles(px + ((burst % 5) - 2) * 24, py - 25, 80);
            burst++;
          }, 900),
        );
      }

      return { px, py };
    };

    const setupCounts = () => ({
      particles: ctx.particles.list?.length ?? -1,
      projectiles: ctx.projectiles.length,
      enemies: ctx.enemies.length,
      authoredLights: ctx.levels.current?.authoredLights?.length ?? 0,
      shockwaves: ctx.shockwaves.length,
    });

    const prepareBenchmarkScene = async (value) => {
      const appliedValue = setFeatureValue(featurePath, value);
      setupScenario(scenario);
      const capabilities = collectRuntimeCapabilities(appliedValue);
      const counts = setupCounts();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return { appliedValue, capabilities, setupCounts: counts };
    };

    const recordBlock = async (label, value, sequenceIndex) => {
      const prepared = await prepareBenchmarkScene(value);
      window.__perfSamples = [];
      window.__perfRecord = true;
      await new Promise((resolve) => {
        const check = () => {
          if ((window.__perfSamples?.length ?? 0) >= FRAMES) resolve();
          else setTimeout(check, 100);
        };
        check();
      });
      window.__perfRecord = false;
      const samples = window.__perfSamples;
      for (let i = 0; i < samples.length; i++) {
        for (const bucket of ['sim', 'entities', 'compose', 'gl', 'render', 'frame']) {
          const value = samples[i]?.[bucket];
          if (!Number.isFinite(value)) {
            throw new Error(`Perf sample ${i} in ${label} block ${sequenceIndex} missing ${bucket}`);
          }
        }
      }
      stopTimers();
      return {
        label,
        sequenceIndex,
        samples,
        appliedValue: prepared.appliedValue,
        capabilities: prepared.capabilities,
        setupCounts: prepared.setupCounts,
      };
    };

    const control = { sim: [], entities: [], compose: [], gl: [], render: [], frame: [] };
    const variant = { sim: [], entities: [], compose: [], gl: [], render: [], frame: [] };
    const blocks = [];
    const orders = [];

    for (let block = 0; block < BLOCKS; block++) {
      const order =
        block % 2 === 0
          ? [
              ['control', controlValue, control],
              ['variant', variantValue, variant],
            ]
          : [
              ['variant', variantValue, variant],
              ['control', controlValue, control],
            ];
      orders.push(order.map(([label]) => label).join(' -> '));
      for (const [label, value, sink] of order) {
        const recorded = await recordBlock(label, value, blocks.length);
        for (const sample of recorded.samples) {
          for (const bucket of ['sim', 'entities', 'compose', 'gl', 'render', 'frame']) {
            sink[bucket].push(sample[bucket]);
          }
        }
        blocks.push({
          label,
          value: recorded.appliedValue,
          samples: recorded.samples.length,
          setupCounts: recorded.setupCounts,
          capabilities: recorded.capabilities,
          frame: recorded.samples.map((sample) => sample.frame),
        });
      }
    }

    window.__perfFeatureHarness = {
      prepareVisual: async (value) => {
        const prepared = await prepareBenchmarkScene(value);
        await new Promise((resolve) => setTimeout(resolve, 500));
        stopTimers();
        return prepared;
      },
      setFeatureValue,
      stopTimers,
    };

    stopTimers();
    setFeatureValue(featurePath, controlValue);

    return {
      featurePath,
      controlValue,
      variantValue,
      scenario,
      framesPerBlock: FRAMES,
      blocksPerValue: BLOCKS,
      orders,
      control,
      variant,
      blockFrameSamples: blocks,
      finalFeatureValue: controlValue,
      runtimeCounts: setupCounts(),
    };
  },
  { featurePath, controlValue, variantValue, FRAMES, BLOCKS, scenario },
);

const visualEvidence = captureVisuals
  ? await (async () => {
      const visualDir = `verify-out/${outputStem}-visuals`;
      const controlPrepared = await page.evaluate(
        async ({ value }) => window.__perfFeatureHarness.prepareVisual(value),
        { value: controlValue },
      );
      const controlPng = `${visualDir}/control.png`;
      await captureCanvasPng(page, controlPng);
      const controlPixels = await readCanvasPixels(page);

      const variantPrepared = await page.evaluate(
        async ({ value }) => window.__perfFeatureHarness.prepareVisual(value),
        { value: variantValue },
      );
      const variantPng = `${visualDir}/variant.png`;
      await captureCanvasPng(page, variantPng);
      const variantPixels = await readCanvasPixels(page);

      const diff = diffPixelSnapshots(controlPixels, variantPixels, 0);
      const diffJson = `${visualDir}/diff.json`;
      writeJson(diffJson, { controlPrepared, variantPrepared, diff });
      return { captured: true, controlPng, variantPng, diffJson, diff };
    })()
  : { captured: false, reason: 'Set PERF_CAPTURE_VISUALS=1 to capture PNG and diff artifacts.' };

await page.evaluate(() => window.__perfFeatureHarness?.stopTimers?.());
await browser.close();

const keys = PERF_BUCKETS;
const controlSummary = summarizeBuckets(result.control, keys);
const variantSummary = summarizeBuckets(result.variant, keys);
const comparison = printBucketComparison(
  `${featurePath}=${controlArg}`,
  `${featurePath}=${variantArg}`,
  result.control,
  result.variant,
  keys,
);

const payload = {
  createdAt: new Date().toISOString(),
  commit: currentGitCommit(),
  git: currentGitState(),
  command: currentCommandLine(),
  url,
  featurePath,
  controlArg,
  variantArg,
  controlValue,
  variantValue,
  scenario,
  framesPerBlock: FRAMES,
  blocksPerValue: BLOCKS,
  blockOrders: result.orders,
  capabilities: {
    initial: initialCapabilities,
    webgpuAdapter: webgpuCapabilities,
    blocks: result.blockFrameSamples.map((block) => ({
      label: block.label,
      value: block.value,
      capabilities: block.capabilities,
    })),
  },
  summaries: {
    control: controlSummary,
    variant: variantSummary,
  },
  comparison,
  visualEvidence,
  raw: {
    control: result.control,
    variant: result.variant,
    blockFrameSamples: result.blockFrameSamples,
  },
  runtimeCounts: result.runtimeCounts,
};

const outputPath = `verify-out/${outputStem}.json`;
writeJson(outputPath, payload);
console.log(`\nWrote ${outputPath}`);
console.log(
  `Runtime counts: particles=${result.runtimeCounts.particles}, projectiles=${result.runtimeCounts.projectiles}, enemies=${result.runtimeCounts.enemies}, authoredLights=${result.runtimeCounts.authoredLights}`,
);

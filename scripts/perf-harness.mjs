import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

export const PERF_BUCKETS = ['sim', 'entities', 'compose', 'gl', 'render', 'frame'];

const WEBGPU_LIMIT_KEYS = [
  'maxTextureDimension1D',
  'maxTextureDimension2D',
  'maxTextureDimension3D',
  'maxTextureArrayLayers',
  'maxBindGroups',
  'maxBindGroupsPlusVertexBuffers',
  'maxBindingsPerBindGroup',
  'maxDynamicUniformBuffersPerPipelineLayout',
  'maxDynamicStorageBuffersPerPipelineLayout',
  'maxSampledTexturesPerShaderStage',
  'maxSamplersPerShaderStage',
  'maxStorageBuffersPerShaderStage',
  'maxStorageTexturesPerShaderStage',
  'maxUniformBuffersPerShaderStage',
  'maxUniformBufferBindingSize',
  'maxStorageBufferBindingSize',
  'minUniformBufferOffsetAlignment',
  'minStorageBufferOffsetAlignment',
  'maxVertexBuffers',
  'maxBufferSize',
  'maxVertexAttributes',
  'maxVertexBufferArrayStride',
  'maxInterStageShaderComponents',
  'maxInterStageShaderVariables',
  'maxColorAttachments',
  'maxColorAttachmentBytesPerSample',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
  'maxComputeWorkgroupSizeZ',
  'maxComputeWorkgroupsPerDimension',
];

export function emptyBuckets(extra = []) {
  const buckets = {};
  for (const key of [...PERF_BUCKETS, ...extra]) buckets[key] = [];
  return buckets;
}

export function addSampleBuckets(target, samples) {
  samples.forEach((sample, index) => {
    for (const key of PERF_BUCKETS) {
      const value = sample?.[key];
      if (!Number.isFinite(value)) {
        throw new Error(`Perf sample ${index} is missing finite "${key}" timing`);
      }
      target[key].push(value);
    }
  });
}

export function assertPerfSamples(samples, keys = PERF_BUCKETS) {
  const missing = {};
  samples.forEach((sample, index) => {
    for (const key of keys) {
      const value = sample?.[key];
      if (!Number.isFinite(value)) {
        (missing[key] ??= []).push(index);
      }
    }
  });
  const badKeys = Object.keys(missing);
  if (badKeys.length > 0) {
    throw new Error(
      `Perf samples missing required buckets: ${badKeys
        .map((key) => `${key}[${missing[key].slice(0, 5).join(',')}]`)
        .join('; ')}`,
    );
  }
  return { samples: samples.length, keys, missingBuckets: {} };
}

export function stats(values) {
  const n = values.length;
  if (n === 0) return { n: 0, mean: 0, sd: 0, p50: 0, p95: 0, max: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance =
    n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n,
    mean,
    sd: Math.sqrt(variance),
    p50: sorted[Math.min(n - 1, Math.floor(n * 0.5))],
    p95: sorted[Math.min(n - 1, Math.floor(n * 0.95))],
    max: sorted[n - 1],
  };
}

export function summarizeBuckets(raw, keys = Object.keys(raw)) {
  const summary = {};
  for (const key of keys) summary[key] = stats(raw[key] ?? []);
  return summary;
}

export function welchT(controlValues, variantValues) {
  const control = stats(controlValues);
  const variant = stats(variantValues);
  const denom = Math.sqrt(
    (control.sd * control.sd) / Math.max(1, control.n) +
      (variant.sd * variant.sd) / Math.max(1, variant.n),
  );
  const delta = variant.mean - control.mean;
  const pct = control.mean === 0 ? 0 : (delta / control.mean) * 100;
  const t = denom === 0 ? 0 : delta / denom;
  const sig =
    Math.abs(t) > 3.29 ? 'p<0.001 SIGNIFICANT' : Math.abs(t) > 1.96 ? 'p<0.05' : 'ns';
  return { control, variant, delta, pct, t, sig };
}

export function sanitizeLabel(label) {
  return String(label)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

export function writeJson(filePath, payload) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}

export function currentGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function currentGitState() {
  const commit = currentGitCommit();
  try {
    const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    return { commit, dirty: status.length > 0, status };
  } catch (error) {
    return { commit, dirty: null, status: [], error: String(error) };
  }
}

export function currentCommandLine() {
  return [process.argv0, ...process.argv.slice(1)].join(' ');
}

export function printBucketSummary(label, summary, keys = Object.keys(summary)) {
  console.log(`\n=== ${label.toUpperCase()} ===`);
  for (const key of keys) {
    const s = summary[key];
    console.log(
      `${key.padEnd(10)} mean ${s.mean.toFixed(3)}ms  sd ${s.sd.toFixed(3)}  p50 ${s.p50.toFixed(
        3,
      )}  p95 ${s.p95.toFixed(3)}  max ${s.max.toFixed(1)}  n=${s.n}`,
    );
  }
}

export function printBucketComparison(controlLabel, variantLabel, controlRaw, variantRaw, keys) {
  console.log(`\n=== SAME-SESSION A/B: ${controlLabel} -> ${variantLabel} ===`);
  console.log('bucket       before     after      delta       pct       t       p');
  const results = {};
  for (const key of keys) {
    const result = welchT(controlRaw[key], variantRaw[key]);
    results[key] = result;
    console.log(
      `${key.padEnd(10)} ${result.control.mean.toFixed(3).padStart(8)}ms ${result.variant.mean
        .toFixed(3)
        .padStart(8)}ms ${(result.delta >= 0 ? '+' : '') + result.delta.toFixed(3).padStart(7)}ms ${(
        (result.pct >= 0 ? '+' : '') + result.pct.toFixed(1)
      ).padStart(8)}% t=${result.t.toFixed(1).padStart(6)}  ${result.sig}`,
    );
  }
  return results;
}

export function attachBenchmarkDiagnostics(page, label = 'perf') {
  let initialNavigationSeen = false;
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    if (!initialNavigationSeen) {
      initialNavigationSeen = true;
      return;
    }
    console.error(`[${label}] main frame navigated: ${frame.url()}`);
  });
  page.on('crash', () => console.error(`[${label}] page crashed`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !text.includes('[vite] failed to connect to websocket')) {
      console.error(`[${label}] console error: ${text}`);
    }
  });
}

export async function newBenchmarkPage(browser, options = {}) {
  const { blockDevServerWebSocket = true, diagnosticsLabel = 'perf' } = options;
  const context = await browser.newContext();
  if (blockDevServerWebSocket && typeof context.routeWebSocket === 'function') {
    await context.routeWebSocket(
      (url) =>
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
        url.searchParams.has('token'),
      async (ws) => {
        await ws.close({ code: 1000, reason: 'benchmark disables dev-server websocket' });
      },
    );
  }
  const page = await context.newPage();
  attachBenchmarkDiagnostics(page, diagnosticsLabel);
  return page;
}

export async function collectBackendCapabilities(page, requestedBackend = 'current') {
  return page.evaluate((requestedBackendArg) => {
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
    const canvas = pickRendererCanvas();
    const result = {
      requestedBackend: requestedBackendArg,
      actualBackend: 'unknown',
      webgpuAvailable: Boolean(navigator.gpu),
      secureContext: Boolean(window.isSecureContext),
      timestampQueryAvailable: null,
      adapterInfo: null,
      adapterLimits: null,
      adapterFeatures: [],
      userAgent: navigator.userAgent,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      gl: null,
    };

    if (canvas) {
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
      if (gpu) {
        result.actualBackend = 'webgpu';
      }
      if (gl) {
        const isWebGL2 =
          typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        result.actualBackend = isWebGL2 ? 'webgl2' : 'webgl';
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        result.gl = {
          version: gl.getParameter(gl.VERSION),
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
          unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
        };
      }
    }

    return result;
  }, requestedBackend);
}

export async function collectWebGpuAdapterCapabilities(page) {
  return page.evaluate(async (limitKeys) => {
    if (!navigator.gpu) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { available: false, reason: 'requestAdapter returned null' };
      const features = Array.from(adapter.features ?? []).sort();
      const limits = {};
      for (const key of limitKeys) {
        if (adapter.limits && key in adapter.limits) limits[key] = adapter.limits[key];
      }
      const info =
        typeof adapter.requestAdapterInfo === 'function' ? await adapter.requestAdapterInfo() : null;
      return {
        available: true,
        features,
        limits,
        adapterTimestampQueryAvailable: features.includes('timestamp-query'),
        deviceTimestampQueryEnabled: false,
        gpuTimestampMeasurements: 'not-captured',
        timestampQueryAvailable: features.includes('timestamp-query'),
        adapterInfo: info
          ? {
              vendor: info.vendor ?? null,
              architecture: info.architecture ?? null,
              device: info.device ?? null,
              description: info.description ?? null,
            }
          : null,
      };
    } catch (error) {
      return { available: false, reason: String(error) };
    }
  }, WEBGPU_LIMIT_KEYS);
}

export async function readCanvasPixels(page, selector = '#canvas-holder > canvas') {
  return page.evaluate(async (canvasSelector) => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const pickRendererCanvas = () => {
      const direct = document.querySelector(canvasSelector);
      if (direct) return direct;
      const canvases = Array.from(document.querySelectorAll('canvas'));
      canvases.sort((a, b) => {
        const aArea = Math.max(a.width * a.height, a.clientWidth * a.clientHeight);
        const bArea = Math.max(b.width * b.height, b.clientWidth * b.clientHeight);
        return bArea - aArea;
      });
      return canvases[0] ?? null;
    };
    const canvas = pickRendererCanvas();
    if (!canvas) throw new Error(`Canvas not found: ${canvasSelector}`);
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D readback canvas unavailable');
    ctx.drawImage(canvas, 0, 0);
    const image = ctx.getImageData(0, 0, probe.width, probe.height);
    return { width: probe.width, height: probe.height, data: Array.from(image.data) };
  }, selector);
}

export function diffPixelSnapshots(before, after, tolerance = 0) {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `Pixel snapshot size mismatch: ${before.width}x${before.height} vs ${after.width}x${after.height}`,
    );
  }
  const length = before.data.length;
  let differingChannels = 0;
  let differingPixels = 0;
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;
  for (let i = 0; i < length; i += 4) {
    let pixelDifferent = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(before.data[i + c] - after.data[i + c]);
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      totalChannelDelta += delta;
      if (delta > tolerance) {
        differingChannels++;
        pixelDifferent = true;
      }
    }
    if (pixelDifferent) differingPixels++;
  }
  const pixels = before.width * before.height;
  return {
    width: before.width,
    height: before.height,
    pixels,
    tolerance,
    differingPixels,
    differingChannels,
    differingPixelPct: pixels === 0 ? 0 : (differingPixels / pixels) * 100,
    maxChannelDelta,
    meanChannelDelta: length === 0 ? 0 : totalChannelDelta / length,
  };
}

export async function captureCanvasPng(page, filePath, selector = '#canvas-holder > canvas') {
  mkdirSync(dirname(filePath), { recursive: true });
  const handle = await page.evaluateHandle((canvasSelector) => {
    const direct = document.querySelector(canvasSelector);
    if (direct) return direct;
    const canvases = Array.from(document.querySelectorAll('canvas'));
    canvases.sort((a, b) => {
      const aArea = Math.max(a.width * a.height, a.clientWidth * a.clientHeight);
      const bArea = Math.max(b.width * b.height, b.clientWidth * b.clientHeight);
      return bArea - aArea;
    });
    return canvases[0] ?? null;
  }, selector);
  const element = handle.asElement();
  if (!element) throw new Error(`Canvas not found: ${selector}`);
  await element.screenshot({ path: filePath });
  await handle.dispose();
  return filePath;
}

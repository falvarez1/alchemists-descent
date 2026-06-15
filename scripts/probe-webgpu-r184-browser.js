import {
  NoToneMapping,
  RenderPipeline,
  REVISION,
  SRGBColorSpace,
  WebGPUBackend,
  WebGLBackend,
  WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  attributeArray,
  float,
  instanceIndex,
  renderOutput,
  uv,
  vec4,
  wgslFn,
} from 'three/tsl';

function serializeError(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  };
}

function readCanvasStats(canvas) {
  const probe = document.createElement('canvas');
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D readback context unavailable');
  ctx.drawImage(canvas, 0, 0);
  const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
  let nonBlack = 0;
  let sum = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i] + data[i + 1] + data[i + 2];
    sum += v;
    min = Math.min(min, data[i], data[i + 1], data[i + 2]);
    max = Math.max(max, data[i], data[i + 1], data[i + 2]);
    if (v > 30) nonBlack++;
  }
  const pixels = data.length / 4;
  return {
    width: probe.width,
    height: probe.height,
    nonBlackPixels: nonBlack,
    nonBlackPct: pixels === 0 ? 0 : (nonBlack / pixels) * 100,
    avgRgb: pixels === 0 ? 0 : sum / pixels / 3,
    minChannel: min,
    maxChannel: max,
  };
}

function backendName(renderer) {
  const backend = renderer.backend;
  if (backend?.isWebGPUBackend) return 'webgpu';
  if (backend?.isWebGLBackend) return 'webgl2';
  return backend?.constructor?.name ?? 'unknown';
}

async function waitForGpuIdle(renderer) {
  const queue = renderer.backend?.device?.queue;
  if (typeof queue?.onSubmittedWorkDone === 'function') await queue.onSubmittedWorkDone();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function runProbe() {
  const result = {
    status: 'running',
    threeRevision: REVISION,
    imports: {
      WebGPURenderer: typeof WebGPURenderer,
      WebGPUBackend: typeof WebGPUBackend,
      WebGLBackend: typeof WebGLBackend,
      RenderPipeline: typeof RenderPipeline,
      Fn: typeof Fn,
      wgslFn: typeof wgslFn,
      attributeArray: typeof attributeArray,
      instanceIndex: typeof instanceIndex,
    },
    browser: {
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext,
      navigatorGpu: Boolean(navigator.gpu),
    },
    renderer: null,
    renderPipeline: null,
    compute: null,
    errors: [],
  };

  const canvas = document.createElement('canvas');
  canvas.id = 'webgpu-r184-probe-canvas';
  canvas.width = 96;
  canvas.height = 64;
  canvas.style.width = '384px';
  canvas.style.height = '256px';
  canvas.style.imageRendering = 'pixelated';
  document.body.append(canvas);

  let renderer = null;
  try {
    renderer = new WebGPURenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      forceWebGL: false,
      powerPreference: 'high-performance',
      trackTimestamp: false,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(canvas.width, canvas.height, false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    await renderer.init();

    result.renderer = {
      actualBackend: backendName(renderer),
      backendClass: renderer.backend?.constructor?.name ?? null,
      compatibilityMode: renderer.backend?.compatibilityMode ?? null,
      canvasDataEngine: canvas.getAttribute('data-engine'),
      deviceFeatures: Array.from(renderer.backend?.device?.features ?? []).sort(),
      requestedForceWebGL: false,
    };

    const nodeChain = Fn(() => {
      const pixel = uv();
      return vec4(pixel.x.mul(0.55).add(0.08), pixel.y.mul(0.65).add(0.12), 0.72, 1.0);
    })();
    const pipeline = new RenderPipeline(
      renderer,
      renderOutput(nodeChain, NoToneMapping, SRGBColorSpace),
    );
    pipeline.outputColorTransform = false;
    for (let i = 0; i < 4; i++) {
      pipeline.render();
      await waitForGpuIdle(renderer);
    }
    const canvasStats = readCanvasStats(canvas);
    result.renderPipeline = {
      outputColorTransform: pipeline.outputColorTransform,
      browserReadbackNonBlank: canvasStats.nonBlackPixels > 0 && canvasStats.maxChannel > 32,
      browserReadbackMethod: '2d-drawImage',
      canvasStats,
    };

    const values = attributeArray(new Float32Array([0, 0, 0, 0]), 'float').setName(
      'ProbeStorage',
    );
    const addOneWgsl = wgslFn(`
      fn probeAddOne(value: f32) -> f32 {
        return value + 1.0;
      }
    `);
    const initCompute = Fn(() => {
      const slot = values.element(instanceIndex);
      slot.assign(float(instanceIndex).mul(2.0));
    })().compute(4, [4]);
    initCompute.name = 'ProbeInitStorage';
    await renderer.computeAsync(initCompute);

    const wgslCompute = Fn(() => {
      const slot = values.element(instanceIndex);
      slot.assign(addOneWgsl(slot));
    })().compute(4, [4]);
    wgslCompute.name = 'ProbeWgslStorage';
    await renderer.computeAsync(wgslCompute);
    await waitForGpuIdle(renderer);

    const buffer = await renderer.getArrayBufferAsync(values.value);
    const readback = Array.from(new Float32Array(buffer)).slice(0, 4);
    const expected = [1, 3, 5, 7];
    const matches = expected.every((value, index) => Math.abs(value - readback[index]) < 0.0001);
    result.compute = {
      storageNodeValueClass: values.value?.constructor?.name ?? null,
      dispatchSize: 4,
      workgroupSize: [4],
      wgslHelper: 'probeAddOne(value: f32) -> f32',
      readbackApi: 'renderer.getArrayBufferAsync',
      readback,
      expected,
      matches,
    };

    if (result.renderer.actualBackend !== 'webgpu') {
      throw new Error(`Expected actual WebGPU backend, got ${result.renderer.actualBackend}`);
    }
    if (!result.compute.matches) {
      throw new Error(`Compute readback mismatch: ${readback.join(',')} vs ${expected.join(',')}`);
    }

    result.status = 'passed';
    return result;
  } catch (error) {
    result.status = 'failed';
    result.errors.push(serializeError(error));
    return result;
  } finally {
    if (renderer) renderer.dispose();
  }
}

window.__webgpuR184ProbePromise = runProbe().then((result) => {
  window.__webgpuR184Probe = result;
  return result;
});

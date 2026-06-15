import {
  LinearSRGBColorSpace,
  NearestFilter,
  NoToneMapping,
  RenderPipeline,
  RenderTarget,
  StorageTexture,
  UnsignedByteType,
  WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  float,
  If,
  instanceIndex,
  ivec2,
  renderOutput,
  textureLoad,
  textureStore,
  uint,
  uvec2,
  uv,
  vec2,
  vec4,
} from 'three/tsl';

const DEFAULT_WIDTH = 128;
const DEFAULT_HEIGHT = 96;
const DEFAULT_SCALE = 4;

function intParam(name, fallback, min, max) {
  const raw = new URLSearchParams(window.location.search).get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

const WIDTH = intParam('w', DEFAULT_WIDTH, 1, 2048);
const HEIGHT = intParam('h', DEFAULT_HEIGHT, 1, 2048);
const SCALE = intParam('scale', DEFAULT_SCALE, 1, 8);
const STORAGE_WIDTH = intParam('storageW', WIDTH, WIDTH, 4096);
const STORAGE_HEIGHT = intParam('storageH', HEIGHT, HEIGHT, 4096);

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function asUint8Array(data) {
  return data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function unpackPaddedRows(paddedData, rowBytes, height, paddedRowBytes = align(rowBytes, 256)) {
  const padded = asUint8Array(paddedData);
  if (rowBytes === paddedRowBytes) return new Uint8Array(padded);
  const out = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row++) {
    out.set(padded.subarray(row * paddedRowBytes, row * paddedRowBytes + rowBytes), row * rowBytes);
  }
  return out;
}

function expectedPixel(x, y) {
  const r = Math.round((x / (WIDTH - 1)) * 255);
  const g = Math.round((y / (HEIGHT - 1)) * 255);
  const b = Math.round((((x + y) % 32) / 31) * 255);
  return [r, g, b, 255];
}

function comparePixels(readback) {
  const samples = [
    [0, 0],
    [WIDTH - 1, 0],
    [0, HEIGHT - 1],
    [WIDTH - 1, HEIGHT - 1],
    [Math.floor(WIDTH / 2), Math.floor(HEIGHT / 2)],
    [17, 31],
    [93, 47],
  ];
  const sampleKeys = new Set(samples.map(([x, y]) => `${x},${y}`));
  let maxDelta = 0;
  let mismatches = 0;
  let exact = 0;
  let sumDelta = 0;
  const sampleResults = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const actual = Array.from(readback.slice(i, i + 4));
      const expected = expectedPixel(x, y);
      const delta = expected.map((v, c) => Math.abs(v - actual[c]));
      const sampleMax = Math.max(...delta);
      if (sampleMax === 0) exact++;
      if (sampleMax > 1) mismatches++;
      maxDelta = Math.max(maxDelta, sampleMax);
      sumDelta += delta[0] + delta[1] + delta[2] + delta[3];
      if (sampleKeys.has(`${x},${y}`)) {
        sampleResults.push({ x, y, expected, actual, maxDelta: sampleMax });
      }
    }
  }
  sampleResults.sort((a, b) => a.y - b.y || a.x - b.x);
  const pixels = WIDTH * HEIGHT;
  return {
    maxDelta,
    mismatches,
    mismatchPct: (mismatches / pixels) * 100,
    exactPct: (exact / pixels) * 100,
    meanDelta: sumDelta / (pixels * 4),
    sampleResults,
  };
}

function summarizeImage(readback) {
  let nonBlackPixels = 0;
  let maxChannel = 0;
  let sumRgb = 0;
  for (let i = 0; i < readback.length; i += 4) {
    const r = readback[i];
    const g = readback[i + 1];
    const b = readback[i + 2];
    if (r !== 0 || g !== 0 || b !== 0) nonBlackPixels++;
    maxChannel = Math.max(maxChannel, r, g, b);
    sumRgb += r + g + b;
  }
  const pixels = readback.length / 4;
  return {
    nonBlackPixels,
    nonBlackPct: nonBlackPixels / pixels,
    averageRgb: sumRgb / (pixels * 3),
    maxChannel,
  };
}

function makeStorageCompute(storageTexture) {
  return Fn(() => {
    const x = instanceIndex.mod(uint(STORAGE_WIDTH));
    const y = instanceIndex.div(uint(STORAGE_WIDTH));
    If(x.lessThan(uint(WIDTH)).and(y.lessThan(uint(HEIGHT))), () => {
      const r = x.toFloat().div(float(WIDTH - 1));
      const g = y.toFloat().div(float(HEIGHT - 1));
      const b = x.add(y).mod(uint(32)).toFloat().div(float(31));
      textureStore(storageTexture, uvec2(x, y), vec4(r, g, b, 1)).toWriteOnly();
    });
  })()
    .compute(STORAGE_WIDTH * STORAGE_HEIGHT, [64])
    .setName('Phase 4.4 Storage Texture Bridge Fill');
}

function makeOutputNode(storageTexture) {
  const node = Fn(() => {
    const p = uv().mul(vec2(WIDTH, HEIGHT)).floor();
    const coord = ivec2(p).clamp(ivec2(0, 0), ivec2(WIDTH - 1, HEIGHT - 1));
    return vec4(textureLoad(storageTexture, coord).rgb, 1);
  })();
  return renderOutput(node, NoToneMapping, LinearSRGBColorSpace);
}

async function main() {
  const canvas = document.createElement('canvas');
  canvas.id = 'webgpu-storage-bridge-output';
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  canvas.style.width = `${WIDTH * SCALE}px`;
  canvas.style.height = `${HEIGHT * SCALE}px`;
  document.body.appendChild(canvas);

  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    forceWebGL: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(SCALE);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = LinearSRGBColorSpace;
  await renderer.init();

  const backend = renderer.backend;
  const device = backend?.device;
  const storageTexture = new StorageTexture(STORAGE_WIDTH, STORAGE_HEIGHT);
  storageTexture.name = 'phase4_4_storage_bridge';
  storageTexture.minFilter = NearestFilter;
  storageTexture.magFilter = NearestFilter;
  storageTexture.mipmapsAutoUpdate = false;

  const computeNode = makeStorageCompute(storageTexture);
  const computeStart = performance.now();
  renderer.compute(computeNode);
  await device?.queue?.onSubmittedWorkDone?.();
  const computeWallMs = performance.now() - computeStart;

  const pipeline = new RenderPipeline(renderer, makeOutputNode(storageTexture));
  pipeline.outputColorTransform = false;
  pipeline.render();
  await device?.queue?.onSubmittedWorkDone?.();

  const target = new RenderTarget(WIDTH, HEIGHT, {
    depthBuffer: false,
    type: UnsignedByteType,
  });
  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  pipeline.render();
  renderer.setRenderTarget(previousTarget);
  await device?.queue?.onSubmittedWorkDone?.();
  const rawReadback = await renderer.readRenderTargetPixelsAsync(target, 0, 0, WIDTH, HEIGHT);
  const readbackRowBytes = WIDTH * 4;
  const readbackPaddedRowBytes = align(readbackRowBytes, 256);
  const readback = unpackPaddedRows(rawReadback, readbackRowBytes, HEIGHT, readbackPaddedRowBytes);
  const comparison = comparePixels(readback);
  const image = summarizeImage(readback);

  pipeline.dispose();
  target.dispose();
  storageTexture.dispose();

  const failures = [];
  if (backend?.isWebGPUBackend !== true) failures.push('renderer did not initialize with WebGPU backend');
  if (comparison.maxDelta > 1 || comparison.mismatches > 0) {
    failures.push('storage texture bridge readback mismatched expected gradient');
  }
  if (image.nonBlackPct < 0.98) {
    failures.push('storage texture bridge output missed nonblack coverage gate');
  }

  window.__webgpuStorageBridgeResult = {
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
    backend: {
      isWebGPUBackend: backend?.isWebGPUBackend === true,
      isWebGLBackend: backend?.isWebGLBackend === true,
      deviceFeatures: Array.from(device?.features ?? []).sort(),
      deviceLimits: {
        maxStorageTexturesPerShaderStage: device?.limits?.maxStorageTexturesPerShaderStage,
        maxSampledTexturesPerShaderStage: device?.limits?.maxSampledTexturesPerShaderStage,
        maxTextureDimension2D: device?.limits?.maxTextureDimension2D,
      },
    },
    bridge: {
      dimensions: [WIDTH, HEIGHT],
      storageDimensions: [STORAGE_WIDTH, STORAGE_HEIGHT],
      outputDimensions: [WIDTH * SCALE, HEIGHT * SCALE],
      scale: SCALE,
      textureKind: 'StorageTexture',
      computeNode: 'TSL Fn + textureStore',
      presentationNode: 'TSL RenderPipeline + textureLoad',
      workgroupSize: [64],
      comparison,
      image,
      readbackLayout: {
        rawBytes: rawReadback.byteLength,
        tightBytes: readback.byteLength,
        rowBytes: readbackRowBytes,
        paddedRowBytes: readbackPaddedRowBytes,
        rowPaddingBytes: readbackPaddedRowBytes - readbackRowBytes,
      },
      timings: {
        computeSubmitWallMs: computeWallMs,
      },
    },
  };
}

main().catch((error) => {
  window.__webgpuStorageBridgeResult = {
    status: 'failed',
    failures: [error?.message ?? String(error)],
    error: {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    },
  };
});

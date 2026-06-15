import {
  DataTexture,
  LinearSRGBColorSpace,
  NearestFilter,
  NoColorSpace,
  NoToneMapping,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  RGBAFormat,
  UnsignedByteType,
  Vector4,
  WebGPURenderer,
} from 'three/webgpu';
import { clamp, floor, ivec2, screenCoordinate, textureLoad, vec2 } from 'three/tsl';

const WIDTH = 4;
const HEIGHT = 4;
const SCALE = 16;
const TARGET_WIDTH = WIDTH * SCALE;
const TARGET_HEIGHT = HEIGHT * SCALE;

function makeCanaryTexture() {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const o = (y * WIDTH + x) * 4;
      data[o] = x * 64 + y * 7;
      data[o + 1] = y * 64 + x * 5;
      data[o + 2] = 32 + x * 17 + y * 11;
      data[o + 3] = 255;
    }
  }
  const tex = new DataTexture(data, WIDTH, HEIGHT, RGBAFormat, UnsignedByteType);
  tex.colorSpace = NoColorSpace;
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return { data, tex };
}

function compareTextureReadback(expected, actual, orientation) {
  const samples = [];
  let maxDelta = 0;
  let mismatches = 0;
  for (let y = 0; y < TARGET_HEIGHT; y++) {
    for (let x = 0; x < TARGET_WIDTH; x++) {
      const sourceX = Math.min(WIDTH - 1, Math.floor(x / SCALE));
      const sourceY = Math.min(HEIGHT - 1, Math.floor(y / SCALE));
      const expectedY = orientation === 'flipped-y' ? HEIGHT - 1 - sourceY : sourceY;
      const expectedOffset = (expectedY * WIDTH + sourceX) * 4;
      const actualOffset = (y * TARGET_WIDTH + x) * 4;
      const sample = {
        x: sourceX,
        y: sourceY,
        targetX: x,
        targetY: y,
        expected: Array.from(expected.slice(expectedOffset, expectedOffset + 4)),
        actual: Array.from(actual.slice(actualOffset, actualOffset + 4)),
      };
      for (let c = 0; c < 4; c++) {
        const delta = Math.abs(sample.expected[c] - sample.actual[c]);
        if (delta > maxDelta) maxDelta = delta;
        if (delta > 2) mismatches++;
      }
      const blockCenter = Math.floor(SCALE / 2);
      if (x % SCALE === blockCenter && y % SCALE === blockCenter) samples.push(sample);
    }
  }
  return { maxDelta, mismatches, samples };
}

function summarizePixels(pixels, width, height) {
  let nonBlackPixels = 0;
  let rgbTotal = 0;
  let maxChannel = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (r !== 0 || g !== 0 || b !== 0) nonBlackPixels++;
    rgbTotal += r + g + b;
    maxChannel = Math.max(maxChannel, r, g, b);
  }
  return {
    width,
    height,
    nonBlackPixels,
    nonBlackPct: nonBlackPixels / (width * height),
    averageRgb: rgbTotal / (width * height * 3),
    maxChannel,
  };
}

function createReadbackVisualization(readback) {
  const visual = document.createElement('canvas');
  visual.width = TARGET_WIDTH;
  visual.height = TARGET_HEIGHT;
  visual.id = 'readback-visualization';
  visual.style.width = '128px';
  visual.style.height = '128px';
  visual.style.imageRendering = 'pixelated';
  const ctx = visual.getContext('2d');
  if (!ctx) throw new Error('Unable to create 2D context for readback visualization');
  const pixels = new Uint8ClampedArray(readback);
  ctx.putImageData(new ImageData(pixels, TARGET_WIDTH, TARGET_HEIGHT), 0, 0);
  document.body.appendChild(visual);
  return summarizePixels(pixels, TARGET_WIDTH, TARGET_HEIGHT);
}

async function runTslTextureLoadCanary(renderer) {
  const { data, tex } = makeCanaryTexture();
  const material = new NodeMaterial();
  const texel = ivec2(clamp(floor(screenCoordinate.div(SCALE)), vec2(0, 0), vec2(WIDTH - 1, HEIGHT - 1)));
  material.fragmentNode = textureLoad(tex, texel);

  const quad = new QuadMesh(material);
  const target = new RenderTarget(TARGET_WIDTH, TARGET_HEIGHT, { depthBuffer: false, type: UnsignedByteType });
  target.texture.colorSpace = NoColorSpace;
  target.texture.minFilter = target.texture.magFilter = NearestFilter;
  target.viewport.set(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  target.scissor.set(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  target.scissorTest = false;

  const previousTarget = renderer.getRenderTarget();
  const previousViewport = new Vector4();
  renderer.getViewport(previousViewport);
  renderer.setViewport(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  renderer.setRenderTarget(target);
  quad.render(renderer);
  renderer.setRenderTarget(previousTarget);
  renderer.setViewport(previousViewport);

  const readback = await renderer.readRenderTargetPixelsAsync(target, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  const normal = compareTextureReadback(data, readback, 'normal');
  const flipped = compareTextureReadback(data, readback, 'flipped-y');
  const comparison = normal.mismatches <= flipped.mismatches
    ? { ...normal, orientation: 'normal' }
    : { ...flipped, orientation: 'flipped-y' };

  const readbackVisualization = createReadbackVisualization(readback);

  material.dispose();
  tex.dispose();
  target.dispose();

  return {
    status: comparison.mismatches === 0 ? 'passed' : 'failed',
    width: WIDTH,
    height: HEIGHT,
    targetWidth: TARGET_WIDTH,
    targetHeight: TARGET_HEIGHT,
    scale: SCALE,
    orientation: comparison.orientation,
    maxDelta: comparison.maxDelta,
    mismatches: comparison.mismatches,
    samples: comparison.samples,
    readbackVisualization,
  };
}

async function runRawWgslComputeCanary(renderer) {
  const backend = renderer.backend;
  const device = backend?.device;
  if (!device) throw new Error('Three WebGPU backend did not expose a GPUDevice');

  const input = new Uint32Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const byteLength = input.byteLength;
  const storage = device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(storage.getMappedRange()).set(input);
  storage.unmap();

  const readback = device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const shader = device.createShaderModule({
    label: 'phase4_2_raw_wgsl_compute_canary',
    code: `
      @group(0) @binding(0) var<storage, read_write> values: array<u32>;

      @compute @workgroup_size(8)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let i = id.x;
        values[i] = values[i] * 3u + 7u;
      }
    `,
  });
  const pipeline = device.createComputePipeline({
    label: 'phase4_2_raw_wgsl_compute_pipeline',
    layout: 'auto',
    compute: { module: shader, entryPoint: 'main' },
  });
  const bindGroup = device.createBindGroup({
    label: 'phase4_2_raw_wgsl_compute_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: storage } }],
  });

  const encoder = device.createCommandEncoder({ label: 'phase4_2_raw_wgsl_compute_encoder' });
  const pass = encoder.beginComputePass({ label: 'phase4_2_raw_wgsl_compute_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(1);
  pass.end();
  encoder.copyBufferToBuffer(storage, 0, readback, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone?.();
  await readback.mapAsync(GPUMapMode.READ);
  const output = Array.from(new Uint32Array(readback.getMappedRange()).slice());
  readback.unmap();

  storage.destroy();
  readback.destroy();

  const expected = Array.from(input, (value) => value * 3 + 7);
  return {
    status: output.every((value, index) => value === expected[index]) ? 'passed' : 'failed',
    input: Array.from(input),
    output,
    expected,
  };
}

async function main() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
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
  renderer.setPixelRatio(1);
  renderer.setSize(TARGET_WIDTH, TARGET_HEIGHT, false);
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = LinearSRGBColorSpace;
  await renderer.init();

  const backend = renderer.backend;
  const device = backend?.device;
  const deviceFeatures = Array.from(device?.features ?? []).sort();
  const deviceLimits = {};
  for (const key of [
    'maxTextureDimension2D',
    'maxBindGroups',
    'maxSampledTexturesPerShaderStage',
    'maxSamplersPerShaderStage',
    'maxStorageBuffersPerShaderStage',
    'maxStorageBufferBindingSize',
    'maxBufferSize',
  ]) {
    const value = device?.limits?.[key];
    if (typeof value === 'number') deviceLimits[key] = value;
  }

  const textureLoadCanary = await runTslTextureLoadCanary(renderer);
  const rawWgslComputeCanary = await runRawWgslComputeCanary(renderer);
  const failures = [];
  if (backend?.isWebGPUBackend !== true) failures.push('renderer did not initialize with WebGPU backend');
  if (textureLoadCanary.status !== 'passed') failures.push('TSL textureLoad canary failed');
  if ((textureLoadCanary.readbackVisualization?.nonBlackPixels ?? 0) === 0) failures.push('readback visualization was blank');
  if (rawWgslComputeCanary.status !== 'passed') failures.push('raw WGSL compute canary failed');

  window.__webgpuComposeCanaryResult = {
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
    backend: {
      isWebGPUBackend: backend?.isWebGPUBackend === true,
      isWebGLBackend: backend?.isWebGLBackend === true,
      deviceFeatures,
      deviceLimits,
    },
    textureLoadCanary,
    rawWgslComputeCanary,
  };

  window.__webgpuComposeCanaryRenderer = renderer;
}

main().catch((error) => {
  window.__webgpuComposeCanaryResult = {
    status: 'failed',
    failures: [error?.message ?? String(error)],
    error: {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    },
  };
});

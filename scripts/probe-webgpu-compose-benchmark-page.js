import {
  LinearSRGBColorSpace,
  NearestFilter,
  NoToneMapping,
  RenderPipeline,
  StorageTexture,
  WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
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

import { resolveThreeStorageTextureAccess } from '/src/render/WebGpuStorageTextureAccess.ts';
import {
  Cell,
  COMPOSE_PAD,
  LIGHT_H,
  LIGHT_W,
  SCALE,
  VIEW_H,
  VIEW_W,
  VIG_CX,
  VIG_CY,
  VIG_MAXR2,
  WIN_H,
  WIN_W,
  WORLD_H,
  align,
  compareReadback,
  composeReference,
  makeLightField,
  makeLut,
  makeOverlay,
  makeWorldWindow,
  padRows,
  unpackPaddedRows,
} from './webgpu-compose-storage-fixture-model.mjs';

const DEFAULT_CPU_ITERATIONS = 60;
const DEFAULT_GPU_ITERATIONS = 180;
const DEFAULT_WARMUP_ITERATIONS = 20;

function readPositiveInteger(name, fallback) {
  const raw = new URLSearchParams(window.location.search).get(name);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function stats(values) {
  const n = values.length;
  if (n === 0) return { n: 0, mean: 0, sd: 0, min: 0, p50: 0, p95: 0, max: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance =
    n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n,
    mean,
    sd: Math.sqrt(variance),
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[n - 1],
  };
}

function createTexture(device, label, format, width, height, data, rowBytes) {
  const texture = device.createTexture({
    label,
    size: { width, height },
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const bytesPerRow = align(rowBytes, 256);
  device.queue.writeTexture(
    { texture },
    padRows(data, rowBytes, height, bytesPerRow),
    { bytesPerRow },
    { width, height },
  );
  return texture;
}

function makeStorageInitCompute(storageTexture) {
  return Fn(() => {
    const x = instanceIndex.mod(uint(VIEW_W));
    const y = instanceIndex.div(uint(VIEW_W));
    textureStore(storageTexture, uvec2(x, y), vec4(0, 0, 0, 1)).toWriteOnly();
  })()
    .compute(VIEW_W * VIEW_H, [64])
    .setName('Phase 4.10 WebGPU Compose Benchmark Storage Init');
}

function makeOutputNode(storageTexture) {
  const node = Fn(() => {
    const p = uv().mul(vec2(VIEW_W, VIEW_H)).floor();
    const coord = ivec2(p).clamp(ivec2(0, 0), ivec2(VIEW_W - 1, VIEW_H - 1));
    return vec4(textureLoad(storageTexture, coord).rgb, 1);
  })();
  return renderOutput(node, NoToneMapping, LinearSRGBColorSpace);
}

function createComputeShader() {
  return `
struct Params {
  ambient: f32,
  boost: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var uWin: texture_2d<u32>;
@group(0) @binding(1) var uLight: texture_2d<f32>;
@group(0) @binding(2) var uLut: texture_2d<f32>;
@group(0) @binding(3) var uOverlay: texture_2d<f32>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var uOutput: texture_storage_2d<rgba8unorm, write>;

fn softLit(lf: f32) -> f32 {
  var lit = lf * lf;
  if (lit > 1.25) {
    lit = min(2.0, 1.25 + (lit - 1.25) * 0.3);
  }
  return lit;
}

@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let col = i32(globalId.x);
  let rowB = i32(globalId.y);
  if (col >= ${VIEW_W} || rowB >= ${VIEW_H}) {
    return;
  }

  let vx = col;
  let vy = ${VIEW_H - 1} - rowB;
  let ov = textureLoad(uOverlay, vec2<i32>(col, rowB), 0);
  var c = vec3<f32>(0.0);

  if (ov.a <= 0.5) {
    let cell = textureLoad(uWin, vec2<i32>(vx + ${COMPOSE_PAD}, vy + ${COMPOSE_PAD}), 0);
    let typeId = i32(cell.a & 0x7fu);
    let charged = (cell.a & 0x80u) != 0u;
    let light = textureLoad(uLight, vec2<i32>(vx / 2, vy / 2), 0).rgb;
    let dx = f32(vx) - ${VIG_CX.toFixed(1)};
    let dy = f32(vy) - ${VIG_CY.toFixed(1)};
    let vg = 1.0 - 0.52 * ((dx * dx + dy * dy) / ${VIG_MAXR2.toFixed(1)});

    if (typeId == ${Cell.Empty}) {
      var r = 0.004;
      var g = 0.005;
      var b = 0.009;
      let depthShade = 0.78 + 0.22 * (1.0 - f32(480 + vy) / ${WORLD_H.toFixed(1)});
      r *= depthShade;
      g *= depthShade;
      b *= depthShade;
      var lf0 = min(2.2, light.r) * vg;
      r = (r * 0.62 + params.ambient * 0.022) * vg + r * lf0 * lf0 * 0.72;
      lf0 = min(2.2, light.g) * vg;
      g = (g * 0.62 + params.ambient * 0.022) * vg + g * lf0 * lf0 * 0.72;
      lf0 = min(2.2, light.b) * vg;
      b = (b * 0.62 + params.ambient * 0.032) * vg + b * lf0 * lf0 * 0.72;
      r += max(0.0, light.r - 0.25) * 0.045 * vg;
      g += max(0.0, light.g - 0.25) * 0.04 * vg;
      b += max(0.0, light.b - 0.25) * 0.035 * vg;
      c = vec3<f32>(r, g, b);
    } else {
      var base = vec3<f32>(f32(cell.r), f32(cell.g), f32(cell.b)) / 255.0;
      let scalar = textureLoad(uLut, vec2<i32>(typeId, 0), 0).r;
      var intensity = 1.0 + (params.boost - 1.0) * scalar;
      if (charged) {
        base = vec3<f32>(0.2, 0.75, 1.0);
        intensity = params.boost * 1.2;
      }
      let floorL = 0.06 * vg;
      let selfGlow = select(0.0, 0.45 + scalar * 1.55, scalar > 0.0);
      let lr = softLit((params.ambient + min(2.2, light.r)) * vg);
      let lg = softLit((params.ambient + min(2.2, light.g)) * vg);
      let lb = softLit((params.ambient + min(2.2, light.b)) * vg);
      c = vec3<f32>(
        base.r * max(lr, selfGlow) + base.r * floorL,
        base.g * max(lg, selfGlow) + base.g * floorL,
        base.b * max(lb, selfGlow) + base.b * floorL
      ) * intensity;
    }
  }

  textureStore(
    uOutput,
    vec2<i32>(col, rowB),
    vec4<f32>(clamp(c + ov.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0)
  );
}
`;
}

function createBenchmarkResources(renderer, storageTexture) {
  const device = renderer.backend?.device;
  if (!device) throw new Error('Three WebGPU backend did not expose a GPUDevice');

  const win = makeWorldWindow();
  const light = makeLightField();
  const lut = makeLut();
  const overlay = makeOverlay();

  renderer.compute(makeStorageInitCompute(storageTexture));
  const storageAccess = resolveThreeStorageTextureAccess(renderer, storageTexture, {
    expectedFormat: 'rgba8unorm',
    expectedWidth: VIEW_W,
    expectedHeight: VIEW_H,
    expectedMipLevelCount: 1,
    label: 'phase4_10_compose_benchmark_output',
  });

  const winTexture = createTexture(device, 'phase4_10_win_rgba8uint', 'rgba8uint', WIN_W, WIN_H, win, WIN_W * 4);
  const lightTexture = createTexture(
    device,
    'phase4_10_light_rgba32float',
    'rgba32float',
    LIGHT_W,
    LIGHT_H,
    light,
    LIGHT_W * 16,
  );
  const lutTexture = createTexture(device, 'phase4_10_lut_r32float', 'r32float', 256, 1, lut, 256 * 4);
  const overlayTexture = createTexture(
    device,
    'phase4_10_overlay_rgba16float',
    'rgba16float',
    VIEW_W,
    VIEW_H,
    overlay,
    VIEW_W * 8,
  );
  const uniformBuffer = device.createBuffer({
    label: 'phase4_10_params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([0.16, 1.65, 0, 0]));

  const module = device.createShaderModule({
    label: 'phase4_10_compose_benchmark_wgsl',
    code: createComputeShader(),
  });
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'phase4_10_compose_benchmark_bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      {
        binding: 5,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' },
      },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: 'phase4_10_compose_benchmark_pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module, entryPoint: 'cs' },
  });
  const bindGroup = device.createBindGroup({
    label: 'phase4_10_compose_benchmark_bind_group',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: winTexture.createView() },
      { binding: 1, resource: lightTexture.createView() },
      { binding: 2, resource: lutTexture.createView() },
      { binding: 3, resource: overlayTexture.createView() },
      { binding: 4, resource: { buffer: uniformBuffer } },
      { binding: 5, resource: storageAccess.baseMipView },
    ],
  });

  return {
    device,
    win,
    light,
    lut,
    overlay,
    pipeline,
    bindGroup,
    storageAccess,
    destroy() {
      winTexture.destroy();
      lightTexture.destroy();
      lutTexture.destroy();
      overlayTexture.destroy();
      uniformBuffer.destroy();
    },
  };
}

function encodeDispatch(device, pipeline, bindGroup, label, dispatchCount = 1) {
  const encoder = device.createCommandEncoder({ label: `${label}_encoder` });
  const pass = encoder.beginComputePass({ label: `${label}_pass` });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  for (let i = 0; i < dispatchCount; i++) {
    pass.dispatchWorkgroups(Math.ceil(VIEW_W / 8), Math.ceil(VIEW_H / 8));
  }
  pass.end();
  return encoder.finish();
}

async function dispatchAndWait(device, pipeline, bindGroup, label) {
  device.queue.submit([encodeDispatch(device, pipeline, bindGroup, label)]);
  await device.queue.onSubmittedWorkDone();
}

async function readOutput(device, outputTexture) {
  const outputRowBytes = VIEW_W * 4;
  const outputPaddedRowBytes = align(outputRowBytes, 256);
  const outputReadback = device.createBuffer({
    label: 'phase4_10_output_readback',
    size: outputPaddedRowBytes * VIEW_H,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'phase4_10_readback_encoder' });
  encoder.copyTextureToBuffer(
    { texture: outputTexture },
    { buffer: outputReadback, bytesPerRow: outputPaddedRowBytes },
    { width: VIEW_W, height: VIEW_H },
  );
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await outputReadback.mapAsync(GPUMapMode.READ);
  const paddedReadback = new Uint8Array(outputReadback.getMappedRange()).slice();
  outputReadback.unmap();
  outputReadback.destroy();
  return unpackPaddedRows(paddedReadback, outputRowBytes, VIEW_H, outputPaddedRowBytes);
}

function runCpuBenchmark(win, light, lut, overlay, iterations) {
  const warmupIterations = Math.min(5, iterations);
  for (let i = 0; i < warmupIterations; i++) composeReference(win, light, lut, overlay);

  const samples = [];
  let lastReference = null;
  const totalStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    lastReference = composeReference(win, light, lut, overlay);
    samples.push(lastReference.ms);
  }
  const totalWallMs = performance.now() - totalStart;
  return {
    iterations,
    totalWallMs,
    stats: stats(samples),
    samples,
    reference: lastReference,
    timingMethod:
      'CPU reference model wall-clock timing from composeReference(); includes the reference buffer allocation used by the parity fixture.',
  };
}

async function runGpuBenchmark(resources, iterations, warmupIterations) {
  const { device, pipeline, bindGroup } = resources;

  await device.queue.onSubmittedWorkDone();
  for (let i = 0; i < warmupIterations; i++) {
    await dispatchAndWait(device, pipeline, bindGroup, `phase4_10_warmup_${i}`);
  }

  const individualSamples = [];
  const individualStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await dispatchAndWait(device, pipeline, bindGroup, `phase4_10_individual_${i}`);
    individualSamples.push(performance.now() - start);
  }
  const individualTotalWallMs = performance.now() - individualStart;

  await device.queue.onSubmittedWorkDone();
  const batchStart = performance.now();
  device.queue.submit([
    encodeDispatch(device, pipeline, bindGroup, 'phase4_10_batched', iterations),
  ]);
  await device.queue.onSubmittedWorkDone();
  const batchedTotalWallMs = performance.now() - batchStart;

  return {
    iterations,
    warmupIterations,
    individualSubmitWait: {
      totalWallMs: individualTotalWallMs,
      stats: stats(individualSamples),
      samples: individualSamples,
    },
    batchedDispatchesOneSubmit: {
      totalWallMs: batchedTotalWallMs,
      meanPerDispatchMs: batchedTotalWallMs / iterations,
    },
    timingMethod:
      'performance.now around WebGPU command submission plus GPUQueue.onSubmittedWorkDone(); no timestamp-query GPU timestamps; validation readback is measured separately and excluded from steady-state samples.',
  };
}

async function runBenchmark(renderer, storageTexture) {
  const cpuIterations = readPositiveInteger('cpuIterations', DEFAULT_CPU_ITERATIONS);
  const gpuIterations = readPositiveInteger('gpuIterations', DEFAULT_GPU_ITERATIONS);
  const warmupIterations = readPositiveInteger('warmupIterations', DEFAULT_WARMUP_ITERATIONS);
  const resources = createBenchmarkResources(renderer, storageTexture);

  try {
    await resources.device.queue.onSubmittedWorkDone();
    const cpu = runCpuBenchmark(resources.win, resources.light, resources.lut, resources.overlay, cpuIterations);
    const referenceData = cpu.reference.data;
    delete cpu.reference;
    const webgpu = await runGpuBenchmark(resources, gpuIterations, warmupIterations);
    const readbackStart = performance.now();
    const readback = await readOutput(resources.device, resources.storageAccess.texture);
    const readbackWallMs = performance.now() - readbackStart;
    const comparison = compareReadback(referenceData, readback);
    const cpuMean = cpu.stats.mean;
    const individualMean = webgpu.individualSubmitWait.stats.mean;

    return {
      status: comparison.maxDelta <= 2 && comparison.bigPct <= 0.01 ? 'passed' : 'failed',
      dimensions: {
        view: [VIEW_W, VIEW_H],
        output: [VIEW_W * SCALE, VIEW_H * SCALE],
        window: [WIN_W, WIN_H],
        light: [LIGHT_W, LIGHT_H],
      },
      resourceFormats: {
        worldWindow: 'rgba8uint',
        lightField: 'rgba32float',
        bloomLut: 'r32float',
        overlay: 'rgba16float',
        outputStorage: 'rgba8unorm StorageTexture',
        outputStorageBackendFormat: resources.storageAccess.format,
        outputStorageAccess: resources.storageAccess.source,
        outputStorageDescriptor: resources.storageAccess.descriptor,
      },
      cpu,
      webgpu,
      validationReadback: {
        wallMs: readbackWallMs,
        comparison,
      },
      comparisonVsCpuReference: {
        individualSubmitWaitMeanSpeedup: cpuMean / individualMean,
      },
      caveats: [
        'This is a diagnostic raw WGSL compose subset benchmark, not the live game frame loop.',
        'The live WebGPU compose path is still productionAvailable=false.',
        'CPU reference timing uses the parity fixture model and is not a production-optimized CPU composer.',
        'Validation readback is intentionally excluded from steady-state WebGPU timing.',
        'Batched one-submit timing is a throughput diagnostic only and is not reported as a speedup.',
      ],
    };
  } finally {
    resources.destroy();
  }
}

async function main() {
  const canvas = document.createElement('canvas');
  canvas.id = 'webgpu-compose-benchmark-output';
  canvas.width = VIEW_W * SCALE;
  canvas.height = VIEW_H * SCALE;
  canvas.style.width = `${VIEW_W * SCALE}px`;
  canvas.style.height = `${VIEW_H * SCALE}px`;
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
  renderer.setSize(VIEW_W, VIEW_H, false);
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = LinearSRGBColorSpace;
  await renderer.init();

  const storageTexture = new StorageTexture(VIEW_W, VIEW_H);
  storageTexture.name = 'phase4_10_compose_benchmark_output';
  storageTexture.minFilter = NearestFilter;
  storageTexture.magFilter = NearestFilter;
  storageTexture.generateMipmaps = false;
  storageTexture.mipmapsAutoUpdate = false;

  const rawWgslBenchmark = await runBenchmark(renderer, storageTexture);
  const pipeline = new RenderPipeline(renderer, makeOutputNode(storageTexture));
  pipeline.outputColorTransform = false;
  pipeline.render();
  await renderer.backend?.device?.queue?.onSubmittedWorkDone?.();

  const backend = renderer.backend;
  const device = backend?.device;
  const deviceFeatures = Array.from(device?.features ?? []).sort();
  const deviceLimits = {};
  for (const key of [
    'maxTextureDimension2D',
    'maxBindGroups',
    'maxBindingsPerBindGroup',
    'maxSampledTexturesPerShaderStage',
    'maxSamplersPerShaderStage',
    'maxStorageTexturesPerShaderStage',
    'maxStorageBuffersPerShaderStage',
    'maxUniformBufferBindingSize',
    'maxStorageBufferBindingSize',
    'maxBufferSize',
    'maxComputeInvocationsPerWorkgroup',
    'maxComputeWorkgroupSizeX',
    'maxComputeWorkgroupSizeY',
  ]) {
    const value = device?.limits?.[key];
    if (typeof value === 'number') deviceLimits[key] = value;
  }

  const failures = [];
  if (backend?.isWebGPUBackend !== true) failures.push('renderer did not initialize with WebGPU backend');
  if (rawWgslBenchmark.status !== 'passed') failures.push('raw WGSL compose benchmark failed parity gate');

  window.__webgpuComposeBenchmarkResult = {
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
    backend: {
      isWebGPUBackend: backend?.isWebGPUBackend === true,
      isWebGLBackend: backend?.isWebGLBackend === true,
      deviceFeatures,
      deviceLimits,
    },
    rawWgslBenchmark,
  };

  window.__webgpuComposeBenchmarkRenderer = renderer;
  window.__webgpuComposeBenchmarkPipeline = pipeline;
  window.__webgpuComposeBenchmarkTexture = storageTexture;
}

main().catch((error) => {
  window.__webgpuComposeBenchmarkResult = {
    status: 'failed',
    failures: [error?.message ?? String(error)],
    error: {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    },
  };
});

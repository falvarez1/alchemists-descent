import { chooseRenderBackend } from '/src/render/backendSelection.ts';
import { WebGpuDeviceLifecycle } from '/src/render/WebGpuDeviceLifecycle.ts';

const base = {
  requested: 'auto',
  webglAvailable: true,
  webgl2Available: true,
  navigatorGpu: true,
  secureContext: true,
  adapterAvailable: true,
  deviceAvailable: true,
  webgpuBackendAvailable: true,
  forceWebGL: false,
  webgpuDisabled: false,
  webgpuLost: false,
  webgpuRecovered: false,
};

const cases = [
  {
    name: 'navigator.gpu absent',
    input: { ...base, navigatorGpu: false },
    expected: { actual: 'webgl2', reason: 'navigator-gpu-absent', fallback: true },
  },
  {
    name: 'insecure context',
    input: { ...base, secureContext: false },
    expected: { actual: 'webgl2', reason: 'webgpu-insecure-context', fallback: true },
  },
  {
    name: 'no adapter',
    input: { ...base, adapterAvailable: false },
    expected: { actual: 'webgl2', reason: 'webgpu-adapter-unavailable', fallback: true },
  },
  {
    name: 'device init failure',
    input: { ...base, deviceAvailable: false },
    expected: { actual: 'webgl2', reason: 'webgpu-device-init-failed', fallback: true },
  },
  {
    name: 'explicit forceWebGL',
    input: { ...base, forceWebGL: true },
    expected: { actual: 'webgl2', reason: 'force-webgl', fallback: false },
  },
  {
    name: 'requested webgl',
    input: { ...base, requested: 'webgl' },
    expected: { actual: 'webgl2', reason: 'requested-webgl', fallback: false },
  },
  {
    name: 'WebGPU disabled by user flag',
    input: { ...base, webgpuDisabled: true },
    expected: { actual: 'webgl2', reason: 'webgpu-disabled-by-user', fallback: true },
  },
  {
    name: 'WebGPU lost',
    input: { ...base, webgpuLost: true },
    expected: { actual: 'webgl2', reason: 'webgpu-device-lost', fallback: true },
  },
  {
    name: 'WebGPU recovered',
    input: { ...base, webgpuLost: true, webgpuRecovered: true },
    expected: { actual: 'webgpu', reason: 'webgpu-recovered', fallback: false },
  },
  {
    name: 'WebGPU backend missing',
    input: { ...base, webgpuBackendAvailable: false },
    expected: { actual: 'webgl2', reason: 'webgpu-backend-not-implemented', fallback: true },
  },
  {
    name: 'WebGPU available',
    input: base,
    expected: { actual: 'webgpu', reason: 'webgpu-available', fallback: false },
  },
];

function runSelectionMatrix() {
  const rows = [];
  const failures = [];
  for (const entry of cases) {
    const actual = chooseRenderBackend(entry.input);
    const pass =
      actual.actual === entry.expected.actual &&
      actual.reason === entry.expected.reason &&
      actual.fallback === entry.expected.fallback;
    rows.push({ ...entry, actual, pass });
    if (!pass) failures.push(entry.name);
  }
  return { rows, failures };
}

async function runDeviceLifecycleProbe() {
  const out = {
    supported: false,
    skippedReason: null,
    initial: null,
    afterLoss: null,
    recovery: null,
  };
  if (!navigator.gpu) {
    out.skippedReason = 'navigator.gpu unavailable';
    return out;
  }
  if (!window.isSecureContext) {
    out.skippedReason = 'insecure context';
    return out;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    out.skippedReason = 'requestAdapter returned null';
    return out;
  }
  const device = await adapter.requestDevice();
  const lifecycle = new WebGpuDeviceLifecycle();
  lifecycle.trackDevice(device, adapter);
  out.supported = true;
  out.initial = lifecycle.status();
  const recovery = await lifecycle.simulateLossAndRecover();
  out.afterLoss = {
    state: lifecycle.status().state,
    lostCount: lifecycle.status().lostCount,
    lastLossReason: lifecycle.status().lastLossReason,
  };
  out.recovery = {
    ok: recovery.ok,
    status: recovery.status,
    error: recovery.error ?? null,
  };
  return out;
}

async function main() {
  const selection = runSelectionMatrix();
  let lifecycle;
  try {
    lifecycle = await runDeviceLifecycleProbe();
  } catch (error) {
    lifecycle = {
      supported: false,
      skippedReason: 'probe failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const lifecyclePassed =
    lifecycle.supported === false ||
    (lifecycle.recovery?.ok === true &&
      lifecycle.recovery.status.state === 'recovered' &&
      lifecycle.recovery.status.lostCount >= 1);
  const failures = [
    ...selection.failures,
    ...(lifecyclePassed ? [] : ['device lifecycle recovery']),
  ];

  window.__renderBackendPhase2Probe = {
    status: failures.length === 0 ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    selection,
    lifecycle,
    failures,
  };
}

main().catch((error) => {
  window.__renderBackendPhase2Probe = {
    status: 'failed',
    generatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
});


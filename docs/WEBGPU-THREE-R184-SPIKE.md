# Three r184 WebGPU, TSL, and WGSL Spike

Status: Phase 1 kept, recorded 2026-06-15.

This note records the production-neutral API spike for
`WEBGPU-TSL-COMPUTE-IMPLEMENTATION-PLAN.md` Phase 1. The repo remains pinned to
`three` `0.184.0` and `@types/three` `0.184.1`; no dependency upgrade was
needed.

## Result Block

Task: prove the pinned Three r184 WebGPU, TSL, RenderPipeline, storage-buffer
compute, renderer-level storage readback, and WGSL helper APIs are viable
before production renderer work.

Baseline: current dependency pins, current WebGL2 production renderer path, and
Phase 0 GPU compose baseline artifact
`verify-out/perf-ab-postfx.gpucompose-chaos-1781502236136.json`.

Expected result: no production visual change, no dependency churn, actual
WebGPU backend in the spike, nonblank RenderPipeline output, and a successful
TSL compute readback using a WGSL-backed helper.

After:

- `npm run probe:webgpu-r184` passed in Headless Edge 150.
- Runtime-exercised `three/webgpu` APIs: `WebGPURenderer`, `WebGPUBackend`,
  `WebGLBackend`, `RenderPipeline`, and `REVISION`.
- Runtime-exercised `three/tsl` APIs: `Fn`, `wgslFn`, `attributeArray`,
  `instanceIndex`, `float`, `uv`, `vec4`, and `renderOutput`.
- Export-verified only, not runtime-exercised in this spike:
  `StorageBufferAttribute`, `StorageTexture`, `storage`, and `pass`.
- Requested backend: WebGPU via `new WebGPURenderer({ forceWebGL: false })`.
- Actual backend: `WebGPUBackend`, canvas marker `three.js r184 webgpu`,
  compatibility mode `false`.
- RenderPipeline visual evidence:
  `verify-out/webgpu-r184-spike/render-pipeline-1781504516218.png`.
- Screenshot pixel stats: `384x256`, `100%` nonblack pixels, average RGB
  `183.318`, max channel `227`.
- TSL + WGSL compute readback: expected `[1, 3, 5, 7]`, read back
  `[1, 3, 5, 7]` through `renderer.getArrayBufferAsync`.
- WebGL2 compose parity remains green: `scripts/probe-compose-parity.mjs`
  reported 8/8 assertions passing.
- Same-session unchanged WebGL path A/B after Phase 1:
  `verify-out/perf-ab-postfx.gpucompose-chaos-1781504567412.json`.
  GPU compose remained a large win: compose `19.683 -> 3.744 ms` (-81.0%),
  render `20.384 -> 4.872 ms` (-76.1%), frame `23.275 -> 8.520 ms`
  (-63.4%).

Actual result: keep. The pinned r184 APIs are sufficient for the Phase 2
renderer boundary and the minimal Phase 3 presentation shell. Later phases that
depend on storage textures, scene `pass(...)`, or texture upload/readback
layouts must add their own runtime probes before production use.

Decision: keep.

Validation:

- `node --check scripts/probe-webgpu-r184.mjs`
- `node --check scripts/probe-webgpu-r184-browser.js`
- `npm run probe:webgpu-r184`
- `npm run typecheck`
- `npm test` (34 files, 457 tests)
- `npm run lint`
- `npm run build`
- `node scripts/verify-game.mjs http://127.0.0.1:5187/` (one run was
  interrupted by a Vite reload during the final FPS sample; rerun passed with
  no console/page errors)
- `node scripts/probe-compose-parity.mjs http://127.0.0.1:5187/`
- `npm run perf:ab -- postFx.gpuCompose false true http://127.0.0.1:5187/ 360 4 chaos`

## Exact Working Syntax

Imports:

```js
import {
  NoToneMapping,
  RenderPipeline,
  SRGBColorSpace,
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
```

Renderer initialization:

```js
const renderer = new WebGPURenderer({
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
```

RenderPipeline/TSL post-style full-screen output:

```js
const nodeChain = Fn(() => {
  const pixel = uv();
  return vec4(pixel.x.mul(0.55).add(0.08), pixel.y.mul(0.65).add(0.12), 0.72, 1.0);
})();

const pipeline = new RenderPipeline(
  renderer,
  renderOutput(nodeChain, NoToneMapping, SRGBColorSpace),
);
pipeline.outputColorTransform = false;
pipeline.render();
```

Storage-buffer compute plus WGSL helper:

```js
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
await renderer.computeAsync(initCompute);

const wgslCompute = Fn(() => {
  const slot = values.element(instanceIndex);
  slot.assign(addOneWgsl(slot));
})().compute(4, [4]);
await renderer.computeAsync(wgslCompute);

const buffer = await renderer.getArrayBufferAsync(values.value);
const readback = Array.from(new Float32Array(buffer)).slice(0, 4);
```

## Notes For Later Phases

- `RenderPipeline` is the correct r184 post-processing surface for WebGPU work.
  Keep the WebGL `EffectComposer` chain as the fallback/reference path.
- Browser-side `drawImage(webgpuCanvas)` returned black pixels in this headless
  Edge probe even though the Playwright canvas screenshot was nonblank. Future
  WebGPU visual probes should validate the screenshot PNG or use explicit
  WebGPU texture readback; do not trust 2D canvas readback for WebGPU output.
- `renderer.getArrayBufferAsync(values.value)` is the preferred r184
  renderer-level storage-buffer readback syntax for non-frame-loop probes. It
  must not become a per-frame gameplay or rendering dependency.
- This spike ran in a shared dirty worktree. The raw JSON artifacts now include
  `git.dirty` and full `git.status` metadata so Phase 1 evidence is traceable
  even before these files are committed.
- Phase 1 failure blockers are: actual backend is not WebGPU, RenderPipeline
  screenshot is blank, compute readback differs from expected values, raw
  artifact is missing, or WebGL2 fallback/compose parity regresses.
- Adapter features observed include `timestamp-query`, `shader-f16`,
  `bgra8unorm-storage`, `float32-filterable`, and `float32-blendable`.
  Timestamp measurements were not captured in this spike.

// WebGPU virtual-world PREVIEW compute kernel (research spike). Generates a biome-tinted
// value-noise terrain preview on the GPU via raw WGSL compute, reads it back, and draws it.
// This is VISUAL-ONLY: f32 noise + base-field-only (no carve/dressing), so it approximates a
// biome backdrop, not the authoritative carved chunk. Sets window.__virtualPreviewResult.
const SIZE = 256;

const WGSL = `
struct Params { seed: u32, size: u32, originX: i32, originY: i32, threshold: f32, tintR: f32, tintG: f32, tintB: f32 };
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> outBuf: array<u32>;

fn hash2i(seed: u32, x: i32, y: i32) -> u32 {
  var h: u32 = seed ^ 0x9e3779b9u;
  h = h ^ (u32(x) * 0x85ebca6bu);
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h = h ^ (u32(y) * 0x27d4eb2fu);
  h = (h ^ (h >> 16u)) * 0x165667b1u;
  return h ^ (h >> 15u);
}
fn unitHash(seed: u32, x: i32, y: i32) -> f32 { return f32(hash2i(seed, x, y)) / 4294967296.0; }
fn ss(t: f32) -> f32 { return t * t * (3.0 - 2.0 * t); }
fn vnoise(seed: u32, x: f32, y: f32) -> f32 {
  let x0 = floor(x); let y0 = floor(y);
  let fx = ss(x - x0); let fy = ss(y - y0);
  let xi = i32(x0); let yi = i32(y0);
  let a = unitHash(seed, xi, yi); let b = unitHash(seed, xi + 1, yi);
  let c = unitHash(seed, xi, yi + 1); let d = unitHash(seed, xi + 1, yi + 1);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= p.size || gid.y >= p.size) { return; }
  let wx = f32(p.originX + i32(gid.x));
  let wy = f32(p.originY + i32(gid.y));
  let n = vnoise(p.seed, wx / 17.0 + 19.31, wy / 17.0 - 7.73);
  let solid = n > p.threshold;
  var r = p.tintR * 0.18; var g = p.tintG * 0.18; var b = p.tintB * 0.22;
  if (solid) { r = p.tintR; g = p.tintG; b = p.tintB; }
  let ri = u32(clamp(r, 0.0, 1.0) * 255.0);
  let gi = u32(clamp(g, 0.0, 1.0) * 255.0);
  let bi = u32(clamp(b, 0.0, 1.0) * 255.0);
  outBuf[gid.y * p.size + gid.x] = ri | (gi << 8u) | (bi << 16u) | (255u << 24u);
}`;

async function run() {
  const result = { status: 'failed', failures: [], available: false };
  try {
    if (!('gpu' in navigator)) { result.failures.push('navigator.gpu missing'); return result; }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { result.failures.push('no WebGPU adapter'); return result; }
    const device = await adapter.requestDevice();
    result.available = true;

    const cellCount = SIZE * SIZE;
    const byteLen = cellCount * 4;
    const outBuf = device.createBuffer({ size: byteLen, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const stageBuf = device.createBuffer({ size: byteLen, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const params = new ArrayBuffer(32);
    const dv = new DataView(params);
    dv.setUint32(0, 0x4e4f4954, true); // seed
    dv.setUint32(4, SIZE, true);       // size
    dv.setInt32(8, 0, true);           // originX
    dv.setInt32(12, 0, true);          // originY
    dv.setFloat32(16, 0.54, true);     // threshold (matches generator noiseThreshold default)
    dv.setFloat32(20, 0.42, true);     // tint R (earthen-ish brown)
    dv.setFloat32(24, 0.34, true);     // tint G
    dv.setFloat32(28, 0.26, true);     // tint B
    const paramBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(paramBuf, 0, params);

    const module = device.createShaderModule({ code: WGSL });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 1, resource: { buffer: outBuf } },
      ],
    });

    const dispatch = async () => {
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(SIZE / 8), Math.ceil(SIZE / 8));
      pass.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
    };

    await dispatch(); // warm-up (pipeline/shader compile)
    const t0 = performance.now();
    const REPS = 20;
    for (let i = 0; i < REPS; i++) await dispatch();
    const computeMs = (performance.now() - t0) / REPS;

    // Readback (validation only — excluded from the steady-state compute timing).
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(outBuf, 0, stageBuf, 0, byteLen);
    device.queue.submit([enc.finish()]);
    await stageBuf.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(stageBuf.getMappedRange().slice(0));
    stageBuf.unmap();

    let nonBlack = 0, sum = 0, solidish = 0;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] + data[i + 1] + data[i + 2];
      sum += v;
      if (v > 30) nonBlack++;
      if (data[i] > 80) solidish++;
    }
    const total = data.length / 4;

    // Visualize for the screenshot.
    const canvas = document.getElementById('preview');
    canvas.width = SIZE; canvas.height = SIZE;
    const g = canvas.getContext('2d');
    g.putImageData(new ImageData(new Uint8ClampedArray(data), SIZE, SIZE), 0, 0);

    result.stats = {
      cells: total,
      nonBlackPct: +((nonBlack / total) * 100).toFixed(1),
      avg: +(sum / total / 3).toFixed(1),
      solidPct: +((solidish / total) * 100).toFixed(1),
      computeMs: +computeMs.toFixed(3),
    };
    // It must produce a real, varied field (not all-solid, not all-empty, not blank).
    if (result.stats.nonBlackPct < 50) result.failures.push('preview mostly blank');
    if (result.stats.solidPct < 5 || result.stats.solidPct > 95) result.failures.push('terrain field not varied');
    result.status = result.failures.length === 0 ? 'passed' : 'failed';
    return result;
  } catch (e) {
    result.failures.push('exception: ' + (e && e.message ? e.message : String(e)));
    return result;
  }
}

run().then((r) => { window.__virtualPreviewResult = r; });

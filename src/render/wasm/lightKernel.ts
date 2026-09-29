import { LIGHT_WASM_BASE64 } from '@/render/wasm/lightWasm';

/**
 * Loader for the WASM SIMD light-propagation kernel (assembly/light.ts). The
 * kernel is BIT-IDENTICAL to render/propagateLight.ts (tests/wasm-light.test.ts)
 * and ~2.5x faster: it interleaves R, G, B per texel so the three channels ride
 * one pair of f64x2 vectors through every sweep.
 *
 * Instantiated synchronously from the embedded bytes. A browser without WASM
 * SIMD (Safari before 16.4) fails validation here, and the caller keeps the
 * TypeScript loop — same field either way.
 */

interface LightKernel {
  memory: WebAssembly.Memory;
  alloc(size: number): number;
  propagateExact(r: number, g: number, b: number, att: number, scratch: number, LW: number, LH: number): void;
}

// undefined = not yet attempted, null = unavailable (fall back to TS).
let cached: LightKernel | null | undefined;
let buffers: { n: number; r: number; g: number; b: number; att: number; scratch: number } | null = null;

function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function instance(): LightKernel | null {
  if (cached !== undefined) return cached;
  try {
    const module = new WebAssembly.Module(decodeBase64(LIGHT_WASM_BASE64));
    const wasm = new WebAssembly.Instance(module, {
      env: { abort() { throw new Error('light wasm aborted'); } },
    });
    cached = wasm.exports as unknown as LightKernel;
  } catch {
    cached = null;
  }
  return cached;
}

export function isLightWasmAvailable(): boolean {
  return instance() !== null;
}

/** Test/benchmark seam: 'ts' forces the TypeScript loop. */
let backend: 'auto' | 'ts' = 'auto';
export function setLightPropagationBackend(mode: 'auto' | 'ts'): void {
  backend = mode;
}

/**
 * Run the four light sweeps in WASM, in place on the three planes. Returns
 * false (touching nothing) when the kernel is unavailable or disabled.
 */
export function propagateLightWasm(
  LW: number, LH: number,
  lightR: Float32Array, lightG: Float32Array, lightB: Float32Array, lightAtt: Float32Array,
): boolean {
  if (backend === 'ts') return false;
  const ex = instance();
  if (!ex) return false;
  const n = LW * LH;
  if (!buffers || buffers.n !== n) {
    // Stub-runtime bump allocator: allocate once per field size and reuse.
    const bytes = n * 4;
    buffers = { n, r: ex.alloc(bytes), g: ex.alloc(bytes), b: ex.alloc(bytes), att: ex.alloc(bytes), scratch: ex.alloc(n * 32) };
  }
  // alloc may have grown (and detached) the memory, so view it AFTER allocating.
  const mem = new Float32Array(ex.memory.buffer);
  const { r, g, b, att, scratch } = buffers;
  mem.set(lightR, r >> 2); mem.set(lightG, g >> 2); mem.set(lightB, b >> 2); mem.set(lightAtt, att >> 2);
  ex.propagateExact(r, g, b, att, scratch, LW, LH);
  lightR.set(mem.subarray(r >> 2, (r >> 2) + n));
  lightG.set(mem.subarray(g >> 2, (g >> 2) + n));
  lightB.set(mem.subarray(b >> 2, (b >> 2) + n));
  return true;
}

import { ROUND_CORNERS_WASM_BASE64 } from '@/world/virtual/wasm/roundCornersWasm';

interface KernelExports {
  memory: WebAssembly.Memory;
  alloc(size: number): number;
  roundCorners(
    typesPtr: number,
    scratchPtr: number,
    size: number,
    originX: number,
    originY: number,
    seed: number,
    strength: number,
    passes: number,
  ): void;
  smoothTypes(typesPtr: number, scratchPtr: number, size: number, passes: number): void;
}

// undefined = not yet attempted, null = unavailable (fall back to TS).
let cached: KernelExports | null | undefined;
let buffers: { n: number; typesPtr: number; scratchPtr: number } | null = null;

function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  // atob is available in browsers, web workers, and Node >= 16 — every context this runs in.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function instance(): KernelExports | null {
  if (cached !== undefined) return cached;
  try {
    const module = new WebAssembly.Module(decodeBase64(ROUND_CORNERS_WASM_BASE64));
    const wasm = new WebAssembly.Instance(module, {
      env: {
        abort() {
          throw new Error('roundCorners wasm aborted');
        },
      },
    });
    cached = wasm.exports as unknown as KernelExports;
  } catch {
    cached = null;
  }
  return cached;
}

export function isRoundCornersWasmAvailable(): boolean {
  return instance() !== null;
}

/** Ensure the reused types+scratch buffers exist for grid size `n`, returning their pointers. */
function ensureBuffers(ex: KernelExports, n: number): { typesPtr: number; scratchPtr: number } {
  if (!buffers || buffers.n !== n) {
    // Stub-runtime bump allocator: alloc once per grid size and reuse across chunks.
    const typesPtr = ex.alloc(n);
    const scratchPtr = ex.alloc(n);
    buffers = { n, typesPtr, scratchPtr };
  }
  return buffers;
}

/**
 * WASM corner-rounding morphology. Mutates `types` in place to BYTE-IDENTICAL output of the
 * TypeScript `roundCaveCorners` loop. Returns false (without touching `types`) if the kernel
 * is unavailable so the caller can fall back to the TS path.
 */
export function roundCornersWasm(
  types: Uint8Array,
  size: number,
  originX: number,
  originY: number,
  seed: number,
  strength: number,
  passes: number,
): boolean {
  const ex = instance();
  if (!ex) return false;
  const n = size * size;
  if (types.length !== n) return false;
  const { typesPtr, scratchPtr } = ensureBuffers(ex, n);
  // alloc may have grown (and detached) the buffer, so build the view AFTER allocation.
  const mem = new Uint8Array(ex.memory.buffer);
  mem.set(types, typesPtr);
  ex.roundCorners(typesPtr, scratchPtr, size, originX, originY, seed >>> 0, strength, passes);
  types.set(mem.subarray(typesPtr, typesPtr + n));
  return true;
}

/**
 * WASM cellular smoothing (the integer morphology loop of `smoothTerrain`). Mutates `types` in
 * place to BYTE-IDENTICAL output of the TS loop; the caller still runs the TS color fix-up.
 * Returns false (without touching `types`) if the kernel is unavailable.
 */
export function smoothTypesWasm(types: Uint8Array, size: number, passes: number): boolean {
  const ex = instance();
  if (!ex) return false;
  const n = size * size;
  if (types.length !== n) return false;
  const { typesPtr, scratchPtr } = ensureBuffers(ex, n);
  const mem = new Uint8Array(ex.memory.buffer);
  mem.set(types, typesPtr);
  ex.smoothTypes(typesPtr, scratchPtr, size, passes);
  types.set(mem.subarray(typesPtr, typesPtr + n));
  return true;
}

import type RapierModule from '@dimforge/rapier2d-compat';

/**
 * Rapier2D ships as a WASM module that must be initialised once (async) before
 * any World/body is created. main.ts (and the Builder entry) await initRapier()
 * during boot, before `new Game()` constructs the RigidBodies subsystem.
 *
 * TWO BUILDS, ONE API. Where the browser runs WebAssembly SIMD (simd128 —
 * Chrome/Edge 91+, Firefox 89+, Safari 16.4+) the SIMD build loads: its solver
 * and contact kernels step ~20% faster (scripts/bench-rapier-terrain.mjs,
 * 400 moving boxes on voxel terrain: 0.30 -> 0.245 ms/step). Anywhere else the
 * scalar build loads. Both are the same Rapier version with identical types,
 * each in its own lazy chunk, so a browser downloads only the one it runs.
 */
export type Rapier = typeof RapierModule;

/** Live binding: set by initRapier() before any physics object exists. */
export let RAPIER: Rapier;

/** Which build initRapier() chose (telemetry / probes). */
export let rapierBuild: 'simd' | 'scalar' | null = null;

/** The smallest module using a v128 op (i8x16.splat + popcnt): validates only with simd128. */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

function simdSupported(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

async function load(): Promise<void> {
  const simd = simdSupported();
  const mod = simd ? await import('@dimforge/rapier2d-simd-compat') : await import('@dimforge/rapier2d-compat');
  RAPIER = mod.default as Rapier;
  rapierBuild = simd ? 'simd' : 'scalar';
  await RAPIER.init();
}

let initPromise: Promise<void> | null = null;
/** Idempotent. */
export function initRapier(): Promise<void> {
  initPromise ??= load();
  return initPromise;
}

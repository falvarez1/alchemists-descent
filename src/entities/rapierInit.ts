import RAPIER from '@dimforge/rapier2d-compat';

/**
 * rapier2d-compat 0.19.x's own `init()` hands wasm-bindgen the inlined module
 * as a bare byte array — the deprecated call form — so every boot logged
 * "using deprecated parameters for the initialization function; pass a single
 * object instead". Our call has no parameters to fix: the stale call lives
 * inside the package (0.20.0+ passes `{ module_or_path }`, but 0.20 also
 * reworks the solver API, so the upgrade is its own change). Until then that
 * one known line is dropped while init runs; every other warning passes through
 * untouched and console.warn is restored the moment init settles.
 */
const RAPIER_INIT_DEPRECATION = 'using deprecated parameters for the initialization function';

async function initQuietly(): Promise<void> {
  const warn = console.warn;
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && args[0].startsWith(RAPIER_INIT_DEPRECATION)) return;
    warn.apply(console, args);
  };
  try {
    await RAPIER.init();
  } finally {
    console.warn = warn;
  }
}

/**
 * Rapier2D ships as a WASM module that must be initialised once (async) before
 * any World/body is created. main.ts awaits initRapier() during boot, before
 * `new Game()` constructs the RigidBodies subsystem. Idempotent.
 */
let initPromise: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  initPromise ??= initQuietly();
  return initPromise;
}

export { RAPIER };

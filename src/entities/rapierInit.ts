import RAPIER from '@dimforge/rapier2d-compat';

/**
 * Rapier2D ships as a WASM module that must be initialised once (async) before
 * any World/body is created. main.ts awaits initRapier() during boot, before
 * `new Game()` constructs the RigidBodies subsystem. Idempotent.
 */
let initPromise: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  initPromise ??= RAPIER.init();
  return initPromise;
}

export { RAPIER };

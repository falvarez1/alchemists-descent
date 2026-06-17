/** World grid dimensions (simulation cells). */
export const WIDTH = 1600;
export const HEIGHT = 1064;

/** Camera window rendered each frame (simulation cells). */
export const VIEW_W = 525;
export const VIEW_H = 357;

/** Renderer output resolution (CSS pixels of the canvas backing store). */
export const RENDER_W = 1050;
export const RENDER_H = 714;

/** Margin of cells simulated beyond the camera window. */
export const SIM_MARGIN = 44;

/**
 * Hard cap on concurrently-alive ballistic particles.
 *
 * LAYOUT TRIGGER: the particle pool is array-of-objects (AoS), which is the
 * right choice while *sustained* live counts stay below ~10k — there AoS ties
 * or beats parallel typed arrays (working set is cache-resident and V8's
 * monomorphic object access is excellent). If a future effect genuinely
 * SUSTAINS >~10k live particles, switch `Particles` to structure-of-arrays
 * (one Float32Array/Int32Array per field): measured ~2x faster at 16k, ~4–6x
 * at 64k, and ~10x less GC churn, mostly from the render/compose draw pass.
 * Raising this ceiling alone is cheap (it costs nothing until actually filled).
 * Before refactoring, re-confirm the crossover on target hardware with
 * scripts/bench-particle-layout.mjs + scripts/perf-particles-12k.mjs.
 * FLECS / a WASM ECS was evaluated and rejected (see ARCHITECTURE.md).
 */
export const MAX_PARTICLES = 12000;

/** Fog-of-war minimap mask dimensions (1:8 downsample of the world). */
export const MINIMAP_W = 200;
export const MINIMAP_H = 133;

/** Death slow-motion: game ticks the slow-mo lasts, and its slowest time scale.
 *  The scale ramps from MIN back to 1.0 over the timer (a juicy ease-out as the
 *  wizard ragdolls). Rendering keeps running at full rate, so it reads as slow-mo,
 *  not stutter. */
export const DEATH_SLOWMO_FRAMES = 60;
export const DEATH_SLOWMO_MIN = 0.32;

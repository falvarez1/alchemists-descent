/**
 * The shared-memory protocol between the main thread and the sim workers
 * (docs/SANDBOX-MT.md). One Int32 control block carries each substep's
 * parameters and the work cursor; one Float64 block carries the few float
 * inputs the rules read; one Int32 per chunk records the generation in
 * which that chunk was last finished.
 *
 * Per substep: main writes the parameters, zeroes the cursor and bumps GEN.
 * Every participant (main included) then claims positions in the WAVEFRONT
 * order with Atomics.add, waits until the claimed chunk's dependencies are
 * finished this generation, sweeps it, and marks it finished. A worker then
 * publishes its effect log and seed boxes and bumps PUBLISHED; main merges
 * once PUBLISHED reaches the worker count.
 */
export const C_GEN = 0;
export const C_TICK = 1;
export const C_SUBSTEP = 2;
export const C_WORLD_SEED = 3;
export const C_MOVED_TICK = 4;
export const C_FLOW_STEP = 5;
export const C_PARAMS_EPOCH = 6;
export const C_PARTICLES = 7;
export const C_CURSOR = 8;
export const C_PUBLISHED = 9;
export const C_SHUTDOWN = 10;
export const CONTROL_INTS = 16;

export const F_PLAYER_X = 0;
export const F_PLAYER_Y = 1;
export const CONTROL_F64 = 4;

/** Activity chunk edge (cells). */
export const CHUNK = 64;
/**
 * Horizontal reach: every rule reads and writes within REACH cells of its
 * chunk's left/right edges. Chunks that run at the same time are at least two
 * chunk columns apart (see wavefrontSchedule), so their reach bands never
 * meet. Vertically there is NO limit: a running chunk owns its whole band.
 */
export const REACH = 32;
/** The pressure solver's horizontal scan margin (its neighbour reads go one further). */
export const FLOW_REACH = 30;

/** Serial-phase keys for reseedSimChunk (past any real chunk key). */
export const EXPLOSION_STREAM_KEY = 0x7ff0;
export const GROWTH_STREAM_KEY = 0x7ff1;

/** Doubles per participant effect log, and segment slots (one per chunk swept). */
export const LOG_CAPACITY = 1 << 18;
export const SEGMENT_CAPACITY = 2048;

export interface WavefrontSchedule {
  /** Chunk keys in replay order: bottom chunk row first; per row, even columns then odd. */
  order: Int32Array;
  /** deps[depStart[i] .. depStart[i+1]) = chunk keys position i must wait for. */
  depStart: Int32Array;
  deps: Int32Array;
}

/**
 * THE WAVEFRONT. The serial sweep runs bottom row first, so a falling column
 * crosses a chunk seam without a hitch and a rising one queues behind itself;
 * a 2x2 checkerboard (Noita's scheme) runs half the seams the other way round
 * and measurably changed how fire and steam spread. This order keeps "lower
 * before upper" at every seam: chunk (c, r) waits for (c-1..c+1, r+1) and, in
 * an odd column, for its even neighbours (c-1, r) and (c+1, r).
 *
 * Consequences, by induction over the order: two chunks that run concurrently
 * are always >= 2 columns apart, and while (c, r) runs, every chunk in columns
 * c-1..c+1 below it is finished and every one above it waits on it — so it may
 * read and write its whole vertical band (the pressure solver scans a pool's
 * surface up to 192 rows up) as long as it stays within REACH horizontally.
 */
export function wavefrontSchedule(width: number, height: number): WavefrontSchedule {
  const columns = Math.ceil(width / CHUNK), rows = Math.ceil(height / CHUNK);
  const order: number[] = [], depStart: number[] = [], deps: number[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    for (const parity of [0, 1]) {
      for (let c = parity; c < columns; c += 2) {
        order.push(c + r * columns);
        depStart.push(deps.length);
        if (r + 1 < rows) for (let dc = -1; dc <= 1; dc++) if (c + dc >= 0 && c + dc < columns) deps.push(c + dc + (r + 1) * columns);
        if (parity === 1) {
          deps.push(c - 1 + r * columns);
          if (c + 1 < columns) deps.push(c + 1 + r * columns);
        }
      }
    }
  }
  depStart.push(deps.length);
  return { order: Int32Array.from(order), depStart: Int32Array.from(depStart), deps: Int32Array.from(deps) };
}

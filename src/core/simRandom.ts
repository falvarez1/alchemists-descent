/**
 * Seeded, tick-indexed randomness for everything that is part of game state.
 *
 * WHY THIS EXISTS (docs/MULTIPLAYER-ARCHITECTURE.md, stage 4): `Math.random()`
 * made the simulation unreplayable, which cost us — in order of how much it
 * hurt — reproducible bug reports, golden-frame tests for the sim, cheap
 * input-only multiplayer, and any future rollback. Determinism pays for itself
 * in testing long before multiplayer ships.
 *
 * FOUR STREAMS, NOT ONE. Sharing a single stream would couple unrelated
 * subsystems: adding one particle would shift every liquid's settling for the
 * rest of the tick, and a golden-frame test could only ever report "everything
 * changed". Each stream is reseeded independently every tick, so a change in
 * one subsystem's draw count cannot move another's.
 *
 *   sim      — the cellular automata (`src/sim/**`). Hashed state.
 *   entity   — entities, combat, and the gameplay systems that drive them
 *              (`src/entities/**`, `src/combat/**`, `src/game/**`). Hashed state.
 *   particle — the particle simulation (`src/particles/**`). Hashed state, not
 *              cosmetics: a typed `looseDebris` particle DEPOSITS itself back
 *              into the grid when it lands (`Particles.ts` -> `replaceCellAt`),
 *              so where debris settles is a real cell outcome. Its own stream
 *              because spawn counts are the most volatile number in the game —
 *              sharing one would let a prettier explosion reroll enemy AI.
 *   fx       — draws whose only consumer is something no cell ever reads back:
 *              tint (`sim/colors.ts`), audio cues, and null-typed sparks.
 *
 * RESEEDED PER TICK, NOT RUN ONCE. A stream restarted from
 * `mix(worldSeed, tick, streamId)` every tick means a divergence inside tick N
 * cannot silently offset tick N+1 — it stays local, which is what makes a
 * failing golden frame point at a tick instead of at the whole run. The sim
 * stream goes further and reseeds per *substep*, because `Simulation.update`
 * runs 0–6 of those per tick.
 *
 * The generator is mulberry32 — the same one `core/rng.ts` uses for worldgen —
 * chosen here because it is counter-based: the state advances by a constant and
 * the output is a strong mix of it, so seeding from a counter is exactly the
 * usage it is designed for.
 *
 * WHAT DETERMINISM THIS BUYS, STATED HONESTLY: identical results for the same
 * seed and the same input sequence *on the same JavaScript engine*. `Math.sin`,
 * `Math.cos`, and `Math.pow` are not bit-specified by ECMA-262, so cross-engine
 * (or cross-version) lockstep would need those routed through our own
 * implementations. Replay, golden frames, and same-build multiplayer do not.
 */

/** Stream ids. Values are folded into the seed, so they must stay distinct and
 *  stable — changing one re-rolls that stream's entire history. */
const STREAM_SIM = 1;
const STREAM_ENTITY = 2;
const STREAM_FX = 3;
const STREAM_PARTICLE = 4;

/**
 * murmur3 fmix32. Consecutive ticks must not produce neighbouring streams, and
 * a weak mix would let tick N+1 start inside the range tick N already consumed.
 */
function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}

function seedFor(worldSeed: number, tick: number, stream: number): number {
  return mix32((worldSeed | 0) ^ Math.imul(tick | 0, 0x9e3779b1) ^ Math.imul(stream, 0x85ebca6b));
}

/* Stream state lives in an Int32Array, not in module-level `let`s. The state
 * is a full signed int32, and browsers that use pointer compression (Chrome,
 * Edge) keep only 31-bit SMIs unboxed — a `let` holding the state boxed a new
 * heap number on every draw (the sim draws millions per second). Typed-array
 * elements never box. Same 32 bits through the same imul/xor/shift. */
const SIM = 0, ENTITY = 1, PARTICLE = 2, FX = 3;
const state = new Int32Array(4);
state[SIM] = seedFor(0, 0, STREAM_SIM);
state[ENTITY] = seedFor(0, 0, STREAM_ENTITY);
state[PARTICLE] = seedFor(0, 0, STREAM_PARTICLE);
state[FX] = seedFor(0, 0, STREAM_FX);

/* Draw counters. One SMI increment against five arithmetic ops is free, and it
 * turns "the golden hash differs" into "the sim stream drew 8,301 times on one
 * side and 8,299 on the other, at tick 412" — which is the difference between a
 * bug report you can act on and one you cannot. */
const draws = new Float64Array(4);

/**
 * TEST SEAM. Tests need rolls a real generator cannot give them — "every roll
 * passes" (0) and "every roll fails" (0.999) — which is what the old
 * `vi.spyOn(Math, 'random')` bought. Overriding here keeps that ability instead
 * of quietly losing it: a test that *believes* it pinned randomness but did not
 * is the same false-trust failure this whole stage exists to remove.
 *
 * Null in production. `tests/setup.ts` clears it after every test, so no test
 * can leak a forced roll into the next one.
 */
let override: (() => number) | null = null;

/** Force every stream to `fn`, or pass null to restore real generation. */
export function setRandomOverrideForTests(fn: (() => number) | null): void {
  override = fn;
}

/** The cellular automata's stream. Drop-in for `Math.random()`. */
export function simRandom(): number {
  draws[SIM]++;
  if (override !== null) return override();
  let t = (state[SIM] + 0x6d2b79f5) | 0;
  state[SIM] = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Entities, combat, and the gameplay systems. Drop-in for `Math.random()`. */
export function entityRandom(): number {
  draws[ENTITY]++;
  if (override !== null) return override();
  let t = (state[ENTITY] + 0x6d2b79f5) | 0;
  state[ENTITY] = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The particle simulation's stream — state, see the header. Drop-in for `Math.random()`. */
export function particleRandom(): number {
  draws[PARTICLE]++;
  if (override !== null) return override();
  let t = (state[PARTICLE] + 0x6d2b79f5) | 0;
  state[PARTICLE] = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Cosmetics that never feed a decision. Drop-in for `Math.random()`. */
export function fxRandom(): number {
  draws[FX]++;
  if (override !== null) return override();
  let t = (state[FX] + 0x6d2b79f5) | 0;
  state[FX] = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Reseed the cell simulation's stream for one substep.
 *
 * `Simulation.update` runs up to six `processFrame` substeps per tick, and the
 * count itself varies with `simSpeed` — so the substep index has to take part
 * in the seed or two substeps in the same tick would replay each other.
 */
export function reseedSimSubstep(worldSeed: number, tick: number, substep: number): void {
  state[SIM] = seedFor(worldSeed, Math.imul(tick | 0, 8) + (substep | 0), STREAM_SIM);
}

/**
 * Reseed the sim AND fx streams for one chunk of one substep (the parallel
 * chunk sweep, sim/parallel). Every chunk draws from its own streams, so the
 * result cannot depend on which thread ran which chunk, or in what order the
 * chunks of one checkerboard pass finished. `key` is the activity chunk key;
 * keys past the chunk count name serial phases (explosion replay, growth).
 */
export function reseedSimChunk(worldSeed: number, tick: number, substep: number, key: number): void {
  const t = Math.imul(tick | 0, 8) + (substep | 0);
  const k = mix32(Math.imul((key | 0) + 1, 0x27d4eb2f) ^ t);
  state[SIM] = seedFor(worldSeed ^ k, t, STREAM_SIM);
  state[FX] = seedFor(worldSeed ^ k, t, STREAM_FX);
}

/** Reseed the tick-rate streams. Called once per game tick, before any system runs. */
export function reseedTickStreams(worldSeed: number, tick: number): void {
  state[ENTITY] = seedFor(worldSeed, tick, STREAM_ENTITY);
  state[PARTICLE] = seedFor(worldSeed, tick, STREAM_PARTICLE);
  state[FX] = seedFor(worldSeed, tick, STREAM_FX);
}

/**
 * Reseed every stream from a world seed at tick 0.
 *
 * World generation draws tint through `fxRandom` (see `sim/colors.ts`), so a
 * freshly generated world is only reproducible if the streams start from a
 * known point rather than from wherever the previous level left them.
 */
export function reseedAllStreams(worldSeed: number): void {
  state[SIM] = seedFor(worldSeed, 0, STREAM_SIM);
  state[ENTITY] = seedFor(worldSeed, 0, STREAM_ENTITY);
  state[PARTICLE] = seedFor(worldSeed, 0, STREAM_PARTICLE);
  state[FX] = seedFor(worldSeed, 0, STREAM_FX);
}

export interface SimRandomSnapshot {
  sim: number;
  entity: number;
  particle: number;
  fx: number;
  simDraws: number;
  entityDraws: number;
  particleDraws: number;
  fxDraws: number;
}

/** Capture every stream's exact position — for replay harnesses and tests. */
export function snapshotStreams(): SimRandomSnapshot {
  return {
    sim: state[SIM],
    entity: state[ENTITY],
    particle: state[PARTICLE],
    fx: state[FX],
    simDraws: draws[SIM],
    entityDraws: draws[ENTITY],
    particleDraws: draws[PARTICLE],
    fxDraws: draws[FX],
  };
}

/** Restore a captured position, draw counters included. */
export function restoreStreams(snap: SimRandomSnapshot): void {
  state[SIM] = snap.sim | 0;
  state[ENTITY] = snap.entity | 0;
  state[PARTICLE] = snap.particle | 0;
  state[FX] = snap.fx | 0;
  draws[SIM] = snap.simDraws;
  draws[ENTITY] = snap.entityDraws;
  draws[PARTICLE] = snap.particleDraws;
  draws[FX] = snap.fxDraws;
}

/** Zero the draw counters. Golden-frame tests count draws over a known span. */
export function resetDrawCounts(): void {
  draws.fill(0);
}

/** Draws taken since the last `resetDrawCounts`, per stream. */
export function drawCounts(): { sim: number; entity: number; particle: number; fx: number } {
  return { sim: draws[SIM], entity: draws[ENTITY], particle: draws[PARTICLE], fx: draws[FX] };
}

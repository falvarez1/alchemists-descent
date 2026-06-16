// AssemblyScript port of the hottest virtual-world generation pass: roundCaveCorners
// (the cellular corner-rounding morphology, ~38% of per-chunk generation time).
//
// PARITY CONTRACT: this must produce BYTE-IDENTICAL output to the TypeScript
// `roundCaveCorners` loop in src/world/virtual/ChunkGenerator.ts. Every op below maps
// exactly onto the JS reference: hashes are pure u32 (Math.imul -> wrapping i32/u32 mul),
// the value noise is pure polynomial f64 (floor + smoothstep + lerp, no transcendentals),
// so AS f64 == JS number bit-for-bit. tests/wasm-worldgen.test.ts enforces this.
//
// Cell ids are append-only ABI: Empty=0, Wall=3 (see sim/CellType.ts). Passed-in rather
// than hardcoded-by-faith would be safer, but these two ids are frozen by invariant.

const EMPTY: u8 = 0;
const WALL: u8 = 3;

// @ts-ignore: decorator
@inline
function hash2i(seed: u32, x: i32, y: i32): u32 {
  let h: u32 = seed ^ 0x9e3779b9;
  h ^= (x as u32) * 0x85ebca6b;
  h = (h ^ (h >>> 13)) * 0xc2b2ae35;
  h ^= (y as u32) * 0x27d4eb2f;
  h = (h ^ (h >>> 16)) * 0x165667b1;
  return h ^ (h >>> 15);
}

// @ts-ignore: decorator
@inline
function unitHash2i(seed: u32, x: i32, y: i32): f64 {
  return (hash2i(seed, x, y) as f64) / 4294967296.0;
}

// @ts-ignore: decorator
@inline
function smoothstep(t: f64): f64 {
  return t * t * (3.0 - 2.0 * t);
}

// @ts-ignore: decorator
@inline
function lerp(a: f64, b: f64, t: f64): f64 {
  return a + (b - a) * t;
}

function smoothValueNoise(seed: u32, x: f64, y: f64): f64 {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const xi = x0 as i32;
  const yi = y0 as i32;
  const a = unitHash2i(seed, xi, yi);
  const b = unitHash2i(seed, xi + 1, yi);
  const c = unitHash2i(seed, xi, yi + 1);
  const d = unitHash2i(seed, xi + 1, yi + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

// @ts-ignore: decorator
@inline
function organicNoise(seed: u32, x: i32, y: i32): f64 {
  return smoothValueNoise(seed, (x as f64) / 17.0 + 19.31, (y as f64) / 17.0 - 7.73);
}

function countSolidNeighbors(ptr: usize, size: i32, x: i32, y: i32): i32 {
  const i = x + y * size;
  let s = 0;
  if (load<u8>(ptr + i - size - 1) != EMPTY) s++;
  if (load<u8>(ptr + i - size) != EMPTY) s++;
  if (load<u8>(ptr + i - size + 1) != EMPTY) s++;
  if (load<u8>(ptr + i - 1) != EMPTY) s++;
  if (load<u8>(ptr + i + 1) != EMPTY) s++;
  if (load<u8>(ptr + i + size - 1) != EMPTY) s++;
  if (load<u8>(ptr + i + size) != EMPTY) s++;
  if (load<u8>(ptr + i + size + 1) != EMPTY) s++;
  return s;
}

/** Bump-allocate `size` bytes of linear memory (stub runtime; reused across chunks by the host). */
export function alloc(size: i32): usize {
  return heap.alloc(size as usize);
}

/**
 * Cellular smoothing morphology (the pure-integer loop of smoothTerrain): each pass fills the
 * scratch with Wall, then sets interior cells from the solid-neighbour count (>=5 Wall, <=2
 * Empty, else unchanged). Leaves the final result at `typesPtr`. The TS caller still does the
 * downstream color fix-up. Must stay byte-identical to the TS loop (tests/wasm-worldgen.test.ts).
 */
export function smoothTypes(typesPtr: usize, scratchPtr: usize, size: i32, passes: i32): void {
  let cur = typesPtr;
  let next = scratchPtr;
  const n = (size * size) as usize;
  for (let pass = 0; pass < passes; pass++) {
    memory.fill(next, WALL, n); // next.fill(Cell.Wall) — borders stay Wall (interior loop skips them)
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = x + y * size;
        const solid = countSolidNeighbors(cur, size, x, y);
        store<u8>(next + i, solid >= 5 ? WALL : (solid <= 2 ? EMPTY : load<u8>(cur + i)));
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  if (cur != typesPtr) memory.copy(typesPtr, cur, n);
}

/**
 * Run the corner-rounding morphology over `typesPtr` (size*size bytes), using `scratchPtr`
 * as the double-buffer. Leaves the final result at `typesPtr`. `strength`/`passes` are
 * computed host-side exactly as the TS path does.
 */
export function roundCorners(
  typesPtr: usize,
  scratchPtr: usize,
  size: i32,
  originX: i32,
  originY: i32,
  seed: u32,
  strength: f64,
  passes: i32,
): void {
  let cur = typesPtr;
  let next = scratchPtr;
  const n = (size * size) as usize;
  for (let pass = 0; pass < passes; pass++) {
    memory.copy(next, cur, n);
    const noiseSeed = seed ^ 0x2f7c6d31 ^ (pass as u32);
    for (let y = 1; y < size - 1; y++) {
      const wy = originY + y;
      for (let x = 1; x < size - 1; x++) {
        const i = x + y * size;
        const up = load<u8>(cur + i - size) != EMPTY;
        const down = load<u8>(cur + i + size) != EMPTY;
        const left = load<u8>(cur + i - 1) != EMPTY;
        const right = load<u8>(cur + i + 1) != EMPTY;
        const upLeft = load<u8>(cur + i - size - 1) != EMPTY;
        const upRight = load<u8>(cur + i - size + 1) != EMPTY;
        const downLeft = load<u8>(cur + i + size - 1) != EMPTY;
        const downRight = load<u8>(cur + i + size + 1) != EMPTY;

        if (load<u8>(cur + i) != EMPTY) {
          let convex = 0;
          if (!up && !left && !upLeft) convex++;
          if (!up && !right && !upRight) convex++;
          if (!down && !left && !downLeft) convex++;
          if (!down && !right && !downRight) convex++;
          let openCardinals = 0;
          if (!up) openCardinals++;
          if (!down) openCardinals++;
          if (!left) openCardinals++;
          if (!right) openCardinals++;
          if (convex > 0 && openCardinals >= 2) {
            const field = organicNoise(noiseSeed, originX + x, wy);
            const cc = convex < 2 ? convex : 2;
            if (field < 0.18 + strength * 0.5 + (cc as f64) * 0.08) {
              store<u8>(next + i, EMPTY);
            }
          }
        } else {
          let concave = 0;
          if (up && left && upLeft) concave++;
          if (up && right && upRight) concave++;
          if (down && left && downLeft) concave++;
          if (down && right && downRight) concave++;
          if (concave > 0) {
            const solid = countSolidNeighbors(cur, size, x, y);
            if (solid >= 5) {
              const field = organicNoise(noiseSeed, originX + x, wy);
              const cc = concave < 2 ? concave : 2;
              if (field < 0.08 + strength * 0.34 + (cc as f64) * 0.05) {
                store<u8>(next + i, WALL);
              }
            }
          }
        }
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  if (cur != typesPtr) memory.copy(typesPtr, cur, n);
}

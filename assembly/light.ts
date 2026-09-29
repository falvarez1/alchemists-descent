// AssemblyScript port of render/propagateLight.ts: the four directional light
// sweeps over the half-res light field (the hottest numeric loop in the frame).
//
// LAYOUT: the host copies the three planes (R, G, B) and the attenuation plane
// into linear memory; the kernel interleaves them into one texel = two f64x2
// vectors (r,g) and (b,0), sweeps, and de-interleaves back. Interleaving is what
// makes SIMD pay: all three channels of a texel move in lockstep.
//
// PARITY CONTRACT (`propagateExact`): BIT-IDENTICAL to the TypeScript loop. The
// JS reference computes in f64 (typed-array reads widen f32 -> f64 exactly) and
// rounds to f32 on every store; this does the same arithmetic in f64x2 lanes and
// rounds each stored value through f32 (demote -> promote). pmax(a, b) is
// `a < b ? b : a`, the same selection as the reference's ternaries for the
// finite, non-negative values light holds. tests/wasm-light.test.ts enforces it.

/** Bump-allocate `size` bytes of linear memory (stub runtime; reused by the host). */
export function alloc(size: i32): usize {
  return heap.alloc(size as usize);
}

/**
 * Propagate light in place, bit-identical to render/propagateLight.ts. `r/g/b/att`
 * are f32 planes of LW*LH texels; `L` is scratch of LW*LH*32 bytes (two f64x2 per
 * texel). Neighbour texels ride in registers along each sweep: the horizontal
 * sweeps carry the texel just written (it is the next one's straight input), the
 * vertical sweeps slide a three-texel window along the previous row.
 */
export function propagateExact(r: usize, g: usize, b: usize, att: usize, L: usize, LW: i32, LH: i32): void {
  const n = LW * LH;
  for (let i = 0; i < n; i++) {
    const o = (<usize>i) << 2, p = L + ((<usize>i) << 5);
    v128.store(p, f64x2(<f64>load<f32>(r + o), <f64>load<f32>(g + o)));
    v128.store(p, f64x2(<f64>load<f32>(b + o), 0.0), 16);
  }
  const K = f64x2.splat(0.955);
  const stride = (<usize>LW) << 5;
  // left -> right: straight = the texel written last iteration.
  for (let y = 0; y < LH; y++) {
    const rowP = L + (<usize>(y * LW) << 5);
    const upP = y > 0 ? rowP - stride : rowP, dnP = y < LH - 1 ? rowP + stride : rowP;
    const attRow = att + (<usize>(y * LW) << 2);
    let sLo = v128.load(rowP), sHi = v128.load(rowP, 16);
    for (let x = 1; x < LW; x++) {
      const o = (<usize>(x - 1)) << 5, p = rowP + ((<usize>x) << 5);
      const a = f64x2.splat(<f64>load<f32>(attRow + ((<usize>x) << 2)));
      const dLo = f64x2.mul(f64x2.pmax(v128.load(dnP + o), v128.load(upP + o)), K);
      const dHi = f64x2.mul(f64x2.pmax(v128.load(dnP + o, 16), v128.load(upP + o, 16)), K);
      const vLo = f64x2.mul(f64x2.pmax(dLo, sLo), a);
      const vHi = f64x2.mul(f64x2.pmax(dHi, sHi), a);
      const cLo = v128.load(p), cHi = v128.load(p, 16);
      sLo = v128.bitselect(f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(vLo)), cLo, f64x2.gt(vLo, cLo));
      sHi = v128.bitselect(f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(vHi)), cHi, f64x2.gt(vHi, cHi));
      v128.store(p, sLo);
      v128.store(p, sHi, 16);
    }
  }
  // right -> left
  for (let y = 0; y < LH; y++) {
    const rowP = L + (<usize>(y * LW) << 5);
    const upP = y > 0 ? rowP - stride : rowP, dnP = y < LH - 1 ? rowP + stride : rowP;
    const attRow = att + (<usize>(y * LW) << 2);
    const last = (<usize>(LW - 1)) << 5;
    let sLo = v128.load(rowP + last), sHi = v128.load(rowP + last, 16);
    for (let x = LW - 2; x >= 0; x--) {
      const o = (<usize>(x + 1)) << 5, p = rowP + ((<usize>x) << 5);
      const a = f64x2.splat(<f64>load<f32>(attRow + ((<usize>x) << 2)));
      const dLo = f64x2.mul(f64x2.pmax(v128.load(dnP + o), v128.load(upP + o)), K);
      const dHi = f64x2.mul(f64x2.pmax(v128.load(dnP + o, 16), v128.load(upP + o, 16)), K);
      const vLo = f64x2.mul(f64x2.pmax(dLo, sLo), a);
      const vHi = f64x2.mul(f64x2.pmax(dHi, sHi), a);
      const cLo = v128.load(p), cHi = v128.load(p, 16);
      sLo = v128.bitselect(f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(vLo)), cLo, f64x2.gt(vLo, cLo));
      sHi = v128.bitselect(f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(vHi)), cHi, f64x2.gt(vHi, cHi));
      v128.store(p, sLo);
      v128.store(p, sHi, 16);
    }
  }
  // top -> bottom: slide (left, centre, right) along the previous row.
  for (let y = 1; y < LH; y++) {
    const rowP = L + (<usize>(y * LW) << 5), prevP = rowP - stride;
    const attRow = att + (<usize>(y * LW) << 2);
    let cLoP = v128.load(prevP), cHiP = v128.load(prevP, 16);
    let lLo = cLoP, lHi = cHiP;
    for (let x = 0; x < LW; x++) {
      let rLo = cLoP, rHi = cHiP;
      if (x < LW - 1) { const q = prevP + ((<usize>(x + 1)) << 5); rLo = v128.load(q); rHi = v128.load(q, 16); }
      const p = rowP + ((<usize>x) << 5);
      const a = f64x2.splat(<f64>load<f32>(attRow + ((<usize>x) << 2)));
      const dLo = f64x2.mul(f64x2.pmax(rLo, lLo), K);
      const dHi = f64x2.mul(f64x2.pmax(rHi, lHi), K);
      const vLo = f64x2.mul(f64x2.pmax(dLo, cLoP), a);
      const vHi = f64x2.mul(f64x2.pmax(dHi, cHiP), a);
      const oLo = v128.load(p), oHi = v128.load(p, 16);
      v128.store(p, v128.bitselect(f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(vLo)), oLo, f64x2.gt(vLo, oLo)));
      v128.store(p, v128.bitselect(f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(vHi)), oHi, f64x2.gt(vHi, oHi)), 16);
      lLo = cLoP; lHi = cHiP; cLoP = rLo; cHiP = rHi;
    }
  }
  // bottom -> top
  for (let y = LH - 2; y >= 0; y--) {
    const rowP = L + (<usize>(y * LW) << 5), nxtP = rowP + stride;
    const attRow = att + (<usize>(y * LW) << 2);
    let cLoP = v128.load(nxtP), cHiP = v128.load(nxtP, 16);
    let lLo = cLoP, lHi = cHiP;
    for (let x = 0; x < LW; x++) {
      let rLo = cLoP, rHi = cHiP;
      if (x < LW - 1) { const q = nxtP + ((<usize>(x + 1)) << 5); rLo = v128.load(q); rHi = v128.load(q, 16); }
      const p = rowP + ((<usize>x) << 5);
      const a = f64x2.splat(<f64>load<f32>(attRow + ((<usize>x) << 2)));
      const dLo = f64x2.mul(f64x2.pmax(rLo, lLo), K);
      const dHi = f64x2.mul(f64x2.pmax(rHi, lHi), K);
      const vLo = f64x2.mul(f64x2.pmax(dLo, cLoP), a);
      const vHi = f64x2.mul(f64x2.pmax(dHi, cHiP), a);
      const oLo = v128.load(p), oHi = v128.load(p, 16);
      v128.store(p, v128.bitselect(f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(vLo)), oLo, f64x2.gt(vLo, oLo)));
      v128.store(p, v128.bitselect(f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(vHi)), oHi, f64x2.gt(vHi, oHi)), 16);
      lLo = cLoP; lHi = cHiP; cLoP = rLo; cHiP = rHi;
    }
  }
  for (let i = 0; i < n; i++) {
    const o = (<usize>i) << 2, p = L + ((<usize>i) << 5);
    const lo = v128.load(p), hi = v128.load(p, 16);
    store<f32>(r + o, <f32>f64x2.extract_lane(lo, 0));
    store<f32>(g + o, <f32>f64x2.extract_lane(lo, 1));
    store<f32>(b + o, <f32>f64x2.extract_lane(hi, 0));
  }
}

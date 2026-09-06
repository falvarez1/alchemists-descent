/** Numeric-only kernel kept small enough for the browser JIT to optimize
 * independently of the many gameplay light sources. Sweep order and Float32
 * writes preserve the original field exactly. */
export function propagateLight(
  LW: number, LH: number,
  lightR: Float32Array, lightG: Float32Array, lightB: Float32Array, lightAtt: Float32Array,
): void {
  // Four directional sweeps (each pulls from straight + diagonal predecessors)
  // left -> right
  for (let y = 0; y < LH; y++) {
    const row = y * LW;
    const up = y > 0 ? row - LW : row,
      dn = y < LH - 1 ? row + LW : row;
    for (let x = 1; x < LW; x++) {
      const i = row + x,
        a = lightAtt[i],
        j = i - 1;
      let v = maxIncoming(lightR[j], lightR[up + x - 1], lightR[dn + x - 1]) * a;
      if (v > lightR[i]) lightR[i] = v;
      v = maxIncoming(lightG[j], lightG[up + x - 1], lightG[dn + x - 1]) * a;
      if (v > lightG[i]) lightG[i] = v;
      v = maxIncoming(lightB[j], lightB[up + x - 1], lightB[dn + x - 1]) * a;
      if (v > lightB[i]) lightB[i] = v;
    }
  }
  // right -> left
  for (let y = 0; y < LH; y++) {
    const row = y * LW;
    const up = y > 0 ? row - LW : row,
      dn = y < LH - 1 ? row + LW : row;
    for (let x = LW - 2; x >= 0; x--) {
      const i = row + x,
        a = lightAtt[i],
        j = i + 1;
      let v = maxIncoming(lightR[j], lightR[up + x + 1], lightR[dn + x + 1]) * a;
      if (v > lightR[i]) lightR[i] = v;
      v = maxIncoming(lightG[j], lightG[up + x + 1], lightG[dn + x + 1]) * a;
      if (v > lightG[i]) lightG[i] = v;
      v = maxIncoming(lightB[j], lightB[up + x + 1], lightB[dn + x + 1]) * a;
      if (v > lightB[i]) lightB[i] = v;
    }
  }
  // top -> bottom
  for (let y = 1; y < LH; y++) {
    const row = y * LW,
      prev = row - LW;
    for (let x = 0; x < LW; x++) {
      const i = row + x,
        a = lightAtt[i];
      const xl = x > 0 ? x - 1 : x,
        xr = x < LW - 1 ? x + 1 : x;
      let v = maxIncoming(lightR[prev + x], lightR[prev + xl], lightR[prev + xr]) * a;
      if (v > lightR[i]) lightR[i] = v;
      v = maxIncoming(lightG[prev + x], lightG[prev + xl], lightG[prev + xr]) * a;
      if (v > lightG[i]) lightG[i] = v;
      v = maxIncoming(lightB[prev + x], lightB[prev + xl], lightB[prev + xr]) * a;
      if (v > lightB[i]) lightB[i] = v;
    }
  }
  // bottom -> top
  for (let y = LH - 2; y >= 0; y--) {
    const row = y * LW,
      nxt = row + LW;
    for (let x = 0; x < LW; x++) {
      const i = row + x,
        a = lightAtt[i];
      const xl = x > 0 ? x - 1 : x,
        xr = x < LW - 1 ? x + 1 : x;
      let v = maxIncoming(lightR[nxt + x], lightR[nxt + xl], lightR[nxt + xr]) * a;
      if (v > lightR[i]) lightR[i] = v;
      v = maxIncoming(lightG[nxt + x], lightG[nxt + xl], lightG[nxt + xr]) * a;
      if (v > lightG[i]) lightG[i] = v;
      v = maxIncoming(lightB[nxt + x], lightB[nxt + xl], lightB[nxt + xr]) * a;
      if (v > lightB[i]) lightB[i] = v;
    }
  }
}

/** Inputs are finite, nonnegative light values; no generic NaN/signed-zero maximum is needed. */
function maxIncoming(straight: number, a: number, b: number): number {
  const diagonal = (a > b ? a : b) * .955;
  return straight > diagonal ? straight : diagonal;
}

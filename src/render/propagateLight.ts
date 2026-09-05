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
      let v = Math.max(lightR[j], Math.max(lightR[up + x - 1], lightR[dn + x - 1]) * 0.955) * a;
      if (v > lightR[i]) lightR[i] = v;
      v = Math.max(lightG[j], Math.max(lightG[up + x - 1], lightG[dn + x - 1]) * 0.955) * a;
      if (v > lightG[i]) lightG[i] = v;
      v = Math.max(lightB[j], Math.max(lightB[up + x - 1], lightB[dn + x - 1]) * 0.955) * a;
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
      let v = Math.max(lightR[j], Math.max(lightR[up + x + 1], lightR[dn + x + 1]) * 0.955) * a;
      if (v > lightR[i]) lightR[i] = v;
      v = Math.max(lightG[j], Math.max(lightG[up + x + 1], lightG[dn + x + 1]) * 0.955) * a;
      if (v > lightG[i]) lightG[i] = v;
      v = Math.max(lightB[j], Math.max(lightB[up + x + 1], lightB[dn + x + 1]) * 0.955) * a;
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
      let v = Math.max(lightR[prev + x], Math.max(lightR[prev + xl], lightR[prev + xr]) * 0.955) * a;
      if (v > lightR[i]) lightR[i] = v;
      v = Math.max(lightG[prev + x], Math.max(lightG[prev + xl], lightG[prev + xr]) * 0.955) * a;
      if (v > lightG[i]) lightG[i] = v;
      v = Math.max(lightB[prev + x], Math.max(lightB[prev + xl], lightB[prev + xr]) * 0.955) * a;
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
      let v = Math.max(lightR[nxt + x], Math.max(lightR[nxt + xl], lightR[nxt + xr]) * 0.955) * a;
      if (v > lightR[i]) lightR[i] = v;
      v = Math.max(lightG[nxt + x], Math.max(lightG[nxt + xl], lightG[nxt + xr]) * 0.955) * a;
      if (v > lightG[i]) lightG[i] = v;
      v = Math.max(lightB[nxt + x], Math.max(lightB[nxt + xl], lightB[nxt + xr]) * 0.955) * a;
      if (v > lightB[i]) lightB[i] = v;
    }
  }
}

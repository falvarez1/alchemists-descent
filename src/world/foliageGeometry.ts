/** Shared leaf/stem geometry for drawing, heat contact, and falling crowns.
 * Coordinates remain in world cells; presentation resolution never changes
 * the physical outline. A root deterministically selects one of four growth
 * grammars so a habitat reads as succession, not cloned fan props. */
export function visitFronds(x: number, y: number, size: number, seed: number, bend: number, rotation: number,
  visit: (ax: number, ay: number, bx: number, by: number, value: number, leaf: boolean, frond: number, along: number) => void): void {
  const noise = (n: number): number => {
    const v = Math.sin((seed + 17) * 12.9898 + n * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const turn = (lx: number, ly: number): readonly [number, number] => {
    const c = Math.cos(rotation), s = Math.sin(rotation);
    return [x + lx * c - ly * s, y + lx * s + ly * c];
  };
  const stem = (frond: number, reach: number, height: number, curl: number,
    segments: number, leafStart: number, leafEvery: number, leafScale: number, paired: boolean): void => {
    let previous = turn(0, 0);
    for (let step = 1; step <= segments; step++) {
      const t = step / segments;
      const wind = bend * (t * t) * height;
      const lx = reach * (t * .28 + t * t * .72) + Math.sin(t * Math.PI) * curl + wind;
      const ly = -height * (Math.sin(t * Math.PI * .5) - t * t * t * .12);
      const point = turn(lx, ly);
      visit(previous[0], previous[1], point[0], point[1], .39 + noise(frond) * .28, false, frond, t);
      if (step >= leafStart && step < segments && (step - leafStart) % leafEvery === 0) {
        const taper = Math.sin(t * Math.PI) * leafScale;
        const tangentX = point[0] - previous[0], tangentY = point[1] - previous[1];
        const length = Math.hypot(tangentX, tangentY) || 1, nx = -tangentY / length, ny = tangentX / length;
        const sweep = (noise(frond * 31 + step) - .5) * taper * .5;
        const side = step % 2 ? -1 : 1;
        visit(point[0], point[1], point[0] + nx * taper * side + tangentX / length * sweep,
          point[1] + ny * taper * side + tangentY / length * sweep,
          .5 + noise(step + frond * 7) * .3, true, frond, t);
        if (paired) visit(point[0], point[1], point[0] - nx * taper * side + tangentX / length * sweep * .65,
          point[1] - ny * taper * side + tangentY / length * sweep * .65,
          .32 + noise(step * 3 + frond) * .2, true, frond, t);
      }
      previous = point;
    }
  };

  const species = Math.abs(seed) % 4;
  if (species === 0) {
    // Copper fern: an off-centre fountain, young curled fronds tucked under
    // older tall ones. Its ranks deliberately do not mirror each other.
    const count = 5 + Math.abs(seed) % 4;
    for (let i = 0; i < count; i++) {
      const rank = i - (count - 1) * .5;
      const asymmetry = (noise(i + 2) - .5) * size * .12;
      stem(i, rank * size * .16 + asymmetry, size * (.72 + noise(i + 9) * .3 - Math.abs(rank) * .055),
        (noise(i + 20) - .5) * size * .14, 17, 4 + i % 2, 2, 3.3 + size * .035, true);
    }
  } else if (species === 1) {
    // Pipe reeds: clustered verticals with sword leaves and heavy seed tassels.
    const count = 3 + Math.abs(seed) % 3;
    for (let i = 0; i < count; i++) {
      const rank = i - (count - 1) / 2;
      const height = size * (.8 + noise(i + 4) * .32);
      stem(i, rank * size * .08, height, (noise(i + 13) - .5) * size * .08,
        19, 5 + i % 3, 5, 4.2 + size * .05, false);
      const top = turn(rank * size * .08 + bend * height, -height * .88);
      for (let grain = 0; grain < 4; grain++) {
        const side = grain % 2 ? -1 : 1;
        visit(top[0], top[1], top[0] + side * (1.5 + grain * .5), top[1] + 1 + grain * .8,
          .56 + grain * .05, true, i, .96);
      }
    }
  } else if (species === 2) {
    // Broad dock: few muscular stems terminating in large, differently tilted
    // leaves. Low secondary leaves fill the base without radial symmetry.
    const count = 4 + Math.abs(seed) % 2;
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const tier = Math.floor(i / 2);
      stem(i, side * size * (.16 + tier * .08), size * (.55 + tier * .18 + noise(i) * .12),
        side * size * (.05 + noise(i + 12) * .08), 15, 7 + tier, 4,
        5.4 + size * .075, i === count - 1);
    }
  } else {
    // Floor bramble: lateral searching canes, knuckled rises and sparse leaves.
    // It colonises edges rather than forming another upright bouquet.
    const count = 5 + Math.abs(seed) % 3;
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1, tier = Math.floor(i / 2);
      stem(i, side * size * (.38 + tier * .15), size * (.22 + noise(i + 5) * .18),
        -side * size * (.05 + noise(i + 22) * .08), 16, 4 + i % 3, 3,
        2.8 + size * .045, false);
    }
  }
}

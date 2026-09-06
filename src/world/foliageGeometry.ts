/** Shared leaf/stem geometry for drawing, heat contact, and falling crowns.
 * Coordinates remain in world cells; presentation resolution never changes
 * the physical outline. */
export function visitFronds(x: number, y: number, size: number, seed: number, bend: number, rotation: number,
  visit: (ax: number, ay: number, bx: number, by: number, value: number, leaf: boolean, frond: number, along: number) => void): void {
  const fronds = 6 + seed % 3;
  for (let frond = 0; frond < fronds; frond++) {
    const rank = frond - (fronds - 1) / 2, reach = rank * size * .19;
    const height = size * (1 - Math.abs(rank) * .12);
    let oldX = x, oldY = y;
    for (let step = 1; step <= 18; step++) {
      const t = step / 18, angle = rotation + bend * t, c = Math.cos(angle), s = Math.sin(angle);
      const localX = reach * t, localY = -height * (Math.sin(t * Math.PI / 2) - t ** 3 * .26);
      const px = x + localX * c - localY * s, py = y + localX * s + localY * c;
      visit(oldX, oldY, px, py, .45 + frond % 3 * .12, false, frond, t);
      if (step > 3 && step < 17 && step % 2 === 0) {
        const leafReach = 4 * Math.sin(t * Math.PI);
        visit(px, py, px - leafReach * c + leafReach * .8 * s, py - leafReach * s - leafReach * .8 * c, .62 + frond % 2 * .15, true, frond, t);
        visit(px, py, px + leafReach * c + leafReach * .7 * s, py + leafReach * s - leafReach * .7 * c, .3 + frond % 2 * .1, true, frond, t);
      }
      oldX = px; oldY = py;
    }
  }
}

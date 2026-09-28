// The big one. The Bellows' gear hall: a spilled oil slick runs along the
// floor into a stack of explosive barrels and a powder magazine heaped against
// the far wall. The alchemist crosses the grate, lights the slick with a Flame
// Jet (no blast of his own: the first explosion is THE explosion), and backs
// off while the fire crawls to the barrels. They go, and the magazine goes
// with them: a white-hot fireball, a shockwave ring, debris and a crater
// burning under the great gear.
export default {
  id: 'big-boom',
  priority: 'P0',
  level: 'd1',
  seed: 777,
  description: 'The Bellows gear hall: a Flame Jet lights an oil slick; the fire crawls into six explosive barrels and a powder magazine against the wall, and the hall goes up (white-hot fireball filling half the frame, shockwave ring, burning crater).',
  durationS: 8,
  warmupTicks: 150,
  params: {
    player: { x: 1318, y: 730 },
    oil: { x0: 1416, x1: 1462, y0: 728, y1: 730 },
    magazine: { x0: 1496, x1: 1524, y0: 706, y1: 730 },
    barrels: [[1466, 726], [1475, 726], [1484, 726], [1470.5, 717], [1479.5, 717], [1475, 708]],
    walkIn: [0, 62],
    stopAt: 1394,
    flame: [70, 104],
    walkBack: [112, 132],
  },
  bestWindow: { startS: 4.3, endS: 7.2 },
  hero: 5.2,
  marks: [
    { tick: 70, label: 'flame jet lights the oil', kind: 'action' },
  ],
  async setup(ctx, T, P) {
    T.clearEnemies(1350, 700, 360);
    T.equip(['flame'], ['spark']);
    const m = P.magazine;
    await T.paint(m.x0, m.y0, m.x1, m.y1, 8, (x, y, t) => t === 0);
    const o = P.oil;
    await T.paint(o.x0, o.y0, o.x1, o.y1, 6, (x, y, t) => t === 0);
    for (const [x, y] of P.barrels) {
      ctx.rigidBodies.spawn({ kind: 'box', halfW: 3.5, halfH: 4.5 }, x, y,
        { material: 'wood', payload: 'explosive', color: 0xb04030, friction: 0.6, restitution: 0.1 });
    }
    T.tp(P.player.x, P.player.y);
    ctx.player.facing = 1;
    T.aim(P.player.x + 80, P.player.y - 12);
    // A slow whole-cell drift toward the magazine.
    T.path([
      { t: -150, x: 1400, y: 694, zoom: 1.8 },
      { t: 0, x: 1400, y: 694, zoom: 1.8 },
      { t: 480, x: 1420, y: 688, zoom: 1.8 },
    ], { ease: 'linear' });
    T.boomed = false;
  },
  tick(ctx, T, P, t) {
    const p = ctx.player;
    // Walk in across the grate, light the slick, back off and watch.
    ctx.input.keys.right = t >= P.walkIn[0] && t < P.walkIn[1] && p.x < P.stopAt;
    ctx.input.keys.left = t >= P.walkBack[0] && t < P.walkBack[1];
    if (t >= P.flame[0] - 6 && t < P.flame[1]) T.aim(P.oil.x0 + 10, P.oil.y1 - 1);
    if (t === P.flame[0]) T.fire(P.flame[1] - P.flame[0]);
    if (t >= P.walkBack[0]) T.aim(P.magazine.x0, P.magazine.y0 + 8);
    if (t > P.walkBack[1]) p.facing = 1;
    if (!T.boomed && T.events.some((e) => e.type === 'explosion' && e.f >= 0)) {
      T.boomed = true;
      T.mark('main detonation', 'impact');
    }
  },
};

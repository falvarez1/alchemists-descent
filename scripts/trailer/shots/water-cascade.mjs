// A cave waterfall in the Drowned Cisterns (D3, seed 2): the Sump is a
// metal-cased pool perched over the caves, its floor stopped with stone drain
// plugs (the game's own "dig the plugs and the water falls away" design).
// From the pool's rim the alchemist burns the Excavate Ray down through the
// water into the plugs: the pool pours through its floor as a waterfall into
// the flooded cave below.
export default {
  id: 'water-cascade',
  priority: 'P1',
  level: 'd3',
  seed: 2,
  description: 'Rule I: in the Drowned Cisterns the alchemist digs out the Sump\'s stone drain plugs; the perched pool pours through its floor as a waterfall into the flooded cave below.',
  durationS: 8,
  warmupTicks: 120,
  bestWindow: { startS: 1.6, endS: 7.5 },
  hero: 3.2,
  params: { fireAt: 96, sweep: [[586, 587], [556, 587]], sweepTicks: 60, floorY: 586, x0: 544, x1: 596 },
  setup(ctx, T, P) {
    T.clearEnemies(570, 600, 260);
    T.tp(607, 565);
    ctx.player.facing = -1;
    T.equip(['dig']);
    T.aim(580, 560);
    T.path([
      { t: -120, x: 580, y: 606, zoom: 2 },
      { t: 480, x: 574, y: 614, zoom: 2 },
    ], { ease: 'inOutSine' });
  },
  tick(ctx, T, P, t) {
    // Sweep the ray along the plug row, right to left.
    if (t >= P.fireAt - 16 && t <= P.fireAt + P.sweepTicks) {
      const u = Math.max(0, Math.min(1, (t - P.fireAt) / P.sweepTicks));
      const [a, b] = P.sweep;
      T.aim(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
    }
    if (t === P.fireAt) T.fire(P.sweepTicks);
    if (t === P.fireAt + P.sweepTicks + 20) T.aim(560, 640); // look down the fall
    // The pool breaks through its floor.
    if (t > P.fireAt && !T.P.broke) {
      const w = ctx.world;
      for (let x = P.x0; x <= P.x1 && !T.P.broke; x++) for (let y = P.floorY + 2; y < P.floorY + 10; y++) {
        if (w.types[T.idx(x, y)] === 2) { T.P.broke = true; T.mark('breach', 'impact'); break; }
      }
    }
  },
};

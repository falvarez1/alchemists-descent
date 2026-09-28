// Lava meets water in the Drowned Cisterns (D3): from a mossy ledge high in
// the Sump's cavern the alchemist pours a flask of real Lava (11) over the
// lip; it spills down the rock as a lava fall into the cistern pool below,
// every drop flashing the water to steam, and cools to a stone crust.
export default {
  id: 'lava-water',
  priority: 'P0',
  level: 'd3',
  seed: 777,
  description: 'Rule II: in the Drowned Cisterns the alchemist pours lava off a mossy ledge; it falls into the cistern pool below, flashing the water to steam and cooling to stone.',
  durationS: 8,
  warmupTicks: 90,
  bestWindow: { startS: 1.8, endS: 7 },
  hero: 3.2,
  params: { pourAt: 100, pourTicks: 210, x0: 1002, x1: 1060 },
  setup(ctx, T, _P) {
    T.clearEnemies(1024, 550, 300);
    T.tp(988, 529);
    ctx.player.facing = 1;
    ctx.flask.setSlot(0, 11, 999);
    ctx.flask.selectSlot(0);
    T.aim(1020, 540);
    T.path([
      { t: -90, x: 1010, y: 546, zoom: 2.667 },
      { t: 480, x: 1022, y: 542, zoom: 2.667 },
    ], { ease: 'inOutSine' });
  },
  tick(ctx, T, P, t) {
    // The stream sweeps out along the lip as the flask tips further.
    if (t >= P.pourAt - 20) {
      const u = Math.max(0, Math.min(1, (t - P.pourAt) / P.pourTicks));
      T.aim(1022 + 22 * u, 524 - 4 * u);
    }
    ctx.input.pourHeld = t >= P.pourAt && t < P.pourAt + P.pourTicks;
    if (t === P.pourAt) T.mark('pour', 'action');
    // First steam off the cistern: the beat the edit syncs to.
    if (t > P.pourAt && !T.P.steamed) {
      const w = ctx.world;
      for (let x = P.x0; x <= P.x1 && !T.P.steamed; x++) for (let y = 530; y < 574; y++) {
        if (w.types[T.idx(x, y)] === 9) { T.P.steamed = true; T.mark('steam', 'impact'); break; }
      }
    }
  },
};

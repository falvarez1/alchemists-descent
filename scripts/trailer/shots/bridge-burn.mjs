// The Intake barricade (D1): an oil-soaked timber wall under an iron lintel,
// its seams caulked with dry moss, the first thing every alchemist sets on
// fire. One Spark Bolt: the flame runs the seams, the oil pockets flare, the
// wall becomes a sheet of fire and, mostly burned, collapses out of the arch.
// (The Works' bridges are metal-decked; this is the level's real wooden
// structure that burns and falls.)
export default {
  id: 'bridge-burn',
  priority: 'P1',
  level: 'd1',
  seed: 777,
  description: 'Rule I: one Spark Bolt lights the Intake\'s oil-soaked timber barricade; fire runs its seams, the oil flares, the wall burns and collapses out of its iron arch.',
  durationS: 6.5,
  warmupTicks: 90,
  bestWindow: { startS: 1.2, endS: 5.5 },
  hero: 2.6,
  params: { fireAt: 96, aim: [405, 300], body: [399, 284, 412, 314] },
  setup(ctx, T, P) {
    T.clearEnemies(400, 300, 300);
    T.tp(364, 314);
    ctx.player.facing = 1;
    T.equip(['spark']);
    T.aim(P.aim[0], P.aim[1] + 6);
    T.path([
      { t: -90, x: 390, y: 294, zoom: 2.833 },
      { t: 390, x: 392, y: 294, zoom: 3.167 },
    ], { ease: 'inOutSine' });
  },
  tick(ctx, T, P, t) {
    if (t === P.fireAt - 20) T.aim(P.aim[0], P.aim[1]);
    if (t === P.fireAt) T.fire(2);
    if (t === P.fireAt + 24) T.aim(420, 270); // lower the guard, watch it burn
    const [x0, y0, x1, y1] = P.body;
    if (t > P.fireAt && !T.P.lit) {
      let fire = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ctx.world.types[T.idx(x, y)] === 5) fire++;
      if (fire >= 12) { T.P.lit = true; T.mark('ignite', 'impact'); }
    }
    if (!T.P.fell) {
      const plug = T.rt().mechanisms.find((m) => m.id === 8401);
      if (plug && plug.state === 1) { T.P.fell = true; T.mark('collapse', 'impact'); }
    }
  },
};

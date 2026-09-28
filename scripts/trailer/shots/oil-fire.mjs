// Oil fire in the Rot Gardens (D2): a slick of real Oil (6) lies along the
// floor of a fern-and-mushroom grotto, pooling deepest against the giant
// mushroom's stalk. The alchemist, on a wooden ledge above, fires one Spark
// Bolt down into the slick by the fern; the fern goes up and the flame races
// the length of the slick beneath him into the pool at the stalk, which
// catches.
//
// Staged: the slick is painted onto the grotto floor, and the oil's ignite
// rate is raised ~4x (a live-tuning param, this page only) so the front races
// in a short cut instead of creeping.
export default {
  id: 'oil-fire',
  priority: 'P0',
  level: 'd2',
  seed: 1,
  description: 'Rule I: in the Rot Gardens, one Spark Bolt from a ledge lights an oil slick by a fern; the fern goes up and the flame races the slick beneath the alchemist to the giant mushroom, whose stalk catches (oil ignite rate raised for the cut).',
  durationS: 8.5,
  warmupTicks: 60,
  bestWindow: { startS: 1.2, endS: 7.8 },
  hero: 4.6,
  params: { x0: 1104, x1: 1206, rows: 6, ignite: 0.32, fireAt: 190, target: [1118, 300] },
  async setup(ctx, T, P) {
    T.clearEnemies(1150, 280, 380);
    ctx.params.materials[6].igniteChance = P.ignite;
    await T.palette(6);
    const w = ctx.world;
    const soft = (t) => t === 0 || t === 37 || t === 39;
    for (let x = P.x0; x <= P.x1; x++) {
      let y = 262;
      while (y < 320 && soft(w.types[T.idx(x, y)])) y++;
      if (y >= 320) continue;
      let k = 0;
      for (let yy = y - 1; yy > y - 8 && k < P.rows; yy--) if (w.types[T.idx(x, yy)] === 0) { T.set(x, yy, 6); k++; }
    }
    w.activity?.touchRect?.(P.x0 - 4, 262, P.x1 + 4, 320);
    // The wooden ledge's west end: a shot down-left clears its planks.
    T.tp(1156, 253);
    ctx.player.facing = -1;
    T.equip(['spark']);
    T.aim(1120, 280);
    T.path([
      { t: -60, x: 1146, y: 268, zoom: 2 },
      { t: 510, x: 1162, y: 268, zoom: 2 },
    ], { ease: 'inOutSine' });
  },
  tick(ctx, T, P, t) {
    if (t === P.fireAt - 24) T.aim(P.target[0], P.target[1]);
    if (t === P.fireAt) T.fire(2);
    if (t === P.fireAt + 30) T.aim(1200, 290); // watch it run
    if (t > P.fireAt && !T.P.lit) {
      const w = ctx.world;
      for (let x = P.x0; x <= P.x1 && !T.P.lit; x++) for (let y = 285; y < 306; y++) {
        const i = T.idx(x, y);
        if (w.types[i] === 6 && w.life[i] > 0) { T.P.lit = true; T.mark('ignite', 'impact'); break; }
      }
    }
    // The front reaches the deep pool at the mushroom's stalk.
    if (T.P.lit && !T.P.stalk) {
      const w = ctx.world;
      for (let x = 1198; x <= 1212 && !T.P.stalk; x++) for (let y = 292; y < 306; y++) {
        const i = T.idx(x, y);
        if (w.types[i] === 6 && w.life[i] > 0) { T.P.stalk = true; T.mark('stalk', 'impact'); break; }
      }
    }
  },
};

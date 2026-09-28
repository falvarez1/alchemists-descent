// Timber! The Feeding Gallery's birch (D1) is real Trunk/Leaf cells; one bite
// of the Excavate Ray through its foot and the whole stand is felled: it
// creaks, holds on its hinge, leans, then comes down across the pit edge,
// shedding its crown, and settles as a real wooden log.
export default {
  id: 'tree-fell',
  priority: 'P0',
  level: 'd1',
  seed: 777,
  description: 'Rule I: the alchemist cuts the gallery birch with the Excavate Ray; it cracks, leans on its hinge and topples, shedding leaves, then settles as a real log.',
  durationS: 8,
  warmupTicks: 90,
  bestWindow: { startS: 1.3, endS: 5.6 },
  hero: 2.9,
  params: { fireAt: 120, aim: [939, 444] },
  setup(ctx, T, P) {
    T.clearEnemies(960, 420, 300);
    T.tp(982, 449);
    ctx.player.facing = -1;
    T.equip(['dig']);
    T.aim(P.aim[0], P.aim[1] - 30);
    T.path([
      { t: -90, x: 956, y: 404, zoom: 2 },
      { t: 480, x: 940, y: 402, zoom: 2 },
    ], { ease: 'inOutSine' });
  },
  tick(ctx, T, P, t) {
    if (t === P.fireAt - 16) T.aim(P.aim[0], P.aim[1]); // the wand drops to the foot
    if (t === P.fireAt) T.fire(4);
    if (t === P.fireAt + 40) T.aim(900, 420);
  },
};

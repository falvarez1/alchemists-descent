// Harness self-test: a busy scene (flyers, walkers, a spell, a blast) must
// replay with identical event timing. Record twice and diff the sidecars.
export default {
  id: '_test-determinism',
  level: 'd1',
  seed: 777,
  durationS: 4,
  warmupTicks: 30,
  setup(ctx, T) {
    T.clearEnemies(0, 0);
    T.tp(1130, 730);
    T.cam(1250, 700, 1, { snap: true });
    for (const [k, x, y] of [['bat', 1300, 680], ['bat', 1330, 670], ['bat', 1360, 690], ['slime', 1250, 725], ['slime', 1290, 725]]) {
      const e = T.spawn(k, x, y);
      if (e) e.alerted = true;
    }
    T.equip(['spark', 'spark', 'spark'], ['bomb']);
  },
  tick(ctx, T, P, t) {
    if (t >= 20 && t % 20 === 0 && t < 180) {
      const target = ctx.enemies.find((e) => !e.dead) ?? { x: 1300, y: 700 };
      T.aim(target.x, target.y - 4);
      T.fire(2);
    }
    if (t === 120) ctx.explosions.trigger(1330, 700, 16);
  },
};

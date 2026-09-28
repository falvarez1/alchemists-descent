// Rule II: brine carries the current. In the Cold Store a long brine vat has
// been run down to its last rows, and a pack of creatures is wading across it.
// The alchemist, on the rim, puts Chain Lightning into the vat a dozen cells
// short of the nearest (a bolt that lands ON a creature is the spell's kill,
// not the pool's). Salt water carries a current three times as far as fresh:
// the surge crawls the length of the vat, local and glowing, and they short
// one after another: SHORTED, x2, x3, x4, x5.
export default {
  id: 'electric-water',
  priority: 'P0',
  level: 'd2b',
  seed: 777,
  description: 'The Cold Store brine vat: Chain Lightning into the salt water; the current crawls the length of the vat and shorts five waders in a rolling chain (SHORTED x5 callouts).',
  durationS: 7.5,
  warmupTicks: 150,
  show: ['callouts'],
  params: {
    player: { x: 644, y: 179 },
    vat: { x0: 652, x1: 793, surface: 180, keepFrom: 190 },
    foes: [['slime', 688], ['slime', 701], ['golem', 715], ['slime', 729], ['slime', 743]],
    zapTick: 100,
    zapAt: { x: 674, y: 193 },
    // A second bolt to the far end once they are down: the whole vat relights.
    zap2Tick: 175,
    zap2At: { x: 788, y: 193 },
    cam: { x: 716, y: 160 },
  },
  bestWindow: { startS: 1.3, endS: 5.5 },
  hero: 2.5,
  marks: [{ tick: 100, label: 'lightning cast', kind: 'action' }, { tick: 175, label: 'second lightning cast', kind: 'action' }],
  async setup(ctx, T, P) {
    const v = P.vat;
    // The vat has been run down: its top rows are gone, the rest is still brine.
    await T.paint(v.x0, v.surface - 2, v.x1, v.keepFrom - 1, 0, (x, y, t) => t === 42);
    T.clearEnemies(720, 180, 320);
    T.equip(['lightning'], ['spark']);
    T.tp(P.player.x, P.player.y);
    ctx.player.facing = 1;
    T.pinned = [];
    for (const [kind, x] of P.foes) {
      const e = T.spawn(kind, x, v.keepFrom - 12);
      if (!e) { T.note(`no room for ${kind} at ${x}`); continue; }
      e.hp = kind === 'golem' ? 3 : 2;
      e.attackCd = 9999;
      e.alerted = false;
      e.pinX = x;
      T.pinned.push(e);
    }
    T.aim(P.zapAt.x + 20, P.zapAt.y - 20);
    T.path([
      { t: -150, x: P.cam.x - 10, y: P.cam.y, zoom: 2 },
      { t: 450, x: P.cam.x + 10, y: P.cam.y, zoom: 2 },
    ], { ease: 'linear' });
  },
  tick(ctx, T, P, t) {
    for (const e of T.pinned) {
      if (!ctx.enemies.includes(e)) continue;
      e.x = e.pinX;
      e.vx = 0;
      e.breath = 9999;
      if (e.kind === 'slime') { e.timer = 1; e.windup = 0; }
    }
    if (t === P.zapTick - 16) T.aim(P.zapAt.x, P.zapAt.y);
    if (t === P.zapTick) T.fire(2);
    if (t === P.zap2Tick - 12) T.aim(P.zap2At.x, P.zap2At.y);
    if (t === P.zap2Tick && !T.pinned.some((e) => ctx.enemies.includes(e))) T.fire(2);
  },
};

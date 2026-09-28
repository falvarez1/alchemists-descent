// THE RIME WARDEN (D2b, the Cold Store's Ice-House). The alchemist looks down
// from the tip of the icicle arch at the frost-hided automaton frozen to its
// post; he drops into the hall; rime cracks off its joints as its name rises.
// It draws a long breath and sprays a cone of frost across the hall (snow
// dusts the floor, he is iced where he stands). Wounded into its second phase
// it roars (the icicles overhead shake loose) and comes on, slamming.
//
// The boss prologue is spent during warmup (the arch tip is in prologue range,
// outside the lair). Frozen is cleared each tick except under the breath, so
// the ice shell is the breath's own beat.
export default {
  id: 'boss-rime-warden',
  priority: 'P1',
  level: 'd2b',
  seed: 7,
  description: 'The Rime Warden: from the icicle arch the alchemist drops into the Ice-House; its name rises in a rime shower, a cone of frost ices him where he stands, then it roars into its second phase and comes on, slamming.',
  show: ['callouts', 'letterbox'],
  durationS: 10,
  warmupTicks: 240,
  bestWindow: { startS: 1.1, endS: 9.2 },
  hero: 3.0,
  params: {
    // The arch's left tip (an overlook, just outside the lair), relative to home.
    tipDx: -30,
    tipDy: -52,
    stepAt: 90,
    stepTicks: 8,
    breathAt: 132,
    roarAt: 330,
  },
  marks: [{ t: 90, label: 'alchemist drops in', kind: 'action' }],
  setup(ctx, T, P) {
    const home = T.rt().boss;
    P.hx = home.x;
    P.hy = home.y;
    P.revealed = false;
    T.clearEnemies(0, 0, 1e9, (e) => e.kind === 'rimewarden');
    T.tp(home.x + P.tipDx, home.y + P.tipDy);
    ctx.player.facing = -1;
    T.aim(home.x, home.y - 14);
    const X = home.x, Y = home.y;
    // Floor on the lower third, the icicle arch overhead; a slow push in.
    T.path([
      { t: 0, x: X - 20, y: Y - 28, zoom: 2.3 },
      { t: 600, x: X - 20, y: Y - 28, zoom: 2.6 },
    ], { ease: 'linear' });
  },
  tick(ctx, T, P, t) {
    const e = ctx.enemies.find((x) => x.kind === 'rimewarden');
    const p = ctx.player;
    if (t < P.breathAt + 40 || t > P.breathAt + 170) p.status.frozen = 0;
    if (t < P.stepAt) T.tp(P.hx + P.tipDx, P.hy + P.tipDy);
    ctx.input.keys.left = t >= P.stepAt && t < P.stepAt + P.stepTicks;
    if (!e || !e.boss) return;
    T.aim(e.x, e.y - 14);
    if (!P.revealed && e.boss.engaged) { P.revealed = true; T.mark('reveal', 'boss'); }
    if (t === P.roarAt) {
      // Wounded into phase two: the roar is the brain's own phase-turn event.
      const want = e.maxHp * 0.6;
      e.boss.playerDamage += Math.max(0, e.hp - want);
      e.hp = want;
    }
    if (t === P.breathAt) {
      // The frost breath (its 'vent'): an inhale, then the cone.
      const b = e.boss;
      b.lastMove = b.move;
      b.move = 'vent';
      b.moveT = 0;
      b.moveDur = 98;
      if (e.mind) e.mind.facing = Math.sign(p.x - e.x) || -1;
      ctx.events.emit('bossMove', { kind: e.kind, move: 'vent', phase: b.phase, x: e.x, y: e.y });
    }
  },
};

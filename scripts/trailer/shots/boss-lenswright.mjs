// THE LENSWRIGHT (D3b, the Glass Galleries' Lens Room). The great brass lens
// hangs over its gallery trailing crystal drops. It turns its eye on the
// alchemist on the crystal rise (its name rises); the iris opens, an aim line
// walks onto him, locks and a lance of focused light fires down it. Wounded
// into its third phase it rings, then fires through its own prism: three
// lances that bank off the silvered vault and cross the room.
//
// The boss prologue is spent during warmup. He waits with his wand lowered;
// at `noticeAt` he raises its light onto the lens and the beam catches its eye
// (creatures/lightResponse). Its sight cadence is held until then, so the
// light is what wakes it.
export default {
  id: 'boss-lenswright',
  priority: 'P1',
  level: 'd3b',
  seed: 7,
  description: 'The Lenswright: the alchemist raises his wand light onto the brass lens and it turns its eye on him (name card), locks an aim line and fires a lance of light; in its third phase it fires three prism lances that bank off the silvered vault.',
  show: ['callouts', 'letterbox'],
  durationS: 10.5,
  warmupTicks: 240,
  bestWindow: { startS: 1.2, endS: 9.8 },
  hero: 8.25,
  params: {
    // The crystal rise right of the Lens Room, relative to home.
    standDx: 88,
    standDy: 58,
    noticeAt: 92,
    phase3At: 300,
  },
  marks: [{ t: 92, label: 'wand light raised', kind: 'light' }],
  setup(ctx, T, P) {
    const home = T.rt().boss;
    P.hx = home.x;
    P.hy = home.y;
    P.revealed = false;
    T.clearEnemies(0, 0, 1e9, (e) => e.kind === 'lenswright');
    T.tp(home.x + P.standDx, home.y + P.standDy);
    ctx.player.facing = -1;
    T.aim(home.x, home.y);
    const X = home.x, Y = home.y;
    // The lens, its gallery and the alchemist on the rise; a slow push in.
    T.path([
      { t: 0, x: X + 8, y: Y + 10, zoom: 2 },
      { t: 630, x: X + 8, y: Y + 10, zoom: 2.3 },
    ], { ease: 'linear' });
  },
  tick(ctx, T, P, t) {
    const e = ctx.enemies.find((x) => x.kind === 'lenswright');
    if (!e) return;
    // Wand lowered in the dark until he raises its light onto the lens.
    const p = ctx.player;
    if (t < P.noticeAt) T.aim(p.x - 24, p.y + 14);
    else T.aim(e.x, e.y - 8);
    if (e.mind) {
      if (t < P.noticeAt) e.mind.nextSense = ctx.state.frameCount + 2;
      else if (t === P.noticeAt) e.mind.nextSense = 0;
    }
    if (!P.revealed && e.boss && e.boss.engaged) { P.revealed = true; T.mark('reveal', 'boss'); }
    if (t === P.phase3At && e.boss) {
      // Wounded into its third phase: it rings (its phase-turn roar), then fires through its prism.
      const want = e.maxHp * 0.3;
      e.boss.playerDamage += Math.max(0, e.hp - want);
      e.hp = want;
    }
  },
};

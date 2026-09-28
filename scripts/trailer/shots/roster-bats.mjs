// Residents: a bat roost. Seven bats hang folded from the Undertow's roof (D1,
// its darkness lifted so the wings read). The alchemist raises his lantern
// beam up the wall to the roost: the first bat it touches wakes and the whole
// brood bursts off the ceiling (a real roost scatter), wheeling around him.
export default {
  id: 'roster-bats',
  priority: 'P1',
  level: 'd1',
  seed: 777,
  description: 'D1 Undertow (lit): a roost of seven bats hangs folded from the ceiling; the alchemist lifts his lantern beam onto them and the brood bursts off the roof and swarms.',
  durationS: 7,
  warmupTicks: 60,
  params: {
    player: { x: 438, y: 1005 },
    roost: { x0: 504, n: 7, dx: 6 },
    cam: { x: 506, y: 936, zoom: 2 },
    raise: 105,
  },
  bestWindow: { startS: 1.2, endS: 6.2 },
  hero: 2.9,
  async setup(ctx, T, P) {
    const rt = T.rt();
    rt.darkZones = [];
    if (rt.story?.pipes) rt.story.pipes = rt.story.pipes.filter((p) => p.id !== 'undertow');
    T.clearEnemies(560, 950, 700);
    for (const cr of [...ctx.critters.list]) if (Math.abs(cr.x - 520) < 260 && Math.abs(cr.y - 950) < 140) ctx.critters.remove(cr);
    ctx.state.lanternHooded = false;
    T.tp(P.player.x, P.player.y);
    T.aimAngle(0.35, 120);
    const w = ctx.world;
    const ceil = (x) => { for (let y = 960; y > 840; y--) if (w.types[x + y * w.width] !== 0) return y; return 862; };
    for (let b = 0; b < P.roost.n; b++) {
      const x = P.roost.x0 + b * P.roost.dx;
      const cy = ceil(x);
      const bat = T.spawn('bat', x, cy + 8, { exact: true }) ?? T.spawn('bat', x, cy + 10, { exact: true });
      if (!bat) continue;
      bat.sleeping = true;
      bat.x = x;
      bat.y = cy + 4 + (b % 2);
      bat.trailerRoost = true;
    }
    T.place(P.cam.x, P.cam.y, P.cam.zoom);
  },
  tick(ctx, T, P, t) {
    T.place(P.cam.x, P.cam.y, P.cam.zoom);
    // The beam climbs from the floor ahead of him up the wall to the roost.
    const u = Math.max(0, Math.min(1, (t - P.raise) / 50));
    const e = u * u * (3 - 2 * u);
    const roostA = Math.atan2(866 - (ctx.player.y - 9), P.roost.x0 + 14 - ctx.player.x);
    T.aimAngle(0.35 + (roostA - 0.35) * e, 140);
    if (!T.burst && ctx.enemies.some((b) => b.trailerRoost && !b.sleeping)) { T.burst = true; T.mark('roost-burst', 'creature'); }
  },
};

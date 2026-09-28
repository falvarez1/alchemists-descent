// The Rot Gardens (D2): a slow whole-cell move leftward through the fungal garden
// that comes to rest on the alchemist:
// giant mushrooms, mossy masonry ledges, rootlopers with lantern eyes,
// drifting spores; the alchemist stands on a mossy rock, lantern lit.
export default {
  id: 'rot-gardens',
  priority: 'P0',
  level: 'd2',
  seed: 9,
  description: 'D2 The Rot Gardens: slow move through the fungal garden (giant mushrooms, mossy ledges, rootlopers, spores); the alchemist on a mossy rock, lantern lit.',
  durationS: 9,
  warmupTicks: 90,
  params: { x0: 690, y: 400, dist: -250, zoom: 1.3333333, hold: 60, ramp: 40, px: 481, py: 430 },
  bestWindow: { startS: 1, endS: 8 },
  hero: 6.5,
  setup(ctx, T, P) {
    T.craneAt = (t, dist, ramp) => {
      const cruise = Math.max(0, dist - ramp);
      const total = cruise + 2 * ramp;
      const u = Math.max(0, Math.min(total, t));
      let s;
      if (u <= ramp) s = (u * u) / (2 * ramp);
      else if (u <= ramp + cruise) s = ramp / 2 + (u - ramp);
      else { const d = total - u; s = dist - (d * d) / (2 * ramp); }
      return Math.round(s);
    };
    for (const k of Object.keys(ctx.player.perks)) ctx.player.perks[k] = false;
    T.tp(P.px, P.py);
    T.aim(P.px + 80, P.py - 30);
    T.place(P.x0, P.y, P.zoom);
  },
  tick(ctx, T, P, t) {
    const dx = Math.sign(P.dist) * T.craneAt(t - P.hold, Math.abs(P.dist), P.ramp);
    T.place(P.x0 + dx, P.y, P.zoom);
    // The lantern beam sweeps slowly up the garden as the camera moves.
    const u = Math.max(0, Math.min(1, t / 480));
    const a = -0.15 - 0.55 * (0.5 - 0.5 * Math.cos(Math.PI * u));
    T.aim(P.px + Math.cos(a) * 90, P.py - 9 + Math.sin(a) * 90);
    if (t === P.hold) T.mark('pan-start', 'camera');
    if (dx === P.dist && !T.landed) { T.landed = true; T.mark('reveal', 'camera'); }
  },
  variants: [
    {
      // The Bloom Crossing: a dark room over a glowing acid pit. The alchemist
      // unhoods his lantern, lays the beam on each lumen bloom's heart, and the
      // blooms unfurl real glass petals into a bridge he runs across.
      id: 'rot-gardens-bloom',
      priority: 'P1',
      description: 'D2 The Rot Gardens, the Bloom Crossing: in a dark room over an acid pit the alchemist unhoods his lantern; two lumen blooms drink the beam and unfurl glass petals into a bridge; he runs across.',
      durationS: 7,
      params: { cx: 350, cy: 738, zoom: 2.5, px: 274, py: 754, unhood: 110, aim2: 175, run: 250 },
      keys: [{ t: 110, press: 'KeyL' }],
      bestWindow: { startS: 2.1, endS: 6 },
      hero: 4.4,
      setup(ctx, T, P) {
        for (const k of Object.keys(ctx.player.perks)) ctx.player.perks[k] = false;
        ctx.state.lanternHooded = true;
        T.tp(P.px, P.py);
        const [b1] = T.rt().lumenBlooms;
        T.aim(b1.x, b1.y);
        T.place(P.cx, P.cy, P.zoom);
      },
      tick(ctx, T, P, t) {
        T.place(P.cx, P.cy, P.zoom);
        const [b1, b2] = T.rt().lumenBlooms;
        if (t < P.aim2) T.aim(b1.x, b1.y);
        else if (t < P.run + 40) T.aim(b2.x, b2.y);
        else T.aim(ctx.player.x + 80, ctx.player.y - 30);
        if (t === P.run) T.hold({ right: true }, 44);
        if (t === P.unhood) T.mark('lantern', 'light');
        // The petal bridge stands (both blooms well unfurled): the beat to cut on.
        if (!T.bridged && t > P.unhood && b1.shown > 40 && b2.shown > 40) { T.bridged = true; T.mark('bridge', 'beat'); }
        if (t === P.run) T.mark('cross', 'action');
      },
    },
  ],
};

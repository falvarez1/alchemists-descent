// The Bellows (D1) establishing shot: a whole-cell crane down the refinery,
// from the Bell & Tea Engine's hall, past the Feeding Gallery (the duck in
// its bath, a weaver on the girders), through the masonry floor into the
// Breathing Chamber just as the Works exhale: real steam, drawn from the
// reservoir, pours out of the three hanging nozzles.
//
// Vertical parallax separates the refinery planes as well as a lateral move
// does. The alchemist is hidden (sprite, lantern, contact shadow) and parked
// on a floor near the view centre, because the sim only runs around him.
export default {
  id: 'bellows-establish',
  priority: 'P0',
  level: 'd1',
  seed: 777,
  description: 'D1 The Bellows: crane down from the Tea Engine hall past the Feeding Gallery (duck, weaver) into the Breathing Chamber as the Works exhale steam from three nozzles.',
  durationS: 10.5,
  warmupTicks: 90,
  // camera top-left x; crane from y0 to y1 (top-left), hold ticks, velocity ramp ticks;
  // exhale: the tick the Works start to exhale (pressurePhase 4080 of 5400).
  params: { camX: 900, y0: 0, y1: 440, hold: 60, ramp: 36, exhaleAt: 300, warmup: 90 },
  bestWindow: { startS: 3.8, endS: 10.4 },
  hero: 9.4,
  setup(ctx, T, P) {
    // Integer camera offset along a 1 cell/tick move with eased ends.
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
    T.hidePlayer();
    const comp = T.game.composer;
    const shadow = comp.drawContactShadow.bind(comp);
    comp.drawContactShadow = (c, x, y, ...rest) => {
      if (x === c.player.x && y === c.player.y) return;
      shadow(c, x, y, ...rest);
    };
    // The Works breathe on a 5400-tick cycle; start the exhale on cue.
    T.rt().living.ticks = 4080 - P.warmup - P.exhaleAt;
    T.tp(1200, 258);
    T.place(P.camX + 320, P.y0 + 180, 1);
  },
  tick(ctx, T, P, t) {
    const dy = T.craneAt(t - P.hold, P.y1 - P.y0, P.ramp);
    const cy = P.y0 + dy + 180;
    T.place(P.camX + 320, cy, 1);
    // Keep the (hidden) alchemist on the floor nearest the view centre.
    const spot = cy < 330 ? [1200, 258] : cy < 520 ? [1200, 449] : [1290, 650];
    if (Math.abs(ctx.player.x - spot[0]) > 2 || Math.abs(ctx.player.y - spot[1]) > 6) T.tp(spot[0], spot[1]);
    // Manual marks (short, stable labels the edit syncs to).
    if (t === P.hold) T.mark('crane-start', 'camera');
    if (dy === 150 && !T.gallery) { T.gallery = true; T.mark('gallery', 'beat'); }
    if (t === P.exhaleAt) T.mark('exhale', 'beat');
    if (dy === P.y1 - P.y0 && !T.landed) { T.landed = true; T.mark('reveal', 'camera'); }
  },
};

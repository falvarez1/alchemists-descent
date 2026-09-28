// Parallax depth (D1, the Rillback Sluice): a whole-cell lateral move at
// 1 cell/tick. The black foreground gear (a 1.4x occluder plane) sweeps past
// the lens while the play layer moves at 1x and the refinery planes behind
// it crawl at 0.08-0.32x: five depths at once. No alchemist in frame.
export default {
  id: 'parallax-depth',
  priority: 'P1',
  level: 'd1',
  seed: 777,
  description: 'D1 Rillback Sluice: lateral 1 cell/tick move; a black foreground gear sweeps past the lens over the play layer and four slower refinery backdrop planes.',
  durationS: 9.5,
  warmupTicks: 90,
  params: { x0: 40, dist: 400, camY: 170, hold: 60, ramp: 36, standY: 258 },
  bestWindow: { startS: 1.6, endS: 8.2 },
  hero: 4.5,
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
    T.hidePlayer();
    const comp = T.game.composer;
    const shadow = comp.drawContactShadow.bind(comp);
    comp.drawContactShadow = (c, x, y, ...rest) => {
      if (x === c.player.x && y === c.player.y) return;
      shadow(c, x, y, ...rest);
    };
    T.standAt = (x) => (x < 500 ? 314 : P.standY);
    T.tp(P.x0 + 320, T.standAt(P.x0 + 320));
    T.place(P.x0 + 320, P.camY + 180, 1);
  },
  tick(ctx, T, P, t) {
    const dx = T.craneAt(t - P.hold, P.dist, P.ramp);
    const x = P.x0 + dx;
    T.place(x + 320, P.camY + 180, 1);
    const sy = T.standAt(x + 320);
    if (Math.abs(ctx.player.x - (x + 320)) > 2 || Math.abs(ctx.player.y - sy) > 6) T.tp(x + 320, sy);
    if (t === P.hold) T.mark('pan-start', 'camera');
    if (dx === P.dist && !T.landed) { T.landed = true; T.mark('reveal', 'camera'); }
  },
};

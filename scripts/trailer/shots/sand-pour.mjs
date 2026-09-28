// Every grain is real. The Intake's sand plug (D1): a stone overhang whose
// belly is packed with sand around a gold pile. One short bite of the
// Excavate Ray through its glinting lip and the sand comes down in a curtain,
// gold with it, and heaps on the floor at the alchemist's feet.
export default {
  id: 'sand-pour',
  priority: 'P1',
  level: 'd1',
  seed: 777,
  description: 'Rule I: one short Excavate Ray bite opens the Intake\'s sand plug; sand and gold pour down in a curtain and heap on the floor.',
  durationS: 6.5,
  warmupTicks: 120,
  bestWindow: { startS: 1.3, endS: 5.5 },
  hero: 2.3,
  params: { fireAt: 100, aim: [309, 262] },
  setup(ctx, T, P) {
    T.clearEnemies(300, 280, 300);
    T.tp(272, 314);
    ctx.player.facing = 1;
    T.equip(['dig']);
    T.aim(P.aim[0], P.aim[1] + 20);
    T.path([
      { t: -120, x: 302, y: 284, zoom: 2.333 },
      { t: 390, x: 302, y: 288, zoom: 2.5 },
    ], { ease: 'inOutSine' });
  },
  tick(ctx, T, P, t) {
    if (t === P.fireAt - 24) T.aim(P.aim[0], P.aim[1]); // raise the wand to the lip
    if (t === P.fireAt) T.fire(3);
    // The curtain: the first grain to leave the plug.
    if (t > P.fireAt && !T.P.poured) {
      const w = ctx.world;
      for (let x = 290; x < 326 && !T.P.poured; x++) for (let y = 263; y < 290; y++) {
        if (w.types[T.idx(x, y)] === 1) { T.P.poured = true; T.mark('pour', 'impact'); break; }
      }
    }
  },
};

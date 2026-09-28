// Please mind the duck. The Tea Engine's rubber duck (a real Rapier body, D1)
// floats in its riveted bath under the catwalk grate; the alchemist stands a
// step back and regards it, wand lowered toward it. A locked-off deadpan hold.
export default {
  id: 'duck',
  priority: 'P0',
  level: 'd1',
  seed: 777,
  description: 'The button: the Tea Engine\'s rubber duck floats in its bath under the catwalk grate, the alchemist regarding it, deadpan. A still hold.',
  durationS: 7,
  warmupTicks: 150,
  bestWindow: { startS: 0.5, endS: 6.5 },
  hero: 3.5,
  params: { bath: [982, 319, 1017, 327] },
  async setup(ctx, T, P) {
    T.clearEnemies(1000, 320, 400);
    // Water in the bath floats the duck (the engine is idle, so it trips
    // nothing).
    const [x0, y0, x1, y1] = P.bath;
    await T.paint(x0, y0, x1, y1, 2, (x, y, type) => type === 0);
    T.tp(1062, 311);
    ctx.player.facing = -1;
    // Wand lowered to the catwalk. The duck samples its light right at the
    // catwalk's metal row: a beam on it flickers the toy between shadow and
    // blown white as it bobs; out of the beam it holds a steady warm ochre.
    T.aim(1036, 345);
    T.place(1024, 306, 10 / 3);
  },
  tick(ctx, T) {
    // Locked off.
    T.place(1024, 306, 10 / 3);
  },
};

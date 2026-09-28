// The Bellows (D1) establishing shot: a whole-cell lateral drift across the
// Tea Engine hall so the refinery backdrop planes separate from the play
// layer. The alchemist is hidden and carried along under the camera (the
// sim only runs around him).
export default {
  id: 'bellows-establish',
  priority: 'P0',
  level: 'd1',
  seed: 777,
  description: 'D1 The Bellows: slow lateral drift across the Tea Engine hall; refinery backdrop planes separate from the machinery.',
  durationS: 9.5,
  warmupTicks: 90,
  params: { x0: 380, y: 0, cellsPerTick: 1 },
  setup(ctx, T, P) {
    T.hidePlayer();
    T.tp(P.x0 + 320, 258);
    T.place(P.x0 + 320, P.y + 180, 1);
  },
  tick(ctx, T, P, t) {
    const x = P.x0 + Math.max(0, t) * P.cellsPerTick;
    T.place(x + 320, P.y + 180, 1);
    T.tp(x + 320, 258);
  },
};

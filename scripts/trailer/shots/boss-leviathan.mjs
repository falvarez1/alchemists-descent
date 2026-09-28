// THE SUNKEN LEVIATHAN (D3, the Drowned Cisterns). Its sump under the teal
// arches: the angler lurks with its lure lit. The alchemist steps off the
// ledge above and drops onto the pool's lip; the pool churns and its name
// surfaces; the lure goes dark and it BREACHES at him, jaws open; again.
//
// The boss prologue (letterbox + Docent) is spent during warmup (the ledge is
// in prologue range, outside the lair).
export default {
  id: 'boss-leviathan',
  priority: 'P0',
  level: 'd3',
  seed: 1,
  description: 'The Sunken Leviathan: the alchemist drops to its sump; its name card surfaces, the lure goes dark and it breaches at him, jaws open (twice), in the teal Cisterns.',
  show: ['callouts', 'letterbox'],
  durationS: 9,
  warmupTicks: 240,
  bestWindow: { startS: 1.2, endS: 8.2 },
  hero: 1.75,
  params: {
    // The ledge above the right shore, relative to the lair home.
    ledgeDx: 50,
    ledgeDy: -65,
    stepAt: 70,
    stepTicks: 18,
  },
  marks: [{ t: 70, label: 'alchemist drops to the sump', kind: 'action' }],
  setup(ctx, T, P) {
    const home = T.rt().boss;
    P.hx = home.x;
    P.hy = home.y;
    P.breaches = 0;
    P.swooping = false;
    T.clearEnemies(0, 0, 1e9, (e) => e.kind === 'leviathan');
    T.tp(home.x + P.ledgeDx, home.y + P.ledgeDy);
    ctx.player.facing = -1;
    T.aim(home.x, home.y);
    const X = home.x, Y = home.y;
    // The pool on the lower third; a slow push in through the whole shot.
    T.path([
      { t: 0, x: X + 4, y: Y - 30, zoom: 2.6 },
      { t: 540, x: X + 4, y: Y - 30, zoom: 3 },
    ], { ease: 'linear' });
  },
  tick(ctx, T, P, t) {
    const e = ctx.enemies.find((x) => x.kind === 'leviathan');
    if (t < P.stepAt) T.tp(P.hx + P.ledgeDx, P.hy + P.ledgeDy);
    ctx.input.keys.left = t >= P.stepAt && t < P.stepAt + P.stepTicks;
    if (!e) return;
    T.aim(e.x, e.y - 6);
    const swoop = (e.swoop ?? 0) > 0;
    if (swoop && !P.swooping) {
      P.breaches++;
      T.mark(P.breaches === 1 ? 'reveal' : 'breach', 'boss');
    }
    P.swooping = swoop;
  },
};

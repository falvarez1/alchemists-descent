// The Kiln Heart (D4): a lava fall pours from a crack under a basalt
// overhang into the lava pit of a lava bridge; embers drift up through the
// heat plumes and chimney stacks; the alchemist stands on the scorched rim
// among the ember-lilies and dead trees, his lantern toward the glow.
//
// Staged: the level has no natural lava falls, so the crack is fed real Lava
// cells each tick, and the pit drains the same amount through its floor (out
// of sight), so the fall lands in a steady pool instead of heaping into a
// cone. The camera pushes in slowly (zoom only; slow whole-cell drifts step).
export default {
  id: 'kiln-heart',
  priority: 'P0',
  level: 'd4',
  seed: 777,
  description: 'D4 The Kiln Heart: a lava fall pours from a basalt crack into a lava pool, embers rising through the heat plumes and chimney stacks; the alchemist on the scorched rim among ember-lilies and dead trees.',
  durationS: 9,
  warmupTicks: 120,
  // crack columns; the pit (x0..x1, surface..floor) and its full cell count;
  // camera centre + zoom; where he stands; when the feed starts (warmup tick).
  params: { sx0: 1464, sx1: 1468, pit: { x0: 1452, x1: 1487, y0: 360, y1: 373, full: 504 }, cx: 1436, cy: 318, zoom: 1.9, zoom1: 2.15, px: 1408, py: 352, pour: -110, flow: 0.9 },
  bestWindow: { startS: 1, endS: 8 },
  hero: 4,
  marks: [{ t: 1, label: 'reveal', kind: 'camera' }],
  async setup(ctx, T, P) {
    await T.palette(11);
    // Hotter, runnier lava (live tuning, this page only) so the fall spreads
    // into the pool instead of heaping into a cone where it lands.
    ctx.params.materials[11].flowRate = P.flow;
    for (const k of Object.keys(ctx.player.perks)) ctx.player.perks[k] = false;
    T.clearEnemies(P.cx, P.cy, 420);
    // The crack: the first open row under the overhang above the pit.
    let y = 250;
    while (y < 300 && T.type(P.sx0 + 2, y) === 0) y++;
    while (y < 320 && T.type(P.sx0 + 2, y) !== 0) y++;
    T.crackY = y;
    T.tp(P.px, P.py);
    T.aim(P.sx0 - 6, P.py - 22);
    T.place(P.cx, P.cy, P.zoom);
  },
  tick(ctx, T, P, t) {
    const { pit } = P;
    if (t >= P.pour) {
      // Feed the fall: an irregular, flickering stream (no checkerboard).
      for (let x = P.sx0; x <= P.sx1; x++) {
        const h = (Math.imul((x * 73856093) ^ (t * 19349663), 2654435761) >>> 0) % 7;
        if (h < 4 && T.type(x, T.crackY) === 0) T.set(x, T.crackY, 11);
      }
      // Drain the pool through its floor to hold the surface at the rim.
      let n = 0;
      for (let y = pit.y0 - 20; y <= pit.y1; y++) for (let x = pit.x0; x <= pit.x1; x++) if (T.type(x, y) === 11) n++;
      let excess = Math.min(6, n - pit.full);
      for (let k = 0; excess > 0 && k < 40; k++) {
        const x = pit.x0 + ((Math.imul(t * 31 + k * 17, 2654435761) >>> 0) % (pit.x1 - pit.x0 + 1));
        if (T.type(x, pit.y1) === 11) { T.set(x, pit.y1, 0); excess--; }
      }
      ctx.world.activity?.touchRect?.(pit.x0 - 2, T.crackY - 2, pit.x1 + 3, pit.y1 + 2);
    }
    // A slow push in (zoom only, about a whole-cell centre: no plane judder).
    const u = Math.max(0, Math.min(1, (t + 30) / 570));
    T.place(P.cx, P.cy, P.zoom + (P.zoom1 - P.zoom) * (0.5 - 0.5 * Math.cos(Math.PI * u)));
    T.aim(P.sx0 - 6, P.py - 22);
  },
};

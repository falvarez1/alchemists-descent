// THE KILN ESCAPE (D4). The Colossus is dying in its Kiln (cracks jetting
// fire and steam, the core overloading); the alchemist waits at the foot of
// the old flue beside it. The kiln comes apart in its death blast, the Heart
// heaves (the metal damper blows open, the Kiln ceiling drops in chunks), and
// real lava wells up through the Kiln and the damper passage and climbs the
// shaft. He hops the flue's ledges ahead of it; cracked masonry crumbles as
// the lava climbs past.
//
// Scripted climb: wait on a ledge until the lava is `gap` rows under the
// boots, then hop to the next ledge up (a real jump + steering, tick-exact).
// `lavaBoost` adds rows/tick to the escape's own rise (native: 0.085-0.11
// close under the boots, 0.3 far behind) so the chase reads in a short cut;
// 0 = the game's exact pacing.
export default {
  id: 'kiln-escape',
  priority: 'P0',
  level: 'd4',
  seed: 1,
  description: 'The Kiln escape: the dying Colossus blows apart, the Heart heaves (damper bursts, ceiling falls), and real lava rises through the Kiln and up the flue as the alchemist hops the ledges ahead of it (lava rise sped ~2x for the cut); loose masonry crumbles.',
  show: ['callouts', 'letterbox'],
  durationS: 15,
  warmupTicks: 240,
  bestWindow: { startS: 1.7, endS: 13.8 },
  hero: 2.3,
  params: {
    // The Colossus is struck down this many ticks before frame 0 (its death
    // sequence runs 196 ticks to the blast, 214 to the heave).
    killAt: -60,
    // Climb pacing: first hop shortly after the heave, then keep the lava close.
    firstHopAfterHeave: 36,
    freeHops: 2,
    gap: 26,
    lavaBoost: 0.12,
    zoomOpen: 2,
    zoomClimb: 2.2,
  },
  setup(ctx, T, P) {
    const rt = T.rt();
    const home = rt.boss;
    const f = rt.story.flue;
    P.hx = home.x;
    P.hy = home.y;
    P.fl = {
      start: f.start,
      exit: f.exit,
      shaft: f.shaft,
      slabs: f.slabs.map((s) => ({ at: s.at })),
      ledges: [...f.ledges].sort((a, b) => b.y0 - a.y0).map((l) => ({ x: (l.x0 + l.x1) / 2, y0: l.y0 })),
    };
    P.k = 0;
    P.state = 'wait';
    P.hopT = 0;
    P.rest = 0;
    P.heaveT = null;
    P.slabMarked = [];
    P.cam = null;
    P.open = null;
    T.clearEnemies(0, 0, 1e9, (e) => e.kind === 'colossus');
    T.tp(f.start.x, f.start.y);
    ctx.player.facing = -1;
    T.aim(home.x, home.y - 20);
  },
  tick(ctx, T, P, t) {
    const e = ctx.enemies.find((x) => x.kind === 'colossus');
    const p = ctx.player;
    const keys = ctx.input.keys;
    if (t === P.killAt && e) {
      ctx.enemyCtl.damage(e, e.maxHp * 2, 0, 0, 'direct');
      // Frame the dying furnace and the alchemist at the flue's foot on thirds.
      P.open = { x: Math.round((e.x + P.fl.start.x) / 2) - 28, y: P.fl.start.y - 30 };
    }
    const director = ctx.story.escape;
    const esc = ctx.story.debugSnapshot().escape;
    if (esc.phase === 'climb' && P.lavaBoost > 0 && director) {
      director.lavaRow = Math.max(P.fl.shaft.y0 + 8, director.lavaRow - P.lavaBoost);
    }
    if (P.heaveT === null && esc.phase === 'heave') {
      P.heaveT = t;
      T.mark('explosion', 'impact');
      T.mark('escape', 'action');
    }
    // Loose masonry crumbling as the lava passes below it.
    P.fl.slabs.forEach((s, k) => {
      if (!P.slabMarked[k] && esc.phase === 'climb' && esc.lavaRow <= s.at) { P.slabMarked[k] = true; T.mark('explosion', 'impact'); }
    });
    // Camera: hold the Kiln and the flue foot through the death and the heave,
    // then rise with him: the alchemist on the upper third, the lava below.
    const open = P.open ?? { x: Math.round((P.hx - 50 + P.fl.start.x) / 2), y: P.fl.start.y - 30 };
    const lava = esc.phase === 'climb' ? esc.lavaRow : P.fl.start.y + 1;
    const climbX = Math.round((P.fl.shaft.x0 + P.fl.shaft.x1) / 2 - 30);
    const climbY = Math.min(open.y, Math.round(p.y + 12));
    if (P.cam === null) P.cam = { x: open.x, y: open.y, z: P.zoomOpen };
    if (P.heaveT !== null && t >= P.heaveT + 50) {
      const k = Math.min(1, (t - P.heaveT - 50) / 100);
      const s = k * k * (3 - 2 * k);
      const tx = open.x + (climbX - open.x) * s;
      const tz = P.zoomOpen + (P.zoomClimb - P.zoomOpen) * s;
      P.cam.x = tx;
      P.cam.y += (climbY - P.cam.y) * 0.08;
      P.cam.z = tz;
    } else {
      P.cam.x = open.x;
      P.cam.y = open.y;
    }
    T.place(P.cam.x, P.cam.y, P.cam.z, { whole: P.heaveT === null });
    void lava;
    // The climb.
    if (P.heaveT === null || t < P.heaveT + P.firstHopAfterHeave || P.k >= P.fl.ledges.length - 2) {
      keys.left = keys.right = keys.jump = false;
      return;
    }
    const L = P.fl.ledges[P.k];
    if (P.state === 'wait') {
      keys.jump = keys.left = keys.right = false;
      P.rest++;
      const due = P.k < P.freeHops || esc.lavaRow - p.y < P.gap;
      if (P.rest > 6 && p.grounded && due) { P.state = 'hop'; P.hopT = 0; }
    } else {
      P.hopT++;
      keys.jump = P.hopT <= 14;
      keys.left = p.x > L.x + 1.5;
      keys.right = p.x < L.x - 1.5;
      if (P.hopT > 12 && p.grounded) {
        if (p.y <= L.y0 + 1) P.k++;
        P.state = 'wait';
        P.rest = 0;
        keys.left = keys.right = false;
      } else if (P.hopT > 90) { P.state = 'wait'; P.rest = 0; }
    }
    const cx = (P.fl.shaft.x0 + P.fl.shaft.x1) / 2;
    T.aim(p.x + (p.x < cx ? 40 : -40), p.y - 50);
  },
};

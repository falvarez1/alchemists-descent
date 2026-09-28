// Residents: the Rillback silt eels, in their own water: a flooded brick
// channel of the Drowned Cisterns (D3). The alchemist wades through the murk,
// his lantern the only pool of light; a silt eel S-curves in out of the dark,
// lunges at him again and again and crackles its living-conductor pulse.
export default {
  id: 'roster-rillback',
  priority: 'P1',
  level: 'd3',
  seed: 42,
  description: 'D3 Drowned Cisterns, a flooded brick channel: a silt eel S-curves out of the murk into the alchemist’s lantern light, lunging jaws-open and crackling its living-conductor pulse through the water.',
  durationS: 8,
  warmupTicks: 60,
  params: {
    player: { x: 300, y: 790 },
    cam: { x: 300, y: 752, zoom: 3 },
    backpedal: [45, 330],
    lure: 150,
    debug: false,
  },
  marks: [{ tick: 231, label: 'hero-lunge', kind: 'creature' }],
  bestWindow: { startS: 1.0, endS: 7.2 },
  hero: 3.9,
  setup(ctx, T, P) {
    ctx.state.lanternHooded = false; // his lantern is the only pool of light in the murk
    T.tp(P.player.x, P.player.y);
    T.clearEnemies(300, 760, 330, (e) => e.kind === 'rillback');
    for (const e of ctx.enemies) if (e.kind === 'rillback' && Math.hypot(e.x - 300, e.y - 760) < 330) e.trailerStage = true;
    T.stageCam = { x: P.cam.x, y: P.cam.y };
    T.place(P.cam.x, P.cam.y, P.cam.zoom);
  },
  tick(ctx, T, P, t) {
    const p = ctx.player;
    const eels = ctx.enemies.filter((e) => e.trailerStage);
    // Every eel in the channel has his scent: they converge on the light.
    for (const e of eels) if (e.mind && t >= -40 && t < P.lure) { e.alerted = true; e.mind.confidence = 1; e.mind.targetX = p.x; e.mind.targetY = p.y; e.mind.lastSeen = ctx.state.frameCount; }
    const near = eels.reduce((b, e) => (!b || Math.hypot(e.x - p.x, e.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? e : b), null);
    // He wades along the channel, lantern held on the eel.
    if (t >= P.backpedal[0] && t < P.backpedal[1]) ctx.input.keys.left = true;
    else if (t === P.backpedal[1]) ctx.input.keys.left = false;
    // Frame the pair, easing with them.
    const gx = near ? 0.5 * near.x + 0.5 * p.x : p.x;
    T.stageCam.x += (gx - T.stageCam.x) * 0.05;
    T.place(T.stageCam.x, T.stageCam.y, P.cam.zoom);
    if (near) T.aim(near.x, near.y - 4);
    T.st = T.st || {};
    eels.forEach((eel, k) => {
      const s = (T.st[k] = T.st[k] || {});
      if ((eel.windup ?? 0) > 0 && !s.wind) T.mark('lunge', 'creature');
      s.wind = (eel.windup ?? 0) > 0;
      if ((eel.rillChargeCd ?? 0) > (s.cd ?? 0) + 5) T.mark('charge-pulse', 'impact');
      s.cd = eel.rillChargeCd ?? 0;
    });
    if (P.debug && t % 30 === 0) T.dbg = (T.dbg || '') + JSON.stringify([t, eels.map((e) => [Math.round(e.x), Math.round(e.y), e.mind?.intent, e.windup ?? 0, e.rillChargeCd ?? 0]), Math.round(p.x), Math.round(p.y)]) + ' ';
    if (P.debug && t === 470) T.note(T.dbg);
  },
};

// Residents: the Root Loper, D1's Silt Garden lurker. A stump that walks when
// you are not looking: while the alchemist gazes out over the garden pool,
// it stalks him along the bank; the moment his lantern beam lands on it, it
// freezes still as wood and shuts its eye. Grandmother's footsteps, twice,
// each time closer; then he hoods the lantern, and in the dark it comes on.
export default {
  id: 'roster-rootloper',
  priority: 'P1',
  level: 'd1',
  seed: 777,
  description: 'D1 Silt Garden: a Root Loper stalks the alchemist along the bank while he looks out over the pool and freezes, eye shut, each time his lantern beam finds it; he hoods the lantern and it comes for him.',
  durationS: 9,
  warmupTicks: 60,
  params: {
    player: { x: 402, y: 824 },
    loper: { x: 264, y: 824 },
    cam: { x: 326, y: 772, zoom: 2 },
    away: 0.1,
    stalk: 10,
    // [tick, look at it?] beats: away, catch, away, catch.
    beats: [[0, false], [88, true], [190, false], [262, true]],
    debug: false,
  },
  marks: [{ tick: 88, label: 'look-back', kind: 'beat' }, { tick: 262, label: 'look-back-2', kind: 'beat' }],
  keys: [{ t: 360, press: 'KeyL' }],
  bestWindow: { startS: 0.6, endS: 8.2 },
  hero: 1.9,
  setup(ctx, T, P) {
    T.clearEnemies(420, 800, 460, (e) => e.kind === 'rillback');
    ctx.state.lanternHooded = false;
    T.tp(P.player.x, P.player.y);
    const rl = T.spawn('rootloper', P.loper.x, P.loper.y - 30);
    if (rl) rl.trailerStage = true;
    T.aimAngle(P.away, 120);
    T.place(P.cam.x, P.cam.y, P.cam.zoom);
  },
  tick(ctx, T, P, t) {
    T.place(P.cam.x, P.cam.y, P.cam.zoom);
    const rl = ctx.enemies.find((e) => e.trailerStage);
    const p = ctx.player;
    let look = false;
    for (const [at, v] of P.beats) if (t >= at) look = v;
    // It has his scent: a committed stalk whenever his back is turned.
    if (rl?.mind && (!look || ctx.state.lanternHooded) && t >= P.stalk) {
      const m = rl.mind;
      m.confidence = 1; m.irritation = 1; m.targetX = p.x; m.targetY = p.y; m.lastSeen = ctx.state.frameCount;
      rl.alerted = true;
    }
    // Turn over ~10 ticks between gazing over the pool (right) and the beam
    // on the lurker's crown (left), sweeping over his head.
    T.lookU = T.lookU ?? 0;
    T.lookU += ((look ? 1 : 0) - T.lookU) * 0.28;
    let at = rl ? Math.atan2(rl.y - 14 - (p.y - 9), rl.x - p.x) : Math.PI;
    if (at > 0) at -= Math.PI * 2;
    T.aimAngle(P.away + (at - P.away) * T.lookU, 150);
    const frozen = (rl?.lightSense?.frozen ?? 0) > 0;
    if (frozen && !T.wasFrozen) { T.mark(T.freezes ? 'freeze-2' : 'freeze', 'creature'); T.freezes = (T.freezes ?? 0) + 1; }
    if (!frozen && T.wasFrozen && ctx.state.lanternHooded) T.mark('lunge', 'creature');
    if (ctx.state.lanternHooded && (rl?.rootLashT ?? 0) > 0 && !T.lashed) { T.lashed = true; T.mark('lash', 'impact'); }
    T.wasFrozen = frozen;
    if (P.debug && t % 20 === 0 && rl) T.dbg = (T.dbg || '') + JSON.stringify([t, Math.round(rl.x), Math.round(rl.y), rl.lightSense?.frozen ?? 0, +(rl.lightSense?.wand ?? 0).toFixed(2), rl.mind?.intent, +(rl.expression?.lid ?? 0).toFixed(1), rl.rootLashT ?? 0, rl.windup ?? 0]) + ' ';
    if (P.debug && t === 530) T.note(T.dbg);
  },
};

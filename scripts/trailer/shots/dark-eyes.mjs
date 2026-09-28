// Cold open: D1's Undertow, a designed deep-dark trough. The alchemist stands
// with his lantern hooded; nothing reads but the residents' eyeshine (a
// Weaver's six lenses and glowing leg tips creeping along the ceiling, bats'
// red pairs, a Root Loper's amber eye, slime cores) blinking on their own
// clocks. Then he drops the hood (a real L press) and the beam sweeps up from
// his boots across the floor, the bats and the Weaver overhead: eyes flash
// back, bodies dither out of the black, the Root Loper freezes and shuts its eye.
export default {
  id: 'dark-eyes',
  priority: 'P0',
  level: 'd1',
  seed: 777,
  description: 'D1 Undertow, pitch dark: only creature eyeshine glows and blinks; the alchemist unhoods his lantern and the beam sweeps across the residents, eyes flashing back.',
  durationS: 9.5,
  warmupTicks: 90,
  params: {
    player: { x: 430, y: 1005 },
    cam: { x: 505, y: 944 },
    unhood: 270,
    debug: false,
  },
  keys: [{ t: 270, press: 'KeyL' }],
  marks: [
    { tick: 60, label: 'eyes-hold', kind: 'beat' },
    { tick: 300, label: 'reveal', kind: 'light' },
  ],
  bestWindow: { startS: 3.0, endS: 8.6 },
  hero: 6.0,
  async setup(ctx, T, P) {
    const rt = T.rt();
    // The Undertow's speaking-pipe is a lit brass prop that would glow in frame.
    if (rt.story?.pipes) rt.story.pipes = rt.story.pipes.filter((p) => p.id !== 'undertow');
    // A 3-cell recess in the ceiling at x 478-497 stalls a crawling Weaver.
    await T.paint(478, 858, 497, 862, 12, (x, y, t) => t === 0);
    // Only the cast: the Undertow's own Stone Maw and Weaver, and the floor
    // critters (warm specks in the black), leave the stage.
    T.clearEnemies(560, 950, 700);
    for (const cr of [...ctx.critters.list]) if (Math.abs(cr.x - 500) < 260 && Math.abs(cr.y - 950) < 140) ctx.critters.remove(cr);
    ctx.state.lanternHooded = true;
    T.tp(P.player.x, P.player.y);
    T.aimAngle(0.85, 120);
    const spawn = (kind, x, y) => T.spawn(kind, x, y, { exact: true }) ?? T.spawn(kind, x, y);
    // Ceiling: a Weaver hung upside-down (placed against the rock so its legs
    // grab the underside); its lenses and leg-tip sparks hang over the room.
    const wv = spawn('weaver', 508, 890);
    if (wv) { wv.y = 874; wv.trailerStage = true; }
    spawn('bat', 530, 934);
    spawn('bat', 578, 906);
    // The slimes stay unaware of him (no senses): when the beam comes on they
    // do what an unaware slime does, and hop after its lit spot.
    for (const e of [spawn('slime', 500, 1009), spawn('acidslime', 552, 1009)]) if (e) e.trailerBlind = true;
    spawn('rootloper', 590, 1009);
    T.place(P.cam.x, P.cam.y, 2);
  },
  tick(ctx, T, P, t) {
    T.place(P.cam.x, P.cam.y, 2);
    for (const e of ctx.enemies) if (e.trailerBlind && e.mind) { e.mind.nextSense = 1e12; e.mind.confidence = 0; e.mind.irritation = 0; }
    if (P.debug && t % 45 === 0) T.note(JSON.stringify(ctx.enemies.map((e) => [e.kind, Math.round(e.weaverLoco?.px ?? e.x), Math.round(e.weaverLoco?.py ?? e.y), e.mind?.intent, e.weaverLoco?.mode ?? '', e.sleeping ? 'S' : ''])));
    const smooth = (u) => { const v = Math.max(0, Math.min(1, u)); return v * v * (3 - 2 * v); };
    const p = ctx.player;
    const sx = p.x;
    const sy = p.y - 9;
    if (t < P.unhood + 15) { T.aimAngle(0.85, 120); return; }
    // The sweep: floor (slime, acid slime, Root Loper) -> the bats -> up to
    // the Weaver on the ceiling, wherever it has crept to.
    const wv = ctx.enemies.find((e) => e.trailerStage);
    const wx = wv?.weaverLoco?.px ?? 520;
    const wy = wv?.weaverLoco?.py ?? 870;
    const wA = Math.atan2(wy - sy, wx - sx);
    let a;
    if (t < 365) a = 0.85 + (0.06 - 0.85) * smooth((t - (P.unhood + 15)) / (365 - P.unhood - 15));
    else if (t < 420) a = 0.06 + (-0.36 - 0.06) * smooth((t - 365) / 55);
    else a = -0.36 + (wA + 0.36) * smooth((t - 420) / 55);
    T.aimAngle(a, 150);
    if (t === 470) T.mark('reveal-weaver', 'light');
  },
};

// The creature-rig showcase: a Weaver hunts the alchemist UPSIDE-DOWN along
// the roof of the Lower Bell (D1, the Undertow Weaver's own hunting ground,
// its designed darkness lifted so the rig reads). The surface crawler plants
// eight real feet on the rock and ripples its gait along the ceiling; the
// camera rides the roof with it, then drops with the ballistic pounce and
// pushes in on the needle strike.
export default {
  id: 'weaver-crawl',
  priority: 'P0',
  level: 'd1',
  seed: 777,
  description: 'D1 Lower Bell (lit): a Weaver crawls upside-down along the rock ceiling toward the alchemist on eight planted legs, then pounces down on him and strikes.',
  durationS: 8,
  warmupTicks: 60,
  params: {
    player: { x: 1455, y: 1005 },
    weaver: { x: 1250, y: 852, hangY: 838 },
    hunt: 40,
    roofY: 864,
    lead: 36,
    zoom: 3,
    closeZoom: 3,
    closeY: 985,
    debug: false,
  },
  bestWindow: { startS: 1.0, endS: 7.2 },
  hero: 1.8,
  setup(ctx, T, P) {
    const rt = T.rt();
    rt.darkZones = []; // the rig is the subject: light the room
    // The Bell's speaking-pipe is a drawn prop hanging across the crawl path.
    if (rt.story?.pipes) rt.story.pipes = rt.story.pipes.filter((p) => p.id !== 'bell');
    T.clearEnemies(1200, 950, 420);
    for (const cr of [...ctx.critters.list]) if (Math.abs(cr.x - 1200) < 320 && Math.abs(cr.y - 930) < 140) ctx.critters.remove(cr);
    ctx.state.lanternHooded = true; // no beam: a lit Weaver flinches from it
    T.tp(P.player.x, P.player.y);
    const wv = T.spawn('weaver', P.weaver.x, P.weaver.y, { exact: true }) ?? T.spawn('weaver', P.weaver.x, P.weaver.y + 6, { exact: true });
    if (wv) { wv.y = P.weaver.hangY; wv.trailerStage = true; }
    T.stageCam = { x: P.weaver.x + P.lead, y: P.roofY };
    T.place(T.stageCam.x, T.stageCam.y, P.zoom);
  },
  tick(ctx, T, P, t) {
    const wv = ctx.enemies.find((e) => e.trailerStage);
    const p = ctx.player;
    const wx = wv?.weaverLoco?.px ?? wv?.x ?? P.weaver.x;
    const wy = wv?.weaverLoco?.py ?? P.weaver.y;
    T.aim(wx, wy); // the alchemist faces the thing on the roof
    // THE HUNT: from t = hunt it has clocked him (a real, sighted quarry).
    if (wv && wv.mind && t >= P.hunt && t < P.hunt + 3) {
      wv.alerted = true;
      const m = wv.mind;
      m.confidence = 1; m.irritation = 1; m.targetX = p.x; m.targetY = p.y;
      m.lastSeen = ctx.state.frameCount; m.nextDecision = 0;
      if (t === P.hunt) T.mark('hunt', 'creature');
    }
    // Camera: ride the roof ahead of the spider; after the pounce, drop to the
    // struggle and push in (zoom 3 = an even 9 px per cell).
    const u = T.pounceT === undefined ? 0 : Math.max(0, Math.min(1, (t - T.pounceT) / 60));
    const e = u * u * (3 - 2 * u);
    const gx = (1 - e) * (wx + P.lead) + e * (0.5 * wx + 0.5 * p.x);
    const gy = (1 - e) * P.roofY + e * P.closeY;
    T.stageCam.x += (gx - T.stageCam.x) * 0.07;
    T.stageCam.y += (gy - T.stageCam.y) * 0.12;
    T.place(T.stageCam.x, T.stageCam.y, P.zoom + (P.closeZoom - P.zoom) * e);
    if (wv?.weaverLoco) {
      const mode = wv.weaverLoco.mode;
      if (T.lastMode === 'attached' && mode === 'airborne' && T.pounceT === undefined) { T.pounceT = t; T.mark('pounce', 'creature'); }
      if (T.pounceT !== undefined && T.lastMode === 'airborne' && mode === 'attached' && !T.landed) { T.landed = true; T.mark('land', 'impact'); }
      if ((wv.windup ?? 0) > 0 && !T.wound) { T.wound = true; T.mark('strike-windup', 'creature'); }
      if (T.wound && (wv.windup ?? 0) === 0 && !T.struck) { T.struck = true; T.mark('strike', 'impact'); }
      T.lastMode = mode;
    }
    if (P.debug && t % 20 === 0 && wv) T.dbg = (T.dbg || '') + JSON.stringify([t, Math.round(wx), Math.round(wy), wv.weaverLoco?.mode, wv.mind?.intent, wv.windup ?? 0]) + ' ';
    if (P.debug && t === 470) T.note(T.dbg);
  },
};

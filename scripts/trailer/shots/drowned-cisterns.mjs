// The Drowned Cisterns (D3): the alchemist swims the flooded gallery under
// the drowned arches, lantern glowing teal in the water, reeds and glowing
// algae along the bed, bats roosting above. His top speed is eased down (live
// tuning, this page only) so the swim reads, and the camera tracks him at
// exactly 1 cell/tick (whole cells: no backdrop judder). The route is cleared
// of hostiles, latching leeches and a drifting crate that would snag him.
export default {
  id: 'drowned-cisterns',
  priority: 'P0',
  level: 'd3',
  seed: 9,
  description: 'D3 The Drowned Cisterns: the alchemist swims the flooded gallery under drowned arches, lantern glowing teal in the water, reeds and glowing algae along the bed.',
  durationS: 8.5,
  warmupTicks: 60,
  params: { px: 440, py: 770, camX: 480, camY: 738, zoom: 1.5, speed: 1, start: 50, x0: 360, x1: 1060, y0: 480, y1: 900 },
  bestWindow: { startS: 0.8, endS: 6 },
  hero: 2,
  setup(ctx, T, P) {
    for (const k of Object.keys(ctx.player.perks)) ctx.player.perks[k] = false;
    ctx.params.player.maxRunCap = P.speed;
    const inRoute = (o) => o.x > P.x0 && o.x < P.x1 && o.y > P.y0 && o.y < P.y1;
    // Hostiles (a bat roost on the vault above dives on him): clear the whole stretch.
    T.clearEnemies(650, 700, 600, (e) => e.kind === 'leviathan');
    for (const c of [...ctx.critters.list]) if (inRoute(c) && (c.kind === 'leech' || c.kind === 'isopod')) ctx.critters.remove(c);
    for (const b of [...ctx.rigidBodies.bodies]) if (inRoute(b)) ctx.rigidBodies.remove(b);
    T.tp(P.px, P.py);
    T.aim(P.px + 60, P.py - 10);
    T.place(P.camX, P.camY, P.zoom);
  },
  tick(ctx, T, P, t) {
    const p = ctx.player;
    const s = Math.max(0, t - P.start);
    T.place(P.camX + s, P.camY, P.zoom);
    if (t === P.start) { T.hold({ right: true }, 9999); T.mark('swim', 'action'); }
    // Strokes: kick up off the bed, never when the head is near the surface.
    if (t >= P.start && !T.holds.some((h) => h.keys.jump)) {
      const x = Math.round(p.x), wet = (y) => { const c = T.type(x, y); return c === 2 || c === 18; };
      let top = Math.round(p.y) - 17; while (wet(top - 1)) top--;
      let bed = Math.round(p.y); while (wet(bed + 1)) bed++;
      const headDepth = Math.round(p.y) - 17 - top;
      if (p.y >= bed - 3 && headDepth > 6 && (t - (T.lastStroke ?? -99)) > 18) { T.hold({ jump: true }, 3); T.lastStroke = t; }
    }
    T.aim(p.x + 60, p.y - 14);
    // Keep the gallery clear of latchers for the whole take.
    if (t % 10 === 0) for (const c of [...ctx.critters.list]) if (c.kind === 'leech' && Math.abs(c.x - p.x) < 60) ctx.critters.remove(c);
  },
};

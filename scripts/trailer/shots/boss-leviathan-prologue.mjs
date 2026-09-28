// THE LEVIATHAN'S PROLOGUE (D3, the Drowned Cisterns). The alchemist walks
// the path toward the sump; as he comes within sight of the arena the
// letterbox draws in and the game's own camera glides over to take it in (the
// angler lurking in its pool, lure lit, under the teal arches), holds, and
// comes back to him. Pure game camera: the prologue's glide (BossPrologue),
// with its zoom held at `zoom` instead of the default wide 1.04.
export default {
  id: 'boss-leviathan-prologue',
  priority: 'P2',
  level: 'd3',
  seed: 1,
  description: 'Boss prologue: walking toward the Drowned Cisterns sump, the letterbox draws in and the camera glides over the Sunken Leviathan lurking with its lure lit, then returns to the alchemist.',
  show: ['callouts', 'letterbox'],
  durationS: 7.5,
  warmupTicks: 90,
  bestWindow: { startS: 1.3, endS: 6.3 },
  hero: 2.6,
  params: {
    // The path east of the sump, outside prologue range (150 cells).
    startDx: 231,
    startDy: -18,
    walkAt: 60,
    zoom: 1.6,
  },
  setup(ctx, T, P) {
    const home = T.rt().boss;
    P.hx = home.x;
    P.hy = home.y;
    P.began = null;
    T.clearEnemies(0, 0, 1e9, (e) => e.kind === 'leviathan');
    T.tp(home.x + P.startDx, home.y + P.startDy);
    ctx.player.facing = -1;
    T.aim(home.x, home.y - 10);
    T.follow(P.zoom);
    ctx.camera.snapTo(ctx.player.x - 40, ctx.player.y - 20);
    ctx.camera.zoom = P.zoom;
  },
  tick(ctx, T, P, t) {
    const pro = ctx.story.debugSnapshot().prologue;
    const cam = ctx.camera;
    if (P.began === null && pro.kind) { P.began = t; T.mark('reveal', 'boss'); }
    // Walk until the prologue takes the camera; then stand and watch.
    ctx.input.keys.left = t >= P.walkAt && P.began === null;
    // The prologue's glide, closer than its default wide framing.
    if (cam.actionFocus) cam.actionFocus.zoom = P.zoom;
    T.aim(P.hx, P.hy - 10);
  },
};

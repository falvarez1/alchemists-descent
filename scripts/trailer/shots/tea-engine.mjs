// The Bell & Tea Engine (D1), played: the alchemist pulls the crank (the real
// Use key); the fuse burns along the hall and fizzles at its broken coupling;
// he walks under it and sparks the priming pan (Spark Bolt), the cord burns,
// the pendulum swings, the boulder rolls the ramp; he walks on and kicks the
// Persuader, the dominoes fall, the spring latch fires. Every station is real
// Rapier bodies and real cells.
//
// The camera follows the engine's own station target (the machine's
// actionFocus), eased to whole cells at <= 1.5 cells/tick, at 5 px per cell.
// The Tea Engine stage plate (#tea-view) stays hidden: its captions are key
// prompts.
export default {
  id: 'tea-engine',
  priority: 'P1',
  level: 'd1',
  seed: 777,
  description: 'The Bell & Tea Engine, played: crank pulled, the fuse fizzles, a Spark Bolt at the pan, cord, pendulum, boulder ramp, a kick to the Persuader, dominoes, spring latch. Real bodies, real cells.',
  durationS: 13,
  warmupTicks: 90,
  bestWindow: { startS: 1, endS: 10 },
  hero: 7.4,
  params: { crankAt: 50, zoom: 5 / 3, camY: 214, maxPan: 1.5, keepIn: 140 },
  keys: [{ t: 50, press: 'KeyE' }],
  setup(ctx, T, P) {
    T.clearEnemies(1000, 200, 800);
    T.tp(428, 311);
    ctx.player.facing = 1;
    T.equip(['spark']);
    T.aim(470, 290);
    P.camX = 520;
    P.last = -1;
    P.since = 0;
    T.place(P.camX, P.camY, P.zoom);
  },
  tick(ctx, T, P, t) {
    const tea = T.rt().living?.tea;
    // Camera: ease toward the engine's current station, whole cells.
    const af = ctx.camera.actionFocus;
    let want = af && tea && tea.stage > 0 ? Math.max(430, Math.min(1000, af.x)) : 520;
    // ...but never so far that the alchemist leaves the frame.
    want = Math.max(ctx.player.x - P.keepIn, Math.min(ctx.player.x + P.keepIn, want));
    const d = want - P.camX;
    P.camX += Math.sign(d) * Math.min(Math.abs(d) * 0.04, P.maxPan);
    T.place(P.camX, P.camY, P.zoom);
    if (!tea) return;
    if (tea.stage !== P.last) {
      const names = ['idle', 'fuse', 'spark', 'cord', 'swing', 'ramp', 'kick', 'dominoes', 'spring', 'pour'];
      if (P.last >= 0 && names[tea.stage]) T.mark(names[tea.stage], 'beat');
      P.last = tea.stage;
      P.since = 0;
    }
    P.since++;
    // Walk (held movement keys) to where each fault is answered.
    const stand = tea.stage <= 2 ? 505 : tea.stage <= 6 ? 738 : 880;
    const p = ctx.player;
    const dx = stand - p.x;
    const go = tea.stage >= 1 && Math.abs(dx) > 3;
    ctx.input.keys.right = go && dx > 0;
    ctx.input.keys.left = go && dx < 0;
    const arrived = !go;
    // Fault 1: the coupling. A Spark Bolt at the priming pan.
    if (tea.stage === 2 && arrived && P.since > 24 && !P.sparked) {
      P.sparked = true;
      T.aim(523, 267);
      T.fire(2);
    }
    if (tea.stage === 3 && P.since === 20) T.aim(600, 200);
    // Fault 2: the tollgate. Kick the Persuader until the gate lifts.
    if (tea.stage === 6 && arrived && P.since > 24 && P.since % 30 === 0) {
      const bob = ctx.rigidBodies.bodies.find((b) => b.tag === 'tea-persuader');
      if (bob) {
        T.aim(bob.x, bob.y);
        p.aimAngle = Math.atan2(bob.y - (p.y - 9), bob.x - p.x);
        ctx.playerCtl.kick(ctx);
      }
    }
    if (tea.stage === 7 && P.since === 10) T.aim(840, 170);
  },
};

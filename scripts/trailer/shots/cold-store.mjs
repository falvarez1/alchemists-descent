// The Cold Store (D2b), the Ice Vault: a whole-cell move past blue ice under
// rime, icicles and frosted trees, snow sifting down, to the store-keeper's
// strongroom walled in real ice, its lamp glowing through. The alchemist
// waits at the vault; as the move lands he fires one spark into the coal
// brazier banked against the ice wall, and it catches: warm fire licking the
// cold wall (real coal, real ice, real melt).
export default {
  id: 'cold-store',
  priority: 'P1',
  level: 'd2b',
  seed: 777,
  description: 'D2b The Cold Store: a slow move past blue ice, icicles and frosted trees to the Ice Vault, its lamp glowing through a wall of real ice; the alchemist sparks the coal brazier at the wall\'s foot and it catches.',
  durationS: 9.5,
  warmupTicks: 60,
  // Vault (prefab cold-ice-vault @514,847 for seed 777): ice wall x 591..600,
  // y 893..918; floor y 919; brazier coal x 583..590, y 916..917.
  params: { x0: 300, y: 872, dist: 236, zoom: 1.3333333, hold: 50, ramp: 40, px: 556, py: 918, coal: { x: 587, y: 915 }, spark: 330 },
  bestWindow: { startS: 5, endS: 9.3 },
  hero: 6.6,
  setup(ctx, T, P) {
    T.craneAt = (t, dist, ramp) => {
      const cruise = Math.max(0, dist - ramp);
      const total = cruise + 2 * ramp;
      const u = Math.max(0, Math.min(total, t));
      let s;
      if (u <= ramp) s = (u * u) / (2 * ramp);
      else if (u <= ramp + cruise) s = ramp / 2 + (u - ramp);
      else { const d = total - u; s = dist - (d * d) / (2 * ramp); }
      return Math.round(s);
    };
    for (const k of Object.keys(ctx.player.perks)) ctx.player.perks[k] = false;
    T.clearEnemies(P.x0 + P.dist / 2, P.y, 500);
    T.equip(['spark']);
    T.tp(P.px, P.py);
    T.aim(P.coal.x, P.coal.y - 20);
    T.place(P.x0, P.y, P.zoom);
  },
  tick(ctx, T, P, t) {
    const dx = T.craneAt(t - P.hold, P.dist, P.ramp);
    T.place(P.x0 + dx, P.y, P.zoom);
    if (t === P.spark - 16) T.aim(P.coal.x, P.coal.y);
    if (t === P.spark) { T.fire(2); T.mark('brazier', 'action'); }
    if (t === P.spark + 20) T.aim(P.coal.x + 10, P.coal.y - 24);
    if (t === P.hold) T.mark('pan-start', 'camera');
    if (dx === P.dist && !T.landed) { T.landed = true; T.mark('reveal', 'camera'); }
    // The wall gives way (a sixth of its ice gone): the beat to cut on.
    if (!T.melted && t > P.spark) {
      let ice = 0;
      for (let y = 893; y <= 918; y++) for (let x = 591; x <= 600; x++) if (T.type(x, y) === 10) ice++;
      if (ice < 220) { T.melted = true; T.mark('melt', 'impact'); }
    }
  },
};

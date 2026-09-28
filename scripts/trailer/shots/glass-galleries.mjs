// The Glass Galleries (D3b), the Prism Gate: a dark lens-house. The alchemist
// unhoods his lantern and lays the beam through a leaded window into a
// crystal prism; the prism splits it into both blinder-tubed photocells at
// once, they latch, and the gate they hold grinds open. Light as a verb, real
// optics (render/Lighting + sim/beam), a slow push in (zoom only).
export default {
  id: 'glass-galleries',
  priority: 'P1',
  level: 'd3b',
  seed: 777,
  description: 'D3b The Glass Galleries, the Prism Gate: in a dark lens-house the alchemist unhoods his lantern and lays the beam through a window into a crystal prism; it splits into twin photocells, they latch, and the gate grinds open.',
  durationS: 9,
  warmupTicks: 60,
  // Prism Gate (prefab glass-prism-gate @996,909 for seed 777): floor y 975,
  // prism at (1099, 965), photocells at (1119, 957/973).
  params: { cx: 1086, cy: 953, z0: 2.8, z1: 3.05, px: 1051, py: 974, prism: { x: 1099, y: 965 }, unhood: 60, aim: 90 },
  keys: [{ t: 60, press: 'KeyL' }],
  bestWindow: { startS: 1.6, endS: 7 },
  hero: 3.9,
  setup(ctx, T, P) {
    for (const k of Object.keys(ctx.player.perks)) ctx.player.perks[k] = false;
    ctx.state.lanternHooded = true;
    T.clearEnemies(P.cx, P.cy, 400);
    T.tp(P.px, P.py);
    T.aim(P.px + 40, P.py - 40);
    T.place(P.cx, P.cy, P.z0);
    const rt = T.rt();
    T.lenses = rt.mechanisms.filter((m) => m.kind === 'sensor' && m.sensorType === 'light' && Math.abs(m.x - P.prism.x) < 60 && Math.abs(m.y - P.prism.y) < 40);
    const ids = new Set(T.lenses.map((m) => m.targetId));
    T.gate = rt.mechanisms.find((m) => ids.has(m.id)) ?? null;
  },
  tick(ctx, T, P, t) {
    const u = Math.max(0, Math.min(1, t / 540));
    T.place(P.cx, P.cy, P.z0 + (P.z1 - P.z0) * (0.5 - 0.5 * Math.cos(Math.PI * u)));
    if (t >= P.aim) T.aim(P.prism.x, P.prism.y);
    if (t === P.unhood) T.mark('lantern', 'light');
    if (!T.lit && T.lenses.length && T.lenses.every((m) => m.state > 0)) { T.lit = true; T.mark('prism', 'light'); }
    if (T.gate && !T.opened && T.gate.state === 1) { T.opened = true; T.mark('gate', 'impact'); }
  },
};

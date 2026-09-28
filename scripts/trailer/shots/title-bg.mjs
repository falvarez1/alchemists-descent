// Behind the title card: the Silt Garden of the Bellows (D1), quiet. No
// alchemist, no action: the refinery's tall layered planes, grate light
// breathing on its slow pulse, drifting motes, pale trees on the masonry, a
// still pool with a fish, a foreground gear. The camera pushes in slowly (zoom
// only, about a whole-cell centre: backdrop planes judder under sub-cell drift).
// The garden's rootlopers are cleared so nothing wanders into the plate.
export default {
  id: 'title-bg',
  priority: 'P0',
  level: 'd1',
  seed: 777,
  description: 'Title plate background: the Bellows\' Silt Garden, quiet, a slow push in; tall layered refinery planes, pulsing grate light, drifting motes, pale trees and a still pool with a fish. No player, no action.',
  durationS: 12,
  warmupTicks: 120,
  params: { cx: 420, cy: 736, z0: 1, z1: 1.08, px: 300, py: 820 },
  bestWindow: { startS: 0.5, endS: 11.5 },
  hero: 6,
  marks: [
    { t: 1, label: 'title-safe-in', kind: 'note' },
    { t: 11, label: 'title-safe-out', kind: 'note' },
  ],
  setup(ctx, T, P) {
    T.hidePlayer();
    const comp = T.game.composer;
    const shadow = comp.drawContactShadow.bind(comp);
    comp.drawContactShadow = (c, x, y, ...rest) => {
      if (x === c.player.x && y === c.player.y) return;
      shadow(c, x, y, ...rest);
    };
    T.clearEnemies(P.cx, P.cy, 420);
    T.tp(P.px, P.py);
    T.place(P.cx, P.cy, P.z0);
  },
  tick(ctx, T, P, t) {
    const u = Math.max(0, Math.min(1, t / 720));
    T.place(P.cx, P.cy, P.z0 + (P.z1 - P.z0) * (0.5 - 0.5 * Math.cos(Math.PI * u)));
  },
};

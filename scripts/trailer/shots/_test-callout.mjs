// Harness self-test: a world-anchored callout (WAAPI + its own rAF +
// performance.now lifetime) must animate on the virtual clock, and a slow-mo
// variant must stretch it. Not a trailer shot.
export default {
  id: '_test-callout',
  level: 'd1',
  seed: 777,
  show: ['callouts'],
  durationS: 3,
  warmupTicks: 30,
  setup(ctx, T) { T.cam(ctx.player.x, ctx.player.y - 20, 2, { snap: true }); },
  tick(ctx, T, P, t) {
    if (t === 30) ctx.events.emit('combatCallout', { x: ctx.player.x + 20, y: ctx.player.y - 30, text: 'BOWLED!', tone: 'finisher' });
    if (t === 60) ctx.explosions.trigger(ctx.player.x + 60, ctx.player.y - 10, 10);
  },
  variants: [{ id: '_test-callout-slowmo', slowmo: { scale: 0.4, fromTick: 20, toTick: 120 } }],
};

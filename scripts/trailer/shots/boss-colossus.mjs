// THE KILN COLOSSUS (D4, the final boss). Close on the furnace kneeling in its
// Kiln; the alchemist drops in through the old chimney; it rises and makes its
// entrance (name card, two stomps) and slams at him. He cuts open the Kiln's
// ceiling tank with the Excavate Ray: the water floods down onto the hot
// furnace, THERMAL SHOCK cracks it in steam and it kneels; it rises into its
// second phase with a roar and breathes a ring of real fire from its vents.
//
// The boss prologue (letterbox + Docent) plays out during warmup: the chimney
// mouth is in prologue range, so it is spent before frame 0. After the crack,
// water touching the furnace flashes to steam (the kiln's own rule, held on)
// so a second crack cannot cut the roar short.
export default {
  id: 'boss-colossus',
  priority: 'P0',
  level: 'd4',
  seed: 1,
  description: 'The Kiln Colossus: the alchemist drops into the Kiln, it rises with its name card, stomps and slams; he cuts open the ceiling tank, the flood cracks it in THERMAL SHOCK steam, it roars into phase two and vents a ring of fire.',
  show: ['callouts', 'letterbox'],
  durationS: 12.5,
  warmupTicks: 240,
  bestWindow: { startS: 0.7, endS: 11.3 },
  hero: 6.3,
  params: {
    // Chimney mouth (the highest the 9x17 body clears), relative to the lair home.
    dropDx: -46,
    dropDy: -77,
    release: 50,
    // The ceiling tank's stone floor, relative to home.
    tankDx: -34,
    tankDy: -61,
    hpBeforeFlood: 0.8,
    digAt: 232,
    digTicks: 30,
    steamFor: 9999,
  },
  marks: [
    { t: 50, label: 'alchemist drops in', kind: 'action' },
    { t: 232, label: 'tank cut open', kind: 'action' },
  ],
  setup(ctx, T, P) {
    const home = T.rt().boss;
    P.hx = home.x;
    P.hy = home.y;
    P.crackAt = null;
    T.clearEnemies(0, 0, 1e9, (e) => e.kind === 'colossus');
    T.equip(['dig'], ['spark']);
    T.tp(home.x + P.dropDx, home.y + P.dropDy);
    ctx.player.facing = 1;
    T.aim(home.x, home.y - 20);
    const X = home.x, Y = home.y;
    // Close on the kneeling furnace (zoom 3: 9 px a cell), the chimney mouth
    // just above the frame; ease back to take in the tank and the whole Kiln.
    T.path([
      { t: 0, x: X - 5, y: Y - 16, zoom: 3 },
      { t: 170, x: X - 5, y: Y - 16, zoom: 3 },
      { t: 240, x: X - 10, y: Y - 28, zoom: 2.5 },
    ]);
    return T.palette(9);
  },
  tick(ctx, T, P, t) {
    const e = ctx.enemies.find((x) => x.kind === 'colossus');
    if (t < P.release) T.tp(P.hx + P.dropDx, P.hy + P.dropDy);
    if (!e) return;
    const digging = t >= P.digAt - 8 && t < P.digAt + P.digTicks + 4;
    if (digging) T.aim(P.hx + P.tankDx, P.hy + P.tankDy);
    else T.aim(e.x, e.y - 20);
    if (t === P.digAt - 2) {
      // A worn furnace: the one crack the flood makes tips it into phase two.
      const want = e.maxHp * P.hpBeforeFlood;
      if (e.boss) e.boss.playerDamage += Math.max(0, e.hp - want);
      e.hp = want;
    }
    if (t === P.digAt) T.fire(P.digTicks);
    if (P.crackAt === null && e.boss && e.boss.move === 'quench') P.crackAt = t;
    if (P.crackAt !== null && t - P.crackAt < P.steamFor) {
      const w = ctx.world;
      const halfW = 18, h = 36;
      for (let y = Math.floor(e.y) - h; y <= Math.floor(e.y) + 2; y++) {
        for (let x = Math.floor(e.x) - halfW; x <= Math.floor(e.x) + halfW; x++) {
          if (T.type(x, y) !== 2) continue;
          T.set(x, y, 9);
          w.life[T.idx(x, y)] = 140;
        }
      }
    }
  },
};

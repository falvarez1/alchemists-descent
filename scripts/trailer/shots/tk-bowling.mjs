// Rule III: the dead are real bodies. On the Rot Gardens' mushroom-lit walkway
// the alchemist lifts a fallen spitter with telekinesis (E), floats it up
// under the overhang and hurls it (F) down the lane into a huddle: BOWLED. He walks up,
// snatches the body off the floor and throws it again, twice: BOWLED x2, x3,
// "a chain reaction". Real keys drive the verb; the tick hook only aims.
// Beat ticks: one table drives the page script (params) and the real keys.
const BEAT = { grab1: 104, hurl1: 166, grab2: 220, hurl2: 228, grab3: 276, hurl3: 284 };

export default {
  id: 'tk-bowling',
  priority: 'P0',
  level: 'd2',
  seed: 777,
  description: 'Telekinesis: lift a spitter corpse, hurl it down the mushroom walkway into a rootloper; walk up, re-grab, throw twice more (BOWLED x3 callouts).',
  durationS: 7.5,
  warmupTicks: 150,
  show: ['callouts'],
  params: {
    player: { x: 612, y: 631 },
    corpse: { kind: 'spitter', x: 650, y: 631 },
    targets: [['rootloper', 700], ['slime', 725], ['slime', 749]],
    ...BEAT,
    // Float it up under the overhang (the lane has ~28 cells of headroom) and
    // draw it back toward the wand before the throw.
    swing: [[BEAT.grab1, 0, 0], [BEAT.grab1 + 20, 648, 606], [BEAT.grab1 + 38, 632, 605], [BEAT.grab1 + 54, 638, 607]],
  },
  keys: [
    { t: BEAT.grab1, press: 'KeyE' },
    { t: BEAT.hurl1, press: 'KeyF' },
    { t: BEAT.grab2, press: 'KeyE' },
    { t: BEAT.hurl2, press: 'KeyF' },
    { t: BEAT.grab3, press: 'KeyE' },
    { t: BEAT.hurl3, press: 'KeyF' },
  ],
  bestWindow: { startS: 1.6, endS: 6.3 },
  hero: 2.9,
  marks: [
    { tick: BEAT.grab1, label: 'telekinesis lift', kind: 'action' },
    { tick: BEAT.hurl1, label: 'first throw', kind: 'action' },
  ],
  setup(ctx, T, P) {
    T.clearEnemies(680, 640, 260);
    T.equip(['spark'], ['bomb']);
    T.tp(P.player.x, P.player.y);
    ctx.player.facing = 1;
    const victim = T.spawn(P.corpse.kind, P.corpse.x, P.corpse.y);
    ctx.enemyCtl.kill(victim, 0.2, -0.4);
    T.victim = victim;
    T.targets = [];
    for (const [kind, x] of P.targets) {
      const e = T.spawn(kind, x, 631, { exact: true }) ?? T.spawn(kind, x, 625);
      if (!e) continue;
      e.hp = 22;
      e.attackCd = 9999;
      e.alerted = false;
      e.pinX = x;
      T.targets.push(e);
    }
    /** The corpse's centre of mass (rig points). */
    T.corpseAt = () => {
      const c = ctx.corpses.list.find((k) => k.e === T.victim && !k.gone);
      if (!c) return null;
      const e = c.e;
      const pts = e.rig ? [...e.rig.pts, ...e.rig.chains.flatMap((ch) => ch.pts), ...(e.rig.soft?.pts ?? [])] : [];
      if (!pts.length) return { x: e.x, y: e.y - 5 };
      let x = 0;
      let y = 0;
      for (const p of pts) { x += p.x; y += p.y; }
      return { x: x / pts.length, y: y / pts.length };
    };
    T.walking = false;
    T.aim(700, 624);
    T.path([
      { t: -150, x: 664, y: 602, zoom: 1.95 },
      { t: 0, x: 664, y: 602, zoom: 1.95 },
      { t: 450, x: 702, y: 602, zoom: 1.95 },
    ]);
  },
  tick(ctx, T, P, t) {
    for (const e of T.targets) {
      if (!ctx.enemies.includes(e)) continue;
      e.x = e.pinX;
      e.vx = 0;
      if (e.kind === 'slime') { e.timer = 1; e.windup = 0; }
    }
    // The kill's gore off the lane once it has settled (a clean bowling alley).
    if (t === -20) {
      const w = ctx.world;
      for (let y = 560; y < 640; y++) for (let x = 600; x < 770; x++) {
        const i = w.idx(x, y);
        if ([15, 18, 19, 24].includes(w.types[i])) w.clearCellAt(i);
      }
    }
    const body = T.corpseAt();
    const target = (k) => T.targets[k] && ctx.enemies.includes(T.targets[k]) ? T.targets[k] : T.targets.find((e) => ctx.enemies.includes(e));
    // Lift: cursor on the body; then a wind-up arc overhead.
    if (t >= P.grab1 - 4 && t <= P.grab1 && body) { T.aim(body.x, body.y); T.swingFrom = [body.x, body.y]; }
    for (let i = 1; i < P.swing.length; i++) {
      const [t0, x0, y0] = i === 1 ? [P.swing[0][0], ...(T.swingFrom ?? [650, 620])] : P.swing[i - 1];
      const [t1, x1, y1] = P.swing[i];
      if (t > t0 && t <= t1) {
        const u = (t - t0) / (t1 - t0);
        const e = u * u * (3 - 2 * u);
        T.aim(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
      }
    }
    const throwAt = (k, hurlT) => {
      const e = target(k);
      // Low, at the body's middle: a high aim sails a thrown body over a tall target.
      if (e && t >= hurlT - 6 && t <= hurlT) T.aim(e.x, e.y - (e.kind === 'rootloper' ? 4 : 3));
    };
    throwAt(0, P.hurl1);
    throwAt(1, P.hurl2);
    throwAt(2, P.hurl3);
    // Walk up to the body between throws, then pick it up again.
    for (const grab of [P.grab2, P.grab3]) {
      if (t === grab - 40) T.walking = true;
      if (t >= grab - 6 && t <= grab && body) T.aim(body.x, body.y);
    }
    if (T.walking && body && body.x - ctx.player.x < 42) T.walking = false;
    if (t === P.grab2 - 8 || t === P.grab3 - 8) T.walking = false;
    ctx.input.keys.right = T.walking;
  },
};

// Skilled play in the Bellows gear hall (its west end; big-boom owns the
// east wall). A war party of imps and bats sweeps in low over the grated pool;
// the alchemist holds the floor and drops them with leading triple-spark
// volleys, jumps a diving bat and takes it in the air, then flicks to his
// second wand and puts chain lightning through the last knot. The flyers' paths are
// scripted (smooth swoops, velocities kept so wings and interpolation read
// naturally) so every volley has a clear line under the high platforms; the
// kills, corpses, fire and blast are the game's own.
export default {
  id: 'wand-combat',
  priority: 'P0',
  level: 'd1',
  seed: 777,
  description: 'The Bellows gear hall: a war party of imps and bats sweeps in low over the grated pool; leading triple-spark volleys drop them one by one, a jump and a mid-air volley take a diving bat, then chain lightning snaps through the last knot.',
  durationS: 7.5,
  warmupTicks: 40,
  show: ['callouts'],
  params: {
    player: { x: 1150, y: 729 },
    hp: 1,
    // [kind, slot x, slot y, enter tick, bob phase]
    party: [
      ['imp', 1236, 704, 0, 0.0],
      ['imp', 1272, 698, 6, 1.7],
      ['bat', 1254, 712, 12, 3.1],
      ['imp', 1298, 706, 18, 4.4],
      ['imp', 1318, 702, 22, 2.2],
      ['bat', 1306, 714, 26, 5.3],
    ],
    // Volley tick -> party index it is aimed at.
    volleys: [[36, 0], [58, 1], [80, 3]],
    dive: { who: 2, from: 94, to: 124, x: 1184, y: 704 },
    jump: 102,
    airShot: 114,
    swap: 146,
    bomb: 160,
    knot: { who: [4, 5], x: 1312, y: 706, from: 120 },
    cam: { x0: 1238, x1: 1256, y: 700, zoom: 2 },
  },
  bestWindow: { startS: 0.5, endS: 5.2 },
  marks: [
    { tick: 102, label: 'jump', kind: 'action' },
    { tick: 160, label: 'lightning', kind: 'action' },
  ],
  setup(ctx, T, P) {
    T.clearEnemies(1300, 690, 520);
    T.equip(['spark', 'spark', 'spark'], ['lightning']);
    ctx.wands.upgradeFrame(ctx, 0, 'brass');
    const w0 = ctx.wands.wands[0];
    w0.cards.splice(0, w0.cards.length, 'triple', 'spark', 'spark', 'spark', 'speed');
    ctx.wands.invalidatePrograms();
    ctx.wands.active = 0;
    T.tp(P.player.x, P.player.y);
    ctx.player.facing = 1;
    T.party = [];
    for (const [kind, x, y] of P.party) {
      const e = T.spawn(kind, x + 260, y - 30, { exact: true }) ?? T.spawn(kind, x + 260, y - 30);
      if (!e) { T.note(`no room for ${kind}`); T.party.push(null); continue; }
      e.alerted = true;
      e.sleeping = false;
      e.hp = Math.min(e.hp, P.hp);
      T.party.push(e);
    }
    T.aim(P.player.x + 100, P.player.y - 14);
    T.path([
      { t: -40, x: P.cam.x0, y: P.cam.y, zoom: P.cam.zoom },
      { t: 450, x: P.cam.x1, y: P.cam.y - 4, zoom: P.cam.zoom },
    ], { ease: 'linear' });
  },
  tick(ctx, T, P, t) {
    const p = ctx.player;
    const alive = (e) => e && ctx.enemies.includes(e) && !e.dead;
    // Fly the party: enter from the right, then hold a bobbing slot.
    P.party.forEach(([kind, sx, sy, enter, phase], i) => {
      const e = T.party[i];
      if (!alive(e)) return;
      e.attackCd = Math.max(e.attackCd ?? 0, 200);
      let tx = sx + Math.sin(t * 0.045 + phase) * 10;
      let ty = sy + Math.sin(t * 0.07 + phase * 1.3) * 6;
      const d = P.dive;
      if (i === d.who && t >= d.from) {
        const u = Math.min(1, (t - d.from) / (d.to - d.from));
        const s = u * u * (3 - 2 * u);
        tx = sx + (d.x - sx) * s;
        ty = sy + (d.y - sy) * s - Math.sin(Math.PI * u) * 26;
      }
      const k = P.knot;
      if (k.who.includes(i) && t >= k.from) {
        const u = Math.min(1, (t - k.from) / 30);
        tx = tx + (k.x + (i === k.who[0] ? -7 : 7) - tx) * u;
        ty = ty + (k.y - ty) * u;
      }
      const inU = Math.max(0, Math.min(1, (t - enter) / 40));
      const ein = 1 - (1 - inU) * (1 - inU);
      const x = sx + 260 + (tx - sx - 260) * ein;
      const y = sy - 30 + (ty - sy + 30) * ein;
      e.vx = x - e.x;
      e.vy = y - e.y;
      e.x = x;
      e.y = y;
      e.facing = e.vx < -0.05 ? -1 : e.vx > 0.05 ? 1 : -1;
    });
    // Aim: lead the current target (bolts cross ~120 cells in ~6 ticks).
    const lead = (e, k = 5) => ({ x: e.x + (e.vx ?? 0) * k, y: e.y - 5 + (e.vy ?? 0) * k });
    for (const [at, who] of P.volleys) {
      const e = T.party[who];
      if (t >= at - 8 && t <= at + 2 && alive(e)) { const a = lead(e); T.aim(a.x, a.y); }
      if (t === at && alive(e)) T.fire(3);
    }
    // The dive: jump it, and volley at the top of the arc.
    if (t === P.jump) T.hold({ jump: true }, 12);
    const diver = T.party[P.dive.who];
    if (t >= P.airShot - 8 && t <= P.airShot + 2 && alive(diver)) { const a = lead(diver, 3); T.aim(a.x, a.y); }
    if (t === P.airShot && alive(diver)) T.fire(3);
    // Flick to the lightning wand and put a chain through the knot.
    if (t === P.swap) ctx.wands.active = 1;
    const knot = P.knot.who.map((i) => T.party[i]).filter(alive);
    if (t >= P.swap && t <= P.bomb + 4 && knot.length) T.aim((knot[0].x + knot[knot.length - 1].x) / 2, knot[0].y + 2);
    if (t === P.bomb) T.fire(4);
    if (t === P.bomb + 40) ctx.wands.active = 0;
    // Anyone left: mop up.
    const left = T.party.filter(alive);
    if (t >= 186 && t < 260 && left.length) {
      const a = lead(left[0]); T.aim(a.x, a.y);
      if ((t - 186) % 22 === 0) T.fire(3);
    }
    if (t > 260) T.aim(p.x + 100, p.y - 14);
    if (t === 185 || t === 300) T.note(`party left ${left.length}: ${left.map((e) => e.kind).join(',')}`);
  },
};

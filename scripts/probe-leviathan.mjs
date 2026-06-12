// Runtime probe for the Sunken Leviathan (task #29, d4's mid-boss):
//   - the Sump arena generates on d4: metal-cased basin, water fill, three
//     stone drain plugs, the leviathan swimming in it
//   - WATER IS ITS ARMOR: damage while submerged glances off (x0.25)
//   - the pool is a circuit: charge in the water cooks it
//   - dig the plugs -> the basin drains downhill -> beached -> full damage
//   - death pays out a heart + a card tome and does NOT end the run
// Usage: node scripts/probe-leviathan.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));

let pass = 0,
  fail = 0;
const check = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  ok ? pass++ : fail++;
};

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// ---------------- arena generation + parking ----------------
const r1 = await page.evaluate(async () => {
  localStorage.removeItem('noita-expedition');
  const ctx = window.__game.ctx;
  ctx.state.worldSeed = 1;
  document.getElementById('mode-play-btn').click();
  await new Promise((r) => setTimeout(r, 1800));
  ctx.levels.leaveLevel();
  ctx.levels.enterLevel(ctx, 'd4');
  await new Promise((r) => setTimeout(r, 600));
  const rt = ctx.levels.current;
  const boss = rt.boss ?? null;
  if (!boss || boss.kind !== 'leviathan') return { boss };
  const w = ctx.world;
  const cx = boss.x,
    cy = boss.y - 26; // arena anchor (see structures.ts)
  // the only resident that matters for the asserts is the boss
  for (let i = ctx.enemies.length - 1; i >= 0; i--) {
    if (ctx.enemies[i].kind !== 'leviathan') ctx.enemies.splice(i, 1);
  }
  const lev = ctx.enemies.find((e) => e.kind === 'leviathan') ?? null;
  // census helpers over the basin interior
  const census = (t) => {
    let n = 0;
    for (let X = cx - 26; X <= cx + 26; X++)
      for (let Y = cy + 15; Y <= cy + 33; Y++) if (w.types[w.idx(X, Y)] === t) n++;
    return n;
  };
  const water0 = census(2);
  const metal0 = census(13);
  // plugs: stone columns through the casing floor at cx-16 / cx / cx+16
  let plugCells = 0;
  for (const px of [cx - 16, cx, cx + 16]) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const Y of [cy + 33, cy + 34]) {
        if (w.types[w.idx(px + dx, Y)] === 12) plugCells++;
      }
    }
  }
  // park the wizard in a carved metal cell on the arena's edge — inside the
  // sim window, outside lunge range, invulnerable to the volleys
  const p = ctx.player;
  const bx = cx + 110,
    by = cy + 10;
  for (let X = bx - 7; X <= bx + 7; X++)
    for (let Y = by - 22; Y <= by + 3; Y++) {
      const i = w.idx(X, Y);
      w.types[i] = 0;
      w.life[i] = 0;
      w.charge[i] = 0;
    }
  for (let X = bx - 7; X <= bx + 7; X++) {
    for (const Y of [by - 22, by + 3]) {
      const i = w.idx(X, Y);
      w.types[i] = 13;
    }
  }
  for (let Y = by - 22; Y <= by + 3; Y++) {
    for (const X of [bx - 7, bx + 7]) {
      const i = w.idx(X, Y);
      w.types[i] = 13;
    }
  }
  p.x = bx;
  p.y = by + 2;
  p.vx = 0;
  p.vy = 0;
  p.invuln = 1000000;
  ctx.camera.snapTo(p.x, p.y);
  await new Promise((r) => setTimeout(r, 1500)); // sim window arrives; census runs
  return {
    boss,
    hasLev: !!lev,
    water0,
    metal0,
    plugCells,
    submerged: lev ? lev.submerged === true : false,
    cx,
    cy,
  };
});
check(!!r1.boss && r1.boss.kind === 'leviathan', 'the Sump arena generates on d4', r1.boss ? `@${r1.boss.x},${r1.boss.y}` : 'no boss');
check(r1.hasLev, 'the leviathan swims in it');
check(r1.water0 >= 400, 'the basin holds its pool', `water=${r1.water0}`);
// census region [cx±26] excludes the side walls — it sees the casing floor
check(r1.metal0 >= 40, 'metal casing lines the basin', `metal=${r1.metal0}`);
check(r1.plugCells >= 14, 'three stone drain plugs seal the casing floor', `plug cells=${r1.plugCells}`);
check(r1.submerged === true, 'the body census reads SUBMERGED');

// ---------------- water is its armor ----------------
const r2 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const lev = ctx.enemies.find((e) => e.kind === 'leviathan');
  if (!lev) return { err: 'boss gone' };
  const hp0 = lev.hp;
  ctx.enemyCtl.damage(lev, 40, 0, 0);
  const submergedDrop = hp0 - lev.hp;
  // electrocution: a spark in the pool — paint charge into the water around it
  const w = ctx.world;
  const hp1 = lev.hp;
  for (let t = 0; t < 12; t++) {
    for (let dx = -10; dx <= 10; dx += 2) {
      for (let dy = -10; dy <= 10; dy += 2) {
        const X = Math.floor(lev.x) + dx,
          Y = Math.floor(lev.y) - 6 + dy;
        if (w.inBounds(X, Y) && w.types[w.idx(X, Y)] === 2) w.charge[w.idx(X, Y)] = 6;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const shockDrop = hp1 - lev.hp;
  return { submergedDrop, shockDrop };
});
check(r2.submergedDrop > 0 && r2.submergedDrop <= 15, 'submerged hits glance off (x0.25)', `40 dealt -> ${r2.submergedDrop}`);
check(r2.shockDrop >= 20, 'charge in the pool cooks it', `shock drop=${r2.shockDrop}`);

// ---------------- dig the plugs, drain the basin ----------------
const r3 = await page.evaluate(
  async ({ cx, cy }) => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    for (const px of [cx - 16, cx, cx + 16]) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const Y of [cy + 33, cy + 34]) {
          const i = w.idx(px + dx, Y);
          if (w.types[i] === 12 || w.types[i] === 17) {
            w.types[i] = 0;
          }
        }
      }
    }
    const census = () => {
      let n = 0;
      for (let X = cx - 26; X <= cx + 26; X++)
        for (let Y = cy + 15; Y <= cy + 33; Y++) if (w.types[w.idx(X, Y)] === 2) n++;
      return n;
    };
    let water = census();
    for (let t = 0; t < 90; t++) {
      await new Promise((r) => setTimeout(r, 500));
      water = census();
      if (water < 100) break;
    }
    await new Promise((r) => setTimeout(r, 800)); // census cadence + settling
    const lev = ctx.enemies.find((e) => e.kind === 'leviathan');
    return { water, submerged: lev ? lev.submerged === true : null };
  },
  { cx: r1.cx, cy: r1.cy },
);
check(r3.water < 100, 'dug plugs drain the basin into the caves below', `water=${r3.water}`);
check(r3.submerged === false, 'the leviathan is BEACHED');

// ---------------- meat on the tiles ----------------
const r4 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const lev = ctx.enemies.find((e) => e.kind === 'leviathan');
  if (!lev) return { err: 'boss gone' };
  const hp0 = lev.hp;
  ctx.enemyCtl.damage(lev, 40, 0, 0);
  const beachedDrop = hp0 - lev.hp;
  // the kill: reward, no victory
  let runCompleted = false;
  ctx.events.on('runComplete', () => {
    runCompleted = true;
  });
  const rt = ctx.levels.current;
  const hearts0 = rt.pickups.filter((p) => p.kind === 'heart' && !p.taken).length;
  const tomes0 = rt.pickups.filter((p) => p.kind === 'tome' && !p.taken).length;
  ctx.enemyCtl.damage(lev, lev.hp + 50, 0, 0);
  await new Promise((r) => setTimeout(r, 500));
  const hearts1 = rt.pickups.filter((p) => p.kind === 'heart' && !p.taken).length;
  const newTome = rt.pickups.filter((p) => p.kind === 'tome' && !p.taken).length - tomes0;
  const tomeCards = rt.pickups
    .filter((p) => p.kind === 'tome' && !p.taken)
    .map((p) => p.data.card);
  const stillD4 = ctx.levels.current.def.id === 'd4';
  const saveAlive = ctx.levels.hasSavedExpedition();
  const bossGone = !ctx.enemies.some((e) => e.kind === 'leviathan');
  return {
    beachedDrop,
    heartDrop: hearts1 - hearts0,
    newTome,
    tomeCards,
    runCompleted,
    stillD4,
    saveAlive,
    bossGone,
  };
});
check(r4.beachedDrop >= 30, 'a beached leviathan takes FULL damage', `40 dealt -> ${r4.beachedDrop}`);
check(r4.bossGone, 'the leviathan falls');
check(r4.heartDrop >= 1 && r4.newTome >= 1, 'mid-boss reward: a heart and a card tome', `hearts+${r4.heartDrop} tomes+${r4.newTome}`);
check(r4.runCompleted === false, 'the run does NOT end (no victory event)');
check(r4.stillD4 && r4.saveAlive, 'the descent continues — save intact, still on d4');

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

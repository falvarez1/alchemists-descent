// Runtime probe for the Refuge: a hewn rest alcove off the portal shrine.
//   - healium spring fills from its eternal drip and SELF-CAPS (the drip
//     cell sits at the full line; emitters only stamp into Empty)
//   - wading the pool heals the alchemist
//   - the gold-flecked shrine opens the Sanctum SHOP on E, and closing it
//     resumes the same level (no descend)
// Usage: node scripts/probe-refuge.mjs [url]
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

// find a seed whose d1 carved a refuge (two candidate sites; most seeds hit)
let seedUsed = -1;
for (let seed = 1; seed <= 8 && seedUsed < 0; seed++) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const has = await page.evaluate(async (SEED) => {
    localStorage.removeItem('noita-expedition');
    const ctx = window.__game.ctx;
    ctx.state.worldSeed = SEED;
    document.getElementById('mode-play-btn').click();
    await new Promise((r) => setTimeout(r, 1800));
    return !!window.__game.ctx.levels.current?.refuge;
  }, seed);
  if (has) seedUsed = seed;
}
check(seedUsed > 0, 'refuge generates on d1 within 8 seeds', `seed=${seedUsed}`);

if (seedUsed > 0) {
  const res = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const rt = ctx.levels.current;
    const w = ctx.world;
    const shrine = rt.refuge;
    const rx = shrine.x,
      ry = shrine.y - 7;
    const drip = (rt.emitters ?? []).find((e) => e.y === ry + 6 && Math.abs(e.x - rx) === 6);
    const s = drip ? Math.sign(drip.x - rx) : 1; // pool side (away from mouth)
    const light = (rt.authoredLights ?? []).find(
      (l) => Math.abs(l.x - rx) <= 2 && Math.abs(l.y - (ry + 1)) <= 3,
    );
    let gold = 0;
    for (let X = rx - 2; X <= rx + 2; X++)
      for (let Y = ry + 7; Y <= ry + 9; Y++) if (w.types[w.idx(X, Y)] === 17) gold++;
    // park the alchemist in the refuge so the sim window covers the spring —
    // but CLEAR of the pool columns: healium is consumed on body contact
    // even at full hp, so a wizard parked over the pit drinks it dry.
    // Also clear the roster so wandering hostiles can't maul the probe.
    ctx.enemies.length = 0;
    ctx.player.x = rx - s * 3;
    ctx.player.y = ry + 8; // feet row — the hewn roof leaves 19 rows of air
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    const HEAL = drip ? drip.cell : -1;
    const pLo = Math.min(rx + s * 2, rx + s * 11),
      pHi = Math.max(rx + s * 2, rx + s * 11);
    const pool = () => {
      let n = 0;
      for (let X = pLo; X <= pHi; X++)
        for (let Y = ry + 5; Y <= ry + 9; Y++) if (w.types[w.idx(X, Y)] === HEAL) n++;
      return n;
    };
    // let the spring fill, then watch for the self-cap plateau
    await new Promise((r) => setTimeout(r, 9000));
    const fill1 = pool();
    await new Promise((r) => setTimeout(r, 5000));
    const fill2 = pool();
    // wade and heal: pin the boots into the liquid rows each tick (probe
    // teleports fight the swim physics; real wading is just walking in).
    // High-watermark assert: healing and consumption race, so hp can rise
    // then ebb — any rise proves the spring heals.
    ctx.player.hp = Math.max(10, Math.floor(ctx.player.maxHp * 0.25));
    const hp0 = ctx.player.hp;
    let hp1 = hp0;
    for (let t = 0; t < 30; t++) {
      ctx.player.x = rx + s * 6;
      ctx.player.y = ry + 8; // boots in the cistern's liquid rows
      ctx.player.vx = 0;
      ctx.player.vy = 0;
      await new Promise((r) => setTimeout(r, 200));
      if (ctx.player.hp > hp1) hp1 = ctx.player.hp;
    }
    // the shrine trade: E in reach opens the Sanctum shop (stand beside it)
    ctx.player.x = rx - 4;
    ctx.player.y = ry + 8;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    await new Promise((r) => setTimeout(r, 400));
    const before = rt.def.id;
    const dbg = {
      player: { x: Math.round(ctx.player.x), y: Math.round(ctx.player.y) },
      shrine,
      dead: ctx.player.dead,
      pullT: ctx.player.pullT,
      sancOpenBefore: ctx.sanctum.isOpen,
    };
    ctx.enemies.length = 0;
    const opened = ctx.mechanisms.interact(ctx);
    dbg.opened = opened;
    dbg.sancOpenAfter = ctx.sanctum.isOpen;
    let nearLever = 1e9;
    for (const m of rt.mechanisms) {
      if (m.kind !== 'lever') continue;
      const d = Math.hypot(m.x - ctx.player.x, m.y - ctx.player.y);
      if (d < nearLever) nearLever = d;
    }
    dbg.nearLever = Math.round(nearLever);
    await new Promise((r) => setTimeout(r, 300));
    const overlayUp =
      document.getElementById('sanctum-overlay').classList.contains('visible') &&
      ctx.state.paused === true;
    const noteShown = (document.getElementById('perk-row').textContent ?? '').includes('TRADE');
    document.getElementById('descend-btn').click();
    await new Promise((r) => setTimeout(r, 400));
    const closedClean =
      !document.getElementById('sanctum-overlay').classList.contains('visible') &&
      ctx.state.paused === false &&
      ctx.levels.current.def.id === before;
    return {
      hasDrip: !!drip,
      hasLight: !!light,
      gold,
      fill1,
      fill2,
      hp0,
      hp1,
      opened,
      overlayUp,
      noteShown,
      closedClean,
      dbg,
    };
  });
  console.log('DBG', JSON.stringify(res.dbg));
  check(res.hasDrip, 'spring drip emitter present');
  check(res.hasLight, 'refuge carries a warm authored light');
  check(res.gold >= 3, 'shrine crown is real gold', `gold=${res.gold}`);
  check(res.fill1 >= 5, 'spring fills from the drip', `pool=${res.fill1}`);
  check(res.fill2 <= res.fill1 + 4 && res.fill2 <= 18, 'spring self-caps at the full line', `pool=${res.fill2}`);
  check(res.hp1 > res.hp0, 'wading the spring heals', `${res.hp0} -> ${res.hp1}`);
  check(res.opened && res.overlayUp, 'E at the shrine opens the Sanctum shop');
  check(res.noteShown, 'shop-only note shown (no boon draft)');
  check(res.closedClean, 'closing the trade resumes the SAME level');
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

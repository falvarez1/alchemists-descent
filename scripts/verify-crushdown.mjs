// Repro: standing under crates that fall on you must NOT push you down into the
// floor. Drop a stack onto the grounded player and watch player.y vs the floor.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://127.0.0.1:5219/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 30; f++) window.__game.tick();
  const rb = ctx.rigidBodies;
  const p = ctx.player;
  const FY = 700;
  const crate = (x, y) => rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, x, y, { material: 'stone', friction: 0.6, restitution: 0.1 });
  const place = () => { p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false; p.diveT = 0; p.x = 300; p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; p.hp = p.maxHp; };

  // Scenario A — GROUNDED under a falling stack (should just get shoved aside, never down)
  rb.clear(); place();
  crate(300, 640); crate(300, 615); crate(300, 590); crate(300, 565);
  let maxYA = p.y;
  for (let f = 0; f < 90; f++) { p.x = 300; window.__game.tick(); if (p.y > maxYA) maxYA = p.y; }

  // Scenario B — LEVITATING/JUMPING up into a box that's falling through his torso
  rb.clear(); place();
  const cr = crate(300, 687); // bottom ~690, inside his torso (head 682, feet 699)
  let maxYB = p.y, sankAtF = -1;
  const rows = [];
  for (let f = 0; f < 24; f++) {
    p.x = 300; p.vy = -3; // rising (levitate/jump) into the box above
    window.__game.tick();
    if (p.y > maxYB) maxYB = p.y;
    if (sankAtF < 0 && p.y > 702) sankAtF = f;
    rows.push({ f, y: +p.y.toFixed(1), vy: +p.vy.toFixed(2), crB: +(cr.y + 3.5).toFixed(1) });
  }
  return { FY, maxYA: +maxYA.toFixed(1), maxYB: +maxYB.toFixed(1), sankAtF, dead: p.dead, rows: rows.slice(0, 10) };
});

console.log(JSON.stringify({ endY: r.endY, maxY: r.maxY, sankAtF: r.sankAtF, dead: r.dead }));
console.log('trace:', JSON.stringify(r.rows));
const sank = r.sankAtF >= 0 || r.maxY > 701 || r.dead;
console.log(`\nCRUSH-INTO-FLOOR BUG: ${sank ? 'YES (maxY ' + r.maxY + ' below floor ' + r.FY + ')' : 'no'}`);
console.log('page errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
process.exit(sank ? 1 : 0);

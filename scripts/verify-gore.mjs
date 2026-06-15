// Verifies the global Blood / Gore Amount dial (ctx.params.global.bloodAmount)
// scales the gore/blood particles sprayed when an enemy is hit and killed.
// Usage: node scripts/verify-gore.mjs [url]   (dev server running)
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.mode = 'play';
  ctx.state.paused = false;
  const P = ctx.particles.list;
  const spawnMage = () => {
    ctx.enemyCtl.spawn('mage', 300, 300);
    return ctx.enemies[ctx.enemies.length - 1];
  };
  // HIT spray (enemy survives): measure particles spawned by one non-lethal hit.
  const e = spawnMage();
  const hit = (blood) => {
    ctx.params.global.bloodAmount = blood;
    e.hp = 99999;
    const before = P.length;
    ctx.enemyCtl.damage(e, 20, 2, -1.6);
    return P.length - before;
  };
  const hit0 = hit(0);
  const hit1 = hit(1);
  const hit2 = hit(2);
  // KILL spray (lethal blow): fresh enemy each time so the kill burst fires.
  const killAt = (blood) => {
    ctx.params.global.bloodAmount = blood;
    const k = spawnMage();
    k.hp = 5;
    const before = P.length;
    ctx.enemyCtl.damage(k, 50, 2, -1.6);
    return P.length - before;
  };
  const kill0 = killAt(0);
  const kill1 = killAt(1);
  ctx.params.global.bloodAmount = 1;
  return { hit0, hit1, hit2, kill0, kill1 };
});

check('bloodAmount=0 → no gore on a hit', r.hit0 === 0, JSON.stringify(r));
check('bloodAmount=1 → a hit sprays gore', r.hit1 > 0, JSON.stringify(r));
check('bloodAmount=2 → more gore than 1×', r.hit2 > r.hit1, JSON.stringify(r));
check('bloodAmount≈2× scales roughly double', r.hit2 >= r.hit1 * 1.6 && r.hit2 <= r.hit1 * 2.4, JSON.stringify(r));
// A kill at 0× still drops the (non-gore) gold-bounty shower; gore itself is
// suppressed, so the killing blow's particle count collapses to that baseline.
check('bloodAmount=0 → gore suppressed on a kill (only bounty shower)', r.kill0 < 20, JSON.stringify(r));
check('gore dominates a 1× kill (far above the bounty baseline)', r.kill1 - r.kill0 > 100, JSON.stringify(r));
check('a kill sprays more than a hit', r.kill1 > r.hit1, JSON.stringify(r));

// Gore is proportional to enemy size: compare a tiny bat to a big golem at 1×.
// Use the non-lethal HIT spray so the gold-bounty shower doesn't muddy it.
const size = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.params.global.bloodAmount = 1;
  const P = ctx.particles.list;
  const hitSpray = (kind) => {
    ctx.enemyCtl.spawn(kind, 300, 300);
    const e = ctx.enemies[ctx.enemies.length - 1];
    e.hp = 99999;
    const before = P.length;
    ctx.enemyCtl.damage(e, 20, 2, -1.6);
    return P.length - before;
  };
  return { bat: hitSpray('bat'), golem: hitSpray('golem') };
});
check('small enemy (bat) still spatters a little', size.bat > 0, JSON.stringify(size));
check('big enemy (golem) sprays far more than small (size-proportional)', size.golem > size.bat * 3, JSON.stringify(size));

// Tarantino mode: bloodAmount can be cranked to 10×. clear() the pool first so
// the spray isn't capped by leftover particles from earlier checks.
const max = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const P = ctx.particles.list;
  const hitAt = (blood) => {
    ctx.particles.clear();
    ctx.params.global.bloodAmount = blood;
    ctx.enemyCtl.spawn('mage', 300, 300);
    const e = ctx.enemies[ctx.enemies.length - 1];
    e.hp = 99999;
    const before = P.length;
    ctx.enemyCtl.damage(e, 20, 2, -1.6);
    return P.length - before;
  };
  const at1 = hitAt(1);
  const at10 = hitAt(10);
  ctx.params.global.bloodAmount = 1;
  return { at1, at10 };
});
check('10× sprays far more than 1× (maximum gore)', max.at10 > max.at1 * 5, JSON.stringify(max));

// Discrete per-material channels: blood / slime / ooze tune independently. A
// slime sprays its own green Slime (slime channel) + a universal red Blood spray.
const ch = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const g = ctx.params.global;
  const P = ctx.particles.list;
  g.bloodAmount = 1;
  const hit = (kind, blood, slime, ooze) => {
    g.goreBlood = blood;
    g.goreSlime = slime;
    g.goreOoze = ooze;
    ctx.particles.clear();
    ctx.enemyCtl.spawn(kind, 300, 300);
    const e = ctx.enemies[ctx.enemies.length - 1];
    e.hp = 99999;
    const before = P.length;
    ctx.enemyCtl.damage(e, 20, 2, -1.6);
    return P.length - before;
  };
  const slimeFull = hit('slime', 1, 1, 1);
  const slimeNoSlime = hit('slime', 1, 0, 1);
  const slimeNoBlood = hit('slime', 0, 1, 1);
  const slimeNone = hit('slime', 0, 0, 1);
  const acidFull = hit('acidslime', 1, 1, 1);
  const acidNoOoze = hit('acidslime', 1, 1, 0);
  g.goreBlood = g.goreSlime = g.goreOoze = 1;
  return { slimeFull, slimeNoSlime, slimeNoBlood, slimeNone, acidFull, acidNoOoze };
});
check('slime hit mixes blood + slime channels', ch.slimeFull > 0, JSON.stringify(ch));
check('Green Slime=0 cuts slime but keeps blood', ch.slimeNoSlime > 0 && ch.slimeNoSlime < ch.slimeFull, JSON.stringify(ch));
check('Red Blood=0 cuts blood but keeps slime', ch.slimeNoBlood > 0 && ch.slimeNoBlood < ch.slimeFull, JSON.stringify(ch));
check('channels are additive (blood-only + slime-only = full)', ch.slimeNoSlime + ch.slimeNoBlood === ch.slimeFull, JSON.stringify(ch));
check('blood+slime both 0 → no gore on a slime hit', ch.slimeNone === 0, JSON.stringify(ch));
check('Glowing Ooze=0 cuts an acidslime\'s acid (blood remains)', ch.acidNoOoze > 0 && ch.acidNoOoze < ch.acidFull, JSON.stringify(ch));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\ngore probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

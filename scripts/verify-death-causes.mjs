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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.playerCtl, { timeout: 20000 });

const result = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const tick = (n) => { for (let f = 0; f < n; f++) window.__game.tick(); };
  const causeText = () => document.getElementById('go-cause')?.textContent ?? '';
  const overlayVisible = () => document.getElementById('gameover-overlay')?.classList.contains('visible') ?? false;
  const reset = () => {
    ctx.events.emit('playerDeathCleared');
    const p = ctx.player;
    p.dead = false;
    p.hp = p.maxHp;
    p.invuln = 0;
    p.lastDamageSource = null;
    p.status.wet = 0;
    p.status.oiled = 0;
    p.status.burning = 0;
    p.status.frozen = 0;
    p.status.electrified = 0;
    p.x = 835;
    p.y = 599;
    p.vx = 0;
    p.vy = 0;
    p.fx = 0;
    p.fy = 0;
    ctx.state.mode = 'play';
    ctx.state.paused = false;
  };

  await ctx.console.exec('run test --level physics-test --world campaign-level');
  tick(20);

  reset();
  ctx.player.hp = 1;
  ctx.playerCtl.damage(999, 0, 0, 'weaver-bite');
  tick(2);
  ctx.events.emit('playerCorpseSettled');
  const weaver = {
    text: causeText(),
    visible: overlayVisible(),
    source: ctx.player.lastDamageSource,
    dead: ctx.player.dead,
  };

  reset();
  ctx.player.hp = 0.5;
  ctx.player.status.wet = 90;
  ctx.player.status.electrified = 90;
  tick(4);
  ctx.events.emit('playerCorpseSettled');
  const shock = {
    text: causeText(),
    visible: overlayVisible(),
    source: ctx.player.lastDamageSource,
    dead: ctx.player.dead,
  };

  reset();
  ctx.player.hp = 1;
  ctx.playerCtl.damage(999, 0, 0, 'colossus-fireball');
  tick(2);
  ctx.events.emit('playerCorpseSettled');
  const colossus = {
    text: causeText(),
    visible: overlayVisible(),
    source: ctx.player.lastDamageSource,
    dead: ctx.player.dead,
  };

  return { weaver, shock, colossus };
});

check('Weaver death shows a Weaver obituary', result.weaver.visible && result.weaver.dead && /Weaver/.test(result.weaver.text), JSON.stringify(result.weaver));
check('wet electrocution status death shows the water/electricity obituary', result.shock.visible && result.shock.dead && /electrocution|Wet, shocked/.test(result.shock.text), JSON.stringify(result.shock));
check('Colossus projectile death shows Colossus copy', result.colossus.visible && result.colossus.dead && /Colossus|Molten/.test(result.colossus.text), JSON.stringify(result.colossus));
check('sources are recorded on the player', result.weaver.source === 'weaver-bite' && result.shock.source === 'wet-electrocution' && result.colossus.source === 'colossus-fireball', JSON.stringify(result));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(JSON.stringify(result, null, 2));
console.log(`\ndeath-cause probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

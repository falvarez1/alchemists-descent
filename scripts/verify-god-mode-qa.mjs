// God-mode QA controls: infinite flask inventory, play-HUD power toggles, and
// card reshuffle without opening the Wand Bench.
// Usage: node scripts/verify-god-mode-qa.mjs [url]
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
page.on('console', (msg) => {
  if (msg.type() === 'error') pageErrors.push(msg.text());
});
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });

const god = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.state.mode = 'play';
  ctx.events.emit('modeChanged', { mode: 'play' });
  if (!ctx.levels.current) ctx.levels.startDescent(ctx);
  return ctx.console.exec('god');
});
check('console god command succeeds in normal play', god.ok === true, JSON.stringify(god));

await page.waitForFunction(() => document.querySelector('#god-tools.visible'), { timeout: 8000 });
const hud = await page.evaluate(() => ({
  visible: document.querySelector('#god-tools.visible') !== null,
  benchOpen: document.querySelector('#wand-bench.visible') !== null,
  powerCount: document.querySelectorAll('#god-tools .god-power').length,
  activePowers: document.querySelectorAll('#god-tools .god-power.active').length,
}));
check('god-mode HUD QA tools appear without opening bench', hud.visible && !hud.benchOpen && hud.powerCount === 10, JSON.stringify(hud));
check('god-mode HUD starts with all powers active', hud.activePowers === 10, JSON.stringify(hud));

await page.locator('#god-tools .god-power', { hasText: 'MIGHT' }).click();
const mightOff = await page.evaluate(() => ({
  perk: window.__game.ctx.player.perks.might === true,
  pressed: document.querySelector('#god-tools .god-power')?.getAttribute('aria-pressed'),
}));
check('HUD active power chip toggles a god perk off', mightOff.perk === false, JSON.stringify(mightOff));

await page.locator('#god-tools .god-power', { hasText: 'MIGHT' }).click();
const mightOn = await page.evaluate(() => window.__game.ctx.player.perks.might === true);
check('HUD active power chip toggles a god perk back on', mightOn === true);

const beforeShuffle = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return ctx.wands.wands.map((wand) => wand.cards.join('|')).join(' / ');
});
await page.locator('#god-tools .god-tool-btn', { hasText: 'RESHUFFLE CARDS' }).click();
const shuffle = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const slotted = ctx.wands.wands.flatMap((wand) => wand.cards).filter(Boolean);
  return {
    benchOpen: document.querySelector('#wand-bench.visible') !== null,
    frames: ctx.wands.wands.map((wand) => wand.frame.id),
    slotted,
    unique: new Set(slotted).size,
    collection: ctx.wands.collection.length,
    after: ctx.wands.wands.map((wand) => wand.cards.join('|')).join(' / '),
  };
});
check(
  'HUD reshuffles review wands without opening bench',
  !shuffle.benchOpen &&
    shuffle.frames.join(',') === 'brass,void' &&
    shuffle.slotted.length === 10 &&
    shuffle.unique === 10 &&
    shuffle.collection > 0,
  JSON.stringify({ beforeShuffle, shuffle }),
);

const flask = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.flask.cancelBottle();
  ctx.flask.setSlot(0, 2, 40);
  ctx.flask.selectSlot(0);
  ctx.player.dead = false;
  ctx.player.climbing = false;
  ctx.input.mouse.x = ctx.player.x + 40;
  ctx.input.mouse.y = ctx.player.y - 20;
  ctx.input.pourHeld = true;
  ctx.flask.update(ctx);
  ctx.input.pourHeld = false;
  const afterPour = { material: ctx.flask.state.material, count: ctx.flask.state.count };
  ctx.flask.throwFlask(ctx);
  return {
    afterPour,
    afterThrow: { material: ctx.flask.state.material, count: ctx.flask.state.count },
    bottle: ctx.flask.bottleView(),
  };
});
check(
  'god-mode flask pour and throw do not deplete inventory',
  flask.afterPour.material === 2 &&
    flask.afterPour.count === 40 &&
    flask.afterThrow.material === 2 &&
    flask.afterThrow.count === 40 &&
    flask.bottle?.material === 2 &&
    flask.bottle?.count === 40,
  JSON.stringify(flask),
);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\ngod-mode QA probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

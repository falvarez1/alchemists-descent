// THE BRANCHING DESCENT, end to end in the real game: stand on a floor's open
// portal, the Sanctum offers the floor below's two doors, REAL clicks choose a
// door and a boon, and the descent lands on the chosen door with the run's
// route recorded. Then the single-door Sanctum above the Kiln.
//   node scripts/verify-branch-doors.mjs [--url=http://localhost:5173/] [--out=verify-out]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsolePlayRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const url = opt('url', 'http://localhost:5173/');
const out = opt('out', 'verify-out');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

async function walkIntoPortal() {
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const rt = ctx.levels.current;
    rt.keyTaken = true;
    ctx.player.x = rt.portal.x;
    ctx.player.y = rt.portal.y + 6;
    ctx.player.vx = 0; ctx.player.vy = 0;
  });
  await page.waitForSelector('#sanctum-overlay.visible', { timeout: 10000 });
  await page.waitForTimeout(400);
}

async function realClick(selector) {
  const el = await page.$(selector);
  if (!el) throw new Error(`no ${selector}`);
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 30));
  await page.waitForTimeout(250);
}

const descendText = () => page.$eval('#descend-btn', (b) => ({ text: b.textContent, disabled: b.disabled }));

// ---- Floor 2 (the Rot Gardens) -> two doors below.
await startConsolePlayRun(page, { level: 'd2', seed: 11, settleMs: 800 });
await walkIntoPortal();
const doors = await page.$$eval('.sanc-door', (els) => els.map((e) => ({ id: e.dataset.level, name: e.querySelector('.sanc-below-name')?.textContent, pressed: e.getAttribute('aria-pressed') })));
check(doors.length === 2 && doors[0].id === 'd3' && doors[1].id === 'd3b', `the Sanctum above floor 3 offers two doors: ${JSON.stringify(doors)}`);
let d = await descendText();
check(d.disabled && /boon and a door/.test(d.text), `descend waits for a boon and a door ("${d.text}")`);
await page.screenshot({ path: `${out}/branch-doors-sanctum.png` });
await realClick('.sanc-door[data-level="d3b"]');
d = await descendText();
check(d.disabled && /Choose a boon/.test(d.text), `a door alone does not descend ("${d.text}")`);
const pressed = await page.$eval('.sanc-door[data-level="d3b"]', (e) => e.getAttribute('aria-pressed'));
check(pressed === 'true', 'the chosen door is pressed');
await realClick('.perk-card');
d = await descendText();
check(!d.disabled && d.text === 'Descend to the Glass Galleries', `a boon and a door arm the descent ("${d.text}")`);
await page.screenshot({ path: `${out}/branch-doors-chosen.png` });
await realClick('#descend-btn');
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'd3b' && !window.__game.ctx.levels.transitioning, null, { timeout: 30000 });
const after = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return { id: ctx.levels.current.def.id, path: ctx.run.snapshotForSave()?.path ?? null, floor: document.querySelector('#level-curtain')?.textContent ?? '' };
});
check(after.id === 'd3b', `descended to the chosen door (${after.id})`);
check(JSON.stringify(after.path) === JSON.stringify(['d2', 'd3b']), `the run's route is recorded: ${JSON.stringify(after.path)}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/branch-doors-arrival.png` });

// ---- Floor 3 (the Glass Galleries) -> one door below.
await walkIntoPortal();
const single = await page.$$eval('.sanc-door', (els) => els.length);
check(single === 0, 'above the Kiln there is only one way down (no door cards)');
await realClick('.perk-card');
d = await descendText();
check(!d.disabled && d.text === 'Descend to the Kiln Heart', `the single door arms with a boon ("${d.text}")`);
await realClick('#descend-btn');
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'd4' && !window.__game.ctx.levels.transitioning, null, { timeout: 30000 });
const route = await page.evaluate(() => window.__game.ctx.run.snapshotForSave()?.path ?? null);
check(JSON.stringify(route) === JSON.stringify(['d2', 'd3b', 'd4']), `the route reaches the Kiln: ${JSON.stringify(route)}`);

if (errors.length) console.log('page errors:', errors.slice(0, 5));
check(errors.length === 0, 'no page errors');
await browser.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

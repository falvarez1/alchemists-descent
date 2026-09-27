// D1 cold census readability: stand at the cistern and read the hint the
// player actually gets — before Frost Shard, with the cistern drained, while
// it freezes. Usage: node scripts/probe-cold-hint.mjs [url]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { startConsolePlayRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = 'verify-out/cold-hint'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await startConsolePlayRun(page, { seed: 7, settleMs: 600 });
const read = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
  return page.evaluate(() => ({ hint: document.getElementById('interaction-hint')?.textContent,
    visible: document.getElementById('interaction-hint')?.classList.contains('visible') }));
};
await page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; c.player.x = 348; c.player.y = 314; c.player.vx = 0; c.player.vy = 0; });
let fail = 0;
const expect = (label, r, re) => { const ok = r.visible && re.test(r.hint ?? ''); if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(r)}`); };
expect('first look', await read('1-first-look'), /count ICE, not water/);
await page.evaluate(() => { const w = window.__game.ctx.world; for (let y = 333; y <= 341; y++) for (let x = 302; x <= 327; x++) if (w.types[w.idx(x, y)] === 2) w.clearCellAt(w.idx(x, y)); });
expect('drained', await read('2-drained'), /too shallow/);
await page.evaluate(() => { const w = window.__game.ctx.world; for (let y = 335; y <= 341; y++) for (let x = 302; x <= 327; x++) w.replaceCellAt(w.idx(x, y), 2, 0x4c8f97); });
await page.evaluate(() => { const c = window.__game.ctx; c.wands.collection.push('frostshard'); });
expect('frost in hand', await read('3-frost'), /Cast Frost Shard/);
await page.evaluate(() => { const w = window.__game.ctx.world; for (let x = 302; x <= 313; x++) w.replaceCellAt(w.idx(x, 335), 10, 0xb8e0ea); });
expect('freezing', await read('4-freezing'), /probes read \d+\/32 ice/);
if (errors.length) { fail++; console.log(errors.join('\n')); }
await browser.close();
process.exit(fail ? 1 : 0);

// CPU vs CPU, watched: enters a Duel through the real lobby with two CPU seats, lets it play in REAL time (rendered, the
// game's own camera) and takes a frame every --every ms, then lays the frames out as one contact sheet with the tick, both
// fighters' tactics mode and percent under each. The way to judge whether the computer fighters look like people fighting
// (docs/arena/AI-STOCK-TACTICS.md): metrics say how often, the sheet says how it looks.
// Usage: node scripts/shot-duel-cpu.mjs [url] [--p1 ilyra-voss] [--p2 brann-rook] [--stage foundry] [--level 3]
//        [--frames 24] [--every 500] [--skip 1500] [--cols 6] [--out verify-out/duel-cpu] [--tag name]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const p1 = opt('p1', 'ilyra-voss'), p2 = opt('p2', 'brann-rook'), stage = opt('stage', 'foundry'), level = Number(opt('level', '3'));
const frames = Number(opt('frames', '24')), every = Number(opt('every', '500')), skip = Number(opt('skip', '1500')), cols = Number(opt('cols', '6'));
const out = opt('out', 'verify-out/duel-cpu'), tag = opt('tag', `${p1}-${p2}-${stage}-l${level}`);
mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'link=off', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.locator('[data-entry="duel"]').click();
  await page.locator('#versus-lobby').waitFor({ state: 'visible' });
  await page.evaluate(({ stage, p1, p2, level }) => {
    const v = window.__game.ctx.versus;
    v.chooseDevice(0, 'cpu'); v.chooseDevice(1, 'cpu');
    v.chooseFighter(0, p1); v.chooseFighter(1, p2); v.chooseStage?.(stage);
    v.chooseDifficulty(0, level); v.chooseDifficulty(1, level);
    void v.start(); v.skipIntro();
  }, { stage, p1, p2, level });
  await page.waitForFunction(() => window.__game.ctx.arena?.stockMatch?.state === 'fighting', null, { timeout: 60000 });
  if (await page.locator('.controller-notice button').count()) await page.locator('.controller-notice button').click().catch(() => {});
  await page.waitForTimeout(skip);
  const shots = [];
  for (let i = 0; i < frames; i++) {
    const info = await page.evaluate(async () => {
      const c = window.__game.ctx, a = c.arena, bots = (await c.console.exec('arena status')).data.bots;
      return { t: c.state.frameCount, state: a.stockMatch?.state, p: [0, 1].map(s => ({ mode: bots[s]?.intent, why: bots[s]?.rule, pct: Math.round(a.stockMatch?.fighters[s]?.volatility ?? 0), stocks: a.stockMatch?.fighters[s]?.stocks })) };
    });
    shots.push({ png: (await page.screenshot({ type: 'png' })).toString('base64'), info });
    if (info.state === 'finished') break;
    await page.waitForTimeout(every);
  }
  // The sheet: one page of tiles, screenshotted whole.
  const sheet = await browser.newPage({ viewport: { width: cols * 320, height: 200 } });
  const tiles = shots.map(({ png, info }) => `<figure><img src="data:image/png;base64,${png}"><figcaption>t${info.t} | P1 ${info.p[0].mode} ${info.p[0].pct}% x${info.p[0].stocks} | P2 ${info.p[1].mode} ${info.p[1].pct}% x${info.p[1].stocks}</figcaption></figure>`).join('');
  await sheet.setContent(`<style>body{margin:0;background:#111;color:#ddd;font:11px monospace;display:grid;grid-template-columns:repeat(${cols},320px)}figure{margin:0;padding:2px}img{width:316px;display:block}figcaption{padding:2px 0 4px}</style>${tiles}`);
  await sheet.waitForTimeout(300);
  await sheet.screenshot({ path: `${out}/${tag}-sheet.png`, fullPage: true });
  writeFileSync(`${out}/${tag}-frames.json`, JSON.stringify(shots.map(s => s.info), null, 1));
  console.log(`wrote ${out}/${tag}-sheet.png (${shots.length} frames)${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`);
} finally { await browser.close(); }

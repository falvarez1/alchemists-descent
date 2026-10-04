// Duel look captures for the concept comparison loop (docs/arena/platform-fighter/IMPLEMENTATION-PLAN.md, "Visual dogfood").
// Enters a stock match through the real lobby (two CPU seats), lets it play, then freezes the stock camera rig at the
// concept framings: CLOSE (camera-direction.png panel 1), MID (foundry-match.png) and WIDE (camera-direction.png panel 2).
// Usage: node scripts/shot-duel.mjs [url] [--stage foundry] [--p1 ilyra-voss] [--p2 brann-rook] [--out verify-out/duel]
//        [--live 4000] [--tag name]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://127.0.0.1:5241/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const stage = opt('stage', 'foundry'), p1 = opt('p1', 'ilyra-voss'), p2 = opt('p2', 'brann-rook');
const out = opt('out', 'verify-out/duel'), live = Number(opt('live', '4000')), tag = opt('tag', `${stage}-${p1}-${p2}`);
const shots = (opt('shots', 'live,close,mid,wide')).split(',');
mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  await page.locator('[data-entry="duel"]').click();
  await page.locator('#versus-lobby').waitFor({ state: 'visible' });
  await page.evaluate(({ stage, p1, p2 }) => {
    const v = window.__game.ctx.versus;
    v.chooseDevice(0, 'cpu'); v.chooseDevice(1, 'cpu');
    v.chooseFighter(0, p1); v.chooseFighter(1, p2); v.chooseStage?.(stage);
  }, { stage, p1, p2 });
  await page.evaluate(() => window.__game.ctx.versus.start());
  await page.waitForFunction(() => window.__game.ctx.arena?.stockMatch?.state === 'fighting', null, { timeout: 30000 });
  // Dismiss anything that is not the match itself.
  if (await page.locator('.controller-notice button').count()) await page.locator('.controller-notice button').click().catch(() => {});
  if (shots.includes('live')) {
    await page.waitForTimeout(live);
    await page.screenshot({ path: `${out}/${tag}-live.png` });
  }
  // Staged frames: bots off, both bodies placed and stepped until every commitment (attack, dodge, launch) has ended.
  await page.evaluate(async () => {
    const c = window.__game.ctx; await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
    c.projectiles.length = 0;
  });
  // The camera is the game's own: the rig settles on the placed fighters exactly as it would in play (no forced zoom).
  const stageShot = async (name, spread, air = 0) => {
    await page.evaluate(({ spread, air }) => {
      const g = window.__game, c = g.ctx, a = c.arena, st = a.stockStage;
      const y = st.main.y - 1, cx = st.center.x;
      const bodies = [{ x: Math.round(cx - spread), y, facing: 1 }, { x: Math.round(cx + spread), y: y - air, facing: -1 }];
      const place = () => bodies.forEach((b, slot) => Object.assign(a.bundle(slot).player, b, { vx: 0, vy: 0, fx: 0, fy: 0, invuln: 0, dead: false, staggerT: 0, firing: false }));
      place();
      for (let i = 0; i < 90; i++) { g.tick(true, { forcePaused: true }); if (i % 10 === 0) place(); }
      place();
      c.state.paused = true; c.projectiles.length = 0;
      for (let i = 0; i < 600; i++) c.camera.update(c);
      g.composer.capturePoses(c); g.composeDirty = true;
    }, { spread, air });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: `${out}/${tag}-${name}.png` });
  };
  if (shots.includes('close')) await stageShot('close', 16);
  if (shots.includes('mid')) await stageShot('mid', 70);
  if (shots.includes('wide')) await stageShot('wide', 235);
  console.log(JSON.stringify({ tag, errors }));
} finally { await browser.close(); }

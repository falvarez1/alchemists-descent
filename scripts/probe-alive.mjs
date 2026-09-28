// Alive-world probe: creatures crossing sand, snow, grass, blood and water under
// hanging vines, among loose debris and critters. Captures frames plus counts of
// what the world recorded (snow prints, stained cells, displaced sand).
// Usage: node scripts/probe-alive.mjs [url] [--kinds golem,spitter,weaver,slime]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const kinds = opt('kinds', 'golem,spitter,weaver,slime').split(',');
const zoom = Number(opt('zoom', '1.8')), focusDx = Number(opt('focus', '-70'));
const out = 'verify-out/alive'; mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, `run test --level ${opt('level', 'physics-test')} --world campaign-level --seed 777 --loadout fresh`);
  await waitForRunReady(page); await page.waitForTimeout(3200); // let the settled findability repair run before we carve
  await page.evaluate(([z, f]) => { window.__zoom = z; window.__focusDx = f; }, [zoom, focusDx]);
  const setup = await page.evaluate((kinds) => {
    const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
    ctx.enemies.length = 0;
    if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0; // parked: the arena is ours
    const cx = Math.max(260, Math.min(w.width - 260, Math.floor(p.x))), floor = Math.max(170, Math.min(w.height - 30, Math.floor(p.y)));
    const set = (x, y, t, c) => { if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), t, c); };
    for (let y = floor - 120; y <= floor + 10; y++) for (let x = cx - 220; x <= cx + 220; x++) {
      const wall = y > floor || y < floor - 114 || x < cx - 212 || x > cx + 212;
      set(x, y, wall ? 12 : 0, wall ? 0x565d63 + ((x + y) % 3) * 0x040404 : 0);
    }
    // Floor dressing, in walking order: sand, snow, blood, grass; a pool past the wizard.
    for (let x = cx - 180; x < cx - 140; x++) for (let y = floor - 2; y <= floor; y++) set(x, y, 1, 0xc2a060);
    for (let x = cx - 130; x < cx - 90; x++) for (let y = floor - 2; y <= floor; y++) set(x, y, 27, 0xe8f0f4);
    for (let x = cx - 80; x < cx - 60; x++) set(x, floor, 18, 0x7a1010);
    for (let x = cx - 50; x < cx - 10; x++) { set(x, floor, 12, 0x565d63); set(x, floor - 1, 37, 0x3a7a30); }
    for (let x = cx + 60; x < cx + 180; x++) for (let y = floor - 12; y <= floor + 8; y++) set(x, y, y > floor ? 12 : 2, y > floor ? 0x565d63 : 0x2a5f8a);
    for (let y = floor - 12; y <= floor; y++) { set(cx + 59, y, 12, 0x565d63); set(cx + 180, y, 12, 0x565d63); }
    // Hanging vines from the ceiling.
    for (const vx of [cx - 150, cx - 90, cx - 30, cx + 40]) for (let y = floor - 113; y < floor - 70; y++) set(vx, y, 15, 0x2e6a2a);
    // Loose debris to kick.
    if (ctx.rigidBodies?.spawn) for (let k = 0; k < 6; k++) ctx.rigidBodies.spawn({ kind: 'box', halfW: 1.6, halfH: 0.6 }, cx - 170 + k * 45, floor - 2, { density: 0.6, color: 0xcfc6ad, tag: 'probe-bone' });
    for (let k = 0; k < 8; k++) ctx.critters.spawn(k % 2 ? 'beetle' : 'fly', cx - 160 + k * 40, floor - (k % 2 ? 1 : 8));
    for (let k = 0; k < 4; k++) ctx.critters.spawn('fish', cx + 110 + k * 18, floor - 5);
    p.x = cx - 60; p.y = floor; p.hp = p.maxHp = 9999;
    const list = window.__noEnemies ? [] : kinds.map((k, i) => ctx.enemyCtl.spawn(k, cx - 196 + i * 16, floor - 14));
    for (const e of list) if (e) { e.alerted = true; if (e.mind) { e.mind.confidence = 1; e.mind.visible = true; e.mind.intent = 'hunt'; e.mind.targetX = p.x; e.mind.targetY = p.y; } }
    ctx.camera.zoomLock = window.__zoom; ctx.camera.actionFocus = { x: cx + window.__focusDx, y: floor - 20, zoom: window.__zoom };
    const snowCount = () => { let n = 0; for (let x = cx - 130; x < cx - 90; x++) for (let y = floor - 2; y <= floor; y++) if (w.types[w.idx(x, y)] === 27) n++; return n; };
    window.__alive = { cx, floor, snow0: snowCount(), snowCount };
    return { cx, floor, n: list.filter(Boolean).length, cellGrass: 36 };
  }, kinds);
  await page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/frame-start.png` });
  for (let f = 0; f < 4; f++) {
    await page.waitForTimeout(1400);
    await page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/frame-${f}.png` });
  }
  const stats = await page.evaluate(() => {
    const ctx = window.__game.ctx, a = window.__alive;
    return { snowBefore: a.snow0, snowAfter: a.snowCount(), enemies: ctx.enemies.map(e => ({ k: e.kind, x: e.x, y: e.y })), particles: ctx.particles.list?.length };
  });
  writeFileSync(`${out}/probe.json`, JSON.stringify({ setup, stats, errors }, null, 1));
  console.log(JSON.stringify({ setup, stats, errors }));
} finally { await browser.close(); }

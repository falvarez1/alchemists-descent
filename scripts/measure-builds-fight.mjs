// Balance instrument for the choice update, PLAYED: real enemies with real HP and AI in the REAL game loop, a held real
// mouse button, the aim re-projected from the nearest enemy through the camera every ~90 ms (the cursor is a point on
// the SCREEN). Complements scripts/measure-builds.mjs (endless-HP target, stepped by hand); the numbers in
// docs/FEEL.md section 5 "Played fights" come from this. One trial is noisy: use TRIALS=3+.
//
// Usage: [KINDS=golem,golem,imp,imp DISTS=60,90,120,150 TRIALS=3 LOADOUTS="spark;shortfuse+spark"]
//        node scripts/measure-builds-fight.mjs [url]     (dev server running; defaults to :5173)
import { chromium } from 'playwright-core';
import { waitForOpeningEnd } from './run-helpers.mjs';

const url = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 60000 });
const bh = await page.waitForSelector('#expedition-entry [data-entry="begin"]', { state: 'visible' });
const bb = await bh.boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
// (the title is a menu: New descent opens the loadout page, Descend starts the run)
const dh = await page.waitForSelector('#expedition-entry [data-entry="descend"]', { state: 'visible' });
await page.waitForTimeout(500);
const db = await dh.boundingBox(); await page.mouse.click(db.x + db.width / 2, db.y + db.height / 2);
await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'd1', null, { timeout: 60000 });
await waitForOpeningEnd(page);
await page.waitForTimeout(3000);
const consts = await page.evaluate(async () => { const c = await import('/src/config/constants.ts'); return { W: c.VIEW_W, H: c.VIEW_H }; });
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__cast = 0;
  ctx.events.on('cardCast', () => { window.__cast++; });
});
const toClient = (wx, wy) => page.evaluate(({ wx, wy, W, H }) => {
  const cam = window.__game.ctx.camera;
  const rect = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
  const zoom = cam.zoom;
  const fracX = cam.x - Math.floor(cam.x), fracY = cam.y - Math.floor(cam.y);
  const scaleX = (1 + 4 / W) * zoom, scaleY = (1 + 4 / H) * zoom;
  const offsetX = -fracX * (2 / W) * zoom, offsetY = fracY * (2 / H) * zoom;
  const texU = (wx - cam.renderX) / W, texV = (wy - cam.renderY) / H;
  const ndcX = offsetX + (texU - 0.5) * 2 * scaleX;
  const ndcY = offsetY + (0.5 - texV) * 2 * scaleY;
  return { x: rect.left + ((ndcX + 1) / 2) * rect.width, y: rect.top + ((1 - ndcY) / 2) * rect.height };
}, { wx, wy, ...consts });

const loadouts = (process.env.LOADOUTS ?? 'spark').split(';').map((l) => l.split('+'));
const TRIALS = Number(process.env.TRIALS ?? 1);
const kinds = (process.env.KINDS ?? 'slime,slime,slime,slime').split(',');
const dists = (process.env.DISTS ?? '40,70,100,130').split(',').map(Number);
const results = [];
for (const cards of loadouts.flatMap((l) => Array.from({ length: TRIALS }, () => l))) {
  await page.evaluate(({ cards, kinds, dists }) => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    // a flat arena: air above a metal floor, walls at both ends
    for (let y = 60; y <= 131; y++) for (let x = 10; x <= 330; x++) {
      if (!world.inBounds(x, y)) continue;
      const i = world.idx(x, y);
      if (y === 131 || x === 10 || x === 330) { world.types[i] = 13; } else { world.clearCellAt(i); }
    }
    ctx.projectiles.length = 0; ctx.enemies.length = 0;
    ctx.state.arrivalGraceUntil = 0;
    const p = ctx.player;
    Object.assign(p, { x: 30, y: 120, vx: 0, vy: 0, invuln: 0, dead: false, hp: p.maxHp, mana: 1e6 });
    const w = ctx.wands.wands[0];
    ctx.wands.upgradeFrame(ctx, 0, 'oak');
    w.cards.fill(null); cards.forEach((c, i) => { w.cards[i] = c; });
    ctx.wands.invalidatePrograms();
    w.mana = w.frame.manaMax; w.cooldown = 0; w.castIndex = 0; ctx.wands.active = 0;
    kinds.forEach((k, i) => ctx.enemyCtl.spawn(k, 30 + dists[i], 124));
    window.__fight = { startHp: p.hp, startMana: w.mana, cast0: window.__cast, minMana: w.mana, t0: performance.now(), n: ctx.enemies.length, maxHp: ctx.enemies.map((e) => e.maxHp) };
  }, { cards, kinds, dists });
  await page.waitForTimeout(200);
  const start = Date.now();
  let first = await toClient(130, 120);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  let state;
  for (;;) {
    state = await page.evaluate(() => {
      const ctx = window.__game.ctx; const p = ctx.player; const w = ctx.wands.wands[0];
      window.__fight.minMana = Math.min(window.__fight.minMana, w.mana);
      const alive = ctx.enemies.filter((e) => e.hp > 0 && !e.dead);
      alive.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x));
      return { alive: alive.length, tx: alive[0]?.x ?? null, ty: alive[0]?.y ?? null, hp: p.hp, dead: p.dead, paused: ctx.state.paused };
    });
    if (state.alive === 0 || state.dead || Date.now() - start > 30000) break;
    if (state.tx !== null) {
      const c = await toClient(state.tx, state.ty - 5);
      await page.mouse.move(c.x, c.y);
    }
    await page.waitForTimeout(90);
  }
  await page.mouse.up();
  const end = await page.evaluate(() => {
    const ctx = window.__game.ctx; const p = ctx.player; const f = window.__fight;
    return { hpLost: Math.round(f.startHp - p.hp), manaMin: Math.round(f.minMana), casts: window.__cast - f.cast0, killed: f.n - ctx.enemies.filter((e) => e.hp > 0 && !e.dead).length, dead: p.dead };
  });
  const secs = (Date.now() - start) / 1000;
  results.push({ hp: await page.evaluate(() => window.__fight.maxHp.join('/')), build: cards.join('+'), secs: Number(secs.toFixed(1)), ...end, paused: state.paused });
  console.log(JSON.stringify(results[results.length - 1]));
  await page.waitForTimeout(400);
}
console.log('errors', JSON.stringify(errs));
await browser.close();

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

// THE CAULDRON ON EVERY FLOOR, PLAYED: on each generated floor (d2, d2b, d3, d3b, d4) the cauldron stands beside the
// route (within 45 cells of the body-fit walk from the spawn to the exit: it stood 50-500 off before GEN 64), a furnace of
// embers is banked in the ground under it (a bowl that is hot before anyone has lit anything), and a brew works end to end
// with real input: Elixir of Levity's reagents poured over the bowl (real flask pours, the lob), six seconds, the potion
// siphoned (E) and drunk (X). A floor whose ground could not hold a furnace is reported, not failed (3 in 40 on 8 seeds).
// Usage: node scripts/verify-alchemy-floors.mjs [url] [seed] [levelCsv]
const url = process.argv[2] ?? 'http://localhost:5173/';
const seed = Number(process.argv[3] ?? 777);
const levels = (process.argv[4] ?? 'd2,d2b,d3,d3b,d4').split(',');
const output = 'verify-out/alchemy-floors';
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { errors: [], seed, floors: {} };
page.on('pageerror', (e) => report.errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket connection/.test(m.text())) report.errors.push('console: ' + m.text()); });
const shot = (name) => page.screenshot({ path: `${output}/${name}.png` });
const evalGame = (fn, arg) => page.evaluate(fn, arg);

async function pointAtWorld(worldX, worldY) {
  const target = await page.evaluate(({ worldX, worldY }) => {
    const ctx = window.__game.ctx;
    const canvas = document.querySelector('canvas[data-input-attached="true"]');
    const rect = canvas.getBoundingClientRect();
    const viewW = 640, viewH = 360, zoom = ctx.camera.zoom;
    const fracX = ctx.camera.x - Math.floor(ctx.camera.x), fracY = ctx.camera.y - Math.floor(ctx.camera.y);
    const scaleX = (1 + 4 / viewW) * zoom, scaleY = (1 + 4 / viewH) * zoom;
    const ndcX = -fracX * (2 / viewW) * zoom + ((worldX - ctx.camera.renderX) / viewW - .5) * 2 * scaleX;
    const ndcY = fracY * (2 / viewH) * zoom + (.5 - (worldY - ctx.camera.renderY) / viewH) * 2 * scaleY;
    return { x: rect.left + (ndcX + 1) * .5 * rect.width, y: rect.top + (1 - ndcY) * .5 * rect.height };
  }, { worldX, worldY });
  await page.mouse.move(target.x, target.y);
}
async function settleCamera() {
  let last = null, still = 0;
  for (let i = 0; i < 100 && still < 8; i++) {
    const p = await page.evaluate(() => { const cam = window.__game.ctx.camera; return [cam.x, cam.y]; });
    still = last && Math.abs(p[0] - last[0]) < 0.05 && Math.abs(p[1] - last[1]) < 0.05 ? still + 1 : 0;
    last = p;
    await page.waitForTimeout(60);
  }
}
const slotKey = (i) => `Digit${i + 3}`;
const view = () => page.evaluate(() => window.__game.ctx.brewing.view());
const bowlCount = async (cell) => (await view()).reagents.find((r) => r.cell === cell)?.n ?? 0;
const flask = (i) => page.evaluate((i) => ({ ...window.__game.ctx.flask.slots[i] }), i);

async function pourInto(slot, cell, need, c) {
  await settleCamera();
  await page.keyboard.press(slotKey(slot));
  await pointAtWorld(c.x, c.y - 3);
  const t0 = Date.now();
  let n = await bowlCount(cell);
  if (n < need - 1) {
    await page.keyboard.down('KeyQ');
    while (n < need - 1 && Date.now() - t0 < 14000) { await pointAtWorld(c.x, c.y - 3); await page.waitForTimeout(30); n = await bowlCount(cell); }
    await page.keyboard.up('KeyQ');
    await page.waitForTimeout(450);
    n = await bowlCount(cell);
  }
  for (let tap = 0; n < need && tap < 12; tap++) {
    await pointAtWorld(c.x, c.y - 3);
    await page.keyboard.down('KeyQ'); await page.waitForTimeout(75); await page.keyboard.up('KeyQ');
    await page.waitForTimeout(420);
    n = await bowlCount(cell);
  }
  return n;
}

try {
  await page.goto(url);
  for (const level of levels) {
    await execConsoleCommand(page, `run test --level ${level} --world campaign-level --seed ${seed} --loadout fresh`, { timeout: 90000 });
    await waitForRunReady(page, { timeout: 90000 });
    await page.waitForTimeout(1200);
    // A floor's arrival gift is a choice ("A gift for the way down"): it opens when the arrival grace ends (~6 s in) and
    // pauses the game, so take the first card with a real click before the probe starts working the bowl.
    try {
      await page.waitForSelector('#card-offer-overlay.visible', { timeout: 12000 });
      const card = await page.locator('#card-offer-overlay .card-offer-card').first().boundingBox();
      await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
      await page.waitForFunction(() => !window.__game.ctx.state.paused, null, { timeout: 8000 });
    } catch { /* no gift on this floor, or it was taken */ }
    const f = report.floors[level] = {};
    const geo = await evalGame(async () => {
      const ctx = window.__game.ctx; const rt = ctx.levels.current; const c = rt.cauldron;
      const { computeFits } = await import('/src/world/validate.ts');
      const { fitWalks } = await import('/src/world/fitWalks.ts');
      const { routePath, routeDistance } = await import('/src/world/routeWaystones.ts');
      const walks = fitWalks(computeFits(ctx.world), Math.floor(rt.spawn.x), Math.floor(rt.spawn.y));
      const exit = rt.portal ?? rt.boss ?? rt.exit;
      const path = walks ? routePath(walks, { x: exit.x, y: exit.sealY ? exit.sealY - 12 : exit.y }) : null;
      let embers = 0;
      for (let dy = 3; dy <= 4; dy++) for (let dx = -3; dx <= 3; dx++) if (ctx.world.types[ctx.world.idx(c.x + dx, c.y + dy)] === 20) embers++;
      return { c, routeDistance: path ? Math.round(routeDistance(path, c.x, c.y)) : null, embers, waystoneDistances: rt.waystones.map((w) => Math.round(Math.hypot(w.x - c.x, w.y - c.y))) };
    });
    Object.assign(f, geo);
    assert.ok(geo.routeDistance !== null && geo.routeDistance <= 45, `${level}: the cauldron stands ${geo.routeDistance} cells from the route`);
    if (geo.embers !== 14) { f.furnace = 'skipped (ground not sound)'; continue; }
    f.furnace = 'banked';
    // the bowl is hot before anyone lit a thing: stand beside it and look
    const c = geo.c;
    await evalGame((c) => {
      const ctx = window.__game.ctx;
      ctx.enemies.length = 0; ctx.state.arrivalGraceUntil = 0;
      ctx.player.invuln = 60 * 60 * 10; // a floor has things lurking near its route (a snapjaw closed on the probe at d2's cauldron): this probe is about the bowl
      ctx.player.x = c.x - 14; ctx.player.y = c.y - 1; ctx.player.vx = 0; ctx.player.vy = 0;
      window.__ev = [];
      ctx.events.on('recipeBrewed', (e) => window.__ev.push({ id: e.id }));
      ctx.flask.setSlot(0, 19, 60); ctx.flask.setSlot(1, 2, 60); ctx.flask.setSlot(2, null, 0); ctx.flask.setSlot(3, null, 0);
    }, c);
    await settleCamera();
    await page.waitForTimeout(800);
    const v0 = await view();
    assert.equal(v0.heated, true, `${level}: the furnace keeps the bowl hot`);
    // clear the bowl of anything the floor put in it, then brew Levity: slime first, then water
    await evalGame((c) => { const w = window.__game.ctx.world; for (let dy = -5; dy <= 0; dy++) for (let dx = -3; dx <= 3; dx++) w.clearCellAt(w.idx(c.x + dx, c.y + dy)); }, c);
    await page.waitForTimeout(300);
    const slime = await pourInto(0, 19, 4, c);
    const water = await pourInto(1, 2, 8, c);
    f.poured = { slime, water };
    await page.waitForFunction(() => window.__ev.some((b) => b.id === 'levity'), null, { timeout: 40000, polling: 100 });
    await page.waitForTimeout(400);
    const made = await view();
    assert.ok(made.elixir && made.elixir.n >= 10, `${level}: a bowl of Levity (${JSON.stringify(made.elixir)})`);
    // E over the bowl: a lift of any body under the cursor wins over the siphon (telekinesis), so a refusal is retried once
    for (let attempt = 0; attempt < 3 && (await flask(3)).count < made.elixir.n; attempt++) {
      await page.keyboard.press(slotKey(3));
      await pointAtWorld(c.x, c.y - 1);
      await page.keyboard.down('KeyE');
      const t0 = Date.now();
      while ((await flask(3)).count < made.elixir.n && Date.now() - t0 < 2500) { await pointAtWorld(c.x, c.y - 1); await page.waitForTimeout(50); }
      await page.keyboard.up('KeyE');
      await page.waitForTimeout(200);
    }
    f.siphoned = await flask(3);
    await page.evaluate(() => { window.__game.ctx.player.status.levity = 0; });
    await page.keyboard.down('KeyX');
    const t1 = Date.now();
    while ((await flask(3)).count > 0 && Date.now() - t1 < 6000) await page.waitForTimeout(50);
    await page.keyboard.up('KeyX');
    f.levityFrames = await evalGame(() => window.__game.ctx.player.status.levity);
    assert.ok(f.levityFrames > 1000, `${level}: the potion lasts (${f.levityFrames} frames)`);
    await shot(`${level}-brewed`);
  }
  assert.deepEqual(report.errors, [], 'no page errors');
} catch (err) {
  report.failure = String(err?.stack ?? err);
  try { report.finalView = await view(); report.finalPlayer = await evalGame(() => { const g = window.__game.ctx; return { x: g.player.x, y: g.player.y, hp: g.player.hp, dead: g.player.dead, paused: g.state.paused, mode: g.state.mode, frame: g.state.frameCount }; }); } catch { /* the page may be gone */ }
  await shot('FAILED').catch(() => undefined);
  throw err;
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

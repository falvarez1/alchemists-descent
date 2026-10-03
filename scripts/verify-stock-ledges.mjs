import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5217/';
const out = 'docs/arena/platform-fighter/evidence';
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  await leaveTitleIfShown(page); await waitForConsoleApi(page);
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('run test --level fighter-duel --world campaign-level');
    c.fighters.equip('ilyra-voss'); await c.fighters.whenReady();
  });
  await page.getByRole('combobox', { name: 'Match rules', exact: true }).selectOption('stocks');
  await page.getByRole('button', { name: 'Add rival', exact: true }).click();
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
    c.state.paused = true; document.activeElement?.blur(); document.getElementById('fighter-arena').classList.add('collapsed');
  });
  const mechanics = await page.evaluate(async () => {
    const { PLAYER_H, PLAYER_HALF_W } = await import('/src/core/types.ts');
    const { STOCK_STAGE: S } = await import('/src/config/stockStage.ts');
    const g = window.__game, c = g.ctx, a = c.arena, p = c.player;
    const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
    const fresh = side => {
      a.reset(); step(125);
      Object.assign(p, { x: side > 0 ? S.main.x0 - PLAYER_HALF_W - 2 : S.main.x1 + PLAYER_HALF_W + 2, y: S.main.y + PLAYER_H - 2, vx: side, vy: 1, fx: 0, fy: 0, grounded: false, invuln: 0 });
      c.input.keys.right = side > 0; c.input.keys.left = side < 0; step(1);
    };
    const climbs = [];
    for (const side of [1, -1]) {
      fresh(side); const catchPhase = a.stockLedge(0).phase;
      const before = a.stockMatch.fighters[0].volatility; c.playerCtl.damage(20, 3, 0, 'fighter');
      const protectedDamage = a.stockMatch.fighters[0].volatility - before;
      c.input.keys.up = true; let clear = true;
      for (let i = 0; i < 24; i++) { step(1); clear &&= c.physics.entityFree(p.x, p.y, PLAYER_HALF_W, PLAYER_H); }
      climbs.push({ side, catchPhase, protectedDamage, clear, grounded: p.grounded, x: p.x, y: p.y, phase: a.stockLedge(0).phase });
    }
    fresh(1); step(9); p.invuln = 0; c.playerCtl.damage(20, -3, -1, 'fighter');
    const punished = { volatility: a.stockMatch.fighters[0].volatility, phase: a.stockLedge(0).phase };
    fresh(1); c.input.keys.down = true; step(1); c.input.keys.down = false;
    const drop = { phase: a.stockLedge(0).phase, ready: a.stockLedge(0).airReady, vx: p.vx };
    step(2); const regrabbed = a.stockLedge(0).busy;
    fresh(1); const edge = c.world.idx(S.main.x0, S.main.y), color = c.world.colors[edge]; c.world.clearCellAt(edge); step(1);
    const destroyed = a.stockLedge(0).phase; c.world.replaceCellAt(edge, 13, color);
    a.reset(); step(125); Object.assign(p, { x: S.center.x, y: S.main.y - 45, grounded: false, vx: 0, vy: 1, fx: 0, fy: 0 });
    c.input.keys.down = true; c.input.keys.right = true; step(2);
    const fastFall = { active: p.stockFastFall, dive: p.diveT, vy: p.vy, vx: p.vx };
    c.input.keys.down = false; step(20); const landed = { grounded: p.grounded, active: p.stockFastFall, dive: p.diveT };
    return { climbs, punished, drop, regrabbed, destroyed, fastFall, landed, main: S.main };
  });
  console.log(JSON.stringify(mechanics, null, 2));
  for (const c of mechanics.climbs) {
    assert.equal(c.catchPhase, 'hang'); assert.equal(c.protectedDamage, 0); assert.ok(c.clear);
    assert.equal(c.grounded, true); assert.equal(c.y, mechanics.main.y - 1); assert.equal(c.phase, 'idle');
  }
  assert.ok(mechanics.punished.volatility > 0); assert.equal(mechanics.punished.phase, 'idle');
  assert.equal(mechanics.drop.phase, 'idle'); assert.equal(mechanics.drop.ready, false); assert.ok(mechanics.drop.vx < 0);
  assert.equal(mechanics.regrabbed, false); assert.equal(mechanics.destroyed, 'idle');
  assert.equal(mechanics.fastFall.dive, 0, 'Stock fast fall must not trigger the campaign dive slam');
  assert.equal(mechanics.fastFall.active, true); assert.ok(mechanics.fastFall.vy >= 6); assert.ok(mechanics.fastFall.vx > 0);
  assert.equal(mechanics.landed.active, false); assert.equal(mechanics.landed.dive, 0);
  // Exercise the real keyboard after placing the body beside the collision corner.
  await page.evaluate(async () => {
    const c = window.__game.ctx, g = window.__game, { PLAYER_H, PLAYER_HALF_W } = await import('/src/core/types.ts');
    const { STOCK_STAGE: S } = await import('/src/config/stockStage.ts');
    c.arena.reset(); for (let i = 0; i < 125; i++) g.tick(false, { forcePaused: true });
    Object.assign(c.player, { x: S.main.x0 - PLAYER_HALF_W - 2, y: S.main.y + PLAYER_H - 2, vx: 0, vy: 0, fx: 0, fy: 0, grounded: false });
    c.state.paused = false;
  });
  await page.keyboard.down('d');
  await page.waitForFunction(() => window.__game.ctx.arena.stockLedge(0).phase === 'hang');
  const keyboard = await page.evaluate(() => { const c = window.__game.ctx; c.state.paused = true; return { phase: c.arena.stockLedge(0).phase, x: c.player.x, y: c.player.y }; });
  await page.keyboard.up('d');
  const gallery = [];
  for (const fighter of ['ilyra-voss', 'brann-rook', 'mara-quell']) {
    await page.evaluate(async fighter => { const c = window.__game.ctx; c.fighters.equip(fighter); await c.fighters.whenReady(); }, fighter);
    for (const action of ['ledge-catch', 'ledge-climb', 'ledge-drop', 'fast-fall']) {
      await page.evaluate(async action => {
        const { PLAYER_H, PLAYER_HALF_W } = await import('/src/core/types.ts');
    const { STOCK_STAGE: S } = await import('/src/config/stockStage.ts');
        const g = window.__game, c = g.ctx, p = c.player;
        const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
        c.arena.reset(); step(125);
        Object.assign(p, { x: action === 'fast-fall' ? S.center.x : S.main.x0 - PLAYER_HALF_W - 2, y: action === 'fast-fall' ? S.main.y - 70 : S.main.y + PLAYER_H - 2,
          vx: 0, vy: 1, fx: 0, fy: 0, grounded: false, invuln: 0, facing: 1 });
        c.input.keys.right = true;
        if (action === 'fast-fall') { c.input.keys.down = true; step(3); }
        else {
          step(1);
          if (action === 'ledge-climb') { c.input.keys.up = true; step(10); }
          if (action === 'ledge-drop') { c.input.keys.down = true; step(1); c.input.keys.down = false; c.input.keys.right = false; step(2); }
        }
      }, action);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const clip = await page.evaluate(() => {
        const c = window.__game.ctx, box = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
        const cam=c.camera, scale=cam.viewScale??1, zoom=cam.zoom*scale;
        const sx=box.x+box.width*(.5+((c.player.x-cam.renderX)/(640*scale)-.5)*(1+4/640)*zoom-(cam.presentationX-cam.renderX)/640/scale*zoom);
        const sy=box.y+box.height*(.5+((c.player.y-cam.renderY)/(360*scale)-.5)*(1+4/360)*zoom-(cam.presentationY-cam.renderY)/360/scale*zoom);
        return { x: Math.max(0,Math.min(1100,Math.round(sx-70))), y: Math.max(0,Math.min(575,Math.round(sy-90))), width: 180, height: 145 };
      });
      const file = `${fighter}-${action}.png`; await page.screenshot({ path: `${out}/${file}`, clip }); gallery.push({ fighter, action, file });
    }
  }
  await page.screenshot({ path: `${out}/stock-ledge-match.png` });
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/stock-ledges.json`, JSON.stringify({ mechanics, keyboard, gallery, errors }, null, 2));
} finally { await browser.close(); }

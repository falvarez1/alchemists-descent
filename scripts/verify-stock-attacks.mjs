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
  page.on('pageerror', error => errors.push(String(error)));
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
    const g = window.__game, c = g.ctx;
    await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
    document.activeElement?.blur(); document.getElementById('fighter-arena').classList.add('collapsed');
    c.state.paused = true; c.arena.reset();
    for (let i = 0; i < 125; i++) g.tick(false, { forcePaused: true });
    c.state.paused = false;
  });
  // The actual keyboard binding must enter the same action path as the controller and CPU.
  await page.keyboard.down('s'); await page.keyboard.press('f');
  const keyboard = await page.evaluate(() => {
    const c = window.__game.ctx; c.state.paused = true;
    return { kind: c.arena.stockAttack(0).kind, phase: c.arena.stockAttack(0).phase, locked: c.arena.isActionLocked(0) };
  });
  await page.keyboard.up('s');
  assert.equal(keyboard.kind, 'finisher'); assert.equal(keyboard.locked, true);
  const mechanics = await page.evaluate(() => {
    const g = window.__game, c = g.ctx, a = c.arena, p = c.player, rival = a.bundle(1).player;
    const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
    const fresh = () => {
      a.reset(); step(125);
      Object.assign(p, { x: 760, y: 609, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, facing: 1, invuln: 0 });
      Object.assign(rival, { x: 777, y: 609, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, facing: -1, invuln: 0 });
      c.fx.hitstop = 0;
    };
    fresh(); c.playerCtl.kick(c); step(3);
    const beforeActive = a.stockMatch.fighters[1].volatility;
    step(1); const contact = a.stockMatch.fighters[1].volatility, hp = rival.hp;
    step(5); const afterSwing = a.stockMatch.fighters[1].volatility;
    fresh(); rival.x = 950; c.input.keys.down = true; c.playerCtl.kick(c);
    const spec = a.stockAttack(0).spec;
    step(spec.startup + spec.active + 1);
    const lag = a.stockAttack(0).phase, previousId = a.stockAttack(0).id;
    c.input.queuedDodge = true; c.playerCtl.kick(c); c.player.firing = c.player.firePressed = true;
    const flaskBefore = c.flask.slots.reduce((sum, slot) => sum + slot.count, 0);
    c.input.pourHeld = true; c.flask.throwFlask(c); c.fighters.press('tactical'); step(2); c.input.pourHeld = false;
    const locked = { dodge: a.stockDodge(0).busy, id: a.stockAttack(0).id, previousId, projectiles: c.projectiles.length,
      spent: flaskBefore - c.flask.slots.reduce((sum, slot) => sum + slot.count, 0) };
    p.invuln = 0; c.playerCtl.damage(20, 2, -1, 'fighter');
    const punished = { damage: a.stockMatch.fighters[0].volatility, busy: a.stockAttack(0).busy };
    fresh();
    for (let y = 578; y < 610; y++) c.world.replaceCellAt(c.world.idx(769, y), 13, 0x665544);
    c.playerCtl.kick(c); step(10); const wallDamage = a.stockMatch.fighters[1].volatility;
    for (let y = 578; y < 610; y++) c.world.clearCellAt(c.world.idx(769, y));
    fresh(); rival.x = 950; Object.assign(p, { y: 570, grounded: false });
    c.input.keys.jump = true; c.playerCtl.kick(c); step(1);
    const aerial = { kind: a.stockAttack(0).kind, jumpHeld: c.input.keys.jump, recovering: a.isRecovering(0) };
    return { beforeActive, contact, afterSwing, hp, maxHp: rival.maxHp, lag, locked, punished, wallDamage, aerial };
  });
  console.log(JSON.stringify({ keyboard, mechanics }, null, 2));
  assert.equal(mechanics.beforeActive, 0); assert.ok(mechanics.contact > 0);
  assert.equal(mechanics.afterSwing, mechanics.contact); assert.equal(mechanics.hp, mechanics.maxHp);
  assert.equal(mechanics.lag, 'recovery'); assert.equal(mechanics.locked.dodge, false);
  assert.equal(mechanics.locked.id, mechanics.locked.previousId); assert.equal(mechanics.locked.projectiles, 0);
  assert.equal(mechanics.locked.spent, 0); assert.ok(mechanics.punished.damage > 0); assert.equal(mechanics.punished.busy, false);
  assert.equal(mechanics.wallDamage, 0); assert.equal(mechanics.aerial.kind, 'aerial');
  assert.equal(mechanics.aerial.jumpHeld, true); assert.equal(mechanics.aerial.recovering, false);
  const gallery = [];
  for (const fighter of ['ilyra-voss', 'brann-rook', 'mara-quell']) {
    await page.evaluate(async fighter => { const c = window.__game.ctx; c.fighters.equip(fighter); await c.fighters.whenReady(); }, fighter);
    for (const action of ['opener', 'launcher', 'aerial', 'finisher']) for (const phase of ['startup', 'active']) {
      const state = await page.evaluate(({ action, phase }) => {
        const g = window.__game, c = g.ctx, a = c.arena, p = c.player;
        const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
        a.reset(); step(125); c.fx.hitstop = 0;
        Object.assign(p, { x: 750, y: action === 'aerial' ? 555 : 609, vx: 0, vy: 0, fx: 0, fy: 0, grounded: action !== 'aerial', facing: 1, invuln: 0 });
        a.bundle(1).player.x = 950;
        c.input.keys.up = action === 'launcher'; c.input.keys.down = action === 'finisher';
        c.playerCtl.kick(c);
        const spec = a.stockAttack(0).spec;
        step(phase === 'active' ? spec.startup : Math.max(1, Math.floor(spec.startup * .8)));
        return { kind: a.stockAttack(0).kind, phase: a.stockAttack(0).phase };
      }, { action, phase });
      assert.equal(state.kind, action); assert.equal(state.phase, phase);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const clip = await page.evaluate(() => {
        // World-to-screen through the stock camera's zoom (the same mapping verify-stock-camera.mjs checks against the pointer);
        // the crop is a constant 90 x 72 cells of world, so a closer camera gives a larger, sharper crop of the same moment.
        const c = window.__game.ctx, cam = c.camera, box = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
        const scale = cam.viewScale ?? 1, z = cam.zoom * scale;
        const ox = -(cam.presentationX - cam.renderX) * 2 / 640 / scale * z, oy = (cam.presentationY - cam.renderY) * 2 / 360 / scale * z;
        const sx = wx => box.x + box.width * (.5 + ((wx - cam.renderX) / (640 * scale) - .5) * (1 + 4 / 640) * z + ox / 2);
        const sy = wy => box.y + box.height * (.5 + ((wy - cam.renderY) / (360 * scale) - .5) * (1 + 4 / 360) * z - oy / 2);
        const x0 = sx(c.player.x - 35), y0 = sy(c.player.y - 50), x1 = sx(c.player.x + 55), y1 = sy(c.player.y + 22);
        const x = Math.max(box.x, Math.round(x0)), y = Math.max(box.y, Math.round(y0));
        return { x, y, width: Math.round(Math.min(box.x + box.width, x1) - x), height: Math.round(Math.min(box.y + box.height, y1) - y) };
      });
      const file = `${fighter}-${action}-${phase}.png`;
      await page.screenshot({ path: `${out}/${file}`, clip }); gallery.push({ fighter, action, phase, file });
    }
  }
  await page.screenshot({ path: `${out}/stock-melee-match.png` });
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/stock-attacks.json`, JSON.stringify({ keyboard, mechanics, gallery, errors }, null, 2));
} finally { await browser.close(); }

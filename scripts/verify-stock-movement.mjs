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
    const g = window.__game, c = g.ctx;
    await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
    document.activeElement?.blur(); document.getElementById('fighter-arena').classList.add('collapsed');
    c.state.paused = true; c.arena.reset();
    for (let i = 0; i < 125; i++) g.tick(false, { forcePaused: true });
    c.state.paused = false;
  });
  // Real keyboard events enter through InputManager and its rebindable action map.
  await page.keyboard.down('d'); await page.keyboard.press('k');
  await page.waitForTimeout(75);
  const keyboard = await page.evaluate(() => {
    const c = window.__game.ctx; c.state.paused = true;
    return { phase: c.arena.stockDodge(0).phase, x: c.player.x, locked: c.arena.isActionLocked(0), queued: c.input.queuedDodge, stun: c.player.stunT, match: c.arena.stockMatch.state, ownMove: c.fighters.ownsMovement, focused: document.activeElement?.id, keys: c.input.keys };
  });
  await page.keyboard.up('d');
  console.log('Keyboard sample:', keyboard);
  assert.notEqual(keyboard.phase, 'idle', 'K starts the real dodge action');
  assert.ok(keyboard.locked, 'Dodge commits the fighter');
  const mechanics = await page.evaluate(() => {
    const g = window.__game, c = g.ctx, a = c.arena, p = c.player;
    const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
    const fresh = () => { a.reset(); step(125); p.invuln = 0; };
    fresh(); c.input.keys.right = true; c.input.queuedDodge = true;
    step(1); const startup = a.stockDodge(0).phase;
    step(3); const x = p.x;
    const before = a.stockMatch.fighters[0].volatility;
    c.playerCtl.damage(20, 4, 0, 'fighter');
    const evadeDamage = a.stockMatch.fighters[0].volatility - before;
    const projectiles = c.projectiles.length;
    const flaskBefore = c.flask.slots.reduce((total, slot) => total + slot.count, 0);
    c.input.pourHeld = true;
    c.player.firing = true; c.player.firePressed = true; c.playerCtl.kick(c); c.flask.throwFlask(c); c.fighters.press('tactical');
    step(7); const distance = p.x - x;
    const attackProjectiles = c.projectiles.length - projectiles;
    const spentDuringDodge = flaskBefore - c.flask.slots.reduce((total, slot) => total + slot.count, 0);
    c.input.pourHeld = false;
    step(4); const lag = a.stockDodge(0).phase;
    p.invuln = 0; c.playerCtl.damage(20, 0, 0, 'fighter');
    const lagDamage = a.stockMatch.fighters[0].volatility - before;
    fresh(); Object.assign(p, { x: 740, y: 570, vy: 0, grounded: false });
    c.input.keys.right = true; c.input.queuedDodge = true; step(1);
    const airUsed = !a.stockDodge(0).airReady;
    // A real wall must stop the burst rather than tunneling through cells.
    fresh(); Object.assign(p, { x: 750, y: 609, vx: 0, fx: 0 });
    for (let y = 565; y < 610; y++) for (let x = 780; x < 785; x++) c.world.replaceCellAt(c.world.idx(x, y), 13, 0x665544);
    c.input.keys.right = true; c.input.queuedDodge = true; step(20);
    const wallX = p.x;
    for (let y = 565; y < 610; y++) for (let x = 780; x < 785; x++) c.world.clearCellAt(c.world.idx(x, y));
    fresh(); c.input.keys.right = true; c.input.queuedDodge = true; step(6);
    return { startup, evadeDamage, distance, attackProjectiles, spentDuringDodge, lag, lagDamage, airUsed, wallX };
  });
  assert.equal(mechanics.startup, 'startup'); assert.equal(mechanics.evadeDamage, 0);
  assert.ok(mechanics.distance > 25, 'Dodge moves through the real body integration');
  assert.equal(mechanics.attackProjectiles, 0, 'Dodge cannot cast, kick, or throw');
  assert.equal(mechanics.spentDuringDodge, 0, 'Dodge cannot pour offensive material');
  assert.equal(mechanics.lag, 'recovery'); assert.ok(mechanics.lagDamage > 0, 'End lag is punishable');
  assert.ok(mechanics.airUsed); assert.ok(mechanics.wallX < 780, 'Metal wall blocks dodge movement');
  await page.screenshot({ path: `${out}/stock-dodge.png` });
  const gallery = [];
  for (const fighter of ['ilyra-voss', 'brann-rook', 'mara-quell']) {
    await page.evaluate(async fighter => { const c = window.__game.ctx; c.fighters.equip(fighter); await c.fighters.whenReady(); }, fighter);
    for (const action of ['ready', 'ground-dodge', 'air-dodge', 'recover']) {
      await page.evaluate(action => {
        const g = window.__game, c = g.ctx, a = c.arena, p = c.player;
        const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
        a.reset(); step(125); p.invuln = 0;
        if (action === 'air-dodge') Object.assign(p, { x: 750, y: 565, vy: 0, grounded: false, fx: 0, fy: 0 });
        if (action === 'recover') {
          Object.assign(p, { x: 599, y: 650, vx: 0, vy: 1, grounded: false, fx: 0, fy: 0 });
          c.input.keys.up = true; c.input.keys.jump = true; step(6);
        } else if (action !== 'ready') {
          c.input.keys.right = true; c.input.queuedDodge = true; step(6);
        }
      }, action);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const clip = await page.evaluate(() => {
        const c = window.__game.ctx, box = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
        return { x: Math.round(box.x + (c.player.x - c.camera.renderX) / 640 * box.width - 75), y: Math.round(box.y + (c.player.y - c.camera.renderY) / 360 * box.height - 85), width: 150, height: 120 };
      });
      const file = `${fighter}-${action}.png`;
      await page.screenshot({ path: `${out}/${file}`, clip });
      gallery.push({ fighter, action, file });
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/stock-movement.json`, JSON.stringify({ keyboard, mechanics, gallery, errors }, null, 2));
  console.log(JSON.stringify({ keyboard, mechanics }, null, 2));
} finally { await browser.close(); }

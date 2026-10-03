import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';
const browser = await launchBrowser(), errors = [], out = 'docs/arena/platform-fighter/evidence';
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5217/') + '?link=off', { waitUntil: 'networkidle' });
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
    c.state.paused = true; document.activeElement?.blur();
  });
  const mechanics = await page.evaluate(async () => {
    const { STOCK_STAGE: S } = await import('/src/config/stockStage.ts');
    const g = window.__game, c = g.ctx, a = c.arena;
    const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
    const fresh = () => {
      a.reset(); step(125);
      c.state.arrivalGraceUntil = 0;
      for (const slot of [0, 1]) {
        const b = a.bundle(slot);
        Object.assign(b.player, { x: S.center.x + slot * 22, y: S.main.y - 1, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, invuln: 0, facing: slot ? -1 : 1 });
        b.input.mouse.x = S.center.x + (1 - slot) * 22; b.input.mouse.y = S.main.y - 10;
      }
    };
    fresh(); c.input.shieldHeld = true; step(1);
    const started = a.with(1, () => { a.bundle(1).player.facing = -1; return a.requestStockAttack(); });
    const trace = [];
    for (let i = 0; i < 8; i++) { step(1); trace.push({ phase: a.stockAttack(1).phase, facing: a.stockAttack(1).facing, x: a.bundle(1).player.x, y: a.bundle(1).player.y, shield: a.stockShield(0).strength }); }
    const block = { started, fighter: a.fighterId(1), trace, shield: a.stockShield(0).strength, volatility: a.stockMatch.fighters[0].volatility, invuln: c.player.invuln, hp: c.player.hp, maxHp: c.player.maxHp };
    c.input.queuedDodge = true; step(1); const contactCancel = a.stockDodge(0).busy;
    step(20); c.input.keys.left = true; c.input.queuedDodge = true; step(1);
    const roll = { dodge: a.stockDodge(0).phase, shield: a.stockShield(0).phase };
    fresh(); c.input.shieldHeld = true; step(1);
    // Use the real enemy redirect and Player.damage. A projectile/direct hit owns the opponent slot.
    a.with(1, () => a.hit(c.enemies.find(e => e.kind === 'fighter'), 8, -2, 0, 'direct'));
    const ranged = { shield: a.stockShield(0).strength, volatility: a.stockMatch.fighters[0].volatility, invuln: c.player.invuln };
    a.with(1, () => a.hit(c.enemies.find(e => e.kind === 'fighter'), 1000, -2, 0, 'direct'));
    const broken = a.stockShield(0).phase;
    step(15); const locked = a.isActionLocked(0);
    a.with(1, () => a.hit(c.enemies.find(e => e.kind === 'fighter'), 10, -2, 0, 'direct'));
    const punish = a.stockMatch.fighters[0].volatility;
    fresh(); c.input.shieldHeld = true; step(1); c.playerCtl.damage(8, 0, 0, 'fire');
    const environment = a.stockMatch.fighters[0].volatility;
    fresh(); c.input.shieldHeld = true; step(1); c.input.shieldHeld = false; step(1);
    const release = a.stockShield(0).phase; step(8); const idle = a.stockShield(0).phase;
    return { block, contactCancel, roll, ranged, broken, locked, punish, environment, release, idle };
  });
  console.log(JSON.stringify(mechanics, null, 2));
  assert.ok(mechanics.block.shield < 99); assert.equal(mechanics.block.volatility, 0); assert.equal(mechanics.block.invuln, 0);
  assert.equal(mechanics.block.hp, mechanics.block.maxHp); assert.equal(mechanics.contactCancel, false);
  assert.equal(mechanics.roll.dodge, 'startup'); assert.equal(mechanics.roll.shield, 'idle');
  assert.ok(mechanics.ranged.shield < 99); assert.equal(mechanics.ranged.volatility, 0); assert.equal(mechanics.ranged.invuln, 0);
  assert.equal(mechanics.broken, 'broken'); assert.equal(mechanics.locked, true); assert.ok(mechanics.punish > 0);
  assert.ok(mechanics.environment > 0); assert.equal(mechanics.release, 'release'); assert.equal(mechanics.idle, 'idle');
  const gallery = [];
  for (const fighter of ['ilyra-voss', 'brann-rook', 'mara-quell']) {
    await page.evaluate(async id => { const c = window.__game.ctx; c.fighters.equip(id); await c.fighters.whenReady(); }, fighter);
    for (const phase of ['guard', 'depleted', 'broken']) {
      await page.evaluate(async phase => {
        const { STOCK_STAGE: S } = await import('/src/config/stockStage.ts');
        const g = window.__game, c = g.ctx, a = c.arena;
        a.reset(); for (let i = 0; i < 125; i++) g.tick(false, { forcePaused: true });
        c.state.arrivalGraceUntil = 0;
        for (const slot of [0, 1]) Object.assign(a.bundle(slot).player, { x: S.center.x + slot * 52, y: S.main.y - 1, grounded: true, vx: 0, vy: 0, fx: 0, fy: 0, invuln: 0, facing: slot ? -1 : 1 });
        c.input.shieldHeld = true; g.tick(false, { forcePaused: true });
        if (phase !== 'guard') a.with(1, () => a.hit(c.enemies.find(e => e.kind === 'fighter'), phase === 'broken' ? 1000 : 155, -2, 0, 'direct'));
        for (let i = 0; i < 250; i++) c.camera.update(c);
        g.composer.capturePoses(c); g.composeDirty = true; g.renderFrame();
      }, phase);
      const clip = await page.evaluate(() => {
        const c = window.__game.ctx, cam = c.camera, rect = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
        const z = cam.zoom * cam.viewScale, scale = cam.viewScale;
        const worldLeft = cam.x + 320 * (1 - scale), worldTop = cam.y + 180 * (1 - scale);
        const x = rect.x + ((c.player.x - worldLeft) / scale - 320) * rect.width / 640 * z + rect.width / 2;
        const y = rect.y + ((c.player.y - 12 - worldTop) / scale - 180) * rect.height / 360 * z + rect.height / 2;
        return { x: Math.round(x - 100), y: Math.round(y - 100), width: 200, height: 200 };
      });
      const file = `${fighter}-shield-${phase}.png`;
      await page.screenshot({ path: `${out}/${file}`, clip }); gallery.push(file);
    }
  }
  // Exercise actual held-key routing, release, and dodge transition on the live loop.
  await page.evaluate(() => { const c = window.__game.ctx; c.arena.reset(); for (let i = 0; i < 125; i++) window.__game.tick(false, { forcePaused: true }); c.state.paused = false; });
  await page.keyboard.down('k');
  await page.waitForFunction(() => window.__game.ctx.arena.stockShield(0).guarding);
  await page.keyboard.down('d');
  await page.waitForFunction(() => window.__game.ctx.arena.stockDodge(0).busy);
  await page.keyboard.up('d'); await page.keyboard.up('k');
  await page.waitForFunction(() => !window.__game.ctx.input.shieldHeld);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/shield-hud-390.png` });
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, cards: [...document.querySelectorAll('.stock-fighter')].map(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth })) }));
  assert.ok(layout.scrollWidth <= layout.width);
  assert.ok(layout.cards.every(card => card.scrollWidth <= card.width), 'shield meter must fit narrow fighter cards');
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/stock-shield.json`, JSON.stringify({ mechanics, keyboard: 'hold K guards; K + direction dodges; release clears hold', gallery, layout, errors }, null, 2));
  console.log('Shield contacts, break, release, keyboard transitions, and nine native pose captures passed.');
} finally { await browser.close(); }

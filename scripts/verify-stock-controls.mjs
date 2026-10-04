import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { cycleTo, cyclerValue } from './versus-helpers.mjs';
const browser = await launchBrowser(), errors = [], out = 'docs/arena/platform-fighter/evidence';
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.clear(); sessionStorage.clear();
    window.testPads = [0, 1].map(index => ({ index, id: `Xbox test ${index}`, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })) }));
    Object.defineProperty(navigator, 'getGamepads', { value: () => window.testPads });
  });
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5217/') + '?link=off', { waitUntil: 'networkidle' });
  await page.locator('[data-entry="duel"]').click();
  await page.locator('#versus-lobby').waitFor({ state: 'visible' });
  assert.equal(await cyclerValue(page, 'Player 1 device'), 'pad:0');
  await cycleTo(page, 'Player 2 device', 'pad:1');
  await page.getByRole('button', { name: 'Ready player 1', exact: true }).click();
  await page.getByRole('button', { name: 'Ready player 2', exact: true }).click();
  await page.locator('#versus-start').click();
  await page.waitForFunction(() => window.__game?.ctx.arena.stockMatch?.state === 'fighting');
  await page.evaluate(async () => {
    const { STOCK_STAGE: S } = await import('/src/config/stockStage.ts');
    const g = window.__game, c = g.ctx;
    c.state.paused = true; document.activeElement?.blur();
    const pads = window.testPads;
    const poll = () => { c.state.paused = false; g.pollInput(); c.state.paused = true; };
    const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
    const neutral = () => { for (const p of pads) { p.axes.fill(0); for (const b of p.buttons) b.pressed = false; } poll(); };
    const fresh = (slot = 0, near = false) => {
      neutral(); c.arena.reset(); c.fx.hitstop = 0; step(125); c.state.arrivalGraceUntil = 0;
      for (const n of [0, 1]) {
        const b = c.arena.bundle(n), x = n === slot ? S.center.x : S.center.x + (near ? 18 : 140);
        Object.assign(b.player, { x, y: S.main.y - 1, grounded: true, vx: 0, vy: 0, fx: 0, fy: 0, invuln: 0, facing: n === slot ? 1 : -1 });
        b.input.mouse.x = n === slot ? x + 100 : x - 100; b.input.mouse.y = S.main.y - 10;
      }
    };
    const press = (slot, button, axes = [0, 0, 0, 0]) => {
      const p = pads[slot];
      if (!p) { if (button === 6) c.arena.bundle(slot).input.shieldHeld = true; return; }
      p.axes.splice(0, 4, ...axes); p.buttons[button].pressed = true; poll();
    };
    window.controlsFixture = { c, g, S, pads, poll, step, neutral, fresh, press };
  });
  const runControls = async slots => page.evaluate(slots => {
    const { c, pads, poll, step, fresh, press } = window.controlsFixture, a = c.arena, results = [];
    for (const slot of slots) {
      fresh(slot); press(slot, 0); const attack = { kind: a.stockAttack(slot).kind, otherBusy: a.stockAttack(1 - slot).busy, jump: a.bundle(slot).input.keys.jump }; step(1);
      const jumps = [];
      for (const button of [2, 3]) { fresh(slot); press(slot, button); step(2); jumps.push({ button, vy: a.bundle(slot).player.vy, y: a.bundle(slot).player.y, grounded: a.bundle(slot).player.grounded }); }
      const shields = [];
      for (const button of [6, 7]) { fresh(slot); press(slot, button); step(1); shields.push({ button, phase: a.stockShield(slot).phase, firing: a.bundle(slot).player.firing }); }
      fresh(slot); press(slot, 7); step(1); pads[slot].axes[0] = 1; poll(); step(1); const roll = a.stockDodge(slot).phase;
      fresh(slot); Object.assign(a.bundle(slot).player, { y: 590, grounded: false }); press(slot, 6); step(1); const airDodge = a.stockDodge(slot).inAir;
      const grabs = [];
      for (const button of [4, 5]) {
        fresh(slot, true); press(1 - slot, 6); step(1); press(slot, button); step(6);
        const hold = { phase: a.stockGrab(slot).phase, caught: a.isGrabbed(1 - slot), shield: a.stockShield(1 - slot).phase };
        pads[slot].axes[1] = -1; poll(); step(8);
        grabs.push({ button, hold, released: !a.isGrabbed(1 - slot), vy: a.bundle(1 - slot).player.vy, volatility: a.stockMatch.fighters[1 - slot].volatility });
      }
      fresh(slot); pads[slot].axes[2] = -1; poll(); const smash = { kind: a.stockAttack(slot).kind, facing: a.stockAttack(slot).facing }; step(90); poll(); const repeats = a.stockAttack(slot).busy;
      fresh(slot); pads[slot].axes[3] = -1; poll(); const upSmash = { name: a.stockAttack(slot).spec?.name, startup: a.stockAttack(slot).spec?.startup };
      fresh(slot); press(slot, 1, [0, -1, 0, 0]); step(2); const recovery = { active: a.isRecovering(slot), ready: a.canRecover(slot), vy: a.bundle(slot).player.vy };
      fresh(slot); const casts = []; const off = c.events.on('cardCast', e => casts.push(e.id)); press(slot, 1); const firing = a.bundle(slot).player.firing; step(20); off();
      results.push({ slot, attack, jumps, shields, roll, airDodge, grabs, smash, repeats, upSmash, recovery, special: { firing, casts } });
    }
    return results;
  }, slots);
  const duel = await runControls([0, 1]);
  const validate = rows => { for (const r of rows) {
    assert.deepEqual(r.attack, { kind: 'opener', otherBusy: false, jump: false });
    assert.ok(r.jumps.every(j => j.vy < 0 && !j.grounded)); assert.ok(r.shields.every(s => s.phase === 'guard' && !s.firing));
    assert.equal(r.roll, 'startup'); assert.equal(r.airDodge, true);
    assert.ok(r.grabs.every(g => g.hold.caught && g.hold.phase === 'hold' && g.hold.shield === 'idle' && g.released && g.volatility > 0 && g.vy < -3));
    assert.deepEqual(r.smash, { kind: 'finisher', facing: -1 }); assert.equal(r.repeats, false); assert.equal(r.upSmash.name, 'Up smash');
    assert.ok(r.recovery.active && !r.recovery.ready && r.recovery.vy < 0); assert.ok(r.special.firing && r.special.casts.length > 0);
  } };
  console.log(JSON.stringify({ duel }, null, 2)); validate(duel);
  // Both slots used the player-facing session. Repeat through authoring Arena's InputManager branch.
  await page.evaluate(async () => {
    const c = window.__game.ctx; c.versus.close(); window.testPads.length = 1;
    await c.console.exec('run test --level fighter-duel --world campaign-level');
  });
  await page.getByRole('combobox', { name: 'Match rules', exact: true }).selectOption('stocks');
  await page.getByRole('button', { name: 'Add rival', exact: true }).click();
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  await page.evaluate(async () => { const c = window.__game.ctx; await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off'); c.state.paused = true; document.activeElement?.blur(); });
  // The fixture retains both objects; only controller zero is connected in navigator now.
  const arena = await runControls([0]); console.log(JSON.stringify({ arena }, null, 2)); validate(arena);
  const gallery = [];
  for (const fighter of ['ilyra-voss', 'brann-rook', 'mara-quell']) {
    await page.evaluate(async fighter => { const c = window.__game.ctx; c.fighters.equip(fighter); await c.fighters.whenReady(); }, fighter);
    for (const phase of ['reach', 'hold', 'throw']) {
      await page.evaluate(phase => {
        const { c, g, fresh, press, step, pads, poll } = window.controlsFixture;
        fresh(0, true); press(0, 4); step(phase === 'reach' ? 5 : 7);
        if (phase === 'throw') { pads[0].axes[0] = 1; poll(); step(14); }
        for (let i = 0; i < 250; i++) c.camera.update(c);
        g.composer.capturePoses(c); g.composeDirty = true; g.renderFrame();
      }, phase);
      const clip = await page.evaluate(() => {
        const c = window.__game.ctx, cam = c.camera, rect = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
        const scale = cam.viewScale, z = cam.zoom * scale;
        const points = [0, 1].map(slot => {
          const p = c.arena.bundle(slot).player;
          return {
            x: rect.x + rect.width * (.5 + ((p.x - cam.renderX) / (640 * scale) - .5) * (1 + 4 / 640) * z - (cam.presentationX - cam.renderX) / 640 / scale * z),
            y: rect.y + rect.height * (.5 + ((p.y - cam.renderY) / (360 * scale) - .5) * (1 + 4 / 360) * z - (cam.presentationY - cam.renderY) / 360 / scale * z),
          };
        });
        const x = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)) - 65));
        const y = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)) - 100));
        return { x, y, width: Math.min(innerWidth - x, Math.ceil(Math.max(...points.map(p => p.x)) + 65 - x)), height: Math.min(innerHeight - y, Math.ceil(Math.max(...points.map(p => p.y)) + 40 - y)) };
      });
      const file = `${fighter}-grab-${phase}.png`; await page.screenshot({ path: `${out}/${file}`, clip }); gallery.push(file);
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/stock-controls.json`, JSON.stringify({ duel, arena, gallery, errors }, null, 2));
  console.log('Approved controller roles verified in both Duel seats and the Arena input path.');
} finally { await browser.close(); }

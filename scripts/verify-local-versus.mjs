import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { cyclerValue } from './versus-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5217/';
const production = process.argv.includes('--production');
const out = 'docs/arena/platform-fighter/evidence';
const browser = await launchBrowser();
const errors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    window.testPads = [];
    window.makeTestPad = index => ({ index, id: `Local test controller ${index}`, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })) });
    Object.defineProperty(navigator, 'getGamepads', { value: () => window.testPads });
  });
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  // A real saved campaign is a fixture for the isolation check. Versus itself starts through visible controls.
  if (!production) {
    await page.waitForFunction(() => window.__game?.ctx?.console);
    await page.evaluate(async () => {
      const c = window.__game.ctx;
      const result = await c.console.exec('run new --world campaign');
      if (!result.ok) throw new Error(result.text);
      c.state.paused = true; c.levels.saveExpedition(c); await c.levels.storage.flush();
      window.testCampaignSave = JSON.stringify(c.levels.storage.cached ?? localStorage.getItem('noita-expedition'));
      window.dispatchEvent(new Event('expedition-title-request'));
    });
  }
  await page.locator('[data-entry="duel"]').click();
  await page.locator('#versus-lobby').waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('.versus-portrait')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(await page.locator('#versus-heading').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'lobby heading is not clipped');
  await page.screenshot({ path: `${out}/versus-lobby-${production ? 'player' : 'desktop'}.png` });
  // No dropdowns: each device is a ◀ value ▶ cycler (scripts/versus-helpers.mjs).
  assert.equal(await page.locator('#versus-lobby select').count(), 0, 'the select screen has no dropdowns');
  const keyboard = page.getByRole('group', { name: 'Player 1 device', exact: true });
  assert.equal(await cyclerValue(page, 'Player 1 device'), 'keyboard'); assert.equal(await cyclerValue(page, 'Player 2 device'), 'cpu');
  // One big READY (concepts/local-versus.png); each seat shows its own readiness. A lone keyboard player against a CPU
  // readies and starts with one click.
  assert.equal((await page.locator('#versus-start').textContent())?.trim(), 'Ready');
  assert.equal(await page.getByRole('button', { name: 'Ready player 1', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.getByRole('button', { name: 'Ready player 2', exact: true }).getAttribute('aria-pressed'), 'true', 'a CPU seat is ready');
  await page.locator('#versus-start').click();
  await page.locator('#versus-lobby').waitFor({ state: 'hidden', timeout: 30000 });
  await page.locator('#stock-match-hud').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.stock-message')?.hidden === true, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('b');
  assert.equal(await page.locator('#wand-bench').isVisible(), false, 'signature loadouts cannot be edited during a match');
  assert.equal(await page.locator('#fighter-arena').isVisible(), false);
  if (production) assert.equal(await page.evaluate(() => typeof window.__game), 'undefined', 'player build has no debug handle');
  await page.screenshot({ path: `${out}/versus-match-${production ? 'player' : 'desktop'}.png` });
  let savedDescentUnchanged = null;
  if (!production) {
    savedDescentUnchanged = await page.evaluate(async () => {
      const c = window.__game.ctx; await c.levels.storage.flush();
      return window.testCampaignSave !== 'null' && JSON.stringify(c.levels.storage.cached ?? localStorage.getItem('noita-expedition')) === window.testCampaignSave;
    });
    assert.equal(savedDescentUnchanged, true, 'versus preserves the durable campaign checkpoint');
  }
  await page.keyboard.press('Escape');
  await page.locator('#pause-overlay.visible').waitFor();
  await page.locator('#pause-restart').click();
  await page.waitForFunction(() => document.querySelector('.stock-message')?.textContent === '2');
  await page.waitForFunction(() => document.querySelector('.stock-message')?.hidden === true);
  await page.keyboard.press('Escape'); await page.locator('#pause-title-btn').click();
  await page.locator('[data-entry="duel"]').click();
  await page.evaluate(() => { window.testPads = [window.makeTestPad(0), window.makeTestPad(1)]; });
  await page.waitForFunction(() => document.querySelector('[aria-label="Player 2 device"]')?.dataset.options?.split(',').includes('pad:1'));
  const pressPad = async (index, button) => {
    await page.evaluate(async ([index, button]) => {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.testPads[index].buttons[button].pressed = true;
      await frames();
      window.testPads[index].buttons[button].pressed = false;
      await frames();
    }, [index, button]);
  };
  await pressPad(0, 0); assert.equal(await cyclerValue(page, 'Player 2 device'), 'pad:0', 'A joins the CPU seat');
  assert.equal((await keyboard.getAttribute('data-options')).split(',').includes('pad:0'), false, 'one controller cannot own both seats');
  await page.getByRole('button', { name: 'Ready player 1', exact: true }).click();
  await pressPad(0, 0); await pressPad(0, 9);
  await page.locator('#versus-lobby').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.stock-message')?.hidden === true);
  let mixedOwnership = null;
  if (!production) {
    const before = await page.evaluate(() => [0, 1].map(slot => window.__game.ctx.arena.bundle(slot).player.x));
    await page.keyboard.down('d'); await page.evaluate(() => { window.testPads[0].axes[0] = -1; });
    await page.waitForFunction(before => {
      const c = window.__game.ctx;
      return c.arena.bundle(0).player.x > before[0] + 10 && c.arena.bundle(1).player.x < before[1] - 10;
    }, before);
    await page.keyboard.up('d'); await page.evaluate(() => { window.testPads[0].axes[0] = 0; });
    const after = await page.evaluate(() => [0, 1].map(slot => window.__game.ctx.arena.bundle(slot).player.x));
    assert.ok(after[0] > before[0] + 5 && after[1] < before[1] - 5, 'keyboard and controller move their own fighters simultaneously');
    mixedOwnership = { before, after };
  }
  await pressPad(0, 9); await page.locator('#pause-title-btn').click();
  await page.locator('[data-entry="duel"]').click();
  await pressPad(1, 0); assert.equal(await cyclerValue(page, 'Player 1 device'), 'pad:1');
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, lobby: document.querySelector('#versus-lobby').scrollWidth }));
  assert.ok(narrow.width <= 390 && narrow.lobby <= 390, 'lobby has no narrow horizontal overflow');
  assert.equal(await page.locator('#versus-heading').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'narrow heading is not clipped');
  await page.screenshot({ path: `${out}/versus-lobby-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await pressPad(0, 0); await pressPad(1, 0); await pressPad(1, 9);
  await page.locator('#versus-lobby').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.stock-message')?.hidden === true);
  let ownership = null, meleeOwnership = null;
  if (!production) {
    const before = await page.evaluate(() => {
      const c = window.__game.ctx;
      const before = [c.arena.bundle(0).player.x, c.arena.bundle(1).player.x];
      window.testPads[1].axes[0] = 1;
      return before;
    });
    await page.waitForFunction(before => window.__game.ctx.arena.bundle(0).player.x > before[0] + 10, before);
    ownership = await page.evaluate(before => {
      const c = window.__game.ctx;
      window.testPads[1].axes[0] = 0;
      const after = [c.arena.bundle(0).player.x, c.arena.bundle(1).player.x];
      return { before, after, assigned: c.versus.seats.map(s => s.device) };
    }, before);
    assert.ok(ownership.after[0] > ownership.before[0] + 5, 'assigned controller moves player 1');
    assert.equal(ownership.after[1], ownership.before[1], 'other fighter remains still');
    await page.evaluate(() => { window.testPads[1].axes[1] = 1; });
    await pressPad(1, 0);
    meleeOwnership = await page.evaluate(() => {
      const c = window.__game.ctx; window.testPads[1].axes[1] = 0;
      return [0, 1].map(slot => ({ kind: c.arena.stockAttack(slot).kind, busy: c.arena.stockAttack(slot).busy }));
    });
    assert.equal(meleeOwnership[0].kind, 'finisher'); assert.equal(meleeOwnership[1].busy, false, 'A affects only its assigned fighter');
  }
  await pressPad(0, 9); await page.locator('#pause-overlay.visible').waitFor();
  await pressPad(1, 9); await page.locator('#pause-overlay.visible').waitFor({ state: 'hidden' });
  await page.evaluate(() => { window.testPads[0] = null; });
  await page.locator('#versus-reconnect').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#versus-reconnect [data-resume]').isDisabled(), true);
  const frozen = await page.locator('.stock-timer').textContent();
  await page.waitForTimeout(1100); assert.equal(await page.locator('.stock-timer').textContent(), frozen, 'disconnect freezes match time');
  await page.screenshot({ path: `${out}/versus-reconnect.png` });
  await page.evaluate(() => { window.testPads[0] = window.makeTestPad(0); });
  await page.waitForFunction(() => !document.querySelector('#versus-reconnect [data-resume]').disabled);
  await pressPad(0, 9); await page.locator('#versus-reconnect').waitFor({ state: 'hidden' });
  if (!production) {
    await page.evaluate(() => {
      const g = window.__game, c = g.ctx; c.state.paused = true;
      for (let stock = 0; stock < 3; stock++) {
        c.arena.bundle(1).player.x = 1120;
        for (let tick = 0; tick < 140; tick++) g.tick(false, { forcePaused: true });
      }
      c.state.paused = false;
    });
    await page.getByRole('button', { name: 'Rematch', exact: true }).waitFor({ state: 'visible' });
    await page.screenshot({ path: `${out}/versus-results.png` });
    await page.evaluate(() => document.activeElement?.blur());
    await pressPad(0, 0);
    await page.waitForFunction(() => document.querySelector('.stock-message')?.textContent === '2');
    await page.waitForFunction(() => document.querySelector('.stock-message')?.hidden === true);
    await pressPad(0, 9); await page.locator('#pause-title-btn').click();
    await page.locator('[data-entry="continue"]').click();
    await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === JSON.parse(window.testCampaignSave).currentId && window.__game.ctx.run.active);
    assert.equal(await page.locator('#stock-match-hud').isVisible(), false, 'Continue restores campaign presentation');
  }
  assert.deepEqual(errors, []);
  const result = { production, narrow, ownership, meleeOwnership, mixedOwnership, savedDescentUnchanged, checks: ['visible title launch', 'CPU match', 'signature loadout locked', 'restart match', 'quit to title', 'press to join', 'keyboard plus controller match', 'two controller assignment', 'narrow layout', 'controller pause', 'disconnect freezes timer', 'reconnect requires resume', ...(!production ? ['slot movement isolation', 'controller melee isolation', 'controller rematch', 'saved descent preserved', 'Continue restores campaign'] : ['debug handle absent'])], errors };
  writeFileSync(`${out}/local-versus${production ? '-player' : ''}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(await page?.evaluate(() => ({
    message: document.querySelector('.versus-status')?.textContent,
    ready: [...document.querySelectorAll('.versus-ready')].map(el => el.getAttribute('aria-pressed')),
    phase: window.__game?.ctx?.versus?.phase, paused: window.__game?.ctx?.state.paused,
    match: window.__game?.ctx?.arena?.stockMatch?.state,
    errors: [...document.querySelectorAll('[role="status"]')].map(el => el.textContent).filter(Boolean).slice(-5),
  })));
  throw error;
} finally { await browser.close(); }

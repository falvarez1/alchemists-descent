import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const output = 'verify-out/living-descent';
mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const report = { errors, encounters: [] };
async function verifyFlaskLayout() {
  const slots = await page.locator('#flask-belt .flask-slot').evaluateAll(elements => elements.map(element => {
    const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width };
  }));
  assert.equal(slots.length, 4);
  for (let i = 0; i < slots.length; i++) {
    assert.ok(slots[i].width >= 45, 'Each flask needs its own readable slot');
    if (i > 0) assert.ok(slots[i].left >= slots[i - 1].right, 'Flask slots must not overlap');
  }
}
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  await page.waitForFunction(() => !document.getElementById('boot-overlay') || document.getElementById('boot-overlay').classList.contains('done'));
  await page.waitForTimeout(400);
  await page.locator('#expedition-entry:not([hidden])').waitFor();
  await page.screenshot({ path: `${output}/entry-desktop.png` });
  await page.setViewportSize({ width: 720, height: 480 });
  await page.screenshot({ path: `${output}/entry-compact.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-entry="begin"]').click();
  await waitForRunReady(page);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${output}/intake-desktop.png` });
  await verifyFlaskLayout();
  report.opening = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    return { seed: ctx.state.worldSeed, player: { x: ctx.player.x, y: ctx.player.y },
      fauna: ctx.critters.list.length, residents: ctx.enemies.map(e => ({ kind: e.kind, hp: e.hp, x: e.x, y: e.y, mind: e.mind })),
      activity: { active: ctx.world.activity.activeChunks, sleeping: ctx.world.activity.sleepingChunks } };
  });
  assert.equal(report.opening.fauna > 0, true);
  assert.equal(report.opening.residents.length, 6);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.press('Space', { delay: 150 });
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  report.movement = await page.evaluate(() => ({ x: window.__game.ctx.player.x, y: window.__game.ctx.player.y,
    paused: window.__game.ctx.state.paused, keys: window.__game.ctx.input.keys,
    dialogs: [...document.querySelectorAll('.visible, dialog[open]')].map(e => e.id) }));
  assert.ok(report.movement.x > report.opening.player.x + 35);
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(400);
  report.lure = await page.evaluate(() => window.__game.ctx.levels.current.living);
  assert.equal(report.lure.glowseeds, 2);
  assert.equal(report.lure.lures.length, 1);
  await page.locator('#expedition-pause').click();
  await page.locator('#pause-settings').click();
  const fontSession = await page.context().newCDPSession(page);
  await fontSession.send('DOM.enable'); await fontSession.send('CSS.enable');
  const documentRoot = await fontSession.send('DOM.getDocument');
  const paragraph = await fontSession.send('DOM.querySelector', { nodeId: documentRoot.root.nodeId, selector: '#player-settings p' });
  report.settingsFonts = await fontSession.send('CSS.getPlatformFontsForNode', { nodeId: paragraph.nodeId });
  await fontSession.detach();
  await page.locator('#player-settings [name="textScale"]').selectOption('1.3');
  await page.locator('#player-settings [name="reducedFlashes"]').check();
  await page.locator('#player-settings [name="creatureCaptions"]').check();
  await page.screenshot({ path: `${output}/settings-desktop.png` });
  await page.setViewportSize({ width: 720, height: 480 });
  await page.locator('#player-settings [name="highReadability"]').check();
  await page.screenshot({ path: `${output}/settings-compact.png` });
  await page.locator('#player-settings [name="highReadability"]').uncheck();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#player-settings button[value="close"]').click();
  await page.keyboard.press('Escape');
  await execConsoleCommand(page, 'run save');
  report.save = await page.evaluate(() => window.__game.ctx.levels.flushSaves());
  assert.equal(report.save.state, 'ready');
  // Scene positioning is a disclosed test run through the console, never a
  // claim that automation navigated these rooms without assistance.
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page);
  for (const [name, x, y] of [['sluice', 525, 381], ['gallery', 1130, 387], ['refuge', 854, 743]]) {
    await execConsoleCommand(page, `tp ${x} ${y}`);
    await execConsoleCommand(page, 'god off');
    await page.waitForTimeout(3000);
    if (name === 'sluice') {
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(900);
    }
    report.encounters.push(await page.evaluate(name => {
      const ctx = window.__game.ctx, rt = ctx.levels.current;
      return { name, player: { x: ctx.player.x, y: ctx.player.y, hp: ctx.player.hp },
        living: rt.living, valve: rt.mechanisms.find(m => m.id === 8102)?.state,
        fauna: ctx.critters.list.length, activeChunks: ctx.world.activity.activeChunks,
        enemies: ctx.enemies.map(e => ({ kind: e.kind, intent: e.mind?.intent, x: e.x, y: e.y, hp: e.hp })) };
    }, name));
    if (name === 'sluice') assert.equal(report.encounters.at(-1).valve, 1);
    if (name === 'refuge') assert.equal(report.encounters.at(-1).living.rested, true);
    await page.screenshot({ path: `${output}/${name}-desktop.png` });
  }
  await page.setViewportSize({ width: 720, height: 480 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/refuge-compact.png` });
  await verifyFlaskLayout();
  await page.locator('#expedition-pause').click(); await page.locator('#pause-settings').click();
  await page.locator('#player-settings [name="highReadability"]').check();
  await page.locator('#player-settings button[value="close"]').click();
  await page.locator('#pause-resume').click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/refuge-readable-compact.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(`${output}/expedition-flow.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

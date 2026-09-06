import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { archiveGameplayClip, finishGameplayCapture, startGameplayCapture } from './clip-archive.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const report = { errors: [], setup: 'Disposable D1 seed 777, 9999 HP, console positioning then god off. One severed-leg pickup fixture is added beside the player; actual touch equips it. Real LMB/RMB/G and walking test whipping, dropping, recovery and a throw into a console-spawned golem. No player inventory, damage, velocity or collision injection.' };
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => report.errors.push(String(e)));
const state = () => page.evaluate(() => {
  const c = window.__game.ctx;
  return { player: { x: c.player.x, y: c.player.y, club: c.player.legClub ? { ...c.player.legClub } : null },
    wand: { mana: c.wands.wands[c.wands.active].mana, index: c.wands.wands[c.wands.active].castIndex },
    spells: c.projectiles.filter(p => !p.hostile).length,
    legs: c.levels.current.pickups.filter(p => p.kind === 'weaverleg' && p.data.legOwner === 'equipment-fixture').map(p => ({ ...p, data: { ...p.data } })),
    victim: window.__equipmentVictim ? { hp: window.__equipmentVictim.hp, x: window.__equipmentVictim.x, y: window.__equipmentVictim.y } : null };
});
async function aim(x, y) {
  const p = await page.evaluate(({ x, y }) => {
    const c = window.__game.ctx, r = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
    return { x: r.left + (x - c.camera.renderX) * r.width / 640, y: r.top + (y - c.camera.renderY) * r.height / 360 };
  }, { x, y });
  await page.mouse.move(p.x, p.y);
}
async function collect() {
  for (let i = 0; i < 100; i++) {
    const s = await state(); if (s.player.club) break;
    const leg = s.legs.find(p => !p.taken); assert.ok(leg, 'Recoverable leg exists');
    const dx = leg.x - s.player.x;
    await page.keyboard.up(dx > 0 ? 'KeyA' : 'KeyD');
    if (Math.abs(dx) > 2) await page.keyboard.down(dx > 0 ? 'KeyD' : 'KeyA');
    else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
    await page.waitForTimeout(65);
  }
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
  assert.ok((await state()).player.club, 'Real movement re-equips the dropped leg');
}
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh --hp 9999 --max-hp 9999');
  await waitForRunReady(page); await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await execConsoleCommand(page, 'tp 230 312'); await execConsoleCommand(page, 'god off'); await page.waitForTimeout(1200);
  await startGameplayCapture(page);
  await page.evaluate(async () => {
    const c = window.__game.ctx, { makePickup } = await import('/src/core/pickupDefs.ts');
    c.levels.current.pickups.push(makePickup('weaverleg', c.player.x + 5, c.player.y - 8, { legLength: 34, legOwner: 'equipment-fixture' }));
  });
  await page.waitForFunction(() => !!window.__game.ctx.player.legClub);
  await page.waitForTimeout(400); report.equipped = await state();
  assert.equal(await page.locator('#spell-hotbar').isVisible(), false, 'Stowed wand UI is hidden');
  await page.screenshot({ path: `${output}/equipment-leg-equipped.png` });
  await aim(report.equipped.player.x + 100, report.equipped.player.y - 10);
  await page.mouse.down(); await page.waitForTimeout(120);
  report.whipping = await state(); assert.ok(report.whipping.player.club.swingT > 0, 'LMB starts the whip');
  assert.equal(report.whipping.spells, 0); assert.deepEqual(report.whipping.wand, report.equipped.wand);
  await page.screenshot({ path: `${output}/equipment-primary-whip.png` }); await page.mouse.up(); await page.waitForTimeout(650);
  await page.keyboard.press('KeyG'); await page.waitForTimeout(1900);
  report.dropped = await state(); assert.equal(report.dropped.player.club, null);
  assert.ok(report.dropped.legs.some(p => !p.taken)); assert.ok(await page.locator('#spell-hotbar').isVisible());
  await page.screenshot({ path: `${output}/equipment-leg-dropped.png` });
  await aim(report.dropped.player.x - 80, report.dropped.player.y - 65);
  await page.mouse.down(); await page.waitForTimeout(65); await page.mouse.up();
  report.wandRestored = await state(); assert.ok(report.wandRestored.wand.mana < report.dropped.wand.mana, 'Fresh LMB casts the restored wand');
  await page.keyboard.down('KeyA'); await page.waitForTimeout(380); await page.keyboard.up('KeyA');
  await collect(); await page.waitForTimeout(500); report.recovered = await state();
  assert.equal(report.recovered.player.club.durability, report.equipped.player.club.durability);
  const s = report.recovered;
  await execConsoleCommand(page, `spawn golem 1 ${Math.round(s.player.x + 75)} ${Math.round(s.player.y)}`);
  await page.evaluate(() => { window.__equipmentVictim = window.__game.ctx.enemies.at(-1); });
  const target = (await state()).victim; assert.ok(target);
  await aim(target.x, target.y - 10);
  const flask = await page.evaluate(() => ({ ...window.__game.ctx.flask.state }));
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(65); await page.mouse.up({ button: 'right' });
  report.thrown = await state(); assert.equal(report.thrown.player.club, null);
  assert.deepEqual(await page.evaluate(() => ({ ...window.__game.ctx.flask.state })), flask, 'RMB does not throw a flask while a leg is equipped');
  await page.screenshot({ path: `${output}/equipment-leg-airborne.png` });
  await page.waitForFunction(hp => window.__equipmentVictim.hp < hp, target.hp, { timeout: 8000 });
  await page.waitForTimeout(450); report.hit = await state();
  assert.equal(report.hit.victim.hp, target.hp - 24, 'The thrown leg deals one physical hit');
  assert.ok(report.hit.legs.some(p => !p.taken && p.data.legDurability === s.player.club.durability - 1));
  await page.screenshot({ path: `${output}/equipment-leg-impact.png` });
  await collect(); report.final = await state();
  assert.equal(report.final.player.club.durability, s.player.club.durability - 1);
  await page.setViewportSize({ width: 720, height: 480 }); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/equipment-leg-compact.png` });
  await finishGameplayCapture(page, `${output}/weaver-equipment.webm`);
  archiveGameplayClip('weaver-equipment', 'One weapon · whip, drop, throw and recover', `${output}/weaver-equipment.webm`, `${output}/equipment-leg-airborne.png`, report.setup);
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = String(error); await page.screenshot({ path: `${output}/equipment-failure.png` }); throw error;
} finally {
  writeFileSync(`${output}/weaver-equipment.json`, JSON.stringify(report, null, 2)); await browser.close();
}

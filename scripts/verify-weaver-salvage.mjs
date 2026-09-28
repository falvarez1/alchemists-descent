import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { archiveGameplayClip, finishGameplayCapture, startGameplayCapture } from './clip-archive.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const whip = process.argv[3] === 'whip';
const trickshot = process.argv[3] === 'trickshot' || whip;
const browser = await launchBrowser(), report = { errors: [], samples: [], setup: 'Disposable D1 seed 777. Console positions player near the resident and enables god mode. Aim, fire, collection and melee use real mouse/keyboard; no limb, pickup or inventory injection.' };
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', error => report.errors.push(String(error)));
const sample = () => page.evaluate(() => {
  const c = window.__game.ctx;
  window.__salvageWeaver ??= c.enemies.find(e => e.kind === 'weaver');
  const e = c.enemies.includes(window.__salvageWeaver) ? window.__salvageWeaver : null;
  return { tick: c.state.frameCount, player: { x: c.player.x, y: c.player.y, hp: c.player.hp, club: c.player.legClub ? { ...c.player.legClub } : null },
    trickshot: c.fx.trickshot ? { label: c.fx.trickshot.label, remainingMs: c.fx.trickshot.remainingMs, scale: c.fx.trickshot.scale, chain: c.fx.trickshot.chain } : null,
    weaver: e ? { x: e.x, y: e.y, hp: e.hp, mask: e.weaverMissingLegs ?? 0, retreat: e.weaverRetreatT, expression: { ...e.expression } } : null,
    legs: c.levels.current.pickups.filter(p => p.kind === 'weaverleg').map(p => ({ x: p.x, y: p.y, taken: p.taken })) };
});
async function aimAtLeg() {
  const aim = await page.evaluate(async () => {
    const c = window.__game.ctx, e = c.enemies.find(e => e.kind === 'weaver');
    if (!e) return null;
    const { weaverLegGeometry, weaverLegAt } = await import('/src/creatures/weaverAnatomy.ts');
    const { sightClear } = await import('/src/creatures/perception.ts');
    const candidates = [];
    for (let i = 0; i < 8; i++) {
      if ((e.weaverMissingLegs ?? 0) & (1 << i)) continue;
      const points = weaverLegGeometry(e, i);
      for (const t of [.25, .5, .7]) {
        const a = points[2], b = points[3], x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        if (weaverLegAt(e, x, y) < 0 || !sightClear(c.world, c.player.x, c.player.y - 10, x, y)) continue;
        candidates.push({ x, y, distance: Math.hypot(x - c.player.x, y - c.player.y + 10) });
      }
    }
    const target = candidates.sort((a, b) => a.distance - b.distance)[0];
    if (!target) return null;
    const rect = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
    return { x: rect.left + (target.x - c.camera.renderX) / 640 * rect.width,
      y: rect.top + (target.y - c.camera.renderY) / 360 * rect.height };
  });
  if (aim) await page.mouse.move(aim.x, aim.y);
  return !!aim;
}

// Keep the finishing sequence a contact fixture when the fleeing owner climbs
// under a catwalk. Never move it, change HP, clear cover or inject a weapon.
async function positionForContact() {
  const stance = await page.evaluate(async () => {
    const c = window.__game.ctx, e = window.__salvageWeaver;
    if (!c.enemies.includes(e)) return null;
    const { sightClear } = await import('/src/creatures/perception.ts');
    const bx = e.weaverLoco?.px ?? e.x, by = e.weaverLoco?.py ?? e.y - 7;
    const candidates = [];
    for (const dy of [10, 18, 26, 34, 42, 44, 50]) for (const dx of [-26, 26, -32, 32, -20, 20]) {
      const x = Math.round(bx + dx), y = Math.round(by + dy), handX = x - Math.sign(dx) * 4;
      if (!c.physics.entityFree(x, y, 4, 17) || !sightClear(c.world, handX, y - 10, bx, by)) continue;
      // A body-sized opening can fit the wizard but pin the long shank against
      // the ceiling. Select a stance with room for its actual wind-up as well.
      if (!c.physics.entityFree(x, y, 10, 17 + c.player.legClub.length * .55)) continue;
      const supported = !c.physics.entityFree(x, y + 1, 4, 1);
      candidates.push({ x, y, score: (supported ? 0 : 100) + Math.abs(dy - 10) + Math.abs(Math.abs(dx) - 28) });
    }
    return candidates.sort((a, b) => a.score - b.score)[0] ?? null;
  });
  if (!stance) return;
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
  await execConsoleCommand(page, `tp ${stance.x} ${stance.y}`); await execConsoleCommand(page, 'god off');
  (report.contactPositions ??= []).push(stance);
}
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await execConsoleCommand(page, `run test --level d1 --world campaign-level --seed 777 --loadout fresh${trickshot ? ' --hp 9999 --max-hp 9999' : ''}`); await waitForRunReady(page);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  if (trickshot) {
    await page.locator('#expedition-pause').click(); await page.locator('#pause-settings').click();
    assert.equal(await page.locator('[name="trickshotEnabled"]').isChecked(), false, 'Experiment defaults off');
    await page.locator('[name="trickshotEnabled"]').check();
    await page.locator('.trickshot-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/trickshot-settings-desktop.png` });
    await page.setViewportSize({ width: 720, height: 480 });
    await page.screenshot({ path: `${output}/trickshot-settings-compact.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click(); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 720 });
    report.experiment = true;
  }
  const resident = (await sample()).weaver; assert.ok(resident);
  await execConsoleCommand(page, trickshot ? `tp ${Math.round(resident.x - 48)} ${Math.round(resident.y)}` : `tp ${Math.round(resident.x - 85)} ${Math.round(resident.y)}`);
  if (!trickshot) await execConsoleCommand(page, 'god on');
  else {
    await execConsoleCommand(page, 'god off');
    report.setup = 'D1 seed 777, fresh Oak Sprig with ordinary spread. Console positions player and grants 9999 HP, then god off; no limb, pickup or inventory injection. All combat and collection use actual inputs.';
  }
  await page.waitForTimeout(trickshot ? 250 : 1000); await startGameplayCapture(page);
  for (let attempt = 0; attempt < 45; attempt++) {
    const state = await sample(); report.samples.push(state);
    if (state.weaver?.mask) break;
    assert.ok(state.weaver, 'Resident is alive before limb contact');
    if (trickshot && Math.abs(state.weaver.x - state.player.x) < 24) {
      const away = state.weaver.x > state.player.x ? 'KeyA' : 'KeyD';
      await page.keyboard.down(away); await page.waitForTimeout(220); await page.keyboard.up(away);
      continue;
    }
    if (await aimAtLeg()) {
      if (trickshot) {
        await page.waitForTimeout(25);
        const guide = await page.evaluate(async () => {
          const { getAimGuide } = await import('/src/combat/AimGuide.ts');
          const g = getAimGuide(window.__game.ctx);
          return g ? { leg: g.leg, assisted: g.assisted, contact: g.contact, end: g.points.at(-1), angle: g.angle } : null;
        });
        state.guide = guide;
        if (!guide || guide.leg < 0) { await page.waitForTimeout(90); continue; }
      }
      await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up();
    }
    await page.waitForTimeout(90);
  }
  report.severed = await sample(); assert.ok(report.severed.weaver?.mask, 'A real projectile severs a visible leg');
  await page.screenshot({ path: `${output}/weaver-leg-severed.png` });
  for (let step = 0; step < 100; step++) {
    const state = await sample(); report.samples.push(state);
    if (state.player.club) break;
    const leg = state.legs.find(p => !p.taken); assert.ok(leg, 'Dropped limb remains available');
    const delta = leg.x - state.player.x;
    if (delta > 4) { await page.keyboard.up('KeyA'); await page.keyboard.down('KeyD'); }
    else if (delta < -4) { await page.keyboard.up('KeyD'); await page.keyboard.down('KeyA'); }
    else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
    if (step % 20 === 18) await page.keyboard.press('Space', { delay: 130 });
    await page.waitForTimeout(80);
  }
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
  report.collected = await sample(); assert.ok(report.collected.player.club, 'Ordinary movement collects and equips the limb');
  await page.screenshot({ path: `${output}/weaver-leg-collected.png` });
  if (trickshot && !whip) report.setup += ' If the owner retreats behind a catwalk, the contact fixture repositions the player into a free, visible stance. Cover and enemy motion stay intact; this is not a route-traversal test.';
  if (whip) {
    report.setup += ' The collected limb is then carried to the Intake with console positioning, god off, for real walk/reverse/jump/F-swing inputs before returning to its owner. If the driver falls into the lower chamber, it repositions beside the owner; this is a contact/handling fixture, not route traversal.';
    await execConsoleCommand(page, 'tp 230 312'); await execConsoleCommand(page, 'god off'); await page.waitForTimeout(1800);
    await page.evaluate(() => {
      window.__whipSamples = []; window.__whipSampling = true;
      const sample = () => {
        const p = window.__game.ctx.player, r = p.legClub?.rig;
        if (r) window.__whipSamples.push({ tick: window.__game.ctx.state.frameCount, playerX: p.x, playerY: p.y,
          swingT: p.legClub.swingT, length: p.legClub.length, facing: p.facing, hand: { ...r.hand }, knee: { ...r.knee }, hip: { ...r.hip }, vx: r.vx, vy: r.vy });
        if (window.__whipSampling) requestAnimationFrame(sample);
      }; sample();
    });
    await page.screenshot({ path: `${output}/held-leg-rest.png` });
    await page.keyboard.down('KeyD'); await page.waitForTimeout(600); await page.keyboard.up('KeyD');
    await page.screenshot({ path: `${output}/held-leg-braking.png` });
    await page.keyboard.down('KeyA'); await page.waitForTimeout(500);
    await page.keyboard.press('Space', { delay: 180 }); await page.keyboard.up('KeyA');
    await page.screenshot({ path: `${output}/held-leg-jump.png` }); await page.waitForTimeout(1000);
    await page.mouse.move(950, 360); await page.keyboard.press('KeyF'); await page.waitForTimeout(130);
    await page.screenshot({ path: `${output}/held-leg-whip.png` }); await page.waitForTimeout(1100);
    await page.setViewportSize({ width: 720, height: 480 }); await page.waitForTimeout(200);
    await page.screenshot({ path: `${output}/held-leg-compact.png` }); await page.setViewportSize({ width: 1280, height: 720 });
    report.whip = await page.evaluate(() => { window.__whipSampling = false; return window.__whipSamples; });
    for (const s of report.whip) {
      assert.ok(Math.abs(Math.hypot(s.hand.x - s.knee.x, s.hand.y - s.knee.y) - s.length * .55) < .001, 'Grip-to-knee length stays fixed');
      assert.ok(Math.abs(Math.hypot(s.hip.x - s.knee.x, s.hip.y - s.knee.y) - s.length * .45) < .001, 'Thigh never detaches from its knee');
      assert.ok([s.vx, s.vy, s.hip.x, s.hip.y].every(Number.isFinite));
    }
    const bends = report.whip.map(s => Math.atan2(s.hip.y - s.knee.y, s.hip.x - s.knee.x));
    assert.ok(Math.max(...bends) - Math.min(...bends) > .8, 'Loose thigh responds to movement and the wrist stroke');
    const owner = (await sample()).weaver; assert.ok(owner);
    await execConsoleCommand(page, `tp ${Math.round(owner.x - 35)} ${Math.round(owner.y)}`); await execConsoleCommand(page, 'god off');
  }
  for (let step = 0; step < (trickshot ? 300 : 130); step++) {
    if (trickshot && !whip && step % 24 === 0) await positionForContact();
    const state = await sample(); report.samples.push(state);
    if (trickshot && !state.weaver) break;
    assert.ok(state.weaver, 'The wounded resident survives to be smacked');
    if ((!trickshot || whip) && state.player.club?.durability < report.collected.player.club.durability) break;
    if (whip && Math.abs(state.player.y - state.weaver.y) > 55) {
      await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
      await execConsoleCommand(page, `tp ${Math.round(state.weaver.x - 24)} ${Math.round(state.weaver.y)}`); await execConsoleCommand(page, 'god off');
      continue;
    }
    const delta = state.weaver.x - state.player.x;
    if (Math.abs(delta) > 29) {
      await page.keyboard.up(delta > 0 ? 'KeyA' : 'KeyD'); await page.keyboard.down(delta > 0 ? 'KeyD' : 'KeyA');
    } else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
    const aim = await page.evaluate(() => {
      const c = window.__game.ctx, e = window.__salvageWeaver, r = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
      return { x: r.left + ((e.weaverLoco?.px ?? e.x) - c.camera.renderX) / 640 * r.width,
        y: r.top + ((e.weaverLoco?.py ?? e.y - 7) - c.camera.renderY) / 360 * r.height };
    });
    await page.mouse.move(aim.x, aim.y);
    if (Math.abs(delta) < 48 && step % 4 === 0) await page.keyboard.press('KeyF');
    if ((!trickshot || whip) && step % 23 === 20) await page.keyboard.press('Space', { delay: 120 });
    await page.waitForTimeout(80);
  }
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
  report.smacked = await sample();
  assert.ok(report.smacked.player.club?.durability < report.collected.player.club.durability, 'The recovered leg lands its delayed melee strike');
  assert.ok(!report.smacked.weaver || report.smacked.weaver.hp < report.collected.weaver.hp);
  if (trickshot && !whip) {
    assert.equal(report.smacked.weaver, null, 'Real club strikes finish the owner');
    assert.equal(report.smacked.trickshot?.label, 'RETURNED WITH INTEREST');
    assert.ok(report.samples.some(s => s.trickshot?.remainingMs > 0 && s.trickshot.scale < .5));
  }
  await page.screenshot({ path: `${output}/${trickshot ? 'weaver-humiliation' : 'weaver-leg-smack'}.png` });
  await page.waitForTimeout(1300);
  const id = whip ? 'weaver-whip' : trickshot ? 'weaver-humiliation' : 'weaver-salvage';
  await finishGameplayCapture(page, `${output}/${id}.webm`);
  archiveGameplayClip(id, whip ? 'Borrowed leg · hinged knee and momentum' : trickshot ? 'Returned with interest · trickshot experiment' : 'Borrowed leg: shoot, collect, smack', `${output}/${id}.webm`, `${output}/${whip ? 'held-leg-whip' : trickshot ? 'weaver-humiliation' : 'weaver-leg-smack'}.png`, report.setup);
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = String(error); await page.screenshot({ path: `${output}/weaver-salvage-failure.png` }); throw error;
} finally { writeFileSync(`${output}/${whip ? 'weaver-whip' : trickshot ? 'weaver-humiliation' : 'weaver-salvage'}.json`, JSON.stringify(report, null, 2)); await browser.close(); }

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

const seed = Number(process.argv[3] ?? 777), resume = process.argv.includes('--resume'), skip = process.argv.includes('--skip');
const large = process.argv.includes('--large'), comfort = process.argv.includes('--comfort');
const output = `verify-out/tea-machine-${seed}${resume ? '-resume' : skip ? '-skip' : ''}${large ? '-large' : ''}`; mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { errors: [], stages: [], seed, resume, skip, setup: 'Canonical fresh D1. Walk to the crank and press the real Use key; no material, stage, body or hit injection.' };
page.on('pageerror', e => report.errors.push(String(e)));
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5198/');
  await execConsoleCommand(page, resume ? `run new --seed ${seed}` : `run test --level d1 --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  if (large || comfort) {
    await page.locator('#expedition-pause').click(); await page.locator('#pause-settings').click();
    if (large) await page.locator('[name="textScale"]').selectOption('1.3');
    if (comfort) { await page.locator('[name="cameraShake"]').uncheck(); await page.locator('[name="reducedFlashes"]').check(); }
    await page.locator('#player-settings button[value="close"]').click(); await page.keyboard.press('Escape');
  }
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__game.ctx.player.x > 418, null, { timeout: 30000 });
  await page.keyboard.up('KeyD'); await page.waitForTimeout(250);
  report.before = await page.evaluate(() => { const c = window.__game.ctx; return { x: c.player.x, y: c.player.y, hp: c.player.hp }; });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__game.ctx.contraption.watching, null, { timeout: 10000 });
  await page.keyboard.down('KeyD'); await page.keyboard.press('KeyV'); await page.mouse.click(750, 400);
  await page.waitForTimeout(350); await page.keyboard.up('KeyD');
  assert.deepEqual(await page.evaluate(() => { const p=window.__game.ctx.player;return {x:p.x,y:p.y,hp:p.hp}; }), report.before);
  assert.equal(await page.evaluate(() => window.__game.ctx.levels.current.living.glowseeds), 3);
  await page.evaluate(() => {
    window.teaProbe = { pistonMin: 1000, steamMax: 0, maxDuckTilt: 0, maxDuckDrift: 0, maxPanPerTick: 0 };
    let previousCamera = null;
    const sample = () => {
      const c = window.__game.ctx, p = c.rigidBodies.bodies.find(b => b.tag === 'tea-piston');
      const duck = c.rigidBodies.bodies.find(b => b.tag === 'tea-duck');
      if (duck) { window.teaProbe.maxDuckTilt = Math.max(window.teaProbe.maxDuckTilt, Math.abs(duck.angle));
        window.teaProbe.maxDuckDrift = Math.max(window.teaProbe.maxDuckDrift, Math.abs(duck.x - 967)); }
      if (c.contraption.watching && previousCamera && c.state.frameCount > previousCamera.frame) {
        window.teaProbe.maxPanPerTick = Math.max(window.teaProbe.maxPanPerTick,
          Math.hypot(c.camera.x - previousCamera.x, c.camera.y - previousCamera.y) / (c.state.frameCount - previousCamera.frame));
      }
      previousCamera = { x: c.camera.x, y: c.camera.y, frame: c.state.frameCount };
      if (p) { let n = 0; for(let x=Math.floor(p.x-10);x<=p.x+10;x++)for(let y=Math.ceil(p.y+4);y<=Math.ceil(p.y+4)+5;y++)if(c.world.type(x,y)===9)n++;
        window.teaProbe.pistonMin=Math.min(window.teaProbe.pistonMin,p.y); window.teaProbe.steamMax=Math.max(window.teaProbe.steamMax,n); }
      requestAnimationFrame(sample);
    }; sample();
  });
  let previous = -1, resumed = false, skipped = false, compact = false;
  for (let i = 0; i < 140; i++) {
    const data = await page.evaluate(() => {
      const c = window.__game.ctx, s = c.levels.current.living.tea;
      return { stage: s.stage, ticks: s.ticks, stageTicks: s.stageTicks, complete: s.completed, stalled: s.stalled,
        travel: s.travel, bodies: s.bodies, probe: window.teaProbe, watching: c.contraption.watching, player: { x: c.player.x, y: c.player.y, hp: c.player.hp },
        camera: { x: c.camera.x, y: c.camera.y, zoom: c.camera.zoom },
        materials: (() => { const result = {}; for (const [name,x0,y0,x1,y1] of [['acid',1090,110,1170,240],['boiler',1214,94,1268,238],['finale',1298,200,1532,258]]) {
          const counts = {}; for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const t=c.world.type(x,y);counts[t]=(counts[t]??0)+1;}result[name]=counts;
        } return result; })() };
    });
    if (data.stage !== previous) {
      report.stages.push(data); previous = data.stage; console.log(JSON.stringify({ stage: data.stage, ticks: data.ticks, travel: data.travel, probe: data.probe }));
      await page.screenshot({ path: `${output}/stage-${data.stage}.png` });
    }
    if (!compact && data.stage === 4 && data.watching) {
      await page.setViewportSize({ width: 720, height: 480 });
      await page.screenshot({ path: `${output}/compact-duck.png` });
      assert.ok(await page.locator('#tea-view button').isVisible());
      await page.setViewportSize({ width: 1440, height: 900 }); compact = true;
    }
    if (skip && !skipped && data.stage >= 2) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !window.__game.ctx.contraption.watching);
      assert.equal(await page.evaluate(() => window.__game.ctx.state.paused), false); skipped = true;
    }
    if (resume && !resumed && data.stage >= 4 && (data.travel?.acid ?? 0) > 0) {
      await execConsoleCommand(page, 'run save');
      await page.waitForFunction(() => window.__game.ctx.levels.persistenceStatus().state === 'ready');
      report.savedStage = await page.evaluate(() => window.__game.ctx.levels.current.living.tea.stage);
      report.savedTravel = await page.evaluate(() => window.__game.ctx.levels.current.living.tea.travel);
      await page.reload(); await execConsoleCommand(page, 'run continue'); await waitForRunReady(page);
      await page.waitForFunction(() => window.__game.ctx.rigidBodies.bodies.filter(b => b.tag?.startsWith('tea-')).length === 15);
      assert.equal(await page.evaluate(() => window.__game.ctx.contraption.watching), false);
      assert.ok(await page.evaluate(stage => window.__game.ctx.levels.current.living.tea.stage >= stage, report.savedStage));
      assert.equal(await page.evaluate(() => window.__game.ctx.rigidBodies.bodies.filter(b => b.tag?.startsWith('tea-')).length), 15);
      assert.ok(await page.evaluate(travel => window.__game.ctx.levels.current.living.tea.travel.acid >= travel.acid, report.savedTravel));
      resumed = true;
    }
    report.last = data;
    if (comfort) assert.ok(data.camera.zoom <= 1.025, 'Comfort preference suppresses close camera zoom');
    if (data.complete && data.watching) {
      await page.setViewportSize({ width: 720, height: 480 });
      await page.screenshot({ path: `${output}/compact-completion.png` });
      const rect = await page.locator('#tea-view .tea-caption').boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 721 && rect.y >= 0 && rect.y + rect.height <= 481);
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    if (data.complete || data.stalled) break;
    await page.waitForTimeout(1000);
  }
  assert.equal(report.last.complete, true, JSON.stringify(report.last));
  if (!resume) {
    assert.ok(report.last.probe.maxDuckTilt < .001); assert.ok(report.last.probe.maxDuckDrift < .01);
    assert.ok(report.last.probe.maxPanPerTick <= 2.401, 'Camera travel stays under its speed cap');
  }
  assert.ok(report.last.travel.bell >= 12, 'The electrical counterweight must lift the final bell latch');
  assert.deepEqual(report.errors, []);
  await page.waitForFunction(() => !window.__game.ctx.contraption.watching, null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.__game.ctx.camera.actionFocus), null);
  await page.keyboard.down('KeyD'); await page.waitForTimeout(500); await page.keyboard.up('KeyD');
  assert.ok(await page.evaluate(x => window.__game.ctx.player.x > x + 10, report.before.x));
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__game.ctx.player.x > 1528, null, { timeout: 20000 });
  await page.keyboard.up('KeyD'); await page.keyboard.down('Space'); await page.waitForTimeout(800); await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__game.ctx.levels.current.keyTaken, null, { timeout: 6000 });
  report.bellCollected = true;
  console.log('PASS: physical chain completed, player control returned, bell collected through the real catwalk.');
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${output}/last.png` }).catch(() => {});
  await browser.close();
}

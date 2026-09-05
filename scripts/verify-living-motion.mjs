import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const output = 'verify-out/living-descent/motion'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scenes: [], setup: 'Disposable seeded run; console positions each encounter. Movement, jump, lure and casting use actual inputs. MediaRecorder observes the canvas and real master audio output.' };
page.on('pageerror', e => report.errors.push(String(e)));
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  for (const [name, x, y] of [['weaver', 1155, 389], ['rillback', 677, 324]]) {
    await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
    await waitForRunReady(page); await execConsoleCommand(page, `tp ${x} ${y}`); await execConsoleCommand(page, 'god off');
    await page.waitForTimeout(4500); await page.keyboard.press('Space', { delay: 90 });
    await page.evaluate(() => {
      const ctx = window.__game.ctx, engine = ctx.audio;
      engine.ensure();
      const stream = document.querySelector('#canvas-holder > canvas').captureStream(30);
      const audio = engine.audioCtx.createMediaStreamDestination(); engine.masterGain.connect(audio);
      for (const track of audio.stream.getAudioTracks()) stream.addTrack(track);
      const chunks = [], recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 2500000 });
      recorder.ondataavailable = event => chunks.push(event.data);
      const fixture = { recorder, chunks, audio, samples: [], interval: null };
      fixture.interval = setInterval(() => fixture.samples.push({ tick: ctx.state.frameCount, voices: engine.voices,
        player: { x: ctx.player.x, y: ctx.player.y, hp: ctx.player.hp },
        creatures: ctx.enemies.map(e => ({ kind: e.kind, x: e.x, y: e.y, intent: e.mind?.intent, windup: e.windup, flash: e.flash,
          support: e.weaverSupport, mode: e.weaverLoco?.mode, body: e.body?.nodes.map(n => ({ x: n.x, y: n.y, contact: n.contact })) })) }), 250);
      window.__motionCapture = fixture; recorder.start();
    });
    for (let step = 0; step < 6; step++) {
      if (step === 1) await page.keyboard.press('KeyV');
      if (step === 2) await page.keyboard.down('KeyD');
      if (step === 3) { await page.keyboard.up('KeyD'); await page.keyboard.press('Space', { delay: 100 }); }
      if (step === 3 && name === 'weaver') {
        const aim = await page.evaluate(() => {
          const ctx = window.__game.ctx, enemy = ctx.enemies.find(e => e.kind === 'weaver');
          const rect = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
          return { x: rect.left + (enemy.x - ctx.camera.renderX) / 640 * rect.width,
            y: rect.top + (enemy.y - 9 - ctx.camera.renderY) / 360 * rect.height };
        });
        await page.mouse.move(aim.x, aim.y); await page.mouse.down();
        try {
          await page.waitForFunction(() => window.__game.ctx.enemies.some(e => e.kind === 'weaver' && e.flash > 0), null, { timeout: 2500 });
          await page.screenshot({ path: `${output}/weaver-hit.png` }); report.hitCaptured = true;
        } catch { report.hitCaptured = false; }
        await page.mouse.up();
      }
      if (step === 4) await page.keyboard.down('KeyA');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${output}/${name}-${step}.png` });
    }
    await page.keyboard.up('KeyA');
    const capture = await page.evaluate(async () => {
      const c = window.__motionCapture;
      clearInterval(c.interval);
      const blob = await new Promise(resolve => { c.recorder.onstop = () => resolve(new Blob(c.chunks, { type: 'video/webm' })); c.recorder.stop(); });
      window.__game.ctx.audio.masterGain.disconnect(c.audio);
      for (const track of c.recorder.stream.getTracks()) track.stop();
      const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
      return { data, samples: c.samples };
    });
    writeFileSync(`${output}/${name}.webm`, Buffer.from(capture.data.split(',')[1], 'base64'));
    assert.ok(capture.samples.length > 20); assert.ok(capture.samples.every(s => s.voices <= 32));
    report.scenes.push({ name, samples: capture.samples });
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/evidence.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

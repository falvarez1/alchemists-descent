// Release build check: public UI and actual media, no window.__game debug API.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
const browser = await launchBrowser({ args: ['--autoplay-policy=user-gesture-required'] });
const requests = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => { if (/arena[./].*\.mp3/.test(r.url())) requests.push({ url: r.url(), status: r.status() }); });
  await page.addInitScript(() => {
    window.probeAudio = [];
    const NativeAudio = window.Audio;
    window.Audio = function(...args) { const el = new NativeAudio(...args); window.probeAudio.push(el); return el; };
    window.Audio.prototype = NativeAudio.prototype;
  });
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5218/') + '?link=off', { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => typeof window.__game), 'undefined');
  assert.equal(requests.length, 0);
  await page.locator('[data-entry="duel"]').click();
  await page.waitForFunction(() => window.probeAudio.some(el => el.src.includes('arena-lobby.mp3') && !el.paused && el.currentTime > 0.1));
  await page.getByRole('button', { name: 'Ready player 1', exact: true }).click();
  await page.locator('#versus-start').click();
  await page.waitForFunction(() => window.probeAudio.some(el => el.src.includes('arena-battle.mp3') && !el.paused && el.currentTime > 0.3));
  await page.waitForTimeout(10000);
  const battle = await page.evaluate(() => { const el = window.probeAudio.findLast(el => el.src.includes('arena-battle.mp3')); return { time: el.currentTime, duration: el.duration, loop: el.loop, paused: el.paused }; });
  assert.ok(battle.time > 2 && battle.loop && !battle.paused);
  const sfx = [...new Set(requests.filter(r => /\/assets\/arena\./.test(r.url)).map(r => r.url))];
  assert.equal(sfx.length, 23, 'all premium SFX takes load from hashed production assets');
  assert.ok(requests.every(r => r.status === 200 || r.status === 206));
  await page.keyboard.press('Escape'); await page.locator('#pause-title-btn').click();
  await page.waitForFunction(() => window.probeAudio.some(el => /\/title\.mp3/.test(el.src) && !el.paused && el.currentTime > 0.1));
  assert.deepEqual(errors, []);
  const result = { debugApiAbsent: true, battle, sfxCount: sfx.length, requests, errors };
  writeFileSync('docs/arena/platform-fighter/evidence/arena-audio-production.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ battle, sfxCount: sfx.length, errors }, null, 2));
} finally { await browser.close(); }

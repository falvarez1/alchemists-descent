// Clips runtime probe (dev server running): rolling capture + GIF export.
//
//   node scripts/verify-clips.mjs [url] [--out <dir>]
//
// Starts a run from the entry screen with real clicks, sets off a real
// explosion, presses the clip hotkey, downloads the GIF through the card's
// Download button, validates the file (structure, frames, size), decodes
// frames back to PNG (a contact sheet to LOOK at), measures capture overhead
// and encode time, then dies and saves a clip from the death screen.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:/.test(a)) || 'http://localhost:5173/';
const outIndex = args.indexOf('--out');
const out = resolve(outIndex >= 0 ? args[outIndex + 1] : 'verify-out/clips');
mkdirSync(out, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

/** Walk the GIF block structure (throws on a malformed stream). */
function parseGif(buf) {
  const sig = buf.toString('ascii', 0, 6);
  const w = buf.readUInt16LE(6);
  const h = buf.readUInt16LE(8);
  const packed = buf[10];
  const gctColors = packed & 0x80 ? 1 << ((packed & 7) + 1) : 0;
  let p = 13 + gctColors * 3;
  let frames = 0;
  let loop = null;
  let trailer = false;
  const delays = [];
  let transparentFrames = 0;
  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3b) {
      trailer = true;
      break;
    }
    if (b === 0x21) {
      const label = buf[p++];
      if (label === 0xf9) {
        const size = buf[p];
        const flags = buf[p + 1];
        delays.push(buf.readUInt16LE(p + 2));
        if (flags & 1) transparentFrames++;
        p += size + 2;
        continue;
      }
      if (label === 0xff) {
        const size = buf[p];
        const app = buf.toString('ascii', p + 1, p + 1 + size);
        p += size + 1;
        while (buf[p] !== 0) {
          if (app.startsWith('NETSCAPE')) loop = buf.readUInt16LE(p + 2);
          p += buf[p] + 1;
        }
        p++;
        continue;
      }
      while (buf[p] !== 0) p += buf[p] + 1;
      p++;
      continue;
    }
    if (b === 0x2c) {
      frames++;
      const fw = buf.readUInt16LE(p + 4);
      const fh = buf.readUInt16LE(p + 6);
      if (fw !== w || fh !== h) throw new Error(`frame ${frames} is ${fw}x${fh}, screen ${w}x${h}`);
      const lp = buf[p + 8];
      p += 9;
      if (lp & 0x80) p += 3 * (1 << ((lp & 7) + 1));
      p++; // LZW minimum code size
      while (buf[p] !== 0) p += buf[p] + 1;
      p++;
      continue;
    }
    throw new Error(`bad block 0x${b.toString(16)} at ${p - 1}`);
  }
  return { sig, w, h, gctColors, frames, loop, trailer, delays, transparentFrames, totalMs: delays.reduce((a, d) => a + d * 10, 0) };
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('console: ' + m.text());
});

const clickEl = async (selector) => {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 30000 });
  const box = await loc.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/** Contact sheet + individual PNGs, decoded by the browser's own GIF decoder (ImageDecoder composites disposal/transparency). */
async function extractFrames(gifPath, prefix, picks) {
  const b64 = readFileSync(gifPath).toString('base64');
  const result = await page.evaluate(async ({ b64, picks }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const decoder = new ImageDecoder({ data: bytes, type: 'image/gif' });
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack.frameCount;
    const indices = picks.map((f) => Math.min(count - 1, Math.max(0, Math.round(f * (count - 1)))));
    const shots = [];
    let fw = 0;
    let fh = 0;
    const sheetCols = 3;
    const frames = [];
    for (const index of indices) {
      const { image } = await decoder.decode({ frameIndex: index });
      fw = image.displayWidth;
      fh = image.displayHeight;
      const c = document.createElement('canvas');
      c.width = fw;
      c.height = fh;
      c.getContext('2d').drawImage(image, 0, 0);
      image.close();
      frames.push(c);
      shots.push({ index, url: c.toDataURL('image/png') });
    }
    const rows = Math.ceil(frames.length / sheetCols);
    const sheet = document.createElement('canvas');
    sheet.width = fw * sheetCols + (sheetCols - 1) * 4;
    sheet.height = fh * rows + (rows - 1) * 4;
    const g = sheet.getContext('2d');
    g.fillStyle = '#222';
    g.fillRect(0, 0, sheet.width, sheet.height);
    frames.forEach((c, i) => g.drawImage(c, (i % sheetCols) * (fw + 4), Math.floor(i / sheetCols) * (fh + 4)));
    decoder.close();
    return { count, shots, sheet: sheet.toDataURL('image/png') };
  }, { b64, picks });
  const write = (name, dataUrl) => writeFileSync(join(out, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
  for (const s of result.shots) write(`${prefix}-frame-${String(s.index).padStart(3, '0')}.png`, s.url);
  write(`${prefix}-sheet.png`, result.sheet);
  return result.count;
}

console.log(`clips probe → ${url}\n  out: ${out}`);
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ctx?.playerCtl && window.__game.clips, { timeout: 30000 });

// ---- the title screen does not record ----
await page.waitForSelector('[data-entry="begin"]', { state: 'visible', timeout: 30000 });
await page.waitForTimeout(1200);
const titleHeld = await page.evaluate(() => window.__game.clips.stats().heldFrames);
check('title screen is not captured', titleHeld === 0, `held=${titleHeld}`);

await page.evaluate(() => {
  window.__clips = [];
  window.__game.ctx.events.on('clipSaved', (e) => window.__clips.push(e));
});
await clickEl('[data-entry="begin"]');
await page.waitForFunction(() => {
  const ctx = window.__game.ctx;
  return ctx.state.mode === 'play' && !ctx.state.paused && !document.body.classList.contains('entry-active');
}, { timeout: 60000 });
// Let the opening settle, then keep the alchemist alive for the blast.
await page.waitForTimeout(2500);

// ---- a real explosion in view: a gunpowder bed on a metal tray, lit ----
// Painted straight into the grid (the console's fill would taint the run into
// god mode and put the QA tools in every frame).
const blast = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  ctx.player.invuln = 100000;
  const px = Math.floor(ctx.player.x);
  const py = Math.floor(ctx.player.y);
  const bx = px + 80;
  let powder = 0;
  const put = (x, y, t, color, life = 0) => {
    if (!w.inBounds(x, y)) return;
    const i = w.idx(x, y);
    w.replaceCellAt(i, t, color);
    w.life[i] = life;
    if (t === 8) powder++;
  };
  // Metal tray (13) so the powder sits where the camera can see it.
  for (let x = bx - 30; x <= bx + 30; x++) put(x, py - 12, 13, 0x6d747a);
  for (let y = py - 40; y <= py - 12; y++) { put(bx - 30, y, 13, 0x6d747a); put(bx + 30, y, 13, 0x6d747a); }
  for (let y = py - 36; y < py - 12; y++) for (let x = bx - 29; x < bx + 30; x++) put(x, y, 8, 0x3b3a36 + ((x * 7 + y * 13) % 5) * 0x010101);
  for (let x = bx - 4; x <= bx + 4; x++) for (let y = py - 44; y < py - 38; y++) put(x, y, 5, 0xff8a2a, 40);
  return { px, py, bx, powder };
});
check('painted a gunpowder bed and lit it', blast.powder > 1000, JSON.stringify(blast));
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.explosions.trigger(Math.floor(ctx.player.x) + 80, Math.floor(ctx.player.y) - 26, 14);
});
await page.waitForTimeout(1200);

// ---- capture overhead over a steady window ----
await page.evaluate(() => window.__game.clips.resetStats());
await page.waitForTimeout(6000);
const cost = await page.evaluate(() => window.__game.clips.stats());
console.log(`  capture per frame: avg ${cost.perFrame.avg.toFixed(3)} ms, p95 ${cost.perFrame.p95.toFixed(3)} ms (n=${cost.perFrame.n})`);
console.log(`  per captured frame: avg ${cost.perCapture.avg.toFixed(3)} ms, p95 ${cost.perCapture.p95.toFixed(3)} ms (n=${cost.perCapture.n})`);
console.log(`  ring: ${cost.heldFrames}/${cost.capacity} frames at ${cost.width}x${cost.height}; RGB565 ring ${(cost.ringBytes / 1048576).toFixed(1)} MB vs ImageBitmap ring ${(cost.bitmapRingBytes / 1048576).toFixed(1)} MB`);
check('capture cost ≤ 0.3 ms/frame average', cost.perFrame.avg <= 0.3, `${cost.perFrame.avg.toFixed(3)} ms`);
check('capture runs at ~15 fps', cost.perCapture.n >= 6 * 13 && cost.perCapture.n <= 6 * 16.5, `n=${cost.perCapture.n} over 6 s`);

// ---- paused menus hold the ring still ----
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.__game.ctx.state.paused, { timeout: 5000 });
await page.evaluate(() => window.__game.clips.resetStats());
await page.waitForTimeout(1000);
const pausedCaptures = await page.evaluate(() => window.__game.clips.stats().perCapture.n);
check('no capture while paused', pausedCaptures === 0, `captures=${pausedCaptures}`);
await page.keyboard.press('Escape');
await page.waitForFunction(() => !window.__game.ctx.state.paused, { timeout: 5000 });
await page.waitForTimeout(1500);

// ---- hotkey → shutter → developing card → saved clip ----
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.explosions.trigger(Math.floor(ctx.player.x) - 50, Math.floor(ctx.player.y) - 26, 20);
});
await page.waitForTimeout(700);
const t0 = Date.now();
await page.keyboard.press('KeyP');
await page.waitForTimeout(90);
await page.screenshot({ path: join(out, 'card-shutter.png') });
await page.waitForTimeout(160);
await page.screenshot({ path: join(out, 'card-developing.png') });
await page.waitForFunction(() => window.__clips.length >= 1, { timeout: 45000 });
const saveMs = Date.now() - t0;
await page.waitForFunction(() => document.querySelector('#clip-card')?.dataset.state === 'ready', { timeout: 10000 });
await page.waitForTimeout(1300); // let the reveal land
await page.screenshot({ path: join(out, 'card-ready.png') });
const cardBox = await page.locator('#clip-card').boundingBox();
await page.screenshot({ path: join(out, 'card-ready-crop.png'), clip: { x: cardBox.x - 12, y: cardBox.y - 12, width: cardBox.width + 24, height: cardBox.height + 24 } });
const saved = await page.evaluate(() => ({ ...window.__clips[0], stats: window.__game.clips.stats().lastEncode, paused: window.__game.ctx.state.paused }));
check('a full ring (10 s) went into the clip', saved.stats.sourceFrames >= 148, `sourceFrames=${saved.stats.sourceFrames}`);
console.log(`  clipSaved: ${saved.filename} ${(saved.bytes / 1048576).toFixed(2)} MB, ${saved.frames} frames, ${(saved.durationMs / 1000).toFixed(1)} s, request→saved ${saveMs} ms`);
console.log(`  encode: ${saved.stats.encodeMs.toFixed(0)} ms (palette ${saved.stats.paletteMs.toFixed(0)} ms, ${saved.stats.paletteColors} colours, passes ${saved.stats.passes}, stride ${saved.stats.frameStride})`);
check('card does not pause play', saved.paused === false);
check('filename is breathing-works-YYYYMMDD-HHMMSS.gif', /^breathing-works-\d{8}-\d{6}\.gif$/.test(saved.filename), saved.filename);
check('clipSaved carries an object URL', /^blob:/.test(saved.url), saved.url);
check('clip is under 8 MB', saved.bytes < 8 * 1024 * 1024, `${saved.bytes} bytes`);

// Download through the card's real button.
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), clickEl('#clip-card .clip-download')]);
const gifPath = join(out, download.suggestedFilename());
await download.saveAs(gifPath);
const gifBuf = readFileSync(gifPath);
let parsed = null;
try {
  parsed = parseGif(gifBuf);
} catch (error) {
  check('GIF parses', false, String(error));
}
if (parsed) {
  console.log(`  GIF: ${parsed.sig} ${parsed.w}x${parsed.h}, ${parsed.frames} frames, ${(parsed.totalMs / 1000).toFixed(2)} s, loop=${parsed.loop}, gct=${parsed.gctColors}, transparent-diff frames=${parsed.transparentFrames}, ${(gifBuf.length / 1048576).toFixed(2)} MB`);
  check('downloaded file is a GIF89a', parsed.sig === 'GIF89a' && parsed.trailer);
  check('GIF is ~480 px wide at the canvas aspect', parsed.w === 480 && parsed.h === 270, `${parsed.w}x${parsed.h}`);
  check('GIF is animated and loops forever', parsed.frames >= 60 && parsed.loop === 0, `frames=${parsed.frames} loop=${parsed.loop}`);
  check('GIF runs ~10 s', parsed.totalMs >= 8500 && parsed.totalMs <= 11500, `${parsed.totalMs} ms`);
  check('downloaded bytes match clipSaved', gifBuf.length === saved.bytes, `${gifBuf.length} vs ${saved.bytes}`);
  const decoded = await extractFrames(gifPath, 'hotkey', [0, 0.2, 0.4, 0.6, 0.8, 1]);
  check('browser decodes every frame', decoded === parsed.frames, `${decoded} vs ${parsed.frames}`);
}

// Copy: exercise the button (headless clipboard may refuse; either message is fine).
const feedbackBefore = await page.textContent('#clip-card .clip-feedback');
await clickEl('#clip-card .clip-copy');
await page.waitForFunction((prev) => {
  const text = document.querySelector('#clip-card .clip-feedback')?.textContent ?? '';
  return text.length > 0 && text !== prev;
}, feedbackBefore, { timeout: 5000 });
const copyText = await page.textContent('#clip-card .clip-feedback');
check('Copy answers (GIF, a still, or an honest refusal)', /^Copied|clipboard declined/.test(copyText), copyText);
await clickEl('#clip-card .clip-dismiss');
await page.waitForFunction(() => document.querySelector('#clip-card')?.hidden === true, { timeout: 3000 });
check('card dismisses', true);

// ---- death → death-screen button → the fall is kept ----
await page.waitForTimeout(3500); // refill some ring after the encode freeze
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.debugGodMode = false;
  ctx.player.invuln = 0;
  ctx.player.hp = 1;
  ctx.explosions.trigger(Math.floor(ctx.player.x) + 12, Math.floor(ctx.player.y) - 10, 16);
  ctx.player.invuln = 0;
  if (!ctx.player.dead) ctx.playerCtl.damage(999, 0, 0, 'explosion');
});
await page.waitForFunction(() => window.__game.ctx.player.dead, { timeout: 5000 });
await page.waitForFunction(() => document.getElementById('gameover-overlay')?.classList.contains('visible'), { timeout: 15000 });
await page.waitForTimeout(3300); // title card + fade-ins
const heldAtDeath = await page.evaluate(() => window.__game.clips.stats().heldFrames);
await page.screenshot({ path: join(out, 'death-screen.png') });
const deathBtn = await page.evaluate(() => {
  const b = document.getElementById('go-clip-btn');
  const r = b?.getBoundingClientRect();
  return b ? { text: b.textContent, visible: !!r && r.width > 0 && getComputedStyle(b).opacity !== '0', hidden: b.hidden } : null;
});
check('death screen offers "Save the last seconds"', deathBtn?.visible && /Save the last seconds/.test(deathBtn.text), JSON.stringify(deathBtn));
const before = await page.evaluate(() => window.__game.clips.stats().perCapture.n);
await page.waitForTimeout(800);
const after = await page.evaluate(() => window.__game.clips.stats().perCapture.n);
check('ring holds still on the death screen', after === before, `${before} → ${after}`);
await clickEl('#go-clip-btn');
await page.waitForFunction(() => window.__clips.length >= 2, { timeout: 45000 });
await page.waitForFunction(() => document.querySelector('#clip-card')?.dataset.state === 'ready', { timeout: 10000 });
await page.waitForTimeout(1300);
await page.screenshot({ path: join(out, 'death-card.png') });
const deathClip = await page.evaluate(() => window.__clips[1]);
const [download2] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), clickEl('#clip-card .clip-download')]);
const gifPath2 = join(out, 'death-' + download2.suggestedFilename());
await download2.saveAs(gifPath2);
const parsed2 = parseGif(readFileSync(gifPath2));
console.log(`  death clip: ${parsed2.w}x${parsed2.h}, ${parsed2.frames} frames, ${(parsed2.totalMs / 1000).toFixed(2)} s, ${(deathClip.bytes / 1048576).toFixed(2)} MB, held at death ${heldAtDeath}`);
check('death clip saved from the death screen', parsed2.frames >= 30 && deathClip.bytes < 8 * 1024 * 1024);
await extractFrames(gifPath2, 'death', [0, 0.25, 0.5, 0.7, 0.85, 1]);

// ---- settings: Record clips off → no capture, a gentle toast ----
await page.evaluate(() => window.__game.ctx.playerCtl.respawn());
await page.waitForFunction(() => !window.__game.ctx.player.dead, { timeout: 10000 });
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.__game.ctx.state.paused, { timeout: 5000 });
await clickEl('#pause-settings');
await clickEl('#player-settings [name="recordClips"]');
const recordOff = await page.evaluate(() => document.querySelector('#player-settings [name="recordClips"]').checked === false && localStorage.getItem('ad-clip-recording-v1') === 'off');
check('Record clips toggle persists off', recordOff);
await page.keyboard.press('Escape'); // close dialog
await page.waitForTimeout(300);
if (await page.evaluate(() => window.__game.ctx.state.paused)) await page.keyboard.press('Escape');
await page.waitForFunction(() => !window.__game.ctx.state.paused, { timeout: 5000 });
await page.evaluate(() => window.__game.clips.resetStats());
await page.waitForTimeout(1000);
const offStats = await page.evaluate(() => window.__game.clips.stats());
check('recording off: nothing captured, ring released', offStats.perCapture.n === 0 && offStats.heldFrames === 0, JSON.stringify({ n: offStats.perCapture.n, held: offStats.heldFrames }));
await page.keyboard.press('KeyP');
await page.waitForTimeout(300);
const toast = await page.evaluate(() => Array.from(document.querySelectorAll('#toast-stack .toast')).map((t) => t.textContent).join(' | '));
check('hotkey with recording off explains itself', /Clip recording is off/.test(toast), toast);
// Restore the default for the next run of this probe.
await page.evaluate(() => localStorage.removeItem('ad-clip-recording-v1'));

// ---- the Handbook names the key (live binding) ----
await page.keyboard.press('KeyH');
await clickEl('#hb-tab-clips');
await page.waitForTimeout(250);
const handbook = await page.textContent('#help-overlay .hb-page');
const firstKey = await page.textContent('#help-overlay .hb-page dt kbd');
await page.screenshot({ path: join(out, 'handbook-clips.png') });
check('Handbook page lists the clip key', /Keeping a moment/.test(handbook) && firstKey === 'P', `key=${firstKey}`);
await page.keyboard.press('KeyH');

check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
console.log(`\nclips probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

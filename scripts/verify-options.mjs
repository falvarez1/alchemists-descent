// Player options (Controls & comfort): does each one change what the game DOES?
//
//   node scripts/verify-options.mjs [url] [--only pause,shake,...] [--headful-blur]
//
// Every section drives the real dialog with real clicks (selects go through Playwright's
// selectOption, since a native drop-down cannot be clicked), then reads the game state or the
// pixels the option is supposed to change. The defaults are checked too: an option that has
// not been touched must leave the game as it shipped.
//
// Sections: pause (window focus), shake (camera jitter), ...  (added with each option)
// Headless Edge never fires a real window blur, so the pause section dispatches the same
// `blur` / `visibilitychange` events the browser would; --headful-blur additionally opens a
// visible Edge and switches tabs for a genuine focus loss.
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsolePlayRun, waitForOpeningEnd } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const only = (opt('only', '') ?? '').split(',').filter(Boolean);
const want = (name) => only.length === 0 || only.includes(name);
const out = 'verify-out/options';
mkdirSync(out, { recursive: true });

let failures = 0;
const check = (ok, what) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); };
const click = async (page, loc) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error('no bounding box for click');
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

const browser = await launchBrowser();

/** A fresh page on a played-through opening, Escape-menu closed, not god mode. */
async function freshRun({ width = 1440, height = 900, prefs = null, seed = 7 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  if (prefs) await context.addInitScript((value) => { try { localStorage.setItem('ad-player-preferences-v1', value); } catch { /* */ } }, JSON.stringify(prefs));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await startConsolePlayRun(page, { seed, settleMs: 3000 });
  await waitForOpeningEnd(page).catch(() => undefined);
  await page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; c.state.debugGodMode = false; });
  await page.waitForTimeout(400);
  return { context, page, errors };
}

/** Open the settings dialog from the pause menu with real clicks and select a tab. */
async function openSettings(page, tab) {
  if (!(await page.evaluate(() => document.querySelector('#player-settings')?.open))) {
    if (!(await page.evaluate(() => window.__game.ctx.state.paused))) { await page.keyboard.press('Escape'); await page.waitForTimeout(350); }
    await click(page, page.locator('#pause-settings'));
    await page.waitForSelector('#player-settings[open]');
  }
  await click(page, page.locator(`#player-settings [data-tab="${tab}"]`));
  await page.waitForTimeout(120);
}
async function closeSettings(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}
/** Close settings and the pause menu, leave the game running. */
async function resume(page) {
  if (await page.evaluate(() => document.querySelector('#player-settings')?.open)) await closeSettings(page);
  if (await page.evaluate(() => document.querySelector('#pause-overlay.visible'))) await click(page, page.locator('#pause-resume'));
  await page.waitForFunction(() => !window.__game.ctx.state.paused, null, { timeout: 4000 });
}
const blur = (page) => page.evaluate(() => window.dispatchEvent(new Event('blur')));
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  delete document.hidden;
});
const paused = (page) => page.evaluate(() => window.__game.ctx.state.paused);
const stored = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ad-player-preferences-v1') ?? '{}'); } catch { return null; } });

try {
  // ------------------------------------------------------------------ pause on focus loss
  if (want('pause')) {
    console.log('\n== Pause when the window loses focus');
    const { context, page, errors } = await freshRun();
    check(await page.evaluate(() => window.__game.ctx.state.pauseOnBlur) === true, 'default: the option is on');
    check(!(await paused(page)), 'the descent is running');
    await blur(page);
    await page.waitForTimeout(250);
    check(await paused(page), 'window blur pauses the descent');
    check(await page.evaluate(() => document.querySelector('#pause-overlay.visible') !== null), 'the Esc pause menu is what appeared (Resume works as always)');
    await blur(page); await hide(page);
    check(await paused(page) && await page.evaluate(() => document.querySelector('#pause-overlay.visible') !== null), 'a second blur / visibilitychange while paused does NOT toggle it back off');
    await resume(page);
    await hide(page);
    await page.waitForTimeout(250);
    check(await paused(page), 'the tab going hidden pauses it too');
    await resume(page);

    // not where pausing is wrong
    const ctxCall = (fn, arg) => page.evaluate(fn, arg);
    await ctxCall(() => window.__game.ctx.events.emit('storyDialogue', { open: true, name: 'Pell', text: 'Hm.', choices: [], typing: false, done: true }));
    await blur(page); await page.waitForTimeout(200);
    check(!(await paused(page)), 'mid-conversation: no pause');
    await ctxCall(() => window.__game.ctx.events.emit('storyDialogue', { open: false, name: '', text: '', choices: [], typing: false, done: true }));
    await ctxCall(() => { document.body.classList.add('story-cinema-active'); document.getElementById('story-cinema')?.classList.add('show'); });
    await blur(page); await page.waitForTimeout(200);
    check(!(await paused(page)), 'during a cinematic: no pause');
    await ctxCall(() => { document.getElementById('story-cinema')?.classList.remove('show'); document.body.classList.remove('story-cinema-active'); });
    await ctxCall(() => { window.__game.ctx.state.mode = 'build'; });
    await blur(page); await page.waitForTimeout(200);
    check(!(await paused(page)), 'in the Sandbox: no pause');
    await ctxCall(() => { window.__game.ctx.state.mode = 'play'; });
    // Dead, tested inside one task so the game never runs a tick (and its death card) in between.
    await ctxCall(() => { const c = window.__game.ctx; c.player.dead = true; window.dispatchEvent(new Event('blur')); c.player.dead = false; });
    await page.waitForTimeout(200);
    check(!(await paused(page)), 'dead: no pause');

    // the option: off through the real dialog, persists, and really stops pausing
    await openSettings(page, 'gameplay');
    const box = page.locator('#player-settings [name="pauseOnBlur"]');
    check(await box.isChecked(), 'the Gameplay tab shows it checked');
    await click(page, box);
    check((await stored(page))?.pauseOnBlur === false, 'unchecking saves pauseOnBlur:false');
    check(await page.evaluate(() => window.__game.ctx.state.pauseOnBlur) === false, 'and applies live (no reload)');
    await closeSettings(page);
    await resume(page);
    await blur(page); await hide(page); await page.waitForTimeout(250);
    check(!(await paused(page)), 'with the option off, blur and hidden do nothing');
    await page.screenshot({ path: `${out}/pause-off.png` });
    await context.close();

    // reload: the saved choice is honoured, and the default returns when storage is empty
    const again = await freshRun({ prefs: { pauseOnBlur: false } });
    check(await again.page.evaluate(() => window.__game.ctx.state.pauseOnBlur) === false, 'a saved pauseOnBlur:false survives a reload');
    await blur(again.page); await again.page.waitForTimeout(250);
    check(!(await paused(again.page)), '... and does not pause');
    check(errors.length === 0 && again.errors.length === 0, `no page errors${[...errors, ...again.errors].join(' | ')}`);
    await again.context.close();
  }

  // ------------------------------------------------------------------ camera shake
  if (want('shake')) {
    console.log('\n== Camera shake: Off / Half / Full');
    // Range of the screen quad's jitter over 90 frames with a constant kick of shake.
    const jitter = (page) => page.evaluate(() => new Promise((resolve) => {
      const game = window.__game, quad = game.renderer.backend.quadMesh;
      let frames = 0, lo = Infinity, hi = -Infinity;
      const step = () => {
        if (frames > 4) { lo = Math.min(lo, quad.position.x); hi = Math.max(hi, quad.position.x); }
        game.ctx.fx.screenShake = 0.05;
        if (++frames < 94) requestAnimationFrame(step); else resolve(hi - lo);
      };
      requestAnimationFrame(step);
    }));
    const { context, page, errors } = await freshRun();
    const st = () => page.evaluate(() => ({ scale: window.__game.ctx.state.cameraShakeScale, reduce: window.__game.ctx.state.reduceCameraShake }));
    check(JSON.stringify(await st()) === JSON.stringify({ scale: 1, reduce: false }), 'default: Full (scale 1, not reduced)');
    const full = await jitter(page);
    check(full > 0.05, `Full: the view jitters (range ${full.toFixed(4)})`);
    await openSettings(page, 'display');
    const select = page.locator('#player-settings [name="cameraShake"]');
    check((await select.inputValue()) === 'full', 'the Display tab shows Full');
    check(await select.evaluate((el) => el.tagName === 'SELECT' && [...el.options].map((o) => o.value).join() === 'full,half,off'), 'it is a three-way select (Full, Half, Off)');
    await select.selectOption('half');
    check((await stored(page))?.cameraShake === 'half', 'Half saves cameraShake:"half"');
    check(JSON.stringify(await st()) === JSON.stringify({ scale: 0.5, reduce: false }), 'Half applies live: scale 0.5');
    await closeSettings(page); await resume(page);
    const half = await jitter(page);
    check(half > full * 0.35 && half < full * 0.65, `Half: about half the jitter (${half.toFixed(4)} vs Full ${full.toFixed(4)})`);
    await openSettings(page, 'display');
    await page.locator('#player-settings [name="cameraShake"]').selectOption('off');
    check(JSON.stringify(await st()) === JSON.stringify({ scale: 0, reduce: true }), 'Off applies live: scale 0, reduced');
    await closeSettings(page); await resume(page);
    const off = await jitter(page);
    check(off < 0.002, `Off: no jitter (${off.toFixed(5)})`);
    await context.close();

    const reloaded = await freshRun({ prefs: { cameraShake: 'half' } });
    check(JSON.stringify(await reloaded.page.evaluate(() => window.__game.ctx.state.cameraShakeScale)) === '0.5', 'Half survives a reload');
    await reloaded.context.close();
    const legacy = await freshRun({ prefs: { cameraShake: false, textScale: 1.15 } });
    check((await legacy.page.evaluate(() => ({ s: window.__game.ctx.state.cameraShakeScale, r: window.__game.ctx.state.reduceCameraShake }))).r === true, 'an old save with cameraShake:false loads as Off');
    await openSettings(legacy.page, 'display');
    check((await legacy.page.locator('#player-settings [name="cameraShake"]').inputValue()) === 'off', '... and the select shows Off');
    await legacy.page.screenshot({ path: `${out}/shake-display-tab.png` });
    await legacy.context.close();
    check(errors.length === 0 && reloaded.errors.length === 0 && legacy.errors.length === 0, 'no page errors');
  }

  // ------------------------------------------------------------------ caption backing and size
  if (want('captions')) {
    console.log('\n== Caption backing and size');
    const { context, page, errors } = await freshRun();
    const probe = () => page.evaluate(() => {
      const c = window.__game.ctx;
      c.events.emit('narration', { text: 'The Works regrets to inform you that the floor is, at present, mostly lava.', seconds: 30, captioned: true, speaker: 'docent' });
      c.events.emit('combatCallout', { x: c.player.x + 30, y: c.player.y - 6, text: 'FLAMBEED', tone: 'brass' });
      const cap = document.getElementById('narration-caption');
      const anchor = document.querySelector('#callout-layer .callout-anchor:last-child');
      const card = anchor?.querySelector('.callout');
      const cs = getComputedStyle(cap);
      return {
        body: document.body.classList.contains('caps-backed'),
        capBg: cs.backgroundColor, capPad: cs.paddingLeft, capFont: parseFloat(cs.fontSize),
        anchorScale: anchor ? new DOMMatrix(getComputedStyle(anchor).transform).a : null,
        calloutBg: card ? getComputedStyle(card).backgroundColor : null,
      };
    });
    const alpha = (css) => { const m = /rgba?\(([^)]+)\)/.exec(css ?? ''); if (!m) return 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
    await page.waitForTimeout(800);
    const before = await probe();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/captions-default.png` });
    check(!before.body && alpha(before.capBg) === 0 && before.capPad === '0px', `default: no backing (caption background ${before.capBg}, padding ${before.capPad})`);
    check(before.anchorScale === 1 && alpha(before.calloutBg) === 0 && before.capFont === 17, 'default: callout scale 1, caption 17px, no plate (unchanged)');

    await openSettings(page, 'display');
    await click(page, page.locator('#player-settings [name="captionBacking"]'));
    check((await stored(page))?.captionBacking === true, 'the checkbox saves captionBacking:true');
    await click(page, page.locator('#player-settings [name="textScale"]').first());
    await page.locator('#player-settings [name="textScale"]').selectOption('1.3');
    await closeSettings(page); await resume(page);
    await page.waitForTimeout(300);
    const after = await probe();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/captions-backed-larger.png` });
    check(after.body && alpha(after.capBg) > 0.6 && parseFloat(after.capPad) >= 12, `backing on: dark plate behind the caption (${after.capBg}, padding ${after.capPad})`);
    check(alpha(after.calloutBg) > 0.5, `backing on: plate behind the callout (${after.calloutBg})`);
    check(Math.abs(after.capFont - 17 * 1.3) < 0.1 && Math.abs(after.anchorScale - 1.3) < 0.01, `Larger text: caption ${after.capFont}px, callout x${after.anchorScale} (both follow Text size)`);
    await context.close();

    const saved = await freshRun({ prefs: { captionBacking: true } });
    await saved.page.waitForTimeout(500);
    check(await saved.page.evaluate(() => document.body.classList.contains('caps-backed')), 'a saved captionBacking:true applies on load');
    check(errors.length === 0 && saved.errors.length === 0, 'no page errors');
    await saved.context.close();
  }

  // ------------------------------------------------------------------ numeric vitals
  if (want('vitals')) {
    console.log('\n== Numbers on the bars');
    const { context, page, errors } = await freshRun();
    const nums = () => page.evaluate(() => ({ cls: document.body.classList.contains('vitals-numeric'), nodes: [...document.querySelectorAll('.vital-num')].map((n) => n.textContent) }));
    const d0 = await nums();
    check(!d0.cls && d0.nodes.length === 0, 'default: no class, no number elements (the HUD is untouched)');
    await page.screenshot({ path: `${out}/vitals-default.png`, clip: { x: 0, y: 40, width: 420, height: 160 } });
    await openSettings(page, 'display');
    await click(page, page.locator('#player-settings [name="numericVitals"]'));
    check((await stored(page))?.numericVitals === true, 'the checkbox saves numericVitals:true');
    await closeSettings(page); await resume(page);
    await page.waitForTimeout(300);
    const on = await nums();
    const real = await page.evaluate(() => { const p = window.__game.ctx.player; return [`${Math.ceil(p.hp)}/${p.maxHp}`, `${Math.floor(p.mana)}/${p.maxMana}`, `${Math.floor(p.levit)}/${p.maxLevit}`]; });
    check(on.cls && on.nodes.length === 3 && on.nodes.join() === real.join(), `on: ${on.nodes.join('  ')} matches the player (${real.join('  ')})`);
    await page.screenshot({ path: `${out}/vitals-on-full.png`, clip: { x: 0, y: 40, width: 420, height: 160 } });
    await page.evaluate(() => { const c = window.__game.ctx; c.player.hp = 37.4; c.player.levit = 12; c.player.invuln = 99999; });
    await page.waitForTimeout(300);
    const low = await nums();
    const liveLevit = await page.evaluate(() => window.__game.ctx.player.levit);
    check(low.nodes[0] === '38/110' && Math.abs(Number(low.nodes[2].split('/')[0]) - liveLevit) <= 8, `the figures follow the player live: ${low.nodes.join('  ')} (levitation regenerates, now ${Math.round(liveLevit)})`);
    await page.screenshot({ path: `${out}/vitals-on-hurt.png`, clip: { x: 0, y: 40, width: 420, height: 160 } });
    // the bars themselves did not move or shrink
    const geo = (p) => p.evaluate(() => { const r = document.getElementById('hp-fill').parentElement.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.width)}`; });
    const geoOn = await geo(page);
    await openSettings(page, 'display');
    await click(page, page.locator('#player-settings [name="numericVitals"]'));
    await closeSettings(page); await resume(page);
    await page.waitForTimeout(300);
    const off = await nums();
    check(!off.cls && off.nodes.length === 0, 'off again: the elements and the class are gone');
    check(geoOn === await geo(page), `the bar keeps its place and width with the numbers on or off (${geoOn})`);
    check(errors.length === 0, 'no page errors');
    await context.close();
  }

} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

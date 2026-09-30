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


  // ------------------------------------------------------------------ teaching cards
  if (want('hints')) {
    console.log('\n== Teaching cards: first time / every floor / off, and Reset tutorials');
    const { context, page, errors } = await freshRun();
    await page.waitForTimeout(5000); // the arrival title card and the calm gate pass
    const SEEN = 'alchemists-descent-seen-hints-v1';
    const seen = () => page.evaluate((key) => { try { return JSON.parse(localStorage.getItem(key) ?? '{}').keys ?? []; } catch { return null; } }, SEEN);
    const card = () => page.evaluate(() => { const o = document.getElementById('hint-teach-overlay'); return o?.classList.contains('visible') ? o.querySelector('.hint-teach-title')?.textContent ?? '?' : null; });
    const skipGap = () => page.evaluate(() => { window.__game.ctx.state.frameCount += 800; });
    const dismiss = async () => { if (await card()) await click(page, page.locator('#hint-teach-overlay .hint-teach-card')); await page.waitForTimeout(200); };
    const emitBench = () => page.evaluate(() => window.__game.ctx.events.emit('benchOpened'));
    const waitCard = (ms = 4000) => page.waitForFunction(() => document.getElementById('hint-teach-overlay')?.classList.contains('visible'), null, { timeout: ms }).then(() => true, () => false);

    check(await page.evaluate(() => window.__game.ctx.state.hintMode) === 'first', 'default: First time only');
    await emitBench();
    check(await waitCard() && (await card()) === 'Reading a Wand', 'first time: the card appears (Reading a Wand)');
    check((await seen()).includes('wand-sentence'), 'and is recorded as seen');
    await page.screenshot({ path: `${out}/hints-card.png` });
    await dismiss(); await skipGap();
    await emitBench();
    check(!(await waitCard(2500)), 'first time only: the same lesson does not return');

    await openSettings(page, 'gameplay');
    const select = page.locator('#player-settings [name="hintMode"]');
    check(await select.evaluate((el) => [...el.options].map((o) => o.value).join() === 'first,always,off'), 'the Gameplay tab offers First time only / Every floor / Off');
    await select.selectOption('off');
    check((await stored(page))?.hintMode === 'off' && await page.evaluate(() => window.__game.ctx.state.hintMode) === 'off', 'Off saves and applies live');
    await closeSettings(page); await resume(page); await skipGap();
    await page.evaluate(() => window.__game.ctx.events.emit('worldInteractionObserved', { id: 'x', title: 'X', x: 0, y: 0 })); // an unseen lesson
    // and a card another system emits straight at the overlay (the waystone card does this)
    await page.evaluate(() => window.__game.ctx.events.emit('hintTeach', { key: 'waystone-unlit', title: 'A Waystone', body: 'Test body.' }));
    check(!(await waitCard(2500)), 'Off: no card, from the HintSystem or from any other emitter');
    check(!(await seen()).includes('grimoire-observed'), 'Off spends nothing (the unseen lesson is still unseen)');

    await openSettings(page, 'gameplay');
    await page.locator('#player-settings [name="hintMode"]').selectOption('always');
    await closeSettings(page); await resume(page); await skipGap();
    await emitBench();
    const shownAgain = await waitCard();
    const againTitle = await card();
    check(shownAgain && againTitle === 'Reading a Wand', `Every floor: a lesson already seen teaches again on this floor (card: ${againTitle})`);
    await dismiss(); await skipGap();
    await emitBench();
    check(!(await waitCard(2500)), 'Every floor: but only once on the same floor');

    await openSettings(page, 'gameplay');
    await page.locator('#player-settings [name="hintMode"]').selectOption('first');
    await click(page, page.locator('#player-settings #reset-tutorials'));
    check(!(await seen()).length, 'Reset tutorials clears the saved seen-lessons');
    check((await page.locator('#player-settings #settings-status').textContent()).includes('Tutorials reset'), 'and says so');
    await page.screenshot({ path: `${out}/hints-settings.png` });
    await closeSettings(page); await resume(page); await skipGap();
    await emitBench();
    check(await waitCard() && (await card()) === 'Reading a Wand', 'after the reset the same lesson teaches again, same session');
    check(errors.length === 0, `no page errors${errors.join(' | ')}`);
    await context.close();

    const reloaded = await freshRun({ prefs: { hintMode: 'off' } });
    check(await reloaded.page.evaluate(() => window.__game.ctx.state.hintMode) === 'off', 'a saved Off survives a reload');
    await reloaded.context.close();
  }


  // ------------------------------------------------------------------ presentation sliders
  if (want('picture')) {
    console.log('\n== Presentation: brightness, edge shading, glow, film grain');
    const { context, page, errors } = await freshRun();
    const fx = () => page.evaluate(() => { const f = window.__game.ctx.state.postFx; return { gain: f.gain, vignette: f.vignette, bloom: f.bloomStrength, grain: f.grain }; });
    const SHIPPED = { gain: 1, vignette: 0.28, bloom: 0.18, grain: 0.006 };
    check(JSON.stringify(await fx()) === JSON.stringify(SHIPPED), `default: post-processing is exactly the shipped values ${JSON.stringify(await fx())}`);
    check((await stored(page))?.brightness === undefined, 'nothing presentation-related is written until a slider moves');

    await openSettings(page, 'presentation');
    const readouts = () => page.evaluate(() => ['brightness', 'vignette', 'bloom', 'grain'].map((n) => document.getElementById(`out-${n}`).textContent));
    check((await readouts()).join() === 'Default,Default,Default,Default', 'every slider reads Default');
    const slider = (name) => page.locator(`#player-settings [name="${name}"]`);
    const limits = await page.evaluate(() => Object.fromEntries(['brightness', 'vignette', 'bloom', 'grain'].map((n) => { const e = document.querySelector(`[name="${n}"]`); return [n, [Number(e.min), Number(e.max)]]; })));
    check(limits.brightness[0] === 0.85 && limits.brightness[1] === 1.25, `brightness is held to 0.85-1.25 around the shipped 1 (${limits.brightness})`);

    // Real keyboard on the real sliders: End = the brightest settings, Home = the darkest.
    const bright = { brightness: 'End', vignette: 'Home', bloom: 'End', grain: 'End' };
    const dark = { brightness: 'Home', vignette: 'End', bloom: 'Home', grain: 'Home' };
    const set = async (keys) => { for (const [name, key] of Object.entries(keys)) { await slider(name).focus(); await page.keyboard.press(key); } };
    await set(bright);
    let now = await fx();
    check(now.gain === 1.25 && now.vignette === 0.08 && now.bloom === 0.36 && now.grain === 0.018, `brightest: applied live ${JSON.stringify(now)}`);
    const st = await stored(page);
    check(st.brightness === 1.25 && st.vignette === 0.08 && st.bloom === 0.36 && st.grain === 0.018, 'and saved');
    check((await readouts()).join() === '+5,\u22125,+6,+4', `readouts: ${(await readouts()).join(' ')}`);
    await page.screenshot({ path: `${out}/picture-tab.png` });
    await set(dark);
    now = await fx();
    check(now.gain === 0.85 && now.vignette === 0.44 && now.bloom === 0.06 && now.grain === 0, `darkest: applied live ${JSON.stringify(now)}`);
    check((await readouts())[3] === 'Off', 'film grain at the floor reads Off');

    await click(page, page.locator('#player-settings #reset-picture'));
    check(JSON.stringify(await fx()) === JSON.stringify(SHIPPED), 'Reset picture restores the shipped values exactly');
    const after = await stored(page);
    check(after.brightness === null && after.vignette === null && after.bloom === null && after.grain === null, 'and saves "never touched" (null) again');
    check((await readouts()).join() === 'Default,Default,Default,Default', 'readouts back to Default');
    await closeSettings(page);

    // a hostile saved value is clamped into the band on load, not trusted
    const hostile = await freshRun({ prefs: { brightness: 9, vignette: -4, bloom: 'lots', grain: 1e9 } });
    const hfx = await hostile.page.evaluate(() => { const f = window.__game.ctx.state.postFx; return { e: f.gain, v: f.vignette, b: f.bloomStrength, g: f.grain }; });
    check(hfx.e === 1.25 && hfx.v === 0.08 && hfx.b === 0.18 && hfx.g === 0.018, `hostile saved values are clamped into the band: ${JSON.stringify(hfx)}`);
    await hostile.context.close();
    const kept = await freshRun({ prefs: { brightness: 0.95, grain: 0 } });
    const kfx = await kept.page.evaluate(() => { const f = window.__game.ctx.state.postFx; return { e: f.gain, g: f.grain, v: f.vignette }; });
    check(kfx.e === 0.95 && kfx.g === 0 && kfx.v === 0.28, `saved choices survive a reload and untouched ones stay shipped: ${JSON.stringify(kfx)}`);
    await kept.context.close();
    // The pixels really change: mean luminance of the frame (read inside a frame callback) at each end of each slider.
    const pix = await freshRun({ seed: 7 });
    const meanLum = () => pix.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
      const cv = document.querySelector('#canvas-holder > canvas'); const t = document.createElement('canvas'); t.width = 320; t.height = 180;
      const g = t.getContext('2d'); g.drawImage(cv, 0, 0, 320, 180); const d = g.getImageData(0, 0, 320, 180).data;
      let sum = 0; for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      resolve(sum / (d.length / 4));
    })));
    const setFx = (key, value) => pix.page.evaluate(([k, v]) => { window.__game.ctx.state.postFx[k] = v; }, [key, value]);
    await pix.page.evaluate(() => { const c = window.__game.ctx; c.state.debugGodMode = true; });
    await pix.page.waitForTimeout(800);
    const lum = {};
    for (const [label, key, value] of [['gain-', 'gain', 0.85], ['base', 'gain', 1], ['gain+', 'gain', 1.25]]) { await setFx(key, value); await pix.page.waitForTimeout(250); lum[label] = await meanLum(); }
    await setFx('gain', 1);
    check(lum['gain-'] < lum.base * 0.92 && lum['gain+'] > lum.base * 1.12, `Brightness moves the picture: mean luminance ${lum['gain-'].toFixed(1)} < ${lum.base.toFixed(1)} < ${lum['gain+'].toFixed(1)}`);
    check(lum['gain+'] < lum.base * 1.4, 'and stays well inside a designed-darkness band (+25% at most)');
    for (const [label, key, value] of [['vig-', 'vignette', 0.08], ['vig+', 'vignette', 0.44]]) { await setFx(key, value); await pix.page.waitForTimeout(250); lum[label] = await meanLum(); }
    await setFx('vignette', 0.28);
    check(lum['vig-'] > lum.base && lum['vig+'] < lum.base, `Edge shading moves the picture: ${lum['vig+'].toFixed(1)} < ${lum.base.toFixed(1)} < ${lum['vig-'].toFixed(1)}`);
    for (const [label, key, value] of [['bloom-', 'bloomStrength', 0.06], ['bloom+', 'bloomStrength', 0.36]]) { await setFx(key, value); await pix.page.waitForTimeout(250); lum[label] = await meanLum(); }
    check(lum['bloom+'] > lum['bloom-'], `Glow moves the picture: ${lum['bloom-'].toFixed(1)} < ${lum['bloom+'].toFixed(1)}`);
    await pix.context.close();
    check(errors.length === 0, `no page errors${errors.join(' | ')}`);
    await context.close();
  }


  // ------------------------------------------------------------------ HUD size and opacity
  if (want('hud')) {
    console.log('\n== HUD size and opacity');
    const { context, page, errors } = await freshRun();
    const BLOCKS = ['#hud-left', '#expedition-tools', '.wave-readout'];
    const geo = () => page.evaluate((blocks) => {
      const view = document.querySelector('#game-hud').getBoundingClientRect();
      return Object.fromEntries(blocks.map((sel) => {
        const el = document.querySelector(sel), b = el.getBoundingClientRect(), cs = getComputedStyle(el);
        return [sel, { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), transform: cs.transform, opacity: cs.opacity, inside: b.left >= view.left - 1 && b.right <= view.right + 1 && b.top >= view.top - 1 && b.bottom <= view.bottom + 1 }];
      }));
    }, BLOCKS);
    const base = await geo();
    check(!(await page.evaluate(() => document.body.classList.contains('hud-custom'))), 'default: no hud-custom class');
    check(BLOCKS.every((s) => base[s].transform === 'none' && base[s].opacity === '1'), 'default: no HUD block has a transform or an opacity (untouched)');
    await page.screenshot({ path: `${out}/hud-1.0.png` });

    await openSettings(page, 'display');
    const slider = (n) => page.locator(`#player-settings [name="${n}"]`);
    const readout = (n) => page.evaluate((id) => document.getElementById(`out-${id}`).textContent, n);
    check((await readout('hudScale')) === '100%' && (await readout('hudOpacity')) === '100%', 'both sliders read 100%');
    await slider('hudScale').focus(); await page.keyboard.press('End');
    check((await stored(page))?.hudScale === 1.3 && (await readout('hudScale')) === '130%', 'End = 130%, saved');
    await closeSettings(page); await resume(page);
    await page.waitForTimeout(300);
    const big = await geo();
    check(await page.evaluate(() => document.body.classList.contains('hud-custom')), 'hud-custom appears only now');
    check(BLOCKS.every((s) => Math.abs(big[s].w / base[s].w - 1.3) < 0.03), `each block is 1.3x wider (${BLOCKS.map((s) => (big[s].w / base[s].w).toFixed(2)).join(' ')})`);
    check(Math.abs(big['#hud-left'].l - base['#hud-left'].l) < 1.5 && Math.abs(big['#hud-left'].t - base['#hud-left'].t) < 1.5, 'HUD-left stays anchored to its top-left corner');
    check(Math.abs(big['.wave-readout'].r - base['.wave-readout'].r) < 1.5 && Math.abs(big['.wave-readout'].t - base['.wave-readout'].t) < 1.5, 'the objective block stays anchored to its top-right corner');
    check(Math.abs(big['#expedition-tools'].l - base['#expedition-tools'].l) < 1.5 && Math.abs(big['#expedition-tools'].b - base['#expedition-tools'].b) < 1.5, 'wands and flasks stay anchored to the bottom-left');
    const pauseGeo = await page.evaluate(() => { const b = document.getElementById('expedition-pause').getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.right)},${Math.round(b.bottom)}`; });
    check(pauseGeo === '80x35@1412,830', `the Pause button is left alone: size and place unchanged (${pauseGeo})`);
    check(BLOCKS.every((s) => big[s].inside), 'and every block still sits inside the view at 130%');
    await page.screenshot({ path: `${out}/hud-1.3.png` });

    await openSettings(page, 'display');
    await slider('hudScale').focus(); await page.keyboard.press('Home');
    await slider('hudOpacity').focus(); await page.keyboard.press('Home');
    check((await readout('hudScale')) === '80%' && (await readout('hudOpacity')) === '50%', 'Home = 80% size, 50% opacity');
    await closeSettings(page); await resume(page);
    await page.waitForTimeout(300);
    const small = await geo();
    check(BLOCKS.every((s) => Math.abs(small[s].w / base[s].w - 0.8) < 0.03 && small[s].opacity === '0.5'), `each block 0.8x and at half opacity (${BLOCKS.map((s) => (small[s].w / base[s].w).toFixed(2) + '/' + small[s].opacity).join(' ')})`);
    await page.screenshot({ path: `${out}/hud-0.8-half.png` });

    // click-through: the scaled pause button still takes a real click
    await click(page, page.locator('#expedition-pause'));
    await page.waitForTimeout(300);
    check(await page.evaluate(() => window.__game.ctx.state.paused), 'the Pause button still takes a real click with the HUD shrunk and faded');
    await click(page, page.locator('#pause-settings'));
    await page.waitForSelector('#player-settings[open]');
    await click(page, page.locator('#player-settings [data-tab="display"]'));
    await click(page, page.locator('#player-settings #reset-hud'));
    const back = await geo();
    check(BLOCKS.every((s) => back[s].transform === 'none' && back[s].opacity === '1') && !(await page.evaluate(() => document.body.classList.contains('hud-custom'))), 'Reset HUD puts every block back (no transform, full opacity, no class)');
    await closeSettings(page); await resume(page);

    // text size is a separate control and composes with HUD size (no double counting of the variable)
    const saved = await freshRun({ prefs: { hudScale: 1.15, hudOpacity: 0.8, textScale: 1.3 } });
    await saved.page.waitForTimeout(500);
    const sg = await saved.page.evaluate(() => ({ cls: document.body.classList.contains('hud-custom'), s: getComputedStyle(document.documentElement).getPropertyValue('--hud-scale').trim(), o: getComputedStyle(document.querySelector('#hud-left')).opacity, t: getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim() }));
    check(sg.cls && sg.s === '1.15' && sg.o === '0.8' && sg.t === '1.3', `saved choices apply on load and sit beside Text size: ${JSON.stringify(sg)}`);
    await saved.page.screenshot({ path: `${out}/hud-1.15-text1.3.png` });
    await saved.context.close();
    check(errors.length === 0, `no page errors${errors.join(' | ')}`);
    await context.close();
  }


  // ------------------------------------------------------------------ chosen seed
  if (want('seed')) {
    console.log('\n== Choose a seed: title fold, determinism, ledger, share line, copy');
    /** Real title -> fold -> typed seed. Returns the page, still on the title. */
    const startWithSeed = async (text) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.locator('#expedition-entry').waitFor({ state: 'visible' });
      await page.waitForTimeout(800);
      await click(page, page.locator('#expedition-entry .entry-seed summary'));
      await page.waitForFunction(() => document.querySelector('#expedition-entry .entry-seed').open);
      await click(page, page.locator('#entry-seed-input'));
      await page.keyboard.type(text);
      return { context, page, errors };
    };
    const signature = (page) => page.evaluate(() => { const r = window.__game.ctx.levels.current; const st = window.__game.ctx.state; return JSON.stringify({ worldSeed: st.worldSeed, secret: st.secretReaction, id: r.def.id, spawn: r.spawn, portal: r.portal && [r.portal.x, r.portal.y], pickups: r.pickups.map((p) => [p.kind, p.x >> 4, p.y >> 4]), enemies: window.__game.ctx.enemies.map((e) => [e.kind, Math.round(e.x) >> 4, Math.round(e.y) >> 4]), mech: r.mechanisms.map((m) => [m.kind, m.x, m.y]), ways: r.waystones.map((w) => [w.x, w.y]) }); });
    const begin = async (page) => {
      await click(page, page.locator('#expedition-entry [data-seed="begin"]'));
      await page.waitForFunction(() => window.__game.ctx.state.mode === 'play' && window.__game.ctx.levels.current && !window.__game.ctx.levels.transitioning, null, { timeout: 60000 });
      await waitForOpeningEnd(page).catch(() => undefined);
    };

    // the fold and the preview
    const a = await startWithSeed('1234567');
    check((await a.page.locator('#entry-seed-preview').textContent()) === 'Seed 1234567.', 'typing a number previews it: "Seed 1234567."');
    check(await a.page.locator('#expedition-entry [data-seed="begin"]').isEnabled(), 'Begin with this seed is enabled');
    await a.page.screenshot({ path: `${out}/seed-fold.png` });
    await begin(a.page);
    const statusA = await a.page.evaluate(() => { const c = window.__game.ctx; return { seed: c.levels.runStatus(c).expeditionSeed, save: c.run.snapshotForSave() }; });
    check(statusA.seed === 1234567 && statusA.save.seed === 1234567 && statusA.save.seedChosen === true, `the descent runs on seed 1234567 and records that it was chosen (${JSON.stringify({ seed: statusA.seed, chosen: statusA.save.seedChosen })})`);
    const sigA = await signature(a.page);

    // determinism: the same seed, in a second page, is the same Works; another seed is not
    const b = await startWithSeed('1234567');
    await begin(b.page);
    const sigB = await signature(b.page);
    check(sigA === sigB, 'the same seed and case make the same descent (world seed, the run’s secret reaction, spawn, portal, mechanisms, waystones, pickups, creatures)');
    await b.context.close();
    const c = await startWithSeed('7654321');
    await begin(c.page);
    check((await signature(c.page)) !== sigA, 'a different seed makes a different descent (floor 1 is hand-built; the seed changes the generated floors and the secret reaction)');
    await c.context.close();
    const w1 = await startWithSeed('Kettleby');
    const words1 = await w1.page.locator('#entry-seed-preview').textContent();
    check(words1.startsWith('Those words make seed '), 'words preview the number they become');
    const wordsSeed = Number(/seed (\d+)/.exec(words1)[1]);
    await w1.context.close();
    const w2 = await startWithSeed('  kettleBY ');
    check(Number(/seed (\d+)/.exec(await w2.page.locator('#entry-seed-preview').textContent())[1]) === wordsSeed, 'the same words (any case or spacing) are the same seed');
    await w2.context.close();

    // the ledger and the share line carry it
    await a.page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; c.run.abandon(c); });
    await a.page.waitForSelector('#run-summary.visible', { timeout: 15000 });
    await a.page.waitForTimeout(1500);
    const ledger = await a.page.evaluate(() => ({ kicker: document.querySelector('#run-summary .rs-kicker').textContent, share: document.querySelector('#run-summary .rs-share').textContent }));
    check(ledger.kicker.includes('Seed 1234567'), `the ledger names the seed: "${ledger.kicker}"`);
    check(ledger.share.includes('seed 1234567'), `the share line names it: "${ledger.share}"`);
    await a.page.screenshot({ path: `${out}/seed-ledger.png` });
    check(a.errors.length === 0, 'no page errors');
    await a.context.close();

    // an ordinary Begin is exactly as it was: no chosen flag, no seed on the ledger or the share line
    const plain = await freshRun();
    const before = await plain.page.evaluate(() => window.__game.ctx.run.snapshotForSave());
    check(before.seedChosen === undefined, 'a normal descent carries no seedChosen flag');
    await plain.page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; c.run.abandon(c); });
    await plain.page.waitForSelector('#run-summary.visible', { timeout: 15000 });
    await plain.page.waitForTimeout(1500);
    const normal = await plain.page.evaluate(() => ({ kicker: document.querySelector('#run-summary .rs-kicker').textContent, share: document.querySelector('#run-summary .rs-share').textContent }));
    check(normal.kicker === 'The ledger' && !/seed/i.test(normal.share), `an ordinary ledger is unchanged: "${normal.kicker}" / "${normal.share}"`);
    await plain.context.close();

    // copy this descent's seed from the title
    const d = await startWithSeed('42424242');
    await begin(d.page);
    await d.page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; window.dispatchEvent(new CustomEvent('expedition-title-request')); });
    await d.page.locator('#expedition-entry').waitFor({ state: 'visible' });
    await d.page.waitForTimeout(600);
    const foldOpen = await d.page.evaluate(() => document.querySelector('#expedition-entry .entry-seed').open);
    if (!foldOpen) await click(d.page, d.page.locator('#expedition-entry .entry-seed summary'));
    const copyBtn = d.page.locator('#expedition-entry [data-seed="copy"]');
    check(await copyBtn.isVisible(), 'with a descent in hand the title offers the copy button');
    await click(d.page, copyBtn);
    await d.page.waitForTimeout(400);
    const clip = await d.page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    check(clip === '42424242' || (await d.page.locator('#entry-seed-input').inputValue()) === '42424242', `the seed reaches the clipboard (or, if refused, the selected field): clipboard=${clip}`);
    await d.page.screenshot({ path: `${out}/seed-copy.png` });
    await d.context.close();

    // the daily is untouched
    const daily = await freshRun();
    await daily.page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; return c.run.startNewRun(c, { kit: 'spark', daily: true, seed: 999 }); });
    await daily.page.waitForTimeout(3000);
    const ds = await daily.page.evaluate(() => window.__game.ctx.run.snapshotForSave());
    check(ds.daily !== null && ds.seed !== 999 && ds.seedChosen === undefined, 'a seed passed with the daily is ignored: it keeps its own seed and is not "chosen"');
    await daily.context.close();
  }


  // ------------------------------------------------------------------ controller: dead zone and vibration
  if (want('pad')) {
    console.log('\n== Controller: stick dead zone and vibration (a synthetic standard gamepad)');
    // A standard-mapping pad the page believes in: the test moves its stick, the page reports its rumbles.
    const withPad = async (prefs) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.addInitScript(() => {
        window.__rumbles = [];
        window.__pad = {
          id: 'Synthetic standard pad', index: 0, connected: true, mapping: 'standard', timestamp: 0,
          axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
          vibrationActuator: { playEffect: (type, params) => { window.__rumbles.push({ type, ...params }); return Promise.resolve('complete'); } },
        };
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__pad] });
      });
      if (prefs) await context.addInitScript((value) => { try { localStorage.setItem('ad-player-preferences-v1', value); } catch { /* */ } }, JSON.stringify(prefs));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(url, { waitUntil: 'networkidle' });
      await startConsolePlayRun(page, { seed: 7, settleMs: 3000 });
      await waitForOpeningEnd(page).catch(() => undefined);
      await page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; c.state.debugGodMode = false; });
      await page.waitForTimeout(3000); // past the arrival grace
      return { context, page, errors };
    };
    const px = (page) => page.evaluate(() => window.__game.ctx.player.x);
    /** How far the alchemist walks in 700 ms with the left stick held at `x`. */
    const walk = async (page, x) => {
      const start = await px(page);
      await page.evaluate((v) => { window.__pad.axes[0] = v; }, x);
      await page.waitForTimeout(700);
      await page.evaluate(() => { window.__pad.axes[0] = 0; });
      const end = await px(page);
      await page.waitForTimeout(500);
      return Math.abs(end - start);
    };

    // --- the dead zone
    const { context, page, errors } = await withPad();
    check(await page.evaluate(() => window.__game.ctx.state.padDeadzone) === 0.2, 'default: dead zone 0.2 (the shipped feel)');
    const below = await walk(page, 0.17);
    const above = await walk(page, 0.23);
    check(below < 2 && above > 10, `default: a stick at 0.17 does nothing (${below.toFixed(1)} cells), at 0.23 walks (${above.toFixed(1)} cells)`);
    await openSettings(page, 'controls');
    const slider = page.locator('#player-settings [name="padDeadzone"]');
    check((await page.evaluate(() => document.getElementById('out-padDeadzone').textContent)) === '20%', 'the Controls tab shows the dead zone at 20%');
    await slider.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    check((await stored(page))?.padDeadzone === 0.35 && await page.evaluate(() => window.__game.ctx.state.padDeadzone) === 0.35, 'three arrow presses on the real slider: 35%, saved and live');
    await page.screenshot({ path: `${out}/pad-tab.png` });
    await closeSettings(page); await resume(page);
    const tight = await walk(page, 0.3);
    const tightPast = await walk(page, 0.42);
    check(tight < 2 && tightPast > 10, `dead zone 35%: a stick at 0.30 (which used to walk) now does nothing (${tight.toFixed(1)}), at 0.42 walks (${tightPast.toFixed(1)})`);
    await openSettings(page, 'controls');
    await slider.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
    await closeSettings(page); await resume(page);
    const loose = await walk(page, -0.12); // the other way: the first walks used up the room to the right
    check(loose > 10, `dead zone 5%: a stick at 0.12 now walks (${loose.toFixed(1)} cells)`);

    // --- vibration
    const rumbles = () => page.evaluate(() => window.__rumbles.length);
    await page.evaluate(() => { const c = window.__game.ctx; c.player.invuln = 0; c.player.hp = c.player.maxHp; });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__game.ctx.playerCtl.damage(30, 0, 0, 'impact'));
    await page.waitForTimeout(400);
    check((await rumbles()) === 0, 'default: a real hit does not vibrate the controller');
    await openSettings(page, 'controls');
    const box = page.locator('#player-settings [name="padRumble"]');
    await box.scrollIntoViewIfNeeded();
    check(!(await box.isChecked()), 'the Vibration checkbox is off by default');
    await click(page, box);
    check((await stored(page))?.padRumble === true, 'checking it saves padRumble:true');
    await closeSettings(page); await resume(page);
    await page.evaluate(() => { const c = window.__game.ctx; c.player.invuln = 0; c.player.hp = c.player.maxHp; });
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__rumbles.length = 0; window.__game.ctx.playerCtl.damage(30, 0, 0, 'impact'); });
    await page.waitForTimeout(400);
    const hit = await page.evaluate(() => window.__rumbles.slice());
    check(hit.length >= 1 && hit[0].type === 'dual-rumble' && hit[0].strongMagnitude > 0 && hit[0].strongMagnitude <= 1 && hit[0].duration > 0, `a real hit rumbles: ${JSON.stringify(hit[0])}`);
    // paused: still
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__rumbles.length = 0; window.__game.ctx.playerCtl.damage(25, 0, 0, 'impact'); });
    await page.waitForTimeout(400);
    check((await rumbles()) === 0, 'paused: nothing rumbles');
    await click(page, page.locator('#pause-resume'));
    await page.waitForTimeout(400);
    check((await rumbles()) === 0, 'and the damage taken while paused is not replayed on resume');
    // a blast close by (last: it also burns, which is real damage and real rumble)
    await page.evaluate(() => { window.__rumbles.length = 0; const c = window.__game.ctx; c.explosions.trigger(c.player.x + 18, c.player.y - 6, 26); });
    await page.waitForTimeout(400);
    check((await rumbles()) >= 1, `a blast close by rumbles (${await rumbles()} pulses)`);
    check(errors.length === 0, `no page errors${errors.join(' | ')}`);
    await context.close();

    // saved choices apply on load
    const saved = await withPad({ padDeadzone: 0.4, padRumble: true });
    check(await saved.page.evaluate(() => window.__game.ctx.state.padDeadzone) === 0.4, 'a saved dead zone applies on load');
    const savedWalk = await walk(saved.page, 0.35);
    check(savedWalk < 2, `and holds: a stick at 0.35 does nothing at 40% (${savedWalk.toFixed(1)})`);
    await saved.context.close();
  }


  // ------------------------------------------------------------------ enemy health bars and damage numbers
  if (want('enemyhp')) {
    console.log('\n== Enemy health and damage (a readout only)');
    const { context, page, errors } = await freshRun();
    const spawn = (kind, dx, dy = 0) => page.evaluate(([k, ox, oy]) => { const c = window.__game.ctx; const e = c.enemyCtl.spawn(k, c.player.x + ox, c.player.y + oy); return c.enemies.indexOf(e); }, [kind, dx, dy]);
    const enemyHp = (i) => page.evaluate((idx) => { const e = window.__game.ctx.enemies[idx]; return e ? [e.hp, e.maxHp] : null; }, i);
    const hit = (i, amount) => page.evaluate(([idx, n]) => { const c = window.__game.ctx; const e = c.enemies[idx]; c.enemyCtl.damage(e, n, 0, 0, 'direct'); }, [i, amount]);
    const dom = () => page.evaluate(() => ({ layer: !!document.getElementById('enemy-readout-layer'), bars: document.querySelectorAll('.enemy-hp-bar').length, nums: [...document.querySelectorAll('.enemy-hp-num')].map((n) => n.textContent) }));
    await page.evaluate(() => { const c = window.__game.ctx; c.state.debugGodMode = true; c.player.invuln = 99999; });
    const a = await spawn('slime', 60);
    const b = await spawn('slime', -60);
    await page.waitForTimeout(800);
    await hit(a, 10);
    await page.waitForTimeout(400);
    check(JSON.stringify(await dom()) === JSON.stringify({ layer: false, bars: 0, nums: [] }), 'default: hitting an enemy adds no layer, bar or number');
    const hpOff = await enemyHp(a);

    await openSettings(page, 'gameplay');
    const box = page.locator('#player-settings [name="showEnemyHp"]');
    await box.scrollIntoViewIfNeeded();
    check(!(await box.isChecked()), 'the Gameplay tab shows it unchecked');
    await click(page, box);
    check((await stored(page))?.showEnemyHp === true, 'checking it saves showEnemyHp:true');
    await closeSettings(page); await resume(page);
    check((await dom()).layer, 'on: the readout layer exists');
    await page.evaluate(() => { window.__game.ctx.enemies.forEach((e) => { e.hp = e.maxHp; }); });
    await page.waitForTimeout(300);
    await hit(a, 10);
    await page.waitForTimeout(350);
    const hpOn = await enemyHp(a);
    const shown = await page.evaluate(() => ({ fill: document.querySelector('.enemy-hp-bar > div')?.style.width, bars: document.querySelectorAll('.enemy-hp-bar').length, nums: [...document.querySelectorAll('.enemy-hp-num')].map((n) => n.textContent) }));
    check(hpOn[0] === hpOff[0] && hpOn[0] === hpOn[1] - 10, `the readout changes nothing in the fight: the same hit leaves the same hp with it off or on (${hpOff[0]} / ${hpOn[0]} of ${hpOn[1]})`);
    check(shown.bars === 1 && Math.abs(parseFloat(shown.fill) - (hpOn[0] / hpOn[1]) * 100) < 1, `a bar over the enemy that was hit, filled to ${shown.fill} (hp ${hpOn[0]}/${hpOn[1]}); the other enemy has none (${shown.bars} bar)`);
    check(shown.nums.length === 1 && shown.nums[0] === '−10', `and the damage rises off it: ${JSON.stringify(shown.nums)}`);
    await page.screenshot({ path: `${out}/enemyhp-hit.png` });
    // timing, measured inside the page so a screenshot cannot skew it: a fresh hit, sampled at 1.2 s and 2.7 s
    await page.waitForTimeout(2600);
    const timing = await page.evaluate(([idx]) => new Promise((resolve) => {
      const c = window.__game.ctx; const e = c.enemies[idx]; c.enemyCtl.damage(e, 6, 0, 0, 'direct');
      const t0 = performance.now(); const out = {};
      const snap = () => ({ bars: document.querySelectorAll('.enemy-hp-bar').length, nums: document.querySelectorAll('.enemy-hp-num').length });
      setTimeout(() => { out.at1200 = snap(); }, 1200);
      setTimeout(() => { out.at1750 = snap(); out.op1750 = Number(document.querySelector('.enemy-hp-bar')?.style.opacity ?? -1); }, 1750);
      setTimeout(() => { out.at2700 = snap(); resolve(out); }, 2700);
    }), [a]);
    check(timing.at1200.nums === 0, 'the number has risen and gone in under a second');
    check(timing.at1200.bars === 1 && timing.at2700.bars === 0, `the bar holds for ~2 s after a hit, then is gone (1.2 s: ${timing.at1200.bars} bar, 2.7 s: ${timing.at2700.bars})`);
    check(timing.op1750 > 0 && timing.op1750 < 1, `and fades over the last half second (opacity ${timing.op1750.toFixed(2)} at 1.75 s)`);

    // a stream of tiny hits (burning) reads as a few numbers, not a flicker of dozens
    await page.evaluate((idx) => { const c = window.__game.ctx; const e = c.enemies[idx]; for (let i = 0; i < 40; i++) setTimeout(() => c.enemyCtl.damage(e, 0.25, 0, 0, 'burned'), i * 25); }, a);
    await page.waitForTimeout(1300);
    const total = await page.evaluate((idx) => { const e = window.__game.ctx.enemies[idx]; return e.maxHp - e.hp; }, a);
    await page.screenshot({ path: `${out}/enemyhp-burn.png` });
    const streamNums = await page.evaluate(() => window.__burnSeen ?? null);
    check(total > 8, `(a 40-tick burn dealt ${total.toFixed(1)} damage)`);

    // a real spell: aim at the enemy with the real mouse and cast
    await page.evaluate(() => window.__game.ctx.enemies.forEach((e) => { e.hp = e.maxHp; }));
    const pointAt = async (wx, wy) => {
      const t = await page.evaluate(([x, y]) => {
        const c = window.__game.ctx; const cv = document.querySelector('canvas[data-input-attached="true"]'); const r = cv.getBoundingClientRect();
        const vw = 640, vh = 360, z = c.camera.zoom; const fx = c.camera.x - Math.floor(c.camera.x), fy = c.camera.y - Math.floor(c.camera.y);
        const sx = (1 + 4 / vw) * z, sy = (1 + 4 / vh) * z;
        const ndcX = -fx * (2 / vw) * z + ((x - c.camera.renderX) / vw - 0.5) * 2 * sx;
        const ndcY = fy * (2 / vh) * z + (0.5 - (y - c.camera.renderY) / vh) * 2 * sy;
        return { x: r.left + (ndcX + 1) * 0.5 * r.width, y: r.top + (1 - ndcY) * 0.5 * r.height };
      }, [wx, wy]);
      await page.mouse.move(t.x, t.y);
    };
    const tgt = await page.evaluate((idx) => { const e = window.__game.ctx.enemies[idx]; return [e.x, e.y - 4]; }, a);
    await pointAt(tgt[0], tgt[1]);
    await page.waitForTimeout(150);
    await page.mouse.down(); await page.waitForTimeout(220); await page.mouse.up();
    await page.waitForTimeout(900);
    const cast = await page.evaluate((idx) => { const e = window.__game.ctx.enemies[idx]; return { hp: e ? e.hp : null, max: e ? e.maxHp : null, bars: document.querySelectorAll('.enemy-hp-bar').length, nums: [...document.querySelectorAll('.enemy-hp-num')].map((n) => n.textContent) }; }, a);
    check(cast.hp !== null && cast.hp < cast.max && (cast.bars >= 1 || cast.nums.length >= 1), `a real Spark Bolt hit shows it: hp ${cast.hp}/${cast.max}, ${cast.bars} bar, numbers ${JSON.stringify(cast.nums)}`);
    await page.screenshot({ path: `${out}/enemyhp-cast.png` });

    // a kill: the last number is said and nothing is left behind
    await page.evaluate((idx) => { const c = window.__game.ctx; const e = c.enemies[idx]; c.enemyCtl.damage(e, e.hp + 5, 0, 0, 'direct'); }, a);
    await page.waitForTimeout(450);
    const killNums = (await dom()).nums;
    await page.waitForTimeout(3000);
    const after = await dom();
    check(after.bars === 0 && after.nums.length === 0, `after a kill nothing is left behind (number said: ${JSON.stringify(killNums)}; afterwards ${after.bars} bars, ${after.nums.length} numbers)`);

    // off again: the layer is gone
    await openSettings(page, 'gameplay');
    const box2 = page.locator('#player-settings [name="showEnemyHp"]');
    await box2.scrollIntoViewIfNeeded();
    await click(page, box2);
    await closeSettings(page); await resume(page);
    check(JSON.stringify(await dom()) === JSON.stringify({ layer: false, bars: 0, nums: [] }), 'off again: layer, bars and numbers are gone');
    check(errors.length === 0, `no page errors${errors.join(' | ')}`);
    await context.close();

    const saved = await freshRun({ prefs: { showEnemyHp: true } });
    check((await saved.page.evaluate(() => !!document.getElementById('enemy-readout-layer'))), 'a saved showEnemyHp:true applies on load');
    await saved.context.close();
  }

} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

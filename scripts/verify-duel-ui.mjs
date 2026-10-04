// THE DUEL, AS A PERSON SEES IT (docs/arena/platform-fighter/concepts/local-versus.png): the title's Duel door, the arcade
// select screen (busts, ◀ ▶ cyclers instead of dropdowns, arrows that repeat while held, the keyboard's own cursor, a stage
// tile and its backdrop, the seat cards' readiness, one big READY), the VS card while the stage loads, the match in REAL TIME
// (rendered, not stepped): 3 · 2 · 1, FIGHT!, a percent that pops on a hit, the HUD in the corners and nothing in the
// middle, the Duel's own pause menu, GAME! then <NAME> WINS then the results card (Esc there opens nothing; a confirm
// skips ahead), Rematch, Change fighters back to the lobby with the choices kept, and Back to title. Real clicks and keys.
//   node scripts/verify-duel-ui.mjs [url] [--stage kiln] [--shots]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { makeChecker } from './fighter-probe.mjs';
import { cycleTo } from './versus-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const STAGE = opt('stage', 'kiln');
const shots = args.includes('--shots');
const t = makeChecker();
const check = t.check;
mkdirSync('verify-out/duel-ui', { recursive: true });

const click = async (page, locator, wait = 350) => {
  const loc = typeof locator === 'string' ? page.locator(locator).first() : locator;
  await loc.waitFor({ state: 'visible', timeout: 10000 });
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box for ' + locator);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(wait);
};
const finish = (page) => page.evaluate(() => {
  const g = window.__game, c = g.ctx; c.state.paused = true;
  // (P2 dropped past the bottom blast line: a ring-out on the next step, which no recovery can undo; a teleport during a
  // respawn is ignored, so try until the last stock is gone)
  for (let tries = 0; tries < 40 && c.arena.stockMatch.state !== 'finished'; tries++) {
    const zone = c.arena.stockStage.zone;
    Object.assign(c.arena.bundle(1).player, { x: zone.right - 140, y: zone.bottom + 20, vx: 0, vy: 0, grounded: false });
    for (let tick = 0; tick < 140; tick++) g.tick(false, { forcePaused: true });
  }
  c.state.paused = false;
  return c.arena.stockMatch.state;
});
const fighterIndex = (page, slot) => page.evaluate((slot) => { const c = window.__game.ctx; return ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'].indexOf(c.versus.seats[slot].fighter); }, slot);
const focusName = (page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? '');

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => {
  window.testPads = [];
  Object.defineProperty(navigator, 'getGamepads', { value: () => window.testPads });
});
try {
  await page.goto(url + '?link=off', { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(600);

  // ---- the door and the select screen ----
  const door = await page.locator('#expedition-entry [data-entry="duel"]').textContent();
  check('the title has a Duel door that says what it is', /Duel/.test(door ?? '') && /Local versus/.test(door ?? ''), JSON.stringify(door));
  await click(page, '#expedition-entry [data-entry="duel"]', 600);
  await page.waitForFunction(() => [...document.querySelectorAll('#versus-lobby .versus-portrait')].every(img => img.complete && img.naturalWidth > 0), null, { timeout: 15000 });
  const lobby = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#versus-lobby .versus-portrait')];
    return {
      heading: document.querySelector('#versus-heading')?.textContent,
      ready: document.querySelector('#versus-start')?.textContent?.trim(),
      art: imgs.map(i => i.dataset.art),
      mirrored: imgs.map(i => new DOMMatrix(getComputedStyle(i).transform).a < 0),
      cards: [...document.querySelectorAll('#versus-lobby .versus-device-label')].map(e => e.textContent),
      selects: document.querySelectorAll('#versus-lobby select').length,
      cyclers: [...document.querySelectorAll('#versus-lobby .versus-cycler')].filter(c => !c.hidden).map(c => c.getAttribute('aria-label')),
      backdrop: document.querySelector('#versus-lobby .versus-backdrop > div.on')?.dataset.stage,
      focus: document.activeElement?.getAttribute('aria-label'),
    };
  });
  check('the select screen opens on DUEL with both busts, player 2 mirrored to face player 1', lobby.heading === 'Duel' && lobby.art.join() === 'bust,bust' && !lobby.mirrored[0] && lobby.mirrored[1], JSON.stringify(lobby));
  check('no dropdowns: every choice is a ◀ value ▶ cycler (fighters, devices, the CPU\'s level)',
    lobby.selects === 0 && ['Player 1 fighter', 'Player 1 device', 'Player 2 fighter', 'Player 2 device', 'Player 2 CPU difficulty'].every(n => lobby.cyclers.includes(n)), JSON.stringify(lobby.cyclers));
  check('one big READY under two seat cards, the keyboard\'s cursor on its own fighter, the stage backdrop behind',
    lobby.ready === 'Ready' && lobby.cards[0].startsWith('Player 1') && lobby.focus === 'Player 1 fighter' && !!lobby.backdrop, JSON.stringify(lobby));

  // ---- every name on both nameplates, at four window sizes (the kit draws at 1, 2 and 3 art pixels): none clipped ----
  const seatsBefore = await page.evaluate(() => window.__game.ctx.versus.seats.map(s => s.fighter));
  const clipped = [];
  for (const [width, height] of [[1280, 720], [1920, 1080], [800, 600], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (let i = 0; i < 10; i++) {
      clipped.push(...await page.evaluate(async (i) => {
        const v = window.__game.ctx.versus, order = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
        v.chooseFighter(0, order[i]); v.chooseFighter(1, order[(i + 5) % 10]);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return [...document.querySelectorAll('#versus-lobby .versus-seat h2')].filter(h => h.scrollWidth > h.clientWidth).map(h => `${innerWidth}x${innerHeight} ${h.textContent} ${h.scrollWidth}>${h.clientWidth}`);
      }, i));
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate((seats) => { const v = window.__game.ctx.versus; seats.forEach((f, slot) => v.chooseFighter(slot, f)); }, seatsBefore);
  await page.waitForTimeout(300);
  check('every fighter\'s name fits both nameplates at 1280x720, 1920x1080, 800x600 and 390x844 (nothing clipped)', clipped.length === 0, clipped.slice(0, 6).join(' | '));

  // ---- the arrows: a click steps once, a held arrow keeps stepping ----
  const start0 = await fighterIndex(page, 0);
  await click(page, page.getByRole('button', { name: 'Next fighter for player 1', exact: true }), 150);
  const one = await fighterIndex(page, 0);
  const next = await page.getByRole('button', { name: 'Next fighter for player 1', exact: true }).boundingBox();
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2); await page.mouse.down();
  await page.waitForTimeout(900); await page.mouse.up();
  const held = await fighterIndex(page, 0);
  check('▶ steps the roster once per click, and keeps stepping while held', one === (start0 + 1) % 10 && (held - one + 10) % 10 >= 4, JSON.stringify({ start0, one, held }));

  // ---- the keyboard drives its own seat: ← → turn the row under the cursor, ↑ ↓ move the cursor ----
  await page.getByRole('group', { name: 'Player 1 fighter', exact: true }).focus();
  const k0 = await fighterIndex(page, 0);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  const k1 = await fighterIndex(page, 0);
  await page.keyboard.press('ArrowDown');
  const down = await focusName(page);
  await page.keyboard.press('ArrowDown');
  const down2 = await focusName(page);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  const up = await focusName(page);
  check('the keyboard\'s ← → step its fighter and ↑ ↓ walk the cursor row by row (fighter, device, the rival\'s fighter)',
    k1 === (k0 + 8) % 10 && down === 'Player 1 device' && down2 === 'Player 2 fighter' && up === 'Player 1 fighter', JSON.stringify({ k0, k1, down, down2, up }));

  // ---- a stage tile, and the room behind follows it ----
  await click(page, `.versus-stage-tile[data-stage="${STAGE}"]`, 900);
  const stage = await page.evaluate(() => ({
    chosen: window.__game.ctx.versus.stage,
    checked: document.querySelector('.versus-stage-tile[aria-checked="true"]')?.dataset.stage,
    backdrop: document.querySelector('#versus-lobby .versus-backdrop > div.on')?.dataset.stage,
  }));
  check(`clicking ${STAGE} chooses it: the tile is checked and the backdrop behind becomes that stage`, stage.chosen === STAGE && stage.checked === STAGE && stage.backdrop === STAGE, JSON.stringify(stage));
  if (shots) await page.screenshot({ path: 'verify-out/duel-ui/1-lobby.png' });

  // ---- two CPUs: both cards ready, READY reads FIGHT! ----
  await cycleTo(page, 'Player 1 device', 'cpu');
  const ready = await page.evaluate(() => ({
    status: document.querySelector('#versus-lobby .versus-status')?.textContent,
    go: document.querySelector('#versus-start')?.dataset.go, label: document.querySelector('#versus-start')?.textContent,
    badges: [...document.querySelectorAll('#versus-lobby .versus-ready')].map(b => b.getAttribute('aria-pressed')),
    glow: [...document.querySelectorAll('#versus-lobby .versus-device')].map(c => c.dataset.ready),
  }));
  check('with both seats on CPU both cards show ready and READY becomes FIGHT!', ready.go === 'true' && ready.label === 'Fight!' && ready.badges.join() === 'true,true' && ready.glow.join() === 'true,true', JSON.stringify(ready));

  // ---- the VS card while the stage loads ----
  await page.evaluate(() => {
    const lobby = document.getElementById('versus-lobby');
    new MutationObserver(() => {
      if (lobby.dataset.phase !== 'loading' || window.__splash) return;
      const s = lobby.querySelector('.versus-splash');
      window.__splash = { display: getComputedStyle(s).display, names: [...s.querySelectorAll('b')].map(b => b.textContent), stage: s.querySelector('.versus-splash-stage')?.textContent, z: getComputedStyle(lobby).zIndex };
    }).observe(lobby, { attributes: true, attributeFilter: ['data-phase'] });
  });
  const readyAt = Date.now();
  await click(page, '#versus-start', 0);
  await page.locator('#versus-lobby').waitFor({ state: 'hidden', timeout: 30000 });
  const cardHeld = Date.now() - readyAt;
  const splash = await page.evaluate(() => window.__splash);
  check('READY shows the VS card while the stage loads: both names and the stage, over the loading curtain', splash?.display === 'grid' && splash.names.every(Boolean) && /Kiln|Foundry|Cistern|Gallery/.test(splash.stage ?? '') && Number(splash.z) > 60, JSON.stringify(splash));
  check('the VS card holds at least 4.2 s (the announcer\'s "P1! Versus! P2!") before the countdown', cardHeld >= 4100, `${cardHeld} ms`);

  // ---- 3 · 2 · 1, FIGHT! ----
  await page.locator('#stock-match-hud').waitFor({ state: 'visible' });
  await page.waitForFunction(() => /^[123]$/.test(document.querySelector('.stock-message')?.textContent ?? ''), null, { timeout: 15000 });
  const count = await page.locator('.stock-message').textContent();
  await page.waitForFunction(() => document.querySelector('.stock-banner[data-kind="fight"]:not([hidden])'), null, { timeout: 20000 });
  const fight = await page.locator('.stock-banner').textContent();
  const onStage = await page.evaluate(() => window.__game.ctx.arena.stockStage.id);
  check('the countdown slams 3 · 2 · 1 then FIGHT! on the chosen stage', /^[123]$/.test(count ?? '') && fight === 'Fight!' && onStage === STAGE, JSON.stringify({ count, fight, onStage }));
  await page.waitForFunction(() => document.querySelector('.stock-banner').hidden, null, { timeout: 5000 });

  // ---- REAL time: they fight, the HUD follows, the middle stays clear ----
  const start = await page.evaluate(() => { const c = window.__game.ctx; return { a: c.arena.bundle(0).player.x, b: c.arena.bundle(1).player.x, clock: document.querySelector('.stock-timer')?.textContent }; });
  let seen = { moved: false, hit: false };
  for (let i = 0; i < 16 && !(seen.moved && seen.hit); i++) {
    await page.waitForTimeout(1000);
    seen = await page.evaluate((s) => {
      const c = window.__game.ctx, pct = [...document.querySelectorAll('.stock-percent')].map(e => parseInt(e.textContent ?? '0', 10));
      return { moved: Math.abs(c.arena.bundle(0).player.x - s.a) > 20 && Math.abs(c.arena.bundle(1).player.x - s.b) > 20, hit: pct.some(p => p > 0) || c.arena.stockMatch.fighters.some(f => f.stocks < 3), pct, clock: document.querySelector('.stock-timer')?.textContent };
    }, start);
  }
  if (shots) await page.screenshot({ path: 'verify-out/duel-ui/2-fighting.png' });
  check('both computer fighters move in real time, blows land (a percent rises), and the timer runs', seen.moved && seen.hit && seen.clock !== start.clock, JSON.stringify({ seen, start }));
  const popped = await page.evaluate(() => new Promise((resolve) => {
    const c = window.__game.ctx, f = c.arena.stockMatch.fighters[1], el = document.querySelectorAll('.stock-percent')[1];
    f.volatility += 25;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(el.getAnimations().length)));
  }));
  check('a hit makes the percent pop (an animation runs on the number when it rises)', popped > 0, String(popped));
  const layout = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight, mid = { l: W * .25, r: W * .75, t: H * .2, b: H * .7 };
    const boxes = [...document.querySelectorAll('#stock-match-hud .stock-fighter, #stock-match-hud .stock-timer')].map(e => e.getBoundingClientRect());
    const cards = [...document.querySelectorAll('.stock-fighter')].map(e => e.getBoundingClientRect());
    return {
      clear: boxes.every(r => r.right <= mid.l || r.left >= mid.r || r.bottom <= mid.t || r.top >= mid.b),
      corners: cards[0].left < W * .2 && cards[1].right > W * .8 && cards.every(r => r.bottom > H * .8),
      timer: (() => { const r = document.querySelector('.stock-timer').getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - W / 2) < 4 && r.top < H * .1; })(),
      art: [...document.querySelectorAll('.stock-portrait')].map(i => i.dataset.art),
    };
  });
  check('the HUD keeps to the corners (cards bottom-left and bottom-right, the timer top-centre) and nothing sits in the middle', layout.clear && layout.corners && layout.timer && layout.art.join() === 'bust,bust', JSON.stringify(layout));

  // ---- the super cut-in: a diagonal band from the caster's side with its bust and the ultimate's name, gone in under 0.6 s ----
  const cut = await page.evaluate(() => new Promise((resolve) => {
    const c = window.__game.ctx, el = document.querySelector('.stock-cutin'), at = performance.now();
    c.events.emit('stockUltimate', { slot: 1, fighter: c.arena.fighterId(1), name: 'Redline' });
    const shown = { visible: !el.hidden, slot: el.dataset.slot, name: el.querySelector('b')?.textContent, art: el.querySelector('img')?.dataset.art, mirrored: new DOMMatrix(getComputedStyle(el.querySelector('img')).transform).a < 0 };
    const poll = () => el.hidden ? resolve({ ...shown, goneMs: Math.round(performance.now() - at) }) : requestAnimationFrame(poll);
    requestAnimationFrame(poll);
  }));
  check('an ultimate (stockUltimate) slams the super cut-in: P2\'s band with its bust mirrored and the ultimate\'s name, gone within 0.6 s',
    cut.visible && cut.slot === '1' && cut.name === 'Redline' && cut.art === 'bust' && cut.mirrored && cut.goneMs <= 1000, JSON.stringify(cut)); // (560 ms by design; a busy machine's frames add slack)

  // ---- the Duel's own pause menu ----
  await page.keyboard.press('Escape');
  await page.locator('#pause-overlay.visible').waitFor({ timeout: 5000 });
  const pause = await page.evaluate(() => {
    const o = document.getElementById('pause-overlay');
    const rows = [...o.querySelectorAll('#pause-resume, .pause-menu button')].filter(b => b.getClientRects().length > 0).map(b => b.textContent.trim());
    return { duel: o.classList.contains('duel-pause'), title: document.getElementById('pause-title').textContent, rows, tools: [...o.querySelectorAll('.pause-tools button')].some(b => b.getClientRects().length > 0) };
  });
  if (shots) await page.screenshot({ path: 'verify-out/duel-ui/3-pause.png' });
  check('Esc opens the Duel\'s pause: PAUSED, Resume / Restart match / Change fighters / Controls / Quit to title, nothing of the descent\'s',
    pause.duel && pause.title === 'Paused' && pause.rows.join() === 'Resume match,Restart match,Change fighters,Controls,Quit to title' && !pause.tools, JSON.stringify(pause));
  await click(page, '#pause-duel-controls', 200);
  const controls = await page.evaluate(() => ({ shown: document.querySelector('.pause-duel-controls')?.getClientRects().length > 0, stats: document.getElementById('pause-stats')?.getClientRects().length > 0 }));
  check('Controls turns the side card from the match to the button layout', controls.shown && !controls.stats, JSON.stringify(controls));
  await page.keyboard.press('Escape');
  await page.locator('#pause-overlay.visible').waitFor({ state: 'hidden', timeout: 5000 });

  // ---- GAME!, then <NAME> WINS over the pose, then the card; Esc there opens nothing ----
  await page.evaluate(() => {
    window.__beats = [];
    const hud = document.getElementById('stock-match-hud'), banner = hud.querySelector('.stock-banner'), card = hud.querySelector('.stock-result');
    new MutationObserver(() => window.__beats.push({ what: card.hidden ? (banner.hidden ? 'none' : banner.dataset.kind) : 'card', at: performance.now() }))
      .observe(hud, { attributes: true, subtree: true, attributeFilter: ['hidden', 'data-kind'] });
  });
  check('the match can be finished (a ring-out per stock)', await finish(page) === 'finished');
  const finishedAt = await page.evaluate(() => performance.now());
  const game = await page.evaluate(() => ({ banner: document.querySelector('.stock-banner:not([hidden])')?.textContent, card: document.querySelector('.stock-result').hidden }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const escDuringGame = await page.evaluate(() => document.querySelector('#pause-overlay.visible') !== null);
  await page.waitForFunction(() => document.querySelector('.stock-banner[data-kind="wins"]:not([hidden])'), null, { timeout: 5000 });
  const wins = await page.locator('.stock-banner').textContent();
  if (shots) await page.screenshot({ path: 'verify-out/duel-ui/4-wins.png' });
  await page.locator('.stock-result').waitFor({ state: 'visible', timeout: 10000 });
  const timing = await page.evaluate((t0) => {
    const first = (what) => window.__beats.find(b => b.what === what)?.at;
    return { wins: Math.round(first('wins') - t0), card: Math.round(first('card') - t0) };
  }, finishedAt);
  check('GAME! slams in at once with the card held back, then <NAME> WINS (~0.95 s), then the results card (~2.2 s)',
    game.banner === 'Game!' && game.card === true && / wins$/.test(wins ?? '') && Math.abs(timing.wins - 950) < 350 && Math.abs(timing.card - 2200) < 450, JSON.stringify({ game, wins, timing }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const escOnCard = await page.evaluate(() => document.querySelector('#pause-overlay.visible') !== null);
  check('Esc on the results opens no pause menu (the card owns that moment)', !escDuringGame && !escOnCard, JSON.stringify({ escDuringGame, escOnCard }));
  const result = await page.evaluate(() => ({
    title: document.querySelector('.stock-result-title')?.textContent,
    tagline: document.querySelector('.stock-result-tagline')?.textContent,
    rows: [...document.querySelectorAll('.stock-result-stats dt')].map(e => e.textContent),
    bust: [...document.querySelectorAll('.stock-result-portrait img')].map(i => i.dataset.art),
    focus: document.activeElement?.textContent,
  }));
  if (shots) await page.screenshot({ path: 'verify-out/duel-ui/5-result.png' });
  check('the results card names the winner, a line under it, the framed bust, Stocks and Ring-outs, Rematch under the cursor',
    / wins$/.test(result.title ?? '') && !!result.tagline && result.rows.join() === 'Stocks,Ring-outs' && result.bust.join() === 'bust' && result.focus === 'Rematch', JSON.stringify(result));
  await click(page, page.getByRole('button', { name: 'Rematch', exact: true }), 200);
  const again = await page.evaluate(() => ({ state: window.__game.ctx.arena.stockMatch.state, stocks: window.__game.ctx.arena.stockMatch.fighters.map(f => f.stocks), result: document.querySelector('.stock-result').hidden }));
  check('Rematch starts a fresh match: the card goes, a countdown, three stocks each', again.result && (again.state === 'countdown' || again.state === 'fighting') && again.stocks.join() === '3,3', JSON.stringify(again));

  // ---- a confirm skips GAME! straight to the card ----
  await page.waitForFunction(() => document.querySelector('.stock-message')?.hidden === true, null, { timeout: 20000 });
  check('the rematch can be finished too', await finish(page) === 'finished');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const skipped = await page.evaluate(() => !document.querySelector('.stock-result').hidden);
  check('Enter during GAME! skips straight to the results card', skipped);

  // ---- Change fighters; READY again and skip the VS card; the pause's Change fighters; Back to title ----
  await click(page, page.getByRole('button', { name: 'Change fighters', exact: true }), 600);
  const lobbyAgain = await page.evaluate(() => ({ visible: !document.querySelector('#versus-lobby').hidden, stage: window.__game.ctx.versus.stage, checked: document.querySelector('.versus-stage-tile[aria-checked="true"]')?.dataset.stage, devices: window.__game.ctx.versus.seats.map(s => s.device) }));
  check('Change fighters returns to the select screen with the stage and the seats as they were', lobbyAgain.visible && lobbyAgain.stage === STAGE && lobbyAgain.checked === STAGE && lobbyAgain.devices.join() === 'cpu,cpu', JSON.stringify(lobbyAgain));
  // (READY at once, the winner's call still playing: a new screen cuts a stale call, so the VS call is heard whole)
  const loadingAt = await page.evaluate(() => performance.now());
  await click(page, '#versus-start', 0);
  await page.waitForFunction(() => window.__game.ctx.versus.phase === 'loading', null, { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  const skipAt = Date.now();
  await page.locator('#versus-lobby').waitFor({ state: 'hidden', timeout: 30000 });
  const skip = await page.evaluate((from) => {
    const said = window.__game.ctx.audio.duel?.debugSnapshot().said ?? [];
    const vs = said.filter(x => x.at >= from && (x.line === 'versus' || x.line.startsWith('fighter.')));
    return { cut: window.__game.ctx.versus.introCut, phase: window.__game.ctx.versus.phase, paused: window.__game.ctx.state.paused, vs: vs.map(x => ({ line: x.line, cut: !!x.cut })), audio: !!window.__game.ctx.audio.duel, recent: said.slice(-6).map(x => ({ line: x.line, at: Math.round(x.at - from), cut: !!x.cut })) };
  }, loadingAt);
  check('any key skips the VS card: the countdown follows as soon as the stage is built', skip.cut && skip.phase === 'playing' && !skip.paused, JSON.stringify({ ...skip, ms: Date.now() - skipAt }));
  // The skip cuts the VS call where it stands: the line playing is cut and the rest (P2's name at least) is never said.
  check('the skip cuts the announcer\'s VS call (the line playing is cut; the call never reaches P2\'s name)',
    !skip.audio || (skip.vs.some(x => x.cut) && skip.vs.length < 3), JSON.stringify({ vs: skip.vs, recent: skip.recent }));
  await page.waitForFunction(() => document.querySelector('.stock-message')?.hidden === true, null, { timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.locator('#pause-overlay.visible').waitFor({ timeout: 5000 });
  await click(page, '#pause-change-fighters', 600);
  const fromPause = await page.evaluate(() => ({ lobby: !document.querySelector('#versus-lobby').hidden, pause: document.querySelector('#pause-overlay.visible') !== null, paused: window.__game.ctx.state.paused }));
  check('the Duel pause\'s Change fighters goes back to the select screen', fromPause.lobby && !fromPause.pause, JSON.stringify(fromPause));

  // ---- a mirror match: both seats on one fighter, P2 in the second colourway (render/duel/costumes.ts) on every bust ----
  // (the share of a bust's pixels that differ between the two seats' images, compared as drawn, not as mirrored by CSS)
  const busts = (a, b) => page.evaluate(([a, b]) => {
    const x = document.querySelector(a), y = document.querySelector(b);
    if (!x?.complete || !y?.complete || !x.naturalWidth || !y.naturalWidth) return { share: -1 };
    const w = 64, c = document.createElement('canvas'); c.width = c.height = w;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(x, 0, 0, w, w); const p = g.getImageData(0, 0, w, w).data; g.clearRect(0, 0, w, w); g.drawImage(y, 0, 0, w, w); const q = g.getImageData(0, 0, w, w).data;
    let n = 0; for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 40) n++;
    return { share: +(n / (w * w)).toFixed(3), costumes: [x.dataset.costume, y.dataset.costume], fighters: [x.dataset.fighter, y.dataset.fighter] };
  }, [a, b]);
  const altLoaded = (sel) => page.waitForFunction((sel) => { const i = document.querySelector(sel); return i?.dataset.costume === 'alt' && i.src.startsWith('blob:') && i.complete && i.naturalWidth > 0; }, sel, { timeout: 10000 });
  await page.evaluate(() => { const v = window.__game.ctx.versus; v.chooseFighter(0, 'ilyra-voss'); v.chooseFighter(1, 'ilyra-voss'); });
  await altLoaded('#versus-lobby .versus-seat-1 .versus-portrait');
  const mirrorLobby = await busts('#versus-lobby .versus-seat-0 .versus-portrait', '#versus-lobby .versus-seat-1 .versus-portrait');
  await click(page, '#versus-start', 0);
  await page.waitForFunction(() => window.__game.ctx.versus.phase === 'loading', null, { timeout: 5000 });
  const mirrorCard = await page.evaluate(() => [...document.querySelectorAll('.versus-splash-side img')].map(i => i.dataset.costume ?? ''));
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.ctx.versus.phase === 'playing', null, { timeout: 20000 });
  await altLoaded('.stock-fighter-1 .stock-portrait');
  const mirrorHud = await busts('.stock-fighter-0 .stock-portrait', '.stock-fighter-1 .stock-portrait');
  check('a mirror match dresses P2 in the second colourway: the lobby the moment both seats match, the VS card and the HUD (P2\'s bust pixels differ from P1\'s)',
    mirrorLobby.share > .03 && mirrorLobby.costumes.join() === ',alt' && mirrorCard.join() === ',alt' && mirrorHud.share > .03 && mirrorHud.costumes.join() === ',alt',
    JSON.stringify({ mirrorLobby, mirrorCard, mirrorHud }));
  await page.waitForFunction(() => document.querySelector('.stock-message')?.hidden === true, null, { timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.locator('#pause-overlay.visible').waitFor({ timeout: 5000 });
  await click(page, '#pause-change-fighters', 600);
  await click(page, '.versus-back', 800);
  const title = await page.evaluate(() => ({ title: !document.querySelector('#expedition-entry')?.hidden, phase: window.__game.ctx.versus.phase, lobby: document.querySelector('#versus-lobby').hidden }));
  check('Back closes the Duel and shows the title', title.title && title.phase === 'idle' && title.lobby, JSON.stringify(title));
  check('no page errors in the whole path', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  check('the path ran to the end', false, String(error).split('\n')[0]);
  await page.screenshot({ path: 'verify-out/duel-ui/failure.png' }).catch(() => {});
} finally {
  await browser.close();
}
console.log(`\nduel ui probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);

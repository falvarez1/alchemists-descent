// THE DUEL, AS A PERSON SEES IT (docs/arena/platform-fighter/concepts/local-versus.png): the title's Duel door, the lobby
// (busts, the fighter arrows, a stage tile and its backdrop, the seat cards, one big READY), the match played in REAL
// TIME (rendered, not stepped) with the HUD in the corners and nothing in the middle, the results card, Rematch,
// Change fighters back to the lobby with the choices kept, and Back to title. Every press is a real click.
//   node scripts/verify-duel-ui.mjs [url] [--stage kiln] [--shots]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { makeChecker } from './fighter-probe.mjs';

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
  // (a teleport during a respawn or a CPU recovery can be undone: try until the last stock is gone)
  for (let tries = 0; tries < 40 && c.arena.stockMatch.state !== 'finished'; tries++) {
    Object.assign(c.arena.bundle(1).player, { x: c.arena.stockStage.zone.right - 140, vx: 0, grounded: false });
    for (let tick = 0; tick < 140; tick++) g.tick(false, { forcePaused: true });
  }
  c.state.paused = false;
  return c.arena.stockMatch.state;
});

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

  // ---- the door and the lobby ----
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
      cards: [...document.querySelectorAll('.versus-device-label')].map(e => e.textContent),
      backdrop: document.querySelector('.versus-backdrop > div.on')?.dataset.stage,
      focus: document.activeElement?.id,
    };
  });
  check('the lobby opens on DUEL with both busts (or the roster portrait while a bust is unpainted), player 2 mirrored to face player 1',
    lobby.heading === 'Duel' && lobby.art.length === 2 && lobby.art.every(a => a === 'bust' || a === 'portrait') && !lobby.mirrored[0] && lobby.mirrored[1], JSON.stringify(lobby));
  check('one big READY under two seat cards (PLAYER 1, PLAYER 2), focused, with the stage backdrop behind',
    lobby.ready === 'Ready' && lobby.cards.join() === 'Player 1,Player 2' && lobby.focus === 'versus-start' && !!lobby.backdrop, JSON.stringify(lobby));

  // ---- the fighter arrows ----
  const before = await page.evaluate(() => window.__game.ctx.versus.seats[0].fighter);
  await click(page, page.getByRole('button', { name: 'Next fighter for player 1', exact: true }));
  const after = await page.evaluate(() => ({ id: window.__game.ctx.versus.seats[0].fighter, name: document.querySelector('.versus-seat-0 h2')?.textContent }));
  await click(page, page.getByRole('button', { name: 'Previous fighter for player 1', exact: true }));
  const back = await page.evaluate(() => window.__game.ctx.versus.seats[0].fighter);
  check('◂ ▸ beside the name step player 1 through the roster and back', after.id !== before && back === before && !!after.name, JSON.stringify({ before, after, back }));

  // ---- a stage tile, and the room behind follows it ----
  await click(page, `.versus-stage-tile[data-stage="${STAGE}"]`, 900);
  const stage = await page.evaluate(() => ({
    chosen: window.__game.ctx.versus.stage,
    checked: document.querySelector('.versus-stage-tile[aria-checked="true"]')?.dataset.stage,
    backdrop: document.querySelector('.versus-backdrop > div.on')?.dataset.stage,
    line: document.querySelector('.versus-stage-foot')?.textContent,
  }));
  check(`clicking ${STAGE} chooses it: the tile is checked, the backdrop behind the lobby becomes that stage, the line names it`,
    stage.chosen === STAGE && stage.checked === STAGE && stage.backdrop === STAGE && /·/.test(stage.line ?? ''), JSON.stringify(stage));
  if (shots) await page.screenshot({ path: 'verify-out/duel-ui/1-lobby.png' });

  // ---- two computer fighters, one READY ----
  await page.getByRole('combobox', { name: 'Player 1 device', exact: true }).selectOption('cpu');
  const ready = await page.evaluate(() => ({
    status: document.querySelector('.versus-status')?.textContent,
    go: document.querySelector('#versus-start')?.dataset.go,
    badges: [...document.querySelectorAll('.versus-ready')].map(b => b.getAttribute('aria-pressed')),
    glow: [...document.querySelectorAll('.versus-device')].map(c => c.dataset.ready),
  }));
  check('with both seats on CPU both cards show ready (badge and glow) and READY is armed', ready.go === 'true' && ready.badges.join() === 'true,true' && ready.glow.join() === 'true,true', JSON.stringify(ready));
  await click(page, '#versus-start', 0);
  await page.locator('#versus-lobby').waitFor({ state: 'hidden', timeout: 30000 });
  await page.locator('#stock-match-hud').waitFor({ state: 'visible' });
  const count = await page.locator('.stock-message').textContent();
  await page.waitForFunction(() => document.querySelector('.stock-message')?.hidden === true, null, { timeout: 20000 });
  const onStage = await page.evaluate(() => window.__game.ctx.arena.stockStage.id);
  check('READY starts the match on the chosen stage after a countdown', /^[123]$/.test(count ?? '') && onStage === STAGE, JSON.stringify({ count, onStage }));

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
  check('the HUD keeps to the corners (cards bottom-left and bottom-right, the timer top-centre) and nothing sits in the middle', layout.clear && layout.corners && layout.timer && layout.art.every(a => a === 'bust' || a === 'portrait'), JSON.stringify(layout));

  // ---- results, Rematch ----
  check('the match can be finished (a ring-out per stock)', await finish(page) === 'finished');
  await page.locator('.stock-result').waitFor({ state: 'visible', timeout: 10000 });
  const result = await page.evaluate(() => ({
    title: document.querySelector('.stock-result-title')?.textContent,
    tagline: document.querySelector('.stock-result-tagline')?.textContent,
    rows: [...document.querySelectorAll('.stock-result-stats dt')].map(e => e.textContent),
    bust: [...document.querySelectorAll('.stock-result-portrait img')].map(i => i.dataset.art),
  }));
  if (shots) await page.screenshot({ path: 'verify-out/duel-ui/3-result.png' });
  check('the results card names the winner, a line under it, the framed bust, Stocks and Ring-outs',
    / wins$/.test(result.title ?? '') && !!result.tagline && result.rows.join() === 'Stocks,Ring-outs' && result.bust.length === 1, JSON.stringify(result));
  await click(page, page.getByRole('button', { name: 'Rematch', exact: true }), 200);
  const again = await page.evaluate(() => ({ state: window.__game.ctx.arena.stockMatch.state, stocks: window.__game.ctx.arena.stockMatch.fighters.map(f => f.stocks), result: document.querySelector('.stock-result').hidden, count: document.querySelector('.stock-message')?.textContent }));
  check('Rematch starts a fresh match: the card goes, a countdown, three stocks each', again.result && (again.state === 'countdown' || again.state === 'fighting') && again.stocks.join() === '3,3', JSON.stringify(again));

  // ---- Change fighters, then Back to title ----
  await page.waitForFunction(() => document.querySelector('.stock-message')?.hidden === true, null, { timeout: 20000 });
  check('the rematch can be finished too', await finish(page) === 'finished');
  await click(page, page.getByRole('button', { name: 'Change fighters', exact: true }), 600);
  const lobbyAgain = await page.evaluate(() => ({ visible: !document.querySelector('#versus-lobby').hidden, stage: window.__game.ctx.versus.stage, checked: document.querySelector('.versus-stage-tile[aria-checked="true"]')?.dataset.stage, devices: window.__game.ctx.versus.seats.map(s => s.device) }));
  check('Change fighters returns to the lobby with the stage and the seats as they were', lobbyAgain.visible && lobbyAgain.stage === STAGE && lobbyAgain.checked === STAGE && lobbyAgain.devices.join() === 'cpu,cpu', JSON.stringify(lobbyAgain));
  await click(page, '.versus-back', 800);
  const title = await page.evaluate(() => ({ title: !document.querySelector('#expedition-entry')?.hidden, phase: window.__game.ctx.versus.phase, lobby: document.querySelector('#versus-lobby').hidden }));
  check('Back to title closes the Duel and shows the title', title.title && title.phase === 'idle' && title.lobby, JSON.stringify(title));
  check('no page errors in the whole path', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  check('the path ran to the end', false, String(error).split('\n')[0]);
  await page.screenshot({ path: 'verify-out/duel-ui/failure.png' }).catch(() => {});
} finally {
  await browser.close();
}
console.log(`\nduel ui probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);

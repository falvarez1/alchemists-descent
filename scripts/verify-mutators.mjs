// Runtime verification of the complications (run mutators; content/mutators, game/MutatorDirector), PLAYED:
//   real clicks on the title's Complications fold (the choice, the limit of three, the remembered choice), Begin
//   with them, and then each one's OBSERVABLE effect in the real game: puddles that exist and conduct, slime and
//   gas that really come out of the ceiling and the floor, fuel that burns further (and, wet, less far), the
//   alchemist's health and a real shot's damage, a jump's apex under low gravity, the foes on a floor and what
//   they pay, the light, a heal, a firework chain, and how far a foe notices. Then: nothing leaks (not into the
//   next run, not into localStorage tuning, not across a reload), a save resumes with them and the floor's vents
//   come back the same, the pause menu and the ledger name them, the daily takes the date's own and ignores
//   the player's, and a win under an easy one does not open a tier. And the Sanctum's bargain: a complication
//   for the rest of the descent and a second boon, struck with real clicks, persisted through a reload.
// Usage (dev server running; window.__game is DEV-only):
//   node scripts/verify-mutators.mjs [url] [sections,comma,separated]
//   sections: title,layers,gravity,glass,crowded,light,famine,fireworks,hush,fuel,wet,slime,gas,ledger,resume,daily,leak,bargain
// Screenshots land in verify-out/mutators/.
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, isBenignDevConsoleError, waitForConsoleApi, waitForOpeningEnd } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const only = (process.argv[3] || '').split(',').filter(Boolean);
const outDir = 'verify-out/mutators';
mkdirSync(outDir, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' ' + detail : '')); }
};
const wants = (section) => only.length === 0 || only.includes(section);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = 424242;
const MUTATOR_NAME_OF = { 'wet-floors': 'Wet Floors', tinderbox: 'Tinderbox', 'slime-rain': 'Slime Rain', 'gas-leak': 'Gas Leak', 'glass-cannon': 'Glass Cannon', 'low-gravity': 'Low Gravity', 'crowded-house': 'Crowded House', 'dark-works': 'Dark Works', famine: 'Short Rations', fireworks: 'Fireworks', hush: 'Hush', 'nosy-neighbours': 'Nosy Neighbours' };
const Cell = { Empty: 0, Water: 2, Wood: 4, Fire: 5, Oil: 6, Stone: 12, Slime: 19, Healium: 25, Grass: 37, MarshGas: 38, Ash: 30 };

const browser = await launchBrowser();
const consoleErrors = [];
const pageErrors = [];

async function openTitle({ viewport = { width: 1280, height: 720 }, fixedDate = null, storage = null } = {}) {
  // A new context is a fresh browser profile: no meta, no saved descent.
  const context = await browser.newContext({ viewport });
  if (fixedDate) {
    await context.addInitScript((fixed) => {
      const RealDate = Date;
      const offset = fixed - RealDate.now();
      class FakeDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
        static now() { return RealDate.now() + offset; }
      }
      globalThis.Date = FakeDate;
    }, fixedDate);
  }
  if (storage) await context.addInitScript((entries) => { for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, storage);
  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(700);
  return page;
}

/*
 * The title is a game menu (docs/TITLE-MENU.md): New descent opens the loadout page, whose Complications row opens a page
 * of twelve toggles (an item each, `.tm-item[data-mutator]`, `aria-checked`); a seed is a page with a field; Descend starts.
 */
const settle = (page) => page.waitForTimeout(520);
const visibleIn = (page, selector) => page.locator(selector).first().isVisible().catch(() => false);
/** From wherever the title is (main, a page under New descent) to the loadout page. */
async function toLoadout(page) {
  for (let n = 0; n < 4; n++) {
    if (await visibleIn(page, '#expedition-entry [data-entry="descend"]')) return;
    if (await visibleIn(page, '#expedition-entry [data-entry="back"]')) await page.locator('#expedition-entry [data-entry="back"]').click();
    else await page.locator('#expedition-entry [data-entry="begin"]').click();
    await settle(page);
  }
}
/** To the Complications page. */
async function toComplications(page) {
  if (await visibleIn(page, '#expedition-entry .tm-item[data-mutator]')) return;
  await toLoadout(page);
  await page.locator('#expedition-entry [data-entry="complications"]').click();
  await settle(page);
}
/** The title's Complications page, with REAL clicks: press each toggle. */
async function chooseOnTitle(page, ids) {
  await toComplications(page);
  for (const id of ids) await page.locator(`#expedition-entry .tm-item[data-mutator="${id}"]`).click();
}
const chosenOnTitle = async (page) => {
  await toComplications(page);
  return page.evaluate(() => [...document.querySelectorAll('#expedition-entry .tm-item[data-mutator][aria-checked="true"]')].map((c) => c.dataset.mutator));
};
const noteOnTitle = (page) => page.evaluate(() => document.querySelector('#expedition-entry .tm-note')?.textContent ?? '');
const cardOnTitle = (page) => page.evaluate(() => document.querySelector('#expedition-entry .tm-detail:not([hidden])')?.textContent ?? '');

/** Begin with a seed chosen on the seed page (a real path), or plain. */
async function begin(page, { seed = null } = {}) {
  await toLoadout(page);
  if (seed !== null) {
    await page.locator('#expedition-entry [data-entry="seed"]').click();
    await settle(page);
    await page.locator('#entry-seed-input').fill(String(seed));
    await page.locator('#expedition-entry [data-seed="use"]').click();
    await settle(page);
  }
  await page.locator('#expedition-entry [data-entry="descend"]').click();
  await waitForOpeningEnd(page);
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active && !window.__game.ctx.levels.transitioning, null, { timeout: 40000 });
  await page.waitForTimeout(600);
}
async function startRun(ids, opts = {}) {
  const page = await openTitle(opts);
  if (ids.length > 0) await chooseOnTitle(page, ids);
  await begin(page, { seed: opts.seed === undefined ? SEED : opts.seed });
  return page;
}
const snap = (page) => page.evaluate(() => {
  const c = window.__game.ctx;
  return {
    mutators: c.state.mutators ?? null,
    runMutators: [...c.run.mutators],
    maxHp: c.player.maxHp,
    hp: c.player.hp,
    level: c.levels.current?.def.id ?? null,
    tainted: c.state.debugTainted === true || c.state.debugGodMode === true,
    wood: c.params.materials[4].flammability,
    ambient: c.params.global.ambient,
    score: c.state.score,
    recorded: c.run.snapshotForSave()?.recorded ?? null,
  };
});

/** Clear a wide open arena with a stone floor around the alchemist and stand him on it. */
async function carveArena(page) {
  return page.evaluate(() => {
    const c = window.__game.ctx;
    const w = c.world;
    const px = Math.floor(c.player.x);
    const py = Math.floor(c.player.y) - 4;
    for (let y = py - 90; y <= py + 14; y++) for (let x = px - 300; x <= px + 300; x++) {
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      if (y <= py) w.clearCellAt(i);
      else w.replaceCellAt(i, 12, 0x6a6e72);
    }
    c.state.arrivalGraceUntil = c.state.frameCount + 3000;
    Object.assign(c.player, { x: px, y: py, vx: 0, vy: 0, hp: c.player.maxHp });
    c.camera.snapTo(px, py);
    c.state.paused = false;
    return { px, py };
  });
}
const worldToClient = `(function (x, y) {
  const ctx = window.__game.ctx, cam = ctx.camera;
  const rect = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
  const VW = 640, VH = 360, zoom = cam.zoom;
  const fracX = cam.x - Math.floor(cam.x), fracY = cam.y - Math.floor(cam.y);
  const ndcX = ((x - cam.renderX + 0.5) / VW - 0.5) * 2 * (1 + 4 / VW) * zoom - fracX * (2 / VW) * zoom;
  const ndcY = -((y - cam.renderY + 0.5) / VH - 0.5) * 2 * (1 + 4 / VH) * zoom + fracY * (2 / VH) * zoom;
  return { cx: rect.left + ((ndcX + 1) / 2) * rect.width, cy: rect.top + ((1 - ndcY) / 2) * rect.height };
})`;
const gotoFloor = async (page, id) => {
  await waitForConsoleApi(page);
  const r = await execConsoleCommand(page, `goto ${id}`, { timeout: 120000, rejectOnError: false });
  if (!r.ok) console.log('   (goto failed: ' + JSON.stringify(r).slice(0, 160) + ')');
  await page.waitForTimeout(2200);
  return r.ok;
};
const teleport = (page, x, y, ms = 800) => page.evaluate(([x, y]) => {
  const c = window.__game.ctx;
  c.state.arrivalGraceUntil = c.state.frameCount + 3000;
  Object.assign(c.player, { x, y, vx: 0, vy: 0 });
  c.camera.snapTo(x, y);
  c.state.paused = false;
}, [x, y]).then(() => sleep(ms));
const planOf = (page) => page.evaluate(() => { const c = window.__game.ctx; const p = c.mutators.planFor(c.levels.current.def.id); return p ? { vents: p.vents.map((v) => ({ kind: v.kind, x: v.x, y: v.y, dir: v.dir, cell: v.cell, budget: v.budget })), puddles: p.puddles.map((q) => ({ x: q.x, y: q.y, depth: q.depth, n: q.cells.length, cells: q.cells })), skipped: p.skipped } : null; });
const countCells = (page, type, box) => page.evaluate(([type, box]) => { const w = window.__game.ctx.world; let n = 0; for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (w.inBounds(x, y) && w.types[w.idx(x, y)] === type) n++; return n; }, [type, box]);

/* ============================== the title page ============================== */
async function sectionTitle() {
  console.log('\n# The title: the Complications page (real clicks)');
  let page = await openTitle({ viewport: { width: 1280, height: 720 } });
  const onMain = await page.evaluate(() => !document.querySelector('#expedition-entry [data-entry="complications"], #expedition-entry .tm-item[data-mutator]'));
  check('the main page has no Complications controls on it (they are one door in)', onMain);
  await toLoadout(page);
  const row = await page.evaluate(() => ({ exists: !!document.querySelector('#expedition-entry [data-entry="complications"]'), value: document.querySelector('#expedition-entry [data-entry="complications"] .tm-value')?.textContent }));
  check('the loadout page has a Complications row, naming nothing', row.exists && row.value === 'None', JSON.stringify(row));
  await toComplications(page);
  const chips = await page.evaluate(() => document.querySelectorAll('#expedition-entry .tm-item[data-mutator]').length);
  check('the page offers all twelve complications', chips === 12, String(chips));
  await chooseOnTitle(page, ['wet-floors', 'low-gravity', 'tinderbox']);
  check('three can be chosen with real clicks', (await chosenOnTitle(page)).length === 3, JSON.stringify(await chosenOnTitle(page)));
  await page.locator('#expedition-entry .tm-item[data-mutator="hush"]').click({ force: true }); // a real click on an entry marked aria-disabled
  const after4 = await page.evaluate(() => ({ on: [...document.querySelectorAll('#expedition-entry .tm-item[data-mutator][aria-checked="true"]')].map((c) => c.dataset.mutator) }));
  check('a fourth is refused, and its card says why', after4.on.length === 3 && !after4.on.includes('hush') && /3 at a time/.test(await cardOnTitle(page)), JSON.stringify(after4) + (await cardOnTitle(page)).slice(0, 120));
  const total = await noteOnTitle(page);
  check('the total says what the three add up to (±0, +1 and −1: an even trade, with an easy one in the set)', /3 in force: an even trade/.test(total) && /will not open a harder tier/.test(total), total);
  await page.locator('#expedition-entry .tm-item[data-mutator="tinderbox"]').focus();
  const card = await cardOnTitle(page);
  check('focusing an entry reads out its regulation', /Tinderbox/.test(card) && /Every fuel in the Works is bone dry/.test(card), card.slice(0, 160));
  await page.screenshot({ path: `${outDir}/title-1280x720-open.png` });
  await page.locator('#expedition-entry [data-entry="back"]').click();
  await settle(page);
  const closedRow = await page.evaluate(() => document.querySelector('#expedition-entry [data-entry="complications"] .tm-value')?.textContent ?? '');
  const recap = await page.evaluate(() => document.querySelector('#expedition-entry [data-entry="descend"]')?.textContent ?? '');
  check('back on the loadout page, the row and the recap name what is chosen', closedRow === '3 in force' && /3 complications/.test(recap), JSON.stringify({ closedRow, recap }));
  // The choice is remembered (the meta profile) the moment it is made: a reloaded title opens with it pressed.
  await page.close();
  page = await openTitle();
  await chooseOnTitle(page, ['famine', 'hush']);
  const metaStored = await page.evaluate(() => JSON.parse(localStorage.getItem('alchemists-descent-meta') ?? '{}').lastMutators);
  check('the meta profile remembers the choice as soon as it is made', JSON.stringify(metaStored) === JSON.stringify(['famine', 'hush']), JSON.stringify(metaStored));
  await page.reload({ waitUntil: 'load' });
  await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(700);
  check('a reloaded title opens with that choice already pressed', JSON.stringify(await chosenOnTitle(page)) === JSON.stringify(['famine', 'hush']), JSON.stringify(await chosenOnTitle(page)));
  await begin(page, { seed: SEED });
  check('Descend carries the remembered choice into the run', JSON.stringify((await snap(page)).mutators) === JSON.stringify(['famine', 'hush']), JSON.stringify(await snap(page)));
  await page.evaluate(() => { const c = window.__game.ctx; c.run.abandon(c); });
  await page.locator('#run-summary:not([hidden])').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#run-summary [data-rs="title"]').click();
  await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(500);
  check('back at the title after the run, the choice is still pressed', JSON.stringify(await chosenOnTitle(page)) === JSON.stringify(['famine', 'hush']), JSON.stringify(await chosenOnTitle(page)));
  await page.locator('#expedition-entry [data-comp="clear"]').click();
  check('Clear all empties it', (await chosenOnTitle(page)).length === 0);
  // Two that cancel (Hush and Nosy Neighbours) never share a descent: the new entry takes the old one's place, and the note says so.
  await page.locator('#expedition-entry .tm-item[data-mutator="hush"]').click();
  await page.locator('#expedition-entry .tm-item[data-mutator="nosy-neighbours"]').click();
  const swapped = { on: await chosenOnTitle(page), note: await noteOnTitle(page) };
  check('Hush and Nosy Neighbours swap rather than cancel, and the note says so', JSON.stringify(swapped.on) === JSON.stringify(['nosy-neighbours']) && /takes the place of Hush/.test(swapped.note), JSON.stringify(swapped));
  await page.locator('#expedition-entry [data-comp="clear"]').click();
  await page.context().close();

  for (const [w, h] of [[960, 600], [1440, 900]]) {
    const small = await openTitle({ viewport: { width: w, height: h } });
    await toLoadout(small);
    const rowBox = await small.evaluate(() => { const b = document.querySelector('#expedition-entry [data-entry="complications"]').getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight }; });
    check(`${w}x${h}: the Complications row is on screen in the loadout page`, rowBox.top >= 0 && rowBox.bottom <= rowBox.vh, JSON.stringify(rowBox));
    await small.screenshot({ path: `${outDir}/title-${w}x${h}-closed.png` });
    await chooseOnTitle(small, ['gas-leak', 'fireworks']);
    // A real click lands on every entry (nothing overlays the list), at this window size.
    const hit = await small.evaluate(async () => {
      let covered = 0;
      for (const item of document.querySelectorAll('#expedition-entry .tm-item[data-mutator]')) {
        item.scrollIntoView({ block: 'nearest' });
        await new Promise((r) => setTimeout(r, 30));
        const b = item.getBoundingClientRect();
        const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (!(item === el || item.contains(el))) covered++;
      }
      return covered;
    });
    check(`${w}x${h}: every entry is hit-testable on the open page`, hit === 0, `${hit} covered`);
    await small.screenshot({ path: `${outDir}/title-${w}x${h}-open.png` });
    await small.context().close();
  }
}

/* ============================== layers: the leak ============================== */
async function sectionLeak() {
  console.log('\n# Nothing leaks: tuning, localStorage, the next run, a reload');
  const page = await startRun(['tinderbox', 'dark-works']);
  const during = await page.evaluate(() => {
    const c = window.__game.ctx;
    window.dispatchEvent(new Event('pagehide')); // the tuning store flushes on this
    document.dispatchEvent(new Event('visibilitychange'));
    c.events.emit('paramsChanged');
    return { stored: localStorage.getItem('ad:tuning:v1'), wood: c.params.materials[4].flammability, ambient: c.params.global.ambient, oil: c.params.materials[6].igniteChance };
  });
  check('in force, the run plays on a clone: wood and oil catch more readily, the cave is darker', during.wood > 0.2 && during.oil > 0.15 && during.ambient < 0.25, JSON.stringify(during));
  await sleep(700);
  const flushed = await page.evaluate(() => localStorage.getItem('ad:tuning:v1'));
  check('a pagehide flush and a paramsChanged write NOTHING of it into ad:tuning:v1', flushed === null, String(flushed));
  // Back to the Workshop (build mode) while the run is live: the shipped tuning is back there.
  const inWorkshop = await page.evaluate(() => { const c = window.__game.ctx; document.getElementById('mode-build-btn')?.click(); return { mode: c.state.mode, wood: c.params.materials[4].flammability, ambient: c.params.global.ambient }; });
  await sleep(300);
  const ws = await page.evaluate(() => { const c = window.__game.ctx; return { mode: c.state.mode, wood: c.params.materials[4].flammability, ambient: c.params.global.ambient }; });
  check('leaving play (the Workshop) puts the shipped tuning back', ws.mode === 'build' && Math.abs(ws.wood - 0.1) < 1e-9 && Math.abs(ws.ambient - 0.36) < 1e-9, JSON.stringify({ inWorkshop, ws }));
  await page.evaluate(() => document.getElementById('mode-play-btn')?.click());
  await sleep(500);
  const back = await page.evaluate(() => { const c = window.__game.ctx; return { mode: c.state.mode, wood: c.params.materials[4].flammability, title: !document.getElementById('expedition-entry').hidden }; });
  console.log('   (back to play: ' + JSON.stringify(back) + ')');
  // End the run (abandon) and look at everything.
  await page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; if (!document.getElementById('expedition-entry').hidden) document.querySelector('#expedition-entry [data-entry="continue"]')?.click(); });
  await sleep(400);
  await page.evaluate(() => { const c = window.__game.ctx; if (c.run.active) c.run.abandon(c); });
  await page.locator('#run-summary:not([hidden])').waitFor({ state: 'visible', timeout: 10000 });
  const ended = await page.evaluate(() => { const c = window.__game.ctx; return { wood: c.params.materials[4].flammability, ambient: c.params.global.ambient, oil: c.params.materials[6].igniteChance, mutators: c.state.mutators ?? null, stored: localStorage.getItem('ad:tuning:v1') }; });
  check('when the run ends the shipped tuning is back, nothing is in force, nothing is stored', Math.abs(ended.wood - 0.1) < 1e-9 && Math.abs(ended.ambient - 0.36) < 1e-9 && Math.abs(ended.oil - 0.08) < 1e-9 && ended.mutators === null && ended.stored === null, JSON.stringify(ended));
  // The next ordinary run (Descend again with the choice cleared) carries nothing.
  await page.locator('#run-summary .entry-comps summary').click();
  await page.locator('#run-summary .comp-clear').click();
  await page.locator('#run-summary [data-rs="again"]').click();
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active && document.getElementById('run-summary')?.hidden, null, { timeout: 40000 });
  await sleep(700);
  const next = await snap(page);
  check('the next run, with the choice cleared, is the Works as issued', next.mutators === null && next.runMutators.length === 0 && Math.abs(next.wood - 0.1) < 1e-9 && Math.abs(next.ambient - 0.36) < 1e-9, JSON.stringify(next));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ctx?.params, null, { timeout: 60000 });
  await sleep(1200);
  const booted = await page.evaluate(() => { const c = window.__game.ctx; return { wood: c.params.materials[4].flammability, ambient: c.params.global.ambient, stored: localStorage.getItem('ad:tuning:v1') }; });
  check('a fresh boot after it all reads the shipped tuning', Math.abs(booted.wood - 0.1) < 1e-9 && Math.abs(booted.ambient - 0.36) < 1e-9 && booted.stored === null, JSON.stringify(booted));
  await page.context().close();
}

/* ============================== gravity ============================== */
async function jumpApex(page, { jetMs = 0 } = {}) {
  await carveArena(page);
  await sleep(900);
  // The jet is the other half of a rise: switched off for the pure jump (a ballistic arc), on for the full-hold climb.
  await page.evaluate((jet) => { const p = window.__game.ctx.player; p.maxLevit = jet ? 100 : 0; p.levit = jet ? 100 : 0; }, jetMs > 0);
  // The trace is per game TICK (frameCount), read in a rAF loop: wall-clock timers drift under load.
  await page.evaluate(() => {
    const c = window.__game.ctx;
    window.__trace = new Map();
    const tick = () => { window.__trace.set(c.state.frameCount, c.player.y); window.__raf = requestAnimationFrame(tick); };
    tick();
  });
  // Held past the 7-tick window in which a release cuts a jump short, then let go.
  await page.keyboard.down('KeyW');
  await sleep(jetMs || 300);
  await page.keyboard.up('KeyW');
  await sleep(2600);
  const ys = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return [...window.__trace.entries()].sort((a, b) => a[0] - b[0]); });
  if (process.env.DEBUG_JUMP) console.log('   trace', JSON.stringify(ys.filter((_, i) => i % 2 === 0).slice(0, 50).map(([f, y]) => [f, Math.round(y)])));
  // The resting floor is the lowest y the trace reaches (the alchemist settles a cell or two after the carve).
  const floorY = Math.max(...ys.map(([, y]) => y));
  const apex = floorY - Math.min(...ys.map(([, y]) => y));
  const airborne = ys.filter(([, y]) => y < floorY - 1);
  const airtime = airborne.length ? airborne[airborne.length - 1][0] - airborne[0][0] : 0;
  return { floorY, apex, airtime };
}
/** The best of three tries (a tap that lands in the first ticks of a settle is cut short, which is the game's own jump-cut, not the dial). */
async function bestJump(page, opts) {
  let best = null;
  for (let k = 0; k < 3; k++) {
    const r = await jumpApex(page, opts);
    if (!best || r.apex > best.apex) best = r;
  }
  return best;
}
/** Ticks a drop of 36 cells takes (teleport up, let go): t = sqrt(2h/g) until terminal speed, so it is the dial itself. */
async function fallTicks(page) {
  await carveArena(page);
  await sleep(900);
  return page.evaluate(() => new Promise((resolve) => {
    const c = window.__game.ctx;
    const floorY = c.player.y;
    Object.assign(c.player, { y: floorY - 36, vy: 0, vx: 0 });
    const t0 = c.state.frameCount;
    let started = false;
    const tick = () => {
      if (!c.player.grounded) started = true;
      if (started && c.player.grounded) resolve({ ticks: c.state.frameCount - t0, floorY });
      else requestAnimationFrame(tick);
    };
    tick();
  }));
}
async function sectionGravity() {
  console.log('\n# Low Gravity: a real jump (W held), measured per tick');
  const plain = await startRun([]);
  const a = await bestJump(plain);
  const aJet = await bestJump(plain, { jetMs: 600 });
  const aFall = await fallTicks(plain);
  await plain.context().close();
  const low = await startRun(['low-gravity']);
  const b = await bestJump(low);
  const bJet = await bestJump(low, { jetMs: 600 });
  const bFall = await fallTicks(low);
  await low.screenshot({ path: `${outDir}/low-gravity.png` });
  await low.context().close();
  console.log(`   pure jump: plain ${a.apex.toFixed(1)} cells / ${a.airtime} ticks, low gravity ${b.apex.toFixed(1)} / ${b.airtime}; jet held 600 ms: plain ${aJet.apex.toFixed(1)}, low ${bJet.apex.toFixed(1)}; a 36-cell drop takes ${aFall.ticks} ticks, ${bFall.ticks} under low gravity`);
  check('a plain jump goes up (the probe stands on its floor)', a.apex > 14 && a.apex < 34, JSON.stringify(a));
  check('under Low Gravity the same jump goes about twice as high (1/0.55)', b.apex > a.apex * 1.6 && b.apex < a.apex * 2.3, `${a.apex.toFixed(1)} -> ${b.apex.toFixed(1)}`);
  check('and the alchemist falls slower: the same 36-cell drop takes about 1/sqrt(0.55) as long again', bFall.ticks > aFall.ticks * 1.2, `${aFall.ticks} -> ${bFall.ticks}`);
  check('the jet is still a hover instrument, not a rocket: its climb is no more than plain', bJet.apex < aJet.apex * 1.25 && bJet.apex > aJet.apex * 0.5, `${aJet.apex.toFixed(1)} -> ${bJet.apex.toFixed(1)}`);
}

/* ============================== glass cannon ============================== */
async function sectionGlass() {
  console.log('\n# Glass Cannon: half the health, blows half again as hard (a real shot)');
  const plain = await startRun([]);
  const p = await snap(plain);
  await plain.context().close();
  const page = await startRun(['glass-cannon']);
  const g = await snap(page);
  check('the alchemist has half the health', Math.abs(g.maxHp - Math.round(p.maxHp * 0.5)) <= 1, `${p.maxHp} -> ${g.maxHp}`);
  check('the run is a real one: saved and not tainted', g.recorded === true && g.tainted === false, JSON.stringify(g));
  await carveArena(page);
  // A foe on the arena floor; every damage call records what it asked for and what it did.
  await page.evaluate(() => {
    const c = window.__game.ctx;
    const e = c.enemyCtl.spawn('slime', Math.floor(c.player.x) + 70, Math.floor(c.player.y), { exact: true });
    e.hp = e.maxHp = 100000; e.sleeping = false;
    window.__slime = e;
    window.__hits = [];
    const orig = c.enemyCtl.damage.bind(c.enemyCtl);
    c.enemyCtl.damage = (en, amount, kx, ky, source = 'direct') => { const before = en.hp; orig(en, amount, kx, ky, source); window.__hits.push({ amount, dealt: before - en.hp, source }); };
  });
  let direct = [];
  for (let k = 0; k < 10 && direct.length < 2; k++) {
    const aim = await page.evaluate(`(${worldToClient})(window.__slime.x, window.__slime.y - 6)`);
    await page.mouse.move(aim.cx, aim.cy);
    await page.mouse.down();
    await sleep(120);
    await page.mouse.up();
    await sleep(900);
    direct = (await page.evaluate(() => window.__hits)).filter((h) => h.source === 'direct' && h.amount > 0);
  }
  console.log('   real shots landed: ' + JSON.stringify(direct.slice(0, 4)));
  check('a real spark bolt landed on the foe', direct.length >= 1, JSON.stringify(direct));
  check('and each blow dealt 1.5x what the wand asked for', direct.length >= 1 && direct.every((h) => Math.abs(h.dealt / h.amount - 1.5) < 0.02), JSON.stringify(direct));
  await page.screenshot({ path: `${outDir}/glass-cannon.png` });
  await page.context().close();
}

/* ============================== crowded house ============================== */
async function populationOf(page) {
  return page.evaluate(() => { const c = window.__game.ctx; const placed = c.levels.current.population?.placed ?? {}; return { total: Object.values(placed).reduce((a, b) => a + b, 0), alive: c.enemies.length }; });
}
async function sectionCrowded() {
  console.log('\n# Crowded House: half again as many creatures, each paying more');
  const plain = await startRun([]);
  await gotoFloor(plain, 'd2');
  const a = await populationOf(plain);
  const bountyPlain = await plain.evaluate(() => { const c = window.__game.ctx; const e = c.enemyCtl.spawn('slime', Math.floor(c.player.x) + 30, Math.floor(c.player.y)); const s0 = c.state.score; c.enemyCtl.kill(e, 0, 0, 'direct'); return c.state.score - s0; });
  await plain.context().close();
  const page = await startRun(['crowded-house']);
  await gotoFloor(page, 'd2');
  const b = await populationOf(page);
  const bountyRich = await page.evaluate(() => { const c = window.__game.ctx; const e = c.enemyCtl.spawn('slime', Math.floor(c.player.x) + 30, Math.floor(c.player.y)); const s0 = c.state.score; c.enemyCtl.kill(e, 0, 0, 'direct'); return c.state.score - s0; });
  console.log(`   same seed, floor 2: ${a.total} placed plain, ${b.total} placed crowded; a slime pays ${bountyPlain} / ${bountyRich}`);
  check('the same floor, the same seed: half again as many creatures placed', a.total > 4 && b.total >= Math.round(a.total * 1.3) && b.total <= Math.round(a.total * 1.7), JSON.stringify({ a, b }));
  check('and a fallen creature pays 40% more', bountyPlain > 0 && bountyRich === Math.round(bountyPlain * 1.4), `${bountyPlain} -> ${bountyRich}`);
  await page.screenshot({ path: `${outDir}/crowded-house.png` });
  await page.context().close();
}

/* ============================== dark works ============================== */
async function meanLuma(page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    const src = document.querySelector('#canvas-holder > canvas');
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 90;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    resolve(s / (d.length / 4) / 255);
  })));
}
async function sectionLight() {
  console.log('\n# Dark Works: the cave is darker (measured off the real canvas)');
  const lumaAt = async (ids) => {
    const page = await startRun(ids);
    await gotoFloor(page, 'd2');
    await page.evaluate(() => { const c = window.__game.ctx; c.state.arrivalGraceUntil = c.state.frameCount + 4000; });
    await sleep(2500);
    let sum = 0;
    for (let k = 0; k < 5; k++) { sum += await meanLuma(page); await sleep(150); }
    const out = { luma: sum / 5, ambient: (await snap(page)).ambient };
    await page.screenshot({ path: `${outDir}/${ids.length ? 'dark-works' : 'plain-light'}.png` });
    await page.context().close();
    return out;
  };
  const plain = await lumaAt([]);
  const dark = await lumaAt(['dark-works']);
  console.log(`   mean luma plain ${plain.luma.toFixed(3)} (ambient ${plain.ambient}), dark works ${dark.luma.toFixed(3)} (ambient ${dark.ambient.toFixed(3)})`);
  check('the ambient floor is lowered for the run', dark.ambient < plain.ambient * 0.65, JSON.stringify({ plain, dark }));
  check('and the picture is measurably darker at the same spot of the same floor', dark.luma < plain.luma * 0.7, JSON.stringify({ plain, dark }));
}

/* ============================== short rations ============================== */
async function healGain(page) {
  await carveArena(page);
  return page.evaluate(async () => {
    const c = window.__game.ctx, w = c.world;
    const px = Math.floor(c.player.x), py = Math.floor(c.player.y);
    // A pool of healium in a stone cup under the alchemist: a real heal, from the grid.
    for (let x = px - 12; x <= px + 12; x++) { w.replaceCellAt(w.idx(x, py + 1), 12, 0x6a6e72); }
    for (let y = py - 5; y <= py; y++) for (let x = px - 10; x <= px + 10; x++) w.replaceCellAt(w.idx(x, y), 25, 0xff9ccf);
    for (let y = py - 6; y <= py; y++) { w.replaceCellAt(w.idx(px - 11, y), 12, 0x6a6e72); w.replaceCellAt(w.idx(px + 11, y), 12, 0x6a6e72); }
    c.player.hp = 30;
    const start = c.player.hp;
    await new Promise((r) => setTimeout(r, 2500));
    return { start, end: c.player.hp, max: c.player.maxHp };
  });
}
async function sectionFamine() {
  console.log('\n# Short Rations: healing at half strength (a real healium pool)');
  const plain = await startRun([]);
  const a = await healGain(plain);
  await plain.context().close();
  const page = await startRun(['famine']);
  const b = await healGain(page);
  console.log(`   plain healed ${(a.end - a.start).toFixed(2)} in 2.5 s; short rations ${(b.end - b.start).toFixed(2)}`);
  check('the plain pool heals the alchemist', a.end - a.start > 3, JSON.stringify(a));
  const ratio = (b.end - b.start) / (a.end - a.start);
  check('under Short Rations the same pool heals about half as much', ratio > 0.3 && ratio < 0.7, `ratio ${ratio.toFixed(2)}`);
  await page.context().close();
}

/* ============================== fireworks ============================== */
async function sectionFireworks() {
  console.log('\n# Fireworks: a creature falls, the burst finishes its neighbour (a chain)');
  const page = await startRun(['fireworks']);
  await carveArena(page);
  await page.evaluate(() => {
    const c = window.__game.ctx;
    window.__kills = []; window.__alch = [];
    c.events.on('enemyKilled', (k) => window.__kills.push(k.kind));
    c.events.on('alchemyKill', (k) => window.__alch.push(k.cause));
    const px = Math.floor(c.player.x), py = Math.floor(c.player.y);
    window.__foes = [60, 68, 76].map((dx) => { const e = c.enemyCtl.spawn('slime', px + dx, py, { exact: true }); e.hp = e.maxHp = 6; e.sleeping = true; return e; });
    c.enemyCtl.kill(window.__foes[0], 0, 0, 'direct');
  });
  await page.screenshot({ path: `${outDir}/fireworks-a.png` });
  await sleep(450);
  await page.screenshot({ path: `${outDir}/fireworks-b.png` });
  await sleep(1800);
  const r = await page.evaluate(() => ({ kills: window.__kills.length, alch: window.__alch, hp: window.__foes.map((e) => e.hp), player: window.__game.ctx.player.hp }));
  console.log('   ' + JSON.stringify(r));
  check('the first creature fell to the player, the others to the bursts: the chain ran to the end', r.kills === 3, JSON.stringify(r));
  check('the bursts count as the world\'s doing (detonated kills)', r.alch.filter((c) => c === 'detonated').length >= 1, JSON.stringify(r));
  await page.context().close();
}

/* ============================== hush ============================== */
async function noticeRange(page) {
  await carveArena(page);
  return page.evaluate(async () => {
    const c = window.__game.ctx;
    // The arrival's grace (nothing sees him while a floor's name is up) is over, and the foe faces him.
    c.state.arrivalGraceUntil = 0;
    const px = Math.floor(c.player.x), py = Math.floor(c.player.y);
    c.player.hp = c.player.maxHp = 100000;
    let far = 0;
    for (let d = 40; d <= 280; d += 20) {
      const e = c.enemyCtl.spawn('slime', px + d, py, { exact: true });
      if (!e) continue;
      e.sleeping = false; e.hp = e.maxHp = 100000;
      let seen = false;
      for (let t = 0; t < 40 && !seen; t++) { await new Promise((r) => setTimeout(r, 25)); if (e.mind) e.mind.facing = -1; seen = e.mind?.visible === true; }
      if (seen) far = d;
      c.enemyCtl.kill(e, 0, 0, 'direct');
    }
    return far;
  });
}
async function sectionHush() {
  console.log('\n# Hush and Nosy Neighbours: creatures notice you from half as far, or half again (probed by distance)');
  const plain = await startRun([]);
  const a = await noticeRange(plain);
  await plain.context().close();
  const page = await startRun(['hush']);
  const b = await noticeRange(page);
  await page.context().close();
  const nosy = await startRun(['nosy-neighbours']);
  const c = await noticeRange(nosy);
  await nosy.context().close();
  console.log(`   a foe first fails to notice beyond ${a} cells plain, ${b} under Hush, ${c} under Nosy Neighbours`);
  check('plain, a foe notices the alchemist from far off', a >= 100, String(a));
  check('under Hush it takes roughly half the distance', b > 0 && b <= a * 0.7 && b >= a * 0.3, `${a} -> ${b}`);
  check('under Nosy Neighbours it reaches half again as far (to the edge of the arena at least)', c >= Math.min(260, a * 1.25), `${a} -> ${c}`);
}

/* ============================== fuel: tinderbox / wet floors ============================== */
async function burnTest(page) {
  await carveArena(page);
  await sleep(300);
  return page.evaluate(async () => {
    const c = window.__game.ctx, w = c.world;
    const px = Math.floor(c.player.x), py = Math.floor(c.player.y);
    let total = 0;
    // Three long planks lying on the arena floor, a fire at the left end of each.
    for (const [dy] of [[0], [-5], [-10]]) {
      for (let x = px + 20; x <= px + 150; x++) for (let y = py + dy - 2; y <= py + dy; y++) { w.replaceCellAt(w.idx(x, y), 4, 0x8a5a2c); total++; }
      for (let y = py + dy - 2; y <= py + dy; y++) { const i = w.idx(px + 19, y); w.replaceCellAt(i, 5, 0xffa030); w.life[i] = 400; }
    }
    // Stone ledges under the upper planks so they do not fall.
    for (const dy of [-5, -10]) for (let x = px + 18; x <= px + 152; x++) w.replaceCellAt(w.idx(x, py + dy + 1), 12, 0x6a6e72);
    c.player.hp = c.player.maxHp = 100000;
    Object.assign(c.player, { x: px - 30, y: py });
    const count = () => { let left = 0; for (const dy of [0, -5, -10]) for (let x = px + 20; x <= px + 150; x++) for (let y = py + dy - 2; y <= py + dy; y++) if (w.types[w.idx(x, y)] === 4) left++; return left; };
    await new Promise((r) => setTimeout(r, 3000));
    const at3 = total - count();
    await new Promise((r) => setTimeout(r, 3000));
    const at6 = total - count();
    return { total, at3, at6, burnt: at6, flammability: c.params.materials[4].flammability };
  });
}
async function sectionFuel() {
  console.log('\n# Tinderbox and Wet Floors: the same planks, the same fire, six seconds');
  const results = {};
  for (const [label, ids] of [['plain', []], ['tinderbox', ['tinderbox']], ['wet', ['wet-floors']]]) {
    const page = await startRun(ids);
    results[label] = await burnTest(page);
    if (label === 'tinderbox') await page.screenshot({ path: `${outDir}/tinderbox-burning.png` });
    await page.context().close();
  }
  console.log('   ' + JSON.stringify(results));
  check('plain, a fire at the end of a plank barely spreads (the Works as issued: wood is slow to catch)', results.plain.burnt < 60, JSON.stringify(results.plain));
  check('under Tinderbox the same fire runs away along the planks (many times as much burns)', results.tinderbox.burnt > Math.max(60, results.plain.burnt * 5), JSON.stringify(results));
  // (Wood at 0.1 sits at the edge of a fire's extinction: whether a handful of planks catch is chance, so Wet Floors is judged on the dial it turns, not on a count of cinders.)
  check('under Wet Floors the fuel is damp: wood catches at about half the shipped chance', results.wet.flammability < results.plain.flammability * 0.7 && results.wet.flammability > 0, JSON.stringify(results));
}

/* ============================== the floor dressing ============================== */
async function sectionWet() {
  console.log('\n# Wet Floors: puddles that exist and conduct, a drip overhead');
  const plain = await startRun([]);
  await gotoFloor(plain, 'd2');
  const waterPlain = await countCells(plain, Cell.Water, { x0: 0, y0: 0, x1: 1599, y1: 1063 });
  await plain.context().close();
  const page = await startRun(['wet-floors']);
  await gotoFloor(page, 'd2');
  const plan = await planOf(page);
  const waterWet = await countCells(page, Cell.Water, { x0: 0, y0: 0, x1: 1599, y1: 1063 });
  const planned = plan.puddles.reduce((n, q) => n + q.n, 0);
  console.log(`   water cells on floor 2: ${waterPlain} plain, ${waterWet} wet; ${plan.puddles.length} puddles (${planned} cells), ${plan.vents.length} drips`);
  check('puddles were planned in basins on the walk, and drips overhead', plan.puddles.length >= 2 && plan.vents.filter((v) => v.kind === 'drips').length >= 3, JSON.stringify({ p: plan.puddles.length, v: plan.vents.length, skipped: plan.skipped }));
  check('the same seed has the planned cells of extra water in the grid (give or take a drip)', Math.abs(waterWet - waterPlain - planned) <= 12, `${waterWet} - ${waterPlain} vs ${planned}`);
  // Stand in the biggest puddle: wet.
  const big = [...plan.puddles].sort((a, b) => b.n - a.n)[0];
  await teleport(page, big.x, big.y - 6, 2200);
  const wet = await page.evaluate(() => window.__game.ctx.player.status.wet);
  check('wading through a puddle wets the alchemist', wet > 0, String(wet));
  // Conduction: a spark in the puddle crawls through the water (local, as the sim's crackle is designed), and a wet
  // alchemist standing in it is shocked: the combination the regulation warns about.
  const conduct = await page.evaluate(async ([cells]) => {
    const c = window.__game.ctx, w = c.world;
    c.player.hp = c.player.maxHp;
    // The puddle cell at the alchemist's feet.
    const fx = Math.floor(c.player.x), fy = Math.floor(c.player.y);
    let cell = cells.find((i) => i % w.width === fx && Math.abs(Math.floor(i / w.width) - fy) <= 3) ?? cells[Math.floor(cells.length / 2)];
    const lit = () => cells.filter((i) => w.charge[i] > 0 || w.activeCharges.has(i)).length;
    const before = lit();
    w.setChargeAt(cell, 200);
    let peak = 0, electrified = 0;
    for (let k = 0; k < 24; k++) {
      await new Promise((r) => setTimeout(r, 40));
      peak = Math.max(peak, lit());
      electrified = Math.max(electrified, c.player.status.electrified ?? 0);
    }
    return { before, peak, n: cells.length, electrified, wet: c.player.status.wet, hp: c.player.hp, max: c.player.maxHp };
  }, [big.cells]);
  console.log('   conduction: ' + JSON.stringify(conduct));
  check('a spark in the puddle crawls out through the water, cell to cell', conduct.peak >= 8 && conduct.peak > conduct.before + 6, JSON.stringify(conduct));
  check('and an alchemist standing in it is shocked', conduct.electrified > 0, JSON.stringify(conduct));
  await page.screenshot({ path: `${outDir}/wet-floors-puddle.png` });
  // The drip falls: stand under one.
  const drip = plan.vents.find((v) => v.kind === 'drips');
  const dripBox = { x0: drip.x - 40, x1: drip.x + 40, y0: drip.y, y1: drip.y + 80 };
  const w0 = await countCells(page, Cell.Water, dripBox);
  await teleport(page, drip.x, drip.y + 22, 9000);
  const w1 = await countCells(page, Cell.Water, dripBox);
  const budget = await page.evaluate(() => { const c = window.__game.ctx; return c.mutators.planFor(c.levels.current.def.id).vents.find((v) => v.kind === 'drips').budget; });
  check('the drip really drips: its budget was spent and the water landed in the grid', budget < 260 && w1 > w0, JSON.stringify({ w0, w1, budget }));
  await page.screenshot({ path: `${outDir}/wet-floors-drip.png` });
  await page.context().close();
}
async function sectionSlime() {
  console.log('\n# Slime Rain: slime from the ceilings along the route');
  const page = await startRun(['slime-rain']);
  await gotoFloor(page, 'd2');
  const plan = await planOf(page);
  check('slime drips were hung from ceilings along the walk', plan.vents.filter((v) => v.kind === 'slime').length >= 4, JSON.stringify({ n: plan.vents.length, skipped: plan.skipped }));
  const v = plan.vents[0];
  const box = { x0: v.x - 30, x1: v.x + 30, y0: v.y, y1: v.y + 100 };
  const s0 = await countCells(page, Cell.Slime, box);
  await teleport(page, v.x, v.y + 24, 10000);
  const s1 = await countCells(page, Cell.Slime, box);
  check('the slime lands as real cells in the grid', s1 > s0 + 5, `${s0} -> ${s1}`);
  await page.screenshot({ path: `${outDir}/slime-rain.png` });
  // Fire turns slime to acid (the sim's own rule, which the regulation warns of): a cup of the stuff on the arena floor, a flame laid on it.
  await carveArena(page);
  const acid = await page.evaluate(async () => {
    const c = window.__game.ctx, w = c.world;
    c.state.arrivalGraceUntil = c.state.frameCount + 3000;
    const px = Math.floor(c.player.x), py = Math.floor(c.player.y);
    for (let y = py - 6; y <= py; y++) { w.replaceCellAt(w.idx(px + 29, y), 12, 0x6a6e72); w.replaceCellAt(w.idx(px + 43, y), 12, 0x6a6e72); }
    for (let y = py - 3; y <= py; y++) for (let x = px + 30; x <= px + 42; x++) w.replaceCellAt(w.idx(x, y), 19, 0x7acb55);
    for (let x = px + 30; x <= px + 42; x++) { const i = w.idx(x, py - 4); w.replaceCellAt(i, 5, 0xffa030); w.life[i] = 120; }
    const countIn = (type) => { let n = 0; for (let y = py - 12; y <= py + 2; y++) for (let x = px + 28; x <= px + 44; x++) if (w.types[w.idx(x, y)] === type) n++; return n; };
    const slimeBefore = countIn(19);
    // Acid eats what it touches and is spent doing it, so it is counted at its peak, not at the end.
    let acidCells = 0;
    for (let k = 0; k < 40; k++) { await new Promise((r) => setTimeout(r, 100)); acidCells = Math.max(acidCells, countIn(7)); }
    return { found: slimeBefore > 0, acidCells, slimeBefore, slimeAfter: countIn(19) };
  });
  console.log('   ' + JSON.stringify(acid));
  check('and a flame turns some of it to acid, as the regulation warns', acid.found && (acid.acidCells > 0 || acid.slimeAfter < acid.slimeBefore), JSON.stringify(acid));
  await page.context().close();
}
async function sectionGas() {
  console.log('\n# Gas Leak: marsh gas from vents in the floor along the route');
  const page = await startRun(['gas-leak']);
  await gotoFloor(page, 'd2');
  const plan = await planOf(page);
  check('gas vents were rooted in floors along the walk', plan.vents.filter((v) => v.kind === 'gas').length >= 3, JSON.stringify({ n: plan.vents.length, skipped: plan.skipped }));
  const v = plan.vents[0];
  const box = { x0: v.x - 50, x1: v.x + 50, y0: v.y - 80, y1: v.y + 5 };
  const g0 = await countCells(page, Cell.MarshGas, box);
  await teleport(page, v.x - 12, v.y - 6, 12000);
  const g1 = await countCells(page, Cell.MarshGas, box);
  check('gas really comes out of the floor into the grid', g1 > g0 + 30, `${g0} -> ${g1}`);
  await page.screenshot({ path: `${outDir}/gas-leak.png` });
  // A flame lights it: fire where gas was.
  const burn = await page.evaluate(async ([v]) => {
    const c = window.__game.ctx, w = c.world;
    let n = 0;
    for (let y = v.y - 60; y <= v.y; y++) for (let x = v.x - 30; x <= v.x + 30; x++) if (w.types[w.idx(x, y)] === 38) n++;
    // The pipe is shut (so the count is the plume's, not the vent's), and a flame takes the gas cell nearest the vent.
    for (const vent of c.mutators.planFor(c.levels.current.def.id).vents) vent.budget = 0;
    let best = -1, bestD = 1e9;
    for (let y = v.y - 60; y <= v.y; y++) for (let x = v.x - 30; x <= v.x + 30; x++) { const i = w.idx(x, y); if (w.types[i] === 38) { const d = Math.hypot(x - v.x, y - v.y); if (d < bestD) { bestD = d; best = i; } } }
    if (best >= 0) { w.replaceCellAt(best, 5, 0xffa030); w.life[best] = 30; }
    let peakFire = 0;
    for (let k = 0; k < 30; k++) {
      await new Promise((r) => setTimeout(r, 100));
      let f = 0;
      for (let y = v.y - 60; y <= v.y; y++) for (let x = v.x - 30; x <= v.x + 30; x++) if (w.types[w.idx(x, y)] === 5) f++;
      peakFire = Math.max(peakFire, f);
    }
    let gasAfter = 0;
    for (let y = v.y - 60; y <= v.y; y++) for (let x = v.x - 30; x <= v.x + 30; x++) if (w.types[w.idx(x, y)] === 38) gasAfter++;
    return { gasBefore: n, gasAfter, peakFire };
  }, [v]);
  console.log('   ' + JSON.stringify(burn));
  check('lit, the gas goes up as a racing front: flames where the plume was, and the plume is consumed', burn.peakFire >= 1 && burn.gasBefore >= 20 && burn.gasAfter <= burn.gasBefore * 0.2, JSON.stringify(burn));
  await page.screenshot({ path: `${outDir}/gas-leak-lit.png` });
  await page.context().close();
}

/* ============================== ledger, pause, meta ============================== */
async function sectionLedger() {
  console.log('\n# The pause menu, the ledger, and the meta policy (a real, untainted run)');
  let page = await startRun(['tinderbox', 'glass-cannon']);
  const s = await snap(page);
  check('a mutator run is a real one: saved and not tainted', s.recorded === true && s.tainted === false, JSON.stringify(s));
  await page.keyboard.press('Escape');
  await page.locator('#pause-overlay').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
  const pause = await page.evaluate(() => document.getElementById('pause-stats')?.textContent ?? '');
  check('the pause menu names the complications', /ComplicationsTinderbox and Glass Cannon/.test(pause), pause.slice(0, 200));
  await page.screenshot({ path: `${outDir}/pause.png` });
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.evaluate(() => { const c = window.__game.ctx; c.events.emit('runComplete', { gold: 0 }); });
  await page.locator('#run-summary:not([hidden])').waitFor({ state: 'visible', timeout: 20000 });
  await sleep(1400);
  const led = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('#run-summary .rs-comp-chip')].map((c) => c.textContent),
    share: document.querySelector('#run-summary .rs-share')?.textContent ?? '',
    unlock: [...document.querySelectorAll('#run-summary .rs-unlock')].map((n) => n.textContent),
    fold: document.querySelector('#run-summary .entry-comps summary')?.textContent ?? '',
    meta: JSON.parse(localStorage.getItem('alchemists-descent-meta') ?? '{}'),
  }));
  check('the ledger shows what the run carried as a chip row', JSON.stringify(led.chips) === JSON.stringify(['Tinderbox', 'Glass Cannon']), JSON.stringify(led.chips));
  check('the share line names them, after the tier', /^Breathing Works — seed 424242 — Tinderbox \+ Glass Cannon — the Kiln quieted in/.test(led.share), led.share);
  check('a win under harder complications opens the next tier like any win', led.unlock.some((t) => /Conjurer \(III\) is open/.test(t)) && led.meta.bestVictoryDifficulty === 2, JSON.stringify({ unlock: led.unlock, best: led.meta.bestVictoryDifficulty }));
  check('but it does not set the fastest-victory record', led.meta.fastestVictoryMs === null || led.meta.fastestVictoryMs === undefined, String(led.meta.fastestVictoryMs));
  check('the ledger offers the choice for the next descent, starting from this one', /Complications: Tinderbox and Glass Cannon/.test(led.fold), led.fold);
  await page.screenshot({ path: `${outDir}/ledger-chips.png` });
  // "Descend again" carries them.
  await page.locator('#run-summary [data-rs="again"]').click();
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active && document.getElementById('run-summary')?.hidden, null, { timeout: 40000 });
  await sleep(700);
  check('"Descend again" carries them into the next run', JSON.stringify((await snap(page)).mutators) === JSON.stringify(['tinderbox', 'glass-cannon']), JSON.stringify(await snap(page)));
  await page.context().close();

  // An EASY complication never opens a tier, and a mixed set does not either; the win still counts.
  page = await startRun(['low-gravity']);
  await page.evaluate(() => { const c = window.__game.ctx; c.events.emit('runComplete', { gold: 0 }); });
  await page.locator('#run-summary:not([hidden])').waitFor({ state: 'visible', timeout: 20000 });
  await sleep(1200);
  const easy = await page.evaluate(() => ({ unlock: [...document.querySelectorAll('#run-summary .rs-unlock')].map((n) => n.textContent), meta: JSON.parse(localStorage.getItem('alchemists-descent-meta') ?? '{}'), share: document.querySelector('#run-summary .rs-share')?.textContent ?? '' }));
  check('a win under an easing complication opens no tier', !easy.unlock.some((t) => /harder Works/i.test(t)) && easy.meta.bestVictoryDifficulty === 0, JSON.stringify(easy.unlock) + ' best=' + easy.meta.bestVictoryDifficulty);
  check('yet the win counts: a victory, and the case it earns', easy.meta.victories === 1 && easy.meta.unlockedKits?.includes('storm'), JSON.stringify(easy.meta));
  check('and it names the complication', /Low Gravity/.test(easy.share), easy.share);
  await page.context().close();
}

/* ============================== save and resume ============================== */
async function sectionResume() {
  console.log('\n# Save, reload, Continue: the complications and the floor\'s vents come back');
  let page = await startRun(['gas-leak', 'wet-floors', 'hush']);
  await gotoFloor(page, 'd2');
  const before = await planOf(page);
  const savedPlain = await page.evaluate(async () => {
    const c = window.__game.ctx;
    c.state.debugTainted = false; // the probe only borrowed the console to reach floor 2; the save is what is under test
    const debugActive = c.debug?.active === true;
    c.levels.saveExpedition(c);
    // The expedition is stored behind the async storage worker: wait for it to land.
    for (let k = 0; k < 60 && !c.levels.hasSavedExpedition(); k++) await new Promise((r) => setTimeout(r, 100));
    return { has: c.levels.hasSavedExpedition(), runMutators: c.run.snapshotForSave()?.mutators ?? null, level: c.levels.current?.def.id ?? null, debugActive };
  });
  check('the expedition save carries the complications (no version bump)', savedPlain.has && JSON.stringify(savedPlain.runMutators) === JSON.stringify(['wet-floors', 'gas-leak', 'hush']) && savedPlain.level === 'd2', JSON.stringify(savedPlain));
  const waterBefore = await countCells(page, Cell.Water, { x0: 0, y0: 0, x1: 1599, y1: 1063 });
  const url = page.url();
  // A reload in the middle of a descent resumes it straight away (the game's own behaviour)...
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.levels.current?.def.id === 'd2' && !window.__game.ctx.levels.transitioning, null, { timeout: 60000 });
  await sleep(1500);
  const auto = await snap(page);
  check('a reload resumes the descent with them in force (state, run and the tuning clone)', JSON.stringify(auto.mutators) === JSON.stringify(['wet-floors', 'gas-leak', 'hush']) && JSON.stringify(auto.runMutators) === JSON.stringify(['wet-floors', 'gas-leak', 'hush']) && auto.wood < 0.07, JSON.stringify(auto));
  // ...and a fresh tab (nothing in session storage) finds the title with Continue on it.
  const ctxb = page.context();
  await page.close();
  page = await ctxb.newPage();
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 60000 });
  await sleep(900);
  await page.locator('#expedition-entry [data-entry="continue"]').click();
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.levels.current?.def.id === 'd2' && !window.__game.ctx.levels.transitioning, null, { timeout: 60000 });
  await sleep(1500);
  const after = await snap(page);
  check('Continue from the title resumes with them in force too', JSON.stringify(after.mutators) === JSON.stringify(['wet-floors', 'gas-leak', 'hush']) && after.wood < 0.07, JSON.stringify(after));
  const planAfter = await planOf(page);
  check('the floor\'s vents come back exactly: derived from the same seed and pristine cells', JSON.stringify(planAfter.vents.map((v) => [v.kind, v.x, v.y])) === JSON.stringify(before.vents.map((v) => [v.kind, v.x, v.y])), `${planAfter.vents.length} vs ${before.vents.length}`);
  const waterAfter = await countCells(page, Cell.Water, { x0: 0, y0: 0, x1: 1599, y1: 1063 });
  check('and the puddles came back with the floor\'s cells, not planned twice', Math.abs(waterAfter - waterBefore) <= Math.max(20, waterBefore * 0.05), `${waterBefore} -> ${waterAfter}`);
  await page.screenshot({ path: `${outDir}/resumed.png` });
  await page.context().close();
}

/* ============================== the daily ============================== */
async function sectionDaily() {
  console.log('\n# The daily: the date\'s complications, never the player\'s');
  // 2026-10-03 is entry 2 of the rotation: Low Gravity and Crowded House.
  const fixed = Date.UTC(2026, 9, 3, 12);
  let page = await openTitle({ fixedDate: fixed });
  const note = await page.evaluate(() => document.querySelector('[data-entry-note="daily"]')?.textContent ?? '');
  check('the title\'s daily note names the date\'s complications', /2026-10-03/.test(note) && /Low Gravity and Crowded House/.test(note), note);
  await chooseOnTitle(page, ['glass-cannon', 'hush']);
  const todayLine = await page.evaluate(() => document.querySelector('#expedition-entry .comp-today')?.textContent ?? '');
  check('and the fold says today\'s ignore the choice', /Low Gravity and Crowded House, set by the date/.test(todayLine), todayLine);
  await page.locator('#expedition-entry [data-entry="daily"]').click();
  await waitForOpeningEnd(page);
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active, null, { timeout: 40000 });
  await sleep(800);
  const s = await snap(page);
  check('the daily run carries the date\'s complications, and not the chosen ones', JSON.stringify(s.mutators) === JSON.stringify(['low-gravity', 'crowded-house']), JSON.stringify(s));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('alchemists-descent-meta') ?? '{}').lastMutators);
  check('the daily did not disturb the remembered choice', JSON.stringify(stored) === JSON.stringify(['glass-cannon', 'hush']), JSON.stringify(stored));
  await page.evaluate(() => { const c = window.__game.ctx; c.run.abandon(c); });
  await page.locator('#run-summary:not([hidden])').waitFor({ state: 'visible', timeout: 10000 });
  await sleep(700);
  const led = await page.evaluate(() => ({ kicker: document.querySelector('#run-summary .rs-kicker')?.textContent ?? '', share: document.querySelector('#run-summary .rs-share')?.textContent ?? '', chips: [...document.querySelectorAll('#run-summary .rs-comp-chip')].map((c) => c.textContent) }));
  check('the daily\'s ledger and share line name them', /Daily descent 2026-10-03/.test(led.kicker) && /daily 2026-10-03 — Low Gravity \+ Crowded House — /.test(led.share) && led.chips.length === 2, JSON.stringify(led));
  await page.context().close();
  // Before the first era a daily is plain.
  page = await openTitle({ fixedDate: Date.UTC(2026, 8, 30, 12) });
  const earlier = await page.evaluate(() => document.querySelector('[data-entry-note="daily"]')?.textContent ?? '');
  check('a date before the table\'s first era carries none', /2026-09-30/.test(earlier) && !/Wet Floors|Tinderbox|Gravity|House/.test(earlier), earlier);
  await page.context().close();
}

/* ============================== the Sanctum's bargain ============================== */
async function openSanctum(page) {
  await page.evaluate(() => {
    const c = window.__game.ctx;
    c.state.paused = false;
    window.__descendedTo = null;
    c.sanctum.open(c, (id) => { window.__descendedTo = id; });
  });
  await page.locator('#sanctum-overlay.visible').waitFor({ state: 'visible', timeout: 10000 });
  await sleep(500);
}
const sanctumState = (page) => page.evaluate(() => {
  const c = window.__game.ctx;
  const row = document.querySelector('#sanctum-overlay .sanc-bargain');
  const cards = [...document.querySelectorAll('#perk-row .perk-card')].map((k) => ({ taken: k.classList.contains('taken'), disabled: k.disabled, faded: k.classList.contains('faded') }));
  const descend = document.getElementById('descend-btn');
  return {
    row: row && !row.hidden ? { name: row.querySelector('.bargain-name b')?.textContent, text: row.querySelector('.bargain-body')?.textContent, deal: row.querySelector('.bargain-deal')?.textContent, status: row.querySelector('.bargain-status')?.textContent, struck: row.classList.contains('struck'), button: row.querySelector('.bargain-accept')?.textContent, buttonDisabled: row.querySelector('.bargain-accept')?.disabled } : null,
    hint: document.querySelector('#sanctum-overlay .sanc-heading span')?.textContent,
    cards,
    descend: { disabled: descend.disabled, text: descend.textContent },
    mutators: [...c.run.mutators],
    state: c.state.mutators ?? null,
    bargains: c.run.bargains.map((b) => ({ ...b })),
    boons: c.run.snapshotForSave()?.boons ?? [],
    maxHp: c.player.maxHp,
    tainted: c.state.debugTainted === true || c.state.debugGodMode === true,
    descendedTo: window.__descendedTo,
  };
});
async function sectionBargain() {
  console.log("\n# The Sanctum's bargain: a complication for a second boon (real clicks)");
  // A: declined, the Sanctum is exactly what it was (one boon, the rest shut).
  let page = await startRun([]);
  await openSanctum(page);
  const a0 = await sanctumState(page);
  check('a real run is offered a bargain at the Sanctum: a complication, its regulation, and what it pays', !!a0.row && a0.row.name && a0.row.text && /second boon/.test(a0.row.deal), JSON.stringify(a0.row));
  check('it is offered with nothing yet in force, untainted', a0.mutators.length === 0 && a0.state === null && a0.tainted === false && a0.hint === 'Take one before you descend', JSON.stringify({ m: a0.mutators, t: a0.tainted, h: a0.hint }));
  await page.screenshot({ path: `${outDir}/sanctum-bargain-offered.png` });
  await page.locator('#perk-row .perk-card').nth(1).click();
  const a1 = await sanctumState(page);
  check('declined, one boon is all there is: it is taken and the others are shut (as ever)', a1.cards.filter((k) => k.taken).length === 1 && a1.cards.filter((k) => k.disabled).length === 3, JSON.stringify(a1.cards));
  check('and nothing was put in force', a1.mutators.length === 0 && a1.bargains.length === 0, JSON.stringify(a1));
  await page.context().close();

  // B: accepted before the first boon: two of the three, the regulation in force, the run saved with it.
  page = await startRun([]);
  await openSanctum(page);
  const b0 = await sanctumState(page);
  await page.locator('#sanctum-overlay .bargain-accept').click();
  const b1 = await sanctumState(page);
  check('striking it puts the complication in force at once, for the run (state, run and the bargain record)', b1.mutators.length === 1 && JSON.stringify(b1.state) === JSON.stringify(b1.mutators) && b1.bargains.length === 1 && b1.bargains[0].floor === 1 && b1.bargains[0].id === b1.mutators[0], JSON.stringify({ m: b1.mutators, b: b1.bargains }));
  check('the row says so, the button goes quiet, and the table now says to take two', b1.row?.struck === true && /^Struck\./.test(b1.row.status ?? '') && b1.row.buttonDisabled === true && b1.hint === 'Take two before you descend', JSON.stringify({ r: b1.row, h: b1.hint }));
  check('the descent stays a real run: not tainted', b1.tainted === false, String(b1.tainted));
  check('the offered name was the one struck', (b0.row?.name ?? '') === (MUTATOR_NAME_OF[b1.mutators[0]] ?? b1.mutators[0]), `${b0.row?.name} vs ${b1.mutators[0]}`);
  if (b1.mutators[0] === 'glass-cannon') check('Glass Cannon takes the health with it', b1.maxHp === Math.round(b0.maxHp * 0.5), `${b0.maxHp} -> ${b1.maxHp}`);
  else check('(a bargain that leaves the HP dial alone leaves the health alone)', b1.maxHp === b0.maxHp, `${b0.maxHp} -> ${b1.maxHp}`);
  await page.screenshot({ path: `${outDir}/sanctum-bargain-struck.png` });
  await page.locator('#perk-row .perk-card').nth(0).click();
  const b2 = await sanctumState(page);
  check('the first boon leaves the rest open: one more is owed, and the descent waits for it', b2.cards[0].taken && !b2.cards[1].disabled && !b2.cards[2].disabled && b2.descend.disabled === true, JSON.stringify({ c: b2.cards, d: b2.descend }));
  await page.locator('#perk-row .perk-card').nth(2).click();
  const b3 = await sanctumState(page);
  check('the second is taken, and the third is shut: two boons struck from the three', b3.cards[0].taken && b3.cards[2].taken && b3.cards[1].disabled && b3.cards[1].faded, JSON.stringify({ c: b3.cards }));
  const twoDoors = (await page.locator('#sanctum-overlay .sanc-door').count()) > 0;
  if (twoDoors) await page.locator('#sanctum-overlay .sanc-door').first().click();
  const b4 = await sanctumState(page);
  check('and with a door chosen the descent is open', b4.descend.disabled === false && /^Descend/.test(b4.descend.text), JSON.stringify(b4.descend));
  await page.screenshot({ path: `${outDir}/sanctum-bargain-two-boons.png` });
  // Persisted: saved, reloaded, resumed with the bargain in force.
  const saved = await page.evaluate(async () => {
    const c = window.__game.ctx;
    c.levels.saveExpedition(c);
    for (let k = 0; k < 60 && !c.levels.hasSavedExpedition(); k++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 800));
    const save = c.run.snapshotForSave();
    return { has: c.levels.hasSavedExpedition(), mutators: save?.mutators ?? null, bargains: save?.bargains ?? null };
  });
  check('the run saves with the bargain on it', saved.has && saved.mutators?.length === 1 && saved.bargains?.length === 1, JSON.stringify(saved));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active && !window.__game.ctx.levels.transitioning, null, { timeout: 60000 });
  await sleep(1200);
  const resumed = await page.evaluate(() => { const c = window.__game.ctx; return { mutators: [...c.run.mutators], bargains: c.run.bargains.map((b) => ({ ...b })), state: c.state.mutators ?? null, boons: c.run.snapshotForSave()?.boons ?? [] }; });
  check('a reload resumes the descent with the bargain still struck and in force', JSON.stringify(resumed.mutators) === JSON.stringify(b1.mutators) && resumed.bargains.length === 1 && JSON.stringify(resumed.state) === JSON.stringify(b1.mutators), JSON.stringify(resumed));
  // The ledger carries it like any complication.
  await page.evaluate(() => { const c = window.__game.ctx; c.events.emit('runComplete', { gold: 0 }); });
  await page.locator('#run-summary:not([hidden])').waitFor({ state: 'visible', timeout: 20000 });
  await sleep(1200);
  const led = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#run-summary .rs-comp-chip')].map((n) => n.textContent), share: document.querySelector('#run-summary .rs-share')?.textContent ?? '' }));
  check('the ledger and the share line name the bargained complication', led.chips.length === 1 && led.share.includes(led.chips[0]), JSON.stringify(led));
  await page.context().close();

  // C: the daily is never bargained over (one descent for everyone); the row is simply not there.
  page = await openTitle({ fixedDate: Date.UTC(2026, 9, 3, 12) });
  await page.locator('#expedition-entry [data-entry="daily"]').click();
  await waitForOpeningEnd(page);
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active, null, { timeout: 40000 });
  await sleep(800);
  await openSanctum(page);
  const d0 = await sanctumState(page);
  check('on the daily there is no bargain row, and the date\'s complications are all it carries', d0.row === null && JSON.stringify(d0.mutators) === JSON.stringify(['low-gravity', 'crowded-house']), JSON.stringify({ r: d0.row, m: d0.mutators }));
  await page.context().close();

  // D: the row fits on short windows: with a real run the boon cards and the row are both in the body's view once the
  // Sanctum has revealed them (the boons are the promise; the row sits right under them), and a click lands on the button.
  for (const [w, h] of [[960, 600], [1024, 640], [800, 600], [1280, 720]]) {
    page = await openTitle({ viewport: { width: w, height: h } });
    await begin(page, { seed: SEED });
    await openSanctum(page);
    await sleep(1800);
    const fit = await page.evaluate(() => {
      const body = document.querySelector('#sanctum-overlay .sanc-body');
      const row = document.querySelector('#sanctum-overlay .sanc-bargain');
      const btn = row?.querySelector('.bargain-accept');
      const b = body.getBoundingClientRect();
      const cards = [...document.querySelectorAll('#perk-row .perk-card')].map((c) => c.getBoundingClientRect());
      const cardsIn = cards.length > 0 && cards.every((r) => r.top >= b.top - 1 && r.bottom <= b.bottom + 1);
      btn?.scrollIntoView({ block: 'nearest' });
      const r = btn?.getBoundingClientRect();
      const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return { shown: !!row && !row.hidden, cardsIn, inView: !!r && r.top >= b.top - 1 && r.bottom <= b.bottom + 1, hit: hit === btn || !!btn?.contains(hit) };
    });
    check(`${w}x${h}: the boon cards are in view, and the bargain button can be reached and a click lands on it`, fit.shown && fit.cardsIn && fit.inView && fit.hit, JSON.stringify(fit));
    if (w === 960) await page.screenshot({ path: `${outDir}/sanctum-bargain-960x600.png` });
    await page.context().close();
  }
}

try {
  if (wants('title')) await sectionTitle();
  if (wants('leak')) await sectionLeak();
  if (wants('gravity')) await sectionGravity();
  if (wants('glass')) await sectionGlass();
  if (wants('crowded')) await sectionCrowded();
  if (wants('light')) await sectionLight();
  if (wants('famine')) await sectionFamine();
  if (wants('fireworks')) await sectionFireworks();
  if (wants('hush')) await sectionHush();
  if (wants('fuel')) await sectionFuel();
  if (wants('wet')) await sectionWet();
  if (wants('slime')) await sectionSlime();
  if (wants('gas')) await sectionGas();
  if (wants('ledger')) await sectionLedger();
  if (wants('resume')) await sectionResume();
  if (wants('daily')) await sectionDaily();
  if (wants('bargain')) await sectionBargain();
} catch (error) {
  fail++;
  console.log('  FAIL  probe crashed: ' + (error && error.stack ? error.stack : error));
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);

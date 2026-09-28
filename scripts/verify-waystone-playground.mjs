// Runtime probe for the playground waystone forge (Z7 in physicsArena.ts) and the
// proximity equip-prompt. Confirms: the checkpoint + its coal/lava/oil terrain are
// placed; the prompt offers a fire card you own (and equips it on the active wand);
// the prompt explains the by-hand paths when you own none; and the waystone actually
// LIGHTS from fire in its bowl — which only works because updateWaystones tolerates a
// waystone pushed after enterLevel sized the heat array.
// Usage: node scripts/verify-waystone-playground.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.levels, { timeout: 20000 });

// ---- enter the physics-test playground ----
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.levels.startRun(ctx, {
    mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh',
  });
});
await page.waitForFunction(
  () => window.__game.ctx.levels.current?.def.id === 'physics-test'
    && window.__game.ctx.levels.current.waystones.length === 1,
  { timeout: 20000 },
);
// Let the level-curtain transition settle: Levels.update early-returns while
// `_transitioning` is set, and that flag clears on a timer the synchronous probe
// evaluates can't advance. Real-time wait lets the rAF loop + timers finish it.
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });

// ---- A. placement + terrain ----------------------------------------------
const placed = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const ws = ctx.levels.current.waystones[0];
  const at = (x, y) => w.types[w.idx(x, y)];
  let coal = 0;
  for (let x = ws.x - 2; x <= ws.x + 2; x++) if (at(x, ws.y - 1) === 28) coal++;
  let lava = 0;
  for (let x = 358; x <= 366; x++) for (let y = 696; y <= 698; y++) if (at(x, y) === 11) lava++;
  let oil = 0;
  for (let x = 377; x <= 383; x++) for (let y = 696; y <= 698; y++) if (at(x, y) === 6) oil++;
  return { x: ws.x, y: ws.y, lit: ws.lit, coal, lava, oil };
});
check('one waystone placed at the forge (340,700), unlit', placed.x === 340 && placed.y === 700 && placed.lit === false, JSON.stringify(placed));
check('coal bed laid in the bowl', placed.coal === 5, JSON.stringify(placed));
check('lava tub filled (siphon source)', placed.lava >= 24, JSON.stringify(placed));
check('oil tub filled (wick source)', placed.oil >= 18, JSON.stringify(placed));

// ---- B. walking up with a fire card you own: a teach card, never a pause ----
// (The old modal paused the game on every approach; game/waystoneHelp.)
const offer = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const W = ctx.wands;
  const a = W.active;
  // deterministic: active wand empty, 'flame' owned in the satchel only
  for (let s = 0; s < W.wands[a].cards.length; s++) if (W.wands[a].cards[s] !== null) W.slotCard(a, s, null);
  for (let wi = 0; wi < 2; wi++) { let i; while ((i = W.wands[wi].cards.indexOf('flame')) >= 0) W.slotCard(wi, i, null); }
  if (!W.collection.includes('flame')) W.grantCard(ctx, 'flame');

  const teaches = [];
  const off = ctx.events.on('hintTeach', (p) => { if (p.key === 'waystone-unlit') teaches.push(p); });
  ctx.player.dead = false; ctx.player.x = 350; ctx.player.y = 699;
  let pausedEver = false;
  for (let f = 0; f < 16; f++) { window.__game.tick(); pausedEver ||= ctx.state.paused; }
  const line = ctx.hints?.current?.line ?? '';
  off();
  return { teaches: teaches.length, body: teaches[0]?.body ?? '', pausedEver, line, modal: !!document.getElementById('waystone-prompt-overlay') };
});
check('approaching with an owned fire card teaches once (a card, not a modal)', offer.teaches === 1 && !offer.modal, JSON.stringify(offer));
check('the teach card names the owned card and the bench', /Flame/.test(offer.body) && /bench \(B\)/.test(offer.body), JSON.stringify(offer));
check('the game never pauses on approach', !offer.pausedEver, JSON.stringify(offer));
check('the hint line says it too, while he stands there', /waystone/i.test(offer.line), JSON.stringify(offer));

// ---- C. once per waystone per floor; with no fire card the line explains the by-hand paths ----
const noCard = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const W = ctx.wands;
  const strip = (id) => {
    for (let wi = 0; wi < 2; wi++) { let i; while ((i = W.wands[wi].cards.indexOf(id)) >= 0) W.slotCard(wi, i, null); }
    for (let i = W.collection.length - 1; i >= 0; i--) if (W.collection[i] === id) W.collection.splice(i, 1);
  };
  ['flame', 'emberstorm', 'meteor'].forEach(strip);

  // step away, then walk back: the same waystone does not teach again this floor
  ctx.player.x = 120; ctx.player.y = 699;
  for (let f = 0; f < 8; f++) window.__game.tick();
  const teaches = [];
  const off = ctx.events.on('hintTeach', (p) => { if (p.key === 'waystone-unlit') teaches.push(p); });
  ctx.player.x = 350; ctx.player.y = 699;
  for (let f = 0; f < 16; f++) window.__game.tick();
  off();
  const line = ctx.hints?.current?.line ?? '';
  return { teaches: teaches.length, line, paused: ctx.state.paused };
});
check('the same waystone does not teach twice on a floor', noCard.teaches === 0, JSON.stringify(noCard));
check('no owned fire card -> the hint line says it wants lasting fire', /lasts/i.test(noCard.line), JSON.stringify(noCard));
check('still never paused', !noCard.paused, JSON.stringify(noCard));

// ---- D. carried LAVA pooled in the bowl lights it (the no-fire-spell path) --
//     also exercises the heat-array guard: a waystone pushed after enterLevel
//     sized the heat array must still accumulate, not go NaN.
const lit = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const ws = ctx.levels.current.waystones[0];
  // stand clear so the bowl heat can't cook the player (a dead player would
  // early-return Levels.update and stall the lighting checks)
  ctx.player.dead = false; ctx.player.x = 120; ctx.player.y = 699;
  // a single modest splash of lava into the bowl — as if poured from the flask
  for (let dx = -1; dx <= 1; dx++) { const i = w.idx(ws.x + dx, ws.y - 2); w.types[i] = 11; w.life[i] = 0; w.colors[i] = 0xff5522; }
  for (let f = 0; f < 200 && !ws.lit; f++) window.__game.tick();
  let ember = 0;
  for (let dy = -2; dy <= -1; dy++) for (let dx = -2; dx <= 2; dx++) if (w.types[w.idx(ws.x + dx, ws.y + dy)] === 20) ember++; // Cell.Ember
  const rp = ctx.levels.respawnPoint();
  return { lit: ws.lit, ember, rp };
});
check('carried lava in the bowl lights the waystone (no fire spell needed)', lit.lit === true, JSON.stringify(lit));
check('lit bowl is seeded with self-glowing embers', lit.ember > 0, JSON.stringify(lit));
check('respawn anchor moves to the lit waystone', lit.rp && lit.rp.x === 340 && lit.rp.y === 698, JSON.stringify(lit));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nwaystone playground probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

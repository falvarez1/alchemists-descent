// The levels review's runtime slice, played in the real game (2026-09-30): route-aware
// population, the fuller Kiln roster, the key lure and the exit portal's wake-up, the
// waypoint arrow keeping off the HUD, and the guardian heard-flag / unseen map marker.
// Usage: node scripts/verify-levels-runtime.mjs [url]  (dev server running)
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !isBenignDevConsoleError(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.dismiss().catch(() => undefined));

async function start(level, seed) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await startConsoleTestRun(page, { seed, level, settleMs: 600 });
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await page.evaluate(() => { const p = window.__game.ctx.player; p.hp = p.maxHp = 9999; p.invuln = 99999; });
}

/** Stand the alchemist at the open spot nearest (x, y), camera snapped. */
const stand = (x, y) => page.evaluate(({ x, y }) => {
  const ctx = window.__game.ctx; const p = ctx.player;
  for (let r = 0; r <= 90; r += 3) for (let a = 0; a < 360; a += 20) {
    const px = Math.round(x + Math.cos((a * Math.PI) / 180) * r), py = Math.round(y + Math.sin((a * Math.PI) / 180) * r);
    if (ctx.physics.entityFree(px, py, 5, 24)) { p.x = px; p.y = py; p.vx = 0; p.vy = 0; ctx.camera.snapTo(px, py); return { x: px, y: py }; }
  }
  return null;
}, { x, y });

/** Population report read from the live runtime: how many non-roost foes stand within 100 cells of the game's own route. */
const populationNearRoute = () => page.evaluate(() => {
  const ctx = window.__game.ctx; const rt = ctx.levels.current; const pop = rt.population;
  const pts = pop?.route?.points ?? [];
  const boss = new Set(['colossus', 'leviathan', 'rimewarden', 'lenswright']);
  const foes = ctx.enemies.filter((e) => !boss.has(e.kind) && e.kind !== 'bat');
  const near = foes.filter((e) => pts.some((p) => Math.hypot(p[0] - e.x, p[1] - e.y) < 100)).length;
  return { routed: pop?.routed ?? 0, planned: pop?.planned ?? {}, length: pop?.route?.length ?? 0, points: pts.length, foes: foes.length, near };
});

console.log('population');
for (const [level, seed, minRouted] of [['d2', 7, 4], ['d3', 7, 4], ['d4', 7, 6]]) {
  await start(level, seed);
  const r = await populationNearRoute();
  check(`${level} s${seed}: a route was traced (${r.length} cells, ${r.points} samples)`, r.length > 300 && r.points > 20);
  check(`${level} s${seed}: ${r.routed} foes hold the route (>= ${minRouted})`, r.routed >= minRouted, JSON.stringify(r));
  check(`${level} s${seed}: ${r.near}/${r.foes} non-roost foes within 100 cells of it (>= 40%)`, r.foes > 0 && r.near / r.foes >= 0.4, JSON.stringify(r));
  if (level === 'd4') {
    check('d4 roster is the fuller Kiln (imp>=5, bomber>=4, golem>=2, stonemaw>=2 at Adept)',
      (r.planned.imp ?? 0) >= 5 && (r.planned.bomber ?? 0) >= 4 && (r.planned.golem ?? 0) >= 2 && (r.planned.stonemaw ?? 0) >= 2, JSON.stringify(r.planned));
  }
}

console.log('key lure and the exit portal (d2 seed 7)');
await start('d2', 7);
const info = await page.evaluate(() => { const rt = window.__game.ctx.levels.current; const key = rt.pickups.find((p) => p.kind === 'key'); return { portal: rt.portal, key: { x: key.x, y: key.y } }; });
await page.evaluate(() => {
  const ctx = window.__game.ctx; window.__sfx = [];
  const orig = ctx.audio.sfx.bind(ctx.audio);
  ctx.audio.sfx = (id, x, y, o) => { window.__sfx.push({ id, x, y, f: ctx.state.frameCount }); return orig(id, x, y, o); };
});
await stand(info.key.x - 130, info.key.y + 20);
await page.waitForTimeout(11000);
const chimes = await page.evaluate(() => window.__sfx.filter((s) => s.id === 'light.bloom.petal'));
check(`the key rings from where it lies while the alchemist is 130 cells off (${chimes.length} chimes in 11 s)`,
  chimes.length >= 1 && chimes.every((c) => Math.abs(c.x - info.key.x) < 2 && Math.abs(c.y - info.key.y) < 2));
const before = await page.evaluate(() => window.__game.ctx.levels.current.mapWaypoint);
check('no waypoint before the key is taken', before === null, JSON.stringify(before));
// Take the key the real way: stand on it.
await page.evaluate(({ x, y }) => { const c = window.__game.ctx; const p = c.player; p.x = x; p.y = y; p.vx = 0; p.vy = 0; c.camera.snapTo(x, y); }, info.key);
await page.waitForFunction(() => window.__game.ctx.levels.current.keyTaken, null, { timeout: 15000 }).catch(() => undefined);
const took = await page.evaluate(() => { const rt = window.__game.ctx.levels.current; return { keyTaken: rt.keyTaken, frame: rt.keyTakenFrame, wp: rt.mapWaypoint, sfx: window.__sfx.filter((s) => s.id === 'mech.shrine') }; });
check('taking the key stamps keyTakenFrame', took.keyTaken && typeof took.frame === 'number', JSON.stringify(took));
check('the compass now points at the exit portal', took.wp?.label === 'Exit Portal' && took.wp.x === info.portal.x && took.wp.y === info.portal.y, JSON.stringify(took.wp));
check('the portal answers with a chime placed at it', took.sfx.length === 1 && took.sfx[0].x === info.portal.x, JSON.stringify(took.sfx));
// A waypoint the player set by hand is never taken over.
await page.evaluate(() => { window.__game.ctx.levels.current.mapWaypoint = { x: 10, y: 20, label: 'Waypoint' }; window.__game.ctx.levels.current.keyTaken = false; });
const held = await page.evaluate(async () => { const c = window.__game.ctx; const rt = c.levels.current; const key = rt.pickups.find((p) => p.kind === 'key'); key.taken = false; const p = c.player; p.x = key.x; p.y = key.y; p.vx = 0; p.vy = 0; await new Promise((r) => setTimeout(r, 1500)); return rt.mapWaypoint; });
check('a hand-set waypoint is left alone when the key is taken', held?.label === 'Waypoint', JSON.stringify(held));

console.log('the waypoint arrow keeps off the HUD (d2 seed 7)');
await start('d2', 7); // fresh: no card-offer modal, nothing paused
await page.waitForTimeout(1500);
const rects = async () => page.evaluate(() => {
  const hud = document.getElementById('game-hud').getBoundingClientRect();
  const pct = (el) => { const r = el.getBoundingClientRect(); return { x0: ((r.left - hud.left) / hud.width) * 100, y0: ((r.top - hud.top) / hud.height) * 100, x1: ((r.right - hud.left) / hud.width) * 100, y1: ((r.bottom - hud.top) / hud.height) * 100 }; };
  const ind = document.getElementById('waypoint-indicator').getBoundingClientRect();
  const blocks = ['#hud-left', '.wave-readout', '#spell-hotbar'].map((s) => document.querySelector(s)).filter(Boolean).map(pct);
  return { at: { x: ((ind.left + ind.width / 2 - hud.left) / hud.width) * 100, y: ((ind.top + ind.height / 2 - hud.top) / hud.height) * 100 }, blocks };
});
for (const [name, dx, dy] of [['up-left', -700, -500], ['up-right', 700, -500], ['down-left', -700, 500]]) {
  await page.evaluate(({ dx, dy }) => { const c = window.__game.ctx; c.levels.current.mapWaypoint = { x: Math.max(10, Math.min(1590, c.player.x + dx)), y: Math.max(10, Math.min(1050, c.player.y + dy)), label: 'Test' }; }, { dx, dy });
  await page.waitForTimeout(450);
  const { at, blocks } = await rects();
  const shown = await page.evaluate(() => document.getElementById('waypoint-indicator').classList.contains('visible'));
  check(`${name}: the arrow is showing`, shown);
  const inside = blocks.some((b) => at.x > b.x0 && at.x < b.x1 && at.y > b.y0 && at.y < b.y1);
  check(`${name}: the arrow rests at (${at.x.toFixed(0)}%, ${at.y.toFixed(0)}%), clear of the HUD blocks`, !inside, JSON.stringify(blocks));
}

console.log('the guardian is heard, then marked (d4 seed 7)');
await start('d4', 7);
const boss = await page.evaluate(() => window.__game.ctx.levels.current.boss);
const spawnHeard = await page.evaluate(() => window.__game.ctx.levels.current.bossHeard === true);
check('not heard from the arrival (575 cells off)', !spawnHeard);
const noPoi = await page.evaluate(async () => { const { collectMinimapPois } = await import('/src/ui/Minimap.ts'); const c = window.__game.ctx; return collectMinimapPois(c, c.levels.current).some((p) => p.kind === 'boss'); });
check('no boss marker on the chart yet', !noPoi);
await stand(boss.x, boss.y - 330);
await page.waitForFunction(() => window.__game.ctx.levels.current.bossHeard === true, null, { timeout: 15000 }).catch(() => undefined);
const poi = await page.evaluate(async () => { const { collectMinimapPois } = await import('/src/ui/Minimap.ts'); const c = window.__game.ctx; return collectMinimapPois(c, c.levels.current).find((p) => p.kind === 'boss'); });
check('within 420 cells the guardian counts as heard', await page.evaluate(() => window.__game.ctx.levels.current.bossHeard === true));
check('...and the chart marks it faintly (Unseen Guardian, "?")', poi?.id === 'boss-arena-unseen' && poi.glyph === '?', JSON.stringify(poi));

console.log('no page errors');
check('none', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

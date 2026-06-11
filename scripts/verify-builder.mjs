// Builder foundation end-to-end probe: open the overlay, author a level
// (terrain capture + 5 objects), undo/redo, drag-move, save/load, validate,
// playtest-compile, and return with the document intact.
// Usage: node scripts/verify-builder.mjs [url]   (dev server must be running)
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('dialog', (d) => d.accept());
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2500); // worldgen settle

/* ---------- open the Builder ---------- */
console.log('-- open');
await page.click('#mode-builder-btn');
await page.waitForTimeout(300);
let s = await page.evaluate(() => ({
  paused: window.__game.ctx.state.paused,
  mode: window.__game.ctx.state.mode,
  rootVisible: document.getElementById('builder-root')?.style.display !== 'none',
  btnActive: document.getElementById('mode-builder-btn')?.classList.contains('active'),
}));
check('builder opens paused on build mode', s.paused && s.mode === 'build' && s.rootVisible && s.btnActive, JSON.stringify(s));

/* ---------- carve a deterministic test arena & center the camera ---------- */
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const Metal = 13;
  for (let y = 375; y <= 625; y++)
    for (let x = 430; x <= 770; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = Metal; w.colors[i] = 0x7a8a99;
      }
  };
  solid(430, 770, 620, 625); // floor
  solid(430, 436, 375, 625); // left wall
  solid(764, 770, 375, 625); // right wall
  ctx.camera.snapTo(600, 500);
});

/* ---------- place the five object kinds ---------- */
console.log('-- place objects');
const rect = await page.evaluate(() => {
  const r = document.getElementById('builder-overlay').getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
const at = (fx, fy) => ({ x: rect.left + rect.width * fx, y: rect.top + rect.height * fy });
const placements = [
  ['spawn', 0.5, 0.5],
  ['enemy', 0.58, 0.45],
  ['pickup', 0.42, 0.45],
  ['waystone', 0.62, 0.55],
  ['exitPortal', 0.38, 0.55],
];
for (const [kind, fx, fy] of placements) {
  await page.click(`.bp-tool[data-kind="${kind}"]`);
  const p = at(fx, fy);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(80);
}
let markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('five markers placed', markers === 5, `got ${markers}`);

const spawnCount = await page.evaluate(() => document.querySelectorAll('.b-marker.k-spawn').length);
check('exactly one spawn', spawnCount === 1, `got ${spawnCount}`);

/* second spawn placement must MOVE the existing one, not add */
await page.click('.bp-tool[data-kind="spawn"]');
const p2 = at(0.52, 0.5);
await page.mouse.click(p2.x, p2.y);
await page.waitForTimeout(80);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('re-placing spawn moves it (still 5 markers)', markers === 5, `got ${markers}`);

/* ---------- undo / redo ---------- */
console.log('-- undo/redo');
await page.click('#b-undo'); // undo spawn move
await page.click('#b-undo'); // undo portal add
await page.waitForTimeout(80);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('undo removes the portal (4 markers)', markers === 4, `got ${markers}`);
await page.click('#b-redo');
await page.waitForTimeout(80);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('redo restores it (5 markers)', markers === 5, `got ${markers}`);

/* ---------- drag-move the spawn ---------- */
console.log('-- drag');
const readInspector = () =>
  page.evaluate(() => ({
    head: document.querySelector('#builder-inspector .bi-head')?.textContent,
    x: Number(document.querySelector('#builder-inspector input[data-f="x"]')?.value),
  }));
const sp = at(0.5, 0.5);
await page.mouse.move(sp.x, sp.y);
await page.mouse.down();
await page.waitForTimeout(80);
let inspector = await readInspector(); // selection happens at mousedown: original x
check('drag selected the spawn', inspector.head === 'SPAWN', JSON.stringify(inspector));
const origX = inspector.x;
await page.mouse.move(sp.x + 50, sp.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(80);
inspector = await readInspector();
check('drag moved the spawn', Number.isFinite(inspector.x) && inspector.x > origX, `x ${origX} -> ${inspector.x}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(80);
inspector = await readInspector();
check('ctrl+z reverts the drag', inspector.x === origX, `x ${inspector.x}, expected ${origX}`);

/* ---------- portal alwaysOpen param ---------- */
console.log('-- inspector param');
const pp = at(0.38, 0.55);
await page.mouse.click(pp.x, pp.y); // select the portal
await page.waitForTimeout(80);
const portalSelected = await page.evaluate(
  () => document.querySelector('#builder-inspector .bi-head')?.textContent,
);
check('portal selected via click', portalSelected === 'EXITPORTAL', String(portalSelected));
await page.click('#builder-inspector input[data-p="alwaysOpen"]');
await page.waitForTimeout(80);

/* ---------- capture terrain + validate ---------- */
console.log('-- capture/validate');
await page.click('#b-capture');
await page.click('#b-validate');
await page.waitForTimeout(120);
const issues = await page.evaluate(() => {
  const panel = document.getElementById('builder-issues');
  return {
    visible: panel.style.display !== 'none',
    text: panel.textContent ?? '',
    errors: panel.querySelectorAll('.b-issue.error').length,
  };
});
check('validation finds no errors', issues.errors === 0, issues.text.slice(0, 200));

/* ---------- save to library ---------- */
console.log('-- save/load');
await page.fill('#b-doc-name', 'probe-level');
await page.evaluate(() => document.getElementById('b-doc-name').dispatchEvent(new Event('change')));
await page.click('#b-save');
const saved = await page.evaluate(() => {
  const lib = JSON.parse(localStorage.getItem('noita-builder-docs') ?? '{}');
  const docs = Object.values(lib);
  return { count: docs.length, name: docs[0]?.name, objects: docs[0]?.objects?.length, hasWorld: !!docs[0]?.world };
});
check('document saved to library', saved.count === 1 && saved.name === 'probe-level' && saved.objects === 5 && saved.hasWorld, JSON.stringify(saved));

/* ---------- playtest compile ---------- */
console.log('-- playtest');
await page.click('#b-playtest');
await page.waitForTimeout(700);
s = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  return {
    mode: ctx.state.mode,
    paused: ctx.state.paused,
    rootHidden: document.getElementById('builder-root')?.style.display === 'none',
    id: rt?.def?.id,
    spawn: rt?.spawn,
    enemies: ctx.enemies.length,
    pickups: rt?.pickups?.length,
    portal: !!rt?.portal,
    keyTaken: rt?.keyTaken,
    waystones: rt?.waystones?.length,
    playerX: Math.round(ctx.player.x),
    playerY: Math.round(ctx.player.y),
  };
});
check('playtest enters play mode unpaused', s.mode === 'play' && !s.paused && s.rootHidden, JSON.stringify(s));
check('custom runtime compiled', s.id === 'custom', String(s.id));
check('authored enemy spawned', s.enemies === 1, `got ${s.enemies}`);
check('authored pickup attached', s.pickups === 1, `got ${s.pickups}`);
check('portal compiled always-open', s.portal && s.keyTaken === true, JSON.stringify({ portal: s.portal, keyTaken: s.keyTaken }));
check('waystone attached', s.waystones === 1, `got ${s.waystones}`);
check(
  'player dropped in at the authored spawn',
  // The spawn is authored mid-air: x must match, y falls from the spawn to
  // the arena floor (620) and no further.
  Math.abs(s.playerX - s.spawn.x) <= 2 && s.playerY >= s.spawn.y - 2 && s.playerY <= 622,
  JSON.stringify({ player: [s.playerX, s.playerY], spawn: s.spawn }),
);

/* scar the playtest world so the return-restore is observable */
await page.evaluate(() => {
  const w = window.__game.ctx.world;
  for (let y = 450; y <= 470; y++)
    for (let x = 500; x <= 520; x++) w.types[w.idx(x, y)] = 12; // Stone plug
});

/* ---------- return to the Builder ---------- */
console.log('-- return');
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
s = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  return {
    mode: ctx.state.mode,
    paused: ctx.state.paused,
    markers: document.querySelectorAll('.b-marker').length,
    enemies: ctx.enemies.length,
    scar: w.types[w.idx(510, 460)], // 0 if the document terrain was restored
  };
});
check('return restores build mode paused', s.mode === 'build' && s.paused, JSON.stringify(s));
check('document objects intact after playtest', s.markers === 5, `got ${s.markers}`);
check('playtest combat state cleared', s.enemies === 0, `got ${s.enemies}`);
check('playtest scars discarded (terrain re-decoded)', s.scar === 0, `cell ${s.scar}`);

/* ---------- load round-trip ---------- */
await page.click('#b-new');
await page.waitForTimeout(120);
let m = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('NEW clears the document', m === 0, `got ${m}`);
await page.click('#b-load');
await page.waitForTimeout(120);
m = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('LOAD restores the saved document', m === 5, `got ${m}`);

/* ---------- exit ---------- */
await page.click('#b-exit');
await page.waitForTimeout(120);
s = await page.evaluate(() => ({
  paused: window.__game.ctx.state.paused,
  rootHidden: document.getElementById('builder-root')?.style.display === 'none',
}));
check('exit releases the pause', !s.paused && s.rootHidden, JSON.stringify(s));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

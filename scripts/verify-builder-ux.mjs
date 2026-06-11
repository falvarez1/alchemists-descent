// Backlog + sidebar wave probe: two-column filtered Sandbox toolbar, the
// Builder-native left panel (materials/brush/world-gen), drag-to-place,
// snap, group/align, command palette, layers, smooth, polygon/magic regions,
// patrol, hazard emitters, notes, mood ambient, bake-from-playtest, rotate,
// solo lights.
// Usage: node scripts/verify-builder-ux.mjs [url]  (dev server must be running)
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
await page.waitForTimeout(2200);

/* ---------- Sandbox sidebar: two columns + filter ---------- */
console.log('-- sandbox sidebar');
const cols = await page.evaluate(
  () => getComputedStyle(document.getElementById('left-toolbar')).gridTemplateColumns.split(' ').length,
);
check('sidebar lays out in two columns', cols === 2, `got ${cols}`);
await page.fill('#toolbar-filter', 'lava');
await page.waitForTimeout(150);
const filtered = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#left-toolbar .tool-btn')];
  return {
    visible: btns.filter((b) => b.style.display !== 'none').length,
    lavaVisible: btns.some((b) => b.textContent.includes('Lava') && b.style.display !== 'none'),
  };
});
check('filter narrows the tool list to matches', filtered.visible === 1 && filtered.lavaVisible, JSON.stringify(filtered));
await page.fill('#toolbar-filter', '');
await page.waitForTimeout(150);

/* ---------- Builder-native left panel ---------- */
console.log('-- builder panel');
await page.click('#mode-builder-btn');
await page.waitForTimeout(300);
const panel = await page.evaluate(() => ({
  sidebarHidden: getComputedStyle(document.getElementById('left-toolbar')).display === 'none',
  swatches: document.querySelectorAll('.bp-swatch').length,
}));
check('sandbox sidebar yields to the builder', panel.sidebarHidden);
check('material swatches cloned from the toolbar', panel.swatches >= 25, `got ${panel.swatches}`);
await page.evaluate(() => {
  const sw = document.querySelector('.bp-swatch[data-el="11"]'); // lava
  sw.click();
});
let el = await page.evaluate(() => window.__game.ctx.state.currentElement);
check('clicking a swatch arms the material', el === 11, `got ${el}`);
await page.evaluate(() => {
  const r = document.getElementById('bp-brush');
  r.value = '12';
  r.dispatchEvent(new Event('input'));
});
const brush = await page.evaluate(() => window.__game.ctx.state.brushSize);
check('brush slider drives state.brushSize', brush === 12, `got ${brush}`);

/* ---------- arena ---------- */
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
  solid(430, 770, 620, 625);
  solid(430, 436, 375, 625);
  solid(764, 770, 375, 625);
  solid(430, 770, 375, 380);
  ctx.camera.snapTo(600, 500);
});
await page.waitForTimeout(200);

const toClient = async (wx, wy) =>
  page.evaluate(([wx, wy]) => {
    const ctx = window.__game.ctx;
    const r = document.getElementById('builder-overlay').getBoundingClientRect();
    const ux = ((wx - ctx.camera.renderX) / 525 - 0.5) * ctx.camera.zoom + 0.5;
    const uy = ((wy - ctx.camera.renderY) / 357 - 0.5) * ctx.camera.zoom + 0.5;
    return { x: r.left + ux * r.width, y: r.top + uy * r.height };
  }, [wx, wy]);

/* ---------- material swatches: icons, popover, drag-to-paint, layout ---------- */
console.log('-- material swatches');
const swatchInfo = await page.evaluate(() => {
  const pal = document.getElementById('builder-palette');
  return {
    icons: document.querySelectorAll('.bp-swatch canvas').length,
    hOverflow: pal.scrollWidth > pal.clientWidth,
  };
});
check('swatches show real pixel icons', swatchInfo.icons >= 15, `got ${swatchInfo.icons}`);
check('palette has no horizontal overflow', swatchInfo.hOverflow === false, JSON.stringify(swatchInfo));
await page.hover('.bp-swatch[data-el="11"]'); // lava
await page.waitForTimeout(120);
const matPop = await page.evaluate(() => {
  const el = document.getElementById('bp-matpop');
  return {
    visible: el.style.display !== 'none',
    text: el.textContent,
    props: el.querySelectorAll('.bp-pop-prop').length,
  };
});
check('hover popover shows the material name instantly', matPop.visible && matPop.text.includes('Lava'), JSON.stringify({ visible: matPop.visible }));
check('material popover lists the live properties', matPop.props >= 1, `got ${matPop.props}`);
// object buttons get popovers too: pixel preview + behavior note
await page.hover('.bp-tool[data-kind="waystone"]');
await page.waitForTimeout(120);
const objPop = await page.evaluate(() => {
  const el = document.getElementById('bp-matpop');
  return {
    visible: el.style.display !== 'none',
    text: el.textContent,
    hasPreview: !!el.querySelector('canvas'),
  };
});
check('object popover shows a preview image + info', objPop.visible && objPop.text.includes('Waystone') && objPop.hasPreview, JSON.stringify({ v: objPop.visible, p: objPop.hasPreview }));
// arming a material draws an unmissable bounding box on its swatch
await page.evaluate(() => {
  document.querySelector('.bp-swatch[data-el="12"]').click();
});
await page.waitForTimeout(120);
const activeBox = await page.evaluate(() => {
  const sw = document.querySelector('.bp-swatch.active');
  const cs = sw ? getComputedStyle(sw) : null;
  return { el: sw?.dataset.el ?? null, outline: cs?.outlineWidth ?? null };
});
check('armed swatch shows a bounding selection box', activeBox.el === '12' && activeBox.outline === '2px', JSON.stringify(activeBox));

/* ---------- parameter windows (the right inspector yields to the builder) ---------- */
console.log('-- parameter windows');
const rightHidden = await page.evaluate(
  () => getComputedStyle(document.getElementById('right-inspector')).display === 'none',
);
check('sandbox right inspector yields to the builder', rightHidden);
await page.click('#bp-world-btn');
await page.waitForTimeout(120);
const worldPanel = await page.evaluate(() => {
  const panel = document.getElementById('builder-world');
  const rows = [...panel.querySelectorAll('.bw-row')];
  const ambient = rows.find((r) => r.textContent.includes('Ambient Light'));
  const input = ambient?.querySelector('input');
  if (input) {
    input.value = '0.4';
    input.dispatchEvent(new Event('input'));
  }
  return {
    visible: panel.style.display !== 'none',
    rows: rows.length,
    ambient: window.__game.ctx.params.global.ambient,
  };
});
check('WORLD window opens with the global controls', worldPanel.visible && worldPanel.rows >= 4, JSON.stringify(worldPanel));
check('WORLD ambient slider drives the live param', worldPanel.ambient === 0.4, `got ${worldPanel.ambient}`);
await page.evaluate(() => {
  // restore the default so later light checks aren't washed out
  window.__game.ctx.params.global.ambient = 0.18;
});
// arming LAVA AUTO-OPENS its tuning window (no extra click needed)
await page.evaluate(() => {
  document.querySelector('.bp-swatch[data-el="11"]').click();
});
await page.waitForTimeout(150);
const matPanel = await page.evaluate(() => {
  const panel = document.getElementById('builder-matparams');
  const world = document.getElementById('builder-world');
  const title = panel.querySelector('.bw-title')?.textContent ?? '';
  const firstRow = panel.querySelector('.bw-row');
  let tweaked = null;
  if (firstRow) {
    const label = firstRow.querySelector('.bw-label span')?.textContent ?? '';
    const input = firstRow.querySelector('input');
    input.value = String(Number(input.max));
    input.dispatchEvent(new Event('input'));
    const key = Object.keys(window.__game.ctx.params.materials[11]).find(
      (k) => k !== 'name' && window.__game.ctx.params.materials[11][k] === Number(input.max),
    );
    tweaked = { label, key };
  }
  return {
    visible: panel.style.display !== 'none',
    worldClosed: world.style.display === 'none',
    title,
    tweaked,
  };
});
check('MATERIAL window shows the armed material', matPanel.visible && matPanel.title.includes('Config'), JSON.stringify(matPanel));
check('side panels share one slot (world closed)', matPanel.worldClosed);
check('material slider drives the live profile', matPanel.tweaked?.key != null, JSON.stringify(matPanel.tweaked));
await page.click('#bm-close');
await page.waitForTimeout(80);

/* ---------- drag-to-place ---------- */
console.log('-- drag to place');
const btnRect = await page.evaluate(() => {
  const b = document.querySelector('.bp-tool[data-kind="enemy"]');
  b.scrollIntoView({ block: 'center' });
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const dropAt = await toClient(540, 600);
await page.mouse.move(btnRect.x, btnRect.y);
await page.mouse.down();
await page.mouse.move(dropAt.x, dropAt.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
let markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('dragging an object button onto the canvas places it', markers === 1, `got ${markers}`);

/* ---------- snap ---------- */
console.log('-- snap');
await page.click('#bp-snap-btn'); // SNAP 8
await page.click('.bp-tool[data-kind="waystone"]');
const oddSpot = await toClient(563, 611);
await page.mouse.click(oddSpot.x, oddSpot.y);
await page.waitForTimeout(120);
const snapped = await page.evaluate(() => {
  const xi = document.querySelector('#builder-inspector input[data-f="x"]');
  const yi = document.querySelector('#builder-inspector input[data-f="y"]');
  return { x: Number(xi.value), y: Number(yi.value) };
});
check('snap grid quantizes placement to 8 cells', snapped.x % 8 === 0 && snapped.y % 8 === 0, JSON.stringify(snapped));
await page.click('#bp-snap-btn'); // 16
await page.click('#bp-snap-btn'); // OFF

/* ---------- group + align ---------- */
console.log('-- group & align');
await page.click('.bp-tool[data-kind="enemy"]');
let p = await toClient(620, 590);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);
p = await toClient(660, 605);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);
await page.keyboard.press('Escape');
// marquee the two new enemies
let a = await toClient(605, 575);
let b = await toClient(680, 615);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(120);
await page.evaluate(() => {
  document.querySelector('#builder-inspector button[data-align="y"]').click();
});
await page.waitForTimeout(120);
const ys = await page.evaluate(() => {
  // both enemy markers should now share a row with the primary
  const tops = [...document.querySelectorAll('.b-marker.k-enemy.sel')].map((m) => m.style.top);
  return [...new Set(tops)];
});
check('ALIGN Y rows up the selection', ys.length === 1, JSON.stringify(ys));
await page.keyboard.press('Control+g');
await page.waitForTimeout(80);
await page.keyboard.press('Escape'); // deselect
const one = await toClient(620, 590);
await page.mouse.click(one.x, one.y);
await page.waitForTimeout(120);
const groupSel = await page.evaluate(() => document.querySelectorAll('.b-marker.sel').length);
check('clicking one grouped member selects the whole group', groupSel === 2, `got ${groupSel}`);
await page.keyboard.press('Escape');

/* ---------- command palette ---------- */
console.log('-- command palette');
await page.keyboard.press('Control+k');
await page.waitForTimeout(120);
let cmdkOpen = await page.evaluate(() => document.getElementById('builder-cmdk').style.display !== 'none');
check('Ctrl+K opens the command palette', cmdkOpen);
await page.fill('#bp-cmdk-input', 'overlay');
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
const overlayLabel = await page.evaluate(() => document.getElementById('bp-overlay-btn').textContent);
check('palette runs the matched command', overlayLabel.includes('LIGHT'), overlayLabel);

/* zen mode: every panel yields to the canvas */
await page.keyboard.press('Backquote');
await page.waitForTimeout(120);
let zenHidden = await page.evaluate(() => getComputedStyle(document.getElementById('builder-palette')).display === 'none');
check('zen mode hides the side panels', zenHidden);
await page.keyboard.press('Backquote');
await page.waitForTimeout(120);
zenHidden = await page.evaluate(() => getComputedStyle(document.getElementById('builder-palette')).display === 'none');
check('zen toggles back', !zenHidden);
await page.keyboard.press('o');
await page.keyboard.press('o');
await page.keyboard.press('o'); // back to NONE

/* ---------- layers ---------- */
console.log('-- layers');
await page.evaluate(() => {
  document.querySelector('.bp-layer[data-layer="gameplay"] [data-vis]').click();
});
await page.waitForTimeout(120);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('hiding the gameplay layer hides its markers', markers === 0, `got ${markers}`);
await page.evaluate(() => {
  document.querySelector('.bp-layer[data-layer="gameplay"] [data-vis]').click();
});
await page.waitForTimeout(120);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('showing it brings them back', markers === 4, `got ${markers}`);

/* ---------- smooth tool ---------- */
console.log('-- smooth');
await page.evaluate(() => {
  const w = window.__game.ctx.world;
  // a lone spur in open air
  const i = w.idx(500, 500);
  w.types[i] = 3; w.colors[i] = 0x555555;
});
await page.click('.bp-tool[data-tool="smooth"]');
const sp = await toClient(500, 500);
await page.mouse.move(sp.x, sp.y);
await page.mouse.down();
await page.mouse.move(sp.x + 4, sp.y, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(120);
const spur = await page.evaluate(() => window.__game.ctx.world.types[window.__game.ctx.world.idx(500, 500)]);
check('smooth erodes the lone spur', spur === 0, `got ${spur}`);

/* ---------- polygon + magic regions ---------- */
console.log('-- regions');
await page.click('.bp-tool[data-tool="polyRegion"]');
for (const [wx, wy] of [[480, 420], [560, 420], [520, 480]]) {
  const q = await toClient(wx, wy);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(60);
}
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
let target = await page.evaluate(() => document.getElementById('bp-target').textContent);
check('polygon region closes and arms the pass target', target.includes('region'), target);
await page.keyboard.press('Escape'); // clear region
await page.click('.bp-tool[data-tool="regionMagic"]');
const mg = await toClient(600, 500);
await page.mouse.click(mg.x, mg.y);
await page.waitForTimeout(150);
target = await page.evaluate(() => document.getElementById('bp-target').textContent);
check('magic region selects the cavern', target.includes('region'), target);
await page.keyboard.press('Escape'); // tool back
await page.keyboard.press('Escape'); // clear region

/* ---------- author the playtest doc: patrol + emitter + mood + spawn ---------- */
console.log('-- patrol, emitter, mood (one playtest)');
await page.click('#b-new');
await page.waitForTimeout(150);
const placeAt = async (kind, wx, wy) => {
  await page.click(`.bp-tool[data-kind="${kind}"]`);
  const q = await toClient(wx, wy);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(80);
};
await placeAt('spawn', 460, 616);
await placeAt('enemy', 700, 616);
await page.keyboard.press('Escape'); // enemy tool is sticky
// make it a golem with a 2-point patrol
p = await toClient(700, 616);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(100);
await page.evaluate(() => {
  const k = document.querySelector('#builder-inspector select[data-p="kind"]');
  k.value = 'golem';
  k.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(100);
await page.click('#bi-patrol');
for (const [wx, wy] of [[650, 616], [740, 616]]) {
  const q = await toClient(wx, wy);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(60);
}
await page.keyboard.press('Escape');
await placeAt('hazardEmitter', 600, 500);
// mood: deselect, set ambient through the document panel
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const amb = document.querySelector('#bi-mood-ambient');
  amb.value = '0.5';
  amb.dispatchEvent(new Event('change'));
});
const preAmbient = await page.evaluate(() => window.__game.ctx.params.global.ambient);
await page.click('#b-capture');
await page.waitForTimeout(300);
await page.click('#b-playtest');
await page.waitForFunction(
  () => window.__game.ctx.levels.current && !window.__game.ctx.levels.transitioning,
  { timeout: 10000 },
);
await page.waitForTimeout(2400); // ~144 frames: 4+ emitter drips at rate 30
const pt = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  let water = 0;
  for (let y = 495; y < 625; y++) for (let x = 580; x < 620; x++) if (w.types[w.idx(x, y)] === 2) water++;
  const golem = ctx.enemies.find((e) => e.kind === 'golem');
  return {
    ambient: ctx.params.global.ambient,
    water,
    patrol: golem?.patrol?.length ?? 0,
    emitters: ctx.levels.current.emitters?.length ?? 0,
  };
});
check('mood ambient applies in the playtest', pt.ambient === 0.5, `got ${pt.ambient}`);
check('hazard emitter compiled and drips real water', pt.emitters === 1 && pt.water >= 3, JSON.stringify(pt));
check('patrol route compiled onto the golem', pt.patrol === 2, `got ${pt.patrol}`);

/* de-alert: a patroller that loses you beyond notice range calms in ~5s */
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const golem = ctx.enemies.find((e) => e.kind === 'golem');
  golem.alerted = true;
  golem.x = 440; // max separation inside the arena (and inside the sim window)
  ctx.player.x = 750;
  ctx.player.y = 616;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
});
await page.waitForTimeout(5600); // 300 calm frames + margin
const calm = await page.evaluate(() => {
  const golem = window.__game.ctx.enemies.find((e) => e.kind === 'golem');
  return { alerted: golem.alerted, dist: Math.abs(golem.x - window.__game.ctx.player.x) };
});
check('patroller de-alerts after ~5s beyond notice range', calm.alerted === false, JSON.stringify(calm));

/* scar the world, return, bake the scar region */
await page.evaluate(() => {
  const w = window.__game.ctx.world;
  for (let y = 590; y < 600; y++)
    for (let x = 470; x < 480; x++) {
      const i = w.idx(x, y);
      w.types[i] = 13; w.colors[i] = 0x7a8a99; // a metal patch "scar" (static)
    }
});
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
// the de-alert teleport parked the camera right of center - re-center so
// the later region drags and placements land on the canvas, not the panels
await page.evaluate(() => window.__game.ctx.camera.snapTo(600, 500));
await page.waitForTimeout(120);
const ambBack = await page.evaluate(() => window.__game.ctx.params.global.ambient);
check('ambient restored on return from playtest', ambBack === preAmbient, `got ${ambBack} want ${preAmbient}`);
let scarGold = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let n = 0;
  for (let y = 590; y < 600; y++) for (let x = 470; x < 480; x++) if (w.types[w.idx(x, y)] === 13) n++;
  return n;
});
check('playtest scars discarded by default', scarGold === 0, `got ${scarGold}`);
// region over the scar, bake via the command palette
await page.click('.bp-tool[data-tool="region"]');
a = await toClient(465, 585);
b = await toClient(485, 605);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(100);
await page.keyboard.press('Control+k');
await page.fill('#bp-cmdk-input', 'bake');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
scarGold = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let n = 0;
  for (let y = 590; y < 600; y++) for (let x = 470; x < 480; x++) if (w.types[w.idx(x, y)] === 13) n++;
  return n;
});
check('region bake re-applies the playtest scar', scarGold === 100, `got ${scarGold}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(120);
scarGold = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let n = 0;
  for (let y = 590; y < 600; y++) for (let x = 470; x < 480; x++) if (w.types[w.idx(x, y)] === 13) n++;
  return n;
});
check('region bake undoes as one command', scarGold === 0, `got ${scarGold}`);

/* ---------- rotate + note + solo ---------- */
console.log('-- rotate, note, solo');
await placeAt('door', 600, 560);
await page.click('#bi-rotate');
await page.waitForTimeout(120);
const rot = await page.evaluate(() => ({
  w: Number(document.querySelector('#builder-inspector input[data-p="w"]').value),
  h: Number(document.querySelector('#builder-inspector input[data-p="h"]').value),
}));
check('door rotate swaps width/height', rot.w === 13 && rot.h === 3, JSON.stringify(rot));
await placeAt('decor', 520, 480);
await page.evaluate(() => {
  const t = document.querySelector('#builder-inspector input[data-p="text"]');
  t.value = 'boss arena goes here';
  t.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(100);
const noteTitle = await page.evaluate(() => document.querySelector('.b-marker.k-decor')?.title ?? '');
check('note text rides the marker tooltip', noteTitle === 'boss arena goes here', noteTitle);

await page.click('.bp-tool[data-tool="light"]');
p = await toClient(560, 520);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);
p = await toClient(640, 520);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);
await page.keyboard.press('Escape');
await page.click('#bi-solo');
await page.waitForTimeout(200);
const solo = await page.evaluate(() => window.__game.ctx.state.editorLights?.length ?? 0);
check('solo narrows the light preview to one', solo === 1, `got ${solo}`);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

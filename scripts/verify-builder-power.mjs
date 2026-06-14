// Power-editing probe (plan Phase 3): floating selection (X lift, arrow
// nudge, Enter land, single undo), symmetry painting (SYM:X mirrored rect,
// one undo), lasso region (masked target label), the crowns pass writing
// only above solid tops, the inspector ROTATE 90 button, and light MUTE
// (preview feed drops it, the document keeps it).
// Usage: node scripts/verify-builder-power.mjs [url]  (dev server running)
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

/* ---------- builder + arena ---------- */
await page.click('#mode-builder-btn');
await page.waitForTimeout(300);
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('noita-builder-doc:') || key === 'noita-builder-draft') {
      localStorage.removeItem(key);
    }
  }
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
    const VIEW_W = 525, VIEW_H = 357;
    const ux = ((wx - ctx.camera.renderX) / VIEW_W - 0.5) * ctx.camera.zoom + 0.5;
    const uy = ((wy - ctx.camera.renderY) / VIEW_H - 0.5) * ctx.camera.zoom + 0.5;
    return { x: r.left + ux * r.width, y: r.top + uy * r.height };
  }, [wx, wy]);

const dragWorld = async (x0, y0, x1, y1, steps = 4) => {
  const a = await toClient(x0, y0);
  const b = await toClient(x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(120);
};

const countType = (x0, x1, y0, y1, t) =>
  page.evaluate(([x0, x1, y0, y1, t]) => {
    const w = window.__game.ctx.world;
    let n = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (w.types[w.idx(x, y)] === t) n++;
    return n;
  }, [x0, x1, y0, y1, t]);

const statusText = () =>
  page.evaluate(() => document.getElementById('builder-status').textContent);

/* ---------- floating selection: X lift, nudge, Enter, single undo ---------- */
console.log('-- floating selection');
await page.evaluate(() => {
  const w = window.__game.ctx.world;
  for (let y = 500; y < 510; y++)
    for (let x = 480; x < 490; x++) {
      const i = w.idx(x, y);
      w.types[i] = 12; w.colors[i] = 0x8a8a92;
    }
});
await page.click('.bp-tool[data-tool="region"]');
await dragWorld(477, 497, 493, 513);
await page.keyboard.press('x');
await page.waitForTimeout(150);
let st = await statusText();
check('X lifts the region into a float', st.includes('FLOATING'), st);
const holeWhileFloating = await countType(480, 489, 500, 509, 12);
check('lift leaves a hole at the source', holeWhileFloating === 0, `got ${holeWhileFloating}`);
// save must refuse while floating (the gate every mutation path shares)
await page.click('#b-save');
await page.waitForTimeout(120);
st = await statusText();
check('SAVE refused while floating', /floating|land/i.test(st), st);
const savedWhileFloating = await page.evaluate(
  () => Object.keys(localStorage).some((k) => k.startsWith('noita-builder-doc:')),
);
check('nothing captured to storage while floating', savedWhileFloating === false);
// nudge: 4x ArrowRight + Shift+ArrowRight (8) = +12 cells
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const movedStone = await countType(492, 501, 500, 509, 12);
const origStone = await countType(480, 489, 500, 509, 12);
check('Enter lands the block +12 cells right', movedStone === 100, `dest ${movedStone}`);
check('source stays cleared after the land', origStone === 0, `src ${origStone}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
const restoredStone = await countType(480, 489, 500, 509, 12);
const destAfterUndo = await countType(492, 501, 500, 509, 12);
check('ONE undo restores the whole move', restoredStone === 100 && destAfterUndo === 0,
  `src ${restoredStone} dest ${destAfterUndo}`);
await page.keyboard.press('Escape'); // clear region remnants if any

/* ---------- symmetry: SYM:X rect mirrors, one gesture = one undo ---------- */
console.log('-- symmetry');
await page.evaluate(() => {
  window.__game.ctx.state.currentElement = 12;
  window.__game.ctx.state.activeInputMode = 'element';
});
// a region recenters the axis at x=600 (inside the arena)
await page.click('.bp-tool[data-tool="region"]');
await dragWorld(500, 450, 700, 550);
await page.click('#bp-sym-btn'); // OFF -> X
let symLabel = await page.evaluate(() => document.getElementById('bp-sym-btn').textContent);
check('SYM button cycles to X', symLabel.includes('X'), symLabel);
await page.click('.bp-tool[data-tool="rectFill"]');
await dragWorld(520, 470, 530, 480);
// drag endpoints quantize through client pixels — assert the mirror, not
// an exact box size (counting windows pad the intended boxes)
const left = await countType(515, 535, 465, 485, 12);
const right = await countType(665, 685, 465, 485, 12);
check('rect stamps equally on both sides of the axis', left === right && left >= 80, `L ${left} R ${right}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(120);
const leftU = await countType(520, 530, 470, 480, 12);
const rightU = await countType(670, 680, 470, 480, 12);
check('one undo removes BOTH mirrored boxes', leftU === 0 && rightU === 0, `L ${leftU} R ${rightU}`);
for (let i = 0; i < 3; i++) await page.click('#bp-sym-btn'); // X -> y -> quad -> OFF
await page.keyboard.press('Escape'); // rectFill -> select
await page.keyboard.press('Escape'); // clear region
await page.waitForTimeout(100);

/* ---------- lasso region ---------- */
console.log('-- lasso region');
await page.click('.bp-tool[data-tool="lassoRegion"]');
const l0 = await toClient(500, 520);
await page.mouse.move(l0.x, l0.y);
await page.mouse.down();
for (const [wx, wy] of [[560, 520], [560, 560], [500, 560]]) {
  const p = await toClient(wx, wy);
  await page.mouse.move(p.x, p.y, { steps: 6 });
}
await page.mouse.up();
await page.waitForTimeout(150);
st = await statusText();
check('lasso closes into a region', st.includes('LASSO REGION SET'), st);
const target = await page.evaluate(() => document.getElementById('bp-target').textContent);
check('proc target reads the masked cell count', /masked region \(~\d+ cells\)/.test(target), target);
await page.keyboard.press('Escape'); // clear the lasso region
await page.waitForTimeout(100);

/* ---------- crowns pass: armed material above solid tops only ---------- */
console.log('-- crowns pass');
await page.evaluate(() => {
  window.__game.ctx.state.currentElement = 34; // Moss
  window.__game.ctx.state.activeInputMode = 'element';
});
await page.click('.bp-tool[data-tool="region"]');
// include the floor rows: endpoint quantization must not shave off the
// surface row (y=619, the open cells above the metal floor at 620)
await dragWorld(440, 595, 760, 623);
await page.click('#bp-proc-btn');
await page.evaluate(() => {
  const sel = document.getElementById('bp-pass');
  sel.value = 'crowns';
  sel.dispatchEvent(new Event('change'));
  const seed = document.getElementById('bp-seed');
  seed.value = '4242';
});
await page.click('#bp-apply');
await page.waitForTimeout(250);
const crowns = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let moss = 0, onSolid = 0;
  for (let y = 590; y <= 619; y++)
    for (let x = 440; x <= 760; x++) {
      if (w.types[w.idx(x, y)] !== 34) continue;
      moss++;
      const below = w.types[w.idx(x, y + 1)];
      if (below === 13 || below === 3 || below === 12) onSolid++;
    }
  return { moss, onSolid };
});
check('crowns pass wrote moss', crowns.moss > 0, JSON.stringify(crowns));
check('every crown sits on a solid top surface', crowns.moss === crowns.onSolid, JSON.stringify(crowns));
await page.click('#bp-proc-close');
await page.keyboard.press('Control+z'); // retract the pass
await page.keyboard.press('Escape');
await page.keyboard.press('Escape'); // clear region
await page.waitForTimeout(100);

/* ---------- inspector ROTATE 90 on a point kind ---------- */
console.log('-- object rotation');
await page.click('.bp-tool[data-kind="hazardEmitter"]');
let p = await toClient(600, 450);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
const hasRotate = await page.evaluate(() => !!document.querySelector('#bi-rotate-pt'));
check('emitter inspector offers ROTATE 90', hasRotate);
await page.click('#bi-rotate-pt');
await page.waitForTimeout(120);
st = await statusText();
check('rotation status reads the drip direction', st.includes('90') && st.includes('LEFT'), st);
await page.click('#b-save');
await page.waitForTimeout(200);
const savedRotation = await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('noita-builder-doc:')) continue;
    const doc = JSON.parse(localStorage.getItem(k));
    const em = doc.objects.find((o) => o.kind === 'hazardEmitter');
    if (em) return em.rotation;
  }
  return null;
});
check('rotation persists on the document object', savedRotation === 90, `got ${savedRotation}`);

/* ---------- light MUTE: preview feed drops it, document keeps it ---------- */
console.log('-- light mute');
await page.click('.bp-tool[data-tool="light"]');
p = await toClient(560, 480);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(250);
let feed = await page.evaluate(() => window.__game.ctx.state.editorLights?.length ?? -1);
check('placed light feeds the live preview', feed === 1, `got ${feed}`);
await page.keyboard.press('Escape'); // leave the light tool (stays selected)
await page.waitForTimeout(100);
const hasMute = await page.evaluate(() => !!document.querySelector('#bi-mute'));
check('light inspector offers MUTE next to SOLO', hasMute);
await page.click('#bi-mute');
await page.waitForTimeout(250);
feed = await page.evaluate(() => window.__game.ctx.state.editorLights?.length ?? -1);
check('muted light leaves the editorLights feed', feed === 0, `got ${feed}`);
const docLights = await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('noita-builder-doc:')) continue;
    return JSON.parse(localStorage.getItem(k)).lights.length;
  }
  return -1;
});
// the save above predates the light; what matters is the LIVE doc keeps it
const liveLights = await page.evaluate(() => document.querySelectorAll('.b-marker.k-light').length);
check('document still owns the muted light (marker present)', liveLights === 1, `markers ${liveLights}, saved ${docLights}`);

/* ---------- cleanup + verdict ---------- */
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('noita-builder-doc:') || key === 'noita-builder-draft') {
      localStorage.removeItem(key);
    }
  }
});
check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
console.log(`\npower probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

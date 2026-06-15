// Gallery probe: the Builder asset browser presents prefabs, mechanisms,
// entities, and sprites LIVE — animated stages, working state chips, search,
// keyboard nav. Asserts pixels change over time (animation is real), state
// chips change the stage, and every entity kind draws without a preview
// failure. Usage: node scripts/verify-gallery.mjs [url]  (dev server running)
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
const drawWarnings = [];
page.on('console', (msg) => {
  if (msg.text().includes('[gallery] preview draw failed')) drawWarnings.push(msg.text());
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2200);

await page.click('#mode-builder-btn');
await page.waitForTimeout(400);

/* ---------- open ---------- */
await page.click('[data-menu="view"]');
await page.click('#b-gallery');
await page.waitForTimeout(500);
check('gallery opens', await page.isVisible('#builder-gallery'));
const modalRect = await page.evaluate(() => {
  const gallery = document.getElementById('builder-gallery');
  const toggle = document.getElementById('bg-view-toggle');
  const close = document.getElementById('bg-close');
  const r = gallery.getBoundingClientRect();
  const tr = toggle.getBoundingClientRect();
  const cr = close.getBoundingClientRect();
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    max: gallery.classList.contains('maximized'),
    toggleText: toggle.textContent,
    toggleLabel: toggle.getAttribute('aria-label'),
    toggleW: Math.round(tr.width),
    toggleH: Math.round(tr.height),
    closeW: Math.round(cr.width),
    closeH: Math.round(cr.height),
  };
});
check('gallery opens as a smaller modal by default', !modalRect.max && modalRect.w < 1450 && modalRect.h < 870, JSON.stringify(modalRect));
check(
  'gallery view toggle is an icon-sized button',
  modalRect.toggleText === '' &&
    modalRect.toggleLabel === 'Maximize gallery' &&
    modalRect.toggleW === modalRect.closeW &&
    modalRect.toggleH === modalRect.closeH,
  JSON.stringify(modalRect),
);
await page.click('#bg-view-toggle');
await page.waitForTimeout(150);
const maxRect = await page.evaluate(() => {
  const el = document.getElementById('builder-gallery');
  const toggle = document.getElementById('bg-view-toggle');
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), max: el.classList.contains('maximized'), label: toggle.getAttribute('aria-label'), text: toggle.textContent };
});
check('gallery view toggle expands to the Builder workspace', maxRect.max && maxRect.w >= 1490 && maxRect.h >= 840 && maxRect.label === 'Restore gallery' && maxRect.text === '', JSON.stringify(maxRect));
await page.click('#bg-view-toggle');
await page.waitForTimeout(150);
const restoredRect = await page.evaluate(() => {
  const el = document.getElementById('builder-gallery');
  const toggle = document.getElementById('bg-view-toggle');
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), max: el.classList.contains('maximized'), label: toggle.getAttribute('aria-label'), text: toggle.textContent };
});
check(
  'gallery view toggle restores the smaller modal',
  !restoredRect.max &&
    Math.abs(restoredRect.w - modalRect.w) <= 2 &&
    Math.abs(restoredRect.h - modalRect.h) <= 2 &&
    restoredRect.label === 'Maximize gallery' &&
    restoredRect.text === '',
  JSON.stringify({ modalRect, restoredRect }),
);

const sections = await page.$$eval('#builder-gallery .bg-section', (els) => els.map((e) => e.textContent));
check(
  'all four sections present',
  ['MECHANISMS', 'PREFABS', 'ENTITIES', 'SPRITES'].every((s) => sections.includes(s)) ||
    // SPRITES section only exists when sprite assets do; the rest are mandatory
    ['MECHANISMS', 'PREFABS', 'ENTITIES'].every((s) => sections.includes(s)),
  JSON.stringify(sections),
);

const counts = await page.evaluate(() => {
  const items = [...document.querySelectorAll('#builder-gallery .bg-item .bg-meta')].map(
    (e) => e.textContent ?? '',
  );
  return {
    mech: items.filter((t) => t === 'mechanism').length,
    prefab: items.filter((t) => t.includes('builtin') || t.includes('library')).length,
    entity: items.filter((t) => t.startsWith('enemy') || t.startsWith('player')).length,
  };
});
check('13 mechanism items', counts.mech === 13, JSON.stringify(counts));
check('all 7 builtin prefabs listed', counts.prefab >= 7, String(counts.prefab));
check('player + 12 enemies listed', counts.entity === 13, String(counts.entity));

/* ---------- the stage is alive ---------- */
const snap = () =>
  page.evaluate(() => {
    const c = document.querySelector('#bg-stage');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0,
      sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] + d[i + 1] + d[i + 2];
      if (v > 40) lit++;
      sum = (sum + v * ((i >> 2) % 9973)) >>> 0;
    }
    return { lit, sum };
  });

// REAL clicks only: synthetic dispatchEvent bypasses hit-testing and once
// hid a pointer-events:none bug that made every control dead in actual use.
const realClick = async (selector, textOf, want) => {
  const box = await page.evaluate(
    ({ sel, prop, text }) => {
      const el = [...document.querySelectorAll(sel)].find(
        (e) => (prop ? e.querySelector(prop)?.textContent : e.textContent) === text,
      );
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { sel: selector, prop: textOf, text: want },
  );
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(250);
  return true;
};
const selectItem = (name) => realClick('#builder-gallery .bg-item', '.bg-name', name);
const clickChip = (label) => realClick('#builder-gallery .bg-chip', null, label);

const brazierClicked = await selectItem('Brazier');
const selName = await page.evaluate(
  () => document.querySelector('#builder-gallery .bg-item.sel .bg-name')?.textContent,
);
check('REAL mouse clicks land on the modal (pointer-events)', brazierClicked && selName === 'Brazier', String(selName));
const h1 = await page.evaluate(() => document.querySelector('#bg-stage').height);
await page.waitForTimeout(900);
const h2 = await page.evaluate(() => document.querySelector('#bg-stage').height);
check('stage layout is stable (no downward drift)', h1 === h2, `${h1} -> ${h2}`);
await clickChip('LIT');
const a1 = await snap();
await page.waitForTimeout(300);
const a2 = await snap();
await page.waitForTimeout(300);
const a3 = await snap();
check('stage renders pixels', a1.lit > 200, `lit=${a1.lit}`);
check('a lit brazier ANIMATES (frames differ)', a1.sum !== a2.sum || a2.sum !== a3.sum);

/* ---------- state chips drive the real runtime ---------- */
await selectItem('Valve');
const closed = await snap();
await clickChip('OPEN');
await page.waitForTimeout(600); // the slab retracts cell by cell
const opened = await snap();
check('valve OPEN chip changes the stage', closed.sum !== opened.sum);

await selectItem('Counterweight');
await clickChip('TIPPED');
await page.waitForTimeout(600);
const toast = await page.$eval('#bg-caption', (e) => e.textContent ?? '');
check('a tipped counterweight raises its toast in the caption', toast.includes('COUNTERWEIGHT'), toast);

await selectItem('Relay');
await clickChip('FUSE');
const f1 = await snap();
await page.waitForTimeout(300);
const f2 = await snap();
await page.waitForTimeout(300);
const f3 = await snap();
check('relay fuse burns visibly', f1.sum !== f2.sum || f2.sum !== f3.sum);

/* ---------- prefabs: live room with markers ---------- */
await selectItem('Powder Mill');
const pm = await snap();
check('a machine prefab renders its room', pm.lit > 1500, `lit=${pm.lit}`);
await clickChip('MARKERS');
const pmMarked = await snap();
check('MARKERS overlays anchors/footprints', pm.sum !== pmMarked.sum);

/* ---------- entities: every kind draws ---------- */
const entityNames = await page.evaluate(() =>
  [...document.querySelectorAll('#builder-gallery .bg-item')]
    .filter((r) => {
      const m = r.querySelector('.bg-meta')?.textContent ?? '';
      return m.startsWith('enemy') || m.startsWith('player');
    })
    .map((r) => r.querySelector('.bg-name')?.textContent ?? ''),
);
let allDrew = true;
for (const name of entityNames) {
  await selectItem(name);
  const s = await snap();
  if (s.lit < 120) {
    allDrew = false;
    console.log(`        entity stage looked empty for: ${name} (lit=${s.lit})`);
  }
}
check(`all ${entityNames.length} entities render a body`, allDrew);
check('no preview draw failures', drawWarnings.length === 0, drawWarnings.join(' | '));

await selectItem('The Alchemist');
await clickChip('RUN');
const r1 = await snap();
await page.waitForTimeout(300);
const r2 = await snap();
await page.waitForTimeout(300);
const r3 = await snap();
check('the alchemist runs (stride animates)', r1.sum !== r2.sum || r2.sum !== r3.sum);

/* ---------- animation states + cursor gaze ---------- */
const chipsOf = () =>
  page.$$eval('#builder-gallery .bg-chip', (els) => els.map((e) => e.textContent));
await selectItem('Slime');
const slimeChips = await chipsOf();
check('slime carries its HOP state', slimeChips.includes('HOP (loop)'), JSON.stringify(slimeChips));
await clickChip('HOP (loop)');
const hop1 = await snap();
await page.waitForTimeout(400);
const hop2 = await snap();
check('the slime hop loop animates', hop1.sum !== hop2.sum);
await selectItem('Golem');
const golemChips = await chipsOf();
check(
  'golem carries WALK + POUND states',
  golemChips.includes('WALK (loop)') && golemChips.includes('POUND (loop)'),
  JSON.stringify(golemChips),
);
await selectItem('Bomber');
check('bomber carries its FUSING state', (await chipsOf()).includes('FUSING (loop)'));

// alerted gaze: the stage maps the mouse to world cells (dataset readout)
await selectItem('Slime');
await clickChip('ALERTED');
const sb = await page.evaluate(() => {
  const r = document.querySelector('#bg-stage').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(sb.x + sb.w * 0.18, sb.y + sb.h * 0.5);
await page.waitForTimeout(250);
const cwLeft = await page.evaluate(() => document.querySelector('#bg-stage').dataset.cursor);
await page.mouse.move(sb.x + sb.w * 0.85, sb.y + sb.h * 0.5);
await page.waitForTimeout(250);
const cwRight = await page.evaluate(() => document.querySelector('#bg-stage').dataset.cursor);
check(
  'cursor maps to world cells for the alerted gaze',
  Boolean(cwLeft && cwRight) && Number(cwLeft.split(',')[0]) < Number(cwRight.split(',')[0]),
  `${cwLeft} -> ${cwRight}`,
);

/* ---------- search + keyboard + close ---------- */
await page.fill('#bg-search', 'valve');
await page.waitForTimeout(200);
const filtered = await page.$$eval('#builder-gallery .bg-item', (els) => els.length);
check('search filters the catalog', filtered >= 1 && filtered <= 4, String(filtered));
await page.fill('#bg-search', '');
await page.waitForTimeout(200);

await page.keyboard.press('ArrowDown');
await page.waitForTimeout(150);
const selIdx = await page.evaluate(() =>
  [...document.querySelectorAll('#builder-gallery .bg-item')].findIndex((r) => r.classList.contains('sel')),
);
check('arrow keys navigate items', selIdx === 1, String(selIdx));

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('ESC closes the gallery', !(await page.isVisible('#builder-gallery')));
check('builder still up behind it', await page.isVisible('#builder-bar'));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\ngallery probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

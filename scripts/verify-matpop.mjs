// Runtime verification: material popovers (Sandbox toolbar + Builder palette)
// show name, classification, gameplay description, and live tunables on hover.
// Usage: node scripts/verify-matpop.mjs [url]  (dev server must be running)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

/* ---------- Sandbox toolbar popover (#lt-matpop) ---------- */

// Hover with REAL mouse moves: the popover wires mouseenter/mouseleave.
const hoverToolbarMat = async (id) => {
  const btn = page.locator(`.tool-btn[data-mode="element"][data-id="${id}"]`);
  await btn.scrollIntoViewIfNeeded();
  // let the scroll settle: the popover intentionally hides on toolbar scroll
  await page.waitForTimeout(150);
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(120);
};

const popState = (sel) =>
  page.evaluate((s) => {
    const pop = document.querySelector(s);
    if (!pop || pop.style.display === 'none') return null;
    const r = pop.getBoundingClientRect();
    return {
      head: pop.querySelector('.bp-pop-head')?.textContent ?? '',
      tags: pop.querySelector('.bp-pop-tags')?.textContent ?? '',
      desc: pop.querySelector('.bp-pop-desc')?.textContent ?? '',
      props: pop.querySelectorAll('.bp-pop-prop').length,
      onScreen: r.left >= 0 && r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
    };
  }, sel);

await hoverToolbarMat(35); // Aurum Catalyst
let s = await popState('#lt-matpop');
check('toolbar popover appears on hover', !!s, 'popover missing/hidden');
check('catalyst: name', !!s && s.head.includes('Aurum Catalyst'), JSON.stringify(s));
check('catalyst: classification', !!s && s.tags.includes('powder'), JSON.stringify(s));
check('catalyst: description', !!s && s.desc.includes('Gold Powder'), JSON.stringify(s));
check('catalyst: tunable props listed', !!s && s.props >= 3, JSON.stringify(s));
check('catalyst: popover on screen', !!s && s.onScreen, JSON.stringify(s));
await page.screenshot({ path: `${outDir}/matpop-toolbar-catalyst.png` });

await hoverToolbarMat(2); // Water
s = await popState('#lt-matpop');
check('water: liquid tag + conversions', !!s && s.tags.includes('liquid') && s.desc.includes('steam'), JSON.stringify(s));

await hoverToolbarMat(0); // Eraser
s = await popState('#lt-matpop');
check('eraser: described', !!s && s.head.includes('Eraser') && s.desc.includes('Erases'), JSON.stringify(s));

// Cave Moss sits low in the toolbar — exercises scroll + on-screen clamping
await hoverToolbarMat(34);
s = await popState('#lt-matpop');
check('moss (scrolled): visible + clamped on screen', !!s && s.onScreen, JSON.stringify(s));
await page.screenshot({ path: `${outDir}/matpop-toolbar-moss.png` });

await page.mouse.move(700, 450);
await page.waitForTimeout(120);
s = await popState('#lt-matpop');
check('toolbar popover hides on mouse leave', !s, JSON.stringify(s));

/* ---------- Builder palette popover (#bp-matpop) ---------- */

await page.click('#mode-builder-btn');
await page.waitForTimeout(600);

const swatch = page.locator('#bp-materials .bp-swatch[data-el="35"]');
const box = await swatch.boundingBox();
check('builder: catalyst swatch present', !!box);
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(120);
  s = await popState('#bp-matpop');
  check('builder popover appears on hover', !!s, 'popover missing/hidden');
  check(
    'builder catalyst: name + description + props',
    !!s && s.head.includes('Aurum Catalyst') && s.desc.includes('Gold Powder') && s.props >= 3,
    JSON.stringify(s),
  );
  await page.screenshot({ path: `${outDir}/matpop-builder-catalyst.png` });
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

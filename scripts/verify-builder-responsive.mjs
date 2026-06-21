// Builder responsive smoke probe.
// Usage: node scripts/verify-builder-responsive.mjs [url]  (dev server must be running)
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'desktop', width: 1440, height: 900 },
];

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const browser = await launchBrowser();
for (const viewport of viewports) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.click('#mode-builder-btn');
  await page.waitForFunction(
    () => document.body.classList.contains('builder-open') && !!document.getElementById('builder-overlay'),
    { timeout: 15000 },
  );
  await page.waitForTimeout(350);
  await page.click('#b-reset-workspace');
  await page.waitForTimeout(180);

  const result = await page.evaluate(() => {
    const rectOf = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const panels = [...document.querySelectorAll('#builder-root .builder-panel')]
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => ({ id: el.id, rect: rectOf(`#${CSS.escape(el.id)}`) }))
      .filter((item) => item.rect && item.rect.width > 0 && item.rect.height > 0);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      root: rectOf('#builder-root'),
      bar: rectOf('#builder-bar'),
      stage: rectOf('#builder-stage'),
      workspace: rectOf('#builder-workspace-body'),
      docOverflow: document.documentElement.scrollWidth - vw,
      bodyOverflow: document.body.scrollWidth - vw,
      panels,
      offscreenPanels: panels.filter(
        (item) =>
          item.rect.left < -1 ||
          item.rect.top < -1 ||
          item.rect.right > vw + 1 ||
          item.rect.bottom > vh + 1,
      ),
      visibleButtons: [...document.querySelectorAll('#builder-root button')]
        .filter((el) => getComputedStyle(el).display !== 'none' && el.offsetParent !== null)
        .length,
    };
  });

  console.log(`-- ${viewport.name} ${viewport.width}x${viewport.height}`);
  check(`${viewport.name}: no page errors`, errors.length === 0, errors[0] ?? '');
  check(`${viewport.name}: Builder root visible`, result.root?.width > 0 && result.root?.height > 0, JSON.stringify(result.root));
  check(`${viewport.name}: workspace has usable stage`, result.stage?.width >= 160 && result.stage?.height >= 180, JSON.stringify(result.stage));
  check(`${viewport.name}: no horizontal document overflow`, result.docOverflow <= 2 && result.bodyOverflow <= 2, JSON.stringify({ doc: result.docOverflow, body: result.bodyOverflow }));
  check(`${viewport.name}: visible panels stay onscreen`, result.offscreenPanels.length === 0, JSON.stringify(result.offscreenPanels));
  check(`${viewport.name}: toolbar controls remain mounted`, result.visibleButtons >= 12, String(result.visibleButtons));
  await page.close();
}
await browser.close();

console.log(`\nverify-builder-responsive: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

// Smoke test for a DEPLOYED build (Cloudflare Pages), not the dev server.
//
// Every other probe drives `window.__game`, which only exists in DEV. A hosted
// build has none of that, so this checks the game the way a player meets it:
// load the URL cold, start a run, and see pixels move. That difference is the
// whole point — a production build can fail in ways the dev server never does
// (missing asset paths, a chunk that 404s, a DEV-only guard that was load
// bearing), and those failures reach the tester, not us.
//
// It also asserts the build carries NO AuthorLink credentials. Relay origin and
// token are build-time env; a public bundle that happened to have them baked in
// would hand every visitor write access to the tuning room.
//
// Usage: node scripts/verify-hosted-game.mjs <url>
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] || 'https://alchemists-descent.pages.dev';
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
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errs = [];
const failedRequests = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
});

try {
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  check('the page loads', res?.status() === 200, `status ${res?.status()}`);
  check('no failed requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

  // DIRECT child: the toolbar's `px-icon` canvases are descendants of
  // #canvas-holder too, and a descendant selector picks an 11x11 icon that
  // never becomes visible. Cost 45s of timeout the first time.
  await page.waitForSelector('#canvas-holder > canvas', { timeout: 45000 });
  const size = await page.evaluate(() => {
    const c = document.querySelector('#canvas-holder > canvas');
    return { w: c.width, h: c.height };
  });
  check('the renderer mounted the main canvas', size.w > 600 && size.h > 400, JSON.stringify(size));

  // Start a real run through the real UI.
  await page.click('#mode-play-btn');
  await page.waitForSelector('#run-launcher.visible', { timeout: 30000 });
  await page.click('#run-launcher .run-launcher-start');
  await page.waitForFunction(() => document.body.classList.contains('play-active'), null, {
    timeout: 90000,
  });
  check('a run starts', true);

  // Pixels, not state: a hosted build with a broken shader would still reach
  // 'play-active' and show a black rectangle. Read the GL canvas inside a rAF
  // (preserveDrawingBuffer is false, so anywhere else samples a cleared buffer).
  const sample = async () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            const canvas = document.querySelector('#canvas-holder > canvas');
            const off = document.createElement('canvas');
            off.width = 160;
            off.height = 100;
            const g = off.getContext('2d');
            g.drawImage(canvas, 0, 0, off.width, off.height);
            const { data } = g.getImageData(0, 0, off.width, off.height);
            let lit = 0;
            let sum = 0;
            for (let i = 0; i < data.length; i += 4) {
              const v = data[i] + data[i + 1] + data[i + 2];
              sum += v;
              if (v > 90) lit++;
            }
            resolve({ lit, mean: sum / (data.length / 4) });
          });
        }),
    );

  const first = await sample();
  check('the world is drawn, not black', first.lit > 200, JSON.stringify(first));

  await page.keyboard.down('KeyD');
  await new Promise((r) => setTimeout(r, 1200));
  await page.keyboard.up('KeyD');
  const second = await sample();
  check(
    'the frame changes as the wizard moves',
    Math.abs(second.mean - first.mean) > 0.5 || second.lit !== first.lit,
    `${JSON.stringify(first)} -> ${JSON.stringify(second)}`,
  );

  // Credentials must not ship in a public bundle.
  const leaked = await page.evaluate(async () => {
    const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src);
    const bad = [];
    for (const src of scripts) {
      const text = await (await fetch(src)).text();
      if (/workers\.dev/.test(text)) bad.push(`${src}: relay host`);
      if (/AUTHORLINK_TOKEN/.test(text)) bad.push(`${src}: token name`);
    }
    return bad;
  });
  check('no AuthorLink relay host or token in the bundle', leaked.length === 0, leaked.join(' | '));

  // THE BUILDER MUST NOT BE REACHABLE. A playtester given this link should not
  // be able to open the level editor, and "we hid the button" is not
  // separation — check the button, the route, and the chunk independently,
  // because each can come back on its own.
  const authoringUi = await page.evaluate(() => ({
    builderButton: !!document.getElementById('mode-builder-btn'),
    devButtons: document.querySelectorAll('[data-authoring]').length,
    console: !!document.getElementById('dev-console-toggle'),
  }));
  check('no BUILDER button', !authoringUi.builderButton);
  check(
    'no authoring/debug toggles',
    authoringUi.devButtons === 0 && !authoringUi.console,
    JSON.stringify(authoringUi),
  );

  // What matters is that the route does not LOAD THE EDITOR, not what status
  // it carries: static hosts answer unmatched paths in their own way, and
  // Cloudflare Pages serves index.html at 200 unless a 404.html is present.
  // The first version of this check asserted 404 and reported a live editor
  // when the route was in fact serving the game — right alarm, wrong reason.
  const builderRoute = await page.request.get(new URL('/builder.html', url).href);
  const builderBody = await builderRoute.text();
  check(
    'the /builder.html route does not serve the editor',
    !/assets\/(builder|Builder)-/.test(builderBody),
    `status ${builderRoute.status()}, body references a builder entry`,
  );
  check(
    'a stale editor link 404s instead of silently loading the game',
    builderRoute.status() === 404,
    `status ${builderRoute.status()} — add public/404.html so unmatched paths are honest`,
  );

  // The backtick console self-binds a key, so removing its button proves nothing.
  await page.keyboard.press('Backquote');
  await new Promise((r) => setTimeout(r, 400));
  const consoleOpened = await page.evaluate(
    () => !!document.querySelector('#dev-console.open, #dev-console.visible, .console-overlay.open'),
  );
  check('the dev console does not open on backtick', !consoleOpened);

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

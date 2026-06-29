// Focused minimap waypoint probe.
// Usage: node scripts/verify-minimap-waypoint.mjs [url]  (dev server running)
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, startConsoleRun, startConsolePlayRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text());
});
page.on('dialog', (dialog) => dialog.dismiss().catch(() => undefined));

async function waypointClientPoint(target) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.getElementById('minimap-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = (x >> 3) + 0.5;
    const my = (y >> 3) + 0.5;
    return {
      x: rect.left + (mx / canvas.width) * rect.width,
      y: rect.top + (my / canvas.height) * rect.height,
    };
  }, target);
}

async function liveWaypointState() {
  return page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const rt = ctx.levels.current;
    const indicator = document.getElementById('waypoint-indicator');
    const style = indicator ? getComputedStyle(indicator) : null;
    const { collectMinimapPois } = await import('/src/ui/Minimap.ts');
    const pois = rt ? collectMinimapPois(ctx, rt).map((poi) => ({ id: poi.id, title: poi.title, kind: poi.kind })) : [];
    return {
      waypoint: rt?.mapWaypoint ?? null,
      poi: pois.find((poi) => poi.id === 'map-waypoint') ?? null,
      indicatorVisible: !!indicator && indicator.classList.contains('visible') && style?.display !== 'none',
      indicatorLeft: indicator?.style.left ?? '',
      indicatorTop: indicator?.style.top ?? '',
      range: indicator?.querySelector('.waypoint-range')?.textContent ?? '',
      saved: JSON.parse(localStorage.getItem('noita-expedition') ?? 'null')?.levels?.[0]?.mapWaypoint ?? null,
    };
  });
}

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });
await startConsolePlayRun(page, { seed: 2601, settleMs: 400 });

const target = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const canvas = document.getElementById('minimap-corner');
  if (!rt || !(canvas instanceof HTMLCanvasElement)) return null;
  const rawX = Math.max(20, Math.min(rt.world.width - 20, Math.round(ctx.player.x + 520)));
  const rawY = Math.max(20, Math.min(rt.world.height - 20, Math.round(ctx.player.y - 16)));
  const x = (rawX >> 3) * 8 + 4;
  const y = (rawY >> 3) * 8 + 4;
  rt.explored[(x >> 3) + (y >> 3) * canvas.width] = 1;
  return { x, y };
});
check('Probe runtime found an explored waypoint target', !!target, JSON.stringify(target));

await page.keyboard.press('KeyM');
await page.waitForSelector('#minimap-overlay.visible', { timeout: 5000 });
const setPoint = await waypointClientPoint(target);
check('Full map target resolves to a client point', !!setPoint, JSON.stringify(setPoint));
await page.mouse.click(setPoint.x, setPoint.y);
await page.waitForFunction(() => window.__game.ctx.levels.current?.mapWaypoint != null, { timeout: 5000 });
const setState = await liveWaypointState();
check(
  'LMB on explored full-map cell sets a saved waypoint POI',
  setState.waypoint?.x === target.x && setState.waypoint?.y === target.y && setState.poi?.kind === 'waypoint' && setState.saved?.x === target.x,
  JSON.stringify(setState),
);

await page.keyboard.press('KeyM');
await page.waitForFunction(() => !document.getElementById('minimap-overlay')?.classList.contains('visible'), { timeout: 5000 });
await page.waitForFunction(() => document.getElementById('waypoint-indicator')?.classList.contains('visible'), { timeout: 5000 });
const hudInitial = await liveWaypointState();
check('HUD compass appears after closing the full map', hudInitial.indicatorVisible && hudInitial.range !== '', JSON.stringify(hudInitial));

await page.evaluate(({ x, y }) => {
  const ctx = window.__game.ctx;
  ctx.player.x = x - 20;
  ctx.player.y = y;
  ctx.camera.snapTo(ctx.player.x, ctx.player.y);
  ctx.state.frameCount += 2;
}, target);
await page.waitForTimeout(160);
const hudMoved = await liveWaypointState();
check(
  'HUD compass range updates as the player moves toward the waypoint',
  hudMoved.indicatorVisible && (hudMoved.range === '20' || hudMoved.range === 'HERE'),
  JSON.stringify({ before: hudInitial, after: hudMoved }),
);

await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });
await startConsoleRun(page, { subcommand: 'continue', clearSavedExpedition: false, settleMs: 400 });
const resumed = await liveWaypointState();
check(
  'Waypoint survives expedition save and continue',
  resumed.waypoint?.x === target.x && resumed.waypoint?.y === target.y && resumed.poi?.id === 'map-waypoint',
  JSON.stringify(resumed),
);

await page.keyboard.press('KeyM');
await page.waitForSelector('#minimap-overlay.visible', { timeout: 5000 });
const clearPoint = await waypointClientPoint(target);
await page.mouse.click(clearPoint.x, clearPoint.y, { button: 'right' });
await page.waitForFunction(() => window.__game.ctx.levels.current?.mapWaypoint == null, { timeout: 5000 });
const cleared = await liveWaypointState();
check('RMB on the full map clears waypoint and hides HUD compass', !cleared.waypoint && !cleared.indicatorVisible, JSON.stringify(cleared));

check('No page errors', pageErrors.length === 0, pageErrors.join('\n'));
check('No console errors', consoleErrors.length === 0, consoleErrors.join('\n'));

await browser.close();

console.log(`\nverify-minimap-waypoint: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

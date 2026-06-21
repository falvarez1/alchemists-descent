// Focused runtime UI accessibility probe: Runtime Inspector keyboard rows and
// modal focus traps for standalone Play overlays.
// Usage: node scripts/verify-runtime-ui.mjs [url]  (dev server running)
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, startConsoleTestRun } from './run-helpers.mjs';

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

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });
await startConsoleTestRun(page, { loadout: 'advanced', settleMs: 350 });

await page.click('#runtime-inspector-toggle');
await page.waitForSelector('#runtime-inspector.open [data-runtime-id]', { timeout: 5000 });
const inspectorRows = await page.$$eval('#runtime-inspector [data-runtime-id]', (rows) =>
  rows.map((row) => row.getAttribute('data-runtime-id')),
);
await page.locator('#runtime-inspector [data-runtime-id]').first().focus();
await page.keyboard.press('ArrowDown');
const arrowState = await page.evaluate((rows) => ({
  activeId: document.activeElement?.getAttribute('data-runtime-id'),
  expected: rows.length > 1 ? rows[1] : rows[0],
}), inspectorRows);
check('Runtime Inspector ArrowDown moves row focus', arrowState.activeId === arrowState.expected, JSON.stringify(arrowState));

await page.keyboard.press('End');
await page.keyboard.press('Space');
const selectedState = await page.evaluate(() => {
  const active = document.activeElement;
  return {
    activeId: active?.getAttribute('data-runtime-id') ?? null,
    selected: active?.getAttribute('aria-selected') === 'true',
    inspectionLight: window.__game.ctx.state.runtimeInspectionLight !== null,
  };
});
check(
  'Runtime Inspector Space selects the focused row and lights inspection target',
  selectedState.activeId !== null && selectedState.selected && selectedState.inspectionLight,
  JSON.stringify(selectedState),
);

await page.evaluate(() => {
  window.__runtimeUiChoice = null;
  window.__game.ctx.events.emit('cardOfferRequested', {
    title: 'A11Y Offer',
    prompt: 'Choose a card',
    cards: ['spark', 'bomb', 'watertrail'],
    handled: false,
    onChoose: (id) => {
      window.__runtimeUiChoice = id;
    },
  });
});
await page.waitForSelector('#card-offer-overlay.visible .card-offer-card', { timeout: 5000 });
await page.locator('#card-offer-overlay .card-offer-card').first().focus();
await page.keyboard.press('Tab');
const cardTabState = await page.evaluate(() => ({
  activeInside: document.getElementById('card-offer-overlay')?.contains(document.activeElement) ?? false,
  visible: document.getElementById('card-offer-overlay')?.classList.contains('visible') ?? false,
}));
await page.evaluate(() => document.getElementById('runtime-inspector-toggle')?.focus());
await page.waitForTimeout(60);
const cardOutsideFocusState = await page.evaluate(() => ({
  activeInside: document.getElementById('card-offer-overlay')?.contains(document.activeElement) ?? false,
}));
await page.keyboard.press('Escape');
await page.waitForTimeout(60);
const cardEscapeState = await page.evaluate(() => ({
  visible: document.getElementById('card-offer-overlay')?.classList.contains('visible') ?? false,
  pauseOpen: document.getElementById('pause-overlay')?.classList.contains('visible') ?? false,
}));
check(
  'Card offer traps Tab and scripted outside focus',
  cardTabState.visible && cardTabState.activeInside && cardOutsideFocusState.activeInside,
  JSON.stringify({ cardTabState, cardOutsideFocusState }),
);
check('Card offer Escape is captured without dismissing or opening Pause', cardEscapeState.visible && !cardEscapeState.pauseOpen, JSON.stringify(cardEscapeState));
await page.keyboard.press('Enter');
await page.waitForFunction(() => !document.getElementById('card-offer-overlay')?.classList.contains('visible'), null, { timeout: 5000 });

await page.evaluate(() => {
  window.__runtimeUiWaystoneDismissed = false;
  window.__game.ctx.events.emit('waystonePrompt', {
    card: null,
    onEquip: () => {
      window.__runtimeUiWaystoneDismissed = false;
    },
    onDismiss: () => {
      window.__runtimeUiWaystoneDismissed = true;
    },
  });
});
await page.waitForSelector('#waystone-prompt-overlay.visible .waystone-prompt-btn', { timeout: 5000 });
await page.locator('#waystone-prompt-overlay .waystone-prompt-btn').first().focus();
await page.keyboard.press('Tab');
const waystoneTabState = await page.evaluate(() => ({
  activeInside: document.getElementById('waystone-prompt-overlay')?.contains(document.activeElement) ?? false,
}));
await page.evaluate(() => document.getElementById('runtime-inspector-toggle')?.focus());
await page.waitForTimeout(60);
const waystoneOutsideFocusState = await page.evaluate(() => ({
  activeInside: document.getElementById('waystone-prompt-overlay')?.contains(document.activeElement) ?? false,
}));
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.getElementById('waystone-prompt-overlay')?.classList.contains('visible'), null, { timeout: 5000 });
const waystoneEscapeState = await page.evaluate(() => ({
  dismissed: window.__runtimeUiWaystoneDismissed === true,
  pauseOpen: document.getElementById('pause-overlay')?.classList.contains('visible') ?? false,
}));
check(
  'Waystone prompt traps Tab and scripted outside focus',
  waystoneTabState.activeInside && waystoneOutsideFocusState.activeInside,
  JSON.stringify({ waystoneTabState, waystoneOutsideFocusState }),
);
check('Waystone prompt Escape dismisses the modal without opening Pause', waystoneEscapeState.dismissed && !waystoneEscapeState.pauseOpen, JSON.stringify(waystoneEscapeState));

check('No page or console errors', pageErrors.length === 0 && consoleErrors.length === 0, [...pageErrors, ...consoleErrors].join('\n'));

await browser.close();
console.log(`\nruntime-ui probe: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

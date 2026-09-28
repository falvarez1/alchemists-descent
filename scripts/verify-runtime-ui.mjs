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

// The play screen hides the header (and its RUNTIME button) for the whole run;
// authoring builds open the inspector with F9.
await page.keyboard.press('F9');
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

// The unlit waystone no longer raises a modal (it paused the game on every
// approach): its lesson is a non-modal teach card (game/waystoneHelp).
await page.evaluate(() => window.__game.ctx.events.emit('hintTeach', { key: 'waystone-unlit', title: 'An Unlit Waystone', body: 'A waystone lights when fire keeps burning in its bowl.' }));
// A teach card waits for a calm moment (no story beat, pause or centre overlay
// — the card offer just closed), so give it the calm poll before judging.
await page.waitForFunction(() => document.getElementById('hint-teach-overlay')?.classList.contains('visible'), null, { timeout: 6000 }).catch(() => undefined);
const waystoneTeachState = await page.evaluate(() => ({
  teach: document.getElementById('hint-teach-overlay')?.classList.contains('visible') ?? false,
  paused: window.__game.ctx.state.paused,
  modal: !!document.getElementById('waystone-prompt-overlay'),
}));
check('Waystone help is a teach card: it never pauses and no modal exists', waystoneTeachState.teach && !waystoneTeachState.paused && !waystoneTeachState.modal, JSON.stringify(waystoneTeachState));

check('No page or console errors', pageErrors.length === 0 && consoleErrors.length === 0, [...pageErrors, ...consoleErrors].join('\n'));

await browser.close();
console.log(`\nruntime-ui probe: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

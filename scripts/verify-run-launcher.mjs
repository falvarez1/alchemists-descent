// Focused run launcher probe.
// Usage: node scripts/verify-run-launcher.mjs [url]  (dev server running)
import { chromium } from 'playwright-core';

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

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
const pageErrors = [];
const nativeDialogs = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', async (dialog) => {
  nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);
  await dialog.dismiss().catch(() => undefined);
});

await page.addInitScript(() => {
  let fullscreenElement = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
  document.exitFullscreen = async () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  HTMLElement.prototype.requestFullscreen = async function requestFullscreen() {
    fullscreenElement = this;
    window.__verifyFullscreenRequests = (window.__verifyFullscreenRequests ?? 0) + 1;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
});

async function resetLauncherStorageAndReload() {
  await page.evaluate(() => {
    localStorage.removeItem('noita-expedition');
    localStorage.removeItem('noita-run-launcher-prefs-v2');
    localStorage.removeItem('noita-run-launcher-prefs-v3');
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__game?.ctx?.levels?.runStatus, { timeout: 20000 });
}

function visible(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetParent !== null;
}

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.levels?.runStatus, { timeout: 20000 });
await resetLauncherStorageAndReload();

await page.click('#mode-play-btn');
await page.waitForSelector('#run-launcher.visible', { timeout: 5000 });
const normalState = await page.evaluate((visibleSource) => {
  const isVisible = eval(`(${visibleSource})`);
  return {
    normalSummary: isVisible(document.querySelector('[data-section="normal-summary"]')),
    testFields: isVisible(document.querySelector('[data-section="test-fields"]')),
    kit: isVisible(document.querySelector('[data-section="kit"]')),
    startText: document.querySelector('.run-launcher-start')?.textContent ?? '',
  };
}, String(visible));
check('New Expedition hides Test Run setup', normalState.normalSummary && !normalState.testFields && !normalState.kit, JSON.stringify(normalState));
check('New Expedition start text is clear', normalState.startText === 'START NEW', JSON.stringify(normalState));

await page.click('#run-launcher [data-mode="test"]');
await page.waitForTimeout(100);
const testState = await page.evaluate((visibleSource) => {
  const isVisible = eval(`(${visibleSource})`);
  return {
    normalSummary: isVisible(document.querySelector('[data-section="normal-summary"]')),
    testFields: isVisible(document.querySelector('[data-section="test-fields"]')),
    kit: isVisible(document.querySelector('[data-section="kit"]')),
    worldDisabled: document.querySelector('[data-field="world"]')?.disabled ?? true,
    startText: document.querySelector('.run-launcher-start')?.textContent ?? '',
  };
}, String(visible));
check('Test Run reveals world and kit setup', !testState.normalSummary && testState.testFields && testState.kit && !testState.worldDisabled, JSON.stringify(testState));
check('Test Run start text is clear', testState.startText === 'START TEST', JSON.stringify(testState));

await page.click('#run-launcher [data-kit-tab="cards"]');
await page.fill('#run-launcher [data-field="card-search"]', 'bomb');
await page.click('#run-launcher [data-action="cards-all"]');
const cardState = await page.evaluate((visibleSource) => {
  const isVisible = eval(`(${visibleSource})`);
  const visibleCards = [...document.querySelectorAll('[data-field="cards"] .run-launcher-check')]
    .filter((el) => isVisible(el))
    .map((el) => el.textContent?.trim());
  return {
    activePanel: document.querySelector('.run-launcher-kit-panel.active')?.getAttribute('data-kit-panel'),
    visibleCards,
    selectedCards: [...document.querySelectorAll('[data-field="cards"] input:checked')].map((el) => el.value),
  };
}, String(visible));
await page.click('#run-launcher [data-kit-tab="perks"]');
await page.click('#run-launcher [data-action="perks-all"]');
const perkState = await page.evaluate(() => ({
  activePanel: document.querySelector('.run-launcher-kit-panel.active')?.getAttribute('data-kit-panel'),
  selectedPerks: document.querySelectorAll('[data-field="perks"] input:checked').length,
}));
check('Card search and visible-select controls work', cardState.activePanel === 'cards' && cardState.visibleCards.length > 0 && cardState.selectedCards.includes('bomb'), JSON.stringify(cardState));
check('Perk bulk-select controls work', perkState.activePanel === 'perks' && perkState.selectedPerks > 0, JSON.stringify(perkState));

await page.click('#run-launcher [data-kit-tab="flask"]');
await page.locator('#run-launcher [data-flask-material="2"] input[type="range"]').evaluate((slider) => {
  slider.value = '450';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
});
const flaskState = await page.evaluate(() => ({
  activePanel: document.querySelector('.run-launcher-kit-panel.active')?.getAttribute('data-kit-panel'),
  selectedMaterial: document.querySelector('#run-launcher [data-flask-material="2"] input[type="radio"]')?.checked ?? false,
  sliderValue: document.querySelector('#run-launcher [data-flask-material="2"] input[type="range"]')?.value ?? '',
  summary: document.querySelector('#run-launcher [data-field="flask-summary"]')?.textContent ?? '',
}));
check(
  'Flask material rows select with per-material quantity sliders',
  flaskState.activePanel === 'flask' &&
    flaskState.selectedMaterial &&
    flaskState.sliderValue === '450' &&
    flaskState.summary.includes('450 / 600'),
  JSON.stringify(flaskState),
);

await page.selectOption('#run-launcher [data-field="world"]', 'virtual-world');
const virtualControls = await page.evaluate(() => ({
  levelDisabled: document.querySelector('[data-field="level"]')?.disabled ?? false,
  status: document.querySelector('.run-launcher-status')?.textContent ?? '',
}));
check('Virtual-world selection disables authored level picker', virtualControls.levelDisabled, JSON.stringify(virtualControls));
await page.fill('#run-launcher [data-field="seed"]', '2468');
await page.click('#run-launcher .run-launcher-start');
await page.waitForFunction(
  () =>
    window.__game.ctx.state.mode === 'play' &&
    window.__game.ctx.state.playtestSource === 'test' &&
    window.__game.ctx.levels.current?.def.id === 'virtual-test',
  { timeout: 30000 },
);
const virtualState = await page.evaluate(() => ({
  levelId: window.__game.ctx.levels.current?.def.id,
  playtestSource: window.__game.ctx.state.playtestSource,
  flask: { ...window.__game.ctx.flask.state },
  world: { width: window.__game.ctx.world.width, height: window.__game.ctx.world.height },
}));
check('Launcher starts disposable virtual-world test run', virtualState.levelId === 'virtual-test' && virtualState.playtestSource === 'test', JSON.stringify(virtualState));
check('Launcher applies selected flask setup', virtualState.flask.material === 2 && virtualState.flask.count === 450, JSON.stringify(virtualState.flask));

await resetLauncherStorageAndReload();
await page.click('#immersive-play-btn');
await page.waitForSelector('#run-launcher.visible', { timeout: 5000 });
await page.click('#run-launcher .run-launcher-start');
await page.waitForFunction(
  () =>
    window.__game.ctx.state.mode === 'play' &&
    document.fullscreenElement?.id === 'canvas-holder' &&
    (window.__verifyFullscreenRequests ?? 0) > 0,
  { timeout: 10000 },
);
const fullscreenState = await page.evaluate(() => ({
  mode: window.__game.ctx.state.mode,
  fullscreenId: document.fullscreenElement?.id ?? '',
  requests: window.__verifyFullscreenRequests ?? 0,
  buttonLit: document.getElementById('immersive-play-btn')?.classList.contains('lit') ?? false,
}));
check('Fullscreen Play resumes after launcher start', fullscreenState.fullscreenId === 'canvas-holder' && fullscreenState.buttonLit, JSON.stringify(fullscreenState));

check('no native browser dialogs', nativeDialogs.length === 0, nativeDialogs.join(' | '));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nrun-launcher probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

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
  HTMLElement.prototype.requestFullscreen = async () => {
    fullscreenElement = document.getElementById('canvas-holder');
    window.__verifyFullscreenRequests = (window.__verifyFullscreenRequests ?? 0) + 1;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
});

async function resetLauncherStorageAndReload() {
  await page.evaluate(() => {
    localStorage.removeItem('noita-expedition');
    localStorage.removeItem('noita-run-launcher-prefs-v2');
    localStorage.removeItem('noita-run-launcher-prefs-v3');
    sessionStorage.removeItem('ad-mode'); // dev mode-persistence: reset to a clean Sandbox boot
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

await page.keyboard.press('KeyH');
await page.waitForTimeout(120);
const helpLeakState = await page.evaluate(() => ({
  launcherOpen: document.getElementById('run-launcher')?.classList.contains('visible') ?? false,
  helpOpen: document.getElementById('help-overlay')?.classList.contains('visible') ?? false,
  paused: window.__game.ctx.state.paused,
}));
check('Run Launcher blocks global Help hotkey while open', helpLeakState.launcherOpen && !helpLeakState.helpOpen && !helpLeakState.paused, JSON.stringify(helpLeakState));

await page.keyboard.press('Backquote');
await page.waitForTimeout(120);
const consoleLeakState = await page.evaluate(() => ({
  launcherOpen: document.getElementById('run-launcher')?.classList.contains('visible') ?? false,
  consoleOpen: document.getElementById('dev-console')?.classList.contains('open') ?? false,
}));
check('Run Launcher blocks dev console hotkey while open', consoleLeakState.launcherOpen && !consoleLeakState.consoleOpen, JSON.stringify(consoleLeakState));

await page.keyboard.press('Escape');
await page.waitForTimeout(120);
const escapeState = await page.evaluate(() => ({
  launcherOpen: document.getElementById('run-launcher')?.classList.contains('visible') ?? false,
  paused: window.__game.ctx.state.paused,
  pauseOpen: document.getElementById('pause-overlay')?.classList.contains('visible') ?? false,
}));
check('Run Launcher Escape closes only the launcher', !escapeState.launcherOpen && !escapeState.paused && !escapeState.pauseOpen, JSON.stringify(escapeState));

await page.keyboard.press('Backquote');
await page.waitForTimeout(120);
await page.click('#mode-play-btn');
await page.waitForSelector('#run-launcher.visible', { timeout: 5000 });
await page.keyboard.press('Escape');
await page.waitForTimeout(120);
const consoleAlreadyOpenEscapeState = await page.evaluate(() => ({
  launcherOpen: document.getElementById('run-launcher')?.classList.contains('visible') ?? false,
  consoleOpen: document.getElementById('dev-console')?.classList.contains('open') ?? false,
  paused: window.__game.ctx.state.paused,
}));
check(
  'Run Launcher Escape wins even when console was already open',
  !consoleAlreadyOpenEscapeState.launcherOpen && consoleAlreadyOpenEscapeState.consoleOpen && !consoleAlreadyOpenEscapeState.paused,
  JSON.stringify(consoleAlreadyOpenEscapeState),
);
await page.keyboard.press('Backquote');
await page.waitForTimeout(120);

await page.click('#mode-play-btn');
await page.waitForSelector('#run-launcher.visible', { timeout: 5000 });
await page.click('#run-launcher [data-mode="test"]');
await page.waitForTimeout(100);

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
await page.click('#run-launcher [data-flask-slot="1"]');
await page.locator('#run-launcher [data-flask-material="7"] input[type="range"]').evaluate((slider) => {
  slider.value = '200';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
});
const flaskState = await page.evaluate(() => ({
  activePanel: document.querySelector('.run-launcher-kit-panel.active')?.getAttribute('data-kit-panel'),
  activeSlot: document.querySelector('#run-launcher .run-launcher-flask-slots button.active')?.getAttribute('data-flask-slot'),
  selectedMaterial: document.querySelector('#run-launcher [data-flask-material="7"] input[type="radio"]')?.checked ?? false,
  sliderValue: document.querySelector('#run-launcher [data-flask-material="7"] input[type="range"]')?.value ?? '',
  slot1: document.querySelector('#run-launcher [data-flask-slot="0"]')?.textContent ?? '',
  slot2: document.querySelector('#run-launcher [data-flask-slot="1"]')?.textContent ?? '',
  summary: document.querySelector('#run-launcher [data-field="flask-summary"]')?.textContent ?? '',
}));
check(
  'Flask slots preserve independent material quantities',
  flaskState.activePanel === 'flask' &&
    flaskState.activeSlot === '1' &&
    flaskState.selectedMaterial &&
    flaskState.sliderValue === '200' &&
    flaskState.slot1.includes('Water') &&
    flaskState.slot1.includes('450') &&
    flaskState.slot2.includes('Acid') &&
    flaskState.summary.includes('200 / 600'),
  JSON.stringify(flaskState),
);

await page.selectOption('#run-launcher [data-field="world"]', 'virtual-world');
const virtualControls = await page.evaluate(() => ({
  levelDisabled: document.querySelector('[data-field="level"]')?.disabled ?? false,
  status: document.querySelector('.run-launcher-status')?.textContent ?? '',
}));
check('Virtual-world selection disables authored level picker', virtualControls.levelDisabled, JSON.stringify(virtualControls));
await page.fill('#run-launcher [data-field="seed"]', '2468');
const launchFeedback = page.waitForFunction(() => {
  const loading = document.querySelector('[data-section="launching"]');
  const loadingStyle = loading ? getComputedStyle(loading) : null;
  const startButton = document.querySelector('.run-launcher-start');
  const state = {
    launcherOpen: document.getElementById('run-launcher')?.classList.contains('visible') ?? false,
    launching: document.getElementById('run-launcher')?.classList.contains('launching') ?? false,
    loadingVisible: Boolean(
      loading &&
        loadingStyle &&
        loadingStyle.display !== 'none' &&
        loadingStyle.visibility !== 'hidden' &&
        loadingStyle.opacity !== '0',
    ),
    detail: document.querySelector('[data-field="launching-detail"]')?.textContent ?? '',
    startText: startButton?.textContent ?? '',
    startDisabled: startButton instanceof HTMLButtonElement ? startButton.disabled : false,
  };
  if (
    state.launcherOpen &&
    state.launching &&
    state.loadingVisible &&
    state.detail.length > 0 &&
    state.startText.includes('OPENING') &&
    state.startDisabled
  ) {
    return state;
  }
  return false;
}, undefined, { timeout: 5000 });
await page.click('#run-launcher .run-launcher-start');
const launchingState = await (await launchFeedback).jsonValue();
check(
  'Launcher shows launch feedback while starting',
  launchingState.launcherOpen &&
    launchingState.launching &&
    launchingState.loadingVisible &&
    launchingState.detail.length > 0 &&
    launchingState.startText.includes('OPENING') &&
    launchingState.startDisabled,
  JSON.stringify(launchingState),
);
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
  activeFlaskIndex: window.__game.ctx.flask.activeIndex,
  flask: { ...window.__game.ctx.flask.state },
  flaskSlots: window.__game.ctx.flask.slots.map((slot) => ({ ...slot })),
  world: { width: window.__game.ctx.world.width, height: window.__game.ctx.world.height },
}));
check('Launcher starts disposable virtual-world test run', virtualState.levelId === 'virtual-test' && virtualState.playtestSource === 'test', JSON.stringify(virtualState));
check(
  'Launcher applies potion belt setup',
  virtualState.activeFlaskIndex === 1 &&
    virtualState.flask.material === 7 &&
    virtualState.flask.count === 200 &&
    virtualState.flaskSlots[0]?.material === 2 &&
    virtualState.flaskSlots[0]?.count === 450,
  JSON.stringify({ active: virtualState.activeFlaskIndex, state: virtualState.flask, slots: virtualState.flaskSlots }),
);
await page.waitForFunction(
  () => !document.getElementById('level-curtain')?.classList.contains('visible'),
  undefined,
  { timeout: 5000 },
);
await page.keyboard.press('Escape');
await page.waitForSelector('#pause-overlay.visible', { timeout: 5000 });
const restartFeedback = page.waitForFunction(() => {
  const curtain = document.getElementById('level-curtain');
  const title = document.getElementById('level-curtain-title')?.textContent ?? '';
  const detail = document.getElementById('level-curtain-detail')?.textContent ?? '';
  const spinner = curtain?.querySelector('.run-launcher-loading-sigil');
  const bar = curtain?.querySelector('.run-launcher-loading-bar');
  const state = {
    visible: curtain?.classList.contains('visible') ?? false,
    title,
    detail,
    pauseClosed: !document.getElementById('pause-overlay')?.classList.contains('visible'),
    spinnerVisible: Boolean(spinner && getComputedStyle(spinner).display !== 'none'),
    barVisible: Boolean(bar && getComputedStyle(bar).display !== 'none'),
  };
  return state.visible && state.detail.length > 0 && state.pauseClosed && state.spinnerVisible && state.barVisible
    ? state
    : false;
}, undefined, { timeout: 5000 });
await page.click('#pause-restart');
const restartLoadingState = await (await restartFeedback).jsonValue();
check(
  'Pause restart shows level loading feedback',
  restartLoadingState.visible &&
    restartLoadingState.pauseClosed &&
    restartLoadingState.detail.length > 0 &&
    restartLoadingState.spinnerVisible &&
    restartLoadingState.barVisible,
  JSON.stringify(restartLoadingState),
);
await page.waitForFunction(
  () =>
    window.__game.ctx.state.mode === 'play' &&
    window.__game.ctx.levels.current?.def.id === 'virtual-test' &&
    !document.getElementById('level-curtain')?.classList.contains('visible'),
  undefined,
  { timeout: 30000 },
);

await resetLauncherStorageAndReload();
await page.click('#mode-build-btn');
await page.waitForFunction(() => window.__game.ctx.state.mode === 'build', { timeout: 5000 });
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

const storagePage = await browser.newPage({ viewport: { width: 1360, height: 860 } });
storagePage.on('pageerror', (err) => pageErrors.push(`storage-page: ${String(err)}`));
await storagePage.addInitScript(() => {
  const original = Storage.prototype.getItem;
  Storage.prototype.getItem = function getItem(key) {
    if (String(key).startsWith('noita-run-launcher-prefs')) {
      throw new DOMException('Launcher prefs blocked for verification', 'SecurityError');
    }
    return original.call(this, key);
  };
});
await storagePage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await storagePage.waitForFunction(() => window.__game?.ctx?.levels?.runStatus, { timeout: 20000 });
await storagePage.click('#mode-play-btn');
await storagePage.waitForSelector('#run-launcher.visible', { timeout: 5000 });
const storageFailureState = await storagePage.evaluate(() => ({
  launcherOpen: document.getElementById('run-launcher')?.classList.contains('visible') ?? false,
  mode: window.__game.ctx.state.mode,
}));
check('Run Launcher tolerates storage read failures', storageFailureState.launcherOpen && storageFailureState.mode === 'build', JSON.stringify(storageFailureState));
await storagePage.close();

check('no native browser dialogs', nativeDialogs.length === 0, nativeDialogs.join(' | '));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nrun-launcher probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

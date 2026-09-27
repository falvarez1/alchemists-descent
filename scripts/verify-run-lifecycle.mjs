// Run lifecycle probe (Breathing Works): phials, the ledger, Descend again,
// kits, the refuge and Sanctum restores, the victory path and the daily seed.
// Real clicks for every UI step (CLAUDE.md), window.__game.ctx for setup.
// Usage: node scripts/verify-run-lifecycle.mjs [url] [shotsDir]
//   (dev server running; defaults to http://localhost:5173/)
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const shots = process.argv[3] ?? null;
if (shots) mkdirSync(shots, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const browser = await launchBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

async function shot(name, clip) {
  if (!shots) return;
  await page.screenshot({ path: `${shots}/${name}.png`, ...(clip ? { clip } : {}) });
}

async function realClick(selector) {
  const handle = await page.waitForSelector(selector, { state: 'visible', timeout: 20000 });
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const state = () => page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  return {
    level: rt?.def.id ?? null,
    transitioning: ctx.levels.transitioning,
    paused: ctx.state.paused,
    mode: ctx.state.mode,
    dead: ctx.player.dead,
    active: ctx.run.active,
    over: ctx.run.over,
    phials: ctx.run.phials,
    kit: ctx.run.kit,
    daily: ctx.run.daily,
    collection: [...ctx.wands.collection],
    wands: ctx.wands.wands.map((w) => w.cards.filter(Boolean)),
    seed: ctx.levels.runStatus(ctx).expeditionSeed,
    saved: ctx.levels.hasSavedExpedition(),
  };
});

async function waitFor(fn, arg, timeout = 30000) {
  await page.waitForFunction(fn, arg, { timeout, polling: 50 });
}

async function waitPlaying(levelId, timeout = 30000) {
  await waitFor((id) => {
    const ctx = window.__game?.ctx;
    return ctx && ctx.state.mode === 'play' && ctx.levels.current?.def.id === id && !ctx.levels.transitioning && !ctx.state.paused && !ctx.player.dead;
  }, levelId, timeout);
}

/** Kill the alchemist and wait for the title card. */
async function die(cause) {
  await page.evaluate((c) => window.__game.ctx.playerCtl.kill(c), cause);
  await page.waitForSelector('#gameover-overlay.visible', { timeout: 15000 });
  await page.waitForTimeout(3400); // title card, fade-ins, the phial drain
}

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 30000 });
  // Seed an earlier player's discoveries: none of these may reach a fresh hand.
  await page.evaluate(() => {
    localStorage.setItem('alchemists-descent-card-discovery-v1', JSON.stringify({
      version: 1,
      cards: ['bomb', 'lightning', 'meteor', 'blackhole', 'triple', 'vitrify', 'frostshard', 'bounce'],
    }));
  });

  /* ---------------- a fresh run ---------------- */
  await realClick('#expedition-entry [data-entry="begin"]');
  await waitPlaying('d1');
  let s = await state();
  check('begin starts a tracked run with three phials', s.active && s.phials === 3, JSON.stringify({ active: s.active, phials: s.phials }));
  check('fresh run starts with the spark kit only', JSON.stringify(s.collection) === '["double","speed"]' && JSON.stringify(s.wands) === '[["spark"],["dig"]]', JSON.stringify({ c: s.collection, w: s.wands }));
  const hudPhials = await page.$$eval('#phial-row .phial', (nodes) => nodes.map((n) => n.dataset.state));
  check('HUD shows three full phials', JSON.stringify(hudPhials) === '["full","full","full"]', JSON.stringify(hudPhials));
  await shot('hud-phials-full', { x: 0, y: 0, width: 520, height: 260 });

  /* ---------------- three returns ---------------- */
  const expectButton = ['Return with a phial (2 left)', 'Return with a phial (1 left)', 'Return with your last phial'];
  for (let i = 0; i < 3; i++) {
    await die('lava');
    s = await state();
    const label = await page.$eval('#respawn-btn', (b) => b.textContent);
    check(`death ${i + 1} spends a phial`, s.phials === 2 - i && s.active && !s.over, `phials=${s.phials}`);
    check(`death ${i + 1} button copy`, label === expectButton[i], JSON.stringify(label));
    if (i === 0) await shot('death-phial-drain');
    await realClick('#respawn-btn');
    await waitPlaying('d1', 10000);
  }
  const hudAfter = await page.$$eval('#phial-row .phial', (nodes) => nodes.map((n) => n.dataset.state));
  check('HUD shows every phial spent', hudAfter.every((x) => x === 'empty'), JSON.stringify(hudAfter));
  await shot('hud-phials-spent', { x: 0, y: 0, width: 520, height: 260 });

  /* ---------------- the last death ---------------- */
  await die('gunpowder');
  s = await state();
  check('death with no phial ends the run', s.over && !s.active, JSON.stringify({ over: s.over, active: s.active }));
  await page.evaluate(() => window.__game.ctx.levels.flushSaves?.());
  s = await state();
  check('the ended run retires its save', !s.saved);
  check('the ledger button replaces the return', await page.$eval('#ledger-btn', (b) => !b.hidden) && await page.$eval('#respawn-btn', (b) => b.hidden));
  await shot('death-final');
  await realClick('#ledger-btn');
  await page.waitForSelector('#run-summary.visible', { timeout: 5000 });
  await page.waitForTimeout(2600);
  const fallen = await page.evaluate(() => ({
    title: document.querySelector('#run-summary .rs-title')?.textContent,
    focus: document.activeElement?.textContent,
    deaths: [...document.querySelectorAll('#run-summary .rs-stat')].map((n) => n.textContent),
    result: window.__game.ctx.run.lastResult?.summary,
  }));
  check('fall ledger headline', fallen.title === 'You fell in the Bellows.', JSON.stringify(fallen.title));
  check('Descend again holds focus', fallen.focus === 'Descend again', JSON.stringify(fallen.focus));
  check('ledger counts four deaths', fallen.result?.deaths === 4 && fallen.result?.outcome === 'fallen', JSON.stringify(fallen.result));
  await shot('summary-fallen');
  // Keyboard: arrows walk the actions; the game's hotkeys stay shut.
  await page.keyboard.press('ArrowRight');
  const afterArrow = await page.evaluate(() => document.activeElement?.textContent);
  await page.keyboard.press('KeyM');
  await page.keyboard.press('KeyB');
  const leaked = await page.evaluate(() => Boolean(document.querySelector('#minimap-overlay.visible, #wand-bench.visible')));
  check('ledger keyboard: arrows move focus, hotkeys blocked', afterArrow === 'Save clip' && !leaked, JSON.stringify({ afterArrow, leaked }));
  await page.keyboard.press('ArrowLeft');

  /* ---------------- Descend again ---------------- */
  const t0 = Date.now();
  await realClick('#run-summary [data-rs="again"]');
  await waitPlaying('d1', 10000);
  const restartMs = Date.now() - t0;
  check('Descend again: playing in under 5 s, no reload', restartMs < 5000, `${restartMs} ms`);
  s = await state();
  check('the new run is fresh: three phials, kit cards only', s.active && s.phials === 3 && JSON.stringify(s.collection) === '["double","speed"]', JSON.stringify({ phials: s.phials, c: s.collection }));
  check('the summary is gone', await page.$eval('#run-summary', (n) => n.hidden));

  /* ---------------- refuge restore ---------------- */
  await die('lava');
  await realClick('#respawn-btn');
  await waitPlaying('d1', 10000);
  s = await state();
  check('refuge setup: one phial spent', s.phials === 2, `phials=${s.phials}`);
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const refuge = ctx.levels.current.refuge;
    ctx.player.x = refuge.x;
    ctx.player.y = refuge.y + 3;
    ctx.player.vx = 0; ctx.player.vy = 0;
    ctx.camera.snapTo(ctx.player.x, ctx.player.y);
    for (const e of ctx.enemies) if (Math.hypot(e.x - refuge.x, e.y - refuge.y) < 160) e.x += 400;
  });
  await waitFor(() => window.__game.ctx.run.phials === 3, undefined, 15000);
  await page.waitForTimeout(450);
  await shot('hud-phials-refill', { x: 0, y: 0, width: 520, height: 260 });
  check('the refuge rest pours a phial back', (await state()).phials === 3);

  /* ---------------- Sanctum restore + teaser ---------------- */
  await die('lava');
  await realClick('#respawn-btn');
  await waitPlaying('d1', 10000);
  const goThroughPortal = async () => {
    await page.evaluate(() => {
      const ctx = window.__game.ctx;
      const rt = ctx.levels.current;
      if (rt.living?.tea) rt.living.tea.completed = true;
      rt.keyTaken = true;
      ctx.player.x = rt.portal.x;
      ctx.player.y = rt.portal.y + 6;
      ctx.player.vx = 0; ctx.player.vy = 0;
    });
    await page.waitForSelector('#sanctum-overlay.visible', { timeout: 10000 });
  };
  await goThroughPortal();
  await page.waitForTimeout(1400);
  s = await state();
  check('the Sanctum refills a phial', s.phials === 3, `phials=${s.phials}`);
  const teaser = await page.evaluate(() => document.querySelector('.sanc-below-name')?.textContent);
  check('the Sanctum names the floor below', teaser === 'The Rot Gardens', JSON.stringify(teaser));
  await shot('sanctum-teaser');
  const descend = async (id) => {
    await realClick('#perk-row .perk-card');
    await realClick('#descend-btn');
    await page.waitForTimeout(90);
    const curtain = await page.evaluate(() => ({
      title: document.getElementById('level-curtain-title')?.textContent,
      detail: document.getElementById('level-curtain-detail')?.textContent,
    }));
    if (id === 'd2') await shot('curtain-floor2');
    await waitPlaying(id, 30000);
    return curtain;
  };
  const curtain2 = await descend('d2');
  check('curtain reads Floor 2 of 4', curtain2.detail === 'Floor 2 of 4' && curtain2.title === 'The Rot Gardens', JSON.stringify(curtain2));
  const unlockedAfterD2 = await page.evaluate(() => window.__game.ctx.run.metaView().unlockedKits);
  check('reaching floor 2 unlocks the Rime case', unlockedAfterD2.includes('frost'), JSON.stringify(unlockedAfterD2));

  /* ---------------- down to the Kiln, the Leviathan on the way ---------------- */
  await goThroughPortal();
  const curtain3 = await descend('d3');
  check('curtain reads Floor 3 of 4', curtain3.detail === 'Floor 3 of 4', JSON.stringify(curtain3));
  const leviathan = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const boss = ctx.enemies.find((e) => e.kind === 'leviathan');
    if (!boss) return false;
    ctx.player.x = boss.x - 40; ctx.player.y = boss.y - 30;
    ctx.camera.snapTo(ctx.player.x, ctx.player.y);
    ctx.enemyCtl.damage(boss, 99999, 0, 0);
    return true;
  });
  check('the Drowned Cisterns house the Leviathan', leviathan);
  await waitFor(() => window.__game.ctx.run.metaView().unlockedKits.includes('ember'), undefined, 5000).catch(() => undefined);
  check('slaying the Leviathan unlocks the Ember case', (await page.evaluate(() => window.__game.ctx.run.metaView().unlockedKits)).includes('ember'));
  await goThroughPortal();
  const curtain4 = await descend('d4');
  check('curtain reads Floor 4 of 4', curtain4.detail === 'Floor 4 of 4' && curtain4.title === 'The Kiln Heart', JSON.stringify(curtain4));
  const colossus = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const boss = ctx.enemies.find((e) => e.kind === 'colossus');
    if (!boss) return false;
    ctx.player.invuln = 600;
    ctx.enemyCtl.damage(boss, 999999, 0, 0);
    return true;
  });
  check('the Kiln Heart houses the Colossus', colossus);
  await page.waitForSelector('#run-summary.visible', { timeout: 12000 });
  await page.waitForTimeout(3200);
  const victory = await page.evaluate(() => ({
    title: document.querySelector('#run-summary .rs-title')?.textContent,
    unlocks: [...document.querySelectorAll('#run-summary .rs-unlock b')].map((n) => n.textContent),
    result: window.__game.ctx.run.lastResult,
    reloadGuard: performance.getEntriesByType('navigation').length,
  }));
  check('victory ledger headline', victory.title === 'The Kiln is quiet.', JSON.stringify(victory.title));
  check('victory lists the run’s unlocks', victory.result?.unlocked.includes('storm') && victory.result?.unlocked.includes('frost'), JSON.stringify(victory.result?.unlocked));
  check('victory recorded as floor 4 of 4', victory.result?.summary.floor === 4 && victory.result?.summary.outcome === 'victory');
  await shot('summary-victory');

  /* ---------------- title: the kits wait on the rack ---------------- */
  await realClick('#run-summary [data-rs="title"]');
  await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);
  const entry = await page.evaluate(() => ({
    locked: [...document.querySelectorAll('#expedition-entry .kit-chip.locked')].map((n) => n.dataset.kit),
    workshop: !document.querySelector('#expedition-entry [data-entry="workshop"]').hidden,
    cont: !document.querySelector('#expedition-entry [data-entry="continue"]').hidden,
  }));
  check('every kit is unlocked on the title', entry.locked.length === 0, JSON.stringify(entry.locked));
  check('The Workshop opens after a run ends', entry.workshop);
  check('no Continue after a finished run', !entry.cont);
  await realClick('#expedition-entry .kit-chip[data-kit="storm"]');
  await page.mouse.move(1200, 200);
  await page.waitForTimeout(250);
  const picked = await page.evaluate(() => ({
    checked: [...document.querySelectorAll('#expedition-entry .kit-chip[aria-checked="true"]')].map((n) => n.dataset.kit),
    last: window.__game.ctx.run.metaView().lastKit,
  }));
  check('choosing a kit on the title sticks and is remembered', picked.checked.join() === 'storm' && picked.last === 'storm', JSON.stringify(picked));
  await shot('entry-unlocked');

  /* ---------------- the daily seed ---------------- */
  const dailyRun = async () => {
    await realClick('#expedition-entry [data-entry="daily"]');
    const confirm = await page.waitForSelector('.app-dialog-root button.primary, .app-dialog-root [data-action="confirm"]', { timeout: 1500 }).catch(() => null);
    if (confirm) {
      const box = await confirm.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await waitPlaying('d1', 15000);
    return state();
  };
  const dailyA = await dailyRun();
  check('daily uses the spark kit and today’s date', dailyA.kit === 'spark' && /^\d{4}-\d{2}-\d{2}$/.test(dailyA.daily ?? ''), JSON.stringify({ kit: dailyA.kit, daily: dailyA.daily }));
  // Pause -> Quit to title (real clicks), then today's descent again.
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause-overlay.visible', { timeout: 5000 });
  const pauseMenu = await page.evaluate(() => ({
    abandon: !document.getElementById('pause-abandon')?.hidden,
    title: !document.getElementById('pause-title-btn')?.hidden,
  }));
  check('pause offers Abandon run and Quit to title', pauseMenu.abandon && pauseMenu.title, JSON.stringify(pauseMenu));
  await shot('pause-menu');
  await realClick('#pause-title-btn');
  await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 10000 });
  check('Quit to title keeps the descent for Continue', await page.$eval('#expedition-entry [data-entry="continue"]', (b) => !b.hidden));
  await realClick('#expedition-entry [data-entry="continue"]');
  await waitPlaying('d1', 15000);
  const resumed = await state();
  check('Continue resumes the same run', resumed.active && resumed.seed === dailyA.seed && resumed.daily === dailyA.daily && resumed.phials === dailyA.phials, JSON.stringify({ seed: resumed.seed, daily: resumed.daily, phials: resumed.phials }));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause-overlay.visible', { timeout: 5000 });
  await realClick('#pause-title-btn');
  await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 10000 });
  const dailyB = await dailyRun();
  check('the daily seed is reproducible', dailyA.seed === dailyB.seed && dailyA.daily === dailyB.daily, `${dailyA.seed} vs ${dailyB.seed}`);

  /* ---------------- abandon ---------------- */
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause-overlay.visible', { timeout: 5000 });
  await realClick('#pause-abandon');
  const confirm = await page.waitForSelector('.app-dialog-root button.primary, .app-dialog-root [data-action="confirm"]', { timeout: 3000 });
  const cbox = await confirm.boundingBox();
  await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
  await page.waitForSelector('#run-summary.visible', { timeout: 5000 });
  const abandoned = await page.evaluate(() => window.__game.ctx.run.lastResult?.summary);
  check('Abandon run ends in the ledger', abandoned?.outcome === 'abandoned' && abandoned?.daily !== null, JSON.stringify(abandoned));
  await page.waitForTimeout(2400);
  await shot('summary-abandoned-daily');
} catch (error) {
  failures++;
  console.error('PROBE ERROR', error);
  await shot('probe-error');
}

for (const err of pageErrors) {
  console.error('PAGE ERROR:', err);
  failures++;
}
await browser.close();
console.log(failures === 0 ? '\nRUN LIFECYCLE OK' : `\nRUN LIFECYCLE FAILED: ${failures}`);
process.exit(failures === 0 ? 0 : 1);

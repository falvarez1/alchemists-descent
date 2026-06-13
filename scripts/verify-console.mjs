// Dev console end-to-end gate.
// Usage: node scripts/verify-console.mjs [url]   (dev server must be running)
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
const page = await browser.newPage({ viewport: { width: 1440, height: 880 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });
await page.waitForTimeout(900);

const isOpen = () =>
  page.evaluate(() => document.getElementById('dev-console')?.classList.contains('open') === true);

await page.click('#dev-console-toggle');
await page.waitForFunction(() => document.getElementById('dev-console')?.classList.contains('open'));
await page.waitForFunction(() => document.activeElement?.id === 'dev-console-input');
let state = await page.evaluate(() => ({
  open: document.getElementById('dev-console')?.classList.contains('open'),
  lit: document.getElementById('dev-console-toggle')?.classList.contains('lit'),
  focused: document.activeElement?.id,
}));
check('header CONSOLE button opens and lights', state.open && state.lit && state.focused === 'dev-console-input', JSON.stringify(state));

await page.keyboard.type('help');
let inputValue = await page.locator('#dev-console-input').inputValue();
check('console input receives real typed text', inputValue === 'help', `value=${inputValue}`);
await page.keyboard.press('Enter');
await page.waitForFunction(() => (document.querySelector('#dev-console .dev-console-log')?.textContent ?? '').includes('spawn'));
const helpLog = await page.evaluate(() => document.querySelector('#dev-console .dev-console-log')?.textContent ?? '');
check('typed help command writes a result line', helpLog.includes('tp <x|~>') && helpLog.includes('cell <material>'), helpLog.slice(-200));

await page.setInputFiles('#dev-console .dev-console-file', {
  name: 'phase3.console',
  mimeType: 'text/plain',
  buffer: Buffer.from('set global.simSpeed 0.9\nassert global.simSpeed == 0.9\n'),
});
await page.waitForFunction(() => (document.querySelector('#dev-console .dev-console-log')?.textContent ?? '').includes('Imported 1 script'));
const importLog = await page.evaluate(() => document.querySelector('#dev-console .dev-console-log')?.textContent ?? '');
check('overlay imports console script files', importLog.includes('phase3'), importLog.slice(-200));
await page.setInputFiles('#dev-console .dev-console-file', {
  name: 'bad.json',
  mimeType: 'application/json',
  buffer: Buffer.from('{'),
});
await page.waitForFunction(() => (document.querySelector('#dev-console .dev-console-log')?.textContent ?? '').includes('Script import failed'));
const badImport = await page.evaluate(() => {
  const scripts = JSON.parse(localStorage.getItem('noita-console-scripts') ?? '{}');
  return {
    log: document.querySelector('#dev-console .dev-console-log')?.textContent ?? '',
    hasBad: Object.prototype.hasOwnProperty.call(scripts, 'bad'),
  };
});
check('overlay rejects malformed JSON script imports', !badImport.hasBad && badImport.log.includes('Invalid JSON'), JSON.stringify(badImport));
await page.click('#dev-console-input');

await page.keyboard.type('ce');
await page.keyboard.press('ArrowUp');
inputValue = await page.locator('#dev-console-input').inputValue();
check('history up recalls previous command', inputValue === 'help', `value=${inputValue}`);
await page.keyboard.press('ArrowDown');
inputValue = await page.locator('#dev-console-input').inputValue();
check('history down restores the draft', inputValue === 'ce', `value=${inputValue}`);
await page.keyboard.press('Tab');
inputValue = await page.locator('#dev-console-input').inputValue();
check('Tab completion cycles in-place', inputValue.startsWith('cell'), `value=${inputValue}`);
await page.keyboard.press('Backquote');
await page.waitForFunction(() => !document.getElementById('dev-console')?.classList.contains('open'));
check('Backquote closes the console while input is focused', !(await isOpen()));
await page.keyboard.press('Backquote');
await page.waitForFunction(() => document.getElementById('dev-console')?.classList.contains('open'));
await page.waitForFunction(() => document.activeElement?.id === 'dev-console-input');
state = await page.evaluate(() => ({
  open: document.getElementById('dev-console')?.classList.contains('open'),
  focused: document.activeElement?.id,
}));
check('Backquote reopens after closing from focused console input', state.open && state.focused === 'dev-console-input', JSON.stringify(state));
await page.keyboard.press('Backquote');
await page.waitForFunction(() => !document.getElementById('dev-console')?.classList.contains('open'));

const api = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const gpuBefore = ctx.state.postFx.gpuCompose;
  const help = await ctx.console.exec('help tp');
  const fill = await ctx.console.exec('fill 20 20 21 21 water');
  const dump = await ctx.console.exec('dump 20 20 2 2');
  const count = await ctx.console.exec('count water 20 20 2 2');
  const time = await ctx.console.exec('time 0.6');
  const timeRestore = await ctx.console.exec('time 1');
  const gpu = await ctx.console.exec('gpu toggle');
  const gpuAfter = ctx.state.postFx.gpuCompose;
  const gpuRestore = await ctx.console.exec(`gpu ${gpuBefore ? 'on' : 'off'}`);
  const gpuRestored = ctx.state.postFx.gpuCompose;
  const pos = await ctx.console.exec('pos');
  const tele = await ctx.console.exec('tele');
  const perfOn = await ctx.console.exec('perf on');
  const perfLitOn = document.getElementById('perf-hud-toggle')?.classList.contains('lit') === true;
  const perfrec = await ctx.console.exec('perfrec 3');
  const perfOff = await ctx.console.exec('perf off');
  const perfLitOff = document.getElementById('perf-hud-toggle')?.classList.contains('lit') === true;
  const execScript = await ctx.console.exec('exec phase3');
  const assertPass = await ctx.console.exec('assert global.simSpeed == 0.9');
  const assertFail = await ctx.console.exec('assert global.simSpeed > 1.5');
  const watch = await ctx.console.exec('watch global.simSpeed');
  const bind = await ctx.console.exec('bind F4 time 0.4');
  const shotRaw = await ctx.console.exec('screenshot');
  const screenshot = {
    ok: shotRaw.ok,
    text: shotRaw.text,
    data: {
      width: shotRaw.data?.width,
      height: shotRaw.data?.height,
      type: shotRaw.data?.type,
      prefix: typeof shotRaw.data?.dataUrl === 'string' ? shotRaw.data.dataUrl.slice(0, 22) : '',
      bytesApprox: shotRaw.data?.bytesApprox,
      nonBlankSamples: shotRaw.data?.nonBlankSamples,
      sampleHash: shotRaw.data?.sampleHash,
    },
  };
  const set = await ctx.console.exec('set global.simSpeed 0.7');
  const get = await ctx.console.exec('get global.simSpeed');
  const simSpeedAfterSet = ctx.params.global.simSpeed;
  const blocked = await ctx.console.exec('cell water --target builder-document');
  const duplicate = await ctx.console.exec('cell water @sandbox @expedition');
  const complete = ctx.console.complete('spawn sl');
  const scriptComplete = ctx.console.complete('exec ph');
  await ctx.console.exec('time 1');
  await ctx.console.exec(`gpu ${gpuBefore ? 'on' : 'off'}`);
  return {
    help,
    fill,
    dump,
    count,
    time,
    timeRestore,
    gpu,
    gpuAfter,
    gpuRestore,
    gpuRestored,
    pos,
    tele,
    perfOn,
    perfLitOn,
    perfrec,
    perfOff,
    perfLitOff,
    execScript,
    assertPass,
    assertFail,
    watch,
    bind,
    screenshot,
    set,
    get,
    simSpeedAfterSet,
    blocked,
    duplicate,
    complete,
    scriptComplete,
  };
});
check('ctx.console.exec returns Promise<CommandResult>', api.help.ok && api.help.data?.command?.id === 'game.tp', JSON.stringify(api.help));
const dumpedTypes = Array.isArray(api.dump.data?.types) ? api.dump.data.types.flat() : [];
check(
  'fill/dump/count round trip structured cell data',
  api.fill.ok &&
    api.fill.data?.cells === 4 &&
    dumpedTypes.length === 4 &&
    dumpedTypes.every((v) => v === 2) &&
    api.count.ok &&
    api.count.data?.count === 4,
  JSON.stringify({ fill: api.fill, dump: api.dump, count: api.count }),
);
check('time command uses simSpeed dial without taint', api.time.ok && api.time.data?.value === 0.6 && api.timeRestore.ok && api.timeRestore.data?.value === 1, JSON.stringify(api.time));
check('gpu command toggles and restores GPU compose', api.gpu.ok && api.gpuAfter === !api.gpuRestored && api.gpuRestore.ok, JSON.stringify({ gpu: api.gpu, gpuAfter: api.gpuAfter, gpuRestored: api.gpuRestored }));
check('pos and tele commands return structured readouts', api.pos.ok && api.pos.data?.player?.x !== undefined && api.tele.ok && api.tele.data?.counters, JSON.stringify({ pos: api.pos, tele: api.tele }));
check('perf command toggles existing HUD', api.perfOn.ok && api.perfLitOn && api.perfOff.ok && !api.perfLitOff, JSON.stringify({ perfOn: api.perfOn, perfOff: api.perfOff }));
check(
  'perfrec records requested browser frame buckets',
  api.perfrec.ok &&
    api.perfrec.data?.framesRequested === 3 &&
    api.perfrec.data?.framesCaptured === 3 &&
    api.perfrec.data?.summary?.frame?.avg >= 0,
  JSON.stringify(api.perfrec),
);
check(
  'exec/assert automation surface gates command scripts',
  api.execScript.ok &&
    api.execScript.data?.code === 'script-complete' &&
    api.assertPass.ok &&
    !api.assertFail.ok &&
    api.scriptComplete.includes('phase3'),
  JSON.stringify({ execScript: api.execScript, assertPass: api.assertPass, assertFail: api.assertFail, scriptComplete: api.scriptComplete }),
);
check(
  'watch/bind/screenshot commands return structured polish data',
  api.watch.ok &&
    api.watch.data?.action === 'watch' &&
    api.bind.ok &&
    api.bind.data?.key === 'F4' &&
    api.screenshot.ok &&
    api.screenshot.data?.prefix === 'data:image/png;base64,' &&
    api.screenshot.data?.width > 0 &&
    api.screenshot.data?.height > 0 &&
    api.screenshot.data?.nonBlankSamples > 0 &&
    api.screenshot.data?.sampleHash > 0,
  JSON.stringify({ watch: api.watch, bind: api.bind, screenshot: api.screenshot }),
);
check('set/get round trip structured data', api.set.ok && api.get.data?.value === 0.7 && api.simSpeedAfterSet === 0.7, JSON.stringify(api));
check('builder-document target is explicitly blocked', !api.blocked.ok && api.blocked.data?.code === 'target-blocked', JSON.stringify(api.blocked));
check('duplicate target flags fail closed', !api.duplicate.ok && api.duplicate.data?.code === 'target-duplicate', JSON.stringify(api.duplicate));
check('argument completion includes enemy kinds', api.complete.includes('slime'), JSON.stringify(api.complete));
await page.waitForFunction(() => document.getElementById('dev-console-watch')?.classList.contains('visible'));
const watchHud = await page.evaluate(() => document.getElementById('dev-console-watch')?.textContent ?? '');
check('watch command pins live values to HUD', watchHud.includes('global.simSpeed'), watchHud);
await page.evaluate(() => {
  window.__game.ctx.params.global.simSpeed = 1;
});
await page.keyboard.down('Shift');
await page.keyboard.press('F4');
await page.keyboard.up('Shift');
await page.waitForTimeout(150);
const modifiedBind = await page.evaluate(() => ({
  simSpeed: window.__game.ctx.params.global.simSpeed,
  log: document.querySelector('#dev-console .dev-console-log')?.textContent ?? '',
}));
check('bind command ignores modifier F-key chords', modifiedBind.simSpeed === 1 && !modifiedBind.log.includes('[F4] time 0.4'), JSON.stringify(modifiedBind));
await page.keyboard.press('F4');
await page.waitForFunction(() => window.__game.ctx.params.global.simSpeed === 0.4, { timeout: 5000 });
const bindLog = await page.evaluate(() => document.querySelector('#dev-console .dev-console-log')?.textContent ?? '');
check('bind command runs transitional F-key shortcut while console is closed', bindLog.includes('[F4] time 0.4'), bindLog.slice(-240));
const mirrorLog = await page.evaluate(() => {
  window.__game.ctx.events.emit('toast', { text: 'CONSOLE MIRROR PROBE' });
  window.dispatchEvent(new ErrorEvent('error', { message: 'CONSOLE ERROR PROBE', filename: 'verify-console', lineno: 1 }));
  window.dispatchEvent(new ErrorEvent('error', { message: 'CONSOLE ERROR PROBE', filename: 'verify-console', lineno: 1 }));
  return document.querySelector('#dev-console .dev-console-log')?.textContent ?? '';
});
check('toast and JS errors mirror into console log', mirrorLog.includes('CONSOLE MIRROR PROBE') && mirrorLog.includes('CONSOLE ERROR PROBE') && mirrorLog.includes('(x2)'), mirrorLog.slice(-240));
await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('bind F4 clear');
  await ctx.console.exec('watch clear');
  await ctx.console.exec('time 1');
});

await page.click('#mode-play-btn');
await page.waitForFunction(() => window.__game.ctx.state.mode === 'play', { timeout: 6000 });
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  ctx.enemies.length = 0;
  ctx.player.x = 600;
  ctx.player.y = 500;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.player.fx = 0;
  ctx.player.fy = 0;
  ctx.player.dead = false;
  ctx.state.paused = false;
  for (let y = 470; y <= 501; y++) {
    for (let x = 570; x <= 630; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0;
      w.colors[i] = 0;
      w.life[i] = 0;
      w.charge[i] = 0;
    }
  }
  for (let x = 570; x <= 630; x++) {
    const i = w.idx(x, 501);
    w.types[i] = 13;
    w.colors[i] = 0x7a8a99;
  }
  ctx.camera.snapTo(ctx.player.x, ctx.player.y);
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(120);
await page.keyboard.press('Backquote');
await page.waitForFunction(() => document.getElementById('dev-console')?.classList.contains('open'));
const afterOpen = await page.evaluate(() => ({
  x: window.__game.ctx.player.x,
  y: window.__game.ctx.player.y,
  keys: { ...window.__game.ctx.input.keys },
}));
const stable = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.player.x = 600;
  ctx.player.y = 500;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.player.fx = 0;
  ctx.player.fy = 0;
  ctx.camera.snapTo(ctx.player.x, ctx.player.y);
  const input = document.getElementById('dev-console-input');
  if (input instanceof HTMLInputElement) input.value = '';
  return { x: ctx.player.x, y: ctx.player.y };
});
await page.keyboard.up('KeyW');
await page.keyboard.type('wasd');
await page.waitForTimeout(350);
const afterType = await page.evaluate(() => ({
  x: window.__game.ctx.player.x,
  y: window.__game.ctx.player.y,
  keys: { ...window.__game.ctx.input.keys },
  siphonHeld: window.__game.ctx.input.siphonHeld,
  input: document.getElementById('dev-console-input')?.value,
}));
check('opening console clears held input flags', Object.values(afterOpen.keys).every((v) => v === false), JSON.stringify(afterOpen));
check(
  'typing movement keys in console does not move the player',
  Math.abs(afterType.x - stable.x) <= 1 && Math.abs(afterType.y - stable.y) <= 1 && afterType.input === 'wasd',
  JSON.stringify({ afterOpen, stable, afterType }),
);
check('keyup while console open does not stick held verbs', Object.values(afterType.keys).every((v) => v === false) && !afterType.siphonHeld, JSON.stringify(afterType));
await page.keyboard.press('Backquote');
await page.waitForFunction(() => !document.getElementById('dev-console')?.classList.contains('open'));

const findRuntime = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  if (!rt) return { missing: true };
  rt.pickups.push({ kind: 'key', x: 604, y: 494, vx: 0, vy: 0, taken: false, data: {} });
  rt.mechanisms.push({ id: 9001, kind: 'lever', x: 620, y: 500, w: 1, h: 1, state: 0, targetId: -1 });
  rt.portal = { x: 640, y: 498, open: false };
  const pickup = await ctx.console.exec('find pickup');
  const mechanism = await ctx.console.exec('find mechanism');
  const portal = await ctx.console.exec('find portal');
  return { pickup, mechanism, portal };
});
check(
  'find command locates runtime pickups, mechanisms, and portal',
  findRuntime.pickup?.ok &&
    findRuntime.pickup.data?.item?.kind === 'key' &&
    findRuntime.mechanism?.data?.item?.id === 9001 &&
    findRuntime.portal?.data?.item?.x === 640,
  JSON.stringify(findRuntime),
);

await page.click('#mode-builder-btn');
await page.waitForSelector('#builder-intent-modal', { timeout: 5000 });
await page.click('#builder-intent-modal [data-intent="current-scene"]');
await page.waitForFunction(() => document.body.classList.contains('builder-open'), { timeout: 5000 });
const builderPlaytestBefore = await page.evaluate(() => ({
  mode: window.__game.ctx.state.mode,
  builderOpen: document.body.classList.contains('builder-open'),
  level: window.__game.ctx.levels.current?.def.id ?? null,
}));
await page.click('#b-playtest');
await page.waitForFunction(() => window.__game.ctx.state.mode === 'play' && window.__game.ctx.levels.current?.def.id === 'custom', { timeout: 8000 });
const realPlaytest = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const anchor = { x: Math.floor(ctx.player.x), y: Math.floor(ctx.player.y - 9) };
  const beforeType = ctx.world.types[ctx.world.idx(anchor.x, anchor.y)];
  const paintType = beforeType === 2 ? 13 : 2;
  const paintMaterial = paintType === 2 ? 'water' : 'metal';
  const before = {
    debugGodMode: ctx.state.debugGodMode,
    score: ctx.state.score,
    hp: ctx.player.hp,
    maxHp: ctx.player.maxHp,
    cards: ctx.wands.collection.length,
  };
  const cell = await ctx.console.exec(`cell ${paintMaterial} 1 --target builder-playtest`);
  const paintedType = ctx.world.types[ctx.world.idx(anchor.x, anchor.y)];
  const god = await ctx.console.exec('god --target builder-playtest');
  const give = await ctx.console.exec('give gold 50 --target builder-playtest');
  const heal = await ctx.console.exec('heal full --target builder-playtest');
  const gold = await ctx.console.exec('gold 50 --target builder-playtest');
  const after = {
    debugGodMode: ctx.state.debugGodMode,
    score: ctx.state.score,
    hp: ctx.player.hp,
    maxHp: ctx.player.maxHp,
    cards: ctx.wands.collection.length,
  };
  return {
    mode: ctx.state.mode,
    level: ctx.levels.current?.def.id ?? null,
    anchor,
    beforeType,
    paintType,
    paintMaterial,
    paintedType,
    before,
    after,
    cell,
    god,
    give,
    heal,
    gold,
  };
});
check(
  'real Builder PLAYTEST enters disposable builder-playtest runtime',
  builderPlaytestBefore.mode === 'build' &&
    builderPlaytestBefore.builderOpen &&
    realPlaytest.mode === 'play' &&
    realPlaytest.level === 'custom' &&
    realPlaytest.cell.ok &&
    realPlaytest.beforeType !== realPlaytest.paintType &&
    realPlaytest.paintedType === realPlaytest.paintType,
  JSON.stringify({ builderPlaytestBefore, realPlaytest }),
);
check(
  'Builder playtest blocks persistent-state console commands',
  !realPlaytest.god.ok &&
    !realPlaytest.give.ok &&
    !realPlaytest.heal.ok &&
    !realPlaytest.gold.ok &&
    realPlaytest.god.data?.code === 'target-blocked' &&
    realPlaytest.give.data?.code === 'target-blocked' &&
    realPlaytest.heal.data?.code === 'target-blocked' &&
    realPlaytest.gold.data?.code === 'target-blocked' &&
    JSON.stringify(realPlaytest.before) === JSON.stringify(realPlaytest.after),
  JSON.stringify(realPlaytest),
);
await page.click('#mode-builder-btn');
await page.waitForFunction(() => document.body.classList.contains('builder-open') && window.__game.ctx.state.mode === 'build', { timeout: 8000 });
const playtestReturn = await page.evaluate(async (anchor) => {
  const ctx = window.__game.ctx;
  const bake = document.getElementById('b-bake');
  const returnedType = ctx.world.types[ctx.world.idx(anchor.x, anchor.y)];
  const docTarget = await ctx.console.exec('cell water --target builder-document');
  return {
    mode: ctx.state.mode,
    builderOpen: document.body.classList.contains('builder-open'),
    level: ctx.levels.current?.def.id ?? null,
    returnedType,
    bakeVisible: bake ? getComputedStyle(bake).display !== 'none' : false,
    docTarget,
  };
}, realPlaytest.anchor);
check(
  'Builder playtest scars are not auto-applied to authored terrain',
    playtestReturn.mode === 'build' &&
    playtestReturn.builderOpen &&
    realPlaytest.beforeType !== realPlaytest.paintType &&
    playtestReturn.returnedType === realPlaytest.beforeType &&
    playtestReturn.bakeVisible,
  JSON.stringify({ realPlaytest, playtestReturn }),
);
check(
  'Builder document target stays blocked after real playtest return',
  !playtestReturn.docTarget.ok && playtestReturn.docTarget.data?.code === 'target-blocked',
  JSON.stringify(playtestReturn.docTarget),
);
await page.click('#b-exit');
await page.waitForTimeout(150);

await page.click('#mode-build-btn');
await page.waitForFunction(() => window.__game.ctx.state.mode === 'build', { timeout: 5000 });
const sandboxFind = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const res = await ctx.console.exec('find pickup @sandbox');
  return { mode: ctx.state.mode, level: ctx.levels.current?.def.id ?? null, res };
});
check(
  'find @sandbox does not read parked runtime metadata',
  sandboxFind.mode === 'build' && !sandboxFind.res.ok && sandboxFind.res.data?.code === 'runtime-unavailable',
  JSON.stringify(sandboxFind),
);
await page.click('#mode-builder-btn');
await page.waitForFunction(() => document.body.classList.contains('builder-open'), { timeout: 5000 });
const builderBefore = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('time 1');
  await ctx.console.exec('bind F4 time 0.2');
  return {
    mode: ctx.state.mode,
    builderOpen: document.body.classList.contains('builder-open'),
    tool: document.querySelector('.bp-tool.active')?.getAttribute('data-tool') ?? '',
    simSpeed: ctx.params.global.simSpeed,
    log: document.querySelector('#dev-console .dev-console-log')?.textContent ?? '',
  };
});
await page.keyboard.press('F4');
await page.waitForTimeout(150);
const builderBindGuard = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const log = document.querySelector('#dev-console .dev-console-log')?.textContent ?? '';
  await ctx.console.exec('bind F4 clear');
  return { simSpeed: ctx.params.global.simSpeed, log };
});
check(
  'transitional console binds yield while Builder Author is open',
  builderBindGuard.simSpeed === builderBefore.simSpeed && !builderBindGuard.log.includes('[F4] time 0.2'),
  JSON.stringify({ builderBefore, builderBindGuard }),
);
await page.keyboard.press('Backquote');
await page.waitForFunction(() => document.getElementById('dev-console')?.classList.contains('open'));
await page.keyboard.press('Tab');
const builderDuringConsole = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const res = await ctx.console.exec('cell water');
  const docTarget = await ctx.console.exec('cell water --target builder-document');
  const dumpSandbox = await ctx.console.exec('dump 0 0 1 1 @sandbox');
  return {
    mode: ctx.state.mode,
    builderOpen: document.body.classList.contains('builder-open'),
    consoleOpen: document.getElementById('dev-console')?.classList.contains('open'),
    tool: document.querySelector('.bp-tool.active')?.getAttribute('data-tool') ?? '',
    res,
    docTarget,
    dumpSandbox,
  };
});
check(
  'console preempts Builder shortcuts while Builder Author is open',
  builderDuringConsole.mode === 'build' &&
    builderDuringConsole.builderOpen &&
    builderDuringConsole.consoleOpen &&
    builderDuringConsole.tool === builderBefore.tool,
  JSON.stringify({ builderBefore, builderDuringConsole }),
);
check('Builder-open world mutation requires explicit target choice', !builderDuringConsole.res.ok && builderDuringConsole.res.data?.code === 'target-ambiguous', JSON.stringify(builderDuringConsole.res));
check('Builder document remains blocked even when target is explicit', !builderDuringConsole.docTarget.ok && builderDuringConsole.docTarget.data?.code === 'target-blocked', JSON.stringify(builderDuringConsole.docTarget));
check(
  'Builder-open sandbox reads are blocked until a Builder read adapter exists',
  !builderDuringConsole.dumpSandbox.ok &&
    builderDuringConsole.dumpSandbox.data?.code === 'target-blocked' &&
    builderDuringConsole.dumpSandbox.data?.reason === 'builder-open',
  JSON.stringify(builderDuringConsole.dumpSandbox),
);
await page.keyboard.press('Backquote');
await page.click('#b-exit');
await page.waitForTimeout(150);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nverify-console: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

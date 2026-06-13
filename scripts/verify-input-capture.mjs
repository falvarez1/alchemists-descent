// Focused game-key capture probe.
// Usage: node scripts/verify-input-capture.mjs [url]  (dev server running)
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
const page = await browser.newPage({ viewport: { width: 1300, height: 820 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(900);

const panCheck = async (name, code, axis, dir) => {
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.camera.snapTo(600, 500);
    document.body.focus();
  });
  const before = await page.evaluate((a) => window.__game.ctx.camera[a], axis);
  await page.keyboard.down(code);
  let moved = true;
  try {
    await page.waitForFunction(
      ({ a, b, d }) => {
        const v = window.__game.ctx.camera[a];
        return d > 0 ? v > b + 5 : v < b - 5;
      },
      { a: axis, b: before, d: dir },
      { timeout: 1200 },
    );
  } catch {
    moved = false;
  }
  await page.keyboard.up(code).catch(() => undefined);
  const after = await page.evaluate((a) => window.__game.ctx.camera[a], axis);
  check(name, moved, `${before} -> ${after}`);
};

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.mode = 'build';
  ctx.state.paused = false;
  document.body.focus();
});
await panCheck('Sandbox A pans camera left', 'KeyA', 'tx', -1);
await panCheck('Sandbox D pans camera right', 'KeyD', 'tx', 1);
await panCheck('Sandbox W pans camera up', 'KeyW', 'ty', -1);
await panCheck('Sandbox S pans camera down', 'KeyS', 'ty', 1);

await page.click('#mode-builder-btn');
await page.waitForFunction(() => document.body.classList.contains('builder-open'), { timeout: 5000 });
const builderTab = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.mode = 'build';
  const evt = new KeyboardEvent('keydown', { code: 'Tab', bubbles: true, cancelable: true });
  window.dispatchEvent(evt);
  return {
    defaultPrevented: evt.defaultPrevented,
    mode: ctx.state.mode,
    builderOpen: document.body.classList.contains('builder-open'),
  };
});
check(
  'Builder owns Tab without flipping mode',
  builderTab.defaultPrevented && builderTab.mode === 'build' && builderTab.builderOpen,
  JSON.stringify(builderTab),
);
await panCheck('Builder A pans camera left', 'KeyA', 'tx', -1);
await panCheck('Builder D pans camera right', 'KeyD', 'tx', 1);
await panCheck('Builder W pans camera up', 'KeyW', 'ty', -1);
await panCheck('Builder S pans camera down', 'KeyS', 'ty', 1);

await page.click('#mode-play-btn');
await page.waitForFunction(
  () => window.__game.ctx.state.mode === 'play' && !document.body.classList.contains('builder-open'),
  { timeout: 5000 },
);

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.input.keys.down = false;
  ctx.state.paused = false;
});
await page.keyboard.down('Control');
await page.keyboard.down('KeyS');
const realCtrlSHeld = await page.evaluate(() => window.__game.ctx.input.keys.down);
await page.keyboard.up('KeyS');
await page.keyboard.up('Control');
const realCtrlSReleased = await page.evaluate(() => !window.__game.ctx.input.keys.down);

const result = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.mode = 'play';
  ctx.state.paused = false;

  const clear = () => {
    ctx.input.keys.left = false;
    ctx.input.keys.right = false;
    ctx.input.keys.up = false;
    ctx.input.keys.jump = false;
    ctx.input.keys.wallJump = false;
    ctx.input.keys.down = false;
    ctx.input.keys.grab = false;
    ctx.input.siphonHeld = false;
    ctx.input.pourHeld = false;
    ctx.input.drinkHeld = false;
  };
  const key = (type, code, init = {}) => {
    const evt = new KeyboardEvent(type, {
      code,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    window.dispatchEvent(evt);
    return evt.defaultPrevented;
  };

  clear();
  const sDownPrevented = key('keydown', 'KeyS');
  const sDownHeld = ctx.input.keys.down;
  const sUpPrevented = key('keyup', 'KeyS');
  const sReleased = !ctx.input.keys.down;

  clear();
  const ctrlPrevented = key('keydown', 'ControlLeft');
  const ctrlNotGrab = !ctx.input.keys.grab;

  clear();
  const shiftPrevented = key('keydown', 'ShiftLeft');
  const shiftGrab = ctx.input.keys.grab;
  key('keyup', 'ShiftLeft');
  const shiftReleased = !ctx.input.keys.grab;

  clear();
  const cPrevented = key('keydown', 'KeyC');
  const cGrab = ctx.input.keys.grab;
  key('keyup', 'KeyC');
  const cReleased = !ctx.input.keys.grab;

  clear();
  const ctrlSPrevented = key('keydown', 'KeyS', { ctrlKey: true });
  const ctrlSHeld = ctx.input.keys.down;
  key('keyup', 'KeyS', { ctrlKey: true });

  clear();
  key('keydown', 'KeyW');
  key('keydown', 'Space');
  key('keyup', 'KeyW');
  const jumpHeldBySpace = ctx.input.keys.jump && ctx.input.keys.wallJump && !ctx.input.keys.up;
  key('keyup', 'Space');
  const jumpReleased = !ctx.input.keys.jump && !ctx.input.keys.wallJump;

  clear();
  key('keydown', 'KeyA');
  const dialogRoot = document.createElement('div');
  dialogRoot.className = 'app-dialog-root';
  document.body.appendChild(dialogRoot);
  key('keyup', 'KeyA');
  const dialogKeyupReleased = !ctx.input.keys.left;
  dialogRoot.remove();

  clear();
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  const inputEvt = new KeyboardEvent('keydown', {
    code: 'KeyS',
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(inputEvt);
  const textInputIgnored = !inputEvt.defaultPrevented && !ctx.input.keys.down;
  input.remove();

  ctx.input.keys.left = true;
  ctx.input.keys.grab = true;
  window.dispatchEvent(new Event('blur'));
  const blurCleared = !ctx.input.keys.left && !ctx.input.keys.grab;

  clear();
  return {
    sDownPrevented,
    sDownHeld,
    sUpPrevented,
    sReleased,
    ctrlPrevented,
    ctrlNotGrab,
    shiftPrevented,
    shiftGrab,
    shiftReleased,
    cPrevented,
    cGrab,
    cReleased,
    ctrlSPrevented,
    ctrlSHeld,
    jumpHeldBySpace,
    jumpReleased,
    dialogKeyupReleased,
    textInputIgnored,
    blurCleared,
  };
});

check('S is captured in play mode', result.sDownPrevented && result.sDownHeld, JSON.stringify(result));
check('S keyup is captured and releases down', result.sUpPrevented && result.sReleased, JSON.stringify(result));
check('Ctrl no longer grabs', !result.ctrlPrevented && result.ctrlNotGrab, JSON.stringify(result));
check('Shift grabs and releases', result.shiftPrevented && result.shiftGrab && result.shiftReleased, JSON.stringify(result));
check('C grabs and releases', result.cPrevented && result.cGrab && result.cReleased, JSON.stringify(result));
check('Ctrl+S is still claimed by the game key', result.ctrlSPrevented && result.ctrlSHeld, JSON.stringify(result));
check('real Ctrl+S reaches game without sticking', realCtrlSHeld && realCtrlSReleased);
check('W release does not clear Space jump', result.jumpHeldBySpace && result.jumpReleased, JSON.stringify(result));
check('keyup releases even while app dialog exists', result.dialogKeyupReleased, JSON.stringify(result));
check('text fields keep their keys', result.textInputIgnored, JSON.stringify(result));
check('blur clears held keys', result.blurCleared, JSON.stringify(result));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\ninput-capture probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

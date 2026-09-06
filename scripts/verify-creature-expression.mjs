import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const report = { setup: 'Posed expression fixtures, identical actor sizes and half-cell detail; not gameplay or navigation evidence.', errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
  page.on('pageerror', e => report.errors.push(String(e)));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page);
  report.poses = await page.evaluate(async () => {
    const { World } = await import('/src/sim/World.ts');
    const { Cell } = await import('/src/sim/CellType.ts');
    const { drawCreatureSprite } = await import('/src/render/sprites/CreatureArt.ts');
    const { createDefaultStatus } = await import('/src/entities/status.ts');
    const { ensureCreatureMind } = await import('/src/creatures/perception.ts');
    const { tickCreaturePose } = await import('/src/creatures/pose.ts');
    const { tickWeaverLocomotion } = await import('/src/entities/weaverLocomotion.ts');
    const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = 1040;
    canvas.style.cssText = 'position:fixed;inset:0;z-index:10000;width:1440px;height:1040px;image-rendering:pixelated';
    document.body.appendChild(canvas);
    const pen = canvas.getContext('2d'); pen.fillStyle = '#13272c'; pen.fillRect(0, 0, 1440, 1040);
    pen.fillStyle = '#d8dfcc'; pen.font = '20px system-ui';
    pen.fillText('Expression studies · posed state fixtures · same size in every column · 3.6× world scale', 24, 30);
    for (const [col, label] of ['At ease', 'Sensed attention', 'Species action', 'Wounded / defensive'].entries()) pen.fillText(label, col * 360 + 24, 66);
    const world = new World(400, 300), source = window.__game.ctx;
    const ctx = { ...source, world, state: { ...source.state, frameCount: 0 }, player: { ...source.player, x: -500, y: -500 } };
    const kinds = ['weaver', 'rillback', 'rootloper', 'bat', 'slime', 'colossus'], result = [];
    for (let row = 0; row < kinds.length; row++) for (let col = 0; col < 4; col++) {
      const kind = kinds[row], x = col * 100 + 50, y = row * 43 + 61;
      for (let fx = 0; fx < world.width; fx++) world.replaceCellAt(world.idx(fx, y + 1), Cell.Stone, 0);
      const e = { kind, x, y, fx: 0, fy: 0, vx: 0, vy: 0, hp: 50, maxHp: 50, flash: 0, timer: 0, attackCd: 0, bobPhase: .4,
        grounded: true, stride: .7, splat: 0, prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0, status: createDefaultStatus() };
      const mind = ensureCreatureMind(e, 777); mind.facing = 1;
      if (col === 1) { mind.confidence = .85; mind.intent = 'investigate'; mind.targetX = x + 70; mind.targetY = y - 45; e.alerted = true; }
      if (col === 2) {
        if (kind === 'weaver') e.weaverFeedT = 18;
        else if (kind === 'rillback') e.rillFeedT = 80;
        else if (kind === 'bat') e.sleeping = true;
        else if (kind === 'colossus') e.punching = 8;
        else e.windup = 12;
      }
      if (col === 3) { mind.intent = 'retreat'; mind.confidence = .8; mind.targetX = x + 50; mind.targetY = y - 9; e.hp = 15; e.fear = .95; e.rootPanic = 25; }
      for (let tick = 0; tick < 60; tick++) {
        ctx.state.frameCount = tick + 100;
        if (kind === 'weaver') tickWeaverLocomotion(ctx, e, source.enemyCtl.defs[kind], { move: 'hold', tx: x + 30, ty: y, urgency: 0, stance: col === 2 || col === 3 ? 'crouch' : 'normal' });
        tickCreaturePose(ctx, e);
      }
      pen.fillStyle = '#254044'; pen.fillRect(col * 360 + 20, y * 3.6 + 6, 320, 2);
      const out = { pixelStep: .5, setFinePx(px, py, r, g, b) {
        pen.fillStyle = `rgb(${Math.min(255, r * 255)},${Math.min(255, g * 255)},${Math.min(255, b * 255)})`;
        pen.fillRect(Math.round(px * 2) * 1.8, Math.round(py * 2) * 1.8, 1.8, 1.8);
      }, setPx() {}, addPx() {} };
      drawCreatureSprite(out, { sample: () => ({ r: 1, g: 1, b: 1 }) }, ctx, e);
      const action = { weaver: 'feeding', rillback: 'feeding', rootloper: 'lash poised', bat: 'roosting', slime: 'hop poised', colossus: 'punch' }[kind];
      pen.fillStyle = '#c5d1bc'; pen.font = '16px system-ui'; pen.fillText(`${kind}${col === 2 ? ` · ${action}` : ''}`, col * 360 + 24, y * 3.6 + 30);
      result.push({ kind, col, expression: e.expression });
    }
    return result;
  });
  assert.equal(report.poses.length, 24);
  await page.screenshot({ path: `${output}/creature-expressions.png` });
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/creature-expressions.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

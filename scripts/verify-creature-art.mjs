import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page);
  for (let sheet = 0; sheet < 2; sheet++) {
    const species = await page.evaluate(async sheet => {
      const { World } = await import('/src/sim/World.ts');
      const { Cell } = await import('/src/sim/CellType.ts');
      const { drawCreatureSprite } = await import('/src/render/sprites/CreatureArt.ts');
      const { createDefaultStatus } = await import('/src/entities/status.ts');
      const { ensureCreatureMind } = await import('/src/creatures/perception.ts');
      const { tickCreaturePose } = await import('/src/creatures/pose.ts');
      const { tickWeaverLocomotion } = await import('/src/entities/weaverLocomotion.ts');
      document.getElementById('creature-study')?.remove();
      const canvas = document.createElement('canvas'); canvas.id = 'creature-study'; canvas.width = 1280; canvas.height = 720;
      canvas.style.cssText = 'position:fixed;inset:0;z-index:10000;width:1280px;height:720px;image-rendering:pixelated';
      document.body.appendChild(canvas);
      const pen = canvas.getContext('2d'); pen.fillStyle = '#13272c'; pen.fillRect(0, 0, 1280, 720);
      pen.fillStyle = '#d8dfcc'; pen.font = '18px system-ui'; pen.fillText('Creature studies · game poses at 4× world scale · half-cell detail', 24, 30);
      const world = new World(320, 180), source = window.__game.ctx;
      const ctx = { ...source, world, state: { ...source.state, frameCount: 80 }, player: { ...source.player, x: -500, y: -500 } };
      for (const floor of [63, 143]) for (let x = 0; x < world.width; x++) world.replaceCellAt(world.idx(x, floor), Cell.Stone, 0);
      const kinds = ['weaver', 'rillback', 'rootloper', 'stonemaw', 'slime', 'acidslime', 'spitter', 'eggs', 'bat', 'imp', 'wisp', 'bomber', 'golem', 'mage', 'colossus', 'leviathan'].slice(sheet * 8, sheet * 8 + 8);
      const out = { pixelStep: .5, setFinePx(x, y, r, g, b) { pen.fillStyle = `rgb(${Math.min(255, r * 255)},${Math.min(255, g * 255)},${Math.min(255, b * 255)})`; pen.fillRect(Math.round(x * 2) * 2, Math.round(y * 2) * 2, 2, 2); }, setPx() {}, addPx() {} };
      for (let i = 0; i < kinds.length; i++) {
        const kind = kinds[i], col = i % 4, row = Math.floor(i / 4), x = col * 80 + 43, y = row * 80 + 62;
        const e = { kind, x, y, fx: 0, fy: 0, vx: 0, vy: 0, hp: 50, maxHp: 50, flash: 0, timer: 0, attackCd: 0, bobPhase: .4,
          grounded: true, stride: .7, splat: 0, prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0, status: createDefaultStatus() };
        ensureCreatureMind(e, 777).facing = 1;
        if (kind === 'leviathan') e.x += 8;
        for (let tick = 0; tick < 48; tick++) {
          ctx.state.frameCount = tick;
          if (kind === 'weaver') tickWeaverLocomotion(ctx, e, source.enemyCtl.defs[kind], { move: 'hold', tx: x + 30, ty: y, urgency: 0, stance: 'normal' });
          tickCreaturePose(ctx, e);
        }
        pen.fillStyle = '#233d3f'; pen.fillRect(col * 320 + 20, row * 320 + 255, 280, 3);
        drawCreatureSprite(out, { sample: () => ({ r: 1, g: 1, b: 1 }) }, ctx, e);
        pen.fillStyle = '#d2d9bf'; pen.font = '19px system-ui'; pen.fillText(kind, col * 320 + 22, row * 320 + 295);
      }
      return kinds;
    }, sheet);
    assert.equal(species.length, 8);
    await page.screenshot({ path: `${output}/creature-studies-${sheet + 1}.png` });
  }
  assert.deepEqual(errors, []);
} finally { writeFileSync(`${output}/creature-art.json`, JSON.stringify({ errors })); await browser.close(); }

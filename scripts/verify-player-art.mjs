// Deterministic production-resolution pose sheet for the playable alchemist.
// This renders the real sprite function, not a parallel illustration.
// Usage: node scripts/verify-player-art.mjs [url]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const output = 'verify-out/living-descent';
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await waitForConsoleApi(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page);
  const poses = await page.evaluate(async () => {
    const { drawPlayerSprite } = await import('/src/render/sprites/PlayerSprite.ts');
    const source = window.__game.ctx;
    document.getElementById('player-study')?.remove();
    const canvas = document.createElement('canvas');
    canvas.id = 'player-study'; canvas.width = 1280; canvas.height = 720;
    canvas.style.cssText = 'position:fixed;inset:0;z-index:10000;width:1280px;height:720px;image-rendering:pixelated';
    document.body.appendChild(canvas);
    const paint = canvas.getContext('2d');
    paint.fillStyle = '#13272c'; paint.fillRect(0, 0, canvas.width, canvas.height);
    paint.fillStyle = '#d8dfcc'; paint.font = '18px system-ui';
    paint.fillText('Playable alchemist · production sprite · 4× world scale · half-cell clusters', 24, 28);
    const variants = [
      ['idle', {}],
      ['run · contact', { _svx: 2.1, vx: 2.1, stridePhase: Math.PI / 2 }],
      ['run · passing', { _svx: 2.1, vx: 2.1, stridePhase: Math.PI }],
      ['jump rise', { grounded: false, vy: -3.2, stretchT: 7 }],
      ['fall', { grounded: false, vy: 3.1 }],
      ['hard landing', { landTimer: 8 }],
      ['crouch', { crouchT: 10 }],
      ['belly crawl', { crawling: true, crawlT: 10, crawlSlope: -.12, stridePhase: 1.1 }],
      ['wall climb', { climbing: true, climbT: 10, climbDir: 1, climbPhase: 1.4 }],
      ['lever pull', { pullT: 15, pullDir: 1 }],
      ['wand cast', { firing: true, recoilT: 5, aimAngle: -.55 }],
      ['hurt stagger', { staggerT: 8, staggerDir: -1 }],
    ];
    const out = {
      pixelStep: .5,
      setFinePx(x, y, r, g, b) {
        paint.fillStyle = `rgb(${Math.min(255, Math.max(0, r * 255))},${Math.min(255, Math.max(0, g * 255))},${Math.min(255, Math.max(0, b * 255))})`;
        paint.fillRect(Math.round(x * 2) * 2, Math.round(y * 2) * 2, 2, 2);
      },
      addFinePx(x, y, r, g, b) { this.setFinePx(x, y, Math.min(1, r + .15), Math.min(1, g + .15), Math.min(1, b + .15)); },
      setPx() {}, addPx() {},
    };
    for (let i = 0; i < variants.length; i++) {
      const [name, patch] = variants[i], col = i % 4, row = Math.floor(i / 4);
      const x = col * 80 + 40, y = row * 58 + 53;
      const player = { ...source.player, x, y, fx: 0, fy: 0, vx: 0, vy: 0, _svx: 0, _svy: 0,
        facing: 1, grounded: true, dead: false, invuln: 0, crawling: false, climbing: false, wallGrabT: 0, crouchT: 0,
        landTimer: 0, stretchT: 0, skidT: 0, staggerT: 0, kickT: 0, pullT: 0,
        firing: false, recoilT: 0, swapT: 0, bloodStain: 0, blinkTimer: 0, aimAngle: -.35,
        hat: { ...source.player.hat, ox: -1.1, oy: .2 }, robe: { ...source.player.robe, ox: -1.2 },
        status: { ...source.player.status }, ...patch };
      const ctx = { ...source, player, state: { ...source.state, mode: 'play', frameCount: 92, reduceFlashes: false },
        input: { ...source.input, bombCharge: -1 }, physics: { ...source.physics, entityFree: () => true },
        spells: { ...source.spells, wandTip: () => ({ x: player.x + Math.cos(player.aimAngle) * 11,
          y: player.y - 8 + Math.sin(player.aimAngle) * 11 }) } };
      paint.fillStyle = '#203b3d'; paint.fillRect(col * 320 + 20, row * 232 + 205, 280, 3);
      drawPlayerSprite(out, { sample: () => ({ r: 1, g: 1, b: 1 }) }, ctx);
      paint.fillStyle = '#d2d9bf'; paint.font = '18px system-ui'; paint.fillText(name, col * 320 + 22, row * 232 + 227);
    }
    return variants.map(([name]) => name);
  });
  assert.equal(poses.length, 12);
  await page.screenshot({ path: `${output}/player-pose-sheet.png` });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(`${output}/player-art.json`, JSON.stringify({ errors }, null, 2));
  await browser.close();
}

// In-game enemy look probe: carves a lit arena inside a real level, spawns the
// roster in small groups, and captures the real composed frame (terrain,
// lighting, bloom) plus nearest-neighbour zoom crops of every creature.
// Usage: node scripts/shot-enemies.mjs [url] [--level d2] [--kinds a,b] [--zoom 2] [--out dir] [--tag name]
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const level = opt('level', 'physics-test');
const zoom = Number(opt('zoom', '2'));
const out = opt('out', 'verify-out/enemy-look');
const tag = opt('tag', 'current');
const ALL = ['slime', 'acidslime', 'bomber', 'eggs', 'spitter', 'bat', 'imp', 'wisp', 'mage', 'golem', 'weaver', 'rootloper', 'stonemaw', 'rillback', 'leviathan', 'colossus'];
const kinds = opt('kinds', ALL.join(',')).split(',');
const GROUP = Number(opt('group', '3'));
mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await waitForConsoleApi(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, `run test --level ${level} --world campaign-level --seed 777 --loadout fresh`);
  await waitForRunReady(page);
  await page.waitForTimeout(3200); // let the settled findability repair run before we carve
  const shots = [];
  for (let g = 0; g < kinds.length; g += GROUP) {
    const group = kinds.slice(g, g + GROUP);
    const info = await page.evaluate(({ group, zoom }) => {
      const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
      ctx.enemies.length = 0;
      if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0; // parked: the arena is ours
      window.__arena ??= { cx: Math.max(260, Math.min(w.width - 260, Math.floor(p.x))), floor: Math.max(170, Math.min(w.height - 30, Math.floor(p.y))) };
      const { cx, floor } = window.__arena;
      const aquatic = group.some(k => k === 'rillback' || k === 'leviathan');
      // Arena: open room, stone floor + ceiling, a water trough for swimmers.
      for (let y = floor - 150; y <= floor + 8; y++) for (let x = cx - 240; x <= cx + 240; x++) {
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        const wall = y > floor || y < floor - 144 || x < cx - 232 || x > cx + 232;
        const pool = aquatic && !wall && y > floor - 34 && x > cx - 120 && x < cx + 200;
        w.replaceCellAt(i, wall ? 12 : pool ? 2 : 0, wall ? 0x565d63 + ((x * 7 + y * 13) % 5) * 0x030303 : pool ? 0x2a5f8a : 0);
      }
      // Two pillars for wall/ceiling crawlers to use.
      for (let y = floor - 144; y <= floor; y++) for (let x = cx + 205; x <= cx + 232; x++) w.replaceCellAt(w.idx(x, y), 12, 0x565d63);
      p.x = cx - 200; p.y = floor; p.vx = 0; p.vy = 0; p.hp = p.maxHp = 9999;
      const spawned = [];
      group.forEach((kind, i) => {
        const x = cx - 110 + i * 120;
        const fly = kind === 'bat' || kind === 'imp' || kind === 'wisp' || kind === 'mage';
        const swim = kind === 'rillback' || kind === 'leviathan';
        const y = fly ? floor - 50 : swim ? floor - 8 : floor;
        const e = ctx.enemyCtl.spawn(kind, x, y, { exact: false });
        if (e) spawned.push({ kind, x: e.x, y: e.y });
      });
      ctx.camera.zoomLock = zoom;
      ctx.camera.actionFocus = { x: cx + 10, y: floor - 40, zoom };
      return { cx, floor, spawned };
    }, { group, zoom });
    await page.waitForTimeout(1600);
    for (let frame = 0; frame < 2; frame++) {
      const file = `${out}/${tag}-${group.join('-')}-${frame}.png`;
      await page.locator('#canvas-holder > canvas').first().screenshot({ path: file });
      shots.push(file);
      // Crops around each creature, upscaled nearest-neighbour so pixels read.
      const view = await page.evaluate(() => {
        const c = window.__game.ctx.camera;
        return { rx: c.renderX, ry: c.renderY, zoom: c.zoom, x: c.x, y: c.y };
      });
      const meta = await page.evaluate(() => window.__game.ctx.enemies.map(e => ({ kind: e.kind, x: e.x, y: e.y })));
      writeFileSync(`${out}/${tag}-${group.join('-')}-${frame}.json`, JSON.stringify({ info, view, meta }, null, 1));
      await page.waitForTimeout(700);
    }
  }
  console.log(JSON.stringify({ shots, errors }, null, 1));
} finally {
  await browser.close();
}

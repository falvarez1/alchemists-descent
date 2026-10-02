// A contact sheet of the whole roster in the real game: each fighter standing in the carved arena (idle), then a
// moment after its tactical (Z), then after its ultimate (T), cropped around the figure. For the eye.
// Usage: node scripts/shot-fighter-roster.mjs [url] [--only id,id] [--zoom 3]
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { boot, tick, view } from './fighter-probe.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const only = opt('only', '');
const zoom = Number(opt('zoom', '3'));
mkdirSync('verify-out/fighters/roster', { recursive: true });

const ids = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne']
  .filter((i) => !only || only.split(',').includes(i));
const W = 320, H = 210, UP = 3;
const tiles = [];
for (const id of ids) {
  const { page, finish } = await boot(url, { fighter: id, viewport: { width: 1400, height: 860 } });
  await page.evaluate((z) => {
    const c = window.__fp.ctx;
    // two foes in front of the fighter, so the abilities have something to act on
    window.__fp.spawn('slime', 60);
    window.__fp.spawn('golem', 110);
    window.__fp.aimAt(c.player.x + 80, c.player.y - 9);
    if (c.camera) c.camera.zoom = z;
  }, zoom);
  await page.waitForTimeout(3200); // the floor's title card fades on wall time
  await tick(page, 40);
  const clip = { x: 700 - W / 2, y: 430 - H * 0.66, width: W, height: H };
  const shotAt = async (tag) => { const p = `verify-out/fighters/roster/${id}-${tag}.png`; const raw = await page.screenshot({ clip }); await sharp(raw).resize(W * UP, H * UP, { kernel: 'nearest' }).toFile(p); return p; };
  const idle = await shotAt('idle');
  await page.keyboard.down('KeyZ'); await tick(page, 2); await page.keyboard.up('KeyZ'); await tick(page, 14);
  const z = await shotAt('z');
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 2);
  await page.keyboard.down('KeyT'); await tick(page, 2); await page.keyboard.up('KeyT'); await tick(page, 22);
  const t = await shotAt('t');
  const v = await view(page);
  console.log(id, 'Z', v.tactical.usedAt >= 0 ? 'fired' : 'refused', 'T', v.ultimate.usedAt >= 0 ? 'fired' : 'refused');
  tiles.push([id, idle, z, t]);
  await finish();
}

const rows = tiles.length;
const sheet = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < 3; c++) sheet.push({ input: tiles[r][c + 1], left: c * (W * UP + 4), top: r * (H * UP + 4) });
await sharp({ create: { width: 3 * (W * UP + 4), height: rows * (H * UP + 4), channels: 3, background: '#000' } }).composite(sheet).png().toFile('verify-out/fighters/roster/sheet.png');
console.log('sheet: verify-out/fighters/roster/sheet.png');

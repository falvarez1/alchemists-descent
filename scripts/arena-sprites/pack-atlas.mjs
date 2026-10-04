// Pack a fighter's cut sprite frames (one or more cut-sheet.mjs output dirs) into the runtime atlas:
//   public/assets/arena/fighters/<id>/sprites.png + sprites.json
// The JSON maps a frame name to [x, y, w, h, ax, ay]: its rectangle in the atlas, and the anchor pixel (torso column, lowest
// solid row) that the runtime pins to the body's centre-bottom. Frames are drawn facing right; the runtime mirrors them.
//
// Usage: node scripts/arena-sprites/pack-atlas.mjs <fighterId> <cutDir> [<cutDir> ...] [--pick name=dir/file.png ...]
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const id = args[0];
const dirs = args.slice(1).filter(a => !a.startsWith('--') && !a.includes('='));
const frames = new Map();
for (const dir of dirs) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  // Later directories override earlier ones (a re-cut or a better variant of the same pose).
  for (const [name, f] of Object.entries(manifest.frames)) frames.set(name, { ...f, path: join(dir, f.file) });
}
const list = [...frames.entries()].sort((a, b) => b[1].h - a[1].h || a[0].localeCompare(b[0]));
// Shelf packing into a fixed-width atlas.
const W = 512; let x = 0, y = 0, shelf = 0;
const placed = [];
for (const [name, f] of list) {
  if (x + f.w > W) { x = 0; y += shelf + 1; shelf = 0; }
  placed.push({ name, f, x, y }); x += f.w + 1; shelf = Math.max(shelf, f.h);
}
const H = y + shelf;
const out = join('public/assets/arena/fighters', id);
mkdirSync(out, { recursive: true });
const composite = await Promise.all(placed.map(async p => ({ input: await sharp(p.f.path).png().toBuffer(), left: p.x, top: p.y })));
await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composite).png({ compressionLevel: 9 }).toFile(join(out, 'sprites.png'));
const json = { version: 1, step: 0.5, frames: Object.fromEntries(placed.map(p => [p.name, [p.x, p.y, p.f.w, p.f.h, p.f.ax, p.f.ay]])) };
writeFileSync(join(out, 'sprites.json'), JSON.stringify(json));
console.log(`${id}: ${placed.length} frames, atlas ${W}x${H}`);

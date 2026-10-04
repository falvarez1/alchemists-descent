// Unpack a fighter's packed atlas back into a cut directory (one PNG per frame + manifest.json), the format
// pack-atlas.mjs reads. Patching starts from what ships: unpack, then pack it again with a directory of replacement
// frames after it (later directories override earlier ones), so frames nobody touched come back bit for bit.
//
// Usage: node scripts/arena-sprites/unpack-atlas.mjs <fighterId> <outDir>
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [id, outDir] = process.argv.slice(2);
if (!id || !outDir) throw new Error('usage: unpack-atlas.mjs <fighterId> <outDir>');
const dir = join('public/assets/arena/fighters', id);
const json = JSON.parse(readFileSync(join(dir, 'sprites.json'), 'utf8'));
const atlas = await sharp(join(dir, 'sprites.png')).ensureAlpha().png().toBuffer();
mkdirSync(outDir, { recursive: true });
const frames = {};
for (const [name, [x, y, w, h, ax, ay]] of Object.entries(json.frames)) {
  await sharp(atlas).extract({ left: x, top: y, width: w, height: h }).png().toFile(join(outDir, `${name}.png`));
  frames[name] = { file: `${name}.png`, w, h, ax, ay, src: `atlas:${id}` };
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ sheet: `atlas:${id}`, frames }, null, 1));
console.log(`${id}: unpacked ${Object.keys(frames).length} frames to ${outDir}`);

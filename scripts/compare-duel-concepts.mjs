// Concept-versus-game sheets for the visual dogfood loop (docs/arena/platform-fighter/IMPLEMENTATION-PLAN.md).
// Captures the running game through the real lobby (scripts/shot-duel.mjs), composes the fighter roster straight from the
// atlases, and lays each approved concept beside the matching capture: docs/arena/platform-fighter/evidence/fidelity/.
// Usage: node scripts/compare-duel-concepts.mjs [url] [--skip-capture]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://127.0.0.1:5241/';
const docs = 'docs/arena/platform-fighter', out = `${docs}/evidence/fidelity`, concepts = `${docs}/concepts`;
mkdirSync(out, { recursive: true });

const shot = (stage, p1, p2, shots, tag) => execFileSync('node', ['scripts/shot-duel.mjs', url, '--stage', stage, '--p1', p1, '--p2', p2,
  '--shots', shots, '--out', out, '--tag', tag, '--live', '6000'], { stdio: 'inherit' });
if (!args.includes('--skip-capture')) {
  shot('foundry', 'ilyra-voss', 'brann-rook', 'close,mid,wide,live', 'foundry');
  for (const stage of ['kiln', 'cistern', 'gallery']) shot(stage, 'ilyra-voss', 'mara-quell', 'wide', stage);
}

// The roster: every fighter's idle and its four attack roles, from the atlases the game draws.
const ROSTER = ['ilyra-voss', 'brann-rook', 'mara-quell', 'sable-fen', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
const POSES = ['idle0', 'opener_strike', 'launcher_strike', 'aerial_strike', 'finisher_strike', 'dodge', 'ledge_hang'];
{
  const Z = 3, cw = 56, ch = 54, comp = [];
  for (const [r, id] of ROSTER.entries()) {
    const json = JSON.parse(readFileSync(`public/assets/arena/fighters/${id}/sprites.json`, 'utf8'));
    const atlas = await sharp(`public/assets/arena/fighters/${id}/sprites.png`).png().toBuffer();
    for (const [c, pose] of POSES.entries()) {
      const f = json.frames[pose]; if (!f) continue;
      const [x, y, w, h, ax, ay] = f;
      const piece = await sharp(atlas).extract({ left: x, top: y, width: w, height: h }).resize(w * Z, h * Z, { kernel: 'nearest' }).png().toBuffer();
      comp.push({ input: piece, left: Math.max(0, Math.round((c * cw + cw / 2 - ax) * Z)), top: Math.max(0, Math.round((r * ch + ch - 5 - ay) * Z)) });
    }
  }
  await sharp({ create: { width: POSES.length * cw * Z, height: ROSTER.length * ch * Z, channels: 4, background: '#142334' } })
    .composite(comp).png().toFile(`${out}/roster-sprites.png`);
}

/** Two images side by side at a common height, each with a caption band. */
async function pair(file, left, right, leftLabel, rightLabel, height = 540) {
  const fit = async (src, extract) => {
    let img = sharp(src); if (extract) img = img.extract(extract);
    return img.resize({ height }).png().toBuffer({ resolveWithObject: true });
  };
  const a = await fit(left.src, left.extract), b = await fit(right.src, right.extract), band = 34;
  const label = (text, w) => Buffer.from(`<svg width="${w}" height="${band}"><rect width="100%" height="100%" fill="#0c141d"/><text x="14" y="23" font-family="Georgia, serif" font-size="17" fill="#e8dcc0">${text}</text></svg>`);
  const W = a.info.width + b.info.width + 12;
  await sharp({ create: { width: W, height: height + band, channels: 3, background: '#0c141d' } }).composite([
    { input: label(leftLabel, a.info.width), left: 0, top: 0 }, { input: a.data, left: 0, top: band },
    { input: label(rightLabel, b.info.width), left: a.info.width + 12, top: 0 }, { input: b.data, left: a.info.width + 12, top: band },
  ]).png().toFile(`${out}/${file}`);
}


/** A panoramic concept panel above the 16:9 capture, both at full width (side by side would shrink the capture). */
async function stack(file, top, bottom, topLabel, bottomLabel, width = 1280) {
  const fit = async (src, extract) => { let img = sharp(src); if (extract) img = img.extract(extract); return img.resize({ width }).png().toBuffer({ resolveWithObject: true }); };
  const a = await fit(top.src, top.extract), b = await fit(bottom.src, bottom.extract), band = 34;
  const label = (text) => Buffer.from(`<svg width="${width}" height="${band}"><rect width="100%" height="100%" fill="#0c141d"/><text x="14" y="23" font-family="Georgia, serif" font-size="17" fill="#e8dcc0">${text}</text></svg>`);
  await sharp({ create: { width, height: a.info.height + b.info.height + band * 2 + 12, channels: 3, background: '#0c141d' } }).composite([
    { input: label(topLabel), left: 0, top: 0 }, { input: a.data, left: 0, top: band },
    { input: label(bottomLabel), left: 0, top: band + a.info.height + 12 }, { input: b.data, left: 0, top: band * 2 + a.info.height + 12 },
  ]).png().toFile(`${out}/${file}`);
}

const game = (name) => `${out}/${name}.png`;
await pair('compare-foundry.png', { src: `${concepts}/foundry-match.png` }, { src: game('foundry-mid') }, 'Concept · foundry-match.png', 'Game · the Foundry, mid framing');
// camera-direction.png panels: close (top), spread out (middle).
await stack('compare-close.png', { src: `${concepts}/camera-direction.png`, extract: { left: 0, top: 0, width: 1672, height: 280 } }, { src: game('foundry-close') },
  'Concept · close combat (camera-direction.png)', 'Game · close framing, chosen by the camera rig');
await stack('compare-wide.png', { src: `${concepts}/camera-direction.png`, extract: { left: 0, top: 310, width: 1672, height: 270 } }, { src: game('foundry-wide') },
  'Concept · spread out (camera-direction.png)', 'Game · wide framing, chosen by the camera rig');
const quad = { foundry: [0, 0], kiln: [838, 0], cistern: [0, 474], gallery: [838, 474] };
for (const stage of ['kiln', 'cistern', 'gallery']) {
  const [x, y] = quad[stage];
  await pair(`compare-${stage}.png`, { src: `${concepts}/stages.png`, extract: { left: x, top: y, width: 834, height: 467 } }, { src: game(`${stage}-wide`) },
    `Concept · stages.png, the ${stage[0].toUpperCase()}${stage.slice(1)}`, `Game · the ${stage[0].toUpperCase()}${stage.slice(1)}`);
}
await pair('compare-attacks.png', { src: `${concepts}/core-attacks.png` }, { src: `${out}/roster-sprites.png` }, 'Concept · core-attacks.png', 'Game · every fighter\'s atlas: idle, opener, launcher, aerial, finisher, dodge, ledge', 640);
for (const [file, concept, extract, shotFile, l, r] of [
  ['compare-lobby.png', 'local-versus.png', { left: 0, top: 0, width: 1536, height: 525 }, `${docs}/evidence/versus-lobby-desktop.png`, 'Concept · lobby and stage choice', 'Game · Duel lobby'],
  ['compare-results.png', 'local-versus.png', { left: 850, top: 525, width: 686, height: 445 }, `${docs}/evidence/versus-results.png`, 'Concept · results', 'Game · results'],
]) if (existsSync(shotFile)) await pair(file, { src: `${concepts}/${concept}`, extract }, { src: shotFile }, l, r, 420);
console.log(`fidelity sheets written to ${out}`);

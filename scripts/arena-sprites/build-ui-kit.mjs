// Build the Foundry UI kit (docs/arena/platform-fighter/UI-KIT.md): every interface piece is cut from the generated kit
// sheets in docs/arena/platform-fighter/ui-sources/, keyed, brought to the kit's art-pixel size, frames and plates
// regularised into seamless 9-slices, tiles made seamless, and written to public/assets/arena/ui/ with kit.json.
//
// One display rule for every piece: 1 art pixel = SCALE CSS pixels (image-rendering: pixelated), so a panel, a button
// and a bead share the sprites' chunky pixel. Each piece's factor (source pixels per art pixel) is chosen so the piece
// has the right size at that scale.
//
// Usage: node scripts/arena-sprites/build-ui-kit.mjs [--raw <dir>]   (--raw: only the plain cuts, to choose slices)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSheet, tightRect, cutPiece, regularise, seamlessTile, crop, savePng, periodicStrip, columnHeights, difference, lift, flatten } from './ui-kit-lib.mjs';

const SRC = 'docs/arena/platform-fighter/ui-sources', OUT = 'public/assets/arena/ui', SCALE = 2;
const args = process.argv.slice(2);
const rawDir = args.includes('--raw') ? args[args.indexOf('--raw') + 1] : null;
const dir = rawDir ?? OUT;
mkdirSync(dir, { recursive: true });

const sheets = {};
const sheet = async name => (sheets[name] ??= await loadSheet(join(SRC, `${name}.webp`)));

// Every piece: sheet, loose rect (tightened to the drawn pixels), factor or size.
const PIECES = {
  'frame-panel':       { sheet: 'frames', rect: [44, 116, 1247, 1003], factor: 5 },
  'frame-card':        { sheet: 'frames', rect: [1304, 136, 1999, 427], factor: 4 },
  'frame-card-teal':   { sheet: 'frames', rect: [1304, 472, 1999, 763], factor: 4 },
  'frame-slot':        { sheet: 'frames', rect: [1304, 836, 1999, 979], factor: 4 },
  'frame-stage':       { sheet: 'pieces', rect: [56, 64, 703, 1147], factor: 7 },
  'band':              { sheet: 'pieces', rect: [784, 72, 1983, 215], factor: 4 },
  'divider':           { sheet: 'pieces', rect: [760, 348, 1995, 415], factor: 6 },
  'keycap':            { sheet: 'pieces', rect: [988, 572, 1175, 743], height: 17 },
  'keycap-wide':       { sheet: 'pieces', rect: [1332, 580, 1787, 743], height: 17 },
  'or-gear':           { sheet: 'pieces', rect: [784, 1016, 1019, 1271], factor: 8 },
  'arrow-left':        { sheet: 'pieces', rect: [1120, 1048, 1227, 1239], size: [9, 16] },
  'arrow-right':       { sheet: 'pieces', rect: [1340, 1048, 1447, 1239], size: [9, 16] },
  'arrow-left-hot':    { sheet: 'pieces', rect: [1516, 1048, 1623, 1239], size: [9, 16] },
  'arrow-right-hot':   { sheet: 'pieces', rect: [1740, 1048, 1847, 1239], size: [9, 16] },
  'button-copper':         { sheet: 'buttons', rect: [40, 292, 659, 495], size: [100, 34] },
  'button-copper-hot':     { sheet: 'buttons', rect: [728, 292, 1331, 495], size: [100, 34] },
  'button-copper-pressed': { sheet: 'buttons', rect: [1396, 292, 1999, 495], size: [100, 34] },
  'button-iron':           { sheet: 'buttons', rect: [40, 756, 659, 959], size: [100, 34] },
  'button-iron-hot':       { sheet: 'buttons', rect: [728, 756, 1331, 959], size: [100, 34] },
  'button-iron-pressed':   { sheet: 'buttons', rect: [1396, 756, 1999, 959], size: [100, 34] },
  'chain':             { sheet: 'ornaments', rect: [908, 52, 987, 647], factor: 8 },
  'lantern':           { sheet: 'ornaments', rect: [1412, 52, 1647, 619], size: [24, 57] },
  'lantern-unlit':     { sheet: 'ornaments', rect: [1720, 52, 1951, 619], size: [24, 57] },
  'chain-mount':       { sheet: 'ornaments', rect: [1088, 196, 1283, 523], factor: 8 },
  'gear-crest':        { sheet: 'ornaments', rect: [72, 232, 779, 479], factor: 9 },
  'vs-medallion':      { sheet: 'ornaments', rect: [284, 612, 887, 1195], factor: 8 },
  'seal-copper':       { sheet: 'ornaments', rect: [1108, 688, 1311, 891], size: [19, 19] },
  'seal-teal':         { sheet: 'ornaments', rect: [1376, 688, 1579, 891], size: [19, 19] },
  'bead-copper':       { sheet: 'ornaments', rect: [1128, 964, 1251, 1087], size: [11, 11] },
  'bead-copper-spent': { sheet: 'ornaments', rect: [1468, 964, 1591, 1087], size: [11, 11] },
  'bead-teal':         { sheet: 'ornaments', rect: [1128, 1136, 1251, 1259], size: [11, 11] },
  'bead-teal-spent':   { sheet: 'ornaments', rect: [1468, 1136, 1591, 1259], size: [11, 11] },
  'timer-sign':        { sheet: 'signs', rect: [452, 0, 1575, 519], factor: 8 },
  'banner-plate':      { sheet: 'signs', rect: [24, 604, 2023, 1291], factor: 6 },
  'word-fight':        { sheet: 'words', rect: [72, 96, 991, 331], factor: 3 },
  'word-game':         { sheet: 'words', rect: [1108, 100, 1999, 331], factor: 3 },
  'word-time':         { sheet: 'words', rect: [112, 508, 979, 743], factor: 3 },
  'word-vs':           { sheet: 'words', rect: [1316, 508, 1791, 755], factor: 3 },
  'word-3':            { sheet: 'words', rect: [280, 912, 567, 1231], factor: 3 },
  'word-2':            { sheet: 'words', rect: [912, 908, 1179, 1227], factor: 3 },
  'word-1':            { sheet: 'words', rect: [1556, 912, 1751, 1227], factor: 3 },
};

const cuts = {};
for (const [name, p] of Object.entries(PIECES)) {
  const s = await sheet(p.sheet), rect = tightRect(s, p.rect);
  const rw = rect[2] - rect[0] + 1, rh = rect[3] - rect[1] + 1;
  const size = p.size ?? (p.height ? [Math.round(rw * p.height / rh), p.height] : null);
  cuts[name] = cutPiece(s, rect, { factor: p.factor ?? 4, size });
  if (rawDir) await savePng(cuts[name], join(dir, `${name}.png`));
}
if (rawDir) {
  console.log(Object.entries(cuts).map(([n, c]) => `${n} ${c.w}x${c.h}`).join('\n'));
  process.exit(0);
}

// ---- assemble the kit ----
const kit = {
  version: 1,
  scale: SCALE,
  note: 'Art pixels: show every piece at an integer CSS scale (kit.scale) with image-rendering: pixelated. 9-slice: ' +
    'border-image-slice = slice (art px), border-width = slice x scale, border-image-repeat as given (each edge is one ' +
    'seamless period). Hollow frames: put a fill tile behind, reaching band x scale in from the outer edge.',
  pieces: {},
};
const put = async (name, img, meta) => {
  await savePng(img, join(OUT, `${name}.png`));
  kit.pieces[name] = { file: `${name}.png`, size: [img.w, img.h], ...meta };
};

// Hollow 9-slice frames: corners as drawn, each edge one seamless period, the centre empty.
const FRAMES = {
  'frame-panel':     { slice: [30, 32, 30, 32], periodX: [26, 44], periodY: [22, 40], use: 'lobby, pause, results and connect panels' },
  'frame-card':      { slice: [13, 13, 13, 13], periodX: [10, 40], periodY: [8, 30], use: 'seat cards, HUD cards (P1, copper)' },
  'frame-card-teal': { slice: [13, 13, 13, 13], periodX: [10, 40], periodY: [8, 30], use: 'seat cards, HUD cards (P2, teal)' },
  'frame-slot':      { slice: [7, 7, 7, 7], periodX: [8, 40], periodY: [4, 16], use: 'room code, value boxes, rules bar' },
  'frame-stage':     { slice: [12, 12, 34, 12], periodX: [8, 30], periodY: [10, 40], use: 'stage tile; the bottom slice is the label plate (the name sits on it)' },
};
for (const [name, f] of Object.entries(FRAMES)) {
  const r = regularise(cuts[name], f.slice, { periodX: f.periodX, periodY: f.periodY });
  await put(name, r, { kind: 'frame', slice: r.slice, band: r.band, fill: false, repeat: 'round', period: [r.periodX, r.periodY], use: f.use });
}

// Filled, fixed-height plates: buttons (the three states share slice and period), the wide keycap, the cut-in band.
const PLATES = {
  'button-copper': { slice: [8, 20, 8, 20], periodX: [6, 30], states: ['button-copper', 'button-copper-hot', 'button-copper-pressed'], use: 'primary: READY, REMATCH, HOST A MATCH' },
  'button-iron':   { slice: [8, 20, 8, 20], periodX: [6, 30], states: ['button-iron', 'button-iron-hot', 'button-iron-pressed'], use: 'secondary: CHANGE FIGHTERS, JOIN MATCH, menu rows' },
  'keycap-wide':   { slice: [5, 5, 5, 5], periodX: [4, 20], states: ['keycap-wide'], use: 'key glyph frame for words (Esc, Enter, Space)' },
  'band':          { slice: [8, 18, 8, 18], periodX: [48, 120], states: ['band'], use: 'the super cut-in band (horizontal)' },
};
for (const [name, p] of Object.entries(PLATES)) {
  const first = regularise(cuts[p.states[0]], p.slice, { periodX: p.periodX, fill: true, keepY: true });
  const states = {};
  for (const [k, s] of p.states.entries()) {
    const r = k === 0 ? first : regularise(cuts[s], p.slice, { periodX: [first.periodX, first.periodX], fill: true, keepY: true });
    await savePng(r, join(OUT, `${s}.png`));
    states[['normal', 'hot', 'pressed'][k]] = `${s}.png`;
  }
  kit.pieces[name] = {
    file: `${p.states[0]}.png`, size: [first.w, first.h], kind: 'plate', slice: first.slice, fill: true, repeat: 'round stretch',
    period: [first.periodX, null], states, height: 'fixed: show it size[1] x scale tall', use: p.use,
  };
}

// The divider in parts (and whole): left cap, a repeatable line, the centre diamond, right cap.
{
  const d = cuts.divider, hs = columnHeights(d);
  const line = Math.min(...hs.slice(Math.floor(d.w * 0.2), Math.floor(d.w * 0.4)));
  // A cap is the run of columns at an end that stand taller than the line.
  let capL = Math.floor(d.w * 0.1); while (capL > 0 && hs[capL - 1] <= line) capL--;
  let capR = Math.ceil(d.w * 0.9); while (capR < d.w - 1 && hs[capR + 1] <= line) capR++;
  const mid = d.w >> 1; let dl = mid, dr = mid;
  while (dl > 0 && hs[dl - 1] > line) dl--;
  while (dr < d.w - 1 && hs[dr + 1] > line) dr++;
  const stretch = periodicStrip(crop(d, capL + 2, 0, dl - capL - 4, d.h), 'x', [8, 32]);
  await put('divider', d, { kind: 'image', use: 'heading rule, whole, as drawn' });
  await put('divider-cap-left', crop(d, 0, 0, capL, d.h), { kind: 'image', use: 'divider: left end' });
  await put('divider-line', stretch, { kind: 'tile', repeat: 'repeat-x', use: 'divider: the line, repeat across' });
  await put('divider-diamond', crop(d, dl, 0, dr - dl + 1, d.h), { kind: 'image', use: 'divider: centre diamond' });
  await put('divider-cap-right', crop(d, capR + 1, 0, d.w - capR - 1, d.h), { kind: 'image', use: 'divider: right end' });
}

// The chain: one seamless repeat (repeat-y), and its wall mount.
await put('chain', periodicStrip(cuts.chain, 'y', [14, 40]), { kind: 'tile', repeat: 'repeat-y', use: 'hanging chain, repeat down from the mount' });
await put('chain-mount', cuts['chain-mount'], { kind: 'image', use: 'wall bracket the chain hangs from (ring at the bottom)' });

// Lantern: lit, unlit, and the glow alone (lay it over the unlit lantern and animate its opacity to flicker).
await put('lantern', cuts.lantern, { kind: 'image', states: { lit: 'lantern.png', unlit: 'lantern-unlit.png', glow: 'lantern-glow.png' }, use: 'hanging lantern; glow overlay for a CSS flicker' });
await savePng(cuts['lantern-unlit'], join(OUT, 'lantern-unlit.png'));
await savePng(difference(cuts.lantern, cuts['lantern-unlit']), join(OUT, 'lantern-glow.png'));

// Single images.
const IMAGES = {
  'keycap': 'single-letter key glyph frame (A, D, F)', 'or-gear': 'small gear medallion (the OR between HOST and JOIN)',
  'arrow-left': 'cycler arrow', 'arrow-right': 'cycler arrow', 'arrow-left-hot': 'cycler arrow, focused', 'arrow-right-hot': 'cycler arrow, focused',
  'gear-crest': 'top-centre crest on the big panels', 'vs-medallion': 'VS gear medallion (blank face: put word-vs on it)',
  'seal-copper': 'readiness seal, P1', 'seal-teal': 'readiness seal, P2',
  'bead-copper': 'stock bead, P1, lit', 'bead-copper-spent': 'stock bead, P1, spent', 'bead-teal': 'stock bead, P2, lit', 'bead-teal-spent': 'stock bead, P2, spent',
  'timer-sign': 'hanging timer sign with lantern mounts (blank face)', 'banner-plate': 'the plate behind FIGHT!, GAME!, TIME! (blank face)',
  'word-fight': 'FIGHT!', 'word-game': 'GAME!', 'word-time': 'TIME!', 'word-vs': 'VS', 'word-3': '3', 'word-2': '2', 'word-1': '1',
};
for (const [name, use] of Object.entries(IMAGES)) await put(name, cuts[name], { kind: name.startsWith('word-') ? 'word' : 'image', use });
kit.pieces['arrow-left'].states = { normal: 'arrow-left.png', hot: 'arrow-left-hot.png' };
kit.pieces['arrow-right'].states = { normal: 'arrow-right.png', hot: 'arrow-right-hot.png' };

// Fills and text textures: seamless tiles from the texture sheet (quadrants: dark iron, worn iron, copper, iron).
{
  const t = await sheet('textures');
  const opaque = (rect, size) => cutPiece(t, rect, { size, colors: 48, opaque: true });
  // Dark iron: one rivet row per tile (the rows sit about 404 source pixels, 101 art pixels, apart).
  // Tiles are wide (192 art px) so a panel interior shows little repetition; the extra crop is the cross-fade. The
  // sheet's broad lighting is flattened out, or it would stripe the panel once tiled.
  const iron = opaque([60, 237, 60 + 4 * 216 - 1, 237 + 4 * 125 - 1], [216, 125]);
  await put('fill-iron', flatten(seamlessTile(iron, [192, 101], 24), 24), { kind: 'tile', repeat: 'repeat', use: 'dark iron plate: panel interiors' });
  const worn = opaque([1060, 60, 1060 + 4 * 224 - 1, 60 + 4 * 224 - 1], [224, 224]);
  await put('fill-worn', flatten(seamlessTile(worn, [192, 192], 32), 32), { kind: 'tile', repeat: 'repeat', use: 'lighter worn iron: slots, value boxes' });
  // Text textures keep the whole top-to-bottom gradient and repeat only across; they are lifted (the sheet's metal is
  // shaded for a plate, too dark to read as lettering on dark iron).
  const copper = opaque([60, 1010, 60 + 6 * 112 - 1, 2030], [112, 170]);
  await put('text-copper', lift(seamlessTile(copper, [96, 170], 16, { y: false }), 0.75, 1.15), { kind: 'texture', repeat: 'repeat-x', use: 'cast copper for background-clip: text (background-size: auto 100%)' });
  const ironT = opaque([1060, 1010, 1060 + 6 * 112 - 1, 2030], [112, 170]);
  await put('text-iron', lift(seamlessTile(ironT, [96, 170], 16, { y: false }), 0.6, 1.4), { kind: 'texture', repeat: 'repeat-x', use: 'cast iron for background-clip: text (background-size: auto 100%)' });
}

// Every piece carries its recommended CSS scale and the CSS size it has at that scale (a 9-slice's natural size).
for (const p of Object.values(kit.pieces)) { p.scale = SCALE; p.css = p.size.map(v => v * SCALE); }

writeFileSync(join(OUT, 'kit.json'), JSON.stringify(kit, null, 1) + '\n');
console.log(Object.entries(kit.pieces).map(([n, p]) => `${n} ${p.size.join('x')}${p.slice ? ' slice ' + p.slice.join(',') : ''}` +
  `${p.band ? ' band ' + p.band.join(',') : ''}${p.period ? ' period ' + p.period.join(',') : ''}`).join('\n'));

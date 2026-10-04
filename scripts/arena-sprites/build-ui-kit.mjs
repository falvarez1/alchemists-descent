// Build the Foundry UI kit (docs/arena/platform-fighter/UI-KIT.md): every interface piece is cut from the generated kit
// sheets in docs/arena/platform-fighter/ui-sources/, keyed, brought to the kit's art-pixel size, frames and plates
// regularised into seamless 9-slices, tiles made seamless, and written to public/assets/arena/ui/ with kit.json.
//
// One display rule for every piece: 1 art pixel = SCALE CSS pixels (image-rendering: pixelated), so a panel, a button
// and a bead share the sprites' chunky pixel. Each piece's factor (source pixels per art pixel) is chosen so the piece
// has the right size at that scale.
//
// Usage: node scripts/arena-sprites/build-ui-kit.mjs [--raw <dir>]   (--raw: only the plain cuts, to choose slices)
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadSheet, tightRect, cutPiece, regularise, seamlessTile, crop, savePng, periodicStrip, columnHeights, difference, lift, flatten, transpose, holeRect } from './ui-kit-lib.mjs';

const SRC = 'docs/arena/platform-fighter/ui-sources', OUT = 'public/assets/arena/ui', SCALE = 2;
const args = process.argv.slice(2);
const rawDir = args.includes('--raw') ? args[args.indexOf('--raw') + 1] : null;
const dir = rawDir ?? OUT;
mkdirSync(dir, { recursive: true });

const sheets = {};
const sheet = async name => (sheets[name] ??= await loadSheet(join(SRC, `${name}.webp`)));

// Every piece: sheet, loose rect (tightened to the drawn pixels), factor or size.
const PIECES = {
  'panel-large':             { sheet: 'frames', rect: [44, 116, 1247, 1003], factor: 5 },
  'card':                    { sheet: 'frames', rect: [1304, 136, 1999, 427], factor: 4 },
  'card-teal':               { sheet: 'frames', rect: [1304, 472, 1999, 763], factor: 4 },
  'slot':                    { sheet: 'frames', rect: [1304, 836, 1999, 979], factor: 4 },
  'picture-frame':           { sheet: 'pieces', rect: [56, 64, 703, 1147], factor: 7 },
  'band':                    { sheet: 'pieces', rect: [784, 72, 1983, 215], factor: 4 },
  'divider':                 { sheet: 'pieces', rect: [760, 348, 1995, 415], factor: 6 },
  'keycap-square':           { sheet: 'pieces', rect: [988, 572, 1175, 743], height: 17 },
  'keycap':                  { sheet: 'pieces', rect: [1332, 580, 1787, 743], height: 17 },
  'gear-small':              { sheet: 'pieces', rect: [784, 1016, 1019, 1271], factor: 8 },
  'arrow-left':              { sheet: 'pieces', rect: [1120, 1048, 1227, 1239], size: [9, 16] },
  'arrow-right':             { sheet: 'pieces', rect: [1340, 1048, 1447, 1239], size: [9, 16] },
  'arrow-left-hot':          { sheet: 'pieces', rect: [1516, 1048, 1623, 1239], size: [9, 16] },
  'arrow-right-hot':         { sheet: 'pieces', rect: [1740, 1048, 1847, 1239], size: [9, 16] },
  'button-primary':          { sheet: 'buttons', rect: [40, 292, 659, 495], size: [100, 34] },
  'button-primary-hot':      { sheet: 'buttons', rect: [728, 292, 1331, 495], size: [100, 34] },
  'button-primary-pressed':  { sheet: 'buttons', rect: [1396, 292, 1999, 495], size: [100, 34] },
  'button-secondary':        { sheet: 'buttons', rect: [40, 756, 659, 959], size: [100, 34] },
  'button-secondary-hot':    { sheet: 'buttons', rect: [728, 756, 1331, 959], size: [100, 34] },
  'button-secondary-pressed':{ sheet: 'buttons', rect: [1396, 756, 1999, 959], size: [100, 34] },
  'chain':                   { sheet: 'ornaments', rect: [908, 52, 987, 647], factor: 8 },
  'lantern':                 { sheet: 'ornaments', rect: [1412, 52, 1647, 619], size: [24, 57] },
  'lantern-unlit':           { sheet: 'ornaments', rect: [1720, 52, 1951, 619], size: [24, 57] },
  'chain-mount':             { sheet: 'ornaments', rect: [1088, 196, 1283, 523], factor: 8 },
  'gear-crest':              { sheet: 'ornaments', rect: [72, 232, 779, 479], factor: 9 },
  'medallion':               { sheet: 'ornaments', rect: [284, 612, 887, 1195], factor: 8 },
  'seal':                    { sheet: 'ornaments', rect: [1108, 688, 1311, 891], size: [19, 19] },
  'seal-teal':               { sheet: 'ornaments', rect: [1376, 688, 1579, 891], size: [19, 19] },
  'bead':                    { sheet: 'ornaments', rect: [1128, 964, 1251, 1087], size: [11, 11] },
  'bead-spent':              { sheet: 'ornaments', rect: [1468, 964, 1591, 1087], size: [11, 11] },
  'bead-teal':               { sheet: 'ornaments', rect: [1128, 1136, 1251, 1259], size: [11, 11] },
  'bead-teal-spent':         { sheet: 'ornaments', rect: [1468, 1136, 1591, 1259], size: [11, 11] },
  'hanging-sign':            { sheet: 'signs', rect: [452, 0, 1575, 519], factor: 8 },
  'banner-plate':            { sheet: 'signs', rect: [24, 604, 2023, 1291], factor: 6 },
  'word-fight':              { sheet: 'words', rect: [72, 96, 991, 331], factor: 3 },
  'word-game':               { sheet: 'words', rect: [1108, 100, 1999, 331], factor: 3 },
  'word-time':               { sheet: 'words', rect: [112, 508, 979, 743], factor: 3 },
  'word-vs':                 { sheet: 'words', rect: [1316, 508, 1791, 755], factor: 3 },
  'word-3':                  { sheet: 'words', rect: [280, 912, 567, 1231], factor: 3 },
  'word-2':                  { sheet: 'words', rect: [912, 908, 1179, 1227], factor: 3 },
  'word-1':                  { sheet: 'words', rect: [1556, 912, 1751, 1227], factor: 3 },
  'slider-track':            { sheet: 'controls', rect: [168, 80, 1883, 219], factor: 8 },
  'slider-fill':             { sheet: 'controls', rect: [168, 312, 1399, 395], height: 7 },
  'slider-handle':           { sheet: 'controls', rect: [1464, 260, 1639, 447], factor: 8 },
  'slider-handle-hot':       { sheet: 'controls', rect: [1712, 260, 1883, 447], factor: 8 },
  'toggle':                  { sheet: 'controls', rect: [160, 508, 591, 663], size: [52, 19] },
  'toggle-on':               { sheet: 'controls', rect: [676, 508, 1083, 663], size: [52, 19] },
  'checkbox':                { sheet: 'controls', rect: [1400, 512, 1563, 675], factor: 8 },
  'checkbox-on':             { sheet: 'controls', rect: [1652, 512, 1819, 675], factor: 8 },
  'scroll-track':            { sheet: 'controls', rect: [348, 740, 471, 1287], factor: 10 },
  'scroll-thumb':            { sheet: 'controls', rect: [612, 872, 739, 1207], factor: 10 },
  'scroll-thumb-hot':        { sheet: 'controls', rect: [868, 872, 999, 1207], factor: 10 },
  'panel-small':             { sheet: 'menus', rect: [76, 160, 915, 1151], factor: 5 },
  'title-plate':             { sheet: 'menus', rect: [996, 136, 1943, 291], factor: 6 },
  'tab':                     { sheet: 'menus', rect: [996, 364, 1442, 535], factor: 7 },
  'tab-active':              { sheet: 'menus', rect: [1471, 364, 1955, 535], factor: 7 },
  'list-row':                { sheet: 'menus', rect: [996, 628, 1967, 743], factor: 4.5 },
  'list-row-hot':            { sheet: 'menus', rect: [996, 784, 1967, 903], factor: 4.5 },
  'tooltip':                 { sheet: 'menus', rect: [1236, 976, 1687, 1191], factor: 5 },
  'hud-card':                { sheet: 'hud', rect: [68, 108, 967, 443], factor: 4 },
  'hud-card-teal':           { sheet: 'hud', rect: [1076, 108, 1975, 443], factor: 4 },
  'meter':                   { sheet: 'hud', rect: [52, 612, 927, 719], factor: 7 },
  'meter-cell':              { sheet: 'hud', rect: [966, 612, 1081, 723], size: [11, 9] },
  'meter-cell-teal':         { sheet: 'hud', rect: [1113, 612, 1227, 723], size: [11, 9] },
  'nameplate':               { sheet: 'hud', rect: [1388, 600, 1915, 731], factor: 4 },
  'nameplate-hanging':       { sheet: 'hud', rect: [60, 824, 643, 1195], factor: 4 },
  'ribbon':                  { sheet: 'hud', rect: [716, 1072, 1999, 1195], factor: 5 },
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
  'panel-large':   { slice: [30, 32, 30, 32], periodX: [26, 44], periodY: [22, 40], use: 'large panel: menus, lobby, pause, results, connect, options' },
  'card':          { slice: [13, 13, 13, 13], periodX: [10, 40], periodY: [8, 30], use: 'card: player seats, info boxes (copper; the first player)' },
  'card-teal':     { slice: [13, 13, 13, 13], periodX: [10, 40], periodY: [8, 30], use: 'card, teal accent (the second player)' },
  'slot':          { slice: [7, 7, 7, 7], periodX: [8, 40], periodY: [4, 16], use: 'inset slot: text fields, value boxes, status and rules bars' },
  'panel-small':   { slice: [18, 18, 18, 18], periodX: [10, 40], periodY: [10, 40], use: 'small panel: dialogs, confirmations, sub-panels' },
  'picture-frame': { slice: [12, 12, 34, 12], periodX: [8, 30], periodY: [10, 40], use: 'picture tile with a caption plate (the bottom slice): stage, level or save tiles' },
};
for (const [name, f] of Object.entries(FRAMES)) {
  const r = regularise(cuts[name], f.slice, { periodX: f.periodX, periodY: f.periodY });
  await put(name, r, { kind: 'frame', slice: r.slice, band: r.band, fill: false, repeat: 'round', period: [r.periodX, r.periodY], use: f.use });
}

// Filled plates. Most keep their height and stretch across ('round stretch'); `both` ones stretch both ways (a
// tooltip grows with its text); `vertical` ones keep their width and stretch down (regularised transposed). A piece's
// states share its slice and are forced to its first state's period, so swapping states never shifts the pattern.
const PLATES = {
  'button-primary':    { slice: [8, 20, 8, 20], periodX: [6, 30], states: ['button-primary', 'button-primary-hot', 'button-primary-pressed'], use: 'primary button (hot copper): confirm, ready, host' },
  'button-secondary':  { slice: [8, 20, 8, 20], periodX: [6, 30], states: ['button-secondary', 'button-secondary-hot', 'button-secondary-pressed'], use: 'secondary button (dark iron): back, change, join' },
  'keycap':            { slice: [5, 5, 5, 5], periodX: [4, 20], states: ['keycap'], use: 'key glyph at any width (A, Esc, Enter, Space, Click)' },
  'band':              { slice: [8, 18, 8, 18], periodX: [48, 120], states: ['band'], use: 'long horizontal band: cut-ins, announcements' },
  'list-row':          { slice: [6, 22, 6, 22], periodX: [12, 60], states: ['list-row', 'list-row-hot'], use: 'menu list row; hot = the focused row (the menu cursor)' },
  'title-plate':       { slice: [6, 16, 6, 16], periodX: [12, 60], states: ['title-plate'], use: 'heading plate across the top edge of a panel or dialog' },
  'tab':               { slice: [6, 9, 6, 9], periodX: [8, 30], states: ['tab', 'tab-active'], stateNames: ['normal', 'active'], use: 'tab of a tab strip; active = the open tab' },
  'ribbon':            { slice: [6, 16, 6, 16], periodX: [8, 40], states: ['ribbon'], use: 'thin subtitle plate under a heading, status line' },
  'nameplate':         { slice: [8, 12, 8, 12], periodX: [8, 40], states: ['nameplate'], use: 'name plate, one or two lines (fighter name and title)' },
  'tooltip':           { slice: [7, 7, 7, 7], periodX: [24, 76], periodY: [16, 29], both: true, states: ['tooltip'], use: 'tooltip and toast plate, grows with its text' },
  'nameplate-hanging': { slice: [65, 22, 8, 22], periodX: [8, 40], states: ['nameplate-hanging'], use: 'sign hanging on two chains (the top slice holds the chains): footer prompts' },
  'hud-card':          { slice: [12, 18, 12, 82], periodX: [60, 120], states: ['hud-card'], use: 'player HUD card, portrait window at the left end (put the portrait behind it)' },
  'hud-card-teal':     { slice: [12, 82, 12, 18], periodX: [60, 120], states: ['hud-card-teal'], use: 'player HUD card, teal, portrait window at the right end' },
  'meter':             { slice: [5, 6, 5, 6], periodX: [10, 20], states: ['meter'], use: 'segmented meter housing, one cell per period: width = 12 + 13n art px; cell k inside at left 7 + 13k, top 3 (11 x 9)' },
  'slider-track':      { slice: [6, 9, 6, 9], periodX: [8, 40], states: ['slider-track'], use: 'slider groove; its inside is 4 art px down, 8 in from each end, 7 tall (where the fill goes)' },
  'slider-fill':       { slice: [2, 4, 2, 4], periodX: [8, 40], states: ['slider-fill'], use: 'slider fill (molten copper), 7 tall: laid in the groove at the value width' },
  'scroll-track':      { slice: [7, 4, 7, 4], periodY: [6, 30], vertical: true, states: ['scroll-track'], use: 'vertical scroll bar groove' },
};
for (const [name, p] of Object.entries(PLATES)) {
  const reg = (img, periodX, periodY) => {
    if (!p.vertical) return regularise(img, p.slice, { periodX, periodY, fill: true, keepY: !p.both });
    const [t, r, b, l] = p.slice, v = regularise(transpose(img), [l, b, r, t], { periodX: periodY, fill: true, keepY: true });
    return { ...transpose(v), slice: p.slice, periodX: null, periodY: v.periodX };
  };
  const first = reg(cuts[p.states[0]], p.periodX, p.periodY);
  const states = {};
  for (const [k, s] of p.states.entries()) {
    const r = k === 0 ? first : reg(cuts[s], first.periodX ? [first.periodX, first.periodX] : undefined, first.periodY ? [first.periodY, first.periodY] : undefined);
    await savePng(r, join(OUT, `${s}.png`));
    states[(p.stateNames ?? ['normal', 'hot', 'pressed'])[k]] = `${s}.png`;
  }
  kit.pieces[name] = {
    file: `${p.states[0]}.png`, size: [first.w, first.h], kind: 'plate', slice: first.slice, fill: true,
    repeat: p.both ? 'round' : p.vertical ? 'stretch round' : 'round stretch', period: [first.periodX, first.periodY], states,
    fixed: p.both ? null : p.vertical ? 'width: show it size[0] x scale wide' : 'height: show it size[1] x scale tall', use: p.use,
    _img: first,
  };
}

// The HUD cards' portrait windows, measured from the art, from the end the window sits at (it stays fixed there).
for (const name of ['hud-card', 'hud-card-teal']) {
  const p = kit.pieces[name], [x0, y0, x1, y1] = holeRect(p._img);
  const end = x0 < p.size[0] / 2 ? { left: x0 } : { right: p.size[0] - 1 - x1 };
  p.window = { ...end, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
for (const p of Object.values(kit.pieces)) delete p._img;

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
  'keycap-square': 'square key glyph, as drawn (the keycap 9-slice covers every width)', 'gear-small': 'small gear badge, blank centre (OR between two choices, a counter)',
  'arrow-left': 'value cycler arrow', 'arrow-right': 'value cycler arrow', 'arrow-left-hot': 'value cycler arrow, focused', 'arrow-right-hot': 'value cycler arrow, focused',
  'gear-crest': 'crest on the top edge of a large panel', 'medallion': 'large gear medallion, blank face (VS, a rank, an emblem)',
  'seal': 'check seal (ready, done), copper', 'seal-teal': 'check seal, teal',
  'bead': 'counter bead (stocks, lives), copper, lit', 'bead-spent': 'counter bead, copper, spent', 'bead-teal': 'counter bead, teal, lit', 'bead-teal-spent': 'counter bead, teal, spent',
  'hanging-sign': 'hanging sign with two lanterns, blank face (timer, score)', 'banner-plate': 'big banner plate, blank face (behind word art)',
  'slider-handle': 'slider handle (lay it over the track at the value)', 'toggle': 'on/off lever switch', 'checkbox': 'checkbox',
  'scroll-thumb': 'scroll bar thumb (fixed size)', 'meter-cell': 'meter cell fill, gold (one per filled cell)', 'meter-cell-teal': 'meter cell fill, teal (refilling)',
  'word-fight': 'FIGHT!', 'word-game': 'GAME!', 'word-time': 'TIME!', 'word-vs': 'VS', 'word-3': '3', 'word-2': '2', 'word-1': '1',
};
for (const [name, use] of Object.entries(IMAGES)) await put(name, cuts[name], { kind: name.startsWith('word-') ? 'word' : 'image', use });
kit.pieces['arrow-left'].states = { normal: 'arrow-left.png', hot: 'arrow-left-hot.png' };
kit.pieces['arrow-right'].states = { normal: 'arrow-right.png', hot: 'arrow-right-hot.png' };
for (const [name, states] of Object.entries({ 'slider-handle': ['normal', 'hot'], 'scroll-thumb': ['normal', 'hot'], 'toggle': ['off', 'on'], 'checkbox': ['off', 'on'] })) {
  const other = name + (states[1] === 'hot' ? '-hot' : '-on');
  await savePng(cuts[other], join(OUT, `${other}.png`));
  kit.pieces[name].states = { [states[0]]: `${name}.png`, [states[1]]: `${other}.png` };
}

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

// Drop PNGs no piece references any more (a renamed or retired piece), so the folder is exactly the kit.
const referenced = new Set(Object.values(kit.pieces).flatMap(p => [p.file, ...Object.values(p.states ?? {})]));
for (const f of readdirSync(OUT)) if (f.endsWith('.png') && !referenced.has(f)) rmSync(join(OUT, f));

writeFileSync(join(OUT, 'kit.json'), JSON.stringify(kit, null, 1) + '\n');
console.log(Object.entries(kit.pieces).map(([n, p]) => `${n} ${p.size.join('x')}${p.slice ? ' slice ' + p.slice.join(',') : ''}` +
  `${p.band ? ' band ' + p.band.join(',') : ''}${p.period ? ' period ' + p.period.join(',') : ''}`).join('\n'));

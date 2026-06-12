// Builds the three starter worldgen prefabs programmatically and writes them
// to src/world/prefabs/builtin/*.json (committed to the tree — the registry
// eager-imports them). Re-run after editing a layout below:
//   node scripts/gen-builtin-prefabs.mjs
//
// The terrain is composed honestly: walls are Wall/Stone cells, floors are
// open, door slabs are door OBJECTS (params w/h — they stamp metal at
// instantiation), pickups are pickup objects. Cell ids are the stable ABI
// from src/sim/CellType.ts (append-only forever).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const Cell = { Empty: 0, Wall: 3, Wood: 4, Stone: 12 };

/* RLE codec — same 16-bit-run format as src/core/rle.ts (stable ABI). */
function rleEncode(types) {
  const out = [];
  let run = 1;
  for (let i = 1; i <= types.length; i++) {
    if (i < types.length && types[i] === types[i - 1] && run < 0xffff) {
      run++;
      continue;
    }
    out.push(run & 0xff, (run >> 8) & 0xff, types[i - 1]);
    run = 1;
  }
  return Buffer.from(out).toString('base64');
}

function makeGrid(w, h, fill) {
  return { w, h, cells: new Uint8Array(w * h).fill(fill) };
}
function rect(g, x0, y0, x1, y1, t) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x >= 0 && x < g.w && y >= 0 && y < g.h) g.cells[x + y * g.w] = t;
    }
  }
}
function obj(id, kind, x, y, params = {}) {
  return { id, kind, x, y, rotation: 0, locked: false, hidden: false, params };
}
function light(id, x, y, color, intensity, radius, bloom, flicker) {
  return {
    id, x, y, color, intensity, radius, bloom, flicker,
    falloff: 'soft', occluded: true, locked: false, hidden: false,
  };
}
function prefab(id, name, tags, g, objects, links, lights, anchors) {
  return {
    v: 1, kind: 'prefab', id, name, tags,
    w: g.w, h: g.h, rle: rleEncode(g.cells),
    objects, links, lights, anchors,
  };
}

/* ============================================================
 * 1) brazier-shrine (60x44): stone shrine hall, two braziers ->
 *    door (AND) guarding a treasure alcove; w+e anchors open.
 * ============================================================ */
function brazierShrine() {
  const g = makeGrid(60, 44, Cell.Wall);
  rect(g, 2, 2, 57, 41, Cell.Stone); // masonry lining (interior carves expose it)
  rect(g, 4, 12, 41, 37, Cell.Empty); // main hall
  rect(g, 42, 13, 59, 19, Cell.Empty); // upper gallery to the east edge
  rect(g, 42, 20, 59, 21, Cell.Stone); // gallery deck
  rect(g, 42, 28, 47, 37, Cell.Empty); // passage hall -> alcove
  rect(g, 48, 24, 55, 37, Cell.Empty); // treasure alcove
  rect(g, 0, 30, 3, 37, Cell.Empty); // west throat to the edge
  rect(g, 0, 38, 57, 41, Cell.Stone); // floor slab
  rect(g, 16, 12, 17, 20, Cell.Stone); // ceiling columns (no floor partition)
  rect(g, 28, 12, 29, 18, Cell.Stone);

  const objects = [
    obj('door0', 'door', 43, 26, { w: 3, h: 12 }),
    obj('braz0', 'brazier', 12, 37, {}),
    obj('braz1', 'brazier', 34, 37, {}),
    obj('gold0', 'pickup', 51, 36, { kind: 'goldpile', amount: 60 }),
    obj('heart0', 'pickup', 54, 36, { kind: 'heart' }),
  ];
  const links = [
    { id: 'k0', fromId: 'braz0', toId: 'door0', kind: 'triggerDoor' },
    { id: 'k1', fromId: 'braz1', toId: 'door0', kind: 'triggerDoor' },
  ];
  const lights = [light('L0', 22, 16, '#ffb060', 1.4, 80, 0.5, 0.35)];
  const anchors = [
    { id: 'aw', x: 0, y: 34, dir: 'w', kind: 'open', halfW: 4 },
    { id: 'ae', x: 59, y: 16, dir: 'e', kind: 'open', halfW: 3 },
  ];
  return prefab(
    'builtin-brazier-shrine', 'Brazier Shrine', ['shrine', 'builtin'],
    g, objects, links, lights, anchors,
  );
}

/* ============================================================
 * 2) plate-vault (70x50): pressure plate before a door slab,
 *    treasure chamber behind; w anchor open, e anchor SEALED.
 * ============================================================ */
function plateVault() {
  const g = makeGrid(70, 50, Cell.Wall);
  rect(g, 2, 2, 67, 47, Cell.Stone); // masonry lining
  rect(g, 4, 20, 29, 41, Cell.Empty); // antechamber
  rect(g, 0, 34, 3, 41, Cell.Empty); // west throat
  rect(g, 30, 30, 37, 41, Cell.Empty); // door passage
  rect(g, 38, 26, 61, 41, Cell.Empty); // treasure chamber
  rect(g, 62, 34, 69, 41, Cell.Empty); // east throat (resealed at placement)
  rect(g, 0, 42, 69, 45, Cell.Stone); // floor slab
  rect(g, 24, 20, 25, 24, Cell.Stone); // ceiling pillar, antechamber
  rect(g, 46, 26, 47, 31, Cell.Stone); // ceiling pillar, treasure chamber

  const objects = [
    obj('door0', 'door', 32, 28, { w: 3, h: 14 }),
    obj('plate0', 'plate', 16, 42, { w: 7 }),
    obj('gold0', 'pickup', 48, 40, { kind: 'goldpile', amount: 80 }),
    obj('chest0', 'pickup', 54, 40, { kind: 'chest' }),
  ];
  const links = [{ id: 'k0', fromId: 'plate0', toId: 'door0', kind: 'triggerDoor' }];
  const lights = [light('L0', 46, 30, '#9fd4ff', 1.1, 70, 0.3, 0.1)];
  const anchors = [
    { id: 'aw', x: 0, y: 38, dir: 'w', kind: 'open', halfW: 4 },
    { id: 'ae', x: 69, y: 38, dir: 'e', kind: 'sealed', halfW: 3 },
  ];
  return prefab(
    'builtin-plate-vault', 'Plate Vault', ['vault', 'builtin'],
    g, objects, links, lights, anchors,
  );
}

/* ============================================================
 * 3) ruin-gallery (90x40): decorative ruined gallery setpiece —
 *    broken stone/wood columns, lights, gold; no mechanisms.
 * ============================================================ */
function ruinGallery() {
  const g = makeGrid(90, 40, Cell.Wall);
  rect(g, 2, 8, 87, 33, Cell.Empty); // gallery interior
  rect(g, 0, 26, 1, 33, Cell.Empty); // west throat
  rect(g, 88, 26, 89, 33, Cell.Empty); // east throat
  rect(g, 0, 34, 89, 37, Cell.Stone); // floor slab
  // broken columns rooted in the floor (BFS passes over their tops)
  rect(g, 14, 22, 16, 33, Cell.Stone);
  rect(g, 38, 18, 40, 33, Cell.Stone);
  rect(g, 62, 24, 64, 33, Cell.Stone);
  // ceiling stubs + fallen wooden rafters
  rect(g, 26, 8, 27, 13, Cell.Stone);
  rect(g, 52, 8, 53, 12, Cell.Stone);
  rect(g, 20, 14, 34, 15, Cell.Wood);
  rect(g, 46, 16, 60, 17, Cell.Wood);
  rect(g, 70, 31, 74, 33, Cell.Wood); // collapsed beam pile on the floor

  const objects = [
    obj('gold0', 'pickup', 30, 32, { kind: 'goldpile', amount: 25 }),
    obj('gold1', 'pickup', 58, 32, { kind: 'goldpile', amount: 30 }),
  ];
  const lights = [
    light('L0', 24, 12, '#ffb060', 1.2, 75, 0.4, 0.3),
    light('L1', 66, 13, '#ffb060', 1.2, 75, 0.4, 0.3),
  ];
  const anchors = [
    { id: 'aw', x: 0, y: 30, dir: 'w', kind: 'open', halfW: 4 },
    { id: 'ae', x: 89, y: 30, dir: 'e', kind: 'open', halfW: 4 },
  ];
  return prefab(
    'builtin-ruin-gallery', 'Ruin Gallery', ['setpiece', 'builtin'],
    g, objects, [], lights, anchors,
  );
}

/* ---------------- write ---------------- */
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src', 'world', 'prefabs', 'builtin');
mkdirSync(outDir, { recursive: true });
const all = [
  ['brazier-shrine.json', brazierShrine()],
  ['plate-vault.json', plateVault()],
  ['ruin-gallery.json', ruinGallery()],
];
for (const [file, p] of all) {
  writeFileSync(join(outDir, file), JSON.stringify(p, null, 2) + '\n');
  console.log(`wrote ${file} (${p.w}x${p.h}, ${p.objects.length} objects, ${p.anchors.length} anchors)`);
}

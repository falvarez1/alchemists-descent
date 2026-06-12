// Builds the three starter worldgen prefabs programmatically and writes them
// to src/world/prefabs/builtin/*.json (committed to the tree — the registry
// eager-imports them). Re-run after editing a layout below:
//   node scripts/gen-builtin-prefabs.mjs
//
// The terrain is composed honestly: walls are Wall/Stone cells, floors are
// open, door slabs are door OBJECTS (params w/h — they stamp metal at
// instantiation), pickups are pickup objects. Cell ids are the stable ABI
// from src/sim/CellType.ts (append-only forever).
//
// WIZARD SCALE (the law of these layouts): the player's collision box is
// 9x17 cells and EVERY cell of it must be clear (entities/physics.ts
// entityFree). So: walkable interiors and throats are >= 22 tall, gate
// slabs are h 22, anchors are halfW 10 (their connector tunnels inherit the
// gauge), plinths stay <= 3 tall with >= 18 clear above, hanging decoration
// keeps >= 18 clear beneath. tests/prefabs-worldgen.test.ts enforces this
// with a true 9x17-clearance BFS.

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
 * 1) brazier-shrine (76x58): stone shrine hall, two braziers ->
 *    door (AND) guarding a treasure alcove; w+e anchors open.
 * ============================================================ */
function brazierShrine() {
  const g = makeGrid(76, 58, Cell.Wall);
  rect(g, 2, 2, 73, 55, Cell.Stone); // masonry lining
  rect(g, 4, 20, 49, 47, Cell.Empty); // main hall (28 tall)
  rect(g, 0, 26, 3, 47, Cell.Empty); // west throat (22 tall)
  rect(g, 50, 26, 52, 47, Cell.Empty); // door passage (door slab stamps here)
  rect(g, 53, 22, 69, 47, Cell.Empty); // treasure alcove (26 tall)
  rect(g, 70, 26, 75, 47, Cell.Empty); // east throat (22 tall)
  rect(g, 0, 48, 73, 51, Cell.Stone); // floor slab
  rect(g, 16, 20, 17, 25, Cell.Stone); // ceiling column stubs (>= 22 clear below)
  rect(g, 30, 20, 31, 24, Cell.Stone);

  const objects = [
    obj('door0', 'door', 50, 26, { w: 3, h: 22 }),
    obj('braz0', 'brazier', 12, 47, {}),
    obj('braz1', 'brazier', 38, 47, {}),
    obj('gold0', 'pickup', 58, 46, { kind: 'goldpile', amount: 60 }),
    obj('heart0', 'pickup', 63, 46, { kind: 'heart' }),
  ];
  const links = [
    { id: 'k0', fromId: 'braz0', toId: 'door0', kind: 'triggerDoor' },
    { id: 'k1', fromId: 'braz1', toId: 'door0', kind: 'triggerDoor' },
  ];
  const lights = [light('L0', 24, 30, '#ffb060', 1.4, 80, 0.5, 0.35)];
  const anchors = [
    { id: 'aw', x: 0, y: 36, dir: 'w', kind: 'open', halfW: 10 },
    { id: 'ae', x: 75, y: 36, dir: 'e', kind: 'open', halfW: 10 },
  ];
  return prefab(
    'builtin-brazier-shrine', 'Brazier Shrine', ['shrine', 'builtin'],
    g, objects, links, lights, anchors,
  );
}

/* ============================================================
 * 2) plate-vault (88x60): pressure plate before a door slab,
 *    treasure chamber behind; w anchor open, e anchor SEALED.
 * ============================================================ */
function plateVault() {
  const g = makeGrid(88, 60, Cell.Wall);
  rect(g, 2, 2, 85, 57, Cell.Stone); // masonry lining
  rect(g, 4, 26, 37, 51, Cell.Empty); // antechamber (26 tall)
  rect(g, 0, 30, 3, 51, Cell.Empty); // west throat (22 tall)
  rect(g, 38, 30, 41, 51, Cell.Empty); // door passage
  rect(g, 42, 26, 77, 51, Cell.Empty); // treasure chamber
  rect(g, 78, 30, 87, 51, Cell.Empty); // east throat (resealed at placement)
  rect(g, 0, 52, 85, 55, Cell.Stone); // floor slab
  rect(g, 24, 26, 25, 30, Cell.Stone); // ceiling pillar stubs (>= 21 clear below)
  rect(g, 56, 26, 57, 31, Cell.Stone);

  const objects = [
    obj('door0', 'door', 38, 30, { w: 4, h: 22 }),
    obj('plate0', 'plate', 16, 51, { w: 7 }),
    obj('gold0', 'pickup', 52, 50, { kind: 'goldpile', amount: 80 }),
    obj('chest0', 'pickup', 60, 50, { kind: 'chest' }),
  ];
  const links = [{ id: 'k0', fromId: 'plate0', toId: 'door0', kind: 'triggerDoor' }];
  const lights = [light('L0', 52, 34, '#9fd4ff', 1.1, 70, 0.3, 0.1)];
  const anchors = [
    { id: 'aw', x: 0, y: 40, dir: 'w', kind: 'open', halfW: 10 },
    { id: 'ae', x: 87, y: 40, dir: 'e', kind: 'sealed', halfW: 10 },
  ];
  return prefab(
    'builtin-plate-vault', 'Plate Vault', ['vault', 'builtin'],
    g, objects, links, lights, anchors,
  );
}

/* ============================================================
 * 3) ruin-gallery (104x52): decorative ruined gallery setpiece —
 *    broken stone/wood columns, lights, gold; no mechanisms.
 * ============================================================ */
function ruinGallery() {
  const g = makeGrid(104, 52, Cell.Wall);
  rect(g, 2, 12, 101, 43, Cell.Empty); // gallery interior (32 tall)
  rect(g, 0, 22, 1, 43, Cell.Empty); // west throat (22 tall)
  rect(g, 102, 22, 103, 43, Cell.Empty); // east throat (22 tall)
  rect(g, 0, 44, 103, 47, Cell.Stone); // floor slab
  // broken columns rooted in the floor — every top keeps >= 18 clear above
  rect(g, 18, 32, 20, 43, Cell.Stone);
  rect(g, 48, 30, 50, 43, Cell.Stone);
  rect(g, 78, 34, 80, 43, Cell.Stone);
  // ceiling stubs
  rect(g, 32, 12, 33, 17, Cell.Stone);
  rect(g, 64, 12, 65, 16, Cell.Stone);
  // fallen wooden rafters ON the floor (low — the step-up walks over them)
  rect(g, 26, 41, 38, 42, Cell.Wood);
  rect(g, 56, 42, 66, 43, Cell.Wood);
  rect(g, 86, 41, 92, 43, Cell.Wood); // collapsed beam pile

  const objects = [
    obj('gold0', 'pickup', 42, 42, { kind: 'goldpile', amount: 25 }),
    obj('gold1', 'pickup', 70, 41, { kind: 'goldpile', amount: 30 }),
  ];
  const lights = [
    light('L0', 28, 18, '#ffb060', 1.2, 75, 0.4, 0.3),
    light('L1', 76, 20, '#ffb060', 1.2, 75, 0.4, 0.3),
  ];
  const anchors = [
    { id: 'aw', x: 0, y: 32, dir: 'w', kind: 'open', halfW: 10 },
    { id: 'ae', x: 103, y: 32, dir: 'e', kind: 'open', halfW: 10 },
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

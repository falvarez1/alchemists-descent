// Builds the four MACHINE STRUCTURE prefabs (docs/MACHINE-PRIMITIVES-AND-
// STRUCTURES-PLAN.md) and writes them to src/world/prefabs/builtin/
// machine-*.json (committed — the registry eager-imports them). Re-run after
// editing a layout below:
//   node scripts/gen-machine-prefabs.mjs
//
// Every chain is REAL cells + the machine object vocabulary (valve, plug,
// sensor, counterweight, relay): sand actually falls, water actually flows,
// coal actually burns. The grid explains every stage. Cell ids are the
// stable ABI from src/sim/CellType.ts (append-only forever).
//
// WIZARD SCALE (the law of these layouts): the player's collision box is
// 9x17 cells and EVERY cell of it must be clear (entities/physics.ts
// entityFree). So: walkable interiors and throats are >= 22 tall, gate
// slabs are h 22, anchors are halfW 10 (their connector tunnels inherit the
// gauge), pan lips and rafters stay within the 5-cell step-up, and hanging
// fixtures keep >= 18 clear beneath. tests/prefabs-worldgen.test.ts
// enforces this with a true 9x17-clearance BFS.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCellAbi } from './cell-abi.mjs';

const Cell = loadCellAbi();

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
function link(id, fromId, toId) {
  return { id, fromId, toId, kind: 'triggerDoor' };
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
 * 1) POWDER MILL (96x66): brazier -> relay IGNITES the wooden
 *    hopper plug -> sand pours onto a counterweight -> the gate
 *    to the magazine opens. The hanging wood fuse is a real,
 *    burnable shortcut: torch it directly and skip the relay.
 * ============================================================ */
function powderMill() {
  const g = makeGrid(96, 66, Cell.Wall);
  rect(g, 2, 2, 93, 63, Cell.Stone); // masonry lining
  rect(g, 4, 32, 68, 55, Cell.Empty); // mill hall (24 tall)
  rect(g, 0, 34, 3, 55, Cell.Empty); // west throat (22 tall)
  rect(g, 69, 34, 72, 55, Cell.Empty); // door passage (door slab stamps here)
  rect(g, 73, 32, 89, 55, Cell.Empty); // powder magazine (the reward room)
  rect(g, 90, 34, 95, 55, Cell.Empty); // east throat (resealed at placement)
  rect(g, 0, 56, 93, 59, Cell.Stone); // floor slab
  // sand hopper hanging in the ceiling mass: stone shell, sand belly,
  // wooden plug for a floor (the weak link — fire is the key)
  rect(g, 28, 14, 48, 31, Cell.Stone);
  rect(g, 30, 16, 46, 29, Cell.Sand);
  rect(g, 35, 30, 41, 31, Cell.Empty); // mouth (plug0 stamps Wood here)
  // the hanging fuse: a real wood tassel under the hopper — burnable
  // (5 long; 19 rows stay clear beneath it)
  rect(g, 38, 32, 38, 36, Cell.Wood);
  return prefab(
    'machine-powder-mill', 'Powder Mill', ['machine', 'powdermill', 'builtin'],
    g,
    [
      obj('door0', 'door', 69, 34, { w: 4, h: 22 }),
      obj('cw0', 'counterweight', 38, 55, { w: 9, threshold: 24 }),
      obj('plug0', 'plug', 35, 30, { w: 7, h: 2, material: 'wood' }),
      obj('braz0', 'brazier', 28, 55, {}),
      obj('relay0', 'relay', 31, 55, { delay: 60, action: 'ignite' }),
      obj('gold0', 'pickup', 78, 54, { kind: 'goldpile', amount: 70 }),
      obj('chest0', 'pickup', 84, 54, { kind: 'chest' }),
    ],
    [
      link('k0', 'braz0', 'relay0'), // the lit brazier arms the igniter
      link('k1', 'relay0', 'plug0'), // ...which torches the hopper plug
      link('k2', 'cw0', 'door0'), // poured sand mass opens the gate
    ],
    [light('L0', 34, 40, '#ffb060', 1.4, 85, 0.5, 0.4)],
    [
      { id: 'aw', x: 0, y: 44, dir: 'w', kind: 'open', halfW: 10 },
      { id: 'ae', x: 95, y: 44, dir: 'e', kind: 'sealed', halfW: 10 },
    ],
  );
}

/* ============================================================
 * 2) ALCHEMY CLOCK (84x88): pour liquid into the top intake ->
 *    basin 1's sensor opens the glass valve -> the pour drains a
 *    basin deeper -> basin 2's sensor arms the escapement relay
 *    -> the elixir vault opens. An overflow lip drains basin 2
 *    into the hall so the flood stays bounded.
 * ============================================================ */
function alchemyClock() {
  const g = makeGrid(84, 88, Cell.Wall);
  rect(g, 2, 2, 81, 85, Cell.Stone); // masonry lining
  rect(g, 4, 30, 29, 79, Cell.Empty); // walkable hall, 50 tall (the machine column is to its right)
  rect(g, 0, 58, 3, 79, Cell.Empty); // west throat (22 tall)
  rect(g, 0, 80, 81, 83, Cell.Stone); // floor slab
  rect(g, 38, 0, 46, 11, Cell.Empty); // north intake shaft (pour channel, not walk-in)
  rect(g, 34, 12, 56, 23, Cell.Empty); // basin 1
  rect(g, 42, 24, 47, 25, Cell.Empty); // basin 1 floor seat (valve0 stamps Glass)
  rect(g, 32, 28, 60, 42, Cell.Empty); // basin 2
  rect(g, 30, 28, 31, 31, Cell.Empty); // basin 2 overflow lip -> spills into the hall
  rect(g, 30, 58, 33, 79, Cell.Empty); // vault door passage (door0 stamps here)
  rect(g, 34, 58, 62, 79, Cell.Empty); // elixir vault (22 tall)
  return prefab(
    'machine-alchemy-clock', 'Alchemy Clock', ['machine', 'alchemyclock', 'builtin'],
    g,
    [
      obj('valve0', 'valve', 42, 24, { w: 6, h: 2, material: 'glass' }),
      obj('s0', 'sensor', 52, 24, { type: 'liquid', threshold: 10, zoneW: 13, zoneH: 5, latch: 'permanent' }),
      obj('s1', 'sensor', 46, 43, { type: 'liquid', threshold: 10, zoneW: 13, zoneH: 5, latch: 'permanent' }),
      obj('relay0', 'relay', 12, 79, { delay: 45 }),
      obj('door0', 'door', 30, 58, { w: 4, h: 22 }),
      obj('pot0', 'pickup', 44, 78, { kind: 'potion' }),
      obj('gold0', 'pickup', 52, 78, { kind: 'goldpile', amount: 55 }),
      obj('pot1', 'pickup', 57, 78, { kind: 'potion' }),
    ],
    [
      link('k0', 's0', 'valve0'), // basin 1 fills -> the glass valve opens
      link('k1', 's1', 'relay0'), // basin 2 fills -> the escapement arms
      link('k2', 'relay0', 'door0'), // ...and the vault unlocks
    ],
    [light('L0', 16, 40, '#9fd4ff', 1.2, 75, 0.4, 0.15), light('L1', 45, 16, '#5eead4', 1.0, 60, 0.3, 0.12)],
    [
      { id: 'an', x: 42, y: 0, dir: 'n', kind: 'open', halfW: 4 },
      { id: 'aw', x: 0, y: 68, dir: 'w', kind: 'open', halfW: 10 },
    ],
  );
}

/* ============================================================
 * 3) KILN ELEVATOR (96x74): ignite the coal bed -> heat sensor
 *    opens the boiler valve -> water floods the kiln -> flood
 *    sensor arms a relay that BREAKS the ash plug -> ballast
 *    sand drops onto the counterweight -> the side gate opens.
 * ============================================================ */
function kilnElevator() {
  const g = makeGrid(96, 74, Cell.Wall);
  rect(g, 2, 2, 93, 71, Cell.Stone); // masonry lining
  rect(g, 8, 42, 54, 65, Cell.Empty); // kiln chamber (24 tall)
  rect(g, 0, 44, 7, 65, Cell.Empty); // west throat (22 tall)
  rect(g, 4, 66, 89, 69, Cell.Stone); // floor slab
  rect(g, 16, 62, 40, 65, Cell.Coal); // the coal bed (bring fire; 20 clear above)
  // boiler: stone shell, water belly, metal valve + open drop channel
  rect(g, 14, 24, 40, 39, Cell.Stone);
  rect(g, 16, 26, 38, 37, Cell.Water);
  rect(g, 24, 38, 29, 41, Cell.Empty); // valve seat (rows 38-39) + drop channel (40-41)
  // ballast hopper: stone shell, sand belly, ash plug floor, drop shaft
  rect(g, 44, 20, 64, 39, Cell.Stone);
  rect(g, 46, 22, 62, 35, Cell.Sand);
  rect(g, 46, 36, 53, 37, Cell.Empty); // plug seat (plug0 stamps Ash)
  rect(g, 46, 38, 53, 41, Cell.Empty); // drop shaft into the kiln
  rect(g, 55, 44, 58, 65, Cell.Empty); // gate passage (door0 stamps here)
  rect(g, 59, 42, 85, 65, Cell.Empty); // engine room (the reward)
  rect(g, 68, 62, 72, 63, Cell.Stone); // tome platform (2 tall, 20 clear above)
  rect(g, 86, 44, 95, 65, Cell.Empty); // east throat (resealed at placement)
  return prefab(
    'machine-kiln-elevator', 'Kiln Elevator', ['machine', 'kilnelevator', 'builtin'],
    g,
    [
      obj('s0', 'sensor', 26, 62, { type: 'heat', threshold: 8, zoneW: 18, zoneH: 6, latch: 'permanent' }),
      obj('valve0', 'valve', 24, 38, { w: 6, h: 2, material: 'metal' }),
      obj('s1', 'sensor', 11, 66, { type: 'liquid', threshold: 8, zoneW: 7, zoneH: 5, latch: 'permanent' }),
      obj('relay0', 'relay', 44, 65, { delay: 30, action: 'break' }),
      obj('plug0', 'plug', 46, 36, { w: 8, h: 2, material: 'ash' }),
      obj('cw0', 'counterweight', 49, 65, { w: 9, threshold: 24 }),
      obj('door0', 'door', 55, 44, { w: 4, h: 22 }),
      obj('tome0', 'pickup', 70, 61, { kind: 'tome' }),
      obj('gold0', 'pickup', 78, 64, { kind: 'goldpile', amount: 60 }),
    ],
    [
      link('k0', 's0', 'valve0'), // kiln heat opens the boiler
      link('k1', 's1', 'relay0'), // the flood arms the breaker
      link('k2', 'relay0', 'plug0'), // ...which detonates the ash plug
      link('k3', 'cw0', 'door0'), // ballast mass opens the gate
    ],
    [light('L0', 26, 50, '#ff8a3c', 1.6, 75, 0.6, 0.35), light('L1', 72, 50, '#9fd4ff', 1.0, 60, 0.3, 0.1)],
    [
      { id: 'aw', x: 0, y: 54, dir: 'w', kind: 'open', halfW: 10 },
      { id: 'ae', x: 95, y: 54, dir: 'e', kind: 'sealed', halfW: 10 },
    ],
  );
}

/* ============================================================
 * 4) CRYSTAL RELAY VAULT (92x58): spark the charge latch ->
 *    the glass valve drops the reservoir into the conductor
 *    channel -> the channel sensor arms the relay -> the vault
 *    door opens. Flooding the channel yourself works just as
 *    well — the circuit only cares that water arrived.
 * ============================================================ */
function crystalRelayVault() {
  const g = makeGrid(92, 58, Cell.Wall);
  rect(g, 2, 2, 89, 55, Cell.Stone); // masonry lining
  rect(g, 4, 26, 60, 49, Cell.Empty); // main hall (24 tall)
  rect(g, 0, 28, 3, 49, Cell.Empty); // west throat (22 tall)
  rect(g, 0, 50, 89, 53, Cell.Stone); // floor slab
  // reservoir: stone shell, water belly, glass valve + open drop channel
  rect(g, 24, 8, 46, 23, Cell.Stone);
  rect(g, 26, 10, 44, 21, Cell.Water);
  rect(g, 32, 22, 37, 25, Cell.Empty); // valve seat (rows 22-23) + drop channel (24-25)
  // conductor channel: a shallow stone basin with a metal floor strip
  // (4-tall rims — the step-up cannot climb them, the pour stays put...
  //  but the player hops the rim from a standing jump)
  rect(g, 28, 46, 29, 49, Cell.Stone);
  rect(g, 40, 46, 41, 49, Cell.Stone);
  rect(g, 30, 49, 39, 49, Cell.Metal);
  rect(g, 61, 28, 63, 49, Cell.Empty); // vault door passage (door0 stamps here)
  rect(g, 64, 26, 84, 49, Cell.Empty); // the vault
  rect(g, 85, 28, 91, 49, Cell.Empty); // east throat (resealed at placement)
  return prefab(
    'machine-crystal-relay-vault', 'Crystal Relay Vault', ['machine', 'crystalrelay', 'builtin'],
    g,
    [
      obj('cl0', 'chargeLatch', 14, 49, {}),
      obj('valve0', 'valve', 32, 22, { w: 6, h: 2, material: 'glass' }),
      obj('s0', 'sensor', 34, 49, { type: 'liquid', threshold: 8, zoneW: 11, zoneH: 6, latch: 'permanent', filter: 'water' }),
      obj('relay0', 'relay', 50, 49, { delay: 30 }),
      obj('door0', 'door', 61, 28, { w: 3, h: 22 }),
      obj('gold0', 'pickup', 70, 48, { kind: 'goldpile', amount: 90 }),
      obj('chest0', 'pickup', 76, 48, { kind: 'chest' }),
    ],
    [
      link('k0', 'cl0', 'valve0'), // the spark opens the reservoir
      link('k1', 's0', 'relay0'), // water in the channel closes the circuit
      link('k2', 'relay0', 'door0'), // ...and the vault answers
    ],
    [light('L0', 14, 40, '#7fd4ff', 1.2, 60, 0.5, 0.1), light('L1', 72, 36, '#c084fc', 1.1, 65, 0.4, 0.15)],
    [
      { id: 'aw', x: 0, y: 38, dir: 'w', kind: 'open', halfW: 10 },
      { id: 'ae', x: 91, y: 38, dir: 'e', kind: 'sealed', halfW: 10 },
    ],
  );
}

/* ---------------- write ---------------- */
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src', 'world', 'prefabs', 'builtin');
mkdirSync(outDir, { recursive: true });
const all = [
  ['machine-powder-mill.json', powderMill()],
  ['machine-alchemy-clock.json', alchemyClock()],
  ['machine-kiln-elevator.json', kilnElevator()],
  ['machine-crystal-relay-vault.json', crystalRelayVault()],
];
const checkOnly = process.argv.includes('--check');
for (const [file, p] of all) {
  const path = join(outDir, file);
  const next = JSON.stringify(p, null, 2) + '\n';
  if (checkOnly) {
    const current = readFileSync(path, 'utf8');
    if (current !== next) {
      console.error(`stale ${file}; run node scripts/gen-machine-prefabs.mjs`);
      process.exitCode = 1;
    } else {
      console.log(`ok ${file}`);
    }
  } else {
    writeFileSync(path, next);
    console.log(`wrote ${file} (${p.w}x${p.h}, ${p.objects.length} objects, ${p.links.length} links, ${p.anchors.length} anchors)`);
  }
}

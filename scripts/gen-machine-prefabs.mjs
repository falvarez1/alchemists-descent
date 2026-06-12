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
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const Cell = { Empty: 0, Sand: 1, Water: 2, Wall: 3, Wood: 4, Stone: 12, Metal: 13, Coal: 28 };

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
 * 1) POWDER MILL (84x48): brazier -> relay IGNITES the wooden
 *    hopper plug -> sand pours onto a counterweight -> the gate
 *    to the magazine opens. The hanging wood fuse is a real,
 *    burnable shortcut: torch it directly and skip the relay.
 * ============================================================ */
function powderMill() {
  const g = makeGrid(84, 48, Cell.Wall);
  rect(g, 2, 2, 81, 45, Cell.Stone); // masonry lining
  rect(g, 4, 28, 60, 41, Cell.Empty); // mill hall
  rect(g, 0, 34, 3, 41, Cell.Empty); // west throat
  rect(g, 61, 30, 63, 41, Cell.Empty); // door passage (door slab stamps here)
  rect(g, 64, 28, 79, 41, Cell.Empty); // powder magazine (the reward room)
  rect(g, 80, 34, 83, 41, Cell.Empty); // east throat (resealed at placement)
  rect(g, 0, 42, 83, 45, Cell.Stone); // floor slab
  // sand hopper hanging in the ceiling mass: stone shell, sand belly,
  // wooden plug for a floor (the weak link — fire is the key)
  rect(g, 26, 14, 40, 27, Cell.Stone);
  rect(g, 28, 16, 38, 25, Cell.Sand);
  rect(g, 31, 26, 35, 27, Cell.Empty); // mouth (plug0 stamps Wood here)
  // the hanging fuse: a real wood tassel under the hopper — burnable
  rect(g, 33, 28, 33, 34, Cell.Wood);
  return prefab(
    'machine-powder-mill', 'Powder Mill', ['machine', 'powdermill', 'builtin'],
    g,
    [
      obj('door0', 'door', 61, 30, { w: 3, h: 12 }),
      obj('cw0', 'counterweight', 33, 41, { w: 7, threshold: 24 }),
      obj('plug0', 'plug', 31, 26, { w: 5, h: 2, material: 'wood' }),
      obj('braz0', 'brazier', 28, 41, {}),
      obj('relay0', 'relay', 30, 41, { delay: 60, action: 'ignite' }),
      obj('gold0', 'pickup', 70, 40, { kind: 'goldpile', amount: 70 }),
      obj('chest0', 'pickup', 75, 40, { kind: 'chest' }),
    ],
    [
      link('k0', 'braz0', 'relay0'), // the lit brazier arms the igniter
      link('k1', 'relay0', 'plug0'), // ...which torches the hopper plug
      link('k2', 'cw0', 'door0'), // poured sand mass opens the gate
    ],
    [light('L0', 30, 32, '#ffb060', 1.4, 80, 0.5, 0.4)],
    [
      { id: 'aw', x: 0, y: 38, dir: 'w', kind: 'open', halfW: 4 },
      { id: 'ae', x: 83, y: 38, dir: 'e', kind: 'sealed', halfW: 3 },
    ],
  );
}

/* ============================================================
 * 2) ALCHEMY CLOCK (64x58): pour liquid into the top intake (or
 *    shatter the side tank's glass plug) -> liquid sensor opens
 *    the glass valve -> water drains a basin deeper -> second
 *    sensor arms a relay -> the elixir vault opens. Overflow
 *    drains keep the flood bounded.
 * ============================================================ */
function alchemyClock() {
  const g = makeGrid(64, 58, Cell.Wall);
  rect(g, 2, 2, 61, 55, Cell.Stone); // masonry lining
  rect(g, 28, 0, 34, 9, Cell.Empty); // north intake shaft (anchor)
  rect(g, 24, 10, 38, 18, Cell.Empty); // basin 1
  rect(g, 29, 19, 33, 20, Cell.Empty); // basin 1 floor gap (valve0 stamps Glass)
  rect(g, 20, 21, 42, 30, Cell.Empty); // basin 2
  rect(g, 18, 21, 19, 24, Cell.Empty); // basin 2 overflow lip (upper rows only)
  rect(g, 14, 21, 15, 33, Cell.Empty); // overflow downshaft
  rect(g, 16, 21, 17, 22, Cell.Empty); // lip -> downshaft channel
  rect(g, 12, 34, 51, 47, Cell.Empty); // bottom chamber
  rect(g, 52, 36, 53, 47, Cell.Empty); // vault door passage (door0 stamps here)
  rect(g, 54, 36, 59, 47, Cell.Empty); // elixir vault
  rect(g, 0, 40, 11, 47, Cell.Empty); // west throat
  rect(g, 8, 48, 59, 51, Cell.Stone); // floor slab
  // side water tank: stone shell, water belly, glass plug in its floor
  // corner — the impatient alchemist's alternate key
  rect(g, 40, 8, 52, 18, Cell.Stone);
  rect(g, 42, 10, 50, 16, Cell.Water);
  rect(g, 40, 12, 41, 15, Cell.Empty); // plug seat toward basin 1 (plug0 stamps Glass)
  return prefab(
    'machine-alchemy-clock', 'Alchemy Clock', ['machine', 'alchemyclock', 'builtin'],
    g,
    [
      obj('valve0', 'valve', 29, 19, { w: 5, h: 2, material: 'glass' }),
      obj('s0', 'sensor', 31, 19, { type: 'liquid', threshold: 10, zoneW: 11, zoneH: 5, latch: 'permanent' }),
      obj('s1', 'sensor', 31, 31, { type: 'liquid', threshold: 10, zoneW: 11, zoneH: 5, latch: 'permanent' }),
      obj('relay0', 'relay', 24, 47, { delay: 45 }),
      obj('door0', 'door', 52, 36, { w: 2, h: 12 }),
      obj('plug0', 'plug', 40, 12, { w: 2, h: 4, material: 'glass' }),
      obj('pot0', 'pickup', 56, 46, { kind: 'potion' }),
      obj('gold0', 'pickup', 58, 46, { kind: 'goldpile', amount: 55 }),
    ],
    [
      link('k0', 's0', 'valve0'), // basin 1 fills -> the glass valve opens
      link('k1', 's1', 'relay0'), // basin 2 fills -> the escapement arms
      link('k2', 'relay0', 'door0'), // ...and the vault unlocks
    ],
    [light('L0', 31, 14, '#9fd4ff', 1.2, 70, 0.4, 0.15), light('L1', 36, 42, '#5eead4', 1.0, 55, 0.3, 0.12)],
    [
      { id: 'an', x: 31, y: 0, dir: 'n', kind: 'open', halfW: 3 },
      { id: 'aw', x: 0, y: 44, dir: 'w', kind: 'open', halfW: 4 },
    ],
  );
}

/* ============================================================
 * 3) KILN ELEVATOR (72x56): ignite the coal bed -> heat sensor
 *    opens the boiler valve -> water floods the kiln -> flood
 *    sensor arms a relay that BREAKS the ash plug -> ballast
 *    sand drops onto the counterweight -> the side gate opens.
 * ============================================================ */
function kilnElevator() {
  const g = makeGrid(72, 56, Cell.Wall);
  rect(g, 2, 2, 69, 53, Cell.Stone); // masonry lining
  rect(g, 8, 36, 44, 49, Cell.Empty); // kiln chamber
  rect(g, 0, 42, 7, 49, Cell.Empty); // west throat
  rect(g, 4, 50, 67, 53, Cell.Stone); // floor slab
  rect(g, 14, 46, 34, 49, Cell.Coal); // the coal bed (bring fire)
  // boiler: stone shell, water belly, metal valve in its floor
  rect(g, 16, 24, 36, 33, Cell.Stone);
  rect(g, 18, 25, 34, 31, Cell.Water);
  rect(g, 24, 32, 28, 33, Cell.Empty); // valve seat (valve0 stamps Metal)
  // ballast hopper: stone shell, sand belly, ash plug floor, drop shaft
  rect(g, 38, 18, 50, 31, Cell.Stone);
  rect(g, 40, 20, 48, 28, Cell.Sand);
  rect(g, 40, 29, 45, 30, Cell.Empty); // plug seat (plug0 stamps Ash)
  rect(g, 40, 31, 45, 35, Cell.Empty); // drop shaft into the kiln
  rect(g, 46, 38, 47, 49, Cell.Empty); // gate passage (door0 stamps here)
  rect(g, 48, 36, 64, 49, Cell.Empty); // engine room (the reward)
  rect(g, 58, 40, 62, 41, Cell.Stone); // tome platform
  rect(g, 65, 42, 71, 49, Cell.Empty); // east throat (resealed at placement)
  return prefab(
    'machine-kiln-elevator', 'Kiln Elevator', ['machine', 'kilnelevator', 'builtin'],
    g,
    [
      obj('s0', 'sensor', 24, 44, { type: 'heat', threshold: 8, zoneW: 16, zoneH: 6, latch: 'permanent' }),
      obj('valve0', 'valve', 24, 32, { w: 5, h: 2, material: 'metal' }),
      obj('s1', 'sensor', 11, 48, { type: 'liquid', threshold: 8, zoneW: 7, zoneH: 5, latch: 'permanent' }),
      obj('relay0', 'relay', 37, 49, { delay: 30, action: 'break' }),
      obj('plug0', 'plug', 40, 29, { w: 6, h: 2, material: 'ash' }),
      obj('cw0', 'counterweight', 42, 49, { w: 7, threshold: 24 }),
      obj('door0', 'door', 46, 38, { w: 2, h: 12 }),
      obj('tome0', 'pickup', 60, 39, { kind: 'tome' }),
      obj('gold0', 'pickup', 54, 48, { kind: 'goldpile', amount: 60 }),
    ],
    [
      link('k0', 's0', 'valve0'), // kiln heat opens the boiler
      link('k1', 's1', 'relay0'), // the flood arms the breaker
      link('k2', 'relay0', 'plug0'), // ...which detonates the ash plug
      link('k3', 'cw0', 'door0'), // ballast mass opens the gate
    ],
    [light('L0', 24, 42, '#ff8a3c', 1.6, 70, 0.6, 0.35), light('L1', 56, 42, '#9fd4ff', 1.0, 55, 0.3, 0.1)],
    [
      { id: 'aw', x: 0, y: 46, dir: 'w', kind: 'open', halfW: 4 },
      { id: 'ae', x: 71, y: 46, dir: 'e', kind: 'sealed', halfW: 3 },
    ],
  );
}

/* ============================================================
 * 4) CRYSTAL RELAY VAULT (72x44): spark the charge latch ->
 *    the glass valve drops the reservoir into the conductor
 *    channel -> the channel sensor arms the relay -> the vault
 *    door opens. Blasting the tank floods the channel just as
 *    well — the circuit only cares that water arrived.
 * ============================================================ */
function crystalRelayVault() {
  const g = makeGrid(72, 44, Cell.Wall);
  rect(g, 2, 2, 69, 41, Cell.Stone); // masonry lining
  rect(g, 4, 22, 48, 37, Cell.Empty); // main hall
  rect(g, 0, 30, 3, 37, Cell.Empty); // west throat
  rect(g, 0, 38, 71, 41, Cell.Stone); // floor slab
  // reservoir: stone shell, water belly, glass valve in its floor
  rect(g, 20, 8, 36, 19, Cell.Stone);
  rect(g, 22, 10, 34, 16, Cell.Water);
  rect(g, 26, 17, 30, 18, Cell.Empty); // valve seat (valve0 stamps Glass)
  // conductor channel: a shallow stone basin with a metal floor strip
  rect(g, 22, 35, 23, 37, Cell.Stone);
  rect(g, 34, 35, 35, 37, Cell.Stone);
  rect(g, 24, 37, 33, 37, Cell.Metal);
  rect(g, 49, 26, 50, 37, Cell.Empty); // vault door passage (door0 stamps here)
  rect(g, 51, 24, 64, 37, Cell.Empty); // the vault
  rect(g, 65, 30, 71, 37, Cell.Empty); // east throat (resealed at placement)
  return prefab(
    'machine-crystal-relay-vault', 'Crystal Relay Vault', ['machine', 'crystalrelay', 'builtin'],
    g,
    [
      obj('cl0', 'chargeLatch', 14, 37, {}),
      obj('valve0', 'valve', 26, 17, { w: 5, h: 2, material: 'glass' }),
      obj('s0', 'sensor', 28, 36, { type: 'liquid', threshold: 8, zoneW: 11, zoneH: 6, latch: 'permanent', filter: 'water' }),
      obj('relay0', 'relay', 40, 37, { delay: 30 }),
      obj('door0', 'door', 49, 26, { w: 2, h: 12 }),
      obj('gold0', 'pickup', 56, 36, { kind: 'goldpile', amount: 90 }),
      obj('chest0', 'pickup', 60, 36, { kind: 'chest' }),
    ],
    [
      link('k0', 'cl0', 'valve0'), // the spark opens the reservoir
      link('k1', 's0', 'relay0'), // water in the channel closes the circuit
      link('k2', 'relay0', 'door0'), // ...and the vault answers
    ],
    [light('L0', 14, 32, '#7fd4ff', 1.2, 55, 0.5, 0.1), light('L1', 56, 30, '#c084fc', 1.1, 60, 0.4, 0.15)],
    [
      { id: 'aw', x: 0, y: 34, dir: 'w', kind: 'open', halfW: 4 },
      { id: 'ae', x: 71, y: 34, dir: 'e', kind: 'sealed', halfW: 3 },
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
for (const [file, p] of all) {
  writeFileSync(join(outDir, file), JSON.stringify(p, null, 2) + '\n');
  console.log(`wrote ${file} (${p.w}x${p.h}, ${p.objects.length} objects, ${p.links.length} links, ${p.anchors.length} anchors)`);
}

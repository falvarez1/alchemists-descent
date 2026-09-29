// Rapier terrain-representation experiment (Node, the game's own Rapier build):
// a heap of boxes resting on (a) a floor of 1x1 fixed cuboids — how
// RigidBodies fed terrain — vs (b) one Voxels collider over the same cells.
// Reports voxel alignment, time per step (first 2 s: everything moving; and over
// the whole run), and how much of the heap sleeps when.
// Usage: node scripts/bench-rapier-terrain.mjs [bodies=400] [steps=900] [lengthUnit=10] [iters=4]
import RAPIER from '@dimforge/rapier2d-compat';

const [N = 400, STEPS = 900, LU = 10, ITERS = 4] = process.argv.slice(2).map(Number);
const warn = console.warn; console.warn = () => {};
await RAPIER.init();
console.warn = warn;
const PF = 60, GRAVITY = 0.28 * PF * PF;

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: GRAVITY });
  world.integrationParameters.dt = 1 / PF;
  world.integrationParameters.lengthUnit = LU;
  world.integrationParameters.numSolverIterations = ITERS;
  return world;
}

// Floor: cells x in [0, 600), y = 400..403 (4 thick), walls at x = 0 and 599 up to y = 200.
function floorCells() {
  const cells = [];
  for (let x = 0; x < 600; x++) for (let y = 400; y < 404; y++) cells.push([x, y]);
  for (let y = 200; y < 400; y++) { cells.push([0, y]); cells.push([599, y]); }
  return cells;
}

function alignment() {
  const world = makeWorld();
  world.createCollider(RAPIER.ColliderDesc.voxels(new Int32Array([10, 20]), { x: 1, y: 1 }));
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(10.5, 10));
  world.createCollider(RAPIER.ColliderDesc.ball(0.5), b);
  for (let i = 0; i < 240; i++) world.step();
  return { restY: +b.translation().y.toFixed(3), note: 'ball r=0.5 over voxel (10,20): rest y 19.5 => voxel spans [20,21]' };
}

function run(kind) {
  const world = makeWorld();
  const cells = floorCells();
  if (kind === 'cuboids') {
    for (const [x, y] of cells) world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5).setTranslation(x + 0.5, y + 0.5).setFriction(0.9).setRestitution(0));
  } else {
    const data = new Int32Array(cells.length * 2);
    cells.forEach(([x, y], k) => { data[k * 2] = x; data[k * 2 + 1] = y; });
    world.createCollider(RAPIER.ColliderDesc.voxels(data, { x: 1, y: 1 }).setFriction(0.9).setRestitution(0));
  }
  let s = 5; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const bodies = [];
  for (let k = 0; k < N; k++) {
    const col = k % 40, row = Math.floor(k / 40);
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(20 + col * 14, 394 - row * 9));
    world.createCollider(RAPIER.ColliderDesc.cuboid(3 + rnd(), 3 + rnd() * 0.5).setDensity(1).setFriction(0.9).setRestitution(0), b);
    bodies.push(b);
  }
  const t0 = performance.now();
  let activeMs = 0;
  let firstAllAsleep = -1;
  const checkpoints = [];
  for (let i = 1; i <= STEPS; i++) {
    const ts = performance.now();
    world.step();
    if (i <= 120) activeMs += performance.now() - ts;
    if (i % 150 === 0 || i === STEPS) {
      let asleep = 0, maxV = 0;
      for (const b of bodies) { if (b.isSleeping()) asleep++; const v = b.linvel(); maxV = Math.max(maxV, Math.hypot(v.x, v.y) / PF); }
      checkpoints.push(`${(i / PF).toFixed(1)}s:${asleep}`);
      if (asleep === N && firstAllAsleep < 0) firstAllAsleep = i / PF;
    }
  }
  const ms = (performance.now() - t0) / STEPS;
  return { kind, activeMsPerStep: +(activeMs / 120).toFixed(3), msPerStep: +ms.toFixed(3), asleepTimeline: checkpoints.join(' '), allAsleepAt: firstAllAsleep };
}

console.log('version', RAPIER.version(), `N=${N} lengthUnit=${LU} iters=${ITERS}`);
console.log('alignment', alignment());
console.log(run('cuboids'));
console.log(run('voxels'));

// Peer co-presence probe (stage 3 — ghost phantoms).
//
// Two windows, one room, one world: move the wizard in window A and prove that
// window B sees a phantom that TRACKS it. This cannot be checked from a single
// page, and it cannot be checked from unit tests either — the question stage 3
// exists to answer is whether streamed movement survives a real socket, a real
// frame loop, and two real browsers.
//
// What it proves, hardest-first:
//
//   1. A moving peer produces a phantom that follows, with the interpolation
//      delay accounted for rather than wished away.
//   2. Motion is SMOOTH — sampled repeatedly, the phantom never jumps
//      backwards and never teleports. Jerk is the actual failure mode here;
//      "roughly the right place" is not enough.
//   3. A still peer publishes NOTHING. Co-presence must not turn an idle room
//      into a chatty one.
//   4. A peer on a different world is refused, exactly like a cell patch.
//   5. The phantom is genuinely drawn, not merely tracked in state.
//
// Usage: node scripts/verify-peer-ghosts.mjs [url]   (dev server must be running)
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const room = `ghost-${Date.now().toString(36)}`;
const target = `${url}${url.includes('?') ? '&' : '?'}link=${room}`;

const browser = await launchBrowser();
const errs = [];
const aCtx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const bCtx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const a = await aCtx.newPage();
const b = await bCtx.newPage();
for (const [name, page] of [['a', a], ['b', b]]) {
  page.on('pageerror', (e) => errs.push(`${name}: ${e}`));
}

const boot = async (page) => {
  await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 30000 });
  await page.waitForFunction(() => window.__authorLink?.getStatus().kind === 'connected', {
    timeout: 20000,
  });
};
await boot(a);
await boot(b);
const peersSeen = (page) =>
  page.waitForFunction(() => (window.__authorLink?.getStatus().peers ?? 0) >= 1, { timeout: 20000 });
await peersSeen(a);
await peersSeen(b);
check('both windows joined the same room', true);

// Put BOTH windows in play mode on the SAME world. Without that the poses are
// correctly refused and the probe would be testing the refusal, not the feature.
const intoPlay = async (page) => {
  // Real clicks only — synthetic MouseEvents bypass hit-testing and "succeed"
  // against buttons nothing can actually press. The play button opens the run
  // launcher; starting the run is a second, separate click.
  await page.click('#mode-play-btn');
  await page.waitForSelector('#run-launcher.visible', { timeout: 20000 });
  await page.click('#run-launcher .run-launcher-start');
  await page.waitForFunction(() => document.body.classList.contains('play-active'), null, {
    timeout: 60000,
  });
  // `state.playerSpawned` is the SANDBOX's click-to-place flag and is false on
  // a campaign level; wait for a live player instead.
  await page.waitForFunction(
    () => {
      const p = window.__game.ctx.player;
      return window.__game.ctx.state.mode === 'play' && Number.isFinite(p.x) && p.hp > 0;
    },
    null,
    { timeout: 45000 },
  );
};
await intoPlay(a);
await intoPlay(b);

// Force one shared world so identities match, then let both windows notice.
const worldOf = (page) => page.evaluate(() => window.__authorLink.getWorldState().mine);
let worldA = await worldOf(a);
let worldB = await worldOf(b);
if (JSON.stringify(worldA) !== JSON.stringify(worldB)) {
  // The link already ships a "pull the peer's world" action; use it rather
  // than inventing a second way to agree on a world.
  await b.evaluate(() => window.__authorLink.pullWorldFrom());
  await b.waitForFunction(() => !window.__authorLink.getWorldState().mismatch, { timeout: 30000 });
  worldA = await worldOf(a);
  worldB = await worldOf(b);
}
check('both windows are on the same world', JSON.stringify(worldA) === JSON.stringify(worldB),
  `${JSON.stringify(worldA)} vs ${JSON.stringify(worldB)}`);

// ---------------------------------------------------------------------------
console.log('-- a moving peer becomes a phantom');

// Teleport A somewhere with headroom, then walk it. The player is 17 cells
// tall, so a cramped target wedges him and every movement assertion silently
// passes on a wizard that never moved.
const start = await a.evaluate(() => {
  const ctx = window.__game.ctx;
  return { x: ctx.player.x, y: ctx.player.y };
});

const playerX = () => a.evaluate(() => window.__game.ctx.player.x);

/**
 * Walk, in whichever direction actually has room.
 *
 * A cave wall on the right is not a bug in pose streaming, but it produces a
 * motionless player and therefore a probe that fails for the wrong reason.
 * Pick the direction empirically instead of assuming one.
 */
const walkOpenWay = async (ms) => {
  for (const key of ['d', 'a']) {
    const from = await playerX();
    await a.keyboard.down(key);
    await sleep(Math.min(250, ms));
    if (Math.abs((await playerX()) - from) > 1) {
      await sleep(Math.max(0, ms - 250));
      await a.keyboard.up(key);
      return key;
    }
    await a.keyboard.up(key);
  }
  return null;
};

const walkKey = await walkOpenWay(700);
await sleep(300);
check('the player has somewhere to walk (probe precondition)', walkKey !== null, 'boxed in on both sides');

let seen = false;
try {
  await b.waitForFunction(() => window.__game.ctx.peers.count >= 1, { timeout: 15000 });
  seen = true;
} catch {
  seen = false;
}
check('the peer appears as a phantom', seen, `peers=${await b.evaluate(() => window.__game.ctx.peers.count)}`);

const posA = await a.evaluate(() => ({ x: window.__game.ctx.player.x, y: window.__game.ctx.player.y }));
check('the peer actually moved (probe precondition)', Math.abs(posA.x - start.x) > 3,
  `moved ${(posA.x - start.x).toFixed(1)} cells`);

const ghost = await b.evaluate(() => {
  const g = window.__game.ctx.peers.sample(Date.now());
  return g.length ? { x: g[0].pose.x, y: g[0].pose.y, alpha: g[0].alpha } : null;
});
// The phantom renders ~120ms in the past, so it trails the true position. It
// must be CLOSE, not identical — asserting equality here would be asserting
// that the interpolation delay does not exist.
check(
  'the phantom tracks the peer position',
  ghost !== null && Math.abs(ghost.x - posA.x) < 25 && Math.abs(ghost.y - posA.y) < 25,
  `ghost=${JSON.stringify(ghost)} peer=${JSON.stringify(posA)}`,
);

// ---------------------------------------------------------------------------
console.log('-- motion is smooth, not stepped');

// Walk continuously while sampling the phantom on B. Jerk is the real failure
// mode: a phantom can be in the right place on average and still stutter.
// Re-pick the open direction: the first walk may well have ended against a
// wall, and a cave that runs out is not a defect in pose streaming.
let key = (await walkOpenWay(120)) ?? walkKey ?? 'd';
const sampleStart = await playerX();
const track = [];
const truthTrack = [];
let lastX = sampleStart;
let flipAt = -1;
await a.keyboard.down(key);
for (let k = 0; k < 14; k++) {
  await sleep(70);
  // Sample the peer's TRUE x alongside the phantom's, so "snap" can be judged
  // against what the peer actually did rather than against an assumed walking
  // speed. A wizard sliding down a slope genuinely covers ground fast; that is
  // the level's geometry, not a defect in interpolation.
  const [p, truth] = await Promise.all([
    b.evaluate(() => {
      const g = window.__game.ctx.peers.sample(Date.now());
      return g.length ? g[0].pose.x : null;
    }),
    playerX(),
  ]);
  if (p !== null) track.push(p);
  truthTrack.push(truth);
  // Recover from walking into terrain mid-sample rather than reporting a
  // stalled player as a stalled phantom.
  if (k % 4 === 3) {
    const now = await playerX();
    if (Math.abs(now - lastX) < 0.5) {
      await a.keyboard.up(key);
      key = key === 'd' ? 'a' : 'd';
      await a.keyboard.down(key);
      // Everything after a flip legitimately reverses, so the monotonicity
      // assertion below only covers the run up to here.
      if (flipAt < 0) flipAt = track.length;
    }
    lastX = now;
  }
}
await a.keyboard.up(key);
const sampleEnd = await playerX();

// Direction depends on which way had room; compare against the peer's own
// travel rather than assuming rightward.
// The monotonic run is whatever came before a direction flip (or all of it).
const runEnd = flipAt < 0 ? track.length : flipAt;
const run = track.slice(0, Math.max(2, runEnd));
const peerDelta = sampleEnd - sampleStart;
const ghostSpan = Math.max(...track) - Math.min(...track);
check(
  'the phantom advanced while the peer walked',
  track.length >= 6 && ghostSpan > 3,
  `${track.length} samples, ghost travelled ${ghostSpan.toFixed(1)} cells, peer net ${peerDelta.toFixed(1)}`,
);

let backwards = 0;
let biggestStep = 0;
const forward = Math.sign(run.at(-1) - run[0]) || 1;
for (let k = 1; k < run.length; k++) {
  const step = (run[k] - run[k - 1]) * forward;
  if (step < -0.5) backwards++;
  biggestStep = Math.max(biggestStep, Math.abs(step));
}
check('the phantom never slid backwards while walking forward', backwards === 0,
  `${backwards} reversals across ${run.length} samples${flipAt >= 0 ? ' (before direction flip)' : ''}`);
// At walking speed over ~70ms, a step is a couple of cells. A big one means a
// snap — either a dropped interpolation or a teleport that should not happen.
// The interpolator must not introduce motion the peer did not make. Compare
// against the peer's own largest step over the same window, with headroom for
// the sampling offset between the two pages.
let peerBiggestStep = 0;
for (let k = 1; k < truthTrack.length; k++) {
  peerBiggestStep = Math.max(peerBiggestStep, Math.abs(truthTrack[k] - truthTrack[k - 1]));
}
const allowed = Math.max(30, peerBiggestStep * 1.6 + 8);
check(
  'the phantom never moves further in a step than the peer did',
  biggestStep <= allowed,
  `ghost ${biggestStep.toFixed(1)} vs peer ${peerBiggestStep.toFixed(1)} (allowed ${allowed.toFixed(1)}); track=[${track
    .map((v) => v.toFixed(1))
    .join(', ')}]`,
);

// ---------------------------------------------------------------------------
console.log('-- a still peer says nothing');

await sleep(600);
const before = await a.evaluate(() => window.__authorLink.getStats().sent.peer ?? 0);
await sleep(1500);
const after = await a.evaluate(() => window.__authorLink.getStats().sent.peer ?? 0);
check('an idle window publishes no poses at all', after === before, `${before} -> ${after}`);

// The phantom must still be there — silence means "standing still", not "gone".
const stillThere = await b.evaluate(() => window.__game.ctx.peers.count);
check('the phantom survives a brief silence', stillThere >= 1, `count=${stillThere}`);

// ---------------------------------------------------------------------------
console.log('-- a peer on another world is not in this one');

await b.evaluate(() => {
  // Diverge B's identity deterministically. `console.exec('gen')` looked like
  // the natural way to do this and is NOT: on a campaign level it leaves
  // levelId/biome/seed untouched, so the identities stayed equal and this
  // whole section passed without ever testing a mismatch. The seed is part of
  // WorldIdentity, so changing it is exactly the divergence a level
  // transition produces, with none of the guesswork.
  const state = window.__game.ctx.state;
  state.worldSeed = (state.worldSeed ^ 0x5f5f5f) >>> 0;
});
await b.waitForFunction(() => window.__game.ctx.peers.count === 0, { timeout: 20000 }).catch(() => {});
const afterWorldChange = await b.evaluate(() => window.__game.ctx.peers.count);
check('phantoms are dropped when the world changes underneath', afterWorldChange === 0,
  `count=${afterWorldChange}`);

// Poses from the peer keep arriving; they must be refused, not stamped.
await a.keyboard.down(walkKey ?? 'd');
await sleep(500);
await a.keyboard.up(walkKey ?? 'd');
// Assert the SETTLED state. This window learns its own world changed from a
// 500ms poll (the same one the cells path uses), so a pose arriving inside
// that window is briefly matched against the old identity. What must hold is
// that it does not persist.
let stillRefused = 1;
for (let k = 0; k < 20; k++) {
  await sleep(150);
  stillRefused = await b.evaluate(() => window.__game.ctx.peers.count);
  if (stillRefused === 0) break;
}
await sleep(700);
stillRefused = await b.evaluate(() => window.__game.ctx.peers.count);
const wa = await worldOf(a);
const wb = await worldOf(b);
check('poses for a different world are refused', stillRefused === 0,
  `count=${stillRefused}; A=${JSON.stringify(wa)} B=${JSON.stringify(wb)}`);

// ---------------------------------------------------------------------------
console.log('-- the phantom is actually drawn');

// Everything above proves the pose arrives and is tracked. None of it proves a
// single pixel changed. Inject a phantom right beside B's own wizard — where
// the camera certainly is — and read the canvas with and without it.
//
// The canvas is read inside a rAF callback because `preserveDrawingBuffer` is
// false: sampling outside one returns an empty buffer and this check would
// "pass" against a blank image.
const canvasInk = (page, withGhost) =>
  page.evaluate((on) => {
    const ctx = window.__game.ctx;
    ctx.peers.clear();
    if (on) {
      const p = ctx.player;
      ctx.peers.note('render-probe', {
        x: p.x + 26, y: p.y, facing: 1, vx: 0, vy: 0, stride: 0, aim: 0, flags: 1,
      }, Date.now());
    }
    return new Promise((resolve) => {
      // ONE rAF, and the GL canvas specifically. A nested rAF samples after the
      // buffer has been cleared (`preserveDrawingBuffer` is false) and
      // `querySelector('canvas')` can pick up the minimap instead — either way
      // you measure a black image and the check "passes" against nothing.
      requestAnimationFrame(() => {
        const cv = document.querySelector('#canvas-holder > canvas');
        if (!cv) return resolve(-1);
        const off = document.createElement('canvas');
        off.width = cv.width;
        off.height = cv.height;
        const c2 = off.getContext('2d');
        c2.drawImage(cv, 0, 0);
        const { data } = c2.getImageData(0, 0, off.width, off.height);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
        resolve(sum);
      });
    });
  }, withGhost);

// Take the best of a few frames each way: the scene has its own motion (fire,
// particles), so a single pair could differ for reasons unrelated to us.
const bestInk = async (on) => {
  let best = 0;
  for (let k = 0; k < 4; k++) {
    best = Math.max(best, await canvasInk(b, on));
    await sleep(60);
  }
  return best;
};
const inkWithout = await bestInk(false);
const inkWith = await bestInk(true);
check('the canvas was actually readable', inkWithout > 100000, `ink=${inkWithout}`);
// The phantom is drawn additively, so its presence can only ADD light.
check(
  'drawing a phantom changes what is on screen',
  inkWith > inkWithout,
  `ink ${inkWithout} -> ${inkWith}`,
);
await b.evaluate(() => window.__game.ctx.peers.clear());

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);

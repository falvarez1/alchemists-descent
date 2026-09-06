// AuthorLink two-window probe (Phase 1).
//
// The whole feature is "two windows, one room" — so it cannot be verified from
// a single page. This opens TWO isolated browser contexts against the same dev
// server (which is what a second browser window is, from the relay's point of
// view) and proves the three Phase 1 channels actually move state:
//
//   tuning  a slider change in the editor window lands on the game window
//   cells   a Builder brush stroke stamps real cells in the game window's world
//   cmd     a dev-console line runs on the peer
//
// Usage: node scripts/verify-authorlink.mjs [url]   (dev server must be running)
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

const room = `probe-${Date.now().toString(36)}`;
const withLink = (base) => `${base}${base.includes('?') ? '&' : '?'}link=${room}`;
// The REAL two-window layout: the editor is the /builder.html route (it boots
// straight into the Builder), the game is /. Booting the editor route here is
// itself a check — it once died for weeks because its shell fell behind
// index.html and every probe drove the Builder from / instead.
const editorTarget = withLink(`${url.replace(/\/?$/, '/')}builder.html`);
const gameTarget = withLink(url);

const browser = await launchBrowser();
const errs = [];

// Separate contexts, not just separate tabs: independent storage is what makes
// this a faithful stand-in for "a different browser window".
const editorCtx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const gameCtx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const editor = await editorCtx.newPage();
const game = await gameCtx.newPage();
const linkWarnings = [];
for (const [name, page] of [['editor', editor], ['game', game]]) {
  page.on('pageerror', (e) => errs.push(`${name}: ${e}`));
  // Refusals are console warnings by design; capture them so a failing
  // assertion can say whether the patch was rejected or simply never arrived.
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[authorlink]')) linkWarnings.push(`${name}: ${text}`);
  });
}

const boot = async (page, target) => {
  await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 30000 });
  // The link is installed before Game.start; wait for the socket, not a sleep.
  await page.waitForFunction(() => window.__authorLink?.getStatus().kind === 'connected', { timeout: 20000 });
};

await boot(editor, editorTarget);
await boot(game, gameTarget);
let editorOpened = false;
try {
  await editor.waitForFunction(
    () => document.body.classList.contains('builder-open') && !!document.getElementById('builder-canvas'),
    { timeout: 30000 },
  );
  editorOpened = true;
} catch {
  editorOpened = false;
}
check(
  'the /builder.html route boots straight into the Builder',
  editorOpened,
  await editor.evaluate(() => document.getElementById('boot-status')?.textContent ?? ''),
);

// Both windows must see each other before any publish, or the first message
// races the join and the probe goes flaky for reasons that are not bugs.
const peersSeen = async (page) =>
  page.waitForFunction(() => (window.__authorLink?.getStatus().peers ?? 0) >= 1, { timeout: 20000 });
await peersSeen(editor);
await peersSeen(game);
check('both windows joined the same room', true);

// ---------------------------------------------------------------------------
console.log('-- tuning: a param change in the editor window reaches the game window');
const before = await game.evaluate(() => window.__game.ctx.params.global.ambient);
const wanted = Number((before + 0.07).toFixed(4));
await editor.evaluate((value) => {
  window.__game.ctx.params.global.ambient = value;
  window.__game.ctx.events.emit('paramsChanged');
}, wanted);
let applied = false;
try {
  await game.waitForFunction(
    (value) => Math.abs(window.__game.ctx.params.global.ambient - value) < 1e-6,
    wanted,
    { timeout: 8000 },
  );
  applied = true;
} catch {
  applied = false;
}
const gameAmbient = await game.evaluate(() => window.__game.ctx.params.global.ambient);
check('remote tuning applied', applied, `expected ${wanted}, got ${gameAmbient}`);

console.log('-- tuning: the reverse direction works too (symmetric peers)');
const back = Number((wanted + 0.03).toFixed(4));
await game.evaluate((value) => {
  window.__game.ctx.params.global.ambient = value;
  window.__game.ctx.events.emit('paramsChanged');
}, back);
let reverse = false;
try {
  await editor.waitForFunction(
    (value) => Math.abs(window.__game.ctx.params.global.ambient - value) < 1e-6,
    back,
    { timeout: 8000 },
  );
  reverse = true;
} catch {
  reverse = false;
}
check('tuning flows game -> editor', reverse);

console.log('-- tuning: no echo storm (revision settles instead of climbing)');
await editor.waitForTimeout(1500);
const revA = await editor.evaluate(() => window.__authorLink.getStatus().revision);
await editor.waitForTimeout(1500);
const revB = await editor.evaluate(() => window.__authorLink.getStatus().revision);
check('revision stops climbing once idle', revA === revB, `${revA} -> ${revB}`);

// ---------------------------------------------------------------------------
console.log('-- worlds: two windows start on unrelated worlds and know it');
// Force a guaranteed divergence: different seeds means different levels, even
// though every world in the game is the same 1600x1064.
await editor.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.currentBiome = 'earthen';
  ctx.state.worldSeed = 111111;
  ctx.worldgen.generateCaves(ctx);
});
await game.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.currentBiome = 'earthen';
  ctx.state.worldSeed = 222222;
  ctx.worldgen.generateCaves(ctx);
  ctx.state.paused = true;
  // Hard-stop the clock, not just `paused`: cell-for-cell comparisons must not
  // race the simulation, which will happily act on anything we stamp.
  ctx.time.setManual(true);
});
let sawMismatch = false;
try {
  await editor.waitForFunction(() => window.__authorLink.getWorldState().mismatch === true, { timeout: 10000 });
  sawMismatch = true;
} catch {
  sawMismatch = false;
}
const worldState = await editor.evaluate(() => window.__authorLink.getWorldState());
check('the link reports a world mismatch', sawMismatch, JSON.stringify(worldState));

const pillMismatch = await editor.evaluate(() => {
  const el = document.getElementById('authorlink-status');
  return el ? { text: el.textContent, state: el.dataset.state, disabled: el.disabled } : null;
});
check(
  'the pill goes amber and becomes clickable',
  pillMismatch?.state === 'mismatch' && pillMismatch.disabled === false,
  JSON.stringify(pillMismatch),
);

console.log('-- worlds: an edit across mismatched worlds is REFUSED, not stamped');
const refusedProbe = await game.evaluate(() => {
  const world = window.__game.ctx.world;
  const i = world.idx(50, 50);
  return { i, before: world.types[i] };
});
await editor.evaluate((i) => {
  window.__authorLink.publishTerrainPatch(
    { idxs: [i], types: [13], colors: [0x8a8a92], life: [0], charge: [0] },
    'cross-world probe',
  );
}, refusedProbe.i);
await game.waitForTimeout(1500);
const afterRefusal = await game.evaluate((i) => window.__game.ctx.world.types[i], refusedProbe.i);
check(
  'cross-world stroke did not land',
  afterRefusal === refusedProbe.before,
  `cell ${refusedProbe.i}: ${refusedProbe.before} -> ${afterRefusal}`,
);

console.log('-- worlds: pulling the peer world puts both windows on the same level');
// Freeze the RECEIVING clock too. A pulled world starts simulating the instant
// it lands — sand falls, water finds its level — so a cell-for-cell comparison
// against a frozen sender is measuring the sim, not the transfer.
await editor.evaluate(() => window.__game.ctx.time.setManual(true));
const pulled = await editor.evaluate(() => window.__authorLink.pullWorldFrom());
check('pull reported success', pulled === true);
let converged = false;
try {
  await editor.waitForFunction(() => window.__authorLink.getWorldState().mismatch === false, { timeout: 15000 });
  converged = true;
} catch {
  converged = false;
}
check('the mismatch cleared after the pull', converged, JSON.stringify(await editor.evaluate(() => window.__authorLink.getWorldState())));

// The grids must actually agree now, not just the labels. Compare EVERY cell
// via a checksum rather than a sample: a 0.25% sampled difference is
// indistinguishable from noise, and this transfer either is exact or is not.
const digest = async (page) =>
  page.evaluate(() => {
    const t = window.__game.ctx.world.types;
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t[i], 16777619) >>> 0;
    let nonEmpty = 0;
    for (let i = 0; i < t.length; i++) if (t[i] !== 0) nonEmpty++;
    return { h, nonEmpty, cells: t.length };
  });
const gameDigest = await digest(game);
const editorDigest = await digest(editor);
check(
  `the pulled grid is cell-for-cell identical (${gameDigest.cells} cells)`,
  gameDigest.h === editorDigest.h,
  `game=${JSON.stringify(gameDigest)} editor=${JSON.stringify(editorDigest)}`,
);

console.log('-- cells: a real Builder brush stroke stamps real cells in the game window');
// The editor route opened the Builder at boot; the pull above landed in the
// grid it is editing. Give the overlay a beat to settle before real clicks.
await editor.waitForTimeout(700);
const objectsSentBeforeStroke = await editor.evaluate(() => window.__authorLink.getStats().sent.objects ?? 0);

// The receiving world is already paused (above). The transport is what is under
// test; a running sim would let a liquid stroke flow out from under the indices
// we are about to check and read as a transport failure.

// Tap the handle the Builder host actually calls, so the recorded patch is
// exactly what went on the wire. The two windows boot different random worlds,
// so only the PUBLISHED cells may be compared — a whole-region diff would just
// be measuring two unrelated cave systems.
await editor.evaluate(() => {
  window.__sentPatches = [];
  const link = window.__authorLink;
  const original = link.publishTerrainPatch.bind(link);
  link.publishTerrainPatch = (patch, label) => {
    window.__sentPatches.push({ idxs: [...patch.idxs], types: [...patch.types], label });
    original(patch, label);
  };
});

// Real clicks and a real drag (per the repo's probe rules — synthetic events
// bypass hit-testing and would "pass" against a dead canvas). This exercises
// the true path: pointer -> PatchRecorder -> CommandStack -> host -> wire.
await editor.click('.bp-tool[data-tool="paint"]');
// Metal, because `spawnCircle` refuses LOOSE materials over Wall/Metal — a
// sand stroke across solid cave rock legitimately changes ~nothing, and the
// probe would be measuring the brush's protection rule, not the link.
await editor.evaluate(() => {
  window.__game.ctx.state.activeInputMode = 'element';
  window.__game.ctx.state.currentElement = 13;
  window.__game.ctx.state.brushSize = 8;
});
await editor.waitForTimeout(150);

const canvasBox = await editor.locator('#builder-canvas').boundingBox();
if (!canvasBox) throw new Error('builder canvas has no box');
const cx = canvasBox.x + canvasBox.width * 0.5;
const cy = canvasBox.y + canvasBox.height * 0.5;
await editor.mouse.move(cx - 60, cy);
await editor.mouse.down();
await editor.mouse.move(cx + 60, cy, { steps: 12 });
await editor.mouse.up();
await editor.waitForTimeout(500);

const stroke = await editor.evaluate(() => {
  const sent = window.__sentPatches ?? [];
  if (sent.length === 0) return null;
  // One drag can land as several commands; flatten them all.
  const idxs = [];
  const types = [];
  for (const p of sent) {
    idxs.push(...p.idxs);
    types.push(...p.types);
  }
  return { idxs, types, commands: sent.length };
});
check('the brush drag published a stroke through the host', Boolean(stroke && stroke.idxs.length > 0), JSON.stringify(stroke?.commands ?? 0));

if (stroke) {
  let agreed = false;
  try {
    await game.waitForFunction(
      (s) => {
        const world = window.__game.ctx.world;
        for (let n = 0; n < s.idxs.length; n++) if (world.types[s.idxs[n]] !== s.types[n]) return false;
        return true;
      },
      stroke,
      { timeout: 10000 },
    );
    agreed = true;
  } catch {
    agreed = false;
  }
  const mismatchCount = await game.evaluate((s) => {
    const world = window.__game.ctx.world;
    let n = 0;
    for (let k = 0; k < s.idxs.length; k++) if (world.types[s.idxs[k]] !== s.types[k]) n++;
    return n;
  }, stroke);
  check(
    `the game window replayed all ${stroke.idxs.length} painted cells`,
    agreed,
    `${mismatchCount} cells differ`,
  );

  // The stroke above proves cells ARRIVED, not that they took the packed
  // route — a silent fallback to JSON would satisfy every assertion so far.
  const editorBinary = await editor.evaluate(() => window.__authorLink.getStats().binary);
  const gameBinary = await game.evaluate(() => window.__authorLink.getStats().binary);
  check(
    'the stroke went over the binary stream plane, not JSON',
    editorBinary.sentFrames > 0 && gameBinary.receivedFrames > 0,
    `sent=${editorBinary.sentFrames} received=${gameBinary.receivedFrames}`,
  );
  // 13 bytes/cell packed vs ~26 as JSON digits; the header is a rounding error.
  const perCell = gameBinary.receivedBytes / Math.max(1, stroke.idxs.length);
  check(
    'the packed frame costs about 13 bytes per cell',
    perCell > 12 && perCell < 16,
    `${perCell.toFixed(1)} B/cell over ${gameBinary.receivedBytes}B`,
  );
} else {
  check('the game window replayed the painted cells', false, 'no patch was published');
}
// A terrain stroke used to re-publish the WHOLE authored set (tearing down and
// re-instantiating every synced object in the tester's level on every brush
// drag). The set now goes out only when objects/links/lights actually changed.
const objectsSentAfterStroke = await editor.evaluate(() => window.__authorLink.getStats().sent.objects ?? 0);
check(
  'a terrain stroke does not re-publish the authored set',
  objectsSentAfterStroke === objectsSentBeforeStroke,
  `objects sent ${objectsSentBeforeStroke} -> ${objectsSentAfterStroke}`,
);

console.log('-- cells: the receiving window reports the edit as a world change');
// Arm the listener first, then publish, so there is no race with the send.
const worldEditedPromise = game.evaluate(
  () =>
    new Promise((resolve) => {
      const off = window.__game.ctx.events.on('worldEdited', (e) => {
        off();
        resolve(e.source);
      });
      setTimeout(() => {
        off();
        resolve(null);
      }, 8000);
    }),
);
await editor.waitForTimeout(200);
await editor.evaluate(() => {
  const world = window.__game.ctx.world;
  const idxs = [world.idx(30, 30), world.idx(31, 30)];
  window.__authorLink.publishTerrainPatch(
    { idxs, types: [13, 13], colors: [0x8a8a92, 0x8a8a92], life: [0, 0], charge: [0, 0] },
    'probe stroke',
  );
});
const sawWorldEdited = await worldEditedPromise;
// On failure, say WHY: a refused patch and a lost patch look identical from
// the assertion alone, and the difference is the whole point of this feature.
const editedDetail =
  sawWorldEdited === 'authorlink'
    ? ''
    : `source=${sawWorldEdited} editorStatus=${JSON.stringify(
        await editor.evaluate(() => window.__authorLink.getStatus()),
      )} gameStatus=${JSON.stringify(await game.evaluate(() => window.__authorLink.getStatus()))} editor=${JSON.stringify(
        await editor.evaluate(() => window.__authorLink.getWorldState().mine),
      )} game=${JSON.stringify(await game.evaluate(() => window.__authorLink.getWorldState().mine))} warns=${JSON.stringify(linkWarnings.slice(-4))}`;
check('worldEdited fired with the authorlink source', sawWorldEdited === 'authorlink', editedDetail);

// ---------------------------------------------------------------------------
console.log('-- objects: authored records instantiate in the peer, wired');
// Authored objects need a level runtime to live in. Creating one flips the
// game's world identity to `custom`, so the editor must re-sync afterwards —
// which is exactly the real-world sequence when someone starts a playtest.
await game.evaluate(() => window.__game.ctx.levels.playCurrentWorld(window.__game.ctx));
await game.waitForFunction(() => window.__game.ctx.levels.current !== null, { timeout: 20000 });
await editor.waitForFunction(() => window.__authorLink.getWorldState().mismatch === true, { timeout: 15000 });
check('starting a runtime is detected as a world change', true);

console.log('-- worlds: a window PLAYING a live level refuses to pull a foreign grid over it');
// Both windows show the amber pill on a mismatch, but pulling into the play
// window would drop the editor's cells under the tester's live runtime — its
// exit, mechanisms and pickups would stay where the OLD level put them.
const playPull = await game.evaluate(async () => {
  const state = window.__authorLink.getWorldState();
  const ok = await window.__authorLink.pullWorldFrom();
  return { canPull: state.canPull, reason: state.pullBlockedReason ?? null, ok, level: window.__game.ctx.levels.current?.def.id ?? null };
});
check(
  'the play window reports it cannot pull, and the pull is refused',
  playPull.canPull === false && playPull.ok === false && playPull.level !== null,
  JSON.stringify(playPull),
);

await editor.evaluate(() => window.__authorLink.pullWorldFrom());
await editor.waitForFunction(() => window.__authorLink.getWorldState().mismatch === false, { timeout: 20000 });
const runtimeBaseline = await game.evaluate(() => ({
  mechanisms: window.__game.ctx.levels.current.mechanisms.length,
  pickups: window.__game.ctx.levels.current.pickups.length,
  bats: window.__game.ctx.enemies.filter((e) => e.kind === 'bat').length,
}));

// A lever wired to a door: the pair proves BOTH instantiation and link wiring,
// and the trigger index is the thing most likely to be left stale. The bat
// proves enemies are tracked too: an authored enemy that teardown cannot find
// is a duplicate on every re-publish. An exact spawn needs open air (the
// door and lever stamp their own cells; an enemy does not), so find a pocket
// in the game window's generated cave rather than guessing a coordinate.
const batSpot = await game.evaluate(() => {
  const ctx = window.__game.ctx;
  for (let y = 60; y < 500; y += 2) {
    for (let x = 60; x < 800; x += 2) {
      if (ctx.physics.entityFree(x, y, 5, 10)) return { x, y };
    }
  }
  return { x: 160, y: 120 };
});
const authored = {
  objects: [
    { id: 'door-1', kind: 'door', x: 120, y: 120, rotation: 0, locked: false, hidden: false, params: { w: 3, h: 12 } },
    { id: 'lever-1', kind: 'lever', x: 140, y: 128, rotation: 0, locked: false, hidden: false, params: {} },
    { id: 'bat-1', kind: 'enemy', x: batSpot.x, y: batSpot.y, rotation: 0, locked: false, hidden: false, params: { kind: 'bat' } },
  ],
  links: [{ id: 'link-1', kind: 'triggerDoor', fromId: 'lever-1', toId: 'door-1' }],
  lights: [],
};
await editor.evaluate((set) => window.__authorLink.publishAuthoredSet(set), authored);

let objectsLanded = false;
try {
  await game.waitForFunction(
    (base) => {
      const rt = window.__game.ctx.levels.current;
      return rt && rt.mechanisms.length >= base.mechanisms + 2;
    },
    runtimeBaseline,
    { timeout: 10000 },
  );
  objectsLanded = true;
} catch {
  objectsLanded = false;
}
const runtimeAfter = await game.evaluate(() => {
  const rt = window.__game.ctx.levels.current;
  const kinds = rt.mechanisms.map((m) => m.kind);
  const door = rt.mechanisms.find((m) => m.kind === 'door');
  const lever = rt.mechanisms.find((m) => m.kind === 'lever');
  return {
    mechanisms: rt.mechanisms.length,
    kinds,
    triggerEntries: rt.mechanismTriggers ? rt.mechanismTriggers.size : 0,
    // The link is real only if the lever's target resolves to the door's id.
    wired: Boolean(door && lever && lever.targetId === door.id),
    doorCell: door ? window.__game.ctx.world.types[window.__game.ctx.world.idx(door.x, door.y)] : null,
  };
});
check('authored objects instantiated in the peer', objectsLanded, JSON.stringify(runtimeAfter));
check('the door/lever link is wired on the peer', runtimeAfter.wired, JSON.stringify(runtimeAfter));
check('the trigger index was rebuilt', runtimeAfter.triggerEntries > 0, `entries=${runtimeAfter.triggerEntries}`);
check(
  'the door stamped real cells',
  runtimeAfter.doorCell !== null && runtimeAfter.doorCell !== 0,
  `cell=${runtimeAfter.doorCell}`,
);
const batsAfter = await game.evaluate(() => window.__game.ctx.enemies.filter((e) => e.kind === 'bat').map((e) => e.sourceId ?? null));
check(
  'the authored enemy spawned and carries its record id',
  batsAfter.length === runtimeBaseline.bats + 1 && batsAfter.includes('bat-1'),
  JSON.stringify(batsAfter),
);

console.log('-- objects: re-publishing the SAME set neither duplicates nor leaks');
await editor.evaluate((set) => window.__authorLink.publishAuthoredSet(set), authored);
await game.waitForTimeout(1200);
const republished = await game.evaluate((base) => {
  const rt = window.__game.ctx.levels.current;
  return {
    mechanisms: rt.mechanisms.length,
    expected: base.mechanisms + 2,
    bats: window.__game.ctx.enemies.filter((e) => e.kind === 'bat').length,
    expectedBats: base.bats + 1,
  };
}, runtimeBaseline);
check(
  'an identical re-publish leaves exactly one copy of each object',
  republished.mechanisms === republished.expected && republished.bats === republished.expectedBats,
  JSON.stringify(republished),
);

console.log('-- objects: clearing the set removes them AND their stamped cells');
await editor.evaluate(() =>
  window.__authorLink.publishAuthoredSet({ objects: [], links: [], lights: [] }),
);
let tornDown = false;
try {
  await game.waitForFunction(
    (base) => window.__game.ctx.levels.current.mechanisms.length === base.mechanisms,
    runtimeBaseline,
    { timeout: 10000 },
  );
  tornDown = true;
} catch {
  tornDown = false;
}
const afterTeardown = await game.evaluate(() => ({
  mechanisms: window.__game.ctx.levels.current.mechanisms.length,
  // The door's metal must be gone, not welded into the terrain forever.
  cellAtDoor: window.__game.ctx.world.types[window.__game.ctx.world.idx(120, 120)],
}));
check('authored objects removed on an empty set', objectsLanded && tornDown, JSON.stringify(afterTeardown));
check(
  'stamped cells were restored',
  objectsLanded && afterTeardown.cellAtDoor !== 13,
  `cell=${afterTeardown.cellAtDoor}`,
);
const batsAfterTeardown = await game.evaluate(() => window.__game.ctx.enemies.filter((e) => e.kind === 'bat').length);
check('the authored enemy was removed with the set', batsAfterTeardown === runtimeBaseline.bats, `bats=${batsAfterTeardown}`);

console.log('-- mirror: the playing window streams its simulation into the editor');
// The editor's own sim is paused for authoring, so the only way its grid can
// show sand FALLING is the mirror. Sand is placed in the GAME through the
// world API (which touches the activity grid the way the sim does), inside
// the play window's sim bounds (they follow the player), the clock runs for
// a moment, and then the region must agree cell for cell in both windows.
const mirrorSpot = await game.evaluate(() => {
  const ctx = window.__game.ctx;
  const px = Math.floor(ctx.player.x);
  const py = Math.floor(ctx.player.y);
  for (let r = 20; r < 220; r += 6) {
    for (let dy = -r; dy <= r; dy += 4) {
      for (let dx = -r; dx <= r; dx += 4) {
        const x = px + dx;
        const y = py + dy;
        // A 5x14 pocket of air: room for the sand to be placed AND to fall.
        if (ctx.physics.entityFree(x, y, 3, 14)) return { x, y };
      }
    }
  }
  return null;
});
check('found an air pocket near the player to drop sand into', mirrorSpot !== null);
if (mirrorSpot) {
  const sandTop = { x: mirrorSpot.x, y: mirrorSpot.y - 12 };
  await game.evaluate(({ x, y }) => {
    const w = window.__game.ctx.world;
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (w.inBounds(x + dx, y + dy)) w.replaceCellAt(w.idx(x + dx, y + dy), 1, 0xd2b48c);
      }
    }
  }, sandTop);
  const editorCellsBefore = await editor.evaluate(() => window.__authorLink.getStats().received.cells ?? 0);
  await game.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.time.setManual(false);
    ctx.state.paused = false;
  });
  let sawReceiving = false;
  for (let i = 0; i < 20 && !sawReceiving; i++) {
    await editor.waitForTimeout(100);
    sawReceiving = await editor.evaluate(() => window.__authorLink.getWorldState().mirror === 'receiving');
  }
  const sending = await game.evaluate(() => window.__authorLink.getWorldState().mirror);
  await game.waitForTimeout(1200);
  await game.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.state.paused = true;
    ctx.time.setManual(true);
  });
  // The last frames are still in flight; the sweep also needs a moment.
  await game.waitForTimeout(900);
  check('the play window reports it is streaming its simulation', sending === 'sending', `mirror=${sending}`);
  check('the editor saw itself receiving the mirror', sawReceiving);
  const editorCellsAfter = await editor.evaluate(() => window.__authorLink.getStats().received.cells ?? 0);
  check('mirror frames arrived in the editor', editorCellsAfter > editorCellsBefore, `${editorCellsBefore} -> ${editorCellsAfter}`);
  const region = (page) =>
    page.evaluate(({ x, y }) => {
      const w = window.__game.ctx.world;
      let h = 2166136261;
      let sand = 0;
      let placedRows = 0;
      for (let yy = y - 6; yy < y + 40; yy++) {
        for (let xx = x - 24; xx <= x + 24; xx++) {
          if (!w.inBounds(xx, yy)) continue;
          const t = w.types[w.idx(xx, yy)];
          h = Math.imul(h ^ t, 16777619) >>> 0;
          if (t === 1) {
            sand++;
            if (yy < y + 3) placedRows++;
          }
        }
      }
      return { h, sand, placedRows };
    }, sandTop);
  const gameRegion = await region(game);
  const editorRegion = await region(editor);
  check('the sand fell in the play window', gameRegion.sand > 0 && gameRegion.placedRows < 15, JSON.stringify(gameRegion));
  check(
    'the editor shows the SAME fallen sand, cell for cell',
    gameRegion.h === editorRegion.h && editorRegion.sand === gameRegion.sand,
    `game=${JSON.stringify(gameRegion)} editor=${JSON.stringify(editorRegion)}`,
  );
}

console.log('-- objects: a peer set for a different world is refused');
await game.evaluate(() => {
  window.__game.ctx.state.worldSeed = 4242424;
});
await editor.waitForTimeout(1200); // let the identity poll notice
const beforeRefuse = await game.evaluate(() => window.__game.ctx.levels.current.mechanisms.length);
await editor.evaluate((set) => window.__authorLink.publishAuthoredSet(set), authored);
await game.waitForTimeout(1500);
const afterRefuse = await game.evaluate(() => window.__game.ctx.levels.current.mechanisms.length);
check('cross-world authored set did not instantiate', beforeRefuse === afterRefuse, `${beforeRefuse} -> ${afterRefuse}`);

// ---------------------------------------------------------------------------
console.log('-- cmd: a dev-console line runs on the peer');
await game.evaluate(() => {
  window.__probeGold = window.__game.ctx.state.score;
});
await editor.evaluate(() => window.__authorLink.publishCommand('gold 777'));
let ranCommand = false;
try {
  await game.waitForFunction(() => window.__game.ctx.state.score === 777, { timeout: 8000 });
  ranCommand = true;
} catch {
  ranCommand = false;
}
const score = await game.evaluate(() => window.__game.ctx.state.score);
check('remote console command executed', ranCommand, `score=${score}`);

// ---------------------------------------------------------------------------
console.log('-- resilience: a malformed patch is refused, not applied');
const survived = await game.evaluate(() => !!window.__game?.ctx?.world);
await editor.evaluate(() => {
  // Reach past the typed helper on purpose: this is the "a peer sent garbage"
  // case, which must be rejected by the receiver rather than trusted.
  window.__authorLink.publishTerrainPatch(
    { idxs: [10], types: [250], colors: [0], life: [0], charge: [0] },
    'garbage',
  );
});
await game.waitForTimeout(1200);
const stillAlive = await game.evaluate(
  () => !!window.__game?.ctx?.world && window.__game.ctx.world.types[10] !== 250,
);
check('game window survived and refused an out-of-ABI cell id', survived && stillAlive);

console.log('-- status: with worlds agreed, the pill is back to the peer count');
// The refusal test above deliberately desynced them; put them back first.
await editor.waitForFunction(() => window.__authorLink.getWorldState().mismatch === true, { timeout: 15000 });
await editor.evaluate(() => window.__authorLink.pullWorldFrom());
await editor.waitForFunction(() => window.__authorLink.getWorldState().mismatch === false, { timeout: 20000 });
const pill = await editor.evaluate(() => {
  const el = document.getElementById('authorlink-status');
  return el ? { text: el.textContent, state: el.dataset.state } : null;
});
// The pill may still carry a mirror arrow (⇣ receiving) for a moment after the
// last frame; the peer count is what this asserts.
check('link pill shows connected with a peer', pill?.state === 'connected' && /LINK\s+[⇣⇡]?1/.test(pill.text ?? ''), JSON.stringify(pill));

// ---------------------------------------------------------------------------
console.log('-- resilience: the room is genuinely idle after all that traffic');
// This runs LAST on purpose. An identical check near the top passed while a
// feedback loop was still latent, because the loop only started once the world
// handshake had run. Idle means idle at the END, after every channel has fired.
//
// It counts what the clients SEND, not the room revision: a client's revision
// only advances when it receives something, so a heartbeat pong makes it jump
// several counts at once with nobody actually talking. Sent-counters measure
// the thing that matters — is anyone generating traffic on their own?
const chatter = async (page) =>
  page.evaluate(() => {
    const sent = window.__authorLink.getStats().sent;
    // Heartbeats are supposed to tick; everything else must be user-driven.
    return Object.entries(sent)
      .filter(([type]) => type !== 'ping' && type !== 'pong')
      .reduce((n, [, count]) => n + count, 0);
  });
const beforeIdle = (await chatter(editor)) + (await chatter(game));
await editor.waitForTimeout(4000);
const afterIdle = (await chatter(editor)) + (await chatter(game));
const finalStatus = await editor.evaluate(() => window.__authorLink.getStatus());
check(
  'neither window sends anything unprompted while idle',
  afterIdle === beforeIdle,
  `${beforeIdle} -> ${afterIdle} messages; editorSent=${JSON.stringify(
    await editor.evaluate(() => window.__authorLink.getStats().sent),
  )} gameSent=${JSON.stringify(await game.evaluate(() => window.__authorLink.getStats().sent))}`,
);
check(
  'no rate-limit was ever hit',
  !String(finalStatus.detail ?? '').includes('rate-limit'),
  JSON.stringify(finalStatus),
);

check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

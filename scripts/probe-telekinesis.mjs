// Telekinesis + physical corpses probe (combat/Telekinesis, creatures/corpses).
// Real keys and a real mouse drive the verb: E lifts the body under the
// cursor, the cursor swings it, E sets it down, F / right-click hurls it.
// Each scene carves a fresh arena in physics-test, stages creatures and
// materials (contained in metal), and polls the outcome.
//
//   node scripts/probe-telekinesis.mjs [url] [--scenes lift,hurl,...] [--out dir]
//
// Scenes: lift, hurl, kick-water, oil-fire, lava, acid, freeze, plate, snapjaw, shock, blast, crate, audio,
// looks (held / flying / resting crops per kind; --kinds a,b).
// Writes PNG frames + strips and probe.json to --out (verify-out/telekinesis).
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const scenes = opt('scenes', 'lift,hurl,kick-water,oil-fire,lava,acid,freeze,plate,snapjaw,shock,blast,crate,audio').split(',');
const out = opt('out', 'verify-out/telekinesis');
mkdirSync(out, { recursive: true });

const VIEW_W = 640, VIEW_H = 360;
const results = {};
globalThis.window = globalThis;
const errors = [];

async function worldToClient(page, wx, wy) {
  return page.evaluate(({ wx, wy, VIEW_W, VIEW_H }) => {
    const ctx = window.__game.ctx, cam = ctx.camera;
    const canvas = document.querySelector('#canvas-holder > canvas');
    const r = canvas.getBoundingClientRect();
    const zoom = cam.zoom;
    const fracX = cam.x - Math.floor(cam.x), fracY = cam.y - Math.floor(cam.y);
    const scaleX = (1 + 4 / VIEW_W) * zoom, scaleY = (1 + 4 / VIEW_H) * zoom;
    const offsetX = -fracX * (2 / VIEW_W) * zoom, offsetY = fracY * (2 / VIEW_H) * zoom;
    const texU = (wx - cam.renderX + 0.5) / VIEW_W, texV = (wy - cam.renderY + 0.5) / VIEW_H;
    const ndcX = offsetX + (texU - 0.5) * 2 * scaleX;
    const ndcY = offsetY - (texV - 0.5) * 2 * scaleY;
    return { x: r.left + ((ndcX + 1) / 2) * r.width, y: r.top + ((1 - ndcY) / 2) * r.height };
  }, { wx, wy, VIEW_W, VIEW_H });
}

async function mouseTo(page, wx, wy, steps = 1) {
  const p = await worldToClient(page, wx, wy);
  await page.mouse.move(p.x, p.y, { steps });
}

async function shot(page, name) {
  const file = `${out}/${name}.png`;
  await page.locator('#canvas-holder > canvas').first().screenshot({ path: file });
  return file;
}

async function strip(files, name, crop) {
  const metas = await Promise.all(files.map(f => sharp(f).metadata()));
  const cw = crop?.w ?? metas[0].width, ch = crop?.h ?? metas[0].height;
  const left = crop?.x ?? 0, top = crop?.y ?? 0;
  const w = Math.round(cw * 0.6), h = Math.round(ch * 0.6);
  const tiles = await Promise.all(files.map(f => sharp(f).extract({ left, top, width: cw, height: ch }).resize(w, h).png().toBuffer()));
  const cols = Math.min(4, tiles.length), rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: w * cols, height: h * rows, channels: 3, background: '#000' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * w, top: Math.floor(i / cols) * h })))
    .png().toFile(`${out}/${name}.png`);
}

/** A fresh stone box around the player; returns {cx, floor}. Mechanisms parked. */
async function arena(page, { width = 360, height = 120 } = {}) {
  return page.evaluate(({ width, height }) => {
    const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
    ctx.enemies.length = 0;
    for (const c of [...ctx.critters.list]) ctx.critters.remove?.(c);
    if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0;
    for (const c of ctx.corpses.list) c.gone = true;
    const cx = window.__tkArena?.cx ?? Math.max(260, Math.min(w.width - 260, Math.floor(p.x)));
    const floor = window.__tkArena?.floor ?? Math.max(170, Math.min(w.height - 30, Math.floor(p.y)));
    window.__tkArena = { cx, floor };
    const hw = width / 2;
    for (let y = floor - height - 6; y <= floor + 8; y++) for (let x = cx - hw - 8; x <= cx + hw + 8; x++) {
      if (!w.inBounds(x, y)) continue;
      const wall = y > floor || y < floor - height || x < cx - hw || x > cx + hw;
      w.replaceCellAt(w.idx(x, y), wall ? 12 : 0, wall ? 0x565d63 : 0);
    }
    for (const b of [...ctx.rigidBodies.bodies]) ctx.rigidBodies.remove(b);
    p.x = cx - 40; p.y = floor; p.vx = 0; p.vy = 0; p.hp = p.maxHp = 9999; p.invuln = 0;
    const wand = ctx.wands.wands[ctx.wands.active]; wand.mana = wand.frame.manaMax;
    ctx.camera.zoomLock = 2.4; ctx.camera.actionFocus = null;
    window.__tkLog = window.__tkLog ?? [];
    window.__tkLog.length = 0;
    if (!window.__tkHooked) {
      window.__tkHooked = true;
      for (const ev of ['telekinesis', 'corpseMoment', 'alchemyKill', 'enemyKilled', 'combatCallout', 'organism', 'hintTeach']) {
        ctx.events.on(ev, (d) => { if (ev === 'telekinesis' && d.phase === 'hold') return; window.__tkLog.push({ ev, t: ctx.state.frameCount, ...d }); });
      }
    }
    return { cx, floor };
  }, { width, height });
}

/** Spawn and kill creatures; returns nothing (the corpses settle). */
async function corpsesOf(page, kinds, settle = 500) {
  await page.evaluate((kinds) => {
    const ctx = window.__game.ctx, { cx, floor } = window.__tkArena;
    const es = kinds.map(([kind, dx, dy]) => ctx.enemyCtl.spawn(kind, cx + dx, floor + (dy ?? 0)));
    window.__tkVictims = es;
  }, kinds);
  await page.waitForTimeout(settle);
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    for (const e of window.__tkVictims) if (e && ctx.enemies.includes(e)) ctx.enemyCtl.kill(e, 0.3, -0.6);
  });
  await page.waitForTimeout(1400);
}

async function corpseInfo(page, kind) {
  return page.evaluate((kind) => {
    const ctx = window.__game.ctx;
    const c = ctx.corpses.list.find(k => k.e.kind === kind && !k.gone);
    if (!c) return null;
    let x = 0, y = 0, n = 0;
    const pts = [];
    if (c.e.weaverLoco) { x = c.e.weaverLoco.px; y = c.e.weaverLoco.py; n = 1; }
    else if (c.e.rig && (c.e.rig.pts.length || c.e.rig.chains.length || c.e.rig.soft)) {
      const all = [...c.e.rig.pts, ...c.e.rig.chains.flatMap(ch => ch.pts), ...(c.e.rig.soft?.pts ?? [])];
      for (const p of all) { x += p.x; y += p.y; n++; pts.push([p.x, p.y]); }
      x /= n || 1; y /= n || 1;
    } else if (c.e.body) { for (const nd of c.e.body.nodes) { x += nd.x; y += nd.y; n++; } x /= n; y /= n; }
    return { x, y, grip: !!c.grip, burn: c.burn, frozen: c.frozen, char: c.char, age: c.age, ttl: c.ttl, gone: c.gone, fate: c.fate, pvx: c.pvx, pvy: c.pvy, mass: c.mass };
  }, kind);
}

async function log(page) {
  return page.evaluate(() => window.__tkLog.slice());
}


/** A metal basin on the arena floor (inner x0..x1, depth), filled with `cell`. */
async function basin(page, x0, x1, depth, cell, fill = depth - 3) {
  await page.evaluate(({ x0, x1, depth, cell, fill }) => {
    const ctx = window.__game.ctx, w = ctx.world, { cx, floor } = window.__tkArena;
    // A metal-lined basin: acid eats stone, and the pool must stay put.
    for (let y = floor + 1; y <= floor + 2; y++) for (let x = cx + x0 - 2; x <= cx + x1 + 2; x++) w.replaceCellAt(w.idx(x, y), 13, 0x6f7a88);
    for (let y = floor - depth; y <= floor; y++) {
      for (const x of [cx + x0 - 2, cx + x0 - 1, cx + x1 + 1, cx + x1 + 2]) w.replaceCellAt(w.idx(x, y), 13, 0x6f7a88);
      for (let x = cx + x0; x <= cx + x1; x++) {
        if (y > floor - fill) w.replaceCellAt(w.idx(x, y), cell, cell === 2 ? 0x2a5f8a : cell === 6 ? 0x3a2d23 : cell === 11 ? 0xff3010 : cell === 7 ? 0x3cf028 : 0x888888);
      }
    }
  }, { x0, x1, depth, cell, fill });
}

async function countCells(page, x0, x1, y0, y1, ids) {
  return page.evaluate(({ x0, x1, y0, y1, ids }) => {
    const ctx = window.__game.ctx, w = ctx.world, { cx, floor } = window.__tkArena;
    const n = {};
    for (const id of ids) n[id] = 0;
    for (let y = floor + y0; y <= floor + y1; y++) for (let x = cx + x0; x <= cx + x1; x++) {
      const t = w.types[w.idx(x, y)];
      if (t in n) n[t]++;
    }
    return n;
  }, { x0, x1, y0, y1, ids });
}

async function grab(page, kind) {
  const c0 = await corpseInfo(page, kind);
  if (!c0) return { ok: false, why: 'no corpse' };
  await mouseTo(page, c0.x, c0.y);
  await page.waitForTimeout(60);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(40);
  const c1 = await corpseInfo(page, kind);
  const diag = await page.evaluate(() => { const ctx = window.__game.ctx; return { mouse: [ctx.input.mouse.x, ctx.input.mouse.y], player: [ctx.player.x, ctx.player.y], mana: ctx.wands.wands[ctx.wands.active].mana }; });
  return { ok: !!c1?.grip, at: [Math.round(c0.x), Math.round(c0.y)], ...diag };
}

async function liftAndHurl(page, kind, wx, wy, key = 'KeyF') {
  const g = await grab(page, kind);
  (window.__probeGrabs ??= []).push({ kind, ...g });
  const { cx, floor } = await page.evaluate(() => window.__tkArena);
  await mouseTo(page, cx - 20, floor - 40, 4);
  await page.waitForTimeout(600);
  await mouseTo(page, wx, wy, 2);
  await page.waitForTimeout(40);
  if (key === 'right') {
    const p = await worldToClient(page, wx, wy);
    await page.mouse.click(p.x, p.y, { button: 'right' });
  } else await page.keyboard.press(key);
}

async function kickAt(page, kind, playerDx, aimDx, aimDy) {
  const c0 = await corpseInfo(page, kind);
  await page.evaluate(({ x }) => { const p = window.__game.ctx.player; p.x = Math.round(x); p.vx = 0; }, { x: c0.x + playerDx });
  await page.waitForTimeout(200);
  const { floor } = await page.evaluate(() => window.__tkArena);
  const c1 = await corpseInfo(page, kind);
  await mouseTo(page, c1.x + aimDx, floor + aimDy, 2);
  await page.waitForTimeout(60);
  await page.keyboard.press('KeyF');
}

// ------------------------------------------------------------------ scenes
const SCENES = {
  async lift(page) {
    await arena(page);
    await corpsesOf(page, [['slime', 0], ['weaver', 35]]);
    const res = {};
    for (const kind of ['slime', 'weaver']) {
      const c0 = await corpseInfo(page, kind);
      if (!c0) { res[kind] = 'no corpse'; continue; }
      await mouseTo(page, c0.x, c0.y);
      await page.waitForTimeout(60);
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(80);
      const held = await corpseInfo(page, kind);
      const frames = [];
      const { cx, floor } = await page.evaluate(() => window.__tkArena);
      const path = [[-10, -50], [30, -60], [60, -40], [20, -70], [-30, -35], [40, -30], [0, -55], [60, -65]];
      for (let i = 0; i < path.length; i++) {
        await mouseTo(page, cx + path[i][0], floor + path[i][1], 4);
        await page.waitForTimeout(150);
        frames.push(await shot(page, `lift-${kind}-${i}`));
      }
      const up = await corpseInfo(page, kind);
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(1200);
      const down = await corpseInfo(page, kind);
      frames.push(await shot(page, `lift-${kind}-down`));
      await strip(frames, `strip-lift-${kind}`, undefined);
      res[kind] = { grabbed: held?.grip, liftedY: up && c0 ? c0.y - up.y : null, heldAtEnd: up?.grip, releasedFell: down && up ? down.y - up.y : null, down: down?.grip };
    }
    res.log = (await log(page)).filter(l => l.ev === 'telekinesis').map(l => `${l.phase}:${l.target}:${l.mass}`);
    res.hints = (await log(page)).filter(l => l.ev === 'hintTeach').map(l => l.key);
    res.hintLine = await page.evaluate(() => window.__game.ctx.hints.current?.line ?? null);
    return res;
  },

  async hurl(page) {
    await arena(page);
    await corpsesOf(page, [['weaver', 0]]);
    await page.evaluate(() => {
      const ctx = window.__game.ctx, { cx, floor } = window.__tkArena;
      window.__tkTarget = ctx.enemyCtl.spawn('slime', cx + 110, floor);
      window.__tkTarget.hp = 30; // a slime already worn down: one good throw finishes it
    });
    const c0 = await corpseInfo(page, 'weaver');
    await mouseTo(page, c0.x, c0.y);
    await page.waitForTimeout(60);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(100);
    const { cx, floor } = await page.evaluate(() => window.__tkArena);
    await mouseTo(page, cx - 10, floor - 45, 5);
    await page.waitForTimeout(700);
    const frames = [await shot(page, 'hurl-0-held')];
    const target = await page.evaluate(() => ({ x: window.__tkTarget.x, y: window.__tkTarget.y - 5 }));
    await mouseTo(page, target.x, target.y, 3);
    await page.waitForTimeout(50);
    await page.keyboard.press('KeyF');
    for (let i = 1; i <= 7; i++) { await page.waitForTimeout(70); frames.push(await shot(page, `hurl-${i}`)); }
    await page.waitForTimeout(400);
    frames.push(await shot(page, 'hurl-callout'));
    await strip(frames, 'strip-hurl', undefined);
    const l = await log(page);
    return {
      kills: l.filter(x => x.ev === 'alchemyKill').map(x => `${x.kind}:${x.cause}:+${x.bonusGold}`),
      moments: l.filter(x => x.ev === 'corpseMoment').map(x => `${x.kind}:${x.strength.toFixed(2)}`),
      tk: l.filter(x => x.ev === 'telekinesis').map(x => x.phase),
      targetAlive: await page.evaluate(() => window.__game.ctx.enemies.includes(window.__tkTarget)),
      targetHp: await page.evaluate(() => window.__tkTarget.hp),
    };
  },

  async 'kick-water'(page) {
    await arena(page);
    await basin(page, 34, 110, 10, 2, 8);
    await corpsesOf(page, [['spitter', -5]]);
    const frames = [];
    await kickAt(page, 'spitter', -10, 40, -40);
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(80); frames.push(await shot(page, `water-${i}`)); }
    const ys = [];
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); ys.push((await corpseInfo(page, 'spitter'))?.y); }
    frames.push(await shot(page, 'water-float'));
    await strip(frames, 'strip-kick-water');
    const { floor } = await page.evaluate(() => window.__tkArena);
    const l = await log(page);
    return { splash: l.filter(x => x.ev === 'corpseMoment').map(x => `${x.kind}:${x.strength.toFixed(2)}`), floatYs: ys.map(y => y == null ? null : Math.round(y - floor)), surface: -8 };
  },

  async 'oil-fire'(page) {
    await arena(page);
    await basin(page, 34, 110, 10, 6, 8);
    await corpsesOf(page, [['spitter', -5]]);
    // Light it: real fire cells against the body.
    await page.evaluate(() => {
      const ctx = window.__game.ctx, w = ctx.world, c = ctx.corpses.list.find(k => k.e.kind === 'spitter');
      for (const p of c.e.rig.pts) for (let dx = -3; dx <= 3; dx++) for (let dy = -4; dy <= 0; dy++) {
        const i = w.idx(Math.floor(p.x) + dx, Math.floor(p.y) + dy);
        if (w.types[i] === 0) { w.replaceCellAt(i, 5, 0xff6010); w.life[i] = 40; }
      }
    });
    await page.waitForTimeout(250);
    const lit = await corpseInfo(page, 'spitter');
    const oil0 = await countCells(page, 34, 110, -20, 0, [6, 5]);
    await kickAt(page, 'spitter', -10, 40, -40);
    const frames = [];
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(250); frames.push(await shot(page, `oil-${i}`)); }
    await page.waitForTimeout(1500);
    const oil1 = await countCells(page, 34, 110, -40, 0, [6, 5]);
    frames.push(await shot(page, 'oil-late'));
    await strip(frames, 'strip-oil-fire');
    const l = await log(page);
    return { burnAtKick: lit?.burn, oilBefore: oil0[6], oilAfter: oil1[6], fireAfter: oil1[5], moments: l.filter(x => x.ev === 'corpseMoment').map(x => x.kind) };
  },

  async lava(page) {
    await arena(page);
    await basin(page, 34, 110, 10, 11, 8);
    await corpsesOf(page, [['spitter', -5]]);
    await kickAt(page, 'spitter', -10, 40, -40);
    const frames = [], t0 = Date.now();
    let goneAt = null;
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(250);
      if (i < 8) frames.push(await shot(page, `lava-${i}`));
      const c = await corpseInfo(page, 'spitter');
      if (!c && goneAt === null) goneAt = Date.now() - t0;
    }
    await strip(frames, 'strip-lava');
    const l = await log(page);
    return { consumedAfterMs: goneAt, moments: l.filter(x => x.ev === 'corpseMoment').map(x => x.kind) };
  },

  async freeze(page) {
    await arena(page);
    await corpsesOf(page, [['spitter', 0]]);
    await page.evaluate(() => {
      const ctx = window.__game.ctx, w = ctx.world, c = ctx.corpses.list.find(k => k.e.kind === 'spitter');
      for (const p of c.e.rig.pts) for (const [dx, dy] of [[0, -2], [1, -3], [-1, -3], [2, -2]]) {
        const i = w.idx(Math.floor(p.x) + dx, Math.floor(p.y) + dy);
        if (w.types[i] === 0) w.replaceCellAt(i, 16, 0xe0f8ff);
      }
    });
    await page.waitForTimeout(900);
    const frozen = await corpseInfo(page, 'spitter');
    const frames = [await shot(page, 'freeze-0')];
    const { cx, floor } = await page.evaluate(() => window.__tkArena);
    // Hurl it at the far wall.
    await liftAndHurl(page, 'spitter', cx + 179, floor - 50);
    const track = [];
    for (let i = 1; i < 8; i++) { await page.waitForTimeout(90); frames.push(await shot(page, `freeze-${i}`)); const c = await corpseInfo(page, 'spitter'); track.push(c ? [Math.round(c.x - cx), Math.round(c.y - floor), c.frozen > 0 ? 'F' : '-'] : 'gone'); }
    await strip(frames, 'strip-freeze');
    const l = await log(page);
    const ice = await countCells(page, 100, 180, -60, 0, [10]);
    return { track, tk: l.filter(x => x.ev === 'telekinesis').map(x => x.phase), frozenTicks: frozen?.frozen, moments: l.filter(x => x.ev === 'corpseMoment').map(x => x.kind), left: await corpseInfo(page, 'spitter'), iceCells: ice[10] };
  },

  async plate(page) {
    await arena(page);
    await corpsesOf(page, [['slime', 0], ['bat', 20, -2]], 60);
    // Mop the kills' blood off the floor, then lay the plate: it should feel the bodies alone.
    await page.evaluate(() => {
      const ctx = window.__game.ctx, w = ctx.world, { cx, floor } = window.__tkArena;
      for (let y = floor - 30; y <= floor; y++) for (let x = cx - 170; x <= cx + 170; x++) { const i = w.idx(x, y); if ([2, 18, 19, 24].includes(w.types[i])) w.clearCellAt(i); }
      ctx.particles.clear();
      const list = ctx.levels.current.mechanisms;
      const door = { id: 901, kind: 'door', x: cx + 150, y: floor - 40, w: 5, h: 41, state: 0, targetId: -1 };
      for (let y = door.y; y < door.y + door.h; y++) for (let x = door.x; x < door.x + door.w; x++) w.replaceCellAt(w.idx(x, y), 13, 0x60708e);
      const plate = { id: 902, kind: 'plate', x: cx + 90, y: floor, w: 12, h: 1, state: 0, pressed: false, targetId: 901, body: [] };
      for (let x = plate.x; x < plate.x + plate.w; x++) { w.replaceCellAt(w.idx(x, floor), 13, 0x948446); plate.body.push([x, floor]); }
      list.push(door, plate);
      ctx.levels.current.mechanismTriggers = undefined;
      window.__tkDoor = door; window.__tkPlate = plate;
    });
    await page.waitForTimeout(300);
    const pre = await page.evaluate(() => ({ pressed: window.__tkPlate.pressed, door: window.__tkDoor.state }));
    const { cx, floor } = await page.evaluate(() => window.__tkArena);
    // A bat's carcass first: too light to press it.
    await liftAndHurl(page, 'bat', cx + 96, floor - 3);
    await page.waitForTimeout(1500);
    const bat = await page.evaluate(() => ({ pressed: window.__tkPlate.pressed, door: window.__tkDoor.state, latch: window.__tkPlate.state }));
    await liftAndHurl(page, 'slime', cx + 96, floor - 3);
    const frames = [];
    const states = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(300);
      states.push(await page.evaluate(() => ({ pressed: window.__tkPlate.pressed, door: window.__tkDoor.state })));
      if (i % 2 === 0) frames.push(await shot(page, 'plate-' + i));
    }
    await strip(frames, 'strip-plate');
    return { pre, bat, states: states.map(s => (s.pressed ? 'P' : '-') + s.door).join(' '), tk: (await log(page)).filter(x => x.ev === 'telekinesis').map(x => x.phase) };
  },

  async snapjaw(page) {
    await arena(page);
    await page.evaluate(() => {
      const ctx = window.__game.ctx, { cx, floor } = window.__tkArena;
      const c = ctx.critters.spawn('snapjaw', cx + 45, floor);
      Object.assign(c, { anchorX: cx + 45, anchorY: floor, nx: 0, ny: -1, state: 0, stateT: 0, extent: 1, reach: 6.5, hp: 32 });
      window.__tkJaw = c;
    });
    await corpsesOf(page, [['slime', 0]]);
    await page.waitForTimeout(400);
    const { cx, floor } = await page.evaluate(() => window.__tkArena);
    // Dangle the carcass at the pod (E to lift, the cursor over the jaw).
    const g = await grab(page, 'slime');
    (window.__probeGrabs ??= []).push({ kind: 'slime', ...g });
    // Walk up to the plant with it (the leash is 64 cells).
    await page.evaluate(() => { const ctx = window.__game.ctx, { cx } = window.__tkArena; ctx.player.x = cx + 5; });
    await page.waitForTimeout(150);
    await mouseTo(page, cx + 45, floor - 14, 8);
    const frames = [];
    const states = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(200);
      states.push(await page.evaluate(() => window.__tkJaw.state));
      if (i === 3) await mouseTo(page, cx + 45, floor - 8, 2);
      if (i < 8) frames.push(await shot(page, `jaw-${i}`));
    }
    await strip(frames, 'strip-snapjaw');
    const l = await log(page);
    return { jawStates: states.join(''), organism: l.filter(x => x.ev === 'organism').map(x => `${x.kind}:${x.action}`), corpseLeft: !!(await corpseInfo(page, 'slime')) };
  },

  async shock(page) {
    await arena(page);
    await page.evaluate(() => {
      const ctx = window.__game.ctx, w = ctx.world, { cx, floor } = window.__tkArena;
      for (let x = cx - 15; x <= cx + 15; x++) w.replaceCellAt(w.idx(x, floor + 1), 13, 0x6f7a88);
    });
    await corpsesOf(page, [['spitter', 0]]);
    const frames = [];
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => {
        const ctx = window.__game.ctx, w = ctx.world, { cx, floor } = window.__tkArena;
        for (let x = cx - 15; x <= cx + 15; x++) w.setChargeAt(w.idx(x, floor + 1), 60);
      });
      await page.waitForTimeout(90);
      frames.push(await shot(page, `shock-${i}`));
    }
    await strip(frames, 'strip-shock');
    const l = await log(page);
    const diag = await page.evaluate(() => { const ctx = window.__game.ctx, w = ctx.world, { cx, floor } = window.__tkArena; const c = ctx.corpses.list.find(k => k.e.kind === 'spitter'); return { twitch: c?.twitch, pts: c?.e.rig.pts.map(p => [Math.round(p.x - cx), +(p.y - floor).toFixed(1), p.r]), charge: [-10, -5, 0, 5, 10].map(dx => w.charge[w.idx(cx + dx, floor + 1)]) }; });
    return { moments: l.filter(x => x.ev === 'corpseMoment').map(x => x.kind), diag };
  },

  async blast(page) {
    await arena(page);
    await corpsesOf(page, [['spitter', 10], ['slime', 30], ['weaver', 60]]);
    const before = await Promise.all(['spitter', 'slime', 'weaver'].map(k => corpseInfo(page, k)));
    await page.evaluate(() => { const ctx = window.__game.ctx, { cx, floor } = window.__tkArena; ctx.explosions.trigger(cx + 30, floor - 3, 14); });
    const frames = [];
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(80); frames.push(await shot(page, `blast-${i}`)); }
    await strip(frames, 'strip-blast');
    const after = await Promise.all(['spitter', 'slime', 'weaver'].map(k => corpseInfo(page, k)));
    return { moved: before.map((b, i) => b && after[i] ? Math.round(Math.hypot(after[i].x - b.x, after[i].y - b.y)) : null) };
  },

  async audio(page) {
    await arena(page);
    await page.keyboard.press('KeyL'); await page.keyboard.press('KeyL'); // a gesture: the audio context wakes
    return page.evaluate(async () => {
      const ctx = window.__game.ctx, a = ctx.audio;
      a.ensure?.();
      a.requestPacks?.(['world']);
      const ids = ['tk.grab', 'tk.hold.loop', 'tk.hurl', 'tk.release', 'tk.fizzle', 'tk.strain', 'corpse.thud.light', 'corpse.thud.heavy',
        'corpse.bowl', 'corpse.splash', 'corpse.ignite', 'corpse.consume', 'corpse.dissolve', 'corpse.freeze', 'corpse.shatter', 'corpse.twitch'];
      const t0 = performance.now();
      while (!ids.every(id => a.bank.has(id)) && performance.now() - t0 < 20000) await new Promise(r => setTimeout(r, 100));
      const L = a.debugSnapshot().listener;
      const list = [
        ['telekinesis', { phase: 'grab', mass: 1, target: 'corpse' }, 'tk.grab'],
        ['telekinesis', { phase: 'hold', mass: 2.6, target: 'corpse' }, 'tk.hold.loop'],
        ['telekinesis', { phase: 'hurl', mass: 1, target: 'corpse' }, 'tk.hurl'],
        ['telekinesis', { phase: 'release', mass: 1, target: 'corpse' }, 'tk.release'],
        ['telekinesis', { phase: 'fizzle', mass: 1, target: 'corpse' }, 'tk.fizzle'],
        ['telekinesis', { phase: 'strain', mass: 14, target: 'corpse' }, 'tk.strain'],
        ['corpseMoment', { kind: 'thud', strength: 0.3, mass: 0.4, species: 'bat' }, 'corpse.thud.light'],
        ['corpseMoment', { kind: 'thud', strength: 0.9, mass: 4.5, species: 'golem' }, 'corpse.thud.heavy'],
        ['corpseMoment', { kind: 'bowl', strength: 1, mass: 2.6, species: 'weaver' }, 'corpse.bowl'],
        ['corpseMoment', { kind: 'splash', strength: 0.8, mass: 1.3, species: 'spitter' }, 'corpse.splash'],
        ['corpseMoment', { kind: 'ignite', strength: 0.6, mass: 1.3, species: 'spitter' }, 'corpse.ignite'],
        ['corpseMoment', { kind: 'consume', strength: 0.6, mass: 1.3, species: 'spitter' }, 'corpse.consume'],
        ['corpseMoment', { kind: 'dissolve', strength: 0.6, mass: 1.3, species: 'spitter' }, 'corpse.dissolve'],
        ['corpseMoment', { kind: 'freeze', strength: 0.6, mass: 1.3, species: 'spitter' }, 'corpse.freeze'],
        ['corpseMoment', { kind: 'shatter', strength: 0.8, mass: 1.3, species: 'spitter' }, 'corpse.shatter'],
        ['corpseMoment', { kind: 'twitch', strength: 0.6, mass: 1.3, species: 'spitter' }, 'corpse.twitch'],
      ];
      const out = [];
      for (const [ev, payload, id] of list) {
        const before = a.debugSamples();
        ctx.events.emit(ev, { ...payload, x: L.x + 80, y: L.y });
        const after = a.debugSamples();
        const fresh = after.lastPlayed.slice(-Math.max(1, after.played - before.played));
        out.push(`${id}:${fresh.includes(id) ? 'sampled' : 'MISSING'}${after.fellBack > before.fellBack ? ':fallback' : ''}`);
        await new Promise(r => setTimeout(r, 350));
      }
      return { loaded: ids.filter(id => a.bank.has(id)).length + '/' + ids.length, out };
    });
  },

  async acid(page) {
    await arena(page);
    await basin(page, 34, 110, 10, 7, 8);
    await corpsesOf(page, [['spitter', -5]]);
    const acid0 = (await countCells(page, 34, 110, -20, 0, [7]))[7];
    await kickAt(page, 'spitter', -10, 40, -26); // a flatter punt: the pool is only 76 wide
    const frames = [], t0 = Date.now();
    let goneAt = null;
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(250);
      if (i % 3 === 0) frames.push(await shot(page, `acid-${i}`));
      if (!(await corpseInfo(page, 'spitter')) && goneAt === null) goneAt = Date.now() - t0;
    }
    await strip(frames, 'strip-acid');
    const acid1 = (await countCells(page, 34, 110, -20, 0, [7]))[7];
    const l = await log(page);
    return { dissolvedAfterMs: goneAt, acidSpent: acid0 - acid1, moments: l.filter(x => x.ev === 'corpseMoment').map(x => x.kind) };
  },

  async crate(page) {
    await arena(page);
    await corpsesOf(page, [['weaver', 0]]);
    const crate0 = await page.evaluate(() => {
      const ctx = window.__game.ctx, { cx, floor } = window.__tkArena;
      const b = ctx.rigidBodies.spawn({ kind: 'box', halfW: 3, halfH: 3 }, cx + 80, floor - 4, { material: 'wood' });
      window.__tkCrate = b;
      return { x: b.x, y: b.y };
    });
    await page.waitForTimeout(400);
    const { cx, floor } = await page.evaluate(() => window.__tkArena);
    await liftAndHurl(page, 'weaver', cx + 80, floor - 4);
    await page.waitForTimeout(1500);
    const crate1 = await page.evaluate(() => ({ x: window.__tkCrate.x, y: window.__tkCrate.y }));
    const l = await log(page);
    return { crateMoved: Math.round(Math.hypot(crate1.x - crate0.x, crate1.y - crate0.y)), moments: l.filter(x => x.ev === 'corpseMoment').map(x => x.kind) };
  },

  // Held / in flight / at rest, per kind: zoomed crops around the body, to
  // judge the remains' look while they hang on the thread and fly.
  async looks(page) {
    const kinds = (opt('kinds', 'weaver,slime,bat,golem,rillback,rootloper,spitter')).split(',');
    const res = {};
    await page.addStyleTag({ content: '.hint-teach, #hint-teach, [class*=teach] { display: none !important; }' });
    for (const kind of kinds) {
      await arena(page);
      await corpsesOf(page, [[kind, 0, kind === 'bat' ? -2 : 0]], kind === 'bat' || kind === 'rillback' ? 60 : 500);
      const g = await grab(page, kind);
      const { cx, floor } = await page.evaluate(() => window.__tkArena);
      const crops = [];
      const cropAt = async (name) => {
        const c = await corpseInfo(page, kind);
        if (!c) return;
        const file = await shot(page, name);
        const p = await worldToClient(page, c.x, c.y);
        const canvas = await page.locator('#canvas-holder > canvas').first().boundingBox();
        const w = 320, h = 220;
        const left = Math.max(0, Math.min(1280 - w, Math.round(p.x - canvas.x - w / 2)));
        const top = Math.max(0, Math.min(720 - h, Math.round(p.y - canvas.y - h / 2)));
        const out2 = file.replace('.png', '-crop.png');
        await sharp(file).extract({ left, top, width: w, height: h }).resize(w * 2, h * 2, { kernel: 'nearest' }).toFile(out2);
        crops.push(out2);
      };
      await mouseTo(page, cx - 5, floor - 45, 4);
      await page.waitForTimeout(700);
      await cropAt(`look-${kind}-held`);
      await mouseTo(page, cx + 30, floor - 55, 3);
      await page.waitForTimeout(160);
      await cropAt(`look-${kind}-swing`);
      await mouseTo(page, cx + 120, floor - 20, 2);
      await page.waitForTimeout(40);
      await page.keyboard.press('KeyF');
      await page.waitForTimeout(60);
      await cropAt(`look-${kind}-flight`);
      await page.waitForTimeout(1600);
      await cropAt(`look-${kind}-rest`);
      if (crops.length) {
        const tiles = await Promise.all(crops.map(f => sharp(f).png().toBuffer()));
        await sharp({ create: { width: 640 * tiles.length, height: 440, channels: 3, background: '#000' } })
          .composite(tiles.map((input, i) => ({ input, left: i * 640, top: 0 }))).png().toFile(`${out}/looks-${kind}.png`);
      }
      res[kind] = { grabbed: g.ok, at: g.at, player: g.player, frames: crops.length };
    }
    return res;
  },
};

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await waitForConsoleApi(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level physics-test --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page);
  await page.waitForTimeout(3200);
  await page.mouse.move(640, 360);
  await page.click('#canvas-holder > canvas', { position: { x: 640, y: 200 }, button: 'middle' }).catch(() => {});
  results.level = await page.evaluate(() => window.__game.ctx.levels.current?.def.id ?? null);
  console.log('level', results.level);
  for (const s of scenes) {
    if (!SCENES[s]) { results[s] = 'unknown scene'; continue; }
    try { results[s] = await SCENES[s](page); }
    catch (err) { results[s] = { error: String(err?.stack ?? err) }; }
    if (window.__probeGrabs?.length) { results[s].grabs = window.__probeGrabs.slice(); window.__probeGrabs.length = 0; }
    console.log(s, JSON.stringify(results[s]));
  }
} finally {
  writeFileSync(`${out}/probe.json`, JSON.stringify({ results, errors }, null, 1));
  console.log('errors', JSON.stringify(errors));
  await browser.close();
}

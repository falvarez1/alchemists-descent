// Native player contact, contained burning, saved fuel and real depth motion.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, startConsoleTestRun } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5184/';
const dir = 'verify-out/living-foliage'; mkdirSync(dir, { recursive: true });
const check = makeChecker(), errors = [];
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${url}?link=off`, { waitUntil: 'networkidle', timeout: 60000 });
  await leaveTitleIfShown(page);
  await startConsoleTestRun(page, { level: 'd1', world: 'campaign-level', seed: 1337, settleMs: 1500, timeout: 60000 });
  await page.waitForFunction(() => window.__game.composer.layers.ready, null, { timeout: 60000 });
  await page.addStyleTag({ content: '#wave-banner, #toast-stack, .hint-teach-overlay { visibility: hidden !important; }' });
  const initial = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const { Cell } = await import('/src/sim/CellType.ts');
    const { visibleSurfaceFoliage } = await import('/src/game/SurfaceFoliage.ts');
    ctx.player.godMode = true; ctx.enemies.length = 0;
    Object.assign(ctx.player, { x: 205, y: 314, vx: 0, vy: 0 }); ctx.camera.snapTo(300, 314);
    const roots = visibleSurfaceFoliage(ctx).filter(p => p.side === 0 && p.x > 220 && p.x < 380 && Math.abs(p.y - 314) < 8);
    window.__foliageSample = { peakAngle: 0, peakPart: 0, roots: roots.map(p => [p.x, p.y]), frame: ctx.state.frameCount, x: ctx.player.x };
    const sample = () => {
      for (const p of visibleSurfaceFoliage(ctx)) if (window.__foliageSample.roots.some(([x, y]) => p.x === x && p.y === y)) {
        window.__foliageSample.peakAngle = Math.max(window.__foliageSample.peakAngle, Math.abs(p.angle));
        window.__foliageSample.peakPart = Math.max(window.__foliageSample.peakPart, p.part);
      }
      if (window.__foliageSampling) requestAnimationFrame(sample);
    };
    window.__foliageSampling = true; requestAnimationFrame(sample); ctx.state.paused = false;
    const types = ctx.world.types;
    return { roots: roots.length, moss: types.filter(t => t === Cell.Moss).length, vines: types.filter(t => t === Cell.Vines).length };
  });
  await page.evaluate(() => {
    const stream = document.querySelector('#canvas-holder > canvas').captureStream(24), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2800000 });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.start(); window.__foliageRecording = { recorder, stream, chunks };
  });
  await page.keyboard.down('KeyD'); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/player-contact.png` });
  await page.waitForTimeout(1200); await page.keyboard.up('KeyD');
  const brushed = await page.evaluate(() => {
    const ctx = window.__game.ctx; window.__foliageSampling = false; ctx.state.paused = true;
    return { ...window.__foliageSample, ticks: ctx.state.frameCount - window.__foliageSample.frame, distance: ctx.player.x - window.__foliageSample.x, mode: ctx.state.mode, dead: ctx.player.dead };
  });
  await page.evaluate(() => { window.__game.ctx.state.paused = false; });
  await page.waitForTimeout(1200);
  const clip = await page.evaluate(async () => {
    window.__game.ctx.state.paused = true;
    const { recorder, stream, chunks } = window.__foliageRecording;
    await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
    stream.getTracks().forEach(track => track.stop());
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let raw = ''; for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(raw);
  });
  writeFileSync(`${dir}/player-contact.webm`, Buffer.from(clip, 'base64'));
  check.check('generated level contains substantial actual moss and vine material', initial.moss > 100 && initial.vines > 300, JSON.stringify(initial));
  check.check('native keyboard play passes through planted foliage', initial.roots > 2 && brushed.ticks >= 90 && brushed.distance > 80 && !brushed.dead && brushed.mode === 'play', JSON.stringify(brushed));
  check.check('visible leaves part and bend under the actual moving player', brushed.peakAngle > .12 && brushed.peakPart > .25, JSON.stringify(brushed));
  await page.screenshot({ path: `${dir}/player-brush.png` });

  const mechanics = await page.evaluate(async () => {
    const game = window.__game, ctx = game.ctx;
    const { planeMotionCount } = await import('/src/render/depth/MachineryMotion.ts');
    const { lanternFlicker } = await import('/src/config/ambientMotion.ts');
    const layers = game.composer.layers;
    const hash = data => { let h = 2166136261; for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 16777619); return h >>> 0; };
    const before = layers.backdropLayers.map(p => ({ hash: hash(p.pixels), version: p.version }));
    const fgBefore = hash(layers.foreground.bitmap.pixels), fgVersion = layers.foreground.version;
    const tick = ctx.state.frameCount; ctx.state.frameCount += 180; layers.sync(ctx);
    const after = layers.backdropLayers.map(p => ({ hash: hash(p.pixels), version: p.version }));
    const fgChanged = fgBefore !== hash(layers.foreground.bitmap.pixels), fgChangedVersion = fgVersion !== layers.foreground.version;
    const pieces = planeMotionCount(layers.foreground.bitmap);
    const lamp = ctx.levels.current.authoredLights.find(p => p.fixture === 'lantern');
    const lampValues = Array.from({ length: 180 }, (_, n) => lanternFlicker(tick + n, lamp.flickerPhase, lamp.flicker));
    ctx.state.frameCount = tick; layers.sync(ctx);
    return { changed: after.filter((p, i) => p.hash !== before[i].hash && p.version !== before[i].version).length,
      fgChanged, fgChangedVersion, pieces, lampMin: Math.min(...lampValues), lampMax: Math.max(...lampValues) };
  });
  check.check('real parallax bitmap pieces animate and advance upload versions', mechanics.changed > 0, JSON.stringify(mechanics));
  check.check('existing foreground cogs/chains also animate through the shared bitmap', mechanics.fgChanged && mechanics.fgChangedVersion, JSON.stringify(mechanics));
  check.check('authored lanterns vary without blinking off', mechanics.lampMax - mechanics.lampMin > .08 && mechanics.lampMin > .7, JSON.stringify(mechanics));

  const continuity = await page.evaluate(async () => {
    const ctx = window.__game.ctx, w = ctx.world, system = ctx.vineStrands;
    const { Cell } = await import('/src/sim/CellType.ts');
    const { foliageBurnState } = await import('/src/config/foliage.ts');
    const rows = [];
    const tick = count => { for (let n = 0; n < count; n++) { ctx.state.frameCount++; system.update(ctx); } };
    for (const burning of [true, false]) {
      system.clear(); ctx.particles.list.length = 0; ctx.projectiles.length = 0;
      Object.assign(ctx.player, { x: 210, y: 310, vx: 0, vy: 0 });
      for (let y = 80; y <= 200; y++) for (let x = 140; x <= 215; x++) w.clearCell(x, y);
      w.replaceCellAt(w.idx(160, 96), Cell.Stone, 0x888888);
      const cells = [];
      for (let d = 0; d < 76; d++) {
        const index = w.idx(160 + Math.round(Math.sin(d * .065 + 160) * d * .1), 97 + d);
        cells.push(index); w.replaceCellAt(index, Cell.Vines, 0x446644); w.life[index] = -2;
      }
      tick(8);
      const strand = system.strands.find(s => s.originCells?.includes(cells[0])), node = strand.nodes[7];
      Object.assign(node, { burn: .5, fuel: 3, burning, flameSpent: true });
      const source = node.sourceCells[0], types = w.types.slice(), life = w.life.slice();
      system.writeSnapshotCells(w, types, life);
      const saved = foliageBurnState(life[source]), liveUntouched = w.types[source] === Cell.Empty;
      system.clear();
      for (const index of cells) { w.replaceCellAt(index, types[index], 0x446644); w.life[index] = life[index]; }
      tick(8);
      const restored = system.strands.flatMap(s => s.nodes).find(n => n.sourceCells?.includes(source));
      tick(24);
      let flames = 0;
      for (let y = 80; y <= 200; y++) for (let x = 140; x <= 215; x++) if (w.type(x, y) === Cell.Fire) flames++;
      rows.push({ burning, isVine: types[source] === Cell.Vines, saved, liveUntouched, restoredBurn: restored?.burn,
        restoredBurning: restored?.burning, restoredFuel: restored?.fuel, flameSpent: restored?.flameSpent, flames });
    }
    return rows;
  });
  for (const row of continuity) check.check(`burning=${row.burning}: native damp-vine snapshot resumes without turning to ash or renewing flame`,
    row.isVine && row.saved.age === 45 && row.saved.burning === row.burning && row.liveUntouched &&
    row.restoredBurn >= .5 && row.restoredBurn < .8 && row.restoredBurning === row.burning &&
    row.restoredFuel === (row.burning ? 3 : 0) && row.flameSpent && row.flames === 0, JSON.stringify(row));

  const fire = [];
  for (const seed of [1, 7, 42]) {
    const row = await page.evaluate(async seed => {
      const ctx = window.__game.ctx, w = ctx.world;
      const { Cell } = await import('/src/sim/CellType.ts');
      const { Simulation } = await import('/src/sim/Simulation.ts');
      const { updateSurfaceFoliage, visibleSurfaceFoliage } = await import('/src/game/SurfaceFoliage.ts');
      const { reseedTickStreams } = await import('/src/core/simRandom.ts');
      const { foliageBurnState } = await import('/src/config/foliage.ts');
      const bounds = { x0: 80, y0: 460, x1: 410, y1: 560 };
      w.simBounds = bounds; ctx.state.worldSeed = seed;
      for (let y = bounds.y0; y <= bounds.y1; y++) for (let x = bounds.x0; x <= bounds.x1; x++) w.replaceCellAt(w.idx(x, y), y >= 545 ? Cell.Stone : Cell.Empty, 0x586768);
      for (const x of [80, 410]) for (let y = 460; y <= 545; y++) w.replaceCellAt(w.idx(x, y), Cell.Metal, 0);
      const roots = [];
      for (let x = 102; x <= 390; x += 6) { const i = w.idx(x, 544); w.replaceCellAt(i, Cell.Moss, 0x447744); w.life[i] = -2; roots.push(i); }
      ctx.camera.snapTo(240, 520); ctx.player.x = 700; ctx.player.y = 440; ctx.particles.list.length = 0; ctx.projectiles.length = 0;
      w.replaceCellAt(w.idx(120, 535), Cell.Ember, 0xffa443);
      const sim = new Simulation(); let burned = 0, burningPeak = 0, hotPeak = 0;
      for (let n = 0; n < 240; n++) {
        ctx.state.frameCount++; reseedTickStreams(seed, n);
        sim.update(ctx);
        updateSurfaceFoliage(ctx);
        burningPeak = Math.max(burningPeak, roots.filter(i => w.types[i] === Cell.Moss && foliageBurnState(w.life[i]).burning).length);
        hotPeak = Math.max(hotPeak, w.types.filter(t => t === Cell.Fire).length);
      }
      burned = roots.filter(i => w.types[i] !== Cell.Moss || w.life[i] < -2).length;
      const poses = visibleSurfaceFoliage(ctx);
      return { seed, total: roots.length, burned, burningPeak, hotPeak, remaining: roots.filter(i => w.types[i] === Cell.Moss && w.life[i] === -2).length, poses: poses.length };
    }, seed);
    fire.push(row);
    check.check(`seed ${seed}: one ember burns a local patch while most foliage survives`, row.burned > 0 && row.burned < row.total * .35 && row.remaining > row.total * .65, JSON.stringify(row));
  }
  await page.screenshot({ path: `${dir}/contained-fire.png` });
  check.check('browser play and material/motion probes have no uncaught errors', errors.length === 0, errors.join('\n'));
  writeFileSync(`${dir}/measured.json`, JSON.stringify({ initial, brushed, mechanics, continuity, fire, errors, pass: check.pass, fail: check.fail }, null, 2));
  console.log(`\n${check.pass} passed, ${check.fail} failed`);
  if (check.fail > 0) process.exitCode = 1;
} finally { await browser.close(); }

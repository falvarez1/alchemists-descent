// Deterministic, frame-perfect 60 fps trailer capture.
//
//   node scripts/trailer/capture.mjs <shotId...>      record shots
//   node scripts/trailer/capture.mjs --all            record every shot (--priority P0 to filter)
//   node scripts/trailer/capture.mjs --list           list the shot registry
//   node scripts/trailer/capture.mjs --sheet          rebuild shots.json + contact-sheet.png only
//   node scripts/trailer/capture.mjs <id> --stills 30 staging preview: a PNG every 30 frames, no video
//
// Options: --url http://localhost:5330/  --out <footage dir>  --no-sheet  --headed
//
// How it stays frame-perfect: lib/virtualTime.mjs virtualizes every clock in
// the page. The harness advances time by exactly 1000/60 ms per captured
// frame (times the shot's clock scale for slow motion), so Game.step's
// fixed-timestep accumulator runs one 60 Hz tick per frame however long the
// 1080p frame takes to render and grab. Each frame is grabbed with CDP
// Page.captureScreenshot (the composited page: canvas + opted-in DOM) and
// piped to ffmpeg. See scripts/trailer/README.md.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { installVirtualTime } from './lib/virtualTime.mjs';
import { installTrailerHelpers } from './lib/pageHelpers.mjs';
import { hudCss } from './lib/hud.mjs';
import { buildMarks } from './lib/marks.mjs';
import { writeManifest, writeContactSheet } from './lib/manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FPS = 60;
const STEP_MS = 1000 / FPS;
const W = 1920;
const H = 1080;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const URL_BASE = opt('url', 'http://localhost:5330/');
const OUT = resolve(opt('out', 'Y:/Projects/alchemists-descent-worktrees/trailer/footage'));
const STILLS = Number(opt('stills', '0'));
const STILLS_DIR = resolve(opt('stills-dir', join(process.env.TEMP || process.env.TMP || '.', 'trailer-stills')));
const VALUE_FLAGS = new Set(['url', 'out', 'stills', 'stills-dir', 'priority', 'only-frames']);

// ------------------------------------------------------------------ registry
async function loadShots() {
  const dir = join(HERE, 'shots');
  const shots = [];
  // `_name.mjs` files are scratch/test shots: runnable by id, never in --all.
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    const list = Array.isArray(mod.default) ? mod.default : [mod.default];
    for (const shot of list) {
      if (!shot || !shot.id) continue;
      shots.push({ ...shot, file, scratch: file.startsWith('_') });
      for (const variant of shot.variants ?? []) shots.push({ ...shot, ...variant, variants: undefined, base: shot.id, file });
    }
  }
  const ids = new Set();
  for (const s of shots) {
    if (ids.has(s.id)) throw new Error(`duplicate shot id ${s.id}`);
    ids.add(s.id);
  }
  return shots;
}

function positional() {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { if (VALUE_FLAGS.has(a.slice(2))) i++; continue; }
    out.push(a);
  }
  return out;
}

// ------------------------------------------------------------------ ffmpeg
function startEncoder(file) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-an',
    '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-r', String(FPS), '-movflags', '+faststart',
    file,
  ];
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  let pipeError = null;
  proc.stdin.on('error', (e) => { pipeError = e; });
  const done = new Promise((res, rej) => {
    proc.on('error', rej);
    proc.on('exit', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
  });
  const write = (buf) => new Promise((res, rej) => {
    if (pipeError) { rej(pipeError); return; }
    if (proc.stdin.write(buf)) res();
    else proc.stdin.once('drain', res);
  });
  return { write, end: async () => { proc.stdin.end(); await done; } };
}

function probeFrames(file) {
  return new Promise((res) => {
    const p = spawn('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
      'stream=nb_read_frames,r_frame_rate,width,height', '-of', 'json', file]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', () => { try { res(JSON.parse(out).streams[0]); } catch { res(null); } });
  });
}

// ------------------------------------------------------------------ page driving
const readyExpr = () => {
  const c = window.__game?.ctx;
  return Boolean(c && c.state.mode === 'play' && c.levels.current && !c.levels.transitioning);
};

/** Run an async page job while pumping virtual frames until it settles. */
async function settle(page, start, label, maxFrames = 900) {
  await start();
  let frames = 0;
  for (; frames < maxFrames; frames++) {
    const state = await page.evaluate(() => window.__job);
    if (state.done) {
      if (state.error) throw new Error(`${label}: ${state.error}`);
      return { frames, result: state.result };
    }
    await page.evaluate(() => window.__vt.frame());
  }
  throw new Error(`${label}: did not settle in ${maxFrames} frames`);
}

function consoleJob(command) {
  return {
    fn: (cmd) => {
      window.__job = { done: false };
      Promise.resolve(window.__game.ctx.console.exec(cmd)).then(
        (r) => { window.__job = { done: true, result: { ok: r?.ok, message: r?.message }, error: r?.ok === false ? r?.message : null }; },
        (e) => { window.__job = { done: true, error: String(e) }; },
      );
    },
    arg: command,
  };
}

async function runJob(page, job, label) {
  return settle(page, async () => { await page.evaluate(job.fn, job.arg); }, label);
}

function slug(id) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// ------------------------------------------------------------------ one shot
async function captureShot(shot) {
  const t0 = Date.now();
  const scale = shot.slowmo?.scale ?? 1;
  const durationS = shot.durationS;
  const frames = Math.round(durationS * FPS);
  const warmup = shot.warmupTicks ?? 60;
  const stillsEvery = STILLS;
  const log = (...a) => console.log(`[${shot.id}]`, ...a);

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: !flag('headed'),
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization', '--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.addInitScript(installVirtualTime);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|WebSocket/.test(m.text())) pageErrors.push(m.text()); });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const cdp = await context.newCDPSession(page);

  let encoder = null;
  try {
    const url = new URL(URL_BASE);
    url.searchParams.set('link', 'off');
    await page.goto(url.href, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => typeof window.__game?.ctx?.console?.exec === 'function', null, { timeout: 60000 });
    await page.addStyleTag({ content: hudCss(shot.show ?? []) });

    // From here on, time only moves when we say so.
    await page.evaluate((seed) => window.__vt.setManual(seed), slug(shot.id));
    // Every per-tick stream is seeded from (worldSeed, frameCount), and the
    // boot ran a real-time-dependent number of ticks: pin the counter (it only
    // ever moves forward here, so no cooldown is left in the future).
    const pinTicks = (value) => page.evaluate((v) => {
      const c = window.__game.ctx;
      c.state.frameCount = Math.max(v, c.state.frameCount + 1);
      c.simulation.accumulator = 0;
      return c.state.frameCount;
    }, value);
    await pinTicks(200000);
    await page.evaluate(() => { try { localStorage.removeItem('noita-expedition'); } catch { /* ignore */ } });
    const run = `run test --level ${shot.level} --world campaign-level --seed ${shot.seed ?? 777} --loadout ${shot.loadout ?? 'advanced'}`;
    const started = await runJob(page, consoleJob(run), 'run');
    let readyFrames = 0;
    for (; readyFrames < 900 && !(await page.evaluate(readyExpr)); readyFrames++) await page.evaluate(() => window.__vt.frame());
    if (!(await page.evaluate(readyExpr))) throw new Error('run never became ready');
    await pinTicks(300000);
    if (shot.god !== false) await runJob(page, consoleJob('god'), 'god');

    await page.evaluate(installTrailerHelpers, {
      params: shot.params ?? {},
      setup: shot.setup ? shot.setup.toString() : null,
      tick: shot.tick ? shot.tick.toString() : null,
      frame: shot.frame ? shot.frame.toString() : null,
    });
    // House rules for every shot: a steady, visible, invulnerable alchemist
    // (god mode's invuln makes the sprite blink), no teach cards, a fixed
    // RNG point, and the tick origin placed so warmup counts up to t=0.
    const house = await page.evaluate(({ warmup, seed, mortal }) => {
      const T = window.__trailer;
      const ctx = T.ctx;
      // Silence: the browser is launched muted, and the engine is switched
      // off so its async sample loads (real-time) never draw from the seeded
      // Math.random stream the visuals share.
      if (ctx.audio.enabled) ctx.audio.toggle();
      try { ctx.audio.audioCtx?.suspend?.(); } catch { /* ignore */ }
      ctx.player.invuln = 0;
      if (!mortal) ctx.playerCtl.damage = () => {};
      ctx.hints?.setTeachHeld?.(true);
      ctx.state.paused = false;
      window.__vt.reseed(seed);
      T.base = ctx.state.frameCount + warmup;
      return { frameCount: ctx.state.frameCount, level: ctx.levels.current?.def?.id ?? ctx.levels.current?.id };
    }, { warmup, seed: slug(shot.id) ^ 0x9e3779b9, mortal: shot.mortal === true });
    const setupRun = await settle(page, async () => {
      await page.evaluate(() => {
        window.__job = { done: false };
        const T = window.__trailer;
        Promise.resolve(T.fns.setup ? T.fns.setup(T.ctx, T, T.P) : null).then(
          () => { window.__job = { done: true }; },
          (e) => { window.__job = { done: true, error: String(e?.stack || e) }; },
        );
      });
    }, 'setup');
    if (setupRun.frames) log(`setup pumped ${setupRun.frames} frames (async)`);
    await page.evaluate((warmup) => { window.__trailer.base = window.__trailer.ctx.state.frameCount + warmup; }, warmup);

    // Warmup: ticks -warmup..-1, not captured.
    for (let i = 0; i < warmup; i++) {
      await page.evaluate((f) => {
        const T = window.__trailer;
        T.f = f;
        if (T.fns.frame) T.fns.frame(T.ctx, T, T.P, f, T.t);
        window.__vt.frame();
      }, i - warmup);
    }

    // Slow-motion variants play the same tick script, but only the ticks in
    // [fromTick, toTick] are filmed, at `scale` ticks per frame.
    let preTicks = 0;
    if (shot.slowmo) {
      preTicks = shot.slowmo.fromTick ?? 0;
      for (let i = 0; i < preTicks; i++) {
        await page.evaluate((f) => {
          const T = window.__trailer;
          T.f = -1;
          if (T.fns.frame) T.fns.frame(T.ctx, T, T.P, f, T.t);
          window.__vt.frame();
        }, -1);
      }
    }

    const frameTotal = shot.slowmo ? Math.round(((shot.slowmo.toTick - preTicks) / scale)) : frames;
    const keyEvents = [...(shot.keys ?? [])].sort((a, b) => a.t - b.t);
    let keyCursor = 0;
    const tickAt0 = await page.evaluate(() => window.__trailer.ctx.state.frameCount - window.__trailer.base);
    log(`ready: run ${started.result?.ok !== false ? 'ok' : 'FAIL'} (+${readyFrames}f), level ${house.level}, capturing ${frameTotal} frames @${scale}x from tick ${tickAt0}`);

    const mp4 = join(OUT, `${shot.id}.mp4`);
    if (!stillsEvery) { mkdirSync(OUT, { recursive: true }); encoder = startEncoder(mp4); }
    else mkdirSync(join(STILLS_DIR, shot.id), { recursive: true });
    await page.evaluate(() => { window.__trailer.recording = true; });

    let lastTick = tickAt0 - 1;
    const tickLog = [];
    const tGrab = { eval: 0, shot: 0, enc: 0 };
    for (let f = 0; f < frameTotal; f++) {
      // Real key events land before the frame that runs their tick.
      while (keyCursor < keyEvents.length && keyEvents[keyCursor].t <= lastTick + 1) {
        const k = keyEvents[keyCursor++];
        if (k.press) await page.keyboard.press(k.press);
        if (k.down) await page.keyboard.down(k.down);
        if (k.up) await page.keyboard.up(k.up);
      }
      const a = Date.now();
      const st = await page.evaluate(({ f, dt }) => {
        const T = window.__trailer;
        T.f = f;
        if (T.fns.frame) T.fns.frame(T.ctx, T, T.P, f, T.t);
        window.__vt.frame(dt);
        return T.ctx.state.frameCount - T.base - 1;
      }, { f, dt: STEP_MS * scale });
      tickLog.push(st);
      lastTick = st;
      const b = Date.now();
      if (!stillsEvery || f % stillsEvery === 0 || f === frameTotal - 1) {
        const shotData = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false });
        const c = Date.now();
        const buf = Buffer.from(shotData.data, 'base64');
        if (encoder) await encoder.write(buf);
        else writeFileSync(join(STILLS_DIR, shot.id, `f${String(f).padStart(4, '0')}-t${st}.png`), buf);
        tGrab.shot += c - b;
        tGrab.enc += Date.now() - c;
      }
      tGrab.eval += b - a;
      if (f % 120 === 0) log(`frame ${f}/${frameTotal} tick ${st}`);
    }

    const pageState = await page.evaluate(() => {
      const T = window.__trailer;
      return { events: T.events, marks: T.marks, notes: T.notes, vtErrors: window.__vt.errors, frameCount: T.ctx.state.frameCount, base: T.base };
    });
    if (encoder) await encoder.end();
    encoder = null;

    // Integrity: one tick per frame at 1x; exactly frameTotal frames encoded.
    const ticks = tickLog[tickLog.length - 1] - tickAt0 + 1;
    const dupTicks = scale === 1 ? tickLog.filter((t, i) => i > 0 && t !== tickLog[i - 1] + 1).length : 0;
    const integrity = { frames: frameTotal, ticks, expectedTicks: Math.round(frameTotal * scale), tickGaps: dupTicks };
    if (!stillsEvery) {
      const probe = await probeFrames(mp4);
      integrity.encodedFrames = Number(probe?.nb_read_frames);
      integrity.rate = probe?.r_frame_rate;
      integrity.size = `${probe?.width}x${probe?.height}`;
    }
    const secs = (Date.now() - t0) / 1000;
    log(`done in ${secs.toFixed(0)}s (eval ${(tGrab.eval / frameTotal).toFixed(0)}ms, grab ${(tGrab.shot / frameTotal).toFixed(0)}ms, enc ${(tGrab.enc / frameTotal).toFixed(0)}ms per frame)`, JSON.stringify(integrity));
    if (pageErrors.length) log(`page errors (${pageErrors.length}):`, pageErrors.slice(0, 5).join(' | ').slice(0, 800));
    if (pageState.vtErrors.length) log('callback errors:', pageState.vtErrors.slice(0, 3).join(' | ').slice(0, 800));
    if (pageState.notes.length) log('notes:', JSON.stringify(pageState.notes.slice(0, 10)));

    if (stillsEvery) return null;
    const fps = FPS;
    const clipS = frameTotal / fps;
    const { marks, events } = buildMarks(shot, pageState, { fps, clipS, scale, fromTick: preTicks });
    const sidecar = {
      id: shot.id,
      file: `${shot.id}.mp4`,
      durationS: Math.round(clipS * 1000) / 1000,
      fps,
      level: shot.level,
      description: shot.description,
      priority: shot.priority ?? 'P1',
      bestWindow: shot.bestWindow ?? { startS: Math.min(1, clipS / 4), endS: Math.max(clipS - 1, clipS * 0.75) },
      hero: shot.hero ?? null,
      marks,
      events,
      slowmo: shot.slowmo ? { scale, of: shot.base } : undefined,
      seed: shot.seed ?? 777,
      integrity,
      capturedAt: new Date().toISOString(),
    };
    writeFileSync(join(OUT, `${shot.id}.json`), JSON.stringify(sidecar, null, 2));
    return sidecar;
  } finally {
    if (encoder) await encoder.end().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ------------------------------------------------------------------ main
const shots = await loadShots();
if (flag('list')) {
  for (const s of shots) console.log(`${(s.priority ?? 'P1').padEnd(3)} ${s.id.padEnd(24)} ${s.level.padEnd(12)} ${String(s.durationS ?? s.slowmo?.toTick).padEnd(5)} ${s.description ?? ''}`);
  process.exit(0);
}
const wanted = positional();
const priority = opt('priority', null);
let selected = flag('all') ? shots.filter((s) => !s.scratch) : shots.filter((s) => wanted.includes(s.id));
if (priority) selected = selected.filter((s) => (s.priority ?? 'P1') === priority);
const unknown = wanted.filter((id) => !shots.some((s) => s.id === id));
if (unknown.length) { console.error(`unknown shot(s): ${unknown.join(', ')}`); process.exit(1); }
if (!selected.length && !flag('sheet')) { console.error('no shots selected (ids, --all, --list, --sheet)'); process.exit(1); }

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const failures = [];
for (const shot of selected) {
  try { await captureShot(shot); } catch (error) { failures.push(shot.id); console.error(`[${shot.id}] FAILED:`, error); }
}
if (!STILLS && !flag('no-sheet')) {
  const manifest = writeManifest(OUT, shots);
  await writeContactSheet(OUT, manifest);
  console.log(`manifest: ${manifest.length} shots -> ${join(OUT, 'shots.json')}`);
}
if (failures.length) { console.error(`failed: ${failures.join(', ')}`); process.exit(1); }

// Page-side virtual clock, installed as a Playwright init script (it runs in
// the page before any game module). Serialized with Function#toString, so it
// must stay self-contained: no imports, no closures over Node values.
//
// Everything the page can use to tell time reads ONE virtual clock:
// performance.now, Date.now, requestAnimationFrame, setTimeout/setInterval,
// and the document's Web Animations (CSS transitions/animations and
// Element#animate — the kill callouts and title cards live there).
//
// AUTO mode (boot): a real rAF loop advances the clock one 60 Hz frame per
// real frame, so the app boots normally. MANUAL mode (setup + recording): the
// clock only moves when the harness calls __vt.frame(dt), which fires due
// timers, runs the queued rAF callbacks with the new timestamp, and poses
// every document animation at its virtual time. Game.step's fixed-timestep
// accumulator therefore runs exactly one tick per 1000/60 ms frame, however
// slow the machine renders.
export function installVirtualTime() {
  if (window.__vt) return;
  const real = {
    raf: window.requestAnimationFrame.bind(window),
    caf: window.cancelAnimationFrame.bind(window),
    now: performance.now.bind(performance),
    dateNow: Date.now.bind(Date),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    random: Math.random.bind(Math),
  };
  const STEP = 1000 / 60;
  const vt = {
    manual: false,
    now: real.now(),
    dateOffset: real.dateNow() - real.now(),
    frames: 0,
    raf: new Map(),
    nextRaf: 1e9,
    timers: new Map(),
    nextTimer: 1e9,
    anims: new Map(),
    errors: [],
    seed: 1,
  };
  window.__vt = vt;

  // Seeded Math.random (mulberry32). Screen shake, particle scatter and many
  // cosmetic draws use Math.random; the harness reseeds it at a fixed point so
  // a re-record replays the same shake.
  let rngState = 1;
  const rng = () => {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  vt.reseed = (seed) => { vt.seed = seed >>> 0; rngState = seed | 0; };
  vt.reseed(1);
  Math.random = rng;

  performance.now = function now() { return vt.now; };
  Date.now = function now() { return Math.floor(vt.dateOffset + vt.now); };

  window.requestAnimationFrame = function requestAnimationFrame(cb) {
    const id = vt.nextRaf++;
    vt.raf.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    if (!vt.raf.delete(id)) real.caf(id);
  };

  const addTimer = (cb, ms, args, repeat) => {
    const id = vt.nextTimer++;
    const delay = Math.max(0, Number(ms) || 0);
    vt.timers.set(id, { due: vt.now + delay, cb, args, interval: repeat ? Math.max(1, delay) : null, seq: id });
    return id;
  };
  window.setTimeout = function setTimeout(cb, ms, ...args) {
    if (typeof cb !== 'function') return real.setTimeout(cb, ms, ...args);
    return addTimer(cb, ms, args, false);
  };
  window.setInterval = function setInterval(cb, ms, ...args) {
    if (typeof cb !== 'function') return real.setInterval(cb, ms, ...args);
    return addTimer(cb, ms, args, true);
  };
  window.clearTimeout = function clearTimeout(id) {
    if (!vt.timers.delete(id)) real.clearTimeout(id);
  };
  window.clearInterval = function clearInterval(id) {
    if (!vt.timers.delete(id)) real.clearInterval(id);
  };

  const report = (error) => {
    const text = String((error && error.stack) || error);
    if (vt.errors.length < 50) vt.errors.push(text);
    console.error('[vt]', text);
  };

  const runTimers = () => {
    // Fire in due order; timers scheduled by a callback for "now" still run
    // this frame. The guard bounds a 0 ms interval.
    for (let guard = 0; guard < 2000; guard++) {
      let next = null;
      for (const timer of vt.timers.values()) {
        if (timer.due > vt.now) continue;
        if (!next || timer.due < next.due || (timer.due === next.due && timer.seq < next.seq)) next = timer;
      }
      if (!next) return;
      if (next.interval !== null) next.due += next.interval;
      else vt.timers.delete(next.seq);
      try { next.cb(...next.args); } catch (error) { report(error); }
    }
  };

  const animationEnd = (animation) => {
    try {
      const end = animation.effect ? animation.effect.getComputedTiming().endTime : Infinity;
      return typeof end === 'number' ? end : Number(end);
    } catch { return Infinity; }
  };

  // Pose every document animation at its virtual age. New animations are
  // adopted at their current progress; finished ones are finished for real so
  // `finished`/onfinish consumers still run.
  const syncAnimations = () => {
    const live = new Set();
    for (const animation of document.getAnimations()) {
      live.add(animation);
      if (animation.playState === 'idle') { vt.anims.delete(animation); continue; }
      let rec = vt.anims.get(animation);
      const rate = animation.playbackRate || 1;
      if (!rec) {
        if (animation.playState === 'finished') continue;
        const current = typeof animation.currentTime === 'number' ? animation.currentTime : 0;
        rec = { start: vt.now - current / rate };
        vt.anims.set(animation, rec);
      }
      const at = (vt.now - rec.start) * rate;
      const end = animationEnd(animation);
      if (Number.isFinite(end) && at >= end && rate > 0) {
        vt.anims.delete(animation);
        try { animation.finish(); } catch (error) { report(error); }
        continue;
      }
      try {
        if (animation.playState !== 'paused') animation.pause();
        animation.currentTime = Math.max(0, at);
      } catch (error) { report(error); }
    }
    for (const animation of vt.anims.keys()) if (!live.has(animation)) vt.anims.delete(animation);
  };

  /** Advance the clock by `dt` ms and run one presentation frame. */
  vt.frame = (dt = STEP) => {
    vt.now += dt;
    vt.frames++;
    runTimers();
    const queue = vt.raf;
    vt.raf = new Map();
    for (const cb of queue.values()) {
      try { cb(vt.now); } catch (error) { report(error); }
    }
    if (vt.manual) syncAnimations();
  };

  /** Stop the real-time pump; from here on only the harness moves time. */
  vt.setManual = (seed) => {
    vt.manual = true;
    if (seed !== undefined) vt.reseed(seed);
    syncAnimations();
  };

  const pump = () => {
    if (vt.manual) return;
    vt.frame(STEP);
    real.raf(pump);
  };
  real.raf(pump);
}

// Page-side shot toolkit, installed once per capture after the run is live.
// Serialized with Function#toString like virtualTime.mjs: self-contained.
//
// window.__trailer (called `T` inside shot scripts) owns:
//  - the per-TICK hook (wraps ctx.time.beforeTick, which Game.tick calls
//    every fixed tick — hitstop included — before the camera, sim and player
//    update), so scripted inputs are tick-exact at any clock scale;
//  - event marks: every EventBus emit, every explosion, and the one-shot SFX
//    calls, stamped with the captured frame and tick;
//  - camera, aim, fire, key and paint helpers for the shot scripts.
export function installTrailerHelpers(options) {
  const game = window.__game;
  const ctx = game.ctx;
  const VIEW_W = 640;
  const VIEW_H = 360;
  const T = {
    ctx,
    game,
    P: options.params || {},
    f: -1, // captured frame index (negative before recording)
    t: -1, // tick index (0 = first tick of the recording)
    base: null, // frameCount of the tick before t=0
    recording: false,
    events: [],
    marks: [],
    notes: [],
    aimAt: null,
    fireTicks: 0,
    firing: false,
    holds: [],
    camPath: null,
    tickFns: [],
    palettes: new Map(),
  };
  window.__trailer = T;

  const toFn = (source) => {
    if (!source) return null;
    let s = source.trim();
    // Method shorthand (`setup(ctx, T, P) {…}`) is not an expression.
    if (!/^(async\s+)?function\b/.test(s) && !/^(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(s)) {
      s = s.replace(/^(async\s+)?/, (m) => `${m}function `);
    }
    return new Function(`return (${s});`)();
  };
  T.fns = {
    setup: toFn(options.setup),
    tick: toFn(options.tick),
    frame: toFn(options.frame),
  };

  // ---------------------------------------------------------------- events
  const QUIET = new Set(['worldEdited', 'timeControlsChanged', 'scoreChanged', 'creatureSignal', 'enemiesLeft',
    'contraptionView', 'habitatSound', 'musicCue', 'objectiveChanged', 'dryFire', 'flaskDry']);
  const summarize = (payload) => {
    if (payload === undefined || payload === null) return null;
    if (typeof payload !== 'object') return payload;
    const out = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') out[key] = value;
      else if (typeof value === 'number') out[key] = Number.isInteger(value) ? value : Math.round(value * 100) / 100;
    }
    return out;
  };
  T.view = () => {
    const c = ctx.camera;
    const z = Math.max(0.1, c.zoom || 1);
    const cx = (c.presentationX ?? c.x) + VIEW_W / 2;
    const cy = (c.presentationY ?? c.y) + VIEW_H / 2;
    const hw = VIEW_W / 2 / z;
    const hh = VIEW_H / 2 / z;
    return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh, cx, cy, zoom: z };
  };
  const inView = (detail, margin = 24) => {
    if (!detail || typeof detail.x !== 'number' || typeof detail.y !== 'number') return null;
    const v = T.view();
    return detail.x >= v.x0 - margin && detail.x <= v.x1 + margin && detail.y >= v.y0 - margin && detail.y <= v.y1 + margin;
  };
  let lastFlask = -99;
  T.record = (type, payload) => {
    if (QUIET.has(type)) return;
    const detail = summarize(payload);
    if (type === 'telekinesis' && detail && detail.phase === 'hold') return;
    if (type === 'flaskUsed') { if (T.t - lastFlask < 30) { lastFlask = T.t; return; } lastFlask = T.t; }
    if (T.events.length > 4000) return;
    T.events.push({ f: T.f, t: T.t, type, detail, inView: inView(detail) });
  };
  const emit = ctx.events.emit.bind(ctx.events);
  ctx.events.emit = (type, ...payload) => {
    try { T.record(type, payload[0]); } catch { /* never break the game */ }
    return emit(type, ...payload);
  };
  const trigger = ctx.explosions.trigger.bind(ctx.explosions);
  ctx.explosions.trigger = (cx, cy, radius, opts) => {
    try { T.record('explosion', { x: cx, y: cy, radius }); } catch { /* ignore */ }
    return trigger(cx, cy, radius, opts);
  };
  // One-shot sounds worth cutting to (continuous/ambient calls are skipped).
  const SFX = ['boom', 'zap', 'lightning', 'hollowKnock', 'shatter', 'doorGrind', 'brazier', 'steam', 'groan',
    'lever', 'portalWhoosh', 'chest', 'learn', 'stomp', 'roar', 'impact', 'hit', 'kill', 'splash', 'thud', 'crack'];
  const lastSfx = new Map();
  for (const name of SFX) {
    const fn = ctx.audio && ctx.audio[name];
    if (typeof fn !== 'function') continue;
    const bound = fn.bind(ctx.audio);
    ctx.audio[name] = (...args) => {
      try {
        const prev = lastSfx.get(name) ?? -99;
        if (T.t - prev >= 6) {
          lastSfx.set(name, T.t);
          const numbers = args.filter((a) => typeof a === 'number');
          const detail = name === 'boom' ? { size: numbers[0], x: numbers[1], y: numbers[2] } : { x: numbers.at(-2), y: numbers.at(-1) };
          T.record(`sfx:${name}`, detail);
        }
      } catch { /* ignore */ }
      return bound(...args);
    };
  }
  T.mark = (label, kind = 'beat') => { T.marks.push({ f: T.f, t: T.t, label, kind }); };
  T.note = (text) => { T.notes.push({ f: T.f, t: T.t, text: String(text) }); };

  // ---------------------------------------------------------------- tick hook
  const beforeTick = ctx.time.beforeTick.bind(ctx.time);
  ctx.time.beforeTick = () => {
    try { T.onTick(); } catch (error) { console.error('[trailer tick]', error); T.note(`tick error: ${error}`); }
    beforeTick();
  };
  T.onTick = () => {
    const next = ctx.state.frameCount + 1;
    T.t = T.base === null ? -1 : next - T.base - 1;
    const p = ctx.player;
    if (T.aimAt) { ctx.input.mouse.x = T.aimAt.x; ctx.input.mouse.y = T.aimAt.y; }
    if (T.fireTicks > 0) {
      p.firing = true;
      if (!T.firing) p.firePressed = true;
      T.firing = true;
      T.fireTicks--;
    } else if (T.firing) {
      p.firing = false;
      T.firing = false;
    }
    for (let i = T.holds.length - 1; i >= 0; i--) {
      const hold = T.holds[i];
      if (hold.ticks-- > 0) Object.assign(ctx.input.keys, hold.keys);
      else {
        for (const key of Object.keys(hold.keys)) ctx.input.keys[key] = false;
        T.holds.splice(i, 1);
      }
    }
    if (T.camPath) T.applyCamPath();
    for (const fn of T.tickFns) fn(ctx, T, T.P, T.t);
    if (T.fns.tick) T.fns.tick(ctx, T, T.P, T.t);
  };

  // ---------------------------------------------------------------- camera
  /** Smooth follow: the game's own lerp eases toward this centre and zoom. */
  T.cam = (cx, cy, zoom = 1, opts = {}) => {
    const c = ctx.camera;
    c.actionFocus = null;
    c.inspectionFocus = { x: cx, y: cy };
    c.zoomLock = zoom;
    if (opts.snap) {
      c.snapTo(cx, cy);
      c.zoom = zoom;
      c.inspectionFocus = { x: cx, y: cy };
    }
  };
  /** Follow the player (the game camera), optionally at a fixed zoom. */
  T.follow = (zoom = null) => {
    const c = ctx.camera;
    c.actionFocus = null;
    c.inspectionFocus = null;
    c.zoomLock = zoom;
  };
  /**
   * Exact placement of the view centre, applied inside the tick (after this
   * the game camera's lerp is a no-op). `whole` snaps the top-left to whole
   * cells: backdrop planes sample at integer camera positions, so sub-cell
   * drifts make the far planes judder by a cell. actionFocus pads the
   * world-edge clamp by the zoom margin, so edge subjects can be centred.
   */
  T.place = (cx, cy, zoom = 1, opts = {}) => {
    const c = ctx.camera;
    let x = cx - VIEW_W / 2;
    let y = cy - VIEW_H / 2;
    if (opts.whole !== false) { x = Math.round(x); y = Math.round(y); }
    c.inspectionFocus = null;
    c.actionFocus = { x: x + VIEW_W / 2, y: y + VIEW_H / 2, zoom };
    c.actionVx = 0;
    c.actionVy = 0;
    c.zoomLock = null;
    c.x = c.tx = x;
    c.y = c.ty = y;
    c.zoom = zoom;
  };
  const ease = {
    linear: (u) => u,
    inOut: (u) => u * u * (3 - 2 * u),
    inOutSine: (u) => 0.5 - 0.5 * Math.cos(Math.PI * u),
    out: (u) => 1 - (1 - u) * (1 - u),
    in: (u) => u * u,
  };
  /**
   * Scripted camera move over ticks: keys [{t, x, y, zoom}] (centres),
   * eased between keys. Applied every tick via T.place.
   */
  T.path = (keys, opts = {}) => { T.camPath = { keys, ease: ease[opts.ease || 'inOutSine'] || ease.linear, whole: opts.whole !== false }; };
  T.applyCamPath = () => {
    const { keys, whole } = T.camPath;
    const t = T.t;
    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
    }
    let u = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    if (t <= keys[0].t) { a = b = keys[0]; u = 1; }
    if (t >= keys[keys.length - 1].t) { a = b = keys[keys.length - 1]; u = 1; }
    const e = (b.ease ? ease[b.ease] : T.camPath.ease)(Math.max(0, Math.min(1, u)));
    const lerp = (p, q) => p + (q - p) * e;
    const za = a.zoom ?? 1;
    const zb = b.zoom ?? za;
    T.place(lerp(a.x, b.x), lerp(a.y, b.y), lerp(za, zb), { whole });
  };

  // ---------------------------------------------------------------- inputs
  T.aim = (x, y) => { T.aimAt = x === null ? null : { x, y }; if (T.aimAt) { ctx.input.mouse.x = x; ctx.input.mouse.y = y; } };
  /** Aim by angle (radians, 0 = right, +down) from the wand shoulder. */
  T.aimAngle = (angle, dist = 120) => {
    const p = ctx.player;
    T.aim(p.x + Math.cos(angle) * dist, p.y - 9 + Math.sin(angle) * dist);
  };
  T.fire = (ticks = 2) => { T.fireTicks = Math.max(T.fireTicks, ticks); };
  /** Hold input keys ({right: true, jump: true}) for n ticks. */
  T.hold = (keys, ticks) => { T.holds.push({ keys, ticks }); };
  T.release = () => { T.holds.length = 0; for (const key of Object.keys(ctx.input.keys)) ctx.input.keys[key] = false; };

  // ---------------------------------------------------------------- world
  T.rt = () => ctx.levels.current;
  T.idx = (x, y) => x + y * ctx.world.width;
  T.type = (x, y) => ctx.world.types[T.idx(x, y)];
  /**
   * A palette of real colors for a material: the console `fill` paints a
   * scratch patch with the game's own color factory, we read it and restore
   * the patch exactly (types, colors, life, charge).
   */
  T.palette = async (cell) => {
    if (T.palettes.has(cell)) return T.palettes.get(cell);
    const w = ctx.world;
    const x0 = 2;
    const y0 = w.height - 10;
    const saved = [];
    for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) {
      const i = T.idx(x, y);
      saved.push([i, w.types[i], w.colors[i], w.life[i], w.charge[i]]);
    }
    await ctx.console.exec(`fill ${x0} ${y0} ${x0 + 7} ${y0 + 7} ${cell}`);
    const colors = saved.map(([i]) => w.colors[i]);
    for (const [i, type, color, life, charge] of saved) {
      if (type === 0) w.clearCellAt(i); else w.replaceCellAt(i, type, color);
      w.life[i] = life;
      w.charge[i] = charge;
    }
    T.palettes.set(cell, colors);
    return colors;
  };
  /** Set one cell with a palette color (call T.palette(cell) first in setup). */
  T.set = (x, y, cell, color) => {
    const w = ctx.world;
    if (x < 0 || y < 0 || x >= w.width || y >= w.height) return;
    const i = T.idx(x, y);
    if (cell === 0) { w.clearCellAt(i); return; }
    const pal = T.palettes.get(cell);
    const c = color ?? (pal ? pal[(Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0 & 63] : w.colors[i]);
    w.replaceCellAt(i, cell, c);
  };
  /** Paint a rect; `where(x, y, type)` filters (e.g. only empty cells). */
  T.paint = async (x0, y0, x1, y1, cell, where = null) => {
    if (cell !== 0) await T.palette(cell);
    let n = 0;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (where && !where(x, y, T.type(x, y))) continue;
      T.set(x, y, cell);
      n++;
    }
    ctx.world.activity?.touchRect?.(x0, y0, x1 + 1, y1 + 1);
    return n;
  };
  T.spawn = (kind, x, y, opts) => ctx.enemyCtl.spawn(kind, x, y, opts);
  /** Remove enemies (native residents) within r of (x, y), keeping `keep`. */
  T.clearEnemies = (x, y, r = 99999, keep = null) => {
    const kept = ctx.enemies.filter((e) => (keep && keep(e)) || Math.hypot(e.x - x, e.y - y) > r);
    ctx.enemies.length = 0;
    ctx.enemies.push(...kept);
  };
  T.tp = (x, y) => {
    const p = ctx.player;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
    if ('fx' in p) p.fx = 0;
    if ('fy' in p) p.fy = 0;
    p.invuln = 0;
  };
  /** Hide the alchemist and every light he carries (vistas, title plates). */
  T.hidePlayer = () => {
    game.composer.drawPlayer = () => {};
    Object.assign(ctx.state.wandLight, { intensity: 0, radius: 0, fillR: 0, fillG: 0, fillB: 0, torchIntensity: 0 });
    ctx.state.lanternHooded = true;
  };
  /** Equip wand I (and optionally II) with exact card lists. */
  T.equip = (wandI, wandII = []) => {
    ctx.wands.applyStarterLoadout([wandI, wandII], []);
    ctx.wands.active = 0;
  };
  return true;
}

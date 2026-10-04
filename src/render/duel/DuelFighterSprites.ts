import type { Ctx, PlayerState } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { STOCK_RULES } from '@/config/stockRules';
import { FIGHTER_DEFS, FIGHTER_ORDER } from '@/content/fighters';

/**
 * DUEL FIGHTER SPRITES (docs/arena/platform-fighter/IMPLEMENTATION-PLAN.md, "Concept sprites"): in stock matches a fighter
 * is drawn from a pixel-art atlas cut from the approved concept sheets, not from the campaign's procedural rig. The rig
 * stays the campaign's (and the fallback while an atlas loads, or for a fighter without one).
 *
 * The atlas is presentation only: every frame is pinned by its anchor pixel to the body's centre-bottom, the hitbox is the
 * body's (PLAYER_HALF_W x PLAYER_H) and never the sprite's. Frames face right; facing left mirrors them.
 */

/** [x, y, w, h, anchorX, anchorY] in atlas pixels (anchorY is the lowest solid row). */
type FrameRect = [number, number, number, number, number, number];
interface AtlasJson { version: number; step: number; frames: Record<string, FrameRect> }
interface Frame {
  w: number; h: number; ax: number; ay: number; rgb: Float32Array; a: Float32Array;
  /** The same frame at cell resolution (2x2 blocks), for surfaces without the fine overlay (expanded wide shots). */
  coarse: { w: number; h: number; rgb: Float32Array; a: Uint8Array };
}

function coarsen(w: number, h: number, rgb: Float32Array, a: Float32Array): Frame['coarse'] {
  const cw = Math.ceil(w / 2), ch = Math.ceil(h / 2), crgb = new Float32Array(cw * ch * 3), ca = new Uint8Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    let n = 0, r = 0, g = 0, b = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const x = i * 2 + dx, y = j * 2 + dy;
      if (x >= w || y >= h) continue;
      const k = y * w + x;
      if (a[k] <= 0) continue;
      n++; r += rgb[k * 3]; g += rgb[k * 3 + 1]; b += rgb[k * 3 + 2];
    }
    if (n >= 2) { const c = j * cw + i; ca[c] = 1; crgb[c * 3] = r / n; crgb[c * 3 + 1] = g / n; crgb[c * 3 + 2] = b / n; }
  }
  return { w: cw, h: ch, rgb: crgb, a: ca };
}
interface Atlas { step: number; frames: Map<string, Frame> }

const atlases = new Map<string, Atlas | 'loading' | 'missing'>();

let everyAtlasRequested = false;
function atlasFor(id: string): Atlas | null {
  // The roster's atlases are small: the first stock frame asks for all of them, so no later swap shows a rig frame.
  if (!everyAtlasRequested) { everyAtlasRequested = true; for (const other of FIGHTER_ORDER) if (!atlases.has(other)) load(other); }
  const hit = atlases.get(id);
  if (hit === undefined) { load(id); return null; }
  return typeof hit === 'string' ? null : hit;
}

function load(id: string): void {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function' || typeof document === 'undefined') { atlases.set(id, 'missing'); return; }
  atlases.set(id, 'loading');
  const base = `${import.meta.env.BASE_URL}assets/arena/fighters/${id}/`;
  void (async () => {
    try {
      const [jsonRes, imgRes] = await Promise.all([fetch(`${base}sprites.json`), fetch(`${base}sprites.png`)]);
      if (!jsonRes.ok || !imgRes.ok) throw new Error('no atlas');
      const json = await jsonRes.json() as AtlasJson;
      const bitmap = await createImageBitmap(await imgRes.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      if (!g) throw new Error('no 2d context');
      g.drawImage(bitmap, 0, 0);
      const width = bitmap.width;
      const px = g.getImageData(0, 0, width, bitmap.height).data;
      bitmap.close(); // (a closed bitmap reports width 0: read it first)
      const frames = new Map<string, Frame>();
      for (const [name, [fx, fy, w, h, ax, ay]] of Object.entries(json.frames)) {
        const rgb = new Float32Array(w * h * 3), a = new Float32Array(w * h);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const s = ((fy + j) * width + fx + i) * 4, k = j * w + i;
          const al = px[s + 3] / 255;
          a[k] = al >= 0.5 ? 1 : 0;
          rgb[k * 3] = px[s] / 255; rgb[k * 3 + 1] = px[s + 1] / 255; rgb[k * 3 + 2] = px[s + 2] / 255;
        }
        frames.set(name, { w, h, ax, ay, rgb, a, coarse: coarsen(w, h, rgb, a) });
      }
      atlases.set(id, { step: json.step, frames });
    } catch {
      atlases.set(id, 'missing');
    }
  })();
}

/** Start fetching a fighter's atlas ahead of its first frame (the lobby or match start calls this). */
export function preloadDuelSprites(id: string): void { if (!atlases.has(id)) load(id); }

const IDLE_TICKS = 11;
const RUN_FRAMES = 6;

/** The pose name for a stock fighter this frame, read from the arena's own views and the body's timers. */
export function duelPose(ctx: Ctx, a: PlayerState): { name: string; facing: number } {
  const arena = ctx.arena!, slot = arena.bound, frame = ctx.state.frameCount;
  const facing = a.facing < 0 ? -1 : 1;
  const ledge = arena.stockLedge(slot);
  if (ledge?.busy) return { name: ledge.phase === 'climb' ? 'ledge_climb' : 'ledge_hang', facing: ledge.side < 0 ? -1 : 1 };
  if (arena.isGrabbed?.(slot)) return { name: 'hurt', facing };
  if (arena.isLaunching(slot)) return { name: 'tumble', facing: a.vx > 0.4 ? -1 : a.vx < -0.4 ? 1 : facing };
  const attack = arena.stockAttack(slot);
  if (attack?.busy && attack.kind && attack.spec) {
    const f = attack.facing < 0 ? -1 : 1;
    if (attack.phase === 'startup') return { name: `${attack.kind}_windup`, facing: f };
    // Late in the end lag the weapon comes home: the follow-through frame.
    const late = attack.phase === 'recovery' && attack.age - attack.spec.startup - attack.spec.active > attack.spec.recovery * .35;
    return { name: `${attack.kind}_${late ? 'recover' : 'strike'}`, facing: f };
  }
  const grab = arena.stockGrab?.(slot);
  if (grab?.busy) {
    const f = grab.facing < 0 ? -1 : 1;
    if (grab.phase === 'recovery' && (grab.throwX !== 0 || grab.throwY !== 0)) return { name: 'throw', facing: f };
    return { name: 'grab', facing: f };
  }
  const shield = arena.stockShield?.(slot);
  if (shield?.busy) return { name: shield.phase === 'broken' ? 'shield_broken' : 'shield', facing };
  const dodge = arena.stockDodge(slot);
  if (dodge?.busy) return { name: dodge.inAir ? 'airdodge' : 'dodge', facing: dodge.vx > 0.1 ? 1 : dodge.vx < -0.1 ? -1 : facing };
  // A kit's own moves hold their pose for a beat after the press (the ultimate longer); the winner strikes its pose.
  const view = ctx.fighters?.view;
  if (view && view.ultimate.usedAt > 0 && frame - view.ultimate.usedAt < 26) return { name: 'ultimate', facing };
  if (view && view.tactical.usedAt > 0 && frame - view.tactical.usedAt < 18) return { name: 'tactical', facing };
  if (arena.stockSpecial(slot)?.busy || a.firing || a.recoilT > 0) return { name: 'cast', facing: Math.cos(a.aimAngle) < 0 ? -1 : 1 };
  const match = arena.stockMatch;
  if (match?.state === 'finished' && match.winner === slot && a.grounded) return { name: 'victory', facing };
  if (arena.isRecovering(slot)) return { name: 'recover', facing };
  if (a.staggerT > 0) return { name: 'hurt', facing };
  if (!a.grounded) {
    if (a.stockFastFall) return { name: 'fastfall', facing };
    if (a.vy < -1.2) return { name: 'rise', facing };
    if (a.vy < 0.8) return { name: 'apex', facing };
    return { name: 'fall', facing };
  }
  if (a.landTimer > 3 || a.crouchT > 3) return { name: 'land', facing };
  const speed = Math.abs(a._svx || a.vx);
  if (speed > 0.25) {
    // The stride phase drives the cycle, so feet keep time with the body's real speed.
    const phase = ((a.stridePhase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return { name: `run${Math.floor(phase / (Math.PI * 2) * RUN_FRAMES) % RUN_FRAMES}`, facing };
  }
  return { name: `idle${Math.floor(frame / IDLE_TICKS) % 4}`, facing };
}

/** Pose names a sheet may not have, in order of preference. */
const FALLBACK: Record<string, readonly string[]> = {
  ledge_climb: ['ledge_hang', 'recover'], ledge_hang: ['recover'], tumble: ['hurt'], shield_broken: ['hurt'], shield: ['land'],
  throw: ['opener_strike'], grab: ['opener_strike'], airdodge: ['fastfall', 'apex'], dodge: ['land'], cast: ['opener_strike'],
  recover: ['rise'], fastfall: ['fall'], apex: ['rise'], fall: ['apex'], land: ['idle0'],
  opener_windup: ['idle0'], opener_strike: ['cast'], launcher_windup: ['land'], launcher_strike: ['recover'],
  aerial_windup: ['apex'], aerial_strike: ['opener_strike'], finisher_windup: ['land'], finisher_strike: ['opener_strike'],
  opener_recover: ['opener_strike'], launcher_recover: ['launcher_strike'], aerial_recover: ['aerial_strike'], finisher_recover: ['finisher_strike'],
  tactical: ['cast'], ultimate: ['cast'], victory: ['launcher_strike', 'idle0'],
};

function frameFor(atlas: Atlas, name: string): Frame | null {
  let f = atlas.frames.get(name);
  if (f) return f;
  for (const alt of FALLBACK[name] ?? []) { f = atlas.frames.get(alt); if (f) return f; }
  if (name.startsWith('idle') || name.startsWith('run')) return atlas.frames.get('idle0') ?? null;
  return atlas.frames.get('idle0') ?? null;
}

let scratchRgb = new Float32Array(64 * 64 * 3);
let scratchA = new Float32Array(64 * 64);

/** A frame turned a quarter clockwise `q` times (the launched tumble spins in clean 90-degree pixel steps). */
const turned = new WeakMap<Frame, Frame[]>();
function quarterTurn(fr: Frame, q: number): Frame {
  q = ((q % 4) + 4) % 4;
  if (q === 0) return fr;
  let list = turned.get(fr);
  if (!list) { list = [fr]; turned.set(fr, list); }
  for (let k = list.length; k <= q; k++) {
    const src = list[k - 1], w = src.h, h = src.w, rgb = new Float32Array(w * h * 3), a = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const s = (src.h - 1 - i) * src.w + j, d = j * w + i;
      a[d] = src.a[s]; rgb[d * 3] = src.rgb[s * 3]; rgb[d * 3 + 1] = src.rgb[s * 3 + 1]; rgb[d * 3 + 2] = src.rgb[s * 3 + 2];
    }
    list.push({ w, h, ax: w >> 1, ay: h >> 1, rgb, a, coarse: coarsen(w, h, rgb, a) });
  }
  return list[q];
}

/** The transparent pixels that touch the silhouette (4-neighbour): the protection rim's outline, cached per frame. */
const rims = new WeakMap<Frame, Int16Array>();
function rimOf(fr: Frame): Int16Array {
  let rim = rims.get(fr);
  if (rim) return rim;
  const out: number[] = [];
  const solid = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < fr.w && j < fr.h && fr.a[j * fr.w + i] > 0;
  for (let j = -1; j <= fr.h; j++) for (let i = -1; i <= fr.w; i++) {
    if (solid(i, j)) continue;
    if (solid(i - 1, j) || solid(i + 1, j) || solid(i, j - 1) || solid(i, j + 1)) out.push(i, j);
  }
  rim = Int16Array.from(out); rims.set(fr, rim); return rim;
}

/** Per slot: whether its body is away (down, waiting to respawn) and when it last came back or its bout began. */
const entrances = new Map<number, { away: boolean; at: number }>();
let entranceMatch: unknown = null, entranceState = '';

/**
 * Watch the bound body come and go (called every frame for every slot, down or not): a body back from a ring-out, or any
 * body at a bout's countdown, makes an entrance.
 */
export function noteDuelPresence(ctx: Ctx): void {
  const m = ctx.arena?.stockMatch;
  if (!m) return;
  const frame = ctx.state.frameCount;
  if (m !== entranceMatch || (m.state === 'countdown' && entranceState !== 'countdown')) entrances.clear();
  entranceMatch = m; entranceState = m.state;
  const slot = ctx.arena!.bound;
  let e = entrances.get(slot);
  if (!e) { e = { away: false, at: frame }; entrances.set(slot, e); }
  if (ctx.player.dead) e.away = true;
  else if (e.away) { e.away = false; e.at = frame; }
}
const ENTRANCE_TICKS = 26;

/**
 * The body's presentation offset this frame, in cells, on the half-cell grid: the anticipation pull-back of a windup,
 * the lunge of a strike easing home through recovery, and the struck fighter's shake through the impact hitstop.
 * Presentation only: the hitbox never moves.
 */
function motionOffset(ctx: Ctx, a: PlayerState): { dx: number; dy: number } {
  const arena = ctx.arena!, attack = arena.stockAttack(arena.bound);
  let dx = 0, dy = 0;
  const spec = attack?.spec;
  if (attack?.busy && spec && attack.kind) {
    const f = attack.facing < 0 ? -1 : 1, kind = attack.kind;
    const lunge = kind === 'finisher' ? 2.5 : kind === 'opener' ? 1.5 : kind === 'aerial' ? 1 : .5;
    const rise = kind === 'launcher' ? 2 : 0;
    if (attack.phase === 'startup') {
      const t = attack.age / Math.max(1, spec.startup), e = t * t;
      dx = -f * e * (kind === 'finisher' ? 1.5 : 1); dy = kind === 'launcher' ? e : 0;
    } else {
      const into = attack.age - spec.startup - spec.active;
      const k = attack.phase === 'active' ? 1 : Math.max(0, 1 - into / Math.max(1, spec.recovery * .6));
      dx = f * lunge * k; dy = -rise * k;
    }
  }
  const stop = ctx.fx.hitstop ?? 0;
  if (stop > 0 && a.staggerT > 0) dx += (stop % 2 ? 1 : -1) * (stop >= 5 ? 1 : .5);
  return { dx: Math.round(dx * 2) / 2, dy: Math.round(dy * 2) / 2 };
}

function accentRgb(id: string): [number, number, number] {
  const hex = Number.parseInt((FIGHTER_DEFS[id as keyof typeof FIGHTER_DEFS]?.accent ?? '#efac58').slice(1), 16);
  return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
}

/** A frame laid see-through in its own colours (the strike's smear: where the windup was a tick ago). */
function blendFrame(out: PixelSurface, fr: Frame, mirror: boolean, x0: number, y0: number, step: number, alpha: number): void {
  if (!out.blendFinePx) return;
  for (let j = 0; j < fr.h; j++) for (let i = 0; i < fr.w; i++) {
    const k = j * fr.w + (mirror ? fr.w - 1 - i : i);
    if (fr.a[k] <= 0) continue;
    out.blendFinePx(x0 + i * step, y0 + j * step, fr.rgb[k * 3] * alpha, fr.rgb[k * 3 + 1] * alpha, fr.rgb[k * 3 + 2] * alpha, alpha);
  }
}

/** The entrance (a respawn or the bout's start): a column of light drops onto the spawn and rings out at the feet. */
function drawEntrance(out: PixelSurface, a: PlayerState, age: number, color: readonly [number, number, number]): void {
  if (!out.blendFinePx || age >= ENTRANCE_TICKS) return;
  const step = out.pixelStep ?? 1, k = 1 - age / ENTRANCE_TICKS, top = a.y - 70 + Math.min(52, age * 6), half = 3 + 3 * k;
  for (let y = top; y <= a.y; y += step) for (let x = -half; x <= half; x += step) {
    const edge = Math.abs(x) / half, al = k * (1 - edge * edge) * (.35 + .65 * (y - top) / Math.max(1, a.y - top));
    const hot = edge < .35 ? 1 : 0;
    out.blendFinePx(a.x + .5 + x, y, (color[0] + (1 - color[0]) * hot) * al, (color[1] + (1 - color[1]) * hot) * al, (color[2] + (1 - color[2]) * hot) * al, al);
  }
  const ring = 4 + age * 1.2;
  for (let t = 0; t < Math.PI * 2; t += .08) out.blendFinePx(a.x + .5 + Math.cos(t) * ring, a.y + Math.sin(t) * ring * .25, color[0] * k, color[1] * k, color[2] * k, k);
}

/**
 * Draw the bound fighter from its atlas. Returns false when this is not a stock fighter on a fine surface, or its atlas is
 * not ready, so the caller falls back to the rig.
 */
export function drawDuelFighter(out: PixelSurface, light: LightField, ctx: Ctx): boolean {
  const id = ctx.fighters?.id;
  if (!id || !ctx.arena?.stockMatch) return false;
  const atlas = atlasFor(id);
  if (!atlas) return false;
  const a = ctx.player;
  const pose = duelPose(ctx, a);
  let fr = frameFor(atlas, pose.name);
  if (!fr) return false;
  const step = atlas.step, frame = ctx.state.frameCount, slot = ctx.arena.bound;
  // A launched body spins in quarter turns, forward along its flight (faster the harder it flies).
  const spinning = pose.name === 'tumble' && ctx.arena.isLaunching(slot);
  if (spinning) {
    const speed = Math.hypot(a.vx, a.vy), rate = speed > 9 ? 2 : speed > 5 ? 3 : 4;
    fr = quarterTurn(fr, Math.floor(frame / rate) * (a.vx < 0 ? -1 : 1));
  }
  const sinceEntrance = frame - (entrances.get(slot)?.at ?? -1e9);
  const protectedNow = sinceEntrance < STOCK_RULES.protectionTicks && a.invuln > 0;
  const color = accentRgb(id);
  const { dx, dy } = motionOffset(ctx, a);
  // Light: the scene's own light at the chest, kept bright enough that silhouettes always read (the concept's fighters are
  // the highest-contrast thing on screen), warmed slightly by fire and cooled by the teal lamps.
  const sample = typeof light?.sample === 'function' ? light.sample(a.x, a.y - 9) : { r: 1, g: 1, b: 1 };
  const lum = sample.r * 0.3 + sample.g * 0.5 + sample.b * 0.2;
  const k = Math.min(1.12, Math.max(0.82, 0.78 + lum * 0.35));
  const tr = k * (0.92 + 0.08 * (sample.r / Math.max(0.05, lum))), tg = k * (0.92 + 0.08 * (sample.g / Math.max(0.05, lum))), tb = k * (0.92 + 0.08 * (sample.b / Math.max(0.05, lum)));
  // A struck fighter flashes toward white for the first hitstun frames (held through the impact hitstop).
  const flash = a.staggerT > 7 ? 0.45 : 0;
  const mirror = pose.facing < 0;
  if (!out.blitFine || (out.pixelStep ?? 1) >= 1) {
    // Cell-resolution surface (an expanded wide shot): the coarse frame, one cell per 2x2 block.
    const c = fr.coarse;
    const cax = spinning ? c.w >> 1 : Math.floor((mirror ? fr.w - 1 - fr.ax : fr.ax) / 2), cay = spinning ? c.h >> 1 : Math.floor(fr.ay / 2);
    const ox = Math.round(a.x + dx), oy = Math.round((spinning ? a.y - 8 : a.y) + dy);
    for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) {
      const k = j * c.w + (mirror ? c.w - 1 - i : i);
      if (!c.a[k]) continue;
      out.setPx(ox + i - cax, oy + j - cay, c.rgb[k * 3] * tr, c.rgb[k * 3 + 1] * tg, c.rgb[k * 3 + 2] * tb);
    }
    return true;
  }
  const n = fr.w * fr.h;
  if (scratchA.length < n) { scratchA = new Float32Array(n); scratchRgb = new Float32Array(n * 3); }
  for (let j = 0; j < fr.h; j++) for (let i = 0; i < fr.w; i++) {
    const src = j * fr.w + (mirror ? fr.w - 1 - i : i), dst = j * fr.w + i;
    const al = fr.a[src];
    scratchA[dst] = al;
    if (al <= 0) continue;
    const r = fr.rgb[src * 3] * tr, g = fr.rgb[src * 3 + 1] * tg, b = fr.rgb[src * 3 + 2] * tb;
    scratchRgb[dst * 3] = r + (1 - r) * flash; scratchRgb[dst * 3 + 1] = g + (1 - g) * flash; scratchRgb[dst * 3 + 2] = b + (1 - b) * flash;
  }
  const ax = spinning ? fr.w / 2 - .5 : mirror ? fr.w - 1 - fr.ax : fr.ax;
  const ay = spinning ? fr.h / 2 - .5 : fr.ay;
  // Body centre-bottom: the hitbox spans cells x-halfW..x+halfW and its feet row is y (a spin turns about the waist).
  const x0 = a.x + dx + 0.5 - (ax + 0.5) * step;
  const y0 = (spinning ? a.y - 8 : a.y) + dy + 1 - (ay + 1) * step;
  const quiet = ctx.state.reduceFlashes === true;
  if (sinceEntrance < ENTRANCE_TICKS && !quiet) drawEntrance(out, a, sinceEntrance, color);
  // The strike's smear: for its first two ticks the windup frame lingers, half-faded, a step behind.
  const attack = ctx.arena.stockAttack(slot);
  if (!quiet && attack?.busy && attack.spec && attack.kind && attack.phase === 'active' && attack.age - attack.spec.startup < 2) {
    const wind = frameFor(atlas, `${attack.kind}_windup`);
    if (wind && wind !== fr) {
      const wax = mirror ? wind.w - 1 - wind.ax : wind.ax, back = attack.facing < 0 ? 1 : -1;
      blendFrame(out, wind, mirror, a.x + dx / 2 + back + 0.5 - (wax + 0.5) * step, a.y + dy / 2 + 1 - (wind.ay + 1) * step, step, .32);
    }
  }
  out.blitFine(x0, y0, fr.w, fr.h, scratchRgb.subarray(0, n * 3), scratchA.subarray(0, n), null);
  if (protectedNow && out.blendFinePx) {
    // Protection: an arcade flicker on the silhouette's rim, the fighter's colour and ivory by turns.
    const ivory = (frame >> 2) % 2 === 0, al = quiet ? .45 : .85;
    const r = ivory ? 1 : color[0], g = ivory ? .95 : color[1], b = ivory ? .8 : color[2];
    const rim = rimOf(fr);
    for (let i = 0; i < rim.length; i += 2) {
      const px = mirror ? fr.w - 1 - rim[i] : rim[i];
      out.blendFinePx(x0 + px * step, y0 + rim[i + 1] * step, r * al, g * al, b * al, al);
    }
  }
  return true;
}

/**
 * A motion echo (motion-defense.png's dodge trail): the fighter's current frame, offset behind it, tinted toward `tint`
 * and see-through. Returns false when there is no atlas to echo (the caller keeps its own fallback).
 */
export function drawDuelGhost(out: PixelSurface, ctx: Ctx, dx: number, dy: number, alpha: number, tint: readonly [number, number, number]): boolean {
  const id = ctx.fighters?.id;
  if (!id || !ctx.arena?.stockMatch || !out.blendFinePx || (out.pixelStep ?? 1) >= 1) return false;
  const atlas = atlasFor(id);
  if (!atlas) return false;
  const a = ctx.player, pose = duelPose(ctx, a), fr = frameFor(atlas, pose.name);
  if (!fr) return false;
  const mirror = pose.facing < 0, step = atlas.step, ax = mirror ? fr.w - 1 - fr.ax : fr.ax;
  const x0 = a.x + dx + 0.5 - (ax + 0.5) * step, y0 = a.y + dy + 1 - (fr.ay + 1) * step;
  for (let j = 0; j < fr.h; j++) for (let i = 0; i < fr.w; i++) {
    const k = j * fr.w + (mirror ? fr.w - 1 - i : i);
    if (fr.a[k] <= 0) continue;
    const lum = fr.rgb[k * 3] * .3 + fr.rgb[k * 3 + 1] * .59 + fr.rgb[k * 3 + 2] * .11;
    const r = (tint[0] * .7 + lum * .5) * alpha, g = (tint[1] * .7 + lum * .5) * alpha, b = (tint[2] * .7 + lum * .5) * alpha;
    out.blendFinePx(x0 + i * step, y0 + j * step, r, g, b, alpha);
  }
  return true;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __duelSprites?: unknown }).__duelSprites = { atlases, duelPose, drawDuelFighter };
}

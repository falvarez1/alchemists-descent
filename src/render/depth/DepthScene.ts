import { BACKDROP_LAYER_SPECS, DEFAULT_BACKDROP_GRADE } from '@/config/backdrop';
import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { type DepthKit, MAX_DEPTH_PLANES, depthKitFor } from '@/config/depthKits';
import type { BackdropLayerId, BackdropLayerSettings, BackdropProfile, Ctx, LevelRuntime } from '@/core/types';
import { tetherView } from '@/combat/Telekinesis';
import { renderOpenLut } from '@/core/darkness';
import { Background } from '@/render/Background';
import { bakeForeground, bakePlane } from '@/render/depth/bake';
import { drawDepthParticles, type ShaftPlane } from '@/render/depth/depthParticles';
import { foregroundExtent, pulseOpacity } from '@/render/depth/parallax';
import type { Bitmap } from '@/render/depth/raster';
import { type RevealPoint, type RevealRect, RevealField } from '@/render/depth/reveal';
import type {
  BackdropFloorGrade, DepthParticleField, DepthParticleFrame, DepthParticlePass, ForegroundSource, LightField,
  ParallaxBitmapLayer, ParallaxLayers, PixelSurface,
} from '@/render/pixels';
import { usesTerrainArt } from '@/render/TerrainArt';
import { Cell } from '@/sim/CellType';
import { TEA } from '@/world/teaMachine';

/**
 * THE DEPTH SCENE — the layered scenery around the play layer (config/depthKits).
 *
 * It is the compositors' ParallaxLayers: its five backdrop slots carry the
 * active kit's planes (far → near) with their parallax, opacity and light
 * response, so the CPU, WebGL2 and WebGPU compose paths draw the same planes
 * from the same bitmaps with no path-specific code. Outside expedition play
 * (the sandbox, Builder playtests with their own backdrop, a level whose
 * backdrop an author overrode) it mirrors the classic two-plate backdrop.
 *
 * It also owns the foreground occluder plane (drawn by the presentation
 * backends as a quad over the frame), the reveal field that keeps that plane
 * off the player, creatures, pickups and hazards, and the depth particles.
 *
 * Baking is incremental — one plane per frame — so entering a floor never
 * hitches; planes appear under the level curtain.
 */

type SlotSource = { kind: 'kit'; key: string } | { kind: 'classic' };

interface BakedKit {
  readonly kit: DepthKit;
  readonly planes: (Bitmap | null)[];
  /** Plane i is final (procedural baked, or its image arrived and was baked). */
  readonly done: boolean[];
  foreground: Bitmap | null;
  foregroundDone: boolean;
  readonly levelId: string | null;
}

const NEUTRAL_LAYER: BackdropLayerSettings = { speed: 0, opacity: 0, offsetX: 0, offsetY: 0, scale: 1, visible: false };

let depthEnabled = true;
let foregroundEnabled = true;
let particlesEnabled = true;

/** Dev-only switches for A/B probes and perf runs. */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __depth?: unknown }).__depth = {
    setEnabled: (on: boolean): void => { depthEnabled = on; },
    setForeground: (on: boolean): void => { foregroundEnabled = on; },
    setParticles: (on: boolean): void => { particlesEnabled = on; },
  };
}

let versionCounter = 1;

/** Baked kits kept in memory (the current floor and the one before it). */
const KIT_CACHE = 2;

export class DepthScene implements ParallaxLayers {
  readonly backdropLayers: ParallaxBitmapLayer[];
  profile: BackdropProfile | null = null;
  grade: BackdropFloorGrade | null = null;
  readonly foreground: ForegroundState;

  private readonly classic = new Background();
  private readonly classicVersions = new Int32Array(MAX_DEPTH_PLANES).fill(-1);
  private readonly baked = new Map<string, BakedKit>();
  private readonly images = new Map<string, Bitmap | 'loading' | 'failed'>();
  private readonly slotVersions = new Int32Array(MAX_DEPTH_PLANES).fill(-1);
  private source: SlotSource = { kind: 'classic' };
  private activeKit: BakedKit | null = null;
  private readonly kitProfile: BackdropProfile;
  private shaftPlane: ShaftPlane | null = null;
  /** Pooled reveal points (the list is rebuilt every frame without allocating). */
  private readonly points: RevealPoint[] = [];
  private readonly pointPool: RevealPoint[] = [];
  /** Authored set pieces occluders never cover (floor 1: the Bell & Tea Engine's hall and catwalk). */
  private readonly rects: RevealRect[] = [];
  private readonly teaRect: RevealRect = { x0: 0, y0: 0, x1: 0, y1: 0, pad: 36 };
  private pointCount = 0;
  private lightCtx: Ctx | null = null;
  /** Light catch (G) and designed-darkness factor (B) for the reveal field (bound once). */
  private readonly lightAt = (vx: number, vy: number, out: Float32Array): void => {
    const ctx = this.lightCtx;
    const lq = ctx?.lightQuery;
    if (!ctx || !lq) { out[0] = 1; out[1] = 1; return; }
    const x = ctx.camera.renderX + vx, y = ctx.camera.renderY + vy;
    out[0] = Math.min(1, lq.level(x, y) * 1.1);
    out[1] = renderOpenLut(ctx.state.highReadability === true)[Math.max(0, Math.min(255, Math.round(lq.darkness(x, y) * 255)))];
  };
  private lastRuntime: LevelRuntime | null = null;

  constructor() {
    this.backdropLayers = BACKDROP_LAYER_SPECS.map((spec) => ({
      id: spec.id,
      label: spec.label,
      file: spec.file,
      src: spec.src,
      defaultSpeed: spec.defaultSpeed,
      version: 0,
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray(4),
      loaded: false,
      lit: 1,
    }));
    const layers = {} as Record<BackdropLayerId, BackdropLayerSettings>;
    for (const spec of BACKDROP_LAYER_SPECS) layers[spec.id] = { ...NEUTRAL_LAYER };
    this.kitProfile = { layers, grade: { ...DEFAULT_BACKDROP_GRADE } };
    this.foreground = new ForegroundState();
  }

  get ready(): boolean {
    return this.source.kind === 'classic' ? this.classic.ready : (this.activeKit?.done.every(Boolean) ?? false);
  }

  /** The kit this frame should show, or null for the classic backdrop. */
  kitFor(ctx: Ctx): DepthKit | null {
    if (!depthEnabled || !usesTerrainArt(ctx)) return null;
    const runtime = ctx.levels?.current;
    if (!runtime || runtime.backdrop) return null;
    const levelId = runtime.backdropLevelId ?? runtime.def.id;
    if (ctx.params.backdrop.levels[levelId]?.enabled) return null;
    return depthKitFor(runtime.living ? 'earthen' : runtime.def.biome);
  }

  sync(ctx: Ctx): void {
    const kit = this.kitFor(ctx);
    const runtime = ctx.levels?.current ?? null;
    if (!kit) {
      this.useClassic();
      this.foreground.enabled = false;
      return;
    }
    const levelId = runtime?.def.id ?? null;
    // Floor 1's foreground is authored per room; generated floors share the kit's scatter.
    const key = `${kit.id}:${kit.label}:${kit.id === 'bellows' && levelId === 'd1' ? 'd1' : '*'}`;
    let baked = this.baked.get(key);
    if (!baked) {
      baked = {
        kit,
        planes: kit.planes.map(() => null),
        done: kit.planes.map(() => false),
        foreground: null,
        foregroundDone: false,
        levelId: kit.id === 'bellows' && levelId === 'd1' ? 'd1' : null,
      };
      this.baked.set(key, baked);
      // Keep the two most recent floors baked (a floor's planes and foreground
      // are ~10-15 MB); an older floor re-bakes over a few frames on return.
      while (this.baked.size > KIT_CACHE) {
        const oldest = this.baked.keys().next().value;
        if (oldest === undefined || oldest === key) break;
        this.baked.delete(oldest);
      }
    } else {
      // Most-recently used last (Map iteration order is insertion order).
      this.baked.delete(key);
      this.baked.set(key, baked);
    }
    this.bakeStep(baked);
    const switched = this.source.kind !== 'kit' || this.source.key !== key;
    if (switched) {
      this.source = { kind: 'kit', key };
      this.activeKit = baked;
      this.slotVersions.fill(-1);
    }
    this.installKit(baked);
    this.updateKitProfile(ctx, baked);
    if (this.grade?.mul !== kit.grade.mul) this.grade = { ...kit.grade, offsetX: 0, mirror: false, machinery: 1 };
    this.profile = this.kitProfile;
    const snap = runtime !== this.lastRuntime;
    this.lastRuntime = runtime;
    this.updateForeground(ctx, baked, snap);
    this.foreground.particles.set(particlesEnabled && ctx.state.mode === 'play', kit, this.shaftPlane);
  }

  drawParticles(out: PixelSurface, light: LightField, ctx: Ctx, pass: DepthParticlePass): void {
    if (!particlesEnabled || this.source.kind !== 'kit' || !this.activeKit) return;
    drawDepthParticles(out, light, ctx, this.activeKit.kit, pass, this.shaftPlane);
  }

  /* ------------------------------ slots ------------------------------ */

  private useClassic(): void {
    this.foreground.particles.set(false, null, null);
    if (this.source.kind !== 'classic') {
      this.source = { kind: 'classic' };
      this.activeKit = null;
      this.classicVersions.fill(-1);
    }
    this.profile = null;
    this.grade = null;
    this.shaftPlane = null;
    const src = this.classic.backdropLayers;
    for (let i = 0; i < this.backdropLayers.length; i++) {
      const from = src[i];
      if (!from || this.classicVersions[i] === from.version) continue;
      this.classicVersions[i] = from.version;
      const to = this.backdropLayers[i];
      to.pixels = from.pixels;
      to.width = from.width;
      to.height = from.height;
      to.loaded = from.loaded;
      to.lit = 1;
      to.version = versionCounter++;
    }
  }

  private installKit(baked: BakedKit): void {
    for (let i = 0; i < this.backdropLayers.length; i++) {
      const bmp = baked.planes[i] ?? null;
      const stamp = bmp ? (baked.done[i] ? 2 : 1) : 0;
      if (this.slotVersions[i] === stamp) continue;
      this.slotVersions[i] = stamp;
      const to = this.backdropLayers[i];
      to.pixels = bmp ? bmp.pixels : new Uint8ClampedArray(4);
      to.width = bmp ? bmp.width : 1;
      to.height = bmp ? bmp.height : 1;
      to.loaded = Boolean(bmp);
      to.lit = baked.kit.planes[i]?.lit ?? 1;
      to.version = versionCounter++;
    }
    const shaftIndex = baked.kit.planes.findIndex((p) => p.shafts);
    const shaftBmp = shaftIndex >= 0 ? baked.planes[shaftIndex] : null;
    const shaftSpec = shaftIndex >= 0 ? baked.kit.planes[shaftIndex] : null;
    // Keep the same object while the plane is unchanged (the GL points re-upload on change).
    if (!shaftBmp || !shaftSpec) this.shaftPlane = null;
    else if (this.shaftPlane?.bitmap !== shaftBmp) {
      this.shaftPlane = { bitmap: shaftBmp, parallax: shaftSpec.parallax, scale: shaftSpec.scale, opacity: shaftSpec.opacity };
    }
  }

  private updateKitProfile(ctx: Ctx, baked: BakedKit): void {
    const frame = ctx.state.frameCount;
    for (let i = 0; i < BACKDROP_LAYER_SPECS.length; i++) {
      const id = BACKDROP_LAYER_SPECS[i].id;
      const spec = baked.kit.planes[i];
      const layer = this.kitProfile.layers[id];
      if (!spec || !baked.planes[i]) {
        Object.assign(layer, NEUTRAL_LAYER);
        continue;
      }
      layer.speed = spec.parallax;
      layer.scale = spec.scale;
      layer.offsetX = spec.offsetX ?? 0;
      layer.offsetY = spec.offsetY ?? 0;
      layer.visible = true;
      layer.opacity = spec.pulse ? pulseOpacity(spec.opacity, spec.pulse.amp, spec.pulse.period, frame, i) : spec.opacity;
    }
  }

  /** Bake at most one missing piece of the kit this frame (planes far → near, then the foreground). */
  private bakeStep(baked: BakedKit): void {
    const kit = baked.kit;
    for (let i = 0; i < kit.planes.length; i++) {
      if (baked.done[i]) continue;
      const source = kit.planes[i].source;
      if (source.kind === 'image') {
        const img = this.image(source.src);
        if (img === 'loading') continue;
        if (img === 'failed') { baked.done[i] = true; continue; }
        baked.planes[i] = bakePlane(kit, i, img);
        baked.done[i] = true;
        return;
      }
      baked.planes[i] = bakePlane(kit, i, null);
      baked.done[i] = true;
      return;
    }
    if (!baked.foregroundDone) {
      const fg = kit.foreground;
      baked.foreground = fg
        ? bakeForeground(kit, baked.levelId, foregroundExtent(WIDTH, VIEW_W, fg.parallax), foregroundExtent(HEIGHT, VIEW_H, fg.parallax))
        : null;
      baked.foregroundDone = true;
    }
  }

  private image(src: string): Bitmap | 'loading' | 'failed' {
    const hit = this.images.get(src);
    if (hit) return hit;
    // The refinery plates are the classic backdrop's own: reuse its decode.
    const classic = this.classic.backdropLayers.find((l) => l.src === src);
    if (classic?.loaded && classic.width > 1) {
      const bmp = { width: classic.width, height: classic.height, pixels: classic.pixels };
      this.images.set(src, bmp);
      return bmp;
    }
    if (classic) return 'loading';
    if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
      this.images.set(src, 'failed');
      return 'failed';
    }
    this.images.set(src, 'loading');
    void (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bitmap = await createImageBitmap(await res.blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        if (!g) throw new Error('no 2d context');
        g.drawImage(bitmap, 0, 0);
        this.images.set(src, { width: bitmap.width, height: bitmap.height, pixels: g.getImageData(0, 0, bitmap.width, bitmap.height).data });
        bitmap.close();
      } catch {
        console.warn(`[depth] failed to load ${src}`);
        this.images.set(src, 'failed');
      }
    })();
    return 'loading';
  }

  /* ---------------------------- foreground ---------------------------- */

  private updateForeground(ctx: Ctx, baked: BakedKit, snap: boolean): void {
    const fgSpec = baked.kit.foreground;
    const fg = this.foreground;
    fg.enabled = foregroundEnabled && Boolean(fgSpec && baked.foreground) && ctx.state.mode === 'play';
    if (!fgSpec || !baked.foreground) return;
    if (fg.bitmap !== baked.foreground) {
      fg.bitmap = baked.foreground;
      fg.version = versionCounter++;
    }
    fg.parallax = fgSpec.parallax;
    fg.scale = fgSpec.scale;
    fg.opacity = fgSpec.opacity * (ctx.state.highReadability ? 0.7 : 1);
    // The reveal field eases at 30 Hz (half the ticks): smooth, and half the cost.
    if (!snap && fg.reveal.version > 0 && (ctx.state.frameCount & 1) === 1) return;
    this.collectRevealPoints(ctx);
    this.lightCtx = ctx;
    fg.reveal.update(this.points, { readable: ctx.state.highReadability === true, snap }, ctx.lightQuery ? this.lightAt : null, this.rects);
  }

  private pushPoint(camX: number, camY: number, x: number, y: number, r: number): void {
    const vx = x - camX, vy = y - camY;
    if (vx < -r || vy < -r || vx > VIEW_W + r || vy > VIEW_H + r) return;
    let p = this.pointPool[this.pointCount];
    if (!p) { p = { x: 0, y: 0, r: 0 }; this.pointPool.push(p); }
    p.x = vx; p.y = vy; p.r = r;
    this.points.push(p);
    this.pointCount++;
  }

  /** Everything the occluders must never hide, in view cells. */
  private collectRevealPoints(ctx: Ctx): void {
    const pts = this.points;
    pts.length = 0;
    this.pointCount = 0;
    const camX = ctx.camera.renderX, camY = ctx.camera.renderY;
    const push = (x: number, y: number, r: number): void => this.pushPoint(camX, camY, x, y, r);
    // The engine is played, not watched: its whole hall stays clear.
    this.rects.length = 0;
    if (ctx.levels?.current?.living) {
      const b = TEA.simBounds, t = this.teaRect;
      t.x0 = b.x0 - camX; t.y0 = b.y0 - camY; t.x1 = b.x1 - camX; t.y1 = b.y1 - camY;
      if (t.x1 > -t.pad && t.y1 > -t.pad && t.x0 < VIEW_W + t.pad && t.y0 < VIEW_H + t.pad) this.rects.push(t);
    }
    const p = ctx.player;
    if (!p.dead) push(p.x, p.y - 9, 46);
    for (const e of ctx.enemies) {
      if (e.hp <= 0) continue;
      const def = ctx.enemyCtl?.defs?.[e.kind];
      const h = def?.h ?? 20, hw = def?.halfW ?? 10;
      push(e.x, e.y - h / 2, Math.max(28, Math.max(h, hw * 2) * 0.8 + 16));
    }
    // Telekinesis: the held (or flying) dead, and the tether from the wand to the grip.
    for (const c of ctx.corpses?.list ?? []) {
      if (c.grip || Math.abs(c.pvx) + Math.abs(c.pvy) > 0.6) push(c.e.x, c.e.y - 6, 34);
    }
    const tether = tetherView(ctx);
    if (tether) {
      const n = Math.max(1, Math.ceil(Math.hypot(tether.x1 - tether.x0, tether.y1 - tether.y0) / 24));
      for (let k = 0; k <= n; k++) push(tether.x0 + (tether.x1 - tether.x0) * (k / n), tether.y0 + (tether.y1 - tether.y0) * (k / n), 22);
    }
    for (const pr of ctx.projectiles) push(pr.x, pr.y, 22);
    const rt = ctx.levels?.current;
    if (rt) {
      for (const pk of rt.pickups) if (!pk.taken) push(pk.x, pk.y, 24);
      for (const m of rt.mechanisms) push(m.x + (m.w ?? 0) / 2, m.y + (m.h ?? 0) / 2, 28);
      if (rt.portal) push(rt.portal.x, rt.portal.y, 40);
      for (const w of rt.waystones) push(w.x, w.y - 8, 30);
    }
    // Hazard cells (lava, fire, acid) on a coarse grid: an occluder never hides a burn.
    const world = ctx.world;
    for (let vy = 4; vy < VIEW_H; vy += 16) for (let vx = 4; vx < VIEW_W; vx += 16) {
      const wx = camX + vx, wy = camY + vy;
      if (!world.inBounds(wx, wy)) continue;
      const t = world.types[wx + wy * world.width];
      if (t === Cell.Lava || t === Cell.Fire || t === Cell.Acid) push(wx, wy, 20);
      if (pts.length > 160) return;
    }
  }
}

/** The foreground plane's live state (the ForegroundSource the backends read). */
export class ForegroundState implements ForegroundSource {
  enabled = false;
  bitmap: Bitmap | null = null;
  version = 0;
  parallax = 1.4;
  scale = 1.5;
  opacity = 0;
  /** The reveal field doubles as the source's reveal texture (w, h, bytes, version). */
  readonly reveal = new RevealField(VIEW_W, VIEW_H);
  readonly particles = new ParticleFrameState();
}

/** The depth particles' live state (DepthParticleFrame). */
export class ParticleFrameState implements DepthParticleFrame {
  enabled = false;
  version = 0;
  seed = 0;
  fields: readonly DepthParticleField[] = [];
  shaft: ShaftPlane | null = null;
  private kit: DepthKit | null = null;

  set(enabled: boolean, kit: DepthKit | null, shaft: ShaftPlane | null): void {
    this.enabled = enabled && kit !== null;
    if (kit === this.kit && shaft === this.shaft) return;
    this.kit = kit;
    this.shaft = shaft;
    this.fields = kit ? kit.particles : [];
    this.seed = kit ? kit.seed : 0;
    this.version = versionCounter++;
  }
}

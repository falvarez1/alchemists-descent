import { propagateLight } from '@/render/propagateLight';
import { propagateLightWasm } from '@/render/wasm/lightKernel';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { DARK_ADAPT, renderAmbient, VIGNETTE_BASE } from '@/render/lightingModel';
import { Cell, blocksEntity, isGas, isLiquid } from '@/sim/CellType';
import type { AuthoredLight, Ctx } from '@/core/types';
import { DARKNESS, LANTERN } from '@/config/darkness';
import { darkMapFor, fillOpenField, openAtCell, renderDarkness, renderOpenLut, sampleDarkMap } from '@/core/darkness';
import type { LightField, LightSample } from '@/render/pixels';
import { creatureLights } from '@/render/creatures/lights';
import { lureGlint } from '@/game/keyLure';
import { cachedSetPieceTells } from '@/render/setPieceTells';
import { BEAM_MIRROR, BEAM_PRISM, MAX_BEAM_DEPTH, MIRROR_REFLECTANCE, PRISM_SHARE, PRISM_SPLIT, mirrorNormal, reflect, rotate } from '@/sim/beam';

const RUNTIME_INSPECTION_LIGHT_INTENSITY = 1.2;
const RUNTIME_INSPECTION_LIGHT_RADIUS = 65;

// Most visible cells neither emit nor carry charge. Their attenuation is a
// fixed material property, so skip the emitter branch chain for those cells.
const MATERIAL_ATTENUATION = new Float32Array(256);
for (let type = 0; type < MATERIAL_ATTENUATION.length; type++) {
  MATERIAL_ATTENUATION[type] = type === Cell.Empty || isGas(type) ? 0.86
    : type === Cell.Crystal || type === Cell.Glass || type === Cell.Ice ? 0.84 : isLiquid(type) ? 0.8
      // FLORA: a canopy is dappled, not a rock slab — light filters through leaves.
      : type === Cell.Leaf ? 0.74 : 0.4;
}
const EMISSIVE_MATERIAL = new Uint8Array(256);
for (const type of [Cell.Fire, Cell.Lava, Cell.Ember, Cell.Acid, Cell.Gold, Cell.Fungus,
  Cell.Crystal, Cell.Catalyst, Cell.Glowshroom, Cell.Moss, Cell.Healium, Cell.Toxic, Cell.Teleportium,
  // FLORA: seeds glow faintly (glowseeds brightly); smouldering living wood glows;
  // on the Kiln, ember-bark fissures and fire-lily blooms keep a coal's glow.
  Cell.Seed, Cell.Trunk, Cell.Leaf]) EMISSIVE_MATERIAL[type] = 1;

/**
 * KILN FLORA (fix3): the Kiln's plants carry their glow in their own cells —
 * an ember-bark fissure is living wood the colour of a coal (floraKit's ember
 * [196,84,34]), a fire-lily bloom a red-orange petal round a gold heart — so
 * the grid explains every lit pixel. Read from the cell's colour: hot red,
 * green well under red (the char bark [44,36,32] and dry rust leaves
 * [150,84,52] stay dark).
 */
function emberHot(c: number, minRed: number): boolean {
  const r = (c >> 16) & 255, g = (c >> 8) & 255;
  return r >= minRed && g * 100 < r * 62;
}
/** A fissure anywhere in the 2x2 block a light texel stands for (they are one cell wide). */
function emberSeamNear(world: Ctx['world'], wx: number, wy: number): boolean {
  for (let k = 0; k < 4; k++) {
    const x = wx + (k & 1), y = wy + (k >> 1);
    if (!world.inBounds(x, y)) continue;
    const i = world.idx(x, y);
    if (world.types[i] === Cell.Trunk && world.life[i] <= 0 && emberHot(world.colors[i], 130)) return true;
  }
  return false;
}

// Wand "beam": a narrow directional cone cast along the aim, on top of (never
// instead of) the omni wand light. It reaches further so corridors read deeper
// when you point down them. Crucially it is *max-combined* into the same field
// (lights never add here) and seeded dimmer at the muzzle than the omni light,
// so the bright zone around the wizard is unchanged — the omni light already
// saturates the tonemap in the near radius, so the beam can only extend the lit
// area down the aim, never raise the peak exposure on the wizard.
const BEAM_RAYS = 110; // dense enough that adjacent rays stay <1 cell apart at the rim
const BEAM_HALF_SPREAD = 0.42; // radians (~24°) half-angle of the cone — focused
const BEAM_RADIUS_SCALE = 2.0; // linear rim at ~2× the omni wand radius
const BEAM_INTENSITY_SCALE = 0.74; // dimmer at the muzzle than the omni light, but
//   bright enough that the cone reads as joined to the wand glow rather than
//   starting in a gap ahead of it.
const BEAM_ORIGIN_DIST = 4; // cells along the aim from the shoulder — the cone apex
//   sits closer to the wizard than the omni muzzle (9 cells out) so the beam
//   appears to start right at the wand.
const BEAM_EDGE_MIN = 0.25; // angular falloff floor at the soft cone edge
// The beam's whole point is to throw light *further down open corridors* than
// the omni wand light, which loses ~7%/cell in air (att 0.86 → STEP_LIQ). So
// the beam loses far less per air-cell while solids still swallow it, keeping
// shadows crisp: it reaches down the hall but never bleeds through rock.
const BEAM_STEP_AIR = 0.976; // empty / translucent (att ≥ 0.83)
const BEAM_STEP_LIQ = 0.93; // liquids (att ≈ 0.8)
const BEAM_STEP_SOLID = 0.55; // rock still kills it (slightly harder than the omni)

// Third wand light: a NON-occluded ambient directional glow. The omni light and
// the beam above both raycast and are stopped by terrain (crisp shadows); this
// one paints a soft cone straight into the field, ignoring occlusion, so the
// surrounding/ahead terrain the shadow-casters leave dark gets a faint wash of
// light. Kept faint (so the beam's shadows still read) and flickered faster than
// the steady wand light for a little candle-like life.
const GLOW_RAYS = 110; // wide soft cone — keep adjacent rays <1 cell apart at the rim
const GLOW_HALF_SPREAD = 0.7; // radians (~40°) — wider/softer than the focused beam
const GLOW_RADIUS_SCALE = 0.7; // wraps the wizard's surroundings, doesn't tunnel far
const GLOW_INTENSITY_SCALE = 0.3; // faint ambient fill — must not wash out the shadows
const GLOW_EDGE_MIN = 0.15; // very soft cone edge
// Hard ceiling on the glow's deposited light-field value. sample() adds ambient
// and squares the result before terrain/bloom see it, so this raw cap must sit
// below the apparent bloom threshold after that post-lighting transform.
const GLOW_BLOOM_CAP = 0.48;
// Radius² (cells) within which Glowshroom caps flare toward the passing player.
const GLOW_REACT_R2 = 26 * 26;

/** Sandbox work lamp, carried by the cursor: warm, and wide enough to light a
 *  whole workstation at once. Radius is in HALF-cells, like every raycast here. */
const SANDBOX_LAMP_R = 2.05;
const SANDBOX_LAMP_G = 1.86;
const SANDBOX_LAMP_B = 1.5;
const SANDBOX_LAMP_RADIUS = 150;

const RAYCAST_RAYS = 540;
const RAY_DIR_X = new Float32Array(RAYCAST_RAYS);
const RAY_DIR_Y = new Float32Array(RAYCAST_RAYS);

interface AuthoredFalloffCell {
  dx: number;
  dy: number;
  f: number;
}

for (let k = 0; k < RAYCAST_RAYS; k++) {
  const a = (k / RAYCAST_RAYS) * Math.PI * 2;
  RAY_DIR_X[k] = Math.cos(a);
  RAY_DIR_Y[k] = Math.sin(a);
}

/* ===================== Dynamic Lighting =====================
 * Half-resolution RGB light field, seeded by every emitter in view, then
 * propagated with four directional sweeps. Solid cells attenuate hard, so
 * shadows form behind terrain and light only bleeds a few cells into rock.
 */
export class Lighting implements LightField {
  readonly LW: number;
  readonly LH: number;
  readonly lightR: Float32Array;
  readonly lightG: Float32Array;
  readonly lightB: Float32Array;
  readonly lightAtt: Float32Array;
  readonly vignette: Float32Array;
  /**
   * Designed darkness as a RENDER factor per light texel: 1 = the shipped
   * look, falling toward 0 inside a deep-dark zone. Every compose path
   * multiplies ambient and the readability floor by it (the GPU paths ship it
   * as the light texture's alpha); real light is untouched.
   */
  readonly lightOpen: Float32Array;
  /**
   * How much of the wand's OWN occluded light (omni + beam, normalized 0..1)
   * reached each texel on the last build: the gameplay "is the lantern on
   * it" read (render/LightQuery). Zero everywhere while hooded.
   */
  readonly wandField: Float32Array;
  /**
   * What each texel does to the wand's beam (wave 3, sim/beam): 0 nothing
   * special, BEAM_MIRROR reflects it, BEAM_PRISM splits it. Built with the
   * attenuation map; the beam march reads it so a mirror turns the light
   * (and the photocell it lands on reads the turned light).
   */
  readonly beamKind: Uint8Array;
  /** Camera origin of the last build: gameplay reads index the field with it. */
  originX = 0;
  originY = 0;
  /** True once the field has been built at least once. */
  built = false;

  private wandFlicker = 1;
  /** Smoothed render darkness under the player (the lantern's spill shrinks in it). */
  private playerDark = 0;
  /** The hood shutter, eased: 0 open ... 1 hooded. */
  private hoodK = 0;
  /** Normalized wand-coverage gain the running raycast writes into wandField (0 = none). */
  private wandWrite = 0;
  /** lightOpen currently holds all-ones (a fully readable level skips the per-texel pass). */
  private openIsFlat = true;
  /** What lightOpen was last filled from (the fill is skipped while none of it moved). */
  private openMap: Uint8Array | null = null;
  private openLut: Float32Array | null = null;
  private openX = NaN;
  private openY = NaN;
  /** True while lightOpen is all ones: compose paths may skip the smooth darkness read. */
  get openFlat(): boolean {
    return this.openIsFlat;
  }
  private wandFlickerTarget = 1;
  private readonly authoredFalloffCache = new Map<string, AuthoredFalloffCell[]>();

  /**
   * Stored by build(); sample() is only ever called after build() within a
   * frame, so it reads the live camera snapshot and ambient through this.
   */
  private ctx!: Ctx;

  /** Reused result object (approved deviation 5: replaces _ltR/_ltG/_ltB out-globals). */
  private readonly lit: LightSample = { r: 1, g: 1, b: 1 };

  constructor() {
    this.LW = (VIEW_W >> 1) + 1;
    this.LH = (VIEW_H >> 1) + 1;
    this.lightR = new Float32Array(this.LW * this.LH);
    this.lightG = new Float32Array(this.LW * this.LH);
    this.lightB = new Float32Array(this.LW * this.LH);
    this.lightAtt = new Float32Array(this.LW * this.LH);
    this.lightOpen = new Float32Array(this.LW * this.LH).fill(1);
    this.wandField = new Float32Array(this.LW * this.LH);
    this.beamKind = new Uint8Array(this.LW * this.LH);
    this.vignette = new Float32Array(VIEW_W * VIEW_H);
    // bakeVignette (full-res radial darkening, baked once)
    const cx = VIEW_W / 2,
      cy = VIEW_H / 2;
    const maxR2 = cx * cx + cy * cy;
    for (let y = 0; y < VIEW_H; y++) {
      for (let x = 0; x < VIEW_W; x++) {
        const r2 = ((x - cx) ** 2 + (y - cy) ** 2) / maxR2;
        this.vignette[y * VIEW_W + x] = 1 - VIGNETTE_BASE * r2;
      }
    }
  }

  // Sample the lit factor at a world position (for sprites & debris)
  sample(wx: number, wy: number): LightSample {
    const ctx = this.ctx;
    const AMBIENT = renderAmbient(ctx);
    const fx = Math.floor(wx) - ctx.camera.renderX,
      fy = Math.floor(wy) - ctx.camera.renderY;
    const lx = fx >> 1,
      ly = fy >> 1;
    let Lr = 0,
      Lg = 0,
      Lb = 0,
      vg = 1,
      open = 1;
    if (lx >= 0 && lx < this.LW && ly >= 0 && ly < this.LH) {
      const i = ly * this.LW + lx;
      Lr = this.lightR[i];
      Lg = this.lightG[i];
      Lb = this.lightB[i];
    }
    // Designed darkness reads SMOOTH (core/darkness openAtCell), exactly as the
    // compose paths draw it under the sprite — no texel staircase on a body
    // walking out of the dark.
    if (!this.openIsFlat) open = openAtCell(this.lightOpen, this.LW, this.LH, fx, fy);
    if (fx >= 0 && fx < VIEW_W && fy >= 0 && fy < VIEW_H) {
      // Rescale the baked VIGNETTE_BASE vignette by the live postFx.vignette
      // setting so sprites/debris track the slider exactly like the terrain
      // compose loop (FrameComposer) and the GPU shader's uVignette uniform —
      // same single source of truth that bakes the array above.
      const vigScale = ctx.state.postFx.vignette / VIGNETTE_BASE;
      vg = 1 - vigScale * (1 - this.vignette[fy * VIEW_W + fx]);
    }
    // Designed darkness (config/darkness) lowers ambient AND the 0.48 sprite
    // floor together, so in a deep-dark zone a body is only what light shows.
    // Eye adaptation (lightingModel DARK_ADAPT) keeps dim light visible there.
    const amb = AMBIENT * open, floor = 0.48 * vg * open, adapt = DARK_ADAPT * (1 - open);
    let f = (amb + Math.min(2.2, Lr)) * vg;
    this.lit.r = Math.max(floor, Math.min(1.8, f * f + adapt * f));
    f = (amb + Math.min(2.2, Lg)) * vg;
    this.lit.g = Math.max(floor, Math.min(1.8, f * f + adapt * f));
    f = (amb + Math.min(2.2, Lb)) * vg;
    this.lit.b = Math.max(floor, Math.min(1.8, f * f + adapt * f));
    this.lit.open = open;
    return this.lit;
  }

  /**
   * Authored lights (Builder): occluded lights seed a point cluster and let
   * the directional sweeps carve shadows; non-occluded lights paint their
   * whole falloff disk straight into the field.
   */
  private seedAuthoredSet(
    ctx: Ctx,
    lights: readonly AuthoredLight[],
    renderCamX: number,
    renderCamY: number,
  ): void {
    const { LW, LH } = this;
    for (const al of lights) {
      const flick =
        al.flicker > 0
          ? 1 -
            al.flicker *
              (0.3 +
                0.2 * Math.sin(ctx.state.frameCount * 0.11 + al.flickerPhase) +
                0.15 * Math.sin(ctx.state.frameCount * 0.043 + al.flickerPhase * 2.7))
          : 1;
      const I = al.intensity * flick;
      if (I <= 0) continue;
      if (al.occluded) {
        const core = I * (1 + al.bloom);
        this.seedLight(al.x, al.y, core * al.r, core * al.g, core * al.b);
        this.seedLight(al.x - 2, al.y, I * al.r, I * al.g, I * al.b);
        this.seedLight(al.x + 2, al.y, I * al.r, I * al.g, I * al.b);
        this.seedLight(al.x, al.y - 2, I * al.r, I * al.g, I * al.b);
        this.seedLight(al.x, al.y + 2, I * al.r, I * al.g, I * al.b);
        continue;
      }
      const R = Math.max(2, al.radius >> 1); // light-field pixels (half-res)
      const clx = (al.x - renderCamX) >> 1,
        cly = (al.y - renderCamY) >> 1;
      if (clx < -R || clx > LW + R || cly < -R || cly > LH + R) continue;
      for (const cell of this.authoredFalloffMask(R, al.falloff, al.bloom)) {
        const py = cly + cell.dy;
        if (py < 0 || py >= LH) continue;
        const px = clx + cell.dx;
        if (px < 0 || px >= LW) continue;
        const i = py * LW + px;
        const v = I * cell.f;
        if (v * al.r > this.lightR[i]) this.lightR[i] = v * al.r;
        if (v * al.g > this.lightG[i]) this.lightG[i] = v * al.g;
        if (v * al.b > this.lightB[i]) this.lightB[i] = v * al.b;
      }
    }
  }

  private authoredFalloffMask(radius: number, falloff: AuthoredLight['falloff'], bloom: number): AuthoredFalloffCell[] {
    const key = `${radius}|${falloff}|${bloom.toFixed(3)}`;
    const cached = this.authoredFalloffCache.get(key);
    if (cached) return cached;
    const cells: AuthoredFalloffCell[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const t = Math.sqrt(dx * dx + dy * dy) / radius;
        if (t > 1) continue;
        let f: number;
        if (falloff === 'linear') f = 1 - t;
        else if (falloff === 'sharp') f = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        else f = (1 - t * t) * 0.8;
        if (t < 0.15) f *= 1 + bloom;
        cells.push({ dx, dy, f });
      }
    }
    this.authoredFalloffCache.set(key, cells);
    return cells;
  }

  private readonly seedCreature = (x: number, y: number, r: number, g: number, b: number): void => this.seedLight(x, y, r, g, b);

  private seedLight(wx: number, wy: number, r: number, g: number, b: number): void {
    const lx = (Math.floor(wx) - this.ctx.camera.renderX) >> 1,
      ly = (Math.floor(wy) - this.ctx.camera.renderY) >> 1;
    if (lx < 0 || lx >= this.LW || ly < 0 || ly >= this.LH) return;
    const i = ly * this.LW + lx;
    if (r > this.lightR[i]) this.lightR[i] = r;
    if (g > this.lightG[i]) this.lightG[i] = g;
    if (b > this.lightB[i]) this.lightB[i] = b;
  }

  build(ctx: Ctx): void {
    this.ctx = ctx;
    const { LW, LH, lightR, lightG, lightB, lightAtt } = this;
    const beamKindMap = this.beamKind;
    lightR.fill(0);
    lightG.fill(0);
    lightB.fill(0);

    const world = ctx.world;
    const renderCamX = ctx.camera.renderX,
      renderCamY = ctx.camera.renderY;
    this.originX = renderCamX;
    this.originY = renderCamY;
    this.built = true;
    this.wandField.fill(0);
    // Designed darkness (core/darkness): a per-level baked map, read per texel
    // through the comfort setting's render curve. A readable level skips it.
    const darkMap = ctx.state.mode === 'play' ? darkMapFor(ctx.levels.current) : null;
    const openLut = renderOpenLut(ctx.state.highReadability === true);
    const lightOpen = this.lightOpen;
    if (!darkMap && !this.openIsFlat) {
      lightOpen.fill(1);
      this.openIsFlat = true;
    }
    if (darkMap) {
      this.openIsFlat = false;
      // Sampled at each texel's centre so every compose path can interpolate
      // between centres (openAtCell): the dark's edge is smooth, never stepped.
      // Static data: refilled only when the map, the comfort curve or the
      // camera origin moved.
      if (darkMap !== this.openMap || openLut !== this.openLut || renderCamX !== this.openX || renderCamY !== this.openY) {
        fillOpenField(darkMap, openLut, renderCamX, renderCamY, LW, LH, lightOpen);
        this.openMap = darkMap; this.openLut = openLut; this.openX = renderCamX; this.openY = renderCamY;
      }
    } else this.openMap = null;
    // Reactive bioluminescence: glow-caps flare as the alchemist passes through
    // them. Off-mode/dead → park the point far away so the flare never fires.
    const glowReact = ctx.state.mode === 'play' && !ctx.player.dead;
    const kilnFlora = ctx.state.mode === 'play' && ctx.levels?.current?.def.biome === 'volcanic';
    const px = glowReact ? ctx.player.x : -1e9;
    const py = glowReact ? ctx.player.y : -1e9;

    // Attenuation map + emissive material seeding
    for (let ly = 0; ly < LH; ly++) {
      const wy = renderCamY + (ly << 1);
      const row = ly * LW;
      for (let lx = 0; lx < LW; lx++) {
        const wx = renderCamX + (lx << 1);
        const wi = world.idx(wx, wy);
        const t = world.types[wi];
        const i = row + lx;
        // Translucent solids (ice, glass, crystal) pass most light through
        lightAtt[i] = MATERIAL_ATTENUATION[t] ?? 0.4;
        beamKindMap[i] = t === Cell.Mirror ? BEAM_MIRROR : t === Cell.Crystal ? BEAM_PRISM : 0;
        if (!EMISSIVE_MATERIAL[t] && !world.charge[wi]) continue;
        if (t === Cell.Fire) {
          const f = 0.9 + Math.random() * 0.5;
          if (f > lightR[i]) {
            lightR[i] = f;
            lightG[i] = f * 0.55;
            lightB[i] = f * 0.14;
          }
        } else if (t === Cell.Lava) {
          if (lightR[i] < 1.15) {
            lightR[i] = 1.15;
            lightG[i] = 0.28;
            lightB[i] = 0.05;
          }
        } else if (t === Cell.Ember) {
          const f = 0.55 + Math.random() * 0.25;
          if (f > lightR[i]) {
            lightR[i] = f;
            lightG[i] = f * 0.45;
            lightB[i] = f * 0.08;
          }
        } else if (t === Cell.Acid) {
          if (lightG[i] < 0.32) {
            lightR[i] = Math.max(lightR[i], 0.07);
            lightG[i] = 0.32;
            lightB[i] = Math.max(lightB[i], 0.1);
          }
        } else if (t === Cell.Gold) {
          // 0.34 -> 0.22 (look pass): a pocket warms its own lip, it no longer
          // lights the surrounding rock like a lamp.
          if (lightR[i] < 0.22) {
            lightR[i] = 0.22;
            lightG[i] = Math.max(lightG[i], 0.17);
            lightB[i] = Math.max(lightB[i], 0.04);
          }
        } else if (t === Cell.Fungus) {
          const f = 0.3 + Math.sin(ctx.state.frameCount * 0.04 + wx * 0.3 + wy * 0.2) * 0.08;
          if (lightG[i] < f) {
            lightR[i] = Math.max(lightR[i], f * 0.25);
            lightG[i] = f;
            lightB[i] = Math.max(lightB[i], f * 0.8);
          }
        } else if (t === Cell.Crystal) {
          const cf2 = 0.42 + Math.sin(ctx.state.frameCount * 0.05 + wx * 0.7) * 0.1;
          if (lightB[i] < cf2) {
            lightR[i] = Math.max(lightR[i], cf2 * 0.35);
            lightG[i] = Math.max(lightG[i], cf2 * 0.85);
            lightB[i] = cf2;
          }
        } else if (t === Cell.Catalyst) {
          const f = 0.26 + Math.sin(ctx.state.frameCount * 0.045 + wx * 0.31 + wy * 0.17) * 0.06;
          if (lightR[i] < f) {
            lightR[i] = f;
            lightG[i] = Math.max(lightG[i], f * 0.42);
            lightB[i] = Math.max(lightB[i], f * 0.12);
          }
        } else if (t === Cell.Glowshroom) {
          // Bioluminescent (finally living up to the name): a slow pulse ripples
          // across a colony (phase from cell position), and the caps FLARE as
          // the alchemist passes close — light that answers what moves through it.
          let f = 0.4 + Math.sin(ctx.state.frameCount * 0.05 + wx * 0.19 + wy * 0.23) * 0.12;
          const gdx = wx - px;
          const gdy = wy - py;
          const gd2 = gdx * gdx + gdy * gdy;
          if (gd2 < GLOW_REACT_R2) f += (1 - gd2 / GLOW_REACT_R2) * 0.55;
          if (lightG[i] < f) {
            lightR[i] = Math.max(lightR[i], f * 0.42);
            lightG[i] = f;
            lightB[i] = Math.max(lightB[i], f * 0.55);
          }
        } else if (t === Cell.Moss) {
          // the faintest living shimmer — only readable in true dark
          if (lightG[i] < 0.09) {
            lightG[i] = 0.09;
            lightB[i] = Math.max(lightB[i], 0.03);
          }
        } else if (t === Cell.Healium) {
          if (lightR[i] < 0.3) {
            lightR[i] = 0.3;
            lightG[i] = Math.max(lightG[i], 0.12);
            lightB[i] = Math.max(lightB[i], 0.2);
          }
        } else if (t === Cell.Toxic) {
          if (lightG[i] < 0.18) {
            lightR[i] = Math.max(lightR[i], 0.05);
            lightG[i] = 0.18;
            lightB[i] = Math.max(lightB[i], 0.03);
          }
        } else if (t === Cell.Trunk) {
          // Living wood only glows while it smoulders (life = burn countdown)…
          if (world.life[wi] > 0) {
            const f = 0.42 + Math.random() * 0.18;
            if (lightR[i] < f) {
              lightR[i] = f;
              lightG[i] = Math.max(lightG[i], f * 0.36);
              lightB[i] = Math.max(lightB[i], f * 0.06);
            }
          } else if (kilnFlora && emberSeamNear(world, wx, wy)) {
            // …and an ember-bark fissure breathes like banked coal: restrained
            // (0.34-0.44, under a loose Ember cell's 0.55), slow, out of step
            // down the trunk. (0.2 was tried: it did not read on the basalt.)
            const f = 0.44 * (0.78 + 0.22 * Math.sin(ctx.state.frameCount * 0.035 + wx * 0.21 + wy * 0.13));
            if (lightR[i] < f) {
              lightR[i] = f;
              lightG[i] = Math.max(lightG[i], f * 0.42);
              lightB[i] = Math.max(lightB[i], f * 0.08);
            }
          }
        } else if (t === Cell.Leaf) {
          if (kilnFlora) {
            const c = world.colors[wi];
            const r = (c >> 16) & 255, g = (c >> 8) & 255;
            // A fire-lily's gold heart, then its red-orange petals.
            const heart = r >= 200 && g >= 150 && (c & 255) <= 130;
            if (heart || emberHot(c, 190)) {
              // A bloom lights its own cup (0.46 heart / 0.36 petal): the
              // flower you can find in the dark, not a lamp that lights the cave.
              const f = (heart ? 0.46 : 0.36) * (0.88 + 0.12 * Math.sin(ctx.state.frameCount * 0.05 + wx * 0.3));
              if (lightR[i] < f) {
                lightR[i] = f;
                lightG[i] = Math.max(lightG[i], f * (heart ? 0.72 : 0.5));
                lightB[i] = Math.max(lightB[i], f * (heart ? 0.2 : 0.12));
              }
            }
          }
        } else if (t === Cell.Seed) {
          // A glowseed (life -2/-4) is a small lamp; a thirsty seed barely a warm speck;
          // a sprouting tip (life > 0) glows green as it climbs.
          const life = world.life[wi];
          const glowseed = life === -2 || life === -4;
          const f = glowseed ? 0.34 + Math.sin(ctx.state.frameCount * 0.06 + wx * 0.4) * 0.06 : life > 0 ? 0.3 : 0.1;
          if (lightG[i] < f) {
            lightR[i] = Math.max(lightR[i], f * (glowseed || life > 0 ? 0.7 : 0.9));
            lightG[i] = f;
            lightB[i] = Math.max(lightB[i], f * (glowseed ? 0.42 : 0.2));
          }
        } else if (t === Cell.Teleportium) {
          const f = 0.28 + Math.random() * 0.08;
          if (lightB[i] < f) {
            lightR[i] = Math.max(lightR[i], f * 0.6);
            lightG[i] = Math.max(lightG[i], f * 0.2);
            lightB[i] = f;
          }
        } else if (world.charge[wi] > 0) {
          // Charged metal lights only DIMLY (its bright halo was over-blooming);
          // the liquid pool keeps the bright cyan glow.
          const liquidCharge = world.types[wi] !== Cell.Metal;
          lightR[i] = Math.max(lightR[i], liquidCharge ? 0.25 : 0.08);
          lightG[i] = Math.max(lightG[i], liquidCharge ? 0.8 : 0.22);
          lightB[i] = Math.max(lightB[i], liquidCharge ? 1.0 : 0.3);
        }
      }
    }

    // A faint fill around the wizard keeps him readable even in self-shadow;
    // the wand itself is raycast after the sweeps so its shadows stay crisp
    // The lantern's state: the hood shutter eases (a visible, audible beat;
    // see game/Lantern) and the spill tracks how dark it is under the player.
    const hoodTarget = ctx.state.lanternHooded === true ? 1 : 0;
    this.hoodK += (hoodTarget - this.hoodK) * LANTERN.hoodEase;
    if (Math.abs(hoodTarget - this.hoodK) < 0.004) this.hoodK = hoodTarget;
    const darkHere = darkMap
      ? renderDarkness(sampleDarkMap(darkMap, ctx.player.x, ctx.player.y - 9), ctx.state.highReadability === true)
      : 0;
    this.playerDark += (darkHere - this.playerDark) * DARKNESS.playerEase;
    if (ctx.state.mode === 'play' && !ctx.player.dead) {
      const wand = ctx.state.wandLight;
      this.wandFlicker += (this.wandFlickerTarget - this.wandFlicker) * 0.25;
      if (ctx.state.frameCount % 5 === 0) {
        const spread = Math.max(0, wand.flicker);
        this.wandFlickerTarget = spread > 0 ? 1.04 - spread + Math.random() * spread * 2 : 1;
      }
      const fill = 1 + (LANTERN.hoodFill - 1) * this.hoodK;
      this.seedLight(ctx.player.x, ctx.player.y - 9, wand.fillR * fill, wand.fillG * fill, wand.fillB * fill);
      // Active flask siphon (hold E): pulse a cool light over the drained patch
      // at the cursor so the pull reads even against the bright wand light.
      // Max-combined like every wand light (seedLight takes the max — never
      // additive), and faded to nothing as the cursor nears the wizard: the wand
      // already lights that zone, so the siphon light would only pile brightness
      // right next to the player. It only contributes when draining at range.
      if (ctx.input.siphonHeld) {
        const m = ctx.input.mouse;
        const sdx = m.x - ctx.player.x,
          sdy = m.y - (ctx.player.y - 9);
        const reach = Math.hypot(sdx, sdy);
        if (reach < 72) {
          const near = Math.min(1, Math.max(0, (reach - 12) / 28)); // 0 close, full by ~40
          const pulse = (0.6 + Math.sin(ctx.state.frameCount * 0.4) * 0.25) * near;
          if (pulse > 0) this.seedLight(m.x, m.y, 0.4 * pulse, 0.75 * pulse, 1.05 * pulse);
        }
      }
    }

    // Projectiles glow in their own colors and rake light across the walls
    // they streak past. A fast bolt crosses many cells between (even-frame)
    // light rebuilds, so beyond the head we seed a short fading wake back along
    // the velocity — otherwise the glow lands in disconnected dots and the
    // terrain barely registers it. Intensities are lifted from the original
    // port values so the cast reads against the now-brighter wand light.
    for (const p of ctx.projectiles) {
      let lr = 0,
        lg = 0,
        lb = 0,
        wake = 0;
      if (p.type === 'bolt') {
        // The Spark Bolt rakes brighter light and a longer wake than a pellet.
        lr = 1.1;
        lg = 2.5;
        lb = 3.0;
        wake = 4;
      } else if (p.type === 'pellet') {
        lr = 0.85;
        lg = 2.0;
        lb = 2.45;
        wake = 3;
      } else if (p.type === 'fireball') {
        lr = 1.8;
        lg = 0.85;
        lb = 0.2;
        wake = 2;
      } else if (p.type === 'bomb') {
        lr = 0.55;
        lg = 0.4;
        lb = 0.16;
      } else if (p.type === 'warp') {
        lr = 1.5;
        lg = 0.82;
        lb = 2.0;
        wake = 2;
      } else if (p.type === 'blackhole') {
        lr = 1.2;
        lg = 0.6;
        lb = 1.85;
      } else if (p.type === 'iceshard' || p.type === 'icelance') {
        lr = 0.72;
        lg = 1.2;
        lb = 1.7;
        wake = 3;
      } else if (p.type === 'wisp') {
        lr = 0.55;
        lg = 1.4;
        lb = 1.8;
      } else if (p.type === 'meteor') {
        lr = 1.9;
        lg = 0.78;
        lb = 0.14;
        wake = 3;
      } else if (p.type === 'acidglob') {
        lr = 0.22;
        lg = 0.8;
        lb = 0.16;
        wake = 2;
      } else {
        continue;
      }
      this.seedLight(p.x, p.y, lr, lg, lb);
      for (let s = 1; s <= wake; s++) {
        const f = 1 - 0.6 * (s / (wake + 1)); // comet-tail fade behind the head
        this.seedLight(p.x - p.vx * s, p.y - p.vy * s, lr * f, lg * f, lb * f);
      }
    }
    // Chain lightning floods its path with cold light
    for (const arc of ctx.lightning.arcs) {
      for (let k = 0; k < arc.pts.length; k += 4) {
        const pt = arc.pts[k];
        this.seedLight(pt.x, pt.y, 1.2 * arc.intensity, 1.4 * arc.intensity, 1.7 * arc.intensity);
      }
    }
    // Explosions flash-illuminate, fading as the wave expands
    for (const w of ctx.shockwaves) {
      const decay = 1 - w.currentRadius / w.maxRadius;
      if (w.strength < 0) {
        // Singularity blast wave: the expanding ring drenches the cave in
        // blown-out violet light — seeded along the ring itself
        const n = Math.max(12, Math.floor(w.currentRadius * 0.6));
        for (let k = 0; k < n; k++) {
          const ra = (k / n) * Math.PI * 2;
          this.seedLight(
            w.cx + Math.cos(ra) * w.currentRadius,
            w.cy + Math.sin(ra) * w.currentRadius,
            3.6 * decay + 0.9,
            1.5 * decay + 0.35,
            4.8 * decay + 1.2,
          );
        }
        this.seedLight(w.cx, w.cy, 5.0 * decay, 2.4 * decay, 6.0 * decay);
      } else {
        this.seedLight(w.cx, w.cy, 2.8 * decay, 2.1 * decay, 1.2 * decay);
      }
    }
    // Excavation beam scorches with light
    const digBeam = ctx.fx.digBeam;
    if (digBeam && digBeam.life > 0) this.seedLight(digBeam.x1, digBeam.y1, 1.6, 1.1, 0.4);

    // Fireflies carry their own tiny lamps
    if (ctx.state.mode === 'play') {
      for (const c of ctx.critters.list) {
        if (c.kind !== 'firefly') continue;
        const pulse = Math.max(0, Math.sin(c.phase * 0.45));
        if (pulse > 0.25) this.seedLight(c.x, c.y, 0.12 * pulse, 0.32 * pulse, 0.07 * pulse);
      }
    }

    // Pickups shimmer; the portal throbs violet (bright once the key is held)
    const runtime = ctx.levels.current;
    if (runtime && ctx.state.mode === 'play') {
      for (const p of runtime.pickups) {
        if (p.taken) continue;
        if (p.kind === 'key') {
          // The key's glint (game/keyLure) lights the cave around it on the same clock.
          const glint = 1 + 1.6 * lureGlint(ctx.state.frameCount, p.x, p.y);
          this.seedLight(p.x, p.y - 2, 0.7 * glint, 0.6 * glint, 0.2 * glint);
        }
        else if (p.kind === 'heart') this.seedLight(p.x, p.y - 2, 0.5, 0.16, 0.22);
        else if (p.kind === 'tome') this.seedLight(p.x, p.y - 2, 0.25, 0.4, 0.6);
        else if (p.kind === 'potion') this.seedLight(p.x, p.y - 2, 0.4, 0.2, 0.5);
      }
      if (runtime.portal) {
        const throb = 0.6 + Math.sin(ctx.state.frameCount * 0.07) * 0.25;
        const lit = runtime.keyTaken ? 1.5 : 0.6;
        this.seedLight(runtime.portal.x, runtime.portal.y - 4, 0.55 * throb * lit, 0.2 * throb * lit, 0.9 * throb * lit);
        // A woken gate is a lamp, not a point (levels review #3): a true shadow-casting
        // light that throws the cave's walls in violet, flaring as the key is taken.
        if (runtime.keyTaken) {
          const since = runtime.keyTakenFrame === undefined ? 999 : ctx.state.frameCount - runtime.keyTakenFrame;
          const k = 1.4 * throb * (since < 50 ? 1 + 1.6 * (1 - since / 50) : 1);
          this.raycastLight(runtime.portal.x, runtime.portal.y - 6, 0.6 * k, 0.22 * k, 1.0 * k, 34);
        }
      }
      // Rune glyphs glow violet until struck, then triumphant green
      for (const v of runtime.runeVaults) {
        if (v.active) this.seedLight(v.rx, v.ry, 0.15, 0.6, 0.28);
        else this.seedLight(v.rx, v.ry, 0.45, 0.16, 0.6);
      }
      // Lit braziers cast warmth past their own flames (fire cells help too)
      for (const m of runtime.mechanisms) {
        if (m.kind === 'brazier' && m.state === 1) this.seedLight(m.x, m.y - 2, 0.8, 0.5, 0.12);
        else if (m.kind === 'sensor' && m.sensorType === 'light') {
          // A photocell warms as it charges and burns steady gold once latched
          // (restrained: well under its own blaze threshold, config/darkness).
          const c = m.state > 0 ? 1 : Math.min(1, (m.reading ?? 0) / (m.threshold ?? 90));
          if (c > 0.02) this.seedLight(m.x, m.y, 0.34 * c, 0.24 * c, 0.08 * c);
        }
      }
      // Lumen blooms breathe their own faint light, brighter as they open, and
      // their glass bridge glows along its length so it can be crossed in the dark.
      if (runtime.lumenBlooms) {
        const fc = ctx.state.frameCount;
        for (const b of runtime.lumenBlooms) {
          const k = 0.1 + b.open * 0.26 + Math.sin(fc * 0.045 + b.id * 1.7) * 0.03;
          this.seedLight(b.x, b.y - 1, k * 0.45, k, k * 0.7);
          for (let i = 6; i < b.shown; i += 10) {
            const [px, py] = b.petals[i];
            this.seedLight(px, py - 1, 0.05 * b.open, 0.13 * b.open, 0.09 * b.open);
          }
        }
      }
      // Designer-placed lights (Builder Phase 7).
      if (runtime.authoredLights) {
        this.seedAuthoredSet(ctx, runtime.authoredLights, renderCamX, renderCamY);
      }
      // One far tell per set piece (render/setPieceTells): a small lamp in the colour of its own fixture.
      if (runtime.placedPrefabs) {
        this.seedAuthoredSet(ctx, cachedSetPieceTells(runtime.placedPrefabs, ctx.world, blocksEntity), renderCamX, renderCamY);
      }
    }
    // Builder light PREVIEW: while the editor is open it feeds its authored
    // lights here so mood reads live without a playtest round-trip.
    if (ctx.state.editorLights && ctx.state.mode === 'build') {
      this.seedAuthoredSet(ctx, ctx.state.editorLights, renderCamX, renderCamY);
    }
    // Living light, read from the creatures' own bodies (render/creatures/lights):
    // lures where they dangle, sacs as they swell, cores as they heat; corpses gutter.
    creatureLights(ctx, this.seedCreature);

    // WASM SIMD kernel (bit-identical, ~2.5x); the TS loop when it is unavailable.
    if (!propagateLightWasm(LW, LH, lightR, lightG, lightB, lightAtt)) propagateLight(LW, LH, lightR, lightG, lightB, lightAtt);

    // SANDBOX WORK LAMP. Play is lit because the wizard carries a wand; the
    // sandbox has no wizard, so nothing lit it at all — a mostly-empty workshop
    // rendered as a black rectangle at the default ambient, and raising that
    // dial was not an option because Play shares it and wants its gloom.
    //
    // This is the missing counterpart: a lamp you carry over the bench. It must
    // RAYCAST rather than seed a point — the sweeps lose ~14% per half-cell, so
    // a seeded point fades out within about twenty cells and lights nothing.
    // Same path as the wand, so it throws real shadows off the shelves and
    // cups, and it is max-combined like every light here, never additive.
    if (ctx.state.mode === 'build') {
      const m = ctx.input.mouse;
      this.raycastLight(m.x, m.y, SANDBOX_LAMP_R, SANDBOX_LAMP_G, SANDBOX_LAMP_B, SANDBOX_LAMP_RADIUS);
    }

    // Runtime inspector selected-entity light: same raycast path as the wand,
    // but steady, wider, and intentionally dimmer.
    if (ctx.state.mode === 'play' && ctx.state.runtimeInspectionLight) {
      const target = ctx.state.runtimeInspectionLight;
      this.raycastRuntimeInspectionLight(target.x, target.y);
    }

    // The wand: a true shadow-casting light. Rays march outward from the tip;
    // rock absorbs them hard, so edges throw real shadows and nothing wraps corners.
    // In the dark the omni SPILL shrinks toward your footing and the aimed beam
    // carries further; hooded, the lantern is an ember and the beam is out.
    const hoodK = this.hoodK, darkK = this.playerDark;
    const spillRadius = (1 + (LANTERN.darkOmniRadius - 1) * darkK) * (1 + (LANTERN.hoodRadius - 1) * hoodK);
    const spillIntensity = 1 + (LANTERN.hoodIntensity - 1) * hoodK;
    this.wandWrite = ctx.state.lanternHooded === true ? 0 : 1;
    if (ctx.state.mode === 'play' && !ctx.player.dead && ctx.player.legClub) {
      // The stowed wand lights the belt; no detached muzzle or aiming beam.
      this.raycastWandLight(ctx.player.x, ctx.player.y - 8, ctx.state.wandLight.intensity * .85 * spillIntensity,
        ctx.state.wandLight.radius * spillRadius);
    } else if (ctx.state.mode === 'play' && !ctx.player.dead) {
      // Wand muzzle: 9 cells along aimAngle from (player.x, player.y - 9) —
      // computed locally (same formula as ctx.spells.wandTip) so the render
      // layer never depends on the spells system.
      const tipX = ctx.player.x + Math.cos(ctx.player.aimAngle) * 9;
      const tipY = ctx.player.y - 9 + Math.sin(ctx.player.aimAngle) * 9;
      // Torchbearer (tonic or boon): brighter, steadier, longer wand light
      const wand = ctx.state.wandLight;
      const torch = ctx.player.status.torch > 0 || ctx.player.perks.torchbearer === true;
      const flick = torch ? Math.max(this.wandFlicker, wand.torchMinFlicker) : this.wandFlicker;
      const rawBase = torch ? wand.torchIntensity : wand.intensity;
      const baseIntensity = rawBase * flick;
      const baseRadius = torch ? wand.torchRadius : wand.radius;
      this.raycastWandLight(tipX, tipY, baseIntensity * spillIntensity, baseRadius * spillRadius);
      // Directional beam down the aim — extends corridor sightlines without
      // brightening the wizard (same flicker, max-combined, dimmer at the muzzle).
      // Fired from a point closer to the wizard than the muzzle so the cone
      // reads as starting at the wand, not floating ahead of it.
      const beamX = ctx.player.x + Math.cos(ctx.player.aimAngle) * BEAM_ORIGIN_DIST;
      const beamY = ctx.player.y - 9 + Math.sin(ctx.player.aimAngle) * BEAM_ORIGIN_DIST;
      if (hoodK < 0.999) {
        const beamK = (1 - hoodK) * (1 + (LANTERN.darkBeamIntensity - 1) * darkK);
        this.raycastWandBeam(beamX, beamY, ctx.player.aimAngle, baseIntensity * beamK, baseRadius, darkK);
      }
      // Third light: non-occluded ambient glow over the same cone, on its OWN
      // faster flicker (candle-like life) instead of the steady wand flicker.
      const fc = ctx.state.frameCount;
      const glowFlick =
        1 +
        Math.sin(fc * 0.31) * 0.1 +
        Math.sin(fc * 0.57 + 2.1) * 0.07 +
        (Math.random() - 0.5) * 0.05;
      if (hoodK < 0.999) {
        this.raycastWandGlow(beamX, beamY, ctx.player.aimAngle, rawBase * glowFlick * (1 - hoodK),
          baseRadius * (1 + (LANTERN.darkGlowRadius - 1) * darkK));
      }
    } else if (ctx.state.mode === 'build' && ctx.state.builderWandLightPreview.enabled) {
      const preview = ctx.state.builderWandLightPreview;
      const wand = ctx.state.wandLight;
      this.raycastWandLight(preview.x, preview.y, wand.intensity, wand.radius);
    }
    this.wandWrite = 0;

    // Death glow: the wand goes dark with the wizard, so the corpse carries its
    // own fading warm soul-light — the ragdoll stays readable as it tumbles.
    if (ctx.state.mode === 'play' && ctx.player.dead) {
      const corpse = ctx.rigidBodies.playerCorpse;
      if (corpse) {
        const flick =
          0.82 + Math.sin(ctx.state.frameCount * 0.18) * 0.12 + (Math.random() - 0.5) * 0.06;
        this.seedLight(corpse.x, corpse.y, .5 * flick, .48 * flick, .38 * flick);
        this.seedLight(corpse.x, corpse.y - 6, .3 * flick, .28 * flick, .22 * flick);
      }
    }
  }

  private raycastWandLight(wx: number, wy: number, intensity: number, radius: number): void {
    const wand = this.ctx.state.wandLight;
    const s = Math.max(0, intensity);
    this.raycastLight(
      wx,
      wy,
      s * wand.r,
      s * wand.g,
      s * wand.b,
      Math.max(1, Math.round(Math.max(1, radius) * 0.5)),
      this.wandWrite,
    );
  }

  /**
   * Narrow shadow-casting cone fired along `aim` from the wand tip. Same march
   * and occlusion as the omni light, but: only BEAM_RAYS rays inside a cone, a
   * longer reach (BEAM_RADIUS_SCALE), a lower source intensity
   * (BEAM_INTENSITY_SCALE), a soft angular edge, and — the key difference — a
   * gentler per-cell air attenuation (BEAM_STEP_AIR) so it carries down open
   * corridors. Because the field combines by max (never sum) and the omni light
   * already saturates the near radius, this only extends the lit area down the
   * aim; it never raises the exposure on the wizard.
   */
  private raycastWandBeam(
    wx: number,
    wy: number,
    aim: number,
    intensity: number,
    radius: number,
    darkK = 0,
  ): void {
    const wand = this.ctx.state.wandLight;
    const s = Math.max(0, intensity) * BEAM_INTENSITY_SCALE;
    if (s <= 0) return;
    const sr = s * wand.r,
      sg = s * wand.g,
      sb = s * wand.b;
    const { LW, LH, lightR, lightG, lightB, lightAtt, wandField } = this;
    const wandGain = this.wandWrite;
    // In designed darkness the beam loses less per cell of air: the one thing
    // the wizard can see by is the thing he points.
    const stepAir = BEAM_STEP_AIR + (LANTERN.darkBeamStepAir - BEAM_STEP_AIR) * darkK;
    const radiusHalf = Math.max(1, Math.round(Math.max(1, radius) * BEAM_RADIUS_SCALE * 0.5));
    const ox = (wx - this.ctx.camera.renderX) / 2,
      oy = (wy - this.ctx.camera.renderY) / 2;
    if (ox < -radiusHalf || ox > LW + radiusHalf || oy < -radiusHalf || oy > LH + radiusHalf)
      return;
    const beamKindMap = this.beamKind;
    const camX = this.ctx.camera.renderX, camY = this.ctx.camera.renderY;
    const world = this.ctx.world;
    for (let k = 0; k < BEAM_RAYS; k++) {
      // -1..1 across the fan; angular falloff tapers the cone edges so it reads
      // as a soft beam rather than a hard pie slice.
      const u = BEAM_RAYS > 1 ? (k / (BEAM_RAYS - 1)) * 2 - 1 : 0;
      const a = aim + u * BEAM_HALF_SPREAD;
      const edge = BEAM_EDGE_MIN + (1 - BEAM_EDGE_MIN) * (1 - u * u);
      let dx = Math.cos(a),
        dy = Math.sin(a);
      let T = 1;
      // LIGHT THAT TURNS CORNERS (sim/beam): each ray marches from its
      // current leg's origin; a mirror texel reflects it (the face read from
      // the mirror cells there), a prism texel bends alternate rays either way
      // into a warm and a cool daughter beam. Falloff keeps counting the whole
      // path, so a banked beam is dimmer than a straight one.
      let rx = ox, ry = oy, leg = 0, bends = 0, inPrism = false;
      let cr = sr, cg = sg, cb = sb;
      for (let d = 0; d < radiusHalf; d++, leg++) {
        const lx = Math.round(rx + dx * leg),
          ly = Math.round(ry + dy * leg);
        if (lx < 0 || lx >= LW || ly < 0 || ly >= LH) break;
        const i = ly * LW + lx;
        const kind = beamKindMap[i];
        if (kind === BEAM_MIRROR && bends < MAX_BEAM_DEPTH && leg > 0) {
          // Reflect off the face at the last open point, then carry on.
          const [nx, ny] = mirrorNormal(world, camX + (lx << 1), camY + (ly << 1), dx, dy);
          const back = leg - 1;
          rx += dx * back; ry += dy * back;
          [dx, dy] = reflect(dx, dy, nx, ny);
          leg = 0;
          bends++;
          T *= MIRROR_REFLECTANCE;
          continue;
        }
        if (kind === BEAM_PRISM) {
          if (!inPrism && bends < MAX_BEAM_DEPTH) {
            // Split: even rays bend one way warm, odd rays the other way cool.
            const warm = (k & 1) === 0;
            rx += dx * leg; ry += dy * leg;
            [dx, dy] = rotate(dx, dy, warm ? PRISM_SPLIT : -PRISM_SPLIT);
            leg = 0;
            bends++;
            T *= PRISM_SHARE * 1.35;
            if (warm) { cr = sr * 1.25; cg = sg * 0.82; cb = sb * 0.45; } else { cr = sr * 0.55; cg = sg * 0.78; cb = sb * 1.35; }
          }
          inPrism = true;
        } else inPrism = false;
        const fall = T * (1 - d / radiusHalf) * edge;
        const vr = cr * fall,
          vgc = cg * fall,
          vb = cb * fall;
        if (vr > lightR[i]) lightR[i] = vr;
        if (vgc > lightG[i]) lightG[i] = vgc;
        if (vb > lightB[i]) lightB[i] = vb;
        if (wandGain > 0 && fall * wandGain > wandField[i]) wandField[i] = fall * wandGain;
        const att = lightAtt[i];
        T *= kind === BEAM_MIRROR ? BEAM_STEP_SOLID : att < 0.5 ? BEAM_STEP_SOLID : att < 0.83 ? BEAM_STEP_LIQ : stepAir;
        if (T < 0.02) break;
      }
    }
  }

  /**
   * Non-occluded ambient cone — the third wand light. Same cone geometry as the
   * beam, but each ray deposits a pure radial × angular falloff and NEVER reads
   * `lightAtt`, so terrain does not stop or shadow it: it washes the surrounding
   * cells (walls included) with a faint, fast-flickering glow. Max-combined like
   * the others, and kept dim so the beam's crisp shadows still read on top.
   */
  private raycastWandGlow(
    wx: number,
    wy: number,
    aim: number,
    intensity: number,
    radius: number,
  ): void {
    const wand = this.ctx.state.wandLight;
    const s = Math.max(0, intensity) * GLOW_INTENSITY_SCALE;
    if (s <= 0) return;
    const { LW, LH, lightR, lightG, lightB } = this;
    const radiusHalf = Math.max(1, Math.round(Math.max(1, radius) * GLOW_RADIUS_SCALE * 0.5));
    const ox = (wx - this.ctx.camera.renderX) / 2,
      oy = (wy - this.ctx.camera.renderY) / 2;
    if (ox < -radiusHalf || ox > LW + radiusHalf || oy < -radiusHalf || oy > LH + radiusHalf)
      return;
    for (let k = 0; k < GLOW_RAYS; k++) {
      const u = GLOW_RAYS > 1 ? (k / (GLOW_RAYS - 1)) * 2 - 1 : 0;
      const a = aim + u * GLOW_HALF_SPREAD;
      const edge = GLOW_EDGE_MIN + (1 - GLOW_EDGE_MIN) * (1 - u * u);
      const dx = Math.cos(a),
        dy = Math.sin(a);
      for (let d = 0; d < radiusHalf; d++) {
        const lx = Math.round(ox + dx * d),
          ly = Math.round(oy + dy * d);
        if (lx < 0 || lx >= LW || ly < 0 || ly >= LH) break;
        const i = ly * LW + lx;
        const fall = (1 - d / radiusHalf) * edge; // no occlusion term — paints through terrain
        // Cap below the bloom threshold so this fill illuminates but never blooms.
        const mag = Math.min(GLOW_BLOOM_CAP, s * fall);
        const vr = mag * wand.r,
          vgc = mag * wand.g,
          vb = mag * wand.b;
        if (vr > lightR[i]) lightR[i] = vr;
        if (vgc > lightG[i]) lightG[i] = vgc;
        if (vb > lightB[i]) lightB[i] = vb;
      }
    }
  }

  private raycastRuntimeInspectionLight(wx: number, wy: number): void {
    const wand = this.ctx.state.wandLight;
    this.raycastLight(
      wx,
      wy,
      RUNTIME_INSPECTION_LIGHT_INTENSITY * wand.r,
      RUNTIME_INSPECTION_LIGHT_INTENSITY * wand.g,
      RUNTIME_INSPECTION_LIGHT_INTENSITY * wand.b,
      Math.max(1, Math.round(RUNTIME_INSPECTION_LIGHT_RADIUS * 0.5)),
    );
  }

  private raycastLight(
    wx: number,
    wy: number,
    sr: number,
    sg: number,
    sb: number,
    radiusHalf: number,
    wandGain = 0,
  ): void {
    const { LW, LH, lightR, lightG, lightB, lightAtt, wandField } = this;
    const ox = (wx - this.ctx.camera.renderX) / 2,
      oy = (wy - this.ctx.camera.renderY) / 2;
    if (ox < -radiusHalf || ox > LW + radiusHalf || oy < -radiusHalf || oy > LH + radiusHalf)
      return;
    const STEP_AIR = 0.988,
      STEP_SOLID = 0.6,
      STEP_LIQ = 0.93;
    for (let k = 0; k < RAYCAST_RAYS; k++) {
      const dx = RAY_DIR_X[k],
        dy = RAY_DIR_Y[k];
      let T = 1;
      for (let d = 0; d < radiusHalf; d++) {
        const lx = Math.round(ox + dx * d),
          ly = Math.round(oy + dy * d);
        if (lx < 0 || lx >= LW || ly < 0 || ly >= LH) break;
        const i = ly * LW + lx;
        const fall = T * (1 - d / radiusHalf);
        const vr = sr * fall,
          vgc = sg * fall,
          vb = sb * fall;
        if (vr > lightR[i]) lightR[i] = vr;
        if (vgc > lightG[i]) lightG[i] = vgc;
        if (vb > lightB[i]) lightB[i] = vb;
        if (wandGain > 0 && fall * wandGain > wandField[i]) wandField[i] = fall * wandGain;
        const att = lightAtt[i];
        T *= att < 0.5 ? STEP_SOLID : att < 0.88 ? STEP_LIQ : STEP_AIR;
        if (T < 0.02) break;
      }
    }
  }
}

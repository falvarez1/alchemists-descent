import { VIEW_H, VIEW_W } from '@/config/constants';
import { Cell, isGas, isLiquid } from '@/sim/CellType';
import type { AuthoredLight, Ctx } from '@/core/types';
import type { LightField, LightSample } from '@/render/pixels';

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

  private wandFlicker = 1;
  private wandFlickerTarget = 1;

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
    this.vignette = new Float32Array(VIEW_W * VIEW_H);
    // bakeVignette (full-res radial darkening, baked once)
    const cx = VIEW_W / 2,
      cy = VIEW_H / 2;
    const maxR2 = cx * cx + cy * cy;
    for (let y = 0; y < VIEW_H; y++) {
      for (let x = 0; x < VIEW_W; x++) {
        const r2 = ((x - cx) ** 2 + (y - cy) ** 2) / maxR2;
        this.vignette[y * VIEW_W + x] = 1 - 0.52 * r2;
      }
    }
  }

  // Sample the lit factor at a world position (for sprites & debris)
  sample(wx: number, wy: number): LightSample {
    const ctx = this.ctx;
    const AMBIENT = ctx.params.global.ambient;
    const fx = Math.floor(wx) - ctx.camera.renderX,
      fy = Math.floor(wy) - ctx.camera.renderY;
    const lx = fx >> 1,
      ly = fy >> 1;
    let Lr = 0,
      Lg = 0,
      Lb = 0,
      vg = 1;
    if (lx >= 0 && lx < this.LW && ly >= 0 && ly < this.LH) {
      const i = ly * this.LW + lx;
      Lr = this.lightR[i];
      Lg = this.lightG[i];
      Lb = this.lightB[i];
    }
    if (fx >= 0 && fx < VIEW_W && fy >= 0 && fy < VIEW_H) vg = this.vignette[fy * VIEW_W + fx];
    let f = (AMBIENT + Math.min(2.2, Lr)) * vg;
    this.lit.r = Math.min(1.8, f * f);
    f = (AMBIENT + Math.min(2.2, Lg)) * vg;
    this.lit.g = Math.min(1.8, f * f);
    f = (AMBIENT + Math.min(2.2, Lb)) * vg;
    this.lit.b = Math.min(1.8, f * f);
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
      for (let dy = -R; dy <= R; dy++) {
        const py = cly + dy;
        if (py < 0 || py >= LH) continue;
        for (let dx = -R; dx <= R; dx++) {
          const px = clx + dx;
          if (px < 0 || px >= LW) continue;
          const t = Math.sqrt(dx * dx + dy * dy) / R;
          if (t > 1) continue;
          let f: number;
          if (al.falloff === 'linear') f = 1 - t;
          else if (al.falloff === 'sharp') f = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          else f = (1 - t * t) * 0.8; // soft: gentle dome
          if (t < 0.15) f *= 1 + al.bloom; // hot core feeds the bloom pass
          const i = py * LW + px;
          const v = I * f;
          if (v * al.r > this.lightR[i]) this.lightR[i] = v * al.r;
          if (v * al.g > this.lightG[i]) this.lightG[i] = v * al.g;
          if (v * al.b > this.lightB[i]) this.lightB[i] = v * al.b;
        }
      }
    }
  }

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
    lightR.fill(0);
    lightG.fill(0);
    lightB.fill(0);

    const world = ctx.world;
    const renderCamX = ctx.camera.renderX,
      renderCamY = ctx.camera.renderY;

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
        lightAtt[i] =
          t === Cell.Empty || isGas(t)
            ? 0.86
            : t === Cell.Crystal || t === Cell.Glass || t === Cell.Ice
              ? 0.84
              : isLiquid(t)
                ? 0.8
                : 0.4;
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
          if (lightR[i] < 0.34) {
            lightR[i] = 0.34;
            lightG[i] = Math.max(lightG[i], 0.27);
            lightB[i] = Math.max(lightB[i], 0.06);
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
        } else if (t === Cell.Glowshroom) {
          if (lightG[i] < 0.4) {
            lightR[i] = Math.max(lightR[i], 0.16);
            lightG[i] = 0.4;
            lightB[i] = Math.max(lightB[i], 0.2);
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
        } else if (t === Cell.Teleportium) {
          const f = 0.28 + Math.random() * 0.08;
          if (lightB[i] < f) {
            lightR[i] = Math.max(lightR[i], f * 0.6);
            lightG[i] = Math.max(lightG[i], f * 0.2);
            lightB[i] = f;
          }
        } else if (world.charge[wi] > 0) {
          lightR[i] = Math.max(lightR[i], 0.25);
          lightG[i] = Math.max(lightG[i], 0.8);
          lightB[i] = Math.max(lightB[i], 1.0);
        }
      }
    }

    // A faint fill around the wizard keeps him readable even in self-shadow;
    // the wand itself is raycast after the sweeps so its shadows stay crisp
    if (ctx.state.mode === 'play' && !ctx.player.dead) {
      this.wandFlicker += (this.wandFlickerTarget - this.wandFlicker) * 0.25;
      if (ctx.state.frameCount % 5 === 0) this.wandFlickerTarget = 0.8 + Math.random() * 0.48;
      this.seedLight(ctx.player.x, ctx.player.y - 9, 0.5, 0.45, 0.36);
    }

    // Projectiles glow in their own colors
    for (const p of ctx.projectiles) {
      if (p.type === 'bolt' || p.type === 'pellet') this.seedLight(p.x, p.y, 0.5, 1.3, 1.6);
      else if (p.type === 'fireball') this.seedLight(p.x, p.y, 1.5, 0.7, 0.15);
      else if (p.type === 'bomb') this.seedLight(p.x, p.y, 0.45, 0.32, 0.12);
      else if (p.type === 'warp') this.seedLight(p.x, p.y, 1.1, 0.6, 1.5);
      else if (p.type === 'blackhole') this.seedLight(p.x, p.y, 0.9, 0.45, 1.4);
      else if (p.type === 'iceshard' || p.type === 'icelance')
        this.seedLight(p.x, p.y, 0.5, 0.85, 1.2);
      else if (p.type === 'wisp') this.seedLight(p.x, p.y, 0.4, 1.0, 1.3);
      else if (p.type === 'meteor') this.seedLight(p.x, p.y, 1.6, 0.6, 0.1);
      else if (p.type === 'acidglob') this.seedLight(p.x, p.y, 0.15, 0.55, 0.1);
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
        if (p.kind === 'key') this.seedLight(p.x, p.y - 2, 0.7, 0.6, 0.2);
        else if (p.kind === 'heart') this.seedLight(p.x, p.y - 2, 0.5, 0.16, 0.22);
        else if (p.kind === 'tome') this.seedLight(p.x, p.y - 2, 0.25, 0.4, 0.6);
        else if (p.kind === 'potion') this.seedLight(p.x, p.y - 2, 0.4, 0.2, 0.5);
      }
      if (runtime.portal) {
        const throb = 0.6 + Math.sin(ctx.state.frameCount * 0.07) * 0.25;
        const lit = runtime.keyTaken ? 1.5 : 0.6;
        this.seedLight(runtime.portal.x, runtime.portal.y - 4, 0.55 * throb * lit, 0.2 * throb * lit, 0.9 * throb * lit);
      }
      // Rune glyphs glow violet until struck, then triumphant green
      for (const v of runtime.runeVaults) {
        if (v.active) this.seedLight(v.rx, v.ry, 0.15, 0.6, 0.28);
        else this.seedLight(v.rx, v.ry, 0.45, 0.16, 0.6);
      }
      // Lit braziers cast warmth past their own flames (fire cells help too)
      for (const m of runtime.mechanisms) {
        if (m.kind === 'brazier' && m.state === 1) this.seedLight(m.x, m.y - 2, 0.8, 0.5, 0.12);
      }
      // Designer-placed lights (Builder Phase 7).
      if (runtime.authoredLights) {
        this.seedAuthoredSet(ctx, runtime.authoredLights, renderCamX, renderCamY);
      }
    }
    // Builder light PREVIEW: while the editor is open it feeds its authored
    // lights here so mood reads live without a playtest round-trip.
    if (ctx.state.editorLights && ctx.state.mode === 'build') {
      this.seedAuthoredSet(ctx, ctx.state.editorLights, renderCamX, renderCamY);
    }
    // Living light: golem cores pulse (synced to the sprite), imps smoulder,
    // wisps carry their own cold halo, mage hands throb purple
    for (const e of ctx.enemies) {
      if (e.kind === 'colossus') {
        // The kiln lights its own arena — dimming hard when doused
        const heat =
          e.status.wet > 0 ? 0.3 : 0.85 + Math.sin(ctx.state.frameCount * 0.09 + e.bobPhase) * 0.25;
        this.seedLight(e.x, e.y - 12, heat * 2.0, heat * 1.2, heat * 0.25);
        this.seedLight(e.x, e.y - 22, heat * 0.9, heat * 0.55, heat * 0.12);
      } else if (e.kind === 'leviathan') {
        // the angler's lamp: a cold pulse that betrays it through the water
        const lure = 0.65 + Math.sin(ctx.state.frameCount * 0.07 + e.bobPhase) * 0.35;
        this.seedLight(e.x, e.y - 14, lure * 0.4, lure * 1.1, lure * 1.4);
      } else if (e.kind === 'golem') {
        const pulse = 0.7 + Math.sin(ctx.state.frameCount * 0.12 + e.bobPhase) * 0.3;
        this.seedLight(e.x, e.y - 10, pulse * 1.25, pulse * 0.95, pulse * 0.2);
        if (e.jetFuel > 0) this.seedLight(e.x, e.y + 2, 1.5, 0.9, 0.22);
      } else if (e.kind === 'imp') {
        const f = 0.55 + Math.random() * 0.2;
        this.seedLight(e.x, e.y - 6, f, f * 0.45, f * 0.08);
      } else if (e.kind === 'wisp') {
        this.seedLight(e.x, e.y - 4, 0.5, 0.9, 1.1);
      } else if (e.kind === 'mage') {
        const pulse = 0.8 + Math.sin(ctx.state.frameCount * 0.1 + e.bobPhase) * 0.2;
        this.seedLight(e.x, e.y - 6, 0.8 * pulse, 0.3 * pulse, 1.0 * pulse);
      }
    }

    // Four directional sweeps (each pulls from straight + diagonal predecessors)
    // left -> right
    for (let y = 0; y < LH; y++) {
      const row = y * LW;
      const up = y > 0 ? row - LW : row,
        dn = y < LH - 1 ? row + LW : row;
      for (let x = 1; x < LW; x++) {
        const i = row + x,
          a = lightAtt[i],
          j = i - 1;
        let v = Math.max(lightR[j], Math.max(lightR[up + x - 1], lightR[dn + x - 1]) * 0.955) * a;
        if (v > lightR[i]) lightR[i] = v;
        v = Math.max(lightG[j], Math.max(lightG[up + x - 1], lightG[dn + x - 1]) * 0.955) * a;
        if (v > lightG[i]) lightG[i] = v;
        v = Math.max(lightB[j], Math.max(lightB[up + x - 1], lightB[dn + x - 1]) * 0.955) * a;
        if (v > lightB[i]) lightB[i] = v;
      }
    }
    // right -> left
    for (let y = 0; y < LH; y++) {
      const row = y * LW;
      const up = y > 0 ? row - LW : row,
        dn = y < LH - 1 ? row + LW : row;
      for (let x = LW - 2; x >= 0; x--) {
        const i = row + x,
          a = lightAtt[i],
          j = i + 1;
        let v = Math.max(lightR[j], Math.max(lightR[up + x + 1], lightR[dn + x + 1]) * 0.955) * a;
        if (v > lightR[i]) lightR[i] = v;
        v = Math.max(lightG[j], Math.max(lightG[up + x + 1], lightG[dn + x + 1]) * 0.955) * a;
        if (v > lightG[i]) lightG[i] = v;
        v = Math.max(lightB[j], Math.max(lightB[up + x + 1], lightB[dn + x + 1]) * 0.955) * a;
        if (v > lightB[i]) lightB[i] = v;
      }
    }
    // top -> bottom
    for (let y = 1; y < LH; y++) {
      const row = y * LW,
        prev = row - LW;
      for (let x = 0; x < LW; x++) {
        const i = row + x,
          a = lightAtt[i];
        const xl = x > 0 ? x - 1 : x,
          xr = x < LW - 1 ? x + 1 : x;
        let v = Math.max(lightR[prev + x], Math.max(lightR[prev + xl], lightR[prev + xr]) * 0.955) * a;
        if (v > lightR[i]) lightR[i] = v;
        v = Math.max(lightG[prev + x], Math.max(lightG[prev + xl], lightG[prev + xr]) * 0.955) * a;
        if (v > lightG[i]) lightG[i] = v;
        v = Math.max(lightB[prev + x], Math.max(lightB[prev + xl], lightB[prev + xr]) * 0.955) * a;
        if (v > lightB[i]) lightB[i] = v;
      }
    }
    // bottom -> top
    for (let y = LH - 2; y >= 0; y--) {
      const row = y * LW,
        nxt = row + LW;
      for (let x = 0; x < LW; x++) {
        const i = row + x,
          a = lightAtt[i];
        const xl = x > 0 ? x - 1 : x,
          xr = x < LW - 1 ? x + 1 : x;
        let v = Math.max(lightR[nxt + x], Math.max(lightR[nxt + xl], lightR[nxt + xr]) * 0.955) * a;
        if (v > lightR[i]) lightR[i] = v;
        v = Math.max(lightG[nxt + x], Math.max(lightG[nxt + xl], lightG[nxt + xr]) * 0.955) * a;
        if (v > lightG[i]) lightG[i] = v;
        v = Math.max(lightB[nxt + x], Math.max(lightB[nxt + xl], lightB[nxt + xr]) * 0.955) * a;
        if (v > lightB[i]) lightB[i] = v;
      }
    }

    // The wand: a true shadow-casting light. Rays march outward from the tip;
    // rock absorbs them hard, so edges throw real shadows and nothing wraps corners.
    if (ctx.state.mode === 'play' && !ctx.player.dead) {
      // Wand muzzle: 9 cells along aimAngle from (player.x, player.y - 9) —
      // computed locally (same formula as ctx.spells.wandTip) so the render
      // layer never depends on the spells system.
      const tipX = ctx.player.x + Math.cos(ctx.player.aimAngle) * 9;
      const tipY = ctx.player.y - 9 + Math.sin(ctx.player.aimAngle) * 9;
      // Torchbearer (tonic or boon): brighter, steadier, longer wand light
      const torch = ctx.player.status.torch > 0 || ctx.player.perks.torchbearer === true;
      const flick = torch ? Math.max(this.wandFlicker, 1.05) : this.wandFlicker;
      const s = (torch ? 5.6 : 4.6) * flick;
      this.raycastLight(tipX, tipY, s, s * 0.84, s * 0.6, torch ? 76 : 56);
    }
  }

  private raycastLight(
    wx: number,
    wy: number,
    sr: number,
    sg: number,
    sb: number,
    radiusHalf: number,
  ): void {
    const { LW, LH, lightR, lightG, lightB, lightAtt } = this;
    const ox = (wx - this.ctx.camera.renderX) / 2,
      oy = (wy - this.ctx.camera.renderY) / 2;
    if (ox < -radiusHalf || ox > LW + radiusHalf || oy < -radiusHalf || oy > LH + radiusHalf)
      return;
    const RAYS = 540;
    const STEP_AIR = 0.988,
      STEP_SOLID = 0.6,
      STEP_LIQ = 0.93;
    for (let k = 0; k < RAYS; k++) {
      const a = (k / RAYS) * Math.PI * 2;
      const dx = Math.cos(a),
        dy = Math.sin(a);
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
        const att = lightAtt[i];
        T *= att < 0.5 ? STEP_SOLID : att < 0.88 ? STEP_LIQ : STEP_AIR;
        if (T < 0.02) break;
      }
    }
  }
}

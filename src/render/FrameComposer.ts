import type { Ctx, Enemy } from '@/core/types';
import type { LightField, ParallaxLayers, PixelSurface, RenderTarget } from '@/render/pixels';
import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { Cell } from '@/sim/CellType';
import { unpackB, unpackG, unpackR } from '@/sim/colors';

interface Lens {
  cx: number;
  cy: number;
  R: number;
  K: number;
}

/**
 * Composes each frame's CPU-side pixel buffer (original updateWebGLBuffers):
 * the lit world window with shockwave/black-hole refraction and parallax
 * background, then overlays particles, lightning, projectiles, enemies, the
 * dig beam and the player sprite. Also provides the setPx/addPx pixel
 * primitives every sprite renderer draws with.
 */
export class FrameComposer implements PixelSurface {
  /** Integer camera snapshot for the current frame (original renderCamX/renderCamY). */
  private renderCamX = 0;
  private renderCamY = 0;

  constructor(
    private readonly target: RenderTarget,
    private readonly light: LightField,
    private readonly layers: ParallaxLayers,
    private readonly drawPlayer: (s: PixelSurface, light: LightField, ctx: Ctx) => void,
    private readonly drawEnemy: (s: PixelSurface, light: LightField, ctx: Ctx, e: Enemy) => void,
  ) {}

  // ===================== Render Buffer + Pixel Sprites =====================
  setPx(x: number, y: number, r: number, g: number, b: number): void {
    const vx = Math.round(x) - this.renderCamX,
      vy = Math.round(y) - this.renderCamY;
    if (vx < 0 || vx >= VIEW_W || vy < 0 || vy >= VIEW_H) return;
    const idx = ((VIEW_H - 1 - vy) * VIEW_W + vx) * 4;
    const pixelData = this.target.pixelData;
    pixelData[idx] = r;
    pixelData[idx + 1] = g;
    pixelData[idx + 2] = b;
    pixelData[idx + 3] = 1.0;
  }

  addPx(x: number, y: number, r: number, g: number, b: number): void {
    const vx = Math.round(x) - this.renderCamX,
      vy = Math.round(y) - this.renderCamY;
    if (vx < 0 || vx >= VIEW_W || vy < 0 || vy >= VIEW_H) return;
    const idx = ((VIEW_H - 1 - vy) * VIEW_W + vx) * 4;
    const pixelData = this.target.pixelData;
    pixelData[idx] += r;
    pixelData[idx + 1] += g;
    pixelData[idx + 2] += b;
  }

  compose(ctx: Ctx): void {
    ctx.camera.renderX = Math.floor(ctx.camera.x);
    ctx.camera.renderY = Math.floor(ctx.camera.y);
    const renderCamX = ctx.camera.renderX;
    const renderCamY = ctx.camera.renderY;
    this.renderCamX = renderCamX;
    this.renderCamY = renderCamY;

    const frameCount = ctx.state.frameCount;
    const ambient = ctx.params.global.ambient;
    const world = ctx.world;
    const types = world.types;
    const cellColors = world.colors;
    const charge = world.charge;
    const materials = ctx.params.materials;
    const { lightR, lightG, lightB, vignette, LW } = this.light;
    const { bgFar, bgNear } = this.layers;
    const pixelData = this.target.pixelData;

    const wavesLen = ctx.shockwaves.length;
    // Active singularities bend the image around them (inward pull + swirl)
    const lenses: Lens[] = [];
    for (const pr of ctx.projectiles) {
      if (pr.type === 'blackhole') {
        lenses.push({ cx: pr.x, cy: pr.y, R: pr.vortexRad! * 2.1, K: 4 + pr.vortexRad! * 0.16 });
      }
    }
    const lensLen = lenses.length;
    if (frameCount % 2 === 0 || frameCount < 5) this.light.build(ctx);
    const boostG = ctx.params.global.maxBrightness;
    const farOX = Math.floor(renderCamX * 0.35),
      farOY = Math.floor(renderCamY * 0.35);
    const nearOX = Math.floor(renderCamX * 0.62),
      nearOY = Math.floor(renderCamY * 0.62);

    for (let vy = 0; vy < VIEW_H; vy++) {
      const wy = renderCamY + vy;
      for (let vx = 0; vx < VIEW_W; vx++) {
        const wx = renderCamX + vx;
        let lookupX = wx,
          lookupY = wy;
        let ringGlow = 0;

        if (wavesLen > 0) {
          for (let i = 0; i < wavesLen; i++) {
            const w = ctx.shockwaves[i];
            const dx = wx - w.cx,
              dy = wy - w.cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const front = w.currentRadius,
              thick = 9;
            if (dist > front - thick && dist < front + thick) {
              const edgeFactor = 1.0 - Math.abs(dist - front) / thick;
              const decayFactor = 1.0 - w.currentRadius / w.maxRadius;
              const offset = Math.sin(edgeFactor * Math.PI) * w.strength * decayFactor;
              ringGlow += Math.sin(edgeFactor * Math.PI) * decayFactor;
              if (dist > 0) {
                lookupX -= Math.floor((dx / dist) * offset);
                lookupY -= Math.floor((dy / dist) * offset);
              }
            }
          }
          if (lookupX < 0) lookupX = 0;
          else if (lookupX >= WIDTH) lookupX = WIDTH - 1;
          if (lookupY < 0) lookupY = 0;
          else if (lookupY >= HEIGHT) lookupY = HEIGHT - 1;
        }

        if (lensLen > 0) {
          for (let li = 0; li < lensLen; li++) {
            const L = lenses[li];
            const ldx = wx - L.cx,
              ldy = wy - L.cy;
            const ld2 = ldx * ldx + ldy * ldy;
            if (ld2 > L.R * L.R || ld2 < 1) continue;
            const ld = Math.sqrt(ld2);
            const pull = 1 - ld / L.R;
            const k = pull * pull * L.K;
            // sample from further out (pinch) with a tangential swirl
            lookupX += Math.floor((ldx / ld) * k - (ldy / ld) * k * 0.7);
            lookupY += Math.floor((ldy / ld) * k + (ldx / ld) * k * 0.7);
          }
          if (lookupX < 0) lookupX = 0;
          else if (lookupX >= WIDTH) lookupX = WIDTH - 1;
          if (lookupY < 0) lookupY = 0;
          else if (lookupY >= HEIGHT) lookupY = HEIGHT - 1;
        }

        const bufferIdx = ((VIEW_H - 1 - vy) * VIEW_W + vx) * 4;
        const ci = lookupX + lookupY * WIDTH;
        const type = types[ci];

        let r: number, g: number, b: number;
        if (type === Cell.Empty) {
          // Parallax composite: near rock texture, carved darker by far silhouettes
          const fi = (farOY + vy) * WIDTH + (farOX + vx);
          const ni = (nearOY + vy) * WIDTH + (nearOX + vx);
          let base = 0.022 + bgNear[ni] * 0.085;
          if (bgFar[fi] > 0.5) base *= 0.4;
          base *= 0.86 + 0.14 * (1 - wy / HEIGHT);
          r = base * 0.8;
          g = base * 0.9;
          b = base * 1.25;
          {
            const li = (vy >> 1) * LW + (vx >> 1);
            const vg = vignette[vy * VIEW_W + vx];
            let lf0 = Math.min(2.2, lightR[li]) * vg;
            r = (r * 0.45 + ambient * 0.03) * vg + r * lf0 * lf0;
            lf0 = Math.min(2.2, lightG[li]) * vg;
            g = (g * 0.45 + ambient * 0.03) * vg + g * lf0 * lf0;
            lf0 = Math.min(2.2, lightB[li]) * vg;
            b = (b * 0.45 + ambient * 0.06) * vg + b * lf0 * lf0;
            // air itself catches the glow near strong light
            r += Math.max(0, lightR[li] - 0.25) * 0.1 * vg;
            g += Math.max(0, lightG[li] - 0.25) * 0.085 * vg;
            b += Math.max(0, lightB[li] - 0.25) * 0.07 * vg;
          }
          if (ringGlow > 0) {
            r += ringGlow * 0.55;
            g += ringGlow * 0.42;
            b += ringGlow * 0.26;
          }
          pixelData[bufferIdx] = r;
          pixelData[bufferIdx + 1] = g;
          pixelData[bufferIdx + 2] = b;
          pixelData[bufferIdx + 3] = 1.0;
          continue;
        }

        const rgb = cellColors[ci];
        r = unpackR(rgb) / 255;
        g = unpackG(rgb) / 255;
        b = unpackB(rgb) / 255;

        // Living flame: per-frame flicker on hot cells
        if (type === Cell.Fire) {
          const fl = 0.75 + Math.random() * 0.5;
          r *= fl;
          g *= fl;
          b *= fl;
        } else if (type === Cell.Lava) {
          r *= 0.96 + Math.random() * 0.08;
          g *= 0.8 + Math.random() * 0.35;
        } else if (type === Cell.Ember) {
          const fl = 0.7 + Math.random() * 0.55;
          r *= fl;
          g *= fl * 0.95;
        }

        let scalar = 0.0;
        const mat = materials[type];
        if (mat?.bloomWeight !== undefined) {
          scalar = mat.bloomWeight;
        }
        let intensity = 1.0 + (boostG - 1.0) * scalar;

        if (charge[ci] > 0) {
          r = 0.2;
          g = 0.75;
          b = 1.0;
          intensity = boostG * 1.2;
        }

        {
          const li = (vy >> 1) * LW + (vx >> 1);
          const vg = vignette[vy * VIEW_W + vx];
          // squared: compensates the sRGB output curve so darkness reads as darkness.
          // The small additive floor keeps shadowed rock readable as silhouette
          // (the BFS rim shading baked into cell colors carries the detail).
          const floor = 0.06 * vg;
          let lf = (ambient + Math.min(2.2, lightR[li])) * vg;
          r = r * Math.min(2.6, lf * lf) + r * floor;
          lf = (ambient + Math.min(2.2, lightG[li])) * vg;
          g = g * Math.min(2.6, lf * lf) + g * floor;
          lf = (ambient + Math.min(2.2, lightB[li])) * vg;
          b = b * Math.min(2.6, lf * lf) + b * floor;
        }
        pixelData[bufferIdx] = r * intensity + ringGlow * 0.55;
        pixelData[bufferIdx + 1] = g * intensity + ringGlow * 0.42;
        pixelData[bufferIdx + 2] = b * intensity + ringGlow * 0.26;
        pixelData[bufferIdx + 3] = 1.0;
      }
    }

    // Ballistic debris / embers / coins
    const boost = ctx.params.global.maxBrightness;
    for (const fp of ctx.particles.list) {
      const glow = fp.glow || 1.0;
      if (glow > 1.01) {
        this.setPx(
          fp.x,
          fp.y,
          (unpackR(fp.color) / 255) * glow,
          (unpackG(fp.color) / 255) * glow,
          (unpackB(fp.color) / 255) * glow,
        );
      } else {
        const lt = this.light.sample(fp.x, fp.y);
        this.setPx(
          fp.x,
          fp.y,
          (unpackR(fp.color) / 255) * lt.r,
          (unpackG(fp.color) / 255) * lt.g,
          (unpackB(fp.color) / 255) * lt.b,
        );
      }
    }

    // Lightning arcs: white-hot core
    for (const arc of ctx.lightning.arcs) {
      const k = (arc.life / 8) * arc.intensity * boost * 1.3;
      for (const pt of arc.pts) {
        this.setPx(pt.x, pt.y, 0.9 * k, 0.97 * k, 1.0 * k);
        this.setPx(pt.x, pt.y - 1, 0.35 * k, 0.55 * k, 0.8 * k);
      }
    }

    // Projectiles
    for (const p of ctx.projectiles) {
      const gx = Math.floor(p.x),
        gy = Math.floor(p.y);
      if (world.inBounds(gx, gy)) {
        if (p.type === 'bolt') {
          const nx = p.vx / (Math.abs(p.vx) + Math.abs(p.vy) + 0.001),
            ny = p.vy / (Math.abs(p.vx) + Math.abs(p.vy) + 0.001);
          this.setPx(gx, gy, 0.4 * boost, 0.95 * boost, 1.0 * boost);
          this.setPx(gx - nx * 2, gy - ny * 2, 0.0, 0.55 * boost, 0.75 * boost);
          this.setPx(gx - nx * 4, gy - ny * 4, 0.0, 0.28 * boost, 0.42 * boost);
          this.setPx(gx - nx * 6, gy - ny * 6, 0.0, 0.12 * boost, 0.2 * boost);
        } else if (p.type === 'bomb') {
          const fuse = p.life < 30 && frameCount % 8 < 4 ? 1.8 : 1.0;
          this.setPx(gx, gy, 0.16, 0.17, 0.22);
          this.setPx(gx + 1, gy, 0.16, 0.17, 0.22);
          this.setPx(gx, gy - 1, 0.24, 0.26, 0.32);
          this.setPx(gx + 1, gy - 1, 0.16, 0.17, 0.22);
          this.setPx(gx, gy - 2, 1.0 * boost * fuse * 0.4, 0.65 * boost * fuse * 0.4, 0.1);
        } else if (p.type === 'warp') {
          const nx = p.vx / (Math.abs(p.vx) + Math.abs(p.vy) + 0.001),
            ny = p.vy / (Math.abs(p.vx) + Math.abs(p.vy) + 0.001);
          this.setPx(gx, gy, 0.85 * boost, 0.55 * boost, 1.0 * boost);
          this.setPx(gx - nx * 2, gy - ny * 2, 0.55 * boost, 0.3 * boost, 0.8 * boost);
          this.setPx(gx - nx * 4, gy - ny * 4, 0.3 * boost, 0.12 * boost, 0.5 * boost);
          if (frameCount % 2 === 0)
            this.setPx(
              gx + ((Math.random() * 3) | 0) - 1,
              gy + ((Math.random() * 3) | 0) - 1,
              0.5,
              0.25,
              0.7,
            );
        } else if (p.type === 'fireball') {
          const fl = 0.8 + Math.random() * 0.5;
          this.setPx(gx, gy, 1.0 * boost * fl, 0.45 * boost * fl, 0.05);
          this.setPx(gx + 1, gy, 0.9 * boost * fl, 0.35 * boost * fl, 0.04);
          this.setPx(gx, gy - 1, 0.85 * fl, 0.3 * fl, 0.03);
          this.setPx(gx + 1, gy - 1, 0.7 * fl, 0.22 * fl, 0.02);
        } else if (p.type === 'frostbolt') {
          // 2x2 pale-cyan core with a small additive halo
          const fl = 0.8 + Math.random() * 0.35;
          this.setPx(gx, gy, 0.55 * boost * fl, 0.9 * boost * fl, 1.0 * boost * fl);
          this.setPx(gx + 1, gy, 0.45 * boost * fl, 0.8 * boost * fl, 0.95 * boost * fl);
          this.setPx(gx, gy - 1, 0.45 * fl, 0.8 * fl, 0.95 * fl);
          this.setPx(gx + 1, gy - 1, 0.35 * fl, 0.65 * fl, 0.85 * fl);
          this.addPx(gx - 1, gy, 0.05, 0.16, 0.24);
          this.addPx(gx + 2, gy, 0.05, 0.16, 0.24);
          this.addPx(gx, gy + 1, 0.05, 0.16, 0.24);
          this.addPx(gx, gy - 2, 0.05, 0.16, 0.24);
        } else if (p.type === 'iceshard' || p.type === 'icelance') {
          // Pale crystal dart; the lance trails extra segments along its flight line
          const fl = 0.85 + Math.random() * 0.3;
          const seg = p.type === 'icelance' ? 3 : 1;
          const spd = Math.hypot(p.vx, p.vy) || 1;
          for (let sgi = 0; sgi <= seg; sgi++) {
            const lx = gx - Math.round((p.vx / spd) * sgi);
            const ly = gy - Math.round((p.vy / spd) * sgi);
            const fade = 1 - sgi / (seg + 1);
            this.setPx(
              lx,
              ly,
              0.5 * boost * fl * fade,
              0.85 * boost * fl * fade,
              1.0 * boost * fl * fade,
            );
          }
          this.addPx(gx, gy - 1, 0.06, 0.14, 0.22);
          this.addPx(gx, gy + 1, 0.06, 0.14, 0.22);
        } else if (p.type === 'pellet') {
          const fl = 0.8 + Math.random() * 0.4;
          this.setPx(gx, gy, 0.35 * boost * fl, 0.85 * boost * fl, 1.0 * boost * fl);
          this.addPx(gx + 1, gy, 0.05, 0.14, 0.2);
        } else if (p.type === 'wisp') {
          // A guttering self-lit mote with an orbiting glint
          const fl = 0.9 + Math.random() * 0.5;
          this.setPx(gx, gy, 0.35 * boost * fl, 0.95 * boost * fl, 1.1 * boost * fl);
          const oa = frameCount * 0.35;
          this.addPx(
            gx + Math.round(Math.cos(oa) * 2),
            gy + Math.round(Math.sin(oa) * 2),
            0.1,
            0.28,
            0.34,
          );
        } else if (p.type === 'meteor') {
          // Burning boulder: 3x3 molten core inside a ragged dark crust
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const hot = (dx === 0 && dy === 0) || Math.random() < 0.5;
              if (hot) this.setPx(gx + dx, gy + dy, 1.3 * boost, 0.5 * boost, 0.08);
              else this.setPx(gx + dx, gy + dy, 0.25, 0.12, 0.08);
            }
          this.addPx(gx, gy - 2, 0.3, 0.12, 0.02);
        } else if (p.type === 'acidglob') {
          const fl = 0.75 + Math.random() * 0.3;
          this.setPx(gx, gy, 0.15 * fl, 0.8 * boost * fl, 0.12 * fl);
          this.setPx(gx, gy - 1, 0.1 * fl, 0.6 * fl, 0.08 * fl);
          this.addPx(gx + 1, gy, 0.03, 0.16, 0.03);
        } else if (p.type === 'blackhole') {
          const drawRad = Math.max(2, Math.floor(p.vortexRad! / 6));
          for (let dy = -drawRad - 1; dy <= drawRad + 1; dy++) {
            for (let dx = -drawRad - 1; dx <= drawRad + 1; dx++) {
              const rx = gx + dx,
                ry = gy + dy;
              if (!world.inBounds(rx, ry)) continue;
              const d2 = dx * dx + dy * dy;
              const rim2 = (drawRad + 1) * (drawRad + 1);
              if (d2 <= drawRad * drawRad * 0.45) {
                this.setPx(rx, ry, 0.01, 0.0, 0.03); // event horizon: near-black core
              } else if (d2 <= rim2) {
                const swirl = 0.7 + Math.sin(frameCount * 0.25 + Math.atan2(dy, dx) * 3) * 0.3;
                this.setPx(rx, ry, 0.6 * boost * swirl, 0.1 * boost * swirl, 1.0 * boost * swirl);
              }
            }
          }
        }
      }
    }

    // Entities on top
    for (const e of ctx.enemies) this.drawEnemy(this, this.light, ctx, e);
    // Excavation beam: white-hot core, tight amber sheath, light cast onto nearby rock
    const digBeam = ctx.fx.digBeam;
    if (digBeam && digBeam.life > 0) {
      // (life is decremented by Game at the frame tail — approved deviation 7)
      const dxL = digBeam.x1 - digBeam.x0,
        dyL = digBeam.y1 - digBeam.y0;
      const lenL = Math.hypot(dxL, dyL) || 1;
      const steps = Math.max(2, Math.floor(lenL));
      const pxn = -dyL / lenL,
        pyn = dxL / lenL; // beam-perpendicular
      const bb = ctx.params.global.maxBrightness * 0.55;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const bxp = digBeam.x0 + dxL * t;
        const byp = digBeam.y0 + dyL * t;
        const w = 0.75 + Math.random() * 0.35;
        this.setPx(bxp, byp, 1.15 * bb * w, 0.85 * bb * w, 0.3 * bb * w);
        // tight falloff sheath, one pixel either side
        this.addPx(bxp + pxn, byp + pyn, 0.16 * bb * w, 0.1 * bb * w, 0.02);
        this.addPx(bxp - pxn, byp - pyn, 0.16 * bb * w, 0.1 * bb * w, 0.02);
      }
      // white-hot cutting point + sputtering sparks
      this.setPx(digBeam.x1, digBeam.y1, 1.6 * bb, 1.4 * bb, 0.9 * bb);
      this.setPx(
        digBeam.x1 + ((Math.random() * 3) | 0) - 1,
        digBeam.y1 + ((Math.random() * 3) | 0) - 1,
        1.1 * bb,
        0.85 * bb,
        0.35 * bb,
      );
      // projected glow: warm light splashed across the surrounding rock face
      const GR = 12;
      const ix = Math.floor(digBeam.x1),
        iy = Math.floor(digBeam.y1);
      for (let gdy = -GR; gdy <= GR; gdy++) {
        for (let gdx = -GR; gdx <= GR; gdx++) {
          const d2 = gdx * gdx + gdy * gdy;
          if (d2 > GR * GR || d2 === 0) continue;
          const wxg = ix + gdx,
            wyg = iy + gdy;
          if (!world.inBounds(wxg, wyg) || types[wxg + wyg * WIDTH] === Cell.Empty) continue;
          const fall = 1 - Math.sqrt(d2) / GR;
          const lum = fall * fall * 0.55;
          this.addPx(wxg, wyg, lum * 1.0, lum * 0.66, lum * 0.18);
        }
      }
    }

    if (ctx.state.mode === 'play') this.drawPlayer(this, this.light, ctx);

    this.target.markTextureDirty();
  }
}

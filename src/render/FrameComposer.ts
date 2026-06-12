import type { Ctx, Enemy } from '@/core/types';
import type { LightField, ParallaxLayers, PixelSurface, RenderTarget } from '@/render/pixels';
import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { PICKUP_COLOR } from '@/game/Pickups';
import { Cell, isLiquid } from '@/sim/CellType';
import { COLOR_FN, unpackB, unpackG, unpackR } from '@/sim/colors';

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

  private unpack01(c: number): { r: number; g: number; b: number } {
    return { r: unpackR(c) / 255, g: unpackG(c) / 255, b: unpackB(c) / 255 };
  }

  private isHotCell(t: number): boolean {
    return t === Cell.Fire || t === Cell.Lava || t === Cell.Ember;
  }

  private isBrewableMass(t: number): boolean {
    return isLiquid(t) || t === Cell.Sand || t === Cell.Gold || t === Cell.Gunpowder;
  }

  private drawDottedLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    steps: number,
    phase: number,
    r: number,
    g: number,
    b: number,
  ): void {
    for (let k = 0; k < steps; k++) {
      const t = (k + phase) / steps;
      const wobble = Math.sin(t * Math.PI * 2 + phase * 4) * 0.7;
      this.addPx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + wobble, r, g, b);
    }
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
        } else if ((type === Cell.Water || type === Cell.Healium || type === Cell.Teleportium) && wy > 0 && types[ci - WIDTH] === Cell.Empty) {
          const wave = 0.88 + Math.sin(frameCount * 0.16 + wx * 0.42) * 0.12;
          r *= wave;
          g *= 0.94 + (wave - 0.88) * 0.45;
          b *= 1.08 + (wave - 0.88) * 0.55;
        } else if (type === Cell.Crystal) {
          if (((wx * 17 + wy * 31 + frameCount) % 97) === 0) {
            r *= 1.65;
            g *= 1.45;
            b *= 1.95;
          }
        } else if (type === Cell.Glowshroom) {
          const breath = 0.9 + Math.sin(frameCount * 0.045 + wx * 0.21 + wy * 0.17) * 0.16;
          r *= breath;
          g *= 1.02 + (breath - 0.9) * 0.9;
          b *= breath;
        } else if (type === Cell.Vines || type === Cell.Moss || type === Cell.Fungus) {
          const living = 0.94 + Math.sin(frameCount * 0.035 + wx * 0.13 + wy * 0.29) * 0.08;
          g *= living;
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
          // Emissive cells are LIGHT SOURCES: their own brightness must not be
          // crushed by the screen vignette (it sits inside the squared light
          // factor, so corners rendered at ~23% and bloom only fired near the
          // center). The vignette-free self-glow floor keeps lava/fire/crystal
          // equally bloom-bright across the whole frame.
          const selfGlow = scalar > 0 ? 0.45 + scalar * 1.55 : 0;
          // Soft knee on lit (non-emissive) cells: strong light keeps its REACH
          // but the top end compresses, so the wand no longer blows nearby
          // floor into a white bloom wash that swallows levers and pickups.
          let lf = (ambient + Math.min(2.2, lightR[li])) * vg;
          let lit = lf * lf;
          if (lit > 1.25) lit = Math.min(2.0, 1.25 + (lit - 1.25) * 0.3);
          r = r * Math.max(lit, selfGlow) + r * floor;
          lf = (ambient + Math.min(2.2, lightG[li])) * vg;
          lit = lf * lf;
          if (lit > 1.25) lit = Math.min(2.0, 1.25 + (lit - 1.25) * 0.3);
          g = g * Math.max(lit, selfGlow) + g * floor;
          lf = (ambient + Math.min(2.2, lightB[li])) * vg;
          lit = lf * lf;
          if (lit > 1.25) lit = Math.min(2.0, 1.25 + (lit - 1.25) * 0.3);
          b = b * Math.max(lit, selfGlow) + b * floor;
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

    // Landmarks, pickups + the exit portal (under entities so foes read on top)
    this.drawLandmarks(ctx);
    this.drawPickupsAndPortal(ctx);
    this.drawMechanismsAndRunes(ctx);
    this.drawCritters(ctx);
    this.drawFlaskEffects(ctx);

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

  /** Checkpoints, cauldrons, and the exit well get small state-readable motion. */
  private drawLandmarks(ctx: Ctx): void {
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play') return;
    const frame = ctx.state.frameCount;
    const world = ctx.world;
    const camX = ctx.camera.renderX,
      camY = ctx.camera.renderY;

    for (const ws of runtime.waystones) {
      if (ws.x < camX - 12 || ws.x > camX + VIEW_W + 12 || ws.y < camY - 12 || ws.y > camY + VIEW_H + 12)
        continue;
      let hot = 0;
      for (let dy = -3; dy <= -1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const X = ws.x + dx,
            Y = ws.y + dy;
          if (!world.inBounds(X, Y)) continue;
          if (this.isHotCell(world.types[world.idx(X, Y)])) hot++;
        }
      }

      const litPulse = 0.72 + Math.sin(frame * 0.07 + ws.x) * 0.22;
      const heatPulse = Math.min(1, hot / 8) * (0.55 + Math.sin(frame * 0.2 + ws.y) * 0.25);
      for (let dx = -4; dx <= 4; dx++) {
        this.setPx(ws.x + dx, ws.y, 0.18, 0.16, 0.14);
        if (Math.abs(dx) <= 2) this.setPx(ws.x + dx, ws.y - 1, 0.33, 0.28, 0.2);
      }
      this.setPx(ws.x - 3, ws.y - 2, 0.23, 0.2, 0.16);
      this.setPx(ws.x + 3, ws.y - 2, 0.23, 0.2, 0.16);
      if (ws.lit) {
        for (let k = 0; k < 5; k++) {
          const a = frame * 0.05 + k * 1.26;
          this.addPx(ws.x + Math.round(Math.cos(a) * 2), ws.y - 4 + Math.round(Math.sin(a) * 1.2), 0.5 * litPulse, 0.28 * litPulse, 0.05);
        }
        this.addPx(ws.x, ws.y - 3, 1.0 * litPulse, 0.62 * litPulse, 0.12);
      } else if (hot > 0) {
        for (let k = 0; k < Math.min(5, hot); k++) {
          const y = ws.y - 3 - ((frame + k * 5) % 12) / 3;
          this.addPx(ws.x + ((k % 3) - 1), y, 0.75 * heatPulse, 0.42 * heatPulse, 0.08);
        }
      } else if (frame % 80 < 22) {
        this.addPx(ws.x, ws.y - 3, 0.12, 0.08, 0.04);
      }
    }

    const cauldron = runtime.cauldron;
    if (cauldron && cauldron.x >= camX - 14 && cauldron.x <= camX + VIEW_W + 14 && cauldron.y >= camY - 14 && cauldron.y <= camY + VIEW_H + 14) {
      let mass = 0,
        sumR = 0,
        sumG = 0,
        sumB = 0;
      for (let dy = -2; dy <= 0; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const X = cauldron.x + dx,
            Y = cauldron.y + dy;
          if (!world.inBounds(X, Y)) continue;
          const i = world.idx(X, Y);
          const t = world.types[i];
          if (!this.isBrewableMass(t)) continue;
          const c = this.unpack01(world.colors[i]);
          sumR += c.r;
          sumG += c.g;
          sumB += c.b;
          mass++;
        }
      }
      let heated = false;
      for (let dy = -2; dy <= 4 && !heated; dy++) {
        for (let dx = -6; dx <= 6 && !heated; dx++) {
          if (Math.abs(dx) <= 3 && dy >= -2 && dy <= 0) continue;
          const X = cauldron.x + dx,
            Y = cauldron.y + dy;
          if (world.inBounds(X, Y) && this.isHotCell(world.types[world.idx(X, Y)])) heated = true;
        }
      }
      for (let dx = -4; dx <= 4; dx++) this.setPx(cauldron.x + dx, cauldron.y + 1, 0.25, 0.22, 0.19);
      this.setPx(cauldron.x - 4, cauldron.y, 0.2, 0.18, 0.16);
      this.setPx(cauldron.x + 4, cauldron.y, 0.2, 0.18, 0.16);
      if (mass > 0) {
        const inv = 1 / mass;
        const r = sumR * inv,
          g = sumG * inv,
          b = sumB * inv;
        const simmer = heated ? 0.9 + Math.sin(frame * 0.22) * 0.25 : 0.72 + Math.sin(frame * 0.06) * 0.12;
        for (let dx = -3; dx <= 3; dx++) {
          const slosh = Math.round(Math.sin(frame * 0.12 + dx * 0.9) * (heated ? 1 : 0.35));
          this.setPx(cauldron.x + dx, cauldron.y - 1 + slosh, r * simmer, g * simmer, b * simmer);
        }
        if (heated) {
          for (let k = 0; k < 3; k++) {
            const lift = ((frame + k * 11) % 30) / 6;
            this.addPx(cauldron.x - 2 + k * 2, cauldron.y - 3 - lift, r * 0.32, g * 0.32, b * 0.32);
          }
        }
      }
    }

    const exit = runtime.exit;
    if (exit && exit.x >= camX - 24 && exit.x <= camX + VIEW_W + 24 && exit.sealY >= camY - 24 && exit.sealY <= camY + VIEW_H + 24) {
      const mouthY = exit.sealY - 8;
      for (let k = 0; k < 4; k++) {
        const drift = ((frame + k * 19) % 90) / 90;
        const x = exit.x + Math.round(Math.sin(frame * 0.025 + k * 1.9) * (exit.halfW + 4));
        const y = mouthY - Math.round(drift * 12);
        this.addPx(x, y, 0.07, 0.06, 0.05);
      }
      if (frame % 48 < 12) this.addPx(exit.x, exit.sealY - 12, 0.16, 0.12, 0.06);
    }
  }

  /** Hand-tool tells: flask siphon/pour beams and the bottle in flight. */
  private drawFlaskEffects(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.player.dead) return;
    const frame = ctx.state.frameCount;
    const flask = ctx.flask.state;
    const mat = flask.material;
    const tint = mat === null ? { r: 0.45, g: 0.72, b: 1.0 } : this.unpack01(COLOR_FN[mat]());
    const tip = ctx.spells.wandTip();

    if (ctx.input.siphonHeld) {
      const target = ctx.input.mouse;
      const reach = Math.hypot(target.x - ctx.player.x, target.y - (ctx.player.y - 9));
      if (reach < 72) {
        const phase = ((frame % 14) / 14);
        this.drawDottedLine(target.x, target.y, ctx.player.x, ctx.player.y - 9, 11, phase, tint.r * 0.15, tint.g * 0.2, tint.b * 0.22);
      }
    }

    if (ctx.input.pourHeld && mat !== null && flask.count > 0) {
      const a = ctx.player.aimAngle;
      for (let k = 0; k < 8; k++) {
        const t = (k + ((frame % 6) / 6)) / 8;
        this.addPx(
          tip.x + Math.cos(a) * (2 + t * 10),
          tip.y + Math.sin(a) * (2 + t * 10) + t * t * 3,
          tint.r * (0.3 - t * 0.18),
          tint.g * (0.3 - t * 0.18),
          tint.b * (0.3 - t * 0.18),
        );
      }
    }

    const bottle = ctx.flask.bottleView();
    if (!bottle) return;
    const x = Math.round(bottle.x),
      y = Math.round(bottle.y);
    const spin = frame * 0.5 + bottle.x * 0.03;
    const sx = Math.round(Math.cos(spin));
    const sy = Math.round(Math.sin(spin));
    this.setPx(x, y, 0.72, 0.9, 1.0);
    this.setPx(x + sx, y + sy, 0.45, 0.65, 0.8);
    this.setPx(x - sx, y - sy, 0.18, 0.28, 0.36);
    if (mat !== null) this.addPx(x, y + 1, tint.r * 0.55, tint.g * 0.55, tint.b * 0.55);
  }

  /** Wave F: the critter layer — tiny, alive, mostly ignorable. */
  private drawCritters(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') return;
    const frame = ctx.state.frameCount;
    for (const c of ctx.critters.list) {
      const x = Math.round(c.x),
        y = Math.round(c.y);
      if (c.kind === 'moth') {
        // pale dusty wings, alternating beat
        const beat = frame % 6 < 3 ? 1 : 0;
        this.setPx(x, y, 0.62, 0.58, 0.46);
        this.setPx(x - 1, y - beat, 0.45, 0.42, 0.33);
        this.setPx(x + 1, y - (1 - beat), 0.45, 0.42, 0.33);
      } else if (c.kind === 'firefly') {
        // dark speck, bright abdomen on the pulse
        const pulse = Math.max(0, Math.sin(c.phase * 0.45));
        this.setPx(x, y, 0.1, 0.12, 0.06);
        if (pulse > 0.25) this.addPx(x, y + 1, 0.5 * pulse, 1.4 * pulse, 0.25 * pulse);
      } else if (c.kind === 'fish') {
        const tail = Math.sin(c.phase * 1.6) > 0 ? 1 : 0;
        this.setPx(x, y, 0.5, 0.6, 0.62);
        this.setPx(x - c.facing, y, 0.36, 0.46, 0.5);
        this.setPx(x - c.facing * 2, y + tail - 0, 0.26, 0.36, 0.4);
      } else if (c.kind === 'beetle') {
        this.setPx(x, y, 0.16, 0.13, 0.1);
        this.setPx(x + c.facing, y, 0.22, 0.18, 0.12);
      } else if (c.kind === 'fly') {
        this.setPx(x, y, 0.12, 0.11, 0.09);
        if (frame % 4 < 2) this.addPx(x, y - 1, 0.08, 0.08, 0.07);
      }
    }
  }

  /** Lever arms, pressed-plate glows, dark brazier hints, floating rune glyphs. */
  private drawMechanismsAndRunes(ctx: Ctx): void {
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play') return;
    const frame = ctx.state.frameCount;
    const bst = ctx.params.global.maxBrightness;
    const camX = ctx.camera.renderX,
      camY = ctx.camera.renderY;

    for (const m of runtime.mechanisms) {
      if (m.x < camX - 12 || m.x > camX + VIEW_W + 12 || m.y < camY - 12 || m.y > camY + VIEW_H + 12)
        continue;
      if (m.kind === 'lever') {
        // base bracket
        this.setPx(m.x - 1, m.y, 0.42, 0.44, 0.5);
        this.setPx(m.x, m.y, 0.5, 0.52, 0.58);
        this.setPx(m.x + 1, m.y, 0.42, 0.44, 0.5);
        this.setPx(m.x, m.y - 1, 0.32, 0.34, 0.4);
        // the arm: snapped to its side at rest, SWEEPING during a hand-pull
        // (state flips only when the pull completes, so animate from the
        // current side toward its opposite)
        const dir = m.state === 1 ? 1 : -1;
        let lean = dir;
        const pulling = m.pullT !== undefined && m.pullT > 0;
        if (pulling) {
          const p = 1 - m.pullT! / 26;
          const eased = p * p * (3 - 2 * p); // smoothstep: heavy start, firm finish
          lean = dir + (-dir - dir) * eased;
        }
        for (let s = 1; s <= 4; s++) {
          this.setPx(m.x + Math.round(s * 0.55 * lean), m.y - 1 - s, 0.55, 0.42, 0.2);
        }
        // glowing knob rides the arm tip; strains white mid-pull
        const kx = m.x + Math.round(3 * lean),
          ky = m.y - 5 + (pulling ? Math.round(Math.abs(lean) < 0.4 ? -1 : 0) : 0);
        const g = 0.7 + Math.sin(frame * 0.1) * 0.2;
        if (pulling) this.setPx(kx, ky, 1.1, 1.0, 0.7);
        else if (m.state === 1) this.setPx(kx, ky, 0.2 * g, 1.6 * g, 0.4 * g);
        else this.setPx(kx, ky, 1.6 * g, 0.3 * g, 0.15 * g);
      } else if (m.kind === 'plate') {
        // pressure plates physically dip before the amber latch glow takes over
        const sink = m.pressed ? 1 : 0;
        for (let dx = 0; dx < m.w; dx++) this.setPx(m.x + dx, m.y + sink, 0.52, 0.45, 0.22);
        if (m.pressed || m.state > 0) {
          const g = 0.5 + Math.sin(frame * 0.18) * 0.25;
          for (let dx = 0; dx < m.w; dx += 2) this.addPx(m.x + dx, m.y - 1 + sink, 0.9 * g, 0.75 * g, 0.2 * g);
        }
      } else if (m.kind === 'brazier') {
        if (m.state === 0) {
          // dark bowls hint at what they want
          if (frame % 40 < 20) this.addPx(m.x, m.y - 2, 0.25, 0.12, 0.04);
        } else {
          const flame = 0.7 + Math.sin(frame * 0.21 + m.x) * 0.25 + Math.random() * 0.18;
          this.addPx(m.x, m.y - 3, 1.0 * flame, 0.48 * flame, 0.08);
          this.addPx(m.x - 1, m.y - 2, 0.65 * flame, 0.28 * flame, 0.05);
          this.addPx(m.x + 1, m.y - 2, 0.65 * flame, 0.28 * flame, 0.05);
        }
      } else if (m.kind === 'scale') {
        // weight gauge: notches above the pan fill amber toward the threshold
        const frac = Math.min(1, (m.reading ?? 0) / (m.threshold ?? 24));
        const sag = Math.round(frac * 2);
        for (let dx = 0; dx < m.w; dx++) this.setPx(m.x + dx, m.y + sag, 0.55, 0.43, 0.18);
        this.setPx(m.x - 1, m.y - 1 + sag, 0.32, 0.25, 0.12);
        this.setPx(m.x + m.w, m.y - 1 + sag, 0.32, 0.25, 0.12);
        for (let n = 0; n < 5; n++) {
          const gy = m.y - 9 - n;
          if (frac * 5 > n) this.setPx(m.x - 2, gy, 0.95, 0.7, 0.15);
          else this.setPx(m.x - 2, gy, 0.16, 0.13, 0.08);
        }
        if (m.state > 0) {
          const g = 0.6 + Math.sin(frame * 0.2) * 0.3;
          this.addPx(m.x + (m.w >> 1), m.y - 1, 0.9 * g, 0.75 * g, 0.2 * g);
        }
      } else if (m.kind === 'buoy' && m.zone) {
        // the float: a bobbing diamond riding the fill line, green when up
        const frac = Math.min(1, (m.reading ?? 0) / (m.threshold ?? 28));
        const fy = m.zone.y1 - Math.round((m.zone.y1 - m.zone.y0) * frac);
        const y2 = Math.round(fy - 1 + Math.sin(frame * 0.1 + m.x) * 0.8);
        const up = m.state > 0;
        const r2 = up ? 0.25 : 0.8,
          g2 = up ? 1.3 : 0.6,
          b2 = up ? 0.45 : 0.25;
        this.setPx(m.x, y2, r2, g2, b2);
        this.setPx(m.x - 1, y2 + 1, r2 * 0.6, g2 * 0.6, b2 * 0.6);
        this.setPx(m.x + 1, y2 + 1, r2 * 0.6, g2 * 0.6, b2 * 0.6);
      } else if (m.kind === 'chargelatch') {
        // the coil: cold cyan spiral, blazing white-blue once latched
        const latched = m.state === 1;
        const p2 = latched ? 1 : 0.45 + Math.sin(frame * 0.13 + m.y) * 0.25;
        this.setPx(m.x, m.y - 2, 0.3 * p2, 0.7 * p2, 1.1 * p2);
        this.setPx(m.x - 1, m.y - 3, 0.22 * p2, 0.5 * p2, 0.8 * p2);
        this.setPx(m.x + 1, m.y - 3, 0.22 * p2, 0.5 * p2, 0.8 * p2);
        this.setPx(m.x, m.y - 4, 0.35 * p2, 0.75 * p2, 1.2 * p2);
        if (latched && frame % 9 < 2) this.addPx(m.x, m.y - 5, 0.5, 0.9, 1.4);
      }
      // a broken mechanism strobes a dying red cross while it groans
      if (m.broken !== undefined && m.broken > 0 && frame % 20 < 10) {
        const sh = frame % 4 < 2 ? -1 : 1;
        this.addPx(m.x + sh, m.y - 4, 0.9, 0.12, 0.08);
        this.addPx(m.x - 1 + sh, m.y - 3, 0.5, 0.07, 0.04);
        this.addPx(m.x + 1 + sh, m.y - 5, 0.5, 0.07, 0.04);
        this.addPx(m.x + 1 + sh, m.y - 3, 0.5, 0.07, 0.04);
        this.addPx(m.x - 1 + sh, m.y - 5, 0.5, 0.07, 0.04);
      }
    }

    for (const v of runtime.runeVaults) {
      if (v.rx < camX - 8 || v.rx > camX + VIEW_W + 8 || v.ry < camY - 8 || v.ry > camY + VIEW_H + 8)
        continue;
      const p = v.active ? 0.9 : 0.55 + Math.sin(frame * 0.07 + v.rx) * 0.35;
      const cr = v.active ? 0.2 * bst * p : 0.7 * bst * p;
      const cg = v.active ? 0.9 * bst * p : 0.25 * bst * p;
      const cb = v.active ? 0.4 * bst * p : 0.95 * bst * p;
      // a small floating glyph above the pedestal
      this.setPx(v.rx, v.ry, cr, cg, cb);
      this.setPx(v.rx - 1, v.ry + 1, cr * 0.7, cg * 0.7, cb * 0.7);
      this.setPx(v.rx + 1, v.ry + 1, cr * 0.7, cg * 0.7, cb * 0.7);
      this.setPx(v.rx, v.ry - 1, cr * 0.8, cg * 0.8, cb * 0.8);
      this.setPx(v.rx, v.ry + 2, cr * 0.5, cg * 0.5, cb * 0.5);
    }
  }

  /** Bobbing treasure glyphs + the swirling exit gate (all self-lit). */
  private drawPickupsAndPortal(ctx: Ctx): void {
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play') return;
    const frame = ctx.state.frameCount;

    for (const p of runtime.pickups) {
      if (p.taken) continue;
      const bob = Math.sin(frame * 0.08 + p.x * 0.7) * 1.4;
      const x = Math.round(p.x);
      const y = Math.round(p.y + bob) - 2;
      const c = PICKUP_COLOR[p.kind];
      const r = ((c >> 16) & 0xff) / 255;
      const g = ((c >> 8) & 0xff) / 255;
      const b = (c & 0xff) / 255;
      const pulse = 0.8 + Math.sin(frame * 0.12 + p.y) * 0.25;
      if (p.kind === 'chest') {
        // squat banded coffer; the lid twitches when the alchemist is close
        const near =
          (ctx.player.x - p.x) * (ctx.player.x - p.x) + (ctx.player.y - p.y) * (ctx.player.y - p.y) < 44 * 44;
        const lid = near && frame % 40 < 8 ? -1 : 0;
        for (let dx = -2; dx <= 2; dx++) {
          this.setPx(x + dx, y + lid, r * 0.8, g * 0.8, b * 0.8);
          this.setPx(x + dx, y + 1, r * 0.55, g * 0.5, b * 0.4);
        }
        this.setPx(x, y + lid, 1.2, 1.1, 0.5); // clasp glint
      } else if (p.kind === 'key') {
        // bright sparkling key; its bow twitches like it wants the portal
        const twitch = frame % 50 < 6 ? Math.round(Math.sin(frame * 1.7)) : 0;
        const dir = runtime.portal && runtime.portal.x < p.x ? -1 : 1;
        this.setPx(x - dir + twitch, y - 1, r * pulse * 1.5, g * pulse * 1.45, b * pulse * 0.8);
        this.setPx(x + twitch, y - 1, r * pulse * 1.5, g * pulse * 1.45, b * pulse * 0.8);
        for (let s = 0; s < 4; s++) this.setPx(x + dir * s + twitch, y, r * pulse * 1.35, g * pulse * 1.3, b * 0.7);
        this.setPx(x + dir * 3 + twitch, y + 1, r, g * 0.9, b * 0.45);
        if (frame % 14 < 3) this.addPx(x + dir * 4, y - 2, 0.8, 0.8, 0.6);
      } else if (p.kind === 'heart') {
        // double-beat heart: a quick lub-dub instead of a generic bobbing gem
        const beat = (frame + Math.floor(p.x)) % 70;
        const thump = beat < 6 || (beat > 13 && beat < 19) ? 1.35 : 1.0;
        this.setPx(x - 1, y - 1, r * thump, g * 0.7 * thump, b * 0.8 * thump);
        this.setPx(x + 1, y - 1, r * thump, g * 0.7 * thump, b * 0.8 * thump);
        this.setPx(x - 2, y, r * 0.9 * thump, g * 0.45 * thump, b * 0.55 * thump);
        this.setPx(x, y, r * 1.4 * thump, g * 0.75 * thump, b * 0.8 * thump);
        this.setPx(x + 2, y, r * 0.9 * thump, g * 0.45 * thump, b * 0.55 * thump);
        this.setPx(x, y + 1, r * 0.85 * thump, g * 0.35 * thump, b * 0.45 * thump);
      } else if (p.kind === 'tome') {
        // page flutter: the spell book is awake before you pick it up
        const flip = Math.sin(frame * 0.18 + p.x) > 0 ? 1 : 0;
        this.setPx(x - 2, y, r * 0.55, g * 0.65, b * 0.8);
        this.setPx(x - 1, y - flip, r * pulse, g * pulse, b * pulse);
        this.setPx(x, y, 0.08, 0.12, 0.22);
        this.setPx(x + 1, y - (1 - flip), r * pulse, g * pulse, b * pulse);
        this.setPx(x + 2, y, r * 0.45, g * 0.55, b * 0.75);
        if (frame % 24 < 4) this.addPx(x, y - 2, 0.16, 0.28, 0.45);
      } else if (p.kind === 'potion') {
        // tiny flask: glass outline, colored liquid sloshing one cell side to side
        const slosh = Math.round(Math.sin(frame * 0.15 + p.x));
        this.setPx(x, y - 2, 0.65, 0.82, 0.95);
        this.setPx(x - 1, y - 1, 0.45, 0.6, 0.75);
        this.setPx(x + 1, y - 1, 0.45, 0.6, 0.75);
        this.setPx(x - 1, y, r * pulse, g * pulse, b * pulse);
        this.setPx(x + slosh, y, r * pulse * 1.3, g * pulse * 1.3, b * pulse * 1.3);
        this.setPx(x + 1, y, r * 0.7, g * 0.7, b * 0.7);
        this.addPx(x - slosh, y - 1, 0.1, 0.13, 0.16);
      } else if (p.kind === 'goldpile') {
        // coin tumble: a tiny pile flashes edge-on every few frames
        const spin = (frame + Math.floor(p.x)) % 24;
        const narrow = spin < 5 || spin > 18;
        const hw = narrow ? 1 : 2;
        for (let dx = -hw; dx <= hw; dx++) this.setPx(x + dx, y, r * pulse * 1.3, g * pulse * 1.15, b * 0.7);
        this.setPx(x - 1, y + 1, r * 0.7, g * 0.5, b * 0.22);
        this.setPx(x + 1, y + 1, r * 0.8, g * 0.55, b * 0.25);
      } else {
        // diamond glyph (heart/tome/potion/goldpile)
        this.setPx(x, y, r * pulse * 1.4, g * pulse * 1.4, b * pulse * 1.4);
        this.setPx(x + 1, y, r * pulse * 0.8, g * pulse * 0.8, b * pulse * 0.8);
        this.setPx(x - 1, y, r * pulse * 0.8, g * pulse * 0.8, b * pulse * 0.8);
        this.setPx(x, y - 1, r * pulse * 0.9, g * pulse * 0.9, b * pulse * 0.9);
        this.setPx(x, y + 1, r * pulse * 0.6, g * pulse * 0.6, b * pulse * 0.6);
      }
    }

    const portal = runtime.portal;
    if (portal) {
      const pdx = ctx.player.x - portal.x,
        pdy = ctx.player.y - 6 - portal.y;
      const near = pdx * pdx + pdy * pdy < 70 * 70;
      const lit = runtime.keyTaken ? (near ? 2.0 : 1.6) : near ? 0.75 : 0.5;
      const ringR = 6 + (runtime.keyTaken ? Math.sin(frame * 0.08) * 0.7 : frame % 120 < 8 ? 1 : 0);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2 + frame * (runtime.keyTaken ? 0.065 : 0.025);
        const twitch = runtime.keyTaken ? 0 : Math.sin(frame * 0.11 + k) * 0.7;
        const px = Math.round(portal.x + Math.cos(a) * (ringR + twitch));
        const py = Math.round(portal.y - 4 + Math.sin(a) * (ringR + 2));
        const tw = 0.6 + Math.sin(frame * 0.2 + k) * 0.4;
        this.setPx(px, py, 0.55 * lit * tw, 0.18 * lit * tw, 0.95 * lit * tw);
      }
      if (runtime.keyTaken && near) {
        this.drawDottedLine(ctx.player.x, ctx.player.y - 8, portal.x, portal.y - 4, 9, (frame % 18) / 18, 0.16, 0.05, 0.28);
      }
      if (runtime.keyTaken && frame % 3 === 0) {
        this.addPx(
          portal.x + Math.round((Math.random() - 0.5) * 8),
          portal.y - 4 + Math.round((Math.random() - 0.5) * 10),
          0.3,
          0.1,
          0.5,
        );
      }
    }
  }
}

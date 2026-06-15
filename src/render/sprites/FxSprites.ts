import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { Cell } from '@/sim/CellType';
import { unpackB, unpackG, unpackR } from '@/sim/colors';

/**
 * Combat-FX overlays — ballistic particles, lightning arcs, projectiles, and
 * the excavation beam — as standalone sprite functions (the PlayerSprite /
 * EnemySprites pattern). FrameComposer composes these into the frame; the
 * Builder gallery draws them onto its stage so spell previews run the SAME
 * code the game runs. Moved verbatim from FrameComposer.composeOverlays.
 */

/** Ballistic debris / embers / coins. Glowing motes are self-lit; the rest sample the light field. */
export function drawParticles(s: PixelSurface, light: LightField, ctx: Ctx): void {
  for (const fp of ctx.particles.list) {
    const glow = fp.glow;
    if (glow > 0) {
      s.setPx(
        fp.x,
        fp.y,
        (unpackR(fp.color) / 255) * glow,
        (unpackG(fp.color) / 255) * glow,
        (unpackB(fp.color) / 255) * glow,
      );
    } else {
      const lt = light.sample(fp.x, fp.y);
      s.setPx(
        fp.x,
        fp.y,
        (unpackR(fp.color) / 255) * lt.r,
        (unpackG(fp.color) / 255) * lt.g,
        (unpackB(fp.color) / 255) * lt.b,
      );
    }
  }
}

/** Lightning arcs: white-hot core. */
export function drawLightningArcs(s: PixelSurface, ctx: Ctx): void {
  const boost = ctx.params.global.maxBrightness;
  for (const arc of ctx.lightning.arcs) {
    const k = (arc.life / 8) * arc.intensity * boost * 1.3;
    for (const pt of arc.pts) {
      s.setPx(pt.x, pt.y, 0.9 * k, 0.97 * k, 1.0 * k);
      s.setPx(pt.x, pt.y - 1, 0.35 * k, 0.55 * k, 0.8 * k);
    }
  }
}

/** Every live projectile, drawn per-type (bolt trails, fuses, singularities...). */
export function drawProjectiles(s: PixelSurface, ctx: Ctx): void {
  const world = ctx.world;
  const frameCount = ctx.state.frameCount;
  const boost = ctx.params.global.maxBrightness;
  for (const p of ctx.projectiles) {
    const gx = Math.floor(p.x),
      gy = Math.floor(p.y);
    if (world.inBounds(gx, gy)) {
      if (p.type === 'bolt') {
        const nx = p.vx / (Math.abs(p.vx) + Math.abs(p.vy) + 0.001),
          ny = p.vy / (Math.abs(p.vx) + Math.abs(p.vy) + 0.001);
        s.setPx(gx, gy, 0.4 * boost, 0.95 * boost, 1.0 * boost);
        s.setPx(gx - nx * 2, gy - ny * 2, 0.0, 0.55 * boost, 0.75 * boost);
        s.setPx(gx - nx * 4, gy - ny * 4, 0.0, 0.28 * boost, 0.42 * boost);
        s.setPx(gx - nx * 6, gy - ny * 6, 0.0, 0.12 * boost, 0.2 * boost);
      } else if (p.type === 'bomb') {
        const fuse = p.life < 30 && frameCount % 8 < 4 ? 1.8 : 1.0;
        s.setPx(gx, gy, 0.16, 0.17, 0.22);
        s.setPx(gx + 1, gy, 0.16, 0.17, 0.22);
        s.setPx(gx, gy - 1, 0.24, 0.26, 0.32);
        s.setPx(gx + 1, gy - 1, 0.16, 0.17, 0.22);
        s.setPx(gx, gy - 2, 1.0 * boost * fuse * 0.4, 0.65 * boost * fuse * 0.4, 0.1);
      } else if (p.type === 'warp') {
        const nx = p.vx / (Math.abs(p.vx) + Math.abs(p.vy) + 0.001),
          ny = p.vy / (Math.abs(p.vx) + Math.abs(p.vy) + 0.001);
        s.setPx(gx, gy, 0.85 * boost, 0.55 * boost, 1.0 * boost);
        s.setPx(gx - nx * 2, gy - ny * 2, 0.55 * boost, 0.3 * boost, 0.8 * boost);
        s.setPx(gx - nx * 4, gy - ny * 4, 0.3 * boost, 0.12 * boost, 0.5 * boost);
        if (frameCount % 2 === 0)
          s.setPx(
            gx + ((Math.random() * 3) | 0) - 1,
            gy + ((Math.random() * 3) | 0) - 1,
            0.5,
            0.25,
            0.7,
          );
      } else if (p.type === 'fireball') {
        const fl = 0.8 + Math.random() * 0.5;
        s.setPx(gx, gy, 1.0 * boost * fl, 0.45 * boost * fl, 0.05);
        s.setPx(gx + 1, gy, 0.9 * boost * fl, 0.35 * boost * fl, 0.04);
        s.setPx(gx, gy - 1, 0.85 * fl, 0.3 * fl, 0.03);
        s.setPx(gx + 1, gy - 1, 0.7 * fl, 0.22 * fl, 0.02);
      } else if (p.type === 'frostbolt') {
        // 2x2 pale-cyan core with a small additive halo
        const fl = 0.8 + Math.random() * 0.35;
        s.setPx(gx, gy, 0.55 * boost * fl, 0.9 * boost * fl, 1.0 * boost * fl);
        s.setPx(gx + 1, gy, 0.45 * boost * fl, 0.8 * boost * fl, 0.95 * boost * fl);
        s.setPx(gx, gy - 1, 0.45 * fl, 0.8 * fl, 0.95 * fl);
        s.setPx(gx + 1, gy - 1, 0.35 * fl, 0.65 * fl, 0.85 * fl);
        s.addPx(gx - 1, gy, 0.05, 0.16, 0.24);
        s.addPx(gx + 2, gy, 0.05, 0.16, 0.24);
        s.addPx(gx, gy + 1, 0.05, 0.16, 0.24);
        s.addPx(gx, gy - 2, 0.05, 0.16, 0.24);
      } else if (p.type === 'iceshard' || p.type === 'icelance') {
        // Pale crystal dart; the lance trails extra segments along its flight line
        const fl = 0.85 + Math.random() * 0.3;
        const seg = p.type === 'icelance' ? 3 : 1;
        const spd = Math.hypot(p.vx, p.vy) || 1;
        for (let sgi = 0; sgi <= seg; sgi++) {
          const lx = gx - Math.round((p.vx / spd) * sgi);
          const ly = gy - Math.round((p.vy / spd) * sgi);
          const fade = 1 - sgi / (seg + 1);
          s.setPx(
            lx,
            ly,
            0.5 * boost * fl * fade,
            0.85 * boost * fl * fade,
            1.0 * boost * fl * fade,
          );
        }
        s.addPx(gx, gy - 1, 0.06, 0.14, 0.22);
        s.addPx(gx, gy + 1, 0.06, 0.14, 0.22);
      } else if (p.type === 'pellet') {
        const fl = 0.8 + Math.random() * 0.4;
        s.setPx(gx, gy, 0.35 * boost * fl, 0.85 * boost * fl, 1.0 * boost * fl);
        s.addPx(gx + 1, gy, 0.05, 0.14, 0.2);
      } else if (p.type === 'wisp') {
        // A guttering self-lit mote with an orbiting glint
        const fl = 0.9 + Math.random() * 0.5;
        s.setPx(gx, gy, 0.35 * boost * fl, 0.95 * boost * fl, 1.1 * boost * fl);
        const oa = frameCount * 0.35;
        s.addPx(
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
            if (hot) s.setPx(gx + dx, gy + dy, 1.3 * boost, 0.5 * boost, 0.08);
            else s.setPx(gx + dx, gy + dy, 0.25, 0.12, 0.08);
          }
        s.addPx(gx, gy - 2, 0.3, 0.12, 0.02);
      } else if (p.type === 'acidglob') {
        const fl = 0.75 + Math.random() * 0.3;
        s.setPx(gx, gy, 0.15 * fl, 0.8 * boost * fl, 0.12 * fl);
        s.setPx(gx, gy - 1, 0.1 * fl, 0.6 * fl, 0.08 * fl);
        s.addPx(gx + 1, gy, 0.03, 0.16, 0.03);
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
              s.setPx(rx, ry, 0.01, 0.0, 0.03); // event horizon: near-black core
            } else if (d2 <= rim2) {
              const swirl = 0.7 + Math.sin(frameCount * 0.25 + Math.atan2(dy, dx) * 3) * 0.3;
              s.setPx(rx, ry, 0.6 * boost * swirl, 0.1 * boost * swirl, 1.0 * boost * swirl);
            }
          }
        }
      }
    }
  }
}

/** Excavation beam: white-hot core, tight amber sheath, light cast onto nearby rock. */
export function drawDigBeam(s: PixelSurface, ctx: Ctx): void {
  const digBeam = ctx.fx.digBeam;
  if (!digBeam || digBeam.life <= 0) return;
  const world = ctx.world;
  // (life is decremented by Game at the frame tail — approved deviation 7)
  const dxL = digBeam.x1 - digBeam.x0,
    dyL = digBeam.y1 - digBeam.y0;
  const lenL = Math.hypot(dxL, dyL) || 1;
  const steps = Math.max(2, Math.floor(lenL));
  const pxn = -dyL / lenL,
    pyn = dxL / lenL; // beam-perpendicular
  const bb = ctx.params.global.maxBrightness * 0.55;
  for (let st = 0; st <= steps; st++) {
    const t = st / steps;
    const bxp = digBeam.x0 + dxL * t;
    const byp = digBeam.y0 + dyL * t;
    const w = 0.75 + Math.random() * 0.35;
    s.setPx(bxp, byp, 1.15 * bb * w, 0.85 * bb * w, 0.3 * bb * w);
    // tight falloff sheath, one pixel either side
    s.addPx(bxp + pxn, byp + pyn, 0.16 * bb * w, 0.1 * bb * w, 0.02);
    s.addPx(bxp - pxn, byp - pyn, 0.16 * bb * w, 0.1 * bb * w, 0.02);
  }
  // white-hot cutting point + sputtering sparks
  s.setPx(digBeam.x1, digBeam.y1, 1.6 * bb, 1.4 * bb, 0.9 * bb);
  s.setPx(
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
      if (!world.inBounds(wxg, wyg) || world.types[world.idx(wxg, wyg)] === Cell.Empty) continue;
      const fall = 1 - Math.sqrt(d2) / GR;
      const lum = fall * fall * 0.55;
      s.addPx(wxg, wyg, lum * 1.0, lum * 0.66, lum * 0.18);
    }
  }
}

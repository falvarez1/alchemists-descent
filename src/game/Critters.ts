import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import type { Critter, CritterKind, CrittersApi, Ctx } from '@/core/types';
import { EntityPool } from '@/entities/ecs';
import { blocksEntity, Cell, isLiquid, isSolid } from '@/sim/CellType';
import { packRGB, waterColor } from '@/sim/colors';

/**
 * Wave F "The Caves Breathe": the critter layer + ambient cave biology.
 *
 * Harmless life that lives indifferently to the player: moths steered by
 * light, fireflies pulsing in the gloom, fish in real water, beetles that
 * graze the fungus, flies over old blood. Plus the grid writing back —
 * ceiling drips into pools, ember falls in lava caves, spore drift, dust
 * motes, heal-spring bubbles — and the quiet sounds of all of it.
 *
 * Critters are transient ambience: spawned near the camera from local cell
 * context, despawned when far, never saved. The caves simply always have
 * them, the way caves do.
 */

const CAPS: Record<CritterKind, number> = { moth: 6, firefly: 8, fish: 6, beetle: 4, fly: 5 };

/** Cells that read as "glow" to a moth (sampled, not the light field). */
function isLure(t: number): boolean {
  return (
    t === Cell.Fire ||
    t === Cell.Lava ||
    t === Cell.Ember ||
    t === Cell.Glowshroom ||
    t === Cell.Crystal
  );
}

export class Critters implements CrittersApi {
  private readonly pool = new EntityPool<Critter>();
  readonly list = this.pool.list;

  constructor(ctx: Ctx) {
    ctx.events.on('structureStrike', ({ x, y, radius }) =>
      this.killAt(ctx, x, y, radius + 4),
    );
    // entering a new depth scatters the old fauna
    ctx.events.on('levelChanged', () => {
      this.clear();
    });
  }

  killAt(ctx: Ctx, x: number, y: number, radius: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const dx = c.x - x,
        dy = c.y - y;
      if (dx * dx + dy * dy <= radius * radius) {
        ctx.particles.burst(c.x, c.y, 3, null, () => packRGB(120, 110, 90), 0.9, {
          grav: 0.05,
        });
        this.removeAt(i);
      }
    }
  }

  remove(critter: Critter): Critter | undefined {
    return this.pool.remove(critter);
  }

  clear(): void {
    this.pool.clear();
  }

  private removeAt(index: number): Critter | undefined {
    return this.pool.removeAt(index);
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.state.paused) return;
    const frame = ctx.state.frameCount;

    if (frame % 30 === 0) this.trySpawn(ctx);
    this.updateCritters(ctx);
    this.ambientGrid(ctx, frame);
    if (frame % 90 === 0) this.ambientAudio(ctx);
  }

  /* ---------------- spawning: life grows out of local context ---------------- */

  private trySpawn(ctx: Ctx): void {
    const w = ctx.world;
    const camX = Math.floor(ctx.camera.x),
      camY = Math.floor(ctx.camera.y);
    const counts: Record<CritterKind, number> = { moth: 0, firefly: 0, fish: 0, beetle: 0, fly: 0 };
    for (const c of this.list) counts[c.kind]++;

    // Despawn the far-drifted (margin well past the view)
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (
        c.x < camX - 160 ||
        c.x > camX + VIEW_W + 160 ||
        c.y < camY - 160 ||
        c.y > camY + VIEW_H + 160
      )
        this.removeAt(i);
    }

    // A few placement attempts per tick; each spawns at most one critter.
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = camX + Math.floor(Math.random() * VIEW_W);
      const y = camY + Math.floor(Math.random() * VIEW_H);
      if (x < 6 || y < 20 || x >= WIDTH - 6 || y >= HEIGHT - 10) continue;
      const i = w.idx(x, y);
      const t = w.types[i];
      const biome = ctx.state.currentBiome;

      if (isLiquid(t) && t === Cell.Water && counts.fish < CAPS.fish) {
        // fish want depth: two more water cells below
        if (
          w.types[w.idx(x, y + 1)] === Cell.Water &&
          w.types[w.idx(x, y + 2)] === Cell.Water
        ) {
          this.add('fish', x, y);
          counts.fish++;
          continue;
        }
      }
      if (t === Cell.Empty) {
        if (t === Cell.Empty && w.types[w.idx(x, y + 1)] === Cell.Blood && counts.fly < CAPS.fly) {
          this.add('fly', x, y - 1);
          counts.fly++;
          continue;
        }
        if (
          counts.beetle < CAPS.beetle &&
          isSolid(w.types[w.idx(x, y + 1)]) &&
          Math.random() < 0.35
        ) {
          // beetles prefer fungus country but wander everywhere damp
          this.add('beetle', x, y);
          counts.beetle++;
          continue;
        }
        if (
          counts.firefly < CAPS.firefly &&
          (biome === 'fungal' || biome === 'timber' || biome === 'earthen' || biome === 'flooded') &&
          Math.random() < 0.5
        ) {
          this.add('firefly', x, y);
          counts.firefly++;
          continue;
        }
        if (counts.moth < CAPS.moth) {
          this.add('moth', x, y);
          counts.moth++;
        }
      }
    }
  }

  private add(kind: CritterKind, x: number, y: number): void {
    this.pool.add({
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      phase: Math.random() * Math.PI * 2,
      gasp: 0,
      facing: Math.random() < 0.5 ? -1 : 1,
    });
  }

  /* ---------------- behavior ---------------- */

  private updateCritters(ctx: Ctx): void {
    const w = ctx.world;
    const player = ctx.player;
    for (let idx = this.list.length - 1; idx >= 0; idx--) {
      const c = this.list[idx];
      c.phase += 0.13;
      const xi = Math.floor(c.x),
        yi = Math.floor(c.y);
      if (!w.inBounds(xi, yi)) {
        this.removeAt(idx);
        continue;
      }
      const here = w.types[w.idx(xi, yi)];

      // The small things die to heat and corrosion like everything else
      if (here === Cell.Fire || here === Cell.Lava || here === Cell.Acid || here === Cell.Toxic) {
        ctx.particles.burst(c.x, c.y, 3, null, () => packRGB(140, 120, 80), 1.0, { grav: 0.04 });
        this.removeAt(idx);
        continue;
      }

      if (c.kind === 'moth') {
        // flutter + LIGHT SEEKING: glow cells nearby, else the raised wand
        c.vx += Math.sin(c.phase * 1.7) * 0.04 + (Math.random() - 0.5) * 0.05;
        c.vy += Math.cos(c.phase * 1.3) * 0.035 + (Math.random() - 0.5) * 0.05;
        let lured = false;
        for (let s = 0; s < 6 && !lured; s++) {
          const sx = xi + Math.floor(Math.random() * 41) - 20;
          const sy = yi + Math.floor(Math.random() * 41) - 20;
          if (w.inBounds(sx, sy) && isLure(w.types[w.idx(sx, sy)])) {
            c.vx += Math.sign(sx - c.x) * 0.05;
            c.vy += Math.sign(sy - c.y) * 0.05;
            lured = true;
          }
        }
        if (!lured && !player.dead) {
          const dx = player.x + Math.cos(player.aimAngle) * 9 - c.x;
          const dy = player.y - 9 + Math.sin(player.aimAngle) * 9 - c.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 100 * 100 && d2 > 12 * 12) {
            c.vx += (dx / Math.sqrt(d2)) * 0.045;
            c.vy += (dy / Math.sqrt(d2)) * 0.045;
          }
        }
        c.vx *= 0.93;
        c.vy *= 0.93;
      } else if (c.kind === 'firefly') {
        c.vx += (Math.random() - 0.5) * 0.03;
        c.vy += (Math.random() - 0.5) * 0.025 - Math.sin(c.phase * 0.5) * 0.004;
        c.vx *= 0.96;
        c.vy *= 0.96;
      } else if (c.kind === 'fish') {
        if (here === Cell.Water || isLiquid(here)) {
          c.gasp = 0;
          // cruise + flee the splashing alchemist
          const pdx = c.x - player.x,
            pdy = c.y - player.y;
          const close = !player.dead && pdx * pdx + pdy * pdy < 30 * 30;
          c.vx += (close ? Math.sign(pdx) * 0.12 : Math.sin(c.phase * 0.4) * 0.02);
          c.vy += (Math.random() - 0.5) * 0.02;
          // stay submerged: nudge down if surface is right above
          if (w.inBounds(xi, yi - 1) && w.types[w.idx(xi, yi - 1)] === Cell.Empty) c.vy += 0.04;
          c.vx *= 0.94;
          c.vy *= 0.9;
          if (Math.abs(c.vx) > 0.05) c.facing = Math.sign(c.vx);
        } else {
          // beached: flop, gasp, and eventually a sad little end
          c.gasp++;
          c.vy += 0.18;
          if (c.gasp % 22 === 0) c.vy = -1.4 - Math.random();
          if (c.gasp > 260) {
            ctx.particles.burst(c.x, c.y, 4, Cell.Blood, () => packRGB(180, 40, 50), 1.1);
            this.removeAt(idx);
            continue;
          }
        }
      } else if (c.kind === 'beetle') {
        // ground crawler: walks, turns at walls/ledges, grazes the fungus
        c.vy += 0.2;
        const ahead = w.inBounds(xi + c.facing, yi)
          ? w.types[w.idx(xi + c.facing, yi)]
          : Cell.Wall;
        const footing = w.inBounds(xi, yi + 1) ? blocksEntity(w.types[w.idx(xi, yi + 1)]) : false;
        if (footing) {
          c.vy = 0;
          if (blocksEntity(ahead)) c.facing *= -1;
          else if (Math.random() < 0.015) c.facing *= -1;
          c.vx = c.facing * 0.12;
          // grazing: nibble adjacent fungus/moss (visible ecology)
          if (Math.random() < 0.004) {
            for (const [ddx, ddy] of [
              [1, 0],
              [-1, 0],
              [0, -1],
              [c.facing, 1],
            ]) {
              const ti = w.idx(xi + ddx, yi + ddy);
              const tt = w.types[ti];
              if (tt === Cell.Fungus || tt === Cell.Moss) {
                w.types[ti] = Cell.Empty;
                w.colors[ti] = 0x08080c;
                ctx.particles.burst(xi + ddx, yi + ddy, 2, null, () => packRGB(90, 160, 80), 0.6);
                break;
              }
            }
          }
        } else {
          c.vx *= 0.8;
        }
      } else if (c.kind === 'fly') {
        // tight nervous orbit above the blood that drew it
        c.vx += Math.sin(c.phase * 3.1) * 0.08 + (Math.random() - 0.5) * 0.1;
        c.vy += Math.cos(c.phase * 2.7) * 0.07;
        c.vx *= 0.86;
        c.vy *= 0.86;
      }

      // integrate, refusing to pass into solid cells (slide instead)
      const nx = c.x + c.vx,
        ny = c.y + c.vy;
      if (w.inBounds(Math.floor(nx), yi) && !blocksEntity(w.types[w.idx(Math.floor(nx), yi)]))
        c.x = nx;
      else c.vx *= -0.5;
      if (w.inBounds(xi, Math.floor(ny)) && !blocksEntity(w.types[w.idx(xi, Math.floor(ny))]))
        c.y = ny;
      else c.vy *= -0.5;
    }
  }

  /* ---------------- the grid writes back ---------------- */

  private ambientGrid(ctx: Ctx, frame: number): void {
    const w = ctx.world;
    const camX = Math.floor(ctx.camera.x),
      camY = Math.floor(ctx.camera.y);
    const biome = ctx.state.currentBiome;

    // CEILING DRIPS: an overhang above open air sheds a real water droplet
    // (volcanic caves shed ember sparks instead; frozen caves stay silent)
    if (frame % 9 === 0) {
      const x = camX + Math.floor(Math.random() * VIEW_W);
      let solidY = -1;
      for (let y = camY + 4; y < camY + VIEW_H - 30 && y < HEIGHT - 12; y++) {
        if (!w.inBounds(x, y)) break;
        const t = w.types[w.idx(x, y)];
        if (t === Cell.Wall || t === Cell.Stone) solidY = y;
        else if (solidY > 0 && t === Cell.Empty) break;
        else solidY = -1;
      }
      if (solidY > 0 && w.types[w.idx(x, solidY + 1)] === Cell.Empty) {
        if (biome === 'volcanic' || biome === 'scorched') {
          if (Math.random() < 0.12) {
            ctx.particles.spawn(x, solidY + 1, 0, 0.6, null, packRGB(255, 140, 30), 40, {
              glow: 1.8,
              grav: 0.06,
            });
          }
        } else if (Math.random() < 0.2) {
          // only drip where water plausibly seeps: liquid somewhere below
          let poolBelow = false;
          for (let yy = solidY + 2; yy < Math.min(HEIGHT - 8, solidY + 44) && !poolBelow; yy++) {
            const tb = w.types[w.idx(x, yy)];
            if (isLiquid(tb)) poolBelow = true;
            else if (blocksEntity(tb)) break;
          }
          if (poolBelow) {
            const di = w.idx(x, solidY + 1);
            w.types[di] = Cell.Water;
            w.colors[di] = waterColor();
            if (Math.random() < 0.3) ctx.audio.drip();
          }
        }
      }
    }

    // SPORE DRIFT: glowing motes loosed wherever colonies grow
    if (frame % 6 === 0) {
      const x = camX + Math.floor(Math.random() * VIEW_W);
      const y = camY + Math.floor(Math.random() * VIEW_H);
      if (w.inBounds(x, y) && (w.types[w.idx(x, y)] === Cell.Fungus || w.types[w.idx(x, y)] === Cell.Glowshroom)) {
        ctx.particles.spawn(
          x,
          y - 1,
          (Math.random() - 0.5) * 0.15,
          -0.12 - Math.random() * 0.1,
          null,
          packRGB(110, 200, 130),
          120,
          { glow: 0.8, grav: -0.002 },
        );
      }
    }

    // DUST MOTES: unlit specks that only show where light finds them
    if (frame % 14 === 0) {
      const x = camX + Math.floor(Math.random() * VIEW_W);
      const y = camY + Math.floor(Math.random() * VIEW_H);
      if (w.inBounds(x, y) && w.types[w.idx(x, y)] === Cell.Empty) {
        ctx.particles.spawn(
          x,
          y,
          (Math.random() - 0.5) * 0.06,
          0.05 + Math.random() * 0.05,
          null,
          packRGB(150, 145, 130),
          160,
          { grav: 0.0005 },
        );
      }
    }

    // HEAL-SPRING BUBBLES: the pink pools simmer gently
    if (frame % 10 === 0) {
      const x = camX + Math.floor(Math.random() * VIEW_W);
      const y = camY + Math.floor(Math.random() * VIEW_H);
      if (w.inBounds(x, y) && w.types[w.idx(x, y)] === Cell.Healium) {
        ctx.particles.spawn(x, y - 1, 0, -0.3 - Math.random() * 0.2, null, packRGB(255, 170, 205), 30, {
          glow: 1.2,
          grav: -0.01,
        });
        if (Math.random() < 0.15) ctx.audio.bubble();
      }
    }
  }

  /* ---------------- the quiet sounds of all of it ---------------- */

  private ambientAudio(ctx: Ctx): void {
    if (this.list.length === 0) return;
    const c = this.list[Math.floor(Math.random() * this.list.length)];
    const dx = c.x - ctx.player.x,
      dy = c.y - ctx.player.y;
    if (dx * dx + dy * dy > 140 * 140) return;
    if (c.kind === 'moth' || c.kind === 'firefly') {
      if (Math.random() < 0.4) ctx.audio.chirp();
    } else if (c.kind === 'beetle' || c.kind === 'fly') {
      if (Math.random() < 0.5) ctx.audio.skitter();
    }
  }
}

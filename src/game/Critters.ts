import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import type { Critter, CritterKind, CrittersApi, Ctx } from '@/core/types';
import { EntityPool } from '@/entities/ecs';
import { blocksEntity, Cell, isLiquid, isSolid } from '@/sim/CellType';
import { packRGB, waterColor } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';
import { sightClear } from '@/creatures/perception';

/**
 * Wave F "The Caves Breathe": the critter layer + ambient cave biology.
 *
 * Harmless life that lives indifferently to the player: moths steered by
 * light, fireflies pulsing in the gloom, fish in real water, beetles that
 * graze the fungus, flies over old blood. Plus the grid writing back —
 * ceiling drips into pools, ember falls in lava caves, spore drift, dust
 * motes, heal-spring bubbles — and the quiet sounds of all of it.
 *
 * Expeditions keep a finite, saved population with homes and prey identity.
 * Other modes use transient local ambience. Weather remains active in both.
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

/** Hot, dangerous glow that light-SHY critters flee (cf. the moth's lure — the
 *  ambient Glowshroom/Crystal glow is harmless, so it's not a threat here). */
function isHotGlow(t: number): boolean {
  return t === Cell.Fire || t === Cell.Lava || t === Cell.Ember;
}

/** Prey species that skitter from fire and the looming player — the inverse of
 *  the moth's light-seeking (moths and fish have their own rules). */
const LIGHT_SHY: ReadonlySet<CritterKind> = new Set<CritterKind>(['beetle', 'fly', 'firefly']);

export class Critters implements CrittersApi {
  private readonly pool = new EntityPool<Critter>();
  private readonly eventDisposers: Array<() => void> = [];
  readonly list = this.pool.list;

  constructor(ctx: Ctx) {
    this.eventDisposers.push(
      ctx.events.on('structureStrike', ({ x, y, radius }) =>
        this.killAt(ctx, x, y, radius + 4),
      ),
    );
    this.eventDisposers.push(ctx.events.on('levelChanged', () => this.enterHabitat(ctx)));
  }

  private enterHabitat(ctx: Ctx): void {
    this.clear();
    const rt = ctx.levels.current;
    if (!rt) return;
    if (rt.fauna) {
      for (const saved of rt.fauna) this.pool.add({ ...saved });
      return;
    }
    const resident = (kind: CritterKind, x: number, y: number): void => {
      const c = this.add(kind, x, y);
      c.id = `${rt.def.id}-${kind}-${this.list.length}`;
      c.homeX = x; c.homeY = y; c.energy = 1;
    };
    if (rt.def.id === 'd1') {
      for (const [x, y] of [[290, 265], [520, 330], [1180, 342], [1350, 350], [915, 695], [290, 744]]) {
        for (let i = 0; i < 5; i++) resident('firefly', x + Math.sin(i * 1.9) * 22, y + Math.cos(i * 2.3) * 13);
      }
      for (const [x, y] of [[640, 400], [680, 410], [755, 420], [355, 808]]) resident('fish', x, y);
      // The Undertow's failed lamps shelter a finite cave-roach colony. They
      // persist like every resident and visibly abandon their feeding line
      // when the alchemist sweeps wand-light across it.
      for (const [x, y] of [[352, 1007], [374, 1007], [438, 1007], [548, 1007], [576, 1007],
        [692, 1007], [721, 1007], [828, 1007], [872, 1007]]) resident('beetle', x, y);
      for (const [x, y] of [[410, 966], [632, 978], [803, 962]]) resident('fly', x, y);
    } else if (rt.def.depth > 0) {
      // Seed habitats once across the world. Looking away never replaces prey.
      for (let i = 0; i < 180 && this.list.length < 32; i++) {
        const x = 20 + Math.floor(entityRandom() * (WIDTH - 40));
        const y = 25 + Math.floor(entityRandom() * (HEIGHT - 50));
        const type = ctx.world.type(x, y);
        if (type === Cell.Water) resident('fish', x, y);
        else if (type === Cell.Empty) resident(i % 3 ? 'firefly' : 'moth', x, y);
      }
    }
    rt.fauna = this.list.map(c => ({ ...c }));
  }

  dispose(): void {
    for (const dispose of this.eventDisposers.splice(0).reverse()) dispose();
    this.clear();
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

  scatter(x: number, y: number, radius: number, strength: number): void {
    if (radius <= 0 || strength === 0) return;
    const r2 = radius * radius;
    for (const c of this.list) {
      const dx = c.x - x;
      const dy = c.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1;
      const f = (1 - d / radius) * strength;
      c.vx += (dx / d) * f;
      c.vy += (dy / d) * f - f * 0.3; // a touch of lift into the scatter
      c.startle = Math.max(c.startle ?? 0, Math.round(16 + f * 4));
      c.facing = c.vx < 0 ? -1 : 1;
    }
  }

  remove(critter: Critter): Critter | undefined {
    return this.pool.remove(critter);
  }

  spawn(kind: CritterKind, x: number, y: number): Critter {
    return this.add(kind, x, y);
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

    if (!ctx.debug.active && !ctx.levels.current?.fauna && frame % 30 === 0) this.trySpawn(ctx);
    this.updateCritters(ctx); // per-critter debug-freeze gate inside
    if (!ctx.debug.active) {
      this.ambientGrid(ctx, frame);
      this.shedFromShake(ctx);
      if (frame % 90 === 0) this.ambientAudio(ctx);
    }
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
      const x = camX + Math.floor(entityRandom() * VIEW_W);
      const y = camY + Math.floor(entityRandom() * VIEW_H);
      if (x < 6 || y < 20 || x >= WIDTH - 6 || y >= HEIGHT - 10) continue;
      const i = w.idx(x, y);
      const t = w.types[i];
      const biome = ctx.state.currentBiome;

      if (t === Cell.Water && counts.fish < CAPS.fish) {
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
          entityRandom() < 0.35
        ) {
          // beetles prefer fungus country but wander everywhere damp
          this.add('beetle', x, y);
          counts.beetle++;
          continue;
        }
        if (
          counts.firefly < CAPS.firefly &&
          (biome === 'fungal' || biome === 'timber' || biome === 'earthen' || biome === 'flooded') &&
          entityRandom() < 0.5
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

  private add(kind: CritterKind, x: number, y: number): Critter {
    const critter: Critter = {
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      phase: entityRandom() * Math.PI * 2,
      gasp: 0,
      facing: entityRandom() < 0.5 ? -1 : 1,
    };
    this.pool.add(critter);
    return critter;
  }

  /* ---------------- behavior ---------------- */

  private updateCritters(ctx: Ctx): void {
    const w = ctx.world;
    const player = ctx.player;
    for (let idx = this.list.length - 1; idx >= 0; idx--) {
      const c = this.list[idx];
      if (ctx.debug.frozenCritter(c)) continue; // posed/dragged in debug mode
      const far = Math.abs(c.x - player.x) > VIEW_W || Math.abs(c.y - player.y) > VIEW_H;
      if (c.id && far && (ctx.state.frameCount + idx) % 12 !== 0) continue;
      if (c.id && c.homeX !== undefined && c.homeY !== undefined && c.kind !== 'fish') {
        let targetX = c.homeX, targetY = c.homeY;
        for (const lure of ctx.levels.current?.living?.lures ?? []) {
          if (Math.hypot(lure.x - c.x, lure.y - c.y) < 160 && sightClear(w, c.x, c.y, lure.x, lure.y)) {
            targetX = lure.x; targetY = lure.y - 9; break;
          }
        }
        c.vx += Math.max(-0.025, Math.min(0.025, (targetX - c.x) * 0.0007));
        c.vy += Math.max(-0.025, Math.min(0.025, (targetY - c.y) * 0.0007));
        c.energy = Math.max(0.2, Math.min(1, (c.energy ?? 1) + (Math.hypot(targetX - c.x, targetY - c.y) < 25 ? 0.001 : -0.0002)));
        for (const predator of ctx.enemies) {
          if (predator.hp <= 0 || predator.kind !== 'weaver') continue;
          const dx = c.x - predator.x, dy = c.y - predator.y + 8;
          const d = Math.hypot(dx, dy);
          if (d > 1 && d < 42 && sightClear(w, c.x, c.y, predator.x, predator.y - 8)) {
            c.vx += dx / d * 0.06; c.vy += dy / d * 0.06;
          }
        }
      }
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

      // LIGHT-SHY: prey species flinch from fire and the player's looming bulk —
      // it kicks a short flee (carried by the startle branch below), the mirror
      // of the moth's pull. Once they clear the threat radius they settle again.
      if ((c.startle ?? 0) === 0 && LIGHT_SHY.has(c.kind)) {
        let ax = 0, ay = 0, threatened = false;
        if (!player.dead) {
          const pdx = c.x - player.x, pdy = c.y - (player.y - 8);
          const pd2 = pdx * pdx + pdy * pdy;
          if (pd2 > 4 && pd2 < 32 * 32) {
            const pd = Math.sqrt(pd2), k = 1 - pd / 32;
            ax += (pdx / pd) * k; ay += (pdy / pd) * k; threatened = true;
          }
          // The wand is the scene's moving key light. A clear, forward-facing
          // cone makes the dark-corridor colony scatter before the body arrives,
          // so the response reads as sight rather than proximity scripting.
          const aim = player.aimAngle ?? 0;
          const wandX = player.x + Math.cos(aim) * 9;
          const wandY = player.y - 9 + Math.sin(aim) * 9;
          // Ground critters sit on the first solid cell. Aim the visibility ray
          // at their shell instead of their contact point, which is deliberately
          // embedded a fraction into the floor by the collision solver.
          const lightTargetY = c.y - (c.kind === 'beetle' ? 1.5 : 0);
          const wdx = c.x - wandX, wdy = lightTargetY - wandY;
          const wd2 = wdx * wdx + wdy * wdy;
          if (wd2 > 9 && wd2 < 112 * 112) {
            const wd = Math.sqrt(wd2);
            const inBeam = (wdx * Math.cos(aim) + wdy * Math.sin(aim)) / wd > .16;
            if (inBeam && sightClear(w, wandX, wandY, c.x, lightTargetY)) {
              const k = 1 - wd / 112;
              ax += (wdx / wd) * (.65 + k * 1.4);
              ay += (wdy / wd) * (.65 + k * 1.4);
              threatened = true;
            }
          }
        }
        for (let s = 0; s < 4; s++) {
          const sx = xi + ((entityRandom() * 29) | 0) - 14;
          const sy = yi + ((entityRandom() * 29) | 0) - 14;
          if (w.inBounds(sx, sy) && isHotGlow(w.types[w.idx(sx, sy)])) {
            const ddx = c.x - sx, ddy = c.y - sy, dd = Math.hypot(ddx, ddy) || 1;
            ax += (ddx / dd) * 0.9; ay += (ddy / dd) * 0.9; threatened = true;
          }
        }
        if (threatened) {
          const am = Math.hypot(ax, ay) || 1;
          c.vx += (ax / am) * 0.7;
          c.vy += (ay / am) * 0.7 - 0.3; // a little hop into the scramble
          c.startle = c.kind === 'beetle' ? 18 : 10;
        }
      }

      if ((c.startle ?? 0) > 0) {
        // STARTLED: a concussive shove owns the motion — no seeking, only light
        // damping so the scatter carries (a beetle is blown off its feet and
        // tumbles; a fish in water bolts but the water resists). It flees, panics.
        c.startle = (c.startle ?? 0) - 1;
        const inWater = isLiquid(here);
        if (c.kind === 'fish' && inWater) {
          c.vx *= 0.95;
          c.vy *= 0.95;
        } else {
          c.vy += 0.05; // the blown-airborne (beetle/fish) arc back down
          c.vx *= 0.99;
          c.vy *= 0.99;
        }
        c.facing = c.vx < 0 ? -1 : 1;
        if ((c.startle ?? 0) === 0 && entityRandom() < 0.5) {
          // a tiny puff as it recovers its composure
          ctx.particles.burst(c.x, c.y, 2, null, () => packRGB(150, 140, 110), 0.6, { grav: 0.04 });
        }
      } else if (c.kind === 'moth') {
        // flutter + LIGHT SEEKING: glow cells nearby, else the raised wand
        c.vx += Math.sin(c.phase * 1.7) * 0.04 + (entityRandom() - 0.5) * 0.05;
        c.vy += Math.cos(c.phase * 1.3) * 0.035 + (entityRandom() - 0.5) * 0.05;
        let lured = false;
        for (let s = 0; s < 6 && !lured; s++) {
          const sx = xi + Math.floor(entityRandom() * 41) - 20;
          const sy = yi + Math.floor(entityRandom() * 41) - 20;
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
        c.vx += (entityRandom() - 0.5) * 0.03;
        c.vy += (entityRandom() - 0.5) * 0.025 - Math.sin(c.phase * 0.5) * 0.004;
        c.vx *= 0.96;
        c.vy *= 0.96;
      } else if (c.kind === 'fish') {
        if (isLiquid(here)) {
          c.gasp = 0;
          // cruise + flee the splashing alchemist
          const pdx = c.x - player.x,
            pdy = c.y - player.y;
          const close = !player.dead && pdx * pdx + pdy * pdy < 30 * 30;
          c.vx += (close ? Math.sign(pdx) * 0.12 : Math.sin(c.phase * 0.4) * 0.02);
          c.vy += (entityRandom() - 0.5) * 0.02;
          // stay submerged: nudge down if surface is right above
          if (w.inBounds(xi, yi - 1) && w.types[w.idx(xi, yi - 1)] === Cell.Empty) c.vy += 0.04;
          c.vx *= 0.94;
          c.vy *= 0.9;
          c.vx += w.flow.x(c.x, c.y) * .07;
          c.vy += w.flow.y(c.x, c.y) * .07;
          if (Math.abs(c.vx) > 0.05) c.facing = Math.sign(c.vx);
        } else {
          // beached: flop, gasp, and eventually a sad little end
          c.gasp++;
          c.vy += 0.18;
          if (c.gasp % 22 === 0) c.vy = -1.4 - entityRandom();
          if (c.gasp > 260) {
            ctx.particles.burst(c.x, c.y, 4, Cell.Blood, () => packRGB(180, 40, 50), 1.1);
            ctx.audio.squelch(); // the arc ends audibly, not in silence
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
          else if (entityRandom() < 0.015) c.facing *= -1;
          c.vx = c.facing * 0.12;
          // grazing: nibble adjacent fungus/moss (visible ecology)
          if (entityRandom() < 0.004) {
            for (const [ddx, ddy] of [
              [1, 0],
              [-1, 0],
              [0, -1],
              [c.facing, 1],
            ]) {
              // Guard the neighbor offset (matches every other scan in this file):
              // without it, a beetle at x=0 would idx(-1,yi) into the previous row.
              if (!w.inBounds(xi + ddx, yi + ddy)) continue;
              const ti = w.idx(xi + ddx, yi + ddy);
              const tt = w.types[ti];
              if (tt === Cell.Fungus || tt === Cell.Moss) {
                w.clearCellAt(ti);
                ctx.particles.burst(xi + ddx, yi + ddy, 2, null, () => packRGB(90, 160, 80), 0.6);
                ctx.audio.skitter(); // a faint nibble — the ecology is audible
                break;
              }
            }
          }
        } else {
          c.vx *= 0.8;
        }
      } else if (c.kind === 'fly') {
        // tight nervous orbit above the blood that drew it
        c.vx += Math.sin(c.phase * 3.1) * 0.08 + (entityRandom() - 0.5) * 0.1;
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
    // A persistent habitat must not disable its weather. The player's area,
    // independent of debug-camera panning, owns these local environmental events.
    const camX = Math.max(0, Math.floor(ctx.player.x - VIEW_W / 2)),
      camY = Math.max(0, Math.floor(ctx.player.y - VIEW_H / 2));
    const biome = ctx.state.currentBiome;

    // CEILING DRIPS: an overhang above open air sheds a real water droplet
    // (volcanic caves shed ember sparks instead; frozen caves stay silent)
    if (frame % 9 === 0) {
      const x = camX + Math.floor(entityRandom() * VIEW_W);
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
          if (entityRandom() < 0.12) {
            ctx.particles.spawn(x, solidY + 1, 0, 0.6, null, packRGB(255, 140, 30), 40, {
              glow: 1.8,
              grav: 0.06,
            });
          }
        } else if (entityRandom() < 0.2) {
          // only drip where water plausibly seeps: liquid somewhere below
          let poolBelow = false;
          for (let yy = solidY + 2; yy < Math.min(HEIGHT - 8, solidY + 44) && !poolBelow; yy++) {
            const tb = w.types[w.idx(x, yy)];
            if (isLiquid(tb)) poolBelow = true;
            else if (blocksEntity(tb)) break;
          }
          if (poolBelow) {
            const di = w.idx(x, solidY + 1);
            w.replaceCellAt(di, Cell.Water, waterColor());
            if (entityRandom() < 0.3) ctx.audio.drip();
          }
        }
      }
    }

    // SPORE DRIFT: glowing motes loosed wherever colonies grow
    if (frame % 6 === 0) {
      const x = camX + Math.floor(entityRandom() * VIEW_W);
      const y = camY + Math.floor(entityRandom() * VIEW_H);
      if (w.inBounds(x, y) && (w.types[w.idx(x, y)] === Cell.Fungus || w.types[w.idx(x, y)] === Cell.Glowshroom)) {
        ctx.particles.spawn(
          x,
          y - 1,
          (entityRandom() - 0.5) * 0.15,
          -0.12 - entityRandom() * 0.1,
          null,
          packRGB(110, 200, 130),
          120,
          { glow: 0.8, grav: -0.002 },
        );
      }
    }

    // DUST MOTES: unlit specks that only show where light finds them
    if (frame % 14 === 0) {
      const x = camX + Math.floor(entityRandom() * VIEW_W);
      const y = camY + Math.floor(entityRandom() * VIEW_H);
      if (w.inBounds(x, y) && w.types[w.idx(x, y)] === Cell.Empty) {
        ctx.particles.spawn(
          x,
          y,
          (entityRandom() - 0.5) * 0.06,
          0.05 + entityRandom() * 0.05,
          null,
          packRGB(150, 145, 130),
          160,
          { grav: 0.0005 },
        );
      }
    }

    // HEAL-SPRING BUBBLES: the pink pools simmer gently
    if (frame % 10 === 0) {
      const x = camX + Math.floor(entityRandom() * VIEW_W);
      const y = camY + Math.floor(entityRandom() * VIEW_H);
      if (w.inBounds(x, y) && w.types[w.idx(x, y)] === Cell.Healium) {
        ctx.particles.spawn(x, y - 1, 0, -0.3 - entityRandom() * 0.2, null, packRGB(255, 170, 205), 30, {
          glow: 1.2,
          grav: -0.01,
        });
        if (entityRandom() < 0.15) ctx.audio.bubble();
      }
    }
  }

  /** CONCUSSION SHED: when the cave shakes (a heavy landing, a blast), overhangs
   *  loose dust and grit — real falling motes whose count scales with the shake.
   *  Reads the same screenShake the renderer uses (it decays ~×0.88/frame, so a
   *  big jolt sheds a brief cascade over the next dozen frames). */
  private shedFromShake(ctx: Ctx): void {
    const shake = ctx.fx.screenShake;
    if (shake < 0.015) return;
    const w = ctx.world;
    const camX = Math.floor(ctx.camera.x);
    const camY = Math.floor(ctx.camera.y);
    const tries = Math.min(6, 1 + Math.floor(shake * 60));
    for (let k = 0; k < tries; k++) {
      const x = camX + Math.floor(entityRandom() * VIEW_W);
      // walk down to the lowest ceiling cell that has open air just beneath it
      let solidY = -1;
      for (let y = camY + 2; y < camY + VIEW_H - 8 && y < HEIGHT - 6; y++) {
        if (!w.inBounds(x, y)) break;
        const t = w.types[w.idx(x, y)];
        if (t === Cell.Wall || t === Cell.Stone) solidY = y;
        else if (solidY > 0 && t === Cell.Empty) break;
        else solidY = -1;
      }
      if (solidY > 0 && w.inBounds(x, solidY + 1) && w.types[w.idx(x, solidY + 1)] === Cell.Empty) {
        ctx.particles.spawn(
          x + (entityRandom() - 0.5),
          solidY + 1,
          (entityRandom() - 0.5) * 0.25,
          0.1 + entityRandom() * 0.35,
          null,
          packRGB(118, 110, 98),
          46 + ((entityRandom() * 40) | 0),
          { grav: 0.05 },
        );
      }
    }
  }

  /* ---------------- the quiet sounds of all of it ---------------- */

  private ambientAudio(ctx: Ctx): void {
    if (this.list.length === 0) return;
    const c = this.list[Math.floor(entityRandom() * this.list.length)];
    const dx = c.x - ctx.player.x,
      dy = c.y - ctx.player.y;
    if (dx * dx + dy * dy > 140 * 140) return;
    if (c.kind === 'moth' || c.kind === 'firefly') {
      if (entityRandom() < 0.4) ctx.audio.chirp();
    } else if (c.kind === 'beetle' || c.kind === 'fly') {
      if (entityRandom() < 0.5) ctx.audio.skitter();
    }
  }
}

import { VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx, ExplosionApi } from '@/core/types';
import { Cell, blocksEntity } from '@/sim/CellType';
import { ashColor, crystalColor, fireColor, glassColor, smokeColor } from '@/sim/colors';
import { chargeDeposit } from '@/sim/electrical';

const BLAST_DEBRIS_MARGIN = 8;
const BLAST_DEBRIS_DUST_CAP = 28;
const BLAST_ASH_LIFE_MIN = 70;
const BLAST_ASH_LIFE_SPAN = 70;

const DIR8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function blastConnectivityCell(t: number): boolean {
  return blocksEntity(t);
}

function blastDebrisCell(t: number): boolean {
  return (
    t === Cell.Wall ||
    t === Cell.Wood ||
    t === Cell.Stone ||
    t === Cell.Ice ||
    t === Cell.Crystal ||
    t === Cell.Glass ||
    t === Cell.RawOre ||
    t === Cell.Coal
  );
}

function softenDisconnectedBlastDebris(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  blastTouched: Uint8Array,
): void {
  const world = ctx.world;
  const cleanupR = radius + Math.max(BLAST_DEBRIS_MARGIN, Math.ceil(radius * 0.22));
  const cleanupR2 = cleanupR * cleanupR;
  const minX = Math.max(0, cx - cleanupR);
  const maxX = Math.min(world.width - 1, cx + cleanupR);
  const minY = Math.max(0, cy - cleanupR);
  const maxY = Math.min(world.height - 1, cy + cleanupR);
  const localW = maxX - minX + 1;
  const localH = maxY - minY + 1;
  if (localW <= 0 || localH <= 0) return;

  const localLen = localW * localH;
  const seen = new Uint8Array(localLen);
  const qx = new Int32Array(localLen);
  const qy = new Int32Array(localLen);
  const dxs = new Int32Array(localLen);
  const dys = new Int32Array(localLen);
  const localIdx = (x: number, y: number) => x - minX + (y - minY) * localW;
  const inCleanup = (x: number, y: number): boolean => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= cleanupR2;
  };
  const touchedByBlast = (x: number, y: number): boolean => {
    if (blastTouched[world.idx(x, y)]) return true;
    for (const [ox, oy] of DIR8) {
      const nx = x + ox;
      const ny = y + oy;
      if (world.inBounds(nx, ny) && blastTouched[world.idx(nx, ny)]) return true;
    }
    return false;
  };

  for (let sy = minY; sy <= maxY; sy++) {
    for (let sx = minX; sx <= maxX; sx++) {
      if (!inCleanup(sx, sy)) continue;
      const startLocal = localIdx(sx, sy);
      if (seen[startLocal]) continue;
      const startType = world.types[world.idx(sx, sy)];
      if (!blastConnectivityCell(startType)) continue;

      seen[startLocal] = 1;
      qx[0] = sx;
      qy[0] = sy;
      let head = 0;
      let tail = 1;
      let debrisCount = 0;
      let anchored = startType === Cell.Metal;
      let touched = false;

      while (head < tail) {
        const x = qx[head];
        const y = qy[head];
        head++;
        const wi = world.idx(x, y);
        const t = world.types[wi];
        const insideCleanup = inCleanup(x, y);
        if (!insideCleanup || x === minX || x === maxX || y === minY || y === maxY || t === Cell.Metal) {
          anchored = true;
        }
        if (insideCleanup && touchedByBlast(x, y)) touched = true;
        if (insideCleanup && blastDebrisCell(t)) {
          dxs[debrisCount] = x;
          dys[debrisCount] = y;
          debrisCount++;
        }

        for (const [ox, oy] of DIR8) {
          const nx = x + ox;
          const ny = y + oy;
          if (!world.inBounds(nx, ny)) continue;
          if (nx < minX || nx > maxX || ny < minY || ny > maxY) {
            if (blastConnectivityCell(world.types[world.idx(nx, ny)])) anchored = true;
            continue;
          }
          const ni = localIdx(nx, ny);
          if (seen[ni]) continue;
          if (!blastConnectivityCell(world.types[world.idx(nx, ny)])) continue;
          seen[ni] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }

      if (anchored || !touched || debrisCount === 0) continue;
      let dust = 0;
      for (let n = 0; n < debrisCount; n++) {
        const x = dxs[n];
        const y = dys[n];
        const i = world.idx(x, y);
        world.replaceCellAt(i, Cell.Ash, ashColor());
        world.life[i] = BLAST_ASH_LIFE_MIN + Math.floor(Math.random() * BLAST_ASH_LIFE_SPAN);
        world.moved[i] = world.movedTick;
        if (dust < BLAST_DEBRIS_DUST_CAP && Math.random() < 0.35) {
          dust++;
          const d = Math.hypot(x - cx, y - cy) || 1;
          ctx.particles.spawn(
            x,
            y,
            ((x - cx) / d) * 0.7 + (Math.random() - 0.5) * 0.6,
            ((y - cy) / d) * 0.45 - 0.5 - Math.random() * 0.4,
            Cell.Ash,
            world.colors[i],
            40,
            { grav: 0.08 },
          );
        }
      }
    }
  }
}

/**
 * Explosions. Ported from triggerExplosion (noita-sandbox.html lines 718-800).
 */
export class Explosions implements ExplosionApi {
  constructor(private ctx: Ctx) {}

  trigger(cx: number, cy: number, radius: number, options: { enemyDamageMul?: number; playerDamageSource?: string } = {}): void {
    const ctx = this.ctx;
    const world = ctx.world;
    cx = Math.floor(cx);
    cy = Math.floor(cy);
    radius = Math.floor(radius);
    ctx.shockwaves.push({
      cx: cx,
      cy: cy,
      currentRadius: 0,
      maxRadius: radius * 2.2,
      speed: 3.5,
      strength: 12,
    });
    // Lens kick + shake + boom scale with DISTANCE from the screen's heart:
    // a blast in your face is violent, across the cavern a thud, three
    // screens away nothing. (Quadratic falloff, dead by ~420 cells.)
    const ccx = ctx.camera.x + VIEW_W / 2,
      ccy = ctx.camera.y + VIEW_H / 2;
    const dist = Math.hypot(cx - ccx, cy - ccy);
    const falloff = Math.max(0, 1 - dist / 420);
    const k = falloff * falloff;
    if (k > 0.02) {
      ctx.fx.bloomKick = Math.min(0.95, ctx.fx.bloomKick + radius * 0.026 * k);
      ctx.fx.screenShake = Math.min(ctx.fx.screenShake + radius * 0.0022 * k, 0.045);
      // distant booms arrive smaller, the way thunder does
      ctx.audio.boom(radius * (0.35 + 0.65 * k));
    }
    // Concussion is a valid puzzle input: levers and rune switches listen.
    ctx.events.emit('structureStrike', { x: cx, y: cy, radius: radius + 4 });
    const blastTouched = new Uint8Array(world.types.length);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const nx = cx + dx,
            ny = cy + dy;
          if (!world.inBounds(nx, ny)) continue;
          const ni = world.idx(nx, ny);
          const orig = world.types[ni];
          if (orig !== Cell.Empty) blastTouched[ni] = 1;
          if (orig !== Cell.Metal) {
            // Terrain crumbles fully near the core, raggedly at the rim
            if (
              orig === Cell.Wall &&
              dx * dx + dy * dy > radius * radius * 0.55 &&
              Math.random() < 0.45
            )
              continue;
            // Crystal shatters into a burst of glowing shards
            if (orig === Cell.Crystal && Math.random() < 0.6) {
              const d = Math.sqrt(dx * dx + dy * dy) || 1;
              ctx.particles.spawn(
                nx,
                ny,
                (dx / d) * 2.4 + (Math.random() - 0.5) * 1.6,
                (dy / d) * 2.0 - 1.6 - Math.random(),
                Cell.Crystal,
                crystalColor(),
                110,
                { glow: 1.8 },
              );
            }
            // Launch a fraction of destroyed material as ballistic debris
            if (
              orig !== Cell.Empty &&
              orig !== Cell.Fire &&
              orig !== Cell.Smoke &&
              orig !== Cell.Steam &&
              Math.random() < 0.22
            ) {
              const d = Math.sqrt(dx * dx + dy * dy) || 1;
              const force = (1.2 - d / radius) * 2.6 + Math.random();
              ctx.particles.spawn(
                nx,
                ny,
                (dx / d) * force + (Math.random() - 0.5),
                (dy / d) * force - 1.2 - Math.random(),
                orig,
                world.colors[ni],
                90,
                { glow: orig === Cell.Lava || orig === Cell.Gold ? 1.5 : 0, looseDebris: true },
              );
            }
            if (Math.random() < 0.3) {
              world.replaceCellAt(ni, Cell.Fire, fireColor());
              world.life[ni] = Math.floor(Math.random() * 25) + 10;
            } else if (Math.random() < 0.2) {
              world.replaceCellAt(ni, Cell.Smoke, smokeColor());
              world.life[ni] = Math.floor(Math.random() * 30) + 20;
            } else {
              world.clearCellAt(ni);
            }
            // A visible electrified flash that conducts through adjacent
            // water/metal for several frames, then fades. The base deposit is
            // scaled by chargeStrength (reach) and attenuated by chargeFalloff
            // (spread) / chargeDecay (duration).
            if (Math.random() < 0.4) world.setChargeAt(ni, chargeDeposit(ctx, 8));
          } else {
            // Metal doesn't shatter — but it CONDUCTS. The blast rings a strong
            // current through it that spreads across the connected metal (and up
            // into water sitting on it, and into enemies standing on it), fading
            // over ~1s. Big base deposit → metal carries the current far.
            world.setChargeAt(ni, chargeDeposit(ctx, 60));
          }
        }
      }
    }

    // Sweep the rim: orphaned 1-2 cell specks left by the ragged edge get knocked loose
    const sweepR = radius + 4;
    for (let dy = -sweepR; dy <= sweepR; dy++) {
      for (let dx = -sweepR; dx <= sweepR; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= radius * radius * 0.5 || d2 > sweepR * sweepR) continue;
        const nx = cx + dx,
          ny = cy + dy;
        if (!world.inBounds(nx, ny)) continue;
        const ni = world.idx(nx, ny);
        const t = world.types[ni];
        // Heat fuses sand at the blast rim into glass
        if (t === Cell.Sand && Math.random() < 0.4) {
          blastTouched[ni] = 1;
          world.replaceCellAt(ni, Cell.Glass, glassColor());
          continue;
        }
        if (t === Cell.Empty || t === Cell.Metal || !blocksEntity(t) || ctx.physics.cellBlocks(nx, ny))
          continue;
        if (Math.random() < 0.25) {
          ctx.particles.spawn(
            nx,
            ny,
            (Math.random() - 0.5) * 2.0,
            -0.8 - Math.random(),
            t,
            world.colors[ni],
            70,
          );
        }
        blastTouched[ni] = 1;
        world.clearCellAt(ni);
      }
    }

    // Any blast-isolated crust that no longer connects back to the cave mass
    // becomes soft ash. It stays visible and physical to the sim, but stops
    // pinning the player as a floating post-explosion wall.
    softenDisconnectedBlastDebris(ctx, cx, cy, radius, blastTouched);

    // Sparks fountain for drama
    ctx.particles.burst(cx, cy, Math.min(14, 4 + Math.floor(radius * 0.5)), Cell.Fire, fireColor, 1.8, {
      glow: 2.4,
      grav: 0.1,
    });

    // Entity damage
    for (let i = ctx.enemies.length - 1; i >= 0; i--) {
      const e = ctx.enemies[i];
      const dx = e.x - cx,
        dy = e.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius * 1.6) {
        const dmg = Math.max(4, (1 - d / (radius * 1.6)) * radius * 2.4);
        ctx.enemyCtl.damage(e, dmg * (options.enemyDamageMul ?? 1), (dx / (d || 1)) * 2.2, -1.6);
      }
    }
    if (ctx.state.mode === 'play' && !ctx.player.dead) {
      const dx = ctx.player.x - cx,
        dy = ctx.player.y - 3 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius * 1.5) {
        const dmg = Math.min(42, Math.max(3, (1 - d / (radius * 1.5)) * radius * 2.0));
        ctx.playerCtl.damage(dmg, (dx / (d || 1)) * 2.4, -1.8, options.playerDamageSource ?? 'explosion');
      }
      // The blast wave billows the wizard's cloth (reaches past the damage radius).
      const hat = ctx.player.hat, robe = ctx.player.robe;
      if (hat && robe && d < radius * 2.4) {
        const bn = 1 - d / (radius * 2.4);
        const ux = dx / (d || 1);
        hat.vx += ux * (1.2 + bn * 3.0);
        hat.vy -= 0.8 + bn * 1.8;
        robe.vx += ux * (0.9 + bn * 2.2);
      }
    }
    // Blasts toss loose rigid bodies (crates, debris). Generous reach + a flat
    // base so even a small spark blast gives a satisfying shove, scaling up to a
    // proper launch for bombs.
    ctx.rigidBodies.applyRadialImpulse(cx, cy, radius * 1.8, 2.5 + radius * 0.08);
    ctx.vineStrands?.applyRadialImpulse(cx, cy, radius * 1.8, 1.4 + radius * 0.05);
    // The blast wave scatters any ambient critters it didn't outright incinerate.
    ctx.critters?.scatter(cx, cy, radius * 2.0, 2.0 + radius * 0.06);
  }
}

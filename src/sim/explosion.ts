import { VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx, Enemy, ExplosionApi } from '@/core/types';
import { CELL_COUNT, Cell, blocksEntity, isLiquid } from '@/sim/CellType';
import { ashColor, crystalColor, fireColor, glassColor, packRGB, smokeColor } from '@/sim/colors';
import { chargeDeposit } from '@/sim/electrical';
import { causeForExplosion } from '@/core/alchemyCause';
import { fxRandom, simRandom } from '@/core/simRandom';
import { blastAuthor, bossFuelRect, bossOrganRect } from '@/core/bossWard';

/** Reused blast-carve scratch — see the note at its use site in trigger(). */
let blastTouchedScratch = new Uint8Array(0);

/** Liquids a blast throws instead of unmaking (see trigger): every liquid but
 *  Oil, which is fuel and still catches. */
const DISPLACED_BY_BLAST = new Uint8Array(CELL_COUNT);
for (let t = 0; t < CELL_COUNT; t++) if (isLiquid(t) && t !== Cell.Oil) DISPLACED_BY_BLAST[t] = 1;

/** The most one blast does to a fighter (the cap the player always had); a rival fighter is held to it too (ARENA). */
const FIGHTER_BLAST_CAP = 42;
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
    t === Cell.Mirror ||
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
        world.life[i] = BLAST_ASH_LIFE_MIN + Math.floor(simRandom() * BLAST_ASH_LIFE_SPAN);
        world.moved[i] = world.movedTick;
        if (dust < BLAST_DEBRIS_DUST_CAP && simRandom() < 0.35) {
          dust++;
          const d = Math.hypot(x - cx, y - cy) || 1;
          ctx.particles.spawn(
            x,
            y,
            ((x - cx) / d) * 0.7 + (simRandom() - 0.5) * 0.6,
            ((y - cy) / d) * 0.45 - 0.5 - simRandom() * 0.4,
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
      ctx.audio.boom(radius * (0.35 + 0.65 * k), cx, cy);
    }
    // Concussion is a valid puzzle input: levers and rune switches listen.
    ctx.events.emit('structureStrike', { x: cx, y: cy, radius: radius + 4 });
    // Reused scratch (a fresh grid-sized buffer per blast was ~1.7 MB of GC
    // churn under multicast/chained detonations). Nest-safe: every read/write
    // of this buffer completes before the entity-damage loop below — the only
    // point a nested trigger (bomber death) can re-enter this function.
    if (blastTouchedScratch.length < world.types.length) {
      blastTouchedScratch = new Uint8Array(world.types.length);
    }
    const blastTouched = blastTouchedScratch;
    blastTouched.fill(0, 0, world.types.length);
    // A warded boss's own blast (the Kiln's slam, fireballs, death) never harms
    // it — neither the blow itself (entity loop below) nor the live charge it
    // would leave in the floor the boss then walks through (QA: the Colossus
    // electrified itself to death idling near an idle player). See core/bossWard.
    const bossAuthor = blastAuthor(options.playerDamageSource);
    // ...and a boss arena's organ (the Kiln's ceiling tank, the Sump's drain
    // plugs) is the PLAYER's to open: a blast he did not cast — the boss's own
    // volley, a bomber it caught, powder the lava lit — leaves those cells be
    // (probe, seed 4: the tank burst ~3 s after the Colossus woke, before the
    // player had done anything, and the flood was wasted).
    const organ = causeForExplosion(options.playerDamageSource) === 'direct' ? null : bossOrganRect(ctx.levels?.current?.boss);
    // ...and an arena's FUEL (the Ice-House's coal pits) is the player's to
    // LIGHT: any blast there catches the coal instead of blowing it away (a
    // spark bolt used to flash the whole pit off in a second).
    const fuel = bossFuelRect(ctx.levels?.current?.boss);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const nx = cx + dx,
            ny = cy + dy;
          if (!world.inBounds(nx, ny)) continue;
          if (organ && nx >= organ.x0 && nx <= organ.x1 && ny >= organ.y0 && ny <= organ.y1) continue;
          const ni = world.idx(nx, ny);
          const orig = world.types[ni];
          if (fuel && orig === Cell.Coal && nx >= fuel.x0 && nx <= fuel.x1 && ny >= fuel.y0 && ny <= fuel.y1) {
            if (world.life[ni] === 0) world.life[ni] = (ctx.params.materials[Cell.Coal].burnDuration ?? 240) + Math.floor(fxRandom() * 40);
            continue;
          }
          if (orig === Cell.MarshGas) {
            // a blast doesn't erase a gas pocket - it LIGHTS it
            world.replaceCellAt(ni, Cell.Fire, fireColor());
            world.life[ni] = 24 + Math.floor(simRandom() * 12);
            continue;
          }
          if (orig !== Cell.Empty) blastTouched[ni] = 1;
          if (orig !== Cell.Metal) {
            // Terrain crumbles fully near the core, raggedly at the rim
            if (
              orig === Cell.Wall &&
              dx * dx + dy * dy > radius * radius * 0.55 &&
              simRandom() < 0.45
            )
              continue;
            // A mirror bursts into glinting silver shards (cosmetic: the fx
            // stream, so no other material's sim rolls move).
            if (orig === Cell.Mirror && fxRandom() < 0.6) {
              const d = Math.sqrt(dx * dx + dy * dy) || 1;
              ctx.particles.spawn(nx, ny, (dx / d) * 2.2 + (fxRandom() - 0.5) * 1.6, (dy / d) * 1.8 - 1.4 - fxRandom(),
                null, fxRandom() < 0.3 ? packRGB(250, 252, 255) : packRGB(190, 204, 216), 70 + Math.floor(fxRandom() * 40), { glow: 1.2, grav: 0.1 });
            }
            // Crystal shatters into a burst of glowing shards
            if (orig === Cell.Crystal && simRandom() < 0.6) {
              const d = Math.sqrt(dx * dx + dy * dy) || 1;
              ctx.particles.spawn(
                nx,
                ny,
                (dx / d) * 2.4 + (simRandom() - 0.5) * 1.6,
                (dy / d) * 2.0 - 1.6 - simRandom(),
                Cell.Crystal,
                crystalColor(),
                110,
                { glow: 1.8 },
              );
            }
            // A blast in a pool THROWS the pool: every cell of a displaced liquid
            // flies as a spray that lands again (deposit: conserved even if its
            // arc runs out). It used to be unmade — 30% fire, 20% smoke, the rest
            // nothing — so each spark bolt that struck the Sunken Leviathan's
            // pool deleted ~60 of its ~790 cells, and firing at the fish emptied
            // its armour in seconds. (The rolls below are still drawn, so the sim
            // stream is unchanged for every other material.)
            const thrown = DISPLACED_BY_BLAST[orig] === 1;
            // Launch a fraction of destroyed material as ballistic debris
            const debrisRoll =
              orig !== Cell.Empty &&
              orig !== Cell.Fire &&
              orig !== Cell.Smoke &&
              orig !== Cell.Steam &&
              simRandom() < 0.22;
            if (thrown) {
              const d = Math.sqrt(dx * dx + dy * dy) || 1;
              const force = (1.2 - d / radius) * 2.6 + fxRandom();
              ctx.particles.spawn(nx, ny, (dx / d) * force + (fxRandom() - 0.5), (dy / d) * force - 1.2 - fxRandom(), orig, world.colors[ni], 90, { deposit: true });
            } else if (debrisRoll) {
              const d = Math.sqrt(dx * dx + dy * dy) || 1;
              const force = (1.2 - d / radius) * 2.6 + simRandom();
              ctx.particles.spawn(
                nx,
                ny,
                (dx / d) * force + (simRandom() - 0.5),
                (dy / d) * force - 1.2 - simRandom(),
                orig,
                world.colors[ni],
                90,
                { glow: orig === Cell.Lava || orig === Cell.Gold ? 1.5 : 0, looseDebris: true },
              );
            }
            if (simRandom() < 0.3) {
              const life = Math.floor(simRandom() * 25) + 10;
              if (thrown) world.clearCellAt(ni);
              else {
                world.replaceCellAt(ni, Cell.Fire, fireColor());
                world.life[ni] = life;
              }
            } else if (simRandom() < 0.2) {
              const life = Math.floor(simRandom() * 30) + 20;
              if (thrown) world.clearCellAt(ni);
              else {
                world.replaceCellAt(ni, Cell.Smoke, smokeColor());
                world.life[ni] = life;
              }
            } else {
              world.clearCellAt(ni);
            }
            // A visible electrified flash that conducts through adjacent
            // water/metal for several frames, then fades. The base deposit is
            // scaled by chargeStrength (reach) and attenuated by chargeFalloff
            // (spread) / chargeDecay (duration).
            // (The roll is drawn first either way so the sim stream is unchanged.)
            if (simRandom() < 0.4 && bossAuthor === null) world.setChargeAt(ni, chargeDeposit(ctx, 8));
          } else {
            // Metal doesn't shatter — but it CONDUCTS. The blast rings a strong
            // current through it that spreads across the connected metal (and up
            // into water sitting on it, and into enemies standing on it), fading
            // over ~1s. Big base deposit → metal carries the current far.
            if (bossAuthor === null) world.setChargeAt(ni, chargeDeposit(ctx, 60));
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
        if (organ && nx >= organ.x0 && nx <= organ.x1 && ny >= organ.y0 && ny <= organ.y1) continue;
        const ni = world.idx(nx, ny);
        const t = world.types[ni];
        // Heat fuses sand at the blast rim into glass
        if (t === Cell.Sand && simRandom() < 0.4) {
          blastTouched[ni] = 1;
          world.replaceCellAt(ni, Cell.Glass, glassColor());
          continue;
        }
        if (t === Cell.Empty || t === Cell.Metal || !blocksEntity(t) || ctx.physics.cellBlocks(nx, ny))
          continue;
        if (fxRandom() < 0.25) {
          ctx.particles.spawn(
            nx,
            ny,
            (fxRandom() - 0.5) * 2.0,
            -0.8 - fxRandom(),
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
    // GPU sparks (cosmetic — they bounce off the cave, never become cells): a
    // hot fan, embers drifting up, a smoke puff; all scale with the blast.
    const sparks = ctx.sparks;
    if (sparks) {
      sparks.burst(cx, cy, { count: Math.min(900, radius * 40), speed: 1.6 + radius * 0.16, kind: 'spark', glow: 1.3,
        radius: radius * 0.3, colors: [0xffd27a, 0xffa030, 0xff7a18, 0xfff0c0] });
      sparks.burst(cx, cy, { count: Math.min(240, radius * 10), speed: 0.8 + radius * 0.05, kind: 'ember', glow: 1.1,
        radius: radius * 0.5, colors: [0xff6a10, 0xffae40, 0xd04008] });
      sparks.burst(cx, cy, { count: Math.min(260, radius * 12), speed: 0.35, kind: 'smoke', life: 80,
        radius: radius * 0.6, colors: [0x5a5048, 0x6e625a, 0x4a423c] });
    }

    // Entity damage. damage() can kill RE-ENTRANTLY: a bomber/colossus death
    // triggers a nested explosion that swap-removes enemies from ctx.enemies
    // while this loop runs — indexing the live array crashed the tick (a blast
    // catching a slime and a bomber together was enough) and the reshuffle
    // could feed a survivor the same blast twice. Snapshot the victims first;
    // anyone a nested blast already finished is skipped by the hp check.
    const victims: Enemy[] = [];
    const blastReach = radius * 1.6;
    // Kill attribution: the wand's own blasts are direct; gunpowder, barrels and
    // every other blast the player did not cast are the world detonating.
    const source = causeForExplosion(options.playerDamageSource);
    for (const e of ctx.enemies) {
      const dx = e.x - cx;
      const dy = e.y - cy;
      if (dx * dx + dy * dy < blastReach * blastReach) victims.push(e);
    }
    for (const e of victims) {
      if (e.hp <= 0) continue; // a nested blast already finished it
      if (e.kind === bossAuthor) continue; // its own slam/fireball/death blast
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const dmg = Math.max(4, (1 - d / blastReach) * radius * 2.4);
      // A rival fighter takes a blast as a fighter does (the player's own cap below): a bomb is a heavy hit, never an instant kill.
      const dealt = dmg * (options.enemyDamageMul ?? 1);
      ctx.enemyCtl.damage(e, e.fighter !== undefined ? Math.min(FIGHTER_BLAST_CAP, dealt) : dealt, (dx / (d || 1)) * 2.2, -1.6, source);
    }
    if (ctx.state.mode === 'play' && !ctx.player.dead) {
      const dx = ctx.player.x - cx,
        dy = ctx.player.y - 3 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius * 1.5) {
        const dmg = Math.min(FIGHTER_BLAST_CAP, Math.max(3, (1 - d / (radius * 1.5)) * radius * 2.0));
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
    // ...and the remains of the dead: every part flung by distance (a frozen
    // carcass close in shatters). The wand's own blast makes what they hit his.
    ctx.corpses?.blast(cx, cy, radius * 1.8, 2.5 + radius * 0.08, source === 'direct');
    ctx.vineStrands?.applyRadialImpulse(cx, cy, radius * 1.8, 1.4 + radius * 0.05);
    // The blast wave scatters any ambient critters it didn't outright incinerate.
    ctx.critters?.scatter(cx, cy, radius * 2.0, 2.0 + radius * 0.06);
  }
}

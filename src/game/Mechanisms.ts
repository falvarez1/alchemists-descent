import type { Ctx, Mechanism, MechanismsApi } from '@/core/types';
import { hash2 } from '@/core/math';
import { blocksEntity, Cell, isGas, isLiquid } from '@/sim/CellType';
import { EMPTY_COLOR, fireColor, packRGB, stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';

/**
 * Mechanisms (upgrade-port meta layer): metal doors driven by pressure plates,
 * levers, and fire braziers, plus rune vaults — sealed strongrooms whose stone
 * doors dissolve when a distant rune glyph is struck. Everything obeys the one
 * commandment: doors are real Metal cells, plates weigh real cells and bodies,
 * braziers want real fire, and rune strikes arrive via the structureStrike
 * event from real explosions / projectile impacts / dig hits.
 */

/**
 * Ids only need uniqueness within one level's mechanism list (targetId links
 * stay serializable). List-scoped allocation also survives module duplication
 * in dev tooling, unlike a module-level counter.
 */
function allocId(list: Mechanism[]): number {
  let max = 0;
  for (const m of list) if (m.id > max) max = m.id;
  return max + 1;
}

/* ---------------- factory helpers (used by world/structures.ts) ---------------- */

export function makeDoor(
  ctx: Ctx,
  list: Mechanism[],
  x: number,
  y: number,
  w: number,
  h: number,
): Mechanism {
  const door: Mechanism = { id: allocId(list), kind: 'door', x, y, w, h, state: 0, targetId: -1 };
  list.push(door);
  setDoorCells(ctx, door, false);
  return door;
}

export function setDoorCells(ctx: Ctx, door: Mechanism, open: boolean): void {
  const world = ctx.world;
  door.state = open ? 1 : 0;
  for (let dx = 0; dx < door.w; dx++) {
    for (let dy = 0; dy < door.h; dy++) {
      const X = door.x + dx,
        Y = door.y + dy;
      if (!world.inBounds(X, Y)) continue;
      const i = world.idx(X, Y);
      if (open) {
        if (world.types[i] === Cell.Metal) {
          world.types[i] = Cell.Empty;
          world.colors[i] = EMPTY_COLOR;
          if (Math.random() < 0.2) {
            ctx.particles.spawn(
              X,
              Y,
              (Math.random() - 0.5) * 0.8,
              -0.4 - Math.random() * 0.6,
              null,
              packRGB(150, 160, 180),
              30,
              { glow: 1.2, grav: 0.04 },
            );
          }
        }
      } else {
        // Safe close: never crush a living body
        let occupied =
          Math.abs(X - ctx.player.x) <= 5 && Y <= ctx.player.y + 1 && Y >= ctx.player.y - 18;
        if (!occupied) {
          for (const e of ctx.enemies) {
            const def = ctx.enemyCtl.defs[e.kind];
            if (Math.abs(X - e.x) <= def.halfW + 1 && Y <= e.y + 1 && Y >= e.y - def.h - 1) {
              occupied = true;
              break;
            }
          }
        }
        if (occupied) continue;
        world.types[i] = Cell.Metal;
        // rune-tinted metal so sealed doors read as mechanisms, not plain plate
        const rs = 0.85 + hash2(X, Y, 311) * 0.3;
        world.colors[i] = packRGB(Math.floor(96 * rs), Math.floor(108 * rs), Math.floor(142 * rs));
      }
    }
  }
}

export function makePlate(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  w: number,
  door: Mechanism,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'plate',
    x,
    y,
    w,
    h: 1,
    state: 0,
    pressed: false,
    targetId: door.id,
  };
  list.push(m);
  // visible plate: a thin brass sill flush with the floor
  const body: Array<[number, number]> = [];
  for (let dx = 0; dx < w; dx++) {
    if (world.inBounds(x + dx, y)) {
      const i = world.idx(x + dx, y);
      world.types[i] = Cell.Metal;
      world.colors[i] = packRGB(148, 132, 70);
      body.push([x + dx, y]);
    }
  }
  m.body = body;
  return m;
}

export function makeLever(
  list: Mechanism[],
  x: number,
  y: number,
  door: Mechanism,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'lever',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: door.id,
    // the bracket's footing — blast it away and the gate fail-opens
    body: [
      [x - 1, y + 1],
      [x, y + 1],
      [x + 1, y + 1],
    ],
  };
  list.push(m);
  return m;
}

export function makeBrazier(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  door: Mechanism,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'brazier',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: door.id,
  };
  list.push(m);
  // bowl: a small stone cup waiting for flame
  const body: Array<[number, number]> = [];
  for (let dx = -2; dx <= 2; dx++) {
    if (world.inBounds(x + dx, y)) {
      const i = world.idx(x + dx, y);
      world.types[i] = Cell.Stone;
      world.colors[i] = stoneColor();
      body.push([x + dx, y]);
    }
  }
  for (const dx of [-2, 2]) {
    if (world.inBounds(x + dx, y - 1)) {
      const i = world.idx(x + dx, y - 1);
      world.types[i] = Cell.Stone;
      world.colors[i] = stoneColor();
      body.push([x + dx, y - 1]);
    }
  }
  m.body = body;
  return m;
}

/** SAND SCALE: a brass pan that wants real material weight poured onto it. */
export function makeScale(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  w: number,
  threshold: number,
  door: Mechanism,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'scale',
    x,
    y,
    w,
    h: 1,
    state: 0,
    targetId: door.id,
    threshold,
    zone: { x0: x, y0: y - 7, x1: x + w - 1, y1: y - 1 },
  };
  list.push(m);
  const body: Array<[number, number]> = [];
  // the pan: a brass sill with raised lips so the pour stays put
  for (let dx = 0; dx < w; dx++) {
    if (world.inBounds(x + dx, y)) {
      const i = world.idx(x + dx, y);
      world.types[i] = Cell.Metal;
      world.colors[i] = packRGB(168, 142, 64);
      body.push([x + dx, y]);
    }
  }
  for (const dx of [-1, w]) {
    for (let dy = 0; dy <= 2; dy++) {
      if (world.inBounds(x + dx, y - dy)) {
        const i = world.idx(x + dx, y - dy);
        world.types[i] = Cell.Metal;
        world.colors[i] = packRGB(148, 126, 58);
        body.push([x + dx, y - dy]);
      }
    }
  }
  m.body = body;
  return m;
}

/** SLUICE BUOY: a float that rises when its basin pools enough liquid. */
export function makeBuoy(
  list: Mechanism[],
  x: number,
  y: number,
  zone: { x0: number; y0: number; x1: number; y1: number },
  threshold: number,
  door: Mechanism,
  body: Array<[number, number]>,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'buoy',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: door.id,
    threshold,
    zone,
    body,
  };
  list.push(m);
  return m;
}

/** CHARGE-LATCH: a coil that latches forever on the first spark in its zone. */
export function makeChargeLatch(
  world: World,
  list: Mechanism[],
  x: number,
  y: number,
  door: Mechanism,
): Mechanism {
  const m: Mechanism = {
    id: allocId(list),
    kind: 'chargelatch',
    x,
    y,
    w: 1,
    h: 1,
    state: 0,
    targetId: door.id,
    zone: { x0: x - 3, y0: y - 5, x1: x + 3, y1: y - 1 },
  };
  list.push(m);
  // a conductive pedestal: metal drinks lightning and wears charge visibly
  const body: Array<[number, number]> = [];
  for (let dx = -2; dx <= 2; dx++) {
    if (world.inBounds(x + dx, y)) {
      const i = world.idx(x + dx, y);
      world.types[i] = Cell.Metal;
      world.colors[i] = packRGB(104, 116, 132);
      body.push([x + dx, y]);
    }
  }
  m.body = body;
  return m;
}

/* ---------------- the runtime system ---------------- */

export class Mechanisms implements MechanismsApi {
  constructor(private ctx: Ctx) {
    // Explosions / projectile impacts / dig hits all announce themselves here.
    ctx.events.on('structureStrike', ({ x, y, radius }) => this.strike(this.ctx, x, y, radius));
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.state.paused) return;
    const runtime = ctx.levels.current;
    if (!runtime) return;
    const world = ctx.world;
    const list = runtime.mechanisms;

    // ---- 1) Each sensor reads the raw grid ----
    for (const m of list) {
      if (m.kind === 'door') continue;

      // Fail-open rule: a wrecked mechanism groans, then its gate falls open.
      // Physics can never hard-lock progression.
      if (m.broken === undefined && m.body && ctx.state.frameCount % 30 === 0) {
        let intact = 0;
        for (const [bx, by] of m.body) {
          if (!world.inBounds(bx, by)) continue;
          const t = world.types[world.idx(bx, by)];
          if (t === Cell.Metal || t === Cell.Stone || blocksEntity(t)) intact++;
        }
        if (intact < m.body.length / 2) {
          m.broken = 1800; // 30 seconds of groaning
          ctx.audio.groan();
          ctx.events.emit('toast', { text: 'THE MECHANISM GROANS — SOMETHING GIVES WAY' });
        }
      }
      if (m.broken !== undefined && m.broken > 0) {
        m.broken--;
        if (m.broken % 360 === 0) ctx.audio.groan();
        if (m.broken === 0) {
          ctx.events.emit('toast', { text: 'THE BROKEN GATE FALLS OPEN' });
        }
        continue; // a dying mechanism no longer senses
      }
      if (m.broken === 0) continue;

      if (m.kind === 'plate') {
        const was = m.pressed === true;
        m.pressed = this.sensePlate(ctx, m);
        if (m.pressed) m.state = 420; // stays open ~7s after weight lifts
        else if (m.state > 0) m.state--;
        if (m.pressed && !was) ctx.audio.tone(140, 90, 0.1, 'square', 0.14);
      } else if (m.kind === 'scale' && m.zone) {
        // SAND SCALE: pure material weight in the pan — bodies don't count,
        // only what you pour or drop stays poured
        let weight = 0;
        for (let X = m.zone.x0; X <= m.zone.x1; X++) {
          for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
            if (!world.inBounds(X, Y)) continue;
            const t = world.types[world.idx(X, Y)];
            if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
          }
        }
        m.reading = weight;
        const enough = weight >= (m.threshold ?? 24);
        if (enough && m.state === 0) ctx.audio.tone(180, 120, 0.14, 'square', 0.15);
        if (enough) m.state = 420;
        else if (m.state > 0) m.state--;
      } else if (m.kind === 'buoy' && m.zone) {
        // SLUICE: pooled liquid lifts the float
        let liquid = 0;
        for (let X = m.zone.x0; X <= m.zone.x1; X++) {
          for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
            if (!world.inBounds(X, Y)) continue;
            if (isLiquid(world.types[world.idx(X, Y)])) liquid++;
          }
        }
        m.reading = liquid;
        const afloat = liquid >= (m.threshold ?? 28);
        if (afloat && m.state === 0) ctx.audio.bubble();
        if (afloat) m.state = 600; // generous latch: pools drain slowly anyway
        else if (m.state > 0) m.state--;
      } else if (m.kind === 'chargelatch' && m.zone) {
        // CHARGE-LATCH: one spark anywhere in the zone latches it forever —
        // lightning, electrified water, even a conducting enemy's blood
        if (m.state === 0) {
          let charged = false;
          for (let X = m.zone.x0; X <= m.zone.x1 && !charged; X++) {
            for (let Y = m.zone.y0; Y <= m.zone.y1 && !charged; Y++) {
              if (world.inBounds(X, Y) && world.charge[world.idx(X, Y)] > 0) charged = true;
            }
          }
          if (charged) {
            m.state = 1;
            ctx.audio.zap();
            ctx.particles.burst(m.x, m.y - 3, 12, null, () => packRGB(120, 200, 255), 2.0, {
              glow: 2.4,
              grav: -0.01,
            });
            ctx.events.emit('toast', { text: 'THE COIL DRINKS THE SPARK — LATCHED' });
          }
        }
      } else if (m.kind === 'brazier') {
        if (m.state === 0) {
          // any flame in the bowl zone latches it permanently
          let lit = false;
          for (let dx = -1; dx <= 1 && !lit; dx++) {
            for (let dy = 1; dy <= 3 && !lit; dy++) {
              const X = m.x + dx,
                Y = m.y - dy;
              if (!world.inBounds(X, Y)) continue;
              const t = world.types[world.idx(X, Y)];
              if (t === Cell.Fire || t === Cell.Lava || t === Cell.Ember) lit = true;
            }
          }
          if (lit) {
            m.state = 1;
            ctx.audio.brazier();
            ctx.particles.burst(m.x, m.y - 3, 12, Cell.Fire, fireColor, 1.6, {
              glow: 2.2,
              grav: -0.02,
            });
            ctx.events.emit('toast', { text: 'A BRAZIER ROARS TO LIFE' });
          }
        } else if (ctx.state.frameCount % 6 === 0) {
          // keep it burning: re-seed a flame in the bowl
          const X = m.x + Math.floor(Math.random() * 3) - 1,
            Y = m.y - 1 - Math.floor(Math.random() * 2);
          if (world.inBounds(X, Y) && world.types[world.idx(X, Y)] === Cell.Empty) {
            const i = world.idx(X, Y);
            world.types[i] = Cell.Fire;
            world.life[i] = 18 + Math.floor(Math.random() * 22);
            world.colors[i] = fireColor();
          }
        }
      }
    }

    // ---- 2) Doors aggregate their triggers: ALL must be satisfied (a door
    //         with one plate behaves exactly as before; Burning Seals wires
    //         three braziers to one gate). Broken triggers count as satisfied
    //         once their groan timer runs out.
    for (const door of list) {
      if (door.kind !== 'door') continue;
      let hasTrigger = false;
      let want = true;
      for (const t of list) {
        if (t.kind === 'door' || t.targetId !== door.id) continue;
        hasTrigger = true;
        if (!this.satisfied(t)) {
          want = false;
          break;
        }
      }
      if (hasTrigger && (door.state === 1) !== want) {
        setDoorCells(ctx, door, want);
        ctx.audio.doorGrind();
      }
    }

    // Rune vaults: dissolve struck doors bottom-up, a few cells per frame
    for (const v of runtime.runeVaults) {
      if (!v.active || v.door.length === 0) continue;
      for (let n = 0; n < 3 && v.door.length; n++) {
        const cell = v.door.pop()!;
        const [dx2, dy2] = cell;
        if (world.inBounds(dx2, dy2) && world.types[world.idx(dx2, dy2)] === Cell.Stone) {
          const i = world.idx(dx2, dy2);
          world.types[i] = Cell.Empty;
          world.colors[i] = EMPTY_COLOR;
          ctx.particles.spawn(
            dx2,
            dy2,
            (Math.random() - 0.5) * 1.4,
            -0.8 - Math.random(),
            null,
            packRGB(160, 255, 190),
            26,
            { glow: 1.8, grav: 0.02 },
          );
        }
      }
      if (v.door.length === 0) ctx.audio.tone(520, 300, 0.3, 'triangle', 0.12);
    }
  }

  /** One trigger's contribution to its door (fail-open: broken = satisfied). */
  private satisfied(t: Mechanism): boolean {
    if (t.broken === 0) return true;
    if (t.broken !== undefined) return false; // still groaning
    switch (t.kind) {
      case 'lever':
      case 'brazier':
      case 'chargelatch':
        return t.state === 1;
      case 'plate':
        return t.pressed === true || t.state > 0;
      case 'scale':
      case 'buoy':
        return t.state > 0;
      default:
        return false;
    }
  }

  /** Weight on the rows just above the sill — terrain, liquids, bodies. */
  private sensePlate(ctx: Ctx, m: Mechanism): boolean {
    const world = ctx.world;
    let weight = 0;
    for (let dx = 0; dx < m.w; dx++) {
      for (let dyy = 1; dyy <= 2; dyy++) {
        const X = m.x + dx,
          Y = m.y - dyy;
        if (!world.inBounds(X, Y)) continue;
        const t = world.types[world.idx(X, Y)];
        if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
      }
    }
    const player = ctx.player;
    if (
      player.y >= m.y - 3 &&
      player.y <= m.y + 1 &&
      player.x + 4 >= m.x &&
      player.x - 4 <= m.x + m.w
    )
      weight += 4;
    for (const e of ctx.enemies) {
      const def = ctx.enemyCtl.defs[e.kind];
      if (e.y >= m.y - 3 && e.y <= m.y + 1 && e.x + def.halfW >= m.x && e.x - def.halfW <= m.x + m.w)
        weight += 4;
    }
    return weight >= 3;
  }

  strike(ctx: Ctx, x: number, y: number, radius: number): void {
    const runtime = ctx.levels.current;
    if (!runtime) return;
    // Concussion flips nearby levers — explosions are valid puzzle inputs
    for (const m of runtime.mechanisms) {
      if (m.kind !== 'lever') continue;
      const ddx = m.x - x,
        ddy = m.y - y;
      if (ddx * ddx + ddy * ddy <= (radius + 6) * (radius + 6)) this.flipLever(ctx, m);
    }
    // Rune glyphs answer to any strike
    for (const v of runtime.runeVaults) {
      if (v.active) continue;
      const dx = v.rx - x,
        dy = v.ry - y;
      if (dx * dx + dy * dy <= radius * radius) {
        v.active = true;
        ctx.events.emit('toast', { text: 'ANCIENT RUNE STRUCK — A VAULT RUMBLES OPEN' });
        ctx.audio.tone(220, 500, 0.5, 'sine', 0.18);
        setTimeout(() => ctx.audio.tone(330, 400, 0.4, 'sine', 0.14), 240);
        ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.012, 0.05);
        ctx.particles.burst(v.rx, v.ry, 18, null, () => packRGB(140, 255, 180), 2.6, {
          glow: 2.6,
          grav: -0.01,
        });
      }
    }
  }

  interact(ctx: Ctx): boolean {
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play' || ctx.player.dead) return false;
    for (const m of runtime.mechanisms) {
      if (m.kind !== 'lever') continue;
      const dx = m.x - ctx.player.x,
        dy = m.y - 3 - (ctx.player.y - 9);
      if (dx * dx + dy * dy < 22 * 22) {
        this.flipLever(ctx, m);
        return true;
      }
    }
    return false;
  }

  private flipLever(ctx: Ctx, m: Mechanism): void {
    m.state = m.state === 1 ? 0 : 1;
    ctx.audio.lever();
    ctx.particles.burst(m.x, m.y - 3, 6, null, () => packRGB(255, 210, 110), 1.2, {
      glow: 1.8,
      grav: 0.02,
    });
  }
}

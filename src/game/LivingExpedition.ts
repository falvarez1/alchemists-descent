import type { Ctx, LivingExpeditionState } from '@/core/types';
import { worksRoomAt } from '@/world/breathingWorks';
import { blocksEntity, Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';

export function createLivingState(): LivingExpeditionState {
  return { ticks: 0, visited: [], room: 'intake', glowseeds: 3, nextLureId: 1, lures: [], rested: false, restTicks: 0, valveTurn: 0, valveAngularVelocity: 0 };
}

export function pressurePhase(ticks: number): 'quiet' | 'inhale' | 'exhale' | 'settle' {
  const phase = ticks % 5400;
  return phase < 3600 ? 'quiet' : phase < 4080 ? 'inhale' : phase < 4800 ? 'exhale' : 'settle';
}

export function livingObjective(ctx: Ctx): string | null {
  const rt = ctx.levels.current;
  const living = rt?.living;
  if (!living || !rt) return null;
  if (living.room === 'pressure') {
    const phase = pressurePhase(living.ticks);
    if (phase === 'inhale') return 'The pipes are drawing breath. Get beneath a shelter.';
    if (phase === 'exhale') return 'The Works exhale. Cross between the steam jets.';
  }
  if (rt.keyTaken) return 'The bell is yours. Follow the undertow to the lower gate.';
  switch (living.room) {
    case 'intake': return rt.pickups.some(p => p.kind === 'tome' && p.x === 265 && !p.taken)
      ? 'A lost spell page rests above the intake. Hold jump to rise.' : 'Follow the copper pipes into the Works.';
    case 'sluice': return 'Drain the sluice, freeze a crossing, or take the high ledges.';
    case 'gallery': return ctx.enemies.some(e => e.kind === 'weaver' && (e.weaverFeedT ?? 0) > 0 && e.x > 1000 && e.y < 500)
      ? 'The Weaver is feeding. Stay low and pass while it eats.'
      : 'The Weaver follows light and prey. Crawl beneath the catwalk.';
    case 'refuge': return living.rested ? 'Rework your wand here. The garden lies to the left.' : 'Rest at the warm stone. The garden lies to the left.';
    case 'silt': return 'Find the brass bell above the garden pool.';
    case 'return': return 'The garden holds the bell. Climb back through the silt.';
    default: return 'Find the warm refuge beyond the pressure chamber.';
  }
}

/** Throws a physical lure; creatures respond to its position and the prey it gathers. */
export function throwGlowseed(ctx: Ctx): boolean {
  const living = ctx.levels.current?.living;
  if (!living || ctx.state.paused || ctx.player.dead) return false;
  if (living.glowseeds <= 0) {
    ctx.events.emit('toast', { text: 'No glowseeds left. Refill at the warm refuge.' });
    return true;
  }
  living.glowseeds--;
  const angle = Math.atan2(ctx.input.mouse.y - (ctx.player.y - 10), ctx.input.mouse.x - ctx.player.x);
  living.lures.push({ id: living.nextLureId++, x: ctx.player.x, y: ctx.player.y - 11,
    vx: Math.cos(angle) * 4.2 + ctx.player.vx * 0.4, vy: Math.sin(angle) * 4.2 - 1.5, life: 1800 });
  ctx.audio.tone(720, 380, 0.11, 'sine', 0.035);
  return true;
}

export function updateLivingExpedition(ctx: Ctx): void {
  const runtime = ctx.levels.current;
  const state = runtime?.living;
  if (!runtime || !state || ctx.state.mode !== 'play' || ctx.player.dead) return;
  state.ticks++;
  const openValve = runtime.mechanisms.find(m => m.kind === 'valve')?.state === 1;
  const turn = openValve ? Math.PI * 1.5 : 0;
  state.valveTurn ??= turn; state.valveAngularVelocity ??= 0;
  state.valveAngularVelocity = state.valveAngularVelocity * .8 + (turn - state.valveTurn) * .025;
  state.valveTurn += state.valveAngularVelocity;
  const room = worksRoomAt(ctx.player.x, ctx.player.y);
  state.room = room.id;
  if (!state.visited.includes(room.id)) {
    state.visited.push(room.id);
    ctx.events.emit('toast', { text: room.name });
  }
  const phase = pressurePhase(state.ticks);
  if (room.id === 'pressure' && state.ticks % 5400 === 3600) {
    ctx.events.emit('toast', { text: 'A low intake of air. The Works are about to exhale.' });
    ctx.audio.tone(63, 94, 2.5, 'sine', 0.08);
  }
  if (phase === 'exhale') {
    for (const nozzle of [1180, 1315, 1450]) {
      // Pressure transports actual vapor down the pipe. A roof interrupts the
      // flow; excavating it removes shelter. No invisible damage volume.
      for (let y = 724; y >= 584; y--) for (let x = nozzle - 2; x <= nozzle + 9; x++) {
        const from = ctx.world.idx(x, y), to = ctx.world.idx(x, y + 2);
        if (ctx.world.types[from] === Cell.Steam && ctx.world.types[to] === Cell.Empty) ctx.world.swap(x, y, x, y + 2);
      }
    }
    if (state.ticks % 20 === 0 && room.id === 'pressure') {
      const px = Math.round(ctx.player.x), py = Math.round(ctx.player.y);
      if ([0, 5, 10, 15].some(offset => ctx.world.type(px, py - offset) === Cell.Steam)) {
        ctx.playerCtl.damage(2, 0, 0.7, 'steam-pressure');
      }
    }
  }
  if (phase === 'exhale' && state.ticks % 4 === 0) {
    ctx.audio.worldSound?.('pressure', 1315, 585, ctx.player.x, ctx.player.y);
    // A finite reservoir feeds the nozzles: water becomes real rising steam.
    // The flow stops when the player drains or freezes the supply.
    for (const x of [1180, 1315, 1450]) {
      for (let j = 0; j < 4; j++) {
        const sx = 1190 + ((state.ticks * 3 + x + j * 13) % 215);
        let source = -1;
        for (let y = 682; y < 727; y++) {
          const i = ctx.world.idx(sx, y);
          if (ctx.world.types[i] === Cell.Water) { source = i; break; }
        }
        const target = ctx.world.idx(x + j + 1, 584 + j);
        if (source < 0 || ctx.world.types[target] !== Cell.Empty) continue;
        ctx.world.clearCellAt(source);
        ctx.world.replaceCellAt(target, Cell.Steam, packRGB(158, 182, 176));
        ctx.world.life[target] = 200;
      }
    }
  }
  // Rest is an earned calm beat. Hostiles nearby or movement interrupt it.
  const nearRefuge = Math.hypot(ctx.player.x - 857, ctx.player.y - 744) < 38;
  const threatened = ctx.enemies.some(e => e.hp > 0 && e.mind?.intent === 'hunt' && Math.hypot(e.x - 857, e.y - 744) < 140);
  state.restTicks = nearRefuge && !threatened && Math.abs(ctx.player.vx) < 0.2 ? state.restTicks + 1 : 0;
  if (state.restTicks === 120) {
    ctx.player.hp = ctx.player.maxHp;
    state.glowseeds = 3;
    state.rested = true;
    ctx.events.emit('toast', { text: 'Warmth returns. Health and glowseeds restored.' });
    ctx.levels.saveExpedition(ctx);
  }
  for (let i = state.lures.length - 1; i >= 0; i--) {
    const lure = state.lures[i];
    if (--lure.life <= 0) { state.lures.splice(i, 1); continue; }
    lure.vy = Math.min(3, lure.vy + 0.09);
    for (const axis of ['x', 'y'] as const) {
      const velocity = axis === 'x' ? 'vx' : 'vy';
      const steps = Math.max(1, Math.ceil(Math.abs(lure[velocity])));
      for (let j = 0; j < steps; j++) {
        const nx = Math.round(lure.x + (axis === 'x' ? lure.vx / steps : 0));
        const ny = Math.round(lure.y + (axis === 'y' ? lure.vy / steps : 0));
        if (!ctx.world.inBounds(nx, ny) || blocksEntity(ctx.world.type(nx, ny))) {
          lure[velocity] *= -0.25;
          lure.vx *= 0.7;
          break;
        }
        lure[axis] += lure[velocity] / steps;
      }
    }
    if (state.ticks % 30 === 0) ctx.events.emit('creatureSignal', {
      x: lure.x, y: lure.y, radius: 180, strength: 0.7, kind: 'lure',
    });
  }
}

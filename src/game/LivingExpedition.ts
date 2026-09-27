import type { Ctx, HintInfo, LivingExpeditionState } from '@/core/types';
import { WORKS_COLD_LOCK, WORKS_RESERVOIR, worksRoomAt } from '@/world/breathingWorks';
import { TEA } from '@/world/teaMachine';
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
  const coldDoors = rt.mechanisms.filter(m =>
    m.id === WORKS_COLD_LOCK.leftDoorId || m.id === WORKS_COLD_LOCK.rightDoorId);
  const coldLockOpen = coldDoors.length === 2 && coldDoors.every(door => door.state === 1);
  if (!coldLockOpen && !living.tea?.completed && (!living.tea || living.tea.stage === 0)) {
    const frostShardTaken = rt.pickups.some(pickup => pickup.kind === 'tome' && pickup.data.card === 'frostshard' && pickup.taken);
    if (frostShardTaken) return 'Return to the Intake. Freeze its shallow cistern to release the engine crank.';
    if (living.room === 'intake') return 'The crank is cold-locked: its cistern probes count ice. Descend the return shaft and find a source of frost.';
    if (living.room === 'refuge') return 'Claim Frost Shard in the Warm Refuge, then climb back to the Intake.';
    return 'Find a source of frost below, then backtrack to the sealed engine crank.';
  }
  if (!living.tea?.completed) return living.tea?.stalled
    ? 'The engine stalled. Use its crank again to recharge the workshop.'
    : living.tea && living.tea.stage > 0 ? 'The Bell & Tea Engine is running. Follow it along the catwalk; it may need a hand on the way.'
    : 'The cold lock is open. Pull the engine crank inside the cage.';
  if (!rt.keyTaken) return 'Collect the brass bell at the far end of the engine’s catwalk.';
  return 'The bell is yours. Carry it down through the Silt Garden’s west chute and the Undertow to the lower gate.';
}

/**
 * The cold census, said out loud where the player stands. Two probes in the
 * Intake cistern count ICE cells (not water, not charge); the caged crank's
 * portcullises lift once both read enough. The hint names what the probes
 * read, how far along they are, and the one thing missing — Frost Shard, or
 * water to freeze if the cistern was drained.
 */
export function coldLockHint(ctx: Ctx): HintInfo | null {
  const rt = ctx.levels.current;
  if (!rt?.living) return null;
  const doors = rt.mechanisms.filter(m => m.id === WORKS_COLD_LOCK.leftDoorId || m.id === WORKS_COLD_LOCK.rightDoorId);
  if (doors.length !== 2 || doors.every(door => door.state === 1)) return null;
  const { basin } = WORKS_COLD_LOCK;
  const bx = (basin.x0 + basin.x1) / 2, by = basin.y0;
  const px = ctx.player.x, py = ctx.player.y;
  const nearBasin = Math.hypot(px - bx, py - by) < 72;
  const nearCage = Math.hypot(px - 432, py - 300) < 58;
  if (!nearBasin && !nearCage) return null;
  const sensors = rt.mechanisms.filter(m => m.id === WORKS_COLD_LOCK.leftSensorId || m.id === WORKS_COLD_LOCK.rightSensorId);
  const need = Math.max(1, ...sensors.map(m => m.threshold ?? 32));
  const ice = sensors.length ? Math.min(...sensors.map(m => (m.state === 1 ? need : m.reading ?? 0))) : 0;
  let water = 0;
  for (let y = basin.y0; y <= basin.y1; y++) for (let x = basin.x0; x <= basin.x1; x++) {
    const t = ctx.world.type(x, y);
    if (t === Cell.Water || t === Cell.Ice) water++;
  }
  const frost = rt.pickups.some(p => p.kind === 'tome' && p.data.card === 'frostshard' && p.taken)
    || ctx.wands.collection.includes('frostshard') || ctx.wands.wands.some(w => w.cards.includes('frostshard'));
  const world = { x: Math.round(bx), y: by - 2 };
  let line: string;
  if (ice > 0) line = `Freezing — the probes read ${Math.min(ice, need)}/${need} ice. Keep it cold.`;
  else if (water < need) line = 'The cistern is too shallow to freeze. Pour water back in (Q) first.';
  else if (frost) line = 'Cold lock: its probes count ICE. Cast Frost Shard into the cistern.';
  else line = 'Cold lock: its probes count ICE, not water. Frost Shard waits in the Warm Refuge below.';
  return { key: 'works-cold-lock', line, world };
}

/**
 * Breadcrumbs for the long authored route: each milestone points the compass
 * at the next place the objective names. A waypoint the player set by hand
 * (any other label) is left alone.
 */
function updateMilestoneWaypoint(ctx: Ctx): void {
  const rt = ctx.levels.current;
  const living = rt?.living;
  if (!rt || !living) return;
  const doors = rt.mechanisms.filter(m => m.id === WORKS_COLD_LOCK.leftDoorId || m.id === WORKS_COLD_LOCK.rightDoorId);
  const coldOpen = doors.length === 2 && doors.every(door => door.state === 1);
  const frost = rt.pickups.some(p => p.kind === 'tome' && p.data.card === 'frostshard' && p.taken);
  const b = WORKS_COLD_LOCK.basin;
  if (!living.coldLockSeen && Math.hypot(ctx.player.x - (b.x0 + b.x1) / 2, ctx.player.y - b.y0) < 90) living.coldLockSeen = true;
  let goal: { label: string; x: number; y: number } | null = null;
  if (rt.keyTaken && rt.portal) goal = { label: 'The Lower Gate', x: rt.portal.x, y: rt.portal.y };
  else if (living.tea?.completed) {
    const bell = rt.pickups.find(p => p.kind === 'key' && !p.taken);
    if (bell) goal = { label: 'Brass Bell', x: Math.round(bell.x), y: Math.round(bell.y) };
  } else if (coldOpen && !(living.tea && living.tea.stage > 0)) goal = { label: 'Engine Crank', x: TEA.lever.x, y: TEA.lever.y };
  else if (frost && !coldOpen) goal = { label: 'Cold-lock Cistern', x: Math.round((b.x0 + b.x1) / 2), y: b.y0 - 4 };
  // Having met the lock, the way to the frost that opens it: the refuge below.
  else if (!frost && !coldOpen && living.coldLockSeen) {
    const tome = rt.pickups.find(p => p.kind === 'tome' && p.data.card === 'frostshard');
    if (tome) goal = { label: 'Warm Refuge', x: Math.round(tome.x), y: Math.round(tome.y) };
  }
  if (!goal || living.autoWaypoint === goal.label) return;
  const current = rt.mapWaypoint;
  if (current && current.label !== living.autoWaypoint) return;
  rt.mapWaypoint = { x: goal.x, y: goal.y, label: goal.label };
  living.autoWaypoint = goal.label;
  ctx.events.emit('toast', { text: 'Compass: ' + goal.label });
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
  ctx.audio.sfx('player.glowseed');
  return true;
}

export function updateLivingExpedition(ctx: Ctx): void {
  const runtime = ctx.levels.current;
  const state = runtime?.living;
  if (!runtime || !state || ctx.state.mode !== 'play' || ctx.player.dead) return;
  state.ticks++;
  if (state.ticks % 20 === 0) updateMilestoneWaypoint(ctx);
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
    ctx.audio.sfx('amb.breath.inhale', 1315, 600);
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
        const sx = WORKS_RESERVOIR.x0 + 5 + ((state.ticks * 3 + x + j * 13) % (WORKS_RESERVOIR.x1 - WORKS_RESERVOIR.x0 - 10));
        let source = -1;
        for (let y = WORKS_RESERVOIR.y0; y <= WORKS_RESERVOIR.y1; y++) {
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

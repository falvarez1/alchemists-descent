import type { Ctx, HintInfo, LivingExpeditionState, Mechanism } from '@/core/types';
import { WORKS_BARRICADE, WORKS_GATE, WORKS_RESERVOIR, WORKS_ROOMS, worksGateOpen, worksRoomAt } from '@/world/breathingWorks';
import { TEA, TEA_STAGE } from '@/world/teaMachine';
import { blocksEntity, Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { glowseedCap } from '@/game/glowseeds';

export function createLivingState(): LivingExpeditionState {
  return { ticks: 0, visited: [], room: 'intake', glowseeds: 3, nextLureId: 1, lures: [], rested: false, restTicks: 0, valveTurn: 0, valveAngularVelocity: 0 };
}

export function pressurePhase(ticks: number): 'quiet' | 'inhale' | 'exhale' | 'settle' {
  const phase = ticks % 5400;
  return phase < 3600 ? 'quiet' : phase < 4080 ? 'inhale' : phase < 4800 ? 'exhale' : 'settle';
}

/** The oil-soaked barricade, while it still stands between the player and the crank. */
function barricade(ctx: Ctx): Mechanism | undefined {
  return ctx.levels.current?.mechanisms.find(m => m.id === WORKS_BARRICADE.id && m.state === 0);
}

/** True while the player is still on the spawn side of a standing barricade. */
function barricadeAhead(ctx: Ctx): boolean {
  return !!barricade(ctx) && ctx.player.x < WORKS_BARRICADE.x1 + 6 && ctx.player.y < 330;
}

/** One short imperative line at a time; never two instructions that disagree. */
export function livingObjective(ctx: Ctx): string | null {
  const rt = ctx.levels.current;
  const living = rt?.living;
  if (!living || !rt) return null;
  if (living.room === 'pressure') {
    const phase = pressurePhase(living.ticks);
    if (phase === 'inhale') return 'The pipes are drawing breath. Get beneath a shelter.';
    if (phase === 'exhale') return 'The Works exhale. Cross between the steam jets.';
  }
  const tea = living.tea;
  if (!tea || (tea.stage === TEA_STAGE.IDLE && !tea.stalled)) return barricadeAhead(ctx) ? 'Burn through the barricade.' : 'Pull the engine crank.';
  if (tea.stalled) return 'Recharge the engine at its crank.';
  if (!tea.completed) {
    // The three stations built to stop: the verb, said as an order.
    if (tea.stage === TEA_STAGE.SPARK) return 'Shoot the priming pan.';
    if (tea.stage === TEA_STAGE.KICK) return 'Kick the Persuader.';
    if (tea.stage === TEA_STAGE.POUR) return 'Pour water into the duck’s bath.';
    return 'Follow the engine along the catwalk.';
  }
  if (!rt.keyTaken) return 'Collect the brass bell.';
  return 'Carry the bell to the lower gate.';
}

/**
 * The Works' own contextual notes, said where the player stands and anchored
 * to the thing itself (the HUD draws keys starting with `works-note` as a
 * world-anchored note): how to burn the barricade, and what the lower gate
 * wants. The engine's stations speak through its own caption card.
 */
export function worksHint(ctx: Ctx): HintInfo | null {
  const rt = ctx.levels.current;
  if (!rt?.living) return null;
  const px = ctx.player.x, py = ctx.player.y;
  if (barricadeAhead(ctx) && Math.hypot(px - WORKS_BARRICADE.x0, py - WORKS_BARRICADE.y1) < 110) {
    return { key: 'works-note-barricade', line: 'Oil-soaked timber. Stand well back, then a Spark Bolt (left click).',
      world: { x: WORKS_BARRICADE.x0 + 4, y: WORKS_BARRICADE.y0 + 4 } };
  }
  const tea = rt.living.tea;
  if (rt.keyTaken && tea?.completed && Math.hypot(px - WORKS_GATE.x, py - WORKS_GATE.floor) < 90 && !worksGateOpen(ctx.world)) {
    return { key: 'works-note-gate', line: 'The grate answers to the bell. Stand on it.', world: { x: WORKS_GATE.x, y: WORKS_GATE.floor - 4 } };
  }
  return null;
}

/**
 * Breadcrumbs for the authored route: each milestone points the compass at the
 * next place the objective names. A waypoint the player set by hand (any other
 * label) is left alone. The first one is set quietly: the spawn already has a
 * room title and an objective line to read.
 */
function updateMilestoneWaypoint(ctx: Ctx): void {
  const rt = ctx.levels.current;
  const living = rt?.living;
  if (!rt || !living) return;
  let goal: { label: string; x: number; y: number; quiet?: boolean } | null = null;
  if (rt.keyTaken && rt.portal) goal = { label: 'The Lower Gate', x: rt.portal.x, y: rt.portal.y };
  else if (living.tea?.completed) {
    const bell = rt.pickups.find(p => p.kind === 'key' && !p.taken);
    if (bell) goal = { label: 'Brass Bell', x: Math.round(bell.x), y: Math.round(bell.y) };
  } else if (!(living.tea && living.tea.stage > 0)) goal = { label: 'Engine Crank', x: TEA.lever.x, y: TEA.lever.y, quiet: true };
  if (!goal || living.autoWaypoint === goal.label) return;
  const current = rt.mapWaypoint;
  if (current && current.label !== living.autoWaypoint) return;
  rt.mapWaypoint = { x: goal.x, y: goal.y, label: goal.label };
  living.autoWaypoint = goal.label;
  if (!goal.quiet) ctx.events.emit('toast', { text: 'Compass: ' + goal.label });
}

/** Grounded ticks inside a room before its name is announced. */
const ROOM_ARRIVAL_TICKS = 24;

/**
 * Room titles mark real arrivals. The old nearest-room rule named the sluice
 * while the player was still falling down the return shaft, and named rooms
 * the engine's catwalk merely passes over. Now the player must stand inside
 * the room's own outline, on its ground, for a moment.
 */
function announceRoom(ctx: Ctx, state: LivingExpeditionState): void {
  const p = ctx.player;
  const onCatwalk = p.x > TEA.bounds.x0 - 4 && p.x < TEA.bounds.x1 && p.y < 318;
  const inside = onCatwalk ? undefined : WORKS_ROOMS.find(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.floor + 2);
  if (!inside || state.visited.includes(inside.id) || !p.grounded) { if (!inside || !p.grounded) state.roomDwell = undefined; return; }
  const dwell = state.roomDwell?.id === inside.id ? state.roomDwell.ticks + 1 : 1;
  state.roomDwell = { id: inside.id, ticks: dwell };
  if (dwell < ROOM_ARRIVAL_TICKS) return;
  state.visited.push(inside.id);
  state.roomDwell = undefined;
  ctx.events.emit('toast', { text: inside.name });
}

/**
 * The Lower Bell gate opens for the bell and nothing else: carry it close and
 * the lock rings, then both grate leaves slide into their floor slots one
 * cell at a time (real metal, moved with World.swap). Levels starts the
 * descent only once the pit is clear, so the player drops through the floor.
 */
function updateGate(ctx: Ctx, state: LivingExpeditionState): void {
  const rt = ctx.levels.current;
  if (!rt?.keyTaken || !state.tea?.completed || !rt.portal) return;
  const G = WORKS_GATE, w = ctx.world;
  if (worksGateOpen(w)) return;
  const closed = w.type(G.leaves.left.x1, G.leaves.y0) === Cell.Metal && w.type(G.leaves.right.x0, G.leaves.y0) === Cell.Metal;
  // The lock hears the bell from well back, so at a run the grate is already
  // open underfoot rather than opening behind the player.
  if (closed && Math.hypot(ctx.player.x - G.x, ctx.player.y - G.floor) > 95) return;
  if (closed && !rt.portal.open) {
    rt.portal.open = true;
    ctx.audio.gong(); ctx.audio.keyJingle();
    ctx.fx.screenShake = Math.min(0.03, ctx.fx.screenShake + 0.012);
    ctx.events.emit('toast', { text: 'The bell rings in the lock. The lower gate opens.' });
  }
  if (state.ticks % 2 !== 0) return;
  let moved = false;
  for (const dir of [-1, 1] as const) {
    // Current extent of this leaf: the metal run on its side of the gate row.
    const from = dir < 0 ? G.pit.x0 - G.slot : G.leaves.right.x0, to = dir < 0 ? G.leaves.left.x1 : G.pit.x1 + G.slot;
    let x0 = Infinity, x1 = -Infinity;
    for (let x = from; x <= to; x++) if (w.type(x, G.leaves.y0 + 1) === Cell.Metal) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    if (!Number.isFinite(x0)) continue;
    const lead = dir < 0 ? x0 - 1 : x1 + 1;
    if (lead < G.pit.x0 - G.slot || lead > G.pit.x1 + G.slot) continue;
    let clear = true;
    for (let y = G.leaves.y0; y <= G.leaves.y1; y++) if (w.type(lead, y) !== Cell.Empty) clear = false;
    if (!clear) continue;
    for (let y = G.leaves.y0; y <= G.leaves.y1; y++) {
      if (dir < 0) for (let x = x0; x <= x1; x++) w.swap(x, y, x - 1, y);
      else for (let x = x1; x >= x0; x--) w.swap(x, y, x + 1, y);
    }
    moved = true;
  }
  if (moved && state.ticks % 12 === 0) ctx.audio.at(G.x, G.floor, () => ctx.audio.doorGrind());
  if (moved && state.ticks % 6 === 0) {
    ctx.particles.burst(G.x + (state.ticks % 24) - 12, G.floor + 2, 2, null, () => packRGB(150, 130, 96), .9, { grav: .08 });
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
  announceRoom(ctx, state);
  updateGate(ctx, state);
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
    state.glowseeds = glowseedCap(state);
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

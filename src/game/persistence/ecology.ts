import type { Critter, LivingExpeditionState } from '@/core/types';
import { createLivingState } from '@/game/LivingExpedition';
import { WORKS_ROOMS } from '@/world/breathingWorks';
import { HEIGHT, WIDTH } from '@/config/constants';
import { WORKS_PLANTS } from '@/world/worksHabitat';

const finite = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function restoreFauna(value: unknown): Critter[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = new Set<string>();
  const result: Critter[] = [];
  for (const raw of value.slice(0, 128)) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Critter;
    if (!['moth', 'firefly', 'fish', 'beetle', 'fly'].includes(c.kind) || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const id = typeof c.id === 'string' ? c.id.slice(0, 80) : `restored-${result.length}`;
    if (ids.has(id)) continue;
    ids.add(id);
    const x = finite(c.x, 0, 8, WIDTH - 9), y = finite(c.y, 0, 8, HEIGHT - 9);
    result.push({ kind: c.kind, id, x, y, homeX: finite(c.homeX, x, 8, WIDTH - 9), homeY: finite(c.homeY, y, 8, HEIGHT - 9),
      vx: finite(c.vx, 0, -8, 8), vy: finite(c.vy, 0, -8, 8), phase: finite(c.phase, 0, 0, 100000),
      energy: finite(c.energy, 1, 0, 1), gasp: finite(c.gasp, 0, 0, 600), facing: c.facing === -1 ? -1 : 1 });
  }
  return result;
}

export function restoreLiving(value: unknown): LivingExpeditionState {
  const state = createLivingState();
  if (!value || typeof value !== 'object') return state;
  const raw = value as Partial<LivingExpeditionState>;
  const rooms = new Set<string>(WORKS_ROOMS.map(room => room.id));
  state.ticks = Math.floor(finite(raw.ticks, 0, 0, Number.MAX_SAFE_INTEGER));
  state.room = rooms.has(raw.room ?? '') ? raw.room! : 'intake';
  state.visited = Array.isArray(raw.visited) ? [...new Set(raw.visited.filter(room => rooms.has(room)))] : [];
  state.glowseeds = Math.floor(finite(raw.glowseeds, 3, 0, 3));
  state.rested = raw.rested === true;
  // A resumed game earns a new calm rest; a partial dwell is not a checkpoint.
  state.restTicks = 0;
  state.lures = Array.isArray(raw.lures) ? raw.lures.slice(0, 3).filter(lure => lure && Number.isFinite(lure.x) && Number.isFinite(lure.y)).map((lure, index) => ({
    id: index + 1, x: finite(lure.x, 0, 8, WIDTH - 9), y: finite(lure.y, 0, 8, HEIGHT - 9),
    vx: finite(lure.vx, 0, -8, 8), vy: finite(lure.vy, 0, -8, 8), life: Math.floor(finite(lure.life, 1, 1, 1800)),
  })) : [];
  state.nextLureId = state.lures.length + 1;
  if (Array.isArray(raw.plants)) state.plants = WORKS_PLANTS.map(([x, y, _size, hanging], i) => {
    const p = raw.plants![i];
    if (hanging || !p || typeof p !== 'object') return null;
    return { x: finite(p.x, x, 1, WIDTH - 2), y: finite(p.y, y, 1, HEIGHT - 2), rootY: Math.round(finite(p.rootY, y, y - 7, y + 24)),
      angle: finite(p.angle, 0, -.95, .95), velocity: finite(p.velocity, 0, -.5, .5), rotation: finite(p.rotation, 0, -1000, 1000),
      spin: finite(p.spin, 0, -.5, .5), vx: finite(p.vx, 0, -8, 8), vy: finite(p.vy, 0, -8, 8),
      detached: p.detached === true, burn: finite(p.burn, 0, 0, 1), burning: p.burning === true && p.spent !== true,
      age: Math.floor(finite(p.age, 0, 0, 901)), spent: p.spent === true };
  });
  return state;
}

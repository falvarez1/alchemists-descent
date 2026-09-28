import type { Critter, CritterKind, LivingExpeditionState } from '@/core/types';
import { createLivingState } from '@/game/LivingExpedition';
import { WORKS_ROOMS } from '@/world/breathingWorks';
import { HEIGHT, WIDTH } from '@/config/constants';
import { WORKS_PLANTS } from '@/world/worksHabitat';
import { GLOWSEED_POUCH, GLOWSEED_POUCH_MAX, glowseedCap } from '@/game/glowseeds';
import { restoreTeaMachine } from '@/game/TeaMachine';
import { GLOW, LEECH } from '@/game/organisms/types';

const finite = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

const FAUNA_KINDS: ReadonlySet<string> = new Set<CritterKind>([
  'moth', 'firefly', 'fish', 'beetle', 'fly',
  'glowworm', 'puffer', 'snapjaw', 'isopod', 'leech', 'emberbeetle', 'ashmoth',
  'frostmite', 'snowmoth', 'brineskater', 'glassbeetle', 'prismmoth', 'lensmite',
]);

const optional = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : undefined;

/** Wave-2 organism state (anchor, normal, state machine, extension); absent fields stay absent. */
function organismFields(c: Critter): Partial<Critter> {
  const out: Partial<Critter> = {};
  const set = <K extends keyof Critter>(key: K, v: Critter[K] | undefined): void => { if (v !== undefined) out[key] = v; };
  set('anchorX', optional(c.anchorX, 0, WIDTH - 1));
  set('anchorY', optional(c.anchorY, 0, HEIGHT - 1));
  set('nx', optional(c.nx, -1, 1));
  set('ny', optional(c.ny, -1, 1));
  set('state', optional(c.state, 0, 8));
  set('extent', optional(c.extent, 0, 64));
  set('reach', optional(c.reach, 0, 64));
  set('hp', optional(c.hp, 0, 100));
  set('meal', optional(c.meal, 0, 5000));
  set('dead', optional(c.dead, 0, 5000));
  // A snare or a latch is a live relation; a save resumes with both parties free.
  if (c.kind === 'leech' && out.state === LEECH.LATCHED) { out.state = LEECH.BEACHED; out.anchorX = undefined; out.anchorY = undefined; }
  if (c.kind === 'glowworm' && out.state === GLOW.REEL) out.state = GLOW.FISH;
  return out;
}

export function restoreFauna(value: unknown): Critter[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = new Set<string>();
  const result: Critter[] = [];
  for (const raw of value.slice(0, 128)) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Critter;
    if (!FAUNA_KINDS.has(c.kind) || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const id = typeof c.id === 'string' ? c.id.slice(0, 80) : `restored-${result.length}`;
    if (ids.has(id)) continue;
    ids.add(id);
    const x = finite(c.x, 0, 8, WIDTH - 9), y = finite(c.y, 0, 8, HEIGHT - 9);
    result.push({ kind: c.kind, id, x, y, homeX: finite(c.homeX, x, 8, WIDTH - 9), homeY: finite(c.homeY, y, 8, HEIGHT - 9),
      vx: finite(c.vx, 0, -8, 8), vy: finite(c.vy, 0, -8, 8), phase: finite(c.phase, 0, 0, 100000),
      energy: finite(c.energy, 1, 0, 1), gasp: finite(c.gasp, 0, 0, 600), facing: c.facing === -1 ? -1 : 1,
      ...organismFields(c) });
  }
  return result;
}

export function restoreLiving(value: unknown): LivingExpeditionState {
  const state = createLivingState();
  if (!value || typeof value !== 'object') return state;
  const raw = value as Partial<LivingExpeditionState>;
  state.tea = restoreTeaMachine(raw.tea);
  const rooms = new Set<string>(WORKS_ROOMS.map(room => room.id));
  state.ticks = Math.floor(finite(raw.ticks, 0, 0, Number.MAX_SAFE_INTEGER));
  state.room = rooms.has(raw.room ?? '') ? raw.room! : 'intake';
  state.visited = Array.isArray(raw.visited) ? [...new Set(raw.visited.filter(room => rooms.has(room)))] : [];
  state.glowseedCap = glowseedCap({ glowseedCap: finite(raw.glowseedCap, GLOWSEED_POUCH, GLOWSEED_POUCH, GLOWSEED_POUCH_MAX) });
  state.glowseeds = Math.floor(finite(raw.glowseeds, 3, 0, state.glowseedCap));
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

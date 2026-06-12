import type {
  AuthoredLight,
  Ctx,
  EnemyKind,
  ExitPortal,
  LevelExitWell,
  Mechanism,
  Pickup,
  PickupKind,
  PrefabEnemy,
  RuneVault,
  Waystone,
} from '@/core/types';
import type { EditorLight, EditorLink, EditorObject } from '@/builder/document';
import { paramNum } from '@/builder/document';
import { makePickup } from '@/game/Pickups';
import {
  makeBrazier,
  makeBuoy,
  makeChargeLatch,
  makeDoor,
  makeLever,
  makePlate,
  makeScale,
  setDoorCells,
} from '@/game/Mechanisms';
import {
  stampBuoyBasin,
  stampCauldron,
  stampExitWell,
  stampRuneDoor,
  stampRunePedestal,
} from '@/builder/stamps';
import type { CellSetter } from '@/builder/stamps';
import { Cell } from '@/sim/CellType';
import { HEIGHT } from '@/config/constants';

/**
 * SHARED object instantiation: EditorObject/EditorLink/EditorLight records ->
 * live runtime things (pickups, mechanisms with the doors-then-triggers AND
 * gate, rune vaults, authored lights, hazard emitters, deferred enemies).
 *
 * Two consumers, one semantics:
 *  - builder/compile.ts at origin (0,0), spawning enemies immediately;
 *  - worldgen prefab placement at a stamped prefab's origin, deferring enemy
 *    spawns to the levels manager (PrefabEnemy records in the sink).
 */

/** Hazard emitter material names -> cell ids (the inspector's choices). */
export const EMITTER_CELLS: Record<string, number> = {
  water: Cell.Water,
  oil: Cell.Oil,
  acid: Cell.Acid,
  lava: Cell.Lava,
  fire: Cell.Fire,
  ember: Cell.Ember,
  sand: Cell.Sand,
  snow: Cell.Snow,
  smoke: Cell.Smoke,
};

/** Everything instantiation can produce. Arrays are pushed into; landmark
 *  slots (portal/exit/cauldron/boss/keyTaken) are set when the matching
 *  object kind appears — callers copy the ones they care about. */
export interface InstantiationSink {
  pickups: Pickup[];
  mechanisms: Mechanism[];
  runeVaults: RuneVault[];
  authoredLights: AuthoredLight[];
  emitters: Array<{ x: number; y: number; cell: number; rate: number }>;
  enemies: PrefabEnemy[];
  waystones: Waystone[];
  portal?: ExitPortal | null;
  keyTaken?: boolean;
  exit?: LevelExitWell | null;
  cauldron?: { x: number; y: number } | null;
  boss?: { x: number; y: number } | null;
}

export function makeInstantiationSink(): InstantiationSink {
  return {
    pickups: [],
    mechanisms: [],
    runeVaults: [],
    authoredLights: [],
    emitters: [],
    enemies: [],
    waystones: [],
  };
}

/** Spawn a deferred enemy record live (sleeping-bat + patrol fixups). */
export function spawnPrefabEnemy(ctx: Ctx, rec: PrefabEnemy): void {
  ctx.enemyCtl.spawn(rec.kind, rec.x, rec.y);
  const e = ctx.enemies[ctx.enemies.length - 1];
  if (!e) return;
  if (rec.sleeping === true && e.kind === 'bat') {
    e.sleeping = true;
    e.x = rec.x;
    e.y = rec.y;
  }
  if (rec.patrol && rec.patrol.length > 0) {
    e.patrol = rec.patrol.map(([px, py]) => [px, py] as [number, number]);
    e.patrolIdx = 0;
  }
}

/**
 * Instantiate object/link/light records into the sink at (originX, originY).
 * Order is the compile contract: simple objects + structural landmarks first
 * (enemies collected, and spawned via opts.spawnEnemy at their original
 * in-loop moment so door stamping still sees living bodies), then doors,
 * then triggers wired through the links (several triggers on one door =
 * the runtime's AND gate), then rune-door links, then lights.
 */
export function instantiateObjects(
  ctx: Ctx,
  sink: InstantiationSink,
  objects: EditorObject[],
  links: EditorLink[],
  lightDefs: EditorLight[],
  originX: number,
  originY: number,
  set: CellSetter,
  opts?: { spawnEnemy?: (rec: PrefabEnemy) => void },
): void {
  // 1) Simple objects + structural landmarks.
  for (const o of objects) {
    if (o.hidden) continue;
    const ox = Math.floor(o.x) + originX,
      oy = Math.floor(o.y) + originY;
    if (o.kind === 'enemy') {
      const kind = (o.params.kind as EnemyKind) ?? 'slime';
      const rec: PrefabEnemy = { kind, x: ox, y: oy };
      if (o.params.sleeping === true && kind === 'bat') rec.sleeping = true;
      if (Array.isArray(o.params.patrol) && (o.params.patrol as unknown[]).length > 0) {
        rec.patrol = (o.params.patrol as Array<[number, number]>).map(([px, py]) => [
          Math.floor(px) + originX,
          Math.floor(py) + originY,
        ]);
      }
      sink.enemies.push(rec);
      opts?.spawnEnemy?.(rec);
    } else if (o.kind === 'hazardEmitter') {
      sink.emitters.push({
        x: ox,
        y: oy,
        cell: EMITTER_CELLS[String(o.params.cell ?? 'water')] ?? Cell.Water,
        rate: Math.max(2, paramNum(o, 'rate', 30)),
      });
    } else if (o.kind === 'decor') {
      // designer annotation only — never compiles
    } else if (o.kind === 'pickup') {
      const kind = (o.params.kind as PickupKind) ?? 'goldpile';
      sink.pickups.push(
        makePickup(kind, o.x + originX, o.y + originY, {
          amount: typeof o.params.amount === 'number' ? o.params.amount : undefined,
          card: o.params.card as never,
          potion: o.params.potion as never,
        }),
      );
    } else if (o.kind === 'exitPortal') {
      sink.portal = { x: ox, y: oy, open: false };
      if (o.params.alwaysOpen === true) sink.keyTaken = true;
    } else if (o.kind === 'waystone') {
      sink.waystones.push({ x: ox, y: oy, lit: o.params.lit === true });
    } else if (o.kind === 'exitWell') {
      const halfW = paramNum(o, 'halfW', 14);
      stampExitWell(set, ox, oy, halfW, HEIGHT);
      sink.exit = { x: ox, sealY: oy, halfW };
    } else if (o.kind === 'cauldron') {
      stampCauldron(set, ox, oy);
      sink.cauldron = { x: ox, y: oy - 1 };
    } else if (o.kind === 'bossMarker') {
      sink.boss = { x: ox, y: oy };
      const rec: PrefabEnemy = { kind: 'colossus', x: ox, y: oy };
      sink.enemies.push(rec);
      opts?.spawnEnemy?.(rec);
    }
  }

  // 2) Mechanisms: doors first, then triggers wired through the link records.
  //    Several triggers on one door compile to the runtime's AND gate.
  const doorByObj = new Map<string, Mechanism>();
  for (const o of objects) {
    if (o.hidden || o.kind !== 'door') continue;
    const door = makeDoor(
      ctx,
      sink.mechanisms,
      Math.floor(o.x) + originX,
      Math.floor(o.y) + originY,
      paramNum(o, 'w', 3),
      paramNum(o, 'h', 13),
    );
    if (o.params.initialOpen === true) setDoorCells(ctx, door, true);
    if (o.params.logic === 'or' || o.params.logic === 'sequence') door.logic = o.params.logic;
    doorByObj.set(o.id, door);
  }
  const objById = new Map(objects.map((o) => [o.id, o] as const));
  for (const link of links) {
    if (link.kind !== 'triggerDoor') continue;
    const trig = objById.get(link.fromId);
    const door = doorByObj.get(link.toId);
    if (!trig || trig.hidden || !door) continue;
    instantiateTrigger(ctx, sink.mechanisms, trig, door, set, originX, originY);
  }

  // 3) Rune vaults: glyph pedestal + dissolving stone door per rune link.
  for (const link of links) {
    if (link.kind !== 'runeDoor') continue;
    const glyph = objById.get(link.fromId);
    const slab = objById.get(link.toId);
    if (!glyph || !slab || glyph.hidden || slab.hidden) continue;
    const gx = Math.floor(glyph.x) + originX,
      gy = Math.floor(glyph.y) + originY;
    stampRunePedestal(set, gx, gy);
    const cells = stampRuneDoor(
      set,
      Math.floor(slab.x) + originX,
      Math.floor(slab.y) + originY,
      paramNum(slab, 'w', 2),
      paramNum(slab, 'h', 11),
    );
    sink.runeVaults.push({ rx: gx, ry: gy - 2, door: cells, active: false });
  }

  // 4) Authored lights (flicker phase keyed by running index in the sink).
  for (const l of lightDefs) {
    if (l.hidden) continue;
    sink.authoredLights.push(
      toAuthoredLight(
        { ...l, x: l.x + originX, y: l.y + originY },
        sink.authoredLights.length,
      ),
    );
  }
}

function instantiateTrigger(
  ctx: Ctx,
  list: Mechanism[],
  o: EditorObject,
  door: Mechanism,
  set: CellSetter,
  originX: number,
  originY: number,
): void {
  const x = Math.floor(o.x) + originX,
    y = Math.floor(o.y) + originY;
  if (o.kind === 'plate') {
    const w = paramNum(o, 'w', 5);
    makePlate(ctx.world, list, x - Math.floor(w / 2), y, w, door);
  } else if (o.kind === 'lever') {
    makeLever(list, x, y, door);
  } else if (o.kind === 'brazier') {
    makeBrazier(ctx.world, list, x, y, door);
  } else if (o.kind === 'scale') {
    const w = paramNum(o, 'w', 7);
    makeScale(ctx.world, list, x - Math.floor(w / 2), y, w, paramNum(o, 'threshold', 24), door);
  } else if (o.kind === 'buoy') {
    const { body, zone } = stampBuoyBasin(
      set,
      x,
      y,
      paramNum(o, 'w', 13),
      paramNum(o, 'depth', 4),
    );
    makeBuoy(list, x, y - 1, zone, paramNum(o, 'threshold', 26), door, body);
  } else if (o.kind === 'chargeLatch') {
    makeChargeLatch(ctx.world, list, x, y, door);
  }
}

/** EditorLight (authoring record) -> AuthoredLight (runtime seeding data). */
export function toAuthoredLight(l: EditorLight, n: number): AuthoredLight {
  const hex = /^#?([0-9a-f]{6})$/i.exec(l.color.trim());
  const rgb = hex ? parseInt(hex[1], 16) : 0xffffff;
  return {
    x: Math.floor(l.x),
    y: Math.floor(l.y),
    r: ((rgb >> 16) & 0xff) / 255,
    g: ((rgb >> 8) & 0xff) / 255,
    b: (rgb & 0xff) / 255,
    intensity: l.intensity,
    radius: l.radius,
    bloom: l.bloom,
    flicker: l.flicker,
    flickerPhase: (n * 2.39996) % (Math.PI * 2),
    falloff: l.falloff,
    occluded: l.occluded,
  };
}

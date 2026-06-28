import type {
  AuthoredLight,
  Ctx,
  EnemyKind,
  ExitPortal,
  HazardEmitter,
  LevelExitWell,
  Mechanism,
  Pickup,
  PickupKind,
  PrefabEnemy,
  RuneVault,
  RuntimeDecor,
  Waystone,
} from '@/core/types';
import {
  AUTHORED_LIGHT_BLOOM_MAX,
  AUTHORED_LIGHT_FLICKER_MAX,
  AUTHORED_LIGHT_INTENSITY_MAX,
  AUTHORED_LIGHT_RADIUS_MAX,
  AUTHORED_LIGHT_RADIUS_MIN,
  paramNum,
} from '@/authoring/document';
import type { EditorLight, EditorLink, EditorObject } from '@/authoring/document';
import { resolveLoopTag, spritePhase } from '@/authoring/sprites';
import type { SpriteAsset } from '@/authoring/sprites';
import { resolveRuntimeSprite } from '@/authoring/spriteRuntime';
import type { ResolvedSprite, SpriteAssetLookup } from '@/authoring/spriteRuntime';
import { ALL_CARD_IDS } from '@/combat/wands/cards';
import { makePickup, POTION_KINDS } from '@/core/pickupDefs';
import {
  makeBrazier,
  makeBuoy,
  makeChargeLatch,
  makeCounterweight,
  makeDoor,
  makeLever,
  makePlate,
  makePlug,
  makeRelay,
  makeScale,
  makeSensor,
  makeValve,
  setDoorCells,
} from '@/core/mechanismFactories';
import {
  stampBuoyBasin,
  stampCauldron,
  stampExitWell,
  stampRuneDoor,
  stampRunePedestal,
} from '@/authoring/stamps';
import type { CellSetter } from '@/authoring/stamps';
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

const CARD_ID_SET = new Set<string>(ALL_CARD_IDS);
const POTION_ID_SET = new Set<string>(POTION_KINDS);

function fixedCardParam(value: unknown): Pickup['data']['card'] | undefined {
  if (typeof value !== 'string' || value === '' || value === 'random') return undefined;
  return CARD_ID_SET.has(value) ? (value as Pickup['data']['card']) : undefined;
}

function fixedPotionParam(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '' || value === 'random') return undefined;
  return POTION_ID_SET.has(value) ? value : undefined;
}

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
  nitrogen: Cell.Nitrogen,
  healium: Cell.Healium,
};

/** Valve gate material names -> cell ids (rigid, channel-blocking). */
export const VALVE_CELLS: Record<string, number> = {
  metal: Cell.Metal,
  stone: Cell.Stone,
  wood: Cell.Wood,
  glass: Cell.Glass,
};

/** Plug body material names -> cell ids. The material IS the break profile:
 *  wood burns, glass shatters, ash/sand collapse, stone resists fire, metal
 *  resists everything (relay 'break' only). */
export const PLUG_CELLS: Record<string, number> = {
  wood: Cell.Wood,
  ash: Cell.Ash,
  glass: Cell.Glass,
  coal: Cell.Coal,
  stone: Cell.Stone,
  sand: Cell.Sand,
  metal: Cell.Metal,
};

/** Sensor 'liquid'/'material' filter names -> cell ids. */
export const SENSOR_FILTER_CELLS: Record<string, number> = {
  water: Cell.Water,
  oil: Cell.Oil,
  acid: Cell.Acid,
  lava: Cell.Lava,
  sand: Cell.Sand,
  snow: Cell.Snow,
  gold: Cell.Gold,
  gunpowder: Cell.Gunpowder,
  coal: Cell.Coal,
  ash: Cell.Ash,
  slime: Cell.Slime,
  healium: Cell.Healium,
  teleportium: Cell.Teleportium,
};

const SENSOR_TYPES = new Set(['heat', 'liquid', 'weight', 'charge', 'material']);
const LATCH_MODES = new Set(['momentary', 'timed', 'permanent']);
const RELAY_ACTIONS = new Set(['activate', 'ignite', 'break', 'strike']);
/** Machine trigger kinds instantiated object-first, wired from their out-link. */
const MACHINE_TRIGGER_KINDS = new Set(['sensor', 'counterweight', 'plug']);

/** Everything instantiation can produce. Arrays are pushed into; landmark
 *  slots (portal/exit/cauldron/boss/keyTaken) are set when the matching
 *  object kind appears — callers copy the ones they care about. */
export interface InstantiationSink {
  pickups: Pickup[];
  mechanisms: Mechanism[];
  runeVaults: RuneVault[];
  authoredLights: AuthoredLight[];
  emitters: HazardEmitter[];
  enemies: PrefabEnemy[];
  waystones: Waystone[];
  /** Animated sprite decor (visual-only — see the decor branch below). */
  decors: RuntimeDecor[];
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
    decors: [],
  };
}

/** Spawn a deferred enemy record live (sleeping-bat + patrol fixups). */
export function spawnPrefabEnemy(ctx: Ctx, rec: PrefabEnemy): void {
  const e = ctx.enemyCtl.spawn(rec.kind, rec.x, rec.y);
  if (!e) return;
  if (rec.sleeping === true && (e.kind === 'bat' || e.kind === 'weaver')) {
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
  opts?: {
    spawnEnemy?: (rec: PrefabEnemy) => void;
    /** Document-embedded sprite assets (Builder compile passes doc.assets). */
    docSprites?: SpriteAsset[];
    /** Shared decode cache — worldgen threads one across all its prefabs. */
    spriteCache?: Map<string, ResolvedSprite | null>;
    /** Optional external sprite resolver; Builder passes local sprite storage here. */
    spriteLookup?: SpriteAssetLookup;
  },
): void {
  const spriteCache = opts?.spriteCache ?? new Map<string, ResolvedSprite | null>();
  const spriteLookup = opts?.spriteLookup ?? (() => null);
  // 1) Simple objects + structural landmarks.
  for (const o of objects) {
    if (o.hidden) continue;
    const ox = Math.floor(o.x) + originX,
      oy = Math.floor(o.y) + originY;
    if (o.kind === 'enemy') {
      const kind = (o.params.kind as EnemyKind) ?? 'slime';
      const rec: PrefabEnemy = { kind, x: ox, y: oy, sourceId: o.id };
      if (o.params.sleeping === true && (kind === 'bat' || kind === 'weaver')) rec.sleeping = true;
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
        // the object's rotation is the drip direction (0=down, 90=left,
        // 180=up, 270=right); burst/phase let banks of emitters stagger
        dir: o.rotation,
        burst: Math.max(1, Math.min(8, Math.floor(paramNum(o, 'burst', 1)))),
        phase: Math.max(0, Math.floor(paramNum(o, 'phase', 0))),
      });
    } else if (o.kind === 'decor') {
      // VISUAL-ONLY INVARIANT: animated decor is presentation, the same
      // class as enemy sprites and pickup glyphs. It never writes cells,
      // never collides, never blocks, never gates progression — the grid
      // doesn't know it's there. A decor WITHOUT a spriteId is the legacy
      // designer note: annotation only, never compiles. An UNRESOLVABLE
      // spriteId is silently skipped — a missing visual must never break
      // compile or generation (Builder can provide a local-library lookup;
      // document-embedded assets remain the portable fallback).
      const spriteId = typeof o.params.spriteId === 'string' ? o.params.spriteId : '';
      if (spriteId !== '') {
        const resolved = resolveRuntimeSprite(spriteId, opts?.docSprites, spriteCache, spriteLookup);
        if (resolved) {
          const loopTag = typeof o.params.loopTag === 'string' ? o.params.loopTag : '';
          const { from, to, dir } = resolveLoopTag(resolved.asset, loopTag);
          const fps = paramNum(o, 'fps', 0);
          sink.decors.push({
            x: ox,
            y: oy,
            sprite: resolved.sprite,
            from,
            to,
            dir,
            flipX: o.params.flipX === true,
            phase: spritePhase(o.id),
            tickScale: fps > 0 ? Math.min(60, fps) / 60 : 0,
          });
        }
      }
    } else if (o.kind === 'pickup') {
      const kind = (o.params.kind as PickupKind) ?? 'goldpile';
      sink.pickups.push(
        // Use the precomputed integer origin (ox/oy) like every sibling object,
        // not the raw float o.x/o.y, so pickups land on integer cell coords.
        makePickup(kind, ox, oy, {
          amount: typeof o.params.amount === 'number' ? o.params.amount : undefined,
          card: fixedCardParam(o.params.card),
          potion: fixedPotionParam(o.params.potion),
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
      const rec: PrefabEnemy = { kind: 'colossus', x: ox, y: oy, sourceId: o.id };
      sink.enemies.push(rec);
      opts?.spawnEnemy?.(rec);
    }
  }

  // 2) Mechanisms: ACTUATORS first (doors, valves, relays — they receive
  //    links), then machine triggers (sensor/counterweight/plug exist with
  //    or without a link: a plug is a real seal even when it signals
  //    nothing), then legacy triggers wired per-link, then one final wiring
  //    pass resolving every machine-trigger/relay output. Several triggers
  //    on one actuator compile to the runtime's AND gate.
  const mechByObj = new Map<string, Mechanism>();
  for (const o of objects) {
    if (o.hidden) continue;
    const ox = Math.floor(o.x) + originX,
      oy = Math.floor(o.y) + originY;
    if (o.kind === 'door') {
      const door = makeDoor(ctx, sink.mechanisms, ox, oy, paramNum(o, 'w', 3), paramNum(o, 'h', 13));
      if (o.params.initialOpen === true) setDoorCells(ctx, door, true);
      if (o.params.logic === 'or' || o.params.logic === 'sequence') door.logic = o.params.logic;
      mechByObj.set(o.id, door);
    } else if (o.kind === 'valve') {
      const logic = o.params.logic;
      const valve = makeValve(ctx, sink.mechanisms, ox, oy, paramNum(o, 'w', 5), paramNum(o, 'h', 2), {
        material: VALVE_CELLS[String(o.params.material ?? 'metal')] ?? Cell.Metal,
        oneShot: o.params.oneShot === true,
        autoCloseFrames: Math.max(0, Math.floor(paramNum(o, 'autoClose', 0))),
        logic: logic === 'or' || logic === 'sequence' ? logic : undefined,
      });
      mechByObj.set(o.id, valve);
    } else if (o.kind === 'relay') {
      const logic = o.params.logic;
      const action = String(o.params.action ?? 'activate');
      const relay = makeRelay(sink.mechanisms, ox, oy, {
        delayFrames: Math.max(0, Math.floor(paramNum(o, 'delay', 0))),
        outputAction: RELAY_ACTIONS.has(action)
          ? (action as NonNullable<Mechanism['outputAction']>)
          : undefined,
        logic: logic === 'or' || logic === 'sequence' ? logic : undefined,
      });
      mechByObj.set(o.id, relay);
    } else if (o.kind === 'sensor') {
      const zw = Math.max(1, Math.floor(paramNum(o, 'zoneW', 9)));
      const zh = Math.max(1, Math.floor(paramNum(o, 'zoneH', 7)));
      const zx0 = ox - Math.floor(zw / 2);
      const stype = String(o.params.type ?? 'heat');
      const latch = String(o.params.latch ?? 'timed');
      const filterName = String(o.params.filter ?? '');
      const filterCell = SENSOR_FILTER_CELLS[filterName];
      const sensor = makeSensor(
        ctx.world,
        sink.mechanisms,
        ox,
        oy,
        {
          sensorType: SENSOR_TYPES.has(stype)
            ? (stype as NonNullable<Mechanism['sensorType']>)
            : 'heat',
          threshold: Math.max(1, Math.floor(paramNum(o, 'threshold', 6))),
          // the zone sits above the sensor node, like a scale's pan zone
          zone: { x0: zx0, y0: oy - zh, x1: zx0 + zw - 1, y1: oy - 1 },
          latch: LATCH_MODES.has(latch) ? (latch as NonNullable<Mechanism['latch']>) : undefined,
          latchFrames: paramNum(o, 'latchFrames', 0) > 0 ? Math.floor(paramNum(o, 'latchFrames', 0)) : undefined,
          materialFilter: filterCell !== undefined ? [filterCell] : undefined,
        },
        null,
      );
      mechByObj.set(o.id, sensor);
    } else if (o.kind === 'counterweight') {
      const w = Math.max(3, Math.floor(paramNum(o, 'w', 7)));
      const cw = makeCounterweight(
        ctx.world,
        sink.mechanisms,
        ox - Math.floor(w / 2),
        oy,
        w,
        Math.max(1, Math.floor(paramNum(o, 'threshold', 30))),
        null,
      );
      mechByObj.set(o.id, cw);
    } else if (o.kind === 'plug') {
      const plug = makePlug(
        ctx.world,
        sink.mechanisms,
        ox,
        oy,
        Math.max(1, Math.floor(paramNum(o, 'w', 3))),
        Math.max(1, Math.floor(paramNum(o, 'h', 3))),
        PLUG_CELLS[String(o.params.material ?? 'wood')] ?? Cell.Wood,
        null,
        paramNum(o, 'breakFrac', 0.5),
      );
      mechByObj.set(o.id, plug);
    }
  }
  const objById = new Map(objects.map((o) => [o.id, o] as const));
  for (const link of links) {
    if (link.kind !== 'triggerDoor') continue;
    const trig = objById.get(link.fromId);
    const target = mechByObj.get(link.toId);
    if (!trig || trig.hidden || !target) continue;
    // machine triggers + relays already exist; their output resolves below
    if (MACHINE_TRIGGER_KINDS.has(trig.kind) || trig.kind === 'relay') {
      const src = mechByObj.get(trig.id);
      if (src) src.targetId = target.id;
      continue;
    }
    const m = instantiateTrigger(ctx, sink.mechanisms, trig, target, set, originX, originY);
    if (m) mechByObj.set(trig.id, m);
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
): Mechanism | null {
  const x = Math.floor(o.x) + originX,
    y = Math.floor(o.y) + originY;
  if (o.kind === 'plate') {
    const w = paramNum(o, 'w', 5);
    return makePlate(ctx.world, list, x - Math.floor(w / 2), y, w, door);
  } else if (o.kind === 'lever') {
    return makeLever(list, x, y, door);
  } else if (o.kind === 'brazier') {
    return makeBrazier(ctx.world, list, x, y, door);
  } else if (o.kind === 'scale') {
    const w = paramNum(o, 'w', 7);
    return makeScale(ctx.world, list, x - Math.floor(w / 2), y, w, paramNum(o, 'threshold', 24), door);
  } else if (o.kind === 'buoy') {
    const { body, zone } = stampBuoyBasin(
      set,
      x,
      y,
      paramNum(o, 'w', 13),
      paramNum(o, 'depth', 4),
    );
    return makeBuoy(list, x, y - 1, zone, paramNum(o, 'threshold', 26), door, body);
  } else if (o.kind === 'chargeLatch') {
    return makeChargeLatch(ctx.world, list, x, y, door);
  }
  return null;
}

/** EditorLight (authoring record) -> AuthoredLight (runtime seeding data). */
export function toAuthoredLight(l: EditorLight, n: number): AuthoredLight {
  const hex = /^#?([0-9a-f]{6})$/i.exec(l.color.trim());
  const rgb = hex ? parseInt(hex[1], 16) : 0xffffff;
  const intensity = clampFinite(l.intensity, 0, AUTHORED_LIGHT_INTENSITY_MAX, 1);
  const radius = clampFinite(l.radius, AUTHORED_LIGHT_RADIUS_MIN, AUTHORED_LIGHT_RADIUS_MAX, 60);
  const bloom = clampFinite(l.bloom, 0, AUTHORED_LIGHT_BLOOM_MAX, 0);
  const flicker = clampFinite(l.flicker, 0, AUTHORED_LIGHT_FLICKER_MAX, 0);
  return {
    x: Math.floor(l.x),
    y: Math.floor(l.y),
    r: ((rgb >> 16) & 0xff) / 255,
    g: ((rgb >> 8) & 0xff) / 255,
    b: (rgb & 0xff) / 255,
    intensity,
    radius,
    bloom,
    flicker,
    flickerPhase: (n * 2.39996) % (Math.PI * 2),
    falloff: l.falloff,
    occluded: l.occluded,
  };
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

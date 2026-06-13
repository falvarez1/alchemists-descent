import { describe, expect, it } from 'vitest';
import type { LevelDef, Mechanism } from '@/core/types';
import { buildMechanismTriggerIndex, mechanismTriggersFor } from '@/core/mechanisms';
import { makeLevelRuntime } from '@/game/runtime';
import { World } from '@/sim/World';

const def: LevelDef = {
  id: 'test',
  name: 'Test',
  biome: 'earthen',
  depth: 1,
  nextLevelId: null,
};

function mech(id: number, kind: Mechanism['kind'], targetId: number): Mechanism {
  return { id, kind, x: id, y: id, w: 1, h: 1, state: 0, targetId };
}

describe('mechanism trigger index', () => {
  it('groups actuator triggers in mechanism list order and excludes doors as triggers', () => {
    const door = mech(10, 'door', -1);
    const lever = mech(11, 'lever', door.id);
    const plate = mech(12, 'plate', door.id);
    const otherDoor = mech(13, 'door', door.id);

    const index = buildMechanismTriggerIndex([door, lever, plate, otherDoor]);

    expect(index.get(door.id)).toEqual([lever, plate]);
  });

  it('is attached to level runtimes and can exclude malformed self-targets', () => {
    const relay = mech(7, 'relay', 7);
    const lever = mech(8, 'lever', 7);
    const runtime = makeLevelRuntime({
      def,
      world: new World(),
      spawn: { x: 20, y: 20 },
      regions: null,
      mechanisms: [relay, lever],
    });

    expect(mechanismTriggersFor(runtime, relay.id, relay)).toEqual([lever]);
  });
});

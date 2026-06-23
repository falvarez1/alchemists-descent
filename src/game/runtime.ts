import { MINIMAP_H, MINIMAP_W } from '@/config/constants';
import { buildMechanismTriggerIndex } from '@/core/mechanisms';
import type { LevelDef, LevelRuntime } from '@/core/types';
import type { World } from '@/sim/World';

/**
 * THE LevelRuntime constructor: every playable level — generated, restored
 * from a save, wrapped from a sandbox world, or (future) compiled from a
 * Builder EditorDocument — is assembled here. One entry point means one
 * place where the runtime shape can evolve.
 */
export function makeLevelRuntime(
  base: {
    def: LevelDef;
    world: World;
    spawn: { x: number; y: number };
    regions: LevelRuntime['regions'];
  } & Partial<
    Pick<
      LevelRuntime,
      | 'enemies'
      | 'waystones'
      | 'exit'
      | 'explored'
      | 'cauldron'
      | 'pickups'
      | 'portal'
      | 'keyTaken'
      | 'mechanisms'
      | 'runeVaults'
      | 'boss'
      | 'authoredLights'
      | 'backdrop'
      | 'backdropLevelId'
      | 'emitters'
      | 'placedPrefabs'
      | 'inspectionMarkers'
      | 'generatedScenes'
      | 'decors'
      | 'weaverLairWebs'
      | 'refuge'
      | 'spellLab'
      | 'vaultArch'
    >
  >,
): LevelRuntime {
  const runtime: LevelRuntime = {
    enemies: [],
    waystones: [],
    exit: null,
    explored: new Uint8Array(MINIMAP_W * MINIMAP_H),
    cauldron: null,
    pickups: [],
    portal: null,
    keyTaken: false,
    mechanisms: [],
    runeVaults: [],
    boss: null,
    weaverLairWebs: [],
    ...base,
  };
  runtime.mechanismTriggers = buildMechanismTriggerIndex(runtime.mechanisms);
  return runtime;
}

/**
 * The catalog resolved for the runtime: each cue with its family's defaults
 * folded in, and the cues per load pack. Game code imports this; the file
 * URLs live in content/audio/sfxManifest.ts, which the SampleBank loads
 * lazily on the first gesture so the up-front bundle carries no URL table.
 */
import {
  CORE_SFX_PACKS,
  SFX_CATEGORIES,
  SFX_CUES,
  type SfxBus,
  type SfxCategory,
  type SfxCategoryDef,
  type SfxCueDef,
  type SfxId,
} from '@/content/audio/sfxCues';

/** A cue with its category defaults folded in. */
export interface ResolvedSfxCue extends SfxCategoryDef {
  id: SfxId;
  pack: string;
  cat: SfxCategory;
  bus: SfxBus;
  loop: boolean;
  keepAliveMs: number;
}

const RESOLVED = new Map<SfxId, ResolvedSfxCue>();
export function sfxCue(id: SfxId): ResolvedSfxCue {
  let r = RESOLVED.get(id);
  if (!r) {
    const def: SfxCueDef = SFX_CUES[id];
    const cat = SFX_CATEGORIES[def.cat];
    r = {
      ...cat,
      id,
      pack: def.pack,
      cat: def.cat,
      gain: cat.gain * (def.gain ?? 1),
      range: def.range ?? cat.range,
      voices: def.voices ?? cat.voices,
      cooldownMs: def.cooldownMs ?? cat.cooldownMs,
      pitchCents: def.pitchCents ?? cat.pitchCents,
      priority: def.priority ?? cat.priority,
      bus: def.bus ?? cat.bus,
      loop: def.loop === true,
      keepAliveMs: def.keepAliveMs ?? 220,
    };
    RESOLVED.set(id, r);
  }
  return r;
}

export const SFX_IDS = Object.keys(SFX_CUES) as SfxId[];

const PACKS = new Map<string, SfxId[]>();
for (const id of SFX_IDS) {
  const pack = SFX_CUES[id].pack;
  const list = PACKS.get(pack) ?? [];
  list.push(id);
  PACKS.set(pack, list);
}

/** The cues in a load pack. */
export function packCues(pack: string): readonly SfxId[] {
  return PACKS.get(pack) ?? [];
}

/** Every pack name. */
export const SFX_PACKS: readonly string[] = [...PACKS.keys()];
export { CORE_SFX_PACKS };

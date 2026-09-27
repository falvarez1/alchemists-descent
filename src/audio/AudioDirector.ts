import type { Ctx, EnemyKind } from '@/core/types';
import type { SfxAudioEngine } from '@/audio/SfxEngine';
import { LEVELS, SPINE_ROSTERS } from '@/config/worldgraph';
import { FLOOR_FAUNA } from '@/game/organisms/placement';
import { BIOME_BEDS, CORE_SFX_PACKS, FLOOR_BEDS, SFX_CUES, type SfxId } from '@/content/audio/sfxCues';

/**
 * Decides what the sampled layer holds in memory and which bed is playing.
 *
 * - The core packs (UI, player, spells, world) load right after the first
 *   gesture (SfxAudioEngine queues them at construction).
 * - Entering a floor requests that floor's ambience bed, a pack per creature
 *   kind actually living there (plus its boss), a pack per organism kind
 *   in its census (game/organisms FLOOR_FAUNA), and the Bell & Tea Engine on
 *   floor 1.
 * - At the Sanctum between floors the NEXT floor's roster and bed are
 *   prefetched, so the descent arrives already sounding right.
 * - Packs nobody has needed for a while are released (decoded PCM is the
 *   memory cost of sampled audio; core packs are never dropped).
 *
 * Runs on its own 400 ms timer rather than the game tick, so it keeps working
 * while the game is paused (the Sanctum, the pause menu).
 */
const CADENCE_MS = 400;
/** A pack unused this long is released. */
const RELEASE_AFTER_MS = 30_000;

const bedPack = (id: SfxId | null): string | null => (id ? SFX_CUES[id].pack : null);
const creaturePack = (kind: EnemyKind): string => `creature-${kind}`;
const organismPack = (kind: string): string => `org-${kind}`;

/** The organism packs a level's census wants (a kind with no cues simply has no pack). */
function faunaPacks(levelId: string | undefined): string[] {
  const def = levelId ? LEVELS[levelId] : undefined;
  return def ? Object.keys(FLOOR_FAUNA[def.biome] ?? {}).map(organismPack) : [];
}

function levelBed(levelId: string | undefined, biome: string | undefined): SfxId | null {
  if (levelId && FLOOR_BEDS[levelId]) return FLOOR_BEDS[levelId];
  return biome ? BIOME_BEDS[biome] ?? null : null;
}

/** The creature packs a level will want: its spine roster, its boss, and whatever is alive in it. */
function rosterPacks(levelId: string | undefined): string[] {
  const def = levelId ? LEVELS[levelId] : undefined;
  if (!def) return [];
  const packs = Object.keys(SPINE_ROSTERS[def.biome] ?? {}).map((k) => creaturePack(k as EnemyKind));
  if (def.boss) packs.push(creaturePack(def.boss as EnemyKind));
  return packs;
}

export function installAudioDirector(ctx: Ctx, engine: SfxAudioEngine): () => void {
  const lastWanted = new Map<string, number>();
  const core = new Set(CORE_SFX_PACKS);

  const tick = (): void => {
    const now = performance.now();
    const wanted = new Set<string>();
    let bed: SfxId | null = null;
    const runtime = ctx.state.mode === 'play' ? ctx.levels?.current : null;
    if (runtime) {
      const def = runtime.def;
      bed = levelBed(def.id, def.biome);
      const bp = bedPack(bed);
      if (bp) wanted.add(bp);
      for (const e of ctx.enemies) wanted.add(creaturePack(e.kind));
      if (runtime.boss) wanted.add(creaturePack(runtime.boss.kind ?? 'colossus'));
      for (const p of rosterPacks(def.id)) wanted.add(p);
      // Organisms load with their floor (and with any level an author seeded them in).
      for (const p of faunaPacks(def.id)) wanted.add(p);
      for (const c of ctx.critters?.list ?? []) wanted.add(organismPack(c.kind));
      if (runtime.living) wanted.add('tea');
      // Between floors: fetch the next one before the player gets there.
      if (ctx.sanctum?.isOpen && def.nextLevelId) {
        const next = LEVELS[def.nextLevelId];
        const nb = bedPack(levelBed(next?.id, next?.biome));
        if (nb) wanted.add(nb);
        for (const p of rosterPacks(def.nextLevelId)) wanted.add(p);
        for (const p of faunaPacks(def.nextLevelId)) wanted.add(p);
      }
    }
    // Only real packs (a kind with no creature cues has no pack).
    const known = new Set(Object.values(SFX_CUES).map((c) => c.pack));
    const request = [...wanted].filter((p) => known.has(p));
    for (const p of request) lastWanted.set(p, now);
    engine.requestPacks(request);
    for (const p of engine.bank.packs()) {
      if (core.has(p)) continue;
      const seen = lastWanted.get(p);
      // A pack someone else asked for (a probe, a future caller) gets the same grace.
      if (seen === undefined) { lastWanted.set(p, now); continue; }
      if (now - seen > RELEASE_AFTER_MS) { engine.releasePack(p); lastWanted.delete(p); }
    }
    engine.setAmbience(bed);
    engine.tickAmbience();
  };

  tick();
  const timer = setInterval(tick, CADENCE_MS);
  return () => clearInterval(timer);
}

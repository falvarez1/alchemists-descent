/**
 * Where every sampled cue's files are, and its resolved mix settings.
 *
 * The files are discovered with an eager `import.meta.glob(..., '?url')`: the
 * build hashes and emits them, and this module only holds their URLs — nothing
 * is fetched until audio/SampleBank.ts asks, after the first user gesture.
 * `no-inline` keeps Vite from base64-inlining the tiny clicks into the JS.
 *
 * `AUDITION_ENTRIES` feeds the dev-only audition page (audition.html), which
 * discovers every `src/content/audio/*Manifest.ts` exporting it.
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
import { SFX_PROMPTS } from '../../../scripts/audio/sfx-prompts.mjs';

const FILES = import.meta.glob('/src/assets/audio/{sfx,ambience}/**/*.mp3', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const URLS = new Map<string, string[]>();
{
  const takes = new Map<string, Array<[number, string]>>();
  for (const [path, url] of Object.entries(FILES)) {
    const m = /\/([^/]+)-(\d+)\.mp3$/.exec(path);
    if (!m) continue;
    const list = takes.get(m[1]) ?? [];
    list.push([Number(m[2]), url]);
    takes.set(m[1], list);
  }
  for (const [id, list] of takes) URLS.set(id, list.sort((a, b) => a[0] - b[0]).map(([, url]) => url));
}

/** Every take of a cue, in take order (empty when the cue has no files yet). */
export function sfxUrls(id: SfxId): readonly string[] {
  return URLS.get(id) ?? [];
}

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

// ------------------------------------------------------------ audition

/** One auditionable sound (the dev audition page lists these across all manifests). */
export interface AuditionEntry {
  id: string;
  group: string;
  label: string;
  prompt: string;
  urls: string[];
  loop?: boolean;
  /** Optional: the linear gain the game plays this cue at (the page's "at mix level"). */
  gain?: number;
}

function buildAuditionEntries(): AuditionEntry[] {
  return SFX_IDS.map((id) => {
    const cue = sfxCue(id);
    const group = cue.pack.startsWith('creature-') ? `Creature · ${cue.pack.slice(9)}` : cue.pack.startsWith('amb') ? 'Ambience' : cue.pack;
    return {
      id,
      group: `SFX · ${group}`,
      label: `${id}  (${cue.cat}, ${cue.bus})`,
      prompt: SFX_PROMPTS[id]?.p ?? '',
      urls: [...sfxUrls(id)],
      loop: cue.loop || undefined,
      gain: cue.gain,
    };
  });
}

/** Tree-shaken out of the game bundle: only the dev audition page imports it. */
export const AUDITION_ENTRIES: AuditionEntry[] = /* @__PURE__ */ buildAuditionEntries();

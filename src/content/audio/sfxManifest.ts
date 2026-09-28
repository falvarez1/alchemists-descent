/**
 * Where every sampled cue's files are.
 *
 * The files are discovered with an eager `import.meta.glob(..., '?url')`: the
 * build hashes and emits them, and this module only holds their URLs.
 * `no-inline` keeps Vite from base64-inlining the tiny clicks into the JS.
 * The game never imports this module statically — audio/SampleBank.ts loads
 * it on the first gesture — so neither the URL table nor any audio byte is in
 * the first-load transfer.
 *
 * `AUDITION_ENTRIES` feeds the dev-only audition page (audition.html), which
 * discovers every `src/content/audio/*Manifest.ts` exporting it.
 */
import type { SfxId } from '@/content/audio/sfxCues';
import { SFX_IDS, sfxCue } from '@/content/audio/sfxCatalog';
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
    const group = cue.pack.startsWith('creature-') ? `Creature · ${cue.pack.slice(9)}`
      : cue.pack.startsWith('org-') ? `Organism · ${cue.pack.slice(4)}`
      : cue.pack.startsWith('amb') ? 'Ambience' : cue.pack;
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

/** Tree-shaken out of the game's lazy manifest chunk: only the dev audition page reads it. */
export const AUDITION_ENTRIES: AuditionEntry[] = /* @__PURE__ */ buildAuditionEntries();

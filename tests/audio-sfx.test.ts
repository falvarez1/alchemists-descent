import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  BIOME_BEDS,
  CORE_SFX_PACKS,
  FLOOR_BEDS,
  SFX_CATEGORIES,
  SFX_CUES,
  TEA_STAGE_SFX,
  isSfxId,
  type SfxId,
} from '@/content/audio/sfxCues';
import { AUDITION_ENTRIES, sfxUrls } from '@/content/audio/sfxManifest';
import { SFX_IDS, SFX_PACKS, packCues, sfxCue } from '@/content/audio/sfxCatalog';
import { SFX_PROMPTS } from '../scripts/audio/sfx-prompts.mjs';
import { ENEMY_KINDS } from '@/core/types';
import { SPINE_ROSTERS } from '@/config/worldgraph';
import { PENDING_SFX_RECORDING } from './pendingSfx';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const ASSETS = join(SRC, 'assets', 'audio');

const walk = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; }) : [];

/** Every take on disk, by cue id. */
const filesOnDisk = new Map<string, string[]>();
for (const f of walk(ASSETS)) {
  const m = /[\\/]([^\\/]+)-(\d+)\.mp3$/.exec(f);
  if (!m) continue;
  filesOnDisk.set(m[1], [...(filesOnDisk.get(m[1]) ?? []), f]);
}
/** Cues awaiting their recording (tests/pendingSfx.ts): in the catalog with a prompt and a fallback, no takes yet. */
const PENDING = new Set<string>(PENDING_SFX_RECORDING);
const hasFiles = (id: string): boolean => (filesOnDisk.get(id)?.length ?? 0) > 0 || PENDING.has(id);

const srcFiles = walk(SRC).filter((f) => f.endsWith('.ts'));
const read = (f: string): string => readFileSync(f, 'utf8');

/**
 * The AudioApi methods that make a sound. Everything in the interface that is
 * NOT here is plumbing (lifecycle, volume, placement) or a raw primitive.
 */
const PLUMBING = new Set(['enabled', 'ensure', 'toggle', 'setListener', 'at', 'duck', 'setVolume', 'tone', 'noiseBurst', 'sfx', 'creature', 'stinger']);

function audioApiMethods(): string[] {
  const types = read(join(SRC, 'core', 'types.ts')).replace(/\r/g, '');
  const start = types.indexOf('export interface AudioApi {');
  const body = types.slice(start, types.indexOf('\n}\n', start) + 1);
  const names = new Set<string>();
  for (const m of body.matchAll(/^\s{2}(?:readonly\s+)?([a-zA-Z]+)\??\(/gm)) names.add(m[1]);
  return [...names];
}

describe('the sampled sound catalog', () => {
  it('has a prompt for every cue and a cue for every prompt', () => {
    const cues = Object.keys(SFX_CUES).sort();
    expect(Object.keys(SFX_PROMPTS).sort()).toEqual(cues);
  });

  it('has at least one mastered file on disk for every cue, and the manifest finds them', () => {
    const missing = SFX_IDS.filter((id) => !hasFiles(id));
    expect(missing).toEqual([]);
    const unresolved = SFX_IDS.filter((id) => sfxUrls(id).length !== (filesOnDisk.get(id)?.length ?? 0));
    expect(unresolved).toEqual([]);
  });

  it('lists as pending only cues that really have no takes yet (so the list cannot rot)', () => {
    for (const id of PENDING_SFX_RECORDING) {
      expect(isSfxId(id), id).toBe(true);
      expect(filesOnDisk.get(id)?.length ?? 0, id + ' has files: take it off tests/pendingSfx.ts').toBe(0);
    }
  });

  it('keeps no stray files that no cue owns', () => {
    const stray = [...filesOnDisk.keys()].filter((id) => !isSfxId(id));
    expect(stray).toEqual([]);
  });

  it('files each take under its cue pack', () => {
    for (const id of SFX_IDS) {
      const pack = SFX_CUES[id].pack;
      for (const f of filesOnDisk.get(id) ?? []) {
        expect(relative(ASSETS, f).replace(/\\/g, '/')).toMatch(new RegExp(`^(sfx|ambience)/${pack}/`));
      }
    }
  });

  it('resolves every cue to a bus, a sane gain and a known category', () => {
    for (const id of SFX_IDS) {
      const cue = sfxCue(id);
      expect(SFX_CATEGORIES[cue.cat], id).toBeDefined();
      expect(['fx', 'voices', 'ambience', 'ui']).toContain(cue.bus);
      expect(cue.gain, id).toBeGreaterThan(0);
      // Files are mastered to one loudness; the biggest blast plays a little
      // over unity and the limiter chain (tested in verify:audio-sfx) holds it.
      expect(cue.gain, id).toBeLessThanOrEqual(1.5);
      expect(cue.voices, id).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps the payload inside budget (less than 8.3 MiB of sfx + ambience)', () => {
    // A guard against runaway takes (a long take, a stray stereo encode, a third take nobody
    // needs), not a first-load cost: nothing here is fetched before the first gesture, and
    // everything past the core packs loads with its floor (audio/AudioDirector). Raised from
    // 6.3 MB for the flora pack (26 cues, 412 KB of short mono one-shots and two loops at the
    // established 72/64 kbps), leaving ~290 KB of headroom: a wave that needs more should
    // shorten takes before it moves this line again. Raised to 8 MB for the
    // second doors (wave 3, ~1 MB): the Cold Store's and the Glass Galleries'
    // guardians, organisms and their two stereo beds — packs that load only
    // with their own floor, and a run visits one door per floor.
    const bytes = [...filesOnDisk.values()].flat().reduce((n, f) => n + statSync(f).size, 0);
    // Arena adds 23 short high-quality impact and voice takes in a lazy pack.
    // The campaign still does not request this pack.
    expect(bytes).toBeLessThan(8.3 * 1024 * 1024);
  });
});

describe('every sound the game makes resolves to a sample', () => {
  it('overrides every AudioApi sound method in the sampled engine', () => {
    const engine = read(join(SRC, 'audio', 'SfxEngine.ts'));
    const methods = audioApiMethods().filter((m) => !PLUMBING.has(m));
    expect(methods.length).toBeGreaterThan(40);
    const missing = methods.filter((m) => !new RegExp(`override ${m}\\(`).test(engine));
    expect(missing).toEqual([]);
  });

  it('maps every AudioApi sound method to cues that exist and have files', () => {
    const engine = read(join(SRC, 'audio', 'SfxEngine.ts')).replace(/\r/g, '');
    for (const m of audioApiMethods().filter((x) => !PLUMBING.has(x))) {
      const start = engine.indexOf(`override ${m}(`);
      const end = engine.indexOf('\n  override ', start + 10);
      const body = engine.slice(start, end < 0 ? undefined : end);
      const ids = [...body.matchAll(/'((?:[a-z]+\.)+[a-zA-Z]+)'/g)].map((x) => x[1]).filter((s) => s.includes('.'));
      const templated = /`(?:player\.step|creature)\.\$\{/.test(body);
      expect(ids.length > 0 || templated, `${m} plays no named cue`).toBe(true);
      for (const id of ids) expect(isSfxId(id) && hasFiles(id), `${m} → ${id}`).toBe(true);
    }
    for (const surface of ['stone', 'soft', 'wet', 'wood']) expect(hasFiles(`player.step.${surface}`)).toBe(true);
    for (const kind of ['alchemy', 'phialCrack', 'phialFill', 'victory', 'fallen', 'shutter']) expect(hasFiles(`stinger.${kind}`)).toBe(true);
  });

  it('every literal cue id used anywhere in src/ is a cue with files', () => {
    const used = new Set<string>();
    for (const f of srcFiles) {
      if (f.includes(`${join('content', 'audio')}`)) continue;
      for (const m of read(f).matchAll(/\.sfx\(\s*'([^']+)'/g)) used.add(m[1]);
      for (const m of read(f).matchAll(/\.sfx\([^)]*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) { used.add(m[1]); used.add(m[2]); }
    }
    expect(used.size).toBeGreaterThan(120);
    const bad = [...used].filter((id) => !isSfxId(id) || !hasFiles(id));
    expect(bad).toEqual([]);
  });

  it('templated cue ids expand to real cues (body materials, footstep surfaces)', () => {
    for (const mat of ['wood', 'stone', 'metal']) {
      expect(hasFiles(`body.impact.${mat}`)).toBe(true);
      expect(hasFiles(`body.smash.${mat}`)).toBe(true);
    }
  });

  it('gives every creature kind an alert, a hurt and a death (its own or the generic one)', () => {
    for (const kind of ENEMY_KINDS) {
      for (const action of ['alert', 'hurt', 'death']) {
        const own = `creature.${kind}.${action}`;
        const id = isSfxId(own) ? own : `creature.generic.${action}`;
        expect(isSfxId(id) && hasFiles(id), `${kind} ${action}`).toBe(true);
      }
    }
  });

  it('has no raw procedural tone/noise call left outside the audio module', () => {
    const raw: string[] = [];
    for (const f of srcFiles) {
      if (f.includes(`${join('src', 'audio')}`)) continue;
      const text = read(f);
      if (/audio\??\.(tone|noiseBurst)\(/.test(text)) raw.push(relative(ROOT, f));
    }
    expect(raw).toEqual([]);
  });
});

describe('packs, beds and the floors', () => {
  it('loads UI, player, spells and world first', () => {
    expect([...CORE_SFX_PACKS]).toEqual(['ui', 'player', 'spells', 'world']);
    for (const p of CORE_SFX_PACKS) expect(packCues(p).length).toBeGreaterThan(10);
  });

  it('names creature packs after real enemy kinds', () => {
    for (const p of SFX_PACKS.filter((x) => x.startsWith('creature-'))) {
      expect(ENEMY_KINDS as readonly string[]).toContain(p.slice('creature-'.length));
    }
  });

  it('has a creature pack for every kind on the four-floor spine rosters and both bosses', () => {
    const kinds = new Set<string>(['leviathan', 'colossus']);
    for (const roster of Object.values(SPINE_ROSTERS)) for (const k of Object.keys(roster ?? {})) kinds.add(k);
    for (const k of kinds) expect(SFX_PACKS, k).toContain(`creature-${k}`);
  });

  it('gives each floor a looping bed with files, and each biome a fallback', () => {
    for (const floor of ['d1', 'd2', 'd3', 'd4', 'd2b', 'd3b']) {
      const bed = FLOOR_BEDS[floor];
      expect(bed).toBeDefined();
      expect(sfxCue(bed).loop).toBe(true);
      expect(sfxCue(bed).bus).toBe('ambience');
      expect(hasFiles(bed)).toBe(true);
    }
    for (const bed of Object.values(BIOME_BEDS)) expect(isSfxId(bed)).toBe(true);
  });

  it('gives the Bell & Tea Engine stages real cues', () => {
    for (const id of Object.values(TEA_STAGE_SFX)) expect(hasFiles(id), id).toBe(true);
  });
});

describe('audition entries', () => {
  it('lists every cue with its prompt and every take', () => {
    expect(AUDITION_ENTRIES.length).toBe(SFX_IDS.length);
    for (const e of AUDITION_ENTRIES) {
      expect(e.prompt.length, e.id).toBeGreaterThan(10);
      if (!PENDING.has(e.id)) expect(e.urls.length, e.id).toBeGreaterThan(0);
      expect(e.group.startsWith('SFX')).toBe(true);
      expect(isSfxId(e.id as SfxId)).toBe(true);
    }
  });
});

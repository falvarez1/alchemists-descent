import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '@/core/events';
import type { SfxOptions } from '@/core/types';
import { BOSS_MOVE_CUES, FLORA_CUES, LIGHT_CUES, ORGANISM_CUES, TREE_FALL_CUES, installEventCues, treeFallCue, type EventCue } from '@/audio/EventCues';
import { CORE_SFX_PACKS, SFX_CUES, type SfxId } from '@/content/audio/sfxCues';
import { sfxCue } from '@/content/audio/sfxCatalog';
import { FLOOR_FAUNA } from '@/game/organisms/placement';
import { ORGANISM_KINDS } from '@/game/organisms';
import { LEVELS } from '@/config/worldgraph';

const ASSETS = join(__dirname, '..', 'src', 'assets', 'audio');
const walk = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; }) : [];
const onDisk = new Set(walk(ASSETS).map((f) => /[\\/]([^\\/]+)-\d+\.mp3$/.exec(f)?.[1]).filter(Boolean));

interface Played { id: SfxId; x?: number; y?: number; opts?: SfxOptions }
function harness(biome?: string): { events: EventBus; played: Played[] } {
  const events = new EventBus();
  const played: Played[] = [];
  installEventCues(events, { sfx: (id, x, y, opts) => { played.push({ id, x, y, opts }); } }, { biome: () => biome });
  return { events, played };
}

const allCues = (): EventCue[] => [
  ...Object.values(ORGANISM_CUES).flatMap((a) => Object.values(a).flat()),
  ...Object.values(BOSS_MOVE_CUES).flatMap((m) => Object.values(m ?? {}).flat()),
  ...Object.values(LIGHT_CUES),
  ...Object.values(FLORA_CUES).flat(),
  ...Object.values(TREE_FALL_CUES),
] as EventCue[];

describe('announced moments sound (audio/EventCues)', () => {
  it('maps only to cues that exist and have mastered files', () => {
    for (const cue of allCues()) {
      expect(SFX_CUES[cue.sfx], cue.sfx).toBeDefined();
      expect(onDisk.has(cue.sfx), `${cue.sfx} has files`).toBe(true);
    }
  });

  it('plays each organism action at the organism, and stays quiet for the unmapped ones', () => {
    const { events, played } = harness();
    events.emit('organism', { kind: 'snapjaw', action: 'snap', x: 40, y: 50 });
    expect(played.at(-1)).toMatchObject({ id: 'organism.snapjaw.snap', x: 40, y: 50 });
    events.emit('organism', { kind: 'puffer', action: 'burst', x: 10, y: 11 });
    expect(played.at(-1)).toMatchObject({ id: 'organism.puffer.burst', x: 10, y: 11 });
    events.emit('organism', { kind: 'leech', action: 'eat', x: 1, y: 2 });
    expect(played.at(-1)?.id).toBe('organism.leech.drink');
    events.emit('organism', { kind: 'bat', action: 'scatter', x: 3, y: 4 });
    expect(played.at(-1)?.id).toBe('creature.bat.scatter');
    events.emit('organism', { kind: 'fish', action: 'scatter', x: 5, y: 6 });
    expect(played.at(-1)?.id).toBe('organism.fish.scatter');
    const n = played.length;
    events.emit('organism', { kind: 'isopod', action: 'scavenge', x: 0, y: 0 });
    events.emit('organism', { kind: 'weaver', action: 'snare', x: 0, y: 0 });
    expect(played.length).toBe(n);
  });

  it('sounds the tell of each boss move as it commits', () => {
    const { events, played } = harness();
    events.emit('bossMove', { kind: 'colossus', move: 'slam', phase: 1, x: 100, y: 200 });
    expect(played.at(-1)).toMatchObject({ id: 'creature.colossus.heave', x: 100 });
    events.emit('bossMove', { kind: 'colossus', move: 'dying', phase: 3, x: 100, y: 200 });
    expect(played.at(-1)?.id).toBe('creature.colossus.death.crack');
    events.emit('bossMove', { kind: 'leviathan', move: 'lunge', phase: 1, x: 7, y: 8 });
    expect(played.slice(-2).map((p) => p.id)).toEqual(['creature.leviathan.dim', 'creature.leviathan.windup']);
    // The windup follows the lure going dark, a beat later.
    expect(played.at(-1)?.opts?.delay).toBeGreaterThan(0);
    const n = played.length;
    events.emit('bossMove', { kind: 'colossus', move: 'march', phase: 1, x: 0, y: 0 });
    expect(played.length).toBe(n);
  });

  it('voices the lantern hood (not its housekeeping), the dark, eyes and the light devices', () => {
    const { events, played } = harness();
    events.emit('lanternHooded', { hooded: true, x: 5, y: 5 });
    expect(played.at(-1)?.id).toBe('light.lantern.hood');
    events.emit('lanternHooded', { hooded: false, x: 5, y: 5 });
    expect(played.at(-1)?.id).toBe('light.lantern.unhood');
    const n = played.length;
    events.emit('lanternHooded', { hooded: false, x: 5, y: 5, quiet: true });
    expect(played.length).toBe(n);
    events.emit('darkZoneEntered', { x: 1, y: 1, darkness: 0.9 });
    expect(played.at(-1)).toMatchObject({ id: 'light.dark', x: undefined });
    events.emit('eyeshineCaught', { kind: 'bat', x: 9, y: 9 });
    expect(played.at(-1)).toMatchObject({ id: 'light.eyeshine', x: 9, y: 9 });
    for (const [kind, id] of [['photocell', 'light.photocell.latch'], ['bloom-open', 'light.bloom.open'], ['bloom-furl', 'light.bloom.furl']] as const) {
      events.emit('lightDevice', { kind, x: 2, y: 3 });
      expect(played.at(-1)).toMatchObject({ id, x: 2, y: 3 });
    }
  });

  it('sounds every plant moment at the plant, each with its own flora cue', () => {
    const { events, played } = harness('earthen');
    const kinds = ['creak', 'lean', 'crack', 'snap', 'whoosh', 'rustle', 'shed', 'podDrop', 'soak', 'sprout', 'rung', 'bloom', 'settle'] as const;
    for (const kind of kinds) {
      expect(FLORA_CUES[kind].length, kind).toBeGreaterThan(0);
      const n = played.length;
      events.emit('floraMoment', { kind, x: 30, y: 40, strength: 1 });
      expect(played.length, kind).toBeGreaterThan(n);
      for (const p of played.slice(n)) {
        expect(p.id.startsWith('flora.'), `${kind} → ${p.id}`).toBe(true);
        expect(p).toMatchObject({ x: 30, y: 40 });
      }
    }
    // No two moments share a one-shot (the growth loop is shared on purpose: it runs under the ladder).
    const oneShots = Object.values(FLORA_CUES).flat().map((c) => c.sfx).filter((id) => !id.endsWith('.loop'));
    expect(new Set(oneShots).size).toBe(oneShots.length);
  });

  it('tells the hinge tearing from a sapling snapping, and scales a moment by its strength', () => {
    const { events, played } = harness();
    events.emit('floraMoment', { kind: 'snap', x: 0, y: 0, strength: 0.8 });
    expect(played.map((p) => p.id)).toEqual(['flora.hinge']);
    events.emit('floraMoment', { kind: 'snap', x: 0, y: 0, strength: 0.4 });
    expect(played.at(-1)?.id).toBe('flora.sapling');
    events.emit('floraMoment', { kind: 'creak', x: 0, y: 0, strength: 0.6 });
    const soft = played.at(-1)?.opts?.gain ?? 1;
    events.emit('floraMoment', { kind: 'creak', x: 0, y: 0, strength: 1 });
    const hard = played.at(-1)?.opts?.gain ?? 1;
    expect(soft).toBeLessThan(hard);
    expect(soft).toBeGreaterThan(0.5);
  });

  it("fells a tree in the floor's own wood, and a bounce is the same wood, lighter", () => {
    const woods: Array<[string, SfxId]> = [
      ['earthen', 'flora.fall.birch'], ['fungal', 'flora.fall.mushroom'], ['flooded', 'flora.fall.mangrove'], ['volcanic', 'flora.fall.emberbark'],
    ];
    for (const [biome, id] of woods) {
      const { events, played } = harness(biome);
      events.emit('treeLanded', { x: 50, y: 60, strength: 0.9, first: true });
      expect(played.at(-1)).toMatchObject({ id, x: 50, y: 60 });
      const first = played.at(-1)?.opts?.gain ?? 0;
      events.emit('treeLanded', { x: 52, y: 60, strength: 0.5, first: false });
      expect(played.at(-1)?.id).toBe(id);
      expect(played.at(-1)?.opts?.gain ?? 1).toBeLessThan(first);
      const n = played.length;
      events.emit('treeLanded', { x: 52, y: 60, strength: 0.2, first: false });
      expect(played.length).toBe(n); // a nudge is not a bounce
    }
    // A level with no species of its own (a test arena, the frozen biome) falls as birch.
    expect(treeFallCue(undefined).sfx).toBe('flora.fall.birch');
    expect(treeFallCue('frozen').sfx).toBe('flora.fall.birch');
  });

  it('disposes cleanly', () => {
    const events = new EventBus();
    const played: string[] = [];
    const dispose = installEventCues(events, { sfx: (id) => { played.push(id); } });
    dispose();
    events.emit('organism', { kind: 'snapjaw', action: 'snap', x: 0, y: 0 });
    expect(played).toEqual([]);
  });
});

describe('plant sounds load with every floor', () => {
  it('files every flora cue in the flora pack, which is never a first-load pack', () => {
    const flora = (Object.keys(SFX_CUES) as SfxId[]).filter((id) => id.startsWith('flora.'));
    expect(flora.length).toBeGreaterThanOrEqual(20);
    for (const id of flora) expect(sfxCue(id).pack, id).toBe('flora');
    expect(CORE_SFX_PACKS).not.toContain('flora');
  });
});

describe('organism sounds load with their floors', () => {
  it('files every organism cue in the pack of its own kind (or a core pack, for life found everywhere)', () => {
    for (const id of Object.keys(SFX_CUES) as SfxId[]) {
      const m = /^organism\.([a-z]+)\./.exec(id);
      if (!m) continue;
      const pack = sfxCue(id).pack;
      expect(pack === `org-${m[1]}` || CORE_SFX_PACKS.includes(pack), `${id} in ${pack}`).toBe(true);
    }
  });

  it('gives every organism on a campaign floor a pack the director will request for that floor', () => {
    const packs = new Set(Object.values(SFX_CUES).map((c) => c.pack));
    for (const def of Object.values(LEVELS)) {
      for (const kind of Object.keys(FLOOR_FAUNA[def.biome] ?? {})) {
        if (!ORGANISM_KINDS.has(kind as never)) continue; // plain critters (moths, fish, flies) live in the core packs
        expect(packs.has(`org-${kind}`), `${def.id}: org-${kind}`).toBe(true);
      }
    }
  });
});

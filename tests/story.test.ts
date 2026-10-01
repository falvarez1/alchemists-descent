import { describe, expect, it } from 'vitest';
import {
  BOSS_PROLOGUES,
  DOCENT_PIPES,
  ECHOES,
  ENDING_AGAIN,
  ENDING_FIRST,
  ESCAPE_LINES,
  OPENING,
  OPENING_MAX_SECONDS,
  PELL,
  STORY_FLOOR_ORDER,
  ASH_DOORS,
  ASH_GREETINGS,
  journalEntries,
  pipeBeats,
  storyVoiceLines,
  type Beat,
} from '@/content/story';
import {
  STORY_META_VERSION,
  beatLine,
  defaultStoryMeta,
  openingDue,
  parseStoryMeta,
  pellRecognition,
  StoryMetaStore,
  withHeard,
  withJournal,
} from '@/game/story/storyMeta';
import { freshStoryRun, pellWaits, pipeLine, sanitizeStoryRun, withPipeSpoken } from '@/game/story/storyRun';
import { actorAt } from '@/game/story/EchoStage';
import { PENDING_VOICE_RECORDING } from './pendingVoice';
import { readingSeconds, speakerKey, narrationKey } from '@/audio/narrationText';
import { NARRATION_CLIPS } from '@/content/audio/narration.generated';

const beat = (id: string, again: string | null = null): Beat => ({ id, first: `${id} first`, again });

describe('the story meta: what a player has heard, across runs', () => {
  it('parses fresh, corrupt, future and valid documents without throwing', () => {
    expect(parseStoryMeta(null).status).toBe('fresh');
    expect(parseStoryMeta('{nope').status).toBe('corrupt');
    expect(parseStoryMeta(JSON.stringify({ version: STORY_META_VERSION + 1 })).status).toBe('future');
    const ok = parseStoryMeta(JSON.stringify({ version: STORY_META_VERSION, runsBegun: 3.7, heard: ['a', 'a', 7, ''], pellRuns: -2, openingSeen: true, journal: ['j'] }));
    expect(ok.status).toBe('ok');
    expect(ok.data).toMatchObject({ runsBegun: 3, heard: ['a'], pellRuns: 0, openingSeen: true, journal: ['j'] });
  });

  it('a newer document on disk is never clobbered', () => {
    const disk = new Map<string, string>([['breathing-works-story', JSON.stringify({ version: 99, runsBegun: 40 })]]);
    const store = new StoryMetaStore({ getItem: k => disk.get(k) ?? null, setItem: (k, v) => disk.set(k, v) });
    store.update(m => ({ ...m, runsBegun: 1 }));
    expect(JSON.parse(disk.get('breathing-works-story')!).version).toBe(99);
  });

  it('first run rich, repeat runs light: a heard beat says its again line, or keeps quiet', () => {
    const meta = defaultStoryMeta();
    expect(beatLine(meta, beat('x', 'x again'))).toEqual({ text: 'x first', fresh: true });
    const heard = withHeard(meta, 'x', 'y');
    expect(beatLine(heard, beat('x', 'x again'))).toEqual({ text: 'x again', fresh: false });
    expect(beatLine(heard, beat('y'))).toBeNull();
    expect(withHeard(heard, 'x')).toBe(heard);
    expect(withJournal(heard, 'j', 'j').journal).toEqual(['j']);
  });

  it('Pell recognises a repeat visitor, and a regular', () => {
    expect(pellRecognition({ pellRuns: 0 })).toBe('first');
    expect(pellRecognition({ pellRuns: 1 })).toBe('again');
    expect(pellRecognition({ pellRuns: 3 })).toBe('veteran');
  });

  it('the opening plays until it has been seen', () => {
    expect(openingDue({ openingSeen: false, runsBegun: 0 })).toBe(true);
    expect(openingDue({ openingSeen: true, runsBegun: 1 })).toBe(false);
  });
});

describe('the speaking-pipes: which line, once per run', () => {
  const script = { sites: { refuge: beat('site.refuge', 'refuge again') }, sequence: [beat('s1', 's1 again'), beat('s2'), beat('s3')] };

  it('a first run hears the floor in the order walked, whichever pipe comes first', () => {
    let run = freshStoryRun(1);
    const meta = defaultStoryMeta();
    const a = pipeLine(script, { id: 'p2' }, 'd2', run, meta)!;
    expect(a.beat.id).toBe('s1');
    run = withPipeSpoken(run, 'd2', { id: 'p2' }, a.beat.id);
    expect(pipeLine(script, { id: 'p2' }, 'd2', run, meta)).toBeNull();
    expect(pipeLine(script, { id: 'p0' }, 'd2', run, meta)!.beat.id).toBe('s2');
  });

  it('a repeat run hears only unheard beats, then light again lines, then quiet', () => {
    const run = freshStoryRun(2);
    const meta = withHeard(defaultStoryMeta(), 's1', 's2');
    expect(pipeLine(script, { id: 'p0' }, 'd2', run, meta)!.beat.id).toBe('s3');
    const all = withHeard(meta, 's3');
    const again = pipeLine(script, { id: 'p0' }, 'd2', run, all)!;
    expect(again).toMatchObject({ text: 's1 again', fresh: false });
    const after = withPipeSpoken(run, 'd2', { id: 'p0' }, again.beat.id);
    expect(pipeLine(script, { id: 'p1' }, 'd2', after, all)).toBeNull();
  });

  it('a pinned site says its own beat', () => {
    const run = freshStoryRun(1);
    expect(pipeLine(script, { id: 'refuge' }, 'd1', run, defaultStoryMeta())!.beat.id).toBe('site.refuge');
    expect(pipeLine(script, { id: 'refuge' }, 'd1', run, withHeard(defaultStoryMeta(), 'site.refuge'))!.text).toBe('refuge again');
  });

  it('floor 1 names every hand-placed pipe; every floor has something to say', () => {
    expect(Object.keys(DOCENT_PIPES.earthen!.sites!)).toEqual(['intake', 'gallery', 'refuge', 'undertow', 'bell']);
    for (const biome of STORY_FLOOR_ORDER) expect(pipeBeats(biome).length, biome).toBeGreaterThanOrEqual(2);
  });
});

describe('the run slice of the save', () => {
  it('sanitizes anything into a valid state', () => {
    expect(sanitizeStoryRun(null, 4)).toEqual(freshStoryRun(4));
    expect(sanitizeStoryRun({ v: 2 }, 1)).toEqual(freshStoryRun(1));
    const s = sanitizeStoryRun({ v: 1, runIndex: 2, pipes: ['d1:refuge', 3], spoken: ['a'], pell: { d1: { met: true, gift: 'seeds' }, bad: 5 }, echoes: ['echo.bellows'], prologues: ['colossus'], escape: 'active' });
    expect(s).toMatchObject({ runIndex: 2, pipes: ['d1:refuge'], pell: { d1: { met: true, gift: 'seeds' } }, escape: 'active' });
    expect(sanitizeStoryRun({ v: 1, escape: 'sideways' }).escape).toBe('none');
  });

  it('Pell waits at the top for an apprentice who sat with him on two floors', () => {
    expect(pellWaits({ pell: { d1: { met: true, gift: null } } })).toBe(false);
    expect(pellWaits({ pell: { d1: { met: true, gift: null }, d2: { met: true, gift: 'pin' } } })).toBe(true);
    // The Kiln's cold camp (his page) is not a meeting.
    expect(pellWaits({ pell: { d1: { met: true, gift: null }, d4: { met: false, gift: 'page' } } })).toBe(false);
  });
});

describe('memory echoes', () => {
  it('actors slide between keys, walk when they move, and hold their action when they stand', () => {
    const actor = { costume: 'worker' as const, keys: [{ t: 0, dx: 0, act: 'crank' as const, face: 1 as const }, { t: 2, dx: 0, act: 'crank' as const, face: 1 as const }, { t: 4, dx: 20, act: 'stand' as const, face: 1 as const }] };
    expect(actorAt(actor, 1)).toMatchObject({ dx: 0, act: 'crank', moving: false });
    const mid = actorAt(actor, 3);
    expect(mid.dx).toBeCloseTo(10);
    expect(mid).toMatchObject({ act: 'walk', face: 1, moving: true });
    expect(actorAt(actor, 9)).toMatchObject({ dx: 20, act: 'stand' });
  });

  it('every echo is choreographed in time order and narrated', () => {
    for (const [biome, echo] of Object.entries(ECHOES)) {
      expect(echo!.lines.length, biome).toBeGreaterThanOrEqual(2);
      expect(echo!.actors.some(a => a.lingers), `${biome}: someone stays`).toBe(true);
      for (const a of echo!.actors) for (let i = 1; i < a.keys.length; i++) expect(a.keys[i].t, biome).toBeGreaterThanOrEqual(a.keys[i - 1].t);
    }
  });
});

describe('the script', () => {
  it('beat ids are unique and every line has words', () => {
    const beats: Beat[] = [
      ...STORY_FLOOR_ORDER.flatMap(pipeBeats), ...Object.values(BOSS_PROLOGUES).filter((b): b is Beat => !!b), ...Object.values(ESCAPE_LINES),
      ...Object.values(ASH_GREETINGS), ...Object.values(ASH_DOORS).filter((b): b is Beat => !!b),
    ];
    const ids = beats.map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of beats) expect(b.first.trim().length, b.id).toBeGreaterThan(8);
  });

  it('Pell offers at most three choices, and a visit on every floor he camps on', () => {
    for (const [biome, floor] of Object.entries(PELL)) {
      for (const visit of [floor!.first, floor!.again, floor!.veteran]) {
        if (!visit) continue;
        expect(visit.choices.length, `${biome} ${visit.id}`).toBeLessThanOrEqual(3);
        expect(visit.farewell.length).toBeGreaterThan(0);
      }
    }
    expect(PELL.volcanic).toBeUndefined(); // he has gone ahead
  });

  it('the opening is brief, and the ending has both Pell endings', () => {
    expect(OPENING.reduce((s, p) => s + p.seconds, 0)).toBeLessThanOrEqual(OPENING_MAX_SECONDS);
    for (const e of [ENDING_FIRST, ENDING_AGAIN]) {
      expect(e.pellWaiting.line?.speaker).toBe('pell');
      expect(e.pellLantern.art).toBe('lantern');
    }
    expect(ENDING_FIRST.farewell.line?.text).toMatch(/never did leave/);
  });

  it('every registered story line has a recording (run scripts/audio/gen-voice.mjs after adding one)', () => {
    // The catalogue and the game read the same text; a line without a clip plays silently. Recorded 2026-09-30.
    // (tests/pendingVoice.ts: lines registered ahead of their recording, which the integrator pays for once.)
    const pending = new Set(PENDING_VOICE_RECORDING);
    const missing = storyVoiceLines().filter(l => !NARRATION_CLIPS[speakerKey(l.speaker, l.text)] && !pending.has(l.text)).map(l => `${l.speaker}: ${l.text.slice(0, 60)}`);
    expect(missing).toEqual([]);
    const stale = storyVoiceLines().filter(l => pending.has(l.text) && NARRATION_CLIPS[speakerKey(l.speaker, l.text)]).map(l => l.text.slice(0, 60));
    expect(stale, 'recorded now: take it off tests/pendingVoice.ts').toEqual([]);
  });

  it('every voice line keys by speaker (Pell and Ash apart from the Docent)', () => {
    expect(speakerKey('docent', 'Mind the duck')).toBe(narrationKey('Mind the duck'));
    expect(speakerKey('pell', 'Mind the duck')).not.toBe(narrationKey('Mind the duck'));
    const lines = storyVoiceLines();
    expect(lines.some(l => l.speaker === 'pell')).toBe(true);
    expect(lines.some(l => l.speaker === 'ash')).toBe(true);
    const chars = new Map<string, number>();
    for (const l of new Map(lines.map(l => [`${l.speaker}|${l.text}`, l])).values()) chars.set(l.speaker, (chars.get(l.speaker) ?? 0) + l.text.length);
    // The whole story fits the voice budget (eleven_v3 ≈ 1 credit a character). Raised from 14,000 on 2026-09-30,
    // when the owner authorised recording the new Pell, Ash and Docent lines (17,129 characters registered then).
    expect([...chars.values()].reduce((a, b) => a + b, 0)).toBeLessThan(20000);
    expect(readingSeconds('One two three four five six seven eight')).toBeGreaterThan(2);
  });

  it('the Journal has a page for every floor and every echo', () => {
    const ids = journalEntries().map(e => e.id);
    for (const biome of STORY_FLOOR_ORDER) expect(ids, biome).toContain(`journal.docent.${biome}`);
    for (const echo of Object.values(ECHOES)) expect(ids).toContain(`journal.${echo!.id}`);
    expect(ids).toContain('journal.pell.volcanic');
    expect(new Set(ids).size).toBe(ids.length);
  });
});

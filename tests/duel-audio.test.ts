import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '@/core/events';
import type { Ctx } from '@/core/types';
import type { StreamHost } from '@/audio/streamHost';
import { inArena } from '@/audio/arenaAudio';
import { Narrator } from '@/audio/Narrator';
import { installAudioStingers } from '@/audio/Stingers';
import { installUiSounds } from '@/audio/UiSounds';
import { installAudioDirector } from '@/audio/AudioDirector';
import type { SfxAudioEngine } from '@/audio/SfxEngine';
import { DuelAnnouncer } from '@/audio/DuelAnnouncer';
import { beatCall, countCall, downCall, lobbyCalls, type LobbyView } from '@/audio/duelCalls';
import { arrivalLine, narrationKey } from '@/audio/narrationText';
import { DUEL_CLIP_LINES, DUEL_CLIPS } from '@/content/audio/duelAnnouncer.generated';
import { DUEL_FIGHTER_NAMES, DUEL_LINES, DUEL_SHORT_NAMES, DUEL_STAGE_NAMES } from '@/content/audio/duelLines';
import { FIGHTER_DEFS, FIGHTER_ORDER, type FighterId } from '@/content/fighters';
import { STOCK_STAGES, STOCK_STAGE_ORDER } from '@/config/stockStage';
import { duelShortName } from '@/ui/duelCopy';
import { FakeAudioContext } from './helpers/fakeWebAudio';

/*
 * The Duel is not the descent (QA, 2026-10-03: "when I start the Duel Mode I always hear the narrator talking
 * about the bellows"). A campaign floor's arrival, scheduled a moment before the player left for the title,
 * was read out over the Duel lobby; the Duel stage borrowed the Bellows' ambience bed through its biome. The
 * gate is audio/arenaAudio inArena; the Duel's own voice is audio/DuelAnnouncer.
 */

const noop = (): void => undefined;
function stubDom(hidden = false): void {
  vi.stubGlobal('window', {
    addEventListener: noop, removeEventListener: noop,
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms), clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
  vi.stubGlobal('document', { hidden, body: { classList: { contains: () => false } }, addEventListener: noop, removeEventListener: noop });
}

function host(ac: FakeAudioContext | null): StreamHost & { ducks: boolean[] } {
  const ducks: boolean[] = [];
  return {
    ducks,
    enabled: true,
    streamContext: () => ac as unknown as AudioContext | null,
    streamBus: () => (ac ? (ac.destination as unknown as AudioNode) : null),
    talkDuck: (on: boolean) => { ducks.push(on); },
    ensure: noop,
  };
}

interface Seat { fighter: FighterId; device: string; ready: boolean; cpuLevel: number }
interface FakeVersus { phase: string; active: boolean; stage: string; seats: Seat[] }

function campaignCtx(events: EventBus): Ctx & { versus: FakeVersus } {
  const versus: FakeVersus = { phase: 'idle', get active() { return this.phase !== 'idle'; }, stage: 'foundry', seats: [
    { fighter: 'ilyra-voss', device: 'keyboard', ready: false, cpuLevel: 3 },
    { fighter: 'brann-rook', device: 'cpu', ready: true, cpuLevel: 3 },
  ] };
  return {
    events,
    state: { mode: 'play', paused: false, frameCount: 7, score: 0 },
    player: { x: 100, y: 100, dead: false },
    enemies: [],
    levels: { current: { def: { id: 'd1', name: 'THE BELLOWS', biome: 'earthen', depth: 1, nextLevelId: 'd2' } } },
    sanctum: { isOpen: false },
    run: { over: false },
    versus,
  } as unknown as Ctx & { versus: FakeVersus };
}

describe('the arena gate', () => {
  const facts = (mode: string, level: string | null, versus = false, arena = false) =>
    ({ state: { mode }, versus: { active: versus }, arena: { active: arena }, levels: { current: level ? { def: { id: level } } : null } });

  it('places the Duel lobby, a match and the arena levels in the arena, and the descent outside it', () => {
    expect(inArena(facts('build', 'd1', true))).toBe(true); // the lobby, over a campaign world
    expect(inArena(facts('play', 'fighter-duel', true, true))).toBe(true); // a stock match
    expect(inArena(facts('play', 'fighter-duel'))).toBe(true);
    expect(inArena(facts('play', 'fighter-test'))).toBe(true); // the Proving Yard
    expect(inArena(facts('play', 'd1'))).toBe(false);
    expect(inArena(facts('play', 'd3b'))).toBe(false);
    // The title after a Duel: the world behind it is still the Duel stage, but nobody is in the arena.
    expect(inArena(facts('build', 'fighter-duel'))).toBe(false);
  });
});

/** A context whose clips really decode (the fetch is stubbed), so a line that is allowed is really spoken. */
function voicedContext(): FakeAudioContext {
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  return Object.assign(new FakeAudioContext(), { decodeAudioData: async () => ({ duration: 1 }) });
}

describe('the narrator keeps out of the Duel', () => {
  beforeEach(() => { vi.useFakeTimers(); stubDom(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const arrival = arrivalLine('The Bellows', 'The Works draw breath. Mind the pressure.');
  const clips = { [narrationKey(arrival)]: { url: 'audio/voice/x.mp3', seconds: 3 }, [narrationKey('A toast')]: { url: 'audio/voice/y.mp3', seconds: 1 } };

  it('still reads a floor arrival in the descent (the control)', async () => {
    const events = new EventBus();
    const ctx = campaignCtx(events);
    const narrator = new Narrator(ctx, host(voicedContext()), clips);
    events.emit('levelChanged', { depth: 1, name: 'THE BELLOWS' });
    await vi.advanceTimersByTimeAsync(8000);
    expect((narrator.debugSnapshot() as { spoken: Array<{ text: string }> }).spoken.map((l) => l.text)).toEqual([arrival]);
    narrator.dispose();
  });

  it('drops the floor arrival scheduled before the player opened the Duel (the QA bug)', async () => {
    const events = new EventBus();
    const ctx = campaignCtx(events);
    const narrator = new Narrator(ctx, host(voicedContext()), clips);
    events.emit('levelChanged', { depth: 1, name: 'THE BELLOWS' });
    // The player leaves for the title and opens the Duel before the arrival's moment comes.
    (ctx.state as { mode: string }).mode = 'build';
    ctx.versus.phase = 'lobby';
    events.emit('versusChanged');
    await vi.advanceTimersByTimeAsync(8000);
    const snap = narrator.debugSnapshot() as { spoken: unknown[]; speaking: unknown };
    expect(snap.spoken).toEqual([]);
    expect(snap.speaking).toBeNull();
    narrator.dispose();
  });

  it('refuses every line in the lobby and on the Duel stage: toasts, callouts, story lines', () => {
    const events = new EventBus();
    const ctx = campaignCtx(events);
    const narrator = new Narrator(ctx, host(voicedContext()), clips);
    expect(narrator.say(['A toast'], 'normal', 'toast')).toBe(true);
    narrator.dispose();
    const gated = new Narrator(ctx, host(voicedContext()), clips);
    ctx.versus.phase = 'lobby';
    expect(gated.say(['A toast'], 'high', 'toast')).toBe(false);
    expect(gated.speak([{ text: 'A toast' }], { priority: 'high', source: 'pipe' })).toBe(false);
    ctx.versus.phase = 'idle';
    (ctx.levels as unknown as { current: { def: { id: string } } }).current = { def: { id: 'fighter-duel' } };
    expect(gated.say(['A toast'], 'high', 'toast')).toBe(false);
    events.emit('toast', { text: 'A toast' });
    expect((gated.debugSnapshot() as { spoken: unknown[] }).spoken).toEqual([]);
    gated.dispose();
  });
});

describe('the descent\'s other cues keep out of the Duel', () => {
  it('no phial crack or run verdict in the arena', () => {
    const events = new EventBus();
    let arena = true;
    const played: string[] = [];
    const off = installAudioStingers(events, { stinger: (k) => { played.push(k); } }, () => arena);
    events.emit('phialsChanged', { phials: 3, reason: 'start' } as never);
    events.emit('phialsChanged', { phials: 2, reason: 'death' } as never);
    events.emit('runEnded', { outcome: 'victory' } as never);
    expect(played).toEqual([]);
    arena = false;
    events.emit('phialsChanged', { phials: 1, reason: 'death' } as never);
    expect(played).toEqual(['phialCrack']);
    off();
  });

  it('no toast tick, objective tube or curtain sweep in the arena', () => {
    const events = new EventBus();
    let arena = true;
    const played: string[] = [];
    const off = installUiSounds(events, { sfx: (id) => { played.push(id); } }, null, () => arena);
    events.emit('toast', { text: 'THE DUEL STAGE' });
    events.emit('objectiveChanged', { text: 'TWO FIGHTERS, ONE ROOM' } as never);
    events.emit('levelCurtain', { visible: true });
    expect(played).toEqual([]);
    arena = false;
    events.emit('objectiveChanged', { text: 'Find the golden key.' } as never);
    expect(played).toEqual(['ui.objective']);
    off();
  });

  it('no floor bed and no floor roster on the Duel stage, though it borrows the Bellows\' biome', () => {
    const run = (level: string, versus: boolean): { bed: string | null; packs: string[] } => {
      const seen = { bed: 'unset' as string | null, packs: [] as string[] };
      const engine = {
        setArenaHurtProvider: noop, requestPacks: (p: string[]) => { seen.packs = p; }, bank: { packs: () => [] },
        packLastAsked: () => undefined, releasePack: noop, setAmbience: (id: string | null) => { seen.bed = id; }, tickAmbience: noop,
      } as unknown as SfxAudioEngine;
      const ctx = {
        state: { mode: 'play' }, enemies: [], critters: { list: [] }, sanctum: { isOpen: false },
        levels: { current: { def: { id: level, name: level, biome: 'earthen', depth: 0, nextLevelId: null } } },
        versus: { active: versus }, arena: { active: versus },
      } as unknown as Ctx;
      installAudioDirector(ctx, engine)();
      return seen;
    };
    expect(run('d1', false).bed).toBe('amb.bellows');
    const duel = run('fighter-duel', true);
    expect(duel.bed).toBeNull();
    expect(duel.packs).toContain('arena');
    expect(duel.packs.filter((p) => p.startsWith('creature-') || p.startsWith('org-') || p.startsWith('amb-'))).toEqual([]);
  });
});

describe('what the cabinet calls', () => {
  const view = (o: Partial<LobbyView> & { seats?: LobbyView['seats'] } = {}): LobbyView => ({
    phase: 'lobby', stage: 'foundry',
    seats: [{ fighter: 'ilyra-voss', device: 'keyboard', ready: false }, { fighter: 'brann-rook', device: 'cpu', ready: true }],
    ...o,
  });
  const lines = (calls: ReturnType<typeof lobbyCalls>): Array<string | undefined> => calls.flatMap((c) => c.steps.map((s) => s.line));

  it('opens the select screen with "Choose your fighter!", once', () => {
    expect(lines(lobbyCalls(null, view()))).toEqual(['choose']);
    expect(lines(lobbyCalls({ ...view(), phase: 'playing' }, view()))).toEqual(['choose']);
    expect(lines(lobbyCalls(view(), view()))).toEqual([]);
    expect(lines(lobbyCalls(view(), view({ phase: 'loading' })))).toEqual([]);
  });

  it('reads a fighter the moment a seat chooses it, and a stage with its whoosh', () => {
    const next = view({ seats: [{ fighter: 'mara-quell', device: 'keyboard', ready: false }, { fighter: 'brann-rook', device: 'cpu', ready: true }] });
    expect(lines(lobbyCalls(view(), next))).toEqual(['fighter.mara-quell']);
    const staged = lobbyCalls(view(), view({ stage: 'kiln' }));
    expect(staged[0].steps).toEqual([{ sfx: 'duel.stage', line: 'stage.kiln' }]);
  });

  it('calls a player locking in, never the CPU (always ready)', () => {
    const ready = view({ seats: [{ fighter: 'ilyra-voss', device: 'keyboard', ready: true }, { fighter: 'brann-rook', device: 'cpu', ready: true }] });
    expect(lobbyCalls(view(), ready)[0].steps).toEqual([{ sfx: 'duel.ready', line: 'ready.1' }]);
    const cpu = view({ seats: [{ fighter: 'ilyra-voss', device: 'cpu', ready: true }, { fighter: 'brann-rook', device: 'cpu', ready: true }] });
    expect(lines(lobbyCalls(view(), cpu))).toEqual([]);
  });

  it('greets a second player taking the CPU\'s seat with the coin and "Here comes a new challenger!"', () => {
    const joined = view({ seats: [{ fighter: 'ilyra-voss', device: 'keyboard', ready: false }, { fighter: 'brann-rook', device: 'pad:0', ready: false }] });
    expect(lobbyCalls(view(), joined)[0].steps).toEqual([{ sfx: 'duel.join', line: 'challenger' }]);
  });

  it('counts the HUD\'s own numbers, opens a rematch, and fights', () => {
    expect(countCall(2, false)?.steps).toEqual([{ sfx: 'duel.count', line: 'count.2' }]);
    expect(countCall(3, false)?.steps).toEqual([{ sfx: 'duel.count', line: 'count.3' }]);
    expect(countCall(4, false)?.steps).toEqual([{ sfx: 'duel.count', line: undefined }]); // ticks above three
    expect(countCall(2, true)?.steps).toEqual([{ sfx: 'duel.count', line: 'rematch' }]);
    expect(beatCall({ state: 'fighting', count: 0, winner: null, reason: null }, { winner: null, timeUp: false, rematch: false })?.steps)
      .toEqual([{ sfx: 'duel.fight', line: 'fight' }]);
  });

  it('ends with GAME (or TIME) and the winner, or a draw', () => {
    const won = beatCall({ state: 'finished', count: 0, winner: 1, reason: 'stocks' }, { winner: 'father-thorne', timeUp: false, rematch: false });
    expect(won?.steps).toEqual([{ sfx: 'duel.game', line: 'game' }, { sfx: 'duel.results', line: 'wins.father-thorne' }]);
    const time = beatCall({ state: 'finished', count: 0, winner: 0, reason: 'timeout' }, { winner: 'kest-rel', timeUp: true, rematch: false });
    expect(time?.steps[0].line).toBe('time');
    const draw = beatCall({ state: 'finished', count: 0, winner: null, reason: 'draw' }, { winner: null, timeUp: false, rematch: false });
    expect(draw?.steps[1].line).toBe('draw');
  });

  it('blasts every ring-out, calls it while the match goes on, and warns of the last stock', () => {
    const ev = { slot: 1, by: 0, source: 'ring-out', x: 0, y: 0 };
    expect(downCall(ev, { stocksLeft: 2, finished: false, downsSoFar: 0 }).steps).toEqual([{ sfx: 'duel.ko', line: 'ring-out' }]);
    expect(downCall(ev, { stocksLeft: 1, finished: false, downsSoFar: 1 }).steps).toEqual([{ sfx: 'duel.ko', line: 'ko' }, { line: 'last-stock' }]);
    expect(downCall({ ...ev, by: 1 }, { stocksLeft: 2, finished: false, downsSoFar: 2 }).steps[0].line).toBe('self-destruct');
    expect(downCall(ev, { stocksLeft: 0, finished: true, downsSoFar: 3 }).steps).toEqual([{ sfx: 'duel.ko' }]);
  });
});

describe('the announcer\'s recordings', () => {
  it('has a clip on disk for every line, and speech-to-text heard each one say its words', () => {
    for (const line of DUEL_LINES) {
      const clip = DUEL_CLIPS[line.id];
      expect(clip, line.id).toBeDefined();
      expect(existsSync(join(__dirname, '..', 'public', clip.url)), clip.url).toBe(true);
    }
    expect(DUEL_CLIP_LINES.filter((l) => !l.confirmed).map((l) => `${l.id}: heard "${l.heard}"`)).toEqual([]);
  });

  it('names every fighter and stage the way the game does', () => {
    for (const id of FIGHTER_ORDER) {
      expect(DUEL_FIGHTER_NAMES[id]).toBe(FIGHTER_DEFS[id].name);
      expect(DUEL_SHORT_NAMES[id]).toBe(duelShortName(id));
    }
    for (const id of STOCK_STAGE_ORDER) expect(DUEL_STAGE_NAMES[id]).toBe(STOCK_STAGES[id].name);
  });
});

describe('the announcer at work', () => {
  beforeEach(() => { vi.useFakeTimers(); stubDom(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function rig() {
    const events = new EventBus();
    const ac = new FakeAudioContext();
    Object.assign(ac, { decodeAudioData: async () => ({ duration: 1 }) });
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const sfx: string[] = [];
    const match = { state: 'countdown', countdown: 120, remainingTicks: 21600, winner: null, reason: null, fighters: [{ stocks: 3 }, { stocks: 3 }] };
    const ctx = campaignCtx(events);
    Object.assign(ctx, {
      audio: { sfx: (id: string) => { sfx.push(id); } },
      arena: { active: true, stockMatch: match, fighterId: (slot: number) => (slot === 0 ? 'ilyra-voss' : 'brann-rook') },
    });
    const h = host(ac);
    const announcer = new DuelAnnouncer(ctx, h);
    const said = () => (announcer.debugSnapshot().said as Array<{ line: string; cut?: boolean }>);
    /** Let a playing line end (the fake never ends a source by itself). */
    const end = async () => { for (const s of ac.sources) s.onended?.(); await vi.advanceTimersByTimeAsync(1); };
    return { events, ac, ctx, sfx, match, announcer, said, end, h };
  }

  it('says the select screen and cuts a name when the player cycles on', async () => {
    const { events, ctx, said, announcer } = rig();
    ctx.versus.phase = 'lobby';
    events.emit('versusChanged');
    await vi.advanceTimersByTimeAsync(10);
    ctx.versus.seats[0].fighter = 'sable-fen';
    events.emit('versusChanged');
    await vi.advanceTimersByTimeAsync(10);
    ctx.versus.seats[0].fighter = 'mara-quell';
    events.emit('versusChanged');
    await vi.advanceTimersByTimeAsync(10);
    expect(said().map((s) => s.line)).toEqual(['choose', 'fighter.sable-fen', 'fighter.mara-quell']);
    expect(said().map((s) => !!s.cut)).toEqual([true, true, false]);
    announcer.dispose();
  });

  it('calls the countdown, the fight, a ring-out on the last stock, and the result', async () => {
    const { events, match, said, sfx, end, announcer, h } = rig();
    // A match start resets (twice: the rival joining, then the start); the countdown's first beat is the match's own.
    events.emit('arenaReset');
    events.emit('arenaReset');
    await vi.advanceTimersByTimeAsync(10);
    expect(said()).toEqual([]);
    events.emit('stockMatchBeat', { state: 'countdown', count: 3, winner: null, reason: null });
    await vi.advanceTimersByTimeAsync(10);
    await end();
    events.emit('stockMatchBeat', { state: 'countdown', count: 2, winner: null, reason: null });
    await vi.advanceTimersByTimeAsync(10);
    await end();
    events.emit('stockMatchBeat', { state: 'countdown', count: 1, winner: null, reason: null });
    await vi.advanceTimersByTimeAsync(10);
    await end();
    match.state = 'fighting';
    events.emit('stockMatchBeat', { state: 'fighting', count: 0, winner: null, reason: null });
    await vi.advanceTimersByTimeAsync(10);
    await end();
    match.fighters[1].stocks = 1;
    events.emit('fighterDown', { slot: 1, by: 0, source: 'ring-out', x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(10);
    await end();
    await vi.advanceTimersByTimeAsync(300);
    await end();
    match.state = 'finished';
    match.fighters[1].stocks = 0;
    events.emit('fighterDown', { slot: 1, by: 0, source: 'ring-out', x: 0, y: 0 });
    events.emit('stockMatchBeat', { state: 'finished', count: 0, winner: 0, reason: 'stocks' });
    await vi.advanceTimersByTimeAsync(10);
    await end();
    await vi.advanceTimersByTimeAsync(300);
    await end();
    expect(said().map((s) => s.line)).toEqual(['count.3', 'count.2', 'count.1', 'fight', 'ring-out', 'last-stock', 'game', 'wins.ilyra-voss']);
    expect(sfx).toEqual(['duel.count', 'duel.count', 'duel.count', 'duel.fight', 'duel.ko', 'duel.ko', 'duel.game', 'duel.results']);
    // The score dips under the voice.
    expect(h.ducks[0]).toBe(true);
    // A rematch: its countdown's first beat is "Rematch!", then the numbers again.
    match.state = 'countdown';
    events.emit('arenaReset');
    events.emit('stockMatchBeat', { state: 'countdown', count: 3, winner: null, reason: null });
    await vi.advanceTimersByTimeAsync(10);
    expect(said().at(-1)?.line).toBe('rematch');
    await end();
    events.emit('stockMatchBeat', { state: 'countdown', count: 2, winner: null, reason: null });
    await vi.advanceTimersByTimeAsync(10);
    expect(said().at(-1)?.line).toBe('count.2');
    announcer.dispose();
  });
});
